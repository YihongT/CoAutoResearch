"""Artifact registry, rendering, classification, and cross-artifact checks."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import re
from typing import Any, Iterable, Mapping

try:
    from .v2_contracts import (
        ID_PATTERNS,
        SCHEMA_VERSION,
        canonical_json,
        canonical_json_hash,
        normalize_relative_path,
        schema_errors,
        utc_timestamp_errors,
    )
except ImportError:  # Direct execution from the template UI directory.
    from v2_contracts import (  # type: ignore
        ID_PATTERNS,
        SCHEMA_VERSION,
        canonical_json,
        canonical_json_hash,
        normalize_relative_path,
        schema_errors,
        utc_timestamp_errors,
    )


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
REVIEW_LEVELS = ("light", "standard", "full", "final")


def _entry(
    artifact_type: str,
    schema: str,
    writer: str,
    phase: str,
    *,
    key: str | None = None,
    path: str | None = None,
    path_pattern: str | None = None,
    published_path_pattern: str | None = None,
    paired_markdown: str | bool | None = None,
    paired_markdown_pattern: str | None = None,
    published_paired_markdown_pattern: str | None = None,
    canonical: bool | str = False,
    transport: str | None = None,
) -> dict[str, Any]:
    return {
        "key": key or artifact_type,
        "artifact_type": artifact_type,
        "schema": f"{schema}.schema.json",
        "schema_version": SCHEMA_VERSION,
        "writer": writer,
        "phase": phase,
        "path": path,
        "path_pattern": path_pattern,
        "published_path_pattern": published_path_pattern,
        "paired_markdown": paired_markdown,
        "paired_markdown_pattern": paired_markdown_pattern,
        "published_paired_markdown_pattern": published_paired_markdown_pattern,
        "canonical": canonical,
        "transport": transport,
    }


_ENTRIES = (
    _entry("canonical_revision", "canonical-revision", "service_transaction_applier", "publish", path="research_trajectory/CANONICAL_REVISION.json", canonical=True),
    _entry("project_state", "project-state", "service_transaction_applier_from_reviewed_candidate", "publish", path="research_trajectory/STATE.json", paired_markdown="research_trajectory/STATE.md", canonical=True),
    _entry("current_findings", "current-findings", "service_transaction_applier_from_reviewed_candidate", "publish", path="research_trajectory/CURRENT_FINDINGS.json", paired_markdown="research_trajectory/CURRENT_FINDINGS.md", canonical=True),
    _entry("human_tasks", "human-tasks", "service_transaction_applier_from_reviewed_candidate", "publish", path="research_trajectory/HUMAN_TASKS.json", paired_markdown="research_trajectory/HUMAN_TASKS.md", canonical=True),
    _entry("line", "line", "service_transaction_applier_from_reviewed_candidate", "publish", key="research_line", path_pattern="research_trajectory/lines/L[0-9]{4}.json", paired_markdown_pattern="research_trajectory/lines/L[0-9]{4}.md", canonical=True),
    _entry("campaign", "campaign", "service_transaction_applier_from_reviewed_candidate", "publish", path_pattern="research_trajectory/campaigns/C[0-9]{4}.json", paired_markdown_pattern="research_trajectory/campaigns/C[0-9]{4}.md", canonical=True),
    _entry("target_venue", "target-venue", "service_transaction_applier_from_reviewed_candidate", "publish", path="resources/target_venue/TARGET_VENUE.json", paired_markdown="resources/target_venue/TARGET_VENUE.md", canonical=True),
    _entry("venue_profile", "venue-profile", "service_transaction_applier_from_reviewed_candidate", "publish", path="resources/target_venue/VENUE_PROFILE.json", paired_markdown="resources/target_venue/VENUE_PROFILE.md", canonical=True),
    _entry("trial", "trial", "service_scaffolder_then_agent_status_proposal_then_service_transaction_finalizer", "charter_to_publish", path_pattern="research_trajectory/trials/<trial_id>/TRIAL.json"),
    _entry("plan", "plan", "current_agent", "charter", path_pattern="research_trajectory/trials/<trial_id>/PLAN.json", paired_markdown_pattern="research_trajectory/trials/<trial_id>/PLAN.md"),
    _entry("expert_route", "expert-route", "current_agent", "route", path_pattern="research_trajectory/trials/<trial_id>/EXPERT_ROUTE.json", paired_markdown_pattern="research_trajectory/trials/<trial_id>/EXPERT_ROUTE.md"),
    _entry("report", "report", "current_agent", "distill", path_pattern="research_trajectory/trials/<trial_id>/REPORT.json", paired_markdown_pattern="research_trajectory/trials/<trial_id>/REPORT.md"),
    _entry("result_cards", "result-cards", "current_agent", "distill", path_pattern="research_trajectory/trials/<trial_id>/RESULT_CARDS.json", paired_markdown_pattern="research_trajectory/trials/<trial_id>/RESULT_CARDS.md"),
    _entry("merge_request", "merge-request", "current_agent", "distill_and_stage", path_pattern="research_trajectory/trials/<trial_id>/MERGE_REQUEST.json", paired_markdown_pattern="research_trajectory/trials/<trial_id>/MERGE_REQUEST.md"),
    _entry("staged_update_manifest", "staged-update-manifest", "service_staging_controller", "stage", path_pattern="research_trajectory/.staging/<trial_id>/<stage_id>/STAGED_UPDATE_MANIFEST.json"),
    _entry("human_brief", "human-brief", "current_agent_then_service_publication", "stage_review_publish", path_pattern="research_trajectory/.staging/<trial_id>/<stage_id>/HUMAN_BRIEF.json", published_path_pattern="research_trajectory/trials/<trial_id>/HUMAN_BRIEF.json", paired_markdown_pattern="research_trajectory/.staging/<trial_id>/<stage_id>/HUMAN_BRIEF.md", published_paired_markdown_pattern="research_trajectory/trials/<trial_id>/HUMAN_BRIEF.md", canonical="published_only"),
    _entry("gate_evidence", "gate-evidence", "current_agent", "stage", path_pattern="research_trajectory/.staging/<trial_id>/<stage_id>/GATE_EVIDENCE.json", paired_markdown_pattern="research_trajectory/.staging/<trial_id>/<stage_id>/GATE_EVIDENCE.md"),
    _entry("review_manifest", "review-manifest", "service_review_router", "review_route", path_pattern="research_trajectory/trials/<trial_id>/reviews/REVIEW_MANIFEST.json", paired_markdown_pattern="research_trajectory/trials/<trial_id>/reviews/REVIEW_MANIFEST.md", canonical="closure_metadata"),
    _entry("reviewer_output", "reviewer-output", "reviewer_invocation", "review", path_pattern="research_trajectory/trials/<trial_id>/reviews/<reviewer>.json", paired_markdown_pattern="research_trajectory/trials/<trial_id>/reviews/<reviewer>.md", canonical="closure_metadata"),
    _entry("merge_decision", "merge-decision", "service_merge_evaluator", "after_review_closure", path_pattern="research_trajectory/trials/<trial_id>/MERGE_DECISION.json", paired_markdown_pattern="research_trajectory/trials/<trial_id>/MERGE_DECISION.md", canonical="published_trial_decision"),
    _entry("goal_gate", "goal-gate", "service_gate_evaluator", "after_merge_decision", path_pattern="research_trajectory/trials/<trial_id>/GOAL_GATE.json", paired_markdown_pattern="research_trajectory/trials/<trial_id>/GOAL_GATE.md", canonical="published_global_status"),
    _entry("transaction_manifest", "transaction-manifest", "service_transaction_applier", "publish", path_pattern="research_trajectory/.transactions/<transaction_id>/TRANSACTION_MANIFEST.json", canonical="audit_metadata"),
    _entry("publish_receipt", "publish-receipt", "service_transaction_applier", "committed", path_pattern="research_trajectory/trials/<trial_id>/PUBLISH_RECEIPT.json", paired_markdown_pattern="research_trajectory/trials/<trial_id>/PUBLISH_RECEIPT.md", canonical="publication_proof"),
    _entry("semantic_trace", "semantic-trace", "service_and_agent_trace_adapter", "runtime", transport="existing_research_SSE_stream"),
)

ARTIFACT_REGISTRY = {entry["artifact_type"]: entry for entry in _ENTRIES}

_REPORT_TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent
    / "research_trajectory"
    / "trials"
    / "_TEMPLATE"
    / "REPORT.md.tpl"
)


def artifact_metadata(artifact_type: str) -> dict[str, Any] | None:
    entry = ARTIFACT_REGISTRY.get(artifact_type)
    return deepcopy(entry) if entry else None


def _contract_regex(pattern: str) -> re.Pattern[str]:
    escaped = re.escape(pattern)
    substitutions = {
        re.escape("<trial_id>"): ID_PATTERNS["trial"].pattern[1:-1],
        re.escape("<stage_id>"): ID_PATTERNS["stage"].pattern[1:-1],
        re.escape("<transaction_id>"): ID_PATTERNS["transaction"].pattern[1:-1],
        re.escape("<reviewer>"): r"[^/]+",
        re.escape("L[0-9]{4}"): r"L[0-9]{4}",
        re.escape("C[0-9]{4}"): r"C[0-9]{4}",
    }
    for source, target in substitutions.items():
        escaped = escaped.replace(source, target)
    return re.compile(f"^{escaped}$")


def artifact_path_matches(artifact_type: str, path: str | None) -> bool:
    entry = ARTIFACT_REGISTRY.get(artifact_type)
    if not entry:
        return False
    if entry["transport"]:
        return path is None
    if path is None:
        return False
    try:
        normalized = normalize_relative_path(path)
    except ValueError:
        return False
    if entry["path"] == normalized:
        return True
    for field in ("path_pattern", "published_path_pattern"):
        pattern = entry.get(field)
        if pattern and _contract_regex(pattern).fullmatch(normalized):
            return True
    return False


def validate_artifact(
    value: Any,
    *,
    expected_type: str | None = None,
    path: str | None = None,
    schema_dir: str | Path | None = None,
    engine: str = "auto",
) -> list[str]:
    if not isinstance(value, dict):
        return ["$: artifact must be a JSON object"]
    artifact_type = value.get("artifact_type")
    if expected_type and artifact_type != expected_type:
        return [f"$.artifact_type: expected {expected_type!r}, got {artifact_type!r}"]
    entry = ARTIFACT_REGISTRY.get(str(artifact_type))
    if not entry:
        return [f"$.artifact_type: unknown v2 artifact type {artifact_type!r}"]
    errors = schema_errors(value, entry["schema"], schema_dir=schema_dir, engine=engine)
    errors.extend(utc_timestamp_errors(value))
    if artifact_type == "gate_evidence":
        independent_move = bool(
            value.get("viable_path") is True
            and value.get("concrete_high_value_move") is True
        )
        if independent_move and value.get("operational_blocker") is True:
            errors.append(
                "$: operational_blocker=true is invalid while viable_path and "
                "concrete_high_value_move are both true"
            )
        if independent_move and value.get("human_blocker") is True:
            errors.append(
                "$: human_blocker=true is invalid while viable_path and "
                "concrete_high_value_move are both true"
            )
        if value.get("concrete_high_value_move") is True and value.get(
            "expected_value"
        ) not in {"medium", "high"}:
            errors.append(
                "$: concrete_high_value_move=true requires expected_value to be "
                "medium or high"
            )
        if value.get("operational_blocker") is True:
            extensions = value.get("extensions")
            recovery_condition = (
                extensions.get("recovery_condition")
                if isinstance(extensions, Mapping)
                else None
            )
            if not isinstance(recovery_condition, str) or not recovery_condition.strip():
                errors.append(
                    "$: operational_blocker=true requires a non-empty "
                    "extensions.recovery_condition"
                )
    if path is not None and not artifact_path_matches(str(artifact_type), path):
        errors.append(f"$: {path!r} is not an allowed path for {artifact_type}")
    return errors


def _version_tuple(value: Any) -> tuple[int, ...] | None:
    if not isinstance(value, str) or re.fullmatch(r"[0-9]+(?:\.[0-9]+)*", value) is None:
        return None
    return tuple(int(part) for part in value.split("."))


def _classification(
    kind: str,
    *,
    errors: Iterable[str] = (),
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    quarantine = kind in {"future", "corrupt"}
    return {
        "classification": kind,
        "data": data if kind == "v2" else None,
        "errors": list(errors),
        "quarantine_required": quarantine,
        "markdown_fallback_allowed": kind == "legacy",
    }


def classify_artifact_pair(
    json_path: str | Path,
    *,
    markdown_path: str | Path | None = None,
    expected_type: str | None = None,
    schema_dir: str | Path | None = None,
    engine: str = "auto",
) -> dict[str, Any]:
    json_file = Path(json_path)
    markdown_exists = bool(markdown_path and Path(markdown_path).is_file())
    if not json_file.is_file():
        if markdown_exists:
            return _classification("legacy")
        return _classification("corrupt", errors=[f"missing JSON artifact: {json_file}"])
    try:
        value = json.loads(json_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return _classification("corrupt", errors=[f"invalid JSON artifact: {exc}"])
    if not isinstance(value, dict):
        return _classification("corrupt", errors=["artifact JSON must be an object"])
    version = _version_tuple(value.get("schema_version"))
    current = _version_tuple(SCHEMA_VERSION)
    if version is not None and current is not None and version > current:
        return _classification("future", errors=[f"unsupported schema_version {value['schema_version']}"])
    if value.get("schema_version") != SCHEMA_VERSION:
        return _classification("corrupt", errors=["missing or unsupported v2 schema_version"])
    errors = validate_artifact(
        value,
        expected_type=expected_type,
        schema_dir=schema_dir,
        engine=engine,
    )
    if errors:
        return _classification("corrupt", errors=errors)
    return _classification("v2", data=value)


def _generic_render_markdown(value: Mapping[str, Any], *, body: str = "") -> str:
    artifact_type = str(value.get("artifact_type") or "artifact")
    title = artifact_type.replace("_", " ").title()
    digest = canonical_json_hash(value)
    pretty = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
    prose = str(body or "").strip()
    prose_section = f"{prose}\n\n" if prose else ""
    return (
        f"# {title}\n\n"
        f"{prose_section}"
        f"<!-- coauto-v2 artifact_type={artifact_type} json_sha256={digest} -->\n\n"
        f"```json\n{pretty}\n```\n"
    )


def _report_text(value: Any, *, fallback: str = "Not recorded.") -> str:
    text = str(value or "").strip()
    return text if text else fallback


def _report_bullets(values: Any) -> str:
    if not isinstance(values, list) or not values:
        return "- None recorded."
    return "\n".join(f"- {_report_text(item)}" for item in values)


def _report_procedures(values: Any) -> str:
    if not isinstance(values, list) or not values:
        return "- None recorded."
    rendered: list[str] = []
    for index, item in enumerate(values, start=1):
        procedure = item if isinstance(item, Mapping) else {}
        rendered.append(
            f"{index}. **{_report_text(procedure.get('description'))}**\n"
            f"   - Method or command: {_report_text(procedure.get('command_or_method'))}\n"
            f"   - Result: {_report_text(procedure.get('result'))}"
        )
    return "\n".join(rendered)


def _report_artifacts(values: Any) -> str:
    if not isinstance(values, list) or not values:
        return "- None recorded."
    rendered: list[str] = []
    for item in values:
        artifact = item if isinstance(item, Mapping) else {}
        path = _report_text(artifact.get("path"))
        role = _report_text(artifact.get("role"))
        digest = _report_text(artifact.get("sha256"))
        rendered.append(f"- [{path}]({path}) — {role}; SHA-256: `{digest}`")
    return "\n".join(rendered)


def _report_line_effects(values: Any) -> str:
    if not isinstance(values, list) or not values:
        return "- None recorded."
    rendered: list[str] = []
    for item in values:
        effect = item if isinstance(item, Mapping) else {}
        rendered.append(
            f"- **{_report_text(effect.get('line_id'))}** — "
            f"{_report_text(effect.get('effect'))}: "
            f"{_report_text(effect.get('rationale'))}"
        )
    return "\n".join(rendered)


def _report_campaign_effects(values: Any) -> str:
    if not isinstance(values, list) or not values:
        return "- None recorded."
    rendered: list[str] = []
    for item in values:
        effect = item if isinstance(item, Mapping) else {}
        rendered.append(
            f"- **{_report_text(effect.get('campaign_id'))} / "
            f"{_report_text(effect.get('component_id'))}** — "
            f"{_report_text(effect.get('proposed_status'))}: "
            f"{_report_text(effect.get('rationale'))}"
        )
    return "\n".join(rendered)


def _report_knowledge_capture(value: Any) -> str:
    capture = value if isinstance(value, Mapping) else {}
    lines = [
        f"- Disposition: {_report_text(capture.get('disposition'))}",
        f"- Reason: {_report_text(capture.get('reason'))}",
    ]
    path = str(capture.get("path") or "").strip()
    lines.append(f"- Path: [{path}]({path})" if path else "- Path: None.")
    return "\n".join(lines)


def _report_next_moves(values: Any) -> str:
    if not isinstance(values, list) or not values:
        return "- None recommended."
    rendered: list[str] = []
    for index, item in enumerate(values, start=1):
        move = item if isinstance(item, Mapping) else {}
        rendered.append(
            f"{index}. **{_report_text(move.get('target'))} / "
            f"{_report_text(move.get('move'))}** "
            f"(expected value: {_report_text(move.get('expected_value'))})\n"
            f"   - {_report_text(move.get('question'))}"
        )
    return "\n".join(rendered)


def render_report_markdown(value: Mapping[str, Any]) -> str:
    """Render the authoritative Report JSON as a deterministic readable view."""

    if value.get("artifact_type") != "report":
        raise ValueError("report renderer requires artifact_type='report'")
    try:
        template = _REPORT_TEMPLATE_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"unable to load Report Markdown template: {exc}") from exc

    replacements = {
        "TRIAL_ID": _report_text(value.get("trial_id")),
        "LOCAL_QUESTION_OUTCOME": _report_text(value.get("local_question_outcome")),
        "TRIAL_OUTCOME": _report_text(value.get("trial_outcome")),
        "SUMMARY": _report_text(value.get("summary")),
        "WORK_PERFORMED": _report_bullets(value.get("work_performed")),
        "PROCEDURES": _report_procedures(value.get("procedures")),
        "ARTIFACTS": _report_artifacts(value.get("artifacts")),
        "DEVIATIONS": _report_bullets(value.get("deviations")),
        "FINDINGS": _report_bullets(value.get("findings")),
        "NEGATIVE_RESULTS": _report_bullets(value.get("negative_results")),
        "LIMITATIONS": _report_bullets(value.get("limitations")),
        "INTERPRETATION": _report_text(value.get("interpretation")),
        "LINE_EFFECTS": _report_line_effects(value.get("line_effects")),
        "CAMPAIGN_EFFECTS": _report_campaign_effects(value.get("campaign_effects")),
        "VENUE_IMPACT": _report_text(value.get("venue_impact")),
        "KNOWLEDGE_CAPTURE": _report_knowledge_capture(value.get("knowledge_capture")),
        "RECOMMENDED_NEXT_MOVES": _report_next_moves(value.get("recommended_next_moves")),
    }
    rendered = template
    for key, replacement in replacements.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", replacement)
    unresolved = re.findall(r"{{[A-Z0-9_]+}}", rendered)
    if unresolved:
        raise RuntimeError(
            "Report Markdown template has unresolved placeholders: "
            + ", ".join(sorted(set(unresolved)))
        )
    marker = (
        "<!-- coauto-v2 artifact_type=report "
        f"json_sha256={canonical_json_hash(value)} -->"
    )
    first_break = rendered.find("\n")
    if first_break < 0:
        raise RuntimeError("Report Markdown template must start with a title line")
    return (
        f"{rendered[:first_break]}\n\n{marker}\n\n"
        f"{rendered[first_break + 1:].lstrip()}"
    ).rstrip() + "\n"


def render_markdown(value: Mapping[str, Any], *, body: str = "") -> str:
    if value.get("artifact_type") == "report":
        return render_report_markdown(value)
    return _generic_render_markdown(value, body=body)


_RENDERED_JSON_RE = re.compile(r"\n```json\n(?P<json>.*)\n```\n?$", re.DOTALL)


def extract_rendered_json(markdown: str) -> dict[str, Any]:
    match = _RENDERED_JSON_RE.search(markdown)
    if not match:
        raise ValueError("paired Markdown does not contain the deterministic JSON block")
    value = json.loads(match.group("json"))
    if not isinstance(value, dict):
        raise ValueError("paired Markdown JSON block is not an object")
    return value


def paired_markdown_errors(value: Mapping[str, Any], markdown: str) -> list[str]:
    """Check that a human-readable view agrees with its authoritative JSON.

    Agent-authored Markdown is intentionally allowed to contain explanatory
    prose and reviewer-facing sections.  The final JSON block is the checked
    representation used to prevent the Markdown and machine artifact from
    disagreeing; ``render_markdown`` remains the deterministic service-owned
    fallback when no richer view is required. Reports use a service-owned,
    deterministic readable projection. Historical Report Markdown with the
    former authoritative JSON tail remains valid and read-only compatible.
    """

    if value.get("artifact_type") == "report" and not _RENDERED_JSON_RE.search(markdown):
        try:
            expected = render_report_markdown(value)
        except (RuntimeError, ValueError) as exc:
            return [str(exc)]
        if markdown != expected:
            return [
                "Report Markdown is not the deterministic rendered form of "
                "the authoritative artifact"
            ]
        return []

    try:
        rendered_value = extract_rendered_json(markdown)
    except (ValueError, json.JSONDecodeError) as exc:
        return [str(exc)]
    errors: list[str] = []
    if canonical_json(rendered_value) != canonical_json(value):
        errors.append("paired Markdown JSON disagrees with the authoritative artifact")
    return errors


def _duplicates(values: Iterable[Any]) -> list[Any]:
    seen: set[Any] = set()
    duplicates: list[Any] = []
    for value in values:
        if value in seen and value not in duplicates:
            duplicates.append(value)
        seen.add(value)
    return duplicates


def _artifacts_list(artifacts: Mapping[str, Any] | Iterable[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
    if not isinstance(artifacts, Mapping):
        return list(artifacts)
    result: list[Mapping[str, Any]] = []
    for value in artifacts.values():
        if isinstance(value, list):
            result.extend(item for item in value if isinstance(item, Mapping))
        elif isinstance(value, Mapping):
            result.append(value)
    return result


def result_card_payload_hash(card: Mapping[str, Any]) -> str:
    """Return the service-owned fingerprint for one complete distilled card."""

    return canonical_json_hash(dict(card))


def result_card_immutability_errors(
    lock: Mapping[str, Any], result_cards: Mapping[str, Any]
) -> list[str]:
    """Reject deletion or mutation of any card frozen by an earlier stage."""

    errors: list[str] = []
    version = lock.get("schema_version")
    required = {
        "schema_version",
        "record_type",
        "project_id",
        "trial_id",
        "card_hashes",
    }
    if version == "2":
        required.add("card_payloads")
    if set(lock) != required:
        errors.append("distilled result-card lock has an invalid record shape")
    if version not in {"1", "2"} or lock.get("record_type") != "distilled_result_cards":
        errors.append("distilled result-card lock has an unsupported version or type")
    for field in ("project_id", "trial_id"):
        if lock.get(field) != result_cards.get(field):
            errors.append(f"distilled result-card lock {field} differs from RESULT_CARDS")

    locked = lock.get("card_hashes")
    if not isinstance(locked, Mapping):
        return [*errors, "distilled result-card lock card_hashes must be an object"]
    for card_id, digest in locked.items():
        if not isinstance(card_id, str) or re.fullmatch(r"RC-[0-9]{6}-[0-9]{2}", card_id) is None:
            errors.append(f"distilled result-card lock contains invalid card ID {card_id!r}")
        if not isinstance(digest, str) or re.fullmatch(r"[a-f0-9]{64}", digest) is None:
            errors.append(f"distilled result-card lock contains invalid hash for {card_id}")

    payloads = lock.get("card_payloads")
    if version == "2":
        if not isinstance(payloads, Mapping):
            errors.append("distilled result-card lock card_payloads must be an object")
        else:
            if set(payloads) != set(locked):
                errors.append(
                    "distilled result-card lock payload IDs differ from card_hashes"
                )
            for card_id, payload in payloads.items():
                if not isinstance(payload, Mapping):
                    errors.append(
                        f"distilled result-card lock payload for {card_id} is not an object"
                    )
                    continue
                if payload.get("id") != card_id:
                    errors.append(
                        f"distilled result-card lock payload identity differs for {card_id}"
                    )
                elif locked.get(card_id) != result_card_payload_hash(payload):
                    errors.append(
                        f"distilled result-card lock payload hash differs for {card_id}"
                    )

    cards = result_cards.get("cards")
    if not isinstance(cards, list):
        return [*errors, "RESULT_CARDS cards must be an array"]
    current: dict[str, Mapping[str, Any]] = {}
    for card in cards:
        if not isinstance(card, Mapping):
            errors.append("RESULT_CARDS contains a non-object card")
            continue
        card_id = str(card.get("id", ""))
        if card_id in current:
            errors.append(f"RESULT_CARDS repeats card {card_id}")
        current[card_id] = card
    for card_id, digest in locked.items():
        card = current.get(str(card_id))
        if card is None:
            errors.append(
                f"distilled result card {card_id} was omitted; the service retains its frozen payload and corrections must add a superseding card"
            )
        elif result_card_payload_hash(card) != digest:
            errors.append(
                f"distilled result card {card_id} payload changed; the service retains its frozen payload and corrections must add a superseding card"
            )
    return errors


def build_result_card_lock(
    result_cards: Mapping[str, Any], prior: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    """Build or extend the service record that freezes distilled card payloads."""

    if prior is not None:
        errors = result_card_immutability_errors(prior, result_cards)
        if errors:
            raise ValueError("; ".join(errors))
        hashes = dict(prior["card_hashes"])
        payloads = {
            str(card_id): deepcopy(payload)
            for card_id, payload in dict(prior.get("card_payloads") or {}).items()
        }
    else:
        hashes = {}
        payloads = {}
    cards = result_cards.get("cards")
    if not isinstance(cards, list):
        raise ValueError("RESULT_CARDS cards must be an array")
    for card in cards:
        if not isinstance(card, Mapping) or not isinstance(card.get("id"), str):
            raise ValueError("RESULT_CARDS contains an invalid card")
        card_id = str(card["id"])
        if card_id in hashes and hashes[card_id] != result_card_payload_hash(card):
            raise ValueError(
                f"distilled result card {card_id} payload changed; corrections must add a superseding card"
            )
        hashes[card_id] = result_card_payload_hash(card)
        payloads[card_id] = deepcopy(dict(card))
    return {
        "schema_version": "2",
        "record_type": "distilled_result_cards",
        "project_id": result_cards.get("project_id"),
        "trial_id": result_cards.get("trial_id"),
        "card_hashes": {card_id: hashes[card_id] for card_id in sorted(hashes)},
        "card_payloads": {
            card_id: payloads[card_id] for card_id in sorted(payloads)
        },
    }


def reviewer_card_eligibility_errors(
    reviews: Iterable[Mapping[str, Any]], merge_request: Mapping[str, Any]
) -> list[str]:
    """Validate exact-stage reviewer eligibility assessments before merge."""

    errors: list[str] = []
    requests: dict[str, str] = {}
    for request in merge_request.get("requested_card_decisions", ()):
        if not isinstance(request, Mapping):
            errors.append("Merge Request contains a non-object card decision")
            continue
        card_id = str(request.get("card_id", ""))
        if card_id in requests:
            errors.append(f"Merge Request repeats card eligibility target {card_id}")
        requests[card_id] = str(request.get("decision", ""))

    for review in reviews:
        reviewer = str(review.get("reviewer", ""))
        phase = review.get("phase")
        extensions = review.get("extensions")
        records = extensions.get("card_eligibility") if isinstance(extensions, Mapping) else None
        if phase == "pre_execution":
            if records is not None and records != [] and records != ():
                errors.append(
                    f"pre-execution reviewer {reviewer} must not assess post-stage result cards"
                )
            continue
        if phase not in {"post_stage", "final"}:
            continue
        if not isinstance(records, list):
            errors.append(f"reviewer {reviewer} lacks structured card eligibility assessments")
            continue
        by_id: dict[str, Mapping[str, Any]] = {}
        for record in records:
            if not isinstance(record, Mapping):
                errors.append(f"reviewer {reviewer} has a non-object card eligibility record")
                continue
            if set(record) != {"card_id", "requested_decision", "eligible", "reason"}:
                errors.append(f"reviewer {reviewer} has an invalid card eligibility record shape")
                continue
            card_id = str(record.get("card_id", ""))
            if card_id in by_id:
                errors.append(f"reviewer {reviewer} repeats eligibility for {card_id}")
            by_id[card_id] = record
            if record.get("requested_decision") != requests.get(card_id):
                errors.append(
                    f"reviewer {reviewer} eligibility for {card_id} does not match the exact Merge Request"
                )
            if not isinstance(record.get("eligible"), bool):
                errors.append(f"reviewer {reviewer} eligibility for {card_id} is not boolean")
            if not isinstance(record.get("reason"), str) or not record["reason"].strip():
                errors.append(f"reviewer {reviewer} eligibility for {card_id} lacks a reason")
            if review.get("decision") == "pass" and record.get("eligible") is not True:
                errors.append(f"passing reviewer {reviewer} marked {card_id} ineligible")
        missing = set(requests) - set(by_id)
        extra = set(by_id) - set(requests)
        if missing:
            errors.append(f"reviewer {reviewer} omits requested cards: {sorted(missing)}")
        if extra:
            errors.append(f"reviewer {reviewer} assesses unrequested cards: {sorted(extra)}")
    return errors


def human_brief_goal_gate_errors(
    brief: Mapping[str, Any], gate: Mapping[str, Any]
) -> list[str]:
    """Reject direct contradictions between the neutral brief and computed gate."""

    errors: list[str] = []
    for field in ("project_id", "trial_id"):
        if brief.get(field) != gate.get(field):
            errors.append(f"Human Brief {field} differs from Goal Gate")
    status = gate.get("status")
    outcome = brief.get("trial_outcome")
    action = brief.get("human_action")
    blocking_human = bool(
        isinstance(action, Mapping)
        and action.get("needed") is True
        and action.get("blocking") is True
        and action.get("can_continue_meanwhile") is False
    )
    if status == "needs_human":
        if outcome != "needs_human" or not blocking_human:
            errors.append(
                "needs_human Goal Gate contradicts the Human Brief trial outcome or action"
            )
    elif outcome == "needs_human" or blocking_human:
        errors.append("blocking Human Brief action contradicts the computed Goal Gate")
    if status == "blocked":
        if outcome != "blocked":
            errors.append("blocked Goal Gate contradicts the Human Brief trial outcome")
    elif outcome == "blocked":
        errors.append("blocked Human Brief outcome contradicts the computed Goal Gate")
    if status == "pass" and outcome in {"needs_human", "blocked", "invalidated", "aborted"}:
        errors.append("pass Goal Gate contradicts the Human Brief trial outcome")
    return errors


def scope_boundary_errors(
    plan: Mapping[str, Any],
    report: Mapping[str, Any] | None = None,
    merge_request: Mapping[str, Any] | None = None,
    stage: Mapping[str, Any] | None = None,
) -> list[str]:
    """Reject execution effects outside the reviewed trial charter.

    A useful discovery may motivate another trial, but it cannot silently widen
    the current one.  The agent records that it stopped and proposes the work as
    a normal next move; the current report, merge request, and staged canonical
    operations must remain inside the Plan's declared lines and campaigns.
    """

    errors: list[str] = []
    allowed_lines = {str(item) for item in plan.get("active_line_ids", ())}
    allowed_campaigns = {str(item) for item in plan.get("campaign_ids", ())}

    def reject(kind: str, found: set[str], allowed: set[str]) -> None:
        if outside := found - allowed:
            errors.append(
                f"{kind} exceeds the reviewed Plan scope {sorted(outside)}; "
                "scope expansion must stop and be proposed as a new trial"
            )

    if report is not None:
        reject(
            "report line effects",
            {
                str(item.get("line_id"))
                for item in report.get("line_effects", ())
                if isinstance(item, Mapping) and item.get("line_id")
            },
            allowed_lines,
        )
        reject(
            "report campaign effects",
            {
                str(item.get("campaign_id"))
                for item in report.get("campaign_effects", ())
                if isinstance(item, Mapping) and item.get("campaign_id")
            },
            allowed_campaigns,
        )

        boundary = report.get("extensions", {}).get("scope_boundary")
        if boundary is not None:
            if not isinstance(boundary, Mapping):
                errors.append("report scope_boundary must be an object")
            else:
                proposal = boundary.get("proposed_new_trial")
                if boundary.get("stopped") is not True:
                    errors.append("report scope_boundary must record stopped=true")
                if not isinstance(boundary.get("reason"), str) or not str(
                    boundary.get("reason")
                ).strip():
                    errors.append("report scope_boundary must explain why execution stopped")
                if not isinstance(proposal, Mapping):
                    errors.append("report scope_boundary must propose a new trial")
                else:
                    required = {"target", "move", "question", "expected_value"}
                    if set(proposal) != required or any(
                        not isinstance(proposal.get(field), str)
                        or not str(proposal.get(field)).strip()
                        for field in required
                    ):
                        errors.append(
                            "report scope_boundary proposed_new_trial must contain exactly "
                            "target, move, question, and expected_value"
                        )
                    elif dict(proposal) not in report.get("recommended_next_moves", ()):
                        errors.append(
                            "report scope_boundary proposal must also be a recommended next move"
                        )

    if merge_request is not None:
        reject(
            "merge request line updates",
            {
                str(item.get("line_id"))
                for item in merge_request.get("requested_line_updates", ())
                if isinstance(item, Mapping) and item.get("line_id")
            },
            allowed_lines,
        )
        mentioned_campaigns: set[str] = set()
        for update in merge_request.get("requested_campaign_updates", ()):
            mentioned_campaigns.update(re.findall(r"(?<![A-Za-z0-9])C[0-9]{4}(?![0-9])", str(update)))
        reject("merge request campaign updates", mentioned_campaigns, allowed_campaigns)

    if stage is not None:
        staged_lines: set[str] = set()
        staged_campaigns: set[str] = set()
        for operation in stage.get("operations", ()):
            if not isinstance(operation, Mapping):
                continue
            path = str(operation.get("path", ""))
            if match := re.fullmatch(r"research_trajectory/lines/(L[0-9]{4})\.(?:json|md)", path):
                staged_lines.add(match.group(1))
            if match := re.fullmatch(r"research_trajectory/campaigns/(C[0-9]{4})\.(?:json|md)", path):
                staged_campaigns.add(match.group(1))
        reject("staged line operations", staged_lines, allowed_lines)
        reject("staged campaign operations", staged_campaigns, allowed_campaigns)

    return errors


def working_set_errors(plan: Mapping[str, Any]) -> list[str]:
    """Check mechanical integrity around human-reviewed material relevance."""

    working = plan.get("working_set", {})
    if not isinstance(working, Mapping):
        return ["plan working_set must be an object"]
    exclusions = [
        str(item.get("id"))
        for item in working.get("material_exclusions", ())
        if isinstance(item, Mapping) and item.get("id")
    ]
    errors: list[str] = []
    if duplicates := _duplicates(exclusions):
        errors.append(f"plan repeats material exclusions: {duplicates}")
    included = {
        str(item)
        for field in ("included_trials", "included_result_cards")
        for item in working.get(field, ())
    }
    if overlap := included & set(exclusions):
        errors.append(
            f"plan marks evidence as both included and materially excluded: {sorted(overlap)}"
        )
    return errors


def cross_artifact_errors(
    artifacts: Mapping[str, Any] | Iterable[Mapping[str, Any]],
) -> list[str]:
    """Check core collection/reference invariants after per-artifact validation."""
    values = _artifacts_list(artifacts)
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    errors: list[str] = []
    for value in values:
        artifact_type = value.get("artifact_type")
        if artifact_type not in ARTIFACT_REGISTRY:
            errors.append(f"unknown artifact_type in bundle: {artifact_type!r}")
            continue
        grouped.setdefault(str(artifact_type), []).append(value)

    project_ids = {value.get("project_id") for value in values if value.get("project_id")}
    if len(project_ids) > 1:
        errors.append("bundle contains multiple project_id values")

    trial_ids = {
        value.get("trial_id")
        for value in values
        if "trial_id" in value and value.get("trial_id") is not None
    }
    if len(trial_ids) > 1:
        errors.append("bundle contains multiple trial_id values")

    cards = [card for artifact in grouped.get("result_cards", []) for card in artifact.get("cards", [])]
    card_ids = [card.get("id") for card in cards]
    if duplicates := _duplicates(card_ids):
        errors.append(f"duplicate result card IDs: {duplicates}")
    for artifact in grouped.get("result_cards", []):
        trial_id = artifact.get("trial_id")
        number = str(trial_id or "")[:6]
        for card in artifact.get("cards", []):
            if card.get("source_trial_id") != trial_id:
                errors.append(f"result card {card.get('id')} source_trial_id does not match container")
            if number and not str(card.get("id", "")).startswith(f"RC-{number}-"):
                errors.append(f"result card {card.get('id')} does not match its trial number")
            if card.get("id") in card.get("supersedes", []):
                errors.append(f"result card {card.get('id')} cannot supersede itself")

    findings = grouped.get("current_findings", [])
    if findings:
        finding = findings[0]
        status_sets = {
            "accepted": set(finding.get("accepted_card_ids", [])),
            "qualified": set(finding.get("qualified_card_ids", [])),
            "superseded": set(finding.get("superseded_card_ids", [])),
        }
        for left, right in (("accepted", "qualified"), ("accepted", "superseded"), ("qualified", "superseded")):
            overlap = status_sets[left] & status_sets[right]
            if overlap:
                errors.append(f"current findings {left}/{right} card sets overlap: {sorted(overlap)}")

    lines = grouped.get("line", [])
    line_ids = [line.get("line_id") for line in lines]
    if duplicates := _duplicates(line_ids):
        errors.append(f"duplicate line IDs: {duplicates}")
    if sum(line.get("status") == "active" for line in lines) > 1:
        errors.append("more than one research line has status active")
    for line in lines:
        sets = [
            set(line.get("supporting_cards", [])),
            set(line.get("limiting_cards", [])),
            set(line.get("conflicting_cards", [])),
        ]
        if sets[0] & sets[1] or sets[0] & sets[2] or sets[1] & sets[2]:
            errors.append(f"line {line.get('line_id')} card-role sets overlap")
    states = grouped.get("project_state", [])
    if states and lines and states[0].get("active_line_id") is not None:
        selected = next((line for line in lines if line.get("line_id") == states[0]["active_line_id"]), None)
        if not selected:
            errors.append("project state active_line_id does not reference a supplied line")
        elif selected.get("status") not in {"active", "candidate_final"}:
            errors.append("project state active_line_id is not active or candidate_final")

    campaigns = grouped.get("campaign", [])
    campaign_ids = [campaign.get("campaign_id") for campaign in campaigns]
    if duplicates := _duplicates(campaign_ids):
        errors.append(f"duplicate campaign IDs: {duplicates}")
    known_accepted: set[str] | None = None
    if findings:
        known_accepted = set(findings[0].get("accepted_card_ids", [])) | set(findings[0].get("qualified_card_ids", []))
    for campaign in campaigns:
        component_ids = [component.get("component_id") for component in campaign.get("components", [])]
        if duplicates := _duplicates(component_ids):
            errors.append(f"campaign {campaign.get('campaign_id')} has duplicate components: {duplicates}")
        if known_accepted is not None:
            for component in campaign.get("components", []):
                unknown = set(component.get("satisfying_card_ids", [])) - known_accepted
                if unknown:
                    errors.append(f"campaign {campaign.get('campaign_id')} references non-canonical cards: {sorted(unknown)}")

    manifests = grouped.get("review_manifest", [])
    manifest = manifests[0] if manifests else None
    if manifest:
        minimum = manifest.get("minimum_level")
        selected = manifest.get("selected_level")
        if minimum in REVIEW_LEVELS and selected in REVIEW_LEVELS and REVIEW_LEVELS.index(selected) < REVIEW_LEVELS.index(minimum):
            errors.append("review selected_level is lower than minimum_level")
        required = list(manifest.get("required_reviewers", []))
        omitted = [item.get("reviewer") for item in manifest.get("omitted_reviewers", [])]
        if _duplicates(required) or _duplicates(omitted):
            errors.append("review manifest contains duplicate core reviewers")
        if set(required) & set(omitted):
            errors.append("review manifest required and omitted reviewers overlap")
        if set(required) | set(omitted) != set(CORE_REVIEWERS):
            errors.append("review manifest does not account for every core reviewer")
        if manifest.get("final_candidate") and selected != "final":
            errors.append("final candidate does not use final review level")

    outputs = grouped.get("reviewer_output", [])
    if manifest:
        specialized: set[str] = {
            str(item.get("id")) if str(item.get("id", "")).startswith("specialized:") else f"specialized:{item.get('id')}"
            for item in manifest.get("specialized_reviewers", [])
        }
        expected = {str(item) for item in manifest.get("required_reviewers", [])} | specialized
        actual = {str(output.get("reviewer")) for output in outputs}
        if missing := expected - actual:
            errors.append(f"missing required reviewer outputs: {sorted(missing)}")
        if extra := actual - expected:
            errors.append(f"unexpected reviewer outputs: {sorted(extra)}")
        if len(actual) != len(outputs):
            errors.append("duplicate reviewer outputs")
    scope_by_reviewer = {
        "plan": "plan", "process": "process", "evidence": "evidence",
        "venue_fit": "venue", "manuscript": "manuscript",
        "figure_table": "figure_table", "reference": "reference",
        "final_gate": "final_gate",
    }
    for output in outputs:
        reviewer = output.get("reviewer")
        phase = output.get("phase")
        if reviewer in scope_by_reviewer and output.get("scope") != scope_by_reviewer[reviewer]:
            errors.append(f"reviewer {reviewer} has the wrong scope")
        if phase == "pre_execution":
            if reviewer != "plan" or output.get("stage_id") is not None or output.get("stage_manifest_hash") is not None:
                errors.append("only Plan Review may be pre_execution without a stage hash")
        elif phase in {"post_stage", "final"} and manifest:
            if output.get("stage_id") != manifest.get("stage_id") or output.get("stage_manifest_hash") != manifest.get("stage_manifest_hash"):
                errors.append(f"reviewer {reviewer} is stale for the review manifest stage")
        if output.get("decision") == "pass" and (
            output.get("blockers") or output.get("required_actions") or output.get("unassessed_areas")
        ):
            errors.append(f"reviewer {reviewer} cannot pass with unresolved review content")

    requests = grouped.get("merge_request", [])
    decisions = grouped.get("merge_decision", [])
    request = requests[0] if requests else None
    decision = decisions[0] if decisions else None
    if request:
        requested = [item.get("card_id") for item in request.get("requested_card_decisions", [])]
        if duplicates := _duplicates(requested):
            errors.append(f"merge request repeats card decisions: {duplicates}")
        if cards and set(requested) - set(card_ids):
            errors.append("merge request references result cards outside the supplied trial cards")
        errors.extend(reviewer_card_eligibility_errors(outputs, request))
    if decision:
        decided = [item.get("card_id") for item in decision.get("card_decisions", [])]
        if duplicates := _duplicates(decided):
            errors.append(f"merge decision repeats card decisions: {duplicates}")
        if request and set(decided) != {item.get("card_id") for item in request.get("requested_card_decisions", [])}:
            errors.append("merge decision card set differs from the merge request")
        if manifest and decision.get("stage_manifest_hash") != manifest.get("stage_manifest_hash"):
            errors.append("merge decision uses a stale stage hash")
    stages = grouped.get("staged_update_manifest", [])
    for stage in stages:
        operations = stage.get("operations", [])
        operation_paths = [operation.get("path") for operation in operations]
        if duplicates := _duplicates(operation_paths):
            errors.append(f"staged update repeats operation paths: {duplicates}")
        material_paths = [item.get("path") for item in stage.get("material_inputs", [])]
        if duplicates := _duplicates(material_paths):
            errors.append(f"staged update repeats material inputs: {duplicates}")
        for operation in operations:
            if operation.get("operation") == "create" and operation.get("before_sha256") is not None:
                errors.append(f"create operation {operation.get('path')} has a before hash")
            if operation.get("operation") == "replace" and operation.get("before_sha256") is None:
                errors.append(f"replace operation {operation.get('path')} lacks a before hash")
        if manifest and stage.get("stage_content_hash") != manifest.get("stage_manifest_hash"):
            errors.append("review manifest does not reference the staged content hash")

    plans = grouped.get("plan", [])
    reports = grouped.get("report", [])
    if plans:
        errors.extend(working_set_errors(plans[0]))
        errors.extend(
            scope_boundary_errors(
                plans[0],
                reports[0] if reports else None,
                request,
                stages[0] if stages else None,
            )
        )

    revisions = grouped.get("canonical_revision", [])
    if revisions:
        revision = revisions[0].get("revision")
        for artifact in states + findings:
            if artifact.get("canonical_revision") != revision:
                errors.append(f"{artifact.get('artifact_type')} canonical_revision differs from CANONICAL_REVISION")

    gates = grouped.get("goal_gate", [])
    gate = gates[0] if gates else None
    briefs = grouped.get("human_brief", [])
    if gate and gate.get("status") == "pass" and (
        gate.get("review_level") != "final" or not gate.get("all_required_reviewers_pass")
    ):
        errors.append("pass gate lacks strict final review closure")
    if gate and gate.get("status") == "needs_human" and briefs:
        action = briefs[0].get("human_action", {})
        if not action.get("needed") or not action.get("blocking") or action.get("can_continue_meanwhile") is not False:
            errors.append("needs_human gate lacks a blocking Human Brief action")
    if gate and briefs:
        errors.extend(human_brief_goal_gate_errors(briefs[0], gate))

    venues = grouped.get("target_venue", [])
    if venues and venues[0].get("lock_level") == "locked" and not venues[0].get("locked_by_intervention_id"):
        errors.append("locked venue lacks a formal human intervention ID")

    transactions = grouped.get("transaction_manifest", [])
    for transaction in transactions:
        if transaction.get("target_revision") != transaction.get("base_revision", -1) + 1:
            errors.append("transaction target_revision is not base_revision + 1")
        paths = [operation.get("path") for operation in transaction.get("operations", [])]
        if _duplicates(paths):
            errors.append("transaction repeats a target path")
        for operation in transaction.get("operations", []):
            if operation.get("operation") == "create" and operation.get("before_sha256") is not None:
                errors.append(f"transaction create {operation.get('path')} has a before hash")
            if operation.get("operation") == "replace" and operation.get("before_sha256") is None:
                errors.append(f"transaction replace {operation.get('path')} lacks a before hash")

    receipts = grouped.get("publish_receipt", [])
    for receipt in receipts:
        if receipt.get("published_revision") != receipt.get("base_revision", -1) + 1:
            errors.append("publish receipt revision is not base_revision + 1")
        if decision:
            if decision.get("overall_status") == "rejected":
                errors.append("a rejected merge decision has a publish receipt")
            for field in ("trial_id", "stage_id", "base_revision"):
                if receipt.get(field) != decision.get(field):
                    errors.append(f"publish receipt {field} differs from merge decision")
        if gate and receipt.get("gate_status") != gate.get("status"):
            errors.append("publish receipt gate_status differs from Goal Gate")
        if transactions and receipt.get("transaction_id") != transactions[0].get("transaction_id"):
            errors.append("publish receipt transaction_id differs from transaction manifest")
        if revisions and receipt.get("published_revision") != revisions[0].get("revision"):
            errors.append("publish receipt revision differs from CANONICAL_REVISION")

    return errors
