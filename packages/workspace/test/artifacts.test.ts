import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WRITE_DIR_REL } from "@plume-works/expo-bridge-protocol";
import { newestArtifact, resolveRequest } from "../src/artifacts";

let root: string;
let dir: string;

function write(name: string, mtimeSec: number): void {
  const f = path.join(dir, name);
  fs.writeFileSync(f, "");
  fs.utimesSync(f, mtimeSec, mtimeSec);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-artifacts-"));
  dir = path.join(root, WRITE_DIR_REL);
  fs.mkdirSync(dir, { recursive: true });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("newestArtifact", () => {
  test("the newest artifact, skipping build logs and screenshots", () => {
    write("build-1.tar.gz", 1000);
    write("build-2.tar.gz", 2000);
    write("build-3.log", 3000);
    write("screenshot-4.png", 4000);
    expect(newestArtifact(root)).toBe(path.join(WRITE_DIR_REL, "build-2.tar.gz"));
  });

  test("null with no artifact or no write directory", () => {
    write("build-3.log", 3000);
    expect(newestArtifact(root)).toBeNull();
    fs.rmSync(dir, { recursive: true });
    expect(newestArtifact(root)).toBeNull();
  });
});

describe("resolveRequest", () => {
  test("an install with no path gets the newest artifact", () => {
    write("build-1.tar.gz", 1000);
    expect(resolveRequest({ action: "install" }, root)).toEqual({
      request: { action: "install", artifactRel: path.join(WRITE_DIR_REL, "build-1.tar.gz") },
    });
  });

  test("an explicit path and other actions pass through", () => {
    const install = { action: "install" as const, artifactRel: ".tmp/expo-bridge/x.tar.gz" };
    expect(resolveRequest(install, root)).toEqual({ request: install });
    expect(resolveRequest({ action: "launch" }, undefined)).toEqual({
      request: { action: "launch" },
    });
  });

  test("an install with no path and no artifact is not-found", () => {
    const r = resolveRequest({ action: "install" }, root);
    expect("error" in r && r.error.code).toBe("not-found");
    expect("error" in resolveRequest({ action: "install" }, undefined)).toBe(true);
  });
});
