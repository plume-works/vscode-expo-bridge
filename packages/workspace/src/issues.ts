import { CHECKS, failingChecks, type CheckCode, type Severity } from "./checks";
import type { FolderView } from "./panelmodel";

/** One failing check of a folder: what Problems lists and the status bar counts. */
export interface Issue {
  code: CheckCode;
  severity: Severity;
  message: string;
}

/**
 * A folder's failing checks: its last status's and, while that status is available, the
 * container's `eas.json` checks. An unavailable status yields only its availability check.
 */
export function folderIssues(view: FolderView): Issue[] {
  if (view.state?.kind !== "status") return [];
  const { result } = view.state;
  const issues: Issue[] = failingChecks(result).map((code) => ({
    code,
    severity: CHECKS[code].severity,
    message: result.checks[code].detail ?? `${CHECKS[code].label} failed`,
  }));
  if (!result.available) return issues;
  for (const p of view.easProblems) {
    issues.push({ code: p.code, severity: CHECKS[p.code].severity, message: p.message });
  }
  return issues;
}

/** Issues that need the user: errors and warnings. */
export function needsAttention(issue: Issue): boolean {
  return issue.severity !== "info";
}
