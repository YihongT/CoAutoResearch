"""Deterministic registry-backed expert routing for the v2 kernel."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from copy import deepcopy
from pathlib import Path
import re
from typing import Any

try:
    from .v2_contracts import SCHEMA_VERSION, normalize_relative_path
except ImportError:  # Direct test/import from templates/default/ui.
    from v2_contracts import SCHEMA_VERSION, normalize_relative_path  # type: ignore


ROUTER_VERSION = "2.0.0"
GENERAL_DOMAIN = "general_research"
MOVE_PACKS = {
    "explore": "moves/FRAMING.md",
    "acquire": "moves/RESOURCE_ACQUISITION.md",
    "build": "moves/METHOD_BUILD.md",
    "test": "moves/EXPERIMENT_TEST.md",
    "diagnose": "moves/FAILURE_DIAGNOSIS.md",
    "compare": "moves/EXPERIMENT_TEST.md",
    "synthesize": "moves/SYNTHESIS.md",
    "repair": "moves/REVIEW_REPAIR.md",
    "decide": "moves/FRAMING.md",
    "package": "moves/MANUSCRIPT_PACKAGING.md",
    "profile": "moves/FRAMING.md",
}
_DOMAIN_ID = re.compile(r"^[a-z][a-z0-9_]{1,63}$")
_REGISTRY_FIELDS = {
    "schema_version",
    "domain_id",
    "display_name",
    "version",
    "enabled_by_default",
    "triggers",
    "claim_types",
    "evidence_standards",
    "campaign_templates",
    "method_pack_recommendations",
    "specialized_reviewers",
    "incompatibilities",
    "safety_constraints",
    "extensions",
}
_FORBIDDEN_AUTHORITY_FIELDS = {
    "canonical_writes",
    "gate",
    "gate_priority",
    "lifecycle",
    "review_router",
    "schema_validation",
    "transaction",
}


class ExpertRouterError(ValueError):
    """A registry or route request violates the stable router contract."""


def _string_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, (list, tuple)):
        raise ExpertRouterError(f"{field} must be a list of strings")
    result = list(value)
    if not all(isinstance(item, str) and item.strip() for item in result):
        raise ExpertRouterError(f"{field} must contain non-empty strings")
    if len(result) != len(set(result)):
        raise ExpertRouterError(f"{field} must not contain duplicates")
    return result


def validate_domain_registry(value: Mapping[str, Any]) -> list[str]:
    """Return deterministic errors for one domain registry."""

    if not isinstance(value, Mapping):
        return ["registry must be an object"]
    errors: list[str] = []
    keys = set(value)
    if forbidden := keys & _FORBIDDEN_AUTHORITY_FIELDS:
        errors.append(
            "domain registry attempts to override kernel authority: "
            + ", ".join(sorted(forbidden))
        )
    if unknown := keys - _REGISTRY_FIELDS:
        errors.append("unknown registry fields: " + ", ".join(sorted(unknown)))
    required = {
        "schema_version",
        "domain_id",
        "display_name",
        "version",
        "enabled_by_default",
        "triggers",
        "claim_types",
        "campaign_templates",
        "method_pack_recommendations",
        "specialized_reviewers",
        "extensions",
    }
    if missing := required - keys:
        errors.append("missing registry fields: " + ", ".join(sorted(missing)))
    if value.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version must be {SCHEMA_VERSION}")
    domain_id = value.get("domain_id")
    if not isinstance(domain_id, str) or _DOMAIN_ID.fullmatch(domain_id) is None:
        errors.append("domain_id is invalid")
    for field in ("display_name", "version"):
        if not isinstance(value.get(field), str) or not value[field].strip():
            errors.append(f"{field} must be a non-empty string")
    if not isinstance(value.get("enabled_by_default"), bool):
        errors.append("enabled_by_default must be a boolean")
    for field in (
        "triggers",
        "claim_types",
        "evidence_standards",
        "method_pack_recommendations",
        "incompatibilities",
        "safety_constraints",
    ):
        if field not in value:
            continue
        try:
            _string_list(value[field], field)
        except ExpertRouterError as exc:
            errors.append(str(exc))
    for field in ("campaign_templates", "specialized_reviewers"):
        item = value.get(field)
        if not isinstance(item, list):
            errors.append(f"{field} must be a list")
    if not isinstance(value.get("extensions"), Mapping):
        errors.append("extensions must be an object")
    return errors


def load_domain_registries(instructions_root: str | Path) -> dict[str, dict[str, Any]]:
    """Load every valid installed domain pack through one stable interface."""

    root = Path(instructions_root).resolve(strict=True)
    domains = root / "domains"
    result: dict[str, dict[str, Any]] = {}
    for registry_path in sorted(domains.glob("*/registry.json")):
        try:
            import json

            value = json.loads(registry_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, ValueError) as exc:
            raise ExpertRouterError(f"invalid domain registry {registry_path}: {exc}") from exc
        errors = validate_domain_registry(value)
        if errors:
            raise ExpertRouterError(
                f"invalid domain registry {registry_path}: " + "; ".join(errors)
            )
        domain_id = str(value["domain_id"])
        if registry_path.parent.name != domain_id:
            raise ExpertRouterError(f"domain directory does not match domain_id: {domain_id}")
        if not (registry_path.parent / "DOMAIN.md").is_file():
            raise ExpertRouterError(f"domain instruction is missing: {domain_id}")
        if domain_id in result:
            raise ExpertRouterError(f"duplicate domain registry: {domain_id}")
        result[domain_id] = deepcopy(value)
    return result


def _ordered_unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def compute_expert_route(
    inputs: Mapping[str, Any], registries: Mapping[str, Mapping[str, Any]]
) -> dict[str, Any]:
    """Select move/domain/method/venue/risk packs without changing kernel policy."""

    if not isinstance(inputs, Mapping) or not isinstance(registries, Mapping):
        raise TypeError("route inputs and registries must be mappings")
    for domain_id, registry in registries.items():
        errors = validate_domain_registry(registry)
        if errors or registry.get("domain_id") != domain_id:
            raise ExpertRouterError(
                f"invalid registry {domain_id}: " + "; ".join(errors or ["identity mismatch"])
            )
    if GENERAL_DOMAIN not in registries:
        raise ExpertRouterError("the general_research domain pack is required")

    move = inputs.get("move")
    if move not in MOVE_PACKS:
        raise ExpertRouterError(f"unsupported research move: {move!r}")
    requested = _string_list(inputs.get("requested_domain_ids", ()), "requested_domain_ids")
    enabled = sorted(
        domain_id
        for domain_id, registry in registries.items()
        if registry.get("enabled_by_default") is True
    )
    selected = _ordered_unique([GENERAL_DOMAIN, *enabled, *requested])
    available = [domain_id for domain_id in selected if domain_id in registries]
    unavailable = [domain_id for domain_id in selected if domain_id not in registries]
    impacts = inputs.get("missing_pack_impacts", {})
    if not isinstance(impacts, Mapping):
        raise ExpertRouterError("missing_pack_impacts must be an object")

    venue_profile = inputs.get("venue_profile")
    if venue_profile is not None:
        if not isinstance(venue_profile, str):
            raise ExpertRouterError("venue_profile must be a relative path or null")
        venue_profile = normalize_relative_path(venue_profile)
    venue_configured = bool(inputs.get("venue_configured"))
    missing = [
        {
            "pack": f"domain:{domain_id}",
            "impact": str(impacts.get(domain_id) or "Specialized standards are unavailable; narrow claims or seek human expertise."),
        }
        for domain_id in unavailable
    ]
    if venue_configured and not venue_profile:
        missing.append(
            {
                "pack": "venue_profile",
                "impact": "Venue-specific standards cannot be claimed until a profile is configured.",
            }
        )

    standards = _string_list(inputs.get("required_standards", ()), "required_standards")
    for domain_id in available:
        registry = registries[domain_id]
        standards.extend(registry.get("evidence_standards", ()))
        standards.extend(registry.get("safety_constraints", ()))
    method_packs = [
        normalize_relative_path(path)
        for path in _string_list(inputs.get("method_packs", ()), "method_packs")
    ]
    risk_flags = _string_list(inputs.get("risk_flags", ()), "risk_flags")
    review_triggers = _string_list(
        inputs.get("review_triggers", ()), "review_triggers"
    )
    level = inputs.get("requested_review_level", "standard")
    if level not in {"light", "standard", "full", "final"}:
        raise ExpertRouterError("requested_review_level is invalid")

    required_identity = ("project_id", "trial_id", "created_at", "updated_at")
    for field in required_identity:
        if not isinstance(inputs.get(field), str) or not inputs[field]:
            raise ExpertRouterError(f"{field} must be a non-empty string")
    return {
        "schema_version": SCHEMA_VERSION,
        "artifact_type": "expert_route",
        "project_id": inputs["project_id"],
        "created_at": inputs["created_at"],
        "updated_at": inputs["updated_at"],
        "extensions": {"router_version": ROUTER_VERSION},
        "trial_id": inputs["trial_id"],
        "move_pack": MOVE_PACKS[str(move)],
        "domain_packs": [f"domains/{domain_id}/DOMAIN.md" for domain_id in available],
        "method_packs": _ordered_unique(method_packs),
        "venue_profile": venue_profile,
        "risk_flags": risk_flags,
        "required_standards": _ordered_unique(standards),
        "missing_packs": missing,
        "review_triggers": review_triggers,
        "requested_review_level": level,
    }
