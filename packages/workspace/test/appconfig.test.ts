import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectIdCache, resolveProjectId, type ProjectId, type Runner } from "../src/appconfig";

let folder: string;

beforeEach(() => {
  folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-appconfig-")));
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

const ID = "11111111-2222-3333-4444-555555555555";
const exists = (p: string) => fs.existsSync(p);

function write(files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    fs.writeFileSync(path.join(folder, name), content);
  }
}

/** A local `expo` whose `config` prints `config`, standing in for Expo's own resolution. */
function withExpo(config: unknown): { runner: Runner; calls: [string, string[], string][] } {
  write({ "node_modules/.bin/expo": "" });
  const calls: [string, string[], string][] = [];
  const runner: Runner = async (file, args, opts) => {
    calls.push([file, args, opts.cwd]);
    return { code: 0, stdout: JSON.stringify(config), stderr: "" };
  };
  return { runner, calls };
}

const noRunner: Runner = async () => {
  throw new Error("no program may run");
};

describe("resolveProjectId with the folder's own expo", () => {
  test("runs expo config --json --type public in the folder", async () => {
    const { runner, calls } = withExpo({ name: "a", extra: { eas: { projectId: ID } } });
    await resolveProjectId(folder, runner, exists);
    expect(calls).toEqual([
      [
        path.join(folder, "node_modules", ".bin", "expo"),
        ["config", "--json", "--type", "public"],
        folder,
      ],
    ]);
  });

  test("an ID set only in app.config.ts resolves as set", async () => {
    write({
      "app.config.ts": `export default { expo: { extra: { eas: { projectId: "${ID}" } } } };`,
    });
    const { runner } = withExpo({ name: "a", extra: { eas: { projectId: ID } } });
    expect(await resolveProjectId(folder, runner, exists)).toEqual({ state: "set", projectId: ID });
  });

  test("an ID that app.config.js adds to app.json resolves as set", async () => {
    write({
      "app.json": JSON.stringify({ expo: { name: "a" } }),
      "app.config.js": `module.exports = ({ config }) => ({ ...config, extra: { eas: { projectId: "${ID}" } } });`,
    });
    const { runner } = withExpo({ name: "a", extra: { eas: { projectId: ID } } });
    expect(await resolveProjectId(folder, runner, exists)).toEqual({ state: "set", projectId: ID });
  });

  test("an ID that app.config.js drops from app.json resolves as not set", async () => {
    write({
      "app.json": JSON.stringify({ expo: { name: "a", extra: { eas: { projectId: ID } } } }),
      "app.config.js": "module.exports = ({ config }) => ({ ...config, extra: {} });",
    });
    const { runner } = withExpo({ name: "a", extra: {} });
    expect(await resolveProjectId(folder, runner, exists)).toEqual({ state: "not-set" });
  });

  test("a failing expo config is unresolved with its first stderr line", async () => {
    write({ "node_modules/.bin/expo": "" });
    const runner: Runner = async () => ({ code: 1, stdout: "", stderr: "SyntaxError: x\nmore" });
    expect(await resolveProjectId(folder, runner, exists)).toEqual({
      state: "unresolved",
      reason: "expo config failed: SyntaxError: x",
    });
  });

  test("output that is not JSON is unresolved", async () => {
    write({ "node_modules/.bin/expo": "" });
    const runner: Runner = async () => ({ code: 0, stdout: "warning", stderr: "" });
    expect((await resolveProjectId(folder, runner, exists)).state).toBe("unresolved");
  });
});

describe("resolveProjectId without a local expo", () => {
  test("reads app.json statically when there is no dynamic config", async () => {
    write({ "app.json": JSON.stringify({ expo: { extra: { eas: { projectId: ID } } } }) });
    expect(await resolveProjectId(folder, noRunner, exists)).toEqual({
      state: "set",
      projectId: ID,
    });
  });

  test("an app.json without the ID is not set", async () => {
    write({ "app.json": JSON.stringify({ expo: { name: "a" } }) });
    expect(await resolveProjectId(folder, noRunner, exists)).toEqual({ state: "not-set" });
  });

  test("a dynamic config is unresolved and names the file", async () => {
    write({ "app.json": "{}", "app.config.ts": "export default {};" });
    const r = await resolveProjectId(folder, noRunner, exists);
    expect(r.state).toBe("unresolved");
    expect((r as { reason: string }).reason).toContain("app.config.ts");
  });

  test("invalid app.json is unresolved", async () => {
    write({ "app.json": "{" });
    expect((await resolveProjectId(folder, noRunner, exists)).state).toBe("unresolved");
  });
});

describe("ProjectIdCache", () => {
  test("resolves a folder once until it is cleared", async () => {
    const cache = new ProjectIdCache();
    let runs = 0;
    const resolve = async (): Promise<ProjectId> => (runs++, { state: "not-set" });
    await cache.get("/a", resolve);
    await cache.get("/a", resolve);
    expect(runs).toBe(1);
    cache.clear("/a");
    await cache.get("/a", resolve);
    expect(runs).toBe(2);
    await cache.get("/b", resolve);
    cache.clear();
    await cache.get("/b", resolve);
    expect(runs).toBe(4);
  });
});
