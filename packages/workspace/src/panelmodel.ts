import { PROTOCOL_VERSION, type StatusResult } from "@plume-works/expo-bridge-protocol";
import {
  AVAILABILITY_CHECKS,
  CHECKS,
  MAC_TOOL_CHECKS,
  SECTIONS,
  failingAvailability,
  type CheckCode,
  type CheckKey,
  type Section,
} from "./checks";
import type { EasJsonProblem } from "./easjson";
import type { FolderState } from "./statusstore";

export type Icon = "pass" | "error" | "warning" | "info";

export interface PanelNode {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: Icon;
  /** Matched by the panel's `view/item/context` menus. */
  contextValue?: string;
  children?: PanelNode[];
}

/** One Expo folder of the window, as the panel shows it. */
export interface FolderView {
  folder: string;
  name: string;
  state: FolderState | undefined;
  easProblems: EasJsonProblem[];
}

/**
 * What the panel shows as a whole. Every state but `ready` empties the tree, so the view's
 * welcome content for that state shows instead.
 */
export type PanelState =
  | "no-project"
  | "not-checked"
  | "host-missing"
  | "failed"
  | `unavailable-${(typeof AVAILABILITY_CHECKS)[number]}`
  | "ready";

export function panelState(folders: readonly FolderView[]): PanelState {
  if (!folders.length) return "no-project";
  const states = folders.map((f) => f.state);
  if (states.some((s) => s?.kind === "host-missing")) return "host-missing";
  const results = states.flatMap((s) => (s?.kind === "status" ? [s.result] : []));
  if (results.some((r) => r.available)) return "ready";
  const unavailable = results.map(failingAvailability).find((k) => k !== undefined);
  if (unavailable) return `unavailable-${unavailable}` as PanelState;
  if (states.some((s) => s?.kind === "failed")) return "failed";
  return "not-checked";
}

function checkNode(id: string, code: CheckCode, ok: boolean, detail?: string): PanelNode {
  const info = CHECKS[code];
  const fixable = !ok && MAC_TOOL_CHECKS.includes(code as CheckKey);
  return {
    id,
    label: info.label,
    description: detail ?? (ok ? "OK" : "failing"),
    tooltip: detail,
    icon: ok ? "pass" : info.severity,
    contextValue: fixable ? "expoBridge.check.fixable" : `expoBridge.check.${code}`,
  };
}

function connectionNodes(id: string, result: StatusResult): PanelNode[] {
  const unavailable = failingAvailability(result);
  const nodes: PanelNode[] = [
    unavailable
      ? checkNode(`${id}/available`, unavailable, false, result.checks[unavailable].detail)
      : { id: `${id}/available`, label: "Bridge", description: "available", icon: "pass" },
  ];
  if (result.folderHostPath) {
    nodes.push({
      id: `${id}/hostPath`,
      label: "Mac path",
      description: result.folderHostPath,
      tooltip: result.folderHostPath,
    });
  }
  const same = result.protocolVersion === PROTOCOL_VERSION;
  nodes.push({
    id: `${id}/protocol`,
    label: "Protocol",
    description: `host ${result.protocolVersion}, workspace ${PROTOCOL_VERSION}`,
    icon: same ? "pass" : "warning",
    tooltip: same ? undefined : "update the Expo Bridge extensions so both halves match",
  });
  return nodes;
}

function sectionNodes(id: string, view: FolderView, result: StatusResult): PanelNode[] {
  if (!result.available) {
    return [{ id: `${id}/connection`, label: "Connection", children: connectionNodes(id, result) }];
  }
  const bySection = new Map<Section, PanelNode[]>(SECTIONS.map((s) => [s.id, []]));
  bySection.get("connection")!.push(...connectionNodes(id, result));
  for (const [code, info] of Object.entries(CHECKS) as [CheckCode, (typeof CHECKS)[CheckCode]][]) {
    if (info.section === "connection" || !(code in result.checks)) continue;
    const check = result.checks[code as CheckKey];
    bySection.get(info.section)!.push(checkNode(`${id}/${code}`, code, check.ok, check.detail));
  }
  for (const problem of view.easProblems) {
    bySection
      .get("project")!
      .push(checkNode(`${id}/${problem.code}`, problem.code, false, problem.message));
  }
  return SECTIONS.map((s) => ({
    id: `${id}/${s.id}`,
    label: s.label,
    children: bySection.get(s.id)!,
  }));
}

function folderNodes(view: FolderView): PanelNode[] {
  const id = view.folder;
  const state = view.state;
  if (state?.kind === "status") return sectionNodes(id, view, state.result);
  const description =
    state?.kind === "failed" ? `status failed: ${state.message}` : "not checked yet";
  return [{ id: `${id}/state`, label: "Status", description, icon: state ? "error" : "info" }];
}

/** The panel's tree: the sections directly for one Expo folder, a level per folder for more. */
export function panelTree(folders: readonly FolderView[]): PanelNode[] {
  if (panelState(folders) !== "ready") return [];
  if (folders.length === 1) return folderNodes(folders[0]!);
  return folders.map((view) => ({
    id: view.folder,
    label: view.name,
    description: view.folder,
    contextValue: "expoBridge.folder",
    children: folderNodes(view),
  }));
}
