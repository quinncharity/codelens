from __future__ import annotations

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


def _as_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    return str(v)


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


class AnalysisResultData(BaseModel):
    summary: str = ""
    frameworks: list[Framework] = Field(default_factory=list)
    patterns: list[Pattern] = Field(default_factory=list)
    insights: list[Insight] = Field(default_factory=list)

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

