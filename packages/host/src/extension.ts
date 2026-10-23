import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { BuildDecision, Prompts, TrustDecision } from "./trust";
import { BUILD_ANSWERS, TrustStore } from "./trust";
import { dispatch, type DispatchDeps } from "./dispatch";
import { decodeHostPath } from "./hostpath";
import { captureLoginEnv } from "./env";
import { realRunner } from "./exec";
import { fixSummary, planFixes } from "./fix";
import { FixGate, runCommands, type RunCommand } from "./fixrun";
import type { InstalledApp } from "./install";
import { portAcceptsConnections } from "./port";
import { status } from "./status";
import type { Request, StatusResult } from "@plume-works/expo-bridge-protocol";

/** The ui-side command the workspace extension invokes with a protocol request. */
const DISPATCH_COMMAND = "expoBridge.ui.dispatch";

let lastApp: InstalledApp | undefined;

const prompts = (): Prompts => ({
  async trust(hostPath): Promise<TrustDecision | undefined> {
    const choice = await vscode.window.showWarningMessage(
      `Trust this workspace to run Expo builds on this Mac?\n\n${hostPath}`,
      { modal: true },
      "Allow",
    );
    return choice === "Allow" ? "allow" : "decline";
  },
  async build(_hostPath, profile): Promise<BuildDecision | undefined> {
    const choice = await vscode.window.showWarningMessage(
      `Run the "${profile}" Expo build on this Mac? Project code will run with your privileges.`,
      { modal: true },
      ...Object.values(BUILD_ANSWERS),
    );
    const answer = Object.entries(BUILD_ANSWERS).find(([, label]) => label === choice);
    return answer ? (answer[0] as BuildDecision) : "decline";
  },
});

/** Show pending fixes in a status bar item that lasts until a status has none. */
function showFixes(item: vscode.StatusBarItem, result: StatusResult): void {
  const summary = result.available ? fixSummary(planFixes(result)) : null;
  if (!summary) {
    item.hide();
    return;
  }
  item.text = summary.text;
  item.tooltip = summary.tooltip;
  item.show();
}

/** How long to wait for shell integration before typing the commands without it. */
const SHELL_INTEGRATION_WAIT_MS = 5000;

/** A RunCommand for `terminal` that reports exit codes, or null without shell integration. */
async function shellRunner(terminal: vscode.Terminal): Promise<RunCommand | null> {
  const si =
    terminal.shellIntegration ??
    (await new Promise<vscode.TerminalShellIntegration | undefined>((resolve) => {
      const sub = vscode.window.onDidChangeTerminalShellIntegration((e) => {
        if (e.terminal !== terminal) return;
        sub.dispose();
        resolve(e.shellIntegration);
      });
      setTimeout(() => (sub.dispose(), resolve(undefined)), SHELL_INTEGRATION_WAIT_MS);
    }));
  if (!si) return null;
  return (command) =>
    new Promise((resolve) => {
      const execution = si.executeCommand(command);
      const sub = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution !== execution) return;
        sub.dispose();
        resolve(e.exitCode);
      });
    });
}

/** Resolves when `terminal` closes. */
function closed(terminal: vscode.Terminal): Promise<void> {
  return new Promise((resolve) => {
    const sub = vscode.window.onDidCloseTerminal((t) => {
      if (t !== terminal) return;
      sub.dispose();
      resolve();
    });
  });
}

/** The host path of this window's own remote authority — never the container's claim. */
function resolveHostPath(): string | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return null;
  const resolved = decodeHostPath(folder.uri.authority);
  return resolved?.hostPath ?? null;
}

