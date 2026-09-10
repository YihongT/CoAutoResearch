"""Recover one unambiguous execution-directory delimiter error from quarantine.

This repairs placement only. Recovered bytes remain unreviewed; the agent must
reconcile references and cumulative accounting before a fresh guarded review.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
from typing import Any

from v2_guard import GuardError, agent_write_violations, load_agent_baseline
from v2_paths import normalize_relative_path


MAX_OUTPUT_RECOVERIES = 2


def _regular_bytes(root: Path, relative: str) -> bytes:
    path = root / normalize_relative_path(relative)
    _safe_parents(root, path)
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise GuardError("Recovery evidence must be an unlinked regular file.")
    return path.read_bytes()


def _safe_parents(root: Path, path: Path) -> None:
    path.relative_to(root)
    for parent in (path, *path.parents):
        if parent == root:
            break
        if parent.is_symlink():
            raise GuardError("Recovery paths must not traverse symbolic links.")
        if parent != path and parent.exists() and not parent.is_dir():
            raise GuardError("A recovery destination parent is not a directory.")


def output_recovery_plan(
    project_root: Path, guard_dir: Path, *, project_id: str, trial_id: str,
    stage_id: str, verify_tree: bool = False,
) -> dict[str, Any]:
    """Read-only eligibility check; never infer names by edit distance."""

    root = project_root.resolve(strict=True)
    guard = guard_dir.resolve(strict=True)
    if not project_id:
        raise GuardError("Recovery requires an explicit project identity.")
    if not re.fullmatch(r"[0-9]{6}_[a-z0-9][a-z0-9-]{0,79}", trial_id):
        raise GuardError("Invalid recovery trial identity.")
    if not re.fullmatch(r"STAGE-[0-9]{6}-[a-f0-9]{8}", stage_id):
        raise GuardError("Invalid recovery stage identity.")
    baseline = load_agent_baseline(guard)
    if (baseline.project_root != root or baseline.registry.trial_id != trial_id
            or baseline.registry.attempt_id != stage_id):
        raise GuardError("The recovery guard belongs to a different assignment.")
    for relative in (
        f"research_trajectory/.staging/{trial_id}/{stage_id}/STAGED_UPDATE_MANIFEST.json",
        f"research_trajectory/trials/{trial_id}/PUBLISH_RECEIPT.json",
    ):
        target = root / relative
        if target.exists() or target.is_symlink():
            raise GuardError("Frozen or published output cannot use placement recovery.")
    audit_bytes = _regular_bytes(guard, "guard-result.json")
    audit = json.loads(audit_bytes)
    violations = audit.get("violations")
    if (audit.get("trial_id") != trial_id or audit.get("attempt_id") != stage_id
            or audit.get("publishable") is not False
            or audit.get("protocol_violation") is not True
            or audit.get("restoration_errors") or not isinstance(violations, list)
            or not violations):
        raise GuardError("Recovery requires a completely restored rejected write audit.")
    alias = trial_id.replace("_", "-", 1)
    wrong = f"research_trajectory/trials/{alias}"
    correct = f"research_trajectory/trials/{trial_id}"
    prefix = f"{wrong}/artifacts/execute/{stage_id}"
    files = []
    owners = set()
    attempt_roots = set()
    restored = set(audit.get("restored_paths") or [])
    for item in violations:
        relative = normalize_relative_path(str(item.get("path") or ""))
        if (item.get("action") != "create"
                or item.get("reasons") != ["outside_allowed_roots"]
                or relative not in restored or relative in baseline.entries
                or not (relative == prefix or relative.startswith(prefix + "/")
                        or prefix.startswith(relative + "/") and relative.startswith(wrong))):
            raise GuardError("The rejected writes are not a single execution-path delimiter error.")
        locators = item.get("quarantine")
        if not isinstance(locators, list) or len(locators) != 1:
            raise GuardError("Recovery evidence is missing or ambiguous.")
        locator = normalize_relative_path(locators[0])
        if not locator.startswith("quarantine/"):
            raise GuardError("Recovery evidence is outside quarantine.")
        metadata = json.loads(_regular_bytes(guard, locator + "/metadata.json"))
        if metadata.get("path") != relative or metadata.get("realpath_escape"):
            raise GuardError("Quarantine identity does not match the rejected write.")
        if metadata.get("kind") == "directory":
            continue
        if metadata.get("kind") != "file" or not relative.startswith(prefix + "/"):
            raise GuardError("Only regular execution artifacts can be recovered.")
        source = locator + "/content.bin"
        data = _regular_bytes(guard, source)
        digest = hashlib.sha256(data).hexdigest()
        if digest != metadata.get("sha256") or digest != item.get("after_sha256"):
            raise GuardError("Quarantined output failed its byte-integrity check.")
        destination = correct + relative[len(wrong):]
        if not baseline.registry.agent_write_allowed(destination) or destination in baseline.entries:
            raise GuardError("Recovery would replace an existing or protected artifact.")
        _safe_parents(root, root / destination)
        if (root / destination).exists():
            raise GuardError("Recovery destination already exists; no artifact was overwritten.")
        suffix = relative[len(prefix) + 1:]
        if "/" not in suffix:
            raise GuardError("Recovered output must have a distinct execution-attempt directory.")
        attempt = suffix.split("/", 1)[0]
        attempt_roots.add(attempt)
        if relative.endswith(".json"):
            value = json.loads(data)
            if isinstance(value, dict):
                identity = {"project_id": project_id, "trial_id": trial_id, "stage_id": stage_id}
                if any(key in value and value[key] != expected for key, expected in identity.items()):
                    raise GuardError("Quarantined artifact declares a different research identity.")
                if suffix == f"{attempt}/execution_started.json" and all(
                    value.get(key) == expected for key, expected in identity.items()
                ):
                    owners.add(attempt)
        files.append({"source": source, "original": relative, "destination": destination, "sha256": digest})
    if not files or owners != attempt_roots:
        raise GuardError("Every recovered attempt needs an exact execution identity record.")
    if verify_tree and agent_write_violations(baseline):
        raise GuardError("Protected project files changed after restoration; recovery stopped.")
    return {"trial_id": trial_id, "stage_id": stage_id, "guard_dir": str(guard),
            "audit_sha256": hashlib.sha256(audit_bytes).hexdigest(), "files": files}


def apply_output_recovery(project_root: Path, plan: dict[str, Any]) -> None:
    """Copy verified bytes without overwrite, rolling back a partial copy on error.

    A process crash is deliberately fail-closed: existing destinations require
    inspection instead of an ambiguous second adoption. Original audits survive.
    """

    root = project_root.resolve(strict=True)
    guard = Path(plan["guard_dir"])
    if hashlib.sha256(_regular_bytes(guard, "guard-result.json")).hexdigest() != plan["audit_sha256"]:
        raise GuardError("The rejected audit changed before recovery.")
    created = []
    directories = []
    try:
        for item in plan["files"]:
            data = _regular_bytes(guard, item["source"])
            if hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise GuardError("Quarantined bytes changed before recovery.")
            target = root / normalize_relative_path(item["destination"])
            _safe_parents(root, target)
            missing = []
            parent = target.parent
            while not parent.exists():
                missing.append(parent)
                parent = parent.parent
            for directory in reversed(missing):
                directory.mkdir(mode=0o700)
                directories.append(directory)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(target)
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
        # Private service receipt; the original rejected guard-result is untouched.
        receipt = guard / "output-recovery.json"
        with receipt.open("x", encoding="utf-8") as handle:
            json.dump(plan, handle, indent=2, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        for target in reversed(created):
            target.unlink()
        for directory in reversed(directories):
            directory.rmdir()
        raise
