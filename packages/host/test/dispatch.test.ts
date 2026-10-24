import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PROTOCOL_VERSION, type StatusResult } from "@plume-works/expo-bridge-protocol";
import type { InstalledApp } from "../src/install";
import { dispatch, type DispatchDeps } from "../src/dispatch";
import type { Runner } from "../src/exec";
import type { StatusDeps } from "../src/status";

let hostPath: string;
let storage: string;
const BINS = "/opt/homebrew/bin";
const FOLDER = "/workspaces/app";
let lastApp: InstalledApp | undefined;

beforeEach(() => {
  hostPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-disp-")));
  storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-disp-store-")));
  fs.mkdirSync(path.join(hostPath, ".tmp", "expo-bridge"), { recursive: true });
  fs.writeFileSync(path.join(hostPath, "eas.json"), JSON.stringify({ build: { development: {} } }));
  lastApp = undefined;
});

afterEach(() => {
  fs.rmSync(hostPath, { recursive: true, force: true });
  fs.rmSync(storage, { recursive: true, force: true });
});

const okRunner: Runner = {
  async run(file, args) {
    const a = args ?? [];
    if (file.endsWith("tar")) {
      const dest = a[a.indexOf("-C") + 1]!;
      const app = path.join(dest, "A.app");
      fs.mkdirSync(app, { recursive: true });
      fs.writeFileSync(
        path.join(app, "Info.plist"),
        `<plist><dict><key>CFBundleIdentifier</key><string>com.a</string></dict></plist>`,
      );
    }
    if (file.endsWith("/bun") && a[1]?.startsWith("eas-cli@")) {
      const out = process.env.EAS_LOCAL_BUILD_ARTIFACTS_DIR;
      if (out) fs.writeFileSync(path.join(out, "a.tar.gz"), "X");
    }
    return { code: 0, stdout: "", stderr: "" };
  },
};

function deps(partial: Partial<DispatchDeps> = {}): DispatchDeps {
  const fileExists = (p: string) =>
    p === `${BINS}/xcrun` || p === `${BINS}/tar` || p === `${BINS}/bun` || fs.existsSync(p);
  const simContext = (folderHostPath: string) => ({
    folderHostPath,
    globalStorage: storage,
    env: { PATH: BINS },
    runner: okRunner,
    fileExists,
    getLastApp: () => lastApp,
    setLastApp: (app: InstalledApp) => (lastApp = app),
    now: () => 1,
  });
  return {
    hostPath,
    mapFolder: async () => ({ ok: true, folderHostPath: hostPath }),
    statusDeps: async (_req, folder): Promise<StatusDeps> => ({
      platform: "darwin",
      hostPathExists: true,
      folder,
      trusted: true,
      hasToken: true,
      env: { PATH: BINS },
      runner: {
        async run() {
          return { code: 0, stdout: "", stderr: "" };
        },
      },
      fileExists: () => false,
      port8081Forwarded: true,
    }),
    confirmBuild: async () => true,
    ensureTrusted: async () => true,
    buildDeps: async (folderHostPath) => ({
      hostPath,
      folderHostPath,
      globalStorage: storage,
      hostVersion: "0.3.0",
      env: { PATH: BINS },
      token: "t",
      runner: {
        async run(_f, _a, opts) {
          const out = opts?.env?.EAS_LOCAL_BUILD_ARTIFACTS_DIR;
          if (out) fs.writeFileSync(path.join(out, "a.tar.gz"), "X");
          return { code: 0, stdout: "log", stderr: "" };
        },
      },
      fileExists,
      confirmed: true,
      now: () => 1,
    }),
    simContext,
    ...partial,
  };
}

