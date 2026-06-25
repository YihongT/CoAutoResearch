#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const PACKAGE_MANIFEST_PATH = path.join(PACKAGE_ROOT, "package.json");
const TEMPLATE_ROOT = path.join(PACKAGE_ROOT, "templates", "default");
const MANIFEST_PATH = path.join(TEMPLATE_ROOT, ".co-auto-research-template", "manifest.json");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "8765";
const DEFAULT_PROJECTS_DIR = "co-autoresearch-projects";
const LEGACY_PROJECTS_DIR = "local-projects";
const REVIEWER_BASELINE_VERSION = "2026-06-publication-ready-tables";
const CORE_REVIEWER_FILES = [
  "REVIEW_TAXONOMY.md",
  "FINAL_GATE_REVIEWER.md",
  "PLAN_REVIEWER.md",
  "PROCESS_REVIEWER.md",
  "EVIDENCE_REVIEWER.md",
  "VENUE_FIT_REVIEWER.md",
  "MANUSCRIPT_REVIEWER.md",
  "FIGURE_TABLE_REVIEWER.md",
  "REFERENCE_REVIEWER.md",
  "REVIEWER_SPAWNING.md"
];
const CORE_PROTOCOL_FILES = [
  "EXECUTION_AGENT.md",
  "RESOURCE_INTAKE.md",
  "RESOURCE_SCOUT.md",
  "REVIEWER_SCOPE_ANALYST.md"
];
const REVIEWER_BASELINE_PATH = path.join("instructions", ".co-auto-research-instructions.json");
const REVIEW_STORAGE_VERSION = "per-reviewer-files-v1";
const REQUIRED_REVIEWER_OUTPUTS = {
  plan: { label: "Plan reviewer", file: "PLAN_REVIEW.md", scope: "plan", instruction: "instructions/reviewers/PLAN_REVIEWER.md" },
  process: { label: "Process reviewer", file: "PROCESS_REVIEW.md", scope: "process", instruction: "instructions/reviewers/PROCESS_REVIEWER.md" },
  evidence: { label: "Evidence reviewer", file: "EVIDENCE_REVIEW.md", scope: "evidence", instruction: "instructions/reviewers/EVIDENCE_REVIEWER.md" },
  venue_fit: { label: "Venue fit reviewer", file: "VENUE_FIT_REVIEW.md", scope: "venue", instruction: "instructions/reviewers/VENUE_FIT_REVIEWER.md" },
  manuscript: { label: "Manuscript reviewer", file: "MANUSCRIPT_REVIEW.md", scope: "manuscript", instruction: "instructions/reviewers/MANUSCRIPT_REVIEWER.md" },
  figure_table: { label: "Figure/table reviewer", file: "FIGURE_TABLE_REVIEW.md", scope: "figure-table", instruction: "instructions/reviewers/FIGURE_TABLE_REVIEWER.md" },
  reference: { label: "Reference reviewer", file: "REFERENCE_REVIEW.md", scope: "reference", instruction: "instructions/reviewers/REFERENCE_REVIEWER.md" },
  final_gate: { label: "Final gate reviewer", file: "FINAL_GATE_REVIEW.md", scope: "final-gate", instruction: "instructions/reviewers/FINAL_GATE_REVIEWER.md" }
};

function usage() {
  return `CoAutoResearch

Usage:
  co-auto-research init <dir>
  co-auto-research ls [--projects-dir <dir>]
  co-auto-research attach [project-name-or-path] [--projects-dir <dir>] [--host 127.0.0.1] [--port 8765] [--open] [--no-open] [--remote]
  co-auto-research ui [--host 127.0.0.1] [--port 8765] [--open] [--no-open] [--remote]
  co-auto-research ui --projects-dir <dir> [--host 127.0.0.1] [--port 8765] [--open] [--no-open] [--remote]
  co-auto-research install-cloudflared
  co-auto-research doctor [--host 127.0.0.1] [--port 8765]
  co-auto-research upgrade
  co-auto-research upgrade-project [project-name-or-path] [--all] [--projects-dir <dir>] [--dry-run]
  co-auto-research version
  co-auto-research help

Alias:
  auto-research
`;
}

function parseOptions(args) {
  const options = {};
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host" || arg === "--port" || arg === "--projects-dir" || arg === "--project") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg === "--open" || arg === "--no-open" || arg === "--remote" || arg === "--all" || arg === "--dry-run") {
      options[arg.slice(2)] = true;
      continue;
    }
    rest.push(arg);
  }
  return { options, rest };
}

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function assertDirectoryEmptyOrMissing(target) {
  if (!(await pathExists(target))) return;
  const stats = await fsp.stat(target);
  if (!stats.isDirectory()) {
    throw new Error(`Target exists and is not a directory: ${target}`);
  }
  const entries = await fsp.readdir(target);
  if (entries.length > 0) {
    throw new Error(`Target directory is not empty: ${target}`);
  }
}

async function readJson(target) {
  return JSON.parse(await fsp.readFile(target, "utf8"));
}

function readJsonSync(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function packageMetadata() {
  try {
    return readJsonSync(PACKAGE_MANIFEST_PATH);
  } catch {
    return {};
  }
}

function packageVersion() {
  return String(packageMetadata().version || "unknown");
}

function sha256FileSync(target) {
  return createHash("sha256").update(fs.readFileSync(target)).digest("hex");
}

function reviewerTemplateDir() {
  return path.join(TEMPLATE_ROOT, "instructions", "reviewers");
}

function instructionTemplateDir() {
  return path.join(TEMPLATE_ROOT, "instructions");
}

function reviewerTemplateHashesSync() {
  const hashes = {};
  for (const name of CORE_REVIEWER_FILES) {
    const target = path.join(reviewerTemplateDir(), name);
    if (fs.existsSync(target)) hashes[name] = sha256FileSync(target);
  }
  return hashes;
}

function protocolTemplateHashesSync() {
  const hashes = {};
  for (const name of CORE_PROTOCOL_FILES) {
    const target = path.join(instructionTemplateDir(), name);
    if (fs.existsSync(target)) hashes[name] = sha256FileSync(target);
  }
  return hashes;
}

function writeReviewerBaselineMetadataSync(projectRoot) {
  const metadataPath = path.join(projectRoot, REVIEWER_BASELINE_PATH);
  const payload = {
    schemaVersion: 1,
    reviewerBaselineVersion: REVIEWER_BASELINE_VERSION,
    reviewStorageVersion: REVIEW_STORAGE_VERSION,
    syncedAt: new Date().toISOString(),
    coreReviewerFiles: reviewerTemplateHashesSync(),
    coreProtocolFiles: protocolTemplateHashesSync()
  };
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function trialIterationFromId(value) {
  const match = String(value || "").match(/^0*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function normalizeGateStatus(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "missing";
  if (/\b(blocked|needs_human|human|clarification)\b/.test(text)) return "blocked";
  if (/^(all[_\s-]?passed)(?:\s*$|\s*[:.;,]\s*|\s+-\s+)/.test(text)) return "pass";
  if (/^(strict\s+)?pass(?:\s*$|\s*[:.;,]\s*|\s+-\s+)/.test(text)) {
    const tail = text.replace(/^(strict\s+)?pass(?:\s*$|\s*[:.;,]\s*|\s+-\s+)/, "").replaceAll("_", " ").replaceAll("-", " ");
    if (/\b(not\s+pass|not\s+passed|not\s+ready|needs\s+work|needs\s+follow\s+up|follow\s+up|continue|running|revise|revision\s+required|targeted\s+revision|architecture\s+only|partial|qualified|qualification|supported\s+with\s+qualification|plausible|pass\s+for)\b/.test(tail)) return "continue";
    return "pass";
  }
  const normalized = text.replaceAll("_", " ").replaceAll("-", " ");
  if (/\b(not\s+pass|not\s+passed|not\s+ready|needs\s+work|needs\s+follow\s+up|follow\s+up|continue|running|revise|revision\s+required|targeted\s+revision|architecture|partial|qualified|qualification|supported\s+with\s+qualification|plausible|approved|complete|completed|ready|pass\s+for)\b/.test(normalized)) return "continue";
  if (/\b(fail|failed)\b/.test(text)) return "continue";
  return text.split(/\s+/)[0];
}

function reviewerKeyForLabel(label) {
  const clean = String(label || "").toLowerCase().replace(/[^a-z/ ]+/g, " ").replace(/\s+/g, " ").trim();
  if (clean.startsWith("plan")) return "plan";
  if (clean.startsWith("process")) return "process";
  if (clean.startsWith("evidence")) return "evidence";
  if (clean.startsWith("venue")) return "venue_fit";
  if (clean.startsWith("manuscript")) return "manuscript";
  if (clean.startsWith("figure") || clean.startsWith("table") || clean.includes("figure/table")) return "figure_table";
  if (clean.startsWith("reference")) return "reference";
  if (clean.startsWith("final")) return "final_gate";
  return "";
}

function projectRelativePath(projectRoot, target) {
  return path.relative(projectRoot, target).split(path.sep).join("/") || ".";
}

function readTrajectoryArchivedIdsSync(projectRoot) {
  const trajectoryPath = path.join(projectRoot, "research_trajectory", "TRAJECTORY.json");
  if (!fs.existsSync(trajectoryPath)) return new Set();
  try {
    const payload = readJsonSync(trajectoryPath);
    return new Set(Array.isArray(payload.archived_trial_ids) ? payload.archived_trial_ids.map(String) : []);
  } catch {
    return new Set();
  }
}

function activeTrialDirsSync(projectRoot) {
  const root = path.join(projectRoot, "research_trajectory", "trials");
  if (!fs.existsSync(root)) return [];
  const archived = readTrajectoryArchivedIdsSync(projectRoot);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((trialDir) => {
      const name = path.basename(trialDir);
      if (archived.has(name) || /^0*_?project_conversion/i.test(name)) return false;
      return ["PLAN.md", "REVIEW.md", "REPORT.md", "artifacts", "reviews"].some((entry) => fs.existsSync(path.join(trialDir, entry)));
    })
    .sort((a, b) => trialIterationFromId(path.basename(a)) - trialIterationFromId(path.basename(b)) || path.basename(a).localeCompare(path.basename(b)));
}

function reviewerOutputPath(trialDir, key) {
  return path.join(trialDir, "reviews", REQUIRED_REVIEWER_OUTPUTS[key].file);
}

function firstRegexValue(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return String(match[1] || "").trim().replace(/^`|`$/g, "").trim();
  }
  return "";
}

function parseReviewerSections(text, sourcePath = "") {
  const matches = [...text.matchAll(/^Reviewer:\s*`?([^`\n]+?)`?\s*$/gm)];
  const sections = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const reviewer = String(match[1] || "").trim();
    const key = reviewerKeyForLabel(reviewer);
    if (!key) continue;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const block = text.slice(match.index, end).trim().replace(/\n-{3,}\s*$/, "").trim();
    sections.push({
      key,
      reviewer,
      path: sourcePath,
      text: block,
      decision: firstRegexValue(block, [/^Decision:\s*`?([^`\n]+)`?/im, /^Status:\s*`?([^`\n]+)`?/im]),
      gate: firstRegexValue(block, [/^Gate impact:\s*`?([^`\n]+)`?/im, /^Gate:\s*`?([^`\n]+)`?/im]),
      confidence: firstRegexValue(block, [/^Confidence:\s*`?([^`\n]+)`?/im]) || "medium"
    });
  }
  return sections;
}

