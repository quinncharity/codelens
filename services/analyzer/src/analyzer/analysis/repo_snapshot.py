from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

_EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "__pycache__",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
}

_MANIFEST_BASENAMES = {
    # JS/TS
    "package.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "package-lock.json",
    "turbo.json",
    "tsconfig.json",
    "tsconfig.base.json",
    "tsconfig.app.json",
    "tsconfig.build.json",
    # Python
    "pyproject.toml",
    "requirements.txt",
    "requirements-dev.txt",
    "requirements-dev.in",
    "poetry.lock",
    "uv.lock",
    "pipfile",
    "pipfile.lock",
    # Go
    "go.mod",
    "go.sum",
    # Rust
    "cargo.toml",
    "cargo.lock",
    # Ruby
    "gemfile",
    "gemfile.lock",
    # PHP
    "composer.json",
    "composer.lock",
    # Elixir
    "mix.exs",
    "mix.lock",
    # Swift
    "package.swift",
    # Misc
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "makefile",
    "justfile",
    "buf.yaml",
    "buf.gen.yaml",
    ".env.example",
    ".env.sample",
    ".env.template",
    ".gitignore",
    ".editorconfig",
    # Docs (architecture/usage signals)
    "readme.md",
    "readme.mdx",
    "architecture.md",
    "design.md",
    "decisions.md",
    # Agent / AI instruction files
    "agents.md",
    "claude.md",
    "gemini.md",
    ".cursorrules",
    ".windsurfrules",
    "copilot-instructions.md",
}

_MANIFEST_NAME_PREFIXES = [
    "dockerfile.",  # Dockerfile.dev, etc.
    "docker-compose.",  # docker-compose.dev.yml
]

_MANIFEST_NAME_GLOBS = [
    "vite.config.*",
    "next.config.*",
    "nuxt.config.*",
    "svelte.config.*",
]

_SENSITIVE_BASENAMES = {
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "known_hosts",
    "authorized_keys",
}

_SENSITIVE_SUFFIXES = {
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".crt",
    ".cer",
    ".der",
    ".jks",
    ".keystore",
    ".sqlite",
    ".db",
}


@dataclass
class _Budget:
    remaining: int

    def take(self, n: int) -> int:
        if self.remaining <= 0:
            return 0
        n = max(0, min(self.remaining, n))
        self.remaining -= n
        return n


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _walk_files(repo_root: Path, *, max_files: int) -> list[Path]:
    out: list[Path] = []
    for root, dirs, files in os.walk(repo_root):
        dirs[:] = [d for d in dirs if d not in _EXCLUDE_DIRS]
        for f in files:
            out.append(Path(root) / f)
            if len(out) >= max_files:
                return out
    return out


def _rel(repo_root: Path, path: Path) -> str:
    return str(path.relative_to(repo_root)).replace(os.sep, "/")


def _is_sensitive_path(rel_path: str) -> bool:
    name = rel_path.rsplit("/", 1)[-1]
    lower = name.lower()

    if lower in _SENSITIVE_BASENAMES:
        return True

    if any(lower.endswith(suf) for suf in _SENSITIVE_SUFFIXES):
        return True

    # Do not include real env files, but allow common non-secret templates.
    if lower == ".env":
        return True
    if lower.startswith(".env.") and not any(x in lower for x in ("example", "sample", "template")):
        return True

    # Avoid grabbing private SSH config, etc.
    if "/.ssh/" in f"/{rel_path.lower()}/":
        return True

    return False


def _is_probably_binary(data: bytes) -> bool:
    if not data:
        return False
    # Heuristic: NUL bytes are a strong signal for binary.
    if b"\x00" in data:
        return True
    return False


def _read_text(path: Path, *, max_bytes: int) -> tuple[str, bool]:
    try:
        with path.open("rb") as fp:
            data = fp.read(max_bytes + 1)
        truncated = len(data) > max_bytes
        data = data[:max_bytes]
        if _is_probably_binary(data):
            return ("", truncated)
        return (data.decode("utf-8", "replace"), truncated)
    except Exception:
        return ("", False)


def _matches_manifest_name(name: str) -> bool:
    lower = name.lower()
    if lower in _MANIFEST_BASENAMES:
        return True
    if any(lower.startswith(p) for p in _MANIFEST_NAME_PREFIXES):
        return True
    return False


