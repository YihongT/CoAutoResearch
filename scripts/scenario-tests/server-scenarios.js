#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "coauto-scenarios-"));

const python = process.env.PYTHON || "python3";
const code = String.raw`
import importlib.util, json, os, pathlib, shutil, tempfile, time

server_path = pathlib.Path(os.environ["COAUTO_SERVER_PY"])
spec = importlib.util.spec_from_file_location("coauto_server_scenarios", server_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

root = pathlib.Path(os.environ["COAUTO_SCENARIO_TMP"])
review_files = list(module.REQUIRED_REVIEWER_FILES)

def use_project(name):
    project = root / name
    if project.exists():
        shutil.rmtree(project)
    project.mkdir(parents=True)
    (project / "PROJECT.md").write_text("# Project Definition\n\n## One-Sentence Goal\n\nOriginal goal.\n", encoding="utf-8")
    (project / "research_trajectory").mkdir()
    (project / "research_trajectory" / "STATE.md").write_text("# Research State\n", encoding="utf-8")
    (project / "research_trajectory" / "CURRENT_FINDINGS.md").write_text("# Current Findings\n", encoding="utf-8")
    (project / "research_trajectory" / "HUMAN_TASKS.md").write_text("# Human Tasks\n", encoding="utf-8")
    (project / "manuscript").mkdir()
    (project / "manuscript" / "BLUEPRINT.md").write_text("# Manuscript Blueprint\n\nStatus: pre-results stub.\n", encoding="utf-8")
    (project / "manuscript" / "PAPER_PLAN.md").write_text("# Paper Plan\n\n## Blocking Missing Evidence\n\n- CP1 missing data\n", encoding="utf-8")
    module._CONTEXT.project = module.ProjectContext(project)
    return project

def closed_trial(project, index, empirical):
    trial = project / "research_trajectory" / "trials" / f"{index:06d}_scenario"
    (trial / "reviews").mkdir(parents=True)
    (trial / "PLAN.md").write_text("# Plan\n", encoding="utf-8")
    (trial / "REPORT.md").write_text(f"# Report\n\nEmpirical progress: {empirical}\n", encoding="utf-8")
    for file in review_files:
        (trial / "reviews" / file).write_text("Reviewer: fixture\nDecision: continue\nGate impact: continue\n", encoding="utf-8")

project = use_project("stall")
(project / "research_trajectory" / "STATE.md").write_text("""# Research State

## Critical Path
| ID | Dependency | Status | Evidence / artifact | Owner |
|---|---|---|---|---|
| CP1 | public data | open | none | agent |
Current bottleneck: CP1 - public data
Consecutive non-empirical trials: 2

## Autoresearch Goal Gate
Status: continue
Critical path: CP1 - public data; empirical progress this trial: no
""", encoding="utf-8")
closed_trial(project, 1, "no")
assert module.recent_non_empirical_stall()["stalled"] is False
closed_trial(project, 2, "no")
assert module.recent_non_empirical_stall()["stalled"] is True

project = use_project("stall_conversion_excluded")
(project / "research_trajectory" / "STATE.md").write_text("""# Research State

## Critical Path
| ID | Dependency | Status | Evidence / artifact | Owner |
|---|---|---|---|---|
| CP1 | public data | open | none | agent |
Current bottleneck: CP1 - public data
Consecutive non-empirical trials: 1

## Autoresearch Goal Gate
Status: continue
Critical path: CP1 - public data; empirical progress this trial: no
""", encoding="utf-8")
closed_trial(project, 1, "no")
conversion = project / "research_trajectory" / "trials" / "000002_project_conversion"
(conversion / "reviews").mkdir(parents=True)
(conversion / "PLAN.md").write_text("# Conversion plan\n", encoding="utf-8")
(conversion / "REPORT.md").write_text("# Conversion report\n\nEmpirical progress: no\n", encoding="utf-8")
for file in review_files:
    (conversion / "reviews" / file).write_text("Reviewer: fixture\nDecision: continue\nGate impact: continue\n", encoding="utf-8")
assert module.recent_non_empirical_stall()["stalled"] is False
closed_trial(project, 3, "no")
assert module.recent_non_empirical_stall()["stalled"] is True

project = use_project("ongoing")
ongoing = project / "resources" / "ongoing_work"
ongoing.mkdir(parents=True)
(ongoing / "results.csv").write_text("metric,value\naccuracy,0.9\n", encoding="utf-8")
assert module.ongoing_work_requires_conversion() is True
time.sleep(1.1)
initial_conversion = project / "research_trajectory" / "trials" / "000000_project_conversion"
initial_conversion.mkdir(parents=True)
(initial_conversion / "REPORT.md").write_text("# Conversion report\n\n## Ongoing Work Coverage\n\nCovered initial results.csv.\n", encoding="utf-8")
assert module.ongoing_work_requires_conversion() is False
time.sleep(1.1)
(ongoing / "new_results.csv").write_text("metric,value\nf1,0.8\n", encoding="utf-8")
pending = module.conversion_pending_status()
assert pending["pending"] is True and pending["newest_uncovered_path"].endswith("new_results.csv"), pending
time.sleep(1.1)
mid_conversion = project / "research_trajectory" / "trials" / "000087_project_conversion"
mid_conversion.mkdir(parents=True)
(mid_conversion / "REPORT.md").write_text("# Conversion report\n\n## Ongoing Work Coverage\n\nCovered new_results.csv.\n", encoding="utf-8")
assert module.ongoing_work_requires_conversion() is False

project = use_project("legacy_conversion")
ongoing = project / "resources" / "ongoing_work"
ongoing.mkdir(parents=True)
(ongoing / "analysis.py").write_text("print('ok')\n", encoding="utf-8")
time.sleep(1.1)
legacy_conversion = project / "research_trajectory" / "trials" / "project_conversion"
legacy_conversion.mkdir(parents=True)
(legacy_conversion / "REPORT.md").write_text("# Conversion report\n", encoding="utf-8")
assert module.ongoing_work_requires_conversion() is False

project = use_project("export")
readiness = module.paper_pack_readiness()
assert readiness["ready"] is False, readiness
try:
    module.start_export({"kind": "blueprint", "confirmed": True})
    raise AssertionError("Paper-Writing Pack export should be blocked")
except ValueError as exc:
    assert "Paper-Writing Pack is blocked" in str(exc)
status_estimate = module.export_estimate("research_status")
assert status_estimate["filename"].endswith("-research-status-pack.zip"), status_estimate

project = use_project("scope")
state = module.record_project_scope_hash_at_launch()
assert state.get("project_scope_hash")
(project / "PROJECT.md").write_text("# Project Definition\n\n## One-Sentence Goal\n\nChanged goal.\n", encoding="utf-8")
warning = module.scope_drift_warning()
assert warning.get("warning") is True, warning
interventions = project / "research_trajectory" / "human_interventions" / "pending"
interventions.mkdir(parents=True)
(interventions / "I0001.md").write_text("# Ordinary intervention\n", encoding="utf-8")
warning = module.scope_drift_warning()
assert warning.get("warning") is True, warning
(interventions / "SCOPE_CHANGE_0001.md").write_text("# Scope change proposal\n", encoding="utf-8")
warning = module.scope_drift_warning()
assert warning.get("warning") is False and warning.get("scope_change_files"), warning

print(json.dumps({"ok": True, "scenarios": ["stall", "ongoing", "export", "scope"]}))
`;

try {
  const result = spawnSync(python, ["-c", code], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_SCENARIO_TMP: tmp
    }
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0 || (result.error && !String(result.stdout || "").includes('"ok": true'))) {
    throw result.error || new Error(`Scenario tests failed with status ${result.status}`);
  }
} finally {
  await fsp.rm(tmp, { recursive: true, force: true });
}
