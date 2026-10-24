import { describe, expect, test } from "bun:test";
import type { ExecResult, Runner } from "../src/exec";
import { FINGERPRINT_SCRIPT, projectFingerprint } from "../src/fingerprint";

const BINS = "/opt/homebrew/bin";
const HASH = "0123456789abcdef0123456789abcdef01234567";
const FOLDER = "/Users/me/repo/apps/mobile";

interface Call {
  file: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

function runner(result: ExecResult, calls: Call[] = []): Runner {
  return {
    async run(file, args, opts) {
      calls.push({ file, args, cwd: opts?.cwd, env: opts?.env });
      return result;
    },
  };
}

const deps = (r: Runner, hasNode = true) => ({
  env: { PATH: BINS },
  runner: r,
  fileExists: (p: string) => hasNode && p === `${BINS}/node`,
});

describe("projectFingerprint", () => {
  test("returns the hash the script prints", async () => {
    const r = runner({ code: 0, stdout: `${HASH}\n`, stderr: "warning" });
    expect(await projectFingerprint(FOLDER, deps(r))).toBe(HASH);
  });

  test("runs the module's script with node, the folder as argument and cwd", async () => {
    const calls: Call[] = [];
    await projectFingerprint(FOLDER, deps(runner({ code: 0, stdout: HASH, stderr: "" }, calls)));
    expect(calls).toEqual([
      {
        file: `${BINS}/node`,
        args: ["-e", FINGERPRINT_SCRIPT, FOLDER],
        cwd: FOLDER,
        env: { PATH: BINS },
      },
    ]);
    expect(FINGERPRINT_SCRIPT).toContain('"expo/fingerprint"');
    expect(FINGERPRINT_SCRIPT).toContain('platforms: ["ios"]');
  });

  test("null without node, and nothing runs", async () => {
    const calls: Call[] = [];
    const r = runner({ code: 0, stdout: HASH, stderr: "" }, calls);
    expect(await projectFingerprint(FOLDER, deps(r, false))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("null on a non-zero exit, even with a hash on stdout", async () => {
    const r = runner({ code: 1, stdout: HASH, stderr: "Cannot find module 'expo/fingerprint'" });
    expect(await projectFingerprint(FOLDER, deps(r))).toBeNull();
  });

  test("null for any output that is not one lowercase 40-digit hex hash", async () => {
    for (const stdout of [
      "",
      HASH.toUpperCase(),
      HASH.slice(1),
      `${HASH}0`,
      `log line\n${HASH}\n`,
      `${HASH}\n${HASH}\n`,
      ` ${HASH}`,
      "zz23456789abcdef0123456789abcdef01234567",
    ]) {
      expect(await projectFingerprint(FOLDER, deps(runner({ code: 0, stdout, stderr: "" })))).toBe(
        null,
      );
    }
  });
});
