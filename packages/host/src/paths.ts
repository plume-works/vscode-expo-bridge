import * as fs from "node:fs";
import * as path from "node:path";
import { WRITE_DIR_REL } from "@plume-works/expo-bridge-protocol";

/**
 * macOS `O_NOFOLLOW_ANY`: fail if any component of the path is a symlink, not only the
 * final one. Confirmed against the Mac in plan Task 9 before ship.
 */
export const O_NOFOLLOW_ANY = 0x20000000;

export class PathError extends Error {
  constructor(
    readonly code: "path-escape" | "symlink-rejected" | "not-found",
    message: string,
  ) {
    super(message);
  }
}

/** True when `child` is `root` itself or lies strictly under it. */
export function isWithin(root: string, child: string): boolean {
  return child === root || child.startsWith(root + path.sep);
}

/**
 * Resolve a workspace-relative path and reject it when any component is a symlink or the
 * result leaves `root`. Returns the real absolute path. Every component must exist.
 */
export function resolveWithin(
  root: string,
  rel: string,
  deps: { realpath: (p: string) => string; lstat: (p: string) => fs.Stats } = {
    realpath: fs.realpathSync,
    lstat: fs.lstatSync,
  },
): string {
  if (path.isAbsolute(rel)) throw new PathError("path-escape", "absolute paths are not allowed");
  const joined = path.resolve(root, rel);
  if (!isWithin(root, joined)) throw new PathError("path-escape", "path escapes the workspace");

  // Walk every component from the workspace root down; reject the first that is a symlink.
  const rootReal = root;
  let current = rootReal;
  for (const part of path.relative(rootReal, joined).split(path.sep)) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new PathError("path-escape", "path escapes the workspace");
    current = path.join(current, part);
    let st: fs.Stats;
    try {
      st = deps.lstat(current);
    } catch {
      throw new PathError("not-found", "path does not exist");
    }
    if (st.isSymbolicLink()) throw new PathError("symlink-rejected", "path component is a symlink");
  }
  const real = deps.realpath(joined);
  if (!isWithin(root, real)) throw new PathError("path-escape", "path escapes the workspace");
  return real;
}

/** The absolute `.tmp/expo-bridge/` directory for a workspace root. */
export function writeDir(root: string): string {
  return path.join(root, WRITE_DIR_REL);
}

/** Reject a path that does not resolve under `.tmp/expo-bridge/`. */
export function requireUnderWriteDir(root: string, rel: string): string {
  const real = resolveWithin(root, rel);
  if (!isWithin(writeDir(root), real)) {
    throw new PathError("path-escape", `path is not under ${WRITE_DIR_REL}/`);
  }
  return real;
}

/**
 * Create a fresh file under `.tmp/expo-bridge/` with `O_CREAT | O_EXCL | O_NOFOLLOW_ANY`,
 * so an existing file, or a symlink anywhere in the path, fails the open. Returns the fd;
 * the caller closes it.
 */
export function openFreshWrite(
  absPath: string,
  deps: { open: (p: string, flags: number, mode: number) => number } = { open: fs.openSync },
): number {
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | O_NOFOLLOW_ANY;
  return deps.open(absPath, flags, 0o600);
}

/**
 * Open a fresh O_EXCL|O_NOFOLLOW_ANY file at `dest`, or at `dest` with a numeric suffix
 * when that name is taken. Returns the fd and the path actually opened.
 */
export function openFreshUnique(dest: string): { fd: number; written: string } {
  const ext = path.extname(dest);
  let target = dest;
  for (let i = 0; ; i++) {
    try {
      return { fd: openFreshWrite(target), written: target };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST" || i >= 100) throw e;
      target = dest.slice(0, dest.length - ext.length) + `-${i}` + ext;
    }
  }
}

/** Copy a file into a fresh destination under the write rule, returning the written path. */
export function copyFresh(src: string, dest: string): string {
  const { fd, written } = openFreshUnique(dest);
  try {
    fs.writeSync(fd, fs.readFileSync(src));
  } finally {
    fs.closeSync(fd);
  }
  return written;
}
