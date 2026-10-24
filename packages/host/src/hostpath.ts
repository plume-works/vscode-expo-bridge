// Resolve the Mac-side host path of the devcontainer workspace from the remote window's
// folder authority (`dev-container+<hex JSON>`), confirmed in plan Task 1. The container
// cannot redirect this: folder injection does not change the window's own authority.
import { fileURLToPath } from "node:url";

export interface ResolvedHost {
  authority: string;
  hostPath: string;
  /** The Mac path of the `devcontainer.json` the window was opened with, when named. */
  configFile?: string;
  /** The Docker daemon Dev Containers used, from `settings.host`, when not the default. */
  dockerHost?: string;
}

interface AuthorityPayload {
  hostPath?: unknown;
  configFile?: unknown;
  settings?: { host?: unknown };
}

/** The Mac path of a serialized `file:` URI, as an object or a string; undefined otherwise. */
function filePath(uri: unknown): string | undefined {
  if (typeof uri === "string") {
    try {
      return uri.startsWith("file:") ? fileURLToPath(uri) : undefined;
    } catch {
      // a malformed file URI names no config file
      return undefined;
    }
  }
  const u = uri as { scheme?: unknown; path?: unknown } | null;
  if (typeof u === "object" && u !== null && u.scheme === "file" && typeof u.path === "string") {
    return u.path || undefined;
  }
  return undefined;
}

/** Decode a `dev-container+<hex>` authority into its host path. Returns null if it is not one. */
export function decodeHostPath(authority: string): ResolvedHost | null {
  const plus = authority.indexOf("+");
  if (plus < 0) return null;
  const hex = authority.slice(plus + 1);
  let decoded: string;
  try {
    decoded = Buffer.from(hex, "hex").toString("utf8");
  } catch {
    return null;
  }
  let payload: AuthorityPayload;
  try {
    const parsed = JSON.parse(decoded) as unknown;
    payload = typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    payload = { hostPath: decoded };
  }
  const hostPath = typeof payload.hostPath === "string" ? payload.hostPath : "";
  if (!hostPath) return null;
  const configFile = filePath(payload.configFile);
  const host = payload.settings?.host;
  return {
    authority,
    hostPath,
    ...(configFile ? { configFile } : {}),
    ...(typeof host === "string" && host ? { dockerHost: host } : {}),
  };
}
