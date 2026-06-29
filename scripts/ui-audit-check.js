#!/usr/bin/env node

import fsp from "node:fs/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const templateRoot = path.join(root, "templates", "default");
const serverPath = path.join(templateRoot, "ui", "server.py");
const outDir = path.join(root, "tmp", "ui-audit-screenshots");
const rmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 150 };

const themes = ["atelier-ivory", "atelier-nocturne"];
const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
  { name: "wide", width: 2048, height: 1224 },
];

const reviewerOutputs = [
  ["Plan reviewer", "PLAN_REVIEW.md", "plan", "instructions/reviewers/PLAN_REVIEWER.md"],
  ["Process reviewer", "PROCESS_REVIEW.md", "process", "instructions/reviewers/PROCESS_REVIEWER.md"],
  ["Evidence reviewer", "EVIDENCE_REVIEW.md", "evidence", "instructions/reviewers/EVIDENCE_REVIEWER.md"],
  ["Venue fit reviewer", "VENUE_FIT_REVIEW.md", "venue", "instructions/reviewers/VENUE_FIT_REVIEWER.md"],
  ["Manuscript reviewer", "MANUSCRIPT_REVIEW.md", "manuscript", "instructions/reviewers/MANUSCRIPT_REVIEWER.md"],
  ["Figure/table reviewer", "FIGURE_TABLE_REVIEW.md", "figure-table", "instructions/reviewers/FIGURE_TABLE_REVIEWER.md"],
  ["Reference reviewer", "REFERENCE_REVIEW.md", "reference", "instructions/reviewers/REFERENCE_REVIEWER.md"],
  ["Final gate reviewer", "FINAL_GATE_REVIEW.md", "final-gate", "instructions/reviewers/FINAL_GATE_REVIEWER.md"],
];

const baseScenarios = [
  { name: "chat", path: "/?view=chat", kind: "chat" },
  { name: "workspace", path: "/?view=workspace", kind: "material" },
  { name: "resources", path: "/?view=resources", kind: "material" },
  { name: "trials", path: "/?view=trials", kind: "material" },
  { name: "reviews", path: "/?view=reviews", kind: "material" },
  { name: "manuscript", path: "/?view=manuscript", kind: "material", requireManuscriptCentering: true },
  {
    name: "settings-general",
    path: "/?view=chat",
    kind: "dialog",
    action: "await openSettingsDialog();",
  },
  {
    name: "settings-api",
    path: "/?view=chat",
    kind: "dialog",
    action: "await openSettingsDialog(); document.querySelector('[data-settings-tab=\"api\"]')?.click();",
  },
  {
    name: "settings-agent",
    path: "/?view=chat",
    kind: "dialog",
    action: "await openSettingsDialog(); document.querySelector('[data-settings-tab=\"codex\"]')?.click();",
  },
  {
    name: "launch-dialog",
    path: "/?view=chat",
    kind: "dialog",
    action: "document.querySelector('#launch-dialog')?.showModal();",
  },
  {
    name: "attachment-menu",
    path: "/?view=chat",
    kind: "popover",
    action: "document.querySelector('#composer-attach-button')?.click();",
    requireAttachmentMenu: true,
  },
  {
    name: "activity-panel",
    path: "/?view=chat",
    kind: "activity",
    requireActivityPanel: true,
    action: `
      const now = Date.now();
      const iso = (offset) => new Date(now + offset).toISOString();
      appState.research_session = {
        id: 'audit-activity',
        session_id: 'audit-activity-session',
        status: 'running',
        mode: 'chat',
        backend: 'codex',
        started_at: iso(-207000),
        active_run: {
          running: true,
          mode: 'chat',
          run_id: 'audit-activity',
          started_at: iso(-207000),
          trial_iteration: null,
          trial_label: '',
          status_label: 'Codex is working'
        },
        transcript: [
          { id: 'u1', role: 'user', kind: 'user', raw_type: 'ui.chat', content: 'Export the manuscript PDF and verify the result.', created_at: iso(-207000) },
          { id: 'r1', role: 'assistant', kind: 'reasoning', raw_type: 'reasoning.summary', content: 'I need to verify the PDF metadata, page count, and rendered output before completing the response.', created_at: iso(-190000) },
          { id: 'a1', role: 'assistant', kind: 'assistant', raw_type: 'item.completed', content: 'Checking the exported PDF metadata and page count.', created_at: iso(-170000) },
          { id: 'a2', role: 'assistant', kind: 'assistant', raw_type: 'item.completed', content: 'Reviewing the final page preview for obvious layout issues.', created_at: iso(-150000) },
          { id: 'c1', role: 'command', kind: 'command', raw_type: 'process.started', content: 'python scripts/verify_pdf.py outputs/Reviewer_Report.pdf', created_at: iso(-130000) },
          { id: 'a3', role: 'assistant', kind: 'assistant', raw_type: 'item.completed', content: 'The PDF has nine pages and is not encrypted.', created_at: iso(-110000) },
          { id: 'c2', role: 'command', kind: 'command', raw_type: 'process.started', content: 'python scripts/render_pdf_preview.py outputs/Reviewer_Report.pdf --page 9', created_at: iso(-90000) },
          { id: 'a4', role: 'assistant', kind: 'assistant', raw_type: 'item.completed', content: 'The final page preview is readable and framed correctly.', created_at: iso(-70000) },
          { id: 'a5', role: 'assistant', kind: 'assistant', raw_type: 'item.completed', content: 'Preparing a concise handoff with the verified file path.', created_at: iso(-50000) }
        ]
      };
      localMessages.splice(0);
      framingReplyPending = true;
      framingPendingSince = now - 207000;
      pendingFramingUserMessageId = 'u1';
      renderFramingConversation();
      const activityButton = document.querySelector('[data-activity-open]');
      if (!activityButton) throw new Error('Activity button missing');
      activityButton.click();
    `,
  },
  {
    name: "resource-browser",
    path: "/?view=resources",
    kind: "dialog",
    action: "showResourceBrowser();",
  },
  {
    name: "large-import-dialog",
    path: "/?view=resources",
    kind: "dialog",
    action: `
      document.querySelector('#large-import-file-name').textContent = 'raw_sensor_dump_extremely_long_filename_that_should_not_break_layout.csv';
      document.querySelector('#large-import-file-size').textContent = '72 MB';
      document.querySelector('#large-import-destination').textContent = 'resources/data_sources/';
      document.querySelector('#large-import-dialog')?.showModal();
    `,
  },
  {
    name: "file-viewer",
    path: "/?view=manuscript",
    kind: "dialog",
    action: "await openInlineFullscreen('manuscript/BLUEPRINT.md');",
  },
  {
    name: "resume-trial-dialog",
    path: "/?view=trials",
    kind: "dialog",
    action: `
      document.querySelector('#resume-trial-title').textContent = 'Continue from Trial 1?';
      document.querySelector('#resume-trial-summary').innerHTML = '<div><strong>Trial 1</strong><p>Checkpoint available. Later active trials will be archived.</p></div>';
      const warning = document.querySelector('#resume-trial-warning');
      if (warning) { warning.hidden = false; warning.textContent = 'This checks the fork confirmation layout with longer explanatory copy.'; }
      document.querySelector('#resume-trial-dialog')?.showModal();
    `,
  },
  {
    name: "restart-dialog",
    path: "/?view=trials",
    kind: "dialog",
    action: "document.querySelector('#restart-autoresearch-dialog')?.showModal();",
  },
  {
    name: "export-confirm-dialog",
    path: "/?view=manuscript",
    kind: "dialog",
    action: `
      document.querySelector('#export-confirm-summary').innerHTML = '<div class=\"export-confirm-grid\"><div><strong>94 MB</strong><span>Estimated bundle</span></div><div><strong>3</strong><span>Large files</span></div></div><details open><summary>Included files</summary><p>manuscript/BLUEPRINT.md, resources/data_sources/raw_sensor_dump.csv</p></details>';
      document.querySelector('#export-confirm-dialog')?.showModal();
    `,
  },
  {
    name: "agent-setup-dialog",
    path: "/?view=chat",
    kind: "dialog",
    action: `
      document.querySelector('#agent-setup-grid').innerHTML = '<section class=\"agent-setup-card\"><div class=\"agent-setup-card-head\"><strong>Codex</strong><span class=\"agent-setup-card-status\" data-state=\"missing\">Missing</span></div><p>Install Codex CLI and run codex login.</p><pre>npm install -g @openai/codex</pre></section><section class=\"agent-setup-card\"><div class=\"agent-setup-card-head\"><strong>Claude Code</strong><span class=\"agent-setup-card-status\" data-state=\"ready\">Ready</span></div><p>Claude Code is authenticated for this fixture.</p></section>';
      document.querySelector('#agent-setup-dialog')?.showModal();
    `,
  },
];

