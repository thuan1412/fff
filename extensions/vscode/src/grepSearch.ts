import * as vscode from "vscode";

/**
 * The grep command focuses the FFF search panel in the sidebar.
 * All search interaction is driven by the webview (searchPanel.ts).
 */
export function registerGrepSearch(
  _context: vscode.ExtensionContext,
  _getInstance: () => any,
): vscode.Disposable {
  return vscode.commands.registerCommand("fff.grep", async () => {
    await vscode.commands.executeCommand("fff.searchPanel.focus");
  });
}
