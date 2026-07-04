#!/usr/bin/env node

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const template = path.join(root, "templates", "default");

const read = (relative) => fsp.readFile(path.join(template, relative), "utf8");
const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();

const [
  server,
  execution,
  resourceScout,
  reviewerScope,
  taxonomy
] = await Promise.all([
  read("ui/server.py"),
  read("instructions/EXECUTION_AGENT.md"),
  read("instructions/RESOURCE_SCOUT.md"),
  read("instructions/REVIEWER_SCOPE_ANALYST.md"),
  read("instructions/reviewers/REVIEW_TAXONOMY.md")
]);

const failures = [];
const obsoleteHardStopPhrase = ["no meaningful", "non-human work"].join(" ");

const serverDenylist = [
  obsoleteHardStopPhrase,
  "Status: open | answered | closed | deferred",
  "Priority: high | medium | low",
  "Blocks: none | final_pass | future_trial",
  "Question: <one concrete human question/request>",
  "Download Integrity And Fallback Ladder",
  "retry with safe downloader variants",
  "Large datasets, checkpoints, and repositories",
  "Column lists, row descriptions, comparison logic",
  "Remaining blocker:"
];

for (const phrase of serverDenylist) {
  if (server.includes(phrase)) {
    failures.push(`ui/server.py restates instruction-owned rule text: ${phrase}`);
  }
}

for (const phrase of [obsoleteHardStopPhrase]) {
  for (const [name, text] of [
    ["EXECUTION_AGENT.md", execution],
    ["RESOURCE_SCOUT.md", resourceScout],
    ["REVIEWER_SCOPE_ANALYST.md", reviewerScope],
    ["REVIEW_TAXONOMY.md", taxonomy],
    ["server.py", server]
  ]) {
    if (text.includes(phrase)) failures.push(`${name}: obsolete hard-stop phrase remains`);
  }
}

for (const token of ["`pass`", "`continue`", "`blocked`", "`needs_human`"]) {
  if (!execution.includes(token) || !server.includes(token)) {
    failures.push(`gate token missing from EXECUTION_AGENT.md or server.py: ${token}`);
  }
}

for (const token of [
  "## Autoresearch Goal Gate",
  "Response to human:",
  "Resource Scout Brief"
]) {
  if (!server.includes(token) || !execution.includes(token)) {
    failures.push(`shared token missing from server.py or EXECUTION_AGENT.md: ${token}`);
  }
}

for (const file of [
  "PLAN_REVIEW.md",
  "PROCESS_REVIEW.md",
  "EVIDENCE_REVIEW.md",
  "VENUE_FIT_REVIEW.md",
  "MANUSCRIPT_REVIEW.md",
  "FIGURE_TABLE_REVIEW.md",
  "REFERENCE_REVIEW.md",
  "FINAL_GATE_REVIEW.md"
]) {
  if (!server.includes(file) || !execution.includes(file)) {
    failures.push(`reviewer file token mismatch: ${file}`);
  }
}

for (const [label, text] of [
  ["RESOURCE_SCOUT.md", resourceScout],
  ["REVIEWER_SCOPE_ANALYST.md", reviewerScope]
]) {
  if (!text.includes("Subagent update:")) {
    failures.push(`${label}: missing Subagent update format`);
  }
}

if (!compact(server).includes("follow `instructions/RESOURCE_SCOUT.md` as the single source of truth")) {
  failures.push("server.py Resource Scout prompt must point to RESOURCE_SCOUT.md as source of truth");
}
if (!compact(server).includes("follow `instructions/EXECUTION_AGENT.md` section `Non-Blocking Human Tasks` as the single source of truth")) {
  failures.push("server.py human-task prompt must point to EXECUTION_AGENT.md as source of truth");
}

if (failures.length) {
  console.error("Prompt sync check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Prompt sync check passed.");
