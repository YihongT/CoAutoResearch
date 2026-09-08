"""Small, non-secret operations primitives for CoAutoResearch v2.

The module deliberately does not copy project files into diagnostics or support
bundles.  It reports selected metadata, protects recovery evidence, and makes
every destructive retention action an explicit, revalidated operation.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import stat
from typing import Any, Mapping
import unicodedata
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import uuid
import zipfile

try:
    from .v2_artifacts import validate_artifact
    from .v2_contracts import SCHEMA_VERSION
    from .v2_transaction import (
        coherent_read,
        current_revision,
        recover_incomplete_transactions,
        transaction_health,
    )
except ImportError:  # Direct imports from templates/default/ui.
    from v2_artifacts import validate_artifact  # type: ignore
    from v2_contracts import SCHEMA_VERSION  # type: ignore
    from v2_transaction import (  # type: ignore
        coherent_read,
        current_revision,
        recover_incomplete_transactions,
        transaction_health,
    )


OPERATIONS_VERSION = "2.0.0-ops-001"
PROTOCOL_VERSION = "2.0"
SUPPORT_BUNDLE_VERSION = "2.0"
PROJECT_BACKUP_VERSION = "2.0"
RESTORE_RECOVERY_VERSION = "1.0"
RESTORE_RECOVERY_RELATIVE = ".co-auto-research/RESTORE_RECOVERY.json"
RESTORE_MANIFEST_RELATIVE = ".co-auto-research/RESTORE_MANIFEST.json"
RESTORE_ACKNOWLEDGEMENT_RELATIVE = (
    ".co-auto-research/RESTORE_ACKNOWLEDGEMENT.json"
)
DEFAULT_MIN_FREE_BYTES = 256 * 1024 * 1024
MAX_BACKUP_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_BACKUP_FILES = 200_000
MAX_BACKUP_RESOURCE_LINKS = 10_000
_ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
_TXN_ID = re.compile(r"^TXN-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$")
_TRIAL_ID = re.compile(r"^[0-9]{6}_[a-z0-9][a-z0-9-]{0,79}$")
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_TRANSACTION_STATES = {
    "created",
    "prepared",
    "applying",
    "committed",
    "rolled_back",
    "failed",
}
_TERMINAL_TRANSACTION_STATES = {"committed", "rolled_back"}
_TERMINAL_MIGRATION_STATES = {"committed", "rolled_back"}
_RETENTION_KEYS = (
    "staging_days",
    "transaction_audit_days",
    "screenshots_days",
    "logs_days",
    "checkpoints_days",
    "migration_backups_days",
)
DEFAULT_RETENTION_POLICY: dict[str, Any] = {
    **{key: None for key in _RETENTION_KEYS},
    "allow_migration_backup_prune": False,
}

_PROJECT_BACKUP_ROOTS = (
    ("project_configuration", ".co-auto-research"),
    ("template_configuration", ".co-auto-research-template"),
    ("instructions", "instructions"),
    ("schemas", "schemas"),
    ("requirements", "requirements"),
    ("canonical_and_trials", "research_trajectory"),
    ("resources", "resources"),
    ("manuscript", "manuscript"),
    ("domain_experts", "domain_experts"),
    ("migration_recovery", "archive/v2_migrations"),
)
_PROJECT_BACKUP_FILES = (
    ("project_configuration", "AGENTS.md"),
    ("project_configuration", "PROJECT.md"),
)
_PROJECT_BACKUP_EXCLUDED_PREFIXES = (
    "research_trajectory/.staging/",
    "research_trajectory/.transactions/",
    "research_trajectory/.guard/",
    "research_trajectory/.runtime/",
)
_PROJECT_BACKUP_ALLOWED_FILES = {
    "AGENTS.md",
    "PROJECT.md",
    "ui/.runtime/settings.json",
}
_PROJECT_BACKUP_EXCLUDED_FILES = {
    RESTORE_RECOVERY_RELATIVE,
    RESTORE_MANIFEST_RELATIVE,
    RESTORE_ACKNOWLEDGEMENT_RELATIVE,
}
_PROJECT_BACKUP_ALLOWED_ROOTS = tuple(
    relative.rstrip("/") for _category, relative in _PROJECT_BACKUP_ROOTS
)
_PROJECT_BACKUP_REQUIRED_FILES = {
    ".co-auto-research/project.json",
    ".co-auto-research-template/manifest.json",
    "schemas/common.schema.json",
    "schemas/canonical-revision.schema.json",
    "schemas/project-state.schema.json",
    "schemas/publish-receipt.schema.json",
    "research_trajectory/CANONICAL_REVISION.json",
    "research_trajectory/STATE.json",
}
_SECRET_KEY = re.compile(
    r"(?:secret|token|password|passwd|api[_-]?key|credential|authorization|cookie)",
    re.IGNORECASE,
)
_OPAQUE_RUNTIME_KEY = re.compile(
    r"^(?:extraconfig|(?:pre|post)?exec(?:ution)?(?:script|command)|"
    r"(?:pre|post|startup|shutdown)(?:script|command|hook))$",
    re.IGNORECASE,
)


class OperationsError(RuntimeError):
    """An operations request was unsafe or could not be completed."""


def _project_root(project_root: str | Path) -> Path:
    root = Path(project_root).resolve(strict=True)
    if not root.is_dir():
        raise OperationsError("project root is not a directory")
    return root


def _json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def _read_object(path: Path, *, limit: int = 2 * 1024 * 1024) -> dict[str, Any] | None:
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
            return None
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _safe_text(value: Any, pattern: re.Pattern[str], default: str = "") -> str:
    text = str(value or "").strip()
    return text if pattern.fullmatch(text) else default


def _utc_now() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def _package_version(root: Path) -> str:
    candidates = [
        root / "package.json",
        Path(__file__).resolve().parents[3] / "package.json",
    ]
    for candidate in candidates:
        value = _read_object(candidate)
        version = str((value or {}).get("version") or "").strip()
        if re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}", version):
            return version
    return "unknown"


def version_report(project_root: str | Path) -> dict[str, str]:
    """Return only public version identifiers."""

    root = _project_root(project_root)
    template = _read_object(root / ".co-auto-research-template" / "manifest.json") or {}
    instructions = (
        _read_object(root / "instructions" / ".co-auto-research-instructions.json")
        or {}
    )
    template_version = str(template.get("templateVersion") or "unknown")
    reviewer_version = str(
        instructions.get("reviewerBaselineVersion")
        or template.get("reviewerBaselineVersion")
        or "unknown"
    )
    safe_version = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$")
    return {
        "package": _package_version(root),
        "template": (
            template_version if safe_version.fullmatch(template_version) else "unknown"
        ),
        "protocol": PROTOCOL_VERSION,
        "schema": str(SCHEMA_VERSION),
        "reviewer_baseline": (
            reviewer_version if safe_version.fullmatch(reviewer_version) else "unknown"
        ),
        "operations": OPERATIONS_VERSION,
    }


def check_disk_space(
    project_root: str | Path,
    required_bytes: int = DEFAULT_MIN_FREE_BYTES,
) -> dict[str, Any]:
    """Report whether the filesystem can safely accept ``required_bytes``."""

    root = _project_root(project_root)
    if (
        isinstance(required_bytes, bool)
        or not isinstance(required_bytes, int)
        or required_bytes < 0
    ):
        raise OperationsError("required_bytes must be a non-negative integer")
    usage = shutil.disk_usage(root)
    return {
        "ok": usage.free >= required_bytes,
        "required_bytes": required_bytes,
        "free_bytes": usage.free,
        "total_bytes": usage.total,
    }


def require_disk_space(project_root: str | Path, required_bytes: int) -> dict[str, Any]:
    result = check_disk_space(project_root, required_bytes)
    if not result["ok"]:
        raise OperationsError("insufficient free disk space")
    return result


_SENSITIVE_PATHS = {
    "environment_file": ".env",
    "secret_directory": "secrets",
    "runtime_directory": "ui/.runtime",
    "runtime_settings": "ui/.runtime/settings.json",
    "staging_directory": "research_trajectory/.staging",
    "transaction_directory": "research_trajectory/.transactions",
    "migration_backups": "archive/template_migrations",
}


def permission_report(project_root: str | Path) -> dict[str, Any]:
    """Report modes for sensitive paths without exposing their contents."""

    root = _project_root(project_root)
    entries: list[dict[str, Any]] = []
    for name, relative in _SENSITIVE_PATHS.items():
        path = root / relative
        present = path.exists() or path.is_symlink()
        entry: dict[str, Any] = {"name": name, "present": present}
        if present:
            try:
                metadata = path.lstat()
                mode = stat.S_IMODE(metadata.st_mode)
                kind = (
                    "symlink"
                    if stat.S_ISLNK(metadata.st_mode)
                    else (
                        "directory"
                        if stat.S_ISDIR(metadata.st_mode)
                        else "file" if stat.S_ISREG(metadata.st_mode) else "other"
                    )
                )
                entry.update(
                    {
                        "kind": kind,
                        "mode": (
                            f"{mode:04o}" if os.name == "posix" else "platform-managed"
                        ),
                        "private": kind != "symlink"
                        and (os.name != "posix" or mode & 0o077 == 0),
                    }
                )
            except OSError:
                entry.update(
                    {"kind": "unreadable", "mode": "unknown", "private": False}
                )
        entries.append(entry)
    return {
        "supported": os.name == "posix",
        "ok": all(entry.get("private", True) for entry in entries),
        "entries": entries,
    }


def configuration_presence(project_root: str | Path) -> dict[str, bool]:
    """Return configuration presence only; values are never loaded."""

    root = _project_root(project_root)
    return {
        "project_metadata": (root / ".co-auto-research" / "project.json").is_file(),
        "template_manifest": (
            root / ".co-auto-research-template" / "manifest.json"
        ).is_file(),
        "instruction_manifest": (
            root / "instructions" / ".co-auto-research-instructions.json"
        ).is_file(),
        "runtime_settings": (root / "ui" / ".runtime" / "settings.json").is_file(),
        "environment_file": (root / ".env").is_file(),
        "project_schemas": (root / "schemas" / "common.schema.json").is_file(),
    }


def _revision_summary(root: Path) -> dict[str, Any]:
    path = root / "research_trajectory" / "CANONICAL_REVISION.json"
    value = _read_object(path) or {}
    return {
        "revision": current_revision(root),
        "project_id": _safe_text(value.get("project_id"), _SAFE_ID),
        "published_trial_id": _safe_text(value.get("published_trial_id"), _TRIAL_ID),
        "transaction_id": _safe_text(value.get("transaction_id"), _TXN_ID),
    }


def _gate_status(root: Path, trial_id: str) -> str:
    if not trial_id:
        return "missing"
    value = _read_object(
        root / "research_trajectory" / "trials" / trial_id / "GOAL_GATE.json"
    )
    status_value = str((value or {}).get("status") or "")
    return (
        status_value
        if status_value
        in {"continue", "pass", "needs_human", "paused_budget", "no_viable_path"}
        else "missing"
    )


def readiness(
    project_root: str | Path,
    *,
    min_free_bytes: int = DEFAULT_MIN_FREE_BYTES,
) -> dict[str, Any]:
    """Build a non-secret local readiness payload."""

    root = _project_root(project_root)
    diagnostics: list[str] = []
    try:
        health = transaction_health(root)
    except Exception:
        health = {
            "lock_state": "unknown",
            "recovery_required": True,
            "incomplete_transaction_ids": [],
            "last_transaction_id": None,
            "last_published_revision": None,
        }
        diagnostics.append("transaction_health_unavailable")
    try:
        revision = _revision_summary(root)
    except Exception:
        revision = {
            "revision": None,
            "project_id": "",
            "published_trial_id": "",
            "transaction_id": "",
        }
        diagnostics.append("canonical_revision_unavailable")
    try:
        disk = check_disk_space(root, min_free_bytes)
    except Exception:
        disk = {
            "ok": False,
            "required_bytes": min_free_bytes,
            "free_bytes": None,
            "total_bytes": None,
        }
        diagnostics.append("disk_probe_failed")
    permissions = permission_report(root)
    active_trial_id = _active_trial_id(root)
    if not permissions["ok"]:
        diagnostics.append("sensitive_permissions_not_private")
    if not disk["ok"]:
        diagnostics.append("insufficient_disk_space")
    if health.get("recovery_required"):
        status_value = "recovery_required"
    elif diagnostics:
        status_value = "degraded"
    else:
        status_value = "ready"
    return {
        "status": status_value,
        "timestamp": _utc_now(),
        "versions": version_report(root),
        "project": {"id": revision["project_id"]},
        "canonical_revision": revision["revision"],
        "active_trial_id": active_trial_id,
        "latest_published_trial_id": revision["published_trial_id"],
        "latest_transaction_id": revision["transaction_id"],
        "gate_status": _gate_status(
            root, active_trial_id or revision["published_trial_id"]
        ),
        "transaction_health": health,
        "disk": disk,
        "permissions": permissions,
        "configuration_present": configuration_presence(root),
        "diagnostics": sorted(set(diagnostics)),
    }


def _transaction_summaries(root: Path) -> list[dict[str, Any]]:
    base = root / "research_trajectory" / ".transactions"
    if not base.is_dir() or base.is_symlink():
        return []
    result: list[dict[str, Any]] = []
    for directory in sorted(base.iterdir(), key=lambda path: path.name):
        if not _TXN_ID.fullmatch(directory.name):
            continue
        summary: dict[str, Any] = {
            "transaction_id": directory.name,
            "manifest_present": False,
            "commit_marker_present": False,
            "state": "unprepared",
            "operation_count": 0,
        }
        if directory.is_symlink() or not directory.is_dir():
            summary["state"] = "untrustworthy"
            result.append(summary)
            continue
        manifest = _read_object(directory / "TRANSACTION_MANIFEST.json")
        summary["manifest_present"] = manifest is not None
        summary["commit_marker_present"] = (directory / "COMMITTED.json").is_file()
        if manifest is None:
            if (directory / "TRANSACTION_MANIFEST.json").exists():
                summary["state"] = "unreadable"
        else:
            state_value = str(manifest.get("state") or "")
            summary["state"] = (
                state_value if state_value in _TRANSACTION_STATES else "invalid"
            )
            operations = manifest.get("operations")
            summary["operation_count"] = (
                len(operations) if isinstance(operations, list) else 0
            )
        result.append(summary)
    return result


def recovery_diagnostics(
    project_root: str | Path,
    *,
    apply: bool = False,
) -> dict[str, Any]:
    """List transaction recovery state and optionally run idempotent recovery."""

    root = _project_root(project_root)
    before = _transaction_summaries(root)
    result: dict[str, Any] = {
        "apply": bool(apply),
        "before": before,
        "actions": [],
        "error_code": None,
    }
    if apply:
        try:
            result["actions"] = recover_incomplete_transactions(root)
        except Exception as exc:
            result["error_code"] = type(exc).__name__
    result["after"] = _transaction_summaries(root)
    try:
        result["transaction_health"] = transaction_health(root)
    except Exception as exc:
        result["transaction_health"] = {
            "recovery_required": True,
            "error_code": type(exc).__name__,
        }
    return result


def _normalize_policy(policy: Mapping[str, Any] | None) -> dict[str, Any]:
    raw = dict(policy or {})
    unknown = set(raw) - set(DEFAULT_RETENTION_POLICY)
    if unknown:
        raise OperationsError(
            f"unknown retention policy keys: {', '.join(sorted(unknown))}"
        )
    normalized = dict(DEFAULT_RETENTION_POLICY)
    for key in _RETENTION_KEYS:
        value = raw.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise OperationsError(f"{key} must be a non-negative integer or null")
        normalized[key] = value
    allow = raw.get("allow_migration_backup_prune", False)
    if not isinstance(allow, bool):
        raise OperationsError("allow_migration_backup_prune must be boolean")
    normalized["allow_migration_backup_prune"] = allow
    return normalized


def _active_trial_id(root: Path) -> str:
    state = _read_object(root / "research_trajectory" / "STATE.json") or {}
    direct = _safe_text(state.get("active_trial_id"), _TRIAL_ID)
    if direct:
        return direct
    match = re.fullmatch(
        r"research_trajectory/trials/([^/]+)/GOAL_GATE\.json",
        str(state.get("goal_gate_path") or ""),
    )
    return _safe_text(match.group(1), _TRIAL_ID) if match else ""


def _has_symlink(path: Path) -> bool:
    if path.is_symlink():
        return True
    if not path.is_dir():
        return False
    try:
        return any(child.is_symlink() for child in path.rglob("*"))
    except OSError:
        return True


def _candidate_fingerprint(path: Path) -> str | None:
    """Hash names and metadata so apply notices activity inside a directory."""

    try:
        paths = [path]
        if path.is_dir():
            paths.extend(sorted(path.rglob("*"), key=lambda child: child.as_posix()))
        digest = hashlib.sha256()
        for child in paths:
            metadata = child.lstat()
            relative = "." if child == path else child.relative_to(path).as_posix()
            digest.update(
                _json_bytes(
                    [
                        relative,
                        stat.S_IFMT(metadata.st_mode),
                        stat.S_IMODE(metadata.st_mode),
                        metadata.st_size,
                        metadata.st_mtime_ns,
                    ]
                )
            )
        return digest.hexdigest()
    except (OSError, ValueError):
        return None


def _entry(
    root: Path,
    path: Path,
    category: str,
    decision: str,
    reason: str,
) -> dict[str, Any]:
    try:
        metadata = path.lstat()
        kind = (
            "symlink"
            if stat.S_ISLNK(metadata.st_mode)
            else (
                "directory"
                if stat.S_ISDIR(metadata.st_mode)
                else "file" if stat.S_ISREG(metadata.st_mode) else "other"
            )
        )
        mtime_ns: int | None = metadata.st_mtime_ns
    except OSError:
        kind = "missing"
        mtime_ns = None
    return {
        "relative_path": path.relative_to(root).as_posix(),
        "category": category,
        "decision": decision,
        "reason": reason,
        "kind": kind,
        "mtime_ns": mtime_ns,
        "fingerprint": _candidate_fingerprint(path) if decision == "delete" else None,
    }


def _age_decision(path: Path, cutoff: float | None) -> tuple[str, str]:
    if cutoff is None:
        return "retain", "no_explicit_retention_window"
    if _has_symlink(path):
        return "retain", "symlink_requires_manual_review"
    try:
        old = path.lstat().st_mtime <= cutoff
    except OSError:
        return "retain", "unreadable_requires_manual_review"
    return (
        ("delete", "older_than_retention_window")
        if old
        else ("retain", "within_retention_window")
    )


def _direct_children(path: Path) -> list[Path]:
    if not path.is_dir() or path.is_symlink():
        return []
    try:
        return sorted(path.iterdir(), key=lambda child: child.name)
    except OSError:
        return []


def _retention_plan_body(
    root: Path,
    policy: dict[str, Any],
    evaluated_at: datetime,
) -> dict[str, Any]:
    now_epoch = evaluated_at.timestamp()
    entries: list[dict[str, Any]] = []

    active_trial = _active_trial_id(root)
    staging = root / "research_trajectory" / ".staging"
    staging_days = policy["staging_days"]
    staging_cutoff = None if staging_days is None else now_epoch - staging_days * 86400
    for candidate in _direct_children(staging):
        if not active_trial:
            decision, reason = "retain", "active_trial_unknown"
        elif candidate.name == active_trial:
            decision, reason = "retain", "active_trial_staging"
        else:
            decision, reason = _age_decision(candidate, staging_cutoff)
        entries.append(_entry(root, candidate, "staging", decision, reason))

    transactions = root / "research_trajectory" / ".transactions"
    for candidate in _direct_children(transactions):
        if _TXN_ID.fullmatch(candidate.name):
            manifest = _read_object(candidate / "TRANSACTION_MANIFEST.json") or {}
            state_value = str(manifest.get("state") or "unprepared")
            reason = (
                "terminal_transaction_recovery_evidence"
                if state_value in _TERMINAL_TRANSACTION_STATES
                else "active_or_incomplete_transaction"
            )
            entries.append(
                _entry(root, candidate, "transaction_audit", "retain", reason)
            )

    category_roots = {
        "screenshots": (
            "screenshots_days",
            (
                root / "release-evidence" / "screenshots",
                root / "ui" / ".runtime" / "screenshots",
            ),
        ),
        "logs": (
            "logs_days",
            (root / "ui" / ".runtime" / "logs", root / "release-evidence" / "logs"),
        ),
        "checkpoints": (
            "checkpoints_days",
            (
                root / "research_trajectory" / "checkpoints",
                root / "ui" / ".runtime" / "checkpoints",
            ),
        ),
    }
    for category, (key, roots) in category_roots.items():
        days = policy[key]
        cutoff = None if days is None else now_epoch - days * 86400
        for base in roots:
            for candidate in _direct_children(base):
                decision, reason = _age_decision(candidate, cutoff)
                entries.append(_entry(root, candidate, category, decision, reason))

    migrations = _direct_children(root / "archive" / "template_migrations")
    migration_states = {
        candidate: str(
            (_read_object(candidate / "MIGRATION_MANIFEST.json") or {}).get("state")
            or ""
        )
        for candidate in migrations
    }
    latest_committed = max(
        (
            candidate
            for candidate in migrations
            if migration_states[candidate] == "committed"
        ),
        key=lambda path: (path.lstat().st_mtime_ns, path.name),
        default=None,
    )
    latest_terminal = max(
        (
            candidate
            for candidate in migrations
            if migration_states[candidate] in _TERMINAL_MIGRATION_STATES
        ),
        key=lambda path: (path.lstat().st_mtime_ns, path.name),
        default=None,
    )
    migration_days = policy["migration_backups_days"]
    migration_cutoff = (
        None if migration_days is None else now_epoch - migration_days * 86400
    )
    for candidate in migrations:
        state_value = migration_states[candidate]
        if candidate == latest_committed:
            decision, reason = "retain", "latest_known_migration_backup"
        elif candidate == latest_terminal:
            decision, reason = "retain", "latest_terminal_migration_evidence"
        elif not policy["allow_migration_backup_prune"]:
            decision, reason = "retain", "migration_prune_scope_not_enabled"
        elif state_value not in _TERMINAL_MIGRATION_STATES:
            decision, reason = "retain", "incomplete_or_unreadable_migration"
        else:
            decision, reason = _age_decision(candidate, migration_cutoff)
        entries.append(_entry(root, candidate, "migration_backups", decision, reason))

    revision = root / "research_trajectory" / "CANONICAL_REVISION.json"
    if revision.exists() or revision.is_symlink():
        entries.append(
            _entry(
                root, revision, "published_state", "retain", "latest_canonical_revision"
            )
        )
    revision_value = _read_object(revision) or {}
    trial_id = _safe_text(revision_value.get("published_trial_id"), _TRIAL_ID)
    if trial_id:
        for suffix in ("json", "md"):
            receipt = (
                root
                / "research_trajectory"
                / "trials"
                / trial_id
                / f"PUBLISH_RECEIPT.{suffix}"
            )
            if receipt.exists() or receipt.is_symlink():
                entries.append(
                    _entry(
                        root,
                        receipt,
                        "published_state",
                        "retain",
                        "latest_publish_receipt",
                    )
                )

    entries.sort(key=lambda item: (item["relative_path"], item["category"]))
    body: dict[str, Any] = {
        "schema_version": PROTOCOL_VERSION,
        "kind": "retention_plan",
        "dry_run": True,
        "root_id": hashlib.sha256(str(root).encode("utf-8")).hexdigest(),
        "evaluated_at": evaluated_at.astimezone(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "policy": policy,
        "entries": entries,
        "delete_count": sum(item["decision"] == "delete" for item in entries),
    }
    return body


def retention_plan(
    project_root: str | Path,
    policy: Mapping[str, Any] | None = None,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return a dry-run plan.  The default policy deletes nothing."""

    root = _project_root(project_root)
    evaluated_at = now or datetime.now(timezone.utc)
    if evaluated_at.tzinfo is None:
        raise OperationsError("now must be timezone-aware")
    body = _retention_plan_body(root, _normalize_policy(policy), evaluated_at)
    return {**body, "plan_id": hashlib.sha256(_json_bytes(body)).hexdigest()}


