from __future__ import annotations

import os
from pathlib import Path

from analyzer.analysis.engine import EmitFn
from analyzer.models import AnalysisResultData


class RLMEngine:
    async def analyze(self, repo_root: Path, emit: EmitFn) -> AnalysisResultData:
        await emit("ANALYZE", 0.1, "Initializing RLM engine")

        try:
            import dspy  # type: ignore
        except Exception as e:  # pragma: no cover
            raise RuntimeError(
                "DSPy is not installed. Install it and set CODELENS_ENGINE=rlm."
            ) from e

        if not hasattr(dspy, "RLM"):
            raise RuntimeError("Installed dspy does not expose dspy.RLM")

        lm = os.environ.get("CODELENS_DSPY_LM")
        if not lm:
            raise RuntimeError("Missing CODELENS_DSPY_LM (e.g. provider/model)")

        await emit("ANALYZE", 0.2, "RLM engine is not fully implemented (scaffold)")
        # v1 scaffold: keep the interface, but return an explicit placeholder.
        return AnalysisResultData(
            summary="RLM engine scaffolded but not implemented yet. Use heuristic engine for now.",
            frameworks=[],
            patterns=[],
            insights=[],
        )

