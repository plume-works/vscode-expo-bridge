import { describe, expect, test } from "bun:test";
import * as net from "node:net";
import { portAcceptsConnections } from "../src/port";

describe("portAcceptsConnections", () => {
  test("true when something listens on the port", async () => {
    const server = net.createServer((c) => c.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      expect(await portAcceptsConnections(port, 500)).toBe(true);
    } finally {
      server.close();
    }
  });

  test("false when nothing listens on the port", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await portAcceptsConnections(port, 500)).toBe(false);
  });
});
