from __future__ import annotations

import asyncio
import math
import time
from typing import Any

from analyzer.analysis.engine import EmitFn

# ---------------------------------------------------------------------------
# User-friendly status messages per agent and event kind.
# Messages cycle: index = min(call_count - 1, len(messages) - 1).
# ---------------------------------------------------------------------------

AGENT_MESSAGES: dict[str, dict[str, list[str]]] = {
    "summary": {
        "LM_START": [
            "Reading repository structure",
            "Analyzing project configuration",
            "Understanding codebase purpose",
            "Writing summary",
        ],
        "TOOL_START": [
            "Scanning files",
            "Reading manifests",
            "Checking entrypoints",
        ],
    },
    "frameworks": {
        "LM_START": [
            "Scanning dependency manifests",
            "Detecting libraries and tools",
            "Classifying framework categories",
            "Verifying versions",
        ],
        "TOOL_START": [
            "Reading package files",
            "Searching for imports",
            "Cross-referencing dependencies",
        ],
    },
    "patterns": {
        "LM_START": [
            "Exploring project architecture",
            "Identifying design patterns",
            "Analyzing code organization",
            "Evaluating code quality",
            "Checking for AI agent rules",
        ],
        "TOOL_START": [
            "Scanning directory structure",
            "Reading configuration files",
            "Searching for patterns",
        ],
    },
    "insights": {
        "LM_START": [
            "Evaluating codebase health",
            "Identifying risks and gaps",
            "Assessing architecture decisions",
            "Generating recommendations",
        ],
        "TOOL_START": [
            "Checking test coverage",
            "Scanning for security concerns",
            "Analyzing deployment setup",
        ],
    },
    "functions": {
        "LM_START": [
            "Reading source files",
            "Identifying function definitions",
            "Analyzing function signatures",
            "Writing subgoal labels",
            "Assessing function complexity",
        ],
        "TOOL_START": [
            "Reading source code",
            "Scanning for function definitions",
            "Tracing function boundaries",
        ],
    },
}


def _friendly_message(agent_name: str, kind: str, call_count: int) -> str:
    """Pick a user-friendly message for the given agent/kind/call index."""
    messages = AGENT_MESSAGES.get(agent_name, {}).get(kind, [])
    if not messages:
        return f"Processing step {call_count}"
    idx = min(call_count - 1, len(messages) - 1)
    return messages[idx]


def _split_kind(message: str) -> tuple[str, str]:
    s = (message or "").strip()
    if not s:
        return "STATUS", ""
    head, sep, tail = s.partition(":")
    if sep and head and head.isupper():
        return head.strip(), tail.strip()
    return "STATUS", s


async def _aiter(obj: Any):  # type: ignore[no-untyped-def]
    if hasattr(obj, "__aiter__"):
        async for x in obj:
            yield x
        return
    for x in obj:
        yield x
        await asyncio.sleep(0)


def _get_streaming_types(dspy: Any) -> tuple[Any | None, Any | None, Any | None]:
    """
    Best-effort import across DSPy versions.

    Returns: (streamify_fn, StatusMessageProvider_base, StatusMessage_type)
    """
    streamify_fn = getattr(dspy, "streamify", None)
    try:
        from dspy.streaming import StatusMessage, StatusMessageProvider  # type: ignore

        if streamify_fn is None:
            try:
                from dspy.streaming import streamify as _streamify  # type: ignore

                streamify_fn = _streamify
            except Exception:
                streamify_fn = None
        return streamify_fn, StatusMessageProvider, StatusMessage
    except Exception:
        return None, None, None


async def run_sub_agent(
    *,
    dspy: Any,
    rlm: Any,
    repo_snapshot: Any,
    query: str,
    emit: EmitFn,
    phase: str,
    p_start: float,
    p_end: float,
    agent: str,
    max_llm_calls: int,
    step: int | None = None,
    step_total: int | None = None,
) -> Any:
    streamify_fn, StatusMessageProvider, StatusMessage = _get_streaming_types(dspy)

    async def _run_with_heartbeat() -> Any:
        async def _heartbeat() -> None:
            start = time.monotonic()
            while True:
                await asyncio.sleep(2.0)
                elapsed = time.monotonic() - start
                ratio = 1.0 - math.exp(-elapsed / 45.0)
                prog = p_start + (p_end - p_start) * ratio
                prog = min(p_end - 1e-6, prog)
                await emit(
                    phase,
                    float(prog),
                    "Still working\u2026",
                    agent=agent,
                    kind="HEARTBEAT",
                    step=step,
                    step_total=step_total,
                )

        hb = asyncio.create_task(_heartbeat())
        try:
            return await rlm.aforward(repo_snapshot=repo_snapshot, query=query)
        finally:
            hb.cancel()
            try:
                await hb
            except Exception:
                pass

    # DSPy's streamify() uses AnyIO task groups internally, which can cause
    # CancelledError cascades when multiple agents run concurrently under
    # asyncio.gather().  Disable the streaming path and use the heartbeat-only
    # fallback, which is simpler and works reliably with concurrent execution.
    #
    # The heartbeat mechanism still emits progress events every 2 s so the
    # frontend knows the agent is alive.
    return await _run_with_heartbeat()
