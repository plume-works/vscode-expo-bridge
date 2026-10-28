import * as fs from "node:fs";
import * as path from "node:path";
// The UMD build loads its modules at runtime, which the bundled extension cannot resolve.
import { findNodeAtLocation, parseTree, type Node } from "jsonc-parser/lib/esm/main.js";
import { dynamicConfig } from "./appconfig";
import type { CheckCode, Severity } from "./checks";
import { readEasJson, type EasJson, type TextRange } from "./easjson";
import { folderIssues } from "./issues";
import type { FolderView } from "./panelmodel";

export interface Position {
  line: number;
  character: number;
}

export interface BridgeDiagnostic {
  /** The file the diagnostic is on, relative to its folder. */
  file: string;
  start: Position;
  end: Position;
  severity: Severity;
  message: string;
  code: CheckCode;
}

/** The folder files diagnostics anchor to, read once per publish. */
export interface FolderFiles {
  easJson: EasJson | null;
  appJson: { text: string; root: Node | undefined } | null;
  /** The folder's `app.config.*` file name and text, if it has one. */
  dynamicConfig: { file: string; text: string } | null;
}

export function readFolderFiles(folder: string): FolderFiles {
  const read = (f: string) => fs.readFileSync(path.join(folder, f), "utf8");
  const appJsonText = fs.existsSync(path.join(folder, "app.json")) ? read("app.json") : null;
  const dynamic = dynamicConfig(folder, fs.existsSync);
  return {
    easJson: readEasJson(folder),
    appJson: appJsonText === null ? null : { text: appJsonText, root: parseTree(appJsonText) },
    dynamicConfig: dynamic ? { file: dynamic, text: read(dynamic) } : null,
  };
}

function positionAt(text: string, offset: number): Position {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length - 1, character: before[before.length - 1]!.length };
}

function firstLine(text: string): TextRange {
  const end = text.indexOf("\n");
  return { offset: 0, length: end < 0 ? text.length : end };
}

/** The range of the property key at `location`, if the document has that property. */
function keyRange(root: Node | undefined, location: string[]): TextRange | undefined {
  const value = root && findNodeAtLocation(root, location);
  const key = value?.parent?.children?.[0];
  return key ? { offset: key.offset, length: key.length } : undefined;
}

type Anchor = { file: string; text: string; range: TextRange };

function anchor(code: CheckCode, view: FolderView, files: FolderFiles): Anchor | null {
  const eas = files.easJson;
  const onEas = (range?: TextRange): Anchor | null =>
    eas ? { file: "eas.json", text: eas.text, range: range ?? firstLine(eas.text) } : null;
  if (code === "easCli") {
    const version = eas?.root && findNodeAtLocation(eas.root, ["cli", "version"]);
    return onEas(version ? { offset: version.offset, length: version.length } : undefined);
  }
  if (code === "easProjectId") {
    const dynamic = files.dynamicConfig;
    if (dynamic) return { file: dynamic.file, text: dynamic.text, range: firstLine(dynamic.text) };
    const app = files.appJson;
    if (app) {
      const range =
        keyRange(app.root, ["expo", "extra"]) ??
        keyRange(app.root, ["expo"]) ??
        firstLine(app.text);
      return { file: "app.json", text: app.text, range };
    }
    return onEas();
  }
  const problem = view.easProblems.find((p) => p.code === code);
  return onEas(problem?.range);
}

function messageFor(code: CheckCode, message: string, files: FolderFiles): string {
  if (code === "easProjectId" && files.dynamicConfig && message.includes("not set")) {
    return `${message}; set extra.eas.projectId in the config ${files.dynamicConfig.file} exports`;
  }
  return message;
}

/**
 * One diagnostic per failing check of the folder, anchored where the check's config lives:
 * `cli.version` for eas-cli, the app config for the project ID, the `build` key for the
 * profile checks, and the first line of `eas.json` for checks with no file of their own.
 */
export function diagnosticsFor(view: FolderView, files: FolderFiles): BridgeDiagnostic[] {
  return folderIssues(view).flatMap((issue) => {
    const at = anchor(issue.code, view, files);
    if (!at) return [];
    return [
      {
        file: at.file,
        start: positionAt(at.text, at.range.offset),
        end: positionAt(at.text, at.range.offset + at.range.length),
        severity: issue.severity,
        message: messageFor(issue.code, issue.message, files),
        code: issue.code,
      },
    ];
  });
}
