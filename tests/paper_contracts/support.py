"""Synthetic fixtures for paper-facing contract tests.

These fixtures exercise software invariants only. They are not scientific
results and do not represent real reviewer judgments.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[2]
TEMPLATE = REPO / "templates/default"
os.environ["COAUTO_SCHEMA_DIR"] = str(TEMPLATE / "schemas")
sys.path.insert(0, str(TEMPLATE / "ui"))

from v2_artifacts import result_card_payload_hash, validate_artifact
from v2_contracts import canonical_json_bytes
from v2_merge import MergeEvaluator
from v2_stage import build_stage_manifest

FINDINGS = "research_trajectory/CURRENT_FINDINGS.json"
LINE1 = "research_trajectory/lines/L0001.json"
LINE2 = "research_trajectory/lines/L0002.json"
CARD = "RC-000001-01"
PRIOR = "RC-000000-01"
EXCLUDED = "RC-000000-02"
TRIAL = "000001_test-main-signal"
STAGE = "STAGE-000001-aaaaaaaa"
STAMP = "2026-07-14T12:00:00Z"
PROJECT = "coar-demo"


def example(name: str):
    paths = list(TEMPLATE.rglob(name + ".example.json"))
    if len(paths) != 1:
        raise AssertionError(f"Expected one {name} fixture; got {paths}")
    return json.loads(paths[0].read_text(encoding="utf-8"))


def digest(value) -> str:
    raw = value if isinstance(value, bytes) else canonical_json_bytes(value)
    return hashlib.sha256(raw).hexdigest()


def line(line_id="L0001", status="active", support=None, limit=None):
    value = example("LINE")
    value.update(
        line_id=line_id,
        status=status,
        supporting_cards=list(support or []),
        limiting_cards=list(limit or []),
        conflicting_cards=[],
        current_bottleneck="Synthetic fixture bottleneck; not an observed result.",
    )
    return value


def findings(accepted=None, qualified=None, superseded=None, revision=None):
    if revision is None:
        revision = 1 if accepted or qualified or superseded else 0
    value = example("CURRENT_FINDINGS")
    value.update(
        canonical_revision=revision,
        accepted_card_ids=list(accepted or []),
        qualified_card_ids=list(qualified or []),
        superseded_card_ids=list(superseded or []),
        synthesis=[],
    )
    return value


def deferred_cards():
    value = example("RESULT_CARDS")
    value["cards"][0].update(
        type="process_lesson",
        summary="Synthetic current proposal; deferred, not accepted.",
    )
    return value


def defer_request():
    return [{"card_id": CARD, "decision": "defer", "qualification": ""}]


def case(before=None, after=None, requests=None, cards=None):
    before = deepcopy(before if before is not None else {FINDINGS: findings()})
    after = deepcopy(
        after
        if after is not None
        else {FINDINGS: findings(qualified=[CARD], revision=1), LINE1: line(support=[CARD])}
    )
    cards = deepcopy(cards if cards is not None else example("RESULT_CARDS"))
    request = example("MERGE_REQUEST")
    if requests is not None:
        request["requested_card_decisions"] = deepcopy(requests)
    base_revision = before.get(FINDINGS, {}).get("canonical_revision", 0)
    request["base_revision"] = base_revision
    if FINDINGS in after:
        after[FINDINGS]["canonical_revision"] = base_revision + 1
    for value in after.values():
        if isinstance(value, dict) and value.get("artifact_type") == "line":
            value["last_published_revision"] = base_revision + 1

    candidate_files = {}
    material_files = {}
    prefix = f"research_trajectory/.staging/{TRIAL}/{STAGE}/candidate/"
    for path, value in sorted(after.items()):
        if path in before and before[path] == value:
            continue
        cp = prefix + path
        candidate_files[cp] = canonical_json_bytes(value)
        material_files[cp] = candidate_files[cp]

    trial_root = f"research_trajectory/trials/{TRIAL}"
    stage_root = f"research_trajectory/.staging/{TRIAL}/{STAGE}"
    trial = example("TRIAL")
    trial.update(base_revision=base_revision, stage_id=STAGE)
    plan = example("PLAN")
    plan["primary_local_question"] = "Does this synthetic record satisfy the tested software contract?"
    plan["active_line_ids"] = sorted(
        {
            value["line_id"]
            for value in after.values()
            if isinstance(value, dict) and value.get("artifact_type") == "line"
        }
    )
    report = example("REPORT")
    report.update(
        summary="Synthetic test input; no research was executed.",
        work_performed=["Constructed software-test fixtures only."],
        procedures=[],
        findings=[],
        negative_results=[],
        limitations=["Not scientific evidence."],
        line_effects=[],
        campaign_effects=[],
    )
    brief = example("HUMAN_BRIEF")
    brief["one_line_outcome"] = "Synthetic fixture only; no real research outcome."
    evidence_path = f"{trial_root}/artifacts/results.json"
    evidence_bytes = canonical_json_bytes({"synthetic_fixture": True, "scientific_result": None})
    material_files[evidence_path] = evidence_bytes

    for artifact in (report, cards, brief):
        def bind(value):
            if isinstance(value, dict):
                if value.get("path") == evidence_path and "sha256" in value:
                    value["sha256"] = digest(evidence_bytes)
                for child in value.values():
                    bind(child)
            elif isinstance(value, list):
                for child in value:
                    bind(child)
        bind(artifact)
    for card in cards.get("cards", []):
        card["content_hash"] = result_card_payload_hash(card)

    for name, artifact in {
        "TRIAL": trial,
        "PLAN": plan,
        "EXPERT_ROUTE": example("EXPERT_ROUTE"),
        "REPORT": report,
        "RESULT_CARDS": cards,
        "MERGE_REQUEST": request,
    }.items():
        material_files[f"{trial_root}/{name}.json"] = canonical_json_bytes(artifact)
    for name, artifact in {
        "HUMAN_BRIEF": brief,
        "GATE_EVIDENCE": example("GATE_EVIDENCE"),
    }.items():
        material_files[f"{stage_root}/{name}.json"] = canonical_json_bytes(artifact)

    stage = build_stage_manifest(
        project_id=PROJECT,
        trial_id=TRIAL,
        stage_id=STAGE,
        base_revision=base_revision,
        files=material_files,
        base_files=before,
        created_at=STAMP,
        updated_at=STAMP,
    )
    manifest = example("REVIEW_MANIFEST")
    manifest["stage_manifest_hash"] = stage["stage_content_hash"]
    outputs = []
    for reviewer in manifest["required_reviewers"]:
        value = example("REVIEWER_OUTPUT")
        value.update(
            reviewer=reviewer,
            scope=reviewer,
            review_id=f"RV-000001-{reviewer}-01",
            summary="Synthetic passing review fixture. No scientific review occurred.",
        )
        if reviewer == "plan":
            value.update(phase="pre_execution", stage_id=None, stage_manifest_hash=None)
            value["extensions"] = {}
            value["reviewed_inputs"] = [f"{trial_root}/PLAN.json", f"{trial_root}/EXPERT_ROUTE.json"]
            value["instruction_file"] = "instructions/reviewers/PLAN_REVIEWER.md"
        else:
            value["stage_manifest_hash"] = stage["stage_content_hash"]
            value["extensions"]["card_eligibility"] = [
                {
                    "card_id": item["card_id"],
                    "requested_decision": item["decision"],
                    "eligible": True,
                    "reason": "Synthetic contract fixture only.",
                }
                for item in request["requested_card_decisions"]
            ]
        for item in value["evidence_checked"]:
            if item.get("path") == evidence_path:
                item["sha256"] = digest(evidence_bytes)
        errors = validate_artifact(value, expected_type="reviewer_output")
        assert not errors, errors
        outputs.append(value)

    return dict(
        stage_manifest=stage,
        merge_request=request,
        review_manifest=manifest,
        reviewer_outputs=outputs,
        result_cards=cards,
        candidate_files=candidate_files,
        base_projection=before,
        created_at=STAMP,
    )


def evaluate(bundle, revision=None):
    if revision is None:
        revision = bundle["stage_manifest"]["base_revision"]
    return MergeEvaluator(current_revision=revision).evaluate(**bundle)
