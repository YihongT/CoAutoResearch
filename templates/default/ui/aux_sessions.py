#!/usr/bin/env python3
"""Auxiliary (multi-)session isolation layer for CoAutoResearch.

This module adds Codex/Box-style multi-session support on top of the existing
single-session autoresearch engine WITHOUT touching the evolution loop.

Three session kinds are supported:

- ``monitor``   : read-only progress questions ("how is it going, best result,
                  vs baseline, which ideas worked"). Auto-refreshes a live
                  progress digest before every message.
- ``idea``      : discussion / reproduction sandbox with its own workspace
                  directory (clone repos, drop papers, run baselines). May write
                  only inside its own workspace, never the shared trajectory.
- ``evolution`` : the persistent autoresearch loop. There is exactly ONE and it
                  is handled by the legacy engine; this manager only tracks a
                  lightweight pointer to it so the UI can list it uniformly.

Each ``monitor``/``idea`` session owns an independent CLI session id, so their
context windows are fully isolated from the evolution loop and from each other.

The module is intentionally self-contained: it receives an ``engine`` object
(the host module ``server``) that exposes the small set of helpers it needs, so
that server.py wiring stays minimal.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any, Callable


AUX_SESSION_KINDS = ("monitor", "idea", "evolution")
AUX_CHAT_HISTORY_MAX = 200
AUX_LOG_MAX = 2000
AUX_TRANSCRIPT_MAX = 600
AUX_EVENT_BUFFER_MAX = 500

# Files that monitor/idea sessions must never mutate. Enforced both by prompt
# hard-boundary and by a snapshot+restore guard around every run.
AUX_PROTECTED_PATHS = [
    "research_trajectory/STATE.md",
    "research_trajectory/CURRENT_FINDINGS.md",
    "research_trajectory/TRAJECTORY.json",
    "research_trajectory/NEXT_TRIAL.json",
    "research_trajectory/trials",
    "research_trajectory/checkpoints",
    "research_trajectory/human_interventions",
    "manuscript/BLUEPRINT.md",
    "manuscript/reviews",
    "manuscript/sections",
    "manuscript/figures/FIGURE_SPECS.md",
    "PROJECT.md",
]


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


class AuxSession:
    """A single isolated chat/monitor/idea session backed by its own CLI thread."""

    def __init__(self, manager: "AuxSessionManager", kind: str, title: str = "") -> None:
        self.manager = manager
        self.kind = kind if kind in AUX_SESSION_KINDS else "monitor"
        self.id = f"{self.kind[:3].upper()}{_now_id()}_{uuid.uuid4().hex[:6]}"
        self.title = str(title or "").strip() or self._default_title()
        self.created_at = _now_iso()
        self.updated_at = self.created_at
        self.cli_session_id = ""
        self.status = "idle"  # idle | running | error | completed
        self.settings: dict[str, Any] = {}
        self.backend = "codex"
        self.chat_history: list[dict[str, Any]] = []
        self.logs: list[str] = []
        self.transcript: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []
        self.event_id = 0
        self.last_event_at = ""
        self.last_event_summary = ""
        self.returncode: Any = None
        self._process: subprocess.Popen[str] | None = None
        self._thread: threading.Thread | None = None
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
            "monitor": "Monitor",
            "idea": "Idea discussion",
            "evolution": "Evolution run",
        }.get(self.kind, "Session")

    def ensure_dirs(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self.context_dir.mkdir(parents=True, exist_ok=True)
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

    def is_running(self) -> bool:
        with self.lock:
            proc = self._process
        return bool(proc and proc.poll() is None)

    def meta(self) -> dict[str, Any]:
        with self.lock:
            return {
                "id": self.id,
                "kind": self.kind,
                "title": self.title,
                "created_at": self.created_at,
                "updated_at": self.updated_at,
                "cli_session_id": self.cli_session_id,
                "status": "running" if self.is_running() else self.status,
                "backend": self.backend,
                "settings": self.settings,
                "returncode": self.returncode,
            }

    def public(self) -> dict[str, Any]:
        m = self.meta()
        with self.lock:
            m["workspace"] = str(self.workspace_dir)
            m["context_path"] = str(self.context_path)
            m["last_event_at"] = self.last_event_at
            m["last_event_summary"] = self.last_event_summary
            m["running"] = self.is_running()
        return m

    def snapshot(self) -> dict[str, Any]:
        m = self.public()
        with self.lock:
            m["chat_history"] = list(self.chat_history)[-AUX_CHAT_HISTORY_MAX:]
            m["logs"] = list(self.logs)[-200:]
            m["transcript"] = list(self.transcript)[-120:]
        return m

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
                    self.created_at = str(data.get("created_at") or self.created_at)
                    self.updated_at = str(data.get("updated_at") or self.updated_at)
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

    def append_log(self, line: str) -> None:
        engine = self.manager.engine
        backend = self.backend or "codex"
        display = engine.format_agent_event(line, backend)
        transcript = engine.transcript_from_agent_line(line, backend)
        event_at = _now_iso()
        with self.lock:
            if line.strip():
                self.logs.append(line.rstrip("\n"))
                self.last_event_at = event_at
            if display:
                self.last_event_summary = engine.compact_single_line(display, 260)
            # capture CLI session id for resume
            sid = ""
            try:
                sid = engine.find_session_identifier(json.loads(line))
            except json.JSONDecodeError:
                sid = engine.find_session_identifier(line)
            if sid:
                self.cli_session_id = sid
            if transcript and transcript.get("content"):
                self.transcript.append(transcript)
                self.transcript = self.transcript[-AUX_TRANSCRIPT_MAX:]
            self.logs = self.logs[-AUX_LOG_MAX:]
        payload: dict[str, Any] = {}
        if display:
            payload["log"] = display
        if transcript and transcript.get("content"):
            payload["transcript_entry"] = transcript
        if payload or line.strip():
            self.emit("agent_event", payload)

    # ---- protected-file guard -------------------------------------------
    def _snapshot_protected(self) -> Path | None:
        if self.kind == "evolution":
            return None
        engine = self.manager.engine
        snap_root = self.manager.sessions_dir / "_guard" / f"{self.id}_{uuid.uuid4().hex[:8]}"
        try:
            snap_root.mkdir(parents=True, exist_ok=True)
        except OSError:
            return None
        manifest: list[dict[str, Any]] = []
        for rel in AUX_PROTECTED_PATHS:
            source = engine.repo_path(rel)
            entry = {"path": rel, "exists": source.exists()}
            if source.exists():
                target = snap_root / "files" / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    if source.is_dir():
                        shutil.copytree(source, target, symlinks=True)
                    else:
                        shutil.copy2(source, target, follow_symlinks=False)
                except OSError:
                    entry["skipped"] = True
            manifest.append(entry)
        try:
            (snap_root / "MANIFEST.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError:
            pass
        return snap_root

    def _restore_protected(self, snap_root: Path | None) -> list[str]:
        if not snap_root or not snap_root.exists():
            return []
        engine = self.manager.engine
        try:
            manifest = json.loads((snap_root / "MANIFEST.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            manifest = []
        restored: list[str] = []
        for entry in manifest if isinstance(manifest, list) else []:
            rel = str(entry.get("path") or "")
            if not rel:
                continue
            source = engine.repo_path(rel)
            backup = snap_root / "files" / rel
            existed = bool(entry.get("exists"))
            # Detect mutation: current existence/content differs from snapshot.
            changed = source.exists() != existed
            if not changed and source.exists() and backup.exists() and source.is_file() and backup.is_file():
                try:
                    changed = source.read_bytes() != backup.read_bytes()
                except OSError:
                    changed = True
            if not changed:
                continue
            try:
                if source.exists():
                    if source.is_dir():
                        shutil.rmtree(source, ignore_errors=True)
                    else:
                        source.unlink()
                if existed and backup.exists():
                    source.parent.mkdir(parents=True, exist_ok=True)
                    if backup.is_dir():
                        shutil.copytree(backup, source, symlinks=True)
                    else:
                        shutil.copy2(backup, source, follow_symlinks=False)
                restored.append(rel)
            except OSError:
                continue
        shutil.rmtree(snap_root, ignore_errors=True)
        return restored

    # ---- run -------------------------------------------------------------
    def start_message(self, message: str, settings: dict[str, Any], resume: bool) -> None:
        """Launch the CLI for this session in a background thread."""
        engine = self.manager.engine
        self.ensure_dirs()
        self.settings = settings
        self.backend = engine.normalize_agent_backend(settings.get("backend"))
        prompt = self.manager.build_prompt(self, message)
        with self.lock:
            self.chat_history.append({"role": "user", "text": message, "at": _now_iso()})
            self.chat_history = self.chat_history[-AUX_CHAT_HISTORY_MAX:]
            self.status = "running"
            self.updated_at = _now_iso()
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
        snap = self._snapshot_protected()
        command = self.manager.agent_command(self, resume)
        env = engine.agent_process_env(self.backend)
        cwd = self.workspace_dir if self.kind == "idea" else engine.repo_path(".")
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
            self.emit("error", {"status": "error"})
            self._restore_protected(snap)
            return
        try:
            assert proc.stdout is not None
            assistant_parts: list[str] = []
            final_text = ""
            for line in proc.stdout:
                self.append_log(line)
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
        restored = self._restore_protected(snap)
        if restored:
            self.append_log(
                "Session guard restored protected autoresearch artifacts: " + ", ".join(restored)
            )
        with self.lock:
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
        if proc and proc.poll() is None:
            try:
                self.manager.engine.signal_research_process(proc, force=force)
            except Exception:
                pass

    def refresh(self) -> None:
        """Clear the CLI context: kill process, wipe history + cli session id."""
        self.stop(force=True)
        with self.lock:
            self.chat_history = []
            self.logs = []
            self.transcript = []
            self.cli_session_id = ""
            self.status = "idle"
            self.returncode = None
            self.last_event_summary = ""
            self.updated_at = _now_iso()
        self.persist()
        self.emit("session", {"status": "idle", "refreshed": True})


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
                kind = "monitor"
                meta_path = sdir / "meta.json"
                if meta_path.exists():
                    try:
                        meta = json.loads(meta_path.read_text(encoding="utf-8"))
                        kind = str(meta.get("kind") or "monitor")
                    except (OSError, json.JSONDecodeError):
                        pass
                session = AuxSession(self, kind)
                session.id = str(sid)
                session.dir = sdir
                session.context_dir = sdir / "context"
                session.workspace_dir = sdir / "workspace"
                session.context_path = session.context_dir / "CONTEXT.md"
                session.load_persisted()
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
        if kind not in AUX_SESSION_KINDS:
            raise ValueError(f"Unknown session kind: {kind}")
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
        session.stop(force=True)
        # idea workspace + all session dirs are deleted outright (user choice)
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
        session.refresh()
        # Rebuild context document from the latest project state.
        self.write_context(session)
        return session

    def chat(self, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        session = self.get(session_id)
        message = str(payload.get("message") or "").strip()
        if not message:
            raise ValueError("Message is required.")
        if session.is_running():
            raise ValueError("This session already has an active run. Wait for it to finish or refresh it.")
        settings = self.engine.normalize_research_settings(payload.get("settings") or session.settings)
        # Monitor sessions always refresh their live progress digest first.
        if session.kind == "monitor":
            self.write_context(session)
        resume = bool(session.cli_session_id)
        session.start_message(message, settings, resume)
        return {"session": session.public()}

    # ---- context documents ----------------------------------------------
    def write_context(self, session: AuxSession) -> None:
        session.ensure_dirs()
        try:
            if session.kind == "monitor":
                text = self.engine.build_monitor_context(session)
            elif session.kind == "idea":
                text = self.engine.build_idea_context(session)
            else:
                text = self.engine.build_evolution_context(session)
            session.context_path.write_text(text, encoding="utf-8")
        except Exception:
            pass

    # ---- prompt + command ------------------------------------------------
    def build_prompt(self, session: AuxSession, message: str) -> str:
        return self.engine.build_aux_prompt(session, message)

    def agent_command(self, session: AuxSession, resume: bool) -> list[str]:
        return self.engine.aux_agent_command(session, resume)
