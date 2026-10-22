import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { JsonFileError, MAX_JSON_BYTES, readJsonFile } from "../src/jsonfile";

let dir: string;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-json-")));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as JsonFileError).code;
  }
  throw new Error("expected a throw");
}

test("reads a regular JSON file", () => {
  const f = path.join(dir, "eas.json");
  fs.writeFileSync(f, JSON.stringify({ build: { development: {} } }));
  expect(readJsonFile(f)).toEqual({ build: { development: {} } });
});

test("rejects a symlink", () => {
  const target = path.join(dir, "real.json");
  fs.writeFileSync(target, "{}");
  const link = path.join(dir, "eas.json");
  fs.symlinkSync(target, link);
  expect(codeOf(() => readJsonFile(link))).toBe("symlink-rejected");
});

test("rejects a FIFO (non-regular file)", () => {
  const fifo = path.join(dir, "eas.json");
  execFileSync("mkfifo", [fifo]);
  expect(codeOf(() => readJsonFile(fifo))).toBe("not-regular");
});

test("rejects an oversized file", () => {
  const f = path.join(dir, "eas.json");
  fs.writeFileSync(f, "0".repeat(MAX_JSON_BYTES + 1));
  expect(codeOf(() => readJsonFile(f))).toBe("too-large");
});

test("reports a parse error without quoting bytes", () => {
  const f = path.join(dir, "eas.json");
  const secret = "SUPER_SECRET_TOKEN_VALUE";
  fs.writeFileSync(f, `{ not json ${secret}`);
  try {
    readJsonFile(f);
    throw new Error("expected a throw");
  } catch (e) {
    expect((e as JsonFileError).code).toBe("parse");
    expect((e as Error).message).not.toContain(secret);
  }
});

test("reports not-found for a missing file", () => {
  expect(codeOf(() => readJsonFile(path.join(dir, "absent.json")))).toBe("not-found");
});
