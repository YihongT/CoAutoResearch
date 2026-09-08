"""Typed v2 Research Board readers with an explicitly non-canonical v1 fallback."""

from __future__ import annotations

from contextlib import nullcontext
import json
from pathlib import Path
import re
from typing import Any, Iterable

try:
    from .v2_artifacts import validate_artifact
    from .v2_paths import UnsafeProjectPath, resolve_project_path
    from .v2_review_router import REVIEW_STEMS
    from .v2_transaction import coherent_read, transaction_health
except ImportError:  # Direct test/import from templates/default/ui.
    from v2_artifacts import validate_artifact  # type: ignore
    from v2_paths import UnsafeProjectPath, resolve_project_path  # type: ignore
    from v2_review_router import REVIEW_STEMS  # type: ignore
    from v2_transaction import coherent_read, transaction_health  # type: ignore


LEGACY_REVIEWERS = (
    ("plan", "PLAN_REVIEW.md"),
    ("process", "PROCESS_REVIEW.md"),
    ("evidence", "EVIDENCE_REVIEW.md"),
    ("venue_fit", "VENUE_FIT_REVIEW.md"),
    ("manuscript", "MANUSCRIPT_REVIEW.md"),
    ("figure_table", "FIGURE_TABLE_REVIEW.md"),
    ("reference", "REFERENCE_REVIEW.md"),
    ("final_gate", "FINAL_GATE_REVIEW.md"),
)
_TRIAL_NUMBER = re.compile(r"^0*(\d+)")


def _schema_dir(root: Path) -> Path:
    installed = root / "schemas"
    if (installed / "common.schema.json").is_file():
        return installed
    return Path(__file__).resolve().parents[3] / "schemas"


def _relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def _safe_file(root: Path, relative: str) -> Path | None:
    try:
        path = resolve_project_path(root, relative, must_exist=False)
    except (UnsafeProjectPath, FileNotFoundError, OSError):
        return None
    return path if path.is_file() else None


def _load(
    root: Path,
    relative: str,
    expected_type: str,
    diagnostics: list[str],
) -> dict[str, Any] | None:
    path = _safe_file(root, relative)
    if path is None:
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        diagnostics.append(f"{relative}: invalid JSON ({exc})")
        return None
    errors = validate_artifact(
        value,
        expected_type=expected_type,
        path=relative,
        schema_dir=_schema_dir(root),
    )
    if errors:
        diagnostics.append(f"{relative}: " + "; ".join(errors[:5]))
        return None
    return value


def _trial_sort(path: Path) -> tuple[int, str]:
    match = _TRIAL_NUMBER.match(path.name)
    return (int(match.group(1)) if match else -1, path.name)


def _has_trial_artifact(trial_dir: Path) -> bool:
    if any((trial_dir / name).is_file() for name in ("TRIAL.json", "PLAN.md", "REPORT.md", "REVIEW.md")):
        return True
    reviews = trial_dir / "reviews"
    if not reviews.is_dir() or reviews.is_symlink():
        return False
    try:
        return any(item.is_file() and not item.is_symlink() for item in reviews.iterdir())
    except OSError:
        return False


def _trial_dirs(root: Path) -> list[Path]:
    trials = root / "research_trajectory" / "trials"
    if not trials.is_dir():
        return []
    try:
        return sorted(
            (
                item
                for item in trials.iterdir()
                if item.is_dir()
                and not item.is_symlink()
                and not item.name.startswith("_")
                and _has_trial_artifact(item)
            ),
            key=_trial_sort,
        )
    except OSError:
        return []


def _first_prose(text: str) -> str:
    for line in text.splitlines():
        clean = line.strip().lstrip("-* ").strip()
        if clean and not clean.startswith("#") and ":" not in clean[:32]:
            return clean[:500]
    return ""


def _legacy_status(path: Path) -> str:
    if not path.is_file():
        return "missing"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return "unreadable"
    match = re.search(r"^\s*(?:Decision|Gate impact):\s*`?([^`\n]+)", text, re.I | re.M)
    if not match:
        return "unknown"
    value = match.group(1).strip().lower().replace("-", "_").split()[0]
    return "pass" if value in {"pass", "passed", "all_passed"} else value


