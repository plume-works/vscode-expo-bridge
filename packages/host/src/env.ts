import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Homebrew prefixes, prepended to the login PATH so a shell that omits them still works. */
export const HOMEBREW_BINS = ["/opt/homebrew/bin", "/usr/local/bin"] as const;

/**
 * Parse a NUL-separated `env -0` dump into a map. `env -0` is what both fish and POSIX
 * shells emit under `$SHELL -l -c 'env -0'`, which is why the login environment is read
 * that way rather than by sourcing shell syntax.
 */
export function parseEnv0(dump: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of dump.split("\0")) {
    if (entry === "") continue;
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return env;
}

/** Prepend the Homebrew prefixes to a PATH, without duplicating entries already present. */
export function withHomebrewPath(env: Record<string, string>): Record<string, string> {
  const existing = (env.PATH ?? "").split(":").filter((p) => p !== "");
  const merged = [...HOMEBREW_BINS.filter((b) => !existing.includes(b)), ...existing];
  return { ...env, PATH: merged.join(":") };
}

/**
 * Capture the user's login environment with `$SHELL -l -c 'env -0'` and prepend the
 * Homebrew prefixes. The result is used directly as a process environment — the bridge
 * never runs its tools *through* the login shell, only with its environment.
 */
export async function captureLoginEnv(
  shell: string = process.env.SHELL ?? "/bin/zsh",
  run: typeof execFileAsync = execFileAsync,
): Promise<Record<string, string>> {
  const { stdout } = await run(shell, ["-l", "-c", "env -0"], {
    encoding: "buffer",
    maxBuffer: 4 * 1024 * 1024,
  });
  return withHomebrewPath(parseEnv0(stdout.toString("utf8")));
}

/** Resolve a tool against a PATH, returning its absolute path or null. */
export function lookupTool(
  tool: string,
  env: Record<string, string>,
  exists: (p: string) => boolean,
): string | null {
  for (const dir of (env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = `${dir}/${tool}`;
    if (exists(candidate)) return candidate;
  }
  return null;
}
