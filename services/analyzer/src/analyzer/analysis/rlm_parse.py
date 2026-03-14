from __future__ import annotations

from typing import Any

from analyzer.models import AnalysisResultData, Framework, Insight, Pattern, ServiceModule


def _as_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    return str(v)


def _require_list(raw: Any, *, field: str) -> list[Any]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    raise RuntimeError(f"RLM returned non-array for {field}: {type(raw).__name__}")


def parse_analysis_result(
    *,
    summary: Any,
    frameworks: Any,
    patterns: Any,
    insights: Any,
    services: Any = None,
) -> AnalysisResultData:
    """
    Validate/normalize the RLM outputs into a typed AnalysisResultData.

    Strictness:
    - Top-level outputs must be arrays (or None); stringified JSON is rejected.
    - Individual invalid items are dropped.
    """
    frameworks_raw = _require_list(frameworks, field="frameworks")
    patterns_raw = _require_list(patterns, field="patterns")
    insights_raw = _require_list(insights, field="insights")

    out_frameworks: list[Framework] = []
    for item in frameworks_raw:
        try:
            fw = item if isinstance(item, Framework) else Framework.model_validate(item)
        except Exception:
            continue
        if not fw.name.strip():
            continue
        out_frameworks.append(fw)

    out_patterns: list[Pattern] = []
    for item in patterns_raw:
        try:
            pat = item if isinstance(item, Pattern) else Pattern.model_validate(item)
        except Exception:
            continue
        if not pat.name.strip():
            continue
        out_patterns.append(pat)

    out_insights: list[Insight] = []
    for item in insights_raw:
        try:
            ins = item if isinstance(item, Insight) else Insight.model_validate(item)
        except Exception:
            continue
        if not ins.title.strip() or not ins.description.strip():
            continue
        out_insights.append(ins)

    services_raw = _require_list(services, field="services")
    out_services: list[ServiceModule] = []
    for item in services_raw:
        try:
            svc = item if isinstance(item, ServiceModule) else ServiceModule.model_validate(item)
        except Exception:
            continue
        if not svc.name.strip():
            continue
        out_services.append(svc)

    out_frameworks.sort(key=lambda x: (-x.confidence, x.name))
    out_patterns.sort(key=lambda x: (-x.confidence, x.name))

    return AnalysisResultData(
        summary=_as_str(summary).strip(),
        frameworks=out_frameworks,
        patterns=out_patterns,
        insights=out_insights,
        services=out_services,
    )

