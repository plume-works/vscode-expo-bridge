import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecResult, Runner } from "../src/exec";
import { status, versionGte, type StatusDeps } from "../src/status";

let hostPath: string;

beforeEach(() => {
  hostPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-status-")));
});

afterEach(() => {
  fs.rmSync(hostPath, { recursive: true, force: true });
});

const BINS = "/opt/homebrew/bin";

function runnerFor(overrides: Record<string, ExecResult> = {}): Runner {
  const defaults: Record<string, ExecResult> = {
    node: { code: 0, stdout: "v20.0.0", stderr: "" },
    bun: { code: 0, stdout: "1.4.3", stderr: "" },
    "simctl list": {
      code: 0,
      stdout: JSON.stringify({ devices: { ios: [{ state: "Booted" }] } }),
      stderr: "",
    },
  };
  return {
    async run(file, args) {
      if (file.endsWith("/node")) return defaults.node;
      if (file.endsWith("/bun")) return overrides.bun ?? defaults.bun;
      if (file.endsWith("/xcrun") && args[0] === "simctl")
        return overrides.simctl ?? defaults["simctl list"];
      if (file.endsWith("/xcrun") && args[0] === "xcodebuild") {
        return overrides.xcodebuild ?? { code: 0, stdout: "Xcode 26.0", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

/** The default runner, except that `simctl list devices|runtimes` answer from `listing`. */
function simctlRunner(listing: { devices: unknown; runtimes: unknown[] }): Runner {
  const base = runnerFor();
  return {
    async run(file, args, opts) {
      if (file.endsWith("/xcrun") && args[0] === "simctl" && args[1] === "list") {
        const body =
          args[2] === "runtimes" ? { runtimes: listing.runtimes } : { devices: listing.devices };
        return { code: 0, stdout: JSON.stringify(body), stderr: "" };
      }
      return base.run(file, args, opts);
    },
  };
}

function deps(partial: Partial<StatusDeps> = {}): StatusDeps {
  const present = new Set(["xcrun", "pod", "fastlane", "node", "bun"].map((t) => `${BINS}/${t}`));
  return {
    platform: "darwin",
    hostPath,
    hostPathExists: true,
    trusted: true,
    hasToken: true,
    containerBunVersion: "1.4.0",
    env: { PATH: BINS },
    runner: runnerFor(),
    fileExists: (p) => present.has(p) || fs.existsSync(p),
    port8081Forwarded: true,
    ...partial,
  };
}

describe("versionGte", () => {
  test("compares dotted versions", () => {
    expect(versionGte("1.4.3", "1.4.0")).toBe(true);
    expect(versionGte("1.4.0", "1.4.3")).toBe(false);
    expect(versionGte("1.4.3", "1.4.3")).toBe(true);
    expect(versionGte("2.0.0", "1.9.9")).toBe(true);
  });
});

describe("availability", () => {
  test("unavailable on a non-Mac host", async () => {
    const r = await status(deps({ platform: "linux" }));
    expect(r.available).toBe(false);
    expect(r.checks.macHost.ok).toBe(false);
    expect(r.checks.xcode.ok).toBe(false); // tool checks skipped
  });

  test("unavailable when the host path does not exist", async () => {
    const r = await status(deps({ hostPathExists: false }));
    expect(r.available).toBe(false);
    expect(r.checks.hostPathExists.ok).toBe(false);
  });
});

describe("checks", () => {
  test("all green when everything is present", async () => {
    fs.writeFileSync(
      path.join(hostPath, "app.json"),
      JSON.stringify({ expo: { extra: { eas: { projectId: "abc" } } } }),
    );
    const r = await status(deps());
    expect(r.available).toBe(true);
    for (const [name, c] of Object.entries(r.checks)) {
      expect(c.ok, `${name} should be ok`).toBe(true);
    }
  });

  test("Command Line Tools without Xcode fail the Xcode check", async () => {
    const r = await status(
      deps({
        runner: runnerFor({
          xcodebuild: {
            code: 1,
            stdout: "",
            stderr: "xcode-select: error: tool 'xcodebuild' requires Xcode",
          },
        }),
      }),
    );
    expect(r.checks.xcode.ok).toBe(false);
  });

  test("each tool absence is reported", async () => {
    const r = await status(deps({ fileExists: () => false }));
    expect(r.checks.xcode.ok).toBe(false);
    expect(r.checks.cocoapods.ok).toBe(false);
    expect(r.checks.fastlane.ok).toBe(false);
  });

  test("a Mac bun older than the container's fails the bun check", async () => {
    const r = await status(
      deps({ runner: runnerFor({ bun: { code: 0, stdout: "1.3.10", stderr: "" } }) }),
    );
    expect(r.checks.bun.ok).toBe(false);
    expect(r.checks.bun.detail).toContain("older");
  });

  test("no booted simulator passes when one can be booted on demand", async () => {
    const r = await status(
      deps({
        runner: simctlRunner({
          devices: {},
          runtimes: [
            {
              identifier: "ios-26",
              name: "iOS 26.5",
              version: "26.5",
              isAvailable: true,
              supportedDeviceTypes: [
                { identifier: "i17", name: "iPhone 17", productFamily: "iPhone" },
              ],
            },
          ],
        }),
      }),
    );
    expect(r.checks.simulator.ok).toBe(true);
    expect(r.checks.simulator.detail).toContain("expo-bridge iPhone 17");
  });

  test("no iOS simulator runtime fails the simulator check", async () => {
    const r = await status(deps({ runner: simctlRunner({ devices: {}, runtimes: [] }) }));
    expect(r.checks.simulator.ok).toBe(false);
    expect(r.checks.simulator.detail).toContain("no available iOS simulator runtime");
  });

  test("missing projectId is reported", async () => {
    const r = await status(deps()); // no app.json written
    expect(r.checks.easProjectId.ok).toBe(false);
  });

  test("missing token and unforwarded port are reported", async () => {
    const r = await status(deps({ hasToken: false, port8081Forwarded: false }));
    expect(r.checks.expoToken.ok).toBe(false);
    expect(r.checks.port8081Forwarded.ok).toBe(false);
  });

  test("an untrusted workspace is reported", async () => {
    const r = await status(deps({ trusted: false }));
    expect(r.checks.workspaceTrusted.ok).toBe(false);
  });
});
