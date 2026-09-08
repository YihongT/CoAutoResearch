"""Backup-first, add-only migration of CoAutoResearch v1 projects to v2.

The migrator deliberately does not convert legacy trials, reviews, result prose,
or gate prose into accepted v2 artifacts.  It adds the minimum typed canonical
sidecars, records exact before/after hashes, and keeps enough local evidence to
roll back without guessing.  The module uses only the Python standard library;
schema validation also works without ``site-packages`` through ``v2_contracts``.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
from typing import Any, Iterable, Mapping
import uuid

try:
    from .v2_artifacts import (
        cross_artifact_errors,
        paired_markdown_errors,
        render_markdown,
        validate_artifact,
    )
    from .v2_contracts import canonical_json, is_utc_z_timestamp, utc_z_timestamp, valid_id
    from .v2_paths import UnsafeProjectPath, lexical_project_path, normalize_relative_path
    from .v2_observability import emit_operation_event
except ImportError:  # Direct import from a packed project's ui directory.
    from v2_artifacts import (  # type: ignore
        cross_artifact_errors,
        paired_markdown_errors,
        render_markdown,
        validate_artifact,
    )
    from v2_contracts import (  # type: ignore
        canonical_json,
        is_utc_z_timestamp,
        utc_z_timestamp,
        valid_id,
    )
    from v2_paths import (  # type: ignore
        UnsafeProjectPath,
        lexical_project_path,
        normalize_relative_path,
    )
    from v2_observability import emit_operation_event  # type: ignore


PROTOCOL_VERSION = "2.0"
MIGRATION_FORMAT_VERSION = 1
MIGRATION_ROOT = "archive/v2_migrations"
ACTIVE_MARKER = ".co-auto-research-template/v2-migration.json"
TEMPLATE_MANIFEST = ".co-auto-research-template/manifest.json"
INSTRUCTION_MANIFEST = "instructions/.co-auto-research-instructions.json"
CORE_ARTIFACTS = {
    "research_trajectory/STATE.json": "project_state",
    "research_trajectory/CURRENT_FINDINGS.json": "current_findings",
    "research_trajectory/CANONICAL_REVISION.json": "canonical_revision",
}
LEGACY_SOURCES = (
    "PROJECT.md",
    "research_trajectory/STATE.md",
    "research_trajectory/CURRENT_FINDINGS.md",
    "research_trajectory/TRAJECTORY.json",
)
NEW_DIRECTORIES = (
    "research_trajectory/.staging",
    "research_trajectory/.transactions",
    "research_trajectory/lines",
    "research_trajectory/campaigns",
)
USER_OWNED_ROOTS = (
    "PROJECT.md",
    "resources",
    "workspace",
    "research_trajectory",
    "manuscript",
    "archive",
)
MIGRATION_ID_RE = re.compile(r"^MIG-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
LINE_PATH_RE = re.compile(r"^research_trajectory/lines/L[0-9]{4}\.json$")
CAMPAIGN_PATH_RE = re.compile(r"^research_trajectory/campaigns/C[0-9]{4}\.json$")
LINE_MARKDOWN_PATH_RE = re.compile(r"^research_trajectory/lines/L[0-9]{4}\.md$")
CAMPAIGN_MARKDOWN_PATH_RE = re.compile(r"^research_trajectory/campaigns/C[0-9]{4}\.md$")
TRANSACTION_ID_RE = re.compile(r"^TXN-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$")
MAX_LEGACY_TEXT_BYTES = 16 * 1024 * 1024


class MigrationError(RuntimeError):
    """Base class for migration failures."""


class MigrationRefusedError(MigrationError):
    """The project is busy or is not a safely migratable legacy project."""


class MigrationRecoveryRequired(MigrationError):
    """Stored bytes and migration metadata disagree, so guessing is unsafe."""


class RollbackConflictError(MigrationError):
    """Newer work no longer matches the migration's committed after hashes."""


LEGACY_FIELD_ALIASES = {
    "schemaVersion": "schema_version",
    "protocolVersion": "protocol_version",
    "projectId": "project_id",
    "currentObjective": "current_objective",
    "currentGoal": "current_objective",
    "nextStep": "next_step",
    "nextAction": "next_step",
    "activeLineId": "active_line_id",
    "criticalPath": "critical_path",
    "goalGatePath": "goal_gate_path",
    "acceptedCardIds": "accepted_card_ids",
    "qualifiedCardIds": "qualified_card_ids",
    "supersededCardIds": "superseded_card_ids",
    "lastPublishedRevision": "last_published_revision",
    "aggregateStatus": "aggregate_status",
    "currentBlockers": "current_blockers",
    "requirementSources": "requirement_sources",
    "satisfyingCardIds": "satisfying_card_ids",
}


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON value: {value}")


def _strict_json_bytes(data: bytes, *, label: str) -> Any:
    try:
        text = data.decode("utf-8")
        return json.loads(
            text,
            object_pairs_hook=_strict_object,
            parse_constant=_reject_json_constant,
        )
    except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise MigrationRecoveryRequired(f"Invalid JSON in {label}: {exc}") from exc


def _json_bytes(value: Any) -> bytes:
    return (canonical_json(value) + "\n").encode("utf-8")


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _chmod(path: Path, mode: int) -> None:
    if os.name == "posix":
        try:
            path.chmod(mode)
        except OSError:
            pass


