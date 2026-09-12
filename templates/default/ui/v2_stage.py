"""Service-owned v2 staging, stage hashing, and review closure.

The helpers in this module only inspect bytes and return data.  They never write
the service-only staged manifest or publish a canonical file.
"""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import re
import secrets
from typing import Any, Iterable, Mapping

try:
    from .v2_artifacts import ARTIFACT_REGISTRY, validate_artifact
    from .v2_contracts import (
        SCHEMA_VERSION,
        canonical_json_bytes,
        normalize_relative_path,
        utc_z_timestamp,
    )
    from .v2_paths import PathRegistry, resolve_project_path
except ImportError:  # Direct execution from the template UI directory.
    from v2_artifacts import ARTIFACT_REGISTRY, validate_artifact  # type: ignore
    from v2_contracts import (  # type: ignore
        SCHEMA_VERSION,
        canonical_json_bytes,
        normalize_relative_path,
        utc_z_timestamp,
    )
    from v2_paths import PathRegistry, resolve_project_path  # type: ignore


HASH_SPEC_VERSION = "1"
HASH_ALGORITHM = "sha256"
STAGE_MANIFEST_WRITER = "service_staging_controller"

_MANDATORY_TRIAL_FILES = (
    ("TRIAL.json", "trial_artifact", "trial"),
    ("PLAN.json", "plan", "plan"),
    ("EXPERT_ROUTE.json", "expert_route", "expert_route"),
    ("REPORT.json", "report", "report"),
    ("RESULT_CARDS.json", "result_cards", "result_cards"),
    ("MERGE_REQUEST.json", "merge_request", "merge_request"),
)
_MANDATORY_STAGE_FILES = (
    ("HUMAN_BRIEF.json", "human_brief", "human_brief"),
    ("GATE_EVIDENCE.json", "gate_evidence", "gate_evidence"),
)
_MATERIAL_ROLES = {
    "candidate_canonical",
    "merge_request",
    "human_brief",
    "gate_evidence",
    "plan",
    "expert_route",
    "report",
    "result_cards",
    "trial_artifact",
    "resource",
    "manuscript",
    "other_review_input",
}
_TRIAL_SERVICE_OUTPUTS = {
    "MERGE_DECISION.json",
    "MERGE_DECISION.md",
    "GOAL_GATE.json",
    "GOAL_GATE.md",
    "PUBLISH_RECEIPT.json",
    "PUBLISH_RECEIPT.md",
}


def _ephemeral_material_path(path: str) -> bool:
    """Return whether a project file is interpreter cache, not review material."""

    normalized = normalize_relative_path(path)
    parts = Path(normalized).parts
    return "__pycache__" in parts or Path(normalized).suffix in {".pyc", ".pyo"}


class StageError(ValueError):
    """A staged bundle is incomplete, inconsistent, or unsafe."""


def new_stage_id(trial_id: str, token: str | None = None) -> str:
    """Allocate the service stage ID used to scaffold a new immutable attempt."""

    trial = normalize_relative_path(trial_id)
    number = trial.partition("_")[0]
    suffix = token or secrets.token_hex(4)
    if (
        re.fullmatch(r"[0-9]{6}", number) is None
        or re.fullmatch(r"[a-f0-9]{8}", suffix) is None
    ):
        raise StageError(
            "stage IDs require a six-digit trial number and eight lowercase hex digits"
        )
    return f"STAGE-{number}-{suffix}"


def _bytes(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, str):
        return value.encode("utf-8")
    if isinstance(value, (Mapping, list, tuple, int, float, bool)) or value is None:
        return canonical_json_bytes(value)
    raise TypeError(
        f"stage file value must be bytes, text, or JSON data, got {type(value).__name__}"
    )


def _file_map(values: Mapping[str, Any]) -> dict[str, bytes]:
    result: dict[str, bytes] = {}
    for raw_path, value in values.items():
        path = normalize_relative_path(str(raw_path))
        if path in result:
            raise StageError(f"duplicate normalized file path: {path}")
        result[path] = _bytes(value)
    return result


