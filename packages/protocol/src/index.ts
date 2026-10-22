// The fixed Expo-only protocol between the container-side `eas-host` command and
// the Mac-side host extension. The host extension never runs a command string from
// the container; it accepts exactly the actions named here. The prose contract and
// threat model live in docs/protocol.md.

export const PROTOCOL_VERSION = 1 as const;

/** The container-side socket the workspace extension serves. One window, one container. */
export const SOCKET_PATH = "/tmp/vscode-expo-bridge.sock";

/** Every write the host extension makes under the workspace lands here, and nowhere else. */
export const WRITE_DIR_REL = ".tmp/expo-bridge";

export type Action = "status" | "build" | "install" | "launch" | "screenshot";

export const ACTIONS: readonly Action[] = ["status", "build", "install", "launch", "screenshot"];

export interface StatusRequest {
  action: "status";
  /** The container's own `bun --version`, so the host can compare it to the Mac's bun. */
  containerBunVersion?: string;
}

export interface BuildRequest {
  action: "build";
  /** A profile name that must exist in the workspace's `eas.json`. */
  profile: string;
}

export interface InstallRequest {
  action: "install";
  /** A workspace-relative path that must resolve under `.tmp/expo-bridge/`. */
  artifactRel: string;
}

export interface LaunchRequest {
  action: "launch";
}

export interface ScreenshotRequest {
  action: "screenshot";
}

export type Request =
  | StatusRequest
  | BuildRequest
  | InstallRequest
  | LaunchRequest
  | ScreenshotRequest;

export interface StatusCheck {
  ok: boolean;
  /** Present when `ok` is false: a short reason, never any file contents. */
  detail?: string;
}

export interface StatusResult {
  protocolVersion: number;
  /** False on a non-Mac host or when the workspace host path does not exist locally. */
  available: boolean;
  checks: {
    macHost: StatusCheck;
    hostPathExists: StatusCheck;
    workspaceTrusted: StatusCheck;
    xcode: StatusCheck;
    cocoapods: StatusCheck;
    fastlane: StatusCheck;
    node: StatusCheck;
    bun: StatusCheck;
    expoToken: StatusCheck;
    easProjectId: StatusCheck;
    simulator: StatusCheck;
    port8081Forwarded: StatusCheck;
  };
}

export interface BuildResult {
  /** Workspace-relative path of the artifact copied under `.tmp/expo-bridge/`. */
  artifactRel: string;
  /** Workspace-relative path of the build log, tailed by `eas-host` while running. */
  logRel: string;
  exitCode: number;
}

export interface InstallResult {
  bundleIdentifier: string;
}

export interface LaunchResult {
  bundleIdentifier: string;
}

export interface ScreenshotResult {
  /** Workspace-relative path of the PNG written under `.tmp/expo-bridge/`. */
  screenshotRel: string;
}

export type Result = StatusResult | BuildResult | InstallResult | LaunchResult | ScreenshotResult;

export type ErrorCode =
  | "untrusted" // the workspace is not trusted on the Mac (declined or dismissed)
  | "build-declined" // the per-build confirmation was declined
  | "unavailable" // non-Mac host, or the workspace host path does not exist
  | "bad-request" // malformed request or an unknown action
  | "bad-argument" // an argument failed validation (profile, path)
  | "path-escape" // a path resolved outside its allowed root
  | "symlink-rejected" // a path component or target is a symlink
  | "not-found" // a referenced file or profile does not exist
  | "action-failed"; // the underlying tool exited non-zero

export interface ProtocolError {
  code: ErrorCode;
  /** Human-readable; never contains the contents of any file the host read. */
  message: string;
}

export type Response = { ok: true; result: Result } | { ok: false; error: ProtocolError };

export function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}
