import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Request } from "@plume-works/expo-bridge-protocol";
import { containerBunVersion } from "./cli-args";
import { easJsonChecks, readEasJson } from "./easjson";
import { Panel, PANEL_VIEW } from "./panel";
import type { FolderView } from "./panelmodel";
import type { RequestOutcome } from "./requests";
import type { StatusStore } from "./statusstore";

export interface UiDeps {
  store: StatusStore;
  /** Relay one request the way the socket does, so the UI and `eas-host` agree. */
  relay: (request: Request, onLog?: (line: string) => void) => Promise<RequestOutcome>;
  workspaceFolders: () => string[];
}

export interface Ui {
  /** Rebuild everything the UI derives from the store and the folders' config files. */
  refresh(): void;
}

/** The window's workspace folders that hold an `eas.json`. */
function expoFolders(deps: UiDeps): string[] {
  return deps.workspaceFolders().filter((f) => fs.existsSync(path.join(f, "eas.json")));
}

/** Send one `status` request per Expo folder, carrying the container's bun as `eas-host` does. */
export async function requestStatus(deps: UiDeps): Promise<void> {
  const bun = containerBunVersion((file, args) => execFileSync(file, args, { encoding: "utf8" }));
  await Promise.all(
    expoFolders(deps).map((folder) =>
      deps.relay({ action: "status", folder, ...(bun ? { containerBunVersion: bun } : {}) }),
    ),
  );
}

export function activateUi(context: vscode.ExtensionContext, deps: UiDeps): Ui {
  const views = (): FolderView[] =>
    expoFolders(deps).map((folder) => ({
      folder,
      name: path.basename(folder),
      state: deps.store.get(folder),
      easProblems: easJsonChecks(readEasJson(folder), undefined),
    }));

  const panel = new Panel(views);
  const tree = vscode.window.createTreeView(PANEL_VIEW, { treeDataProvider: panel });

  // The first status runs when the panel is first seen; never await a view during activation.
  let checked = false;
  const firstLook = () => {
    if (checked || !tree.visible) return;
    checked = true;
    void requestStatus(deps);
  };
  tree.onDidChangeVisibility(firstLook);
  setTimeout(firstLook, 0);

  const refresh = () => panel.refresh();
  context.subscriptions.push(
    panel,
    tree,
    deps.store.onDidChange(refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  );
  refresh();
  return { refresh };
}
