import { describe, expect, test } from "bun:test";
import type { ExecResult } from "../src/exec";
import { ensureBooted, planBoot, SimulatorError, type Simctl } from "../src/simulator";

const OK = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
const IOS_25 = "com.apple.CoreSimulator.SimRuntime.iOS-25-0";
const IOS_26 = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";

interface Fake {
  devices?: Record<string, unknown[]>;
  runtimes?: unknown[];
  create?: ExecResult;
  bootstatus?: ExecResult;
}

/** A simctl that answers `list devices`, `list runtimes`, `create`, and `bootstatus`. */
function fake(f: Fake, calls: string[][] = []): Simctl {
  return async (args) => {
    calls.push(args);
    if (args[0] === "list" && args[1] === "devices")
      return OK(JSON.stringify({ devices: f.devices ?? {} }));
    if (args[0] === "list" && args[1] === "runtimes")
      return OK(JSON.stringify({ runtimes: f.runtimes ?? [] }));
    if (args[0] === "create") return f.create ?? OK("NEW-UDID\n");
    if (args[0] === "bootstatus") return f.bootstatus ?? OK();
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
}

const runtime = (identifier: string, version: string, types = ["iPhone 17", "iPhone 17 Pro"]) => ({
  identifier,
  name: `iOS ${version}`,
  version,
  isAvailable: true,
  supportedDeviceTypes: [
    { identifier: "ipad", name: "iPad Pro", productFamily: "iPad" },
    ...types.map((name) => ({
      identifier: name.replaceAll(" ", "-"),
      name,
      productFamily: "iPhone",
    })),
  ],
});

describe("planBoot", () => {
  test("uses a simulator that is already booted", async () => {
    const plan = await planBoot(
      fake({ devices: { [IOS_26]: [{ udid: "B", name: "iPhone 17", state: "Booted" }] } }),
    );
    expect(plan).toEqual({ kind: "booted", udid: "B", name: "iPhone 17" });
  });

  test("boots a shut-down iPhone on the newest iOS runtime, compared numerically", async () => {
    const plan = await planBoot(
      fake({
        runtimes: [runtime(IOS_26, "26.5"), runtime(IOS_25, "25.0")],
        devices: {
          [IOS_25]: [{ udid: "OLD", name: "iPhone 16", state: "Shutdown", isAvailable: true }],
          [IOS_26]: [
            { udid: "PAD", name: "iPad Pro", state: "Shutdown", isAvailable: true },
            { udid: "NEW", name: "iPhone 17", state: "Shutdown", isAvailable: true },
          ],
        },
      }),
    );
    expect(plan).toEqual({ kind: "boot", udid: "NEW", name: "iPhone 17" });
  });

  test("plans a new iPhone of the runtime's newest type when none exists", async () => {
    const plan = await planBoot(fake({ runtimes: [runtime(IOS_26, "26.5")] }));
    expect(plan).toEqual({
      kind: "create",
      runtime: IOS_26,
      deviceType: "iPhone-17-Pro",
      name: "expo-bridge iPhone 17 Pro",
    });
  });

  test("fails when no iOS runtime is available", async () => {
    const unavailable = { ...runtime(IOS_26, "26.5"), isAvailable: false };
    const watch = { ...runtime("watch", "12.0"), name: "watchOS 12.0" };
    await expect(planBoot(fake({ runtimes: [unavailable, watch] }))).rejects.toThrow(
      SimulatorError,
    );
  });
});

describe("ensureBooted", () => {
  test("boots nothing when a simulator is already booted", async () => {
    const calls: string[][] = [];
    const udid = await ensureBooted(
      fake({ devices: { [IOS_26]: [{ udid: "B", name: "iPhone 17", state: "Booted" }] } }, calls),
    );
    expect(udid).toBe("B");
    expect(calls.some((c) => c[0] === "bootstatus" || c[0] === "create")).toBe(false);
  });

  test("boots an existing iPhone and waits for it", async () => {
    const calls: string[][] = [];
    const udid = await ensureBooted(
      fake(
        {
          runtimes: [runtime(IOS_26, "26.5")],
          devices: { [IOS_26]: [{ udid: "S", name: "iPhone 17", state: "Shutdown" }] },
        },
        calls,
      ),
    );
    expect(udid).toBe("S");
    expect(calls.at(-1)).toEqual(["bootstatus", "S", "-b"]);
  });

  test("creates an iPhone, then boots it", async () => {
    const calls: string[][] = [];
    const udid = await ensureBooted(fake({ runtimes: [runtime(IOS_26, "26.5")] }, calls));
    expect(udid).toBe("NEW-UDID");
    expect(calls).toContainEqual(["create", "expo-bridge iPhone 17 Pro", "iPhone-17-Pro", IOS_26]);
    expect(calls.at(-1)).toEqual(["bootstatus", "NEW-UDID", "-b"]);
  });

  test("a failed boot is an error", async () => {
    const simctl = fake({
      runtimes: [runtime(IOS_26, "26.5")],
      bootstatus: { code: 1, stdout: "", stderr: "boot failed" },
    });
    await expect(ensureBooted(simctl)).rejects.toThrow("failed to boot");
  });

  test("a failed create is an error", async () => {
    const simctl = fake({
      runtimes: [runtime(IOS_26, "26.5")],
      create: { code: 1, stdout: "", stderr: "Invalid device type" },
    });
    await expect(ensureBooted(simctl)).rejects.toThrow("simctl create failed");
  });
});
