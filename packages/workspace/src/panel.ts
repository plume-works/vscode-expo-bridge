import * as vscode from "vscode";
import { panelState, panelTree, type FolderView, type Icon, type PanelNode } from "./panelmodel";

export const PANEL_VIEW = "expoBridge.panel";

/** The context key the view's welcome content is chosen by. */
export const PANEL_STATE_KEY = "expoBridge.panelState";

const ICONS: Record<Icon, vscode.ThemeIcon> = {
  pass: new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed")),
  error: new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground")),
  warning: new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground")),
  info: new vscode.ThemeIcon("info", new vscode.ThemeColor("problemsInfoIcon.foreground")),
};

/** The Expo Bridge panel's tree, rebuilt from the window's folder views on every refresh. */
export class Panel implements vscode.TreeDataProvider<PanelNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly views: () => FolderView[]) {}

  refresh(): void {
    void vscode.commands.executeCommand("setContext", PANEL_STATE_KEY, panelState(this.views()));
    this.changed.fire();
  }

  getTreeItem(node: PanelNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.label,
      node.children
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.contextValue = node.contextValue;
    if (node.icon) item.iconPath = ICONS[node.icon];
    return item;
  }

  getChildren(node?: PanelNode): PanelNode[] {
    return node ? (node.children ?? []) : panelTree(this.views());
  }

  dispose(): void {
    this.changed.dispose();
  }
}
