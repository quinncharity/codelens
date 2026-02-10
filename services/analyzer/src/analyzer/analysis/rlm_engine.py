from __future__ import annotations

import asyncio
import contextlib
import math
import os
import shutil
import subprocess
import time
from functools import lru_cache
from pathlib import Path

from analyzer.analysis.engine import EmitFn
from analyzer.analysis.repo_snapshot import build_repo_snapshot
from analyzer.analysis.rlm_parse import parse_analysis_result
from analyzer.models import AnalysisResultData


class RLMEngine:
    async def analyze(self, repo_root: Path, emit: EmitFn) -> AnalysisResultData:
        await emit("ANALYZE", 0.05, "Initializing RLM engine")

        try:
            import dspy  # type: ignore
        except Exception as e:  # pragma: no cover
            raise RuntimeError(
                "DSPy is not installed. Install it (e.g. `pip install dspy`)."
            ) from e

        if not hasattr(dspy, "RLM"):
            raise RuntimeError(
                "Installed dspy does not expose dspy.RLM. Upgrade to a recent dspy release."
            )

        if shutil.which("deno") is None:
            raise RuntimeError(
                "Deno is required for dspy.RLM's default sandbox (Pyodide/WASM). "
                "Install Deno and ensure `deno` is on PATH. "
                "If you're working in this repo, you can use `mise install` (or `mise install deno`)."
            )

        lm = os.environ.get("CODELENS_DSPY_LM")
        if not lm:
            raise RuntimeError("Missing CODELENS_DSPY_LM (e.g. provider/model)")
        _validate_provider_env(lm)

        await emit("INDEX", 0.1, "Building repository snapshot")
        snapshot_max_bytes = _env_int("CODELENS_RLM_SNAPSHOT_MAX_BYTES", 2_000_000)
        snapshot = build_repo_snapshot(repo_root, max_bytes=snapshot_max_bytes)
        await emit("INDEX", 0.25, f"Snapshot built ({len(snapshot)} bytes)")

        await emit("ANALYZE", 0.35, "Configuring DSPy")
        temperature = _env_float("CODELENS_DSPY_TEMPERATURE", 0.0)
        main_lm = _make_lm(dspy, lm, temperature=temperature)

        sub_lm_name = os.environ.get("CODELENS_DSPY_SUB_LM", "").strip()
        if sub_lm_name:
            _validate_provider_env(sub_lm_name)
        sub_lm = _make_lm(dspy, sub_lm_name, temperature=0.0) if sub_lm_name else None

        max_iterations = _env_int("CODELENS_RLM_MAX_ITERATIONS", 8)
        max_llm_calls = _env_int("CODELENS_RLM_MAX_LLM_CALLS", 25)
        max_output_chars = _env_int("CODELENS_RLM_MAX_OUTPUT_CHARS", 100_000)
        verbose = _env_bool("CODELENS_RLM_VERBOSE", False)

        # DSPy's global configuration is bound to the first asyncio task that calls
        # `dspy.configure`. This analyzer runs one asyncio task per job, so we must
        # avoid calling `configure` here and instead use a per-task context.
        #
        # Using `dspy.context(...)` keeps analyses isolated (and unblocks concurrent jobs).
        dspy_ctx = (
            dspy.context(lm=main_lm)
            if hasattr(dspy, "context")
            else contextlib.nullcontext()  # pragma: no cover
        )

        with dspy_ctx:
            interpreter = _make_dspy_python_interpreter()
            rlm = dspy.RLM(
                "repo_snapshot, query -> summary, frameworks_json, patterns_json, insights_json",
                max_iterations=max_iterations,
                max_llm_calls=max_llm_calls,
                max_output_chars=max_output_chars,
                verbose=bool(verbose),
                sub_lm=sub_lm,
                interpreter=interpreter,
            )

            query = _analysis_prompt()
            await emit("ANALYZE", 0.55, "Running RLM analysis")

            # RLM runs can take a while; keep the UI alive with periodic status updates.
            async def _heartbeat() -> None:
                start = time.monotonic()
                while True:
                    await asyncio.sleep(2.0)
                    elapsed = time.monotonic() - start
                    # Smooth, capped progress bump while RLM is running.
                    p0, p1 = 0.55, 0.84
                    ratio = 1.0 - math.exp(-elapsed / 45.0)
                    prog = min(p1, p0 + (p1 - p0) * ratio)
                    await emit(
                        "ANALYZE",
                        float(prog),
                        f"RLM running... ({int(elapsed)}s elapsed, max_iters={max_iterations}, max_calls={max_llm_calls})",
                    )

            hb = asyncio.create_task(_heartbeat())
            try:
                pred = await rlm.aforward(repo_snapshot=snapshot, query=query)
            finally:
                hb.cancel()
                try:
                    await hb
                except Exception:
                    pass

                # dspy.RLM does not manage the lifecycle of a user-provided interpreter.
                try:
                    interpreter.shutdown()
                except Exception:
                    pass

        await emit("ANALYZE", 0.85, "Parsing RLM output")
        summary = getattr(pred, "summary", "")
        frameworks_json = getattr(pred, "frameworks_json", "")
        patterns_json = getattr(pred, "patterns_json", "")
        insights_json = getattr(pred, "insights_json", "")

        result = parse_analysis_result(
            summary=summary,
            frameworks_json=frameworks_json,
            patterns_json=patterns_json,
            insights_json=insights_json,
        )
        await emit("ANALYZE", 0.95, "RLM analysis complete")
        return result


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except Exception:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    raw = raw.strip().lower()
    if raw in {"1", "true", "yes", "y", "on"}:
        return True
    if raw in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _make_lm(dspy, model: str, *, temperature: float) -> object:  # pragma: no cover
    """
    Create a dspy.LM instance in a version-tolerant way.

    DSPy's LM constructor params have evolved; we treat temperature as best-effort.
    """
    try:
        return dspy.LM(model, temperature=temperature)
    except TypeError:
        return dspy.LM(model)