def _legacy_trial(root: Path, trial_dir: Path) -> dict[str, Any]:
    plan = trial_dir / "PLAN.md"
    report = trial_dir / "REPORT.md"
    plan_text = plan.read_text(encoding="utf-8", errors="replace") if plan.is_file() else ""
    report_text = report.read_text(encoding="utf-8", errors="replace") if report.is_file() else ""
    statuses = {key: _legacy_status(trial_dir / "reviews" / filename) for key, filename in LEGACY_REVIEWERS}
    required = [key for key, _ in LEGACY_REVIEWERS]
    artifacts = []
    for candidate in (plan, report, trial_dir / "REVIEW.md"):
        if candidate.is_file():
            artifacts.append(_relative(root, candidate))
    return {
        "trial_id": trial_dir.name,
        "lifecycle_state": "legacy_closed" if report.is_file() else "legacy_open",
        "target": "legacy",
        "move": "legacy",
        "primary_local_question": _first_prose(plan_text),
        "trial_outcome": "legacy_derived",
        "one_line_outcome": _first_prose(report_text),
        "result_cards": [],
        "merge_status": "legacy",
        "published_revision": None,
        "review_level": "legacy_fixed_eight",
        "required_reviewers": required,
        "reviewer_statuses": statuses,
        "omitted_reviewers": [],
        "specialized_reviewers": [],
        "expert_route": {"legacy": True, "missing_packs": []},
        "line_effects": [],
        "campaign_effects": [],
        "venue_impact": "",
        "human_action": None,
        "artifact_paths": artifacts,
        "legacy": True,
    }


def _review_statuses(
    root: Path,
    trial_id: str,
    manifest: dict[str, Any] | None,
    diagnostics: list[str],
) -> tuple[list[str], dict[str, str]]:
    if not manifest:
        return [], {}
    required = [str(item) for item in manifest.get("required_reviewers", [])]
    specialized = {
        f"specialized:{item.get('id')}": str(item.get("output_path"))
        for item in manifest.get("specialized_reviewers", [])
        if isinstance(item, dict) and item.get("id") and item.get("output_path")
    }
    required.extend(specialized)
    statuses: dict[str, str] = {}
    for reviewer in required:
        relative = specialized.get(reviewer)
        if relative is None:
            stem = REVIEW_STEMS.get(reviewer)
            if stem is None:
                diagnostics.append(f"unknown required reviewer id: {reviewer}")
                statuses[reviewer] = "missing"
                continue
            relative = f"research_trajectory/trials/{trial_id}/reviews/{stem}.json"
        output = _load(root, relative, "reviewer_output", diagnostics)
        if not output:
            statuses[reviewer] = "missing"
            continue
        if (
            output.get("stage_id") != manifest.get("stage_id")
            or output.get("stage_manifest_hash") != manifest.get("stage_manifest_hash")
        ) and output.get("phase") != "pre_execution":
            statuses[reviewer] = "stale"
        else:
            statuses[reviewer] = str(output.get("decision") or "unknown")
    return required, statuses


def _artifact_paths(root: Path, trial_dir: Path) -> list[str]:
    names = (
        "TRIAL.json", "PLAN.json", "EXPERT_ROUTE.json", "REPORT.json",
        "RESULT_CARDS.json", "MERGE_REQUEST.json", "HUMAN_BRIEF.json",
        "MERGE_DECISION.json", "GOAL_GATE.json", "PUBLISH_RECEIPT.json",
    )
    result = [_relative(root, trial_dir / name) for name in names if (trial_dir / name).is_file()]
    reviews = trial_dir / "reviews"
    if reviews.is_dir():
        result.extend(
            _relative(root, item)
            for item in sorted(reviews.glob("*.json"))
            if item.is_file() and not item.is_symlink()
        )
    return result


