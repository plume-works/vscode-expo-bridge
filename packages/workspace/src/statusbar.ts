import type { FolderView } from "./panelmodel";
import { folderIssues, needsAttention } from "./issues";

export interface StatusBarState {
  text: string;
  tooltip: string;
}

/** The always-on status bar item's text for the window's Expo folders; null hides it. */
export function statusBarState(folders: readonly FolderView[]): StatusBarState | null {
  if (!folders.length) return null;
  const states = folders.map((f) => f.state);
  if (states.some((s) => s?.kind === "host-missing")) {
    return {
      text: "$(cloud-download) Expo Bridge: Mac half not installed",
      tooltip: "Install the Expo Bridge host extension locally, then reload the window",
    };
  }
  const issues = folders.flatMap((f) =>
    folderIssues(f)
      .filter(needsAttention)
      .map((i) => (folders.length > 1 ? `${f.name}: ${i.message}` : i.message)),
  );
  if (issues.length) {
    const n = issues.length;
    return {
      text: `$(warning) Expo Bridge: ${n} issue${n === 1 ? "" : "s"}`,
      tooltip: issues.join("\n"),
    };
  }
  if (states.every((s) => s?.kind === "status" && s.result.available)) {
    return {
      text: "$(check) Expo Bridge: OK",
      tooltip: "The bridge can build on this window's Mac",
    };
  }
  if (states.some((s) => s?.kind === "status" && !s.result.available)) {
    return {
      text: "$(circle-slash) Expo Bridge: unavailable",
      tooltip: "The bridge cannot build on this window's machine; EAS cloud builds still work",
    };
  }
  return {
    text: "$(question) Expo Bridge: not checked",
    tooltip: "Open the Expo Bridge panel to check",
  };
}