function stripReviewerMetadata(text) {
  const metadata = new Set(["reviewer", "scope", "decision", "gate impact", "gate", "confidence", "source trial", "generated at", "instruction file", "migration source"]);
  return String(text || "").split(/\r?\n/).filter((line) => !metadata.has(line.split(":", 1)[0].trim().toLowerCase())).join("\n").trim();
}

function reviewedInputsForTrial(projectRoot, trialDir, key) {
  const candidates = [
    path.join(trialDir, "PLAN.md"),
    path.join(trialDir, "REPORT.md"),
    path.join(projectRoot, "PROJECT.md"),
    path.join(projectRoot, "research_trajectory", "STATE.md"),
    path.join(projectRoot, "research_trajectory", "CURRENT_FINDINGS.md")
  ];
  if (["evidence", "venue_fit", "manuscript", "figure_table", "final_gate"].includes(key)) candidates.push(path.join(projectRoot, "manuscript", "BLUEPRINT.md"));
  if (["figure_table", "final_gate"].includes(key)) candidates.push(path.join(projectRoot, "manuscript", "figures", "FIGURE_SPECS.md"));
  if (["venue_fit", "figure_table", "final_gate"].includes(key)) {
    candidates.push(
      path.join(projectRoot, "resources", "target_venue", "SEED_PAPERS.md"),
      path.join(projectRoot, "resources", "target_venue", "STYLE_NOTES.md"),
      path.join(projectRoot, "resources", "target_venue", "FIGURE_TABLE_NOTES.md")
    );
  }
  return [...new Set(candidates.filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()).map((candidate) => projectRelativePath(projectRoot, candidate)))];
}

function defaultMissingReviewBody(label) {
  return [
    "## Blocking Issues",
    "",
    `- ${label} was not run for this trial before the per-reviewer migration.`,
    "",
    "## Required Actions Before Pass",
    "",
    `- Run the ${label} for this trial and replace this migration record.`,
    "",
    "## Qualified / Partial Passes",
    "",
    "- none",
    "",
    "## Unassessed Areas",
    "",
    `- ${label} was not assessed for this trial.`
  ].join("\n");
}

function formatReviewerFile(projectRoot, trialDir, key, { decision, gate, confidence, migrationSource, contextSummary, body = "" }) {
  const config = REQUIRED_REVIEWER_OUTPUTS[key];
  const cleanBody = body ? stripReviewerMetadata(body) : defaultMissingReviewBody(config.label);
  const inputs = reviewedInputsForTrial(projectRoot, trialDir, key);
  return [
    `# ${config.label} Review`,
    "",
    `Reviewer: ${config.label}`,
    `Scope: ${config.scope}`,
    `Decision: ${normalizeGateStatus(decision)}`,
    `Gate impact: ${normalizeGateStatus(gate || decision)}`,
    `Confidence: ${String(confidence || "medium").trim()}`,
    `Source trial: \`${path.basename(trialDir)}\``,
    `Generated at: ${new Date().toISOString()}`,
    `Instruction file: \`${config.instruction}\``,
    `Migration source: \`${migrationSource}\``,
    "",
    "## Reviewed Inputs",
    "",
    ...(inputs.length ? inputs.map((item) => `- \`${item}\``) : ["- none recorded"]),
    "",
    "## Context Summary",
    "",
    contextSummary || "No context summary recorded.",
    "",
    cleanBody,
    ""
  ].join("\n");
}

