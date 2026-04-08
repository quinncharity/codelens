import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep, basename, extname } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXCLUDE_DIRS = new Set([
  ".git", "node_modules", ".venv", "__pycache__", "dist",
  "build", ".next", ".turbo", ".cache",
]);

const MANIFEST_BASENAMES = new Set([
  "package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json",
  "turbo.json", "tsconfig.json", "tsconfig.base.json", "tsconfig.app.json",
  "tsconfig.build.json", "pyproject.toml", "requirements.txt",
  "requirements-dev.txt", "requirements-dev.in", "poetry.lock", "uv.lock",
  "pipfile", "pipfile.lock", "go.mod", "go.sum", "cargo.toml", "cargo.lock",
  "gemfile", "gemfile.lock", "composer.json", "composer.lock", "mix.exs",
  "mix.lock", "package.swift", "dockerfile", "docker-compose.yml",
  "docker-compose.yaml", "makefile", "justfile", "buf.yaml", "buf.gen.yaml",
  ".env.example", ".env.sample", ".env.template", ".gitignore",
  ".editorconfig", "readme.md", "readme.mdx", "architecture.md",
  "design.md", "decisions.md", "agents.md", "claude.md", "gemini.md",
  ".cursorrules", ".windsurfrules", "copilot-instructions.md",
]);

const MANIFEST_NAME_PREFIXES = ["dockerfile.", "docker-compose."];

const SENSITIVE_BASENAMES = new Set([
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "known_hosts", "authorized_keys",
]);

