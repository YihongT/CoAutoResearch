"""Recoverable CoAutoResearch v2 canonical publication.

The filesystem cannot atomically replace several files at once.  This module
therefore records enough durable information to either restore the complete old
revision or finish the complete new revision after a crash.  It intentionally
uses only the Python standard library so a packed project has no hidden Python
dependency.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import threading
import time
from typing import Any, Callable, Iterator
from urllib.parse import unquote
import uuid

from v2_contracts import ContractValidationError, validate_schema
from v2_observability import emit_operation_event


TRANSACTIONS = Path("research_trajectory/.transactions")
REVISION_PATH = Path("research_trajectory/CANONICAL_REVISION.json")
LOCK_NAME = "PUBLISH_LOCK"
COHERENCE_LOCK_NAME = "COHERENCE_LOCK"
TXN_PATTERN = re.compile(r"^TXN-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$")
SHA_PATTERN = re.compile(r"^[a-f0-9]{64}$")
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
_READER_LOCKS: dict[str, threading.RLock] = {}
_READER_LOCKS_GUARD = threading.Lock()
_READER_STATE = threading.local()


class TransactionError(RuntimeError):
    """A publication or recovery invariant failed."""


class StaleRevisionError(TransactionError):
    """The stage was built from a revision that is no longer current."""


class RecoveryRequiredError(TransactionError):
    """Recovery found ambiguous bytes and refused to guess."""


def utc_now() -> str:
    return (
        datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    )


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def _reader_lock(root: Path) -> threading.RLock:
    key = str(root.resolve())
    with _READER_LOCKS_GUARD:
        return _READER_LOCKS.setdefault(key, threading.RLock())


def _chmod(path: Path, mode: int) -> None:
    if os.name == "posix":
        try:
            path.chmod(mode)
        except OSError:
            pass


def _fsync_directory(path: Path) -> None:
    if os.name != "posix":
        return
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise TransactionError(
            f"Cannot open directory for durable sync: {path}"
        ) from exc
    try:
        try:
            os.fsync(descriptor)
        except OSError as exc:
            raise TransactionError(f"Cannot durably sync directory: {path}") from exc
    finally:
        os.close(descriptor)


def _ensure_directory(path: Path, mode: int) -> None:
    missing: list[Path] = []
    current = path
    while not current.exists():
        if current.is_symlink():
            raise RecoveryRequiredError(
                f"Directory path is an untrustworthy symlink: {current}"
            )
        missing.append(current)
        if current.parent == current:
            break
        current = current.parent
    if current.is_symlink() or not current.is_dir():
        raise RecoveryRequiredError(f"Directory path is not trustworthy: {current}")
    path.mkdir(parents=True, mode=mode, exist_ok=True)
    for directory in reversed(missing):
        if directory.is_symlink() or not directory.is_dir():
            raise RecoveryRequiredError(
                f"Created directory is not trustworthy: {directory}"
            )
        _chmod(directory, mode)
        _fsync_directory(directory)
        _fsync_directory(directory.parent)


def _atomic_write(path: Path, data: bytes, mode: int = 0o600) -> None:
    _ensure_directory(path.parent, 0o700)
    _chmod(path.parent, 0o700)
    temp = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.replace(temp, path)
        except PermissionError as exc:
            raise TransactionError(
                f"Cannot replace {path}; close programs holding the file and retry recovery"
            ) from exc
        _chmod(path, mode)
        _fsync_directory(path.parent)
    finally:
        try:
            temp.unlink()
        except OSError:
            pass


def _write_json(path: Path, value: Any) -> None:
    _atomic_write(path, canonical_json(value))


def _decode_relative(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise TransactionError(
            "Project-relative path must be a non-empty string of at most 4096 characters"
        )
    if unquote(value) != value:
        raise TransactionError(f"URL-encoded project paths are forbidden: {value!r}")
    if (
        "\x00" in value
        or "\\" in value
        or ":" in value
        or "//" in value
        or value.endswith("/")
    ):
        raise TransactionError(f"Unsafe project-relative path: {value!r}")
    if value.startswith("/") or re.match(r"^[A-Za-z]:", value):
        raise TransactionError(f"Absolute project path is forbidden: {value!r}")
    parts = PurePosixPath(value).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise TransactionError(f"Path traversal is forbidden: {value!r}")
    if any(
        part.endswith((" ", "."))
        or part.split(".", 1)[0].upper() in WINDOWS_RESERVED_NAMES
        for part in parts
    ):
        raise TransactionError(f"Windows-unsafe project path is forbidden: {value!r}")
    return PurePosixPath(*parts).as_posix()


def resolve_project_path(
    root: Path, relative: str, *, must_exist: bool = False
) -> Path:
    root = root.resolve()
    if not root.is_dir():
        raise TransactionError(f"Project root is not a directory: {root}")
    normalized = _decode_relative(relative)
    candidate = root.joinpath(*PurePosixPath(normalized).parts)
    try:
        resolved = candidate.resolve(strict=False)
    except (OSError, RuntimeError) as exc:
        raise TransactionError(
            f"Cannot safely resolve project path: {relative}"
        ) from exc
    if resolved != root and root not in resolved.parents:
        raise TransactionError(f"Path escapes the project root: {relative}")
    current = root
    for part in PurePosixPath(normalized).parts:
        current /= part
        if current.is_symlink():
            raise TransactionError(
                f"Symlinks are forbidden in transaction paths: {relative}"
            )
        if not current.exists():
            break
    if must_exist and not candidate.is_file():
        raise TransactionError(f"Required file is missing: {relative}")
    return candidate


def _transactions_path(root: Path, *, create: bool = False) -> Path:
    transactions = resolve_project_path(root, TRANSACTIONS.as_posix())
    if transactions.exists() and not transactions.is_dir():
        raise RecoveryRequiredError(
            f"Transaction root is not a directory: {transactions}"
        )
    if create and not transactions.exists():
        _ensure_directory(transactions, 0o700)
        if transactions.is_symlink() or not transactions.is_dir():
            raise RecoveryRequiredError(
                f"Transaction root is not trustworthy: {transactions}"
            )
        _chmod(transactions, 0o700)
        _fsync_directory(transactions.parent)
    return transactions


def _is_canonical_target(relative: str, trial_id: str) -> bool:
    exact = {
        "PROJECT.md",
        "research_trajectory/STATE.json",
        "research_trajectory/STATE.md",
        "research_trajectory/CURRENT_FINDINGS.json",
        "research_trajectory/CURRENT_FINDINGS.md",
        "research_trajectory/HUMAN_TASKS.json",
        "research_trajectory/HUMAN_TASKS.md",
        "research_trajectory/TRAJECTORY.json",
        "resources/target_venue/TARGET_VENUE.json",
        "resources/target_venue/TARGET_VENUE.md",
        "resources/target_venue/VENUE_PROFILE.json",
        "resources/target_venue/VENUE_PROFILE.md",
        "manuscript/BLUEPRINT.md",
        "manuscript/PAPER_PLAN.md",
    }
    trial_targets = {
        f"research_trajectory/trials/{trial_id}/{name}.{suffix}"
        for name in ("HUMAN_BRIEF", "GATE_EVIDENCE", "MERGE_DECISION", "GOAL_GATE")
        for suffix in ("json", "md")
    }
    trial_targets.add(f"research_trajectory/trials/{trial_id}/TRIAL.json")
    patterned = (
        re.fullmatch(r"research_trajectory/lines/L[0-9]{4}\.(?:json|md)", relative),
        re.fullmatch(r"research_trajectory/campaigns/C[0-9]{4}\.(?:json|md)", relative),
        re.fullmatch(r"manuscript/reviews/.+\.(?:json|md)", relative),
    )
    return relative in exact or relative in trial_targets or any(patterned)


_TARGET_SCHEMAS = {
    "research_trajectory/STATE.json": "project-state.schema.json",
    "research_trajectory/CURRENT_FINDINGS.json": "current-findings.schema.json",
    "research_trajectory/HUMAN_TASKS.json": "human-tasks.schema.json",
    "resources/target_venue/TARGET_VENUE.json": "target-venue.schema.json",
    "resources/target_venue/VENUE_PROFILE.json": "venue-profile.schema.json",
}


def _target_schema(relative: str, trial_id: str) -> str | None:
    if relative in _TARGET_SCHEMAS:
        return _TARGET_SCHEMAS[relative]
    if re.fullmatch(r"research_trajectory/lines/L[0-9]{4}\.json", relative):
        return "line.schema.json"
    if re.fullmatch(r"research_trajectory/campaigns/C[0-9]{4}\.json", relative):
        return "campaign.schema.json"
    trial_names = {
        "TRIAL": "trial.schema.json",
        "HUMAN_BRIEF": "human-brief.schema.json",
        "GATE_EVIDENCE": "gate-evidence.schema.json",
        "MERGE_DECISION": "merge-decision.schema.json",
        "GOAL_GATE": "goal-gate.schema.json",
    }
    prefix = f"research_trajectory/trials/{trial_id}/"
    if relative.startswith(prefix) and relative.endswith(".json"):
        return trial_names.get(Path(relative).stem)
    return None


def _require_schema(
    value: Any, schema_name: str, context: str, *, recovery: bool = False
) -> None:
    error_type = RecoveryRequiredError if recovery else TransactionError
    try:
        validate_schema(value, schema_name)
    except (
        ContractValidationError,
        OSError,
        RuntimeError,
        KeyError,
        ValueError,
    ) as exc:
        raise error_type(f"{context} does not satisfy {schema_name}: {exc}") from exc


def current_revision(root: Path) -> int:
    root = Path(root).resolve()
    try:
        path = resolve_project_path(root, REVISION_PATH.as_posix())
    except TransactionError as exc:
        raise RecoveryRequiredError(str(exc)) from exc
    if not path.exists():
        return 0
    if not path.is_file():
        raise RecoveryRequiredError("Canonical revision path is not a regular file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        _require_schema(
            value,
            "canonical-revision.schema.json",
            "Canonical revision",
            recovery=True,
        )
        revision = value["revision"]
    except RecoveryRequiredError:
        raise
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise RecoveryRequiredError(f"Cannot read canonical revision: {exc}") from exc
    if not isinstance(revision, int) or revision < 0:
        raise RecoveryRequiredError("Canonical revision is invalid")
    return revision


class _FilesystemCoherenceLock:
    """Kernel-released reader/writer lock; Windows readers serialize safely."""

    def __init__(self, root: Path, *, exclusive: bool) -> None:
        self.root = root.resolve()
        self.exclusive = exclusive
        self.descriptor: int | None = None

    def acquire(self) -> None:
        transactions = _transactions_path(self.root, create=True)
        lock_file = transactions / COHERENCE_LOCK_NAME
        if lock_file.is_symlink() or (lock_file.exists() and not lock_file.is_file()):
            raise RecoveryRequiredError(
                "Coherence lock path is not a trustworthy regular file"
            )
        nofollow = getattr(os, "O_NOFOLLOW", 0)
        created = False
        try:
            descriptor = os.open(
                lock_file,
                os.O_RDWR | os.O_CREAT | os.O_EXCL | nofollow,
                0o600,
            )
            created = True
        except FileExistsError:
            descriptor = os.open(lock_file, os.O_RDWR | nofollow)
        self.descriptor = descriptor
        try:
            if created:
                os.write(descriptor, b"\0")
                os.fsync(descriptor)
                _chmod(lock_file, 0o600)
                _fsync_directory(transactions)
            if os.name == "nt":
                import msvcrt

                while True:
                    try:
                        os.lseek(descriptor, 0, os.SEEK_SET)
                        msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
                        break
                    except OSError:
                        time.sleep(0.02)
            else:
                import fcntl

                fcntl.flock(
                    descriptor,
                    fcntl.LOCK_EX if self.exclusive else fcntl.LOCK_SH,
                )
        except BaseException:
            os.close(descriptor)
            self.descriptor = None
            raise

    def release(self) -> None:
        descriptor = self.descriptor
        if descriptor is None:
            return
        try:
            if os.name == "nt":
                import msvcrt

                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)
            self.descriptor = None


class ProjectLock:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.lock_path = self.root / TRANSACTIONS / LOCK_NAME
        self.coherence_lock = _FilesystemCoherenceLock(self.root, exclusive=True)
        self.owner_token: str | None = None
        self.acquired = False

    def acquire(self) -> None:
        if self.acquired:
            raise TransactionError(
                "Project publication lock is already held by this object"
            )
        self.coherence_lock.acquire()
        try:
            transactions = _transactions_path(self.root, create=True)
            # The kernel lock is automatically released on process death.  Once
            # held exclusively, any leftover directory is stale even if its PID
            # has been reused by an unrelated live process.
            if self.lock_path.is_symlink() or (
                self.lock_path.exists() and not self.lock_path.is_dir()
            ):
                raise RecoveryRequiredError(
                    "Publish lock path is not a trustworthy directory"
                )
            if self.lock_path.exists():
                shutil.rmtree(self.lock_path)
                _fsync_directory(transactions)
            self.lock_path.mkdir(mode=0o700)
            self.owner_token = uuid.uuid4().hex
            owner = {
                "pid": os.getpid(),
                "hostname": socket.gethostname(),
                "created_at": utc_now(),
                "owner_token": self.owner_token,
                "lock_protocol": "kernel-v1",
            }
            _write_json(self.lock_path / "owner.json", owner)
            _fsync_directory(transactions)
            self.acquired = True
        except BaseException:
            self.coherence_lock.release()
            raise

    def release(self) -> None:
        if not self.acquired:
            return
        error: BaseException | None = None
        try:
            if self.lock_path.exists():
                try:
                    owner = json.loads(
                        (self.lock_path / "owner.json").read_text(encoding="utf-8")
                    )
                except Exception as exc:
                    raise RecoveryRequiredError(
                        f"Publish lock owner metadata changed while held: {exc}"
                    ) from exc
                if owner.get("owner_token") != self.owner_token:
                    raise RecoveryRequiredError(
                        "Publish lock ownership changed while held"
                    )
                shutil.rmtree(self.lock_path)
                _fsync_directory(self.lock_path.parent)
        except BaseException as exc:
            error = exc
        finally:
            self.acquired = False
            self.owner_token = None
            self.coherence_lock.release()
        if error:
            raise error

    def __enter__(self) -> "ProjectLock":
        self.acquire()
        return self

    def __exit__(self, _type: Any, _value: Any, _traceback: Any) -> None:
        self.release()


def _transaction_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"TXN-{timestamp}-{uuid.uuid4().hex[:8]}"


def _snapshot_revision(
    root: Path,
    transaction_dir: Path,
    expected_revision: int,
) -> dict[str, Any]:
    revision = resolve_project_path(root, REVISION_PATH.as_posix())
    target = transaction_dir / "before" / "canonical-revision.bin"
    if not revision.exists():
        if expected_revision != 0:
            raise StaleRevisionError(
                f"Stage base revision {expected_revision} is stale; current revision is 0"
            )
        return {"existed": False, "sha256": None, "path": None}
    if not revision.is_file():
        raise RecoveryRequiredError("Canonical revision path is not a regular file")
    data = revision.read_bytes()
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise RecoveryRequiredError(
            f"Cannot snapshot canonical revision: {exc}"
        ) from exc
    _require_schema(
        value,
        "canonical-revision.schema.json",
        "Canonical revision",
        recovery=True,
    )
    if value["revision"] != expected_revision:
        raise StaleRevisionError(
            f"Stage base revision {expected_revision} is stale; current revision is {value['revision']}"
        )
    _atomic_write(target, data)
    return {
        "existed": True,
        "sha256": sha256_bytes(data),
        "path": target.relative_to(root).as_posix(),
    }


def _manifest_path(transaction_dir: Path) -> Path:
    return transaction_dir / "TRANSACTION_MANIFEST.json"


def _journal_path(transaction_dir: Path) -> Path:
    return transaction_dir / "JOURNAL.json"


def _persist_manifest(transaction_dir: Path, manifest: dict[str, Any]) -> None:
    manifest["updated_at"] = utc_now()
    _require_schema(
        manifest, "transaction-manifest.schema.json", "Transaction manifest"
    )
    journal = {
        "transaction_id": manifest["transaction_id"],
        "state": manifest["state"],
        "updated_at": manifest["updated_at"],
        "operations": [
            {
                "path": item["path"],
                "applied": item["applied"],
                "applied_at": item["applied_at"],
            }
            for item in manifest["operations"]
        ],
    }
    _write_json(_journal_path(transaction_dir), journal)
    _write_json(_manifest_path(transaction_dir), manifest)


def _validate_staged_source(
    relative: str,
    trial_id: str,
    source: Path,
    validator: Callable[[str, Path], None] | None,
) -> None:
    try:
        data = source.read_bytes()
        text = data.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise TransactionError(
            f"Staged artifact is not valid UTF-8: {relative}"
        ) from exc
    if "\x00" in text:
        raise TransactionError(f"Staged artifact contains a NUL byte: {relative}")
    if relative.endswith(".json"):
        try:
            value = json.loads(text)
        except ValueError as exc:
            raise TransactionError(
                f"Staged JSON is invalid for {relative}: {exc}"
            ) from exc
        schema_name = _target_schema(relative, trial_id)
        if schema_name:
            _require_schema(value, schema_name, f"Staged artifact {relative}")
    if validator:
        validator(relative, source)


def _receipt_markdown(receipt: dict[str, Any]) -> bytes:
    lines = [
        "# Publish Receipt",
        "",
        f"- Transaction: `{receipt['transaction_id']}`",
        f"- Trial: `{receipt['trial_id']}`",
        f"- Stage: `{receipt['stage_id']}`",
        f"- Revision: `{receipt['published_revision']}`",
        f"- Gate status: `{receipt['gate_status']}`",
        f"- Published at: `{receipt['published_at']}`",
        "",
        "## Published Files",
        "",
    ]
    lines.extend(
        f"- `{item['path']}` — `{item['sha256']}`"
        for item in receipt["published_files"]
    )
    return ("\n".join(lines) + "\n").encode("utf-8")


def _build_prepared_transaction(
    root: Path,
    project_id: str,
    trial_id: str,
    stage_id: str,
    base_revision: int,
    operations: list[dict[str, Any]],
    gate_status: str,
    validator: Callable[[str, Path], None] | None,
    transaction_id: str,
) -> tuple[Path, dict[str, Any]]:
    if not operations:
        raise TransactionError(
            "A publication transaction requires at least one operation"
        )
    if not TXN_PATTERN.fullmatch(transaction_id):
        raise TransactionError(f"Invalid transaction ID: {transaction_id}")
    receipt_target_json = f"research_trajectory/trials/{trial_id}/PUBLISH_RECEIPT.json"
    receipt_target_markdown = (
        f"research_trajectory/trials/{trial_id}/PUBLISH_RECEIPT.md"
    )
    for relative in (receipt_target_json, receipt_target_markdown):
        target = resolve_project_path(root, relative)
        if target.exists() or target.is_symlink():
            raise TransactionError(f"Publish receipt target already exists: {relative}")

    transactions = _transactions_path(root, create=True)
    transaction_dir = transactions / transaction_id
    transaction_dir.mkdir(parents=True, mode=0o700)
    _chmod(transaction_dir, 0o700)
    (transaction_dir / "before").mkdir(mode=0o700)
    (transaction_dir / "after").mkdir(mode=0o700)
    _fsync_directory(transaction_dir)
    _fsync_directory(transactions)
    created_at = utc_now()
    revision_before = _snapshot_revision(root, transaction_dir, base_revision)
    prepared_operations: list[dict[str, Any]] = []
    seen: set[str] = set()

    for index, raw in enumerate(operations):
        if not isinstance(raw, dict):
            raise TransactionError(f"Operation {index} is not an object")
        relative = _decode_relative(str(raw.get("path") or ""))
        if relative in seen:
            raise TransactionError(f"Duplicate canonical operation: {relative}")
        seen.add(relative)
        if not _is_canonical_target(relative, trial_id):
            raise TransactionError(
                f"Operation is not an approved canonical target: {relative}"
            )
        operation = str(raw.get("operation") or "")
        if operation not in {"create", "replace"}:
            raise TransactionError(f"Unsupported canonical operation: {operation}")
        target = resolve_project_path(root, relative)
        source_relative = _decode_relative(
            str(raw.get("after_source_path") or raw.get("candidate_path") or "")
        )
        source = resolve_project_path(root, source_relative, must_exist=True)
        after = source.read_bytes()
        after_hash = sha256_bytes(after)
        expected_after = raw.get("after_sha256")
        if not isinstance(expected_after, str) or not SHA_PATTERN.fullmatch(
            expected_after
        ):
            raise TransactionError(f"Missing or invalid after hash for {relative}")
        if expected_after != after_hash:
            raise TransactionError(f"After hash mismatch for {relative}")
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise TransactionError(
                f"Canonical target is not a regular file: {relative}"
            )
        before_exists = target.is_file()
        if operation == "create" and before_exists:
            raise TransactionError(f"Create target already exists: {relative}")
        if operation == "replace" and not before_exists:
            raise TransactionError(f"Replace target is missing: {relative}")
        before_data = target.read_bytes() if before_exists else None
        before_hash = sha256_bytes(before_data) if before_data is not None else None
        if "before_sha256" not in raw:
            raise TransactionError(f"Missing before hash for {relative}")
        expected_before = raw.get("before_sha256")
        if expected_before is not None and (
            not isinstance(expected_before, str)
            or not SHA_PATTERN.fullmatch(expected_before)
        ):
            raise TransactionError(f"Invalid before hash for {relative}")
        if expected_before != before_hash:
            raise TransactionError(f"Before hash mismatch for {relative}")
        before_snapshot = None
        if before_data is not None:
            before_path = transaction_dir / "before" / f"{index:04d}.bin"
            _atomic_write(before_path, before_data)
            before_snapshot = before_path.relative_to(root).as_posix()
        after_path = transaction_dir / "after" / f"{index:04d}.bin"
        _atomic_write(after_path, after)
        _validate_staged_source(relative, trial_id, after_path, validator)
        if sha256_file(after_path) != after_hash:
            raise TransactionError(
                f"Validator changed the staged artifact for {relative}"
            )
        temp_path = target.parent / f".{target.name}.{transaction_id}.tmp"
        prepared_operations.append(
            {
                "path": relative,
                "operation": operation,
                "before_sha256": before_hash,
                "after_sha256": after_hash,
                "applied": False,
                "before_snapshot_path": before_snapshot,
                "after_source_path": after_path.relative_to(root).as_posix(),
                "temp_path": temp_path.relative_to(root).as_posix(),
                "applied_at": None,
                "extensions": {},
            }
        )
    target_revision = base_revision + 1
    content_hash = sha256_bytes(
        canonical_json(
            [
                {"path": item["path"], "sha256": item["after_sha256"]}
                for item in sorted(prepared_operations, key=lambda item: item["path"])
            ]
        )
    )
    revision = {
        "schema_version": "2.0",
        "artifact_type": "canonical_revision",
        "project_id": project_id,
        "created_at": created_at,
        "updated_at": created_at,
        "extensions": {},
        "revision": target_revision,
        "transaction_id": transaction_id,
        "published_trial_id": trial_id,
        "content_hash": content_hash,
    }
    _require_schema(
        revision, "canonical-revision.schema.json", "Generated canonical revision"
    )
    revision_after = transaction_dir / "after" / "canonical-revision.json"
    _atomic_write(revision_after, canonical_json(revision))
    published_files = [
        {"path": item["path"], "sha256": item["after_sha256"]}
        for item in sorted(prepared_operations, key=lambda item: item["path"])
    ]
    published_files.append(
        {"path": REVISION_PATH.as_posix(), "sha256": sha256_file(revision_after)}
    )
    receipt = {
        "schema_version": "2.0",
        "artifact_type": "publish_receipt",
        "project_id": project_id,
        "created_at": created_at,
        "updated_at": created_at,
        "extensions": {},
        "trial_id": trial_id,
        "transaction_id": transaction_id,
        "stage_id": stage_id,
        "base_revision": base_revision,
        "published_revision": target_revision,
        "published_at": created_at,
        "published_files": published_files,
        "gate_status": gate_status,
    }
    _require_schema(receipt, "publish-receipt.schema.json", "Generated publish receipt")
    receipt_template = transaction_dir / "after" / "publish-receipt.json"
    receipt_markdown = transaction_dir / "after" / "publish-receipt.md"
    _atomic_write(receipt_template, canonical_json(receipt))
    _atomic_write(receipt_markdown, _receipt_markdown(receipt))
    manifest = {
        "schema_version": "2.0",
        "artifact_type": "transaction_manifest",
        "project_id": project_id,
        "created_at": created_at,
        "updated_at": created_at,
        "extensions": {
            "revision_before": revision_before,
            "revision_after_path": revision_after.relative_to(root).as_posix(),
            "revision_after_sha256": sha256_file(revision_after),
            "receipt_json_path": receipt_template.relative_to(root).as_posix(),
            "receipt_markdown_path": receipt_markdown.relative_to(root).as_posix(),
            "receipt_target_json": receipt_target_json,
            "receipt_target_markdown": receipt_target_markdown,
            "gate_status": gate_status,
        },
        "transaction_id": transaction_id,
        "trial_id": trial_id,
        "stage_id": stage_id,
        "base_revision": base_revision,
        "target_revision": target_revision,
        "state": "prepared",
        "operations": prepared_operations,
        "prepared_at": created_at,
        "committed_at": None,
        "commit_marker_path": (transaction_dir / "COMMITTED.json")
        .relative_to(root)
        .as_posix(),
        "journal_path": _journal_path(transaction_dir).relative_to(root).as_posix(),
    }
    _validate_manifest(root, transaction_dir, manifest, recovery=False)
    _persist_manifest(transaction_dir, manifest)
    _fsync_directory(transaction_dir)
    return transaction_dir, manifest


def _manifest_failure(recovery: bool, message: str) -> None:
    error_type = RecoveryRequiredError if recovery else TransactionError
    raise error_type(message)


def _safe_manifest_path(
    root: Path,
    relative: str,
    *,
    must_exist: bool = False,
    recovery: bool,
) -> Path:
    try:
        return resolve_project_path(root, relative, must_exist=must_exist)
    except TransactionError as exc:
        if recovery:
            raise RecoveryRequiredError(str(exc)) from exc
        raise


def _read_json_object(path: Path, context: str, *, recovery: bool) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        _manifest_failure(recovery, f"Cannot read {context}: {exc}")
    if not isinstance(value, dict):
        _manifest_failure(recovery, f"{context} is not a JSON object")
    return value


def _validate_journal(
    transaction_dir: Path,
    manifest: dict[str, Any],
    *,
    required: bool,
) -> None:
    path = _journal_path(transaction_dir)
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise RecoveryRequiredError(
            "Transaction journal is not a trustworthy regular file"
        )
    if not path.exists():
        if required:
            raise RecoveryRequiredError("Prepared transaction journal is missing")
        return
    journal = _read_json_object(path, "transaction journal", recovery=True)
    if set(journal) != {"transaction_id", "state", "updated_at", "operations"}:
        raise RecoveryRequiredError("Transaction journal has unexpected fields")
    if journal.get("transaction_id") != manifest["transaction_id"]:
        raise RecoveryRequiredError(
            "Transaction journal ID does not match the manifest"
        )
    if journal.get("state") not in {
        "created",
        "prepared",
        "applying",
        "committed",
        "rolled_back",
        "failed",
    } or not isinstance(journal.get("updated_at"), str):
        raise RecoveryRequiredError("Transaction journal state or timestamp is invalid")
    operations = journal.get("operations")
    if not isinstance(operations, list) or len(operations) != len(
        manifest["operations"]
    ):
        raise RecoveryRequiredError("Transaction journal operation count is invalid")
    for item, expected in zip(operations, manifest["operations"]):
        if not isinstance(item, dict) or set(item) != {"path", "applied", "applied_at"}:
            raise RecoveryRequiredError("Transaction journal operation is invalid")
        if item.get("path") != expected["path"] or not isinstance(
            item.get("applied"), bool
        ):
            raise RecoveryRequiredError(
                "Transaction journal operation does not match the manifest"
            )
        if item.get("applied_at") is not None and not isinstance(
            item.get("applied_at"), str
        ):
            raise RecoveryRequiredError(
                "Transaction journal applied timestamp is invalid"
            )


def _validate_manifest(
    root: Path,
    transaction_dir: Path,
    manifest: dict[str, Any],
    *,
    recovery: bool,
) -> None:
    _require_schema(
        manifest,
        "transaction-manifest.schema.json",
        "Transaction manifest",
        recovery=recovery,
    )
    transaction_id = manifest["transaction_id"]
    expected_dir = root / TRANSACTIONS / transaction_id
    if (
        transaction_dir != expected_dir
        or transaction_dir.name != transaction_id
        or not TXN_PATTERN.fullmatch(transaction_id)
        or transaction_dir.is_symlink()
    ):
        _manifest_failure(
            recovery, "Transaction directory and manifest ID do not match"
        )
    if manifest["target_revision"] != manifest["base_revision"] + 1:
        _manifest_failure(
            recovery, "Transaction target revision is not base revision plus one"
        )
    prefix = f"{TRANSACTIONS.as_posix()}/{transaction_id}"
    if manifest["commit_marker_path"] != f"{prefix}/COMMITTED.json":
        _manifest_failure(recovery, "Commit marker path is not transaction-local")
    if manifest["journal_path"] != f"{prefix}/JOURNAL.json":
        _manifest_failure(recovery, "Journal path is not transaction-local")
    if manifest["prepared_at"] != manifest["created_at"]:
        _manifest_failure(recovery, "Prepared timestamp is not deterministic")
    if manifest["state"] == "committed":
        if manifest["committed_at"] != manifest["created_at"]:
            _manifest_failure(recovery, "Committed timestamp is inconsistent")
    elif manifest["committed_at"] is not None:
        _manifest_failure(recovery, "Uncommitted transaction has a committed timestamp")

    seen: set[str] = set()
    expected_published: list[dict[str, str]] = []
    for index, operation in enumerate(manifest["operations"]):
        relative = operation["path"]
        if relative in seen or not _is_canonical_target(relative, manifest["trial_id"]):
            _manifest_failure(
                recovery, f"Invalid canonical operation target: {relative}"
            )
        seen.add(relative)
        target = _safe_manifest_path(root, relative, recovery=recovery)
        expected_after_path = f"{prefix}/after/{index:04d}.bin"
        if operation["after_source_path"] != expected_after_path:
            _manifest_failure(
                recovery, f"After source is not transaction-local: {relative}"
            )
        expected_temp = (
            (target.parent / f".{target.name}.{transaction_id}.tmp")
            .relative_to(root)
            .as_posix()
        )
        if operation["temp_path"] != expected_temp:
            _manifest_failure(
                recovery, f"Temporary path is not same-directory: {relative}"
            )
        if operation["operation"] == "create":
            if (
                operation["before_sha256"] is not None
                or operation["before_snapshot_path"] is not None
            ):
                _manifest_failure(
                    recovery, f"Create operation has before state: {relative}"
                )
        else:
            expected_before_path = f"{prefix}/before/{index:04d}.bin"
            if operation["before_snapshot_path"] != expected_before_path:
                _manifest_failure(
                    recovery, f"Replace snapshot is not transaction-local: {relative}"
                )
            snapshot = _safe_manifest_path(
                root,
                expected_before_path,
                must_exist=True,
                recovery=recovery,
            )
            if sha256_file(snapshot) != operation["before_sha256"]:
                _manifest_failure(
                    recovery, f"Before snapshot hash mismatch: {relative}"
                )
        after_source = _safe_manifest_path(
            root,
            expected_after_path,
            must_exist=True,
            recovery=recovery,
        )
        if sha256_file(after_source) != operation["after_sha256"]:
            _manifest_failure(recovery, f"After source hash mismatch: {relative}")
        if operation["applied"] != (operation["applied_at"] is not None):
            _manifest_failure(
                recovery, f"Applied flag and timestamp disagree: {relative}"
            )
        expected_published.append(
            {"path": relative, "sha256": operation["after_sha256"]}
        )

    if manifest["state"] in {"prepared", "rolled_back"} and any(
        operation["applied"] for operation in manifest["operations"]
    ):
        _manifest_failure(
            recovery, f"{manifest['state']} transaction has applied operations"
        )
    if manifest["state"] == "committed" and not all(
        operation["applied"] for operation in manifest["operations"]
    ):
        _manifest_failure(recovery, "Committed transaction has unapplied operations")

    extensions = manifest["extensions"]
    required_extensions = {
        "revision_before",
        "revision_after_path",
        "revision_after_sha256",
        "receipt_json_path",
        "receipt_markdown_path",
        "receipt_target_json",
        "receipt_target_markdown",
        "gate_status",
    }
    if not required_extensions <= set(extensions):
        _manifest_failure(recovery, "Transaction manifest extensions are incomplete")
    revision_before = extensions["revision_before"]
    if not isinstance(revision_before, dict) or set(revision_before) != {
        "existed",
        "sha256",
        "path",
    }:
        _manifest_failure(recovery, "Canonical revision before-state is invalid")
    expected_revision_before_path = f"{prefix}/before/canonical-revision.bin"
    if revision_before["existed"]:
        if (
            revision_before["path"] != expected_revision_before_path
            or not isinstance(revision_before["sha256"], str)
            or not SHA_PATTERN.fullmatch(revision_before["sha256"])
        ):
            _manifest_failure(
                recovery, "Canonical revision before-snapshot metadata is invalid"
            )
        revision_snapshot = _safe_manifest_path(
            root,
            expected_revision_before_path,
            must_exist=True,
            recovery=recovery,
        )
        if sha256_file(revision_snapshot) != revision_before["sha256"]:
            _manifest_failure(
                recovery, "Canonical revision before-snapshot hash mismatch"
            )
    elif revision_before["path"] is not None or revision_before["sha256"] is not None:
        _manifest_failure(recovery, "Absent canonical revision has snapshot metadata")

    expected_revision_after_path = f"{prefix}/after/canonical-revision.json"
    if extensions["revision_after_path"] != expected_revision_after_path:
        _manifest_failure(
            recovery, "Canonical revision after-source is not transaction-local"
        )
    revision_after = _safe_manifest_path(
        root,
        expected_revision_after_path,
        must_exist=True,
        recovery=recovery,
    )
    revision_after_hash = sha256_file(revision_after)
    if revision_after_hash != extensions["revision_after_sha256"]:
        _manifest_failure(recovery, "Canonical revision after-source hash mismatch")
    revision_value = _read_json_object(
        revision_after, "canonical revision after-source", recovery=recovery
    )
    _require_schema(
        revision_value,
        "canonical-revision.schema.json",
        "Canonical revision after-source",
        recovery=recovery,
    )
    content_hash = sha256_bytes(
        canonical_json(
            [
                {"path": item["path"], "sha256": item["sha256"]}
                for item in sorted(expected_published, key=lambda item: item["path"])
            ]
        )
    )
    expected_revision_fields = {
        "project_id": manifest["project_id"],
        "created_at": manifest["created_at"],
        "updated_at": manifest["created_at"],
        "extensions": {},
        "revision": manifest["target_revision"],
        "transaction_id": transaction_id,
        "published_trial_id": manifest["trial_id"],
        "content_hash": content_hash,
    }
    if any(
        revision_value.get(key) != value
        for key, value in expected_revision_fields.items()
    ):
        _manifest_failure(
            recovery, "Canonical revision after-source does not match the manifest"
        )

    receipt_json_path = f"{prefix}/after/publish-receipt.json"
    receipt_markdown_path = f"{prefix}/after/publish-receipt.md"
    expected_receipt_target = (
        f"research_trajectory/trials/{manifest['trial_id']}/PUBLISH_RECEIPT"
    )
    if (
        extensions["receipt_json_path"] != receipt_json_path
        or extensions["receipt_markdown_path"] != receipt_markdown_path
        or extensions["receipt_target_json"] != f"{expected_receipt_target}.json"
        or extensions["receipt_target_markdown"] != f"{expected_receipt_target}.md"
    ):
        _manifest_failure(
            recovery, "Publish receipt paths do not match the transaction"
        )
    receipt_path = _safe_manifest_path(
        root,
        receipt_json_path,
        must_exist=True,
        recovery=recovery,
    )
    receipt_markdown = _safe_manifest_path(
        root,
        receipt_markdown_path,
        must_exist=True,
        recovery=recovery,
    )
    receipt = _read_json_object(
        receipt_path, "publish receipt template", recovery=recovery
    )
    _require_schema(
        receipt,
        "publish-receipt.schema.json",
        "Publish receipt template",
        recovery=recovery,
    )
    expected_published.sort(key=lambda item: item["path"])
    expected_published.append(
        {"path": REVISION_PATH.as_posix(), "sha256": revision_after_hash}
    )
    expected_receipt_fields = {
        "project_id": manifest["project_id"],
        "created_at": manifest["created_at"],
        "updated_at": manifest["created_at"],
        "extensions": {},
        "trial_id": manifest["trial_id"],
        "transaction_id": transaction_id,
        "stage_id": manifest["stage_id"],
        "base_revision": manifest["base_revision"],
        "published_revision": manifest["target_revision"],
        "published_at": manifest["created_at"],
        "published_files": expected_published,
        "gate_status": extensions["gate_status"],
    }
    if any(receipt.get(key) != value for key, value in expected_receipt_fields.items()):
        _manifest_failure(
            recovery, "Publish receipt template does not match the manifest"
        )
    if receipt_markdown.read_bytes() != _receipt_markdown(receipt):
        _manifest_failure(recovery, "Publish receipt Markdown is not deterministic")
    _validate_journal(transaction_dir, manifest, required=recovery)


def _path_digest(path: Path, context: str) -> str | None:
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise RecoveryRequiredError(f"{context} is not a trustworthy regular file")
    return sha256_file(path) if path.is_file() else None


def _remove_known_temp(path: Path, allowed_hashes: set[str]) -> None:
    digest = _path_digest(path, f"Temporary file {path}")
    if digest is None:
        return
    if digest not in allowed_hashes:
        raise RecoveryRequiredError(f"Temporary file contains unknown bytes: {path}")
    try:
        path.unlink()
        _fsync_directory(path.parent)
    except PermissionError as exc:
        raise TransactionError(
            f"Cannot remove {path}; close programs holding the file and retry recovery"
        ) from exc


def _replace_from_bytes(target: Path, data: bytes, temp_path: Path) -> None:
    if temp_path.parent != target.parent or temp_path == target:
        raise RecoveryRequiredError(
            "Transaction temporary file is not in the target directory"
        )
    private = ".transactions" in target.parts
    parent_mode = 0o700 if private else 0o755
    _ensure_directory(target.parent, parent_mode)
    _chmod(target.parent, parent_mode)
    target_mode = 0o600 if private else 0o644
    if os.name == "posix" and target.is_file():
        target_mode = target.stat().st_mode & 0o777
    expected_hash = sha256_bytes(data)
    _remove_known_temp(temp_path, {expected_hash})
    try:
        descriptor = os.open(
            temp_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, target_mode
        )
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            _chmod(temp_path, target_mode)
            os.fsync(handle.fileno())
        os.replace(temp_path, target)
        _chmod(target, target_mode)
        _fsync_directory(target.parent)
    except PermissionError as exc:
        raise TransactionError(
            f"Cannot replace {target}; close programs holding the file and retry recovery"
        ) from exc
    finally:
        try:
            temp_path.unlink()
        except OSError:
            pass
    if _path_digest(target, f"Replaced target {target}") != expected_hash:
        raise RecoveryRequiredError(f"Durable replace hash mismatch for {target}")


def _revision_state(
    root: Path, manifest: dict[str, Any]
) -> tuple[Path, str | None, set[str | None]]:
    target = resolve_project_path(root, REVISION_PATH.as_posix())
    before = manifest["extensions"]["revision_before"]
    before_hash = before["sha256"] if before["existed"] else None
    after_hash = manifest["extensions"]["revision_after_sha256"]
    return target, _path_digest(target, "Canonical revision"), {before_hash, after_hash}


def _preflight_apply(root: Path, manifest: dict[str, Any]) -> None:
    for operation in manifest["operations"]:
        target = resolve_project_path(root, operation["path"])
        expected = operation["before_sha256"]
        if _path_digest(target, f"Canonical target {operation['path']}") != expected:
            raise RecoveryRequiredError(
                f"Canonical target changed after prepare: {operation['path']}"
            )
        temp = resolve_project_path(root, operation["temp_path"])
        if _path_digest(temp, f"Temporary file {operation['temp_path']}") is not None:
            raise RecoveryRequiredError(
                f"Transaction temporary path is already occupied: {operation['temp_path']}"
            )
    revision_target, revision_digest, allowed = _revision_state(root, manifest)
    del revision_target
    before = manifest["extensions"]["revision_before"]
    expected_revision = before["sha256"] if before["existed"] else None
    if revision_digest != expected_revision or revision_digest not in allowed:
        raise RecoveryRequiredError("Canonical revision changed after prepare")
    for key in ("receipt_target_json", "receipt_target_markdown"):
        target = resolve_project_path(root, manifest["extensions"][key])
        if _path_digest(target, f"Receipt target {target}") is not None:
            raise RecoveryRequiredError(
                f"Publish receipt target appeared after prepare: {target}"
            )


def _preflight_rollback(root: Path, manifest: dict[str, Any]) -> None:
    for operation in manifest["operations"]:
        target = resolve_project_path(root, operation["path"])
        digest = _path_digest(target, f"Canonical target {operation['path']}")
        if digest not in {operation["before_sha256"], operation["after_sha256"]}:
            raise RecoveryRequiredError(
                f"Canonical target contains unknown post-crash bytes: {operation['path']}"
            )
        temp = resolve_project_path(root, operation["temp_path"])
        temp_digest = _path_digest(temp, f"Temporary file {operation['temp_path']}")
        allowed_temp = {operation["after_sha256"]}
        if operation["before_sha256"] is not None:
            allowed_temp.add(operation["before_sha256"])
        if temp_digest is not None and temp_digest not in allowed_temp:
            raise RecoveryRequiredError(
                f"Transaction temporary file contains unknown bytes: {operation['temp_path']}"
            )
    _target, digest, allowed = _revision_state(root, manifest)
    if digest not in allowed:
        raise RecoveryRequiredError(
            "Canonical revision contains unknown post-crash bytes"
        )


def _verify_after_state(root: Path, manifest: dict[str, Any]) -> None:
    for operation in manifest["operations"]:
        target = resolve_project_path(root, operation["path"])
        if (
            _path_digest(target, f"Canonical target {operation['path']}")
            != operation["after_sha256"]
        ):
            raise RecoveryRequiredError(
                f"Applied target hash mismatch: {operation['path']}"
            )


def _expected_marker(manifest: dict[str, Any], root: Path) -> dict[str, Any]:
    receipt = resolve_project_path(
        root,
        manifest["extensions"]["receipt_json_path"],
        must_exist=True,
    )
    return {
        "transaction_id": manifest["transaction_id"],
        "target_revision": manifest["target_revision"],
        "committed_at": manifest["created_at"],
        "receipt_sha256": sha256_file(receipt),
    }


def _validate_commit_marker(root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    marker = resolve_project_path(root, manifest["commit_marker_path"])
    if marker.is_symlink() or not marker.is_file():
        raise RecoveryRequiredError(
            "Committed transaction marker is missing or untrustworthy"
        )
    value = _read_json_object(marker, "commit marker", recovery=True)
    if value != _expected_marker(manifest, root):
        raise RecoveryRequiredError(
            "Commit marker does not match the transaction manifest"
        )
    return value


def _receipt_pairs(
    root: Path, manifest: dict[str, Any]
) -> list[tuple[Path, Path, str]]:
    result: list[tuple[Path, Path, str]] = []
    for source_key, target_key in (
        ("receipt_json_path", "receipt_target_json"),
        ("receipt_markdown_path", "receipt_target_markdown"),
    ):
        source = resolve_project_path(
            root, manifest["extensions"][source_key], must_exist=True
        )
        target = resolve_project_path(root, manifest["extensions"][target_key])
        result.append((source, target, sha256_file(source)))
    return result


def _preflight_finalize(root: Path, manifest: dict[str, Any]) -> None:
    _validate_commit_marker(root, manifest)
    _verify_after_state(root, manifest)
    revision_target, revision_digest, _allowed = _revision_state(root, manifest)
    del revision_target
    if revision_digest != manifest["extensions"]["revision_after_sha256"]:
        raise RecoveryRequiredError("Committed canonical revision hash mismatch")
    for source, target, expected in _receipt_pairs(root, manifest):
        del source
        digest = _path_digest(target, f"Receipt target {target}")
        if digest not in {None, expected}:
            raise RecoveryRequiredError(
                f"Receipt target contains unknown post-crash bytes: {target}"
            )
        temp = target.parent / f".{target.name}.{manifest['transaction_id']}.tmp"
        temp_digest = _path_digest(temp, f"Receipt temporary file {temp}")
        if temp_digest not in {None, expected}:
            raise RecoveryRequiredError(
                f"Receipt temporary file contains unknown bytes: {temp}"
            )


def _apply_prepared(
    root: Path,
    transaction_dir: Path,
    manifest: dict[str, Any],
) -> dict[str, Any]:
    _validate_manifest(root, transaction_dir, manifest, recovery=False)
    _preflight_apply(root, manifest)
    manifest["state"] = "applying"
    _persist_manifest(transaction_dir, manifest)
    for operation in manifest["operations"]:
        target = resolve_project_path(root, operation["path"])
        if (
            _path_digest(target, f"Canonical target {operation['path']}")
            != operation["before_sha256"]
        ):
            raise RecoveryRequiredError(
                f"Canonical target changed while applying: {operation['path']}"
            )
        source = resolve_project_path(
            root, operation["after_source_path"], must_exist=True
        )
        temp = resolve_project_path(root, operation["temp_path"])
        _replace_from_bytes(target, source.read_bytes(), temp)
        operation["applied"] = True
        operation["applied_at"] = utc_now()
        _persist_manifest(transaction_dir, manifest)

    _verify_after_state(root, manifest)
    revision_target, revision_digest, _allowed = _revision_state(root, manifest)
    revision_before = manifest["extensions"]["revision_before"]
    expected_before = revision_before["sha256"] if revision_before["existed"] else None
    if revision_digest != expected_before:
        raise RecoveryRequiredError("Canonical revision changed while applying")
    revision_source = resolve_project_path(
        root,
        manifest["extensions"]["revision_after_path"],
        must_exist=True,
    )
    revision_temp = (
        revision_target.parent
        / f".{revision_target.name}.{manifest['transaction_id']}.tmp"
    )
    _replace_from_bytes(revision_target, revision_source.read_bytes(), revision_temp)

    _verify_after_state(root, manifest)
    if (
        _path_digest(revision_target, "Canonical revision")
        != manifest["extensions"]["revision_after_sha256"]
    ):
        raise RecoveryRequiredError("Canonical revision changed before commit marker")
    marker = resolve_project_path(root, manifest["commit_marker_path"])
    _write_json(marker, _expected_marker(manifest, root))
    _validate_commit_marker(root, manifest)
    _finalize_committed(root, transaction_dir, manifest)
    receipt_path = resolve_project_path(
        root,
        manifest["extensions"]["receipt_target_json"],
        must_exist=True,
    )
    return json.loads(receipt_path.read_text(encoding="utf-8"))


def _restore_revision(root: Path, manifest: dict[str, Any]) -> None:
    before = manifest["extensions"]["revision_before"]
    after_hash = manifest["extensions"]["revision_after_sha256"]
    target, digest, allowed = _revision_state(root, manifest)
    if digest not in allowed:
        raise RecoveryRequiredError(
            "Canonical revision contains unknown post-crash bytes"
        )
    temp = target.parent / f".{target.name}.{manifest['transaction_id']}.rollback.tmp"
    allowed_temp = {after_hash}
    if before["sha256"] is not None:
        allowed_temp.add(before["sha256"])
    _remove_known_temp(temp, allowed_temp)
    if before["existed"]:
        if digest == before["sha256"]:
            return
        snapshot = resolve_project_path(root, before["path"], must_exist=True)
        _replace_from_bytes(target, snapshot.read_bytes(), temp)
    elif digest == after_hash:
        try:
            target.unlink()
            _fsync_directory(target.parent)
        except PermissionError as exc:
            raise TransactionError(
                f"Cannot remove {target}; close programs holding the file and retry recovery"
            ) from exc


def _rollback(root: Path, transaction_dir: Path, manifest: dict[str, Any]) -> None:
    _validate_manifest(root, transaction_dir, manifest, recovery=True)
    _preflight_rollback(root, manifest)
    for operation in reversed(manifest["operations"]):
        target = resolve_project_path(root, operation["path"])
        digest = _path_digest(target, f"Canonical target {operation['path']}")
        allowed_temp = {operation["after_sha256"]}
        if operation["before_sha256"] is not None:
            allowed_temp.add(operation["before_sha256"])
        temp = resolve_project_path(root, operation["temp_path"])
        _remove_known_temp(temp, allowed_temp)
        if operation["operation"] == "create":
            if digest == operation["after_sha256"]:
                try:
                    target.unlink()
                    _fsync_directory(target.parent)
                except PermissionError as exc:
                    raise TransactionError(
                        f"Cannot remove {target}; close programs holding the file and retry recovery"
                    ) from exc
        elif digest == operation["after_sha256"]:
            snapshot = resolve_project_path(
                root, operation["before_snapshot_path"], must_exist=True
            )
            _replace_from_bytes(target, snapshot.read_bytes(), temp)
        elif digest != operation["before_sha256"]:
            raise RecoveryRequiredError(
                f"Canonical target changed during rollback: {operation['path']}"
            )
        operation["applied"] = False
        operation["applied_at"] = None
    _restore_revision(root, manifest)
    manifest["state"] = "rolled_back"
    manifest["committed_at"] = None
    _persist_manifest(transaction_dir, manifest)


def _audit_terminal_committed(root: Path, manifest: dict[str, Any]) -> None:
    _validate_commit_marker(root, manifest)
    for _source, target, expected in _receipt_pairs(root, manifest):
        if _path_digest(target, f"Committed receipt {target}") != expected:
            raise RecoveryRequiredError(
                f"Committed receipt is missing or changed: {target}"
            )


def _finalize_committed(
    root: Path, transaction_dir: Path, manifest: dict[str, Any]
) -> None:
    _validate_manifest(root, transaction_dir, manifest, recovery=True)
    _preflight_finalize(root, manifest)
    for source, target, expected in _receipt_pairs(root, manifest):
        if _path_digest(target, f"Receipt target {target}") is None:
            temp = target.parent / f".{target.name}.{manifest['transaction_id']}.tmp"
            _replace_from_bytes(target, source.read_bytes(), temp)
        if _path_digest(target, f"Receipt target {target}") != expected:
            raise RecoveryRequiredError(f"Receipt finalization hash mismatch: {target}")
    manifest["state"] = "committed"
    manifest["committed_at"] = manifest["created_at"]
    for operation in manifest["operations"]:
        operation["applied"] = True
        operation["applied_at"] = operation["applied_at"] or manifest["created_at"]
    _persist_manifest(transaction_dir, manifest)


def _remove_unprepared_transaction(transaction_dir: Path, transactions: Path) -> None:
    if transaction_dir.is_symlink() or not transaction_dir.is_dir():
        raise RecoveryRequiredError(
            "Unprepared transaction path is not a trustworthy directory"
        )
    allowed_root_files = {"JOURNAL.json"}
    allowed_before = re.compile(r"^(?:[0-9]{4}\.bin|canonical-revision\.bin)$")
    allowed_after = re.compile(
        r"^(?:[0-9]{4}\.bin|canonical-revision\.json|publish-receipt\.(?:json|md))$"
    )
    for child in transaction_dir.iterdir():
        if child.is_symlink():
            raise RecoveryRequiredError(
                f"Unprepared transaction contains a symlink: {child}"
            )
        if child.name in {"before", "after"}:
            if not child.is_dir():
                raise RecoveryRequiredError(
                    f"Unprepared transaction layout is invalid: {child}"
                )
            pattern = allowed_before if child.name == "before" else allowed_after
            for artifact in child.iterdir():
                if (
                    artifact.is_symlink()
                    or not artifact.is_file()
                    or not pattern.fullmatch(artifact.name)
                ):
                    raise RecoveryRequiredError(
                        f"Unprepared transaction contains unknown bytes: {artifact}"
                    )
        elif child.name not in allowed_root_files or not child.is_file():
            raise RecoveryRequiredError(
                f"Unprepared transaction contains unknown bytes: {child}"
            )
    shutil.rmtree(transaction_dir)
    _fsync_directory(transactions)


def _assert_no_incomplete_transactions(root: Path) -> None:
    transactions = _transactions_path(root, create=True)
    for transaction_dir in sorted(transactions.iterdir()):
        if not TXN_PATTERN.fullmatch(transaction_dir.name):
            continue
        if transaction_dir.is_symlink() or not transaction_dir.is_dir():
            raise RecoveryRequiredError(
                f"Transaction path is untrustworthy: {transaction_dir.name}"
            )
        manifest_path = _manifest_path(transaction_dir)
        if not manifest_path.is_file() or manifest_path.is_symlink():
            raise RecoveryRequiredError(
                f"Transaction {transaction_dir.name} is unprepared; run transaction recovery"
            )
        manifest = _read_json_object(
            manifest_path, "transaction manifest", recovery=True
        )
        _validate_manifest(root, transaction_dir, manifest, recovery=True)
        marker = transaction_dir / "COMMITTED.json"
        if marker.exists() or marker.is_symlink():
            if manifest["state"] != "committed":
                raise RecoveryRequiredError(
                    f"Transaction {transaction_dir.name} requires commit finalization"
                )
            _audit_terminal_committed(root, manifest)
        elif manifest["state"] != "rolled_back":
            raise RecoveryRequiredError(
                f"Transaction {transaction_dir.name} requires rollback recovery"
            )


def publish(
    project_root: str | Path,
    *,
    project_id: str,
    trial_id: str,
    stage_id: str,
    base_revision: int,
    operations: list[dict[str, Any]],
    gate_status: str,
    validator: Callable[[str, Path], None] | None = None,
) -> dict[str, Any]:
    """Publish one reviewed stage and return its deterministic receipt."""

    root = Path(project_root).resolve()
    transaction_id: str | None = None
    emit_operation_event(
        "transaction",
        "publication_requested",
        "starting",
        trial_id=trial_id,
        details={"base_revision": base_revision, "operation_count": len(operations)},
    )
    lock = ProjectLock(root)
    with _reader_lock(root):
        lock.acquire()
        try:
            _assert_no_incomplete_transactions(root)
            actual_revision = current_revision(root)
            if actual_revision != base_revision:
                raise StaleRevisionError(
                    f"Stage base revision {base_revision} is stale; current revision is {actual_revision}"
                )
            transaction_id = _transaction_id()
            emit_operation_event(
                "transaction",
                "prepared",
                "preparing",
                trial_id=trial_id,
                transaction_id=transaction_id,
                details={"base_revision": base_revision},
            )
            transaction_dir = root / TRANSACTIONS / transaction_id
            try:
                transaction_dir, manifest = _build_prepared_transaction(
                    root,
                    project_id,
                    trial_id,
                    stage_id,
                    base_revision,
                    operations,
                    gate_status,
                    validator,
                    transaction_id,
                )
            except Exception:
                if (
                    transaction_dir.is_dir()
                    and not _manifest_path(transaction_dir).exists()
                ):
                    _remove_unprepared_transaction(
                        transaction_dir,
                        _transactions_path(root, create=True),
                    )
                raise
            try:
                receipt = _apply_prepared(root, transaction_dir, manifest)
                emit_operation_event(
                    "transaction",
                    "committed",
                    "completed",
                    trial_id=trial_id,
                    transaction_id=transaction_id,
                    details={"published_revision": receipt.get("published_revision")},
                )
                return receipt
            except Exception as exc:
                marker = transaction_dir / "COMMITTED.json"
                if marker.exists() or marker.is_symlink():
                    _validate_commit_marker(root, manifest)
                    emit_operation_event(
                        "transaction",
                        "commit_requires_recovery",
                        "recovery_required",
                        trial_id=trial_id,
                        transaction_id=transaction_id,
                        details={"error_type": type(exc).__name__},
                    )
                    raise
                _rollback(root, transaction_dir, manifest)
                emit_operation_event(
                    "transaction",
                    "rolled_back",
                    "failed",
                    trial_id=trial_id,
                    transaction_id=transaction_id,
                    details={"error_type": type(exc).__name__},
                )
                raise
        finally:
            lock.release()


def recover_incomplete_transactions(project_root: str | Path) -> list[dict[str, Any]]:
    """Idempotently roll back uncommitted transactions or finish committed ones."""

    root = Path(project_root).resolve()
    transactions = _transactions_path(root)
    if not transactions.exists():
        return []
    results: list[dict[str, Any]] = []
    with _reader_lock(root):
        with ProjectLock(root):
            for transaction_dir in sorted(transactions.iterdir()):
                if not TXN_PATTERN.fullmatch(transaction_dir.name):
                    continue
                if transaction_dir.is_symlink() or not transaction_dir.is_dir():
                    raise RecoveryRequiredError(
                        f"Transaction path is untrustworthy: {transaction_dir.name}"
                    )
                manifest_path = _manifest_path(transaction_dir)
                if manifest_path.is_symlink() or not manifest_path.is_file():
                    transaction_id = transaction_dir.name
                    _remove_unprepared_transaction(transaction_dir, transactions)
                    result = {
                        "transaction_id": transaction_id,
                        "action": "removed_unprepared",
                        "state": "rolled_back",
                    }
                    results.append(result)
                    emit_operation_event(
                        "transaction",
                        "recovery",
                        "completed",
                        transaction_id=transaction_id,
                        details={"action": result["action"], "state": result["state"]},
                    )
                    continue
                manifest = _read_json_object(
                    manifest_path, "transaction manifest", recovery=True
                )
                _validate_manifest(root, transaction_dir, manifest, recovery=True)
                marker = transaction_dir / "COMMITTED.json"
                if marker.exists() or marker.is_symlink():
                    _validate_commit_marker(root, manifest)
                    if manifest["state"] == "committed":
                        _audit_terminal_committed(root, manifest)
                        action = "already_committed"
                    else:
                        _finalize_committed(root, transaction_dir, manifest)
                        action = "finalized"
                elif manifest["state"] == "committed":
                    raise RecoveryRequiredError(
                        f"Transaction {transaction_dir.name} claims committed without a marker"
                    )
                elif manifest["state"] == "rolled_back":
                    action = "already_rolled_back"
                else:
                    _rollback(root, transaction_dir, manifest)
                    action = "rolled_back"
                result = {
                    "transaction_id": manifest["transaction_id"],
                    "action": action,
                    "state": manifest["state"],
                }
                results.append(result)
                emit_operation_event(
                    "transaction",
                    "recovery",
                    "completed",
                    trial_id=manifest.get("trial_id"),
                    transaction_id=manifest["transaction_id"],
                    details={"action": action, "state": manifest["state"]},
                )
    return results


@contextmanager
def coherent_read(project_root: str | Path) -> Iterator[None]:
    """Block a multi-file reader while a publication or recovery is applying."""

    root = Path(project_root).resolve()
    key = str(root)
    with _reader_lock(root):
        entries = getattr(_READER_STATE, "entries", None)
        if entries is None:
            entries = {}
            _READER_STATE.entries = entries
        if key in entries:
            entries[key][0] += 1
            try:
                yield
            finally:
                entries[key][0] -= 1
            return
        filesystem_lock = _FilesystemCoherenceLock(root, exclusive=False)
        filesystem_lock.acquire()
        entries[key] = [1, filesystem_lock]
        try:
            yield
        finally:
            entries.pop(key, None)
            filesystem_lock.release()


def read_coherent_files(
    project_root: str | Path, relative_paths: list[str]
) -> dict[str, bytes | None]:
    root = Path(project_root).resolve()
    with coherent_read(root):
        result: dict[str, bytes | None] = {}
        for relative in relative_paths:
            normalized = _decode_relative(relative)
            path = resolve_project_path(root, normalized)
            result[normalized] = path.read_bytes() if path.is_file() else None
        return result


def transaction_health(project_root: str | Path) -> dict[str, Any]:
    root = Path(project_root).resolve()
    incomplete: list[str] = []
    last_transaction = None
    with coherent_read(root):
        transactions = _transactions_path(root)
        if not transactions.exists():
            return {
                "lock_state": "unlocked",
                "recovery_required": False,
                "incomplete_transaction_ids": [],
                "last_transaction_id": None,
                "last_published_revision": current_revision(root),
            }
        for directory in sorted(transactions.iterdir()):
            if not TXN_PATTERN.fullmatch(directory.name):
                continue
            last_transaction = directory.name
            manifest_path = _manifest_path(directory)
            marker = directory / "COMMITTED.json"
            try:
                if directory.is_symlink() or not directory.is_dir():
                    raise ValueError("untrustworthy transaction path")
                manifest = _read_json_object(
                    manifest_path, "transaction manifest", recovery=True
                )
                _validate_manifest(root, directory, manifest, recovery=True)
                state = manifest["state"]
                terminal = (state == "rolled_back" and not marker.exists()) or (
                    state == "committed" and marker.is_file()
                )
            except Exception:
                terminal = False
            if not terminal:
                incomplete.append(directory.name)
        return {
            "lock_state": (
                "locked" if (transactions / LOCK_NAME).exists() else "unlocked"
            ),
            "recovery_required": bool(incomplete),
            "incomplete_transaction_ids": incomplete,
            "last_transaction_id": last_transaction,
            "last_published_revision": current_revision(root),
        }
