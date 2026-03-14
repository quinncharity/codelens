from __future__ import annotations

import json
import logging
from pathlib import Path, PurePosixPath
from typing import Any

from analyzer.analysis.repo_snapshot import RepoSnapshot

logger = logging.getLogger(__name__)

_READ_REPO_FILE_MAX_BYTES = 50_000
_BINARY_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp", ".svg",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".exe", ".dll", ".so", ".dylib", ".o", ".a",
    ".pyc", ".pyo", ".class", ".jar", ".war",
    ".mp3", ".mp4", ".avi", ".mov", ".wav", ".flac",
    ".sqlite", ".db", ".wasm",
})


def _as_snapshot_dict(snapshot: Any) -> dict[str, Any]:
    """
    Accept either a RepoSnapshot model or a JSON-compatible dict.
    """
    if isinstance(snapshot, RepoSnapshot):
        return snapshot.model_dump(mode="json")
    if isinstance(snapshot, dict):
        return snapshot
    if isinstance(snapshot, str):
        raise TypeError("repo_snapshot must be a dict/RepoSnapshot; JSON strings are no longer supported")
    raise TypeError(f"repo_snapshot must be a dict/RepoSnapshot, got {type(snapshot).__name__}")


def list_files(repo_snapshot: Any, pattern: str | None = None) -> str:
    """
    List file paths in the snapshot (tree sample + manifest/snippet paths), optionally filtered.

    Args:
        repo_snapshot: The RepoSnapshot (or a JSON-compatible dict).
        pattern: Optional glob pattern like '*.py' or 'src/**/*.ts'.

    Returns:
        Newline-separated matching paths (capped).
    """
    data = _as_snapshot_dict(repo_snapshot)

    paths: list[str] = []

    tree = data.get("tree")
    if isinstance(tree, dict):
        ps = tree.get("paths_sample")
        if isinstance(ps, list):
            paths.extend([p for p in ps if isinstance(p, str)])

    for section in ("manifests", "snippets"):
        items = data.get(section)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            p = item.get("path")
            if isinstance(p, str) and p:
                paths.append(p)

    # De-dupe while preserving sort order for nicer UX in the REPL.
    seen: set[str] = set()
    out: list[str] = []
    for p in sorted(paths):
        if p in seen:
            continue
        seen.add(p)
        out.append(p)

    if pattern:
        pat = pattern.strip()
        if pat:
            out = [p for p in out if PurePosixPath(p).match(pat)]

    return "\n".join(out[:200])


def get_file_content(repo_snapshot: Any, path: str) -> str:
    """
    Retrieve the content of a specific file from the snapshot.

    Note: the snapshot only includes full contents for selected manifests/configs
    and selected code snippets (not arbitrary files).
    """
    data = _as_snapshot_dict(repo_snapshot)
    want = (path or "").strip()
    if not want:
        return "NOT_FOUND"

    for section in ("manifests", "snippets"):
        items = data.get(section)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("path") != want:
                continue
            content = item.get("content")
            return content if isinstance(content, str) else ""

    return "NOT_FOUND"


def search_files(repo_snapshot: Any, keyword: str) -> str:
    """
    Case-insensitive substring search across snapshot contents (manifests + snippets).

    Returns a JSON array of {path, line_num, line} (capped).
    """
    data = _as_snapshot_dict(repo_snapshot)
    needle = (keyword or "").strip().lower()
    if not needle:
        return "[]"

    matches: list[dict[str, Any]] = []
    for section in ("manifests", "snippets"):
        items = data.get(section)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            path = item.get("path")
            content = item.get("content")
            if not isinstance(path, str) or not isinstance(content, str):
                continue
            for i, line in enumerate(content.splitlines(), 1):
                if needle in line.lower():
                    matches.append(
                        {
                            "path": path,
                            "line_num": i,
                            "line": line.strip()[:120],
                        }
                    )
                    if len(matches) >= 50:
                        return json.dumps(matches, ensure_ascii=True)

    return json.dumps(matches, ensure_ascii=True)


def make_read_repo_file(repo_root: Path):
    """Factory that returns a read_repo_file tool bound to a specific repo checkout."""

    resolved_root = repo_root.resolve()

    def read_repo_file(path: str) -> str:
        """Read any file from the cloned repository by its repo-relative path.

        Unlike get_file_content (which only reads pre-loaded snapshot files),
        this tool can read ANY file in the repo. Use it to explore source code
        in depth when you need to understand what a specific file does.

        Args:
            path: Repo-relative path, e.g. 'src/analyzer/server.py'.

        Returns:
            The file content (up to 50KB), or an error string.
        """
        want = (path or "").strip()
        if not want:
            return "ERROR: empty path"

        target = (resolved_root / want).resolve()
        if not str(target).startswith(str(resolved_root)):
            return "ERROR: path escapes repo root"

        if not target.is_file():
            return "NOT_FOUND"

        if target.suffix.lower() in _BINARY_EXTENSIONS:
            return f"BINARY_FILE: {want} (skipped)"

        try:
            raw = target.read_bytes()
        except OSError as exc:
            return f"ERROR: {exc}"

        if len(raw) > _READ_REPO_FILE_MAX_BYTES:
            raw = raw[:_READ_REPO_FILE_MAX_BYTES]

        try:
            return raw.decode("utf-8", errors="replace")
        except Exception:
            return f"BINARY_FILE: {want} (decode failed)"

    return read_repo_file
