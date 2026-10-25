import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { realRunner } from "../src/exec";
import {
  BuildCache,
  folderCacheDir,
  hostPathCacheDir,
  LOCK_STALE_MS,
  MAX_ENTRIES,
  remove,
} from "../src/buildcache";

const HOST = "/Users/me/repo";
const FOLDER = "/Users/me/repo/apps/mobile";
const key = (n: number) => n.toString(16).padStart(64, "0");

let storage: string;
let scratch: string;

beforeEach(() => {
  storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-cache-")));
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-art-")));
});

afterEach(() => {
  fs.rmSync(storage, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** A gzipped tar of an `App.app` holding the given files. */
function archive(name: string, files: string[]): string {
  const root = path.join(scratch, name);
  fs.mkdirSync(path.join(root, "App.app"), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(root, "App.app", f), name);
  const out = path.join(scratch, `${name}.tar.gz`);
  execFileSync("tar", ["-czf", out, "-C", root, "App.app"]);
  return out;
}

const cache = (host = HOST, folder = FOLDER) =>
  new BuildCache(storage, host, folder, {
    runner: realRunner,
    env: process.env as never,
    tar: "tar",
  });

describe("BuildCache", () => {
  test("a stored artifact is a hit with its build time; another key is a miss", async () => {
    const c = cache();
    expect(await c.store(key(1), archive("a", ["Info.plist"]), 1000)).toBe(true);
    const hit = c.lookup(key(1));
    expect(hit?.builtAt).toBe(1000);
    expect(fs.readFileSync(hit!.artifact)).toEqual(fs.readFileSync(path.join(scratch, "a.tar.gz")));
    expect(hit!.artifact.startsWith(c.dir + path.sep)).toBe(true);
    expect(c.lookup(key(2))).toBeNull();
    expect(cache().lookup(key(1))?.builtAt).toBe(1000);
  });

  test("index.json records both paths and each entry", async () => {
    const c = cache();
    await c.store(key(1), archive("a", ["Info.plist"]), 1000);
    const idx = JSON.parse(fs.readFileSync(path.join(c.dir, "index.json"), "utf8"));
    expect(idx).toEqual({
      hostPath: HOST,
      folderHostPath: FOLDER,
      entries: { [key(1)]: { file: `${key(1)}.tar.gz`, builtAt: 1000 } },
    });
    expect(fs.readdirSync(c.dir).sort()).toEqual([`${key(1)}.tar.gz`, "index.json"]);
  });

  test("refuses an archive that embeds main.jsbundle, and one tar cannot list", async () => {
    const c = cache();
    expect(await c.store(key(1), archive("rel", ["Info.plist", "main.jsbundle"]), 1)).toBe(false);
    const junk = path.join(scratch, "junk.tar.gz");
    fs.writeFileSync(junk, "not an archive");
    expect(await c.store(key(2), junk, 2)).toBe(false);
    expect(c.lookup(key(1))).toBeNull();
    expect(c.lookup(key(2))).toBeNull();
    expect(fs.existsSync(c.dir)).toBe(false);
  });

  test("keeps the newest entries and deletes the rest", async () => {
    const c = cache();
    const art = archive("a", ["Info.plist"]);
    // stored out of time order: eviction ranks by build time, not by store order
    const times = [5, 1, 7, 3, 6, 2, 4];
    for (const [i, t] of times.entries()) await c.store(key(i + 1), art, t);
    const kept = times
      .map((t, i) => ({ t, k: key(i + 1) }))
      .sort((a, b) => b.t - a.t)
      .slice(0, MAX_ENTRIES);
    for (const [i] of times.entries()) {
      const k = key(i + 1);
      expect(c.lookup(k) !== null).toBe(kept.some((e) => e.k === k));
    }
    const files = fs.readdirSync(c.dir).filter((f) => f.endsWith(".tar.gz"));
    expect(files.sort()).toEqual(kept.map((e) => `${e.k}.tar.gz`).sort());
  });

  test("leaves no temporary file behind", async () => {
    const c = cache();
    await c.store(key(1), archive("a", ["Info.plist"]), 1);
    expect(fs.readdirSync(c.dir).some((f) => f.includes(".tmp-"))).toBe(false);
  });

  test("a key that is not a SHA-256 digest is never stored or looked up", async () => {
    const c = cache();
    expect(await c.store("../evil", archive("a", ["Info.plist"]), 1)).toBe(false);
    expect(c.lookup("../evil")).toBeNull();
  });

  test("two host paths, or two folders under one host path, never share a directory", async () => {
    const dirs = [
      folderCacheDir(storage, HOST, FOLDER),
      folderCacheDir(storage, "/Users/me/other", FOLDER),
      folderCacheDir(storage, HOST, "/Users/me/repo/apps/web"),
      folderCacheDir(storage, HOST, HOST),
    ];
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(dirs[2]!.startsWith(hostPathCacheDir(storage, HOST) + path.sep)).toBe(true);

    await cache().store(key(1), archive("a", ["Info.plist"]), 1);
    expect(cache("/Users/me/other").lookup(key(1))).toBeNull();
    expect(cache(HOST, "/Users/me/repo/apps/web").lookup(key(1))).toBeNull();
  });

  test("remove deletes every folder's cache under the host path, and only those", async () => {
    const art = archive("a", ["Info.plist"]);
    await cache(HOST, FOLDER).store(key(1), art, 1);
    await cache(HOST, "/Users/me/repo/apps/web").store(key(1), art, 1);
    await cache("/Users/me/other", FOLDER).store(key(1), art, 1);
    remove(storage, HOST);
    expect(fs.existsSync(hostPathCacheDir(storage, HOST))).toBe(false);
    expect(cache(HOST, FOLDER).lookup(key(1))).toBeNull();
    expect(cache("/Users/me/other", FOLDER).lookup(key(1))).not.toBeNull();
  });
});

describe("the index lock", () => {
  const CHILD = path.join(import.meta.dir, "fixtures", "store-child.ts");

  /** Run one store in a separate bun process; resolves with its stdout. */
  function storeInProcess(k: string, builtAt: number, art: string, holdMs = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        CHILD,
        storage,
        HOST,
        FOLDER,
        k,
        String(builtAt),
        art,
        String(holdMs),
      ]);
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(out))));
    });
  }

  const lockPath = () => path.join(cache().dir, "index.lock");
  const holdLock = (pid: number, ageMs = 0) => {
    fs.mkdirSync(cache().dir, { recursive: true });
    fs.writeFileSync(lockPath(), String(pid));
    const t = (Date.now() - ageMs) / 1000;
    fs.utimesSync(lockPath(), t, t);
  };

  test("two processes storing in one folder at once keep both entries", async () => {
    const art = archive("a", ["Info.plist"]);
    // the first holds the lock between reading and writing the index, so an unlocked
    // second store would read the empty index and one write would drop the other's entry
    const first = storeInProcess(key(1), 1, art, 600);
    await new Promise((r) => setTimeout(r, 300));
    const second = storeInProcess(key(2), 2, art);
    expect(await Promise.all([first, second])).toEqual(["stored", "stored"]);
    expect(cache().lookup(key(1))).not.toBeNull();
    expect(cache().lookup(key(2))).not.toBeNull();
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  test("takes over a lock whose owner process is gone", async () => {
    const dead = spawnSync("true").pid!;
    holdLock(dead);
    expect(await cache().store(key(1), archive("a", ["Info.plist"]), 1)).toBe(true);
    expect(cache().lookup(key(1))).not.toBeNull();
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  test("takes over an expired lock even when its owner still runs", async () => {
    holdLock(process.pid, LOCK_STALE_MS + 1000);
    expect(await cache().store(key(1), archive("a", ["Info.plist"]), 1)).toBe(true);
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  test("stores nothing when a live lock outlasts the wait, and leaves that lock alone", async () => {
    holdLock(process.pid);
    const c = new BuildCache(storage, HOST, FOLDER, {
      runner: realRunner,
      env: { PATH: process.env.PATH ?? "" },
      tar: "tar",
      lock: { waitMs: 150, retryMs: 20 },
    });
    expect(await c.store(key(1), archive("a", ["Info.plist"]), 1)).toBe(false);
    expect(c.lookup(key(1))).toBeNull();
    expect(fs.readdirSync(c.dir).sort()).toEqual(["index.lock"]);
    expect(fs.readFileSync(lockPath(), "utf8")).toBe(String(process.pid));
  });

  test("removes the lock when the index update fails", async () => {
    const c = cache();
    // a non-empty directory where index.json goes makes its rename fail
    fs.mkdirSync(path.join(c.dir, "index.json", "x"), { recursive: true });
    await expect(c.store(key(1), archive("a", ["Info.plist"]), 1)).rejects.toThrow();
    expect(fs.existsSync(lockPath())).toBe(false);
  });
});