def _json_file(files: Mapping[str, bytes], path: str) -> dict[str, Any]:
    try:
        value = json.loads(files[path].decode("utf-8"))
    except KeyError as exc:
        raise StageError(f"missing material input: {path}") from exc
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise StageError(f"invalid JSON material input {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise StageError(f"JSON material input must be an object: {path}")
    return value


def stage_root(trial_id: str, stage_id: str) -> str:
    trial = normalize_relative_path(trial_id)
    stage = normalize_relative_path(stage_id)
    if "/" in trial or "/" in stage:
        raise StageError("trial_id and stage_id must each be one path segment")
    return f"research_trajectory/.staging/{trial}/{stage}"


def stage_manifest_path(trial_id: str, stage_id: str) -> str:
    return f"{stage_root(trial_id, stage_id)}/STAGED_UPDATE_MANIFEST.json"


def candidate_root(trial_id: str, stage_id: str) -> str:
    return f"{stage_root(trial_id, stage_id)}/candidate"


def mandatory_material_roles(trial_id: str, stage_id: str) -> dict[str, str]:
    """Return the service-defined minimum material set for one stage."""

    trial_root = f"research_trajectory/trials/{normalize_relative_path(trial_id)}"
    root = stage_root(trial_id, stage_id)
    result = {
        f"{trial_root}/{name}": role
        for name, role, _artifact_type in _MANDATORY_TRIAL_FILES
    }
    result.update(
        {
            f"{root}/{name}": role
            for name, role, _artifact_type in _MANDATORY_STAGE_FILES
        }
    )
    return result


def canonical_target_allowed(path: str, trial_id: str) -> bool:
    """Return whether the transaction protocol permits this canonical target."""

    path = normalize_relative_path(path)
    exact = {
        "PROJECT.md",
        "research_trajectory/STATE.json",
        "research_trajectory/STATE.md",
        "research_trajectory/CURRENT_FINDINGS.json",
        "research_trajectory/CURRENT_FINDINGS.md",
        "research_trajectory/HUMAN_TASKS.json",
        "research_trajectory/HUMAN_TASKS.md",
        "research_trajectory/TRAJECTORY.json",
        "resources/target_venue/TARGET_VENUE.json",
        "resources/target_venue/TARGET_VENUE.md",
        "resources/target_venue/VENUE_PROFILE.json",
        "resources/target_venue/VENUE_PROFILE.md",
        "manuscript/BLUEPRINT.md",
        "manuscript/PAPER_PLAN.md",
    }
    prefixes = (
        "research_trajectory/lines/",
        "research_trajectory/campaigns/",
        "manuscript/reviews/",
        f"research_trajectory/trials/{trial_id}/HUMAN_BRIEF.",
        f"research_trajectory/trials/{trial_id}/GATE_EVIDENCE.",
    )
    return path in exact or any(path.startswith(prefix) for prefix in prefixes)


def _normalize_hash_records(manifest: Mapping[str, Any]) -> dict[str, Any]:
    """Return the INT-006 preimage: the sorted manifest without its own hash."""

    preimage = deepcopy(dict(manifest))
    preimage.pop("stage_content_hash", None)
    operations = list(preimage.get("operations", ()))
    material = list(preimage.get("material_inputs", ()))
    for operation in operations:
        operation["path"] = normalize_relative_path(operation["path"])
        operation["candidate_path"] = normalize_relative_path(
            operation["candidate_path"]
        )
    for item in material:
        item["path"] = normalize_relative_path(item["path"])
    operations.sort(key=lambda item: (item["path"], item["candidate_path"]))
    material.sort(key=lambda item: item["path"])
    operation_paths = [item["path"] for item in operations]
    material_paths = [item["path"] for item in material]
    if len(operation_paths) != len(set(operation_paths)):
        raise StageError("stage operations contain duplicate target paths")
    if len(material_paths) != len(set(material_paths)):
        raise StageError("stage material inputs contain duplicate paths")
    preimage["operations"] = operations
    preimage["material_inputs"] = material
    return preimage


def stage_hash_preimage(manifest: Mapping[str, Any]) -> bytes:
    """Return canonical UTF-8 bytes for hash-spec v1."""

    if manifest.get("hash_spec_version") != HASH_SPEC_VERSION:
        raise StageError("unsupported stage hash specification")
    if manifest.get("hash_algorithm") != HASH_ALGORITHM:
        raise StageError("unsupported stage hash algorithm")
    return canonical_json_bytes(_normalize_hash_records(manifest))


def compute_stage_content_hash(manifest: Mapping[str, Any]) -> str:
    return sha256(stage_hash_preimage(manifest)).hexdigest()


def stage_manifest_errors(manifest: Mapping[str, Any]) -> list[str]:
    """Validate schema, canonical record ordering, and the recorded content hash."""

    errors = validate_artifact(dict(manifest), expected_type="staged_update_manifest")
    try:
        normalized = _normalize_hash_records(manifest)
        if list(manifest.get("operations", ())) != normalized["operations"]:
            errors.append("stage operations are not in canonical path order")
        if list(manifest.get("material_inputs", ())) != normalized["material_inputs"]:
            errors.append("stage material inputs are not in canonical path order")
        expected = compute_stage_content_hash(manifest)
        if manifest.get("stage_content_hash") != expected:
            errors.append("stage_content_hash does not match hash-spec v1 preimage")
    except (KeyError, TypeError, ValueError) as exc:
        errors.append(str(exc))
    return errors


def _material_role(path: str, trial_root: str) -> str:
    if path.startswith("resources/"):
        return "resource"
    if path.startswith("manuscript/"):
        return "manuscript"
    if path.startswith(trial_root + "/"):
        return "trial_artifact"
    return "other_review_input"


def _evidence_references(
    artifacts: Mapping[str, Mapping[str, Any]]
) -> list[tuple[str, str | None]]:
    """Collect local byte inputs; external URLs stay bound inside their JSON records."""
    references: list[tuple[str, str | None]] = []
    report = artifacts.get("report", {})
    references.extend(
        (str(item.get("path", "")), item.get("sha256"))
        for item in report.get("artifacts", ())
        if isinstance(item, Mapping)
    )
    cards = artifacts.get("result_cards", {})
    for card in cards.get("cards", ()):
        if isinstance(card, Mapping):
            references.extend(
                (str(item.get("path", "")), item.get("sha256"))
                for item in card.get("evidence", ())
                if isinstance(item, Mapping) and item.get("source_kind") != "external_url"
            )
    brief = artifacts.get("human_brief", {})
    references.extend(
        (str(item.get("path", "")), item.get("sha256"))
        for item in brief.get("evidence", ())
        if isinstance(item, Mapping) and item.get("source_kind") != "external_url"
    )
    venue_profile = artifacts.get("expert_route", {}).get("venue_profile")
    if venue_profile:
        references.append((str(venue_profile), None))
    return references


def _validate_bundle_artifacts(
    artifacts: Mapping[str, Mapping[str, Any]], paths: Mapping[str, str]
) -> None:
    for artifact_type, value in artifacts.items():
        errors = validate_artifact(
            dict(value), expected_type=artifact_type, path=paths[artifact_type]
        )
        if errors:
            raise StageError(f"invalid {artifact_type}: {'; '.join(errors)}")


def _project_base_revision(root: Path, project_id: str) -> int:
    relative = "research_trajectory/CANONICAL_REVISION.json"
    path = resolve_project_path(root, relative)
    if not path.exists():
        return 0
    value = _json_file({relative: path.read_bytes()}, relative)
    errors = validate_artifact(value, expected_type="canonical_revision", path=relative)
    if errors:
        raise StageError("invalid canonical revision: " + "; ".join(errors))
    if value.get("project_id") != project_id:
        raise StageError("canonical revision belongs to another project")
    return int(value["revision"])


def build_stage_manifest(
    *,
    project_id: str,
    trial_id: str,
    stage_id: str,
    base_revision: int,
    files: Mapping[str, Any],
    base_files: Mapping[str, Any] | None = None,
    additional_material_roles: Mapping[str, str] | None = None,
    created_at: str | None = None,
    updated_at: str | None = None,
    validate_artifacts: bool = True,
) -> dict[str, Any]:
    """Derive a complete service-owned manifest from the supplied byte view.

    Candidate operations are *not* accepted from the caller.  Every file below
    ``.../<stage_id>/candidate/`` becomes exactly one create/replace operation,
    and the service computes all before/after hashes from actual bytes.
    """

    if (
        not isinstance(base_revision, int)
        or isinstance(base_revision, bool)
        or base_revision < 0
    ):
        raise StageError("base_revision must be a non-negative integer")
    if not stage_id.startswith(f"STAGE-{trial_id[:6]}-"):
        raise StageError("stage_id does not belong to the trial number")
    material_files = {
        path: value
        for path, value in _file_map(files).items()
        if not _ephemeral_material_path(path)
    }
    canonical_files = _file_map(base_files or {})
    trial_root = f"research_trajectory/trials/{normalize_relative_path(trial_id)}"
    root = stage_root(trial_id, stage_id)
    manifest_path = stage_manifest_path(trial_id, stage_id)
    registry = PathRegistry.for_run(trial_id, stage_id)
    if not registry.is_service_only(manifest_path):
        raise StageError("staged update manifest path is not service-only")
    if manifest_path in material_files:
        raise StageError("an agent-supplied staged update manifest is forbidden")

    artifact_paths: dict[str, str] = {}
    artifacts: dict[str, dict[str, Any]] = {}
    for name, _role, artifact_type in _MANDATORY_TRIAL_FILES:
        path = f"{trial_root}/{name}"
        artifact_paths[artifact_type] = path
        artifacts[artifact_type] = _json_file(material_files, path)
    for name, _role, artifact_type in _MANDATORY_STAGE_FILES:
        path = f"{root}/{name}"
        artifact_paths[artifact_type] = path
        artifacts[artifact_type] = _json_file(material_files, path)

    if validate_artifacts:
        _validate_bundle_artifacts(artifacts, artifact_paths)
    for artifact_type, value in artifacts.items():
        if value.get("project_id") != project_id:
            raise StageError(f"{artifact_type} project_id does not match the stage")
        if value.get("trial_id") != trial_id:
            raise StageError(f"{artifact_type} trial_id does not match the stage")

    request = artifacts["merge_request"]
    trial = artifacts["trial"]
    if trial.get("base_revision") != base_revision:
        raise StageError("Trial base_revision is stale")
    if trial.get("stage_id") not in {None, stage_id}:
        raise StageError("Trial stage_id points to a different stage")
    expected_manifest_path = stage_manifest_path(trial_id, stage_id)
    if request.get("base_revision") != base_revision:
        raise StageError("Merge Request base_revision is stale")
    if request.get("stage_id") != stage_id:
        raise StageError("Merge Request stage_id does not match")
    if request.get("staged_update_manifest_path") != expected_manifest_path:
        raise StageError("Merge Request points to a different staged manifest")

    roles = mandatory_material_roles(trial_id, stage_id)
    candidate_prefix = candidate_root(trial_id, stage_id) + "/"
    candidate_paths = sorted(
        path for path in material_files if path.startswith(candidate_prefix)
    )
    if not candidate_paths:
        raise StageError("stage candidate directory contains no canonical files")

    operations: list[dict[str, Any]] = []
    for candidate_path in candidate_paths:
        target = normalize_relative_path(candidate_path[len(candidate_prefix) :])
        if not canonical_target_allowed(target, trial_id):
            raise StageError(
                f"candidate target is not publishable canonical state: {target}"
            )
        after = material_files[candidate_path]
        before = canonical_files.get(target)
        operations.append(
            {
                "path": target,
                "operation": "replace" if before is not None else "create",
                "before_sha256": (
                    sha256(before).hexdigest() if before is not None else None
                ),
                "after_sha256": sha256(after).hexdigest(),
                "candidate_path": candidate_path,
                "extensions": {},
            }
        )
        roles[candidate_path] = "candidate_canonical"
        if validate_artifacts and target.endswith(".json"):
            value = _json_file(material_files, candidate_path)
            artifact_type = value.get("artifact_type")
            if artifact_type in ARTIFACT_REGISTRY:
                errors = validate_artifact(value, path=target)
                if errors:
                    raise StageError(f"invalid candidate {target}: {'; '.join(errors)}")

    # Every non-service trial/stage file present in the byte view is review material.
    for path in material_files:
        relative_trial = (
            path[len(trial_root) + 1 :] if path.startswith(trial_root + "/") else ""
        )
        if relative_trial:
            if (
                relative_trial.startswith("reviews/")
                or relative_trial in _TRIAL_SERVICE_OUTPUTS
            ):
                continue
            roles.setdefault(path, "trial_artifact")
        elif path.startswith(root + "/") and path != manifest_path:
            roles.setdefault(path, "other_review_input")

    for raw_path, role in (additional_material_roles or {}).items():
        path = normalize_relative_path(str(raw_path))
        if role not in _MATERIAL_ROLES:
            raise StageError(f"unknown material role {role!r} for {path}")
        if path not in material_files:
            raise StageError(f"missing additional material input: {path}")
        if path in roles and roles[path] != role:
            raise StageError(
                f"material role for {path} is service-defined as {roles[path]!r}"
            )
        roles[path] = role

    for raw_path, declared_hash in _evidence_references(artifacts):
        path = normalize_relative_path(raw_path)
        if path not in material_files:
            raise StageError(f"referenced review evidence is omitted: {path}")
        actual_hash = sha256(material_files[path]).hexdigest()
        if declared_hash is not None and declared_hash != actual_hash:
            raise StageError(f"referenced evidence hash mismatch: {path}")
        roles.setdefault(path, _material_role(path, trial_root))

    missing = sorted(path for path in roles if path not in material_files)
    if missing:
        raise StageError(f"mandatory material inputs are missing: {missing}")
    material_inputs = [
        {
            "path": path,
            "role": roles[path],
            "sha256": sha256(material_files[path]).hexdigest(),
            "extensions": {},
        }
        for path in sorted(roles)
    ]
    operations.sort(key=lambda item: (item["path"], item["candidate_path"]))

    timestamp = created_at or utc_z_timestamp()
    manifest: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "artifact_type": "staged_update_manifest",
        "project_id": project_id,
        "created_at": timestamp,
        "updated_at": updated_at or timestamp,
        "extensions": {},
        "trial_id": trial_id,
        "stage_id": stage_id,
        "base_revision": base_revision,
        "operations": operations,
        "hash_spec_version": HASH_SPEC_VERSION,
        "hash_algorithm": HASH_ALGORITHM,
        "material_inputs": material_inputs,
    }
    manifest["stage_content_hash"] = compute_stage_content_hash(manifest)
    errors = stage_manifest_errors(manifest)
    if errors:
        raise StageError("generated stage manifest is invalid: " + "; ".join(errors))
    return manifest


