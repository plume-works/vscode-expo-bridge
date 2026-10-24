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

export interface BuildCacheDeps {
  runner: Runner;
  env: Record<string, string>;
  /** The Mac's tar, which lists an archive's entries before it is stored. */
  tar: string;
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
   * Store an artifact under `key`, keeping the newest MAX_ENTRIES. Refuses, returning false,
   * an archive tar cannot list or one that embeds a JavaScript bundle (`main.jsbundle`).
   */
  async store(key: string, artifact: string, builtAt: number): Promise<boolean> {
    if (!KEY_RE.test(key)) return false;
    const listed = await this.d.runner.run(this.d.tar, ["-tzf", artifact], { env: this.d.env });
    if (listed.code !== 0) return false;
    const names = listed.stdout.split("\n").map((n) => n.replace(/\/+$/, ""));
    if (names.some((n) => path.posix.basename(n) === "main.jsbundle")) return false;

    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = `${key}.tar.gz`;
    writeAtomic(path.join(this.dir, file), (tmp) => fs.copyFileSync(artifact, tmp));

    const idx = this.readIndex();
    idx.entries[key] = { file, builtAt };
    const ranked = Object.entries(idx.entries).sort(([, a], [, b]) => b.builtAt - a.builtAt);
    for (const [old, entry] of ranked.slice(MAX_ENTRIES)) {
      delete idx.entries[old];
      fs.rmSync(path.join(this.dir, path.basename(entry.file)), { force: true });
    }
    this.writeIndex(idx);
    return true;
  }
}
