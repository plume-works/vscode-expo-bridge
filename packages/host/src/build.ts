import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildResult, ProtocolError } from "@plume-works/expo-bridge-protocol";
import { WRITE_DIR_REL } from "@plume-works/expo-bridge-protocol";
import type { Runner } from "./exec";
import { lookupTool } from "./env";
import { readJsonFile } from "./jsonfile";
import { openFreshWrite } from "./paths";

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
 * Run `eas build --local` for a simulator profile and leave the artifact and log under
 * `.tmp/expo-bridge/`. Validates the profile against `eas.json`, never runs `eas init`,
 * and builds into private global storage before copying into the workspace under the
 * fresh-write rule. The caller has already gated trust and the confirmation.
 */
export async function build(profile: string, d: BuildDeps): Promise<BuildResult> {
  if (!d.confirmed) throw new BuildError({ code: "build-declined", message: "build not confirmed" });
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

  const eas = lookupTool("eas", d.env, d.fileExists) ?? lookupTool("eas-cli", d.env, d.fileExists);
  if (!eas) throw new BuildError({ code: "action-failed", message: "eas-cli not found" });

  const buildDir = path.join(d.globalStorage, `build-${d.now()}`);
  fs.mkdirSync(buildDir, { recursive: true });

  const env: Record<string, string> = {
    ...d.env,
    EAS_NO_VCS: "1",
    EAS_LOCAL_BUILD_ARTIFACTS_DIR: buildDir,
    CI: "1",
  };
  if (d.token) env.EXPO_TOKEN = d.token;

  const logPath = path.join(buildDir, "build.log");
  const r = await d.runner.run(
    eas,
    ["build", "--local", "--non-interactive", "-p", "ios", "--profile", profile],
    { env, cwd: d.hostPath },
  );
  fs.writeFileSync(logPath, r.stdout + r.stderr);

  const outDir = path.join(d.hostPath, WRITE_DIR_REL);
  fs.mkdirSync(outDir, { recursive: true });

  const artifact = fs.readdirSync(buildDir).find((f) => f !== "build.log" && !f.startsWith("."));
  const copiedLog = copyFresh(logPath, path.join(outDir, `build-${d.now()}.log`));
  let artifactRel = "";
  if (artifact) {
    const dest = copyFresh(path.join(buildDir, artifact), path.join(outDir, artifact));
    artifactRel = path.relative(d.hostPath, dest);
  }

  return {
    artifactRel,
    logRel: path.relative(d.hostPath, copiedLog),
    exitCode: r.code,
  };
}

/** Copy a file into a fresh O_EXCL|O_NOFOLLOW destination, returning the written path. */
function copyFresh(src: string, dest: string): string {
  let target = dest;
  for (let i = 0; ; i++) {
    try {
      const fd = openFreshWrite(target);
      try {
        fs.writeSync(fd, fs.readFileSync(src));
      } finally {
        fs.closeSync(fd);
      }
      return target;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST" && i < 100) {
        const ext = path.extname(dest);
        target = dest.slice(0, dest.length - ext.length) + `-${i}` + ext;
        continue;
      }
      throw e;
    }
  }
}
