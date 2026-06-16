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

if (failures.length) {
  console.error("Template verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Template verification passed for ${files.length} files.`);
