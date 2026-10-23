import * as path from "node:path";
import { SEMVER_RE, sharedVersion } from "./bump";

export type Channel = "pre-release" | "release";

/** VS Code's convention: an odd minor is a pre-release, an even minor a release. */
export function channelOf(version: string): Channel {
  const m = SEMVER_RE.exec(version);
  if (!m) throw new Error(`not a major.minor.patch version: ${version}`);
  return Number(m[2]) % 2 === 1 ? "pre-release" : "release";
}

/** Check that `tag` is `v` plus the extensions' shared version; returns it and its channel. */
export function checkTag(root: string, tag: string): { version: string; channel: Channel } {
  const version = sharedVersion(root);
  if (tag !== `v${version}`)
    throw new Error(`tag ${tag} does not match the extensions' version ${version}`);
  return { version, channel: channelOf(version) };
}

if (import.meta.main) {
  console.log(
    checkTag(path.join(import.meta.dir, "..", "..", ".."), process.argv[2] ?? "").channel,
  );
}
