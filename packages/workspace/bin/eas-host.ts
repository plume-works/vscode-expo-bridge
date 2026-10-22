#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import * as net from "node:net";
import {
  PROTOCOL_VERSION,
  SOCKET_PATH,
  type StatusResult,
} from "@plume-works/expo-bridge-protocol";
import { containerBunVersion, parseArgs, UsageError } from "../src/cli-args";
import { encodeRequest, LineDecoder, type Frame } from "../src/wire";

/**
 * Run one action over the bridge socket. Exit codes: 0 success, 1 the action failed, 2 a
 * usage error, 3 the bridge is unavailable (no socket, or `status` reports unavailable or
 * another protocol version).
 * The final result prints as JSON on stdout; build log lines stream to stderr so stdout
 * stays a single parseable object.
 */
async function main(): Promise<number> {
  let request;
  try {
    const argv = process.argv.slice(2);
    const bun =
      argv[0] === "status"
        ? containerBunVersion((file, args) => execFileSync(file, args, { encoding: "utf8" }))
        : undefined;
    request = parseArgs(argv, bun);
  } catch (e) {
    process.stderr.write((e instanceof UsageError ? e.message : String(e)) + "\n");
    return 2;
  }

  return new Promise<number>((resolve) => {
    const decoder = new LineDecoder<Frame>();
    const socket = net.createConnection(SOCKET_PATH);
    let settled = false;
    const done = (code: number) => {
      if (!settled) {
        settled = true;
        socket.end();
        resolve(code);
      }
    };

    socket.on("connect", () => socket.write(encodeRequest(request)));
    socket.on("data", (chunk) => {
      for (const frame of decoder.feed(chunk.toString("utf8"))) {
        if (frame.kind === "log") {
          process.stderr.write(frame.line + "\n");
        } else {
          const r = frame.response;
          if (r.ok) {
            process.stdout.write(JSON.stringify(r.result) + "\n");
            done(request.action === "status" ? statusExit(r.result as StatusResult) : 0);
          } else {
            process.stdout.write(JSON.stringify(r.error) + "\n");
            done(r.error.code === "unavailable" ? 3 : 1);
          }
        }
      }
    });
    socket.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      process.stderr.write(
        code === "ENOENT" || code === "ECONNREFUSED"
          ? "expo bridge unavailable (no VS Code host); use EAS cloud\n"
          : `expo bridge socket error: ${err.message}\n`,
      );
      done(3);
    });
    socket.on("close", () => done(1));
  });
}

/** A host on another protocol version cannot serve this CLI, so it counts as unavailable. */
function statusExit(result: StatusResult): number {
  if (result.protocolVersion !== PROTOCOL_VERSION) {
    process.stderr.write(
      `expo bridge protocol version mismatch: host ${result.protocolVersion}, ` +
        `eas-host ${PROTOCOL_VERSION}; update the Expo Bridge extensions\n`,
    );
    return 3;
  }
  return result.available ? 0 : 3;
}

main().then((code) => process.exit(code));
