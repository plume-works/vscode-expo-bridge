import type { BuildResult } from "@plume-works/expo-bridge-protocol";
import type { RequestOutcome } from "./requests";

/** The `workspaceState` key of a folder's remembered build profile. */
export function profileKey(folder: string): string {
  return `expoBridge.buildProfile:${folder}`;
}

/** The host commands the panel runs; each asks for its own consent on the Mac. */
export const HOST_COMMANDS = {
  fix: "expoBridge.fix",
  setToken: "expoBridge.setToken",
  manageTrust: "expoBridge.manageTrust",
} as const;

/** What a finished build reports: the notification text and whether it is an error. */
export function buildMessage(
  profile: string,
  outcome: RequestOutcome,
): { text: string; error: boolean } {
  if (outcome.hostMissing) {
    return { text: "Expo Bridge: the Mac half is not installed in this window.", error: true };
  }
  const { response } = outcome;
  if (!response.ok) {
    return { text: `Expo Bridge: build ${profile} failed: ${response.error.message}`, error: true };
  }
  const r = response.result as BuildResult;
  if (r.exitCode !== 0) {
    return {
      text: `Expo Bridge: build ${profile} exited ${r.exitCode}; see ${r.logRel}`,
      error: true,
    };
  }
  const how =
    r.mode === "reused" ? "reused an earlier build" : r.reason ? `built (${r.reason})` : "built";
  return { text: `Expo Bridge: ${profile} ${how}: ${r.artifactRel}`, error: false };
}
