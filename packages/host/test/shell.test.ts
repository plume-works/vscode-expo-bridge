import { describe, expect, test } from "bun:test";
import { fixTerminalShell } from "../src/shell";

const LOGIN = "/bin/zsh";
const env = { PATH: "/opt/homebrew/bin:/usr/bin:/bin" };
const existing =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);
const fallback = { shellPath: LOGIN, shellArgs: ["-l"] };

describe("fixTerminalShell", () => {
  test("finds a bare profile path on the login PATH, with its args", () => {
    const profiles = { fish: { path: "fish", args: ["-l"] } };
    expect(
      fixTerminalShell("fish", profiles, env, existing("/opt/homebrew/bin/fish"), LOGIN),
    ).toEqual({ shellPath: "/opt/homebrew/bin/fish", shellArgs: ["-l"] });
  });

  test("uses an absolute profile path that exists", () => {
    const profiles = { bash: { path: "/bin/bash" } };
    expect(fixTerminalShell("bash", profiles, env, existing("/bin/bash"), LOGIN)).toEqual({
      shellPath: "/bin/bash",
    });
  });

  test("takes the first candidate of an array that exists", () => {
    const profiles = { fish: { path: ["/usr/bin/fish", "fish"] } };
    expect(
      fixTerminalShell("fish", profiles, env, existing("/opt/homebrew/bin/fish"), LOGIN),
    ).toEqual({ shellPath: "/opt/homebrew/bin/fish" });
  });

  test("passes the profile's env through", () => {
    const profiles = { zsh: { path: "/bin/zsh", env: { FOO: "1", BAR: null } } };
    expect(fixTerminalShell("zsh", profiles, env, existing("/bin/zsh"), LOGIN)).toEqual({
      shellPath: "/bin/zsh",
      env: { FOO: "1", BAR: null },
    });
  });

  describe("falls back to the login shell with -l", () => {
    const exists = existing("/opt/homebrew/bin/fish", "/usr/bin/fish");

    test("for an unset default profile", () => {
      expect(fixTerminalShell(undefined, { fish: { path: "fish" } }, env, exists, LOGIN)).toEqual(
        fallback,
      );
      expect(fixTerminalShell("", { fish: { path: "fish" } }, env, exists, LOGIN)).toEqual(
        fallback,
      );
    });

    test("for a name with no profile", () => {
      expect(fixTerminalShell("nu", { fish: { path: "fish" } }, env, exists, LOGIN)).toEqual(
        fallback,
      );
    });

    test("for a null profile", () => {
      expect(fixTerminalShell("fish", { fish: null }, env, exists, LOGIN)).toEqual(fallback);
    });

    test("for a profile with source", () => {
      const profiles = { tmux: { source: "tmux", path: "fish" } };
      expect(fixTerminalShell("tmux", profiles, env, exists, LOGIN)).toEqual(fallback);
    });

    test("for a candidate containing ${", () => {
      const profiles = { fish: { path: "${env:HOME}/bin/fish" } };
      expect(fixTerminalShell("fish", profiles, env, () => true, LOGIN)).toEqual(fallback);
    });

    test("for a relative candidate with a slash", () => {
      const profiles = { fish: { path: "bin/fish" } };
      expect(fixTerminalShell("fish", profiles, env, () => true, LOGIN)).toEqual(fallback);
    });

    test("when no candidate exists on the Mac", () => {
      const profiles = { fish: { path: ["/usr/local/bin/fish", "fish"] } };
      expect(fixTerminalShell("fish", profiles, env, existing(), LOGIN)).toEqual(fallback);
    });
  });
});
