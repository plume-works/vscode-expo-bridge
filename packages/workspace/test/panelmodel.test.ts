import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@plume-works/expo-bridge-protocol";
import { failingChecks } from "../src/checks";
import { panelState, panelTree, type FolderView, type PanelNode } from "../src/panelmodel";
import { statusResult, unavailable } from "./fixtures/status";

function view(
  folder: string,
  state: FolderView["state"],
  easProblems: FolderView["easProblems"] = [],
): FolderView {
  return { folder, name: folder.slice(1), state, easProblems };
}

const labels = (nodes: PanelNode[]) => nodes.map((n) => n.label);

describe("panelState", () => {
  test("names each state the welcome content covers", () => {
    expect(panelState([])).toBe("no-project");
    expect(panelState([view("/a", undefined)])).toBe("not-checked");
    expect(panelState([view("/a", { kind: "failed", message: "x", at: 1 })])).toBe("failed");
    expect(panelState([view("/a", { kind: "host-missing", at: 1 })])).toBe("host-missing");
    expect(panelState([view("/a", { kind: "status", result: unavailable(), at: 1 })])).toBe(
      "unavailable-macHost",
    );
    expect(panelState([view("/a", { kind: "status", result: statusResult(), at: 1 })])).toBe(
      "ready",
    );
  });

  test("one available folder makes the panel ready; a missing host wins", () => {
    const ready = view("/a", { kind: "status", result: statusResult(), at: 1 });
    expect(panelState([ready, view("/b", { kind: "status", result: unavailable(), at: 1 })])).toBe(
      "ready",
    );
    expect(panelState([ready, view("/b", { kind: "host-missing", at: 1 })])).toBe("host-missing");
  });
});

describe("panelTree", () => {
  test("is empty unless ready, so the welcome content shows", () => {
    expect(panelTree([view("/a", undefined)])).toEqual([]);
  });

  test("shows the sections directly for one folder", () => {
    const tree = panelTree([view("/a", { kind: "status", result: statusResult(), at: 1 })]);
    expect(labels(tree)).toEqual([
      "Connection",
      "Mac tools",
      "Project",
      "Trust & token",
      "Simulator",
    ]);
    expect(labels(tree[1]!.children!)).toEqual(["Xcode", "CocoaPods", "fastlane", "Node", "bun"]);
    expect(labels(tree[2]!.children!)).toEqual(["eas-cli", "EAS project ID"]);
    expect(labels(tree[3]!.children!)).toEqual(["Workspace trusted", "EXPO_TOKEN"]);
    expect(labels(tree[4]!.children!)).toEqual(["Simulator", "Port 8081 (Metro)"]);
    expect(tree[0]!.children!.map((n) => [n.label, n.description])).toEqual([
      ["Bridge", "available"],
      ["Mac path", "/Users/me/app"],
      ["Protocol", `host ${PROTOCOL_VERSION}, workspace ${PROTOCOL_VERSION}`],
    ]);
  });

  test("shows each check's detail, and marks a failing Mac tool fixable", () => {
    const result = statusResult({ cocoapods: { ok: false, detail: "CocoaPods not found" } });
    const tree = panelTree([view("/a", { kind: "status", result, at: 1 })]);
    const pods = tree[1]!.children![1]!;
    expect(pods).toMatchObject({
      label: "CocoaPods",
      description: "CocoaPods not found",
      icon: "error",
      contextValue: "expoBridge.check.fixable",
    });
    expect(tree[2]!.children![0]).toMatchObject({
      description: "eas-cli@latest (no cli.version in eas.json)",
      icon: "pass",
    });
  });

  test("adds the container's eas.json problems to Project", () => {
    const tree = panelTree([
      view("/a", { kind: "status", result: statusResult(), at: 1 }, [
        {
          code: "simulatorProfile",
          message: "no simulator profile",
          range: { offset: 0, length: 1 },
        },
      ]),
    ]);
    expect(tree[2]!.children![2]).toMatchObject({
      label: "Simulator build profile",
      description: "no simulator profile",
      icon: "error",
    });
  });

  test("an unavailable folder beside an available one shows only its connection", () => {
    const tree = panelTree([
      view("/a", { kind: "status", result: statusResult(), at: 1 }),
      view("/b", { kind: "status", result: unavailable(), at: 1 }),
      view("/c", undefined),
    ]);
    expect(labels(tree)).toEqual(["a", "b", "c"]);
    expect(labels(tree[1]!.children!)).toEqual(["Connection"]);
    expect(tree[1]!.children![0]!.children![0]).toMatchObject({
      label: "Mac host",
      description: "host is not macOS",
    });
    expect(tree[2]!.children).toEqual([
      { id: "/c/state", label: "Status", description: "not checked yet", icon: "info" },
    ]);
  });

  test("flags a host on another protocol version", () => {
    const result = { ...statusResult(), protocolVersion: PROTOCOL_VERSION + 1 };
    const tree = panelTree([view("/a", { kind: "status", result, at: 1 })]);
    expect(tree[0]!.children![2]!.icon).toBe("warning");
  });
});

describe("failingChecks", () => {
  test("lists the failing checks of an available status", () => {
    expect(failingChecks(statusResult({ bun: { ok: false }, expoToken: { ok: false } }))).toEqual([
      "bun",
      "expoToken",
    ]);
  });

  test("lists only the availability check of an unavailable status", () => {
    expect(failingChecks(unavailable())).toEqual(["macHost"]);
  });
});
