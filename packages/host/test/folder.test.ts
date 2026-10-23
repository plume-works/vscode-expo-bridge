import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BindMount } from "../src/container";
import type { Runner } from "../src/exec";
import { mapFolder, resolveFolder } from "../src/folder";

const HOST = "/Users/me/repo";

// The host path mounted twice, a .git directory, an unrelated directory, and a socket.
const MOUNTS: BindMount[] = [
  { source: HOST, destination: "/workspaces/repo" },
  { source: HOST, destination: HOST },
  { source: "/Users/me/main/.git", destination: "/workspaces/repo/.git" },
  { source: "/Users/me/.docker/mcp", destination: "/home/vscode/.docker/mcp" },
  { source: "/run/host-services/ssh-auth.sock", destination: "/ssh-agent" },
];

describe("mapFolder", () => {
  test("either mount of the host path maps a folder under it", () => {
    expect(mapFolder("/workspaces/repo", MOUNTS)).toBe(HOST);
    expect(mapFolder("/workspaces/repo/apps/mobile", MOUNTS)).toBe(`${HOST}/apps/mobile`);
    expect(mapFolder(`${HOST}/apps/mobile`, MOUNTS)).toBe(`${HOST}/apps/mobile`);
  });

  test("the longest destination wins, so a .git mount maps its own subtree", () => {
    expect(mapFolder("/workspaces/repo/.git/hooks", MOUNTS)).toBe("/Users/me/main/.git/hooks");
    expect(mapFolder("/workspaces/repo/.github", MOUNTS)).toBe(`${HOST}/.github`);
  });

  test("an unrelated mount maps outside the host path", () => {
    expect(mapFolder("/home/vscode/.docker/mcp", MOUNTS)).toBe("/Users/me/.docker/mcp");
  });

  test("a folder outside every mount, or not absolute, maps to nothing", () => {
    expect(mapFolder("/workspaces/other", MOUNTS)).toBeNull();
    expect(mapFolder("/workspaces/repository", MOUNTS)).toBeNull();
    expect(mapFolder("workspaces/repo", MOUNTS)).toBeNull();
  });

  test("trailing separators and dot components are normalized", () => {
    expect(mapFolder("/workspaces/repo/./apps/", [...MOUNTS])).toBe(`${HOST}/apps`);
  });
});

describe("resolveFolder", () => {
  let host: string;

  beforeEach(() => {
    host = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-folder-")));
    fs.mkdirSync(path.join(host, "apps", "mobile"), { recursive: true });
  });

  afterEach(() => fs.rmSync(host, { recursive: true, force: true }));

  /** A docker that knows one container mounting `host` at /workspaces/repo, plus `extra`. */
  function docker(extra: object[] = [], ids = "c1\n"): Runner {
    return {
      async run(_file, args) {
        if (args.includes("ps")) return { code: 0, stdout: ids, stderr: "" };
        const mounts = [{ Type: "bind", Source: host, Destination: "/workspaces/repo" }, ...extra];
        return { code: 0, stdout: JSON.stringify(mounts), stderr: "" };
      },
    };
  }

  const resolve = (folder: string, runner: Runner, windowFolders = [folder]) =>
    resolveFolder(folder, windowFolders, { hostPath: host }, { docker: "docker", runner, env: {} });

  test("a workspace folder under the host path maps to its Mac path", async () => {
    const folders = ["/workspaces/repo", "/workspaces/repo/apps/mobile"];
    expect(await resolve("/workspaces/repo/apps/mobile", docker(), folders)).toEqual({
      ok: true,
      folderHostPath: path.join(host, "apps", "mobile"),
    });
    expect(await resolve("/workspaces/repo", docker(), folders)).toEqual({
      ok: true,
      folderHostPath: host,
    });
  });

  test("a folder that is not one of the window's is unavailable", async () => {
    const r = await resolve("/workspaces/repo/apps/mobile", docker(), ["/workspaces/repo"]);
    expect(r).toEqual({ ok: false, detail: "the folder is not a workspace folder of this window" });
  });

  test("a non-bind mount is ignored", async () => {
    const volume = { Type: "volume", Source: "/var/lib/v", Destination: "/workspaces/repo/apps" };
    expect(await resolve("/workspaces/repo/apps/mobile", docker([volume]))).toEqual({
      ok: true,
      folderHostPath: path.join(host, "apps", "mobile"),
    });
  });

  test("a folder that maps outside the host path is unavailable", async () => {
    const other = { Type: "bind", Source: "/Users/me/elsewhere", Destination: "/workspaces/other" };
    const r = await resolve("/workspaces/other", docker([other]));
    expect(r).toEqual({ ok: false, detail: "the folder maps outside the workspace host path" });
  });

  test("a symlink component below the host path is unavailable", async () => {
    fs.symlinkSync(path.join(host, "apps"), path.join(host, "link"));
    const r = await resolve("/workspaces/repo/link/mobile", docker());
    expect(r).toEqual({ ok: false, detail: "a component of the folder's Mac path is a symlink" });
  });

  test("a folder with no Mac directory is unavailable", async () => {
    const r = await resolve("/workspaces/repo/missing", docker());
    expect(r).toEqual({ ok: false, detail: "the folder's Mac path does not exist" });
  });

  test("no docker, no container, or several containers is unavailable", async () => {
    const none = await resolveFolder(
      "/workspaces/repo",
      ["/workspaces/repo"],
      { hostPath: host },
      { docker: null, runner: docker(), env: {} },
    );
    expect(none).toEqual({ ok: false, detail: "docker not found on the Mac" });
    expect((await resolve("/workspaces/repo", docker([], ""))).ok).toBe(false);
    expect(await resolve("/workspaces/repo", docker([], "c1\nc2\n"))).toEqual({
      ok: false,
      detail: "several running containers match this window",
    });
  });
});
