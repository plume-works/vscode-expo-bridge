import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Request } from "@plume-works/expo-bridge-protocol";
import { containerBunVersion } from "./cli-args";
import { buildMessage, HOST_COMMANDS, profileKey } from "./actions";
import { buildProfiles, easJsonChecks, readEasJson } from "./easjson";
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

/** Pick one of the window's Expo folders: the only one, or the user's choice. */
async function pickFolder(deps: UiDeps): Promise<string | undefined> {
  const folders = expoFolders(deps);
  if (folders.length <= 1) return folders[0];
  const pick = await vscode.window.showQuickPick(
    folders.map((f) => ({ label: path.basename(f), description: f, folder: f })),
    { title: "Expo Bridge: pick the Expo folder" },
  );
  return pick?.folder;
}

export function activateUi(context: vscode.ExtensionContext, deps: UiDeps): Ui {
  const remembered = (folder: string) => context.workspaceState.get<string>(profileKey(folder));

  const views = (): FolderView[] =>
    expoFolders(deps).map((folder) => ({
      folder,
      name: path.basename(folder),
      state: deps.store.get(folder),
      easProblems: easJsonChecks(readEasJson(folder), remembered(folder)),
    }));

  /** Ask for the folder's build profile and remember the answer. */
  const pickProfile = async (folder: string): Promise<string | undefined> => {
    const profiles = buildProfiles(readEasJson(folder));
    if (!profiles.length) {
      void vscode.window.showErrorMessage(`Expo Bridge: ${folder}/eas.json has no build profiles.`);
      return undefined;
    }
    const profile = await vscode.window.showQuickPick(profiles, {
      title: `Expo Bridge: build profile for ${path.basename(folder)}`,
    });
    if (profile) {
      await context.workspaceState.update(profileKey(folder), profile);
      refresh();
    }
    return profile;
  };

  const output = vscode.window.createOutputChannel("Expo Bridge Build");
  let building = false;
  const build = async (clean: boolean) => {
    if (building) {
      void vscode.window.showInformationMessage("Expo Bridge: a build is already running.");
      return;
    }
    const folder = await pickFolder(deps);
    if (!folder) return;
    const known = remembered(folder);
    const profile =
      known && buildProfiles(readEasJson(folder)).includes(known)
        ? known
        : await pickProfile(folder);
    if (!profile) return;
    building = true;
    try {
      output.show(true);
      output.appendLine(`--- ${clean ? "clean build" : "build"} ${profile} in ${folder}`);
      const outcome = await deps.relay(
        { action: "build", folder, profile, ...(clean ? { clean: true } : {}) },
        (line) => output.appendLine(line),
      );
      const message = buildMessage(profile, outcome);
      output.appendLine(message.text);
      if (message.error) void vscode.window.showErrorMessage(message.text);
      else void vscode.window.showInformationMessage(message.text);
    } finally {
      building = false;
    }
  };

  // Host commands take no arguments, so the Mac's own prompts decide what runs.
  const host = (command: string) => () => void vscode.commands.executeCommand(command);

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
    output,
    vscode.commands.registerCommand("expoBridge.panel.refresh", () => requestStatus(deps)),
    vscode.commands.registerCommand("expoBridge.panel.build", () => build(false)),
    vscode.commands.registerCommand("expoBridge.panel.cleanBuild", () => build(true)),
    vscode.commands.registerCommand("expoBridge.panel.changeProfile", async () => {
      const folder = await pickFolder(deps);
      if (folder) await pickProfile(folder);
    }),
    vscode.commands.registerCommand("expoBridge.panel.fix", host(HOST_COMMANDS.fix)),
    vscode.commands.registerCommand("expoBridge.panel.setToken", host(HOST_COMMANDS.setToken)),
    vscode.commands.registerCommand(
      "expoBridge.panel.manageTrust",
      host(HOST_COMMANDS.manageTrust),
    ),
    deps.store.onDidChange(refresh),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  );
  refresh();
  return { refresh };
}
