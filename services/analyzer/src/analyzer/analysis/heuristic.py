from __future__ import annotations

import json
import os
import re
import tomllib
from dataclasses import replace
from pathlib import Path

from analyzer.analysis.engine import EmitFn
from analyzer.models import AnalysisResultData, Framework

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


def _walk(repo_root: Path, *, max_files: int = 20000) -> list[Path]:
    out: list[Path] = []
    for root, dirs, files in os.walk(repo_root):
        dirs[:] = [d for d in dirs if d not in _EXCLUDE_DIRS]
        for f in files:
            out.append(Path(root) / f)
            if len(out) >= max_files:
                return out
    return out


def _read_text(path: Path, *, max_bytes: int = 200_000) -> str:
    try:
        with path.open("rb") as fp:
            data = fp.read(max_bytes)
        return data.decode("utf-8", "replace")
    except Exception:
        return ""


def _parse_requirements(txt: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in txt.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-"):
            continue
        m = re.match(r"^([A-Za-z0-9_.-]+)(==([A-Za-z0-9_.-]+))?", line)
        if not m:
            continue
        name = m.group(1)
        version = m.group(3) or ""
        out[name.lower()] = version
    return out


def _frameworks_from_node_package_json(path: Path) -> list[Framework]:
    txt = _read_text(path)
    try:
        pkg = json.loads(txt)
    except Exception:
        return []

    deps: dict[str, str] = {}
    for key in ("dependencies", "devDependencies", "peerDependencies"):
        v = pkg.get(key)
        if isinstance(v, dict):
            deps.update({str(k).lower(): str(val) for k, val in v.items()})

    def has(name: str) -> tuple[bool, str]:
        return (name.lower() in deps, deps.get(name.lower(), ""))

    frameworks: list[Framework] = []
    for name, category in [
        ("react", "web"),
        ("next", "web"),
        ("@tanstack/start", "web"),
        ("@tanstack/react-router", "web"),
        ("vite", "build"),
        ("vitest", "testing"),
        ("jest", "testing"),
        ("eslint", "quality"),
        ("typescript", "build"),
        ("tailwindcss", "web"),
        ("express", "web"),
        ("fastify", "web"),
        ("nestjs", "web"),
    ]:
        ok, ver = has(name)
        if ok:
            frameworks.append(
                Framework(name=name, version=ver, category=category, confidence=0.9)
            )

    # monorepo hints
    if pkg.get("workspaces") is not None:
        frameworks.append(Framework(name="workspaces", version="", category="build", confidence=0.6))

    return frameworks


def _frameworks_from_pyproject(path: Path) -> list[Framework]:
    data = _read_text(path)
    try:
        doc = tomllib.loads(data)
    except Exception:
        return []

    deps: set[str] = set()
    proj = doc.get("project")
    if isinstance(proj, dict):
        for d in proj.get("dependencies", []) or []:
            if isinstance(d, str):
                deps.add(d.split()[0].split(">")[0].split("=")[0].lower())

    poetry = doc.get("tool", {}).get("poetry") if isinstance(doc.get("tool"), dict) else None
    if isinstance(poetry, dict):
        pdeps = poetry.get("dependencies")
        if isinstance(pdeps, dict):
            deps.update({str(k).lower() for k in pdeps.keys()})

    frameworks: list[Framework] = []
    for name, category in [
        ("django", "web"),
        ("fastapi", "web"),
        ("flask", "web"),
        ("sqlalchemy", "orm"),
        ("pydantic", "core"),
        ("pytest", "testing"),
        ("dspy", "ai"),
    ]:
        if name in deps:
            frameworks.append(Framework(name=name, version="", category=category, confidence=0.85))

    return frameworks


async def analyze(repo_root: Path, emit: EmitFn) -> AnalysisResultData:
    await emit("INDEX", 0.0, "Scanning repository")
    files = _walk(repo_root)
    await emit("INDEX", 0.2, f"Indexed {len(files)} files (capped)")

    frameworks: list[Framework] = []

    # Prefer root-level manifests if present.
    root_pkg = repo_root / "package.json"
    if root_pkg.exists():
        await emit("ANALYZE", 0.3, "Parsing package.json")
        frameworks.extend(_frameworks_from_node_package_json(root_pkg))

    pyproject = repo_root / "pyproject.toml"
    if pyproject.exists():
        await emit("ANALYZE", 0.4, "Parsing pyproject.toml")
        frameworks.extend(_frameworks_from_pyproject(pyproject))

    req = repo_root / "requirements.txt"
    if req.exists():
        await emit("ANALYZE", 0.45, "Parsing requirements.txt")
        deps = _parse_requirements(_read_text(req))
        for name, category in [
            ("django", "web"),
            ("fastapi", "web"),
            ("flask", "web"),
            ("sqlalchemy", "orm"),
            ("pytest", "testing"),
        ]:
            if name in deps:
                frameworks.append(
                    Framework(name=name, version=deps.get(name, ""), category=category, confidence=0.8)
                )

    # Deduplicate by name.
    uniq: dict[str, Framework] = {}
    for f in frameworks:
        prev = uniq.get(f.name)
        if prev is None:
            uniq[f.name] = f
        else:
            # Keep the "best" confidence; keep version if we have one.
            ver = prev.version or f.version
            conf = max(prev.confidence, f.confidence)
            uniq[f.name] = replace(prev, version=ver, confidence=conf)

    out = list(uniq.values())
    out.sort(key=lambda x: (-x.confidence, x.name))

    names = ", ".join([f.name for f in out[:10]]) or "none"
    summary = f"Detected frameworks (heuristic): {names}"
    await emit("ANALYZE", 0.9, "Assembling result")

    return AnalysisResultData(summary=summary, frameworks=out, patterns=[], insights=[])

