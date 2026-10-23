import * as path from "node:path";
import type { StatusCheck, StatusResult } from "@plume-works/expo-bridge-protocol";
import { PROTOCOL_VERSION } from "@plume-works/expo-bridge-protocol";
import type { Runner } from "./exec";
import { lookupTool } from "./env";
import { EasCliError, easCliSpec } from "./eascli";
import { readJsonFile } from "./jsonfile";
import { planBoot, SimulatorError } from "./simulator";

export interface StatusDeps {
  platform: string;
  hostPath: string;
  hostPathExists: boolean;
  trusted: boolean;
  hasToken: boolean;
  containerBunVersion?: string;
  env: Record<string, string>;
  runner: Runner;
  fileExists: (p: string) => boolean;
  port8081Forwarded: boolean;
}

/** Compare two dotted version strings; returns true when `a` >= `b`. */
export function versionGte(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

async function toolVersion(d: StatusDeps, tool: string, args: string[]): Promise<string | null> {
  const abs = lookupTool(tool, d.env, d.fileExists);
  if (!abs) return null;
  const r = await d.runner.run(abs, args, { env: d.env });
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * Report whether the bridge can serve a build. On a non-Mac host, or when the workspace
 * host path does not exist locally, `available` is false and the tool checks are skipped.
 */
export async function status(d: StatusDeps): Promise<StatusResult> {
  const macHost = d.platform === "darwin";
  const hostPathExists = d.hostPathExists;
  const available = macHost && hostPathExists;

  const base: StatusResult = {
    protocolVersion: PROTOCOL_VERSION,
    available,
    checks: {
      macHost: { ok: macHost, detail: macHost ? undefined : "host is not macOS" },
      hostPathExists: {
        ok: hostPathExists,
        detail: hostPathExists ? undefined : "workspace host path does not exist locally",
      },
      workspaceTrusted: {
        ok: d.trusted,
        detail: d.trusted ? undefined : "workspace is not trusted",
      },
      xcode: { ok: false },
      cocoapods: { ok: false },
      fastlane: { ok: false },
      node: { ok: false },
      easCli: { ok: false },
      bun: { ok: false },
      expoToken: { ok: d.hasToken, detail: d.hasToken ? undefined : "EXPO_TOKEN not set" },
      easProjectId: { ok: false },
      simulator: { ok: false },
      port8081Forwarded: {
        ok: d.port8081Forwarded,
        detail: d.port8081Forwarded ? undefined : "port 8081 is not forwarded",
      },
    },
  };

  if (!available) return base;

  // xcrun ships with the Command Line Tools too; only a full Xcode runs xcodebuild.
  base.checks.xcode = (await toolVersion(d, "xcrun", ["xcodebuild", "-version"]))
    ? { ok: true }
    : { ok: false, detail: "Xcode not found or not selected" };

  base.checks.cocoapods = lookupTool("pod", d.env, d.fileExists)
    ? { ok: true }
    : { ok: false, detail: "CocoaPods not found" };

  base.checks.fastlane = lookupTool("fastlane", d.env, d.fileExists)
    ? { ok: true }
    : { ok: false, detail: "fastlane not found" };

  const node = await toolVersion(d, "node", ["--version"]);
  base.checks.node = node ? { ok: true } : { ok: false, detail: "Node not found" };

  base.checks.easCli = easCliCheck(d);

  const hostBun = await toolVersion(d, "bun", ["--version"]);
  if (!hostBun) {
    base.checks.bun = { ok: false, detail: "bun not found on the Mac" };
  } else if (d.containerBunVersion && !versionGte(hostBun, d.containerBunVersion)) {
    base.checks.bun = {
      ok: false,
      detail: `Mac bun ${hostBun} is older than the container's ${d.containerBunVersion}`,
    };
  } else {
    base.checks.bun = { ok: true };
  }

  base.checks.easProjectId = readProjectId(d.hostPath, d.fileExists)
    ? { ok: true }
    : { ok: false, detail: "extra.eas.projectId not set in app.json" };

  base.checks.simulator = await simulatorCheck(d);

  return base;
}

/** Which eas-cli `build` would run; fails only on a spec that is not a version range. */
function easCliCheck(d: StatusDeps): StatusCheck {
  try {
    const spec = easCliSpec(d.hostPath, d.fileExists);
    return spec === "latest"
      ? { ok: true, detail: "eas-cli@latest (no cli.version in eas.json)" }
      : { ok: true, detail: `eas-cli@${spec}` };
  } catch (e) {
    if (e instanceof EasCliError) return { ok: false, detail: e.message };
    throw e;
  }
}

function readProjectId(hostPath: string, fileExists: (p: string) => boolean): boolean {
  const appJson = path.join(hostPath, "app.json");
  if (!fileExists(appJson)) return false;
  try {
    const parsed = readJsonFile(appJson) as { expo?: { extra?: { eas?: { projectId?: string } } } };
    return typeof parsed?.expo?.extra?.eas?.projectId === "string";
  } catch {
    return false;
  }
}

/** A booted simulator passes, and so does one the bridge can boot on demand. */
async function simulatorCheck(d: StatusDeps): Promise<StatusCheck> {
  const xcrun = lookupTool("xcrun", d.env, d.fileExists);
  if (!xcrun) return { ok: false, detail: "xcrun not found" };
  try {
    const plan = await planBoot((args) => d.runner.run(xcrun, ["simctl", ...args], { env: d.env }));
    if (plan.kind === "booted") return { ok: true };
    return { ok: true, detail: `none booted; the bridge boots ${plan.name} on demand` };
  } catch (e) {
    if (e instanceof SimulatorError) return { ok: false, detail: e.message };
    throw e;
  }
}
