"""Pure deterministic review routing for the v2 sequential kernel."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


ROUTER_VERSION = "2.0.0"
LEVELS = ("light", "standard", "full", "final")
LEVEL_RANK = {level: rank for rank, level in enumerate(LEVELS)}
CORE_REVIEWERS = (
    "plan",
    "process",
    "evidence",
    "venue_fit",
    "manuscript",
    "figure_table",
    "reference",
    "final_gate",
)
REVIEW_STEMS = {
    "plan": "PLAN_REVIEW",
    "process": "PROCESS_REVIEW",
    "evidence": "EVIDENCE_REVIEW",
    "venue_fit": "VENUE_FIT_REVIEW",
    "manuscript": "MANUSCRIPT_REVIEW",
    "figure_table": "FIGURE_TABLE_REVIEW",
    "reference": "REFERENCE_REVIEW",
    "final_gate": "FINAL_GATE_REVIEW",
}
BASE_REVIEWERS = {
    "light": ("plan", "process"),
    "standard": ("plan", "process", "evidence"),
    "full": CORE_REVIEWERS[:-1],
    "final": CORE_REVIEWERS,
}
TRIGGER_ORDER = (
    "external_sources_or_new_citations",
    "target_venue_configured_or_venue_impact",
    "manuscript_or_claim_hierarchy_changed",
    "active_figure_or_table_changed",
    "central_line_effect_not_no_change",
    "campaign_component_marked_passed_or_waived",
    "target_venue_lock_change_requested",
    "gate_candidate_pass",
    "high_risk_ethics_legal_human_subjects",
)
TRIGGER_REVIEWERS = {
    "external_sources_or_new_citations": ("reference",),
    "target_venue_configured_or_venue_impact": ("venue_fit",),
    "manuscript_or_claim_hierarchy_changed": ("manuscript",),
    "active_figure_or_table_changed": ("figure_table",),
    "target_venue_lock_change_requested": ("venue_fit",),
}
TRIGGER_MINIMUMS = {
    "central_line_effect_not_no_change": "full",
    "campaign_component_marked_passed_or_waived": "full",
    "target_venue_lock_change_requested": "full",
    "gate_candidate_pass": "final",
    "high_risk_ethics_legal_human_subjects": "full",
}
LINE_EFFECTS = {
    "creates",
    "strengthens",
    "weakens",
    "narrows",
    "broadens",
    "supersedes",
    "kills",
    "no_change",
}
LIGHT_TARGETS = {"resource", "process", "manuscript"}
GENERAL_RESEARCH_SPECIALIZED_REVIEWERS: tuple[dict[str, str], ...] = ()


def _boolean(inputs: Mapping[str, Any], key: str, default: bool = False) -> bool:
    value = inputs.get(key, default)
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a boolean")
    return value


def _level(value: Any, field: str) -> str | None:
    if value is None:
        return None
    if value not in LEVEL_RANK:
        raise ValueError(f"{field} must be one of {', '.join(LEVELS)}")
    return str(value)


def active_triggers(inputs: Mapping[str, Any]) -> tuple[str, ...]:
    """Return the complete active trigger set in specification order."""

    line_effect = inputs.get("line_effect", "no_change")
    if line_effect not in LINE_EFFECTS:
        raise ValueError(f"unknown line_effect: {line_effect}")

    triggered = {
        name: _boolean(inputs, name)
        for name in TRIGGER_ORDER
        if name
        not in {
            "central_line_effect_not_no_change",
            "gate_candidate_pass",
        }
    }
    triggered["central_line_effect_not_no_change"] = (
        line_effect != "no_change"
        or _boolean(inputs, "central_line_effect_not_no_change")
    )
    triggered["gate_candidate_pass"] = (
        _boolean(inputs, "final_candidate")
        or _boolean(inputs, "gate_candidate_pass")
    )
    return tuple(name for name in TRIGGER_ORDER if triggered[name])


def _light_allowed(inputs: Mapping[str, Any], triggers: tuple[str, ...]) -> bool:
    target = inputs.get("target")
    campaign_promoted = _boolean(
        inputs, "campaign_component_promoted_beyond_in_progress"
    ) or "campaign_component_marked_passed_or_waived" in triggers
    venue_changed = _boolean(inputs, "venue_impact") or (
        "target_venue_lock_change_requested" in triggers
    )
    return (
        target in LIGHT_TARGETS
        and not _boolean(inputs, "new_or_changed_claim")
        and inputs.get("line_effect", "no_change") == "no_change"
        and not campaign_promoted
        and not venue_changed
        and "gate_candidate_pass" not in triggers
    )


def _higher_level(left: str, right: str) -> str:
    return left if LEVEL_RANK[left] >= LEVEL_RANK[right] else right


def _request(inputs: Mapping[str, Any], primary: str, alias: str) -> Any:
    primary_value = inputs.get(primary)
    alias_value = inputs.get(alias)
    if (
        primary_value is not None
        and alias_value is not None
        and primary_value != alias_value
    ):
        raise ValueError(f"conflicting {primary} and {alias}")
    return primary_value if primary_value is not None else alias_value


def _resolve_specialized(
    inputs: Mapping[str, Any], triggers: tuple[str, ...]
) -> list[dict[str, str]]:
    selected: dict[str, dict[str, str]] = {}
    registries = inputs.get("enabled_registries", ())
    if isinstance(registries, (str, bytes)) or not hasattr(registries, "__iter__"):
        raise ValueError("enabled_registries must be an iterable of mappings")
    for registry in registries:
        if not isinstance(registry, Mapping):
            raise ValueError("each enabled registry must be a mapping")
        reviewers = registry.get("specialized_reviewers", ())
        if isinstance(reviewers, (str, bytes)) or not hasattr(reviewers, "__iter__"):
            raise ValueError("specialized_reviewers must be an iterable")
        for reviewer in reviewers:
            if not isinstance(reviewer, Mapping):
                raise ValueError("specialized reviewer entries must be mappings")
            required = ("id", "instruction_path", "output_path", "trigger")
            if any(
                not isinstance(reviewer.get(key), str) or not reviewer[key]
                for key in required
            ):
                raise ValueError("specialized reviewer entry is incomplete")
            if reviewer["trigger"] not in triggers:
                continue
            reviewer_id = reviewer["id"]
            if reviewer_id in selected:
                raise ValueError(f"duplicate specialized reviewer id: {reviewer_id}")
            selected[reviewer_id] = {key: reviewer[key] for key in required}
    return [selected[key] for key in sorted(selected)]


def _omission_reason(reviewer: str, triggers: tuple[str, ...]) -> str:
    if reviewer == "evidence":
        return "Light review does not require Evidence."
    if reviewer == "venue_fit":
        return "No Full/Final level or venue trigger requires Venue Fit."
    if reviewer == "manuscript":
        return "No Full/Final level or manuscript trigger requires Manuscript."
    if reviewer == "figure_table":
        return "No Full/Final level or active visual trigger requires Figure/Table."
    if reviewer == "reference":
        return "No Full/Final level or external-source trigger requires Reference."
    if reviewer == "final_gate" and "gate_candidate_pass" not in triggers:
        return "The candidate Goal Gate status is not pass."
    return "The selected review level and active triggers do not require this reviewer."


def compute_review_route(inputs: Mapping[str, Any]) -> dict[str, Any]:
    """Compute the service minimum and selected reviewer closure.

    ``inputs`` contains structured effects, not an agent-authored reviewer list.
    Agent and human level requests are escalation requests only.
    """

    if not isinstance(inputs, Mapping):
        raise TypeError("review inputs must be a mapping")

    triggers = active_triggers(inputs)
    minimum = "light" if _light_allowed(inputs, triggers) else "standard"
    rationale = [
        "All Light-review constraints are satisfied."
        if minimum == "light"
        else "Standard is the default substantive review level."
    ]
    for trigger in triggers:
        trigger_minimum = TRIGGER_MINIMUMS.get(trigger)
        if trigger_minimum:
            minimum = _higher_level(minimum, trigger_minimum)
        rationale.append(f"Routing trigger: {trigger}.")

    selected = minimum
    requests = (
        (
            "agent_requested_level",
            _request(inputs, "agent_requested_level", "requested_review_level"),
        ),
        (
            "human_escalation_level",
            _request(inputs, "human_escalation_level", "human_requested_level"),
        ),
    )
    for field, value in requests:
        requested = _level(value, field)
        if requested is None:
            continue
        if LEVEL_RANK[requested] > LEVEL_RANK[selected]:
            selected = requested
            rationale.append(f"{field} escalated review to {requested}.")
        elif LEVEL_RANK[requested] < LEVEL_RANK[minimum]:
            rationale.append(
                f"{field}={requested} cannot lower the service minimum {minimum}."
            )

    required = set(BASE_REVIEWERS[selected])
    for trigger in triggers:
        required.update(TRIGGER_REVIEWERS.get(trigger, ()))
    ordered_required = [key for key in CORE_REVIEWERS if key in required]
    omitted = [
        {"reviewer": key, "reason": _omission_reason(key, triggers)}
        for key in CORE_REVIEWERS
        if key not in required
    ]

    return {
        "router_version": ROUTER_VERSION,
        "minimum_level": minimum,
        "selected_level": selected,
        "selection_rationale": rationale,
        "required_reviewers": ordered_required,
        "omitted_reviewers": omitted,
        "specialized_reviewers": _resolve_specialized(inputs, triggers),
        "final_candidate": "gate_candidate_pass" in triggers,
    }
