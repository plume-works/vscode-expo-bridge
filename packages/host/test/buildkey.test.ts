import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { ExecResult, Runner } from "../src/exec";
import { buildKey, LOCKFILES, MAX_HASHED_BYTES, type BuildKeyDeps } from "../src/buildkey";

const BINS = "/opt/homebrew/bin";
const BUN = `${BINS}/bun`;
const XCODEBUILD = "/usr/bin/xcodebuild";
const FP = "0123456789abcdef0123456789abcdef01234567";

let folder: string;

beforeEach(() => {
  folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-key-")));
  fs.writeFileSync(path.join(folder, "eas.json"), '{"build":{"development":{}}}');
  fs.writeFileSync(path.join(folder, "package.json"), '{"name":"app"}');
  fs.writeFileSync(path.join(folder, "bun.lock"), "lock");
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

interface Versions {
  easCli?: ExecResult;
  xcode?: ExecResult;
}

function runner(v: Versions = {}, calls: string[][] = []): Runner {
  return {
    async run(file, args) {
      calls.push([file, ...args]);
      if (file === BUN) return v.easCli ?? { code: 0, stdout: "eas-cli/25.3.0\n", stderr: "" };
      if (file === XCODEBUILD) {
        return v.xcode ?? { code: 0, stdout: "Xcode 27.0\nBuild version 27A1\n", stderr: "" };
      }
      return { code: 127, stdout: "", stderr: "" };
    },
  };
}

function deps(partial: Partial<BuildKeyDeps> = {}): BuildKeyDeps {
  return {
    env: { PATH: `${BINS}:/usr/bin` },
    runner: runner(),
    fileExists: (p) => p === XCODEBUILD,
    bun: BUN,
    easCliSpec: "latest",
    hostVersion: "0.3.0",
    ...partial,
  };
}

const key = (d: BuildKeyDeps = deps(), fp = FP, profile = "development") =>
  buildKey(folder, fp, profile, d);

describe("buildKey", () => {
  test("is a stable SHA-256 hex digest", async () => {
    const k = await key();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(await key()).toBe(k!);
  });

  test("probes the eas-cli build runs and xcodebuild", async () => {
    const calls: string[][] = [];
    await key(deps({ runner: runner({}, calls), easCliSpec: ">=16.0.0" }));
    expect(calls).toEqual([
      [BUN, "x", "eas-cli@>=16.0.0", "--version"],
      [XCODEBUILD, "-version"],
    ]);
  });

  test("a change in each input changes the key", async () => {
    const base = await key();
    const changed: (string | null)[] = [
      await key(deps(), "f".repeat(40)),
      await key(deps(), FP, "preview"),
      await key(deps({ hostVersion: "0.3.1" })),
      await key(
        deps({ runner: runner({ easCli: { code: 0, stdout: "eas-cli/25.4.0", stderr: "" } }) }),
      ),
      await key(deps({ runner: runner({ xcode: { code: 0, stdout: "Xcode 27.1", stderr: "" } }) })),
    ];
    for (const name of ["eas.json", "package.json", ...LOCKFILES]) {
      const p = path.join(folder, name);
      const before = fs.existsSync(p) ? fs.readFileSync(p) : null;
      fs.writeFileSync(p, `changed ${name}`);
      changed.push(await key());
      if (before === null) fs.rmSync(p);
      else fs.writeFileSync(p, before);
    }
    expect(await key()).toBe(base!);
    expect(changed.every((k) => k !== null && k !== base)).toBe(true);
    expect(new Set(changed).size).toBe(changed.length);
  });

  test("an absent lockfile is allowed and differs from a present one", async () => {
    const withLock = await key();
    fs.rmSync(path.join(folder, "bun.lock"));
    const without = await key();
    expect(without).toMatch(/^[0-9a-f]{64}$/);
    expect(without).not.toBe(withLock!);
  });

  test("null without package.json or eas.json", async () => {
    fs.rmSync(path.join(folder, "package.json"));
    expect(await key()).toBeNull();
    fs.writeFileSync(path.join(folder, "package.json"), "{}");
    fs.rmSync(path.join(folder, "eas.json"));
    expect(await key()).toBeNull();
  });

  test("null for a symlinked file", async () => {
    const outside = path.join(folder, "..", `${path.basename(folder)}-outside.lock`);
    fs.writeFileSync(outside, "lock");
    try {
      fs.rmSync(path.join(folder, "bun.lock"));
      fs.symlinkSync(outside, path.join(folder, "bun.lock"));
      expect(await key()).toBeNull();
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test("null for a non-regular file", async () => {
    fs.mkdirSync(path.join(folder, "yarn.lock"));
    expect(await key()).toBeNull();
    fs.rmSync(path.join(folder, "yarn.lock"), { recursive: true });
    execFileSync("mkfifo", [path.join(folder, "pnpm-lock.yaml")]);
    expect(await key()).toBeNull();
  });

  test("null for a file over the size limit", async () => {
    fs.truncateSync(path.join(folder, "bun.lock"), MAX_HASHED_BYTES + 1);
    expect(await key()).toBeNull();
  });

  test("null when a version probe fails", async () => {
    const fail = { code: 1, stdout: "", stderr: "boom" };
    expect(await key(deps({ runner: runner({ easCli: fail }) }))).toBeNull();
    expect(
      await key(deps({ runner: runner({ easCli: { code: 0, stdout: "  \n", stderr: "" } }) })),
    ).toBeNull();
    expect(await key(deps({ runner: runner({ xcode: fail }) }))).toBeNull();
    expect(await key(deps({ fileExists: () => false }))).toBeNull();
  });
});
