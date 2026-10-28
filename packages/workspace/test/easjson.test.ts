import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildProfiles, easJsonChecks, readEasJson } from "../src/easjson";

let folder: string;

beforeEach(() => {
  folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-easjson-")));
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

function eas(text: string) {
  fs.writeFileSync(path.join(folder, "eas.json"), text);
  return readEasJson(folder);
}

const codes = (text: string, remembered?: string) =>
  easJsonChecks(eas(text), remembered).map((p) => p.code);

describe("readEasJson", () => {
  test("is null without eas.json, so no checks run", () => {
    expect(readEasJson(folder)).toBeNull();
    expect(easJsonChecks(null, "development")).toEqual([]);
    expect(buildProfiles(null)).toEqual([]);
  });
});

describe("easJsonChecks", () => {
  test("passes with a simulator profile", () => {
    expect(codes(JSON.stringify({ build: { development: { ios: { simulator: true } } } }))).toEqual(
      [],
    );
  });

  test("follows extends to a simulator profile", () => {
    const text = JSON.stringify({
      build: { base: { ios: { simulator: true } }, dev: { extends: "base" } },
    });
    expect(codes(text)).toEqual([]);
  });

  test("an override of simulator in the extending profile wins", () => {
    const text = JSON.stringify({
      build: {
        base: { ios: { simulator: true } },
        dev: { extends: "base", ios: { simulator: false } },
      },
    });
    expect(codes(text)).toEqual([]);
    const only = JSON.stringify({ build: { dev: { extends: "dev", ios: {} } } });
    expect(codes(only)).toEqual(["simulatorProfile"]);
  });

  test("reports no simulator profile at the build key", () => {
    const text = '{\n  "build": { "production": {} }\n}\n';
    const [problem] = easJsonChecks(eas(text), undefined);
    expect(problem?.code).toBe("simulatorProfile");
    expect(text.slice(problem!.range.offset, problem!.range.offset + problem!.range.length)).toBe(
      '"build"',
    );
  });

  test("reports no simulator profile at the start of a file without build", () => {
    const [problem] = easJsonChecks(eas("{}"), undefined);
    expect(problem).toMatchObject({ code: "simulatorProfile", range: { offset: 0, length: 1 } });
  });

  test("reports a remembered profile that is gone", () => {
    const text = JSON.stringify({ build: { development: { ios: { simulator: true } } } });
    expect(codes(text, "preview")).toEqual(["rememberedProfile"]);
    expect(codes(text, "development")).toEqual([]);
  });

  test("tolerates comments and trailing commas", () => {
    expect(codes('{ // eas\n "build": { "d": { "ios": { "simulator": true } }, } }')).toEqual([]);
  });
});

describe("buildProfiles", () => {
  test("lists the build profiles in file order", () => {
    expect(buildProfiles(eas(JSON.stringify({ build: { b: {}, a: {} } })))).toEqual(["b", "a"]);
    expect(buildProfiles(eas(JSON.stringify({ build: [] })))).toEqual([]);
  });
});
