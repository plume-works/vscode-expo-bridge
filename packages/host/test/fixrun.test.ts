import { describe, expect, test } from "bun:test";
import { FixGate, runCommands } from "../src/fixrun";

describe("runCommands", () => {
  test("runs every command in order when each succeeds", async () => {
    const ran: string[] = [];
    const ok = await runCommands(async (c) => (ran.push(c), 0), ["a", "b", "c"]);
    expect(ok).toBe(true);
    expect(ran).toEqual(["a", "b", "c"]);
  });

  test("stops at the first command that fails", async () => {
    const ran: string[] = [];
    const ok = await runCommands(async (c) => (ran.push(c), c === "b" ? 1 : 0), ["a", "b", "c"]);
    expect(ok).toBe(false);
    expect(ran).toEqual(["a", "b"]);
  });

  test("an unknown exit code does not stop the fix", async () => {
    const ran: string[] = [];
    expect(await runCommands(async (c) => (ran.push(c), undefined), ["a", "b"])).toBe(true);
    expect(ran).toEqual(["a", "b"]);
  });
});

describe("FixGate", () => {
  test("refuses a second fix while one runs, and allows one after", async () => {
    const gate = new FixGate();
    let release!: () => void;
    const first = gate.run(() => new Promise<void>((r) => (release = r)));
    expect(gate.running).toBe(true);
    expect(await gate.run(async () => {})).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(gate.running).toBe(false);
    expect(await gate.run(async () => {})).toBe(true);
  });

  test("a failing fix releases the gate", async () => {
    const gate = new FixGate();
    await expect(gate.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(gate.running).toBe(false);
  });
});
