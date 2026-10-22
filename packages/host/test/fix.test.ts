import { describe, expect, test } from "bun:test";
import type { StatusResult } from "@plume-works/expo-bridge-protocol";
import { PROTOCOL_VERSION } from "@plume-works/expo-bridge-protocol";
import { fixSummary, planFixes } from "../src/fix";

function statusWith(
  overrides: Partial<Record<keyof StatusResult["checks"], boolean>>,
): StatusResult {
  const ok = (name: keyof StatusResult["checks"]) => ({ ok: overrides[name] ?? true });
  return {
    protocolVersion: PROTOCOL_VERSION,
    available: true,
    checks: {
      macHost: ok("macHost"),
      hostPathExists: ok("hostPathExists"),
      workspaceTrusted: ok("workspaceTrusted"),
      xcode: ok("xcode"),
      cocoapods: ok("cocoapods"),
      fastlane: ok("fastlane"),
      node: ok("node"),
      easCli: ok("easCli"),
      bun: ok("bun"),
      expoToken: ok("expoToken"),
      easProjectId: ok("easProjectId"),
      simulator: ok("simulator"),
      port8081Forwarded: ok("port8081Forwarded"),
    },
  };
}

describe("planFixes", () => {
  test("no steps when every tool check is green", () => {
    expect(planFixes(statusWith({}))).toEqual([]);
  });

  test("a Homebrew fix for each missing tool", () => {
    const steps = planFixes(
      statusWith({ cocoapods: false, fastlane: false, node: false, bun: false }),
    );
    const byCheck = Object.fromEntries(steps.map((s) => [s.check, s]));
    expect(byCheck.cocoapods?.commands).toEqual(["brew install cocoapods"]);
    expect(byCheck.fastlane?.commands).toEqual(["brew install fastlane"]);
    expect(byCheck.node?.commands).toEqual(["brew install node"]);
    expect(byCheck.bun?.commands[0]).toContain("bun");
  });

  test("Xcode is a guided step: opens the App Store then runs xcode-select", () => {
    const [step] = planFixes(statusWith({ xcode: false }));
    expect(step?.openUrl).toContain("apps.apple.com");
    expect(step?.commands).toEqual([
      "sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer",
      "sudo xcodebuild -license accept",
      "xcodebuild -downloadPlatform iOS",
    ]);
  });

  test("checks with no install remedy produce no step", () => {
    const steps = planFixes(
      statusWith({
        workspaceTrusted: false,
        expoToken: false,
        easProjectId: false,
        easCli: false,
        simulator: false,
        port8081Forwarded: false,
      }),
    );
    expect(steps).toEqual([]);
  });
});

describe("fixSummary", () => {
  test("nothing to fix shows nothing", () => {
    expect(fixSummary([])).toBeNull();
  });

  test("counts the fixes and puts each check's detail in the tooltip", () => {
    const s = statusWith({ bun: false, fastlane: false });
    s.checks.bun.detail = "Mac bun 1.4.3 is older than the container's 99.0.0";
    const summary = fixSummary(planFixes(s));
    expect(summary?.text).toBe("$(warning) Expo Bridge: 2 fixes");
    expect(summary?.tooltip).toContain("Install or update bun: Mac bun 1.4.3 is older");
    expect(summary?.text).not.toContain("missing");
  });
});
