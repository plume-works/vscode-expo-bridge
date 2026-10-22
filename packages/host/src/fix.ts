import type { StatusResult } from "@plume-works/expo-bridge-protocol";

export interface FixStep {
  /** Which failing status check this fixes. */
  check: keyof StatusResult["checks"];
  label: string;
  /** A guided step opens a URL and waits for the user before the commands run. */
  openUrl?: string;
  /** Shell commands run in a visible local terminal, in order. */
  commands: string[];
}

/**
 * Map each failing status check that a tool install resolves to a fix step. A fix is only
 * ever started by the user's click — no protocol action reaches this. Checks with no
 * install remedy (trust, token, projectId, simulator, port forwarding, host path,
 * Mac host) produce no step.
 */
export function planFixes(status: StatusResult): FixStep[] {
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
      commands: ["brew install oven-sh/bun/bun"],
    });
  }
  return steps;
}