const multiProjectScenarios = [
  { name: "multi-project-chat", path: "/?view=chat", kind: "chat" },
  {
    name: "project-create-dialog",
    path: "/?view=chat",
    kind: "dialog",
    action: "openProjectCreateDialog();",
  },
  {
    name: "project-rename-dialog",
    path: "/?view=chat",
    kind: "dialog",
    action: `
      pendingRenameProject = appState?.projects?.find((project) => project.id === activeProjectId) || appState?.projects?.[0] || null;
      document.querySelector('#project-rename-name').value = pendingRenameProject?.display_name || 'perceived safety';
      document.querySelector('#project-rename-dialog')?.showModal();
    `,
  },
  {
    name: "project-delete-dialog",
    path: "/?view=chat",
    kind: "dialog",
    action: `
      pendingDeleteProject = appState?.projects?.find((project) => project.id === activeProjectId) || appState?.projects?.[0] || null;
      document.querySelector('#project-delete-name').textContent = pendingDeleteProject?.display_name || 'perceived safety';
      document.querySelector('#project-delete-dialog')?.showModal();
    `,
  },
];

const emptyProjectScenarios = [
  { name: "empty-dashboard", path: "/?view=chat", kind: "empty" },
  {
    name: "empty-project-create-dialog",
    path: "/?view=chat",
    kind: "dialog",
    action: "openProjectCreateDialog();",
  },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slug(value) {
  return String(value).replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "shot";
}

function findChrome() {
  const explicit = process.env.CHROME_BIN || process.env.CHROME || "";
  const candidates = [
    explicit,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "msedge",
    "chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.status === 0) return candidate;
  }
  throw new Error("Could not find Chrome/Chromium for UI audit screenshots. Set CHROME_BIN to a Chrome executable.");
}

function findPython() {
  const candidates = [
    { command: process.env.COAUTO_PYTHON || "", args: [] },
    { command: "python3", args: [] },
    { command: "python", args: [] },
    { command: "py", args: ["-3"] },
  ].filter((candidate) => candidate.command);
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  throw new Error("No Python executable found for the UI audit server.");
}

function tryReservePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function freePort() {
  for (let port = 33000; port < 36000; port += 1) {
    const server = await tryReservePort(port);
    if (!server) continue;
    await closeServer(server);
    return port;
  }
  throw new Error("Could not find a free localhost port for the UI audit.");
}

function chromeArgs({ width, height, userDataDir }) {
  return [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-features=CalculateNativeWinOcclusion",
    "--run-all-compositor-stages-before-draw",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    "about:blank",
  ];
}

function waitForDevToolsUrl(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for Chrome DevTools URL.\n${stderr}`)), timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready, code ${code ?? ""}${signal ? ` signal ${signal}` : ""}.\n${stderr}`));
    });
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (event) => reject(event.error || new Error("Chrome DevTools WebSocket failed")));
      this.ws.addEventListener("message", (event) => this.handleMessage(event.data));
    });
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message || "CDP error"} ${message.error.data || ""}`.trim()));
      else resolve(message.result || {});
      return;
    }
    const listeners = this.listeners.get(message.method);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(message);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitFor(method, predicate = () => true, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        const listeners = this.listeners.get(method);
        if (listeners) listeners.delete(listener);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for CDP event ${method}`));
      }, timeoutMs);
      const listener = (message) => {
        if (!predicate(message)) return;
        cleanup();
        resolve(message);
      };
      if (!this.listeners.has(method)) this.listeners.set(method, new Set());
      this.listeners.get(method).add(listener);
    });
  }

  close() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.close();
  }
}

async function writeExecutable(filePath, content) {
  await fsp.writeFile(filePath, content, "utf8");
  await fsp.chmod(filePath, 0o755);
}

async function writeFakeAgentBins(binDir) {
  await fsp.mkdir(binDir, { recursive: true });
  const codex = path.join(binDir, "codex");
  const claude = path.join(binDir, "claude");
  await writeExecutable(
    codex,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex fake 0.0.0"; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then echo "Logged in"; exit 0; fi
if [ "$1" = "exec" ]; then echo '{"type":"session","session_id":"00000000-0000-0000-0000-000000000000"}'; exit 0; fi
echo "codex fake 0.0.0"
`
  );
  await writeExecutable(
    claude,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "claude fake 0.0.0"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Authenticated"; exit 0; fi
echo "claude fake 0.0.0"
`
  );
  return { codex, claude };
}

