import * as fs from "node:fs";

/** A config file the host reads is rejected past this size, so a huge file cannot stall it. */
export const MAX_JSON_BYTES = 1024 * 1024;

export class JsonFileError extends Error {
  constructor(
    readonly code: "symlink-rejected" | "not-regular" | "too-large" | "not-found" | "parse",
    message: string,
  ) {
    super(message);
  }
}

export interface JsonFileDeps {
  lstat: (p: string) => fs.Stats;
  open: (p: string, flags: number) => number;
  fstat: (fd: number) => fs.Stats;
  read: (fd: number, buf: Buffer) => number;
  close: (fd: number) => void;
}

const defaultDeps: JsonFileDeps = {
  lstat: fs.lstatSync,
  open: fs.openSync,
  fstat: fs.fstatSync,
  read: (fd, buf) => fs.readSync(fd, buf, 0, buf.length, 0),
  close: fs.closeSync,
};

/**
 * Read a JSON file the container may have influenced: refuse a symlink, a non-regular file
 * (FIFO, device, directory), or one over the size cap, and parse the rest. On any failure
 * the thrown message names the condition only — never a byte of the file. Opened with
 * O_NOFOLLOW so a symlink swapped in after lstat still fails the open.
 */
export function readJsonFile(absPath: string, deps: JsonFileDeps = defaultDeps): unknown {
  let st: fs.Stats;
  try {
    st = deps.lstat(absPath);
  } catch {
    throw new JsonFileError("not-found", "file does not exist");
  }
  if (st.isSymbolicLink()) throw new JsonFileError("symlink-rejected", "file is a symlink");

  // O_NONBLOCK so opening a FIFO fails fast via fstat instead of blocking for a writer;
  // O_NOFOLLOW so a symlink swapped in after lstat still fails the open.
  const fd = deps.open(absPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const fst = deps.fstat(fd);
    if (!fst.isFile()) throw new JsonFileError("not-regular", "file is not a regular file");
    if (fst.size > MAX_JSON_BYTES) throw new JsonFileError("too-large", "file is too large");
    const buf = Buffer.alloc(Number(fst.size));
    deps.read(fd, buf);
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      throw new JsonFileError("parse", "file is not valid JSON");
    }
  } finally {
    deps.close(fd);
  }
}
