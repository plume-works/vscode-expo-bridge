import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as net from "node:net";
import * as path from "node:path";
import { SOCKET_PATH, type Request } from "@plume-works/expo-bridge-protocol";
import { encodeFrame, LineDecoder } from "../src/wire";

const CLI = path.join(import.meta.dir, "..", "bin", "eas-host.ts");

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<Run> {
  const proc = Bun.spawn(["bun", CLI, ...args], { stdout: "pipe", stderr: "pipe" });
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

  test("build with no profile exits 2", async () => {
    expect((await runCli(["build"])).code).toBe(2);
  });

  describe("against a socket", () => {
    let server: net.Server;
    let onRequest: (req: Request, conn: net.Socket) => void;

    beforeEach(async () => {
      try {
        require("node:fs").rmSync(SOCKET_PATH, { force: true });
      } catch {
        /* ignore */
      }
      server = net.createServer((conn) => {
        const decoder = new LineDecoder<Request>();
        conn.on("data", (chunk) => {
          for (const req of decoder.feed(chunk.toString("utf8"))) onRequest(req, conn);
        });
      });
      await new Promise<void>((resolve) => server.listen(SOCKET_PATH, resolve));
    });

    afterEach(() => {
      server.close();
      try {
        require("node:fs").rmSync(SOCKET_PATH, { force: true });
      } catch {
        /* ignore */
      }
    });

    test("status success prints the result and exits 0", async () => {
      onRequest = (_req, conn) => {
        conn.write(encodeFrame({ kind: "response", response: { ok: true, result: { protocolVersion: 1, available: true, checks: {} as never } } }));
        conn.end();
      };
      const r = await runCli(["status"]);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout).available).toBe(true);
    });

    test("a status result with available false prints it and exits 3", async () => {
      onRequest = (_req, conn) => {
        conn.write(encodeFrame({ kind: "response", response: { ok: true, result: { protocolVersion: 1, available: false, checks: {} as never } } }));
        conn.end();
      };
      const r = await runCli(["status"]);
      expect(r.code).toBe(3);
      expect(JSON.parse(r.stdout).available).toBe(false);
    });

    test("an unavailable error exits 3", async () => {
      onRequest = (_req, conn) => {
        conn.write(encodeFrame({ kind: "response", response: { ok: false, error: { code: "unavailable", message: "x" } } }));
        conn.end();
      };
      expect((await runCli(["status"])).code).toBe(3);
    });

    test("an action failure exits 1", async () => {
      onRequest = (_req, conn) => {
        conn.write(encodeFrame({ kind: "response", response: { ok: false, error: { code: "action-failed", message: "x" } } }));
        conn.end();
      };
      expect((await runCli(["launch"])).code).toBe(1);
    });

    test("build log frames stream to stderr, the result to stdout", async () => {
      onRequest = (req, conn) => {
        expect(req).toEqual({ action: "build", profile: "development" });
        conn.write(encodeFrame({ kind: "log", line: "PREBUILD" }));
        conn.write(encodeFrame({ kind: "log", line: "bun install v1.4.3" }));
        conn.write(encodeFrame({ kind: "response", response: { ok: true, result: { artifactRel: ".tmp/expo-bridge/a.tar.gz", logRel: ".tmp/expo-bridge/b.log", exitCode: 0 } } }));
        conn.end();
      };
      const r = await runCli(["build", "development"]);
      expect(r.code).toBe(0);
      expect(r.stderr).toContain("PREBUILD");
      expect(r.stderr).toContain("bun install");
      expect(JSON.parse(r.stdout).artifactRel).toBe(".tmp/expo-bridge/a.tar.gz");
    });
  });

  test("no socket at all exits 3 (bridge unavailable)", async () => {
    try {
      require("node:fs").rmSync(SOCKET_PATH, { force: true });
    } catch {
      /* ignore */
    }
    const r = await runCli(["status"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("unavailable");
  });
});
