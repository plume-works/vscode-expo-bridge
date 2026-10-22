import * as path from "node:path";
import { readJsonFile } from "./jsonfile";

const COMPARATOR_RE =
  /^(?:[<>]=?|=|~|\^)?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A semver version or range; refuses `file:`, git, URL, alias, and dist-tag specs. */
export function isVersionRange(spec: string): boolean {
  if (!spec.trim()) return false;
  return spec.split("||").every((set) => {
    const tokens = set
      .trim()
      .replace(/([<>]=?|=|~|\^)\s+/g, "$1")
      .split(/\s+/);
    if (tokens.length === 3 && tokens[1] === "-") tokens.splice(1, 1);
    return tokens.every((t) => COMPARATOR_RE.test(t));
  });
}

export class EasCliError extends Error {}

/**
 * The eas-cli version `build` runs through `bunx`: the workspace `package.json`'s
 * `devDependencies` or `dependencies` entry, else `latest`. Read as JSON only.
 */
export function easCliSpec(hostPath: string, fileExists: (p: string) => boolean): string {
  const pkgPath = path.join(hostPath, "package.json");
  if (!fileExists(pkgPath)) return "latest";
  let pkg: { devDependencies?: Record<string, unknown>; dependencies?: Record<string, unknown> };
  try {
    pkg = readJsonFile(pkgPath) as typeof pkg;
  } catch (e) {
    throw new EasCliError(`package.json: ${(e as Error).message}`);
  }
  const spec = pkg?.devDependencies?.["eas-cli"] ?? pkg?.dependencies?.["eas-cli"];
  if (spec === undefined) return "latest";
  if (typeof spec !== "string" || !isVersionRange(spec)) {
    throw new EasCliError("package.json pins eas-cli to a spec that is not a version range");
  }
  return spec;
}
