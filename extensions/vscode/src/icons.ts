import * as vscode from "vscode";

/** Maps file extension to Seti SVG icon name (without .svg). */
export const extensionIconMap: Record<string, string> = {
  // ── Web ──
  ts: "typescript",
  tsx: "react",
  js: "javascript",
  jsx: "react",
  mjs: "javascript",
  cjs: "javascript",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  less: "less",
  sass: "css",

  // ── Config / data ──
  json: "json",
  jsonc: "json",
  yaml: "config",
  yml: "config",
  toml: "config",
  ini: "config",
  cfg: "config",
  env: "config",
  graphql: "graphql",
  gql: "graphql",
  proto: "config",
  xml: "xml",
  csv: "csv",

  // ── Documentation ──
  md: "markdown",
  mdx: "markdown",
  mdwn: "markdown",
  mdown: "markdown",
  txt: "default",
  rst: "default",
  pdf: "pdf",
  adoc: "default",
  tex: "tex",

  // ── Languages ──
  rs: "rust",
  py: "python",
  pyi: "python",
  pyx: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  hh: "cpp",
  cs: "c-sharp",
  fsharp: "default",
  fs: "default",
  scala: "scala",
  clj: "default",
  cljs: "default",
  edn: "default",
  elm: "elm",
  ex: "elixir",
  exs: "elixir",
  erl: "default",
  hs: "haskell",
  lhs: "haskell",
  ml: "default",
  mli: "default",
  zig: "default",
  nim: "default",
  dart: "dart",
  lua: "lua",
  php: "php",
  pl: "default",
  pm: "default",
  r: "R",
  rmd: "R",
  jl: "default",
  sql: "db",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "shell",
  bat: "shell",
  cmd: "shell",
  vue: "vue",
  svelte: "svelte",
  prisma: "prisma",
  res: "rescript",
  resi: "rescript",
  purs: "purescript",

  // ── Images / assets ──
  svg: "image",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  ico: "image",
  webp: "image",
  mp4: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  ttf: "font",
  woff: "font",
  woff2: "font",
  eot: "font",
  otf: "font",
};

export const fileNameIconMap: Record<string, string> = {
  "dockerfile": "docker",
  "docker-compose.yml": "docker",
  "docker-compose.yaml": "docker",
  "makefile": "makefile",
  "cmakelists.txt": "makefile",
  "justfile": "makefile",
  "license": "license",
  "license.md": "license",
  "license.txt": "license",
  "readme.md": "markdown",
  "readme": "markdown",
  "changelog.md": "clock",
  "changelog": "clock",
  "package.json": "json",
  "package-lock.json": "lock",
  "cargo.toml": "rust",
  "cargo.lock": "lock",
  "go.mod": "go",
  "go.sum": "lock",
  "gemfile": "ruby",
  "gemfile.lock": "lock",
  "pyproject.toml": "python",
  "setup.py": "python",
  "setup.cfg": "python",
  ".gitignore": "git_ignore",
  ".gitattributes": "git",
  ".gitmodules": "git",
  ".editorconfig": "editorconfig",
  ".prettierrc": "config",
  ".prettierrc.json": "json",
  ".eslintrc": "eslint",
  ".eslintrc.json": "json",
  ".eslintrc.js": "eslint",
  ".eslintrc.cjs": "eslint",
  ".babelrc": "babel",
  "babel.config.js": "babel",
  "babel.config.cjs": "babel",
  "tsconfig.json": "typescript",
  "jsconfig.json": "javascript",
  "tailwind.config.js": "css",
  "tailwind.config.ts": "css",
  "postcss.config.js": "css",
  "vite.config.ts": "typescript",
  "vite.config.js": "javascript",
  "webpack.config.js": "webpack",
  "webpack.config.cjs": "webpack",
  "next.config.js": "javascript",
  "next.config.ts": "typescript",
  "next.config.mjs": "javascript",
};

/** Returns the Seti icon filename (without extension/.svg) for a file. */
export function iconName(fileName: string): string {
  const lower = fileName.toLowerCase();

  const mapped = fileNameIconMap[lower];
  if (mapped) return mapped;

  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.substring(dot + 1) : "";

  if (ext && extensionIconMap[ext]) {
    return extensionIconMap[ext];
  }

  if (lower.startsWith(".")) return "config";

  return "default";
}

/**
 * Builds an icon URI pair for QuickPick iconPath.
 * Returns { light, dark } pointing to the same SVG (Seti icons are self-colored).
 */
export function iconPathUri(
  extensionUri: vscode.Uri,
  fileName: string,
): { light: vscode.Uri; dark: vscode.Uri } {
  const icon = iconName(fileName) + ".svg";
  const uri = vscode.Uri.joinPath(extensionUri, "resources", "icons", icon);
  return { light: uri, dark: uri };
}
