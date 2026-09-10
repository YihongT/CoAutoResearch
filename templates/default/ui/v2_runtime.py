"""Fail-closed production composition for one sequential CoAutoResearch v2 trial.

The runtime deliberately owns no policy.  It joins the existing path guard,
stage hasher, review router/closure, merge evaluator, pure gate, artifact
contracts, and recoverable transaction applier into the lifecycle calls a
server needs: ``initialize_trial``, ``approve_plan``, ``stage_trial``, and
``complete_trial``.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import replace
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil
from typing import Any

try:
    from . import v2_transaction as _transaction
    from .v2_artifacts import (
        ARTIFACT_REGISTRY,
        artifact_path_matches,
        build_result_card_lock,
        cross_artifact_errors,
        human_brief_goal_gate_errors,
        paired_markdown_errors,
        render_markdown,
        result_card_immutability_errors,
        result_card_payload_hash,
        reviewer_card_eligibility_errors,
        scope_boundary_errors,
        validate_artifact,
    )
    from .v2_contracts import (
        SCHEMA_VERSION,
        canonical_json_bytes,
        default_schema_dir,
        normalize_relative_path,
        require_id,
        valid_id,
        utc_z_timestamp,
    )
    from .v2_critical_path import derive_critical_path
    from .v2_gate import evaluate_goal_gate
    from .v2_expert_router import MOVE_PACKS, load_domain_registries
    from .v2_guard import (
        GuardError,
        agent_write_changes,
        audit_and_restore_agent_writes,
        capture_agent_baseline,
        load_agent_baseline,
    )
    from .v2_merge import MergeEvaluator, prepare_card_decisions
    from .v2_paths import PathRegistry
    from .v2_review_router import REVIEW_STEMS, compute_review_route
    from .v2_stage import (
        compute_stage_content_hash,
        evaluate_review_closure,
        new_stage_id,
        stage_from_project,
        stage_manifest_path,
        verify_stage_from_project,
    )
    from .v2_venue import venue_readiness
except ImportError:  # Direct imports from templates/default/ui.
    import v2_transaction as _transaction  # type: ignore
    from v2_artifacts import (  # type: ignore
        ARTIFACT_REGISTRY,
        artifact_path_matches,
        build_result_card_lock,
        cross_artifact_errors,
        human_brief_goal_gate_errors,
        paired_markdown_errors,
        render_markdown,
        result_card_immutability_errors,
        result_card_payload_hash,
        reviewer_card_eligibility_errors,
        scope_boundary_errors,
        validate_artifact,
    )
    from v2_contracts import (  # type: ignore
        SCHEMA_VERSION,
        canonical_json_bytes,
        default_schema_dir,
        normalize_relative_path,
        require_id,
        valid_id,
        utc_z_timestamp,
    )
    from v2_critical_path import derive_critical_path  # type: ignore
    from v2_gate import evaluate_goal_gate  # type: ignore
    from v2_expert_router import MOVE_PACKS, load_domain_registries  # type: ignore
    from v2_guard import (  # type: ignore
        GuardError,
        agent_write_changes,
        audit_and_restore_agent_writes,
        capture_agent_baseline,
        load_agent_baseline,
    )
    from v2_merge import MergeEvaluator, prepare_card_decisions  # type: ignore
    from v2_paths import PathRegistry  # type: ignore
    from v2_review_router import REVIEW_STEMS, compute_review_route  # type: ignore
    from v2_stage import (  # type: ignore
        compute_stage_content_hash,
        evaluate_review_closure,
        new_stage_id,
        stage_from_project,
        stage_manifest_path,
        verify_stage_from_project,
    )
    from v2_venue import venue_readiness  # type: ignore


_TRIAL_INPUTS = {
    "TRIAL.json": ("trial", False),
    "PLAN.json": ("plan", True),
    "EXPERT_ROUTE.json": ("expert_route", True),
    "REPORT.json": ("report", True),
    "RESULT_CARDS.json": ("result_cards", True),
    "MERGE_REQUEST.json": ("merge_request", True),
}
_STAGE_INPUTS = {
    "HUMAN_BRIEF.json": ("human_brief", True),
    "GATE_EVIDENCE.json": ("gate_evidence", True),
}
_CANONICAL_JSON = (
    "research_trajectory/STATE.json",
    "research_trajectory/CURRENT_FINDINGS.json",
    "research_trajectory/HUMAN_TASKS.json",
    "resources/target_venue/TARGET_VENUE.json",
    "resources/target_venue/VENUE_PROFILE.json",
)
_CANONICAL_JSON_GLOBS = (
    ("research_trajectory/lines", "L[0-9][0-9][0-9][0-9].json"),
    ("research_trajectory/campaigns", "C[0-9][0-9][0-9][0-9].json"),
)
_MANUSCRIPT_PATHS = (
    "manuscript/BLUEPRINT.md",
    "manuscript/PAPER_PLAN.md",
)
_GATE_SIGNAL_FIELDS = (
    "killed_by_human",
    "human_blocker",
    "budget_reached",
    "operational_blocker",
    "viable_path",
    "concrete_high_value_move",
    "expected_value",
)
_PLAN_APPROVAL_NAME = "PLAN_APPROVAL.json"
_PLAN_BINDING_KEYS = {"plan_revision", "plan_sha256"}
_MANUSCRIPT_CARD_TYPES = {
    "positive_evidence",
    "negative_evidence",
    "diagnostic_insight",
    "boundary_condition",
    "claim_revision",
    "method_decision",
}
_ACCEPTED_CARD_DECISIONS = {
    "accept",
    "accept_with_qualification",
    "supersede",
}
_BLUEPRINT_STUB = re.compile(r"Status:\s*pre-results stub", re.IGNORECASE)
_MARKDOWN_HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.MULTILINE)


class V2RuntimeError(RuntimeError):
    """A service invariant prevents review or publication."""


class V2RecoveryError(V2RuntimeError):
    """Service state cannot be reconstructed from trustworthy retained bytes."""


class InvalidTrialStageError(V2RuntimeError):
    """A Trial cannot enter execution with a different stage assignment."""


def validate_trial_stage_binding(trial: Mapping[str, Any], stage_id: str) -> None:
    assignment = trial.get("extensions", {}).get("service_assignment")
    if trial.get("stage_id") not in {None, stage_id} or (
        isinstance(assignment, Mapping)
        and assignment.get("stage_id") not in {None, stage_id}
    ):
        raise InvalidTrialStageError(
            "TRIAL.json stage_id or extensions.service_assignment.stage_id "
            f"does not match {stage_id}. Correct the assignment during planning "
            "and obtain a fresh Plan Review before execution; retain existing evidence."
        )


class StalePlanApprovalError(V2RuntimeError):
    """A trusted service update changed material after Plan Approval."""

    def __init__(self, paths: list[str]) -> None:
        self.paths = sorted(set(paths))
        super().__init__(
            "plan approval is stale after trusted service material changed: "
            + str(self.paths)
        )


RUN_PHASES = {"plan", "prepare", "repair", "review", "terminal"}
RETRYABLE_RUN_STATUSES = {"agent_failed", "interrupted"}
SAFETY_RUN_STATUSES = {
    "protocol_violation",
    "recovery_required",
    "stage_resolution_required",
    "repair_limit_reached",
}


def transition_run_state(
    current: Mapping[str, Any], changes: Mapping[str, Any]
) -> dict[str, Any]:
    """Apply one run-state transition and enforce the control-plane meanings."""

    target = dict(current)
    target.update(changes)
    phase = str(target.get("phase") or "")
    status = str(target.get("status") or "")
    if phase not in RUN_PHASES:
        raise V2RuntimeError(f"unknown v2 run phase: {phase or '<empty>'}")
    if not status:
        raise V2RuntimeError("v2 run status is empty")
    if status in RETRYABLE_RUN_STATUSES and phase == "terminal":
        raise V2RuntimeError(
            f"retryable status {status} must retain its exact nonterminal phase"
        )
    if status in SAFETY_RUN_STATUSES - RETRYABLE_RUN_STATUSES and phase != "terminal":
        raise V2RuntimeError(
            f"safety status {status} must stop at the terminal control boundary"
        )
    previous_repairs = int(current.get("repair_count") or 0)
    next_repairs = int(target.get("repair_count") or 0)
    if next_repairs < previous_repairs and not bool(changes.get("reset_repair_budget")):
        raise V2RuntimeError("repair_count cannot decrease outside explicit recovery")
    if next_repairs > previous_repairs and not (
        phase == "plan"
        and status == "plan_ready"
        and str(target.get("stage_id") or "") != str(current.get("stage_id") or "")
    ):
        raise V2RuntimeError(
            "repair_count may increase only for a new material repair stage"
        )
    target.pop("reset_repair_budget", None)
    return target


def _digest(data: bytes) -> str:
    return sha256(data).hexdigest()


def _status(status: str, **values: Any) -> dict[str, Any]:
    return {"status": status, **values}


def _json(data: bytes, context: str) -> dict[str, Any]:
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise V2RuntimeError(f"{context} is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise V2RuntimeError(f"{context} must be a JSON object")
    return value


def build_review_manifest(
    *,
    project_id: str,
    trial_id: str,
    stage_manifest: Mapping[str, Any],
    route_inputs: Mapping[str, Any],
    created_at: str | None = None,
) -> dict[str, Any]:
    """Build the authoritative exact-stage Review Manifest without writing it."""

    if stage_manifest.get("project_id") != project_id:
        raise V2RuntimeError("stage project_id differs from the service project")
    if stage_manifest.get("trial_id") != trial_id:
        raise V2RuntimeError("stage trial_id differs from the requested trial")
    route = compute_review_route(route_inputs)
    timestamp = created_at or utc_z_timestamp()
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "artifact_type": "review_manifest",
        "project_id": project_id,
        "created_at": timestamp,
        "updated_at": timestamp,
        "extensions": {},
        "trial_id": trial_id,
        **route,
        "stage_id": stage_manifest.get("stage_id"),
        "stage_manifest_hash": stage_manifest.get("stage_content_hash"),
    }
    errors = validate_artifact(manifest, expected_type="review_manifest")
    if errors:
        raise V2RuntimeError("invalid derived Review Manifest: " + "; ".join(errors))
    return manifest


def review_output_paths(
    trial_id: str,
    review_manifest: Mapping[str, Any],
    overrides: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Return the exact JSON output path for every routed reviewer."""

    prefix = f"research_trajectory/trials/{trial_id}/reviews/"
    paths: dict[str, str] = {}
    requested = dict(overrides or {})
    for reviewer in review_manifest.get("required_reviewers", ()):
        key = str(reviewer)
        raw = requested.pop(key, f"{prefix}{REVIEW_STEMS[key]}.json")
        paths[key] = normalize_relative_path(raw)
    for item in review_manifest.get("specialized_reviewers", ()):
        key = str(item.get("id", ""))
        reviewer = key if key.startswith("specialized:") else f"specialized:{key}"
        raw = requested.pop(reviewer, str(item.get("output_path", "")))
        if raw.startswith("reviews/"):
            raw = f"research_trajectory/trials/{trial_id}/{raw}"
        paths[reviewer] = normalize_relative_path(raw)
    if requested:
        raise V2RuntimeError(
            f"review path overrides contain unrouted reviewers: {sorted(requested)}"
        )
    if len(set(paths.values())) != len(paths):
        raise V2RuntimeError("two routed reviewers share one output path")
    for reviewer, path in paths.items():
        if (
            not path.startswith(prefix)
            or "/" in path[len(prefix) :]
            or not path.endswith(".json")
        ):
            raise V2RuntimeError(
                f"reviewer {reviewer} output must be one JSON file directly under reviews/"
            )
    return paths


class TransactionManager:
    """Small adapter around the durable transaction module."""

    def __init__(self, project_root: str | Path) -> None:
        self.root = Path(project_root).resolve(strict=True)

    def current_revision(self) -> int:
        return _transaction.current_revision(self.root)

    def health(self) -> dict[str, Any]:
        return _transaction.transaction_health(self.root)

    def recover(self) -> list[dict[str, Any]]:
        actions = _transaction.recover_incomplete_transactions(self.root)
        health = self.health()
        if not health["recovery_required"]:
            self._clean_runtime_sources()
        return actions

    def _scratch(self, stage_id: str) -> Path:
        relative = f"research_trajectory/.transactions/.runtime-{stage_id}"
        return _transaction.resolve_project_path(self.root, relative)

    def _clean_runtime_sources(self) -> None:
        transactions = _transaction.resolve_project_path(
            self.root, "research_trajectory/.transactions"
        )
        if not transactions.exists():
            return
        for path in transactions.iterdir():
            if not path.name.startswith(".runtime-STAGE-"):
                continue
            if path.is_symlink() or not path.is_dir():
                raise _transaction.RecoveryRequiredError(
                    f"untrustworthy runtime transaction source: {path.name}"
                )
            shutil.rmtree(path)
        _transaction._fsync_directory(transactions)

    def publish(
        self,
        *,
        project_id: str,
        trial_id: str,
        stage_id: str,
        base_revision: int,
        stage_operations: list[dict[str, Any]],
        all_stage_operations: Mapping[str, Mapping[str, Any]],
        service_files: Mapping[str, bytes],
        gate_status: str,
        validator: Any = None,
    ) -> dict[str, Any]:
        """Materialize service sources privately and publish one transaction."""

        scratch = self._scratch(stage_id)
        if scratch.exists() or scratch.is_symlink():
            raise _transaction.RecoveryRequiredError(
                "stale private runtime sources require startup recovery"
            )
        _transaction._ensure_directory(scratch, 0o700)
        operations = [dict(item) for item in stage_operations]
        selected = {str(item["path"]): item for item in operations}
        try:
            for index, (target, data) in enumerate(sorted(service_files.items())):
                target = normalize_relative_path(target)
                staged = all_stage_operations.get(target)
                if staged is not None:
                    if target not in selected:
                        raise V2RuntimeError(
                            f"derived service artifact was omitted by Merge Decision: {target}"
                        )
                    candidate = _transaction.resolve_project_path(
                        self.root, str(staged["candidate_path"]), must_exist=True
                    ).read_bytes()
                    if candidate != data:
                        raise V2RuntimeError(
                            f"candidate and reviewed service artifact differ: {target}"
                        )
                    continue
                target_path = _transaction.resolve_project_path(self.root, target)
                is_trial_transition = target == (
                    f"research_trajectory/trials/{trial_id}/TRIAL.json"
                )
                if target_path.is_symlink() or (
                    target_path.exists() and not is_trial_transition
                ):
                    raise V2RuntimeError(
                        f"unreceipted service publication target already exists: {target}"
                    )
                if is_trial_transition and not target_path.is_file():
                    raise V2RuntimeError(
                        "the reviewed Trial proposal is missing before service publication"
                    )
                source = scratch / f"{index:04d}.bin"
                _transaction._atomic_write(source, data, 0o600)
                operations.append(
                    {
                        "path": target,
                        "operation": "replace" if is_trial_transition else "create",
                        "before_sha256": (
                            _digest(target_path.read_bytes())
                            if is_trial_transition
                            else None
                        ),
                        "after_sha256": _digest(data),
                        "after_source_path": source.relative_to(self.root).as_posix(),
                    }
                )
            operations.sort(key=lambda item: str(item["path"]))
            return _transaction.publish(
                self.root,
                project_id=project_id,
                trial_id=trial_id,
                stage_id=stage_id,
                base_revision=base_revision,
                operations=operations,
                gate_status=gate_status,
                validator=validator,
            )
        finally:
            if scratch.is_dir() and not scratch.is_symlink():
                shutil.rmtree(scratch)
                _transaction._fsync_directory(scratch.parent)


