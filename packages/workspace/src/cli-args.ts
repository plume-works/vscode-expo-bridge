import type { Request } from "@plume-works/expo-bridge-protocol";
import { ACTIONS, isAction } from "@plume-works/expo-bridge-protocol";

export class UsageError extends Error {}

export const USAGE = `usage: eas-host <status|build <profile>|install <path>|launch|screenshot>`;

/**
 * Parse the `eas-host` argv (without node/script) into a protocol request. Each action
 * maps to exactly one request; unknown actions and missing arguments are usage errors.
 */
export function parseArgs(argv: string[], containerBunVersion?: string): Request {
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
      if (!artifactRel) throw new UsageError(`install needs an artifact path\n${USAGE}`);
      return { action, artifactRel };
    }
    case "launch":
      return { action };
    case "screenshot":
      return { action };
  }
}
