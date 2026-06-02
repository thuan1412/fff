/** Corresponds to FffResult envelope in fff-c. */
export interface FffResultEnvelope {
  success: boolean;
  /** Pointer to C error string, or null on success. */
  error: number | null;
  /** Opaque handle — cast to specific struct pointer. */
  handle: number | null;
  int_value: number;
}

/** Corresponds to FffFileItem in fff-c. */
export interface FffFileItem {
  relative_path: number; // *mut c_char
  file_name: number; // *mut c_char
  git_status: number; // *mut c_char
  size: number; // u64 via BigInt
  modified: number; // u64 via BigInt
  access_frecency_score: number; // i64
  modification_frecency_score: number; // i64
  total_frecency_score: number; // i64
  is_binary: boolean;
}

/** Corresponds to FffScore in fff-c. */
export interface FffScore {
  total: number;
  base_score: number;
  filename_bonus: number;
  special_filename_bonus: number;
  frecency_boost: number;
  distance_penalty: number;
  current_file_penalty: number;
  combo_match_boost: number;
  path_alignment_bonus: number;
  exact_match: boolean;
  match_type: number; // *mut c_char
}

/** Corresponds to FffMatchRange in fff-c. */
export interface FffMatchRange {
  start: number;
  end: number;
}

/** Corresponds to FffGrepMatch in fff-c. */
export interface FffGrepMatch {
  relative_path: number;
  file_name: number;
  git_status: number;
  line_content: number;
  match_ranges: number; // *mut FffMatchRange
  context_before: number; // *mut *mut c_char
  context_after: number; // *mut *mut c_char
  size: number;
  modified: number;
  total_frecency_score: number;
  access_frecency_score: number;
  modification_frecency_score: number;
  line_number: number;
  byte_offset: number;
  col: number;
  match_ranges_count: number;
  context_before_count: number;
  context_after_count: number;
  fuzzy_score: number;
  has_fuzzy_score: boolean;
  is_binary: boolean;
  is_definition: boolean;
}

/** Corresponds to FffSearchResult in fff-c. */
export interface FffSearchResult {
  items: number; // *mut FffFileItem
  scores: number; // *mut FffScore
  count: number;
  total_matched: number;
  total_files: number;
  location: FffLocation;
}

/** Corresponds to FffGrepResult in fff-c. */
export interface FffGrepResult {
  items: number; // *mut FffGrepMatch
  count: number;
  total_matched: number;
  total_files_searched: number;
  total_files: number;
  filtered_file_count: number;
  next_file_offset: number;
  regex_fallback_error: number;
}

/** Corresponds to FffLocation in fff-c. */
export interface FffLocation {
  tag: number;
  line: number;
  col: number;
  end_line: number;
  end_col: number;
}

/** Corresponds to FffScanProgress in fff-c. */
export interface FffScanProgress {
  scanned: number;
  total_estimate: number;
  phase: number; // 0=pending, 1=scanning, 2=processing, 3=done
}
