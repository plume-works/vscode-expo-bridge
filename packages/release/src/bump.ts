import * as fs from "node:fs";
import * as path from "node:path";

/** The extensions that ship together; they always carry the same version. */
export const EXTENSIONS = ["pack", "host", "workspace"];

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function bumpPatch(version: string): string {
  const m = SEMVER_RE.exec(version);
  if (!m) throw new Error(`not a major.minor.patch version: ${version}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** Set every extension to `next`, or to the next patch when omitted; returns the version. */
export function bump(root: string, next?: string): string {
  const files = EXTENSIONS.map((p) => path.join(root, "packages", p, "package.json"));
  const pkgs = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")) as { version: string });
  const versions = new Set(pkgs.map((p) => p.version));
  if (versions.size !== 1)
    throw new Error(`extension versions differ: ${[...versions].join(", ")}`);
  const version = next ?? bumpPatch(pkgs[0]!.version);
  if (!SEMVER_RE.test(version)) throw new Error(`not a major.minor.patch version: ${version}`);
  files.forEach((f, i) => {
    pkgs[i]!.version = version;
    fs.writeFileSync(f, JSON.stringify(pkgs[i], null, 2) + "\n");
  });
  return version;
}

if (import.meta.main) {
  console.log(bump(path.join(import.meta.dir, "..", "..", ".."), process.argv[2]));
}
