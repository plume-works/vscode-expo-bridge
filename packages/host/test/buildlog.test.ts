import { describe, expect, test } from "bun:test";
import { LogForwarder } from "../src/buildlog";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("LogForwarder", () => {
  test("sends one call at a time, joining the chunks pushed while a call is out", async () => {
    const sent: string[] = [];
    const gate = deferred();
    const logs = new LogForwarder(async (chunk) => {
      sent.push(chunk);
      if (sent.length === 1) await gate.promise;
    });
    logs.push("a");
    logs.push("b");
    logs.push("c");
    expect(sent).toEqual(["a"]);
    gate.resolve();
    await logs.drain();
    expect(sent).toEqual(["a", "bc"]);
  });

  test("drain waits for chunks pushed after an earlier drain", async () => {
    const sent: string[] = [];
    const logs = new LogForwarder(async (chunk) => void sent.push(chunk));
    logs.push("a");
    await logs.drain();
    logs.push("b");
    await logs.drain();
    expect(sent).toEqual(["a", "b"]);
  });

  test("stops sending after a failed call, and drain still resolves", async () => {
    let calls = 0;
    const logs = new LogForwarder(async () => {
      calls++;
      throw new Error("command 'expoBridge.workspace.buildLog' not found");
    });
    logs.push("a");
    await logs.drain();
    logs.push("b");
    await logs.drain();
    expect(calls).toBe(1);
  });
});
