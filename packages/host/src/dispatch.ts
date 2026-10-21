import type { Request, Response, Result } from "@plume-works/expo-bridge-protocol";
import { isAction } from "@plume-works/expo-bridge-protocol";
import { build, BuildError } from "./build";
import { ActionError, install, launch, screenshot } from "./install";
import { status } from "./status";
import type { BuildDeps } from "./build";
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
  statusDeps: (req: Extract<Request, { action: "status" }>) => Promise<StatusDeps>;
  /** Gate trust + the build confirmation; returns false when declined. */
  confirmBuild: (profile: string) => Promise<boolean>;
  /** Gate trust alone, for the non-build actions. */
  ensureTrusted: () => Promise<boolean>;
  buildDeps: () => Promise<BuildDeps>;
  simContext: () => SimContext;
}

function ok(result: Result): Response {
  return { ok: true, result };
}

export async function dispatch(request: unknown, deps: DispatchDeps): Promise<Response> {
  if (typeof request !== "object" || request === null || !isAction((request as { action?: unknown }).action)) {
    return { ok: false, error: { code: "bad-request", message: "unknown or missing action" } };
  }
  const req = request as Request;

  try {
    if (req.action === "status") {
      return ok(await status(await deps.statusDeps(req)));
    }

    if (deps.hostPath === null) {
      return { ok: false, error: { code: "unavailable", message: "no resolvable host path" } };
    }

    if (req.action === "build") {
      if (!(await deps.confirmBuild(req.profile))) {
        return { ok: false, error: { code: "build-declined", message: "build not confirmed" } };
      }
      return ok(await build(req.profile, await deps.buildDeps()));
    }

    if (!(await deps.ensureTrusted())) {
      return { ok: false, error: { code: "untrusted", message: "workspace is not trusted" } };
    }

    switch (req.action) {
      case "install":
        return ok(await install(req.artifactRel, deps.simContext()));
      case "launch":
        return ok(await launch(deps.simContext()));
      case "screenshot":
        return ok(await screenshot(deps.simContext()));
    }
  } catch (e) {
    if (e instanceof BuildError || e instanceof ActionError) {
      return { ok: false, error: e.error };
    }
    return { ok: false, error: { code: "action-failed", message: "the action failed" } };
  }
}
