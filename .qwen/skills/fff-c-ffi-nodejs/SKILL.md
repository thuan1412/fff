---
name: fff-c-ffi-nodejs
description: How to call FFF.nvim's Rust engine from Node.js/TypeScript via the fff-c C FFI crate
source: auto-skill
extracted_at: "2026-06-01T11:15:46.772Z"
---

# Using FFF.nvim's C FFI from Node.js

## TypeScript Setup

- Install `@types/node` as a devDependency — required for `path`, `fs`, `os`, `__dirname`, `setTimeout`, etc.
- `koffi` does **not** export a `KoffiValue` type. The `koffi.decode()` first argument is typed as `any`. When casting a pointer/number to satisfy the type checker, use `as unknown as any` — never `as unknown as koffi.KoffiValue`.

## Crate Architecture

The project is a Rust workspace with multiple crates:

- **`fff-core`** (`fff-search`) — core engine (FilePicker, fuzzy search, grep, frecency)
- **`fff-c`** — compiles to a `cdylib`, wraps `fff-core` in a C FFI surface
- **`fff-nvim`** — Neovim-specific Lua FFI integration
- **`fff-grep`** — low-level grep implementation
- **`fff-query-parser`** — query constraint parsing

For external consumers, use **`fff-c`** — it exposes the full functionality (file search, grep, multi-grep, directory search, mixed search) with stable `#[repr(C)]` structs and named accessor functions.

## The FffResult Envelope Pattern

Every `fff_*` function returns `*mut FffResult` — a **heap-allocated** envelope. The caller must always free it. The pattern:

```c
typedef struct {
    bool success;
    char *error;      // malloc'd C string, or NULL on success
    void *handle;     // opaque payload (cast to typed result)
    int64_t int_value; // simple return value for bool/count responses
} FffResult;
```

Caller flow:

1. Call function → get `FffResult*`
2. If `!success`, read `error` string
3. If `success`, cast `handle` to the typed result (e.g. `FffSearchResult*`)
4. Read typed result fields and nested arrays
5. Free the typed result with its specific `fff_free_*` function
6. Free the envelope with `fff_free_result`

## koffi Struct Member Limitation

koffi does **not** allow struct types or opaque types as direct (by-value) members in `koffi.struct(...)` definitions — only primitives (`"uint32"`, `"int64"`, `"bool"`) or pointers (`koffi.pointer(...)`) are accepted. Using a struct type or `koffi.opaque()` directly causes the runtime error:

> Type \<anonymous_N\> cannot be used as a member (maybe try \<anonymous_N\> \*)

**`koffi.opaque()` can NEVER be used as a struct member** — even when pre-declared as a named constant outside the struct definition. The opaque type is always considered anonymous internally and koffi rejects it.

### Fix for `void*` fields in C structs

Use `koffi.pointer("void")` (lowercase `"void"`) for any `void*` field. Note: `"Void"` (capital V) is **not** a valid koffi type name and will throw `Unknown or invalid type name 'Void'`. Only lowercase works.

```typescript
// C:  void *handle;
// Wrong — koffi rejects opaque:
handle: FffOpaque,
handle: koffi.opaque(),

// Right — void pointer:
handle: koffi.pointer("void"),
```

When `koffi.decode()` reads a `pointer("void")` field, it returns an **External** object in Node.js. This External can be passed **directly** to other koffi function calls — do NOT convert to `Number()` and do NOT wrap with `koffi.as()`:

```typescript
// Wrong — Number(external) may throw "Cannot convert object to primitive value"
const h = r.handle ? Number(r.handle) : 0;

// Wrong — koffi.as(number, pointerType) throws "Invalid argument"
koffi.as(inst.ptr, FffInstancePtr)

// Right — keep External as-is, pass directly
const h = (r.handle || 0) as number;
// Later, pass directly:
fn(inst.ptr, ...)
```

### Fix for embedded C structs at end of parent

If the field is the last member and never accessed, change to pointer:

```typescript
// C:  typedef struct { ...; struct FffLocation location; } FffSearchResult;
location: koffi.pointer(FffLocation),  // pointer, not value
```

If the field is mid-struct or IS accessed, inline its fields with proper padding.

## Critical FFI Gotcha with koffi

