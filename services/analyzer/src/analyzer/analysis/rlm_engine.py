from __future__ import annotations

import asyncio
import contextlib
import importlib
import logging
import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from analyzer.analysis.engine import EmitFn
from analyzer.analysis.rlm_agents import FUNCTIONS_AGENT, SUB_AGENTS, SubAgentConfig
from analyzer.analysis.repo_snapshot import build_repo_snapshot
from analyzer.analysis.rlm_parse import parse_analysis_result
from analyzer.analysis.rlm_streaming import run_sub_agent
from analyzer.analysis.rlm_tools import get_file_content, list_files, make_read_repo_file, search_files
from analyzer.models import AnalysisResultData, FunctionDetail

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

        if not hasattr(dspy, "JSONAdapter"):
            raise RuntimeError(
                "Installed dspy does not expose dspy.JSONAdapter. Upgrade to a recent dspy release."
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
        snapshot_model = build_repo_snapshot(repo_root, max_bytes=snapshot_max_bytes)
        snapshot = snapshot_model.model_dump(mode="json")
        await emit(
            "INDEX",
            0.25,
            f"Snapshot built ({len(snapshot_model.to_json())} bytes)",
            agent="engine",
            kind="PHASE_END",
        )

        read_repo_file = make_read_repo_file(repo_root)

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
        adapter = dspy.JSONAdapter()

        sig_mod = importlib.import_module("analyzer.analysis.rlm_signatures")

        await emit("ANALYZE", 0.30, "Running sub-agents in parallel", agent="engine", kind="PHASE_START")

        total = len(SUB_AGENTS)

        async def _run_single_agent(
            agent_cfg: SubAgentConfig,
            step: int,
        ) -> tuple[str, object]:
            """Run one sub-agent and return (output_field, output_value).

            Must be called inside an active ``dspy.context(lm=...)`` block.
            We use a single outer context rather than per-coroutine contexts
            because ``dspy.context`` is a generator-based CM that uses
            thread-local state — concurrent enter/exit from interleaved
            coroutines would clobber each other's LM setting.
            """
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
                0.0,
                f"Starting {agent_cfg.name}",
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
                    tools=[list_files, get_file_content, search_files, read_repo_file],
                )
                try:
                    sig_cls = getattr(sig_mod, agent_cfg.signature_cls)
                    rlm = dspy.RLM(sig_cls, **kwargs)
                except TypeError:
                    kwargs.pop("tools", None)
                    sig_cls = getattr(sig_mod, agent_cfg.signature_cls)
                    rlm = dspy.RLM(sig_cls, **kwargs)

                pred = await run_sub_agent(
                    dspy=dspy,
                    rlm=rlm,
                    repo_snapshot=snapshot,  # JSON-compatible dict
                    query=agent_cfg.query,
                    emit=emit,
                    phase="ANALYZE",
                    p_start=0.0,
                    p_end=1.0,
                    agent=agent_cfg.name,
                    max_llm_calls=int(agent_max_llm_calls),
                    step=step,
                    step_total=total,
                )
            finally:
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

            raw_out = getattr(pred, agent_cfg.output_field, None)
            if raw_out is None:
                raise RuntimeError(
                    f"Sub-agent {agent_cfg.name} produced no '{agent_cfg.output_field}' output"
                )

            await emit(
                "ANALYZE",
                1.0,
                f"{agent_cfg.name} complete",
                agent=agent_cfg.name,
                kind="AGENT_END",
                step=step,
                step_total=total,
            )

            return agent_cfg.output_field, raw_out

        # dspy.context() is a generator-based CM using thread-local state.
        # A single outer context keeps the LM visible to all interleaved
        # coroutines without enter/exit races.
        dspy_ctx = (
            dspy.context(lm=main_lm, adapter=adapter)
            if hasattr(dspy, "context")
            else contextlib.nullcontext()  # pragma: no cover
        )

        # Run all sub-agents concurrently; fail the job if any agent fails.
        coros = [
            _run_single_agent(cfg, step=i + 1)
            for i, cfg in enumerate(SUB_AGENTS)
        ]
        with dspy_ctx:
            outcomes = await asyncio.gather(*coros, return_exceptions=True)

        results: dict[str, object] = {}
        failures: list[str] = []
        for cfg, outcome in zip(SUB_AGENTS, outcomes):
            if isinstance(outcome, BaseException):
                msg = f"{cfg.name}: {outcome}"
                failures.append(msg)
                logger.warning("Sub-agent %s failed: %s", cfg.name, outcome)
                await emit(
                    "ANALYZE",
                    1.0,
                    f"{cfg.name} failed: {outcome}",
                    agent=cfg.name,
                    kind="AGENT_ERROR",
                    step=SUB_AGENTS.index(cfg) + 1,
                    step_total=total,
                )
                continue
            field, raw = outcome
            results[field] = raw

        if failures:
            raise RuntimeError("One or more RLM sub-agents failed: " + " | ".join(failures))

        await emit("ANALYZE", 0.88, "Parsing results", agent="engine", kind="PHASE_START")
        summary = results.get("summary", "")
        frameworks = results.get("frameworks", [])
        patterns = results.get("patterns", [])
        insights = results.get("insights", [])
        services = results.get("services", [])

        result = parse_analysis_result(
            summary=summary,
            frameworks=frameworks,
            patterns=patterns,
            insights=insights,
            services=services,
        )

        # --- Second pass: Functions agent ---
        # Collect key file paths from the architecture result to feed to the functions agent.
        key_file_paths: list[str] = []
        for svc in result.services:
            for kf in svc.key_files:
                if kf.path and kf.path not in key_file_paths:
                    key_file_paths.append(kf.path)
            for ep in svc.entry_points:
                if ep and ep not in key_file_paths:
                    key_file_paths.append(ep)

        if key_file_paths:
            await emit(
                "ANALYZE", 0.90, "Extracting functions and generating subgoal labels",
                agent="functions", kind="AGENT_START",
                step=total + 1, step_total=total + 1,
            )

            file_list_str = "\n".join(f"- {p}" for p in key_file_paths[:40])
            functions_query = (
                FUNCTIONS_AGENT.query
                + f"\n\nFILES TO ANALYZE:\n{file_list_str}\n"
            )

            name_uc = FUNCTIONS_AGENT.name.strip().upper()
            fn_max_iterations = (
                _env_int_opt(f"CODELENS_RLM_{name_uc}_MAX_ITERATIONS")
                or global_max_iterations
                or FUNCTIONS_AGENT.max_iterations
            )
            fn_max_llm_calls = (
                _env_int_opt(f"CODELENS_RLM_{name_uc}_MAX_LLM_CALLS")
                or global_max_llm_calls
                or FUNCTIONS_AGENT.max_llm_calls
            )

            interpreter = _make_dspy_python_interpreter()
            try:
                fn_kwargs = dict(
                    max_iterations=int(fn_max_iterations),
                    max_llm_calls=int(fn_max_llm_calls),
                    max_output_chars=max_output_chars,
                    verbose=bool(verbose),
                    sub_lm=sub_lm,
                    interpreter=interpreter,
                    tools=[list_files, get_file_content, search_files, read_repo_file],
                )
                try:
                    fn_sig_cls = getattr(sig_mod, FUNCTIONS_AGENT.signature_cls)
                    fn_rlm = dspy.RLM(fn_sig_cls, **fn_kwargs)
                except TypeError:
                    fn_kwargs.pop("tools", None)
                    fn_sig_cls = getattr(sig_mod, FUNCTIONS_AGENT.signature_cls)
                    fn_rlm = dspy.RLM(fn_sig_cls, **fn_kwargs)

                fn_pred = await run_sub_agent(
                    dspy=dspy,
                    rlm=fn_rlm,
                    repo_snapshot=snapshot,
                    query=functions_query,
                    emit=emit,
                    phase="ANALYZE",
                    p_start=0.0,
                    p_end=1.0,
                    agent="functions",
                    max_llm_calls=int(fn_max_llm_calls),
                    step=total + 1,
                    step_total=total + 1,
                )

                raw_functions = getattr(fn_pred, FUNCTIONS_AGENT.output_field, [])
                if raw_functions is None:
                    raw_functions = []

                # Parse and validate functions, then attach to services.
                parsed_functions: list[FunctionDetail] = []
                if isinstance(raw_functions, list):
                    for item in raw_functions:
                        try:
                            fd = (
                                item
                                if isinstance(item, FunctionDetail)
                                else FunctionDetail.model_validate(item)
                            )
                        except Exception:
                            continue
                        if not fd.name.strip() or not fd.file_path.strip():
                            continue
                        parsed_functions.append(fd)

                # Attach functions to their parent services by matching file_path.
                svc_by_path: dict[str, int] = {}
                for idx, svc in enumerate(result.services):
                    for kf in svc.key_files:
                        svc_by_path[kf.path] = idx
                    for ep in svc.entry_points:
                        if ep not in svc_by_path:
                            svc_by_path[ep] = idx

                svc_functions: dict[int, list[FunctionDetail]] = {}
                for fd in parsed_functions:
                    svc_idx = svc_by_path.get(fd.file_path)
                    if svc_idx is not None:
                        svc_functions.setdefault(svc_idx, []).append(fd)

                # Rebuild services with functions attached.
                updated_services = []
                for idx, svc in enumerate(result.services):
                    fns = svc_functions.get(idx, [])
                    if fns:
                        updated_services.append(svc.model_copy(update={"functions": fns}))
                    else:
                        updated_services.append(svc)

                result = result.model_copy(update={"services": updated_services})

                await emit(
                    "ANALYZE", 1.0, "Functions extraction complete",
                    agent="functions", kind="AGENT_END",
                    step=total + 1, step_total=total + 1,
                )
            except Exception as e:
                logger.warning("Functions agent failed (non-fatal): %s", e)
                await emit(
                    "ANALYZE", 1.0, f"Functions extraction failed: {e}",
                    agent="functions", kind="AGENT_ERROR",
                    step=total + 1, step_total=total + 1,
                )
            finally:
                try:
                    interpreter.shutdown()
                except Exception:
                    pass

        await emit("ANALYZE", 0.92, "Analysis complete", agent="engine", kind="PHASE_END")
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
    elif provider == "groq":
        if not os.environ.get("GROQ_API_KEY"):
            raise RuntimeError("Missing GROQ_API_KEY for Groq models")


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