function buildDispatchDeps(
  trust: TrustStore,
  globalStorage: string,
  containerBunVersion: string | undefined,
): () => Promise<DispatchDeps> {
  return async () => {
    const hostPath = resolveHostPath();
    const env = await captureLoginEnv();
    const fileExists = (p: string) => fs.existsSync(p);
    const token = hostPath ? await trust.getToken() : undefined;

    const simContext = () => ({
      hostPath: hostPath!,
      globalStorage,
      env,
      runner: realRunner,
      fileExists,
      getLastApp: () => lastApp,
      setLastApp: (app: InstalledApp) => (lastApp = app),
      now: Date.now,
    });

    return {
      hostPath,
      statusDeps: async () => ({
        platform: process.platform,
        hostPath: hostPath ?? "",
        hostPathExists: !!hostPath && fs.existsSync(hostPath),
        trusted: hostPath ? trust.listTrusted().includes(hostPath) : false,
        hasToken: !!(await trust.getToken()),
        containerBunVersion,
        env,
        runner: realRunner,
        fileExists,
        port8081Forwarded: await portAcceptsConnections(8081, 500),
      }),
      confirmBuild: async (profile: string) =>
        hostPath ? trust.confirmBuild(hostPath, profile) : false,
      ensureTrusted: async () => (hostPath ? trust.ensureTrusted(hostPath) : false),
      buildDeps: async () => ({
        hostPath: hostPath!,
        globalStorage,
        env,
        token: await trust.getToken(),
        runner: realRunner,
        fileExists,
        confirmed: true,
        now: Date.now,
      }),
      simContext,
    } satisfies DispatchDeps;
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const globalStorage = context.globalStorageUri.fsPath;
  fs.mkdirSync(globalStorage, { recursive: true });
  const trust = new TrustStore(context.globalState, context.secrets, prompts());
  // The fix re-checks status itself, so it needs the bun version the container last sent.
  let lastContainerBunVersion: string | undefined;
  const fixItem = vscode.window.createStatusBarItem(
    "expoBridge.fixes",
    vscode.StatusBarAlignment.Left,
  );
  fixItem.name = "Expo Bridge";
  fixItem.command = "expoBridge.fix";
  context.subscriptions.push(fixItem);
  const fixGate = new FixGate();
  const recheck = async () => {
    const deps = await buildDispatchDeps(trust, globalStorage, lastContainerBunVersion)();
    const current = await status(await deps.statusDeps({ action: "status" }));
    showFixes(fixItem, current);
    return current;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      DISPATCH_COMMAND,
      async (request: Request & { containerBunVersion?: string }) => {
        if (request?.action === "status") lastContainerBunVersion = request.containerBunVersion;
        const make = buildDispatchDeps(trust, globalStorage, request?.containerBunVersion);
        const response = await dispatch(request, await make());
        if (request?.action === "status" && response.ok)
          showFixes(fixItem, response.result as StatusResult);
        return response;
      },
    ),

    vscode.commands.registerCommand("expoBridge.setToken", async () => {
      const value = await vscode.window.showInputBox({
        prompt: "EXPO_TOKEN (a robot-account token scoped to this project is recommended)",
        password: true,
        ignoreFocusOut: true,
      });
      if (value) {
        await trust.setToken(value);
        void vscode.window.showInformationMessage("Expo Bridge: EXPO_TOKEN saved.");
      }
    }),

    vscode.commands.registerCommand("expoBridge.clearToken", async () => {
      const yes = await vscode.window.showWarningMessage(
        "Clear the stored EXPO_TOKEN?",
        { modal: true },
        "Clear",
      );
      if (yes === "Clear") {
        await trust.clearToken();
        void vscode.window.showInformationMessage("Expo Bridge: EXPO_TOKEN cleared.");
      }
    }),

    vscode.commands.registerCommand("expoBridge.manageTrust", async () => {
      const decisions = trust.listDecisions();
      const pick = await vscode.window.showQuickPick(
        decisions.length
          ? decisions.map((d) => ({
              label: d.hostPath,
              description: d.decision === "allow" ? "trusted" : "declined",
            }))
          : [{ label: "No recorded workspaces", description: "" }],
        { title: "Revoke a workspace's trust decision", canPickMany: false },
      );
      if (pick && decisions.some((d) => d.hostPath === pick.label)) {
        const yes = await vscode.window.showWarningMessage(
          `Revoke the ${pick.description} decision for ${pick.label}? Its next request will ask again.`,
          { modal: true },
          "Revoke",
        );
        if (yes === "Revoke") await trust.revoke(pick.label);
      }
    }),

    vscode.commands.registerCommand("expoBridge.fix", async () => {
      if (fixGate.running) {
        void vscode.window.showInformationMessage("Expo Bridge: a fix is already running.");
        return;
      }
      const steps = planFixes(await recheck());
      if (!steps.length) {
        void vscode.window.showInformationMessage("Expo Bridge: nothing to fix.");
        return;
      }
      const pick = await vscode.window.showQuickPick(
        steps.map((s) => ({ label: s.label, detail: s.detail, step: s })),
        { title: "Expo Bridge: pick a fix to run", canPickMany: false, ignoreFocusOut: true },
      );
      if (!pick) return;
      if (pick.step.openUrl) {
        await vscode.env.openExternal(vscode.Uri.parse(pick.step.openUrl));
        const proceed = await vscode.window.showInformationMessage(
          "Continue once Xcode is installed?",
          { modal: true },
          "Continue",
        );
        if (proceed !== "Continue") return;
      }
      await fixGate.run(async () => {
        fixItem.text = "$(sync~spin) Expo Bridge: fixing…";
        fixItem.tooltip = pick.step.label;
        fixItem.command = undefined;
        try {
          // A file: cwd binds the terminal to the Mac; otherwise a remote window opens it remotely.
          const terminal = vscode.window.createTerminal({
            name: "Expo Bridge fix",
            cwd: vscode.Uri.file(os.homedir()),
          });
          terminal.show();
          const run = await shellRunner(terminal);
          if (run) {
            await Promise.race([runCommands(run, pick.step.commands), closed(terminal)]);
          } else {
            // Without shell integration the end of the commands is unknown; closing ends the fix.
            for (const cmd of pick.step.commands) terminal.sendText(cmd);
            fixItem.tooltip = `${pick.step.label} — close the terminal when it finishes`;
            await closed(terminal);
          }
        } finally {
          fixItem.command = "expoBridge.fix";
          await recheck();
        }
      });
    }),
  );
}

export function deactivate(): void {}
