"""Snapshot, audit, quarantine, and restore the v2 agent write boundary."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import threading
from typing import Any

try:
    from .v2_paths import PathRegistry, UnsafeProjectPath, normalize_relative_path
except ImportError:  # Direct script imports from templates/default/ui.
    from v2_paths import PathRegistry, UnsafeProjectPath, normalize_relative_path


BASELINE_FORMAT_VERSION = "1.0"
_COPY_CHUNK = 1024 * 1024
_HASH_CACHE_LOCK = threading.RLock()
_HASH_CACHE: dict[tuple[Any, ...], dict[str, Any]] = {}


class GuardError(RuntimeError):
    """Raised when a trustworthy baseline cannot be captured or loaded."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _chmod_best_effort(path: Path, mode: int) -> None:
    try:
        path.chmod(mode, follow_symlinks=False)
    except TypeError:
        # Python versions without ``Path.chmod(..., follow_symlinks=)`` still
        # support the safe regular-file/directory case used by restoration.
        if not path.is_symlink():
            try:
                path.chmod(mode)
            except OSError:
                pass
    except (NotImplementedError, OSError):
        pass


def _private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    _chmod_best_effort(path, 0o700)


def _write_private_bytes(path: Path, data: bytes) -> None:
    _private_dir(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        raise
    _chmod_best_effort(path, 0o600)


def _write_private_json(path: Path, value: Any) -> None:
    _write_private_bytes(
        path,
        (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )


def _is_within(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _stat_identity(path: Path) -> tuple[Any, ...] | None:
    """Return a content-change identity that an unprivileged POSIX agent cannot reset.

    POSIX ctime changes on content, ownership, mode, link, and timestamp writes,
    even if an agent restores mtime. Windows ``st_ctime`` is creation time, so
    Windows deliberately does not use this optimization and keeps full hashing.
    """

    if os.name == "nt":
        return None
    metadata = os.stat(path, follow_symlinks=False)
    if not stat.S_ISREG(metadata.st_mode):
        return None
    return (
        str(path.resolve(strict=True)),
        int(metadata.st_dev),
        int(metadata.st_ino),
        int(metadata.st_size),
        int(metadata.st_mtime_ns),
        int(metadata.st_ctime_ns),
    )


def _cached_hash(identity: tuple[Any, ...] | None) -> dict[str, Any] | None:
    if identity is None:
        return None
    with _HASH_CACHE_LOCK:
        cached = _HASH_CACHE.get(identity)
        return dict(cached) if isinstance(cached, dict) else None


def _remember_hash(
    identity: tuple[Any, ...] | None,
    digest: str,
    size: int,
    *,
    backup_path: Path | None = None,
) -> None:
    if identity is None:
        return
    with _HASH_CACHE_LOCK:
        prior = _HASH_CACHE.get(identity) or {}
        value = {"sha256": digest, "size": int(size)}
        prior_backup = Path(str(prior.get("backup_path") or ""))
        if backup_path is not None:
            value["backup_path"] = str(backup_path)
        elif prior_backup.is_file() and not prior_backup.is_symlink():
            value["backup_path"] = str(prior_backup)
        _HASH_CACHE[identity] = value


def _sha256_file(path: Path) -> tuple[str, int]:
    identity = _stat_identity(path)
    cached = _cached_hash(identity)
    if cached is not None:
        return str(cached["sha256"]), int(cached["size"])
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(_COPY_CHUNK):
            digest.update(chunk)
            size += len(chunk)
    if identity != _stat_identity(path):
        raise GuardError(f"file changed while it was being hashed: {path}")
    result = digest.hexdigest()
    _remember_hash(identity, result, size)
    return result, size


def _snapshot_file(source: Path, destination: Path) -> tuple[str, int]:
    _private_dir(destination.parent)
    identity = _stat_identity(source)
    cached = _cached_hash(identity)
    cached_backup = (
        Path(str(cached.get("backup_path") or ""))
        if cached is not None
        else None
    )
    if (
        cached is not None
        and cached_backup is not None
        and cached_backup.is_file()
        and not cached_backup.is_symlink()
    ):
        try:
            os.link(cached_backup, destination)
        except OSError:
            fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with cached_backup.open("rb") as src, os.fdopen(fd, "wb") as dst:
                shutil.copyfileobj(src, dst, _COPY_CHUNK)
                dst.flush()
                os.fsync(dst.fileno())
        if identity != _stat_identity(source):
            destination.unlink(missing_ok=True)
            raise GuardError(f"file changed while its baseline was linked: {source}")
        _remember_hash(
            identity,
            str(cached["sha256"]),
            int(cached["size"]),
            backup_path=destination,
        )
        return str(cached["sha256"]), int(cached["size"])
    digest = hashlib.sha256()
    size = 0
    with source.open("rb") as src:
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as dst:
            while chunk := src.read(_COPY_CHUNK):
                digest.update(chunk)
                size += len(chunk)
                dst.write(chunk)
            dst.flush()
            os.fsync(dst.fileno())
    if identity != _stat_identity(source):
        destination.unlink(missing_ok=True)
        raise GuardError(f"file changed while its baseline was copied: {source}")
    _chmod_best_effort(destination, 0o600)
    result = digest.hexdigest()
    _remember_hash(identity, result, size, backup_path=destination)
    return result, size


@dataclass(frozen=True)
class TreeEntry:
    path: str
    kind: str
    sha256: str | None
    size: int
    mode: int
    link_target: str | None = None
    backup_path: str | None = None
    realpath_escape: bool = False
    device: int | None = None
    inode: int | None = None
    mtime_ns: int | None = None
    ctime_ns: int | None = None

    def signature(self) -> tuple[Any, ...]:
        return self.kind, self.sha256, self.size, self.mode, self.link_target

    def rename_fingerprint(self) -> tuple[str, str] | None:
        if self.kind not in {"file", "symlink"} or not self.sha256:
            return None
        return self.kind, self.sha256

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "kind": self.kind,
            "sha256": self.sha256,
            "size": self.size,
            "mode": self.mode,
            "link_target": self.link_target,
            "backup_path": self.backup_path,
            "realpath_escape": self.realpath_escape,
            "device": self.device,
            "inode": self.inode,
            "mtime_ns": self.mtime_ns,
            "ctime_ns": self.ctime_ns,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "TreeEntry":
        return cls(
            path=normalize_relative_path(str(value["path"])),
            kind=str(value["kind"]),
            sha256=str(value["sha256"]) if value.get("sha256") is not None else None,
            size=int(value["size"]),
            mode=int(value["mode"]),
            link_target=str(value["link_target"]) if value.get("link_target") is not None else None,
            backup_path=str(value["backup_path"]) if value.get("backup_path") is not None else None,
            realpath_escape=bool(value.get("realpath_escape")),
            device=int(value["device"]) if value.get("device") is not None else None,
            inode=int(value["inode"]) if value.get("inode") is not None else None,
            mtime_ns=int(value["mtime_ns"]) if value.get("mtime_ns") is not None else None,
            ctime_ns=int(value["ctime_ns"]) if value.get("ctime_ns") is not None else None,
        )


@dataclass(frozen=True)
class AgentBaseline:
    project_root: Path
    run_dir: Path
    registry: PathRegistry
    entries: dict[str, TreeEntry]
    protected_status: dict[str, dict[str, Any]]
    captured_at: str

    @property
    def manifest_path(self) -> Path:
        return self.run_dir / "baseline.json"


def _entry_stat_identity(project_root: Path, entry: TreeEntry) -> tuple[Any, ...] | None:
    if (
        os.name == "nt"
        or entry.kind != "file"
        or None
        in (entry.device, entry.inode, entry.mtime_ns, entry.ctime_ns)
    ):
        return None
    return (
        str(_entry_path(project_root, entry.path).resolve(strict=True)),
        int(entry.device),
        int(entry.inode),
        int(entry.size),
        int(entry.mtime_ns),
        int(entry.ctime_ns),
    )


@dataclass(frozen=True)
class GuardResult:
    publishable: bool
    violations: tuple[dict[str, Any], ...]
    restored_paths: tuple[str, ...]
    restoration_errors: tuple[str, ...]
    evidence_path: Path

    def to_dict(self) -> dict[str, Any]:
        return {
            "publishable": self.publishable,
            "protocol_violation": bool(self.violations),
            "violations": list(self.violations),
            "restored_paths": list(self.restored_paths),
            "restoration_errors": list(self.restoration_errors),
            "evidence_path": str(self.evidence_path),
        }


def _entry_path(root: Path, relative_path: str) -> Path:
    return root.joinpath(*relative_path.split("/"))


def _scan_tree(
    project_root: Path,
    *,
    backup_root: Path | None = None,
    fail_on_escape: bool,
) -> dict[str, TreeEntry]:
    root = project_root.resolve(strict=True)
    entries: dict[str, TreeEntry] = {}

    def visit(directory: Path, relative_directory: str = "") -> None:
        try:
            with os.scandir(directory) as iterator:
                children = sorted(iterator, key=lambda item: item.name)
        except OSError as exc:
            raise GuardError(f"cannot scan project directory: {relative_directory or '.'}") from exc
        for child in children:
            raw_relative = f"{relative_directory}/{child.name}" if relative_directory else child.name
            try:
                relative = normalize_relative_path(raw_relative)
            except UnsafeProjectPath as exc:
                raise GuardError(f"project contains an unsafe path: {raw_relative!r}") from exc
            if relative != raw_relative.replace("\\", "/"):
                raise GuardError(f"project path is not canonically representable: {raw_relative!r}")
            lexical = Path(child.path)
            try:
                metadata = os.stat(child, follow_symlinks=False)
            except OSError as exc:
                raise GuardError(f"cannot stat project path: {relative}") from exc
            mode = stat.S_IMODE(metadata.st_mode)

            if child.is_symlink():
                try:
                    target = os.readlink(lexical)
                    resolved = lexical.resolve(strict=False)
                except (OSError, RuntimeError) as exc:
                    raise GuardError(f"cannot resolve project symlink: {relative}") from exc
                escaped = not _is_within(root, resolved)
                if escaped and fail_on_escape:
                    raise GuardError(f"baseline contains a symlink escape: {relative}")
                target_bytes = os.fsencode(target)
                entries[relative] = TreeEntry(
                    path=relative,
                    kind="symlink",
                    sha256=hashlib.sha256(target_bytes).hexdigest(),
                    size=len(target_bytes),
                    mode=mode,
                    link_target=target,
                    realpath_escape=escaped,
                )
                continue

            if child.is_dir(follow_symlinks=False):
                entries[relative] = TreeEntry(relative, "directory", None, 0, mode)
                visit(lexical, relative)
                continue

            if not child.is_file(follow_symlinks=False):
                raise GuardError(f"unsupported special project entry: {relative}")

            backup_path: str | None = None
            if backup_root is not None:
                destination = _entry_path(backup_root, relative)
                sha256, size = _snapshot_file(lexical, destination)
                backup_path = destination.relative_to(backup_root.parent.parent).as_posix()
            else:
                sha256, size = _sha256_file(lexical)
            try:
                final_metadata = os.stat(lexical, follow_symlinks=False)
            except OSError as exc:
                raise GuardError(f"cannot restat project path: {relative}") from exc
            if not stat.S_ISREG(final_metadata.st_mode) or int(final_metadata.st_size) != size:
                raise GuardError(f"project file changed type or size while scanned: {relative}")
            entries[relative] = TreeEntry(
                path=relative,
                kind="file",
                sha256=sha256,
                size=size,
                mode=stat.S_IMODE(final_metadata.st_mode),
                backup_path=backup_path,
                device=int(final_metadata.st_dev) if os.name != "nt" else None,
                inode=int(final_metadata.st_ino) if os.name != "nt" else None,
                mtime_ns=int(final_metadata.st_mtime_ns) if os.name != "nt" else None,
                ctime_ns=int(final_metadata.st_ctime_ns) if os.name != "nt" else None,
            )

    visit(root)
    return entries


def _protected_status(registry: PathRegistry, entries: dict[str, TreeEntry]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for pattern in registry.protected_patterns:
        matches = sorted(path for path in entries if (
            path == pattern or (pattern.endswith("/**") and (path == pattern[:-3] or path.startswith(pattern[:-3] + "/")))
        ))
        result[pattern] = {"exists": bool(matches), "matches": matches}
    return result


def _validate_safe_run_dir(project_root: Path, run_dir: Path) -> Path:
    root = project_root.resolve(strict=True)
    if run_dir.exists() and run_dir.is_symlink():
        raise GuardError("guard run directory must not be a symlink")
    resolved = run_dir.resolve(strict=False)
    if resolved == root or _is_within(root, resolved):
        raise GuardError("guard run directory must be outside the agent project")
    if (resolved / "baseline.json").exists():
        raise GuardError("guard run directory already contains a baseline")
    _private_dir(resolved)
    return resolved


def capture_agent_baseline(
    project_root: str | Path,
    run_dir: str | Path,
    *,
    trial_id: str,
    attempt_id: str,
    registry: PathRegistry | None = None,
) -> AgentBaseline:
    """Capture the exact pre-agent tree without consulting repository history."""

    root = Path(project_root).resolve(strict=True)
    if not root.is_dir():
        raise GuardError("project root is not a directory")
    policy = registry or PathRegistry.for_run(trial_id, attempt_id)
    safe_run_dir = _validate_safe_run_dir(root, Path(run_dir))
    backup_root = safe_run_dir / "baseline" / "files"
    _private_dir(backup_root)
    entries = _scan_tree(root, backup_root=backup_root, fail_on_escape=True)
    captured_at = _utc_now()
    protected = _protected_status(policy, entries)
    baseline = AgentBaseline(root, safe_run_dir, policy, entries, protected, captured_at)
    _write_private_json(
        baseline.manifest_path,
        {
            "format_version": BASELINE_FORMAT_VERSION,
            "captured_at": captured_at,
            "project_root": str(root),
            "registry": policy.to_dict(),
            "protected_paths": protected,
            "entries": {path: entry.to_dict() for path, entry in sorted(entries.items())},
        },
    )
    return baseline


def capture_agent_retry_baseline(
    project_root: str | Path,
    run_dir: str | Path,
    *,
    trial_id: str,
    attempt_id: str,
    registry: PathRegistry,
    previous_run_dir: str | Path,
    preserve_files: tuple[str, ...] = (),
) -> AgentBaseline:
    """Capture a retry tree while retaining selected pre-phase file anchors.

    A retry baseline normally adopts clean partial work from the prior attempt.
    Some validation anchors, notably the approved pre-execution ``TRIAL.json``,
    must instead remain byte-identical to the baseline that opened the phase.
    """

    previous = load_agent_baseline(previous_run_dir)
    current = capture_agent_baseline(
        project_root,
        run_dir,
        trial_id=trial_id,
        attempt_id=attempt_id,
        registry=registry,
    )
    if (
        previous.project_root != current.project_root
        or previous.registry.trial_id != trial_id
        or previous.registry.attempt_id != attempt_id
    ):
        raise GuardError("retry baseline identity differs from its prior phase baseline")

    entries = dict(current.entries)

    for raw_relative in preserve_files:
        relative = normalize_relative_path(raw_relative)
        entry = previous.entries.get(relative)
        if entry is None or entry.kind != "file" or not entry.backup_path:
            raise GuardError(f"prior retry anchor is not a recoverable file: {relative}")
        source = (previous.run_dir / entry.backup_path).resolve(strict=False)
        if not _is_within(previous.run_dir, source) or not source.is_file():
            raise GuardError(f"prior retry anchor escapes its guard directory: {relative}")
        digest, size = _sha256_file(source)
        if digest != entry.sha256 or size != entry.size:
            raise GuardError(f"prior retry anchor hash is invalid: {relative}")
        destination = _entry_path(current.run_dir / "baseline" / "files", relative)
        # The fresh snapshot cached this destination for the live file.  It is
        # about to hold older anchor bytes, so it cannot remain a reusable copy.
        current_entry = current.entries.get(relative)
        if current_entry is not None:
            with _HASH_CACHE_LOCK:
                _HASH_CACHE.pop(_entry_stat_identity(current.project_root, current_entry), None)
        if destination.exists() or destination.is_symlink():
            _remove_path(destination)
        _write_private_bytes(destination, source.read_bytes())
        entries[relative] = TreeEntry(
            path=entry.path,
            kind=entry.kind,
            sha256=entry.sha256,
            size=entry.size,
            mode=entry.mode,
            backup_path=destination.relative_to(current.run_dir).as_posix(),
            device=entry.device,
            inode=entry.inode,
            mtime_ns=entry.mtime_ns,
            ctime_ns=entry.ctime_ns,
        )

    baseline = AgentBaseline(
        current.project_root,
        current.run_dir,
        registry,
        entries,
        _protected_status(registry, entries),
        current.captured_at,
    )
    _write_private_json(
        baseline.manifest_path,
        {
            "format_version": BASELINE_FORMAT_VERSION,
            "captured_at": baseline.captured_at,
            "project_root": str(baseline.project_root),
            "registry": registry.to_dict(),
            "protected_paths": baseline.protected_status,
            "entries": {
                path: value.to_dict() for path, value in sorted(entries.items())
            },
        },
    )
    return baseline


def _read_baseline_manifest(run_dir: str | Path) -> tuple[Path, Path, dict[str, Any]]:
    safe_run_dir = Path(run_dir).resolve(strict=True)
    manifest_path = safe_run_dir / "baseline.json"
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GuardError("agent baseline is missing or invalid") from exc
    if payload.get("format_version") != BASELINE_FORMAT_VERSION:
        raise GuardError("unsupported agent baseline version")
    root = Path(str(payload["project_root"])).resolve(strict=True)
    if _is_within(root, safe_run_dir):
        raise GuardError("agent baseline is stored inside the project")
    return safe_run_dir, root, payload


def baseline_matches_files(
    run_dir: str | Path, project_root: str | Path, files: dict[str, bytes],
    *, trial_id: str, attempt_id: str, guard_root: str | Path,
) -> bool:
    """Check exact file bindings for display without loading the whole guard.

    This does not admit a run or audit a write boundary; those operations still
    use load_agent_baseline and the complete snapshot.
    """
    safe_run_dir, root, payload = _read_baseline_manifest(run_dir)
    registry = PathRegistry.from_dict(payload["registry"])
    if (
        root != Path(project_root).resolve(strict=True)
        or registry.trial_id != trial_id
        or registry.attempt_id != attempt_id
        or not _is_within(Path(guard_root).resolve(strict=True), safe_run_dir)
    ):
        return False
    for relative, contents in files.items():
        relative = normalize_relative_path(relative)
        recorded = payload["entries"].get(relative)
        if not recorded:
            return False
        entry = TreeEntry.from_dict(recorded)
        if entry.path != relative or entry.kind != "file" or not entry.backup_path:
            return False
        locator = normalize_relative_path(entry.backup_path)
        backup = safe_run_dir / locator
        if (
            not locator.startswith("baseline/files/")
            or not _is_within(safe_run_dir, backup.resolve(strict=False))
            or backup.is_symlink()
            or entry.size != len(contents)
            or entry.sha256 != hashlib.sha256(contents).hexdigest()
            or backup.read_bytes() != contents
        ):
            return False
    return True


def load_agent_baseline(run_dir: str | Path) -> AgentBaseline:
    safe_run_dir, root, payload = _read_baseline_manifest(run_dir)
    registry = PathRegistry.from_dict(payload["registry"])
    entries = {path: TreeEntry.from_dict(value) for path, value in payload["entries"].items()}
    for entry in entries.values():
        backup: Path | None = None
        if entry.kind == "file" and entry.backup_path:
            try:
                locator = normalize_relative_path(entry.backup_path)
            except UnsafeProjectPath as exc:
                raise GuardError("baseline contains an unsafe recoverable-copy locator") from exc
            backup = (safe_run_dir / locator).resolve(strict=False)
            if not _is_within(safe_run_dir, backup) or not locator.startswith("baseline/files/"):
                raise GuardError("baseline recoverable copy escapes the guard run directory")
        if entry.kind != "file" or not entry.sha256:
            continue
        try:
            recorded_identity = _entry_stat_identity(root, entry)
            current_identity = _stat_identity(_entry_path(root, entry.path))
        except (OSError, RuntimeError):
            continue
        if recorded_identity != current_identity:
            continue
        if backup is not None and (not backup.is_file() or backup.is_symlink()):
            continue
        _remember_hash(
            current_identity,
            entry.sha256,
            entry.size,
            backup_path=backup,
        )
    return AgentBaseline(
        project_root=root,
        run_dir=safe_run_dir,
        registry=registry,
        entries=entries,
        protected_status=dict(payload["protected_paths"]),
        captured_at=str(payload["captured_at"]),
    )


def _reasons(registry: PathRegistry, path: str, entry: TreeEntry | None) -> list[str]:
    reasons = registry.denial_reasons(path)
    if entry is not None and entry.realpath_escape:
        reasons.append("symlink_escape")
    return list(dict.fromkeys(reasons))


def _tree_changes(
    baseline: AgentBaseline,
    current: dict[str, TreeEntry],
) -> tuple[list[dict[str, Any]], set[str]]:
    before = baseline.entries
    created = set(current) - set(before)
    deleted = set(before) - set(current)
    modified = {path for path in set(before) & set(current) if before[path].signature() != current[path].signature()}

    created_by_fingerprint: dict[tuple[str, str], list[str]] = defaultdict(list)
    for path in sorted(created):
        fingerprint = current[path].rename_fingerprint()
        if fingerprint:
            created_by_fingerprint[fingerprint].append(path)

    renames: list[tuple[str, str]] = []
    for source in sorted(deleted):
        fingerprint = before[source].rename_fingerprint()
        candidates = created_by_fingerprint.get(fingerprint, []) if fingerprint else []
        if candidates:
            destination = candidates.pop(0)
            renames.append((source, destination))
            created.remove(destination)
            deleted.remove(source)

    violations: list[dict[str, Any]] = []
    restore_paths: set[str] = set()

    for source, destination in renames:
        reasons = list(dict.fromkeys(
            _reasons(baseline.registry, source, before[source])
            + _reasons(baseline.registry, destination, current[destination])
        ))
        if reasons:
            violations.append({
                "action": "rename",
                "path": source,
                "destination": destination,
                "reasons": reasons,
                "before_sha256": before[source].sha256,
                "after_sha256": current[destination].sha256,
            })
            restore_paths.update((source, destination))

    for action, paths in (("create", created), ("delete", deleted), ("replace", modified)):
        for path in sorted(paths):
            entry = current.get(path) if action != "delete" else before.get(path)
            reasons = _reasons(baseline.registry, path, entry)
            if not reasons:
                continue
            if (
                action == "create"
                and entry is not None
                and entry.kind == "directory"
                and all(
                    candidate.kind == "directory"
                    for candidate_path, candidate in current.items()
                    if candidate_path == path or candidate_path.startswith(path + "/")
                )
            ):
                # A tool may briefly misspell an output path, delete every
                # file it placed there, and leave only empty parent
                # directories.  There are no bytes to quarantine and no
                # durable project mutation to accept.  Remove the empty tree
                # during restoration without turning a self-reverted path
                # typo into a terminal protocol violation.  Files, symlinks,
                # type changes, and non-empty trees remain fail-closed.
                restore_paths.add(path)
                continue
            violations.append({
                "action": action,
                "path": path,
                "reasons": reasons,
                "before_sha256": before.get(path).sha256 if path in before else None,
                "after_sha256": current.get(path).sha256 if path in current else None,
            })
            restore_paths.add(path)

    return violations, restore_paths


def _path_exists(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def _remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def _quarantine_paths(
    baseline: AgentBaseline,
    current: dict[str, TreeEntry],
    paths: set[str],
) -> dict[str, str]:
    """Persist one immutable quarantine namespace for this audit.

    A retained baseline may be audited more than once: for example, an old
    service-owned write is restored, the managed template is upgraded, and the
    same baseline is audited once more before a retry baseline is captured.
    Quarantine evidence from the first audit must remain immutable, so a later
    audit cannot reuse ``quarantine/0001``.  Give every audit its own namespace
    instead of overwriting or deleting earlier evidence.
    """

    locators: dict[str, str] = {}
    quarantine_root = baseline.run_dir / "quarantine"
    _private_dir(quarantine_root)
    audit_root = quarantine_root / (
        datetime.now(timezone.utc).strftime("audit-%Y%m%dT%H%M%S%fZ-")
        + os.urandom(6).hex()
    )
    _private_dir(audit_root)
    for index, relative in enumerate(sorted(paths), start=1):
        entry = current.get(relative)
        if entry is None:
            continue
        item_dir = audit_root / f"{index:04d}"
        _private_dir(item_dir)
        _write_private_json(item_dir / "metadata.json", entry.to_dict())
        source = _entry_path(baseline.project_root, relative)
        if entry.kind == "file" and _path_exists(source):
            _snapshot_file(source, item_dir / "content.bin")
        elif entry.kind == "symlink":
            _write_private_bytes(item_dir / "link-target.bin", os.fsencode(entry.link_target or ""))
        locators[relative] = item_dir.relative_to(baseline.run_dir).as_posix()
    return locators


def _restore_baseline_paths(baseline: AgentBaseline, paths: set[str]) -> tuple[list[str], list[str]]:
    before = baseline.entries
    errors: list[str] = []

    # Remove newly-created entries deepest-first.  Existing directories are
    # retained unless their type changed, so unchanged children are not lost.
    for relative in sorted((path for path in paths if path not in before), key=lambda item: (-item.count("/"), item)):
        target = _entry_path(baseline.project_root, relative)
        try:
            if _path_exists(target):
                _remove_path(target)
        except OSError as exc:
            errors.append(f"{relative}: cannot remove unauthorized create: {exc}")

    directories = [before[path] for path in paths if path in before and before[path].kind == "directory"]
    for entry in sorted(directories, key=lambda item: item.path.count("/")):
        target = _entry_path(baseline.project_root, entry.path)
        try:
            if _path_exists(target) and (target.is_symlink() or not target.is_dir()):
                _remove_path(target)
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
        except OSError as exc:
            errors.append(f"{entry.path}: cannot restore directory: {exc}")

    non_directories = [before[path] for path in paths if path in before and before[path].kind != "directory"]
    for entry in sorted(non_directories, key=lambda item: item.path.count("/")):
        target = _entry_path(baseline.project_root, entry.path)
        try:
            if _path_exists(target):
                _remove_path(target)
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if entry.kind == "file":
                if not entry.backup_path:
                    raise GuardError("baseline file has no recoverable copy")
                source = baseline.run_dir / entry.backup_path
                backup_hash, _ = _sha256_file(source)
                if backup_hash != entry.sha256:
                    raise GuardError("recoverable copy hash mismatch")
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with source.open("rb") as src, os.fdopen(fd, "wb") as dst:
                    shutil.copyfileobj(src, dst, _COPY_CHUNK)
                    dst.flush()
                    os.fsync(dst.fileno())
                _chmod_best_effort(target, entry.mode)
            elif entry.kind == "symlink":
                os.symlink(entry.link_target or "", target)
            else:
                raise GuardError(f"unsupported baseline entry kind: {entry.kind}")
        except (OSError, GuardError) as exc:
            errors.append(f"{entry.path}: cannot restore baseline: {exc}")

    for entry in sorted(directories, key=lambda item: -item.path.count("/")):
        _chmod_best_effort(_entry_path(baseline.project_root, entry.path), entry.mode)

    restored: list[str] = []
    try:
        final_tree = _scan_tree(baseline.project_root, fail_on_escape=False)
    except GuardError as exc:
        errors.append(f"post-restoration scan failed: {exc}")
        return restored, errors
    for relative in sorted(paths):
        expected = before.get(relative)
        actual = final_tree.get(relative)
        if expected is None:
            if actual is None:
                restored.append(relative)
            else:
                errors.append(f"{relative}: unauthorized create still exists")
        elif actual is not None and actual.signature() == expected.signature():
            restored.append(relative)
        else:
            errors.append(f"{relative}: restored bytes, type, or mode do not match baseline")
    return restored, errors


def audit_and_restore_agent_writes(baseline: AgentBaseline | str | Path) -> GuardResult:
    """Audit one agent invocation and restore every unauthorized tree change."""

    snapshot = load_agent_baseline(baseline) if isinstance(baseline, (str, Path)) else baseline
    current = _scan_tree(snapshot.project_root, fail_on_escape=False)
    violations, restore_paths = _tree_changes(snapshot, current)
    quarantine = _quarantine_paths(snapshot, current, restore_paths) if violations else {}
    for violation in violations:
        affected = [violation["path"]]
        if violation.get("destination"):
            affected.append(violation["destination"])
        violation["quarantine"] = [quarantine[path] for path in affected if path in quarantine]

    restored, errors = (
        _restore_baseline_paths(snapshot, restore_paths)
        if restore_paths
        else ([], [])
    )
    evidence_path = snapshot.run_dir / "guard-result.json"
    evidence = {
        "schema_version": "2.0",
        "artifact_type": "protected_write_evidence",
        "registry_version": snapshot.registry.registry_version,
        "trial_id": snapshot.registry.trial_id,
        "attempt_id": snapshot.registry.attempt_id,
        "captured_at": snapshot.captured_at,
        "audited_at": _utc_now(),
        "publishable": not violations and not errors,
        "protocol_violation": bool(violations),
        "violations": violations,
        "restored_paths": restored,
        "restoration_errors": errors,
    }
    _write_private_json(evidence_path, evidence)
    return GuardResult(
        publishable=bool(evidence["publishable"]),
        violations=tuple(violations),
        restored_paths=tuple(restored),
        restoration_errors=tuple(errors),
        evidence_path=evidence_path,
    )


def agent_write_changes(
    baseline: AgentBaseline | str | Path,
) -> tuple[dict[str, Any], ...]:
    """Return current in-boundary changes relative to a captured baseline.

    The guard evidence intentionally records violations only.  Plan approval
    also needs to know which *allowed* preflight files changed so none can stay
    hidden from the Plan Review or its material hash.
    """

    snapshot = (
        load_agent_baseline(baseline)
        if isinstance(baseline, (str, Path))
        else baseline
    )
    current = _scan_tree(snapshot.project_root, fail_on_escape=False)
    before = snapshot.entries
    changes: list[dict[str, Any]] = []
    for relative in sorted(set(before) | set(current)):
        prior = before.get(relative)
        after = current.get(relative)
        if prior is not None and after is not None and prior.signature() == after.signature():
            continue
        if not snapshot.registry.agent_write_allowed(relative):
            continue
        action = "create" if prior is None else "delete" if after is None else "replace"
        changes.append(
            {
                "action": action,
                "path": relative,
                "before_kind": prior.kind if prior is not None else None,
                "after_kind": after.kind if after is not None else None,
                "before_sha256": prior.sha256 if prior is not None else None,
                "after_sha256": after.sha256 if after is not None else None,
            }
        )
    return tuple(changes)


def agent_write_violations(
    baseline: AgentBaseline | str | Path,
) -> tuple[dict[str, Any], ...]:
    """Inspect current unauthorized changes without replacing audit evidence."""

    snapshot = (
        load_agent_baseline(baseline)
        if isinstance(baseline, (str, Path))
        else baseline
    )
    current = _scan_tree(snapshot.project_root, fail_on_escape=False)
    violations, _restore_paths = _tree_changes(snapshot, current)
    return tuple(violations)
