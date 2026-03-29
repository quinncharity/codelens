"""Tests for rlm_streaming: heartbeat cleanup and rate-limit retry logic."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock

import pytest

from analyzer.analysis.rlm_streaming import (
    _is_rate_limit_error,
    _parse_retry_after,
    _suppress_all,
    run_sub_agent,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FakeRLM:
    """Minimal RLM stub whose ``aforward`` can be controlled via *side_effect*."""

    def __init__(self, side_effect=None, return_value=None):
        self._side_effect = side_effect
        self._return_value = return_value
        self.call_count = 0

    async def aforward(self, **kwargs: Any) -> Any:
        self.call_count += 1
        if self._side_effect is not None:
            effect = self._side_effect
            if isinstance(effect, list):
                e = effect.pop(0)
                if isinstance(e, BaseException):
                    raise e
                return e
            if isinstance(effect, BaseException):
                raise effect
        return self._return_value


class _FakePrediction:
    def __init__(self, **attrs: Any):
        for k, v in attrs.items():
            setattr(self, k, v)


class _FakeDspy:
    """Just enough to satisfy ``_get_streaming_types``."""

    streamify = None


async def _noop_emit(*args: Any, **kwargs: Any) -> None:
    pass


# ---------------------------------------------------------------------------
# _suppress_all
# ---------------------------------------------------------------------------


def test_suppress_all_catches_base_exception():
    with _suppress_all():
        raise KeyboardInterrupt("should be suppressed")


def test_suppress_all_catches_regular_exception():
    with _suppress_all():
        raise ValueError("should be suppressed")


# ---------------------------------------------------------------------------
# _is_rate_limit_error
# ---------------------------------------------------------------------------


def test_is_rate_limit_error_class_name():
    class RateLimitError(Exception):
        pass

    assert _is_rate_limit_error(RateLimitError("boom"))


def test_is_rate_limit_error_429_in_message():
    assert _is_rate_limit_error(Exception("HTTP 429 Too Many Requests"))


def test_is_rate_limit_error_rate_limit_in_message():
    assert _is_rate_limit_error(
        Exception('{"code":"rate_limit_exceeded"}')
    )


def test_is_rate_limit_error_negative():
    assert not _is_rate_limit_error(Exception("something else"))


# ---------------------------------------------------------------------------
# _parse_retry_after
# ---------------------------------------------------------------------------


def test_parse_retry_after_with_seconds():
    exc = Exception("Rate limit hit. Please try again in 9.51s.")
    assert _parse_retry_after(exc) == pytest.approx(9.51)


def test_parse_retry_after_integer():
    exc = Exception("try again in 12s")
    assert _parse_retry_after(exc) == pytest.approx(12.0)


def test_parse_retry_after_missing():
    assert _parse_retry_after(Exception("no hint")) is None


# ---------------------------------------------------------------------------
# Heartbeat cleanup: real error must not be masked by CancelledError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_heartbeat_does_not_mask_real_error():
    """When rlm.aforward raises, the *original* error must propagate — not CancelledError."""
    original = RuntimeError("LLM provider exploded")
    rlm = _FakeRLM(side_effect=original)

    with pytest.raises(RuntimeError, match="LLM provider exploded"):
        await run_sub_agent(
            dspy=_FakeDspy(),
            rlm=rlm,
            repo_snapshot={},
            query="test",
            emit=_noop_emit,
            phase="ANALYZE",
            p_start=0.0,
            p_end=1.0,
            agent="test",
            max_llm_calls=5,
        )


@pytest.mark.asyncio
async def test_heartbeat_normal_success():
    """Happy path: heartbeat runs, agent succeeds, heartbeat is cleanly cancelled."""
    pred = _FakePrediction(summary="Hello world")
    rlm = _FakeRLM(return_value=pred)

    result = await run_sub_agent(
        dspy=_FakeDspy(),
        rlm=rlm,
        repo_snapshot={},
        query="test",
        emit=_noop_emit,
        phase="ANALYZE",
        p_start=0.0,
        p_end=1.0,
        agent="test",
        max_llm_calls=5,
    )
    assert result is pred


# ---------------------------------------------------------------------------
# Rate-limit retry logic
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_retry_on_rate_limit_succeeds():
    """First call rate-limited, second call succeeds."""
    pred = _FakePrediction(summary="ok")

    class FakeRateLimitError(Exception):
        pass

    FakeRateLimitError.__name__ = "RateLimitError"

    rlm = _FakeRLM(side_effect=[FakeRateLimitError("try again in 0.1s"), pred])

    emitted: list[dict] = []

    async def spy_emit(*args: Any, **kwargs: Any) -> None:
        emitted.append({"args": args, "kwargs": kwargs})

    result = await run_sub_agent(
        dspy=_FakeDspy(),
        rlm=rlm,
        repo_snapshot={},
        query="test",
        emit=spy_emit,
        phase="ANALYZE",
        p_start=0.0,
        p_end=1.0,
        agent="test",
        max_llm_calls=5,
    )
    assert result is pred
    # Should have emitted a RATE_LIMIT event
    rate_limit_events = [
        e for e in emitted if e["kwargs"].get("kind") == "RATE_LIMIT"
    ]
    assert len(rate_limit_events) == 1


@pytest.mark.asyncio
async def test_retry_exhausted_raises_real_error():
    """All retries exhausted — the *rate-limit* error propagates, not CancelledError."""

    class FakeRateLimitError(Exception):
        pass

    FakeRateLimitError.__name__ = "RateLimitError"

    rlm = _FakeRLM(side_effect=FakeRateLimitError("try again in 0.05s"))

    with pytest.raises(Exception, match="try again in 0.05s"):
        await run_sub_agent(
            dspy=_FakeDspy(),
            rlm=rlm,
            repo_snapshot={},
            query="test",
            emit=_noop_emit,
            phase="ANALYZE",
            p_start=0.0,
            p_end=1.0,
            agent="test",
            max_llm_calls=5,
        )


@pytest.mark.asyncio
async def test_non_rate_limit_error_not_retried():
    """Non-rate-limit errors should propagate immediately, no retries."""
    rlm = _FakeRLM(side_effect=ValueError("bad input"))

    with pytest.raises(ValueError, match="bad input"):
        await run_sub_agent(
            dspy=_FakeDspy(),
            rlm=rlm,
            repo_snapshot={},
            query="test",
            emit=_noop_emit,
            phase="ANALYZE",
            p_start=0.0,
            p_end=1.0,
            agent="test",
            max_llm_calls=5,
        )

    assert rlm.call_count == 1


@pytest.mark.asyncio
async def test_retry_parses_retry_after_from_groq_error():
    """The retry logic should parse the Groq-style 'try again in Xs' hint."""
    pred = _FakePrediction(summary="ok")

    class FakeRateLimitError(Exception):
        pass

    FakeRateLimitError.__name__ = "RateLimitError"

    groq_msg = (
        'RateLimitError: GroqException - {"error":{"message":"Rate limit reached '
        'for model. Please try again in 0.1s.","code":"rate_limit_exceeded"}}'
    )
    rlm = _FakeRLM(side_effect=[FakeRateLimitError(groq_msg), pred])

    result = await run_sub_agent(
        dspy=_FakeDspy(),
        rlm=rlm,
        repo_snapshot={},
        query="test",
        emit=_noop_emit,
        phase="ANALYZE",
        p_start=0.0,
        p_end=1.0,
        agent="test",
        max_llm_calls=5,
    )
    assert result is pred
