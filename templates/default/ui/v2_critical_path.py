"""Deterministic Critical Path projection from published research state."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any


_SATISFIED_COMPONENTS = {"passed", "waived_with_rationale", "not_applicable"}
_SATISFIED_RESOURCES = {"available", "acquired", "substituted", "complete"}


def _objects(name: str, values: Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    if isinstance(values, (str, bytes)) or not isinstance(values, Iterable):
        raise ValueError(f"{name} must be a list of objects")
    result = list(values)
    if any(not isinstance(item, Mapping) for item in result):
        raise ValueError(f"{name} must be a list of objects")
    return result


def _text(item: Mapping[str, Any], *keys: str) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def derive_critical_path(
    lines: Iterable[Mapping[str, Any]],
    campaigns: Iterable[Mapping[str, Any]],
    human_locks: Iterable[Mapping[str, Any]],
    resource_dependencies: Iterable[Mapping[str, Any]],
) -> list[dict[str, str]]:
    """Return at most three actionable bottlenecks in service-owned priority order.

    Human locks use ``source``, ``description``/``question``, ``blocking``, and
    ``resolved``. Resource dependencies use ``source``, ``description``,
    ``criticality``, ``status``, and optional ``human_only``. Caller-provided
    rank, priority, or score fields are deliberately ignored.
    """

    ranked: list[tuple[int, str, str, str]] = []

    for item in _objects("human_locks", human_locks):
        if item.get("blocking") is not True or item.get("resolved") is True:
            continue
        source = _text(item, "source", "id")
        description = _text(item, "description", "question")
        if source and description:
            ranked.append((0, source, description, "blocked_human"))

    for line in _objects("lines", lines):
        if line.get("status") not in {"active", "candidate_final"}:
            continue
        source_id = _text(line, "line_id")
        description = _text(line, "current_bottleneck")
        if source_id and description:
            rank = 1 if line.get("status") == "active" else 4
            ranked.append((rank, f"{source_id}/current_bottleneck", description, "open"))

    for item in _objects("resource_dependencies", resource_dependencies):
        status = _text(item, "status").lower()
        if item.get("criticality") != "research-critical" or status in _SATISFIED_RESOURCES:
            continue
        source = _text(item, "source", "id")
        description = _text(item, "description", "need")
        if source and description:
            projected_status = (
                "blocked_human"
                if item.get("human_only") is True
                else "blocked_operational" if status == "blocked" else "open"
            )
            ranked.append((2, source, description, projected_status))

    campaign_status_rank = {
        "blocked": 3,
        "in_progress": 5,
        "partial": 6,
        "tentative": 7,
        "not_started": 8,
    }
    for campaign in _objects("campaigns", campaigns):
        campaign_id = _text(campaign, "campaign_id")
        components = _objects("campaign components", campaign.get("components", ()))
        for component in components:
            status = _text(component, "status").lower()
            if status in _SATISFIED_COMPONENTS or status not in campaign_status_rank:
                continue
            component_id = _text(component, "component_id")
            description = _text(component, "title", "rationale")
            if campaign_id and component_id and description:
                projected_status = (
                    "blocked_operational"
                    if status == "blocked"
                    else "in_progress" if status in {"in_progress", "partial", "tentative"} else "open"
                )
                ranked.append(
                    (
                        campaign_status_rank[status],
                        f"{campaign_id}/{component_id}",
                        description,
                        projected_status,
                    )
                )

    selected = sorted(ranked, key=lambda item: (item[0], item[1], item[2]))[:3]
    return [
        {
            "id": f"CP{index}",
            "description": description,
            "status": status,
            "source": source,
        }
        for index, (_rank, source, description, status) in enumerate(selected, 1)
    ]
