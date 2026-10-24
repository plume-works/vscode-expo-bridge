import * as fs from "node:fs";
import * as path from "node:path";
import {
  bindMounts,
  ContainerError,
  findContainer,
  type BindMount,
  type ContainerTarget,
} from "./container";
import type { Runner } from "./exec";
import { isWithin, PathError, rejectSymlinksBelow } from "./paths";

/** A normalized absolute POSIX path with no trailing separator; null when not absolute. */
function normalize(p: string): string | null {
  if (!path.posix.isAbsolute(p)) return null;
  const n = path.posix.normalize(p);
  return n.length > 1 && n.endsWith("/") ? n.slice(0, -1) : n;
}

/**
 * The Mac path of a container folder: the source of the bind mount whose destination is
 * the longest path-component prefix of `folder`, joined with the rest of `folder`. Null
 * when no bind mount holds it.
 */
export function mapFolder(folder: string, mounts: readonly BindMount[]): string | null {
  const f = normalize(folder);
  if (!f) return null;
  let best: { mount: BindMount; dest: string } | null = null;
  for (const mount of mounts) {
    const dest = normalize(mount.destination);
    if (!dest || !(dest === "/" || f === dest || f.startsWith(dest + "/"))) continue;
    if (!best || dest.length > best.dest.length) best = { mount, dest };
  }
  if (!best) return null;
  const rest = path.posix.relative(best.dest, f);
  return normalize(path.posix.join(best.mount.source, rest));
}

export type FolderMapping = { ok: true; folderHostPath: string } | { ok: false; detail: string };

export interface FolderDeps {
  /** The `docker` binary, or null when none was found. */
  docker: string | null;
  runner: Runner;
  env: Record<string, string>;
  lstat?: (p: string) => fs.Stats;
}

/**
 * Map a request's folder to the Mac path the host acts on. The folder must be one of the
 * window's own workspace folders, and its mapping through the window's one container must
 * be the host path or lie under it, with no symlink component below the host path.
 */
export async function resolveFolder(
  folder: string,
  windowFolders: readonly string[],
  target: ContainerTarget,
  deps: FolderDeps,
): Promise<FolderMapping> {
  const f = normalize(folder);
  if (!f || !windowFolders.some((w) => normalize(w) === f)) {
    return { ok: false, detail: "the folder is not a workspace folder of this window" };
  }
  const hostPath = normalize(target.hostPath);
  if (!hostPath) return { ok: false, detail: "the host path is not absolute" };
  if (!deps.docker) return { ok: false, detail: "docker not found on the Mac" };

  let mounts: BindMount[];
  try {
    const id = await findContainer(deps.docker, target, deps.runner, deps.env);
    mounts = await bindMounts(deps.docker, id, target.dockerHost, deps.runner, deps.env);
  } catch (e) {
    if (e instanceof ContainerError) return { ok: false, detail: e.message };
    throw e;
  }

  const mapped = mapFolder(f, mounts);
  if (!mapped) return { ok: false, detail: "no bind mount of the container holds the folder" };
  if (!isWithin(hostPath, mapped)) {
    return { ok: false, detail: "the folder maps outside the workspace host path" };
  }
  try {
    rejectSymlinksBelow(hostPath, mapped, deps.lstat);
  } catch (e) {
    if (e instanceof PathError) {
      return {
        ok: false,
        detail:
          e.code === "symlink-rejected"
            ? "a component of the folder's Mac path is a symlink"
            : "the folder's Mac path does not exist",
      };
    }
    throw e;
  }
  return { ok: true, folderHostPath: mapped };
}
