#!/usr/bin/env python3
"""Local file-backed web UI for the CoAutoResearch scaffold."""

from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import errno
import hashlib
import json
import mimetypes
import os
import re
import shutil
import stat
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, unquote, urlparse


UI_DIR = Path(__file__).resolve().parent
DEFAULT_PROJECT_ROOT = UI_DIR.parent
PACKAGE_TEMPLATE_ROOT = Path(os.path.expanduser(os.environ.get("COAUTO_TEMPLATE_ROOT", ""))).resolve() if os.environ.get("COAUTO_TEMPLATE_ROOT") else None
DEFAULT_REVIEW_CHECKPOINT_INTERVAL = 100
AUTORESEARCH_MAX_ITERATIONS = DEFAULT_REVIEW_CHECKPOINT_INTERVAL
PORT_FALLBACK_ATTEMPTS = 50
FRAMING_MESSAGES_CLIENT_VERSION = "20260617-trial-selection"
MAX_TEXT_BYTES = 500_000
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
RESOURCE_IMPORT_CHUNK_BYTES = 8 * 1024 * 1024
EXPORT_CONFIRMATION_BYTES = 1 * 1024 * 1024 * 1024
EXPORT_CHUNK_BYTES = 1024 * 1024
EXPORT_JOB_TTL_SECONDS = 24 * 60 * 60
EXPORT_STORE_WITHOUT_COMPRESSION_BYTES = 16 * 1024 * 1024
AUTO_RESOURCE_SEARCH_MAX_RESULTS = 8
AUTO_RESOURCE_SEARCH_MAX_DIRS = 2500
AUTO_RESOURCE_SEARCH_MAX_DEPTH = 5
ACTIVE_EXPECTED_TRIAL_MARKER_STATUSES = {"pending", "mismatch"}
RESUME_SNAPSHOT_PATHS = [
    "PROJECT.md",
    "research_trajectory/STATE.md",
    "research_trajectory/CURRENT_FINDINGS.md",
    "manuscript",
    "resources/user_input/RESOURCE_MANIFEST.md",
]
RESTART_SNAPSHOT_PATHS = [
    "PROJECT.md",
    "research_trajectory/STATE.md",
    "research_trajectory/CURRENT_FINDINGS.md",
    "research_trajectory/TRAJECTORY.json",
    "research_trajectory/NEXT_TRIAL.json",
    "research_trajectory/trials",
    "research_trajectory/checkpoints",
    "manuscript",
    "workspace",
    "resources/user_input/RESOURCE_MANIFEST.md",
]
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
REVIEWER_BASELINE_VERSION = "2026-06-publication-ready-tables"
CORE_REVIEWER_FILES = [
    "REVIEW_TAXONOMY.md",
    "FINAL_GATE_REVIEWER.md",
    "PLAN_REVIEWER.md",
    "PROCESS_REVIEWER.md",
    "EVIDENCE_REVIEWER.md",
    "VENUE_FIT_REVIEWER.md",
    "MANUSCRIPT_REVIEWER.md",
    "FIGURE_TABLE_REVIEWER.md",
    "REVIEWER_SPAWNING.md",
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
        "gate": {},
        "last_event_at": "",
        "last_event_summary": "",
        "agent_notice": {},
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


def write_reviewer_baseline_metadata(project_root: Path, template_root: Path | None = None) -> dict[str, Any]:
    hashes = reviewer_template_hashes(template_root)
    payload = {
        "schemaVersion": 1,
        "reviewerBaselineVersion": REVIEWER_BASELINE_VERSION,
        "reviewStorageVersion": REVIEW_STORAGE_VERSION,
        "syncedAt": now_iso(),
        "coreReviewerFiles": hashes,
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
        r"^\s*[-*]\s*(Plan reviewer|Process reviewer|Evidence reviewer|Venue fit reviewer|Manuscript reviewer|Figure/table reviewer|Final gate reviewer)\s*:\s*(.+?)\s*$",
        replace_line,
        text,
        flags=re.MULTILINE,
    )
    cleaned = re.sub(r"^\s*[-*]\s*Reviewer instructions are outdated \(baseline is outdated\)\.\s*$", "", updated, flags=re.IGNORECASE | re.MULTILINE)
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
        if re.search(r"Reviewer instructions are outdated \(baseline is outdated\)\.", state_text, re.IGNORECASE):
            state_stale_consistency_blockers.append("Reviewer instructions are outdated (baseline is outdated).")
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
    baseline_version = str(metadata.get("reviewerBaselineVersion") or "")
    review_storage = project_review_storage_status(project_root)
    outdated = bool(missing or changed or metadata_missing or baseline_version != REVIEWER_BASELINE_VERSION or review_storage.get("outdated"))
    return {
        "schema_version": 1,
        "baseline_version": baseline_version,
        "latest_baseline_version": REVIEWER_BASELINE_VERSION,
        "outdated": outdated,
        "missing": missing,
        "changed": changed,
        "metadata_missing": metadata_missing,
        "metadata_path": REVIEWER_BASELINE_RELATIVE_PATH,
        "core_reviewer_files": CORE_REVIEWER_FILES,
        "hashes": project_hashes,
        "review_storage": review_storage,
    }


def sync_project_reviewers(project_root: Path) -> dict[str, Any]:
    template_dir = reviewer_template_dir()
    project_dir = project_root / "instructions" / "reviewers"
    if not template_dir.exists():
        raise ValueError("Package reviewer template directory is missing.")
    project_dir.mkdir(parents=True, exist_ok=True)
    before = project_reviewer_baseline_status(project_root)
    migration_id = f"{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}_{uuid.uuid4().hex[:8]}"
    backup_root = project_root / "archive" / "template_migrations" / migration_id / "instructions" / "reviewers"
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
    metadata = write_reviewer_baseline_metadata(project_root, clean_template_root())
    manifest_path = project_root / "archive" / "template_migrations" / migration_id / "MIGRATION.md"
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
                f"- Metadata: `{REVIEWER_BASELINE_RELATIVE_PATH}`",
                f"- Review storage version: `{REVIEW_STORAGE_VERSION}`",
                f"- Created per-reviewer files: {len(review_storage['created'])}",
                f"- Backfilled latest-gate files: {len(review_storage['backfilled'])}",
                f"- Explicit missing-review placeholders: {len(review_storage['placeholders'])}",
                f"- Normalized manuscript reviews: {len(review_storage['normalized_manuscript_reviews'])}",
                "",
                "Custom reviewer files outside the core reviewer set were preserved.",
                "Archived restart/resume history was not rewritten.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return {
        "ok": True,
        "migration_id": migration_id,
        "backup_path": str((backup_root.parent.parent.parent).relative_to(project_root)) if backup_root.exists() else "",
        "copied": copied,
        "backed_up": backed_up,
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
            raise ValueError(f"Project directory already exists: {directory_name}")

    target.mkdir(parents=True, exist_ok=True)
    shutil.copytree(template_root, target, ignore=template_copy_ignore(template_root), dirs_exist_ok=True)
    finalize_created_project(target, display_name or directory_name, template_root)
    return target


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
        self.lock = threading.Lock()
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

    def context_for(self, project_id: str = "") -> ProjectContext:
        if not project_id:
            return self.default_context()
        context = self.contexts.get(project_id)
        if context:
            return context
        self.refresh()
        context = self.contexts.get(project_id)
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
        stopped_run = self.stop_project_run_for_delete(context)
        root = context.root.resolve()
        shutil.rmtree(root)
        self.refresh()
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

DEFAULT_CODEX_SETTINGS = {
    "model": "gpt-5.5",
    "reasoningEffort": "medium",
    "permissionPreset": "default",
    "sandbox": "workspace-write",
    "approvalPolicy": "on-request",
    "webSearch": True,
    "fastMode": False,
    "extraConfig": "",
    "reviewCheckpointInterval": DEFAULT_REVIEW_CHECKPOINT_INTERVAL,
}
DEFAULT_CLAUDE_SETTINGS = {
    "model": "sonnet",
    "reasoningEffort": "medium",
    "permissionPreset": "auto-review",
    "permissionMode": "auto",
    "webSearch": True,
    "fastMode": False,
    "extraConfig": "",
    "reviewCheckpointInterval": DEFAULT_REVIEW_CHECKPOINT_INTERVAL,
}
DEFAULT_AGENT_SETTINGS = {"backend": "codex"}
ALLOWED_AGENT_BACKENDS = {"codex", "claude"}
ALLOWED_CODEX_MODELS = {"gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"}
ALLOWED_CLAUDE_MODEL_ALIASES = {"sonnet", "opus", "haiku"}
SECRET_ENV_KEYS = [
    "GITHUB_TOKEN",
    "HF_TOKEN",
]

ALLOWED_SANDBOXES = {"read-only", "workspace-write", "danger-full-access"}
ALLOWED_APPROVAL_POLICIES = {"untrusted", "on-request", "never"}
ALLOWED_REASONING_EFFORTS = {"low", "medium", "high", "xhigh"}
AGENT_IDLE_NOTICE_SECONDS = 180
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
    "default": {"permissionMode": "acceptEdits"},
    "auto-review": {"permissionMode": "auto"},
    "full-access": {"permissionMode": "bypassPermissions"},
}


