"""Explicit, schema-valid semantic lifecycle events for the existing SSE stream."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
import re
from typing import Any

try:
    from .v2_artifacts import validate_artifact
    from .v2_contracts import SCHEMA_VERSION, utc_z_timestamp
except ImportError:  # Direct tests/imports from templates/default/ui.
    from v2_artifacts import validate_artifact  # type: ignore
    from v2_contracts import SCHEMA_VERSION, utc_z_timestamp  # type: ignore


PHASES = (
    "observe", "orient", "route", "charter", "preflight", "execute",
    "distill", "stage", "review_route", "review", "repair", "brief",
    "gate", "validate", "publish", "recovery",
)
STATUSES = ("started", "progress", "completed", "warning", "failed")
_SECRET_KEY = re.compile(r"(?:token|secret|password|api[_-]?key|authorization|cookie|credential)", re.I)
_SECRET_VALUE = re.compile(r"\b(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,})", re.I)


def _redact(value: Any, key: str = "") -> tuple[Any, bool]:
    if _SECRET_KEY.search(key):
        return "[redacted]", True
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        changed = False
        for child_key, child in value.items():
            clean, child_changed = _redact(child, str(child_key))
            result[str(child_key)] = clean
            changed = changed or child_changed
        return result, changed
    if isinstance(value, (list, tuple)):
        result = []
        changed = False
        for child in value:
            clean, child_changed = _redact(child)
            result.append(clean)
            changed = changed or child_changed
        return result, changed
    if isinstance(value, str) and _SECRET_VALUE.search(value):
        return _SECRET_VALUE.sub("[redacted]", value), True
    if value is None or isinstance(value, (str, bool, int, float)):
        return value, False
    return str(value), True


def semantic_event(
    *,
    project_id: str,
    run_id: str,
    trial_id: str | None,
    sequence: int,
    phase: str,
    status: str,
    message: str,
    details: Mapping[str, Any] | None = None,
    timestamp: str | None = None,
) -> dict[str, Any]:
    if phase not in PHASES:
        raise ValueError(f"unknown semantic phase: {phase}")
    if status not in STATUSES:
        raise ValueError(f"unknown semantic status: {status}")
    if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 1:
        raise ValueError("semantic sequence must be a positive integer")
    if not str(message).strip():
        raise ValueError("semantic message must be non-empty")
    clean_details, redacted = _redact(dict(details or {}))
    now = timestamp or utc_z_timestamp()
    artifact = {
        "schema_version": SCHEMA_VERSION,
        "artifact_type": "semantic_trace",
        "project_id": project_id,
        "created_at": now,
        "updated_at": now,
        "extensions": {},
        "run_id": run_id,
        "trial_id": trial_id,
        "sequence": sequence,
        "phase": phase,
        "status": status,
        "message": str(message).strip(),
        "details": clean_details,
        "redacted": redacted,
    }
    errors = validate_artifact(artifact, expected_type="semantic_trace")
    if errors:
        raise ValueError("invalid semantic event: " + "; ".join(errors))
    return artifact


def semantic_envelope(artifact: Mapping[str, Any]) -> dict[str, Any]:
    errors = validate_artifact(dict(artifact), expected_type="semantic_trace")
    if errors:
        raise ValueError("invalid semantic trace payload: " + "; ".join(errors))
    event_id = f"{artifact['run_id']}:{artifact['sequence']}"
    return {
        "schema_version": SCHEMA_VERSION,
        "event_id": event_id,
        "project_id": artifact["project_id"],
        "trial_id": artifact["trial_id"],
        "stage": artifact["phase"],
        "event_type": "semantic_trace",
        "message": artifact["message"],
        "timestamp": artifact["created_at"],
        "payload": dict(artifact),
    }


@dataclass
class SemanticTraceEmitter:
    project_id: str
    run_id: str
    trial_id: str | None = None
    sink: Callable[[dict[str, Any]], Any] | None = None
    sequence: int = 0
    events: list[dict[str, Any]] = field(default_factory=list)

    def emit(
        self,
        phase: str,
        status: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        self.sequence += 1
        envelope = semantic_envelope(
            semantic_event(
                project_id=self.project_id,
                run_id=self.run_id,
                trial_id=self.trial_id,
                sequence=self.sequence,
                phase=phase,
                status=status,
                message=message,
                details=details,
            )
        )
        self.events.append(envelope)
        if self.sink:
            self.sink(envelope)
        return envelope