function backupProjectFileSync(projectRoot, source, migrationDir, backedUp) {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return;
  const relative = projectRelativePath(projectRoot, source);
  const destination = path.join(migrationDir, "review_storage_backups", relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (!backedUp.includes(relative)) backedUp.push(relative);
}

function latestSavedPassSectionsSync(projectRoot, trialDirs) {
  const latest = {};
  const sources = trialDirs.map((trialDir) => path.join(trialDir, "REVIEW.md"));
  const manuscriptReviews = path.join(projectRoot, "manuscript", "reviews");
  if (fs.existsSync(manuscriptReviews)) {
    for (const name of fs.readdirSync(manuscriptReviews).filter((item) => item.endsWith(".md") && item !== ".gitkeep").sort()) {
      sources.push(path.join(manuscriptReviews, name));
    }
  }
  for (const source of sources) {
    if (!fs.existsSync(source)) continue;
    const relative = projectRelativePath(projectRoot, source);
    const iteration = relative.includes("manuscript/reviews") ? 1_000_000_000 : trialIterationFromId(path.basename(path.dirname(source)));
    for (const section of parseReviewerSections(fs.readFileSync(source, "utf8"), relative)) {
      if (normalizeGateStatus(section.decision) !== "pass" || normalizeGateStatus(section.gate || section.decision) !== "pass") continue;
      if (!latest[section.key] || latest[section.key].iteration <= iteration) latest[section.key] = { ...section, iteration };
    }
  }
  return latest;
}

function projectGateTextPassedSync(projectRoot) {
  const statePath = path.join(projectRoot, "research_trajectory", "STATE.md");
  if (!fs.existsSync(statePath)) return false;
  const text = fs.readFileSync(statePath, "utf8");
  const section = text.match(/^##\s+Autoresearch Goal Gate\s*$[\s\S]*?(?=^##\s+|\s*$)/m);
  if (!section) return false;
  const status = section[0].match(/^\s*Status:\s*(.+?)\s*$/im);
  if (!status || normalizeGateStatus(status[1]) !== "pass") return false;
  return Object.values(REQUIRED_REVIEWER_OUTPUTS).every((config) => {
    const escaped = config.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = section[0].match(new RegExp(`^\\s*[-*]\\s*${escaped}\\s*:\\s*(.+?)\\s*$`, "im"));
    return match && normalizeGateStatus(match[1]) === "pass";
  });
}

function reviewerFileStatusSync(target) {
  if (!fs.existsSync(target)) return "missing";
  const text = fs.readFileSync(target, "utf8");
  const gate = normalizeGateStatus(firstRegexValue(text, [/^Gate impact:\s*`?([^`\n]+)`?/im]));
  if (gate !== "missing") return gate;
  return normalizeGateStatus(firstRegexValue(text, [/^Decision:\s*`?([^`\n]+)`?/im]));
}

function normalizeStateGateReferencesSync(projectRoot, latestTrial, migrationDir, backedUp, dryRun = false) {
  if (!latestTrial) return "";
  const statePath = path.join(projectRoot, "research_trajectory", "STATE.md");
  if (!fs.existsSync(statePath)) return "";
  const text = fs.readFileSync(statePath, "utf8");
  let changed = false;
  let updated = text.replace(/^\s*[-*]\s*(Plan reviewer|Process reviewer|Evidence reviewer|Venue fit reviewer|Manuscript reviewer|Figure\/table reviewer|Reference reviewer|Final gate reviewer)\s*:\s*(.+?)\s*$/gm, (line, label, status) => {
    const key = reviewerKeyForLabel(label);
    if (!key) return line;
    const reviewPath = reviewerOutputPath(latestTrial, key);
    const reference = projectRelativePath(projectRoot, reviewPath);
    const fileStatus = reviewerFileStatusSync(reviewPath);
    const normalizedStatus = fileStatus === "missing" ? normalizeGateStatus(status) : fileStatus;
    const reason = normalizedStatus === "pass" ? "" : " - current trial reviewer file is not pass";
    const desired = `- ${REQUIRED_REVIEWER_OUTPUTS[key].label}: ${normalizedStatus}${reason} - \`${reference}\``;
    if (line.trim() === desired) return line;
    changed = true;
    return desired;
  });
  const cleaned = updated
    .replace(/^\s*[-*]\s*(?:Reviewer|Core) instructions are outdated \(baseline is outdated\)\.\s*$/gmi, "")
    .replace(/\nConsistency blockers:\s*\n(?=\s*Next action:)/g, "\n");
  if (cleaned !== updated) {
    updated = cleaned;
    changed = true;
  }
  if (!changed) return "";
  if (!dryRun) {
    backupProjectFileSync(projectRoot, statePath, migrationDir, backedUp);
    fs.writeFileSync(statePath, `${updated.trimEnd()}\n`, "utf8");
  }
  return projectRelativePath(projectRoot, statePath);
}

function migrateActiveReviewStorageSync(projectRoot, migrationDir, { dryRun = false } = {}) {
  const trialDirs = activeTrialDirsSync(projectRoot);
  const latestTrial = trialDirs.at(-1) || "";
  const allowLatestBackfill = Boolean(latestTrial && projectGateTextPassedSync(projectRoot));
  const latestPass = latestSavedPassSectionsSync(projectRoot, trialDirs);
  const backedUp = [];
  const created = [];
  const backfilled = [];
  const placeholders = [];
  for (const trialDir of trialDirs) {
    const legacyPath = path.join(trialDir, "REVIEW.md");
    const legacySections = {};
    if (fs.existsSync(legacyPath)) {
      for (const section of parseReviewerSections(fs.readFileSync(legacyPath, "utf8"), projectRelativePath(projectRoot, legacyPath))) {
        legacySections[section.key] = section;
      }
    }
    for (const [key, config] of Object.entries(REQUIRED_REVIEWER_OUTPUTS)) {
      const target = reviewerOutputPath(trialDir, key);
      if (fs.existsSync(target)) continue;
      let source = legacySections[key];
      let contextSummary = "Created from the legacy trial REVIEW.md section during per-reviewer migration.";
      if (!source && allowLatestBackfill && trialDir === latestTrial && latestPass[key]) {
        source = latestPass[key];
        contextSummary = "Backfilled from the latest saved passing reviewer output for the current active gate. This preserves pass provenance but is not a fresh reviewer run for this trial.";
        backfilled.push(projectRelativePath(projectRoot, target));
      } else if (!source) {
        placeholders.push(projectRelativePath(projectRoot, target));
      }
      created.push(projectRelativePath(projectRoot, target));
      if (dryRun) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(legacyPath)) backupProjectFileSync(projectRoot, legacyPath, migrationDir, backedUp);
      const body = source?.text || "";
      fs.writeFileSync(target, formatReviewerFile(projectRoot, trialDir, key, {
        decision: source?.decision || "continue",
        gate: source?.gate || source?.decision || "continue",
        confidence: source?.confidence || "low",
        migrationSource: source?.path || `missing legacy ${config.label} section`,
        contextSummary: source ? contextSummary : "No legacy reviewer section existed for this active trial. This file records the missing review explicitly.",
        body
      }), "utf8");
    }
  }
  const normalizedManuscriptReviews = [];
  const manuscriptReviews = path.join(projectRoot, "manuscript", "reviews");
  if (fs.existsSync(manuscriptReviews)) {
    for (const name of fs.readdirSync(manuscriptReviews).filter((item) => item.endsWith(".md") && item !== ".gitkeep").sort()) {
      const target = path.join(manuscriptReviews, name);
      let text = fs.readFileSync(target, "utf8");
      if (text.includes("Source trial:") && text.includes("## Reviewed Inputs") && text.includes("Migration source:")) continue;
      const section = parseReviewerSections(text, projectRelativePath(projectRoot, target))[0] || {};
      const key = section.key || "manuscript";
      const trialMatch = path.basename(name, ".md").match(/^0*(\d+)/);
      const sourceTrial = firstRegexValue(text, [/^Source trial:\s*`?([^`\n]+)`?/im]) || (trialMatch ? trialMatch[1] : path.basename(name, ".md"));
      const insertion = [
        `Source trial: \`${sourceTrial}\``,
        `Generated at: ${new Date().toISOString()}`,
        `Instruction file: \`${(REQUIRED_REVIEWER_OUTPUTS[key] || REQUIRED_REVIEWER_OUTPUTS.manuscript).instruction}\``,
        `Migration source: \`${projectRelativePath(projectRoot, target)}\``,
        "",
        "## Reviewed Inputs",
        "",
        "- `manuscript/BLUEPRINT.md`",
        "- `research_trajectory/STATE.md`",
        "- `research_trajectory/CURRENT_FINDINGS.md`",
        "",
        "## Context Summary",
        "",
        "Normalized active manuscript review metadata during per-reviewer migration.",
        ""
      ].join("\n");
      normalizedManuscriptReviews.push(projectRelativePath(projectRoot, target));
      if (dryRun) continue;
      backupProjectFileSync(projectRoot, target, migrationDir, backedUp);
      text = /^Confidence:\s*.+?$/im.test(text) ? text.replace(/^Confidence:\s*.+?$/im, (line) => `${line}\n${insertion}`) : `${insertion}\n${text}`;
      fs.writeFileSync(target, `${text.trimEnd()}\n`, "utf8");
    }
  }
  const normalizedState = normalizeStateGateReferencesSync(projectRoot, latestTrial, migrationDir, backedUp, dryRun);
  return {
    storageVersion: REVIEW_STORAGE_VERSION,
    trialCount: trialDirs.length,
    created,
    backfilled,
    placeholders,
    normalizedManuscriptReviews,
    normalizedState,
    backedUp,
    outdated: Boolean(created.length || normalizedManuscriptReviews.length || normalizedState)
  };
}

function projectReviewStorageStatusSync(projectRoot) {
  const trialDirs = activeTrialDirsSync(projectRoot);
  const latestTrial = trialDirs.at(-1) || "";
  const missingByTrial = {};
  const nonpassingLatest = [];
  for (const trialDir of trialDirs) {
    const missing = [];
    for (const [key, config] of Object.entries(REQUIRED_REVIEWER_OUTPUTS)) {
      const target = reviewerOutputPath(trialDir, key);
      if (!fs.existsSync(target)) {
        missing.push(config.file);
        continue;
      }
      if (trialDir === latestTrial && projectGateTextPassedSync(projectRoot)) {
        const text = fs.readFileSync(target, "utf8");
        const decision = normalizeGateStatus(firstRegexValue(text, [/^Decision:\s*`?([^`\n]+)`?/im]));
        const gate = normalizeGateStatus(firstRegexValue(text, [/^Gate impact:\s*`?([^`\n]+)`?/im]));
        if (decision !== "pass" || gate !== "pass") nonpassingLatest.push(config.file);
      }
    }
    if (missing.length) missingByTrial[path.basename(trialDir)] = missing;
  }
  const stateMissingReferences = [];
  const stateStatusMismatches = [];
  const stateStaleConsistencyBlockers = [];
  const statePath = path.join(projectRoot, "research_trajectory", "STATE.md");
  const stateText = fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : "";
  if (latestTrial && stateText) {
    if (/(?:Reviewer|Core) instructions are outdated \(baseline is outdated\)\./i.test(stateText)) {
      stateStaleConsistencyBlockers.push("Core instructions are outdated (baseline is outdated).");
    }
    for (const [key, config] of Object.entries(REQUIRED_REVIEWER_OUTPUTS)) {
      const reviewPath = reviewerOutputPath(latestTrial, key);
      const expected = projectRelativePath(projectRoot, reviewPath);
      if (!stateText.includes(expected)) stateMissingReferences.push(expected);
      const escaped = config.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = stateText.match(new RegExp(`^\\s*[-*]\\s*${escaped}\\s*:\\s*(.+?)\\s*$`, "im"));
      if (match && fs.existsSync(reviewPath)) {
        const stateStatus = normalizeGateStatus(match[1]);
        const fileStatus = reviewerFileStatusSync(reviewPath);
        if (fileStatus !== "missing" && stateStatus !== fileStatus) {
          stateStatusMismatches.push(`${config.label}: state ${stateStatus}, file ${fileStatus}`);
        }
      }
    }
  }
  const manuscriptReviewsMissingMetadata = [];
  const manuscriptReviews = path.join(projectRoot, "manuscript", "reviews");
  if (fs.existsSync(manuscriptReviews)) {
    for (const name of fs.readdirSync(manuscriptReviews).filter((item) => item.endsWith(".md") && item !== ".gitkeep")) {
      const target = path.join(manuscriptReviews, name);
      const text = fs.readFileSync(target, "utf8");
      if (!text.includes("Source trial:") || !text.includes("## Reviewed Inputs") || !text.includes("Migration source:")) manuscriptReviewsMissingMetadata.push(projectRelativePath(projectRoot, target));
    }
  }
  return {
    schemaVersion: 1,
    storageVersion: REVIEW_STORAGE_VERSION,
    requiredFiles: Object.values(REQUIRED_REVIEWER_OUTPUTS).map((config) => config.file),
    missingByTrial,
    nonpassingLatest,
    stateMissingReferences,
    stateStatusMismatches,
    stateStaleConsistencyBlockers,
    manuscriptReviewsMissingMetadata,
    outdated: Boolean(Object.keys(missingByTrial).length || nonpassingLatest.length || stateMissingReferences.length || stateStatusMismatches.length || stateStaleConsistencyBlockers.length || manuscriptReviewsMissingMetadata.length)
  };
}

