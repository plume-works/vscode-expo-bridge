import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Runner } from "./exec";
import { readJsonFile } from "./jsonfile";

/** Stored artifacts kept per workspace folder; older ones are deleted on store. */
export const MAX_ENTRIES = 5;

const KEY_RE = /^[0-9a-f]{64}$/;

export interface CacheEntry {
  /** The artifact's file name in the folder's cache directory. */
  file: string;
  /** Epoch ms when the build that produced it ran. */
  builtAt: number;
}

export interface CacheIndex {
  hostPath: string;
  folderHostPath: string;
  entries: Record<string, CacheEntry>;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Every folder's cache under one host path, so revoking its trust can delete them all. */
export function hostPathCacheDir(globalStorage: string, hostPath: string): string {
  return path.join(globalStorage, "build-cache", sha256(hostPath));
}

/** A folder's cache, derived from the trusted host path and the mapped folder only. */
export function folderCacheDir(
  globalStorage: string,
  hostPath: string,
  folderHostPath: string,
): string {
  return path.join(hostPathCacheDir(globalStorage, hostPath), sha256(folderHostPath));
}

/** Delete the cache of every folder under `hostPath`. */
export function remove(globalStorage: string, hostPath: string): void {
  fs.rmSync(hostPathCacheDir(globalStorage, hostPath), { recursive: true, force: true });
}

/** Write a file through a temporary sibling and a rename, so no reader sees it partial. */
function writeAtomic(dest: string, write: (tmp: string) => void): void {
  const tmp = `${dest}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    write(tmp);
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** How long `store` waits for a folder's index lock, and how often it retries. */
export const LOCK_WAIT_MS = 10_000;
export const LOCK_RETRY_MS = 50;
/** A lock older than this is abandoned whether or not its owner still runs. */
export const LOCK_STALE_MS = 60_000;

export interface LockOptions {
  waitMs?: number;
  retryMs?: number;
  staleMs?: number;
  /** Runs while the lock is held, between reading and writing the index; tests use it. */
  whileLocked?: () => Promise<void>;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists under another user
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isStale(lockPath: string, staleMs: number): boolean {
  let st: fs.Stats;
  let owner: number;
  try {
    st = fs.statSync(lockPath);
    owner = Number(fs.readFileSync(lockPath, "utf8"));
  } catch {
    // gone between the failed create and this check: retry the create
    return false;
  }
  if (Date.now() - st.mtimeMs > staleMs) return true;
  return Number.isInteger(owner) && owner > 0 && !processAlive(owner);
}

/**
 * Run `fn` holding `<dir>/index.lock`, an O_EXCL file naming this process, so index updates
 * from every host extension process serialize. Returns null when the lock is not had in time.
 */
async function withIndexLock<T>(
  dir: string,
  o: LockOptions,
  fn: () => Promise<T>,
): Promise<T | null> {
  const lockPath = path.join(dir, "index.lock");
  const deadline = Date.now() + (o.waitMs ?? LOCK_WAIT_MS);
  let ino: number;
  for (;;) {
    try {
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        0o600,
      );
      try {
        fs.writeSync(fd, String(process.pid));
        ino = fs.fstatSync(fd).ino;
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    if (isStale(lockPath, o.staleMs ?? LOCK_STALE_MS)) {
      takeOver(lockPath, o.staleMs ?? LOCK_STALE_MS);
      continue;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, o.retryMs ?? LOCK_RETRY_MS));
  }
  try {
    return await fn();
  } finally {
    // only our own lock: a taken-over one belongs to another process now
    if (safeIno(lockPath) === ino) fs.rmSync(lockPath, { force: true });
  }
}

function safeIno(p: string): number | null {
  try {
    return fs.statSync(p).ino;
  } catch {
    // no lock file: nothing to compare
    return null;
  }
}

/**
 * Move a stale lock aside and delete it. Two processes may both find it stale; the one whose
 * rename caught a fresh lock instead puts that lock back, so no live owner loses it.
 */
function takeOver(lockPath: string, staleMs: number): void {
  const aside = `${lockPath}.stale-${randomBytes(6).toString("hex")}`;
  try {
    fs.renameSync(lockPath, aside);
  } catch {
    // another process moved it first
    return;
  }
  if (isStale(aside, staleMs)) {
    fs.rmSync(aside, { force: true });
    return;
  }
  try {
    fs.linkSync(aside, lockPath);
  } catch {
    // a newer lock already took the name; the moved one's owner will find its lock gone
  } finally {
    fs.rmSync(aside, { force: true });
  }
}

export interface BuildCacheDeps {
  runner: Runner;
  env: Record<string, string>;
  /** The Mac's tar, which lists an archive's entries before it is stored. */
  tar: string;
  lock?: LockOptions;
}

export class BuildCache {
  readonly dir: string;

  constructor(
    globalStorage: string,
    private readonly hostPath: string,
    private readonly folderHostPath: string,
    private readonly d: BuildCacheDeps,
  ) {
    this.dir = folderCacheDir(globalStorage, hostPath, folderHostPath);
  }

  private readIndex(): CacheIndex {
    const empty = { hostPath: this.hostPath, folderHostPath: this.folderHostPath, entries: {} };
    try {
      const idx = readJsonFile(path.join(this.dir, "index.json")) as Partial<CacheIndex>;
      return idx && typeof idx.entries === "object" && idx.entries !== null
        ? { ...empty, entries: idx.entries }
        : empty;
    } catch {
      // no index yet, or an unreadable one: the cache starts empty
      return empty;
    }
  }

  private writeIndex(idx: CacheIndex): void {
    writeAtomic(path.join(this.dir, "index.json"), (tmp) =>
      fs.writeFileSync(tmp, JSON.stringify(idx), { mode: 0o600 }),
    );
  }

  /** The stored artifact for `key` and when it was built, or null. */
  lookup(key: string): { artifact: string; builtAt: number } | null {
    if (!KEY_RE.test(key)) return null;
    const entry = this.readIndex().entries[key];
    if (!entry || typeof entry.file !== "string" || typeof entry.builtAt !== "number") return null;
    const artifact = path.join(this.dir, path.basename(entry.file));
    return fs.existsSync(artifact) ? { artifact, builtAt: entry.builtAt } : null;
  }

  /**
   * Store an artifact under `key`, keeping the newest MAX_ENTRIES. Returns false for an archive
   * tar cannot list, one that embeds `main.jsbundle`, or when the index lock is not had in time.
   */
  async store(key: string, artifact: string, builtAt: number): Promise<boolean> {
    if (!KEY_RE.test(key)) return false;
    const listed = await this.d.runner.run(this.d.tar, ["-tzf", artifact], { env: this.d.env });
    if (listed.code !== 0) return false;
    const names = listed.stdout.split("\n").map((n) => n.replace(/\/+$/, ""));
    if (names.some((n) => path.posix.basename(n) === "main.jsbundle")) return false;

    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const o = this.d.lock ?? {};
    // The copy is inside the lock too, so a build that never gets it leaves no file behind.
    const stored = await withIndexLock(this.dir, o, async () => {
      const file = `${key}.tar.gz`;
      writeAtomic(path.join(this.dir, file), (tmp) => fs.copyFileSync(artifact, tmp));
      const idx = this.readIndex();
      await o.whileLocked?.();
      idx.entries[key] = { file, builtAt };
      const ranked = Object.entries(idx.entries).sort(([, a], [, b]) => b.builtAt - a.builtAt);
      for (const [old, entry] of ranked.slice(MAX_ENTRIES)) {
        delete idx.entries[old];
        fs.rmSync(path.join(this.dir, path.basename(entry.file)), { force: true });
      }
      this.writeIndex(idx);
      return true;
    });
    return stored === true;
  }
}