def _v2_trial(root: Path, trial_dir: Path, diagnostics: list[str]) -> dict[str, Any] | None:
    trial_id = trial_dir.name
    prefix = f"research_trajectory/trials/{trial_id}"
    trial = _load(root, f"{prefix}/TRIAL.json", "trial", diagnostics)
    if not trial:
        return None
    plan = _load(root, f"{prefix}/PLAN.json", "plan", diagnostics)
    route = _load(root, f"{prefix}/EXPERT_ROUTE.json", "expert_route", diagnostics)
    report = _load(root, f"{prefix}/REPORT.json", "report", diagnostics)
    cards_artifact = _load(root, f"{prefix}/RESULT_CARDS.json", "result_cards", diagnostics)
    decision = _load(root, f"{prefix}/MERGE_DECISION.json", "merge_decision", diagnostics)
    receipt = _load(root, f"{prefix}/PUBLISH_RECEIPT.json", "publish_receipt", diagnostics)
    brief = _load(root, f"{prefix}/HUMAN_BRIEF.json", "human_brief", diagnostics) if receipt else None
    manifest = _load(root, f"{prefix}/reviews/REVIEW_MANIFEST.json", "review_manifest", diagnostics)
    required, statuses = _review_statuses(root, trial_id, manifest, diagnostics)

    card_decisions = {
        item.get("card_id"): item.get("decision")
        for item in (decision or {}).get("card_decisions", [])
        if isinstance(item, dict)
    } if receipt else {}
    cards = []
    for card in (cards_artifact or {}).get("cards", []):
        if not isinstance(card, dict):
            continue
        copy = dict(card)
        copy["canonical_status"] = card_decisions.get(card.get("id"), "proposed")
        cards.append(copy)

    accepted_summary = next(
        (
            str(card.get("summary") or "")
            for card in cards
            if card.get("canonical_status") in {"accept", "accept_with_qualification"}
        ),
        "",
    )
    one_line = str((brief or {}).get("one_line_outcome") or accepted_summary)
    if not one_line and report:
        one_line = str(report.get("summary") or "")
    return {
        "trial_id": trial_id,
        "lifecycle_state": trial.get("lifecycle_state"),
        "target": (plan or trial).get("target"),
        "move": (plan or trial).get("move"),
        "primary_local_question": (plan or {}).get("primary_local_question"),
        "trial_outcome": (brief or report or trial).get("trial_outcome"),
        "one_line_outcome": one_line,
        "result_cards": cards,
        "merge_status": (decision or {}).get("overall_status", "proposed"),
        "published_revision": (receipt or {}).get("published_revision"),
        "review_level": (manifest or trial).get("selected_level", trial.get("review_level")),
        "required_reviewers": required,
        "reviewer_statuses": statuses,
        "omitted_reviewers": list((manifest or {}).get("omitted_reviewers", [])),
        "specialized_reviewers": list((manifest or {}).get("specialized_reviewers", [])),
        "expert_route": route or {"missing_packs": [], "unavailable": True},
        "line_effects": (report or {}).get("line_effects", []),
        "campaign_effects": (report or {}).get("campaign_effects", []),
        "venue_impact": (report or {}).get("venue_impact", ""),
        "human_action": (brief or {}).get("human_action"),
        "artifact_paths": _artifact_paths(root, trial_dir),
        "legacy": False,
    }


