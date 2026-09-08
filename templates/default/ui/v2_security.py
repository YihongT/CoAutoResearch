"""Small HTTP/path/redaction controls for the local-first production boundary."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import unquote, urlsplit

try:
    from .v2_paths import UnsafeProjectPath, normalize_relative_path, resolve_project_path
except ImportError:  # Direct tests/imports from templates/default/ui.
    from v2_paths import UnsafeProjectPath, normalize_relative_path, resolve_project_path  # type: ignore


LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
MAX_JSON_BODY_BYTES = 2 * 1024 * 1024
SENSITIVE_PATHS = (
    ".env",
    ".git/**",
    "archive/template_migrations/**",
    "research_trajectory/.staging/**",
    "research_trajectory/.transactions/**",
    "secrets/**",
    "ui/.runtime/**",
)
_SECRET_KEY = re.compile(r"(?:token|secret|password|api[_-]?key|authorization|cookie|credential)", re.I)
_BEARER = re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+|bearer\s+)([^\s,;]+)")
_API_KEY = re.compile(r"\b(?:sk|key)-[A-Za-z0-9_-]{10,}\b", re.I)


class SecurityBoundaryError(ValueError):
    def __init__(self, message: str, status: int = 400) -> None:
        self.status = status
        super().__init__(message)


def _hostname(value: str) -> str:
    raw = str(value or "").strip()
    if not raw or any(ord(char) < 32 or char.isspace() for char in raw):
        raise SecurityBoundaryError("Invalid Host header.", 421)
    try:
        parsed = urlsplit("//" + raw)
        host = parsed.hostname or ""
        _ = parsed.port
    except ValueError as exc:
        raise SecurityBoundaryError("Invalid Host header.", 421) from exc
    if not host:
        raise SecurityBoundaryError("Invalid Host header.", 421)
    return host.lower().rstrip(".")


def validate_request_site(
    method: str,
    headers: Mapping[str, Any],
    *,
    remote_mode: bool,
    authenticated: bool,
    bind_host: str = "127.0.0.1",
    allowed_hosts: Iterable[str] = (),
    allowed_origins: Iterable[str] = (),
) -> None:
    """Reject DNS rebinding and cross-site mutation before route dispatch."""

    host = _hostname(str(headers.get("Host") or ""))
    configured_hosts = {str(item).lower().rstrip(".") for item in allowed_hosts if str(item).strip()}
    local_hosts = LOOPBACK_HOSTS | {str(bind_host).lower().rstrip(".")}
    host_allowed = host in configured_hosts or host in local_hosts or any(
        item.startswith("*.") and host.endswith(item[1:]) and host != item[2:]
        for item in configured_hosts
    )
    if remote_mode and not configured_hosts:
        host_allowed = host in local_hosts or host.endswith(".trycloudflare.com")
    if not host_allowed:
        raise SecurityBoundaryError("Host is not a loopback host.", 421)
    if remote_mode and not authenticated:
        raise SecurityBoundaryError("Remote authentication is required.", 401)

    if method.upper() not in UNSAFE_METHODS:
        return
    fetch_site = str(headers.get("Sec-Fetch-Site") or "").strip().lower()
    if fetch_site == "cross-site":
        raise SecurityBoundaryError("Cross-site mutation is forbidden.", 403)
    origin = str(headers.get("Origin") or "").strip()
    if not origin:
        return  # Non-browser clients still require remote bearer authentication.
    configured_origins = {str(item).rstrip("/") for item in allowed_origins if str(item).strip()}
    try:
        parsed = urlsplit(origin)
    except ValueError as exc:
        raise SecurityBoundaryError("Invalid Origin header.", 403) from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SecurityBoundaryError("Invalid Origin header.", 403)
    origin_host = parsed.hostname.lower().rstrip(".")
    if origin.rstrip("/") not in configured_origins and origin_host != host:
        raise SecurityBoundaryError("Foreign Origin is forbidden.", 403)


def content_length(headers: Mapping[str, Any], limit: int) -> int:
    if str(headers.get("Transfer-Encoding") or "").strip():
        raise SecurityBoundaryError("Transfer-Encoding request bodies are unsupported.", 400)
    raw = str(headers.get("Content-Length") or "0").strip()
    try:
        length = int(raw)
    except ValueError as exc:
        raise SecurityBoundaryError("Invalid Content-Length.", 400) from exc
    if length < 0:
        raise SecurityBoundaryError("Invalid Content-Length.", 400)
    if length > limit:
        raise SecurityBoundaryError("Request body is too large.", 413)
    return length


def _sensitive(relative: str) -> bool:
    for pattern in SENSITIVE_PATHS:
        if pattern.endswith("/**"):
            root = pattern[:-3]
            if relative == root or relative.startswith(root + "/"):
                return True
        elif relative == pattern:
            return True
    return False


def public_project_path(
    project_root: str | Path,
    value: str,
    *,
    must_exist: bool = False,
    allow_symlink_leaf: bool = False,
) -> tuple[Path, str]:
    try:
        relative = normalize_relative_path(value)
        if unquote(value) != value:
            raise SecurityBoundaryError(
                "Literal percent-encoded filenames are not supported by the project file API. "
                "Import this resource with a supported filename.", 403
            )
        if _sensitive(relative):
            raise SecurityBoundaryError(
                "This internal path is not exposed by the file API.", 403
            )
        root = Path(project_root).resolve(strict=True)
        lexical = root.joinpath(*relative.split("/"))
        if allow_symlink_leaf and lexical.is_symlink():
            parent = lexical.parent.resolve(strict=True)
            if parent != root and root not in parent.parents:
                raise UnsafeProjectPath("symlink parent escapes project root")
            path = lexical
        else:
            path = resolve_project_path(root, relative, must_exist=must_exist)
    except (UnsafeProjectPath, FileNotFoundError, OSError) as exc:
        raise SecurityBoundaryError("Unsafe project-relative path.", 403) from exc
    return path, relative


def redact_sensitive_text(text: Any, configured_values: Iterable[str] = ()) -> str:
    result = str(text or "")
    for value in sorted({str(item) for item in configured_values if len(str(item)) >= 6}, key=len, reverse=True):
        result = result.replace(value, "[redacted]")
    result = _BEARER.sub(lambda match: match.group(1) + "[redacted]", result)
    return _API_KEY.sub("[redacted]", result)


def redact_mapping(value: Any, configured_values: Iterable[str] = ()) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): "[redacted]" if _SECRET_KEY.search(str(key)) else redact_mapping(child, configured_values)
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [redact_mapping(item, configured_values) for item in value]
    return redact_sensitive_text(value, configured_values) if isinstance(value, str) else value
