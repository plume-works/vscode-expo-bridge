import { describe, expect, test } from "bun:test";
import { decodeHostPath } from "../src/hostpath";

const authority = (payload: unknown) =>
  `dev-container+${Buffer.from(JSON.stringify(payload), "utf8").toString("hex")}`;

describe("decodeHostPath", () => {
  test("decodes a dev-container+<hex JSON> authority", () => {
    expect(decodeHostPath(authority({ hostPath: "/Users/me/app" }))).toEqual({
      authority: authority({ hostPath: "/Users/me/app" }),
      hostPath: "/Users/me/app",
    });
  });

  test("falls back to the decoded string when it is not JSON", () => {
    const hex = Buffer.from("/Users/me/plain", "utf8").toString("hex");
    expect(decodeHostPath(`attached-container+${hex}`)?.hostPath).toBe("/Users/me/plain");
  });

  test("returns the config file of a serialized URI object as a Mac path", () => {
    const r = decodeHostPath(
      authority({
        hostPath: "/Users/me/app",
        localDocker: false,
        configFile: {
          $mid: 1,
          fsPath: "/Users/me/app/.devcontainer/devcontainer.json",
          external: "file:///Users/me/app/.devcontainer/devcontainer.json",
          path: "/Users/me/app/.devcontainer/devcontainer.json",
          scheme: "file",
        },
      }),
    );
    expect(r?.configFile).toBe("/Users/me/app/.devcontainer/devcontainer.json");
  });

  test("returns the config file of a file URI string, decoded", () => {
    const r = decodeHostPath(
      authority({ hostPath: "/Users/me/my app", configFile: "file:///Users/me/my%20app/dc.json" }),
    );
    expect(r?.configFile).toBe("/Users/me/my app/dc.json");
  });

  test("a config file that is not a file URI is not returned", () => {
    const remote = { scheme: "vscode-remote", path: "/x/devcontainer.json" };
    expect(decodeHostPath(authority({ hostPath: "/a", configFile: remote }))?.configFile).toBe(
      undefined,
    );
  });

  test("returns the Docker host from settings.host", () => {
    const r = decodeHostPath(
      authority({ hostPath: "/a", settings: { host: "unix:///Users/me/.colima/docker.sock" } }),
    );
    expect(r?.dockerHost).toBe("unix:///Users/me/.colima/docker.sock");
    expect(decodeHostPath(authority({ hostPath: "/a", settings: {} }))?.dockerHost).toBe(undefined);
  });

  test("returns null without a '+'", () => {
    expect(decodeHostPath("localhost")).toBeNull();
  });

  test("returns null for empty decoded content or no host path", () => {
    expect(decodeHostPath("dev-container+")).toBeNull();
    expect(decodeHostPath(authority({ configFile: "file:///a" }))).toBeNull();
  });
});
