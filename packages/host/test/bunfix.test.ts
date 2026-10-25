import { describe, expect, test } from "bun:test";
import type { Runner } from "../src/exec";
import { findShadowedBun, resolveBunFix, ShadowNotes, shadowNoteText } from "../src/bunfix";

const HOME = "/Users/me";
const BREW_BUN = "/opt/homebrew/bin/bun";
const CELLAR_BUN = "/opt/homebrew/Cellar/bun/1.4.4/bin/bun";
const BUNSH_BUN = `${HOME}/.bun/bin/bun`;

/** A Mac whose files are `present`, with `links` resolved as symlinks. */
function mac(present: string[], links: Record<string, string> = {}) {
  const files = new Set(present);
  return {
    exists: (p: string) => files.has(p),
    realpath: (p: string) => links[p] ?? p,
  };
}

/** A runner whose `bun --version` answers from `versions`, keyed by binary path. */
function versions(byPath: Record<string, string>): Runner & { ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    async run(file) {
      ran.push(file);
      const v = byPath[file];
      return v ? { code: 0, stdout: `${v}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" };
    },
  };
}

function memento() {
  const data: Record<string, unknown> = {};
  return {
    get: <T>(key: string) => data[key] as T | undefined,
    update: async (key: string, value: unknown) => {
      data[key] = value;
    },
  };
}

describe("resolveBunFix", () => {
  test("no bun installs Homebrew's", () => {
    const m = mac([]);
    expect(resolveBunFix({ PATH: "/opt/homebrew/bin" }, m.exists, m.realpath, HOME)).toEqual({
      path: null,
      commands: ["brew install oven-sh/bun/bun"],
    });
  });

  test("a Homebrew bun upgrades its formula", () => {
    const m = mac([BREW_BUN], { [BREW_BUN]: CELLAR_BUN });
    expect(resolveBunFix({ PATH: "/opt/homebrew/bin" }, m.exists, m.realpath, HOME)).toEqual({
      path: BREW_BUN,
      commands: ["brew upgrade bun"],
    });
  });

  test("a bun.sh bun upgrades itself by absolute path", () => {
    const m = mac([BUNSH_BUN]);
    expect(resolveBunFix({ PATH: `${HOME}/.bun/bin` }, m.exists, m.realpath, HOME)).toEqual({
      path: BUNSH_BUN,
      commands: [`'${BUNSH_BUN}' upgrade`],
    });
  });

  test("BUN_INSTALL moves the bun.sh install", () => {
    const m = mac(["/opt/bun/bin/bun"]);
    const env = { PATH: "/opt/bun/bin", BUN_INSTALL: "/opt/bun" };
    expect(resolveBunFix(env, m.exists, m.realpath, HOME).commands).toEqual([
      "'/opt/bun/bin/bun' upgrade",
    ]);
  });

  test("with BUN_INSTALL set, ~/.bun/bin/bun is not the bun.sh install", () => {
    const m = mac([BUNSH_BUN]);
    const env = { PATH: `${HOME}/.bun/bin`, BUN_INSTALL: "/opt/bun" };
    expect(resolveBunFix(env, m.exists, m.realpath, HOME).commands).toEqual([]);
  });

  test("a bun of another origin gets no command and a detail naming it", () => {
    const shim = `${HOME}/.local/share/mise/shims/bun`;
    const m = mac([shim]);
    const fix = resolveBunFix(
      { PATH: `${HOME}/.local/share/mise/shims` },
      m.exists,
      m.realpath,
      HOME,
    );
    expect(fix.path).toBe(shim);
    expect(fix.commands).toEqual([]);
    expect(fix.detail).toContain(shim);
  });

  test("a bun.sh path with a quote gets no command", () => {
    const home = "/Users/o'brien";
    const bun = `${home}/.bun/bin/bun`;
    const m = mac([bun]);
    const fix = resolveBunFix({ PATH: `${home}/.bun/bin` }, m.exists, m.realpath, home);
    expect(fix.commands).toEqual([]);
    expect(fix.detail).toContain(bun);
  });

  test("a stale bun.sh bun ahead of Homebrew's is the one upgraded", () => {
    const m = mac([BUNSH_BUN, BREW_BUN], { [BREW_BUN]: CELLAR_BUN });
    const env = { PATH: `${HOME}/.bun/bin:/opt/homebrew/bin` };
    expect(resolveBunFix(env, m.exists, m.realpath, HOME).commands).toEqual([
      `'${HOME}/.bun/bin/bun' upgrade`,
    ]);
  });
});

describe("findShadowedBun", () => {
  const env = { PATH: `${HOME}/.bun/bin:/opt/homebrew/bin` };

  test("finds a newer Homebrew bun behind a stale bun.sh bun", async () => {
    const m = mac([BUNSH_BUN, BREW_BUN], { [BREW_BUN]: CELLAR_BUN });
    const runner = versions({ [BUNSH_BUN]: "1.4.3", [BREW_BUN]: "1.4.4" });
    expect(await findShadowedBun(env, m.exists, m.realpath, runner, "1.4.4")).toEqual({
      resolved: { path: BUNSH_BUN, version: "1.4.3" },
      shadowed: { path: BREW_BUN, version: "1.4.4" },
    });
  });

  test("skips a later entry that is the resolved binary", async () => {
    const m = mac([BREW_BUN, CELLAR_BUN], { [BREW_BUN]: CELLAR_BUN });
    const runner = versions({ [BREW_BUN]: "1.4.3", [CELLAR_BUN]: "1.4.3" });
    const pathEnv = { PATH: "/opt/homebrew/bin:/opt/homebrew/Cellar/bun/1.4.4/bin" };
    expect(await findShadowedBun(pathEnv, m.exists, m.realpath, runner, "1.4.0")).toBeNull();
    expect(runner.ran).toEqual([]);
  });

  test("a later bun older than the container's is not a shadowed bun", async () => {
    const m = mac([BUNSH_BUN, BREW_BUN], { [BREW_BUN]: CELLAR_BUN });
    const runner = versions({ [BUNSH_BUN]: "1.4.2", [BREW_BUN]: "1.4.3" });
    expect(await findShadowedBun(env, m.exists, m.realpath, runner, "1.4.4")).toBeNull();
  });

  test("no lookup without the container's version", async () => {
    const m = mac([BUNSH_BUN, BREW_BUN]);
    const runner = versions({ [BUNSH_BUN]: "1.4.3", [BREW_BUN]: "1.4.4" });
    expect(await findShadowedBun(env, m.exists, m.realpath, runner, undefined)).toBeNull();
    expect(runner.ran).toEqual([]);
  });

  test("the note names both paths and versions", () => {
    const text = shadowNoteText({
      resolved: { path: BUNSH_BUN, version: "1.4.3" },
      shadowed: { path: BREW_BUN, version: "1.4.4" },
    });
    expect(text).toContain(`${BUNSH_BUN} 1.4.3`);
    expect(text).toContain(`${BREW_BUN} 1.4.4`);
    expect(text).toContain(`upgrades ${BUNSH_BUN}`);
  });
});

describe("ShadowNotes", () => {
  const pair = {
    resolved: { path: BUNSH_BUN, version: "1.4.3" },
    shadowed: { path: BREW_BUN, version: "1.4.4" },
  };

  test("a pair is noted once, also by a new store over the same state", async () => {
    const state = memento();
    expect(await new ShadowNotes(state).take(pair)).toBe(true);
    expect(await new ShadowNotes(state).take(pair)).toBe(false);
  });

  test("a different pair is noted", async () => {
    const notes = new ShadowNotes(memento());
    await notes.take(pair);
    const other = { ...pair, shadowed: { path: "/usr/local/bin/bun", version: "1.4.4" } };
    expect(await notes.take(other)).toBe(true);
  });
});
