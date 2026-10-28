import type { Request, StatusResult } from "@plume-works/expo-bridge-protocol";
import type { RequestOutcome } from "./requests";

/** What the window last learned about a folder's bridge. */
export type FolderState =
  | { kind: "status"; result: StatusResult; at: number }
  | { kind: "host-missing"; at: number }
  | { kind: "failed"; message: string; at: number };

/** The last state per workspace folder, from every request the window relays. */
export class StatusStore {
  private states = new Map<string, FolderState>();
  private listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Record an outcome: any request can reveal a missing host; only `status` sets a result. */
  record(request: Request, outcome: RequestOutcome): void {
    const at = this.now();
    let state: FolderState | undefined;
    if (outcome.hostMissing) state = { kind: "host-missing", at };
    else if (request.action === "status") {
      state = outcome.response.ok
        ? { kind: "status", result: outcome.response.result as StatusResult, at }
        : { kind: "failed", message: outcome.response.error.message, at };
    }
    if (!state) return;
    this.states.set(request.folder, state);
    this.fire();
  }

  get(folder: string): FolderState | undefined {
    return this.states.get(folder);
  }

  /** Forget folders that are no longer workspace folders of the window. */
  retain(folders: readonly string[]): void {
    let changed = false;
    for (const folder of [...this.states.keys()]) {
      if (!folders.includes(folder)) changed = this.states.delete(folder) || changed;
    }
    if (changed) this.fire();
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private fire(): void {
    for (const listener of this.listeners) listener();
  }
}