def _analysis_prompt() -> str:
    allowed_categories = (
        "language, web, backend, build, testing, infra, database, orm, ai, "
        "observability, api, tooling, unknown"
    )
    allowed_pattern_categories = "architecture, implementation, quality, ai_rule, unknown"
    return (
        "You are CodeLens, a repository analyzer. You are given `repo_snapshot`, a JSON string "
        "with a file tree sample plus contents of key manifests/configs and code snippets.\n\n"
        "Task: identify frameworks, architecture patterns, implementation patterns, code quality findings, "
        "and any AI/agent-specific rules or instructions in the codebase. Produce a concise summary.\n\n"
        "Rules:\n"
        "- Use only evidence from `repo_snapshot`.\n"
        "- Prefer high precision. Lower confidence when you infer rather than observe.\n"
        "- Evidence paths must be repo-relative paths that appear in the snapshot tree/manifests/snippets.\n"
        "- Output MUST be valid JSON for the *_json fields (double quotes, arrays of objects).\n\n"
        "- Keep outputs small and high-signal: max 24 patterns total, max 6 per category, max 10 insights.\n"
        "- Evidence paths: max 8 per pattern.\n\n"
        "Return fields:\n"
        "1) summary: 1-4 sentences describing what the repo is.\n"
        "2) frameworks_json: JSON array of {name, version, category, confidence}.\n"
        f"   category must be one of: {allowed_categories}.\n"
        "3) patterns_json: JSON array of {name, category, description, evidence_paths, confidence}.\n"
        f"   category must be one of: {allowed_pattern_categories}.\n"
        "   - architecture: system structure, boundaries, layering, deployment shapes.\n"
        "   - implementation: coding patterns, library usage patterns, conventions.\n"
        "   - quality: maintainability, testing gaps, risky patterns, performance issues.\n"
        "   - ai_rule: AI/agent rules/instructions (AGENTS.md, copilot instructions, cursor rules, etc.).\n"
        "4) insights_json: JSON array of {category, title, description}.\n"
        "   category examples: architecture, quality, risk, ai.\n\n"
        "If a list is empty, return [] (as JSON)."
    )


def _validate_provider_env(model: str) -> None:
    # `dspy.LM` delegates provider specifics to LiteLLM. We do a small amount of
    # fail-fast validation here for clearer errors.
    provider = model.split("/", 1)[0].strip().lower()
    if provider == "openrouter":
        if not (os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OR_API_KEY")):
            raise RuntimeError("Missing OPENROUTER_API_KEY (or OR_API_KEY) for OpenRouter models")


@lru_cache(maxsize=1)
def _deno_supports_node_modules_dir_mode() -> bool:
    # Deno 2 switched npm dependency management to a node_modules-based approach.
    # DSPy RLM's default Pyodide sandbox imports `npm:pyodide/...`, so we need a
    # Deno that supports `--node-modules-dir=<MODE>` to enable auto-install.
    try:
        p = subprocess.run(
            ["deno", "run", "--help"],
            capture_output=True,
            text=True,
            check=False,
        )
        if p.returncode != 0:
            return False
        return "--node-modules-dir[=<MODE>]" in (p.stdout or "")
    except Exception:
        return False


def _make_dspy_python_interpreter():  # type: ignore[no-untyped-def]  # pragma: no cover
    from dspy.primitives.python_interpreter import PythonInterpreter

    interp = PythonInterpreter()

    # Fix for Deno 2's npm module behavior:
    # - Enable npm auto-install (otherwise `npm:pyodide/...` fails with "unable to find package")
    # - Allow read access to the created node_modules dir so Pyodide can load its WASM/zip assets.
    if _deno_supports_node_modules_dir_mode():
        cmd = getattr(interp, "deno_command", None)
        if isinstance(cmd, list) and len(cmd) >= 2 and cmd[0] == "deno" and cmd[1] == "run":
            if not any(str(a).startswith("--node-modules-dir") for a in cmd):
                cmd.insert(2, "--node-modules-dir=auto")

            node_modules = str(Path.cwd() / "node_modules")
            for i, a in enumerate(cmd):
                if isinstance(a, str) and a.startswith("--allow-read="):
                    # Deno uses comma-separated allowlists for --allow-read.
                    if node_modules not in a:
                        cmd[i] = a + "," + node_modules
                    break

    return interp
