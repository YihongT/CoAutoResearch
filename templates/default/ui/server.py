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
import subprocess
import sys
import threading
import time
import uuid
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
AUTO_RESOURCE_SEARCH_MAX_RESULTS = 8
AUTO_RESOURCE_SEARCH_MAX_DIRS = 2500
AUTO_RESOURCE_SEARCH_MAX_DEPTH = 5
AUTO_RESOURCE_SKIP_DIRS = {
    ".cache",
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


def template_root_for_project_creation() -> Path:
    candidates = [PACKAGE_TEMPLATE_ROOT, DEFAULT_PROJECT_ROOT]
    for candidate in candidates:
        if not candidate:
            continue
        root = candidate.resolve()
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
        with context.lock:
            proc = context.session.get("process")
            running = bool(proc and proc.poll() is None)
        if running:
            raise ValueError("Stop the active Codex run before deleting this project.")
        root = context.root.resolve()
        shutil.rmtree(root)
        self.refresh()
        projects = self.summaries()
        return {
            "deleted_project_id": project_id,
            "active_project_id": projects[0]["id"] if projects else "",
            "projects": projects,
            "multi_project": self.multi_project,
        }


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
RESEARCH_SESSION = DynamicDict(lambda: current_project_context().session)
RESEARCH_LOCK = DynamicLock()

DEFAULT_CODEX_SETTINGS = {
    "model": "gpt-5.5",
    "reasoningEffort": "medium",
    "permissionPreset": "default",
    "sandbox": "workspace-write",
    "approvalPolicy": "on-request",
    "webSearch": True,
    "extraConfig": "",
    "reviewCheckpointInterval": DEFAULT_REVIEW_CHECKPOINT_INTERVAL,
}
ALLOWED_CODEX_MODELS = {"gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"}
SECRET_ENV_KEYS = [
    "GITHUB_TOKEN",
    "HF_TOKEN",
]

ALLOWED_SANDBOXES = {"read-only", "workspace-write", "danger-full-access"}
ALLOWED_APPROVAL_POLICIES = {"untrusted", "on-request", "never"}
ALLOWED_REASONING_EFFORTS = {"low", "medium", "high", "xhigh"}
PERMISSION_PRESETS = {
    "default": {"sandbox": "workspace-write", "approvalPolicy": "on-request"},
    "auto-review": {"sandbox": "workspace-write", "approvalPolicy": "never"},
    "full-access": {"sandbox": "danger-full-access", "approvalPolicy": "never"},
}


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


def normalize_review_checkpoint_interval(value: Any) -> int:
    try:
        interval = int(str(value).strip())
    except (TypeError, ValueError):
        return DEFAULT_REVIEW_CHECKPOINT_INTERVAL
    return interval if interval > 0 else DEFAULT_REVIEW_CHECKPOINT_INTERVAL


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
    "data_sources": "resources/data_sources",
    "other": "resources/other",
}


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def now_id() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def persist_research_session() -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with RESEARCH_LOCK:
        payload = {key: value for key, value in RESEARCH_SESSION.items() if key != "process"}
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
        ):
            if key in payload:
                RESEARCH_SESSION[key] = payload[key]
        previous_status = str(payload.get("status") or "idle")
        RESEARCH_SESSION["status"] = "interrupted" if previous_status in {"running", "stopping"} else previous_status
        RESEARCH_SESSION["process"] = None


