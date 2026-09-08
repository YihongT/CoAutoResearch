"""Secret-safe JSON lifecycle events for the supported local operations path."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import re
import sys
import threading
from typing import Any, Mapping, TextIO


STRUCTURED_LOG_VERSION = "2.0"
_WRITE_LOCK = threading.Lock()
_SECRET_KEY = re.compile(
    r"(?:secret|token|password|passwd|api[_-]?key|credential|authorization|cookie)",
    re.IGNORECASE,
)
_SECRET_VALUE = re.compile(
    r"(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})",
    re.IGNORECASE,
)


def _timestamp() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _identifier(value: Any) -> str | None:
    if value in (None, ""):
        return None
    clean = re.sub(r"[^A-Za-z0-9._:-]", "_", str(value).strip())[:160]
    return clean or None


def _safe(value: Any, *, secret_context: bool = False, depth: int = 0) -> Any:
    if depth > 5:
        return "[truncated]"
    if isinstance(value, Mapping):
        return {
            str(key)[:120]: _safe(
                child,
                secret_context=secret_context or bool(_SECRET_KEY.search(str(key))),
                depth=depth + 1,
            )
            for key, child in list(value.items())[:50]
        }
    if isinstance(value, (list, tuple)):
        return [
            _safe(child, secret_context=secret_context, depth=depth + 1)
            for child in list(value)[:50]
        ]
    if secret_context and value not in (None, ""):
        return "[redacted]"
    if isinstance(value, str):
        return _SECRET_VALUE.sub("[redacted]", value)[:2000]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:500]


def operation_event(
    component: str,
    event: str,
    status: str,
    *,
    run_id: Any = None,
    trial_id: Any = None,
    transaction_id: Any = None,
    details: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build one bounded record; all correlation-ID keys are always present."""

    return {
        "log_schema_version": STRUCTURED_LOG_VERSION,
        "timestamp": _timestamp(),
        "component": _identifier(component) or "unknown",
        "event": _identifier(event) or "unknown",
        "status": _identifier(status) or "unknown",
        "run_id": _identifier(run_id),
        "trial_id": _identifier(trial_id),
        "transaction_id": _identifier(transaction_id),
        "details": _safe(details or {}),
    }


def emit_operation_event(
    component: str,
    event: str,
    status: str,
    *,
    run_id: Any = None,
    trial_id: Any = None,
    transaction_id: Any = None,
    details: Mapping[str, Any] | None = None,
    stream: TextIO | None = None,
) -> dict[str, Any]:
    """Write one atomic JSON line to stderr (or an explicit test stream)."""

    record = operation_event(
        component,
        event,
        status,
        run_id=run_id,
        trial_id=trial_id,
        transaction_id=transaction_id,
        details=details,
    )
    encoded = json.dumps(
        record,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    destination = stream or sys.stderr
    with _WRITE_LOCK:
        destination.write(encoded + "\n")
        destination.flush()
    return record
