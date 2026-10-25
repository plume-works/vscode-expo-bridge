import * as path from "node:path";
import { lookupTool } from "./env";

/** Where Homebrew keeps installed formulae on an Apple silicon Mac. */
export const HOMEBREW_CELLAR = "/opt/homebrew/Cellar/";

/** The bun fix for the bun the check resolved, which is also the bun `build` runs. */
export interface BunFix {
  /** The first `bun` on the login PATH, or null when there is none. */
  path: string | null;
  /** Shell-neutral commands for the fix terminal; empty when the bridge cannot tell how. */
  commands: string[];
  /** Why there is no command, naming the path. */
  detail?: string;
}

/** The bun.sh installer's binary: `$BUN_INSTALL/bin/bun`, by default under `~/.bun`. */
function bunShBinary(env: Record<string, string>, home: string): string {
  return path.join(env.BUN_INSTALL || path.join(home, ".bun"), "bin", "bun");
}

/** Fish reads `'` and `\` inside single quotes differently from POSIX shells. */
function quotable(p: string): boolean {
  return !p.includes("'") && !p.includes("\\");
}

/**
 * Pick the fix for the first `bun` on the login PATH by where it came from: Homebrew
 * upgrades its own formula, a bun.sh install upgrades itself by absolute path, and any
 * other bun gets no command, since the bridge cannot tell what manages it.
 */
export function resolveBunFix(
  env: Record<string, string>,
  exists: (p: string) => boolean,
  realpath: (p: string) => string,
  home: string,
): BunFix {
  const resolved = lookupTool("bun", env, exists);
  if (!resolved) return { path: null, commands: ["brew install oven-sh/bun/bun"] };
  if (realpath(resolved).startsWith(HOMEBREW_CELLAR)) {
    return { path: resolved, commands: ["brew upgrade bun"] };
  }
  if (resolved === bunShBinary(env, home) && quotable(resolved)) {
    return { path: resolved, commands: [`'${resolved}' upgrade`] };
  }
  return {
    path: resolved,
    commands: [],
    detail: `${resolved} is not a Homebrew or bun.sh install; update it, or put a newer bun first on PATH`,
  };
}
