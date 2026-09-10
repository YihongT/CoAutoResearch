"""Versioned CoAutoResearch v2 path policy.

This module is intentionally independent from the HTTP server.  It normalizes
untrusted project-relative paths and answers the service-owned/agent-owned path
question without consulting Git or prompt text.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any
from urllib.parse import unquote


SPEC_VERSION = "2.0.0"
REGISTRY_VERSION = "2.0.0-life-008"
LEGACY_REGISTRY_VERSION = "2.0.0-life-003"
SERVICE_MUTABLE_REGISTRY_VERSION = "2.0.0-life-004"
PREVIOUS_REGISTRY_VERSION = "2.0.0-life-005"
PREVIOUS_SERVICE_ONLY_REGISTRY_VERSION = "2.0.0-life-006"
PREVIOUS_RUNTIME_MUTABLE_REGISTRY_VERSION = "2.0.0-life-007"

PROTECTED_PATH_PATTERNS = (
    "PROJECT.md",
    "research_trajectory/STATE.json",
    "research_trajectory/STATE.md",
    "research_trajectory/CURRENT_FINDINGS.json",
    "research_trajectory/CURRENT_FINDINGS.md",
    "research_trajectory/HUMAN_TASKS.json",
    "research_trajectory/HUMAN_TASKS.md",
    "research_trajectory/TRAJECTORY.json",
    "research_trajectory/CANONICAL_REVISION.json",
    "research_trajectory/lines/**",
    "research_trajectory/campaigns/**",
    "resources/target_venue/TARGET_VENUE.json",
    "resources/target_venue/TARGET_VENUE.md",
    "resources/target_venue/VENUE_PROFILE.json",
    "resources/target_venue/VENUE_PROFILE.md",
    "manuscript/BLUEPRINT.md",
    "manuscript/PAPER_PLAN.md",
    "manuscript/reviews/**",
    "instructions/**",
)

ALLOWED_AGENT_WRITE_PATTERNS = (
    "research_trajectory/trials/<current_trial_id>/**",
    "research_trajectory/.staging/<current_trial_id>/<attempt_id>/**",
    "workspace/**",
    "resources/autoresearch_discovered/**",
    "research_trajectory/notes/proposals/**",
    "research_trajectory/instruction_patches/**",
)

PLAN_AGENT_WRITE_PATTERNS = (
    "research_trajectory/trials/<current_trial_id>/TRIAL.json",
    "research_trajectory/trials/<current_trial_id>/PLAN.json",
    "research_trajectory/trials/<current_trial_id>/PLAN.md",
    "research_trajectory/trials/<current_trial_id>/EXPERT_ROUTE.json",
    "research_trajectory/trials/<current_trial_id>/EXPERT_ROUTE.md",
    "research_trajectory/trials/<current_trial_id>/reviews/PLAN_REVIEW.json",
    "research_trajectory/trials/<current_trial_id>/reviews/PLAN_REVIEW.md",
    "research_trajectory/trials/<current_trial_id>/artifacts",
    "research_trajectory/trials/<current_trial_id>/artifacts/resource_scout/**",
    "workspace/**",
    "resources/autoresearch_discovered/**",
)

PREVIOUS_PLAN_AGENT_WRITE_PATTERNS = tuple(
    pattern
    for pattern in PLAN_AGENT_WRITE_PATTERNS
    if pattern != "research_trajectory/trials/<current_trial_id>/artifacts"
)

# Volatile UI/session state is stored outside the agent-visible project tree.
# Consequently no project path can be exempt merely because its name looks
# service-owned; actor identity is established by the separate runtime store.
SERVICE_MUTABLE_PATTERNS: tuple[str, ...] = ()

LEGACY_SERVICE_MUTABLE_PATTERNS = (
    "ui/.runtime",
    "ui/.runtime/research_session.json",
)

PREVIOUS_SERVICE_MUTABLE_PATTERNS = (
    "ui/.runtime",
    "ui/.runtime/research_session.json",
    "ui/.runtime/framing_messages.json",
    "ui/.runtime/queued_chat_messages.json",
)

RETIRED_SERVICE_MUTABLE_PATTERNS = (
    *PREVIOUS_SERVICE_MUTABLE_PATTERNS,
    "ui/.runtime/sessions/*/meta.json",
)

PREVIOUS_SERVICE_ONLY_PATTERNS = (
    "research_trajectory/CANONICAL_REVISION.json",
    "research_trajectory/trials/<current_trial_id>/DISTILLED_RESULT_CARDS.json",
    "research_trajectory/.staging/<current_trial_id>/<attempt_id>/STAGED_UPDATE_MANIFEST.json",
    "research_trajectory/.staging/<current_trial_id>/<attempt_id>/PLAN_APPROVAL.json",
    "research_trajectory/trials/<current_trial_id>/reviews/REVIEW_MANIFEST.json",
    "research_trajectory/trials/<current_trial_id>/reviews/REVIEW_MANIFEST.md",
    "research_trajectory/trials/<current_trial_id>/MERGE_DECISION.json",
    "research_trajectory/trials/<current_trial_id>/MERGE_DECISION.md",
    "research_trajectory/trials/<current_trial_id>/GOAL_GATE.json",
    "research_trajectory/trials/<current_trial_id>/GOAL_GATE.md",
    "research_trajectory/trials/<current_trial_id>/PUBLISH_RECEIPT.json",
    "research_trajectory/trials/<current_trial_id>/PUBLISH_RECEIPT.md",
    "research_trajectory/.transactions/**",
)

SERVICE_ONLY_PATTERNS = (
    *PREVIOUS_SERVICE_ONLY_PATTERNS,
    "research_trajectory/.staging/<current_trial_id>/<attempt_id>/ROUTING_INPUTS.json",
)

_WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:")
_PERCENT_ESCAPE = re.compile(r"%[0-9A-Fa-f]{2}")


class UnsafeProjectPath(ValueError):
    """Raised when an untrusted path is not a contained relative path."""


def _fully_unquote(value: str) -> str:
    """Decode nested URL escapes without accepting a hidden second path."""

    decoded = value
    for _ in range(8):
        next_value = unquote(decoded, errors="strict")
        if next_value == decoded:
            return decoded
        decoded = next_value
    if _PERCENT_ESCAPE.search(decoded):
        raise UnsafeProjectPath("path contains excessive nested URL encoding")
    return decoded


def normalize_relative_path(value: str | Path) -> str:
    """Return one POSIX-style relative path or raise ``UnsafeProjectPath``.

    Validation happens after repeated percent decoding so encoded traversal,
    Windows drives, and UNC paths cannot become dangerous later in the flow.
    """

    raw = str(value)
    if not raw:
        raise UnsafeProjectPath("path is empty")
    try:
        decoded = _fully_unquote(raw)
    except (UnicodeDecodeError, ValueError) as exc:
        raise UnsafeProjectPath("path has invalid URL encoding") from exc
    if "\x00" in decoded:
        raise UnsafeProjectPath("path contains a NUL byte")

    if "\\" in decoded:
        raise UnsafeProjectPath("backslashes are not allowed in project-relative paths")
    portable = decoded
    if portable.startswith("//"):
        raise UnsafeProjectPath("UNC paths are not allowed")
    if portable.startswith("/") or _WINDOWS_DRIVE.match(portable):
        raise UnsafeProjectPath("absolute paths are not allowed")

    parts: list[str] = []
    for part in portable.split("/"):
        if part in {"", "."}:
            continue
        if part == "..":
            raise UnsafeProjectPath("parent traversal is not allowed")
        parts.append(part)
    if not parts:
        raise UnsafeProjectPath("path does not name a project entry")
    return "/".join(parts)


def _single_segment(value: str, label: str) -> str:
    normalized = normalize_relative_path(value)
    if "/" in normalized or normalized in {".", ".."}:
        raise UnsafeProjectPath(f"{label} must be one path segment")
    return normalized


def pattern_matches(pattern: str, relative_path: str | Path) -> bool:
    """Match the contract's exact paths and trailing ``/**`` roots."""

    path = normalize_relative_path(relative_path)
    if pattern.endswith("/**"):
        root = pattern[:-3].rstrip("/")
        return path == root or path.startswith(root + "/")
    if "*" in pattern:
        pattern_parts = pattern.split("/")
        path_parts = path.split("/")
        return len(pattern_parts) == len(path_parts) and all(
            expected == "*" or expected == actual
            for expected, actual in zip(pattern_parts, path_parts)
        )
    return path == pattern


