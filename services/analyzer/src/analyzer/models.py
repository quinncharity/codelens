from __future__ import annotations

import re as _re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

_ALLOWED_FRAMEWORK_CATEGORIES: set[str] = {
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

_ALLOWED_PATTERN_CATEGORIES: set[str] = {
    "architecture",
    "implementation",
    "quality",
    "ai_rule",
    "unknown",
}


# DSPy wraps string field values in triple-quotes and uses !!! as type delimiters.
# Strip those artifacts so they never appear in stored/displayed text.
_DSPY_ARTIFACTS = _re.compile(
    r'^[\s"\'!]+|[\s"\'!]+$'  # leading/trailing quotes, bangs, whitespace
)
_TRIPLE_QUOTE = _re.compile(r'^"{3,}|"{3,}$')
_TRIPLE_BANG = _re.compile(r'^!{2,}|!{2,}$')


def _clean_str(s: str) -> str:
    """Strip DSPy formatting artifacts from a string value."""
    # Iteratively strip triple-quote and triple-bang wrappers.
    for _ in range(5):
        prev = s
        s = _TRIPLE_QUOTE.sub("", s).strip()
        s = _TRIPLE_BANG.sub("", s).strip()
        if s == prev:
            break
    return s


def _as_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return _clean_str(v)
    return _clean_str(str(v))


def _clamp01(v: Any) -> float:
    try:
        x = float(v)
    except Exception:
        return 0.0
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


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
        if len(out) >= 8:
            break
    return out


class Framework(BaseModel):
    name: str = ""
    version: str = ""
    category: str = "unknown"
    confidence: float = 0.0

    model_config = ConfigDict(frozen=True, extra="ignore")

    @field_validator("name", "version", mode="before")
    @classmethod
    def _coerce_str_fields(cls, v: Any) -> str:
        return _as_str(v).strip()

    @field_validator("category", mode="before")
    @classmethod
    def _normalize_category(cls, v: Any) -> str:
        cat = _as_str(v).strip().lower()
        if not cat:
            return "unknown"
        if cat not in _ALLOWED_FRAMEWORK_CATEGORIES:
            return "unknown"
        return cat

    @field_validator("confidence", mode="before")
    @classmethod
    def _normalize_confidence(cls, v: Any) -> float:
        return _clamp01(v)


class Pattern(BaseModel):
    name: str = ""
    category: str = "unknown"
    description: str = ""
    evidence_paths: list[str] = Field(default_factory=list)
    confidence: float = 0.0

    model_config = ConfigDict(frozen=True, extra="ignore")

    @field_validator("name", "description", mode="before")
    @classmethod
    def _coerce_str_fields(cls, v: Any) -> str:
        return _as_str(v).strip()

    @field_validator("category", mode="before")
    @classmethod
    def _normalize_category(cls, v: Any) -> str:
        cat = _as_str(v).strip().lower()
        if not cat:
            return "unknown"
        if cat not in _ALLOWED_PATTERN_CATEGORIES:
            return "unknown"
        return cat

    @field_validator("evidence_paths", mode="before")
    @classmethod
    def _normalize_evidence_paths_validator(cls, v: Any) -> list[str]:
        return _normalize_evidence_paths(v)

    @field_validator("confidence", mode="before")
    @classmethod
    def _normalize_confidence(cls, v: Any) -> float:
        return _clamp01(v)


class Insight(BaseModel):
    category: str = "unknown"
    title: str = ""
    description: str = ""

    model_config = ConfigDict(frozen=True, extra="ignore")

    @field_validator("category", mode="before")
    @classmethod
    def _normalize_category(cls, v: Any) -> str:
        cat = _as_str(v).strip()
        return cat or "unknown"

    @field_validator("title", "description", mode="before")
    @classmethod
    def _coerce_str_fields(cls, v: Any) -> str:
        return _as_str(v).strip()


_ALLOWED_FILE_LAYERS: set[str] = {
    "presentation",
    "business",
    "data",
    "config",
    "test",
    "infra",
    "unknown",
}

_ALLOWED_MODULE_TYPES: set[str] = {
    "service",
    "module",
    "package",
    "library",
}


class FileDetail(BaseModel):
    path: str = ""
    purpose: str = ""
    layer: str = "unknown"

    model_config = ConfigDict(frozen=True, extra="ignore")

    @field_validator("path", "purpose", mode="before")
    @classmethod
    def _coerce_str_fields(cls, v: Any) -> str:
        return _as_str(v).strip()

    @field_validator("layer", mode="before")
    @classmethod
    def _normalize_layer(cls, v: Any) -> str:
        layer = _as_str(v).strip().lower()
        if not layer or layer not in _ALLOWED_FILE_LAYERS:
            return "unknown"
        return layer


class ServiceModule(BaseModel):
    name: str = ""
    description: str = ""
    module_type: str = "module"
    entry_points: list[str] = Field(default_factory=list)
    key_files: list[FileDetail] = Field(default_factory=list)
    depends_on: list[str] = Field(default_factory=list)

    model_config = ConfigDict(frozen=True, extra="ignore")

    @field_validator("name", "description", mode="before")
    @classmethod
    def _coerce_str_fields(cls, v: Any) -> str:
        return _as_str(v).strip()

    @field_validator("module_type", mode="before")
    @classmethod
    def _normalize_module_type(cls, v: Any) -> str:
        mt = _as_str(v).strip().lower()
        if not mt or mt not in _ALLOWED_MODULE_TYPES:
            return "module"
        return mt

    @field_validator("entry_points", mode="before")
    @classmethod
    def _normalize_entry_points(cls, v: Any) -> list[str]:
        return _normalize_evidence_paths(v)

    @field_validator("depends_on", mode="before")
    @classmethod
    def _normalize_depends_on(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if not isinstance(v, list):
            return []
        return [_as_str(x).strip() for x in v if _as_str(x).strip()][:20]


class AnalysisResultData(BaseModel):
    summary: str = ""
    frameworks: list[Framework] = Field(default_factory=list)
    patterns: list[Pattern] = Field(default_factory=list)
    insights: list[Insight] = Field(default_factory=list)
    services: list[ServiceModule] = Field(default_factory=list)

    model_config = ConfigDict(frozen=True, extra="ignore")

    @field_validator("summary", mode="before")
    @classmethod
    def _coerce_summary(cls, v: Any) -> str:
        return _as_str(v).strip()

    def to_json_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")

    @staticmethod
    def from_json_dict(data: dict[str, Any]) -> "AnalysisResultData":
        return AnalysisResultData.model_validate(data)