describe("dispatch", () => {
  test("rejects a malformed request", async () => {
    const r = await dispatch({ action: "evil" }, deps());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("bad-request");
  });

  test("status on a trusted workspace never prompts and reports the protocol version", async () => {
    let trustCalled = false;
    const r = await dispatch(
      { action: "status", folder: FOLDER },
      deps({ ensureTrusted: async () => ((trustCalled = true), true) }),
    );
    expect(r.ok).toBe(true);
    if (r.ok)
      expect((r.result as { protocolVersion: number }).protocolVersion).toBe(PROTOCOL_VERSION);
    expect(trustCalled).toBe(false);
  });

  test("status on an untrusted workspace asks for trust and reports the answer", async () => {
    const base = deps();
    for (const answer of [true, false]) {
      let trustCalled = false;
      const r = await dispatch(
        { action: "status", folder: FOLDER },
        {
          ...base,
          statusDeps: async (req, folder) => ({
            ...(await base.statusDeps(req, folder)),
            trusted: false,
          }),
          ensureTrusted: async () => ((trustCalled = true), answer),
        },
      );
      expect(trustCalled).toBe(true);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(
          (r.result as { checks: { workspaceTrusted: { ok: boolean } } }).checks.workspaceTrusted
            .ok,
        ).toBe(answer);
      }
    }
  });

  test("status never asks for trust when the bridge is unavailable", async () => {
    const base = deps();
    let trustCalled = false;
    await dispatch(
      { action: "status", folder: FOLDER },
      {
        ...base,
        statusDeps: async (req, folder) => ({
          ...(await base.statusDeps(req, folder)),
          platform: "linux",
          trusted: false,
        }),
        ensureTrusted: async () => ((trustCalled = true), true),
      },
    );
    expect(trustCalled).toBe(false);
  });

  test("a build request's clean reaches the build, and only true counts", async () => {
    for (const [clean, reason] of [
      [true, "clean-requested"],
      [undefined, "no-fingerprint"],
      ["yes", "no-fingerprint"],
    ] as const) {
      const r = await dispatch(
        { action: "build", profile: "development", folder: FOLDER, clean } as never,
        deps(),
      );
      expect(r.ok && (r.result as { reason?: string }).reason).toBe(reason);
    }
  });

  test("the build confirmation learns whether the build is clean", async () => {
    const seen: boolean[] = [];
    for (const clean of [true, undefined]) {
      await dispatch(
        { action: "build", profile: "development", folder: FOLDER, clean },
        deps({ confirmBuild: async (_p, _f, c) => (seen.push(c), false) }),
      );
    }
    expect(seen).toEqual([true, false]);
  });

  test("a declined build confirmation returns build-declined and never runs the build", async () => {
    let buildDepsCalled = false;
    const r = await dispatch(
      { action: "build", profile: "development", folder: FOLDER },
      deps({
        confirmBuild: async () => false,
        buildDeps: async () => ((buildDepsCalled = true), {} as never),
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("build-declined");
    expect(buildDepsCalled).toBe(false);
  });

  test("an untrusted workspace blocks install/launch/screenshot", async () => {
    for (const action of ["install", "launch", "screenshot"] as const) {
      const req =
        action === "install"
          ? { action, artifactRel: ".tmp/expo-bridge/x", folder: FOLDER }
          : { action, folder: FOLDER };
      const r = await dispatch(req, deps({ ensureTrusted: async () => false }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("untrusted");
    }
  });

  test("unavailable when the host path cannot be resolved (non-status action)", async () => {
    const r = await dispatch({ action: "launch", folder: FOLDER }, deps({ hostPath: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unavailable");
  });

  test("a request without an absolute folder is a bad request", async () => {
    for (const req of [{ action: "status" }, { action: "launch", folder: "workspaces/app" }]) {
      const r = await dispatch(req, deps());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("bad-request");
    }
  });

  test("every action runs at the folder's Mac path, mapped before it runs", async () => {
    const app = path.join(hostPath, "apps", "mobile");
    const mapped: string[] = [];
    const at: string[] = [];
    const d = deps({
      mapFolder: async (folder) => (mapped.push(folder), { ok: true, folderHostPath: app }),
    });
    await dispatch(
      { action: "build", profile: "development", folder: FOLDER },
      {
        ...d,
        confirmBuild: async (_p, folderHostPath) => (at.push(folderHostPath), false),
      },
    );
    for (const action of ["launch", "screenshot"] as const) {
      await dispatch(
        { action, folder: FOLDER },
        { ...d, simContext: (folderHostPath) => (at.push(folderHostPath), d.simContext(app)) },
      );
    }
    expect(mapped).toEqual([FOLDER, FOLDER, FOLDER]);
    expect(at).toEqual([app, app, app]);
  });

  test("a folder that does not map is unavailable, and nothing runs or prompts", async () => {
    let prompted = false;
    const d = deps({
      mapFolder: async () => ({ ok: false, detail: "no bind mount of the container holds it" }),
      confirmBuild: async () => ((prompted = true), true),
      ensureTrusted: async () => ((prompted = true), true),
    });
    for (const req of [
      { action: "build", profile: "development", folder: FOLDER },
      { action: "launch", folder: FOLDER },
    ]) {
      const r = await dispatch(req, d);
      expect(r).toEqual({
        ok: false,
        error: { code: "unavailable", message: "no bind mount of the container holds it" },
      });
    }
    expect(prompted).toBe(false);
  });

  test("status reports an unmapped folder as unavailable without asking for trust", async () => {
    const base = deps();
    let trustCalled = false;
    const r = await dispatch(
      { action: "status", folder: FOLDER },
      {
        ...base,
        mapFolder: async () => ({ ok: false, detail: "several running containers match" }),
        statusDeps: async (req, folder) => ({
          ...(await base.statusDeps(req, folder)),
          trusted: false,
        }),
        ensureTrusted: async () => ((trustCalled = true), true),
      },
    );
    expect(trustCalled).toBe(false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const result = r.result as StatusResult;
      expect(result.available).toBe(false);
      expect(result.folderHostPath).toBe("");
      expect(result.checks.workspaceMapped).toEqual({
        ok: false,
        detail: "several running containers match",
      });
    }
  });

  test("no folder is mapped without a host path", async () => {
    let mapped = false;
    const r = await dispatch(
      { action: "status", folder: FOLDER },
      deps({ hostPath: null, mapFolder: async () => ((mapped = true), { ok: false, detail: "" }) }),
    );
    expect(mapped).toBe(false);
    if (r.ok) expect((r.result as StatusResult).available).toBe(false);
  });

  test("a full build routes through and returns an artifact path", async () => {
    const r = await dispatch({ action: "build", profile: "development", folder: FOLDER }, deps());
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(
        (r.result as { artifactRel: string }).artifactRel.startsWith(".tmp/expo-bridge/"),
      ).toBe(true);
  });
});
