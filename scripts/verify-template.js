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
  /s42256/i
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
if (!stateTemplate.includes("Final gate reviewer")) {
  failures.push("research_trajectory/STATE.md: missing Final gate reviewer");
}

const serverTemplate = await fsp.readFile(path.join(template, "ui", "server.py"), "utf8");
if (!serverTemplate.includes('"final_gate": "Final gate reviewer"')) {
  failures.push("ui/server.py: missing Final gate reviewer parser entry");
}

if (failures.length) {
  console.error("Template verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Template verification passed for ${files.length} files.`);
