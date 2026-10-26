import * as fs from "node:fs";
import * as path from "node:path";
import {
  WRITE_DIR_REL,
  type Request,
  type Response,
  type StatusCheck,
  type StatusResult,
} from "@plume-works/expo-bridge-protocol";
import type { ProjectId } from "./appconfig";

/** The ui-side command the host extension registers to receive a protocol request. */
export const DISPATCH_COMMAND = "expoBridge.ui.dispatch";

/** Runs a VS Code command; `vscode.commands.executeCommand` in the extension. */
export type Execute = (command: string, arg: unknown) => Promise<unknown>;

export interface RequestOutcome {
  response: Response;
  /** The host extension is not installed on this window's UI side. */
  hostMissing: boolean;
}

/** Tail a log file, invoking `onLine` for each new line until `stop()` is called. */
export function tailLog(logPath: string, onLine: (line: string) => void): () => void {
  let offset = 0;
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
        for (const line of buf.toString("utf8").split("\n").slice(0, -1)) onLine(line);
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

export function newestBuildLog(folder: string, since: number): string | null {
  const dir = path.join(folder, WRITE_DIR_REL);
  if (!fs.existsSync(dir)) return null;
  const logs = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("build-") && f.endsWith(".log"))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .filter((x) => x.m >= since)
    .sort((a, b) => b.m - a.m);
  return logs.length ? path.join(dir, logs[0]!.f) : null;
}

/** VS Code rejects a command no extension host registered with this message. */
export function isCommandNotFound(e: unknown, command: string): boolean {
  const message = String((e as Error)?.message ?? e);
  return message.includes(`command '${command}' not found`);
}

/**
 * Send one protocol request to the host, streaming the build log to `onLog` while a
 * `build` runs. The socket handler and the workspace UI both send requests through here.
 */
export async function runRequest(
  request: Request,
  execute: Execute,
  onLog: (line: string) => void = () => {},
): Promise<RequestOutcome> {
  let stopTail: (() => void) | undefined;
  if (request.action === "build") {
    const since = Date.now();
    const poll = setInterval(() => {
      const log = newestBuildLog(request.folder, since);
      if (log) {
        clearInterval(poll);
        stopTail = tailLog(log, onLog);
      }
    }, 250);
    stopTail = () => clearInterval(poll);
  }
  try {
    const response = (await execute(DISPATCH_COMMAND, request)) as Response;
    return { response, hostMissing: false };
  } catch (e) {
    return {
      response: {
        ok: false,
        error: { code: "action-failed", message: String((e as Error)?.message ?? e) },
      },
      hostMissing: isCommandNotFound(e, DISPATCH_COMMAND),
    };
  } finally {
    stopTail?.();
  }
}

/** The `easProjectId` check for a project ID the container resolved. */
export function projectIdCheck(id: ProjectId): StatusCheck {
  if (id.state === "set") return { ok: true };
  if (id.state === "not-set")
    return { ok: false, detail: "extra.eas.projectId not set in the app config" };
  return { ok: false, detail: id.reason };
}

export interface RelayDeps {
  /** The container's resolution of the request folder's project ID. */
  projectId: (folder: string) => Promise<ProjectId>;
  /** Sees every outcome, after the container's checks replaced the host's. */
  onOutcome?: (request: Request, outcome: RequestOutcome) => void;
}

/**
 * `runRequest`, with every successful `status` result's `easProjectId` replaced by the
 * container's resolution of the app config, so `eas-host` and the workspace UI agree.
 */
export async function relayRequest(
  request: Request,
  execute: Execute,
  onLog: (line: string) => void,
  deps: RelayDeps,
): Promise<RequestOutcome> {
  let outcome = await runRequest(request, execute, onLog);
  const { response } = outcome;
  if (request.action === "status" && response.ok) {
    const result = response.result as StatusResult;
    if (result?.checks) {
      const easProjectId = projectIdCheck(await deps.projectId(request.folder));
      outcome = {
        ...outcome,
        response: { ok: true, result: { ...result, checks: { ...result.checks, easProjectId } } },
      };
    }
  }
  deps.onOutcome?.(request, outcome);
  return outcome;
}
