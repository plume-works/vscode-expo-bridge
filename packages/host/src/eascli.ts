import * as path from "node:path";
import { readJsonFile } from "./jsonfile";

const COMPARATOR_RE =
  /^(?:[<>]=?|=|~|\^)?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * A semver version or range with the spaces after its operators removed, so it reads as
 * one `bunx` spec; null for `file:`, git, URL, alias, and dist-tag specs.
 */
export function normalizeRange(spec: string): string | null {
  if (!spec.trim()) return null;
  const sets = spec.split("||").map((set) => {
    const tokens = set
      .trim()
      .replace(/([<>]=?|=|~|\^)\s+/g, "$1")
      .split(/\s+/);
    const comparators =
      tokens.length === 3 && tokens[1] === "-" ? [tokens[0]!, tokens[2]!] : tokens;
    return comparators.every((t) => COMPARATOR_RE.test(t)) ? tokens.join(" ") : null;
  });
  return sets.every((set) => set !== null) ? sets.join(" || ") : null;
}

export class EasCliError extends Error {}

/**
 * The eas-cli version `build` runs through `bunx`: `cli.version` in the folder's
 * `eas.json`, Expo's own pin for the CLI, else `latest`. Read as JSON only.
 */
export function easCliSpec(folderHostPath: string, fileExists: (p: string) => boolean): string {
  const easJsonPath = path.join(folderHostPath, "eas.json");
  if (!fileExists(easJsonPath)) return "latest";
  let easJson: { cli?: { version?: unknown } };
  try {
    easJson = readJsonFile(easJsonPath) as typeof easJson;
  } catch (e) {
    throw new EasCliError(`eas.json: ${(e as Error).message}`);
  }
  const version = easJson?.cli?.version;
  if (version === undefined) return "latest";
  const spec = typeof version === "string" ? normalizeRange(version) : null;
  if (!spec) throw new EasCliError("eas.json cli.version is not a version range");
  return spec;
}
