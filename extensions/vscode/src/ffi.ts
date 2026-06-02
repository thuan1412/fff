import * as koffi from "koffi";
import * as path from "path";
import * as os from "os";

// ── Platform detection ──────────────────────────────────────────────────────

function platformKey(): string {
  const p = os.platform();
  const a = os.arch();
  if (p === "darwin" && a === "arm64") return "darwin-arm64";
  if (p === "darwin" && a === "x64") return "darwin-x64";
  if (p === "linux" && a === "x64") return "linux-x64";
  if (p === "win32" && a === "x64") return "win32-x64";
  throw new Error(`Unsupported platform: ${p}-${a}`);
}

function libPath(): string {
  const base = path.join(__dirname, "..", "bin", platformKey());
  if (os.platform() === "win32") return path.join(base, "fff_c.dll");
  if (os.platform() === "darwin") return path.join(base, "libfff_c.dylib");
  return path.join(base, "libfff_c.so");
}

// ── koffi type definitions ──────────────────────────────────────────────────

const FffLocation = koffi.struct("FffLocation", {
  tag: "uint8",
  line: "int32",
  col: "int32",
  end_line: "int32",
  end_col: "int32",
});

const FffFileItem = koffi.struct("FffFileItem", {
  relative_path: koffi.pointer("char"),
  file_name: koffi.pointer("char"),
  git_status: koffi.pointer("char"),
  size: "uint64",
  modified: "uint64",
  access_frecency_score: "int64",
  modification_frecency_score: "int64",
  total_frecency_score: "int64",
  is_binary: "bool",
});

const FffScore = koffi.struct("FffScore", {
  total: "int32",
  base_score: "int32",
  filename_bonus: "int32",
  special_filename_bonus: "int32",
  frecency_boost: "int32",
  distance_penalty: "int32",
  current_file_penalty: "int32",
  combo_match_boost: "int32",
  path_alignment_bonus: "int32",
  exact_match: "bool",
  match_type: koffi.pointer("char"),
});

const FffSearchResult = koffi.struct("FffSearchResult", {
  items: koffi.pointer(FffFileItem),
  scores: koffi.pointer(FffScore),
  count: "uint32",
  total_matched: "uint32",
  total_files: "uint32",
  location: koffi.pointer(FffLocation),
});

const FffMatchRange = koffi.struct("FffMatchRange", {
  start: "uint32",
  end: "uint32",
});

const FffGrepMatch = koffi.struct("FffGrepMatch", {
  relative_path: koffi.pointer("char"),
  file_name: koffi.pointer("char"),
  git_status: koffi.pointer("char"),
  line_content: koffi.pointer("char"),
  match_ranges: koffi.pointer(FffMatchRange),
  context_before: koffi.pointer(koffi.pointer("char")),
  context_after: koffi.pointer(koffi.pointer("char")),
  size: "uint64",
  modified: "uint64",
  total_frecency_score: "int64",
  access_frecency_score: "int64",
  modification_frecency_score: "int64",
  line_number: "uint64",
  byte_offset: "uint64",
  col: "uint32",
  match_ranges_count: "uint32",
  context_before_count: "uint32",
  context_after_count: "uint32",
  fuzzy_score: "uint16",
  has_fuzzy_score: "bool",
  is_binary: "bool",
  is_definition: "bool",
});

const FffGrepResult = koffi.struct("FffGrepResult", {
  items: koffi.pointer(FffGrepMatch),
  count: "uint32",
  total_matched: "uint32",
  total_files_searched: "uint32",
  total_files: "uint32",
  filtered_file_count: "uint32",
  next_file_offset: "uint32",
  regex_fallback_error: koffi.pointer("char"),
});

const FffScanProgress = koffi.struct("FffScanProgress", {
  scanned_files_count: "uint64",
  is_scanning: "bool",
  is_watcher_ready: "bool",
  is_warmup_complete: "bool",
});

// FffResult envelope — always accessed via pointer from fff_* return values.
const FffResult = koffi.struct("FffResult", {
  success: "bool",
  error: koffi.pointer("char"),
  handle: koffi.pointer("void"),
  int_value: "int64",
});

const FffResultPtr = koffi.pointer(FffResult);
const FffInstancePtr = koffi.pointer("void");

