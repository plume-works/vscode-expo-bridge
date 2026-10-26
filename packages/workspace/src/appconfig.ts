import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program with an argument array, never through a shell. */
export type Runner = (file: string, args: string[], opts: { cwd: string }) => Promise<RunResult>;

/** How long `expo config` may take before its result counts as unresolved. */
const EXPO_CONFIG_TIMEOUT_MS = 60_000;

export const realRunner: Runner = (file, args, opts) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, timeout: EXPO_CONFIG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr || error?.message || "") });
      },
    );
  });

export type ProjectId =
  | { state: "set"; projectId: string }
  | { state: "not-set" }
  | { state: "unresolved"; reason: string };

export const DYNAMIC_CONFIGS = [
  "app.config.ts",
  "app.config.js",
  "app.config.mjs",
  "app.config.cjs",
];

/** The folder's dynamic app config file, if it has one. */
export function dynamicConfig(folder: string, fileExists: (p: string) => boolean): string | null {
  return DYNAMIC_CONFIGS.find((f) => fileExists(path.join(folder, f))) ?? null;
}

function projectIdOf(config: unknown): string | undefined {
  const c = config as { expo?: unknown } | null;
  const exp = (c && typeof c === "object" && "expo" in c ? c.expo : c) as {
    extra?: { eas?: { projectId?: unknown } };
  } | null;
  const id = exp?.extra?.eas?.projectId;
  return typeof id === "string" && id ? id : undefined;
}

function fromConfig(config: unknown): ProjectId {
  const projectId = projectIdOf(config);
  return projectId ? { state: "set", projectId } : { state: "not-set" };
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/**
 * Resolve `extra.eas.projectId` from the folder's app config as Expo does. Only the folder's
 * own `expo` evaluates a dynamic config; `bunx` is never used, since it could fetch Expo.
 */
export async function resolveProjectId(
  folder: string,
  runner: Runner,
  fileExists: (p: string) => boolean,
): Promise<ProjectId> {
  const expo = path.join(folder, "node_modules", ".bin", "expo");
  if (fileExists(expo)) {
    const r = await runner(expo, ["config", "--json", "--type", "public"], { cwd: folder });
    if (r.code !== 0) {
      return { state: "unresolved", reason: `expo config failed: ${firstLine(r.stderr)}` };
    }
    try {
      return fromConfig(JSON.parse(r.stdout));
    } catch {
      return { state: "unresolved", reason: "expo config printed no JSON" };
    }
  }
  const dynamic = dynamicConfig(folder, fileExists);
  if (dynamic) {
    return {
      state: "unresolved",
      reason: `${dynamic} needs the folder's own expo to resolve; install the project's dependencies`,
    };
  }
  const appJson = path.join(folder, "app.json");
  if (!fileExists(appJson)) return { state: "not-set" };
  try {
    return fromConfig(JSON.parse(fs.readFileSync(appJson, "utf8")));
  } catch {
    return { state: "unresolved", reason: "app.json is not valid JSON" };
  }
}

/** Resolved project IDs per folder, until a watched config file changes. */
export class ProjectIdCache {
  private entries = new Map<string, Promise<ProjectId>>();

  get(folder: string, resolve: () => Promise<ProjectId>): Promise<ProjectId> {
    let entry = this.entries.get(folder);
    if (!entry) {
      entry = resolve();
      this.entries.set(folder, entry);
    }
    return entry;
  }

  /** Forget the folder's entry, or every entry when no folder is named. */
  clear(folder?: string): void {
    if (folder === undefined) this.entries.clear();
    else this.entries.delete(folder);
  }
}

/** The config files whose change can change a folder's resolved project ID. */
export const PROJECT_ID_INPUTS_GLOB = "**/{app.json,app.config.*,eas.json,package.json}";