async function copyTemplateProject(target) {
  await fsp.cp(templateRoot, target, {
    recursive: true,
    filter(source) {
      const normalized = source.replaceAll(path.sep, "/");
      return !normalized.includes("/__pycache__") && !normalized.includes("/ui/.runtime");
    },
  });
}

async function writeFile(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
}

async function writeProjectMetadata(projectRoot, displayName, idSuffix) {
  await writeFile(
    path.join(projectRoot, ".co-auto-research", "project.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        projectId: `audit-${idSuffix}`,
        displayName,
        createdAt: "2026-06-22T00:00:00Z",
        templateVersion: "0.1.1",
      },
      null,
      2
    ) + "\n"
  );
}

function reviewText({ reviewer, scope, instruction, trialId, decision = "pass", gate = "pass" }) {
  return `Reviewer: ${reviewer}
Scope: ${scope}
Decision: ${decision}
Gate impact: ${gate}
Confidence: high
Source trial: \`${trialId}\`
Generated at: 2026-06-22T00:00:00Z
Instruction file: \`${instruction}\`
Migration source: \`none\`

## Reviewed Inputs

- \`PROJECT.md\`
- \`research_trajectory/STATE.md\`
- \`research_trajectory/trials/${trialId}/PLAN.md\`
- \`research_trajectory/trials/${trialId}/REPORT.md\`
- \`manuscript/BLUEPRINT.md\`

## Context Summary

UI audit fixture review for ${reviewer}.

## Blocking Issues

- none

## Required Actions Before Pass

- none

## Qualified / Partial Passes

- none

## Unassessed Areas

- none
`;
}

async function writeTrial(projectRoot, trialId, status = "pass") {
  const trialDir = path.join(projectRoot, "research_trajectory", "trials", trialId);
  await writeFile(
    path.join(trialDir, "PLAN.md"),
    `# Trial ${trialId} Plan

## Objective

Audit whether the manuscript-facing UI can show a long but bounded research trajectory.

## Steps

- Inspect resources.
- Update the manuscript map.
- Run reviewer gates.
`
  );
  if (status !== "running") {
    await writeFile(
      path.join(trialDir, "REPORT.md"),
      `# Trial ${trialId} Report

## Summary

The audit fixture closes this trial with manuscript implications and generated artifacts.

## Manuscript Implications

The manuscript should foreground calibrated perceived safety and make evidence availability visible.
`
    );
    for (const [reviewer, file, scope, instruction] of reviewerOutputs) {
      const decision = status === "continue" && file === "EVIDENCE_REVIEW.md" ? "continue" : "pass";
      const gate = decision;
      await writeFile(path.join(trialDir, "reviews", file), reviewText({ reviewer, scope, instruction, trialId, decision, gate }));
    }
  }
  await writeFile(path.join(trialDir, "artifacts", "figure-plan.md"), "# Figure Plan\n\nA compact figure plan for audit screenshots.\n");
}

async function writeRichManuscript(projectRoot) {
  const longSentence = "Physical AI systems increasingly act through movement, force, proximity, spatial access, and embodied service.";
  await writeFile(
    path.join(projectRoot, "manuscript", "BLUEPRINT.md"),
    `# Manuscript Blueprint

## Target Venue / Audience / Article Type

Target venue: Nature Machine Intelligence.

Audience: machine intelligence, physical AI, robot learning, autonomous systems.

Article type: Perspective.

Contribution posture: conceptual framework and research agenda for calibrated perceived safety.

Evidence standard: selective but source-audited synthesis with one compact evidence table.

Expected display / method / result style: a story map, one safety evidence table, and one warehouse-cobot figure.

---

## Target-Venue Organization Rationale

The manuscript follows a perspective structure: a concrete encounter, the evidence gap, deployment accountability, limits, and a constructive agenda.

---

## Core Story

${longSentence} Technical safety evidence remains essential, but deployment also requires that exposed people and institutions can perceive, interpret, act on, and contest safety-relevant evidence at the right time. A structured inventory of public safety sources shows that evidence is visible but unevenly action-usable.

---

## Architecture Overview / Table of Contents

- Abstract
- Section 1: Safety evidence must guide action
- Section 2: Perceived safety is not trust
- Section 3: Physical AI localises safety boundaries
- Section 4: Accountability must follow the actor
- Section 5: Limits of calibrated perceived safety
- Section 6: Making safety demonstrable, perceivable and contestable

---

## Manuscript Architecture

### Section 1: Safety evidence must guide action

Target-venue role: Open with a concrete physical AI encounter and show why passive evidence is insufficient.

Reader question answered: Why does perceived safety need calibration rather than reassurance?

Local thesis / purpose: Public safety evidence should become action-guiding deployment evidence.

Local claims in plain language: Safety reports and data sources often disclose boundaries and caveats, but less often expose machine-readable data, denominators, cadence, or actor-action guidance.

Evidence: \`research_trajectory/CURRENT_FINDINGS.md\`, \`resources/data_sources/public_safety_inventory.csv\`.

Placed displays / methods / results: Table T1.

Local qualifications: The inventory is selective and source-audited rather than exhaustive.

Transition job: motivates a definition of perceived safety that does not collapse into trust.

Paragraph plan:

| Para | Rhetorical move | Content to cover, not full prose | Local evidence / result / artifact | Display / method / result block | Citation posture | Required qualification | Transition job |
|---|---|---|---|---|---|---|---|
| P1 | Encounter | Warehouse-cobot approach, exposed worker, available but hard-to-use evidence | CURRENT_FINDINGS | Figure F1 | cite safety reports | illustrative | sets up evidence/action gap |
| P2 | Synthesis | Public sources disclose caveats unevenly | inventory csv | Table T1 | cite audited inventory | selective | moves to definition |

### Section 2: Perceived safety is not trust

Target-venue role: Define calibrated perceived safety as action-specific evidence interpretation.

Reader question answered: What should a deployment actor do differently?

Local thesis / purpose: Perceived safety should be treated as calibrated deployment evidence, not comfort or acceptance.

Evidence: \`manuscript/figures/FIGURE_SPECS.md\`.

Paragraph plan:

| Para | Rhetorical move | Content to cover, not full prose | Local evidence / result / artifact | Display / method / result block | Citation posture | Required qualification | Transition job |
|---|---|---|---|---|---|---|---|
| P1 | Definition | distinguish assurance, trust, comfort, actionability | blueprint | none | conceptual | avoids psychometric overclaim | moves to boundaries |

---

## Reference / Literature Grounding Plan

Use sources in \`resources/target_venue/SEED_PAPERS.md\` and the current source audit.

---

## Appendix / Supplement Plan

Supplementary provenance can include the audited source inventory and extraction notes.

---

## Blocking Missing Evidence

- none

---

## Required Qualifications / Claim Constraints

The evidence inventory is selective and should not be described as globally exhaustive.

---

## Provenance / Audit Index

### Claim / Evidence Index

C000001 maps to the Section 1 evidence/action gap.

### Display / Method / Result Inventory

- Figure F1: From physical AI encounters to calibrated perceived safety.
- Table T1: Public safety evidence is visible but unevenly action-usable.

### Source Links

- \`research_trajectory/CURRENT_FINDINGS.md\`
- \`resources/data_sources/public_safety_inventory.csv\`

---

## Deprecated Or Superseded Ideas

None active.

---

## Submission-Readiness Summary

Ready for UI audit after all fixture reviewer gates pass.
`
  );
  await writeFile(
    path.join(projectRoot, "manuscript", "figures", "FIGURE_SPECS.md"),
    `# Figure Specs

## Figure F1: From physical AI encounters to calibrated perceived safety

Caption: A warehouse-cobot safety story showing evidence, perception, action, and contestability.

Status: ready.

## Table T1: Public safety evidence is visible but unevenly action-usable

Caption: A compact source-audited evidence table.

Status: ready.
`
  );
}

