import * as fs from "node:fs";
import * as path from "node:path";
import { WRITE_DIR_REL, type ProtocolError, type Request } from "@plume-works/expo-bridge-protocol";
import type { CliRequest } from "./cli-args";

/** Build logs and screenshots share the write directory with build artifacts. */
function isBuildArtifact(name: string): boolean {
  if (name.startsWith(".")) return false;
  if (name.startsWith("build-") && name.endsWith(".log")) return false;
  return !(name.startsWith("screenshot-") && name.endsWith(".png"));
}

/** Workspace-relative path of the newest build artifact under `.tmp/expo-bridge/`, if any. */
export function newestArtifact(workspaceRoot: string): string | null {
  const dir = path.join(workspaceRoot, WRITE_DIR_REL);
  if (!fs.existsSync(dir)) return null;
  const newest = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isBuildArtifact(e.name))
    .map((e) => ({ name: e.name, m: fs.statSync(path.join(dir, e.name)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0];
  return newest ? path.join(WRITE_DIR_REL, newest.name) : null;
}

/** Complete a CLI request into a protocol request, or say why it cannot be completed. */
export function resolveRequest(
  request: CliRequest,
  workspaceRoot: string | undefined,
): { request: Request } | { error: ProtocolError } {
  if (request.action !== "install" || request.artifactRel) return { request: request as Request };
  const artifactRel = workspaceRoot ? newestArtifact(workspaceRoot) : null;
  if (!artifactRel) {
    return {
      error: {
        code: "not-found",
        message: `no build artifact under ${WRITE_DIR_REL}/; run eas-host build <profile> first`,
      },
    };
  }
  return { request: { action: "install", artifactRel } };
}
