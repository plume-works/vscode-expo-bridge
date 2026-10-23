import type { Runner } from "./exec";

/** Any reason the window's container or its mounts cannot be read; the request is unavailable. */
export class ContainerError extends Error {}

/** What identifies the window's container: Dev Containers' labels and its Docker daemon. */
export interface ContainerTarget {
  hostPath: string;
  configFile?: string;
  dockerHost?: string;
}

export interface BindMount {
  /** The Mac path mounted, with Docker Desktop's VM prefix removed. */
  source: string;
  /** Where it appears in the container. */
  destination: string;
}

/** Docker Desktop reports a bind source from the Mac as its path inside its VM. */
const DOCKER_DESKTOP_HOST_MNT = "/host_mnt";

/** The Mac path of a bind source; any other source is returned unchanged. */
export function macSource(source: string): string {
  return source.startsWith(DOCKER_DESKTOP_HOST_MNT + "/")
    ? source.slice(DOCKER_DESKTOP_HOST_MNT.length)
    : source;
}

/** `-H` for a non-default daemon; a bare socket path becomes a `unix://` URL. */
export function dockerHostArgs(dockerHost: string | undefined): string[] {
  if (!dockerHost) return [];
  return ["-H", dockerHost.startsWith("/") ? `unix://${dockerHost}` : dockerHost];
}

/**
 * The id of the one running container Dev Containers labeled with the window's host path,
 * and with its config file when the authority names one. None or several is an error.
 */
export async function findContainer(
  docker: string,
  target: ContainerTarget,
  runner: Runner,
  env: Record<string, string>,
): Promise<string> {
  const filters = ["--filter", `label=devcontainer.local_folder=${target.hostPath}`];
  if (target.configFile) {
    filters.push("--filter", `label=devcontainer.config_file=${target.configFile}`);
  }
  const r = await runner.run(
    docker,
    [...dockerHostArgs(target.dockerHost), "ps", "--no-trunc", ...filters, "--format", "{{.ID}}"],
    { env },
  );
  if (r.code !== 0) throw new ContainerError("docker ps failed");
  const ids = r.stdout.split("\n").filter((l) => l.trim() !== "");
  if (ids.length === 0) throw new ContainerError("no running container for this window");
  if (ids.length > 1) throw new ContainerError("several running containers match this window");
  return ids[0]!.trim();
}

/**
 * The container's bind mounts, read with `docker inspect`, with Mac sources; other mount
 * types are dropped.
 */
export async function bindMounts(
  docker: string,
  id: string,
  dockerHost: string | undefined,
  runner: Runner,
  env: Record<string, string>,
): Promise<BindMount[]> {
  const r = await runner.run(
    docker,
    [
      ...dockerHostArgs(dockerHost),
      "inspect",
      "--type",
      "container",
      "--format",
      "{{json .Mounts}}",
      id,
    ],
    { env },
  );
  if (r.code !== 0) throw new ContainerError("docker inspect failed");
  let mounts: unknown;
  try {
    mounts = JSON.parse(r.stdout);
  } catch {
    throw new ContainerError("docker inspect returned no JSON");
  }
  if (!Array.isArray(mounts)) throw new ContainerError("docker inspect returned no mounts");
  return mounts.flatMap((m: { Type?: unknown; Source?: unknown; Destination?: unknown }) =>
    m?.Type === "bind" && typeof m.Source === "string" && typeof m.Destination === "string"
      ? [{ source: macSource(m.Source), destination: m.Destination }]
      : [],
  );
}
