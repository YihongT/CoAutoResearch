"""Pure venue authority, readiness, campaign, and move-ranking policy."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from copy import deepcopy
import re
from typing import Any


_ACTIVE_FIELDS = (
    "target_venue",
    "audience",
    "article_type",
    "profile_path",
    "lock_level",
    "locked_by_intervention_id",
    "human_constraints",
)
_COMPONENT_ID = re.compile(r"[^a-z0-9_]+")


def venue_update_errors(
    before: Mapping[str, Any], after: Mapping[str, Any]
) -> list[str]:
    """Reject silent preferred/locked venue changes while allowing suggestions."""

    if not isinstance(before, Mapping) or not isinstance(after, Mapping):
        return ["venue states must be objects"]
    errors: list[str] = []
    changed = {field for field in _ACTIVE_FIELDS if before.get(field) != after.get(field)}
    if not changed:
        return errors
    extensions = after.get("extensions", {})
    extensions = extensions if isinstance(extensions, Mapping) else {}
    current = before.get("lock_level")
    target = after.get("lock_level")
    touches_lock = "locked" in {current, target}
    if touches_lock:
        intervention = extensions.get("formal_human_intervention_id")
        prior = before.get("locked_by_intervention_id")
        if (
            not isinstance(intervention, str)
            or not intervention.strip()
            or intervention == prior
        ):
            errors.append(
                "entering, leaving, or changing a locked venue requires a new formal human intervention ID"
            )
        if target == "locked" and after.get("locked_by_intervention_id") != intervention:
            errors.append("locked_by_intervention_id must cite the authorizing intervention")
    elif current == "preferred" and "target_venue" in changed:
        rationale = extensions.get("venue_change_rationale")
        if not isinstance(rationale, str) or not rationale.strip():
            errors.append("changing a preferred venue requires a published rationale")
    return errors


def venue_readiness(
    target: Mapping[str, Any] | None, profile: Mapping[str, Any] | None
) -> dict[str, Any]:
    """Derive venue gaps from canonical target/profile state."""

    if not target or target.get("target_venue") is None:
        return {"configured": False, "ready": True, "gaps": []}
    gaps: list[dict[str, str]] = []

    def gap(identifier: str, description: str) -> None:
        gaps.append({"id": identifier, "description": description})

    if not profile:
        gap("profile_missing", "Create the structured profile for the active venue.")
    else:
        if target.get("profile_path") != "resources/target_venue/VENUE_PROFILE.json":
            gap("profile_unlinked", "Link the active venue to its canonical profile.")
        if profile.get("venue_name") != target.get("target_venue"):
            gap("profile_mismatch", "Use a profile for the active venue.")
        if profile.get("profile_status") != "ready":
            gap("profile_not_ready", "Complete the venue profile before final review.")
        for field in (
            "contribution_patterns",
            "evidence_standards",
            "manuscript_expectations",
            "common_rejection_risks",
        ):
            if not profile.get(field):
                gap(field, f"Record venue {field.replace('_', ' ')}.")
        requirements = profile.get("requirements_evidence", ())
        if not isinstance(requirements, Iterable) or isinstance(
            requirements, (str, bytes)
        ):
            gap(
                "requirements_evidence_invalid",
                "Record official venue requirements as structured provenance entries.",
            )
        else:
            requirements = list(requirements)
            if not any(
                isinstance(item, Mapping)
                and item.get("authority") in {"official_venue", "official_publisher"}
                and item.get("inspection_status") == "inspected"
                for item in requirements
            ):
                gap(
                    "official_requirements_uninspected",
                    "Inspect current official guidance for the active venue and article type.",
                )
            if any(
                not isinstance(item, Mapping)
                or item.get("inspection_status") not in {"inspected", "excluded"}
                for item in requirements
            ):
                gap(
                    "official_requirements_pending",
                    "Resolve every venue-requirement source to inspected or excluded.",
                )
        papers = profile.get("seed_papers", ())
        if not isinstance(papers, Iterable) or isinstance(papers, (str, bytes)):
            gap("seed_papers_invalid", "Record seed papers as structured provenance entries.")
        else:
            papers = list(papers)
            if not any(
                isinstance(item, Mapping) and item.get("inspection_status") == "inspected"
                for item in papers
            ):
                gap("seed_paper_uninspected", "Inspect at least one representative seed paper.")
            if any(
                not isinstance(item, Mapping)
                or item.get("inspection_status") not in {"inspected", "excluded"}
                for item in papers
            ):
                gap("seed_paper_pending", "Resolve every recorded seed paper to inspected or excluded.")
    return {"configured": True, "ready": not gaps, "gaps": gaps}


def venue_campaign_components(readiness: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Project each venue gap into a campaign component."""

    result = []
    for item in readiness.get("gaps", ()):
        if not isinstance(item, Mapping):
            continue
        identifier = _COMPONENT_ID.sub("_", str(item.get("id", "gap")).lower()).strip("_")
        result.append(
            {
                "component_id": f"venue_{identifier}",
                "title": str(item.get("description") or identifier).strip(),
                "status": "not_started",
                "satisfying_card_ids": [],
                "rationale": "Required by the active target venue.",
            }
        )
    return result


