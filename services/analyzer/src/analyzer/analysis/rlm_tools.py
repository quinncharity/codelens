from __future__ import annotations

import json
from pathlib import PurePosixPath
from typing import Any

from analyzer.analysis.repo_snapshot import RepoSnapshot


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
