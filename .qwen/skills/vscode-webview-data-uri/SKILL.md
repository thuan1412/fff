---
name: vscode-webview-data-uri
description: VS Code webviews block inline scripts — use data URI for JS and handle message passing correctly
source: auto-skill
extracted_at: '2026-06-01T20:10:00.000Z'
---

# VS Code Webview Scripts: Data URI Pattern

## The Problem

VS Code webviews **silently block inline `<script>` tags**, even with `enableScripts: true` in the webview options. No error is thrown; no CSP violation appears in the console. The script simply never executes.

```html
<!-- This will NOT run in a VS Code webview -->
<script>
  const vscode = acquireVsCodeApi();
  vscode.postMessage({ type: "ready" });
</script>
```

## The Solution: Data URI Scripts

Use `<script src="data:text/javascript;charset=utf-8,...">` with `encodeURIComponent()` applied to the full JavaScript source:

```typescript
// In your WebviewViewProvider or WebviewPanel
private getScript(): string {
  return `
var vscode = acquireVsCodeApi();
var searchEl = document.getElementById("search-input");

searchEl.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    vscode.postMessage({ type: "search", query: searchEl.value });
  }
});

window.addEventListener("message", function(event) {
  var msg = event.data;
  if (msg.type === "results") {
    renderResults(msg.results);
  }
});

vscode.postMessage({ type: "ready" });
`;
}

private getHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
  <input id="search-input" type="text" />
  <div id="results"></div>
  <script src="data:text/javascript;charset=utf-8,${encodeURIComponent(this.getScript())}"></script>
</body>
</html>`;
}
```

## Key Rules for the Injected Script

### 1. Use ES5-compatible JavaScript only

The data URI script runs in the webview's JavaScript context. Avoid:
- `const` / `let` → use `var` (some VS Code Electron versions only support ES5 in data URIs)
- Arrow functions `() =>` → use `function() {}`
- Template literals → use string concatenation
- `class` → use prototype patterns
- `import` / `export` → not available

### 2. Event delegation over inline onclick for dynamic HTML

**Prefer event delegation with `data-*` attributes** over inline `onclick` handlers on dynamically generated HTML. The multi-level escaping (TypeScript → JavaScript → HTML → JavaScript-in-attribute) is extremely fragile and prone to silent breakage — a single mismatched quote across three levels of string encoding produces HTML that parses without errors but whose handlers never fire.

**Diagnosing broken inline onclick handlers:** When the HTML output from `innerHTML` contains mismatched JS string quotes like `onclick="handler('path")"` (single-quote opens, double-quote closes), the HTML parser **silently** interprets the attribute value as only the part up to the `"`, and treats the rest as garbage attributes. No error appears in the console. In DevTools, inspect the rendered element — if the `onclick` attribute value is truncated mid-string, you have a quote-mismatch from incorrect escaping.

**Bad — inline onclick (avoid):**
```javascript
// The escaping across TS/JS/HTML/JS levels makes this fragile.
// A wrong escape (e.g. \\' vs \\' vs ') causes silently broken handlers.
html += '<div onclick="window._openFile(\'' + escAttr(path) + '\',' + line + ',' + col + ')">';
```

**Good — data attributes + event delegation:**
```javascript
// In the data URI script, add ONE delegated click listener:
resultsEl.addEventListener("click", function(e) {
  var target = e.target.closest("[data-action]");
  if (!target) return;

  var action = target.getAttribute("data-action");
  if (action === "open") {
    var path = target.getAttribute("data-path");
    var line = parseInt(target.getAttribute("data-line"), 10) || 0;
    var col = parseInt(target.getAttribute("data-col"), 10) || 0;
    vscode.postMessage({
      type: "openFile",
      relativePath: path,
      lineNumber: line,
      col: col
    });
  }
});

// In dynamically generated HTML — no onclick, just data attrs:
html += '<div class="match-row" data-action="open" data-path="' + escAttr(path) + '" data-line="' + line + '" data-col="' + col + '">';
```

**Why:** Inline `onclick` requires the path/line/col values to be valid JS string literals inside an HTML attribute. That means escaping for JS single/double quotes, then escaping for HTML attribute delimiters, all while the TypeScript template literal adds its own escape layer. Getting all three levels right simultaneously is error-prone. Data attributes only need HTML attribute escaping, and the values are read back as plain strings — no JS-in-HTML nesting.

**Toggle pattern:**
```javascript
// File row toggle — same delegate, different action:
html += '<div class="file-row" data-action="toggle" data-file-id="' + escAttr(fileId) + '">';

// In the delegate:
if (action === "toggle") {
  var fileId = target.getAttribute("data-file-id");
  var list = document.getElementById(fileId);
  // toggle .open class, update arrow icon...
}
```

### 3. Escape functions for dynamic HTML

When building HTML via string concatenation in the data URI script, you need two escaping functions:

```javascript
// For text content between tags (prevents XSS):
function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// For HTML attribute values (prevents breaking out of attribute):
function escAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
          .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

**Key differences:**
- `escHtml` escapes `&`, `<`, `>` — used for content like file names between tags.
- `escAttr` escapes `&`, `"`, `<`, `>` — used for values in `data-path="..."` or `id="..."`. Single quotes (`'`) do NOT need escaping when the HTML attribute uses double-quote delimiters (which the code above does).

**Do NOT** escape single quotes with backslashes for HTML attributes — e.g. `s.replace(/'/g, "\\'")`. This produces backslash characters that become part of the attribute value in HTML, which is not how HTML escaping works. Use `&quot;` for double quotes and delimit attributes with double quotes.

### 4. `acquireVsCodeApi()` works in data URIs

`acquireVsCodeApi()` is available and works correctly from data URI scripts. Call it once at the top and store the reference.

### 5. Message passing both directions

**Webview → Extension:** Use `vscode.postMessage({...})`. The extension receives it via `webview.onDidReceiveMessage()`.

**Extension → Webview:** Use `webview.postMessage({...})`. The webview receives it via `window.addEventListener("message", ...)`.

## CSP Warning

VS Code emits this warning when a webview has no CSP meta tag:

> fff.fff-vscode created a webview without a content security policy

This does **not** affect functionality. Adding a CSP meta tag with `'unsafe-inline'` is possible but VS Code may ignore or override it. The data URI approach works regardless of the CSP state.

## Complete Provider Pattern

```typescript
class SearchPanelProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private getInstance: () => FffInstanceHandle | null,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    webviewView.webview.html = this.getHtml();
    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "ready": break;
      case "search": this.doSearch(msg.query); break;
    }
  }

  private postMessage(msg: any): void {
    this._view?.webview.postMessage(msg);
  }
}
```

## Debugging

When the webview doesn't render or scripts don't run:

1. Add a visible DOM element at the very start of the data URI script — if it appears, the script runs.
2. Right-click inside the webview panel → **Inspect** — this opens a separate DevTools for the webview context.
3. Check the Extension Host DevTools (Cmd+Shift+P → `Developer: Toggle Developer Tools` → Console) for extension-side logs.