**Problem:** `koffi` (and most FFI libraries) copy structs by value when a function's return type is declared as a struct. But `fff_*` functions return `*mut FffResult` — a pointer to a heap allocation that must be passed to `fff_free_result`. If koffi copies the struct, you lose the original pointer and leak memory.

**Solution:** Declare all C function return types as **pointer types** (e.g. `koffi.pointer(FffResult)` not `FffResult`). Then use `koffi.decode()` to read the struct fields from the pointer, and pass the raw pointer to `fff_free_result`.

```typescript
// Wrong: koffi copies the struct, original pointer lost
const fn = l.func("fff_search", FffResult, [...]);

// Right: pointer return preserves original allocation
const FffResultPtr = koffi.pointer(FffResult);
const fn = l.func("fff_search", FffResultPtr, [...]);

// Read + free pattern
function readResult(resultPtr: number) {
  const r = koffi.decode(resultPtr as unknown as any, FffResult);
  // ... read fields ...
  l.func("fff_free_result", "void", [FffResultPtr])(koffi.as(resultPtr, FffResultPtr));
  return { ... };
}
```

## Memory Management Rules

| Allocated by                                                   | Freed by                       |
| -------------------------------------------------------------- | ------------------------------ |
| `fff_create_instance` / `fff_create_instance2`                 | `fff_destroy`                  |
| Any `fff_*` returning `FffResult*`                             | `fff_free_result`              |
| `fff_search` (handle → `FffSearchResult*`)                     | `fff_free_search_result`       |
| `fff_live_grep` / `fff_multi_grep` (handle → `FffGrepResult*`) | `fff_free_grep_result`         |
| `fff_search_directories` (handle → `FffDirSearchResult*`)      | `fff_free_dir_search_result`   |
| `fff_search_mixed` (handle → `FffMixedSearchResult*`)          | `fff_free_mixed_search_result` |

Strings inside result structs are owned by the parent result — they're freed when the parent is freed. Do not free them individually.

## Navigating Nested Arrays

Result structs contain pointers to arrays of items. **Do NOT use JavaScript pointer arithmetic** (`ptr + offset`) — koffi pointers in Node.js ≥24 are `External` objects that don't support `+`, `Number()`, or `valueOf()`.

Instead, use **batch decode** via `koffi.decode(ptr, type, len)` to decode the entire array in one call:

```typescript
const count: number = sr.count | 0;
const itemsPtr = sr.items; // extract to local — do NOT inline
const scoresPtr = sr.scores;
const decodedItems: any[] = koffi.decode(itemsPtr, FffFileItem, count);
const decodedScores: any[] = koffi.decode(scoresPtr, FffScore, count);

for (let i = 0; i < count; i++) {
  const item = decodedItems[i];
  const score = decodedScores[i];
  // ...
}
```

### Why `|0` and local extraction are required

koffi's 3-argument `decode` overloads (`offset` and `len` variants) have **intermittent failures** when passed HeapNumbers (from `koffi.sizeof()` or computed expressions) vs V8 Smi (small integer literals). Two defensive rules eliminate this:

1. **`|0` all numeric arguments**: `sr.count | 0`, `size | 0` — forces Smi
2. **Extract External pointers to local variables**: `const p = sr.items;` — do NOT pass `sr.items` directly into `koffi.decode()`. Accessing struct members inside function arguments can trigger the V8 Smi/HeapNumber mismatch.

For match ranges (typically small arrays), same pattern:

```typescript
const rangesPtr = m.match_ranges;
const rangesCount: number = m.match_ranges_count | 0;
const decodedRanges: any[] = koffi.decode(
  rangesPtr,
  FffMatchRange,
  rangesCount,
);
```

### ⚠️ Batch decode auto-converts `char*` to strings

When using `koffi.decode(ptr, type, len)` (the `len` overload), koffi recursively decodes all fields — including `char*` pointer fields, which become JavaScript strings. This means helper functions like `readCStr` that normally call `koffi.decode(ptr, "string")` on an External pointer will receive an already-decoded string and fail with:

> TypeError: Unexpected String value for variable, expected external or TypedArray

**Fix:** Make `readCStr` handle both cases:

