#!/usr/bin/env python3
"""Auxiliary project chat-session layer for CoAutoResearch.

This module adds Codex/Box-style multi-session support on top of the existing
single-session autoresearch engine WITHOUT touching the evolution loop.

Two session kinds are supported:

- ``chat``      : ordinary project agent chat. It runs from the project root so
                  users can ask questions and request edits; its private
                  workspace stores attachments and session-local files.
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
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any, Callable


AUX_SESSION_KINDS = ("chat", "evolution")
AUX_LEGACY_CHAT_KINDS = {"monitor", "idea"}
AUX_CHAT_HISTORY_MAX = 200
AUX_LOG_MAX = 2000
AUX_TRANSCRIPT_MAX = 600
AUX_EVENT_BUFFER_MAX = 500

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
        self.status = "idle"  # idle | running | error | completed
        self.started_at = ""
        self.settings: dict[str, Any] = {}
        self.backend = "codex"
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
        self.lock = threading.RLock()
        self.event_condition = threading.Condition(threading.RLock())
        # per-session directories
        self.dir = self.manager.sessions_dir / self.id
        self.context_dir = self.dir / "context"
        self.workspace_dir = self.dir / "workspace"
        self.context_path = self.context_dir / "CONTEXT.md"

    # ---- lifecycle -------------------------------------------------------
    def _default_title(self) -> str:
        return {
            "chat": "New session",
            "evolution": "Evolution Run",
        }.get(self.kind, "New session")

    def ensure_dirs(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self.context_dir.mkdir(parents=True, exist_ok=True)
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

    def is_running(self) -> bool:
        with self.lock:
            proc = self._process
        return bool(proc and proc.poll() is None)

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
            }

    def public(self) -> dict[str, Any]:
        m = self.meta()
        with self.lock:
            running = (m["status"] == "running") if self.kind == "evolution" else self.is_active()
            m["workspace"] = str(self.workspace_dir)
            m["project_root"] = str(self.manager.context.root)
            m["context_path"] = str(self.context_path)
            m["event_id"] = self.event_id
            m["last_event_at"] = self.last_event_at
            m["last_event_summary"] = self.last_event_summary
            m["running"] = running
        return m

    def snapshot(self) -> dict[str, Any]:
        m = self.public()
        with self.lock:
            m["chat_history"] = list(self.chat_history)[-AUX_CHAT_HISTORY_MAX:]
            m["logs"] = list(self.logs)[-200:]
            m["transcript"] = list(self.transcript)[-120:]
            m["context_preview"] = self.context_preview()
        return m

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
        try:
            (self.dir / "meta.json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            (self.dir / "chat_history.json").write_text(
                json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError:
            pass

    def load_persisted(self) -> None:
        meta_path = self.dir / "meta.json"
        history_path = self.dir / "chat_history.json"
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
                    if isinstance(data.get("settings"), dict):
                        self.settings = data["settings"]
                    prev = str(data.get("status") or "idle")
                    self.status = "interrupted" if prev in {"running"} else prev
            if history_path.exists():
                hist = json.loads(history_path.read_text(encoding="utf-8"))
                if isinstance(hist, list):
                    self.chat_history = [h for h in hist if isinstance(h, dict)]
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
        event.update(payload or {})
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
    def start_message(self, message: str, settings: dict[str, Any], resume: bool) -> None:
        """Launch the CLI for this session in a background thread."""
        engine = self.manager.engine
        self.ensure_dirs()
        self.settings = settings
        self.backend = engine.normalize_agent_backend(settings.get("backend"))
        prompt = self.manager.build_prompt(self, message)
        with self.lock:
            if self.kind == "chat" and self.title_source == "auto" and self.title == self._default_title():
                self.title = auto_session_title(message)
            self.chat_history.append({"role": "user", "text": message, "at": _now_iso()})
            self.chat_history = self.chat_history[-AUX_CHAT_HISTORY_MAX:]
            self.status = "running"
            self.started_at = _now_iso()
            self.streaming_transcript = {}
            self.updated_at = self.started_at
        self.persist()
        self.emit("session", {"status": "running"})
        thread = threading.Thread(
            target=self.manager.engine.run_in_project,
            args=(self.manager.context, self._run, prompt, resume),
            daemon=True,
        )
        with self.lock:
            self._thread = thread
        thread.start()

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
            self.persist()
            self.emit("session", {"status": "interrupted"})
            return
        command = self.manager.agent_command(self, resume)
        env = engine.agent_process_env(self.backend)
        cwd = engine.repo_path(".")
        normalizer = engine.make_research_trace_normalizer(self.backend, "exec", self.settings)
        try:
            popen_command, use_shell, _wrapper = engine.popen_command_for_agent(command, self.settings, env)
            proc = subprocess.Popen(
                popen_command,
                cwd=str(cwd),
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                shell=use_shell,
                start_new_session=os.name != "nt",
            )
            with self.lock:
                self._process = proc
            assert proc.stdin is not None
            proc.stdin.write(prompt)
            proc.stdin.write("\n")
            proc.stdin.close()
        except (OSError, ValueError) as exc:
            self.append_log(f"Failed to start agent: {exc}")
            with self.lock:
                self.status = "error"
                self._process = None
                self.updated_at = _now_iso()
            self.persist()
            self.emit("error", {"status": "error"})
            return
        try:
            assert proc.stdout is not None
            assistant_parts: list[str] = []
            final_text = ""
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
        with self.lock:
            self._finalize_active_streaming_transcripts_locked()
            self._process = None
            self._thread = None
            self.returncode = returncode
            self.status = "completed" if returncode == 0 else "error"
            # Prefer the final result text (Claude "result" event); fall back
            # to collected assistant messages.
            reply = final_text or ("\n".join(assistant_parts) if assistant_parts else "")
            if reply:
                self.chat_history.append(
                    {"role": "assistant", "text": reply, "at": _now_iso()}
                )
                self.chat_history = self.chat_history[-AUX_CHAT_HISTORY_MAX:]
            self.updated_at = _now_iso()
        self.persist()
        self.emit("completed" if returncode == 0 else "error", {"status": self.status, "returncode": returncode})

    def stop(self, force: bool = False) -> None:
        with self.lock:
            proc = self._process
            if self.status == "running" and proc is None:
                # start_message() has marked this session running but the
                # background thread hasn't reached Popen yet (still copying
                # the protected-file snapshot, etc.) -- there is no OS
                # process to signal yet. Ask _run() to bail out before it
                # spawns one instead of silently doing nothing.
                self._cancel_requested = True
        if proc and proc.poll() is None:
            try:
                self.manager.engine.signal_research_process(proc, force=force)
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
            archived_count = len(history) - index - 1
            self.chat_history = history[:index]
            self.cli_session_id = ""
            self.logs = []
            self.transcript = []
            self.streaming_transcript = {}
            self.returncode = None
            self.status = "idle"
            self.started_at = ""
            if index == 0 and self.title_source == "auto":
                self.title = self._default_title()
            self.updated_at = _now_iso()
        self.persist()
        return {"archived_count": archived_count}

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
                sdir = self.sessions_dir / str(sid)
                if not sdir.exists():
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
                session.id = str(sid)
                session.dir = sdir
                session.context_dir = sdir / "context"
                session.workspace_dir = sdir / "workspace"
                session.context_path = session.context_dir / "CONTEXT.md"
                session.load_persisted()
                if session.kind != kind:
                    session.kind = kind
                session.persist()
                self.sessions[session.id] = session
                self.order.append(session.id)

    def _save_registry(self) -> None:
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.registry_path.write_text(
                json.dumps({"order": self.order, "updated_at": _now_iso()}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
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
        session.stop(force=True)
        # Chat workspace + all session dirs are deleted outright (user choice).
        try:
            if session.dir.exists():
                shutil.rmtree(session.dir, ignore_errors=True)
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
        if session.kind == "evolution" and self.engine.evolution_loop_status(self.context)["running"]:
            # The evolution session's subprocess and the legacy autoresearch
            # loop both have write access to research_trajectory/manuscript;
            # only one of them may run at a time or their writes could race.
            raise ValueError(
                "The evolution run is already active in the main research panel. "
                "Use that panel to continue it, or stop it there first."
            )
        if edit_index is not None:
            if uploads:
                raise ValueError("Edited chat messages cannot add new attachments yet.")
            session.prepare_message_edit(edit_index)
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
        settings = self.engine.normalize_research_settings(payload.get("settings") or session.settings)
        self.write_context(session)
        resume = bool(session.cli_session_id) and edit_index is None
        session.start_message(message, settings, resume)
        return {"session": session.public()}

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
                target.write_bytes(data)
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
            session.context_path.write_text(text, encoding="utf-8")
        except Exception:
            pass

    # ---- prompt + command ------------------------------------------------
    def build_prompt(self, session: AuxSession, message: str) -> str:
        return self.engine.build_aux_prompt(session, message)

    def agent_command(self, session: AuxSession, resume: bool) -> list[str]:
        return self.engine.aux_agent_command(session, resume)
