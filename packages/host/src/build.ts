import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildResult, ProtocolError } from "@plume-works/expo-bridge-protocol";
import { WRITE_DIR_REL } from "@plume-works/expo-bridge-protocol";
import type { Runner } from "./exec";
import { EasCliError, easCliSpec } from "./eascli";
import { lookupTool } from "./env";
import { readJsonFile } from "./jsonfile";
import { copyFresh, openFreshUnique } from "./paths";

export class BuildError extends Error {
  constructor(readonly error: ProtocolError) {
    super(error.message);
  }
}

const PROFILE_RE = /^[A-Za-z0-9_-]+$/;

export interface BuildDeps {
  hostPath: string;
  /** The host extension's private global storage, where the artifact is built first. */
  globalStorage: string;
  env: Record<string, string>;
  token: string | undefined;
  runner: Runner;
  fileExists: (p: string) => boolean;
  /** Already passed trust + the build confirmation; build() does not prompt. */
  confirmed: boolean;
  now: () => number;
}

/** Profiles declared in the workspace's `eas.json` `build` map. */
export function profilesOf(easJson: unknown): string[] {
  const build = (easJson as { build?: Record<string, unknown> })?.build;
  return build && typeof build === "object" ? Object.keys(build) : [];
}

/**
 * Run `eas build --local` through `bunx eas-cli@<spec>` for a simulator profile and leave
 * the artifact and log under `.tmp/expo-bridge/`. Validates the profile against
 * `eas.json`, never runs `eas init`, and builds into private global storage before copying
 * into the workspace under the fresh-write rule. The caller has already gated trust and the confirmation.
 */
export async function build(profile: string, d: BuildDeps): Promise<BuildResult> {
  if (!d.confirmed)
    throw new BuildError({ code: "build-declined", message: "build not confirmed" });
  if (!PROFILE_RE.test(profile)) {
    throw new BuildError({ code: "bad-argument", message: "invalid profile name" });
  }

  const easJsonPath = path.join(d.hostPath, "eas.json");
  if (!d.fileExists(easJsonPath)) {
    throw new BuildError({ code: "not-found", message: "eas.json not found" });
  }
  const profiles = profilesOf(readJsonFile(easJsonPath));
  if (!profiles.includes(profile)) {
    throw new BuildError({ code: "not-found", message: "profile not found in eas.json" });
  }

  const bun = lookupTool("bun", d.env, d.fileExists);
  if (!bun) throw new BuildError({ code: "action-failed", message: "bun not found" });
  let spec: string;
  try {
    spec = easCliSpec(d.hostPath, d.fileExists);
  } catch (e) {
    if (e instanceof EasCliError)
      throw new BuildError({ code: "bad-argument", message: e.message });
    throw e;
  }

  const buildDir = path.join(d.globalStorage, `build-${d.now()}`);
  fs.mkdirSync(buildDir, { recursive: true });

  const env: Record<string, string> = {
    ...d.env,
    EAS_NO_VCS: "1",
    EAS_LOCAL_BUILD_ARTIFACTS_DIR: buildDir,
    CI: "1",
  };
  if (d.token) env.EXPO_TOKEN = d.token;

  const outDir = path.join(d.hostPath, WRITE_DIR_REL);
  fs.mkdirSync(outDir, { recursive: true });
  const { fd: logFd, written: logPath } = openFreshUnique(
    path.join(outDir, `build-${d.now()}.log`),
  );
  let r;
  try {
    r = await d.runner.run(
      bun,
      [
        "x",
        `eas-cli@${spec}`,
        "build",
        "--local",
        "--non-interactive",
        "-p",
        "ios",
        "--profile",
        profile,
      ],
      { env, cwd: d.hostPath, onOutput: (chunk) => fs.writeSync(logFd, chunk) },
    );
  } finally {
    fs.closeSync(logFd);
  }

  const artifact = fs.readdirSync(buildDir).find((f) => !f.startsWith("."));
  let artifactRel = "";
  if (artifact) {
    const dest = copyFresh(path.join(buildDir, artifact), path.join(outDir, artifact));
    artifactRel = path.relative(d.hostPath, dest);
  }

  return {
    artifactRel,
    logRel: path.relative(d.hostPath, logPath),
    exitCode: r.code,
  };
}
