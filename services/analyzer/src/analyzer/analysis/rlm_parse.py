from __future__ import annotations

import json
from typing import Any

from analyzer.models import AnalysisResultData, Framework, Insight, Pattern

_ALLOWED_FRAMEWORK_CATEGORIES = {
    "language",
    "web",
    "backend",
    "build",
    "testing",
    "infra",
    "database",
    "orm",
    "ai",
    "observability",
    "api",
    "tooling",
    "unknown",
}


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def _as_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    return str(v)


def _parse_json_array(raw: Any, *, field: str) -> list[Any]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        s = _sanitize_json_text(raw)
        if not s:
            return []
        try:
            val = json.loads(s)
        except Exception as e:
            raise RuntimeError(f"RLM returned invalid JSON for {field}") from e
        if not isinstance(val, list):
            raise RuntimeError(f"RLM returned non-array JSON for {field}")
        return val
    raise RuntimeError(f"RLM returned unexpected type for {field}: {type(raw).__name__}")


def _sanitize_json_text(s: str) -> str:
    s = s.strip()
    if not s:
        return ""

    # Strip Markdown fences like ```json ... ```
    if s.startswith("```"):
        lines = s.splitlines()
        if lines and lines[0].lstrip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        s = "\n".join(lines).strip()

    # If the model included extra text, try to extract a JSON array substring.
    if s and not s.lstrip().startswith("["):
        i = s.find("[")
        j = s.rfind("]")
        if i != -1 and j != -1 and j > i:
            s = s[i : j + 1].strip()

    return s


def _normalize_evidence_paths(v: Any) -> list[str]:
    if v is None:
        return []
    if not isinstance(v, list):
        return []
    out: list[str] = []
    for item in v:
        if not isinstance(item, str):
            continue
        p = item.strip()
        if not p:
            continue
        # Keep repo-relative, POSIX-ish paths only.
        if p.startswith("/") or p.startswith("\\"):
            continue
        if "://" in p:
            continue
        # Avoid Windows drive paths like C:\...
        if len(p) >= 2 and p[1] == ":":
            continue
        out.append(p)
        if len(out) >= 50:
            break
    return out


def parse_analysis_result(
    *,
    summary: Any,
    frameworks_json: Any,
    patterns_json: Any,
    insights_json: Any,
) -> AnalysisResultData:
    frameworks_raw = _parse_json_array(frameworks_json, field="frameworks_json")
    patterns_raw = _parse_json_array(patterns_json, field="patterns_json")
    insights_raw = _parse_json_array(insights_json, field="insights_json")

    frameworks: list[Framework] = []
    for item in frameworks_raw:
        if not isinstance(item, dict):
            continue
        name = _as_str(item.get("name")).strip()
        if not name:
            continue
        version = _as_str(item.get("version")).strip()
        category = _as_str(item.get("category")).strip().lower() or "unknown"
        if category not in _ALLOWED_FRAMEWORK_CATEGORIES:
            category = "unknown"

        conf_v = item.get("confidence", 0.0)
        try:
            conf = _clamp01(float(conf_v))
        except Exception:
            conf = 0.0

        frameworks.append(Framework(name=name, version=version, category=category, confidence=conf))

    patterns: list[Pattern] = []
    for item in patterns_raw:
        if not isinstance(item, dict):
            continue
        name = _as_str(item.get("name")).strip()
        if not name:
            continue
        description = _as_str(item.get("description")).strip()
        evidence_paths = _normalize_evidence_paths(item.get("evidence_paths"))

        conf_v = item.get("confidence", 0.0)
        try:
            conf = _clamp01(float(conf_v))
        except Exception:
            conf = 0.0

        patterns.append(
            Pattern(
                name=name,
                description=description,
                evidence_paths=evidence_paths,
                confidence=conf,
            )
        )

    insights: list[Insight] = []
    for item in insights_raw:
        if not isinstance(item, dict):
            continue
        category = _as_str(item.get("category")).strip() or "unknown"
        title = _as_str(item.get("title")).strip()
        description = _as_str(item.get("description")).strip()
        if not title or not description:
            continue
        insights.append(Insight(category=category, title=title, description=description))

    frameworks.sort(key=lambda x: (-x.confidence, x.name))
    patterns.sort(key=lambda x: (-x.confidence, x.name))

    return AnalysisResultData(
        summary=_as_str(summary).strip(),
        frameworks=frameworks,
        patterns=patterns,
        insights=insights,
    )
