"""Durable launch boundaries and full-reset transactions for v2 Restart."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

from v2_contracts import canonical_json_bytes
from v2_artifacts import paired_markdown_errors, render_markdown, validate_artifact
from v2_migration import ACTIVE_MARKER, build_fresh_v2_artifacts, classify_project


LAUNCH_BOUNDARY = "archive/launch_boundaries/INITIAL"
ACTIVE_LAUNCH_BOUNDARY = "archive/launch_boundaries/ACTIVE.json"
RESTART_ROOT = "archive/restarts"
ACTIVE_FULL_RESET = "archive/restarts/ACTIVE_FULL_RESET.json"
RESTART_FORMAT_VERSION = 3
MOVED_PATHS = (
    "PROJECT.md",
    "research_trajectory",
    "manuscript",
    "workspace",
    "resources",
    "archive/v2_plan_invalidations",
    ACTIVE_MARKER,
    ACTIVE_FULL_RESET,
)


class RestartRefusedError(ValueError):
    """The requested reset cannot be proven safe before mutation."""


class RestartRecoveryRequired(RuntimeError):
    """A prepared reset could not be restored to one complete state."""


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _parse_time(value: Any) -> datetime:
    text = str(value or "").strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _atomic_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.tmp-{uuid.uuid4().hex}"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def _atomic_json(path: Path, value: Any) -> None:
    _atomic_bytes(path, canonical_json_bytes(value))


def _contained(root: Path, relative: str) -> Path:
    raw = str(relative or "").strip().replace("\\", "/")
    candidate = Path(raw)
    if not raw or candidate.is_absolute() or ".." in candidate.parts:
        raise RestartRefusedError(f"Unsafe project-relative path: {relative!r}")
    root = root.resolve(strict=True)
    resolved = (root / candidate).resolve(strict=False)
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise RestartRefusedError(f"Path escapes the project: {relative!r}") from exc
    return root / candidate


def _is_goal_launch(message: dict[str, Any]) -> bool:
    text = str(message.get("text") or "").strip().lower()
    return bool(
        message.get("role") == "user"
        and (
            message.get("kind") == "goal-launch"
            or text in {
                "start autoresearch.",
                "start autoresearch",
                "start autoresearch loop.",
                "start autoresearch loop",
            }
        )
    )


def launch_prefix(messages: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    prefix: list[dict[str, Any]] = []
    for raw in messages:
        if not isinstance(raw, dict):
            continue
        item = json.loads(json.dumps(raw, ensure_ascii=False))
        prefix.append(item)
        if _is_goal_launch(item):
            return prefix
    raise RestartRefusedError(
        "No original Start autoresearch message exists; a launch boundary cannot be established."
    )


def _stable_launch_message(message: dict[str, Any]) -> dict[str, Any]:
    """Project a chat card to the immutable fields that define user intent."""

    stable = {
        key: message[key]
        for key in ("id", "role", "kind", "text", "created_at", "mode")
        if key in message
    }
    attachments: list[dict[str, Any]] = []
    for raw in message.get("attachments", ()):
        if not isinstance(raw, dict):
            continue
        attachment = {
            key: raw[key]
            for key in ("kind", "path", "name", "category", "type", "size")
            if key in raw
        }
        if attachment:
            attachments.append(attachment)
    if attachments:
        stable["attachments"] = attachments
    # Project cards are refreshed display projections of PROJECT.md. Their
    # mutable rendered text is bound separately by project_sha256.
    if message.get("kind") != "project" and isinstance(message.get("artifact"), dict):
        artifact = message["artifact"]
        stable_artifact = {
            key: artifact[key]
            for key in ("type", "id", "path", "provider", "model")
            if key in artifact
        }
        if stable_artifact:
            stable["artifact"] = stable_artifact
    return stable


def stable_launch_prefix(messages: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_stable_launch_message(item) for item in launch_prefix(messages)]


def _stable_prefix_hash(messages: Iterable[dict[str, Any]]) -> str:
    return _sha256_bytes(canonical_json_bytes(stable_launch_prefix(messages)))


def _resource_paths_from_messages(messages: Iterable[dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for message in messages:
        for attachment in message.get("attachments", []) if isinstance(message, dict) else []:
            if not isinstance(attachment, dict):
                continue
            relative = str(attachment.get("path") or "").strip().replace("\\", "/")
            if relative.startswith("resources/") and relative not in found:
                found.append(relative)
    return found


def _resource_record(root: Path, relative: str) -> dict[str, Any]:
    path = _contained(root, relative)
    if not (path.exists() or path.is_symlink()):
        raise RestartRefusedError(f"Launch resource is missing: {relative}")
    if path.is_symlink():
        resolved = path.resolve(strict=True)
        if not resolved.is_file():
            raise RestartRefusedError(f"Launch resource symlink is not a file: {relative}")
        return {
            "path": relative,
            "kind": "symlink",
            "link_target": os.readlink(path),
            "size": resolved.stat().st_size,
            "sha256": _sha256_file(resolved),
        }
    if path.is_file():
        return {
            "path": relative,
            "kind": "file",
            "size": path.stat().st_size,
            "sha256": _sha256_file(path),
        }
    if path.is_dir():
        entries = _tree_entries(root, [relative])
        return {
            "path": relative,
            "kind": "directory",
            "entries": entries,
            "content_hash": _sha256_bytes(canonical_json_bytes(entries)),
        }
    raise RestartRefusedError(f"Unsupported launch resource: {relative}")


def _verify_resource_record(root: Path, record: dict[str, Any]) -> None:
    relative = str(record.get("path") or "")
    actual = _resource_record(root, relative)
    recorded_identity = {key: record.get(key) for key in actual}
    if actual != recorded_identity:
        raise RestartRefusedError(f"Launch resource changed after the original Start: {relative}")


def _tree_entries(root: Path, relatives: Iterable[str]) -> list[dict[str, Any]]:
    root = root.resolve(strict=True)
    entries: list[dict[str, Any]] = []
    for relative in sorted(set(str(item) for item in relatives)):
        path = root / relative
        if not (path.exists() or path.is_symlink()):
            continue
        candidates = [path]
        if path.is_dir() and not path.is_symlink():
            candidates.extend(sorted(path.rglob("*")))
        for item in candidates:
            rel = item.relative_to(root).as_posix()
            if item.is_symlink():
                entries.append({"path": rel, "kind": "symlink", "target": os.readlink(item)})
            elif item.is_dir():
                entries.append({"path": rel, "kind": "directory"})
            elif item.is_file():
                entries.append(
                    {
                        "path": rel,
                        "kind": "file",
                        "size": item.stat().st_size,
                        "sha256": _sha256_file(item),
                    }
                )
    return entries


def _write_resource_manifest(path: Path, records: list[dict[str, Any]]) -> None:
    lines = [
        "# Resource Manifest",
        "",
        "This manifest is the immutable explicit-input set captured at the original autoresearch launch.",
        "",
        "## Explicit UI Resources",
        "",
    ]
    if not records:
        lines.append("- <none recorded>")
    for record in records:
        lines.extend(
            [
                f"- `{record['path']}`",
                "  - Provenance: `user_explicit`",
                f"  - SHA-256: `{record.get('sha256') or record.get('content_hash')}`",
                "  - Restart policy: restore and re-run normal intake before evidence use.",
            ]
        )
    lines.extend(
        [
            "",
            "## Inferred Resource References",
            "",
            "- <none recorded>",
            "",
            "## Intake Decisions",
            "",
            "- Restart restored the original explicit inputs; no later discovered or generated input is active.",
            "",
        ]
    )
    _atomic_bytes(path, "\n".join(lines).encode("utf-8"))


def _project_id(root: Path) -> str:
    candidates = (
        root / ".co-auto-research/project.json",
        root / "research_trajectory/STATE.json",
    )
    for path in candidates:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        project_id = str(value.get("projectId") or value.get("project_id") or "").strip()
        if project_id:
            return project_id
    return hashlib.sha256(str(root).encode("utf-8")).hexdigest()[:12]


def _launch_target_venue(project_id: str, project_text: str, created_at: str) -> dict[str, Any]:
    """Extract a draft venue boundary from explicit project framing only."""

    target: str | None = None
    article_type = "research report"
    explicit = re.search(
        r"(?im)^\s*(?:current\s+target|target\s+(?:venue|journal)|venue)\s*:\s*"
        r"([^,.;\n]+)(?:\s*,\s*([^.;\n]+))?",
        project_text,
    )
    if explicit:
        target = explicit.group(1).strip() or None
        if explicit.group(2):
            article_type = explicit.group(2).strip()
    else:
        framed = re.search(
            r"(?im)^\s*(?:develop|prepare|write)\s+an?\s+(.+?)\s+"
            r"(Perspective|Review|Research\s+Article|Article|Comment|Editorial)\b",
            project_text,
        )
        if framed:
            target = framed.group(1).strip(" ,.;") or None
            article_type = framed.group(2).strip()
    article = re.search(
        r"(?im)^\s*(?:article\s+type|manuscript\s+type|format)\s*:\s*([^.;\n]+)",
        project_text,
    )
    if article:
        article_type = article.group(1).strip()
    qualified_type = re.fullmatch(
        r"(Perspective|Review|Comment|Editorial)\s+(?:article|paper)",
        article_type,
        re.IGNORECASE,
    )
    if qualified_type:
        article_type = qualified_type.group(1)
    audience = (
        f"{target} editors, reviewers, and readers"
        if target
        else "General research audience"
    )
    return {
        "schema_version": "2.0",
        "artifact_type": "target_venue",
        "project_id": project_id,
        "created_at": created_at,
        "updated_at": created_at,
        "extensions": {
            "boundary_source": "PROJECT.md",
            "profile_status": "draft",
            "venue_requirements_verified": False,
        },
        "target_venue": target,
        "audience": audience,
        "article_type": article_type,
        "lock_level": "preferred" if target else "exploratory",
        "locked_by_intervention_id": None,
        "profile_path": None,
        "alternative_venues": [],
        "human_constraints": (
            [
                "Treat venue requirements as draft until verified against current official guidance.",
                "Do not claim submission readiness from an unverified venue profile.",
            ]
            if target
            else []
        ),
        "last_published_revision": 0,
    }


def _target_venue_markdown(value: dict[str, Any]) -> bytes:
    venue = value.get("target_venue") or "Not selected"
    body = (
        f"- Venue: {venue}\n"
        f"- Article type: {value.get('article_type') or 'Not selected'}\n"
        f"- Audience: {value.get('audience') or ''}\n"
        f"- Lock level: {value.get('lock_level')}\n"
        "- Profile status: draft; current official venue requirements remain to be verified."
    )
    return render_markdown(value, body=body).encode("utf-8")


def _active_boundary_relative(root: Path) -> str:
    pointer = root / ACTIVE_LAUNCH_BOUNDARY
    if not pointer.is_file():
        return LAUNCH_BOUNDARY
    try:
        value = json.loads(pointer.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RestartRefusedError("The active launch-boundary pointer is unreadable.") from exc
    relative = str(value.get("boundary_path") or "")
    boundary = _contained(root, relative)
    if (
        value.get("format_version") != 1
        or not boundary.is_dir()
        or boundary.is_symlink()
    ):
        raise RestartRefusedError("The active launch-boundary pointer is invalid.")
    manifest = boundary / "launch_boundary.json"
    if not manifest.is_file() or _sha256_file(manifest) != value.get("manifest_sha256"):
        raise RestartRefusedError("The active launch-boundary pointer hash is invalid.")
    return relative


def _load_boundary(root: Path) -> dict[str, Any]:
    boundary_relative = _active_boundary_relative(root)
    boundary_root = root / boundary_relative
    manifest_path = boundary_root / "launch_boundary.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RestartRefusedError("The immutable launch boundary is missing or unreadable.") from exc
    if not isinstance(manifest, dict) or manifest.get("format_version") not in {1, 2}:
        raise RestartRefusedError("The immutable launch boundary format is unsupported.")
    project = boundary_root / "PROJECT.md"
    framing = boundary_root / "framing_messages.json"
    if not project.is_file() or not framing.is_file():
        raise RestartRefusedError("The immutable launch boundary is incomplete.")
    if _sha256_file(project) != manifest.get("project_sha256"):
        raise RestartRefusedError("The launch-boundary PROJECT.md hash is invalid.")
    if _sha256_file(framing) != manifest.get("framing_file_sha256"):
        raise RestartRefusedError("The launch-boundary framing hash is invalid.")
    try:
        messages = json.loads(framing.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RestartRefusedError("The launch-boundary framing messages are invalid.") from exc
    if not isinstance(messages, list) or launch_prefix(messages) != messages:
        raise RestartRefusedError("The launch-boundary framing prefix does not end at Start autoresearch.")
    prefix_digest = (
        _stable_prefix_hash(messages)
        if manifest.get("format_version") == 2
        else _sha256_bytes(canonical_json_bytes(messages))
    )
    if prefix_digest != manifest.get("framing_prefix_sha256"):
        raise RestartRefusedError("The launch-boundary framing prefix hash is invalid.")
    resources = manifest.get("resources")
    if not isinstance(resources, list):
        raise RestartRefusedError("The launch-boundary resource list is invalid.")
    for record in resources:
        if not isinstance(record, dict):
            raise RestartRefusedError("The launch-boundary resource record is invalid.")
        _verify_resource_record(root, record)
    launch_instruction = str(manifest.get("launch_instruction") or "")
    expected_instruction_hash = manifest.get("launch_instruction_sha256")
    if expected_instruction_hash is not None and expected_instruction_hash != _sha256_bytes(
        launch_instruction.encode("utf-8")
    ):
        raise RestartRefusedError("The launch-boundary instruction hash is invalid.")
    venue_path = boundary_root / "TARGET_VENUE.json"
    if manifest.get("format_version") == 2:
        if not venue_path.is_file() or venue_path.is_symlink():
            raise RestartRefusedError("The launch-boundary target venue is missing.")
        try:
            venue = json.loads(venue_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise RestartRefusedError("The launch-boundary target venue is invalid.") from exc
        if (
            not isinstance(venue, dict)
            or _sha256_bytes(canonical_json_bytes(venue))
            != manifest.get("target_venue_sha256")
        ):
            raise RestartRefusedError("The launch-boundary target venue hash is invalid.")
    else:
        venue = _launch_target_venue(
            _project_id(root),
            project.read_text(encoding="utf-8"),
            str(manifest.get("created_at") or _utc_timestamp()),
        )
    return {
        **manifest,
        "boundary_path": boundary_relative,
        "launch_instruction": launch_instruction,
        "messages": messages,
        "project_bytes": project.read_bytes(),
        "target_venue": venue,
    }


def _correct_launch_boundary(root: Path, boundary: dict[str, Any]) -> dict[str, Any]:
    """Create a new active boundary while preserving the original evidence."""

    if boundary.get("format_version") == 2:
        return boundary
    correction_id = f"CORRECTED-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    relative = f"archive/launch_boundaries/{correction_id}"
    destination = root / relative
    temporary = destination.parent / f".{correction_id}.tmp-{uuid.uuid4().hex}"
    temporary.mkdir(parents=True, exist_ok=False)
    try:
        project_bytes = bytes(boundary["project_bytes"])
        framing_bytes = canonical_json_bytes(boundary["messages"])
        venue = _launch_target_venue(
            _project_id(root),
            project_bytes.decode("utf-8"),
            str(boundary.get("created_at") or _utc_timestamp()),
        )
        _atomic_bytes(temporary / "PROJECT.md", project_bytes)
        _atomic_bytes(temporary / "framing_messages.json", framing_bytes)
        _write_resource_manifest(temporary / "RESOURCE_MANIFEST.md", boundary["resources"])
        _atomic_json(temporary / "TARGET_VENUE.json", venue)
        _atomic_bytes(temporary / "TARGET_VENUE.md", _target_venue_markdown(venue))
        old_manifest = root / str(boundary.get("boundary_path") or LAUNCH_BOUNDARY) / "launch_boundary.json"
        old_framing = root / str(boundary.get("boundary_path") or LAUNCH_BOUNDARY) / "framing_messages.json"
        manifest = {
            **{
                key: value
                for key, value in boundary.items()
                if key
                not in {
                    "boundary_path",
                    "messages",
                    "project_bytes",
                    "target_venue",
                    "format_version",
                    "framing_prefix_sha256",
                    "framing_file_sha256",
                }
            },
            "format_version": 2,
            "corrected_at": _utc_timestamp(),
            "correction_source": {
                "boundary_path": str(boundary.get("boundary_path") or LAUNCH_BOUNDARY),
                "manifest_sha256": _sha256_file(old_manifest),
                "framing_sha256": _sha256_file(old_framing),
                "project_sha256": str(boundary["project_sha256"]),
                "verified_source": boundary.get("source"),
                "reason": "Stabilize launch control fields and bind target venue without rewriting historical evidence.",
            },
            "framing_prefix_sha256": _stable_prefix_hash(boundary["messages"]),
            "framing_file_sha256": _sha256_bytes(framing_bytes),
            "target_venue_sha256": _sha256_bytes(canonical_json_bytes(venue)),
        }
        _atomic_json(temporary / "launch_boundary.json", manifest)
        os.replace(temporary, destination)
        _atomic_json(
            root / ACTIVE_LAUNCH_BOUNDARY,
            {
                "format_version": 1,
                "boundary_path": relative,
                "manifest_sha256": _sha256_file(destination / "launch_boundary.json"),
                "previous_boundary_path": str(boundary.get("boundary_path") or LAUNCH_BOUNDARY),
                "activated_at": _utc_timestamp(),
            },
        )
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return _load_boundary(root)


def ensure_launch_boundary(
    project_root: str | Path,
    messages: list[dict[str, Any]],
    *,
    source: str,
    explicit_resource_paths: Iterable[str] = (),
    launch_instruction: str = "",
    expected_project_sha256: str = "",
    expected_goal_launch_id: str = "",
    corroborating_project_path: str = "",
) -> dict[str, Any]:
    """Create once, or validate, the exact first-launch boundary."""

    root = Path(project_root).resolve(strict=True)
    boundary_root = root / LAUNCH_BOUNDARY
    if boundary_root.exists():
        boundary = _load_boundary(root)
        boundary = _correct_launch_boundary(root, boundary)
        current_prefix = launch_prefix(messages)
        if _stable_prefix_hash(current_prefix) != boundary.get(
            "framing_prefix_sha256"
        ):
            raise RestartRefusedError(
                "The visible chat prefix no longer matches the immutable original launch boundary."
            )
        return boundary
    prefix = launch_prefix(messages)
    goal = prefix[-1]
    if source == "cold_start":
        project_source = root / "PROJECT.md"
        provenance = {"kind": "cold_start", "path": "PROJECT.md"}
    elif source == "verified_first_checkpoint":
        expected_digest = str(expected_project_sha256 or "").strip().lower()
        expected_goal = str(expected_goal_launch_id or "").strip()
        corroborating_relative = str(corroborating_project_path or "").strip()
        if not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
            raise RestartRefusedError(
                "A verified checkpoint backfill requires an independently established PROJECT.md SHA-256."
            )
        if not expected_goal or expected_goal != str(goal.get("id") or ""):
            raise RestartRefusedError(
                "A verified checkpoint backfill requires the exact original goal-launch id."
            )
        if not corroborating_relative:
            raise RestartRefusedError(
                "A verified checkpoint backfill requires an independent pre-continuation PROJECT.md copy."
            )
        checkpoint_candidates = sorted((root / "research_trajectory/checkpoints").glob("*/PROJECT.md"))
        if not checkpoint_candidates:
            raise RestartRefusedError("No first checkpoint exists for a trustworthy launch-boundary backfill.")
        project_source = checkpoint_candidates[0]
        manifest = project_source.parent / "MANIFEST.md"
        if not manifest.is_file() or "`PROJECT.md`" not in manifest.read_text(encoding="utf-8", errors="strict"):
            raise RestartRefusedError("The first checkpoint does not declare PROJECT.md in its manifest.")
        if _sha256_file(project_source) != expected_digest:
            raise RestartRefusedError(
                "The first checkpoint PROJECT.md does not match the independently established hash."
            )
        corroborating_source = _contained(root, corroborating_relative)
        if (
            corroborating_source == project_source
            or not corroborating_source.is_file()
            or corroborating_source.is_symlink()
            or _sha256_file(corroborating_source) != expected_digest
        ):
            raise RestartRefusedError(
                "The independent pre-continuation PROJECT.md copy does not corroborate the first checkpoint."
            )
        goal_time = _parse_time(goal.get("created_at"))
        if int(project_source.stat().st_mtime) != int(goal_time.timestamp()):
            raise RestartRefusedError(
                "The first checkpoint PROJECT.md timestamp does not match the original Start autoresearch boundary."
            )
        provenance = {
            "kind": "verified_first_checkpoint",
            "path": project_source.relative_to(root).as_posix(),
            "manifest_path": manifest.relative_to(root).as_posix(),
            "expected_project_sha256": expected_digest,
            "goal_launch_id": expected_goal,
            "corroborating_path": corroborating_source.relative_to(root).as_posix(),
        }
    else:
        raise RestartRefusedError(f"Unsupported launch-boundary source: {source}")
    if not project_source.is_file():
        raise RestartRefusedError("The launch-boundary PROJECT.md source is missing.")
    resource_paths = _resource_paths_from_messages(prefix)
    for raw in explicit_resource_paths:
        relative = str(raw or "").strip().replace("\\", "/")
        if relative.startswith("resources/") and relative not in resource_paths:
            resource_paths.append(relative)
    resources = [_resource_record(root, relative) for relative in resource_paths]
    temporary = boundary_root.parent / f".INITIAL.tmp-{uuid.uuid4().hex}"
    temporary.mkdir(parents=True, exist_ok=False)
    try:
        project_bytes = project_source.read_bytes()
        framing_bytes = canonical_json_bytes(prefix)
        created_at = _utc_timestamp()
        target_venue = _launch_target_venue(
            _project_id(root), project_bytes.decode("utf-8"), created_at
        )
        _atomic_bytes(temporary / "PROJECT.md", project_bytes)
        _atomic_bytes(temporary / "framing_messages.json", framing_bytes)
        _write_resource_manifest(temporary / "RESOURCE_MANIFEST.md", resources)
        _atomic_json(temporary / "TARGET_VENUE.json", target_venue)
        _atomic_bytes(
            temporary / "TARGET_VENUE.md", _target_venue_markdown(target_venue)
        )
        original_instruction = str(launch_instruction or "")[:4000]
        manifest = {
            "format_version": 2,
            "created_at": created_at,
            "source": provenance,
            "goal_launch_id": str(goal.get("id") or ""),
            "goal_launch_created_at": str(goal.get("created_at") or ""),
            "project_sha256": _sha256_bytes(project_bytes),
            "framing_prefix_sha256": _stable_prefix_hash(prefix),
            "framing_file_sha256": _sha256_bytes(framing_bytes),
            "target_venue_sha256": _sha256_bytes(
                canonical_json_bytes(target_venue)
            ),
            "launch_instruction": original_instruction,
            "launch_instruction_sha256": _sha256_bytes(
                original_instruction.encode("utf-8")
            ),
            "resources": resources,
        }
        _atomic_json(temporary / "launch_boundary.json", manifest)
        os.replace(temporary, boundary_root)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return _load_boundary(root)


def _copy_clean_scaffold(template_root: Path, relative: str, destination: Path) -> None:
    source = template_root / relative
    if source.is_dir():
        shutil.copytree(source, destination, symlinks=True)
    else:
        destination.mkdir(parents=True, exist_ok=True)


def _fresh_markdown_payloads(
    artifacts: dict[str, dict[str, Any]],
) -> dict[str, bytes]:
    """Render every revision-zero canonical view from its authoritative JSON."""

    state_value = artifacts["research_trajectory/STATE.json"]
    state_body = f"""## Current Objective

