import * as net from "node:net";

/**
 * True when a TCP connection to `127.0.0.1:<port>` on this machine succeeds within the
 * timeout. VS Code listens on the local end of a forwarded port, so this detects forwarding.
 */
export function portAcceptsConnections(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