def venue_active_constraints(
    target: Mapping[str, Any] | None, profile: Mapping[str, Any] | None
) -> dict[str, Any]:
    """Project venue state into framing and manuscript-architecture constraints."""

    readiness = venue_readiness(target, profile)
    if not readiness["configured"]:
        return {
            **readiness,
            "framing_constraints": {},
            "manuscript_architecture_constraints": {},
        }
    if profile and profile.get("venue_name") != target.get("target_venue"):
        raise ValueError("venue profile does not match the active target venue")
    profile = profile or {}
    framing = {
        "target_venue": target.get("target_venue"),
        "audience": target.get("audience"),
        "article_type": target.get("article_type"),
        "lock_level": target.get("lock_level"),
        "human_constraints": list(target.get("human_constraints", ())),
        "contribution_patterns": deepcopy(list(profile.get("contribution_patterns", ()))),
        "evidence_standards": deepcopy(list(profile.get("evidence_standards", ()))),
        "rejection_risks": deepcopy(list(profile.get("common_rejection_risks", ()))),
    }
    manuscript = {
        "target_venue": target.get("target_venue"),
        "audience": target.get("audience"),
        "article_type": target.get("article_type"),
        "organization_requirements": deepcopy(list(profile.get("manuscript_expectations", ()))),
        "figure_table_requirements": deepcopy(list(profile.get("figure_table_expectations", ()))),
    }
    return {
        **readiness,
        "framing_constraints": framing,
        "manuscript_architecture_constraints": manuscript,
    }


def rank_next_moves(
    candidates: Iterable[Mapping[str, Any]], readiness: Mapping[str, Any]
) -> list[dict[str, Any]]:
    """Rank moves by venue-gap coverage, then caller-provided base rank."""

    gap_ids = {
        str(item.get("id"))
        for item in readiness.get("gaps", ())
        if isinstance(item, Mapping) and item.get("id")
    }
    ranked: list[tuple[int, int, int, dict[str, Any]]] = []
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, Mapping):
            raise ValueError("move candidates must be objects")
        coverage = candidate.get("venue_gap_ids", ())
        if isinstance(coverage, (str, bytes)) or not isinstance(coverage, Iterable):
            raise ValueError("venue_gap_ids must be a list")
        covered = gap_ids & {str(item) for item in coverage}
        base_rank = candidate.get("base_rank", index)
        if not isinstance(base_rank, int) or isinstance(base_rank, bool):
            raise ValueError("base_rank must be an integer")
        ranked.append((-len(covered), base_rank, index, deepcopy(dict(candidate))))
    return [candidate for _coverage, _base, _index, candidate in sorted(ranked)]
