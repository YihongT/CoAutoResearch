#!/usr/bin/env node

import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const cli = path.join(root, "bin", "auto-research.js");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "co-auto-research-smoke-"));
const projectDir = path.join(tempRoot, "project");
const projectTwoDir = path.join(tempRoot, "project-two");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForJson(url, timeoutMs = 8000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

try {
  execFileSync("node", [cli, "init", projectDir], { cwd: root, stdio: "pipe" });
  execFileSync("node", [cli, "init", projectTwoDir], { cwd: root, stdio: "pipe" });
  await fsp.access(path.join(projectDir, "AGENTS.md"));
  await fsp.access(path.join(projectDir, "ui", "server.py"));
  await fsp.access(path.join(projectDir, ".co-auto-research", "project.json"));
  const projectMetadata = JSON.parse(await fsp.readFile(path.join(projectDir, ".co-auto-research", "project.json"), "utf8"));
  if (projectMetadata.displayName !== "project" || !projectMetadata.projectId) {
    throw new Error("project metadata was not initialized correctly");
  }
  const manifest = JSON.parse(await fsp.readFile(path.join(projectDir, ".co-auto-research-template", "manifest.json"), "utf8"));
  if (manifest.templateVersion !== "0.1.0") {
    throw new Error(`unexpected template version ${manifest.templateVersion}`);
  }
  const upgradeOutput = execFileSync("node", [cli, "upgrade"], { cwd: projectDir, encoding: "utf8" });
  if (!upgradeOutput.includes("Automated upgrades are not implemented")) {
    throw new Error("upgrade advisory output did not match expectation");
  }

  const port = await freePort();
  const server = spawn("node", [cli, "ui", "--projects-dir", tempRoot, "--host", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    stdio: "ignore"
  });
  try {
    const payload = await waitForJson(`http://127.0.0.1:${port}/api/projects`);
    const names = (payload.projects || []).map((project) => project.display_name).sort();
    if (JSON.stringify(names) !== JSON.stringify(["project", "project-two"])) {
      throw new Error(`multi-project API returned unexpected projects: ${names.join(", ")}`);
    }
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      server.once("exit", resolve);
      setTimeout(resolve, 1000);
    });
  }
  console.log("Smoke test passed.");
} finally {
  await fsp.rm(tempRoot, { recursive: true, force: true });
}
