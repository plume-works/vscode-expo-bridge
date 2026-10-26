import { describe, expect, test } from "bun:test";
import { folderIssues } from "../src/issues";
import type { FolderView } from "../src/panelmodel";
import { statusBarState } from "../src/statusbar";
import { statusResult, unavailable } from "./fixtures/status";

function view(
  folder: string,
  state: FolderView["state"],
  easProblems: FolderView["easProblems"] = [],
): FolderView {
  return { folder, name: folder.slice(1), state, easProblems };
}

const ready = (overrides = {}) =>
  ({ kind: "status", result: statusResult(overrides), at: 1 }) as const;
const text = (folders: FolderView[]) => statusBarState(folders)?.text;

describe("statusBarState", () => {
  test("hides without an Expo folder", () => {
    expect(statusBarState([])).toBeNull();
  });

  test("reads OK when every folder is available with nothing to fix", () => {
    expect(text([view("/a", ready())])).toBe("$(check) Expo Bridge: OK");
  });

  test("counts errors and warnings, not information", () => {
    const state = ready({
      cocoapods: { ok: false, detail: "CocoaPods not found" },
      expoToken: { ok: false, detail: "EXPO_TOKEN not set" },
      port8081Forwarded: { ok: false, detail: "port 8081 is not forwarded" },
    });
    const s = statusBarState([view("/a", state)]);
    expect(s?.text).toBe("$(warning) Expo Bridge: 2 issues");
    expect(s?.tooltip).toBe("CocoaPods not found\nEXPO_TOKEN not set");
  });

  test("counts the container's eas.json problems and names folders when there are several", () => {
    const problem = {
      code: "simulatorProfile" as const,
      message: "no simulator profile",
      range: { offset: 0, length: 1 },
    };
    const s = statusBarState([view("/a", ready(), [problem]), view("/b", ready())]);
    expect(s).toEqual({
      text: "$(warning) Expo Bridge: 1 issue",
      tooltip: "a: no simulator profile",
    });
  });

  test("names the other states", () => {
    expect(text([view("/a", { kind: "host-missing", at: 1 })])).toBe(
      "$(cloud-download) Expo Bridge: Mac half not installed",
    );
    expect(text([view("/a", { kind: "status", result: unavailable(), at: 1 })])).toBe(
      "$(circle-slash) Expo Bridge: unavailable",
    );
    expect(text([view("/a", undefined)])).toBe("$(question) Expo Bridge: not checked");
    expect(text([view("/a", { kind: "failed", message: "x", at: 1 })])).toBe(
      "$(question) Expo Bridge: not checked",
    );
  });
});

describe("folderIssues", () => {
  test("an unavailable folder has only its availability issue, even with eas.json problems", () => {
    const problem = {
      code: "simulatorProfile" as const,
      message: "m",
      range: { offset: 0, length: 1 },
    };
    expect(
      folderIssues(view("/a", { kind: "status", result: unavailable(), at: 1 }, [problem])),
    ).toEqual([{ code: "macHost", severity: "info", message: "host is not macOS" }]);
  });

  test("a folder without a status has none", () => {
    expect(folderIssues(view("/a", undefined))).toEqual([]);
  });
});
