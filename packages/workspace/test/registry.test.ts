import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { RegistryEntry } from "@plume-works/expo-bridge-protocol";
import {
  containingFolder,
  ensureRegistryDir,
  entryPath,
  isAlive,
  liveEntries,
  pruneStale,
  removeOwn,
  selectEntry,
  socketPath,
  writeEntry,
} from "../src/registry";

let dir: string;

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-registry-")), "reg");
  ensureRegistryDir(dir);
});

afterEach(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));

const entry = (pid: number, folders: string[], activatedAt = 1): RegistryEntry => ({
  pid,
  activatedAt,
  folders,
});

describe("the registry files", () => {
  test("the directory is private to the user", () => {
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  test("an entry written is read back while its process lives", () => {
    writeEntry(dir, "a", entry(process.pid, ["/workspaces/app"]));
    expect(liveEntries(dir)).toEqual([{ id: "a", entry: entry(process.pid, ["/workspaces/app"]) }]);
  });

  test("rewriting an entry replaces it", () => {
    writeEntry(dir, "a", entry(process.pid, ["/workspaces/app"]));
    writeEntry(dir, "a", entry(process.pid, ["/workspaces/app", "/workspaces/other"]));
    expect(liveEntries(dir)[0]!.entry.folders).toEqual(["/workspaces/app", "/workspaces/other"]);
    expect(fs.readdirSync(dir)).toEqual(["a.json"]);
  });

  test("removeOwn removes only its own socket and entry", () => {
    for (const id of ["a", "b"]) {
      writeEntry(dir, id, entry(process.pid, ["/w"]));
      fs.writeFileSync(socketPath(dir, id), "");
    }
    removeOwn(dir, "a");
    expect(fs.readdirSync(dir).sort()).toEqual(["b.json", "b.sock"]);
  });

  test("pruneStale removes a dead window's files and keeps a live one's", () => {
    writeEntry(dir, "dead", entry(111, ["/w"]));
    fs.writeFileSync(socketPath(dir, "dead"), "");
    writeEntry(dir, "live", entry(222, ["/w"]));
    fs.writeFileSync(socketPath(dir, "live"), "");
    pruneStale(dir, (pid) => pid === 222);
    expect(fs.readdirSync(dir).sort()).toEqual(["live.json", "live.sock"]);
  });

  test("an entry owned by another user, or malformed, is ignored", () => {
    writeEntry(dir, "a", entry(process.pid, ["/w"]));
    fs.writeFileSync(entryPath(dir, "bad"), "{not json");
    expect(liveEntries(dir, () => true, process.getuid!() + 1)).toEqual([]);
    expect(liveEntries(dir).map((r) => r.id)).toEqual(["a"]);
  });

  test("a missing directory has no entries", () => {
    expect(liveEntries(path.join(dir, "absent"))).toEqual([]);
  });

  test("isAlive tells a running process from a gone one", () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(2 ** 22 + 12345)).toBe(false);
  });
});

describe("containingFolder", () => {
  const id = (p: string) => p;

  test("the longest folder containing the directory, by whole components", () => {
    const folders = ["/workspaces/repo", "/workspaces/repo/apps/mobile", "/workspaces/repo2"];
    expect(containingFolder(folders, "/workspaces/repo/apps/mobile/src", id)).toBe(
      "/workspaces/repo/apps/mobile",
    );
    expect(containingFolder(folders, "/workspaces/repo/apps", id)).toBe("/workspaces/repo");
    expect(containingFolder(folders, "/workspaces/repo2", id)).toBe("/workspaces/repo2");
    expect(containingFolder(folders, "/workspaces/repo3", id)).toBeNull();
  });

  test("compares real paths and returns the folder as given", () => {
    const real = (p: string) => p.replace("/link", "/real");
    expect(containingFolder(["/link/app"], "/real/app/src", real)).toBe("/link/app");
  });
});

describe("selectEntry", () => {
  const id = (p: string) => p;
  const reg = (name: string, folders: string[], at: number) => ({
    id: name,
    entry: entry(1, folders, at),
  });

  test("the window with the longest containing folder wins", () => {
    const root = reg("root", ["/workspaces/repo"], 2);
    const app = reg("app", ["/workspaces/repo/app"], 1);
    expect(selectEntry([root, app], "/workspaces/repo/app/src", id)?.id).toBe("app");
    expect(selectEntry([root, app], "/workspaces/repo/docs", id)?.id).toBe("root");
  });

  test("the most recently activated wins a tie", () => {
    const older = reg("older", ["/workspaces/app"], 1);
    const newer = reg("newer", ["/workspaces/app"], 2);
    expect(selectEntry([newer, older], "/workspaces/app", id)?.id).toBe("newer");
    expect(selectEntry([older, newer], "/workspaces/app", id)?.id).toBe("newer");
  });

  test("null when no window has a folder containing the directory", () => {
    expect(selectEntry([reg("a", ["/workspaces/app"], 1)], "/home/me", id)).toBeNull();
  });
});
