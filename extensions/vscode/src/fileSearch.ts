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
    let relativePaths: string[] = [];

    quickPick.onDidChangeValue((value) => {
      if (!value.trim()) {
        quickPick.items = [];
        relativePaths = [];
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

          const paths: string[] = [];
          quickPick.items = results.items.map((item, i) => {
            const dir = item.relativePath.includes("/")
              ? item.relativePath.substring(0, item.relativePath.lastIndexOf("/"))
              : "";
            paths.push(item.relativePath);

            return {
              label: item.fileName,
              description: dir || undefined,
              detail: item.gitStatus
                ? `[${item.gitStatus.trim()}] ${item.relativePath}`
                : item.relativePath,
              alwaysShow: true,
            };
          });
          relativePaths = paths;
        } catch {
          // Silently ignore search errors during typing
        }
      }, 50);
    });

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;

      const idx = quickPick.items.indexOf(selected);
      if (idx < 0 || idx >= relativePaths.length) return;

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const fileUri = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), relativePaths[idx]);

      const inst = getInstance();
      if (inst) {
        try { trackQuery(inst, quickPick.value, relativePaths[idx]); } catch { /* non-critical */ }
      }

      quickPick.hide();

      try {
        await vscode.window.showTextDocument(fileUri);
      } catch {
        vscode.window.showErrorMessage(`Could not open: ${relativePaths[idx]}`);
      }
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
    });

    quickPick.show();
  });
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
    let relativePaths: string[] = [];

    quickPick.onDidChangeValue((value) => {
      if (!value.trim()) {
        quickPick.items = [];
        relativePaths = [];
        return;
      }

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          const inst = getInstance();
          if (!inst) return;

          const results = search(inst, value, { pageSize: 30 });
          const paths: string[] = [];

          quickPick.items = results.items.map((item) => {
            paths.push(item.relativePath);
            return {
              label: item.fileName,
              description: item.relativePath,
            };
          });
          relativePaths = paths;
        } catch {
          // Silently ignore search errors during typing
        }
      }, 50);
    });

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;

      const idx = quickPick.items.indexOf(selected);
      if (idx < 0 || idx >= relativePaths.length) return;

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const fileUri = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), relativePaths[idx]);

      const inst = getInstance();
      if (inst) {
        try { trackQuery(inst, quickPick.value, relativePaths[idx]); } catch { /* non-critical */ }
      }

      quickPick.hide();

      try {
        await vscode.window.showTextDocument(fileUri);
      } catch {
        vscode.window.showErrorMessage(`Could not open: ${relativePaths[idx]}`);
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  });
}
