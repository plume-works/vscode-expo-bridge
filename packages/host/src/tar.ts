import * as path from "node:path";

export class ArchiveError extends Error {
  constructor(
    readonly code: "absolute-entry" | "parent-escape" | "symlink-entry",
    message: string,
  ) {
    super(message);
  }
}

export interface ArchiveEntry {
  name: string;
  /** A tar type flag; "2" is a symlink, "1" a hard link. */
  typeflag?: string;
  linkname?: string;
}

/**
 * Reject an archive entry that is absolute, climbs out with `..`, or is any kind of link.
 * The caller unpacks into a fresh private directory, so a rejected entry cannot write
 * outside it. Returns the safe relative destination for an accepted entry.
 */
export function safeEntryDest(entry: ArchiveEntry): string {
  const name = entry.name.replace(/\/+$/, "");
  if (entry.typeflag === "1" || entry.typeflag === "2" || entry.linkname) {
    throw new ArchiveError("symlink-entry", "archive contains a link entry");
  }
  if (path.isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name)) {
    throw new ArchiveError("absolute-entry", "archive entry is an absolute path");
  }
  const normalized = path.normalize(name);
  if (normalized === ".." || normalized.startsWith(".." + path.sep)) {
    throw new ArchiveError("parent-escape", "archive entry escapes with '..'");
  }
  return normalized;
}