```typescript
function readCStr(ptr: number | null | undefined | string): string {
  if (!ptr) return "";
  if (typeof ptr === "string") return ptr; // already decoded by batch decode
  return koffi.decode(ptr, "string") ?? "";
}
```

This is only needed when switching from single-element decode (offset-based) to batch decode (len-based). Single-element decode with `koffi.decode(ptr, offset, type)` does NOT auto-convert nested pointers.

## Stable Accessor Functions

`fff-c` provides `fff_file_item_get_*`, `fff_grep_match_get_*`, `fff_search_result_get_*`, `fff_grep_result_get_*` accessor functions. These provide a stable API insulated from struct layout changes. Prefer them over direct field access when binding from dynamic languages like Emacs Lisp or Python ctypes.

## Key Function Signatures

| Function                 | Purpose                             | Notable params                                                                  |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------- |
| `fff_create_instance2`   | Create instance with full options   | base_path, frecency_db_path, history_db_path, watch, ai_mode, log, cache budget |
| `fff_search`             | Fuzzy file search                   | query, current_file, max_threads, page_index, page_size, combo_boost            |
| `fff_search_directories` | Directory fuzzy search              | query, current_file, pagination                                                 |
| `fff_search_mixed`       | Files + dirs interleaved            | query, current_file, combo_boost, pagination                                    |
| `fff_live_grep`          | Content search (plain/regex/fuzzy)  | query, mode (0/1/2), smart_case, context lines, pagination                      |
| `fff_multi_grep`         | Multi-pattern OR (Aho-Corasick)     | patterns_joined (newline-separated), constraints                                |
| `fff_wait_for_scan`      | Block until initial scan completes  | timeout_ms                                                                      |
| `fff_get_scan_progress`  | Poll scan status                    | returns scanned/total/phase                                                     |
| `fff_track_query`        | Record query→selection for frecency | query, selected_path                                                            |
| `fff_destroy`            | Tear down instance                  | —                                                                               |

**"0 means default" convention:** For most numeric parameters, passing 0 uses the internal default. Check the C header comments for specifics.

## Wrapping Non-Critical FFI Calls

FFI calls that are not essential to the main user action (e.g., frecency tracking via `fff_track_query`) must be wrapped in try/catch. An unhandled FFI error — such as a koffi type mismatch or an unexpected return value — will throw and **block all subsequent code**, including the file-open or navigation logic that follows it.

```typescript
// Wrong — error in trackQuery prevents file from opening:
const inst = getInstance();
if (inst) {
  trackQuery(inst, quickPick.value, relativePaths[idx]);  // throws → file never opens
}
quickPick.hide();
await vscode.window.showTextDocument(fileUri);

// Right — non-critical FFI call wrapped:
const inst = getInstance();
if (inst) {
  try { trackQuery(inst, quickPick.value, relativePaths[idx]); } catch { /* non-critical */ }
}
quickPick.hide();
await vscode.window.showTextDocument(fileUri);
```

**Rule:** Any FFI call whose failure should not prevent the primary operation (open file, show results, navigate) belongs in a try/catch.

## Debugging VS Code Extension FFI Issues

When the extension silently shows no results, the `try/catch` blocks in `fileSearch.ts` and `grepSearch.ts` swallow errors. Add `console.error()` to the catch blocks, then:

1. Open the **Extension Dev Host** window (the second VS Code window from F5).
2. **Cmd+Shift+P** → `Developer: Toggle Developer Tools` — this opens Chrome DevTools.
3. Switch to the **Console** tab.
4. Trigger the search — all `console.log`/`console.error` output appears there.

**Important:** DevTools must be opened in the Extension Dev Host window, NOT the original VS Code window that launched it.

## ing Without VS Code

A standalone Node.js smoke lives at `extensions/vscode/scripts/-ffi.mjs`. It mirrors the exact koffi type definitions from `src/ffi.ts` and s create/search/destroy without needing VS Code or the Extension Dev Host. Run it anytime the FFI types change:

```bash
node extensions/vscode/scripts/-ffi.mjs
```

## VS Code Webview Scripts

Inline `<script>` tags are silently blocked in VS Code webviews. Use data URI scripts instead: `<script src="data:text/javascript;charset=utf-8,...">`. See the `vscode-webview-data-uri` skill for the full pattern.
