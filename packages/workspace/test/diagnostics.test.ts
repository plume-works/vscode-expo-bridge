import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { diagnosticsFor, readFolderFiles } from "../src/diagnostics";
import { easJsonChecks, readEasJson } from "../src/easjson";
import type { FolderView } from "../src/panelmodel";
import { statusResult, unavailable } from "./fixtures/status";

let folder: string;

beforeEach(() => {
  folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-diag-")));
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

const EAS = '{\n  "cli": { "version": "file:../x" },\n  "build": { "production": {} }\n}\n';

function write(files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files))
    fs.writeFileSync(path.join(folder, name), content);
}

function diagnostics(overrides = {}, available = true) {
  const result = available ? statusResult(overrides) : unavailable();
  const view: FolderView = {
    folder,
    name: "app",
    state: { kind: "status", result, at: 1 },
    easProblems: easJsonChecks(readEasJson(folder), undefined),
  };
  return diagnosticsFor(view, readFolderFiles(folder));
}

describe("diagnosticsFor", () => {
  test("anchors a Mac tool check to the first line of eas.json, with its detail and key", () => {
    write({ "eas.json": '{ "build": { "d": { "ios": { "simulator": true } } } }' });
    expect(diagnostics({ cocoapods: { ok: false, detail: "CocoaPods not found" } })).toEqual([
      {
        file: "eas.json",
        start: { line: 0, character: 0 },
        end: { line: 0, character: 54 },
        severity: "error",
        message: "CocoaPods not found",
        code: "cocoapods",
      },
    ]);
  });

  test("anchors easCli to cli.version and the simulator profile to the build key", () => {
    write({ "eas.json": EAS });
    const ds = diagnostics({
      easCli: { ok: false, detail: "eas.json cli.version is not a version range" },
    });
    expect(ds.map((d) => [d.code, d.file, d.start, d.end])).toEqual([
      ["easCli", "eas.json", { line: 1, character: 22 }, { line: 1, character: 33 }],
      ["simulatorProfile", "eas.json", { line: 2, character: 2 }, { line: 2, character: 9 }],
    ]);
  });

  test("anchors easProjectId to expo.extra in app.json, else expo", () => {
    write({
      "eas.json": '{ "build": { "d": { "ios": { "simulator": true } } } }',
      "app.json": '{\n  "expo": {\n    "extra": {}\n  }\n}\n',
    });
    const missing = {
      easProjectId: { ok: false, detail: "extra.eas.projectId not set in the app config" },
    };
    expect(diagnostics(missing).map((d) => [d.file, d.start.line, d.start.character])).toEqual([
      ["app.json", 2, 4],
    ]);
    write({ "app.json": '{ "expo": { "name": "a" } }' });
    expect(diagnostics(missing)[0]?.start).toEqual({ line: 0, character: 2 });
  });

  test("anchors easProjectId to a dynamic config's first line and says where to set it", () => {
    write({
      "eas.json": '{ "build": { "d": { "ios": { "simulator": true } } } }',
      "app.json": "{}",
      "app.config.ts": "export default {};\n",
    });
    const [d] = diagnostics({
      easProjectId: { ok: false, detail: "extra.eas.projectId not set in the app config" },
    });
    expect(d).toMatchObject({
      file: "app.config.ts",
      start: { line: 0, character: 0 },
      end: { line: 0, character: 18 },
      message:
        "extra.eas.projectId not set in the app config; set extra.eas.projectId in the config app.config.ts exports",
    });
  });

  test("uses the approach's severities", () => {
    write({ "eas.json": '{ "build": { "d": { "ios": { "simulator": true } } } }' });
    const ds = diagnostics({
      expoToken: { ok: false, detail: "EXPO_TOKEN not set" },
      simulator: { ok: false, detail: "no simulator runtime" },
    });
    expect(ds.map((d) => [d.code, d.severity])).toEqual([
      ["expoToken", "warning"],
      ["simulator", "info"],
    ]);
  });

  test("an unavailable status publishes only its availability diagnostic", () => {
    write({ "eas.json": EAS });
    expect(diagnostics({}, false).map((d) => [d.code, d.severity, d.message])).toEqual([
      ["macHost", "info", "host is not macOS"],
    ]);
  });

  test("a folder without a status has no diagnostics", () => {
    write({ "eas.json": EAS });
    const view: FolderView = { folder, name: "app", state: undefined, easProblems: [] };
    expect(diagnosticsFor(view, readFolderFiles(folder))).toEqual([]);
  });
});