function projectReviewerStatusSync(projectRoot) {
  const templateHashes = reviewerTemplateHashesSync();
  const reviewerDir = path.join(projectRoot, "instructions", "reviewers");
  const protocolTemplateHashes = protocolTemplateHashesSync();
  const instructionDir = path.join(projectRoot, "instructions");
  const metadataPath = path.join(projectRoot, REVIEWER_BASELINE_PATH);
  const missing = [];
  const changed = [];
  const hashes = {};
  for (const name of CORE_REVIEWER_FILES) {
    const projectPath = path.join(reviewerDir, name);
    if (!fs.existsSync(projectPath)) {
      missing.push(name);
      continue;
    }
    const hash = sha256FileSync(projectPath);
    hashes[name] = hash;
    if (templateHashes[name] && hash !== templateHashes[name]) changed.push(name);
  }
  const protocolMissing = [];
  const protocolChanged = [];
  const protocolHashes = {};
  for (const name of CORE_PROTOCOL_FILES) {
    const projectPath = path.join(instructionDir, name);
    if (!fs.existsSync(projectPath)) {
      protocolMissing.push(name);
      continue;
    }
    const hash = sha256FileSync(projectPath);
    protocolHashes[name] = hash;
    if (protocolTemplateHashes[name] && hash !== protocolTemplateHashes[name]) protocolChanged.push(name);
  }
  let metadata = {};
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = readJsonSync(metadataPath);
    } catch {
      metadata = {};
    }
  }
  const metadataHashes = metadata && typeof metadata.coreReviewerFiles === "object" ? metadata.coreReviewerFiles : {};
  const metadataMissing = CORE_REVIEWER_FILES.filter((name) => metadataHashes[name] !== templateHashes[name]);
  const protocolMetadataHashes = metadata && typeof metadata.coreProtocolFiles === "object" ? metadata.coreProtocolFiles : {};
  const protocolMetadataMissing = CORE_PROTOCOL_FILES.filter((name) => protocolMetadataHashes[name] !== protocolTemplateHashes[name]);
  const baselineVersion = String(metadata.reviewerBaselineVersion || "");
  const reviewStorage = projectReviewStorageStatusSync(projectRoot);
  return {
    baselineVersion,
    latestBaselineVersion: REVIEWER_BASELINE_VERSION,
    outdated: Boolean(
      missing.length ||
      changed.length ||
      metadataMissing.length ||
      protocolMissing.length ||
      protocolChanged.length ||
      protocolMetadataMissing.length ||
      baselineVersion !== REVIEWER_BASELINE_VERSION ||
      reviewStorage.outdated
    ),
    missing,
    changed,
    metadataMissing,
    protocolMissing,
    protocolChanged,
    protocolMetadataMissing,
    metadataPath: REVIEWER_BASELINE_PATH,
    hashes,
    protocolHashes,
    reviewStorage
  };
}

function syncProjectReviewersSync(projectRoot, { dryRun = false } = {}) {
  const status = projectReviewerStatusSync(projectRoot);
  const migrationId = `${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z")}_${randomUUID().slice(0, 8)}`;
  const reviewerDir = path.join(projectRoot, "instructions", "reviewers");
  const instructionDir = path.join(projectRoot, "instructions");
  const backupRoot = path.join(projectRoot, "archive", "template_migrations", migrationId, "instructions", "reviewers");
  const protocolBackupRoot = path.join(projectRoot, "archive", "template_migrations", migrationId, "instructions");
  if (dryRun) {
    const dryRunMigrationDir = path.join(projectRoot, "archive", "template_migrations", "DRY_RUN");
    return {
      ok: true,
      dryRun: true,
      migrationId: "",
      before: status,
      after: status,
      copied: [],
      backedUp: [],
      protocolCopied: [],
      protocolBackedUp: [],
      backupPath: "",
      reviewStorage: migrateActiveReviewStorageSync(projectRoot, dryRunMigrationDir, { dryRun: true })
    };
  }
  fs.mkdirSync(reviewerDir, { recursive: true });
  fs.mkdirSync(instructionDir, { recursive: true });
  const copied = [];
  const backedUp = [];
  for (const name of CORE_REVIEWER_FILES) {
    const source = path.join(reviewerTemplateDir(), name);
    if (!fs.existsSync(source)) throw new Error(`Package reviewer file is missing: ${name}`);
    const target = path.join(reviewerDir, name);
    if (fs.existsSync(target)) {
      fs.mkdirSync(backupRoot, { recursive: true });
      fs.copyFileSync(target, path.join(backupRoot, name));
      backedUp.push(name);
    }
    fs.copyFileSync(source, target);
    copied.push(name);
  }
  const protocolCopied = [];
  const protocolBackedUp = [];
  for (const name of CORE_PROTOCOL_FILES) {
    const source = path.join(instructionTemplateDir(), name);
    if (!fs.existsSync(source)) throw new Error(`Package instruction file is missing: ${name}`);
    const target = path.join(instructionDir, name);
    if (fs.existsSync(target)) {
      fs.mkdirSync(protocolBackupRoot, { recursive: true });
      fs.copyFileSync(target, path.join(protocolBackupRoot, name));
      protocolBackedUp.push(name);
    }
    fs.copyFileSync(source, target);
    protocolCopied.push(name);
  }
  const metadata = writeReviewerBaselineMetadataSync(projectRoot);
  const migrationDir = path.join(projectRoot, "archive", "template_migrations", migrationId);
  fs.mkdirSync(migrationDir, { recursive: true });
  const reviewStorage = migrateActiveReviewStorageSync(projectRoot, migrationDir);
  fs.writeFileSync(
    path.join(migrationDir, "MIGRATION.md"),
    [
      `# Reviewer Migration ${migrationId}`,
      "",
      `- Created: ${new Date().toISOString()}`,
      `- Reviewer baseline: \`${REVIEWER_BASELINE_VERSION}\``,
      `- Copied core reviewers: ${copied.length}`,
      `- Backed up previous core reviewers: ${backedUp.length}`,
      `- Copied core protocol instructions: ${protocolCopied.length}`,
      `- Backed up previous core protocol instructions: ${protocolBackedUp.length}`,
      `- Metadata: \`${REVIEWER_BASELINE_PATH}\``,
      `- Review storage version: \`${REVIEW_STORAGE_VERSION}\``,
      `- Created per-reviewer files: ${reviewStorage.created.length}`,
      `- Backfilled latest-gate files: ${reviewStorage.backfilled.length}`,
      `- Explicit missing-review placeholders: ${reviewStorage.placeholders.length}`,
      `- Normalized manuscript reviews: ${reviewStorage.normalizedManuscriptReviews.length}`,
      "",
      "Custom reviewer files outside the core reviewer set were preserved.",
      "Custom instruction files outside the core protocol set were preserved.",
      "Archived restart/resume history was not rewritten.",
      ""
    ].join("\n"),
    "utf8"
  );
  return {
    ok: true,
    dryRun: false,
    migrationId,
    backupPath: path.relative(projectRoot, migrationDir),
    copied,
    backedUp,
    protocolCopied,
    protocolBackedUp,
    reviewStorage,
    before: status,
    after: projectReviewerStatusSync(projectRoot),
    metadata
  };
}

function isProjectRootSync(root) {
  return (
    fs.existsSync(path.join(root, ".co-auto-research", "project.json")) ||
    fs.existsSync(path.join(root, ".co-auto-research-template", "manifest.json")) ||
    (fs.existsSync(path.join(root, "AGENTS.md")) &&
      fs.existsSync(path.join(root, "PROJECT.md")) &&
      fs.existsSync(path.join(root, "research_trajectory")))
  );
}

