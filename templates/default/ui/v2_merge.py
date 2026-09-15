"""Pure service MergeEvaluator and in-memory post-merge projection."""

from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
import re
from typing import Any, Iterable, Mapping

try:
    from .v2_artifacts import (
        ARTIFACT_REGISTRY,
        cross_artifact_errors,
        reviewer_card_eligibility_errors,
        validate_artifact,
    )
    from .v2_contracts import (
        SCHEMA_VERSION,
        canonical_json_bytes,
        canonical_json_hash,
        normalize_relative_path,
        utc_z_timestamp,
    )
    from .v2_stage import (
        canonical_target_allowed,
        compute_stage_content_hash,
        evaluate_review_closure,
    )
    from .v2_venue import venue_update_errors
except ImportError:  # Direct execution from the template UI directory.
    from v2_artifacts import (  # type: ignore
        ARTIFACT_REGISTRY,
        cross_artifact_errors,
        reviewer_card_eligibility_errors,
        validate_artifact,
    )
    from v2_contracts import (  # type: ignore
        SCHEMA_VERSION,
        canonical_json_bytes,
        canonical_json_hash,
        normalize_relative_path,
        utc_z_timestamp,
    )
    from v2_stage import (  # type: ignore
        canonical_target_allowed,
        compute_stage_content_hash,
        evaluate_review_closure,
    )
    from v2_venue import venue_update_errors  # type: ignore


_CARD_ID = re.compile(r"^RC-[0-9]{6}-[0-9]{2}$")
_CARD_DECISIONS = {
    "accept",
    "accept_with_qualification",
    "reject",
    "supersede",
    "defer",
    "needs_human",
}
_CARD_REFERENCE_FIELDS = {
    "accepted_card_ids",
    "qualified_card_ids",
    "superseded_card_ids",
    "card_ids",
    "supporting_cards",
    "limiting_cards",
    "conflicting_cards",
    "satisfying_card_ids",
}
_PRESERVED_EVIDENCE_FIELDS = {
    "limiting_cards",
    "conflicting_cards",
    "negative_card_ids",
}


class MergeError(ValueError):
    """The reviewed stage cannot produce a coherent merge."""


def _bytes(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, str):
        return value.encode("utf-8")
    return canonical_json_bytes(value)


