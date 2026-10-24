import type { InstallRequest, Request } from "@plume-works/expo-bridge-protocol";
import { ACTIONS, isAction } from "@plume-works/expo-bridge-protocol";

export class UsageError extends Error {}

/**
 * The container's `bun --version`. The launcher runs this CLI under node, so the runtime's
 * own version says nothing about the bun that installs the project.
 */
export function containerBunVersion(
  exec: (file: string, args: string[]) => string,
): string | undefined {
  try {
    return exec("bun", ["--version"]).trim() || undefined;
  } catch {
    // no bun in the container: status then skips the version comparison
    return undefined;
  }
}

export const USAGE = `usage: eas-host <status|build <profile>|install [path]|launch|screenshot>`;

export const HELP = `${USAGE}

Builds, installs, launches, and screenshots an iOS app on the Mac host of this VS Code
window. Run it inside the Expo app's workspace folder: it acts on the workspace folder
that contains the current directory. Run the actions in this order:

  eas-host status            exits 0 when the bridge is available; otherwise use EAS cloud
  eas-host build <profile>   builds the eas.json profile; the result's artifactRel is the
                             artifact's folder-relative path under .tmp/expo-bridge/
  eas-host install [path]    installs that artifact on the simulator; with no path, the
                             newest build artifact under .tmp/expo-bridge/
  eas-host launch            starts the installed app; a development build loads its bundle
                             from Metro on port 8081, so start Metro in the container first:
                             bunx expo start --dev-client --localhost --port 8081
  eas-host screenshot        captures the simulator; the result's screenshotRel is the PNG's
                             path under .tmp/expo-bridge/

Each result prints as one line of JSON on stdout; build log lines stream to stderr.
Exit codes: 0 success, 1 the action failed, 2 a usage error, 3 the bridge is unavailable,
including when no VS Code window has a workspace folder containing the current directory.`;

type WithoutFolder<T> = T extends unknown ? Omit<T, "folder"> : never;

/**
 * A request as parsed from argv: the workspace extension adds its `folder`, and resolves
 * an install with no path to the newest artifact.
 */
export type CliArgs =
  | WithoutFolder<Exclude<Request, InstallRequest>>
  | (Omit<InstallRequest, "artifactRel" | "folder"> & { artifactRel?: string });

/** What `eas-host` sends: the parsed request and the real directory it runs in. */
export type CliRequest = CliArgs & { cwd: string };

/** Why `eas-host` found no window to serve a run in `cwd`. */
export function noWindowMessage(cwd: string): string {
  return (
    `expo bridge unavailable: no VS Code window has a workspace folder containing ${cwd}; ` +
    "run eas-host inside the Expo app's workspace folder, or use EAS cloud"
  );
}

export function isHelp(argv: string[]): boolean {
  return argv.length === 1 && ["help", "--help", "-h"].includes(argv[0]!);
}

/**
 * Parse the `eas-host` argv (without node/script) into a request. Each action maps to
 * exactly one request; unknown actions and missing arguments are usage errors.
 */
export function parseArgs(argv: string[], containerBunVersion?: string): CliArgs {
  const [action, ...rest] = argv;
  if (!action || !isAction(action)) {
    throw new UsageError(`unknown action (expected one of ${ACTIONS.join(", ")})\n${USAGE}`);
  }
  switch (action) {
    case "status":
      return { action, ...(containerBunVersion ? { containerBunVersion } : {}) };
    case "build": {
      const profile = rest[0];
      if (!profile) throw new UsageError(`build needs a profile\n${USAGE}`);
      return { action, profile };
    }
    case "install": {
      const artifactRel = rest[0];
      return artifactRel ? { action, artifactRel } : { action };
    }
    case "launch":
      return { action };
    case "screenshot":
      return { action };
  }
}