function readProjectMetadataSync(root) {
  const metadataPath = path.join(root, ".co-auto-research", "project.json");
  if (!fs.existsSync(metadataPath)) return {};
  try {
    const payload = readJsonSync(metadataPath);
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

function readProjectRuntimeStatusSync(root) {
  const sessionPath = path.join(root, "ui", ".runtime", "research_session.json");
  if (!fs.existsSync(sessionPath)) return "new";
  try {
    const payload = readJsonSync(sessionPath);
    const status = String(payload.status || "").trim();
    if (status === "running" || status === "stopping") return "interrupted";
    if (status) return status;
  } catch {
    return "unknown";
  }
  return "idle";
}

function projectDirectorySlug(value) {
  const text = String(value || "").trim();
  return text.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[ ._-]+|[ ._-]+$/g, "").slice(0, 80) || "project";
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function addProjectCandidate(candidates, root) {
  const resolved = path.resolve(root);
  if (!isProjectRootSync(resolved)) return;
  let key = resolved;
  try {
    key = fs.realpathSync.native(resolved);
  } catch {
    key = resolved;
  }
  if (candidates.has(key)) return;
  const metadata = readProjectMetadataSync(resolved);
  const name = String(metadata.displayName || "").trim() || path.basename(resolved) || "project";
  const relativePath = path.relative(process.cwd(), resolved) || ".";
  candidates.set(key, {
    id: String(metadata.projectId || "").trim(),
    name,
    slug: projectDirectorySlug(name),
    directory: path.basename(resolved),
    path: resolved,
    relativePath,
    status: readProjectRuntimeStatusSync(resolved),
    templateVersion: String(metadata.templateVersion || "").trim(),
    reviewerStatus: projectReviewerStatusSync(resolved)
  });
}

function scanImmediateProjects(candidates, directory) {
  if (!fs.existsSync(directory)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "__pycache__") continue;
    const candidate = path.join(directory, entry.name);
    let stats;
    try {
      stats = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    addProjectCandidate(candidates, candidate);
  }
}

function collectProjectCandidates(options = {}) {
  const candidates = new Map();
  if (options["projects-dir"]) {
    const projectsDir = path.resolve(process.cwd(), options["projects-dir"]);
    addProjectCandidate(candidates, projectsDir);
    scanImmediateProjects(candidates, projectsDir);
  } else {
    const cwd = process.cwd();
    addProjectCandidate(candidates, cwd);
    scanImmediateProjects(candidates, cwd);
    scanImmediateProjects(candidates, path.join(cwd, DEFAULT_PROJECTS_DIR));
    scanImmediateProjects(candidates, path.join(cwd, LEGACY_PROJECTS_DIR));
  }
  return [...candidates.values()].sort((a, b) => {
    if (a.relativePath === ".") return -1;
    if (b.relativePath === ".") return 1;
    return a.relativePath.localeCompare(b.relativePath);
  });
}

function printProjectTable(projects) {
  const rows = projects.map((project, index) => [
    String(index + 1),
    project.name,
    project.status,
    project.reviewerStatus?.outdated ? "outdated" : "current",
    project.relativePath
  ]);
  const headers = ["#", "name", "status", "reviewers", "path"];
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => row[column].length)));
  const format = (row) => row.map((value, column) => value.padEnd(widths[column])).join("  ");
  console.log(format(headers));
  console.log(format(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(format(row));
}

function commandList(args) {
  const { options, rest } = parseOptions(args);
  if (rest.length > 0) {
    throw new Error("Unexpected argument. Usage: co-auto-research ls [--projects-dir <dir>]");
  }
  const projects = collectProjectCandidates(options);
  if (projects.length === 0) {
    const root = options["projects-dir"] ? path.resolve(process.cwd(), options["projects-dir"]) : process.cwd();
    console.log(`No CoAutoResearch projects found under ${root}`);
    console.log("Create one with `co-auto-research init <dir>` or start the dashboard with `co-auto-research ui`.");
    return;
  }
  console.log(`Found ${projects.length} CoAutoResearch project${projects.length === 1 ? "" : "s"}:`);
  printProjectTable(projects);
  console.log("");
  console.log("Open one with:");
  const first = projects[0];
  const duplicateName = projects.some((project, index) => index > 0 && project.name === first.name);
  console.log(`  co-auto-research attach ${shellQuote(duplicateName ? first.relativePath : first.name)}`);
}

function projectMatchesTarget(project, target) {
  const normalizedTarget = String(target || "").trim().toLowerCase();
  if (!normalizedTarget) return false;
  const directValues = [
    project.name,
    project.slug,
    project.directory,
    project.relativePath,
    path.normalize(project.relativePath),
    project.path
  ].map((value) => String(value || "").trim().toLowerCase());
  if (directValues.includes(normalizedTarget)) return true;
  return Boolean(project.id && normalizedTarget.length >= 4 && project.id.toLowerCase().startsWith(normalizedTarget));
}

function resolveAttachProject(targetArg, options) {
  const target = String(targetArg || "").trim();
  if (target) {
    const directPath = path.resolve(process.cwd(), target);
    if (isProjectRootSync(directPath)) {
      const candidates = new Map();
      addProjectCandidate(candidates, directPath);
      return [...candidates.values()][0];
    }
  }

  const projects = collectProjectCandidates(options);
  if (!target) {
    if (projects.length === 1) return projects[0];
    if (projects.length === 0) {
      throw new Error("No CoAutoResearch project found. Run `co-auto-research ls` to inspect this folder, or create one with `co-auto-research init <dir>`.");
    }
    throw new Error("Multiple CoAutoResearch projects found. Run `co-auto-research ls` and pass a project name or path to `co-auto-research attach <project>`.");
  }

  const matches = projects.filter((project) => projectMatchesTarget(project, target));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const names = matches.map((project) => `${project.name} (${project.relativePath})`).join(", ");
    throw new Error(`Project name is ambiguous: ${target}. Matches: ${names}`);
  }
  throw new Error(`No CoAutoResearch project matched ${shellQuote(target)}. Run \`co-auto-research ls\` to see available projects.`);
}

function commandAttach(args) {
  const { options, rest } = parseOptions(args);
  if (rest.length > 1) {
    throw new Error("Usage: co-auto-research attach [project-name-or-path] [--projects-dir <dir>] [--host 127.0.0.1] [--port 8765] [--open] [--no-open] [--remote]");
  }
  const project = resolveAttachProject(rest[0] || options.project || "", options);
  console.log(`Attaching to ${project.name} (${project.relativePath})`);
  const uiArgs = ["--project", project.path];
  for (const name of ["host", "port"]) {
    if (options[name]) uiArgs.push(`--${name}`, options[name]);
  }
  for (const name of ["open", "no-open", "remote"]) {
    if (options[name]) uiArgs.push(`--${name}`);
  }
  return commandUi(uiArgs);
}

async function commandInit(args) {
  const targetArg = args[0];
  if (!targetArg) {
    throw new Error("Missing target directory. Usage: co-auto-research init <dir>");
  }
  if (!(await pathExists(TEMPLATE_ROOT))) {
    throw new Error(`Template directory is missing: ${TEMPLATE_ROOT}`);
  }
  const target = path.resolve(process.cwd(), targetArg);
  await assertDirectoryEmptyOrMissing(target);
  await fsp.mkdir(target, { recursive: true });
  await fsp.cp(TEMPLATE_ROOT, target, {
    recursive: true,
    errorOnExist: false,
    force: false,
    preserveTimestamps: true
  });
  await finalizeGeneratedProject(target);
  const manifest = await readJson(MANIFEST_PATH);
  console.log(`Created CoAutoResearch project at ${target}`);
  console.log(`Template version: ${manifest.templateVersion}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${path.relative(process.cwd(), target) || "."}`);
  console.log("  co-auto-research ui");
}

async function finalizeGeneratedProject(target) {
  const templateGitignore = path.join(target, ".gitignore.template");
  const gitignore = path.join(target, ".gitignore");
  if (await pathExists(templateGitignore)) {
    if (!(await pathExists(gitignore))) {
      await fsp.rename(templateGitignore, gitignore);
    } else {
      await fsp.rm(templateGitignore, { force: true });
    }
  }
  await ensureProjectMetadata(target);
  writeReviewerBaselineMetadataSync(target);
}

async function ensureProjectMetadata(target) {
  const metadataDir = path.join(target, ".co-auto-research");
  const metadataPath = path.join(metadataDir, "project.json");
  if (await pathExists(metadataPath)) return;
  const manifest = await readJson(MANIFEST_PATH);
  await fsp.mkdir(metadataDir, { recursive: true });
  const payload = {
    schemaVersion: 1,
    projectId: randomUUID(),
    displayName: path.basename(target),
    createdAt: new Date().toISOString(),
    templateVersion: manifest.templateVersion || "0.1.0"
  };
  await fsp.writeFile(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function commandAvailable(name, args = ["--version"]) {
  const result = spawnSync(name, args, { encoding: "utf8" });
  const output = [result.stdout, result.stderr].filter(Boolean).join("").trim();
  return {
    ok: result.status === 0 || Boolean(output),
    status: result.status,
    output: output.split(/\r?\n/)[0] || ""
  };
}

function executableNames(name) {
  return process.platform === "win32" ? [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name] : [name];
}

function findOnPath(name, env = process.env) {
  const pathValue = env.PATH || env.Path || env.path || "";
  const entries = pathValue.split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    for (const candidateName of executableNames(name)) {
      const candidate = path.join(entry, candidateName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

function invokedViaNpx(env = process.env) {
  const pathValue = env.PATH || env.Path || env.path || "";
  return env.npm_command === "exec" || env.npm_lifecycle_event === "npx" || /(^|[\\/])_npx[\\/]/.test(pathValue);
}

function coAutoResearchCommand(env = process.env) {
  const configured = String(env.COAUTO_CLI_COMMAND || "").trim();
  if (configured) return configured;
  if (invokedViaNpx(env)) return "npx --yes co-auto-research";
  return findOnPath("co-auto-research", env) ? "co-auto-research" : "npx --yes co-auto-research";
}

function userHomeDir(env = process.env) {
  return env.HOME || env.USERPROFILE || os.homedir();
}

function defaultCloudflaredInstallDir(env = process.env) {
  const configured = String(env.COAUTO_CLOUDFLARED_INSTALL_DIR || "").trim();
  if (configured) return path.resolve(configured.replace(/^~(?=$|[\\/])/, userHomeDir(env)));
  if (process.platform === "win32") {
    return path.join(env.LOCALAPPDATA || path.join(userHomeDir(env), "AppData", "Local"), "CoAutoResearch", "bin");
  }
  return path.join(userHomeDir(env), ".local", "bin");
}

function defaultCloudflaredPath(env = process.env) {
  return path.join(defaultCloudflaredInstallDir(env), process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
}

function findCodexCommand(env = process.env) {
  return findAgentCommand("codex", env);
}

function findClaudeCommand(env = process.env) {
  return findAgentCommand("claude", env);
}

function findAgentCommand(agent, env = process.env) {
  const configured = agent === "claude"
    ? (env.COAUTO_CLAUDE || env.CLAUDE_BIN || "").trim().replace(/^"|"$/g, "")
    : (env.COAUTO_CODEX || env.CODEX_BIN || "").trim().replace(/^"|"$/g, "");
  if (configured) {
    const expanded = configured.replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || "~");
    if (fs.existsSync(expanded)) return expanded;
    const configuredOnPath = findOnPath(expanded, env);
    if (configuredOnPath) return configuredOnPath;
    return expanded;
  }
  return findOnPath(agent, env) || agent;
}

function findCloudflaredCommand(env = process.env) {
  const configured = (env.COAUTO_CLOUDFLARED || "").trim().replace(/^"|"$/g, "");
  if (configured) {
    const expanded = configured.replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || "~");
    if (fs.existsSync(expanded)) return expanded;
    const configuredOnPath = findOnPath(expanded, env);
    if (configuredOnPath) return configuredOnPath;
    return expanded;
  }
  const onPath = findOnPath("cloudflared", env);
  if (onPath) return onPath;
  const defaultLocal = defaultCloudflaredPath(env);
  if (fs.existsSync(defaultLocal)) return defaultLocal;
  return "cloudflared";
}

function codexAvailable() {
  return agentAvailable("codex");
}

function claudeAvailable() {
  return agentAvailable("claude");
}

function agentAvailable(agent) {
  const command = agent === "claude" ? findClaudeCommand() : findCodexCommand();
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(command, ["--version"], { encoding: "utf8", shell });
  const output = [result.stdout, result.stderr].filter(Boolean).join("").trim();
  return {
    ok: result.status === 0,
    status: result.status,
    output: output.split(/\r?\n/)[0] || command
  };
}

function cloudflaredAvailable(env = process.env) {
  const command = findCloudflaredCommand(env);
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(command, ["--version"], { encoding: "utf8", shell });
  const output = [result.stdout, result.stderr].filter(Boolean).join("").trim();
  return {
    ok: result.status === 0,
    status: result.status,
    command,
    output: output.split(/\r?\n/)[0] || "required for best --remote experience"
  };
}

function selectedAgentBackend(env = process.env) {
  const backend = String(env.COAUTO_AGENT_BACKEND || "codex").trim().toLowerCase();
  return backend === "claude" ? "claude" : "codex";
}

function invalidAgentBackendEnv(env = process.env) {
  const backend = String(env.COAUTO_AGENT_BACKEND || "").trim().toLowerCase();
  return Boolean(backend && !["codex", "claude"].includes(backend));
}

function pythonCandidates() {
  const candidates = [];
  const configured = (process.env.COAUTO_PYTHON || process.env.PYTHON || "").trim();
  if (configured) candidates.push({ command: configured, args: [], label: configured });
  candidates.push({ command: "python3", args: [], label: "python3" });
  candidates.push({ command: "python", args: [], label: "python" });
  candidates.push({ command: "py", args: ["-3"], label: "py -3" });
  return candidates;
}

function findPythonCommand() {
  for (const candidate of pythonCandidates()) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], { encoding: "utf8" });
    const output = [result.stdout, result.stderr].filter(Boolean).join("").trim().split(/\r?\n/)[0] || "";
    if (result.status === 0) {
      return { ...candidate, output, ok: true };
    }
  }
  return { command: "", args: [], label: "python3/python/py -3", output: "", ok: false };
}

function checkPort(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => resolve({ ok: false, error: error.message }));
    server.once("listening", () => {
      server.close(() => resolve({ ok: true }));
    });
    server.listen(Number(port), host);
  });
}

