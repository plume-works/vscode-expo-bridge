// Resolve the Mac-side host path of the devcontainer workspace from the remote window's
// folder authority (`dev-container+<hex JSON>`), confirmed in plan Task 1. The container
// cannot redirect this: folder injection does not change the window's own authority.

export interface ResolvedHost {
  authority: string;
  hostPath: string;
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
  let hostPath: string | undefined;
  try {
    const parsed = JSON.parse(decoded) as { hostPath?: string };
    hostPath = parsed.hostPath;
  } catch {
    hostPath = decoded || undefined;
  }
  if (!hostPath) return null;
  return { authority, hostPath };
}