class V2Runtime:
    """Server-facing orchestration for one sequential v2 trial at a time."""

    def __init__(
        self,
        project_root: str | Path,
        project_id: str,
        *,
        guard_root: str | Path | None = None,
    ) -> None:
        self.root = Path(project_root).resolve(strict=True)
        if not self.root.is_dir():
            raise V2RuntimeError("project root is not a directory")
        self.project_id = require_id("project", project_id)
        self.guard_root = Path(guard_root).resolve() if guard_root else None
        installed = self.root / "schemas"
        self.schema_dir = (
            installed.resolve()
            if (installed / "common.schema.json").is_file()
            else default_schema_dir()
        )
        self.transactions = TransactionManager(self.root)
        self._audited_review_guard: tuple[
            tuple[str, str, str, PathRegistry], dict[str, Any]
        ] | None = None

    @staticmethod
    def _normalized_match_text(value: Any) -> str:
        return " ".join(re.sub(r"[\W_]+", " ", str(value or "").lower()).split())

    def _required_domain_ids(
        self,
        plan: Mapping[str, Any] | None = None,
        registries: Mapping[str, Mapping[str, Any]] | None = None,
    ) -> set[str]:
        """Derive installed specialization requirements from stable project inputs."""

        required = {"general_research"}
        context_parts: list[str] = []
        project = self.root / "PROJECT.md"
        if project.is_file() and not project.is_symlink():
            try:
                context_parts.append(project.read_text(encoding="utf-8"))
            except (OSError, UnicodeError):
                pass
        if plan:
            # Route from the research scope, not metadata that may explain why
            # an unrelated domain pack was deliberately excluded.
            context_parts.extend(
                str(plan.get(field) or "")
                for field in (
                    "primary_local_question", "why_now", "critical_path_target",
                    "minimum_useful_output", "expected_human_outcome",
                )
            )
        context = f" {self._normalized_match_text(' '.join(context_parts))} "
        if registries is None:
            registries = load_domain_registries(self.root / "instructions")
        target_name = ""
        target_path = self.root / "resources/target_venue/TARGET_VENUE.json"
        if target_path.is_file() and not target_path.is_symlink():
            try:
                target = _json(target_path.read_bytes(), target_path.as_posix())
            except (OSError, UnicodeError, V2RuntimeError):
                target = {}
            target_name = self._normalized_match_text(target.get("target_venue"))
        for domain_id, registry in registries.items():
            extensions = registry.get("extensions", {})
            if not isinstance(extensions, Mapping):
                raise V2RuntimeError(
                    f"domain registry extensions must be an object: {domain_id}"
                )
            terms = extensions.get("project_match_terms", [])
            venues = extensions.get("venue_match_names", [])
            if (
                not isinstance(terms, list)
                or not all(isinstance(item, str) and item.strip() for item in terms)
                or not isinstance(venues, list)
                or not all(isinstance(item, str) and item.strip() for item in venues)
            ):
                raise V2RuntimeError(
                    f"domain registry matching extensions are invalid: {domain_id}"
                )
            if any(
                f" {self._normalized_match_text(term)} " in context for term in terms
            ) or any(
                self._normalized_match_text(venue) == target_name for venue in venues
            ):
                required.add(domain_id)
        return required

    def _validate_expert_route(
        self, route: Mapping[str, Any], plan: Mapping[str, Any]
    ) -> None:
        try:
            registries = load_domain_registries(self.root / "instructions")
        except (OSError, ValueError) as exc:
            raise V2RuntimeError(f"installed domain registry is invalid: {exc}") from exc
        expected_paths = {
            f"domains/{domain_id}/DOMAIN.md": domain_id
            for domain_id in registries
        }
        errors: list[str] = []
        expected_move_pack = MOVE_PACKS.get(str(plan.get("move") or ""))
        actual_move_pack = str(route.get("move_pack") or "")
        if expected_move_pack is None:
            errors.append(f"PLAN selects an unsupported move: {plan.get('move')}")
        elif actual_move_pack != expected_move_pack:
            errors.append(
                "EXPERT_ROUTE move pack does not match PLAN move: "
                f"expected {expected_move_pack}, got {actual_move_pack or '<empty>'}"
            )
        raw_paths = route.get("domain_packs", ())
        selected: set[str] = set()
        if not isinstance(raw_paths, list):
            errors.append("EXPERT_ROUTE domain_packs must be an array")
            raw_paths = []
        for raw in raw_paths:
            domain_id = expected_paths.get(str(raw))
            if domain_id is None:
                errors.append(f"EXPERT_ROUTE selects an unknown domain pack: {raw}")
                continue
            selected.add(domain_id)
        required = self._required_domain_ids(plan, registries)
        unavailable = sorted(required - set(registries))
        if unavailable:
            missing = {
                str(item.get("pack"))
                for item in route.get("missing_packs", ())
                if isinstance(item, Mapping)
            }
            unrecorded = [
                domain_id
                for domain_id in unavailable
                if f"domain:{domain_id}" not in missing
            ]
            if unrecorded:
                errors.append(
                    "EXPERT_ROUTE omitted unavailable required domain packs: "
                    + ", ".join(unrecorded)
                )
        omitted = sorted((required & set(registries)) - selected)
        if omitted:
            errors.append(
                "EXPERT_ROUTE omitted required installed domain packs: "
                + ", ".join(omitted)
            )
        standards = set(route.get("required_standards", ()))
        required_standards = {
            str(item)
            for domain_id in selected
            for field in ("evidence_standards", "safety_constraints")
            for item in registries[domain_id].get(field, ())
        }
        if missing_standards := sorted(required_standards - standards):
            errors.append(
                "EXPERT_ROUTE omitted registered domain standards: "
                + "; ".join(missing_standards)
            )
        if errors:
            raise V2RuntimeError("; ".join(errors))

    def _path(self, relative: str, *, must_exist: bool = False) -> Path:
        return _transaction.resolve_project_path(
            self.root, relative, must_exist=must_exist
        )

    def _load_artifact(
        self,
        relative: str,
        artifact_type: str,
        *,
        paired: bool = False,
    ) -> dict[str, Any]:
        path = self._path(relative, must_exist=True)
        if path.is_symlink() or not path.is_file():
            raise V2RuntimeError(f"artifact is not a regular file: {relative}")
        value = _json(path.read_bytes(), relative)
        errors = validate_artifact(
            value,
            expected_type=artifact_type,
            path=relative,
            schema_dir=self.schema_dir,
        )
        if value.get("project_id") not in {None, self.project_id}:
            errors.append("project_id differs from the runtime project")
        if paired:
            markdown_relative = relative[:-5] + ".md"
            markdown_path = self._path(markdown_relative, must_exist=True)
            try:
                markdown = markdown_path.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                errors.append(f"paired Markdown cannot be read: {exc}")
            else:
                errors.extend(paired_markdown_errors(value, markdown))
        if errors:
            raise V2RuntimeError(f"{relative}: " + "; ".join(errors))
        return value

    def _load_candidate_artifact(
        self,
        relative: str,
        canonical_relative: str,
        artifact_type: str,
        *,
        paired: bool = False,
    ) -> dict[str, Any]:
        """Validate staged candidate bytes against their canonical destination."""

        path = self._path(relative, must_exist=True)
        if path.is_symlink() or not path.is_file():
            raise V2RuntimeError(f"candidate artifact is not a regular file: {relative}")
        value = _json(path.read_bytes(), relative)
        errors = validate_artifact(
            value,
            expected_type=artifact_type,
            path=canonical_relative,
            schema_dir=self.schema_dir,
        )
        if value.get("project_id") not in {None, self.project_id}:
            errors.append("project_id differs from the runtime project")
        if paired:
            markdown_path = self._path(relative[:-5] + ".md", must_exist=True)
            try:
                markdown = markdown_path.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                errors.append(f"paired Markdown cannot be read: {exc}")
            else:
                errors.extend(paired_markdown_errors(value, markdown))
        if errors:
            raise V2RuntimeError(f"{relative}: " + "; ".join(errors))
        return value

    def _write_artifact(self, relative: str, value: Mapping[str, Any]) -> None:
        path = self._path(relative)
        _transaction._atomic_write(path, canonical_json_bytes(value), 0o600)

    def _write_pair(self, relative: str, value: Mapping[str, Any]) -> None:
        self._write_artifact(relative, value)
        self._write_bytes(relative[:-5] + ".md", render_markdown(value).encode("utf-8"))

    def _write_bytes(self, relative: str, data: bytes) -> None:
        _transaction._atomic_write(self._path(relative), data, 0o600)

    def _prepare_artifact_pairs(self, specs: Mapping[str, tuple[str, bool]]) -> list[str]:
        """Validate the whole mutable bundle, then repair its derived views.

        Call only after the phase write guard passes and before these bytes are
        frozen. JSON stays byte-for-byte unchanged; valid richer Markdown stays.
        """
        errors: list[str] = []
        loaded = {}
        for relative, (artifact_type, paired) in specs.items():
            try:
                candidate_marker = "/candidate/"
                if candidate_marker in relative:
                    canonical = relative.split(candidate_marker, 1)[1]
                    value = self._load_candidate_artifact(relative, canonical, artifact_type)
                else:
                    value = self._load_artifact(relative, artifact_type)
                loaded[relative] = (value, paired)
            except (OSError, ValueError, V2RuntimeError, _transaction.TransactionError) as exc:
                errors.append(str(exc))
        if errors:
            return errors
        for relative, (value, paired) in loaded.items():
            if not paired:
                continue
            markdown_relative = relative[:-5] + ".md"
            try:
                path = self._path(markdown_relative)
                if path.is_symlink():
                    raise V2RuntimeError(f"paired Markdown is a symlink: {markdown_relative}")
                markdown = path.read_text(encoding="utf-8") if path.is_file() else ""
                if paired_markdown_errors(value, markdown):
                    self._write_bytes(markdown_relative, render_markdown(value).encode("utf-8"))
            except (OSError, ValueError, V2RuntimeError, _transaction.TransactionError) as exc:
                errors.append(f"{markdown_relative}: {exc}")
        return errors

    def _execution_artifact_specs(self, trial_id: str, stage_id: str) -> dict:
        trial_root = f"research_trajectory/trials/{trial_id}"
        stage_root = f"research_trajectory/.staging/{trial_id}/{stage_id}"
        specs = {f"{trial_root}/{name}": _TRIAL_INPUTS[name]
                 for name in ("REPORT.json", "RESULT_CARDS.json", "MERGE_REQUEST.json")}
        specs.update({f"{stage_root}/{name}": spec for name, spec in _STAGE_INPUTS.items()})
        candidate = self._path(f"{stage_root}/candidate")
        for path in sorted(candidate.rglob("*.json")):
            relative = path.relative_to(self.root).as_posix()
            canonical = path.relative_to(candidate).as_posix()
            metadata = next((entry for entry in ARTIFACT_REGISTRY.values()
                             if artifact_path_matches(entry["artifact_type"], canonical)), None)
            if metadata:
                specs[relative] = (metadata["artifact_type"], bool(
                    metadata.get("paired_markdown") or metadata.get("paired_markdown_pattern")))
        return specs

    @staticmethod
    def _markdown_section_span(text: str, title: str) -> tuple[int, int] | None:
        matches = list(_MARKDOWN_HEADING.finditer(text))
        wanted = title.strip().casefold()
        for index, match in enumerate(matches):
            if match.group(1).strip().casefold() != wanted:
                continue
            start = match.end()
            level = len(match.group(0)) - len(match.group(0).lstrip("#"))
            end = len(text)
            for following in matches[index + 1 :]:
                following_level = len(following.group(0)) - len(
                    following.group(0).lstrip("#")
                )
                if following_level <= level:
                    end = following.start()
                    break
            return start, end
        return None

    @classmethod
    def _markdown_section(cls, text: str, title: str) -> str | None:
        span = cls._markdown_section_span(text, title)
        return text[span[0]:span[1]] if span is not None else None

    @staticmethod
    def _card_id_is_listed(text: str, card_id: str) -> bool:
        return bool(
            re.search(
                rf"(?<![A-Za-z0-9_-]){re.escape(card_id)}(?![A-Za-z0-9_-])",
                text,
            )
        )

    @staticmethod
    def _manuscript_relevant_card_ids(
        cards: Mapping[str, Any], request: Mapping[str, Any]
    ) -> set[str]:
        by_id = {
            str(card.get("id")): card
            for card in cards.get("cards", ())
            if isinstance(card, Mapping)
        }
        result: set[str] = set()
        for item in request.get("requested_card_decisions", ()):
            if not isinstance(item, Mapping) or item.get("decision") not in (
                _ACCEPTED_CARD_DECISIONS
            ):
                continue
            card_id = str(item.get("card_id") or "")
            card = by_id.get(card_id)
            if not card:
                continue
            claims = card.get("claim_ids")
            if card.get("type") in _MANUSCRIPT_CARD_TYPES or (
                isinstance(claims, list) and bool(claims)
            ):
                result.add(card_id)
        return result

    def _manuscript_promotion_errors(
        self,
        trial_id: str,
        stage_id: str,
        cards: Mapping[str, Any],
        request: Mapping[str, Any],
    ) -> list[str]:
        """Require evidence-bearing accepted cards to update both manuscript views."""

        current_ids = self._manuscript_relevant_card_ids(cards, request)
        historical_ids: set[str] = set()
        canonical_blueprint = self._path("manuscript/BLUEPRINT.md")
        canonical_is_stub = False
        if canonical_blueprint.is_file() and not canonical_blueprint.is_symlink():
            try:
                canonical_is_stub = bool(
                    _BLUEPRINT_STUB.search(
                        canonical_blueprint.read_text(encoding="utf-8")
                    )
                )
            except (OSError, UnicodeError) as exc:
                return [f"canonical BLUEPRINT.md cannot be read: {exc}"]
        if canonical_is_stub:
            findings_path = self._path("research_trajectory/CURRENT_FINDINGS.json")
            if findings_path.is_file() and not findings_path.is_symlink():
                try:
                    # Migration preserves the legacy Markdown byte-for-byte.
                    # Historical card IDs come from the validated JSON authority.
                    findings = self._load_artifact(
                        "research_trajectory/CURRENT_FINDINGS.json",
                        "current_findings",
                    )
                except V2RuntimeError as exc:
                    return [str(exc)]
                historical_ids = {
                    str(card_id)
                    for field in ("accepted_card_ids", "qualified_card_ids")
                    for card_id in findings.get(field, ())
                    if isinstance(card_id, str) and card_id
                }

        required_ids = current_ids | historical_ids
        if not required_ids:
            return []
        candidate_root = (
            f"research_trajectory/.staging/{trial_id}/{stage_id}/candidate"
        )
        relatives = {
            name: f"{candidate_root}/manuscript/{name}"
            for name in ("BLUEPRINT.md", "PAPER_PLAN.md")
        }
        missing = [
            name
            for name, relative in relatives.items()
            if not self._path(relative).is_file() or self._path(relative).is_symlink()
        ]
        if missing:
            return [
                "manuscript-relevant accepted cards require candidate "
                "manuscript/BLUEPRINT.md and manuscript/PAPER_PLAN.md; missing: "
                + ", ".join(missing)
            ]
        try:
            blueprint = self._path(relatives["BLUEPRINT.md"]).read_text(
                encoding="utf-8"
            )
        except (OSError, UnicodeError) as exc:
            return [f"candidate manuscript/BLUEPRINT.md cannot be read: {exc}"]
        errors: list[str] = []
        if _BLUEPRINT_STUB.search(blueprint):
            errors.append(
                "candidate manuscript/BLUEPRINT.md remains the pre-results stub "
                "despite accepted manuscript-relevant findings"
            )
        provenance = self._markdown_section(blueprint, "Provenance / Audit Index")
        if provenance is None:
            errors.append(
                "candidate manuscript/BLUEPRINT.md lacks a Provenance / Audit Index section"
            )
        else:
            missing_ids = sorted(
                card_id
                for card_id in required_ids
                if not self._card_id_is_listed(provenance, card_id)
            )
            if missing_ids:
                label = (
                    "accepted/qualified historical and current card IDs"
                    if historical_ids
                    else "current manuscript-relevant card IDs"
                )
                errors.append(
                    "candidate manuscript/BLUEPRINT.md Provenance / Audit Index "
                    f"does not cover {label}: {missing_ids}"
                )
        return errors

    def _final_manuscript_card_errors(
        self,
        stage: Mapping[str, Any],
        decision: Mapping[str, Any],
        candidates: Mapping[str, bytes],
        *,
        superseded_card_ids: frozenset[str] = frozenset(),
    ) -> list[str]:
        """Prevent an applied manuscript from depending on a rejected trial card."""

        rejected = {
            str(item.get("card_id"))
            for item in decision.get("card_decisions", ())
            if item.get("decision") not in _ACCEPTED_CARD_DECISIONS
        }
        if not rejected:
            return []
        apply_paths = {
            str(item.get("path"))
            for item in decision.get("canonical_update_decisions", ())
            if item.get("decision") == "apply"
        }
        errors: list[str] = []
        for operation in stage.get("operations", ()):
            target = str(operation.get("path") or "")
            if target not in _MANUSCRIPT_PATHS or target not in apply_paths:
                continue
            source = str(operation.get("candidate_path") or "")
            try:
                text = candidates[source].decode("utf-8")
            except (KeyError, UnicodeError):
                continue
            audit_span = self._markdown_section_span(text, "Provenance / Audit Index")
            active_text = text[:audit_span[0]] + text[audit_span[1]:] if audit_span else text
            cited = sorted(
                card_id
                for card_id in rejected
                if self._card_id_is_listed(
                    active_text if card_id in superseded_card_ids else text,
                    card_id,
                )
            )
            if cited:
                errors.append(
                    f"{target} depends on rejected or deferred current-trial cards: {cited}"
                )
        return errors

    def _recover_result_card_payloads(
        self,
        trial_id: str,
        lock: Mapping[str, Any],
        current: Mapping[str, Any],
    ) -> dict[str, dict[str, Any]]:
        """Recover a legacy hash-only lock from exact service-owned snapshots."""

        locked = lock.get("card_hashes")
        if not isinstance(locked, Mapping):
            raise V2RecoveryError(
                "distilled result-card lock card_hashes must be an object"
            )
        recovered: dict[str, dict[str, Any]] = {}

        def collect(value: Mapping[str, Any]) -> None:
            if (
                value.get("project_id") != self.project_id
                or value.get("trial_id") != trial_id
            ):
                return
            cards = value.get("cards")
            if not isinstance(cards, list):
                return
            for card in cards:
                if not isinstance(card, Mapping):
                    continue
                card_id = card.get("id")
                if (
                    isinstance(card_id, str)
                    and locked.get(card_id) == result_card_payload_hash(card)
                ):
                    recovered[card_id] = dict(card)

        collect(current)
        missing = set(locked) - set(recovered)
        if missing and self.guard_root is not None:
            trial_guard_root = self.guard_root / trial_id
            if trial_guard_root.is_dir() and not trial_guard_root.is_symlink():
                relative = Path(
                    "baseline/files/research_trajectory/trials"
                ) / trial_id / "RESULT_CARDS.json"
                for attempt in sorted(trial_guard_root.iterdir()):
                    snapshot = attempt / relative
                    cursor = snapshot.parent
                    unsafe_parent = False
                    while cursor != trial_guard_root:
                        if cursor.is_symlink():
                            unsafe_parent = True
                            break
                        cursor = cursor.parent
                    if (
                        attempt.is_symlink()
                        or not attempt.is_dir()
                        or unsafe_parent
                        or snapshot.is_symlink()
                        or not snapshot.is_file()
                    ):
                        continue
                    try:
                        value = _json(
                            snapshot.read_bytes(), snapshot.as_posix()
                        )
                    except (OSError, V2RuntimeError):
                        continue
                    collect(value)
                    missing = set(locked) - set(recovered)
                    if not missing:
                        break
        if missing:
            raise V2RecoveryError(
                "legacy distilled result-card payload recovery is incomplete for: "
                + ", ".join(sorted(str(card_id) for card_id in missing))
            )
        return {card_id: recovered[card_id] for card_id in sorted(recovered)}

    def _restore_unstaged_result_card_lock(
        self,
        trial_id: str,
        stage_id: str,
        agent_guard_dir: str | Path,
    ) -> None:
        """Restore the pre-execution lock when this stage never committed.

        The result-card lock is service-owned, but it is material review input.
        A failed staging attempt must therefore not leave newly frozen cards for
        the next attempt.  The newest committed stage manifest identifies the
        authoritative lock hash; trusted external guard snapshots retain its
        exact bytes even when the service restarts after an incomplete freeze.
        """

        manifest = self._path(stage_manifest_path(trial_id, stage_id))
        if manifest.exists() or manifest.is_symlink():
            return
        baseline = load_agent_baseline(agent_guard_dir)
        expected_registry = self._guard_registry(trial_id, stage_id)
        if baseline.project_root != self.root or baseline.registry != expected_registry:
            raise V2RecoveryError(
                "execution guard cannot restore the unstaged result-card lock"
            )
        relative = (
            f"research_trajectory/trials/{trial_id}/DISTILLED_RESULT_CARDS.json"
        )
        target = self._path(relative)
        committed_hash = self._committed_result_card_lock_hash(
            trial_id, exclude_stage_id=stage_id
        )
        if committed_hash is None:
            if target.is_symlink():
                raise V2RecoveryError(
                    "unstaged result-card lock is an untrustworthy symlink"
                )
            if target.exists():
                if not target.is_file():
                    raise V2RecoveryError(
                        "unstaged result-card lock is not a regular file"
                    )
                target.unlink()
                _transaction._fsync_directory(target.parent)
            return
        if target.is_file() and not target.is_symlink():
            current_bytes = target.read_bytes()
            if _digest(current_bytes) == committed_hash:
                return
            try:
                current_lock = _json(current_bytes, relative)
            except V2RuntimeError:
                current_lock = {}
            # A v1 lock is a pre-existing compatibility boundary.  It has no
            # payloads to freeze and is upgraded below from exact card bytes;
            # it is not evidence of an interrupted v2 service freeze.
            if current_lock.get("schema_version") == "1":
                return
        data = self._guard_snapshot_bytes(
            relative, committed_hash, preferred=baseline
        )
        if data is None:
            raise V2RecoveryError(
                "the last committed result-card lock has no trustworthy guard snapshot"
            )
        if (
            target.is_symlink()
            or not target.is_file()
            or target.read_bytes() != data
        ):
            if target.is_symlink() or (target.exists() and not target.is_file()):
                raise V2RecoveryError(
                    "unstaged result-card lock cannot be safely restored"
                )
            _transaction._atomic_write(target, data, 0o600)

    def _committed_result_card_lock_hash(
        self, trial_id: str, *, exclude_stage_id: str
    ) -> str | None:
        lock_relative = (
            f"research_trajectory/trials/{trial_id}/DISTILLED_RESULT_CARDS.json"
        )
        manifest = self._latest_committed_stage_manifest(
            trial_id, exclude_stage_id=exclude_stage_id
        )
        if manifest is None:
            return None
        return next(
            (
                str(item.get("sha256"))
                for item in manifest.get("material_inputs", ())
                if isinstance(item, Mapping)
                and item.get("path") == lock_relative
                and isinstance(item.get("sha256"), str)
                and len(str(item.get("sha256"))) == 64
            ),
            None,
        )

    def _latest_committed_stage_manifest(
        self, trial_id: str, *, exclude_stage_id: str
    ) -> dict[str, Any] | None:
        staging = self._path(f"research_trajectory/.staging/{trial_id}")
        if staging.is_symlink() or not staging.is_dir():
            return None
        committed: list[tuple[str, str, dict[str, Any]]] = []
        for stage in staging.iterdir():
            if (
                stage.name == exclude_stage_id
                or stage.is_symlink()
                or not stage.is_dir()
            ):
                continue
            manifest_path = stage / "STAGED_UPDATE_MANIFEST.json"
            if manifest_path.is_symlink() or not manifest_path.is_file():
                continue
            try:
                manifest = _json(
                    manifest_path.read_bytes(),
                    manifest_path.relative_to(self.root).as_posix(),
                )
                errors = validate_artifact(
                    manifest,
                    expected_type="staged_update_manifest",
                    path=manifest_path.relative_to(self.root).as_posix(),
                    schema_dir=self.schema_dir,
                )
            except (OSError, V2RuntimeError, ValueError):
                continue
            if (
                errors
                or manifest.get("project_id") != self.project_id
                or manifest.get("trial_id") != trial_id
                or manifest.get("stage_id") != stage.name
            ):
                continue
            committed.append(
                (str(manifest.get("created_at") or ""), stage.name, manifest)
            )
        return max(committed, key=lambda item: (item[0], item[1]))[2] if committed else None

    def _guard_snapshot_bytes(
        self,
        relative: str,
        expected_hash: str,
        *,
        preferred: Any,
    ) -> bytes | None:
        durable = self._service_snapshot_bytes(expected_hash)
        if durable is not None:
            return durable
        baselines = [preferred]
        for baseline in baselines:
            entry = baseline.entries.get(relative)
            if (
                entry is None
                or entry.kind != "file"
                or not entry.backup_path
                or entry.sha256 != expected_hash
            ):
                continue
            backup = baseline.run_dir / entry.backup_path
            if backup.is_symlink() or not backup.is_file():
                continue
            try:
                data = backup.read_bytes()
            except OSError:
                continue
            if len(data) == entry.size and _digest(data) == expected_hash:
                return data
        if not self.guard_root or self.guard_root.is_symlink() or not self.guard_root.is_dir():
            return None
        pattern = f"**/baseline/files/{relative}"
        for backup in self.guard_root.glob(pattern):
            if backup.is_symlink() or not backup.is_file():
                continue
            cursor = backup.parent
            unsafe = False
            while cursor != self.guard_root:
                if cursor.is_symlink():
                    unsafe = True
                    break
                cursor = cursor.parent
            if unsafe:
                continue
            try:
                data = backup.read_bytes()
            except OSError:
                continue
            if _digest(data) == expected_hash:
                return data
        return None

    def _service_snapshot_path(
        self, expected_hash: str, *, create: bool
    ) -> Path | None:
        """Return the private content-addressed service snapshot path.

        Agent guards are invocation-scoped and may be compacted after a newer
        guard owns the run.  They therefore cannot be the durable byte store
        for hash-only stage manifests.  Material snapshots live beside (not
        inside) trial guard namespaces and are addressed only by SHA-256.
        """

        if self.guard_root is None:
            return None
        digest = str(expected_hash).lower()
        if len(digest) != 64 or any(
            character not in "0123456789abcdef" for character in digest
        ):
            raise V2RecoveryError("service snapshot requires a valid SHA-256")
        root = self.guard_root
        if root.is_symlink() or not root.is_dir():
            raise V2RecoveryError("private guard root is missing or untrustworthy")
        directories = (
            root / ".service-material-v1",
            root / ".service-material-v1" / "sha256",
            root / ".service-material-v1" / "sha256" / digest[:2],
        )
        for directory in directories:
            if directory.exists() or directory.is_symlink():
                if directory.is_symlink() or not directory.is_dir():
                    raise V2RecoveryError(
                        "private service snapshot directory is untrustworthy"
                    )
            elif create:
                directory.mkdir(mode=0o700)
            else:
                return None
        return directories[-1] / digest

    def _service_snapshot_bytes(self, expected_hash: str) -> bytes | None:
        path = self._service_snapshot_path(expected_hash, create=False)
        if path is None or not (path.exists() or path.is_symlink()):
            return None
        if path.is_symlink() or not path.is_file():
            raise V2RecoveryError("private service snapshot is untrustworthy")
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise V2RecoveryError(
                "private service snapshot cannot be read"
            ) from exc
        if _digest(data) != expected_hash:
            raise V2RecoveryError("private service snapshot hash mismatch")
        return data

    def _persist_service_snapshot(
        self, data: bytes, expected_hash: str | None = None
    ) -> str:
        digest = _digest(data)
        if expected_hash is not None and digest != expected_hash:
            raise V2RecoveryError("service snapshot bytes differ from their stage hash")
        path = self._service_snapshot_path(digest, create=True)
        if path is None:
            return digest
        if path.exists() or path.is_symlink():
            retained = self._service_snapshot_bytes(digest)
            if retained != data:
                raise V2RecoveryError("private service snapshot content conflicts")
            return digest
        _transaction._atomic_write(path, data, 0o600)
        retained = self._service_snapshot_bytes(digest)
        if retained != data:
            raise V2RecoveryError("private service snapshot did not persist exactly")
        return digest

    def _persist_stage_material_snapshots(self, stage: Mapping[str, Any]) -> None:
        """Persist every hash-bound review input before committing a stage."""

        if self.guard_root is None:
            return
        material = stage.get("material_inputs")
        if not isinstance(material, list) or not material:
            raise V2RecoveryError("stage has no trustworthy material inputs")
        for item in material:
            if not isinstance(item, Mapping):
                raise V2RecoveryError("stage material input is invalid")
            relative = normalize_relative_path(str(item.get("path") or ""))
            expected = str(item.get("sha256") or "")
            path = self._path(relative, must_exist=True)
            if path.is_symlink() or not path.is_file():
                raise V2RecoveryError(
                    f"stage material input is not a regular file: {relative}"
                )
            try:
                data = path.read_bytes()
            except OSError as exc:
                raise V2RecoveryError(
                    f"stage material input cannot be read: {relative}"
                ) from exc
            self._persist_service_snapshot(data, expected)

    def _commit_stage_manifest(
        self, relative: str, stage: Mapping[str, Any]
    ) -> None:
        """Commit a stage only after its exact material bytes are durable."""

        self._persist_stage_material_snapshots(stage)
        self._write_artifact(relative, stage)

    def _restore_committed_result_card_evidence(
        self,
        trial_id: str,
        stage_id: str,
        agent_guard_dir: str | Path,
    ) -> None:
        """Restore trial-local evidence bytes already frozen by a valid stage."""

        manifest = self._latest_committed_stage_manifest(
            trial_id, exclude_stage_id=stage_id
        )
        if manifest is None:
            return
        material = {
            str(item.get("path")): str(item.get("sha256"))
            for item in manifest.get("material_inputs", ())
            if isinstance(item, Mapping)
            and isinstance(item.get("path"), str)
            and isinstance(item.get("sha256"), str)
        }
        lock_relative = (
            f"research_trajectory/trials/{trial_id}/DISTILLED_RESULT_CARDS.json"
        )
        lock_path = self._path(lock_relative, must_exist=True)
        lock = _json(lock_path.read_bytes(), lock_relative)
        locked_hashes = lock.get("card_hashes")
        if not isinstance(locked_hashes, Mapping):
            raise V2RecoveryError(
                "distilled result-card lock cannot identify immutable evidence"
            )
        payloads = lock.get("card_payloads")
        frozen: list[Mapping[str, Any]] = []
        if isinstance(payloads, Mapping):
            frozen.extend(
                payload
                for card_id, payload in payloads.items()
                if card_id in locked_hashes and isinstance(payload, Mapping)
            )
        else:
            cards_relative = f"research_trajectory/trials/{trial_id}/RESULT_CARDS.json"
            cards = self._load_artifact(cards_relative, "result_cards", paired=True)
            frozen.extend(
                card
                for card in cards.get("cards", ())
                if isinstance(card, Mapping)
                and locked_hashes.get(str(card.get("id")))
                == result_card_payload_hash(card)
            )
        trial_prefix = f"research_trajectory/trials/{trial_id}/"
        restore: dict[str, str] = {}
        for card in frozen:
            for reference in card.get("evidence", ()):
                if not isinstance(reference, Mapping):
                    continue
                relative = normalize_relative_path(str(reference.get("path") or ""))
                if not relative.startswith(trial_prefix) or relative == lock_relative:
                    continue
                expected = material.get(relative)
                declared = str(reference.get("sha256") or "")
                if not expected or declared != expected:
                    raise V2RecoveryError(
                        f"committed result-card evidence is not bound by its stage: {relative}"
                    )
                restore[relative] = expected
                if relative.endswith(".json"):
                    paired = relative[:-5] + ".md"
                    if paired in material:
                        restore[paired] = material[paired]
                elif relative.endswith(".md"):
                    paired = relative[:-3] + ".json"
                    if paired in material:
                        restore[paired] = material[paired]
        baseline = load_agent_baseline(agent_guard_dir)
        for relative, expected in restore.items():
            target = self._path(relative)
            if target.is_file() and not target.is_symlink():
                if _digest(target.read_bytes()) == expected:
                    continue
            data = self._guard_snapshot_bytes(
                relative, expected, preferred=baseline
            )
            if data is None:
                raise V2RecoveryError(
                    f"immutable result-card evidence has no trustworthy snapshot: {relative}"
                )
            if target.is_symlink() or (target.exists() and not target.is_file()):
                raise V2RecoveryError(
                    f"immutable result-card evidence cannot be safely restored: {relative}"
                )
            _transaction._atomic_write(target, data, 0o600)

    @staticmethod
    def _without_control_evidence(
        items: Any, lock_relative: str
    ) -> tuple[Any, bool]:
        if not isinstance(items, list):
            return items, False
        filtered = [
            item
            for item in items
            if not (isinstance(item, Mapping) and item.get("path") == lock_relative)
        ]
        return filtered, filtered != items

    @staticmethod
    def _bind_result_card_lock_metadata(
        value: dict[str, Any], lock_relative: str, lock_hash: str
    ) -> bool:
        extensions = value.get("extensions")
        if not isinstance(extensions, dict):
            return False
        changed = False
        if "frozen_card_ledger_path" in extensions:
            changed = extensions.get("frozen_card_ledger_path") != lock_relative
            extensions["frozen_card_ledger_path"] = lock_relative
        if "frozen_card_ledger_sha256" in extensions:
            changed = (
                extensions.get("frozen_card_ledger_sha256") != lock_hash
                or changed
            )
            extensions["frozen_card_ledger_sha256"] = lock_hash
        return changed

    def _freeze_result_cards(self, trial_id: str, stage_id: str) -> None:
        """Freeze every card payload at its first valid staged distillation.

        ``DISTILLED_RESULT_CARDS.json`` is a service control record, not
        research evidence.  Removing it from agent-authored evidence lists
        avoids a circular hash (the lock contains hashes of cards which would
        otherwise contain the lock hash).  Explicit control metadata is rebound
        to the final service-owned lock hash after the lock is written.
        """

        cards_relative = f"research_trajectory/trials/{trial_id}/RESULT_CARDS.json"
        cards = self._load_artifact(cards_relative, "result_cards", paired=True)
        lock_relative = (
            f"research_trajectory/trials/{trial_id}/DISTILLED_RESULT_CARDS.json"
        )
        lock_path = self._path(lock_relative)
        raw_cards = cards.get("cards")
        if not isinstance(raw_cards, list):
            raise V2RuntimeError("RESULT_CARDS cards must be an array")
        trial_root = f"research_trajectory/trials/{trial_id}"
        forbidden_evidence = {
            f"{trial_root}/{name}"
            for name in (
                "TRIAL.json",
                "PLAN.json",
                "PLAN.md",
                "EXPERT_ROUTE.json",
                "EXPERT_ROUTE.md",
                "REPORT.json",
                "REPORT.md",
                "RESULT_CARDS.json",
                "RESULT_CARDS.md",
                "MERGE_REQUEST.json",
                "MERGE_REQUEST.md",
            )
        }
        forbidden_prefixes = (
            f"{trial_root}/reviews/",
            f"research_trajectory/.staging/{trial_id}/",
        )
        invalid_evidence: list[str] = []
        for card in raw_cards:
            if not isinstance(card, Mapping):
                continue
            card_id = str(card.get("id") or "<unknown>")
            for reference in card.get("evidence", ()):
                if not isinstance(reference, Mapping):
                    continue
                try:
                    relative = normalize_relative_path(
                        str(reference.get("path") or "")
                    )
                except (TypeError, ValueError) as exc:
                    invalid_evidence.append(f"{card_id}: invalid path ({exc})")
                    continue
                if relative in forbidden_evidence or relative.startswith(
                    forbidden_prefixes
                ):
                    invalid_evidence.append(f"{card_id}: {relative}")
        if invalid_evidence:
            raise V2RuntimeError(
                "RESULT_CARDS evidence cites mutable control material: "
                + "; ".join(invalid_evidence)
            )
        cards_changed = False
        for card in raw_cards:
            if not isinstance(card, dict):
                continue
            evidence, changed = self._without_control_evidence(
                card.get("evidence"), lock_relative
            )
            if changed:
                card["evidence"] = evidence
                cards_changed = True
        prior: dict[str, Any] | None = None
        if lock_path.exists() or lock_path.is_symlink():
            if lock_path.is_symlink() or not lock_path.is_file():
                raise V2RuntimeError("distilled result-card lock is not a regular file")
            prior = _json(lock_path.read_bytes(), lock_relative)
            if prior.get("schema_version") == "1":
                prior = {
                    **prior,
                    "schema_version": "2",
                    "card_payloads": self._recover_result_card_payloads(
                        trial_id, prior, cards
                    ),
                }
            locked = prior.get("card_hashes")
            payloads = prior.get("card_payloads")
            if isinstance(locked, Mapping) and isinstance(payloads, Mapping):
                current_cards = cards.get("cards")
                if not isinstance(current_cards, list):
                    raise V2RuntimeError("RESULT_CARDS cards must be an array")
                by_id = {
                    str(card.get("id")): card
                    for card in current_cards
                    if isinstance(card, Mapping)
                }
                mutated = [
                    str(card_id)
                    for card_id, digest in locked.items()
                    if str(card_id) in by_id
                    and result_card_payload_hash(by_id[str(card_id)]) != digest
                ]
                if mutated:
                    raise V2RuntimeError(
                        "distilled result-card payload changed; corrections must add "
                        "a superseding card: " + ", ".join(sorted(mutated))
                    )
                unlocked = [
                    dict(card)
                    for card in current_cards
                    if isinstance(card, Mapping)
                    and str(card.get("id")) not in locked
                ]
                combined = [
                    dict(payloads[card_id]) for card_id in sorted(locked)
                ] + unlocked
                if current_cards != combined:
                    cards["cards"] = combined
                    cards_changed = True
            errors = result_card_immutability_errors(prior, cards)
            if errors:
                raise V2RuntimeError("; ".join(errors))
        validation_errors = validate_artifact(
            cards,
            expected_type="result_cards",
            path=cards_relative,
            schema_dir=self.schema_dir,
        )
        if validation_errors:
            raise V2RuntimeError(
                f"{cards_relative}: " + "; ".join(validation_errors)
            )
        if cards_changed:
            self._write_pair(cards_relative, cards)
        updated = build_result_card_lock(cards, prior)
        if prior != updated:
            self._write_artifact(lock_relative, updated)
        lock_hash = _digest(self._path(lock_relative, must_exist=True).read_bytes())

        artifacts = (
            (cards_relative, "result_cards", "cards"),
            (f"research_trajectory/trials/{trial_id}/REPORT.json", "report", "artifacts"),
            (f"research_trajectory/trials/{trial_id}/MERGE_REQUEST.json", "merge_request", None),
            (
                f"research_trajectory/.staging/{trial_id}/{stage_id}/HUMAN_BRIEF.json",
                "human_brief",
                "evidence",
            ),
            (
                f"research_trajectory/.staging/{trial_id}/{stage_id}/GATE_EVIDENCE.json",
                "gate_evidence",
                None,
            ),
        )
        for relative, artifact_type, evidence_field in artifacts:
            value = (
                cards
                if relative == cards_relative
                else self._load_artifact(relative, artifact_type, paired=True)
            )
            changed = self._bind_result_card_lock_metadata(
                value, lock_relative, lock_hash
            )
            if evidence_field == "artifacts":
                filtered, removed = self._without_control_evidence(
                    value.get("artifacts"), lock_relative
                )
                if removed:
                    value["artifacts"] = filtered
                    changed = True
            elif evidence_field == "evidence":
                filtered, removed = self._without_control_evidence(
                    value.get("evidence"), lock_relative
                )
                if removed:
                    value["evidence"] = filtered
                    changed = True
                service_normalized = {
                    cards_relative,
                    f"research_trajectory/trials/{trial_id}/REPORT.json",
                    f"research_trajectory/trials/{trial_id}/MERGE_REQUEST.json",
                }
                for item in value.get("evidence", ()):
                    if not isinstance(item, dict) or item.get("path") not in service_normalized:
                        continue
                    evidence_path = self._path(str(item["path"]), must_exist=True)
                    evidence_hash = _digest(evidence_path.read_bytes())
                    if item.get("sha256") != evidence_hash:
                        item["sha256"] = evidence_hash
                        changed = True
            if changed:
                self._write_pair(relative, value)

    @staticmethod
    def _guard_registry(trial_id: str, stage_id: str) -> PathRegistry:
        registry = PathRegistry.for_run(trial_id, stage_id)
        history = f"research_trajectory/trials/{trial_id}/reviews/history/**"
        return replace(
            registry,
            protected_patterns=(*registry.protected_patterns, history),
        )

    @staticmethod
    def _plan_guard_registry(trial_id: str, stage_id: str) -> PathRegistry:
        registry = PathRegistry.for_plan(trial_id, stage_id)
        history = f"research_trajectory/trials/{trial_id}/reviews/history/**"
        return replace(
            registry,
            protected_patterns=(*registry.protected_patterns, history),
        )

    @staticmethod
    def _plan_approval_path(trial_id: str, stage_id: str) -> str:
        return (
            f"research_trajectory/.staging/{trial_id}/{stage_id}/"
            f"{_PLAN_APPROVAL_NAME}"
        )

    def recover(self) -> dict[str, Any]:
        """Recover/finalize transactions before any new trial work."""

        try:
            actions = self.transactions.recover()
            health = self.transactions.health()
            if health["recovery_required"]:
                return _status("recovery_required", actions=actions, health=health)
            return _status(
                "ready",
                actions=actions,
                canonical_revision=health["last_published_revision"],
                health=health,
            )
        except (OSError, TypeError, ValueError, _transaction.TransactionError) as exc:
            return _status("recovery_required", errors=[str(exc)])

    def initialize_trial(
        self,
        trial_id: str,
        *,
        agent_guard_dir: str | Path,
        stage_id: str | None = None,
        prior_stage_id: str | None = None,
    ) -> dict[str, Any]:
        """Recover, allocate an immutable stage, and snapshot the plan boundary."""

        try:
            trial_id = require_id("trial", trial_id)
            recovery = self.recover()
            if recovery["status"] != "ready":
                return recovery
            receipt = self._path(
                f"research_trajectory/trials/{trial_id}/PUBLISH_RECEIPT.json"
            )
            if receipt.exists() or receipt.is_symlink():
                return _status("already_published", trial_id=trial_id)
            allocated = stage_id or new_stage_id(trial_id)
            require_id("stage", allocated)
            if not allocated.startswith(f"STAGE-{trial_id[:6]}-"):
                raise V2RuntimeError("stage_id does not belong to trial_id")
            if prior_stage_id is not None:
                require_id("stage", prior_stage_id)
                if not prior_stage_id.startswith(f"STAGE-{trial_id[:6]}-"):
                    raise V2RuntimeError("prior_stage_id does not belong to trial_id")
                if prior_stage_id == allocated:
                    raise V2RuntimeError("prior and new stage IDs must differ")
            candidate_relative = (
                f"research_trajectory/.staging/{trial_id}/{allocated}/candidate"
            )
            candidate = self._path(candidate_relative)
            stage = candidate.parent
            if stage.exists() or stage.is_symlink():
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=allocated,
                    new_stage_required=True,
                    errors=[
                        "stage_id already exists and immutable stages are never reused"
                    ],
                )
            _transaction._ensure_directory(
                self._path(f"research_trajectory/trials/{trial_id}/reviews"),
                0o700,
            )
            self._archive_prior_review_namespace(
                trial_id, allocated, prior_stage_id=prior_stage_id
            )
            _transaction._ensure_directory(candidate, 0o700)
            trial_relative = f"research_trajectory/trials/{trial_id}/TRIAL.json"
            if self._path(trial_relative).is_file():
                trial = self._load_artifact(trial_relative, "trial")
                trial["stage_id"] = allocated
                assignment = trial.get("extensions", {}).get("service_assignment")
                if isinstance(assignment, dict):
                    assignment["stage_id"] = allocated
                self._write_artifact(trial_relative, trial)
            capture_agent_baseline(
                self.root,
                agent_guard_dir,
                trial_id=trial_id,
                attempt_id=allocated,
                registry=self._plan_guard_registry(trial_id, allocated),
            )
            return _status(
                "plan_ready",
                trial_id=trial_id,
                stage_id=allocated,
                base_revision=recovery["canonical_revision"],
                candidate_root=candidate_relative,
                staged_manifest_path=stage_manifest_path(trial_id, allocated),
                plan_guard_dir=str(Path(agent_guard_dir).resolve()),
            )
        except (
            GuardError,
            KeyError,
            OSError,
            TypeError,
            ValueError,
            V2RuntimeError,
            _transaction.TransactionError,
        ) as exc:
            return _status("repair", errors=[str(exc)], new_stage_required=True)

    def _archive_prior_review_namespace(
        self,
        trial_id: str,
        new_stage_id: str,
        *,
        prior_stage_id: str | None = None,
    ) -> None:
        relative = f"research_trajectory/trials/{trial_id}/reviews/REVIEW_MANIFEST.json"
        path = self._path(relative)
        if not (path.exists() or path.is_symlink()):
            review_dir = self._path(
                f"research_trajectory/trials/{trial_id}/reviews"
            )
            sources = sorted(
                child
                for child in review_dir.iterdir()
                if child.suffix in {".json", ".md"}
            )
            if not sources:
                return
            if prior_stage_id is None:
                raise V2RuntimeError(
                    "prior_stage_id is required to archive a pre-review plan namespace"
                )
            self._archive_current_reviews(
                trial_id, prior_stage_id, require_manifest=False
            )
            return
        old = self._load_artifact(relative, "review_manifest", paired=True)
        old_stage = require_id("stage", old.get("stage_id"))
        if old_stage == new_stage_id:
            raise V2RuntimeError(
                "this immutable stage already has a Review Manifest"
            )
        retained = self._path(stage_manifest_path(trial_id, old_stage))
        if retained.is_symlink() or not retained.is_file():
            raise V2RuntimeError("prior review stage was not retained")
        self._archive_current_reviews(trial_id, old_stage)

    def _audit_guard(
        self,
        guard_dir: str | Path,
        trial_id: str,
        stage_id: str,
        expected_registry: PathRegistry,
    ) -> dict[str, Any]:
        baseline = load_agent_baseline(guard_dir)
        if (
            baseline.project_root != self.root
            or baseline.registry.trial_id != trial_id
            or baseline.registry.attempt_id != stage_id
            or not baseline.registry.is_compatible_with(expected_registry)
        ):
            raise GuardError(
                "guard baseline does not belong to this project/trial/stage/phase"
            )
        evidence_path = baseline.run_dir / "guard-result.json"
        if evidence_path.is_file() and not evidence_path.is_symlink():
            evidence = _json(evidence_path.read_bytes(), str(evidence_path))
            if (
                set(evidence)
                != {
                    "schema_version",
                    "artifact_type",
                    "registry_version",
                    "trial_id",
                    "attempt_id",
                    "captured_at",
                    "audited_at",
                    "publishable",
                    "protocol_violation",
                    "violations",
                    "restored_paths",
                    "restoration_errors",
                }
                or evidence.get("schema_version") != SCHEMA_VERSION
                or evidence.get("artifact_type") != "protected_write_evidence"
                or evidence.get("registry_version")
                != baseline.registry.registry_version
                or evidence.get("trial_id") != trial_id
                or evidence.get("attempt_id") != stage_id
                or evidence.get("captured_at") != baseline.captured_at
                or not isinstance(evidence.get("audited_at"), str)
                or not isinstance(evidence.get("publishable"), bool)
                or not isinstance(evidence.get("protocol_violation"), bool)
                or not isinstance(evidence.get("violations"), list)
                or not isinstance(evidence.get("restored_paths"), list)
                or not isinstance(evidence.get("restoration_errors"), list)
                or evidence.get("protocol_violation")
                is not bool(evidence.get("violations"))
                or evidence.get("publishable")
                is not (
                    not evidence["violations"] and not evidence["restoration_errors"]
                )
            ):
                raise GuardError(
                    "persisted guard result is inconsistent with its baseline"
                )
            return {
                "publishable": bool(evidence["publishable"]),
                "protocol_violation": bool(evidence["violations"]),
                "violations": evidence["violations"],
                "restored_paths": list(evidence.get("restored_paths", ())),
                "restoration_errors": evidence["restoration_errors"],
                "evidence_path": str(evidence_path),
            }
        return audit_and_restore_agent_writes(baseline).to_dict()

    def audit_plan_guard(
        self, trial_id: str, stage_id: str, guard_dir: str | Path
    ) -> dict[str, Any]:
        """Audit planning before any server-side parsing or repair decision."""

        require_id("trial", trial_id)
        require_id("stage", stage_id)
        return self._audit_guard(
            guard_dir,
            trial_id,
            stage_id,
            self._plan_guard_registry(trial_id, stage_id),
        )

    def audit_execution_guard(
        self, trial_id: str, stage_id: str, guard_dir: str | Path
    ) -> dict[str, Any]:
        """Audit execution before reading any agent-produced routing input."""

        require_id("trial", trial_id)
        require_id("stage", stage_id)
        return self._audit_guard(
            guard_dir,
            trial_id,
            stage_id,
            self._guard_registry(trial_id, stage_id),
        )

    def audit_review_guard(
        self, trial_id: str, stage_id: str, guard_dir: str | Path
    ) -> dict[str, Any]:
        """Audit review output before emitting completion semantics."""

        require_id("trial", trial_id)
        require_id("stage", stage_id)
        registry = self._guard_registry(trial_id, stage_id)
        key = (trial_id, stage_id, str(Path(guard_dir)), registry)
        guard = self._audit_guard(
            guard_dir,
            trial_id,
            stage_id,
            registry,
        )
        self._audited_review_guard = (key, guard)
        return dict(guard)

    def preflight_review_completion(
        self, trial_id: str, stage_id: str, guard_dir: str | Path
    ) -> dict[str, Any]:
        """Audit review writes before reading or recovering service-owned state."""

        require_id("trial", trial_id)
        require_id("stage", stage_id)
        guard = self.audit_review_guard(trial_id, stage_id, guard_dir)
        if not guard.get("publishable"):
            return _status("ready", guard=guard)
        recovery = self.recover()
        if recovery["status"] != "ready":
            return _status(
                "recovery_required",
                errors=list(recovery.get("errors", ())),
                recovery=recovery,
                guard=guard,
            )
        authoritative = self._authoritative_publication(trial_id)
        if authoritative is not None:
            return _status("authoritative", result=authoritative, guard=guard)
        return _status("ready", guard=guard)

    @staticmethod
    def _stage_material_input_id(relative: str, trial_id: str) -> str | None:
        match = re.fullmatch(
            rf"research_trajectory/(?:trials/{re.escape(trial_id)}/artifacts/(?!resource_scout/)[a-zA-Z0-9_-]+|"
            rf"\.staging/{re.escape(trial_id)})/(STAGE-{trial_id[:6]}-[a-f0-9]{{8}})/(.+)",
            relative,
        )
        if match and (
            not relative.startswith("research_trajectory/.staging/")
            or match.group(2).startswith("candidate/")
        ):
            return match.group(1)
        return None

    @classmethod
    def _plan_input_allowed(
        cls, relative: str, trial_id: str, stage_id: str | None = None
    ) -> bool:
        path = normalize_relative_path(relative)
        trial_root = f"research_trajectory/trials/{trial_id}"
        prior_stage = cls._stage_material_input_id(path, trial_id)
        if prior_stage:
            return stage_id is not None and prior_stage != stage_id
        if path.startswith("research_trajectory/.staging/") or path.startswith(
            "research_trajectory/.transactions/"
        ):
            return False
        if path.startswith(trial_root + "/"):
            child = path[len(trial_root) + 1 :]
            history = child.split("/")
            if (
                len(history) == 4
                and history[:2] == ["reviews", "history"]
                and stage_id is not None
                and history[2] != stage_id
                and history[2].startswith(f"STAGE-{trial_id[:6]}-")
                and history[3].endswith((".json", ".md"))
                and history[3] not in {"PLAN_REVIEW.json", "PLAN_REVIEW.md"}
            ):
                return True
            return child in {
                "TRIAL.json",
                "PLAN.json",
                "PLAN.md",
                "EXPERT_ROUTE.json",
                "EXPERT_ROUTE.md",
            } or child.startswith("artifacts/resource_scout/")
        return path in {"AGENTS.md", "PROJECT.md"} or path.startswith(
            (
                "archive/v2_forks/",
                "archive/v2_restarts/",
                "instructions/",
                "manuscript/",
                "requirements/",
                "research_trajectory/",
                "resources/",
                "schemas/",
                "workspace/",
            )
        )

    def _validate_prior_stage_input(
        self, relative: str, trial_id: str, stage_id: str
    ) -> None:
        """Bind historical evidence/candidates to their retained service stage."""

        prior_stage_id = self._stage_material_input_id(relative, trial_id)
        if prior_stage_id is None:
            return
        require_id("stage", prior_stage_id)
        stage = self._load_artifact(
            stage_manifest_path(trial_id, prior_stage_id), "staged_update_manifest"
        )
        if (
            prior_stage_id == stage_id
            or stage.get("project_id") != self.project_id
            or stage.get("trial_id") != trial_id
            or stage.get("stage_id") != prior_stage_id
            or stage.get("stage_content_hash") != compute_stage_content_hash(stage)
        ):
            raise V2RuntimeError(
                f"PLAN_REVIEW prior stage is not trustworthy: {relative}"
            )
        expected = next(
            (item.get("sha256") for item in stage.get("material_inputs", ())
             if item.get("path") == relative),
            None,
        )
        if expected is None or expected != _digest(self._path(relative, must_exist=True).read_bytes()):
            raise V2RuntimeError(
                f"PLAN_REVIEW historical input is not bound to its retained stage: {relative}"
            )

    def _validate_archived_review_input(
        self, relative: str, trial_id: str, stage_id: str
    ) -> None:
        """Accept only exact-stage post-execution reviews from retained history."""

        trial_root = f"research_trajectory/trials/{trial_id}"
        prefix = f"{trial_root}/reviews/history/"
        if not relative.startswith(prefix):
            return
        remainder = relative[len(prefix) :].split("/")
        if len(remainder) != 2:
            raise V2RuntimeError(
                f"PLAN_REVIEW contains an invalid archived review input: {relative}"
            )
        prior_stage_id, name = remainder
        if name.endswith(".md"):
            name = name[:-3] + ".json"
        json_relative = f"{prefix}{prior_stage_id}/{name}"
        require_id("stage", prior_stage_id)
        if prior_stage_id == stage_id:
            raise V2RuntimeError(
                f"PLAN_REVIEW cannot use current-stage review history: {relative}"
            )
        stage = self._load_artifact(
            stage_manifest_path(trial_id, prior_stage_id),
            "staged_update_manifest",
        )
        stage_hash = stage.get("stage_content_hash")
        if (
            stage.get("project_id") != self.project_id
            or stage.get("trial_id") != trial_id
            or stage.get("stage_id") != prior_stage_id
            or not stage_hash
            or stage_hash != compute_stage_content_hash(stage)
        ):
            raise V2RuntimeError(
                f"PLAN_REVIEW archived review stage is not trustworthy: {relative}"
            )
        artifact_type = (
            "review_manifest" if name == "REVIEW_MANIFEST.json" else "reviewer_output"
        )
        archived = _json(self._path(json_relative, must_exist=True).read_bytes(), json_relative)
        errors = validate_artifact(
            archived,
            expected_type=artifact_type,
            path=f"{trial_root}/reviews/{name}",
            schema_dir=self.schema_dir,
        )
        markdown_relative = json_relative[:-5] + ".md"
        markdown_path = self._path(markdown_relative, must_exist=True)
        try:
            markdown = markdown_path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            errors.append(f"paired Markdown cannot be read: {exc}")
        else:
            errors.extend(paired_markdown_errors(archived, markdown))
        if errors:
            raise V2RuntimeError(f"{relative}: " + "; ".join(errors))
        if (
            archived.get("project_id") != self.project_id
            or archived.get("trial_id") != trial_id
            or archived.get("stage_id") != prior_stage_id
            or archived.get("stage_manifest_hash") != stage_hash
            or (
                artifact_type == "reviewer_output"
                and (
                    archived.get("reviewer") == "plan"
                    or archived.get("phase") not in {"post_stage", "final"}
                )
            )
        ):
            raise V2RuntimeError(
                f"PLAN_REVIEW archived review input is not bound to its retained stage: {relative}"
            )

    def _material_files(self, relative: str) -> list[str]:
        normalized = normalize_relative_path(relative)
        target = self._path(normalized)
        if not target.exists():
            return []
        if target.is_symlink():
            raise V2RuntimeError(f"plan-time material is a symlink: {normalized}")
        if target.is_file():
            return [normalized]
        if not target.is_dir():
            raise V2RuntimeError(
                f"plan-time material is not a regular file or directory: {normalized}"
            )
        result: list[str] = []
        for child in sorted(target.rglob("*")):
            relative_child = child.relative_to(self.root).as_posix()
            if child.is_symlink():
                raise V2RuntimeError(
                    f"plan-time material contains a symlink: {relative_child}"
                )
            if child.is_file():
                result.append(relative_child)
        return result

    def _preexecution_output_paths(self, trial_id: str, stage_id: str) -> list[str]:
        trial_root = f"research_trajectory/trials/{trial_id}"
        allowed_trial = {
            f"{trial_root}/TRIAL.json",
            f"{trial_root}/PLAN.json",
            f"{trial_root}/PLAN.md",
            f"{trial_root}/EXPERT_ROUTE.json",
            f"{trial_root}/EXPERT_ROUTE.md",
            f"{trial_root}/reviews/PLAN_REVIEW.json",
            f"{trial_root}/reviews/PLAN_REVIEW.md",
        }
        outputs: list[str] = []
        trial_dir = self._path(trial_root)
        if trial_dir.is_dir() and not trial_dir.is_symlink():
            for child in sorted(trial_dir.rglob("*")):
                if not child.is_file():
                    continue
                relative = child.relative_to(self.root).as_posix()
                if (
                    relative in allowed_trial
                    or relative.startswith(f"{trial_root}/artifacts/resource_scout/")
                    or relative.startswith(f"{trial_root}/reviews/history/")
                ):
                    continue
                outputs.append(relative)
        stage_root = self._path(
            f"research_trajectory/.staging/{trial_id}/{stage_id}"
        )
        approval = self._plan_approval_path(trial_id, stage_id)
        if stage_root.is_dir() and not stage_root.is_symlink():
            outputs.extend(
                child.relative_to(self.root).as_posix()
                for child in sorted(stage_root.rglob("*"))
                if child.is_file()
                and child.relative_to(self.root).as_posix() != approval
            )
        return sorted(set(outputs))

    def _plan_context(
        self,
        trial_id: str,
        stage_id: str,
        *,
        plan_guard_dir: str | Path | None = None,
    ) -> dict[str, Any]:
        trial_root = f"research_trajectory/trials/{trial_id}"
        trial = self._load_artifact(f"{trial_root}/TRIAL.json", "trial")
        validate_trial_stage_binding(trial, stage_id)
        plan_relative = f"{trial_root}/PLAN.json"
        route_relative = f"{trial_root}/EXPERT_ROUTE.json"
        review_relative = f"{trial_root}/reviews/PLAN_REVIEW.json"
        plan = self._load_artifact(plan_relative, "plan", paired=True)
        route = self._load_artifact(route_relative, "expert_route", paired=True)
        self._validate_expert_route(route, plan)
        review = self._load_artifact(
            review_relative, "reviewer_output", paired=True
        )
        for name, value in (
            ("TRIAL", trial),
            ("PLAN", plan),
            ("EXPERT_ROUTE", route),
            ("PLAN_REVIEW", review),
        ):
            if value.get("project_id") != self.project_id:
                raise V2RuntimeError(f"{name} belongs to another project")
            if value.get("trial_id") != trial_id:
                raise V2RuntimeError(f"{name} belongs to another trial")
        for included_trial in plan.get("working_set", {}).get(
            "included_trials", ()
        ):
            included_relative = f"research_trajectory/trials/{included_trial}"
            included_path = self._path(included_relative)
            if included_path.is_symlink() or not included_path.is_dir():
                raise V2RuntimeError(
                    "PLAN working_set references a missing trial directory: "
                    f"{included_trial}"
                )
        if (
            review.get("reviewer") != "plan"
            or review.get("scope") != "plan"
            or review.get("phase") != "pre_execution"
            or review.get("decision") != "pass"
            or review.get("stage_id") is not None
            or review.get("stage_manifest_hash") is not None
        ):
            raise V2RuntimeError(
                "PLAN_REVIEW must be a passing pre_execution plan review"
            )
        unresolved = [
            field
            for field in ("blockers", "required_actions", "unassessed_areas")
            if review.get(field)
        ]
        if unresolved:
            raise V2RuntimeError(
                "PLAN_REVIEW cannot pass with non-empty " + str(unresolved)
            )

        reviewed_inputs = [
            normalize_relative_path(str(item))
            for item in review.get("reviewed_inputs", ())
        ]
        missing_core_inputs = sorted(
            {plan_relative, route_relative} - set(reviewed_inputs)
        )
        if missing_core_inputs:
            raise V2RuntimeError(
                "PLAN_REVIEW reviewed_inputs omitted core plan-time inputs: "
                f"{missing_core_inputs}"
            )
        post_execution_inputs = sorted(
            {
                relative
                for relative in reviewed_inputs
                if not self._plan_input_allowed(relative, trial_id, stage_id)
            }
        )
        if post_execution_inputs:
            raise V2RuntimeError(
                "PLAN_REVIEW contains post-execution inputs: "
                f"{post_execution_inputs}"
            )
        for relative in reviewed_inputs:
            target = self._path(relative, must_exist=True)
            if target.is_symlink() or not target.is_file():
                raise V2RuntimeError(
                    f"PLAN_REVIEW input is not a regular file: {relative}"
                )
            self._validate_archived_review_input(relative, trial_id, stage_id)
            self._validate_prior_stage_input(relative, trial_id, stage_id)

        plan_bytes = self._path(plan_relative, must_exist=True).read_bytes()
        plan_sha256 = _digest(plan_bytes)
        binding = review.get("extensions", {}).get("plan_binding")
        if (
            not isinstance(binding, Mapping)
            or not _PLAN_BINDING_KEYS.issubset(binding)
            or binding.get("plan_revision") != plan.get("plan_revision")
            or binding.get("plan_sha256") != plan_sha256
        ):
            raise V2RuntimeError(
                "PLAN_REVIEW must set exact "
                "extensions.plan_binding.plan_revision and "
                "extensions.plan_binding.plan_sha256 for the current PLAN.json bytes"
            )

        material_paths = {
            f"{trial_root}/TRIAL.json",
            plan_relative,
            plan_relative[:-5] + ".md",
            route_relative,
            route_relative[:-5] + ".md",
            *reviewed_inputs,
        }
        expected_paths: set[str] = set()
        scout_root = f"{trial_root}/artifacts/resource_scout/"
        raw_root = f"resources/autoresearch_discovered/{trial_id}"
        plan_registry = self._plan_guard_registry(trial_id, stage_id)
        for raw in plan.get("resource_scout", {}).get("expected_destinations", ()):
            relative = normalize_relative_path(str(raw))
            if not plan_registry.agent_write_allowed(relative) or not (
                relative.startswith(scout_root)
                or relative == raw_root
                or relative.startswith(raw_root + "/")
            ):
                raise V2RuntimeError(
                    "Resource Scout destination must name scoped artifacts under "
                    f"{scout_root} or raw material under {raw_root}: {relative}"
                )
            expected_paths.update(self._material_files(relative))
        reviewed_scout_paths = {
            relative for relative in reviewed_inputs if relative.startswith(scout_root)
        }
        scout_paths = reviewed_scout_paths | expected_paths
        scout_report_roots = {
            relative.rsplit("/", 1)[0]
            for relative in scout_paths
            if relative.startswith(scout_root)
            and relative.endswith("/RESOURCE_SCOUT_REPORT.md")
        }
        if plan.get("resource_scout", {}).get("decision") == "required" and not any(
            root.startswith(scout_root)
            and f"{root}/RESOURCE_SCOUT_MANIFEST.json" in scout_paths
            for root in scout_report_roots
        ):
            raise V2RuntimeError(
                "required Resource Scout must produce its report and manifest "
                "(RESOURCE_SCOUT_REPORT.md and RESOURCE_SCOUT_MANIFEST.json) in "
                "the same stage/revision-specific Scout subdirectory before Plan Review"
            )
        material_paths.update(expected_paths)
        omitted = sorted(expected_paths - set(reviewed_inputs))
        if omitted:
            raise V2RuntimeError(
                f"PLAN_REVIEW omitted plan-time Scout/preflight inputs: {omitted}"
            )

        if plan_guard_dir is not None:
            implicit_outputs = {
                f"{trial_root}/TRIAL.json",
                plan_relative,
                plan_relative[:-5] + ".md",
                route_relative,
                route_relative[:-5] + ".md",
                review_relative,
                review_relative[:-5] + ".md",
            }
            changed_files: set[str] = set()
            non_material_changes: list[str] = []
            for change in agent_write_changes(plan_guard_dir):
                after_kind = change.get("after_kind")
                # Creating ordinary parent directories is structural, not
                # hidden plan material.  Deletions, symlinks, and type changes
                # cannot be represented by the approval's file-hash contract.
                if after_kind == "directory" and change.get("action") == "create":
                    continue
                if after_kind != "file":
                    non_material_changes.append(str(change.get("path") or ""))
                    continue
                changed_files.add(str(change["path"]))
            if non_material_changes:
                raise V2RuntimeError(
                    "plan-time writes contain non-file or deleted material: "
                    f"{sorted(non_material_changes)}"
                )
            undeclared = sorted(
                changed_files - implicit_outputs - set(reviewed_inputs)
            )
            if undeclared:
                raise V2RuntimeError(
                    "PLAN_REVIEW omitted changed plan-time material: "
                    f"{undeclared}"
                )

        records = [
            {
                "path": relative,
                "sha256": _digest(self._path(relative, must_exist=True).read_bytes()),
            }
            for relative in sorted(material_paths)
        ]
        review_bytes = self._path(review_relative, must_exist=True).read_bytes()
        return {
            "trial": trial,
            "plan": plan,
            "review": review,
            "plan_sha256": plan_sha256,
            "plan_review_sha256": _digest(review_bytes),
            "material_inputs": records,
            "material_hash": _digest(canonical_json_bytes(records)),
            "plan_review_path": review_relative,
        }

    @staticmethod
    def _approval_shape_errors(value: Mapping[str, Any]) -> list[str]:
        required = {
            "schema_version",
            "record_type",
            "project_id",
            "trial_id",
            "stage_id",
            "plan_revision",
            "plan_sha256",
            "plan_review_path",
            "plan_review_sha256",
            "material_hash",
            "material_inputs",
            "approved_at",
        }
        errors: list[str] = []
        if set(value) != required:
            errors.append("plan approval has an invalid record shape")
        if value.get("schema_version") != "1" or value.get("record_type") != "plan_approval":
            errors.append("plan approval has an unsupported version or type")
        if not isinstance(value.get("plan_revision"), int) or isinstance(
            value.get("plan_revision"), bool
        ):
            errors.append("plan approval revision is invalid")
        for key in ("plan_sha256", "plan_review_sha256", "material_hash"):
            digest = value.get(key)
            if not isinstance(digest, str) or len(digest) != 64 or any(
                character not in "0123456789abcdef" for character in digest
            ):
                errors.append(f"plan approval {key} is invalid")
        records = value.get("material_inputs")
        if not isinstance(records, list) or any(
            not isinstance(item, Mapping)
            or set(item) != {"path", "sha256"}
            or not isinstance(item.get("path"), str)
            or not isinstance(item.get("sha256"), str)
            for item in records or ()
        ):
            errors.append("plan approval material inputs are invalid")
        elif value.get("material_hash") != _digest(canonical_json_bytes(records)):
            errors.append("plan approval material hash does not match its inputs")
        return errors

    @staticmethod
    def _plan_review_evidence_errors(
        relative: str,
        review: Mapping[str, Any],
        material_inputs: object,
    ) -> list[str]:
        """Validate pre-execution evidence against its frozen approval bytes.

        ``TRIAL.json`` may acquire reviewable execution progress after Plan
        Approval. Its current bytes are therefore not the Plan Review's
        evidence boundary; the service-owned approval is.
        """

        approved = {
            str(item.get("path")): str(item.get("sha256"))
            for item in material_inputs or ()
            if isinstance(item, Mapping)
            and isinstance(item.get("path"), str)
            and isinstance(item.get("sha256"), str)
        }
        errors: list[str] = []
        for evidence in review.get("evidence_checked", ()):
            if not isinstance(evidence, Mapping) or evidence.get(
                "source_kind"
            ) == "external_url":
                continue
            raw_path = evidence.get("path")
            try:
                checked = normalize_relative_path(str(raw_path))
            except (TypeError, ValueError) as exc:
                errors.append(
                    f"{relative}: checked evidence path is invalid: {raw_path} ({exc})"
                )
                continue
            approved_hash = approved.get(checked)
            if approved_hash is None:
                errors.append(
                    f"{relative}: checked evidence is not approved plan-time material: "
                    f"{checked}"
                )
            elif evidence.get("sha256") != approved_hash:
                errors.append(
                    f"{relative}: checked evidence hash differs from approved "
                    f"plan-time bytes: {checked}"
                )
        return errors

    def _execution_trial_progress_errors(
        self,
        trial_id: str,
        stage_id: str,
        guard_dir: str | Path,
        approval: Mapping[str, Any],
        current: Mapping[str, Any],
    ) -> list[str]:
        """Validate the reviewed TRIAL charter against its execution proposal.

        TRIAL is unusual: planning creates its charter, execution may propose
        lifecycle/outcome annotations, and the service finalizes it only at
        publication.  The execution guard is therefore the authoritative
        pre-execution copy; comparing the whole current file to PLAN_APPROVAL
        would reject every legitimate status proposal.
        """

        baseline = load_agent_baseline(guard_dir)
        if (
            baseline.project_root != self.root
            or baseline.registry.trial_id != trial_id
            or baseline.registry.attempt_id != stage_id
        ):
            return ["execution guard does not match the approved trial boundary"]
        relative = f"research_trajectory/trials/{trial_id}/TRIAL.json"
        entry = baseline.entries.get(relative)
        if entry is None or entry.kind != "file" or not entry.backup_path:
            return ["execution guard has no approved TRIAL baseline"]
        backup = (baseline.run_dir / entry.backup_path).resolve(strict=False)
        try:
            backup.relative_to(baseline.run_dir.resolve(strict=True))
        except ValueError:
            return ["execution guard TRIAL baseline escapes its private run directory"]
        if backup.is_symlink() or not backup.is_file():
            return ["execution guard TRIAL baseline is not a regular file"]
        data = backup.read_bytes()
        if _digest(data) != entry.sha256:
            return ["execution guard TRIAL baseline hash is invalid"]
        approved_trial_hash = next(
            (
                str(item.get("sha256") or "")
                for item in approval.get("material_inputs", ())
                if isinstance(item, Mapping) and item.get("path") == relative
            ),
            "",
        )
        if approved_trial_hash != entry.sha256:
            return ["PLAN_APPROVAL is not bound to the execution guard TRIAL baseline"]
        baseline_trial = _json(data, str(backup))
        validate_trial_stage_binding(baseline_trial, str(approval["stage_id"]))

        immutable = {
            "schema_version",
            "artifact_type",
            "project_id",
            "trial_id",
            "number",
            "title",
            "target",
            "move",
            "base_revision",
            "review_level",
            "active_line_ids",
            "campaign_ids",
            "stage_id",
            "created_at",
            "publish_revision",
            "closed_at",
        }
        errors = [
            f"TRIAL execution proposal changed approved field: {key}"
            for key in sorted(immutable)
            if current.get(key) != baseline_trial.get(key)
        ]
        lifecycle = str(current.get("lifecycle_state") or "")
        baseline_lifecycle = str(baseline_trial.get("lifecycle_state") or "")
        allowed_lifecycle = {
            baseline_lifecycle,
            "preflight_passed",
            "executing",
            "distilled",
        }
        if lifecycle not in allowed_lifecycle:
            errors.append(
                "TRIAL execution proposal has an invalid pre-publication lifecycle: "
                f"{lifecycle}"
            )
        baseline_extensions = baseline_trial.get("extensions")
        current_extensions = current.get("extensions")
        if not isinstance(baseline_extensions, Mapping) or not isinstance(
            current_extensions, Mapping
        ):
            errors.append("TRIAL execution proposal extensions are invalid")
            return errors
        if current_extensions.get("service_action") != baseline_extensions.get(
            "service_action"
        ):
            errors.append("TRIAL execution proposal changed the service action binding")
        baseline_assignment = baseline_extensions.get("service_assignment")
        current_assignment = current_extensions.get("service_assignment")
        if isinstance(baseline_assignment, Mapping):
            if not isinstance(current_assignment, Mapping):
                errors.append("TRIAL execution proposal removed the service assignment")
            else:
                if current_assignment.get("stage_id") != baseline_assignment.get(
                    "stage_id"
                ):
                    errors.append(
                        "TRIAL execution proposal changed the assigned stage identity"
                    )
                if str(current_assignment.get("phase") or "") not in {
                    str(baseline_assignment.get("phase") or ""),
                    "prepare",
                    "repair",
                }:
                    errors.append(
                        "TRIAL execution proposal has an invalid service-assignment phase"
                    )
        return errors

    def _read_plan_approval(self, relative: str) -> dict[str, Any]:
        path = self._path(relative, must_exist=True)
        if path.is_symlink() or not path.is_file():
            raise V2RuntimeError("plan approval is not a regular service file")
        value = _json(path.read_bytes(), relative)
        errors = self._approval_shape_errors(value)
        if errors:
            raise V2RuntimeError("; ".join(errors))
        return value

    def _current_plan_approval(
        self,
        trial_id: str,
        stage_id: str,
        *,
        execution_guard_dir: str | Path | None = None,
        staged_trial: bool = False,
    ) -> dict[str, Any]:
        relative = self._plan_approval_path(trial_id, stage_id)
        approval = self._read_plan_approval(relative)
        context = self._plan_context(trial_id, stage_id)
        expected = {
            "project_id": self.project_id,
            "trial_id": trial_id,
            "stage_id": stage_id,
            "plan_revision": context["plan"]["plan_revision"],
            "plan_sha256": context["plan_sha256"],
            "plan_review_path": context["plan_review_path"],
            "plan_review_sha256": context["plan_review_sha256"],
        }
        mismatched = [key for key, value in expected.items() if approval.get(key) != value]
        trial_relative = f"research_trajectory/trials/{trial_id}/TRIAL.json"
        if execution_guard_dir is None and not staged_trial:
            if approval.get("material_hash") != context["material_hash"]:
                mismatched.append("material_hash")
            if approval.get("material_inputs") != context["material_inputs"]:
                mismatched.append("material_inputs")
        else:
            approved_static = [
                item
                for item in approval.get("material_inputs", ())
                if isinstance(item, Mapping) and item.get("path") != trial_relative
            ]
            current_static = [
                item
                for item in context["material_inputs"]
                if item.get("path") != trial_relative
            ]
            if approved_static != current_static:
                approved_by_path = {
                    str(item.get("path")): str(item.get("sha256"))
                    for item in approved_static
                    if isinstance(item, Mapping)
                }
                current_by_path = {
                    str(item.get("path")): str(item.get("sha256"))
                    for item in current_static
                    if isinstance(item, Mapping)
                }
                changed_paths = sorted(
                    path
                    for path in set(approved_by_path) | set(current_by_path)
                    if approved_by_path.get(path) != current_by_path.get(path)
                )
                registry = self._guard_registry(trial_id, stage_id)
                if changed_paths and all(
                    registry.is_protected(path) or registry.is_service_only(path)
                    for path in changed_paths
                ):
                    if mismatched:
                        mismatched.append("material_inputs")
                    else:
                        raise StalePlanApprovalError(changed_paths)
                else:
                    mismatched.append("material_inputs")
            if execution_guard_dir is not None:
                trial_errors = self._execution_trial_progress_errors(
                    trial_id,
                    stage_id,
                    execution_guard_dir,
                    approval,
                    context["trial"],
                )
                if trial_errors:
                    mismatched.extend(trial_errors)
        mismatched.extend(
            self._plan_review_evidence_errors(
                context["plan_review_path"],
                context["review"],
                approval.get("material_inputs", ()),
            )
        )
        if mismatched:
            raise V2RuntimeError(
                f"plan approval is stale for current plan-time material: {mismatched}"
            )
        return approval

    def invalidate_stale_plan_approval(
        self,
        trial_id: str,
        stage_id: str,
        *,
        expected_approval_sha256: str | None = None,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        """Archive a stale approved boundary before reopening the same Plan.

        The archive is copied and hash-verified before any active byte is
        removed.  Re-entering after a crash either completes the same cleanup
        or fails closed if a source changed after it was archived.
        """

        require_id("trial", trial_id)
        require_id("stage", stage_id)
        approval_relative = self._plan_approval_path(trial_id, stage_id)
        approval_path = self._path(approval_relative)
        if not (approval_path.exists() or approval_path.is_symlink()):
            if not expected_approval_sha256:
                raise V2RecoveryError("stale Plan Approval is missing")
            archive_relative = (
                f"archive/v2_plan_invalidations/{trial_id}/{stage_id}/"
                f"{expected_approval_sha256}"
            )
            archive_path = self._path(archive_relative)
            manifest_path = archive_path / "MANIFEST.json"
            if (
                archive_path.is_symlink()
                or not archive_path.is_dir()
                or not manifest_path.is_file()
            ):
                raise V2RecoveryError("Plan invalidation archive is incomplete")
            retained = _json(manifest_path.read_bytes(), manifest_path.as_posix())
            if any(
                retained.get(key) != value
                for key, value in (
                    ("project_id", self.project_id),
                    ("trial_id", trial_id),
                    ("stage_id", stage_id),
                    ("approval_sha256", expected_approval_sha256),
                )
            ):
                raise V2RecoveryError("Plan invalidation archive identity differs")
            for record in retained.get("records", ()):
                if not isinstance(record, Mapping):
                    raise V2RecoveryError("Plan invalidation archive record is invalid")
                relative = normalize_relative_path(str(record.get("path") or ""))
                payload = archive_path / "payload" / relative
                if payload.is_symlink() or not payload.is_file():
                    raise V2RecoveryError(
                        f"Plan invalidation archive omitted retained bytes: {relative}"
                    )
                if _digest(payload.read_bytes()) != record.get("sha256"):
                    raise V2RecoveryError(
                        f"Plan invalidation archive hash differs: {relative}"
                    )
                if record.get("remove_from_active"):
                    active = self._path(relative)
                    if active.exists() or active.is_symlink():
                        raise V2RecoveryError(
                            "Plan invalidation cleanup stopped before its approval "
                            f"commit marker: {relative}"
                        )
            return {
                "status": "plan_ready",
                "trial_id": trial_id,
                "stage_id": stage_id,
                "archive_path": archive_relative,
                "approval_sha256": expected_approval_sha256,
                "changed_service_paths": list(
                    retained.get("changed_service_paths") or ()
                ),
                "recovered": True,
            }
        if approval_path.is_symlink() or not approval_path.is_file():
            raise V2RecoveryError("stale Plan Approval is not a regular file")
        approval_bytes = approval_path.read_bytes()
        approval = self._read_plan_approval(approval_relative)
        try:
            self._current_plan_approval(trial_id, stage_id, staged_trial=True)
        except StalePlanApprovalError as exc:
            changed_paths = exc.paths
        except V2RuntimeError as exc:
            raise V2RecoveryError(
                "Plan Approval differs for an agent-controlled or malformed input; "
                "trusted service invalidation is not permitted: " + str(exc)
            ) from exc
        else:
            raise V2RuntimeError("Plan Approval is current and cannot be invalidated")

        approval_sha256 = _digest(approval_bytes)
        if (
            expected_approval_sha256
            and expected_approval_sha256 != approval_sha256
        ):
            raise V2RecoveryError(
                "active Plan Approval differs from the pending invalidation binding"
            )
        archive_relative = (
            f"archive/v2_plan_invalidations/{trial_id}/{stage_id}/"
            f"{approval_sha256}"
        )
        archive_path = self._path(archive_relative)
        archive_parent = archive_path.parent
        temporary = archive_parent / f".{approval_sha256}.archive"

        plan_review_relative = str(approval["plan_review_path"])
        cleanup_paths = {
            approval_relative,
            plan_review_relative,
            plan_review_relative[:-5] + ".md",
            *self._preexecution_output_paths(trial_id, stage_id),
        }
        snapshot_paths = set(cleanup_paths)
        approved_hashes = {
            str(item["path"]): str(item["sha256"])
            for item in approval.get("material_inputs", ())
            if isinstance(item, Mapping)
        }
        snapshot_paths.update(approved_hashes)

        records: list[dict[str, Any]] = []
        for relative in sorted(snapshot_paths):
            normalized = normalize_relative_path(relative)
            source = self._path(normalized)
            if not (source.exists() or source.is_symlink()):
                if normalized in cleanup_paths:
                    raise V2RecoveryError(
                        f"stale Plan invalidation source is missing: {normalized}"
                    )
                continue
            if source.is_symlink() or not source.is_file():
                raise V2RecoveryError(
                    f"stale Plan invalidation source is not a regular file: {normalized}"
                )
            data = source.read_bytes()
            records.append(
                {
                    "path": normalized,
                    "sha256": _digest(data),
                    "approved_sha256": approved_hashes.get(normalized),
                    "remove_from_active": normalized in cleanup_paths,
                }
            )

        manifest = {
            "schema_version": "1",
            "record_type": "plan_invalidation_archive",
            "project_id": self.project_id,
            "trial_id": trial_id,
            "stage_id": stage_id,
            "approval_sha256": approval_sha256,
            "changed_service_paths": changed_paths,
            "created_at": created_at or utc_z_timestamp(),
            "records": records,
        }

        if archive_path.exists() or archive_path.is_symlink():
            manifest_path = archive_path / "MANIFEST.json"
            if archive_path.is_symlink() or not manifest_path.is_file():
                raise V2RecoveryError("Plan invalidation archive is incomplete")
            retained = _json(manifest_path.read_bytes(), manifest_path.as_posix())
            for key in ("project_id", "trial_id", "stage_id", "approval_sha256"):
                if retained.get(key) != manifest[key]:
                    raise V2RecoveryError(
                        "Plan invalidation archive identity does not match the active approval"
                    )
            records = list(retained.get("records") or ())
            changed_paths = list(retained.get("changed_service_paths") or ())
        else:
            _transaction._ensure_directory(archive_parent, 0o700)
            if temporary.exists() or temporary.is_symlink():
                if temporary.is_symlink() or not temporary.is_dir():
                    raise V2RecoveryError(
                        "incomplete Plan invalidation archive is not a directory"
                    )
                shutil.rmtree(temporary)
            _transaction._ensure_directory(temporary / "payload", 0o700)
            try:
                for record in records:
                    source = self._path(str(record["path"]), must_exist=True)
                    _transaction._atomic_write(
                        temporary / "payload" / str(record["path"]),
                        source.read_bytes(),
                        0o600,
                    )
                _transaction._atomic_write(
                    temporary / "MANIFEST.json",
                    canonical_json_bytes(manifest),
                    0o600,
                )
                _transaction._fsync_directory(temporary)
                temporary.replace(archive_path)
                _transaction._fsync_directory(archive_parent)
            except BaseException:
                if temporary.is_dir() and not temporary.is_symlink():
                    shutil.rmtree(temporary)
                    _transaction._fsync_directory(archive_parent)
                raise

        cleanup_records = sorted(
            records,
            key=lambda item: str(item.get("path") or "") == approval_relative,
        )
        for record in cleanup_records:
            relative = normalize_relative_path(str(record.get("path") or ""))
            retained = archive_path / "payload" / relative
            if retained.is_symlink() or not retained.is_file():
                raise V2RecoveryError(
                    f"Plan invalidation archive omitted retained bytes: {relative}"
                )
            if _digest(retained.read_bytes()) != record.get("sha256"):
                raise V2RecoveryError(
                    f"Plan invalidation archive hash differs: {relative}"
                )
            if not record.get("remove_from_active"):
                continue
            source = self._path(relative)
            if not (source.exists() or source.is_symlink()):
                continue
            if source.is_symlink() or not source.is_file():
                raise V2RecoveryError(
                    f"active invalidation source changed type: {relative}"
                )
            if _digest(source.read_bytes()) != record.get("sha256"):
                raise V2RecoveryError(
                    f"active invalidation source changed after archival: {relative}"
                )
            source.unlink()

        # PLAN_APPROVAL is the commit marker and is deliberately removed last.
        # If it is absent, every other cleanup record has already been
        # hash-verified, removed, and retained in the immutable archive.

        # Retain empty structural directories.  They are part of the guard
        # baseline created by initialize_trial; removing them would make the
        # next legitimate Plan write look like an out-of-root directory
        # creation even though its files are explicitly allowed.
        retained_roots = (
            self._path(f"research_trajectory/trials/{trial_id}"),
            self._path(f"research_trajectory/.staging/{trial_id}/{stage_id}"),
        )
        for root in retained_roots:
            if root.is_dir():
                _transaction._fsync_directory(root)
        return {
            "status": "plan_ready",
            "trial_id": trial_id,
            "stage_id": stage_id,
            "archive_path": archive_relative,
            "approval_sha256": approval_sha256,
            "changed_service_paths": changed_paths,
        }

    def stale_plan_invalidation_identity(
        self, trial_id: str, stage_id: str
    ) -> dict[str, Any]:
        """Return the exact trusted approval that a service refresh invalidated."""

        require_id("trial", trial_id)
        require_id("stage", stage_id)
        relative = self._plan_approval_path(trial_id, stage_id)
        path = self._path(relative, must_exist=True)
        if path.is_symlink() or not path.is_file():
            raise V2RecoveryError("stale Plan Approval is not a regular file")
        try:
            self._current_plan_approval(trial_id, stage_id, staged_trial=True)
        except StalePlanApprovalError as exc:
            return {
                "approval_sha256": _digest(path.read_bytes()),
                "changed_service_paths": exc.paths,
            }
        except V2RuntimeError as exc:
            raise V2RecoveryError(
                "Plan Approval is not eligible for trusted service invalidation: "
                + str(exc)
            ) from exc
        raise V2RuntimeError("Plan Approval is current and cannot be invalidated")

    def _prior_plan_approvals(
        self, trial_id: str, stage_id: str
    ) -> list[dict[str, Any]]:
        root = self._path(f"research_trajectory/.staging/{trial_id}")
        if not root.is_dir() or root.is_symlink():
            return []
        current_trial = self._load_artifact(
            f"research_trajectory/trials/{trial_id}/TRIAL.json", "trial"
        )
        current_action = current_trial.get("extensions", {}).get("service_action")
        approvals: list[dict[str, Any]] = []
        for path in sorted(root.glob(f"STAGE-{trial_id[:6]}-*/{_PLAN_APPROVAL_NAME}")):
            if path.parent.name == stage_id:
                continue
            approvals.append(
                self._read_plan_approval(path.relative_to(self.root).as_posix())
            )
        archived = self._path(f"archive/v2_plan_invalidations/{trial_id}")
        if archived.is_dir() and not archived.is_symlink():
            for path in sorted(
                archived.glob("STAGE-*/[0-9a-f]*/payload/**/PLAN_APPROVAL.json")
            ):
                if not path.is_file() or path.is_symlink():
                    continue
                parts = path.relative_to(archived).parts
                if len(parts) < 4 or parts[2] != "payload":
                    continue
                archived_trial_path = (
                    archived
                    / parts[0]
                    / parts[1]
                    / "payload"
                    / "research_trajectory"
                    / "trials"
                    / trial_id
                    / "TRIAL.json"
                )
                if archived_trial_path.is_symlink() or not archived_trial_path.is_file():
                    continue
                archived_trial = self._load_candidate_artifact(
                    archived_trial_path.relative_to(self.root).as_posix(),
                    f"research_trajectory/trials/{trial_id}/TRIAL.json",
                    "trial",
                )
                if (
                    archived_trial.get("trial_id") != trial_id
                    or archived_trial.get("extensions", {}).get("service_action")
                    != current_action
                ):
                    continue
                approvals.append(
                    self._read_plan_approval(path.relative_to(self.root).as_posix())
                )
        return approvals

    def approve_plan(
        self,
        trial_id: str,
        stage_id: str,
        *,
        plan_guard_dir: str | Path,
        agent_guard_dir: str | Path,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        """Audit planning, persist its service checkpoint, and open execution."""

        try:
            require_id("trial", trial_id)
            require_id("stage", stage_id)
            try:
                guard = self._audit_guard(
                    plan_guard_dir,
                    trial_id,
                    stage_id,
                    self._plan_guard_registry(trial_id, stage_id),
                )
            except Exception as exc:
                return _status(
                    "recovery_required",
                    errors=[str(exc)],
                    guard_audit_failed=True,
                    publishable=False,
                )
            if not guard["publishable"]:
                return _status(
                    "protocol_violation",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    guard=guard,
                    new_stage_required=True,
                    publishable=False,
                )
            prior = self._prior_plan_approvals(trial_id, stage_id)
            premature = self._preexecution_output_paths(trial_id, stage_id)
            if prior:
                current_stage = (
                    f"research_trajectory/.staging/{trial_id}/{stage_id}/"
                )
                premature = [
                    relative
                    for relative in premature
                    if relative.startswith(current_stage)
                ]
            if premature:
                raise V2RuntimeError(
                    f"execution outputs exist before plan approval: {premature}"
                )
            trial_root = f"research_trajectory/trials/{trial_id}"
            pair_errors = self._prepare_artifact_pairs({
                f"{trial_root}/TRIAL.json": ("trial", False),
                f"{trial_root}/PLAN.json": ("plan", True),
                f"{trial_root}/EXPERT_ROUTE.json": ("expert_route", True),
                f"{trial_root}/reviews/PLAN_REVIEW.json": ("reviewer_output", True),
            }) if not (self._path(self._plan_approval_path(trial_id, stage_id)).exists()
                       or self._path(self._plan_approval_path(trial_id, stage_id)).is_symlink()) else []
            if pair_errors:
                return _status("plan_rejected", errors=pair_errors,
                               retry_same_stage=True, publishable=False, guard=guard)
            context = self._plan_context(
                trial_id, stage_id, plan_guard_dir=plan_guard_dir
            )
            plan_evidence_errors = self._plan_review_evidence_errors(
                context["plan_review_path"],
                context["review"],
                context["material_inputs"],
            )
            if plan_evidence_errors:
                raise V2RuntimeError("; ".join(plan_evidence_errors))
            relative = self._plan_approval_path(trial_id, stage_id)
            target = self._path(relative)
            recovered = target.is_file() and not target.is_symlink()
            if recovered:
                approval = self._current_plan_approval(trial_id, stage_id)
            else:
                if prior:
                    previous = max(
                        prior,
                        key=lambda item: (
                            int(item["plan_revision"]),
                            str(item["approved_at"]),
                        ),
                    )
                    revision = int(context["plan"]["plan_revision"])
                    if revision < int(previous["plan_revision"]):
                        raise V2RuntimeError("plan_revision cannot decrease")
                    trial_relative = (
                        f"research_trajectory/trials/{trial_id}/TRIAL.json"
                    )
                    current_assumptions = [
                        item
                        for item in context["material_inputs"]
                        if item.get("path") != trial_relative
                    ]
                    previous_assumptions = [
                        item
                        for item in previous["material_inputs"]
                        if item.get("path") != trial_relative
                    ]
                    if _digest(canonical_json_bytes(current_assumptions)) != _digest(
                        canonical_json_bytes(previous_assumptions)
                    ):
                        if revision <= int(previous["plan_revision"]):
                            raise V2RuntimeError(
                                "changed Scout/preflight assumptions require a plan_revision "
                                "greater than the last approved revision "
                                f"{previous['plan_revision']}"
                            )
                        if context["plan_review_sha256"] == previous["plan_review_sha256"]:
                            raise V2RuntimeError(
                                "changed Scout/preflight assumptions require a new PLAN_REVIEW"
                            )
                approval = {
                    "schema_version": "1",
                    "record_type": "plan_approval",
                    "project_id": self.project_id,
                    "trial_id": trial_id,
                    "stage_id": stage_id,
                    "plan_revision": context["plan"]["plan_revision"],
                    "plan_sha256": context["plan_sha256"],
                    "plan_review_path": context["plan_review_path"],
                    "plan_review_sha256": context["plan_review_sha256"],
                    "material_hash": context["material_hash"],
                    "material_inputs": context["material_inputs"],
                    "approved_at": created_at or utc_z_timestamp(),
                }
                errors = self._approval_shape_errors(approval)
                if errors:
                    raise V2RuntimeError("; ".join(errors))
                self._write_artifact(relative, approval)
            capture_agent_baseline(
                self.root,
                agent_guard_dir,
                trial_id=trial_id,
                attempt_id=stage_id,
                registry=self._guard_registry(trial_id, stage_id),
            )
            return _status(
                "execution_ready",
                trial_id=trial_id,
                stage_id=stage_id,
                plan_revision=approval["plan_revision"],
                plan_approval_path=relative,
                plan_approval_sha256=_digest(
                    self._path(relative, must_exist=True).read_bytes()
                ),
                agent_guard_dir=str(Path(agent_guard_dir).resolve()),
                guard=guard,
                recovered=recovered,
            )
        except (
            GuardError,
            KeyError,
            OSError,
            TypeError,
            ValueError,
            V2RuntimeError,
            _transaction.TransactionError,
        ) as exc:
            approval_path = self._path(self._plan_approval_path(trial_id, stage_id))
            retry_same_stage = not (approval_path.exists() or approval_path.is_symlink())
            return _status(
                "plan_rejected",
                trial_id=trial_id,
                stage_id=stage_id,
                errors=[str(exc)],
                new_stage_required=not retry_same_stage,
                retry_same_stage=retry_same_stage,
                publishable=False,
            )

    def _replace_review_manifest(
        self, trial_id: str, stage_id: str, manifest: Mapping[str, Any]
    ) -> None:
        relative = f"research_trajectory/trials/{trial_id}/reviews/REVIEW_MANIFEST.json"
        path = self._path(relative)
        markdown_path = self._path(relative[:-5] + ".md")
        if not (path.exists() or path.is_symlink()) and (
            markdown_path.exists() or markdown_path.is_symlink()
        ):
            raise V2RuntimeError(
                "incomplete prior Review Manifest pair requires recovery"
            )
        if path.exists() or path.is_symlink():
            old = self._load_artifact(relative, "review_manifest", paired=True)
            if old.get("stage_id") == stage_id:
                raise V2RuntimeError(
                    "this immutable stage already has a Review Manifest"
                )
            old_stage = old.get("stage_id")
            old_manifest = self._path(stage_manifest_path(trial_id, str(old_stage)))
            if not old_manifest.is_file():
                raise V2RuntimeError("prior review stage was not retained")
            self._archive_current_reviews(trial_id, require_id("stage", old_stage))
        self._write_pair(relative, manifest)

    def _recover_review_manifest_pair(
        self,
        trial_id: str,
        stage_id: str,
        stage: Mapping[str, Any],
        route_inputs: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        """Finish an interrupted service-owned JSON/Markdown pair deterministically."""

        relative = f"research_trajectory/trials/{trial_id}/reviews/REVIEW_MANIFEST.json"
        path = self._path(relative)
        markdown_relative = relative[:-5] + ".md"
        markdown_path = self._path(markdown_relative)
        json_present = path.exists() or path.is_symlink()
        markdown_present = markdown_path.exists() or markdown_path.is_symlink()
        if not json_present:
            if markdown_present:
                raise V2RuntimeError(
                    "orphan Review Manifest Markdown has no authoritative JSON"
                )
            return None
        if path.is_symlink() or not path.is_file():
            raise V2RuntimeError("Review Manifest JSON is not a regular file")
        review = self._load_artifact(relative, "review_manifest")
        if review.get("trial_id") != trial_id or review.get("stage_id") != stage_id:
            raise V2RuntimeError(
                "Review Manifest does not bind the requested trial/stage"
            )
        expected = build_review_manifest(
            project_id=self.project_id,
            trial_id=trial_id,
            stage_manifest=stage,
            route_inputs=route_inputs,
            created_at=str(review.get("created_at") or ""),
        )
        if review != expected:
            raise V2RuntimeError(
                "persisted Review Manifest differs from deterministic routing"
            )
        if not markdown_present:
            self._write_bytes(
                markdown_relative, render_markdown(review).encode("utf-8")
            )
        return self._review_manifest(trial_id, stage_id)

    def _archive_current_reviews(
        self,
        trial_id: str,
        old_stage: str,
        *,
        require_manifest: bool = True,
    ) -> None:
        review_dir = self._path(f"research_trajectory/trials/{trial_id}/reviews")
        history = self._path(f"research_trajectory/trials/{trial_id}/reviews/history")
        destination = history / old_stage
        temporary = history / f".{old_stage}.archive"
        if destination.exists() or destination.is_symlink():
            raise V2RuntimeError("prior review history already exists and is immutable")
        if temporary.exists() or temporary.is_symlink():
            raise V2RuntimeError("incomplete review history archive requires recovery")

        sources = sorted(
            path for path in review_dir.iterdir() if path.suffix in {".json", ".md"}
        )
        names = {path.name for path in sources}
        required = (
            {"REVIEW_MANIFEST.json", "REVIEW_MANIFEST.md"}
            if require_manifest
            else {"PLAN_REVIEW.json", "PLAN_REVIEW.md"}
        )
        if required - names:
            kind = "manifest" if require_manifest else "pre-execution plan"
            raise V2RuntimeError(
                f"current review namespace lacks its {kind} pair"
            )
        for source in sources:
            if source.is_symlink() or not source.is_file():
                raise V2RuntimeError(
                    f"current review artifact is not a regular file: {source.name}"
                )

        _transaction._ensure_directory(temporary, 0o700)
        try:
            for source in sources:
                _transaction._atomic_write(
                    temporary / source.name,
                    source.read_bytes(),
                    0o600,
                )
            _transaction._fsync_directory(temporary)
            if destination.exists() or destination.is_symlink():
                raise V2RuntimeError(
                    "prior review history already exists and is immutable"
                )
            temporary.replace(destination)
            _transaction._fsync_directory(history)
        except BaseException:
            if temporary.is_dir() and not temporary.is_symlink():
                shutil.rmtree(temporary)
                _transaction._fsync_directory(history)
            raise

        for source in sources:
            source.unlink()
        _transaction._fsync_directory(review_dir)

    def _derive_candidate_critical_path(
        self, trial_id: str, stage_id: str
    ) -> list[dict[str, str]]:
        """Replace a proposed STATE Critical Path with the service projection."""

        candidate_root = (
            f"research_trajectory/.staging/{trial_id}/{stage_id}/candidate"
        )
        state_relative = f"{candidate_root}/research_trajectory/STATE.json"
        state_path = self._path(state_relative)
        candidate_state_exists = state_path.exists() or state_path.is_symlink()

        def projected_artifacts(
            directory: str, pattern: str, artifact_type: str
        ) -> list[dict[str, Any]]:
            by_name: dict[str, dict[str, Any]] = {}
            candidate_directory = self._path(f"{candidate_root}/{directory}")
            if candidate_directory.is_symlink():
                raise V2RuntimeError(
                    f"candidate Critical Path input is a symlink: {directory}"
                )
            if candidate_directory.is_dir():
                for path in sorted(candidate_directory.glob(pattern)):
                    relative = path.relative_to(self.root).as_posix()
                    by_name[path.name] = self._load_candidate_artifact(
                        relative,
                        f"{directory}/{path.name}",
                        artifact_type,
                        paired=True,
                    )
            canonical = self._path(directory)
            if canonical.is_symlink():
                raise V2RuntimeError(
                    f"canonical Critical Path input is a symlink: {directory}"
                )
            if canonical.is_dir():
                for path in sorted(canonical.glob(pattern)):
                    # A valid candidate is the proposed replacement for this
                    # exact canonical artifact.  Do not require the old pair
                    # to be readable when the transaction is repairing it.
                    if path.name in by_name:
                        continue
                    relative = path.relative_to(self.root).as_posix()
                    by_name[path.name] = self._load_artifact(
                        relative, artifact_type, paired=True
                    )
            return [by_name[name] for name in sorted(by_name)]

        lines = projected_artifacts(
            "research_trajectory/lines", "L[0-9][0-9][0-9][0-9].json", "line"
        )
        campaigns = projected_artifacts(
            "research_trajectory/campaigns",
            "C[0-9][0-9][0-9][0-9].json",
            "campaign",
        )
        stage_root = f"research_trajectory/.staging/{trial_id}/{stage_id}"
        brief = self._load_artifact(
            f"{stage_root}/HUMAN_BRIEF.json", "human_brief", paired=True
        )
        evidence = self._load_artifact(
            f"{stage_root}/GATE_EVIDENCE.json", "gate_evidence", paired=True
        )

        action = brief.get("human_action")
        human_locks: list[dict[str, Any]] = []
        if (
            isinstance(action, Mapping)
            and action.get("needed") is True
            and action.get("blocking") is True
        ):
            description = str(
                action.get("why_needed") or action.get("question") or ""
            ).strip()
            if not description:
                raise V2RuntimeError(
                    "a blocking human action lacks an executable description"
                )
            human_locks.append(
                {
                    "source": f"{stage_root}/HUMAN_BRIEF.json#human_action",
                    "description": description,
                    "blocking": True,
                    "resolved": False,
                }
            )

        dependencies: list[dict[str, Any]] = []
        if evidence.get("operational_blocker") is True:
            reasons = [
                str(item).strip()
                for item in evidence.get("reasons", ())
                if str(item).strip()
            ]
            description = str(brief.get("current_bottleneck") or "").strip()
            if not description and reasons:
                description = reasons[0]
            if not description:
                raise V2RuntimeError(
                    "an operational blocker lacks an executable description"
                )
            dependencies.append(
                {
                    "source": f"{stage_root}/GATE_EVIDENCE.json#operational_blocker",
                    "description": description,
                    "criticality": "research-critical",
                    "status": "blocked",
                    "human_only": False,
                }
            )

        critical_path = derive_critical_path(
            lines, campaigns, human_locks, dependencies
        )
        if candidate_state_exists:
            state = self._load_candidate_artifact(
                state_relative,
                "research_trajectory/STATE.json",
                "project_state",
                paired=True,
            )
        else:
            canonical_state_path = self._path("research_trajectory/STATE.json")
            if not (
                canonical_state_path.exists() or canonical_state_path.is_symlink()
            ):
                candidate_inputs = any(
                    self._path(f"{candidate_root}/{directory}").is_dir()
                    and any(
                        self._path(f"{candidate_root}/{directory}").glob(pattern)
                    )
                    for directory, pattern in _CANONICAL_JSON_GLOBS
                )
                if candidate_inputs or critical_path:
                    raise V2RuntimeError(
                        "candidate Critical Path inputs require a canonical or candidate STATE"
                    )
                return critical_path
            # A line/campaign candidate can change the Critical Path even when
            # the worker omitted STATE.  Start from canonical state and create
            # a service-derived candidate only when the projection differs.
            # Migration preserves legacy Markdown. This projection reads only
            # validated JSON; any changed candidate gets a newly rendered pair.
            state = self._load_artifact(
                "research_trajectory/STATE.json", "project_state"
            )
        if state.get("critical_path") != critical_path:
            state["critical_path"] = critical_path
            errors = validate_artifact(
                state,
                expected_type="project_state",
                path="research_trajectory/STATE.json",
                schema_dir=self.schema_dir,
            )
            if errors:
                raise V2RuntimeError(
                    "derived candidate STATE is invalid: " + "; ".join(errors)
                )
            self._write_pair(state_relative, state)
        return critical_path

    def stage_trial(
        self,
        trial_id: str,
        stage_id: str,
        *,
        agent_guard_dir: str | Path,
        review_guard_dir: str | Path,
        route_inputs: Mapping[str, Any],
        additional_material_roles: Mapping[str, str] | None = None,
        created_at: str | None = None,
    ) -> dict[str, Any]:
        """Audit agent writes, hash the exact stage, route review, and freeze service files."""

        try:
            require_id("trial", trial_id)
            require_id("stage", stage_id)
            try:
                guard = self._audit_guard(
                    agent_guard_dir,
                    trial_id,
                    stage_id,
                    self._guard_registry(trial_id, stage_id),
                )
            except Exception as exc:
                return _status(
                    "recovery_required",
                    errors=[str(exc)],
                    guard_audit_failed=True,
                    publishable=False,
                )
            if not guard["publishable"]:
                return _status(
                    "protocol_violation",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    guard=guard,
                    publishable=False,
                )
            existing_manifest = self._path(stage_manifest_path(trial_id, stage_id))
            if not (existing_manifest.exists() or existing_manifest.is_symlink()):
                pair_errors = self._prepare_artifact_pairs(
                    self._execution_artifact_specs(trial_id, stage_id))
                if pair_errors:
                    return _status("repair", trial_id=trial_id, stage_id=stage_id,
                                   errors=pair_errors, retry_same_stage=True,
                                   new_stage_required=False, publishable=False, guard=guard)
            approval = self._current_plan_approval(
                trial_id,
                stage_id,
                execution_guard_dir=agent_guard_dir,
            )
            candidate_preimages = {}
            for name in ("STATE", "CURRENT_FINDINGS"):
                for suffix in ("json", "md"):
                    relative = (
                        f"research_trajectory/.staging/{trial_id}/{stage_id}"
                        f"/candidate/research_trajectory/{name}.{suffix}"
                    )
                    path = self._path(relative)
                    if path.is_file() and not path.is_symlink():
                        candidate_preimages[relative] = path.read_bytes()
            derived_critical_path = self._derive_candidate_critical_path(
                trial_id, stage_id
            )
            self._restore_unstaged_result_card_lock(
                trial_id, stage_id, agent_guard_dir
            )
            self._restore_committed_result_card_evidence(
                trial_id, stage_id, agent_guard_dir
            )
            self._freeze_result_cards(trial_id, stage_id)
            routing_relative = f"research_trajectory/.staging/{trial_id}/{stage_id}/ROUTING_INPUTS.json"
            routing_value = dict(route_inputs)
            candidate_root = (
                f"research_trajectory/.staging/{trial_id}/{stage_id}/candidate"
            )
            if any(
                self._path(f"{candidate_root}/{relative}").is_file()
                and not self._path(f"{candidate_root}/{relative}").is_symlink()
                for relative in _MANUSCRIPT_PATHS
            ):
                routing_value["manuscript_or_claim_hierarchy_changed"] = True
            self._write_artifact(routing_relative, routing_value)
            routing = _json(
                self._path(routing_relative, must_exist=True).read_bytes(),
                routing_relative,
            )
            if canonical_json_bytes(routing) != canonical_json_bytes(routing_value):
                raise V2RuntimeError(
                    "service routing inputs differ from the exact staged ROUTING_INPUTS.json"
                )
            base_revision = self.transactions.current_revision()
            manifest_relative = stage_manifest_path(trial_id, stage_id)
            manifest_path = self._path(manifest_relative)
            recovered_stage = manifest_path.exists() or manifest_path.is_symlink()
            if recovered_stage:
                stage = self._load_artifact(
                    manifest_relative, "staged_update_manifest"
                )
                if (
                    stage.get("project_id") != self.project_id
                    or stage.get("trial_id") != trial_id
                    or stage.get("stage_id") != stage_id
                    or stage.get("base_revision") != base_revision
                ):
                    raise V2RuntimeError(
                        "persisted staged manifest identity or base revision differs"
                    )
                drift = verify_stage_from_project(
                    self.root,
                    stage,
                    additional_material_roles=additional_material_roles,
                )
                if drift:
                    raise V2RuntimeError("; ".join(drift))
                self._persist_stage_material_snapshots(stage)
            else:
                self._prepare_revision_candidates(
                    trial_id, stage_id, base_revision
                )
                self._rebind_candidate_projection_references(
                    trial_id, stage_id, candidate_preimages
                )
                trial_root = f"research_trajectory/trials/{trial_id}"
                cards = self._load_artifact(
                    f"{trial_root}/RESULT_CARDS.json",
                    "result_cards",
                    paired=True,
                )
                request = self._load_artifact(
                    f"{trial_root}/MERGE_REQUEST.json",
                    "merge_request",
                    paired=True,
                )
                promotion_errors = self._manuscript_promotion_errors(
                    trial_id, stage_id, cards, request
                )
                if promotion_errors:
                    self._restore_unstaged_result_card_lock(
                        trial_id, stage_id, agent_guard_dir
                    )
                    return _status(
                        "repair",
                        trial_id=trial_id,
                        stage_id=stage_id,
                        errors=promotion_errors,
                        new_stage_required=False,
                        retry_same_stage=True,
                        guard=guard,
                        publishable=False,
                    )
                stage = stage_from_project(
                    self.root,
                    project_id=self.project_id,
                    trial_id=trial_id,
                    stage_id=stage_id,
                    base_revision=base_revision,
                    additional_material_roles=additional_material_roles,
                    created_at=created_at,
                )
            trial_root = f"research_trajectory/trials/{trial_id}"
            plan = self._load_artifact(f"{trial_root}/PLAN.json", "plan", paired=True)
            report = self._load_artifact(
                f"{trial_root}/REPORT.json", "report", paired=True
            )
            request = self._load_artifact(
                f"{trial_root}/MERGE_REQUEST.json", "merge_request", paired=True
            )
            boundary_errors = scope_boundary_errors(plan, report, request, stage)
            if boundary_errors:
                self._restore_unstaged_result_card_lock(
                    trial_id, stage_id, agent_guard_dir
                )
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=boundary_errors,
                    new_stage_required=False,
                    retry_same_stage=True,
                    guard=guard,
                    publishable=False,
                )
            candidate_errors = self._candidate_contract_errors(
                stage, self._candidate_files(stage)
            )
            candidate_errors.extend(cross_artifact_errors(
                list(self._load_material(trial_id, stage_id).values())))
            result_cards = self._load_artifact(f"{trial_root}/RESULT_CARDS.json", "result_cards")
            proposal = prepare_card_decisions(
                merge_request=request,
                result_cards=result_cards,
                operations=stage.get("operations", ()), candidate_files=self._candidate_files(stage),
                base_projection=self._base_projection(stage), trial_id=trial_id,
                project_id=self.project_id,
                prior_card_ids=self._verified_prior_card_ids(
                    trial_id, stage["base_revision"],
                    result_cards,
                ),
            )
            candidate_errors.extend(proposal["errors"])
            if candidate_errors:
                self._restore_unstaged_result_card_lock(
                    trial_id, stage_id, agent_guard_dir
                )
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=list(dict.fromkeys(candidate_errors)),
                    new_stage_required=recovered_stage,
                    retry_same_stage=not recovered_stage,
                    old_stage_retained=recovered_stage,
                    guard=guard,
                    publishable=False,
                )
            brief = self._load_artifact(
                f"research_trajectory/.staging/{trial_id}/{stage_id}/HUMAN_BRIEF.json",
                "human_brief",
                paired=True,
            )
            evidence = self._load_artifact(
                f"research_trajectory/.staging/{trial_id}/{stage_id}/GATE_EVIDENCE.json",
                "gate_evidence",
                paired=True,
            )
            gate_errors = self._pre_review_human_brief_gate_errors(brief, evidence)
            if gate_errors:
                self._restore_unstaged_result_card_lock(
                    trial_id, stage_id, agent_guard_dir
                )
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=gate_errors,
                    new_stage_required=False,
                    retry_same_stage=True,
                    guard=guard,
                    publishable=False,
                )
            review_relative = (
                f"research_trajectory/trials/{trial_id}/reviews/"
                "REVIEW_MANIFEST.json"
            )
            review = (
                self._recover_review_manifest_pair(
                    trial_id, stage_id, stage, routing
                )
                if recovered_stage
                else None
            )
            if review is None:
                review = build_review_manifest(
                    project_id=self.project_id,
                    trial_id=trial_id,
                    stage_manifest=stage,
                    route_inputs=routing,
                    created_at=created_at,
                )
                if not recovered_stage:
                    self._commit_stage_manifest(manifest_relative, stage)
                self._replace_review_manifest(trial_id, stage_id, review)
            baseline_path = Path(review_guard_dir) / "baseline.json"
            if baseline_path.is_file() and not baseline_path.is_symlink():
                baseline = load_agent_baseline(review_guard_dir)
                if (
                    baseline.project_root != self.root
                    or baseline.registry
                    != self._guard_registry(trial_id, stage_id)
                ):
                    raise V2RuntimeError(
                        "persisted review guard does not belong to this exact stage"
                    )
            else:
                capture_agent_baseline(
                    self.root,
                    review_guard_dir,
                    trial_id=trial_id,
                    attempt_id=stage_id,
                    registry=self._guard_registry(trial_id, stage_id),
                )
            paths = review_output_paths(trial_id, review)
            return _status(
                "needs_review",
                trial_id=trial_id,
                stage_id=stage_id,
                stage_manifest=stage,
                review_manifest=review,
                review_output_paths=paths,
                review_guard_dir=str(Path(review_guard_dir).resolve()),
                plan_approval=approval,
                derived_critical_path=derived_critical_path,
                guard=guard,
                recovered=recovered_stage,
                publishable=False,
            )
        except InvalidTrialStageError as exc:
            return _status(
                "repair",
                trial_id=trial_id,
                stage_id=stage_id,
                errors=[str(exc)],
                retry_same_stage=False,
                new_stage_required=True,
                publishable=False,
            )
        except StalePlanApprovalError as exc:
            return _status(
                "stale_plan_approval",
                trial_id=trial_id,
                stage_id=stage_id,
                errors=[str(exc)],
                changed_service_paths=exc.paths,
                retry_same_stage=True,
                new_stage_required=False,
                guard=guard,
                publishable=False,
            )
        except V2RecoveryError as exc:
            return _status(
                "recovery_required",
                trial_id=trial_id,
                stage_id=stage_id,
                errors=[str(exc)],
                retry_same_stage=True,
                new_stage_required=False,
                publishable=False,
            )
        except (
            GuardError,
            KeyError,
            OSError,
            TypeError,
            ValueError,
            V2RuntimeError,
            _transaction.TransactionError,
        ) as exc:
            stage_path = self._path(stage_manifest_path(trial_id, stage_id))
            if not (stage_path.exists() or stage_path.is_symlink()):
                try:
                    self._restore_unstaged_result_card_lock(
                        trial_id, stage_id, agent_guard_dir
                    )
                except (GuardError, OSError, V2RecoveryError) as recovery_exc:
                    return _status(
                        "recovery_required",
                        trial_id=trial_id,
                        stage_id=stage_id,
                        errors=[str(exc), str(recovery_exc)],
                        retry_same_stage=True,
                        new_stage_required=False,
                        publishable=False,
                    )
            review_json = self._path(
                f"research_trajectory/trials/{trial_id}/reviews/REVIEW_MANIFEST.json"
            )
            review_markdown = self._path(
                f"research_trajectory/trials/{trial_id}/reviews/REVIEW_MANIFEST.md"
            )
            interrupted_service_pair = (
                stage_path.is_file()
                and not stage_path.is_symlink()
                and review_json.is_file()
                and not review_json.is_symlink()
                and not (review_markdown.exists() or review_markdown.is_symlink())
            )
            if interrupted_service_pair:
                return _status(
                    "recovery_required",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=[str(exc)],
                    retry_same_stage=True,
                    new_stage_required=False,
                    publishable=False,
                )
            retry_same_stage = not (stage_path.exists() or stage_path.is_symlink())
            return _status(
                "repair",
                trial_id=trial_id,
                stage_id=stage_id,
                errors=[str(exc)],
                new_stage_required=not retry_same_stage,
                retry_same_stage=retry_same_stage,
                publishable=False,
            )

    def _review_manifest(self, trial_id: str, stage_id: str) -> dict[str, Any]:
        relative = f"research_trajectory/trials/{trial_id}/reviews/REVIEW_MANIFEST.json"
        value = self._load_artifact(relative, "review_manifest", paired=True)
        if value.get("trial_id") != trial_id or value.get("stage_id") != stage_id:
            raise V2RuntimeError(
                "Review Manifest does not bind the requested trial/stage"
            )
        return value

    def _load_reviews(
        self,
        trial_id: str,
        manifest: Mapping[str, Any],
        overrides: Mapping[str, str] | None,
        *,
        plan_approval: Mapping[str, Any] | None = None,
    ) -> tuple[list[dict[str, Any]], list[str], list[str]]:
        expected = review_output_paths(trial_id, manifest, overrides)
        expected_by_path = {path: reviewer for reviewer, path in expected.items()}
        review_dir_relative = f"research_trajectory/trials/{trial_id}/reviews"
        review_dir = self._path(review_dir_relative)
        if review_dir.is_symlink() or not review_dir.is_dir():
            raise V2RuntimeError("review output directory is not trustworthy")
        found = {
            path.relative_to(self.root).as_posix()
            for path in review_dir.glob("*.json")
            if path.name != "REVIEW_MANIFEST.json"
        }
        missing = sorted(set(expected_by_path) - found)
        errors: list[str] = []
        outputs: list[dict[str, Any]] = []
        for relative in sorted(found):
            reviewer = expected_by_path.get(relative)
            if reviewer is None:
                errors.append(f"unexpected review output path: {relative}")
                continue
            try:
                value = self._load_artifact(relative, "reviewer_output", paired=True)
            except (OSError, ValueError, V2RuntimeError) as exc:
                errors.append(str(exc))
                continue
            if value.get("reviewer") != reviewer:
                errors.append(
                    f"{relative}: reviewer identity is {value.get('reviewer')!r}, expected {reviewer!r}"
                )
            else:
                for raw_input in value.get("reviewed_inputs", ()):
                    try:
                        reviewed = normalize_relative_path(str(raw_input))
                        target = self._path(reviewed, must_exist=True)
                    except (
                        OSError,
                        ValueError,
                        V2RuntimeError,
                        _transaction.TransactionError,
                    ) as exc:
                        errors.append(
                            f"{relative}: reviewed input is not a readable project file: "
                            f"{raw_input} ({exc})"
                        )
                        continue
                    if target.is_symlink() or not target.is_file():
                        errors.append(
                            f"{relative}: reviewed input is not a regular project file: "
                            f"{reviewed}"
                        )
                plan_review = (
                    reviewer == "plan" and value.get("phase") == "pre_execution"
                )
                if plan_review:
                    errors.extend(
                        self._plan_review_evidence_errors(
                            relative,
                            value,
                            (plan_approval or {}).get("material_inputs", ()),
                        )
                    )
                for evidence in value.get("evidence_checked", ()):
                    if not isinstance(evidence, Mapping) or evidence.get(
                        "source_kind"
                    ) == "external_url":
                        continue
                    if plan_review:
                        continue
                    raw_path = evidence.get("path")
                    try:
                        checked = normalize_relative_path(str(raw_path))
                        target = self._path(checked, must_exist=True)
                    except (
                        OSError,
                        ValueError,
                        V2RuntimeError,
                        _transaction.TransactionError,
                    ) as exc:
                        errors.append(
                            f"{relative}: checked evidence is not a readable project file: "
                            f"{raw_path} ({exc})"
                        )
                        continue
                    if target.is_symlink() or not target.is_file():
                        errors.append(
                            f"{relative}: checked evidence is not a regular project file: "
                            f"{checked}"
                        )
                        continue
                    if _digest(target.read_bytes()) != evidence.get("sha256"):
                        errors.append(
                            f"{relative}: checked evidence hash differs from exact bytes: "
                            f"{checked}"
                        )
                outputs.append(value)
        return outputs, missing, errors

    def _load_material(self, trial_id: str, stage_id: str) -> dict[str, dict[str, Any]]:
        trial_root = f"research_trajectory/trials/{trial_id}"
        stage_root = f"research_trajectory/.staging/{trial_id}/{stage_id}"
        values: dict[str, dict[str, Any]] = {}
        for name, (artifact_type, paired) in _TRIAL_INPUTS.items():
            value = self._load_artifact(
                f"{trial_root}/{name}", artifact_type, paired=paired
            )
            if value.get("trial_id") != trial_id:
                raise V2RuntimeError(f"{name} belongs to another trial")
            values[artifact_type] = value
        for name, (artifact_type, paired) in _STAGE_INPUTS.items():
            value = self._load_artifact(
                f"{stage_root}/{name}", artifact_type, paired=paired
            )
            if value.get("trial_id") != trial_id:
                raise V2RuntimeError(f"{name} belongs to another trial")
            values[artifact_type] = value
        return values

    def _candidate_files(self, stage: Mapping[str, Any]) -> dict[str, bytes]:
        return {
            str(item["candidate_path"]): self._path(
                str(item["candidate_path"]), must_exist=True
            ).read_bytes()
            for item in stage.get("operations", ())
        }

    def _prepare_revision_candidates(
        self, trial_id: str, stage_id: str, base_revision: int
    ) -> None:
        """Put service-owned revision metadata into the exact review snapshot."""

        target_revision = base_revision + 1
        stage_root = f"research_trajectory/.staging/{trial_id}/{stage_id}/candidate"
        for canonical_relative, artifact_type in (
            ("research_trajectory/STATE.json", "project_state"),
            ("research_trajectory/CURRENT_FINDINGS.json", "current_findings"),
        ):
            candidate_relative = f"{stage_root}/{canonical_relative}"
            candidate_path = self._path(candidate_relative)
            canonical_path = self._path(canonical_relative)
            if candidate_path.exists() or candidate_path.is_symlink():
                value = self._load_candidate_artifact(
                    candidate_relative,
                    canonical_relative,
                    artifact_type,
                )
            elif canonical_path.exists() or canonical_path.is_symlink():
                # The canonical JSON is authoritative, including immediately
                # after migration when its legacy Markdown is retained intact.
                value = self._load_artifact(
                    canonical_relative, artifact_type
                )
            else:
                continue
            value["canonical_revision"] = target_revision
            if artifact_type == "project_state":
                value["goal_gate_path"] = (
                    f"research_trajectory/trials/{trial_id}/GOAL_GATE.json"
                )
            errors = validate_artifact(
                value,
                expected_type=artifact_type,
                path=canonical_relative,
                schema_dir=self.schema_dir,
            )
            if errors:
                raise V2RuntimeError(
                    f"service-derived {canonical_relative} is invalid: "
                    + "; ".join(errors)
                )
            self._write_pair(candidate_relative, value)

    def _rebind_candidate_projection_references(
        self, trial_id: str, stage_id: str, preimages: Mapping[str, bytes]
    ) -> None:
        """Keep valid references bound after service-owned candidate derivation.

        Only Report and Human Brief citations may change here. Result cards,
        scientific evidence, plans and committed stages remain immutable.
        Never replace a hash that matched neither the preimage nor the result.
        """

        manifest = self._path(stage_manifest_path(trial_id, stage_id))
        if manifest.exists() or manifest.is_symlink():
            return
        changes = {}
        for relative, before in preimages.items():
            after = self._path(relative, must_exist=True).read_bytes()
            if before != after:
                changes[relative] = (_digest(before), _digest(after))
        if not changes:
            return
        documents = {}
        for relative, artifact_type, field in (
            (f"research_trajectory/trials/{trial_id}/REPORT.json", "report", "artifacts"),
            (f"research_trajectory/.staging/{trial_id}/{stage_id}/HUMAN_BRIEF.json", "human_brief", "evidence"),
        ):
            value = self._load_artifact(relative, artifact_type, paired=True)
            documents[relative] = (value, field)
        originals = {
            path: self._path(path, must_exist=True).read_bytes()
            for relative in documents
            for path in (relative, relative[:-5] + ".md")
        }
        outputs = dict(originals)
        # Resolve the two documents' references to each other as well. A cycle
        # cannot have stable byte hashes and must fail instead of being blessed.
        for _ in range(len(documents) + 1):
            next_outputs = dict(originals)
            for relative, (original, field) in documents.items():
                value = deepcopy(original)
                changed = False
                for reference in value.get(field, ()):
                    binding = changes.get(
                        normalize_relative_path(str(reference.get("path") or ""))
                    )
                    declared = reference.get("sha256")
                    if binding is None or declared is None:
                        continue
                    before_hash, after_hash = binding
                    if declared not in {before_hash, after_hash}:
                        raise V2RuntimeError(
                            f"referenced evidence hash mismatch: {reference['path']}"
                        )
                    if declared != after_hash:
                        reference["sha256"] = after_hash
                        changed = True
                if changed:
                    next_outputs[relative] = canonical_json_bytes(value)
                    next_outputs[relative[:-5] + ".md"] = render_markdown(value).encode("utf-8")
            if next_outputs == outputs:
                for relative, data in outputs.items():
                    if data != originals[relative]:
                        self._write_bytes(relative, data)
                return
            outputs = next_outputs
            for relative, data in outputs.items():
                if data != originals[relative]:
                    changes[relative] = (_digest(originals[relative]), _digest(data))
        raise V2RuntimeError("cyclic evidence references in Report and Human Brief")

    def _candidate_contract_errors(
        self, stage: Mapping[str, Any], candidates: Mapping[str, bytes]
    ) -> list[str]:
        operations = {
            str(item.get("path")): item for item in stage.get("operations", ())
        }
        errors: list[str] = []
        for target, operation in operations.items():
            if not target.endswith(".json"):
                continue
            source = str(operation.get("candidate_path"))
            try:
                value = _json(candidates[source], source)
            except V2RuntimeError as exc:
                errors.append(str(exc))
                continue
            if value.get("artifact_type") in {"project_state", "current_findings"}:
                expected_revision = int(stage["base_revision"]) + 1
                if value.get("canonical_revision") != expected_revision:
                    errors.append(
                        f"{target}: canonical_revision must equal the staged target "
                        f"revision {expected_revision}"
                    )
            if value.get("artifact_type") == "project_state":
                expected_gate = (
                    f"research_trajectory/trials/{stage['trial_id']}/GOAL_GATE.json"
                )
                if value.get("goal_gate_path") != expected_gate:
                    errors.append(
                        f"{target}: goal_gate_path must reference the staged trial's "
                        f"service-owned Goal Gate {expected_gate}"
                    )
            metadata = ARTIFACT_REGISTRY.get(str(value.get("artifact_type")))
            if not metadata or not (
                metadata.get("paired_markdown")
                or metadata.get("paired_markdown_pattern")
            ):
                continue
            markdown_target = target[:-5] + ".md"
            markdown_operation = operations.get(markdown_target)
            if markdown_operation is None:
                errors.append(
                    f"candidate JSON lacks paired Markdown operation: {target}"
                )
                continue
            markdown_source = str(markdown_operation.get("candidate_path"))
            markdown_bytes = candidates.get(markdown_source)
            try:
                markdown = markdown_bytes.decode("utf-8")
            except (AttributeError, UnicodeError):
                errors.append(f"candidate Markdown is not valid UTF-8: {target}")
                continue
            errors.extend(
                f"{target}: {error}"
                for error in paired_markdown_errors(value, markdown)
            )
        return errors

    def _verified_prior_card_ids(
        self, trial_id: str, base_revision: int, result_cards: Mapping[str, Any],
    ) -> set[str]:
        """Resolve supersession targets in receipt-bound, earlier Trial history.

        Deferred cards are historical identities, not accepted findings. Their
        presence here permits correction links only, never active promotion.
        """

        requested = {
            str(card_id) for card in result_cards.get("cards", ())
            for card_id in card.get("supersedes", ())
        }
        requested_numbers = {
            int(card_id.split("-")[1]) for card_id in requested
            if valid_id("result_card", card_id)
        }
        if not requested_numbers:
            return set()
        found: set[str] = set()
        trials = self._path("research_trajectory/trials")
        for directory in sorted(trials.iterdir()):
            prior = directory.name
            if (directory.is_symlink() or not directory.is_dir()
                    or not valid_id("trial", prior)
                    or int(prior[:6]) not in requested_numbers
                    or int(prior[:6]) >= int(trial_id[:6])):
                continue
            prefix = f"research_trajectory/trials/{prior}"
            receipt_path = self._path(f"{prefix}/PUBLISH_RECEIPT.json")
            if not receipt_path.exists():
                continue
            receipt = self._load_artifact(f"{prefix}/PUBLISH_RECEIPT.json", "publish_receipt")
            if (receipt.get("trial_id") != prior
                    or receipt.get("project_id") != self.project_id
                    or receipt["published_revision"] > base_revision):
                raise V2RuntimeError(f"Historical card receipt is outside this base revision: {prior}")
            stage_id = str(receipt["stage_id"])
            decision_relative = f"{prefix}/MERGE_DECISION.json"
            decision_bytes = self._path(decision_relative, must_exist=True).read_bytes()
            if not any(
                item.get("path") == decision_relative and item.get("sha256") == _digest(decision_bytes)
                for item in receipt.get("published_files", ())
            ):
                raise V2RuntimeError(f"Historical merge decision failed receipt verification: {prior}")
            decision = self._load_artifact(decision_relative, "merge_decision")
            stage = self._load_artifact(
                f"research_trajectory/.staging/{prior}/{stage_id}/STAGED_UPDATE_MANIFEST.json",
                "staged_update_manifest",
            )
            if (any(value.get("project_id") != self.project_id
                    or value.get("trial_id") != prior or value.get("stage_id") != stage_id
                    for value in (decision, stage))
                    or decision.get("overall_status") not in {"approved", "needs_human"}
                    or stage.get("base_revision") != receipt.get("base_revision")
                    or stage.get("stage_content_hash") != compute_stage_content_hash(stage)
                    or decision.get("stage_manifest_hash") != stage.get("stage_content_hash")):
                raise V2RuntimeError(f"Historical card stage identity or hash is invalid: {prior}")
            cards_relative = f"{prefix}/RESULT_CARDS.json"
            card_bytes = self._path(cards_relative, must_exist=True).read_bytes()
            if not any(
                item.get("path") == cards_relative and item.get("role") == "result_cards"
                and item.get("sha256") == _digest(card_bytes)
                for item in stage.get("material_inputs", ())
            ):
                raise V2RuntimeError(f"Historical result cards failed their recorded stage hash: {prior}")
            cards = self._load_artifact(cards_relative, "result_cards")
            if cards.get("trial_id") != prior or cards.get("project_id") != self.project_id:
                raise V2RuntimeError(f"Historical result cards have a different owner: {prior}")
            found.update(
                card["id"] for card in cards.get("cards", ())
                if card.get("source_trial_id") == prior and card.get("id") in requested
            )
        return found

    def _base_projection(self, stage: Mapping[str, Any]) -> dict[str, bytes]:
        paths = set((*_CANONICAL_JSON, *_MANUSCRIPT_PATHS))
        for directory, pattern in _CANONICAL_JSON_GLOBS:
            root = self._path(directory)
            if root.is_dir() and not root.is_symlink():
                paths.update(
                    path.relative_to(self.root).as_posix()
                    for path in root.glob(pattern)
                )
        paths.update(str(item["path"]) for item in stage.get("operations", ()))
        paths.update(
            path[:-5] + ".md" for path in tuple(paths) if path.endswith(".json")
        )
        projection: dict[str, bytes] = {}
        for relative in sorted(paths):
            path = self._path(relative)
            if path.is_file() and not path.is_symlink():
                projection[relative] = path.read_bytes()
        return projection

    @staticmethod
    def _projection_contract_errors(projection: Mapping[str, Any]) -> list[str]:
        errors: list[str] = []
        for path, value in projection.items():
            if not path.endswith(".json") or not isinstance(value, Mapping):
                continue
            metadata = ARTIFACT_REGISTRY.get(str(value.get("artifact_type")))
            if not metadata or not (
                metadata.get("paired_markdown")
                or metadata.get("paired_markdown_pattern")
            ):
                continue
            markdown_path = path[:-5] + ".md"
            markdown = projection.get(markdown_path)
            if not isinstance(markdown, str):
                errors.append(f"effective projection lacks paired Markdown: {path}")
            else:
                errors.extend(
                    f"{path}: {error}"
                    for error in paired_markdown_errors(value, markdown)
                )
        return errors

    def _selected_operations(
        self, stage: Mapping[str, Any], decision: Mapping[str, Any]
    ) -> tuple[list[dict[str, Any]], dict[str, Mapping[str, Any]]]:
        choices = {
            str(item.get("path")): item.get("decision")
            for item in decision.get("canonical_update_decisions", ())
        }
        all_operations = {
            str(item["path"]): item for item in stage.get("operations", ())
        }
        if set(choices) != set(all_operations):
            raise V2RuntimeError("Merge Decision operation set differs from the stage")
        selected: list[dict[str, Any]] = []
        for target, item in sorted(all_operations.items()):
            if choices[target] != "apply":
                continue
            candidate = self._path(str(item["candidate_path"]), must_exist=True)
            after = candidate.read_bytes()
            target_path = self._path(target)
            before = target_path.read_bytes() if target_path.is_file() else None
            actual_operation = "replace" if before is not None else "create"
            if (
                item.get("operation") != actual_operation
                or item.get("before_sha256")
                != (_digest(before) if before is not None else None)
                or item.get("after_sha256") != _digest(after)
            ):
                raise V2RuntimeError(
                    f"transaction preflight differs from stage: {target}"
                )
            selected.append(
                {
                    "path": target,
                    "operation": actual_operation,
                    "before_sha256": item.get("before_sha256"),
                    "after_sha256": item.get("after_sha256"),
                    "candidate_path": item.get("candidate_path"),
                }
            )
        return selected, all_operations

    def _gate_projection(
        self,
        trial_id: str,
        effective: Mapping[str, Any],
        review: Mapping[str, Any],
        closure: Mapping[str, Any],
    ) -> dict[str, Any]:
        values = [value for value in effective.values() if isinstance(value, Mapping)]
        lines = [value for value in values if value.get("artifact_type") == "line"]
        campaigns = [
            value for value in values if value.get("artifact_type") == "campaign"
        ]
        states = [
            value for value in values if value.get("artifact_type") == "project_state"
        ]
        active = [
            line
            for line in lines
            if line.get("status") in {"active", "candidate_final"}
        ]
        final_line = (
            active[0]
            if len(active) == 1 and active[0].get("status") == "candidate_final"
            else None
        )
        findings = effective.get("research_trajectory/CURRENT_FINDINGS.json")
        findings = (
            findings
            if isinstance(findings, Mapping)
            and findings.get("artifact_type") == "current_findings"
            else None
        )
        authorized_cards = (
            set(findings.get("accepted_card_ids", ()))
            | set(findings.get("qualified_card_ids", ()))
            if findings
            else set()
        )
        supporting_cards = (
            set(final_line.get("supporting_cards", ())) if final_line else set()
        )
        limiting_cards = (
            set(final_line.get("limiting_cards", ()))
            | set(final_line.get("conflicting_cards", ()))
            if final_line
            else set()
        )
        synthesized_cards = (
            {
                card_id
                for item in findings.get("synthesis", ())
                for card_id in item.get("card_ids", ())
            }
            if findings
            else set()
        )
        required_reviewers = {
            str(reviewer) for reviewer in closure.get("required_reviewers", ())
        }
        passed_reviewers = {
            str(reviewer) for reviewer in closure.get("passed_reviewers", ())
        }
        reviews_closed = (
            closure.get("closed") is True and required_reviewers == passed_reviewers
        )
        manuscript_present = all(
            isinstance(effective.get(path), str) and effective[path].strip()
            for path in _MANUSCRIPT_PATHS
        )

        target = effective.get("resources/target_venue/TARGET_VENUE.json")
        target = (
            target
            if isinstance(target, Mapping)
            and target.get("artifact_type") == "target_venue"
            else None
        )
        profile = effective.get("resources/target_venue/VENUE_PROFILE.json")
        profile = (
            profile
            if isinstance(profile, Mapping)
            and profile.get("artifact_type") == "venue_profile"
            else None
        )
        venue_projection_ready = bool(target) and venue_readiness(target, profile)[
            "ready"
        ]
        route = self._load_artifact(
            f"research_trajectory/trials/{trial_id}/EXPERT_ROUTE.json",
            "expert_route",
            paired=True,
        )
        plan = self._load_artifact(
            f"research_trajectory/trials/{trial_id}/PLAN.json", "plan", paired=True
        )
        selected_domains = {
            Path(str(path)).parent.name for path in route.get("domain_packs", ())
        }
        specialized_coverage_complete = (
            not route.get("missing_packs")
            and self._required_domain_ids(plan) <= selected_domains
        )

        return {
            "active_line_count": len(active),
            "active_line_status": (
                active[0].get("status") if len(active) == 1 else None
            ),
            "campaign_component_statuses": [
                component.get("status")
                for campaign in campaigns
                for component in campaign.get("components", ())
            ],
            "key_claims_authorized": bool(supporting_cards)
            and supporting_cards <= authorized_cards
            and {"evidence", "final_gate"} <= passed_reviewers
            and reviews_closed,
            "negative_and_limiting_evidence_visible": final_line is not None
            and limiting_cards <= authorized_cards
            and limiting_cards <= synthesized_cards
            and manuscript_present
            and {"evidence", "manuscript", "final_gate"} <= passed_reviewers
            and reviews_closed,
            "critical_path_has_open_blocker": len(states) != 1
            or any(
                item.get("status") != "complete"
                for item in states[0].get("critical_path", ())
            ),
            "deliverable_architecture_coherent": manuscript_present
            and {"manuscript", "figure_table", "reference", "final_gate"}
            <= passed_reviewers
            and reviews_closed,
            "target_venue_requirements_satisfied": venue_projection_ready
            and {"venue_fit", "final_gate"} <= passed_reviewers
            and reviews_closed,
            "specialized_coverage_complete": specialized_coverage_complete,
            "review_level": review.get("selected_level"),
            "all_required_reviewers_pass": reviews_closed,
            "final_human_brief_complete": reviews_closed
            and "final_gate" in passed_reviewers,
            "transaction_validation_passed": True,
            "schema_validation_passed": True,
        }

    def _verified_human_kill_authority(
        self, evidence: Mapping[str, Any]
    ) -> dict[str, Any] | None:
        authority = evidence.get("human_kill_authority")
        killed = evidence.get("killed_by_human") is True
        if not killed:
            if authority is not None:
                raise V2RuntimeError(
                    "human_kill_authority is only valid when killed_by_human=true"
                )
            return None
        if not isinstance(authority, Mapping):
            raise V2RuntimeError(
                "killed_by_human requires a formal intervention or authenticated UI action"
            )

        source = str(authority.get("source") or "")
        authority_id = str(authority.get("authority_id") or "")
        raw_path = str(authority.get("record_path") or "")
        expected_hash = str(authority.get("record_sha256") or "")
        recorded_at = str(authority.get("recorded_at") or "")
        try:
            relative = normalize_relative_path(raw_path)
        except ValueError as exc:
            raise V2RuntimeError(f"invalid human kill authority path: {exc}") from exc
        if relative != raw_path:
            raise V2RuntimeError("human kill authority path must be canonical")
        record = self._path(relative, must_exist=True)
        if record.is_symlink() or not record.is_file():
            raise V2RuntimeError("human kill authority record is not trustworthy")
        if _digest(record.read_bytes()) != expected_hash:
            raise V2RuntimeError("human kill authority record hash mismatch")

        if source == "formal_intervention":
            parent = "research_trajectory/human_interventions"
            if Path(relative).parent.as_posix() != parent or not (
                record.name == f"{authority_id}.md"
                or record.name.startswith(f"{authority_id}_")
                and record.suffix == ".md"
            ):
                raise V2RuntimeError(
                    "formal human kill authority must reference its intervention file"
                )
            index = _json(
                self._path(f"{parent}/INDEX.json", must_exist=True).read_bytes(),
                f"{parent}/INDEX.json",
            )
            entries = index.get("interventions")
            if not isinstance(entries, list):
                raise V2RuntimeError("formal human intervention index is invalid")
            match = next(
                (
                    item
                    for item in entries
                    if isinstance(item, Mapping)
                    and item.get("id") == authority_id
                    and item.get("path") == relative
                ),
                None,
            )
            if not match or match.get("status") not in {"pending", "applied"}:
                raise V2RuntimeError(
                    "formal human kill authority is absent, superseded, or unindexed"
                )
            if match.get("created_at") != recorded_at:
                raise V2RuntimeError(
                    "formal human kill authority timestamp differs from its index"
                )
        elif source == "authenticated_ui_action":
            expected_path = f"ui/.runtime/human-actions/{authority_id}.json"
            if relative != expected_path:
                raise V2RuntimeError(
                    "authenticated UI kill authority must reference its service receipt"
                )
            receipt = _json(record.read_bytes(), relative)
            if (
                receipt.get("authority_id") != authority_id
                or receipt.get("action") != "kill_research"
                or receipt.get("authenticated") is not True
                or receipt.get("recorded_at") != recorded_at
            ):
                raise V2RuntimeError("authenticated UI kill receipt is invalid")
        else:
            raise V2RuntimeError("human kill authority source is invalid")

        return {
            "source": source,
            "authority_id": authority_id,
            "record_path": relative,
            "record_sha256": expected_hash,
            "recorded_at": recorded_at,
            "verified_by_service": True,
        }

    def _goal_gate(
        self,
        *,
        trial_id: str,
        base_revision: int,
        review: Mapping[str, Any],
        brief: Mapping[str, Any],
        evidence: Mapping[str, Any],
        effective: Mapping[str, Any],
        review_closure: Mapping[str, Any],
        created_at: str | None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        signals = self._gate_signals(brief, evidence)
        projection = self._gate_projection(
            trial_id, effective, review, review_closure
        )
        evaluated = evaluate_goal_gate(signals, projection)
        status = evaluated["status"]
        action = brief.get("human_action", {})
        reasons = list(evidence.get("reasons", ()))
        recovery_condition = evaluated.get("recovery_condition")
        if status == "blocked":
            recovery_reason = f"Recovery condition: {recovery_condition}"
            if recovery_reason not in reasons:
                reasons.append(recovery_reason)
        next_move = (
            brief.get("next_move")
            if status in {"continue", "paused_budget"}
            else None
        )
        if status == "needs_human":
            response = action.get("question")
        elif status == "blocked":
            response = recovery_reason
        elif status in {"no_viable_line", "killed_by_human", "paused_budget"}:
            response = (
                action.get("question") or reasons[0]
                if reasons
                else "Service gate requires human attention."
            )
        else:
            response = None
        timestamp = created_at or utc_z_timestamp()
        gate = {
            "schema_version": SCHEMA_VERSION,
            "artifact_type": "goal_gate",
            "project_id": self.project_id,
            "created_at": timestamp,
            "updated_at": timestamp,
            "extensions": (
                {"recovery_condition": recovery_condition}
                if status == "blocked"
                else (
                    {"human_kill_authority": evaluated["human_kill_authority"]}
                    if status == "killed_by_human"
                    else {}
                )
            ),
            "trial_id": trial_id,
            "status": status,
            "decision_rule": evaluated["decision_rule"],
            "reasons": reasons,
            "response_to_human": response,
            "next_move": next_move,
            "canonical_revision": base_revision + 1,
            "review_level": review.get("selected_level"),
            "all_required_reviewers_pass": evaluated["final_readiness"]["checks"][
                "all_required_reviewers_pass"
            ],
        }
        errors = validate_artifact(
            gate,
            expected_type="goal_gate",
            path=f"research_trajectory/trials/{trial_id}/GOAL_GATE.json",
            schema_dir=self.schema_dir,
        )
        if errors:
            raise V2RuntimeError("invalid derived Goal Gate: " + "; ".join(errors))
        return gate, evaluated

    def _gate_signals(
        self, brief: Mapping[str, Any], evidence: Mapping[str, Any]
    ) -> dict[str, Any]:
        signals = {field: evidence.get(field) for field in _GATE_SIGNAL_FIELDS}
        signals["human_kill_authority"] = self._verified_human_kill_authority(
            evidence
        )
        extensions = evidence.get("extensions")
        signals["recovery_condition"] = (
            extensions.get("recovery_condition")
            if isinstance(extensions, Mapping)
            else None
        )
        signals["human_action"] = brief.get("human_action")
        signals["independent_valuable_move"] = bool(
            evidence.get("viable_path")
            and evidence.get("concrete_high_value_move")
        )
        return signals

    def _pre_review_human_brief_gate_errors(
        self, brief: Mapping[str, Any], evidence: Mapping[str, Any]
    ) -> list[str]:
        """Reject known Brief/Gate contradictions before expensive review."""

        projection = {
            "active_line_count": 0,
            "active_line_status": None,
            "campaign_component_statuses": (),
            "key_claims_authorized": False,
            "negative_and_limiting_evidence_visible": False,
            "critical_path_has_open_blocker": True,
            "deliverable_architecture_coherent": False,
            "target_venue_requirements_satisfied": False,
            "specialized_coverage_complete": False,
            "review_level": "standard",
            "all_required_reviewers_pass": False,
            "final_human_brief_complete": False,
            "transaction_validation_passed": True,
            "schema_validation_passed": True,
        }
        evaluated = evaluate_goal_gate(self._gate_signals(brief, evidence), projection)
        provisional_gate = {
            "project_id": self.project_id,
            "trial_id": brief.get("trial_id"),
            "status": evaluated["status"],
        }
        return human_brief_goal_gate_errors(brief, provisional_gate)

    def _service_files(
        self,
        trial_id: str,
        stage_id: str,
        decision: Mapping[str, Any],
        gate: Mapping[str, Any],
        finalized_trial: Mapping[str, Any],
    ) -> dict[str, bytes]:
        trial_root = f"research_trajectory/trials/{trial_id}"
        stage_root = f"research_trajectory/.staging/{trial_id}/{stage_id}"
        values: dict[str, bytes] = {
            f"{trial_root}/TRIAL.json": canonical_json_bytes(finalized_trial)
        }
        for stem, value in (("MERGE_DECISION", decision), ("GOAL_GATE", gate)):
            values[f"{trial_root}/{stem}.json"] = canonical_json_bytes(value)
            values[f"{trial_root}/{stem}.md"] = render_markdown(value).encode("utf-8")
        # Gate Evidence remains immutable review material in the retained stage;
        # its artifact contract has no published JSON path.  Human Brief does.
        for stem in ("HUMAN_BRIEF",):
            for suffix in ("json", "md"):
                source = self._path(f"{stage_root}/{stem}.{suffix}", must_exist=True)
                values[f"{trial_root}/{stem}.{suffix}"] = source.read_bytes()
        return values

    def _finalized_trial(
        self,
        trial: Mapping[str, Any],
        brief: Mapping[str, Any],
        review: Mapping[str, Any],
        gate: Mapping[str, Any],
        stage_id: str,
    ) -> dict[str, Any]:
        timestamp = str(gate.get("updated_at") or gate.get("created_at") or "")
        value = dict(trial)
        value.update(
            {
                "updated_at": timestamp,
                "lifecycle_state": "published",
                "trial_outcome": brief.get("trial_outcome"),
                "publish_revision": gate.get("canonical_revision"),
                "review_level": review.get("selected_level"),
                "stage_id": stage_id,
                "closed_at": timestamp,
            }
        )
        errors = validate_artifact(
            value,
            expected_type="trial",
            path=f"research_trajectory/trials/{trial.get('trial_id')}/TRIAL.json",
            schema_dir=self.schema_dir,
        )
        if errors:
            raise V2RuntimeError("invalid finalized Trial: " + "; ".join(errors))
        return value

    def _transaction_validator(self, relative: str, source: Path) -> None:
        if not relative.endswith(".json"):
            return
        value = _json(source.read_bytes(), relative)
        artifact_type = value.get("artifact_type")
        if artifact_type in ARTIFACT_REGISTRY:
            errors = validate_artifact(
                value,
                path=relative,
                schema_dir=self.schema_dir,
            )
            if errors:
                raise V2RuntimeError(f"{relative}: " + "; ".join(errors))

    def _published_canonical_artifacts(self) -> list[dict[str, Any]]:
        paths = set(_CANONICAL_JSON)
        for directory, pattern in _CANONICAL_JSON_GLOBS:
            root = self._path(directory)
            if root.is_dir():
                paths.update(
                    path.relative_to(self.root).as_posix()
                    for path in root.glob(pattern)
                )
        values: list[dict[str, Any]] = []
        for relative in sorted(paths):
            path = self._path(relative)
            if not path.is_file():
                continue
            raw = _json(path.read_bytes(), relative)
            artifact_type = str(raw.get("artifact_type", ""))
            metadata = ARTIFACT_REGISTRY.get(artifact_type)
            if metadata is None:
                raise _transaction.RecoveryRequiredError(
                    f"unknown published canonical artifact type at {relative}"
                )
            paired = bool(
                metadata.get("paired_markdown")
                or metadata.get("paired_markdown_pattern")
            )
            values.append(self._load_artifact(relative, artifact_type, paired=paired))
        return values

    def _authoritative_publication(self, trial_id: str) -> dict[str, Any] | None:
        receipt_relative = f"research_trajectory/trials/{trial_id}/PUBLISH_RECEIPT.json"
        receipt_path = self._path(receipt_relative)
        if not receipt_path.is_file() or receipt_path.is_symlink():
            return None
        receipt = self._load_artifact(receipt_relative, "publish_receipt")
        trial = self._load_artifact(
            f"research_trajectory/trials/{trial_id}/TRIAL.json", "trial"
        )
        revision = self._load_artifact(
            "research_trajectory/CANONICAL_REVISION.json", "canonical_revision"
        )
        gate = self._load_artifact(
            f"research_trajectory/trials/{trial_id}/GOAL_GATE.json",
            "goal_gate",
            paired=True,
        )
        decision = self._load_artifact(
            f"research_trajectory/trials/{trial_id}/MERGE_DECISION.json",
            "merge_decision",
            paired=True,
        )
        brief = self._load_artifact(
            f"research_trajectory/trials/{trial_id}/HUMAN_BRIEF.json",
            "human_brief",
            paired=True,
        )
        canonical = self._published_canonical_artifacts()
        errors = cross_artifact_errors(
            [receipt, revision, trial, gate, decision, brief, *canonical]
        )
        for item in receipt.get("published_files", ()):
            relative = str(item.get("path", ""))
            try:
                actual = _digest(self._path(relative, must_exist=True).read_bytes())
            except (OSError, ValueError, _transaction.TransactionError) as exc:
                errors.append(f"receipt target cannot be read: {relative} ({exc})")
                continue
            if actual != item.get("sha256"):
                errors.append(f"receipt hash differs from published bytes: {relative}")
        if (
            receipt.get("trial_id") != trial_id
            or receipt.get("published_revision") != revision.get("revision")
            or receipt.get("gate_status") != gate.get("status")
            or receipt.get("transaction_id") != revision.get("transaction_id")
            or revision.get("published_trial_id") != trial_id
            or gate.get("canonical_revision") != revision.get("revision")
            or trial.get("lifecycle_state") != "published"
            or trial.get("publish_revision") != revision.get("revision")
            or trial.get("stage_id") != receipt.get("stage_id")
            or self.transactions.current_revision() != revision.get("revision")
        ):
            errors.append("receipt/revision/Goal Gate authoritative state disagrees")
        if errors:
            raise _transaction.RecoveryRequiredError("; ".join(errors))
        status = "needs_human" if gate["status"] == "needs_human" else "published"
        return _status(
            status,
            published=True,
            recovered=True,
            receipt=receipt,
            canonical_revision=revision,
            goal_gate=gate,
            merge_decision=decision,
        )

    def complete_trial(
        self,
        trial_id: str,
        stage_id: str,
        *,
        review_guard_dir: str | Path,
        gate_projection: Mapping[str, Any],
        review_paths: Mapping[str, str] | None = None,
        additional_material_roles: Mapping[str, str] | None = None,
        created_at: str | None = None,
        publish: bool = True,
        on_milestone: Callable[[str], None] | None = None,
    ) -> dict[str, Any]:
        """Validate exact review closure, derive merge/gate, and publish or stop.

        ``gate_projection`` remains a compatibility input only; final readiness is
        derived from the effective projection and exact reviewer closure.
        """

        try:
            require_id("trial", trial_id)
            require_id("stage", stage_id)
            try:
                registry = self._guard_registry(trial_id, stage_id)
                key = (
                    trial_id,
                    stage_id,
                    str(Path(review_guard_dir)),
                    registry,
                )
                cached = self._audited_review_guard
                self._audited_review_guard = None
                guard = (
                    cached[1]
                    if cached is not None and cached[0] == key
                    else self.audit_review_guard(
                        trial_id, stage_id, review_guard_dir
                    )
                )
                self._audited_review_guard = None
            except Exception as exc:
                return _status(
                    "recovery_required",
                    errors=[str(exc)],
                    guard_audit_failed=True,
                    publishable=False,
                )
            if not guard["publishable"]:
                return _status(
                    "protocol_violation",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    guard=guard,
                    publishable=False,
                )
            recovery = self.recover()
            if recovery["status"] != "ready":
                return recovery
            authoritative = self._authoritative_publication(trial_id)
            if authoritative is not None:
                return authoritative
            plan_approval = self._current_plan_approval(
                trial_id,
                stage_id,
                staged_trial=True,
            )
            stage_relative = stage_manifest_path(trial_id, stage_id)
            stage = self._load_artifact(stage_relative, "staged_update_manifest")
            if (
                stage.get("project_id") != self.project_id
                or stage.get("trial_id") != trial_id
                or stage.get("stage_id") != stage_id
            ):
                raise V2RuntimeError("staged manifest identity differs from this run")
            drift = verify_stage_from_project(
                self.root,
                stage,
                additional_material_roles=additional_material_roles,
            )
            if drift:
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=drift,
                    new_stage_required=True,
                    old_stage_retained=self._path(stage_relative).is_file(),
                    publishable=False,
                )
            review = self._review_manifest(trial_id, stage_id)
            if review.get("stage_manifest_hash") != stage.get("stage_content_hash"):
                return _status(
                    "needs_review",
                    errors=["Review Manifest is stale for the exact staged bytes"],
                    publishable=False,
                )
            pair_errors = self._prepare_artifact_pairs({
                relative: ("reviewer_output", True)
                for relative in review_output_paths(trial_id, review, review_paths).values()
                if not relative.endswith("/PLAN_REVIEW.json")
            })
            if pair_errors:
                return _status("needs_review", errors=pair_errors, publishable=False)
            outputs, missing, review_errors = self._load_reviews(
                trial_id,
                review,
                review_paths,
                plan_approval=plan_approval,
            )
            closure = evaluate_review_closure(review, outputs, stage)
            if missing:
                closure["errors"].append(f"missing review files: {missing}")
            closure["errors"].extend(review_errors)
            closure["closed"] = not closure["errors"]
            if not closure["closed"]:
                return _status(
                    "needs_review",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    review_closure=closure,
                    errors=closure["errors"],
                    publishable=False,
                )
            material = self._load_material(trial_id, stage_id)
            eligibility_errors = reviewer_card_eligibility_errors(
                outputs, material["merge_request"]
            )
            if eligibility_errors and not any(
                error.startswith("Merge Request ") for error in eligibility_errors
            ):
                # Reviewer-output defects do not change the immutable proposal.
                # Repair these on the same stage before cross-artifact merge checks.
                closure["errors"].extend(eligibility_errors)
                closure["closed"] = False
                return _status(
                    "needs_review",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    review_closure=closure,
                    errors=eligibility_errors,
                    publishable=False,
                )
            input_bundle = [stage, review, *outputs, *material.values()]
            input_errors = cross_artifact_errors(input_bundle)
            if input_errors:
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=input_errors,
                    new_stage_required=True,
                    publishable=False,
                )
            if on_milestone is not None:
                on_milestone("brief")
            candidates = self._candidate_files(stage)
            candidate_errors = self._candidate_contract_errors(stage, candidates)
            if candidate_errors:
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=candidate_errors,
                    new_stage_required=True,
                    publishable=False,
                )
            base = self._base_projection(stage)
            merge = MergeEvaluator(
                current_revision=self.transactions.current_revision()
            ).evaluate(
                stage_manifest=stage,
                merge_request=material["merge_request"],
                review_manifest=review,
                reviewer_outputs=outputs,
                result_cards=material["result_cards"],
                candidate_files=candidates,
                base_projection=base,
                prior_card_ids=self._verified_prior_card_ids(
                    trial_id, stage["base_revision"], material["result_cards"]
                ),
                created_at=created_at,
            )
            decision = merge["decision"]
            if not merge["publishable"] or decision.get("overall_status") == "rejected":
                return _status(
                    "rejected",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    merge_decision=decision,
                    errors=merge["errors"],
                    new_stage_required=True,
                    publishable=False,
                )
            manuscript_card_errors = self._final_manuscript_card_errors(
                stage, decision, candidates,
                superseded_card_ids=frozenset(
                    merge["effective_projection"].get(
                        "research_trajectory/CURRENT_FINDINGS.json", {}
                    ).get("superseded_card_ids", ())
                ),
            )
            if manuscript_card_errors:
                return _status(
                    "rejected",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    merge_decision=decision,
                    errors=manuscript_card_errors,
                    new_stage_required=True,
                    publishable=False,
                )
            if on_milestone is not None:
                on_milestone("gate")
            selected, all_stage = self._selected_operations(stage, decision)
            gate, evaluated = self._goal_gate(
                trial_id=trial_id,
                base_revision=int(stage["base_revision"]),
                review=review,
                brief=material["human_brief"],
                evidence=material["gate_evidence"],
                effective=merge["effective_projection"],
                review_closure=closure,
                created_at=created_at,
            )
            if on_milestone is not None:
                on_milestone("validate")
            merge_needs_human = decision.get("overall_status") == "needs_human"
            gate_needs_human = gate.get("status") == "needs_human"
            if merge_needs_human != gate_needs_human:
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=["Merge Decision and Goal Gate disagree about needs_human"],
                    new_stage_required=True,
                    publishable=False,
                )
            projection_errors = self._projection_contract_errors(
                merge["effective_projection"]
            )
            if projection_errors:
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=projection_errors,
                    new_stage_required=True,
                    publishable=False,
                )
            effective_artifacts = [
                value
                for value in merge["effective_projection"].values()
                if isinstance(value, Mapping)
                and value.get("artifact_type") in ARTIFACT_REGISTRY
            ]
            target_revision = {
                "artifact_type": "canonical_revision",
                "revision": int(stage["base_revision"]) + 1,
            }
            final_errors = cross_artifact_errors(
                [
                    stage,
                    review,
                    *outputs,
                    *material.values(),
                    decision,
                    gate,
                    target_revision,
                    *effective_artifacts,
                ]
            )
            if final_errors:
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=final_errors,
                    new_stage_required=True,
                    publishable=False,
                )
            finalized_trial = self._finalized_trial(
                material["trial"],
                material["human_brief"],
                review,
                gate,
                stage_id,
            )
            finalized_errors = cross_artifact_errors(
                [finalized_trial, decision, gate, target_revision]
            )
            if finalized_errors:
                return _status(
                    "repair",
                    trial_id=trial_id,
                    stage_id=stage_id,
                    errors=finalized_errors,
                    new_stage_required=True,
                    publishable=False,
                )
            # Re-read every stage byte after all derivation and immediately before
            # preparing the private transaction sources.
            drift = verify_stage_from_project(
                self.root,
                stage,
                additional_material_roles=additional_material_roles,
            )
            if drift:
                return _status(
                    "repair",
                    errors=drift,
                    new_stage_required=True,
                    old_stage_retained=True,
                    publishable=False,
                )
            service_files = self._service_files(
                trial_id, stage_id, decision, gate, finalized_trial
            )
            preview = [
                {
                    "path": item["path"],
                    "operation": item["operation"],
                    "before_sha256": item["before_sha256"],
                    "after_sha256": item["after_sha256"],
                }
                for item in selected
            ]
            preview.extend(
                {
                    "path": path,
                    "operation": "replace" if self._path(path).is_file() else "create",
                    "before_sha256": (
                        _digest(self._path(path).read_bytes())
                        if self._path(path).is_file()
                        else None
                    ),
                    "after_sha256": _digest(data),
                }
                for path, data in service_files.items()
                if path not in all_stage
            )
            preview.sort(key=lambda item: item["path"])
            if not publish:
                status = "needs_human" if gate_needs_human else "ready_to_publish"
                return _status(
                    status,
                    trial_id=trial_id,
                    stage_id=stage_id,
                    publishable=True,
                    published=False,
                    merge_decision=decision,
                    effective_projection=merge["effective_projection"],
                    goal_gate=gate,
                    gate_evaluation=evaluated,
                    transaction_operations=preview,
                )
            receipt = self.transactions.publish(
                project_id=self.project_id,
                trial_id=trial_id,
                stage_id=stage_id,
                base_revision=int(stage["base_revision"]),
                stage_operations=selected,
                all_stage_operations=all_stage,
                service_files=service_files,
                gate_status=str(gate["status"]),
                validator=self._transaction_validator,
            )
            authoritative = self._authoritative_publication(trial_id)
            if authoritative is None or authoritative["receipt"] != receipt:
                raise _transaction.RecoveryRequiredError(
                    "transaction return value is not the authoritative on-disk receipt"
                )
            authoritative.update(
                {
                    "recovered": False,
                    "stage_id": stage_id,
                    "merge_decision": decision,
                    "effective_projection": merge["effective_projection"],
                    "gate_evaluation": evaluated,
                    "transaction_operations": preview,
                }
            )
            return authoritative
        except _transaction.RecoveryRequiredError as exc:
            return _status("recovery_required", errors=[str(exc)], publishable=False)
        except (
            GuardError,
            KeyError,
            OSError,
            TypeError,
            ValueError,
            V2RuntimeError,
            _transaction.TransactionError,
        ) as exc:
            return _status(
                "repair",
                trial_id=trial_id,
                stage_id=stage_id,
                errors=[str(exc)],
                new_stage_required=True,
                publishable=False,
            )


__all__ = [
    "TransactionManager",
    "V2Runtime",
    "V2RuntimeError",
    "build_review_manifest",
    "review_output_paths",
]
