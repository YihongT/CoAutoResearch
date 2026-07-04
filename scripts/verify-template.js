#!/usr/bin/env node

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const template = path.join(root, "templates", "default");

const forbiddenPatterns = [
  /perceived[-_\s]?safety/i,
  /percieved/i,
  /physical ai must feel/i,
  /nature machine intelligence/i,
  /\bNMI\b/,
  /s42256/i,
  new RegExp(["no meaningful", "non-human work"].join(" "), "i"),
  new RegExp(["Conversion does not", "acquire resources"].join(" "), "i")
];

const maxFileBytes = 10 * 1024 * 1024;
const forbiddenExtensions = new Set([".zip", ".tar", ".gz", ".tgz", ".pdf"]);

async function walk(directory) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

const files = await walk(template);
const failures = [];
const compactText = (value) => String(value || "").replace(/\s+/g, " ");
const includesCompact = (value, needle) => compactText(value).includes(needle);

for (const file of files) {
  const relative = path.relative(template, file);
  const stats = await fsp.stat(file);
  if (stats.size > maxFileBytes) {
    failures.push(`${relative}: file is larger than 10MB`);
  }
  if (forbiddenExtensions.has(path.extname(file).toLowerCase())) {
    failures.push(`${relative}: forbidden template artifact extension`);
  }
  const bytes = await fsp.readFile(file);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) {
      failures.push(`${relative}: forbidden project-specific text matched ${pattern}`);
    }
  }
}

const reviewerDir = path.join(template, "instructions", "reviewers");
const reviewerEntries = await fsp.readdir(reviewerDir, { withFileTypes: true });
const reviewerFiles = reviewerEntries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => path.join(reviewerDir, entry.name));

for (const file of reviewerFiles) {
  const name = path.basename(file);
  const text = await fsp.readFile(file, "utf8");
  if (name !== "REVIEW_TAXONOMY.md" && !text.includes("REVIEW_TAXONOMY.md")) {
    failures.push(`${path.relative(template, file)}: reviewer does not reference REVIEW_TAXONOMY.md`);
  }
  if (name.endsWith("_REVIEWER.md") && !text.includes("## Pass Standard") && name !== "FINAL_GATE_REVIEWER.md") {
    failures.push(`${path.relative(template, file)}: reviewer is missing a Pass Standard section`);
  }
}

const stateTemplate = await fsp.readFile(path.join(template, "research_trajectory", "STATE.md"), "utf8");
if (!stateTemplate.includes("## Critical Path")) {
  failures.push("research_trajectory/STATE.md: missing Critical Path section");
}
for (const reviewer of [
  "Plan reviewer",
  "Process reviewer",
  "Evidence reviewer",
  "Venue fit reviewer",
  "Manuscript reviewer",
  "Figure/table reviewer",
  "Reference reviewer",
  "Final gate reviewer"
]) {
  if (!stateTemplate.includes(reviewer)) {
    failures.push(`research_trajectory/STATE.md: missing ${reviewer}`);
  }
}

const manifest = JSON.parse(await fsp.readFile(path.join(template, ".co-auto-research-template", "manifest.json"), "utf8"));
if (manifest.reviewerBaselineVersion !== "2026-07-result-block-schema") {
  failures.push(".co-auto-research-template/manifest.json: missing reviewer baseline version");
}
const coreReviewerFiles = Array.isArray(manifest.coreReviewerFiles) ? manifest.coreReviewerFiles : [];
for (const name of [
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
]) {
  if (!coreReviewerFiles.includes(name)) {
    failures.push(`.co-auto-research-template/manifest.json: missing core reviewer ${name}`);
  }
}
const coreProtocolFiles = Array.isArray(manifest.coreProtocolFiles) ? manifest.coreProtocolFiles : [];
for (const name of [
  "EXECUTION_AGENT.md",
  "MANUSCRIPT.md",
  "PROJECT_FRAMING.md",
  "RESOURCE_INTAKE.md",
  "RESOURCE_SCOUT.md",
  "REVIEWER_SCOPE_ANALYST.md",
  "sessions/evolution/ENTRY.md",
  "sessions/evolution/general/AUTORESEARCH.md",
  "sessions/chat/prompts/MONITOR_PROGRESS.md"
]) {
  if (!coreProtocolFiles.includes(name)) {
    failures.push(`.co-auto-research-template/manifest.json: missing core protocol ${name}`);
  }
}

const blueprintTemplate = await fsp.readFile(path.join(template, "manuscript", "BLUEPRINT.md"), "utf8");
const paperPlanTemplate = await fsp.readFile(path.join(template, "manuscript", "PAPER_PLAN.md"), "utf8");
for (const heading of [
  "## Target Venue / Audience / Article Type",
  "## Target-Venue Organization Rationale",
  "## Core Story",
  "## Architecture Overview / Table of Contents",
  "## Manuscript Architecture",
  "## Reference / Literature Grounding Plan",
  "## References",
  "## Appendix / Supplement Plan",
  "## Blocking Missing Evidence",
  "## Required Qualifications / Claim Constraints",
  "## Provenance / Audit Index",
  "## Deprecated Or Superseded Ideas",
  "## Submission-Readiness Summary"
]) {
  if (!blueprintTemplate.includes(heading)) {
    failures.push(`manuscript/BLUEPRINT.md: missing ${heading}`);
  }
}
if (!blueprintTemplate.includes("Status: pre-results stub")) {
  failures.push("manuscript/BLUEPRINT.md: missing pre-results stub status");
}
if (!blueprintTemplate.includes("`active`, `candidate`,") || !blueprintTemplate.includes("`supplement`")) {
  failures.push("manuscript/BLUEPRINT.md: missing active/candidate/supplement inclusion enum");
}
if (/\bdeferred\b/i.test(blueprintTemplate) || /Remaining blocker:/i.test(blueprintTemplate)) {
  failures.push("manuscript/BLUEPRINT.md: contains deferred or Remaining blocker schema text");
}
if (/\bdeferred\b/i.test(paperPlanTemplate)) {
  failures.push("manuscript/PAPER_PLAN.md: contains deferred text");
}
for (const requiredText of [
  "## Complete Architecture / Table of Contents",
  "## Planned Figures And Tables",
  "## Blocking Missing Evidence",
  "Critical-path item"
]) {
  if (!paperPlanTemplate.includes(requiredText)) {
    failures.push(`manuscript/PAPER_PLAN.md: missing ${requiredText}`);
  }
}

