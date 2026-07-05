#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const fixtureDir = path.join(repoRoot, "scripts", "fixtures", "agent-trace");
const uiDir = path.join(repoRoot, "templates", "default", "ui");

function runNormalizer({ backend, flavor = "exec", fixture = "", lines = [], returncode = 0, resolveApproval = false }) {
  const payload = JSON.stringify({ backend, flavor, fixture, lines, returncode, resolveApproval });
  const code = `
import json, pathlib, sys
import os
payload = json.loads(os.environ["AGENT_TRACE_TEST_PAYLOAD"])
sys.path.insert(0, ${JSON.stringify(uiDir)})
from agent_trace import make_trace_normalizer
files = {"src/app.py": "old\\n"}
def read_file(path):
    return files.get(str(path))
normalizer = make_trace_normalizer(payload["backend"], payload.get("flavor") or "exec", read_file=read_file)
updates = []
lines = list(payload.get("lines") or [])
fixture = payload.get("fixture") or ""
if fixture:
    lines.extend(pathlib.Path(fixture).read_text(encoding="utf-8").splitlines())
for line in lines:
    updates.extend(normalizer.feed(line))
if payload.get("resolveApproval"):
    resolved = normalizer.resolve_approval("41", "declined", "auto_policy")
    if resolved:
        updates.append(resolved)
updates.extend(normalizer.finish(payload.get("returncode")))
print(json.dumps(updates, ensure_ascii=False))
`;
  const child = spawnSync("python3", ["-c", code], {
    cwd: repoRoot,
    env: { ...process.env, AGENT_TRACE_TEST_PAYLOAD: payload },
    encoding: "utf8",
  });
  if (child.status !== 0) {
    throw new Error(`python normalizer failed\nSTDOUT:\n${child.stdout}\nSTDERR:\n${child.stderr}`);
  }
  return JSON.parse(child.stdout || "[]");
}

function payloads(updates, type) {
  return updates.map((update) => update.payload).filter((payload) => payload?.type === type);
}

for (const name of [
  "codex-exec-run.jsonl",
  "codex-app-server-approvals.jsonl",
  "claude-stream-run.jsonl",
  "claude-stream-error.jsonl",
]) {
  assert.equal(fs.existsSync(path.join(fixtureDir, name)), true, `${name} fixture exists`);
}

{
  const updates = runNormalizer({ backend: "codex", fixture: path.join(fixtureDir, "codex-exec-run.jsonl") });
  const commands = payloads(updates, "command");
  assert.ok(commands.length >= 2, "codex command emits start/delta/completed replacements");
  assert.equal(commands.at(-1).status, "completed");
  assert.equal(commands.at(-1).exit_code, 0);
  assert.match(commands.at(-1).output, /test_a passed/);
  assert.equal(new Set(updates.filter((u) => u.payload?.type === "command").map((u) => u.entry_key)).size, 1, "command entry key is stable");
  assert.equal(payloads(updates, "file_change").at(-1).changes[0].path, "src/app.py");
  assert.equal(payloads(updates, "plan_update").at(-1).steps.length, 2);
  assert.equal(payloads(updates, "usage").at(-1).total_tokens, 15);
}

{
  const updates = runNormalizer({
    backend: "codex",
    flavor: "app-server",
    fixture: path.join(fixtureDir, "codex-app-server-approvals.jsonl"),
    resolveApproval: true,
  });
  const approvals = payloads(updates, "approval");
  assert.equal(approvals[0].decision, "");
  assert.equal(approvals.at(-1).decision, "declined");
  assert.equal(payloads(updates, "plan_update").at(-1).steps[0].status, "completed");
}

{
  const updates = runNormalizer({ backend: "claude", fixture: path.join(fixtureDir, "claude-stream-run.jsonl") });
  const command = payloads(updates, "command").at(-1);
  assert.equal(command.status, "completed");
  assert.match(command.output, /2 passed/);
  const fileChange = payloads(updates, "file_change").at(-1);
  assert.equal(fileChange.status, "completed");
  assert.match(fileChange.changes[0].diff, /-old/);
  assert.match(fileChange.changes[0].diff, /\+new/);
  assert.equal(payloads(updates, "plan_update").at(-1).source, "todo_write");
  assert.equal(payloads(updates, "usage").at(-1).cost_usd, 0.012);
  assert.ok(updates.some((update) => update.kind === "final" && /Done/.test(update.content)), "Claude result final is preserved");
}

{
  const updates = runNormalizer({ backend: "claude", fixture: path.join(fixtureDir, "claude-stream-error.jsonl"), returncode: 1 });
  assert.equal(payloads(updates, "command").at(-1).status, "failed");
  assert.ok(updates.some((update) => update.kind === "error" && /Command failed/.test(update.content)), "Claude error result is preserved");
}

{
  const updates = runNormalizer({
    backend: "codex",
    lines: ['{"type":"item.started","item":{"id":"cmd_finish","type":"command_execution","command":"sleep 10"}}'],
    returncode: 1,
  });
  assert.equal(payloads(updates, "command").at(-1).status, "failed");
  assert.equal(payloads(updates, "command").at(-1).exit_code, 1);
}

console.log("agent-trace tests passed");
