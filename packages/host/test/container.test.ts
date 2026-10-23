import { describe, expect, test } from "bun:test";
import {
  bindMounts,
  ContainerError,
  dockerHostArgs,
  findContainer,
  macSource,
} from "../src/container";
import type { ExecResult, Runner } from "../src/exec";

function recording(result: Partial<ExecResult>): { runner: Runner; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    runner: {
      async run(file, args) {
        calls.push([file, ...args]);
        return { code: 0, stdout: "", stderr: "", ...result };
      },
    },
  };
}

describe("dockerHostArgs", () => {
  test("none for the default daemon; a socket path becomes a unix URL", () => {
    expect(dockerHostArgs(undefined)).toEqual([]);
    expect(dockerHostArgs("/Users/me/.colima/docker.sock")).toEqual([
      "-H",
      "unix:///Users/me/.colima/docker.sock",
    ]);
    expect(dockerHostArgs("tcp://10.0.0.2:2376")).toEqual(["-H", "tcp://10.0.0.2:2376"]);
  });
});

describe("findContainer", () => {
  test("filters on the host path label, as an argument array", async () => {
    const { runner, calls } = recording({ stdout: "abc123\n" });
    const id = await findContainer("/usr/bin/docker", { hostPath: "/Users/me/a b" }, runner, {});
    expect(id).toBe("abc123");
    expect(calls).toEqual([
      [
        "/usr/bin/docker",
        "ps",
        "--no-trunc",
        "--filter",
        "label=devcontainer.local_folder=/Users/me/a b",
        "--format",
        "{{.ID}}",
      ],
    ]);
  });

  test("also filters on the config file, against the authority's daemon", async () => {
    const { runner, calls } = recording({ stdout: "abc123\n" });
    await findContainer(
      "docker",
      {
        hostPath: "/Users/me/app",
        configFile: "/Users/me/app/.devcontainer/devcontainer.json",
        dockerHost: "/var/run/other.sock",
      },
      runner,
      {},
    );
    expect(calls[0]).toEqual([
      "docker",
      "-H",
      "unix:///var/run/other.sock",
      "ps",
      "--no-trunc",
      "--filter",
      "label=devcontainer.local_folder=/Users/me/app",
      "--filter",
      "label=devcontainer.config_file=/Users/me/app/.devcontainer/devcontainer.json",
      "--format",
      "{{.ID}}",
    ]);
  });

  test("no container, several, or a failing docker is an error", async () => {
    for (const result of [{ stdout: "" }, { stdout: "a\nb\n" }, { code: 1, stdout: "a\n" }]) {
      const { runner } = recording(result);
      await expect(findContainer("docker", { hostPath: "/a" }, runner, {})).rejects.toBeInstanceOf(
        ContainerError,
      );
    }
  });
});

describe("macSource", () => {
  test("drops Docker Desktop's /host_mnt prefix and leaves other sources alone", () => {
    expect(macSource("/host_mnt/Users/me/app")).toBe("/Users/me/app");
    expect(macSource("/socket_mnt/Users/me/engine.sock")).toBe("/socket_mnt/Users/me/engine.sock");
    expect(macSource("/host_mntx/Users/me")).toBe("/host_mntx/Users/me");
    expect(macSource("/Users/me/app")).toBe("/Users/me/app");
  });
});

describe("bindMounts", () => {
  test("reports Docker Desktop's bind sources as Mac paths", async () => {
    // The shape Docker Desktop for Mac reports for a Dev Containers workspace.
    const mounts = [
      {
        Type: "volume",
        Name: "vscode",
        Source: "/var/lib/docker/volumes/vscode/_data",
        Destination: "/vscode",
      },
      { Type: "bind", Source: "/host_mnt/Users/me/repo", Destination: "/workspaces/repo" },
      { Type: "bind", Source: "/host_mnt/Users/me/repo", Destination: "/Users/me/repo" },
      { Type: "bind", Source: "/host_mnt/Users/me/repo/.git", Destination: "/Users/me/repo/.git" },
      {
        Type: "bind",
        Source: "/socket_mnt/Users/me/engine.sock",
        Destination: "/root/engine.sock",
      },
    ];
    const { runner } = recording({ stdout: JSON.stringify(mounts) });
    expect(await bindMounts("docker", "abc", undefined, runner, {})).toEqual([
      { source: "/Users/me/repo", destination: "/workspaces/repo" },
      { source: "/Users/me/repo", destination: "/Users/me/repo" },
      { source: "/Users/me/repo/.git", destination: "/Users/me/repo/.git" },
      { source: "/socket_mnt/Users/me/engine.sock", destination: "/root/engine.sock" },
    ]);
  });

  test("keeps the bind mounts and drops volumes and other types", async () => {
    const mounts = [
      { Type: "bind", Source: "/Users/me/app", Destination: "/workspaces/app" },
      { Type: "volume", Name: "v", Source: "/var/lib/docker/volumes/v", Destination: "/cache" },
      { Type: "bind", Source: "/run/host-services/ssh-auth.sock", Destination: "/ssh.sock" },
      { Type: "tmpfs", Destination: "/tmp" },
    ];
    const { runner, calls } = recording({ stdout: JSON.stringify(mounts) + "\n" });
    expect(await bindMounts("docker", "abc", undefined, runner, {})).toEqual([
      { source: "/Users/me/app", destination: "/workspaces/app" },
      { source: "/run/host-services/ssh-auth.sock", destination: "/ssh.sock" },
    ]);
    expect(calls[0]).toEqual([
      "docker",
      "inspect",
      "--type",
      "container",
      "--format",
      "{{json .Mounts}}",
      "abc",
    ]);
  });

  test("a failing inspect or output that is not a mount list is an error", async () => {
    for (const result of [{ code: 1 }, { stdout: "nope" }, { stdout: "{}" }]) {
      const { runner } = recording(result);
      await expect(bindMounts("docker", "abc", undefined, runner, {})).rejects.toBeInstanceOf(
        ContainerError,
      );
    }
  });
});
