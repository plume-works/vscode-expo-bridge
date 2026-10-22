import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { bump, bumpPatch, EXTENSIONS } from "../src/bump";

let root: string;

const write = (pkg: string, version: string) => {
  fs.mkdirSync(path.join(root, "packages", pkg), { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", pkg, "package.json"),
    JSON.stringify({ name: pkg, version }, null, 2) + "\n",
  );
};
const read = (pkg: string) =>
  JSON.parse(fs.readFileSync(path.join(root, "packages", pkg, "package.json"), "utf8")).version;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bump-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("bumpPatch", () => {
  test("increments only the patch", () => {
    expect(bumpPatch("0.1.9")).toBe("0.1.10");
  });
  test("refuses a version that is not major.minor.patch", () => {
    expect(() => bumpPatch("0.1")).toThrow();
  });
});

describe("bump", () => {
  test("bumps every extension's patch together", () => {
    for (const p of EXTENSIONS) write(p, "0.1.0");
    expect(bump(root)).toBe("0.1.1");
    for (const p of EXTENSIONS) expect(read(p)).toBe("0.1.1");
  });

  test("sets an explicit version", () => {
    for (const p of EXTENSIONS) write(p, "0.0.0");
    expect(bump(root, "0.1.0")).toBe("0.1.0");
    for (const p of EXTENSIONS) expect(read(p)).toBe("0.1.0");
  });

  test("refuses extensions whose versions differ", () => {
    write("pack", "0.1.0");
    write("host", "0.1.1");
    write("workspace", "0.1.0");
    expect(() => bump(root)).toThrow("differ");
  });
});
