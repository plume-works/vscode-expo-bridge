import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EXTENSIONS } from "../src/bump";
import { channelOf, checkTag } from "../src/release";

let root: string;

const write = (pkg: string, version: string) => {
  fs.mkdirSync(path.join(root, "packages", pkg), { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", pkg, "package.json"),
    JSON.stringify({ name: pkg, version }, null, 2) + "\n",
  );
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "release-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("channelOf", () => {
  test("an odd minor is a pre-release", () => {
    expect(channelOf("0.1.9")).toBe("pre-release");
    expect(channelOf("1.3.0")).toBe("pre-release");
  });
  test("an even minor is a release", () => {
    expect(channelOf("0.2.0")).toBe("release");
    expect(channelOf("1.10.4")).toBe("release");
  });
  test("refuses a version that is not major.minor.patch", () => {
    expect(() => channelOf("0.1.0-beta")).toThrow();
  });
});

describe("checkTag", () => {
  test("accepts the tag of the shared version and reports its channel", () => {
    for (const p of EXTENSIONS) write(p, "0.1.9");
    expect(checkTag(root, "v0.1.9")).toEqual({ version: "0.1.9", channel: "pre-release" });
  });

  test("refuses a tag that differs from the version", () => {
    for (const p of EXTENSIONS) write(p, "0.1.9");
    expect(() => checkTag(root, "v0.1.8")).toThrow("does not match");
    expect(() => checkTag(root, "0.1.9")).toThrow("does not match");
  });

  test("refuses extensions whose versions differ", () => {
    write("pack", "0.2.0");
    write("host", "0.2.0");
    write("workspace", "0.1.9");
    expect(() => checkTag(root, "v0.2.0")).toThrow("differ");
  });
});