def load_ui_settings() -> dict[str, Any]:
    settings = {"codex": dict(DEFAULT_CODEX_SETTINGS), "env": {}}
    if not UI_SETTINGS_PATH.exists():
        return settings
    try:
        payload = json.loads(UI_SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return settings
    if isinstance(payload.get("codex"), dict):
        for key, value in payload["codex"].items():
            if key not in DEFAULT_CODEX_SETTINGS:
                continue
            if key == "model":
                model = str(value).strip()
                if model in ALLOWED_CODEX_MODELS:
                    settings["codex"][key] = model
                continue
            if key == "approvalPolicy":
                approval = str(value).strip()
                settings["codex"][key] = approval if approval in ALLOWED_APPROVAL_POLICIES else DEFAULT_CODEX_SETTINGS["approvalPolicy"]
                continue
            if key == "permissionPreset":
                preset = str(value).strip()
                settings["codex"][key] = preset if preset in PERMISSION_PRESETS else DEFAULT_CODEX_SETTINGS["permissionPreset"]
                continue
            if key == "reviewCheckpointInterval":
                settings["codex"][key] = normalize_review_checkpoint_interval(value)
                continue
            settings["codex"][key] = value
        settings["codex"]["reasoningEffort"] = (
            settings["codex"]["reasoningEffort"]
            if settings["codex"]["reasoningEffort"] in ALLOWED_REASONING_EFFORTS
            else DEFAULT_CODEX_SETTINGS["reasoningEffort"]
        )
        settings["codex"] = apply_permission_preset(settings["codex"])
    if isinstance(payload.get("env"), dict):
        settings["env"] = {key: str(value) for key, value in payload["env"].items() if key in SECRET_ENV_KEYS and str(value)}
    return settings


def public_ui_settings() -> dict[str, Any]:
    settings = load_ui_settings()
    return {
        "codex": settings["codex"],
        "env_present": {key: bool(settings["env"].get(key)) for key in SECRET_ENV_KEYS},
        "env_masked": {key: ("Saved" if settings["env"].get(key) else "") for key in SECRET_ENV_KEYS},
    }


def save_ui_settings(payload: dict[str, Any]) -> dict[str, Any]:
    current = load_ui_settings()
    codex = payload.get("codex") if isinstance(payload.get("codex"), dict) else {}
    merged_codex = dict(current["codex"])
    for key in DEFAULT_CODEX_SETTINGS:
        if key in codex:
            if key == "model":
                model = str(codex[key]).strip()
                merged_codex[key] = model if model in ALLOWED_CODEX_MODELS else DEFAULT_CODEX_SETTINGS["model"]
            elif key == "approvalPolicy":
                approval = str(codex[key]).strip()
                merged_codex[key] = approval if approval in ALLOWED_APPROVAL_POLICIES else DEFAULT_CODEX_SETTINGS["approvalPolicy"]
            elif key == "permissionPreset":
                preset = str(codex[key]).strip()
                merged_codex[key] = preset if preset in PERMISSION_PRESETS else DEFAULT_CODEX_SETTINGS["permissionPreset"]
            elif key == "reasoningEffort":
                reasoning = str(codex[key]).strip()
                merged_codex[key] = reasoning if reasoning in ALLOWED_REASONING_EFFORTS else DEFAULT_CODEX_SETTINGS["reasoningEffort"]
            elif key == "reviewCheckpointInterval":
                merged_codex[key] = normalize_review_checkpoint_interval(codex[key])
            else:
                merged_codex[key] = codex[key]
    merged_codex = apply_permission_preset(merged_codex)

    env_values = payload.get("env") if isinstance(payload.get("env"), dict) else {}
    merged_env = dict(current["env"])
    for key in payload.get("clear_env", []) if isinstance(payload.get("clear_env"), list) else []:
        if key in SECRET_ENV_KEYS:
            merged_env.pop(key, None)
    for key, value in env_values.items():
        if key in SECRET_ENV_KEYS and str(value).strip():
            merged_env[key] = str(value).strip()

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    UI_SETTINGS_PATH.write_text(json.dumps({"codex": merged_codex, "env": merged_env}, ensure_ascii=False, indent=2), encoding="utf-8")
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


def codex_process_env() -> dict[str, str]:
    env = os.environ.copy()
    env.update(load_ui_settings().get("env", {}))
    return env


def codex_executable_names(windows: bool | None = None) -> list[str]:
    is_windows = os.name == "nt" if windows is None else windows
    if is_windows:
        return ["codex.cmd", "codex.exe", "codex.bat", "codex"]
    return ["codex"]


def resolve_codex_executable(env: dict[str, str] | None = None, windows: bool | None = None) -> str:
    process_env = env if env is not None else os.environ
    search_path = process_env.get("PATH") or None
    configured = str(process_env.get("COAUTO_CODEX") or process_env.get("CODEX_BIN") or "").strip().strip('"')
    if configured:
        expanded = os.path.expandvars(os.path.expanduser(configured))
        configured_path = Path(expanded)
        if configured_path.is_file():
            return str(configured_path)
        found = shutil.which(expanded, path=search_path)
        if found:
            return found
        raise FileNotFoundError(
            f"Configured Codex executable was not found: {configured}. "
            "Set COAUTO_CODEX to the full path of codex.cmd, codex.exe, or codex."
        )

    for name in codex_executable_names(windows):
        found = shutil.which(name, path=search_path)
        if found:
            return found
    names = ", ".join(codex_executable_names(windows))
    raise FileNotFoundError(
        f"Codex CLI executable not found on PATH. Tried: {names}. "
        "Install Codex CLI, start the UI from a terminal where `codex --version` works, "
        "or set COAUTO_CODEX to the full path of codex.cmd/codex."
    )


def codex_start_error_message(exc: OSError, command: list[str]) -> str:
    executable = command[0] if command else "codex"
    if isinstance(exc, FileNotFoundError) or getattr(exc, "winerror", None) == 2:
        return (
            "Failed to start Codex: executable not found. "
            f"Tried `{executable}`. On Windows, npm installs Codex as `codex.cmd`; "
            "start the UI from a terminal where `codex --version` works, or set "
            "COAUTO_CODEX to the full path of codex.cmd."
        )
    return f"Failed to start Codex using `{executable}`: {exc}"


def executable_requires_windows_shell(executable: str, windows: bool | None = None) -> bool:
    is_windows = os.name == "nt" if windows is None else windows
    return is_windows and Path(str(executable)).suffix.lower() in {".cmd", ".bat"}


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
            return {"role": "command", "kind": "command", "title": "Codex command", "content": stripped.removeprefix("Started:").strip(), "raw_type": "process.started", "editable": False}
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


def rel_path(path: Path) -> str:
    root = REPO_ROOT.absolute()
    absolute = path if path.is_absolute() else REPO_ROOT / path
    try:
        return absolute.absolute().relative_to(root).as_posix()
    except ValueError:
        return absolute.resolve().relative_to(REPO_ROOT.resolve()).as_posix()


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
        path = repo_path(relative_path)
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
        line = raw_line.strip().lower().rstrip(":")
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


def directory_tree(relative_dir: str, max_depth: int | None = None, exclude_names: set[str] | None = None) -> dict[str, Any]:
    root_path = repo_path(relative_dir)
    root = tree_node(Path(relative_dir).name or relative_dir, relative_dir, "directory")
    if not root_path.exists() or not root_path.is_dir():
        return root

    nodes: dict[str, dict[str, Any]] = {relative_dir: root}
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
        parent = nodes.get(parent_relative)
        if not parent:
            continue
        node_type = "directory" if path.is_dir() else "file"
        node = tree_node(path.name, relative, node_type, path.is_symlink())
        if path.is_file():
            try:
                node.update(file_card(path, relative))
            except OSError:
                continue
        nodes[relative] = node
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
    return {
        "one_sentence": first_meaningful_line(extract_section(project_text, "One-Sentence Project Summary")),
        "goal": first_meaningful_line(extract_section(project_text, "Research Goal")),
        "motivation": first_meaningful_line(extract_section(project_text, "Motivation")),
        "target": value_after_label(target_section, "Current target") or "Not specified",
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

    claims = [section for section in sections if section["title"].lower().startswith("c") and real_section(section)]
    figure_sections = [section for section in sections if section["title"].lower().startswith("figure") and real_section(section)]
    table_sections = [section for section in sections if section["title"].lower().startswith("table") and real_section(section)]
    figure_specs = [section for section in extract_sections(figure_text) if real_section(section)]
    return {
        "target": clean_summary_value(first_meaningful_line(extract_section(blueprint_text, "Target Venue / Audience"))),
        "contribution": clean_summary_value(first_meaningful_line(extract_section(blueprint_text, "Contribution Style"))),
        "core_story": clean_summary_value(first_meaningful_line(extract_section(blueprint_text, "Core Story"))),
        "claims": claims,
        "section_blueprint": [section for section in sections if section["title"].lower().startswith("section") and real_section(section)],
        "figures": figure_sections,
        "tables": table_sections,
        "missing_evidence": [item for item in list_section_items(extract_section(blueprint_text, "Missing Evidence")) if meaningful_summary_value(item)][:12],
        "figure_specs": figure_specs[:10],
    }


def infer_trial_status(plan: str, review: str, report: str) -> str:
    combined = "\n".join([plan, review, report]).lower()
    if "blocked" in combined:
        return "blocked"
    if report.strip() and "placeholder" not in report.lower() and "<" not in first_meaningful_line(report, ""):
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


def collect_trials() -> list[dict[str, Any]]:
    direct_root = REPO_ROOT / "research_trajectory" / "trials"
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
            plan = safe_read(trial_dir / "PLAN.md")
            review_path = trial_review_path(trial_dir)
            review = safe_read(review_path) if review_path else ""
            report = safe_read(trial_dir / "REPORT.md")
            objective = first_meaningful_line(extract_section(plan, "Objective"), "Objective not recorded")
            artifacts_dir = trial_dir / "artifacts"
            artifacts = []
            if artifacts_dir.exists():
                artifacts = [file_card(p) for p in artifacts_dir.rglob("*") if p.is_file() and p.name != ".gitkeep"]
            trials.append(
                {
                    "id": trial_dir.name,
                    "epoch": epoch,
                    "path": rel_path(trial_dir),
                    "objective": objective,
                    "status": infer_trial_status(plan, review, report),
                    "verdict": review_verdict(review),
                    "plan_path": rel_path(trial_dir / "PLAN.md") if (trial_dir / "PLAN.md").exists() else "",
                    "review_path": rel_path(review_path) if review_path else "",
                    "report_path": rel_path(trial_dir / "REPORT.md") if (trial_dir / "REPORT.md").exists() else "",
                    "report_summary": trial_report_summary(report),
                    "manuscript_implications": first_meaningful_line(extract_section(report, "Manuscript Implications"), "No manuscript implications recorded"),
                    "artifacts": artifacts,
                }
            )
    return trials


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
    review_paths.extend(("trial_review", path) for path in REPO_ROOT.glob("research_trajectory/trials/*/REVIEW.md"))
    review_paths.extend(("trial_review", path) for path in REPO_ROOT.glob("research_trajectory/trials/*/PLAN_REVIEW.md"))
    review_paths.extend(("trial_review", path) for path in REPO_ROOT.glob("research_trajectory/*/trials/*/REVIEW.md"))
    review_paths.extend(("trial_review", path) for path in REPO_ROOT.glob("research_trajectory/*/trials/*/PLAN_REVIEW.md"))
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


def build_overview() -> dict[str, Any]:
    if PROJECT_REGISTRY and PROJECT_REGISTRY.multi_project:
        PROJECT_REGISTRY.refresh()
    context = current_project_context()
    project = read_text_file("PROJECT.md")
    state = read_text_file("research_trajectory/STATE.md")
    blueprint = read_text_file("manuscript/BLUEPRINT.md")
    figure_specs = read_text_file("manuscript/figures/FIGURE_SPECS.md")
    initial_brief = read_text_file("resources/user_input/INITIAL_BRIEF.md")
    project_text = project.get("text", "")
    state_text = state.get("text", "")
    blueprint_text = blueprint.get("text", "")
    figure_text = figure_specs.get("text", "")
    return {
        "active_project_id": context.id,
        "project": context.summary(),
        "projects": PROJECT_REGISTRY.summaries() if PROJECT_REGISTRY else [context.summary()],
        "multi_project": bool(PROJECT_REGISTRY and PROJECT_REGISTRY.multi_project),
        "repo_root": str(REPO_ROOT),
        "generated_at": now_iso(),
        "files": {
            "project": project,
            "state": state,
            "blueprint": blueprint,
            "figure_specs": figure_specs,
            "initial_brief": initial_brief,
        },
        "cold_start_files": [cold_start_file_for_ui(path, project_text) for path in COLD_START_EDIT_FILES],
        "summaries": {
            "project": project_summary(project_text),
            "state": state_summary(state_text),
            "manuscript": manuscript_summary(blueprint_text, figure_text),
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
                inferred_count += 1
                continue
            if isinstance(candidates, list) and candidates:
                limited = ", ".join(f"`{candidate}`" for candidate in candidates[:5])
                resource_lines.append(f"- `{status}` clue: `{reference}`; candidates: {limited}")
                inferred_count += 1
            elif reference:
                resource_lines.append(f"- `{status}` clue: `{reference}`")
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
            attached_count += 1
    for path in saved_files:
        if path:
            resource_lines.append(f"- upload copied: `{path}`")
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
        resource_lines.append("- Inferred text references are resource clues for Codex resource intake; they were not attached automatically by the UI server.")
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
    settings = dict(DEFAULT_CODEX_SETTINGS)
    settings.update(load_ui_settings().get("codex", {}))

    if "model" in payload:
        model = str(payload.get("model", "")).strip()
        settings["model"] = model if model in ALLOWED_CODEX_MODELS else DEFAULT_CODEX_SETTINGS["model"]

    if "reasoningEffort" in payload:
        reasoning = str(payload.get("reasoningEffort", "")).strip()
        settings["reasoningEffort"] = reasoning if reasoning in ALLOWED_REASONING_EFFORTS else DEFAULT_CODEX_SETTINGS["reasoningEffort"]

    if "permissionPreset" in payload:
        preset = str(payload.get("permissionPreset", "")).strip()
        settings["permissionPreset"] = preset if preset in PERMISSION_PRESETS else DEFAULT_CODEX_SETTINGS["permissionPreset"]

    if "sandbox" in payload:
        sandbox = str(payload.get("sandbox", settings["sandbox"])).strip()
        if sandbox in ALLOWED_SANDBOXES:
            settings["sandbox"] = sandbox

    if "approvalPolicy" in payload:
        approval = str(payload.get("approvalPolicy", settings["approvalPolicy"])).strip()
        if approval in ALLOWED_APPROVAL_POLICIES:
            settings["approvalPolicy"] = approval

    if "webSearch" in payload:
        settings["webSearch"] = bool(payload.get("webSearch"))

    if "extraConfig" in payload:
        extra_config = str(payload.get("extraConfig", "")).strip()
        settings["extraConfig"] = extra_config[:4000]
    if "reviewCheckpointInterval" in payload:
        settings["reviewCheckpointInterval"] = normalize_review_checkpoint_interval(payload.get("reviewCheckpointInterval"))
    settings["reasoningEffort"] = settings["reasoningEffort"] if settings["reasoningEffort"] in ALLOWED_REASONING_EFFORTS else DEFAULT_CODEX_SETTINGS["reasoningEffort"]
    settings["reviewCheckpointInterval"] = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
    return apply_permission_preset(settings)


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


def normalize_gate_status(value: str) -> str:
    text = value.strip().lower()
    if not text:
        return "missing"
    if re.search(r"\b(blocked|needs_human|human|clarification)\b", text):
        return "blocked"
    normalized = text.replace("_", " ").replace("-", " ")
    if re.search(r"\b(not\s+pass|not\s+passed|not\s+ready|needs\s+work|needs\s+follow\s+up|follow\s+up|continue|running|revise|revision\s+required|targeted\s+revision|architecture|partial|qualified|qualification|supported\s+with\s+qualification|plausible|approved|complete|completed|ready|pass\s+for)\b", normalized):
        return "continue"
    if re.match(r"^(strict\s+)?pass(?:\s*$|\s*[:.;,]\s*|\s+-\s+)", text):
        return "pass"
    if re.match(r"^(all[_\s-]?passed)(?:\s*$|\s*[:.;,]\s*|\s+-\s+)", text):
        return "pass"
    if re.search(r"\b(fail|failed)\b", text):
        return "continue"
    return text.split()[0]


REQUIRED_REVIEWER_GATES = {
    "plan": "Plan reviewer",
    "process": "Process reviewer",
    "evidence": "Evidence reviewer",
    "venue_fit": "Venue fit reviewer",
    "manuscript": "Manuscript reviewer",
    "figure_table": "Figure/table reviewer",
    "final_gate": "Final gate reviewer",
}


def reviewer_gate_key(label: str) -> str:
    clean = re.sub(r"[^a-z/ ]+", " ", label.lower())
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


def read_autoresearch_gate() -> dict[str, Any]:
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
    status = overall_status
    if overall_status == "pass" and not all_reviewers_passed:
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
        "summary": "\n".join(reviewer_lines) if reviewer_lines else first_meaningful_line(section, "Gate section exists."),
        "path": str(RESEARCH_STATE_PATH.relative_to(REPO_ROOT)),
    }


def gate_has_passed(gate: dict[str, Any]) -> bool:
    if gate.get("status") != "pass":
        return False
    reviewer_statuses = gate.get("reviewer_statuses")
    if not isinstance(reviewer_statuses, dict):
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
- Plan reviewer: continue
- Process reviewer: continue
- Evidence reviewer: continue
- Venue fit reviewer: continue
- Manuscript reviewer: continue
- Figure/table reviewer: continue
- Final gate reviewer: continue

Next action: start or continue the next coherent autoresearch iteration.
"""
    RESEARCH_STATE_PATH.write_text(upsert_markdown_section(existing, "Autoresearch Goal Gate", section), encoding="utf-8")


def ensure_autoresearch_gate_for_loop() -> None:
    gate = read_autoresearch_gate()
    if not gate.get("exists") or gate.get("status") == "pass":
        write_initial_autoresearch_gate()


def research_session_snapshot() -> dict[str, Any]:
    gate = read_autoresearch_gate()
    with RESEARCH_LOCK:
        RESEARCH_SESSION["gate"] = gate
        loop_active = bool(RESEARCH_SESSION.get("loop_active"))
        loop_stop_reason = RESEARCH_SESSION.get("loop_stop_reason", "")
        loop_iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
        settings = dict(RESEARCH_SESSION.get("settings") or {})
        review_checkpoint_interval = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
        loop_review_checkpoint_iteration = int(RESEARCH_SESSION.get("loop_review_checkpoint_iteration") or 0)
        if loop_review_checkpoint_iteration <= 0:
            loop_review_checkpoint_iteration = loop_iteration + review_checkpoint_interval
        if gate_has_passed(gate):
            loop_active = False
            loop_stop_reason = "all_reviewer_gates_passed"
            RESEARCH_SESSION["loop_active"] = False
            RESEARCH_SESSION["loop_stop_reason"] = loop_stop_reason
        return {
            "id": RESEARCH_SESSION.get("id", ""),
            "session_id": RESEARCH_SESSION.get("session_id", ""),
            "status": RESEARCH_SESSION.get("status", "idle"),
            "mode": RESEARCH_SESSION.get("mode", ""),
            "command": " ".join(RESEARCH_SESSION.get("command", [])),
            "settings": dict(RESEARCH_SESSION.get("settings") or {}),
            "started_at": RESEARCH_SESSION.get("started_at", ""),
            "ended_at": RESEARCH_SESSION.get("ended_at", ""),
            "returncode": RESEARCH_SESSION.get("returncode"),
            "logs": list(RESEARCH_SESSION.get("logs", []))[-500:],
            "raw_logs": list(RESEARCH_SESSION.get("raw_logs", []))[-2000:],
            "transcript": list(RESEARCH_SESSION.get("transcript", []))[-600:],
            "loop_active": loop_active,
            "loop_iteration": loop_iteration,
            "loop_max_iterations": int(RESEARCH_SESSION.get("loop_max_iterations") or AUTORESEARCH_MAX_ITERATIONS),
            "loop_review_checkpoint_iteration": loop_review_checkpoint_iteration,
            "review_checkpoint_interval": review_checkpoint_interval,
            "loop_stop_reason": loop_stop_reason,
            "gate": gate,
        }


def append_research_log(line: str) -> None:
    display = format_codex_event(line)
    transcript = transcript_from_codex_line(line)
    with RESEARCH_LOCK:
        if line.strip():
            RESEARCH_SESSION["raw_logs"].append(line.rstrip("\n"))
        if display:
            RESEARCH_SESSION["logs"].append(display)
        if transcript and transcript.get("content"):
            RESEARCH_SESSION["transcript"].append(transcript_entry(**transcript))
        session_id = ""
        try:
            session_id = find_uuid(json.loads(line))
        except json.JSONDecodeError:
            session_id = find_uuid(line)
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


def continue_autoresearch_loop_prompt(gate: dict[str, Any]) -> str:
    status = gate.get("raw_status") or gate.get("status") or "missing"
    summary = gate.get("summary") or "No reviewer gate summary yet."
    return f"""/goal resume

Continue the autoresearch loop in this same Codex session.

Current autoresearch gate status: {status}

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
- relevant reviewer instructions under instructions/reviewers/
- instructions/reviewers/FINAL_GATE_REVIEWER.md

If the `Autoresearch Goal Gate` section in `research_trajectory/STATE.md` says `Status: pass` and every required reviewer gate is a strict pass, including the Final gate reviewer, do not create a new trial. Report that the autoresearch goal has passed all reviewer gates.

Otherwise, run exactly the next coherent autoresearch iteration needed to move the gate toward pass:
1. create the next trial under research_trajectory/trials/;
2. write PLAN.md before execution;
3. apply the relevant reviewer instructions;
4. execute mainly in workspace/;
5. write REPORT.md;
6. update STATE.md, CURRENT_FINDINGS.md, manuscript-facing files, and notes only when genuinely changed;
7. update the `Autoresearch Goal Gate` section in research_trajectory/STATE.md at the end.

Do not stop merely because one trial completed, a plan was approved, a manuscript architecture is coherent, a venue fit is plausible, or evidence is supported with qualification. Stop only when all required reviewer gates are strict pass with no blocking issues, required actions, unresolved qualifications, active revision constraints, or critical unassessed areas."""


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
        stop_autoresearch_loop(f"codex_failed_returncode_{returncode}", gate)
        append_research_log(f"Autoresearch loop stopped because Codex exited with return code {returncode}.")
        return
    if gate_has_passed(gate):
        stop_autoresearch_loop("all_reviewer_gates_passed", gate)
        append_research_log("Autoresearch loop complete: all reviewer gates passed.")
        return
    if gate.get("status") == "blocked":
        stop_autoresearch_loop("gate_requires_human_input", gate)
        append_research_log("Autoresearch loop paused because the gate requires human input.")
        return
    checkpoint_iteration = current_review_checkpoint_iteration(settings)
    if iteration >= checkpoint_iteration:
        stop_autoresearch_loop("review_checkpoint_reached", gate)
        append_research_log(
            f"Autoresearch loop paused for human review at iteration {iteration}; reviewer gates have not all passed."
        )
        return
    append_research_log(
        f"Autoresearch gate is {gate.get('raw_status') or gate.get('status')}; resuming same Codex session for iteration {iteration + 1}."
    )
    start_research_run(
        continue_autoresearch_loop_prompt(gate),
        "goal",
        resume=True,
        settings_payload=settings,
        display_prompt=f"Continue autoresearch loop (iteration {iteration + 1}).",
        loop_active=True,
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
    finish_research_run(returncode)
    maybe_continue_autoresearch_loop(returncode)


def codex_command_for_prompt(resume: bool, settings: dict[str, Any]) -> list[str]:
    session_id = str(RESEARCH_SESSION.get("session_id") or "")
    codex = resolve_codex_executable()
    if resume:
        if not session_id:
            raise ValueError("No Codex exec session is active in this UI. Start project framing first.")
        command = [codex, "exec", "resume", *settings_to_codex_args(settings, resume=True), "--skip-git-repo-check", "--json"]
        command.append(session_id)
        command.append("-")
        return command
    return [codex, "exec", *settings_to_codex_args(settings, resume=False), "--skip-git-repo-check", "--json", "-"]


def should_resume_research_session() -> bool:
    return bool(str(RESEARCH_SESSION.get("session_id") or "").strip())


def start_research_run(
    prompt: str,
    mode: str,
    resume: bool,
    settings_payload: Any | None = None,
    display_prompt: str | None = None,
    loop_active: bool | None = None,
    reset_review_checkpoint: bool = False,
) -> dict[str, Any]:
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("Prompt is required.")
    settings = normalize_research_settings(settings_payload)
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        if proc and proc.poll() is None:
            raise ValueError("A Codex run is already active.")
        previous_session_id = str(RESEARCH_SESSION.get("session_id") or "")
        command = codex_command_for_prompt(resume, settings)
        previous_loop_iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
        next_loop_active = bool(RESEARCH_SESSION.get("loop_active")) if loop_active is None else bool(loop_active)
        next_loop_iteration = previous_loop_iteration + 1 if next_loop_active and mode == "goal" else previous_loop_iteration
        review_checkpoint_interval = normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval"))
        loop_review_checkpoint_iteration = int(RESEARCH_SESSION.get("loop_review_checkpoint_iteration") or 0)
        if next_loop_active and (reset_review_checkpoint or loop_review_checkpoint_iteration <= 0):
            loop_review_checkpoint_iteration = previous_loop_iteration + review_checkpoint_interval
        if not resume:
            RESEARCH_SESSION["logs"] = []
            RESEARCH_SESSION["raw_logs"] = []
            RESEARCH_SESSION["transcript"] = []
        RESEARCH_SESSION.update(
            {
                "id": f"S{now_id()}_{slugify(mode, 'research')}",
                "session_id": previous_session_id if resume else "",
                "status": "running",
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
            env=codex_process_env(),
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
        append_research_log(codex_start_error_message(exc, command))
        finish_research_run(127)
        return research_session_snapshot()

    with RESEARCH_LOCK:
        RESEARCH_SESSION["process"] = proc
    append_research_log(f"Started: {' '.join(command)}")
    context = current_project_context()
    thread = threading.Thread(target=run_in_project, args=(context, process_research_run, proc), daemon=True)
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


def autoresearch_goal_prompt() -> str:
    return """/goal

Start the autoresearch loop from the current PROJECT.md as the goal.

This is after the user-facing framing pass. Do not rerun cold-start framing just to rewrite PROJECT.md.

Use the repository instructions:
- read AGENTS.md
- read instructions/EXECUTION_AGENT.md
- read PROJECT.md
- read research_trajectory/STATE.md
- read research_trajectory/CURRENT_FINDINGS.md
- inspect resources only as needed for the next coherent research objective
- read instructions/reviewers/REVIEW_TAXONOMY.md
- read the reviewer instructions under instructions/reviewers/
- read instructions/reviewers/FINAL_GATE_REVIEWER.md
- create or update the `Autoresearch Goal Gate` section in research_trajectory/STATE.md

This is not complete after one trial. Run the next autoresearch iteration and maintain the reviewer gate:
1. choose one coherent next research objective;
2. create the next trial under research_trajectory/trials/;
3. write PLAN.md before execution;
4. apply the relevant reviewer instructions;
5. execute primarily in workspace/;
6. write REPORT.md after execution;
7. update STATE.md, CURRENT_FINDINGS.md, manuscript-facing files, or notes only when their current state genuinely changes;
8. update the `Autoresearch Goal Gate` section in research_trajectory/STATE.md with:
   - `Status: pass`, `continue`, `blocked`, or `needs_human`;
   - one line for each required reviewer gate: Plan, Process, Evidence, Venue fit, Manuscript, Figure/table, Final gate;
   - the next action if any gate is not pass.

Required reviewer gates must all be strict `pass` before the autoresearch goal is complete, including the Final gate reviewer. If any reviewer gate is not pass, or if any blocking issue, required action, unresolved qualification, active revision constraint, or critical unassessed area remains, set `Status: continue` unless human input is truly required.

Do not treat "approved", "completed", "ready", "plausible", "architecture pass", "supported with qualification", or "targeted revision ready" as pass. Those are partial results unless the relevant reviewer standard and Final gate standard are fully satisfied.

Treat PROJECT.md as the current goal definition. If PROJECT.md is insufficient or contradictory, ask for clarification in the final message and set `Status: needs_human` instead of silently inventing a different project."""


def continue_research_prompt(message: str = "") -> str:
    extra = message.strip()
    if extra:
        return f"""Continue the active CoAutoResearch project in this same Codex exec session.

User instruction:
{extra}

Follow AGENTS.md and research_trajectory/STATE.md. If the latest user instruction or RESOURCE_MANIFEST.md contains new resource clues, follow instructions/RESOURCE_INTAKE.md before treating those materials as attached.

If the user is asking a question, asking for an explanation, or asking what the project is about, answer directly from the current project files and do not modify repository files. Only update files when the user explicitly asks for a change, asks you to continue research work, or gives an instruction that requires edits. Report either the answer or what changed."""
    return """Continue the next coherent CoAutoResearch iteration in this same Codex exec session.

Follow AGENTS.md and research_trajectory/STATE.md. If the latest user instruction or RESOURCE_MANIFEST.md contains new resource clues, follow instructions/RESOURCE_INTAKE.md before treating those materials as attached. Check pending interventions, choose the next coherent objective, execute it, update repository files as needed, and report what changed."""


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
        raise ValueError("Launch must be confirmed from Step 2 before starting Codex.")
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
    session = start_research_run(
        autoresearch_goal_prompt(),
        "goal",
        resume=resume,
        settings_payload=payload.get("settings"),
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
    if message.startswith("/"):
        return start_research_command({"command": message, "settings": payload.get("settings")})
    display_message = message
    message, attachments = attach_message_resources(payload, message)
    if not display_message and any(attachments.get(key) for key in ("saved_files", "resource_links", "resource_clues", "metadata_files")):
        display_message = "Attached resources."
    return {
        "files": attachments,
        "session": start_research_run(
            continue_research_prompt(message),
            "chat",
            resume=True,
            settings_payload=payload.get("settings"),
            display_prompt=display_message,
        ),
    }


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


def latest_codex_usage() -> dict[str, Any]:
    usage: dict[str, Any] = {}
    limits: list[dict[str, Any]] = []
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
        if isinstance(event_usage, dict) and event_usage:
            usage = dict(event_usage)
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
    return {"usage": usage, "limits": limits, "raw_log_count": len(raw_logs)}


def build_status_payload() -> dict[str, Any]:
    session = research_session_snapshot()
    gate = session.get("gate") or {}
    settings = session.get("settings") or {}
    goal_loop = "passed" if gate_has_passed(gate) else "active" if session.get("loop_active") else "paused"
    stop_reason = session.get("loop_stop_reason") or ""
    if gate_has_passed(gate) and not session.get("loop_active"):
        stop_reason = "all_reviewer_gates_passed"
    completed_trials = [
        trial
        for trial in collect_trials()
        if trial.get("report_path") and not re.match(r"^0*_?project_conversion", str(trial.get("id") or ""), re.IGNORECASE)
    ]
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        pid = proc.pid if proc and proc.poll() is None else None
        command = " ".join(RESEARCH_SESSION.get("command", []))
    codex_usage = latest_codex_usage()
    return {
        "kind": "status_card",
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
            "model": settings.get("model") or "",
            "reasoning": settings.get("reasoningEffort") or "",
            "permission": settings.get("permissionPreset") or infer_permission_preset(settings),
            "sandbox": settings.get("sandbox") or "",
            "approval": settings.get("approvalPolicy") or "",
            "web_search": bool(settings.get("webSearch")),
            "review_checkpoint_interval": normalize_review_checkpoint_interval(settings.get("reviewCheckpointInterval")),
        },
        "process": {
            "active": bool(pid),
            "pid": pid,
            "command": command,
        },
        "events": {
            "transcript": len(session.get("transcript") or []),
            "raw_logs": codex_usage.get("raw_log_count") or 0,
        },
        "usage": codex_usage.get("usage") or {},
        "limits": codex_usage.get("limits") or [],
        "limitations": [] if codex_usage.get("limits") else ["Not available from codex exec --json events. Use /status in an active Codex CLI session or the Codex usage dashboard for remaining limits."],
    }


def local_status_message() -> str:
    return json.dumps(build_status_payload(), ensure_ascii=False)


def local_ps_message() -> str:
    with RESEARCH_LOCK:
        proc = RESEARCH_SESSION.get("process")
        pid = proc.pid if proc and proc.poll() is None else None
        command = " ".join(RESEARCH_SESSION.get("command", []))
        status = RESEARCH_SESSION.get("status", "idle")
    if not pid:
        return f"No active Codex process. Session status: {status}."
    return f"Active Codex process: pid {pid}\n{command}"


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
            "Paused the autoresearch goal loop. If Codex is already in the middle of a turn, that turn can finish, but the UI will not auto-start the next iteration.",
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
    if normalized == "/goal resume":
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
            proc = RESEARCH_SESSION.get("process")
            running = bool(proc and proc.poll() is None)
            current_iteration = int(RESEARCH_SESSION.get("loop_iteration") or 0)
            RESEARCH_SESSION["loop_active"] = True
            RESEARCH_SESSION["loop_stop_reason"] = ""
            RESEARCH_SESSION["settings"] = settings
            RESEARCH_SESSION["loop_max_iterations"] = review_checkpoint_interval
            RESEARCH_SESSION["loop_review_checkpoint_iteration"] = current_iteration + review_checkpoint_interval
        persist_research_session()
        if running:
            return append_local_command_result(command, "Goal loop resumed. The next iteration will start after the current Codex turn finishes.")
        return {
            "local": True,
            "session": start_research_run(
                continue_autoresearch_loop_prompt(gate),
                "goal",
                resume=True,
                settings_payload=settings,
                display_prompt=command,
                loop_active=True,
                reset_review_checkpoint=True,
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
                    self.serve_repo_file(unquote(relative))
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
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=400)
            return
        if parsed.path.startswith("/api/"):
            self.send_json({"error": "Unknown API route"}, status=404)
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        try:
            payload = self.read_json()
            parsed = urlparse(self.path)
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
            with using_project(self.request_project_id(parsed, payload)):
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

    def serve_repo_file(self, relative_path: str) -> None:
        try:
            path = repo_path(relative_path)
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
        self.send_header("Content-Disposition", f'inline; filename="{path.name}"')
        self.end_headers()
        self.wfile.write(data)

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
