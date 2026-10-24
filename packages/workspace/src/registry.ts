import * as fs from "node:fs";
import * as path from "node:path";
import { parseRegistryEntry, type RegistryEntry } from "@plume-works/expo-bridge-protocol";

/** A registry entry together with the id that names its socket and entry files. */
export interface Registered {
  id: string;
  entry: RegistryEntry;
}

export function socketPath(dir: string, id: string): string {
  return path.join(dir, `${id}.sock`);
}

export function entryPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`);
}

/** True while `pid` names a process; one owned by another user still counts as alive. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Create the registry directory, private to the current user. */
export function ensureRegistryDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Write `<id>.json` whole, through a rename, so a reader never sees half an entry. */
export function writeEntry(dir: string, id: string, entry: RegistryEntry): void {
  const tmp = path.join(dir, `.${id}.json.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
  fs.renameSync(tmp, entryPath(dir, id));
}

/** Remove this window's own socket and entry, and nothing else. */
export function removeOwn(dir: string, id: string): void {
  fs.rmSync(socketPath(dir, id), { force: true });
  fs.rmSync(entryPath(dir, id), { force: true });
}

/** Every well-formed entry the current user owns, whether or not its process is alive. */
function ownedEntries(dir: string, uid: number | undefined): Registered[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    // no registry directory yet: no window has registered
    return [];
  }
  const out: Registered[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || (uid !== undefined && st.uid !== uid)) continue;
      const entry = parseRegistryEntry(JSON.parse(fs.readFileSync(file, "utf8")));
      if (entry) out.push({ id: name.slice(0, -".json".length), entry });
    } catch {
      // an entry removed or rewritten while being read is skipped, not fatal
      continue;
    }
  }
  return out;
}

/** The entries of windows whose extension host is still running. */
export function liveEntries(
  dir: string,
  alive: (pid: number) => boolean = isAlive,
  uid: number | undefined = process.getuid?.(),
): Registered[] {
  return ownedEntries(dir, uid).filter((r) => alive(r.entry.pid));
}

/** Remove the files of entries whose process is gone; a live window's files are kept. */
export function pruneStale(
  dir: string,
  alive: (pid: number) => boolean = isAlive,
  uid: number | undefined = process.getuid?.(),
): void {
  for (const r of ownedEntries(dir, uid)) {
    if (!alive(r.entry.pid)) removeOwn(dir, r.id);
  }
}

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** True when `child` is `root` or lies under it, compared by whole path components. */
export function containsPath(root: string, child: string): boolean {
  const r = root.endsWith(path.sep) ? root.slice(0, -1) : root;
  return child === r || child.startsWith(r + path.sep) || r === "";
}

/**
 * The folder, among `folders`, with the longest real path that contains the real directory
 * `dir`; null when none does. Returns the folder as given, not its real path.
 */
export function containingFolder(
  folders: readonly string[],
  dir: string,
  real: (p: string) => string = realpathOrSelf,
): string | null {
  let best: { folder: string; len: number } | null = null;
  for (const folder of folders) {
    const r = real(folder);
    if (containsPath(r, dir) && (!best || r.length > best.len)) best = { folder, len: r.length };
  }
  return best?.folder ?? null;
}

/**
 * The window to serve a CLI run in `dir`: the entry with the longest workspace folder
 * containing it, the most recently activated on a tie.
 */
export function selectEntry(
  entries: readonly Registered[],
  dir: string,
  real: (p: string) => string = realpathOrSelf,
): Registered | null {
  let best: { r: Registered; len: number } | null = null;
  for (const r of entries) {
    const folder = containingFolder(r.entry.folders, dir, real);
    if (folder === null) continue;
    const len = real(folder).length;
    if (
      !best ||
      len > best.len ||
      (len === best.len && r.entry.activatedAt > best.r.entry.activatedAt)
    ) {
      best = { r, len };
    }
  }
  return best?.r ?? null;
}
