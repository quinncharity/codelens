from __future__ import annotations

from typing import Any

import dspy  # type: ignore

from analyzer.models import Framework, FunctionDetail, Insight, Pattern, ServiceModule


class SummarySignature(dspy.Signature):
    """Summarize a repo snapshot."""

    repo_snapshot: dict[str, Any] = dspy.InputField(desc="Repository snapshot (tree + selected file contents).")
    query: str = dspy.InputField(desc="Task instructions.")

    summary: str = dspy.OutputField(desc="1-4 sentence summary of the repository.")


class FrameworksSignature(dspy.Signature):
    """Identify frameworks and libraries used in the repo."""

    repo_snapshot: dict[str, Any] = dspy.InputField(desc="Repository snapshot (tree + selected file contents).")
    query: str = dspy.InputField(desc="Task instructions.")

    frameworks: list[Framework] = dspy.OutputField(desc="Detected frameworks/libraries (high-signal only).")


class PatternsSignature(dspy.Signature):
    """Identify architecture/implementation/quality/AI-rule patterns in the repo."""

    repo_snapshot: dict[str, Any] = dspy.InputField(desc="Repository snapshot (tree + selected file contents).")
    query: str = dspy.InputField(desc="Task instructions.")

    patterns: list[Pattern] = dspy.OutputField(desc="Detected patterns with evidence paths.")


class InsightsSignature(dspy.Signature):
    """Generate actionable insights about the repo."""

    repo_snapshot: dict[str, Any] = dspy.InputField(desc="Repository snapshot (tree + selected file contents).")
    query: str = dspy.InputField(desc="Task instructions.")

    insights: list[Insight] = dspy.OutputField(desc="Up to 10 high-signal insights.")


class ArchitectureSignature(dspy.Signature):
    """Map the architecture of a repo into logical services/modules with file-level detail."""

    repo_snapshot: dict[str, Any] = dspy.InputField(desc="Repository snapshot (tree + selected file contents).")
    query: str = dspy.InputField(desc="Task instructions.")

    services: list[ServiceModule] = dspy.OutputField(
        desc="Logical services/modules with key files, entry points, and dependencies."
    )


class FunctionsSignature(dspy.Signature):
    """Extract functions/methods from source files and generate educational subgoal labels."""

    repo_snapshot: dict[str, Any] = dspy.InputField(desc="Repository snapshot (tree + selected file contents).")
    query: str = dspy.InputField(desc="Task instructions including the list of files to analyze.")

    functions: list[FunctionDetail] = dspy.OutputField(
        desc="Functions/methods with signatures, line ranges, and plain-English subgoal labels."
    )

