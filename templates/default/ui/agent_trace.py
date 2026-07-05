#!/usr/bin/env python3
"""Structured agent trace normalizers for CoAutoResearch.

This module deliberately stays pure-stdlib and tolerant of provider schema
drift. Unknown events return no updates so the legacy transcript parser can
render them unchanged.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import re
import time
from datetime import datetime
from typing import Any, Callable


MAX_ARGS_CHARS = 4000
MAX_RESULT_CHARS = 8000
MAX_OUTPUT_CHARS = 8000
MAX_DIFF_CHARS = 24000
MAX_DIFF_LINES = 400


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _slug(value: Any, fallback: str = "item") -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "").strip()).strip("._-")
    return text[:80] or fallback


def _stable_suffix(value: Any) -> str:
    return hashlib.sha1(str(value or "").encode("utf-8", "replace")).hexdigest()[:10]


def _json_line(line: str) -> dict[str, Any] | None:
    try:
        value = json.loads(str(line or "").strip())
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _cap_text(value: Any, limit: int) -> str:
    text = str(value or "")
    if len(text) <= limit:
        return text
    tail = max(0, limit - 80)
    return text[:tail].rstrip() + "\n[trace truncated]"


def _payload_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        parts = [_payload_text(item) for item in value]
        return "\n".join(part for part in parts if part).strip()
    if isinstance(value, dict):
        for key in ("text", "message", "summary", "content", "output", "result", "stdout", "stderr", "error"):
            text = _payload_text(value.get(key))
            if text:
                return text
        if "command" in value:
            command = value.get("command")
            return " ".join(str(part) for part in command) if isinstance(command, list) else str(command or "")
        parts = [_payload_text(item) for item in value.values()]
        return "\n".join(part for part in parts if part).strip()
    return ""


def _json_preview(value: Any, limit: int = MAX_ARGS_CHARS) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)
    except (TypeError, ValueError):
        text = str(value or "")
    return _cap_text(text, limit)


def _event_name(event: dict[str, Any]) -> str:
    raw = str(event.get("method") or event.get("type") or event.get("event") or event.get("kind") or "")
    return re.sub(r"[\s._]+", "/", raw.strip().lower())


def _params(event: dict[str, Any]) -> dict[str, Any]:
    params = event.get("params")
    return params if isinstance(params, dict) else event


def _item(event: dict[str, Any]) -> dict[str, Any]:
    params = _params(event)
    item = params.get("item") if isinstance(params.get("item"), dict) else event.get("item")
    return item if isinstance(item, dict) else {}


def _item_id(event: dict[str, Any], item: dict[str, Any] | None = None) -> str:
    item = item if isinstance(item, dict) else _item(event)
    params = _params(event)
    for source in (item, params, event):
        if not isinstance(source, dict):
            continue
        for key in ("id", "itemId", "item_id", "callId", "call_id", "tool_use_id", "toolUseId", "index"):
            value = source.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
    return _stable_suffix(event)


def _nested_value(value: Any, names: tuple[str, ...]) -> Any:
    if isinstance(value, dict):
        for name in names:
            if name in value:
                return value.get(name)
        for key in ("input", "args", "arguments", "params", "result", "usage", "item", "message"):
            nested = value.get(key)
            found = _nested_value(nested, names)
            if found is not None:
                return found
    if isinstance(value, list):
        for item in value:
            found = _nested_value(item, names)
            if found is not None:
                return found
    return None


def _safe_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    try:
        text = str(value or "").strip()
        return int(text) if text else None
    except (TypeError, ValueError):
        return None


def _duration_ms(started: float | None) -> int | None:
    if not started:
        return None
    return max(0, int((time.time() - started) * 1000))


def _normalize_status(value: Any, running_default: str = "running") -> str:
    status = str(value or "").strip().lower().replace("-", "_")
    aliases = {
        "in_progress": "running",
        "pending": "running",
        "queued": "running",
        "ok": "succeeded",
        "success": "succeeded",
        "completed": "completed",
        "complete": "completed",
        "failed": "failed",
        "error": "failed",
        "cancelled": "failed",
        "canceled": "failed",
        "declined": "declined",
    }
    return aliases.get(status, running_default)


def _normalize_step_status(value: Any) -> str:
    status = str(value or "").strip().lower().replace("-", "_")
    if status in {"completed", "complete", "done", "success", "succeeded"}:
        return "completed"
    if status in {"in_progress", "running", "active", "doing"}:
        return "in_progress"
    return "pending"


def _steps_from_value(value: Any) -> list[dict[str, str]]:
    candidates = value
    if isinstance(value, dict):
        for key in ("steps", "items", "todos", "plan"):
            if isinstance(value.get(key), list):
                candidates = value.get(key)
                break
    if not isinstance(candidates, list):
        return []
    steps: list[dict[str, str]] = []
    for item in candidates:
        if isinstance(item, str):
            text = item.strip()
            status = "pending"
        elif isinstance(item, dict):
            text = str(
                item.get("step")
                or item.get("content")
                or item.get("text")
                or item.get("title")
                or item.get("task")
                or ""
            ).strip()
            status = _normalize_step_status(item.get("status") or item.get("state"))
        else:
            continue
        if text:
            steps.append({"step": text, "status": status})
    return steps


def _line_counts(diff_text: str) -> tuple[int, int]:
    plus = 0
    minus = 0
    for line in str(diff_text or "").splitlines():
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            plus += 1
        elif line.startswith("-"):
            minus += 1
    return plus, minus


def _cap_diff(diff_text: str) -> tuple[str, bool, int, int]:
    plus, minus = _line_counts(diff_text)
    lines = str(diff_text or "").splitlines()
    truncated = len(lines) > MAX_DIFF_LINES or len(diff_text) > MAX_DIFF_CHARS
    if len(lines) > MAX_DIFF_LINES:
        lines = lines[:MAX_DIFF_LINES]
    capped = "\n".join(lines)
    if len(capped) > MAX_DIFF_CHARS:
        capped = capped[:MAX_DIFF_CHARS].rstrip()
    if truncated:
        capped = (capped + "\n[diff truncated]").strip()
    return capped, truncated, plus, minus


def _unified_diff(old: str, new: str, path: str, from_label: str = "") -> dict[str, Any]:
    before = str(old or "").splitlines()
    after = str(new or "").splitlines()
    diff = "\n".join(
        difflib.unified_diff(
            before,
            after,
            fromfile=from_label or f"a/{path}",
            tofile=f"b/{path}",
            lineterm="",
            n=3,
        )
    )
    capped, truncated, plus, minus = _cap_diff(diff)
    return {
        "path": path,
        "action": "update",
        "diff": capped,
        "truncated": truncated,
        "plus_lines": plus,
        "minus_lines": minus,
    }


def _change_from_path(path: str, action: str = "update", diff_text: str = "") -> dict[str, Any]:
    diff, truncated, plus, minus = _cap_diff(diff_text)
    return {
        "path": str(path or "").strip(),
        "action": action if action in {"add", "update", "delete", "rename"} else "update",
        "diff": diff,
        "truncated": truncated,
        "plus_lines": plus,
        "minus_lines": minus,
    }


def _changes_from_value(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        changes: list[dict[str, Any]] = []
        for item in value:
            changes.extend(_changes_from_value(item))
        return changes
    if not isinstance(value, dict):
        return []
    raw_changes = value.get("changes")
    if isinstance(raw_changes, list):
        return _changes_from_value(raw_changes)
    path = str(
        value.get("path")
        or value.get("file_path")
        or value.get("filePath")
        or value.get("filename")
        or value.get("file")
        or ""
    ).strip()
    if not path and isinstance(value.get("target"), dict):
        path = str(value["target"].get("path") or "").strip()
    diff = str(value.get("diff") or value.get("patch") or value.get("unified_diff") or value.get("unifiedDiff") or "")
    action = str(value.get("action") or value.get("kind") or value.get("operation") or "update").strip().lower()
    aliases = {"create": "add", "created": "add", "modify": "update", "modified": "update", "remove": "delete"}
    action = aliases.get(action, action)
    if not path and not diff:
        return []
    if not path:
        path = "patch"
    return [_change_from_path(path, action, diff)]


def _command_from_value(value: Any) -> str:
    command = _nested_value(value, ("command", "cmd"))
    if isinstance(command, list):
        return " ".join(str(part) for part in command)
    return str(command or "").strip()


def _tool_name(value: Any) -> str:
    return str(
        _nested_value(value, ("tool", "name", "tool_name", "toolName", "server_tool_name"))
        or "tool"
    ).strip() or "tool"


class TraceNormalizer:
    """Base class for stateful provider trace normalizers."""

    def __init__(self, read_file: Callable[[str], str | None] | None = None) -> None:
        self.read_file = read_file or (lambda _path: None)
        self.items: dict[str, dict[str, Any]] = {}

    def feed(self, line: str) -> list[dict[str, Any]]:
        return []

    def finish(self, returncode: int | None) -> list[dict[str, Any]]:
        updates: list[dict[str, Any]] = []
        for state in list(self.items.values()):
            payload = state.get("payload") if isinstance(state.get("payload"), dict) else {}
            status = str(payload.get("status") or "").lower()
            if status not in {"running", "in_progress"} and not state.get("streaming"):
                continue
            payload = dict(payload)
            if payload.get("type") == "file_change":
                payload["status"] = "failed" if returncode not in {0, None} else "completed"
            elif payload.get("type") == "command":
                payload["status"] = "failed" if returncode not in {0, None} else "completed"
                if payload.get("exit_code") is None and returncode is not None:
                    payload["exit_code"] = returncode
            elif payload.get("type") == "tool_call":
                payload["status"] = "failed" if returncode not in {0, None} else "succeeded"
            elif payload.get("type") == "web_search":
                payload["status"] = "failed" if returncode not in {0, None} else "completed"
            state["payload"] = payload
            state["streaming"] = False
            updates.append(self._state_update(state))
        return updates

    def resolve_approval(self, request_id: str, decision: str, decided_by: str = "auto_policy") -> dict[str, Any] | None:
        state = self.items.get(f"approval:{request_id}")
        if not state:
            return None
        payload = dict(state.get("payload") or {})
        payload["decision"] = str(decision or "").strip()
        payload["decided_by"] = decided_by
        payload["resolved_at"] = _now_iso()
        state["payload"] = payload
        state["streaming"] = False
        state["content"] = self._content_for_payload(payload)
        return self._state_update(state)

    def _new_payload(self, payload_type: str, values: dict[str, Any]) -> dict[str, Any]:
        payload = {"v": 1, "type": payload_type}
        payload.update(values)
        return payload

    def _upsert_state(
        self,
        entry_key: str,
        *,
        role: str,
        kind: str,
        title: str,
        raw_type: str,
        payload: dict[str, Any] | None = None,
        content: str = "",
        streaming: bool = False,
    ) -> dict[str, Any]:
        state = self.items.get(entry_key)
        if not state:
            state = {
                "entry_key": entry_key,
                "role": role,
                "kind": kind,
                "title": title,
                "raw_type": raw_type,
                "created_at": _now_iso(),
            }
            self.items[entry_key] = state
        state.update(
            {
                "role": role,
                "kind": kind,
                "title": title,
                "raw_type": raw_type,
                "streaming": bool(streaming),
            }
        )
        if payload is not None:
            state["payload"] = payload
        state["content"] = content or self._content_for_payload(state.get("payload") if isinstance(state.get("payload"), dict) else {})
        return self._state_update(state)

    def _state_update(self, state: dict[str, Any]) -> dict[str, Any]:
        update = {
            "entry_key": state.get("entry_key") or _stable_suffix(state),
            "role": state.get("role") or "tool",
            "kind": state.get("kind") or "tool",
            "title": state.get("title") or "Tool",
            "content": str(state.get("content") or "").strip()[:MAX_OUTPUT_CHARS],
            "raw_type": state.get("raw_type") or "trace",
            "streaming": bool(state.get("streaming")),
        }
        if isinstance(state.get("payload"), dict):
            update["payload"] = self._cap_payload(dict(state["payload"]))
        return update

    def _cap_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        ptype = payload.get("type")
        if ptype == "command":
            payload["output"] = _cap_text(payload.get("output"), MAX_OUTPUT_CHARS)
        elif ptype == "tool_call":
            payload["args"] = self._cap_json_value(payload.get("args"), MAX_ARGS_CHARS)
            payload["result"] = _cap_text(payload.get("result"), MAX_RESULT_CHARS)
        elif ptype == "file_change":
            next_changes = []
            for change in payload.get("changes") if isinstance(payload.get("changes"), list) else []:
                if not isinstance(change, dict):
                    continue
                next_change = dict(change)
                diff, truncated, plus, minus = _cap_diff(str(next_change.get("diff") or ""))
                next_change["diff"] = diff
                next_change["truncated"] = bool(next_change.get("truncated")) or truncated
                next_change["plus_lines"] = _safe_int(next_change.get("plus_lines")) or plus
                next_change["minus_lines"] = _safe_int(next_change.get("minus_lines")) or minus
                next_changes.append(next_change)
            payload["changes"] = next_changes
        elif ptype == "error":
            payload["message"] = _cap_text(payload.get("message"), MAX_RESULT_CHARS)
        return payload

    def _cap_json_value(self, value: Any, limit: int) -> Any:
        text = _json_preview(value, limit)
        if len(text) < limit and isinstance(value, (dict, list)):
            return value
        return text

    def _content_for_payload(self, payload: dict[str, Any]) -> str:
        ptype = str(payload.get("type") or "")
        if ptype == "command":
            command = str(payload.get("command") or "command")
            status = str(payload.get("status") or "running")
            exit_code = payload.get("exit_code")
            suffix = f" (exit {exit_code})" if exit_code is not None else ""
            return f"{status}: {command}{suffix}"
        if ptype == "tool_call":
            tool = str(payload.get("tool") or "tool")
            status = str(payload.get("status") or "running")
            result = _payload_text(payload.get("result"))
            return f"{status}: {tool}" + (f"\n{result}" if result else "")
        if ptype == "file_change":
            changes = payload.get("changes") if isinstance(payload.get("changes"), list) else []
            names = ", ".join(str(change.get("path") or "") for change in changes[:3] if isinstance(change, dict))
            count = len(changes)
            label = f"{count} file change{'s' if count != 1 else ''}"
            return f"{payload.get('status') or 'in_progress'}: {label}" + (f" - {names}" if names else "")
        if ptype == "plan_update":
            steps = payload.get("steps") if isinstance(payload.get("steps"), list) else []
            done = sum(1 for item in steps if isinstance(item, dict) and item.get("status") == "completed")
            return f"Checklist {done}/{len(steps)}"
        if ptype == "approval":
            decision = str(payload.get("decision") or "pending")
            return f"Approval {decision}: {payload.get('approval_kind') or 'request'}"
        if ptype == "usage":
            total = payload.get("total_tokens")
            return f"Usage summary" + (f": {total} tokens" if total else "")
        if ptype == "web_search":
            query = str(payload.get("query") or "").strip()
            return f"Web search: {query}" if query else "Web search"
        if ptype == "error":
            return str(payload.get("message") or "Agent error")
        return ""


class CodexExecNormalizer(TraceNormalizer):
    def feed(self, line: str) -> list[dict[str, Any]]:
        event = _json_line(line)
        if not event:
            return []
        method = _event_name(event)
        if not method:
            return []
        if method in {"thread/started", "turn/started"} or method.startswith("thread/"):
            return []
        if "commandexecution/outputdelta" in method or "command/execution/outputdelta" in method:
            return [self._command_output_delta(event, method)]
        if "websearch" in method or "web/search" in method:
            update = self._web_search(event, method)
            return [update] if update else []
        if "tokenusage" in method or "token/usage" in method:
            update = self._usage(event, method)
            return [update] if update else []
        if method in {"turn/completed", "turn/failed", "error"}:
            updates: list[dict[str, Any]] = []
            usage = self._usage(event, method)
            if usage:
                updates.append(usage)
            if method in {"turn/failed", "error"} or event.get("error"):
                updates.append(self._error(event, method))
            return updates
        if not method.startswith("item/") and "item" not in method:
            return []
        item = _item(event)
        if not item:
            return []
        item_type = _event_name({"type": item.get("type") or item.get("kind") or item.get("role")})
        if not item_type:
            return []
        if any(token in item_type for token in ("commandexecution", "command/execution", "command", "exec")):
            return [self._command_item(event, method, item)]
        if any(token in item_type for token in ("filechange", "file/change", "patch")):
            return [self._file_change_item(event, method, item)]
        if any(token in item_type for token in ("mcptoolcall", "mcp/tool/call", "toolcall", "tool/call")):
            return [self._tool_call_item(event, method, item)]
        if any(token in item_type for token in ("websearch", "web/search")):
            update = self._web_search(item, method, item_id=_item_id(event, item))
            return [update] if update else []
        if any(token in item_type for token in ("todo", "plan")):
            update = self._plan_update(event, method, item)
            return [update] if update else []
        if "reasoning" in item_type:
            text = _payload_text(item)
            if text:
                return [self._text_update(f"reasoning:{_item_id(event, item)}", "assistant", "reasoning", "Thinking summary", method, text)]
        if any(token in item_type for token in ("agentmessage", "agent/message", "message")):
            text = _payload_text(item)
            if text:
                return [self._text_update(f"message:{_item_id(event, item)}", "assistant", "assistant", "Assistant", method, text)]
        return []

    def _text_update(self, key: str, role: str, kind: str, title: str, raw_type: str, text: str) -> dict[str, Any]:
        return self._upsert_state(
            key,
            role=role,
            kind=kind,
            title=title,
            raw_type=raw_type,
            content=_cap_text(text, MAX_OUTPUT_CHARS),
            streaming=False,
        )

    def _command_item(self, event: dict[str, Any], method: str, item: dict[str, Any]) -> dict[str, Any]:
        key = f"command:{_item_id(event, item)}"
        existing = self.items.get(key, {})
        previous = existing.get("payload") if isinstance(existing.get("payload"), dict) else {}
        command = _command_from_value(item) or str(previous.get("command") or "command")
        exit_code = _safe_int(_nested_value(item, ("exit_code", "exitCode", "returncode", "returnCode")))
        output = "\n".join(
            part
            for part in (
                str(previous.get("output") or ""),
                _payload_text(item.get("aggregated_output") or item.get("output") or item.get("stdout") or item.get("stderr")),
            )
            if part
        ).strip()
        status = "running"
        if method.endswith("/completed") or exit_code is not None:
            status = "completed" if exit_code in {None, 0} else "failed"
        else:
            status = _normalize_status(item.get("status"), "running")
        started_at = previous.get("started_at") or _now_iso()
        payload = self._new_payload(
            "command",
            {
                "command": command,
                "cwd": str(_nested_value(item, ("cwd", "working_dir", "workingDirectory")) or ""),
                "status": status,
                "exit_code": exit_code,
                "output": output,
                "duration_ms": _safe_int(_nested_value(item, ("duration_ms", "durationMs"))) or _duration_ms(existing.get("_started_ts")),
                "started_at": started_at,
            },
        )
        return self._upsert_state(
            key,
            role="command",
            kind="command",
            title="Command",
            raw_type=method,
            payload=payload,
            streaming=status == "running",
        )

    def _command_output_delta(self, event: dict[str, Any], method: str) -> dict[str, Any]:
        params = _params(event)
        item_id = _item_id(event)
        key = f"command:{item_id}"
        state = self.items.get(key)
        if not state:
            state = {"_started_ts": time.time()}
            self.items[key] = state
        previous = state.get("payload") if isinstance(state.get("payload"), dict) else {}
        delta = _payload_text(params.get("delta") or params.get("outputDelta") or params.get("output_delta") or params)
        output = f"{previous.get('output', '')}{delta}"
        payload = self._new_payload(
            "command",
            {
                "command": str(previous.get("command") or "command"),
                "cwd": str(previous.get("cwd") or ""),
                "status": "running",
                "exit_code": previous.get("exit_code"),
                "output": output,
                "duration_ms": _duration_ms(state.get("_started_ts")),
                "started_at": previous.get("started_at") or _now_iso(),
            },
        )
        return self._upsert_state(key, role="command", kind="command", title="Command", raw_type=method, payload=payload, streaming=True)

    def _file_change_item(self, event: dict[str, Any], method: str, item: dict[str, Any]) -> dict[str, Any]:
        key = f"file:{_item_id(event, item)}"
        changes = _changes_from_value(item) or _changes_from_value(event)
        status = "completed" if method.endswith("/completed") else "in_progress"
        payload = self._new_payload(
            "file_change",
            {"status": status, "changes": changes, "origin": "codex_patch"},
        )
        return self._upsert_state(key, role="tool", kind="tool", title="File changes", raw_type=method, payload=payload, streaming=status == "in_progress")

    def _tool_call_item(self, event: dict[str, Any], method: str, item: dict[str, Any]) -> dict[str, Any]:
        key = f"tool:{_item_id(event, item)}"
        existing = self.items.get(key, {})
        previous = existing.get("payload") if isinstance(existing.get("payload"), dict) else {}
        tool = _tool_name(item)
        args = item.get("args") if "args" in item else item.get("input") if "input" in item else previous.get("args") or {}
        result_value = item.get("result") if "result" in item else item.get("output") if "output" in item else previous.get("result") or ""
        is_error = bool(item.get("is_error") or item.get("isError") or item.get("error"))
        status = "succeeded" if method.endswith("/completed") and not is_error else "failed" if is_error else _normalize_status(item.get("status"), "running")
        payload = self._new_payload(
            "tool_call",
            {
                "tool": tool,
                "call_id": _item_id(event, item),
                "server": str(item.get("server") or item.get("mcp_server") or item.get("mcpServer") or ""),
                "args": args,
                "status": status,
                "result": _payload_text(result_value),
                "is_error": is_error,
                "started_at": previous.get("started_at") or _now_iso(),
                "duration_ms": _safe_int(_nested_value(item, ("duration_ms", "durationMs"))) or _duration_ms(existing.get("_started_ts")),
            },
        )
        return self._upsert_state(key, role="tool", kind="tool", title=tool, raw_type=method, payload=payload, streaming=status == "running")

    def _web_search(self, value: dict[str, Any], method: str, item_id: str = "") -> dict[str, Any] | None:
        query = str(_nested_value(value, ("query", "search_query", "searchQuery", "q", "url")) or "").strip()
        if not query:
            query = _payload_text(value)
        if not query:
            return None
        key = f"web:{item_id or _item_id(value)}"
        payload = self._new_payload("web_search", {"query": query, "status": _normalize_status(value.get("status"), "running")})
        return self._upsert_state(key, role="tool", kind="tool", title="Web search", raw_type=method, payload=payload, streaming=payload["status"] == "running")

    def _plan_update(self, event: dict[str, Any], method: str, item: dict[str, Any]) -> dict[str, Any] | None:
        steps = _steps_from_value(item) or _steps_from_value(_params(event))
        text = _payload_text(item)
        if not steps and not text:
            return None
        payload = self._new_payload(
            "plan_update",
            {
                "steps": steps,
                "explanation": str(item.get("explanation") or _params(event).get("explanation") or text or ""),
                "source": "codex_plan",
            },
        )
        return self._upsert_state("plan:latest", role="assistant", kind="reasoning", title="Checklist", raw_type=method, payload=payload, streaming=True)

    def _usage(self, event: dict[str, Any], method: str) -> dict[str, Any] | None:
        usage = event.get("usage")
        if not isinstance(usage, dict):
            usage = _nested_value(event, ("usage",))
        if not isinstance(usage, dict):
            usage = _params(event)
        if not isinstance(usage, dict):
            return None
        input_tokens = _safe_int(_nested_value(usage, ("input_tokens", "inputTokens", "prompt_tokens", "promptTokens")))
        cached = _safe_int(_nested_value(usage, ("cached_input_tokens", "cachedInputTokens", "cache_read_input_tokens")))
        output_tokens = _safe_int(_nested_value(usage, ("output_tokens", "outputTokens", "completion_tokens", "completionTokens")))
        total = _safe_int(_nested_value(usage, ("total_tokens", "totalTokens")))
        if total is None and (input_tokens is not None or output_tokens is not None):
            total = (input_tokens or 0) + (output_tokens or 0)
        if total is None and input_tokens is None and output_tokens is None and "cost" not in json.dumps(usage, ensure_ascii=False).lower():
            return None
        payload = self._new_payload(
            "usage",
            {
                "input_tokens": input_tokens,
                "cached_input_tokens": cached,
                "output_tokens": output_tokens,
                "total_tokens": total,
                "cost_usd": _nested_value(event, ("total_cost_usd", "cost_usd", "costUsd")),
                "model": str(_nested_value(event, ("model",)) or ""),
                "duration_ms": _safe_int(_nested_value(event, ("duration_ms", "durationMs"))),
                "num_turns": _safe_int(_nested_value(event, ("num_turns", "numTurns"))),
            },
        )
        return self._upsert_state("usage:latest", role="tool", kind="tool", title="Usage", raw_type=method, payload=payload, streaming=False)

    def _error(self, event: dict[str, Any], method: str) -> dict[str, Any]:
        message = _payload_text(event.get("error") or event) or "Agent reported an error."
        payload = self._new_payload("error", {"message": message, "source": "agent", "code": str(_nested_value(event, ("code",)) or "")})
        return self._upsert_state(f"error:{_stable_suffix(message)}", role="tool", kind="error", title="Error", raw_type=method, payload=payload, streaming=False)


class CodexAppServerNormalizer(CodexExecNormalizer):
    def feed(self, line: str) -> list[dict[str, Any]]:
        event = _json_line(line)
        if not event:
            return []
        method = _event_name(event)
        if not method:
            return []
        if method in {"item/filechange/patchupdated", "item/file/change/patchupdated", "turn/diff/updated"}:
            params = _params(event)
            item_id = str(params.get("itemId") or params.get("item_id") or "patch")
            changes = _changes_from_value(params)
            payload = self._new_payload("file_change", {"status": "in_progress", "changes": changes, "origin": "codex_patch"})
            return [self._upsert_state(f"file:{item_id}", role="tool", kind="tool", title="File changes", raw_type=method, payload=payload, streaming=True)]
        if method in {"turn/plan/updated", "item/plan/delta"}:
            params = _params(event)
            payload = self._new_payload(
                "plan_update",
                {
                    "steps": _steps_from_value(params.get("plan") if isinstance(params.get("plan"), list) else params),
                    "explanation": str(params.get("explanation") or params.get("delta") or ""),
                    "source": "codex_plan",
                },
            )
            return [self._upsert_state("plan:latest", role="assistant", kind="reasoning", title="Checklist", raw_type=method, payload=payload, streaming=True)]
        if "approval" in method and "request" in method:
            params = _params(event)
            request_id = str(event.get("id") or params.get("requestId") or params.get("request_id") or _stable_suffix(params))
            kind = "command" if "command" in method else "file_change"
            request_payload: dict[str, Any]
            if kind == "command":
                request_payload = self._new_payload(
                    "command",
                    {
                        "command": _command_from_value(params),
                        "cwd": str(params.get("cwd") or ""),
                        "status": "running",
                        "exit_code": None,
                        "output": "",
                        "duration_ms": None,
                        "started_at": _now_iso(),
                    },
                )
            else:
                request_payload = self._new_payload("file_change", {"status": "in_progress", "changes": _changes_from_value(params), "origin": "codex_patch"})
            payload = self._new_payload(
                "approval",
                {
                    "approval_kind": kind,
                    "request": request_payload,
                    "decision": "",
                    "decided_by": "",
                    "resolved_at": "",
                },
            )
            return [
                self._upsert_state(
                    f"approval:{request_id}",
                    role="tool",
                    kind="tool",
                    title="Approval requested",
                    raw_type=method,
                    payload=payload,
                    streaming=True,
                )
            ]
        return super().feed(line)


class ClaudeStreamNormalizer(TraceNormalizer):
    def feed(self, line: str) -> list[dict[str, Any]]:
        event = _json_line(line)
        if not event:
            return []
        event_type = str(event.get("type") or "").strip()
        subtype = str(event.get("subtype") or "").strip()
        raw_type = event_type if not subtype else f"{event_type}.{subtype}"
        family = event_type.split(".", 1)[0].lower()
        if family == "assistant":
            return self._assistant_event(event, raw_type)
        if family == "user":
            return self._user_event(event, raw_type)
        if family == "result":
            return self._result_event(event, raw_type)
        if family == "system":
            return []
        if "error" in raw_type.lower():
            payload = self._new_payload("error", {"message": _payload_text(event), "source": "agent", "code": subtype})
            return [self._upsert_state(f"error:{_stable_suffix(payload['message'])}", role="tool", kind="error", title="Claude Code", raw_type=raw_type, payload=payload)]
        return []

    def _content_blocks(self, message: Any) -> list[dict[str, Any]]:
        if isinstance(message, dict):
            content = message.get("content")
        else:
            content = None
        if isinstance(content, dict):
            return [content]
        if isinstance(content, list):
            return [item for item in content if isinstance(item, dict)]
        return []

    def _assistant_event(self, event: dict[str, Any], raw_type: str) -> list[dict[str, Any]]:
        message = event.get("message") if isinstance(event.get("message"), dict) else event
        blocks = self._content_blocks(message)
        updates: list[dict[str, Any]] = []
        message_id = str(message.get("id") or event.get("message_id") or _stable_suffix(event)) if isinstance(message, dict) else _stable_suffix(event)
        for index, block in enumerate(blocks):
            block_type = str(block.get("type") or "").strip()
            if block_type == "text":
                text = str(block.get("text") or "").strip()
                if text:
                    updates.append(
                        self._upsert_state(
                            f"claude_text:{message_id}:{index}",
                            role="assistant",
                            kind="assistant",
                            title="Assistant",
                            raw_type=raw_type,
                            content=_cap_text(text, MAX_OUTPUT_CHARS),
                            streaming=False,
                        )
                    )
            elif block_type == "thinking":
                text = str(block.get("thinking") or block.get("text") or "").strip()
                if text:
                    updates.append(
                        self._upsert_state(
                            f"claude_reasoning:{message_id}:{index}",
                            role="assistant",
                            kind="reasoning",
                            title="Thinking summary",
                            raw_type=raw_type,
                            content=_cap_text(text, MAX_OUTPUT_CHARS),
                            streaming=False,
                        )
                    )
            elif block_type == "tool_use":
                update = self._tool_use(block, raw_type)
                if update:
                    updates.append(update)
        return updates

    def _tool_use(self, block: dict[str, Any], raw_type: str) -> dict[str, Any] | None:
        call_id = str(block.get("id") or block.get("tool_use_id") or _stable_suffix(block))
        name = str(block.get("name") or "tool").strip() or "tool"
        tool_input = block.get("input") if isinstance(block.get("input"), dict) else {}
        key = f"claude_tool:{call_id}"
        if name == "TodoWrite":
            steps = _steps_from_value(tool_input)
            payload = self._new_payload("plan_update", {"steps": steps, "explanation": "", "source": "todo_write"})
            return self._upsert_state(key, role="assistant", kind="reasoning", title="Checklist", raw_type=raw_type, payload=payload, streaming=True)
        if name == "Bash":
            payload = self._new_payload(
                "command",
                {
                    "command": _command_from_value(tool_input),
                    "cwd": str(tool_input.get("cwd") or ""),
                    "status": "running",
                    "exit_code": None,
                    "output": "",
                    "duration_ms": None,
                    "started_at": _now_iso(),
                },
            )
            state = self.items.setdefault(key, {"_started_ts": time.time()})
            state["call_id"] = call_id
            return self._upsert_state(key, role="command", kind="command", title="Command", raw_type=raw_type, payload=payload, streaming=True)
        if name in {"Edit", "Write", "MultiEdit", "NotebookEdit"}:
            changes = self._claude_edit_changes(name, tool_input)
            payload = self._new_payload("file_change", {"status": "in_progress", "changes": changes, "origin": "synthesized"})
            state = self.items.setdefault(key, {"_started_ts": time.time()})
            state["call_id"] = call_id
            return self._upsert_state(key, role="tool", kind="tool", title="File changes", raw_type=raw_type, payload=payload, streaming=True)
        if name in {"WebSearch", "WebFetch"}:
            query = str(tool_input.get("query") or tool_input.get("url") or "").strip()
            payload = self._new_payload("web_search", {"query": query, "status": "running"})
            state = self.items.setdefault(key, {"_started_ts": time.time()})
            state["call_id"] = call_id
            return self._upsert_state(key, role="tool", kind="tool", title="Web search", raw_type=raw_type, payload=payload, streaming=True)
        payload = self._new_payload(
            "tool_call",
            {
                "tool": name,
                "call_id": call_id,
                "server": "",
                "args": tool_input,
                "status": "running",
                "result": "",
                "is_error": False,
                "started_at": _now_iso(),
                "duration_ms": None,
            },
        )
        state = self.items.setdefault(key, {"_started_ts": time.time()})
        state["call_id"] = call_id
        return self._upsert_state(key, role="tool", kind="tool", title=name, raw_type=raw_type, payload=payload, streaming=True)

    def _claude_edit_changes(self, name: str, tool_input: dict[str, Any]) -> list[dict[str, Any]]:
        path = str(tool_input.get("file_path") or tool_input.get("path") or tool_input.get("notebook_path") or "").strip()
        if not path:
            return []
        if name == "Write":
            old_text = self.read_file(path)
            new_text = str(tool_input.get("content") or "")
            change = _unified_diff(old_text or "", new_text, path)
            change["action"] = "update" if old_text is not None else "add"
            return [change]
        if name == "Edit":
            old_text = str(tool_input.get("old_string") or "")
            new_text = str(tool_input.get("new_string") or "")
            return [_unified_diff(old_text, new_text, path, from_label=f"old/{path}")]
        if name == "MultiEdit":
            edits = tool_input.get("edits") if isinstance(tool_input.get("edits"), list) else []
            hunks = []
            plus = minus = 0
            truncated = False
            for index, edit in enumerate(edits):
                if not isinstance(edit, dict):
                    continue
                change = _unified_diff(str(edit.get("old_string") or ""), str(edit.get("new_string") or ""), path, from_label=f"old/{path}#{index + 1}")
                hunks.append(change.get("diff") or "")
                plus += int(change.get("plus_lines") or 0)
                minus += int(change.get("minus_lines") or 0)
                truncated = truncated or bool(change.get("truncated"))
            diff, cap_truncated, _p, _m = _cap_diff("\n".join(part for part in hunks if part))
            return [{"path": path, "action": "update", "diff": diff, "truncated": truncated or cap_truncated, "plus_lines": plus, "minus_lines": minus}]
        return [_change_from_path(path, "update", "")]

    def _user_event(self, event: dict[str, Any], raw_type: str) -> list[dict[str, Any]]:
        message = event.get("message") if isinstance(event.get("message"), dict) else event
        updates: list[dict[str, Any]] = []
        for block in self._content_blocks(message):
            if str(block.get("type") or "") != "tool_result":
                continue
            call_id = str(block.get("tool_use_id") or block.get("id") or "").strip()
            key = f"claude_tool:{call_id}" if call_id else f"claude_tool_result:{_stable_suffix(block)}"
            state = self.items.get(key)
            content = _payload_text(block.get("content") if "content" in block else block)
            is_error = bool(block.get("is_error") or block.get("isError"))
            if state and isinstance(state.get("payload"), dict):
                payload = dict(state["payload"])
                ptype = payload.get("type")
                if ptype == "command":
                    payload["status"] = "failed" if is_error else "completed"
                    payload["output"] = content
                    payload["duration_ms"] = _duration_ms(state.get("_started_ts"))
                elif ptype == "file_change":
                    payload["status"] = "failed" if is_error else "completed"
                elif ptype == "web_search":
                    payload["status"] = "failed" if is_error else "completed"
                elif ptype == "tool_call":
                    payload["status"] = "failed" if is_error else "succeeded"
                    payload["result"] = content
                    payload["is_error"] = is_error
                    payload["duration_ms"] = _duration_ms(state.get("_started_ts"))
                state["payload"] = payload
                state["streaming"] = False
                state["raw_type"] = raw_type
                state["content"] = self._content_for_payload(payload)
                updates.append(self._state_update(state))
            else:
                payload = self._new_payload(
                    "tool_call",
                    {
                        "tool": "tool_result",
                        "call_id": call_id or _stable_suffix(block),
                        "server": "",
                        "args": {},
                        "status": "failed" if is_error else "succeeded",
                        "result": content,
                        "is_error": is_error,
                        "started_at": "",
                        "duration_ms": None,
                    },
                )
                updates.append(self._upsert_state(key, role="tool", kind="error" if is_error else "tool", title="Tool result", raw_type=raw_type, payload=payload))
        return updates

    def _result_event(self, event: dict[str, Any], raw_type: str) -> list[dict[str, Any]]:
        updates: list[dict[str, Any]] = []
        result_text = _payload_text(event.get("result") or event.get("message") or event.get("content") or event.get("error") or "")
        is_error = bool(event.get("is_error")) or "error" in raw_type.lower()
        if result_text:
            updates.append(
                self._upsert_state(
                    "claude_result:latest",
                    role="tool" if is_error else "final",
                    kind="error" if is_error else "final",
                    title="Error" if is_error else "Final",
                    raw_type=raw_type,
                    content=_cap_text(result_text, MAX_OUTPUT_CHARS),
                    streaming=False,
                )
            )
        usage = event.get("usage") if isinstance(event.get("usage"), dict) else {}
        input_tokens = _safe_int(_nested_value(usage, ("input_tokens", "inputTokens")))
        output_tokens = _safe_int(_nested_value(usage, ("output_tokens", "outputTokens")))
        total = _safe_int(_nested_value(usage, ("total_tokens", "totalTokens")))
        if total is None and (input_tokens is not None or output_tokens is not None):
            total = (input_tokens or 0) + (output_tokens or 0)
        if usage or event.get("total_cost_usd") is not None or event.get("duration_ms") is not None:
            payload = self._new_payload(
                "usage",
                {
                    "input_tokens": input_tokens,
                    "cached_input_tokens": _safe_int(_nested_value(usage, ("cache_read_input_tokens", "cached_input_tokens", "cachedInputTokens"))),
                    "output_tokens": output_tokens,
                    "total_tokens": total,
                    "cost_usd": event.get("total_cost_usd") if event.get("total_cost_usd") is not None else event.get("cost_usd"),
                    "model": str(event.get("model") or ""),
                    "duration_ms": _safe_int(event.get("duration_ms")),
                    "num_turns": _safe_int(event.get("num_turns")),
                },
            )
            updates.append(self._upsert_state("usage:latest", role="tool", kind="tool", title="Usage", raw_type=raw_type, payload=payload))
        return updates


def make_trace_normalizer(backend: Any, flavor: Any = "", read_file: Callable[[str], str | None] | None = None) -> TraceNormalizer:
    backend_name = str(backend or "").strip().lower()
    flavor_name = str(flavor or "").strip().lower()
    if backend_name == "claude":
        return ClaudeStreamNormalizer(read_file=read_file)
    if "app" in flavor_name or "server" in flavor_name or "plan" in flavor_name:
        return CodexAppServerNormalizer(read_file=read_file)
    return CodexExecNormalizer(read_file=read_file)

