import { lookupTool } from "./env";

/** The shell the fix terminal launches, as `createTerminal` options. */
export interface FixShell {
  shellPath: string;
  shellArgs?: string[];
  env?: Record<string, string | null>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve one profile path candidate on the Mac, or null when it cannot be used. */
function resolveCandidate(
  candidate: unknown,
  env: Record<string, string>,
  exists: (p: string) => boolean,
): string | null {
  if (typeof candidate !== "string" || candidate === "" || candidate.includes("${")) return null;
  if (candidate.startsWith("/")) return exists(candidate) ? candidate : null;
  if (candidate.includes("/")) return null;
  return lookupTool(candidate, env, exists);
}

/**
 * The fix terminal's shell: the Mac's default terminal profile resolved on the Mac, else the
 * login shell with `-l`. An explicit shell path keeps VS Code from resolving the profile name
 * against the container's detected profiles.
 */
export function fixTerminalShell(
  defaultProfile: unknown,
  profiles: unknown,
  env: Record<string, string>,
  exists: (p: string) => boolean,
  loginShell: string,
): FixShell {
  const fallback: FixShell = { shellPath: loginShell, shellArgs: ["-l"] };
  if (typeof defaultProfile !== "string" || defaultProfile === "" || !isObject(profiles)) {
    return fallback;
  }
  const profile = profiles[defaultProfile];
  if (!isObject(profile) || "source" in profile || profile.path === undefined) return fallback;

  const candidates = Array.isArray(profile.path) ? profile.path : [profile.path];
  let shellPath: string | null = null;
  for (const candidate of candidates) {
    shellPath = resolveCandidate(candidate, env, exists);
    if (shellPath) break;
  }
  if (!shellPath) return fallback;

  const shell: FixShell = { shellPath };
  const { args, env: profileEnv } = profile;
  if (Array.isArray(args) && args.every((a) => typeof a === "string")) shell.shellArgs = args;
  if (isObject(profileEnv)) shell.env = profileEnv as Record<string, string | null>;
  return shell;
}
