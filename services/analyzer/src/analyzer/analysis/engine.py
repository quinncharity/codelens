from __future__ import annotations

from pathlib import Path
from typing import Protocol

from analyzer.models import AnalysisResultData


class EmitFn(Protocol):
    async def __call__(
        self,
        phase: str,
        progress: float,
        message: str,
        *,
        agent: str | None = None,
        kind: str | None = None,
        step: int | None = None,
        step_total: int | None = None,
    ) -> None: ...


class AnalyzerEngine(Protocol):
    async def analyze(self, repo_root: Path, emit: EmitFn) -> AnalysisResultData: ...
