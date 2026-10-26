import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WRITE_DIR_REL, type Request, type StatusResult } from "@plume-works/expo-bridge-protocol";
import {
  DISPATCH_COMMAND,
  isCommandNotFound,
  projectIdCheck,
  relayRequest,
  runRequest,
  type RequestOutcome,
} from "../src/requests";

let folder: string;

beforeEach(() => {
  folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-requests-")));
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runRequest", () => {
  test("dispatches the request through the host command and returns its response", async () => {
    const calls: [string, unknown][] = [];
    const request: Request = { action: "launch", folder };
    const outcome = await runRequest(request, async (command, arg) => {
      calls.push([command, arg]);
      return { ok: true, result: { bundleIdentifier: "com.example.app" } };
    });
    expect(calls).toEqual([[DISPATCH_COMMAND, request]]);
    expect(outcome).toEqual({
      response: { ok: true, result: { bundleIdentifier: "com.example.app" } },
      hostMissing: false,
    });
  });

  test("reports a missing host command as host-not-installed", async () => {
    const outcome = await runRequest({ action: "status", folder }, async () => {
      throw new Error(`command '${DISPATCH_COMMAND}' not found`);
    });
    expect(outcome.hostMissing).toBe(true);
    expect(outcome.response).toEqual({
      ok: false,
      error: { code: "action-failed", message: `command '${DISPATCH_COMMAND}' not found` },
    });
  });

  test("reports any other failure without host-not-installed", async () => {
    const outcome = await runRequest({ action: "launch", folder }, async () => {
      throw new Error("simctl failed");
    });
    expect(outcome.hostMissing).toBe(false);
    expect(outcome.response).toEqual({
      ok: false,
      error: { code: "action-failed", message: "simctl failed" },
    });
  });

  test("streams the build log written while a build runs", async () => {
    const lines: string[] = [];
    const outcome = await runRequest(
      { action: "build", profile: "development", folder },
      async () => {
        const dir = path.join(folder, WRITE_DIR_REL);
        fs.mkdirSync(dir, { recursive: true });
        await sleep(50);
        fs.writeFileSync(path.join(dir, "build-1.log"), "one\ntwo\n");
        await sleep(700);
        fs.appendFileSync(path.join(dir, "build-1.log"), "three\n");
        await sleep(400);
        return { ok: true, result: { artifactRel: "a.tar.gz", logRel: "b.log", exitCode: 0 } };
      },
      (line) => lines.push(line),
    );
    expect(outcome.response.ok).toBe(true);
    expect(lines).toEqual(["one", "two", "three"]);
  });
});

describe("isCommandNotFound", () => {
  test("matches only the named command", () => {
    expect(isCommandNotFound(new Error("command 'a.b' not found"), "a.b")).toBe(true);
    expect(isCommandNotFound(new Error("command 'a.c' not found"), "a.b")).toBe(false);
    expect(isCommandNotFound("boom", "a.b")).toBe(false);
  });
});

const hostStatus = {
  protocolVersion: 2,
  available: true,
  folderHostPath: "/Users/me/app",
  checks: {
    easProjectId: { ok: false, detail: "extra.eas.projectId not set in app.json" },
    node: { ok: true },
  },
} as unknown as StatusResult;

describe("relayRequest", () => {
  test("replaces the host's easProjectId with the container's resolution", async () => {
    const seen: RequestOutcome[] = [];
    const outcome = await relayRequest(
      { action: "status", folder },
      async () => ({ ok: true, result: hostStatus }),
      () => {},
      {
        projectId: async (f) =>
          f === folder ? { state: "set", projectId: "id" } : { state: "not-set" },
        onOutcome: (_req, o) => seen.push(o),
      },
    );
    const result = (outcome.response as { result: StatusResult }).result;
    expect(result.checks.easProjectId).toEqual({ ok: true });
    expect(result.checks.node).toEqual({ ok: true });
    expect(hostStatus.checks.easProjectId.ok).toBe(false);
    expect(seen).toEqual([outcome]);
  });

  test("leaves failed and non-status responses alone, and still reports them", async () => {
    const seen: string[] = [];
    let resolved = 0;
    const deps = {
      projectId: async () => (resolved++, { state: "set" as const, projectId: "id" }),
      onOutcome: (req: Request) => seen.push(req.action),
    };
    const failed = await relayRequest(
      { action: "status", folder },
      async () => ({ ok: false, error: { code: "unavailable", message: "no" } }),
      () => {},
      deps,
    );
    expect(failed.response.ok).toBe(false);
    await relayRequest(
      { action: "launch", folder },
      async () => ({ ok: true, result: { bundleIdentifier: "x" } }),
      () => {},
      deps,
    );
    expect(resolved).toBe(0);
    expect(seen).toEqual(["status", "launch"]);
  });
});

describe("projectIdCheck", () => {
  test("maps each resolution to a check", () => {
    expect(projectIdCheck({ state: "set", projectId: "x" })).toEqual({ ok: true });
    expect(projectIdCheck({ state: "not-set" })).toEqual({
      ok: false,
      detail: "extra.eas.projectId not set in the app config",
    });
    expect(projectIdCheck({ state: "unresolved", reason: "why" })).toEqual({
      ok: false,
      detail: "why",
    });
  });
});
