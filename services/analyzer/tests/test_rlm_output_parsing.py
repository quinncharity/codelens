from __future__ import annotations

import pytest

from analyzer.analysis.rlm_parse import parse_analysis_result


def test_parse_analysis_result_normalizes_and_drops_invalid_entries() -> None:
    result = parse_analysis_result(
        summary=" hello ",
        frameworks=[
            {"name": "react", "version": "18", "category": "web", "confidence": 1.2},
            {"name": "", "confidence": 0.9},
            {"name": "weird", "category": "nope", "confidence": "x"},
        ],
        patterns=[
            {
                "name": "monorepo",
                "category": "architecture",
                "description": "uses workspaces",
                "evidence_paths": ["package.json", "/abs/path"],
                "confidence": 0.8,
            },
            {"name": "x", "category": "nope", "description": "y", "evidence_paths": [], "confidence": 0.2},
            {"bad": True},
        ],
        insights=[
            {"category": "build", "title": "Uses pnpm", "description": "Found pnpm lockfile."},
            {"category": "x", "title": "", "description": "no"},
        ],
    )

    assert result.summary == "hello"
    assert [f.name for f in result.frameworks] == ["react", "weird"]
    assert result.frameworks[0].confidence == 1.0
    assert result.frameworks[1].category == "unknown"

    assert len(result.patterns) == 2
    assert result.patterns[0].name == "monorepo"
    assert result.patterns[0].category == "architecture"
    assert result.patterns[0].evidence_paths == ["package.json"]
    assert result.patterns[1].name == "x"
    assert result.patterns[1].category == "unknown"

    assert len(result.insights) == 1
    assert result.insights[0].title == "Uses pnpm"


def test_parse_analysis_result_rejects_stringified_json_arrays() -> None:
    with pytest.raises(RuntimeError):
        parse_analysis_result(
            summary="x",
            frameworks='[{"name":"react"}]',
            patterns=[],
            insights=[],
        )
