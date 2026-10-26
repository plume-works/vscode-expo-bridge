import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { SOCKET_DIR, type Response } from "@plume-works/expo-bridge-protocol";
import { PROJECT_ID_INPUTS_GLOB, ProjectIdCache, realRunner, resolveProjectId } from "./appconfig";
import { resolveRequest } from "./artifacts";
import type { CliRequest } from "./cli-args";
import {
  containingFolder,
  ensureRegistryDir,
  pruneStale,
  removeOwn,
  socketPath,
  writeEntry,
} from "./registry";
import { relayRequest, type RelayDeps } from "./requests";
import { StatusStore } from "./statusstore";
import { encodeFrame, LineDecoder } from "./wire";

const EAS_HOST_SCRIPT = "eas-host.js";

const projectIds = new ProjectIdCache();
const store = new StatusStore();

const relayDeps: RelayDeps = {
  projectId: (folder) =>
    projectIds.get(folder, () => resolveProjectId(folder, realRunner, fs.existsSync)),
  onOutcome: (request, outcome) => store.record(request, outcome),
};

/** Install the `eas-host` launcher into ~/.local/bin, pointing at the bundled CLI. */
function installEasHost(extensionPath: string): void {
  const binDir = path.join(os.homedir(), ".local", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const target = path.join(extensionPath, "dist", EAS_HOST_SCRIPT);
  const launcher = path.join(binDir, "eas-host");
  fs.writeFileSync(launcher, `#!/usr/bin/env bash\nexec node ${JSON.stringify(target)} "$@"\n`, {
    mode: 0o755,
  });
}

/** The container paths of this window's workspace folders, as VS Code names them. */
function workspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

async function handleRequest(
  cliRequest: CliRequest,
  emit: (frame: { kind: "log"; line: string } | { kind: "response"; response: Response }) => void,
): Promise<void> {
  const resolved = resolveRequest(cliRequest, workspaceFolders());
  if ("error" in resolved) {
    emit({ kind: "response", response: { ok: false, error: resolved.error } });
    return;
  }
  const execute = (command: string, arg: unknown) =>
    Promise.resolve(vscode.commands.executeCommand(command, arg));
  const { response } = await relayRequest(
    resolved.request,
    execute,
    (line) => emit({ kind: "log", line }),
    relayDeps,
  );
  emit({ kind: "response", response });
}

export function activate(context: vscode.ExtensionContext): void {
  try {
    installEasHost(context.extensionPath);
  } catch (e) {
    void vscode.window.showWarningMessage(`Expo Bridge: could not install eas-host: ${String(e)}`);
  }

  // One socket per window: several windows can share a container. See docs/protocol.md.
  const id = randomBytes(8).toString("hex");
  const activatedAt = Date.now();
  const warn = (e: unknown) =>
    void vscode.window.showWarningMessage(`Expo Bridge socket: ${String(e)}`);
  const register = () => {
    store.retain(workspaceFolders());
    try {
      writeEntry(SOCKET_DIR, id, {
        pid: process.pid,
        activatedAt,
        folders: workspaceFolders(),
      });
    } catch (e) {
      warn(e);
    }
  };

  const server = net.createServer((conn) => {
    const decoder = new LineDecoder<CliRequest>();
    const emit = (
      frame: { kind: "log"; line: string } | { kind: "response"; response: Response },
    ) => conn.write(encodeFrame(frame));
    conn.on("data", (chunk) => {
      for (const request of decoder.feed(chunk.toString("utf8"))) {
        void handleRequest(request, emit).then(() => conn.end());
      }
    });
    conn.on("error", () => conn.destroy());
  });
  server.on("error", warn);
  try {
    ensureRegistryDir(SOCKET_DIR);
    pruneStale(SOCKET_DIR);
    server.listen(socketPath(SOCKET_DIR, id), register);
  } catch (e) {
    warn(e);
  }

  const configWatcher = vscode.workspace.createFileSystemWatcher(PROJECT_ID_INPUTS_GLOB);
  const forget = (uri: vscode.Uri) =>
    projectIds.clear(containingFolder(workspaceFolders(), uri.fsPath) ?? undefined);
  configWatcher.onDidChange(forget);
  configWatcher.onDidCreate(forget);
  configWatcher.onDidDelete(forget);

  context.subscriptions.push(
    configWatcher,
    vscode.workspace.onDidChangeWorkspaceFolders(register),
    {
      dispose: () => {
        server.close();
        try {
          removeOwn(SOCKET_DIR, id);
        } catch {
          // best-effort cleanup on deactivate; a later activation prunes the dead entry
        }
      },
    },
  );
}

export function deactivate(): void {}
