import { describe, expect, test } from "bun:test";
import { bindMounts, ContainerError, dockerHostArgs, findContainer } from "../src/container";
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

describe("bindMounts", () => {
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
