import { describe, expect, test } from "bun:test";
import type { BuildRequest, BuildResult } from "../src/index";
import { isAction, parseRegistryEntry, PROTOCOL_VERSION, SOCKET_DIR } from "../src/index";

describe("protocol", () => {
  test("is version 2, served from a socket directory", () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(SOCKET_DIR).toBe("/tmp/vscode-expo-bridge");
  });

  test("isAction accepts exactly the five actions", () => {
    for (const a of ["status", "build", "install", "launch", "screenshot"]) {
      expect(isAction(a)).toBe(true);
    }
    expect(isAction("deploy")).toBe(false);
    expect(isAction(undefined)).toBe(false);
  });
});

describe("build reuse fields", () => {
  test("a build request may ask for a clean build", () => {
    const req: BuildRequest = { action: "build", folder: "/w", profile: "dev", clean: true };
    expect(req.clean).toBe(true);
    const plain: BuildRequest = { action: "build", folder: "/w", profile: "dev" };
    expect(plain.clean).toBeUndefined();
  });

  test("a build result carries its mode, reason, and the reused build's time", () => {
    const base = { artifactRel: ".tmp/expo-bridge/a.tar.gz", logRel: "", exitCode: 0 };
    const reused: BuildResult = { ...base, mode: "reused", reusedBuiltAt: 1000 };
    const built: BuildResult[] = (["clean-requested", "no-fingerprint", "no-match"] as const).map(
      (reason) => ({ ...base, mode: "built", reason }),
    );
    expect(reused.reusedBuiltAt).toBe(1000);
    expect(built.map((b) => b.reason)).toEqual(["clean-requested", "no-fingerprint", "no-match"]);
    // A result from a host without reuse has none of the fields.
    const legacy: BuildResult = base;
    expect(legacy.mode).toBeUndefined();
    // @ts-expect-error an unknown mode is not a BuildResult
    const bad: BuildResult = { ...base, mode: "cached" };
    void bad;
  });
});

describe("parseRegistryEntry", () => {
  const entry = { pid: 42, activatedAt: 1000, folders: ["/workspaces/app"] };

  test("accepts an entry's shape and drops extra fields", () => {
    expect(parseRegistryEntry({ ...entry, extra: true })).toEqual(entry);
  });

  test("rejects anything else", () => {
    for (const bad of [
      null,
      "x",
      { ...entry, pid: 0 },
      { ...entry, pid: 1.5 },
      { ...entry, activatedAt: "1" },
      { ...entry, folders: "/workspaces/app" },
      { ...entry, folders: [1] },
    ]) {
      expect(parseRegistryEntry(bad)).toBeNull();
    }
  });
});
