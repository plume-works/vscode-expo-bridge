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
import { copyFresh, PathError, requireUnderWriteDir } from "./paths";
import { ensureBooted, SimulatorError } from "./simulator";

export class ActionError extends Error {
  constructor(readonly error: ProtocolError) {
    super(error.message);
  }
}

export interface InstalledApp {
  bundleId: string;
  /** The expo-dev-client `exp+…` URL scheme, when the app declares one. */
  devScheme?: string;
}

/** Where Metro is reached from the simulator: the forwarded port on the Mac. */
export const METRO_URL = "http://localhost:8081";

export interface SimContext {
  hostPath: string;
  globalStorage: string;
  env: Record<string, string>;
  runner: Runner;
  fileExists: (p: string) => boolean;
  /** Remembers the app `install` last installed, for `launch`. */
  getLastApp: () => InstalledApp | undefined;
  setLastApp: (app: InstalledApp) => void;
  now: () => number;
}

function xcrun(ctx: SimContext): string {
  const x = lookupTool("xcrun", ctx.env, ctx.fileExists);
  if (!x) throw new ActionError({ code: "action-failed", message: "xcrun not found" });
  return x;
}

/** The UDID of the simulator to act on, booting one when none is booted. */
async function simulator(ctx: SimContext): Promise<string> {
  const x = xcrun(ctx);
  try {
    return await ensureBooted((args) => ctx.runner.run(x, ["simctl", ...args], { env: ctx.env }));
  } catch (e) {
    if (e instanceof SimulatorError)
      throw new ActionError({ code: "action-failed", message: e.message });
    throw e;
  }
}

/**
 * Unpack an artifact from `.tmp/expo-bridge/` into a fresh private directory, rejecting
 * absolute, `..`, and link entries, then install the `.app` on the simulator.
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
  const { bundleId, devScheme } = await readInfoPlist(appDir, ctx);

  const udid = await simulator(ctx);
  const install = await ctx.runner.run(xcrun(ctx), ["simctl", "install", udid, appDir], {
    env: ctx.env,
  });
  if (install.code !== 0) {
    throw new ActionError({ code: "action-failed", message: "simctl install failed" });
  }
  ctx.setLastApp({ bundleId, devScheme });
  return { bundleIdentifier: bundleId };
}

/**
 * Launch the app that `install` last installed. A development build is opened at Metro
 * through its `exp+…` scheme so it loads the bundle; any other app is launched plainly.
 */
export async function launch(ctx: SimContext): Promise<LaunchResult> {
  const app = ctx.getLastApp();
  if (!app) throw new ActionError({ code: "not-found", message: "nothing installed yet" });
  const udid = await simulator(ctx);
  const args = app.devScheme
    ? ["simctl", "openurl", udid, devClientUrl(app.devScheme)]
    : ["simctl", "launch", udid, app.bundleId];
  const r = await ctx.runner.run(xcrun(ctx), args, { env: ctx.env });
  if (r.code !== 0)
    throw new ActionError({ code: "action-failed", message: "simctl launch failed" });
  return { bundleIdentifier: app.bundleId };
}

export function devClientUrl(scheme: string): string {
  return `${scheme}://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`;
}

/**
 * Capture the simulator screen into private storage, then copy it to a fresh PNG
 * under `.tmp/expo-bridge/`, so simctl never writes through a workspace path.
 */
export async function screenshot(ctx: SimContext): Promise<ScreenshotResult> {
  const udid = await simulator(ctx);
  const name = `screenshot-${ctx.now()}.png`;
  const privateDir = fs.mkdtempSync(path.join(ctx.globalStorage, "screenshot-"));
  const captured = path.join(privateDir, name);
  try {
    const r = await ctx.runner.run(xcrun(ctx), ["simctl", "io", udid, "screenshot", captured], {
      env: ctx.env,
    });
    if (r.code !== 0) {
      throw new ActionError({ code: "action-failed", message: "simctl screenshot failed" });
    }
    const outDir = path.join(ctx.hostPath, WRITE_DIR_REL);
    fs.mkdirSync(outDir, { recursive: true });
    const dest = copyFresh(captured, path.join(outDir, name));
    return { screenshotRel: path.relative(ctx.hostPath, dest) };
  } finally {
    fs.rmSync(privateDir, { recursive: true, force: true });
  }
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

const BUNDLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

const DEV_SCHEME_RE = /^exp\+[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/**
 * Read `CFBundleIdentifier` and the `exp+…` URL scheme through `plutil`, since a simulator
 * build's Info.plist is binary.
 */
async function readInfoPlist(appDir: string, ctx: SimContext): Promise<InstalledApp> {
  const plutil = lookupTool("plutil", ctx.env, ctx.fileExists) ?? "/usr/bin/plutil";
  const plist = path.join(appDir, "Info.plist");
  const r = await ctx.runner.run(plutil, ["-convert", "json", "-o", "-", plist], { env: ctx.env });
  if (r.code !== 0)
    throw new ActionError({ code: "action-failed", message: "Info.plist is unreadable" });
  let parsed: { CFBundleIdentifier?: unknown; CFBundleURLTypes?: unknown };
  try {
    parsed = JSON.parse(r.stdout) as typeof parsed;
  } catch {
    throw new ActionError({ code: "action-failed", message: "Info.plist is unreadable" });
  }
  const id = parsed.CFBundleIdentifier;
  if (typeof id !== "string") {
    throw new ActionError({ code: "not-found", message: "CFBundleIdentifier not found" });
  }
  if (!BUNDLE_ID_RE.test(id)) {
    throw new ActionError({
      code: "bad-argument",
      message: "CFBundleIdentifier is not a bundle id",
    });
  }
  return { bundleId: id, devScheme: devSchemeOf(parsed.CFBundleURLTypes) };
}

function devSchemeOf(urlTypes: unknown): string | undefined {
  if (!Array.isArray(urlTypes)) return undefined;
  for (const t of urlTypes) {
    const schemes = (t as { CFBundleURLSchemes?: unknown })?.CFBundleURLSchemes;
    if (!Array.isArray(schemes)) continue;
    const s = schemes.find((x): x is string => typeof x === "string" && DEV_SCHEME_RE.test(x));
    if (s) return s;
  }
  return undefined;
}
