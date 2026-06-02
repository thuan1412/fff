---
name: vscode-quickpick-custom-props
description: VS Code QuickPick strips custom properties from items — use a parallel array to store extra data
source: auto-skill
extracted_at: '2026-06-02T19:20:00.000Z'
---

# VS Code QuickPick: Custom Properties Stripped

## The Problem

VS Code's QuickPick API silently strips custom (non-standard) properties from `QuickPickItem` objects. When you attach a custom property like `_relativePath`:

```typescript
interface FileQuickPickItem extends vscode.QuickPickItem {
  _relativePath: string;
}

quickPick.items = results.map((item) => ({
  label: item.fileName,
  description: item.relativePath,
  _relativePath: item.relativePath,  // ← set here
}));

// Later...
const selected = quickPick.selectedItems[0] as FileQuickPickItem;
console.log(selected._relativePath);  // ← undefined! VS Code stripped it
```

The custom property is present when you assign `quickPick.items`, but **gone** when you read it back from `quickPick.selectedItems`. No error is thrown; the property is simply `undefined`.

## The Fix: Parallel Array

Store the extra data in a separate array and look up by index:

```typescript
let relativePaths: string[] = [];

quickPick.onDidChangeValue((value) => {
  // Build parallel array alongside items
  const paths: string[] = [];
  quickPick.items = results.items.map((item) => {
    paths.push(item.relativePath);
    return {
      label: item.fileName,
      description: item.relativePath,
    };
  });
  relativePaths = paths;
});

quickPick.onDidAccept(() => {
  const selected = quickPick.selectedItems[0];
  if (!selected) return;

  // Find the item's index in the displayed list
  const idx = quickPick.items.indexOf(selected);
  if (idx < 0 || idx >= relativePaths.length) return;

  // Use the parallel array to get the path
  const filePath = relativePaths[idx];
  const fileUri = vscode.Uri.joinPath(
    vscode.Uri.file(workspaceRoot),
    filePath,
  );
  await vscode.window.showTextDocument(fileUri);
});
```

**Why index-based lookup:** `quickPick.selectedItems[0]` returns the same object reference that was in `quickPick.items`, so `indexOf` reliably finds it. The parallel array `relativePaths` is indexed in the same order and never touched by VS Code.

## Also Prefer `showTextDocument` over `vscode.open`

`vscode.commands.executeCommand("vscode.open", uri)` can be less reliable than the direct API:

```typescript
// Less reliable:
vscode.commands.executeCommand("vscode.open", fileUri);

// More reliable — direct API:
await vscode.window.showTextDocument(fileUri);
```

## Also Use `Uri.joinPath` for Cross-Platform Paths

```typescript
// Wrong — string concatenation breaks on Windows:
const fileUri = vscode.Uri.file(workspaceRoot + "/" + relativePath);

// Right — platform-safe path joining:
const fileUri = vscode.Uri.joinPath(
  vscode.Uri.file(workspaceRoot),
  relativePath,
);
```
