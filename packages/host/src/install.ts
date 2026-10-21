import * as fs from "node:fs";
import * as path from "node:path";
import type {
  InstallResult,
  LaunchResult,
  ProtocolError,
  ScreenshotResult,
} from "@plume-works/expo-bridge-protocol";
import { WRITE_DIR_REL } from "@plume-works/expo-bridge-protocol";
import type { Runner } from "./exec";
import { lookupTool } from "./env";
import { openFreshWrite, PathError, requireUnderWriteDir } from "./paths";
import { readJsonFile } from "./jsonfile";

export class ActionError extends Error {
  constructor(readonly error: ProtocolError) {
    super(error.message);
  }
}

export interface SimContext {
  hostPath: string;
  globalStorage: string;
  env: Record<string, string>;
  runner: Runner;
  fileExists: (p: string) => boolean;
  /** Remembers the bundle id of the app `install` last unpacked, for `launch`. */
  getLastBundleId: () => string | undefined;
  setLastBundleId: (id: string) => void;
  now: () => number;
}

function xcrun(ctx: SimContext): string {
  const x = lookupTool("xcrun", ctx.env, ctx.fileExists);
  if (!x) throw new ActionError({ code: "action-failed", message: "xcrun not found" });
  return x;
}

/**
 * Unpack an artifact from `.tmp/expo-bridge/` into a fresh private directory, rejecting
 * absolute, `..`, and link entries, then install the `.app` on the booted simulator.
 */
export async function install(artifactRel: string, ctx: SimContext): Promise<InstallResult> {
  let abs: string;
  try {
    abs = requireUnderWriteDir(ctx.hostPath, artifactRel);
  } catch (e) {
    if (e instanceof PathError) throw new ActionError({ code: e.code, message: e.message });
    throw e;
  }
  const dest = path.join(ctx.globalStorage, `install-${ctx.now()}`);
  fs.mkdirSync(dest, { recursive: true });

  // -k keeps existing files (no overwrite); the directory is fresh so every entry is new.
  // The host tar refuses to follow a link that points outside the destination; the
  // post-extraction scan below also rejects any symlink that landed in the tree.
  const tar = lookupTool("tar", ctx.env, ctx.fileExists) ?? "/usr/bin/tar";
  const r = await ctx.runner.run(tar, ["-xkf", abs, "-C", dest], { env: ctx.env });
  if (r.code !== 0) {
    throw new ActionError({ code: "action-failed", message: "failed to unpack the artifact" });
  }
  rejectSymlinks(dest);

  const appDir = findApp(dest);
  if (!appDir) throw new ActionError({ code: "not-found", message: "no .app in the artifact" });
  const bundleId = bundleIdOf(appDir);

  const install = await ctx.runner.run(xcrun(ctx), ["simctl", "install", "booted", appDir], {
    env: ctx.env,
  });
  if (install.code !== 0) {
    throw new ActionError({ code: "action-failed", message: "simctl install failed" });
  }
  ctx.setLastBundleId(bundleId);
  return { bundleIdentifier: bundleId };
}

/** Launch the app that `install` last installed, by its recorded bundle identifier. */
export async function launch(ctx: SimContext): Promise<LaunchResult> {
  const bundleId = ctx.getLastBundleId();
  if (!bundleId) throw new ActionError({ code: "not-found", message: "nothing installed yet" });
  const r = await ctx.runner.run(xcrun(ctx), ["simctl", "launch", "booted", bundleId], {
    env: ctx.env,
  });
  if (r.code !== 0) throw new ActionError({ code: "action-failed", message: "simctl launch failed" });
  return { bundleIdentifier: bundleId };
}

/** Capture the booted simulator screen to a fresh PNG under `.tmp/expo-bridge/`. */
export async function screenshot(ctx: SimContext): Promise<ScreenshotResult> {
  const outDir = path.join(ctx.hostPath, WRITE_DIR_REL);
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, `screenshot-${ctx.now()}.png`);
  const fd = openFreshWrite(dest);
  fs.closeSync(fd);
  const r = await ctx.runner.run(xcrun(ctx), ["simctl", "io", "booted", "screenshot", dest], {
    env: ctx.env,
  });
  if (r.code !== 0) {
    throw new ActionError({ code: "action-failed", message: "simctl screenshot failed" });
  }
  return { screenshotRel: path.relative(ctx.hostPath, dest) };
}

function rejectSymlinks(root: string): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.isSymbolicLink()) {
      throw new ActionError({ code: "symlink-rejected", message: "artifact contains a symlink" });
    }
  }
}

function findApp(root: string): string | null {
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      return path.join(entry.parentPath ?? root, entry.name);
    }
  }
  return null;
}

function bundleIdOf(appDir: string): string {
  const plist = path.join(appDir, "Info.plist");
  // Info.plist may be binary; prefer a JSON view when a converter exists, else parse XML.
  try {
    const parsed = readJsonFile(plist) as { CFBundleIdentifier?: string };
    if (typeof parsed.CFBundleIdentifier === "string") return parsed.CFBundleIdentifier;
  } catch {
    // not JSON — fall through to the XML scan
  }
  const xml = fs.readFileSync(plist, "utf8");
  const m = xml.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
  if (!m) throw new ActionError({ code: "not-found", message: "CFBundleIdentifier not found" });
  return m[1]!;
}