async function writeRichFixture(projectRoot, displayName, idSuffix) {
  await copyTemplateProject(projectRoot);
  await writeProjectMetadata(projectRoot, displayName, idSuffix);
  await writeFile(
    path.join(projectRoot, "PROJECT.md"),
    `# ${displayName}

This fixture stresses CoAutoResearch UI views with long resource names, trials, reviews, manuscript sections, and session state.
`
  );
  await writeFile(
    path.join(projectRoot, "resources", "user_input", "INITIAL_BRIEF.md"),
    `# Initial Brief

Audit perceived safety for physical AI deployment with a target venue of Nature Machine Intelligence.
`
  );
  await writeFile(
    path.join(projectRoot, "resources", "target_venue", "TARGET_VENUE.md"),
    "Nature Machine Intelligence; audience: machine intelligence and physical AI researchers.\n"
  );
  await writeFile(
    path.join(projectRoot, "resources", "data_sources", "public_safety_inventory.csv"),
    "source,region,actionability\nsafety-report,EU,partial\nincident-database,US,high\n"
  );
  await writeFile(
    path.join(projectRoot, "resources", "ongoing_work", "warehouse-cobot-safety-observations-with-a-very-long-file-name.md"),
    "# Warehouse Cobot Notes\n\nLong filename fixture for resource browser wrapping.\n"
  );
  await fsp.mkdir(path.join(projectRoot, "resources", "literature"), { recursive: true });
  await fsp.writeFile(path.join(projectRoot, "resources", "literature", "binary-paper-placeholder.pdf"), Buffer.from("%PDF-1.4\n% audit placeholder\n"));
  await writeFile(
    path.join(projectRoot, "research_trajectory", "CURRENT_FINDINGS.md"),
    "# Current Findings\n\nSafety evidence is visible but unevenly action-usable across public source types.\n"
  );
  await writeRichManuscript(projectRoot);
  await writeTrial(projectRoot, "000001_safety_evidence_map", "pass");
  await writeTrial(projectRoot, "000002_public_inventory_revision", "continue");
  await writeTrial(projectRoot, "000003_running_gate_check", "running");
  await writeFile(
    path.join(projectRoot, "research_trajectory", "TRAJECTORY.json"),
    JSON.stringify(
      {
        schema_version: 1,
        active_epoch: "current",
        latest_active_trial: "000002_public_inventory_revision",
        next_trial_number: 3,
        archived_trial_ids: ["000000_archived_probe"],
      },
      null,
      2
    ) + "\n"
  );
  await writeFile(
    path.join(projectRoot, "research_trajectory", "STATE.md"),
    `# Research State

## Autoresearch Goal Gate

Status: continue

Required reviewer gates:
- Plan reviewer: pass - research_trajectory/trials/000002_public_inventory_revision/reviews/PLAN_REVIEW.md
- Process reviewer: pass - research_trajectory/trials/000002_public_inventory_revision/reviews/PROCESS_REVIEW.md
- Evidence reviewer: continue - research_trajectory/trials/000002_public_inventory_revision/reviews/EVIDENCE_REVIEW.md
- Venue fit reviewer: pass - research_trajectory/trials/000002_public_inventory_revision/reviews/VENUE_FIT_REVIEW.md
- Manuscript reviewer: pass - research_trajectory/trials/000002_public_inventory_revision/reviews/MANUSCRIPT_REVIEW.md
- Figure/table reviewer: pass - research_trajectory/trials/000002_public_inventory_revision/reviews/FIGURE_TABLE_REVIEW.md
- Reference reviewer: pass - research_trajectory/trials/000002_public_inventory_revision/reviews/REFERENCE_REVIEW.md
- Final gate reviewer: pass - research_trajectory/trials/000002_public_inventory_revision/reviews/FINAL_GATE_REVIEW.md

Next action: finish source audit and final evidence qualification.
`
  );
  await writeFile(
    path.join(projectRoot, "ui", ".runtime", "research_session.json"),
    JSON.stringify(
      {
        id: "audit-session",
        session_id: "00000000-0000-0000-0000-000000000000",
        status: "completed",
        mode: "goal",
        command: "codex exec --json --model gpt-5.5",
        settings: { backend: "codex", model: "gpt-5.5", reasoningEffort: "medium", reviewCheckpointInterval: 100 },
        started_at: "2026-06-22T00:00:00Z",
        ended_at: "2026-06-22T00:02:00Z",
        logs: ["Started fake audit session.", "Updated manuscript blueprint.", "Stopped at evidence reviewer checkpoint."],
        raw_logs: [],
        transcript: [
          { role: "user", text: "Continue the perceived safety project." },
          { role: "assistant", text: "Updated the manuscript map and stopped at the evidence checkpoint." },
        ],
        loop_active: false,
        loop_iteration: 2,
        loop_review_checkpoint_iteration: 100,
        loop_stop_reason: "review_checkpoint_reached",
      },
      null,
      2
    ) + "\n"
  );
  await writeFile(
    path.join(projectRoot, "ui", ".runtime", "settings.json"),
    JSON.stringify(
      {
        agent: { backend: "codex" },
        codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
        claude: { model: "sonnet", permissionPreset: "auto-review", webSearch: true, reviewCheckpointInterval: 100 },
      },
      null,
      2
    ) + "\n"
  );
  await writeFile(
    path.join(projectRoot, "ui", ".runtime", "framing_messages.json"),
    JSON.stringify(
      [
        { id: "audit-user-1", role: "user", text: "Frame a perceived safety perspective.", created_at: "2026-06-22T00:00:00Z" },
        { id: "audit-assistant-1", role: "assistant", text: "Drafted PROJECT.md and prepared the launch plan.", created_at: "2026-06-22T00:00:05Z" },
      ],
      null,
      2
    ) + "\n"
  );
}