def _validate_plan(root: Path, plan: Mapping[str, Any]) -> None:
    provided = str(plan.get("plan_id") or "")
    body = {key: value for key, value in plan.items() if key != "plan_id"}
    expected = hashlib.sha256(_json_bytes(body)).hexdigest()
    if not re.fullmatch(r"[a-f0-9]{64}", provided) or provided != expected:
        raise OperationsError("retention plan integrity check failed")
    if plan.get("kind") != "retention_plan":
        raise OperationsError("unsupported retention plan")
    if plan.get("root_id") != hashlib.sha256(str(root).encode("utf-8")).hexdigest():
        raise OperationsError("retention plan belongs to another project")


def _remove_retention_candidate(root: Path, relative: str) -> None:
    candidate = root.joinpath(*relative.split("/"))
    resolved_parent = candidate.parent.resolve(strict=True)
    if resolved_parent != root and root not in resolved_parent.parents:
        raise OperationsError("retention candidate escapes the project")
    if candidate.is_symlink() or _has_symlink(candidate):
        raise OperationsError("retention candidate contains a symlink")
    if candidate.is_dir():
        shutil.rmtree(candidate)
    elif candidate.is_file():
        candidate.unlink()
    else:
        raise OperationsError("retention candidate is not a regular file or directory")


