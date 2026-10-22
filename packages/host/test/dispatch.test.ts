import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PROTOCOL_VERSION } from "@plume-works/expo-bridge-protocol";
import { dispatch, type DispatchDeps } from "../src/dispatch";
import type { Runner } from "../src/exec";
import type { StatusDeps } from "../src/status";

let hostPath: string;
let storage: string;
const BINS = "/opt/homebrew/bin";
let lastBundle: string | undefined;

beforeEach(() => {
  hostPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-disp-")));
  storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-disp-store-")));
  fs.mkdirSync(path.join(hostPath, ".tmp", "expo-bridge"), { recursive: true });
  fs.writeFileSync(path.join(hostPath, "eas.json"), JSON.stringify({ build: { development: {} } }));
  lastBundle = undefined;
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
  const simContext = () => ({
    hostPath,
    globalStorage: storage,
    env: { PATH: BINS },
    runner: okRunner,
    fileExists,
    getLastBundleId: () => lastBundle,
    setLastBundleId: (id: string) => (lastBundle = id),
    now: () => 1,
  });
  return {
    hostPath,
    statusDeps: async (): Promise<StatusDeps> => ({
      platform: "darwin",
      hostPath,
      hostPathExists: true,
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
    buildDeps: async () => ({
      hostPath,
      globalStorage: storage,
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
      { action: "status" },
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
        { action: "status" },
        {
          ...base,
          statusDeps: async (req) => ({ ...(await base.statusDeps(req)), trusted: false }),
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
      { action: "status" },
      {
        ...base,
        statusDeps: async (req) => ({
          ...(await base.statusDeps(req)),
          platform: "linux",
          trusted: false,
        }),
        ensureTrusted: async () => ((trustCalled = true), true),
      },
    );
    expect(trustCalled).toBe(false);
  });

  test("a declined build confirmation returns build-declined and never runs the build", async () => {
    let buildDepsCalled = false;
    const r = await dispatch(
      { action: "build", profile: "development" },
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
      const req = action === "install" ? { action, artifactRel: ".tmp/expo-bridge/x" } : { action };
      const r = await dispatch(req, deps({ ensureTrusted: async () => false }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("untrusted");
    }
  });

  test("unavailable when the host path cannot be resolved (non-status action)", async () => {
    const r = await dispatch({ action: "launch" }, deps({ hostPath: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unavailable");
  });

  test("a full build routes through and returns an artifact path", async () => {
    const r = await dispatch({ action: "build", profile: "development" }, deps());
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(
        (r.result as { artifactRel: string }).artifactRel.startsWith(".tmp/expo-bridge/"),
      ).toBe(true);
  });
});
