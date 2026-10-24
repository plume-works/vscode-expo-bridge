import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { ExecResult, Runner } from "../src/exec";
import { realRunner } from "../src/exec";
import { BuildCache } from "../src/buildcache";
import { build, BuildError, type BuildDeps } from "../src/build";

let hostPath: string;
let storage: string;
const BINS = "/opt/homebrew/bin";

beforeEach(() => {
  hostPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-build-")));
  storage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-storage-")));
  fs.writeFileSync(
    path.join(hostPath, "eas.json"),
    JSON.stringify({ build: { development: { ios: { simulator: true } }, production: {} } }),
  );
});

afterEach(() => {
  fs.rmSync(hostPath, { recursive: true, force: true });
  fs.rmSync(storage, { recursive: true, force: true });
});

interface Captured {
  file: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

/** A runner that records the invocation and drops an artifact in the build dir. */
function recordingRunner(
  captured: Captured[],
  result: ExecResult = { code: 0, stdout: "log", stderr: "" },
): Runner {
  return {
    async run(file, args, opts) {
      captured.push({ file, args, env: opts?.env ?? {}, cwd: opts?.cwd });
      const outDir = opts?.env?.EAS_LOCAL_BUILD_ARTIFACTS_DIR;
      if (outDir) fs.writeFileSync(path.join(outDir, "build-123.tar.gz"), "ARTIFACT");
      return result;
    },
  };
}

function deps(partial: Partial<BuildDeps> = {}): BuildDeps {
  return {
    hostPath,
    folderHostPath: hostPath,
    globalStorage: storage,
    hostVersion: "0.3.0",
    env: { PATH: BINS },
    token: "robot-token",
    runner: recordingRunner([]),
    fileExists: (p) => p === `${BINS}/bun` || fs.existsSync(p),
    confirmed: true,
    now: () => 123,
    ...partial,
  };
}

describe("validation", () => {
  test("rejects a profile absent from eas.json", async () => {
    try {
      await build("staging", deps());
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BuildError).error.code).toBe("not-found");
    }
  });

  test("rejects an invalid profile name", async () => {
    try {
      await build("a b; rm -rf /", deps());
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BuildError).error.code).toBe("bad-argument");
    }
  });

  test("an unconfirmed build is refused", async () => {
    try {
      await build("development", deps({ confirmed: false }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BuildError).error.code).toBe("build-declined");
    }
  });
});

describe("invocation", () => {
  test("leaves nothing in private storage once the artifact is copied out", async () => {
    const r = await build("development", deps({ runner: recordingRunner([]) }));
    expect(r.artifactRel).not.toBe("");
    expect(fs.readdirSync(storage)).toEqual([]);
  });

  const easJson = (cli: unknown) =>
    fs.writeFileSync(
      path.join(hostPath, "eas.json"),
      JSON.stringify({ cli, build: { development: { ios: { simulator: true } } } }),
    );

  test("runs the eas-cli version eas.json's cli.version pins", async () => {
    easJson({ version: ">= 16.0.0" });
    const captured: Captured[] = [];
    await build("development", deps({ runner: recordingRunner(captured) }));
    expect(captured[0]!.args.slice(0, 3)).toEqual(["x", "eas-cli@>=16.0.0", "build"]);
  });

  test("refuses a cli.version that is not a version range", async () => {
    easJson({ version: "file:../evil" });
    const captured: Captured[] = [];
    try {
      await build("development", deps({ runner: recordingRunner(captured) }));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BuildError).error.code).toBe("bad-argument");
    }
    expect(captured).toHaveLength(0);
  });

  test("runs eas build --local with the right args, env, and cwd", async () => {
    const captured: Captured[] = [];
    await build("development", deps({ runner: recordingRunner(captured) }));
    expect(captured).toHaveLength(1);
    const c = captured[0]!;
    expect(c.file).toBe(`${BINS}/bun`);
    expect(c.args).toEqual([
      "x",
      "eas-cli@latest",
      "build",
      "--local",
      "--non-interactive",
      "-p",
      "ios",
      "--profile",
      "development",
    ]);
    expect(c.cwd).toBe(hostPath);
    expect(c.env.EAS_NO_VCS).toBe("1");
    expect(c.env.EXPO_TOKEN).toBe("robot-token");
    expect(c.env.EAS_LOCAL_BUILD_ARTIFACTS_DIR?.startsWith(storage)).toBe(true);
  });

  test("never passes an 'init' invocation", async () => {
    const captured: Captured[] = [];
    await build("development", deps({ runner: recordingRunner(captured) }));
    expect(captured.some((c) => c.args.includes("init"))).toBe(false);
  });

  test("copies the artifact and log under .tmp/expo-bridge and returns relative paths", async () => {
    const r = await build("development", deps());
    expect(r.artifactRel.startsWith(".tmp/expo-bridge/")).toBe(true);
    expect(r.logRel.startsWith(".tmp/expo-bridge/")).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(fs.existsSync(path.join(hostPath, r.artifactRel))).toBe(true);
    expect(fs.readFileSync(path.join(hostPath, r.artifactRel), "utf8")).toBe("ARTIFACT");
  });

  test("writes the log under .tmp/expo-bridge while eas is still running", async () => {
    const seenMidBuild: string[] = [];
    const runner: Runner = {
      async run(_file, _args, opts) {
        opts?.onOutput?.("step one\n");
        const dir = path.join(hostPath, ".tmp", "expo-bridge");
        for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".log"))) {
          seenMidBuild.push(fs.readFileSync(path.join(dir, f), "utf8"));
        }
        opts?.onOutput?.("step two\n");
        return { code: 0, stdout: "step one\nstep two\n", stderr: "" };
      },
    };
    const r = await build("development", deps({ runner }));
    const easLines = (log: string) => log.split("\n").filter((l) => !l.startsWith("expo-bridge: "));
    expect(seenMidBuild.map(easLines)).toEqual([["step one", ""]]);
    expect(easLines(fs.readFileSync(path.join(hostPath, r.logRel), "utf8"))).toEqual([
      "step one",
      "step two",
      "",
    ]);
  });

  test("reports a non-zero exit code", async () => {
    const r = await build(
      "development",
      deps({ runner: recordingRunner([], { code: 65, stdout: "", stderr: "boom" }) }),
    );
    expect(r.exitCode).toBe(65);
  });

  test("omits EXPO_TOKEN from the env when none is stored", async () => {
    const captured: Captured[] = [];
    await build("development", deps({ token: undefined, runner: recordingRunner(captured) }));
    expect("EXPO_TOKEN" in captured[0]!.env).toBe(false);
  });
});

