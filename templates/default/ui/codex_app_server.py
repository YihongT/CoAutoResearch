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


class CodexAppServerClient:
    """Minimal request/response helper for app-server stdio integrations."""

    def __init__(
        self,
        proc: subprocess.Popen[str],
        on_notification: Callable[[dict[str, Any]], None] | None = None,
        on_request: Callable[[str, dict[str, Any], int], dict[str, Any] | None] | None = None,
    ) -> None:
        self.proc = proc
        self.on_notification = on_notification or (lambda _event: None)
        self.on_request = on_request or (lambda _method, _params, _request_id: {"decision": "decline"})
        self.next_request_id = 1
        self.responses: dict[int, dict[str, Any]] = {}

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
        if isinstance(request_id, int) and method:
            result = self.on_request(method, params, request_id)
            json_rpc_write(self.proc, {"jsonrpc": "2.0", "id": request_id, "result": result or {}})
            return
        if isinstance(request_id, int):
            self.responses[request_id] = event
            return
        self.on_notification(event)

