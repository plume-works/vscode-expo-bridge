import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Runner } from "./exec";
import { lookupTool } from "./env";
import { rejectSymlinksBelow } from "./paths";

/** A file hashed into the key is refused past this size, so a huge file cannot stall a build. */
export const MAX_HASHED_BYTES = 64 * 1024 * 1024;

/** Lockfiles the key covers when present; the fingerprint leaves them out. */
export const LOCKFILES = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
] as const;

export interface BuildKeyDeps {
  env: Record<string, string>;
  runner: Runner;
  fileExists: (p: string) => boolean;
  /** The Mac's bun, which runs `eas-cli@<spec>` for the build. */
  bun: string;
  easCliSpec: string;
  /** The host extension's own version. */
  hostVersion: string;
}

/** The SHA-256 of a file in the folder, null when absent, or "refused" past the file rules. */
function hashFile(folderHostPath: string, name: string): string | null | "refused" {
  const abs = path.join(folderHostPath, name);
  try {
    fs.lstatSync(abs);
  } catch {
    return null;
  }
  try {
    rejectSymlinksBelow(folderHostPath, abs);
    // O_NONBLOCK so a FIFO fails fast via fstat; O_NOFOLLOW so a swapped-in symlink fails.
    const fd = fs.openSync(
      abs,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > MAX_HASHED_BYTES) return "refused";
      return createHash("sha256").update(fs.readFileSync(fd)).digest("hex");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "refused";
  }
}

/** A version command's trimmed stdout, or null when it is missing, fails, or prints nothing. */
async function probe(
  file: string | null,
  args: string[],
  cwd: string,
  d: BuildKeyDeps,
): Promise<string | null> {
  if (!file) return null;
  const r = await d.runner.run(file, args, { env: d.env, cwd });
  const out = r.stdout.trim();
  return r.code === 0 && out ? out : null;
}

/**
 * The cache key of a build: the SHA-256 of a record naming the fingerprint and every input
 * the fingerprint leaves out. Null when a file is refused, `eas.json` or `package.json` is
 * missing, or a version probe fails; the build then runs in full.
 */
export async function buildKey(
  folderHostPath: string,
  fingerprint: string,
  profile: string,
  d: BuildKeyDeps,
): Promise<string | null> {
  const files: Record<string, string | null> = {};
  for (const name of ["eas.json", "package.json", ...LOCKFILES]) {
    const hash = hashFile(folderHostPath, name);
    if (hash === "refused") return null;
    files[name] = hash;
  }
  if (files["eas.json"] === null || files["package.json"] === null) return null;

  const easCli = await probe(
    d.bun,
    ["x", `eas-cli@${d.easCliSpec}`, "--version"],
    folderHostPath,
    d,
  );
  if (!easCli) return null;
  const xcodebuild = lookupTool("xcodebuild", d.env, d.fileExists);
  const xcode = await probe(xcodebuild, ["-version"], folderHostPath, d);
  if (!xcode) return null;

  const record = { fingerprint, profile, files, easCli, xcode, hostVersion: d.hostVersion };
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}
