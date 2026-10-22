import type { ExecResult } from "./exec";
import { versionGte } from "./status";

/** Runs `xcrun simctl <args>`. */
export type Simctl = (args: string[]) => Promise<ExecResult>;

interface Device {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
}

interface Runtime {
  identifier: string;
  name: string;
  version: string;
  isAvailable?: boolean;
  supportedDeviceTypes?: { identifier: string; name: string; productFamily?: string }[];
}

/** What `ensureBooted` would do: use a booted device, boot an existing one, or create one. */
export type BootPlan =
  | { kind: "booted"; udid: string; name: string }
  | { kind: "boot"; udid: string; name: string }
  | { kind: "create"; runtime: string; deviceType: string; name: string };

export class SimulatorError extends Error {}

async function listJson<T>(simctl: Simctl, args: string[]): Promise<T> {
  const r = await simctl(["list", ...args, "-j"]);
  if (r.code !== 0) throw new SimulatorError(`simctl list ${args.join(" ")} failed`);
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    throw new SimulatorError(`simctl list ${args.join(" ")} returned no JSON`);
  }
}

/** Decide which simulator to use, preferring one already booted; changes nothing. */
export async function planBoot(simctl: Simctl): Promise<BootPlan> {
  const { devices } = await listJson<{ devices?: Record<string, Device[]> }>(simctl, ["devices"]);
  const all = Object.values(devices ?? {}).flat();
  const booted = all.find((d) => d.state === "Booted");
  if (booted) return { kind: "booted", udid: booted.udid, name: booted.name };

  const { runtimes } = await listJson<{ runtimes?: Runtime[] }>(simctl, ["runtimes"]);
  const newest = (runtimes ?? [])
    .filter((r) => r.isAvailable !== false && r.name.startsWith("iOS"))
    .sort((a, b) => (versionGte(a.version, b.version) ? -1 : 1))[0];
  if (!newest) throw new SimulatorError("no available iOS simulator runtime");

  const existing = (devices?.[newest.identifier] ?? []).find(
    (d) => d.isAvailable !== false && d.name.startsWith("iPhone"),
  );
  if (existing) return { kind: "boot", udid: existing.udid, name: existing.name };

  const iphone = (newest.supportedDeviceTypes ?? [])
    .filter((t) => t.productFamily === "iPhone" || t.name.startsWith("iPhone"))
    .at(-1);
  if (!iphone) throw new SimulatorError(`${newest.name} supports no iPhone device type`);
  return {
    kind: "create",
    runtime: newest.identifier,
    deviceType: iphone.identifier,
    name: `expo-bridge ${iphone.name}`,
  };
}

/** Return the UDID of a booted simulator, creating and booting one when none is booted. */
export async function ensureBooted(simctl: Simctl): Promise<string> {
  const plan = await planBoot(simctl);
  if (plan.kind === "booted") return plan.udid;

  let udid: string;
  if (plan.kind === "create") {
    const created = await simctl(["create", plan.name, plan.deviceType, plan.runtime]);
    udid = created.stdout.trim();
    if (created.code !== 0 || !udid) throw new SimulatorError("simctl create failed");
  } else {
    udid = plan.udid;
  }
  // -b boots the device when it is shut down, then waits until it has finished booting.
  const boot = await simctl(["bootstatus", udid, "-b"]);
  if (boot.code !== 0) throw new SimulatorError("the simulator failed to boot");
  return udid;
}
