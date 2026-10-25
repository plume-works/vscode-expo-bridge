import { describe, expect, test } from "bun:test";
import { containerBunVersion, HELP, isHelp, parseArgs, UsageError } from "../src/cli-args";

describe("parseArgs", () => {
  test("status, with the container bun version attached", () => {
    expect(parseArgs(["status"], "1.4.3")).toEqual({
      action: "status",
      containerBunVersion: "1.4.3",
    });
  });

  test("status without a version omits the field", () => {
    expect(parseArgs(["status"])).toEqual({ action: "status" });
  });

  test("build requires a profile", () => {
    expect(parseArgs(["build", "development"])).toEqual({
      action: "build",
      profile: "development",
    });
    expect(() => parseArgs(["build"])).toThrow(UsageError);
  });

  test("build --clean asks for a clean build; without it the field is absent", () => {
    expect(parseArgs(["build", "development", "--clean"])).toEqual({
      action: "build",
      profile: "development",
      clean: true,
    });
    expect("clean" in parseArgs(["build", "development"])).toBe(false);
  });

  test("build rejects any other argument after the profile", () => {
    for (const argv of [
      ["build", "development", "--force"],
      ["build", "development", "extra"],
      ["build", "development", "--clean", "--clean"],
      ["build", "--clean"],
    ]) {
      expect(() => parseArgs(argv)).toThrow(UsageError);
    }
  });

  test("install takes an optional path", () => {
    expect(parseArgs(["install", ".tmp/expo-bridge/a.tar.gz"])).toEqual({
      action: "install",
      artifactRel: ".tmp/expo-bridge/a.tar.gz",
    });
    expect(parseArgs(["install"])).toEqual({ action: "install" });
  });

  test("launch and screenshot take no argument", () => {
    expect(parseArgs(["launch"])).toEqual({ action: "launch" });
    expect(parseArgs(["screenshot"])).toEqual({ action: "screenshot" });
  });

  test("an unknown action is a usage error", () => {
    expect(() => parseArgs(["deploy"])).toThrow(UsageError);
    expect(() => parseArgs([])).toThrow(UsageError);
  });
});

describe("help", () => {
  test("help, --help, and -h ask for it; an action does not", () => {
    for (const flag of ["help", "--help", "-h"]) expect(isHelp([flag])).toBe(true);
    expect(isHelp(["status"])).toBe(false);
    expect(isHelp([])).toBe(false);
  });

  test("states the action order, the artifact location, and the Metro step", () => {
    const order = ["status", "build <profile>", "install [path]", "launch", "screenshot"].map((a) =>
      HELP.indexOf(`  eas-host ${a}`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(HELP).toContain("artifactRel");
    expect(HELP).toContain(".tmp/expo-bridge/");
    expect(HELP).toContain("newest build artifact");
    expect(HELP).toContain("bunx expo start --dev-client --localhost --port 8081");
    expect(HELP).toContain("Run it inside the Expo app's workspace folder");
    expect(HELP).toContain("build <profile> [--clean]");
    expect(HELP).toContain("reuses an earlier artifact when the native");
    expect(HELP).toContain("--clean forces a full build");
  });
});

describe("containerBunVersion", () => {
  test("asks the container's bun even when the CLI runs under node", () => {
    const calls: string[][] = [];
    const v = containerBunVersion((file, args) => {
      calls.push([file, ...args]);
      return "1.4.3\n";
    });
    expect(v).toBe("1.4.3");
    expect(calls).toEqual([["bun", "--version"]]);
  });

  test("undefined when bun is not installed", () => {
    expect(
      containerBunVersion(() => {
        throw Object.assign(new Error("spawn bun ENOENT"), { code: "ENOENT" });
      }),
    ).toBeUndefined();
  });
});
