import * as vscode from "vscode";
import { FffInstanceHandle, liveGrep } from "./ffi";

// ── Provider ────────────────────────────────────────────────────────────────

export class SearchPanelProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private getInstance: () => FffInstanceHandle | null;

  // State
  private searchQuery = "";
  private results: GrepMatch[] = [];
  private isSearching = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    getInstance: () => FffInstanceHandle | null,
  ) {
    this.getInstance = getInstance;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    webviewView.webview.html = this.getHtml();
    webviewView.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));

    // Focus the search input when the panel opens
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this.searchQuery) {
        this.updateResults();
      }
    });
  }

  // ── Message handling ────────────────────────────────────────────────────

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "ready":
        break;
      case "search":
        this.searchQuery = msg.query || "";
        this.debounceSearch();
        break;
      case "openFile":
        this.openFile(msg.relativePath, msg.lineNumber, msg.col);
        break;
      case "toggleFile":
        // Toggle expand/collapse handled entirely in HTML
        break;
    }
  }

  private debounceSearch(): void {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.updateResults(), 100);
  }

  private updateResults(): void {
    const inst = this.getInstance();
    if (!inst || !this.searchQuery.trim()) {
      this.results = [];
      this.postMessage({ type: "results", results: [], query: this.searchQuery });
      return;
    }

    this.isSearching = true;
    this.postMessage({ type: "searching", searching: true });
    try {
      const grepResults = liveGrep(inst, this.searchQuery, {
        smartCase: true,
        pageLimit: 50,
        beforeContext: 0,
        afterContext: 0,
      });

      this.results = grepResults.matches.map((m) => ({
        relativePath: m.relativePath,
        fileName: m.fileName,
        lineNumber: m.lineNumber,
        col: m.col,
        lineContent: m.lineContent,
        matchRanges: m.matchRanges,
      }));

      this.postMessage({
        type: "results",
        results: this.results,
        query: this.searchQuery,
      });
    } catch {
      this.results = [];
      this.postMessage({ type: "results", results: [], query: this.searchQuery });
    } finally {
      this.isSearching = false;
      this.postMessage({ type: "searching", searching: false });
    }
  }

  private async openFile(
    relativePath: string,
    lineNumber: number,
    col: number,
  ): Promise<void> {
    const workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const fileUri = vscode.Uri.joinPath(
      vscode.Uri.file(workspaceRoot),
      relativePath,
    );

    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const pos = new vscode.Position(
        Math.max(0, lineNumber - 1),
        Math.max(0, col),
      );
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(pos, pos),
        preserveFocus: false,
      });
    } catch {
      vscode.window.showErrorMessage(`Could not open: ${relativePath}`);
    }
  }

  private postMessage(msg: any): void {
    this._view?.webview.postMessage(msg);
  }

  // ── HTML ─────────────────────────────────────────────────────────────────

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: var(--vscode-sideBar-background);
    --fg: var(--vscode-sideBar-foreground);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, var(--vscode-widget-border));
    --input-placeholder: var(--vscode-input-placeholderForeground);
    --focus-border: var(--vscode-focusBorder);
    --button-bg: var(--vscode-button-background);
    --button-fg: var(--vscode-button-foreground);
    --button-hover: var(--vscode-button-hoverBackground);
    --list-hover: var(--vscode-list-hoverBackground);
    --list-active: var(--vscode-list-activeSelectionBackground);
    --match-color: var(--vscode-editor-findMatchHighlightBackground, #555);
    --match-border: var(--vscode-editor-findMatchBorder, #888);
    --error-fg: var(--vscode-errorForeground);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font: 13px/1.4 var(--vscode-font-family); padding: 8px 0; }

  /* ── Search / replace inputs ───────────────────────────────── */
  .input-row {
    display: flex;
    align-items: center;
    padding: 2px 8px;
    gap: 4px;
  }
  .input-row input {
    flex: 1;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    padding: 3px 6px;
    font: inherit;
    outline: none;
  }
  .input-row input:focus { border-color: var(--focus-border); }
  .input-row input::placeholder { color: var(--input-placeholder); }

  .toggle-btn {
    background: none; border: none; color: var(--fg);
    cursor: pointer; font: inherit; padding: 2px 4px;
    opacity: 0.7;
  }
  .toggle-btn:hover { opacity: 1; }

  /* ── Results area ──────────────────────────────────────────── */
  .results-header {
    padding: 4px 8px;
    font-size: 12px;
    opacity: 0.7;
  }
  .file-group { }
  .file-row {
    display: flex; align-items: center; gap: 4px;
    padding: 2px 8px; cursor: pointer;
    font-weight: 600; font-size: 13px;
  }
  .file-row:hover { background: var(--list-hover); }
  .file-row .arrow { font-size: 10px; width: 12px; text-align: center; }
  .file-row .name { flex: 1; }
  .file-row .count { font-size: 11px; opacity: 0.6; }

  .match-list { display: none; }
  .match-list.open { display: block; }

  .match-row {
    display: flex; align-items: center; gap: 4px;
    padding: 1px 8px 1px 28px; cursor: pointer;
    font-size: 12px; white-space: nowrap; overflow: hidden;
  }
  .match-row:hover { background: var(--list-hover); }
  .match-row .line-num {
    min-width: 36px; text-align: right; opacity: 0.5; user-select: none;
  }
  .match-row .line-content {
    overflow: hidden; text-overflow: ellipsis;
  }
  .match-row .line-content .hl {
    background: var(--match-color);
    border: 1px solid var(--match-border);
    border-radius: 2px;
  }

  .no-results { padding: 8px; font-size: 12px; opacity: 0.5; }
  .searching { padding: 8px; font-size: 12px; opacity: 0.5; }
</style>
</head>
<body>

<div class="input-row">
  <input id="search-input" type="text" placeholder="Search" autofocus />
</div>

<div class="input-row">
  <button id="toggle-replace" class="toggle-btn" title="Toggle Replace">›</button>
  <input id="replace-input" type="text" placeholder="Replace" style="display:none" />
</div>

<div class="input-row">
  <input id="include-input" type="text" placeholder="files to include (e.g. *.ts)" />
</div>

<div class="input-row">
  <input id="exclude-input" type="text" placeholder="files to exclude (e.g. node_modules)" />
</div>

<div id="results-header" class="results-header" style="display:none"></div>
<div id="results"></div>

<script src="data:text/javascript;charset=utf-8,${encodeURIComponent(this.getScript())}"></script>
</body>
</html>`;
  }

  // ── Script (data URI) ───────────────────────────────────────────────────

  private getScript(): string {
    return `
var vscode = acquireVsCodeApi();
var resultsEl = document.getElementById("results");
var headerEl = document.getElementById("results-header");
var searchEl = document.getElementById("search-input");
var replaceEl = document.getElementById("replace-input");
var toggleReplaceEl = document.getElementById("toggle-replace");
var currentQuery = "";

// Replace toggle
toggleReplaceEl.addEventListener("click", function() {
  var visible = replaceEl.style.display !== "none";
  replaceEl.style.display = visible ? "none" : "block";
  toggleReplaceEl.textContent = visible ? "\u203A" : "\u2304";
});

// Search on Enter
searchEl.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    currentQuery = searchEl.value;
    vscode.postMessage({ type: "search", query: currentQuery });
  }
});

