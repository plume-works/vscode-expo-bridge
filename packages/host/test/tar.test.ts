import { describe, expect, test } from "bun:test";
import { ArchiveError, safeEntryDest } from "../src/tar";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as ArchiveError).code;
  }
  throw new Error("expected a throw");
}

describe("safeEntryDest", () => {
  test("accepts a normal nested entry", () => {
    expect(safeEntryDest({ name: "MyApp.app/Info.plist" })).toBe(
      "MyApp.app/Info.plist".split("/").join(require("node:path").sep),
    );
  });

  test("rejects an absolute path", () => {
    expect(codeOf(() => safeEntryDest({ name: "/etc/passwd" }))).toBe("absolute-entry");
  });

  test("rejects a '..' escape", () => {
    expect(codeOf(() => safeEntryDest({ name: "../../evil" }))).toBe("parent-escape");
  });

  test("rejects a symlink entry (typeflag 2)", () => {
    expect(codeOf(() => safeEntryDest({ name: "link", typeflag: "2", linkname: "/etc" }))).toBe(
      "symlink-entry",
    );
  });

  test("rejects a hard link entry (typeflag 1)", () => {
    expect(codeOf(() => safeEntryDest({ name: "hl", typeflag: "1", linkname: "x" }))).toBe(
      "symlink-entry",
    );
  });

  test("rejects any entry carrying a linkname", () => {
    expect(codeOf(() => safeEntryDest({ name: "x", linkname: "y" }))).toBe("symlink-entry");
  });
});
