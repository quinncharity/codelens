from __future__ import annotations

from analyzer.analysis.rlm_parse import parse_analysis_result


def test_parse_analysis_result_normalizes_and_drops_invalid_entries() -> None:
    result = parse_analysis_result(
        summary=" hello ",
        frameworks_json='[{"name":"react","version":"18","category":"web","confidence":1.2},{"name":"","confidence":0.9},{"name":"weird","category":"nope","confidence":"x"}]',
        patterns_json='[{"name":"monorepo","description":"uses workspaces","evidence_paths":["package.json","/abs/path"],"confidence":0.8},{"bad":true}]',
        insights_json='[{"category":"build","title":"Uses pnpm","description":"Found pnpm lockfile."},{"category":"x","title":"","description":"no"}]',
    )

    assert result.summary == "hello"
    assert [f.name for f in result.frameworks] == ["react", "weird"]
    assert result.frameworks[0].confidence == 1.0
    assert result.frameworks[1].category == "unknown"

    assert len(result.patterns) == 1
    assert result.patterns[0].name == "monorepo"
    assert result.patterns[0].evidence_paths == ["package.json"]

    assert len(result.insights) == 1
    assert result.insights[0].title == "Uses pnpm"