// Debounce on typing
var searchTimer;
searchEl.addEventListener("input", function() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function() {
    currentQuery = searchEl.value;
    vscode.postMessage({ type: "search", query: currentQuery });
  }, 300);
});

// Event delegation: handle clicks on file rows (toggle) and match rows (open)
resultsEl.addEventListener("click", function(e) {
  var target = e.target.closest("[data-action]");
  if (!target) return;

  var action = target.getAttribute("data-action");
  if (action === "toggle") {
    var fileId = target.getAttribute("data-file-id");
    var list = document.getElementById(fileId);
    var arrow = document.getElementById("arrow-" + fileId);
    if (list.classList.contains("open")) {
      list.classList.remove("open");
      arrow.textContent = "\u203A";
    } else {
      list.classList.add("open");
      arrow.textContent = "\u2304";
    }
  } else if (action === "open") {
    var path = target.getAttribute("data-path");
    var line = parseInt(target.getAttribute("data-line"), 10) || 0;
    var col = parseInt(target.getAttribute("data-col"), 10) || 0;
    vscode.postMessage({ type: "openFile", relativePath: path, lineNumber: line, col: col });
  }
});

// Handle messages from extension
window.addEventListener("message", function(event) {
  var msg = event.data;
  switch (msg.type) {
    case "results":
      renderResults(msg.results || [], msg.query || "");
      break;
    case "searching":
      if (msg.searching) {
        resultsEl.innerHTML = '<div class="searching">Searching...</div>';
      }
      break;
  }
});

// Render results
function renderResults(results, query) {
  if (!results.length) {
    headerEl.style.display = "none";
    resultsEl.innerHTML = query ? '<div class="no-results">No results found</div>' : "";
    return;
  }
  var files = new Map();
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (!files.has(r.relativePath)) {
      files.set(r.relativePath, { matches: [], fileName: r.fileName });
    }
    files.get(r.relativePath).matches.push(r);
  }
  headerEl.style.display = "";
  headerEl.textContent = results.length + " results in " + files.size + " files";

  var html = "";
  files.forEach(function(group, path) {
    var matchCount = group.matches.length;
    var fileId = "f" + path.replace(/[^a-zA-Z0-9]/g, "_");
    html += '<div class="file-group">';
    html += '<div class="file-row" data-action="toggle" data-file-id="' + escAttr(fileId) + '">';
    html += '<span class="arrow" id="arrow-' + escAttr(fileId) + '">\u2304</span>';
    html += '<span class="name">' + escHtml(path) + '</span>';
    html += '<span class="count">' + matchCount + ' match' + (matchCount > 1 ? 'es' : '') + '</span>';
    html += '</div>';
    html += '<div class="match-list open" id="' + escAttr(fileId) + '">';
    for (var j = 0; j < group.matches.length; j++) {
      var m = group.matches[j];
      html += '<div class="match-row" data-action="open" data-path="' + escAttr(m.relativePath) + '" data-line="' + m.lineNumber + '" data-col="' + m.col + '">';
      html += '<span class="line-num">' + m.lineNumber + '</span>';
      html += '<span class="line-content">' + highlightLine(m.lineContent, m.matchRanges) + '</span>';
      html += '</div>';
    }
    html += '</div></div>';
  });
  resultsEl.innerHTML = html;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightLine(content, ranges) {
  if (!ranges || !ranges.length) return escHtml(content);
  var result = "";
  var pos = 0;
  for (var i = 0; i < ranges.length; i++) {
    result += escHtml(content.substring(pos, ranges[i].start));
    result += '<span class="hl">' + escHtml(content.substring(ranges[i].start, ranges[i].end)) + '</span>';
    pos = ranges[i].end;
  }
  result += escHtml(content.substring(pos));
  return result;
}

vscode.postMessage({ type: "ready" });
`;
  }
}

interface GrepMatch {
  relativePath: string;
  fileName: string;
  lineNumber: number;
  col: number;
  lineContent: string;
  matchRanges: Array<{ start: number; end: number }>;
}