def build_repo_snapshot(
    repo_root: Path,
    *,
    max_bytes: int = 2_000_000,
    max_files: int = 20_000,
    max_tree_paths: int = 5_000,
    max_manifests: int = 200,
    max_snippets: int = 20,
    per_file_max_bytes: int = 200_000,
    snippet_max_bytes: int = 20_000,
) -> str:
    """
    Build a JSON snapshot of a repository suitable for an RLM to explore.

    The snapshot is "manifest-focused": it includes a file tree sample plus raw
    contents of key manifests/configs and short snippets of likely entrypoints.
    """

    files = _walk_files(repo_root, max_files=max_files)
    rel_paths = [_rel(repo_root, p) for p in files]
    rel_paths.sort()

    top_level: list[str] = []
    seen = set()
    for rp in rel_paths:
        head = rp.split("/", 1)[0]
        if head not in seen:
            seen.add(head)
            top_level.append(head)
        if len(top_level) >= 50:
            break

    # Manifest candidates: prioritize shallow paths, include common config globs.
    manifest_candidates: list[str] = []
    for rp in rel_paths:
        name = rp.rsplit("/", 1)[-1]
        if _matches_manifest_name(name):
            manifest_candidates.append(rp)
            continue
        # Common config globs (vite/next/etc.)
        for pat in _MANIFEST_NAME_GLOBS:
            # crude glob match for "*": check prefix and at least one char after
            # e.g. "vite.config." + something
            if pat.endswith(".*"):
                prefix = pat[:-2]
                if name.lower().startswith(prefix):
                    manifest_candidates.append(rp)
                    break

        # Buf/proto contracts: include .proto sources.
        if name.lower().endswith(".proto"):
            manifest_candidates.append(rp)

        # CI workflows can provide important build hints.
        if rp.lower().startswith(".github/workflows/") and name.lower().endswith((".yml", ".yaml")):
            manifest_candidates.append(rp)

        # AI/agent instructions can significantly affect how code should be read/modified.
        if rp.lower() == ".github/copilot-instructions.md":
            manifest_candidates.append(rp)
        if rp.lower().startswith(".github/instructions/") and name.lower().endswith((".md", ".txt")):
            manifest_candidates.append(rp)
        if rp.lower().startswith(".cursor/") and name.lower().endswith((".md", ".txt", ".json", ".yml", ".yaml")):
            manifest_candidates.append(rp)

    # De-dupe, keep shallow paths first.
    manifest_candidates = sorted(set(manifest_candidates), key=lambda x: (x.count("/"), x))
    manifest_candidates = manifest_candidates[:max_manifests]

    # Snippet candidates: common entrypoints. Prefer shallow paths.
    snippet_candidates: list[str] = []
    for rp in rel_paths:
        name = rp.rsplit("/", 1)[-1]
        lower = name.lower()
        if lower in {"main.py", "app.py", "manage.py", "server.py"}:
            snippet_candidates.append(rp)
            continue
        if lower.startswith(("main.", "index.", "app.", "server.", "cli.")) and lower.endswith(
            (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs")
        ):
            snippet_candidates.append(rp)
            continue
    snippet_candidates = sorted(set(snippet_candidates), key=lambda x: (x.count("/"), x))
    snippet_candidates = snippet_candidates[:max_snippets]

    budget = _Budget(remaining=max_bytes)

    manifests: list[dict[str, object]] = []
    for rp in manifest_candidates:
        if budget.remaining <= 0:
            break
        if _is_sensitive_path(rp):
            continue
        abs_path = repo_root / rp
        # Use a per-file cap but also enforce the global budget.
        want = min(per_file_max_bytes, budget.remaining)
        content, truncated = _read_text(abs_path, max_bytes=want)
        if not content:
            continue
        # Charge against budget based on utf-8 size (roughly tracks JSON size too).
        charged = budget.take(len(content.encode("utf-8", "replace")))
        if charged <= 0:
            break
        manifests.append(
            {
                "path": rp,
                "bytes": charged,
                "truncated": bool(truncated) or (charged < len(content.encode("utf-8", "replace"))),
                "content": content,
            }
        )

    snippets: list[dict[str, object]] = []
    for rp in snippet_candidates:
        if budget.remaining <= 0:
            break
        if _is_sensitive_path(rp):
            continue
        abs_path = repo_root / rp
        want = min(snippet_max_bytes, budget.remaining)
        content, truncated = _read_text(abs_path, max_bytes=want)
        if not content:
            continue
        charged = budget.take(len(content.encode("utf-8", "replace")))
        if charged <= 0:
            break
        snippets.append(
            {
                "path": rp,
                "bytes": charged,
                "truncated": bool(truncated) or (charged < len(content.encode("utf-8", "replace"))),
                "content": content,
            }
        )

    snapshot: dict[str, object] = {
        "version": 1,
        "meta": {
            "repo_name": repo_root.name,
            "generated_at": _now_iso(),
        },
        "tree": {
            "file_count_indexed": len(rel_paths),
            "paths_sample": rel_paths[:max_tree_paths],
            "top_level": top_level,
            "excluded_dirs": sorted(_EXCLUDE_DIRS),
        },
        "manifests": manifests,
        "snippets": snippets,
        "limits": {
            "max_bytes": max_bytes,
            "max_files": max_files,
            "max_tree_paths": max_tree_paths,
            "max_manifests": max_manifests,
            "max_snippets": max_snippets,
            "per_file_max_bytes": per_file_max_bytes,
            "snippet_max_bytes": snippet_max_bytes,
        },
        "budget_remaining_bytes": budget.remaining,
    }

    def _dump() -> str:
        return json.dumps(snapshot, ensure_ascii=True, separators=(",", ":"))

    payload = _dump()
    if len(payload) <= max_bytes:
        return payload

    # Enforce a hard cap on the *serialized* snapshot size (best-effort).
    # Strategy: progressively drop least-important data while keeping JSON valid.
    tree = snapshot.get("tree")
    paths_sample: list[str] = []
    if isinstance(tree, dict):
        ps = tree.get("paths_sample")
        if isinstance(ps, list):
            paths_sample = [str(x) for x in ps if isinstance(x, str)]
            tree["paths_sample"] = paths_sample

    manifests_list = snapshot.get("manifests")
    snippets_list = snapshot.get("snippets")
    manifests: list[dict[str, object]] = (
        manifests_list if isinstance(manifests_list, list) else []
    )  # type: ignore[assignment]
    snippets: list[dict[str, object]] = (
        snippets_list if isinstance(snippets_list, list) else []
    )  # type: ignore[assignment]

    # Drop items until within limit or everything is empty.
    for _ in range(50_000):
        payload = _dump()
        if len(payload) <= max_bytes:
            break

        if paths_sample:
            # If the tree dominates, shrink it aggressively.
            if len(paths_sample) > 200:
                del paths_sample[len(paths_sample) // 2 :]
            else:
                paths_sample.pop()
            continue

        if snippets:
            snippets.pop()
            continue

        if manifests:
            manifests.pop()
            continue

        # Nothing left to drop.
        break

    return _dump()