function shouldAutoOpenBrowser(options) {
  if (options.remote) return false;
  if (options["no-open"] || process.env.COAUTO_NO_OPEN) return false;
  if (options.open) return true;
  if (process.env.CI) return false;
  if (process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY) return false;
  return Boolean(process.stdout.isTTY);
}

function localhostHost(host) {
  return ["", "127.0.0.1", "localhost", "::1"].includes(String(host || "").toLowerCase());
}

function remoteSshTarget() {
  if (process.env.COAUTO_REMOTE_TARGET) return process.env.COAUTO_REMOTE_TARGET;
  const user = process.env.USER || process.env.LOGNAME || process.env.USERNAME || "user";
  return `${user}@<ssh-host>`;
}

function remoteMode() {
  return String(process.env.COAUTO_REMOTE_MODE || "cloudflare").trim().toLowerCase();
}

function remoteTunnelMockConfigured() {
  return Boolean(process.env.COAUTO_REMOTE_TUNNEL_MOCK_URL || process.env.COAUTO_REMOTE_TUNNEL_MOCK_FAIL);
}

function spinnerEnabled(stream = process.stderr) {
  return Boolean(stream.isTTY && !process.env.CI && !process.env.COAUTO_NO_SPINNER);
}

function startSpinner(message) {
  const stream = process.stderr;
  if (!spinnerEnabled(stream)) {
    console.log(message);
    return {
      stop: () => {},
      update: () => {}
    };
  }
  const frames = ["-", "\\", "|", "/"];
  let index = 0;
  let current = message;
  let active = true;
  const clearLine = () => {
    stream.write(`\r${" ".repeat(current.length + 4)}\r`);
  };
  const render = () => {
    stream.write(`\r${frames[index % frames.length]} ${current}`);
    index += 1;
  };
  render();
  const timer = setInterval(render, 120);
  timer.unref?.();
  return {
    update: (nextMessage) => {
      current = nextMessage;
      render();
    },
    stop: () => {
      if (!active) return;
      active = false;
      clearInterval(timer);
      clearLine();
    }
  };
}

function cloudflareTunnelUrlFromText(value) {
  const candidates = String(value || "").match(/https:\/\/[^\s"'<>`]+/g) || [];
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[),.;:]+$/, "");
    try {
      const parsed = new URL(cleaned);
      const hostname = parsed.hostname.toLowerCase();
      if (!hostname.endsWith(".trycloudflare.com")) continue;
      if (hostname === "api.trycloudflare.com") continue;
      if (parsed.pathname && parsed.pathname !== "/") continue;
      return parsed.origin;
    } catch {
      // Keep scanning; cloudflared may print other URLs in diagnostic output.
    }
  }
  return "";
}

