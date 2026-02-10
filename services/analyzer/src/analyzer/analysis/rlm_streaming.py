from __future__ import annotations

import asyncio
import math
import time
from typing import Any

from analyzer.analysis.engine import EmitFn


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
    repo_snapshot: str,
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
                    f"Running... ({int(elapsed)}s elapsed, max_calls={max_llm_calls})",
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

    if streamify_fn and StatusMessageProvider and StatusMessage:

        class AnalysisStatusProvider(StatusMessageProvider):  # type: ignore[misc,valid-type]
            def __init__(self) -> None:
                self.lm_calls = 0

            def lm_start_status_message(self, instance, inputs):  # type: ignore[no-untyped-def]
                self.lm_calls += 1
                return f"LM_START: LM call #{self.lm_calls}"

            def lm_end_status_message(self, outputs):  # type: ignore[no-untyped-def]
                return f"LM_END: LM call #{self.lm_calls} complete"

            def tool_start_status_message(self, instance, inputs):  # type: ignore[no-untyped-def]
                name = getattr(instance, "name", None)
                if not name:
                    name = getattr(getattr(instance, "__class__", None), "__name__", None) or "tool"
                return f"TOOL_START: {name}"

            def tool_end_status_message(self, outputs):  # type: ignore[no-untyped-def]
                return "TOOL_END: tool complete"

        try:
            provider = AnalysisStatusProvider()
            stream_rlm = streamify_fn(rlm, status_message_provider=provider)

            pred: Any | None = None
            last_obj: Any | None = None
            stream = stream_rlm(repo_snapshot=repo_snapshot, query=query)
            async for chunk in _aiter(stream):
                if hasattr(dspy, "Prediction") and isinstance(chunk, dspy.Prediction):
                    pred = chunk
                    continue
                if isinstance(chunk, StatusMessage):
                    kind, msg = _split_kind(getattr(chunk, "message", "") or "")
                    calls = max(0, int(getattr(provider, "lm_calls", 0)))
                    frac = min(0.95, calls / max(1, int(max_llm_calls)))
                    prog = p_start + (p_end - p_start) * frac
                    await emit(
                        phase,
                        float(prog),
                        msg,
                        agent=agent,
                        kind=kind,
                        step=step,
                        step_total=step_total,
                    )
                    continue
                last_obj = chunk

            if pred is None:
                # Some DSPy versions might not yield a Prediction chunk. If we saw
                # a non-status object, treat it as the final prediction-like value
                # (best-effort) rather than re-running the agent.
                if last_obj is not None and hasattr(last_obj, "__dict__"):
                    return last_obj
                return await _run_with_heartbeat()
            return pred
        except Exception:
            # Streaming is best-effort; keep the analysis working even if DSPy's
            # streaming APIs differ across versions.
            return await _run_with_heartbeat()

    return await _run_with_heartbeat()
