import { describe, expect, test } from "bun:test";
import type { StatusResult } from "@plume-works/expo-bridge-protocol";
import { PROTOCOL_VERSION } from "@plume-works/expo-bridge-protocol";
import { FixNotices, fixSummary, noCommandMessage, planFixes } from "../src/fix";

function statusWith(
  overrides: Partial<Record<keyof StatusResult["checks"], boolean>>,
): StatusResult {
  const ok = (name: keyof StatusResult["checks"]) => ({ ok: overrides[name] ?? true });
  return {
    protocolVersion: PROTOCOL_VERSION,
    available: true,
    folderHostPath: "/Users/me/app",
    checks: {
      macHost: ok("macHost"),
      hostPathExists: ok("hostPathExists"),
      workspaceMapped: ok("workspaceMapped"),
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

  test("the bun step runs the host's command for the bun the check ran", () => {
    const s = statusWith({ bun: false });
    s.checks.bun.detail = "Mac bun 1.4.3 is older than the container's 1.4.4";
    const cases: [string | null, string[]][] = [
      [null, ["brew install oven-sh/bun/bun"]],
      ["/opt/homebrew/bin/bun", ["brew upgrade bun"]],
      ["/Users/me/.bun/bin/bun", ["'/Users/me/.bun/bin/bun' upgrade"]],
    ];
    for (const [path, commands] of cases) {
      const [step] = planFixes(s, { path, commands });
      expect(step?.commands).toEqual(commands);
      expect(step?.detail).toBe("Mac bun 1.4.3 is older than the container's 1.4.4");
    }
  });

  test("a bun of unknown origin is a step with no command and the host's detail", () => {
    const s = statusWith({ bun: false });
    s.checks.bun.detail = "Mac bun 1.4.3 is older than the container's 1.4.4";
    const [step] = planFixes(s, {
      path: "/Users/me/.local/share/mise/shims/bun",
      commands: [],
      detail: "/Users/me/.local/share/mise/shims/bun is not a Homebrew or bun.sh install",
    });
    expect(step?.commands).toEqual([]);
    expect(step?.detail).toBe(
      "Mac bun 1.4.3 is older than the container's 1.4.4; " +
        "/Users/me/.local/share/mise/shims/bun is not a Homebrew or bun.sh install",
    );
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

describe("noCommandMessage", () => {
  test("a step with no command shows its detail instead of a terminal", () => {
    const [step] = planFixes(statusWith({ bun: false }), {
      path: "/Users/me/.local/share/mise/shims/bun",
      commands: [],
      detail: "/Users/me/.local/share/mise/shims/bun is not a Homebrew or bun.sh install",
    });
    expect(noCommandMessage(step!)).toBe(
      "Expo Bridge: /Users/me/.local/share/mise/shims/bun is not a Homebrew or bun.sh install.",
    );
  });

  test("a step with commands opens a terminal", () => {
    const [step] = planFixes(statusWith({ bun: false }));
    expect(noCommandMessage(step!)).toBeNull();
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

describe("FixNotices", () => {
  test("announces a new set of failing checks once, with each detail", () => {
    const notices = new FixNotices();
    const s = statusWith({ bun: false });
    s.checks.bun.detail = "Mac bun 1.4.3 is older than the container's 99.0.0";
    const steps = planFixes(s);
    expect(notices.next(steps)).toBe(
      "Expo Bridge: Install or update bun (Mac bun 1.4.3 is older than the container's 99.0.0).",
    );
    expect(notices.next(steps)).toBeNull();
  });

  test("announces again when the set changes, and after it clears and returns", () => {
    const notices = new FixNotices();
    const bun = planFixes(statusWith({ bun: false }));
    const both = planFixes(statusWith({ bun: false, fastlane: false }));
    expect(notices.next(bun)).not.toBeNull();
    expect(notices.next(both)).toContain("Install fastlane");
    expect(notices.next([])).toBeNull();
    expect(notices.next(bun)).not.toBeNull();
  });
});
