import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { dynamicConfig } from "./appconfig";
import type { CheckCode } from "./checks";
import { quickFixesFor, type QuickFix } from "./quickfix";
import { containingFolder } from "./registry";

/** The source every bridge diagnostic carries. */
export const DIAGNOSTIC_SOURCE = "Expo Bridge";

/** Runs a quick fix's command line in a visible container terminal in its folder. */
export const RUN_IN_TERMINAL = "expoBridge.quickfix.runInTerminal";

/** The code action for one quick fix; an edit targets `easJson`, at positions from `at`. */
function toAction(
  fix: QuickFix,
  diagnostic: vscode.Diagnostic,
  easJson: vscode.Uri,
  at: (offset: number) => vscode.Position,
): vscode.CodeAction {
  const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
  action.diagnostics = [diagnostic];
  if (fix.kind === "command") {
    action.command = { title: fix.title, command: fix.command };
  } else if (fix.kind === "terminal") {
    action.command = {
      title: fix.title,
      command: RUN_IN_TERMINAL,
      arguments: [fix.name, fix.cwd, fix.commandLine],
    };
  } else {
    action.edit = new vscode.WorkspaceEdit();
    for (const e of fix.edits) {
      action.edit.replace(
        easJson,
        new vscode.Range(at(e.offset), at(e.offset + e.length)),
        e.content,
      );
    }
  }
  return action;
}

export function registerQuickFixes(workspaceFolders: () => string[]): vscode.Disposable[] {
  const provider: vscode.CodeActionProvider = {
    provideCodeActions(document, _range, context) {
      const ours = context.diagnostics.filter((d) => d.source === DIAGNOSTIC_SOURCE);
      if (!ours.length) return [];
      const folder = containingFolder(workspaceFolders(), path.dirname(document.uri.fsPath));
      if (!folder) return [];
      const easJson = path.join(folder, "eas.json");
      const isEasJson = document.uri.fsPath === easJson;
      const easJsonText = isEasJson
        ? document.getText()
        : fs.existsSync(easJson)
          ? fs.readFileSync(easJson, "utf8")
          : null;
      const at = (offset: number) =>
        isEasJson ? document.positionAt(offset) : positionIn(easJsonText ?? "", offset);
      const ctx = {
        folder,
        easJsonText,
        hasDynamicConfig: dynamicConfig(folder, fs.existsSync) !== null,
      };
      return ours.flatMap((diagnostic) =>
        quickFixesFor(diagnostic.code as CheckCode, ctx).map((fix) =>
          toAction(fix, diagnostic, vscode.Uri.file(easJson), at),
        ),
      );
    },
  };

  return [
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, provider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.commands.registerCommand(RUN_IN_TERMINAL, (name: string, cwd: string, line: string) => {
      const terminal = vscode.window.createTerminal({ name, cwd });
      terminal.show();
      terminal.sendText(line);
    }),
  ];
}

function positionIn(text: string, offset: number): vscode.Position {
  const before = text.slice(0, offset).split("\n");
  return new vscode.Position(before.length - 1, before[before.length - 1]!.length);
}
