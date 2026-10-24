import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { SOCKET_DIR } from "@plume-works/expo-bridge-protocol";
import { HELP, noWindowMessage, type CliRequest } from "../src/cli-args";
import { ensureRegistryDir, removeOwn, socketPath, writeEntry } from "../src/registry";
import { encodeFrame, LineDecoder } from "../src/wire";

const CLI = path.join(import.meta.dir, "..", "bin", "eas-host.ts");
const ID = `test-${process.pid}`;

// The CLI runs inside a workspace folder of the window this test registers.
let folder: string;
let outside: string;

beforeAll(() => {
  folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-cli-")));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-cli-out-")));
  fs.mkdirSync(path.join(folder, "src"));
});

afterAll(() => {
  fs.rmSync(folder, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], cwd: string = folder): Promise<Run> {
  const proc = Bun.spawn(["bun", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("eas-host CLI", () => {
  test("usage error exits 2", async () => {
    const r = await runCli(["deploy"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage");
  });

  test("--help prints the help on stdout and exits 0", async () => {
    const r = await runCli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(HELP + "\n");
  });

  test("build with no profile exits 2", async () => {
    expect((await runCli(["build"])).code).toBe(2);
  });

  describe("against a socket", () => {
    let server: net.Server;
    let onRequest: (req: CliRequest, conn: net.Socket) => void;

    beforeEach(async () => {
      ensureRegistryDir(SOCKET_DIR);
      removeOwn(SOCKET_DIR, ID);
      server = net.createServer((conn) => {
        const decoder = new LineDecoder<CliRequest>();
        conn.on("data", (chunk) => {
          for (const req of decoder.feed(chunk.toString("utf8"))) onRequest(req, conn);
        });
      });
      await new Promise<void>((resolve) => server.listen(socketPath(SOCKET_DIR, ID), resolve));
      writeEntry(SOCKET_DIR, ID, { pid: process.pid, activatedAt: Date.now(), folders: [folder] });
    });

    afterEach(() => {
      server.close();
      removeOwn(SOCKET_DIR, ID);
    });

    test("a run in a subdirectory of the folder sends its real working directory", async () => {
      let sent: CliRequest | undefined;
      onRequest = (req, conn) => {
        sent = req;
        conn.write(
          encodeFrame({
            kind: "response",
            response: { ok: true, result: { bundleIdentifier: "com.a" } },
          }),
        );
        conn.end();
      };
      const r = await runCli(["launch"], path.join(folder, "src"));
      expect(r.code).toBe(0);
      expect(sent).toEqual({ action: "launch", cwd: path.join(folder, "src") });
    });

    test("a run outside every workspace folder exits 3 and names the directory", async () => {
      onRequest = () => {
        throw new Error("no request expected");
      };
      const r = await runCli(["status"], outside);
      expect(r.code).toBe(3);
      expect(r.stderr).toBe(noWindowMessage(outside) + "\n");
    });

    test("status success prints the result and exits 0", async () => {
      onRequest = (_req, conn) => {
        conn.write(
          encodeFrame({
            kind: "response",
            response: {
              ok: true,
              result: {
                protocolVersion: 2,
                available: true,
                folderHostPath: "",
                checks: {} as never,
              },
            },
          }),
        );
        conn.end();
      };
      const r = await runCli(["status"]);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).available).toBe(true);
    });

    test("a status result with available false prints it and exits 3", async () => {
      onRequest = (_req, conn) => {
        conn.write(
          encodeFrame({
            kind: "response",
            response: {
              ok: true,
              result: {
                protocolVersion: 2,
                available: false,
                folderHostPath: "",
                checks: {} as never,
              },
            },
          }),
        );
        conn.end();
      };
      const r = await runCli(["status"]);
      expect(r.code).toBe(3);
      expect(JSON.parse(r.stdout).available).toBe(false);
    });

    test("a status from a version 1 host exits 3 and names both versions", async () => {
      onRequest = (_req, conn) => {
        conn.write(
          encodeFrame({
            kind: "response",
            response: {
              ok: true,
              result: {
                protocolVersion: 1,
                available: true,
                folderHostPath: "",
                checks: {} as never,
              },
            },
          }),
        );
        conn.end();
      };
      const r = await runCli(["status"]);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain("protocol version mismatch");
      expect(r.stderr).toContain("host 1, eas-host 2");
    });

    test("an unavailable error exits 3", async () => {
      onRequest = (_req, conn) => {
        conn.write(
          encodeFrame({
            kind: "response",
            response: { ok: false, error: { code: "unavailable", message: "x" } },
          }),
        );
        conn.end();
      };
      expect((await runCli(["status"])).code).toBe(3);
    });

    test("an action failure exits 1", async () => {
      onRequest = (_req, conn) => {
        conn.write(
          encodeFrame({
            kind: "response",
            response: { ok: false, error: { code: "action-failed", message: "x" } },
          }),
        );
        conn.end();
      };
      expect((await runCli(["launch"])).code).toBe(1);
    });

    test("build log frames stream to stderr, the result to stdout", async () => {
      onRequest = (req, conn) => {
        expect(req).toEqual({ action: "build", profile: "development", cwd: folder });
        conn.write(encodeFrame({ kind: "log", line: "PREBUILD" }));
        conn.write(encodeFrame({ kind: "log", line: "bun install v1.4.3" }));
        conn.write(
          encodeFrame({
            kind: "response",
            response: {
              ok: true,
              result: {
                artifactRel: ".tmp/expo-bridge/a.tar.gz",
                logRel: ".tmp/expo-bridge/b.log",
                exitCode: 0,
              },
            },
          }),
        );
        conn.end();
      };
      const r = await runCli(["build", "development"]);
      expect(r.code).toBe(0);
      expect(r.stderr).toContain("PREBUILD");
      expect(r.stderr).toContain("bun install");
      expect(JSON.parse(r.stdout).artifactRel).toBe(".tmp/expo-bridge/a.tar.gz");
    });
  });

  test("no registered window at all exits 3 (bridge unavailable)", async () => {
    removeOwn(SOCKET_DIR, ID);
    const r = await runCli(["status"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("unavailable");
  });

  test("a registered window whose socket is gone exits 3", async () => {
    ensureRegistryDir(SOCKET_DIR);
    writeEntry(SOCKET_DIR, ID, { pid: process.pid, activatedAt: Date.now(), folders: [folder] });
    try {
      const r = await runCli(["status"]);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain("unavailable");
    } finally {
      removeOwn(SOCKET_DIR, ID);
    }
  });
});