const SENSITIVE_SUFFIXES = new Set([
  ".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".der",
  ".jks", ".keystore", ".sqlite", ".db",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".exe", ".dll", ".so", ".dylib", ".o", ".a",
  ".pyc", ".pyo", ".class", ".jar", ".war",
  ".mp3", ".mp4", ".avi", ".mov", ".wav", ".flac",
  ".sqlite", ".db", ".wasm",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotFile {
  path: string;
  bytes: number;
  truncated: boolean;
  content: string;
}

export interface RepoSnapshot {
  version: number;
  meta: { repo_name: string; generated_at: string };
  tree: {
    file_count_indexed: number;
    paths_sample: string[];
    top_level: string[];
    excluded_dirs: string[];
  };
  manifests: SnapshotFile[];
  snippets: SnapshotFile[];
  limits: {
    max_bytes: number;
    max_files: number;
    max_tree_paths: number;
    max_manifests: number;
    max_snippets: number;
    per_file_max_bytes: number;
    snippet_max_bytes: number;
  };
  budget_remaining_bytes: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSensitivePath(relPath: string): boolean {
  const name = relPath.split("/").pop()!.toLowerCase();
  if (SENSITIVE_BASENAMES.has(name)) return true;
  if ([...SENSITIVE_SUFFIXES].some((suf) => name.endsWith(suf))) return true;
  if (name === ".env") return true;
  if (name.startsWith(".env.") && !["example", "sample", "template"].some((x) => name.includes(x))) return true;
  if (`/${relPath.toLowerCase()}/`.includes("/.ssh/")) return true;
  return false;
}

function isProbablyBinary(data: Buffer): boolean {
  if (!data.length) return false;
  return data.includes(0);
}

function readText(absPath: string, maxBytes: number): { content: string; truncated: boolean } {
  try {
    const buf = readFileSync(absPath);
    const truncated = buf.length > maxBytes;
    const slice = buf.subarray(0, maxBytes);
    if (isProbablyBinary(slice)) return { content: "", truncated };
    return { content: slice.toString("utf8"), truncated };
  } catch {
    return { content: "", truncated: false };
  }
}

function walkFiles(root: string, maxFiles: number): string[] {
  const out: string[] = [];

  function walk(dir: string): void {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (e.isDirectory()) {
        if (!EXCLUDE_DIRS.has(e.name)) walk(join(dir, e.name));
      } else {
        out.push(join(dir, e.name));
      }
    }
  }

  walk(root);
  return out;
}

function matchesManifestName(name: string): boolean {
  const lower = name.toLowerCase();
  if (MANIFEST_BASENAMES.has(lower)) return true;
  if (MANIFEST_NAME_PREFIXES.some((p) => lower.startsWith(p))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Build snapshot
// ---------------------------------------------------------------------------

export function buildRepoSnapshot(
  repoRoot: string,
  opts: { maxBytes?: number } = {},
): RepoSnapshot {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const maxFiles = 20_000;
  const maxTreePaths = 5_000;
  const maxManifests = 200;
  const maxSnippets = 20;
  const perFileMaxBytes = 200_000;
  const snippetMaxBytes = 20_000;

  const files = walkFiles(repoRoot, maxFiles);
  const relPaths = files
    .map((f) => relative(repoRoot, f).split(sep).join("/"))
    .sort();

  // Top-level entries
  const topLevel: string[] = [];
  const seen = new Set<string>();
  for (const rp of relPaths) {
    const head = rp.split("/")[0]!;
    if (!seen.has(head)) {
      seen.add(head);
      topLevel.push(head);
    }
    if (topLevel.length >= 50) break;
  }

  // Manifest candidates
  let manifestCandidates: string[] = [];
  for (const rp of relPaths) {
    const name = rp.split("/").pop()!;
    const lower = name.toLowerCase();
    if (matchesManifestName(name)) {
      manifestCandidates.push(rp);
      continue;
    }
    // Config globs
    for (const prefix of ["vite.config.", "next.config.", "nuxt.config.", "svelte.config."]) {
      if (lower.startsWith(prefix)) {
        manifestCandidates.push(rp);
        break;
      }
    }
    if (lower.endsWith(".proto")) manifestCandidates.push(rp);
    if (rp.toLowerCase().startsWith(".github/workflows/") && (lower.endsWith(".yml") || lower.endsWith(".yaml"))) {
      manifestCandidates.push(rp);
    }
    if (rp.toLowerCase() === ".github/copilot-instructions.md") manifestCandidates.push(rp);
    if (rp.toLowerCase().startsWith(".github/instructions/") && (lower.endsWith(".md") || lower.endsWith(".txt"))) {
      manifestCandidates.push(rp);
    }
    if (rp.toLowerCase().startsWith(".cursor/") && [".md", ".txt", ".json", ".yml", ".yaml"].some((e) => lower.endsWith(e))) {
      manifestCandidates.push(rp);
    }
  }
  manifestCandidates = [...new Set(manifestCandidates)]
    .sort((a, b) => (a.split("/").length - b.split("/").length) || a.localeCompare(b))
    .slice(0, maxManifests);

  // Snippet candidates
  const entryNames = new Set(["main.py", "app.py", "manage.py", "server.py"]);
  const entryPrefixes = ["main.", "index.", "app.", "server.", "cli."];
  const entrySuffixes = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs"];
  let snippetCandidates: string[] = [];
  for (const rp of relPaths) {
    const name = rp.split("/").pop()!;
    const lower = name.toLowerCase();
    if (entryNames.has(lower)) { snippetCandidates.push(rp); continue; }
    if (entryPrefixes.some((p) => lower.startsWith(p)) && entrySuffixes.some((s) => lower.endsWith(s))) {
      snippetCandidates.push(rp);
    }
  }
  snippetCandidates = [...new Set(snippetCandidates)]
    .sort((a, b) => (a.split("/").length - b.split("/").length) || a.localeCompare(b))
    .slice(0, maxSnippets);

  // Budget tracking
  let remaining = maxBytes;
  function take(n: number): number {
    if (remaining <= 0) return 0;
    const actual = Math.max(0, Math.min(remaining, n));
    remaining -= actual;
    return actual;
  }

  // Read manifests
  const manifests: SnapshotFile[] = [];
  for (const rp of manifestCandidates) {
    if (remaining <= 0) break;
    if (isSensitivePath(rp)) continue;
    const absPath = join(repoRoot, rp);
    const want = Math.min(perFileMaxBytes, remaining);
    const { content, truncated } = readText(absPath, want);
    if (!content) continue;
    const charged = take(Buffer.byteLength(content, "utf8"));
    if (charged <= 0) break;
    manifests.push({ path: rp, bytes: charged, truncated, content });
  }

  // Read snippets
  const snippets: SnapshotFile[] = [];
  for (const rp of snippetCandidates) {
    if (remaining <= 0) break;
    if (isSensitivePath(rp)) continue;
    const absPath = join(repoRoot, rp);
    const want = Math.min(snippetMaxBytes, remaining);
    const { content, truncated } = readText(absPath, want);
    if (!content) continue;
    const charged = take(Buffer.byteLength(content, "utf8"));
    if (charged <= 0) break;
    snippets.push({ path: rp, bytes: charged, truncated, content });
  }

  return {
    version: 1,
    meta: {
      repo_name: basename(repoRoot),
      generated_at: new Date().toISOString(),
    },
    tree: {
      file_count_indexed: relPaths.length,
      paths_sample: relPaths.slice(0, maxTreePaths),
      top_level: topLevel,
      excluded_dirs: [...EXCLUDE_DIRS].sort(),
    },
    manifests,
    snippets,
    limits: {
      max_bytes: maxBytes,
      max_files: maxFiles,
      max_tree_paths: maxTreePaths,
      max_manifests: maxManifests,
      max_snippets: maxSnippets,
      per_file_max_bytes: perFileMaxBytes,
      snippet_max_bytes: snippetMaxBytes,
    },
    budget_remaining_bytes: remaining,
  };
}
