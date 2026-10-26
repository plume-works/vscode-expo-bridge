import { PROTOCOL_VERSION, type StatusResult } from "@plume-works/expo-bridge-protocol";

const ok = { ok: true };

/** A status result whose checks all pass, with `overrides` applied. */
export function statusResult(
  overrides: Partial<StatusResult["checks"]> = {},
  available = true,
): StatusResult {
  return {
    protocolVersion: PROTOCOL_VERSION,
    available,
    folderHostPath: available ? "/Users/me/app" : "",
    checks: {
      macHost: ok,
      hostPathExists: ok,
      workspaceMapped: ok,
      workspaceTrusted: ok,
      xcode: ok,
      cocoapods: ok,
      fastlane: ok,
      node: ok,
      easCli: { ok: true, detail: "eas-cli@latest (no cli.version in eas.json)" },
      bun: ok,
      expoToken: ok,
      easProjectId: ok,
      simulator: ok,
      port8081Forwarded: ok,
      ...overrides,
    },
  };
}

/** A non-Mac host's status: unavailable, with the tool checks skipped. */
export const unavailable = (): StatusResult =>
  statusResult(
    {
      macHost: { ok: false, detail: "host is not macOS" },
      xcode: { ok: false },
      cocoapods: { ok: false },
    },
    false,
  );
