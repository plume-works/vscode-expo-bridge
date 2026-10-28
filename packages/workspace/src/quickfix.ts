import { normalizeRange } from "@plume-works/expo-bridge-protocol";
// The UMD build loads its modules at runtime, which the bundled extension cannot resolve.
import {
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
  type Edit,
} from "jsonc-parser/lib/esm/main.js";
import { HOST_COMMANDS } from "./actions";
import type { CheckCode } from "./checks";

/** A quick fix for one bridge diagnostic, described without `vscode`. */
export type QuickFix =
  | { title: string; kind: "command"; command: string }
  | { title: string; kind: "terminal"; name: string; cwd: string; commandLine: string }
  | { title: string; kind: "edit"; edits: Edit[] };

export interface QuickFixContext {
  folder: string;
  /** The text of the folder's `eas.json`, if it has one. */
  easJsonText: string | null;
  /** Whether the folder's app config is an `app.config.*` file, which `eas init` cannot edit. */
  hasDynamicConfig: boolean;
}

export const METRO_COMMAND = "bunx expo start --dev-client --localhost --port 8081";

/** The simulator profile the quick fix adds under `build`. */
const SIMULATOR_PROFILE = {
  developmentClient: true,
  distribution: "internal",
  ios: { simulator: true },
};

/** The eas-cli `build` would run: `cli.version` when it is a version range, else `latest`. */
export function easCliSpec(easJsonText: string | null): string {
  const root = easJsonText === null ? undefined : parseTree(easJsonText);
  const version = root && findNodeAtLocation(root, ["cli", "version"]);
  const value = version ? getNodeValue(version) : undefined;
  return (typeof value === "string" && normalizeRange(value)) || "latest";
}

/** The edits that add the simulator profile, as `development` unless that name is taken. */
export function simulatorProfileEdits(easJsonText: string): Edit[] {
  const root = parseTree(easJsonText);
  const taken = !!(root && findNodeAtLocation(root, ["build", "development"]));
  const name = taken ? "development-simulator" : "development";
  return modify(easJsonText, ["build", name], SIMULATOR_PROFILE, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  }).map((edit) => ({
    ...edit,
    content: edit.content.replace(
      /"ios": \{\s*"simulator": true\s*\}/,
      '"ios": { "simulator": true }',
    ),
  }));
}

/** The quick fixes for a diagnostic with code `code`; none for checks with no remedy. */
export function quickFixesFor(code: CheckCode, ctx: QuickFixContext): QuickFix[] {
  switch (code) {
    case "xcode":
    case "cocoapods":
    case "fastlane":
    case "node":
    case "bun":
      return [{ title: "Fix on the Mac…", kind: "command", command: HOST_COMMANDS.fix }];
    case "expoToken":
      return [
        { title: "Set EXPO_TOKEN on the Mac…", kind: "command", command: HOST_COMMANDS.setToken },
      ];
    case "workspaceTrusted":
      return [
        {
          title: "Manage trust on the Mac…",
          kind: "command",
          command: HOST_COMMANDS.manageTrust,
        },
      ];
    case "easProjectId":
      if (ctx.hasDynamicConfig) return [];
      return [
        {
          title: "Link the EAS project",
          kind: "terminal",
          name: "Expo Bridge: eas init",
          cwd: ctx.folder,
          commandLine: `bunx eas-cli@${easCliSpec(ctx.easJsonText)} init`,
        },
      ];
    case "port8081Forwarded":
      return [
        {
          title: "Start Metro in the container",
          kind: "terminal",
          name: "Expo Bridge: Metro",
          cwd: ctx.folder,
          commandLine: METRO_COMMAND,
        },
      ];
    case "simulatorProfile":
      if (ctx.easJsonText === null) return [];
      return [
        {
          title: "Add a simulator build profile",
          kind: "edit",
          edits: simulatorProfileEdits(ctx.easJsonText),
        },
      ];
    case "rememberedProfile":
      return [
        {
          title: "Pick a build profile…",
          kind: "command",
          command: "expoBridge.panel.changeProfile",
        },
      ];
    default:
      return [];
  }
}
