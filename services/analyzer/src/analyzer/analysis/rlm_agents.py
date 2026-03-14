from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SubAgentConfig:
    name: str
    signature_cls: str
    output_field: str
    query: str
    max_iterations: int
    max_llm_calls: int


_TOOLING_GUIDE = (
    "AVAILABLE TOOLS in your REPL:\n"
    "- list_files(repo_snapshot, pattern=None) -> newline-separated paths (capped)\n"
    "- get_file_content(repo_snapshot, path) -> file content or NOT_FOUND\n"
    "- search_files(repo_snapshot, keyword) -> JSON array of matches\n"
    "- read_repo_file(path) -> read ANY file from the repo (up to 50KB)\n"
    "- llm_query(prompt) -> ask a sub-LLM to analyze a chunk\n"
    "\n"
    "Tip: `repo_snapshot` is already a Python dict. Pass it directly into tools.\n"
    "Tip: Use read_repo_file(path) when you need to read files not in the snapshot.\n"
)


SUB_AGENTS: list[SubAgentConfig] = [
    SubAgentConfig(
        name="summary",
        signature_cls="SummarySignature",
        output_field="summary",
        query=(
            "You are CodeLens. Given `repo_snapshot` (a dict with a file tree sample plus\n"
            "contents of key manifests/configs and a few code snippets), write a 1-4 sentence\n"
            "summary of what this repository is and does.\n\n"
            f"{_TOOLING_GUIDE}\n"
            "RULES:\n"
            "- Use only evidence from `repo_snapshot`.\n"
            "- Prefer high precision; if unsure, say so.\n"
            "- Do not mention tools or internal mechanics in the final summary.\n\n"
            "RECOMMENDED STRATEGY:\n"
            "1. Scan top-level structure via list_files() and repo_snapshot['tree']['top_level'].\n"
            "2. Read key manifests via get_file_content() (package.json, pyproject.toml, go.mod, etc.).\n"
            "3. If snippets exist, read 1-3 likely entrypoints via get_file_content().\n\n"
            "OUTPUT:\n"
            "- summary: 1-4 sentences.\n"
        ),
        max_iterations=15,
        max_llm_calls=10,
    ),
    SubAgentConfig(
        name="frameworks",
        signature_cls="FrameworksSignature",
        output_field="frameworks",
        query=(
            "You are CodeLens. Given `repo_snapshot`, identify all frameworks and libraries used\n"
            "in this repository.\n\n"
            f"{_TOOLING_GUIDE}\n"
            "RULES:\n"
            "- Use only evidence from `repo_snapshot`.\n"
            "- Prefer manifests/lockfiles first, then cross-check imports.\n"
            "- Keep results high-signal; omit low-confidence guesses.\n\n"
            "RECOMMENDED STRATEGY:\n"
            "1. Use list_files() to locate manifest/lock/config files included in the snapshot.\n"
            "2. Read each manifest via get_file_content() and extract framework names, versions, and categories.\n"
            "3. Optionally use search_files() to cross-reference imports if confidence is low.\n\n"
            "OUTPUT:\n"
            "- frameworks: array of {name, version, category, confidence}\n"
            "- category must be one of: language|web|backend|build|testing|infra|database|orm|ai|observability|api|tooling|unknown\n"
            "- Use [] if none found.\n"
        ),
        max_iterations=15,
        max_llm_calls=20,
    ),
    SubAgentConfig(
        name="patterns",
        signature_cls="PatternsSignature",
        output_field="patterns",
        query=(
            "You are CodeLens. Given `repo_snapshot`, identify architecture patterns,\n"
            "implementation patterns, code quality findings, and AI/agent rules.\n\n"
            f"{_TOOLING_GUIDE}\n"
            "RULES:\n"
            "- Use only evidence from `repo_snapshot`.\n"
            "- Evidence paths must be repo-relative paths that appear in the snapshot.\n"
            "- Max 24 patterns total, max 6 per category.\n"
            "- Max 8 evidence_paths per pattern.\n\n"
            "RECOMMENDED STRATEGY:\n"
            "1. Use list_files() to understand directory structure and spot rule/config files.\n"
            "2. Read key files via get_file_content() and analyze structure, patterns, and conventions.\n"
            "3. Specifically search for AI rules/instructions (AGENTS.md, .cursor/, copilot instructions).\n\n"
            "OUTPUT:\n"
            "- patterns: array of {name, category, description, evidence_paths, confidence}\n"
            "- category must be one of: architecture|implementation|quality|ai_rule|unknown\n"
            "- evidence_paths must be repo-relative paths present in the snapshot.\n"
            "- Use [] if none found.\n"
        ),
        max_iterations=15,
        max_llm_calls=30,
    ),
    SubAgentConfig(
        name="insights",
        signature_cls="InsightsSignature",
        output_field="insights",
        query=(
            "You are CodeLens. Given `repo_snapshot`, produce up to 10 high-signal insights\n"
            "about this codebase covering architecture, quality, risk, and AI/agent constraints.\n\n"
            f"{_TOOLING_GUIDE}\n"
            "RULES:\n"
            "- Use only evidence from `repo_snapshot`.\n"
            "- Be specific and actionable; avoid generic advice.\n"
            "- Max 10 insights.\n\n"
            "RECOMMENDED STRATEGY:\n"
            "1. Look for testing gaps by comparing tree structure (tests vs src).\n"
            "2. Look for risk hotspots (auth, secrets, CI, deployment).\n"
            '3. Use search_files() for keywords like "password", "token", "dotenv", "auth", "jwt".\n\n'
            "OUTPUT:\n"
            "- insights: array of {category, title, description}\n"
            "- category examples: architecture, quality, risk, ai.\n"
            "- Use [] if none found.\n"
        ),
        max_iterations=15,
        max_llm_calls=15,
    ),
    SubAgentConfig(
        name="architecture",
        signature_cls="ArchitectureSignature",
        output_field="services",
        query=(
            "You are CodeLens. Given `repo_snapshot`, map the architecture of this repository\n"
            "into logical services, modules, packages, or libraries. Go DEEP: read actual source\n"
            "files to understand what each part of the codebase does at the file level.\n\n"
            f"{_TOOLING_GUIDE}\n"
            "RULES:\n"
            "- Identify every distinct logical service/module/package/library in the repo.\n"
            "- For each, list key files with their purpose and architectural layer.\n"
            "- Trace dependencies between modules (which module calls/imports which).\n"
            "- Use read_repo_file(path) aggressively to read source files beyond the snapshot.\n"
            "- Be thorough: read entry points, routers, handlers, models, configs.\n\n"
            "RECOMMENDED STRATEGY:\n"
            "1. Use list_files() to map the full directory structure.\n"
            "2. Identify top-level directories that represent distinct services/packages.\n"
            "3. For each service, use read_repo_file() to read key source files (entry points,\n"
            "   routers, models, handlers, configs) and understand what they do.\n"
            "4. Trace import/dependency relationships between modules by reading source.\n"
            "5. Classify each key file by architectural layer:\n"
            "   presentation (UI, routes, views, templates),\n"
            "   business (core logic, services, handlers),\n"
            "   data (models, stores, repositories, migrations),\n"
            "   config (settings, env, build configs),\n"
            "   test (test files, fixtures),\n"
            "   infra (CI/CD, Docker, deployment).\n\n"
            "OUTPUT:\n"
            "- services: array of {name, description, module_type, entry_points, key_files, depends_on}\n"
            "- module_type: service|module|package|library\n"
            "- key_files: array of {path, purpose, layer}\n"
            "- layer: presentation|business|data|config|test|infra|unknown\n"
            "- depends_on: names of other services/modules this one depends on\n"
            "- Use [] if the repo has no clear modular structure.\n"
        ),
        max_iterations=20,
        max_llm_calls=40,
    ),
]
