#!/usr/bin/env python3
"""Local file-backed web UI for the CoAutoResearch scaffold."""

from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import errno
import hashlib
import hmac
import json
import mimetypes
import os
import re
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from datetime import datetime
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, parse_qsl, quote, unquote, urlencode, urlparse

from aux_sessions import AuxSessionManager


UI_DIR = Path(__file__).resolve().parent
DEFAULT_PROJECT_ROOT = UI_DIR.parent
PACKAGE_TEMPLATE_ROOT = Path(os.path.expanduser(os.environ.get("COAUTO_TEMPLATE_ROOT", ""))).resolve() if os.environ.get("COAUTO_TEMPLATE_ROOT") else None
DEFAULT_REVIEW_CHECKPOINT_INTERVAL = 100
AUTORESEARCH_MAX_ITERATIONS = DEFAULT_REVIEW_CHECKPOINT_INTERVAL
PRE_EXEC_SCRIPT_MAX_CHARS = 4000
PORT_FALLBACK_ATTEMPTS = 50
FRAMING_MESSAGES_CLIENT_VERSION = "20260617-trial-selection"
PLAN_ARTIFACT_SCHEMA_VERSION = 1
MAX_TEXT_BYTES = 500_000
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
RESOURCE_IMPORT_CHUNK_BYTES = 8 * 1024 * 1024
EXPORT_CONFIRMATION_BYTES = 1 * 1024 * 1024 * 1024
EXPORT_CHUNK_BYTES = 1024 * 1024
EXPORT_JOB_TTL_SECONDS = 24 * 60 * 60
EXPORT_STORE_WITHOUT_COMPRESSION_BYTES = 16 * 1024 * 1024
RESEARCH_EVENT_BUFFER_MAX = 500
RESEARCH_EVENT_HEARTBEAT_SECONDS = 15
STREAMING_TRANSCRIPT_MAX_CHARS = 8000
FIGURE_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
REMOTE_AUTH_TOKEN = os.environ.get("COAUTO_REMOTE_AUTH_TOKEN", "").strip()
REMOTE_AUTH_QUERY = "coauto_token"
REMOTE_AUTH_COOKIE = "coauto_remote_auth"
AUTO_RESOURCE_SEARCH_MAX_RESULTS = 8
AUTO_RESOURCE_SEARCH_MAX_DIRS = 2500
AUTO_RESOURCE_SEARCH_MAX_DEPTH = 5
ACTIVE_EXPECTED_TRIAL_MARKER_STATUSES = {"pending", "mismatch"}
RESUME_SNAPSHOT_PATHS = [
    "PROJECT.md",
    "research_trajectory/STATE.md",
    "research_trajectory/CURRENT_FINDINGS.md",
    "research_trajectory/HUMAN_TASKS.md",
    "manuscript",
    "resources/user_input/RESOURCE_MANIFEST.md",
]
RESTART_SNAPSHOT_PATHS = [
    "PROJECT.md",
    "research_trajectory/STATE.md",
    "research_trajectory/CURRENT_FINDINGS.md",
    "research_trajectory/HUMAN_TASKS.md",
    "research_trajectory/TRAJECTORY.json",
    "research_trajectory/NEXT_TRIAL.json",
    "research_trajectory/trials",
    "research_trajectory/checkpoints",
    "manuscript",
    "workspace",
    "resources/user_input/RESOURCE_MANIFEST.md",
]

CLIENT_DISCONNECT_ERRNOS = {errno.EPIPE, errno.ECONNRESET, errno.ECONNABORTED}


def is_client_disconnect_error(exc: BaseException) -> bool:
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
        return True
    return isinstance(exc, OSError) and getattr(exc, "errno", None) in CLIENT_DISCONNECT_ERRNOS

CHAT_PROTECTED_PATHS = [
    "research_trajectory/STATE.md",
    "research_trajectory/CURRENT_FINDINGS.md",
    "research_trajectory/TRAJECTORY.json",
    "research_trajectory/NEXT_TRIAL.json",
    "research_trajectory/trials",
    "research_trajectory/checkpoints",
    "manuscript/BLUEPRINT.md",
    "manuscript/reviews",
    "manuscript/figures/FIGURE_SPECS.md",
]
CHAT_HISTORY_MAX_MESSAGES = 80
CHAT_QUEUE_MAX_MESSAGES = 50
RESOURCE_PROVENANCE_VALUES = {
    "user_explicit",
    "user_confirmed",
    "autoresearch_discovered",
    "autoresearch_generated",
    "unknown",
}
RESTART_RETAINED_PROVENANCE = {"user_explicit", "user_confirmed"}
RESOURCE_MANIFEST_RELATIVE_PATH = "resources/user_input/RESOURCE_MANIFEST.md"
AUTO_RESOURCE_SKIP_DIRS = {
    ".cache",
    ".claude",
    ".codex",
    ".git",
    ".hg",
    ".next",
    ".svn",
    ".venv",
    "__pycache__",
    "Library",
    "node_modules",
    "site-packages",
    "venv",
}
TEXT_PREVIEW_SUFFIXES = {
    ".md",
    ".markdown",
    ".txt",
    ".text",
    ".json",
    ".jsonl",
    ".yaml",
    ".yml",
    ".xml",
    ".csv",
    ".tsv",
    ".log",
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".css",
    ".scss",
    ".html",
    ".htm",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".sh",
    ".bash",
    ".zsh",
    ".sql",
    ".bib",
    ".tex",
}
EDITABLE_SUFFIXES = set(TEXT_PREVIEW_SUFFIXES)
IMAGE_PREVIEW_SUFFIXES = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
PDF_PREVIEW_SUFFIXES = {".pdf"}
PREVIEWABLE_SUFFIXES = TEXT_PREVIEW_SUFFIXES | IMAGE_PREVIEW_SUFFIXES | PDF_PREVIEW_SUFFIXES
COLD_START_EDIT_FILES = [
    "resources/user_input/INITIAL_BRIEF.md",
]
REVIEWER_BASELINE_VERSION = "2026-07-result-block-schema"
CORE_REVIEWER_FILES = [
    "REVIEW_TAXONOMY.md",
    "FINAL_GATE_REVIEWER.md",
    "PLAN_REVIEWER.md",
    "PROCESS_REVIEWER.md",
    "EVIDENCE_REVIEWER.md",
    "VENUE_FIT_REVIEWER.md",
    "MANUSCRIPT_REVIEWER.md",
    "FIGURE_TABLE_REVIEWER.md",
    "REFERENCE_REVIEWER.md",
    "REVIEWER_SPAWNING.md",
]
CORE_PROTOCOL_FILES = [
    "EXECUTION_AGENT.md",
    "MANUSCRIPT.md",
    "PROJECT_FRAMING.md",
    "RESOURCE_INTAKE.md",
    "RESOURCE_SCOUT.md",
    "REVIEWER_SCOPE_ANALYST.md",
]
REVIEWER_BASELINE_RELATIVE_PATH = "instructions/.co-auto-research-instructions.json"
REVIEW_STORAGE_VERSION = "per-reviewer-files-v1"
REQUIRED_REVIEWER_OUTPUTS = {
    "plan": {
        "label": "Plan reviewer",
        "file": "PLAN_REVIEW.md",
        "scope": "plan",
        "instruction": "instructions/reviewers/PLAN_REVIEWER.md",
    },
    "process": {
        "label": "Process reviewer",
        "file": "PROCESS_REVIEW.md",
        "scope": "process",
        "instruction": "instructions/reviewers/PROCESS_REVIEWER.md",
    },
    "evidence": {
        "label": "Evidence reviewer",
        "file": "EVIDENCE_REVIEW.md",
        "scope": "evidence",
        "instruction": "instructions/reviewers/EVIDENCE_REVIEWER.md",
    },
    "venue_fit": {
        "label": "Venue fit reviewer",
        "file": "VENUE_FIT_REVIEW.md",
        "scope": "venue",
        "instruction": "instructions/reviewers/VENUE_FIT_REVIEWER.md",
    },
    "manuscript": {
        "label": "Manuscript reviewer",
        "file": "MANUSCRIPT_REVIEW.md",
        "scope": "manuscript",
        "instruction": "instructions/reviewers/MANUSCRIPT_REVIEWER.md",
    },
    "figure_table": {
        "label": "Figure/table reviewer",
        "file": "FIGURE_TABLE_REVIEW.md",
        "scope": "figure-table",
        "instruction": "instructions/reviewers/FIGURE_TABLE_REVIEWER.md",
    },
    "reference": {
        "label": "Reference reviewer",
        "file": "REFERENCE_REVIEW.md",
        "scope": "reference",
        "instruction": "instructions/reviewers/REFERENCE_REVIEWER.md",
    },
    "final_gate": {
        "label": "Final gate reviewer",
        "file": "FINAL_GATE_REVIEW.md",
        "scope": "final-gate",
        "instruction": "instructions/reviewers/FINAL_GATE_REVIEWER.md",
    },
}
REQUIRED_REVIEWER_FILES = tuple(config["file"] for config in REQUIRED_REVIEWER_OUTPUTS.values())
TRIAL_PROGRESS_STAGES = [
    {"key": "planning", "label": "Planning"},
    {"key": "working", "label": "Working"},
    {"key": "synthesizing", "label": "Synthesizing"},
    {"key": "reporting", "label": "Reporting"},
    {"key": "reviewing", "label": "Reviewing"},
    {"key": "gate_update", "label": "Gate update"},
]
REQUIRED_BLUEPRINT_SECTIONS = [
    "Target Venue / Audience / Article Type",
    "Target-Venue Organization Rationale",
    "Core Story",
    "Architecture Overview / Table of Contents",
    "Manuscript Architecture",
    "Reference / Literature Grounding Plan",
    "Appendix / Supplement Plan",
    "Blocking Missing Evidence",
    "Required Qualifications / Claim Constraints",
    "Provenance / Audit Index",
    "Deprecated Or Superseded Ideas",
    "Submission-Readiness Summary",
]


def new_research_session() -> dict[str, Any]:
    return {
        "id": "",
        "session_id": "",
        "status": "idle",
        "mode": "",
        "command": [],
        "settings": {},
        "started_at": "",
        "ended_at": "",
        "returncode": None,
        "logs": [],
        "raw_logs": [],
        "transcript": [],
        "loop_active": False,
        "loop_iteration": 0,
        "loop_max_iterations": AUTORESEARCH_MAX_ITERATIONS,
        "loop_review_checkpoint_iteration": 0,
        "loop_stop_reason": "",
        "loop_instruction": "",
        "gate": {},
        "last_event_at": "",
        "last_event_summary": "",
        "agent_notice": {},
        "plan_id": "",
        "plan_thread_id": "",
        "plan_turn_id": "",
        "process": None,
    }


def project_id_for_path(path: Path) -> str:
    return hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:12]


def read_project_metadata(root: Path) -> dict[str, Any]:
    metadata_path = root / ".co-auto-research" / "project.json"
    if not metadata_path.exists():
        return {}
    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def write_project_metadata(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    metadata_dir = root / ".co-auto-research"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = metadata_dir / "project.json"
    clean_payload = dict(payload)
    clean_payload["schemaVersion"] = int(clean_payload.get("schemaVersion") or 1)
    if not clean_payload.get("projectId"):
        clean_payload["projectId"] = project_id_for_path(root)
    metadata_path.write_text(f"{json.dumps(clean_payload, indent=2)}\n", encoding="utf-8")
    return clean_payload


def read_template_version(root: Path) -> str:
    manifest_path = root / ".co-auto-research-template" / "manifest.json"
    if not manifest_path.exists():
        return ""
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    return str(payload.get("templateVersion") or "")


WINDOWS_RESERVED_FILENAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


def project_directory_slug(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("Project name is required.")
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", text).strip(" ._-")[:80] or "project"
    if slug.upper() in WINDOWS_RESERVED_FILENAMES:
        slug = f"{slug}_project"
    return slug


def template_copy_ignore(template_root: Path):
    source = template_root.resolve()

    def ignore(directory: str, names: list[str]) -> set[str]:
        ignored: set[str] = set()
        directory_path = Path(directory).resolve()
        try:
            relative_parts = directory_path.relative_to(source).parts
        except ValueError:
            relative_parts = ()
        for name in names:
            if name in {".DS_Store", "__pycache__", ".git", "node_modules"}:
                ignored.add(name)
            if not relative_parts and name == ".co-auto-research":
                ignored.add(name)
            if relative_parts == ("ui",) and name == ".runtime":
                ignored.add(name)
        return ignored

    return ignore


def clean_template_root() -> Path:
    candidates = [PACKAGE_TEMPLATE_ROOT, DEFAULT_PROJECT_ROOT]
    for candidate in candidates:
        if not candidate:
            continue
        root = candidate.resolve()
        if (root / ".co-auto-research-template" / "manifest.json").exists() and not (root / ".co-auto-research" / "project.json").exists():
            return root
    return DEFAULT_PROJECT_ROOT.resolve()


def reviewer_template_dir(template_root: Path | None = None) -> Path:
    return (template_root or clean_template_root()).resolve() / "instructions" / "reviewers"


def instruction_template_dir(template_root: Path | None = None) -> Path:
    return (template_root or clean_template_root()).resolve() / "instructions"


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def reviewer_template_hashes(template_root: Path | None = None) -> dict[str, str]:
    root = reviewer_template_dir(template_root)
    hashes: dict[str, str] = {}
    for name in CORE_REVIEWER_FILES:
        path = root / name
        if path.exists() and path.is_file():
            hashes[name] = file_sha256(path)
    return hashes


def protocol_template_hashes(template_root: Path | None = None) -> dict[str, str]:
    root = instruction_template_dir(template_root)
    hashes: dict[str, str] = {}
    for name in CORE_PROTOCOL_FILES:
        path = root / name
        if path.exists() and path.is_file():
            hashes[name] = file_sha256(path)
    return hashes


def write_reviewer_baseline_metadata(project_root: Path, template_root: Path | None = None) -> dict[str, Any]:
    hashes = reviewer_template_hashes(template_root)
    protocol_hashes = protocol_template_hashes(template_root)
    payload = {
        "schemaVersion": 1,
        "reviewerBaselineVersion": REVIEWER_BASELINE_VERSION,
        "reviewStorageVersion": REVIEW_STORAGE_VERSION,
        "syncedAt": now_iso(),
        "coreReviewerFiles": hashes,
        "coreProtocolFiles": protocol_hashes,
    }
    target = project_root / REVIEWER_BASELINE_RELATIVE_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf-8")
    return payload


def reviewer_key_for_label(label: str) -> str:
    clean = re.sub(r"[^a-z/ ]+", " ", str(label or "").lower())
    clean = re.sub(r"\s+", " ", clean).strip()
    if clean.startswith("plan"):
        return "plan"
    if clean.startswith("process"):
        return "process"
    if clean.startswith("evidence"):
        return "evidence"
    if clean.startswith("venue"):
        return "venue_fit"
    if clean.startswith("manuscript"):
        return "manuscript"
    if clean.startswith("figure") or clean.startswith("table") or "figure/table" in clean:
        return "figure_table"
    if clean.startswith("reference"):
        return "reference"
    if clean.startswith("final"):
        return "final_gate"
    return ""


def project_relative_path(project_root: Path, path: Path) -> str:
    try:
        return path.relative_to(project_root).as_posix()
    except ValueError:
        return path.as_posix()


def read_trajectory_archived_ids(project_root: Path) -> set[str]:
    path = project_root / "research_trajectory" / "TRAJECTORY.json"
    if not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    archived = payload.get("archived_trial_ids") if isinstance(payload, dict) else []
    return {str(item) for item in archived} if isinstance(archived, list) else set()


def project_active_trial_dirs(project_root: Path) -> list[Path]:
    root = project_root / "research_trajectory" / "trials"
    if not root.is_dir():
        return []
    archived_ids = read_trajectory_archived_ids(project_root)
    dirs: list[Path] = []
    for path in root.iterdir():
        if not path.is_dir() or path.name in archived_ids:
            continue
        if re.match(r"^0*_?project_conversion", path.name, re.IGNORECASE):
            continue
        if not any((path / name).exists() for name in ("PLAN.md", "REVIEW.md", "REPORT.md", "artifacts", "reviews")):
            continue
        dirs.append(path)
    return sorted(dirs, key=lambda path: (trial_iteration_from_id(path.name), path.name))


def reviewer_output_path(trial_dir: Path, key: str) -> Path:
    return trial_dir / "reviews" / REQUIRED_REVIEWER_OUTPUTS[key]["file"]


def parse_reviewer_sections(text: str, source_path: str = "") -> list[dict[str, Any]]:
    matches = list(re.finditer(r"^Reviewer:\s*`?([^`\n]+?)`?\s*$", text, re.MULTILINE))
    sections: list[dict[str, Any]] = []
    for index, match in enumerate(matches):
        reviewer = match.group(1).strip()
        key = reviewer_key_for_label(reviewer)
        if not key:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.start():end].strip()
        block = re.sub(r"\n-{3,}\s*$", "", block).strip()
        sections.append({
            "key": key,
            "reviewer": reviewer,
            "path": source_path,
            "text": block,
            "decision": regex_first_value(block, [r"Decision:\s*`?([^`\n]+)`?", r"Status:\s*`?([^`\n]+)`?"]),
            "gate": regex_first_value(block, [r"Gate impact:\s*`?([^`\n]+)`?", r"Gate:\s*`?([^`\n]+)`?"]),
            "confidence": regex_first_value(block, [r"Confidence:\s*`?([^`\n]+)`?"]) or "medium",
        })
    return sections


def strip_reviewer_metadata(text: str) -> str:
    lines = []
    metadata = {
        "reviewer",
        "scope",
        "decision",
        "gate impact",
        "gate",
        "confidence",
        "source trial",
        "generated at",
        "instruction file",
        "migration source",
    }
    for line in text.splitlines():
        label = line.split(":", 1)[0].strip().lower()
        if label in metadata:
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def reviewed_inputs_for_trial(project_root: Path, trial_dir: Path, key: str) -> list[str]:
    candidates = [
        trial_dir / "PLAN.md",
        trial_dir / "REPORT.md",
        project_root / "PROJECT.md",
        project_root / "research_trajectory" / "STATE.md",
        project_root / "research_trajectory" / "CURRENT_FINDINGS.md",
    ]
    if key in {"evidence", "venue_fit", "manuscript", "figure_table", "final_gate"}:
        candidates.append(project_root / "manuscript" / "BLUEPRINT.md")
    if key in {"figure_table", "final_gate"}:
        candidates.append(project_root / "manuscript" / "figures" / "FIGURE_SPECS.md")
    if key in {"venue_fit", "figure_table", "final_gate"}:
        candidates.extend([
            project_root / "resources" / "target_venue" / "SEED_PAPERS.md",
            project_root / "resources" / "target_venue" / "STYLE_NOTES.md",
            project_root / "resources" / "target_venue" / "FIGURE_TABLE_NOTES.md",
        ])
    paths: list[str] = []
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            relative = project_relative_path(project_root, candidate)
            if relative not in paths:
                paths.append(relative)
    return paths


def default_missing_review_body(label: str) -> str:
    return "\n".join([
        "## Blocking Issues",
        "",
        f"- {label} was not run for this trial before the per-reviewer migration.",
        "",
        "## Required Actions Before Pass",
        "",
        f"- Run the {label} for this trial and replace this migration record.",
        "",
        "## Qualified / Partial Passes",
        "",
        "- none",
        "",
        "## Unassessed Areas",
        "",
        f"- {label} was not assessed for this trial.",
    ])


def format_reviewer_file(
    project_root: Path,
    trial_dir: Path,
    key: str,
    *,
    decision: str,
    gate: str,
    confidence: str,
    migration_source: str,
    context_summary: str,
    body: str = "",
) -> str:
    config = REQUIRED_REVIEWER_OUTPUTS[key]
    label = config["label"]
    clean_body = strip_reviewer_metadata(body) if body else default_missing_review_body(label)
    reviewed_inputs = reviewed_inputs_for_trial(project_root, trial_dir, key)
    lines = [
        f"# {label} Review",
        "",
        f"Reviewer: {label}",
        f"Scope: {config['scope']}",
        f"Decision: {normalize_gate_status(decision)}",
        f"Gate impact: {normalize_gate_status(gate or decision)}",
        f"Confidence: {confidence.strip() or 'medium'}",
        f"Source trial: `{trial_dir.name}`",
        f"Generated at: {now_iso()}",
        f"Instruction file: `{config['instruction']}`",
        f"Migration source: `{migration_source}`",
        "",
        "## Reviewed Inputs",
        "",
    ]
    lines.extend(f"- `{item}`" for item in reviewed_inputs)
    if not reviewed_inputs:
        lines.append("- none recorded")
    lines.extend(["", "## Context Summary", "", context_summary.strip() or "No context summary recorded.", "", clean_body.strip(), ""])
    return "\n".join(lines).rstrip() + "\n"


def backup_project_file(project_root: Path, source: Path, migration_dir: Path, backed_up: list[str]) -> None:
    if not source.exists() or not source.is_file():
        return
    relative = project_relative_path(project_root, source)
    destination = migration_dir / "review_storage_backups" / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    if relative not in backed_up:
        backed_up.append(relative)


def latest_saved_pass_sections(project_root: Path, trial_dirs: list[Path]) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    review_sources = [trial / "REVIEW.md" for trial in trial_dirs]
    manuscript_reviews = project_root / "manuscript" / "reviews"
    if manuscript_reviews.is_dir():
        review_sources.extend(sorted(path for path in manuscript_reviews.glob("*.md") if path.name != ".gitkeep"))
    for source in review_sources:
        if not source.exists() or not source.is_file():
            continue
        relative = project_relative_path(project_root, source)
        trial_iteration = 10**9 if "manuscript/reviews" in relative else trial_iteration_from_id(source.parent.name)
        for section in parse_reviewer_sections(source.read_text(encoding="utf-8", errors="replace"), relative):
            if normalize_gate_status(str(section.get("decision") or "")) != "pass" or normalize_gate_status(str(section.get("gate") or section.get("decision") or "")) != "pass":
                continue
            key = str(section.get("key") or "")
            existing = latest.get(key)
            if not existing or int(existing.get("iteration") or 0) <= trial_iteration:
                section["iteration"] = trial_iteration
                latest[key] = section
    return latest


def project_gate_text_passed(project_root: Path) -> bool:
    state_path = project_root / "research_trajectory" / "STATE.md"
    if not state_path.exists():
        return False
    text = state_path.read_text(encoding="utf-8", errors="replace")
    section = re.search(r"^##\s+Autoresearch Goal Gate\s*$.*?(?=^##\s+|\Z)", text, re.MULTILINE | re.DOTALL)
    if not section:
        return False
    body = section.group(0)
    status_match = re.search(r"^\s*Status:\s*(.+?)\s*$", body, re.IGNORECASE | re.MULTILINE)
    if not status_match or normalize_gate_status(status_match.group(1)) != "pass":
        return False
    for key, config in REQUIRED_REVIEWER_OUTPUTS.items():
        gate_match = re.search(rf"^\s*[-*]\s*{re.escape(config['label'])}\s*:\s*(.+?)\s*$", body, re.IGNORECASE | re.MULTILINE)
        if not gate_match or normalize_gate_status(gate_match.group(1)) != "pass":
            return False
    return True


def reviewer_file_status(path: Path) -> str:
    if not path.exists() or not path.is_file():
        return "missing"
    text = path.read_text(encoding="utf-8", errors="replace")
    gate = normalize_gate_status(regex_first_value(text, [r"Gate impact:\s*`?([^`\n]+)`?"]))
    if gate != "missing":
        return gate
    return normalize_gate_status(regex_first_value(text, [r"Decision:\s*`?([^`\n]+)`?"]))


def markdown_field_line(section: str, label: str) -> str:
    match = re.search(rf"^\s*{re.escape(label)}\s*:\s*(.+?)\s*$", section, re.IGNORECASE | re.MULTILINE)
    return match.group(1).strip().strip("`") if match else ""


def gate_response_to_human(section: str, raw_status: str) -> tuple[str, str]:
    explicit = markdown_field_line(section, "Response to human")
    if explicit:
        return explicit, "response_to_human"
    if not re.search(r"\b(blocked|needs[_\s-]*human|human|clarification)\b", raw_status.strip().lower()):
        return "", ""
    reason = markdown_field_line(section, "Current gate reason")
    next_action = markdown_field_line(section, "Next action")
    parts = []
    if reason:
        parts.append(reason)
    if next_action and next_action.lower() not in {reason.lower(), "none", "n/a"}:
        parts.append(next_action)
    return " ".join(parts).strip(), "legacy_gate_fields" if parts else ""


def normalize_state_gate_references(project_root: Path, latest_trial: Path | None, migration_dir: Path, backed_up: list[str], dry_run: bool = False) -> str:
    if latest_trial is None:
        return ""
    state_path = project_root / "research_trajectory" / "STATE.md"
    if not state_path.exists():
        return ""
    text = state_path.read_text(encoding="utf-8", errors="replace")
    changed = False

    def replace_line(match: re.Match[str]) -> str:
        nonlocal changed
        prefix = match.group(1)
        status = match.group(2).strip()
        key = reviewer_key_for_label(prefix)
        if not key:
            return match.group(0)
        review_path = reviewer_output_path(latest_trial, key)
        reference = project_relative_path(project_root, review_path)
        file_status = reviewer_file_status(review_path)
        normalized_status = normalize_gate_status(status) if file_status == "missing" else file_status
        reason = "" if normalized_status == "pass" else " - current trial reviewer file is not pass"
        desired = f"- {REQUIRED_REVIEWER_OUTPUTS[key]['label']}: {normalized_status}{reason} - `{reference}`"
        if match.group(0).strip() == desired:
            return match.group(0)
        changed = True
        return desired

    updated = re.sub(
        r"^\s*[-*]\s*(Plan reviewer|Process reviewer|Evidence reviewer|Venue fit reviewer|Manuscript reviewer|Figure/table reviewer|Reference reviewer|Final gate reviewer)\s*:\s*(.+?)\s*$",
        replace_line,
        text,
        flags=re.MULTILINE,
    )
    cleaned = re.sub(r"^\s*[-*]\s*(?:Reviewer|Core) instructions are outdated \(baseline is outdated\)\.\s*$", "", updated, flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r"\nConsistency blockers:\s*\n(?=\s*Next action:)", "\n", cleaned)
    if cleaned != updated:
        updated = cleaned
        changed = True
    if not changed:
        return ""
    if not dry_run:
        backup_project_file(project_root, state_path, migration_dir, backed_up)
        state_path.write_text(updated.rstrip() + "\n", encoding="utf-8")
    return project_relative_path(project_root, state_path)


def migrate_active_review_storage(project_root: Path, migration_dir: Path, dry_run: bool = False) -> dict[str, Any]:
    trial_dirs = project_active_trial_dirs(project_root)
    latest_trial = trial_dirs[-1] if trial_dirs else None
    allow_latest_backfill = bool(latest_trial and project_gate_text_passed(project_root))
    latest_pass = latest_saved_pass_sections(project_root, trial_dirs)
    backed_up: list[str] = []
    created: list[str] = []
    backfilled: list[str] = []
    placeholders: list[str] = []

    for trial_dir in trial_dirs:
        legacy_path = trial_dir / "REVIEW.md"
        legacy_sections: dict[str, dict[str, Any]] = {}
        if legacy_path.exists():
            relative = project_relative_path(project_root, legacy_path)
            for section in parse_reviewer_sections(legacy_path.read_text(encoding="utf-8", errors="replace"), relative):
                legacy_sections[str(section["key"])] = section
        for key, config in REQUIRED_REVIEWER_OUTPUTS.items():
            target = reviewer_output_path(trial_dir, key)
            if target.exists():
                continue
            source = legacy_sections.get(key)
            context = "Created from the legacy trial REVIEW.md section during per-reviewer migration."
            if not source and allow_latest_backfill and latest_trial == trial_dir and key in latest_pass:
                source = latest_pass[key]
                context = (
                    "Backfilled from the latest saved passing reviewer output for the current active gate. "
                    "This preserves pass provenance but is not a fresh reviewer run for this trial."
                )
                backfilled.append(project_relative_path(project_root, target))
            elif not source:
                placeholders.append(project_relative_path(project_root, target))
            if dry_run:
                created.append(project_relative_path(project_root, target))
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if legacy_path.exists():
                backup_project_file(project_root, legacy_path, migration_dir, backed_up)
            if target.exists():
                backup_project_file(project_root, target, migration_dir, backed_up)
            if source:
                decision = str(source.get("decision") or "continue")
                gate = str(source.get("gate") or decision)
                confidence = str(source.get("confidence") or "medium")
                migration_source = str(source.get("path") or project_relative_path(project_root, legacy_path))
                body = str(source.get("text") or "")
            else:
                decision = "continue"
                gate = "continue"
                confidence = "low"
                migration_source = f"missing legacy {config['label']} section"
                body = ""
                context = "No legacy reviewer section existed for this active trial. This file records the missing review explicitly."
            target.write_text(
                format_reviewer_file(
                    project_root,
                    trial_dir,
                    key,
                    decision=decision,
                    gate=gate,
                    confidence=confidence,
                    migration_source=migration_source,
                    context_summary=context,
                    body=body,
                ),
                encoding="utf-8",
            )
            created.append(project_relative_path(project_root, target))

    normalized_manuscript_reviews: list[str] = []
    manuscript_reviews = project_root / "manuscript" / "reviews"
    if manuscript_reviews.is_dir():
        for path in sorted(manuscript_reviews.glob("*.md")):
            if path.name == ".gitkeep":
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            if "Source trial:" in text and "## Reviewed Inputs" in text and "Migration source:" in text:
                continue
            sections = parse_reviewer_sections(text, project_relative_path(project_root, path))
            section = sections[0] if sections else {}
            key = str(section.get("key") or "manuscript")
            source_trial = regex_first_value(text, [r"Source trial:\s*`?([^`\n]+)`?"])
            if not source_trial:
                trial_match = re.match(r"0*(\d+)", path.stem)
                source_trial = trial_match.group(1) if trial_match else path.stem
            insertion = "\n".join([
                f"Source trial: `{source_trial}`",
                f"Generated at: {now_iso()}",
                f"Instruction file: `{REQUIRED_REVIEWER_OUTPUTS.get(key, REQUIRED_REVIEWER_OUTPUTS['manuscript'])['instruction']}`",
                f"Migration source: `{project_relative_path(project_root, path)}`",
                "",
                "## Reviewed Inputs",
                "",
                "- `manuscript/BLUEPRINT.md`",
                "- `research_trajectory/STATE.md`",
                "- `research_trajectory/CURRENT_FINDINGS.md`",
                "",
                "## Context Summary",
                "",
                "Normalized active manuscript review metadata during per-reviewer migration.",
                "",
            ])
            if dry_run:
                normalized_manuscript_reviews.append(project_relative_path(project_root, path))
                continue
            backup_project_file(project_root, path, migration_dir, backed_up)
            if re.search(r"^Confidence:\s*.+?$", text, re.MULTILINE):
                text = re.sub(r"(^Confidence:\s*.+?$)", r"\1\n" + insertion, text, count=1, flags=re.MULTILINE)
            else:
                text = insertion + "\n" + text
            path.write_text(text.rstrip() + "\n", encoding="utf-8")
            normalized_manuscript_reviews.append(project_relative_path(project_root, path))

    normalized_state = normalize_state_gate_references(project_root, latest_trial, migration_dir, backed_up, dry_run)

    return {
        "storage_version": REVIEW_STORAGE_VERSION,
        "trial_count": len(trial_dirs),
        "created": created,
        "backfilled": backfilled,
        "placeholders": placeholders,
        "normalized_manuscript_reviews": normalized_manuscript_reviews,
        "normalized_state": normalized_state,
        "backed_up": backed_up,
        "outdated": bool(created or normalized_manuscript_reviews or normalized_state),
    }


def project_review_storage_status(project_root: Path) -> dict[str, Any]:
    missing: dict[str, list[str]] = {}
    nonpassing_latest: list[str] = []
    trial_dirs = project_active_trial_dirs(project_root)
    latest_trial = trial_dirs[-1] if trial_dirs else None
    for trial_dir in trial_dirs:
        trial_missing = []
        for key, config in REQUIRED_REVIEWER_OUTPUTS.items():
            path = reviewer_output_path(trial_dir, key)
            if not path.exists() or not path.is_file():
                trial_missing.append(config["file"])
                continue
            if latest_trial == trial_dir and project_gate_text_passed(project_root):
                text = path.read_text(encoding="utf-8", errors="replace")
                decision = normalize_gate_status(regex_first_value(text, [r"Decision:\s*`?([^`\n]+)`?"]))
                gate = normalize_gate_status(regex_first_value(text, [r"Gate impact:\s*`?([^`\n]+)`?"]))
                if decision != "pass" or gate != "pass":
                    nonpassing_latest.append(config["file"])
        if trial_missing:
            missing[trial_dir.name] = trial_missing
    state_missing_references: list[str] = []
    state_status_mismatches: list[str] = []
    state_stale_consistency_blockers: list[str] = []
    state_path = project_root / "research_trajectory" / "STATE.md"
    state_text = state_path.read_text(encoding="utf-8", errors="replace") if state_path.exists() else ""
    if latest_trial and state_text:
        if re.search(r"(?:Reviewer|Core) instructions are outdated \(baseline is outdated\)\.", state_text, re.IGNORECASE):
            state_stale_consistency_blockers.append("Core instructions are outdated (baseline is outdated).")
        for key, config in REQUIRED_REVIEWER_OUTPUTS.items():
            review_path = reviewer_output_path(latest_trial, key)
            expected = project_relative_path(project_root, review_path)
            if expected not in state_text:
                state_missing_references.append(expected)
            gate_match = re.search(rf"^\s*[-*]\s*{re.escape(config['label'])}\s*:\s*(.+?)\s*$", state_text, re.IGNORECASE | re.MULTILINE)
            if gate_match and review_path.exists():
                state_status = normalize_gate_status(gate_match.group(1))
                file_status = reviewer_file_status(review_path)
                if file_status != "missing" and state_status != file_status:
                    state_status_mismatches.append(f"{config['label']}: state {state_status}, file {file_status}")
    manuscript_missing = []
    manuscript_reviews = project_root / "manuscript" / "reviews"
    if manuscript_reviews.is_dir():
        for path in manuscript_reviews.glob("*.md"):
            if path.name == ".gitkeep":
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            if "Source trial:" not in text or "## Reviewed Inputs" not in text or "Migration source:" not in text:
                manuscript_missing.append(project_relative_path(project_root, path))
    return {
        "schema_version": 1,
        "storage_version": REVIEW_STORAGE_VERSION,
        "required_files": [config["file"] for config in REQUIRED_REVIEWER_OUTPUTS.values()],
        "missing_by_trial": missing,
        "nonpassing_latest": nonpassing_latest,
        "state_missing_references": state_missing_references,
        "state_status_mismatches": state_status_mismatches,
        "state_stale_consistency_blockers": state_stale_consistency_blockers,
        "manuscript_reviews_missing_metadata": manuscript_missing,
        "outdated": bool(missing or nonpassing_latest or state_missing_references or state_status_mismatches or state_stale_consistency_blockers or manuscript_missing),
    }


def project_reviewer_baseline_status(project_root: Path) -> dict[str, Any]:
    template_hashes = reviewer_template_hashes()
    project_dir = project_root / "instructions" / "reviewers"
    protocol_template_hash_map = protocol_template_hashes()
    instruction_dir = project_root / "instructions"
    missing: list[str] = []
    changed: list[str] = []
    project_hashes: dict[str, str] = {}
    for name in CORE_REVIEWER_FILES:
        template_hash = template_hashes.get(name, "")
        project_path = project_dir / name
        if not project_path.exists() or not project_path.is_file():
            missing.append(name)
            continue
        project_hash = file_sha256(project_path)
        project_hashes[name] = project_hash
        if template_hash and project_hash != template_hash:
            changed.append(name)
    protocol_missing: list[str] = []
    protocol_changed: list[str] = []
    protocol_hashes: dict[str, str] = {}
    for name in CORE_PROTOCOL_FILES:
        template_hash = protocol_template_hash_map.get(name, "")
        project_path = instruction_dir / name
        if not project_path.exists() or not project_path.is_file():
            protocol_missing.append(name)
            continue
        project_hash = file_sha256(project_path)
        protocol_hashes[name] = project_hash
        if template_hash and project_hash != template_hash:
            protocol_changed.append(name)
    metadata_path = project_root / REVIEWER_BASELINE_RELATIVE_PATH
    metadata: dict[str, Any] = {}
    if metadata_path.exists():
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata = payload if isinstance(payload, dict) else {}
        except (OSError, json.JSONDecodeError):
            metadata = {}
    metadata_hashes = metadata.get("coreReviewerFiles") if isinstance(metadata.get("coreReviewerFiles"), dict) else {}
    metadata_missing = [name for name in CORE_REVIEWER_FILES if metadata_hashes.get(name) != template_hashes.get(name)]
    protocol_metadata_hashes = metadata.get("coreProtocolFiles") if isinstance(metadata.get("coreProtocolFiles"), dict) else {}
    protocol_metadata_missing = [name for name in CORE_PROTOCOL_FILES if protocol_metadata_hashes.get(name) != protocol_template_hash_map.get(name)]
    baseline_version = str(metadata.get("reviewerBaselineVersion") or "")
    review_storage = project_review_storage_status(project_root)
    outdated = bool(
        missing
        or changed
        or metadata_missing
        or protocol_missing
        or protocol_changed
        or protocol_metadata_missing
        or baseline_version != REVIEWER_BASELINE_VERSION
        or review_storage.get("outdated")
    )
    return {
        "schema_version": 1,
        "baseline_version": baseline_version,
        "latest_baseline_version": REVIEWER_BASELINE_VERSION,
        "outdated": outdated,
        "missing": missing,
        "changed": changed,
        "metadata_missing": metadata_missing,
        "protocol_missing": protocol_missing,
        "protocol_changed": protocol_changed,
        "protocol_metadata_missing": protocol_metadata_missing,
        "metadata_path": REVIEWER_BASELINE_RELATIVE_PATH,
        "core_reviewer_files": CORE_REVIEWER_FILES,
        "core_protocol_files": CORE_PROTOCOL_FILES,
        "hashes": project_hashes,
        "protocol_hashes": protocol_hashes,
        "review_storage": review_storage,
    }


def sync_project_reviewers(project_root: Path) -> dict[str, Any]:
    template_dir = reviewer_template_dir()
    instruction_template = instruction_template_dir()
    project_dir = project_root / "instructions" / "reviewers"
    instruction_dir = project_root / "instructions"
    if not template_dir.exists():
        raise ValueError("Package reviewer template directory is missing.")
    if not instruction_template.exists():
        raise ValueError("Package instruction template directory is missing.")
    project_dir.mkdir(parents=True, exist_ok=True)
    instruction_dir.mkdir(parents=True, exist_ok=True)
    before = project_reviewer_baseline_status(project_root)
    migration_id = f"{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:8]}"
    migration_path = project_root / "archive" / "template_migrations" / migration_id
    backup_root = migration_path / "instructions" / "reviewers"
    protocol_backup_root = migration_path / "instructions"
    copied: list[str] = []
    backed_up: list[str] = []
    for name in CORE_REVIEWER_FILES:
        source = template_dir / name
        if not source.exists() or not source.is_file():
            raise ValueError(f"Package reviewer file is missing: {name}")
        target = project_dir / name
        if target.exists() and target.is_file():
            backup_root.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup_root / name)
            backed_up.append(name)
        shutil.copy2(source, target)
        copied.append(name)
    protocol_copied: list[str] = []
    protocol_backed_up: list[str] = []
    for name in CORE_PROTOCOL_FILES:
        source = instruction_template / name
        if not source.exists() or not source.is_file():
            raise ValueError(f"Package instruction file is missing: {name}")
        target = instruction_dir / name
        if target.exists() and target.is_file():
            protocol_backup_root.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, protocol_backup_root / name)
            protocol_backed_up.append(name)
        shutil.copy2(source, target)
        protocol_copied.append(name)
    metadata = write_reviewer_baseline_metadata(project_root, clean_template_root())
    manifest_path = migration_path / "MIGRATION.md"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    review_storage = migrate_active_review_storage(project_root, manifest_path.parent)
    manifest_path.write_text(
        "\n".join(
            [
                f"# Reviewer Migration {migration_id}",
                "",
                f"- Created: {now_iso()}",
                f"- Reviewer baseline: `{REVIEWER_BASELINE_VERSION}`",
                f"- Copied core reviewers: {len(copied)}",
                f"- Backed up previous core reviewers: {len(backed_up)}",
                f"- Copied core protocol instructions: {len(protocol_copied)}",
                f"- Backed up previous core protocol instructions: {len(protocol_backed_up)}",
                f"- Metadata: `{REVIEWER_BASELINE_RELATIVE_PATH}`",
                f"- Review storage version: `{REVIEW_STORAGE_VERSION}`",
                f"- Created per-reviewer files: {len(review_storage['created'])}",
                f"- Backfilled latest-gate files: {len(review_storage['backfilled'])}",
                f"- Explicit missing-review placeholders: {len(review_storage['placeholders'])}",
                f"- Normalized manuscript reviews: {len(review_storage['normalized_manuscript_reviews'])}",
                "",
                "Custom reviewer files outside the core reviewer set were preserved.",
                "Custom instruction files outside the core protocol set were preserved.",
                "Archived restart/resume history was not rewritten.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return {
        "ok": True,
        "migration_id": migration_id,
        "backup_path": str(migration_path.relative_to(project_root)) if migration_path.exists() else "",
        "copied": copied,
        "backed_up": backed_up,
        "protocol_copied": protocol_copied,
        "protocol_backed_up": protocol_backed_up,
        "review_storage": review_storage,
        "before": before,
        "after": project_reviewer_baseline_status(project_root),
        "metadata": metadata,
    }


def finalize_created_project(target: Path, display_name: str, template_root: Path) -> None:
    template_gitignore = target / ".gitignore.template"
    gitignore = target / ".gitignore"
    if template_gitignore.exists():
        if not gitignore.exists():
            template_gitignore.rename(gitignore)
        else:
            template_gitignore.unlink()

    manifest_path = template_root / ".co-auto-research-template" / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        manifest = {}

    metadata_dir = target / ".co-auto-research"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    metadata_path = metadata_dir / "project.json"
    if not metadata_path.exists():
        payload = {
            "schemaVersion": 1,
            "projectId": str(uuid.uuid4()),
            "displayName": display_name[:120],
            "createdAt": f"{datetime.utcnow().isoformat(timespec='seconds')}Z",
            "templateVersion": str(manifest.get("templateVersion") or "0.1.0"),
        }
        metadata_path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")
    write_reviewer_baseline_metadata(target, template_root)


def template_root_for_project_creation() -> Path:
    root = clean_template_root()
    if (root / ".co-auto-research-template" / "manifest.json").exists() and not (root / ".co-auto-research" / "project.json").exists():
        return root
    raise ValueError(
        "Clean package template is not available to this UI server. "
        "Start the UI with `co-auto-research ui --projects-dir <dir>` or set COAUTO_TEMPLATE_ROOT."
    )


def create_generated_project(projects_dir: Path, payload: dict[str, Any], template_root: Path | None = None) -> Path:
    if not projects_dir:
        raise ValueError("Project creation requires dashboard mode.")
    template_root = (template_root or template_root_for_project_creation()).resolve()
    manifest_path = template_root / ".co-auto-research-template" / "manifest.json"
    if not manifest_path.exists():
        raise ValueError("Template manifest is missing; start the dashboard with the package CLI.")

    display_name = str(payload.get("name") or payload.get("displayName") or "").strip()
    directory_name = project_directory_slug(str(payload.get("directory") or display_name))
    base = projects_dir.resolve()
    target = (base / directory_name).resolve()
    if target == base or base not in target.parents:
        raise ValueError("Project path escapes the dashboard projects directory.")
    if target.exists():
        if not target.is_dir():
            raise ValueError(f"Project target exists and is not a directory: {directory_name}")
        try:
            has_entries = any(target.iterdir())
        except OSError as exc:
            raise ValueError(f"Cannot inspect project target: {exc}") from exc
        if has_entries:
            blockers = project_stub_blockers(target)
            if not blockers:
                shutil.rmtree(target)
            else:
                sample = ", ".join(blockers[:8])
                suffix = "" if len(blockers) <= 8 else f", and {len(blockers) - 8} more"
                raise ValueError(f"Project directory already exists: {directory_name}. Blocking entries: {sample}{suffix}")

    target.mkdir(parents=True, exist_ok=True)
    shutil.copytree(template_root, target, ignore=template_copy_ignore(template_root), dirs_exist_ok=True)
    finalize_created_project(target, display_name or directory_name, template_root)
    return target


def is_recreatable_project_stub(root: Path) -> bool:
    """Return true for safe leftovers from a just-deleted project poll."""
    return not project_stub_blockers(root)


def project_stub_blockers(root: Path) -> list[str]:
    if is_project_root(root):
        return ["valid project files"]
    allowed_files = {
        ".DS_Store",
        "research_trajectory/TRAJECTORY.json",
    }
    allowed_dirs = {
        "research_trajectory",
        "ui",
        "ui/.runtime",
    }
    try:
        entries = list(root.rglob("*"))
    except OSError:
        return ["unreadable directory"]
    blockers: list[str] = []
    for entry in entries:
        try:
            relative = entry.relative_to(root).as_posix()
        except ValueError:
            blockers.append(str(entry))
            continue
        if entry.is_dir():
            if relative not in allowed_dirs and not relative.startswith("ui/.runtime/"):
                blockers.append(relative)
        elif relative not in allowed_files and not relative.startswith("ui/.runtime/"):
            blockers.append(relative)
    return blockers


def is_project_root(root: Path) -> bool:
    return (
        (root / ".co-auto-research-template" / "manifest.json").exists()
        or ((root / "AGENTS.md").exists() and (root / "PROJECT.md").exists() and (root / "ui" / "server.py").exists())
    )


def project_title_from_file(root: Path) -> str:
    path = root / "PROJECT.md"
    if not path.exists():
        return ""
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            text = line.strip()
            if text.startswith("# "):
                title = text.removeprefix("# ").strip()
                if title and "<" not in title:
                    return title[:120]
    except OSError:
        return ""
    return ""


class ProjectContext:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.ui_dir = self.root / "ui"
        self.runtime_dir = self.ui_dir / ".runtime"
        self.session_state_path = self.runtime_dir / "research_session.json"
        self.ui_settings_path = self.runtime_dir / "settings.json"
        self.framing_messages_path = self.runtime_dir / "framing_messages.json"
        self.research_state_path = self.root / "research_trajectory" / "STATE.md"
        self.trajectory_path = self.root / "research_trajectory" / "TRAJECTORY.json"
        self.session = new_research_session()
        self.lock = threading.RLock()
        self.research_events: list[dict[str, Any]] = []
        self.research_event_id = 0
        self.research_event_condition = threading.Condition(threading.RLock())
        self.deleted = False
        self.aux_manager = AuxSessionManager(self, sys.modules[__name__])
        self.refresh_metadata()
        self.load_runtime()

    def refresh_metadata(self) -> None:
        metadata = read_project_metadata(self.root)
        self.id = str(metadata.get("projectId") or "").strip() or project_id_for_path(self.root)
        self.display_name = str(metadata.get("displayName") or "").strip() or self.root.name or "project"
        self.created_at = str(metadata.get("createdAt") or "").strip()
        self.template_version = str(metadata.get("templateVersion") or "").strip() or read_template_version(self.root)

    def load_runtime(self) -> None:
        if not self.session_state_path.exists():
            return
        try:
            payload = json.loads(self.session_state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(payload, dict):
            return
        with self.lock:
            for key in (
                "id",
                "session_id",
                "mode",
                "command",
                "settings",
                "started_at",
                "ended_at",
                "returncode",
                "logs",
                "raw_logs",
                "transcript",
                "loop_active",
                "loop_iteration",
                "loop_max_iterations",
                "loop_review_checkpoint_iteration",
                "loop_stop_reason",
                "gate",
                "last_event_at",
                "last_event_summary",
                "agent_notice",
                "plan_id",
                "plan_thread_id",
                "plan_turn_id",
            ):
                if key in payload:
                    self.session[key] = payload[key]
            previous_status = str(payload.get("status") or "idle")
            self.session["status"] = "interrupted" if previous_status in {"running", "stopping"} else previous_status
            self.session["process"] = None

    def summary(self) -> dict[str, Any]:
        with self.lock:
            proc = self.session.get("process")
            running = bool(proc and proc.poll() is None)
            status = "running" if running else str(self.session.get("status") or "idle")
            session_id = str(self.session.get("session_id") or "")
            mode = str(self.session.get("mode") or "")
            loop_active = bool(self.session.get("loop_active"))
        project_path = self.root / "PROJECT.md"
        has_project = project_path.exists()
        return {
            "id": self.id,
            "display_name": self.display_name,
            "title": project_title_from_file(self.root) or self.display_name,
            "root": str(self.root),
            "template_version": self.template_version,
            "created_at": self.created_at,
            "status": status,
            "mode": mode,
            "session_id": session_id,
            "has_session": bool(session_id),
            "loop_active": loop_active,
            "project_ready": has_project and project_path.stat().st_size > 0 if has_project else False,
            "reviewer_status": project_reviewer_baseline_status(self.root),
        }


class ProjectRegistry:
    def __init__(self, project_root: Path, projects_dir: Path | None = None):
        self.project_root = project_root.resolve()
        self.projects_dir = projects_dir.resolve() if projects_dir else None
        self.contexts: dict[str, ProjectContext] = {}
        self.order: list[str] = []
        self.refresh()

    @property
    def multi_project(self) -> bool:
        return self.projects_dir is not None

    def discover_roots(self) -> list[Path]:
        if not self.projects_dir:
            return [self.project_root]
        base = self.projects_dir
        candidates = [base]
        try:
            candidates.extend(sorted([item for item in base.iterdir() if item.is_dir()], key=lambda item: item.name.lower()))
        except OSError:
            candidates = [base]
        roots: list[Path] = []
        seen: set[Path] = set()
        for candidate in candidates:
            try:
                root = candidate.resolve()
            except OSError:
                continue
            if root in seen or not is_project_root(root):
                continue
            seen.add(root)
            roots.append(root)
        if self.projects_dir:
            return roots
        return [self.project_root] if is_project_root(self.project_root) else []

    def refresh(self) -> None:
        existing = {str(context.root): context for context in self.contexts.values()}
        contexts: dict[str, ProjectContext] = {}
        order: list[str] = []
        for root in self.discover_roots():
            key = str(root)
            context = existing.get(key) or ProjectContext(root)
            context.refresh_metadata()
            contexts[context.id] = context
            order.append(context.id)
        self.contexts = contexts
        self.order = order

    def default_context(self) -> ProjectContext:
        if not self.contexts:
            self.refresh()
        if not self.contexts:
            raise ValueError("No CoAutoResearch projects found.")
        return self.contexts[self.order[0]]

    def context_for_alias(self, value: str) -> ProjectContext | None:
        text = str(value or "").strip()
        if not text:
            return None
        text_lower = text.lower()
        normalized_path = text.replace("\\", "/").strip("/")
        normalized_path_lower = normalized_path.lower()
        resolved_path = None
        try:
            path = Path(text).expanduser()
            if path.is_absolute() or path.exists():
                resolved_path = path.resolve()
        except OSError:
            resolved_path = None
        for project_id in self.order:
            context = self.contexts.get(project_id)
            if not context:
                continue
            if getattr(context, "deleted", False):
                continue
            candidates = {
                context.id,
                context.display_name,
                context.root.name,
                project_directory_slug(context.display_name),
                str(context.root),
            }
            if self.projects_dir:
                try:
                    candidates.add(context.root.relative_to(self.projects_dir).as_posix())
                except ValueError:
                    pass
            lowered = {candidate.lower() for candidate in candidates if candidate}
            path_like = {candidate.replace("\\", "/").strip("/").lower() for candidate in candidates if candidate}
            if text_lower in lowered or normalized_path_lower in path_like:
                return context
            if resolved_path and resolved_path == context.root.resolve():
                return context
        return None

    def context_for(self, project_id: str = "") -> ProjectContext:
        if not project_id:
            return self.default_context()
        context = self.contexts.get(project_id)
        if context and not getattr(context, "deleted", False) and is_project_root(context.root):
            return context
        self.refresh()
        context = self.contexts.get(project_id)
        if context and not getattr(context, "deleted", False) and is_project_root(context.root):
            return context
        context = self.context_for_alias(project_id)
        if not context:
            raise ValueError(f"Unknown project: {project_id}")
        return context

    def summaries(self) -> list[dict[str, Any]]:
        return [self.contexts[project_id].summary() for project_id in self.order if project_id in self.contexts]

    def ensure_managed_child_project(self, context: ProjectContext) -> None:
        if not self.projects_dir:
            raise ValueError("Project management requires dashboard mode.")
        base = self.projects_dir.resolve()
        root = context.root.resolve()
        if root == base:
            raise ValueError("Cannot rename or delete the dashboard root as a project.")
        if base not in root.parents:
            raise ValueError("Project is outside the dashboard projects directory.")

    def create_project(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.projects_dir:
            self.projects_dir = self.project_root.parent.resolve()
        root = create_generated_project(self.projects_dir, payload)
        backend = (
            payload.get("agentBackend")
            or payload.get("backend")
            or ((payload.get("agent") or {}).get("backend") if isinstance(payload.get("agent"), dict) else "")
        )
        write_default_project_ui_settings(root, backend)
        self.refresh()
        resolved = root.resolve()
        for project_id in self.order:
            context = self.contexts.get(project_id)
            if context and context.root == resolved:
                return context.summary()
        raise ValueError("Project was created but could not be loaded.")

    def rename_project(self, payload: dict[str, Any]) -> dict[str, Any]:
        project_id = str(payload.get("project") or payload.get("projectId") or "").strip()
        display_name = str(payload.get("name") or payload.get("displayName") or "").strip()
        if not project_id:
            raise ValueError("Project id is required.")
        if not display_name:
            raise ValueError("Project name is required.")
        context = self.context_for(project_id)
        self.ensure_managed_child_project(context)
        metadata = read_project_metadata(context.root)
        metadata.update(
            {
                "schemaVersion": int(metadata.get("schemaVersion") or 1),
                "projectId": context.id,
                "displayName": display_name[:120],
                "createdAt": metadata.get("createdAt") or context.created_at or f"{datetime.utcnow().isoformat(timespec='seconds')}Z",
                "templateVersion": metadata.get("templateVersion") or context.template_version or read_template_version(context.root),
            }
        )
        write_project_metadata(context.root, metadata)
        self.refresh()
        return self.context_for(project_id).summary()

    def delete_project(self, payload: dict[str, Any]) -> dict[str, Any]:
        project_id = str(payload.get("project") or payload.get("projectId") or "").strip()
        confirm = str(payload.get("confirm") or "").strip()
        if not project_id:
            raise ValueError("Project id is required.")
        context = self.context_for(project_id)
        self.ensure_managed_child_project(context)
        expected = context.display_name
        if confirm != expected:
            raise ValueError(f"Type the project name to confirm deletion: {expected}")
        context.deleted = True
        try:
            stopped_run = self.stop_project_run_for_delete(context)
            root = context.root.resolve()
            shutil.rmtree(root)
            self.refresh()
        except Exception:
            context.deleted = False
            self.refresh()
            raise
        projects = self.summaries()
        return {
            "deleted_project_id": project_id,
            "stopped_active_run": stopped_run,
            "active_project_id": projects[0]["id"] if projects else "",
            "projects": projects,
            "multi_project": self.multi_project,
        }

    def stop_project_run_for_delete(self, context: ProjectContext) -> bool:
        with context.lock:
            proc = context.session.get("process")
            thread = context.session.get("process_thread")
            running = bool(proc and proc.poll() is None)
            if not running:
                context.session["loop_active"] = False
                return False
            context.session["status"] = "stopping"
            context.session["loop_active"] = False
            context.session["loop_stop_reason"] = "deleted_project"
            context.session.setdefault("logs", []).append("Stop requested because the project is being deleted.")
        try:
            proc.terminate()
        except OSError:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
            except OSError:
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                raise ValueError("Could not stop the active agent run before deleting this project.")
        if isinstance(thread, threading.Thread):
            thread.join(timeout=5)
        deadline = time.time() + 2
        while time.time() < deadline:
            with context.lock:
                active_proc = context.session.get("process")
                if active_proc is None or active_proc.poll() is not None:
                    break
            time.sleep(0.05)
        with context.lock:
            context.session["process"] = None
            context.session["process_thread"] = None
            context.session["status"] = "stopped"
            context.session["returncode"] = proc.returncode
            context.session["ended_at"] = now_iso()
            context.session["loop_active"] = False
            context.session["loop_stop_reason"] = "deleted_project"
        return True


PROJECT_REGISTRY: ProjectRegistry | None = None
UI_REMOTE_MODE = False
_BOOTSTRAP_CONTEXT: ProjectContext | None = None
_CONTEXT = threading.local()


def current_project_context() -> ProjectContext:
    context = getattr(_CONTEXT, "project", None)
    if context is not None:
        return context
    if PROJECT_REGISTRY is not None:
        return PROJECT_REGISTRY.default_context()
    global _BOOTSTRAP_CONTEXT
    if _BOOTSTRAP_CONTEXT is None:
        _BOOTSTRAP_CONTEXT = ProjectContext(DEFAULT_PROJECT_ROOT)
    return _BOOTSTRAP_CONTEXT


def current_project_writeable() -> bool:
    context = current_project_context()
    if getattr(context, "deleted", False):
        return False
    if PROJECT_REGISTRY and PROJECT_REGISTRY.multi_project and not is_project_root(context.root):
        return False
    return True


def ensure_current_project_writeable() -> None:
    context = current_project_context()
    if getattr(context, "deleted", False):
        raise ValueError("Project was deleted.")
    if not current_project_writeable():
        raise ValueError("Project is no longer available.")


@contextmanager
def using_project(project_id: str = ""):
    previous = getattr(_CONTEXT, "project", None)
    _CONTEXT.project = (PROJECT_REGISTRY.context_for(project_id) if PROJECT_REGISTRY else current_project_context())
    try:
        yield _CONTEXT.project
    finally:
        if previous is None:
            try:
                delattr(_CONTEXT, "project")
            except AttributeError:
                pass
        else:
            _CONTEXT.project = previous


def run_in_project(context: ProjectContext, callback: Any, *args: Any) -> Any:
    with using_project(context.id):
        return callback(*args)


class DynamicPath:
    def __init__(self, getter: Any):
        self.getter = getter

    def path(self) -> Path:
        return self.getter()

    def __fspath__(self) -> str:
        return os.fspath(self.path())

    def __str__(self) -> str:
        return str(self.path())

    def __repr__(self) -> str:
        return repr(self.path())

    def __truediv__(self, value: str | Path) -> Path:
        return self.path() / value

    def __eq__(self, other: Any) -> bool:
        try:
            return self.path() == Path(other)
        except TypeError:
            return False

    def __getattr__(self, name: str) -> Any:
        return getattr(self.path(), name)


class DynamicDict:
    def __init__(self, getter: Any):
        self.getter = getter

    def target(self) -> dict[str, Any]:
        return self.getter()

    def get(self, key: str, default: Any = None) -> Any:
        return self.target().get(key, default)

    def update(self, *args: Any, **kwargs: Any) -> None:
        self.target().update(*args, **kwargs)

    def items(self):
        return self.target().items()

    def keys(self):
        return self.target().keys()

    def values(self):
        return self.target().values()

    def __getitem__(self, key: str) -> Any:
        return self.target()[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.target()[key] = value

    def __contains__(self, key: object) -> bool:
        return key in self.target()

    def __iter__(self):
        return iter(self.target())

    def __len__(self) -> int:
        return len(self.target())


class DynamicLock:
    def __enter__(self) -> Any:
        return current_project_context().lock.__enter__()

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> Any:
        return current_project_context().lock.__exit__(exc_type, exc, tb)


REPO_ROOT = DynamicPath(lambda: current_project_context().root)
RUNTIME_DIR = DynamicPath(lambda: current_project_context().runtime_dir)
SESSION_STATE_PATH = DynamicPath(lambda: current_project_context().session_state_path)
UI_SETTINGS_PATH = DynamicPath(lambda: current_project_context().ui_settings_path)
FRAMING_MESSAGES_PATH = DynamicPath(lambda: current_project_context().framing_messages_path)
RESEARCH_STATE_PATH = DynamicPath(lambda: current_project_context().research_state_path)
TRAJECTORY_PATH = DynamicPath(lambda: current_project_context().trajectory_path)
RESEARCH_SESSION = DynamicDict(lambda: current_project_context().session)
RESEARCH_LOCK = DynamicLock()
EXPORT_JOBS: dict[str, dict[str, Any]] = {}
EXPORT_LOCK = threading.Lock()
FIGURE_IMAGE_JOBS: dict[str, dict[str, Any]] = {}
FIGURE_IMAGE_LOCK = threading.Lock()
FIGURE_BLUEPRINT_LOCK = threading.Lock()
SESSION_STARTUP_GRACE_SECONDS = 5


def dashboard_runtime_dir() -> Path:
    if PROJECT_REGISTRY and PROJECT_REGISTRY.projects_dir:
        return PROJECT_REGISTRY.projects_dir / ".co-auto-research" / "ui"
    return DEFAULT_PROJECT_ROOT / "ui" / ".runtime"


def current_ui_settings_path() -> Path:
    try:
        return Path(os.fspath(UI_SETTINGS_PATH))
    except ValueError:
        return dashboard_runtime_dir() / "settings.json"

DEFAULT_CODEX_SETTINGS = {
    "provider": "cli",
    "model": "gpt-5.5",
    "reasoningEffort": "medium",
    "permissionPreset": "default",
    "sandbox": "workspace-write",
    "approvalPolicy": "on-request",
    "webSearch": True,
    "fastMode": False,
    "extraConfig": "",
    "preExecScript": "",
    "reviewCheckpointInterval": DEFAULT_REVIEW_CHECKPOINT_INTERVAL,
}
DEFAULT_CLAUDE_SETTINGS = {
    "model": "sonnet",
    "reasoningEffort": "high",
    "permissionPreset": "auto",
    "permissionMode": "auto",
    "provider": "external",
    "webSearch": True,
    "fastMode": False,
    "extraConfig": "",
    "preExecScript": "",
    "reviewCheckpointInterval": DEFAULT_REVIEW_CHECKPOINT_INTERVAL,
}
DEFAULT_AGENT_SETTINGS = {"backend": "codex"}
ALLOWED_AGENT_BACKENDS = {"codex", "claude"}
ALLOWED_CODEX_MODELS = {"gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"}
ALLOWED_CLAUDE_MODEL_ALIASES = {"best", "default", "haiku", "opus", "opus[1m]", "opusplan", "opusplan[1m]", "sonnet", "sonnet[1m]"}
DISABLED_CLAUDE_MODEL_MARKERS = {"fable"}
SECRET_ENV_KEYS = [
    "GITHUB_TOKEN",
    "HF_TOKEN",
]
ALLOWED_CODEX_PROVIDERS = {"cli", "openai_api_key"}
CODEX_ENV_KEYS = [
    "OPENAI_API_KEY",
]
CODEX_SECRET_ENV_KEYS = {"OPENAI_API_KEY"}
CODEX_NONSECRET_ENV_KEYS = [key for key in CODEX_ENV_KEYS if key not in CODEX_SECRET_ENV_KEYS]
ALLOWED_CLAUDE_PROVIDERS = {"external", "anthropic_api_key", "zai_glm", "custom_anthropic"}
CLAUDE_ENV_KEYS = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "API_TIMEOUT_MS",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
]
CLAUDE_SECRET_ENV_KEYS = {"ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"}
CLAUDE_NONSECRET_ENV_KEYS = [key for key in CLAUDE_ENV_KEYS if key not in CLAUDE_SECRET_ENV_KEYS]
ZAI_GLM_CLAUDE_ENV_DEFAULTS = {
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.5-air",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.2[1m]",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.2[1m]",
}

ALLOWED_SANDBOXES = {"read-only", "workspace-write", "danger-full-access"}
ALLOWED_APPROVAL_POLICIES = {"untrusted", "on-request", "never"}
ALLOWED_CODEX_REASONING_EFFORTS = {"low", "medium", "high", "xhigh"}
CLAUDE_REASONING_EFFORTS_BY_FAMILY = {
    "opusRecent": {"low", "medium", "high", "xhigh", "max"},
    "opus46": {"low", "medium", "high", "max"},
    "opus": {"low", "medium", "high", "xhigh", "max"},
    "sonnet": {"low", "medium", "high", "max"},
    "defaultOnly": {""},
}
AGENT_IDLE_NOTICE_SECONDS = 180
# A rate-limit notice is dropped once events resume within this window — if the
# agent is still producing events this recently, it is not actually rate limited.
AGENT_RATE_LIMIT_CLEAR_SECONDS = 30
AGENT_RATE_LIMIT_PATTERN = re.compile(
    r"\b(rate[-\s]?limit(?:ed|ing)?|429|too many requests|quota exceeded|usage limit|resource_exhausted)\b",
    re.IGNORECASE,
)
PERMISSION_PRESETS = {
    "default": {"sandbox": "workspace-write", "approvalPolicy": "on-request"},
    "auto-review": {"sandbox": "workspace-write", "approvalPolicy": "never"},
    "full-access": {"sandbox": "danger-full-access", "approvalPolicy": "never"},
}
CLAUDE_PERMISSION_PRESETS = {
    "default": {"permissionMode": "default"},
    "acceptEdits": {"permissionMode": "acceptEdits"},
    "plan": {"permissionMode": "plan"},
    "auto": {"permissionMode": "auto"},
    "dontAsk": {"permissionMode": "dontAsk"},
    "bypassPermissions": {"permissionMode": "bypassPermissions"},
}
LEGACY_CLAUDE_PERMISSION_PRESETS = {
    "auto-review": "auto",
    "full-access": "bypassPermissions",
    "accept-edits": "acceptEdits",
    "dont-ask": "dontAsk",
    "bypass-permissions": "bypassPermissions",
}


def normalize_agent_backend(value: Any = "") -> str:
    backend = str(value or "").strip().lower()
    return backend if backend in ALLOWED_AGENT_BACKENDS else DEFAULT_AGENT_SETTINGS["backend"]


def normalize_codex_provider(value: Any = "") -> str:
    provider = str(value or "").strip().lower().replace("-", "_")
    aliases = {
        "openai": "openai_api_key",
        "api_key": "openai_api_key",
        "openai_key": "openai_api_key",
    }
    provider = aliases.get(provider, provider)
    return provider if provider in ALLOWED_CODEX_PROVIDERS else DEFAULT_CODEX_SETTINGS["provider"]


def normalize_claude_provider(value: Any = "") -> str:
    provider = str(value or "").strip().lower().replace("-", "_")
    aliases = {
        "anthropic": "anthropic_api_key",
        "api_key": "anthropic_api_key",
        "gateway": "custom_anthropic",
        "custom": "custom_anthropic",
    }
    provider = aliases.get(provider, provider)
    return provider if provider in ALLOWED_CLAUDE_PROVIDERS else DEFAULT_CLAUDE_SETTINGS["provider"]


def normalize_codex_env_values(payload: Any) -> dict[str, str]:
    values = payload if isinstance(payload, dict) else {}
    normalized: dict[str, str] = {}
    for key in CODEX_ENV_KEYS:
        value = str(values.get(key) or "").strip()
        if value:
            normalized[key] = value
    return normalized


def normalize_claude_env_values(payload: Any) -> dict[str, str]:
    values = payload if isinstance(payload, dict) else {}
    normalized: dict[str, str] = {}
    for key in CLAUDE_ENV_KEYS:
        value = str(values.get(key) or "").strip()
        if value:
            normalized[key] = value
    return normalized


def codex_env_for_provider(provider: Any, values: Any = None) -> dict[str, str]:
    if normalize_codex_provider(provider) != "openai_api_key":
        return {}
    return normalize_codex_env_values(values)


def claude_env_for_provider(provider: Any, values: Any = None) -> dict[str, str]:
    normalized_provider = normalize_claude_provider(provider)
    env = normalize_claude_env_values(values)
    if normalized_provider == "anthropic_api_key":
        return {key: value for key, value in env.items() if key == "ANTHROPIC_API_KEY"}
    if normalized_provider == "zai_glm":
        merged = dict(ZAI_GLM_CLAUDE_ENV_DEFAULTS)
        merged.update(env)
        return merged
    if normalized_provider == "custom_anthropic":
        return env
    return {}


def normalize_pre_exec_script(value: Any) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    return text.strip()[:PRE_EXEC_SCRIPT_MAX_CHARS]


def raw_agent_backend_from_env(env: dict[str, str] | None = None) -> str:
    process_env = env if env is not None else os.environ
    return str(process_env.get("COAUTO_AGENT_BACKEND") or "").strip().lower()


def valid_agent_backend_from_env(env: dict[str, str] | None = None) -> str:
    backend = raw_agent_backend_from_env(env)
    return backend if backend in ALLOWED_AGENT_BACKENDS else ""


def agent_backend_env_warning(env: dict[str, str] | None = None) -> str:
    backend = raw_agent_backend_from_env(env)
    if backend and backend not in ALLOWED_AGENT_BACKENDS:
        return f"Ignoring invalid COAUTO_AGENT_BACKEND={backend!r}; expected `codex` or `claude`."
    return ""


def selected_agent_backend_from_env(env: dict[str, str] | None = None) -> str:
    return valid_agent_backend_from_env(env) or DEFAULT_AGENT_SETTINGS["backend"]


def infer_permission_preset(settings: dict[str, Any]) -> str:
    preset = str(settings.get("permissionPreset") or "").strip()
    if preset in PERMISSION_PRESETS:
        return preset
    sandbox = str(settings.get("sandbox") or "").strip()
    approval = str(settings.get("approvalPolicy") or "").strip()
    if sandbox == "danger-full-access" and approval == "never":
        return "full-access"
    if sandbox == "workspace-write" and approval == "never":
        return "auto-review"
    return "default"


def apply_permission_preset(settings: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(settings)
    preset = infer_permission_preset(normalized)
    normalized["permissionPreset"] = preset
    normalized.update(PERMISSION_PRESETS[preset])
    return normalized


def infer_claude_permission_preset(settings: dict[str, Any]) -> str:
    preset = str(settings.get("permissionPreset") or "").strip()
    if preset in CLAUDE_PERMISSION_PRESETS:
        return preset
    if preset in LEGACY_CLAUDE_PERMISSION_PRESETS:
        return LEGACY_CLAUDE_PERMISSION_PRESETS[preset]
    mode = str(settings.get("permissionMode") or "").strip()
    for candidate, config in CLAUDE_PERMISSION_PRESETS.items():
        if config["permissionMode"] == mode:
            return candidate
    return DEFAULT_CLAUDE_SETTINGS["permissionPreset"]


def apply_claude_permission_preset(settings: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(settings)
    preset = infer_claude_permission_preset(normalized)
    normalized["permissionPreset"] = preset
    normalized.update(CLAUDE_PERMISSION_PRESETS[preset])
    return normalized


def normalize_codex_model(value: Any, fallback: str | None = None) -> str:
    model = str(value or "").strip()
    default = fallback or DEFAULT_CODEX_SETTINGS["model"]
    if not model:
        return default
    return model if model in ALLOWED_CODEX_MODELS else default


def normalize_claude_model(value: Any, fallback: str | None = None) -> str:
    model = str(value or "").strip()
    default = fallback or DEFAULT_CLAUDE_SETTINGS["model"]
    if not model:
        return default
    lowered = model.lower()
    if lowered in ALLOWED_CODEX_MODELS:
        return default
    if any(marker in lowered for marker in DISABLED_CLAUDE_MODEL_MARKERS):
        return default
    if model in ALLOWED_CLAUDE_MODEL_ALIASES:
        return model
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/+\-\[\]]{1,140}", model):
        return model
    return default


def claude_model_family(model: Any) -> str:
    value = str(model or "").strip().lower()
    if value == "best":
        return "opusRecent"
    if "fable" in value:
        return "defaultOnly"
    if "opus" in value:
        if re.search(r"\bopus[-_]?4[-_]?6\b", value):
            return "opus46"
        return "opusRecent"
    if "sonnet" in value:
        if re.search(r"\bsonnet[-_]?4[-_]?5\b", value):
            return "defaultOnly"
        return "sonnet"
    if "haiku" in value:
        return "defaultOnly"
    return "defaultOnly"


def allowed_reasoning_efforts(backend: Any, model: Any = "") -> set[str]:
    normalized = normalize_agent_backend(backend)
    if normalized == "codex":
        return set(ALLOWED_CODEX_REASONING_EFFORTS)
    return set(CLAUDE_REASONING_EFFORTS_BY_FAMILY.get(claude_model_family(model), CLAUDE_REASONING_EFFORTS_BY_FAMILY["defaultOnly"]))


def default_reasoning_effort(backend: Any, model: Any = "") -> str:
    normalized = normalize_agent_backend(backend)
    if normalized == "codex":
        return DEFAULT_CODEX_SETTINGS["reasoningEffort"]
    allowed = allowed_reasoning_efforts(normalized, model)
    if "high" in allowed:
        return "high"
    return ""


def normalize_reasoning_effort(value: Any, backend: Any = "codex", model: Any = "") -> str:
    reasoning = str(value or "").strip()
    allowed = allowed_reasoning_efforts(backend, model)
    return reasoning if reasoning in allowed else default_reasoning_effort(backend, model)


def normalize_codex_settings(payload: Any, base: dict[str, Any] | None = None) -> dict[str, Any]:
    values = payload if isinstance(payload, dict) else {}
    settings = dict(DEFAULT_CODEX_SETTINGS)
    if base:
        settings.update({key: value for key, value in base.items() if key in DEFAULT_CODEX_SETTINGS})
    for key in DEFAULT_CODEX_SETTINGS:
        if key not in values:
            continue
        if key == "model":
            settings[key] = normalize_codex_model(values[key], settings.get("model"))
        elif key == "provider":
            settings[key] = normalize_codex_provider(values[key])
        elif key == "approvalPolicy":
            approval = str(values[key]).strip()
            settings[key] = approval if approval in ALLOWED_APPROVAL_POLICIES else settings.get("approvalPolicy") or DEFAULT_CODEX_SETTINGS["approvalPolicy"]
        elif key == "permissionPreset":
            preset = str(values[key]).strip()
            settings[key] = preset if preset in PERMISSION_PRESETS else infer_permission_preset(settings)
        elif key == "reasoningEffort":
            settings[key] = normalize_reasoning_effort(values[key], "codex", settings.get("model"))
        elif key == "reviewCheckpointInterval":
            settings[key] = normalize_review_checkpoint_interval(values[key])
        elif key == "webSearch":
            settings[key] = bool(values[key])
        elif key == "fastMode":
            settings[key] = bool(values[key])
        elif key == "extraConfig":
            settings[key] = str(values[key] or "").strip()[:4000]
        elif key == "preExecScript":
            settings[key] = normalize_pre_exec_script(values[key])
        elif key == "sandbox":
            sandbox = str(values[key]).strip()
            if sandbox in ALLOWED_SANDBOXES:
                settings[key] = sandbox
        else:
            settings[key] = values[key]
    settings["reasoningEffort"] = normalize_reasoning_effort(settings.get("reasoningEffort"), "codex", settings.get("model"))
    settings["reviewCheckpointInterval"] = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
    return apply_permission_preset(settings)


def normalize_claude_settings(payload: Any, base: dict[str, Any] | None = None) -> dict[str, Any]:
    values = payload if isinstance(payload, dict) else {}
    settings = dict(DEFAULT_CLAUDE_SETTINGS)
    if base:
        settings.update({key: value for key, value in base.items() if key in DEFAULT_CLAUDE_SETTINGS})
    for key in DEFAULT_CLAUDE_SETTINGS:
        if key not in values:
            continue
        if key == "model":
            settings[key] = normalize_claude_model(values[key], settings.get("model"))
        elif key == "permissionPreset":
            preset = str(values[key]).strip()
            settings[key] = preset if preset in CLAUDE_PERMISSION_PRESETS else infer_claude_permission_preset({**settings, "permissionPreset": preset})
        elif key == "permissionMode":
            mode = str(values[key]).strip()
            if mode in {item["permissionMode"] for item in CLAUDE_PERMISSION_PRESETS.values()}:
                settings[key] = mode
        elif key == "provider":
            settings[key] = normalize_claude_provider(values[key])
        elif key == "reasoningEffort":
            settings[key] = normalize_reasoning_effort(values[key], "claude", settings.get("model"))
        elif key == "reviewCheckpointInterval":
            settings[key] = normalize_review_checkpoint_interval(values[key])
        elif key == "webSearch":
            settings[key] = bool(values[key])
        elif key == "fastMode":
            settings[key] = bool(values[key])
        elif key == "extraConfig":
            settings[key] = str(values[key] or "").strip()[:4000]
        elif key == "preExecScript":
            settings[key] = normalize_pre_exec_script(values[key])
    settings["model"] = normalize_claude_model(settings.get("model"))
    settings["reasoningEffort"] = normalize_reasoning_effort(settings.get("reasoningEffort"), "claude", settings.get("model"))
    settings["reviewCheckpointInterval"] = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
    return apply_claude_permission_preset(settings)


def normalize_review_checkpoint_interval(value: Any) -> int:
    try:
        interval = int(str(value).strip())
    except (TypeError, ValueError):
        return DEFAULT_REVIEW_CHECKPOINT_INTERVAL
    return interval if interval > 0 else DEFAULT_REVIEW_CHECKPOINT_INTERVAL


def default_ui_settings_payload(backend: Any = "") -> dict[str, Any]:
    return {
        "agent": {"backend": normalize_agent_backend(backend or selected_agent_backend_from_env())},
        "codex": normalize_codex_settings({}),
        "claude": normalize_claude_settings({}),
        "env": {},
        "codex_env": {},
        "claude_env": {},
    }


def write_default_project_ui_settings(project_root: Path, backend: Any = "") -> None:
    payload = default_ui_settings_payload(backend)
    runtime_dir = project_root / "ui" / ".runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    settings_path = runtime_dir / "settings.json"
    settings_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


WATCHED_PATHS = [
    "PROJECT.md",
    "research_trajectory/STATE.md",
    "research_trajectory/human_interventions",
    "research_trajectory",
    "manuscript/BLUEPRINT.md",
    "manuscript/reviews",
    "manuscript/figures/FIGURE_SPECS.md",
    "resources",
]

RESOURCE_GROUPS = {
    "User Input": "resources/user_input",
    "Ongoing Work": "resources/ongoing_work",
    "Proposals": "resources/proposals",
    "Literature": "resources/literature",
    "Target Venue": "resources/target_venue",
    "Data Sources": "resources/data_sources",
    "Other": "resources/other",
}

UPLOAD_TARGETS = {
    "user_input": "resources/user_input/attachments",
    "ongoing_work": "resources/ongoing_work",
    "proposals": "resources/proposals",
    "literature": "resources/literature",
    "target_venue": "resources/target_venue",
    "data_sources": "resources/data_sources",
    "other": "resources/other",
}

RESOURCE_LINK_TARGETS = {
    "user_input": "resources/user_input/attachments",
    "ongoing_work": "resources/ongoing_work",
    "proposals": "resources/proposals",
    "literature": "resources/literature",
    "target_venue": "resources/target_venue",
    "data_sources": "resources/data_sources",
    "other": "resources/other",
}


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def now_id() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def parse_iso_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.astimezone()
    return parsed


def seconds_since_iso(value: Any) -> int | None:
    parsed = parse_iso_datetime(value)
    if parsed is None:
        return None
    return max(0, int((datetime.now().astimezone() - parsed.astimezone()).total_seconds()))


def agent_notice_from_event(line: str, display: str = "") -> dict[str, Any]:
    raw = str(line or "")
    if not raw.strip():
        return {}
    # Only genuine error/system signals count as rate limits. The model's own
    # output and tool results routinely mention "rate", "usage limit", "quota",
    # etc. while researching safety topics — scanning that text produced false
    # "Rate limit reported" notices. Restrict detection to error events and
    # non-JSON diagnostic (stderr) lines.
    is_error_signal = False
    event: Any = None
    try:
        event = json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        is_error_signal = True  # non-JSON line is diagnostic/stderr output
    if isinstance(event, dict):
        etype = str(event.get("type") or "").lower()
        subtype = str(event.get("subtype") or "").lower()
        has_error_field = bool(event.get("error") or event.get("is_error"))
        if etype in {"error", "system_error"} or "error" in subtype or has_error_field:
            is_error_signal = True
    if not is_error_signal:
        return {}
    text = "\n".join(part for part in (raw, display) if part).strip()
    if AGENT_RATE_LIMIT_PATTERN.search(text):
        message = compact_single_line(display or text, 260)
        return {
            "kind": "rate_limited",
            "message": message or "Agent reported a rate limit or quota limit.",
            "detected_at": now_iso(),
        }
    return {}


def agent_wait_state_from_values(running: bool, last_event_at: Any, last_event_summary: Any, notice: Any) -> dict[str, Any]:
    age_seconds = seconds_since_iso(last_event_at)
    notice_payload = notice if isinstance(notice, dict) else {}
    kind = str(notice_payload.get("kind") or "").strip()
    message = str(notice_payload.get("message") or "").strip()
    stale = bool(running and age_seconds is not None and age_seconds >= AGENT_IDLE_NOTICE_SECONDS)
    # A rate-limit notice is only meaningful while the agent is actually stalled.
    # If fresh events are still flowing, the limit has cleared — drop the notice
    # so it can't stick on screen after the agent resumes.
    if kind == "rate_limited" and age_seconds is not None and age_seconds < AGENT_RATE_LIMIT_CLEAR_SECONDS:
        kind = ""
        message = ""
    if kind == "rate_limited":
        message = message or "Agent reported a rate limit or quota limit."
    elif stale:
        kind = "idle"
        message = f"No agent events for {age_seconds} seconds; the process is still running."
    elif running:
        kind = "active"
        message = "Agent process is running."
    else:
        kind = "inactive"
        message = "No active agent process."
    return {
        "kind": kind,
        "message": message,
        "last_event_at": str(last_event_at or ""),
        "last_event_age_seconds": age_seconds,
        "last_event_summary": str(last_event_summary or ""),
        "idle_threshold_seconds": AGENT_IDLE_NOTICE_SECONDS,
        "notice": notice_payload,
    }


def persist_research_session() -> None:
    if not current_project_writeable():
        return
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with RESEARCH_LOCK:
        payload = {key: value for key, value in RESEARCH_SESSION.items() if key not in {"process", "process_thread", "streaming_transcript"}}
    SESSION_STATE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def session_startup_without_process(status: Any, started_at: Any) -> bool:
    normalized = str(status or "").strip().lower()
    if normalized not in {"running", "stopping"}:
        return False
    age = seconds_since_iso(started_at)
    return age is not None and age < SESSION_STARTUP_GRACE_SECONDS


def reconcile_research_process_state() -> None:
    changed = False
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        status = str(RESEARCH_SESSION.get("status") or "").strip().lower()
        if proc is not None:
            returncode = proc.poll()
            if returncode is None:
                return
            RESEARCH_SESSION["returncode"] = returncode
            if status in {"running", "stopping"}:
                RESEARCH_SESSION["status"] = "completed" if returncode == 0 else "failed"
            RESEARCH_SESSION["ended_at"] = RESEARCH_SESSION.get("ended_at") or now_iso()
            RESEARCH_SESSION["process"] = None
            RESEARCH_SESSION["process_thread"] = None
            changed = True
        elif status in {"running", "stopping"}:
            if session_startup_without_process(status, RESEARCH_SESSION.get("started_at")):
                return
            RESEARCH_SESSION["status"] = "interrupted"
            RESEARCH_SESSION["ended_at"] = RESEARCH_SESSION.get("ended_at") or now_iso()
            RESEARCH_SESSION["process_thread"] = None
            changed = True
    if changed:
        persist_research_session()


def load_research_session_runtime() -> None:
    if not SESSION_STATE_PATH.exists():
        return
    try:
        payload = json.loads(SESSION_STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    with RESEARCH_LOCK:
        for key in (
            "id",
            "session_id",
            "backend",
            "mode",
            "command",
            "settings",
            "started_at",
            "ended_at",
            "returncode",
            "logs",
            "raw_logs",
            "transcript",
            "loop_active",
            "loop_iteration",
            "loop_max_iterations",
            "loop_review_checkpoint_iteration",
            "loop_stop_reason",
            "gate",
            "last_event_at",
            "last_event_summary",
            "agent_notice",
        ):
            if key in payload:
                RESEARCH_SESSION[key] = payload[key]
        previous_status = str(payload.get("status") or "idle")
        RESEARCH_SESSION["status"] = "interrupted" if previous_status in {"running", "stopping"} else previous_status
        RESEARCH_SESSION["process"] = None


def load_ui_settings() -> dict[str, Any]:
    settings = {
        "agent": {"backend": selected_agent_backend_from_env()},
        "codex": normalize_codex_settings({}),
        "claude": normalize_claude_settings({}),
        "env": {},
        "codex_env": {},
        "claude_env": {},
    }
    settings_path = current_ui_settings_path()
    if not settings_path.exists():
        return settings
    try:
        payload = json.loads(settings_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return settings
    if isinstance(payload.get("agent"), dict):
        settings["agent"]["backend"] = normalize_agent_backend(payload["agent"].get("backend"))
    elif isinstance(payload.get("backend"), str):
        settings["agent"]["backend"] = normalize_agent_backend(payload.get("backend"))
    env_backend = valid_agent_backend_from_env()
    if env_backend:
        settings["agent"]["backend"] = env_backend
    if isinstance(payload.get("codex"), dict):
        settings["codex"] = normalize_codex_settings(payload["codex"], settings["codex"])
    if isinstance(payload.get("claude"), dict):
        settings["claude"] = normalize_claude_settings(payload["claude"], settings["claude"])
    if isinstance(payload.get("env"), dict):
        settings["env"] = {key: str(value) for key, value in payload["env"].items() if key in SECRET_ENV_KEYS and str(value)}
    if isinstance(payload.get("codex_env"), dict):
        settings["codex_env"] = normalize_codex_env_values(payload["codex_env"])
    if isinstance(payload.get("claude_env"), dict):
        settings["claude_env"] = normalize_claude_env_values(payload["claude_env"])
    return settings


def public_codex_env(settings: dict[str, Any]) -> dict[str, Any]:
    env = normalize_codex_env_values(settings.get("codex_env", {}))
    return {
        "provider": normalize_codex_provider(settings.get("codex", {}).get("provider")),
        "present": {key: bool(env.get(key)) for key in CODEX_ENV_KEYS},
        "masked": {key: ("Saved" if env.get(key) else "") for key in CODEX_SECRET_ENV_KEYS},
        "values": {key: env.get(key, "") for key in CODEX_NONSECRET_ENV_KEYS},
        "secret_keys": sorted(CODEX_SECRET_ENV_KEYS),
        "keys": CODEX_ENV_KEYS,
    }


def public_claude_env(settings: dict[str, Any]) -> dict[str, Any]:
    env = normalize_claude_env_values(settings.get("claude_env", {}))
    return {
        "provider": normalize_claude_provider(settings.get("claude", {}).get("provider")),
        "present": {key: bool(env.get(key)) for key in CLAUDE_ENV_KEYS},
        "masked": {key: ("Saved" if env.get(key) else "") for key in CLAUDE_SECRET_ENV_KEYS},
        "values": {key: env.get(key, "") for key in CLAUDE_NONSECRET_ENV_KEYS},
        "secret_keys": sorted(CLAUDE_SECRET_ENV_KEYS),
        "keys": CLAUDE_ENV_KEYS,
    }


def public_ui_settings() -> dict[str, Any]:
    settings = load_ui_settings()
    agent_status = agent_backend_status_payload(settings["agent"].get("backend"))
    return {
        "agent": settings["agent"],
        "codex": settings["codex"],
        "claude": settings["claude"],
        "codex_env": public_codex_env(settings),
        "claude_env": public_claude_env(settings),
        "env_present": {key: bool(settings["env"].get(key)) for key in SECRET_ENV_KEYS},
        "env_masked": {key: ("Saved" if settings["env"].get(key) else "") for key in SECRET_ENV_KEYS},
        "agent_status": agent_status,
        "agent_env_override": agent_status.get("env_override", ""),
    }


def save_ui_settings(payload: dict[str, Any]) -> dict[str, Any]:
    current = load_ui_settings()
    agent_payload = payload.get("agent") if isinstance(payload.get("agent"), dict) else {}
    merged_agent = {"backend": normalize_agent_backend(agent_payload.get("backend") or current["agent"].get("backend"))}

    codex = payload.get("codex") if isinstance(payload.get("codex"), dict) else {}
    claude = payload.get("claude") if isinstance(payload.get("claude"), dict) else {}
    merged_codex = normalize_codex_settings(codex, current["codex"])
    merged_claude = normalize_claude_settings(claude, current["claude"])

    env_values = payload.get("env") if isinstance(payload.get("env"), dict) else {}
    merged_env = dict(current["env"])
    for key in payload.get("clear_env", []) if isinstance(payload.get("clear_env"), list) else []:
        if key in SECRET_ENV_KEYS:
            merged_env.pop(key, None)
    for key, value in env_values.items():
        if key in SECRET_ENV_KEYS and str(value).strip():
            merged_env[key] = str(value).strip()

    codex_env_values = payload.get("codex_env") if isinstance(payload.get("codex_env"), dict) else {}
    merged_codex_env = dict(current.get("codex_env", {}))
    for key in payload.get("clear_codex_env", []) if isinstance(payload.get("clear_codex_env"), list) else []:
        if key in CODEX_ENV_KEYS:
            merged_codex_env.pop(key, None)
    for key, value in codex_env_values.items():
        if key in CODEX_ENV_KEYS:
            text = str(value).strip()
            if text:
                merged_codex_env[key] = text

    claude_env_values = payload.get("claude_env") if isinstance(payload.get("claude_env"), dict) else {}
    merged_claude_env = dict(current.get("claude_env", {}))
    for key in payload.get("clear_claude_env", []) if isinstance(payload.get("clear_claude_env"), list) else []:
        if key in CLAUDE_ENV_KEYS:
            merged_claude_env.pop(key, None)
    for key, value in claude_env_values.items():
        if key in CLAUDE_ENV_KEYS:
            text = str(value).strip()
            if text:
                merged_claude_env[key] = text

    settings_path = current_ui_settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(
        json.dumps(
            {
                "agent": merged_agent,
                "codex": merged_codex,
                "claude": merged_claude,
                "env": merged_env,
                "codex_env": normalize_codex_env_values(merged_codex_env),
                "claude_env": normalize_claude_env_values(merged_claude_env),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return public_ui_settings()


def sanitize_framing_message(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    role = str(item.get("role") or "").strip()
    text = str(item.get("text") or "").strip()
    kind = str(item.get("kind") or "text").strip()
    if role not in {"user", "assistant"}:
        return None
    if kind not in {"text", "project", "plan", "goal-launch", "command", "intervention-recorded"}:
        kind = "text"
    clean: dict[str, Any] = {
        "id": str(item.get("id") or "").strip()[:120],
        "role": role,
        "kind": kind,
        "text": text[:40_000],
        "created_at": str(item.get("created_at") or "").strip()[:80],
    }
    edited_at = str(item.get("edited_at") or "").strip()
    if edited_at:
        clean["edited_at"] = edited_at[:80]
    artifact = item.get("artifact")
    if isinstance(artifact, dict):
        if kind == "plan":
            plan_id = normalize_plan_id(artifact.get("id") or item.get("planId"))
            plan_text = str(artifact.get("plan_text") or artifact.get("text") or "").strip()
            plan_error = str(artifact.get("error") or "").strip()
            raw_steps = artifact.get("steps") if isinstance(artifact.get("steps"), list) else []
            steps = []
            for step in raw_steps[:80]:
                if not isinstance(step, dict):
                    continue
                step_text = str(step.get("step") or step.get("text") or "").strip()
                if step_text:
                    steps.append({"step": step_text[:1200], "status": str(step.get("status") or "").strip()[:80]})
            if plan_id:
                clean["artifact"] = {
                    "type": "plan",
                    "id": plan_id,
                    "provider": normalize_agent_backend(artifact.get("provider")),
                    "model": str(artifact.get("model") or "").strip()[:120],
                    "status": str(artifact.get("status") or "pending").strip()[:80],
                    "text": plan_text[:120_000],
                    "plan_text": plan_text[:120_000],
                    "steps": steps,
                    "explanation": str(artifact.get("explanation") or "").strip()[:4000],
                    "error": plan_error[:4000],
                    "created_at": str(artifact.get("created_at") or "").strip()[:80],
                    "updated_at": str(artifact.get("updated_at") or "").strip()[:80],
                    "approved_at": str(artifact.get("approved_at") or "").strip()[:80],
                    "implemented_run_id": str(artifact.get("implemented_run_id") or "").strip()[:120],
                }
                if not clean["text"]:
                    clean["text"] = (plan_text or plan_error or "Planning...")[:40_000]
        else:
            artifact_path = str(artifact.get("path") or "").strip()
            artifact_text = str(artifact.get("text") or "").strip()
            if artifact_path and artifact_text:
                clean["artifact"] = {
                    "path": artifact_path[:400],
                    "text": artifact_text[:120_000],
                }
    mode = str(item.get("mode") or "").strip()
    if mode in {"chat", "plan"}:
        clean["mode"] = mode
    revise_plan_id = normalize_plan_id(item.get("revisePlanId"))
    if revise_plan_id:
        clean["revisePlanId"] = revise_plan_id
    attachments = item.get("attachments")
    if isinstance(attachments, list):
        clean_attachments = []
        for attachment in attachments[:30]:
            if not isinstance(attachment, dict):
                continue
            attachment_kind = str(attachment.get("kind") or "").strip()
            name = str(attachment.get("name") or "").strip()
            category = str(attachment.get("category") or "").strip()
            if attachment_kind == "link":
                path = str(attachment.get("path") or "").strip()
                if path:
                    clean_attachments.append({
                        "kind": "link",
                        "path": path[:800],
                        "name": (name or Path(path).name)[:240],
                        "category": category[:80],
                    })
            elif attachment_kind == "upload":
                if name:
                    clean_attachments.append({
                        "kind": "upload",
                        "name": name[:240],
                        "category": category[:80],
                        "type": str(attachment.get("type") or "").strip()[:120],
                        "size": int(attachment.get("size") or 0),
                    })
        if clean_attachments:
            clean["attachments"] = clean_attachments
            if role == "user" and not clean["text"]:
                count = len(clean_attachments)
                clean["text"] = f"Attached {count} {'resource' if count == 1 else 'resources'}."
    resume_from_trial = item.get("resumeFromTrial")
    if isinstance(resume_from_trial, dict):
        resume_id = str(resume_from_trial.get("id") or "").strip()
        resume_path = str(resume_from_trial.get("path") or "").strip()
        if resume_id or resume_path:
            try:
                resume_iteration = int(resume_from_trial.get("iteration") or 0)
            except (TypeError, ValueError):
                resume_iteration = 0
            clean["resumeFromTrial"] = {
                "id": resume_id[:240],
                "path": resume_path[:800],
                "iteration": resume_iteration,
                "name": str(resume_from_trial.get("name") or resume_id or resume_path).strip()[:240],
                "reportPath": str(resume_from_trial.get("reportPath") or resume_from_trial.get("report_path") or "").strip()[:800],
                "checkpointPath": str(resume_from_trial.get("checkpointPath") or resume_from_trial.get("checkpoint_path") or "").strip()[:800],
                "checkpointExists": bool(resume_from_trial.get("checkpointExists") or resume_from_trial.get("checkpoint_exists")),
            }
    if not clean["text"] and not clean.get("artifact"):
        return None
    return {key: value for key, value in clean.items() if value is not None and value != ""}


def load_framing_messages() -> list[dict[str, Any]]:
    if not FRAMING_MESSAGES_PATH.exists():
        return []
    try:
        payload = json.loads(FRAMING_MESSAGES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(payload, list):
        return []
    messages: list[dict[str, Any]] = []
    for item in payload[-80:]:
        clean = sanitize_framing_message(item)
        if clean:
            messages.append(clean)
    return messages


def save_framing_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ensure_current_project_writeable()
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    clean_messages = []
    for item in messages[-80:]:
        clean = sanitize_framing_message(item)
        if clean:
            clean_messages.append(clean)
    FRAMING_MESSAGES_PATH.write_text(json.dumps(clean_messages, ensure_ascii=False, indent=2), encoding="utf-8")
    return clean_messages


def project_has_placeholders(text: str) -> bool:
    return bool(re.search(r"<[^>\n]+>", text or ""))


def update_framing_messages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if str(payload.get("clientVersion") or "").strip() != FRAMING_MESSAGES_CLIENT_VERSION:
        raise ValueError("UI is out of date. Refresh the page and try again.")
    messages = payload.get("messages")
    if not isinstance(messages, list):
        raise ValueError("messages must be a list.")
    return save_framing_messages(messages)


def read_claude_settings_env(path: Path) -> dict[str, str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(payload, dict):
        return {}
    return normalize_claude_env_values(payload.get("env"))


def external_claude_settings_env() -> dict[str, str]:
    env: dict[str, str] = {}
    paths = [Path.home() / ".claude" / "settings.json"]
    try:
        repo_root = Path(os.fspath(REPO_ROOT))
        paths.extend([
            repo_root / ".claude" / "settings.json",
            repo_root / ".claude" / "settings.local.json",
        ])
    except ValueError:
        pass
    for path in paths:
        env.update(read_claude_settings_env(path))
    return env


def _first_env_value(key: str, *sources: dict[str, str]) -> str:
    for source in sources:
        value = str(source.get(key) or "").strip()
        if value:
            return value
    return ""


def _selected_claude_credential_env(saved: dict[str, str], ambient: dict[str, str]) -> dict[str, str]:
    token = _first_env_value("ANTHROPIC_AUTH_TOKEN", saved, ambient)
    if token:
        return {"ANTHROPIC_AUTH_TOKEN": token}
    api_key = _first_env_value("ANTHROPIC_API_KEY", saved, ambient)
    if api_key:
        return {"ANTHROPIC_API_KEY": api_key}
    return {}


def agent_process_env(backend: str = "") -> dict[str, str]:
    backend = normalize_agent_backend(backend)
    env = os.environ.copy()
    settings = load_ui_settings()
    env.update(settings.get("env", {}))
    if backend == "codex":
        for key in CLAUDE_ENV_KEYS:
            env.pop(key, None)
        provider = normalize_codex_provider(settings.get("codex", {}).get("provider"))
        if provider == "cli":
            for key in CODEX_ENV_KEYS:
                env.pop(key, None)
        else:
            saved = codex_env_for_provider(provider, settings.get("codex_env", {}))
            if saved.get("OPENAI_API_KEY"):
                env["OPENAI_API_KEY"] = saved["OPENAI_API_KEY"]
        return env

    if backend == "claude":
        for key in CODEX_ENV_KEYS:
            env.pop(key, None)
        provider = normalize_claude_provider(settings.get("claude", {}).get("provider"))
        external_env = external_claude_settings_env()
        if provider == "external":
            env.update(external_env)
            return env

        ambient = dict(env)
        ambient.update(external_env)
        saved = normalize_claude_env_values(settings.get("claude_env", {}))
        for key in CLAUDE_ENV_KEYS:
            env.pop(key, None)

        if provider == "anthropic_api_key":
            api_key = _first_env_value("ANTHROPIC_API_KEY", saved, ambient)
            if api_key:
                env["ANTHROPIC_API_KEY"] = api_key
            return env

        provider_env = claude_env_for_provider(provider, saved)
        if provider == "custom_anthropic":
            base_url = _first_env_value("ANTHROPIC_BASE_URL", saved, ambient)
            if base_url:
                provider_env["ANTHROPIC_BASE_URL"] = base_url
            for key in ("ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "API_TIMEOUT_MS", "CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"):
                value = _first_env_value(key, saved, ambient)
                if value:
                    provider_env[key] = value
        credential_env = _selected_claude_credential_env(saved, ambient)
        provider_env.pop("ANTHROPIC_AUTH_TOKEN", None)
        provider_env.pop("ANTHROPIC_API_KEY", None)
        provider_env.update(credential_env)
        env.update(provider_env)
    return env


def codex_process_env() -> dict[str, str]:
    return agent_process_env("codex")


def agent_executable_names(backend: str, windows: bool | None = None) -> list[str]:
    is_windows = os.name == "nt" if windows is None else windows
    base = "claude" if normalize_agent_backend(backend) == "claude" else "codex"
    if is_windows:
        return [f"{base}.cmd", f"{base}.exe", f"{base}.bat", base]
    return [base]


def codex_executable_names(windows: bool | None = None) -> list[str]:
    return agent_executable_names("codex", windows)


def claude_executable_names(windows: bool | None = None) -> list[str]:
    return agent_executable_names("claude", windows)


def agent_executable_env_vars(backend: str) -> tuple[str, str]:
    return ("COAUTO_CLAUDE", "CLAUDE_BIN") if normalize_agent_backend(backend) == "claude" else ("COAUTO_CODEX", "CODEX_BIN")


def agent_display_name(backend: str) -> str:
    return "Claude Code" if normalize_agent_backend(backend) == "claude" else "Codex"


def resolve_agent_executable(backend: str, env: dict[str, str] | None = None, windows: bool | None = None) -> str:
    backend = normalize_agent_backend(backend)
    process_env = env if env is not None else os.environ
    search_path = process_env.get("PATH") or None
    primary_env, fallback_env = agent_executable_env_vars(backend)
    configured = str(process_env.get(primary_env) or process_env.get(fallback_env) or "").strip().strip('"')
    if configured:
        expanded = os.path.expandvars(os.path.expanduser(configured))
        configured_path = Path(expanded)
        if configured_path.is_file():
            return str(configured_path)
        found = shutil.which(expanded, path=search_path)
        if found:
            return found
        label = agent_display_name(backend)
        executable_hint = "claude.cmd, claude.exe, or claude" if backend == "claude" else "codex.cmd, codex.exe, or codex"
        raise FileNotFoundError(
            f"Configured {label} executable was not found: {configured}. "
            f"Set {primary_env} to the full path of {executable_hint}."
        )

    for name in agent_executable_names(backend, windows):
        found = shutil.which(name, path=search_path)
        if found:
            return found
    names = ", ".join(agent_executable_names(backend, windows))
    label = agent_display_name(backend)
    install_hint = "Install Claude Code CLI" if backend == "claude" else "Install Codex CLI"
    env_hint = "COAUTO_CLAUDE" if backend == "claude" else "COAUTO_CODEX"
    binary_hint = "claude.cmd/claude" if backend == "claude" else "codex.cmd/codex"
    raise FileNotFoundError(
        f"{label} CLI executable not found on PATH. Tried: {names}. "
        f"{install_hint}, start the UI from a terminal where `{agent_executable_names(backend, False)[0]} --version` works, "
        f"or set {env_hint} to the full path of {binary_hint}."
    )


def resolve_codex_executable(env: dict[str, str] | None = None, windows: bool | None = None) -> str:
    return resolve_agent_executable("codex", env, windows)


def resolve_claude_executable(env: dict[str, str] | None = None, windows: bool | None = None) -> str:
    return resolve_agent_executable("claude", env, windows)


def agent_start_error_message(exc: OSError, command: list[str], backend: str) -> str:
    backend = normalize_agent_backend(backend)
    executable = command[0] if command else ("claude" if backend == "claude" else "codex")
    label = agent_display_name(backend)
    env_hint = "COAUTO_CLAUDE" if backend == "claude" else "COAUTO_CODEX"
    shim = "claude.cmd" if backend == "claude" else "codex.cmd"
    version_command = "claude --version" if backend == "claude" else "codex --version"
    if isinstance(exc, FileNotFoundError) or getattr(exc, "winerror", None) == 2:
        return (
            f"Failed to start {label}: executable not found. "
            f"Tried `{executable}`. On Windows, npm installs CLI shims as `{shim}`; "
            f"start the UI from a terminal where `{version_command}` works, or set "
            f"{env_hint} to the full path of {shim}."
        )
    return f"Failed to start {label} using `{executable}`: {exc}"


def codex_start_error_message(exc: OSError, command: list[str]) -> str:
    return agent_start_error_message(exc, command, "codex")


def executable_requires_windows_shell(executable: str, windows: bool | None = None) -> bool:
    is_windows = os.name == "nt" if windows is None else windows
    return is_windows and Path(str(executable)).suffix.lower() in {".cmd", ".bat"}


def agent_version_command(backend: str) -> list[str]:
    return ["--version"]


def agent_auth_command(backend: str) -> list[str]:
    return ["auth", "status"] if normalize_agent_backend(backend) == "claude" else ["login", "status"]


def agent_login_command_text(backend: str) -> str:
    return "claude auth login" if normalize_agent_backend(backend) == "claude" else "codex login"


def agent_auth_status_command_text(backend: str) -> str:
    return "claude auth status" if normalize_agent_backend(backend) == "claude" else "codex login status"


def agent_version_command_text(backend: str) -> str:
    return "claude --version" if normalize_agent_backend(backend) == "claude" else "codex --version"


def agent_install_hint(backend: str) -> str:
    return "Install Claude Code CLI" if normalize_agent_backend(backend) == "claude" else "Install Codex CLI"


def agent_env_hint(backend: str) -> str:
    primary, fallback = agent_executable_env_vars(backend)
    return f"{primary}/{fallback}"


def agent_settings_for_probe(backend: str, settings: dict[str, Any] | None = None) -> dict[str, Any]:
    backend = normalize_agent_backend(backend)
    saved = load_ui_settings()
    values = settings if isinstance(settings, dict) and normalize_agent_backend(settings.get("backend") or backend) == backend else {}
    if backend == "claude":
        normalized = normalize_claude_settings(values, saved.get("claude", {}))
    else:
        normalized = normalize_codex_settings(values, saved.get("codex", {}))
    normalized["backend"] = backend
    return normalized


def run_agent_probe(backend: str, executable: str, args: list[str], env: dict[str, str] | None = None, timeout: float = 6.0, settings: dict[str, Any] | None = None) -> dict[str, Any]:
    backend = normalize_agent_backend(backend)
    command = [executable, *args]
    process_env = env if env is not None else os.environ
    wrapper_path: Path | None = None
    proc: subprocess.Popen[str] | None = None
    try:
        popen_command, use_shell, wrapper_path = popen_command_for_agent(command, agent_settings_for_probe(backend, settings), process_env)
        proc = subprocess.Popen(
            popen_command,
            env=process_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=use_shell,
            start_new_session=os.name != "nt",
        )
        stdout, stderr = proc.communicate(timeout=timeout)
    except FileNotFoundError as exc:
        return {"ok": False, "returncode": 127, "output": str(exc), "error": str(exc), "timeout": False}
    except subprocess.TimeoutExpired as exc:
        if proc is not None:
            try:
                signal_research_process(proc, force=True)
            except OSError:
                pass
            try:
                stdout, stderr = proc.communicate(timeout=1)
            except subprocess.TimeoutExpired:
                stdout, stderr = exc.stdout or "", exc.stderr or ""
        else:
            stdout, stderr = exc.stdout or "", exc.stderr or ""
        output = "\n".join(filter(None, [str(exc.stdout or ""), str(exc.stderr or "")])).strip()
        if not output:
            output = "\n".join(filter(None, [str(stdout or ""), str(stderr or "")])).strip()
        return {"ok": False, "returncode": None, "output": output or "Command timed out.", "error": "timeout", "timeout": True}
    except OSError as exc:
        return {"ok": False, "returncode": 126, "output": str(exc), "error": str(exc), "timeout": False}
    except ValueError as exc:
        return {"ok": False, "returncode": 126, "output": str(exc), "error": str(exc), "timeout": False}
    finally:
        if wrapper_path:
            try:
                wrapper_path.unlink(missing_ok=True)
            except OSError:
                pass
    output = "\n".join(filter(None, [stdout, stderr])).strip()
    return {"ok": proc.returncode == 0 if proc is not None else False, "returncode": proc.returncode if proc is not None else None, "output": output, "error": "", "timeout": False}


def claude_gateway_status_from_env(env: dict[str, str] | None = None) -> dict[str, Any]:
    process_env = env if env is not None else agent_process_env("claude")
    base_url = str(process_env.get("ANTHROPIC_BASE_URL") or "").strip()
    auth_token = str(process_env.get("ANTHROPIC_AUTH_TOKEN") or "").strip()
    api_key = str(process_env.get("ANTHROPIC_API_KEY") or "").strip()
    credential_key = "ANTHROPIC_AUTH_TOKEN" if auth_token else "ANTHROPIC_API_KEY" if api_key else ""
    model_mappings = {
        key: str(process_env.get(key) or "").strip()
        for key in ("ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL")
        if str(process_env.get(key) or "").strip()
    }
    return {
        "configured": bool(base_url or credential_key or model_mappings),
        "base_url": base_url,
        "credential_key": credential_key,
        "has_credential": bool(credential_key),
        "complete": bool(base_url and credential_key),
        "model_mappings": model_mappings,
    }


def _json_object_from_probe_output(output: str) -> dict[str, Any] | None:
    text = str(output or "").strip()
    candidates = [text, *[line.strip() for line in text.splitlines() if line.strip().startswith("{")]]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return None


def _claude_auth_status_from_json(payload: dict[str, Any]) -> str:
    true_keys = ("authenticated", "logged_in", "loggedIn", "is_authenticated", "isAuthenticated")
    for key in true_keys:
        if key in payload:
            return "ok" if bool(payload.get(key)) else "missing"
    string_keys = ("status", "state", "auth", "authentication", "login_status", "loginStatus")
    for key in string_keys:
        value = str(payload.get(key) or "").strip().lower().replace("-", "_").replace(" ", "_")
        if not value:
            continue
        if any(marker in value for marker in ("unauthenticated", "logged_out", "not_logged_in", "signed_out", "missing", "unauthorized")):
            return "missing"
        if any(marker in value for marker in ("authenticated", "logged_in", "signed_in", "authorized")):
            return "ok"
    return ""


def auth_probe_status(backend: str, probe: dict[str, Any]) -> str:
    normalized = normalize_agent_backend(backend)
    text = str(probe.get("output") or probe.get("error") or "")
    lowered = text.lower()
    if probe.get("timeout"):
        return "unknown"
    unknown_markers = [
        "unknown command",
        "unrecognized command",
        "unrecognised command",
        "invalid command",
        "no such command",
        "unknown subcommand",
        "unrecognized subcommand",
        "unrecognised subcommand",
        "unexpected argument",
        "invalid option",
        "unknown option",
        "not enough arguments",
    ]
    if any(marker in lowered for marker in unknown_markers):
        return "unknown"
    if normalized == "claude":
        json_status = _claude_auth_status_from_json(_json_object_from_probe_output(str(probe.get("output") or "")) or {})
        if json_status:
            return json_status
    if probe.get("returncode") == 0 or probe.get("ok"):
        return "ok"
    missing_markers = [
        "not logged",
        "not authenticated",
        "not signed",
        "unauthenticated",
        "authentication required",
        "login required",
        "please login",
        "please log in",
        "no credentials",
        "no api key",
        "not authorized",
        "not authorised",
    ]
    if any(marker in lowered for marker in missing_markers):
        return "missing"
    return "missing" if probe.get("returncode") not in (None, 0) else "unknown"


def agent_setup_instruction(backend: str, reason: str) -> str:
    label = agent_display_name(backend)
    if reason == "missing":
        return (
            f"{label} CLI is not available. {agent_install_hint(backend)}, verify `{agent_version_command_text(backend)}`, "
            f"or set {agent_env_hint(backend)} to the CLI executable."
        )
    if reason == "version":
        return (
            f"{label} CLI was found but `{agent_version_command_text(backend)}` failed. "
            f"Verify the install or set {agent_env_hint(backend)} to a working executable."
        )
    if reason == "auth":
        return (
            f"{label} is not authenticated. Run `{agent_login_command_text(backend)}` and verify "
            f"`{agent_auth_status_command_text(backend)}` before starting a run."
        )
    if reason == "auth_status":
        return (
            f"{label} authentication status could not be verified. Run `{agent_auth_status_command_text(backend)}` "
            f"or update {label} CLI, then try again."
        )
    if reason == "openai_api_key":
        return "OpenAI API key is missing. Add it in Settings or start the UI with OPENAI_API_KEY."
    if reason == "anthropic_api_key":
        return "Anthropic API key is missing. Add it in Settings or start the UI with ANTHROPIC_API_KEY."
    if reason == "zai_glm":
        return "Z.AI GLM Coding Plan needs a Z.AI API key. Add it in Settings or set ANTHROPIC_AUTH_TOKEN."
    if reason == "custom_anthropic":
        return "Custom Anthropic-compatible gateway needs a base URL and credential. Add them in Settings."
    return f"{label} readiness could not be determined."


def agent_setup_status(backend: str, env: dict[str, str] | None = None, settings: dict[str, Any] | None = None) -> dict[str, Any]:
    backend = normalize_agent_backend(backend)
    label = agent_display_name(backend)
    process_env = env if env is not None else agent_process_env(backend)
    probe_settings = agent_settings_for_probe(backend, settings)
    provider = (
        normalize_claude_provider(probe_settings.get("provider"))
        if backend == "claude"
        else normalize_codex_provider(probe_settings.get("provider"))
    )
    gateway_status = claude_gateway_status_from_env(process_env) if backend == "claude" else {}
    base: dict[str, Any] = {
        "backend": backend,
        "label": label,
        "provider": provider,
        "ok": False,
        "blocking": False,
        "installed": False,
        "auth": "unknown",
        "executable": "",
        "version": "",
        "message": "",
        "env_vars": list(agent_executable_env_vars(backend)),
        "version_command": agent_version_command_text(backend),
        "login_command": agent_login_command_text(backend),
        "auth_status_command": agent_auth_status_command_text(backend),
        "gateway": gateway_status,
    }
    try:
        executable = resolve_agent_executable(backend, process_env)
    except FileNotFoundError as exc:
        base.update({
            "blocking": True,
            "installed": False,
            "message": agent_setup_instruction(backend, "missing"),
            "details": str(exc),
        })
        return base

    base["executable"] = executable
    version_probe = run_agent_probe(backend, executable, agent_version_command(backend), process_env, settings=probe_settings)
    if not version_probe.get("ok"):
        base.update({
            "blocking": True,
            "installed": False,
            "message": agent_setup_instruction(backend, "version"),
            "details": str(version_probe.get("output") or version_probe.get("error") or ""),
        })
        return base

    base["installed"] = True
    base["version"] = str(version_probe.get("output") or "").splitlines()[0][:240]

    if backend == "codex" and provider == "openai_api_key":
        if str(process_env.get("OPENAI_API_KEY") or "").strip():
            base.update({
                "ok": True,
                "blocking": False,
                "auth": "api_key",
                "message": "Codex CLI is installed and OpenAI API key is available.",
            })
            return base
        base.update({
            "blocking": True,
            "auth": "missing",
            "message": agent_setup_instruction(backend, "openai_api_key"),
            "details": "Selected provider is OpenAI API key, but OPENAI_API_KEY is not available to this UI process.",
        })
        return base

    if backend == "claude" and provider == "anthropic_api_key":
        if str(process_env.get("ANTHROPIC_API_KEY") or "").strip():
            base.update({
                "ok": True,
                "blocking": False,
                "auth": "api_key",
                "message": "Claude Code CLI is installed and Anthropic API key is available.",
            })
            return base
        base.update({
            "blocking": True,
            "auth": "missing",
            "message": agent_setup_instruction(backend, "anthropic_api_key"),
            "details": "Selected provider is Anthropic API key, but ANTHROPIC_API_KEY is not available to this UI process.",
        })
        return base

    if backend == "claude" and provider in {"zai_glm", "custom_anthropic"}:
        base["gateway"] = gateway_status
        if gateway_status.get("complete"):
            base.update({
                "ok": True,
                "blocking": False,
                "auth": "gateway",
                "message": (
                    "Claude Code CLI is installed and an Anthropic-compatible gateway is configured "
                    f"via {gateway_status.get('credential_key') or 'environment credentials'}."
                ),
            })
            return base
        base.update({
            "blocking": True,
            "auth": "missing",
            "message": agent_setup_instruction(backend, provider),
            "details": (
                "Missing gateway base URL."
                if not gateway_status.get("base_url")
                else "Missing gateway credential."
            ),
        })
        return base

    auth_probe = run_agent_probe(backend, executable, agent_auth_command(backend), process_env, settings=probe_settings)
    auth = auth_probe_status(backend, auth_probe)
    base["auth"] = auth
    if backend == "claude" and gateway_status.get("base_url") and not gateway_status.get("has_credential"):
        base.update({
            "blocking": True,
            "message": (
                "Claude Code has an Anthropic-compatible gateway base URL configured, but no "
                "ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY is available to this UI process."
            ),
            "details": "Set the gateway credential in Settings, ~/.claude/settings.json, or the terminal environment that starts CoAutoResearch.",
        })
        return base
    if backend == "claude" and gateway_status.get("complete") and auth in {"missing", "unknown"}:
        base.update({
            "ok": True,
            "blocking": False,
            "auth": "gateway",
            "message": (
                "Claude Code CLI is installed and an Anthropic-compatible gateway is configured "
                f"via {gateway_status.get('credential_key') or 'environment credentials'}."
            ),
            "details": str(auth_probe.get("output") or auth_probe.get("error") or ""),
        })
        return base
    if auth == "missing":
        base.update({
            "blocking": True,
            "message": agent_setup_instruction(backend, "auth"),
            "details": str(auth_probe.get("output") or auth_probe.get("error") or ""),
        })
        return base
    if auth == "unknown":
        base.update({
            "ok": False,
            "blocking": True,
            "message": (
                agent_setup_instruction(backend, "auth_status")
            ),
            "details": str(auth_probe.get("output") or auth_probe.get("error") or ""),
        })
        return base

    base.update({
        "ok": True,
        "blocking": False,
        "message": f"{label} CLI is installed and authenticated.",
    })
    return base


_AGENT_MODELS_CACHE: dict[str, dict[str, Any]] = {}


def _format_claude_model_label(value: str) -> str:
    """Turn an underlying CLI value like `claude-opus-4-8` or `opus` into a human label."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    full_match = re.match(r"^claude-(opus|sonnet|haiku|mythos)-(\d+)(?:-(\d+))?(?:-(\d{6,8}))?$", raw, re.IGNORECASE)
    if full_match:
        tier = full_match.group(1).capitalize()
        major = full_match.group(2)
        minor = full_match.group(3)
        version = f"{major}.{minor}" if minor else major
        return f"Claude {tier} {version}"
    if raw.lower() in {"opus", "sonnet", "haiku", "mythos"}:
        return f"Claude {raw.capitalize()}"
    return raw


def _format_codex_model_label(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if re.match(r"^gpt-\d", raw, re.IGNORECASE):
        upper = raw.upper().replace("CODEX", "Codex").replace("MINI", "Mini").replace("SPARK", "Spark")
        return upper
    return raw


def _parse_claude_models_from_help(help_text: str) -> list[tuple[str, str]]:
    text = str(help_text or "")
    found: dict[str, str] = {}
    # Full model IDs are the safest signal: claude-opus-4-8, claude-sonnet-4-6, etc.
    for match in re.finditer(r"\bclaude-(?:opus|sonnet|haiku|mythos)-\d+(?:-\d+)?(?:-\d{6,8})?\b", text, re.IGNORECASE):
        value = match.group(0).lower()
        found.setdefault(value, _format_claude_model_label(value))
    # Shortcuts (opus / sonnet / haiku) appear in the --model option help text quoted or after commas.
    for match in re.finditer(r"[\"'`,\s\[\(](opus|sonnet|haiku|mythos)[\"'`,\s\]\)]", text, re.IGNORECASE):
        value = match.group(1).lower()
        found.setdefault(value, _format_claude_model_label(value))
    return [(value, label) for value, label in found.items()]


def _parse_codex_models_from_help(help_text: str) -> list[tuple[str, str]]:
    text = str(help_text or "")
    found: dict[str, str] = {}
    for match in re.finditer(r"\bgpt-\d+(?:\.\d+)?(?:-[a-z0-9-]+)?\b", text, re.IGNORECASE):
        value = match.group(0).lower()
        found.setdefault(value, _format_codex_model_label(value))
    return [(value, label) for value, label in found.items()]


def _claude_model_sort_key(item: tuple[str, str]) -> tuple[int, int, int, str]:
    value, _ = item
    tier_order = {"opus": 0, "sonnet": 1, "haiku": 2, "mythos": -2}
    full = re.match(r"^claude-(opus|sonnet|haiku|mythos)-(\d+)(?:-(\d+))?", value, re.IGNORECASE)
    if full:
        tier = tier_order.get(full.group(1).lower(), 99)
        # Newer versions first: negate major/minor for stable sort.
        major = -int(full.group(2))
        minor = -int(full.group(3) or 0)
        return (tier, major, minor, value)
    if value in tier_order:
        return (tier_order[value], 0, 0, value)
    return (99, 0, 0, value)


def _codex_model_sort_key(item: tuple[str, str]) -> tuple[int, int, str]:
    value, _ = item
    match = re.match(r"^gpt-(\d+)(?:\.(\d+))?", value, re.IGNORECASE)
    if match:
        major = -int(match.group(1))
        minor = -int(match.group(2) or 0)
        return (major, minor, value)
    return (99, 0, value)


def agent_available_models(backend: str, env: dict[str, str] | None = None, settings: dict[str, Any] | None = None) -> dict[str, Any]:
    backend = normalize_agent_backend(backend)
    process_env = env if env is not None else agent_process_env(backend)
    probe_settings = agent_settings_for_probe(backend, settings)
    try:
        executable = resolve_agent_executable(backend, process_env)
    except FileNotFoundError as exc:
        return {
            "backend": backend,
            "source": "unavailable",
            "models": [],
            "probe_error": str(exc),
            "executable": "",
        }
    pre_exec_hash = hashlib.sha1(pre_exec_script_for_settings(probe_settings).encode("utf-8")).hexdigest()[:12]
    cache_key = f"{backend}::{executable}::{pre_exec_hash}"
    cached = _AGENT_MODELS_CACHE.get(cache_key)
    if cached is not None:
        return cached
    help_probe = run_agent_probe(backend, executable, ["--help"], process_env, timeout=6.0, settings=probe_settings)
    if not help_probe.get("ok"):
        result = {
            "backend": backend,
            "source": "fallback",
            "models": [],
            "probe_error": str(help_probe.get("output") or help_probe.get("error") or "Help probe failed."),
            "executable": executable,
        }
        _AGENT_MODELS_CACHE[cache_key] = result
        return result
    help_text = str(help_probe.get("output") or "")
    if backend == "claude":
        pairs = _parse_claude_models_from_help(help_text)
        pairs.sort(key=_claude_model_sort_key)
    else:
        pairs = _parse_codex_models_from_help(help_text)
        pairs.sort(key=_codex_model_sort_key)
    if not pairs:
        result = {
            "backend": backend,
            "source": "fallback",
            "models": [],
            "probe_error": "Could not parse model list from CLI help.",
            "executable": executable,
        }
        _AGENT_MODELS_CACHE[cache_key] = result
        return result
    result = {
        "backend": backend,
        "source": "discovered",
        "models": [{"value": value, "label": label} for value, label in pairs],
        "probe_error": None,
        "executable": executable,
    }
    _AGENT_MODELS_CACHE[cache_key] = result
    return result


def agent_backend_status_payload(selected_backend: Any = "") -> dict[str, Any]:
    selected = normalize_agent_backend(selected_backend or selected_agent_backend_from_env())
    statuses = {backend: agent_setup_status(backend) for backend in sorted(ALLOWED_AGENT_BACKENDS)}
    env_override = valid_agent_backend_from_env()
    env_override_raw = raw_agent_backend_from_env()
    return {
        "selected": selected,
        "env_override": env_override,
        "env_override_raw": env_override_raw,
        "env_warning": agent_backend_env_warning(),
        "backends": statuses,
    }


def agent_unavailable_message(status: dict[str, Any], statuses: dict[str, Any] | None = None) -> str:
    message = str(status.get("message") or "").strip() or agent_setup_instruction(status.get("backend", "codex"), "missing")
    backend = normalize_agent_backend(status.get("backend"))
    all_statuses = statuses or {}
    for other_backend, other_status in all_statuses.items():
        normalized_other = normalize_agent_backend(other_backend)
        if normalized_other == backend:
            continue
        if isinstance(other_status, dict) and other_status.get("ok") and not other_status.get("blocking"):
            message += f" {agent_display_name(normalized_other)} is available; select it in Settings if you want to use it."
            break
    return message


def claude_permission_mode_from_settings(settings: dict[str, Any] | None = None) -> str:
    preset = infer_claude_permission_preset(settings or {})
    return CLAUDE_PERMISSION_PRESETS[preset]["permissionMode"]


def claude_permission_modes_from_help(help_text: str) -> set[str]:
    text = str(help_text or "")
    marker = "--permission-mode"
    index = text.find(marker)
    if index < 0:
        return set()
    snippet = text[index:index + 800]
    modes = set(re.findall(r'"([^"]+)"', snippet))
    known_modes = {"acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan"}
    return modes & known_modes


def claude_permission_mode_status(settings: dict[str, Any] | None = None, env: dict[str, str] | None = None) -> dict[str, Any]:
    mode = claude_permission_mode_from_settings(settings)
    process_env = env if env is not None else agent_process_env("claude")
    probe_settings = agent_settings_for_probe("claude", settings)
    try:
        executable = resolve_agent_executable("claude", process_env)
    except FileNotFoundError as exc:
        return {"ok": False, "blocking": True, "mode": mode, "message": str(exc)}
    help_probe = run_agent_probe("claude", executable, ["--help"], process_env, settings=probe_settings)
    if not help_probe.get("ok"):
        return {
            "ok": True,
            "blocking": False,
            "mode": mode,
            "message": "Claude Code permission-mode support could not be probed; startup will continue.",
            "details": str(help_probe.get("output") or help_probe.get("error") or ""),
        }
    modes = claude_permission_modes_from_help(str(help_probe.get("output") or ""))
    if not modes or mode in modes:
        return {"ok": True, "blocking": False, "mode": mode, "supported_modes": sorted(modes)}
    return {
        "ok": False,
        "blocking": True,
        "mode": mode,
        "supported_modes": sorted(modes),
        "message": (
            f"Claude Code CLI does not support permission mode `{mode}`. "
            "Update Claude Code or choose a different permission preset in Settings."
        ),
    }


def ensure_agent_ready(backend: str, env: dict[str, str] | None = None, settings: dict[str, Any] | None = None) -> dict[str, Any]:
    backend = normalize_agent_backend(backend)
    statuses = {
        name: agent_setup_status(name, env, settings if normalize_agent_backend(name) == backend else None)
        for name in sorted(ALLOWED_AGENT_BACKENDS)
    }
    selected = statuses[backend]
    if selected.get("blocking"):
        raise ValueError(agent_unavailable_message(selected, statuses))
    if backend == "claude":
        permission_status = claude_permission_mode_status(settings, env)
        if permission_status.get("blocking"):
            message = str(permission_status.get("message") or "Claude Code permission mode is not supported.")
            other = statuses.get("codex")
            if isinstance(other, dict) and other.get("ok") and not other.get("blocking"):
                message += " Codex is available; select it in Settings if you want to use it."
            raise ValueError(message)
    return selected


def transcript_entry(role: str, kind: str, title: str, content: str, raw_type: str = "", editable: bool = False) -> dict[str, Any]:
    return {
        "id": f"T{now_id()}_{len(RESEARCH_SESSION.get('transcript', [])) + 1:04d}",
        "role": role,
        "kind": kind,
        "title": title,
        "content": str(content or "").strip(),
        "raw_type": raw_type,
        "editable": editable,
        "created_at": now_iso(),
        "iteration": int(RESEARCH_SESSION.get("loop_iteration") or 0),
        "run_id": str(RESEARCH_SESSION.get("id") or ""),
    }


def append_transcript(role: str, kind: str, title: str, content: str, raw_type: str = "", editable: bool = False) -> None:
    text = str(content or "").strip()
    if not text:
        return
    with RESEARCH_LOCK:
        RESEARCH_SESSION["transcript"].append(transcript_entry(role, kind, title, text, raw_type, editable))
        RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
    persist_research_session()


def event_payload_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        parts = [event_payload_text(item) for item in value]
        return "\n".join(part for part in parts if part).strip()
    if isinstance(value, dict):
        for key in ("text", "message", "summary", "content", "output", "result", "success", "error", "stdout", "stderr"):
            text = event_payload_text(value.get(key))
            if text:
                return text
        if "command" in value:
            command = value.get("command")
            if isinstance(command, list):
                return " ".join(str(part) for part in command)
            return str(command)
        parts = [event_payload_text(item) for item in value.values()]
        return "\n".join(part for part in parts if part).strip()
    return ""


def codex_web_search_query(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = compact_single_line(value, 260)
        lowered = text.lower()
        if (
            not text
            or text.startswith("ws_")
            or lowered in {"web_search", "web_search_call", "completed", "in_progress", "queued"}
            or re.match(r"^(?:item|turn|response|session)[._/-]", lowered)
        ):
            return ""
        return text
    if isinstance(value, list):
        for item in value:
            text = codex_web_search_query(item)
            if text:
                return text
        return ""
    if isinstance(value, dict):
        for key in ("query", "search_query", "searchQuery", "q", "keywords", "search_terms", "searchTerms"):
            text = codex_web_search_query(value.get(key))
            if text:
                return text
        for key, item in value.items():
            if str(key).lower() in {"id", "call_id", "callid", "type", "kind", "name", "status", "method", "event", "role", "raw_type", "session_id", "run_id", "backend", "model", "usage"}:
                continue
            text = codex_web_search_query(item)
            if text:
                return text
    return ""


def codex_event_name(event: Any) -> str:
    if not isinstance(event, dict):
        return ""
    raw = str(event.get("method") or event.get("type") or event.get("event") or event.get("kind") or "")
    return re.sub(r"[\s._]+", "/", raw.strip().lower())


def codex_event_params(event: Any) -> dict[str, Any]:
    if not isinstance(event, dict):
        return {}
    params = event.get("params")
    return params if isinstance(params, dict) else event


def codex_event_item(event: Any) -> dict[str, Any]:
    if not isinstance(event, dict):
        return {}
    params = codex_event_params(event)
    item = params.get("item") if isinstance(params.get("item"), dict) else event.get("item")
    return item if isinstance(item, dict) else {}


def is_ignored_codex_lifecycle_event(event: Any) -> bool:
    if not isinstance(event, dict):
        return False
    if (
        "result" in event
        and "id" in event
        and not any(key in event for key in ("method", "type", "event", "kind"))
    ):
        return True
    raw_type = codex_event_name(event)
    if "delta" in raw_type:
        return True
    if raw_type.startswith(("account/", "remotecontrol/", "thread/")):
        return True
    if raw_type.startswith("mcpserver/") and "toolcall" not in raw_type:
        return True
    if raw_type.startswith("turn/"):
        payload = codex_event_params(event)
        has_result_text = any(
            key in payload or key in event
            for key in ("text", "message", "content", "output", "result", "success")
        )
        return not has_result_text
    if raw_type in {
        "thread/started",
        "turn/started",
        "thread/settings/updated",
        "thread/status/changed",
        "thread/tokenusage/updated",
        "thread/token-usage/updated",
        "thread/token_usage/updated",
        "thread/token/usage/updated",
        "account/ratelimits/updated",
        "account/rate-limits/updated",
        "account/rate_limits/updated",
        "account/rate/limits/updated",
        "mcpserver/startupstatus/updated",
        "mcpserver/startup-status/updated",
        "mcpserver/startup_status/updated",
        "mcpserver/startup/status/updated",
    }:
        return True
    item = codex_event_item(event)
    item_type = str(item.get("type") or item.get("kind") or item.get("role") or "").lower()
    if raw_type == "item/started":
        return True
    return raw_type == "item/completed" and item_type in {"reasoning", "agentmessage", "agent_message", "message", "plan", "usermessage", "user_message"}


def claude_event_label(event: Any) -> tuple[str, str, str, str]:
    if not isinstance(event, dict):
        return ("", "", "", "")
    event_type = str(event.get("type") or "event").strip() or "event"
    subtype = str(event.get("subtype") or "").strip()
    label = event_type if "." in event_type or not subtype else f"{event_type}.{subtype}"
    return event_type, subtype, label, label.lower()


def is_ignored_claude_lifecycle_event(event: Any) -> bool:
    if not isinstance(event, dict):
        return False
    event_type, subtype, _label, label_lower = claude_event_label(event)
    event_family = event_type.split(".", 1)[0].lower()
    if event_family == "system" and subtype == "init":
        return True
    return "delta" in label_lower or "partial" in label_lower


def should_suppress_agent_event_summary(line: str, backend: str) -> bool:
    try:
        event = json.loads(str(line or "").strip())
    except (json.JSONDecodeError, TypeError, ValueError):
        return False
    if normalize_agent_backend(backend) == "claude":
        return is_ignored_claude_lifecycle_event(event)
    return is_ignored_codex_lifecycle_event(event)


def transcript_from_codex_line(line: str) -> dict[str, Any] | None:
    stripped = line.strip()
    if not stripped:
        return None
    try:
        event = json.loads(stripped)
    except json.JSONDecodeError:
        if stripped.startswith("Started:"):
            return {"role": "command", "kind": "command", "title": "Agent command", "content": stripped.removeprefix("Started:").strip(), "raw_type": "process.started", "editable": False}
        if "error" in stripped.lower() or "failed" in stripped.lower():
            return {"role": "tool", "kind": "error", "title": "Runtime message", "content": stripped, "raw_type": "process.message", "editable": False}
        return None

    raw_type = str(event.get("method") or event.get("type") or event.get("event") or event.get("kind") or "event")
    raw_type_lower = raw_type.lower()
    raw_type_key = codex_event_name(event)
    if raw_type_key in {"thread/started", "turn/started"}:
        return None
    if "delta" in raw_type_lower or raw_type_lower.endswith("/delta"):
        return None
    if raw_type_key == "turn/completed" and set(event.keys()).issubset({"type", "usage"}):
        return None

    item = codex_event_item(event)
    item_type = str(item.get("type") or item.get("kind") or item.get("role") or "").lower()
    type_text = f"{raw_type_lower} {item_type}".strip()
    completed_message = raw_type_key == "item/completed" and item_type in {"agentmessage", "agent_message", "message"}
    if is_ignored_codex_lifecycle_event(event) and not completed_message:
        return None
    if "web_search" in type_text or "websearch" in type_text:
        query = codex_web_search_query(item) or codex_web_search_query(event)
        content = f"Searching the web: {query}" if query else "Searching the web"
        return {"role": "tool", "kind": "tool", "title": "Web search", "content": content[:8000], "raw_type": raw_type, "editable": False}

    content_source: Any = item or event
    content = event_payload_text(content_source)
    if not content or content in {raw_type, item_type}:
        return None

    role = "assistant"
    kind = "assistant"
    title = "Assistant"
    editable = False

    if any(token in type_text for token in ("tool", "exec", "command", "shell", "patch", "file", "stdout", "stderr")):
        role = "tool"
        kind = "tool"
        title = "Tool"
    if raw_type_lower in {"turn.completed"} or any(token in type_text for token in ("final", "result")):
        role = "final"
        kind = "final"
        title = "Final"
    if "error" in type_text or "failed" in type_text:
        role = "tool"
        kind = "error"
        title = "Error"
    if "user" in type_text:
        role = "user"
        kind = "user"
        title = "User"
        editable = True
    if "assistant" in type_text or "agent" in type_text or "message" in type_text:
        if role not in {"user", "tool", "final"}:
            role = "assistant"
            kind = "assistant"
            title = "Assistant"

    return {"role": role, "kind": kind, "title": title, "content": content[:8000], "raw_type": raw_type, "editable": editable}


def claude_content_blocks(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        content = value.get("content")
        if isinstance(content, list):
            return [item for item in content if isinstance(item, dict)]
        if isinstance(content, dict):
            return [content]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def claude_block_text(block: dict[str, Any]) -> str:
    block_type = str(block.get("type") or "").strip()
    if block_type == "text":
        return str(block.get("text") or "").strip()
    if block_type == "tool_use":
        name = str(block.get("name") or "tool").strip()
        tool_input = block.get("input")
        if isinstance(tool_input, (dict, list)):
            detail = json.dumps(tool_input, ensure_ascii=False)
        else:
            detail = str(tool_input or "").strip()
        return f"{name}: {detail}".strip()
    if block_type == "tool_result":
        content = event_payload_text(block.get("content"))
        return content or event_payload_text(block)
    return event_payload_text(block)


def claude_message_content_text(message: Any, include_tools: bool = True) -> str:
    blocks = claude_content_blocks(message)
    if blocks:
        parts = []
        for block in blocks:
            if not include_tools and str(block.get("type") or "") != "text":
                continue
            text = claude_block_text(block)
            if text:
                parts.append(text)
        return "\n".join(parts).strip()
    return event_payload_text(message)


def claude_message_has_tool_use(message: Any) -> bool:
    return any(str(block.get("type") or "") in {"tool_use", "tool_result"} for block in claude_content_blocks(message))


def claude_result_text(event: dict[str, Any]) -> str:
    for key in ("success", "result", "message", "content", "output", "text", "error"):
        text = event_payload_text(event.get(key))
        if text:
            return text
    return ""


def transcript_from_claude_line(line: str) -> dict[str, Any] | None:
    stripped = line.strip()
    if not stripped:
        return None
    try:
        event = json.loads(stripped)
    except json.JSONDecodeError:
        if "error" in stripped.lower() or "failed" in stripped.lower():
            return {"role": "tool", "kind": "error", "title": "Claude Code", "content": stripped, "raw_type": "process.message", "editable": False}
        return None
    if not isinstance(event, dict):
        return None

    event_type = str(event.get("type") or "event").strip() or "event"
    subtype = str(event.get("subtype") or "").strip()
    raw_type = event_type if "." in event_type or not subtype else f"{event_type}.{subtype}"
    raw_type_lower = raw_type.lower()
    event_family = event_type.split(".", 1)[0].lower()
    if raw_type_lower in {"system.init"}:
        return None
    if "delta" in raw_type_lower or "partial" in raw_type_lower:
        return None

    if event_family == "assistant":
        message = event.get("message") if isinstance(event.get("message"), dict) else event
        stop_reason = message.get("stop_reason") if isinstance(message, dict) else None
        if stop_reason in {None, ""} and not claude_message_has_tool_use(message):
            return None
        if claude_message_has_tool_use(message):
            content = claude_message_content_text(message)
            if not content:
                return None
            return {"role": "tool", "kind": "tool", "title": "Tool", "content": content[:8000], "raw_type": raw_type, "editable": False}
        content = claude_message_content_text(message, include_tools=False)
        if not content:
            return None
        return {"role": "assistant", "kind": "assistant", "title": "Assistant", "content": content[:8000], "raw_type": raw_type, "editable": False}

    if event_family == "user":
        message = event.get("message") if isinstance(event.get("message"), dict) else event
        if claude_message_has_tool_use(message):
            content = claude_message_content_text(message)
            if content:
                is_error = any(bool(block.get("is_error")) for block in claude_content_blocks(message))
                return {
                    "role": "tool",
                    "kind": "error" if is_error else "tool",
                    "title": "Tool result" if not is_error else "Tool error",
                    "content": content[:8000],
                    "raw_type": raw_type,
                    "editable": False,
                }
        return None

    if event_family == "result":
        is_error = bool(event.get("is_error")) or "error" in raw_type_lower or subtype == "error"
        content = claude_result_text(event)
        if not content:
            return None
        return {
            "role": "tool" if is_error else "final",
            "kind": "error" if is_error else "final",
            "title": "Error" if is_error else "Final",
            "content": content[:8000],
            "raw_type": raw_type,
            "editable": False,
        }

    if "error" in raw_type_lower or "failed" in raw_type_lower or "retry" in raw_type_lower:
        content = event_payload_text(event)
        if content:
            return {"role": "tool", "kind": "error" if "retry" not in raw_type_lower else "tool", "title": "Claude Code", "content": content[:8000], "raw_type": raw_type, "editable": False}
    return None


def transcript_from_agent_line(line: str, backend: str) -> dict[str, Any] | None:
    return transcript_from_claude_line(line) if normalize_agent_backend(backend) == "claude" else transcript_from_codex_line(line)


def transcript_dedupe_key(entry: dict[str, Any] | None) -> tuple[str, str, str, str]:
    if not isinstance(entry, dict):
        return ("", "", "", "")
    return (
        str(entry.get("role") or "").strip().lower(),
        str(entry.get("kind") or "").strip().lower(),
        str(entry.get("raw_type") or "").strip().lower(),
        compact_single_line(str(entry.get("content") or ""), 800),
    )


def research_event_session_patch(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    with RESEARCH_LOCK:
        settings = RESEARCH_SESSION.get("settings") if isinstance(RESEARCH_SESSION.get("settings"), dict) else {}
        patch = {
            "session_id": str(RESEARCH_SESSION.get("session_id") or ""),
            "last_event_at": str(RESEARCH_SESSION.get("last_event_at") or ""),
            "last_event_summary": str(RESEARCH_SESSION.get("last_event_summary") or ""),
            "agent_notice": dict(RESEARCH_SESSION.get("agent_notice") if isinstance(RESEARCH_SESSION.get("agent_notice"), dict) else {}),
            "returncode": RESEARCH_SESSION.get("returncode"),
            "backend": normalize_agent_backend(RESEARCH_SESSION.get("backend") or settings.get("backend") or ""),
            "mode": str(RESEARCH_SESSION.get("mode") or ""),
            "status": str(RESEARCH_SESSION.get("status") or ""),
            "loop_iteration": int(RESEARCH_SESSION.get("loop_iteration") or 0),
        }
    if extra:
        patch.update(extra)
    return patch


def emit_research_event(kind: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    context = current_project_context()
    payload = dict(payload or {})
    created_at = now_iso()
    with context.lock:
        session = context.session
        settings = session.get("settings") if isinstance(session.get("settings"), dict) else {}
        backend = normalize_agent_backend(session.get("backend") or settings.get("backend") or "")
        event = {
            "schema_version": 1,
            "event_id": 0,
            "kind": str(kind or "agent_event"),
            "project_id": context.id,
            "run_id": str(session.get("id") or ""),
            "backend": backend,
            "mode": str(session.get("mode") or ""),
            "status": str(session.get("status") or ""),
            "created_at": created_at,
            "session_patch": research_event_session_patch(),
        }
    event.update(payload)
    if not isinstance(event.get("session_patch"), dict):
        event["session_patch"] = research_event_session_patch()
    with context.research_event_condition:
        context.research_event_id += 1
        event["event_id"] = context.research_event_id
        context.research_events.append(event)
        if len(context.research_events) > RESEARCH_EVENT_BUFFER_MAX:
            context.research_events = context.research_events[-RESEARCH_EVENT_BUFFER_MAX:]
        context.research_event_condition.notify_all()
    return event


def research_events_since(context: ProjectContext, since_id: int) -> list[dict[str, Any]]:
    with context.research_event_condition:
        return [dict(event) for event in context.research_events if int(event.get("event_id") or 0) > since_id]


def parse_research_event_since(value: Any) -> int:
    try:
        return max(0, int(str(value or "").strip()))
    except (TypeError, ValueError):
        return 0


def format_research_sse_event(event: dict[str, Any]) -> str:
    event_id = int(event.get("event_id") or 0)
    data = json.dumps(event, ensure_ascii=False)
    return f"id: {event_id}\nevent: research\ndata: {data}\n\n"


def stream_payload_value(payload: dict[str, Any], key: str) -> Any:
    if key in payload:
        return payload.get(key)
    key_lower = key.lower()
    for candidate, value in payload.items():
        if str(candidate).lower() == key_lower:
            return value
    return None


def stream_text_value(value: Any, keys: tuple[str, ...] = ()) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return "".join(stream_text_value(item, keys) for item in value)
    if isinstance(value, dict):
        for key in keys:
            text = stream_text_value(stream_payload_value(value, key), keys)
            if text:
                return text
        for key in ("delta", "text_delta", "textDelta", "output_delta", "outputDelta", "summaryTextDelta", "content", "message", "item"):
            nested = stream_payload_value(value, key)
            if nested is value:
                continue
            text = stream_text_value(nested, keys)
            if text:
                return text
    return ""


def normalized_stream_method(value: Any) -> str:
    return re.sub(r"[\s._]+", "/", str(value or "").strip().lower())


def stream_item_identifier(*payloads: Any) -> str:
    for payload in payloads:
        if not isinstance(payload, dict):
            continue
        for key in ("itemId", "item_id", "blockId", "block_id", "id", "callId", "call_id", "index"):
            value = stream_payload_value(payload, key)
            if value is not None and str(value).strip() != "":
                return slugify(str(value), "active")
    return "active"


def streaming_update_from_codex_event(event: dict[str, Any]) -> dict[str, Any] | None:
    method = str(event.get("method") or event.get("type") or event.get("event") or event.get("kind") or "").strip()
    method_key = normalized_stream_method(method)
    if "plan/delta" in method_key:
        return None
    params = event.get("params") if isinstance(event.get("params"), dict) else event
    item = params.get("item") if isinstance(params.get("item"), dict) else event.get("item") if isinstance(event.get("item"), dict) else {}
    item_type = normalized_stream_method(item.get("type") or item.get("kind") or item.get("role") or "")
    type_blob = f"{method_key} {item_type}"
    item_id = stream_item_identifier(params, item, event)

    if (
        "agentmessage/delta" in method_key
        or "agent/message/delta" in method_key
        or ("delta" in method_key and ("agent/message" in type_blob or "agent_message" in type_blob or "message" in item_type))
    ):
        text = stream_text_value(params, ("delta", "text", "textDelta", "text_delta", "content"))
        if not text:
            return None
        return {
            "key": f"assistant:{item_id}",
            "family": "assistant",
            "role": "assistant",
            "kind": "assistant",
            "title": "Assistant",
            "text": text,
            "raw_type": method or "item.agentMessage.delta",
            "mode": "append",
        }

    if "reasoning" in type_blob and ("delta" in method_key or "summarytextdelta" in method_key):
        text = stream_text_value(params, ("delta", "summaryTextDelta", "text", "content"))
        if not text:
            return None
        return {
            "key": f"reasoning:{item_id}",
            "family": "reasoning",
            "role": "assistant",
            "kind": "reasoning",
            "title": "Reasoning",
            "text": text,
            "raw_type": method or "item.reasoning.summaryTextDelta",
            "mode": "append",
        }

    if (
        "commandexecution/outputdelta" in method_key
        or "command/execution/outputdelta" in method_key
        or "outputdelta" in method_key
        or ("delta" in method_key and any(token in type_blob for token in ("command", "exec", "stdout", "stderr", "tool")))
    ):
        text = stream_text_value(params, ("delta", "outputDelta", "output_delta", "output", "stdout", "stderr", "text", "content"))
        if not text:
            return None
        return {
            "key": f"tool:{item_id}",
            "family": "tool",
            "role": "tool",
            "kind": "tool",
            "title": "Tool",
            "text": text,
            "raw_type": method or "item.commandExecution.outputDelta",
            "mode": "append",
        }

    return None


def streaming_update_from_claude_event(event: dict[str, Any]) -> dict[str, Any] | None:
    nested = event.get("event") if isinstance(event.get("event"), dict) else event.get("raw_event") if isinstance(event.get("raw_event"), dict) else event
    if not isinstance(nested, dict):
        return None
    event_type = str(nested.get("type") or event.get("type") or "event").strip() or "event"
    subtype = str(nested.get("subtype") or event.get("subtype") or "").strip()
    raw_type = event_type if "." in event_type or not subtype else f"{event_type}.{subtype}"
    raw_type_lower = raw_type.lower()
    event_family = event_type.split(".", 1)[0].lower()

    if event_family == "content_block_delta":
        delta = nested.get("delta") if isinstance(nested.get("delta"), dict) else {}
        delta_type = str(delta.get("type") or "").strip().lower()
        index = stream_item_identifier({"index": nested.get("index", 0)})
        if delta_type == "text_delta":
            text = stream_text_value(delta, ("text",))
            family = "assistant"
            role = "assistant"
            kind = "assistant"
            title = "Assistant"
        elif "thinking" in delta_type:
            text = stream_text_value(delta, ("thinking", "text"))
            family = "reasoning"
            role = "assistant"
            kind = "reasoning"
            title = "Reasoning"
        elif delta_type == "input_json_delta":
            text = stream_text_value(delta, ("partial_json", "text"))
            family = "tool"
            role = "tool"
            kind = "tool"
            title = "Tool"
        else:
            return None
        if not text:
            return None
        return {
            "key": f"{family}:{index}",
            "family": family,
            "role": role,
            "kind": kind,
            "title": title,
            "text": text,
            "raw_type": raw_type,
            "mode": "append",
        }

    if "partial" in raw_type_lower or event_family == "assistant":
        message = nested.get("message") if isinstance(nested.get("message"), dict) else nested
        if not isinstance(message, dict):
            return None
        stop_reason = message.get("stop_reason")
        if stop_reason not in {None, ""} or claude_message_has_tool_use(message):
            return None
        text = claude_message_content_text(message, include_tools=False)
        if not text:
            return None
        return {
            "key": f"assistant:{stream_item_identifier(message, nested)}",
            "family": "assistant",
            "role": "assistant",
            "kind": "assistant",
            "title": "Assistant",
            "text": text,
            "raw_type": raw_type,
            "mode": "snapshot",
        }

    return None


def streaming_update_from_agent_line(line: str, backend: str) -> dict[str, Any] | None:
    stripped = line.strip()
    if not stripped:
        return None
    try:
        event = json.loads(stripped)
    except json.JSONDecodeError:
        return None
    if not isinstance(event, dict):
        return None
    return streaming_update_from_claude_event(event) if normalize_agent_backend(backend) == "claude" else streaming_update_from_codex_event(event)


def parsed_transcript_entry(parsed: dict[str, Any], entry_id: str = "", streaming: bool = False, created_at: str = "") -> dict[str, Any]:
    entry = transcript_entry(
        str(parsed.get("role") or "assistant"),
        str(parsed.get("kind") or "assistant"),
        str(parsed.get("title") or "Assistant"),
        str(parsed.get("content") or "")[:STREAMING_TRANSCRIPT_MAX_CHARS],
        str(parsed.get("raw_type") or ""),
        bool(parsed.get("editable")),
    )
    if entry_id:
        entry["id"] = entry_id
    if created_at:
        entry["created_at"] = created_at
    if streaming:
        entry["streaming"] = True
    elif "streaming" in entry:
        entry.pop("streaming", None)
    return entry


def upsert_transcript_entry_locked(entry: dict[str, Any]) -> dict[str, Any]:
    entry_id = str(entry.get("id") or "").strip()
    if not entry_id:
        RESEARCH_SESSION["transcript"].append(entry)
        RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
        return entry
    for index, existing in enumerate(RESEARCH_SESSION.get("transcript", [])):
        if str(existing.get("id") or "") == entry_id:
            merged = {**existing, **entry}
            if existing.get("created_at"):
                merged["created_at"] = existing["created_at"]
            if entry.get("streaming") is False:
                merged.pop("streaming", None)
            RESEARCH_SESSION["transcript"][index] = merged
            RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
            return merged
    RESEARCH_SESSION["transcript"].append(entry)
    RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
    return entry


def streaming_transcript_state_locked() -> dict[str, dict[str, Any]]:
    state = RESEARCH_SESSION.get("streaming_transcript")
    if not isinstance(state, dict):
        state = {}
        RESEARCH_SESSION["streaming_transcript"] = state
    return state


def upsert_streaming_transcript_locked(update: dict[str, Any]) -> dict[str, Any] | None:
    key = str(update.get("key") or "assistant:active")
    text = str(update.get("text") or "")
    state = streaming_transcript_state_locked()
    existing = state.get(key) if isinstance(state.get(key), dict) else None
    if not text and not existing:
        return None
    if not text.strip() and not existing:
        return None
    mode = str(update.get("mode") or "append")
    content = text if mode == "snapshot" else f"{existing.get('content', '') if existing else ''}{text}"
    content = content[:STREAMING_TRANSCRIPT_MAX_CHARS]
    if not content.strip():
        return None
    entry_id = str(existing.get("id") or "") if existing else f"T{now_id()}_stream_{len(RESEARCH_SESSION.get('transcript', [])) + 1:04d}"
    created_at = str(existing.get("created_at") or "") if existing else now_iso()
    parsed = {
        "role": update.get("role") or "assistant",
        "kind": update.get("kind") or "assistant",
        "title": update.get("title") or "Assistant",
        "content": content,
        "raw_type": update.get("raw_type") or "stream.delta",
        "editable": False,
    }
    entry = parsed_transcript_entry(parsed, entry_id=entry_id, streaming=True, created_at=created_at)
    entry = upsert_transcript_entry_locked(entry)
    state[key] = {
        "id": entry_id,
        "created_at": created_at,
        "content": content,
        "family": str(update.get("family") or update.get("kind") or "assistant"),
        "role": str(update.get("role") or "assistant"),
        "kind": str(update.get("kind") or "assistant"),
    }
    return entry


def finalize_streaming_transcript_locked(parsed: dict[str, Any]) -> dict[str, Any] | None:
    content = str(parsed.get("content") or "").strip()
    if not content:
        return None
    role = str(parsed.get("role") or "").strip().lower()
    kind = str(parsed.get("kind") or "").strip().lower()
    families: list[str] = []
    if role in {"assistant", "final"} or kind in {"assistant", "final"}:
        families.append("assistant")
    if role == "tool" or kind in {"tool", "error"}:
        families.append("tool")
    if kind == "reasoning":
        families.append("reasoning")
    state = streaming_transcript_state_locked()
    candidate_key = ""
    for key, item in state.items():
        if str(item.get("family") or "") in families:
            candidate_key = key
    if candidate_key:
        item = state.pop(candidate_key)
        entry = parsed_transcript_entry(parsed, entry_id=str(item.get("id") or ""), streaming=False, created_at=str(item.get("created_at") or ""))
        entry["streaming"] = False
        return upsert_transcript_entry_locked(entry)
    entry = parsed_transcript_entry(parsed)
    RESEARCH_SESSION["transcript"].append(entry)
    RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
    return entry


def finalize_active_streaming_transcripts_locked() -> list[dict[str, Any]]:
    state = RESEARCH_SESSION.get("streaming_transcript")
    if not isinstance(state, dict) or not state:
        RESEARCH_SESSION["streaming_transcript"] = {}
        return []
    finalized: list[dict[str, Any]] = []
    ids = {str(item.get("id") or "") for item in state.values() if isinstance(item, dict)}
    for index, entry in enumerate(RESEARCH_SESSION.get("transcript", [])):
        if str(entry.get("id") or "") in ids and entry.get("streaming"):
            next_entry = dict(entry)
            next_entry.pop("streaming", None)
            RESEARCH_SESSION["transcript"][index] = next_entry
            finalized.append(next_entry)
    RESEARCH_SESSION["streaming_transcript"] = {}
    return finalized


def backfill_claude_result_transcript_from_raw_logs() -> bool:
    with RESEARCH_LOCK:
        settings = RESEARCH_SESSION.get("settings") if isinstance(RESEARCH_SESSION.get("settings"), dict) else {}
        backend = normalize_agent_backend(RESEARCH_SESSION.get("backend") or settings.get("backend") or "")
        if backend != "claude":
            return False
        status = str(RESEARCH_SESSION.get("status") or "").strip().lower()
        if status in {"running", "stopping"}:
            return False
        raw_logs = list(RESEARCH_SESSION.get("raw_logs") or [])
        if not raw_logs:
            return False
        existing = {transcript_dedupe_key(item) for item in RESEARCH_SESSION.get("transcript", []) if isinstance(item, dict)}
        added = False
        for line in raw_logs:
            parsed = transcript_from_claude_line(str(line or ""))
            if not parsed:
                continue
            raw_type = str(parsed.get("raw_type") or "").strip().lower()
            role = str(parsed.get("role") or "").strip().lower()
            if role != "final" or (raw_type != "result" and not raw_type.startswith("result.")):
                continue
            key = transcript_dedupe_key(parsed)
            if key in existing:
                continue
            RESEARCH_SESSION["transcript"].append(transcript_entry(**parsed))
            RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
            existing.add(key)
            added = True
        return added


def slugify(value: str, fallback: str = "item") -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip()).strip("._-")
    return value[:80] or fallback


def repo_path(relative_path: str | Path) -> Path:
    text = str(relative_path).replace("\\", "/").lstrip("/")
    lexical_path = (REPO_ROOT / text).absolute()
    root = REPO_ROOT.resolve()
    try:
        lexical_path.relative_to(root)
    except ValueError as exc:
        raise ValueError("Path escapes repository root") from exc
    path = lexical_path.resolve()
    if path != root and root not in path.parents and not text.startswith("resources/"):
        raise ValueError("Path escapes repository root")
    return path


def repo_file_reference_candidates(reference: str | Path) -> list[str]:
    text = unquote(str(reference or "")).strip().strip("`'\"")
    text = re.sub(r"^file://", "", text, flags=re.IGNORECASE)
    text = text.replace("\\", "/").split("#", 1)[0].split("?", 1)[0].strip()
    if not text:
        return []

    candidates: list[str] = []

    def add(candidate: str) -> None:
        normalized = candidate.replace("\\", "/").strip().lstrip("/")
        normalized = re.sub(r"/+", "/", normalized)
        if normalized and normalized not in candidates:
            candidates.append(normalized)

    root = REPO_ROOT.resolve().as_posix().rstrip("/")
    if text == root:
        add(".")
    elif text.startswith(f"{root}/"):
        add(text[len(root) + 1 :])
    add(text)

    parts = [part for part in text.split("/") if part]
    for index in range(len(parts)):
        add("/".join(parts[index:]))

    basename = parts[-1] if parts else Path(text).name
    canonical_basename_paths = {
        "PROJECT.md": "PROJECT.md",
        "RESOURCE_MANIFEST.md": RESOURCE_MANIFEST_RELATIVE_PATH,
        "STATE.md": "research_trajectory/STATE.md",
        "CURRENT_FINDINGS.md": "research_trajectory/CURRENT_FINDINGS.md",
        "BLUEPRINT.md": "manuscript/BLUEPRINT.md",
        "FIGURE_SPECS.md": "manuscript/figures/FIGURE_SPECS.md",
    }
    if basename in canonical_basename_paths:
        add(canonical_basename_paths[basename])
    return candidates


def resolve_repo_file_reference(reference: str | Path, prefer_existing: bool = True) -> tuple[Path, str]:
    candidates = repo_file_reference_candidates(reference)
    if not candidates:
        raise ValueError("File path is required")
    first_valid: tuple[Path, str] | None = None
    first_error: Exception | None = None
    for candidate in candidates:
        try:
            path = repo_path(candidate)
        except ValueError as exc:
            if first_error is None:
                first_error = exc
            continue
        if first_valid is None:
            first_valid = (path, candidate)
        if not prefer_existing or path.exists():
            return path, rel_path(path) if path.exists() else candidate
    if first_valid is not None:
        return first_valid
    if first_error is not None:
        raise first_error
    raise ValueError("Path escapes repository root")


def rel_path(path: Path) -> str:
    root = REPO_ROOT.absolute()
    absolute = path if path.is_absolute() else REPO_ROOT / path
    try:
        return absolute.absolute().relative_to(root).as_posix()
    except ValueError:
        return absolute.resolve().relative_to(REPO_ROOT.resolve()).as_posix()


def path_exists(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return ""
    return digest.hexdigest()


def protected_path_signature(path: Path) -> dict[str, Any]:
    if not path_exists(path):
        return {"exists": False}
    if path.is_symlink():
        try:
            target = os.readlink(path)
        except OSError:
            target = ""
        return {"exists": True, "kind": "symlink", "target": target}
    if path.is_file():
        try:
            stat = path.stat()
        except OSError:
            return {"exists": False}
        return {"exists": True, "kind": "file", "size": stat.st_size, "hash": hash_file(path)}
    if path.is_dir():
        entries: list[dict[str, Any]] = []
        for child in sorted(path.rglob("*"), key=lambda item: item.as_posix()):
            relative = child.relative_to(path).as_posix()
            if child.is_symlink():
                try:
                    target = os.readlink(child)
                except OSError:
                    target = ""
                entries.append({"path": relative, "kind": "symlink", "target": target})
            elif child.is_file():
                try:
                    stat = child.stat()
                except OSError:
                    continue
                entries.append({"path": relative, "kind": "file", "size": stat.st_size, "hash": hash_file(child)})
            elif child.is_dir():
                entries.append({"path": relative, "kind": "dir"})
        return {"exists": True, "kind": "dir", "entries": entries}
    return {"exists": True, "kind": "other"}


def create_chat_protected_snapshot() -> dict[str, Any]:
    snapshot_id = f"{now_id()}_{uuid.uuid4().hex[:8]}"
    snapshot_root = RUNTIME_DIR / "chat_protected_snapshots" / snapshot_id
    files_root = snapshot_root / "files"
    entries: list[dict[str, Any]] = []
    snapshot_root.mkdir(parents=True, exist_ok=True)
    for relative in CHAT_PROTECTED_PATHS:
        source = repo_path(relative)
        entry = {
            "path": relative,
            "signature": protected_path_signature(source),
        }
        if path_exists(source):
            target = files_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.is_symlink() or source.is_file():
                shutil.copy2(source, target, follow_symlinks=False)
                ensure_path_user_writable(target)
            elif source.is_dir():
                shutil.copytree(source, target, symlinks=True)
                ensure_tree_user_writable(target)
        entries.append(entry)
    manifest = {"id": snapshot_id, "created_at": now_iso(), "protected_paths": entries}
    (snapshot_root / "MANIFEST.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"id": snapshot_id, "root": str(snapshot_root), "paths": list(CHAT_PROTECTED_PATHS)}


def restore_chat_protected_snapshot(snapshot: dict[str, Any] | None) -> list[str]:
    if not isinstance(snapshot, dict) or not snapshot.get("root"):
        return []
    snapshot_root = Path(str(snapshot["root"]))
    manifest_path = snapshot_root / "MANIFEST.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    entries = manifest.get("protected_paths")
    if not isinstance(entries, list):
        return []
    changed_paths: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        relative = str(entry.get("path") or "").strip()
        if not relative:
            continue
        source = repo_path(relative)
        before = entry.get("signature") if isinstance(entry.get("signature"), dict) else {"exists": False}
        if protected_path_signature(source) == before:
            continue
        backup = snapshot_root / "files" / relative
        if path_exists(source):
            ensure_existing_destination_user_writable(source)
            remove_path(source)
        if before.get("exists"):
            source.parent.mkdir(parents=True, exist_ok=True)
            if backup.is_symlink() or backup.is_file():
                shutil.copy2(backup, source, follow_symlinks=False)
                ensure_path_user_writable(source)
            elif backup.is_dir():
                shutil.copytree(backup, source, symlinks=True)
                ensure_tree_user_writable(source)
        changed_paths.append(relative)
    return changed_paths


def file_kind(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".md", ".markdown"}:
        return "markdown"
    if suffix in {".json"}:
        return "json"
    if suffix in {".jsonl"}:
        return "jsonl"
    if suffix in {".yaml", ".yml"}:
        return "yaml"
    if suffix in {".xml"}:
        return "xml"
    if suffix in IMAGE_PREVIEW_SUFFIXES:
        return "image"
    if suffix in PDF_PREVIEW_SUFFIXES:
        return "pdf"
    if suffix in TEXT_PREVIEW_SUFFIXES:
        return "text"
    return "binary"


def file_mime(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed:
        return guessed
    kind = file_kind(path)
    if kind == "markdown":
        return "text/markdown; charset=utf-8"
    if kind in {"json", "jsonl"}:
        return "application/json; charset=utf-8"
    if kind in {"yaml", "text"}:
        return "text/plain; charset=utf-8"
    if kind == "xml":
        return "application/xml; charset=utf-8"
    return "application/octet-stream"


def file_raw_url(relative_path: str) -> str:
    return f"/api/file/raw?project={quote(current_project_context().id)}&path={quote(relative_path)}"


def is_checkpoint_manuscript_path(relative_path: str) -> bool:
    normalized = str(relative_path or "").replace("\\", "/").lstrip("/")
    return normalized.startswith("research_trajectory/checkpoints/") and "/manuscript/" in normalized


def read_text_file(relative_path: str, limit: int = MAX_TEXT_BYTES) -> dict[str, Any]:
    display_path = str(relative_path).replace("\\", "/").lstrip("/")
    try:
        path, display_path = resolve_repo_file_reference(relative_path)
    except ValueError as exc:
        return {"path": relative_path, "exists": False, "error": str(exc)}

    if not path.exists():
        return {"path": relative_path, "exists": False, "text": ""}
    if path.is_dir():
        return {"path": display_path, "exists": True, "is_dir": True, "text": ""}

    try:
        stat = path.stat()
        relative = display_path
        kind = file_kind(path)
        previewable = path.suffix.lower() in PREVIEWABLE_SUFFIXES
        root = REPO_ROOT.resolve()
        resolved = path.resolve()
        editable = (
            path.suffix.lower() in EDITABLE_SUFFIXES
            and (resolved == root or root in resolved.parents)
            and not is_checkpoint_manuscript_path(relative)
        )
        if kind in {"image", "pdf", "binary"}:
            return {
                "path": relative,
                "exists": True,
                "is_dir": False,
                "text": "",
                "truncated": False,
                "mtime": stat.st_mtime,
                "mtime_display": datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(timespec="seconds"),
                "size": stat.st_size,
                "kind": kind,
                "mime": file_mime(path),
                "editable": False,
                "previewable": previewable,
                "url": file_raw_url(relative),
            }

        raw = path.read_bytes()[: limit + 1]
        truncated = len(raw) > limit
        text = raw[:limit].decode("utf-8", errors="replace")
        return {
            "path": relative,
            "exists": True,
            "is_dir": False,
            "text": text,
            "truncated": truncated,
            "mtime": stat.st_mtime,
            "mtime_display": datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(timespec="seconds"),
            "size": stat.st_size,
            "kind": kind,
            "mime": file_mime(path),
            "editable": editable,
            "previewable": previewable,
            "url": file_raw_url(relative),
        }
    except OSError as exc:
        return {"path": relative_path, "exists": False, "error": str(exc), "text": ""}


def write_text_file(relative_path: str, text: str) -> dict[str, Any]:
    ensure_current_project_writeable()
    path = repo_path(relative_path)
    relative = rel_path(path)
    if is_checkpoint_manuscript_path(relative):
        raise ValueError("Checkpoint manuscript snapshots are read-only.")
    root = REPO_ROOT.resolve()
    resolved = path.resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("Linked external resources are read-only in the UI.")
    if path.suffix.lower() not in EDITABLE_SUFFIXES:
        raise ValueError(f"Unsupported editable file type: {path.suffix or path.name}")
    encoded = text.encode("utf-8")
    if len(encoded) > MAX_TEXT_BYTES:
        raise ValueError(f"File is too large to save from the UI: {relative_path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded)
    return read_text_file(relative)


def safe_read(path: Path, limit: int = MAX_TEXT_BYTES) -> str:
    try:
        raw = path.read_bytes()[: limit + 1]
    except OSError:
        return ""
    return raw[:limit].decode("utf-8", errors="replace")


HUMAN_TASK_STATUS_VALUES = {"open", "answered", "closed", "deferred"}
HUMAN_TASK_PRIORITY_VALUES = {"high", "medium", "low"}
HUMAN_TASK_BLOCK_VALUES = {"none", "final_pass", "future_trial"}
HUMAN_TASK_OPEN_LIMIT = 3


def human_tasks_path() -> Path:
    return REPO_ROOT / "research_trajectory" / "HUMAN_TASKS.md"


def normalize_human_task_entry(entry: dict[str, str]) -> dict[str, str] | None:
    task_id = str(entry.get("id") or "").strip()
    if not re.fullmatch(r"HT\d{4,}", task_id):
        return None
    title = compact_single_line(entry.get("title") or task_id, 120)
    question = compact_single_line(entry.get("question") or "", 320)
    if not question:
        return None
    status = str(entry.get("status") or "open").strip().lower().replace("-", "_")
    if status not in HUMAN_TASK_STATUS_VALUES:
        status = "open"
    priority = str(entry.get("priority") or "medium").strip().lower()
    if priority not in HUMAN_TASK_PRIORITY_VALUES:
        priority = "medium"
    blocks = str(entry.get("blocks") or "none").strip().lower().replace("-", "_")
    if blocks not in HUMAN_TASK_BLOCK_VALUES:
        blocks = "none"
    return {
        "id": task_id,
        "title": title,
        "status": status,
        "priority": priority,
        "blocks": blocks,
        "question": question,
        "why_needed": compact_single_line(entry.get("why_needed") or "", 320),
        "continue_meanwhile": compact_single_line(entry.get("continue_meanwhile") or "", 320),
        "source": compact_single_line(entry.get("source") or "", 240),
        "created": compact_single_line(entry.get("created") or "", 80),
        "updated": compact_single_line(entry.get("updated") or "", 80),
    }


def read_human_tasks() -> dict[str, Any]:
    path = human_tasks_path()
    text = safe_read(path, 80_000) if path.exists() else ""
    entries: list[dict[str, str]] = []
    for match in re.finditer(r"^###\s+(HT\d{4,})\s*:\s*(.+?)\s*$([\s\S]*?)(?=^###\s+HT\d{4,}\s*:|\Z)", text, re.MULTILINE):
        block = match.group(3)
        item = normalize_human_task_entry(
            {
                "id": match.group(1).strip(),
                "title": match.group(2).strip(),
                "status": markdown_field_line(block, "Status"),
                "priority": markdown_field_line(block, "Priority"),
                "blocks": markdown_field_line(block, "Blocks"),
                "question": markdown_field_line(block, "Question"),
                "why_needed": markdown_field_line(block, "Why needed"),
                "continue_meanwhile": markdown_field_line(block, "Continue meanwhile"),
                "source": markdown_field_line(block, "Source"),
                "created": markdown_field_line(block, "Created"),
                "updated": markdown_field_line(block, "Updated"),
            }
        )
        if item:
            entries.append(item)
    priority_rank = {"high": 0, "medium": 1, "low": 2}
    entries.sort(key=lambda item: (priority_rank.get(item["priority"], 1), item["id"]))
    open_tasks = [item for item in entries if item["status"] == "open"]
    closed_tasks = [item for item in entries if item["status"] != "open"]
    return {
        "path": "research_trajectory/HUMAN_TASKS.md",
        "open": open_tasks[:HUMAN_TASK_OPEN_LIMIT],
        "closed": closed_tasks,
        "open_count": len(open_tasks),
    }


def record_ui_file_edit(relative_path: str) -> None:
    append_transcript(
        "user",
        "user",
        "UI file edit",
        f"Frontend saved `{relative_path}`. Inspect the current file contents before continuing.",
        "ui.file_edit",
        False,
    )


def extract_section(text: str, heading: str, level: int = 2) -> str:
    marker = "#" * level
    pattern = re.compile(rf"^{re.escape(marker)}\s+{re.escape(heading)}\s*$", re.IGNORECASE | re.MULTILINE)
    match = pattern.search(text)
    if not match:
        return ""
    start = match.end()
    next_heading = re.search(rf"^#{{1,{level}}}\s+.+$", text[start:], re.MULTILINE)
    end = start + next_heading.start() if next_heading else len(text)
    return text[start:end].strip()


def extract_sections(text: str, min_level: int = 2, max_level: int = 3) -> list[dict[str, str]]:
    lines = text.splitlines()
    sections: list[dict[str, str]] = []
    current: dict[str, Any] | None = None
    for line in lines:
        match = re.match(r"^(#{2,6})\s+(.+?)\s*$", line)
        if match and min_level <= len(match.group(1)) <= max_level:
            if current:
                current["body"] = "\n".join(current["body"]).strip()
                sections.append(current)
            current = {"level": len(match.group(1)), "title": match.group(2).strip(), "body": []}
        elif current:
            current["body"].append(line)
    if current:
        current["body"] = "\n".join(current["body"]).strip()
        sections.append(current)
    return sections


def first_meaningful_line(text: str, fallback: str = "Not specified") -> str:
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line == "---":
            continue
        if line.lower() in {"examples:", "current target:", "current expected contribution:"}:
            continue
        if line.startswith("#"):
            continue
        if line.startswith("```"):
            continue
        if line.startswith("<") and line.endswith(">"):
            continue
        line = re.sub(r"^[-*]\s+", "", line)
        line = re.sub(r"^\d+[.)]\s+", "", line)
        line = line.strip()
        if line:
            return line[:240]
    return fallback


def value_after_label(text: str, label: str) -> str:
    lines = text.splitlines()
    normalized = label.lower().rstrip(":")
    for index, raw_line in enumerate(lines):
        stripped = raw_line.strip()
        inline = re.match(rf"^{re.escape(normalized)}\s*:\s*(.+?)\s*$", stripped, re.IGNORECASE)
        if inline:
            value = inline.group(1).strip()
            if value and not (value.startswith("<") and value.endswith(">")):
                return value[:240]
        line = stripped.lower().rstrip(":")
        if line == normalized:
            return first_meaningful_line("\n".join(lines[index + 1 :]), "")
    return ""


def list_section_items(text: str) -> list[str]:
    items: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if re.match(r"^[-*]\s+", line):
            items.append(re.sub(r"^[-*]\s+", "", line).strip())
        elif re.match(r"^\d+[.)]\s+", line):
            items.append(re.sub(r"^\d+[.)]\s+", "", line).strip())
    return [item for item in items if item]


def file_card(path: Path, display_path: str = "") -> dict[str, Any]:
    stat = path.stat()
    text_preview = ""
    suffix = path.suffix.lower()
    kind = file_kind(path)
    previewable = suffix in PREVIEWABLE_SUFFIXES
    if suffix in TEXT_PREVIEW_SUFFIXES:
        text_preview = safe_read(path, 900)
    return {
        "name": path.name,
        "path": display_path or rel_path(path),
        "suffix": suffix,
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "mtime_display": datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat(timespec="seconds"),
        "kind": kind,
        "mime": file_mime(path),
        "previewable": previewable,
        "editable": suffix in EDITABLE_SUFFIXES and (REPO_ROOT.resolve() == path.resolve() or REPO_ROOT.resolve() in path.resolve().parents),
        "preview": text_preview,
        "is_symlink": path.is_symlink(),
    }


def is_duplicate_resource_copy(path: Path) -> bool:
    try:
        relative = path.relative_to(REPO_ROOT)
    except ValueError:
        return False
    parts = relative.parts
    if not parts or parts[0] != "resources" or not path.is_file():
        return False
    match = re.match(r"^(?P<stem>.+)_(?P<copy>[2-9][0-9]*)(?P<suffix>\.[^.]+)$", path.name)
    if not match:
        return False
    canonical = path.with_name(f"{match.group('stem')}{match.group('suffix')}")
    if not canonical.exists() or not canonical.is_file():
        return False
    try:
        source_stat = path.stat()
        canonical_stat = canonical.stat()
    except OSError:
        return False
    return source_stat.st_size == canonical_stat.st_size and int(source_stat.st_mtime) == int(canonical_stat.st_mtime)


def is_resources_relative_path(relative_path: str) -> bool:
    normalized = relative_path.replace("\\", "/").strip("/")
    return normalized == "resources" or normalized.startswith("resources/")


def iter_tree_paths(
    root_path: Path,
    relative_dir: str,
    recursive: bool = True,
    max_depth: int | None = None,
    exclude_names: set[str] | None = None,
    follow_symlink_dirs: bool = False,
):
    excluded = {".DS_Store", ".gitkeep", ".git", "__pycache__", *list(exclude_names or set())}
    seen_dirs: set[str] = set()

    def visit(directory: Path, virtual_relative: str, depth: int):
        try:
            entries = sorted(directory.iterdir(), key=lambda item: item.name.lower())
        except OSError:
            return
        for child in entries:
            if child.name in excluded:
                continue
            child_virtual = f"{virtual_relative.rstrip('/')}/{child.name}" if virtual_relative else child.name
            if any(part in excluded for part in Path(child_virtual).parts):
                continue
            if max_depth is not None and depth + 1 > max_depth:
                continue
            try:
                is_dir = child.is_dir()
            except OSError:
                continue
            if max_depth is not None and depth + 1 == max_depth and is_dir:
                continue
            yield child, child_virtual, depth + 1
            if not recursive or not is_dir:
                continue
            if child.is_symlink() and not follow_symlink_dirs:
                continue
            try:
                resolved = str(child.resolve())
            except OSError:
                continue
            if resolved in seen_dirs:
                continue
            seen_dirs.add(resolved)
            yield from visit(child, child_virtual, depth + 1)

    try:
        seen_dirs.add(str(root_path.resolve()))
    except OSError:
        pass
    yield from visit(root_path, relative_dir, 0)


def list_files(relative_dir: str, recursive: bool = True) -> list[dict[str, Any]]:
    directory = repo_path(relative_dir)
    if not directory.exists() or not directory.is_dir():
        return []
    files: list[dict[str, Any]] = []
    for path, virtual_path, _depth in iter_tree_paths(directory, relative_dir, recursive=recursive, follow_symlink_dirs=False):
        if not path.is_file():
            continue
        if path.name in {".gitkeep", ".DS_Store"}:
            continue
        if is_duplicate_resource_copy(path):
            continue
        if "__pycache__" in path.parts or ".git" in path.parts:
            continue
        try:
            files.append(file_card(path, virtual_path))
        except OSError:
            continue
    return sorted(files, key=lambda item: item["path"])


def tree_node(name: str, path: str, node_type: str, is_symlink: bool = False) -> dict[str, Any]:
    node = {"name": name, "path": path, "type": node_type, "children": []}
    if is_symlink:
        node["is_symlink"] = True
    return node


def tree_lookup_key(relative_path: str) -> str:
    normalized = str(relative_path).replace("\\", "/").strip()
    normalized = re.sub(r"/+", "/", normalized)
    while normalized.startswith("./"):
        normalized = normalized[2:]
    normalized = normalized.strip("/")
    return normalized or "."


def directory_tree(relative_dir: str, max_depth: int | None = None, exclude_names: set[str] | None = None) -> dict[str, Any]:
    root_path = repo_path(relative_dir)
    root = tree_node(Path(relative_dir).name or relative_dir, relative_dir, "directory")
    if not root_path.exists() or not root_path.is_dir():
        return root

    nodes: dict[str, dict[str, Any]] = {tree_lookup_key(relative_dir): root}
    for path, relative, _depth in iter_tree_paths(
        root_path,
        relative_dir,
        max_depth=max_depth,
        exclude_names=exclude_names,
        follow_symlink_dirs=False,
    ):
        if is_duplicate_resource_copy(path):
            continue
        parent_relative = str(Path(relative).parent).replace("\\", "/")
        if parent_relative == ".":
            parent_relative = relative_dir
        parent = nodes.get(tree_lookup_key(parent_relative))
        if not parent:
            continue
        node_type = "directory" if path.is_dir() else "file"
        node = tree_node(path.name, relative, node_type, path.is_symlink())
        if path.is_file():
            try:
                node.update(file_card(path, relative))
            except OSError:
                continue
        nodes[tree_lookup_key(relative)] = node
        parent["children"].append(node)
    return root


def watched_fingerprint() -> dict[str, Any]:
    latest = 0.0
    changed: list[dict[str, Any]] = []
    seen: set[Path] = set()
    for relative in WATCHED_PATHS:
        path = repo_path(relative)
        if not path.exists():
            continue
        paths = [path] if path.is_file() else [p for p in path.rglob("*") if p.is_file() and ".git" not in p.parts]
        for item in paths:
            resolved = item.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            try:
                stat = item.stat()
            except OSError:
                continue
            latest = max(latest, stat.st_mtime)
            changed.append({"path": rel_path(item), "mtime": stat.st_mtime})
    changed = sorted(changed, key=lambda item: item["mtime"], reverse=True)[:18]
    return {
        "latest": latest,
        "latest_display": datetime.fromtimestamp(latest).astimezone().isoformat(timespec="seconds") if latest else "",
        "recent": changed,
    }


def run_git(args: list[str], timeout: int = 3) -> tuple[bool, str]:
    try:
        proc = subprocess.run(["git", *args], cwd=REPO_ROOT, text=True, capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)
    output = (proc.stdout or proc.stderr or "").strip()
    return proc.returncode == 0, output


def git_summary() -> dict[str, Any]:
    if not (REPO_ROOT / ".git").exists():
        return {"available": False, "summary": "This folder is not currently a git repository.", "status": []}
    ok_commit, commit = run_git(["log", "-1", "--pretty=%h %cs %s"])
    ok_branch, branch = run_git(["branch", "--show-current"])
    ok_status, status = run_git(["status", "--short"])
    return {
        "available": True,
        "branch": branch if ok_branch else "",
        "commit": commit if ok_commit else "",
        "status": status.splitlines() if ok_status and status else [],
        "summary": commit if ok_commit else "Git metadata is available, but no commit could be read.",
    }


def project_summary(project_text: str) -> dict[str, Any]:
    target_section = extract_section(project_text, "Target Venue / Audience")
    contribution_section = extract_section(project_text, "Expected Contribution Style")
    target = (
        value_after_label(target_section, "Current target")
        or value_after_label(target_section, "Target venue")
        or first_meaningful_line(target_section, "")
    )
    return {
        "one_sentence": first_meaningful_line(extract_section(project_text, "One-Sentence Project Summary")),
        "goal": first_meaningful_line(extract_section(project_text, "Research Goal")),
        "motivation": first_meaningful_line(extract_section(project_text, "Motivation")),
        "target": target or "Not specified",
        "research_type": first_meaningful_line(extract_section(project_text, "Target Research Type")),
        "contribution": value_after_label(contribution_section, "Current expected contribution") or "Not specified",
        "questions": list_section_items(extract_section(project_text, "Core Research Questions"))[:5],
    }


def meaningful_summary_value(value: str) -> bool:
    text = str(value or "").strip()
    if not text or text == "Not specified":
        return False
    if text.startswith("<") and text.endswith(">"):
        return False
    if text in {"...", "--"}:
        return False
    if re.match(r"^No .* yet\.?$", text, re.IGNORECASE):
        return False
    if re.match(r"^No detail yet\.?$", text, re.IGNORECASE):
        return False
    if re.match(r"^Content to include\b", text, re.IGNORECASE):
        return False
    if re.match(r"^Status:\s*planned\b", text, re.IGNORECASE):
        return False
    if "Conceptual figures should be specified" in text:
        return False
    return True


def clean_summary_value(value: str) -> str:
    text = str(value or "").strip()
    return text if meaningful_summary_value(text) else ""


def is_default_initial_brief(text: str) -> bool:
    return "Write one sentence or a few paragraphs describing what you want this project to do." in text and "Examples:" in text


def default_brief_from_project(project_text: str) -> str:
    summary = project_summary(project_text)
    lines = []
    if meaningful_summary_value(summary.get("one_sentence", "")):
        lines.append(f"- Current project summary: {summary['one_sentence']}")
    if meaningful_summary_value(summary.get("goal", "")):
        lines.append(f"- Research goal: {summary['goal']}")
    if meaningful_summary_value(summary.get("motivation", "")):
        lines.append(f"- Motivation: {summary['motivation']}")
    if meaningful_summary_value(summary.get("target", "")):
        lines.append(f"- Existing target venue / audience: {summary['target']}")
    if meaningful_summary_value(summary.get("contribution", "")):
        lines.append(f"- Expected contribution: {summary['contribution']}")
    questions = [question for question in summary.get("questions", []) if meaningful_summary_value(question)]
    if questions:
        lines.append("- Current research questions:")
        lines.extend(f"  - {question}" for question in questions[:3])
    if not lines:
        return ""
    return "# Initial User Brief\n\nPlease cold-start / adapt the research project using the existing project context below.\n\n" + "\n".join(lines)


def cold_start_file_for_ui(relative_path: str, project_text: str) -> dict[str, Any]:
    file_info = read_text_file(relative_path)
    if relative_path != "resources/user_input/INITIAL_BRIEF.md":
        return file_info
    text = str(file_info.get("text", "") or "")
    if not text.strip() or is_default_initial_brief(text):
        derived = default_brief_from_project(project_text)
        file_info["text"] = derived
        file_info["derived_from_project"] = bool(derived)
    return file_info


def state_summary(state_text: str) -> dict[str, Any]:
    active_epoch = first_meaningful_line(extract_section(state_text, "Active Epoch"), "Unknown")
    active_epoch = active_epoch.strip("`")
    return {
        "active_epoch": active_epoch,
        "direction": first_meaningful_line(extract_section(state_text, "Current Direction")),
        "plan": list_section_items(extract_section(state_text, "Current Plan"))[:8],
        "cold_start": list_section_items(extract_section(state_text, "Cold Start / Conversion Status"))[:8],
        "seed_papers": list_section_items(extract_section(state_text, "Target Venue / Seed Paper Status"))[:8],
        "interventions": list_section_items(extract_section(state_text, "Active Human Interventions"))[:8],
        "accepted_evidence": list_section_items(extract_section(state_text, "Accepted Evidence"))[:8],
        "tentative_evidence": list_section_items(extract_section(state_text, "Tentative Evidence"))[:8],
        "open_questions": list_section_items(extract_section(state_text, "Open Questions"))[:8],
        "latest_update": first_meaningful_line(extract_section(state_text, "Latest State Update"), "No update recorded"),
    }


def parse_reference_table(references_text: str) -> list[dict[str, str]]:
    """Parse the ``## References`` markdown table into structured entries."""
    entries: list[dict[str, str]] = []
    for line in references_text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) < 3:
            continue
        key = cells[0]
        # Skip the header row and the |---|---| separator row.
        if key.lower() == "key" or set(key) <= {"-", ":"}:
            continue
        if not meaningful_summary_value(key) and not meaningful_summary_value(cells[1]):
            continue
        entries.append({"key": key, "reference": cells[1], "locator": cells[2]})
    return entries


def manuscript_summary(blueprint_text: str, figure_text: str) -> dict[str, Any]:
    sections = extract_sections(blueprint_text)

    def real_section(section: dict[str, Any]) -> bool:
        title = str(section.get("title", ""))
        body = str(section.get("body", ""))
        if "<" in title or "<" in body:
            return False
        return meaningful_summary_value(body) or meaningful_summary_value(title)

    def title_starts(section: dict[str, Any], prefix: str) -> bool:
        return str(section.get("title", "")).strip().lower().startswith(prefix)

    def artifact_kind(title: str) -> str:
        value = str(title or "").strip().lower()
        if re.match(r"^(figure|fig\.?|f\d{3,})\b", value):
            return "figure"
        if re.match(r"^(table|tbl\.?|t\d{3,})\b", value):
            return "table"
        if re.match(r"^(algorithm|protocol|procedure|a\d{3,}|method\s+(?:m?\d|block|spec|:))\b", value):
            return "algorithm"
        if re.match(r"^(dataset|data set|benchmark|metric|rslt\d{3,}|result\s+(?:rslt?\d|\d|block|:))\b", value):
            return "result"
        return ""

    def architecture_heading_blocks(section_text: str) -> list[dict[str, Any]]:
        matches = list(re.finditer(r"^(#{3,6})\s+(.+?)\s*$", section_text, re.MULTILINE))
        blocks: list[dict[str, Any]] = []
        stack: list[dict[str, Any]] = []
        for index, match in enumerate(matches):
            level = len(match.group(1))
            title = match.group(2).strip()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(section_text)
            body = section_text[match.end():end].strip()
            while stack and int(stack[-1]["level"]) >= level:
                stack.pop()
            parents = [str(item["title"]) for item in stack]
            kind = artifact_kind(title)
            block = {
                "level": level,
                "title": title,
                "body": body,
                "parents": parents,
                "path": " / ".join([*parents, title]),
                "kind": kind or "section",
                "is_artifact": bool(kind),
            }
            blocks.append(block)
            stack.append({"level": level, "title": title})
        return [block for block in blocks if real_section(block)]

    def figure_plan_section(section: dict[str, Any]) -> bool:
        title = str(section.get("title", "")).strip()
        if not title.lower().startswith("figure"):
            return False
        if re.match(r"^figure\s+plan$", title, re.IGNORECASE):
            return False
        return bool(re.search(r"\b(?:f\d{3,}|figure\s+\d+)\b", title, re.IGNORECASE))

    def table_plan_section(section: dict[str, Any]) -> bool:
        title = str(section.get("title", "")).strip()
        if not title.lower().startswith("table"):
            return False
        if re.match(r"^table\s+plan$", title, re.IGNORECASE):
            return False
        return bool(re.search(r"\b(?:t\d{3,}|table\s+\d+)\b", title, re.IGNORECASE))

    claims = [section for section in sections if section["title"].lower().startswith("c") and real_section(section)]
    architecture_text = extract_section(blueprint_text, "Manuscript Architecture")
    architecture = architecture_heading_blocks(architecture_text)
    legacy_architecture_sections = [
        {"level": 3, "title": title, "body": body, "kind": "section", "is_artifact": False, "parents": [], "path": title}
        for title, body in blueprint_section_blocks(extract_section(blueprint_text, "Section-By-Section Architecture"))
    ]
    section_blueprint = [section for section in legacy_architecture_sections if real_section(section)]
    figure_sections = [section for section in sections if title_starts(section, "figure") and real_section(section)]
    table_sections = [section for section in sections if title_starts(section, "table") and real_section(section)]
    figure_plans = [section for section in sections if figure_plan_section(section) and real_section(section)]
    table_plans = [section for section in sections if table_plan_section(section) and real_section(section)]
    no_table_rationale = clean_summary_value(extract_section(blueprint_text, "No-Table Rationale", level=3)) or clean_summary_value(extract_section(blueprint_text, "No-Table Rationale"))
    provenance = (
        clean_summary_value(extract_section(blueprint_text, "Provenance / Audit Index"))
        or clean_summary_value(extract_section(blueprint_text, "Accepted Claims And Evidence Map"))
        or clean_summary_value(extract_section(blueprint_text, "Accepted Claims and Evidence Map"))
        or clean_summary_value(extract_section(blueprint_text, "Active Claims and Evidence Map"))
        or clean_summary_value(extract_section(blueprint_text, "Candidate Claims And Evidence Map"))
        or clean_summary_value(extract_section(blueprint_text, "Candidate Claims and Evidence Map"))
    )
    target_section = extract_section(blueprint_text, "Target Venue / Audience / Article Type") or extract_section(blueprint_text, "Target Venue / Audience")
    figure_specs = [
        section
        for section in extract_sections(figure_text)
        if real_section(section) and str(section.get("title", "")).strip().lower() not in {"figures", "figure specs", "figure specifications"}
    ]
    toc = clean_summary_value(extract_section(blueprint_text, "Architecture Overview / Table of Contents"))
    references_text = extract_section(blueprint_text, "References")
    references = parse_reference_table(references_text)
    reference_status = clean_summary_value(value_after_label(references_text, "Reference integrity status"))
    inline_artifacts = [block for block in architecture if block.get("is_artifact")]
    section_architecture = [block for block in architecture if not block.get("is_artifact")]

    def appendix_files() -> list[dict[str, str]]:
        root = REPO_ROOT / "manuscript" / "appendix"
        if not root.is_dir():
            return []
        files: list[dict[str, str]] = []
        for path in sorted(root.glob("*.md")):
            if path.name == ".gitkeep" or not path.is_file():
                continue
            relative = rel_path(path)
            text = path.read_text(encoding="utf-8", errors="replace")[:MAX_TEXT_BYTES]
            heading = re.search(r"^\s*#\s+(.+?)\s*$", text, re.MULTILINE)
            title = clean_summary_value(heading.group(1) if heading else path.stem.replace("_", " ").replace("-", " "))
            body = re.sub(r"^\s*#\s+.+?\s*$", "", text, count=1, flags=re.MULTILINE).strip()
            files.append({
                "path": relative,
                "title": title or path.name,
                "summary": first_meaningful_line(body, ""),
            })
        return files

    return {
        "target": clean_summary_value(value_after_label(target_section, "Target venue") or first_meaningful_line(target_section)),
        "audience": clean_summary_value(value_after_label(target_section, "Audience")),
        "article_type": clean_summary_value(value_after_label(target_section, "Article type")),
        "contribution": clean_summary_value(value_after_label(target_section, "Contribution posture") or value_after_label(target_section, "Contribution style")),
        "evidence_standard": clean_summary_value(value_after_label(target_section, "Evidence standard")),
        "display_style": clean_summary_value(value_after_label(target_section, "Expected display / method / result style")),
        "core_story": clean_summary_value(extract_section(blueprint_text, "Core Story")),
        "toc": toc,
        "architecture": architecture,
        "inline_artifacts": inline_artifacts,
        "claims": claims,
        "sections": section_architecture or section_blueprint,
        "section_blueprint": section_architecture or section_blueprint,
        "figures": [item for item in inline_artifacts if item.get("kind") == "figure"] or figure_sections,
        "figure_plans": [item for item in inline_artifacts if item.get("kind") == "figure"] or figure_plans or figure_sections,
        "tables": [item for item in inline_artifacts if item.get("kind") == "table"] or table_sections,
        "table_plans": [item for item in inline_artifacts if item.get("kind") == "table"] or table_plans,
        "no_table_rationale": no_table_rationale,
        "references": references,
        "reference_status": reference_status,
        "appendix_plan": clean_summary_value(extract_section(blueprint_text, "Appendix / Supplement Plan")),
        "appendix_files": appendix_files(),
        "provenance": provenance,
        "traceability": provenance,
        "missing_evidence": [item for item in list_section_items(extract_section(blueprint_text, "Blocking Missing Evidence") or extract_section(blueprint_text, "Missing Evidence")) if meaningful_summary_value(item)][:12],
        "figure_specs": figure_specs[:10],
    }


def current_target_venue(project_text: str, blueprint_text: str, project: dict[str, Any] | None = None, manuscript: dict[str, Any] | None = None) -> str:
    target_note = REPO_ROOT / "resources" / "target_venue" / "TARGET_VENUE.md"
    if target_note.exists():
        target = first_meaningful_line(target_note.read_text(encoding="utf-8", errors="replace"), "")
        if meaningful_summary_value(target):
            return target
    project = project or project_summary(project_text)
    target = str(project.get("target") or "")
    if meaningful_summary_value(target):
        return target
    manuscript = manuscript or manuscript_summary(blueprint_text, "")
    target = str(manuscript.get("target") or "")
    if meaningful_summary_value(target):
        return target
    return ""


def infer_trial_status(plan: str, review: str, report: str) -> str:
    for text in (review, report, plan):
        for pattern in (
            r"^\s*(?:status|overall status|gate status)\s*:\s*`?([^`\n]+)`?\s*$",
            r"^\s*(?:decision|gate impact)\s*:\s*`?([^`\n]+)`?\s*$",
        ):
            for match in re.finditer(pattern, text or "", re.IGNORECASE | re.MULTILINE):
                if normalize_gate_status(match.group(1)) == "blocked":
                    return "blocked"
    report_first_line = first_meaningful_line(report, "")
    if (
        report.strip()
        and "<" not in report_first_line
        and not re.match(r"^\s*(?:#\s*)?(?:placeholder|todo|tbd)\b", report_first_line, re.IGNORECASE)
    ):
        return "reported"
    if re.search(r"\bapprove\b", review, re.IGNORECASE):
        return "reviewed"
    if plan.strip():
        return "planned"
    return "unknown"


def review_verdict(review: str) -> str:
    verdict_section = extract_section(review, "Verdict")
    first = first_meaningful_line(verdict_section, "")
    if first:
        return first.split()[0].strip("`.,:;").lower()
    match = re.search(r"\b(approve|revise_before_execution|needs_method_grounding|needs_resource_grounding|reject_plan)\b", review)
    return match.group(1) if match else ""


def trial_review_path(trial_dir: Path) -> Path | None:
    review_dir = trial_dir / "reviews"
    if review_dir.is_dir():
        for config in REQUIRED_REVIEWER_OUTPUTS.values():
            path = review_dir / config["file"]
            if path.exists():
                return path
    for name in ("REVIEW.md", "PLAN_REVIEW.md"):
        path = trial_dir / name
        if path.exists():
            return path
    return None


def trial_report_summary(report: str) -> str:
    for heading in (
        "Findings",
        "Work Performed",
        "What Was Done",
        "Gate Implications",
        "Manuscript Updates",
        "Objective",
        "Next Recommended Trial",
    ):
        line = first_meaningful_line(extract_section(report, heading), "")
        if meaningful_summary_value(line):
            return line
    return first_meaningful_line(report, "No report summary yet")


def path_mtime_iso(path: Path) -> str:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat(timespec="seconds")
    except OSError:
        return ""


def latest_mtime_iso(paths: list[Path]) -> str:
    latest = 0.0
    for path in paths:
        try:
            latest = max(latest, path.stat().st_mtime)
        except OSError:
            continue
    if latest <= 0:
        return ""
    return datetime.fromtimestamp(latest).astimezone().isoformat(timespec="seconds")


def trial_gate_updated(trial_dir: Path, state_text: str = "") -> bool:
    if not state_text and RESEARCH_STATE_PATH.exists():
        state_text = safe_read(RESEARCH_STATE_PATH)
    section = markdown_section(state_text, "Autoresearch Goal Gate") if state_text else ""
    if not section:
        return False
    trial_root = project_relative_path(REPO_ROOT, trial_dir)
    return trial_dir.name in section or trial_root in section


def trial_progress_summary(trial_dir: Path, plan: str = "", report: str = "", artifacts: list[dict[str, Any]] | None = None, state_text: str = "") -> dict[str, Any]:
    plan_path = trial_dir / "PLAN.md"
    report_path = trial_dir / "REPORT.md"
    artifacts_dir = trial_dir / "artifacts"
    artifact_items = artifacts if artifacts is not None else (
        [file_card(path) for path in artifacts_dir.rglob("*") if path.is_file() and path.name != ".gitkeep"]
        if artifacts_dir.exists()
        else []
    )
    review_statuses: dict[str, str] = {}
    review_paths: list[Path] = []
    for key in REQUIRED_REVIEWER_OUTPUTS:
        path = reviewer_output_path(trial_dir, key)
        status = reviewer_file_status(path)
        review_statuses[key] = status
        if path.exists() and path.is_file():
            review_paths.append(path)
    reviewer_total = len(REQUIRED_REVIEWER_OUTPUTS)
    reviewer_count = len(review_paths)
    reviewer_pass_count = sum(1 for status in review_statuses.values() if status == "pass")
    plan_exists = plan_path.exists()
    report_exists = report_path.exists()
    artifacts_count = len(artifact_items)
    gate_updated = trial_gate_updated(trial_dir, state_text)
    touched_paths = [path for path in [plan_path, report_path] if path.exists()]
    touched_paths.extend(review_paths)
    touched_paths.extend(REPO_ROOT / str(item.get("path") or "") for item in artifact_items if item.get("path"))
    if gate_updated and RESEARCH_STATE_PATH.exists():
        touched_paths.append(RESEARCH_STATE_PATH)

    if not plan_exists and not report_exists:
        stage_index = 1
        summary = "Planning · waiting for PLAN.md"
        detail = "No trial plan has been written yet."
    elif not artifacts_count and not report_exists:
        stage_index = 2
        summary = "Working · plan ready"
        detail = first_meaningful_line(extract_section(plan, "Objective"), "Executing the trial plan.")
    elif artifacts_count and not report_exists:
        stage_index = 3
        summary = f"Synthesizing · {artifacts_count} artifact{'s' if artifacts_count != 1 else ''} collected"
        detail = "Artifacts exist; REPORT.md is not available yet."
    elif report_exists and reviewer_count <= 0:
        stage_index = 4
        summary = "Reported · reviewer files missing"
        detail = f"{trial_report_summary(report)} - Reviewer gate files have not been recorded yet."
    elif reviewer_count < reviewer_total:
        stage_index = 5
        summary = f"Reviewing · {reviewer_count}/{reviewer_total} reviewer files"
        detail = f"{reviewer_pass_count}/{reviewer_total} reviewer gates are pass."
    else:
        stage_index = 6
        summary = "Gate update · STATE.md gate refreshed" if gate_updated else "Gate update · waiting for STATE.md gate"
        detail = f"{reviewer_pass_count}/{reviewer_total} reviewer gates are pass."

    stage = TRIAL_PROGRESS_STAGES[stage_index - 1]
    return {
        "stage": stage["key"],
        "stage_label": stage["label"],
        "stage_index": stage_index,
        "total_stages": len(TRIAL_PROGRESS_STAGES),
        "summary": summary,
        "detail": detail,
        "reviewer_count": reviewer_count,
        "reviewer_pass_count": reviewer_pass_count,
        "reviewer_total": reviewer_total,
        "review_statuses": review_statuses,
        "artifacts_count": artifacts_count,
        "plan_exists": plan_exists,
        "report_exists": report_exists,
        "reported_only": bool(report_exists and reviewer_count < reviewer_total),
        "gate_updated": gate_updated,
        "updated_at": latest_mtime_iso(touched_paths) or path_mtime_iso(trial_dir),
        "stages": TRIAL_PROGRESS_STAGES,
    }


def active_trial_progress(iteration: int, state_text: str = "") -> dict[str, Any]:
    if iteration <= 0:
        return {}
    for trial_dir in reversed(project_active_trial_dirs(REPO_ROOT)):
        if trial_iteration_from_id(trial_dir.name) == iteration:
            return trial_progress_summary(
                trial_dir,
                safe_read(trial_dir / "PLAN.md"),
                safe_read(trial_dir / "REPORT.md"),
                None,
                state_text,
            )
    return {
        "stage": "planning",
        "stage_label": "Planning",
        "stage_index": 1,
        "total_stages": len(TRIAL_PROGRESS_STAGES),
        "summary": "Planning · waiting for trial files",
        "detail": f"Trial {iteration} has started, but its trial directory is not visible yet.",
        "reviewer_count": 0,
        "reviewer_pass_count": 0,
        "reviewer_total": len(REQUIRED_REVIEWER_OUTPUTS),
        "review_statuses": {},
        "artifacts_count": 0,
        "plan_exists": False,
        "report_exists": False,
        "gate_updated": False,
        "updated_at": "",
        "stages": TRIAL_PROGRESS_STAGES,
    }


def trial_checkpoint_dir(trial_id: str) -> Path:
    return REPO_ROOT / "research_trajectory" / "checkpoints" / slugify(trial_id, "trial")


def copy_snapshot_path(relative_path: str, destination_root: Path) -> str:
    source = REPO_ROOT / relative_path
    if not source.exists():
        return ""
    destination = destination_root / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        if destination.exists() or destination.is_symlink():
            if destination.is_dir() and not destination.is_symlink():
                shutil.rmtree(destination)
            else:
                destination.unlink()
        shutil.copytree(source, destination, symlinks=True)
        ensure_tree_user_writable(destination)
    else:
        ensure_existing_destination_user_writable(destination)
        shutil.copy2(source, destination)
        ensure_path_user_writable(destination)
    return relative_path


def ensure_path_user_writable(path: Path) -> None:
    try:
        if path.is_symlink() or not path.exists():
            return
        current = path.stat().st_mode
        wanted = stat.S_IRUSR | stat.S_IWUSR
        if path.is_dir():
            wanted |= stat.S_IXUSR
        if (current & wanted) != wanted:
            path.chmod(current | wanted)
    except OSError:
        return


def ensure_tree_user_writable(path: Path) -> None:
    ensure_path_user_writable(path)
    if not path.is_dir() or path.is_symlink():
        return
    for child in path.rglob("*"):
        ensure_path_user_writable(child)


def ensure_existing_destination_user_writable(path: Path) -> None:
    if path.exists() or path.is_symlink():
        ensure_path_user_writable(path)


def copy_resume_snapshot(destination_root: Path) -> list[str]:
    destination_root.mkdir(parents=True, exist_ok=True)
    copied = []
    for relative_path in RESUME_SNAPSHOT_PATHS:
        copied_path = copy_snapshot_path(relative_path, destination_root)
        if copied_path:
            copied.append(copied_path)
    return copied


def copy_project_snapshot(paths: list[str], destination_root: Path) -> list[str]:
    destination_root.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for relative_path in paths:
        copied_path = copy_snapshot_path(relative_path, destination_root)
        if copied_path:
            copied.append(copied_path)
    return copied


def archive_runtime_snapshot(destination_root: Path) -> list[str]:
    copied: list[str] = []
    runtime_root = destination_root / "ui/.runtime"
    runtime_root.mkdir(parents=True, exist_ok=True)
    for path in [SESSION_STATE_PATH, FRAMING_MESSAGES_PATH]:
        if not path.exists():
            continue
        destination = runtime_root / path.name
        shutil.copy2(path, destination)
        copied.append(f"ui/.runtime/{path.name}")
    return copied


def normalize_project_resource_path(value: str) -> str:
    raw = str(value or "").strip()
    if not raw or raw.startswith("<"):
        return ""
    try:
        candidate = Path(raw).expanduser()
    except (OSError, ValueError):
        return ""
    if candidate.is_absolute():
        try:
            relative = candidate.resolve().relative_to(REPO_ROOT.resolve())
        except (OSError, ValueError):
            return ""
    else:
        relative = Path(raw)
    parts = relative.parts
    if not parts or parts[0] != "resources":
        return ""
    normalized = relative.as_posix()
    if normalized == RESOURCE_MANIFEST_RELATIVE_PATH:
        return ""
    return normalized


def parse_resource_manifest_entries(manifest_path: Path | None = None) -> list[dict[str, Any]]:
    path = manifest_path or (REPO_ROOT / RESOURCE_MANIFEST_RELATIVE_PATH)
    if not path.exists() or not path.is_file():
        return []
    text = path.read_text(encoding="utf-8", errors="replace")
    entries: list[dict[str, Any]] = []
    current_section = ""
    current_section_for_entry = ""
    current: list[str] = []

    def flush() -> None:
        nonlocal current, current_section_for_entry
        if not current:
            return
        block = "\n".join(current).strip()
        provenance_match = re.search(r"Provenance:\s*`([^`]+)`", block)
        provenance = provenance_match.group(1).strip() if provenance_match else "unknown"
        if provenance not in RESOURCE_PROVENANCE_VALUES:
            provenance = "unknown"
        resource_paths: list[str] = []
        for value in re.findall(r"`([^`]+)`", block):
            resource_path = normalize_project_resource_path(value)
            if resource_path and resource_path not in resource_paths:
                resource_paths.append(resource_path)
        entries.append({
            "section": current_section_for_entry,
            "text": block,
            "provenance": provenance,
            "project_resource_paths": resource_paths,
        })
        current = []
        current_section_for_entry = ""

    for line in text.splitlines():
        if line.startswith("## "):
            flush()
            current_section = line.strip("# ").strip()
            continue
        if line.startswith("- "):
            flush()
            current = [line]
            current_section_for_entry = current_section
            continue
        if current and (line.startswith("  ") or not line.strip()):
            current.append(line)
    flush()
    return entries


def archive_inactive_resource_entries(restart_root: Path, entries: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    retained: list[dict[str, Any]] = []
    inactive: list[dict[str, Any]] = []
    moved_sources: set[str] = set()
    for entry in entries:
        provenance = str(entry.get("provenance") or "unknown")
        if provenance in RESTART_RETAINED_PROVENANCE:
            retained.append(entry)
            continue
        archived_paths: list[dict[str, str]] = []
        for resource_path in entry.get("project_resource_paths") or []:
            if not isinstance(resource_path, str) or not resource_path or resource_path in moved_sources:
                continue
            source = REPO_ROOT / resource_path
            if not source.exists():
                continue
            destination = restart_root / "inactive_resources" / resource_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            final_destination = unique_path(destination.parent, destination.name)
            shutil.move(str(source), str(final_destination))
            moved_sources.add(resource_path)
            archived_paths.append({
                "from": resource_path,
                "to": rel_path(final_destination),
            })
        cloned = dict(entry)
        cloned["archived_paths"] = archived_paths
        inactive.append(cloned)
    return retained, inactive


def restore_snapshot_from(checkpoint_root: Path) -> list[str]:
    restored = []
    for relative_path in RESUME_SNAPSHOT_PATHS:
        source = checkpoint_root / relative_path
        if not source.exists():
            continue
        destination = REPO_ROOT / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            if destination.exists() or destination.is_symlink():
                if destination.is_dir() and not destination.is_symlink():
                    shutil.rmtree(destination)
                else:
                    ensure_existing_destination_user_writable(destination)
                    destination.unlink()
            shutil.copytree(source, destination, symlinks=True)
            ensure_tree_user_writable(destination)
        else:
            ensure_existing_destination_user_writable(destination)
            shutil.copy2(source, destination)
            ensure_path_user_writable(destination)
        restored.append(relative_path)
    return restored


TRAJECTORY_SCHEMA_VERSION = 1
GATE_SCHEMA_VERSION = 1


def trial_iteration_from_id(trial_id: str) -> int:
    match = re.match(r"0*(\d+)", str(trial_id or ""))
    return int(match.group(1)) if match else 0


def default_trajectory_state() -> dict[str, Any]:
    return {
        "schema_version": TRAJECTORY_SCHEMA_VERSION,
        "active_epoch": "current",
        "fork_id": "",
        "base_trial": "",
        "latest_active_trial": "",
        "next_trial_number": 1,
        "archived_trial_ids": [],
        "gate_schema_version": GATE_SCHEMA_VERSION,
        "updated_at": now_iso(),
    }


def read_trajectory_state() -> dict[str, Any]:
    state = default_trajectory_state()
    if TRAJECTORY_PATH.exists():
        try:
            payload = json.loads(TRAJECTORY_PATH.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                state.update(payload)
        except (OSError, json.JSONDecodeError):
            pass
    archived = state.get("archived_trial_ids")
    state["archived_trial_ids"] = [str(item) for item in archived] if isinstance(archived, list) else []
    state["next_trial_number"] = max(1, int(state.get("next_trial_number") or 1))
    state["schema_version"] = TRAJECTORY_SCHEMA_VERSION
    state["gate_schema_version"] = GATE_SCHEMA_VERSION
    return state


def write_trajectory_state(state: dict[str, Any]) -> dict[str, Any]:
    ensure_current_project_writeable()
    payload = default_trajectory_state()
    payload.update({key: value for key, value in state.items() if value is not None})
    payload["schema_version"] = TRAJECTORY_SCHEMA_VERSION
    payload["gate_schema_version"] = GATE_SCHEMA_VERSION
    payload["archived_trial_ids"] = sorted({str(item) for item in payload.get("archived_trial_ids", []) if str(item).strip()})
    payload["next_trial_number"] = max(1, int(payload.get("next_trial_number") or 1))
    payload["updated_at"] = now_iso()
    TRAJECTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    TRAJECTORY_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def active_trial_dirs() -> list[Path]:
    root = REPO_ROOT / "research_trajectory" / "trials"
    if not root.is_dir():
        return []
    archived_ids = set(read_trajectory_state().get("archived_trial_ids") or [])
    dirs: list[Path] = []
    for path in root.iterdir():
        if not path.is_dir():
            continue
        if path.name in archived_ids:
            continue
        if not any((path / name).exists() for name in ("PLAN.md", "PLAN_REVIEW.md", "REPORT.md", "artifacts")):
            continue
        if re.match(r"^0*_?project_conversion", path.name, re.IGNORECASE):
            continue
        dirs.append(path)
    return sorted(dirs, key=lambda path: (trial_iteration_from_id(path.name), path.name))


def trial_dir_is_closed(trial_dir: Path) -> bool:
    if not (trial_dir / "REPORT.md").is_file():
        return False
    review_dir = trial_dir / "reviews"
    return review_dir.is_dir() and all((review_dir / name).is_file() for name in REQUIRED_REVIEWER_FILES)


def trial_dir_is_reported(trial_dir: Path) -> bool:
    return (trial_dir / "REPORT.md").is_file()


def active_trial_dir_for_iteration(iteration: int) -> Path | None:
    for path in active_trial_dirs():
        if trial_iteration_from_id(path.name) == iteration:
            return path
    return None


def closed_active_trial_dirs() -> list[Path]:
    # The canonical resume boundary stops at the first unclosed active trial.
    closed: list[Path] = []
    for path in active_trial_dirs():
        if not trial_dir_is_closed(path):
            break
        closed.append(path)
    return closed


def closed_trial_dirs_any_order() -> list[Path]:
    return [path for path in active_trial_dirs() if trial_dir_is_closed(path)]


def reported_trial_dirs_any_order() -> list[Path]:
    return [path for path in active_trial_dirs() if trial_dir_is_reported(path)]


def trajectory_boundary_iteration() -> int:
    state = read_trajectory_state()
    return max(
        trial_iteration_from_id(state.get("latest_active_trial") or ""),
        trial_iteration_from_id(state.get("base_trial") or ""),
        0,
    )


def interrupted_tail_trial_dirs() -> list[Path]:
    active = active_trial_dirs()
    boundary_iteration = latest_active_trial_iteration()
    return [
        path
        for path in active
        if trial_iteration_from_id(path.name) > boundary_iteration and not trial_dir_is_reported(path)
    ]


def latest_active_trial_iteration() -> int:
    closed_iterations = [trial_iteration_from_id(path.name) for path in closed_active_trial_dirs()]
    if closed_iterations:
        return max(closed_iterations)
    active_dirs = active_trial_dirs()
    return 0 if active_dirs else trajectory_boundary_iteration()


def latest_trial_dir_iteration() -> int:
    # Latest trial directory present on disk, regardless of whether it is fully
    # closed (reviews complete). Used for live status display so the trial the
    # agent is actively working on (e.g. report written, reviews pending) is
    # surfaced instead of a phantom not-yet-visible next trial.
    return max([trial_iteration_from_id(path.name) for path in active_trial_dirs()], default=0)


def next_active_trial_iteration() -> int:
    return max(1, latest_active_trial_iteration() + 1)


def sync_trajectory_state(reason: str = "") -> dict[str, Any]:
    state = read_trajectory_state()
    closed = closed_active_trial_dirs()
    latest = closed[-1].name if closed else ""
    latest_iteration = trial_iteration_from_id(latest)
    if not latest and not active_trial_dirs():
        latest = str(state.get("latest_active_trial") or state.get("base_trial") or "")
        latest_iteration = trial_iteration_from_id(latest)
    next_number = latest_iteration + 1 if latest_iteration else 1
    if (
        state.get("latest_active_trial") != latest
        or int(state.get("next_trial_number") or 1) != next_number
        or not TRAJECTORY_PATH.exists()
    ):
        state["latest_active_trial"] = latest
        state["next_trial_number"] = next_number
        if reason:
            state["last_sync_reason"] = reason
        state = write_trajectory_state(state)
    return state


def set_resume_fork_trajectory(base_trial: dict[str, Any], fork_id: str, archived_trials: list[dict[str, str]]) -> dict[str, Any]:
    base_id = str(base_trial.get("id") or "")
    base_iteration = trial_iteration_from_id(base_id)
    prior = read_trajectory_state()
    archived_ids = set(prior.get("archived_trial_ids") or [])
    archived_ids.update(str(item.get("id") or "") for item in archived_trials if str(item.get("id") or "").strip())
    return write_trajectory_state(
        {
            **prior,
            "active_epoch": "current",
            "fork_id": fork_id,
            "base_trial": base_id,
            "latest_active_trial": base_id,
            "next_trial_number": base_iteration + 1,
            "archived_trial_ids": sorted(archived_ids),
            "last_sync_reason": "resume_from_trial",
        }
    )


def expected_trial_marker_path() -> Path:
    return REPO_ROOT / "research_trajectory" / "NEXT_TRIAL.json"


def write_expected_trial_marker(
    iteration: int,
    reason: str,
    base_trial: str = "",
    fork_id: str = "",
    pending_interventions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    interventions = pending_interventions if pending_interventions is not None else pending_human_interventions()
    payload = {
        "schema_version": TRAJECTORY_SCHEMA_VERSION,
        "status": "pending",
        "expected_iteration": int(iteration),
        "reason": reason,
        "base_trial": base_trial,
        "fork_id": fork_id,
        "pending_intervention_ids": [str(item.get("id") or "") for item in interventions if str(item.get("id") or "").strip()],
        "pending_intervention_paths": [str(item.get("path") or "") for item in interventions if str(item.get("path") or "").strip()],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    path = expected_trial_marker_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def read_expected_trial_marker() -> dict[str, Any]:
    path = expected_trial_marker_path()
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def active_expected_trial_iteration(marker: dict[str, Any]) -> int:
    status = str(marker.get("status") or "").strip().lower()
    if status not in ACTIVE_EXPECTED_TRIAL_MARKER_STATUSES:
        return 0
    try:
        expected = int(marker.get("expected_iteration") or 0)
    except (TypeError, ValueError):
        return 0
    return expected if expected > 0 else 0


def update_expected_trial_marker(payload: dict[str, Any]) -> None:
    payload = dict(payload)
    payload["updated_at"] = now_iso()
    path = expected_trial_marker_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def complete_expected_trial_marker(reason: str) -> None:
    marker = read_expected_trial_marker()
    if active_expected_trial_iteration(marker) <= 0:
        return
    expected = int(marker.get("expected_iteration") or 0)
    trial_dir = active_trial_dir_for_iteration(expected) if expected > 0 else None
    if trial_dir is None:
        blocker = f"Expected Trial {expected} directory is not visible yet."
        if marker.get("completion_blocked_reason") != blocker:
            marker["completion_blocked_reason"] = blocker
            update_expected_trial_marker(marker)
            append_research_log(f"Expected trial marker not completed: {blocker}")
        return
    if not trial_dir_satisfies_current_boundary(trial_dir):
        blocker = f"Expected Trial {expected} does not satisfy the current closed-boundary requirements."
        if marker.get("completion_blocked_reason") != blocker:
            marker["completion_blocked_reason"] = blocker
            update_expected_trial_marker(marker)
            append_research_log(f"Expected trial marker not completed: {blocker}")
        return
    mark_pending_interventions_applied(marker, trial_dir.name, rel_path(trial_dir), reason)
    marker.pop("completion_blocked_reason", None)
    marker["status"] = "complete"
    marker["completed_reason"] = reason
    update_expected_trial_marker(marker)


def validate_expected_trial_marker() -> None:
    marker = read_expected_trial_marker()
    if not marker or marker.get("status") != "pending":
        return
    expected = int(marker.get("expected_iteration") or 0)
    if expected <= 0:
        return
    current_boundary_iterations = [
        trial_iteration_from_id(path.name)
        for path in active_trial_dirs()
        if trial_dir_satisfies_current_boundary(path)
    ]
    if expected in current_boundary_iterations:
        trial_dir = active_trial_dir_for_iteration(expected)
        if trial_dir is not None:
            mark_pending_interventions_applied(marker, trial_dir.name, rel_path(trial_dir), "expected_trial_fulfilled")
        marker["status"] = "fulfilled"
        update_expected_trial_marker(marker)
        sync_trajectory_state("expected_trial_fulfilled")
        return
    reported_iterations = [trial_iteration_from_id(path.name) for path in reported_trial_dirs_any_order()]
    higher = [value for value in reported_iterations if value > expected]
    if higher:
        marker["status"] = "mismatch"
        marker["actual_iterations"] = sorted(reported_iterations)
        update_expected_trial_marker(marker)
        stop_autoresearch_loop("trajectory_mismatch", read_autoresearch_gate())
        append_research_log(
            f"Trajectory mismatch: expected the agent to close Trial {expected}, but reported trials are {sorted(reported_iterations)}."
        )


def pending_expected_trial_iteration() -> int:
    marker = read_expected_trial_marker()
    expected = active_expected_trial_iteration(marker)
    if expected <= 0:
        return 0
    trial_dir = active_trial_dir_for_iteration(expected)
    if trial_dir is None or not trial_dir_satisfies_current_boundary(trial_dir):
        return expected
    return 0


def write_trial_checkpoint(trial: dict[str, Any]) -> dict[str, Any]:
    trial_id = str(trial.get("id") or "").strip()
    if not trial_id or not trial.get("report_path"):
        return {"created": False, "path": "", "files": []}
    checkpoint_root = trial_checkpoint_dir(trial_id)
    checkpoint_root.mkdir(parents=True, exist_ok=True)
    files = copy_resume_snapshot(checkpoint_root)
    manifest = checkpoint_root / "MANIFEST.md"
    manifest.write_text(
        "\n".join(
            [
                f"# Checkpoint for {trial_id}",
                "",
                f"Created: {now_iso()}",
                f"Trial path: `{trial.get('path', '')}`",
                f"Report path: `{trial.get('report_path', '')}`",
                "",
                "Snapshot files:",
                *[f"- `{path}`" for path in files],
                "",
            ]
        ),
        encoding="utf-8",
    )
    return {"created": True, "path": rel_path(checkpoint_root), "files": files}


def maybe_checkpoint_latest_trial() -> dict[str, Any]:
    trials = active_reported_trials()
    if not trials:
        return {"created": False, "path": "", "files": []}
    with RESEARCH_LOCK:
        iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
    trial = next((item for item in trials if int(item.get("iteration") or 0) == iteration), trials[-1])
    return write_trial_checkpoint(trial)


def collect_trials() -> list[dict[str, Any]]:
    direct_root = REPO_ROOT / "research_trajectory" / "trials"
    trajectory = read_trajectory_state()
    state_text = safe_read(RESEARCH_STATE_PATH) if RESEARCH_STATE_PATH.exists() else ""
    archived_ids = set(trajectory.get("archived_trial_ids") or [])
    trial_roots = []
    if direct_root.is_dir():
        trial_roots.append(direct_root)
    trial_roots.extend(path for path in sorted(REPO_ROOT.glob("research_trajectory/*/trials")) if path.is_dir() and path != direct_root)
    trials: list[dict[str, Any]] = []
    for root in trial_roots:
        if not root.is_dir():
            continue
        epoch = "current" if root == direct_root else root.parent.name
        for trial_dir in sorted([p for p in root.iterdir() if p.is_dir()]):
            if not any((trial_dir / name).exists() for name in ("PLAN.md", "PLAN_REVIEW.md", "REPORT.md", "artifacts")):
                continue
            iteration = trial_iteration_from_id(trial_dir.name)
            is_active = epoch == "current" and trial_dir.name not in archived_ids
            plan = safe_read(trial_dir / "PLAN.md")
            review_path = trial_review_path(trial_dir)
            review = safe_read(review_path) if review_path else ""
            report = safe_read(trial_dir / "REPORT.md")
            is_closed = trial_dir_is_closed(trial_dir)
            objective = first_meaningful_line(extract_section(plan, "Objective"), "Objective not recorded")
            artifacts_dir = trial_dir / "artifacts"
            artifacts = []
            if artifacts_dir.exists():
                artifacts = [file_card(p) for p in artifacts_dir.rglob("*") if p.is_file() and p.name != ".gitkeep"]
            checkpoint_path = trial_checkpoint_dir(trial_dir.name)
            manuscript_snapshot_path = checkpoint_path / "manuscript" / "BLUEPRINT.md"
            manuscript_snapshot_exists = manuscript_snapshot_path.exists()
            progress = trial_progress_summary(trial_dir, plan, report, artifacts, state_text)
            trials.append(
                {
                    "id": trial_dir.name,
                    "iteration": iteration,
                    "epoch": epoch,
                    "fork_id": str(trajectory.get("fork_id") or "") if is_active else "",
                    "is_active": is_active,
                    "is_archived": not is_active,
                    "is_closed": is_closed,
                    "path": rel_path(trial_dir),
                    "objective": objective,
                    "status": infer_trial_status(plan, review, report),
                    "verdict": review_verdict(review),
                    "plan_path": rel_path(trial_dir / "PLAN.md") if (trial_dir / "PLAN.md").exists() else "",
                    "review_path": rel_path(review_path) if review_path else "",
                    "report_path": rel_path(trial_dir / "REPORT.md") if (trial_dir / "REPORT.md").exists() else "",
                    "report_summary": trial_report_summary(report),
                    "manuscript_implications": first_meaningful_line(extract_section(report, "Manuscript Implications"), "No manuscript implications recorded"),
                    "checkpoint_path": rel_path(checkpoint_path) if checkpoint_path.exists() else "",
                    "checkpoint_exists": checkpoint_path.exists(),
                    "manuscript_snapshot_path": rel_path(manuscript_snapshot_path) if manuscript_snapshot_exists else "",
                    "manuscript_snapshot_exists": manuscript_snapshot_exists,
                    "manuscript_snapshot_source": "checkpoint" if manuscript_snapshot_exists else "",
                    "artifacts": artifacts,
                    "progress": progress,
                }
            )
    return trials


def trial_sort_key(trial: dict[str, Any]) -> tuple[int, str]:
    trial_id = str(trial.get("id") or "")
    iteration = int(trial.get("iteration") or trial_iteration_from_id(trial_id) or 10**9)
    return (iteration, trial_id)


def active_reported_trials() -> list[dict[str, Any]]:
    return sorted(
        [
            trial
            for trial in collect_trials()
            if trial.get("is_active")
            and str(trial.get("path") or "").startswith("research_trajectory/trials/")
            and str(trial.get("report_path") or "").strip()
            and bool(trial.get("is_closed"))
            and not re.match(r"^0*_?project_conversion", str(trial.get("id") or ""), re.IGNORECASE)
        ],
        key=trial_sort_key,
    )


def resolve_resume_trial(payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], int]:
    requested_id = str(payload.get("id") or "").strip()
    requested_path = str(payload.get("path") or "").strip().replace("\\", "/")
    if not requested_id and not requested_path:
        raise ValueError("Choose a trial to continue from.")
    trials = active_reported_trials()
    for index, trial in enumerate(trials):
        if requested_id and str(trial.get("id") or "") == requested_id:
            return trial, trials, index
        if requested_path and str(trial.get("path") or "") == requested_path:
            return trial, trials, index
    raise ValueError("The selected trial is not an active completed trial.")


def unique_child_path(parent: Path, name: str) -> Path:
    candidate = parent / name
    if not candidate.exists() and not candidate.is_symlink():
        return candidate
    suffix = now_id()
    candidate = parent / f"{name}_{suffix}"
    counter = 2
    while candidate.exists() or candidate.is_symlink():
        candidate = parent / f"{name}_{suffix}_{counter}"
        counter += 1
    return candidate


def archive_later_trials(active_trials: list[dict[str, Any]], base_index: int, fork_root: Path) -> list[dict[str, str]]:
    target_root = fork_root / "superseded_trials"
    target_root.mkdir(parents=True, exist_ok=True)
    archived: list[dict[str, str]] = []
    base_trial = active_trials[base_index] if 0 <= base_index < len(active_trials) else {}
    base_iteration = int(base_trial.get("iteration") or trial_iteration_from_id(str(base_trial.get("id") or "")) or base_index + 1)
    candidates = [
        path
        for path in active_trial_dirs()
        if trial_iteration_from_id(path.name) > base_iteration
    ]
    for source_path in candidates:
        if not source_path.exists():
            continue
        destination = unique_child_path(target_root, source_path.name)
        shutil.move(str(source_path), str(destination))
        archived.append({"id": source_path.name, "from": rel_path(source_path), "to": rel_path(destination)})
    return archived


def resume_forks_root() -> Path:
    return REPO_ROOT / "archive" / "resume_forks"


def restarts_root() -> Path:
    return REPO_ROOT / "archive" / "restarts"


def interrupted_trials_root() -> Path:
    return REPO_ROOT / "archive" / "interrupted_trials"


def next_interrupted_trial_sequence(root: Path | None = None) -> int:
    root = root or interrupted_trials_root()
    highest = 0
    if root.exists():
        for path in root.iterdir():
            if not path.is_dir():
                continue
            match = re.match(r"T0*(\d+)_", path.name)
            if match:
                highest = max(highest, int(match.group(1)))
    return highest + 1


def archive_interrupted_trial_tail(reason: str) -> dict[str, Any]:
    tail = interrupted_tail_trial_dirs()
    if not tail:
        sync_trajectory_state(reason)
        return {"archived": [], "archive_root": "", "base_trial": "", "next_iteration": next_active_trial_iteration()}
    root = interrupted_trials_root()
    root.mkdir(parents=True, exist_ok=True)
    sequence = next_interrupted_trial_sequence(root)
    slug = slugify(reason, "interrupted")
    archive_root = root / f"T{sequence:04d}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}_{slug}"
    archive_root.mkdir(parents=True, exist_ok=False)
    archived: list[dict[str, str]] = []
    for source_path in tail:
        if not source_path.exists():
            continue
        destination = unique_child_path(archive_root, source_path.name)
        shutil.move(str(source_path), str(destination))
        archived.append({"id": source_path.name, "from": rel_path(source_path), "to": rel_path(destination)})
    state = sync_trajectory_state(reason)
    marker = read_expected_trial_marker()
    if marker and active_expected_trial_iteration(marker) > 0:
        expected = int(marker.get("expected_iteration") or 0)
        archived_iterations = [trial_iteration_from_id(item["id"]) for item in archived]
        if expected in archived_iterations:
            marker["status"] = "interrupted"
            marker["reason"] = reason
            marker["archived_trials"] = archived
            update_expected_trial_marker(marker)
    manifest = archive_root / "MANIFEST.md"
    manifest.write_text(
        "\n".join(
            [
                f"# Interrupted Trial Tail T{sequence:04d}",
                "",
                f"Created: {now_iso()}",
                f"Reason: `{reason}`",
                f"Base closed trial: `{state.get('latest_active_trial') or 'none'}`",
                f"Next trial number: `{state.get('next_trial_number')}`",
                "",
                "## Archived Trials",
                "",
                *[f"- `{item['from']}` -> `{item['to']}`" for item in archived],
                "",
                "These trials were not canonical resume boundaries because the active trial chain contained an unclosed trial.",
            ]
        ).rstrip()
        + "\n",
        encoding="utf-8",
    )
    with RESEARCH_LOCK:
        RESEARCH_SESSION["session_id"] = ""
        RESEARCH_SESSION["loop_iteration"] = latest_active_trial_iteration()
        RESEARCH_SESSION["loop_stop_reason"] = reason
    persist_research_session()
    return {
        "archived": archived,
        "archive_root": rel_path(archive_root),
        "base_trial": str(state.get("latest_active_trial") or ""),
        "next_iteration": int(state.get("next_trial_number") or next_active_trial_iteration()),
    }


def next_resume_fork_sequence(root: Path | None = None) -> int:
    root = root or resume_forks_root()
    highest = 0
    if root.exists():
        for path in root.iterdir():
            if not path.is_dir():
                continue
            match = re.match(r"F0*(\d+)_", path.name)
            if match:
                highest = max(highest, int(match.group(1)))
    return highest + 1


def next_restart_sequence(root: Path | None = None) -> int:
    root = root or restarts_root()
    highest = 0
    if root.exists():
        for path in root.iterdir():
            if not path.is_dir():
                continue
            match = re.match(r"R0*(\d+)_", path.name)
            if match:
                highest = max(highest, int(match.group(1)))
    return highest + 1


def compact_single_line(text: str, limit: int = 140) -> str:
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 1)].rstrip() + "…"


def create_resume_fork_root(trial: dict[str, Any]) -> tuple[int, str, Path]:
    root = resume_forks_root()
    root.mkdir(parents=True, exist_ok=True)
    sequence = next_resume_fork_sequence(root)
    base_slug = slugify(str(trial.get("id") or "trial"), "trial")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    base_id = f"F{sequence:04d}_{timestamp}_from_{base_slug}"
    fork_id = base_id
    fork_root = root / fork_id
    counter = 2
    while fork_root.exists() or fork_root.is_symlink():
        fork_id = f"{base_id}_{counter}"
        fork_root = root / fork_id
        counter += 1
    return sequence, fork_id, fork_root


def create_restart_root() -> tuple[int, str, Path]:
    root = restarts_root()
    root.mkdir(parents=True, exist_ok=True)
    sequence = next_restart_sequence(root)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    restart_id = f"R{sequence:04d}_{timestamp}"
    restart_root = root / restart_id
    counter = 2
    while restart_root.exists() or restart_root.is_symlink():
        restart_id = f"R{sequence:04d}_{timestamp}_{counter}"
        restart_root = root / restart_id
        counter += 1
    restart_root.mkdir(parents=True, exist_ok=False)
    return sequence, restart_id, restart_root


def move_path_to_archive(relative_path: str, destination_root: Path) -> list[dict[str, str]]:
    source = REPO_ROOT / relative_path
    if not source.exists():
        return []
    destination_root.mkdir(parents=True, exist_ok=True)
    moved: list[dict[str, str]] = []
    if source.is_dir():
        source.mkdir(parents=True, exist_ok=True)
        for child in sorted(source.iterdir()):
            if child.name == ".gitkeep":
                continue
            destination = unique_child_path(destination_root, child.name)
            shutil.move(str(child), str(destination))
            moved.append({"from": rel_path(child), "to": rel_path(destination)})
        source.mkdir(parents=True, exist_ok=True)
        gitkeep = source / ".gitkeep"
        if not any(source.iterdir()) and not gitkeep.exists():
            gitkeep.touch()
        return moved
    destination = unique_child_path(destination_root, source.name)
    shutil.move(str(source), str(destination))
    moved.append({"from": relative_path, "to": rel_path(destination)})
    return moved


def next_intervention_id() -> int:
    root = REPO_ROOT / "research_trajectory" / "human_interventions"
    highest = 0
    if root.exists():
        for path in root.glob("I*.md"):
            match = re.match(r"I0*(\d+)", path.name)
            if match:
                highest = max(highest, int(match.group(1)))
    return highest + 1


def human_intervention_root() -> Path:
    return REPO_ROOT / "research_trajectory" / "human_interventions"


def human_intervention_index_json_path() -> Path:
    return human_intervention_root() / "INDEX.json"


def queued_chat_messages_path() -> Path:
    return RUNTIME_DIR / "queued_chat_messages.json"


def resend_archive_root() -> Path:
    return RUNTIME_DIR / "chat_resend_archives"


def intervention_id_from_path(path: str) -> str:
    name = Path(str(path or "")).name
    match = re.match(r"(I0*\d+)", name)
    return match.group(1) if match else ""


def compact_intervention_summary(text: str, limit: int = 160) -> str:
    value = compact_single_line(text, limit)
    return value or "Attached resources were submitted with this intervention."


def normalize_intervention_index_entry(entry: Any) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None
    intervention_id = str(entry.get("id") or intervention_id_from_path(str(entry.get("path") or ""))).strip()
    path = str(entry.get("path") or "").strip()
    if not intervention_id or not path:
        return None
    status = str(entry.get("status") or "pending").strip().lower()
    if status not in {"pending", "applied", "superseded"}:
        status = "pending"
    return {
        "id": intervention_id,
        "path": path,
        "created_at": str(entry.get("created_at") or "").strip(),
        "source": str(entry.get("source") or "ui.chat").strip(),
        "status": status,
        "applied_in_trial": str(entry.get("applied_in_trial") or "").strip(),
        "applied_trial_path": str(entry.get("applied_trial_path") or "").strip(),
        "applied_at": str(entry.get("applied_at") or "").strip(),
        "superseded_by": str(entry.get("superseded_by") or "").strip(),
        "client_message_id": str(entry.get("client_message_id") or "").strip(),
        "summary": str(entry.get("summary") or "").strip(),
    }


def read_human_intervention_index() -> dict[str, Any]:
    path = human_intervention_index_json_path()
    payload: dict[str, Any] = {"schema_version": 1, "interventions": []}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                payload.update(loaded)
        except (OSError, json.JSONDecodeError):
            payload = {"schema_version": 1, "interventions": []}
    entries = payload.get("interventions")
    if not isinstance(entries, list):
        entries = []
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in entries:
        item = normalize_intervention_index_entry(entry)
        if not item or item["id"] in seen:
            continue
        seen.add(item["id"])
        normalized.append(item)
    payload["schema_version"] = 1
    payload["interventions"] = normalized
    return payload


def write_human_intervention_index(payload: dict[str, Any]) -> None:
    path = human_intervention_index_json_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "interventions": [
            item
            for item in (normalize_intervention_index_entry(entry) for entry in payload.get("interventions", []))
            if item is not None
        ],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def record_pending_human_intervention(
    intervention_id: str,
    path: str,
    summary: str,
    source: str = "ui.chat",
    created_at: str | None = None,
    client_message_id: str = "",
) -> dict[str, Any]:
    payload = read_human_intervention_index()
    entries = payload["interventions"]
    existing = next((item for item in entries if item.get("id") == intervention_id), None)
    if existing is None:
        existing = {
            "id": intervention_id,
            "path": path,
            "created_at": created_at or now_iso(),
            "source": source,
            "status": "pending",
            "applied_in_trial": "",
            "applied_trial_path": "",
            "applied_at": "",
            "superseded_by": "",
            "client_message_id": client_message_id,
            "summary": compact_intervention_summary(summary),
        }
        entries.append(existing)
    else:
        existing["path"] = path
        existing["source"] = existing.get("source") or source
        existing["client_message_id"] = existing.get("client_message_id") or client_message_id
        existing["summary"] = compact_intervention_summary(summary)
        if str(existing.get("status") or "").strip().lower() != "applied":
            existing["status"] = "pending"
    write_human_intervention_index(payload)
    return existing


def find_pending_intervention_by_client_message(client_message_id: str) -> dict[str, Any] | None:
    value = str(client_message_id or "").strip()
    if not value:
        return None
    for item in read_human_intervention_index().get("interventions", []):
        if (
            str(item.get("client_message_id") or "").strip() == value
            and str(item.get("status") or "").strip().lower() == "pending"
            and str(item.get("path") or "").strip()
        ):
            path = REPO_ROOT / str(item.get("path") or "")
            if path.exists():
                return item
    return None


def pending_human_interventions() -> list[dict[str, Any]]:
    payload = read_human_intervention_index()
    pending = [
        item
        for item in payload.get("interventions", [])
        if str(item.get("status") or "").strip().lower() == "pending"
        and str(item.get("path") or "").strip()
        and (REPO_ROOT / str(item.get("path") or "")).exists()
    ]
    return sorted(pending, key=lambda item: str(item.get("id") or ""))


def sync_expected_trial_pending_interventions(reason: str = "pending_interventions_updated") -> dict[str, Any]:
    pending = pending_human_interventions()
    marker = read_expected_trial_marker()
    expected = active_expected_trial_iteration(marker)
    if expected <= 0 and has_autoresearch_context():
        if not pending:
            return marker
        expected = next_active_trial_iteration()
        trajectory = read_trajectory_state()
        marker = write_expected_trial_marker(
            expected,
            reason,
            base_trial=str(trajectory.get("latest_active_trial") or trajectory.get("base_trial") or ""),
            fork_id=str(trajectory.get("fork_id") or ""),
            pending_interventions=pending,
        )
        return marker
    if expected <= 0:
        return marker
    marker["pending_intervention_ids"] = [
        str(item.get("id") or "") for item in pending if str(item.get("id") or "").strip()
    ]
    marker["pending_intervention_paths"] = [
        str(item.get("path") or "") for item in pending if str(item.get("path") or "").strip()
    ]
    marker["updated_at"] = now_iso()
    if reason:
        marker["last_pending_sync_reason"] = reason
    update_expected_trial_marker(marker)
    return marker


def mark_pending_interventions_applied(marker: dict[str, Any], trial_id: str, trial_path: str, reason: str = "") -> None:
    ids = [str(item or "").strip() for item in marker.get("pending_intervention_ids", []) if str(item or "").strip()]
    if not ids:
        return
    payload = read_human_intervention_index()
    changed = False
    for entry in payload.get("interventions", []):
        if str(entry.get("id") or "") not in ids:
            continue
        if str(entry.get("status") or "").strip().lower() != "pending":
            continue
        entry["status"] = "applied"
        entry["applied_in_trial"] = trial_id
        entry["applied_trial_path"] = trial_path
        entry["applied_at"] = now_iso()
        if reason:
            entry["applied_reason"] = reason
        changed = True
    if changed:
        write_human_intervention_index(payload)


def intervention_summary_from_file(path: Path) -> str:
    text = safe_read(path, 12_000)
    for heading in ("Current Effective Instruction", "User Instruction", "Expected Autoresearch Consequence"):
        section = extract_section(text, heading)
        if section:
            return compact_intervention_summary(first_meaningful_line(section, section))
    return compact_intervention_summary(first_meaningful_line(text, path.stem))


def sync_human_intervention_indexes(reason: str = "intervention_index_sync") -> dict[str, Any]:
    root = human_intervention_root()
    root.mkdir(parents=True, exist_ok=True)
    payload = read_human_intervention_index()
    entries = payload["interventions"]
    by_id = {str(item.get("id") or ""): item for item in entries}
    changed = False
    for path in sorted(root.glob("I*.md")):
        intervention_id = intervention_id_from_path(path.name)
        if not intervention_id:
            continue
        relative = rel_path(path)
        summary = intervention_summary_from_file(path)
        existing = by_id.get(intervention_id)
        if existing is None:
            existing = {
                "id": intervention_id,
                "path": relative,
                "created_at": datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat(timespec="seconds"),
                "source": "agent.chat",
                "status": "pending",
                "applied_in_trial": "",
                "applied_trial_path": "",
                "applied_at": "",
                "superseded_by": "",
                "client_message_id": "",
                "summary": summary,
            }
            entries.append(existing)
            by_id[intervention_id] = existing
            changed = True
            continue
        if existing.get("path") != relative:
            existing["path"] = relative
            changed = True
        status = str(existing.get("status") or "").strip().lower()
        if status not in {"applied", "superseded"}:
            if status != "pending":
                existing["status"] = "pending"
                changed = True
            if summary and existing.get("summary") != summary:
                existing["summary"] = summary
                changed = True
    if changed:
        write_human_intervention_index(payload)
    else:
        # Re-write through the normalizer so hand-edited JSON is kept canonical.
        write_human_intervention_index(payload)
    payload = read_human_intervention_index()
    index_path = root / "INDEX.md"
    lines = ["# Human Interventions", ""]
    for item in payload.get("interventions", []):
        status = str(item.get("status") or "pending").strip()
        summary = str(item.get("summary") or "").strip()
        suffix = f" — {summary}" if summary else ""
        lines.append(f"- `{item.get('id')}` `{status}`: `{item.get('path')}`{suffix}")
    index_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    sync_expected_trial_pending_interventions(reason)
    return payload


def pending_intervention_prompt_section() -> str:
    pending = pending_human_interventions()
    if not pending:
        return ""
    lines = [
        "",
        "Pending human interventions:",
        "",
        "Apply these before selecting or executing the next autoresearch objective. Read `instructions/INTERVENTION_PROTOCOL.md` and every pending intervention file listed here.",
        "",
    ]
    for item in pending:
        summary = str(item.get("summary") or "").strip()
        suffix = f" — {summary}" if summary else ""
        lines.append(f"- `{item.get('id')}` `{item.get('path')}`{suffix}")
    lines.extend(
        [
            "",
            "Trial reporting requirements for these interventions:",
            "- PLAN.md must include `## Human Interventions` stating how each pending intervention changes or constrains the trial.",
            "- REPORT.md must state which pending interventions were applied, deferred, or blocked, with reasons.",
            "- Do not mark an intervention as obsolete unless a newer explicit human intervention supersedes it.",
            "",
        ]
    )
    return "\n".join(lines)


def write_resume_intervention(
    fork_id: str,
    fork_sequence: int,
    trial: dict[str, Any],
    user_instruction: str,
    attachments: dict[str, Any],
    restore_mode: str,
    archived_trials: list[dict[str, str]],
) -> str:
    root = human_intervention_root()
    root.mkdir(parents=True, exist_ok=True)
    intervention_number = next_intervention_id()
    intervention_id = f"I{intervention_number:04d}"
    title_slug = slugify(f"resume_from_{trial.get('id', 'trial')}", "resume_from_trial")
    path = root / f"{intervention_id}_{title_slug}.md"
    uploaded = attachments.get("saved_files", []) if isinstance(attachments, dict) else []
    linked = attachments.get("resource_links", []) if isinstance(attachments, dict) else []
    clues = attachments.get("resource_clues", []) if isinstance(attachments, dict) else []
    lines = [
        f"# {intervention_id} Resume From Trial",
        "",
        f"Created: {now_iso()}",
        f"Fork number: `F{fork_sequence:04d}`",
        f"Fork id: `{fork_id}`",
        f"Base trial: `{trial.get('id', '')}`",
        f"Base trial path: `{trial.get('path', '')}`",
        f"Restore mode: `{restore_mode}`",
        "",
        "## User Instruction",
        "",
        user_instruction.strip() or "Continue from the selected trial boundary.",
        "",
        "## Attached Context",
        "",
    ]
    if not uploaded and not linked and not clues:
        lines.append("- No additional files or resources were attached with this continue request.")
    for item in uploaded:
        lines.append(f"- Uploaded file: `{item}`")
    for item in linked:
        if isinstance(item, dict):
            lines.append(f"- {item.get('mode', 'linked')} {item.get('category', 'resource')}: `{item.get('path', '')}`")
    for item in clues:
        if isinstance(item, dict):
            lines.append(f"- Resource clue: `{item.get('reference', '')}` ({item.get('status', '')})")
    lines.extend(
        [
            "",
            "## Effective Consequence",
            "",
            "- Treat the selected base trial as the active trajectory boundary.",
            "- Later active trials were superseded by this human fork request.",
            "- Start the next coherent autoresearch iteration from this boundary.",
            "",
            "## Superseded Trials",
            "",
        ]
    )
    if archived_trials:
        lines.extend(f"- `{item['from']}` -> `{item['to']}`" for item in archived_trials)
    else:
        lines.append("- No later active trials were present.")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    index_path = root / "INDEX.md"
    existing = safe_read(index_path) if index_path.exists() else "# Human Interventions\n"
    entry = f"- `{intervention_id}` Resume from `{trial.get('id', '')}`: `{rel_path(path)}`"
    if entry not in existing:
        index_path.write_text(existing.rstrip() + "\n" + entry + "\n", encoding="utf-8")
    record_pending_human_intervention(intervention_id, rel_path(path), user_instruction, source="ui.resume_from_trial")
    return rel_path(path)


def has_autoresearch_context() -> bool:
    with RESEARCH_LOCK:
        mode = str(RESEARCH_SESSION.get("mode") or "").strip().lower()
        loop_active = bool(RESEARCH_SESSION.get("loop_active"))
        loop_iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
        session_id = str(RESEARCH_SESSION.get("session_id") or "").strip()
    if loop_active or loop_iteration > 0 or mode in {"goal", "research", "command"}:
        return True
    if session_id and mode not in {"", "framing", "chat"}:
        return True
    trials_dir = REPO_ROOT / "research_trajectory" / "trials"
    if trials_dir.is_dir() and any(child.is_dir() for child in trials_dir.iterdir()):
        return True
    state_text = safe_read(RESEARCH_STATE_PATH) if RESEARCH_STATE_PATH.exists() else ""
    if "Autoresearch Goal Gate" in state_text:
        return True
    return False


def write_resume_fork_manifest(
    fork_root: Path,
    fork_id: str,
    fork_sequence: int,
    trial: dict[str, Any],
    restore_mode: str,
    backup_files: list[str],
    restored_files: list[str],
    archived_trials: list[dict[str, str]],
    intervention_path: str,
    user_instruction: str,
) -> str:
    fork_root.mkdir(parents=True, exist_ok=True)
    path = fork_root / "MANIFEST.md"
    lines = [
        f"# Resume Fork F{fork_sequence:04d}",
        "",
        f"Created: {now_iso()}",
        f"Fork id: `{fork_id}`",
        f"Fork number: `F{fork_sequence:04d}`",
        f"Base trial: `{trial.get('id', '')}`",
        f"Base trial path: `{trial.get('path', '')}`",
        f"Restore mode: `{restore_mode}`",
        f"Intervention: `{intervention_path}`",
        "",
        "## User Instruction",
        "",
        user_instruction.strip() or "Continue from the selected trial boundary.",
        "",
        "## Pre-Fork Backup",
        "",
        *[f"- `{path}`" for path in backup_files],
        "",
        "## Restored Files",
        "",
    ]
    if restored_files:
        lines.extend(f"- `{path}`" for path in restored_files)
    else:
        lines.append("- No checkpoint files were restored; this was a best-effort fork.")
    lines.extend(["", "## Archived Later Trials", ""])
    if archived_trials:
        lines.extend(f"- `{item['from']}` -> `{item['to']}`" for item in archived_trials)
    else:
        lines.append("- No later active trials were present.")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return rel_path(path)


def update_resume_forks_index(
    fork_id: str,
    fork_sequence: int,
    trial: dict[str, Any],
    restore_mode: str,
    fork_manifest: str,
    intervention_path: str,
    archived_trials: list[dict[str, str]],
    user_instruction: str,
) -> str:
    root = resume_forks_root()
    root.mkdir(parents=True, exist_ok=True)
    index_path = root / "RESUME_FORKS.md"
    existing = safe_read(index_path) if index_path.exists() else "# Resume Forks\n\nFork history for human-directed continue-from-trial branches.\n"
    instruction = compact_single_line(user_instruction, 180) or "Continue from the selected trial boundary."
    created_at = now_iso()
    entry = "\n".join(
        [
            "",
            f"## F{fork_sequence:04d} · {trial.get('id', '')}",
            "",
            f"- Created: {created_at}",
            f"- Fork id: `{fork_id}`",
            f"- Base trial: `{trial.get('id', '')}`",
            f"- Base trial path: `{trial.get('path', '')}`",
            f"- Restore mode: `{restore_mode}`",
            f"- Manifest: `{fork_manifest}`",
            f"- Intervention: `{intervention_path}`",
            f"- Archived later trials: {len(archived_trials)}",
            f"- User instruction: {instruction}",
        ]
    )
    if f"## F{fork_sequence:04d} ·" not in existing:
        index_path.write_text(existing.rstrip() + entry + "\n", encoding="utf-8")
    write_resume_fork_index_entry(
        {
            "fork_id": fork_id,
            "fork_number": f"F{fork_sequence:04d}",
            "created_at": created_at,
            "base_trial": str(trial.get("id") or ""),
            "base_trial_path": str(trial.get("path") or ""),
            "restore_mode": restore_mode,
            "manifest_path": fork_manifest,
            "intervention_id": intervention_id_from_path(intervention_path),
            "intervention_path": intervention_path,
            "archived_trials": archived_trials,
            "user_instruction_summary": instruction,
        }
    )
    return rel_path(index_path)


def resume_fork_index_json_path() -> Path:
    return resume_forks_root() / "INDEX.json"


def normalize_archived_trial_records(records: Any) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    if not isinstance(records, list):
        return normalized
    for record in records:
        if not isinstance(record, dict):
            continue
        source = str(record.get("from") or "").strip()
        destination = str(record.get("to") or "").strip()
        trial_id = str(record.get("id") or Path(source or destination).name).strip()
        if not trial_id and not source and not destination:
            continue
        normalized.append({"id": trial_id, "from": source, "to": destination})
    return normalized


def resume_fork_number_value(value: str) -> int:
    match = re.match(r"F0*(\d+)", str(value or "").strip(), re.IGNORECASE)
    return int(match.group(1)) if match else 0


def normalize_resume_fork_entry(entry: Any) -> dict[str, Any] | None:
    if not isinstance(entry, dict):
        return None
    fork_id = str(entry.get("fork_id") or "").strip()
    fork_number = str(entry.get("fork_number") or "").strip()
    if not fork_number and fork_id:
        match = re.match(r"(F0*\d+)", fork_id, re.IGNORECASE)
        if match:
            fork_number = match.group(1).upper()
    if not fork_id and fork_number:
        fork_id = fork_number
    if not fork_id:
        return None
    manifest_path = str(entry.get("manifest_path") or "").strip()
    intervention_path = str(entry.get("intervention_path") or "").strip()
    intervention_id = str(entry.get("intervention_id") or intervention_id_from_path(intervention_path)).strip()
    base_trial = str(entry.get("base_trial") or "").strip()
    return {
        "fork_id": fork_id,
        "fork_number": fork_number or fork_id,
        "created_at": str(entry.get("created_at") or "").strip(),
        "base_trial": base_trial,
        "base_trial_iteration": trial_iteration_from_id(base_trial),
        "base_trial_path": str(entry.get("base_trial_path") or "").strip(),
        "restore_mode": str(entry.get("restore_mode") or "").strip(),
        "manifest_path": manifest_path,
        "intervention_id": intervention_id,
        "intervention_path": intervention_path,
        "archived_trials": normalize_archived_trial_records(entry.get("archived_trials")),
        "user_instruction_summary": compact_single_line(str(entry.get("user_instruction_summary") or ""), 180),
    }


def archived_trials_from_manifest(text: str) -> list[dict[str, str]]:
    section = extract_section(text, "Archived Later Trials")
    records: list[dict[str, str]] = []
    for line in section.splitlines():
        match = re.match(r"\s*-\s+`?([^`\n]+?)`?\s*->\s*`?([^`\n]+?)`?\s*$", line.strip())
        if not match:
            continue
        source = match.group(1).strip()
        destination = match.group(2).strip()
        records.append({"id": Path(source).name, "from": source, "to": destination})
    return records


def resume_fork_entry_from_manifest(path: Path) -> dict[str, Any] | None:
    text = safe_read(path, 80_000)
    if not text.strip():
        return None
    fork_id = regex_first_value(text, [r"^-?\s*Fork id:\s*`?([^`\n]+)`?"])
    fork_number = regex_first_value(text, [r"^-?\s*Fork number:\s*`?([^`\n]+)`?"])
    base_trial = regex_first_value(text, [r"^-?\s*Base trial:\s*`?([^`\n]+)`?"])
    intervention_path = regex_first_value(text, [r"^-?\s*Intervention:\s*`?([^`\n]+)`?"])
    return normalize_resume_fork_entry(
        {
            "fork_id": fork_id or path.parent.name,
            "fork_number": fork_number,
            "created_at": regex_first_value(text, [r"^-?\s*Created:\s*`?([^`\n]+)`?"]),
            "base_trial": base_trial,
            "base_trial_path": regex_first_value(text, [r"^-?\s*Base trial path:\s*`?([^`\n]+)`?"]),
            "restore_mode": regex_first_value(text, [r"^-?\s*Restore mode:\s*`?([^`\n]+)`?"]),
            "manifest_path": rel_path(path),
            "intervention_id": intervention_id_from_path(intervention_path),
            "intervention_path": intervention_path,
            "archived_trials": archived_trials_from_manifest(text),
            "user_instruction_summary": first_meaningful_line(extract_section(text, "User Instruction"), ""),
        }
    )


def collect_resume_forks_from_manifests() -> list[dict[str, Any]]:
    root = resume_forks_root()
    if not root.is_dir():
        return []
    forks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for manifest in sorted(root.glob("F*/MANIFEST.md")):
        entry = resume_fork_entry_from_manifest(manifest)
        if not entry or entry["fork_id"] in seen:
            continue
        seen.add(entry["fork_id"])
        forks.append(entry)
    return sorted(forks, key=lambda item: (resume_fork_number_value(str(item.get("fork_number") or "")), str(item.get("fork_id") or "")))


def read_resume_fork_index() -> dict[str, Any]:
    path = resume_fork_index_json_path()
    payload: dict[str, Any] = {"schema_version": 1, "forks": []}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                payload.update(loaded)
        except (OSError, json.JSONDecodeError):
            payload = {"schema_version": 1, "forks": []}
    forks = [item for item in (normalize_resume_fork_entry(entry) for entry in payload.get("forks", [])) if item is not None]
    if not forks:
        forks = collect_resume_forks_from_manifests()
    payload["schema_version"] = 1
    payload["forks"] = sorted(forks, key=lambda item: (resume_fork_number_value(str(item.get("fork_number") or "")), str(item.get("fork_id") or "")))
    return payload


def write_resume_fork_index_entry(entry: dict[str, Any]) -> None:
    normalized = normalize_resume_fork_entry(entry)
    if normalized is None:
        return
    path = resume_fork_index_json_path()
    existing = read_resume_fork_index().get("forks", [])
    by_id = {str(item.get("fork_id") or ""): item for item in existing if str(item.get("fork_id") or "").strip()}
    by_id[normalized["fork_id"]] = normalized
    payload = {
        "schema_version": 1,
        "forks": sorted(by_id.values(), key=lambda item: (resume_fork_number_value(str(item.get("fork_number") or "")), str(item.get("fork_id") or ""))),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def collect_resume_forks() -> list[dict[str, Any]]:
    return list(read_resume_fork_index().get("forks", []))


def collect_trajectory_graph(trials: list[dict[str, Any]], trajectory: dict[str, Any]) -> dict[str, Any]:
    marker = read_expected_trial_marker()
    expected_iteration = active_expected_trial_iteration(marker) or int(trajectory.get("next_trial_number") or 0)
    base_trial = str(trajectory.get("base_trial") or "")
    latest_active = str(trajectory.get("latest_active_trial") or "")
    active_trials = sorted(
        [trial for trial in trials if trial.get("is_active") and str(trial.get("epoch") or "current") == "current"],
        key=trial_sort_key,
    )
    graph_trials: list[dict[str, Any]] = []
    active_iterations = set()
    for trial in active_trials:
        iteration = int(trial.get("iteration") or trial_iteration_from_id(str(trial.get("id") or "")) or 0)
        active_iterations.add(iteration)
        graph_trials.append(
            {
                "id": str(trial.get("id") or ""),
                "iteration": iteration,
                "title": str(trial.get("objective") or trial.get("id") or ""),
                "path": str(trial.get("path") or ""),
                "status": str(trial.get("status") or ""),
                "is_active_base": str(trial.get("id") or "") == base_trial,
                "is_latest_active": str(trial.get("id") or "") == latest_active,
                "is_next_expected": False,
                "is_closed": bool(trial.get("is_closed")),
            }
        )
    if expected_iteration > 0 and expected_iteration not in active_iterations:
        graph_trials.append(
            {
                "id": f"expected_trial_{expected_iteration}",
                "iteration": expected_iteration,
                "title": "Next trial",
                "path": "",
                "status": "pending",
                "is_active_base": False,
                "is_latest_active": False,
                "is_next_expected": True,
                "is_closed": False,
            }
        )
    interventions: list[dict[str, Any]] = []
    for entry in read_human_intervention_index().get("interventions", []):
        status = str(entry.get("status") or "pending").strip().lower()
        applied_trial = str(entry.get("applied_in_trial") or "").strip()
        target_iteration = trial_iteration_from_id(applied_trial) if status == "applied" else 0
        if status == "pending":
            target_iteration = expected_iteration
        interventions.append(
            {
                "id": str(entry.get("id") or ""),
                "path": str(entry.get("path") or ""),
                "created_at": str(entry.get("created_at") or ""),
                "source": str(entry.get("source") or ""),
                "status": status,
                "summary": str(entry.get("summary") or ""),
                "applied_in_trial": applied_trial,
                "applied_trial_path": str(entry.get("applied_trial_path") or ""),
                "superseded_by": str(entry.get("superseded_by") or ""),
                "target_iteration": target_iteration,
            }
        )
    forks = collect_resume_forks()
    return {
        "schema_version": 1,
        "active": {
            "fork_id": str(trajectory.get("fork_id") or ""),
            "base_trial": base_trial,
            "latest_active_trial": latest_active,
            "next_trial_number": int(trajectory.get("next_trial_number") or 0),
            "expected_trial_iteration": expected_iteration,
        },
        "trials": sorted(graph_trials, key=lambda item: (int(item.get("iteration") or 0), str(item.get("id") or ""))),
        "forks": forks,
        "interventions": interventions,
        "expected_trial": marker if isinstance(marker, dict) else {},
    }


def regex_first_value(text: str, patterns: list[str]) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            return match.group(1).strip().strip("`").strip()
    return ""


def review_source_trial(path: Path, text: str) -> str:
    parts = path.relative_to(REPO_ROOT).parts
    if "trials" in parts:
        index = parts.index("trials")
        if index + 1 < len(parts):
            return parts[index + 1]
    source = regex_first_value(text, [r"Source trial:\s*`?([^`\n]+)`?"])
    if source:
        source_parts = Path(source.strip().strip("/")).parts
        if "trials" in source_parts:
            index = source_parts.index("trials")
            if index + 1 < len(source_parts):
                return source_parts[index + 1]
        return source
    return ""


def review_reviewer(text: str, review_type: str) -> str:
    reviewer = regex_first_value(
        text,
        [
            r"Reviewer:\s*`?([^`\n]+)`?",
            r"Review type:\s*`?([^`\n]+)`?",
            r"Review:\s*`?([^`\n]+ reviewer)`?",
        ],
    )
    if reviewer:
        return reviewer
    if review_type == "manuscript_review":
        return "Manuscript reviewer"
    if review_type == "figure_table_review":
        return "Figure/table reviewer"
    if review_type == "process_review":
        return "Process reviewer"
    return "Trial reviewer"


def review_summary_line(text: str) -> str:
    def shorten(line: str, limit: int = 340) -> str:
        if len(line) <= limit:
            return line
        return line[: limit - 3].rsplit(" ", 1)[0].rstrip() + "..."

    def first_non_metadata_line(section: str) -> str:
        verdict_words = {
            "approve",
            "approved",
            "pass",
            "completed",
            "completed_with_follow_up",
            "continue_with_caution",
            "revise_before_execution",
            "reject_plan",
        }
        for raw_line in section.splitlines():
            line = raw_line.strip()
            if not line or line == "---" or line.startswith("#") or line.startswith("```"):
                continue
            line = re.sub(r"^[-*]\s+", "", line).strip()
            if re.match(r"^(Source trial|Reviewer|Decision|Status|Verdict):", line, re.IGNORECASE):
                continue
            if re.match(r"^Date:\s*", line, re.IGNORECASE):
                continue
            if line.lower() in {"comments:", "execution cautions:", "evidence status:", "overclaiming check:", "build check:", "remaining evidence risks:"}:
                continue
            if line.startswith("<") and line.endswith(">"):
                continue
            normalized = line.strip("`").strip().lower()
            if normalized in verdict_words:
                continue
            if line:
                return shorten(line)
        return ""

    for heading in (
        "Overall Judgment",
        "Post-Execution Evidence Review",
        "Pre-Execution Plan Review",
        "Review",
        "Summary",
        "Findings",
        "Recommended next gate-moving action",
    ):
        line = first_non_metadata_line(extract_section(text, heading))
        if line:
            return line
    return first_non_metadata_line(text) or "No summary"


def collect_reviews() -> list[dict[str, Any]]:
    review_paths: list[tuple[str, Path]] = []
    review_paths.extend(("trial_review", path) for path in REPO_ROOT.glob("research_trajectory/trials/*/reviews/*_REVIEW.md"))
    review_paths.extend(("trial_review", path) for path in REPO_ROOT.glob("research_trajectory/*/trials/*/reviews/*_REVIEW.md"))
    for legacy in REPO_ROOT.glob("research_trajectory/trials/*/REVIEW.md"):
        if not list((legacy.parent / "reviews").glob("*_REVIEW.md")):
            review_paths.append(("trial_review", legacy))
    for legacy in REPO_ROOT.glob("research_trajectory/trials/*/PLAN_REVIEW.md"):
        if not list((legacy.parent / "reviews").glob("*_REVIEW.md")):
            review_paths.append(("trial_review", legacy))
    for legacy in REPO_ROOT.glob("research_trajectory/*/trials/*/REVIEW.md"):
        if not list((legacy.parent / "reviews").glob("*_REVIEW.md")):
            review_paths.append(("trial_review", legacy))
    for legacy in REPO_ROOT.glob("research_trajectory/*/trials/*/PLAN_REVIEW.md"):
        if not list((legacy.parent / "reviews").glob("*_REVIEW.md")):
            review_paths.append(("trial_review", legacy))
    review_paths.extend(("process_review", path) for path in REPO_ROOT.glob("research_trajectory/*/process_reviews/*.md"))
    review_paths.extend(("manuscript_review", path) for path in REPO_ROOT.glob("manuscript/reviews/*.md"))
    review_paths.extend(("figure_table_review", path) for path in REPO_ROOT.glob("manuscript/figures/*REVIEW*.md"))
    reviews: list[dict[str, Any]] = []
    seen_review_paths: set[Path] = set()
    for review_type, path in sorted(review_paths, key=lambda item: item[1].as_posix()):
        if not path.exists() or path.name == ".gitkeep":
            continue
        resolved = path.resolve()
        if resolved in seen_review_paths:
            continue
        seen_review_paths.add(resolved)
        text = safe_read(path)
        source_trial = review_source_trial(path, text)
        reviewer = review_reviewer(text, review_type)
        decision = regex_first_value(
            text,
            [
                r"Decision:\s*`?([^`\n]+)`?",
                r"Verdict:\s*`?([^`\n]+)`?",
                r"Status:\s*`?([^`\n]+)`?",
            ],
        )
        verdict = review_verdict(text) or decision
        review_section_summary = review_summary_line(text)
        reviews.append(
            {
                "type": review_type,
                "name": path.name,
                "path": rel_path(path),
                "title": source_trial or path.stem,
                "source_trial": source_trial,
                "reviewer": reviewer,
                "decision": decision,
                "verdict": verdict,
                "summary": review_section_summary,
                "mtime": path.stat().st_mtime,
            }
        )
    return reviews


def collect_interventions() -> dict[str, Any]:
    pending_dir = REPO_ROOT / "research_trajectory/human_interventions/pending"
    formal_dir = REPO_ROOT / "research_trajectory/human_interventions"
    pending = []
    formal = []
    if pending_dir.exists():
        pending = [file_card(path) for path in sorted(pending_dir.glob("*.md")) if path.name != ".gitkeep"]
    if formal_dir.exists():
        formal = [
            {
                **file_card(path),
                "status": first_meaningful_line(extract_section(safe_read(path), "Status"), "unknown"),
                "type": first_meaningful_line(extract_section(safe_read(path), "Type"), "unknown"),
            }
            for path in sorted(formal_dir.glob("I[0-9]*.md"))
        ]
    index = read_text_file("research_trajectory/human_interventions/INDEX.md")
    return {"pending": pending, "formal": formal, "index": index}


def collect_resources() -> list[dict[str, Any]]:
    groups = []
    for label, relative in RESOURCE_GROUPS.items():
        groups.append({"label": label, "path": relative, "files": list_files(relative)})
    return groups


EXPORT_KIND_LABELS = {
    "blueprint": "Paper-Writing Pack",
    "final_project": "Clean Project Package",
}
EXPORT_EXCLUDED_NAMES = {
    ".DS_Store",
    ".env",
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "node_modules",
    "venv",
}
EXPORT_EXCLUDED_ROOTS = {
    ".git",
    "archive",
    "instructions",
    "research_trajectory",
    "secrets",
}
EXPORT_EXCLUDED_ROOT_FILES = {"AGENTS.md", "CLAUDE.md"}
BLUEPRINT_REFERENCE_ONLY_ROOTS = {"resources", "workspace", "data", "analysis", "outputs"}
BLUEPRINT_ARCHIVE_SUFFIXES = {
    ".7z",
    ".bz2",
    ".dmg",
    ".gz",
    ".rar",
    ".tar",
    ".tgz",
    ".xz",
    ".zip",
}


def normalize_export_kind(value: Any) -> str:
    kind = str(value or "").strip().lower().replace("-", "_")
    if kind not in EXPORT_KIND_LABELS:
        raise ValueError("Unknown export kind.")
    return kind


def export_runtime_dir() -> Path:
    path = RUNTIME_DIR / "exports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def valid_export_id(value: str) -> str:
    export_id = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", export_id):
        raise ValueError("Invalid export id.")
    return export_id


def export_project_label() -> str:
    context = current_project_context()
    summary = context.summary()
    return str(summary.get("display_name") or summary.get("name") or context.id or "project")


def export_filename(kind: str) -> str:
    stem = slugify(export_project_label(), "project")
    suffix = "paper-writing-pack" if kind == "blueprint" else "clean-project-package"
    return f"{stem}-{suffix}.zip"


def export_path_entry(path: Path, root: Path | None = None) -> str:
    try:
        return path.relative_to(root or REPO_ROOT).as_posix()
    except (OSError, ValueError):
        return path.as_posix()


def normalize_export_relative(value: str) -> str:
    text = str(value or "").replace("\\", "/").strip().strip("`\"'")
    text = re.sub(r"[#?:].*$", "", text)
    text = text.lstrip("/")
    parts = [part for part in Path(text).parts if part not in {"", "."}]
    if not parts or any(part == ".." for part in parts):
        return ""
    return Path(*parts).as_posix()


def export_skip_reason(relative_path: str, kind: str) -> str:
    normalized = normalize_export_relative(relative_path)
    if not normalized:
        return "invalid path"
    parts = Path(normalized).parts
    if not parts:
        return "invalid path"
    if parts[0] in EXPORT_EXCLUDED_ROOTS:
        return f"excluded root `{parts[0]}`"
    if len(parts) == 1 and parts[0] in EXPORT_EXCLUDED_ROOT_FILES:
        return "excluded project agent file"
    if kind == "final_project" and (normalized == "manuscript/reviews" or normalized.startswith("manuscript/reviews/")):
        return "excluded manuscript reviews"
    for part in parts:
        if part in EXPORT_EXCLUDED_NAMES:
            return f"excluded cache or environment path `{part}`"
    if normalized.startswith("ui/.runtime/") or normalized == "ui/.runtime":
        return "excluded UI runtime"
    return ""


def blueprint_asset_skip_reason(relative_path: str, source: Path) -> str:
    normalized = normalize_export_relative(relative_path)
    if not normalized:
        return "invalid path"
    parts = Path(normalized).parts
    if not parts:
        return "invalid path"
    if parts[0] in BLUEPRINT_REFERENCE_ONLY_ROOTS:
        return "reference-only source/workspace path; use Clean Project Package for raw resources and working outputs"
    if source.is_dir():
        return "referenced directory; Paper-Writing Pack includes explicit final files only"
    suffix = Path(normalized).suffix.lower()
    if suffix in BLUEPRINT_ARCHIVE_SUFFIXES:
        return "reference-only archive; raw source bundles are not included in Paper-Writing Pack"
    if normalized.startswith("research_trajectory/") and "/artifacts/" not in normalized:
        return "reference-only trajectory provenance; autoresearch trajectory is not included in Paper-Writing Pack"
    return ""


def export_entry_dict(
    bundle_path: str,
    source_path: Path | None = None,
    source_relative: str = "",
    content: str | bytes | None = None,
    reason: str = "",
    symlink_target: str = "",
) -> dict[str, Any]:
    size = 0
    if source_path is not None:
        try:
            size = source_path.stat().st_size
        except OSError:
            size = 0
    elif content is not None:
        size = len(content if isinstance(content, bytes) else str(content).encode("utf-8"))
    return {
        "bundle_path": normalize_export_relative(bundle_path),
        "source_path": source_path,
        "source_relative": source_relative,
        "content": content,
        "size": size,
        "reason": reason,
        "symlink_target": symlink_target,
        "missing": bool(reason),
    }


def unique_export_bundle_path(path: str, used: set[str]) -> str:
    normalized = normalize_export_relative(path) or "file"
    candidate = normalized
    stem = Path(normalized).with_suffix("").as_posix()
    suffix = Path(normalized).suffix
    counter = 2
    while candidate in used:
        candidate = f"{stem}_{counter}{suffix}"
        counter += 1
    used.add(candidate)
    return candidate


def add_generated_export_entry(entries: list[dict[str, Any]], used: set[str], bundle_path: str, content: str) -> None:
    entries.append(export_entry_dict(unique_export_bundle_path(bundle_path, used), content=content))


def add_file_export_entry(
    entries: list[dict[str, Any]],
    missing: list[dict[str, str]],
    skipped: list[dict[str, str]],
    used: set[str],
    source: Path,
    bundle_path: str,
    source_relative: str = "",
    kind: str = "final_project",
    visited_dirs: set[str] | None = None,
) -> None:
    source_relative = source_relative or export_path_entry(source)
    if source.is_symlink():
        target_text = os.readlink(source)
        target = source.resolve(strict=False)
        if not target.exists():
            missing.append({"path": source_relative, "target": target_text, "reason": "missing symlink target"})
            return
        if target.is_dir():
            add_directory_export_entries(entries, missing, skipped, used, target, bundle_path, source_relative, kind, visited_dirs, symlink_target=target_text)
            return
        if target.is_file():
            entries.append(export_entry_dict(unique_export_bundle_path(bundle_path, used), target, source_relative, symlink_target=target_text))
            return
        missing.append({"path": source_relative, "target": target_text, "reason": "unsupported symlink target"})
        return
    if not source.exists():
        missing.append({"path": source_relative, "target": "", "reason": "missing source"})
        return
    if source.is_dir():
        add_directory_export_entries(entries, missing, skipped, used, source, bundle_path, source_relative, kind, visited_dirs)
        return
    if source.is_file():
        entries.append(export_entry_dict(unique_export_bundle_path(bundle_path, used), source, source_relative))


def add_directory_export_entries(
    entries: list[dict[str, Any]],
    missing: list[dict[str, str]],
    skipped: list[dict[str, str]],
    used: set[str],
    source: Path,
    bundle_path: str,
    source_relative: str,
    kind: str,
    visited_dirs: set[str] | None = None,
    symlink_target: str = "",
) -> None:
    visited = visited_dirs if visited_dirs is not None else set()
    try:
        resolved = source.resolve()
    except OSError:
        missing.append({"path": source_relative, "target": symlink_target, "reason": "unreadable directory"})
        return
    resolved_key = resolved.as_posix()
    if resolved_key in visited:
        missing.append({"path": source_relative, "target": symlink_target or resolved_key, "reason": "symlink cycle"})
        return
    visited.add(resolved_key)
    try:
        children = sorted(source.iterdir(), key=lambda path: path.name.lower())
    except OSError:
        missing.append({"path": source_relative, "target": symlink_target, "reason": "unreadable directory"})
        return
    for child in children:
        child_relative = f"{source_relative.rstrip('/')}/{child.name}" if source_relative else child.name
        reason = export_skip_reason(child_relative, kind)
        if reason:
            skipped.append({"path": child_relative, "reason": reason})
            continue
        add_file_export_entry(
            entries,
            missing,
            skipped,
            used,
            child,
            f"{bundle_path.rstrip('/')}/{child.name}",
            child_relative,
            kind,
            visited,
        )
    visited.discard(resolved_key)


def export_readme(kind: str, estimate_only: bool = False) -> str:
    label = EXPORT_KIND_LABELS[kind]
    scope = (
        "This package is a clean manuscript handoff for human-machine paper writing. It includes the manuscript blueprint, final findings, venue notes, references, figure/table specs, and referenced final manuscript assets when available."
        if kind == "blueprint"
        else "This package is a clean project handoff with final-facing manuscript, workspace, and resource files. It intentionally excludes autoresearch trajectory, runtime, archive, caches, secrets, and agent scaffolding."
    )
    return "\n".join(
        [
            f"# {label}",
            "",
            f"Project: {export_project_label()}",
            f"Generated: {now_iso() if not estimate_only else '<generated at export time>'}",
            "",
            scope,
            "",
            "Included files are listed in `MANIFEST.json` with original project paths and SHA-256 hashes when available.",
            "",
        ]
    )


def export_method_runbook() -> str:
    return "\n".join(
        [
            "# Method Runbook",
            "",
            "This clean project package contains final project-facing files only.",
            "",
            "- `PROJECT.md`: final research direction.",
            "- `FINDINGS.md`: promoted current findings summary.",
            "- `manuscript/`: manuscript blueprint, figures, tables, sections, and appendix materials.",
            "- `workspace/`: executable method code, configs, notebooks, and final generated outputs.",
            "- `resources/`: raw inputs and project resources needed by the final workspace.",
            "",
            "Autoresearch trials, reviews, logs, checkpoints, runtime state, caches, secrets, and agent instructions are intentionally excluded.",
            "",
        ]
    )


def blueprint_reference_paths() -> list[str]:
    texts = [
        safe_read(REPO_ROOT / "manuscript" / "BLUEPRINT.md"),
        safe_read(REPO_ROOT / "manuscript" / "figures" / "FIGURE_SPECS.md"),
    ]
    matches: list[str] = []
    pattern = re.compile(r"\b(?:manuscript|research_trajectory|resources|workspace|data|analysis|figures|outputs)/[^\s`\"')\]}>,;]+")
    for text in texts:
        for match in pattern.findall(text):
            normalized = normalize_export_relative(match)
            if normalized and normalized not in matches:
                matches.append(normalized)
    return matches


def add_existing_relative(
    entries: list[dict[str, Any]],
    missing: list[dict[str, str]],
    skipped: list[dict[str, str]],
    used: set[str],
    relative: str,
    bundle_path: str,
    kind: str,
    allow_trajectory_asset: bool = False,
) -> None:
    normalized = normalize_export_relative(relative)
    if not normalized:
        return
    reason = export_skip_reason(normalized, kind)
    if reason and not (allow_trajectory_asset and normalized.startswith("research_trajectory/")):
        skipped.append({"path": normalized, "reason": reason})
        return
    source = REPO_ROOT / normalized
    if not source.exists() and not source.is_symlink():
        missing.append({"path": normalized, "target": "", "reason": "missing source"})
        return
    add_file_export_entry(entries, missing, skipped, used, source, bundle_path, normalized, kind)


def build_export_plan(kind: str) -> dict[str, Any]:
    kind = normalize_export_kind(kind)
    cleanup_old_exports()
    entries: list[dict[str, Any]] = []
    missing: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    used: set[str] = set()
    add_generated_export_entry(entries, used, "README.md", export_readme(kind, estimate_only=True))
    add_existing_relative(entries, missing, skipped, used, "PROJECT.md", "PROJECT.md", kind)
    add_existing_relative(entries, missing, skipped, used, "research_trajectory/CURRENT_FINDINGS.md", "FINDINGS.md", kind, allow_trajectory_asset=True)
    if kind == "blueprint":
        add_existing_relative(entries, missing, skipped, used, "manuscript/BLUEPRINT.md", "BLUEPRINT.md", kind)
        add_existing_relative(entries, missing, skipped, used, "manuscript/figures/FIGURE_SPECS.md", "FIGURE_SPECS.md", kind)
        for relative in [
            "resources/target_venue/TARGET_VENUE.md",
            "resources/target_venue/STYLE_NOTES.md",
            "resources/target_venue/FIGURE_TABLE_NOTES.md",
            "resources/target_venue/SEED_PAPERS.md",
        ]:
            add_existing_relative(entries, missing, skipped, used, relative, Path(relative).name, kind)
        for relative in blueprint_reference_paths():
            if relative in {"manuscript/BLUEPRINT.md", "manuscript/figures/FIGURE_SPECS.md"}:
                continue
            source = REPO_ROOT / relative
            reason = blueprint_asset_skip_reason(relative, source)
            if reason:
                skipped.append({"path": relative, "reason": reason})
                continue
            if source.exists() or source.is_symlink():
                bundle_path = f"assets/{Path(relative).name or 'asset'}"
                add_file_export_entry(entries, missing, skipped, used, source, bundle_path, relative, kind)
    else:
        add_existing_relative(entries, missing, skipped, used, "manuscript", "manuscript", kind)
        add_existing_relative(entries, missing, skipped, used, "workspace", "workspace", kind)
        add_existing_relative(entries, missing, skipped, used, "resources", "resources", kind)
        add_generated_export_entry(entries, used, "METHOD_RUNBOOK.md", export_method_runbook())
    add_generated_export_entry(entries, used, "MANIFEST.json", "{\n  \"schema_version\": 1\n}\n")

    for root in sorted(EXPORT_EXCLUDED_ROOTS):
        skipped.append({"path": root, "reason": "not part of final result export"})
    skipped.extend({"path": path, "reason": "secret/runtime/agent scaffolding excluded"} for path in sorted(EXPORT_EXCLUDED_ROOT_FILES))
    total_bytes = sum(int(entry.get("size") or 0) for entry in entries if not entry.get("missing"))
    files = [entry for entry in entries if not entry.get("missing")]
    large_files = [
        export_entry_public(entry)
        for entry in sorted(files, key=lambda item: int(item.get("size") or 0), reverse=True)
        if int(entry.get("size") or 0) >= EXPORT_CONFIRMATION_BYTES
    ]
    largest_files = [export_entry_public(entry) for entry in sorted(files, key=lambda item: int(item.get("size") or 0), reverse=True)[:20]]
    return {
        "kind": kind,
        "label": EXPORT_KIND_LABELS[kind],
        "filename": export_filename(kind),
        "entries": entries,
        "total_bytes": total_bytes,
        "file_count": len(files),
        "largest_files": largest_files,
        "large_files": large_files,
        "skipped": skipped,
        "missing_externals": missing,
        "requires_confirmation": total_bytes >= EXPORT_CONFIRMATION_BYTES or bool(large_files),
        "confirmation_threshold_bytes": EXPORT_CONFIRMATION_BYTES,
    }


def export_entry_public(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "bundle_path": str(entry.get("bundle_path") or ""),
        "source_path": str(entry.get("source_relative") or ""),
        "size": int(entry.get("size") or 0),
        "missing": bool(entry.get("missing")),
        "reason": str(entry.get("reason") or ""),
        "symlink_target": str(entry.get("symlink_target") or ""),
    }


def export_estimate(kind: str) -> dict[str, Any]:
    plan = build_export_plan(kind)
    public = {key: value for key, value in plan.items() if key != "entries"}
    public["ok"] = True
    return public


class ExportCancelled(Exception):
    pass


def export_terminal_status(status: str) -> bool:
    return status in {"ready", "failed", "cancelled"}


def cleanup_old_exports() -> None:
    cutoff = time.time() - EXPORT_JOB_TTL_SECONDS
    stale_ids: list[str] = []
    active_dirs: set[Path] = set()
    current_project_id = current_project_context().id
    with EXPORT_LOCK:
        for export_id, job in list(EXPORT_JOBS.items()):
            work_dir = Path(str(job.get("work_dir") or "")) if job.get("work_dir") else None
            if work_dir:
                active_dirs.add(work_dir)
            updated = float(job.get("updated_at_epoch") or job.get("created_at_epoch") or 0)
            if job.get("project_id") == current_project_id and export_terminal_status(str(job.get("status") or "")) and updated < cutoff:
                stale_ids.append(export_id)
        for export_id in stale_ids:
            job = EXPORT_JOBS.pop(export_id, None)
            if job and job.get("work_dir"):
                active_dirs.discard(Path(str(job.get("work_dir"))))
    root = export_runtime_dir()
    try:
        children = list(root.iterdir())
    except OSError:
        return
    for child in children:
        if not child.is_dir() or child in active_dirs:
            continue
        try:
            if child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue


def export_public_estimate_from_plan(plan: dict[str, Any]) -> dict[str, Any]:
    public = {key: value for key, value in plan.items() if key != "entries"}
    public["ok"] = True
    return public


def export_zip_path(export_id: str, filename: str) -> str:
    return f"/api/export/download?id={quote(export_id)}&filename={quote(filename)}"


def export_job_public(job: dict[str, Any]) -> dict[str, Any]:
    export_id = str(job.get("id") or "")
    filename = str(job.get("filename") or "export.zip")
    status = str(job.get("status") or "packaging")
    public = {
        "id": export_id,
        "kind": str(job.get("kind") or ""),
        "label": str(job.get("label") or ""),
        "filename": filename,
        "status": status,
        "phase": str(job.get("phase") or status),
        "created_at": str(job.get("created_at") or ""),
        "updated_at": str(job.get("updated_at") or ""),
        "total_bytes": int(job.get("total_bytes") or 0),
        "bytes_done": int(job.get("bytes_done") or 0),
        "file_count": int(job.get("file_count") or 0),
        "files_done": int(job.get("files_done") or 0),
        "current_file": str(job.get("current_file") or ""),
        "error": str(job.get("error") or ""),
        "requires_confirmation": bool(job.get("requires_confirmation")),
        "cancel_requested": bool(job.get("cancel_requested")),
        "largest_files": job.get("largest_files") or [],
        "large_files": job.get("large_files") or [],
        "skipped": job.get("skipped") or [],
        "missing_externals": job.get("missing_externals") or [],
        "confirmation_threshold_bytes": int(job.get("confirmation_threshold_bytes") or EXPORT_CONFIRMATION_BYTES),
        "download_url": export_zip_path(export_id, filename) if status == "ready" else "",
    }
    return public


def export_job_for_current_project(export_id: str) -> dict[str, Any]:
    clean_id = valid_export_id(export_id)
    with EXPORT_LOCK:
        job = EXPORT_JOBS.get(clean_id)
        if not job or job.get("project_id") != current_project_context().id:
            raise ValueError("Export job not found.")
        return job


def update_export_job(export_id: str, **fields: Any) -> None:
    with EXPORT_LOCK:
        job = EXPORT_JOBS.get(export_id)
        if not job:
            return
        job.update(fields)
        job["updated_at_epoch"] = time.time()
        job["updated_at"] = now_iso()


def export_cancel_requested(export_id: str) -> bool:
    with EXPORT_LOCK:
        return bool(EXPORT_JOBS.get(export_id, {}).get("cancel_requested"))


def check_export_cancelled(export_id: str) -> None:
    if export_cancel_requested(export_id):
        raise ExportCancelled()


def export_entry_compression(entry: dict[str, Any]) -> int:
    size = int(entry.get("size") or 0)
    if size >= EXPORT_STORE_WITHOUT_COMPRESSION_BYTES:
        return zipfile.ZIP_STORED
    bundle_path = str(entry.get("bundle_path") or "")
    source = entry.get("source_path")
    suffix = Path(bundle_path).suffix.lower()
    if source is not None:
        try:
            suffix = Path(source).suffix.lower() or suffix
        except TypeError:
            pass
    if source is None or suffix in TEXT_PREVIEW_SUFFIXES:
        return zipfile.ZIP_DEFLATED
    return zipfile.ZIP_STORED


def export_zip_info(entry: dict[str, Any], compression: int) -> zipfile.ZipInfo:
    bundle_path = str(entry.get("bundle_path") or "file")
    info = zipfile.ZipInfo(bundle_path)
    source = entry.get("source_path")
    try:
        timestamp = datetime.fromtimestamp(Path(source).stat().st_mtime) if source is not None else datetime.now()
    except OSError:
        timestamp = datetime.now()
    info.date_time = timestamp.timetuple()[:6]
    info.compress_type = compression
    info.external_attr = 0o644 << 16
    return info


def write_export_entry_to_zip(archive: zipfile.ZipFile, entry: dict[str, Any], export_id: str) -> dict[str, Any]:
    bundle_path = str(entry.get("bundle_path") or "")
    update_export_job(export_id, current_file=bundle_path, phase="packaging")
    compression = export_entry_compression(entry)
    info = export_zip_info(entry, compression)
    digest = hashlib.sha256()
    bytes_written = 0
    content = entry.get("content")
    source_path = entry.get("source_path")
    with archive.open(info, "w", force_zip64=True) as destination:
        if source_path is None:
            data = content if isinstance(content, bytes) else str(content or "").encode("utf-8")
            for offset in range(0, len(data), EXPORT_CHUNK_BYTES):
                check_export_cancelled(export_id)
                chunk = data[offset:offset + EXPORT_CHUNK_BYTES]
                destination.write(chunk)
                digest.update(chunk)
                bytes_written += len(chunk)
                with EXPORT_LOCK:
                    job = EXPORT_JOBS.get(export_id)
                    if job:
                        job["bytes_done"] = int(job.get("bytes_done") or 0) + len(chunk)
                        job["updated_at_epoch"] = time.time()
                        job["updated_at"] = now_iso()
        else:
            with Path(source_path).open("rb") as source:
                while True:
                    check_export_cancelled(export_id)
                    chunk = source.read(EXPORT_CHUNK_BYTES)
                    if not chunk:
                        break
                    destination.write(chunk)
                    digest.update(chunk)
                    bytes_written += len(chunk)
                    with EXPORT_LOCK:
                        job = EXPORT_JOBS.get(export_id)
                        if job:
                            job["bytes_done"] = int(job.get("bytes_done") or 0) + len(chunk)
                            job["updated_at_epoch"] = time.time()
                            job["updated_at"] = now_iso()
    with EXPORT_LOCK:
        job = EXPORT_JOBS.get(export_id)
        if job:
            job["files_done"] = int(job.get("files_done") or 0) + 1
            job["updated_at_epoch"] = time.time()
            job["updated_at"] = now_iso()
    return {
        "bundle_path": bundle_path,
        "source_path": str(entry.get("source_relative") or ""),
        "size": bytes_written,
        "sha256": digest.hexdigest(),
        "symlink_target": str(entry.get("symlink_target") or ""),
    }


def build_export_manifest(job: dict[str, Any], manifest_entries: list[dict[str, Any]]) -> bytes:
    generated_at = now_iso()
    manifest_files = list(manifest_entries)
    manifest_self = {"bundle_path": "MANIFEST.json", "source_path": "", "size": 0, "sha256": "", "generated": True}
    manifest = {
        "schema_version": 1,
        "kind": str(job.get("kind") or ""),
        "label": str(job.get("label") or ""),
        "filename": str(job.get("filename") or ""),
        "project": current_project_context().summary(),
        "generated_at": generated_at,
        "total_source_bytes": int(job.get("total_bytes") or 0),
        "file_count": int(job.get("file_count") or 0),
        "files": manifest_files + [manifest_self],
        "skipped": job.get("skipped") or [],
        "missing_externals": job.get("missing_externals") or [],
    }
    data = json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=True).encode("utf-8") + b"\n"
    for _ in range(3):
        manifest_self["size"] = len(data)
        data = json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=True).encode("utf-8") + b"\n"
    return data


def write_export_manifest_to_zip(archive: zipfile.ZipFile, job: dict[str, Any], manifest_entries: list[dict[str, Any]], export_id: str) -> None:
    data = build_export_manifest(job, manifest_entries)
    digest = hashlib.sha256(data).hexdigest()
    info = zipfile.ZipInfo("MANIFEST.json")
    info.date_time = datetime.now().timetuple()[:6]
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    update_export_job(export_id, current_file="MANIFEST.json", phase="packaging")
    with archive.open(info, "w", force_zip64=True) as destination:
        for offset in range(0, len(data), EXPORT_CHUNK_BYTES):
            check_export_cancelled(export_id)
            chunk = data[offset:offset + EXPORT_CHUNK_BYTES]
            destination.write(chunk)
            with EXPORT_LOCK:
                job_state = EXPORT_JOBS.get(export_id)
                if job_state:
                    job_state["bytes_done"] = int(job_state.get("bytes_done") or 0) + len(chunk)
                    job_state["updated_at_epoch"] = time.time()
                    job_state["updated_at"] = now_iso()
    with EXPORT_LOCK:
        job_state = EXPORT_JOBS.get(export_id)
        if job_state:
            job_state["files_done"] = int(job_state.get("files_done") or 0) + 1
            job_state["manifest_sha256"] = digest
            job_state["updated_at_epoch"] = time.time()
            job_state["updated_at"] = now_iso()


def run_export_job(export_id: str) -> None:
    with EXPORT_LOCK:
        job = EXPORT_JOBS.get(export_id)
        if not job:
            return
        project_id = str(job.get("project_id") or "")
        entries = list(job.get("entries") or [])
        partial_path = Path(str(job.get("partial_path") or ""))
        final_path = Path(str(job.get("zip_path") or ""))
    with using_project(project_id):
        try:
            partial_path.parent.mkdir(parents=True, exist_ok=True)
            if partial_path.exists():
                partial_path.unlink()
            update_export_job(export_id, status="packaging", phase="packaging", current_file="")
            manifest_entries: list[dict[str, Any]] = []
            with zipfile.ZipFile(partial_path, "w", allowZip64=True, compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for entry in entries:
                    if str(entry.get("bundle_path") or "") == "MANIFEST.json":
                        continue
                    check_export_cancelled(export_id)
                    manifest_entries.append(write_export_entry_to_zip(archive, entry, export_id))
                with EXPORT_LOCK:
                    manifest_job = dict(EXPORT_JOBS.get(export_id) or {})
                write_export_manifest_to_zip(archive, manifest_job, manifest_entries, export_id)
            check_export_cancelled(export_id)
            os.replace(partial_path, final_path)
            with EXPORT_LOCK:
                job_state = EXPORT_JOBS.get(export_id)
                if job_state:
                    job_state["status"] = "ready"
                    job_state["phase"] = "ready"
                    job_state["current_file"] = ""
                    job_state["bytes_done"] = max(int(job_state.get("bytes_done") or 0), int(job_state.get("total_bytes") or 0))
                    job_state["files_done"] = max(int(job_state.get("files_done") or 0), int(job_state.get("file_count") or 0))
                    job_state["updated_at_epoch"] = time.time()
                    job_state["updated_at"] = now_iso()
        except ExportCancelled:
            try:
                if partial_path.exists():
                    partial_path.unlink()
            except OSError:
                pass
            update_export_job(export_id, status="cancelled", phase="cancelled", current_file="", error="")
        except Exception as exc:
            try:
                if partial_path.exists():
                    partial_path.unlink()
            except OSError:
                pass
            update_export_job(export_id, status="failed", phase="failed", current_file="", error=str(exc))


def prepare_export_plan_for_job(plan: dict[str, Any]) -> None:
    kind = str(plan.get("kind") or "")
    for entry in plan.get("entries") or []:
        if str(entry.get("bundle_path") or "") == "README.md":
            entry["content"] = export_readme(kind, estimate_only=False)
            entry["size"] = len(str(entry.get("content") or "").encode("utf-8"))


def start_export(payload: dict[str, Any]) -> dict[str, Any]:
    kind = normalize_export_kind(payload.get("kind"))
    confirmed = bool(payload.get("confirmed") or payload.get("confirmation") or payload.get("confirm"))
    plan = build_export_plan(kind)
    prepare_export_plan_for_job(plan)
    estimate = export_public_estimate_from_plan(plan)
    if plan.get("requires_confirmation") and not confirmed:
        raise ValueError("Export requires confirmation.")
    export_id = uuid.uuid4().hex
    work_dir = export_runtime_dir() / export_id
    filename = str(plan.get("filename") or export_filename(kind))
    created_at = now_iso()
    job = {
        "id": export_id,
        "project_id": current_project_context().id,
        "kind": kind,
        "label": str(plan.get("label") or EXPORT_KIND_LABELS[kind]),
        "filename": filename,
        "status": "packaging",
        "phase": "packaging",
        "created_at": created_at,
        "updated_at": created_at,
        "created_at_epoch": time.time(),
        "updated_at_epoch": time.time(),
        "total_bytes": int(plan.get("total_bytes") or 0),
        "bytes_done": 0,
        "file_count": int(plan.get("file_count") or 0),
        "files_done": 0,
        "current_file": "",
        "error": "",
        "requires_confirmation": bool(plan.get("requires_confirmation")),
        "confirmation_threshold_bytes": int(plan.get("confirmation_threshold_bytes") or EXPORT_CONFIRMATION_BYTES),
        "largest_files": plan.get("largest_files") or [],
        "large_files": plan.get("large_files") or [],
        "skipped": plan.get("skipped") or [],
        "missing_externals": plan.get("missing_externals") or [],
        "entries": plan.get("entries") or [],
        "estimate": estimate,
        "work_dir": str(work_dir),
        "partial_path": str(work_dir / "bundle.partial.zip"),
        "zip_path": str(work_dir / "bundle.zip"),
        "cancel_requested": False,
    }
    thread = threading.Thread(target=run_export_job, args=(export_id,), name=f"export-{export_id[:8]}", daemon=True)
    job["thread"] = thread
    with EXPORT_LOCK:
        EXPORT_JOBS[export_id] = job
    thread.start()
    with EXPORT_LOCK:
        return export_job_public(EXPORT_JOBS[export_id])


def export_status(export_id: str) -> dict[str, Any]:
    cleanup_old_exports()
    job = export_job_for_current_project(export_id)
    with EXPORT_LOCK:
        return export_job_public(job)


def cancel_export(payload: dict[str, Any]) -> dict[str, Any]:
    job = export_job_for_current_project(str(payload.get("id") or payload.get("export_id") or ""))
    with EXPORT_LOCK:
        job["cancel_requested"] = True
        if str(job.get("status") or "") == "packaging":
            job["phase"] = "cancelling"
        job["updated_at_epoch"] = time.time()
        job["updated_at"] = now_iso()
        return export_job_public(job)


def build_overview() -> dict[str, Any]:
    reconcile_research_process_state()
    if PROJECT_REGISTRY and PROJECT_REGISTRY.multi_project:
        PROJECT_REGISTRY.refresh()
    context = current_project_context()
    trajectory = sync_trajectory_state("overview")
    project = read_text_file("PROJECT.md")
    state = read_text_file("research_trajectory/STATE.md")
    blueprint = read_text_file("manuscript/BLUEPRINT.md")
    figure_specs = read_text_file("manuscript/figures/FIGURE_SPECS.md")
    initial_brief = read_text_file("resources/user_input/INITIAL_BRIEF.md")
    project_text = project.get("text", "")
    state_text = state.get("text", "")
    blueprint_text = blueprint.get("text", "")
    figure_text = figure_specs.get("text", "")
    project_overview = project_summary(project_text)
    manuscript_overview = manuscript_summary(blueprint_text, figure_text)
    blueprint_blockers = final_blueprint_consistency_blockers() if blueprint_text.strip() else []
    manuscript_overview["readiness"] = {
        "blueprint_blockers": blueprint_blockers[:12],
        "blueprint_blocker_count": len(blueprint_blockers),
    }
    trials = collect_trials()
    human_tasks = read_human_tasks()
    return {
        "active_project_id": context.id,
        "project": context.summary(),
        "projects": PROJECT_REGISTRY.summaries() if PROJECT_REGISTRY else [context.summary()],
        "multi_project": bool(PROJECT_REGISTRY and PROJECT_REGISTRY.multi_project),
        "repo_root": str(REPO_ROOT),
        "generated_at": now_iso(),
        "runtime": {
            "remote": UI_REMOTE_MODE,
        },
        "trajectory": trajectory,
        "files": {
            "project": project,
            "state": state,
            "blueprint": blueprint,
            "figure_specs": figure_specs,
            "initial_brief": initial_brief,
        },
        "cold_start_files": [cold_start_file_for_ui(path, project_text) for path in COLD_START_EDIT_FILES],
        "summaries": {
            "project": project_overview,
            "state": state_summary(state_text),
            "manuscript": manuscript_overview,
        },
        "inputs": {
            "target_venue": current_target_venue(project_text, blueprint_text, project_overview, manuscript_overview),
        },
        "trials": trials,
        "human_tasks": human_tasks,
        "trajectory_graph": collect_trajectory_graph(trials, trajectory),
        "reviews": collect_reviews(),
        "interventions": collect_interventions(),
        "resources": collect_resources(),
        "trees": {
            "workspace": directory_tree(".", max_depth=4, exclude_names={"node_modules", ".venv", "venv", "dist", "build", ".pytest_cache", ".mypy_cache", ".ruff_cache"}),
            "resources": directory_tree("resources"),
            "trials": directory_tree("research_trajectory"),
        },
        "git": git_summary(),
        "watch": watched_fingerprint(),
        "research_session": research_session_snapshot(),
        "framing": {
            "messages": load_framing_messages(),
            "project_ready": bool(project_text.strip()) and not project_has_placeholders(project_text),
        },
    }


def unique_path(directory: Path, filename: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    base = slugify(Path(filename).stem, "upload")
    suffix = Path(filename).suffix
    candidate = directory / f"{base}{suffix}"
    counter = 2
    while candidate.exists():
        candidate = directory / f"{base}_{counter}{suffix}"
        counter += 1
    return candidate


def safe_upload_relative_path(value: str, fallback: str) -> Path:
    raw_parts = Path(str(value or fallback).replace("\\", "/")).parts
    parts = [slugify(part, "item") for part in raw_parts if part not in {"", ".", "..", "/"}]
    if not parts:
        parts = [slugify(fallback, "upload")]
    return Path(*parts)


def unique_nested_path(directory: Path, relative: Path) -> Path:
    parts = list(relative.parts)
    filename = parts[-1] if parts else "upload"
    parent = directory.joinpath(*parts[:-1]) if len(parts) > 1 else directory
    return unique_path(parent, filename)


def save_uploads(payload: dict[str, Any]) -> list[str]:
    saved_files = []
    for upload in payload.get("files", []):
        category = upload.get("category")
        target = UPLOAD_TARGETS.get(str(category))
        if not target:
            continue
        filename = slugify(str(upload.get("name", "upload")), "upload")
        encoded = str(upload.get("contentBase64", ""))
        if not encoded:
            continue
        data = base64.b64decode(encoded)
        if len(data) > MAX_UPLOAD_BYTES:
            raise ValueError(f"Upload too large: {filename}")
        upload_relative = safe_upload_relative_path(str(upload.get("relativePath") or filename), filename)
        destination = unique_nested_path(REPO_ROOT / target, upload_relative)
        destination.write_bytes(data)
        saved_files.append(rel_path(destination))
    return saved_files


def resource_import_runtime_dir() -> Path:
    path = RUNTIME_DIR / "resource_imports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def valid_resource_import_id(value: str) -> str:
    import_id = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", import_id):
        raise ValueError("Invalid resource import id.")
    return import_id


def resource_import_manifest_path(import_id: str) -> Path:
    return resource_import_runtime_dir() / f"{valid_resource_import_id(import_id)}.json"


def read_resource_import_manifest(import_id: str) -> dict[str, Any]:
    path = resource_import_manifest_path(import_id)
    if not path.exists():
        raise ValueError("Unknown resource import.")
    return json.loads(path.read_text(encoding="utf-8"))


def write_resource_import_manifest(manifest: dict[str, Any]) -> None:
    import_id = valid_resource_import_id(str(manifest.get("import_id", "")))
    path = resource_import_manifest_path(import_id)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def validated_resource_destination(relative_path: str) -> Path:
    text = str(relative_path or "").replace("\\", "/").lstrip("/")
    if not text.startswith("resources/") or "/../" in f"/{text}/":
        raise ValueError("Imported resource path must be inside resources/.")
    root = (REPO_ROOT / "resources").resolve()
    path = (REPO_ROOT / text).absolute()
    try:
        path.relative_to((REPO_ROOT / "resources").absolute())
    except ValueError as exc:
        raise ValueError("Imported resource path escapes resources/.") from exc
    resolved_parent = path.parent.resolve()
    if resolved_parent != root and root not in resolved_parent.parents:
        raise ValueError("Imported resource path escapes resources/.")
    return path


def start_resource_import(payload: dict[str, Any]) -> dict[str, Any]:
    filename = str(payload.get("name") or "resource").strip()
    category = str(payload.get("category") or "").strip()
    target = UPLOAD_TARGETS.get(category)
    if not target:
        category = "ongoing_work"
        target = UPLOAD_TARGETS[category]
    try:
        size = int(payload.get("size") or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError("Resource import size must be a number.") from exc
    if size <= 0:
        raise ValueError("Resource import size must be greater than zero.")
    if "/" in filename or "\\" in filename:
        filename = Path(filename.replace("\\", "/")).name
    safe_name = slugify(filename or "resource", "resource")
    destination = unique_path(REPO_ROOT / target, safe_name)
    import_id = uuid.uuid4().hex
    staging = resource_import_runtime_dir() / f"{import_id}.part"
    manifest = {
        "import_id": import_id,
        "name": filename or safe_name,
        "safe_name": safe_name,
        "size": size,
        "category": category,
        "destination": rel_path(destination),
        "staging": str(staging),
        "received": 0,
        "status": "copying",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    staging.parent.mkdir(parents=True, exist_ok=True)
    staging.write_bytes(b"")
    write_resource_import_manifest(manifest)
    return {
        "import_id": import_id,
        "chunk_size": RESOURCE_IMPORT_CHUNK_BYTES,
        "destination": manifest["destination"],
        "category": category,
        "received": 0,
        "size": size,
    }


def write_resource_import_chunk(import_id: str, offset: int, data: bytes) -> dict[str, Any]:
    ensure_current_project_writeable()
    manifest = read_resource_import_manifest(import_id)
    if manifest.get("status") not in {"copying", "failed"}:
        raise ValueError("Resource import is not accepting chunks.")
    size = int(manifest.get("size") or 0)
    received = int(manifest.get("received") or 0)
    if offset != received:
        raise ValueError(f"Invalid resource import offset: expected {received}.")
    if not data:
        raise ValueError("Resource import chunk is empty.")
    if received + len(data) > size:
        raise ValueError("Resource import chunk exceeds declared size.")
    staging = Path(str(manifest.get("staging") or ""))
    if not staging.exists():
        raise ValueError("Resource import staging file is missing.")
    with staging.open("ab") as handle:
        handle.write(data)
    received += len(data)
    manifest["received"] = received
    manifest["status"] = "copying"
    manifest["updated_at"] = now_iso()
    write_resource_import_manifest(manifest)
    return {
        "import_id": manifest["import_id"],
        "received": received,
        "size": size,
        "progress": received / size if size else 0,
    }


def finish_resource_import(payload: dict[str, Any]) -> dict[str, Any]:
    manifest = read_resource_import_manifest(str(payload.get("import_id") or ""))
    size = int(manifest.get("size") or 0)
    received = int(manifest.get("received") or 0)
    staging = Path(str(manifest.get("staging") or ""))
    destination = validated_resource_destination(str(manifest.get("destination") or ""))
    if received != size:
        raise ValueError(f"Resource import is incomplete: {received} of {size} bytes received.")
    if not staging.exists() or staging.stat().st_size != size:
        raise ValueError("Resource import staging bytes do not match the declared size.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        destination = unique_path(destination.parent, destination.name)
    os.replace(staging, destination)
    manifest["destination"] = rel_path(destination)
    manifest["status"] = "done"
    manifest["updated_at"] = now_iso()
    write_resource_import_manifest(manifest)
    resource = {
        "path": manifest["destination"],
        "category": str(manifest.get("category") or "ongoing_work"),
        "alreadyImported": True,
        "name": str(manifest.get("name") or destination.name),
        "size": size,
    }
    return {
        "import_id": manifest["import_id"],
        "resource": resource,
        "path": resource["path"],
        "category": resource["category"],
    }


def cancel_resource_import(payload: dict[str, Any]) -> dict[str, Any]:
    import_id = valid_resource_import_id(str(payload.get("import_id") or ""))
    manifest_path = resource_import_manifest_path(import_id)
    staging: Path | None = None
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            staging_value = str(manifest.get("staging") or "")
            staging = Path(staging_value) if staging_value else None
        except (OSError, json.JSONDecodeError):
            staging = None
    if staging and staging.exists():
        staging.unlink()
    if manifest_path.exists():
        manifest_path.unlink()
    return {"import_id": import_id, "cancelled": True}


def already_imported_resource_record(item: dict[str, Any]) -> dict[str, str] | None:
    source_text = str(item.get("path", "")).strip()
    is_project_resource = source_text.replace("\\", "/").lstrip("/").startswith("resources/")
    if not (item.get("alreadyImported") or item.get("imported") or is_project_resource):
        return None
    if not source_text:
        raise ValueError("Imported resource path is required.")
    source = validated_resource_destination(source_text)
    if not source.exists() and not source.is_symlink():
        raise ValueError(f"Resource path does not exist: {source_text}")
    category = str(item.get("category", "")).strip() or infer_resource_category(source)
    if category not in UPLOAD_TARGETS:
        category = infer_resource_category(source)
    return {
        "mode": "imported" if (item.get("alreadyImported") or item.get("imported")) else "existing",
        "category": category,
        "source": rel_path(source),
        "path": rel_path(source),
        "provenance": "user_explicit",
        "auto_detected": "true" if item.get("autoDetected") else "false",
        "source_text": str(item.get("sourceText", "")).strip(),
        "resolution_status": str(item.get("resolutionStatus", "")).strip(),
    }


def unique_resource_destination(directory: Path, source: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    candidate = directory / slugify(source.name, "resource")
    counter = 2
    while candidate.exists() or candidate.is_symlink():
        candidate = directory / f"{slugify(source.stem or source.name, 'resource')}_{counter}{source.suffix if source.is_file() else ''}"
        counter += 1
    return candidate


def infer_resource_category(source: Path) -> str:
    text = source.as_posix().lower()
    suffix = source.suffix.lower()
    proposal_hints = ("proposal", "proposals", "grant", "nsf", "nih", "application", "aims")
    literature_hints = ("literature", "paper", "papers", "bibliography", "reference", "references", "arxiv", "review")
    data_hints = ("data", "dataset", "datasets", "csv", "parquet", "benchmark")
    literature_suffixes = {".pdf", ".bib", ".ris"}
    data_suffixes = {".csv", ".tsv", ".jsonl", ".xlsx", ".parquet"}
    if any(hint in text for hint in proposal_hints):
        return "proposals"
    if suffix in literature_suffixes or any(hint in text for hint in literature_hints):
        return "literature"
    if suffix in data_suffixes or any(hint in text for hint in data_hints):
        return "data_sources"
    return "ongoing_work"


def normalize_resource_reference(raw: str) -> str:
    value = str(raw or "").strip()
    value = value.strip("`\"'“”‘’()[]{}<>")
    value = re.sub(r"[\s,;。．.!?！？:：]+$", "", value)
    return value.strip()


def strip_local_path_wrappers(raw: str) -> str:
    value = str(raw or "").strip()
    pairs = {
        "`": "`",
        '"': '"',
        "'": "'",
        "“": "”",
        "‘": "’",
        "<": ">",
    }
    changed = True
    while changed and len(value) >= 2:
        changed = False
        first = value[0]
        last = value[-1]
        if pairs.get(first) == last:
            value = value[1:-1].strip()
            changed = True
    return value


def expand_windows_percent_vars(value: str, env: dict[str, str] | None = None) -> str:
    values = env or os.environ

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in values:
            return values[name]
        lower = name.lower()
        for key, candidate in values.items():
            if key.lower() == lower:
                return candidate
        return match.group(0)

    return re.sub(r"%([^%]+)%", replace, value)


def decode_file_url_path(value: str) -> str:
    if not re.match(r"^file:", value, re.IGNORECASE):
        return value
    parsed = urlparse(value)
    if parsed.scheme.lower() != "file":
        return value
    path_text = unquote(parsed.path or "")
    if parsed.netloc and parsed.netloc.lower() != "localhost":
        prefix = "\\\\" if os.name == "nt" else "//"
        return f"{prefix}{parsed.netloc}{path_text}"
    if re.match(r"^/[A-Za-z]:[\\/]", path_text):
        path_text = path_text[1:]
    return path_text


def normalize_windows_long_path_prefix(value: str) -> str:
    if re.match(r"^[\\/]{2}\?[\\/]UNC[\\/]", value):
        return ("\\\\" if os.name == "nt" else "//") + value[8:]
    if re.match(r"^[\\/]{2}\?[\\/][A-Za-z]:", value):
        return value[4:]
    return value


def clean_local_path_input(raw: str) -> str:
    value = strip_local_path_wrappers(raw)
    value = decode_file_url_path(value)
    value = normalize_windows_long_path_prefix(value)
    value = os.path.expanduser(os.path.expandvars(value))
    value = expand_windows_percent_vars(value)
    if os.name == "nt" and re.match(r"^[A-Za-z]:$", value):
        value = f"{value}/"
    return value


def local_path_from_user_input(raw: str) -> Path:
    return Path(clean_local_path_input(raw))


def basename_hint(raw: str) -> str:
    value = normalize_resource_reference(raw).replace("\\", "/").rstrip("/")
    if not value:
        return ""
    return value.rsplit("/", 1)[-1].strip()


def basename_search_hints(raw: str) -> list[str]:
    base = basename_hint(raw)
    hints: list[str] = []

    def add(value: str) -> None:
        value = normalize_resource_reference(value)
        if len(value) < 3:
            return
        lower = value.lower()
        if lower in {hint.lower() for hint in hints}:
            return
        hints.append(value)

    add(base)
    add(re.sub(r"\s+(repo|repository|folder|directory|project)$", "", base, flags=re.IGNORECASE))
    cjk_prefix = re.split(r"[\u3400-\u9fff]", base, 1)[0].strip()
    add(cjk_prefix)
    add(re.sub(r"\s+(repo|repository|folder|directory|project)$", "", cjk_prefix, flags=re.IGNORECASE))
    return hints


def candidate_paths_for_reference(raw: str) -> list[Path]:
    value = normalize_resource_reference(raw)
    if not value:
        return []
    expanded = os.path.expandvars(os.path.expanduser(value))
    candidates: list[Path] = []
    raw_path = Path(expanded)
    candidates.append(raw_path)
    if not raw_path.is_absolute():
        candidates.extend([
            REPO_ROOT / expanded,
            REPO_ROOT.parent / expanded,
            Path.home() / expanded,
        ])
    if re.match(r"^[A-Za-z]:[\\/]", expanded):
        # On non-Windows machines this cannot be opened directly, but the final
        # component is often enough to locate the copied/mounted repo.
        name = basename_hint(expanded)
        if name:
            candidates.extend([REPO_ROOT.parent / name, Path.home() / name])
    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def path_exists_resolved(path: Path) -> Path | None:
    try:
        resolved = path.expanduser().resolve()
    except OSError:
        try:
            resolved = path.expanduser().absolute()
        except OSError:
            return None
    try:
        if resolved.exists():
            return resolved
    except OSError:
        return None
    return None


def resource_search_roots() -> list[Path]:
    roots = [REPO_ROOT.parent, REPO_ROOT, Path.home()]
    if PROJECT_REGISTRY and PROJECT_REGISTRY.projects_dir:
        roots.insert(0, PROJECT_REGISTRY.projects_dir)
    if os.name == "nt":
        roots.extend(Path(f"{chr(code)}:/") for code in range(ord("A"), ord("Z") + 1))
    else:
        roots.extend([Path("/Volumes"), Path("/mnt")])
    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        resolved = path_exists_resolved(root)
        if not resolved or not resolved.is_dir():
            continue
        key = str(resolved).lower() if os.name == "nt" else str(resolved)
        if key in seen:
            continue
        seen.add(key)
        unique.append(resolved)
    return unique


def search_resource_by_name(name: str) -> list[Path]:
    target = basename_hint(name).lower()
    if len(target) < 3:
        return []
    results: list[tuple[int, str, Path]] = []
    visited_dirs = 0
    for root in resource_search_roots():
        stack: list[tuple[Path, int]] = [(root, 0)]
        while stack and len(results) < AUTO_RESOURCE_SEARCH_MAX_RESULTS and visited_dirs < AUTO_RESOURCE_SEARCH_MAX_DIRS:
            current, depth = stack.pop()
            visited_dirs += 1
            try:
                children = list(current.iterdir())
            except OSError:
                continue
            for child in children:
                child_name = child.name
                if child_name in AUTO_RESOURCE_SKIP_DIRS or child_name.startswith("."):
                    continue
                lower_name = child_name.lower()
                score: int | None = None
                if lower_name == target:
                    score = 0
                elif target in lower_name:
                    score = 3
                if score is not None:
                    results.append((score, str(child).lower(), child))
                    if len(results) >= AUTO_RESOURCE_SEARCH_MAX_RESULTS:
                        break
                if depth < AUTO_RESOURCE_SEARCH_MAX_DEPTH:
                    try:
                        if child.is_dir():
                            stack.append((child, depth + 1))
                    except OSError:
                        continue
    results.sort(key=lambda item: (item[0], len(str(item[2])), item[1]))
    unique: list[Path] = []
    seen: set[str] = set()
    for _, _, path in results:
        resolved = path_exists_resolved(path)
        if not resolved:
            continue
        key = str(resolved).lower() if os.name == "nt" else str(resolved)
        if key in seen:
            continue
        seen.add(key)
        unique.append(resolved)
    return unique


def extract_resource_references(text: str) -> list[str]:
    value = str(text or "")
    references: list[str] = []
    patterns = [
        r"`([^`\n]{3,260})`",
        r"\"([^\"\n]{3,260})\"",
        r"'([^'\n]{3,260})'",
        r"([A-Za-z]:[\\/][^\n\r,;，；`\"'“”‘’]+)",
        r"(~[\\/][^\n\r,;，；`\"'“”‘’]+)",
        r"((?:\.\.?)[\\/][^\n\r,;，；`\"'“”‘’]+)",
        r"(/[^\n\r,;，；`\"'“”‘’]+)",
        r"((?:[A-Za-z0-9_.-]+[\\/]){1,}[A-Za-z0-9_. -]+)",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, value):
            references.append(match.group(1))

    for match in re.finditer(r"\b([A-Za-z0-9][A-Za-z0-9_.-]{2,80})\s+(?:repo|repository|folder|directory|project)\b", value, re.IGNORECASE):
        references.append(match.group(1))
    for match in re.finditer(r"\b(?:repo|repository|folder|directory|project)\s+([A-Za-z0-9][A-Za-z0-9_.-]{2,80})\b", value, re.IGNORECASE):
        references.append(match.group(1))

    clean: list[str] = []
    seen: set[str] = set()
    for reference in references:
        normalized = normalize_resource_reference(reference)
        if not normalized:
            continue
        lower = normalized.lower()
        if lower in {"project.md", "state.md", "readme.md", "/goal", "/status", "/diff", "/stop", "/help"}:
            continue
        if lower in seen:
            continue
        seen.add(lower)
        clean.append(normalized)
    filtered: list[str] = []
    normalized_paths = [(item, item.replace("\\", "/").strip("/").lower()) for item in clean]
    for item, normalized_path in normalized_paths:
        if any(
            normalized_path != other_path and other_path.endswith(normalized_path)
            for _, other_path in normalized_paths
        ):
            continue
        filtered.append(item)
    return filtered[:20]


def payload_resource_texts(payload: dict[str, Any], *extra_texts: str) -> list[str]:
    texts = [str(text or "") for text in extra_texts]
    for key in ("brief", "message", "targetVenue", "ongoingWorkPath", "datasetModelHints"):
        value = str(payload.get(key, "")).strip()
        if value:
            texts.append(value)
    file_edits = payload.get("fileEdits", [])
    if isinstance(file_edits, list):
        for item in file_edits:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path", "")).strip()
            text = str(item.get("text", "")).strip()
            if text and path in {
                "resources/user_input/INITIAL_BRIEF.md",
                "resources/user_input/NOTES.md",
                "resources/target_venue/TARGET_VENUE.md",
            }:
                texts.append(text)
    return texts


def resolve_resource_reference(raw: str) -> dict[str, Any]:
    reference = normalize_resource_reference(raw)
    for candidate in candidate_paths_for_reference(reference):
        resolved = path_exists_resolved(candidate)
        if resolved:
            return {"reference": reference, "path": resolved, "status": "resolved", "candidates": []}

    last_matches: list[Path] = []
    for hint in basename_search_hints(reference):
        matches = search_resource_by_name(hint)
        last_matches = matches or last_matches
        if len(matches) == 1:
            return {"reference": reference, "path": matches[0], "status": "found_by_name", "candidates": []}
        if len(matches) > 1:
            exact = [match for match in matches if match.name.lower() == hint.lower()]
            if len(exact) == 1:
                return {"reference": reference, "path": exact[0], "status": "found_by_exact_name", "candidates": []}
            return {"reference": reference, "path": None, "status": "ambiguous", "candidates": matches[:AUTO_RESOURCE_SEARCH_MAX_RESULTS]}
    if last_matches:
        return {"reference": reference, "path": None, "status": "ambiguous", "candidates": last_matches[:AUTO_RESOURCE_SEARCH_MAX_RESULTS]}
    return {"reference": reference, "path": None, "status": "missing", "candidates": []}


def prepare_payload_resources(payload: dict[str, Any], texts: list[str]) -> dict[str, Any]:
    enriched = dict(payload)
    if enriched.get("_resourceResolutionPrepared"):
        return enriched
    resolutions: list[dict[str, Any]] = []

    for text in texts:
        for reference in extract_resource_references(text):
            resolution = resolve_resource_reference(reference)
            resolutions.append(resolution)

    enriched["_resourceResolutionPrepared"] = True
    if resolutions:
        enriched["_resourceResolution"] = [
            {
                "reference": item.get("reference", ""),
                "status": item.get("status", ""),
                "path": str(item["path"]) if isinstance(item.get("path"), Path) else "",
                "candidates": [str(candidate) for candidate in item.get("candidates", [])],
            }
            for item in resolutions
        ]
    return enriched


def save_resource_links(payload: dict[str, Any]) -> list[dict[str, str]]:
    saved: list[dict[str, str]] = []
    links = payload.get("resourceLinks", [])
    if not isinstance(links, list):
        return saved

    for item in links:
        if not isinstance(item, dict):
            continue
        if item.get("autoDetected"):
            continue
        source_text = str(item.get("path", "")).strip()
        if not source_text:
            continue
        imported_record = already_imported_resource_record(item)
        if imported_record:
            saved.append(imported_record)
            continue
        source = path_exists_resolved(local_path_from_user_input(source_text))
        if not source:
            raise ValueError(f"Resource path does not exist: {source_text}")
        category = str(item.get("category", "")).strip() or infer_resource_category(source)
        target = RESOURCE_LINK_TARGETS.get(category)
        if not target:
            category = infer_resource_category(source)
            target = RESOURCE_LINK_TARGETS[category]
        destination = unique_resource_destination(REPO_ROOT / target, source)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            mode = "symlink"
            try:
                os.symlink(source, destination, target_is_directory=True)
            except OSError:
                mode = "copy"
                if destination.exists() or destination.is_symlink():
                    raise
                shutil.copytree(source, destination)
        else:
            mode = "copy"
            shutil.copy2(source, destination)
        saved.append({
            "mode": mode,
            "category": category,
            "source": str(source),
            "path": rel_path(destination),
            "provenance": "user_explicit",
            "auto_detected": "true" if item.get("autoDetected") else "false",
            "source_text": str(item.get("sourceText", "")).strip(),
            "resolution_status": str(item.get("resolutionStatus", "")).strip(),
        })
    return saved


def local_browser_roots() -> list[dict[str, str]]:
    roots: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(label: str, path: Path) -> None:
        try:
            resolved = path.expanduser().resolve()
        except OSError:
            return
        if not resolved.exists():
            return
        key = str(resolved).lower() if os.name == "nt" else str(resolved)
        if key in seen:
            return
        seen.add(key)
        roots.append({"label": label, "path": str(resolved)})

    add("Home", Path.home())
    add("Project", REPO_ROOT)

    if os.name == "nt":
        for code in range(ord("A"), ord("Z") + 1):
            drive = Path(f"{chr(code)}:/")
            add(f"{chr(code)}:", drive)
    else:
        add("Root", Path("/"))
        add("Volumes", Path("/Volumes"))
        add("Mounts", Path("/mnt"))

    return roots


def local_browser_entry(path: Path) -> dict[str, Any] | None:
    try:
        is_dir = path.is_dir()
        stat = path.stat()
    except OSError:
        return None
    return {
        "name": path.name or str(path),
        "path": str(path),
        "type": "directory" if is_dir else "file",
        "is_dir": is_dir,
        "size": None if is_dir else stat.st_size,
        "mtime": stat.st_mtime,
        "is_symlink": path.is_symlink(),
    }


def browse_local_path(raw_path: str = "", search_query: str = "") -> dict[str, Any]:
    fallback = Path.home()
    if not fallback.exists():
        fallback = REPO_ROOT

    if raw_path:
        candidate = local_path_from_user_input(raw_path)
        if not candidate.is_absolute():
            candidate = fallback / candidate
    else:
        candidate = fallback

    try:
        current = candidate.resolve()
    except OSError:
        current = candidate.absolute()

    selected_path = ""
    selected_type = ""
    if current.is_file():
        selected_path = str(current)
        selected_type = "file"
        current = current.parent

    roots = local_browser_roots()
    if not current.exists() or not current.is_dir():
        return {
            "ok": False,
            "error": f"Path does not exist or cannot be opened: {raw_path or str(candidate)}",
            "path": str(fallback),
            "parent": str(fallback.parent) if fallback.parent != fallback else "",
            "roots": roots,
            "entries": [],
            "truncated": False,
            "selected_path": "",
            "selected_type": "",
        }

    try:
        children = list(current.iterdir())
    except OSError as exc:
        return {
            "ok": False,
            "error": str(exc),
            "path": str(current),
            "parent": str(current.parent) if current.parent != current else "",
            "roots": roots,
            "entries": [],
            "truncated": False,
            "selected_path": selected_path,
            "selected_type": selected_type,
        }

    query = search_query.strip().lower()
    visible_children = [child for child in children if not child.name.startswith(".")]
    entries = [entry for child in visible_children if (entry := local_browser_entry(child))]
    if query:
        entries = [
            entry
            for entry in entries
            if query in entry["name"].lower() or query in entry["path"].lower()
        ]
    entries.sort(key=lambda item: (-float(item.get("mtime") or 0), item["name"].lower()))
    return {
        "ok": True,
        "path": str(current),
        "parent": str(current.parent) if current.parent != current else "",
        "roots": roots,
        "entries": entries,
        "truncated": False,
        "query": search_query,
        "separator": os.sep,
        "selected_path": selected_path,
        "selected_type": selected_type,
    }


def write_ui_metadata(
    payload: dict[str, Any],
    saved_files: list[str] | None = None,
    linked_resources: list[dict[str, str]] | None = None,
) -> list[str]:
    written = []
    target_venue = str(payload.get("targetVenue", "")).strip()
    if target_venue:
        target_path = REPO_ROOT / "resources/target_venue/TARGET_VENUE.md"
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(f"# Target Venue / Audience\n\n{target_venue}\n", encoding="utf-8")
        written.append(rel_path(target_path))
    resource_lines = [
        "# Resource Manifest",
        "",
        "This is a raw intake record for user-provided and inferred resources.",
        "",
        "It is not current research truth until promoted into `PROJECT.md`, `research_trajectory/STATE.md`, `research_trajectory/CURRENT_FINDINGS.md`, or a trial report.",
        "",
        "Provenance values: `user_explicit`, `user_confirmed`, `autoresearch_discovered`, `autoresearch_generated`, `unknown`.",
        "",
    ]
    links = payload.get("resourceLinks", [])
    uploads = payload.get("files", [])
    saved_files = saved_files or []
    linked_resources = linked_resources or []

    resource_lines.extend(["## Explicit UI Resources", ""])
    explicit_count = 0
    if isinstance(links, list) and links:
        for item in links:
            if not isinstance(item, dict):
                continue
            if item.get("autoDetected"):
                continue
            path = str(item.get("path", "")).strip()
            if not path:
                continue
            category = str(item.get("category", "")).strip() or "unclassified"
            resource_lines.append(f"- `{category}` local selection: `{path}`")
            resource_lines.append("  - Provenance: `user_explicit`")
            explicit_count += 1
    if isinstance(uploads, list) and uploads:
        for item in uploads:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("relativePath") or "").strip()
            if not name:
                continue
            category = str(item.get("category", "")).strip() or "unclassified"
            resource_lines.append(f"- `{category}` upload: `{name}`")
            resource_lines.append("  - Provenance: `user_explicit`")
            explicit_count += 1
    if explicit_count == 0:
        resource_lines.append("- <none recorded>")
    resource_lines.append("")

    resolutions = payload.get("_resourceResolution", [])
    resource_lines.extend(["## Inferred Resource References", ""])
    inferred_count = 0
    if isinstance(resolutions, list) and resolutions:
        for item in resolutions:
            if not isinstance(item, dict):
                continue
            reference = str(item.get("reference", "")).strip()
            status = str(item.get("status", "")).strip() or "unknown"
            path = str(item.get("path", "")).strip()
            candidates = item.get("candidates", [])
            if path:
                resource_lines.append(f"- `{status}` clue: `{reference}`; candidate: `{path}`")
                resource_lines.append("  - Provenance: `unknown`")
                inferred_count += 1
                continue
            if isinstance(candidates, list) and candidates:
                limited = ", ".join(f"`{candidate}`" for candidate in candidates[:5])
                resource_lines.append(f"- `{status}` clue: `{reference}`; candidates: {limited}")
                resource_lines.append("  - Provenance: `unknown`")
                inferred_count += 1
            elif reference:
                resource_lines.append(f"- `{status}` clue: `{reference}`")
                resource_lines.append("  - Provenance: `unknown`")
                inferred_count += 1
    if inferred_count == 0:
        resource_lines.append("- <none recorded>")
    resource_lines.append("")

    resource_lines.extend(["## Attached Resources", ""])
    attached_count = 0
    for item in linked_resources:
        if not isinstance(item, dict):
            continue
        category = str(item.get("category", "")).strip() or "unclassified"
        mode = str(item.get("mode", "")).strip() or "linked"
        source = str(item.get("source", "")).strip()
        path = str(item.get("path", "")).strip()
        if path:
            resource_lines.append(f"- `{category}` {mode}: `{path}` from `{source}`")
            provenance = str(item.get("provenance") or "user_explicit").strip()
            if provenance not in RESOURCE_PROVENANCE_VALUES:
                provenance = "unknown"
            resource_lines.append(f"  - Provenance: `{provenance}`")
            attached_count += 1
    for path in saved_files:
        if path:
            resource_lines.append(f"- upload copied: `{path}`")
            resource_lines.append("  - Provenance: `user_explicit`")
            attached_count += 1
    if attached_count == 0:
        resource_lines.append("- <none recorded>")
    resource_lines.append("")

    resource_lines.extend(["## Unresolved Or Ambiguous Resources", ""])
    unresolved_count = 0
    if isinstance(resolutions, list):
        for item in resolutions:
            if not isinstance(item, dict):
                continue
            reference = str(item.get("reference", "")).strip()
            status = str(item.get("status", "")).strip()
            if reference and status in {"ambiguous", "missing"}:
                resource_lines.append(f"- `{status}`: `{reference}`")
                unresolved_count += 1
    if unresolved_count == 0:
        resource_lines.append("- <none recorded>")
    resource_lines.append("")

    resource_lines.extend(["## Intake Decisions", ""])
    if inferred_count:
        resource_lines.append("- Inferred text references are resource clues for agent resource intake; they were not attached automatically by the UI server.")
    if explicit_count:
        resource_lines.append("- Explicit UI resources were filed as raw inputs before research reasoning.")
    if not inferred_count and not explicit_count:
        resource_lines.append("- <none recorded>")

    if target_venue or explicit_count or inferred_count or attached_count or unresolved_count:
        manifest_path = REPO_ROOT / "resources/user_input/RESOURCE_MANIFEST.md"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text("\n".join(resource_lines).rstrip() + "\n", encoding="utf-8")
        written.append(rel_path(manifest_path))
    return written


def write_cold_start(payload: dict[str, Any]) -> dict[str, Any]:
    brief = str(payload.get("brief", "")).strip()
    target_venue = str(payload.get("targetVenue", "")).strip()
    research_type = str(payload.get("researchType", "")).strip()
    contribution = str(payload.get("contributionStyle", "")).strip()
    ongoing_path = str(payload.get("ongoingWorkPath", "")).strip()
    dataset_hints = str(payload.get("datasetModelHints", "")).strip()
    user_input_dir = REPO_ROOT / "resources/user_input"
    user_input_dir.mkdir(parents=True, exist_ok=True)
    initial_brief_path = user_input_dir / "INITIAL_BRIEF.md"
    body = f"""# Initial Brief

## One-Sentence Project Brief

{brief or "<Not provided.>"}

## Target Venue / Audience

{target_venue or "<Not provided.>"}

## Target Research Type

{research_type or "<Not provided.>"}

## Expected Contribution Style

{contribution or "<Not provided.>"}

## Old Repo / Ongoing Work Path

{ongoing_path or "<Not provided.>"}

## Dataset / Model Hints

{dataset_hints or "<Not provided.>"}

## Submitted From UI

{now_iso()}
"""
    initial_brief_path.write_text(body, encoding="utf-8")

    saved_files = save_uploads(payload)
    linked_resources = save_resource_links(payload)
    return {
        "initial_brief": rel_path(initial_brief_path),
        "saved_files": saved_files,
        "resource_links": linked_resources,
        "resource_clues": payload.get("_resourceResolution", []),
        "metadata_files": write_ui_metadata(payload, saved_files, linked_resources),
    }


def toml_string(value: str) -> str:
    return json.dumps(value)


def normalize_research_settings(raw: Any) -> dict[str, Any]:
    payload = raw if isinstance(raw, dict) else {}
    saved = load_ui_settings()
    requested_backend_raw = (
        payload.get("backend")
        or (payload.get("agent", {}) if isinstance(payload.get("agent"), dict) else {}).get("backend")
        or ""
    )
    requested_backend = normalize_agent_backend(requested_backend_raw) if requested_backend_raw else ""
    env_backend = valid_agent_backend_from_env()
    backend = normalize_agent_backend(env_backend or requested_backend or saved.get("agent", {}).get("backend"))
    if isinstance(payload.get(backend), dict):
        provider_payload = payload.get(backend)
    elif not requested_backend or requested_backend == backend:
        provider_payload = payload
    else:
        provider_payload = {}
    if backend == "claude":
        settings = normalize_claude_settings(provider_payload, saved.get("claude", {}))
    else:
        backend = "codex"
        settings = normalize_codex_settings(provider_payload, saved.get("codex", {}))
    settings["backend"] = backend
    return settings


def extra_config_args(extra_config: str) -> list[str]:
    args: list[str] = []
    for raw_line in extra_config.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"Invalid config override: {line}")
        key = line.split("=", 1)[0].strip()
        if not re.match(r"^[A-Za-z0-9_.-]+$", key):
            raise ValueError(f"Invalid config key: {key}")
        args.extend(["-c", line])
    return args


def settings_to_codex_args(settings: dict[str, Any], resume: bool) -> list[str]:
    args: list[str] = []
    raw_model = str(settings.get("model") or "").strip()
    model = normalize_codex_model(raw_model) if raw_model else ""
    if model:
        args.extend(["--model", model])

    sandbox = str(settings.get("sandbox") or "").strip()
    if sandbox:
        if resume:
            args.extend(["-c", f"sandbox_mode={toml_string(sandbox)}"])
        else:
            args.extend(["--sandbox", sandbox])

    approval = str(settings.get("approvalPolicy") or "").strip()
    if approval:
        args.extend(["-c", f"approval_policy={toml_string(approval)}"])

    reasoning = str(settings.get("reasoningEffort") or "").strip()
    if reasoning:
        args.extend(["-c", f"model_reasoning_effort={toml_string(reasoning)}"])

    if settings.get("webSearch"):
        args.extend(["-c", 'web_search="live"'])

    args.extend(extra_config_args(str(settings.get("extraConfig") or "")))
    return args


def codex_settings_for_figure_image(raw: Any = None) -> dict[str, Any]:
    payload = raw if isinstance(raw, dict) else {}
    saved = load_ui_settings()
    values: dict[str, Any] = {}
    if isinstance(payload.get("codex"), dict):
        values = payload["codex"]
    else:
        requested_backend = (
            payload.get("backend")
            or (payload.get("agent", {}) if isinstance(payload.get("agent"), dict) else {}).get("backend")
            or ""
        )
        if not requested_backend or normalize_agent_backend(requested_backend) == "codex":
            values = payload
    settings = normalize_codex_settings(values, saved.get("codex", {}))
    settings["backend"] = "codex"
    settings["sandbox"] = "read-only"
    settings["approvalPolicy"] = "never"
    settings["webSearch"] = False
    settings["extraConfig"] = ""
    settings["preExecScript"] = ""
    return settings


def figure_image_requested_backend(payload: dict[str, Any]) -> str:
    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    agent = settings.get("agent") if isinstance(settings.get("agent"), dict) else {}
    candidates = (payload.get("agentBackend"), payload.get("backend"), agent.get("backend"), settings.get("backend"))
    for value in candidates:
        text = str(value or "").strip().lower()
        if not text:
            continue
        return text if text in ALLOWED_AGENT_BACKENDS else ""
    return normalize_agent_backend(load_ui_settings().get("agent", {}).get("backend"))


def figure_image_codex_command(settings: dict[str, Any], env: dict[str, str]) -> list[str]:
    executable = resolve_agent_executable("codex", env)
    command = [
        executable,
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-c",
        'approval_policy="never"',
    ]
    model = normalize_codex_model(settings.get("model"), "")
    if model:
        command.extend(["--model", model])
    reasoning = normalize_reasoning_effort(settings.get("reasoningEffort"), "codex", model)
    if reasoning:
        command.extend(["-c", f"model_reasoning_effort={toml_string(reasoning)}"])
    command.extend(["--json", "-"])
    return command


def normalize_figure_source_path(value: Any) -> str:
    text = str(value or "").strip().strip("`").replace("\\", "/").lstrip("/")
    if not text or "*" in text or "/../" in f"/{text}/":
        return ""
    try:
        path = repo_path(text)
        root = REPO_ROOT.resolve()
        resolved = path.resolve()
        if resolved != root and root not in resolved.parents:
            return ""
        return rel_path(path)
    except (OSError, ValueError):
        return ""


def figure_image_output_path(title: str, source_path: Any = "") -> str:
    existing = normalize_figure_source_path(source_path)
    if existing and Path(existing).suffix.lower() in FIGURE_IMAGE_SUFFIXES:
        return existing
    slug = slugify(str(title or "figure").lower(), "figure")
    return f"manuscript/figures/generated/{slug}.png"


def figure_image_prompt(title: str, description: str, output_path: str) -> str:
    return f"""Use your built-in image generation tool only. Do not run shell commands, do not edit files, and do not call external APIs.

Create one manuscript figure image from the description below.

Intended CoAutoResearch output path:
{output_path}

CoAutoResearch will copy the generated image to that path after this Codex session. Generate the image only.

Figure title:
{title}

Figure description:
{description}
""".strip()


def codex_generated_image_dirs(env: dict[str, str], thread_id: str) -> list[Path]:
    candidates: list[Path] = []
    codex_home = str(env.get("CODEX_HOME") or "").strip()
    if codex_home:
        candidates.append(Path(os.path.expandvars(codex_home)).expanduser() / "generated_images" / thread_id)
    candidates.append(Path.home() / ".codex" / "generated_images" / thread_id)
    seen: set[str] = set()
    unique: list[Path] = []
    for path in candidates:
        key = str(path)
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def newest_generated_png(env: dict[str, str], thread_id: str) -> Path | None:
    for directory in codex_generated_image_dirs(env, thread_id):
        if not directory.is_dir():
            continue
        files = [path for path in directory.glob("*.png") if path.is_file()]
        if files:
            return max(files, key=lambda path: path.stat().st_mtime)
    return None


def markdown_line_is_field(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if re.match(r"^#{1,6}\s+", stripped):
        return True
    match = re.match(r"^([^:]{2,90}):\s*", stripped)
    if not match:
        return False
    label = match.group(1).strip()
    return bool(re.match(r"^[A-Z]", label)) and not re.search(r"[.;!?]", label)


def figure_preview_markdown_path(output_path: str) -> str:
    normalized = normalize_figure_source_path(output_path)
    if not normalized or Path(normalized).suffix.lower() not in FIGURE_IMAGE_SUFFIXES:
        return ""
    return os.path.relpath(normalized, "manuscript").replace("\\", "/")


def figure_preview_markdown(title: str, output_path: str) -> str:
    preview_path = figure_preview_markdown_path(output_path)
    if not preview_path:
        return ""
    alt = re.sub(r"[\[\]\n\r]", " ", str(title or "Figure image")).strip() or "Figure image"
    return f"Preview image:\n\n![{alt}]({preview_path})"


def replace_or_insert_preview_image(block: str, output_path: str, title: str = "Figure image") -> str:
    preview = figure_preview_markdown(title, output_path)
    if not preview:
        return block
    lines = block.splitlines()
    preview_lines = preview.splitlines()
    preview_re = re.compile(r"^\s*Preview image\s*:\s*.*$", re.IGNORECASE)
    source_re = re.compile(r"^\s*(Source artifact or spec path|Source artifact path):\s*.*$", re.IGNORECASE)
    for index, line in enumerate(lines):
        if not preview_re.match(line):
            continue
        end = index + 1
        while end < len(lines) and not markdown_line_is_field(lines[end]):
            end += 1
        return "\n".join([*lines[:index], *preview_lines, *lines[end:]]).strip()

    insert_at = len(lines)
    for index, line in enumerate(lines):
        if not source_re.match(line):
            continue
        insert_at = index + 1
        while insert_at < len(lines) and not markdown_line_is_field(lines[insert_at]):
            insert_at += 1
        break
    insert = [*preview_lines]
    if insert_at > 0 and lines[insert_at - 1].strip():
        insert.insert(0, "")
    if insert_at < len(lines) and lines[insert_at].strip():
        insert.append("")
    return "\n".join([*lines[:insert_at], *insert, *lines[insert_at:]]).strip()


def replace_or_insert_source_path(block: str, output_path: str, title: str = "Figure image") -> str:
    lines = block.splitlines()
    source_line = f"Source artifact or spec path: `{output_path}`"
    source_re = re.compile(r"^\s*(Source artifact or spec path|Source artifact path):\s*.*$", re.IGNORECASE)
    for index, line in enumerate(lines):
        if not source_re.match(line):
            continue
        end = index + 1
        while end < len(lines) and not markdown_line_is_field(lines[end]):
            end += 1
        updated = "\n".join([*lines[:index], source_line, *lines[end:]]).strip()
        return replace_or_insert_preview_image(updated, output_path, title)

    insert_at = len(lines)
    for index, line in enumerate(lines):
        if re.match(r"^\s*(Result shown or conceptual basis|Provenance links|Target-venue fit rationale|Remaining blocker):", line, re.IGNORECASE):
            insert_at = index
            break
    if insert_at == len(lines):
        for index, line in enumerate(lines):
            if not re.match(r"^\s*(Caption draft or current caption|Caption draft|Caption):", line, re.IGNORECASE):
                continue
            insert_at = index + 1
            while insert_at < len(lines) and not markdown_line_is_field(lines[insert_at]):
                insert_at += 1
            break
    insert = [source_line]
    if insert_at > 0 and lines[insert_at - 1].strip():
        insert.insert(0, "")
    if insert_at < len(lines) and lines[insert_at].strip():
        insert.append("")
    updated = "\n".join([*lines[:insert_at], *insert, *lines[insert_at:]]).strip()
    return replace_or_insert_preview_image(updated, output_path, title)


def update_blueprint_figure_source_path(title: str, output_path: str) -> bool:
    blueprint = REPO_ROOT / "manuscript" / "BLUEPRINT.md"
    if not blueprint.exists():
        raise ValueError("manuscript/BLUEPRINT.md is missing.")
    text = blueprint.read_text(encoding="utf-8", errors="replace")
    heading_re = re.compile(rf"^(?P<marks>#{{3,6}})\s+{re.escape(str(title).strip())}\s*$", re.MULTILINE)
    match = heading_re.search(text)
    if not match:
        raise ValueError(f"Could not find figure heading in BLUEPRINT.md: {title}")
    level = len(match.group("marks"))
    body_start = match.end()
    next_heading = re.search(rf"^#{{1,{level}}}\s+.+$", text[body_start:], re.MULTILINE)
    body_end = body_start + next_heading.start() if next_heading else len(text)
    body = text[body_start:body_end].strip()
    updated_body = replace_or_insert_source_path(body, output_path, title)
    updated_text = f"{text[:body_start]}\n\n{updated_body}\n\n{text[body_end:].lstrip()}"
    if updated_text != text:
        blueprint.write_text(updated_text, encoding="utf-8")
        return True
    return False


def figure_image_public_job(job: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(job, dict):
        return {}
    return {
        "id": str(job.get("id") or ""),
        "project_id": str(job.get("project_id") or ""),
        "status": str(job.get("status") or "pending"),
        "title": str(job.get("title") or ""),
        "output_path": str(job.get("output_path") or ""),
        "thread_id": str(job.get("thread_id") or ""),
        "source_generated_path": str(job.get("source_generated_path") or ""),
        "blueprint_updated": bool(job.get("blueprint_updated")),
        "error": str(job.get("error") or ""),
        "logs": list(job.get("logs") or [])[-40:],
        "created_at": str(job.get("created_at") or ""),
        "updated_at": str(job.get("updated_at") or ""),
        "finished_at": str(job.get("finished_at") or ""),
    }


def set_figure_image_job(job_id: str, **updates: Any) -> dict[str, Any]:
    with FIGURE_IMAGE_LOCK:
        job = FIGURE_IMAGE_JOBS.get(job_id)
        if not job:
            return {}
        job.update(updates)
        job["updated_at"] = now_iso()
        return dict(job)


def append_figure_image_log(job_id: str, line: str) -> None:
    text = str(line or "").rstrip("\n")
    if not text:
        return
    with FIGURE_IMAGE_LOCK:
        job = FIGURE_IMAGE_JOBS.get(job_id)
        if not job:
            return
        logs = list(job.get("logs") or [])
        logs.append(text[:1000])
        job["logs"] = logs[-120:]
        job["updated_at"] = now_iso()


def finish_figure_image_job(job_id: str, status: str, error: str = "", **updates: Any) -> dict[str, Any]:
    payload = {"status": status, "finished_at": now_iso(), "error": error, **updates}
    return set_figure_image_job(job_id, **payload)


def process_figure_image_job(job_id: str) -> None:
    with FIGURE_IMAGE_LOCK:
        job = dict(FIGURE_IMAGE_JOBS.get(job_id) or {})
    if not job:
        return
    env = agent_process_env("codex")
    command = list(job.get("command") or [])
    prompt = str(job.get("prompt") or "")
    thread_id = ""
    try:
        set_figure_image_job(job_id, status="running")
        proc = subprocess.Popen(
            command,
            cwd=REPO_ROOT,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=os.name != "nt",
        )
        assert proc.stdin is not None
        proc.stdin.write(prompt)
        proc.stdin.write("\n")
        proc.stdin.close()
        assert proc.stdout is not None
        for line in proc.stdout:
            append_figure_image_log(job_id, line)
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            candidate = str(event.get("thread_id") or event.get("threadId") or "").strip()
            if not candidate and isinstance(event.get("thread"), dict):
                candidate = str(event["thread"].get("id") or "").strip()
            if candidate and not thread_id:
                thread_id = candidate
                set_figure_image_job(job_id, thread_id=thread_id)
        returncode = proc.wait()
        if returncode != 0:
            finish_figure_image_job(job_id, "failed", f"codex exec exited with status {returncode}.")
            return
        if not thread_id:
            finish_figure_image_job(job_id, "failed", "codex exec did not report a thread id.")
            return
        generated = newest_generated_png(env, thread_id)
        if not generated:
            finish_figure_image_job(job_id, "failed", f"No generated PNG found for Codex thread {thread_id}.")
            return
        output_path = str(job.get("output_path") or "")
        destination = repo_path(output_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(generated, destination)
        with FIGURE_BLUEPRINT_LOCK:
            blueprint_updated = update_blueprint_figure_source_path(str(job.get("title") or ""), rel_path(destination))
            record_ui_file_edit("manuscript/BLUEPRINT.md")
            record_ui_file_edit(rel_path(destination))
        finish_figure_image_job(
            job_id,
            "succeeded",
            output_path=rel_path(destination),
            source_generated_path=str(generated),
            blueprint_updated=blueprint_updated,
        )
    except Exception as exc:
        finish_figure_image_job(job_id, "failed", str(exc))


def start_manuscript_figure_image(payload: dict[str, Any]) -> dict[str, Any]:
    if figure_image_requested_backend(payload) != "codex":
        raise ValueError("Figure image generation is only available when the active agent backend is Codex.")
    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "").strip()
    if not title:
        raise ValueError("Figure title is required.")
    if not description:
        raise ValueError("Figure description is required.")
    source_path = str(payload.get("sourcePath") or payload.get("source_path") or "").strip()
    output_path = figure_image_output_path(title, source_path)
    settings = codex_settings_for_figure_image(payload.get("settings"))
    env = agent_process_env("codex")
    ensure_agent_ready("codex", env=env, settings=settings)
    command = figure_image_codex_command(settings, env)
    prompt = figure_image_prompt(title, description, output_path)
    job_id = f"IMG{now_id()}_{uuid.uuid4().hex[:8]}"
    context = current_project_context()
    job = {
        "id": job_id,
        "project_id": context.id,
        "status": "pending",
        "title": title,
        "description": description,
        "source_path": source_path,
        "output_path": output_path,
        "settings": settings,
        "command": command,
        "prompt": prompt,
        "thread_id": "",
        "logs": [],
        "error": "",
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "finished_at": "",
    }
    with FIGURE_IMAGE_LOCK:
        FIGURE_IMAGE_JOBS[job_id] = job
    thread = threading.Thread(target=run_in_project, args=(context, process_figure_image_job, job_id), daemon=True)
    thread.start()
    return figure_image_public_job(job)


def manuscript_figure_image_status(job_id: str) -> dict[str, Any]:
    clean_id = str(job_id or "").strip()
    if not clean_id:
        raise ValueError("Figure image job id is required.")
    with FIGURE_IMAGE_LOCK:
        job = dict(FIGURE_IMAGE_JOBS.get(clean_id) or {})
    if not job or str(job.get("project_id") or "") != current_project_context().id:
        raise ValueError("Unknown figure image job.")
    return figure_image_public_job(job)


def settings_to_claude_args(settings: dict[str, Any], resume: bool) -> list[str]:
    args: list[str] = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
    raw_model = str(settings.get("model") or "").strip()
    model = normalize_claude_model(raw_model)
    if raw_model and model and model != "default":
        args.extend(["--model", model])
    reasoning = normalize_reasoning_effort(settings.get("reasoningEffort"), "claude", model)
    if reasoning:
        args.extend(["--effort", reasoning])
    preset = infer_claude_permission_preset(settings)
    permission_mode = CLAUDE_PERMISSION_PRESETS[preset]["permissionMode"]
    args.extend(["--permission-mode", permission_mode])
    if not settings.get("webSearch"):
        args.extend(["--disallowedTools", "WebSearch,WebFetch"])
    return args


def find_uuid(value: Any) -> str:
    pattern = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
    if isinstance(value, str):
        match = pattern.search(value)
        return match.group(0) if match else ""
    if isinstance(value, dict):
        for key in ("session_id", "conversation_id", "thread_id", "id"):
            found = find_uuid(value.get(key))
            if found:
                return found
        for item in value.values():
            found = find_uuid(item)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = find_uuid(item)
            if found:
                return found
    return ""


def find_session_identifier(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("session_id", "conversation_id", "thread_id"):
            candidate = str(value.get(key) or "").strip()
            if candidate:
                return candidate[:200]
        for item in value.values():
            found = find_session_identifier(item)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = find_session_identifier(item)
            if found:
                return found
    return find_uuid(value)


def compact_event_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("text", "message", "summary", "content", "output", "success"):
            text = compact_event_text(value.get(key))
            if text:
                return text
        parts = [compact_event_text(item) for item in value.values()]
        return " ".join(part for part in parts if part)[:600]
    if isinstance(value, list):
        parts = [compact_event_text(item) for item in value]
        return " ".join(part for part in parts if part)[:600]
    return ""


def format_codex_event(line: str) -> str:
    stripped = line.strip()
    if not stripped:
        return ""
    try:
        event = json.loads(stripped)
    except json.JSONDecodeError:
        return stripped
    event_type = str(event.get("method") or event.get("type") or event.get("event") or "event")
    item = codex_event_item(event)
    item_type = str(item.get("type") or item.get("kind") or item.get("role") or "").lower()
    type_text = f"{event_type.lower()} {item_type}".strip()
    if is_ignored_codex_lifecycle_event(event):
        return ""
    if "web_search" in type_text or "websearch" in type_text:
        query = codex_web_search_query(item) or codex_web_search_query(event)
        return f"Web search: {query[:860]}" if query else "Web search"
    text = compact_event_text(event)
    if text and text != event_type:
        return f"{event_type}: {text[:900]}"
    return event_type


def format_claude_event(line: str) -> str:
    stripped = line.strip()
    if not stripped:
        return ""
    try:
        event = json.loads(stripped)
    except json.JSONDecodeError:
        return stripped
    if not isinstance(event, dict):
        return stripped[:900]
    if is_ignored_claude_lifecycle_event(event):
        return ""
    event_type, _subtype, label, _label_lower = claude_event_label(event)
    event_family = event_type.split(".", 1)[0].lower()
    if event_family in {"assistant", "user"}:
        message = event.get("message") if isinstance(event.get("message"), dict) else event
        tool = next((block for block in claude_content_blocks(message) if str(block.get("type") or "") in {"tool_use", "tool_result"}), None)
        if tool:
            name = str(tool.get("name") or tool.get("tool_use_id") or "tool").strip()
            return f"{label}: {name}"
        text = claude_message_content_text(message, include_tools=False)
        if text:
            return f"{label}: {text[:900]}"
    if event_family == "result":
        text = claude_result_text(event)
        if text:
            return f"{label}: {text[:900]}"
    text = compact_event_text(event)
    if text and text != label:
        return f"{label}: {text[:900]}"
    return label


def format_agent_event(line: str, backend: str) -> str:
    return format_claude_event(line) if normalize_agent_backend(backend) == "claude" else format_codex_event(line)


def normalize_gate_status(value: str) -> str:
    text = value.strip().lower()
    if not text:
        return "missing"
    if re.search(r"\b(blocked|needs_human|human|clarification)\b", text):
        return "blocked"
    if re.match(r"^(all[_\s-]?passed)(?:\s*$|\s*[:.;,]\s*|\s+-\s+)", text):
        return "pass"
    if re.match(r"^(strict\s+)?pass(?:\s*$|\s*[:.;,]\s*|\s+-\s+)", text):
        pass_tail = re.sub(r"^(strict\s+)?pass(?:\s*$|\s*[:.;,]\s*|\s+-\s+)", "", text).replace("_", " ").replace("-", " ")
        if re.search(r"\b(not\s+pass|not\s+passed|not\s+ready|needs\s+work|needs\s+follow\s+up|follow\s+up|continue|running|revise|revision\s+required|targeted\s+revision|architecture\s+only|partial|qualified|qualification|supported\s+with\s+qualification|plausible|pass\s+for)\b", pass_tail):
            return "continue"
        return "pass"
    normalized = text.replace("_", " ").replace("-", " ")
    if re.search(r"\b(not\s+pass|not\s+passed|not\s+ready|needs\s+work|needs\s+follow\s+up|follow\s+up|continue|running|revise|revision\s+required|targeted\s+revision|architecture|partial|qualified|qualification|supported\s+with\s+qualification|plausible|approved|complete|completed|ready|pass\s+for)\b", normalized):
        return "continue"
    if re.search(r"\b(fail|failed)\b", text):
        return "continue"
    return text.split()[0]


REQUIRED_REVIEWER_GATES = {key: config["label"] for key, config in REQUIRED_REVIEWER_OUTPUTS.items()}


def reviewer_gate_key(label: str) -> str:
    return reviewer_key_for_label(label)


def parse_reviewer_gate_line(line: str) -> tuple[str, str, str]:
    match = re.match(r"^\s*[-*]\s*([^:]+?)\s*:\s*(.+?)\s*$", line)
    if not match:
        return "", "", ""
    key = reviewer_gate_key(match.group(1))
    if not key:
        return "", "", ""
    raw_status = match.group(2).strip()
    return key, normalize_gate_status(raw_status), raw_status


def markdown_section(text: str, heading: str) -> str:
    pattern = re.compile(rf"(^##\s+{re.escape(heading)}\s*$)(.*?)(?=^##\s+|\Z)", re.MULTILINE | re.DOTALL)
    match = pattern.search(text)
    return match.group(0).strip() if match else ""


def upsert_markdown_section(text: str, heading: str, section: str) -> str:
    pattern = re.compile(rf"(^##\s+{re.escape(heading)}\s*$)(.*?)(?=^##\s+|\Z)", re.MULTILINE | re.DOTALL)
    clean_section = section.strip() + "\n"
    if pattern.search(text):
        return pattern.sub(clean_section, text).rstrip() + "\n"
    insert_before = re.search(r"^##\s+Next Step\s*$", text, re.MULTILINE)
    if insert_before:
        return (text[: insert_before.start()].rstrip() + "\n\n" + clean_section + "\n" + text[insert_before.start():].lstrip()).rstrip() + "\n"
    return text.rstrip() + "\n\n" + clean_section


def section_body(section: str) -> str:
    lines = section.splitlines()
    if lines and lines[0].lstrip().startswith("## "):
        lines = lines[1:]
    return "\n".join(lines).strip()


def meaningful_section_lines(section: str) -> list[str]:
    lines: list[str] = []
    for raw_line in section_body(section).splitlines():
        line = raw_line.strip()
        if not line or line == "---" or line.startswith("#"):
            continue
        if re.fullmatch(r"[-*]\s*(none|n/a|not applicable)\.?", line, re.IGNORECASE):
            continue
        if re.fullmatch(r"(none|n/a|not applicable)\.?", line, re.IGNORECASE):
            continue
        lines.append(line)
    return lines


def section_has_unresolved_placeholder(section: str) -> bool:
    return bool(re.search(r"<[^>\n]+>", section))


def blueprint_section_blocks(section_text: str) -> list[tuple[str, str]]:
    matches = list(re.finditer(r"^###\s+(.+?)\s*$", section_text, re.MULTILINE))
    blocks: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(section_text)
        blocks.append((match.group(1).strip(), section_text[match.end():end].strip()))
    return blocks


def paragraph_plan_complete(section_body: str) -> bool:
    return bool(
        re.search(r"^Paragraph plan:\s*$", section_body, re.IGNORECASE | re.MULTILINE)
        and re.search(r"\|\s*Para\s*\|", section_body, re.IGNORECASE)
        and re.search(r"\|\s*Rhetorical move\s*\|", section_body, re.IGNORECASE)
        and re.search(r"Content to cover,\s*not full prose", section_body, re.IGNORECASE)
        and re.search(r"\|\s*Transition job\s*\|", section_body, re.IGNORECASE)
    )


def markdown_has_table(text: str) -> bool:
    lines = str(text or "").splitlines()
    for index, line in enumerate(lines[:-1]):
        if "|" not in line:
            continue
        divider = lines[index + 1].strip()
        if "|" not in divider:
            continue
        cells = [cell.strip() for cell in divider.strip("|").split("|")]
        if cells and all(re.match(r"^:?-{3,}:?$", cell) for cell in cells):
            return True
    return False


def final_gate_review_schema_blockers() -> list[str]:
    review_paths = list(REPO_ROOT.glob("research_trajectory/trials/*/reviews/FINAL_GATE_REVIEW.md"))
    review_paths.extend(REPO_ROOT.glob("research_trajectory/*/trials/*/reviews/FINAL_GATE_REVIEW.md"))
    review_paths.extend(REPO_ROOT.glob("research_trajectory/trials/*/REVIEW.md"))
    review_paths.extend(REPO_ROOT.glob("research_trajectory/*/trials/*/REVIEW.md"))
    review_paths.extend(REPO_ROOT.glob("manuscript/reviews/*.md"))
    final_gate_seen = False
    for path in review_paths:
        if not path.exists() or not path.is_file():
            continue
        text = safe_read(path)
        if not re.search(r"Reviewer:\s*`?Final gate reviewer`?", text, re.IGNORECASE) and not re.search(r"\bfinal[- ]gate\b", text, re.IGNORECASE):
            continue
        final_gate_seen = True
        if (
            re.search(r"Decision:\s*`?pass`?", text, re.IGNORECASE)
            and re.search(r"Gate impact:\s*`?pass`?", text, re.IGNORECASE)
            and re.search(r"Artifact Consistency Audit", text, re.IGNORECASE)
        ):
            return []
    if final_gate_seen:
        return ["Final gate review is missing `Decision: pass`, `Gate impact: pass`, or an Artifact Consistency Audit."]
    return ["No final gate reviewer output using the required taxonomy schema was found."]


def current_trial_reviewer_file_blockers() -> list[str]:
    trials = active_trial_dirs()
    if not trials:
        return ["No active trial exists for current reviewer file validation."]
    latest = trials[-1]
    blockers: list[str] = []
    for key, config in REQUIRED_REVIEWER_OUTPUTS.items():
        path = reviewer_output_path(latest, key)
        relative = rel_path(path)
        if not path.exists() or not path.is_file():
            blockers.append(f"Current trial is missing `{relative}`.")
            continue
        text = safe_read(path)
        decision = normalize_gate_status(regex_first_value(text, [r"Decision:\s*`?([^`\n]+)`?"]))
        gate = normalize_gate_status(regex_first_value(text, [r"Gate impact:\s*`?([^`\n]+)`?"]))
        if decision != "pass" or gate != "pass":
            blockers.append(f"`{relative}` is not strict pass (`Decision: {decision or 'missing'}`, `Gate impact: {gate or 'missing'}`).")
    return blockers


def trial_protocol_file_blockers(trial_dir: Path) -> list[str]:
    latest = trial_dir
    blockers: list[str] = []

    plan_path = latest / "PLAN.md"
    plan_text = safe_read(plan_path) if plan_path.exists() else ""
    scout_brief = markdown_section(plan_text, "Resource Scout Brief")
    if not scout_brief:
        blockers.append(f"`{rel_path(plan_path)}` is missing `## Resource Scout Brief`.")
    else:
        scout_status = normalize_gate_status(regex_first_value(scout_brief, [r"Scout:\s*`?([^`\n]+)`?"]))
        if scout_status not in {"required", "skipped"}:
            blockers.append(f"`{rel_path(plan_path)}` Resource Scout brief must declare `Scout: required` or `Scout: skipped`.")
        for label in ("Decision reason", "Search scope", "Resource types", "Disciplines/domains", "Known resource clues", "Freshness / date sensitivity", "Download policy", "Expected destinations", "Stop criteria"):
            if not re.search(rf"{re.escape(label)}:\s*\S", scout_brief, re.IGNORECASE):
                blockers.append(f"`{rel_path(plan_path)}` Resource Scout brief is missing `{label}:`.")
        if scout_status == "skipped" and not re.search(r"Skip reason:\s*\S", scout_brief, re.IGNORECASE):
            blockers.append(f"`{rel_path(plan_path)}` Resource Scout brief skips scout without a concrete `Skip reason:`.")

    scout_report = latest / "artifacts" / "resource_scout" / "RESOURCE_SCOUT_REPORT.md"
    scout_report_text = safe_read(scout_report) if scout_report.exists() else ""
    if not scout_report.exists() or not scout_report.is_file():
        blockers.append(f"Current trial is missing `{rel_path(scout_report)}`.")
    elif re.search(r"Scout:\s*skipped\b", scout_report_text, re.IGNORECASE):
        if not markdown_section(scout_report_text, "Reason") and not re.search(r"Skip reason:\s*\S", scout_report_text, re.IGNORECASE):
            blockers.append(f"`{rel_path(scout_report)}` skips Resource Scout without a recorded reason.")
        if scout_brief and not re.search(r"Scout:\s*skipped\b", scout_brief, re.IGNORECASE):
            blockers.append(f"`{rel_path(scout_report)}` skips Resource Scout but `PLAN.md` did not declare `Scout: skipped`.")

    spawn_decision = latest / "artifacts" / "reviewer_spawn" / "REVIEWER_SPAWN_DECISION.md"
    decision_text = safe_read(spawn_decision) if spawn_decision.exists() else ""
    if not spawn_decision.exists() or not spawn_decision.is_file():
        blockers.append(f"Current trial is missing `{rel_path(spawn_decision)}`.")
        return blockers
    spawn_needed_raw = regex_first_value(decision_text, [r"Spawn needed:\s*`?([^`\n]+)`?"])
    spawn_needed = str(spawn_needed_raw or "").strip().lower()
    if spawn_needed not in {"yes", "no"}:
        blockers.append(f"`{rel_path(spawn_decision)}` must declare `Spawn needed: yes` or `Spawn needed: no`.")
    if spawn_needed == "yes":
        review_ref = regex_first_value(
            decision_text,
            [
                r"Specialized reviewer output:\s*`?([^`\n]+)`?",
                r"Specialized review output path:\s*`?([^`\n]+)`?",
                r"Specialized review(?:er)?(?: name/path if yes)?:\s*`?([^`\n]+)`?",
                r"Specialized review path:\s*`?([^`\n]+)`?",
            ],
        )
        review_ref = str(review_ref or "").strip().strip("`")
        if not review_ref or review_ref.upper() in {"N/A", "NA", "NONE"}:
            blockers.append(f"`{rel_path(spawn_decision)}` says `Spawn needed: yes` but does not name a specialized review output path.")
        else:
            review_path = (REPO_ROOT / review_ref) if review_ref.startswith("research_trajectory/") else (latest / review_ref)
            if not review_path.exists() or not review_path.is_file():
                blockers.append(f"`{rel_path(spawn_decision)}` requires missing specialized review `{rel_path(review_path)}`.")
    return blockers


def current_trial_protocol_file_blockers() -> list[str]:
    trials = active_trial_dirs()
    if not trials:
        return ["No active trial exists for current protocol validation."]
    return trial_protocol_file_blockers(trials[-1])


def trial_dir_satisfies_current_boundary(trial_dir: Path) -> bool:
    return trial_dir_is_closed(trial_dir) and not trial_protocol_file_blockers(trial_dir)


def final_blueprint_consistency_blockers() -> list[str]:
    blockers: list[str] = []
    blueprint_path = REPO_ROOT / "manuscript" / "BLUEPRINT.md"
    if not blueprint_path.exists():
        return ["manuscript/BLUEPRINT.md is missing."]
    text = safe_read(blueprint_path)
    if not text.strip():
        return ["manuscript/BLUEPRINT.md is empty."]
    for heading in REQUIRED_BLUEPRINT_SECTIONS:
        section = markdown_section(text, heading)
        if not section:
            blockers.append(f"BLUEPRINT.md is missing required section `{heading}`.")
        elif section_has_unresolved_placeholder(section):
            blockers.append(f"BLUEPRINT.md section `{heading}` still contains template placeholders.")
    if re.search(r"^##\s+Accepted Claims And Evidence Map\s*$", text, re.IGNORECASE | re.MULTILINE):
        blockers.append("BLUEPRINT.md still uses a claim/evidence map as a top-level manuscript section; move it under `Provenance / Audit Index` and explain claims locally in `Manuscript Architecture`.")
    if re.search(r"^##\s+Candidate Claims And Evidence Map\s*$", text, re.IGNORECASE | re.MULTILINE):
        blockers.append("BLUEPRINT.md still uses a candidate claim/evidence map as a top-level manuscript section; explain local claims/evidence in `Manuscript Architecture` and keep IDs only in provenance.")
    if re.search(r"Main Claim Candidates", text, re.IGNORECASE):
        blockers.append("BLUEPRINT.md still uses `Main Claim Candidates`; final pass requires accepted or explicitly candidate claims.")
    if re.search(r"No active claims", text, re.IGNORECASE) and re.search(r"\bactive with qualification\b|\bAccepted Claims\b", text, re.IGNORECASE):
        blockers.append("BLUEPRINT.md contains contradictory active-claim language.")
    if re.search(r"tentative until source-level evidence checks are completed", text, re.IGNORECASE):
        blockers.append("BLUEPRINT.md contains stale tentative evidence-check language.")
    blocking_missing = markdown_section(text, "Blocking Missing Evidence")
    if blocking_missing and meaningful_section_lines(blocking_missing):
        blockers.append("BLUEPRINT.md has non-empty `Blocking Missing Evidence`.")

    architecture = markdown_section(text, "Manuscript Architecture")
    architecture_body = section_body(architecture)
    architecture_matches = list(re.finditer(r"^(#{3,6})\s+(.+?)\s*$", architecture_body, re.MULTILINE))
    if not architecture_matches:
        blockers.append("BLUEPRINT.md must include target-venue entries under `Manuscript Architecture`.")

    artifact_title_re = re.compile(r"^(figure|fig\.?|f\d{3,}|table|tbl\.?|t\d{3,}|algorithm|protocol|procedure|a\d{3,}|method\s+(?:m?\d|block|spec|:)|dataset|data set|benchmark|metric|rslt\d{3,}|result\s+(?:rslt?\d|\d|block|:))\b", re.IGNORECASE)
    inline_artifacts: list[tuple[str, str, str]] = []
    for index, match in enumerate(architecture_matches):
        title = match.group(2).strip()
        end = architecture_matches[index + 1].start() if index + 1 < len(architecture_matches) else len(architecture_body)
        body = architecture_body[match.end():end].strip()
        if artifact_title_re.search(title):
            inline_artifacts.append((title, body, title.lower()))
            continue
        for label in (
            "Target-venue role:",
            "Reader question answered:",
            "Local thesis / purpose:",
            "Local claims in plain language:",
            "Local evidence, results, or artifacts:",
            "Transition job:",
        ):
            if label not in body:
                blockers.append(f"`{title}` is missing `{label}`.")
        if not paragraph_plan_complete(body):
            blockers.append(f"`{title}` is missing a complete paragraph plan table.")

    def active_block(body: str) -> bool:
        return bool(re.search(r"Inclusion status:\s*active\b", body, re.IGNORECASE)) or not re.search(r"Inclusion status:\s*(candidate|deprecated|deferred|supplement)\b", body, re.IGNORECASE)

    def block_has_label(body: str, label: str) -> bool:
        return bool(re.search(rf"^\s*{re.escape(label.rstrip(':'))}\s*:", body, re.IGNORECASE | re.MULTILINE))

    def planned_placeholder_value(value: str) -> bool:
        normalized = str(value or "").strip().lower()
        if not normalized:
            return False
        return bool(re.search(
            r"\b(planned only|pending(?:\s+[\w/-]+){0,4}\s+(?:trial|check|audit|analysis|run)|figure\s+\w*\s*planned|tbd|to be filled|not yet available|future trial)\b",
            normalized,
            re.IGNORECASE,
        ))

    figure_blocks = [(title, body) for title, body, lower in inline_artifacts if re.match(r"^(figure|fig\.?|f\d{3,})\b", lower, re.IGNORECASE)]
    table_blocks = [(title, body) for title, body, lower in inline_artifacts if re.match(r"^(table|tbl\.?|t\d{3,})\b", lower, re.IGNORECASE)]
    algorithm_blocks = [(title, body) for title, body, lower in inline_artifacts if re.match(r"^(algorithm|protocol|procedure|a\d{3,}|method\s+(?:m?\d|block|spec|:))\b", lower, re.IGNORECASE)]
    result_blocks = [(title, body) for title, body, lower in inline_artifacts if re.match(r"^(dataset|data set|benchmark|metric|rslt\d{3,}|result\s+(?:rslt?\d|\d|block|:))\b", lower, re.IGNORECASE)]

    for title, body in figure_blocks:
        if not active_block(body):
            continue
        for label in (
            "Placement:",
            "Purpose or result role:",
            "Content and panel layout:",
            "Caption draft or current caption:",
            "Source artifact or spec path:",
            "Preview image:",
            "Result shown or conceptual basis:",
            "Provenance links:",
            "Target-venue fit rationale:",
            "Remaining blocker:",
        ):
            if label not in body:
                blockers.append(f"Inline figure `{title}` is missing `{label}`.")
        source_value = value_after_label(body, "Source artifact or spec path") or value_after_label(body, "Source artifact path")
        source_path = normalize_figure_source_path(source_value)
        preview_value = value_after_label(body, "Preview image")
        if source_path and Path(source_path).suffix.lower() in FIGURE_IMAGE_SUFFIXES and not re.search(r"!\[[^\]\n]*\]\([^)]+\)", preview_value):
            blockers.append(f"Inline figure `{title}` points to an image file but is missing a Markdown `Preview image`.")
    for title, body in table_blocks:
        if not active_block(body):
            continue
        for label in (
            "Placement:",
            "Table number/title:",
            "Purpose or result role:",
            "Publication-ready table:",
            "Caption draft or current caption:",
            "Table notes / definitions / abbreviations:",
            "Source artifact or spec path:",
            "Key result or conceptual contrast shown:",
            "Provenance links:",
            "Target-venue fit rationale:",
            "Remaining blocker:",
        ):
            if label not in body:
                blockers.append(f"Inline table `{title}` is missing `{label}`.")
        if not markdown_has_table(body):
            blockers.append(f"Inline table `{title}` is missing a publication-ready Markdown table body.")
    for title, body in algorithm_blocks:
        if not active_block(body):
            continue
        for label in (
            "Placement:",
            "Purpose:",
            "Inputs:",
            "Outputs:",
            "Source code or artifact links:",
            "Remaining blocker:",
        ):
            if label not in body:
                blockers.append(f"Inline algorithm/method `{title}` is missing `{label}`.")
    for title, body in result_blocks:
        if not active_block(body):
            continue
        section_plan_labels = (
            "Target-venue role:",
            "Section brief:",
            "Reader question answered:",
            "Local thesis / purpose:",
            "Local claims in plain language:",
            "Local evidence, results, or artifacts:",
            "Placed displays / methods / results:",
            "Transition job:",
            "Paragraph plan:",
        )
        if any(block_has_label(body, label) for label in section_plan_labels):
            blockers.append(f"Inline dataset/benchmark/result `{title}` appears to use section-planning fields; result blocks must use the dataset/benchmark/result schema with reader-facing result content.")
        for label in (
            "Placement:",
            "Inclusion status:",
            "Metric or result summary:",
            "Reader takeaway:",
            "Source artifact path:",
            "Limitations and uncertainty:",
            "Manuscript claim supported in plain language:",
            "Remaining blocker:",
        ):
            if label not in body:
                blockers.append(f"Inline dataset/benchmark/result `{title}` is missing `{label}`.")
        for label in (
            "Metric or result summary",
            "Reader takeaway",
            "Source artifact path",
            "Manuscript claim supported in plain language",
        ):
            if planned_placeholder_value(value_after_label(body, label)):
                blockers.append(f"Inline dataset/benchmark/result `{title}` has planned/pending placeholder text in `{label}:`; active result blocks must state the actual reader-facing result or be marked candidate/deferred.")

    legacy_figure_plan = markdown_section(text, "Figure Plan")
    legacy_table_plan = markdown_section(text, "Table Plan")
    if re.search(r"Inclusion status:\s*active\b", legacy_figure_plan, re.IGNORECASE) and not figure_blocks:
        blockers.append("Active figures only appear in legacy `Figure Plan`; place them inline under `Manuscript Architecture`.")
    if re.search(r"Inclusion status:\s*active\b", legacy_table_plan, re.IGNORECASE) and not table_blocks:
        blockers.append("Active tables only appear in legacy `Table Plan`; place them inline under `Manuscript Architecture`.")
    if not table_blocks:
        no_table_text = "\n".join([architecture, markdown_section(text, "Appendix / Supplement Plan"), legacy_table_plan])
        if not re.search(r"\b(no active tables|no table|no-table rationale)\b", no_table_text, re.IGNORECASE):
            blockers.append("BLUEPRINT.md must explain where comparison/evidence mapping is carried when no active table is planned.")
    return blockers


def final_gate_consistency_blockers() -> list[str]:
    blockers: list[str] = []
    reviewer_status = project_reviewer_baseline_status(REPO_ROOT)
    if reviewer_status.get("outdated"):
        parts = []
        if reviewer_status.get("missing"):
            parts.append(f"missing {', '.join(reviewer_status['missing'])}")
        if reviewer_status.get("changed"):
            parts.append(f"changed {', '.join(reviewer_status['changed'])}")
        if reviewer_status.get("metadata_missing"):
            parts.append("reviewer baseline metadata is missing or stale")
        if reviewer_status.get("protocol_missing"):
            parts.append(f"protocol missing {', '.join(reviewer_status['protocol_missing'])}")
        if reviewer_status.get("protocol_changed"):
            parts.append(f"protocol changed {', '.join(reviewer_status['protocol_changed'])}")
        if reviewer_status.get("protocol_metadata_missing"):
            parts.append("protocol baseline metadata is missing or stale")
        detail = "; ".join(parts) or "baseline is outdated"
        blockers.append(f"Core instructions are outdated ({detail}).")
    blockers.extend(final_gate_review_schema_blockers())
    blockers.extend(current_trial_reviewer_file_blockers())
    blockers.extend(current_trial_protocol_file_blockers())
    blockers.extend(final_blueprint_consistency_blockers())
    findings_path = REPO_ROOT / "research_trajectory" / "CURRENT_FINDINGS.md"
    if findings_path.exists():
        findings = safe_read(findings_path)
        if re.search(r"tentative until source-level evidence checks are completed", findings, re.IGNORECASE):
            blockers.append("CURRENT_FINDINGS.md contains stale tentative evidence-check language.")
    return blockers


def read_autoresearch_gate(enforce_consistency: bool = True) -> dict[str, Any]:
    if not RESEARCH_STATE_PATH.exists():
        return {
            "exists": False,
            "status": "missing",
            "raw_status": "",
            "response_to_human": "",
            "response_to_human_source": "",
            "summary": "No STATE.md file yet.",
            "path": str(RESEARCH_STATE_PATH.relative_to(REPO_ROOT)),
        }
    try:
        text = RESEARCH_STATE_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        return {
            "exists": False,
            "status": "missing",
            "raw_status": "",
            "response_to_human": "",
            "response_to_human_source": "",
            "summary": f"Could not read STATE.md: {exc}",
            "path": str(RESEARCH_STATE_PATH.relative_to(REPO_ROOT)),
        }
    section = markdown_section(text, "Autoresearch Goal Gate")
    if not section:
        return {
            "exists": False,
            "status": "missing",
            "raw_status": "",
            "response_to_human": "",
            "response_to_human_source": "",
            "summary": "No autoresearch gate section in STATE.md.",
            "path": str(RESEARCH_STATE_PATH.relative_to(REPO_ROOT)),
        }
    raw_status = ""
    for line in section.splitlines():
        match = re.match(r"^\s*(?:status|overall status|gate status)\s*:\s*(.+?)\s*$", line, re.IGNORECASE)
        if match:
            raw_status = match.group(1).strip()
            break
    overall_status = normalize_gate_status(raw_status)
    response_to_human, response_to_human_source = gate_response_to_human(section, raw_status)
    reviewer_lines = []
    reviewer_statuses: dict[str, str] = {}
    reviewer_raw_statuses: dict[str, str] = {}
    for line in section.splitlines():
        key, reviewer_status, reviewer_raw_status = parse_reviewer_gate_line(line)
        if not key:
            continue
        clean_line = line.strip()
        reviewer_lines.append(clean_line)
        reviewer_statuses[key] = reviewer_status
        reviewer_raw_statuses[key] = reviewer_raw_status
    reviewer_lines = reviewer_lines[:12]
    missing_reviewers = [key for key in REQUIRED_REVIEWER_GATES if key not in reviewer_statuses]
    incomplete_reviewers = [
        key
        for key in REQUIRED_REVIEWER_GATES
        if reviewer_statuses.get(key) != "pass"
    ]
    all_reviewers_passed = not missing_reviewers and not incomplete_reviewers
    consistency_blockers: list[str] = []
    status = overall_status
    if overall_status == "pass" and not all_reviewers_passed:
        status = "continue"
    elif overall_status == "pass" and enforce_consistency:
        consistency_blockers = final_gate_consistency_blockers()
        if consistency_blockers:
            status = "continue"
    return {
        "exists": True,
        "status": status,
        "raw_status": raw_status,
        "overall_status": overall_status,
        "response_to_human": response_to_human,
        "response_to_human_source": response_to_human_source,
        "reviewer_statuses": reviewer_statuses,
        "reviewer_raw_statuses": reviewer_raw_statuses,
        "missing_reviewers": missing_reviewers,
        "incomplete_reviewers": incomplete_reviewers,
        "all_reviewers_passed": all_reviewers_passed,
        "consistency_blockers": consistency_blockers,
        "reviewer_baseline": project_reviewer_baseline_status(REPO_ROOT),
        "summary": "\n".join(reviewer_lines) if reviewer_lines else first_meaningful_line(section, "Gate section exists."),
        "path": str(RESEARCH_STATE_PATH.relative_to(REPO_ROOT)),
    }


def gate_has_passed(gate: dict[str, Any]) -> bool:
    if gate.get("status") != "pass":
        return False
    reviewer_statuses = gate.get("reviewer_statuses")
    if not isinstance(reviewer_statuses, dict):
        return False
    if gate.get("consistency_blockers"):
        return False
    return all(reviewer_statuses.get(key) == "pass" for key in REQUIRED_REVIEWER_GATES)


def write_initial_autoresearch_gate() -> None:
    RESEARCH_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = RESEARCH_STATE_PATH.read_text(encoding="utf-8") if RESEARCH_STATE_PATH.exists() else "# Research State\n"
    section = f"""## Autoresearch Goal Gate

Status: continue
Updated: {now_iso()}

This section is owned by the autoresearch loop. The loop should continue until every required reviewer gate below is a strict `pass`.

Required reviewer gates:
- Plan reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/PLAN_REVIEW.md`
- Process reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/PROCESS_REVIEW.md`
- Evidence reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/EVIDENCE_REVIEW.md`
- Venue fit reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/VENUE_FIT_REVIEW.md`
- Manuscript reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/MANUSCRIPT_REVIEW.md`
- Figure/table reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/FIGURE_TABLE_REVIEW.md`
- Reference reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/REFERENCE_REVIEW.md`
- Final gate reviewer: continue - pending current trial file `research_trajectory/trials/<trial_id>/reviews/FINAL_GATE_REVIEW.md`

Next action: start or continue the next coherent autoresearch iteration.
"""
    RESEARCH_STATE_PATH.write_text(upsert_markdown_section(existing, "Autoresearch Goal Gate", section), encoding="utf-8")


def repair_autoresearch_gate_if_needed() -> dict[str, Any]:
    gate = read_autoresearch_gate()
    if not gate.get("exists"):
        return gate
    consistency_blockers = gate.get("consistency_blockers") if isinstance(gate.get("consistency_blockers"), list) else []
    if gate.get("overall_status") != "pass" or (gate.get("all_reviewers_passed") and not consistency_blockers):
        return gate
    raw_statuses = gate.get("reviewer_raw_statuses") if isinstance(gate.get("reviewer_raw_statuses"), dict) else {}
    repair_reason = (
        "Server repair: top-level `Status: pass` was downgraded because final blueprint, instruction baseline, or final-gate consistency checks did not pass."
        if consistency_blockers
        else "Server repair: top-level `Status: pass` was downgraded because not every required reviewer gate was a strict `pass`."
    )
    lines = [
        "## Autoresearch Goal Gate",
        "",
        "Status: continue",
        f"Updated: {now_iso()}",
        "",
        repair_reason,
        "",
        "Required reviewer gates:",
    ]
    for key, label in REQUIRED_REVIEWER_GATES.items():
        raw = str(raw_statuses.get(key) or "").strip()
        status = "pass" if normalize_gate_status(raw) == "pass" else "continue"
        path_note = ""
        active_trials = project_active_trial_dirs(REPO_ROOT)
        if active_trials:
            review_path = reviewer_output_path(active_trials[-1], key)
            if review_path.exists():
                path_note = f" - `{project_relative_path(REPO_ROOT, review_path)}`"
        lines.append(f"- {label}: {status}{path_note}")
    if consistency_blockers:
        lines.extend(["", "Consistency blockers:"])
        for blocker in consistency_blockers[:12]:
            lines.append(f"- {blocker}")
    lines.extend(
        [
            "",
            "Next action: update reviewers if needed, run final synthesis, and continue autoresearch until every required reviewer gate and final blueprint consistency check is a strict pass.",
            "",
        ]
    )
    existing = RESEARCH_STATE_PATH.read_text(encoding="utf-8") if RESEARCH_STATE_PATH.exists() else "# Research State\n"
    RESEARCH_STATE_PATH.write_text(upsert_markdown_section(existing, "Autoresearch Goal Gate", "\n".join(lines)), encoding="utf-8")
    return read_autoresearch_gate()


def ensure_autoresearch_gate_for_loop() -> None:
    gate = read_autoresearch_gate()
    if not gate.get("exists"):
        write_initial_autoresearch_gate()
        return
    repair_autoresearch_gate_if_needed()


def research_session_snapshot() -> dict[str, Any]:
    reconcile_research_process_state()
    if backfill_claude_result_transcript_from_raw_logs():
        persist_research_session()
    with RESEARCH_LOCK:
        current_mode = str(RESEARCH_SESSION.get("mode", "") or "")
        current_proc = RESEARCH_SESSION.get("process")
        current_status = str(RESEARCH_SESSION.get("status", "") or "")
        current_running = bool(current_proc and current_proc.poll() is None) or session_startup_without_process(
            current_status,
            RESEARCH_SESSION.get("started_at"),
        )
    chat_guard_active = current_mode == "chat" and current_running
    completed_goal_snapshot = current_status == "completed" and current_mode in {"goal", "research"} and not current_running
    gate = read_autoresearch_gate(enforce_consistency=False) if chat_guard_active or completed_goal_snapshot else repair_autoresearch_gate_if_needed()
    trajectory = read_trajectory_state() if chat_guard_active else sync_trajectory_state("snapshot")
    with RESEARCH_LOCK:
        RESEARCH_SESSION["gate"] = gate
        loop_active = bool(RESEARCH_SESSION.get("loop_active"))
        loop_stop_reason = RESEARCH_SESSION.get("loop_stop_reason", "")
        loop_iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
        proc = RESEARCH_SESSION.get("process")
        mode = str(RESEARCH_SESSION.get("mode", "") or "")
        status = str(RESEARCH_SESSION.get("status") or "")
        running = bool(proc and proc.poll() is None) or session_startup_without_process(status, RESEARCH_SESSION.get("started_at"))
        latest_iteration = 0 if mode == "chat" and running else latest_active_trial_iteration()
        if not running and latest_iteration > 0:
            loop_iteration = latest_iteration
            RESEARCH_SESSION["loop_iteration"] = loop_iteration
        settings = dict(RESEARCH_SESSION.get("settings") or {})
        backend = normalize_agent_backend(RESEARCH_SESSION.get("backend") or settings.get("backend") or load_ui_settings().get("agent", {}).get("backend"))
        backend_label = agent_display_name(backend)
        wait_state = agent_wait_state_from_values(
            running,
            RESEARCH_SESSION.get("last_event_at", ""),
            RESEARCH_SESSION.get("last_event_summary", ""),
            RESEARCH_SESSION.get("agent_notice", {}),
        )
        review_checkpoint_interval = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
        loop_review_checkpoint_iteration = int(RESEARCH_SESSION.get("loop_review_checkpoint_iteration") or 0)
        if loop_review_checkpoint_iteration <= 0:
            loop_review_checkpoint_iteration = loop_iteration + review_checkpoint_interval
        if gate_has_passed(gate):
            loop_active = False
            loop_stop_reason = "all_reviewer_gates_passed"
            RESEARCH_SESSION["loop_active"] = False
            RESEARCH_SESSION["loop_stop_reason"] = loop_stop_reason
            complete_expected_trial_marker("gate_passed")
        elif loop_stop_reason == "all_reviewer_gates_passed":
            loop_stop_reason = ""
            RESEARCH_SESSION["loop_stop_reason"] = ""
        run_id = str(RESEARCH_SESSION.get("id", "") or "")
        started_at = str(RESEARCH_SESSION.get("started_at", "") or "")
        active_trial_iteration = 0
        trajectory_mismatch = False
        if running and mode in {"goal", "research"} and not gate_has_passed(gate):
            marker = read_expected_trial_marker()
            expected_iteration = active_expected_trial_iteration(marker)
            if str(marker.get("status") or "").strip().lower() == "mismatch" and expected_iteration > 0:
                trajectory_mismatch = True
            active_trial_iteration = expected_iteration or latest_trial_dir_iteration() or loop_iteration
        state_text = safe_read(RESEARCH_STATE_PATH) if RESEARCH_STATE_PATH.exists() else ""
        active_progress = active_trial_progress(active_trial_iteration, state_text) if active_trial_iteration > 0 else {}
        active_run = {
            "running": running,
            "mode": mode,
            "run_id": run_id,
            "started_at": started_at,
            "trial_iteration": active_trial_iteration if active_trial_iteration > 0 else None,
            "trial_label": f"Trial {active_trial_iteration}" if active_trial_iteration > 0 else "",
            "status_label": (
                f"Trajectory mismatch on Trial {active_trial_iteration}"
                if trajectory_mismatch and active_trial_iteration > 0
                else f"{backend_label} is working on Trial {active_trial_iteration}"
                if running and active_trial_iteration > 0
                else f"{backend_label} is working"
                if running
                else ""
            ),
            "trajectory_mismatch": trajectory_mismatch,
            "wait_state": wait_state,
            "progress": active_progress,
        }
        marker = read_expected_trial_marker()
        expected_iteration = active_expected_trial_iteration(marker)
        expected_trial = {}
        if expected_iteration > 0:
            expected_trial = {
                "schema_version": marker.get("schema_version", TRAJECTORY_SCHEMA_VERSION),
                "status": str(marker.get("status") or ""),
                "expected_iteration": expected_iteration,
                "reason": str(marker.get("reason") or ""),
                "base_trial": str(marker.get("base_trial") or ""),
                "fork_id": str(marker.get("fork_id") or ""),
                "pending_intervention_ids": [str(item) for item in marker.get("pending_intervention_ids", []) if str(item).strip()],
                "pending_intervention_paths": [str(item) for item in marker.get("pending_intervention_paths", []) if str(item).strip()],
                "created_at": str(marker.get("created_at") or ""),
                "updated_at": str(marker.get("updated_at") or ""),
            }
        return {
            "id": RESEARCH_SESSION.get("id", ""),
            "session_id": RESEARCH_SESSION.get("session_id", ""),
            "backend": backend,
            "backend_label": backend_label,
            "status": RESEARCH_SESSION.get("status", "idle"),
            "mode": mode,
            "command": " ".join(RESEARCH_SESSION.get("command", [])),
            "settings": dict(RESEARCH_SESSION.get("settings") or {}),
            "started_at": started_at,
            "ended_at": RESEARCH_SESSION.get("ended_at", ""),
            "returncode": RESEARCH_SESSION.get("returncode"),
            "logs": list(RESEARCH_SESSION.get("logs", []))[-500:],
            "raw_logs": list(RESEARCH_SESSION.get("raw_logs", []))[-2000:],
            "transcript": list(RESEARCH_SESSION.get("transcript", []))[-600:],
            "last_event_at": RESEARCH_SESSION.get("last_event_at", ""),
            "last_event_summary": RESEARCH_SESSION.get("last_event_summary", ""),
            "agent_notice": dict(RESEARCH_SESSION.get("agent_notice") if isinstance(RESEARCH_SESSION.get("agent_notice"), dict) else {}),
            "agent_wait_state": wait_state,
            "loop_active": loop_active,
            "loop_iteration": loop_iteration,
            "loop_max_iterations": int(RESEARCH_SESSION.get("loop_max_iterations") or AUTORESEARCH_MAX_ITERATIONS),
            "loop_review_checkpoint_iteration": loop_review_checkpoint_iteration,
            "review_checkpoint_interval": review_checkpoint_interval,
            "loop_stop_reason": loop_stop_reason,
            "gate": gate,
            "human_tasks": read_human_tasks(),
            "trajectory": trajectory,
            "expected_trial": expected_trial,
            "active_run": active_run,
            "latest_plan": latest_plan_artifact(),
            **queued_chat_summary(),
        }


def append_research_log(line: str) -> None:
    with RESEARCH_LOCK:
        backend = normalize_agent_backend(
            RESEARCH_SESSION.get("backend")
            or (RESEARCH_SESSION.get("settings") if isinstance(RESEARCH_SESSION.get("settings"), dict) else {}).get("backend")
            or load_ui_settings().get("agent", {}).get("backend")
        )
    display = format_agent_event(line, backend)
    transcript = transcript_from_agent_line(line, backend)
    streaming_update = None if transcript else streaming_update_from_agent_line(line, backend)
    event_at = now_iso()
    notice = agent_notice_from_event(line, display)
    suppress_summary = should_suppress_agent_event_summary(line, backend)
    transcript_update: dict[str, Any] | None = None
    event_kind = "agent_event" if display or line.strip() else "session"
    with RESEARCH_LOCK:
        if line.strip():
            RESEARCH_SESSION["raw_logs"].append(line.rstrip("\n"))
            RESEARCH_SESSION["last_event_at"] = event_at
        if display:
            RESEARCH_SESSION["logs"].append(display)
            RESEARCH_SESSION["last_event_summary"] = compact_single_line(display, 260)
        elif line.strip() and not suppress_summary:
            RESEARCH_SESSION["last_event_summary"] = compact_single_line(line, 260)
        if notice:
            RESEARCH_SESSION["agent_notice"] = notice
        else:
            # A fresh non-error event means the agent is producing output again.
            # Drop any stale rate-limit notice so it cannot resurface if the agent
            # later goes briefly idle.
            existing = RESEARCH_SESSION.get("agent_notice")
            if isinstance(existing, dict) and existing.get("kind") == "rate_limited":
                age = seconds_since_iso(existing.get("detected_at"))
                if age is None or age >= AGENT_RATE_LIMIT_CLEAR_SECONDS:
                    RESEARCH_SESSION["agent_notice"] = {}
        if transcript and transcript.get("content"):
            transcript_update = finalize_streaming_transcript_locked(transcript)
            event_kind = "transcript"
        elif streaming_update:
            transcript_update = upsert_streaming_transcript_locked(streaming_update)
            if transcript_update:
                event_kind = "transcript"
        session_id = ""
        try:
            session_id = find_session_identifier(json.loads(line))
        except json.JSONDecodeError:
            session_id = find_session_identifier(line)
        if session_id and str(RESEARCH_SESSION.get("mode") or "").strip().lower() != "plan":
            RESEARCH_SESSION["session_id"] = session_id
        RESEARCH_SESSION["raw_logs"] = RESEARCH_SESSION["raw_logs"][-2000:]
        RESEARCH_SESSION["logs"] = RESEARCH_SESSION["logs"][-2000:]
        RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
        session_patch = research_event_session_patch()
    persist_research_session()
    if line.strip() or display or transcript_update:
        payload: dict[str, Any] = {"session_patch": session_patch}
        if display:
            payload["log"] = display
        if transcript_update:
            payload["transcript_entry"] = transcript_update
        emit_research_event(event_kind, payload)


def finish_research_run(returncode: int | None) -> None:
    with RESEARCH_LOCK:
        stopped_by_user = str(RESEARCH_SESSION.get("loop_stop_reason") or "") == "stopped_by_user"
        RESEARCH_SESSION["status"] = "completed" if returncode == 0 else "interrupted" if stopped_by_user else "failed"
        RESEARCH_SESSION["returncode"] = returncode
        RESEARCH_SESSION["ended_at"] = now_iso()
        RESEARCH_SESSION["process"] = None
        RESEARCH_SESSION["process_thread"] = None
        finalize_active_streaming_transcripts_locked()
        session_patch = research_event_session_patch({"returncode": returncode})
    persist_research_session()
    emit_research_event("completed" if returncode == 0 else "error", {"session_patch": session_patch, "returncode": returncode})


def stop_autoresearch_loop(reason: str, gate: dict[str, Any] | None = None) -> None:
    with RESEARCH_LOCK:
        RESEARCH_SESSION["loop_active"] = False
        RESEARCH_SESSION["loop_stop_reason"] = reason
        if gate is not None:
            RESEARCH_SESSION["gate"] = gate
    persist_research_session()


def set_review_checkpoint_window(settings: dict[str, Any] | None = None, base_iteration: int | None = None) -> int:
    interval = normalize_review_checkpoint_interval((settings or {}).get("reviewCheckpointInterval"))
    with RESEARCH_LOCK:
        if base_iteration is None:
            base_iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
        checkpoint_iteration = int(base_iteration) + interval
        RESEARCH_SESSION["loop_review_checkpoint_iteration"] = checkpoint_iteration
        RESEARCH_SESSION["loop_max_iterations"] = interval
    return checkpoint_iteration


def current_review_checkpoint_iteration(settings: dict[str, Any] | None = None) -> int:
    with RESEARCH_LOCK:
        checkpoint_iteration = int(RESEARCH_SESSION.get("loop_review_checkpoint_iteration") or 0)
        current_iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
    if checkpoint_iteration > 0:
        return checkpoint_iteration
    return set_review_checkpoint_window(settings, current_iteration)


def fast_mode_prompt_section(fast_mode: bool) -> str:
    if not fast_mode:
        return ""
    return """

Fast mode is enabled for this autoresearch loop:
- prefer the smallest coherent trial that materially advances the current gate;
- keep plans, reports, and progress updates concise and concrete;
- avoid broad literature sweeps, large refactors, or exhaustive cleanup unless they are the blocking reviewer issue;
- do not lower reviewer standards, skip required reviewer files, omit provenance, or mark partial work as pass."""


def goal_instruction_prompt_section(instruction: str = "") -> str:
    text = str(instruction or "").strip()
    if not text:
        return ""
    return f"""

Additional user instruction for this resume:
{text}

Apply this resume instruction when choosing and executing the next trial objective, but do not let it weaken reviewer standards, provenance requirements, or final-pass requirements."""


def human_tasks_prompt_section() -> str:
    return """
Human task queue:
- read `research_trajectory/HUMAN_TASKS.md` before choosing the next objective;
- the main execution agent is the only canonical writer for `research_trajectory/HUMAN_TASKS.md`;
- Resource Scout, Reviewer Scope Analyst, core reviewers, and specialized reviewers must report `Human task candidates` in their own artifacts or reviews; merge and deduplicate those candidates before writing the canonical queue;
- maintain `research_trajectory/HUMAN_TASKS.md` as the non-blocking human task queue;
- keep at most three `Status: open` tasks, merge duplicate topics before adding a new task, and close stale tasks when resolved or no longer needed;
- use task ids `HT0001`, `HT0002`, etc. with fields `Status`, `Priority`, `Blocks`, `Question`, `Why needed`, `Continue meanwhile`, `Source`, `Created`, and `Updated`;
- keep `Blocks` to `none`, `final_pass`, or `future_trial`; it must not express a hard stop;
- if useful autoresearch work can continue, keep the Autoresearch Goal Gate `Status: continue` and record the human request in `HUMAN_TASKS.md`;
- only hard stop when no meaningful non-human work remains in the whole autoresearch loop: use top-level gate `Status: blocked` only when a non-human blocker cannot be repaired or routed around, and use `Status: needs_human` only when the human decision, clarification, credential, private resource, or network/access change is on the critical path and no available resources, public alternatives, metadata-only work, follow-up retrieval trial, manuscript/evidence cleanup, or state repair can still move the project forward;
- gate `Status:` lines must be exactly one bare token: `pass`, `continue`, `blocked`, or `needs_human`; do not write `continue - needs human later` or any other decorated status."""


def resource_scout_prompt_section() -> str:
    return """
Resource Scout requirement for every substantive trial:
- read instructions/RESOURCE_SCOUT.md;
- PLAN.md must include `## Resource Scout Brief` with `Scout: required | skipped`, `Decision reason:`, `Skip reason:`, `Search scope:`, `Resource types:`, `Disciplines/domains:`, `Known resource clues:`, `Freshness / date sensitivity:`, `Download policy:`, `Expected destinations:`, and `Stop criteria:`;
- default to `Scout: required`; use `Scout: skipped` only for narrow local-only work, explicitly offline runs, or truly irrelevant external search, and write a concrete skip reason;
- after PLAN.md and reviews/PLAN_REVIEW.md, before main execution, `spawn a Resource Scout subagent to search, file, and report potentially relevant resources for the overall research goal and current trial, including files, papers, datasets, reports, news, and other external resources via web search or appropriate external sources` when required;
- write `research_trajectory/trials/<trial_id>/artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`, update `resources/user_input/RESOURCE_MANIFEST.md`, and save small public artifacts under the appropriate `resources/` folder;
- record scout-discovered materials as `autoresearch_discovered`; they are raw inputs, not current truth, until promoted by the main execution agent into REPORT.md, STATE.md, CURRENT_FINDINGS.md, PROJECT.md, or manuscript files;
- if scout outputs change assumptions, resources, risks, or success criteria, revise PLAN.md and rerun PLAN_REVIEW.md before execution;
- prefer a real Resource Scout subagent when the runtime supports it; if subagent orchestration is unavailable, stalls, or fails, complete the same scout work inline as a clearly labeled `Resource Scout fallback`, write the scout report / manifest updates / resource files, disclose the fallback in REPORT.md, and continue;
- emit visible status lines while handling scout work: `Subagent update: Resource Scout | status: starting | task: <short task> | output: none` before starting, `Subagent update: Resource Scout | status: waiting | task: <short task> | output: none` before waiting on a subagent, `Subagent update: Resource Scout | status: completed | task: <short task> | output: research_trajectory/trials/<trial_id>/artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md` after completion, or `Subagent update: Resource Scout | status: fallback | task: <short task> | output: research_trajectory/trials/<trial_id>/artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md` after inline fallback;
- when a public file body is required, follow the Download Integrity And Fallback Ladder in `instructions/RESOURCE_SCOUT.md`: verify HTTP status, content type, size, magic bytes/archive listing/header rows/checksum when available; quarantine HTML/error-page downloads; retry safe downloader variants, user agent, configured proxy/direct profiles, official alternate links, and verified local caches; record attempts before asking for user help;
- do not set the gate to `blocked` or `needs_human` solely because Resource Scout subagent orchestration failed; these are whole-loop hard stops;
- do not set the gate to `blocked` or `needs_human` solely because a public download failed until the download fallback ladder is exhausted and recorded; if useful work can continue through metadata, alternate public resources, or a follow-up retrieval trial, use `Status: continue`;
- record non-blocking human resource, credential, or preference requests as `Human Task Candidates` in the scout report for the main execution agent to merge into `research_trajectory/HUMAN_TASKS.md`;
- the Resource Scout is not a ninth reviewer; keep the eight reviewer files exactly as Plan, Process, Evidence, Venue fit, Manuscript, Figure/table, Reference, and Final gate."""


def reviewer_scope_analyst_prompt_section() -> str:
    return """
Reviewer Scope Analyst requirement for every substantive trial:
- read instructions/REVIEWER_SCOPE_ANALYST.md and instructions/reviewers/REVIEWER_SPAWNING.md;
- after REPORT.md and before refreshing the eight core reviewers, `spawn a Reviewer Scope Analyst subagent to decide whether the eight core reviewers cover the current trial's review risks`;
- write `research_trajectory/trials/<trial_id>/artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md`;
- if the decision says `Spawn needed: yes`, reuse or create the specialized reviewer instruction under `instructions/reviewers/`, then run the specialized review before the eight core reviewers and write it under the current trial `reviews/` directory;
- prefer a real Reviewer Scope Analyst subagent when the runtime supports it; if subagent orchestration is unavailable, stalls, or fails, complete the same scope analysis inline as a clearly labeled `Reviewer Scope Analyst fallback`, write the decision file, disclose the fallback in REPORT.md, and continue;
- emit visible status lines while handling reviewer-scope work: `Subagent update: Reviewer Scope Analyst | status: starting | task: <short task> | output: none` before starting, `Subagent update: Reviewer Scope Analyst | status: waiting | task: <short task> | output: none` before waiting on a subagent, `Subagent update: Reviewer Scope Analyst | status: completed | task: <short task> | output: research_trajectory/trials/<trial_id>/artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md` after completion, or `Subagent update: Reviewer Scope Analyst | status: fallback | task: <short task> | output: research_trajectory/trials/<trial_id>/artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md` after inline fallback;
- when `Spawn needed: yes`, also emit `Subagent update: Specialized reviewer | status: starting | task: <short task> | output: none`, `waiting` if waiting on a spawned reviewer, and `completed` or `fallback` with the specialized review path when finished;
- do not set the gate to `blocked` or `needs_human` solely because Reviewer Scope Analyst orchestration failed; these are whole-loop hard stops;
- record non-blocking human reviewer-coverage questions as `Human Task Candidates` in the decision artifact for the main execution agent to merge into `research_trajectory/HUMAN_TASKS.md`;
- the Reviewer Scope Analyst and any specialized reviewer are not core reviewers and must not add a ninth Autoresearch Goal Gate line."""


def gate_response_to_human_requirement() -> str:
    return "if `Status: blocked` or `Status: needs_human`, include `Response to human: <one concise user-facing question or decision request>`; `Next action` remains the system's next step."


def continue_autoresearch_loop_prompt(
    gate: dict[str, Any],
    next_iteration: int | None = None,
    fast_mode: bool = False,
    goal_instruction: str = "",
) -> str:
    status = gate.get("raw_status") or gate.get("status") or "missing"
    summary = gate.get("summary") or "No reviewer gate summary yet."
    expected = int(next_iteration or next_active_trial_iteration())
    return f"""Continue the CoAutoResearch autoresearch process from the current closed trajectory boundary. Complete exactly the next coherent trial boundary, update the autoresearch gate, then stop and return control to the UI.

This is one bounded agent invocation. The CoAutoResearch server owns the outer loop and will inspect the gate after this run to decide whether another trial is needed.
{fast_mode_prompt_section(fast_mode)}
{goal_instruction_prompt_section(goal_instruction)}
{pending_intervention_prompt_section()}
{human_tasks_prompt_section()}

Current autoresearch gate status: {status}

Next active trial must be Trial {expected}. If a `research_trajectory/trials/{expected:06d}_*` directory already exists, complete that existing trial boundary; otherwise create it under `research_trajectory/trials/` with an id beginning `{expected:06d}_`. Do not skip ahead because old runtime state or archived/superseded trials had higher numbers.

Gate summary:
{summary}

Read:
- AGENTS.md
- instructions/EXECUTION_AGENT.md
- PROJECT.md
- research_trajectory/STATE.md
- research_trajectory/CURRENT_FINDINGS.md
- the `Autoresearch Goal Gate` section in research_trajectory/STATE.md
- instructions/RESOURCE_INTAKE.md, and complete its Content Inspection Gate before using user-provided resource content for content-grounded planning, evidence, venue, methods, results, manuscript, or state claims
- instructions/RESOURCE_SCOUT.md
- instructions/REVIEWER_SCOPE_ANALYST.md
- instructions/reviewers/REVIEW_TAXONOMY.md
- all eight core reviewer instructions under instructions/reviewers/
- instructions/reviewers/FINAL_GATE_REVIEWER.md

{resource_scout_prompt_section()}
{reviewer_scope_analyst_prompt_section()}

If the `Autoresearch Goal Gate` section in `research_trajectory/STATE.md` says `Status: pass` and every current-trial reviewer file is a strict pass, including the Final gate reviewer, do not create a new trial. Report that the autoresearch goal has passed all reviewer gates.

Otherwise, run exactly the next coherent autoresearch iteration needed to move the gate toward pass:
1. create or complete Trial {expected} under research_trajectory/trials/;
2. write PLAN.md before execution, including `## Resource Scout Brief`;
3. create `reviews/` and write PLAN_REVIEW.md before execution;
4. run Resource Scout work if required: use a real subagent when available, otherwise use the inline Resource Scout fallback, then revise PLAN.md and rerun PLAN_REVIEW.md if scout outputs change planning assumptions;
5. execute mainly in workspace/;
6. write REPORT.md;
7. run Reviewer Scope Analyst work: use a real subagent when available, otherwise use the inline Reviewer Scope Analyst fallback, to decide whether the eight core reviewers cover the current trial's review risks;
8. if the reviewer spawn decision says `Spawn needed: yes`, run the specialized reviewer before core reviewers;
9. refresh all eight current-trial reviewer files after REPORT.md and reviewer-scope analysis: PLAN_REVIEW.md, PROCESS_REVIEW.md, EVIDENCE_REVIEW.md, VENUE_FIT_REVIEW.md, MANUSCRIPT_REVIEW.md, FIGURE_TABLE_REVIEW.md, REFERENCE_REVIEW.md, and FINAL_GATE_REVIEW.md;
10. update STATE.md, CURRENT_FINDINGS.md, manuscript-facing files, and notes only when genuinely changed;
11. update the `Autoresearch Goal Gate` section in research_trajectory/STATE.md at the end, with each reviewer line pointing to the current trial's reviewer file path;
12. {gate_response_to_human_requirement()}

This invocation is complete after the Trial {expected} boundary is closed and the gate is updated, even if the gate remains `continue`, `blocked`, or `needs_human`. Do not start Trial {expected + 1} in this invocation.

Required reviewer gates must all be strict `pass` before the overall autoresearch goal is complete. Do not treat "approved", "completed", "ready", "plausible", "architecture pass", "supported with qualification", or "targeted revision ready" as pass. Those are partial results unless the relevant reviewer standard and Final gate standard are fully satisfied."""


def intervention_goal_prompt(intervention_path: str, message: str, fast_mode: bool = False) -> str:
    return f"""Apply the latest formal human intervention, then complete exactly the next coherent CoAutoResearch trial boundary. Update the autoresearch gate, then stop and return control to the UI.

A formal human intervention was recorded from UI chat.
{fast_mode_prompt_section(fast_mode)}
{human_tasks_prompt_section()}

Intervention file:
- `{intervention_path}`

Original user instruction:
{message.strip() or "(No text; attached resources were submitted with this intervention.)"}

Before creating or continuing any trial:
1. read AGENTS.md;
2. read instructions/INTERVENTION_PROTOCOL.md;
3. read instructions/EXECUTION_AGENT.md;
4. read instructions/RESOURCE_SCOUT.md;
5. read instructions/REVIEWER_SCOPE_ANALYST.md;
6. read instructions/RESOURCE_INTAKE.md;
7. read the latest formal human intervention file above;
8. if the intervention or attached resources depend on user-provided resource content, complete the Content Inspection Gate before making content-grounded claims or canonical updates;
9. apply the intervention to canonical project state;
10. update research_trajectory/STATE.md, research_trajectory/CURRENT_FINDINGS.md, and manuscript-facing artifacts only where the intervention requires it.

{resource_scout_prompt_section()}
{reviewer_scope_analyst_prompt_section()}

Then run exactly one coherent autoresearch iteration under the updated state. Respect the latest formal human intervention as the highest-priority truth source. Close the current trial boundary by writing PLAN.md with `## Resource Scout Brief`, PLAN_REVIEW.md, Resource Scout work via subagent or inline fallback if required, REPORT.md, Reviewer Scope Analyst work via subagent or inline fallback, any required specialized review, all eight reviewer files (PLAN_REVIEW.md, PROCESS_REVIEW.md, EVIDENCE_REVIEW.md, VENUE_FIT_REVIEW.md, MANUSCRIPT_REVIEW.md, FIGURE_TABLE_REVIEW.md, REFERENCE_REVIEW.md, and FINAL_GATE_REVIEW.md), and the updated `Autoresearch Goal Gate` section. If the gate is `Status: blocked` or `Status: needs_human`, include `Response to human: <one concise user-facing question or decision request>`. Do not start a later trial in this invocation; the UI/server will inspect the gate and continue if needed."""


def maybe_continue_autoresearch_loop(returncode: int | None) -> None:
    with RESEARCH_LOCK:
        loop_active = bool(RESEARCH_SESSION.get("loop_active"))
        mode = str(RESEARCH_SESSION.get("mode") or "")
        settings = dict(RESEARCH_SESSION.get("settings") or {})
        iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
        goal_instruction = str(RESEARCH_SESSION.get("loop_instruction") or "")
    if not loop_active or mode not in {"goal", "command"}:
        return
    gate = read_autoresearch_gate()
    with RESEARCH_LOCK:
        RESEARCH_SESSION["gate"] = gate
    persist_research_session()
    if returncode != 0:
        stop_autoresearch_loop(f"agent_failed_returncode_{returncode}", gate)
        append_research_log(f"Autoresearch loop stopped because the agent exited with return code {returncode}.")
        return
    if gate_has_passed(gate):
        stop_autoresearch_loop("all_reviewer_gates_passed", gate)
        complete_expected_trial_marker("gate_passed")
        append_research_log("Autoresearch loop complete: all reviewer gates passed.")
        return
    if gate.get("status") == "blocked":
        stop_autoresearch_loop("gate_requires_human_input", gate)
        append_research_log("Autoresearch loop paused because the gate requires human input.")
        return
    cleanup = archive_interrupted_trial_tail("loop_continue_from_closed_boundary")
    archived = cleanup.get("archived") or []
    if archived:
        iteration = latest_active_trial_iteration()
        append_research_log(
            "Archived interrupted trial tail before continuing from the last closed trial: "
            + ", ".join(item["from"] for item in archived)
        )
        gate = read_autoresearch_gate()
        with RESEARCH_LOCK:
            RESEARCH_SESSION["gate"] = gate
        persist_research_session()
    checkpoint_iteration = current_review_checkpoint_iteration(settings)
    if iteration >= checkpoint_iteration:
        stop_autoresearch_loop("review_checkpoint_reached", gate)
        append_research_log(
            f"Autoresearch loop paused for human review at iteration {iteration}; reviewer gates have not all passed."
        )
        return
    append_research_log(
        f"Autoresearch gate is {gate.get('raw_status') or gate.get('status')}; continuing from the last closed trial boundary."
    )
    next_iteration = pending_expected_trial_iteration() or next_active_trial_iteration()
    resume_same_session = should_resume_research_session(settings)
    start_research_run(
        continue_autoresearch_loop_prompt(gate, next_iteration, bool(settings.get("fastMode")), goal_instruction),
        "goal",
        resume=resume_same_session,
        settings_payload=settings,
        display_prompt=f"Continue autoresearch loop (Trial {next_iteration}).",
        loop_active=True,
        loop_iteration_override=next_iteration,
    )


def maybe_start_queued_chat_after_run(previous_mode: str, returncode: int | None) -> bool:
    if previous_mode not in {"cold_start", "framing", "goal", "research", "command", "chat", "plan"}:
        return False
    if not read_queued_chat_messages():
        return False
    result = dispatch_next_queued_chat()
    return bool(result.get("started") or result.get("reason") in {"error", "not_running"})


def process_research_run(proc: subprocess.Popen[str]) -> None:
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            append_research_log(line)
        returncode = proc.wait()
    except Exception as exc:  # pragma: no cover - defensive process handling
        append_research_log(f"UI session error: {exc}")
        returncode = proc.poll()
    finally:
        wrapper_path = getattr(proc, "_coauto_pre_exec_wrapper", None)
        if wrapper_path:
            try:
                Path(wrapper_path).unlink(missing_ok=True)
            except OSError:
                pass
    with RESEARCH_LOCK:
        if RESEARCH_SESSION.get("process") is not proc:
            return
        mode = str(RESEARCH_SESSION.get("mode") or "")
        protected_snapshot = RESEARCH_SESSION.get("protected_snapshot")
    finish_research_run(returncode)
    if mode == "chat":
        restored_paths = restore_chat_protected_snapshot(protected_snapshot if isinstance(protected_snapshot, dict) else None)
        if restored_paths:
            append_research_log(
                "Chat mode guard restored protected autoresearch artifacts; use the Start/Resume autoresearch controls to create trials: "
                + ", ".join(restored_paths)
            )
        sync_human_intervention_indexes("chat_completed")
        with RESEARCH_LOCK:
            RESEARCH_SESSION["protected_snapshot"] = None
        persist_research_session()
    if returncode == 0:
        try:
            if mode not in {"chat", "plan"}:
                validate_expected_trial_marker()
                maybe_checkpoint_latest_trial()
                sync_trajectory_state("run_completed")
        except Exception as exc:  # pragma: no cover - checkpointing should not kill the UI loop
            append_research_log(f"Trajectory/checkpoint warning: {exc}")
    if maybe_start_queued_chat_after_run(mode, returncode):
        return
    maybe_continue_autoresearch_loop(returncode)


def agent_command_for_prompt(resume: bool, settings: dict[str, Any]) -> list[str]:
    session_id = str(RESEARCH_SESSION.get("session_id") or "")
    backend = normalize_agent_backend(settings.get("backend"))
    executable = resolve_agent_executable(backend, agent_process_env(backend))
    if resume:
        if not session_id:
            raise ValueError(f"No {agent_display_name(backend)} session is active in this UI. Start project framing first.")
        if backend == "claude":
            return [executable, *settings_to_claude_args(settings, resume=True), "--resume", session_id]
        return [executable, "exec", "resume", *settings_to_codex_args(settings, resume=True), "--skip-git-repo-check", "--json", session_id, "-"]
    if backend == "claude":
        return [executable, *settings_to_claude_args(settings, resume=False)]
    return [executable, "exec", *settings_to_codex_args(settings, resume=False), "--skip-git-repo-check", "--json", "-"]


def codex_command_for_prompt(resume: bool, settings: dict[str, Any]) -> list[str]:
    codex_settings = dict(settings)
    codex_settings["backend"] = "codex"
    return agent_command_for_prompt(resume, codex_settings)


# ---------------------------------------------------------------------------
# Auxiliary (multi-)session engine helpers
#
# These are called by aux_sessions.AuxSessionManager to build isolated
# monitor/idea sessions that never touch the evolution loop's global session.
# ---------------------------------------------------------------------------

def aux_agent_command(session: Any, resume: bool) -> list[str]:
    settings = session.settings if isinstance(session.settings, dict) else {}
    backend = normalize_agent_backend(session.backend or settings.get("backend"))
    executable = resolve_agent_executable(backend, agent_process_env(backend))
    session_id = str(getattr(session, "cli_session_id", "") or "")
    if resume and session_id:
        if backend == "claude":
            return [executable, *settings_to_claude_args(settings, resume=True), "--resume", session_id]
        return [executable, "exec", "resume", *settings_to_codex_args(settings, resume=True), "--skip-git-repo-check", "--json", session_id, "-"]
    if backend == "claude":
        return [executable, *settings_to_claude_args(settings, resume=False)]
    return [executable, "exec", *settings_to_codex_args(settings, resume=False), "--skip-git-repo-check", "--json", "-"]


def _aux_read(relative: str, limit: int = 6000) -> str:
    try:
        source = repo_path(relative)
        if source.exists() and source.is_file():
            return safe_read(source, limit)
    except Exception:
        pass
    return ""


def _aux_trials_dir() -> Path:
    return repo_path("research_trajectory/trials")


def _aux_explored_ideas(limit: int = 20) -> list[str]:
    """Extract a short list of explored trial titles from the trials directory."""
    ideas: list[str] = []
    trials_dir = _aux_trials_dir()
    if not trials_dir.exists():
        return ideas
    try:
        entries = sorted([p for p in trials_dir.iterdir() if p.is_dir()], key=lambda p: p.name)
    except OSError:
        return ideas
    for entry in entries[-limit:]:
        title = entry.name
        for candidate in ("REPORT.md", "PLAN.md"):
            report = entry / candidate
            if report.exists():
                head = safe_read(report, 400)
                for line in head.splitlines():
                    line = line.strip().lstrip("#").strip()
                    if line:
                        title = f"{entry.name}: {line[:100]}"
                        break
                break
        ideas.append(title)
    return ideas


def build_monitor_context(session: Any) -> str:
    """Read-only live progress digest, rebuilt before every monitor message."""
    trials_dir = _aux_trials_dir()
    ideas = _aux_explored_ideas()
    ideas_block = "\n".join(f"- {item}" for item in ideas) or "- (No trials recorded yet.)"
    state = _aux_read("research_trajectory/STATE.md", 5000)
    findings = _aux_read("research_trajectory/CURRENT_FINDINGS.md", 5000)
    project = _aux_read("PROJECT.md", 3000)
    trajectory = _aux_read("research_trajectory/TRAJECTORY.json", 3000)
    workspace_dir = getattr(session, "workspace_dir", "")
    return f"""# Monitor Session Context

You are a **read-only monitoring assistant** for this CoAutoResearch project.
Answer the user's questions about overall progress, the current best result,
how it compares to baseline, which ideas were explored, and which ones worked.

## Saving guidance
When the user asks you to save notes, guidance, or instructions, write a
markdown file into your workspace directory (shown below). Use a descriptive
filename ending in `.md`. After saving, tell the user the file path so they
can find it in the workspace browser.

## Your workspace (for saving notes/guidance)
`{workspace_dir}`

## Experiment log locations
- Trials directory: `{trials_dir}`
- State file: `research_trajectory/STATE.md`
- Findings file: `research_trajectory/CURRENT_FINDINGS.md`
- Trajectory index: `research_trajectory/TRAJECTORY.json`

## Research background (PROJECT.md)
{project or "(PROJECT.md is empty or missing.)"}

## Live progress snapshot (auto-refreshed {now_iso()})

### STATE.md
{state or "(No state recorded yet.)"}

### CURRENT_FINDINGS.md
{findings or "(No findings recorded yet.)"}

### TRAJECTORY.json
{trajectory or "(No trajectory recorded yet.)"}

### Explored ideas / trials
{ideas_block}
"""


def build_idea_context(session: Any) -> str:
    """Discussion sandbox context: background + baseline + explored ideas."""
    ideas = _aux_explored_ideas()
    ideas_block = "\n".join(f"- {item}" for item in ideas) or "- (No trials explored yet.)"
    project = _aux_read("PROJECT.md", 3000)
    findings = _aux_read("research_trajectory/CURRENT_FINDINGS.md", 4000)
    workspace = getattr(session, "workspace_dir", "")
    return f"""# Idea Session Context

You are a **research discussion & reproduction assistant**. Help the user
discuss ideas, read papers, clone and inspect git repositories, and reproduce
baselines so there is a working foundation.

## Your workspace (write freely here)
`{workspace}`

You may clone repos, download papers, and run baseline code inside this
workspace directory. Do NOT modify the shared research trajectory, trials,
manuscript, or PROJECT.md — those belong to the evolution session.

## Research background (PROJECT.md)
{project or "(PROJECT.md is empty or missing.)"}

## Current findings so far
{findings or "(No findings recorded yet.)"}

## Baseline / already-explored ideas
{ideas_block}

## When a promising idea emerges
If the discussion surfaces a strong idea worth pursuing as a research
direction, proactively ask the user whether they want to promote it. If yes,
write a concise summary into `IDEA_NOTES.md` inside your workspace above and
tell the user its absolute path so they can import it into the evolution
session.
"""


def build_evolution_context(session: Any) -> str:
    return """# Evolution Session Context

This is the persistent autoresearch loop. It is driven by the standard
CoAutoResearch instruction chain (AGENTS.md -> instructions/EXECUTION_AGENT.md
-> reviewers) and has full access to the research trajectory, trials, and
manuscript. Use the Start / Pause / Resume controls to drive it.
"""


AUX_MONITOR_BOUNDARY = """
Hard boundary (monitor session):
- You are READ-ONLY with respect to project research files. Do not create, edit,
  delete, rename, or move ANY file in research_trajectory/, manuscript/, or PROJECT.md.
- Do not start, resume, or continue the autoresearch loop or any trial.
- EXCEPTION: When the user explicitly asks you to save notes, guidance, or
  instructions, you MAY write markdown (.md) files into your own workspace
  directory only. This is the only write operation allowed.
- Answer the user's question from the context document and current project files.
"""

AUX_IDEA_BOUNDARY = """
Hard boundary (idea session):
- You may read any project file and write ONLY inside your own workspace directory.
- Do not modify research_trajectory/, manuscript/, PROJECT.md, reviewer files, or trials.
- Do not start, resume, or continue the autoresearch loop or create trial artifacts.
- Cloning repos, downloading papers, and running baselines inside your workspace is allowed.
"""


def build_aux_prompt(session: Any, message: str) -> str:
    kind = getattr(session, "kind", "monitor")
    context_path = getattr(session, "context_path", "")
    extra = str(message or "").strip()
    boundary = AUX_MONITOR_BOUNDARY if kind == "monitor" else AUX_IDEA_BOUNDARY
    role_line = {
        "monitor": "Respond in CoAutoResearch MONITOR mode (read-only progress Q&A).",
        "idea": "Respond in CoAutoResearch IDEA mode (discussion & reproduction sandbox).",
    }.get(kind, "Respond in CoAutoResearch chat mode.")
    return f"""{role_line}

Read your session context document first:
`{context_path}`

User message:
{extra or "(No text.)"}

{response_language_prompt_section()}
{boundary}
Answer the user's question directly and substantively. This session's CLI
context is isolated from the autoresearch loop, so nothing you say here affects
the evolution process."""


def aux_manager() -> AuxSessionManager:
    return current_project_context().aux_manager


def aux_list_sessions() -> dict[str, Any]:
    return {"sessions": aux_manager().list_sessions()}


def aux_create_session(payload: dict[str, Any]) -> dict[str, Any]:
    kind = str(payload.get("kind") or "monitor").strip()
    title = str(payload.get("title") or "").strip()
    session = aux_manager().create(kind, title, payload.get("settings"))
    return {"session": session.public(), "sessions": aux_manager().list_sessions()}


def aux_get_session(session_id: str) -> dict[str, Any]:
    return {"session": aux_manager().get(session_id).snapshot()}


def aux_delete_session(session_id: str) -> dict[str, Any]:
    result = aux_manager().delete(session_id)
    return {**result, "sessions": aux_manager().list_sessions()}


def aux_refresh_session(session_id: str) -> dict[str, Any]:
    session = aux_manager().refresh_session(session_id)
    return {"session": session.snapshot()}


def aux_chat_session(session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return aux_manager().chat(session_id, payload)


def aux_stop_session(session_id: str) -> dict[str, Any]:
    session = aux_manager().get(session_id)
    session.stop(force=False)
    return {"session": session.public()}


def aux_workspace_list(session_id: str, parsed: Any) -> dict[str, Any]:
    """List files/dirs in a session's workspace at the given relative path."""
    session = aux_manager().get(session_id)
    ws = session.workspace_dir
    query = parse_qs(parsed.query)
    rel = unquote(str(query.get("path", [""])[0] or "")).strip()
    # Safety: prevent path traversal outside workspace
    target = (ws / rel).resolve() if rel else ws.resolve()
    try:
        target.relative_to(ws.resolve())
    except ValueError:
        return {"items": []}
    items: list[dict[str, Any]] = []
    if target.is_dir():
        try:
            for entry in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
                if entry.name.startswith(".") and entry.name not in (".", ".."):
                    continue
                items.append({
                    "name": entry.name,
                    "path": str(entry.relative_to(ws)),
                    "is_dir": entry.is_dir(),
                    "size": entry.stat().st_size if entry.is_file() else 0,
                })
        except OSError:
            pass
    return {"items": items}


def serve_aux_workspace_file(self: Any, session_id: str, parsed: Any) -> None:
    """Serve a file from a session's workspace for preview or download."""
    session = aux_manager().get(session_id)
    ws = session.workspace_dir
    query = parse_qs(parsed.query)
    rel = unquote(str(query.get("path", [""])[0] or "")).strip()
    download = str(query.get("download", [""])[0]).strip().lower() in {"1", "true", "yes"}
    if not rel:
        self.send_error(400, "Missing path parameter")
        return
    target = (ws / rel).resolve()
    try:
        target.relative_to(ws.resolve())
    except ValueError:
        self.send_error(403)
        return
    if not target.exists() or not target.is_file():
        self.send_error(404)
        return
    content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    data = target.read_bytes()
    if download:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition", f'attachment; filename="{target.name}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        return
    # Preview mode: return JSON with content
    import base64
    is_binary = not content_type.startswith("text/") and content_type not in (
        "application/json", "application/x-yaml", "application/x-sh",
    ) and not content_type.startswith("image/")
    if content_type.startswith("image/"):
        self.send_json({
            "ok": True,
            "name": target.name,
            "content_type": content_type,
            "content": base64.b64encode(data).decode("ascii"),
        })
        return
    try:
        text = data.decode("utf-8")
        # Truncate very large files for preview
        if len(text) > 100_000:
            text = text[:100_000] + "\n\n… (truncated, file is larger than 100KB)"
        self.send_json({
            "ok": True,
            "name": target.name,
            "content_type": content_type,
            "content": text,
        })
    except UnicodeDecodeError:
        self.send_json({
            "ok": True,
            "name": target.name,
            "content_type": content_type,
            "content": "(binary file, use download instead)",
        })



def pre_exec_script_for_settings(settings: dict[str, Any]) -> str:
    return normalize_pre_exec_script(settings.get("preExecScript"))


def create_agent_pre_exec_wrapper(settings: dict[str, Any]) -> Path | None:
    script = pre_exec_script_for_settings(settings)
    if not script:
        return None
    if os.name == "nt":
        backend = normalize_agent_backend(settings.get("backend"))
        raise ValueError(
            f"Shell setup before {agent_display_name(backend)} is supported on macOS/Linux UI servers. "
            "On Windows, use Settings environment fields or start CoAutoResearch from a configured shell."
        )
    wrapper_dir = Path(os.fspath(RUNTIME_DIR)) / "agent-shell-setup"
    wrapper_dir.mkdir(parents=True, exist_ok=True)
    wrapper_path = wrapper_dir / f"agent_setup_{now_id()}_{uuid.uuid4().hex[:8]}.sh"
    wrapper_path.write_text(f"set -e\n{script}\nexec \"$@\"\n", encoding="utf-8")
    wrapper_path.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
    return wrapper_path


def shell_for_pre_exec(env: dict[str, str]) -> str:
    path = env.get("PATH") or os.environ.get("PATH") or None
    return shutil.which("bash", path=path) or shutil.which("sh", path=path) or "/bin/sh"


def popen_command_for_agent(command: list[str], settings: dict[str, Any], env: dict[str, str]) -> tuple[str | list[str], bool, Path | None]:
    wrapper_path = create_agent_pre_exec_wrapper(settings)
    if wrapper_path:
        return [shell_for_pre_exec(env), str(wrapper_path), *command], False, wrapper_path
    use_shell = executable_requires_windows_shell(command[0])
    return subprocess.list2cmdline(command) if use_shell else command, use_shell, None


def signal_research_process(proc: subprocess.Popen[str], force: bool = False) -> None:
    if os.name == "nt":
        if force:
            proc.kill()
        else:
            proc.terminate()
        return
    sig = signal.SIGKILL if force else signal.SIGTERM
    try:
        os.killpg(proc.pid, sig)
    except ProcessLookupError:
        return
    except OSError:
        if force:
            proc.kill()
        else:
            proc.terminate()


def should_resume_research_session(settings_payload: Any | None = None) -> bool:
    status = str(RESEARCH_SESSION.get("status") or "").strip().lower()
    if status in {"interrupted", "failed"}:
        return False
    mode = str(RESEARCH_SESSION.get("mode") or "").strip().lower()
    if mode == "plan":
        return False
    session_id = str(RESEARCH_SESSION.get("session_id") or "").strip()
    if not session_id:
        return False
    if session_id == str(RESEARCH_SESSION.get("plan_thread_id") or "").strip():
        return False
    session_settings = RESEARCH_SESSION.get("settings") if isinstance(RESEARCH_SESSION.get("settings"), dict) else {}
    current_backend = normalize_agent_backend(RESEARCH_SESSION.get("backend") or session_settings.get("backend"))
    if current_backend == "claude":
        session_permission = infer_claude_permission_preset(session_settings)
        session_mode = str(session_settings.get("permissionMode") or "").strip()
        if session_permission == "plan" or session_mode == "plan":
            return False
    if settings_payload is not None:
        target_backend = normalize_agent_backend(implementation_settings_from_payload(settings_payload).get("backend"))
        if current_backend and target_backend != current_backend:
            return False
    return True


def start_research_run(
    prompt: str,
    mode: str,
    resume: bool,
    settings_payload: Any | None = None,
    display_prompt: str | None = None,
    loop_active: bool | None = None,
    reset_review_checkpoint: bool = False,
    loop_iteration_override: int | None = None,
) -> dict[str, Any]:
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("Prompt is required.")
    reconcile_research_process_state()
    settings = implementation_settings_from_payload(settings_payload)
    backend = normalize_agent_backend(settings.get("backend"))
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        status = str(RESEARCH_SESSION.get("status") or "")
        if (proc and proc.poll() is None) or session_startup_without_process(status, RESEARCH_SESSION.get("started_at")):
            raise ValueError(f"A {agent_display_name(backend)} run is already active.")
    ensure_agent_ready(backend, settings=settings)
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        status = str(RESEARCH_SESSION.get("status") or "")
        if (proc and proc.poll() is None) or session_startup_without_process(status, RESEARCH_SESSION.get("started_at")):
            raise ValueError(f"A {agent_display_name(backend)} run is already active.")
        if resume and not should_resume_research_session(settings):
            resume = False
        previous_session_id = str(RESEARCH_SESSION.get("session_id") or "")
        command = agent_command_for_prompt(resume, settings)
        protected_snapshot = create_chat_protected_snapshot() if mode == "chat" else None
        if mode == "goal":
            sync_trajectory_state("start_goal_run")
        previous_loop_iteration = latest_active_trial_iteration() if mode == "goal" else int(RESEARCH_SESSION.get("loop_iteration") or 0)
        next_loop_active = bool(RESEARCH_SESSION.get("loop_active")) if loop_active is None else bool(loop_active)
        if loop_iteration_override is not None:
            next_loop_iteration = max(0, int(loop_iteration_override))
        elif next_loop_active and mode == "goal":
            next_loop_iteration = next_active_trial_iteration()
        else:
            next_loop_iteration = previous_loop_iteration
        review_checkpoint_interval = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
        loop_review_checkpoint_iteration = int(RESEARCH_SESSION.get("loop_review_checkpoint_iteration") or 0)
        if next_loop_active and (reset_review_checkpoint or loop_review_checkpoint_iteration <= 0):
            checkpoint_base = max(0, next_loop_iteration - 1) if mode == "goal" else previous_loop_iteration
            loop_review_checkpoint_iteration = checkpoint_base + review_checkpoint_interval
        if next_loop_active and mode == "goal" and next_loop_iteration > 0:
            trajectory = read_trajectory_state()
            write_expected_trial_marker(
                next_loop_iteration,
                reason=mode,
                base_trial=str(trajectory.get("base_trial") or ""),
                fork_id=str(trajectory.get("fork_id") or ""),
            )
        if not resume:
            RESEARCH_SESSION["logs"] = []
            RESEARCH_SESSION["raw_logs"] = []
            RESEARCH_SESSION["transcript"] = []
            RESEARCH_SESSION["streaming_transcript"] = {}
        RESEARCH_SESSION.update(
            {
                "id": f"S{now_id()}_{slugify(mode, 'research')}",
                "session_id": previous_session_id if resume else "",
                "status": "running",
                "backend": backend,
                "mode": mode,
                "command": command,
                "settings": settings,
                "started_at": now_iso(),
                "ended_at": "",
                "returncode": None,
                "streaming_transcript": {},
                "loop_active": next_loop_active,
                "loop_iteration": next_loop_iteration,
                "loop_max_iterations": review_checkpoint_interval,
                "loop_review_checkpoint_iteration": loop_review_checkpoint_iteration,
                "loop_stop_reason": "" if next_loop_active else RESEARCH_SESSION.get("loop_stop_reason", ""),
                "process": None,
                "last_event_at": now_iso(),
                "last_event_summary": "Starting selected agent.",
                "agent_notice": {},
                "protected_snapshot": protected_snapshot,
            }
        )
        display_text = prompt if display_prompt is None else str(display_prompt).strip()
        if mode == "command":
            RESEARCH_SESSION["transcript"].append(transcript_entry("user", "user", "User", display_text, "ui.command", False))
        else:
            title = "Cold start request" if mode == "cold_start" else "User"
            RESEARCH_SESSION["transcript"].append(transcript_entry("user", "user", title, display_text, f"ui.{mode}", mode in {"chat", "research"}))
        RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
        session_patch = research_event_session_patch()
    persist_research_session()
    emit_research_event("session", {"session_patch": session_patch})

    wrapper_path: Path | None = None
    try:
        process_env = agent_process_env(backend)
        popen_command, use_shell, wrapper_path = popen_command_for_agent(command, settings, process_env)
        proc = subprocess.Popen(
            popen_command,
            cwd=REPO_ROOT,
            env=process_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            shell=use_shell,
            start_new_session=os.name != "nt",
        )
        if wrapper_path:
            setattr(proc, "_coauto_pre_exec_wrapper", wrapper_path)
        assert proc.stdin is not None
        proc.stdin.write(prompt)
        proc.stdin.write("\n")
        proc.stdin.close()
    except (OSError, ValueError) as exc:
        if wrapper_path:
            try:
                wrapper_path.unlink(missing_ok=True)
            except OSError:
                pass
        if isinstance(exc, OSError):
            append_research_log(agent_start_error_message(exc, command, backend))
        else:
            append_research_log(str(exc))
        finish_research_run(127)
        return research_session_snapshot()

    with RESEARCH_LOCK:
        RESEARCH_SESSION["process"] = proc
        RESEARCH_SESSION["pre_exec_script_applied"] = bool(wrapper_path)
    append_research_log(f"Started: {' '.join(command)}")
    if wrapper_path:
        append_research_log(f"Applied shell setup before starting {agent_display_name(backend)}.")
    context = current_project_context()
    thread = threading.Thread(target=run_in_project, args=(context, process_research_run, proc), daemon=True)
    with RESEARCH_LOCK:
        RESEARCH_SESSION["process_thread"] = thread
    thread.start()
    return research_session_snapshot()


def codex_app_server_command(settings: dict[str, Any]) -> list[str]:
    executable = resolve_agent_executable("codex", agent_process_env("codex"))
    args = [executable]
    if settings.get("webSearch"):
        args.extend(["-c", 'web_search="live"'])
    args.extend(extra_config_args(str(settings.get("extraConfig") or "")))
    args.extend(["app-server", "--listen", "stdio://"])
    return args


def json_rpc_write(proc: subprocess.Popen[str], message: dict[str, Any]) -> None:
    if proc.stdin is None:
        raise RuntimeError("Agent app-server stdin is closed.")
    proc.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
    proc.stdin.flush()


def extract_nested_id(payload: Any, names: tuple[str, ...]) -> str:
    if isinstance(payload, dict):
        for name in names:
            value = payload.get(name)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key in ("thread", "turn", "result", "params", "item"):
            nested = payload.get(key)
            found = extract_nested_id(nested, names)
            if found:
                return found
        for nested in payload.values():
            found = extract_nested_id(nested, names)
            if found:
                return found
    if isinstance(payload, list):
        for item in payload:
            found = extract_nested_id(item, names)
            if found:
                return found
    return ""


def codex_plan_event_parts(event: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    method = str(event.get("method") or event.get("type") or event.get("event") or "").strip()
    params = event.get("params") if isinstance(event.get("params"), dict) else event
    return method, params if isinstance(params, dict) else {}


def plan_steps_from_payload(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    steps: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        step = str(item.get("step") or item.get("text") or "").strip()
        status = str(item.get("status") or "").strip()
        if step:
            steps.append({"step": step, "status": status})
    return steps


def initialize_plan_research_session(
    plan_id: str,
    display_message: str,
    settings: dict[str, Any],
    command: list[str],
    backend: str,
) -> None:
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        status = str(RESEARCH_SESSION.get("status") or "")
        if (proc and proc.poll() is None) or session_startup_without_process(status, RESEARCH_SESSION.get("started_at")):
            raise ValueError(f"A {agent_display_name(backend)} run is already active.")
        RESEARCH_SESSION.update(
            {
                "id": f"S{now_id()}_plan",
                "session_id": "",
                "status": "running",
                "backend": backend,
                "mode": "plan",
                "command": command,
                "settings": settings,
                "started_at": now_iso(),
                "ended_at": "",
                "returncode": None,
                "logs": [],
                "raw_logs": [],
                "transcript": [],
                "streaming_transcript": {},
                "loop_active": False,
                "loop_stop_reason": RESEARCH_SESSION.get("loop_stop_reason", ""),
                "process": None,
                "last_event_at": now_iso(),
                "last_event_summary": "Starting plan mode.",
                "agent_notice": {},
                "protected_snapshot": None,
                "plan_id": plan_id,
                "plan_thread_id": "",
                "plan_turn_id": "",
            }
        )
        RESEARCH_SESSION["transcript"].append(transcript_entry("user", "user", "User", display_message, "ui.plan", True))
        RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
        session_patch = research_event_session_patch()
    persist_research_session()
    emit_research_event("session", {"session_patch": session_patch})


def start_plan_process(
    command: list[str],
    settings: dict[str, Any],
    backend: str,
    plan_id: str,
    processor: Any,
    prompt: str,
) -> dict[str, Any]:
    wrapper_path: Path | None = None
    try:
        process_env = agent_process_env(backend)
        popen_command, use_shell, wrapper_path = popen_command_for_agent(command, settings, process_env)
        proc = subprocess.Popen(
            popen_command,
            cwd=REPO_ROOT,
            env=process_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            shell=use_shell,
            start_new_session=os.name != "nt",
        )
        if wrapper_path:
            setattr(proc, "_coauto_pre_exec_wrapper", wrapper_path)
    except (OSError, ValueError) as exc:
        if wrapper_path:
            try:
                wrapper_path.unlink(missing_ok=True)
            except OSError:
                pass
        message = agent_start_error_message(exc, command, backend) if isinstance(exc, OSError) else str(exc)
        append_research_log(message)
        mark_plan_artifact_failed(plan_id, message)
        finish_research_run(127)
        return research_session_snapshot()

    with RESEARCH_LOCK:
        RESEARCH_SESSION["process"] = proc
        RESEARCH_SESSION["pre_exec_script_applied"] = bool(wrapper_path)
    append_research_log(f"Started: {' '.join(command)}")
    if wrapper_path:
        append_research_log(f"Applied shell setup before starting {agent_display_name(backend)}.")
    context = current_project_context()
    thread = threading.Thread(target=run_in_project, args=(context, processor, proc, plan_id, prompt, settings), daemon=True)
    with RESEARCH_LOCK:
        RESEARCH_SESSION["process_thread"] = thread
    thread.start()
    return research_session_snapshot()


def process_codex_app_server_plan_run(
    proc: subprocess.Popen[str],
    plan_id: str,
    prompt: str,
    settings: dict[str, Any],
) -> None:
    returncode: int | None = None
    thread_id = ""
    turn_id = ""
    plan_text_parts: dict[str, list[str]] = {}
    final_plan_text = ""
    sent_thread_start = False
    sent_turn_start = False
    next_request_id = 1

    def request(method: str, params: dict[str, Any] | None = None) -> int:
        nonlocal next_request_id
        request_id = next_request_id
        next_request_id += 1
        json_rpc_write(proc, {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}})
        return request_id

    try:
        assert proc.stdout is not None
        request(
            "initialize",
            {
                "clientInfo": {"name": "co-auto-research-ui", "version": "1.0", "title": "CoAutoResearch UI"},
                "capabilities": {"experimentalApi": True},
            },
        )
        for line in proc.stdout:
            append_research_log(line)
            stripped = line.strip()
            if not stripped:
                continue
            try:
                event = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue
            if event.get("error"):
                error_text = event_payload_text(event.get("error")) or "Codex app-server returned an error."
                raise RuntimeError(
                    f"{error_text} Codex plan mode requires app-server experimental collaborationMode support; upgrade Codex CLI."
                )

            method, params = codex_plan_event_parts(event)
            if method in {"thread/started", "thread.started"}:
                thread_id = extract_nested_id(params, ("threadId", "thread_id", "id")) or thread_id
            if method in {"turn/started", "turn.started"}:
                turn_id = extract_nested_id(params, ("turnId", "turn_id", "id")) or turn_id
                if turn_id:
                    with RESEARCH_LOCK:
                        RESEARCH_SESSION["plan_turn_id"] = turn_id
                    update_plan_artifact(plan_id, thread_id=thread_id, session_id=thread_id, status="running")

            if "id" in event and int(event.get("id") or 0) == 1 and not sent_thread_start:
                json_rpc_write(proc, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
                request(
                    "thread/start",
                    {
                        "cwd": str(REPO_ROOT),
                        "model": normalize_codex_model(settings.get("model")),
                        "sandbox": "read-only",
                        "approvalPolicy": "never",
                    },
                )
                sent_thread_start = True
                continue

            if sent_thread_start and not sent_turn_start:
                candidate_thread_id = extract_nested_id(event, ("threadId", "thread_id", "id"))
                if candidate_thread_id:
                    thread_id = thread_id or candidate_thread_id
                    with RESEARCH_LOCK:
                        RESEARCH_SESSION["plan_thread_id"] = thread_id
                    model = normalize_codex_model(settings.get("model"))
                    reasoning = normalize_reasoning_effort(settings.get("reasoningEffort"), "codex", model)
                    request(
                        "turn/start",
                        {
                            "threadId": thread_id,
                            "input": [{"type": "text", "text": prompt, "text_elements": []}],
                            "cwd": str(REPO_ROOT),
                            "model": model,
                            "approvalPolicy": "never",
                            "sandboxPolicy": {"type": "readOnly", "networkAccess": bool(settings.get("webSearch"))},
                            "collaborationMode": {
                                "mode": "plan",
                                "settings": {
                                    "model": model,
                                    "reasoning_effort": reasoning or None,
                                    "developer_instructions": None,
                                },
                            },
                        },
                    )
                    sent_turn_start = True
                    update_plan_artifact(plan_id, thread_id=thread_id, session_id=thread_id, status="running")
                    continue

            if method in {"item/plan/delta", "item.plan.delta"}:
                item_id = str(params.get("itemId") or params.get("item_id") or "plan")
                delta = str(params.get("delta") or "")
                if delta:
                    plan_text_parts.setdefault(item_id, []).append(delta)
                    plan_text = "".join(plan_text_parts[item_id]).strip()
                    artifact = update_plan_artifact(plan_id, status="running", plan_text=plan_text, thread_id=thread_id, session_id=thread_id)
                    append_plan_transcript(artifact)
                continue

            if method in {"turn/plan/updated", "turn.plan.updated"}:
                steps = plan_steps_from_payload(params.get("plan"))
                artifact = update_plan_artifact(
                    plan_id,
                    status="running",
                    steps=steps,
                    explanation=str(params.get("explanation") or ""),
                    thread_id=thread_id,
                    session_id=thread_id,
                )
                append_plan_transcript(artifact)
                continue

            if method in {"item/completed", "item.completed"}:
                item = params.get("item") if isinstance(params.get("item"), dict) else {}
                if str(item.get("type") or "").lower() == "plan":
                    final_plan_text = str(item.get("text") or "").strip()
                    if final_plan_text:
                        artifact = update_plan_artifact(
                            plan_id,
                            status="ready",
                            plan_text=final_plan_text,
                            thread_id=thread_id,
                            session_id=thread_id,
                        )
                        append_plan_transcript(artifact)
                continue

            if method in {"turn/completed", "turn.completed"}:
                break
        try:
            if proc.stdin:
                proc.stdin.close()
        except OSError:
            pass
        try:
            returncode = proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            # `codex app-server` is a long-lived server process. After the
            # plan turn completes, stop the stdio server explicitly so the UI
            # session can complete instead of waiting for the server forever.
            signal_research_process(proc)
            try:
                returncode = proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                signal_research_process(proc, force=True)
                returncode = proc.wait(timeout=1)
    except Exception as exc:  # pragma: no cover - defensive adapter handling
        append_research_log(f"Codex plan mode error: {exc}")
        mark_plan_artifact_failed(plan_id, str(exc))
        returncode = proc.poll()
    finally:
        wrapper_path = getattr(proc, "_coauto_pre_exec_wrapper", None)
        if wrapper_path:
            try:
                Path(wrapper_path).unlink(missing_ok=True)
            except OSError:
                pass
        try:
            if proc.stdin:
                proc.stdin.close()
        except OSError:
            pass

    with RESEARCH_LOCK:
        if RESEARCH_SESSION.get("process") is not proc:
            return
    artifact = read_plan_artifact(plan_id)
    if str(artifact.get("status") or "") != "ready":
        text = str(artifact.get("plan_text") or final_plan_text or "").strip()
        if text:
            artifact = update_plan_artifact(plan_id, status="ready", plan_text=text, thread_id=thread_id, session_id=thread_id)
            append_plan_transcript(artifact)
            returncode = 0
        else:
            mark_plan_artifact_failed(
                plan_id,
                "Codex app-server did not return a plan item. Upgrade Codex CLI; CoAutoResearch does not fallback to sending `/plan` through codex exec.",
            )
            returncode = returncode if returncode not in {0, None} else 1
    finish_research_run(0 if str(read_plan_artifact(plan_id).get("status") or "") == "ready" else returncode)


def extract_claude_exit_plan(event: Any) -> str:
    if isinstance(event, dict):
        name = str(event.get("name") or event.get("tool_name") or event.get("tool") or "").strip()
        tool_input = event.get("input") if isinstance(event.get("input"), dict) else event.get("tool_input")
        if name == "ExitPlanMode" and isinstance(tool_input, dict):
            plan = str(tool_input.get("plan") or "").strip()
            if plan:
                return plan
        for value in event.values():
            plan = extract_claude_exit_plan(value)
            if plan:
                return plan
    if isinstance(event, list):
        for item in event:
            plan = extract_claude_exit_plan(item)
            if plan:
                return plan
    return ""


def claude_plan_hook_paths(plan_id: str) -> tuple[Path, Path]:
    hook_dir = plan_runtime_dir() / "hooks"
    hook_dir.mkdir(parents=True, exist_ok=True)
    return hook_dir / f"{normalize_plan_id(plan_id)}_exit_plan_hook.py", hook_dir / f"{normalize_plan_id(plan_id)}_settings.json"


def write_claude_plan_hook(plan_id: str) -> Path:
    hook_path, settings_path = claude_plan_hook_paths(plan_id)
    artifact_path = plan_artifact_path(plan_id)
    hook_path.write_text(
        """#!/usr/bin/env python3
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

def find_plan(value):
    if isinstance(value, dict):
        name = str(value.get("name") or value.get("tool_name") or value.get("tool") or "")
        tool_input = value.get("tool_input") if isinstance(value.get("tool_input"), dict) else value.get("input")
        if name == "ExitPlanMode" and isinstance(tool_input, dict):
            plan = str(tool_input.get("plan") or "").strip()
            if plan:
                return plan
        for key in ("tool_input", "input"):
            nested = value.get(key)
            if isinstance(nested, dict):
                plan = str(nested.get("plan") or "").strip()
                if plan:
                    return plan
        for nested in value.values():
            plan = find_plan(nested)
            if plan:
                return plan
    if isinstance(value, list):
        for nested in value:
            plan = find_plan(nested)
            if plan:
                return plan
    return ""

artifact_path = Path(sys.argv[1])
try:
    payload = json.loads(sys.stdin.read() or "{}")
except json.JSONDecodeError:
    payload = {}
plan = find_plan(payload)
if plan:
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    artifact["status"] = "ready"
    artifact["plan_text"] = plan
    artifact["updated_at"] = datetime.now(timezone.utc).isoformat()
    artifact_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
print(json.dumps({
    "behavior": "deny",
    "interrupt": True,
    "message": "Plan captured by CoAutoResearch. Approve the plan in the UI to run implementation."
}))
""",
        encoding="utf-8",
    )
    hook_path.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
    command = f"{shlex.quote(sys.executable)} {shlex.quote(str(hook_path))} {shlex.quote(str(artifact_path))}"
    settings_payload = {
        "hooks": {
            "PermissionRequest": [
                {
                    "matcher": "ExitPlanMode",
                    "hooks": [{"type": "command", "command": command}],
                }
            ]
        }
    }
    settings_path.write_text(json.dumps(settings_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return settings_path


def process_claude_plan_run(
    proc: subprocess.Popen[str],
    plan_id: str,
    prompt: str,
    settings: dict[str, Any],
) -> None:
    returncode: int | None = None
    try:
        assert proc.stdin is not None
        proc.stdin.write(prompt)
        proc.stdin.write("\n")
        proc.stdin.close()
        assert proc.stdout is not None
        for line in proc.stdout:
            append_research_log(line)
            stripped = line.strip()
            if not stripped:
                continue
            try:
                event = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            plan = extract_claude_exit_plan(event)
            if plan:
                artifact = update_plan_artifact(plan_id, status="ready", plan_text=plan)
                append_plan_transcript(artifact)
        returncode = proc.wait()
    except Exception as exc:  # pragma: no cover - defensive adapter handling
        append_research_log(f"Claude plan mode error: {exc}")
        mark_plan_artifact_failed(plan_id, str(exc))
        returncode = proc.poll()
    finally:
        wrapper_path = getattr(proc, "_coauto_pre_exec_wrapper", None)
        if wrapper_path:
            try:
                Path(wrapper_path).unlink(missing_ok=True)
            except OSError:
                pass
    with RESEARCH_LOCK:
        if RESEARCH_SESSION.get("process") is not proc:
            return
    artifact = read_plan_artifact(plan_id)
    if str(artifact.get("status") or "") != "ready" and str(artifact.get("plan_text") or "").strip():
        artifact = update_plan_artifact(plan_id, status="ready")
        append_plan_transcript(artifact)
    if str(read_plan_artifact(plan_id).get("status") or "") != "ready":
        mark_plan_artifact_failed(plan_id, "Claude plan mode did not provide an ExitPlanMode plan.")
        returncode = returncode if returncode not in {0, None} else 1
    finish_research_run(0 if str(read_plan_artifact(plan_id).get("status") or "") == "ready" else returncode)


def start_codex_plan_run(prompt: str, display_message: str, settings: dict[str, Any], artifact: dict[str, Any]) -> dict[str, Any]:
    backend = "codex"
    ensure_agent_ready(backend, settings=settings)
    command = codex_app_server_command(settings)
    initialize_plan_research_session(str(artifact["id"]), display_message, settings, command, backend)
    update_plan_artifact(str(artifact["id"]), status="running")
    return start_plan_process(command, settings, backend, str(artifact["id"]), process_codex_app_server_plan_run, prompt)


def start_claude_plan_run(prompt: str, display_message: str, settings: dict[str, Any], artifact: dict[str, Any]) -> dict[str, Any]:
    backend = "claude"
    plan_settings = normalize_claude_settings({**settings, "permissionPreset": "plan", "permissionMode": "plan"}, settings)
    plan_settings["backend"] = "claude"
    ensure_agent_ready(backend, settings=plan_settings)
    settings_path = write_claude_plan_hook(str(artifact["id"]))
    executable = resolve_agent_executable("claude", agent_process_env("claude"))
    command = [executable, *settings_to_claude_args(plan_settings, resume=False), "--settings", str(settings_path)]
    initialize_plan_research_session(str(artifact["id"]), display_message, plan_settings, command, backend)
    update_plan_artifact(str(artifact["id"]), status="running")
    return start_plan_process(command, plan_settings, backend, str(artifact["id"]), process_claude_plan_run, prompt)


def cold_start_prompt(payload: dict[str, Any]) -> str:
    brief = str(payload.get("brief", "")).strip()
    target_venue = str(payload.get("targetVenue", "")).strip()
    return f"""Run adaptive intake triage for this CoAutoResearch scaffold, then cold start or conversion only as appropriate.

User brief:
{brief}

Target venue / audience:
{target_venue or "Not provided"}

{chat_history_prompt_section(payload.get("conversationHistory"))}
{response_language_prompt_section()}

Resource locations to inspect:
- ongoing work: resources/ongoing_work/
- proposals: resources/proposals/
- literature: resources/literature/
- data: resources/data_sources/
- other or mixed materials: resources/other/
- target venue notes: resources/target_venue/

Treat these resource folders as initial UI-side filing, not ground truth. Use the user brief,
target venue, file names, and file contents to infer whether each resource is ongoing work,
papers, proposal material, data, or miscellaneous context. If a resource appears misclassified,
note the corrected role in PROJECT.md / STATE.md and move or reference it appropriately.

Use the repository instructions:
- read AGENTS.md
- read instructions/COLD_START.md
- read instructions/RESOURCE_INTAKE.md
- read instructions/CONVERSION.md
- read resources/user_input/INITIAL_BRIEF.md
- read resources/user_input/RESOURCE_MANIFEST.md if present
- inspect relevant resource contents under the Content Inspection Gate in `instructions/RESOURCE_INTAKE.md` before making any venue-fit, contribution, evidence, methods, results, manuscript-status, or project-framing claim from them
- if RESOURCE_MANIFEST.md contains inferred resource references, unresolved resources, or ambiguous resources, complete or block Resource Intake before treating those materials as available
- initialize or update PROJECT.md, research_trajectory/STATE.md, the conversion trial, and manuscript/BLUEPRINT.md only as appropriate under the adaptive intake router

Continue until the cold-start state is genuinely reflected in repository files. Be concise in your final response."""


def framing_prompt(payload: dict[str, Any]) -> str:
    brief = str(payload.get("brief", "")).strip()
    target_venue = str(payload.get("targetVenue", "")).strip()
    return f"""Frame this CoAutoResearch project before the full autoresearch loop starts.

User brief:
{brief}

Target venue / audience:
{target_venue or "Not provided"}

{response_language_prompt_section()}

Resource locations to inspect:
- ongoing work: resources/ongoing_work/
- proposals: resources/proposals/
- literature: resources/literature/
- data: resources/data_sources/
- other or mixed materials: resources/other/
- target venue notes: resources/target_venue/

Use the repository instructions and inspect only the files needed to write a useful project frame.

Your task:
- read AGENTS.md
- read instructions/RESOURCE_INTAKE.md
- read instructions/PROJECT_FRAMING.md
- read instructions/COLD_START.md and instructions/CONVERSION.md only as needed
- read resources/user_input/INITIAL_BRIEF.md
- read resources/user_input/RESOURCE_MANIFEST.md if present
- if RESOURCE_MANIFEST.md contains inferred, unresolved, or ambiguous resource clues, run Resource Intake first and do not treat those clues as attached resources until they are filed or explicitly blocked
- inspect attached resource contents under the Content Inspection Gate in `instructions/RESOURCE_INTAKE.md` before making any venue-fit, contribution, evidence, methods, results, manuscript-status, or project-framing claim from them
- write or update PROJECT.md as a concrete, user-reviewable research framing document

Do not launch the full autoresearch loop. Do not create trials yet unless absolutely necessary.
Focus on PROJECT.md: research topic, problem, scope, target venue/audience, likely contribution type,
resources to use, uncertainties, and what would count as a useful result.

When PROJECT.md is ready for human review, stop and summarize briefly."""


def autoresearch_goal_prompt(launch_instruction: str = "", fast_mode: bool = False) -> str:
    instruction = str(launch_instruction or "").strip()
    instruction_section = ""
    if instruction:
        instruction_section = f"""

Additional user instruction for this launch:
{instruction}

Apply this launch instruction when choosing and executing the next research objective, but do not let it weaken the reviewer gate, provenance, or final-pass requirements below."""
    return f"""Start the CoAutoResearch autoresearch process from PROJECT.md. Complete exactly the next coherent trial boundary, update the autoresearch gate, then stop and return control to the UI.

This is after the user-facing framing pass. Do not rerun cold-start framing just to rewrite PROJECT.md.

This is one bounded agent invocation. The CoAutoResearch server owns the outer loop and will inspect the gate after this run to decide whether another trial is needed.
{instruction_section}
{fast_mode_prompt_section(fast_mode)}
{pending_intervention_prompt_section()}
{human_tasks_prompt_section()}

Use the repository instructions:
- read AGENTS.md
- read instructions/EXECUTION_AGENT.md
- read PROJECT.md
- read research_trajectory/STATE.md
- read research_trajectory/CURRENT_FINDINGS.md
- if the next objective depends on user-provided resources, complete the Content Inspection Gate in instructions/RESOURCE_INTAKE.md before using those resources for content-grounded planning, evidence, venue, methods, results, manuscript, or state claims
- read instructions/RESOURCE_SCOUT.md
- read instructions/REVIEWER_SCOPE_ANALYST.md
- read instructions/reviewers/REVIEW_TAXONOMY.md
- read all eight core reviewer instructions under instructions/reviewers/
- read instructions/reviewers/FINAL_GATE_REVIEWER.md
- create or update the `Autoresearch Goal Gate` section in research_trajectory/STATE.md

{resource_scout_prompt_section()}
{reviewer_scope_analyst_prompt_section()}

Run exactly the next autoresearch iteration and maintain the reviewer gate:
1. choose one coherent next research objective;
2. create the next trial under research_trajectory/trials/;
3. write PLAN.md before execution, including `## Resource Scout Brief`;
4. create `reviews/` and write PLAN_REVIEW.md before execution;
5. run Resource Scout work if required: use a real subagent when available, otherwise use the inline Resource Scout fallback, then revise PLAN.md and rerun PLAN_REVIEW.md if scout outputs change planning assumptions;
6. execute primarily in workspace/;
7. write REPORT.md after execution;
8. run Reviewer Scope Analyst work: use a real subagent when available, otherwise use the inline Reviewer Scope Analyst fallback, to decide whether the eight core reviewers cover the current trial's review risks;
9. if the reviewer spawn decision says `Spawn needed: yes`, run the specialized reviewer before core reviewers;
10. refresh all eight current-trial reviewer files after REPORT.md and reviewer-scope analysis: PLAN_REVIEW.md, PROCESS_REVIEW.md, EVIDENCE_REVIEW.md, VENUE_FIT_REVIEW.md, MANUSCRIPT_REVIEW.md, FIGURE_TABLE_REVIEW.md, REFERENCE_REVIEW.md, and FINAL_GATE_REVIEW.md;
11. update STATE.md, CURRENT_FINDINGS.md, manuscript-facing files, or notes only when their current state genuinely changes;
12. update the `Autoresearch Goal Gate` section in research_trajectory/STATE.md with:
   - `Status: pass`, `continue`, `blocked`, or `needs_human`;
   - one line for each required reviewer gate: Plan, Process, Evidence, Venue fit, Manuscript, Figure/table, Reference, Final gate;
   - the current trial reviewer file path on each reviewer gate line;
   - the next action if any gate is not pass;
   - if `Status: blocked` or `Status: needs_human`, `Response to human: <one concise user-facing question or decision request>`.

This invocation is complete after the current trial boundary is closed and the gate is updated, even if the gate remains `continue`, `blocked`, or `needs_human`. Do not start a later trial in this invocation.

Required reviewer gates must all be strict `pass` before the autoresearch goal is complete, including the Final gate reviewer. If any current-trial reviewer file is missing, not pass, or has any blocking issue, required action, unresolved qualification, active revision constraint, or critical unassessed area, set `Status: continue` unless human input is truly required.

Do not treat "approved", "completed", "ready", "plausible", "architecture pass", "supported with qualification", or "targeted revision ready" as pass. Those are partial results unless the relevant reviewer standard and Final gate standard are fully satisfied.

Before any final pass in a manuscript-facing project, run a final synthesis step:
update `manuscript/BLUEPRINT.md`, `research_trajectory/CURRENT_FINDINGS.md`,
and `manuscript/figures/FIGURE_SPECS.md` as needed. The final blueprint must be
self-contained and target-venue-ready in final manuscript reading order:
architecture overview/table of contents, section/subsection architecture, local
claim/evidence/result explanations, inline figure/table/algorithm/dataset/
benchmark/result blocks with captions/content/source/provenance/venue rationale,
and Markdown preview images for image-source figures, reference/literature
grounding, appendix/supplement posture, blocking missing evidence, required
qualifications, provenance/audit index, deprecated ideas, and
submission-readiness summary must all be current. Separate
claim/evidence maps, Figure Plan, Table Plan, or FIGURE_SPECS entries may
support audit only; they do not satisfy final readability by themselves. If
`Blocking Missing Evidence` is non-empty, if an active artifact lacks inline
placement/caption/content/source/provenance/venue rationale, if reviewer
instructions are outdated, or if stale language such as "tentative until
source-level evidence checks are completed" remains, keep `Status: continue`.

Treat PROJECT.md as the current goal definition. If PROJECT.md is insufficient or contradictory, do not silently invent a different project, but also do not stop by default. First try useful non-human work: resource intake, state repair, safe framing cleanup, evidence audit, manuscript cleanup, or a narrow trial that preserves the ambiguity without making unsupported claims. Keep `Status: continue` when any coherent next objective remains. Set `Status: needs_human` and write `Response to human:` only when no coherent next objective can be chosen and no meaningful non-human work remains."""


def compact_chat_history_items(items: Any, limit: int = CHAT_HISTORY_MAX_MESSAGES) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    clean: list[dict[str, str]] = []
    for item in items[-limit:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        text = str(item.get("text") or item.get("content") or "").strip()
        if not text:
            continue
        clean_item: dict[str, Any] = {
            "id": str(item.get("id") or "").strip()[:120],
            "role": role,
            "kind": str(item.get("kind") or "text").strip()[:80],
            "text": text[:8000],
            "created_at": str(item.get("created_at") or "").strip()[:80],
        }
        attachments = item.get("attachments")
        if isinstance(attachments, list):
            clean_attachments: list[dict[str, str]] = []
            for attachment in attachments[:20]:
                if not isinstance(attachment, dict):
                    continue
                name = str(attachment.get("name") or "").strip()[:240]
                path = str(attachment.get("path") or "").strip()[:1000]
                if not name and not path:
                    continue
                clean_attachments.append(
                    {
                        "kind": str(attachment.get("kind") or "attachment").strip()[:80],
                        "name": name,
                        "path": path,
                        "category": str(attachment.get("category") or "").strip()[:80],
                    }
                )
            if clean_attachments:
                clean_item["attachments"] = clean_attachments
        clean.append(clean_item)
    return clean


def chat_history_prompt_section(conversation_history: Any = None) -> str:
    items = compact_chat_history_items(conversation_history)
    if not items:
        return ""
    lines = ["", "Authoritative UI conversation history for this chat turn:", ""]
    for item in items:
        item_id = f" `{item['id']}`" if item.get("id") else ""
        timestamp = f" ({item['created_at']})" if item.get("created_at") else ""
        lines.append(f"{item['role'].upper()}{item_id}{timestamp}:")
        lines.append(item["text"])
        attachments = item.get("attachments") if isinstance(item.get("attachments"), list) else []
        for attachment in attachments:
            label = attachment.get("path") or attachment.get("name") or "attachment"
            lines.append(f"- attachment: {label} ({attachment.get('kind') or 'attachment'}, {attachment.get('category') or 'resource'})")
        lines.append("")
    lines.append("Use this history as the current UI truth for this chat turn.")
    lines.append("")
    return "\n".join(lines)


def resend_prompt_section(resend_context: Any = None) -> str:
    if not isinstance(resend_context, dict):
        return ""
    edited = str(resend_context.get("editedMessageId") or "").strip()
    if not edited:
        return ""
    archived_count = int(resend_context.get("archivedCount") or 0)
    return f"""

Regenerated reply context:
- The user edited an earlier message `{edited}`.
- The UI has archived {archived_count} later message(s) from the visible conversation.
- Treat the supplied conversation history and current user message as authoritative.
- Ignore any stale context from a resumed CLI session that conflicts with this edited linear history.
"""


def queued_chat_prompt_section(queued_messages: Any = None) -> str:
    items = compact_chat_history_items(queued_messages, CHAT_QUEUE_MAX_MESSAGES)
    if not items:
        return ""
    lines = [
        "",
        "Queued user messages sent while autoresearch was running:",
        "",
        "Answer these messages together in order. They were not answered while the autoresearch run was active.",
        "",
    ]
    for item in items:
        item_id = f" `{item['id']}`" if item.get("id") else ""
        timestamp = f" ({item['created_at']})" if item.get("created_at") else ""
        lines.append(f"USER{item_id}{timestamp}:")
        lines.append(item["text"])
        lines.append("")
    return "\n".join(lines)


def response_language_prompt_section() -> str:
    return """
Response language:
- Match the user's latest message's primary language for user-facing final replies and brief progress updates.
- If the latest user message is mostly Chinese, reply in Chinese while preserving technical terms, file paths, code identifiers, titles, and quoted text in their original language.
- If the user explicitly asks for another language, follow that request.
- Do not translate repository artifacts unless the user explicitly asks; keep project files in their established language.
"""


QUESTION_EXPLANATION_PATTERNS = [
    r"\?",
    r"\bwhat\b",
    r"\bwhy\b",
    r"\bhow\b",
    r"\bexplain\b",
    r"\bmeaning\b",
    r"\bmean\b",
    r"\bclarify\b",
    r"什么",
    r"啥",
    r"什么意思",
    r"什么意义",
    r"为啥",
    r"为什么",
    r"怎么理解",
    r"如何理解",
    r"哪[个些]",
    r"吗",
    r"呢",
]

EXPLICIT_MUTATION_PATTERNS = [
    r"\bintervention\b",
    r"\brecord\b",
    r"\bapply\b",
    r"\bimplement\b",
    r"\bupdate\b",
    r"\bchange\b",
    r"\brevise\b",
    r"\brewrite\b",
    r"\bedit\b",
    r"\bfix\b",
    r"\brun\b",
    r"\bstart\b",
    r"\bresume\b",
    r"\bcontinue\b",
    r"记录",
    r"应用",
    r"执行",
    r"更新",
    r"修改",
    r"改成",
    r"改为",
    r"重写",
    r"修复",
    r"继续",
    r"启动",
    r"开始",
    r"跑",
]


def latest_message_is_explanation_request(message: str) -> bool:
    text = str(message or "").strip()
    if not text:
        return False
    if any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in EXPLICIT_MUTATION_PATTERNS):
        return False
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in QUESTION_EXPLANATION_PATTERNS)


def chat_intent_prompt_section(message: str) -> str:
    if not latest_message_is_explanation_request(message):
        return ""
    return """
Latest-message intent hint:
- Treat the latest user message as an ordinary explanation/question, not as a formal human intervention, launch-framing update, or file-edit request.
- Answer the concrete question first and directly. For terms like "what does this table mean?", explain the table's role, content, and why it may or may not be convincing.
- Do not create or update pending intervention files, `PROJECT.md`, manuscript files, or trajectory files for this turn.
- If your answer suggests follow-up research changes, ask whether the user wants those changes recorded after you answer; do not record them proactively.
"""


def chat_research_prompt(
    message: str = "",
    conversation_history: Any = None,
    resend_context: Any = None,
    queued_messages: Any = None,
) -> str:
    extra = message.strip()
    return f"""Respond in CoAutoResearch chat/framing mode. This is not an autoresearch launch.

User message:
{extra or "(No text; attached resources may have been saved by the UI.)"}
{chat_history_prompt_section(conversation_history)}
{resend_prompt_section(resend_context)}
{queued_chat_prompt_section(queued_messages)}
{response_language_prompt_section()}
{chat_intent_prompt_section(extra)}

Hard boundary:
- Do not create, edit, delete, rename, or summarize as newly completed anything under `research_trajectory/trials/`.
- Do not update `research_trajectory/STATE.md`, `research_trajectory/CURRENT_FINDINGS.md`, `research_trajectory/TRAJECTORY.json`, `research_trajectory/NEXT_TRIAL.json`, or `research_trajectory/checkpoints/`.
- Do not create reviewer files, trial reports, manuscript gate files, or mark any trial/gate/reviewer as pass, completed, or current.
- Do not run the autoresearch loop from this chat path. If the user asks to continue research, start autoresearch, run trials, overqualify the work, or otherwise perform the loop, tell them to use the Start/Resume autoresearch controls, and do not modify protected autoresearch artifacts.

Allowed behavior:
- Answer questions from current project files and the supplied UI conversation history.
- Read and follow `instructions/PROJECT_FRAMING.md` when deciding whether to draft, update, or leave `PROJECT.md` unchanged.
- Always form a substantive answer to the user's latest message first, then before sending the final response check whether that planned answer establishes or materially changes the launch frame.
- Before autoresearch starts, if your planned answer chooses or changes the target venue, scope, paper outline, research objective, contribution type, success gate, expected output, constraints, assumptions, exclusions, or other launch framing, update `PROJECT.md` before the final response. If the target venue or audience changes, also update `resources/target_venue/TARGET_VENUE.md`. Do not leave launch-ready framing only in chat.
- After autoresearch starts, revise `PROJECT.md` only under the stricter post-launch rules in `PROJECT_FRAMING.md`.
- If resources were attached or mentioned, follow `instructions/RESOURCE_INTAKE.md` before treating them as project evidence or active inputs for `PROJECT.md`.
- If the answer depends on attached resource content, perform the full-resource pass required by the Content Inspection Gate before making venue-fit, contribution, evidence, methods, results, manuscript-status, or project-framing claims. Reading only `RESOURCE_MANIFEST.md`, listing a symlink, or using a resource name counts as path-level intake only.
- Decide yourself whether the user message is ordinary interaction or a formal human intervention by reading `AGENTS.md` and `instructions/INTERVENTION_PROTOCOL.md`; the server has not classified it for you, except when the Latest-message intent hint above explicitly says the latest message is an ordinary explanation/question.
- Before autoresearch starts, do not create or update human intervention files. Treat venue, scope, outline, objective, contribution, success-gate, constraint, exclusion, and output changes as `PROJECT.md` launch-framing updates instead.
- After autoresearch starts, if the message is a formal human intervention, create or update a pending intervention file under `research_trajectory/human_interventions/` using the protocol's pending-intervention structure, and update `research_trajectory/human_interventions/INDEX.md` and `INDEX.json`.
- If a post-start message clarifies an existing pending intervention, update that same pending intervention instead of creating a new ID. Create a new ID only for a distinct intervention topic.
- The final response must first answer the user's current question or discussion request with substantive analysis. If you updated `PROJECT.md` or other files, report those updates after the answer and briefly explain why they were warranted.
- If you created or updated a pending intervention, end with one concise sentence naming the path, e.g. `Recorded pending intervention: research_trajectory/human_interventions/I0001_topic.md`.
- If you did not create or update a pending intervention, do not mention interventions.
- Do not use a file-update summary such as "Updated PROJECT.md" as a substitute for answering the user's question.
- If resources were attached but you did not inspect their contents, acknowledge only what the UI saved and say that Resource Intake or autoresearch should be launched explicitly before treating them as trial evidence.

Use AGENTS.md for repository conventions, but the boundary above overrides any instruction that would start or continue a trial. Be concise in the final response."""


def plan_research_prompt(
    message: str,
    conversation_history: Any = None,
    revision_plan: str = "",
) -> str:
    extra = message.strip()
    revision_section = ""
    if revision_plan.strip():
        revision_section = f"""
Previous plan to revise:
{revision_plan.strip()}
"""
    return f"""Plan only. Do not implement.

User request:
{extra or "(No text; attached resources may have been saved by the UI.)"}
{chat_history_prompt_section(conversation_history)}
{revision_section}
{response_language_prompt_section()}

Rules:
- Read the project files and supplied conversation context only as needed to produce a concrete plan.
- If the plan depends on attached or linked resource content, inspect the resource contents under the Content Inspection Gate in `instructions/RESOURCE_INTAKE.md` before making content-grounded recommendations. If you only inspect paths, manifest entries, symlinks, filenames, or the user's short description, label the plan as path-level and provisional.
- Do not create, edit, delete, rename, or move any project/repository files.
- Do not update `PROJECT.md`, framing files, manuscript files, resources, trajectory files, trials, reviewer outputs, or runtime state.
- Do not start autoresearch, create trials, run tests, execute setup commands, install dependencies, or make implementation changes.
- If the request is ambiguous or missing decisions, make that explicit in the plan and list the questions or choices the user should decide before approval.
- Produce a concise but actionable Markdown plan with ordered steps, validation, and risks/assumptions where useful.
- The final output must be the plan itself, not a promise to plan or a request to switch modes."""


def approved_plan_prompt(plan: dict[str, Any], instruction: str = "") -> str:
    request = plan.get("request") if isinstance(plan.get("request"), dict) else {}
    plan_text = str(plan.get("plan_text") or "").strip()
    user_request = str(request.get("message") or "").strip()
    extra = str(instruction or "").strip()
    extra_section = f"""

Additional user instruction for implementation:
{extra}
""" if extra else ""
    return f"""Implement the approved plan exactly, using normal CoAutoResearch chat/implementation behavior.

Original user request:
{user_request or "(No original request recorded.)"}

Approved plan:
{plan_text}
{extra_section}
{response_language_prompt_section()}

Implementation rules:
- Treat the approved plan as the user's authorization to make the described changes.
- Keep edits scoped to the approved plan and current project conventions.
- If a step is impossible or unsafe, stop and explain the blocker instead of silently substituting unrelated work.
- Run focused validation when practical and report what changed."""


def continue_research_prompt(message: str = "") -> str:
    extra = message.strip()
    if extra:
        return f"""Continue the active CoAutoResearch project in this same agent session.

User instruction:
{extra}

{response_language_prompt_section()}

Follow AGENTS.md and research_trajectory/STATE.md. If the latest user instruction or RESOURCE_MANIFEST.md contains new resource clues, follow instructions/RESOURCE_INTAKE.md before treating those materials as attached. If the response or next work depends on user-provided resource content, complete the Content Inspection Gate first; path-level intake from the manifest, symlink, filename, or short user description is not enough.

{human_tasks_prompt_section()}

{resource_scout_prompt_section()}
{reviewer_scope_analyst_prompt_section()}

For substantive trial work, follow instructions/EXECUTION_AGENT.md, instructions/RESOURCE_SCOUT.md, and instructions/REVIEWER_SCOPE_ANALYST.md: PLAN.md must include `## Resource Scout Brief`, required scouts use a real Resource Scout subagent when available or the inline Resource Scout fallback when subagent orchestration is unavailable/stalled/failed, the review phase uses a real Reviewer Scope Analyst subagent when available or the inline Reviewer Scope Analyst fallback when needed, and scout-discovered resources remain `autoresearch_discovered` raw inputs until promoted.

If the user is asking a question, asking for an explanation, or asking what the project is about, answer directly from the current project files and do not modify repository files. Only update files when the user explicitly asks for a change, asks you to continue research work, or gives an instruction that requires edits. Report either the answer or what changed."""
    return f"""Continue the next coherent CoAutoResearch iteration in this same agent session.

{response_language_prompt_section()}

Follow AGENTS.md and research_trajectory/STATE.md. If the latest user instruction or RESOURCE_MANIFEST.md contains new resource clues, follow instructions/RESOURCE_INTAKE.md before treating those materials as attached. If the next work depends on user-provided resource content, complete the Content Inspection Gate first; path-level intake from the manifest, symlink, filename, or short user description is not enough.

{human_tasks_prompt_section()}

{resource_scout_prompt_section()}
{reviewer_scope_analyst_prompt_section()}

For substantive trial work, follow instructions/EXECUTION_AGENT.md, instructions/RESOURCE_SCOUT.md, and instructions/REVIEWER_SCOPE_ANALYST.md: PLAN.md must include `## Resource Scout Brief`, required scouts use a real Resource Scout subagent when available or the inline Resource Scout fallback when subagent orchestration is unavailable/stalled/failed, the review phase uses a real Reviewer Scope Analyst subagent when available or the inline Reviewer Scope Analyst fallback when needed, and scout-discovered resources remain `autoresearch_discovered` raw inputs until promoted. Check pending interventions, choose the next coherent objective, execute it, update repository files as needed, and report what changed."""


def resume_from_trial_prompt(
    trial: dict[str, Any],
    user_instruction: str,
    restore_mode: str,
    fork_manifest: str,
    intervention_path: str,
    archived_trials: list[dict[str, str]],
    base_iteration: int,
    next_iteration: int,
) -> str:
    archived_text = "\n".join(f"- `{item['from']}` archived to `{item['to']}`" for item in archived_trials) or "- None"
    best_effort_note = ""
    if restore_mode == "best_effort":
        best_effort_note = """
This selected trial did not have a saved checkpoint. Treat this as a best-effort fork:
- the later active trials have been archived and are no longer current trajectory truth;
- verify STATE.md, CURRENT_FINDINGS.md, manuscript files, and resources before relying on them;
- verify `research_trajectory/HUMAN_TASKS.md` and close or rewrite stale tasks before relying on them;
- if the restored state is inconsistent, repair the project state before creating substantive new claims.
"""
    return f"""Resume the CoAutoResearch autoresearch process from the selected trial boundary. Complete exactly the next coherent trial boundary, update the autoresearch gate, then stop and return control to the UI.

The user confirmed a human-directed fork of the autoresearch trajectory.

Base trial:
- iteration: Trial {base_iteration}
- id: `{trial.get('id', '')}`
- path: `{trial.get('path', '')}`
- report: `{trial.get('report_path', '')}`
- checkpoint: `{trial.get('checkpoint_path', '') or 'none'}`
- restore mode: `{restore_mode}`

Fork records:
- fork manifest: `{fork_manifest}`
- human intervention: `{intervention_path}`

Archived later trials:
{archived_text}

User instruction for the resumed trajectory:
{user_instruction.strip() or "Continue from the selected trial boundary."}

{best_effort_note}
{pending_intervention_prompt_section()}
{human_tasks_prompt_section()}
Read:
- AGENTS.md
- instructions/EXECUTION_AGENT.md
- instructions/INTERVENTION_PROTOCOL.md
- PROJECT.md
- research_trajectory/STATE.md
- research_trajectory/CURRENT_FINDINGS.md
- the base trial PLAN/REVIEW/REPORT files
- instructions/RESOURCE_INTAKE.md, and complete its Content Inspection Gate before using user-provided resource content for content-grounded planning, evidence, venue, methods, results, manuscript, or state claims
- instructions/RESOURCE_SCOUT.md
- instructions/REVIEWER_SCOPE_ANALYST.md
- instructions/reviewers/REVIEW_TAXONOMY.md
- all eight core reviewer instructions under instructions/reviewers/
- instructions/reviewers/FINAL_GATE_REVIEWER.md

{resource_scout_prompt_section()}
{reviewer_scope_analyst_prompt_section()}

Continue autoresearch from the selected base trial boundary. The next active trial is Trial {next_iteration}; create it under `research_trajectory/trials/` using the next active trajectory number after the base trial, even if archived/superseded trials previously had higher numbers. Do not treat archived later trials as active truth. You may consult archived later trials only as superseded context and must say when you do.

Write PLAN.md with `## Resource Scout Brief`, PLAN_REVIEW.md, Resource Scout work via subagent or inline fallback if required, REPORT.md, Reviewer Scope Analyst work via subagent or inline fallback, run any required specialized review, write all eight reviewer files under the current trial `reviews/` directory (PLAN_REVIEW.md, PROCESS_REVIEW.md, EVIDENCE_REVIEW.md, VENUE_FIT_REVIEW.md, MANUSCRIPT_REVIEW.md, FIGURE_TABLE_REVIEW.md, REFERENCE_REVIEW.md, and FINAL_GATE_REVIEW.md), and update the autoresearch gate with those paths. If the gate is `Status: blocked` or `Status: needs_human`, include `Response to human: <one concise user-facing question or decision request>`. This invocation is complete after the Trial {next_iteration} boundary is closed and the gate is updated, even if the gate remains `continue`, `blocked`, or `needs_human`. Do not start a later trial in this invocation."""


def start_resume_from_trial(payload: dict[str, Any], message: str, attachments: dict[str, Any]) -> dict[str, Any]:
    resume_payload = payload.get("resumeFromTrial")
    if not isinstance(resume_payload, dict):
        raise ValueError("Missing resume-from-trial context.")
    if message.strip().startswith("/"):
        raise ValueError("Remove the trial continue context before sending a slash command.")
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        if proc and proc.poll() is None:
            raise ValueError("Wait for the current agent run to finish before continuing from a trial.")
    trial, trials, base_index = resolve_resume_trial(resume_payload)
    fork_sequence, fork_id, fork_root = create_resume_fork_root(trial)
    backup_root = fork_root / "pre_fork_state"
    backup_files = copy_resume_snapshot(backup_root)
    checkpoint_path = REPO_ROOT / str(trial.get("checkpoint_path") or "")
    restore_mode = "checkpoint" if trial.get("checkpoint_exists") and checkpoint_path.exists() else "best_effort"
    archived_trials = archive_later_trials(trials, base_index, fork_root)
    restored_files = restore_snapshot_from(checkpoint_path) if restore_mode == "checkpoint" else []
    trajectory = set_resume_fork_trajectory(trial, fork_id, archived_trials)
    ensure_autoresearch_gate_for_loop()
    intervention_path = write_resume_intervention(
        fork_id,
        fork_sequence,
        trial,
        message,
        attachments,
        restore_mode,
        archived_trials,
    )
    fork_manifest = write_resume_fork_manifest(
        fork_root,
        fork_id,
        fork_sequence,
        trial,
        restore_mode,
        backup_files,
        restored_files,
        archived_trials,
        intervention_path,
        message,
    )
    fork_index = update_resume_forks_index(
        fork_id,
        fork_sequence,
        trial,
        restore_mode,
        fork_manifest,
        intervention_path,
        archived_trials,
        message,
    )
    settings = normalize_research_settings(payload.get("settings"))
    review_checkpoint_interval = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
    base_iteration = int(trial.get("iteration") or trial_iteration_from_id(str(trial.get("id") or "")) or base_index + 1)
    next_iteration = base_iteration + 1
    with RESEARCH_LOCK:
        RESEARCH_SESSION["session_id"] = ""
        RESEARCH_SESSION["loop_iteration"] = base_iteration
        RESEARCH_SESSION["loop_active"] = True
        RESEARCH_SESSION["loop_stop_reason"] = ""
        RESEARCH_SESSION["loop_instruction"] = ""
        RESEARCH_SESSION["settings"] = settings
        RESEARCH_SESSION["loop_max_iterations"] = review_checkpoint_interval
        RESEARCH_SESSION["loop_review_checkpoint_iteration"] = base_iteration + review_checkpoint_interval
    persist_research_session()
    session = start_research_run(
        resume_from_trial_prompt(
            trial,
            message,
            restore_mode,
            fork_manifest,
            intervention_path,
            archived_trials,
            base_iteration,
            next_iteration,
        ),
        "goal",
        resume=False,
        settings_payload=settings,
        display_prompt=f"Continue autoresearch from Trial {base_iteration}.",
        loop_active=True,
        reset_review_checkpoint=True,
        loop_iteration_override=next_iteration,
    )
    return {
        "files": {
            **attachments,
            "resume_fork": {
                "fork_id": fork_id,
                "fork_sequence": fork_sequence,
                "base_trial": trial,
                "restore_mode": restore_mode,
                "fork_manifest": fork_manifest,
                "fork_index": fork_index,
                "intervention_path": intervention_path,
                "archived_trials": archived_trials,
                "restored_files": restored_files,
                "trajectory": trajectory,
            },
        },
        "session": session,
    }


def template_file_text(relative_path: str) -> str:
    for root in [PACKAGE_TEMPLATE_ROOT, DEFAULT_PROJECT_ROOT]:
        if not root:
            continue
        source = Path(root) / relative_path
        if source.exists() and source.is_file():
            return source.read_text(encoding="utf-8", errors="replace")
    return ""


def reset_text_file_from_template(relative_path: str, fallback: str) -> str:
    path = REPO_ROOT / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    text = template_file_text(relative_path) or fallback
    path.write_text(text.rstrip() + "\n", encoding="utf-8")
    return relative_path


def manifest_entry_lines(entries: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for entry in entries:
        text = str(entry.get("text") or "").strip()
        if not text:
            continue
        lines.extend(text.splitlines())
        archived_paths = entry.get("archived_paths") or []
        if isinstance(archived_paths, list):
            for archived in archived_paths:
                if not isinstance(archived, dict):
                    continue
                source = str(archived.get("from") or "").strip()
                destination = str(archived.get("to") or "").strip()
                if source and destination:
                    lines.append(f"  - Archived path: `{source}` -> `{destination}`")
    return lines or ["- <none recorded>"]


def write_restart_resource_manifest(restart_id: str, restart_root: Path, retained_entries: list[dict[str, Any]], inactive_entries: list[dict[str, Any]]) -> str:
    manifest_path = REPO_ROOT / "resources/user_input/RESOURCE_MANIFEST.md"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    archive_manifest = restart_root / "pre_restart_state/resources/user_input/RESOURCE_MANIFEST.md"
    lines = [
        "# Resource Manifest",
        "",
        "This manifest was reset by `Restart autoresearch`.",
        "",
        "## Restart Resource Policy",
        "",
        f"- Restart id: `{restart_id}`",
        f"- Prior manifest snapshot: `{rel_path(archive_manifest)}`" if archive_manifest.exists() else "- Prior manifest snapshot: <none recorded>",
        "- Retained active provenance: `user_explicit`, `user_confirmed`.",
        "- Autoresearch-discovered, autoresearch-generated, and unknown resources are prior-run context after restart; they are not active inputs unless the user explicitly reattaches or confirms them.",
        "",
        "## Retained Active Resources",
        "",
        *manifest_entry_lines(retained_entries),
        "",
        "## Archived Prior-Run Resources",
        "",
        *manifest_entry_lines(inactive_entries),
        "",
        "## Explicit UI Resources",
        "",
        "- See Retained Active Resources above.",
        "",
        "## Inferred Resource References",
        "",
        "- <none recorded after restart>",
        "",
        "## Attached Resources",
        "",
        "- See Retained Active Resources above.",
        "",
        "## Unresolved Or Ambiguous Resources",
        "",
        "- <none recorded after restart>",
        "",
        "## Intake Decisions",
        "",
        "- Restart completed; user-origin resources remain available on disk, but the next run must promote resources through normal intake before treating them as evidence.",
        "",
    ]
    manifest_path.write_text("\n".join(lines), encoding="utf-8")
    return rel_path(manifest_path)


def write_restart_manifest(
    restart_root: Path,
    restart_id: str,
    sequence: int,
    reason: str,
    snapshot_files: list[str],
    runtime_files: list[str],
    moved_paths: list[dict[str, str]],
    reset_files: list[str],
    resource_manifest: str,
    retained_resource_entries: list[dict[str, Any]],
    inactive_resource_entries: list[dict[str, Any]],
) -> str:
    manifest = {
        "schema_version": 1,
        "restart_id": restart_id,
        "restart_sequence": sequence,
        "created_at": now_iso(),
        "reason": reason,
        "resource_policy": {
            "retained": sorted(RESTART_RETAINED_PROVENANCE),
            "archived_or_inactive": sorted(RESOURCE_PROVENANCE_VALUES - RESTART_RETAINED_PROVENANCE),
        },
        "retained_resource_entries": retained_resource_entries,
        "inactive_resource_entries": inactive_resource_entries,
        "snapshot_files": snapshot_files,
        "runtime_files": runtime_files,
        "moved_paths": moved_paths,
        "reset_files": reset_files,
        "resource_manifest": resource_manifest,
    }
    path = restart_root / "restart_manifest.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return rel_path(path)


def restart_autoresearch_prompt(restart_id: str, manifest_path: str, reason: str) -> str:
    return f"""Restart the CoAutoResearch autoresearch process from a clean active trajectory. Complete exactly the first coherent trial boundary, update the autoresearch gate, then stop and return control to the UI.

The user confirmed a full autoresearch restart.

Restart manifest: `{manifest_path}`
Restart id: `{restart_id}`

User restart instruction:
{reason.strip() or "Restart autoresearch from a clean active trajectory."}
{pending_intervention_prompt_section()}
{human_tasks_prompt_section()}

Semantics:
- Treat archived trials, prior runtime state, prior working manuscript revisions, and prior current findings as superseded context.
- Start a new active trajectory at Trial 1 under `research_trajectory/trials/`.
- Use only user-explicit or user-confirmed resources as active inputs. Autoresearch-discovered, autoresearch-generated, or unknown-provenance resources from the previous run require explicit user confirmation before use.
- Rebuild the research plan, reviewer gates, evidence status, target-venue blueprint, figure/table plan, and final gate from the current project brief and retained user inputs.

Read:
- AGENTS.md
- PROJECT.md
- resources/user_input/RESOURCE_MANIFEST.md
- instructions/EXECUTION_AGENT.md
- instructions/RESOURCE_INTAKE.md
- complete the Content Inspection Gate before using retained user-provided resources for content-grounded planning, evidence, venue, methods, results, manuscript, or state claims
- instructions/RESOURCE_SCOUT.md
- instructions/REVIEWER_SCOPE_ANALYST.md
- instructions/MANUSCRIPT.md
- instructions/reviewers/REVIEW_TAXONOMY.md
- all eight core reviewer instructions under instructions/reviewers/

{resource_scout_prompt_section()}
{reviewer_scope_analyst_prompt_section()}

Create Trial 1 under `research_trajectory/trials/`. Write PLAN.md with `## Resource Scout Brief`, PLAN_REVIEW.md, Resource Scout work via subagent or inline fallback if required, REPORT.md, Reviewer Scope Analyst work via subagent or inline fallback, run any required specialized review, write all eight reviewer files under the current trial `reviews/` directory (PLAN_REVIEW.md, PROCESS_REVIEW.md, EVIDENCE_REVIEW.md, VENUE_FIT_REVIEW.md, MANUSCRIPT_REVIEW.md, FIGURE_TABLE_REVIEW.md, REFERENCE_REVIEW.md, and FINAL_GATE_REVIEW.md), and update the autoresearch gate with those paths. If the gate is `Status: blocked` or `Status: needs_human`, include `Response to human: <one concise user-facing question or decision request>`. This invocation is complete after the Trial 1 boundary is closed and the gate is updated, even if the gate remains `continue`, `blocked`, or `needs_human`. Do not start a later trial in this invocation."""


def start_restart_autoresearch(payload: dict[str, Any]) -> dict[str, Any]:
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        if proc and proc.poll() is None:
            raise ValueError("Stop the current agent run before restarting autoresearch.")
    reason = str(payload.get("message", "")).strip()
    sequence, restart_id, restart_root = create_restart_root()
    previous_resource_entries = parse_resource_manifest_entries()
    snapshot_root = restart_root / "pre_restart_state"
    snapshot_files = copy_project_snapshot(RESTART_SNAPSHOT_PATHS, snapshot_root)
    runtime_files = archive_runtime_snapshot(snapshot_root)
    retained_resource_entries, inactive_resource_entries = archive_inactive_resource_entries(restart_root, previous_resource_entries)
    moved_paths: list[dict[str, str]] = []
    moved_paths.extend(move_path_to_archive("research_trajectory/trials", restart_root / "archived_trials"))
    moved_paths.extend(move_path_to_archive("research_trajectory/checkpoints", restart_root / "archived_checkpoints"))
    moved_paths.extend(move_path_to_archive("workspace", restart_root / "archived_workspace"))
    if expected_trial_marker_path().exists():
        expected_trial_marker_path().unlink()
    reset_files = [
        reset_text_file_from_template("research_trajectory/CURRENT_FINDINGS.md", "# Current Findings\n\nRestarted. No current findings have been promoted in the new active trajectory yet.\n"),
        reset_text_file_from_template("research_trajectory/HUMAN_TASKS.md", "# Human Tasks\n\n## Open Tasks\n\n- none\n\n## Closed Tasks\n\n- none\n"),
        reset_text_file_from_template("manuscript/BLUEPRINT.md", "# Manuscript Blueprint\n\nRestarted. The next autoresearch run must rebuild a self-contained target-venue blueprint.\n"),
    ]
    write_initial_autoresearch_gate()
    reset_files.append("research_trajectory/STATE.md")
    trajectory = write_trajectory_state({
        **default_trajectory_state(),
        "active_epoch": "current",
        "fork_id": "",
        "base_trial": "",
        "latest_active_trial": "",
        "next_trial_number": 1,
        "archived_trial_ids": [],
        "last_sync_reason": "restart_autoresearch",
        "restart_id": restart_id,
    })
    reset_files.append("research_trajectory/TRAJECTORY.json")
    resource_manifest = write_restart_resource_manifest(restart_id, restart_root, retained_resource_entries, inactive_resource_entries)
    reset_files.append(resource_manifest)
    manifest_path = write_restart_manifest(
        restart_root,
        restart_id,
        sequence,
        reason,
        snapshot_files,
        runtime_files,
        moved_paths,
        reset_files,
        resource_manifest,
        retained_resource_entries,
        inactive_resource_entries,
    )
    settings = normalize_research_settings(payload.get("settings"))
    review_checkpoint_interval = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
    with RESEARCH_LOCK:
        RESEARCH_SESSION["session_id"] = ""
        RESEARCH_SESSION["loop_iteration"] = 0
        RESEARCH_SESSION["loop_active"] = True
        RESEARCH_SESSION["loop_stop_reason"] = ""
        RESEARCH_SESSION["settings"] = settings
        RESEARCH_SESSION["loop_max_iterations"] = review_checkpoint_interval
        RESEARCH_SESSION["loop_review_checkpoint_iteration"] = review_checkpoint_interval
    persist_research_session()
    ensure_autoresearch_gate_for_loop()
    session = start_research_run(
        restart_autoresearch_prompt(restart_id, manifest_path, reason),
        "goal",
        resume=False,
        settings_payload=settings,
        display_prompt="Restart autoresearch.",
        loop_active=True,
        reset_review_checkpoint=True,
        loop_iteration_override=1,
    )
    return {
        "files": {
            "restart": {
                "restart_id": restart_id,
                "restart_sequence": sequence,
                "restart_manifest": manifest_path,
                "snapshot_files": snapshot_files,
                "runtime_files": runtime_files,
                "moved_paths": moved_paths,
                "reset_files": reset_files,
                "trajectory": trajectory,
            }
        },
        "session": session,
    }


def start_research_framing(payload: dict[str, Any]) -> dict[str, Any]:
    if has_autoresearch_context():
        raise ValueError(
            "This project already has autoresearch history. Edit/resend should use chat; framing cannot be restarted for an active trajectory."
        )
    payload = prepare_payload_resources(dict(payload), payload_resource_texts(payload))
    file_edits = payload.get("fileEdits", [])
    saved_edits = []
    if isinstance(file_edits, list):
        for item in file_edits:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path", "")).strip()
            if path and path != "PROJECT.md":
                saved_edits.append(write_text_file(path, str(item.get("text", ""))))
    saved_files = save_uploads(payload)
    linked_resources = save_resource_links(payload)
    result = {
        "saved_files": saved_files,
        "resource_links": linked_resources,
        "resource_clues": payload.get("_resourceResolution", []),
        "metadata_files": write_ui_metadata(payload, saved_files, linked_resources),
        "file_edits": [item["path"] for item in saved_edits],
    }
    settings = normalize_research_settings(payload.get("settings"))
    with RESEARCH_LOCK:
        resume = should_resume_research_session(settings)
    session = start_research_run(
        framing_prompt(payload),
        "framing",
        resume=resume,
        settings_payload=settings,
        display_prompt=str(payload.get("brief", "")).strip() or None,
    )
    return {"files": result, "session": session}


def start_research_cold_start(payload: dict[str, Any]) -> dict[str, Any]:
    payload = prepare_payload_resources(dict(payload), payload_resource_texts(payload))
    if payload.get("confirmLaunch") is not True:
        raise ValueError("Launch must be confirmed from Step 2 before starting the agent.")
    payload["runConversion"] = False
    file_edits = payload.get("fileEdits", [])
    saved_edits = []
    if isinstance(file_edits, list) and file_edits:
        for item in file_edits:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path", "")).strip()
            if not path:
                continue
            saved_edits.append(write_text_file(path, str(item.get("text", ""))))
        saved_files = save_uploads(payload)
        linked_resources = save_resource_links(payload)
        result = {
            "saved_files": saved_files,
            "resource_links": linked_resources,
            "resource_clues": payload.get("_resourceResolution", []),
            "metadata_files": write_ui_metadata(payload, saved_files, linked_resources),
            "file_edits": [item["path"] for item in saved_edits],
        }
    else:
        result = write_cold_start(payload)
    settings = normalize_research_settings(payload.get("settings"))
    with RESEARCH_LOCK:
        resume = should_resume_research_session(settings)
        RESEARCH_SESSION["loop_iteration"] = 0
        RESEARCH_SESSION["loop_max_iterations"] = AUTORESEARCH_MAX_ITERATIONS
        RESEARCH_SESSION["loop_review_checkpoint_iteration"] = 0
        RESEARCH_SESSION["loop_stop_reason"] = ""
        RESEARCH_SESSION["loop_instruction"] = ""
    ensure_autoresearch_gate_for_loop()
    session = start_research_run(
        autoresearch_goal_prompt(str(payload.get("launchInstruction", ""))[:4000], bool(settings.get("fastMode"))),
        "goal",
        resume=resume,
        settings_payload=settings,
        display_prompt="Start autoresearch loop.",
        loop_active=True,
        reset_review_checkpoint=True,
    )
    return {"files": result, "session": session}


def start_research_go(payload: dict[str, Any]) -> dict[str, Any]:
    payload = prepare_payload_resources(dict(payload), payload_resource_texts(payload))
    message = str(payload.get("message", "")).strip()
    display = message or "Continue autoresearch."
    settings = normalize_research_settings(payload.get("settings"))
    return {
        "session": start_research_run(
            continue_research_prompt(message),
            "research",
            resume=should_resume_research_session(settings),
            settings_payload=settings,
            display_prompt=display,
        )
    }


def retained_attachments_from_payload(payload: dict[str, Any]) -> list[dict[str, str]]:
    items = payload.get("retainedAttachments", [])
    if not isinstance(items, list):
        return []
    retained: list[dict[str, str]] = []
    for item in items[:30]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:240]
        path = str(item.get("path") or "").strip()[:1000]
        kind = str(item.get("kind") or "attachment").strip()[:80]
        category = str(item.get("category") or "").strip()[:80]
        if not name and not path:
            continue
        retained.append({"name": name, "path": path, "kind": kind, "category": category})
    return retained


def attach_message_resources(payload: dict[str, Any], message: str) -> tuple[str, dict[str, Any]]:
    payload = prepare_payload_resources(dict(payload), payload_resource_texts(payload, message))
    target_venue = str(payload.get("targetVenue", "")).strip()
    saved_files = save_uploads(payload)
    linked_resources = save_resource_links(payload)
    retained_attachments = retained_attachments_from_payload(payload)
    metadata_files = write_ui_metadata(payload, saved_files, linked_resources)
    resolutions = payload.get("_resourceResolution", [])
    if not saved_files and not linked_resources and not retained_attachments and not resolutions and not metadata_files:
        return message, {"saved_files": [], "resource_links": [], "retained_attachments": [], "metadata_files": []}
    lines = ["", "", "Resource handling for this message:"]
    if target_venue:
        lines.append(f"- target venue / audience: {target_venue}")
    for path in saved_files:
        lines.append(f"- uploaded file: {path}")
    for item in linked_resources:
        lines.append(f"- {item.get('mode', 'linked')} {item.get('category', 'resource')}: {item.get('path')} (source: {item.get('source')})")
    for item in retained_attachments:
        label = item.get("path") or item.get("name") or "attachment"
        lines.append(f"- retained prior {item.get('kind') or 'attachment'}: {label} ({item.get('category') or 'resource'})")
    if isinstance(resolutions, list):
        for item in resolutions:
            if not isinstance(item, dict):
                continue
            reference = str(item.get("reference", "")).strip()
            status = str(item.get("status", "")).strip()
            path = str(item.get("path", "")).strip()
            candidates = item.get("candidates", [])
            if path:
                lines.append(f"- inferred resource clue `{reference}` has candidate `{path}`; run Resource Intake before treating it as attached")
            elif isinstance(candidates, list) and candidates:
                lines.append(f"- typed reference `{reference}` was ambiguous; inspect RESOURCE_MANIFEST.md")
            elif reference:
                lines.append(f"- typed reference `{reference}` was not found; inspect RESOURCE_MANIFEST.md")
    for path in metadata_files:
        lines.append(f"- resource manifest updated: {path}")
    return f"{message}{chr(10).join(lines)}", {
        "saved_files": saved_files,
        "resource_links": linked_resources,
        "retained_attachments": retained_attachments,
        "resource_clues": resolutions if isinstance(resolutions, list) else [],
        "metadata_files": metadata_files,
    }


def message_with_attachment_summary(message: str, attachments: dict[str, Any]) -> str:
    if not isinstance(attachments, dict):
        return message
    saved_files = [str(path) for path in attachments.get("saved_files", []) if str(path).strip()] if isinstance(attachments.get("saved_files"), list) else []
    linked_resources = [item for item in attachments.get("resource_links", []) if isinstance(item, dict)] if isinstance(attachments.get("resource_links"), list) else []
    retained_attachments = [item for item in attachments.get("retained_attachments", []) if isinstance(item, dict)] if isinstance(attachments.get("retained_attachments"), list) else []
    resolutions = [item for item in attachments.get("resource_clues", []) if isinstance(item, dict)] if isinstance(attachments.get("resource_clues"), list) else []
    metadata_files = [str(path) for path in attachments.get("metadata_files", []) if str(path).strip()] if isinstance(attachments.get("metadata_files"), list) else []
    if not saved_files and not linked_resources and not retained_attachments and not resolutions and not metadata_files:
        return message
    lines = ["", "", "Resource handling for this message:"]
    for path in saved_files:
        lines.append(f"- uploaded file: {path}")
    for item in linked_resources:
        lines.append(f"- {item.get('mode', 'linked')} {item.get('category', 'resource')}: {item.get('path')} (source: {item.get('source')})")
    for item in retained_attachments:
        label = item.get("path") or item.get("name") or "attachment"
        lines.append(f"- retained prior {item.get('kind') or 'attachment'}: {label} ({item.get('category') or 'resource'})")
    for item in resolutions:
        reference = str(item.get("reference", "")).strip()
        path = str(item.get("path", "")).strip()
        candidates = item.get("candidates", [])
        if path:
            lines.append(f"- inferred resource clue `{reference}` has candidate `{path}`; run Resource Intake before treating it as attached")
        elif isinstance(candidates, list) and candidates:
            lines.append(f"- typed reference `{reference}` was ambiguous; inspect RESOURCE_MANIFEST.md")
        elif reference:
            lines.append(f"- typed reference `{reference}` was not found; inspect RESOURCE_MANIFEST.md")
    for path in metadata_files:
        lines.append(f"- resource manifest updated: {path}")
    return f"{message}{chr(10).join(lines)}"


def normalize_queued_chat_priority(value: Any = "") -> str:
    priority = str(value or "").strip().lower()
    return "send_after_stop" if priority == "send_after_stop" else "normal"


def queued_chat_settings_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    raw_settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else {}
    if raw_settings:
        return normalize_research_settings(raw_settings)
    session_settings = RESEARCH_SESSION.get("settings") if isinstance(RESEARCH_SESSION.get("settings"), dict) else {}
    if session_settings:
        return normalize_research_settings(session_settings)
    return normalize_research_settings({})


def normalize_queued_chat_message(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    text = str(item.get("text") or item.get("display_message") or item.get("prepared_message") or "").strip()
    prepared = str(item.get("prepared_message") or item.get("message") or text).strip()
    if not text and not prepared:
        return None
    created_at = str(item.get("created_at") or "").strip()
    updated_at = str(item.get("updated_at") or created_at).strip()
    item_id = str(item.get("id") or item.get("clientMessageId") or item.get("client_message_id") or "").strip()[:120]
    if not item_id:
        seed = json.dumps(
            {
                "text": text,
                "prepared_message": prepared,
                "created_at": created_at,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        item_id = f"queued_{hashlib.sha1(seed.encode('utf-8')).hexdigest()[:16]}"
    raw_settings = item.get("settings") if isinstance(item.get("settings"), dict) else {}
    conversation_history = item.get("conversation_history") if isinstance(item.get("conversation_history"), list) else item.get("conversationHistory")
    if not isinstance(conversation_history, list):
        conversation_history = []
    client_attachments = item.get("client_attachments") if isinstance(item.get("client_attachments"), list) else item.get("clientAttachments")
    if not isinstance(client_attachments, list):
        client_attachments = []
    attachments = item.get("attachments") if isinstance(item.get("attachments"), dict) else {}
    return {
        "id": item_id,
        "role": "user",
        "kind": "chat",
        "text": text or prepared or "Attached resources.",
        "prepared_message": prepared or text or "Attached resources.",
        "attachments": attachments,
        "client_attachments": [entry for entry in client_attachments if isinstance(entry, dict)],
        "conversation_history": [entry for entry in conversation_history if isinstance(entry, dict)][-80:],
        "created_at": created_at,
        "updated_at": updated_at,
        "settings": normalize_research_settings(raw_settings) if raw_settings else {},
        "priority": normalize_queued_chat_priority(item.get("priority")),
        "status": "queued",
    }


def sorted_queued_chat_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    priority = [item for item in messages if normalize_queued_chat_priority(item.get("priority")) == "send_after_stop"]
    normal = [item for item in messages if normalize_queued_chat_priority(item.get("priority")) != "send_after_stop"]
    return [*priority, *normal]


def public_queued_chat_item(item: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_queued_chat_message(item) or {}
    return {
        "id": normalized.get("id", ""),
        "role": "user",
        "kind": "chat",
        "text": normalized.get("text", ""),
        "attachments": normalized.get("attachments", {}),
        "client_attachments": normalized.get("client_attachments", []),
        "created_at": normalized.get("created_at", ""),
        "updated_at": normalized.get("updated_at", ""),
        "priority": normalize_queued_chat_priority(normalized.get("priority")),
        "status": "queued",
    }


def read_queued_chat_messages() -> list[dict[str, Any]]:
    path = queued_chat_messages_path()
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    items = payload.get("messages") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return []
    normalized = [normalize_queued_chat_message(item) for item in items]
    messages = [item for item in normalized if item]
    seen: dict[str, int] = {}
    unique: list[dict[str, Any]] = []
    for index, item in enumerate(messages):
        base_id = str(item.get("id") or f"queued_{index + 1}").strip()
        count = seen.get(base_id, 0)
        seen[base_id] = count + 1
        if count:
            suffix = hashlib.sha1(f"{base_id}:{index}".encode("utf-8")).hexdigest()[:8]
            item = {**item, "id": f"{base_id[:110]}_{suffix}"}
        unique.append(item)
    return unique


def write_queued_chat_messages(messages: list[dict[str, Any]]) -> None:
    path = queued_chat_messages_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized = [normalize_queued_chat_message(item) for item in messages]
    compact = [item for item in normalized if item][-CHAT_QUEUE_MAX_MESSAGES:]
    path.write_text(json.dumps({"schema_version": 2, "messages": compact}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def queued_chat_summary() -> dict[str, Any]:
    messages = read_queued_chat_messages()
    latest = ""
    if messages:
        latest = str(messages[-1].get("created_at") or "")
    ordered = sorted_queued_chat_messages(messages)
    return {
        "queued_chat_count": len(messages),
        "queued_chat_latest_at": latest,
        "queued_chat_after_current_run": bool(messages),
        "queued_chat_items": [public_queued_chat_item(item) for item in ordered],
    }


def enqueue_chat_message(display_message: str, prepared_message: str, attachments: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    messages = read_queued_chat_messages()
    now = now_iso()
    entry = {
        "id": str(payload.get("clientMessageId") or payload.get("client_message_id") or f"queued_{now_id()}").strip()[:120],
        "role": "user",
        "kind": "chat",
        "text": display_message or prepared_message or "Attached resources.",
        "prepared_message": prepared_message,
        "attachments": attachments if isinstance(attachments, dict) else {},
        "client_attachments": payload.get("clientAttachments") if isinstance(payload.get("clientAttachments"), list) else [],
        "conversation_history": payload.get("conversationHistory") if isinstance(payload.get("conversationHistory"), list) else [],
        "created_at": now,
        "updated_at": now,
        "settings": queued_chat_settings_from_payload(payload),
        "priority": normalize_queued_chat_priority(payload.get("priority") or payload.get("queuePriority")),
        "status": "queued",
    }
    entry = normalize_queued_chat_message(entry) or entry
    messages.append(entry)
    write_queued_chat_messages(messages)
    append_research_log(f"Queued chat message for reply after the current autoresearch run: {entry['text'][:180]}")
    return {"queued": True, "count": len(messages), "run_after_current": True, "latest_at": entry["created_at"], "item": public_queued_chat_item(entry)}


def archive_queued_chat_messages(messages: list[dict[str, Any]], reason: str) -> str:
    if not messages:
        return ""
    root = RUNTIME_DIR / "queued_chat_archive"
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{now_id()}_{slugify(reason, 'queued_chat')}.json"
    payload = {"schema_version": 1, "reason": reason, "archived_at": now_iso(), "messages": messages}
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return str(path.relative_to(RUNTIME_DIR))


def clear_queued_chat_messages() -> None:
    path = queued_chat_messages_path()
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def queue_response_payload() -> dict[str, Any]:
    return {"ok": True, **queued_chat_summary()}


def append_started_queued_chat_framing_message(item: dict[str, Any]) -> dict[str, Any] | None:
    normalized = normalize_queued_chat_message(item)
    if not normalized:
        return None
    message_id = str(normalized.get("id") or f"queued_{now_id()}").strip()[:120]
    messages = load_framing_messages()
    if any(str(message.get("id") or "") == message_id for message in messages):
        return None
    message = sanitize_framing_message(
        {
            "id": message_id,
            "role": "user",
            "kind": "text",
            "text": str(normalized.get("text") or normalized.get("prepared_message") or "Queued chat message.").strip(),
            "created_at": now_iso(),
            "attachments": normalized.get("client_attachments") if isinstance(normalized.get("client_attachments"), list) else [],
        }
    )
    if not message:
        return None
    save_framing_messages([*messages, message])
    return message


def start_queued_chat_item(item: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_queued_chat_message(item)
    if not normalized:
        raise ValueError("Queued chat item is invalid.")
    raw_settings = normalized.get("settings") if isinstance(normalized.get("settings"), dict) else {}
    session_settings = RESEARCH_SESSION.get("settings") if isinstance(RESEARCH_SESSION.get("settings"), dict) else {}
    settings = normalize_research_settings(raw_settings or session_settings)
    with RESEARCH_LOCK:
        RESEARCH_SESSION["loop_active"] = False
        RESEARCH_SESSION["loop_stop_reason"] = "queued_chat_after_current_run"
    persist_research_session()
    message = str(normalized.get("prepared_message") or normalized.get("text") or "").strip()
    display = str(normalized.get("text") or message or "Queued chat message.").strip()
    return start_research_run(
        chat_research_prompt(
            message or "Queued chat message.",
            conversation_history=normalized.get("conversation_history"),
        ),
        "chat",
        resume=should_resume_research_session(settings),
        settings_payload=settings,
        display_prompt=display,
        loop_active=False,
    )


def dispatch_next_queued_chat() -> dict[str, Any]:
    running, _mode = active_process_mode()
    if running:
        return {"started": False, "reason": "active_run", **queued_chat_summary()}
    messages = read_queued_chat_messages()
    if not messages:
        return {"started": False, "reason": "empty", **queued_chat_summary()}
    ordered = sorted_queued_chat_messages(messages)
    item = ordered[0]
    try:
        session = start_queued_chat_item(item)
    except Exception as exc:
        append_research_log(f"Queued chat could not start: {exc}")
        return {"started": False, "reason": "error", "error": str(exc), **queued_chat_summary()}
    if str(session.get("status") or "").lower() != "running":
        append_research_log("Queued chat did not enter running state; keeping queue item pending.")
        return {"started": False, "reason": "not_running", "session": session, **queued_chat_summary()}
    try:
        append_started_queued_chat_framing_message(item)
    except Exception as exc:
        append_research_log(f"Queued chat started but could not be persisted in the conversation: {exc}")
    remaining = [entry for entry in messages if str(entry.get("id") or "") != str(item.get("id") or "")]
    write_queued_chat_messages(remaining)
    archive_path = archive_queued_chat_messages([item], "started_queued_chat")
    append_research_log(
        f"Started queued chat reply; archived queue item: {archive_path or 'none'}"
    )
    return {"started": True, "item": public_queued_chat_item(item), "session": session, **queued_chat_summary()}


def enqueue_research_queue_item(payload: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("message", "")).strip()
    if message.startswith("/"):
        raise ValueError("Slash commands cannot be queued in v1.")
    if isinstance(payload.get("resumeFromTrial"), dict):
        raise ValueError("Continue-from-trial messages cannot be queued in v1.")
    display_message = str(payload.get("displayMessage") or message).strip()
    prepared_message, attachments = attach_message_resources(payload, message)
    if not display_message and any(attachments.get(key) for key in ("saved_files", "resource_links", "resource_clues", "metadata_files")):
        display_message = "Attached resources."
    if not display_message and not prepared_message:
        raise ValueError("Queued message is required.")
    queued = enqueue_chat_message(display_message, prepared_message, attachments, payload)
    return {"files": {**attachments, "queued_chat": queued}, "session": research_session_snapshot(), **queued_chat_summary()}


def update_research_queue_item(payload: dict[str, Any]) -> dict[str, Any]:
    item_id = str(payload.get("id") or "").strip()
    if not item_id:
        raise ValueError("Queued message id is required.")
    messages = read_queued_chat_messages()
    found = False
    updated: dict[str, Any] | None = None
    next_messages: list[dict[str, Any]] = []
    for item in messages:
        if str(item.get("id") or "") != item_id:
            next_messages.append(item)
            continue
        found = True
        text = str(payload.get("text") if "text" in payload else item.get("text") or "").strip()
        if not text:
            raise ValueError("Queued message text is required.")
        updated = {
            **item,
            "text": text,
            "prepared_message": message_with_attachment_summary(text, item.get("attachments") if isinstance(item.get("attachments"), dict) else {}),
            "updated_at": now_iso(),
        }
        next_messages.append(updated)
    if not found:
        raise ValueError("Queued message was not found.")
    write_queued_chat_messages(next_messages)
    return {"item": public_queued_chat_item(updated or {}), **queued_chat_summary()}


def reorder_research_queue(payload: dict[str, Any]) -> dict[str, Any]:
    raw_ids = payload.get("ids")
    if not isinstance(raw_ids, list):
        raise ValueError("Queued message ids are required.")
    ids = [str(item or "").strip() for item in raw_ids if str(item or "").strip()]
    messages = read_queued_chat_messages()
    by_id = {str(item.get("id") or ""): item for item in messages}
    ordered: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item_id in ids:
        if item_id in by_id and item_id not in seen:
            ordered.append(by_id[item_id])
            seen.add(item_id)
    ordered.extend(item for item in messages if str(item.get("id") or "") not in seen)
    write_queued_chat_messages(ordered)
    return queued_chat_summary()


def delete_research_queue_item(payload: dict[str, Any]) -> dict[str, Any]:
    item_id = str(payload.get("id") or "").strip()
    if not item_id:
        raise ValueError("Queued message id is required.")
    messages = read_queued_chat_messages()
    remaining = [item for item in messages if str(item.get("id") or "") != item_id]
    if len(remaining) == len(messages):
        raise ValueError("Queued message was not found.")
    write_queued_chat_messages(remaining)
    return queued_chat_summary()


def archive_resend_context(resend_context: Any) -> str:
    if not isinstance(resend_context, dict):
        return ""
    archived = resend_context.get("archivedMessages")
    if not isinstance(archived, list) or not archived:
        return ""
    root = resend_archive_root()
    root.mkdir(parents=True, exist_ok=True)
    edited = slugify(str(resend_context.get("editedMessageId") or "edited"), "edited")
    path = root / f"{now_id()}_{edited}.json"
    payload = {
        "schema_version": 1,
        "archived_at": now_iso(),
        "edited_message_id": str(resend_context.get("editedMessageId") or ""),
        "archived_count": int(resend_context.get("archivedCount") or len(archived)),
        "messages": compact_chat_history_items(archived, 200),
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return str(path.relative_to(RUNTIME_DIR))


def active_process_mode() -> tuple[bool, str]:
    reconcile_research_process_state()
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        status = str(RESEARCH_SESSION.get("status") or "")
        running = bool(proc and proc.poll() is None) or session_startup_without_process(status, RESEARCH_SESSION.get("started_at"))
        mode = str(RESEARCH_SESSION.get("mode") or "").strip().lower()
    return running, mode


def plan_runtime_dir() -> Path:
    path = RUNTIME_DIR / "plans"
    path.mkdir(parents=True, exist_ok=True)
    return path


def normalize_plan_id(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", text)[:120]


def plan_artifact_path(plan_id: str) -> Path:
    clean_id = normalize_plan_id(plan_id)
    if not clean_id:
        raise ValueError("Plan id is required.")
    return plan_runtime_dir() / f"{clean_id}.json"


def public_plan_artifact(artifact: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(artifact, dict):
        return {}
    request = artifact.get("request") if isinstance(artifact.get("request"), dict) else {}
    return {
        "schema_version": int(artifact.get("schema_version") or PLAN_ARTIFACT_SCHEMA_VERSION),
        "id": str(artifact.get("id") or ""),
        "provider": normalize_agent_backend(artifact.get("provider")),
        "model": str(artifact.get("model") or ""),
        "status": str(artifact.get("status") or "pending"),
        "request": {
            "message": str(request.get("message") or ""),
            "display_message": str(request.get("display_message") or request.get("message") or ""),
            "attachments": request.get("attachments") if isinstance(request.get("attachments"), dict) else {},
            "revision_of": str(request.get("revision_of") or ""),
        },
        "plan_text": str(artifact.get("plan_text") or ""),
        "steps": artifact.get("steps") if isinstance(artifact.get("steps"), list) else [],
        "explanation": str(artifact.get("explanation") or ""),
        "thread_id": str(artifact.get("thread_id") or ""),
        "session_id": str(artifact.get("session_id") or ""),
        "created_at": str(artifact.get("created_at") or ""),
        "updated_at": str(artifact.get("updated_at") or ""),
        "approved_at": str(artifact.get("approved_at") or ""),
        "implemented_run_id": str(artifact.get("implemented_run_id") or ""),
        "error": str(artifact.get("error") or ""),
    }


def read_plan_artifact(plan_id: str) -> dict[str, Any]:
    path = plan_artifact_path(plan_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"Plan not found: {plan_id}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Plan artifact is invalid: {plan_id}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"Plan artifact is invalid: {plan_id}")
    return payload


def write_plan_artifact(artifact: dict[str, Any]) -> dict[str, Any]:
    plan_id = normalize_plan_id(artifact.get("id"))
    if not plan_id:
        raise ValueError("Plan id is required.")
    clean = dict(artifact)
    clean["schema_version"] = int(clean.get("schema_version") or PLAN_ARTIFACT_SCHEMA_VERSION)
    clean["id"] = plan_id
    clean["updated_at"] = now_iso()
    path = plan_artifact_path(plan_id)
    tmp_path = path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(clean, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)
    return clean


def update_plan_artifact(plan_id: str, **updates: Any) -> dict[str, Any]:
    try:
        artifact = read_plan_artifact(plan_id)
    except ValueError:
        artifact = {"schema_version": PLAN_ARTIFACT_SCHEMA_VERSION, "id": normalize_plan_id(plan_id), "created_at": now_iso()}
    artifact.update(updates)
    return write_plan_artifact(artifact)


def latest_plan_artifact() -> dict[str, Any]:
    try:
        files = sorted(plan_runtime_dir().glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    except OSError:
        return {}
    for path in files:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            return public_plan_artifact(payload)
    return {}


def create_plan_artifact(
    provider: str,
    settings: dict[str, Any],
    message: str,
    display_message: str,
    attachments: dict[str, Any],
    revision_of: str = "",
) -> dict[str, Any]:
    plan_id = f"P{now_id()}_{slugify(message[:48] or 'plan', 'plan')}"
    artifact = {
        "schema_version": PLAN_ARTIFACT_SCHEMA_VERSION,
        "id": plan_id,
        "provider": normalize_agent_backend(provider),
        "model": str(settings.get("model") or ""),
        "status": "pending",
        "request": {
            "message": message,
            "display_message": display_message,
            "attachments": attachments,
            "revision_of": revision_of,
        },
        "plan_text": "",
        "steps": [],
        "explanation": "",
        "thread_id": "",
        "session_id": "",
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "approved_at": "",
        "implemented_run_id": "",
        "error": "",
    }
    return write_plan_artifact(artifact)


def append_plan_transcript(artifact: dict[str, Any]) -> None:
    public = public_plan_artifact(artifact)
    if not public.get("id"):
        return
    event_entry: dict[str, Any] | None = None
    with RESEARCH_LOCK:
        existing_index = -1
        for index, item in enumerate(RESEARCH_SESSION.get("transcript", [])):
            if item.get("kind") == "plan" and item.get("artifact", {}).get("id") == public["id"]:
                existing_index = index
                break
        entry = transcript_entry(
            "assistant",
            "plan",
            "Plan",
            public.get("plan_text") or public.get("error") or "Planning...",
            "ui.plan.artifact",
            False,
        )
        entry["artifact"] = public
        if existing_index >= 0:
            entry["id"] = RESEARCH_SESSION["transcript"][existing_index].get("id") or entry["id"]
            RESEARCH_SESSION["transcript"][existing_index] = {**RESEARCH_SESSION["transcript"][existing_index], **entry}
            event_entry = dict(RESEARCH_SESSION["transcript"][existing_index])
        else:
            RESEARCH_SESSION["transcript"].append(entry)
            event_entry = dict(entry)
        RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
        session_patch = research_event_session_patch()
    persist_research_session()
    if event_entry:
        emit_research_event("transcript", {"session_patch": session_patch, "transcript_entry": event_entry})


def mark_plan_artifact_failed(plan_id: str, error: str) -> dict[str, Any]:
    artifact = update_plan_artifact(plan_id, status="failed", error=str(error or "Plan run failed."))
    append_plan_transcript(artifact)
    return artifact


def start_research_chat(payload: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("message", "")).strip()
    if isinstance(payload.get("resumeFromTrial"), dict):
        raise ValueError("Use the resume-from-trial endpoint for confirmed trial forks.")
    if message.startswith("/"):
        return start_research_command({"command": message, "settings": payload.get("settings")})
    display_message = message
    message, attachments = attach_message_resources(payload, message)
    if not display_message and any(attachments.get(key) for key in ("saved_files", "resource_links", "resource_clues", "metadata_files")):
        display_message = "Attached resources."
    running, _mode = active_process_mode()
    if running:
        queued = enqueue_chat_message(display_message, message, attachments, payload)
        return {"files": {**attachments, "queued_chat": queued}, "session": research_session_snapshot()}
    resend_context = payload.get("resendContext") if isinstance(payload.get("resendContext"), dict) else {}
    archive_resend_context(resend_context)
    force_fresh = bool(resend_context.get("forceFreshSession"))
    conversation_history = payload.get("conversationHistory") if isinstance(payload.get("conversationHistory"), list) else []
    return {
        "files": attachments,
        "session": start_research_run(
            chat_research_prompt(
                message,
                conversation_history=conversation_history,
                resend_context=resend_context,
            ),
            "chat",
            resume=False if force_fresh else should_resume_research_session(payload.get("settings")),
            settings_payload=payload.get("settings"),
            display_prompt=display_message,
        ),
    }


def implementation_settings_from_payload(raw: Any) -> dict[str, Any]:
    settings = normalize_research_settings(raw)
    backend = normalize_agent_backend(settings.get("backend"))
    if backend == "claude":
        preset = infer_claude_permission_preset(settings)
        if preset == "plan" or str(settings.get("permissionMode") or "") == "plan":
            settings = normalize_claude_settings({**settings, "permissionPreset": "default", "permissionMode": "default"}, settings)
            settings["backend"] = "claude"
    return settings


def start_research_plan(payload: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("message", "")).strip()
    if message.startswith("/plan"):
        message = re.sub(r"^/plan\b", "", message, count=1, flags=re.IGNORECASE).strip()
    if message.startswith("/"):
        raise ValueError("Plan mode only accepts ordinary planning requests; send slash commands in Chat mode.")
    if isinstance(payload.get("resumeFromTrial"), dict):
        raise ValueError("Plan mode cannot continue from a trial. Use Chat mode for confirmed trial forks.")
    display_message = message
    message, attachments = attach_message_resources(payload, message)
    if not display_message and any(attachments.get(key) for key in ("saved_files", "resource_links", "resource_clues", "metadata_files")):
        display_message = "Plan with attached resources."
    if not display_message.strip() and not message.strip():
        raise ValueError("Plan request is required.")
    running, _mode = active_process_mode()
    if running:
        raise ValueError("Wait for the current agent run to finish before starting a plan.")
    settings = normalize_research_settings(payload.get("settings"))
    backend = normalize_agent_backend(settings.get("backend"))
    revision_of = normalize_plan_id(payload.get("revisePlanId"))
    revision_plan = ""
    if revision_of:
        try:
            prior = read_plan_artifact(revision_of)
            revision_plan = str(prior.get("plan_text") or "").strip()
        except ValueError:
            revision_plan = ""
    conversation_history = payload.get("conversationHistory") if isinstance(payload.get("conversationHistory"), list) else []
    artifact = create_plan_artifact(backend, settings, message, display_message, attachments, revision_of=revision_of)
    prompt = plan_research_prompt(message, conversation_history=conversation_history, revision_plan=revision_plan)
    try:
        if backend == "claude":
            session = start_claude_plan_run(prompt, display_message, settings, artifact)
        else:
            session = start_codex_plan_run(prompt, display_message, settings, artifact)
    except Exception as exc:
        mark_plan_artifact_failed(str(artifact["id"]), str(exc))
        raise
    return {"files": attachments, "plan": public_plan_artifact(read_plan_artifact(str(artifact["id"]))), "session": session}


def start_research_plan_approve(payload: dict[str, Any]) -> dict[str, Any]:
    plan_id = normalize_plan_id(payload.get("planId") or payload.get("id"))
    if not plan_id:
        raise ValueError("Plan id is required.")
    artifact = read_plan_artifact(plan_id)
    plan_text = str(artifact.get("plan_text") or "").strip()
    status = str(artifact.get("status") or "").strip()
    if status not in {"ready", "approved"} or not plan_text:
        raise ValueError("Only a ready plan can be approved.")
    running, _mode = active_process_mode()
    if running:
        raise ValueError("Wait for the current agent run to finish before approving a plan.")
    settings = implementation_settings_from_payload(payload.get("settings"))
    artifact = update_plan_artifact(plan_id, status="approved", approved_at=now_iso())
    append_plan_transcript(artifact)
    instruction = str(payload.get("instruction") or "").strip()
    session = start_research_run(
        approved_plan_prompt(artifact, instruction),
        "chat",
        resume=should_resume_research_session(settings),
        settings_payload=settings,
        display_prompt=f"Implement approved plan {plan_id}.",
    )
    update_plan_artifact(plan_id, implemented_run_id=str(session.get("id") or ""))
    return {"plan": public_plan_artifact(read_plan_artifact(plan_id)), "session": research_session_snapshot()}


def start_research_resume_from_trial(payload: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("message", "")).strip()
    message, attachments = attach_message_resources(payload, message)
    return start_resume_from_trial(payload, message, attachments)


def append_local_command_result(command: str, message: str) -> dict[str, Any]:
    append_transcript("user", "user", "User", command, "ui.command", False)
    append_transcript("assistant", "assistant", "CoAutoResearch", message, "ui.command.result", False)
    return {"local": True, "session": research_session_snapshot()}


def pause_autoresearch(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    gate = read_autoresearch_gate()
    reason = "all_reviewer_gates_passed" if gate_has_passed(gate) else "paused_by_user"
    with RESEARCH_LOCK:
        RESEARCH_SESSION["loop_active"] = False
        RESEARCH_SESSION["loop_stop_reason"] = reason
        RESEARCH_SESSION["gate"] = gate
    persist_research_session()
    return {
        "paused": True,
        "reason": reason,
        "session": research_session_snapshot(),
    }


def start_resume_autoresearch(payload: dict[str, Any]) -> dict[str, Any]:
    settings = normalize_research_settings(payload.get("settings"))
    resume_instruction = str(payload.get("resumeInstruction") or "").strip()[:4000]
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        running = bool(proc and proc.poll() is None)
        live_iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
        goal_instruction = resume_instruction
    cleanup = {"archived": []}
    if not running:
        cleanup = archive_interrupted_trial_tail("resume_autoresearch_from_closed_boundary")
    ensure_autoresearch_gate_for_loop()
    gate = read_autoresearch_gate()
    if gate_has_passed(gate):
        with RESEARCH_LOCK:
            RESEARCH_SESSION["loop_active"] = False
            RESEARCH_SESSION["loop_stop_reason"] = "all_reviewer_gates_passed"
            RESEARCH_SESSION["gate"] = gate
        persist_research_session()
        return {
            "resumed": False,
            "reason": "all_reviewer_gates_passed",
            "session": research_session_snapshot(),
        }
    review_checkpoint_interval = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
    current_iteration = live_iteration if running and live_iteration > 0 else latest_active_trial_iteration()
    next_iteration = pending_expected_trial_iteration() or next_active_trial_iteration()
    with RESEARCH_LOCK:
        RESEARCH_SESSION["loop_active"] = True
        RESEARCH_SESSION["loop_stop_reason"] = ""
        RESEARCH_SESSION["loop_instruction"] = goal_instruction
        RESEARCH_SESSION["settings"] = settings
        RESEARCH_SESSION["loop_max_iterations"] = review_checkpoint_interval
        RESEARCH_SESSION["loop_review_checkpoint_iteration"] = current_iteration + review_checkpoint_interval
    persist_research_session()
    if running:
        append_research_log("Autoresearch resume requested; current run remains active and the next loop iteration will continue.")
        return {
            "resumed": True,
            "running": True,
            "next_iteration": next_iteration,
            "session": research_session_snapshot(),
        }
    archived = cleanup.get("archived") or []
    if archived:
        append_research_log(
            "Archived interrupted trial tail before resuming from the last closed trial: "
            + ", ".join(item["from"] for item in archived)
        )
    resume_same_session = should_resume_research_session(settings)
    return {
        "resumed": True,
        "running": False,
        "next_iteration": next_iteration,
        "archived": archived,
        "session": start_research_run(
            continue_autoresearch_loop_prompt(gate, next_iteration, bool(settings.get("fastMode")), goal_instruction),
            "goal",
            resume=resume_same_session,
            settings_payload=settings,
            display_prompt=f"Resume autoresearch (Trial {next_iteration}).",
            loop_active=True,
            reset_review_checkpoint=True,
            loop_iteration_override=next_iteration,
        ),
    }


def numeric_value(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        text = value.strip().replace(",", "")
        if re.fullmatch(r"-?\d+", text):
            return int(text)
        if re.fullmatch(r"-?\d+(?:\.\d+)?", text):
            return float(text)
    return None


def first_numeric_value(*values: Any) -> int | float | None:
    for value in values:
        number = numeric_value(value)
        if number is not None:
            return number
    return None


def normalize_limit_item(label: str, value: Any) -> dict[str, Any] | None:
    item = dict(value) if isinstance(value, dict) else {"raw": value}
    label = str(item.get("label") or item.get("name") or item.get("window") or label).strip()
    if not label:
        return None

    left = first_numeric_value(
        item.get("left_percent"),
        item.get("remaining_percent"),
        item.get("percent_left"),
    )
    used = first_numeric_value(
        item.get("used_percent"),
        item.get("percent_used"),
        item.get("usage_percent"),
    )
    if left is None and used is not None:
        left = max(0, 100 - used)
    if used is None and left is not None:
        used = max(0, 100 - left)

    return {
        "label": label,
        "left_percent": left,
        "used_percent": used,
        "remaining": item.get("remaining") or item.get("left"),
        "limit": item.get("limit") or item.get("total"),
        "reset": item.get("reset") or item.get("resets") or item.get("reset_at"),
        "raw": item,
    }


def normalize_limits(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        limits = [normalize_limit_item(str(index + 1), item) for index, item in enumerate(value)]
    elif isinstance(value, dict):
        limits = [normalize_limit_item(str(key), item) for key, item in value.items()]
    else:
        limits = []
    return [item for item in limits if item]


def latest_agent_usage() -> dict[str, Any]:
    usage: dict[str, Any] = {}
    limits: list[dict[str, Any]] = []
    cost_usd: float | None = None
    with RESEARCH_LOCK:
        raw_logs = list(RESEARCH_SESSION.get("raw_logs") or [])
    for line in raw_logs:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        event_usage = event.get("usage")
        if not isinstance(event_usage, dict) and isinstance(event.get("message"), dict):
            event_usage = event["message"].get("usage")
        if isinstance(event_usage, dict) and event_usage:
            usage = dict(event_usage)
        for key in ("total_cost_usd", "cost_usd"):
            value = event.get(key)
            if isinstance(value, (int, float)):
                cost_usd = float(value)
        for candidate in (
            event.get("limits"),
            event.get("rate_limits"),
            event.get("rateLimits"),
            event_usage.get("limits") if isinstance(event_usage, dict) else None,
            event_usage.get("rate_limits") if isinstance(event_usage, dict) else None,
            event_usage.get("rateLimits") if isinstance(event_usage, dict) else None,
        ):
            normalized = normalize_limits(candidate)
            if normalized:
                limits = normalized
    result: dict[str, Any] = {"usage": usage, "limits": limits, "raw_log_count": len(raw_logs)}
    if cost_usd is not None:
        result["cost_usd"] = cost_usd
    return result


def latest_codex_usage() -> dict[str, Any]:
    return latest_agent_usage()


def build_status_payload() -> dict[str, Any]:
    session = research_session_snapshot()
    gate = session.get("gate") or {}
    settings = session.get("settings") or {}
    backend = normalize_agent_backend(session.get("backend") or settings.get("backend"))
    backend_label = agent_display_name(backend)
    goal_loop = "passed" if gate_has_passed(gate) else "active" if session.get("loop_active") else "paused"
    stop_reason = session.get("loop_stop_reason") or ""
    if gate_has_passed(gate) and not session.get("loop_active"):
        stop_reason = "all_reviewer_gates_passed"
    completed_trials = [
        trial
        for trial in collect_trials()
        if trial.get("is_active") and trial.get("report_path") and not re.match(r"^0*_?project_conversion", str(trial.get("id") or ""), re.IGNORECASE)
    ]
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        pid = proc.pid if proc and proc.poll() is None else None
        command = " ".join(RESEARCH_SESSION.get("command", []))
    agent_usage = latest_agent_usage()
    wait_state = session.get("agent_wait_state") if isinstance(session.get("agent_wait_state"), dict) else {}
    return {
        "kind": "status_card",
        "backend": backend,
        "backend_label": backend_label,
        "session_id": session.get("session_id") or "",
        "run_status": session.get("status") or "idle",
        "mode": session.get("mode") or "",
        "goal_loop": goal_loop,
        "loop_iteration": int(session.get("loop_iteration") or 0),
        "loop_max_iterations": int(session.get("loop_max_iterations") or AUTORESEARCH_MAX_ITERATIONS),
        "loop_review_checkpoint_iteration": int(session.get("loop_review_checkpoint_iteration") or 0),
        "review_checkpoint_interval": int(session.get("review_checkpoint_interval") or DEFAULT_REVIEW_CHECKPOINT_INTERVAL),
        "trials_reported": len(completed_trials),
        "gate": gate.get("raw_status") or gate.get("status") or "missing",
        "gate_summary": gate.get("summary") or "",
        "gate_response_to_human": gate.get("response_to_human") or "",
        "human_tasks": session.get("human_tasks") if isinstance(session.get("human_tasks"), dict) else read_human_tasks(),
        "stop_reason": stop_reason,
        "started_at": session.get("started_at") or "",
        "ended_at": session.get("ended_at") or "",
        "settings": {
            "backend": backend,
            "model": settings.get("model") or "",
            "reasoning": settings.get("reasoningEffort") or "",
            "permission": settings.get("permissionPreset") or (infer_claude_permission_preset(settings) if backend == "claude" else infer_permission_preset(settings)),
            "sandbox": settings.get("sandbox") or "",
            "approval": settings.get("approvalPolicy") or "",
            "permission_mode": settings.get("permissionMode") or "",
            "fast_mode": bool(settings.get("fastMode")),
            "web_search": bool(settings.get("webSearch")),
            "review_checkpoint_interval": normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval")),
        },
        "process": {
            "active": bool(pid),
            "pid": pid,
            "command": command,
        },
        "agent_wait_state": wait_state,
        "events": {
            "transcript": len(session.get("transcript") or []),
            "raw_logs": agent_usage.get("raw_log_count") or 0,
            "last_event_at": wait_state.get("last_event_at") or session.get("last_event_at") or "",
            "last_event_age_seconds": wait_state.get("last_event_age_seconds"),
            "last_event_summary": wait_state.get("last_event_summary") or session.get("last_event_summary") or "",
        },
        "usage": agent_usage.get("usage") or {},
        "cost_usd": agent_usage.get("cost_usd"),
        "limits": agent_usage.get("limits") or [],
        "limitations": [] if agent_usage.get("limits") else [f"Remaining usage windows are not available from {backend_label} stream events."],
    }


def local_status_message() -> str:
    return json.dumps(build_status_payload(), ensure_ascii=False)


def local_ps_message() -> str:
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        pid = proc.pid if proc and proc.poll() is None else None
        command = " ".join(RESEARCH_SESSION.get("command", []))
        status = RESEARCH_SESSION.get("status", "idle")
        backend = normalize_agent_backend(RESEARCH_SESSION.get("backend") or (RESEARCH_SESSION.get("settings") or {}).get("backend"))
    if not pid:
        return f"No active {agent_display_name(backend)} process. Session status: {status}."
    return f"Active {agent_display_name(backend)} process: pid {pid}\n{command}"


def local_diff_message() -> str:
    try:
        status = subprocess.run(["git", "status", "--short"], cwd=REPO_ROOT, text=True, capture_output=True, timeout=10)
    except Exception as exc:
        return f"Could not inspect git diff: {exc}"
    if status.returncode != 0:
        detail = (status.stderr or status.stdout or "").strip()
        if "not a git repository" in detail.lower():
            return "This project is not currently inside a git repository, so there is no git diff to show."
        return detail or "This project is not currently inside a git repository, so there is no git diff to show."
    diff = subprocess.run(["git", "diff", "--stat"], cwd=REPO_ROOT, text=True, capture_output=True, timeout=10)
    status_text = status.stdout.strip() or "Working tree clean."
    diff_text = diff.stdout.strip()
    return "\n".join(part for part in [status_text, diff_text] if part).strip()


def start_custom_goal_instruction(command: str, goal_instruction: str, settings_payload: Any | None) -> dict[str, Any]:
    instruction = str(goal_instruction or "").strip()
    if not instruction:
        return append_local_command_result(command, "No CoAutoResearch goal instruction was provided.")
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        running = bool(proc and proc.poll() is None)
    cleanup = {"archived": []}
    if not running:
        cleanup = archive_interrupted_trial_tail("goal_instruction_from_closed_boundary")
    ensure_autoresearch_gate_for_loop()
    gate = read_autoresearch_gate()
    settings = normalize_research_settings(settings_payload)
    review_checkpoint_interval = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
    with RESEARCH_LOCK:
        live_iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
    current_iteration = live_iteration if running and live_iteration > 0 else latest_active_trial_iteration()
    next_iteration = pending_expected_trial_iteration() or next_active_trial_iteration()
    with RESEARCH_LOCK:
        RESEARCH_SESSION["loop_active"] = True
        RESEARCH_SESSION["loop_stop_reason"] = ""
        RESEARCH_SESSION["loop_instruction"] = instruction
        RESEARCH_SESSION["settings"] = settings
        RESEARCH_SESSION["loop_max_iterations"] = review_checkpoint_interval
        RESEARCH_SESSION["loop_review_checkpoint_iteration"] = current_iteration + review_checkpoint_interval
    persist_research_session()
    if running:
        return append_local_command_result(
            command,
            "Recorded the CoAutoResearch goal instruction. The current run is still active; the next loop iteration will apply it.",
        )
    archived = cleanup.get("archived") or []
    if archived:
        append_local_command_result(
            command,
            "Archived interrupted trial tail before starting from the last closed trial: "
            + ", ".join(item["from"] for item in archived),
        )
    resume_same_session = should_resume_research_session(settings)
    return {
        "local": True,
        "session": start_research_run(
            continue_autoresearch_loop_prompt(gate, next_iteration, bool(settings.get("fastMode")), instruction),
            "goal",
            resume=resume_same_session,
            settings_payload=settings,
            display_prompt=command,
            loop_active=True,
            reset_review_checkpoint=True,
            loop_iteration_override=next_iteration,
        ),
    }


def handle_local_slash_command(command: str, normalized: str, settings_payload: Any | None) -> dict[str, Any] | None:
    if normalized == "/status":
        return append_local_command_result(command, local_status_message())
    if normalized == "/ps":
        return append_local_command_result(command, local_ps_message())
    if normalized == "/diff":
        return append_local_command_result(command, local_diff_message())
    if normalized == "/goal":
        gate = read_autoresearch_gate()
        return append_local_command_result(
            command,
            "\n".join(
                [
                    f"Goal gate: {gate.get('raw_status') or gate.get('status') or 'missing'}",
                    gate.get("summary") or "No gate summary yet.",
                    f"Loop active: {bool(RESEARCH_SESSION.get('loop_active'))}",
                    f"Trials: {len([trial for trial in collect_trials() if trial.get('report_path') and not re.match(r'^0*_?project_conversion', str(trial.get('id') or ''), re.IGNORECASE)])} reported",
                ]
            ),
        )
    if normalized in {"/goal clear", "/goal stop", "/goal off", "/goal reset", "/goal none", "/goal cancel"}:
        return append_local_command_result(
            command,
            "Autoresearch is controlled by the UI buttons. No loop state was changed from this legacy `/goal` command.",
        )
    if normalized.startswith("/goal "):
        return append_local_command_result(
            command,
            "Autoresearch is controlled by the UI buttons. Use Resume autoresearch, Pause after current turn, Restart autoresearch, or Continue from Trial instead of `/goal` commands.",
        )
    return None


def start_research_command(payload: dict[str, Any]) -> dict[str, Any]:
    command = str(payload.get("command", "")).strip()
    if not command:
        raise ValueError("Command is required.")
    if not command.startswith("/"):
        command = f"/{command}"
    normalized = re.sub(r"\s+", " ", command.lower()).strip()
    if normalized == "/plan" or normalized.startswith("/plan "):
        raise ValueError("Use Plan mode for `/plan`; CoAutoResearch will not forward `/plan` to the agent.")
    settings_payload = payload.get("settings")
    local = handle_local_slash_command(command, normalized, settings_payload)
    if local is not None:
        return local
    return {"session": start_research_run(command, "command", resume=should_resume_research_session(settings_payload), settings_payload=settings_payload)}


def force_kill_research_process_after_delay(proc: subprocess.Popen[str], delay_seconds: float = 3.0) -> None:
    time.sleep(delay_seconds)
    with RESEARCH_LOCK:
        if RESEARCH_SESSION.get("process") is not proc:
            return
    returncode = proc.poll()
    try:
        if returncode is None:
            signal_research_process(proc, force=True)
            append_research_log("Force-stopped agent process after stop request.")
            returncode = proc.wait(timeout=1)
    except (OSError, subprocess.TimeoutExpired):
        return
    try:
        if proc.stdout:
            proc.stdout.close()
    except OSError:
        pass
    with RESEARCH_LOCK:
        should_finish = RESEARCH_SESSION.get("process") is proc and str(RESEARCH_SESSION.get("status") or "") == "stopping"
    if should_finish:
        finish_research_run(returncode)


def stop_research_session() -> dict[str, Any]:
    reconcile_research_process_state()
    context = current_project_context()
    with RESEARCH_LOCK:
        RESEARCH_SESSION["loop_active"] = False
        RESEARCH_SESSION["loop_stop_reason"] = "stopped_by_user"
        proc = RESEARCH_SESSION.get("process")
        live = bool(proc and proc.poll() is None)
        mode = str(RESEARCH_SESSION.get("mode") or "")
        backend = normalize_agent_backend(RESEARCH_SESSION.get("backend") or (RESEARCH_SESSION.get("settings") or {}).get("backend"))
        plan_thread_id = str(RESEARCH_SESSION.get("plan_thread_id") or "")
        plan_turn_id = str(RESEARCH_SESSION.get("plan_turn_id") or "")
        if live:
            RESEARCH_SESSION["status"] = "stopping"
    if live and proc:
        sent_plan_interrupt = False
        if mode == "plan" and backend == "codex" and plan_thread_id and plan_turn_id:
            try:
                json_rpc_write(
                    proc,
                    {
                        "jsonrpc": "2.0",
                        "id": int(time.time() * 1000),
                        "method": "turn/interrupt",
                        "params": {"threadId": plan_thread_id, "turnId": plan_turn_id},
                    },
                )
                sent_plan_interrupt = True
            except Exception:
                pass
        if not sent_plan_interrupt:
            signal_research_process(proc)
        killer = threading.Thread(target=run_in_project, args=(context, force_kill_research_process_after_delay, proc), daemon=True)
        killer.start()
        append_research_log("Stop requested from UI.")
        with RESEARCH_LOCK:
            RESEARCH_SESSION["loop_active"] = False
            RESEARCH_SESSION["loop_stop_reason"] = "stopped_by_user"
        persist_research_session()
        return {"stopped": True, "session": research_session_snapshot()}
    persist_research_session()
    return {"stopped": False, "session": research_session_snapshot()}


class ResearchUIHandler(BaseHTTPRequestHandler):
    server_version = "ResearchUI/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))

    def handle_one_request(self) -> None:
        try:
            super().handle_one_request()
        except Exception as exc:
            if is_client_disconnect_error(exc):
                return
            raise

    def send_json(self, payload: Any, status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            if is_client_disconnect_error(exc):
                return
            raise

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def serve_research_events(self, parsed: Any) -> None:
        context = current_project_context()
        query = parse_qs(parsed.query)
        since = parse_research_event_since(query.get("since", [""])[0])
        if since <= 0:
            since = parse_research_event_since(self.headers.get("Last-Event-ID", ""))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                with context.research_event_condition:
                    events = [dict(event) for event in context.research_events if int(event.get("event_id") or 0) > since]
                    if not events:
                        context.research_event_condition.wait(timeout=RESEARCH_EVENT_HEARTBEAT_SECONDS)
                        events = [dict(event) for event in context.research_events if int(event.get("event_id") or 0) > since]
                    heartbeat = not events
                if heartbeat:
                    self.wfile.write(f": heartbeat {now_iso()}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    continue
                for event in events:
                    self.wfile.write(format_research_sse_event(event).encode("utf-8"))
                    self.wfile.flush()
                    since = max(since, int(event.get("event_id") or 0))
        except (BrokenPipeError, ConnectionError, OSError):
            return

    def serve_aux_session_events(self, parsed: Any, session_id: str) -> None:
        manager = current_project_context().aux_manager
        try:
            session = manager.get(session_id)
        except ValueError:
            self.send_json({"ok": False, "error": "Unknown session"}, status=404)
            return
        query = parse_qs(parsed.query)
        since = parse_research_event_since(query.get("since", [""])[0])
        if since <= 0:
            since = parse_research_event_since(self.headers.get("Last-Event-ID", ""))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                with session.event_condition:
                    events = [dict(e) for e in session.events if int(e.get("event_id") or 0) > since]
                    if not events:
                        session.event_condition.wait(timeout=RESEARCH_EVENT_HEARTBEAT_SECONDS)
                        events = [dict(e) for e in session.events if int(e.get("event_id") or 0) > since]
                    heartbeat = not events
                if heartbeat:
                    self.wfile.write(f": heartbeat {now_iso()}\n\n".encode("utf-8"))
                    self.wfile.flush()
                    continue
                for event in events:
                    self.wfile.write(format_research_sse_event(event).encode("utf-8"))
                    self.wfile.flush()
                    since = max(since, int(event.get("event_id") or 0))
        except (BrokenPipeError, ConnectionError, OSError):
            return

    def request_project_id(self, parsed: Any, payload: dict[str, Any] | None = None) -> str:
        query = parse_qs(parsed.query)
        project_id = query.get("project", [""])[0]
        if not project_id and payload:
            project_id = str(payload.get("project") or payload.get("projectId") or "")
        return unquote(str(project_id or "")).strip()

    def remote_auth_valid(self, token: str) -> bool:
        return bool(REMOTE_AUTH_TOKEN and token and hmac.compare_digest(token, REMOTE_AUTH_TOKEN))

    def remote_auth_cookie_token(self) -> str:
        raw_cookie = self.headers.get("Cookie", "")
        if not raw_cookie:
            return ""
        cookie = SimpleCookie()
        try:
            cookie.load(raw_cookie)
        except Exception:
            return ""
        morsel = cookie.get(REMOTE_AUTH_COOKIE)
        return morsel.value if morsel else ""

    def remote_auth_header_token(self) -> str:
        authorization = str(self.headers.get("Authorization", "")).strip()
        prefix = "Bearer "
        if authorization.startswith(prefix):
            return authorization[len(prefix):].strip()
        return ""

    def send_remote_auth_redirect(self, parsed: Any) -> None:
        query = urlencode([(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != REMOTE_AUTH_QUERY])
        location = parsed.path or "/"
        if query:
            location = f"{location}?{query}"
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Set-Cookie", f"{REMOTE_AUTH_COOKIE}={REMOTE_AUTH_TOKEN}; HttpOnly; SameSite=Lax; Path=/")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def send_remote_auth_required(self, parsed: Any) -> None:
        if parsed.path.startswith("/api/"):
            self.send_json({"ok": False, "error": "Remote access token is required."}, status=401)
            return
        data = b"Remote access token is required."
        self.send_response(401)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorize_remote_request(self, parsed: Any) -> bool:
        if not REMOTE_AUTH_TOKEN:
            return True
        query = parse_qs(parsed.query)
        query_token = query.get(REMOTE_AUTH_QUERY, [""])[0]
        if self.remote_auth_valid(query_token):
            if self.command == "GET":
                self.send_remote_auth_redirect(parsed)
                return False
            return True
        if self.remote_auth_valid(self.remote_auth_header_token()):
            return True
        if self.remote_auth_valid(self.remote_auth_cookie_token()):
            return True
        self.send_remote_auth_required(parsed)
        return False

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if not self.authorize_remote_request(parsed):
            return
        if parsed.path == "/api/projects":
            if PROJECT_REGISTRY:
                PROJECT_REGISTRY.refresh()
            projects = PROJECT_REGISTRY.summaries() if PROJECT_REGISTRY else []
            active_project_id = projects[0]["id"] if projects else ""
            self.send_json({
                "ok": True,
                "active_project_id": active_project_id,
                "projects": projects,
                "multi_project": bool(PROJECT_REGISTRY and PROJECT_REGISTRY.multi_project),
            })
            return
        if parsed.path == "/api/settings":
            self.send_json({"ok": True, "settings": public_ui_settings(), "secret_keys": SECRET_ENV_KEYS})
            return
        if not parsed.path.startswith("/api/"):
            self.serve_static(parsed.path)
            return
        if parsed.path == "/api/overview":
            requested_project_id = self.request_project_id(parsed)
            try:
                with using_project(requested_project_id):
                    self.send_json(build_overview())
                    return
            except Exception as exc:
                if is_client_disconnect_error(exc):
                    return
                if PROJECT_REGISTRY and requested_project_id and re.search(r"\bUnknown project\b", str(exc), re.IGNORECASE):
                    PROJECT_REGISTRY.refresh()
                    with using_project(""):
                        payload = build_overview()
                    payload["requested_project_unavailable"] = requested_project_id
                    self.send_json(payload)
                    return
                self.send_json({"ok": False, "error": str(exc)}, status=400)
                return
        try:
            with using_project(self.request_project_id(parsed)):
                if parsed.path == "/api/health":
                    context = current_project_context()
                    self.send_json({"ok": True, "repo_root": str(REPO_ROOT), "project": context.summary(), "time": now_iso()})
                    return
                if parsed.path == "/api/file":
                    query = parse_qs(parsed.query)
                    relative = query.get("path", [""])[0]
                    self.send_json(read_text_file(unquote(relative)))
                    return
                if parsed.path == "/api/file/raw":
                    query = parse_qs(parsed.query)
                    relative = query.get("path", [""])[0]
                    download = str(query.get("download", [""])[0]).strip().lower() in {"1", "true", "yes"}
                    self.serve_repo_file(unquote(relative), download=download)
                    return
                if parsed.path == "/api/export/estimate":
                    query = parse_qs(parsed.query)
                    self.send_json(export_estimate(query.get("kind", [""])[0]))
                    return
                if parsed.path == "/api/export/status":
                    query = parse_qs(parsed.query)
                    result = export_status(query.get("id", [""])[0])
                    self.send_json({"ok": True, "export": result, **result})
                    return
                if parsed.path == "/api/manuscript/figure-image/status":
                    query = parse_qs(parsed.query)
                    result = manuscript_figure_image_status(query.get("id", [""])[0])
                    self.send_json({"ok": True, "job": result, **result})
                    return
                if parsed.path == "/api/export/download":
                    query = parse_qs(parsed.query)
                    self.serve_export_download(query.get("id", [""])[0])
                    return
                if parsed.path == "/api/local/browse":
                    query = parse_qs(parsed.query)
                    local_path = query.get("path", [""])[0]
                    search_query = query.get("q", [""])[0]
                    result = browse_local_path(unquote(local_path), unquote(search_query))
                    self.send_json(result, status=200 if result.get("ok") else 400)
                    return
                if parsed.path == "/api/research/events":
                    self.serve_research_events(parsed)
                    return
                if parsed.path == "/api/research/session":
                    self.send_json({"session": research_session_snapshot()})
                    return
                if parsed.path == "/api/sessions":
                    self.send_json({"ok": True, **aux_list_sessions()})
                    return
                if parsed.path.startswith("/api/sessions/") and parsed.path.endswith("/events"):
                    session_id = unquote(parsed.path[len("/api/sessions/"):-len("/events")])
                    self.serve_aux_session_events(parsed, session_id)
                    return
                if parsed.path.startswith("/api/sessions/") and parsed.path.endswith("/workspace"):
                    session_id = unquote(parsed.path[len("/api/sessions/"):-len("/workspace")])
                    self.send_json({"ok": True, **aux_workspace_list(session_id, parsed)})
                    return
                if parsed.path.startswith("/api/sessions/") and "/workspace/file" in parsed.path:
                    session_id = unquote(parsed.path[len("/api/sessions/"):parsed.path.index("/workspace/file")])
                    serve_aux_workspace_file(self, session_id, parsed)
                    return
                if parsed.path.startswith("/api/sessions/"):
                    session_id = unquote(parsed.path[len("/api/sessions/"):])
                    self.send_json({"ok": True, **aux_get_session(session_id)})
                    return
                if parsed.path == "/api/research/queue":
                    self.send_json(queue_response_payload())
                    return
                if parsed.path == "/api/framing/messages":
                    self.send_json({"ok": True, "messages": load_framing_messages()})
                    return
                if parsed.path == "/api/agent/models":
                    query = parse_qs(parsed.query)
                    backend = normalize_agent_backend(query.get("backend", [""])[0])
                    self.send_json({"ok": True, **agent_available_models(backend)})
                    return
        except Exception as exc:
            if is_client_disconnect_error(exc):
                return
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        if parsed.path.startswith("/api/"):
            self.send_json({"error": "Unknown API route"}, status=404)
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if not self.authorize_remote_request(parsed):
            return
        try:
            if parsed.path == "/api/resource-import/chunk":
                query = parse_qs(parsed.query)
                import_id = query.get("import_id", [""])[0]
                try:
                    offset = int(query.get("offset", [""])[0])
                except (TypeError, ValueError) as exc:
                    raise ValueError("Resource import chunk offset is required.") from exc
                length = int(self.headers.get("Content-Length", "0") or "0")
                if length <= 0:
                    raise ValueError("Resource import chunk body is empty.")
                data = self.rfile.read(length)
                with using_project(self.request_project_id(parsed)):
                    result = write_resource_import_chunk(import_id, offset, data)
                    self.send_json({"ok": True, "result": result, **result})
                return
            payload = self.read_json()
            if parsed.path == "/api/projects":
                if not PROJECT_REGISTRY:
                    raise ValueError("Project registry is not available.")
                project = PROJECT_REGISTRY.create_project(payload)
                self.send_json({
                    "ok": True,
                    "active_project_id": project["id"],
                    "project": project,
                    "projects": PROJECT_REGISTRY.summaries(),
                    "multi_project": PROJECT_REGISTRY.multi_project,
                }, status=201)
                return
            if parsed.path == "/api/projects/rename":
                if not PROJECT_REGISTRY:
                    raise ValueError("Project registry is not available.")
                project = PROJECT_REGISTRY.rename_project(payload)
                self.send_json({
                    "ok": True,
                    "active_project_id": project["id"],
                    "project": project,
                    "projects": PROJECT_REGISTRY.summaries(),
                    "multi_project": PROJECT_REGISTRY.multi_project,
                })
                return
            if parsed.path == "/api/projects/delete":
                if not PROJECT_REGISTRY:
                    raise ValueError("Project registry is not available.")
                result = PROJECT_REGISTRY.delete_project(payload)
                self.send_json({"ok": True, **result})
                return
            if parsed.path == "/api/settings":
                self.send_json({"ok": True, "settings": save_ui_settings(payload), "secret_keys": SECRET_ENV_KEYS})
                return
            if parsed.path == "/api/projects/upgrade-reviewers":
                project_id = self.request_project_id(parsed, payload)
                with using_project(project_id):
                    context = current_project_context()
                    result = sync_project_reviewers(context.root)
                    context.refresh_metadata()
                    if PROJECT_REGISTRY:
                        PROJECT_REGISTRY.refresh()
                    self.send_json({
                        "ok": True,
                        "result": result,
                        "active_project_id": context.id,
                        "project": context.summary(),
                        "projects": PROJECT_REGISTRY.summaries() if PROJECT_REGISTRY else [context.summary()],
                        "multi_project": bool(PROJECT_REGISTRY and PROJECT_REGISTRY.multi_project),
                    })
                return
            with using_project(self.request_project_id(parsed, payload)):
                if parsed.path == "/api/resource-import/start":
                    result = start_resource_import(payload)
                    self.send_json({"ok": True, "result": result, **result})
                    return
                if parsed.path == "/api/resource-import/finish":
                    result = finish_resource_import(payload)
                    self.send_json({"ok": True, "result": result, **result})
                    return
                if parsed.path == "/api/resource-import/cancel":
                    result = cancel_resource_import(payload)
                    self.send_json({"ok": True, "result": result, **result})
                    return
                if parsed.path == "/api/export/start":
                    result = start_export(payload)
                    self.send_json({"ok": True, "export": result, **result})
                    return
                if parsed.path == "/api/manuscript/figure-image/start":
                    result = start_manuscript_figure_image(payload)
                    self.send_json({"ok": True, "job": result, **result})
                    return
                if parsed.path == "/api/export/cancel":
                    result = cancel_export(payload)
                    self.send_json({"ok": True, "export": result, **result})
                    return
                if parsed.path == "/api/cold-start":
                    self.send_json({"ok": True, "result": write_cold_start(payload)})
                    return
                if parsed.path == "/api/research/cold-start":
                    self.send_json({"ok": True, "result": start_research_cold_start(payload)})
                    return
                if parsed.path == "/api/research/framing":
                    self.send_json({"ok": True, "result": start_research_framing(payload)})
                    return
                if parsed.path == "/api/research/go":
                    self.send_json({"ok": True, "result": start_research_go(payload)})
                    return
                if parsed.path == "/api/research/chat":
                    self.send_json({"ok": True, "result": start_research_chat(payload)})
                    return
                if parsed.path == "/api/sessions":
                    self.send_json({"ok": True, "result": aux_create_session(payload)}, status=201)
                    return
                if parsed.path.startswith("/api/sessions/") and parsed.path.endswith("/chat"):
                    session_id = unquote(parsed.path[len("/api/sessions/"):-len("/chat")])
                    self.send_json({"ok": True, "result": aux_chat_session(session_id, payload)})
                    return
                if parsed.path.startswith("/api/sessions/") and parsed.path.endswith("/refresh"):
                    session_id = unquote(parsed.path[len("/api/sessions/"):-len("/refresh")])
                    self.send_json({"ok": True, "result": aux_refresh_session(session_id)})
                    return
                if parsed.path.startswith("/api/sessions/") and parsed.path.endswith("/stop"):
                    session_id = unquote(parsed.path[len("/api/sessions/"):-len("/stop")])
                    self.send_json({"ok": True, "result": aux_stop_session(session_id)})
                    return
                if parsed.path == "/api/research/queue":
                    self.send_json({"ok": True, "result": enqueue_research_queue_item(payload)})
                    return
                if parsed.path == "/api/research/queue/reorder":
                    self.send_json({"ok": True, "result": reorder_research_queue(payload), **queued_chat_summary()})
                    return
                if parsed.path == "/api/research/queue/dispatch-next":
                    self.send_json({"ok": True, "result": dispatch_next_queued_chat()})
                    return
                if parsed.path == "/api/research/plan":
                    self.send_json({"ok": True, "result": start_research_plan(payload)})
                    return
                if parsed.path == "/api/research/plan/approve":
                    self.send_json({"ok": True, "result": start_research_plan_approve(payload)})
                    return
                if parsed.path == "/api/research/resume-from-trial":
                    self.send_json({"ok": True, "result": start_research_resume_from_trial(payload)})
                    return
                if parsed.path == "/api/research/resume":
                    self.send_json({"ok": True, "result": start_resume_autoresearch(payload)})
                    return
                if parsed.path == "/api/research/pause":
                    self.send_json({"ok": True, "result": pause_autoresearch(payload)})
                    return
                if parsed.path == "/api/research/restart":
                    self.send_json({"ok": True, "result": start_restart_autoresearch(payload)})
                    return
                if parsed.path == "/api/research/command":
                    self.send_json({"ok": True, "result": start_research_command(payload)})
                    return
                if parsed.path == "/api/research/stop":
                    self.send_json({"ok": True, "result": stop_research_session()})
                    return
                if parsed.path == "/api/framing/messages":
                    self.send_json({"ok": True, "messages": update_framing_messages(payload)})
                    return
                if parsed.path == "/api/file/save":
                    path = str(payload.get("path", "")).strip()
                    if not path:
                        raise ValueError("File path is required.")
                    file_payload = write_text_file(path, str(payload.get("text", "")))
                    if payload.get("record") is not False:
                        record_ui_file_edit(file_payload.get("path") or path)
                    self.send_json({"ok": True, "file": file_payload})
                    return
            self.send_json({"error": "Unknown API route"}, status=404)
        except Exception as exc:
            if is_client_disconnect_error(exc):
                return
            self.send_json({"ok": False, "error": str(exc)}, status=400)

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        if not self.authorize_remote_request(parsed):
            return
        try:
            payload = self.read_json()
            with using_project(self.request_project_id(parsed, payload)):
                if parsed.path == "/api/research/queue":
                    self.send_json({"ok": True, "result": update_research_queue_item(payload), **queued_chat_summary()})
                    return
            self.send_json({"error": "Unknown API route"}, status=404)
        except Exception as exc:
            if is_client_disconnect_error(exc):
                return
            self.send_json({"ok": False, "error": str(exc)}, status=400)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if not self.authorize_remote_request(parsed):
            return
        try:
            payload = self.read_json()
            query = parse_qs(parsed.query)
            if not payload and query.get("id"):
                payload = {"id": query.get("id", [""])[0]}
            with using_project(self.request_project_id(parsed, payload)):
                if parsed.path == "/api/research/queue":
                    self.send_json({"ok": True, "result": delete_research_queue_item(payload), **queued_chat_summary()})
                    return
                if parsed.path.startswith("/api/sessions/"):
                    session_id = unquote(parsed.path[len("/api/sessions/"):])
                    self.send_json({"ok": True, "result": aux_delete_session(session_id)})
                    return
            self.send_json({"error": "Unknown API route"}, status=404)
        except Exception as exc:
            if is_client_disconnect_error(exc):
                return
            self.send_json({"ok": False, "error": str(exc)}, status=400)

    def serve_repo_file(self, relative_path: str, download: bool = False) -> None:
        try:
            path, _display_path = resolve_repo_file_reference(relative_path)
        except ValueError:
            self.send_error(403)
            return
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        try:
            data = path.read_bytes()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", file_mime(path))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        disposition = "attachment" if download else "inline"
        self.send_header("Content-Disposition", f'{disposition}; filename="{path.name}"; filename*=UTF-8\'\'{quote(path.name)}')
        self.end_headers()
        self.wfile.write(data)

    def serve_export_download(self, export_id: str) -> None:
        try:
            job = export_job_for_current_project(export_id)
        except ValueError:
            self.send_error(404)
            return
        with EXPORT_LOCK:
            public = export_job_public(job)
            path = Path(str(job.get("zip_path") or ""))
        if public.get("status") != "ready" or not path.exists() or not path.is_file():
            self.send_error(404)
            return
        filename = str(public.get("filename") or "export.zip").replace('"', "")
        try:
            size = path.stat().st_size
            handle = path.open("rb")
        except OSError:
            self.send_error(404)
            return
        with handle:
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quote(filename)}')
            self.end_headers()
            while True:
                chunk = handle.read(EXPORT_CHUNK_BYTES)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def serve_static(self, request_path: str) -> None:
        relative = "index.html" if request_path in {"", "/"} else unquote(request_path.lstrip("/"))
        path = (UI_DIR / relative).resolve()
        if path != UI_DIR and UI_DIR.resolve() not in path.parents:
            self.send_error(403)
            return
        if not path.exists() or path.is_dir():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def is_port_in_use_error(exc: OSError) -> bool:
    in_use_codes = {errno.EADDRINUSE, getattr(errno, "WSAEADDRINUSE", 10048)}
    if getattr(exc, "errno", None) in in_use_codes:
        return True
    # On Windows, binding to a port already held by another process can surface
    # as WinError 10013 instead of WSAEADDRINUSE.
    if os.name == "nt" and isinstance(exc, PermissionError) and getattr(exc, "winerror", None) == 10013:
        return True
    return False


def display_url_host(host: str) -> str:
    if host in {"", "0.0.0.0", "::"}:
        return "127.0.0.1"
    if ":" in host and not host.startswith("["):
        return f"[{host}]"
    return host


def bind_http_server(host: str, requested_port: int) -> tuple[ThreadingHTTPServer, int]:
    if requested_port == 0:
        httpd = ThreadingHTTPServer((host, 0), ResearchUIHandler)
        return httpd, int(httpd.server_address[1])

    last_error: OSError | None = None
    start_port = max(1, int(requested_port))
    stop_port = min(65535, start_port + PORT_FALLBACK_ATTEMPTS)
    for port in range(start_port, stop_port + 1):
        try:
            httpd = ThreadingHTTPServer((host, port), ResearchUIHandler)
            return httpd, int(httpd.server_address[1])
        except OSError as exc:
            if not is_port_in_use_error(exc):
                raise
            last_error = exc
    if last_error:
        raise OSError(
            last_error.errno,
            f"No available port found from {start_port} to {stop_port} on {host}",
        ) from last_error
    raise OSError(f"No available port found from {start_port} to {stop_port} on {host}")


def main() -> None:
    global PROJECT_REGISTRY, UI_REMOTE_MODE
    parser = argparse.ArgumentParser(description="Run the CoAutoResearch local web UI.")
    parser.add_argument("--host", default=os.environ.get("AUTO_RESEARCH_UI_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("AUTO_RESEARCH_UI_PORT", "8765")))
    parser.add_argument("--project-root", default=os.environ.get("COAUTO_PROJECT_ROOT", ""))
    parser.add_argument("--projects-dir", default=os.environ.get("COAUTO_PROJECTS_DIR", ""))
    parser.add_argument(
        "--remote",
        action="store_true",
        default=os.environ.get("COAUTO_UI_REMOTE", "").strip().lower() in {"1", "true", "yes"},
        help="Expose UI runtime metadata for a browser connected to a remote server.",
    )
    args = parser.parse_args()
    UI_REMOTE_MODE = bool(args.remote)

    project_root = Path(os.path.expanduser(args.project_root)).resolve() if args.project_root else DEFAULT_PROJECT_ROOT
    projects_dir = Path(os.path.expanduser(args.projects_dir)).resolve() if args.projects_dir else None
    PROJECT_REGISTRY = ProjectRegistry(project_root, projects_dir)
    if PROJECT_REGISTRY.order:
        load_research_session_runtime()
    httpd, bound_port = bind_http_server(args.host, args.port)
    url = f"http://{display_url_host(args.host)}:{bound_port}"
    if args.port != 0 and bound_port != args.port:
        print(f"Port {args.port} is unavailable on {args.host}; using {bound_port}.", flush=True)
    if PROJECT_REGISTRY.multi_project:
        print(f"CoAutoResearch UI serving projects from {projects_dir}", flush=True)
        for project in PROJECT_REGISTRY.summaries():
            print(f"- {project['display_name']}: {project['root']}", flush=True)
    else:
        print(f"CoAutoResearch UI serving {REPO_ROOT}", flush=True)
    print(f"Open {url}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping UI server.", flush=True)
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
