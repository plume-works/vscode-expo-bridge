import type { StatusResult } from "@plume-works/expo-bridge-protocol";
import type { BunFix } from "./bunfix";

export interface FixStep {
  /** Which failing status check this fixes. */
  check: keyof StatusResult["checks"];
  label: string;
  /** Why the check failed, from `status`. */
  detail?: string;
  /** A guided step opens a URL and waits for the user before the commands run. */
  openUrl?: string;
  /** Shell commands run in a visible local terminal, in order; empty when there is none. */
  commands: string[];
}

/**
 * Map each failing status check that a tool install resolves to a fix step. A fix is only
 * ever started by the user's click — no protocol action reaches this. Checks with no
 * install remedy (trust, token, projectId, simulator, port forwarding, host path,
 * Mac host) produce no step. `bun` is the host's resolution of the bun the check ran.
 */
export function planFixes(status: StatusResult, bun?: BunFix): FixStep[] {
  const steps: FixStep[] = [];
  const c = status.checks;

  if (!c.xcode.ok) {
    steps.push({
      check: "xcode",
      label: "Install Xcode and the iOS platform",
      openUrl: "https://apps.apple.com/app/xcode/id497799835",
      commands: [
        "sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer",
        "sudo xcodebuild -license accept",
        "xcodebuild -downloadPlatform iOS",
      ],
    });
  }
  if (!c.cocoapods.ok) {
    steps.push({
      check: "cocoapods",
      label: "Install CocoaPods",
      commands: ["brew install cocoapods"],
    });
  }
  if (!c.fastlane.ok) {
    steps.push({
      check: "fastlane",
      label: "Install fastlane",
      commands: ["brew install fastlane"],
    });
  }
  if (!c.node.ok) {
    steps.push({ check: "node", label: "Install Node", commands: ["brew install node"] });
  }
  if (!c.bun.ok) {
    steps.push({
      check: "bun",
      label: "Install or update bun",
      commands: bun?.commands ?? ["brew install oven-sh/bun/bun"],
      detail: bun?.detail,
    });
  }
  return steps.map((s) => ({ ...s, detail: joinDetails(c[s.check].detail, s.detail) }));
}

function joinDetails(...details: (string | undefined)[]): string | undefined {
  const present = details.filter((d) => d);
  return present.length ? present.join("; ") : undefined;
}

/** The status bar text and tooltip for pending fixes; null when there is nothing to fix. */
export function fixSummary(steps: FixStep[]): { text: string; tooltip: string } | null {
  if (!steps.length) return null;
  const n = steps.length;
  return {
    text: `$(warning) Expo Bridge: ${n} fix${n === 1 ? "" : "es"}`,
    tooltip: steps.map((s) => (s.detail ? `${s.label}: ${s.detail}` : s.label)).join("\n"),
  };
}

/** Announces each new set of failing checks once, so repeated status calls do not re-notify. */
export class FixNotices {
  private last = "";

  /** The notification text when `steps` differ from the last announced set, else null. */
  next(steps: FixStep[]): string | null {
    const key = steps
      .map((s) => s.check)
      .sort()
      .join(",");
    if (key === this.last) return null;
    this.last = key;
    if (!steps.length) return null;
    const what = steps.map((s) => (s.detail ? `${s.label} (${s.detail})` : s.label));
    return `Expo Bridge: ${what.join("; ")}.`;
  }
}
