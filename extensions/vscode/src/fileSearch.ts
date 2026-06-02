import * as vscode from "vscode";
import { FffInstanceHandle, search, trackQuery } from "./ffi";

export function registerFileSearch(
  context: vscode.ExtensionContext,
  getInstance: () => FffInstanceHandle | null,
): vscode.Disposable {
  return vscode.commands.registerCommand("fff.findFiles", async () => {
    const inst = getInstance();
    if (!inst) {
      vscode.window.showWarningMessage("FFF is still scanning files. Please wait...");
      return;
    }

    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = "Search files by name...";
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = [];

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    quickPick.onDidChangeValue((value) => {
      if (!value.trim()) {
        quickPick.items = [];
        return;
      }

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          const inst = getInstance();
          if (!inst) return;

          const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath ?? null;
          const results = search(inst, value, {
            currentFile: activeFile,
            pageSize: 30,
          });

          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

          quickPick.items = results.items.map((item, i) => {
            const score = results.scores[i];
            const dir = item.relativePath.includes("/")
              ? item.relativePath.substring(0, item.relativePath.lastIndexOf("/"))
              : "";

            return {
              label: item.fileName,
              description: dir || undefined,
              detail: item.gitStatus
                ? `[${item.gitStatus.trim()}] ${item.relativePath}`
                : item.relativePath,
              alwaysShow: true,
              // Store the relative path for use on accept
              _relativePath: item.relativePath,
            } as FileQuickPickItem;
          });
        } catch {
          // Silently ignore search errors during typing
        }
      }, 50);
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0] as FileQuickPickItem | undefined;
      if (!selected) return;

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const fileUri = vscode.Uri.file(workspaceRoot + "/" + selected._relativePath);

      // Track for frecency
      const inst = getInstance();
      if (inst) {
        trackQuery(inst, quickPick.value, selected._relativePath);
      }

      vscode.commands.executeCommand("vscode.open", fileUri);
      quickPick.hide();
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
    });

    quickPick.show();
  });
}

interface FileQuickPickItem extends vscode.QuickPickItem {
  _relativePath: string;
}

export function registerFileAndDirSearch(
  context: vscode.ExtensionContext,
  getInstance: () => FffInstanceHandle | null,
): vscode.Disposable {
  return vscode.commands.registerCommand("fff.findFilesAndDirs", async () => {
    const inst = getInstance();
    if (!inst) {
      vscode.window.showWarningMessage("FFF is still scanning files. Please wait...");
      return;
    }

    const quickPick = vscode.window.createQuickPick();
    quickPick.placeholder = "Search files and directories...";
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    quickPick.onDidChangeValue((value) => {
      if (!value.trim()) {
        quickPick.items = [];
        return;
      }

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          const inst = getInstance();
          if (!inst) return;

          // Fall back to regular file search since we don't have a mixed wrapper yet;
          // fff_search_mixed is available in the C API but skip for now.
          const results = search(inst, value, { pageSize: 30 });
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

          quickPick.items = results.items.map((item) => ({
            label: item.fileName,
            description: item.relativePath,
            _relativePath: item.relativePath,
          })) as FileQuickPickItem[];
        } catch {
          // Silently ignore search errors during typing
        }
      }, 50);
    });

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0] as FileQuickPickItem | undefined;
      if (!selected) return;

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const uri = vscode.Uri.file(workspaceRoot + "/" + selected._relativePath);

      const inst = getInstance();
      if (inst) {
        trackQuery(inst, quickPick.value, selected._relativePath);
      }

      vscode.commands.executeCommand("vscode.open", uri);
      quickPick.hide();
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  });
}
