from __future__ import annotations

import contextlib
import logging
import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from analyzer.analysis.engine import EmitFn
from analyzer.analysis.rlm_agents import SUB_AGENTS
from analyzer.analysis.repo_snapshot import build_repo_snapshot
from analyzer.analysis.rlm_parse import parse_analysis_result
from analyzer.analysis.rlm_streaming import run_sub_agent
from analyzer.analysis.rlm_tools import get_file_content, list_files, search_files
from analyzer.models import AnalysisResultData

logger = logging.getLogger(__name__)


class RLMEngine:
    async def analyze(self, repo_root: Path, emit: EmitFn) -> AnalysisResultData:
        await emit("INDEX", 0.10, "Initializing RLM engine", agent="engine", kind="PHASE_START")

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

        await emit("INDEX", 0.12, "Building repository snapshot", agent="engine", kind="PHASE_START")
        snapshot_max_bytes = _env_int("CODELENS_RLM_SNAPSHOT_MAX_BYTES", 2_000_000)
        snapshot = build_repo_snapshot(repo_root, max_bytes=snapshot_max_bytes)
        await emit(
            "INDEX",
            0.25,
            f"Snapshot built ({len(snapshot)} bytes)",
            agent="engine",
            kind="PHASE_END",
        )

        await emit("ANALYZE", 0.28, "Configuring DSPy", agent="engine", kind="PHASE_START")
        temperature = _env_float("CODELENS_DSPY_TEMPERATURE", 0.0)
        main_lm = _make_lm(dspy, lm, temperature=temperature)

        sub_lm_name = os.environ.get("CODELENS_DSPY_SUB_LM", "").strip()
        if sub_lm_name:
            _validate_provider_env(sub_lm_name)
        sub_lm = _make_lm(dspy, sub_lm_name, temperature=0.0) if sub_lm_name else None

        global_max_iterations = _env_int_opt("CODELENS_RLM_MAX_ITERATIONS")
        global_max_llm_calls = _env_int_opt("CODELENS_RLM_MAX_LLM_CALLS")
        max_output_chars = _env_int("CODELENS_RLM_MAX_OUTPUT_CHARS", 100_000)
        verbose = _env_bool("CODELENS_RLM_VERBOSE", False)
        log_trajectory = _env_bool("CODELENS_RLM_LOG_TRAJECTORY", False)

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

        await emit("ANALYZE", 0.30, "Running RLM sub-agents", agent="engine", kind="PHASE_START")

        results: dict[str, str] = {}
        total = len(SUB_AGENTS)

        # Evenly spread agent progress across a stable range within ANALYZE.
        p_global_start, p_global_end = 0.30, 0.86

        with dspy_ctx:
            for i, agent_cfg in enumerate(SUB_AGENTS):
                step = i + 1
                p_start = p_global_start + (i / max(1, total)) * (p_global_end - p_global_start)
                p_end = p_global_start + (step / max(1, total)) * (p_global_end - p_global_start)

                name_uc = agent_cfg.name.strip().upper()
                agent_max_iterations = (
                    _env_int_opt(f"CODELENS_RLM_{name_uc}_MAX_ITERATIONS")
                    or global_max_iterations
                    or agent_cfg.max_iterations
                )
                agent_max_llm_calls = (
                    _env_int_opt(f"CODELENS_RLM_{name_uc}_MAX_LLM_CALLS")
                    or global_max_llm_calls
                    or agent_cfg.max_llm_calls
                )

                await emit(
                    "ANALYZE",
                    float(p_start),
                    f"Running sub-agent: {agent_cfg.name} ({step}/{total})",
                    agent=agent_cfg.name,
                    kind="AGENT_START",
                    step=step,
                    step_total=total,
                )

                interpreter = _make_dspy_python_interpreter()
                try:
                    kwargs = dict(
                        max_iterations=int(agent_max_iterations),
                        max_llm_calls=int(agent_max_llm_calls),
                        max_output_chars=max_output_chars,
                        verbose=bool(verbose),
                        sub_lm=sub_lm,
                        interpreter=interpreter,
                        tools=[list_files, get_file_content, search_files],
                    )
                    try:
                        rlm = dspy.RLM(agent_cfg.signature, **kwargs)
                    except TypeError:
                        # Older DSPy versions may not accept tools=.
                        kwargs.pop("tools", None)
                        rlm = dspy.RLM(agent_cfg.signature, **kwargs)

                    pred = await run_sub_agent(
                        dspy=dspy,
                        rlm=rlm,
                        repo_snapshot=snapshot,
                        query=agent_cfg.query,
                        emit=emit,
                        phase="ANALYZE",
                        p_start=float(p_start),
                        p_end=float(p_end),
                        agent=agent_cfg.name,
                        max_llm_calls=int(agent_max_llm_calls),
                        step=step,
                        step_total=total,
                    )
                finally:
                    # dspy.RLM does not manage the lifecycle of a user-provided interpreter.
                    try:
                        interpreter.shutdown()
                    except Exception:
                        pass

                if log_trajectory:
                    traj = getattr(pred, "trajectory", None)
                    if isinstance(traj, list):
                        llm_query_calls = 0
                        for step_obj in traj:
                            if not isinstance(step_obj, dict):
                                continue
                            code = step_obj.get("code", "")
                            if isinstance(code, str) and "llm_query" in code:
                                llm_query_calls += 1
                        logger.info(
                            "RLM sub-agent %s trajectory: steps=%d llm_query_refs=%d",
                            agent_cfg.name,
                            len(traj),
                            llm_query_calls,
                        )

                raw_out = getattr(pred, agent_cfg.output_field, "")

                # Fail-open for JSON list outputs: warn and default to [].
                if agent_cfg.output_field.endswith("_json"):
                    try:
                        from analyzer.analysis.rlm_parse import _parse_json_array  # type: ignore[attr-defined]

                        _parse_json_array(raw_out, field=agent_cfg.output_field)
                    except Exception as e:
                        logger.warning(
                            "Sub-agent %s returned invalid %s; defaulting to [] (%s)",
                            agent_cfg.name,
                            agent_cfg.output_field,
                            e,
                        )
                        await emit(
                            "ANALYZE",
                            float(p_end),
                            f"Invalid JSON output; defaulting {agent_cfg.output_field} to []",
                            agent=agent_cfg.name,
                            kind="WARN",
                            step=step,
                            step_total=total,
                        )
                        raw_out = "[]"

                results[agent_cfg.output_field] = raw_out

                await emit(
                    "ANALYZE",
                    float(p_end),
                    f"Sub-agent {agent_cfg.name} complete",
                    agent=agent_cfg.name,
                    kind="AGENT_END",
                    step=step,
                    step_total=total,
                )

        await emit("ANALYZE", 0.88, "Parsing RLM output", agent="engine", kind="PHASE_START")
        summary = results.get("summary", "")
        frameworks_json = results.get("frameworks_json", "[]")
        patterns_json = results.get("patterns_json", "[]")
        insights_json = results.get("insights_json", "[]")

        result = parse_analysis_result(
            summary=summary,
            frameworks_json=frameworks_json,
            patterns_json=patterns_json,
            insights_json=insights_json,
        )
        await emit("ANALYZE", 0.90, "RLM analysis complete", agent="engine", kind="PHASE_END")
        return result


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _env_int_opt(name: str) -> int | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except Exception:
        return None


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
