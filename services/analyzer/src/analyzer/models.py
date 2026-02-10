from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class Framework:
    name: str
    version: str = ""
    category: str = ""
    confidence: float = 0.0


@dataclass(frozen=True)
class Pattern:
    name: str
    category: str = ""
    description: str = ""
    evidence_paths: list[str] = field(default_factory=list)
    confidence: float = 0.0


@dataclass(frozen=True)
class Insight:
    category: str
    title: str
    description: str


@dataclass(frozen=True)
class AnalysisResultData:
    summary: str
    frameworks: list[Framework] = field(default_factory=list)
    patterns: list[Pattern] = field(default_factory=list)
    insights: list[Insight] = field(default_factory=list)

    def to_json_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_json_dict(data: dict[str, Any]) -> "AnalysisResultData":
        frameworks = [Framework(**x) for x in data.get("frameworks", [])]
        patterns = [Pattern(**x) for x in data.get("patterns", [])]
        insights = [Insight(**x) for x in data.get("insights", [])]
        return AnalysisResultData(
            summary=str(data.get("summary", "")),
            frameworks=frameworks,
            patterns=patterns,
            insights=insights,
        )
