import * as path from "node:path";
import { lookupTool } from "./env";
import type { Runner } from "./exec";
import { versionGte } from "./status";
import type { Memento } from "./trust";

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

/** A bun later on the PATH that already meets the container's version. */
export interface ShadowedBun {
  resolved: { path: string; version: string | null };
  shadowed: { path: string; version: string };
}

/** Every `tool` on the PATH, in PATH order. */
function lookupAll(tool: string, env: Record<string, string>, exists: (p: string) => boolean) {
  const found: string[] = [];
  for (const dir of (env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = `${dir}/${tool}`;
    if (exists(candidate) && !found.includes(candidate)) found.push(candidate);
  }
  return found;
}

async function bunVersion(runner: Runner, bun: string, env: Record<string, string>) {
  const r = await runner.run(bun, ["--version"], { env });
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * The first bun after the resolved one on the PATH, not the same binary, whose version
 * meets the container's; null when there is none or the container's version is unknown.
 */
export async function findShadowedBun(
  env: Record<string, string>,
  exists: (p: string) => boolean,
  realpath: (p: string) => string,
  runner: Runner,
  containerBunVersion: string | undefined,
): Promise<ShadowedBun | null> {
  if (!containerBunVersion) return null;
  const [resolved, ...later] = lookupAll("bun", env, exists);
  if (!resolved) return null;
  const resolvedReal = realpath(resolved);
  for (const candidate of later) {
    if (realpath(candidate) === resolvedReal) continue;
    const version = await bunVersion(runner, candidate, env);
    if (version && versionGte(version, containerBunVersion)) {
      return {
        resolved: { path: resolved, version: await bunVersion(runner, resolved, env) },
        shadowed: { path: candidate, version },
      };
    }
  }
  return null;
}

/** The one-time notice for a shadowed bun. */
export function shadowNoteText(s: ShadowedBun): string {
  const resolved = s.resolved.version
    ? `${s.resolved.path} ${s.resolved.version}`
    : s.resolved.path;
  return (
    `Expo Bridge: ${resolved} comes before ${s.shadowed.path} ${s.shadowed.version} ` +
    `on the Mac's PATH, so the bun fix upgrades ${s.resolved.path}.`
  );
}

const SHADOW_NOTES_KEY = "expoBridge.bunShadowNotes"; // ["<resolved>\0<shadowed>", ...]

/** Remembers, in the host's globalState, which resolved-and-shadowed pairs were noted. */
export class ShadowNotes {
  constructor(private readonly state: Memento) {}

  /** True the first time a pair is seen, recording it; false for a pair already noted. */
  async take(s: ShadowedBun): Promise<boolean> {
    const key = `${s.resolved.path}\0${s.shadowed.path}`;
    const noted = this.state.get<string[]>(SHADOW_NOTES_KEY) ?? [];
    if (noted.includes(key)) return false;
    await this.state.update(SHADOW_NOTES_KEY, [...noted, key]);
    return true;
  }
}
