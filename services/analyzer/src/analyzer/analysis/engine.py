from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Protocol

from analyzer.models import AnalysisResultData

EmitFn = Callable[[str, float, str], Awaitable[None]]


class AnalyzerEngine(Protocol):
    async def analyze(self, repo_root: Path, emit: EmitFn) -> AnalysisResultData: ...

