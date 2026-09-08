"""Pure state-transition and Goal Gate policy for CoAutoResearch v2."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any


GATE_PRIORITY = (
    "killed_by_human",
    "pass",
    "needs_human",
    "paused_budget",
    "blocked",
    "continue",
    "no_viable_line",
)
SATISFYING_CAMPAIGN_STATUSES = {
    "passed",
    "waived_with_rationale",
    "not_applicable",
}

TRANSITIONS: dict[str, dict[str, frozenset[str]]] = {
    "trial_lifecycle_state": {
        "created": frozenset({"planned", "aborted"}),
        "planned": frozenset(
            {"preflight_passed", "needs_human", "blocked", "aborted"}
        ),
        "preflight_passed": frozenset(
            {"executing", "needs_human", "blocked", "aborted"}
        ),
        "executing": frozenset(
            {"distilled", "needs_human", "blocked", "invalidated", "aborted"}
        ),
        "distilled": frozenset(
            {"staged", "needs_human", "blocked", "invalidated"}
        ),
        "staged": frozenset(
            {"reviewing", "needs_human", "blocked", "invalidated"}
        ),
        "reviewing": frozenset(
            {"staged", "ready_to_publish", "needs_human", "blocked", "invalidated"}
        ),
        "ready_to_publish": frozenset({"published", "invalidated"}),
        "published": frozenset(),
        "needs_human": frozenset({"staged", "published", "aborted"}),
        "blocked": frozenset({"staged", "published", "aborted"}),
        "invalidated": frozenset(),
        "aborted": frozenset(),
    },
    "line_status": {
        "candidate": frozenset({"active", "paused", "killed", "superseded"}),
        "active": frozenset(
            {"candidate_final", "paused", "killed", "superseded"}
        ),
        "paused": frozenset({"candidate", "active", "killed", "superseded"}),
        "candidate_final": frozenset({"active", "killed", "superseded"}),
        "killed": frozenset(),
        "superseded": frozenset(),
    },
    "campaign_component_status": {
        "not_started": frozenset(
            {"in_progress", "not_applicable", "waived_with_rationale", "blocked"}
        ),
        "in_progress": frozenset(
            {
                "partial",
                "tentative",
                "passed",
                "blocked",
                "not_applicable",
                "waived_with_rationale",
            }
        ),
        "partial": frozenset(
            {
                "in_progress",
                "tentative",
                "passed",
                "blocked",
                "waived_with_rationale",
                "not_applicable",
            }
        ),
        "tentative": frozenset(
            {
                "in_progress",
                "partial",
                "passed",
                "blocked",
                "waived_with_rationale",
                "not_applicable",
            }
        ),
        "passed": frozenset({"in_progress", "partial", "tentative", "blocked"}),
        "waived_with_rationale": frozenset({"in_progress", "blocked"}),
        "not_applicable": frozenset({"in_progress", "blocked"}),
        "blocked": frozenset(
            {
                "in_progress",
                "partial",
                "tentative",
                "passed",
                "waived_with_rationale",
                "not_applicable",
            }
        ),
    },
    "result_card_canonical_status": {
        "proposed": frozenset(
            {
                "accepted",
                "accepted_with_qualification",
                "rejected",
                "superseded",
                "deferred",
            }
        ),
        "deferred": frozenset(
            {"accepted", "accepted_with_qualification", "rejected", "superseded"}
        ),
        "accepted": frozenset({"superseded"}),
        "accepted_with_qualification": frozenset({"superseded"}),
        "rejected": frozenset(),
        "superseded": frozenset(),
    },
    "venue_lock_level": {
        "exploratory": frozenset({"preferred", "locked"}),
        "preferred": frozenset({"exploratory", "locked"}),
        "locked": frozenset({"exploratory", "preferred"}),
    },
    "human_task_status": {
        "open": frozenset({"waiting", "completed", "dismissed", "superseded"}),
        "waiting": frozenset({"open", "completed", "dismissed", "superseded"}),
        "completed": frozenset(),
        "dismissed": frozenset(),
        "superseded": frozenset(),
    },
    "transaction_state": {
        "created": frozenset({"prepared", "failed", "rolled_back"}),
        "prepared": frozenset({"applying", "rolled_back", "failed"}),
        "applying": frozenset({"committed", "rolled_back", "failed"}),
        "committed": frozenset(),
        "rolled_back": frozenset(),
        "failed": frozenset({"rolled_back"}),
    },
}


@dataclass(frozen=True)
class TransitionDecision:
    allowed: bool
    no_op: bool
    reason: str


def evaluate_transition(
    namespace: str,
    current: str,
    target: str,
    *,
    formal_human_intervention: bool = False,
) -> TransitionDecision:
    """Evaluate one declared transition and distinguish an explicit no-op."""

    if namespace not in TRANSITIONS:
        raise ValueError(f"unknown transition namespace: {namespace}")
    states = TRANSITIONS[namespace]
    if current not in states:
        raise ValueError(f"unknown {namespace} state: {current}")
    if target not in states:
        raise ValueError(f"unknown {namespace} state: {target}")
    if not isinstance(formal_human_intervention, bool):
        raise ValueError("formal_human_intervention must be a boolean")
    if current == target:
        return TransitionDecision(True, True, "State is unchanged.")
    if target not in states[current]:
        return TransitionDecision(False, False, "Transition is not declared.")
    if namespace == "venue_lock_level" and "locked" in {current, target}:
        if not formal_human_intervention:
            return TransitionDecision(
                False,
                False,
                "A formal human intervention is required to enter or leave locked.",
            )
    return TransitionDecision(True, False, "Transition is declared.")


def campaign_component_satisfied(status: str) -> bool:
    states = TRANSITIONS["campaign_component_status"]
    if status not in states:
        raise ValueError(f"unknown campaign component status: {status}")
    return status in SATISFYING_CAMPAIGN_STATUSES


def campaigns_satisfied(statuses: Iterable[str]) -> bool:
    if isinstance(statuses, (str, bytes)):
        raise ValueError("campaign component statuses must be an iterable of states")
    return all(campaign_component_satisfied(status) for status in statuses)


def _boolean(values: Mapping[str, Any], key: str) -> bool:
    value = values.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a service-derived boolean")
    return value


def evaluate_final_readiness(projection: Mapping[str, Any]) -> dict[str, Any]:
    """Evaluate all pass invariants over an effective post-merge projection."""

    if not isinstance(projection, Mapping):
        raise TypeError("projection must be a mapping")
    statuses = projection.get("campaign_component_statuses")
    if not isinstance(statuses, Iterable) or isinstance(statuses, (str, bytes)):
        raise ValueError("campaign_component_statuses must be an iterable")

    checks = {
        "candidate_final_active_line": projection.get("active_line_count") == 1
        and projection.get("active_line_status") == "candidate_final",
        "campaigns_satisfied": campaigns_satisfied(statuses),
        "key_claims_authorized": _boolean(projection, "key_claims_authorized"),
        "negative_and_limiting_evidence_visible": _boolean(
            projection, "negative_and_limiting_evidence_visible"
        ),
        "critical_path_clear": not _boolean(
            projection, "critical_path_has_open_blocker"
        ),
        "deliverable_architecture_coherent": _boolean(
            projection, "deliverable_architecture_coherent"
        ),
        "target_venue_requirements_satisfied": _boolean(
            projection, "target_venue_requirements_satisfied"
        ),
        "specialized_coverage_complete": _boolean(
            projection, "specialized_coverage_complete"
        ),
        "final_review_level": projection.get("review_level") == "final",
        "all_required_reviewers_pass": _boolean(
            projection, "all_required_reviewers_pass"
        ),
        "final_human_brief_complete": _boolean(
            projection, "final_human_brief_complete"
        ),
        "transaction_validation_passed": _boolean(
            projection, "transaction_validation_passed"
        ),
        "schema_validation_passed": _boolean(
            projection, "schema_validation_passed"
        ),
    }
    unmet = [name for name, passed in checks.items() if not passed]
    return {
        "ready": not unmet,
        "structured_candidate_ready": not unmet,
        "decision_scope": "configured_structured_checks_only_human_confirmation_required",
        "checks": checks,
        "unmet": unmet,
    }


def _validate_human_blocker(signals: Mapping[str, Any]) -> None:
    action = signals.get("human_action")
    if not isinstance(action, Mapping):
        raise ValueError("needs_human requires a structured human_action")
    if action.get("needed") is not True:
        raise ValueError("needs_human requires human_action.needed=true")
    if action.get("blocking") is not True:
        raise ValueError("needs_human requires human_action.blocking=true")
    if action.get("can_continue_meanwhile") is not False:
        raise ValueError("needs_human requires can_continue_meanwhile=false")
    options = action.get("options")
    if not isinstance(options, list) or len(options) > 5 or not all(
        isinstance(option, str) and option.strip() for option in options
    ):
        raise ValueError("needs_human options must be a bounded list of strings")
    for key in ("question", "why_needed"):
        value = action.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"needs_human requires one non-empty {key}")
    if _boolean(signals, "independent_valuable_move"):
        raise ValueError(
            "needs_human is invalid while an independent valuable move exists"
        )


def _validate_human_kill_authority(signals: Mapping[str, Any]) -> dict[str, Any]:
    authority = signals.get("human_kill_authority")
    if not isinstance(authority, Mapping):
        raise ValueError(
            "killed_by_human requires a formal intervention or authenticated UI action"
        )
    if authority.get("verified_by_service") is not True:
        raise ValueError("human kill authority must be verified by the service")
    source = authority.get("source")
    if source not in {"formal_intervention", "authenticated_ui_action"}:
        raise ValueError("human kill authority source is invalid")
    result: dict[str, Any] = {
        "source": str(source),
        "verified_by_service": True,
    }
    for key in ("authority_id", "record_path", "record_sha256", "recorded_at"):
        value = authority.get(key)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"human kill authority requires {key}")
        result[key] = value.strip()
    return result


def evaluate_goal_gate(
    signals: Mapping[str, Any], projection: Mapping[str, Any]
) -> dict[str, Any]:
    """Compute the Goal Gate without trusting agent-recommended status fields."""

    if not isinstance(signals, Mapping):
        raise TypeError("gate signals must be a mapping")
    readiness = evaluate_final_readiness(projection)
    killed = _boolean(signals, "killed_by_human")
    human_blocker = _boolean(signals, "human_blocker")
    budget_reached = _boolean(signals, "budget_reached")
    operational_blocker = _boolean(signals, "operational_blocker")
    viable_path = _boolean(signals, "viable_path")
    concrete_move = _boolean(signals, "concrete_high_value_move")

    expected_value = signals.get("expected_value")
    if expected_value not in {"none", "low", "medium", "high"}:
        raise ValueError("expected_value must be none, low, medium, or high")
    if concrete_move and expected_value not in {"medium", "high"}:
        raise ValueError(
            "a concrete high-value move must have medium/high expected_value"
        )

    kill_authority = _validate_human_kill_authority(signals) if killed else None
    if killed:
        status, rule = "killed_by_human", "formal_human_kill"
    elif readiness["ready"]:
        status, rule = "pass", "all_final_readiness_invariants"
    elif human_blocker:
        _validate_human_blocker(signals)
        status, rule = "needs_human", "human_only_dependency_blocks_all_moves"
    elif budget_reached:
        status, rule = "paused_budget", "configured_budget_or_checkpoint_reached"
    elif operational_blocker:
        if _boolean(signals, "independent_valuable_move"):
            raise ValueError(
                "blocked is invalid while an independent valuable move exists"
            )
        recovery_condition = signals.get("recovery_condition")
        if not isinstance(recovery_condition, str) or not recovery_condition.strip():
            raise ValueError(
                "blocked requires one concrete non-human recovery_condition"
            )
        status, rule = "blocked", "operational_dependency_blocks_all_moves"
    elif viable_path and concrete_move:
        status, rule = "continue", "viable_path_and_concrete_high_value_move"
    else:
        status, rule = "no_viable_line", "no_viable_path_or_high_value_move"

    result = {
        "status": status,
        "decision_rule": rule,
        "final_readiness": readiness,
    }
    if kill_authority is not None:
        result["human_kill_authority"] = kill_authority
    if status == "blocked":
        result["recovery_condition"] = recovery_condition.strip()
    return result