async function writeFreshFixture(projectRoot, displayName, idSuffix) {
  await copyTemplateProject(projectRoot);
  await writeProjectMetadata(projectRoot, displayName, idSuffix);
  await writeFile(path.join(projectRoot, "PROJECT.md"), `# ${displayName}\n\nFresh audit project with no trials yet.\n`);
}

async function startServer({ python, mode, projectRoot, projectsDir, env }) {
  const port = await freePort();
  const args = [serverPath, "--host", "127.0.0.1", "--port", String(port)];
  if (mode === "projects") args.push("--projects-dir", projectsDir);
  else args.push("--project-root", projectRoot);
  const child = spawn(python.command, [...python.args, ...args], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`UI audit server exited early for ${mode}.\n${output}`);
    }
    if (await canConnect(port)) return { child, baseUrl, port, output: () => output };
    await wait(80);
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for UI audit server ${mode} on port ${port}.\n${output}`);
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function stopServer(server) {
  if (!server?.child || server.child.killed) return;
  server.child.kill("SIGTERM");
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) return;
    await wait(50);
  }
  server.child.kill("SIGKILL");
}

function loadPromise(client, sessionId, timeoutMs = 12000) {
  return client.waitFor("Page.loadEventFired", (message) => message.sessionId === sessionId, timeoutMs);
}

async function navigate(client, sessionId, url) {
  const loaded = loadPromise(client, sessionId);
  await client.send("Page.navigate", { url }, sessionId);
  await loaded;
}

async function evaluate(client, sessionId, expression, options = {}) {
  const result = await client.send(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      ...options,
    },
    sessionId
  );
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.text || result.exceptionDetails.exception?.description || "Runtime evaluation failed";
    throw new Error(text);
  }
  return result.result?.value;
}

function browserAuditExpression({ desktop, requireManuscriptCentering, requireAttachmentMenu, requireActivityPanel, emptyMode }) {
  return `(() => {
    const issues = [];
    const viewport = { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth };
    const rectFor = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0.01 && r.width > 1 && r.height > 1;
    };
    const inViewport = (rect) => rect && rect.bottom > 0 && rect.top < viewport.height && rect.right > 0 && rect.left < viewport.width;
    const centerHitVisible = (el, rect) => {
      if (!inViewport(rect)) return false;
      const x = Math.min(viewport.width - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(viewport.height - 1, Math.max(0, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit) return false;
      const interactiveHit = hit.closest?.('button, input, select, textarea, [role="button"]');
      return hit === el || el.contains(hit) || interactiveHit === el;
    };
    if (viewport.scrollWidth > viewport.width + 1 || viewport.bodyScrollWidth > viewport.width + 1) {
      issues.push({ type: 'horizontal-overflow', message: 'document is wider than the viewport', viewport });
    }
    const rail = rectFor(document.querySelector('.rail'));
    const main = rectFor(document.querySelector('.main-stage'));
    const activityPanel = document.querySelector('#activity-panel.activity-panel');
    const activityPanelRect = rectFor(activityPanel);
    const activityPanelVisible = Boolean(activityPanel && visible(activityPanel) && !activityPanel.hidden);
    const workspaceRight = (${requireActivityPanel ? "true" : "false"} && activityPanelVisible && ${desktop ? "true" : "false"})
      ? activityPanelRect.left
      : viewport.width;
    if (${desktop ? "true" : "false"} && rail && main) {
      if (Math.abs(main.left - rail.right) > 1 || Math.abs(main.width - (workspaceRight - rail.right)) > 1) {
        issues.push({ type: 'main-stage-geometry', message: 'main stage is not aligned to the fixed rail workspace', rail, main, viewport });
      }
    }
    if (!${desktop ? "true" : "false"} && main && (main.left < -1 || main.right > viewport.width + 1)) {
      issues.push({ type: 'mobile-main-overflow', message: 'main stage overflows mobile viewport', main, viewport });
    }
    const dockedThread = document.querySelector('body.has-brief-dock #cold-start-workspace.has-framing-thread .framing-thread');
    if (visible(dockedThread)) {
      const mainEl = document.querySelector('.main-stage');
      const mainCs = mainEl ? getComputedStyle(mainEl) : null;
      const threadCs = getComputedStyle(dockedThread);
      const composerDock = document.querySelector('.brief-editor-shell.is-framing-dock');
      const threadRect = rectFor(dockedThread);
      const dockRect = rectFor(composerDock);
      const mainRect = rectFor(mainEl);
      if (mainEl && ['auto', 'scroll'].includes(mainCs.overflowY) && mainEl.scrollHeight > mainEl.clientHeight + 2) {
        issues.push({ type: 'framing-outer-scroll', message: 'framing dock state should not leave the outer main stage scrollable', main: { scrollHeight: mainEl.scrollHeight, clientHeight: mainEl.clientHeight, overflowY: mainCs.overflowY } });
      }
      if (!['auto', 'scroll'].includes(threadCs.overflowY)) {
        issues.push({ type: 'framing-thread-scroll', message: 'framing transcript should own vertical scrolling when the composer is docked', thread: { scrollHeight: dockedThread.scrollHeight, clientHeight: dockedThread.clientHeight, overflowY: threadCs.overflowY } });
      }
      if (dockRect && threadRect && threadRect.bottom > dockRect.top - 8) {
        issues.push({ type: 'framing-thread-dock-overlap', message: 'framing transcript viewport extends behind the fixed composer', thread: threadRect, dock: dockRect });
      }
      if (mainRect && threadRect && (Math.abs(threadRect.left - mainRect.left) > 2 || Math.abs(threadRect.right - mainRect.right) > 2)) {
        issues.push({ type: 'framing-scrollbar-edge', message: 'framing transcript scroller should span the workspace so its scrollbar sits on the page edge', thread: threadRect, main: mainRect });
      }
    }
    const workspaceLeft = rail && ${desktop ? "true" : "false"} ? rail.right : 0;
    const workspaceCenter = (workspaceLeft + viewport.width) / 2;
    const centerCheckSelectors = [
      ['material-header', '.material-view.is-active .material-header'],
      ['context-content', '.material-view.is-active .context-content'],
      ['context-card', '.material-view.is-active .context-content > .context-card'],
    ];
    if (${desktop ? "true" : "false"} && (${requireManuscriptCentering ? "true" : "false"} || document.querySelector('.material-view.is-active'))) {
      for (const [name, selector] of centerCheckSelectors) {
        const el = document.querySelector(selector);
        if (!visible(el)) continue;
        const r = rectFor(el);
        const offset = ((r.left + r.right) / 2) - workspaceCenter;
        if (Math.abs(offset) > 2) {
          issues.push({ type: 'centering', message: name + ' is not centered in the right-side workspace', selector, offset, rect: r, workspaceLeft, viewport });
        }
      }
    }
    if (${requireAttachmentMenu ? "true" : "false"}) {
      const menu = document.querySelector('#attachment-menu');
      const upload = document.querySelector('[data-attachment-action="upload-files"]');
      const link = document.querySelector('[data-attachment-action="link-folders"]');
      const menuRect = rectFor(menu);
      const buttonRect = rectFor(document.querySelector('#composer-attach-button'));
      if (!visible(menu) || menu.hidden) {
        issues.push({ type: 'attachment-menu-hidden', message: 'composer plus did not open a visible attachment menu', rect: menuRect, button: buttonRect });
      } else {
        if (!visible(upload) || !visible(link)) {
          issues.push({ type: 'attachment-menu-items', message: 'attachment menu is missing visible upload/link actions', upload: rectFor(upload), link: rectFor(link) });
        }
        if (!inViewport(menuRect)) {
          issues.push({ type: 'attachment-menu-viewport', message: 'attachment menu opens outside the viewport', rect: menuRect, viewport });
        }
      }
    }
    if (${requireActivityPanel ? "true" : "false"}) {
      const panel = activityPanel;
      const panelBody = panel?.querySelector?.('.activity-panel-body');
      const close = panel?.querySelector?.('[data-activity-close]');
      const panelRect = activityPanelRect;
      const bodyRect = rectFor(panelBody);
      const closeRect = rectFor(close);
      if (!visible(panel) || panel.hidden) {
        issues.push({ type: 'activity-panel-hidden', message: 'Activity panel did not open', rect: panelRect });
      } else {
        if (panelRect.left < -2 || panelRect.right > viewport.width + 2 || panelRect.top < -2 || panelRect.bottom > viewport.height + 2) {
          issues.push({ type: 'activity-panel-bounds', message: 'Activity panel is outside the viewport', rect: panelRect, viewport });
        }
        if (!visible(close) || !inViewport(closeRect)) {
          issues.push({ type: 'activity-panel-close', message: 'Activity panel close button is not visible in the viewport', rect: closeRect, panel: panelRect });
        }
        if (!panelBody || !['auto', 'scroll'].includes(getComputedStyle(panelBody).overflowY)) {
          issues.push({ type: 'activity-panel-scroll', message: 'Activity panel body should own vertical scrolling', body: bodyRect });
        }
        if (panelBody && panelBody.scrollWidth > panelBody.clientWidth + 1) {
          issues.push({ type: 'activity-panel-horizontal-overflow', message: 'Activity panel body has horizontal overflow', body: { scrollWidth: panelBody.scrollWidth, clientWidth: panelBody.clientWidth }, rect: bodyRect });
        }
        if (!document.querySelector('.activity-timeline-item') || !document.querySelector('.activity-event-card')) {
          issues.push({ type: 'activity-panel-content', message: 'Activity panel is missing timeline or event card content' });
        }
        const timeline = panel.querySelector('.activity-timeline');
        const icon = panel.querySelector('.activity-timeline-icon');
        if (timeline && icon) {
          const timelineRect = rectFor(timeline);
          const iconRect = rectFor(icon);
          const axisLeft = Number.parseFloat(getComputedStyle(timeline, '::before').left || '0');
          const axisCenter = timelineRect.left + axisLeft + 0.5;
          const iconCenter = (iconRect.left + iconRect.right) / 2;
          if (Math.abs(iconCenter - axisCenter) > 1) {
            issues.push({ type: 'activity-axis-alignment', message: 'Activity timeline icon center is not aligned with the vertical axis', axisCenter, iconCenter, icon: iconRect, timeline: timelineRect });
          }
        }
        const content = panel.querySelector('.activity-timeline-content');
        if (content) {
          const contentRect = rectFor(content);
          const leftInset = contentRect.left - panelRect.left;
          const rightInset = panelRect.right - contentRect.right;
          if (leftInset - rightInset > 42) {
            issues.push({ type: 'activity-content-balance', message: 'Activity timeline content has too much left gutter compared with the right margin', leftInset, rightInset, content: contentRect, panel: panelRect });
          }
        }
        if (${desktop ? "true" : "false"} && viewport.width >= 1100) {
          const mainRect = rectFor(document.querySelector('.main-stage'));
          const composerDock = document.querySelector('.brief-editor-shell.is-framing-dock');
          const composerRect = rectFor(composerDock);
          if (mainRect && panelRect && mainRect.right > panelRect.left + 2) {
            issues.push({ type: 'activity-panel-overlap', message: 'Activity panel should occupy a separate right column instead of covering the main stage', main: mainRect, panel: panelRect });
          }
          if (visible(composerDock) && mainRect && composerRect) {
            const composerCenter = (composerRect.left + composerRect.right) / 2;
            const mainCenter = (mainRect.left + mainRect.right) / 2;
            if (Math.abs(composerCenter - mainCenter) > 3) {
              issues.push({ type: 'activity-composer-centering', message: 'Composer should stay centered in the middle column while Activity is open', composer: composerRect, main: mainRect, offset: composerCenter - mainCenter });
            }
          }
        }
      }
    }
    const openDialogs = [...document.querySelectorAll('dialog[open]')].filter(visible);
    for (const dialog of openDialogs) {
      if (!visible(dialog)) continue;
      const r = rectFor(dialog);
      if (r.left < -2 || r.right > viewport.width + 2 || r.bottom < 8 || r.top > viewport.height - 8) {
        issues.push({ type: 'dialog-bounds', message: 'open dialog is outside the viewport', id: dialog.id, rect: r, viewport });
      }
    }
    const topDialog = openDialogs.at(-1) || null;
    const controlRoot = topDialog || document;
    const overlapSkipSelectors = ['.attachment-menu', '.trial-strip', '.review-trial-strip', '.markdown-preview', '.paper-linked-block', '.story-map-hero', '.browser-pathbar'];
    const controls = [...controlRoot.querySelectorAll('button, input, select, textarea, [role="button"]')]
      .filter(visible)
      .map((el, index) => ({ el, index, tag: el.tagName.toLowerCase(), text: (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 80), rect: rectFor(el) }))
      .filter((item) => item.rect.width > 3 && item.rect.height > 3 && centerHitVisible(item.el, item.rect));
    const publicControl = (item) => ({ index: item.index, tag: item.tag, text: item.text, rect: item.rect });
    const skipControlOverlap = (a, b) => overlapSkipSelectors.some((selector) => {
      const aRoot = a.el.closest(selector);
      return aRoot && aRoot === b.el.closest(selector);
    });
    for (const control of controls) {
      if (control.rect.width < 16 || control.rect.height < 16) {
        issues.push({ type: 'tiny-control', message: 'visible control is too small to use', control: publicControl(control) });
      }
    }
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        if (skipControlOverlap(controls[i], controls[j])) continue;
        const a = controls[i].rect;
        const b = controls[j].rect;
        const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapW <= 2 || overlapH <= 2) continue;
        const area = overlapW * overlapH;
        const minArea = Math.min(a.width * a.height, b.width * b.height);
        if (area > Math.min(240, minArea * 0.4)) {
          issues.push({ type: 'control-overlap', message: 'visible controls overlap', controls: [publicControl(controls[i]), publicControl(controls[j])], area });
        }
      }
    }
    const textControls = [...controlRoot.querySelectorAll('button, .rail-action span, .project-switch strong, .project-switch small, .file-manager-count span')]
      .filter((el) => visible(el) && centerHitVisible(el.closest('button') || el, rectFor(el)));
    for (const el of textControls) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
      if (el.scrollWidth > el.clientWidth + 8 && el.clientWidth > 0) {
        issues.push({ type: 'text-overflow', message: 'control text overflows its container', text: (el.textContent || '').trim().slice(0, 100), rect: rectFor(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
      }
    }
    if (${emptyMode ? "true" : "false"} && !document.querySelector('#project-dialog[open]') && document.querySelector('.rail-nav:not([hidden])')) {
      issues.push({ type: 'empty-project-nav', message: 'navigation should remain hidden when there is no active project' });
    }
    return { issues, viewport, title: document.title, activeView: document.querySelector('.workspace-view.is-active')?.id || '', openDialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => dialog.id) };
  })()`;
}

function importantNetworkFailure(event) {
  const url = event.params?.request?.url || "";
  const errorText = event.params?.errorText || "";
  if (/favicon|apple-touch-icon/.test(url)) return false;
  if (errorText === "net::ERR_ABORTED") return false;
  return true;
}

function importantConsoleMessage(event) {
  const params = event.params || {};
  if (!["error", "assert"].includes(params.type)) return false;
  const text = (params.args || []).map((arg) => arg.value || arg.description || "").join(" ");
  if (/ResizeObserver loop/.test(text)) return false;
  return true;
}

async function runScenario({ client, server, mode, scenario, theme, viewport, chromeOutDir }) {
  const targetUrl = `${server.baseUrl}${scenario.path}`;
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const consoleErrors = [];
  const networkFailures = [];
  const exceptions = [];
  const consoleListener = (message) => {
    if (message.sessionId === sessionId && importantConsoleMessage(message)) consoleErrors.push(message.params);
  };
  const networkListener = (message) => {
    if (message.sessionId === sessionId && importantNetworkFailure(message)) networkFailures.push(message.params);
  };
  const exceptionListener = (message) => {
    if (message.sessionId === sessionId) exceptions.push(message.params);
  };
  client.listeners.set("Runtime.consoleAPICalled", (client.listeners.get("Runtime.consoleAPICalled") || new Set()).add(consoleListener));
  client.listeners.set("Network.loadingFailed", (client.listeners.get("Network.loadingFailed") || new Set()).add(networkListener));
  client.listeners.set("Runtime.exceptionThrown", (client.listeners.get("Runtime.exceptionThrown") || new Set()).add(exceptionListener));
  try {
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Network.enable", {}, sessionId);
    await client.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width <= 760,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      },
      sessionId
    );
    await navigate(client, sessionId, targetUrl);
    await evaluate(client, sessionId, `localStorage.setItem('coAutoResearchTheme', ${JSON.stringify(theme)}); localStorage.setItem('coAutoResearchActivePanel', 'chat'); true;`);
    await navigate(client, sessionId, targetUrl);
    await evaluate(client, sessionId, "document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(true);");
    await wait(450);
    if (scenario.action) {
      await evaluate(client, sessionId, `(async () => { ${scenario.action} return true; })()`);
      await wait(350);
    }
    const browserAudit = await evaluate(
      client,
      sessionId,
      browserAuditExpression({
        desktop: viewport.width > 820,
        requireManuscriptCentering: Boolean(scenario.requireManuscriptCentering),
        requireAttachmentMenu: Boolean(scenario.requireAttachmentMenu),
        requireActivityPanel: Boolean(scenario.requireActivityPanel),
        emptyMode: mode === "empty",
      })
    );
    const pngName = `${slug(mode)}-${slug(theme)}-${slug(viewport.name)}-${slug(scenario.name)}.png`;
    const screenshot = path.join(chromeOutDir, pngName);
    const { data } = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true }, sessionId);
    await fsp.writeFile(screenshot, Buffer.from(data, "base64"));
    const issues = [
      ...(browserAudit?.issues || []),
      ...consoleErrors.map((item) => ({ type: "console-error", message: (item.args || []).map((arg) => arg.value || arg.description || "").join(" ") || item.type })),
      ...networkFailures.map((item) => ({ type: "network-failure", message: `${item.errorText || "network failure"} ${item.request?.url || ""}` })),
      ...exceptions.map((item) => ({ type: "runtime-exception", message: item.exceptionDetails?.text || item.exceptionDetails?.exception?.description || "runtime exception" })),
    ];
    return {
      mode,
      theme,
      viewport: viewport.name,
      size: `${viewport.width}x${viewport.height}`,
      scenario: scenario.name,
      screenshot: path.relative(root, screenshot),
      ok: issues.length === 0,
      issues,
      audit: browserAudit,
    };
  } finally {
    client.listeners.get("Runtime.consoleAPICalled")?.delete(consoleListener);
    client.listeners.get("Network.loadingFailed")?.delete(networkListener);
    client.listeners.get("Runtime.exceptionThrown")?.delete(exceptionListener);
    await client.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

async function runScenarioSet({ chrome, server, mode, scenarios, chromeOutDir }) {
  const userDataDir = path.join(os.tmpdir(), `co-auto-research-ui-audit-chrome-${process.pid}-${mode}`);
  await fsp.rm(userDataDir, rmOptions);
  const child = spawn(chrome, chromeArgs({ width: 1440, height: 1000, userDataDir }), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let client;
  try {
    const wsUrl = await waitForDevToolsUrl(child);
    client = new CdpClient(wsUrl);
    await client.connect();
    const results = [];
    for (const theme of themes) {
      for (const viewport of viewports) {
        for (const scenario of scenarios) {
          results.push(await runScenario({ client, server, mode, scenario, theme, viewport, chromeOutDir }));
        }
      }
    }
    return results;
  } finally {
    client?.close();
    if (!child.killed) child.kill("SIGTERM");
    await wait(150);
    if (!child.killed) child.kill("SIGKILL");
    await fsp.rm(userDataDir, rmOptions);
  }
}

async function prepareFixtures(tempRoot) {
  const fakeBin = path.join(tempRoot, "fake-bin");
  const agents = await writeFakeAgentBins(fakeBin);
  const singleRoot = path.join(tempRoot, "single-rich-project");
  const projectsDir = path.join(tempRoot, "projects");
  const richMulti = path.join(projectsDir, "perceived-safety");
  const freshMulti = path.join(projectsDir, "fresh-project");
  const emptyProjectsDir = path.join(tempRoot, "empty-projects");
  await fsp.mkdir(projectsDir, { recursive: true });
  await fsp.mkdir(emptyProjectsDir, { recursive: true });
  await writeRichFixture(singleRoot, "perceived safety", "single-rich");
  await writeRichFixture(richMulti, "perceived safety", "multi-rich");
  await writeFreshFixture(freshMulti, "fresh project", "multi-fresh");
  return { fakeBin, agents, singleRoot, projectsDir, emptyProjectsDir };
}

async function writeReports(results) {
  const reportJson = path.join(outDir, "report.json");
  const reportMd = path.join(outDir, "REPORT.md");
  await fsp.writeFile(reportJson, JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2) + "\n", "utf8");
  const failures = results.filter((item) => !item.ok);
  const byMode = new Map();
  for (const item of results) {
    const key = item.mode;
    byMode.set(key, (byMode.get(key) || 0) + 1);
  }
  const lines = [
    "# UI Audit Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Screenshots: ${results.length}`,
    `Failures: ${failures.length}`,
    "",
    "## Coverage",
    "",
    ...[...byMode.entries()].map(([mode, count]) => `- ${mode}: ${count} screenshots`),
    "",
    "## Failures",
    "",
    ...(failures.length
      ? failures.flatMap((item) => [
          `### ${item.mode} / ${item.theme} / ${item.viewport} / ${item.scenario}`,
          "",
          `Screenshot: \`${item.screenshot}\``,
          "",
          ...item.issues.map((issue) => `- ${issue.type}: ${issue.message}`),
          "",
        ])
      : ["None.", ""]),
  ];
  await fsp.writeFile(reportMd, `${lines.join("\n").trim()}\n`, "utf8");
  return { reportJson, reportMd, failures };
}

