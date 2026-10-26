import { describe, expect, test } from "bun:test";
import type { StatusResult } from "@plume-works/expo-bridge-protocol";
import { StatusStore } from "../src/statusstore";

const result = { available: true, checks: {} } as unknown as StatusResult;

describe("StatusStore", () => {
  test("keeps the last status result per folder, with its time", () => {
    let t = 1;
    const store = new StatusStore(() => t);
    store.record(
      { action: "status", folder: "/a" },
      { response: { ok: true, result }, hostMissing: false },
    );
    t = 2;
    store.record(
      { action: "status", folder: "/b" },
      {
        response: { ok: false, error: { code: "action-failed", message: "boom" } },
        hostMissing: false,
      },
    );
    expect(store.get("/a")).toEqual({ kind: "status", result, at: 1 });
    expect(store.get("/b")).toEqual({ kind: "failed", message: "boom", at: 2 });
  });

  test("any request can reveal a missing host", () => {
    const store = new StatusStore(() => 5);
    store.record(
      { action: "launch", folder: "/a" },
      {
        response: { ok: false, error: { code: "action-failed", message: "x" } },
        hostMissing: true,
      },
    );
    expect(store.get("/a")).toEqual({ kind: "host-missing", at: 5 });
  });

  test("other actions leave the last status alone and fire nothing", () => {
    const store = new StatusStore(() => 1);
    let fired = 0;
    store.onDidChange(() => fired++);
    store.record(
      { action: "status", folder: "/a" },
      { response: { ok: true, result }, hostMissing: false },
    );
    store.record(
      { action: "build", profile: "p", folder: "/a" },
      {
        response: { ok: false, error: { code: "build-declined", message: "no" } },
        hostMissing: false,
      },
    );
    expect(store.get("/a")?.kind).toBe("status");
    expect(fired).toBe(1);
  });

  test("retain forgets removed folders and fires once", () => {
    const store = new StatusStore(() => 1);
    store.record(
      { action: "status", folder: "/a" },
      { response: { ok: true, result }, hostMissing: false },
    );
    store.record(
      { action: "status", folder: "/b" },
      { response: { ok: true, result }, hostMissing: false },
    );
    let fired = 0;
    const sub = store.onDidChange(() => fired++);
    store.retain(["/b"]);
    store.retain(["/b"]);
    expect(store.get("/a")).toBeUndefined();
    expect(store.get("/b")?.kind).toBe("status");
    expect(fired).toBe(1);
    sub.dispose();
    store.retain([]);
    expect(fired).toBe(1);
  });
});