def build_stage_manifest_from_project(
    project_root: str | Path,
    *,
    project_id: str,
    trial_id: str,
    stage_id: str,
    base_revision: int,
    additional_material_roles: Mapping[str, str] | None = None,
    existing_manifest: Mapping[str, Any] | None = None,
    created_at: str | None = None,
    updated_at: str | None = None,
) -> dict[str, Any]:
    """Read a project safely and derive a manifest without writing it."""

    root = Path(project_root).resolve(strict=True)
    actual_revision = _project_base_revision(root, project_id)
    if base_revision != actual_revision:
        raise StageError(
            f"stage base_revision {base_revision} is stale; current revision is {actual_revision}"
        )
    wanted_roots = (
        f"research_trajectory/trials/{trial_id}",
        stage_root(trial_id, stage_id),
    )
    files: dict[str, bytes] = {}
    for relative_root in wanted_roots:
        directory = resolve_project_path(root, relative_root, must_exist=True)
        if not directory.is_dir():
            raise StageError(f"stage source is not a directory: {relative_root}")
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                relative = path.relative_to(root).as_posix()
                if _ephemeral_material_path(relative):
                    continue
                files[relative] = resolve_project_path(
                    root, relative, must_exist=True
                ).read_bytes()

    manifest_path = stage_manifest_path(trial_id, stage_id)
    if existing_manifest is None and manifest_path in files:
        raise StageError(
            "an existing staged manifest requires explicit service verification"
        )
    if existing_manifest is not None:
        if manifest_path not in files:
            raise StageError("the service-owned staged manifest is missing")
        try:
            on_disk_manifest = json.loads(files.pop(manifest_path).decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise StageError(
                f"the service-owned staged manifest is invalid JSON: {exc}"
            ) from exc
        if on_disk_manifest != dict(existing_manifest):
            raise StageError(
                "the service-owned staged manifest differs from the expected manifest"
            )

    # Pull explicitly requested external review inputs into the byte view.
    for relative in additional_material_roles or {}:
        normalized = normalize_relative_path(str(relative))
        files[normalized] = resolve_project_path(
            root, normalized, must_exist=True
        ).read_bytes()

    # Evidence references are service-discovered, not trusted as a caller list.
    artifacts: dict[str, dict[str, Any]] = {}
    for path, role in mandatory_material_roles(trial_id, stage_id).items():
        if role in {
            "plan",
            "expert_route",
            "report",
            "result_cards",
            "merge_request",
            "human_brief",
            "gate_evidence",
        }:
            artifacts[role] = _json_file(files, path)
    for reference, _declared in _evidence_references(artifacts):
        normalized = normalize_relative_path(reference)
        files[normalized] = resolve_project_path(
            root, normalized, must_exist=True
        ).read_bytes()

    base_files: dict[str, bytes] = {}
    prefix = candidate_root(trial_id, stage_id) + "/"
    for candidate_path in (path for path in files if path.startswith(prefix)):
        target = normalize_relative_path(candidate_path[len(prefix) :])
        target_path = resolve_project_path(root, target)
        if target_path.is_file():
            base_files[target] = target_path.read_bytes()

    return build_stage_manifest(
        project_id=project_id,
        trial_id=trial_id,
        stage_id=stage_id,
        base_revision=base_revision,
        files=files,
        base_files=base_files,
        additional_material_roles=additional_material_roles,
        created_at=created_at,
        updated_at=updated_at,
    )


def stage_from_project(project_root: str | Path, **kwargs: Any) -> dict[str, Any]:
    """Server-facing alias for the read-only project staging entry point."""

    return build_stage_manifest_from_project(project_root, **kwargs)


def verify_stage_from_project(
    project_root: str | Path,
    manifest: Mapping[str, Any],
    *,
    additional_material_roles: Mapping[str, str] | None = None,
) -> list[str]:
    """Re-enumerate a written service stage and report any material drift."""

    errors = stage_manifest_errors(manifest)
    if errors:
        return errors
    try:
        rebuilt = build_stage_manifest_from_project(
            project_root,
            project_id=str(manifest["project_id"]),
            trial_id=str(manifest["trial_id"]),
            stage_id=str(manifest["stage_id"]),
            base_revision=int(manifest["base_revision"]),
            additional_material_roles=additional_material_roles,
            existing_manifest=manifest,
            created_at=str(manifest["created_at"]),
            updated_at=str(manifest["updated_at"]),
        )
    except (KeyError, TypeError, ValueError, OSError) as exc:
        return [str(exc)]
    if rebuilt != dict(manifest):
        return ["the staged bundle has material drift and must be restaged/reviewed"]
    return []


def review_is_current(
    review: Mapping[str, Any], stage_manifest: Mapping[str, Any]
) -> bool:
    """Plan is pre-execution; every other review must bind to the exact stage."""

    if review.get("trial_id") != stage_manifest.get("trial_id"):
        return False
    if review.get("reviewer") == "plan":
        return (
            review.get("phase") == "pre_execution"
            and review.get("stage_id") is None
            and review.get("stage_manifest_hash") is None
        )
    return (
        review.get("phase") in {"post_stage", "final"}
        and review.get("stage_id") == stage_manifest.get("stage_id")
        and review.get("stage_manifest_hash")
        == stage_manifest.get("stage_content_hash")
    )


def stale_reviewers(
    reviews: Iterable[Mapping[str, Any]], stage_manifest: Mapping[str, Any]
) -> list[str]:
    return sorted(
        str(review.get("reviewer"))
        for review in reviews
        if not review_is_current(review, stage_manifest)
    )


def _review_list(
    reviews: Iterable[Mapping[str, Any]] | Mapping[str, Mapping[str, Any]]
) -> list[Mapping[str, Any]]:
    return list(reviews.values()) if isinstance(reviews, Mapping) else list(reviews)


def evaluate_review_closure(
    review_manifest: Mapping[str, Any],
    reviews: Iterable[Mapping[str, Any]] | Mapping[str, Mapping[str, Any]],
    stage_manifest: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Evaluate exact reviewer completeness and the strict-pass closure rule."""

    outputs = _review_list(reviews)
    specialized = {
        value if str(value).startswith("specialized:") else f"specialized:{value}"
        for value in (
            item.get("id") for item in review_manifest.get("specialized_reviewers", ())
        )
    }
    expected = set(review_manifest.get("required_reviewers", ())) | specialized
    by_reviewer: dict[str, Mapping[str, Any]] = {}
    duplicate: set[str] = set()
    for output in outputs:
        reviewer = str(output.get("reviewer"))
        if reviewer in by_reviewer:
            duplicate.add(reviewer)
        by_reviewer[reviewer] = output

    missing = sorted(expected - set(by_reviewer))
    unexpected = sorted(set(by_reviewer) - expected)
    stale: list[str] = []
    failed: list[str] = []
    material_failed: list[str] = []
    invalid_pass: list[str] = []
    errors: list[str] = []
    if missing:
        errors.append(f"missing required reviewer outputs: {missing}")
    if unexpected:
        errors.append(f"unexpected reviewer outputs: {unexpected}")
    if duplicate:
        errors.append(f"duplicate reviewer outputs: {sorted(duplicate)}")

    expected_stage = {
        "trial_id": review_manifest.get("trial_id"),
        "stage_id": review_manifest.get("stage_id"),
        "stage_content_hash": review_manifest.get("stage_manifest_hash"),
    }
    if stage_manifest is not None:
        for field in ("trial_id", "stage_id"):
            if stage_manifest.get(field) != expected_stage[field]:
                errors.append(f"review manifest {field} differs from staged update")
        if (
            stage_manifest.get("stage_content_hash")
            != expected_stage["stage_content_hash"]
        ):
            errors.append("review manifest references a stale staged update hash")

    for reviewer in sorted(expected & set(by_reviewer)):
        output = by_reviewer[reviewer]
        if output.get("project_id") not in {None, review_manifest.get("project_id")}:
            stale.append(reviewer)
            errors.append(f"reviewer {reviewer} belongs to another project")
            continue
        if not review_is_current(output, expected_stage):
            stale.append(reviewer)
            continue
        if output.get("decision") != "pass":
            failed.append(reviewer)
            material_failed.append(reviewer)
            continue
        unresolved = [
            field
            for field in ("blockers", "required_actions", "unassessed_areas")
            if output.get(field)
        ]
        if unresolved:
            failed.append(reviewer)
            invalid_pass.append(reviewer)
            errors.append(
                f"reviewer {reviewer} cannot pass with non-empty {unresolved}"
            )

    if stale:
        errors.append(f"stale reviewer outputs: {stale}")
    if failed:
        errors.append(f"reviewers without strict pass: {sorted(set(failed))}")
    passed = sorted(expected - set(missing) - set(stale) - set(failed))
    return {
        "closed": not errors,
        "required_reviewers": sorted(expected),
        "passed_reviewers": passed,
        "missing_reviewers": missing,
        "stale_reviewers": stale,
        "failed_reviewers": sorted(set(failed)),
        "material_failed_reviewers": sorted(set(material_failed)),
        "invalid_pass_reviewers": sorted(set(invalid_pass)),
        "unexpected_reviewers": unexpected,
        "errors": errors,
    }
