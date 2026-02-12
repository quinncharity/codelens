from __future__ import annotations

from pathlib import Path

from analyzer.analysis.repo_snapshot import build_repo_snapshot


def test_repo_snapshot_caps_and_filters(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()

    (repo / "package.json").write_text('{"name":"x","dependencies":{"react":"^18.0.0"}}', encoding="utf-8")
    (repo / "AGENTS.md").write_text("# Agent instructions\nFollow these rules.\n", encoding="utf-8")
    (repo / ".env").write_text("SECRET_KEY=supersecret\n", encoding="utf-8")
    (repo / ".env.example").write_text("PUBLIC_FLAG=1\n", encoding="utf-8")

    # Add enough files to make the snapshot builder include a tree sample.
    for i in range(200):
        (repo / f"file{i}.txt").write_text("x" * 100, encoding="utf-8")

    snap = build_repo_snapshot(
        repo,
        max_bytes=2_000,
        max_files=1_000,
        max_tree_paths=200,
        max_manifests=50,
        max_snippets=5,
        per_file_max_bytes=500,
        snippet_max_bytes=200,
    )

    assert len(snap.to_json()) <= 2_000

    manifest_paths = {m.path for m in snap.manifests}
    assert ".env" not in manifest_paths
    assert ".env.example" in manifest_paths
    assert "AGENTS.md" in manifest_paths