function remoteSetupError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function closeChildProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
      resolve();
    }, 3000);
    timeout.unref?.();
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function printCloudflaredInstallInstructions() {
  const cli = coAutoResearchCommand();
  console.log("");
  console.log("Remote mode needs cloudflared to create a browser link.");
  console.log("");
  console.log("Cloudflare CLI setup");
  console.log("");
  console.log("1. Install cloudflared");
  console.log("   Linux (no sudo):");
  console.log(`     ${cli} install-cloudflared`);
  console.log("");
  console.log("   macOS/Homebrew:");
  console.log("     brew install cloudflared");
  console.log("");
  console.log("   Windows/PowerShell:");
  console.log("     winget install -e --id Cloudflare.cloudflared");
  console.log("");
  console.log("2. Run");
  console.log(`   ${cli} ui --remote`);
  console.log("");
  console.log("3. Check");
  console.log(`   ${cli} doctor`);
  console.log("");
  console.log("Other platforms:");
  console.log("  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
}

function cloudflaredLinuxAssetArch() {
  const arch = process.arch;
  if (arch === "x64") return "amd64";
  if (arch === "arm64") return "arm64";
  if (arch === "ia32") return "386";
  if (arch === "arm") return "arm";
  throw new Error(`cloudflared standalone install is not available for ${process.platform}/${arch}. See https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
}

function cloudflaredStandaloneDownloadUrl(env = process.env) {
  const configured = String(env.COAUTO_CLOUDFLARED_DOWNLOAD_URL || "").trim();
  if (configured) return configured;
  if (process.platform !== "linux") {
    throw new Error("The built-in cloudflared installer currently supports Linux servers. Use Homebrew on macOS or winget on Windows.");
  }
  return `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cloudflaredLinuxAssetArch()}`;
}

async function writeMockCloudflared(target) {
  const body = "#!/bin/sh\necho cloudflared fake installed 0.0.0\n";
  await fsp.writeFile(target, body, "utf8");
}

function runDownloadTool(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal || code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function downloadWithFetch(target, url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch returned ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(target, bytes);
}

async function downloadCloudflared(target, url) {
  const attempts = [];
  const curl = findOnPath("curl");
  if (curl) {
    try {
      await runDownloadTool(curl, ["-L", "--fail", "--show-error", "-o", target, url]);
      return;
    } catch (error) {
      attempts.push(`curl: ${error.message}`);
    }
  }
  const wget = findOnPath("wget");
  if (wget) {
    try {
      await runDownloadTool(wget, ["-O", target, url]);
      return;
    } catch (error) {
      attempts.push(`wget: ${error.message}`);
    }
  }
  try {
    await downloadWithFetch(target, url);
    return;
  } catch (error) {
    attempts.push(`fetch: ${error.message}`);
  }
  throw new Error(`Could not download cloudflared from ${url}\n${attempts.map((line) => `  ${line}`).join("\n")}`);
}

async function commandInstallCloudflared(args) {
  const { rest } = parseOptions(args);
  if (rest.length > 0) {
    throw new Error("Usage: co-auto-research install-cloudflared");
  }
  const available = cloudflaredAvailable();
  if (available.ok) {
    console.log(`cloudflared is already available: ${available.output}`);
    console.log(`Using: ${available.command}`);
    return;
  }
  const target = defaultCloudflaredPath();
  const installDir = path.dirname(target);
  const url = process.env.COAUTO_CLOUDFLARED_INSTALL_MOCK ? "" : cloudflaredStandaloneDownloadUrl();
  const tempTarget = `${target}.download`;
  await fsp.mkdir(installDir, { recursive: true });
  console.log(`Installing cloudflared to ${target}`);
  if (process.env.COAUTO_CLOUDFLARED_INSTALL_MOCK) {
    await writeMockCloudflared(target);
  } else {
    const spinner = startSpinner(`Downloading ${url}`);
    await fsp.rm(tempTarget, { force: true });
    try {
      await downloadCloudflared(tempTarget, url);
      await fsp.rename(tempTarget, target);
    } catch (error) {
      spinner.stop();
      await fsp.rm(tempTarget, { force: true });
      throw error;
    }
    spinner.stop();
  }
  await fsp.chmod(target, 0o755);
  const result = spawnSync(target, ["--version"], { encoding: "utf8" });
  const output = [result.stdout, result.stderr].filter(Boolean).join("").trim().split(/\r?\n/)[0] || "";
  if (result.status !== 0) {
    throw new Error(`Installed cloudflared but could not run it. Try: COAUTO_CLOUDFLARED=${target} co-auto-research doctor`);
  }
  console.log(`Installed cloudflared: ${output}`);
  console.log("");
  console.log("Run:");
  console.log(`  ${coAutoResearchCommand()} ui --remote`);
}

async function startRemoteTunnel(localUrl) {
  const mockUrl = String(process.env.COAUTO_REMOTE_TUNNEL_MOCK_URL || "").trim();
  if (mockUrl) {
    return { url: mockUrl, close: async () => {} };
  }
  if (process.env.COAUTO_REMOTE_TUNNEL_MOCK_FAIL) {
    throw remoteSetupError("cloudflared_failed", "Mock cloudflared failure.");
  }
  const cloudflared = cloudflaredAvailable();
  if (!cloudflared.ok) {
    throw remoteSetupError("cloudflared_missing", `cloudflared was not found (${cloudflared.command}).`);
  }
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(cloudflared.command);
    const child = spawn(cloudflared.command, ["tunnel", "--url", localUrl], {
      stdio: ["ignore", "pipe", "pipe"],
      shell
    });
    let settled = false;
    let output = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void closeChildProcess(child);
      reject(remoteSetupError("cloudflared_failed", `Timed out waiting for cloudflared URL.${output ? `\n${output}` : ""}`));
    }, 60000);
    timeout.unref?.();
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void closeChildProcess(child);
      reject(error);
    };
    const handleChunk = (chunk) => {
      output += chunk.toString();
      const url = cloudflareTunnelUrlFromText(output);
      if (!url || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        url,
        close: () => closeChildProcess(child)
      });
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", handleChunk);
    child.stderr.on("data", handleChunk);
    child.once("error", (error) => {
      fail(remoteSetupError("cloudflared_failed", error.message));
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      fail(remoteSetupError("cloudflared_failed", `cloudflared exited before creating a URL (code=${code}, signal=${signal}).${output ? `\n${output}` : ""}`));
    });
  });
}

function printRemoteSshAccessHint(url, options) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.log(`Open from your local browser with an SSH tunnel to the printed URL: ${url}`);
    return;
  }
  const port = parsed.port || DEFAULT_PORT;
  const localUrl = `http://127.0.0.1:${port}`;
  const target = remoteSshTarget();
  console.log("");
  console.log("Remote browser access");
  console.log("Keep this server command running. In a terminal on your local machine, run:");
  console.log(`  ssh -N -L ${port}:127.0.0.1:${port} ${target}`);
  console.log("");
  console.log("Then open this in your local browser:");
  console.log(`  ${localUrl}`);
  console.log("");
  if (!process.env.COAUTO_REMOTE_TARGET) {
    console.log("Replace <ssh-host> with the same host or alias you used to connect to this server.");
    console.log("Set COAUTO_REMOTE_TARGET=user@host before starting the UI if you want this command printed fully.");
  }
  console.log("VS Code Remote, Cursor Remote, and Codespaces users can instead forward the printed port from the Ports panel.");
  if (!localhostHost(options.host || DEFAULT_HOST)) {
    console.log("");
    console.log(`Warning: --remote is safest with --host 127.0.0.1. Current host is ${options.host}.`);
  }
}

function summarizeCloudflaredFailure(message) {
  const text = String(message || "").trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const quickTunnelTimeout = /api\.trycloudflare\.com\/tunnel/i.test(text) && /context deadline exceeded|Client\.Timeout|awaiting headers/i.test(text);
  if (quickTunnelTimeout) {
    const detail = lines.find((line) => /failed to request quick Tunnel/i.test(line)) || "";
    return {
      summary: "cloudflared could not reach Cloudflare Quick Tunnel before timing out.",
      detail
    };
  }
  const firstUseful = lines.find((line) => !/^20\d\d-\d\d-\d\dT/.test(line)) || lines[0] || "unknown cloudflared error";
  return { summary: firstUseful, detail: "" };
}

async function printRemoteAccessHint(url, options) {
  if (remoteMode() === "ssh") {
    printRemoteSshAccessHint(url, options);
    return null;
  }
  console.log("");
  const spinner = startSpinner("Creating Cloudflare link...");
  try {
    const tunnel = await startRemoteTunnel(url);
    spinner.stop();
    console.log("");
    console.log("Open:");
    console.log(`  ${tunnel.url}`);
    console.log("");
    console.log("Keep this terminal open. Press Ctrl+C to stop.");
    return tunnel;
  } catch (error) {
    spinner.stop();
    console.log("");
    if (error.code === "cloudflared_missing") {
      printCloudflaredInstallInstructions();
    } else {
      const failure = summarizeCloudflaredFailure(error.message);
      console.log(`Cloudflare link failed: ${failure.summary}`);
      if (failure.detail) console.log(`Details: ${failure.detail}`);
      console.log("");
      console.log("Check that cloudflared can reach Cloudflare, then rerun:");
      console.log(`  ${coAutoResearchCommand()} ui --remote`);
      console.log("");
      console.log("Advanced SSH fallback:");
      console.log(`  COAUTO_REMOTE_MODE=ssh ${coAutoResearchCommand()} ui --remote`);
    }
    return null;
  }
}

function openBrowser(url) {
  let command = "";
  let args = [];
  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      console.log(`Could not open a browser automatically. Open ${url} manually.`);
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function attachServerOutput(child, options) {
  const autoOpen = shouldAutoOpenBrowser(options);
  const remoteState = { tunnel: null, tunnelPromise: null };
  let opened = false;
  let remoteHintShown = false;
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    if ((!autoOpen || opened) && (!options.remote || remoteHintShown)) return;

    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || "";
    for (const line of lines) {
      const match = line.match(/^Open\s+(https?:\/\/\S+)/);
      if (!match) continue;
      if (options.remote && !remoteHintShown) {
        remoteHintShown = true;
        remoteState.tunnelPromise = printRemoteAccessHint(match[1], options)
          .then((tunnel) => {
            remoteState.tunnel = tunnel;
            return tunnel;
          })
          .catch((error) => {
            console.log(`Remote browser access setup failed: ${error.message}`);
            return null;
          });
      }
      if (autoOpen && !opened) {
        opened = true;
        const ok = openBrowser(match[1]);
        if (ok) console.log(`Opened ${match[1]} in your browser.`);
        else console.log(`Could not open a browser automatically. Open ${match[1]} manually.`);
      }
      break;
    }
  });
  return remoteState;
}

async function commandDoctor(args) {
  const { options } = parseOptions(args);
  const host = options.host || DEFAULT_HOST;
  const port = options.port || DEFAULT_PORT;
  const python = findPythonCommand();
  const cloudflared = cloudflaredAvailable();
  const selectedBackend = selectedAgentBackend();
  const codex = codexAvailable();
  const claude = claudeAvailable();
  const anyAgent = codex.ok || claude.ok;
  const checks = [
    ["node", { ok: Number(process.versions.node.split(".")[0]) >= 18, output: process.version }],
    ["python", { ok: python.ok, output: python.output || python.label }],
    ["git", commandAvailable("git")],
    ["cloudflared", cloudflared],
    ["codex", codex],
    ["claude", claude]
  ];

  for (const [name, result] of checks) {
    const selectedMissing = name === selectedBackend && !result.ok;
    const cloudflaredMissing = name === "cloudflared" && !result.ok;
    const agentMissing = (name === "codex" || name === "claude") && !result.ok;
    const label = result.ok ? "ok" : cloudflaredMissing || selectedMissing || !anyAgent && agentMissing ? "warn" : agentMissing ? "optional" : "missing";
    console.log(`${label.padEnd(7)} ${name}${result.output ? ` - ${result.output}` : ""}`);
  }
  const selectedAgent = selectedBackend === "claude" ? claude : codex;
  console.log(`${selectedAgent.ok ? "ok" : "warn"}      selected agent - ${selectedBackend}${!selectedAgent.ok && anyAgent ? " (selected backend missing; another agent is available)" : ""}`);
  if (invalidAgentBackendEnv()) {
    console.log(`warn    COAUTO_AGENT_BACKEND - invalid value ${JSON.stringify(process.env.COAUTO_AGENT_BACKEND)}; expected "codex" or "claude"`);
  }

  const portCheck = await checkPort(host, port);
  console.log(`${(portCheck.ok ? "ok" : "warn").padEnd(7)} port ${host}:${port}${portCheck.error ? ` - ${portCheck.error}` : ""}`);

  const packageUi = path.join(TEMPLATE_ROOT, "ui", "server.py");
  console.log(`${fs.existsSync(packageUi) ? "ok" : "missing"}  package ui/server.py${fs.existsSync(packageUi) ? ` - package-managed runtime ${packageVersion()}` : ""}`);
  const currentIsProject = isProjectRootSync(process.cwd());
  console.log(`${currentIsProject ? "ok" : "warn"}      current directory${currentIsProject ? " is a CoAutoResearch project" : " is not a CoAutoResearch project"}`);
  if (currentIsProject) {
    const reviewerStatus = projectReviewerStatusSync(process.cwd());
    const storage = reviewerStatus.reviewStorage || {};
    const detail = reviewerStatus.outdated
      ? [
          reviewerStatus.missing.length ? `missing ${reviewerStatus.missing.join(", ")}` : "",
          reviewerStatus.changed.length ? `changed ${reviewerStatus.changed.join(", ")}` : "",
          reviewerStatus.metadataMissing.length ? "metadata stale" : "",
          reviewerStatus.protocolMissing.length ? `protocol missing ${reviewerStatus.protocolMissing.join(", ")}` : "",
          reviewerStatus.protocolChanged.length ? `protocol changed ${reviewerStatus.protocolChanged.join(", ")}` : "",
          reviewerStatus.protocolMetadataMissing.length ? "protocol metadata stale" : "",
          storage.outdated ? "review storage migration required" : ""
        ].filter(Boolean).join("; ")
      : `baseline ${REVIEWER_BASELINE_VERSION}`;
    console.log(`${reviewerStatus.outdated ? "warn" : "ok"}      core instructions${reviewerStatus.outdated ? ` outdated - ${detail || "sync required"}` : ` current - ${detail}`}`);
    if (reviewerStatus.outdated) console.log("        run: co-auto-research upgrade-project");
  }
  const projectUi = path.join(process.cwd(), "ui", "server.py");
  console.log(`${fs.existsSync(projectUi) ? "ok" : "warn"}      legacy project ui/server.py${fs.existsSync(projectUi) ? " present as fallback" : " not found in current directory"}`);
}

