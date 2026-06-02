/**
 * Quick FFI smoke test — run with: node extensions/vscode/scripts/test-ffi.mjs
 *
 * Tests that the koffi type definitions and native library can be loaded
 * without errors, then runs a basic create/search cycle.
 */
import { createRequire } from "module";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const koffi = require("koffi");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Platform / lib discovery ────────────────────────────────────────────────
function platformKey() {
  const p = os.platform();
  const a = os.arch();
  if (p === "darwin" && a === "arm64") return "darwin-arm64";
  if (p === "darwin" && a === "x64") return "darwin-x64";
  if (p === "linux" && a === "x64") return "linux-x64";
  if (p === "win32" && a === "x64") return "win32-x64";
  throw new Error(`Unsupported platform: ${p}-${a}`);
}

function libPath() {
  const base = path.join(__dirname, "..", "bin", platformKey());
  if (os.platform() === "win32") return path.join(base, "fff_c.dll");
  if (os.platform() === "darwin") return path.join(base, "libfff_c.dylib");
  return path.join(base, "libfff_c.so");
}

// ── Type definitions (mirrors src/ffi.ts) ───────────────────────────────────
console.log("1. Defining koffi types...");

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

const FffResult = koffi.struct("FffResult", {
  success: "bool",
  error: koffi.pointer("char"),
  handle: koffi.pointer("void"),
  int_value: "int64",
});

const FffResultPtr = koffi.pointer(FffResult);
const FffInstancePtr = koffi.pointer("void");

console.log("   ✓ types defined");

// ── Load library ────────────────────────────────────────────────────────────
console.log("2. Loading native library...");
const libPathStr = libPath();
console.log("   path:", libPathStr);
const lib = koffi.load(libPathStr);
console.log("   ✓ loaded");

// ── Helper ──────────────────────────────────────────────────────────────────
function readResult(resultPtr) {
  const r = koffi.decode(resultPtr, FffResult);
  const err = r.error ? koffi.decode(r.error, "string") : null;
  // r.handle is now a void* pointer — pass it through directly
  const h = r.handle || 0;

  lib.func("fff_free_result", "void", [FffResultPtr])(koffi.as(resultPtr, FffResultPtr));

  return {
    success: Boolean(r.success),
    error: err,
    handle: h,
    intValue: Number(r.int_value),
  };
}

// ── Test: create instance ──────────────────────────────────────────────────
console.log("3. Creating FFF instance...");
try {
  const fn = lib.func(
    "fff_create_instance2",
    FffResultPtr,
    [
      "string", "string", "string",
      "bool", "bool", "bool", "bool", "bool",
      "string", "string",
      "uint64", "uint64", "uint64",
    ],
  );

  const resultPtr = fn(
    process.cwd(),
    null,
    null,
    false,
    true,   // enable_mmap_cache
    false,  // enable_content_indexing
    true,   // watch = TRUE like the extension
    false,  // ai_mode
    null,
    null,
    0, 0, 0,
  );

  if (typeof resultPtr !== "number") {
    console.log("   resultPtr type:", typeof resultPtr, "value:", resultPtr);
  }

  const r = readResult(resultPtr);
  console.log("   success:", r.success);
  if (!r.success) {
    console.log("   error:", r.error);
    process.exit(1);
  }
  console.log("   handle:", r.handle);
  console.log("   ✓ instance created");

  // ── Test: wait for scan ─────────────────────────────────────────────────
  console.log("4. Waiting for scan (5s timeout)...");
  console.log("   handle:", r.handle, "type:", typeof r.handle);

  const waitFn = lib.func("fff_wait_for_scan", FffResultPtr, [FffInstancePtr, "uint64"]);
  const waitPtr = waitFn(r.handle, 5000);
  const waitR = readResult(waitPtr);
  console.log("   done:", waitR.intValue === 1);

  // ── Test: scan progress ─────────────────────────────────────────────────
  console.log("5. Checking scan progress...");
  const progFn = lib.func("fff_get_scan_progress", FffResultPtr, [FffInstancePtr]);
  const progPtr = progFn(r.handle);
  const progR = readResult(progPtr);
  if (progR.success && progR.handle) {
    const prog = koffi.decode(progR.handle, FffScanProgress);
    console.log("   scanned_files_count:", Number(prog.scanned_files_count));
    console.log("   is_scanning:", Boolean(prog.is_scanning));
    console.log("   is_watcher_ready:", Boolean(prog.is_watcher_ready));
    console.log("   is_warmup_complete:", Boolean(prog.is_warmup_complete));
  } else {
    console.log("   no progress data");
  }

  // ── Test: search ────────────────────────────────────────────────────────
  console.log("6. Running search...");
  const searchFn = lib.func(
    "fff_search",
    FffResultPtr,
    [FffInstancePtr, "string", "string", "uint32", "uint32", "uint32", "int32", "uint32"],
  );
  const searchPtr = searchFn(r.handle, "ffi", null, 0, 0, 10, 0, 0);
  const searchR = readResult(searchPtr);
  console.log("   success:", searchR.success);
  if (searchR.success) {
    const sr = koffi.decode(searchR.handle, FffSearchResult);
    console.log("   count:", sr.count);
    console.log("   total_matched:", sr.total_matched);

    // Batch decode: the reliable approach
    const itemsPtr = sr.items;
    const scoresPtr = sr.scores;
    const count = sr.count | 0;
    
    // Test decode behavior
    try { const t = koffi.decode(itemsPtr, FffFileItem, count); console.log("   items batch: OK"); } catch(e) { console.log("   items batch:", e.message); }
    try { const t = koffi.decode(scoresPtr, FffScore, count); console.log("   scores batch: OK"); } catch(e) { console.log("   scores batch:", e.message); }
    try { const t = koffi.decode(scoresPtr, FffScore, 1); console.log("   scores batch 1: OK"); } catch(e) { console.log("   scores batch 1:", e.message); }
    try { const t = koffi.decode(scoresPtr, 0, FffScore); console.log("   scores offset 0: OK"); } catch(e) { console.log("   scores offset 0:", e.message); }

    lib.func("fff_free_search_result", "void", [koffi.pointer(FffSearchResult)])(
      koffi.as(searchR.handle, koffi.pointer(FffSearchResult)),
    );
  } else {
    console.log("   error:", searchR.error);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  lib.func("fff_destroy", "void", [FffInstancePtr])(r.handle);
  console.log("   ✓ destroyed");
} catch (err) {
  console.error("FAIL:", err.message);
  console.error(err.stack);
  process.exit(1);
}

console.log("\n✓ All tests passed!");
