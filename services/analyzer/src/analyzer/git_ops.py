from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
from pathlib import Path
from urllib.parse import urlparse


class GitError(RuntimeError):
    pass


def _safe_repo_key(git_url: str, ref: str) -> str:
    h = hashlib.sha256()
    h.update(git_url.encode("utf-8", "replace"))
    h.update(b"\0")
    h.update(ref.encode("utf-8", "replace"))
    return h.hexdigest()[:24]


def validate_git_url(git_url: str) -> None:
    u = urlparse(git_url)
    if u.scheme != "https":
        raise GitError("Only https:// git URLs are allowed (v1).")
    if not u.netloc:
        raise GitError("Invalid git URL.")


async def _run(cmd: list[str], *, timeout_s: int = 300, cwd: Path | None = None) -> None:
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except TimeoutError:
        proc.kill()
        raise GitError(f"Command timed out: {' '.join(cmd)}")

    if proc.returncode != 0:
        raise GitError(
            f"Command failed ({proc.returncode}): {' '.join(cmd)}\n"
            f"{stderr.decode('utf-8', 'replace')}"
        )


async def clone_repo(*, git_url: str, ref: str, cache_dir: Path) -> Path:
    validate_git_url(git_url)
    cache_dir.mkdir(parents=True, exist_ok=True)

    key = _safe_repo_key(git_url, ref)
    dest = cache_dir / key

    # Keep v1 predictable: always re-clone into a fresh directory.
    if dest.exists():
        await asyncio.to_thread(shutil.rmtree, dest)

    await _run(["git", "clone", "--depth", "1", "--no-tags", git_url, str(dest)], timeout_s=600)

    if ref:
        # Best-effort: fetch+checkout the ref (branch/tag/sha).
        await _run(["git", "-C", str(dest), "fetch", "--depth", "1", "origin", ref], timeout_s=600)
        await _run(["git", "-C", str(dest), "checkout", "FETCH_HEAD"], timeout_s=300)

    return dest