async function commandUi(args) {
  const { options } = parseOptions(args);
  const host = options.host || DEFAULT_HOST;
  const port = options.port || DEFAULT_PORT;
  const useCloudflareRemote = Boolean(options.remote && remoteMode() !== "ssh");
  if (useCloudflareRemote && !remoteTunnelMockConfigured()) {
    const cloudflared = cloudflaredAvailable();
    if (!cloudflared.ok) {
      printCloudflaredInstallInstructions();
      return;
    }
  }
  const python = findPythonCommand();
  if (!python.ok) {
    throw new Error("No Python 3 executable found. Install Python 3 or set COAUTO_PYTHON to the Python executable path.");
  }
  let projectsDir = options["projects-dir"] ? path.resolve(process.cwd(), options["projects-dir"]) : "";
  const projectRoot = options.project ? path.resolve(process.cwd(), options.project) : process.cwd();
  const packageServerPath = path.join(TEMPLATE_ROOT, "ui", "server.py");
  const projectServerPath = path.join(projectRoot, "ui", "server.py");
  const projectMode = !projectsDir && (Boolean(options.project) || isProjectRootSync(projectRoot));
  if (!projectsDir && !projectMode) {
    projectsDir = path.resolve(process.cwd(), DEFAULT_PROJECTS_DIR);
    fs.mkdirSync(projectsDir, { recursive: true });
  }
  let serverPath = packageServerPath;
  let usingPackageServer = fs.existsSync(packageServerPath);
  if (!usingPackageServer && projectMode && fs.existsSync(projectServerPath)) {
    serverPath = projectServerPath;
  }
  if (!fs.existsSync(serverPath)) {
    throw new Error("No package UI server found. Reinstall co-auto-research or run from a generated project with a legacy ui/server.py.");
  }
  if (projectMode && usingPackageServer && fs.existsSync(projectServerPath)) {
    console.log(`Using package UI runtime ${packageVersion()} for ${projectRoot}`);
  }
  if (options.remote) {
    console.log("Remote mode enabled.");
    if (localhostHost(host)) {
      if (useCloudflareRemote) {
        console.log("The UI stays on localhost; a Cloudflare browser link will appear after startup.");
      } else {
        console.log("The UI stays on localhost; SSH tunnel instructions will appear after startup.");
      }
    } else {
      console.log(`The UI is configured with --host ${host}. Prefer --host 127.0.0.1 unless this server is protected by a VPN or firewall.`);
    }
    console.log("");
  }
  const serverArgs = [serverPath, "--host", host, "--port", String(port)];
  if (projectsDir) serverArgs.push("--projects-dir", projectsDir);
  else if (projectMode) serverArgs.push("--project-root", projectRoot);
  if (process.env.COAUTO_PRINT_UI_INVOCATION) {
    console.log(JSON.stringify({
      serverPath,
      projectRoot: projectMode ? projectRoot : "",
      projectsDir,
      usingPackageServer,
      packageVersion: packageVersion()
    }));
    return;
  }
  const child = spawn(python.command, [...python.args, ...serverArgs], {
    cwd: projectsDir || projectRoot,
    env: {
      ...process.env,
      COAUTO_TEMPLATE_ROOT: TEMPLATE_ROOT
    },
    stdio: ["inherit", "pipe", "inherit"]
  });
  const remoteState = attachServerOutput(child, options);
  let shuttingDown = false;
  let remoteTunnelClosed = false;
  async function closeRemoteTunnel() {
    if (remoteTunnelClosed) return;
    remoteTunnelClosed = true;
    let tunnel = remoteState.tunnel;
    if (!tunnel && remoteState.tunnelPromise) {
      try {
        tunnel = await Promise.race([
          remoteState.tunnelPromise,
          new Promise((resolve) => setTimeout(() => resolve(null), 2000))
        ]);
      } catch {
        tunnel = null;
      }
    }
    if (tunnel?.close) {
      try {
        await tunnel.close();
      } catch {
        // The UI is already shutting down; a tunnel close failure should not keep the CLI alive.
      }
    }
  }
  async function forwardSignal(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    await closeRemoteTunnel();
    if (!child.killed) child.kill(signal);
    const timeout = setTimeout(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    }, 3000);
    timeout.unref?.();
  }
  process.once("SIGINT", () => {
    void forwardSignal("SIGINT");
  });
  process.once("SIGTERM", () => {
    void forwardSignal("SIGTERM");
  });
  child.on("exit", (code, signal) => {
    void (async () => {
      await closeRemoteTunnel();
      if (signal === "SIGINT") process.exit(130);
      if (signal === "SIGTERM") process.exit(143);
      process.exit(code ?? 0);
    })();
  });
}

async function findProjectManifest() {
  const candidate = path.join(process.cwd(), ".co-auto-research-template", "manifest.json");
  if (await pathExists(candidate)) return candidate;
  return "";
}

async function commandUpgrade() {
  const packageManifest = await readJson(MANIFEST_PATH);
  const projectManifestPath = await findProjectManifest();
  console.log(`CoAutoResearch CLI version: ${packageVersion()}`);
  console.log(`Available template version: ${packageManifest.templateVersion}`);
  if (projectManifestPath) {
    const projectManifest = await readJson(projectManifestPath);
    console.log(`Current project template version: ${projectManifest.templateVersion || "unknown"}`);
  } else {
    console.log("Current project template version: not detected in this directory.");
  }
  console.log("");
  console.log("To update the installed CLI and package-managed UI runtime, run:");
  console.log("  npm install -g co-auto-research@latest");
  console.log("");
  console.log("Generated project research files are not rewritten automatically.");
}

async function commandUpgradeProject(args) {
  const { options, rest } = parseOptions(args);
  const dryRun = Boolean(options["dry-run"]);
  let projects = [];
  if (options.all) {
    if (rest.length > 0) throw new Error("Unexpected argument with --all. Usage: co-auto-research upgrade-project --all [--projects-dir <dir>] [--dry-run]");
    projects = collectProjectCandidates(options);
  } else {
    if (rest.length > 1) throw new Error("Usage: co-auto-research upgrade-project [project-name-or-path] [--projects-dir <dir>] [--dry-run]");
    const target = rest[0] || options.project || "";
    if (!target && isProjectRootSync(process.cwd())) {
      const candidates = new Map();
      addProjectCandidate(candidates, process.cwd());
      projects = [...candidates.values()];
    } else {
      projects = [resolveAttachProject(target, options)];
    }
  }
  if (!projects.length) {
    console.log("No CoAutoResearch projects found.");
    return;
  }
  let changedCount = 0;
  for (const project of projects) {
    const before = projectReviewerStatusSync(project.path);
    const marker = before.outdated ? "outdated" : "current";
    console.log(`${project.name} (${project.relativePath}): core instructions ${marker}`);
    if (!before.outdated) continue;
    const result = syncProjectReviewersSync(project.path, { dryRun });
    changedCount += 1;
    if (dryRun) {
      console.log("  dry run: would sync core reviewers, core protocol instructions, and write baseline metadata");
      console.log(`  dry run: would create ${result.reviewStorage.created.length} per-reviewer files, backfill ${result.reviewStorage.backfilled.length}, and normalize ${result.reviewStorage.normalizedManuscriptReviews.length} manuscript reviews`);
    } else {
      console.log(`  synced ${result.copied.length} core reviewers`);
      console.log(`  synced ${result.protocolCopied.length} core protocol instructions`);
      console.log(`  review files: ${result.reviewStorage.created.length} created, ${result.reviewStorage.backfilled.length} backfilled, ${result.reviewStorage.placeholders.length} missing-review placeholders, ${result.reviewStorage.normalizedManuscriptReviews.length} manuscript reviews normalized`);
      console.log(`  backup: ${result.backupPath || "none"}`);
    }
  }
  if (!changedCount) console.log("All project core instructions are current.");
  else if (dryRun) console.log(`${changedCount} project${changedCount === 1 ? "" : "s"} would be updated.`);
  else console.log(`${changedCount} project${changedCount === 1 ? "" : "s"} updated to instruction baseline ${REVIEWER_BASELINE_VERSION}.`);
}

function commandVersion() {
  console.log(packageVersion());
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (command === "version" || command === "--version" || command === "-v") return commandVersion();
  if (command === "init") return commandInit(args);
  if (command === "ls" || command === "list") return commandList(args);
  if (command === "attach") return commandAttach(args);
  if (command === "ui") return commandUi(args);
  if (command === "install-cloudflared") return commandInstallCloudflared(args);
  if (command === "doctor") return commandDoctor(args);
  if (command === "upgrade") return commandUpgrade(args);
  if (command === "upgrade-project") return commandUpgradeProject(args);
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`CoAutoResearch: ${error.message}`);
  process.exit(1);
});