def _expand(patterns: tuple[str, ...], trial_id: str, attempt_id: str) -> tuple[str, ...]:
    return tuple(
        pattern.replace("<current_trial_id>", trial_id).replace("<attempt_id>", attempt_id)
        for pattern in patterns
    )


@dataclass(frozen=True)
class PathRegistry:
    """Expanded, diagnostic-friendly registry for one agent invocation."""

    trial_id: str
    attempt_id: str
    protected_patterns: tuple[str, ...]
    allowed_agent_write_patterns: tuple[str, ...]
    service_only_patterns: tuple[str, ...]
    service_mutable_patterns: tuple[str, ...]
    spec_version: str = SPEC_VERSION
    registry_version: str = REGISTRY_VERSION

    @classmethod
    def for_run(cls, trial_id: str, attempt_id: str) -> "PathRegistry":
        trial = _single_segment(trial_id, "trial_id")
        attempt = _single_segment(attempt_id, "attempt_id")
        return cls(
            trial_id=trial,
            attempt_id=attempt,
            protected_patterns=PROTECTED_PATH_PATTERNS,
            allowed_agent_write_patterns=_expand(ALLOWED_AGENT_WRITE_PATTERNS, trial, attempt),
            service_only_patterns=_expand(SERVICE_ONLY_PATTERNS, trial, attempt),
            service_mutable_patterns=SERVICE_MUTABLE_PATTERNS,
        )

    @classmethod
    def for_plan(cls, trial_id: str, attempt_id: str) -> "PathRegistry":
        registry = cls.for_run(trial_id, attempt_id)
        return cls(
            trial_id=registry.trial_id,
            attempt_id=registry.attempt_id,
            protected_patterns=registry.protected_patterns,
            allowed_agent_write_patterns=_expand(
                PLAN_AGENT_WRITE_PATTERNS,
                registry.trial_id,
                registry.attempt_id,
            ),
            service_only_patterns=registry.service_only_patterns,
            service_mutable_patterns=registry.service_mutable_patterns,
        )

    def is_protected(self, relative_path: str | Path) -> bool:
        return any(pattern_matches(pattern, relative_path) for pattern in self.protected_patterns)

    def is_service_only(self, relative_path: str | Path) -> bool:
        return any(pattern_matches(pattern, relative_path) for pattern in self.service_only_patterns)

    def is_agent_root(self, relative_path: str | Path) -> bool:
        return any(pattern_matches(pattern, relative_path) for pattern in self.allowed_agent_write_patterns)

    def is_service_mutable(self, relative_path: str | Path) -> bool:
        return any(pattern_matches(pattern, relative_path) for pattern in self.service_mutable_patterns)

    def agent_write_allowed(self, relative_path: str | Path) -> bool:
        # INT-002: a nested service artifact is denied before the broader root.
        return not self.is_service_only(relative_path) and self.is_agent_root(relative_path)

    def is_compatible_with(self, other: "PathRegistry") -> bool:
        """Compare effective policies across the retained life-003 upgrade.

        ``from_dict`` expands the exact legacy service-runtime prefix to the
        current non-canonical service files. All other fields still have to
        match byte-for-byte, so a forged or unrelated baseline cannot become
        compatible through this migration.
        """

        versions = {self.registry_version, other.registry_version}
        if not versions <= {
            LEGACY_REGISTRY_VERSION,
            SERVICE_MUTABLE_REGISTRY_VERSION,
            PREVIOUS_REGISTRY_VERSION,
            PREVIOUS_SERVICE_ONLY_REGISTRY_VERSION,
            PREVIOUS_RUNTIME_MUTABLE_REGISTRY_VERSION,
            REGISTRY_VERSION,
        }:
            return False
        return (
            self.trial_id == other.trial_id
            and self.attempt_id == other.attempt_id
            and self.spec_version == other.spec_version
            and self.protected_patterns == other.protected_patterns
            and self.allowed_agent_write_patterns
            == other.allowed_agent_write_patterns
            and self.service_only_patterns == other.service_only_patterns
            and self.service_mutable_patterns == other.service_mutable_patterns
        )

    def denial_reasons(self, relative_path: str | Path) -> list[str]:
        path = normalize_relative_path(relative_path)
        reasons: list[str] = []
        if self.is_service_only(path):
            reasons.append("service_only")
        if self.is_protected(path):
            reasons.append("protected_path")
        if not self.is_agent_root(path):
            reasons.append("outside_allowed_roots")
        return reasons

    def to_dict(self) -> dict[str, Any]:
        return {
            "spec_version": self.spec_version,
            "registry_version": self.registry_version,
            "trial_id": self.trial_id,
            "attempt_id": self.attempt_id,
            "protected_patterns": list(self.protected_patterns),
            "allowed_agent_write_patterns": list(self.allowed_agent_write_patterns),
            "service_only_patterns": list(self.service_only_patterns),
            "service_mutable_patterns": list(self.service_mutable_patterns),
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "PathRegistry":
        registry_version = str(value.get("registry_version") or "")
        if registry_version not in {
            LEGACY_REGISTRY_VERSION,
            SERVICE_MUTABLE_REGISTRY_VERSION,
            PREVIOUS_REGISTRY_VERSION,
            PREVIOUS_SERVICE_ONLY_REGISTRY_VERSION,
            PREVIOUS_RUNTIME_MUTABLE_REGISTRY_VERSION,
            REGISTRY_VERSION,
        }:
            raise ValueError("unsupported protected-path registry version")
        trial_id = _single_segment(str(value["trial_id"]), "trial_id")
        attempt_id = _single_segment(str(value["attempt_id"]), "attempt_id")
        service_mutable_patterns = tuple(
            str(item) for item in value["service_mutable_patterns"]
        )
        allowed_agent_write_patterns = tuple(
            str(item) for item in value["allowed_agent_write_patterns"]
        )
        service_only_patterns = tuple(
            str(item) for item in value["service_only_patterns"]
        )
        legacy_count = len(LEGACY_SERVICE_MUTABLE_PATTERNS)
        if (
            registry_version == LEGACY_REGISTRY_VERSION
            and service_mutable_patterns[:legacy_count]
            == LEGACY_SERVICE_MUTABLE_PATTERNS
        ):
            service_mutable_patterns = (
                *SERVICE_MUTABLE_PATTERNS,
                *service_mutable_patterns[legacy_count:],
            )
        if (
            registry_version == SERVICE_MUTABLE_REGISTRY_VERSION
            and service_mutable_patterns == PREVIOUS_SERVICE_MUTABLE_PATTERNS
        ):
            service_mutable_patterns = SERVICE_MUTABLE_PATTERNS
        if (
            registry_version
            in {
                PREVIOUS_REGISTRY_VERSION,
                PREVIOUS_SERVICE_ONLY_REGISTRY_VERSION,
                PREVIOUS_RUNTIME_MUTABLE_REGISTRY_VERSION,
            }
            and service_mutable_patterns
            in {
                SERVICE_MUTABLE_PATTERNS,
                PREVIOUS_SERVICE_MUTABLE_PATTERNS,
                RETIRED_SERVICE_MUTABLE_PATTERNS,
            }
        ):
            # Runtime mutability was a property of the retired project-local
            # service store. Loading an old baseline under the current engine
            # must not keep granting a path-based actor exemption.
            service_mutable_patterns = SERVICE_MUTABLE_PATTERNS
        if (
            registry_version != REGISTRY_VERSION
            and allowed_agent_write_patterns
            == _expand(PREVIOUS_PLAN_AGENT_WRITE_PATTERNS, trial_id, attempt_id)
        ):
            allowed_agent_write_patterns = _expand(
                PLAN_AGENT_WRITE_PATTERNS, trial_id, attempt_id
            )
        if (
            registry_version != REGISTRY_VERSION
            and service_only_patterns
            == _expand(PREVIOUS_SERVICE_ONLY_PATTERNS, trial_id, attempt_id)
        ):
            service_only_patterns = _expand(
                SERVICE_ONLY_PATTERNS, trial_id, attempt_id
            )
        return cls(
            trial_id=trial_id,
            attempt_id=attempt_id,
            protected_patterns=tuple(str(item) for item in value["protected_patterns"]),
            allowed_agent_write_patterns=allowed_agent_write_patterns,
            service_only_patterns=service_only_patterns,
            service_mutable_patterns=service_mutable_patterns,
            spec_version=str(value["spec_version"]),
            registry_version=registry_version,
        )


def _contained(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def resolve_project_path(
    project_root: str | Path,
    relative_path: str | Path,
    *,
    must_exist: bool = False,
) -> Path:
    """Resolve a project path and reject existing-parent symlink escapes."""

    root = Path(project_root).resolve(strict=True)
    if not root.is_dir():
        raise UnsafeProjectPath("project root is not a directory")
    normalized = normalize_relative_path(relative_path)
    candidate = root.joinpath(*normalized.split("/"))
    try:
        resolved = candidate.resolve(strict=must_exist)
    except FileNotFoundError as exc:
        raise UnsafeProjectPath(f"required project path does not exist: {normalized}") from exc
    except NotADirectoryError as exc:
        raise UnsafeProjectPath(f"project path has a non-directory parent: {normalized}") from exc
    except (OSError, RuntimeError) as exc:
        raise UnsafeProjectPath("project path cannot be resolved safely") from exc
    if not _contained(root, resolved):
        raise UnsafeProjectPath("project path escapes through a symlink")
    return resolved


def lexical_project_path(project_root: str | Path, relative_path: str | Path) -> Path:
    """Return the contained lexical path after validating its real target."""

    root = Path(project_root).resolve(strict=True)
    normalized = normalize_relative_path(relative_path)
    resolve_project_path(root, normalized)
    return root.joinpath(*normalized.split("/"))
