import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
  FffInstanceHandle,
  createInstance,
  destroyInstance,
  waitForScan,
  getScanProgress,
} from "./ffi";
import { registerFileSearch, registerFileAndDirSearch } from "./fileSearch";
import { registerGrepSearch } from "./grepSearch";
import { SearchPanelProvider } from "./searchPanel";

let instance: FffInstanceHandle | null = null;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.text = "$(sync~spin) FFF: scanning...";
  statusBarItem.tooltip = "FFF is indexing files";
  statusBarItem.show();

  // Initialize FFF for each workspace folder
  initFffInstance(context).catch((err) => {
    vscode.window.showErrorMessage(`FFF initialization failed: ${err}`);
    statusBarItem.text = "$(error) FFF";
  });

  // Search panel webview in sidebar
  const getInstance = () => instance;
  const searchPanelProvider = new SearchPanelProvider(context.extensionUri, getInstance);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("fff.searchPanel", searchPanelProvider),
  );

  // Register commands
  context.subscriptions.push(registerFileSearch(context, getInstance));
  context.subscriptions.push(registerFileAndDirSearch(context, getInstance));
  context.subscriptions.push(registerGrepSearch(context, getInstance));
  context.subscriptions.push(statusBarItem);

  // Toggle keybinding context when ready
  vscode.commands.executeCommand("setContext", "fff:enabled", true);
}

async function initFffInstance(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    statusBarItem.text = "$(warning) FFF: no workspace";
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Database paths in VS Code global storage
  const storagePath = context.globalStorageUri.fsPath;
  fs.mkdirSync(storagePath, { recursive: true });

  const frecencyDbPath = path.join(storagePath, "frecency.lmdb");
  const historyDbPath = path.join(storagePath, "history.lmdb");

  statusBarItem.text = "$(sync~spin) FFF: scanning...";

  instance = createInstance(workspaceRoot, frecencyDbPath, historyDbPath, {
    enableMmapCache: true,
    watch: true,
    aiMode: false,
  });

  // Wait for initial scan (up to 30s) with progress updates
  const scanDone = await new Promise<boolean>((resolve) => {
    const start = Date.now();
    const maxWait = 30000;
    const pollInterval = 200;

    const poll = () => {
      const progress = getScanProgress(instance!);
      if (progress) {
        if (progress.isWarmupComplete) {
          statusBarItem.text = `$(check) FFF: ${progress.scannedFilesCount.toLocaleString()} files`;
        } else if (progress.isScanning) {
          statusBarItem.text = `$(sync~spin) FFF: scanning (${progress.scannedFilesCount.toLocaleString()} files)`;
        } else {
          statusBarItem.text = `$(sync~spin) FFF: indexing...`;
        }
      }

      if (waitForScan(instance!, 0)) {
        resolve(true);
        return;
      }

      if (Date.now() - start > maxWait) {
        resolve(false);
        return;
      }

      setTimeout(poll, pollInterval);
    };

    poll();
  });

  if (scanDone) {
    const progress = getScanProgress(instance!);
    const total = progress?.scannedFilesCount ?? 0;
    statusBarItem.text = `$(check) FFF: ${total.toLocaleString()} files`;
    statusBarItem.tooltip = "FFF — File search ready";
  } else {
    // Still scanning in background
    startBackgroundProgressPolling(instance);
  }
}

function startBackgroundProgressPolling(inst: FffInstanceHandle) {
  const interval = setInterval(() => {
    if (!instance) {
      clearInterval(interval);
      return;
    }

    const progress = getScanProgress(inst);
    if (!progress) return;

    if (progress.isWarmupComplete) {
      statusBarItem.text = `$(check) FFF: ${progress.scannedFilesCount.toLocaleString()} files`;
      statusBarItem.tooltip = "FFF — File search ready";
      clearInterval(interval);
    } else {
      statusBarItem.text = `$(sync~spin) FFF: scanning ${progress.scannedFilesCount.toLocaleString()} files`;
    }
  }, 1000);
}

export function deactivate() {
  if (instance) {
    destroyInstance(instance);
    instance = null;
  }
}