// ── Load library ────────────────────────────────────────────────────────────

let lib: koffi.IKoffiLib | null = null;

function getLib(): koffi.IKoffiLib {
  if (!lib) {
    const p = libPath();
    lib = koffi.load(p);
  }
  return lib;
}

// ── Low-level helpers ───────────────────────────────────────────────────────

/** Read a heap-allocated FffResult and free it. Returns decoded fields. */
function readResult(resultPtr: number): {
  success: boolean;
  error: string | null;
  handle: number;
  intValue: number;
} {
  const r = koffi.decode(resultPtr as unknown as any, FffResult);
  const err = r.error ? koffi.decode(r.error, "string") : null;
  const h: number = (r.handle || 0) as number;

  // Always free the result envelope
  const l = getLib();
  l.func("fff_free_result", "void", [FffResultPtr])(koffi.as(resultPtr, FffResultPtr));

  return {
    success: Boolean(r.success),
    error: err as string | null,
    handle: h,
    intValue: Number(r.int_value),
  };
}

/** Read a C string pointer or already-decoded string. Returns "" if null. */
function readCStr(ptr: number | null | undefined | string): string {
  if (!ptr) return "";
  if (typeof ptr === "string") return ptr;
  return koffi.decode(ptr, "string") ?? "";
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface FffInstanceHandle {
  ptr: number;
}

let instanceCount = 0;

export function createInstance(
  basePath: string,
  frecencyDbPath: string | null,
  historyDbPath: string | null,
  opts: {
    enableMmapCache?: boolean;
    enableContentIndexing?: boolean;
    watch?: boolean;
    aiMode?: boolean;
  } = {},
): FffInstanceHandle {
  const l = getLib();
  const fn = l.func(
    "fff_create_instance2",
    FffResultPtr,
    [
      "string", // base_path
      "string", // frecency_db_path
      "string", // history_db_path
      "bool", // use_unsafe_no_lock (ignored)
      "bool", // enable_mmap_cache
      "bool", // enable_content_indexing
      "bool", // watch
      "bool", // ai_mode
      "string", // log_file_path
      "string", // log_level
      "uint64", // cache_budget_max_files
      "uint64", // cache_budget_max_bytes
      "uint64", // cache_budget_max_file_size
    ],
  );

  const resultPtr = fn(
    basePath,
    frecencyDbPath ?? null,
    historyDbPath ?? null,
    false,
    opts.enableMmapCache ?? true,
    opts.enableContentIndexing ?? false,
    opts.watch ?? true,
    opts.aiMode ?? false,
    null,
    null,
    0, 0, 0,
  ) as unknown as number;

  const r = readResult(resultPtr);
  if (!r.success) {
    throw new Error(`fff_create_instance2 failed: ${r.error}`);
  }

  instanceCount++;
  return { ptr: r.handle };
}

export function destroyInstance(inst: FffInstanceHandle): void {
  if (instanceCount <= 0) return;
  const l = getLib();
  l.func("fff_destroy", "void", [FffInstancePtr])(
    inst.ptr,
  );
  instanceCount--;
}

// ── File search ─────────────────────────────────────────────────────────────

export interface FileSearchResult {
  items: Array<{
    relativePath: string;
    fileName: string;
    gitStatus: string;
    size: number;
    modified: number;
    accessFrecencyScore: number;
    modificationFrecencyScore: number;
    totalFrecencyScore: number;
    isBinary: boolean;
  }>;
  scores: Array<{
    total: number;
    baseScore: number;
    filenameBonus: number;
    specialFilenameBonus: number;
    frecencyBoost: number;
    distancePenalty: number;
    currentFilePenalty: number;
    comboMatchBoost: number;
    pathAlignmentBonus: number;
    exactMatch: boolean;
    matchType: string;
  }>;
  totalMatched: number;
  totalFiles: number;
}

export function search(
  inst: FffInstanceHandle,
  query: string,
  opts: {
    currentFile?: string | null;
    maxThreads?: number;
    pageIndex?: number;
    pageSize?: number;
    comboBoostMultiplier?: number;
    minComboCount?: number;
  } = {},
): FileSearchResult {
  const l = getLib();
  const fn = l.func(
    "fff_search",
    FffResultPtr,
    [
      FffInstancePtr,
      "string",
      "string",
      "uint32",
      "uint32",
      "uint32",
      "int32",
      "uint32",
    ],
  );

  const resultPtr = fn(
    inst.ptr,
    query,
    opts.currentFile ?? null,
    opts.maxThreads ?? 0,
    opts.pageIndex ?? 0,
    opts.pageSize ?? 100,
    opts.comboBoostMultiplier ?? 0,
    opts.minComboCount ?? 0,
  ) as unknown as number;

  const r = readResult(resultPtr);
  if (!r.success) throw new Error(`fff_search failed: ${r.error}`);

  const sr = koffi.decode(r.handle as unknown as any, FffSearchResult);

  const itemsPtr = sr.items;
  const scoresPtr = sr.scores;
  const count: number = sr.count | 0;
  const decodedItems: any[] = koffi.decode(itemsPtr, FffFileItem, count);
  const decodedScores: any[] = koffi.decode(scoresPtr, FffScore, count);
  const items: FileSearchResult["items"] = [];
  const scores: FileSearchResult["scores"] = [];

  for (let i = 0; i < count; i++) {
    const item = decodedItems[i];
    const score = decodedScores[i];

    items.push({
      relativePath: readCStr(item.relative_path),
      fileName: readCStr(item.file_name),
      gitStatus: readCStr(item.git_status),
      size: Number(item.size),
      modified: Number(item.modified),
      accessFrecencyScore: Number(item.access_frecency_score),
      modificationFrecencyScore: Number(item.modification_frecency_score),
      totalFrecencyScore: Number(item.total_frecency_score),
      isBinary: Boolean(item.is_binary),
    });

    scores.push({
      total: score.total,
      baseScore: score.base_score,
      filenameBonus: score.filename_bonus,
      specialFilenameBonus: score.special_filename_bonus,
      frecencyBoost: score.frecency_boost,
      distancePenalty: score.distance_penalty,
      currentFilePenalty: score.current_file_penalty,
      comboMatchBoost: score.combo_match_boost,
      pathAlignmentBonus: score.path_alignment_bonus,
      exactMatch: Boolean(score.exact_match),
      matchType: readCStr(score.match_type),
    });
  }

  // Free the search result struct
  l.func("fff_free_search_result", "void", [koffi.pointer(FffSearchResult)])(
    koffi.as(r.handle, koffi.pointer(FffSearchResult)),
  );

  return {
    items,
    scores,
    totalMatched: sr.total_matched,
    totalFiles: sr.total_files,
  };
}

// ── Grep ────────────────────────────────────────────────────────────────────

export interface GrepSearchResult {
  matches: Array<{
    relativePath: string;
    fileName: string;
    gitStatus: string;
    lineContent: string;
    lineNumber: number;
    col: number;
    byteOffset: number;
    matchRanges: Array<{ start: number; end: number }>;
    size: number;
    modified: number;
    totalFrecencyScore: number;
    isBinary: boolean;
    isDefinition: boolean;
    fuzzyScore?: number;
  }>;
  totalFilesSearched: number;
  totalFiles: number;
  filteredFileCount: number;
  nextFileOffset: number;
}

export function liveGrep(
  inst: FffInstanceHandle,
  query: string,
  opts: {
    mode?: "plain" | "regex" | "fuzzy";
    maxFileSize?: number;
    maxMatchesPerFile?: number;
    smartCase?: boolean;
    fileOffset?: number;
    pageLimit?: number;
    timeBudgetMs?: number;
    beforeContext?: number;
    afterContext?: number;
    classifyDefinitions?: boolean;
  } = {},
): GrepSearchResult {
  const l = getLib();
  const modeCode = { plain: 0, regex: 1, fuzzy: 2 }[opts.mode ?? "plain"];

  const fn = l.func(
    "fff_live_grep",
    FffResultPtr,
    [
      FffInstancePtr,
      "string",
      "uint8",
      "uint64",
      "uint32",
      "bool",
      "uint32",
      "uint32",
      "uint64",
      "uint32",
      "uint32",
      "bool",
    ],
  );

  const resultPtr = fn(
    inst.ptr,
    query,
    modeCode,
    opts.maxFileSize ?? 0,
    opts.maxMatchesPerFile ?? 0,
    opts.smartCase ?? true,
    opts.fileOffset ?? 0,
    opts.pageLimit ?? 50,
    opts.timeBudgetMs ?? 0,
    opts.beforeContext ?? 0,
    opts.afterContext ?? 0,
    opts.classifyDefinitions ?? false,
  ) as unknown as number;

  const r = readResult(resultPtr);
  if (!r.success) throw new Error(`fff_live_grep failed: ${r.error}`);

  const gr = koffi.decode(r.handle as unknown as any, FffGrepResult);

  const itemsPtr = gr.items;
  const count: number = gr.count | 0;
  const decodedMatches: any[] = koffi.decode(itemsPtr, FffGrepMatch, count);
  const matches: GrepSearchResult["matches"] = [];

  for (let i = 0; i < count; i++) {
    const m = decodedMatches[i];

    let matchRanges: Array<{ start: number; end: number }> = [];
    const rangesCount: number = m.match_ranges_count | 0;
    if (m.match_ranges && rangesCount > 0) {
      const rangesPtr = m.match_ranges;
      const decodedRanges: any[] = koffi.decode(rangesPtr, FffMatchRange, rangesCount);
      matchRanges = decodedRanges.map((r: any) => ({ start: r.start, end: r.end }));
    }

    matches.push({
      relativePath: readCStr(m.relative_path),
      fileName: readCStr(m.file_name),
      gitStatus: readCStr(m.git_status),
      lineContent: readCStr(m.line_content),
      lineNumber: Number(m.line_number),
      col: m.col,
      byteOffset: Number(m.byte_offset),
      matchRanges,
      size: Number(m.size),
      modified: Number(m.modified),
      totalFrecencyScore: Number(m.total_frecency_score),
      isBinary: Boolean(m.is_binary),
      isDefinition: Boolean(m.is_definition),
      fuzzyScore: m.has_fuzzy_score ? m.fuzzy_score : undefined,
    });
  }

  l.func("fff_free_grep_result", "void", [koffi.pointer(FffGrepResult)])(
    koffi.as(r.handle, koffi.pointer(FffGrepResult)),
  );

  return {
    matches,
    totalFilesSearched: gr.total_files_searched,
    totalFiles: gr.total_files,
    filteredFileCount: gr.filtered_file_count,
    nextFileOffset: gr.next_file_offset,
  };
}

// ── Scan progress ───────────────────────────────────────────────────────────

export function waitForScan(inst: FffInstanceHandle, timeoutMs: number): boolean {
  const fn = getLib().func(
    "fff_wait_for_scan",
    FffResultPtr,
    [FffInstancePtr, "uint64"],
  );

  const resultPtr = fn(
    inst.ptr,
    timeoutMs,
  ) as unknown as number;

  const r = readResult(resultPtr);
  return r.intValue === 1;
}

export function getScanProgress(inst: FffInstanceHandle): {
  scannedFilesCount: number;
  isScanning: boolean;
  isWatcherReady: boolean;
  isWarmupComplete: boolean;
} | null {
  const fn = getLib().func(
    "fff_get_scan_progress",
    FffResultPtr,
    [FffInstancePtr],
  );

  const resultPtr = fn(inst.ptr) as unknown as number;
  const r = readResult(resultPtr);

  if (!r.success || !r.handle) return null;

  const progress = koffi.decode(
    r.handle as unknown as any,
    FffScanProgress,
  );

  return {
    scannedFilesCount: Number(progress.scanned_files_count),
    isScanning: Boolean(progress.is_scanning),
    isWatcherReady: Boolean(progress.is_watcher_ready),
    isWarmupComplete: Boolean(progress.is_warmup_complete),
  };
}

// ── Frecency tracking ───────────────────────────────────────────────────────

export function trackQuery(
  inst: FffInstanceHandle,
  query: string,
  selectedPath: string,
): boolean {
  const fn = getLib().func(
    "fff_track_query",
    FffResultPtr,
    [FffInstancePtr, "string", "string"],
  );

  const resultPtr = fn(
    inst.ptr,
    query,
    selectedPath,
  ) as unknown as number;

  const r = readResult(resultPtr);
  return r.intValue === 1;
}
