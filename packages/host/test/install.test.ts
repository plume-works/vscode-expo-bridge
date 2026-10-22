import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecResult, Runner } from "../src/exec";
import { ActionError, install, launch, screenshot, type SimContext } from "../src/install";

let hostPath: string;
let storage: string;
const BINS = "/opt/homebrew/bin";
const SIM = "SIM-UDID-1";
let lastBundleId: string | undefined;

beforeEach(() => {
  hostPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-install-")));
  storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-store-")));
  fs.mkdirSync(path.join(hostPath, ".tmp", "expo-bridge"), { recursive: true });
  lastBundleId = undefined;
});

afterEach(() => {
  fs.rmSync(hostPath, { recursive: true, force: true });
  fs.rmSync(storage, { recursive: true, force: true });
});

interface Captured {
  file: string;
  args: string[];
}

/**
 * A runner that fakes `tar -x` (writing a .app whose Info.plist is binary, as a simulator
 * build's is), `plutil -convert json`, and simctl, with one simulator already booted.
 */
function runner(
  captured: Captured[],
  simResult: ExecResult = { code: 0, stdout: "", stderr: "" },
  bundleId = "com.example.myapp",
): Runner {
  return {
    async run(file, args) {
      captured.push({ file, args: [...args] });
      if (file.endsWith("tar") && args[0] === "-xkf") {
        const destIdx = args.indexOf("-C") + 1;
        const dest = args[destIdx]!;
        const app = path.join(dest, "MyApp.app");
        fs.mkdirSync(app, { recursive: true });
        fs.writeFileSync(
          path.join(app, "Info.plist"),
          Buffer.from([0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30, 0xff]),
        );
        return { code: 0, stdout: "", stderr: "" };
      }
      if (file.endsWith("plutil")) {
        return { code: 0, stdout: JSON.stringify({ CFBundleIdentifier: bundleId }), stderr: "" };
      }
      if (args[0] === "simctl" && args[1] === "list") {
        const devices = { ios: [{ udid: SIM, name: "iPhone 17", state: "Booted" }] };
        return { code: 0, stdout: JSON.stringify({ devices }), stderr: "" };
      }
      if (args[0] === "simctl" && args[1] === "io") {
        if (simResult.code === 0) fs.writeFileSync(args[4]!, "PNGDATA");
        return simResult;
      }
      if (args[0] === "simctl") return simResult;
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

function ctx(partial: Partial<SimContext> = {}): SimContext {
  return {
    hostPath,
    globalStorage: storage,
    env: { PATH: BINS },
    runner: runner([]),
    fileExists: (p) =>
      p === `${BINS}/xcrun` || p === `${BINS}/tar` || p === `${BINS}/plutil` || fs.existsSync(p),
    getLastBundleId: () => lastBundleId,
    setLastBundleId: (id) => (lastBundleId = id),
    now: () => 1,
    ...partial,
  };
}

function writeArtifact(name = "app.tar.gz"): string {
  fs.writeFileSync(path.join(hostPath, ".tmp", "expo-bridge", name), "ARTIFACT");
  return `.tmp/expo-bridge/${name}`;
}

describe("install", () => {
  test("rejects a path outside .tmp/expo-bridge", async () => {
    fs.writeFileSync(path.join(hostPath, "eas.json"), "{}");
    try {
      await install("eas.json", ctx());
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ActionError).error.code).toBe("path-escape");
    }
  });

  test("unpacks, installs on the booted simulator by its UDID, and returns the bundle id", async () => {
    const rel = writeArtifact();
    const captured: Captured[] = [];
    const r = await install(rel, ctx({ runner: runner(captured) }));
    expect(r.bundleIdentifier).toBe("com.example.myapp");
    expect(lastBundleId).toBe("com.example.myapp");
    const simInstall = captured.find((c) => c.args[0] === "simctl" && c.args[1] === "install");
    expect(simInstall?.args.slice(0, 3)).toEqual(["simctl", "install", SIM]);
    const plutil = captured.find((c) => c.file.endsWith("plutil"));
    expect(plutil?.args.slice(0, 4)).toEqual(["-convert", "json", "-o", "-"]);
    expect(plutil?.args[4]?.startsWith(storage)).toBe(true);
  });

  test("rejects a bundle identifier that is not a reverse-DNS name", async () => {
    const rel = writeArtifact();
    const captured: Captured[] = [];
    try {
      await install(rel, ctx({ runner: runner(captured, undefined, "--evil flag") }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ActionError).error.code).toBe("bad-argument");
    }
    expect(captured.some((c) => c.args[0] === "simctl")).toBe(false);
  });

  test("rejects an artifact that unpacks a symlink", async () => {
    const rel = writeArtifact();
    const evilRunner: Runner = {
      async run(file, args) {
        if (file.endsWith("tar")) {
          const dest = args[args.indexOf("-C") + 1]!;
          fs.mkdirSync(dest, { recursive: true });
          fs.symlinkSync("/etc/passwd", path.join(dest, "link"));
          return { code: 0, stdout: "", stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    try {
      await install(rel, ctx({ runner: evilRunner }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ActionError).error.code).toBe("symlink-rejected");
    }
  });

  test("reports a simctl install failure", async () => {
    const rel = writeArtifact();
    try {
      await install(rel, ctx({ runner: runner([], { code: 1, stdout: "", stderr: "no device" }) }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ActionError).error.code).toBe("action-failed");
    }
  });
});

describe("launch", () => {
  test("launches the last-installed bundle id", async () => {
    lastBundleId = "com.example.myapp";
    const captured: Captured[] = [];
    const r = await launch(ctx({ runner: runner(captured) }));
    expect(r.bundleIdentifier).toBe("com.example.myapp");
    const c = captured.find((x) => x.args[1] === "launch");
    expect(c?.args).toEqual(["simctl", "launch", SIM, "com.example.myapp"]);
  });

  test("fails when nothing was installed", async () => {
    try {
      await launch(ctx());
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ActionError).error.code).toBe("not-found");
    }
  });
});

describe("screenshot", () => {
  test("writes a PNG under .tmp/expo-bridge and returns its relative path", async () => {
    const captured: Captured[] = [];
    const r = await screenshot(ctx({ runner: runner(captured) }));
    expect(r.screenshotRel.startsWith(".tmp/expo-bridge/")).toBe(true);
    expect(r.screenshotRel.endsWith(".png")).toBe(true);
    const c = captured.find((x) => x.args[1] === "io");
    expect(c?.args.slice(0, 4)).toEqual(["simctl", "io", SIM, "screenshot"]);
    expect(c?.args[4]?.startsWith(storage)).toBe(true);
    expect(fs.readFileSync(path.join(hostPath, r.screenshotRel), "utf8")).toBe("PNGDATA");
  });

  test("a failed capture leaves nothing under .tmp/expo-bridge", async () => {
    try {
      await screenshot(
        ctx({ runner: runner([], { code: 1, stdout: "", stderr: "No devices are booted" }) }),
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ActionError).error.code).toBe("action-failed");
    }
    expect(fs.readdirSync(path.join(hostPath, ".tmp", "expo-bridge"))).toEqual([]);
  });
});
