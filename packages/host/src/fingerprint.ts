import type { Runner } from "./exec";
import { lookupTool } from "./env";

/**
 * Run by the Mac's node with the folder's Mac path as its argument: loads the project's own
 * `expo/fingerprint`, as eas-cli does inside every build, and prints the iOS hash.
 */
export const FINGERPRINT_SCRIPT = `
const path = require("node:path");
const { createRequire } = require("node:module");
const root = process.argv[1];
const { createFingerprintAsync } = createRequire(path.join(root, "package.json"))("expo/fingerprint");
createFingerprintAsync(root, { platforms: ["ios"] }).then(
  (f) => process.stdout.write(f.hash + "\\n"),
  () => process.exit(1),
);
`;

const HASH_RE = /^[0-9a-f]{40}$/;

export interface FingerprintDeps {
  env: Record<string, string>;
  runner: Runner;
  fileExists: (p: string) => boolean;
}

/**
 * The project's `@expo/fingerprint` hash for iOS, or null when node is missing, the script
 * fails, or it prints anything but one hash. Only a confirmed build may call this: the
 * script evaluates project code. Its output never reaches an error or the caller.
 */
export async function projectFingerprint(
  folderHostPath: string,
  d: FingerprintDeps,
): Promise<string | null> {
  const node = lookupTool("node", d.env, d.fileExists);
  if (!node) return null;
  const r = await d.runner.run(node, ["-e", FINGERPRINT_SCRIPT, folderHostPath], {
    env: d.env,
    cwd: folderHostPath,
  });
  if (r.code !== 0) return null;
  const out = r.stdout.endsWith("\n") ? r.stdout.slice(0, -1) : r.stdout;
  return HASH_RE.test(out) ? out : null;
}
