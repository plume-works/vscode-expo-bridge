import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EasCliError, easCliSpec, isVersionRange } from "../src/eascli";

let hostPath: string;

beforeEach(() => {
  hostPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "expo-bridge-eascli-")));
});

afterEach(() => {
  fs.rmSync(hostPath, { recursive: true, force: true });
});

const writePkg = (pkg: unknown) =>
  fs.writeFileSync(path.join(hostPath, "package.json"), JSON.stringify(pkg));
const spec = () => easCliSpec(hostPath, fs.existsSync);

describe("isVersionRange", () => {
  test.each([
    "16.3.0",
    "^16.3.0",
    "~16.3",
    "16.x",
    "*",
    ">=16.0.0 <17",
    ">= 16.0.0",
    "^15 || ^16",
    "16.0.0 - 16.3.0",
    "16.4.0-beta.1",
  ])("accepts %p", (s) => expect(isVersionRange(s)).toBe(true));

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
  ])("refuses %p", (s) => expect(isVersionRange(s)).toBe(false));
});

describe("easCliSpec", () => {
  test("latest when there is no package.json", () => {
    expect(spec()).toBe("latest");
  });

  test("latest when package.json does not list eas-cli", () => {
    writePkg({ dependencies: { expo: "~58.0.16" } });
    expect(spec()).toBe("latest");
  });

  test("devDependencies wins over dependencies", () => {
    writePkg({ dependencies: { "eas-cli": "16.0.0" }, devDependencies: { "eas-cli": "^16.3.0" } });
    expect(spec()).toBe("^16.3.0");
  });

  test("falls back to dependencies", () => {
    writePkg({ dependencies: { "eas-cli": "16.0.0" } });
    expect(spec()).toBe("16.0.0");
  });

  test("refuses a spec that is not a version range", () => {
    writePkg({ devDependencies: { "eas-cli": "file:../evil" } });
    expect(spec).toThrow(EasCliError);
  });

  test("refuses a symlinked package.json without quoting it", () => {
    const real = path.join(hostPath, "real.json");
    fs.writeFileSync(real, JSON.stringify({ devDependencies: { "eas-cli": "SECRET-1.0.0" } }));
    fs.symlinkSync(real, path.join(hostPath, "package.json"));
    expect(spec).toThrow(EasCliError);
    try {
      spec();
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRET");
    }
  });
});