const finalGateReviewer = await fsp.readFile(path.join(template, "instructions", "reviewers", "FINAL_GATE_REVIEWER.md"), "utf8");
if (!finalGateReviewer.includes("## Artifact Consistency Audit")) {
  failures.push("instructions/reviewers/FINAL_GATE_REVIEWER.md: missing artifact consistency audit");
}
if (!finalGateReviewer.includes("reviews/FINAL_GATE_REVIEW.md")) {
  failures.push("instructions/reviewers/FINAL_GATE_REVIEWER.md: missing canonical final gate output path");
}
if (!finalGateReviewer.includes("paragraph plan completeness")) {
  failures.push("instructions/reviewers/FINAL_GATE_REVIEWER.md: missing paragraph plan audit requirement");
}
if (!includesCompact(finalGateReviewer, "publication-ready Markdown table body")) {
  failures.push("instructions/reviewers/FINAL_GATE_REVIEWER.md: missing publication-ready table requirement");
}

const manuscriptInstructions = await fsp.readFile(path.join(template, "instructions", "MANUSCRIPT.md"), "utf8");
if (!includesCompact(manuscriptInstructions, "full venue-format proposal with complete real results")) {
  failures.push("instructions/MANUSCRIPT.md: missing full-result blueprint definition");
}
if (!manuscriptInstructions.includes("PAPER_PLAN.md") || !manuscriptInstructions.includes("BLUEPRINT.md")) {
  failures.push("instructions/MANUSCRIPT.md: missing two-artifact model");
}
if (!manuscriptInstructions.includes("Publication-ready table:") || !includesCompact(manuscriptInstructions, "Column lists, row descriptions, comparison logic, source links")) {
  failures.push("instructions/MANUSCRIPT.md: missing publication-ready inline table contract");
}
if (manuscriptInstructions.includes("Remaining blocker")) {
  failures.push("instructions/MANUSCRIPT.md: still references per-block Remaining blocker fields");
}

const figureTableReviewer = await fsp.readFile(path.join(template, "instructions", "reviewers", "FIGURE_TABLE_REVIEWER.md"), "utf8");
if (!includesCompact(figureTableReviewer, "publication-ready Markdown") || !includesCompact(figureTableReviewer, "active tables that are only column/row/comparison specs")) {
  failures.push("instructions/reviewers/FIGURE_TABLE_REVIEWER.md: missing table-spec-only rejection");
}

const serverTemplate = await fsp.readFile(path.join(template, "ui", "server.py"), "utf8");
if (!serverTemplate.includes('"final_gate": {') || !serverTemplate.includes('"label": "Final gate reviewer"') || !serverTemplate.includes('"FINAL_GATE_REVIEW.md"')) {
  failures.push("ui/server.py: missing Final gate reviewer parser entry");
}
if (!serverTemplate.includes("final_blueprint_consistency_blockers")) {
  failures.push("ui/server.py: missing final blueprint consistency guard");
}
if (!serverTemplate.includes("current_trial_reviewer_file_blockers")) {
  failures.push("ui/server.py: missing current-trial reviewer file guard");
}
if (!serverTemplate.includes("paragraph_plan_complete")) {
  failures.push("ui/server.py: missing paragraph plan consistency guard");
}
if (!serverTemplate.includes("markdown_has_table") || !serverTemplate.includes("Publication-ready table:")) {
  failures.push("ui/server.py: missing publication-ready table consistency guard");
}
for (const token of [
  "paper_pack_readiness",
  "ongoing_work_requires_conversion",
  "stalled_without_empirical_progress",
  "critical_path_state",
  "scope_drift_warning"
]) {
  if (!serverTemplate.includes(token)) {
    failures.push(`ui/server.py: missing ${token}`);
  }
}

const conversionInstructions = await fsp.readFile(path.join(template, "instructions", "CONVERSION.md"), "utf8");
if (!conversionInstructions.includes("Mandatory Conversion Trigger")) {
  failures.push("instructions/CONVERSION.md: missing Mandatory Conversion Trigger");
}

const resourceScoutInstructions = await fsp.readFile(path.join(template, "instructions", "RESOURCE_SCOUT.md"), "utf8");
if (!resourceScoutInstructions.includes("Research-Critical Acquisition Mandate")) {
  failures.push("instructions/RESOURCE_SCOUT.md: missing Research-Critical Acquisition Mandate");
}
for (const rung of ["1. Check", "2. Check", "3. Try", "4. Try", "5. Try", "6. If", "7. Use"]) {
  if (!resourceScoutInstructions.includes(rung)) {
    failures.push(`instructions/RESOURCE_SCOUT.md: missing acquisition ladder rung ${rung}`);
  }
}

if (failures.length) {
  console.error("Template verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Template verification passed for ${files.length} files.`);
