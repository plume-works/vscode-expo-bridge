import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { realRunner } from "../src/exec";
import {
  BuildCache,
  folderCacheDir,
  hostPathCacheDir,
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