async function main() {
  const chrome = findChrome();
  const python = findPython();
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "coauto-ui-audit-"));
  await fsp.rm(outDir, rmOptions);
  await fsp.mkdir(outDir, { recursive: true });
  const servers = [];
  try {
    const fixtures = await prepareFixtures(tempRoot);
    const env = {
      ...process.env,
      PATH: `${fixtures.fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      COAUTO_CODEX: fixtures.agents.codex,
      COAUTO_CLAUDE: fixtures.agents.claude,
      COAUTO_TEMPLATE_ROOT: templateRoot,
      COAUTO_AGENT_BACKEND: "",
    };
    const singleServer = await startServer({ python, mode: "single", projectRoot: fixtures.singleRoot, env });
    servers.push(singleServer);
    const multiServer = await startServer({ python, mode: "projects", projectsDir: fixtures.projectsDir, env });
    servers.push(multiServer);
    const emptyServer = await startServer({ python, mode: "projects", projectsDir: fixtures.emptyProjectsDir, env });
    servers.push(emptyServer);
    const results = [
      ...(await runScenarioSet({ chrome, server: singleServer, mode: "single", scenarios: baseScenarios, chromeOutDir: outDir })),
      ...(await runScenarioSet({ chrome, server: multiServer, mode: "multi", scenarios: multiProjectScenarios, chromeOutDir: outDir })),
      ...(await runScenarioSet({ chrome, server: emptyServer, mode: "empty", scenarios: emptyProjectScenarios, chromeOutDir: outDir })),
    ];
    const { reportJson, reportMd, failures } = await writeReports(results);
    console.log(`UI audit screenshots written to ${path.relative(root, outDir)}/`);
    console.log(`UI audit report: ${path.relative(root, reportMd)}`);
    console.log(`UI audit JSON: ${path.relative(root, reportJson)}`);
    console.log(`Scenarios: ${results.length}, failures: ${failures.length}`);
    if (failures.length) {
      for (const failure of failures.slice(0, 12)) {
        console.error(`- ${failure.mode}/${failure.theme}/${failure.viewport}/${failure.scenario}: ${failure.issues.map((issue) => `${issue.type}: ${issue.message}`).join("; ")}`);
      }
      throw new Error(`UI audit failed with ${failures.length} failing screenshot scenario(s). See ${path.relative(root, reportMd)}.`);
    }
  } finally {
    for (const server of servers.reverse()) await stopServer(server);
    await fsp.rm(tempRoot, rmOptions);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
