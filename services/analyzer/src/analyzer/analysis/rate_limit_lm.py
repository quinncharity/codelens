"""Rate-limit-aware wrapper around ``dspy.LM``.

Groq's free tier has an 8 000 TPM (tokens-per-minute) limit.  LiteLLM's
built-in retry uses exponential back-off but with short waits that don't
outlast the rate-limit window.  This wrapper intercepts **every** individual
LLM call (both sync ``forward`` and async ``aforward``) and, on a
rate-limit / 429 error, sleeps for the duration the provider requests
(parsed from the error message) plus a small buffer.

The wrapper is intentionally a *thin* proxy that delegates to the real
``dspy.LM`` for everything else so it stays compatible across DSPy
versions.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MAX_RETRIES = 8
BACKOFF_BASE = 15.0      # seconds – first fallback if the server hint is missing
BACKOFF_FACTOR = 1.5     # multiplier per successive retry
BACKOFF_CAP = 90.0       # never wait longer than this
BUFFER = 2.0             # extra seconds on top of the server-requested wait

_RETRY_AFTER_RE = re.compile(r"try again in (\d+(?:\.\d+)?)s", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_rate_limit(exc: BaseException) -> bool:
    name = type(exc).__name__
    if "RateLimit" in name:
        return True
    msg = str(exc)
    return "429" in msg or "rate_limit" in msg.lower() or "rate limit" in msg.lower()


def _parse_wait(exc: BaseException) -> float | None:
    m = _RETRY_AFTER_RE.search(str(exc))
    return float(m.group(1)) if m else None


def _wait_time(exc: BaseException, fallback: float) -> float:
    hint = _parse_wait(exc)
    wait = (hint if hint is not None else fallback) + BUFFER
    return min(wait, BACKOFF_CAP)


# ---------------------------------------------------------------------------
# Wrapper
# ---------------------------------------------------------------------------

class RateLimitLM:
    """Drop-in wrapper around a ``dspy.LM`` that retries on rate-limit errors.

    It proxies **all** attribute access to the underlying LM so that DSPy
    sees it as the real thing (history, kwargs, model, etc.).
    """

    def __init__(self, inner):
        # Store on the instance dict directly to avoid __setattr__ recursion.
        object.__setattr__(self, "_inner", inner)

    # --- proxy everything except forward/aforward to the real LM -----------

    def __getattr__(self, name: str) -> Any:
        return getattr(object.__getattribute__(self, "_inner"), name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name == "_inner":
            object.__setattr__(self, name, value)
        else:
            setattr(object.__getattribute__(self, "_inner"), name, value)

    def __repr__(self) -> str:
        return repr(object.__getattribute__(self, "_inner"))

    # --- sync path ---------------------------------------------------------

    def forward(self, *args: Any, **kwargs: Any) -> Any:
        inner = object.__getattribute__(self, "_inner")
        backoff = BACKOFF_BASE
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return inner.forward(*args, **kwargs)
            except BaseException as exc:
                if not _is_rate_limit(exc) or attempt == MAX_RETRIES:
                    raise
                wait = _wait_time(exc, backoff)
                logger.warning(
                    "LM rate-limited (attempt %d/%d), sleeping %.1fs",
                    attempt, MAX_RETRIES, wait,
                )
                time.sleep(wait)
                backoff = min(backoff * BACKOFF_FACTOR, BACKOFF_CAP)
        raise RuntimeError("unreachable")  # pragma: no cover

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        inner = object.__getattribute__(self, "_inner")
        backoff = BACKOFF_BASE
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return inner(*args, **kwargs)
            except BaseException as exc:
                if not _is_rate_limit(exc) or attempt == MAX_RETRIES:
                    raise
                wait = _wait_time(exc, backoff)
                logger.warning(
                    "LM rate-limited (attempt %d/%d), sleeping %.1fs",
                    attempt, MAX_RETRIES, wait,
                )
                time.sleep(wait)
                backoff = min(backoff * BACKOFF_FACTOR, BACKOFF_CAP)
        raise RuntimeError("unreachable")  # pragma: no cover

    # --- async path --------------------------------------------------------

    async def aforward(self, *args: Any, **kwargs: Any) -> Any:
        inner = object.__getattribute__(self, "_inner")
        backoff = BACKOFF_BASE
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                return await inner.aforward(*args, **kwargs)
            except BaseException as exc:
                if not _is_rate_limit(exc) or attempt == MAX_RETRIES:
                    raise
                wait = _wait_time(exc, backoff)
                logger.warning(
                    "LM rate-limited (attempt %d/%d), sleeping %.1fs",
                    attempt, MAX_RETRIES, wait,
                )
                await asyncio.sleep(wait)
                backoff = min(backoff * BACKOFF_FACTOR, BACKOFF_CAP)
        raise RuntimeError("unreachable")  # pragma: no cover
