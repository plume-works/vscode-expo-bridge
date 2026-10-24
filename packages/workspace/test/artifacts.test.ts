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
  test("an install with no path gets the newest artifact of the cwd's folder", () => {
    write("build-1.tar.gz", 1000);
    expect(resolveRequest({ action: "install", cwd: path.join(root, "src") }, [root])).toEqual({
      request: {
        action: "install",
        artifactRel: path.join(WRITE_DIR_REL, "build-1.tar.gz"),
        folder: root,
      },
    });
  });

  test("the request names the longest folder containing the cwd, without the cwd", () => {
    const app = path.join(root, "apps", "mobile");
    expect(resolveRequest({ action: "launch", cwd: path.join(app, "src") }, [root, app])).toEqual({
      request: { action: "launch", folder: app },
    });
    expect(resolveRequest({ action: "launch", cwd: root }, [root, app])).toEqual({
      request: { action: "launch", folder: root },
    });
  });

  test("the newest artifact comes from the request's folder, not the first one", () => {
    write("build-1.tar.gz", 1000);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-artifacts-other-"));
    try {
      fs.mkdirSync(path.join(other, WRITE_DIR_REL), { recursive: true });
      fs.writeFileSync(path.join(other, WRITE_DIR_REL, "build-9.tar.gz"), "");
      expect(resolveRequest({ action: "install", cwd: other }, [root, other])).toEqual({
        request: {
          action: "install",
          artifactRel: path.join(WRITE_DIR_REL, "build-9.tar.gz"),
          folder: other,
        },
      });
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test("an explicit path passes through", () => {
    const install = {
      action: "install" as const,
      artifactRel: ".tmp/expo-bridge/x.tar.gz",
      cwd: root,
    };
    expect(resolveRequest(install, [root])).toEqual({
      request: { action: "install", artifactRel: ".tmp/expo-bridge/x.tar.gz", folder: root },
    });
  });

  test("a cwd outside every folder is unavailable", () => {
    const r = resolveRequest({ action: "status", cwd: "/elsewhere" }, [root]);
    expect("error" in r && r.error.code).toBe("unavailable");
    expect("error" in r && r.error.message).toContain("/elsewhere");
  });

  test("a request without an absolute cwd is a bad request", () => {
    const r = resolveRequest({ action: "status" } as never, [root]);
    expect("error" in r && r.error.code).toBe("bad-request");
  });

  test("an install with no path and no artifact is not-found", () => {
    const r = resolveRequest({ action: "install", cwd: root }, [root]);
    expect("error" in r && r.error.code).toBe("not-found");
  });
});
