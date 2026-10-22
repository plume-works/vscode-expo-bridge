import * as fs from "node:fs";
import * as vscode from "vscode";
import type { BuildDecision, Prompts, TrustDecision } from "./trust";
import { TrustStore } from "./trust";
import { dispatch, type DispatchDeps } from "./dispatch";
import { decodeHostPath } from "./hostpath";
import { captureLoginEnv } from "./env";
import { realRunner } from "./exec";
import { planFixes } from "./fix";
import { portAcceptsConnections } from "./port";
import { status } from "./status";
import type { Request, StatusResult } from "@plume-works/expo-bridge-protocol";

/** The ui-side command the workspace extension invokes with a protocol request. */
const DISPATCH_COMMAND = "expoBridge.ui.dispatch";

let lastBundleId: string | undefined;

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
      "Allow once",
      "Don't ask for an hour",
      "Don't ask today",
    );
    if (choice === "Allow once") return "once";
    if (choice === "Don't ask for an hour") return "hour";
    if (choice === "Don't ask today") return "today";
    return "decline";
  },
});

/** Offer the fix command without blocking the status response; only a click runs a fix. */
function offerFixes(result: StatusResult): void {
  if (!result.available) return;
  const steps = planFixes(result);
  if (!steps.length) return;
  void vscode.window
    .showWarningMessage(`Expo Bridge: missing on this Mac: ${steps.map((s) => s.check).join(", ")}.`, "Fix…")
    .then((choice) => {
      if (choice === "Fix…") void vscode.commands.executeCommand("expoBridge.fix");
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
      getLastBundleId: () => lastBundleId,
      setLastBundleId: (id: string) => (lastBundleId = id),
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

  context.subscriptions.push(
    vscode.commands.registerCommand(DISPATCH_COMMAND, async (request: Request & { containerBunVersion?: string }) => {
      const make = buildDispatchDeps(trust, globalStorage, request?.containerBunVersion);
      const response = await dispatch(request, await make());
      if (request?.action === "status" && response.ok) offerFixes(response.result as StatusResult);
      return response;
    }),

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
          ? decisions.map((d) => ({ label: d.hostPath, description: d.decision === "allow" ? "trusted" : "declined" }))
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
      const make = buildDispatchDeps(trust, globalStorage, undefined);
      const deps = await make();
      const current = await status(await deps.statusDeps({ action: "status" }));
      const steps = planFixes(current);
      if (!steps.length) {
        void vscode.window.showInformationMessage("Expo Bridge: nothing to fix.");
        return;
      }
      const pick = await vscode.window.showQuickPick(
        steps.map((s) => ({ label: s.label, step: s })),
        { title: "Expo Bridge: pick a fix to run", canPickMany: false },
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
      const terminal = vscode.window.createTerminal({ name: "Expo Bridge fix" });
      terminal.show();
      for (const cmd of pick.step.commands) terminal.sendText(cmd);
    }),
  );
}

export function deactivate(): void {}
