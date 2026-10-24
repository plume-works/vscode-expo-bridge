import * as fs from "node:fs";
import * as path from "node:path";
import type { BuildReason, BuildResult, ProtocolError } from "@plume-works/expo-bridge-protocol";
import { WRITE_DIR_REL } from "@plume-works/expo-bridge-protocol";
import { BuildCache } from "./buildcache";
import { buildKey } from "./buildkey";
import type { Runner } from "./exec";
import { EasCliError, easCliSpec } from "./eascli";
import { lookupTool } from "./env";
import { projectFingerprint } from "./fingerprint";
import { readJsonFile } from "./jsonfile";
import { copyFresh, openFreshUnique } from "./paths";

export class BuildError extends Error {
  constructor(readonly error: ProtocolError) {
    super(error.message);
  }
}

const PROFILE_RE = /^[A-Za-z0-9_-]+$/;

export interface BuildDeps {
  /** The window's trusted host path, under which the folder's build cache lives. */
  hostPath: string;
  /** The Mac path of the request's folder: the build runs and writes there. */
  folderHostPath: string;
  /** The host extension's private global storage, where the artifact is built first. */
  globalStorage: string;
  /** The host extension's version, part of every cache key. */
  hostVersion: string;
  env: Record<string, string>;
  token: string | undefined;
  runner: Runner;
  fileExists: (p: string) => boolean;
  /** Already passed trust + the build confirmation; build() does not prompt. */
  confirmed: boolean;
  now: () => number;
}

export interface BuildOptions {
  /** Skip the lookup and build in full; the result is still stored. */
  clean?: boolean;
}

/** Profiles declared in the folder's `eas.json` `build` map. */
export function profilesOf(easJson: unknown): string[] {
  const build = (easJson as { build?: Record<string, unknown> })?.build;
  return build && typeof build === "object" ? Object.keys(build) : [];
}

/**
 * Reuse the folder's artifact whose cache key matches, else run `eas build --local` and store
 * its result. The caller has gated trust and the confirmation; see docs/protocol.md `build`.
 */
export async function build(
  profile: string,
  d: BuildDeps,
  opts: BuildOptions = {},
): Promise<BuildResult> {
  if (!d.confirmed)
    throw new BuildError({ code: "build-declined", message: "build not confirmed" });
  if (!PROFILE_RE.test(profile)) {
    throw new BuildError({ code: "bad-argument", message: "invalid profile name" });
  }

  const easJsonPath = path.join(d.folderHostPath, "eas.json");
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
    spec = easCliSpec(d.folderHostPath, d.fileExists);
  } catch (e) {
    if (e instanceof EasCliError)
      throw new BuildError({ code: "bad-argument", message: e.message });
    throw e;
  }

  const outDir = path.join(d.folderHostPath, WRITE_DIR_REL);
  fs.mkdirSync(outDir, { recursive: true });
  const fresh = openFreshUnique(path.join(outDir, `build-${d.now()}.log`));
  const logFd = fresh.fd;
  const logRel = path.relative(d.folderHostPath, fresh.written);
  const log = (line: string) => fs.writeSync(logFd, `expo-bridge: ${line}\n`);
  const tar = lookupTool("tar", d.env, d.fileExists) ?? "/usr/bin/tar";
  const cache = new BuildCache(d.globalStorage, d.hostPath, d.folderHostPath, {
    runner: d.runner,
    env: d.env,
    tar,
  });
  const cacheKey = async (): Promise<string | null> => {
    const fingerprint = await projectFingerprint(d.folderHostPath, d);
    log(`fingerprint ${fingerprint ?? "unavailable"}`);
    if (!fingerprint) return null;
    const key = await buildKey(d.folderHostPath, fingerprint, profile, {
      ...d,
      bun,
      easCliSpec: spec,
    });
    log(`cache key ${key ?? "unavailable"}`);
    return key;
  };

  try {
    let key: string | null = null;
    let reason: BuildReason = "clean-requested";
    if (opts.clean) {
      log("clean build requested");
    } else {
      key = await cacheKey();
      const hit = key ? cache.lookup(key) : null;
      if (hit) {
        const dest = copyFresh(hit.artifact, path.join(outDir, `build-${d.now()}.tar.gz`));
        log(`reused the artifact built at ${new Date(hit.builtAt).toISOString()}`);
        return {
          artifactRel: path.relative(d.folderHostPath, dest),
          logRel,
          exitCode: 0,
          mode: "reused",
          reusedBuiltAt: hit.builtAt,
        };
      }
      reason = key ? "no-match" : "no-fingerprint";
      log(key ? "no stored build matches; building in full" : "no cache key; building in full");
    }

    const builtAt = d.now();
    const buildDir = path.join(d.globalStorage, `build-${builtAt}`);
    fs.mkdirSync(buildDir, { recursive: true });
    // The private copy is only needed until the artifact is copied into the workspace.
    try {
      const env: Record<string, string> = {
        ...d.env,
        EAS_NO_VCS: "1",
        EAS_LOCAL_BUILD_ARTIFACTS_DIR: buildDir,
        CI: "1",
      };
      if (d.token) env.EXPO_TOKEN = d.token;

      const r = await d.runner.run(
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
        { env, cwd: d.folderHostPath, onOutput: (chunk) => fs.writeSync(logFd, chunk) },
      );

      let artifactRel = "";
      const artifact = fs.readdirSync(buildDir).find((f) => !f.startsWith("."));
      if (artifact) {
        const built = path.join(buildDir, artifact);
        const dest = copyFresh(built, path.join(outDir, artifact));
        artifactRel = path.relative(d.folderHostPath, dest);
        if (r.code === 0) {
          if (opts.clean) key = await cacheKey();
          const stored = key ? await cache.store(key, built, builtAt) : false;
          log(stored ? "stored the artifact for reuse" : "the artifact was not stored for reuse");
        }
      }
      return { artifactRel, logRel, exitCode: r.code, mode: "built", reason };
    } finally {
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
  } finally {
    fs.closeSync(logFd);
  }
}
