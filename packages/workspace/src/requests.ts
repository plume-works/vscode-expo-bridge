import {
  type BuildLogChunk,
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

/** Routes the host's build log chunks to the requests building each folder, as lines. */
export class BuildLogs {
  private readonly sinks = new Map<string, Set<(chunk: string) => void>>();

  /** Handle one call of `BUILD_LOG_COMMAND`; anything but a `BuildLogChunk` is ignored. */
  receive(arg: unknown): void {
    const { folder, chunk } = (arg ?? {}) as Partial<BuildLogChunk>;
    if (typeof folder !== "string" || typeof chunk !== "string") return;
    for (const sink of this.sinks.get(folder) ?? []) sink(chunk);
  }

  /** Pass `folder`'s log to `onLine` line by line; the returned stop emits an unended last line. */
  open(folder: string, onLine: (line: string) => void): () => void {
    let partial = "";
    const sink = (chunk: string) => {
      const lines = (partial + chunk).split("\n");
      partial = lines.pop()!;
      for (const line of lines) onLine(line);
    };
    const sinks = this.sinks.get(folder) ?? new Set();
    this.sinks.set(folder, sinks.add(sink));
    return () => {
      sinks.delete(sink);
      if (!sinks.size) this.sinks.delete(folder);
      if (partial) onLine(partial);
    };
  }
}

/** VS Code rejects a command no extension host registered with this message. */
export function isCommandNotFound(e: unknown, command: string): boolean {
  const message = String((e as Error)?.message ?? e);
  return message.includes(`command '${command}' not found`);
}

/**
 * Send one protocol request to the host, passing `onLog` the build log `logs` receives while
 * a `build` runs. The socket handler and the workspace UI both send requests through here.
 */
export async function runRequest(
  request: Request,
  execute: Execute,
  onLog: (line: string) => void = () => {},
  logs?: BuildLogs,
): Promise<RequestOutcome> {
  const stopLog = request.action === "build" ? logs?.open(request.folder, onLog) : undefined;
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
    stopLog?.();
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
  /** Where the host's build log chunks arrive. */
  buildLogs?: BuildLogs;
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
  let outcome = await runRequest(request, execute, onLog, deps.buildLogs);
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
