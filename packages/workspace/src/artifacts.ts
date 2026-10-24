import * as fs from "node:fs";
import * as path from "node:path";
import { WRITE_DIR_REL, type ProtocolError, type Request } from "@plume-works/expo-bridge-protocol";
import type { CliRequest } from "./cli-args";
import { containingFolder } from "./registry";

/** Build logs and screenshots share the write directory with build artifacts. */
function isBuildArtifact(name: string): boolean {
  if (name.startsWith(".")) return false;
  if (name.startsWith("build-") && name.endsWith(".log")) return false;
  return !(name.startsWith("screenshot-") && name.endsWith(".png"));
}

/** Folder-relative path of the newest build artifact under `.tmp/expo-bridge/`, if any. */
export function newestArtifact(folder: string): string | null {
  const dir = path.join(folder, WRITE_DIR_REL);
  if (!fs.existsSync(dir)) return null;
  const newest = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isBuildArtifact(e.name))
    .map((e) => ({ name: e.name, m: fs.statSync(path.join(dir, e.name)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0];
  return newest ? path.join(WRITE_DIR_REL, newest.name) : null;
}

/**
 * Complete a CLI request into a protocol request for the window's workspace folder that
 * contains the CLI's directory, or say why it cannot be completed.
 */
export function resolveRequest(
  request: CliRequest,
  folders: readonly string[],
  real?: (p: string) => string,
): { request: Request } | { error: ProtocolError } {
  const { cwd, ...args } = request;
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    return { error: { code: "bad-request", message: "no working directory in the request" } };
  }
  const folder = containingFolder(folders, cwd, real);
  if (!folder) {
    return {
      error: {
        code: "unavailable",
        message: `${cwd} is outside every workspace folder of this window`,
      },
    };
  }
  if (args.action !== "install" || args.artifactRel)
    return { request: { ...args, folder } as Request };
  const artifactRel = newestArtifact(folder);
  if (!artifactRel) {
    return {
      error: {
        code: "not-found",
        message: `no build artifact under ${WRITE_DIR_REL}/; run eas-host build <profile> first`,
      },
    };
  }
  return { request: { action: "install", artifactRel, folder } };
}
