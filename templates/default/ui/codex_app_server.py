#!/usr/bin/env python3
"""Small stdlib JSON-RPC helpers for Codex app-server."""

from __future__ import annotations

import json
import subprocess
from typing import Any, Callable


def json_rpc_write(proc: subprocess.Popen[str], message: dict[str, Any]) -> None:
    if proc.stdin is None:
        raise RuntimeError("Agent app-server stdin is closed.")
    proc.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
    proc.stdin.flush()


def extract_nested_id(payload: Any, names: tuple[str, ...]) -> str:
    if isinstance(payload, dict):
        for name in names:
            value = payload.get(name)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key in ("thread", "turn", "result", "params", "item"):
            nested = payload.get(key)
            found = extract_nested_id(nested, names)
            if found:
                return found
        for nested in payload.values():
            found = extract_nested_id(nested, names)
            if found:
                return found
    if isinstance(payload, list):
        for item in payload:
            found = extract_nested_id(item, names)
            if found:
                return found
    return ""


def event_parts(event: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    method = str(event.get("method") or event.get("type") or event.get("event") or "").strip()
    params = event.get("params") if isinstance(event.get("params"), dict) else event
    return method, params if isinstance(params, dict) else {}


class CodexPlanResult:
    """Accept authoritative plan output only after a successful turn."""

    def __init__(self) -> None:
        self.plan_text = ""
        self.final_answer = ""
        self.status = ""
        self.error = ""

    def feed(self, method: str, params: dict[str, Any]) -> None:
        if method in {"item/completed", "item.completed"}:
            item = params.get("item") or {}
            if item.get("type") == "plan":
                self.plan_text = str(item.get("text") or "").strip()
            elif item.get("type") == "agentMessage" and item.get("phase") == "final_answer":
                self.final_answer = str(item.get("text") or "").strip()
        elif method in {"turn/completed", "turn.completed"}:
            turn = params.get("turn") or {}
            self.status = str(turn.get("status") or "")
            self.error = str((turn.get("error") or {}).get("message") or "")

    def text(self) -> str:
        return (self.plan_text or self.final_answer) if self.status == "completed" and not self.error else ""


class CodexAppServerClient:
    """Minimal request/response helper for app-server stdio integrations."""

    def __init__(
        self,
        proc: subprocess.Popen[str],
        on_notification: Callable[[dict[str, Any]], None] | None = None,
        on_request: Callable[[str, dict[str, Any], Any], dict[str, Any] | None] | None = None,
    ) -> None:
        self.proc = proc
        self.on_notification = on_notification or (lambda _event: None)
        self.on_request = on_request or (lambda _method, _params, _request_id: None)
        self.next_request_id = 1
        self.responses: dict[Any, dict[str, Any]] = {}

    def request(self, method: str, params: dict[str, Any] | None = None) -> int:
        request_id = self.next_request_id
        self.next_request_id += 1
        json_rpc_write(self.proc, {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}})
        return request_id

    def notify_initialized(self) -> None:
        json_rpc_write(self.proc, {"jsonrpc": "2.0", "method": "initialized", "params": {}})

    def handle_event(self, event: dict[str, Any]) -> None:
        request_id = event.get("id")
        method, params = event_parts(event)
        if request_id is not None and method:
            result = self.on_request(method, params, request_id)
            if isinstance(result, dict):
                json_rpc_write(self.proc, {"jsonrpc": "2.0", "id": request_id, "result": result})
            else:
                json_rpc_write(
                    self.proc,
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {"code": -32601, "message": f"CoAutoResearch does not handle {method} requests."},
                    },
                )
            return
        if request_id is not None:
            self.responses[request_id] = event
            return
        self.on_notification(event)
