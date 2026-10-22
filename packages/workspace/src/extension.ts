import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  SOCKET_PATH,
  WRITE_DIR_REL,
  type Request,
  type Response,
} from "@plume-works/expo-bridge-protocol";
import { encodeFrame, LineDecoder } from "./wire";

const DISPATCH_COMMAND = "expoBridge.ui.dispatch";
const EAS_HOST_SCRIPT = "eas-host.js";

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

/** Tail a log file, invoking `onLine` for each new line until `stop()` is called. */
function tailLog(logPath: string, onLine: (line: string) => void): () => void {
  let offset = 0;
  const decoder = new LineDecoder<never>();
  let closed = false;
  const read = () => {
    if (closed || !fs.existsSync(logPath)) return;
    const fd = fs.openSync(logPath, "r");
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size > offset) {
        const buf = Buffer.alloc(stat.size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        offset = stat.size;
        const text = buf.toString("utf8");
        for (const line of text.split("\n").slice(0, -1)) onLine(line);
        void decoder;
      }
    } finally {
      fs.closeSync(fd);
    }
  };
  const timer = setInterval(read, 250);
  return () => {
    closed = true;
    clearInterval(timer);
    read();
  };
}

function newestBuildLog(workspaceRoot: string, since: number): string | null {
  const dir = path.join(workspaceRoot, WRITE_DIR_REL);
  if (!fs.existsSync(dir)) return null;
  const logs = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("build-") && f.endsWith(".log"))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .filter((x) => x.m >= since)
    .sort((a, b) => b.m - a.m);
  return logs.length ? path.join(dir, logs[0]!.f) : null;
}

async function handleRequest(
  request: Request,
  workspaceRoot: string | undefined,
  emit: (frame: { kind: "log"; line: string } | { kind: "response"; response: Response }) => void,
): Promise<void> {
  let stopTail: (() => void) | undefined;
  if (request.action === "build" && workspaceRoot) {
    const since = Date.now();
    const poll = setInterval(() => {
      const log = newestBuildLog(workspaceRoot, since);
      if (log) {
        clearInterval(poll);
        stopTail = tailLog(log, (line) => emit({ kind: "log", line }));
      }
    }, 250);
    stopTail = () => clearInterval(poll);
  }
  try {
    const response = (await vscode.commands.executeCommand(DISPATCH_COMMAND, request)) as Response;
    emit({ kind: "response", response });
  } catch (e) {
    emit({
      kind: "response",
      response: {
        ok: false,
        error: { code: "action-failed", message: String((e as Error)?.message ?? e) },
      },
    });
  } finally {
    stopTail?.();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  try {
    installEasHost(context.extensionPath);
  } catch (e) {
    void vscode.window.showWarningMessage(`Expo Bridge: could not install eas-host: ${String(e)}`);
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  try {
    fs.rmSync(SOCKET_PATH, { force: true });
  } catch {
    // a stale socket that cannot be removed will surface as a listen error below
  }

  const server = net.createServer((conn) => {
    const decoder = new LineDecoder<Request>();
    const emit = (
      frame: { kind: "log"; line: string } | { kind: "response"; response: Response },
    ) => conn.write(encodeFrame(frame));
    conn.on("data", (chunk) => {
      for (const request of decoder.feed(chunk.toString("utf8"))) {
        void handleRequest(request, workspaceRoot, emit).then(() => conn.end());
      }
    });
    conn.on("error", () => conn.destroy());
  });
  server.on(
    "error",
    (e) => void vscode.window.showWarningMessage(`Expo Bridge socket: ${String(e)}`),
  );
  server.listen(SOCKET_PATH);

  context.subscriptions.push({
    dispose: () => {
      server.close();
      try {
        fs.rmSync(SOCKET_PATH, { force: true });
      } catch {
        // best-effort cleanup on deactivate
      }
    },
  });
}

export function deactivate(): void {}
