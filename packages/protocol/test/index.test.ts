import { describe, expect, test } from "bun:test";
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
