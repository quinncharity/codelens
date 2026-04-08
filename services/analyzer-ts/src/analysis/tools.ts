import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import type { RepoSnapshot } from "../repo-snapshot.js";

const READ_REPO_FILE_MAX_BYTES = 50_000;
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
// Snapshot-based tools
// ---------------------------------------------------------------------------

function asSnapshotDict(snapshot: unknown): Record<string, unknown> {
  if (typeof snapshot === "object" && snapshot !== null) return snapshot as Record<string, unknown>;
  throw new TypeError("repo_snapshot must be an object");
}

export function listFiles(snapshot: unknown, pattern?: string): string {
  const data = asSnapshotDict(snapshot);
  const paths: string[] = [];

  const tree = data.tree as Record<string, unknown> | undefined;
  if (tree) {
    const ps = tree.paths_sample;
    if (Array.isArray(ps)) paths.push(...ps.filter((p): p is string => typeof p === "string"));
  }

  for (const section of ["manifests", "snippets"] as const) {
    const items = data[section];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item !== "object" || !item) continue;
      const p = (item as Record<string, unknown>).path;
      if (typeof p === "string" && p) paths.push(p);
    }
  }

  const seen = new Set<string>();
  let out: string[] = [];
  for (const p of [...paths].sort()) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }

  if (pattern) {
    const pat = pattern.trim().toLowerCase();
    if (pat) {
      out = out.filter((p) => {
        // Simple glob: *.ext or **/*.ext
        if (pat.startsWith("*.")) {
          const ext = pat.slice(1);
          return p.toLowerCase().endsWith(ext);
        }
        return p.toLowerCase().includes(pat);
      });
    }
  }

  return out.slice(0, 200).join("\n");
}

export function getFileContent(snapshot: unknown, path: string): string {
  const data = asSnapshotDict(snapshot);
  const want = (path || "").trim();
  if (!want) return "NOT_FOUND";

  for (const section of ["manifests", "snippets"] as const) {
    const items = data[section];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item !== "object" || !item) continue;
      const rec = item as Record<string, unknown>;
      if (rec.path !== want) continue;
      const content = rec.content;
      return typeof content === "string" ? content : "";
    }
  }

  return "NOT_FOUND";
}

export function searchFiles(snapshot: unknown, keyword: string): string {
  const data = asSnapshotDict(snapshot);
  const needle = (keyword || "").trim().toLowerCase();
  if (!needle) return "[]";

  const matches: Array<{ path: string; line_num: number; line: string }> = [];
  for (const section of ["manifests", "snippets"] as const) {
    const items = data[section];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item !== "object" || !item) continue;
      const rec = item as Record<string, unknown>;
      const path = rec.path;
      const content = rec.content;
      if (typeof path !== "string" || typeof content !== "string") continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.toLowerCase().includes(needle)) {
          matches.push({ path, line_num: i + 1, line: lines[i]!.trim().slice(0, 120) });
          if (matches.length >= 50) return JSON.stringify(matches);
        }
      }
    }
  }

  return JSON.stringify(matches);
}

export function makeReadRepoFile(repoRoot: string): (path: string) => string {
  const resolvedRoot = resolve(repoRoot);

  return function readRepoFile(path: string): string {
    const want = (path || "").trim();
    if (!want) return "ERROR: empty path";

    const target = resolve(resolvedRoot, want);
    if (!target.startsWith(resolvedRoot)) return "ERROR: path escapes repo root";

    if (!existsSync(target)) return "NOT_FOUND";

    if (BINARY_EXTENSIONS.has(extname(target).toLowerCase())) {
      return `BINARY_FILE: ${want} (skipped)`;
    }

    try {
      const raw = readFileSync(target);
      const slice = raw.subarray(0, READ_REPO_FILE_MAX_BYTES);
      return slice.toString("utf8");
    } catch (e) {
      return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
}
