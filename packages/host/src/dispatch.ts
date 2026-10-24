import type { Request, Response, Result } from "@plume-works/expo-bridge-protocol";
import { isAction } from "@plume-works/expo-bridge-protocol";
import { build, BuildError } from "./build";
import { ActionError, install, launch, screenshot } from "./install";
import { status } from "./status";
import type { BuildDeps } from "./build";
import type { FolderMapping } from "./folder";
import type { SimContext } from "./install";
import type { StatusDeps } from "./status";

/**
 * Everything a single dispatch needs, assembled per request by the extension from the
 * resolved host path, the trust store, the login env, and the system probes. The handler
 * treats every request as possibly the container's, so trust and the build confirmation
 * are enforced here regardless of which extension sent it.
 */
export interface DispatchDeps {
  /** Resolve the window's own host path; null when it cannot be resolved (then: unavailable). */
  hostPath: string | null;
  /** Map the request's folder to the Mac path the action uses, or say why it cannot. */
  mapFolder: (folder: string) => Promise<FolderMapping>;
  statusDeps: (
    req: Extract<Request, { action: "status" }>,
    folder: FolderMapping,
  ) => Promise<StatusDeps>;
  /** Gate trust + the build confirmation, naming where the build runs; false when declined. */
  confirmBuild: (profile: string, folderHostPath: string) => Promise<boolean>;
  /** Gate trust alone, for the non-build actions. */
  ensureTrusted: () => Promise<boolean>;
  buildDeps: (folderHostPath: string) => Promise<BuildDeps>;
  simContext: (folderHostPath: string) => SimContext;
}

function ok(result: Result): Response {
  return { ok: true, result };
}

export async function dispatch(request: unknown, deps: DispatchDeps): Promise<Response> {
  if (
    typeof request !== "object" ||
    request === null ||
    !isAction((request as { action?: unknown }).action)
  ) {
    return { ok: false, error: { code: "bad-request", message: "unknown or missing action" } };
  }
  const req = request as Request;
  if (typeof req.folder !== "string" || !req.folder.startsWith("/")) {
    return { ok: false, error: { code: "bad-request", message: "no workspace folder" } };
  }

  try {
    // The folder is mapped before any action; an unmapped folder never falls back.
    const folder: FolderMapping =
      deps.hostPath === null
        ? { ok: false, detail: "no resolvable host path" }
        : await deps.mapFolder(req.folder);

    if (req.action === "status") {
      const sd = await deps.statusDeps(req, folder);
      // The first request from a workspace asks for trust, and status is usually first.
      if (sd.platform === "darwin" && sd.hostPathExists && folder.ok && !sd.trusted) {
        sd.trusted = await deps.ensureTrusted();
      }
      return ok(await status(sd));
    }

    if (!folder.ok) {
      return { ok: false, error: { code: "unavailable", message: folder.detail } };
    }
    const at = folder.folderHostPath;

    if (req.action === "build") {
      if (!(await deps.confirmBuild(req.profile, at))) {
        return { ok: false, error: { code: "build-declined", message: "build not confirmed" } };
      }
      return ok(await build(req.profile, await deps.buildDeps(at)));
    }

    if (!(await deps.ensureTrusted())) {
      return { ok: false, error: { code: "untrusted", message: "workspace is not trusted" } };
    }

    switch (req.action) {
      case "install":
        return ok(await install(req.artifactRel, deps.simContext(at)));
      case "launch":
        return ok(await launch(deps.simContext(at)));
      case "screenshot":
        return ok(await screenshot(deps.simContext(at)));
    }
  } catch (e) {
    if (e instanceof BuildError || e instanceof ActionError) {
      return { ok: false, error: e.error };
    }
    return { ok: false, error: { code: "action-failed", message: "the action failed" } };
  }
}
