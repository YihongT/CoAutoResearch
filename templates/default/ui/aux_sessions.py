#!/usr/bin/env python3
"""Auxiliary project chat-session layer for CoAutoResearch.

This module adds Codex/Box-style multi-session support on top of the existing
single-session autoresearch engine WITHOUT touching the evolution loop.

Two session kinds are supported:

- ``chat``      : independent project discussion. V2 chats use read-only tools
                  and can run alongside research; changes go through the main
                  research flow. Legacy chats retain their editing behavior.
- ``evolution`` : the persistent autoresearch loop. There is exactly ONE and it
                  is handled by the legacy engine; this manager only tracks a
                  lightweight pointer to it so the UI can list it uniformly.

Each ``chat`` session owns an independent CLI session id, so its conversation
context stays separate from the evolution loop and from other chats.

The module is intentionally self-contained: it receives an ``engine`` object
(the host module ``server``) that exposes the small set of helpers it needs, so
that server.py wiring stays minimal.
"""

from __future__ import annotations

import json
import os
import base64
import hashlib
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

try:
    from .v2_guard import audit_and_restore_agent_writes, capture_agent_baseline, load_agent_baseline
    from .v2_paths import PathRegistry
    from .v2_security import redact_mapping
except ImportError:  # Direct import from a packed project's ui directory.
    from v2_guard import audit_and_restore_agent_writes, capture_agent_baseline, load_agent_baseline
    from v2_paths import PathRegistry
    from v2_security import redact_mapping


AUX_SESSION_KINDS = ("chat", "evolution")
AUX_LEGACY_CHAT_KINDS = {"monitor", "idea"}
AUX_CHAT_HISTORY_MAX = 200
AUX_LOG_MAX = 2000
AUX_TRANSCRIPT_MAX = 600
AUX_EVENT_BUFFER_MAX = 500
_AUX_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