def _fsync_directory(path: Path) -> None:
    if os.name != "posix":
        return
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write(path: Path, data: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _chmod(path.parent, 0o700 if MIGRATION_ROOT in path.as_posix() else 0o755)
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _chmod(path, mode)
        _fsync_directory(path.parent)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _project_root(value: str | Path) -> Path:
    try:
        root = Path(value).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise MigrationRefusedError(f"Project root cannot be resolved: {exc}") from exc
    if not root.is_dir():
        raise MigrationRefusedError("Project root is not a directory")
    return root


def _project_path(root: Path, relative: str, *, must_exist: bool = False) -> Path:
    try:
        normalized = normalize_relative_path(relative)
        path = lexical_project_path(root, normalized)
    except (UnsafeProjectPath, OSError, RuntimeError, ValueError) as exc:
        raise MigrationRecoveryRequired(f"Unsafe project path {relative!r}: {exc}") from exc
    if must_exist and not path.is_file():
        raise MigrationRecoveryRequired(f"Required file is missing: {normalized}")
    return path


def _schema_root(root: Path, configured: str | Path | None) -> str | Path | None:
    if configured is not None:
        return configured
    packed = root / "schemas"
    return packed if (packed / "common.schema.json").is_file() else None


def _read_json_file(root: Path, relative: str) -> Any:
    path = _project_path(root, relative, must_exist=True)
    return _strict_json_bytes(path.read_bytes(), label=relative)


def _version_tuple(value: Any) -> tuple[int, ...] | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return (value,)
    if not isinstance(value, str) or re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", value) is None:
        return None
    return tuple(int(part) for part in value.split("."))


def _future_version(value: Any) -> bool:
    version = _version_tuple(value)
    current = _version_tuple(PROTOCOL_VERSION)
    if version is None or current is None:
        return False
    width = max(len(version), len(current))
    return version + (0,) * (width - len(version)) > current + (0,) * (width - len(current))


def _timestamp(value: str | datetime | None) -> str:
    if value is None:
        return utc_z_timestamp()
    if isinstance(value, datetime):
        return utc_z_timestamp(value)
    if not is_utc_z_timestamp(value):
        raise MigrationRefusedError("timestamp must be an RFC 3339 UTC Z timestamp")
    return value


def _migration_id(timestamp: str, requested: str | None) -> str:
    if requested is not None:
        if MIGRATION_ID_RE.fullmatch(requested) is None:
            raise MigrationRefusedError(f"Invalid migration_id: {requested!r}")
        return requested
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
    return f"MIG-{parsed.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"


def _artifact_paths(root: Path) -> list[tuple[str, str]]:
    paths = list(CORE_ARTIFACTS.items())
    for directory, pattern, artifact_type in (
        ("research_trajectory/lines", LINE_PATH_RE, "line"),
        ("research_trajectory/campaigns", CAMPAIGN_PATH_RE, "campaign"),
    ):
        base = _project_path(root, directory)
        if not base.exists():
            continue
        if not base.is_dir():
            paths.append((directory, artifact_type))
            continue
        for path in sorted(base.glob("*.json")):
            relative = path.relative_to(root).as_posix()
            if pattern.fullmatch(relative):
                paths.append((relative, artifact_type))
    return paths


def _migration_directories(root: Path) -> list[Path]:
    base = _project_path(root, MIGRATION_ROOT)
    if not base.exists():
        return []
    if not base.is_dir():
        raise MigrationRecoveryRequired(f"{MIGRATION_ROOT} is not a directory")
    return sorted(path for path in base.iterdir() if path.is_dir() and MIGRATION_ID_RE.fullmatch(path.name))


def _incomplete_migration_ids(root: Path) -> tuple[list[str], list[str]]:
    incomplete: list[str] = []
    errors: list[str] = []
    try:
        directories = _migration_directories(root)
    except MigrationRecoveryRequired as exc:
        return [], [str(exc)]
    for directory in directories:
        relative = directory.relative_to(root).as_posix()
        manifest_path = directory / "MIGRATION_MANIFEST.json"
        if not manifest_path.is_file():
            # The protocol cannot touch a project target before this manifest
            # exists, so a crash-created empty/prepared directory is removable.
            incomplete.append(directory.name)
            continue
        try:
            manifest = _strict_json_bytes(manifest_path.read_bytes(), label=f"{relative}/MIGRATION_MANIFEST.json")
        except MigrationRecoveryRequired as exc:
            errors.append(str(exc))
            continue
        if not isinstance(manifest, dict):
            errors.append(f"migration {directory.name} manifest is not an object")
            continue
        state = manifest.get("state")
        marker = directory / "COMMITTED.json"
        if state == "rolled_back":
            continue
        if state == "committed" and not marker.is_file():
            errors.append(f"migration {directory.name} claims committed without COMMITTED.json")
        elif state != "committed":
            incomplete.append(directory.name)
    return incomplete, errors


def _class_result(kind: str, *, errors: Iterable[str] = (), data: Any = None, **extra: Any) -> dict[str, Any]:
    return {
        "classification": kind,
        "data": data if kind == "v2" else None,
        "errors": list(errors),
        "migration_allowed": kind == "legacy",
        "quarantine_required": kind in {"future", "corrupt"},
        "legacy_fallback_allowed": kind == "legacy",
        "markdown_fallback_allowed": kind == "legacy",
        **extra,
    }


def _classify_project_unchecked(
    project_root: str | Path,
    *,
    schema_dir: str | Path | None = None,
    engine: str = "auto",
) -> dict[str, Any]:
    """Classify a project as ``legacy``, ``v2``, ``future``, or ``corrupt``.

    Missing v2 files are legacy only when *no* v2 sidecar exists and both v1
    STATE/CURRENT_FINDINGS Markdown files are readable.  A partial v2 set never
    falls back to Markdown.
    """

    root = _project_root(project_root)
    schema_dir = _schema_root(root, schema_dir)
    incomplete, migration_errors = _incomplete_migration_ids(root)
    if migration_errors or incomplete:
        recovery_errors = migration_errors + [
            f"incomplete migration requires recovery: {item}" for item in incomplete
        ]
        return _class_result(
            "corrupt", errors=recovery_errors, recovery_required=bool(incomplete)
        )

    marker_path = _project_path(root, ACTIVE_MARKER)
    marker: dict[str, Any] | None = None
    if marker_path.exists():
        if not marker_path.is_file():
            return _class_result("corrupt", errors=[f"{ACTIVE_MARKER} is not a file"])
        try:
            value = _strict_json_bytes(marker_path.read_bytes(), label=ACTIVE_MARKER)
        except MigrationRecoveryRequired as exc:
            return _class_result("corrupt", errors=[str(exc)])
        if not isinstance(value, dict):
            return _class_result("corrupt", errors=[f"{ACTIVE_MARKER} must be an object"])
        if _future_version(value.get("protocol_version")):
            return _class_result(
                "future",
                errors=[f"unsupported protocol_version {value.get('protocol_version')!r}"],
            )
        if value.get("protocol_version") != PROTOCOL_VERSION:
            return _class_result("corrupt", errors=[f"invalid protocol_version in {ACTIVE_MARKER}"])
        marker = value

    artifact_paths = _artifact_paths(root)
    present = [(path, kind) for path, kind in artifact_paths if _project_path(root, path).exists()]
    if not present and marker is None:
        legacy_paths = (
            "research_trajectory/STATE.md",
            "research_trajectory/CURRENT_FINDINGS.md",
        )
        legacy_errors: list[str] = []
        for relative in legacy_paths:
            path = _project_path(root, relative)
            if not path.is_file():
                legacy_errors.append(f"missing legacy file: {relative}")
                continue
            try:
                data = path.read_bytes()
                if len(data) > MAX_LEGACY_TEXT_BYTES:
                    raise ValueError("file is too large")
                data.decode("utf-8")
            except (OSError, UnicodeError, ValueError) as exc:
                legacy_errors.append(f"unreadable legacy file {relative}: {exc}")
        if legacy_errors:
            return _class_result("corrupt", errors=legacy_errors)
        return _class_result("legacy")

    missing = [relative for relative in CORE_ARTIFACTS if not _project_path(root, relative).is_file()]
    if missing:
        return _class_result(
            "corrupt",
            errors=[f"partial v2 project is missing: {relative}" for relative in missing],
        )

    artifacts: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    future: list[str] = []
    for relative, expected_type in artifact_paths:
        path = _project_path(root, relative)
        if not path.exists():
            continue
        if not path.is_file():
            errors.append(f"artifact path is not a file: {relative}")
            continue
        try:
            value = _strict_json_bytes(path.read_bytes(), label=relative)
        except MigrationRecoveryRequired as exc:
            errors.append(str(exc))
            continue
        if not isinstance(value, dict):
            errors.append(f"{relative}: artifact must be an object")
            continue
        if _future_version(value.get("schema_version")):
            future.append(f"{relative}: unsupported schema_version {value.get('schema_version')!r}")
            continue
        if value.get("schema_version") != PROTOCOL_VERSION:
            errors.append(f"{relative}: missing or unsupported schema_version")
            continue
        validation_errors = validate_artifact(
            value,
            expected_type=expected_type,
            path=relative,
            schema_dir=schema_dir,
            engine=engine,
        )
        errors.extend(f"{relative}: {error}" for error in validation_errors)
        if not validation_errors:
            artifacts[relative] = value
            if value.get("artifact_type") in {"line", "campaign"}:
                markdown_relative = relative[:-5] + ".md"
                markdown_path = _project_path(root, markdown_relative)
                if not markdown_path.is_file():
                    errors.append(f"missing paired Markdown: {markdown_relative}")
                else:
                    try:
                        markdown = markdown_path.read_text(encoding="utf-8")
                    except (OSError, UnicodeError) as exc:
                        errors.append(
                            f"unreadable paired Markdown {markdown_relative}: {exc}"
                        )
                    else:
                        errors.extend(
                            f"{markdown_relative}: {error}"
                            for error in paired_markdown_errors(value, markdown)
                        )
    if future:
        return _class_result("future", errors=future + errors)
    if errors:
        return _class_result("corrupt", errors=errors)

    revision = artifacts["research_trajectory/CANONICAL_REVISION.json"]["revision"]
    for relative in (
        "research_trajectory/STATE.json",
        "research_trajectory/CURRENT_FINDINGS.json",
    ):
        if artifacts[relative]["canonical_revision"] != revision:
            errors.append(f"{relative}: canonical_revision does not match CANONICAL_REVISION")
    for relative, value in artifacts.items():
        if value.get("artifact_type") in {"line", "campaign"} and value["last_published_revision"] > revision:
            errors.append(f"{relative}: last_published_revision is in the future")
    active_line = artifacts["research_trajectory/STATE.json"].get("active_line_id")
    if active_line is not None and not any(
        value.get("artifact_type") == "line" and value.get("line_id") == active_line
        for value in artifacts.values()
    ):
        errors.append("project state active_line_id has no readable line artifact")
    errors.extend(cross_artifact_errors(artifacts.values()))
    if marker is not None:
        migration_id = marker.get("migration_id")
        if not isinstance(migration_id, str) or MIGRATION_ID_RE.fullmatch(migration_id) is None:
            errors.append(f"{ACTIVE_MARKER}: invalid migration_id")
        else:
            expected_paths = {
                "manifest_path": f"{MIGRATION_ROOT}/{migration_id}/MIGRATION_MANIFEST.json",
                "receipt_path": f"{MIGRATION_ROOT}/{migration_id}/RECEIPT.json",
                "rollback_instructions_path": f"{MIGRATION_ROOT}/{migration_id}/ROLLBACK.md",
            }
            for key, expected in expected_paths.items():
                if marker.get(key) != expected:
                    errors.append(f"{ACTIVE_MARKER}: invalid {key}")
                elif not _project_path(root, expected).is_file():
                    errors.append(f"{ACTIVE_MARKER}: missing {key}")
        if marker.get("format_version") != MIGRATION_FORMAT_VERSION:
            errors.append(f"{ACTIVE_MARKER}: unsupported format_version")
        if not is_utc_z_timestamp(marker.get("migrated_at")):
            errors.append(f"{ACTIVE_MARKER}: invalid migrated_at")
        if marker.get("legacy_history_preserved") is not True:
            errors.append(f"{ACTIVE_MARKER}: legacy preservation flag is missing")
        if isinstance(migration_id, str) and MIGRATION_ID_RE.fullmatch(migration_id):
            try:
                _manifest_relative, migration_manifest = _load_manifest(root, migration_id)
                if migration_manifest.get("state") != "committed":
                    raise MigrationRecoveryRequired("migration manifest is not committed")
                _verify_commit(root, migration_id, migration_manifest)
            except MigrationRecoveryRequired as exc:
                errors.append(f"{ACTIVE_MARKER}: {exc}")
    if errors:
        return _class_result("corrupt", errors=errors)
    return _class_result(
        "v2",
        data={"artifacts": artifacts, "migration": marker},
        canonical_revision=revision,
        migrated=marker is not None,
    )


def classify_project(
    project_root: str | Path,
    *,
    schema_dir: str | Path | None = None,
    engine: str = "auto",
) -> dict[str, Any]:
    """Classify without allowing unsafe filesystem state to escape as fallback."""

    try:
        return _classify_project_unchecked(
            project_root, schema_dir=schema_dir, engine=engine
        )
    except (MigrationRecoveryRequired, OSError, UnicodeError) as exc:
        return _class_result("corrupt", errors=[str(exc)], recovery_required=True)


def normalize_legacy_fields(value: Any) -> Any:
    """Normalize known camelCase/v1 aliases without discarding unknown fields.

    Conflicting old/new spellings fail closed.  This helper intentionally does
    not promote legacy success states to accepted/passed v2 truth.
    """

    return _normalize_legacy_fields(value, context="")


def _normalize_legacy_fields(value: Any, *, context: str) -> Any:
    if isinstance(value, list):
        return [_normalize_legacy_fields(item, context=context) for item in value]
    if not isinstance(value, Mapping):
        return value
    normalized: dict[str, Any] = {}
    for raw_key, raw_value in value.items():
        key = LEGACY_FIELD_ALIASES.get(str(raw_key), str(raw_key))
        child_context = (
            "critical_path"
            if key == "critical_path"
            else "campaign"
            if key in {"components", "aggregate_status"}
            else context
        )
        item = _normalize_legacy_fields(raw_value, context=child_context)
        if key in normalized and normalized[key] != item:
            raise MigrationRefusedError(f"Conflicting legacy aliases for {key}")
        normalized[key] = item
    for status_key in ("status", "aggregate_status"):
        status = normalized.get(status_key)
        if isinstance(status, str):
            token = status.strip().lower().replace("-", "_").replace(" ", "_")
            if context == "critical_path":
                normalized[status_key] = {
                    "planned": "open",
                    "pending": "open",
                    "not_started": "open",
                    "running": "in_progress",
                    "active": "in_progress",
                    "done": "complete",
                    "completed": "complete",
                    "blocked": "blocked_operational",
                    "blocked_on_human": "blocked_human",
                }.get(token, token)
            else:
                normalized[status_key] = {
                    "planned": "not_started",
                    "pending": "not_started",
                    "running": "in_progress",
                    "active": "in_progress",
                    "complete": "tentative",
                    "completed": "tentative",
                    "done": "tentative",
                    "pass": "tentative",
                    "passed": "tentative",
                    "success": "tentative",
                }.get(token, token)
    return normalized


def _read_legacy_text(root: Path, relative: str, *, required: bool = False) -> str:
    path = _project_path(root, relative)
    if not path.is_file():
        if required:
            raise MigrationRefusedError(f"Missing legacy file: {relative}")
        return ""
    data = path.read_bytes()
    if len(data) > MAX_LEGACY_TEXT_BYTES:
        raise MigrationRefusedError(f"Legacy file is too large to normalize safely: {relative}")
    try:
        return data.decode("utf-8")
    except UnicodeError as exc:
        raise MigrationRefusedError(f"Legacy file is not UTF-8: {relative}") from exc


def _markdown_sections(text: str) -> list[tuple[str, str]]:
    headings = list(re.finditer(r"(?m)^(#{1,6})\s+(.+?)\s*$", text))
    sections: list[tuple[str, str]] = []
    for index, match in enumerate(headings):
        end = len(text)
        level = len(match.group(1))
        for later in headings[index + 1 :]:
            if len(later.group(1)) <= level:
                end = later.start()
                break
        sections.append((match.group(2).strip().lower(), text[match.end() : end].strip()))
    return sections


def _section(text: str, *names: str) -> str:
    wanted = {name.strip().lower() for name in names}
    for heading, body in _markdown_sections(text):
        if heading in wanted:
            return body
    return ""


def _plain_text(value: str) -> str:
    without_comments = re.sub(r"<!--.*?-->", " ", value, flags=re.DOTALL)
    if re.search(r"<[^>]+>", without_comments):
        return ""
    cleaned = without_comments
    cleaned = re.sub(r"[`*_>#]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -|:\t\r\n")
    if not cleaned or re.fullmatch(r"<[^>]+>", cleaned):
        return ""
    lowered = cleaned.lower()
    if lowered in {"none", "none yet", "n/a", "not applicable", "tbd", "todo"}:
        return ""
    if "<" in cleaned and ">" in cleaned:
        return ""
    return cleaned


def _first_paragraph(value: str) -> str:
    for block in re.split(r"\n\s*\n", value):
        plain = _plain_text(block)
        if plain and not plain.startswith("|"):
            return plain
    return ""


def _critical_path(state_text: str) -> list[dict[str, str]]:
    body = _section(state_text, "critical path", "critical dependencies")
    rows: list[dict[str, str]] = []
    for line in body.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [_plain_text(cell) for cell in line.strip().strip("|").split("|")]
        if len(cells) < 3 or cells[0].lower() in {"id", "---"} or set(cells[0]) <= {"-", ":"}:
            continue
        description = cells[1]
        if not description:
            continue
        raw_status = cells[2].lower().replace("-", "_").replace(" ", "_")
        status = {
            "planned": "open",
            "pending": "open",
            "not_started": "open",
            "open": "open",
            "active": "in_progress",
            "running": "in_progress",
            "in_progress": "in_progress",
            "blocked_on_human": "blocked_human",
            "needs_human": "blocked_human",
            "blocked_human": "blocked_human",
            "blocked": "blocked_operational",
            "blocked_operational": "blocked_operational",
            "done": "complete",
            "completed": "complete",
            "complete": "complete",
        }.get(raw_status, "open")
        identifier = cells[0].upper().replace("-", "")
        if re.fullmatch(r"CP[0-9]+", identifier) is None:
            identifier = f"CP{len(rows) + 1}"
        source = cells[3] if len(cells) > 3 and cells[3] else "legacy:research_trajectory/STATE.md"
        rows.append({"id": identifier, "description": description, "status": status, "source": source})
        if len(rows) == 3:
            break
    return rows


def _legacy_finding(findings_text: str) -> str:
    index = _section(findings_text, "current finding index", "finding index", "findings")
    for line in index.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [_plain_text(cell) for cell in line.strip().strip("|").split("|")]
        if len(cells) < 2 or cells[0].lower() in {"id", "---"} or set(cells[0]) <= {"-", ":"}:
            continue
        if cells[0] == "R000000" or not cells[1]:
            continue
        return cells[1]
    active = _section(findings_text, "active findings", "tentative findings")
    for heading, body in _markdown_sections(active):
        if re.search(r"\bR0{4,}\b|<[^>]+>", heading, re.IGNORECASE):
            continue
        title = _plain_text(heading)
        summary = _first_paragraph(_section(body, "summary")) or _first_paragraph(body)
        candidate = summary or title
        if candidate and "placeholder" not in candidate.lower():
            return candidate
    return ""


def _project_id(root: Path, requested: str | None) -> str:
    if requested is not None:
        if not valid_id("project", requested):
            raise MigrationRefusedError(f"Invalid project_id: {requested!r}")
        return requested
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", root.name).strip("-._")[:128]
    if len(value) < 3:
        value = f"coar-{value or 'project'}"
    if not valid_id("project", value):
        raise MigrationRefusedError("Could not derive a valid project_id; supply project_id explicitly")
    return value


def _source_hashes(root: Path) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for relative in LEGACY_SOURCES:
        path = _project_path(root, relative)
        if path.is_file():
            result.append({"path": relative, "sha256": _sha256_file(path), "size": path.stat().st_size})
    return result


def _preserved_files(root: Path, changed_paths: set[str]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    migration_base = _project_path(root, MIGRATION_ROOT)
    for item in USER_OWNED_ROOTS:
        path = _project_path(root, item)
        candidates = [path] if path.is_file() else sorted(path.rglob("*")) if path.is_dir() else []
        for candidate in candidates:
            if not candidate.is_file():
                continue
            try:
                candidate.resolve().relative_to(root)
            except (OSError, RuntimeError, ValueError):
                raise MigrationRecoveryRequired(f"User-owned path escapes project: {candidate}")
            if migration_base.exists() and (candidate == migration_base or migration_base in candidate.parents):
                continue
            relative = candidate.relative_to(root).as_posix()
            if relative in changed_paths:
                continue
            result.append({"path": relative, "sha256": _sha256_file(candidate)})
    return result


def _verify_preserved(root: Path, records: Iterable[Mapping[str, Any]]) -> None:
    for record in records:
        relative = str(record.get("path") or "")
        expected = str(record.get("sha256") or "")
        path = _project_path(root, relative)
        if not path.is_file() or _sha256_file(path) != expected:
            raise MigrationRecoveryRequired(f"User-owned legacy content changed during migration: {relative}")


def _read_managed_manifest(root: Path, relative: str) -> dict[str, Any]:
    path = _project_path(root, relative)
    if not path.exists():
        return {"schemaVersion": 1}
    if not path.is_file():
        raise MigrationRefusedError(f"Managed manifest is not a file: {relative}")
    value = _strict_json_bytes(path.read_bytes(), label=relative)
    if not isinstance(value, dict):
        raise MigrationRefusedError(f"Managed manifest must be an object: {relative}")
    version = value.get("schemaVersion", value.get("schema_version", 1))
    if _version_tuple(version) is None:
        raise MigrationRefusedError(f"Invalid managed manifest version in {relative}")
    if _future_version(version):
        raise MigrationRefusedError(f"Future managed manifest version in {relative}")
    protocol = value.get("protocol_version", value.get("protocolVersion"))
    if protocol is not None:
        if _version_tuple(protocol) is None:
            raise MigrationRefusedError(f"Invalid protocol version in {relative}")
        if _future_version(protocol):
            raise MigrationRefusedError(f"Future protocol version in {relative}")
    return value


def _migration_metadata(migration_id: str, timestamp: str, manifest_path: str) -> dict[str, Any]:
    return {
        "migration_id": migration_id,
        "source_protocol_version": "1",
        "target_protocol_version": PROTOCOL_VERSION,
        "migrated_at": timestamp,
        "manifest_path": manifest_path,
        "history_policy": "preserved_byte_for_byte",
        "legacy_trial_closure": "eight_reviewer_rule_without_review_manifest",
    }


def _managed_manifest_after(
    before: Mapping[str, Any],
    *,
    metadata: Mapping[str, Any],
    include_paths: bool,
) -> dict[str, Any]:
    value = deepcopy(dict(before))
    value.pop("protocolVersion", None)
    value.pop("migrationMetadata", None)
    value["protocol_version"] = PROTOCOL_VERSION
    value["managedPathManifestVersion"] = PROTOCOL_VERSION
    value["migration_metadata"] = deepcopy(dict(metadata))
    if include_paths:
        existing = value.get("v2ManagedPaths")
        paths = [str(item) for item in existing] if isinstance(existing, list) else []
        for relative in (*CORE_ARTIFACTS, ACTIVE_MARKER, "research_trajectory/lines/", "research_trajectory/campaigns/"):
            if relative not in paths:
                paths.append(relative)
        value["v2ManagedPaths"] = paths
    return value


def _generated_artifacts(
    root: Path,
    *,
    project_id: str,
    timestamp: str,
    migration_id: str,
) -> tuple[dict[str, dict[str, Any]], bool]:
    state_text = _read_legacy_text(root, "research_trajectory/STATE.md", required=True)
    findings_text = _read_legacy_text(root, "research_trajectory/CURRENT_FINDINGS.md", required=True)
    project_text = _read_legacy_text(root, "PROJECT.md")
    sources = _source_hashes(root)
    source_map = {item["path"]: item["sha256"] for item in sources}
    migration_extension = {
        "migration_id": migration_id,
        "source_protocol_version": "1",
        "derived": True,
        "confidence": "tentative",
        "legacy_history_preserved": True,
        "source_sha256": source_map,
    }

    objective = _first_paragraph(
        _section(state_text, "current objective", "objective", "current goal", "research goal")
    )
    if not objective:
        objective = _first_paragraph(_section(project_text, "one-sentence goal", "goal", "objective"))
    if not objective:
        objective = "Initialize v2 research state from preserved legacy materials."
    next_step = _first_paragraph(_section(state_text, "next step", "next action"))
    if not next_step:
        next_step = "Review the preserved legacy state and plan the first reviewed v2 trial."
    critical_path = _critical_path(state_text)
    finding = _legacy_finding(findings_text)
    line_derived = bool(finding)

    state: dict[str, Any] = {
        "schema_version": PROTOCOL_VERSION,
        "artifact_type": "project_state",
        "project_id": project_id,
        "created_at": timestamp,
        "updated_at": timestamp,
        "extensions": {
            "migration": migration_extension,
            "legacy_gate_source": "research_trajectory/STATE.md",
        },
        "canonical_revision": 0,
        "current_objective": objective,
        "active_line_id": None,
        "critical_path": critical_path,
        "goal_gate_path": None,
        "next_step": next_step,
    }
    findings: dict[str, Any] = {
        "schema_version": PROTOCOL_VERSION,
        "artifact_type": "current_findings",
        "project_id": project_id,
        "created_at": timestamp,
        "updated_at": timestamp,
        "extensions": {
            "migration": {
                **migration_extension,
                "legacy_findings_status": "tentative_unreviewed" if line_derived else "none_detected",
                "legacy_findings_source": "research_trajectory/CURRENT_FINDINGS.md",
                "promoted_result_cards": 0,
            }
        },
        "canonical_revision": 0,
        "accepted_card_ids": [],
        "qualified_card_ids": [],
        "superseded_card_ids": [],
        "synthesis": [],
    }
    artifacts: dict[str, dict[str, Any]] = {
        "research_trajectory/STATE.json": state,
        "research_trajectory/CURRENT_FINDINGS.json": findings,
    }
    if line_derived:
        artifacts["research_trajectory/lines/L0001.json"] = {
            "schema_version": PROTOCOL_VERSION,
            "artifact_type": "line",
            "project_id": project_id,
            "created_at": timestamp,
            "updated_at": timestamp,
            "extensions": {
                "migration": {
                    **migration_extension,
                    "legacy_derived": True,
                    "review_status": "tentative_unreviewed",
                    "source_path": "research_trajectory/CURRENT_FINDINGS.md",
                }
            },
            "line_id": "L0001",
            "status": "candidate",
            "title": finding[:160],
            "thesis": finding,
            "claim_hierarchy": [
                {"claim_id": "LEGACY-CLAIM-001", "text": finding, "strength": "tentative"}
            ],
            "supporting_cards": [],
            "limiting_cards": [],
            "conflicting_cards": [],
            "material_exclusions": [],
            "scope_boundary": "Legacy-derived scope; requires a reviewed v2 trial before acceptance.",
            "current_bottleneck": "Validate the preserved legacy finding under the v2 protocol.",
            "kill_criteria": ["Reviewed v2 evidence does not support the legacy-derived claim."],
            "venue_fit": "Not assessed during migration.",
            "last_published_revision": 0,
        }
    content_entries = [
        {"path": path, "sha256": _sha256_bytes(_json_bytes(value))}
        for path, value in sorted(artifacts.items())
    ]
    artifacts["research_trajectory/CANONICAL_REVISION.json"] = {
        "schema_version": PROTOCOL_VERSION,
        "artifact_type": "canonical_revision",
        "project_id": project_id,
        "created_at": timestamp,
        "updated_at": timestamp,
        "extensions": {"migration": migration_extension},
        "revision": 0,
        "transaction_id": None,
        "published_trial_id": None,
        "content_hash": _sha256_bytes(_json_bytes(content_entries)),
    }
    return artifacts, line_derived


def _validate_generated(
    artifacts: Mapping[str, Mapping[str, Any]],
    *,
    schema_dir: str | Path | None,
    engine: str,
) -> None:
    errors: list[str] = []
    for path, value in artifacts.items():
        errors.extend(
            f"{path}: {error}"
            for error in validate_artifact(value, path=path, schema_dir=schema_dir, engine=engine)
        )
    errors.extend(cross_artifact_errors(artifacts.values()))
    campaigns = [value for value in artifacts.values() if value.get("artifact_type") == "campaign"]
    for campaign in campaigns:
        statuses = {campaign.get("aggregate_status")}
        statuses.update(component.get("status") for component in campaign.get("components", []))
        if "passed" in statuses:
            errors.append("migration must not create a passed campaign")
    if errors:
        raise MigrationRefusedError("Generated v2 artifacts failed validation: " + "; ".join(errors))


def build_fresh_v2_artifacts(
    *,
    project_id: str,
    project_text: str,
    timestamp: str | datetime | None = None,
    source: str = "fresh_start",
    schema_dir: str | Path | None = None,
    engine: str = "auto",
) -> dict[str, dict[str, Any]]:
    """Build and validate the one canonical revision-zero project boundary.

    Migration and Restart must not invent separate initial-state shapes.  This
    helper deliberately derives only the launch objective from PROJECT.md; no
    prior trial, finding, line, campaign, gate, or manuscript result survives a
    fresh boundary.
    """

    identifier = str(project_id or "").strip()
    if not identifier:
        raise MigrationRefusedError("A project id is required for fresh v2 state.")
    created_at = _timestamp(timestamp)
    objective = _first_paragraph(
        _section(project_text, "one-sentence goal", "goal", "objective")
    ) or "Start the first reviewed research trial from the approved project framing."
    extension = {"fresh_boundary": {"source": str(source or "fresh_start")}}
    artifacts: dict[str, dict[str, Any]] = {
        "research_trajectory/STATE.json": {
            "schema_version": PROTOCOL_VERSION,
            "artifact_type": "project_state",
            "project_id": identifier,
            "created_at": created_at,
            "updated_at": created_at,
            "extensions": extension,
            "canonical_revision": 0,
            "current_objective": objective,
            "active_line_id": None,
            "critical_path": [],
            "goal_gate_path": None,
            "next_step": "Plan and execute Trial 1 from the launch boundary.",
        },
        "research_trajectory/CURRENT_FINDINGS.json": {
            "schema_version": PROTOCOL_VERSION,
            "artifact_type": "current_findings",
            "project_id": identifier,
            "created_at": created_at,
            "updated_at": created_at,
            "extensions": extension,
            "canonical_revision": 0,
            "accepted_card_ids": [],
            "qualified_card_ids": [],
            "superseded_card_ids": [],
            "synthesis": [],
        },
        "research_trajectory/HUMAN_TASKS.json": {
            "schema_version": PROTOCOL_VERSION,
            "artifact_type": "human_tasks",
            "project_id": identifier,
            "created_at": created_at,
            "updated_at": created_at,
            "extensions": extension,
            "tasks": [],
            "blocking_tasks_allowed": False,
        },
    }
    content_entries = [
        {"path": path, "sha256": _sha256_bytes(_json_bytes(value))}
        for path, value in sorted(artifacts.items())
    ]
    artifacts["research_trajectory/CANONICAL_REVISION.json"] = {
        "schema_version": PROTOCOL_VERSION,
        "artifact_type": "canonical_revision",
        "project_id": identifier,
        "created_at": created_at,
        "updated_at": created_at,
        "extensions": extension,
        "revision": 0,
        "transaction_id": None,
        "published_trial_id": None,
        "content_hash": _sha256_bytes(_json_bytes(content_entries)),
    }
    _validate_generated(
        artifacts,
        schema_dir=schema_dir,
        engine=engine,
    )
    return artifacts


def _operation(path: str, after: bytes, root: Path) -> dict[str, Any]:
    target = _project_path(root, path)
    existed = target.is_file()
    if target.exists() and not existed:
        raise MigrationRefusedError(f"Migration target is not a regular file: {path}")
    return {
        "path": path,
        "operation": "replace" if existed else "create",
        "before_exists": existed,
        "before_sha256": _sha256_file(target) if existed else None,
        "after_sha256": _sha256_bytes(after),
        "applied": False,
    }


def _build_plan(
    root: Path,
    *,
    project_id: str | None,
    timestamp: str,
    migration_id: str,
    schema_dir: str | Path | None,
    engine: str,
) -> dict[str, Any]:
    schema_dir = _schema_root(root, schema_dir)
    identifier = _project_id(root, project_id)
    migration_dir = f"{MIGRATION_ROOT}/{migration_id}"
    manifest_path = f"{migration_dir}/MIGRATION_MANIFEST.json"
    receipt_path = f"{migration_dir}/RECEIPT.json"
    rollback_path = f"{migration_dir}/ROLLBACK.md"
    metadata = _migration_metadata(migration_id, timestamp, manifest_path)
    artifacts, line_derived = _generated_artifacts(
        root,
        project_id=identifier,
        timestamp=timestamp,
        migration_id=migration_id,
    )
    _validate_generated(artifacts, schema_dir=schema_dir, engine=engine)

    marker = {
        "format_version": MIGRATION_FORMAT_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "migration_id": migration_id,
        "migrated_at": timestamp,
        "source_classification": "legacy",
        "manifest_path": manifest_path,
        "receipt_path": receipt_path,
        "rollback_instructions_path": rollback_path,
        "legacy_history_preserved": True,
        "legacy_trial_closure": "eight_reviewer_rule_without_review_manifest",
    }
    template_before = _read_managed_manifest(root, TEMPLATE_MANIFEST)
    instructions_before = _read_managed_manifest(root, INSTRUCTION_MANIFEST)
    paired_payloads = {
        path[:-5] + ".md": render_markdown(value).encode("utf-8")
        for path, value in artifacts.items()
        if value.get("artifact_type") in {"line", "campaign"}
    }
    payloads: dict[str, bytes] = {
        **{path: _json_bytes(value) for path, value in artifacts.items()},
        **paired_payloads,
        TEMPLATE_MANIFEST: _json_bytes(
            _managed_manifest_after(template_before, metadata=metadata, include_paths=True)
        ),
        INSTRUCTION_MANIFEST: _json_bytes(
            _managed_manifest_after(instructions_before, metadata=metadata, include_paths=False)
        ),
        ACTIVE_MARKER: _json_bytes(marker),
    }
    operations = [_operation(path, payloads[path], root) for path in sorted(payloads)]
    changed_paths = {item["path"] for item in operations}
    preserved = _preserved_files(root, changed_paths)
    created_directories = [relative for relative in NEW_DIRECTORIES if not _project_path(root, relative).exists()]
    return {
        "project_id": identifier,
        "migration_id": migration_id,
        "migration_dir": migration_dir,
        "manifest_path": manifest_path,
        "receipt_path": receipt_path,
        "rollback_path": rollback_path,
        "timestamp": timestamp,
        "payloads": payloads,
        "operations": operations,
        "created_directories": created_directories,
        "preserved_files": preserved,
        "legacy_sources": _source_hashes(root),
        "line_derived": line_derived,
    }


def plan_migration(
    project_root: str | Path,
    *,
    project_id: str | None = None,
    timestamp: str | datetime | None = None,
    migration_id: str | None = None,
    schema_dir: str | Path | None = None,
    engine: str = "auto",
) -> dict[str, Any]:
    """Return a write-free migration plan suitable for a UI dry run."""

    root = _project_root(project_root)
    classification = classify_project(root, schema_dir=schema_dir, engine=engine)
    if classification["classification"] == "v2":
        return {"status": "no_op", "changed": False, "classification": classification}
    if classification["classification"] != "legacy":
        raise MigrationRefusedError(
            f"Migration refused for {classification['classification']} project: "
            + "; ".join(classification["errors"])
        )
    created_at = _timestamp(timestamp)
    identifier = _migration_id(created_at, migration_id)
    plan = _build_plan(
        root,
        project_id=project_id,
        timestamp=created_at,
        migration_id=identifier,
        schema_dir=schema_dir,
        engine=engine,
    )
    return {
        "status": "planned",
        "changed": False,
        "classification": classification,
        "protocol_version": PROTOCOL_VERSION,
        "migration_id": identifier,
        "create_paths": [item["path"] for item in plan["operations"] if item["operation"] == "create"],
        "replace_paths": [item["path"] for item in plan["operations"] if item["operation"] == "replace"],
        "created_directories": plan["created_directories"],
        "preserved_file_count": len(plan["preserved_files"]),
        "line_derived": plan["line_derived"],
    }


def _snapshot_path(plan: Mapping[str, Any], side: str, target: str) -> str:
    return f"{plan['migration_dir']}/{side}/{target}"


def _manifest_from_plan(plan: Mapping[str, Any]) -> dict[str, Any]:
    operations: list[dict[str, Any]] = []
    for operation in plan["operations"]:
        item = deepcopy(operation)
        item["before_snapshot_path"] = (
            _snapshot_path(plan, "before", item["path"]) if item["before_exists"] else None
        )
        item["after_snapshot_path"] = _snapshot_path(plan, "after", item["path"])
        operations.append(item)
    return {
        "format_version": MIGRATION_FORMAT_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "migration_id": plan["migration_id"],
        "project_id": plan["project_id"],
        "state": "prepared",
        "created_at": plan["timestamp"],
        "updated_at": plan["timestamp"],
        "source_classification": "legacy",
        "strategy": "backup-first, add-only, idempotent, reversible",
        "operations": operations,
        "created_directories": plan["created_directories"],
        "preserved_files": plan["preserved_files"],
        "legacy_sources": plan["legacy_sources"],
        "legacy_history_policy": "preserved_byte_for_byte",
        "rollback_instructions_path": plan["rollback_path"],
        "receipt_path": plan["receipt_path"],
    }


def _persist_manifest(root: Path, relative: str, manifest: Mapping[str, Any]) -> None:
    _atomic_write(_project_path(root, relative), _json_bytes(manifest))
    migration_dir = _project_path(root, str(Path(relative).parent.as_posix()))
    journal = {
        "migration_id": manifest["migration_id"],
        "state": manifest["state"],
        "updated_at": manifest["updated_at"],
        "operations": [
            {"path": item["path"], "applied": item["applied"]}
            for item in manifest["operations"]
        ],
    }
    _atomic_write(migration_dir / "JOURNAL.json", _json_bytes(journal))


def _write_backups(
    root: Path,
    plan: Mapping[str, Any],
    manifest: Mapping[str, Any],
) -> None:
    migration_dir = _project_path(root, str(plan["migration_dir"]))
    if migration_dir.exists():
        raise MigrationRefusedError(f"Migration directory already exists: {plan['migration_dir']}")
    migration_dir.mkdir(parents=True, mode=0o700)
    _chmod(migration_dir.parent, 0o700)
    _chmod(migration_dir, 0o700)
    try:
        _persist_manifest(root, str(plan["manifest_path"]), manifest)
        for operation in manifest["operations"]:
            target = _project_path(root, operation["path"])
            if operation["before_exists"]:
                data = target.read_bytes()
                if _sha256_bytes(data) != operation["before_sha256"]:
                    raise MigrationRecoveryRequired(f"Target changed during backup: {operation['path']}")
                _atomic_write(_project_path(root, operation["before_snapshot_path"]), data)
            after = plan["payloads"][operation["path"]]
            if _sha256_bytes(after) != operation["after_sha256"]:
                raise MigrationRecoveryRequired(f"Generated after hash changed: {operation['path']}")
            _atomic_write(_project_path(root, operation["after_snapshot_path"]), after)
        for operation in manifest["operations"]:
            if operation["before_exists"]:
                snapshot = _project_path(root, operation["before_snapshot_path"], must_exist=True)
                if _sha256_file(snapshot) != operation["before_sha256"]:
                    raise MigrationRecoveryRequired(f"Backup verification failed: {operation['path']}")
    except Exception:
        # No project target is touched until every backup has verified.
        shutil.rmtree(migration_dir, ignore_errors=True)
        _fsync_directory(migration_dir.parent)
        raise


def _operations_hash(manifest: Mapping[str, Any]) -> str:
    value = {
        "operations": [
            {
                "path": item["path"],
                "before_sha256": item["before_sha256"],
                "after_sha256": item["after_sha256"],
            }
            for item in manifest["operations"]
        ],
        "created_directories": manifest["created_directories"],
        "preserved_files": manifest["preserved_files"],
    }
    return _sha256_bytes(_json_bytes(value))


def _rollback_markdown(plan: Mapping[str, Any]) -> bytes:
    text = (
        "# V2 Migration Rollback\n\n"
        f"Migration: `{plan['migration_id']}`\n\n"
        "Stop active research and the server. Roll back only when no newer canonical work must be preserved. "
        "Call `rollback_migration(project_root, migration_id=\""
        f"{plan['migration_id']}\")`; the implementation verifies committed after hashes, restores exact before "
        "snapshots, removes migration-created files, and verifies the preserved legacy hashes.\n"
    )
    return text.encode("utf-8")


def _active_run_errors(root: Path) -> list[str]:
    errors: list[str] = []
    transactions = _project_path(root, "research_trajectory/.transactions")
    transaction_lock = transactions / "PUBLISH_LOCK"
    if transaction_lock.exists():
        errors.append("a canonical publication lock is active")
    if transactions.is_dir():
        for directory in sorted(transactions.iterdir()):
            if not directory.is_dir() or TRANSACTION_ID_RE.fullmatch(directory.name) is None:
                continue
            manifest_path = directory / "TRANSACTION_MANIFEST.json"
            marker_path = directory / "COMMITTED.json"
            if not manifest_path.is_file():
                errors.append(f"transaction {directory.name} has no readable manifest")
                continue
            try:
                manifest = _strict_json_bytes(
                    manifest_path.read_bytes(), label=manifest_path.relative_to(root).as_posix()
                )
            except MigrationRecoveryRequired as exc:
                errors.append(str(exc))
                continue
            state = manifest.get("state") if isinstance(manifest, dict) else None
            if state == "committed" and not marker_path.is_file():
                errors.append(f"transaction {directory.name} claims committed without a marker")
            elif state != "rolled_back" and not marker_path.is_file():
                errors.append(f"transaction {directory.name} requires recovery")
    session_paths = ["ui/.runtime/research_session.json"]
    sessions = _project_path(root, "ui/.runtime/sessions")
    if sessions.is_dir():
        session_paths.extend(path.relative_to(root).as_posix() for path in sorted(sessions.glob("*/meta.json")))
    for relative in session_paths:
        path = _project_path(root, relative)
        if not path.is_file():
            continue
        try:
            value = _strict_json_bytes(path.read_bytes(), label=relative)
        except MigrationRecoveryRequired as exc:
            errors.append(str(exc))
            continue
        if not isinstance(value, dict):
            errors.append(f"runtime state is not an object: {relative}")
            continue
        status = str(value.get("status") or "").lower()
        if status in {"running", "stopping", "in_progress"} or value.get("loop_active") is True:
            errors.append(f"active research invocation in {relative}")
    return errors


def _process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes

            kernel32 = getattr(ctypes, "windll").kernel32
            handle = kernel32.OpenProcess(0x1000, False, pid)
            if not handle:
                return False
            kernel32.CloseHandle(handle)
            return True
        except Exception:
            return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class _MigrationLock:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.path = _project_path(root, f"{MIGRATION_ROOT}/MIGRATION_LOCK")
        self.acquired = False

    def __enter__(self) -> "_MigrationLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        _chmod(self.path.parent, 0o700)
        for attempt in range(2):
            try:
                self.path.mkdir(mode=0o700)
                break
            except FileExistsError as exc:
                owner_path = self.path / "owner.json"
                try:
                    owner = _strict_json_bytes(owner_path.read_bytes(), label=str(owner_path))
                    same_host = owner.get("hostname") == socket.gethostname()
                    pid = int(owner.get("pid") or 0)
                except Exception as owner_error:
                    raise MigrationRecoveryRequired(
                        f"migration lock has no trustworthy owner: {owner_error}"
                    ) from owner_error
                if attempt == 0 and same_host and not _process_alive(pid):
                    shutil.rmtree(self.path)
                    _fsync_directory(self.path.parent)
                    continue
                raise MigrationRefusedError(
                    f"another migration or recovery owns the project lock (pid {pid})"
                ) from exc
        else:  # pragma: no cover - the loop either creates or raises.
            raise MigrationRefusedError("could not acquire migration lock")
        owner = {
            "pid": os.getpid(),
            "hostname": socket.gethostname(),
            "created_at": utc_z_timestamp(),
        }
        _atomic_write(self.path / "owner.json", _json_bytes(owner))
        self.acquired = True
        return self

    def __exit__(self, _type: Any, _value: Any, _traceback: Any) -> None:
        if self.acquired:
            shutil.rmtree(self.path, ignore_errors=True)
            _fsync_directory(self.path.parent)
            self.acquired = False


def _allowed_target(path: str) -> bool:
    return path in {*CORE_ARTIFACTS, ACTIVE_MARKER, TEMPLATE_MANIFEST, INSTRUCTION_MANIFEST} or bool(
        LINE_PATH_RE.fullmatch(path)
        or CAMPAIGN_PATH_RE.fullmatch(path)
        or LINE_MARKDOWN_PATH_RE.fullmatch(path)
        or CAMPAIGN_MARKDOWN_PATH_RE.fullmatch(path)
    )


def _load_manifest(root: Path, migration_id: str) -> tuple[str, dict[str, Any]]:
    if MIGRATION_ID_RE.fullmatch(migration_id) is None:
        raise MigrationRecoveryRequired(f"Invalid migration ID: {migration_id!r}")
    relative = f"{MIGRATION_ROOT}/{migration_id}/MIGRATION_MANIFEST.json"
    value = _read_json_file(root, relative)
    if not isinstance(value, dict):
        raise MigrationRecoveryRequired(f"Migration manifest is not an object: {migration_id}")
    if value.get("format_version") != MIGRATION_FORMAT_VERSION:
        raise MigrationRecoveryRequired(f"Unsupported migration manifest format: {migration_id}")
    if value.get("protocol_version") != PROTOCOL_VERSION or value.get("migration_id") != migration_id:
        raise MigrationRecoveryRequired(f"Migration manifest identity mismatch: {migration_id}")
    if value.get("state") not in {
        "prepared",
        "applying",
        "committed",
        "rolling_back",
        "rolled_back",
    }:
        raise MigrationRecoveryRequired(f"Invalid migration state: {migration_id}")
    operations = value.get("operations")
    if not isinstance(operations, list) or not operations:
        raise MigrationRecoveryRequired(f"Migration manifest has no operations: {migration_id}")
    seen: set[str] = set()
    migration_dir = f"{MIGRATION_ROOT}/{migration_id}"
    for item in operations:
        if not isinstance(item, dict):
            raise MigrationRecoveryRequired(f"Invalid operation in migration {migration_id}")
        path = item.get("path")
        if not isinstance(path, str) or not _allowed_target(path) or path in seen:
            raise MigrationRecoveryRequired(f"Unsafe or duplicate migration target: {path!r}")
        seen.add(path)
        before_exists = item.get("before_exists")
        if not isinstance(before_exists, bool):
            raise MigrationRecoveryRequired(f"Invalid before_exists for {path}")
        if item.get("operation") != ("replace" if before_exists else "create"):
            raise MigrationRecoveryRequired(f"Invalid operation type for {path}")
        if not isinstance(item.get("applied"), bool):
            raise MigrationRecoveryRequired(f"Invalid applied flag for {path}")
        before_hash = item.get("before_sha256")
        after_hash = item.get("after_sha256")
        if (before_exists and not isinstance(before_hash, str)) or (
            isinstance(before_hash, str) and SHA256_RE.fullmatch(before_hash) is None
        ):
            raise MigrationRecoveryRequired(f"Invalid before hash for {path}")
        if not before_exists and before_hash is not None:
            raise MigrationRecoveryRequired(f"Created target unexpectedly has a before hash: {path}")
        if not isinstance(after_hash, str) or SHA256_RE.fullmatch(after_hash) is None:
            raise MigrationRecoveryRequired(f"Invalid after hash for {path}")
        expected_before = f"{migration_dir}/before/{path}" if before_exists else None
        expected_after = f"{migration_dir}/after/{path}"
        if item.get("before_snapshot_path") != expected_before or item.get("after_snapshot_path") != expected_after:
            raise MigrationRecoveryRequired(f"Snapshot path mismatch for {path}")
    created_directories = value.get("created_directories")
    if (
        not isinstance(created_directories, list)
        or any(not isinstance(item, str) or item not in NEW_DIRECTORIES for item in created_directories)
        or len(set(created_directories)) != len(created_directories)
    ):
        raise MigrationRecoveryRequired(f"Invalid created_directories in migration {migration_id}")
    preserved = value.get("preserved_files")
    if not isinstance(preserved, list):
        raise MigrationRecoveryRequired(f"Invalid preserved file records in migration {migration_id}")
    for record in preserved:
        if not isinstance(record, dict):
            raise MigrationRecoveryRequired(f"Invalid preserved file record in migration {migration_id}")
        if not isinstance(record.get("path"), str):
            raise MigrationRecoveryRequired(f"Invalid preserved file path in migration {migration_id}")
        try:
            normalize_relative_path(record.get("path"))
        except (UnsafeProjectPath, TypeError, ValueError) as exc:
            raise MigrationRecoveryRequired(f"Unsafe preserved file path: {record.get('path')!r}") from exc
        if not isinstance(record.get("sha256"), str) or SHA256_RE.fullmatch(record["sha256"]) is None:
            raise MigrationRecoveryRequired(f"Invalid preserved file hash: {record.get('path')!r}")
    return relative, value


def _verify_commit(root: Path, migration_id: str, manifest: Mapping[str, Any]) -> dict[str, Any]:
    migration_dir = _project_path(root, f"{MIGRATION_ROOT}/{migration_id}")
    commit_path = migration_dir / "COMMITTED.json"
    if not commit_path.is_file():
        raise MigrationRecoveryRequired(f"Migration commit marker is missing: {migration_id}")
    commit = _strict_json_bytes(commit_path.read_bytes(), label=commit_path.relative_to(root).as_posix())
    if not isinstance(commit, dict) or commit.get("operations_sha256") != _operations_hash(manifest):
        raise MigrationRecoveryRequired(f"Commit marker mismatch: {migration_id}")
    receipt_path = migration_dir / "RECEIPT.json"
    if (
        not receipt_path.is_file()
        or not isinstance(commit.get("receipt_sha256"), str)
        or _sha256_file(receipt_path) != commit["receipt_sha256"]
    ):
        raise MigrationRecoveryRequired(f"Committed migration receipt mismatch: {migration_id}")
    return commit


def _target_state(root: Path, operation: Mapping[str, Any]) -> str:
    path = _project_path(root, str(operation["path"]))
    if not path.exists():
        return "before" if not operation["before_exists"] else "missing"
    if not path.is_file():
        return "conflict"
    digest = _sha256_file(path)
    if digest == operation["after_sha256"]:
        return "after"
    if operation["before_exists"] and digest == operation["before_sha256"]:
        return "before"
    return "conflict"


def _restore_from_manifest(
    root: Path,
    manifest_relative: str,
    manifest: dict[str, Any],
    *,
    strict_after: bool,
) -> None:
    for operation in manifest["operations"]:
        state = _target_state(root, operation)
        if strict_after and state != "after":
            raise RollbackConflictError(
                f"Rollback refused; {operation['path']} no longer matches the committed migration"
            )
        if state in {"before"}:
            continue
        if state in {"missing"}:
            if operation["before_exists"]:
                raise MigrationRecoveryRequired(f"Missing changed target: {operation['path']}")
            continue
        if state == "conflict":
            raise MigrationRecoveryRequired(f"Cannot safely restore ambiguous bytes: {operation['path']}")
        if state == "after" and operation["before_exists"]:
            snapshot = _project_path(root, operation["before_snapshot_path"], must_exist=True)
            if _sha256_file(snapshot) != operation["before_sha256"]:
                raise MigrationRecoveryRequired(f"Before snapshot hash mismatch: {operation['path']}")

    if strict_after:
        _verify_preserved(root, manifest.get("preserved_files", []))
    manifest["state"] = "rolling_back"
    manifest["updated_at"] = utc_z_timestamp()
    _persist_manifest(root, manifest_relative, manifest)
    for operation in reversed(manifest["operations"]):
        target = _project_path(root, operation["path"])
        state = _target_state(root, operation)
        if state == "before":
            operation["applied"] = False
            continue
        if operation["before_exists"]:
            snapshot = _project_path(root, operation["before_snapshot_path"], must_exist=True)
            data = snapshot.read_bytes()
            if _sha256_bytes(data) != operation["before_sha256"]:
                raise MigrationRecoveryRequired(f"Before snapshot hash mismatch: {operation['path']}")
            _atomic_write(target, data)
        else:
            try:
                target.unlink()
                _fsync_directory(target.parent)
            except FileNotFoundError:
                pass
        operation["applied"] = False
        manifest["updated_at"] = utc_z_timestamp()
        _persist_manifest(root, manifest_relative, manifest)
    for relative in reversed(manifest.get("created_directories", [])):
        path = _project_path(root, str(relative))
        if path.is_dir():
            try:
                path.rmdir()
            except OSError:
                pass
    if strict_after:
        _verify_preserved(root, manifest.get("preserved_files", []))
    migration_dir = _project_path(root, str(Path(manifest_relative).parent.as_posix()))
    try:
        (migration_dir / "COMMITTED.json").unlink()
    except FileNotFoundError:
        pass
    manifest["state"] = "rolled_back"
    manifest["updated_at"] = utc_z_timestamp()
    _persist_manifest(root, manifest_relative, manifest)
    _atomic_write(
        migration_dir / "ROLLED_BACK.json",
        _json_bytes(
            {
                "migration_id": manifest["migration_id"],
                "rolled_back_at": manifest["updated_at"],
                "original_hashes_verified": True,
            }
        ),
    )


def _apply_plan(
    root: Path,
    plan: Mapping[str, Any],
    *,
    schema_dir: str | Path | None,
    engine: str,
) -> dict[str, Any]:
    manifest = _manifest_from_plan(plan)
    _write_backups(root, plan, manifest)
    commit_written = False
    try:
        for relative in plan["created_directories"]:
            path = _project_path(root, relative)
            mode = 0o700 if Path(relative).name.startswith(".") else 0o755
            path.mkdir(parents=True, exist_ok=True, mode=mode)
            _chmod(path, mode)
        manifest["state"] = "applying"
        manifest["updated_at"] = utc_z_timestamp()
        _persist_manifest(root, plan["manifest_path"], manifest)
        for operation in manifest["operations"]:
            target = _project_path(root, operation["path"])
            current = _target_state(root, operation)
            if current != "before":
                raise MigrationRecoveryRequired(f"Target changed before apply: {operation['path']}")
            after_path = _project_path(root, operation["after_snapshot_path"], must_exist=True)
            data = after_path.read_bytes()
            if _sha256_bytes(data) != operation["after_sha256"]:
                raise MigrationRecoveryRequired(f"After snapshot hash mismatch: {operation['path']}")
            _atomic_write(target, data)
            operation["applied"] = True
            manifest["updated_at"] = utc_z_timestamp()
            _persist_manifest(root, plan["manifest_path"], manifest)

        _verify_preserved(root, manifest["preserved_files"])
        for relative, expected_type in _artifact_paths(root):
            path = _project_path(root, relative)
            if not path.is_file():
                continue
            value = _strict_json_bytes(path.read_bytes(), label=relative)
            errors = validate_artifact(
                value,
                expected_type=expected_type,
                path=relative,
                schema_dir=schema_dir,
                engine=engine,
            )
            if errors:
                raise MigrationRecoveryRequired(f"Post-write validation failed for {relative}: {'; '.join(errors)}")

        receipt = {
            "format_version": MIGRATION_FORMAT_VERSION,
            "protocol_version": PROTOCOL_VERSION,
            "migration_id": plan["migration_id"],
            "project_id": plan["project_id"],
            "migrated_at": plan["timestamp"],
            "manifest_path": plan["manifest_path"],
            "created_paths": [item["path"] for item in manifest["operations"] if not item["before_exists"]],
            "replaced_paths": [item["path"] for item in manifest["operations"] if item["before_exists"]],
            "preserved_file_count": len(manifest["preserved_files"]),
            "original_hashes_verified": True,
            "line_derived": plan["line_derived"],
            "campaigns_fabricated": 0,
            "rollback_instructions_path": plan["rollback_path"],
        }
        _atomic_write(_project_path(root, plan["receipt_path"]), _json_bytes(receipt))
        _atomic_write(_project_path(root, plan["rollback_path"]), _rollback_markdown(plan))
        migration_dir = _project_path(root, plan["migration_dir"])
        commit = {
            "migration_id": plan["migration_id"],
            "committed_at": utc_z_timestamp(),
            "operations_sha256": _operations_hash(manifest),
            "receipt_sha256": _sha256_file(_project_path(root, plan["receipt_path"])),
        }
        _atomic_write(migration_dir / "COMMITTED.json", _json_bytes(commit))
        commit_written = True
        manifest["state"] = "committed"
        manifest["updated_at"] = commit["committed_at"]
        _persist_manifest(root, plan["manifest_path"], manifest)
        return receipt
    except Exception:
        if commit_written:
            raise MigrationRecoveryRequired(
                "Migration commit is durable; startup recovery must finalize it"
            )
        try:
            _restore_from_manifest(root, plan["manifest_path"], manifest, strict_after=False)
        except Exception as rollback_error:
            raise MigrationRecoveryRequired(
                f"Migration failed and automatic rollback could not prove recovery: {rollback_error}"
            ) from rollback_error
        raise


def migrate_project(
    project_root: str | Path,
    *,
    project_id: str | None = None,
    timestamp: str | datetime | None = None,
    migration_id: str | None = None,
    schema_dir: str | Path | None = None,
    engine: str = "auto",
    dry_run: bool = False,
    recover: bool = True,
) -> dict[str, Any]:
    """Migrate one legacy project or return an idempotent v2 no-op result."""

    root = _project_root(project_root)
    emit_operation_event(
        "migration",
        "requested",
        "planning" if dry_run else "starting",
        details={"dry_run": dry_run, "requested_migration_id": migration_id},
    )
    incomplete, errors = _incomplete_migration_ids(root)
    if errors:
        raise MigrationRecoveryRequired("; ".join(errors))
    if incomplete:
        if not recover:
            raise MigrationRecoveryRequired("Incomplete migration requires recovery")
        busy = _active_run_errors(root)
        if busy:
            raise MigrationRefusedError(
                "Migration recovery requires an idle project: " + "; ".join(busy)
            )
        recover_incomplete_migrations(root)

    classification = classify_project(root, schema_dir=schema_dir, engine=engine)
    if classification["classification"] == "v2":
        marker = (classification.get("data") or {}).get("migration") or {}
        emit_operation_event(
            "migration",
            "no_op",
            "completed",
            details={"reason": "already_v2"},
        )
        return {
            "status": "no_op",
            "reason": "already_v2",
            "changed": False,
            "classification": "v2",
            "protocol_version": PROTOCOL_VERSION,
            "migration_id": marker.get("migration_id"),
        }
    if classification["classification"] != "legacy":
        raise MigrationRefusedError(
            f"Migration refused for {classification['classification']} project: "
            + "; ".join(classification["errors"])
        )
    busy = _active_run_errors(root)
    if busy:
        raise MigrationRefusedError("Migration requires an idle project: " + "; ".join(busy))
    if dry_run:
        return plan_migration(
            root,
            project_id=project_id,
            timestamp=timestamp,
            migration_id=migration_id,
            schema_dir=schema_dir,
            engine=engine,
        )

    created_at = _timestamp(timestamp)
    identifier = _migration_id(created_at, migration_id)
    emit_operation_event(
        "migration",
        "prepared",
        "applying",
        details={"migration_id": identifier},
    )
    plan = _build_plan(
        root,
        project_id=project_id,
        timestamp=created_at,
        migration_id=identifier,
        schema_dir=schema_dir,
        engine=engine,
    )
    with _MigrationLock(root):
        second = classify_project(root, schema_dir=schema_dir, engine=engine)
        if second["classification"] == "v2":
            return {
                "status": "no_op",
                "reason": "already_v2",
                "changed": False,
                "classification": "v2",
                "protocol_version": PROTOCOL_VERSION,
                "migration_id": ((second.get("data") or {}).get("migration") or {}).get("migration_id"),
            }
        if second["classification"] != "legacy":
            raise MigrationRefusedError("Project changed while waiting for the migration lock")
        receipt = _apply_plan(
            root,
            plan,
            schema_dir=schema_dir,
            engine=engine,
        )
    final = classify_project(root, schema_dir=schema_dir, engine=engine)
    if final["classification"] != "v2":
        raise MigrationRecoveryRequired("Committed migration did not reopen as a valid v2 project")
    emit_operation_event(
        "migration",
        "committed",
        "completed",
        details={"migration_id": identifier, "created_path_count": len(receipt["created_paths"])},
    )
    return {
        "status": "migrated",
        "changed": True,
        "classification_before": "legacy",
        "classification_after": "v2",
        "protocol_version": PROTOCOL_VERSION,
        "migration_id": identifier,
        "backup_path": plan["migration_dir"],
        "manifest_path": plan["manifest_path"],
        "receipt_path": plan["receipt_path"],
        "rollback_instructions_path": plan["rollback_path"],
        "created_paths": receipt["created_paths"],
        "replaced_paths": receipt["replaced_paths"],
        "line_derived": receipt["line_derived"],
        "preserved_file_count": receipt["preserved_file_count"],
    }


def recover_incomplete_migrations(project_root: str | Path) -> list[dict[str, Any]]:
    """Roll back uncommitted migrations and finalize durable commits."""

    root = _project_root(project_root)
    incomplete, errors = _incomplete_migration_ids(root)
    if errors:
        raise MigrationRecoveryRequired("; ".join(errors))
    if not incomplete:
        return []
    busy = _active_run_errors(root)
    if busy:
        raise MigrationRefusedError(
            "Migration recovery requires an idle project: " + "; ".join(busy)
        )
    results: list[dict[str, Any]] = []
    with _MigrationLock(root):
        for migration_id in incomplete:
            migration_dir = _project_path(root, f"{MIGRATION_ROOT}/{migration_id}")
            if not (migration_dir / "MIGRATION_MANIFEST.json").is_file():
                shutil.rmtree(migration_dir)
                _fsync_directory(migration_dir.parent)
                results.append(
                    {
                        "migration_id": migration_id,
                        "action": "removed_unprepared",
                        "state": "rolled_back",
                    }
                )
                emit_operation_event(
                    "migration",
                    "recovery",
                    "completed",
                    details={"migration_id": migration_id, "action": "removed_unprepared", "state": "rolled_back"},
                )
                continue
            manifest_relative, manifest = _load_manifest(root, migration_id)
            commit_path = migration_dir / "COMMITTED.json"
            if manifest.get("state") == "rolling_back":
                _restore_from_manifest(root, manifest_relative, manifest, strict_after=False)
                action = "rolled_back"
            elif commit_path.is_file():
                commit = _verify_commit(root, migration_id, manifest)
                for operation in manifest["operations"]:
                    if _target_state(root, operation) != "after":
                        raise MigrationRecoveryRequired(
                            f"Committed migration target is missing or changed: {operation['path']}"
                        )
                manifest["state"] = "committed"
                manifest["updated_at"] = str(commit.get("committed_at") or utc_z_timestamp())
                _persist_manifest(root, manifest_relative, manifest)
                action = "finalized"
            else:
                _restore_from_manifest(root, manifest_relative, manifest, strict_after=False)
                action = "rolled_back"
            result = {"migration_id": migration_id, "action": action, "state": manifest["state"]}
            results.append(result)
            emit_operation_event(
                "migration",
                "recovery",
                "completed",
                details=result,
            )
    return results


def rollback_migration(
    project_root: str | Path,
    *,
    migration_id: str | None = None,
) -> dict[str, Any]:
    """Restore exact before snapshots after proving no migration target changed."""

    root = _project_root(project_root)
    emit_operation_event(
        "migration",
        "rollback_requested",
        "starting",
        details={"migration_id": migration_id},
    )
    if migration_id is None:
        marker = _read_json_file(root, ACTIVE_MARKER)
        if not isinstance(marker, dict) or not isinstance(marker.get("migration_id"), str):
            raise MigrationRefusedError("No active migrated-project marker identifies a rollback")
        migration_id = marker["migration_id"]
    with _MigrationLock(root):
        manifest_relative, manifest = _load_manifest(root, migration_id)
        if manifest.get("state") == "rolled_back":
            return {"status": "no_op", "reason": "already_rolled_back", "changed": False, "migration_id": migration_id}
        if manifest.get("state") != "committed":
            raise MigrationRecoveryRequired("Recover an incomplete migration before explicit rollback")
        _verify_commit(root, migration_id, manifest)
        if _active_run_errors(root):
            raise MigrationRefusedError("Rollback requires an idle project")
        recorded = {item["path"] for item in manifest["operations"]}
        newer = [
            relative
            for relative, _kind in _artifact_paths(root)
            if _project_path(root, relative).is_file() and relative not in recorded
        ]
        if newer:
            raise RollbackConflictError(
                "Rollback refused; newer v2 canonical artifacts exist: " + ", ".join(newer)
            )
        _restore_from_manifest(root, manifest_relative, manifest, strict_after=True)
    classification = classify_project(root)
    if classification["classification"] != "legacy":
        raise MigrationRecoveryRequired("Rollback did not restore a readable legacy project")
    emit_operation_event(
        "migration",
        "rolled_back",
        "completed",
        details={"migration_id": migration_id},
    )
    return {
        "status": "rolled_back",
        "changed": True,
        "migration_id": migration_id,
        "classification": "legacy",
        "original_hashes_verified": True,
        "backup_retained": f"{MIGRATION_ROOT}/{migration_id}",
    }


__all__ = [
    "ACTIVE_MARKER",
    "CORE_ARTIFACTS",
    "INSTRUCTION_MANIFEST",
    "MIGRATION_FORMAT_VERSION",
    "MIGRATION_ROOT",
    "PROTOCOL_VERSION",
    "TEMPLATE_MANIFEST",
    "MigrationError",
    "MigrationRecoveryRequired",
    "MigrationRefusedError",
    "RollbackConflictError",
    "build_fresh_v2_artifacts",
    "classify_project",
    "migrate_project",
    "normalize_legacy_fields",
    "plan_migration",
    "recover_incomplete_migrations",
    "rollback_migration",
]