def _all_cards(trials: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for trial in trials:
        for card in trial.get("result_cards", []):
            if isinstance(card, dict) and card.get("id"):
                result[str(card["id"])] = card
    return result


def _cards(ids: Iterable[Any], known: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return [known[str(card_id)] for card_id in ids if str(card_id) in known]


def _legacy_board(root: Path, trials: list[dict[str, Any]], health: dict[str, Any]) -> dict[str, Any]:
    state_path = root / "research_trajectory" / "STATE.md"
    state = state_path.read_text(encoding="utf-8", errors="replace") if state_path.is_file() else ""
    status_match = re.search(r"^\s*Status:\s*(.+)$", state, re.I | re.M)
    status_note = status_match.group(1).strip() if status_match else "No legacy gate status found."
    latest = trials[-1] if trials else None
    return {
        "schema_version": "2.0-readonly-legacy",
        "canonical_revision": None,
        "global_status": "legacy",
        "status_reasons": [f"Read-only v1 fallback; legacy text reported: {status_note}"],
        "active_line": None,
        "candidate_lines": [],
        "current_claims": [],
        "supporting_evidence": [],
        "qualified_evidence": [],
        "limiting_evidence": [],
        "negative_evidence": [],
        "campaign_readiness": [],
        "critical_path": [],
        "current_bottleneck": "",
        "target_venue": None,
        "venue_readiness": {"status": "legacy", "gaps": []},
        "latest_published_trial": latest,
        "next_move": None,
        "human_action": None,
        "recovery_state": health,
        "legacy": True,
    }


def _v2_board(
    root: Path,
    trials: list[dict[str, Any]],
    revision: dict[str, Any],
    health: dict[str, Any],
    diagnostics: list[str],
) -> dict[str, Any]:
    state = _load(root, "research_trajectory/STATE.json", "project_state", diagnostics)
    findings = _load(root, "research_trajectory/CURRENT_FINDINGS.json", "current_findings", diagnostics)
    lines = []
    lines_dir = root / "research_trajectory" / "lines"
    if lines_dir.is_dir():
        for path in sorted(lines_dir.glob("L[0-9][0-9][0-9][0-9].json")):
            value = _load(root, _relative(root, path), "line", diagnostics)
            if value:
                lines.append(value)
    campaigns = []
    campaigns_dir = root / "research_trajectory" / "campaigns"
    if campaigns_dir.is_dir():
        for path in sorted(campaigns_dir.glob("C[0-9][0-9][0-9][0-9].json")):
            value = _load(root, _relative(root, path), "campaign", diagnostics)
            if value:
                campaigns.append(value)
    venue = _load(root, "resources/target_venue/TARGET_VENUE.json", "target_venue", diagnostics)
    profile = _load(root, "resources/target_venue/VENUE_PROFILE.json", "venue_profile", diagnostics)

    revision_number = revision.get("revision")
    coherent = bool(
        state
        and findings
        and state.get("canonical_revision") == revision_number
        and findings.get("canonical_revision") == revision_number
    )
    published_id = str(revision.get("published_trial_id") or "")
    latest = next((item for item in trials if item.get("trial_id") == published_id), None)
    gate = None
    # A Goal Gate is canonical only when the current canonical revision names
    # a published trial.  Revision zero intentionally has no Goal Gate.  Never
    # interpret the human-facing STATE.md projection (or any stale pre-v2 path)
    # as JSON merely because an older state artifact retained such a pointer.
    gate_path = (
        f"research_trajectory/trials/{published_id}/GOAL_GATE.json"
        if published_id
        else ""
    )
    if gate_path:
        gate = _load(root, gate_path, "goal_gate", diagnostics)
    receipt_ok = bool(
        coherent
        and latest
        and latest.get("published_revision") == revision_number
        and gate
        and gate.get("canonical_revision") == revision_number
        and gate.get("trial_id") == published_id
    )

    known_cards = _all_cards(trials)
    active = next((line for line in lines if line.get("line_id") == (state or {}).get("active_line_id")), None)
    accepted = (findings or {}).get("accepted_card_ids", [])
    qualified = (findings or {}).get("qualified_card_ids", [])
    limiting_ids = list((active or {}).get("limiting_cards", [])) + list((active or {}).get("conflicting_cards", []))
    negative = [
        card for card in known_cards.values()
        if card.get("id") in set(accepted) | set(qualified)
        and (card.get("type") == "negative_evidence" or card.get("effect") in {"limits", "conflicts"})
    ]
    current_claims = list((active or {}).get("claim_hierarchy", []))
    if not current_claims:
        current_claims = list((findings or {}).get("synthesis", []))
    campaign_readiness = [
        {
            "campaign_id": campaign.get("campaign_id"),
            "title": campaign.get("title"),
            "status": campaign.get("aggregate_status"),
            "components": campaign.get("components", []),
            "blockers": campaign.get("current_blockers", []),
        }
        for campaign in campaigns
    ]
    target = None if venue is None else {
        "name": venue.get("target_venue"),
        "audience": venue.get("audience"),
        "article_type": venue.get("article_type"),
        "lock_level": venue.get("lock_level"),
        "alternatives": venue.get("alternative_venues", []),
    }
    venue_gaps = []
    if venue and venue.get("target_venue") and not profile:
        venue_gaps.append("Venue profile is missing or invalid.")
    if profile and not profile.get("seed_papers"):
        venue_gaps.append("No representative seed papers are recorded.")
    recovery_state = dict(health)
    recovery_state["canonical_coherent"] = coherent
    recovery_state["diagnostics"] = diagnostics[:20]
    if not coherent:
        recovery_state["recovery_required"] = True

    return {
        "schema_version": "2.0",
        "canonical_revision": revision_number,
        "global_status": gate.get("status") if receipt_ok else "recovery_required" if not coherent else "unpublished",
        "status_reasons": gate.get("reasons", []) if receipt_ok else ["No receipt-backed Goal Gate exists for the current revision."],
        "active_line": active,
        "candidate_lines": [
            line for line in lines
            if line.get("status") in {"candidate", "paused", "candidate_final"}
            and line.get("line_id") != (state or {}).get("active_line_id")
        ],
        "current_claims": current_claims,
        "supporting_evidence": _cards((active or {}).get("supporting_cards", accepted), known_cards),
        "qualified_evidence": _cards(qualified, known_cards),
        "limiting_evidence": _cards(limiting_ids, known_cards),
        "negative_evidence": negative,
        "campaign_readiness": campaign_readiness,
        "critical_path": (state or {}).get("critical_path", []),
        "current_bottleneck": (active or {}).get("current_bottleneck", ""),
        "target_venue": target,
        "venue_readiness": {
            "status": (profile or {}).get("profile_status", "not_configured" if not venue or not venue.get("target_venue") else "missing"),
            "seed_paper_count": len((profile or {}).get("seed_papers", [])),
            "gaps": venue_gaps,
        },
        "latest_published_trial": latest if receipt_ok else None,
        "next_move": gate.get("next_move") if receipt_ok else None,
        "human_action": (latest or {}).get("human_action") if receipt_ok else None,
        "recovery_state": recovery_state,
        "legacy": False,
    }


def build_v2_overview(project_root: str | Path) -> dict[str, Any]:
    """Return additive overview fields without treating proposals as canonical."""

    root = Path(project_root).resolve(strict=True)
    diagnostics: list[str] = []
    try:
        health = transaction_health(root)
    except Exception as exc:
        health = {
            "lock_state": "unknown",
            "recovery_required": True,
            "last_transaction_id": None,
            "last_published_revision": None,
            "diagnostic": str(exc),
        }
    read_lock = coherent_read(root) if health.get("lock_state") != "unknown" else nullcontext()
    with read_lock:
        revision = _load(root, "research_trajectory/CANONICAL_REVISION.json", "canonical_revision", diagnostics)
        trials: list[dict[str, Any]] = []
        for trial_dir in _trial_dirs(root):
            trial = _v2_trial(root, trial_dir, diagnostics)
            trials.append(trial if trial else _legacy_trial(root, trial_dir))
        legacy = revision is None and not (root / "research_trajectory" / "CANONICAL_REVISION.json").exists()
        board = _legacy_board(root, trials, health) if legacy else (
            _v2_board(root, trials, revision, health, diagnostics)
            if revision
            else {
                **_legacy_board(root, trials, health),
                "schema_version": "2.0",
                "global_status": "recovery_required",
                "status_reasons": ["CANONICAL_REVISION.json exists but is invalid."],
                "recovery_state": {**health, "recovery_required": True, "diagnostics": diagnostics[:20]},
                "legacy": False,
            }
        )
    return {
        "legacy": legacy,
        "research_board": board,
        "trials_v2": trials,
        "transaction_health": health,
        "v2_diagnostics": diagnostics,
    }


def read_v2_goal_gate(project_root: str | Path) -> dict[str, Any]:
    """Read the receipt-backed Goal Gate for the current canonical revision.

    The legacy UI gate reader parses a prose section in ``STATE.md``.  V2's
    deterministic Markdown projection intentionally has no such section: the
    authoritative gate is the validated JSON artifact owned by the published
    trial named in ``CANONICAL_REVISION.json``.  Keep this reader targeted so
    frequent session polling does not scan every historical trial.
    """

    root = Path(project_root).resolve(strict=True)
    diagnostics: list[str] = []
    try:
        health = transaction_health(root)
    except Exception as exc:
        health = {
            "lock_state": "unknown",
            "recovery_required": True,
            "diagnostic": str(exc),
        }
    read_lock = coherent_read(root) if health.get("lock_state") != "unknown" else nullcontext()
    with read_lock:
        revision = _load(
            root,
            "research_trajectory/CANONICAL_REVISION.json",
            "canonical_revision",
            diagnostics,
        )
        if not revision:
            return {
                "protocol_version": "2.0",
                "exists": False,
                "status": "recovery_required",
                "raw_status": "recovery_required",
                "overall_status": "recovery_required",
                "response_to_human": "",
                "response_to_human_source": "",
                "reviewer_statuses": {},
                "reviewer_raw_statuses": {},
                "missing_reviewers": [],
                "incomplete_reviewers": [],
                "all_reviewers_passed": False,
                "consistency_blockers": diagnostics[:20]
                or ["CANONICAL_REVISION.json is missing or invalid."],
                "critical_path": {"exists": False, "items": []},
                "summary": "The v2 canonical revision cannot be trusted.",
                "path": "research_trajectory/CANONICAL_REVISION.json",
                "receipt_backed": False,
            }

        revision_number = revision.get("revision")
        published_id = str(revision.get("published_trial_id") or "")
        if not published_id:
            clean_revision_zero = revision_number == 0
            return {
                "protocol_version": "2.0",
                "exists": False,
                "status": "continue" if clean_revision_zero else "recovery_required",
                "raw_status": "continue" if clean_revision_zero else "recovery_required",
                "overall_status": "continue" if clean_revision_zero else "recovery_required",
                "response_to_human": "",
                "response_to_human_source": "",
                "reviewer_statuses": {},
                "reviewer_raw_statuses": {},
                "missing_reviewers": [],
                "incomplete_reviewers": [],
                "all_reviewers_passed": False,
                "consistency_blockers": []
                if clean_revision_zero
                else ["A nonzero canonical revision does not name its published trial."],
                "critical_path": {"exists": False, "items": []},
                "summary": (
                    "No Goal Gate exists before the first published v2 trial."
                    if clean_revision_zero
                    else "The current v2 revision has no trustworthy published-trial binding."
                ),
                "path": "",
                "receipt_backed": False,
            }

        prefix = f"research_trajectory/trials/{published_id}"
        gate_path = f"{prefix}/GOAL_GATE.json"
        gate = _load(root, gate_path, "goal_gate", diagnostics)
        receipt = _load(
            root, f"{prefix}/PUBLISH_RECEIPT.json", "publish_receipt", diagnostics
        )
        manifest = _load(
            root,
            f"{prefix}/reviews/REVIEW_MANIFEST.json",
            "review_manifest",
            diagnostics,
        )
        state = _load(
            root, "research_trajectory/STATE.json", "project_state", diagnostics
        )
        required, reviewer_statuses = _review_statuses(
            root, published_id, manifest, diagnostics
        )
        missing = [key for key in required if reviewer_statuses.get(key) == "missing"]
        incomplete = [
            key for key in required if reviewer_statuses.get(key) != "pass"
        ]
        receipt_backed = bool(
            gate
            and receipt
            and receipt.get("trial_id") == published_id
            and receipt.get("published_revision") == revision_number
            and gate.get("trial_id") == published_id
            and gate.get("canonical_revision") == revision_number
            and state
            and state.get("canonical_revision") == revision_number
        )
        blockers = list(diagnostics[:20])
        if not receipt_backed:
            blockers.append(
                "The current Goal Gate is not bound to the canonical revision by a valid publish receipt."
            )
        status = (
            str(gate.get("status") or "continue")
            if receipt_backed and gate
            else "recovery_required"
        )
        all_reviewers_passed = bool(
            receipt_backed
            and gate
            and gate.get("all_required_reviewers_pass") is True
            and not incomplete
        )
        reasons = [str(item) for item in (gate or {}).get("reasons", [])]
        critical_items = list((state or {}).get("critical_path", []))
        return {
            "protocol_version": "2.0",
            "exists": bool(gate and receipt_backed),
            "status": status,
            "raw_status": status,
            "overall_status": status,
            "response_to_human": str((gate or {}).get("response_to_human") or ""),
            "response_to_human_source": gate_path if gate else "",
            "reviewer_statuses": reviewer_statuses,
            "reviewer_raw_statuses": dict(reviewer_statuses),
            "required_reviewers": required,
            "omitted_reviewers": list((manifest or {}).get("omitted_reviewers", [])),
            "missing_reviewers": missing,
            "incomplete_reviewers": incomplete,
            "all_reviewers_passed": all_reviewers_passed,
            "consistency_blockers": blockers,
            "critical_path": {
                "exists": bool(state),
                "items": critical_items,
                "incomplete": any(
                    isinstance(item, dict)
                    and item.get("status") != "complete"
                    for item in critical_items
                ),
                "blocked_on_human": [
                    item
                    for item in critical_items
                    if isinstance(item, dict) and item.get("status") == "blocked_human"
                ],
            },
            "summary": "\n".join(reasons)
            or ("Receipt-backed v2 Goal Gate." if receipt_backed else blockers[-1]),
            "path": gate_path,
            "receipt_backed": receipt_backed,
            "canonical_revision": revision_number,
            "published_trial_id": published_id,
            "next_move": (gate or {}).get("next_move"),
        }


def read_trial_detail(project_root: str | Path, trial_id: str) -> dict[str, Any] | None:
    root = Path(project_root).resolve(strict=True)
    try:
        trial_dir = resolve_project_path(root, f"research_trajectory/trials/{trial_id}", must_exist=True)
    except (UnsafeProjectPath, FileNotFoundError, OSError):
        return None
    if not trial_dir.is_dir() or trial_dir.is_symlink():
        return None
    diagnostics: list[str] = []
    return _v2_trial(root, trial_dir, diagnostics) or _legacy_trial(root, trial_dir)