def _is_within(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _private_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        path.chmod(0o700)
    except OSError:
        pass
    return path


def _write_private_bytes(path: Path, data: bytes) -> None:
    _private_dir(path.parent)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        try:
            path.chmod(0o600)
        except OSError:
            pass
        try:
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


def _write_private_json(path: Path, value: Any) -> None:
    _write_private_bytes(
        path,
        (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).astimezone().replace(microsecond=0).isoformat()


def _now_id() -> str:
    from datetime import datetime

    return datetime.now().strftime("%Y%m%d%H%M%S")


def _slug(value: str, fallback: str = "session") -> str:
    cleaned = "".join(ch if ch.isalnum() else "-" for ch in str(value or "").lower())
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return cleaned[:48] or fallback


def normalize_aux_session_kind(kind: str) -> str:
    value = str(kind or "").strip().lower()
    if value in AUX_LEGACY_CHAT_KINDS:
        return "chat"
    return value if value in AUX_SESSION_KINDS else "chat"


def auto_session_title(message: str) -> str:
    text = " ".join(str(message or "").strip().split())
    if not text:
        return "New session"
    for marker in ("# ", "## ", "- ", "* ", "> "):
        text = text.replace(marker, "")
    text = text.strip("`*_[](){}<>\"'")
    if not text:
        return "New session"
    if len(text) <= 52:
        return text
    return text[:49].rstrip(" ,.;:") + "..."


class AuxSession:
    """A single isolated chat session backed by its own CLI thread."""

    def __init__(self, manager: "AuxSessionManager", kind: str, title: str = "") -> None:
        self.manager = manager
        self.kind = normalize_aux_session_kind(kind)
        self.id = f"{self.kind[:3].upper()}{_now_id()}_{uuid.uuid4().hex[:6]}"
        self.title = str(title or "").strip() or self._default_title()
        self.title_source = "user" if str(title or "").strip() else "auto"
        self.created_at = _now_iso()
        self.updated_at = self.created_at
        self.cli_session_id = ""
        self.status = "idle"  # idle | running | interrupted | error | completed
        self.started_at = ""
        self.settings: dict[str, Any] = {}
        self.backend = "codex"
        self.plan_id = ""
        self.plan_thread_id = ""
        self.plan_turn_id = ""
        self.chat_history: list[dict[str, Any]] = []
        self.logs: list[str] = []
        self.transcript: list[dict[str, Any]] = []
        self.streaming_transcript: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []
        self.event_id = 0
        self.last_event_at = ""
        self.last_event_summary = ""
        self.returncode: Any = None
        self._process: subprocess.Popen[str] | None = None
        self._thread: threading.Thread | None = None
        self._cancel_requested = False
        self._stop_requested = False
        self._v2_guard_dir: Path | None = None
        self._v2_boundary_mode = ""
        self.v2_boundary_status = ""
        self.lock = threading.RLock()
        self.event_condition = threading.Condition(threading.RLock())
        # per-session directories
        self.dir = self.manager.sessions_dir / self.id
        self.context_dir = self.dir / "context"
        self.workspace_dir = self.manager.workspace_path(self)
        self.context_path = self.context_dir / "CONTEXT.md"

    # ---- lifecycle -------------------------------------------------------
    def _default_title(self) -> str:
        return {
            "chat": "New session",
            "evolution": "Evolution Run",
        }.get(self.kind, "New session")

    def ensure_dirs(self) -> None:
        _private_dir(self.dir)
        _private_dir(self.context_dir)
        # Preserve attachments from older releases without changing the live
        # project while the research worker may be writing there.
        legacy = self.manager.context.root / "workspace" / "ui_sessions" / self.id
        if self.workspace_dir != legacy and not self.workspace_dir.exists() and legacy.is_dir() and not legacy.is_symlink():
            shutil.copytree(legacy, self.workspace_dir, ignore=lambda directory, names: [
                name for name in names if (Path(directory) / name).is_symlink()
            ])
        _private_dir(self.workspace_dir)

    def is_running(self) -> bool:
        with self.lock:
            proc = self._process
        return bool(proc and not getattr(proc, "_coauto_tree_drained", False))

    def is_active(self) -> bool:
        """True while this session has (or claims to have) a run in flight."""
        with self.lock:
            return self.status == "running" or self.is_running()

    def meta(self) -> dict[str, Any]:
        with self.lock:
            if self.kind == "evolution":
                # The evolution session is only a pointer to the legacy
                # autoresearch loop (see module docstring) -- it must report
                # that loop's real status, not its own (unused) run state,
                # or the sessions rail and the research panel would disagree.
                status = self.manager.engine.evolution_loop_status(self.manager.context)["status"]
            else:
                status = "running" if self.is_active() else self.status
            return {
                "id": self.id,
                "kind": self.kind,
                "title": self.title,
                "title_source": self.title_source,
                "created_at": self.created_at,
                "updated_at": self.updated_at,
                "started_at": self.started_at,
                "cli_session_id": self.cli_session_id,
                "status": status,
                "backend": self.backend,
                "settings": self.settings,
                "returncode": self.returncode,
                "plan_id": self.plan_id,
                "v2_boundary_status": self.v2_boundary_status,
                "read_only": self.manager.is_read_only_discussion(self),
            }

    def public(self) -> dict[str, Any]:
        m = self.meta()
        with self.lock:
            running = (m["status"] == "running") if self.kind == "evolution" else self.is_active()
            if self.manager.uses_strict_boundary():
                # Files remain available through the contained workspace API;
                # internal absolute paths are not part of the public contract.
                m["workspace"] = ""
                m["project_root"] = ""
                m["context_path"] = ""
                m["settings"] = self.manager.public_value(m.get("settings", {}))
            else:
                m["workspace"] = str(self.workspace_dir)
                m["project_root"] = str(self.manager.context.root)
                m["context_path"] = str(self.context_path)
            m["event_id"] = self.event_id
            m["last_event_at"] = self.last_event_at
            m["last_event_summary"] = self.manager.public_value(self.last_event_summary)
            m["running"] = running
            m["chat_history_count"] = len(self.chat_history)
            m["transcript_count"] = len(self.transcript)
            m["has_chat_history"] = bool(self.chat_history)
        return m

    def snapshot(self) -> dict[str, Any]:
        m = self.public()
        with self.lock:
            m["chat_history"] = self.manager.public_value(list(self.chat_history)[-AUX_CHAT_HISTORY_MAX:])
            m["logs"] = self.manager.public_value(list(self.logs)[-200:])
            m["transcript"] = self.manager.public_value(list(self.transcript)[-120:])
            m["context_preview"] = self.manager.public_value(self.context_preview())
            m["plan_artifacts"] = self.manager.public_value(self.plan_artifacts_snapshot_locked())
        return m

    def plan_artifacts_snapshot_locked(self) -> dict[str, Any]:
        artifacts: dict[str, Any] = {}
        seen: set[str] = set()
        for message in self.chat_history:
            if not isinstance(message, dict):
                continue
            if str(message.get("kind") or "") != "plan":
                continue
            plan_id = str(message.get("plan_id") or "").strip()
            if not plan_id or plan_id in seen:
                continue
            seen.add(plan_id)
            try:
                artifact = self.manager.engine.read_plan_artifact(plan_id)
                public = self.manager.engine.public_plan_artifact(artifact)
            except Exception:
                continue
            if public.get("id"):
                artifacts[str(public["id"])] = public
        return artifacts

    def context_preview(self, limit: int = 12000) -> str:
        try:
            text = self.context_path.read_text(encoding="utf-8")
        except OSError:
            return ""
        marker = "## Session boundary"
        idx = text.find(marker)
        if idx >= 0:
            text = text[idx:]
        text = text.strip()
        if len(text) > limit:
            text = text[:limit].rstrip() + "\n\n... (truncated)"
        return text

    def persist(self) -> None:
        self.ensure_dirs()
        with self.lock:
            meta = self.meta()
            history = list(self.chat_history)[-AUX_CHAT_HISTORY_MAX:]
            logs = list(self.logs)[-200:]
            transcript = list(self.transcript)[-120:]
        try:
            _write_private_json(self.dir / "meta.json", meta)
            _write_private_json(self.dir / "chat_history.json", history)
            _write_private_json(self.dir / "logs.json", logs)
            _write_private_json(self.dir / "transcript.json", transcript)
        except OSError:
            pass

    def load_persisted(self) -> None:
        meta_path = self.dir / "meta.json"
        history_path = self.dir / "chat_history.json"
        logs_path = self.dir / "logs.json"
        transcript_path = self.dir / "transcript.json"
        try:
            if meta_path.exists():
                data = json.loads(meta_path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    self.title = str(data.get("title") or self.title)
                    self.title_source = str(data.get("title_source") or self.title_source or "auto")
                    self.created_at = str(data.get("created_at") or self.created_at)
                    self.updated_at = str(data.get("updated_at") or self.updated_at)
                    self.started_at = str(data.get("started_at") or "")
                    self.cli_session_id = str(data.get("cli_session_id") or "")
                    self.backend = str(data.get("backend") or "codex")
                    self.plan_id = str(data.get("plan_id") or "")
                    self.v2_boundary_status = str(data.get("v2_boundary_status") or "")
                    if isinstance(data.get("settings"), dict):
                        self.settings = data["settings"]
                    prev = str(data.get("status") or "idle")
                    self.status = "interrupted" if prev in {"running"} else prev
            if history_path.exists():
                hist = json.loads(history_path.read_text(encoding="utf-8"))
                if isinstance(hist, list):
                    self.chat_history = [h for h in hist if isinstance(h, dict)]
            if logs_path.exists():
                logs = json.loads(logs_path.read_text(encoding="utf-8"))
                if isinstance(logs, list):
                    self.logs = [str(item) for item in logs][-200:]
            if transcript_path.exists():
                transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
                if isinstance(transcript, list):
                    self.transcript = [item for item in transcript if isinstance(item, dict)][-120:]
        except (OSError, json.JSONDecodeError):
            pass

    # ---- events (per-session SSE) ---------------------------------------
    def emit(self, kind: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        event = {
            "schema_version": 1,
            "event_id": 0,
            "session_id": self.id,
            "kind": str(kind or "agent_event"),
            "created_at": _now_iso(),
        }
        event.update(self.manager.public_value(payload or {}))
        with self.event_condition:
            self.event_id += 1
            event["event_id"] = self.event_id
            self.events.append(event)
            if len(self.events) > AUX_EVENT_BUFFER_MAX:
                self.events = self.events[-AUX_EVENT_BUFFER_MAX:]
            self.event_condition.notify_all()
        return event

    def _append_trace_updates(self, updates: list[dict[str, Any]]) -> list[dict[str, Any]]:
        engine = self.manager.engine
        entries: list[dict[str, Any]] = []
        with self.lock:
            for update in updates:
                if not isinstance(update, dict):
                    continue
                entry = engine.trace_transcript_entry(update, run_id=self.id, entry_count=len(self.transcript))
                entries.append(self._upsert_transcript_entry_locked(entry))
        for entry in entries:
            self.emit("agent_event", {"transcript_entry": entry})
        return entries

    def append_log(self, line: str, normalizer: Any = None) -> None:
        engine = self.manager.engine
        line = self.manager.redact_log_text(line)
        backend = self.backend or "codex"
        display = engine.format_agent_event(line, backend)
        trace_updates: list[dict[str, Any]] = []
        if normalizer is not None:
            try:
                trace_updates = [item for item in normalizer.feed(line) if isinstance(item, dict)]
            except Exception:
                trace_updates = []
        transcript = None if trace_updates else engine.transcript_from_agent_line(line, backend)
        streaming_update = None if trace_updates or transcript else engine.streaming_update_from_agent_line(line, backend)
        suppress_summary = engine.should_suppress_agent_event_summary(line, backend)
        event_at = _now_iso()
        transcript_update: dict[str, Any] | None = None
        transcript_updates: list[dict[str, Any]] = []
        with self.lock:
            if line.strip():
                self.logs.append(line.rstrip("\n"))
                self.last_event_at = event_at
            if display and not suppress_summary:
                self.last_event_summary = engine.compact_single_line(display, 260)
            elif line.strip() and not suppress_summary:
                self.last_event_summary = engine.compact_single_line(line, 260)
            # capture CLI session id for resume
            sid = ""
            try:
                sid = engine.find_session_identifier(json.loads(line))
            except json.JSONDecodeError:
                sid = engine.find_session_identifier(line)
            if sid:
                self.cli_session_id = sid
            if trace_updates:
                for update in trace_updates:
                    entry = engine.trace_transcript_entry(update, run_id=self.id, entry_count=len(self.transcript))
                    transcript_updates.append(self._upsert_transcript_entry_locked(entry))
                if transcript_updates:
                    transcript_update = transcript_updates[-1]
            elif transcript and transcript.get("content"):
                transcript_update = self._finalize_streaming_transcript_locked(transcript)
            elif streaming_update:
                transcript_update = self._upsert_streaming_transcript_locked(streaming_update)
            self.logs = self.logs[-AUX_LOG_MAX:]
        payload: dict[str, Any] = {}
        if display and not suppress_summary:
            payload["log"] = display
        if transcript_updates:
            for index, entry in enumerate(transcript_updates):
                entry_payload = {"transcript_entry": entry}
                if index == 0 and payload.get("log"):
                    entry_payload["log"] = payload["log"]
                self.emit("agent_event", entry_payload)
            return
        if transcript_update and transcript_update.get("content"):
            payload["transcript_entry"] = transcript_update
        if payload or line.strip():
            self.emit("agent_event", payload)

    def _upsert_transcript_entry_locked(self, entry: dict[str, Any]) -> dict[str, Any]:
        entry_id = str(entry.get("id") or "").strip()
        if entry_id:
            for index, existing in enumerate(self.transcript):
                if str(existing.get("id") or "") == entry_id:
                    merged = {**existing, **entry}
                    if existing.get("created_at"):
                        merged["created_at"] = existing["created_at"]
                    if entry.get("streaming") is False:
                        merged.pop("streaming", None)
                    self.transcript[index] = merged
                    self.transcript = self.transcript[-AUX_TRANSCRIPT_MAX:]
                    return merged
        self.transcript.append(entry)
        self.transcript = self.transcript[-AUX_TRANSCRIPT_MAX:]
        return entry

    def _upsert_streaming_transcript_locked(self, update: dict[str, Any]) -> dict[str, Any] | None:
        key = str(update.get("key") or "assistant:active")
        text = str(update.get("text") or "")
        existing = self.streaming_transcript.get(key) if isinstance(self.streaming_transcript.get(key), dict) else None
        if not text.strip() and not existing:
            return None
        mode = str(update.get("mode") or "append")
        content = text if mode == "snapshot" else f"{existing.get('content', '') if existing else ''}{text}"
        content = content[: getattr(self.manager.engine, "STREAMING_TRANSCRIPT_MAX_CHARS", 12000)]
        if not content.strip():
            return None
        entry_id = str(existing.get("id") or "") if existing else f"{self.id}_stream_{len(self.transcript) + 1:04d}"
        created_at = str(existing.get("created_at") or "") if existing else _now_iso()
        parsed = {
            "role": update.get("role") or "assistant",
            "kind": update.get("kind") or "assistant",
            "title": update.get("title") or "Assistant",
            "content": content,
            "raw_type": update.get("raw_type") or "stream.delta",
            "editable": False,
        }
        entry = self.manager.engine.parsed_transcript_entry(parsed, entry_id=entry_id, streaming=True, created_at=created_at)
        entry = self._upsert_transcript_entry_locked(entry)
        self.streaming_transcript[key] = {
            "id": entry_id,
            "created_at": created_at,
            "content": content,
            "family": str(update.get("family") or update.get("kind") or "assistant"),
            "role": str(update.get("role") or "assistant"),
            "kind": str(update.get("kind") or "assistant"),
        }
        return entry

    def _finalize_streaming_transcript_locked(self, parsed: dict[str, Any]) -> dict[str, Any] | None:
        content = str(parsed.get("content") or "").strip()
        if not content:
            return None
        role = str(parsed.get("role") or "").strip().lower()
        kind = str(parsed.get("kind") or "").strip().lower()
        families: list[str] = []
        if role in {"assistant", "final"} or kind in {"assistant", "final"}:
            families.append("assistant")
        if role == "tool" or kind in {"tool", "error"}:
            families.append("tool")
        if kind == "reasoning":
            families.append("reasoning")
        candidate_key = ""
        for key, item in self.streaming_transcript.items():
            if str(item.get("family") or "") in families:
                candidate_key = key
        if candidate_key:
            item = self.streaming_transcript.pop(candidate_key)
            entry = self.manager.engine.parsed_transcript_entry(
                parsed,
                entry_id=str(item.get("id") or ""),
                streaming=False,
                created_at=str(item.get("created_at") or ""),
            )
            entry["streaming"] = False
            return self._upsert_transcript_entry_locked(entry)
        entry = self.manager.engine.parsed_transcript_entry(parsed)
        return self._upsert_transcript_entry_locked(entry)

    def _finalize_active_streaming_transcripts_locked(self) -> list[dict[str, Any]]:
        if not self.streaming_transcript:
            self.streaming_transcript = {}
            return []
        ids = {str(item.get("id") or "") for item in self.streaming_transcript.values() if isinstance(item, dict)}
        finalized: list[dict[str, Any]] = []
        for index, entry in enumerate(self.transcript):
            if str(entry.get("id") or "") in ids and entry.get("streaming"):
                next_entry = dict(entry)
                next_entry.pop("streaming", None)
                self.transcript[index] = next_entry
                finalized.append(next_entry)
        self.streaming_transcript = {}
        return finalized

    # ---- run -------------------------------------------------------------
    def start_prepared_run(self, prompt: str, display_message: str, settings: dict[str, Any], resume: bool) -> None:
        """Launch a prepared CLI prompt while showing a compact user message."""
        engine = self.manager.engine
        if self.manager.is_read_only_discussion(self):
            settings = engine.aux_discussion_settings(settings)
        self.ensure_dirs()
        backend = engine.normalize_agent_backend(settings.get("backend"))
        visible = str(display_message or "").strip()
        with self.lock:
            previous_backend = engine.normalize_agent_backend(self.backend)
            if backend != previous_backend:
                # Provider thread ids are backend-specific. Reusing a Codex id
                # with Claude (or vice versa) turns an ordinary backend switch
                # into a guaranteed resume failure.
                self.cli_session_id = ""
                resume = False
            self.settings = settings
            self.backend = backend
            if self.kind == "chat" and self.title_source == "auto" and self.title == self._default_title():
                self.title = auto_session_title(visible)
            if visible:
                self.chat_history.append({"role": "user", "text": visible, "at": _now_iso()})
                self.chat_history = self.chat_history[-AUX_CHAT_HISTORY_MAX:]
            self.status = "running"
            self.started_at = _now_iso()
            self.streaming_transcript = {}
            self.updated_at = self.started_at
            self._cancel_requested = False
            self._stop_requested = False
        self.persist()
        self.emit("session", {"status": "running"})
        try:
            self.manager.begin_v2_boundary(self, "chat")
        except Exception:
            with self.lock:
                self.status = "error"
                self.updated_at = _now_iso()
            self.persist()
            self.emit("error", {"status": "error", "message": "The v2 auxiliary boundary could not start."})
            raise
        thread = threading.Thread(
            target=self.manager.run_in_project,
            args=(self, self._run, prompt, resume),
            daemon=True,
        )
        with self.lock:
            self._thread = thread
        thread.start()

    def start_message(self, message: str, settings: dict[str, Any], resume: bool) -> None:
        """Launch the CLI for this session in a background thread."""
        prompt = self.manager.build_prompt(self, message)
        self.start_prepared_run(prompt, message, settings, resume)

    def _run(self, prompt: str, resume: bool) -> None:
        engine = self.manager.engine
        with self.lock:
            cancelled = self._cancel_requested
            if cancelled:
                self._cancel_requested = False
                self.status = "interrupted"
                self.updated_at = _now_iso()
        if cancelled:
            # stop() was called before this thread reached Popen -- honor it
            # instead of silently starting the run anyway.
            self.manager.finish_v2_boundary(self)
            self.persist()
            self.emit("session", {"status": "interrupted"})
            return
        wrapper_path: Path | None = None
        proc: subprocess.Popen[str] | None = None
        normalizer: Any = None
        try:
            env = engine.agent_process_env(self.backend, self.settings)
            command = list(self.manager.agent_command(self, resume))
            if not command:
                raise ValueError("Agent command is empty.")
            command[0] = engine.resolve_agent_executable(self.backend, env)
            cwd = engine.repo_path(".")
            normalizer = engine.make_research_trace_normalizer(self.backend, "exec", self.settings)
            popen_command, use_shell, wrapper_path = engine.popen_command_for_agent(command, self.settings, env)
            proc = self.manager.spawn_registered_agent(
                self,
                popen_command,
                cwd=str(cwd),
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                shell=use_shell,
            )
            if proc is None:
                self.manager.finish_v2_boundary(self)
                with self.lock:
                    self._thread = None
                    self.returncode = 130
                    self.updated_at = _now_iso()
                self.persist()
                self.emit("session", {"status": "interrupted"})
                return
            if wrapper_path:
                setattr(proc, "_coauto_pre_exec_wrapper", wrapper_path)
            assert proc.stdin is not None
            proc.stdin.write(prompt)
            proc.stdin.write("\n")
            proc.stdin.close()
        except Exception as exc:
            self.append_log(f"Failed to start agent: {exc}")
            boundary = self.manager.finish_v2_boundary(self)
            if wrapper_path and (
                not boundary or boundary.get("process_tree_drained", True)
            ):
                try:
                    wrapper_path.unlink(missing_ok=True)
                except OSError:
                    pass
            with self.lock:
                self.status = "error"
                if not boundary or boundary.get("process_tree_drained", True):
                    self._process = None
                self._thread = None
                self.returncode = 127
                self._finalize_active_streaming_transcripts_locked()
                self.chat_history.append(
                    {
                        "role": "control",
                        "text": f"Agent run failed before returning a response. Exit code: start failed. {exc}",
                        "at": _now_iso(),
                    }
                )
                self.chat_history = self.chat_history[-AUX_CHAT_HISTORY_MAX:]
                self.updated_at = _now_iso()
            self.persist()
            self.emit("error", {"status": "error", "message": str(exc)})
            return
        try:
            assistant_parts: list[str] = []
            final_text = ""
            assert proc.stdout is not None
            for line in proc.stdout:
                self.append_log(line, normalizer)
                text = engine.transcript_from_agent_line(line, self.backend)
                if isinstance(text, dict) and text.get("content"):
                    role = str(text.get("role") or "")
                    if role == "assistant":
                        assistant_parts.append(str(text.get("content")))
                    elif role == "final":
                        final_text = str(text.get("content"))
            returncode = proc.wait()
        except Exception as exc:  # pragma: no cover - defensive
            self.append_log(f"Session error: {exc}")
            returncode = proc.poll()
            assistant_parts = []
        if normalizer is not None:
            try:
                self._append_trace_updates(normalizer.finish(returncode))
            except Exception:
                pass
        boundary = self.manager.finish_v2_boundary(self)
        wrapper_cleanup = getattr(proc, "_coauto_pre_exec_wrapper", None)
        if wrapper_cleanup and (
            not boundary or boundary.get("process_tree_drained", True)
        ):
            try:
                Path(wrapper_cleanup).unlink(missing_ok=True)
            except OSError:
                pass
        with self.lock:
            self._finalize_active_streaming_transcripts_locked()
            if not boundary or boundary.get("process_tree_drained", True):
                self._process = None
            self._thread = None
            self.returncode = returncode
            boundary_clean = not boundary or bool(boundary.get("publishable"))
            self.status = (
                "completed" if returncode == 0 and boundary_clean
                else "interrupted" if self._stop_requested and boundary_clean
                else "error"
            )
            # Codex exec emits progress and the final answer as separate
            # agent_message items. Keep progress in the activity transcript;
            # only the last answer belongs in the completed chat / handoff.
            reply = final_text or (
                assistant_parts[-1] if self.backend == "codex" and returncode == 0 and assistant_parts
                else "\n".join(assistant_parts)
            )
            if reply:
                self.chat_history.append(
                    {"role": "assistant", "text": reply, "at": _now_iso()}
                )
                self.chat_history = self.chat_history[-AUX_CHAT_HISTORY_MAX:]
            elif returncode != 0 and self.status == "error":
                code = returncode if returncode is not None else "unknown"
                self.chat_history.append(
                    {
                        "role": "control",
                        "text": f"Agent run failed before returning a response. Exit code: {code}.\n\nThe provider returned no assistant message for this run.",
                        "at": _now_iso(),
                    }
                )
                self.chat_history = self.chat_history[-AUX_CHAT_HISTORY_MAX:]
            if boundary and not boundary_clean:
                self.chat_history.append(
                    {
                        "role": "control",
                        "text": "The v2 write boundary rejected this auxiliary turn and restored unauthorized project changes.",
                        "at": _now_iso(),
                    }
                )
                self.chat_history = self.chat_history[-AUX_CHAT_HISTORY_MAX:]
            self.updated_at = _now_iso()
        self.persist()
        payload = {"status": self.status, "returncode": returncode}
        if self.status == "error" and returncode != 0 and not reply:
            payload["message"] = "Agent run failed before returning a response."
        self.emit("session" if self.status == "interrupted" else self.status, payload)

    def run_plan(self, prompt: str, artifact: dict[str, Any]) -> None:
        engine = self.manager.engine
        plan_id = str(artifact.get("id") or self.plan_id or "").strip()
        settings = self.settings if isinstance(self.settings, dict) else {}
        backend = engine.normalize_agent_backend(settings.get("backend") or self.backend)
        returncode: int | None = None
        normalizer: Any = None

        def public_plan(value: dict[str, Any] | None = None) -> dict[str, Any]:
            try:
                return engine.public_plan_artifact(value or engine.read_plan_artifact(plan_id))
            except Exception:
                return {}

        def update_artifact(**updates: Any) -> dict[str, Any]:
            next_artifact = engine.update_plan_artifact(plan_id, **updates)
            self.emit("plan", {"plan": public_plan(next_artifact)})
            return next_artifact

        def fail_plan(message: str) -> dict[str, Any]:
            return update_artifact(status="failed", error=str(message or "Plan run failed."))

        with self.lock:
            cancelled = self._cancel_requested
            if cancelled:
                self._cancel_requested = False
                self.status = "interrupted"
                self.updated_at = _now_iso()
        if cancelled:
            self.manager.finish_v2_boundary(self)
            self.persist()
            self.emit("session", {"status": "interrupted"})
            return

        if not plan_id:
            self.append_log("Plan run failed: missing plan id.")
            with self.lock:
                self.status = "error"
                self.updated_at = _now_iso()
            self.manager.finish_v2_boundary(self)
            self.persist()
            self.emit("error", {"status": "error"})
            return

        self.backend = backend
        if backend == "claude":
            returncode = self._run_claude_plan(prompt, settings, normalizer, update_artifact, fail_plan)
        else:
            returncode = self._run_codex_plan(prompt, settings, normalizer, update_artifact, fail_plan)

        boundary = self.manager.finish_v2_boundary(self)

        with self.lock:
            proc = self._process
        wrapper_cleanup = getattr(proc, "_coauto_pre_exec_wrapper", None) if proc is not None else None
        if wrapper_cleanup and (
            not boundary or boundary.get("process_tree_drained", True)
        ):
            try:
                Path(wrapper_cleanup).unlink(missing_ok=True)
            except OSError:
                pass
        if proc is not None and (
            not boundary or boundary.get("process_tree_drained", True)
        ):
            with self.lock:
                self._process = None

        artifact_after = {}
        try:
            artifact_after = engine.read_plan_artifact(plan_id)
        except Exception:
            artifact_after = {}
        boundary_clean = not boundary or bool(boundary.get("publishable"))
        ready = str(artifact_after.get("status") or "") == "ready" and boundary_clean
        with self.lock:
            self._finalize_active_streaming_transcripts_locked()
            self._thread = None
            self.returncode = 0 if ready else (returncode if returncode is not None else 1)
            self.status = (
                "completed" if ready
                else "interrupted" if self._stop_requested and boundary_clean
                else "error"
            )
            self.plan_thread_id = ""
            self.plan_turn_id = ""
            self.updated_at = _now_iso()
        self.persist()
        self.emit("session" if self.status == "interrupted" else self.status, {"status": self.status, "returncode": self.returncode, "plan": public_plan(artifact_after)})

    def _run_codex_plan(
        self,
        prompt: str,
        settings: dict[str, Any],
        _normalizer: Any,
        update_artifact: Callable[..., dict[str, Any]],
        fail_plan: Callable[[str], dict[str, Any]],
    ) -> int | None:
        engine = self.manager.engine
        proc: subprocess.Popen[str] | None = None
        returncode: int | None = None
        thread_id = ""
        turn_id = ""
        plan_text_parts: dict[str, list[str]] = {}
        final_plan_text = ""
        startup_errors: list[str] = []
        sent_thread_start = False
        sent_turn_start = False
        next_request_id = 1
        normalizer: Any = None
        wrapper_path: Path | None = None

        def request(method: str, params: dict[str, Any] | None = None) -> int:
            nonlocal next_request_id
            request_id = next_request_id
            next_request_id += 1
            if proc is None:
                raise RuntimeError("Codex app-server process has not started.")
            engine.json_rpc_write(proc, {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}})
            return request_id

        try:
            settings = self.manager.preflight_settings(
                self, settings,
                implementation=False,
                force_refresh=False,
            )
            env = engine.agent_process_env("codex", settings)
            command = engine.codex_app_server_command(settings)
            if self.manager.is_read_only_discussion(self):
                command[1:1] = engine.aux_discussion_codex_args(settings)
            if not command:
                raise ValueError("Codex app-server command is empty.")
            command[0] = engine.resolve_agent_executable("codex", env)
            normalizer = engine.make_research_trace_normalizer("codex", "app-server", settings)
            with self.lock:
                self.settings = settings
                self.backend = "codex"
            popen_command, use_shell, wrapper_path = engine.popen_command_for_agent(command, settings, env)
            proc = self.manager.spawn_registered_agent(
                self,
                popen_command,
                cwd=str(engine.repo_path(".")),
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                shell=use_shell,
            )
            if proc is None:
                fail_plan("Plan launch was cancelled before process registration.")
                return 130
            if wrapper_path:
                setattr(proc, "_coauto_pre_exec_wrapper", wrapper_path)
            self.append_log(f"Started: {' '.join(command)}")
            update_artifact(status="running")
            assert proc.stdout is not None
            request(
                "initialize",
                {
                    "clientInfo": {"name": "co-auto-research-ui", "version": "1.0", "title": "CoAutoResearch UI"},
                    "capabilities": {"experimentalApi": True},
                },
            )
            for line in proc.stdout:
                self.append_log(line, normalizer)
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    event = json.loads(stripped)
                except json.JSONDecodeError:
                    if stripped.startswith("Error:") or startup_errors:
                        startup_errors.append(stripped)
                    continue
                if not isinstance(event, dict):
                    continue
                rpc_request_id = event.get("id") if "id" in event else None
                request_method = str(event.get("method") or "").strip()
                if rpc_request_id is not None and request_method:
                    result = engine.codex_server_request_result(request_method)
                    try:
                        if result is None:
                            engine.json_rpc_write(
                                proc,
                                {
                                    "jsonrpc": "2.0",
                                    "id": rpc_request_id,
                                    "error": {
                                        "code": -32601,
                                        "message": f"CoAutoResearch does not handle {request_method} requests.",
                                    },
                                },
                            )
                        else:
                            engine.json_rpc_write(proc, {"jsonrpc": "2.0", "id": rpc_request_id, "result": result})
                            resolved = normalizer.resolve_approval(str(rpc_request_id), "declined", "auto_policy") if normalizer else None
                            if resolved:
                                self._append_trace_updates([resolved])
                    except Exception:
                        pass
                    continue
                if event.get("error"):
                    error_text = engine.event_payload_text(event.get("error")) or "Codex app-server returned an error."
                    raise RuntimeError(error_text)

                method, params = engine.codex_plan_event_parts(event)
                if method in {"thread/started", "thread.started"}:
                    thread_id = engine.extract_nested_id(params, ("threadId", "thread_id", "id")) or thread_id
                if method in {"turn/started", "turn.started"}:
                    turn_id = engine.extract_nested_id(params, ("turnId", "turn_id", "id")) or turn_id
                    if turn_id:
                        with self.lock:
                            self.plan_turn_id = turn_id
                        update_artifact(thread_id=thread_id, session_id=thread_id, status="running")

                if "id" in event and str(event.get("id") or "") == "1" and not sent_thread_start:
                    engine.json_rpc_write(proc, {"jsonrpc": "2.0", "method": "initialized", "params": {}})
                    request(
                        "thread/start",
                        {
                            "cwd": str(engine.repo_path(".")),
                            "model": engine.normalize_codex_model(settings.get("model")),
                            "sandbox": "read-only",
                            "approvalPolicy": "never",
                        },
                    )
                    sent_thread_start = True
                    continue

                if sent_thread_start and not sent_turn_start:
                    candidate_thread_id = engine.extract_nested_id(event, ("threadId", "thread_id", "id"))
                    if candidate_thread_id:
                        thread_id = thread_id or candidate_thread_id
                        with self.lock:
                            self.plan_thread_id = thread_id
                        model = engine.normalize_codex_model(settings.get("model"))
                        reasoning = engine.normalize_reasoning_effort(settings.get("reasoningEffort"), "codex", model)
                        request(
                            "turn/start",
                            {
                                "threadId": thread_id,
                                "input": [{"type": "text", "text": prompt, "text_elements": []}],
                                "cwd": str(engine.repo_path(".")),
                                "model": model,
                                "approvalPolicy": "never",
                                "sandboxPolicy": {"type": "readOnly", "networkAccess": bool(settings.get("webSearch"))},
                                "collaborationMode": {
                                    "mode": "plan",
                                    "settings": {
                                        "model": model,
                                        "reasoning_effort": reasoning or None,
                                        "developer_instructions": None,
                                    },
                                },
                            },
                        )
                        sent_turn_start = True
                        update_artifact(thread_id=thread_id, session_id=thread_id, status="running")
                        continue

                if method in {"item/plan/delta", "item.plan.delta"}:
                    item_id = str(params.get("itemId") or params.get("item_id") or "plan")
                    delta = str(params.get("delta") or "")
                    if delta:
                        plan_text_parts.setdefault(item_id, []).append(delta)
                        update_artifact(status="running", plan_text="".join(plan_text_parts[item_id]).strip(), thread_id=thread_id, session_id=thread_id)
                    continue

                if method in {"turn/plan/updated", "turn.plan.updated"}:
                    update_artifact(
                        status="running",
                        steps=engine.plan_steps_from_payload(params.get("plan")),
                        explanation=str(params.get("explanation") or ""),
                        thread_id=thread_id,
                        session_id=thread_id,
                    )
                    continue

                if method in {"item/completed", "item.completed"}:
                    item = params.get("item") if isinstance(params.get("item"), dict) else {}
                    if str(item.get("type") or "").lower() == "plan":
                        final_plan_text = str(item.get("text") or "").strip()
                        if final_plan_text:
                            update_artifact(status="ready", plan_text=final_plan_text, thread_id=thread_id, session_id=thread_id)
                    continue

                if method in {"turn/completed", "turn.completed"}:
                    break
            try:
                if proc.stdin:
                    proc.stdin.close()
            except OSError:
                pass
            try:
                returncode = proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                engine.signal_research_process(proc)
                try:
                    returncode = proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    engine.signal_research_process(proc, force=True)
                    returncode = proc.wait(timeout=1)
        except Exception as exc:
            self.append_log(f"Codex plan mode error: {exc}")
            fail_plan(str(exc))
            returncode = proc.poll() if proc else returncode
        finally:
            if proc is None and wrapper_path:
                try:
                    wrapper_path.unlink(missing_ok=True)
                except OSError:
                    pass
            if proc is not None:
                try:
                    if proc.stdin:
                        proc.stdin.close()
                except OSError:
                    pass
            if normalizer is not None:
                try:
                    self._append_trace_updates(normalizer.finish(returncode))
                except Exception:
                    pass

        try:
            artifact_after = engine.read_plan_artifact(self.plan_id)
        except Exception:
            artifact_after = {}
        if str(artifact_after.get("status") or "") != "ready":
            text = str(artifact_after.get("plan_text") or final_plan_text or "").strip()
            if text:
                update_artifact(status="ready", plan_text=text, thread_id=thread_id, session_id=thread_id)
                returncode = 0
            else:
                fail_plan(str(artifact_after.get("error") or "\n".join(startup_errors)[-1800:] or "Codex app-server did not return a plan item. Check the activity log and your Codex CLI version, then retry."))
                returncode = returncode if returncode not in {0, None} else 1
        return returncode

    def _run_claude_plan(
        self,
        prompt: str,
        settings: dict[str, Any],
        _normalizer: Any,
        update_artifact: Callable[..., dict[str, Any]],
        fail_plan: Callable[[str], dict[str, Any]],
    ) -> int | None:
        engine = self.manager.engine
        proc: subprocess.Popen[str] | None = None
        returncode: int | None = None
        normalizer: Any = None
        wrapper_path: Path | None = None
        read_only = self.manager.is_read_only_discussion(self)
        try:
            settings = self.manager.preflight_settings(
                self, settings,
                implementation=False,
                force_refresh=False,
            )
            plan_settings = engine.normalize_claude_settings(
                {**settings, "permissionPreset": "plan", "permissionMode": "plan"},
                settings,
            )
            plan_settings["backend"] = "claude"
            if read_only:
                plan_settings = engine.aux_discussion_settings(plan_settings)
            env = engine.agent_process_env("claude", plan_settings)
            executable = engine.resolve_agent_executable("claude", env)
            normalizer = engine.make_research_trace_normalizer("claude", "exec", plan_settings)
            with self.lock:
                self.settings = plan_settings
                self.backend = "claude"
            command = [executable, *engine.settings_to_claude_args(plan_settings, resume=False)]
            if read_only:
                command.extend(engine.aux_discussion_claude_args(self))
                prompt += "\nReturn the complete proposed plan as your final response. Do not create a plan file or request implementation."
            else:
                settings_path = engine.write_claude_plan_hook(self.plan_id)
                command.extend(["--settings", str(settings_path)])
            popen_command, use_shell, wrapper_path = engine.popen_command_for_agent(command, plan_settings, env)
            proc = self.manager.spawn_registered_agent(
                self,
                popen_command,
                cwd=str(engine.repo_path(".")),
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                shell=use_shell,
            )
            if proc is None:
                fail_plan("Plan launch was cancelled before process registration.")
                return 130
            if wrapper_path:
                setattr(proc, "_coauto_pre_exec_wrapper", wrapper_path)
            self.append_log(f"Started: {' '.join(command)}")
            update_artifact(status="running")
            assert proc.stdin is not None
            proc.stdin.write(prompt)
            proc.stdin.write("\n")
            proc.stdin.close()
            assert proc.stdout is not None
            for line in proc.stdout:
                self.append_log(line, normalizer)
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    event = json.loads(stripped)
                except json.JSONDecodeError:
                    continue
                plan = engine.extract_claude_exit_plan(event)
                if read_only and event.get("type") == "result" and not event.get("is_error"):
                    plan = str(event.get("result") or "").strip()
                if plan:
                    update_artifact(status="ready", plan_text=plan)
            returncode = proc.wait()
        except Exception as exc:
            self.append_log(f"Claude plan mode error: {exc}")
            fail_plan(str(exc))
            returncode = proc.poll() if proc else returncode
        finally:
            if proc is None and wrapper_path:
                try:
                    wrapper_path.unlink(missing_ok=True)
                except OSError:
                    pass
            if normalizer is not None:
                try:
                    self._append_trace_updates(normalizer.finish(returncode))
                except Exception:
                    pass

        try:
            artifact_after = engine.read_plan_artifact(self.plan_id)
        except Exception:
            artifact_after = {}
        text = str(artifact_after.get("plan_text") or "").strip()
        if text:
            if str(artifact_after.get("status") or "") != "ready":
                update_artifact(status="ready", plan_text=text)
            return 0 if returncode in {0, None} else returncode
        fail_plan(str(artifact_after.get("error") or "Claude did not return a plan. Check the activity log and retry."))
        return returncode if returncode not in {0, None} else 1

    def stop(self, force: bool = False) -> None:
        # Serialize the pending->Popen window with spawn_registered_agent().
        # Whichever side enters first either records cancellation before the
        # spawn check, or leaves a registered process for this stop to signal.
        with self.manager.context.run_launch_lock:
            with self.lock:
                proc = self._process
                plan_thread_id = self.plan_thread_id
                plan_turn_id = self.plan_turn_id
                backend = self.backend
                if self.status == "running":
                    self._stop_requested = True
                if self.status == "running" and proc is None:
                    # start_message() has marked this session running but the
                    # background thread hasn't reached Popen yet (still copying
                    # the protected-file snapshot, etc.) -- there is no OS
                    # process to signal yet. Ask _run() to bail out before it
                    # spawns one instead of silently doing nothing.
                    self._cancel_requested = True
        if proc and not bool(getattr(proc, "_coauto_tree_drained", False)):
            interrupted = False
            if not force and backend == "codex" and plan_thread_id and plan_turn_id:
                try:
                    self.manager.engine.json_rpc_write(
                        proc,
                        {
                            "jsonrpc": "2.0",
                            "id": int(time.time() * 1000),
                            "method": "turn/interrupt",
                            "params": {"threadId": plan_thread_id, "turnId": plan_turn_id},
                        },
                    )
                    interrupted = True
                except Exception:
                    interrupted = False
            if interrupted:
                return
            try:
                if force:
                    self.manager.engine.drain_agent_process_tree(
                        proc, grace_seconds=0.0
                    )
                else:
                    self.manager.engine.signal_research_process(proc)
            except Exception:
                pass

    def refresh(self) -> None:
        """Reset provider CLI context while preserving visible chat history."""
        self.stop(force=True)
        with self.lock:
            self.logs = []
            self.transcript = []
            self.cli_session_id = ""
            self.status = "idle"
            self.started_at = ""
            self.returncode = None
            self.last_event_summary = ""
            self.streaming_transcript = {}
            self.updated_at = _now_iso()
        self.persist()
        self.emit("session", {"status": "idle", "refreshed": True})

    def prepare_message_edit(self, index: int) -> dict[str, Any]:
        if self.kind != "chat":
            raise ValueError("Only chat messages can be edited.")
        with self.lock:
            if self.is_active():
                raise ValueError("This session already has an active run. Wait for it to finish or refresh it.")
            history = list(self.chat_history)
            if index < 0 or index >= len(history):
                raise ValueError("Unknown message to edit.")
            if str(history[index].get("role") or "").lower() != "user":
                raise ValueError("Only user messages can be edited.")
            edited_text = str(history[index].get("text") or "").strip()
            previous_user_duplicate = (
                index > 0
                and str(history[index - 1].get("role") or "").lower() == "user"
                and str(history[index - 1].get("text") or "").strip() == edited_text
            )
            archived_tail = [item for item in history[index + 1 :] if isinstance(item, dict)]
            archived_count = len(archived_tail)
            archived_plan_ids = [
                str(item.get("plan_id") or "").strip()
                for item in archived_tail
                if str(item.get("kind") or "") == "plan" and str(item.get("plan_id") or "").strip()
            ]
            first_archived_plan_id = ""
            if archived_tail and str(archived_tail[0].get("kind") or "") == "plan":
                first_archived_plan_id = str(archived_tail[0].get("plan_id") or "").strip()
            self.chat_history = history[:index]
            self.cli_session_id = ""
            self.logs = []
            self.transcript = []
            self.streaming_transcript = {}
            self.returncode = None
            self.status = "idle"
            self.started_at = ""
            if self.plan_id and self.plan_id in archived_plan_ids:
                self.plan_id = ""
                self.plan_thread_id = ""
                self.plan_turn_id = ""
            if index == 0 and self.title_source == "auto":
                self.title = self._default_title()
            self.updated_at = _now_iso()
        self.persist()
        return {
            "archived_count": archived_count,
            "archived_plan_id": first_archived_plan_id,
            "archived_plan_ids": archived_plan_ids,
            "edited_text": edited_text,
            "previous_user_duplicate": previous_user_duplicate,
        }

    def drop_trailing_duplicate_user(self, text: str) -> None:
        cleaned = str(text or "").strip()
        if not cleaned:
            return
        with self.lock:
            if not self.chat_history:
                return
            last = self.chat_history[-1]
            if str(last.get("role") or "").lower() != "user":
                return
            if str(last.get("text") or "").strip() != cleaned:
                return
            self.chat_history = self.chat_history[:-1]
            self.updated_at = _now_iso()
        self.persist()

    def rename(self, title: str) -> None:
        cleaned = " ".join(str(title or "").strip().split())
        if not cleaned:
            raise ValueError("Session title is required.")
        with self.lock:
            self.title = cleaned[:80]
            self.title_source = "user"
            self.updated_at = _now_iso()
        self.persist()
        self.emit("session", {"renamed": True, "title": self.title})


class AuxSessionManager:
    """Owns all auxiliary sessions for one project context."""

    def __init__(self, context: Any, engine: Any) -> None:
        self.context = context
        self.engine = engine
        self.sessions_dir = context.runtime_dir / "sessions"
        self.registry_path = self.sessions_dir / "registry.json"
        self.sessions: dict[str, AuxSession] = {}
        self.order: list[str] = []
        self.lock = threading.RLock()
        self._loaded = False
        self._active_v2_session_id = ""
        self._v2_recovery_errors: list[str] = []
        self._v2_recovered_violations = 0
        self._protocol_kind = ""
        self._recover_external_v2_guards()

    # ---- v2 trust boundary ----------------------------------------------
    def protocol_classification(self, *, refresh: bool = False) -> str:
        if self._protocol_kind and not refresh:
            if self._protocol_kind != "legacy":
                return self._protocol_kind
            marker = self.context.root / ".co-auto-research-template" / "v2-migration.json"
            state = self.context.root / "research_trajectory" / "STATE.json"
            if not marker.exists() and not state.exists():
                return self._protocol_kind
        try:
            result = self.engine.classify_project(self.context.root)
        except Exception:
            marker = self.context.root / ".co-auto-research-template" / "v2-migration.json"
            state = self.context.root / "research_trajectory" / "STATE.json"
            self._protocol_kind = "corrupt" if marker.exists() or state.exists() else "legacy"
        else:
            self._protocol_kind = str(result.get("classification") or "corrupt") if isinstance(result, dict) else "corrupt"
        return self._protocol_kind

    def uses_strict_boundary(self) -> bool:
        return self.protocol_classification() != "legacy"

    def is_read_only_discussion(self, session: AuxSession) -> bool:
        return session.kind == "chat" and self.protocol_classification() == "v2"

    def workspace_path(self, session: AuxSession) -> Path:
        if self.is_read_only_discussion(session):
            return session.dir / "workspace"
        return self.context.root / "workspace" / "ui_sessions" / session.id

    def preflight_settings(self, session: AuxSession, raw: Any, **options: Any) -> dict[str, Any]:
        read_only = self.is_read_only_discussion(session)
        if read_only:
            # Readiness/model probes also support shell setup. Strip it before
            # probing, not merely before launching the discussion worker.
            raw = self.engine.aux_discussion_settings(self.engine.normalize_research_settings(raw))
        settings = self.engine.preflight_agent_settings(raw, **options)
        return self.engine.aux_discussion_settings(settings) if read_only else settings

    def _configured_secret_values(self) -> list[str]:
        keys = getattr(self.engine, "SECRET_ENV_KEYS", ())
        values = [os.environ.get(str(key), "") for key in keys if str(key)]
        values.append(str(getattr(self.engine, "REMOTE_AUTH_TOKEN", "") or ""))
        return [value for value in values if value]

    def public_value(self, value: Any) -> Any:
        if not self.uses_strict_boundary():
            return value
        clean = redact_mapping(value, self._configured_secret_values())
        raw_replacements = {
            str(self.sessions_dir): "[session-runtime]",
            str(self.sessions_dir.resolve()): "[session-runtime]",
            str(self.context.root): "[project]",
            str(self.context.root.resolve()): "[project]",
            str(Path.home()): "~",
            str(Path.home().resolve()): "~",
        }
        replacements = sorted(raw_replacements.items(), key=lambda item: len(item[0]), reverse=True)

        def scrub(item: Any) -> Any:
            if isinstance(item, dict):
                return {str(key): scrub(child) for key, child in item.items()}
            if isinstance(item, list):
                return [scrub(child) for child in item]
            if isinstance(item, tuple):
                return [scrub(child) for child in item]
            if not isinstance(item, str):
                return item
            text = item
            for source, replacement in replacements:
                if source:
                    text = text.replace(source, replacement)
            return text

        return scrub(clean)

    def redact_log_text(self, value: Any) -> str:
        if not self.uses_strict_boundary():
            return str(value or "")
        return str(redact_mapping(str(value or ""), self._configured_secret_values()))

    def _guard_project_root(self, *, create: bool) -> Path:
        configured = str(os.environ.get("COAUTO_GUARD_ROOT", "") or "").strip()
        base = Path(os.path.expanduser(configured)).resolve() if configured else (Path.home() / ".co-auto-research" / "guards").resolve()
        project = self.context.root.resolve()
        if base == project or _is_within(project, base):
            raise RuntimeError("COAUTO_GUARD_ROOT must be outside the project directory.")
        key = hashlib.sha256(str(project).encode("utf-8")).hexdigest()[:24]
        target = base / "aux-sessions" / key
        return _private_dir(target) if create else target

    def _recover_external_v2_guards(self) -> None:
        try:
            root = self._guard_project_root(create=False)
        except Exception as exc:
            self._v2_recovery_errors.append(str(exc))
            return
        if not root.exists():
            return
        if root.is_symlink() or not root.is_dir():
            self._v2_recovery_errors.append("Auxiliary guard root is not a trustworthy directory.")
            return
        for directory in sorted(root.iterdir()):
            if directory.is_symlink() or not directory.is_dir():
                self._v2_recovery_errors.append(f"Untrustworthy auxiliary guard entry: {directory.name}")
                continue
            if (directory / "COMPLETED.json").is_file():
                continue
            baseline_path = directory / "baseline.json"
            if not baseline_path.is_file():
                # The agent is launched only after baseline.json is durable.
                shutil.rmtree(directory, ignore_errors=True)
                continue
            active: dict[str, Any] = {}
            try:
                raw = json.loads((directory / "ACTIVE.json").read_text(encoding="utf-8"))
                active = raw if isinstance(raw, dict) else {}
            except (OSError, json.JSONDecodeError):
                pass
            process_tree = active.get("process_tree")
            if isinstance(process_tree, dict):
                drain_recorded = getattr(
                    self.engine, "drain_recorded_agent_process_tree", None
                )
                if not callable(drain_recorded):
                    self._v2_recovery_errors.append(
                        "Auxiliary process-tree recovery is unavailable."
                    )
                    continue
                try:
                    drain_recorded(process_tree)
                except Exception as exc:
                    self._v2_recovery_errors.append(
                        f"Auxiliary agent process group/Job is still active: {exc}"
                    )
                    continue
            else:
                self._v2_recovery_errors.append(
                    "Active auxiliary guard has no valid agent process-tree identity."
                )
                continue
            try:
                baseline = load_agent_baseline(directory)
                if baseline.project_root != self.context.root.resolve():
                    raise RuntimeError("Auxiliary guard baseline belongs to another project.")
                result = audit_and_restore_agent_writes(baseline).to_dict()
                errors = [str(item) for item in result.get("restoration_errors", ())]
                if errors:
                    raise RuntimeError("; ".join(errors))
                self._v2_recovered_violations += len(result.get("violations", ()))
                _write_private_json(
                    directory / "COMPLETED.json",
                    {
                        "schema_version": 1,
                        "state": "recovered",
                        "completed_at": _now_iso(),
                        "protocol_violation": bool(result.get("violations")),
                    },
                )
            except Exception as exc:
                self._v2_recovery_errors.append(f"{directory.name}: {exc}")

    def recovery_status(self) -> dict[str, Any]:
        return {
            "ready": not self._v2_recovery_errors,
            "errors": list(self._v2_recovery_errors),
            "recovered_violations": self._v2_recovered_violations,
        }

    def has_active_v2_run(self) -> bool:
        with self.lock:
            return bool(self._active_v2_session_id)

    def active_agent_session_ids(self, *, exclude_session_id: str = "", writers_only: bool = False) -> list[str]:
        with self.lock:
            sessions = list(self.sessions.values())
        return [
            session.id
            for session in sessions
            if session.id != exclude_session_id and session.is_active()
            and (not writers_only or not self.is_read_only_discussion(session))
        ]

    def spawn_registered_agent(
        self, session: AuxSession, command: Any, **popen_kwargs: Any
    ) -> subprocess.Popen[str] | None:
        """Close cancel/shutdown/delete races through process registration."""

        engine = self.engine
        with self.context.run_launch_lock:
            with session.lock:
                if session._cancel_requested:
                    session._cancel_requested = False
                    session.status = "interrupted"
                    session.updated_at = _now_iso()
                    return None
            engine.ensure_server_accepting_runs()
            engine.ensure_current_project_writeable()
            self.ensure_aux_run_allowed(session)
            proc = engine.spawn_agent_process(command, **popen_kwargs)
            with session.lock:
                session._process = proc
            self.record_v2_process(session, proc)
            return proc

    def ensure_main_run_allowed(self) -> None:
        """Server integration hook: call under the project lock before a main run."""
        if self.uses_strict_boundary():
            with self.lock:
                if self._v2_recovery_errors:
                    raise ValueError("Auxiliary write-boundary recovery is required before starting research.")
                if self._active_v2_session_id:
                    raise ValueError(
                        "Wait for the active auxiliary session before starting a research run."
                    )
        if self.active_agent_session_ids(writers_only=True):
            raise ValueError("Wait for the active auxiliary session before starting a research run.")

    def ensure_aux_run_allowed(self, session: AuxSession) -> None:
        kind = self.protocol_classification(refresh=True)
        if kind not in {"legacy", "v2"}:
            raise ValueError(f"Auxiliary agent runs are disabled while the project protocol is {kind}.")
        if self.is_read_only_discussion(session):
            with self.lock:
                if self._v2_recovery_errors or self._active_v2_session_id:
                    raise ValueError("Wait for auxiliary write-boundary recovery before starting a discussion.")
            return
        with self.context.lock:
            if self.engine.project_main_agent_active(self.context):
                raise ValueError("Wait for the active research run before starting an auxiliary session.")
        if self.engine.active_figure_image_jobs(self.context):
            raise ValueError("Wait for figure image generation before starting an auxiliary session.")
        if self.active_agent_session_ids(exclude_session_id=session.id):
            raise ValueError("Only one auxiliary agent session may run at a time.")
        if kind == "v2":
            with self.lock:
                if self._v2_recovery_errors:
                    raise ValueError("Auxiliary write-boundary recovery is required before starting another session.")
                if self._active_v2_session_id and self._active_v2_session_id != session.id:
                    raise ValueError("Only one auxiliary v2 agent session may run at a time.")

    def _v2_registry(self, session: AuxSession, mode: str) -> PathRegistry:
        token = hashlib.sha256(session.id.encode("utf-8")).hexdigest()[:12]
        registry = PathRegistry.for_run(f"999999_aux-{token}", f"AUX-{token}")
        for path in (self.sessions_dir, session.dir, session.context_dir, session.workspace_dir):
            if path.is_symlink() or not path.is_dir():
                raise ValueError("Auxiliary session directories must be contained, regular directories.")
        workspace = session.workspace_dir.resolve().relative_to(self.context.root.resolve()).as_posix()
        return replace(
            registry,
            allowed_agent_write_patterns=(workspace, f"{workspace}/**"),
            service_mutable_patterns=(),
        )

    def begin_v2_boundary(self, session: AuxSession, mode: str) -> str:
        if self.protocol_classification() != "v2":
            return ""
        self.ensure_aux_run_allowed(session)
        if self.is_read_only_discussion(session):
            # A whole-project rollback would undo the parallel research run.
            # These invocations enforce read-only CLI capabilities instead.
            session.v2_boundary_status = "read_only"
            return ""
        with self.context.lock:
            with self.lock:
                if self._active_v2_session_id and self._active_v2_session_id != session.id:
                    raise ValueError("Only one auxiliary v2 agent session may run at a time.")
                self._active_v2_session_id = session.id
            guard = self._guard_project_root(create=True) / f"{session.id}-{mode}-{uuid.uuid4().hex}"
            try:
                registry = self._v2_registry(session, mode)
                baseline = capture_agent_baseline(
                    self.context.root,
                    guard,
                    trial_id=registry.trial_id,
                    attempt_id=registry.attempt_id,
                    registry=registry,
                )
                _write_private_json(
                    guard / "ACTIVE.json",
                    {
                        "schema_version": 1,
                        "state": "active",
                        "project_hash": hashlib.sha256(str(self.context.root.resolve()).encode("utf-8")).hexdigest(),
                        "session_id": session.id,
                        "mode": mode,
                        "service_pid": os.getpid(),
                        "agent_pid": None,
                        "started_at": _now_iso(),
                    },
                )
            except Exception:
                with self.lock:
                    if self._active_v2_session_id == session.id:
                        self._active_v2_session_id = ""
                raise
        with session.lock:
            session._v2_guard_dir = baseline.run_dir
            session._v2_boundary_mode = mode
            session.v2_boundary_status = "active"
        return str(baseline.run_dir)

    def record_v2_process(self, session: AuxSession, process: Any) -> None:
        with session.lock:
            guard = session._v2_guard_dir
        if not guard:
            return
        active_path = guard / "ACTIVE.json"
        try:
            value = json.loads(active_path.read_text(encoding="utf-8"))
            active = value if isinstance(value, dict) else {}
        except (OSError, json.JSONDecodeError):
            active = {}
        pid = int(getattr(process, "pid", process))
        tree: dict[str, Any] | None = None
        if hasattr(process, "pid"):
            identify = getattr(self.engine, "agent_process_tree_identity", None)
            if not callable(identify):
                raise RuntimeError("Auxiliary process-tree identity is unavailable.")
            tree = identify(process)
        active.update(
            {
                "schema_version": 1,
                "state": "active",
                "agent_pid": pid,
                "process_tree": tree,
                "updated_at": _now_iso(),
            }
        )
        _write_private_json(active_path, active)

    def finish_v2_boundary(self, session: AuxSession) -> dict[str, Any]:
        with session.lock:
            guard = session._v2_guard_dir
            proc = session._process
        if proc is not None:
            try:
                self.engine.drain_agent_process_tree(proc)
            except Exception as exc:
                message = f"Auxiliary agent process group/Job did not drain: {exc}"
                with self.lock:
                    if message not in self._v2_recovery_errors:
                        self._v2_recovery_errors.append(message)
                with session.lock:
                    session.v2_boundary_status = "recovery_required"
                return {
                    "publishable": False,
                    "protocol_violation": True,
                    "violations": [],
                    "restoration_errors": [message],
                    "process_tree_drained": False,
                }
        if not guard:
            return {}
        try:
            result = audit_and_restore_agent_writes(load_agent_baseline(guard)).to_dict()
            errors = [str(item) for item in result.get("restoration_errors", ())]
            if errors:
                raise RuntimeError("; ".join(errors))
            status = "clean" if result.get("publishable") else "protocol_violation"
            _write_private_json(
                guard / "COMPLETED.json",
                {
                    "schema_version": 1,
                    "state": status,
                    "completed_at": _now_iso(),
                    "protocol_violation": bool(result.get("violations")),
                },
            )
        except Exception as exc:
            result = {
                "publishable": False,
                "protocol_violation": True,
                "violations": [],
                "restoration_errors": [str(exc)],
            }
            status = "recovery_required"
            with self.lock:
                self._v2_recovery_errors.append(str(exc))
        result["process_tree_drained"] = True
        with session.lock:
            session._v2_guard_dir = None
            session._v2_boundary_mode = ""
            session.v2_boundary_status = status
        with self.lock:
            if self._active_v2_session_id == session.id:
                self._active_v2_session_id = ""
        return result

    def run_in_project(self, session: AuxSession, callback: Callable[..., Any], *args: Any) -> None:
        try:
            self.engine.run_in_project(self.context, callback, *args)
        finally:
            # Covers a host callback that aborts before entering the session
            # runner (and keeps test doubles honest); normal runners clear it.
            self.finish_v2_boundary(session)

    # ---- persistence -----------------------------------------------------
    def load(self) -> None:
        with self.lock:
            if self._loaded:
                return
            self._loaded = True
            if not self.registry_path.exists():
                return
            try:
                data = json.loads(self.registry_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return
            order = data.get("order") if isinstance(data, dict) else None
            for sid in order if isinstance(order, list) else []:
                clean_id = str(sid)
                if not _AUX_SESSION_ID_RE.fullmatch(clean_id):
                    continue
                sdir = self.sessions_dir / clean_id
                if sdir.is_symlink() or not sdir.is_dir():
                    continue
                kind = "chat"
                meta_path = sdir / "meta.json"
                if meta_path.exists():
                    try:
                        meta = json.loads(meta_path.read_text(encoding="utf-8"))
                        kind = normalize_aux_session_kind(str(meta.get("kind") or "chat"))
                    except (OSError, json.JSONDecodeError):
                        pass
                session = AuxSession(self, kind)
                session.id = clean_id
                session.dir = sdir
                session.context_dir = sdir / "context"
                session.workspace_dir = self.workspace_path(session)
                session.context_path = session.context_dir / "CONTEXT.md"
                session.load_persisted()
                if session.kind != kind:
                    session.kind = kind
                session.persist()
                self.sessions[session.id] = session
                self.order.append(session.id)

    def _save_registry(self) -> None:
        _private_dir(self.sessions_dir)
        try:
            _write_private_json(self.registry_path, {"order": self.order, "updated_at": _now_iso()})
        except OSError:
            pass

    # ---- crud ------------------------------------------------------------
    def list_sessions(self) -> list[dict[str, Any]]:
        self.load()
        with self.lock:
            return [self.sessions[sid].public() for sid in self.order if sid in self.sessions]

    def get(self, session_id: str) -> AuxSession:
        self.load()
        with self.lock:
            session = self.sessions.get(session_id)
        if not session:
            raise ValueError(f"Unknown session: {session_id}")
        return session

    def create(self, kind: str, title: str = "", settings: Any = None) -> AuxSession:
        self.load()
        kind = normalize_aux_session_kind(kind)
        if kind not in AUX_SESSION_KINDS:
            raise ValueError(f"Unknown session kind: {kind}")
        if kind == "evolution":
            with self.lock:
                existing = next((self.sessions[sid] for sid in self.order if sid in self.sessions and self.sessions[sid].kind == "evolution"), None)
            if existing:
                return existing
        session = AuxSession(self, kind, title)
        session.ensure_dirs()
        if isinstance(settings, dict):
            session.settings = self.engine.normalize_research_settings(settings)
            session.backend = self.engine.normalize_agent_backend(session.settings.get("backend"))
        self.write_context(session)
        session.persist()
        with self.lock:
            self.sessions[session.id] = session
            self.order.append(session.id)
            self._save_registry()
        return session

    def delete(self, session_id: str) -> dict[str, Any]:
        session = self.get(session_id)
        if session.kind == "evolution":
            raise ValueError("The evolution session is the persistent autoresearch loop and cannot be deleted.")
        if session.is_active():
            raise ValueError(
                "Stop the active auxiliary session and wait for process-tree drain before deleting it."
            )
        session.stop(force=True)
        # Chat workspace + all session dirs are deleted outright (user choice).
        try:
            if session.dir.exists():
                shutil.rmtree(session.dir, ignore_errors=True)
            if session.workspace_dir.exists():
                shutil.rmtree(session.workspace_dir, ignore_errors=True)
        except OSError:
            pass
        with self.lock:
            self.sessions.pop(session_id, None)
            self.order = [sid for sid in self.order if sid != session_id]
            self._save_registry()
        return {"deleted": session_id}

    def refresh_session(self, session_id: str) -> AuxSession:
        session = self.get(session_id)
        if session.kind == "evolution":
            raise ValueError("The evolution session is the persistent autoresearch loop and cannot be reset.")
        if session.is_active():
            raise ValueError(
                "Stop the active auxiliary session and wait for process-tree drain before refreshing it."
            )
        session.refresh()
        # Rebuild context document from the latest project state.
        self.write_context(session)
        return session

    def chat(self, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        session = self.get(session_id)
        message = str(payload.get("message") or "").strip()
        uploads = payload.get("files") if isinstance(payload.get("files"), list) else []
        edit_index_raw = payload.get("editIndex", payload.get("edit_index"))
        edit_index: int | None = None
        if edit_index_raw not in (None, ""):
            try:
                edit_index = int(edit_index_raw)
            except (TypeError, ValueError):
                raise ValueError("Invalid message edit index.")
        if not message and not uploads:
            raise ValueError("Message is required.")
        if session.is_active():
            raise ValueError("This session already has an active run. Wait for it to finish or refresh it.")
        self.ensure_aux_run_allowed(session)
        if session.kind == "evolution" and self.engine.evolution_loop_status(self.context)["running"]:
            # The evolution session's subprocess and the legacy autoresearch
            # loop both have write access to research_trajectory/manuscript;
            # only one of them may run at a time or their writes could race.
            raise ValueError(
                "The evolution run is already active in the main research panel. "
                "Use that panel to continue it, or stop it there first."
            )
        settings = self.preflight_settings(
            session, payload.get("settings") or session.settings,
            implementation=not self.is_read_only_discussion(session),
            force_refresh=True,
        )
        if edit_index is not None:
            if uploads:
                raise ValueError("Edited chat messages cannot add new attachments yet.")
            edit_meta = session.prepare_message_edit(edit_index)
            if edit_meta.get("previous_user_duplicate") and str(edit_meta.get("edited_text") or "").strip() == message:
                session.drop_trailing_duplicate_user(message)
        saved_uploads = self._save_chat_uploads(session, uploads)
        if saved_uploads:
            if not message:
                message = "Please review the attached file(s)."
            lines = ["", "", "Attached files in this chat workspace:"]
            for rel in saved_uploads:
                lines.append(f"- `{rel}`")
            message += "\n".join(lines)
        if not message:
            raise ValueError("Message is required.")
        self.write_context(session)
        resume = bool(session.cli_session_id) and edit_index is None
        session.start_message(message, settings, resume)
        return {"session": session.snapshot()}

    def start_plan(self, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        session = self.get(session_id)
        if session.kind != "chat":
            raise ValueError("Plan mode is only available for chat sessions.")
        message = str(payload.get("message") or "").strip()
        uploads = payload.get("files") if isinstance(payload.get("files"), list) else []
        edit_index_raw = payload.get("editIndex", payload.get("edit_index"))
        edit_index: int | None = None
        if edit_index_raw not in (None, ""):
            try:
                edit_index = int(edit_index_raw)
            except (TypeError, ValueError):
                raise ValueError("Invalid message edit index.")
        if not message and not uploads:
            raise ValueError("Plan request is required.")
        if session.is_active():
            raise ValueError("This session already has an active run. Wait for it to finish or refresh it.")
        self.ensure_aux_run_allowed(session)
        settings = self.preflight_settings(
            session, payload.get("settings") or session.settings,
            implementation=False,
            force_refresh=True,
        )
        if edit_index is not None and uploads:
            raise ValueError("Edited plan messages cannot add new attachments yet.")
        edit_meta: dict[str, Any] = {}
        if edit_index is not None:
            edit_meta = session.prepare_message_edit(edit_index)
            if edit_meta.get("previous_user_duplicate") and str(edit_meta.get("edited_text") or "").strip() == message:
                session.drop_trailing_duplicate_user(message)

        saved_uploads = self._save_chat_uploads(session, uploads)
        agent_message = message
        display_message = message
        if saved_uploads:
            if not agent_message:
                agent_message = "Please review the attached file(s)."
                display_message = agent_message
            lines = ["", "", "Attached files in this chat workspace:"]
            for rel in saved_uploads:
                lines.append(f"- `{rel}`")
            metadata = "\n".join(lines)
            agent_message += metadata
            display_message += metadata
        if not agent_message.strip():
            raise ValueError("Plan request is required.")

        backend = self.engine.normalize_agent_backend(settings.get("backend"))
        revision_of = self.engine.normalize_plan_id(payload.get("revisePlanId") or edit_meta.get("archived_plan_id"))
        revision_plan = ""
        if revision_of:
            try:
                prior = self.engine.read_plan_artifact(revision_of)
                revision_plan = str(prior.get("plan_text") or "").strip()
            except Exception:
                revision_plan = ""
        conversation_history = list(session.chat_history)
        artifact = self.engine.create_plan_artifact(
            backend,
            settings,
            agent_message,
            display_message,
            {"saved_files": saved_uploads},
            revision_of=revision_of,
            owner_session_id=session.id,
        )
        prompt = self.engine.plan_research_prompt(agent_message, conversation_history=conversation_history, revision_plan=revision_plan)
        if self.is_read_only_discussion(session):
            prompt = self.discussion_prompt(session, prompt)

        with session.lock:
            session.plan_id = str(artifact.get("id") or "")
            previous_backend = self.engine.normalize_agent_backend(session.backend)
            if backend != previous_backend:
                session.cli_session_id = ""
            session.backend = backend
            session.settings = settings
            if session.title_source == "auto" and session.title == session._default_title():
                session.title = auto_session_title(display_message)
            session.chat_history.append({"role": "user", "text": display_message, "at": _now_iso()})
            session.chat_history.append({"role": "assistant", "kind": "plan", "plan_id": session.plan_id, "text": "", "at": _now_iso()})
            session.chat_history = session.chat_history[-AUX_CHAT_HISTORY_MAX:]
            session.status = "running"
            session.started_at = _now_iso()
            session.streaming_transcript = {}
            session.updated_at = session.started_at
            session._cancel_requested = False
            session._stop_requested = False
        self.write_context(session)
        session.persist()
        session.emit("plan", {"plan": self.engine.public_plan_artifact(artifact)})
        session.emit("session", {"status": "running"})
        try:
            self.begin_v2_boundary(session, "plan")
        except Exception:
            with session.lock:
                session.status = "error"
                session.updated_at = _now_iso()
            session.persist()
            self.engine.update_plan_artifact(session.plan_id, status="failed", error="The v2 auxiliary boundary could not start.")
            session.emit("error", {"status": "error", "message": "The v2 auxiliary boundary could not start."})
            raise
        thread = threading.Thread(
            target=self.run_in_project,
            args=(session, session.run_plan, prompt, artifact),
            daemon=True,
        )
        with session.lock:
            session._thread = thread
        thread.start()
        return {"session": session.snapshot(), "plan": self.engine.public_plan_artifact(artifact)}

    def approve_plan(self, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        session = self.get(session_id)
        if session.kind != "chat":
            raise ValueError("Plan approval is only available for chat sessions.")
        if self.protocol_classification() == "v2":
            raise ValueError(
                "A v2 auxiliary plan is advisory only. Start it through the main research flow so changes use staging, review, and service-owned publication."
            )
        plan_id = self.engine.normalize_plan_id(payload.get("planId") or payload.get("id"))
        if not plan_id or plan_id != str(session.plan_id or ""):
            raise ValueError("Plan id does not match the active session plan.")
        artifact = self.engine.read_plan_artifact(plan_id)
        plan_text = str(artifact.get("plan_text") or "").strip()
        status = str(artifact.get("status") or "").strip()
        if status not in {"ready", "approved"} or not plan_text:
            raise ValueError("Only a ready plan can be approved.")
        if session.is_active():
            raise ValueError("This session already has an active run. Wait for it to finish or refresh it.")
        self.ensure_aux_run_allowed(session)
        settings = self.engine.preflight_agent_settings(
            payload.get("settings") or session.settings,
            implementation=True,
            force_refresh=True,
        )
        artifact = self.engine.update_plan_artifact(plan_id, status="approved", approved_at=self.engine.now_iso(), implemented_run_id=session.id)
        session.emit("plan", {"plan": self.engine.public_plan_artifact(artifact)})
        instruction = str(payload.get("instruction") or "").strip()
        prompt = self.engine.approved_plan_prompt(artifact, instruction)
        display_message = f"Implement approved plan {plan_id}."
        self.write_context(session)
        session.start_prepared_run(prompt, display_message, settings, resume=False)
        return {"session": session.snapshot(), "plan": self.engine.public_plan_artifact(artifact)}

    def _save_chat_uploads(self, session: AuxSession, uploads: list[Any]) -> list[str]:
        if session.kind != "chat" or not uploads:
            return []
        root = session.workspace_dir / "attachments"
        root.mkdir(parents=True, exist_ok=True)
        saved: list[str] = []
        for item in uploads[:12]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "attachment").strip()
            encoded = str(item.get("contentBase64") or "").strip()
            if not encoded:
                continue
            try:
                data = base64.b64decode(encoded, validate=True)
            except Exception:
                continue
            stem = _slug(Path(name).stem or "attachment", "attachment")
            suffix = Path(name).suffix.lower()
            if not suffix or len(suffix) > 16 or any(ch not in ".abcdefghijklmnopqrstuvwxyz0123456789" for ch in suffix):
                suffix = ""
            target = root / f"{stem}{suffix}"
            counter = 2
            while target.exists():
                target = root / f"{stem}-{counter}{suffix}"
                counter += 1
            try:
                _write_private_bytes(target, data)
                saved.append(str(target.relative_to(session.workspace_dir)))
            except OSError:
                continue
        return saved

    def rename_session(self, session_id: str, title: str) -> AuxSession:
        session = self.get(session_id)
        if session.kind == "evolution":
            raise ValueError("The evolution session is the persistent autoresearch loop and cannot be renamed.")
        session.rename(title)
        return session

    # ---- context documents ----------------------------------------------
    def write_context(self, session: AuxSession) -> None:
        session.ensure_dirs()
        try:
            if session.kind == "evolution":
                text = self.engine.build_evolution_context(session)
            else:
                text = self.engine.build_chat_context(session)
            _write_private_bytes(session.context_path, text.encode("utf-8"))
        except Exception:
            pass

    # ---- prompt + command ------------------------------------------------
    def build_prompt(self, session: AuxSession, message: str) -> str:
        prompt = self.engine.build_aux_prompt(session, message)
        if not self.is_read_only_discussion(session):
            return prompt
        return self.discussion_prompt(session, prompt)

    def discussion_prompt(self, session: AuxSession, prompt: str) -> str:
        return f"""CoAutoResearch read-only discussion:
- Help the human understand evidence, question assumptions, compare ideas, and propose next steps.
- Read only the files needed for the question; do not run the main research startup checklist. Prefer a concise, useful answer over a full project audit unless requested.
- You may read the project at `{self.context.root}` and attachments at `{session.workspace_dir}`. Do not write files, run experiments, or launch agents.
- Main research may be running concurrently. Cite inspected files and distinguish published findings from in-progress work. Re-read relevant state before claiming something is current; say when observations may have changed.
- When changes are requested, explain the concrete proposal and its rationale in your reply. The human can use “Add to research draft” to review and send it through the main research flow. Do not claim a proposal has been applied or sent.
- Project execution instructions describe the main researcher; in this discussion your role remains read-only.

{prompt}"""

    def agent_command(self, session: AuxSession, resume: bool) -> list[str]:
        return self.engine.aux_agent_command(session, resume)