def _decode(path: str, value: Any) -> Any:
    if not path.endswith(".json"):
        if isinstance(value, bytes):
            try:
                return value.decode("utf-8")
            except UnicodeError:
                return bytes(value)
        return deepcopy(value)
    if isinstance(value, Mapping):
        return deepcopy(dict(value))
    if isinstance(value, (list, tuple)):
        return deepcopy(list(value))
    try:
        decoded = json.loads(_bytes(value).decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise MergeError(f"invalid candidate JSON {path}: {exc}") from exc
    return decoded


def _candidate_value(
    values: Mapping[str, Any], operation: Mapping[str, Any]
) -> tuple[str, Any]:
    candidate_path = normalize_relative_path(str(operation.get("candidate_path", "")))
    target = normalize_relative_path(str(operation.get("path", "")))
    if candidate_path in values:
        return candidate_path, values[candidate_path]
    if target in values:  # Convenient for already-decoded service projections.
        return target, values[target]
    raise MergeError(f"candidate bytes are missing for {candidate_path}")


def _contains(value: Any, wanted: str) -> bool:
    if isinstance(value, Mapping):
        return any(_contains(child, wanted) for child in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains(child, wanted) for child in value)
    if isinstance(value, str):
        return (
            value == wanted
            or re.search(
                rf"(?<![A-Za-z0-9_-]){re.escape(wanted)}(?![A-Za-z0-9_-])", value
            )
            is not None
        )
    return False


def _all_card_ids(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, Mapping):
        for child in value.values():
            found.update(_all_card_ids(child))
    elif isinstance(value, (list, tuple)):
        for child in value:
            found.update(_all_card_ids(child))
    elif isinstance(value, str):
        found.update(re.findall(r"RC-[0-9]{6}-[0-9]{2}", value))
    return found


def _field_card_ids(value: Any, fields: set[str]) -> set[str]:
    found: set[str] = set()
    if isinstance(value, Mapping):
        for key, child in value.items():
            if key in fields:
                found.update(_all_card_ids(child))
            else:
                found.update(_field_card_ids(child, fields))
    elif isinstance(value, (list, tuple)):
        for child in value:
            found.update(_field_card_ids(child, fields))
    return found


def _result_card_list(
    result_cards: Mapping[str, Any] | Iterable[Mapping[str, Any]]
) -> list[Mapping[str, Any]]:
    if isinstance(result_cards, Mapping):
        return list(result_cards.get("cards", ()))
    return list(result_cards)


def _safe_blocker_target(path: str, trial_id: str) -> bool:
    exact = {
        "research_trajectory/STATE.json",
        "research_trajectory/STATE.md",
        "research_trajectory/CURRENT_FINDINGS.json",
        "research_trajectory/CURRENT_FINDINGS.md",
        f"research_trajectory/trials/{trial_id}/HUMAN_BRIEF.json",
        f"research_trajectory/trials/{trial_id}/HUMAN_BRIEF.md",
        f"research_trajectory/trials/{trial_id}/GATE_EVIDENCE.json",
        f"research_trajectory/trials/{trial_id}/GATE_EVIDENCE.md",
    }
    return path in exact


def _describes_blocker(path: str, value: Any) -> bool:
    if path.endswith(".md"):
        return True  # Its paired JSON operation is checked separately below.
    decoded = _decode(path, value)
    if not isinstance(decoded, Mapping):
        return False
    artifact_type = decoded.get("artifact_type")
    if artifact_type == "project_state":
        return any(
            item.get("status") in {"blocked_human", "blocked_operational"}
            for item in decoded.get("critical_path", ())
            if isinstance(item, Mapping)
        )
    if artifact_type == "human_brief":
        return decoded.get("trial_outcome") in {"blocked", "needs_human"}
    if artifact_type == "gate_evidence":
        return bool(decoded.get("human_blocker") or decoded.get("operational_blocker"))
    return False


def _safe_blocker_change(
    path: str,
    raw: Any,
    base_projection: Mapping[str, Any],
    trial_id: str,
) -> bool:
    if not _safe_blocker_target(path, trial_id):
        return False
    if path == "research_trajectory/CURRENT_FINDINGS.md":
        return True  # Its safe paired JSON operation is checked below.
    if path == "research_trajectory/CURRENT_FINDINGS.json":
        if path not in base_projection:
            return False
        before = _decode(path, base_projection[path])
        after = _decode(path, raw)
        if not isinstance(before, Mapping) or not isinstance(after, Mapping):
            return False
        mutable = {"updated_at", "canonical_revision"}
        unchanged = all(
            before.get(key) == after.get(key)
            for key in (set(before) | set(after)) - mutable
        )
        before_revision = before.get("canonical_revision")
        return (
            unchanged
            and isinstance(before_revision, int)
            and not isinstance(before_revision, bool)
            and after.get("canonical_revision") == before_revision + 1
        )
    if not _describes_blocker(path, raw):
        return False
    if path != "research_trajectory/STATE.json":
        return True
    if path not in base_projection:
        return False
    before = _decode(path, base_projection[path])
    after = _decode(path, raw)
    if not isinstance(before, Mapping) or not isinstance(after, Mapping):
        return False
    mutable = {
        "updated_at",
        "canonical_revision",
        "critical_path",
        "goal_gate_path",
        "next_step",
    }
    return all(
        before.get(key) == after.get(key)
        for key in (set(before) | set(after)) - mutable
    )


def _card_destinations(
    card_id: str,
    operations: Iterable[Mapping[str, Any]],
    candidate_files: Mapping[str, Any],
) -> list[str]:
    destinations: list[str] = []
    for operation in operations:
        _source_path, raw = _candidate_value(candidate_files, operation)
        target = normalize_relative_path(str(operation["path"]))
        if _contains(_decode(target, raw), card_id):
            destinations.append(target)
    return sorted(set(destinations))


def _projection_json_values(projection: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [
        value
        for path, value in projection.items()
        if path.endswith(".json") and isinstance(value, Mapping)
    ]


def _decoded_projection(projection: Mapping[str, Any]) -> dict[str, Any]:
    return {
        path: _decode(path, value)
        for path, value in projection.items()
    }


def _canonical_card_status_sets(projection: Mapping[str, Any]) -> dict[str, set[str]]:
    """Return service-canonical card identities by effective findings status.

    Merely mentioning a card ID elsewhere in canonical state (for example in a
    material exclusion) does not make that card accepted evidence.
    """

    decoded = _decoded_projection(projection)
    findings = next(
        (
            value
            for value in _projection_json_values(decoded)
            if value.get("artifact_type") == "current_findings"
        ),
        None,
    )
    if not findings:
        return {"accepted": set(), "qualified": set(), "superseded": set()}
    return {
        "accepted": set(findings.get("accepted_card_ids", ())),
        "qualified": set(findings.get("qualified_card_ids", ())),
        "superseded": set(findings.get("superseded_card_ids", ())),
    }


def _projection_errors(
    before: Mapping[str, Any],
    after: Mapping[str, Any],
    result_cards: Mapping[str, Any] | Iterable[Mapping[str, Any]],
    card_decisions: Iterable[Mapping[str, Any]],
    prior_card_ids: Iterable[str] = (),
) -> list[str]:
    errors: list[str] = []
    before = _decoded_projection(before)
    after = _decoded_projection(after)
    values = _projection_json_values(after)
    for path, value in after.items():
        if not path.endswith(".json") or not isinstance(value, Mapping):
            continue
        artifact_type = value.get("artifact_type")
        if artifact_type in ARTIFACT_REGISTRY:
            errors.extend(
                f"{path}: {error}" for error in validate_artifact(value, path=path)
            )

    result_artifact = (
        result_cards
        if isinstance(result_cards, Mapping) and result_cards.get("artifact_type")
        else None
    )
    bundle = [*values]
    if result_artifact:
        bundle.append(result_artifact)
    errors.extend(cross_artifact_errors(bundle))

    venue_path = "resources/target_venue/TARGET_VENUE.json"
    old_venue = before.get(venue_path)
    new_venue = after.get(venue_path)
    if isinstance(new_venue, Mapping):
        errors.extend(
            venue_update_errors(
                old_venue if isinstance(old_venue, Mapping) else {}, new_venue
            )
        )

    old_evidence = _field_card_ids(before, _PRESERVED_EVIDENCE_FIELDS)
    new_evidence = _field_card_ids(after, _PRESERVED_EVIDENCE_FIELDS)
    if removed := old_evidence - new_evidence:
        errors.append(f"negative/conflicting evidence was removed: {sorted(removed)}")

    old_status = _canonical_card_status_sets(before)
    old_effective = old_status["accepted"] | old_status["qualified"]
    old_history = old_effective | old_status["superseded"]
    accepted_now = {
        str(item["card_id"])
        for item in card_decisions
        if item.get("decision") in {"accept", "accept_with_qualification", "supersede"}
    }
    cards_by_id = {
        str(card.get("id")): card for card in _result_card_list(result_cards)
    }

    superseded = _field_card_ids(after, {"superseded_card_ids"})
    # Receipt-verified deferred cards may be named only as supersession targets;
    # an arbitrary historical mention does not establish a valid identity.
    if unknown := superseded - old_history - set(cards_by_id) - set(prior_card_ids):
        errors.append(
            f"effective projection references unknown superseded cards: {sorted(unknown)}"
        )
    declared_superseded = {
        str(prior_id)
        for card_id in accepted_now
        for prior_id in cards_by_id.get(card_id, {}).get("supersedes", ())
    }
    newly_superseded = superseded - old_status["superseded"]
    if unjustified := newly_superseded - declared_superseded:
        errors.append(
            "effective projection marks cards superseded without an accepted "
            f"superseding card: {sorted(unjustified)}"
        )

    findings = next(
        (value for value in values if value.get("artifact_type") == "current_findings"),
        None,
    )
    old_findings = next(
        (
            value
            for value in _projection_json_values(before)
            if value.get("artifact_type") == "current_findings"
        ),
        None,
    )
    if old_findings and findings:
        old_effective_findings = (
            set(old_findings.get("accepted_card_ids", ()))
            | set(old_findings.get("qualified_card_ids", ()))
        )
        new_effective_findings = (
            set(findings.get("accepted_card_ids", ()))
            | set(findings.get("qualified_card_ids", ()))
        )
        if unauthorized := (new_effective_findings - old_effective_findings) - accepted_now:
            errors.append(
                "canonical findings promote cards without an accepted current decision: "
                f"{sorted(unauthorized)}"
            )
        old_canonical = (
            set(old_findings.get("accepted_card_ids", ()))
            | set(old_findings.get("qualified_card_ids", ()))
            | set(old_findings.get("superseded_card_ids", ()))
        )
        new_canonical = (
            set(findings.get("accepted_card_ids", ()))
            | set(findings.get("qualified_card_ids", ()))
            | set(findings.get("superseded_card_ids", ()))
        )
        if removed := old_canonical - new_canonical:
            errors.append(f"canonical card history was removed: {sorted(removed)}")
    for item in card_decisions:
        card_id = str(item.get("card_id"))
        decision = item.get("decision")
        if decision not in {"accept", "accept_with_qualification", "supersede"}:
            historical_replacement = (
                card_id in declared_superseded
                and card_id in superseded
                and card_id not in referenced
            )
            if card_id in _all_card_ids(after) and not historical_replacement:
                errors.append(
                    f"non-accepted card {card_id} appears in canonical projection"
                )
            continue
        if not findings:
            errors.append(
                f"accepted card {card_id} lacks a CURRENT_FINDINGS destination"
            )
            continue
        accepted = set(findings.get("accepted_card_ids", ()))
        qualified = set(findings.get("qualified_card_ids", ()))
        if decision == "accept" and card_id not in accepted:
            errors.append(f"accepted card {card_id} is not in accepted_card_ids")
        elif decision == "accept_with_qualification" and card_id not in qualified:
            errors.append(f"qualified card {card_id} is not in qualified_card_ids")
        elif decision == "supersede" and card_id not in accepted | qualified:
            errors.append(
                f"superseding card {card_id} is not accepted in CURRENT_FINDINGS"
            )
        if decision == "supersede":
            superseded = set(findings.get("superseded_card_ids", ()))
            missing = (
                set(cards_by_id.get(card_id, {}).get("supersedes", ())) - superseded
            )
            if missing:
                errors.append(
                    f"supersede card {card_id} does not mark prior cards superseded: {sorted(missing)}"
                )

    return errors


def build_effective_projection(
    base_projection: Mapping[str, Any],
    stage_manifest: Mapping[str, Any],
    merge_decision: Mapping[str, Any],
    candidate_files: Mapping[str, Any],
) -> dict[str, Any]:
    """Apply authorized operations to a deep-copied in-memory mapping."""

    if merge_decision.get("overall_status") == "rejected":
        raise MergeError("a rejected Merge Decision has no publishable projection")
    decisions = {
        item.get("path"): item.get("decision")
        for item in merge_decision.get("canonical_update_decisions", ())
    }
    projection = deepcopy(dict(base_projection))
    seen: set[str] = set()
    for operation in stage_manifest.get("operations", ()):
        path = normalize_relative_path(str(operation.get("path", "")))
        if path in seen:
            raise MergeError(f"duplicate stage operation: {path}")
        seen.add(path)
        if decisions.get(path) != "apply":
            continue
        _source_path, raw = _candidate_value(candidate_files, operation)
        before_exists = path in projection
        if operation.get("operation") == "create" and before_exists:
            raise MergeError(f"create target already exists in base projection: {path}")
        if operation.get("operation") == "replace" and not before_exists:
            raise MergeError(f"replace target is absent from base projection: {path}")
        actual_before = (
            canonical_json_bytes(projection[path])
            if before_exists and isinstance(projection[path], (Mapping, list, tuple))
            else _bytes(projection[path]) if before_exists else None
        )
        expected_before = operation.get("before_sha256")
        if (
            canonical_json_hash(projection[path])
            if before_exists and isinstance(projection[path], (Mapping, list, tuple))
            else (
                sha256(actual_before).hexdigest() if actual_before is not None else None
            )
        ) != expected_before:
            raise MergeError(f"before hash mismatch in base projection: {path}")
        actual_after_hash = sha256(_bytes(raw)).hexdigest()
        if actual_after_hash != operation.get("after_sha256"):
            raise MergeError(f"after hash mismatch in candidate projection: {path}")
        projection[path] = _decode(path, raw)
    return _decoded_projection(projection)


def prepare_card_decisions(*, merge_request, result_cards, operations, candidate_files,
                           base_projection, trial_id, project_id, prior_card_ids=()):
    """Check proposal structure before review and again at final merge.

    This does not approve evidence or derive a publishable Merge Decision.
    """
    prior_card_ids = set(prior_card_ids)
    errors: list[str] = []
    cards = _result_card_list(result_cards)
    card_by_id: dict[str, Mapping[str, Any]] = {}
    card_position: dict[str, int] = {}
    duplicate_cards: set[str] = set()
    for position, card in enumerate(cards):
        card_id = str(card.get("id", ""))
        if card_id in card_by_id:
            duplicate_cards.add(card_id)
        else:
            card_position[card_id] = position
        card_by_id[card_id] = card
        if card.get("proposed_status") != "proposed":
            errors.append(f"result card {card_id} self-assigns canonical status")
        if card.get("source_trial_id") != trial_id:
            errors.append(f"result card {card_id} belongs to another trial")
        if card_id in card.get("supersedes", ()):
            errors.append(f"result card {card_id} cannot supersede itself")
    if duplicate_cards:
        errors.append(f"duplicate result cards: {sorted(duplicate_cards)}")
    if isinstance(result_cards, Mapping):
        if result_cards.get("project_id") not in {None, project_id}:
            errors.append("Result Cards project_id differs from the staged update")
        if result_cards.get("trial_id") not in {None, trial_id}:
            errors.append("Result Cards trial_id differs from the staged update")

    requests = list(merge_request.get("requested_card_decisions", ()))
    request_by_id: dict[str, Mapping[str, Any]] = {}
    duplicate_requests: set[str] = set()
    for request in requests:
        card_id = str(request.get("card_id", ""))
        requested_decision = request.get("decision")
        if card_id in request_by_id:
            duplicate_requests.add(card_id)
        else:
            request_by_id[card_id] = request
        if card_id not in card_by_id:
            errors.append(f"Merge Request references unknown card {card_id}")
        if requested_decision not in _CARD_DECISIONS:
            errors.append(f"Merge Request uses an unknown decision for {card_id}")
        if (
            requested_decision == "accept_with_qualification"
            and not str(request.get("qualification", "")).strip()
        ):
            errors.append(
                f"qualified acceptance for {card_id} lacks a qualification"
            )
    if duplicate_requests:
        errors.append(
            f"Merge Request repeats card decisions: {sorted(duplicate_requests)}"
        )
    try:
        old_status = _canonical_card_status_sets(base_projection)
        old_card_ids = (
            old_status["accepted"]
            | old_status["qualified"]
            | old_status["superseded"]
            | set(prior_card_ids)
        )
    except (TypeError, ValueError) as exc:
        old_card_ids = set()
        errors.append(str(exc))
    preliminary: list[dict[str, Any]] = []
    requested_superseded = {
        str(prior_id)
        for card_id, request in request_by_id.items()
        if request.get("decision") in {"accept", "accept_with_qualification", "supersede"}
        for prior_id in card_by_id.get(card_id, {}).get("supersedes", ())
    }
    needs_human = any(
        item.get("decision") == "needs_human" for item in request_by_id.values()
    )
    if not needs_human:
        for card_id, request in request_by_id.items():
            requested = str(request.get("decision", ""))
            card = card_by_id.get(card_id, {})
            destinations: list[str] = []
            if requested in {"accept", "accept_with_qualification", "supersede"}:
                try:
                    destinations = _card_destinations(
                        card_id, operations, candidate_files
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    errors.append(str(exc))
                if not destinations:
                    errors.append(
                        f"requested {requested} card {card_id} has no canonical destination"
                    )
            elif requested in {"reject", "defer"}:
                try:
                    # A corrected card may retain its frozen predecessor as
                    # history. The effective projection below verifies that
                    # it is superseded and never referenced as active evidence.
                    if card_id not in requested_superseded and _card_destinations(card_id, operations, candidate_files):
                        errors.append(
                            f"non-accepted card {card_id} appears in the candidate canonical snapshot"
                        )
                except (KeyError, TypeError, ValueError) as exc:
                    errors.append(str(exc))
            if requested == "supersede":
                supersedes = set(card.get("supersedes", ()))
                if not supersedes:
                    errors.append(f"supersede card {card_id} names no prior card")
                if unknown := supersedes - old_card_ids - set(card_by_id):
                    errors.append(
                        f"supersede card {card_id} references unknown prior cards: {sorted(unknown)}"
                    )
                nonprior_frozen = {
                    prior_id
                    for prior_id in supersedes - old_card_ids
                    if prior_id in card_position
                    and card_position[prior_id] >= card_position.get(card_id, -1)
                }
                if nonprior_frozen:
                    errors.append(
                        f"supersede card {card_id} references non-prior frozen cards: "
                        f"{sorted(nonprior_frozen)}"
                    )
            preliminary.append(
                {
                    "card_id": card_id,
                    "decision": requested,
                    "qualification": str(request.get("qualification", "")),
                    "canonical_destinations": destinations,
                }
            )

    explicitly_qualified = any(
        item.get("decision") in {"accept_with_qualification", "supersede"}
        and str(item.get("qualification", "")).strip()
        for item in preliminary
    )
    if merge_request.get("conflicts") and not (
        needs_human or explicitly_qualified
    ):
        errors.append(
            "declared conflicts lack an explicit qualified resolution: "
            "MERGE_REQUEST.json conflicts must be resolved by a human decision "
            "or a requested_card_decisions entry using accept_with_qualification "
            "or supersede with a non-empty qualification. Keep ordinary limitations "
            "in the result's qualifications rather than declaring them as conflicts."
        )

    if not errors and not needs_human:
        try:
            proposed_projection = build_effective_projection(
                base_projection,
                {"operations": operations},
                {"canonical_update_decisions": [
                    {"path": operation["path"], "decision": "apply"}
                    for operation in operations
                ]},
                candidate_files,
            )
            errors.extend(_projection_errors(
                base_projection, proposed_projection, result_cards, preliminary, prior_card_ids
            ))
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(str(exc))

    return {
        "errors": errors, "requests": request_by_id,
        "decisions": preliminary, "needs_human": needs_human,
    }


class MergeEvaluator:
    """Derive one service Merge Decision from validated exact-stage inputs."""

    def __init__(self, current_revision: int | None = None) -> None:
        self.current_revision = current_revision

    def evaluate(
        self,
        *,
        stage_manifest: Mapping[str, Any],
        merge_request: Mapping[str, Any],
        review_manifest: Mapping[str, Any],
        reviewer_outputs: Iterable[Mapping[str, Any]] | Mapping[str, Mapping[str, Any]],
        result_cards: Mapping[str, Any] | Iterable[Mapping[str, Any]],
        candidate_files: Mapping[str, Any],
        base_projection: Mapping[str, Any],
        prior_card_ids: Iterable[str] = (),
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> dict[str, Any]:
        prior_card_ids = set(prior_card_ids)
        errors: list[str] = []
        trial_id = str(stage_manifest.get("trial_id", ""))
        project_id = str(stage_manifest.get("project_id", ""))
        stage_id = str(stage_manifest.get("stage_id", ""))
        base_revision = stage_manifest.get("base_revision")

        try:
            if stage_manifest.get("stage_content_hash") != compute_stage_content_hash(
                stage_manifest
            ):
                errors.append("staged update content hash is invalid")
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f"staged update hash cannot be verified: {exc}")
        current_revision = self.current_revision
        if current_revision is None:
            revision_value = base_projection.get(
                "research_trajectory/CANONICAL_REVISION.json"
            )
            if revision_value is not None:
                try:
                    revision_artifact = _decode(
                        "research_trajectory/CANONICAL_REVISION.json", revision_value
                    )
                    current_revision = revision_artifact.get("revision")
                except (AttributeError, TypeError, ValueError):
                    current_revision = None
        if (
            not isinstance(current_revision, int)
            or isinstance(current_revision, bool)
            or current_revision < 0
        ):
            errors.append("the service current canonical revision is unavailable")
        elif base_revision != current_revision:
            errors.append("stage base_revision is stale")
        for label, artifact in (
            ("Merge Request", merge_request),
            ("Review Manifest", review_manifest),
        ):
            if artifact.get("project_id") != project_id:
                errors.append(f"{label} project_id differs from the staged update")
            if artifact.get("trial_id") != trial_id:
                errors.append(f"{label} trial_id differs from the staged update")
            if artifact.get("stage_id") != stage_id:
                errors.append(f"{label} stage_id differs from the staged update")
        if merge_request.get("base_revision") != base_revision:
            errors.append("Merge Request base_revision differs from the staged update")
        expected_manifest_path = f"research_trajectory/.staging/{trial_id}/{stage_id}/STAGED_UPDATE_MANIFEST.json"
        if merge_request.get("staged_update_manifest_path") != expected_manifest_path:
            errors.append("Merge Request points to a different staged update manifest")
        if review_manifest.get("stage_manifest_hash") != stage_manifest.get(
            "stage_content_hash"
        ):
            errors.append("Review Manifest is stale for the staged update")

        reviewer_output_values = (
            list(reviewer_outputs.values())
            if isinstance(reviewer_outputs, Mapping)
            else list(reviewer_outputs)
        )
        closure = evaluate_review_closure(
            review_manifest, reviewer_output_values, stage_manifest
        )
        if not closure["closed"]:
            errors.extend(closure["errors"])

        errors.extend(
            reviewer_card_eligibility_errors(reviewer_output_values, merge_request)
        )

        operations = list(stage_manifest.get("operations", ()))
        operation_paths = [str(item.get("path", "")) for item in operations]
        if len(operation_paths) != len(set(operation_paths)):
            errors.append("staged update contains duplicate canonical operations")
        if operation_paths != sorted(operation_paths):
            errors.append("staged update operations are not in canonical path order")
        material_paths = [
            str(item.get("path", ""))
            for item in stage_manifest.get("material_inputs", ())
        ]
        if material_paths != sorted(material_paths):
            errors.append(
                "staged update material inputs are not in canonical path order"
            )
        material_by_path = {
            str(item.get("path", "")): item
            for item in stage_manifest.get("material_inputs", ())
        }
        candidate_prefix = (
            f"research_trajectory/.staging/{trial_id}/{stage_id}/candidate/"
        )
        for operation in operations:
            try:
                target = str(operation.get("path", ""))
                candidate_path = str(operation.get("candidate_path", ""))
                if operation.get("operation") not in {"create", "replace"}:
                    errors.append(f"stage operation type is invalid for {target}")
                if not canonical_target_allowed(target, trial_id):
                    errors.append(
                        f"stage operation is not an allowed canonical target: {target}"
                    )
                if (
                    not candidate_path.startswith(candidate_prefix)
                    or candidate_path[len(candidate_prefix) :] != target
                ):
                    errors.append(
                        f"stage candidate path does not mirror target: {target}"
                    )
                material = material_by_path.get(candidate_path, {})
                if material.get("role") != "candidate_canonical" or material.get(
                    "sha256"
                ) != operation.get("after_sha256"):
                    errors.append(
                        f"stage candidate material binding is invalid: {target}"
                    )
                _source_path, raw = _candidate_value(candidate_files, operation)
                after_hash = sha256(_bytes(raw)).hexdigest()
                if after_hash != operation.get("after_sha256"):
                    errors.append(f"candidate hash differs for {target}")
            except (KeyError, TypeError, ValueError) as exc:
                errors.append(str(exc))

        proposal = prepare_card_decisions(
            merge_request=merge_request, result_cards=result_cards,
            operations=operations, candidate_files=candidate_files,
            base_projection=base_projection, trial_id=trial_id, project_id=project_id,
            prior_card_ids=prior_card_ids,
        )
        errors.extend(proposal["errors"])
        request_by_id = proposal["requests"]
        preliminary = proposal["decisions"]
        needs_human = proposal["needs_human"]

        timestamp = created_at or utc_z_timestamp()
        common = {
            "schema_version": SCHEMA_VERSION,
            "artifact_type": "merge_decision",
            "project_id": project_id,
            "created_at": timestamp,
            "updated_at": updated_at or timestamp,
            "extensions": {},
            "trial_id": trial_id,
            "stage_id": stage_id,
            "base_revision": base_revision,
            "review_manifest_hash": canonical_json_hash(review_manifest),
            "stage_manifest_hash": stage_manifest.get("stage_content_hash"),
        }

        if errors:
            card_decisions = [
                {
                    "card_id": card_id,
                    "decision": (
                        "defer" if request.get("decision") == "defer" else "reject"
                    ),
                    "qualification": "",
                    "canonical_destinations": [],
                }
                for card_id, request in request_by_id.items()
                if _CARD_ID.fullmatch(card_id)
            ]
            decision = {
                **common,
                "overall_status": "rejected",
                "card_decisions": card_decisions,
                "canonical_update_decisions": [
                    {
                        "path": path,
                        "decision": "omit",
                        "reason": "The reviewed stage is not merge-coherent.",
                    }
                    for path in sorted(set(operation_paths))
                    if path
                ],
                "conflict_resolution": [],
                "qualifications": [],
                "lead_rationale": "The service rejected the stage because merge invariants failed.",
            }
            return {
                "decision": decision,
                "publishable": False,
                "effective_projection": None,
                "review_closure": closure,
                "errors": errors,
            }

        if needs_human:
            card_decisions = [
                {
                    "card_id": card_id,
                    "decision": (
                        "needs_human"
                        if request.get("decision") == "needs_human"
                        else "defer"
                    ),
                    "qualification": "",
                    "canonical_destinations": [],
                }
                for card_id, request in request_by_id.items()
            ]
            safe_paths: set[str] = set()
            for operation in operations:
                path = str(operation.get("path", ""))
                try:
                    _source, raw = _candidate_value(candidate_files, operation)
                except (KeyError, TypeError, ValueError):
                    continue
                if _safe_blocker_change(path, raw, base_projection, trial_id):
                    safe_paths.add(path)
            # Markdown blocker views are safe only beside an authorized JSON source.
            for path in tuple(safe_paths):
                if path.endswith(".md") and path[:-3] + ".json" not in safe_paths:
                    safe_paths.remove(path)
            update_decisions = [
                {
                    "path": path,
                    "decision": "apply" if path in safe_paths else "omit",
                    "reason": (
                        "Safe blocker/state or revision-only findings update."
                        if path in safe_paths
                        else "Substantive updates await human authority."
                    ),
                }
                for path in sorted(set(operation_paths))
            ]
            decision = {
                **common,
                "overall_status": "needs_human",
                "card_decisions": card_decisions,
                "canonical_update_decisions": update_decisions,
                "conflict_resolution": [],
                "qualifications": [
                    "Current-trial result cards remain proposed or deferred."
                ],
                "lead_rationale": "Formal human authority is required; only safe blocker/state updates may apply.",
            }
        else:
            decision = {
                **common,
                "overall_status": "approved",
                "card_decisions": preliminary,
                "canonical_update_decisions": [
                    {
                        "path": path,
                        "decision": "apply",
                        "reason": "The exact reviewed candidate operation is coherent.",
                    }
                    for path in sorted(set(operation_paths))
                ],
                "conflict_resolution": list(merge_request.get("conflicts", ())),
                "qualifications": [
                    item["qualification"]
                    for item in preliminary
                    if item["decision"]
                    in {"accept_with_qualification", "supersede"}
                    and item["qualification"]
                ],
                "lead_rationale": "All required reviewers strictly passed the exact coherent stage.",
            }

        decision_errors = validate_artifact(decision, expected_type="merge_decision")
        if decision_errors:
            raise MergeError(
                "derived Merge Decision is invalid: " + "; ".join(decision_errors)
            )
        try:
            projection = build_effective_projection(
                base_projection, stage_manifest, decision, candidate_files
            )
            projection_errors = _projection_errors(
                base_projection, projection, result_cards, decision["card_decisions"], prior_card_ids
            )
        except (KeyError, TypeError, ValueError) as exc:
            projection = None
            projection_errors = [str(exc)]
        if projection_errors:
            rejected_cards = [
                {
                    "card_id": item["card_id"],
                    "decision": (
                        "defer"
                        if item["decision"] in {"defer", "needs_human"}
                        else "reject"
                    ),
                    "qualification": "",
                    "canonical_destinations": [],
                }
                for item in decision["card_decisions"]
            ]
            rejected = {
                **common,
                "overall_status": "rejected",
                "card_decisions": rejected_cards,
                "canonical_update_decisions": [
                    {
                        "path": path,
                        "decision": "omit",
                        "reason": "The effective projection is inconsistent.",
                    }
                    for path in sorted(set(operation_paths))
                ],
                "conflict_resolution": [],
                "qualifications": [],
                "lead_rationale": "The service rejected the effective projection after cross-reference validation.",
            }
            return {
                "decision": rejected,
                "publishable": False,
                "effective_projection": None,
                "review_closure": closure,
                "errors": projection_errors,
            }
        return {
            "decision": decision,
            "publishable": True,
            "effective_projection": projection,
            "review_closure": closure,
            "errors": [],
        }


def evaluate_merge(**kwargs: Any) -> dict[str, Any]:
    """Functional wrapper around :class:`MergeEvaluator`."""

    current_revision = kwargs.pop("current_revision", None)
    return MergeEvaluator(current_revision=current_revision).evaluate(**kwargs)


def derive_merge_decision(**kwargs: Any) -> dict[str, Any]:
    return evaluate_merge(**kwargs)["decision"]