describe("reuse", () => {
  const HASH = "0123456789abcdef0123456789abcdef01234567";
  const XCODEBUILD = `${BINS}/xcodebuild`;

  interface Reuse {
    fingerprint?: ExecResult;
    easExit?: number;
    /** Files in the built `.app`; `main.jsbundle` marks a build with an embedded bundle. */
    appFiles?: string[];
    calls: string[][];
  }

  /** node prints the fingerprint, the probes print versions, tar runs for real. */
  function reuseRunner(o: Reuse): Runner {
    return {
      async run(file, args, opts) {
        o.calls.push([file, ...args]);
        if (file === `${BINS}/node`) {
          return o.fingerprint ?? { code: 0, stdout: `${HASH}\n`, stderr: "" };
        }
        if (file === XCODEBUILD) return { code: 0, stdout: "Xcode 27.0", stderr: "" };
        // the stub env has no gzip on its PATH
        if (file === "/usr/bin/tar") return realRunner.run("tar", args, { env: hostEnv });
        if (args.includes("--version")) return { code: 0, stdout: "eas-cli/25.3.0", stderr: "" };
        const outDir = opts!.env!.EAS_LOCAL_BUILD_ARTIFACTS_DIR!;
        const app = path.join(outDir, ".src", "App.app");
        fs.mkdirSync(app, { recursive: true });
        for (const f of o.appFiles ?? ["Info.plist"]) fs.writeFileSync(path.join(app, f), f);
        const art = path.join(outDir, "build-1.tar.gz");
        execFileSync("tar", ["-czf", art, "-C", path.dirname(app), "App.app"]);
        fs.rmSync(path.join(outDir, ".src"), { recursive: true });
        return { code: o.easExit ?? 0, stdout: "", stderr: "" };
      },
    };
  }

  const hostEnv = { PATH: process.env.PATH ?? "" };
  let clock = 1000;
  const reuseDeps = (o: Reuse, partial: Partial<BuildDeps> = {}) =>
    deps({
      runner: reuseRunner(o),
      fileExists: (p) =>
        [`${BINS}/bun`, `${BINS}/node`, XCODEBUILD].includes(p) || fs.existsSync(p),
      now: () => ++clock,
      ...partial,
    });
  const easBuilds = (calls: string[][]) => calls.filter((c) => c.includes("--local")).length;
  const log = (r: { logRel: string }) => fs.readFileSync(path.join(hostPath, r.logRel), "utf8");

  beforeEach(() => {
    fs.writeFileSync(path.join(hostPath, "package.json"), '{"name":"app"}');
  });

  test("a first build is built with no-match and stored; a repeat build is reused", async () => {
    const calls: string[][] = [];
    const first = await build("development", reuseDeps({ calls }));
    expect(first).toMatchObject({ mode: "built", reason: "no-match", exitCode: 0 });
    expect(first.reusedBuiltAt).toBeUndefined();

    const second = await build("development", reuseDeps({ calls }));
    expect(second.mode).toBe("reused");
    expect(second.exitCode).toBe(0);
    expect(second.reason).toBeUndefined();
    expect(typeof second.reusedBuiltAt).toBe("number");
    expect(easBuilds(calls)).toBe(1);
    expect(second.artifactRel).toMatch(/^\.tmp\/expo-bridge\/build-\d+\.tar\.gz$/);
    expect(second.artifactRel).not.toBe(first.artifactRel);
    expect(fs.readFileSync(path.join(hostPath, second.artifactRel))).toEqual(
      fs.readFileSync(path.join(hostPath, first.artifactRel)),
    );
    expect(log(second)).toContain(`fingerprint ${HASH}`);
    expect(log(second)).toMatch(/cache key [0-9a-f]{64}/);
    expect(log(second)).toContain("reused the artifact built at");
  });

  test("a changed input builds in full with no-match", async () => {
    const calls: string[][] = [];
    await build("development", reuseDeps({ calls }));
    fs.writeFileSync(path.join(hostPath, "package.json"), '{"name":"app","version":"2"}');
    const r = await build("development", reuseDeps({ calls }));
    expect(r).toMatchObject({ mode: "built", reason: "no-match" });
    expect(easBuilds(calls)).toBe(2);
  });

  test("no fingerprint builds in full with no-fingerprint and stores nothing", async () => {
    const calls: string[][] = [];
    const o = { calls, fingerprint: { code: 1, stdout: "", stderr: "no expo" } };
    const r = await build("development", reuseDeps(o));
    expect(r).toMatchObject({ mode: "built", reason: "no-fingerprint", exitCode: 0 });
    expect(log(r)).toContain("fingerprint unavailable");
    expect(await build("development", reuseDeps(o))).toMatchObject({ mode: "built" });
    expect(easBuilds(calls)).toBe(2);
  });

  test("a fingerprint without a key is also no-fingerprint", async () => {
    fs.rmSync(path.join(hostPath, "package.json"));
    const r = await build("development", reuseDeps({ calls: [] }));
    expect(r).toMatchObject({ mode: "built", reason: "no-fingerprint" });
    expect(log(r)).toContain("cache key unavailable");
  });

  test("clean skips the lookup, builds in full, and stores under the key computed after", async () => {
    const calls: string[][] = [];
    await build("development", reuseDeps({ calls }));
    const before = calls.length;
    const r = await build("development", reuseDeps({ calls }), { clean: true });
    expect(r).toMatchObject({ mode: "built", reason: "clean-requested", exitCode: 0 });
    const cleanCalls = calls.slice(before);
    const easAt = cleanCalls.findIndex((c) => c.includes("--local"));
    const nodeAt = cleanCalls.findIndex((c) => c[0] === `${BINS}/node`);
    expect(easAt).toBeGreaterThanOrEqual(0);
    expect(nodeAt).toBeGreaterThan(easAt);

    const again = await build("development", reuseDeps({ calls }));
    expect(again.mode).toBe("reused");
    expect(again.reusedBuiltAt).toBeGreaterThan(1000);
  });

  test("a failed build is not stored", async () => {
    const calls: string[][] = [];
    const failed = await build("development", reuseDeps({ calls, easExit: 65 }));
    expect(failed).toMatchObject({ mode: "built", reason: "no-match", exitCode: 65 });
    expect(log(failed)).not.toContain("stored the artifact");
    const next = await build("development", reuseDeps({ calls }));
    expect(next).toMatchObject({ mode: "built", reason: "no-match" });
    expect(easBuilds(calls)).toBe(2);
  });

  test("a build that embeds main.jsbundle is never stored", async () => {
    const calls: string[][] = [];
    const o = { calls, appFiles: ["Info.plist", "main.jsbundle"] };
    const r = await build("development", reuseDeps(o));
    expect(log(r)).toContain("the artifact was not stored for reuse");
    expect((await build("development", reuseDeps(o))).mode).toBe("built");
    expect(easBuilds(calls)).toBe(2);
  });

  test("the cache is the folder's own, under the host path", async () => {
    const calls: string[][] = [];
    await build("development", reuseDeps({ calls }));
    const tar = { runner: realRunner, env: hostEnv, tar: "tar" };
    const own = new BuildCache(storage, hostPath, hostPath, tar);
    expect(fs.readdirSync(own.dir).filter((f) => f.endsWith(".tar.gz"))).toHaveLength(1);
    const other = await build("development", reuseDeps({ calls }, { hostPath: "/elsewhere" }));
    expect(other.mode).toBe("built");
  });

  test("the log names no file's contents", async () => {
    fs.writeFileSync(path.join(hostPath, "package.json"), '{"name":"SECRET-CONTENT"}');
    const r = await build("development", reuseDeps({ calls: [] }));
    expect(log(r)).not.toContain("SECRET-CONTENT");
  });

  test("an unconfirmed build runs no fingerprint step", async () => {
    const calls: string[][] = [];
    await expect(build("development", reuseDeps({ calls }, { confirmed: false }))).rejects.toThrow(
      BuildError,
    );
    expect(calls).toEqual([]);
  });
});