def normalize_agent_backend(value: Any = "") -> str:
    backend = str(value or "").strip().lower()
    return backend if backend in ALLOWED_AGENT_BACKENDS else DEFAULT_AGENT_SETTINGS["backend"]


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


def normalize_claude_model(value: Any, fallback: str | None = None) -> str:
    model = str(value or "").strip()
    default = fallback or DEFAULT_CLAUDE_SETTINGS["model"]
    if not model:
        return default
    if model in ALLOWED_CLAUDE_MODEL_ALIASES:
        return model
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/+-]{1,120}", model):
        return model
    return default


def normalize_codex_settings(payload: Any, base: dict[str, Any] | None = None) -> dict[str, Any]:
    values = payload if isinstance(payload, dict) else {}
    settings = dict(DEFAULT_CODEX_SETTINGS)
    if base:
        settings.update({key: value for key, value in base.items() if key in DEFAULT_CODEX_SETTINGS})
    for key in DEFAULT_CODEX_SETTINGS:
        if key not in values:
            continue
        if key == "model":
            model = str(values[key]).strip()
            settings[key] = model if model in ALLOWED_CODEX_MODELS else settings.get("model") or DEFAULT_CODEX_SETTINGS["model"]
        elif key == "approvalPolicy":
            approval = str(values[key]).strip()
            settings[key] = approval if approval in ALLOWED_APPROVAL_POLICIES else settings.get("approvalPolicy") or DEFAULT_CODEX_SETTINGS["approvalPolicy"]
        elif key == "permissionPreset":
            preset = str(values[key]).strip()
            settings[key] = preset if preset in PERMISSION_PRESETS else infer_permission_preset(settings)
        elif key == "reasoningEffort":
            reasoning = str(values[key]).strip()
            settings[key] = reasoning if reasoning in ALLOWED_REASONING_EFFORTS else settings.get("reasoningEffort") or DEFAULT_CODEX_SETTINGS["reasoningEffort"]
        elif key == "reviewCheckpointInterval":
            settings[key] = normalize_review_checkpoint_interval(values[key])
        elif key == "webSearch":
            settings[key] = bool(values[key])
        elif key == "fastMode":
            settings[key] = bool(values[key])
        elif key == "extraConfig":
            settings[key] = str(values[key] or "").strip()[:4000]
        elif key == "sandbox":
            sandbox = str(values[key]).strip()
            if sandbox in ALLOWED_SANDBOXES:
                settings[key] = sandbox
        else:
            settings[key] = values[key]
    settings["reasoningEffort"] = (
        settings["reasoningEffort"]
        if settings["reasoningEffort"] in ALLOWED_REASONING_EFFORTS
        else DEFAULT_CODEX_SETTINGS["reasoningEffort"]
    )
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
            settings[key] = preset if preset in CLAUDE_PERMISSION_PRESETS else infer_claude_permission_preset(settings)
        elif key == "permissionMode":
            mode = str(values[key]).strip()
            if mode in {item["permissionMode"] for item in CLAUDE_PERMISSION_PRESETS.values()}:
                settings[key] = mode
        elif key == "reasoningEffort":
            reasoning = str(values[key]).strip()
            settings[key] = reasoning if reasoning in ALLOWED_REASONING_EFFORTS else settings.get("reasoningEffort") or DEFAULT_CLAUDE_SETTINGS["reasoningEffort"]
        elif key == "reviewCheckpointInterval":
            settings[key] = normalize_review_checkpoint_interval(values[key])
        elif key == "webSearch":
            settings[key] = bool(values[key])
        elif key == "fastMode":
            settings[key] = bool(values[key])
        elif key == "extraConfig":
            settings[key] = str(values[key] or "").strip()[:4000]
    settings["model"] = normalize_claude_model(settings.get("model"))
    settings["reasoningEffort"] = (
        settings["reasoningEffort"]
        if settings["reasoningEffort"] in ALLOWED_REASONING_EFFORTS
        else DEFAULT_CLAUDE_SETTINGS["reasoningEffort"]
    )
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
    "research_trajectory/interventions",
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
    text = "\n".join(part for part in (line, display) if part).strip()
    if not text:
        return {}
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
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with RESEARCH_LOCK:
        payload = {key: value for key, value in RESEARCH_SESSION.items() if key not in {"process", "process_thread"}}
    SESSION_STATE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


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
    }
    if not UI_SETTINGS_PATH.exists():
        return settings
    try:
        payload = json.loads(UI_SETTINGS_PATH.read_text(encoding="utf-8"))
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
    return settings


