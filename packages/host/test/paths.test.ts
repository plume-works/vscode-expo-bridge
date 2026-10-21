import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  openFreshWrite,
  O_NOFOLLOW_ANY,
  PathError,
  requireUnderWriteDir,
  resolveWithin,
} from "../src/paths";

let root: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-paths-")));
  fs.mkdirSync(path.join(root, ".tmp", "expo-bridge"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("resolveWithin", () => {
  test("resolves a real path inside the workspace", () => {
    const f = path.join(root, ".tmp", "expo-bridge", "a.txt");
    fs.writeFileSync(f, "x");
    expect(resolveWithin(root, ".tmp/expo-bridge/a.txt")).toBe(f);
  });

  test("rejects an absolute path", () => {
    expect(() => resolveWithin(root, "/etc/passwd")).toThrow(PathError);
  });

  test("rejects a '..' escape", () => {
    expect(() => resolveWithin(root, "../outside")).toThrow(/escapes/);
  });

  test("rejects a symlinked component", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    fs.symlinkSync(outside, path.join(root, "link"));
    fs.writeFileSync(path.join(outside, "secret"), "s");
    try {
      expect(() => resolveWithin(root, "link/secret")).toThrow(/symlink/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test("reports not-found for a missing component", () => {
    try {
      resolveWithin(root, "nope/here");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as PathError).code).toBe("not-found");
    }
  });
});

describe("requireUnderWriteDir", () => {
  test("accepts a path under .tmp/expo-bridge", () => {
    const f = path.join(root, ".tmp", "expo-bridge", "art.tar.gz");
    fs.writeFileSync(f, "x");
    expect(requireUnderWriteDir(root, ".tmp/expo-bridge/art.tar.gz")).toBe(f);
  });

  test("rejects a path elsewhere in the workspace", () => {
    fs.writeFileSync(path.join(root, "eas.json"), "{}");
    try {
      requireUnderWriteDir(root, "eas.json");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as PathError).code).toBe("path-escape");
    }
  });
});

describe("openFreshWrite", () => {
  test("passes O_CREAT | O_EXCL | O_NOFOLLOW_ANY and the write flag", () => {
    let seenFlags = 0;
    const fd = openFreshWrite(path.join(root, ".tmp", "expo-bridge", "fresh"), {
      open: (_p, flags) => {
        seenFlags = flags;
        return 42;
      },
    });
    expect(fd).toBe(42);
    expect(seenFlags & fs.constants.O_CREAT).toBeTruthy();
    expect(seenFlags & fs.constants.O_EXCL).toBeTruthy();
    expect(seenFlags & O_NOFOLLOW_ANY).toBeTruthy();
    expect(seenFlags & fs.constants.O_WRONLY).toBeTruthy();
  });

  test("a real fresh create succeeds and a second create fails (O_EXCL)", () => {
    const f = path.join(root, ".tmp", "expo-bridge", "once");
    fs.closeSync(openFreshWrite(f));
    expect(() => openFreshWrite(f)).toThrow();
  });
});
