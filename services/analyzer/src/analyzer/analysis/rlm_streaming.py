from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from typing import Any

from analyzer.analysis.engine import EmitFn

logger = logging.getLogger(__name__)

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
        except BaseException:
            # Re-raise the original error; heartbeat cleanup must not mask it.
            raise
        finally:
            hb.cancel()
            with _suppress_all():
                await hb

    # DSPy's streamify() uses AnyIO task groups internally, which can cause
    # CancelledError cascades when multiple agents run concurrently under
    # asyncio.gather().  Disable the streaming path and use the heartbeat-only
    # fallback, which is simpler and works reliably with concurrent execution.
    #
    # The heartbeat mechanism still emits progress events every 2 s so the
    # frontend knows the agent is alive.
    return await _run_with_retry(
        _run_with_heartbeat,
        agent_name=agent,
        emit=emit,
        phase=phase,
        step=step,
        step_total=step_total,
    )


# ---------------------------------------------------------------------------
# Rate-limit / transient-error retry wrapper
# ---------------------------------------------------------------------------

_RETRY_AFTER_RE = re.compile(r"try again in (\d+(?:\.\d+)?)s", re.IGNORECASE)

# Default number of retries for rate-limit errors.
_RATE_LIMIT_RETRIES = 5
# Default fixed back-off in seconds when the server doesn't tell us how long
# to wait.  Grows by ``_BACKOFF_FACTOR`` each attempt.
_BACKOFF_BASE = 12.0
_BACKOFF_FACTOR = 1.5


def _is_rate_limit_error(exc: BaseException) -> bool:
    """Return True when *exc* looks like a rate-limit / 429 error."""
    name = type(exc).__name__
    if "RateLimit" in name:
        return True
    msg = str(exc)
    return "429" in msg or "rate_limit" in msg.lower() or "rate limit" in msg.lower()


def _parse_retry_after(exc: BaseException) -> float | None:
    """Try to extract a ``retry after X s`` hint from the error message."""
    m = _RETRY_AFTER_RE.search(str(exc))
    if m:
        return float(m.group(1))
    return None


async def _run_with_retry(
    fn,
    *,
    agent_name: str,
    emit: EmitFn,
    phase: str,
    step: int | None,
    step_total: int | None,
) -> Any:
    """Call *fn* with automatic retries on rate-limit errors."""
    last_exc: BaseException | None = None
    backoff = _BACKOFF_BASE
    for attempt in range(1, _RATE_LIMIT_RETRIES + 1):
        try:
            return await fn()
        except BaseException as exc:
            if not _is_rate_limit_error(exc):
                raise
            last_exc = exc
            if attempt == _RATE_LIMIT_RETRIES:
                raise
            wait = _parse_retry_after(exc) or backoff
            # Add a small buffer so the window has definitely rolled over.
            wait = wait + 2.0
            logger.warning(
                "Rate-limited on %s (attempt %d/%d), retrying in %.1fs: %s",
                agent_name, attempt, _RATE_LIMIT_RETRIES, wait, exc,
            )
            await emit(
                phase,
                0.0,
                f"Rate limited, retrying in {wait:.0f}s\u2026",
                agent=agent_name,
                kind="RATE_LIMIT",
                step=step,
                step_total=step_total,
            )
            await asyncio.sleep(wait)
            backoff *= _BACKOFF_FACTOR
    # Should be unreachable, but satisfy type-checkers.
    raise last_exc  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _suppress_all:
    """Context manager that suppresses *all* exceptions including BaseException.

    ``contextlib.suppress(BaseException)`` doesn't exist, so we roll our own
    tiny version.  Used exclusively to silence the CancelledError from the
    heartbeat task so it cannot mask whatever real error is propagating.
    """

    def __enter__(self):
        return self

    def __exit__(self, *_args: object) -> bool:
        return True
