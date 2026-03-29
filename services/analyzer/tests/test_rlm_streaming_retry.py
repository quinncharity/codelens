"""Tests for rlm_streaming heartbeat cleanup and RateLimitLM retry logic."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest

from analyzer.analysis.rlm_streaming import (
    _suppress_all,
    run_sub_agent,
)
from analyzer.analysis.rate_limit_lm import (
    RateLimitLM,
    _is_rate_limit,
    _parse_wait,
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
# Fake LM for testing RateLimitLM
# ---------------------------------------------------------------------------

class _FakeLM:
    """Mimics a dspy.LM with controllable side effects.

    Does NOT subclass BaseLM — RateLimitLM's ``__init__`` accepts any object
    that quacks like a LM.
    """

    def __init__(self, *, async_effects=None, sync_effects=None, call_effects=None):
        self._async_effects = async_effects or []
        self._sync_effects = sync_effects or []
        self._call_effects = call_effects or []
        self.model = "test/fake"
        self.kwargs = {"temperature": 0.0}
        self.history = []
        self.aforward_count = 0
        self.forward_count = 0
        self.call_count = 0

    async def aforward(self, **kwargs: Any) -> Any:
        self.aforward_count += 1
        if self._async_effects:
            e = self._async_effects.pop(0)
            if isinstance(e, BaseException):
                raise e
            return e
        return {"text": "ok"}

    def forward(self, **kwargs: Any) -> Any:
        self.forward_count += 1
        if self._sync_effects:
            e = self._sync_effects.pop(0)
            if isinstance(e, BaseException):
                raise e
            return e
        return {"text": "ok"}

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self.call_count += 1
        if self._call_effects:
            e = self._call_effects.pop(0)
            if isinstance(e, BaseException):
                raise e
            return e
        return [{"text": "ok"}]


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
# rate_limit_lm helpers
# ---------------------------------------------------------------------------


def test_is_rate_limit_class_name():
    class RateLimitError(Exception):
        pass

    assert _is_rate_limit(RateLimitError("boom"))


def test_is_rate_limit_429_in_message():
    assert _is_rate_limit(Exception("HTTP 429 Too Many Requests"))


def test_is_rate_limit_rate_limit_in_message():
    assert _is_rate_limit(
        Exception('{"code":"rate_limit_exceeded"}')
    )


def test_is_rate_limit_negative():
    assert not _is_rate_limit(Exception("something else"))


def test_parse_wait_with_seconds():
    exc = Exception("Rate limit hit. Please try again in 9.51s.")
    assert _parse_wait(exc) == pytest.approx(9.51)


def test_parse_wait_integer():
    exc = Exception("try again in 12s")
    assert _parse_wait(exc) == pytest.approx(12.0)


def test_parse_wait_missing():
    assert _parse_wait(Exception("no hint")) is None


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
# RateLimitLM — async path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rate_limit_lm_aforward_retries_on_rate_limit():
    """aforward retries on rate-limit then succeeds."""

    class FakeRateLimitError(Exception):
        pass

    FakeRateLimitError.__name__ = "RateLimitError"

    ok_response = {"text": "success"}
    inner = _FakeLM(async_effects=[
        FakeRateLimitError("try again in 0.05s"),
        ok_response,
    ])
    lm = RateLimitLM(inner)
    result = await lm.aforward(prompt="hello")
    assert result == ok_response
    assert inner.aforward_count == 2


@pytest.mark.asyncio
async def test_rate_limit_lm_aforward_non_rate_limit_not_retried():
    """Non-rate-limit errors propagate immediately."""
    inner = _FakeLM(async_effects=[ValueError("bad")])
    lm = RateLimitLM(inner)

    with pytest.raises(ValueError, match="bad"):
        await lm.aforward(prompt="hello")

    assert inner.aforward_count == 1


@pytest.mark.asyncio
async def test_rate_limit_lm_aforward_exhausts_retries():
    """All retries exhausted -> the rate-limit error propagates."""

    class FakeRateLimitError(Exception):
        pass

    FakeRateLimitError.__name__ = "RateLimitError"

    # More errors than MAX_RETRIES
    inner = _FakeLM(async_effects=[
        FakeRateLimitError("try again in 0.01s") for _ in range(20)
    ])
    lm = RateLimitLM(inner)

    with pytest.raises(Exception, match="try again"):
        await lm.aforward(prompt="hello")


# ---------------------------------------------------------------------------
# RateLimitLM — sync path
# ---------------------------------------------------------------------------


def test_rate_limit_lm_forward_retries():
    """forward (sync) retries on rate-limit then succeeds."""

    class FakeRateLimitError(Exception):
        pass

    FakeRateLimitError.__name__ = "RateLimitError"

    ok_response = {"text": "success"}
    inner = _FakeLM(sync_effects=[
        FakeRateLimitError("try again in 0.05s"),
        ok_response,
    ])
    lm = RateLimitLM(inner)
    result = lm.forward(prompt="hello")
    assert result == ok_response
    assert inner.forward_count == 2


def test_rate_limit_lm_call_retries():
    """__call__ (sync) retries on rate-limit then succeeds."""

    class FakeRateLimitError(Exception):
        pass

    FakeRateLimitError.__name__ = "RateLimitError"

    ok_response = [{"text": "success"}]
    inner = _FakeLM(call_effects=[
        FakeRateLimitError("try again in 0.05s"),
        ok_response,
    ])
    lm = RateLimitLM(inner)
    result = lm("hello")
    assert result == ok_response
    assert inner.call_count == 2


# ---------------------------------------------------------------------------
# RateLimitLM — attribute proxying
# ---------------------------------------------------------------------------


def test_rate_limit_lm_proxies_attributes():
    """RateLimitLM transparently proxies attribute access to the inner LM."""
    inner = _FakeLM()
    lm = RateLimitLM(inner)

    assert lm.model == "test/fake"
    assert lm.kwargs == {"temperature": 0.0}
    assert lm.history == []

    # Setting on the wrapper should set on the inner LM
    lm.history = [{"test": True}]
    assert inner.history == [{"test": True}]


@pytest.mark.asyncio
async def test_rate_limit_lm_parses_groq_hint():
    """The LM wrapper should parse Groq-style 'try again in Xs' hint."""

    class FakeRateLimitError(Exception):
        pass

    FakeRateLimitError.__name__ = "RateLimitError"

    groq_msg = (
        'RateLimitError: GroqException - {"error":{"message":"Rate limit reached '
        'for model. Please try again in 0.05s.","code":"rate_limit_exceeded"}}'
    )
    ok = {"text": "ok"}
    inner = _FakeLM(async_effects=[FakeRateLimitError(groq_msg), ok])
    lm = RateLimitLM(inner)
    result = await lm.aforward(prompt="hello")
    assert result == ok
    assert inner.aforward_count == 2
