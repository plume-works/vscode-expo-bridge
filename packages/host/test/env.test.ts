import { describe, expect, test } from "bun:test";
import { captureLoginEnv, lookupTool, parseEnv0, withHomebrewPath } from "../src/env";

describe("parseEnv0", () => {
  test("parses a NUL-separated dump", () => {
    const env = parseEnv0("PATH=/usr/bin\0HOME=/Users/me\0");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/Users/me");
  });

  test("keeps values that contain '='", () => {
    expect(parseEnv0("K=a=b\0").K).toBe("a=b");
  });

  test("ignores entries with no key", () => {
    expect(parseEnv0("=novalue\0OK=1\0")).toEqual({ OK: "1" });
  });
});

describe("withHomebrewPath", () => {
  test("prepends both Homebrew prefixes", () => {
    expect(withHomebrewPath({ PATH: "/usr/bin" }).PATH).toBe(
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin",
    );
  });

  test("does not duplicate a prefix already present", () => {
    expect(withHomebrewPath({ PATH: "/usr/local/bin:/usr/bin" }).PATH).toBe(
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin",
    );
  });

  test("handles a missing PATH", () => {
    expect(withHomebrewPath({}).PATH).toBe("/opt/homebrew/bin:/usr/local/bin");
  });
});

describe("captureLoginEnv", () => {
  test("works for a fish login shell (env -0 output)", async () => {
    const fakeRun = (async () => ({
      stdout: Buffer.from("PATH=/opt/fish/bin\0FOO=bar\0"),
      stderr: Buffer.from(""),
    })) as never;
    const env = await captureLoginEnv("/opt/homebrew/bin/fish", fakeRun);
    expect(env.FOO).toBe("bar");
    expect(env.PATH.startsWith("/opt/homebrew/bin:/usr/local/bin:/opt/fish/bin")).toBe(true);
  });

  test("works for a POSIX login shell", async () => {
    const fakeRun = (async (shell: string, args: string[]) => {
      expect(args).toEqual(["-l", "-c", "env -0"]);
      return { stdout: Buffer.from("PATH=/bin\0"), stderr: Buffer.from("") };
    }) as never;
    const env = await captureLoginEnv("/bin/bash", fakeRun);
    expect(env.PATH).toContain("/bin");
  });
});

describe("lookupTool", () => {
  const env = { PATH: "/opt/homebrew/bin:/usr/bin" };
  test("finds a tool on the PATH", () => {
    expect(lookupTool("xcrun", env, (p) => p === "/usr/bin/xcrun")).toBe("/usr/bin/xcrun");
  });
  test("searches Homebrew first", () => {
    expect(lookupTool("pod", env, (p) => p === "/opt/homebrew/bin/pod")).toBe(
      "/opt/homebrew/bin/pod",
    );
  });
  test("returns null when absent", () => {
    expect(lookupTool("ghost", env, () => false)).toBeNull();
  });
});
