import { describe, expect, test } from "bun:test";
import { applyEdits } from "jsonc-parser/lib/esm/main.js";
import type { CheckCode } from "../src/checks";
import {
  easCliSpec,
  METRO_COMMAND,
  quickFixesFor,
  simulatorProfileEdits,
  type QuickFixContext,
} from "../src/quickfix";

const ctx = (over: Partial<QuickFixContext> = {}): QuickFixContext => ({
  folder: "/w/app",
  easJsonText: '{ "build": {} }',
  hasDynamicConfig: false,
  ...over,
});

const titles = (code: CheckCode, c = ctx()) => quickFixesFor(code, c).map((f) => f.title);

describe("quickFixesFor", () => {
  test("Mac tools run the host's fix with no arguments", () => {
    for (const code of ["xcode", "cocoapods", "fastlane", "node", "bun"] as const) {
      expect(quickFixesFor(code, ctx())).toEqual([
        { title: "Fix on the Mac…", kind: "command", command: "expoBridge.fix" },
      ]);
    }
  });

  test("token and trust run the host's own commands", () => {
    expect(quickFixesFor("expoToken", ctx())).toEqual([
      { title: "Set EXPO_TOKEN on the Mac…", kind: "command", command: "expoBridge.setToken" },
    ]);
    expect(quickFixesFor("workspaceTrusted", ctx())).toEqual([
      { title: "Manage trust on the Mac…", kind: "command", command: "expoBridge.manageTrust" },
    ]);
  });

  test("links the EAS project with the eas-cli the build would run, for static config only", () => {
    expect(
      quickFixesFor("easProjectId", ctx({ easJsonText: '{ "cli": { "version": ">= 16.0.0" } }' })),
    ).toEqual([
      {
        title: "Link the EAS project",
        kind: "terminal",
        name: "Expo Bridge: eas init",
        cwd: "/w/app",
        commandLine: "bunx eas-cli@>=16.0.0 init",
      },
    ]);
    expect(quickFixesFor("easProjectId", ctx({ hasDynamicConfig: true }))).toEqual([]);
  });

  test("starts Metro in a container terminal", () => {
    expect(quickFixesFor("port8081Forwarded", ctx())).toEqual([
      {
        title: "Start Metro in the container",
        kind: "terminal",
        name: "Expo Bridge: Metro",
        cwd: "/w/app",
        commandLine: METRO_COMMAND,
      },
    ]);
    expect(METRO_COMMAND).toBe("bunx expo start --dev-client --localhost --port 8081");
  });

  test("adds a simulator profile and re-picks a remembered profile", () => {
    expect(titles("simulatorProfile")).toEqual(["Add a simulator build profile"]);
    expect(quickFixesFor("rememberedProfile", ctx())).toEqual([
      {
        title: "Pick a build profile…",
        kind: "command",
        command: "expoBridge.panel.changeProfile",
      },
    ]);
  });

  test("easCli, simulator, and availability get none", () => {
    for (const code of [
      "easCli",
      "simulator",
      "macHost",
      "hostPathExists",
      "workspaceMapped",
    ] as const) {
      expect(titles(code)).toEqual([]);
    }
  });
});

describe("simulatorProfileEdits", () => {
  test("inserts the development simulator profile under build", () => {
    const text = '{\n  "build": {\n    "production": {}\n  }\n}\n';
    const out = applyEdits(text, simulatorProfileEdits(text));
    expect(JSON.parse(out).build.development).toEqual({
      developmentClient: true,
      distribution: "internal",
      ios: { simulator: true },
    });
    expect(out).toContain('"ios": { "simulator": true }');
    expect(out).toContain('    "development": {\n      "developmentClient": true,\n');
  });

  test("names it development-simulator when development exists, and adds build when missing", () => {
    const text = '{ "build": { "development": { "developmentClient": true } } }';
    expect(Object.keys(JSON.parse(applyEdits(text, simulatorProfileEdits(text))).build)).toEqual([
      "development",
      "development-simulator",
    ]);
    const empty = "{}";
    expect(
      JSON.parse(applyEdits(empty, simulatorProfileEdits(empty))).build.development.ios,
    ).toEqual({
      simulator: true,
    });
  });
});

describe("easCliSpec", () => {
  test("uses cli.version when it is a range, else latest", () => {
    expect(easCliSpec('{ "cli": { "version": "16.1.0" } }')).toBe("16.1.0");
    expect(easCliSpec('{ "cli": { "version": "file:../x" } }')).toBe("latest");
    expect(easCliSpec("{}")).toBe("latest");
    expect(easCliSpec(null)).toBe("latest");
  });
});
