import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecResult, Runner } from "../src/exec";
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
    globalStorage: storage,
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
  test("runs the eas-cli version package.json pins, devDependencies first", async () => {
    fs.writeFileSync(
      path.join(hostPath, "package.json"),
      JSON.stringify({
        dependencies: { "eas-cli": "16.0.0" },
        devDependencies: { "eas-cli": ">=16.2.0 <17" },
      }),
    );
    const captured: Captured[] = [];
    await build("development", deps({ runner: recordingRunner(captured) }));
    expect(captured[0]!.args.slice(0, 3)).toEqual(["x", "eas-cli@>=16.2.0 <17", "build"]);
  });

  test("refuses a package.json eas-cli spec that is not a version range", async () => {
    fs.writeFileSync(
      path.join(hostPath, "package.json"),
      JSON.stringify({ devDependencies: { "eas-cli": "file:../evil" } }),
    );
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
    expect(seenMidBuild).toEqual(["step one\n"]);
    expect(fs.readFileSync(path.join(hostPath, r.logRel), "utf8")).toBe("step one\nstep two\n");
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