def public_ui_settings() -> dict[str, Any]:
    settings = load_ui_settings()
    agent_status = agent_backend_status_payload(settings["agent"].get("backend"))
    return {
        "agent": settings["agent"],
        "codex": settings["codex"],
        "claude": settings["claude"],
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

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    UI_SETTINGS_PATH.write_text(
        json.dumps(
            {"agent": merged_agent, "codex": merged_codex, "claude": merged_claude, "env": merged_env},
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
    if kind not in {"text", "project", "goal-launch", "command"}:
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
        artifact_path = str(artifact.get("path") or "").strip()
        artifact_text = str(artifact.get("text") or "").strip()
        if artifact_path and artifact_text:
            clean["artifact"] = {
                "path": artifact_path[:400],
                "text": artifact_text[:120_000],
            }
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


def agent_process_env() -> dict[str, str]:
    env = os.environ.copy()
    env.update(load_ui_settings().get("env", {}))
    return env


def codex_process_env() -> dict[str, str]:
    return agent_process_env()


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


def run_agent_probe(executable: str, args: list[str], env: dict[str, str] | None = None, timeout: float = 6.0) -> dict[str, Any]:
    command = [executable, *args]
    try:
        use_shell = executable_requires_windows_shell(executable)
        popen_command: str | list[str] = subprocess.list2cmdline(command) if use_shell else command
        completed = subprocess.run(
            popen_command,
            env=env if env is not None else os.environ,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
            shell=use_shell,
            check=False,
        )
    except FileNotFoundError as exc:
        return {"ok": False, "returncode": 127, "output": str(exc), "error": str(exc), "timeout": False}
    except subprocess.TimeoutExpired as exc:
        output = "\n".join(filter(None, [str(exc.stdout or ""), str(exc.stderr or "")])).strip()
        return {"ok": False, "returncode": None, "output": output or "Command timed out.", "error": "timeout", "timeout": True}
    except OSError as exc:
        return {"ok": False, "returncode": 126, "output": str(exc), "error": str(exc), "timeout": False}
    output = "\n".join(filter(None, [completed.stdout, completed.stderr])).strip()
    return {
        "ok": completed.returncode == 0,
        "returncode": completed.returncode,
        "output": output,
        "error": "",
        "timeout": False,
    }


def auth_probe_status(backend: str, probe: dict[str, Any]) -> str:
    if probe.get("ok"):
        return "ok"
    text = str(probe.get("output") or probe.get("error") or "").lower()
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
    if any(marker in text for marker in unknown_markers):
        return "unknown"
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
    if any(marker in text for marker in missing_markers):
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
    return f"{label} readiness could not be determined."


def agent_setup_status(backend: str, env: dict[str, str] | None = None) -> dict[str, Any]:
    backend = normalize_agent_backend(backend)
    label = agent_display_name(backend)
    process_env = env if env is not None else os.environ
    base: dict[str, Any] = {
        "backend": backend,
        "label": label,
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
    version_probe = run_agent_probe(executable, agent_version_command(backend), process_env)
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
    auth_probe = run_agent_probe(executable, agent_auth_command(backend), process_env)
    auth = auth_probe_status(backend, auth_probe)
    base["auth"] = auth
    if auth == "missing":
        base.update({
            "blocking": True,
            "message": agent_setup_instruction(backend, "auth"),
            "details": str(auth_probe.get("output") or auth_probe.get("error") or ""),
        })
        return base
    if auth == "unknown":
        base.update({
            "ok": True,
            "blocking": False,
            "message": (
                f"{label} CLI is installed, but `{agent_auth_status_command_text(backend)}` did not return a supported "
                "auth status. Startup will continue and report any CLI failure normally."
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
    full_match = re.match(r"^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?(?:-(\d{6,8}))?$", raw, re.IGNORECASE)
    if full_match:
        tier = full_match.group(1).capitalize()
        major = full_match.group(2)
        minor = full_match.group(3)
        version = f"{major}.{minor}" if minor else major
        return f"Claude {tier} {version}"
    if raw.lower() in {"opus", "sonnet", "haiku", "fable", "mythos"}:
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
    for match in re.finditer(r"\bclaude-(?:opus|sonnet|haiku|fable|mythos)-\d+(?:-\d+)?(?:-\d{6,8})?\b", text, re.IGNORECASE):
        value = match.group(0).lower()
        found.setdefault(value, _format_claude_model_label(value))
    # Shortcuts (opus / sonnet / haiku) appear in the --model option help text quoted or after commas.
    for match in re.finditer(r"[\"'`,\s\[\(](opus|sonnet|haiku|fable|mythos)[\"'`,\s\]\)]", text, re.IGNORECASE):
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
    tier_order = {"opus": 0, "sonnet": 1, "haiku": 2, "fable": -1, "mythos": -2}
    full = re.match(r"^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?", value, re.IGNORECASE)
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


def agent_available_models(backend: str, env: dict[str, str] | None = None) -> dict[str, Any]:
    backend = normalize_agent_backend(backend)
    process_env = env if env is not None else os.environ
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
    cache_key = f"{backend}::{executable}"
    cached = _AGENT_MODELS_CACHE.get(cache_key)
    if cached is not None:
        return cached
    help_probe = run_agent_probe(executable, ["--help"], process_env, timeout=6.0)
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
    known_modes = {"acceptEdits", "auto", "bypassPermissions", "default", "delegate", "dontAsk", "plan"}
    return modes & known_modes


def claude_permission_mode_status(settings: dict[str, Any] | None = None, env: dict[str, str] | None = None) -> dict[str, Any]:
    mode = claude_permission_mode_from_settings(settings)
    process_env = env if env is not None else os.environ
    try:
        executable = resolve_agent_executable("claude", process_env)
    except FileNotFoundError as exc:
        return {"ok": False, "blocking": True, "mode": mode, "message": str(exc)}
    help_probe = run_agent_probe(executable, ["--help"], process_env)
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
    statuses = {name: agent_setup_status(name, env) for name in sorted(ALLOWED_AGENT_BACKENDS)}
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
        for key in ("text", "message", "summary", "content", "output", "result", "error", "stdout", "stderr"):
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

    raw_type = str(event.get("type") or event.get("event") or event.get("kind") or "event")
    raw_type_lower = raw_type.lower()
    if raw_type_lower in {"thread.started", "turn.started"}:
        return None
    if raw_type_lower == "turn.completed" and set(event.keys()).issubset({"type", "usage"}):
        return None

    item = event.get("item") if isinstance(event.get("item"), dict) else {}
    item_type = str(item.get("type") or item.get("kind") or item.get("role") or "").lower()
    content_source: Any = item or event
    content = event_payload_text(content_source)
    if not content or content in {raw_type, item_type}:
        return None

    role = "assistant"
    kind = "assistant"
    title = "Assistant"
    editable = False
    type_text = f"{raw_type_lower} {item_type}".strip()

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

    event_type = str(event.get("type") or "event")
    subtype = str(event.get("subtype") or "").strip()
    raw_type = f"{event_type}.{subtype}" if subtype else event_type
    raw_type_lower = raw_type.lower()
    if raw_type_lower in {"system.init"}:
        return None
    if "delta" in raw_type_lower or "partial" in raw_type_lower:
        return None

    if event_type == "assistant":
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

    if event_type == "user":
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

    if event_type == "result":
        is_error = bool(event.get("is_error")) or subtype == "error"
        content = event_payload_text(event.get("result") or event.get("error") or event.get("message") or event)
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
        editable = path.suffix.lower() in EDITABLE_SUFFIXES and (resolved == root or root in resolved.parents)
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
    path = repo_path(relative_path)
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
    return read_text_file(rel_path(path))


def safe_read(path: Path, limit: int = MAX_TEXT_BYTES) -> str:
    try:
        raw = path.read_bytes()[: limit + 1]
    except OSError:
        return ""
    return raw[:limit].decode("utf-8", errors="replace")


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
    follow_symlinks = is_resources_relative_path(relative_dir)
    files: list[dict[str, Any]] = []
    for path, virtual_path, _depth in iter_tree_paths(directory, relative_dir, recursive=recursive, follow_symlink_dirs=follow_symlinks):
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
    follow_symlinks = is_resources_relative_path(relative_dir)
    for path, relative, _depth in iter_tree_paths(
        root_path,
        relative_dir,
        max_depth=max_depth,
        exclude_names=exclude_names,
        follow_symlink_dirs=follow_symlinks,
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
    inline_artifacts = [block for block in architecture if block.get("is_artifact")]
    section_architecture = [block for block in architecture if not block.get("is_artifact")]
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

    if not plan_exists:
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
        summary = "Reporting · REPORT.md ready"
        detail = trial_report_summary(report)
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


def closed_active_trial_dirs() -> list[Path]:
    # The canonical resume boundary stops at the first unclosed active trial.
    closed: list[Path] = []
    for path in active_trial_dirs():
        if not trial_dir_is_closed(path):
            break
        closed.append(path)
    return closed


def interrupted_tail_trial_dirs() -> list[Path]:
    active = active_trial_dirs()
    boundary_iteration = max([trial_iteration_from_id(path.name) for path in closed_active_trial_dirs()], default=0)
    return [path for path in active if trial_iteration_from_id(path.name) > boundary_iteration]


def latest_active_trial_iteration() -> int:
    return max([trial_iteration_from_id(path.name) for path in closed_active_trial_dirs()], default=0)


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
    active = closed_active_trial_dirs()
    latest = active[-1].name if active else ""
    next_number = trial_iteration_from_id(latest) + 1 if latest else 1
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


def write_expected_trial_marker(iteration: int, reason: str, base_trial: str = "", fork_id: str = "") -> dict[str, Any]:
    payload = {
        "schema_version": TRAJECTORY_SCHEMA_VERSION,
        "status": "pending",
        "expected_iteration": int(iteration),
        "reason": reason,
        "base_trial": base_trial,
        "fork_id": fork_id,
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
    closed_iterations = [trial_iteration_from_id(path.name) for path in closed_active_trial_dirs()]
    if expected in closed_iterations:
        marker["status"] = "fulfilled"
        update_expected_trial_marker(marker)
        sync_trajectory_state("expected_trial_fulfilled")
        return
    higher = [value for value in closed_iterations if value > expected]
    if higher:
        marker["status"] = "mismatch"
        marker["actual_iterations"] = sorted(closed_iterations)
        update_expected_trial_marker(marker)
        stop_autoresearch_loop("trajectory_mismatch", read_autoresearch_gate())
        append_research_log(
            f"Trajectory mismatch: expected the agent to close Trial {expected}, but closed trials are {sorted(closed_iterations)}."
        )


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
        if expected in archived_iterations or any(value >= expected for value in archived_iterations):
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


def write_resume_intervention(
    fork_id: str,
    fork_sequence: int,
    trial: dict[str, Any],
    user_instruction: str,
    attachments: dict[str, Any],
    restore_mode: str,
    archived_trials: list[dict[str, str]],
) -> str:
    root = REPO_ROOT / "research_trajectory" / "human_interventions"
    root.mkdir(parents=True, exist_ok=True)
    intervention_number = next_intervention_id()
    title_slug = slugify(f"resume_from_{trial.get('id', 'trial')}", "resume_from_trial")
    path = root / f"I{intervention_number:04d}_{title_slug}.md"
    uploaded = attachments.get("saved_files", []) if isinstance(attachments, dict) else []
    linked = attachments.get("resource_links", []) if isinstance(attachments, dict) else []
    clues = attachments.get("resource_clues", []) if isinstance(attachments, dict) else []
    lines = [
        f"# I{intervention_number:04d} Resume From Trial",
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
    entry = f"- `I{intervention_number:04d}` Resume from `{trial.get('id', '')}`: `{rel_path(path)}`"
    if entry not in existing:
        index_path.write_text(existing.rstrip() + "\n" + entry + "\n", encoding="utf-8")
    return rel_path(path)


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
    entry = "\n".join(
        [
            "",
            f"## F{fork_sequence:04d} · {trial.get('id', '')}",
            "",
            f"- Created: {now_iso()}",
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
    return rel_path(index_path)


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
    pending_dir = REPO_ROOT / "research_trajectory/interventions/pending"
    formal_dir = REPO_ROOT / "research_trajectory/interventions"
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
    index = read_text_file("research_trajectory/interventions/INDEX.md")
    return {"pending": pending, "formal": formal, "index": index}


def collect_resources() -> list[dict[str, Any]]:
    groups = []
    for label, relative in RESOURCE_GROUPS.items():
        groups.append({"label": label, "path": relative, "files": list_files(relative)})
    return groups


EXPORT_KIND_LABELS = {
    "blueprint": "Blueprint Pack",
    "final_project": "Final Project Pack",
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
    suffix = "blueprint-pack" if kind == "blueprint" else "final-project-pack"
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
        return "reference-only source/workspace path; use Final Project Pack for raw resources and working outputs"
    if source.is_dir():
        return "referenced directory; Blueprint Pack includes explicit final files only"
    suffix = Path(normalized).suffix.lower()
    if suffix in BLUEPRINT_ARCHIVE_SUFFIXES:
        return "reference-only archive; raw source bundles are not included in Blueprint Pack"
    if normalized.startswith("research_trajectory/") and "/artifacts/" not in normalized:
        return "reference-only trajectory provenance; autoresearch trajectory is not included in Blueprint Pack"
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
        "This package is a self-contained manuscript blueprint and final findings handoff."
        if kind == "blueprint"
        else "This package is a clean final project handoff. It intentionally excludes autoresearch trajectory, runtime, archive, and agent scaffolding."
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
            "This clean handoff contains final project-facing files only.",
            "",
            "- `PROJECT.md`: final research direction.",
            "- `FINDINGS.md`: promoted current findings summary.",
            "- `manuscript/`: manuscript blueprint, figures, tables, sections, and appendix materials.",
            "- `workspace/`: executable method code, configs, notebooks, and final generated outputs.",
            "- `resources/`: raw inputs and project resources needed by the final workspace.",
            "",
            "Autoresearch trials, reviews, logs, checkpoints, runtime state, secrets, and agent instructions are intentionally excluded.",
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
    return {
        "active_project_id": context.id,
        "project": context.summary(),
        "projects": PROJECT_REGISTRY.summaries() if PROJECT_REGISTRY else [context.summary()],
        "multi_project": bool(PROJECT_REGISTRY and PROJECT_REGISTRY.multi_project),
        "repo_root": str(REPO_ROOT),
        "generated_at": now_iso(),
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
        "trials": collect_trials(),
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
        source = path_exists_resolved(Path(os.path.expandvars(os.path.expanduser(source_text))))
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
        candidate = Path(os.path.expanduser(raw_path))
        if not candidate.is_absolute():
            candidate = fallback / candidate
    else:
        candidate = fallback

    try:
        current = candidate.resolve()
    except OSError:
        current = candidate.absolute()

    if current.is_file():
        current = current.parent

    roots = local_browser_roots()
    if not current.exists() or not current.is_dir():
        return {
            "ok": False,
            "error": f"Folder does not exist or cannot be opened: {raw_path or str(candidate)}",
            "path": str(fallback),
            "parent": str(fallback.parent) if fallback.parent != fallback else "",
            "roots": roots,
            "entries": [],
            "truncated": False,
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
    model = str(settings.get("model") or "").strip()
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


def settings_to_claude_args(settings: dict[str, Any], resume: bool) -> list[str]:
    args: list[str] = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
    model = normalize_claude_model(settings.get("model"))
    if model:
        args.extend(["--model", model])
    reasoning = str(settings.get("reasoningEffort") or "").strip()
    if reasoning in ALLOWED_REASONING_EFFORTS:
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
        for key in ("text", "message", "summary", "content", "output"):
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
    event_type = str(event.get("type") or event.get("event") or "event")
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
    event_type = str(event.get("type") or "event")
    subtype = str(event.get("subtype") or "").strip()
    label = f"{event_type}.{subtype}" if subtype else event_type
    if event_type == "system" and subtype == "init":
        session_id = str(event.get("session_id") or "").strip()
        return f"{label}: session {session_id[:8]}" if session_id else label
    if event_type in {"assistant", "user"}:
        message = event.get("message") if isinstance(event.get("message"), dict) else event
        tool = next((block for block in claude_content_blocks(message) if str(block.get("type") or "") in {"tool_use", "tool_result"}), None)
        if tool:
            name = str(tool.get("name") or tool.get("tool_use_id") or "tool").strip()
            return f"{label}: {name}"
        text = claude_message_content_text(message, include_tools=False)
        if text:
            return f"{label}: {text[:900]}"
    if event_type == "result":
        text = event_payload_text(event.get("result") or event.get("error") or event)
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
            "Result shown or conceptual basis:",
            "Provenance links:",
            "Target-venue fit rationale:",
            "Remaining blocker:",
        ):
            if label not in body:
                blockers.append(f"Inline figure `{title}` is missing `{label}`.")
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
        for label in (
            "Placement:",
            "Metric or result summary:",
            "Source artifact path:",
            "Limitations and uncertainty:",
            "Manuscript claim supported in plain language:",
            "Remaining blocker:",
        ):
            if label not in body:
                blockers.append(f"Inline dataset/benchmark/result `{title}` is missing `{label}`.")

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
            parts.append("baseline metadata is missing or stale")
        detail = "; ".join(parts) or "baseline is outdated"
        blockers.append(f"Reviewer instructions are outdated ({detail}).")
    blockers.extend(final_gate_review_schema_blockers())
    blockers.extend(current_trial_reviewer_file_blockers())
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
            "summary": f"Could not read STATE.md: {exc}",
            "path": str(RESEARCH_STATE_PATH.relative_to(REPO_ROOT)),
        }
    section = markdown_section(text, "Autoresearch Goal Gate")
    if not section:
        return {
            "exists": False,
            "status": "missing",
            "raw_status": "",
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
        "Server repair: top-level `Status: pass` was downgraded because final blueprint, reviewer baseline, or final-gate consistency checks did not pass."
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
    with RESEARCH_LOCK:
        current_mode = str(RESEARCH_SESSION.get("mode", "") or "")
        current_proc = RESEARCH_SESSION.get("process")
        current_running = bool(current_proc and current_proc.poll() is None)
        current_status = str(RESEARCH_SESSION.get("status", "") or "")
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
        running = bool(proc and proc.poll() is None)
        mode = str(RESEARCH_SESSION.get("mode", "") or "")
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
            "trajectory": trajectory,
            "active_run": active_run,
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
    event_at = now_iso()
    notice = agent_notice_from_event(line, display)
    with RESEARCH_LOCK:
        if line.strip():
            RESEARCH_SESSION["raw_logs"].append(line.rstrip("\n"))
            RESEARCH_SESSION["last_event_at"] = event_at
        if display:
            RESEARCH_SESSION["logs"].append(display)
            RESEARCH_SESSION["last_event_summary"] = compact_single_line(display, 260)
        elif line.strip():
            RESEARCH_SESSION["last_event_summary"] = compact_single_line(line, 260)
        if notice:
            RESEARCH_SESSION["agent_notice"] = notice
        if transcript and transcript.get("content"):
            RESEARCH_SESSION["transcript"].append(transcript_entry(**transcript))
        session_id = ""
        try:
            session_id = find_session_identifier(json.loads(line))
        except json.JSONDecodeError:
            session_id = find_session_identifier(line)
        if session_id:
            RESEARCH_SESSION["session_id"] = session_id
        RESEARCH_SESSION["raw_logs"] = RESEARCH_SESSION["raw_logs"][-2000:]
        RESEARCH_SESSION["logs"] = RESEARCH_SESSION["logs"][-2000:]
        RESEARCH_SESSION["transcript"] = RESEARCH_SESSION["transcript"][-600:]
    persist_research_session()


def finish_research_run(returncode: int | None) -> None:
    with RESEARCH_LOCK:
        RESEARCH_SESSION["status"] = "completed" if returncode == 0 else "failed"
        RESEARCH_SESSION["returncode"] = returncode
        RESEARCH_SESSION["ended_at"] = now_iso()
        RESEARCH_SESSION["process"] = None
        RESEARCH_SESSION["process_thread"] = None
    persist_research_session()


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


def continue_autoresearch_loop_prompt(gate: dict[str, Any], next_iteration: int | None = None, fast_mode: bool = False) -> str:
    status = gate.get("raw_status") or gate.get("status") or "missing"
    summary = gate.get("summary") or "No reviewer gate summary yet."
    expected = int(next_iteration or next_active_trial_iteration())
    return f"""/goal resume

Continue the autoresearch loop from the current closed trajectory boundary.
{fast_mode_prompt_section(fast_mode)}

Current autoresearch gate status: {status}

Next active trial must be Trial {expected}. Create it under `research_trajectory/trials/` with an id beginning `{expected:06d}_`. Do not skip ahead because old runtime state or archived/superseded trials had higher numbers.

Gate summary:
{summary}

Read:
- AGENTS.md
- instructions/EXECUTION_AGENT.md
- PROJECT.md
- research_trajectory/STATE.md
- research_trajectory/CURRENT_FINDINGS.md
- the `Autoresearch Goal Gate` section in research_trajectory/STATE.md
- instructions/reviewers/REVIEW_TAXONOMY.md
- all seven core reviewer instructions under instructions/reviewers/
- instructions/reviewers/FINAL_GATE_REVIEWER.md

If the `Autoresearch Goal Gate` section in `research_trajectory/STATE.md` says `Status: pass` and every current-trial reviewer file is a strict pass, including the Final gate reviewer, do not create a new trial. Report that the autoresearch goal has passed all reviewer gates.

Otherwise, run exactly the next coherent autoresearch iteration needed to move the gate toward pass:
1. create the next trial under research_trajectory/trials/;
2. write PLAN.md before execution;
3. create `reviews/` and write all seven current-trial reviewer files: PLAN_REVIEW.md, PROCESS_REVIEW.md, EVIDENCE_REVIEW.md, VENUE_FIT_REVIEW.md, MANUSCRIPT_REVIEW.md, FIGURE_TABLE_REVIEW.md, and FINAL_GATE_REVIEW.md;
4. execute mainly in workspace/;
5. write REPORT.md;
6. refresh all seven current-trial reviewer files after REPORT.md;
7. update STATE.md, CURRENT_FINDINGS.md, manuscript-facing files, and notes only when genuinely changed;
8. update the `Autoresearch Goal Gate` section in research_trajectory/STATE.md at the end, with each reviewer line pointing to the current trial's reviewer file path.

Do not stop merely because one trial completed, a plan was approved, a manuscript architecture is coherent, a venue fit is plausible, or evidence is supported with qualification. Stop only when all seven current-trial reviewer files have `Decision: pass` and `Gate impact: pass` with no blocking issues, required actions, unresolved qualifications, active revision constraints, or critical unassessed areas."""


def maybe_continue_autoresearch_loop(returncode: int | None) -> None:
    with RESEARCH_LOCK:
        loop_active = bool(RESEARCH_SESSION.get("loop_active"))
        mode = str(RESEARCH_SESSION.get("mode") or "")
        settings = dict(RESEARCH_SESSION.get("settings") or {})
        iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
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
    next_iteration = next_active_trial_iteration()
    resume_same_session = should_resume_research_session()
    start_research_run(
        continue_autoresearch_loop_prompt(gate, next_iteration, bool(settings.get("fastMode"))),
        "goal",
        resume=resume_same_session,
        settings_payload=settings,
        display_prompt=f"Continue autoresearch loop (Trial {next_iteration}).",
        loop_active=True,
        loop_iteration_override=next_iteration,
    )


def process_research_run(proc: subprocess.Popen[str]) -> None:
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            append_research_log(line)
        returncode = proc.wait()
    except Exception as exc:  # pragma: no cover - defensive process handling
        append_research_log(f"UI session error: {exc}")
        returncode = proc.poll()
    with RESEARCH_LOCK:
        mode = str(RESEARCH_SESSION.get("mode") or "")
        protected_snapshot = RESEARCH_SESSION.get("protected_snapshot")
    finish_research_run(returncode)
    if mode == "chat":
        restored_paths = restore_chat_protected_snapshot(protected_snapshot if isinstance(protected_snapshot, dict) else None)
        if restored_paths:
            append_research_log(
                "Chat mode guard restored protected autoresearch artifacts; use Start autoresearch or `/goal` to create trials: "
                + ", ".join(restored_paths)
            )
        with RESEARCH_LOCK:
            RESEARCH_SESSION["protected_snapshot"] = None
        persist_research_session()
    if returncode == 0:
        try:
            if mode != "chat":
                validate_expected_trial_marker()
                maybe_checkpoint_latest_trial()
                sync_trajectory_state("run_completed")
        except Exception as exc:  # pragma: no cover - checkpointing should not kill the UI loop
            append_research_log(f"Trajectory/checkpoint warning: {exc}")
    maybe_continue_autoresearch_loop(returncode)


def agent_command_for_prompt(resume: bool, settings: dict[str, Any]) -> list[str]:
    session_id = str(RESEARCH_SESSION.get("session_id") or "")
    backend = normalize_agent_backend(settings.get("backend"))
    executable = resolve_agent_executable(backend)
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


def should_resume_research_session() -> bool:
    status = str(RESEARCH_SESSION.get("status") or "").strip().lower()
    if status in {"interrupted", "failed"}:
        return False
    return bool(str(RESEARCH_SESSION.get("session_id") or "").strip())


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
    settings = normalize_research_settings(settings_payload)
    backend = normalize_agent_backend(settings.get("backend"))
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        if proc and proc.poll() is None:
            raise ValueError(f"A {agent_display_name(backend)} run is already active.")
    ensure_agent_ready(backend, settings=settings)
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        if proc and proc.poll() is None:
            raise ValueError(f"A {agent_display_name(backend)} run is already active.")
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
    persist_research_session()

    try:
        use_shell = executable_requires_windows_shell(command[0])
        popen_command: str | list[str] = subprocess.list2cmdline(command) if use_shell else command
        proc = subprocess.Popen(
            popen_command,
            cwd=REPO_ROOT,
            env=agent_process_env(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            shell=use_shell,
        )
        assert proc.stdin is not None
        proc.stdin.write(prompt)
        proc.stdin.write("\n")
        proc.stdin.close()
    except OSError as exc:
        append_research_log(agent_start_error_message(exc, command, backend))
        finish_research_run(127)
        return research_session_snapshot()

    with RESEARCH_LOCK:
        RESEARCH_SESSION["process"] = proc
    append_research_log(f"Started: {' '.join(command)}")
    context = current_project_context()
    thread = threading.Thread(target=run_in_project, args=(context, process_research_run, proc), daemon=True)
    with RESEARCH_LOCK:
        RESEARCH_SESSION["process_thread"] = thread
    thread.start()
    return research_session_snapshot()


def cold_start_prompt(payload: dict[str, Any]) -> str:
    brief = str(payload.get("brief", "")).strip()
    target_venue = str(payload.get("targetVenue", "")).strip()
    return f"""Run adaptive intake triage for this CoAutoResearch scaffold, then cold start or conversion only as appropriate.

User brief:
{brief}

Target venue / audience:
{target_venue or "Not provided"}

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
- inspect relevant resources
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
- read instructions/COLD_START.md and instructions/CONVERSION.md only as needed
- read resources/user_input/INITIAL_BRIEF.md
- read resources/user_input/RESOURCE_MANIFEST.md if present
- if RESOURCE_MANIFEST.md contains inferred, unresolved, or ambiguous resource clues, run Resource Intake first and do not treat those clues as attached resources until they are filed or explicitly blocked
- inspect attached resources enough to understand the research direction
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
    return f"""/goal

Start the autoresearch loop from the current PROJECT.md as the goal.

This is after the user-facing framing pass. Do not rerun cold-start framing just to rewrite PROJECT.md.
{instruction_section}
{fast_mode_prompt_section(fast_mode)}

Use the repository instructions:
- read AGENTS.md
- read instructions/EXECUTION_AGENT.md
- read PROJECT.md
- read research_trajectory/STATE.md
- read research_trajectory/CURRENT_FINDINGS.md
- inspect resources only as needed for the next coherent research objective
- read instructions/reviewers/REVIEW_TAXONOMY.md
- read all seven core reviewer instructions under instructions/reviewers/
- read instructions/reviewers/FINAL_GATE_REVIEWER.md
- create or update the `Autoresearch Goal Gate` section in research_trajectory/STATE.md

This is not complete after one trial. Run the next autoresearch iteration and maintain the reviewer gate:
1. choose one coherent next research objective;
2. create the next trial under research_trajectory/trials/;
3. write PLAN.md before execution;
4. create `reviews/` and write all seven current-trial reviewer files: PLAN_REVIEW.md, PROCESS_REVIEW.md, EVIDENCE_REVIEW.md, VENUE_FIT_REVIEW.md, MANUSCRIPT_REVIEW.md, FIGURE_TABLE_REVIEW.md, and FINAL_GATE_REVIEW.md;
5. execute primarily in workspace/;
6. write REPORT.md after execution;
7. refresh all seven current-trial reviewer files after REPORT.md;
8. update STATE.md, CURRENT_FINDINGS.md, manuscript-facing files, or notes only when their current state genuinely changes;
9. update the `Autoresearch Goal Gate` section in research_trajectory/STATE.md with:
   - `Status: pass`, `continue`, `blocked`, or `needs_human`;
   - one line for each required reviewer gate: Plan, Process, Evidence, Venue fit, Manuscript, Figure/table, Final gate;
   - the current trial reviewer file path on each reviewer gate line;
   - the next action if any gate is not pass.

Required reviewer gates must all be strict `pass` before the autoresearch goal is complete, including the Final gate reviewer. If any current-trial reviewer file is missing, not pass, or has any blocking issue, required action, unresolved qualification, active revision constraint, or critical unassessed area, set `Status: continue` unless human input is truly required.

Do not treat "approved", "completed", "ready", "plausible", "architecture pass", "supported with qualification", or "targeted revision ready" as pass. Those are partial results unless the relevant reviewer standard and Final gate standard are fully satisfied.

Before any final pass in a manuscript-facing project, run a final synthesis step:
update `manuscript/BLUEPRINT.md`, `research_trajectory/CURRENT_FINDINGS.md`,
and `manuscript/figures/FIGURE_SPECS.md` as needed. The final blueprint must be
self-contained and target-venue-ready in final manuscript reading order:
architecture overview/table of contents, section/subsection architecture, local
claim/evidence/result explanations, inline figure/table/algorithm/dataset/
benchmark/result blocks with captions/content/source/provenance/venue
rationale, reference/literature grounding, appendix/supplement posture, blocking
missing evidence, required qualifications, provenance/audit index, deprecated
ideas, and submission-readiness summary must all be current. Separate
claim/evidence maps, Figure Plan, Table Plan, or FIGURE_SPECS entries may
support audit only; they do not satisfy final readability by themselves. If
`Blocking Missing Evidence` is non-empty, if an active artifact lacks inline
placement/caption/content/source/provenance/venue rationale, if reviewer
instructions are outdated, or if stale language such as "tentative until
source-level evidence checks are completed" remains, keep `Status: continue`.

Treat PROJECT.md as the current goal definition. If PROJECT.md is insufficient or contradictory, ask for clarification in the final message and set `Status: needs_human` instead of silently inventing a different project."""


def chat_research_prompt(message: str = "") -> str:
    extra = message.strip()
    return f"""Respond in CoAutoResearch chat/framing mode. This is not an autoresearch launch.

User message:
{extra or "(No text; attached resources may have been saved by the UI.)"}

Hard boundary:
- Do not create, edit, delete, rename, or summarize as newly completed anything under `research_trajectory/trials/`.
- Do not update `research_trajectory/STATE.md`, `research_trajectory/CURRENT_FINDINGS.md`, `research_trajectory/TRAJECTORY.json`, `research_trajectory/NEXT_TRIAL.json`, or `research_trajectory/checkpoints/`.
- Do not create reviewer files, trial reports, manuscript gate files, or mark any trial/gate/reviewer as pass, completed, or current.
- Do not run the autoresearch loop from this chat path. If the user asks to continue research, start autoresearch, run trials, overqualify the work, or otherwise perform the loop, tell them to use the Start autoresearch button or an explicit `/goal` command, and do not modify protected autoresearch artifacts.

Allowed behavior:
- Answer questions from current project files.
- If explicitly asked for framing edits, update only framing-level files such as `PROJECT.md` or resource intake notes.
- If resources were attached, acknowledge what the UI saved and say that Resource Intake or autoresearch should be launched explicitly before treating them as trial evidence.

Use AGENTS.md for repository conventions, but the boundary above overrides any instruction that would start or continue a trial. Be concise in the final response."""


def continue_research_prompt(message: str = "") -> str:
    extra = message.strip()
    if extra:
        return f"""Continue the active CoAutoResearch project in this same agent session.

User instruction:
{extra}

Follow AGENTS.md and research_trajectory/STATE.md. If the latest user instruction or RESOURCE_MANIFEST.md contains new resource clues, follow instructions/RESOURCE_INTAKE.md before treating those materials as attached.

If the user is asking a question, asking for an explanation, or asking what the project is about, answer directly from the current project files and do not modify repository files. Only update files when the user explicitly asks for a change, asks you to continue research work, or gives an instruction that requires edits. Report either the answer or what changed."""
    return """Continue the next coherent CoAutoResearch iteration in this same agent session.

Follow AGENTS.md and research_trajectory/STATE.md. If the latest user instruction or RESOURCE_MANIFEST.md contains new resource clues, follow instructions/RESOURCE_INTAKE.md before treating those materials as attached. Check pending interventions, choose the next coherent objective, execute it, update repository files as needed, and report what changed."""


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
- if the restored state is inconsistent, repair the project state before creating substantive new claims.
"""
    return f"""/goal resume from trial

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
Read:
- AGENTS.md
- instructions/EXECUTION_AGENT.md
- instructions/INTERVENTION_PROTOCOL.md
- PROJECT.md
- research_trajectory/STATE.md
- research_trajectory/CURRENT_FINDINGS.md
- the base trial PLAN/REVIEW/REPORT files
- instructions/reviewers/REVIEW_TAXONOMY.md
- all seven core reviewer instructions under instructions/reviewers/
- instructions/reviewers/FINAL_GATE_REVIEWER.md

Continue autoresearch from the selected base trial boundary. The next active trial is Trial {next_iteration}; create it under `research_trajectory/trials/` using the next active trajectory number after the base trial, even if archived/superseded trials previously had higher numbers. Do not treat archived later trials as active truth. You may consult archived later trials only as superseded context and must say when you do. Write all seven reviewer files under the current trial `reviews/` directory, update the autoresearch gate with those paths, and stop only when the strict reviewer gate standard is met or human input is required."""


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
    return f"""/goal restart

The user confirmed a full autoresearch restart.

Restart manifest: `{manifest_path}`
Restart id: `{restart_id}`

User restart instruction:
{reason.strip() or "Restart autoresearch from a clean active trajectory."}

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
- instructions/MANUSCRIPT.md
- instructions/reviewers/REVIEW_TAXONOMY.md
- all seven core reviewer instructions under instructions/reviewers/

Write all seven reviewer files under each new active trial `reviews/` directory. Stop only when the strict autoresearch final gate passes, or when human input is required."""


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
    with RESEARCH_LOCK:
        resume = should_resume_research_session()
    session = start_research_run(
        framing_prompt(payload),
        "framing",
        resume=resume,
        settings_payload=payload.get("settings"),
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
    with RESEARCH_LOCK:
        resume = should_resume_research_session()
        RESEARCH_SESSION["loop_iteration"] = 0
        RESEARCH_SESSION["loop_max_iterations"] = AUTORESEARCH_MAX_ITERATIONS
        RESEARCH_SESSION["loop_review_checkpoint_iteration"] = 0
        RESEARCH_SESSION["loop_stop_reason"] = ""
    ensure_autoresearch_gate_for_loop()
    settings = normalize_research_settings(payload.get("settings"))
    session = start_research_run(
        autoresearch_goal_prompt(str(payload.get("launchInstruction", ""))[:4000], bool(settings.get("fastMode"))),
        "goal",
        resume=resume,
        settings_payload=settings,
        display_prompt="Start autoresearch loop with /goal.",
        loop_active=True,
        reset_review_checkpoint=True,
    )
    return {"files": result, "session": session}


def start_research_go(payload: dict[str, Any]) -> dict[str, Any]:
    payload = prepare_payload_resources(dict(payload), payload_resource_texts(payload))
    message = str(payload.get("message", "")).strip()
    display = message or "Continue autoresearch."
    return {
        "session": start_research_run(
            continue_research_prompt(message),
            "research",
            resume=True,
            settings_payload=payload.get("settings"),
            display_prompt=display,
        )
    }


def attach_message_resources(payload: dict[str, Any], message: str) -> tuple[str, dict[str, Any]]:
    payload = prepare_payload_resources(dict(payload), payload_resource_texts(payload, message))
    saved_files = save_uploads(payload)
    linked_resources = save_resource_links(payload)
    metadata_files = write_ui_metadata(payload, saved_files, linked_resources)
    resolutions = payload.get("_resourceResolution", [])
    if not saved_files and not linked_resources and not resolutions:
        return message, {"saved_files": [], "resource_links": [], "metadata_files": []}
    lines = ["", "", "Resource handling for this message:"]
    for path in saved_files:
        lines.append(f"- uploaded file: {path}")
    for item in linked_resources:
        lines.append(f"- {item.get('mode', 'linked')} {item.get('category', 'resource')}: {item.get('path')} (source: {item.get('source')})")
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
        "resource_clues": resolutions if isinstance(resolutions, list) else [],
        "metadata_files": metadata_files,
    }


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
    return {
        "files": attachments,
        "session": start_research_run(
            chat_research_prompt(message),
            "chat",
            resume=True,
            settings_payload=payload.get("settings"),
            display_prompt=display_message,
        ),
    }


def start_research_resume_from_trial(payload: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("message", "")).strip()
    message, attachments = attach_message_resources(payload, message)
    return start_resume_from_trial(payload, message, attachments)


def append_local_command_result(command: str, message: str) -> dict[str, Any]:
    append_transcript("user", "user", "User", command, "ui.command", False)
    append_transcript("assistant", "assistant", "CoAutoResearch", message, "ui.command.result", False)
    return {"local": True, "session": research_session_snapshot()}


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
    if normalized == "/goal pause":
        gate = read_autoresearch_gate()
        if gate_has_passed(gate):
            with RESEARCH_LOCK:
                RESEARCH_SESSION["loop_active"] = False
                RESEARCH_SESSION["loop_stop_reason"] = "all_reviewer_gates_passed"
                RESEARCH_SESSION["gate"] = gate
            persist_research_session()
            return append_local_command_result(command, "The autoresearch goal is already passed; there is no active loop to pause.")
        with RESEARCH_LOCK:
            RESEARCH_SESSION["loop_active"] = False
            RESEARCH_SESSION["loop_stop_reason"] = "paused_by_user"
        persist_research_session()
        return append_local_command_result(
            command,
            "Paused the autoresearch goal loop. If the agent is already in the middle of a turn, that turn can finish, but the UI will not auto-start the next iteration.",
        )
    if normalized == "/goal clear":
        with RESEARCH_LOCK:
            RESEARCH_SESSION["loop_active"] = False
            RESEARCH_SESSION["loop_iteration"] = 0
            RESEARCH_SESSION["loop_stop_reason"] = "cleared_by_user"
        persist_research_session()
        return append_local_command_result(
            command,
            "Cleared the UI goal loop state. The project files and STATE.md gate were not deleted.",
        )
    if normalized == "/goal restart":
        result = start_restart_autoresearch({"message": command, "settings": settings_payload})
        result["local"] = True
        return result
    if normalized == "/goal resume":
        with RESEARCH_LOCK:
            proc = RESEARCH_SESSION.get("process")
            running = bool(proc and proc.poll() is None)
        cleanup = {"archived": []}
        if not running:
            cleanup = archive_interrupted_trial_tail("goal_resume_from_closed_boundary")
        ensure_autoresearch_gate_for_loop()
        gate = read_autoresearch_gate()
        if gate_has_passed(gate):
            with RESEARCH_LOCK:
                RESEARCH_SESSION["loop_active"] = False
                RESEARCH_SESSION["loop_stop_reason"] = "all_reviewer_gates_passed"
                RESEARCH_SESSION["gate"] = gate
            persist_research_session()
            return append_local_command_result(command, "The autoresearch goal is already passed; no new iteration was started.")
        settings = normalize_research_settings(settings_payload)
        review_checkpoint_interval = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
        with RESEARCH_LOCK:
            live_iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
        current_iteration = live_iteration if running and live_iteration > 0 else latest_active_trial_iteration()
        next_iteration = next_active_trial_iteration()
        with RESEARCH_LOCK:
            RESEARCH_SESSION["loop_active"] = True
            RESEARCH_SESSION["loop_stop_reason"] = ""
            RESEARCH_SESSION["settings"] = settings
            RESEARCH_SESSION["loop_max_iterations"] = review_checkpoint_interval
            RESEARCH_SESSION["loop_review_checkpoint_iteration"] = current_iteration + review_checkpoint_interval
        persist_research_session()
        if running:
            return append_local_command_result(command, "Goal loop resumed. The next iteration will start after the current agent turn finishes.")
        archived = cleanup.get("archived") or []
        if archived:
            append_local_command_result(
                command,
                "Archived interrupted trial tail before resuming from the last closed trial: "
                + ", ".join(item["from"] for item in archived),
            )
        resume_same_session = should_resume_research_session()
        return {
            "local": True,
            "session": start_research_run(
                continue_autoresearch_loop_prompt(gate, next_iteration, bool(settings.get("fastMode"))),
                "goal",
                resume=resume_same_session,
                settings_payload=settings,
                display_prompt=command,
                loop_active=True,
                reset_review_checkpoint=True,
                loop_iteration_override=next_iteration,
            ),
        }
    return None


def start_research_command(payload: dict[str, Any]) -> dict[str, Any]:
    command = str(payload.get("command", "")).strip()
    if not command:
        raise ValueError("Command is required.")
    if not command.startswith("/"):
        command = f"/{command}"
    normalized = re.sub(r"\s+", " ", command.lower()).strip()
    local = handle_local_slash_command(command, normalized, payload.get("settings"))
    if local is not None:
        return local
    loop_active: bool | None = None
    if normalized in {"/goal pause", "/goal clear"}:
        loop_active = False
    elif normalized == "/goal resume":
        loop_active = True
    return {"session": start_research_run(command, "command", resume=True, settings_payload=payload.get("settings"), loop_active=loop_active)}


def stop_research_session() -> dict[str, Any]:
    with RESEARCH_LOCK:
        RESEARCH_SESSION["loop_active"] = False
        RESEARCH_SESSION["loop_stop_reason"] = "stopped_by_user"
        proc = RESEARCH_SESSION.get("process")
    if proc and proc.poll() is None:
        proc.terminate()
        append_research_log("Stop requested from UI.")
        with RESEARCH_LOCK:
            RESEARCH_SESSION["status"] = "stopping"
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

    def send_json(self, payload: Any, status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def request_project_id(self, parsed: Any, payload: dict[str, Any] | None = None) -> str:
        query = parse_qs(parsed.query)
        project_id = query.get("project", [""])[0]
        if not project_id and payload:
            project_id = str(payload.get("project") or payload.get("projectId") or "")
        return unquote(str(project_id or "")).strip()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
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
        if not parsed.path.startswith("/api/"):
            self.serve_static(parsed.path)
            return
        try:
            with using_project(self.request_project_id(parsed)):
                if parsed.path == "/api/health":
                    context = current_project_context()
                    self.send_json({"ok": True, "repo_root": str(REPO_ROOT), "project": context.summary(), "time": now_iso()})
                    return
                if parsed.path == "/api/overview":
                    self.send_json(build_overview())
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
                if parsed.path == "/api/research/session":
                    self.send_json({"session": research_session_snapshot()})
                    return
                if parsed.path == "/api/framing/messages":
                    self.send_json({"ok": True, "messages": load_framing_messages()})
                    return
                if parsed.path == "/api/settings":
                    self.send_json({"ok": True, "settings": public_ui_settings(), "secret_keys": SECRET_ENV_KEYS})
                    return
                if parsed.path == "/api/agent/models":
                    query = parse_qs(parsed.query)
                    backend = normalize_agent_backend(query.get("backend", [""])[0])
                    self.send_json({"ok": True, **agent_available_models(backend)})
                    return
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        if parsed.path.startswith("/api/"):
            self.send_json({"error": "Unknown API route"}, status=404)
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
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
                if parsed.path == "/api/research/resume-from-trial":
                    self.send_json({"ok": True, "result": start_research_resume_from_trial(payload)})
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
                if parsed.path == "/api/settings":
                    self.send_json({"ok": True, "settings": save_ui_settings(payload), "secret_keys": SECRET_ENV_KEYS})
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
    global PROJECT_REGISTRY
    parser = argparse.ArgumentParser(description="Run the CoAutoResearch local web UI.")
    parser.add_argument("--host", default=os.environ.get("AUTO_RESEARCH_UI_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("AUTO_RESEARCH_UI_PORT", "8765")))
    parser.add_argument("--project-root", default=os.environ.get("COAUTO_PROJECT_ROOT", ""))
    parser.add_argument("--projects-dir", default=os.environ.get("COAUTO_PROJECTS_DIR", ""))
    args = parser.parse_args()

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
