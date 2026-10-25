import { describe, expect, test } from "bun:test";
import { resolveBunFix } from "../src/bunfix";

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