def apply_retention_plan(
    project_root: str | Path,
    plan: Mapping[str, Any],
    *,
    confirm: bool = False,
) -> dict[str, Any]:
    """Apply an intact plan after confirmation and current-state revalidation."""

    root = _project_root(project_root)
    if confirm is not True:
        raise OperationsError("retention apply requires confirm=True")
    _validate_plan(root, plan)
    try:
        evaluated_at = datetime.fromisoformat(
            str(plan["evaluated_at"]).replace("Z", "+00:00")
        )
    except (KeyError, ValueError) as exc:
        raise OperationsError("retention plan timestamp is invalid") from exc
    fresh = retention_plan(root, plan.get("policy"), now=evaluated_at)
    current = {
        item["relative_path"]: item
        for item in fresh["entries"]
        if item["decision"] == "delete"
    }
    results: list[dict[str, str]] = []
    entries = plan.get("entries")
    if not isinstance(entries, list):
        raise OperationsError("retention plan entries are invalid")
    for planned in entries:
        if not isinstance(planned, dict) or planned.get("decision") != "delete":
            continue
        relative = str(planned.get("relative_path") or "")
        path = root.joinpath(*relative.split("/"))
        if not path.exists() and not path.is_symlink():
            results.append({"relative_path": relative, "status": "already_missing"})
            continue
        live = current.get(relative)
        if (
            not live
            or live.get("category") != planned.get("category")
            or live.get("mtime_ns") != planned.get("mtime_ns")
            or live.get("fingerprint") != planned.get("fingerprint")
        ):
            results.append(
                {"relative_path": relative, "status": "retained_after_revalidation"}
            )
            continue
        try:
            _remove_retention_candidate(root, relative)
        except OperationsError:
            results.append({"relative_path": relative, "status": "retained_unsafe"})
        else:
            results.append({"relative_path": relative, "status": "deleted"})
    return {
        "plan_id": plan["plan_id"],
        "applied": True,
        "results": results,
        "deleted_count": sum(item["status"] == "deleted" for item in results),
    }


def _stable_support_readiness(root: Path) -> dict[str, Any]:
    value = readiness(root)
    health = value["transaction_health"]
    return {
        "status": value["status"],
        "versions": value["versions"],
        "canonical_revision": value["canonical_revision"],
        "active_trial_id": value["active_trial_id"],
        "latest_published_trial_id": value["latest_published_trial_id"],
        "latest_transaction_id": value["latest_transaction_id"],
        "gate_status": value["gate_status"],
        "transaction_health": {
            "lock_state": health.get("lock_state"),
            "recovery_required": bool(health.get("recovery_required")),
            "incomplete_transaction_ids": list(
                health.get("incomplete_transaction_ids") or []
            ),
            "last_transaction_id": health.get("last_transaction_id"),
            "last_published_revision": health.get("last_published_revision"),
        },
        "disk": {
            "ok": bool(value["disk"].get("ok")),
            "required_bytes": value["disk"].get("required_bytes"),
        },
        "permissions": value["permissions"],
        "configuration_present": value["configuration_present"],
        "diagnostics": value["diagnostics"],
    }


def _support_payloads(root: Path) -> dict[str, bytes]:
    recovery = recovery_diagnostics(root)
    retention = retention_plan(root)
    transactions = recovery["before"]
    return {
        "diagnostics/readiness.json": _json_bytes(_stable_support_readiness(root)),
        "diagnostics/recovery.json": _json_bytes(
            {
                "transactions": transactions[-50:],
                "transaction_count": len(transactions),
                "truncated": len(transactions) > 50,
                "recovery_required": bool(
                    recovery.get("transaction_health", {}).get("recovery_required")
                ),
                "error_code": recovery.get("error_code"),
            }
        ),
        "diagnostics/retention.json": _json_bytes(
            {
                "policy": retention["policy"],
                "counts": {
                    category: sum(
                        item["category"] == category for item in retention["entries"]
                    )
                    for category in sorted(
                        {item["category"] for item in retention["entries"]}
                    )
                },
                "delete_count": retention["delete_count"],
            }
        ),
        "versions.json": _json_bytes(version_report(root)),
    }


