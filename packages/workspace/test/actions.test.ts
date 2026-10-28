import { describe, expect, test } from "bun:test";
import type { BuildResult } from "@plume-works/expo-bridge-protocol";
import { buildMessage, HOST_COMMANDS, plainLogLine, profileKey } from "../src/actions";

const built = (result: BuildResult) => ({
  response: { ok: true as const, result },
  hostMissing: false,
});

describe("buildMessage", () => {
  test("names the artifact and how it was produced", () => {
    const base = { artifactRel: ".tmp/expo-bridge/app.tar.gz", logRel: "l.log", exitCode: 0 };
    expect(buildMessage("development", built({ ...base, mode: "reused" }))).toEqual({
      text: "Expo Bridge: development reused an earlier build: .tmp/expo-bridge/app.tar.gz",
      error: false,
    });
    expect(
      buildMessage("development", built({ ...base, mode: "built", reason: "no-match" })).text,
    ).toBe("Expo Bridge: development built (no-match): .tmp/expo-bridge/app.tar.gz");
  });

  test("reports a non-zero exit with its log", () => {
    const outcome = built({
      artifactRel: "",
      logRel: ".tmp/expo-bridge/build-1.log",
      exitCode: 65,
    });
    expect(buildMessage("development", outcome)).toEqual({
      text: "Expo Bridge: build development exited 65; see .tmp/expo-bridge/build-1.log",
      error: true,
    });
  });

  test("reports a refused build and a missing host", () => {
    const declined = {
      response: {
        ok: false as const,
        error: { code: "build-declined" as const, message: "build not confirmed" },
      },
      hostMissing: false,
    };
    expect(buildMessage("p", declined)).toEqual({
      text: "Expo Bridge: build p failed: build not confirmed",
      error: true,
    });
    expect(buildMessage("p", { ...declined, hostMissing: true }).text).toContain("not installed");
  });
});

describe("profileKey", () => {
  test("is per folder", () => {
    expect(profileKey("/a")).not.toBe(profileKey("/b"));
  });
});

describe("HOST_COMMANDS", () => {
  test("names the host's existing consent-bearing commands", () => {
    expect(Object.values(HOST_COMMANDS)).toEqual([
      "expoBridge.fix",
      "expoBridge.setToken",
      "expoBridge.manageTrust",
    ]);
  });
});

describe("plainLogLine", () => {
  test("drops colour codes, keeping the text", () => {
    expect(plainLogLine("[INSTALL_PODS] \x1b[36m\x1b[1m[Codegen]\x1b[0m Analyzing /tmp/x")).toBe(
      "[INSTALL_PODS] [Codegen] Analyzing /tmp/x",
    );
  });

  test("drops cursor moves, OSC titles and links, and a trailing carriage return", () => {
    expect(plainLogLine("\x1b[2K\x1b[1Gdone\r")).toBe("done");
    expect(plainLogLine("\x1b]0;title\x07a\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\")).toBe(
      "alink",
    );
  });

  test("leaves a plain line alone", () => {
    expect(plainLogLine("expo-bridge: clean build requested")).toBe(
      "expo-bridge: clean build requested",
    );
  });
});
