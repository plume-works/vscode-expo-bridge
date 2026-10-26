import type { StatusResult } from "@plume-works/expo-bridge-protocol";
import type { EasJsonCheckCode } from "./easjson";

export type CheckKey = keyof StatusResult["checks"];

/** Every check the workspace UI shows: the status checks and the container's own. */
export type CheckCode = CheckKey | EasJsonCheckCode;

export type Severity = "error" | "warning" | "info";

export type Section = "connection" | "macTools" | "project" | "trust" | "simulator";

export interface CheckInfo {
  label: string;
  section: Section;
  severity: Severity;
}

export const AVAILABILITY_CHECKS = ["macHost", "hostPathExists", "workspaceMapped"] as const;

export const CHECKS: Record<CheckCode, CheckInfo> = {
  macHost: { label: "Mac host", section: "connection", severity: "info" },
  hostPathExists: { label: "Workspace on the Mac", section: "connection", severity: "info" },
  workspaceMapped: { label: "Folder mapped to the Mac", section: "connection", severity: "info" },
  xcode: { label: "Xcode", section: "macTools", severity: "error" },
  cocoapods: { label: "CocoaPods", section: "macTools", severity: "error" },
  fastlane: { label: "fastlane", section: "macTools", severity: "error" },
  node: { label: "Node", section: "macTools", severity: "error" },
  bun: { label: "bun", section: "macTools", severity: "error" },
  easCli: { label: "eas-cli", section: "project", severity: "error" },
  easProjectId: { label: "EAS project ID", section: "project", severity: "error" },
  simulatorProfile: { label: "Simulator build profile", section: "project", severity: "error" },
  rememberedProfile: { label: "Remembered build profile", section: "project", severity: "warning" },
  workspaceTrusted: { label: "Workspace trusted", section: "trust", severity: "warning" },
  expoToken: { label: "EXPO_TOKEN", section: "trust", severity: "warning" },
  simulator: { label: "Simulator", section: "simulator", severity: "info" },
  port8081Forwarded: { label: "Port 8081 (Metro)", section: "simulator", severity: "info" },
};

export const SECTIONS: { id: Section; label: string }[] = [
  { id: "connection", label: "Connection" },
  { id: "macTools", label: "Mac tools" },
  { id: "project", label: "Project" },
  { id: "trust", label: "Trust & token" },
  { id: "simulator", label: "Simulator" },
];

/** The Mac tool checks the host's own fix flow can repair. */
export const MAC_TOOL_CHECKS: readonly CheckKey[] = [
  "xcode",
  "cocoapods",
  "fastlane",
  "node",
  "bun",
];

/** The availability check that made `status` unavailable, if any. */
export function failingAvailability(result: StatusResult): CheckKey | undefined {
  if (result.available) return undefined;
  return AVAILABILITY_CHECKS.find((k) => !result.checks[k].ok) ?? "workspaceMapped";
}

/** A status check the host ran and failed; a skipped check of an unavailable status is not. */
export function failingChecks(result: StatusResult): CheckKey[] {
  const unavailable = failingAvailability(result);
  if (unavailable) return [unavailable];
  return (Object.keys(CHECKS) as CheckCode[]).filter(
    (k): k is CheckKey => k in result.checks && !result.checks[k as CheckKey].ok,
  );
}
