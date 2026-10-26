import * as path from "node:path";
import { normalizeRange } from "@plume-works/expo-bridge-protocol";
import { readJsonFile } from "./jsonfile";

export { normalizeRange };

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
