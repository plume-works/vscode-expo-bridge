import * as fs from "node:fs";
import * as path from "node:path";
// The UMD build loads its modules at runtime, which the bundled extension cannot resolve.
import {
  findNodeAtLocation,
  getNodeValue,
  parseTree,
  type Node,
} from "jsonc-parser/lib/esm/main.js";

/** A span of a file, in characters from its start. */
export interface TextRange {
  offset: number;
  length: number;
}

export type EasJsonCheckCode = "simulatorProfile" | "rememberedProfile";

export interface EasJsonProblem {
  code: EasJsonCheckCode;
  message: string;
  /** Where the problem is, in the folder's `eas.json`. */
  range: TextRange;
}

export interface EasJson {
  text: string;
  root: Node | undefined;
}

/** The folder's `eas.json`, parsed; null when it does not exist. */
export function readEasJson(folder: string): EasJson | null {
  const file = path.join(folder, "eas.json");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  return { text, root: parseTree(text) };
}

type Profile = { extends?: unknown; ios?: { simulator?: unknown } };

function profilesOf(eas: EasJson): Record<string, Profile> {
  const build = eas.root && findNodeAtLocation(eas.root, ["build"]);
  const value = build ? (getNodeValue(build) as unknown) : undefined;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Profile>)
    : {};
}

/** The build profile names in `eas.json`, in file order. */
export function buildProfiles(eas: EasJson | null): string[] {
  return eas ? Object.keys(profilesOf(eas)) : [];
}

/** Whether `name` builds for the simulator, following its `extends` chain. */
function buildsForSimulator(profiles: Record<string, Profile>, name: string): boolean {
  const seen = new Set<string>();
  let current: string | undefined = name;
  while (current && !seen.has(current)) {
    seen.add(current);
    const profile: Profile | undefined = profiles[current];
    if (!profile) return false;
    if (profile.ios?.simulator !== undefined) return profile.ios.simulator === true;
    current = typeof profile.extends === "string" ? profile.extends : undefined;
  }
  return false;
}

/** The range diagnostics about the build profiles point at: the `build` key, else the root. */
export function buildRange(eas: EasJson): TextRange {
  const build = eas.root && findNodeAtLocation(eas.root, ["build"]);
  const key = build?.parent?.children?.[0];
  if (key) return { offset: key.offset, length: key.length };
  return { offset: 0, length: Math.min(1, eas.text.length) };
}

/**
 * The container's own checks on `eas.json`: a build profile that targets the simulator,
 * which every bridge build needs, and the panel's remembered profile still existing.
 */
export function easJsonChecks(
  eas: EasJson | null,
  rememberedProfile: string | undefined,
): EasJsonProblem[] {
  if (!eas) return [];
  const profiles = profilesOf(eas);
  const names = Object.keys(profiles);
  const range = buildRange(eas);
  const problems: EasJsonProblem[] = [];
  if (!names.some((n) => buildsForSimulator(profiles, n))) {
    problems.push({
      code: "simulatorProfile",
      message: "no build profile sets ios.simulator: true; the bridge builds for the simulator",
      range,
    });
  }
  if (rememberedProfile !== undefined && !names.includes(rememberedProfile)) {
    problems.push({
      code: "rememberedProfile",
      message: `the remembered build profile "${rememberedProfile}" is no longer in eas.json`,
      range,
    });
  }
  return problems;
}
