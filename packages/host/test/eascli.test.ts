import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EasCliError, easCliSpec, normalizeRange } from "../src/eascli";

let hostPath: string;

beforeEach(() => {
  hostPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-eascli-")));
});

afterEach(() => {
  fs.rmSync(hostPath, { recursive: true, force: true });
});

const writeEasJson = (easJson: unknown) =>
  fs.writeFileSync(path.join(hostPath, "eas.json"), JSON.stringify(easJson));
const spec = () => easCliSpec(hostPath, fs.existsSync);

describe("normalizeRange", () => {
  test.each([
    ["16.3.0", "16.3.0"],
    ["^16.3.0", "^16.3.0"],
    ["~16.3", "~16.3"],
    ["16.x", "16.x"],
    ["*", "*"],
    [">= 16.0.0", ">=16.0.0"],
    [">=16.0.0 <17", ">=16.0.0 <17"],
    ["^15 ||  ^16", "^15 || ^16"],
    ["16.0.0 - 16.3.0", "16.0.0 - 16.3.0"],
    ["16.4.0-beta.1", "16.4.0-beta.1"],
  ])("accepts %p as %p", (input, out) => expect(normalizeRange(input)).toBe(out));

  test.each([
    "",
    "latest",
    "next",
    "file:../eas",
    "npm:other@1.0.0",
    "github:expo/eas-cli",
    "git+https://github.com/expo/eas-cli.git",
    "https://example.com/eas.tgz",
    "../eas",
    "16.0.0 || ",
  ])("refuses %p", (input) => expect(normalizeRange(input)).toBeNull());
});

describe("easCliSpec", () => {
  test("latest when there is no eas.json", () => {
    expect(spec()).toBe("latest");
  });

  test("latest when eas.json has no cli.version", () => {
    writeEasJson({ build: { development: {} } });
    expect(spec()).toBe("latest");
  });

  test("cli.version, normalized", () => {
    writeEasJson({ cli: { version: ">= 16.0.0" } });
    expect(spec()).toBe(">=16.0.0");
  });

  test("ignores an eas-cli entry in package.json", () => {
    fs.writeFileSync(
      path.join(hostPath, "package.json"),
      JSON.stringify({ devDependencies: { "eas-cli": "16.0.0" } }),
    );
    expect(spec()).toBe("latest");
  });

  test("refuses a cli.version that is not a version range", () => {
    writeEasJson({ cli: { version: "file:../evil" } });
    expect(spec).toThrow(EasCliError);
  });

  test("refuses a non-string cli.version", () => {
    writeEasJson({ cli: { version: 16 } });
    expect(spec).toThrow(EasCliError);
  });

  test("refuses a symlinked eas.json without quoting it", () => {
    const real = path.join(hostPath, "real.json");
    fs.writeFileSync(real, JSON.stringify({ cli: { version: "SECRET-1.0.0" } }));
    fs.symlinkSync(real, path.join(hostPath, "eas.json"));
    expect(spec).toThrow(EasCliError);
    try {
      spec();
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRET");
    }
  });
});