{state_value['current_objective']}

## Autoresearch Goal Gate

Status: continue

Required reviewer gates:
- Plan reviewer: continue - pending Trial 1
- Process reviewer: continue - pending Trial 1
- Evidence reviewer: continue - pending Trial 1
- Venue fit reviewer: continue - pending Trial 1
- Manuscript reviewer: continue - pending Trial 1
- Figure/table reviewer: continue - pending Trial 1
- Reference reviewer: continue - pending Trial 1
- Final gate reviewer: continue - pending Trial 1

Critical path: initialize Trial 1 from the immutable launch boundary; empirical progress this trial: no

Next action: plan Trial 1.
""".strip()
    bodies = {
        "research_trajectory/STATE.json": state_body,
        "research_trajectory/CURRENT_FINDINGS.json": (
            "No findings have been accepted in this restarted trajectory."
        ),
        "research_trajectory/HUMAN_TASKS.json": (
            "## Open Tasks\n\n- none\n\n## Closed Tasks\n\n- none"
        ),
    }
    return {
        relative[:-5] + ".md": render_markdown(value, body=bodies[relative]).encode(
            "utf-8"
        )
        for relative, value in artifacts.items()
        if relative in bodies
    }


def _manifest_path(root: Path, restart_id: str) -> Path:
    return root / RESTART_ROOT / restart_id / "restart_manifest.json"


def _set_manifest_state(path: Path, state: str, **updates: Any) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    value.update(updates)
    value["state"] = state
    value["updated_at"] = _utc_timestamp()
    _atomic_json(path, value)
    return value


def _move_to_snapshot(root: Path, restart_root: Path, relative: str) -> bool:
    source = root / relative
    if not (source.exists() or source.is_symlink()):
        return False
    destination = restart_root / "pre_restart_state" / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    os.replace(source, destination)
    return True


def _verify_archived_entries(restart_root: Path, entries: list[dict[str, Any]]) -> None:
    snapshot = restart_root / "pre_restart_state"
    for entry in entries:
        relative = str(entry.get("path") or "")
        path = snapshot / relative
        kind = entry.get("kind")
        if kind == "directory":
            valid = path.is_dir() and not path.is_symlink()
        elif kind == "symlink":
            valid = path.is_symlink() and os.readlink(path) == entry.get("target")
        elif kind == "file":
            valid = bool(
                path.is_file()
                and not path.is_symlink()
                and path.stat().st_size == entry.get("size")
                and _sha256_file(path) == entry.get("sha256")
            )
        else:
            valid = False
        if not valid:
            raise RestartRecoveryRequired(
                f"Archived restart evidence does not match its source hash: {relative}"
            )


def _external_runtime_entries(runtime: Path | None) -> list[dict[str, Any]]:
    if runtime is None or not runtime.exists():
        return []
    if runtime.is_symlink() or not runtime.is_dir():
        raise RestartRefusedError("The service runtime scope is not a trustworthy directory.")
    entries: list[dict[str, Any]] = []
    for path in sorted(runtime.rglob("*")):
        relative = path.relative_to(runtime).as_posix()
        metadata = os.lstat(path)
        if path.is_symlink():
            raise RestartRefusedError(
                f"The service runtime snapshot refuses a link: {relative}"
            )
        if path.is_dir():
            entries.append({"path": relative, "kind": "directory"})
        elif path.is_file() and int(getattr(metadata, "st_nlink", 1)) == 1:
            entries.append(
                {
                    "path": relative,
                    "kind": "file",
                    "size": metadata.st_size,
                    "sha256": _sha256_file(path),
                }
            )
        else:
            raise RestartRefusedError(
                f"The service runtime snapshot refuses a non-regular file: {relative}"
            )
    return entries


def _copy_external_runtime(
    runtime: Path | None, destination: Path, entries: list[dict[str, Any]]
) -> None:
    if runtime is None or not entries:
        return
    for entry in entries:
        relative = str(entry["path"])
        source = runtime / relative
        target = destination / relative
        if entry["kind"] == "directory":
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target, follow_symlinks=False)
        if (
            target.stat().st_size != entry["size"]
            or _sha256_file(target) != entry["sha256"]
            or _sha256_file(source) != entry["sha256"]
        ):
            raise RestartRecoveryRequired(
                f"Service runtime changed while it was archived: {relative}"
            )


def _restore_retained_resources(root: Path, restart_root: Path, resources: list[dict[str, Any]]) -> None:
    for record in resources:
        relative = str(record["path"])
        source = restart_root / "pre_restart_state" / relative
        destination = root / relative
        if not (source.exists() or source.is_symlink()):
            raise RestartRecoveryRequired(f"Archived launch resource is missing: {relative}")
        if destination.exists() or destination.is_symlink():
            _remove(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, destination)
        _verify_resource_record(root, record)


def _remove(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def _rollback_prepared(root: Path, manifest_path: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    restart_root = manifest_path.parent
    marker = root / ACTIVE_FULL_RESET
    if marker.is_file():
        active_marker = json.loads(marker.read_text(encoding="utf-8"))
        if active_marker.get("restart_id") == manifest.get("restart_id"):
            marker.unlink()
    resources = (
        manifest.get("retained_resources")
        if isinstance(manifest.get("retained_resources"), list)
        else manifest.get("launch_resources")
        if isinstance(manifest.get("launch_resources"), list)
        else []
    )
    archived_resources = restart_root / "pre_restart_state/resources"
    if archived_resources.exists():
        for record in resources:
            relative = str(record.get("path") or "")
            active = root / relative
            archived = restart_root / "pre_restart_state" / relative
            if (active.exists() or active.is_symlink()) and not (archived.exists() or archived.is_symlink()):
                archived.parent.mkdir(parents=True, exist_ok=True)
                os.replace(active, archived)
    for relative in reversed(MOVED_PATHS):
        archived = restart_root / "pre_restart_state" / relative
        if not (archived.exists() or archived.is_symlink()):
            continue
        active = root / relative
        if active.exists() or active.is_symlink():
            _remove(active)
        active.parent.mkdir(parents=True, exist_ok=True)
        os.replace(archived, active)
    return _set_manifest_state(manifest_path, "rolled_back", rolled_back_at=_utc_timestamp())


def recover_prepared_full_restarts(project_root: str | Path) -> list[str]:
    root = Path(project_root).resolve(strict=True)
    recovered: list[str] = []
    restart_root = root / RESTART_ROOT
    if not restart_root.is_dir():
        return recovered
    for manifest_path in sorted(
        restart_root.glob(
            "R*/contract_corrections/CORRECTION-*/reconciliation_manifest.json"
        )
    ):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise RestartRecoveryRequired(
                f"Unreadable revision-zero correction manifest: {manifest_path}"
            ) from exc
        if not isinstance(manifest, dict) or manifest.get("format_version") != 1:
            raise RestartRecoveryRequired(
                f"Unsupported revision-zero correction manifest: {manifest_path}"
            )
        if manifest.get("state") != "prepared":
            continue
        operations = manifest.get("operations")
        if not isinstance(operations, list) or not operations:
            raise RestartRecoveryRequired(
                f"Incomplete revision-zero correction manifest: {manifest_path}"
            )
        normalized: list[tuple[dict[str, Any], Path, Path, Path]] = []
        for operation in operations:
            if not isinstance(operation, dict):
                raise RestartRecoveryRequired(
                    f"Invalid revision-zero correction operation: {manifest_path}"
                )
            relative = str(operation.get("path") or "")
            target = _contained(root, relative)
            before = manifest_path.parent / "before" / relative
            after = manifest_path.parent / "after" / relative
            if (
                operation.get("before_kind") not in {"file", "missing"}
                or not re.fullmatch(r"[0-9a-f]{64}", str(operation.get("after_sha256") or ""))
                or after.is_symlink()
                or not after.is_file()
                or _sha256_file(after) != operation.get("after_sha256")
            ):
                raise RestartRecoveryRequired(
                    f"Invalid revision-zero correction evidence: {relative}"
                )
            if operation["before_kind"] == "file" and (
                before.is_symlink()
                or not before.is_file()
                or _sha256_file(before) != operation.get("before_sha256")
            ):
                raise RestartRecoveryRequired(
                    f"Invalid revision-zero rollback evidence: {relative}"
                )
            normalized.append((operation, target, before, after))

        all_after = all(
            target.is_file()
            and not target.is_symlink()
            and _sha256_file(target) == operation["after_sha256"]
            for operation, target, _before, _after in normalized
        )
        if all_after:
            classified = classify_project(root)
            if classified.get("classification") != "v2" or int(
                classified.get("canonical_revision")
                if classified.get("canonical_revision") is not None
                else -1
            ) != 0:
                raise RestartRecoveryRequired(
                    "A fully written revision-zero correction is not coherent."
                )
            manifest["state"] = "committed"
            manifest["committed_at"] = _utc_timestamp()
            _atomic_json(manifest_path, manifest)
            recovered.append(f"{manifest['correction_id']}:committed")
            continue

        for operation, target, before, _after in reversed(normalized):
            if operation["before_kind"] == "missing":
                if target.is_symlink() or (target.exists() and not target.is_file()):
                    raise RestartRecoveryRequired(
                        f"Unsafe revision-zero correction rollback target: {operation['path']}"
                    )
                target.unlink(missing_ok=True)
            else:
                if target.is_symlink() or (target.exists() and not target.is_file()):
                    raise RestartRecoveryRequired(
                        f"Unsafe revision-zero correction rollback target: {operation['path']}"
                    )
                _atomic_bytes(target, before.read_bytes())
        manifest["state"] = "rolled_back"
        manifest["rolled_back_at"] = _utc_timestamp()
        _atomic_json(manifest_path, manifest)
        recovered.append(f"{manifest['correction_id']}:rolled_back")
    for manifest_path in sorted(restart_root.glob("R*/restart_manifest.json")):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise RestartRecoveryRequired(f"Unreadable restart manifest: {manifest_path}") from exc
        if manifest.get("format_version") in {2, RESTART_FORMAT_VERSION} and manifest.get("state") == "prepared":
            _rollback_prepared(root, manifest_path)
            recovered.append(str(manifest.get("restart_id") or manifest_path.parent.name))
    marker_path = root / ACTIVE_FULL_RESET
    if not marker_path.exists():
        committed = []
        for manifest_path in sorted(restart_root.glob("R*/restart_manifest.json")):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                continue
            if (
                manifest.get("format_version") in {2, RESTART_FORMAT_VERSION}
                and manifest.get("state") == "committed"
            ):
                committed.append((manifest_path, manifest))
        if committed:
            manifest_path, manifest = committed[-1]
            classification = classify_project(root)
            trials = root / "research_trajectory/trials"
            active_trials = [
                item for item in trials.iterdir() if item.is_dir() and not item.is_symlink()
            ] if trials.is_dir() else []
            if classification.get("classification") == "v2" and int(
                classification.get("canonical_revision") or 0
            ) == 0 and not active_trials:
                _atomic_json(
                    marker_path,
                    {
                        "format_version": 1,
                        "restart_id": manifest["restart_id"],
                        "mode": "v2_full_reset",
                        "manifest_path": manifest_path.relative_to(root).as_posix(),
                        "manifest_sha256": _sha256_file(manifest_path),
                        "activated_at": _utc_timestamp(),
                    },
                )
                recovered.append(f"{manifest['restart_id']}:activation")
    return recovered


def active_full_reset(project_root: str | Path) -> dict[str, Any] | None:
    root = Path(project_root).resolve(strict=True)
    path = root / ACTIVE_FULL_RESET
    if not path.is_file():
        return None
    try:
        marker = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RestartRecoveryRequired("The active full-reset marker is unreadable.") from exc
    manifest_relative = str(marker.get("manifest_path") or "")
    manifest_path = _contained(root, manifest_relative)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RestartRecoveryRequired("The active full-reset manifest is unreadable.") from exc
    if (
        marker.get("restart_id") != manifest.get("restart_id")
        or manifest.get("state") != "committed"
        or marker.get("manifest_sha256") != _sha256_file(manifest_path)
    ):
        raise RestartRecoveryRequired("The active full-reset marker does not match its committed manifest.")
    return {**marker, "manifest": manifest}


def reconcile_active_restart_revision_zero(
    project_root: str | Path,
    *,
    fault_at: str = "",
) -> dict[str, Any]:
    """Reconcile revision-zero artifacts written by a retired Restart build.

    This is a narrowly versioned data migration, not a permissive recovery
    branch.  It runs only for a committed full reset whose canonical revision
    is still zero, derives every replacement from the immutable launch
    boundary, preserves the old bytes in an append-only correction record, and
    rolls all active writes back if validation fails.
    """

    root = Path(project_root).resolve(strict=True)
    active = active_full_reset(root)
    if active is None:
        return {"changed": False, "reason": "no_active_full_reset"}
    revision_path = root / "research_trajectory/CANONICAL_REVISION.json"
    state_path = root / "research_trajectory/STATE.json"
    try:
        revision = json.loads(revision_path.read_text(encoding="utf-8"))
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RestartRecoveryRequired(
            "The active Restart revision-zero artifacts are unreadable."
        ) from exc
    if (
        not isinstance(revision, dict)
        or not isinstance(state, dict)
        or revision.get("revision") != 0
        or revision.get("published_trial_id") is not None
        or state.get("canonical_revision") != 0
    ):
        return {"changed": False, "reason": "not_revision_zero"}

    boundary = _correct_launch_boundary(root, _load_boundary(root))
    project_id = str(revision.get("project_id") or state.get("project_id") or "")
    # A legacy boundary may have used the project-root fallback before the
    # stable project id existed.  The active canonical artifact identity is the
    # authoritative id for the corrected live copy.
    if not project_id:
        raise RestartRecoveryRequired(
            "The active Restart has no trustworthy project identity."
        )
    desired_state = dict(state)
    desired_state["goal_gate_path"] = None

    revision_zero_artifacts: dict[str, dict[str, Any]] = {
        "research_trajectory/STATE.json": desired_state,
    }
    for relative, artifact_type in (
        ("research_trajectory/CURRENT_FINDINGS.json", "current_findings"),
        ("research_trajectory/HUMAN_TASKS.json", "human_tasks"),
    ):
        path = _contained(root, relative)
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise RestartRecoveryRequired(
                f"The active Restart artifact is unreadable: {relative}."
            ) from exc
        if not isinstance(value, dict):
            raise RestartRecoveryRequired(
                f"The active Restart artifact is not an object: {relative}."
            )
        artifact_errors = validate_artifact(
            value,
            expected_type=artifact_type,
            path=relative,
            schema_dir=(root / "schemas" if (root / "schemas/common.schema.json").is_file() else None),
        )
        if artifact_errors:
            raise RestartRecoveryRequired(
                f"The active Restart artifact is invalid: {relative}: "
                + "; ".join(artifact_errors[:12])
            )
        revision_zero_artifacts[relative] = value

    desired_venue = dict(boundary["target_venue"])
    desired_venue.update(
        {
            "project_id": project_id,
            "last_published_revision": 0,
        }
    )
    installed_schemas = root / "schemas"
    schema_dir = (
        installed_schemas
        if (installed_schemas / "common.schema.json").is_file()
        else None
    )
    state_errors = validate_artifact(
        desired_state,
        expected_type="project_state",
        path="research_trajectory/STATE.json",
        schema_dir=schema_dir,
    )
    venue_errors = validate_artifact(
        desired_venue,
        expected_type="target_venue",
        path="resources/target_venue/TARGET_VENUE.json",
        schema_dir=schema_dir,
    )
    if state_errors or venue_errors:
        raise RestartRecoveryRequired(
            "The launch-boundary revision-zero correction is invalid: "
            + "; ".join((state_errors + venue_errors)[:12])
        )

    desired: dict[str, bytes] = {}
    state_bytes = canonical_json_bytes(desired_state)
    if state_path.read_bytes() != state_bytes:
        desired["research_trajectory/STATE.json"] = state_bytes
    for relative, content in _fresh_markdown_payloads(
        revision_zero_artifacts
    ).items():
        path = _contained(root, relative)
        if not path.is_file() or path.is_symlink() or path.read_bytes() != content:
            desired[relative] = content
    venue_json = canonical_json_bytes(desired_venue)
    venue_path = root / "resources/target_venue/TARGET_VENUE.json"
    if not venue_path.is_file() or venue_path.is_symlink() or venue_path.read_bytes() != venue_json:
        desired["resources/target_venue/TARGET_VENUE.json"] = venue_json
    venue_markdown = _target_venue_markdown(desired_venue)
    venue_markdown_path = root / "resources/target_venue/TARGET_VENUE.md"
    if (
        not venue_markdown_path.is_file()
        or venue_markdown_path.is_symlink()
        or venue_markdown_path.read_bytes() != venue_markdown
    ):
        desired["resources/target_venue/TARGET_VENUE.md"] = venue_markdown
    if not desired:
        return {"changed": False, "reason": "already_current"}

    restart_id = str(active.get("restart_id") or "")
    correction_id = (
        datetime.now(timezone.utc).strftime("CORRECTION-%Y%m%dT%H%M%SZ-")
        + uuid.uuid4().hex[:8]
    )
    correction_root = (
        root / RESTART_ROOT / restart_id / "contract_corrections" / correction_id
    )
    temporary = correction_root.parent / f".{correction_id}.tmp-{uuid.uuid4().hex}"
    operations: list[dict[str, Any]] = []
    temporary.mkdir(parents=True, exist_ok=False)
    try:
        for relative, after_bytes in sorted(desired.items()):
            target = _contained(root, relative)
            if target.exists() or target.is_symlink():
                if target.is_symlink() or not target.is_file():
                    raise RestartRecoveryRequired(
                        f"The revision-zero correction target is not a regular file: {relative}"
                    )
                before_bytes = target.read_bytes()
                before_kind = "file"
                _atomic_bytes(temporary / "before" / relative, before_bytes)
                before_sha256 = _sha256_bytes(before_bytes)
            else:
                before_kind = "missing"
                before_sha256 = None
            _atomic_bytes(temporary / "after" / relative, after_bytes)
            operations.append(
                {
                    "path": relative,
                    "before_kind": before_kind,
                    "before_sha256": before_sha256,
                    "after_sha256": _sha256_bytes(after_bytes),
                    "after_size": len(after_bytes),
                }
            )
        manifest = {
            "format_version": 1,
            "correction_id": correction_id,
            "restart_id": restart_id,
            "state": "prepared",
            "prepared_at": _utc_timestamp(),
            "reason": (
                "Reconcile retired revision-zero Goal Gate, canonical paired "
                "Markdown, and target-venue artifacts from the immutable "
                "corrected launch boundary."
            ),
            "launch_boundary": str(boundary.get("boundary_path") or LAUNCH_BOUNDARY),
            "launch_boundary_project_sha256": str(boundary.get("project_sha256") or ""),
            "operations": operations,
        }
        _atomic_json(temporary / "reconciliation_manifest.json", manifest)
        os.replace(temporary, correction_root)
        if fault_at == "after_prepare":
            raise RestartRecoveryRequired(
                "Injected interruption after revision-zero correction prepare."
            )

        try:
            for operation in operations:
                relative = str(operation["path"])
                _atomic_bytes(
                    _contained(root, relative),
                    (correction_root / "after" / relative).read_bytes(),
                )
                if fault_at == f"after_write:{relative}":
                    raise RuntimeError(
                        f"Injected revision-zero correction failure after {relative}."
                    )
            classified = classify_project(root)
            if classified.get("classification") != "v2" or int(
                classified.get("canonical_revision")
                if classified.get("canonical_revision") is not None
                else -1
            ) != 0:
                raise RestartRecoveryRequired(
                    "The corrected active project is not a coherent v2 revision zero."
                )
            for relative, value in revision_zero_artifacts.items():
                markdown = _contained(root, relative[:-5] + ".md").read_text(
                    encoding="utf-8"
                )
                errors = paired_markdown_errors(value, markdown)
                if errors:
                    raise RestartRecoveryRequired(
                        f"The corrected paired Markdown is invalid: {relative}: "
                        + "; ".join(errors)
                    )
            venue_pair_errors = paired_markdown_errors(
                desired_venue,
                _contained(
                    root, "resources/target_venue/TARGET_VENUE.md"
                ).read_text(encoding="utf-8"),
            )
            if venue_pair_errors:
                raise RestartRecoveryRequired(
                    "The corrected target-venue Markdown is invalid: "
                    + "; ".join(venue_pair_errors)
                )
        except Exception:
            for operation in reversed(operations):
                relative = str(operation["path"])
                target = _contained(root, relative)
                if operation["before_kind"] == "missing":
                    target.unlink(missing_ok=True)
                else:
                    _atomic_bytes(
                        target,
                        (correction_root / "before" / relative).read_bytes(),
                    )
            manifest["state"] = "rolled_back"
            manifest["rolled_back_at"] = _utc_timestamp()
            _atomic_json(correction_root / "reconciliation_manifest.json", manifest)
            raise
        manifest["state"] = "committed"
        manifest["committed_at"] = _utc_timestamp()
        _atomic_json(correction_root / "reconciliation_manifest.json", manifest)
        return {
            "changed": True,
            "correction_id": correction_id,
            "manifest_path": (
                correction_root / "reconciliation_manifest.json"
            ).relative_to(root).as_posix(),
            "paths": [str(item["path"]) for item in operations],
        }
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def perform_full_restart(
    project_root: str | Path,
    *,
    template_root: str | Path,
    boundary: dict[str, Any],
    project_id: str,
    instruction: str,
    sanitize_message: Callable[[dict[str, Any]], dict[str, Any] | None],
    retained_resource_paths: Iterable[str] = (),
    service_runtime_dir: str | Path | None = None,
    fault_at: str = "",
) -> dict[str, Any]:
    """Archive one complete active state and atomically establish revision zero."""

    root = Path(project_root).resolve(strict=True)
    template = Path(template_root).resolve(strict=True)
    # Revalidate every immutable input before creating the transaction.
    boundary = _load_boundary(root)
    classification = classify_project(root)
    if classification.get("classification") != "v2":
        raise RestartRefusedError("A v2 full Restart requires a valid v2 canonical boundary.")
    if not str(project_id or "").strip():
        raise RestartRefusedError("The current v2 project id is missing.")
    restart_message = sanitize_message(
        {
            "id": f"goal-restart_{uuid.uuid4().hex}",
            "role": "user",
            "kind": "goal-restart",
            "text": "Restart autoresearch.",
            "created_at": _utc_timestamp(),
        }
    )
    if not restart_message:
        raise RestartRefusedError("The authoritative Restart chat record is invalid.")
    framing_messages = [*boundary["messages"], restart_message]
    framing_generation = uuid.uuid4().hex
    runtime = (
        Path(service_runtime_dir).resolve(strict=True)
        if service_runtime_dir is not None
        else None
    )
    runtime_entries = _external_runtime_entries(runtime)
    retained_resources = [dict(item) for item in boundary["resources"]]
    retained_by_path = {str(item["path"]): item for item in retained_resources}
    for raw in retained_resource_paths:
        relative = str(raw or "").strip().replace("\\", "/")
        if not relative or relative in retained_by_path:
            continue
        record = _resource_record(root, relative)
        record["provenance"] = "user_confirmed"
        retained_resources.append(record)
        retained_by_path[relative] = record
    restart_id = f"R{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    restart_root = root / RESTART_ROOT / restart_id
    restart_root.mkdir(parents=True, exist_ok=False)
    retained_paths = [str(item["path"]) for item in retained_resources]
    old_entries = [
        entry
        for entry in _tree_entries(root, MOVED_PATHS)
        if not any(
            str(entry.get("path") or "") == retained
            or str(entry.get("path") or "").startswith(retained.rstrip("/") + "/")
            for retained in retained_paths
        )
    ]
    manifest_path = restart_root / "restart_manifest.json"
    manifest = {
        "format_version": RESTART_FORMAT_VERSION,
        "restart_id": restart_id,
        "mode": "v2_full_reset",
        "state": "prepared",
        "created_at": _utc_timestamp(),
        "updated_at": _utc_timestamp(),
        "instruction": str(instruction or "")[:4000],
        "instruction_sha256": _sha256_bytes(str(instruction or "").encode("utf-8")),
        "launch_boundary": str(boundary.get("boundary_path") or LAUNCH_BOUNDARY),
        "launch_project_sha256": boundary["project_sha256"],
        "launch_framing_sha256": boundary["framing_prefix_sha256"],
        "launch_instruction": str(boundary.get("launch_instruction") or ""),
        "launch_instruction_sha256": _sha256_bytes(
            str(boundary.get("launch_instruction") or "").encode("utf-8")
        ),
        "launch_resources": boundary["resources"],
        "retained_resources": retained_resources,
        "service_runtime_entries": runtime_entries,
        "authoritative_framing_path": "authoritative_framing.json",
        "authoritative_framing_sha256": _sha256_bytes(
            canonical_json_bytes(framing_messages)
        ),
        "framing_generation": framing_generation,
        "archived_entries": old_entries,
        "moved_paths": [],
    }
    _atomic_json(restart_root / "authoritative_framing.json", framing_messages)
    _atomic_json(manifest_path, manifest)
    try:
        _copy_external_runtime(
            runtime,
            restart_root / "pre_restart_service_runtime",
            runtime_entries,
        )
        if fault_at == "after_runtime_snapshot":
            raise RuntimeError("Injected restart interruption after runtime snapshot")
        moved: list[str] = []
        for relative in MOVED_PATHS:
            if _move_to_snapshot(root, restart_root, relative):
                moved.append(relative)
                _set_manifest_state(manifest_path, "prepared", moved_paths=moved)
            if fault_at == f"after_move:{relative}":
                raise RuntimeError(f"Injected restart interruption after {relative}")
        _copy_clean_scaffold(template, "research_trajectory", root / "research_trajectory")
        for example in (root / "research_trajectory").rglob("*.example.json"):
            example.unlink()
        for relative in (
            "research_trajectory/STATE.json",
            "research_trajectory/CURRENT_FINDINGS.json",
            "research_trajectory/HUMAN_TASKS.json",
            "research_trajectory/CANONICAL_REVISION.json",
        ):
            (root / relative).unlink(missing_ok=True)
        for relative in (
            "research_trajectory/trials",
            "research_trajectory/.staging",
            "research_trajectory/.transactions",
            "research_trajectory/lines",
            "research_trajectory/campaigns",
        ):
            (root / relative).mkdir(parents=True, exist_ok=True)
        for relative in (
            "research_trajectory/trials",
            "research_trajectory/.staging",
        ):
            directory = root / relative
            for child in directory.iterdir():
                if child.name != ".gitkeep":
                    _remove(child)
            (directory / ".gitkeep").touch(exist_ok=True)
        _copy_clean_scaffold(template, "manuscript", root / "manuscript")
        _copy_clean_scaffold(template, "workspace", root / "workspace")
        _copy_clean_scaffold(template, "resources", root / "resources")
        _restore_retained_resources(root, restart_root, retained_resources)
        _atomic_bytes(root / "PROJECT.md", boundary["project_bytes"])
        _write_resource_manifest(
            root / "resources/user_input/RESOURCE_MANIFEST.md", retained_resources
        )
        target_venue = dict(boundary["target_venue"])
        target_venue["project_id"] = project_id
        target_venue["last_published_revision"] = 0
        _atomic_json(
            root / "resources/target_venue/TARGET_VENUE.json", target_venue
        )
        _atomic_bytes(
            root / "resources/target_venue/TARGET_VENUE.md",
            _target_venue_markdown(target_venue),
        )
        artifacts = build_fresh_v2_artifacts(
            project_id=project_id,
            project_text=boundary["project_bytes"].decode("utf-8"),
            source=f"restart:{restart_id}",
        )
        for relative, value in artifacts.items():
            _atomic_bytes(root / relative, canonical_json_bytes(value))
        for relative, content in _fresh_markdown_payloads(artifacts).items():
            _atomic_bytes(root / relative, content)
        if fault_at == "after_rebuild":
            raise RuntimeError("Injected restart interruption after rebuild")
        verified = classify_project(root)
        trials = root / "research_trajectory/trials"
        staging = root / "research_trajectory/.staging"
        invariant_errors: list[str] = []
        if verified.get("classification") != "v2":
            invariant_errors.extend(str(item) for item in verified.get("errors", []))
        if int(
            verified.get("canonical_revision")
            if verified.get("canonical_revision") is not None
            else -1
        ) != 0:
            invariant_errors.append("canonical revision is not zero")
        if any(item.name != ".gitkeep" for item in trials.iterdir()):
            invariant_errors.append("active trials are not empty")
        if any(item.name != ".gitkeep" for item in staging.iterdir()):
            invariant_errors.append("active staging is not empty")
        if _sha256_file(root / "PROJECT.md") != boundary["project_sha256"]:
            invariant_errors.append("PROJECT.md does not match the launch boundary")
        if _stable_prefix_hash(boundary["messages"]) != boundary["framing_prefix_sha256"]:
            invariant_errors.append("chat prefix does not match the launch boundary")
        for relative, value in artifacts.items():
            if relative not in {
                "research_trajectory/STATE.json",
                "research_trajectory/CURRENT_FINDINGS.json",
                "research_trajectory/HUMAN_TASKS.json",
            }:
                continue
            markdown = (root / (relative[:-5] + ".md")).read_text(encoding="utf-8")
            invariant_errors.extend(
                f"{relative}: {error}"
                for error in paired_markdown_errors(value, markdown)
            )
        invariant_errors.extend(
            f"resources/target_venue/TARGET_VENUE.json: {error}"
            for error in paired_markdown_errors(
                target_venue,
                (root / "resources/target_venue/TARGET_VENUE.md").read_text(
                    encoding="utf-8"
                ),
            )
        )
        if invariant_errors:
            raise RestartRecoveryRequired(
                "The rebuilt project failed the revision-zero/Trial-1 launch invariants: "
                + "; ".join(invariant_errors[:12])
            )
        _verify_archived_entries(restart_root, old_entries)
        _set_manifest_state(
            manifest_path,
            "committed",
            committed_at=_utc_timestamp(),
            active_revision=0,
            next_trial_id="000001_restart",
            authoritative_framing_sha256=_sha256_bytes(canonical_json_bytes(framing_messages)),
        )
        marker = {
            "format_version": 1,
            "restart_id": restart_id,
            "mode": "v2_full_reset",
            "manifest_path": manifest_path.relative_to(root).as_posix(),
            "manifest_sha256": _sha256_file(manifest_path),
            "activated_at": _utc_timestamp(),
        }
        _atomic_json(root / ACTIVE_FULL_RESET, marker)
        return {
            "mode": "v2_full_reset",
            "restart_id": restart_id,
            "restart_manifest": manifest_path.relative_to(root).as_posix(),
            "canonical_revision": 0,
            "next_trial_id": "000001_restart",
            "framing_messages": framing_messages,
            "framing_generation": framing_generation,
            "launch_boundary": str(boundary.get("boundary_path") or LAUNCH_BOUNDARY),
            "launch_instruction": str(boundary.get("launch_instruction") or ""),
            "archived_file_count": sum(1 for item in old_entries if item.get("kind") == "file"),
        }
    except Exception:
        try:
            _rollback_prepared(root, manifest_path)
        except Exception as rollback_exc:
            raise RestartRecoveryRequired(
                f"Restart failed and rollback also failed; recovery is required: {rollback_exc}"
            ) from rollback_exc
        raise


__all__ = [
    "ACTIVE_FULL_RESET",
    "LAUNCH_BOUNDARY",
    "RestartRecoveryRequired",
    "RestartRefusedError",
    "active_full_reset",
    "ensure_launch_boundary",
    "launch_prefix",
    "perform_full_restart",
    "reconcile_active_restart_revision_zero",
    "recover_prepared_full_restarts",
]