def _zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, _ZIP_TIMESTAMP)
    info.compress_type = zipfile.ZIP_STORED
    info.create_system = 3
    info.external_attr = 0o600 << 16
    return info


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _support_manifest(payloads: Mapping[str, bytes]) -> dict[str, Any]:
    return {
        "bundle_format": SUPPORT_BUNDLE_VERSION,
        "files": [
            {
                "path": name,
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
            for name, data in sorted(payloads.items())
        ],
        "privacy": {
            "generated_metadata_only": True,
            "project_private_contents_included": False,
            "raw_settings_included": False,
            "raw_logs_included": False,
            "transaction_snapshots_included": False,
        },
    }


def support_bundle_manifest(project_root: str | Path) -> dict[str, Any]:
    """Preview the generated-only files and hashes for a support bundle."""

    root = _project_root(project_root)
    return _support_manifest(_support_payloads(root))


def create_support_bundle(
    project_root: str | Path,
    destination: str | Path,
) -> dict[str, Any]:
    """Write a deterministic, generated-only support ZIP with mode ``0600``."""

    root = _project_root(project_root)
    target = Path(destination).expanduser().resolve(strict=False)
    if target.exists() and (target.is_dir() or target.is_symlink()):
        raise OperationsError("support bundle destination must be a regular file")
    target.parent.mkdir(parents=True, exist_ok=True)
    require_disk_space(root, 1024 * 1024)
    payloads = _support_payloads(root)
    manifest = _support_manifest(payloads)
    payloads["manifest.json"] = _json_bytes(manifest)
    temporary = target.parent / f".{target.name}.{uuid.uuid4().hex}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w+b") as handle:
            with zipfile.ZipFile(
                handle, "w", compression=zipfile.ZIP_STORED
            ) as archive:
                for name, data in sorted(payloads.items()):
                    archive.writestr(_zip_info(name), data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        if os.name == "posix":
            target.chmod(0o600)
    finally:
        try:
            temporary.unlink()
        except OSError:
            pass
    return {
        "path": str(target),
        "size": target.stat().st_size,
        "sha256": _sha256_file(target),
        "mode": (
            f"{stat.S_IMODE(target.stat().st_mode):04o}"
            if os.name == "posix"
            else "platform-managed"
        ),
        "manifest": manifest,
    }


def _backup_path_allowed(relative: str) -> bool:
    normalized = relative.replace("\\", "/").lstrip("/")
    if normalized in _PROJECT_BACKUP_EXCLUDED_FILES:
        return False
    if any(
        normalized == prefix.rstrip("/") or normalized.startswith(prefix)
        for prefix in _PROJECT_BACKUP_EXCLUDED_PREFIXES
    ):
        return False
    return normalized in _PROJECT_BACKUP_ALLOWED_FILES or any(
        normalized.startswith(f"{root}/") for root in _PROJECT_BACKUP_ALLOWED_ROOTS
    )


def _portable_path_key(relative: str) -> str:
    return unicodedata.normalize("NFC", relative).casefold()


_WINDOWS_INVALID_PATH_CHARACTERS = frozenset('<>:"|?*')
_WINDOWS_RESERVED_PATH_BASENAMES = {
    "AUX",
    "CLOCK$",
    "CON",
    "CONIN$",
    "CONOUT$",
    "NUL",
    "PRN",
}


def _portable_backup_relative(value: Any) -> str:
    relative = str(value or "").replace("\\", "/")
    parts = relative.split("/")
    if (
        not relative
        or relative.startswith("/")
        or any(part in {"", ".", ".."} for part in parts)
        or re.match(r"^[A-Za-z]:", relative)
    ):
        raise OperationsError("backup manifest contains an unsafe path")
    for part in parts:
        basename = part.split(".", 1)[0].rstrip(" .").upper()
        if (
            part.endswith((" ", "."))
            or any(
                ord(character) < 32
                or character in _WINDOWS_INVALID_PATH_CHARACTERS
                for character in part
            )
            or basename in _WINDOWS_RESERVED_PATH_BASENAMES
            or re.fullmatch(r"(?:COM|LPT)(?:[1-9¹²³])", basename)
        ):
            raise OperationsError(
                "project backup path is not portable across supported platforms: "
                f"{relative}"
            )
    return relative


def _require_unique_portable_paths(paths: list[str]) -> None:
    seen: dict[str, str] = {}
    for relative in paths:
        normalized = _portable_backup_relative(relative)
        if normalized != relative:
            raise OperationsError(
                "project backup path is not portable across supported platforms: "
                f"{relative}"
            )
        key = _portable_path_key(normalized)
        previous = seen.get(key)
        if previous is not None:
            raise OperationsError(
                f"project backup contains a case-insensitive path collision: "
                f"{previous} and {relative}"
            )
        seen[key] = relative


def _assert_no_symlink_components(root: Path, relative: str) -> Path:
    current = root
    if current.is_symlink():
        raise OperationsError("project backup root must not be a symlink")
    for part in Path(relative).parts:
        current = current / part
        if current.is_symlink():
            raise OperationsError(f"project backup refuses symlink: {relative}")
    return current


def _open_regular_beneath(root: Path, relative: str) -> int:
    """Open a regular file without following a payload symlink component."""

    relative = _safe_backup_relative(relative)
    no_follow = getattr(os, "O_NOFOLLOW", 0)
    directory_flag = getattr(os, "O_DIRECTORY", 0)
    descriptor: int | None = None
    try:
        if no_follow and os.open in getattr(os, "supports_dir_fd", set()):
            directory_fd: int | None = None
            try:
                directory_fd = os.open(
                    root, os.O_RDONLY | directory_flag | no_follow
                )
                parts = Path(relative).parts
                for part in parts[:-1]:
                    next_fd = os.open(
                        part,
                        os.O_RDONLY | directory_flag | no_follow,
                        dir_fd=directory_fd,
                    )
                    os.close(directory_fd)
                    directory_fd = next_fd
                descriptor = os.open(
                    parts[-1], os.O_RDONLY | no_follow, dir_fd=directory_fd
                )
            finally:
                if directory_fd is not None:
                    os.close(directory_fd)
        else:
            path = _assert_no_symlink_components(root, relative)
            descriptor = os.open(path, os.O_RDONLY | no_follow)
            _assert_no_symlink_components(root, relative)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise OperationsError(
                f"project backup payload is not a regular file: {relative}"
            )
        return descriptor
    except OperationsError:
        if descriptor is not None:
            os.close(descriptor)
        raise
    except OSError as exc:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise OperationsError(
            f"project backup payload is missing or untrustworthy: {relative}"
        ) from exc


def _regular_metadata_beneath(root: Path, relative: str) -> tuple[int, int]:
    descriptor = _open_regular_beneath(root, relative)
    try:
        metadata = os.fstat(descriptor)
        return metadata.st_size, stat.S_IMODE(metadata.st_mode)
    finally:
        os.close(descriptor)


def _hash_regular_beneath(root: Path, relative: str) -> tuple[int, str]:
    descriptor = _open_regular_beneath(root, relative)
    size = 0
    digest = hashlib.sha256()
    with os.fdopen(descriptor, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def _copy_regular_beneath(
    root: Path, relative: str, destination: Path
) -> tuple[int, str, int]:
    descriptor = _open_regular_beneath(root, relative)
    metadata = os.fstat(descriptor)
    digest = hashlib.sha256()
    size = 0
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with os.fdopen(descriptor, "rb") as source, destination.open("xb") as target:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                target.write(chunk)
                digest.update(chunk)
                size += len(chunk)
            target.flush()
            os.fsync(target.fileno())
    except Exception:
        try:
            destination.unlink()
        except OSError:
            pass
        raise
    return size, digest.hexdigest(), stat.S_IMODE(metadata.st_mode)


def _read_object_beneath(
    root: Path, relative: str, *, limit: int = 2 * 1024 * 1024
) -> dict[str, Any] | None:
    try:
        descriptor = _open_regular_beneath(root, relative)
        with os.fdopen(descriptor, "rb") as handle:
            if os.fstat(handle.fileno()).st_size > limit:
                return None
            value = json.loads(handle.read().decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, OperationsError):
        return None
    return value if isinstance(value, dict) else None


def _read_hashed_object_beneath(
    root: Path,
    relative: str,
    *,
    limit: int,
    label: str,
) -> tuple[dict[str, Any], str, bytes]:
    """Read and hash one regular JSON file through the same descriptor."""

    descriptor = _open_regular_beneath(root, relative)
    try:
        with os.fdopen(descriptor, "rb") as handle:
            if os.fstat(handle.fileno()).st_size > limit:
                raise OperationsError(f"{label} is too large")
            payload = handle.read(limit + 1)
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise
    if len(payload) > limit:
        raise OperationsError(f"{label} is too large")
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise OperationsError(f"{label} is invalid") from exc
    if not isinstance(value, dict):
        raise OperationsError(f"{label} is invalid")
    return value, hashlib.sha256(payload).hexdigest(), payload


def _resource_link(relative: str, path: Path, *, directory: bool) -> dict[str, Any]:
    try:
        target = os.readlink(path)
    except OSError as exc:
        raise OperationsError(
            f"project backup could not inspect resource link: {relative}"
        ) from exc
    if "\x00" in target or len(target) > 4096:
        raise OperationsError(f"project backup resource link is invalid: {relative}")
    return {
        "path": relative,
        "target": target,
        "link_type": "directory" if directory else "file",
        "restore_action": "operator_relink_required",
    }


def _backup_source_files(
    root: Path,
) -> tuple[list[tuple[str, str, Path]], list[dict[str, Any]]]:
    files: dict[str, tuple[str, str, Path]] = {}
    resource_links: dict[str, dict[str, Any]] = {}
    for category, relative in _PROJECT_BACKUP_FILES:
        path = root / relative
        if path.is_symlink():
            raise OperationsError(f"project backup refuses symlink: {relative}")
        if path.is_file():
            files[relative] = (category, relative, path)
    for category, relative_root in _PROJECT_BACKUP_ROOTS:
        directory = root / relative_root
        if directory.is_symlink():
            raise OperationsError(
                f"project backup refuses symlink: {relative_root}"
            )
        if not directory.is_dir():
            continue
        for current, directory_names, file_names in os.walk(
            directory, topdown=True, followlinks=False
        ):
            current_path = Path(current)
            directory_names.sort()
            file_names.sort()
            traversable: list[str] = []
            for name in directory_names:
                path = current_path / name
                child_relative = path.relative_to(root).as_posix()
                if path.is_symlink():
                    if child_relative.startswith("resources/"):
                        resource_links[child_relative] = _resource_link(
                            child_relative, path, directory=True
                        )
                        continue
                    raise OperationsError(
                        f"project backup refuses symlink: {child_relative}"
                    )
                traversable.append(name)
            directory_names[:] = traversable
            for name in file_names:
                path = current_path / name
                child_relative = path.relative_to(root).as_posix()
                if path.is_symlink():
                    if child_relative.startswith("resources/"):
                        resource_links[child_relative] = _resource_link(
                            child_relative, path, directory=False
                        )
                        continue
                    raise OperationsError(
                        f"project backup refuses symlink: {child_relative}"
                    )
                if path.is_file() and _backup_path_allowed(child_relative):
                    files[child_relative] = (category, child_relative, path)
    paths = sorted([*files, *resource_links])
    _require_unique_portable_paths(paths)
    return (
        [files[key] for key in sorted(files)],
        [resource_links[key] for key in sorted(resource_links)],
    )


def _redact_runtime_string(value: str) -> str:
    if "://" not in value:
        return value
    try:
        parsed = urlsplit(value)
        if not parsed.scheme or not parsed.netloc:
            return value
        query = parse_qsl(parsed.query, keep_blank_values=True)
        redacted_query = [
            (key, "[redacted]" if _SECRET_KEY.search(key) else child)
            for key, child in query
        ]
        has_userinfo = (
            parsed.username is not None
            or parsed.password is not None
            or "@" in parsed.netloc
        )
        query_changed = redacted_query != query
        if not has_userinfo and not query_changed:
            return value
        hostname = parsed.hostname
        if not hostname:
            return "[redacted]"
        host = f"[{hostname}]" if ":" in hostname else hostname
        port = parsed.port
        netloc = f"{host}:{port}" if port is not None else host
        return urlunsplit(
            (
                parsed.scheme,
                netloc,
                parsed.path,
                urlencode(redacted_query, doseq=True, safe="[]"),
                parsed.fragment,
            )
        )
    except (TypeError, ValueError):
        return "[redacted]"


def _runtime_key_is_secret(value: Any) -> bool:
    key = str(value)
    compact = re.sub(r"[^A-Za-z0-9]", "", key)
    return bool(_SECRET_KEY.search(key) or _OPAQUE_RUNTIME_KEY.fullmatch(compact))


def _redact_runtime_configuration(value: Any, *, secret_context: bool = False) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): _redact_runtime_configuration(
                child,
                secret_context=secret_context or _runtime_key_is_secret(key),
            )
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [
            _redact_runtime_configuration(child, secret_context=secret_context)
            for child in value
        ]
    if secret_context and value not in (None, ""):
        return "[redacted]"
    return _redact_runtime_string(value) if isinstance(value, str) else value


def _backup_runtime_payload(root: Path) -> tuple[bytes, int, str] | None:
    settings_path = root / "ui" / ".runtime" / "settings.json"
    if settings_path.is_symlink():
        raise OperationsError("project backup refuses symlink: ui/.runtime/settings.json")
    if not settings_path.exists():
        return None
    _assert_no_symlink_components(root, "ui/.runtime/settings.json")
    settings = _read_object_beneath(root, "ui/.runtime/settings.json")
    if settings is None:
        return None
    _size, source_hash = _hash_regular_beneath(
        root, "ui/.runtime/settings.json"
    )
    return (
        _json_bytes(_redact_runtime_configuration(settings)),
        _regular_metadata_beneath(root, "ui/.runtime/settings.json")[1],
        source_hash,
    )


def _backup_transaction_audit(
    root: Path, revision: Mapping[str, Any], health: Mapping[str, Any]
) -> dict[str, Any]:
    recent: list[dict[str, Any]] = []
    transaction_root = root / "research_trajectory" / ".transactions"
    if transaction_root.is_symlink():
        raise OperationsError("project backup refuses symlink: research_trajectory/.transactions")
    if transaction_root.is_dir():
        for directory in sorted(transaction_root.iterdir(), key=lambda item: item.name):
            if not _TXN_ID.fullmatch(directory.name):
                continue
            if directory.is_symlink() or not directory.is_dir():
                raise OperationsError(
                    f"project backup transaction audit is untrustworthy: {directory.name}"
                )
            manifest_relative = (
                f"research_trajectory/.transactions/{directory.name}/"
                "TRANSACTION_MANIFEST.json"
            )
            value = _read_object_beneath(root, manifest_relative)
            if value is None:
                raise OperationsError(
                    f"project backup transaction audit is invalid: {directory.name}"
                )
            state_value = str(value.get("state") or "")
            record: dict[str, Any] = {
                "transaction_id": directory.name,
                "state": state_value,
                "trial_id": _safe_text(value.get("trial_id"), _TRIAL_ID),
                "stage_id": _safe_text(value.get("stage_id"), _SAFE_ID),
                "base_revision": value.get("base_revision"),
                "target_revision": value.get("target_revision"),
                "created_at": str(value.get("created_at") or "")[:64],
                "updated_at": str(value.get("updated_at") or "")[:64],
                "committed_at": str(value.get("committed_at") or "")[:64],
                "manifest_sha256": _hash_regular_beneath(
                    root, manifest_relative
                )[1],
                "commit_marker_present": False,
                "commit_marker_sha256": None,
            }
            marker_relative = (
                f"research_trajectory/.transactions/{directory.name}/COMMITTED.json"
            )
            marker = root / marker_relative
            if marker.is_symlink():
                raise OperationsError(
                    f"project backup transaction marker is untrustworthy: {directory.name}"
                )
            if marker.is_file():
                record["commit_marker_present"] = True
                record["commit_marker_sha256"] = _hash_regular_beneath(
                    root, marker_relative
                )[1]
            recent.append(record)
    canonical_transaction_id = revision.get("transaction_id") or None
    latest_transaction_id = health.get("last_transaction_id") or canonical_transaction_id
    return {
        "snapshots_included": False,
        "canonical_transaction_id": canonical_transaction_id,
        "latest_recorded_transaction_id": latest_transaction_id,
        "recent_transactions": recent[-50:],
    }


def _validate_transaction_audit(
    value: Any, *, canonical_transaction_id: str | None
) -> dict[str, Any]:
    if not isinstance(value, Mapping) or value.get("snapshots_included") is not False:
        raise OperationsError("project backup transaction audit is invalid")
    recorded_canonical = value.get("canonical_transaction_id")
    if recorded_canonical in (None, ""):
        recorded_canonical = None
    if recorded_canonical != canonical_transaction_id:
        raise OperationsError("project backup transaction audit has inconsistent provenance")
    latest = value.get("latest_recorded_transaction_id")
    if latest in (None, ""):
        latest = None
    if latest is not None and not isinstance(latest, str):
        raise OperationsError("project backup transaction audit has an invalid latest id")
    if latest is not None and not _TXN_ID.fullmatch(latest):
        raise OperationsError("project backup transaction audit has an invalid latest id")
    recent = value.get("recent_transactions")
    if not isinstance(recent, list) or len(recent) > 50:
        raise OperationsError("project backup transaction audit is invalid")
    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for item in recent:
        if not isinstance(item, Mapping):
            raise OperationsError("project backup transaction audit entry is invalid")
        transaction_id = str(item.get("transaction_id") or "")
        state_value = str(item.get("state") or "")
        if (
            not _TXN_ID.fullmatch(transaction_id)
            or transaction_id in seen
            or state_value not in _TERMINAL_TRANSACTION_STATES
        ):
            raise OperationsError("project backup transaction audit entry is invalid")
        manifest_digest = item.get("manifest_sha256")
        marker_digest = item.get("commit_marker_sha256")
        if not re.fullmatch(r"[a-f0-9]{64}", str(manifest_digest or "")):
            raise OperationsError("project backup transaction audit hash is invalid")
        if state_value == "committed" and (
            item.get("commit_marker_present") is not True
            or not re.fullmatch(r"[a-f0-9]{64}", str(marker_digest or ""))
        ):
            raise OperationsError("project backup committed transaction lacks its marker audit")
        if state_value == "rolled_back" and (
            item.get("commit_marker_present") is not False
            or marker_digest is not None
        ):
            raise OperationsError("project backup rolled-back transaction audit is invalid")
        for key in ("base_revision", "target_revision"):
            number = item.get(key)
            if isinstance(number, bool) or not isinstance(number, int) or number < 0:
                raise OperationsError("project backup transaction audit revision is invalid")
        seen.add(transaction_id)
        normalized.append(dict(item))
    expected_latest = (
        str(normalized[-1]["transaction_id"])
        if normalized
        else canonical_transaction_id
    )
    if latest != expected_latest:
        raise OperationsError("project backup transaction audit latest id is inconsistent")
    return {
        "snapshots_included": False,
        "canonical_transaction_id": recorded_canonical,
        "latest_recorded_transaction_id": latest,
        "recent_transactions": normalized,
    }


def create_project_backup(
    project_root: str | Path,
    destination: str | Path,
) -> dict[str, Any]:
    """Create a private, manifest-verified whole-project recovery directory."""

    root_argument = Path(project_root).expanduser()
    if root_argument.is_symlink():
        raise OperationsError("project backup root must not be a symlink")
    root = _project_root(root_argument)
    target_argument = Path(destination).expanduser()
    if target_argument.is_symlink():
        raise OperationsError("project backup destination must not be a symlink")
    target = target_argument.resolve(strict=False)
    if target == root or root in target.parents:
        raise OperationsError("project backup destination must be outside the project")
    if target.exists():
        raise OperationsError("project backup destination already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.parent / f".{target.name}.{uuid.uuid4().hex}.tmp"
    entries: list[dict[str, Any]] = []
    manifest: dict[str, Any]
    with coherent_read(root):
        restore_status = restore_recovery_status(root)
        if restore_status["recovery_required"]:
            raise OperationsError(
                "project backup is disabled until the restored project is acknowledged"
            )
        health = transaction_health(root)
        if health.get("recovery_required"):
            raise OperationsError(
                "project backup requires canonical transaction recovery first"
            )
        revision_before = _revision_summary(root)
        canonical_before = _hash_regular_beneath(
            root, "research_trajectory/CANONICAL_REVISION.json"
        )[1]
        sources, resource_links = _backup_source_files(root)
        runtime_payload = _backup_runtime_payload(root)
        planned_file_count = len(sources) + (1 if runtime_payload is not None else 0)
        if planned_file_count > MAX_BACKUP_FILES:
            raise OperationsError("project is too large for a restorable backup file inventory")
        if len(resource_links) > MAX_BACKUP_RESOURCE_LINKS:
            raise OperationsError("project is too large for a restorable resource-link inventory")
        planned_paths = [relative for _category, relative, _path in sources]
        if runtime_payload is not None:
            planned_paths.append("ui/.runtime/settings.json")
        planned_paths.extend(str(item["path"]) for item in resource_links)
        _require_unique_portable_paths(planned_paths)
        required_bytes = sum(
            _regular_metadata_beneath(root, relative)[0]
            for _category, relative, _path in sources
        )
        if runtime_payload is not None:
            required_bytes += len(runtime_payload[0])
        require_disk_space(
            target.parent, max(1024 * 1024, required_bytes + 1024 * 1024)
        )
        if temporary.exists():
            raise OperationsError("project backup temporary path collision")
        temporary.mkdir(mode=0o700)
        source_hashes: dict[str, str] = {}
        try:
            for category, relative, _source_path in sources:
                destination_path = temporary / "project" / Path(relative)
                size, digest, mode = _copy_regular_beneath(
                    root, relative, destination_path
                )
                source_hashes[relative] = digest
                if os.name == "posix":
                    destination_path.chmod(0o600)
                entries.append(
                    {
                        "path": relative,
                        "category": category,
                        "size": size,
                        "sha256": digest,
                        "source_mode": f"{mode:04o}",
                        "redacted": False,
                    }
                )
            if runtime_payload is not None:
                payload, mode, _source_hash = runtime_payload
                relative = "ui/.runtime/settings.json"
                destination_path = temporary / "project" / Path(relative)
                destination_path.parent.mkdir(parents=True, exist_ok=True)
                destination_path.write_bytes(payload)
                if os.name == "posix":
                    destination_path.chmod(0o600)
                entries.append(
                    {
                        "path": relative,
                        "category": "runtime_configuration",
                        "size": len(payload),
                        "sha256": hashlib.sha256(payload).hexdigest(),
                        "source_mode": f"{mode:04o}",
                        "redacted": True,
                    }
                )
            for relative, expected_hash in source_hashes.items():
                if _hash_regular_beneath(root, relative)[1] != expected_hash:
                    raise OperationsError(
                        f"project changed while backup was being created: {relative}"
                    )
            if runtime_payload is not None and _hash_regular_beneath(
                root, "ui/.runtime/settings.json"
            )[1] != runtime_payload[2]:
                raise OperationsError(
                    "project changed while backup was being created: ui/.runtime/settings.json"
                )
            revision_after = _revision_summary(root)
            canonical_after = _hash_regular_beneath(
                root, "research_trajectory/CANONICAL_REVISION.json"
            )[1]
            if (
                revision_after != revision_before
                or canonical_after != canonical_before
            ):
                raise OperationsError(
                    "canonical revision changed while backup was being created"
                )
            transaction_audit = _backup_transaction_audit(
                root, revision_after, health
            )
            _validate_transaction_audit(
                transaction_audit,
                canonical_transaction_id=revision_after["transaction_id"] or None,
            )
            entries.sort(key=lambda item: str(item["path"]))
            manifest = {
                "backup_format": PROJECT_BACKUP_VERSION,
                "backup_id": f"BACKUP-{uuid.uuid4().hex}",
                "created_at": _utc_now(),
                "project_id": revision_after["project_id"],
                "canonical_revision": revision_after["revision"],
                "files": entries,
                "external_resource_links": resource_links,
                "transaction_audit": transaction_audit,
                "privacy": {
                    "environment_file_included": False,
                    "secret_directory_included": False,
                    "raw_runtime_settings_included": False,
                    "staging_included": False,
                    "transaction_snapshots_included": False,
                    "migration_recovery_records_included": True,
                    "external_resource_link_contents_included": False,
                },
            }
            record_hashes = {
                str(entry["path"]): str(entry["sha256"]) for entry in entries
            }
            records = _validated_file_records(manifest["files"])
            _validated_external_resource_links(
                manifest["external_resource_links"],
                file_paths=[str(record["path"]) for record in records],
            )
            _validated_backup_revision(
                temporary / "project", manifest, record_hashes
            )
            manifest_path = temporary / "BACKUP_MANIFEST.json"
            manifest_payload = _json_bytes(manifest)
            if len(manifest_payload) > MAX_BACKUP_MANIFEST_BYTES:
                raise OperationsError("project backup manifest exceeds the restore size limit")
            manifest_path.write_bytes(manifest_payload)
            if os.name == "posix":
                manifest_path.chmod(0o600)
            os.replace(temporary, target)
            if os.name == "posix":
                target.chmod(0o700)
        except Exception:
            shutil.rmtree(temporary, ignore_errors=True)
            raise
    manifest_path = target / "BACKUP_MANIFEST.json"
    return {
        "status": "created",
        "path": str(target),
        "backup_id": manifest["backup_id"],
        "file_count": len(entries),
        "external_resource_link_count": len(manifest["external_resource_links"]),
        "manifest_sha256": _sha256_file(manifest_path),
        "canonical_revision": manifest["canonical_revision"],
        "privacy": manifest["privacy"],
    }


def _safe_backup_relative(value: Any) -> str:
    return _portable_backup_relative(value)


def _expected_sha256(value: Any, *, label: str) -> str:
    digest = str(value or "").strip().lower()
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise OperationsError(f"{label} must be a lowercase SHA-256 digest")
    return digest


def _validated_file_records(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value or len(value) > MAX_BACKUP_FILES:
        raise OperationsError("project backup manifest has no valid file inventory")
    records: list[dict[str, Any]] = []
    paths: list[str] = []
    for entry in value:
        if not isinstance(entry, Mapping):
            raise OperationsError("project backup manifest entry is invalid")
        relative = _safe_backup_relative(entry.get("path"))
        if not _backup_path_allowed(relative):
            raise OperationsError(f"project backup path is not allowed: {relative}")
        expected_hash = _expected_sha256(
            entry.get("sha256"), label="project backup file hash"
        )
        expected_size = entry.get("size")
        if (
            isinstance(expected_size, bool)
            or not isinstance(expected_size, int)
            or expected_size < 0
        ):
            raise OperationsError("project backup manifest file size is invalid")
        records.append(
            {
                "path": relative,
                "sha256": expected_hash,
                "size": expected_size,
                "source_mode": str(entry.get("source_mode") or ""),
            }
        )
        paths.append(relative)
    _require_unique_portable_paths(paths)
    return records


def _validated_external_resource_links(
    value: Any, *, file_paths: list[str]
) -> list[dict[str, str]]:
    if value is None:
        value = []
    if not isinstance(value, list) or len(value) > MAX_BACKUP_RESOURCE_LINKS:
        raise OperationsError("project backup resource-link inventory is invalid")
    result: list[dict[str, str]] = []
    paths = list(file_paths)
    for item in value:
        if not isinstance(item, Mapping):
            raise OperationsError("project backup resource-link entry is invalid")
        relative = _safe_backup_relative(item.get("path"))
        target = item.get("target")
        link_type = str(item.get("link_type") or "")
        if (
            not relative.startswith("resources/")
            or not _backup_path_allowed(relative)
            or not isinstance(target, str)
            or not target
            or "\x00" in target
            or len(target) > 4096
            or link_type not in {"file", "directory"}
            or item.get("restore_action") != "operator_relink_required"
        ):
            raise OperationsError("project backup resource-link entry is invalid")
        paths.append(relative)
        result.append(
            {
                "path": relative,
                "target": target,
                "link_type": link_type,
                "restore_action": "operator_relink_required",
            }
        )
    _require_unique_portable_paths(paths)
    return result


def _atomic_private_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name == "posix":
            path.chmod(0o600)
    finally:
        try:
            temporary.unlink()
        except OSError:
            pass


def _atomic_private_json(path: Path, value: Any) -> None:
    _atomic_private_bytes(path, _json_bytes(value))


def _trusted_restore_manifest(
    root: Path,
    *,
    expected_sha256: str | None = None,
) -> tuple[dict[str, Any], str, list[dict[str, Any]], list[dict[str, str]]]:
    manifest, digest, _payload = _read_hashed_object_beneath(
        root,
        RESTORE_MANIFEST_RELATIVE,
        limit=MAX_BACKUP_MANIFEST_BYTES,
        label="retained restore manifest",
    )
    if expected_sha256 is not None and not hmac.compare_digest(
        digest, expected_sha256
    ):
        raise OperationsError(
            "retained restore manifest does not match the expected sha256"
        )
    if manifest.get("backup_format") != PROJECT_BACKUP_VERSION:
        raise OperationsError("retained restore manifest is unsupported")
    if not re.fullmatch(
        r"BACKUP-[a-f0-9]{32}", str(manifest.get("backup_id") or "")
    ):
        raise OperationsError("retained restore manifest backup id is invalid")
    records = _validated_file_records(manifest.get("files"))
    resource_links = _validated_external_resource_links(
        manifest.get("external_resource_links"),
        file_paths=[str(item["path"]) for item in records],
    )
    return manifest, digest, records, resource_links


def _restore_acknowledgement_matches(
    acknowledgement: Mapping[str, Any] | None,
    manifest: Mapping[str, Any],
    manifest_sha256: str,
) -> bool:
    if not isinstance(acknowledgement, Mapping):
        return False
    operator = str(acknowledgement.get("operator") or "")
    return bool(
        acknowledgement.get("recovery_format") == RESTORE_RECOVERY_VERSION
        and acknowledgement.get("status") == "acknowledged"
        and hmac.compare_digest(
            str(acknowledgement.get("manifest_sha256") or ""),
            manifest_sha256,
        )
        and acknowledgement.get("backup_id") == manifest.get("backup_id")
        and acknowledgement.get("project_id") == manifest.get("project_id")
        and acknowledgement.get("canonical_revision")
        == manifest.get("canonical_revision")
        and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._@+\-]{0,127}", operator)
        and str(acknowledgement.get("acknowledged_at") or "")
    )


def restore_recovery_status(project_root: str | Path) -> dict[str, Any]:
    """Return the fail-closed operational state of a restored project."""

    root_argument = Path(project_root).expanduser()
    if root_argument.is_symlink():
        return {
            "status": "recovery_required",
            "recovery_required": True,
            "read_only": True,
            "run_controls_disabled": True,
            "diagnostics": ["project_root_symlink"],
        }
    try:
        root = _project_root(root_argument)
    except (OSError, OperationsError):
        return {
            "status": "recovery_required",
            "recovery_required": True,
            "read_only": True,
            "run_controls_disabled": True,
            "diagnostics": ["project_root_unavailable"],
        }
    marker_path = root / RESTORE_RECOVERY_RELATIVE
    manifest_path = root / RESTORE_MANIFEST_RELATIVE
    acknowledgement_path = root / RESTORE_ACKNOWLEDGEMENT_RELATIVE
    for path, diagnostic in (
        (marker_path, "restore_recovery_marker_untrustworthy"),
        (manifest_path, "restore_manifest_untrustworthy"),
        (acknowledgement_path, "restore_acknowledgement_untrustworthy"),
    ):
        if path.is_symlink() or (path.exists() and not path.is_file()):
            return {
                "status": "recovery_required",
                "recovery_required": True,
                "read_only": True,
                "run_controls_disabled": True,
                "diagnostics": [diagnostic],
            }
    marker_present = marker_path.is_file()
    manifest_present = manifest_path.is_file()
    acknowledgement_present = acknowledgement_path.is_file()
    if not marker_present and not manifest_present and not acknowledgement_present:
        return {
            "status": "operational",
            "recovery_required": False,
            "read_only": False,
            "run_controls_disabled": False,
            "acknowledgement": None,
            "diagnostics": [],
        }
    if not manifest_present:
        return {
            "status": "recovery_required",
            "recovery_required": True,
            "read_only": True,
            "run_controls_disabled": True,
            "diagnostics": ["retained_restore_manifest_missing"],
        }
    try:
        manifest, manifest_digest, _records, resource_links = (
            _trusted_restore_manifest(root)
        )
    except (OSError, OperationsError):
        return {
            "status": "recovery_required",
            "recovery_required": True,
            "read_only": True,
            "run_controls_disabled": True,
            "diagnostics": ["retained_restore_manifest_invalid"],
        }
    if not marker_present:
        acknowledgement = _read_object_beneath(
            root, RESTORE_ACKNOWLEDGEMENT_RELATIVE
        )
        if not acknowledgement_present or not _restore_acknowledgement_matches(
            acknowledgement, manifest, manifest_digest
        ):
            return {
                "status": "recovery_required",
                "recovery_required": True,
                "read_only": True,
                "run_controls_disabled": True,
                "diagnostics": ["restore_acknowledgement_missing_or_invalid"],
            }
        return {
            "status": "operational",
            "recovery_required": False,
            "read_only": False,
            "run_controls_disabled": False,
            "acknowledgement": {
                "status": acknowledgement.get("status"),
                "backup_id": acknowledgement.get("backup_id"),
                "manifest_sha256": acknowledgement.get("manifest_sha256"),
                "acknowledged_at": acknowledgement.get("acknowledged_at"),
                "operator": acknowledgement.get("operator"),
            },
            "diagnostics": [],
        }
    marker = _read_object_beneath(
        root, RESTORE_RECOVERY_RELATIVE, limit=32 * 1024 * 1024
    )
    if (
        marker is None
        or marker.get("recovery_format") != RESTORE_RECOVERY_VERSION
        or marker.get("status") != "recovery_required"
        or not hmac.compare_digest(
            str(marker.get("manifest_sha256") or ""), manifest_digest
        )
        or marker.get("backup_id") != manifest.get("backup_id")
        or marker.get("project_id") != manifest.get("project_id")
        or marker.get("canonical_revision") != manifest.get("canonical_revision")
    ):
        return {
            "status": "recovery_required",
            "recovery_required": True,
            "read_only": True,
            "run_controls_disabled": True,
            "diagnostics": ["restore_recovery_marker_invalid"],
        }
    marker_diagnostics = marker.get("diagnostics", [])
    manifest_audit = manifest.get("transaction_audit", {})
    if not isinstance(marker_diagnostics, list) or not isinstance(
        manifest_audit, Mapping
    ):
        return {
            "status": "recovery_required",
            "recovery_required": True,
            "read_only": True,
            "run_controls_disabled": True,
            "diagnostics": ["restore_recovery_marker_invalid"],
        }
    return {
        "status": "recovery_required",
        "recovery_required": True,
        "read_only": True,
        "run_controls_disabled": True,
        "backup_id": str(manifest.get("backup_id") or ""),
        "manifest_sha256": manifest_digest,
        "canonical_revision": manifest.get("canonical_revision"),
        "restored_at": marker.get("restored_at"),
        "external_resource_links": [
            {
                "path": str(item.get("path") or ""),
                "link_type": str(item.get("link_type") or ""),
                "restore_action": "operator_relink_required",
            }
            for item in resource_links[:10_000]
            if isinstance(item, Mapping)
        ],
        "transaction_audit": dict(manifest_audit),
        "diagnostics": [str(item) for item in marker_diagnostics[:20]],
    }


def _backup_schema_dir() -> Path:
    configured = os.environ.get("COAUTO_SCHEMA_DIR")
    candidates = [
        Path(configured) if configured else None,
        Path(__file__).resolve().parent.parent / "schemas",
        Path.cwd() / "schemas",
    ]
    for candidate in candidates:
        if candidate and (candidate / "common.schema.json").is_file():
            return candidate.resolve()
    raise OperationsError("trusted project schemas are unavailable")


def _validated_backup_revision(
    restored_root: Path,
    manifest: Mapping[str, Any],
    entry_hashes: Mapping[str, str],
) -> int:
    missing = sorted(_PROJECT_BACKUP_REQUIRED_FILES - set(entry_hashes))
    if missing:
        raise OperationsError(
            "project backup is missing required files: " + ", ".join(missing)
        )

    for relative in sorted(
        path for path in _PROJECT_BACKUP_REQUIRED_FILES if path.startswith("schemas/")
    ):
        schema = _read_object(restored_root / relative)
        if not schema or schema.get("$id") != Path(relative).name:
            raise OperationsError(f"project backup schema is invalid: {relative}")

    schema_dir = _backup_schema_dir()
    artifacts: dict[str, dict[str, Any]] = {}
    for relative, artifact_type in (
        ("research_trajectory/CANONICAL_REVISION.json", "canonical_revision"),
        ("research_trajectory/STATE.json", "project_state"),
    ):
        value = _read_object(restored_root / relative)
        if value is None:
            raise OperationsError(f"project backup artifact is invalid: {relative}")
        try:
            errors = validate_artifact(
                value,
                expected_type=artifact_type,
                path=relative,
                schema_dir=schema_dir,
            )
        except (KeyError, OSError, RuntimeError, ValueError) as exc:
            raise OperationsError(
                f"project backup artifact cannot be validated: {relative}: {exc}"
            ) from exc
        if errors:
            raise OperationsError(
                f"project backup artifact is invalid: {relative}: {errors[0]}"
            )
        artifacts[artifact_type] = value

    revision_value = artifacts["canonical_revision"]
    state_value = artifacts["project_state"]
    revision = revision_value.get("revision")
    manifest_revision = manifest.get("canonical_revision")
    if (
        isinstance(revision, bool)
        or not isinstance(revision, int)
        or isinstance(manifest_revision, bool)
        or not isinstance(manifest_revision, int)
        or manifest_revision != revision
        or state_value.get("canonical_revision") != revision
    ):
        raise OperationsError("project backup canonical revision is inconsistent")

    project_id = revision_value.get("project_id")
    metadata = _read_object(restored_root / ".co-auto-research" / "project.json")
    if (
        not metadata
        or manifest.get("project_id") != project_id
        or metadata.get("projectId") != project_id
        or state_value.get("project_id") != project_id
    ):
        raise OperationsError("project backup project identity is inconsistent")

    trial_id = revision_value.get("published_trial_id")
    transaction_id = revision_value.get("transaction_id")
    if revision == 0:
        if trial_id is not None or transaction_id is not None:
            raise OperationsError("project backup revision-zero state is inconsistent")
        return revision
    if not isinstance(trial_id, str) or not isinstance(transaction_id, str):
        raise OperationsError("project backup published revision lacks provenance")

    receipt_relative = f"research_trajectory/trials/{trial_id}/PUBLISH_RECEIPT.json"
    if receipt_relative not in entry_hashes:
        raise OperationsError("project backup published revision lacks its receipt")
    receipt = _read_object(restored_root / receipt_relative)
    if receipt is None:
        raise OperationsError("project backup publish receipt is invalid")
    try:
        receipt_errors = validate_artifact(
            receipt,
            expected_type="publish_receipt",
            path=receipt_relative,
            schema_dir=schema_dir,
        )
    except (KeyError, OSError, RuntimeError, ValueError) as exc:
        raise OperationsError(
            f"project backup publish receipt cannot be validated: {exc}"
        ) from exc
    if receipt_errors:
        raise OperationsError(
            f"project backup publish receipt is invalid: {receipt_errors[0]}"
        )
    if (
        receipt.get("project_id") != project_id
        or receipt.get("trial_id") != trial_id
        or receipt.get("transaction_id") != transaction_id
        or receipt.get("published_revision") != revision
        or receipt.get("base_revision") != revision - 1
    ):
        raise OperationsError("project backup publish receipt is inconsistent")

    published: list[dict[str, str]] = []
    published_paths: set[str] = set()
    for item in receipt.get("published_files", []):
        relative = _safe_backup_relative(item.get("path"))
        expected_hash = str(item.get("sha256") or "")
        if relative in published_paths:
            raise OperationsError("project backup publish receipt repeats a path")
        published_paths.add(relative)
        if not _backup_path_allowed(relative) or entry_hashes.get(relative) != expected_hash:
            raise OperationsError(
                f"project backup publish receipt hash is inconsistent: {relative}"
            )
        if relative != "research_trajectory/CANONICAL_REVISION.json":
            published.append({"path": relative, "sha256": expected_hash})

    canonical_relative = "research_trajectory/CANONICAL_REVISION.json"
    if canonical_relative not in published_paths:
        raise OperationsError("project backup publish receipt lacks canonical revision")
    content_hash = hashlib.sha256(
        _json_bytes(sorted(published, key=lambda item: item["path"]))
    ).hexdigest()
    if revision_value.get("content_hash") != content_hash:
        raise OperationsError("project backup canonical content hash is inconsistent")
    return revision


def restore_project_backup(
    backup: str | Path,
    destination: str | Path,
    *,
    expected_manifest_sha256: str,
) -> dict[str, Any]:
    """Verify a bound backup and restore it into recovery/read-only state."""

    expected_manifest_sha256 = _expected_sha256(
        expected_manifest_sha256, label="expected manifest sha256"
    )
    source_argument = Path(backup).expanduser()
    if source_argument.is_symlink():
        raise OperationsError("project backup must be a non-symlink directory")
    source = source_argument.resolve(strict=True)
    if not source.is_dir():
        raise OperationsError("project backup must be a non-symlink directory")
    manifest_path = source / "BACKUP_MANIFEST.json"
    if manifest_path.is_symlink():
        raise OperationsError("project backup manifest must not be a symlink")
    manifest, actual_manifest_sha256, manifest_payload = (
        _read_hashed_object_beneath(
            source,
            "BACKUP_MANIFEST.json",
            limit=MAX_BACKUP_MANIFEST_BYTES,
            label="project backup manifest",
        )
    )
    if not hmac.compare_digest(actual_manifest_sha256, expected_manifest_sha256):
        raise OperationsError("project backup manifest does not match the expected sha256")
    if manifest.get("backup_format") != PROJECT_BACKUP_VERSION:
        raise OperationsError("project backup manifest is missing or unsupported")
    if not re.fullmatch(
        r"BACKUP-[a-f0-9]{32}", str(manifest.get("backup_id") or "")
    ):
        raise OperationsError("project backup manifest backup id is invalid")
    records = _validated_file_records(manifest.get("files"))
    resource_links = _validated_external_resource_links(
        manifest.get("external_resource_links"),
        file_paths=[str(item["path"]) for item in records],
    )
    payload_root = source / "project"
    if payload_root.is_symlink() or not payload_root.is_dir():
        raise OperationsError("project backup payload root is missing or untrustworthy")

    target_argument = Path(destination).expanduser()
    if target_argument.is_symlink():
        raise OperationsError("restore destination must not be a symlink")
    target = target_argument.resolve(strict=False)
    if target == source or source in target.parents or target in source.parents:
        raise OperationsError("restore destination must be separate from the backup")
    if target.exists():
        if target.is_symlink() or not target.is_dir() or any(target.iterdir()):
            raise OperationsError("restore destination must be missing or empty")
    target.parent.mkdir(parents=True, exist_ok=True)
    required_bytes = sum(int(item["size"]) for item in records)
    require_disk_space(
        target.parent, max(1024 * 1024, required_bytes + 1024 * 1024)
    )
    temporary = target.parent / f".{target.name}.{uuid.uuid4().hex}.restore"
    temporary.mkdir(mode=0o700)
    entry_hashes: dict[str, str] = {}
    restored_revision: int | None = None
    try:
        for record in records:
            relative = str(record["path"])
            destination_path = temporary / Path(relative)
            size, digest, _source_mode = _copy_regular_beneath(
                payload_root, relative, destination_path
            )
            if size != record["size"] or digest != record["sha256"]:
                raise OperationsError(f"project backup hash mismatch: {relative}")
            entry_hashes[relative] = digest
            mode_text = str(record.get("source_mode") or "")
            if os.name == "posix" and re.fullmatch(r"[0-7]{4}", mode_text):
                destination_path.chmod(int(mode_text, 8))
        for record in records:
            relative = str(record["path"])
            size, digest = _hash_regular_beneath(temporary, relative)
            if size != record["size"] or digest != record["sha256"]:
                raise OperationsError(
                    f"restored project final tree hash mismatch: {relative}"
                )
        restored_revision = _validated_backup_revision(
            temporary, manifest, entry_hashes
        )
        canonical = _read_object_beneath(
            temporary, "research_trajectory/CANONICAL_REVISION.json"
        )
        canonical_transaction_id = (
            str((canonical or {}).get("transaction_id") or "") or None
        )
        transaction_audit = _validate_transaction_audit(
            manifest.get("transaction_audit"),
            canonical_transaction_id=canonical_transaction_id,
        )
        if transaction_health(temporary).get("recovery_required"):
            raise OperationsError(
                "restored project contains incomplete canonical transactions"
            )
        diagnostics = (
            [
                "External resource links were not recreated; an operator must relink "
                "the recorded resource paths after acknowledgement."
            ]
            if resource_links
            else []
        )
        marker = {
            "recovery_format": RESTORE_RECOVERY_VERSION,
            "status": "recovery_required",
            "backup_id": str(manifest.get("backup_id") or ""),
            "project_id": str(manifest.get("project_id") or ""),
            "canonical_revision": restored_revision,
            "manifest_sha256": actual_manifest_sha256,
            "restored_at": _utc_now(),
            "files": [
                {
                    "path": record["path"],
                    "size": record["size"],
                    "sha256": record["sha256"],
                }
                for record in records
            ],
            "external_resource_links": resource_links,
            "transaction_audit": transaction_audit,
            "diagnostics": diagnostics,
        }
        _atomic_private_bytes(
            temporary / RESTORE_MANIFEST_RELATIVE,
            manifest_payload,
        )
        _atomic_private_json(temporary / RESTORE_RECOVERY_RELATIVE, marker)
        if _hash_regular_beneath(source, "BACKUP_MANIFEST.json")[1] != actual_manifest_sha256:
            raise OperationsError("project backup manifest changed during restore")
        if target.exists():
            target.rmdir()
        os.replace(temporary, target)
        if os.name == "posix":
            runtime = target / "ui" / ".runtime"
            if runtime.is_dir():
                runtime.chmod(0o700)
                settings = runtime / "settings.json"
                if settings.is_file():
                    settings.chmod(0o600)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return {
        "status": "restored_recovery_required",
        "path": str(target),
        "backup_id": str(manifest.get("backup_id") or ""),
        "file_count": len(records),
        "canonical_revision": restored_revision,
        "manifest_sha256": actual_manifest_sha256,
        "recovery_required": True,
        "read_only": True,
        "run_controls_disabled": True,
        "external_resource_links": resource_links,
        "diagnostics": marker["diagnostics"],
    }


def acknowledge_restored_project(
    project_root: str | Path,
    *,
    expected_manifest_sha256: str,
    operator: str,
) -> dict[str, Any]:
    """Reverify a restored tree and explicitly release its recovery gate."""

    expected_manifest_sha256 = _expected_sha256(
        expected_manifest_sha256, label="expected manifest sha256"
    )
    operator = str(operator or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._@+\-]{0,127}", operator):
        raise OperationsError("operator must be a non-empty safe identifier")
    root_argument = Path(project_root).expanduser()
    if root_argument.is_symlink():
        raise OperationsError("restored project root must not be a symlink")
    root = _project_root(root_argument)
    with coherent_read(root):
        marker_path = root / RESTORE_RECOVERY_RELATIVE
        if marker_path.is_symlink() or not marker_path.is_file():
            raise OperationsError("restored project has no trustworthy recovery marker")
        marker = _read_object_beneath(
            root, RESTORE_RECOVERY_RELATIVE, limit=32 * 1024 * 1024
        )
        if (
            marker is None
            or marker.get("recovery_format") != RESTORE_RECOVERY_VERSION
            or marker.get("status") != "recovery_required"
        ):
            raise OperationsError("restored project recovery marker is invalid")
        manifest, manifest_digest, records, resource_links = (
            _trusted_restore_manifest(
                root,
                expected_sha256=expected_manifest_sha256,
            )
        )
        if (
            not hmac.compare_digest(
                str(marker.get("manifest_sha256") or ""), manifest_digest
            )
            or marker.get("backup_id") != manifest.get("backup_id")
            or marker.get("project_id") != manifest.get("project_id")
            or marker.get("canonical_revision") != manifest.get("canonical_revision")
        ):
            raise OperationsError(
                "restore recovery marker does not match the retained manifest"
            )
        entry_hashes: dict[str, str] = {}
        for record in records:
            relative = str(record["path"])
            size, digest = _hash_regular_beneath(root, relative)
            if size != record["size"] or digest != record["sha256"]:
                raise OperationsError(
                    f"restored project changed before acknowledgement: {relative}"
                )
            entry_hashes[relative] = digest
        restored_revision = _validated_backup_revision(
            root, manifest, entry_hashes
        )
        canonical = _read_object_beneath(
            root, "research_trajectory/CANONICAL_REVISION.json"
        )
        canonical_transaction_id = (
            str((canonical or {}).get("transaction_id") or "") or None
        )
        transaction_audit = _validate_transaction_audit(
            manifest.get("transaction_audit"),
            canonical_transaction_id=canonical_transaction_id,
        )
        health = transaction_health(root)
        if health.get("recovery_required"):
            raise OperationsError(
                "restored project canonical transactions require recovery"
            )
        for record in records:
            relative = str(record["path"])
            size, digest = _hash_regular_beneath(root, relative)
            if size != record["size"] or digest != record["sha256"]:
                raise OperationsError(
                    f"restored project changed during acknowledgement: {relative}"
                )
        acknowledgement = {
            "recovery_format": RESTORE_RECOVERY_VERSION,
            "status": "acknowledged",
            "backup_id": str(manifest.get("backup_id") or ""),
            "project_id": str(manifest.get("project_id") or ""),
            "canonical_revision": restored_revision,
            "manifest_sha256": manifest_digest,
            "operator": operator,
            "acknowledged_at": _utc_now(),
            "external_resource_links": resource_links,
            "transaction_audit": transaction_audit,
        }
        acknowledgement_path = root / RESTORE_ACKNOWLEDGEMENT_RELATIVE
        if acknowledgement_path.is_symlink():
            raise OperationsError("restore acknowledgement path is untrustworthy")
        _atomic_private_json(acknowledgement_path, acknowledgement)
        marker_path.unlink()
    return {
        "status": "acknowledged",
        "operational_status": "operational",
        "path": str(root),
        "backup_id": acknowledgement["backup_id"],
        "canonical_revision": restored_revision,
        "manifest_sha256": manifest_digest,
        "operator": operator,
        "acknowledged_at": acknowledgement["acknowledged_at"],
        "recovery_required": False,
        "read_only": False,
        "run_controls_disabled": False,
        "external_resource_links": resource_links,
    }


# Verbose aliases keep callers readable without adding another abstraction.
build_readiness = readiness
build_retention_plan = retention_plan
recover_transactions = recovery_diagnostics
