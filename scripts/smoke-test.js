#!/usr/bin/env node

import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const cli = path.join(root, "bin", "auto-research.js");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "co-auto-research-smoke-"));
const projectDir = path.join(tempRoot, "project");
const projectTwoDir = path.join(tempRoot, "project-two");

function findPython() {
  const candidates = [
    { command: process.env.COAUTO_PYTHON || "", args: [] },
    { command: "python3", args: [] },
    { command: "python", args: [] },
    { command: "py", args: ["-3"] }
  ].filter((candidate) => candidate.command);
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  throw new Error("No Python executable found for smoke tests.");
}

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

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

function waitForOpenPort(child, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for server URL. Output:\n${output}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    }
    function onData(chunk) {
      output += chunk.toString();
      const match = output.match(/Open http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        cleanup();
        resolve(Number(match[1]));
      }
    }
    function onExit(code) {
      cleanup();
      reject(new Error(`Server exited before printing URL, code ${code}. Output:\n${output}`));
    }
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", onExit);
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

async function waitForHtml(url, timeoutMs = 8000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      const contentType = response.headers.get("content-type") || "";
      if (response.ok && contentType.includes("text/html") && text.includes("CoAutoResearch")) return text;
      lastError = new Error(`Unexpected HTML response: ${response.status} ${contentType} ${text.slice(0, 120)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

async function writeFakeCodexBin(directory) {
  await fsp.mkdir(directory, { recursive: true });
  const cmdCodex = path.join(directory, "codex.cmd");
  await fsp.writeFile(cmdCodex, "@echo off\r\necho codex fake 0.0.0\r\n", "utf8");
  if (process.platform !== "win32") {
    const shellCodex = path.join(directory, "codex");
    await fsp.writeFile(shellCodex, "#!/bin/sh\necho codex fake 0.0.0\n", "utf8");
    await fsp.chmod(shellCodex, 0o755);
    await fsp.chmod(cmdCodex, 0o755);
  }
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
  const indexHtml = await fsp.readFile(path.join(root, "templates", "default", "ui", "index.html"), "utf8");
  if (!/<nav class="rail-nav"[^>]*hidden/.test(indexHtml)) {
    throw new Error("current project navigation must be hidden before a project is active");
  }
  const stylesCss = await fsp.readFile(path.join(root, "templates", "default", "ui", "styles.css"), "utf8");
  if (!stylesCss.includes(".rail-nav[hidden]")) {
    throw new Error("rail navigation hidden state must not be overridden by display styles");
  }
  if (
    !stylesCss.includes("--framing-column-width: 900px") ||
    !stylesCss.includes(".brief-editor-shell.is-framing-dock") ||
    !stylesCss.includes(".framing-message.user") ||
    !stylesCss.includes("justify-self: center !important")
  ) {
    throw new Error("framing composer and CoAutoResearch returns must share a centered column");
  }
  const appJs = await fsp.readFile(path.join(root, "templates", "default", "ui", "app.js"), "utf8");
  if (!appJs.includes("maybeOpenInitialProjectDialog") || !appJs.includes("Create a project first.")) {
    throw new Error("empty dashboard must auto-open project creation and block composer submission");
  }
  if (
    appJs.includes('nextMessages.push(normalizeFramingMessage({ role: "user", text: brief }))') ||
    !appJs.includes("isHiddenUiTranscript") ||
    !appJs.includes("record: false") ||
    !appJs.includes('event.key === "Enter" && (event.metaKey || event.ctrlKey)')
  ) {
    throw new Error("autosaved brief/file edits must not render as sent chat messages");
  }
  if (
    !appJs.includes("projectCards") ||
    !appJs.includes("[messages, sessionTranscript, pending, projectCards]") ||
    !appJs.includes('details class="framing-progress-row is-collapsible') ||
    !appJs.includes("localSessionActivityHtml")
  ) {
    throw new Error("framing interactions must render above the final PROJECT.md card with tool details collapsed");
  }
  const upgradeOutput = execFileSync("node", [cli, "upgrade"], { cwd: projectDir, encoding: "utf8" });
  if (!upgradeOutput.includes("Automated upgrades are not implemented")) {
    throw new Error("upgrade advisory output did not match expectation");
  }

  const fakeBin = path.join(tempRoot, "fake-bin");
  await writeFakeCodexBin(fakeBin);
  const doctorOutput = execFileSync("node", [cli, "doctor", "--port", String(await freePort())], {
    cwd: root,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    encoding: "utf8"
  });
  if (!doctorOutput.includes("codex fake 0.0.0")) {
    throw new Error("doctor did not resolve fake Codex executable from PATH");
  }

  const python = findPython();
  const resolverOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    [
      "import importlib.util, os, pathlib",
      "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
      "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "resolved = pathlib.Path(module.resolve_codex_executable({'PATH': os.environ['COAUTO_FAKE_PATH']}, windows=True)).name.lower()",
      "needs_shell = module.executable_requires_windows_shell('C:/Program Files/nodejs/codex.cmd', windows=True)",
      "print(f'{resolved}|{needs_shell}')",
      "assert resolved == 'codex.cmd', resolved",
      "assert needs_shell is True"
    ].join("; ")
  ], {
    cwd: root,
    env: { ...process.env, COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"), COAUTO_FAKE_PATH: fakeBin },
    encoding: "utf8"
  }).trim();
  if (resolverOutput !== "codex.cmd|True") {
    throw new Error(`Python Codex resolver returned ${resolverOutput}`);
  }

  const occupied = await reservePort();
  const fallbackServer = spawn("node", [cli, "ui", "--projects-dir", tempRoot, "--host", "127.0.0.1", "--port", String(occupied.port), "--no-open"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const boundPort = await waitForOpenPort(fallbackServer);
    if (boundPort === occupied.port) {
      throw new Error("UI did not move away from an occupied port");
    }
    const payload = await waitForJson(`http://127.0.0.1:${boundPort}/api/projects`);
    if (!payload.multi_project) {
      throw new Error("fallback-port UI did not start in multi-project mode");
    }
  } finally {
    fallbackServer.kill("SIGTERM");
    occupied.server.close();
    await new Promise((resolve) => {
      fallbackServer.once("exit", resolve);
      setTimeout(resolve, 1000);
    });
  }

  const singlePort = await freePort();
  const singleServer = spawn("node", [cli, "ui", "--project", projectDir, "--host", "127.0.0.1", "--port", String(singlePort), "--no-open"], {
    cwd: root,
    stdio: "ignore"
  });
  try {
    const payload = await waitForJson(`http://127.0.0.1:${singlePort}/api/projects`);
    if (payload.multi_project || (payload.projects || []).length !== 1) {
      throw new Error("single-project UI did not start in single-project mode");
    }
    const created = await postJson(`http://127.0.0.1:${singlePort}/api/projects`, { name: "sibling project" });
    const names = (created.projects || []).map((project) => project.display_name).sort();
    if (!created.multi_project || JSON.stringify(names) !== JSON.stringify(["project", "project-two", "sibling project"])) {
      throw new Error(`single-project create did not promote to dashboard: ${names.join(", ")}`);
    }
    await fsp.access(path.join(tempRoot, "sibling_project", "AGENTS.md"));
  } finally {
    singleServer.kill("SIGTERM");
    await new Promise((resolve) => {
      singleServer.once("exit", resolve);
      setTimeout(resolve, 1000);
    });
  }

  const defaultPort = await freePort();
  const defaultCwd = path.join(tempRoot, "default-dashboard");
  await fsp.mkdir(defaultCwd);
  const defaultServer = spawn("node", [cli, "ui", "--host", "127.0.0.1", "--port", String(defaultPort), "--no-open"], {
    cwd: defaultCwd,
    stdio: "ignore"
  });
  try {
    const payload = await waitForJson(`http://127.0.0.1:${defaultPort}/api/projects`);
    if (!payload.multi_project || (payload.projects || []).length !== 0) {
      throw new Error("default UI did not start as an empty dashboard");
    }
    await waitForHtml(`http://127.0.0.1:${defaultPort}/`);
    const created = await postJson(`http://127.0.0.1:${defaultPort}/api/projects`, { name: "from ui" });
    if (!created.multi_project || created.project?.display_name !== "from ui") {
      throw new Error("default dashboard could not create a project from the UI API");
    }
    await fsp.access(path.join(defaultCwd, "local-projects", "from_ui", "AGENTS.md"));
  } finally {
    defaultServer.kill("SIGTERM");
    await new Promise((resolve) => {
      defaultServer.once("exit", resolve);
      setTimeout(resolve, 1000);
    });
  }

  const port = await freePort();
  const server = spawn("node", [cli, "ui", "--projects-dir", tempRoot, "--host", "127.0.0.1", "--port", String(port), "--no-open"], {
    cwd: root,
    stdio: "ignore"
  });
  try {
    const payload = await waitForJson(`http://127.0.0.1:${port}/api/projects`);
    const names = (payload.projects || []).map((project) => project.display_name).sort();
    if (JSON.stringify(names) !== JSON.stringify(["project", "project-two", "sibling project"])) {
      throw new Error(`multi-project API returned unexpected projects: ${names.join(", ")}`);
    }
    const created = await postJson(`http://127.0.0.1:${port}/api/projects`, { name: "ui project" });
    if (created.project?.display_name !== "ui project") {
      throw new Error("UI project creation did not preserve display name");
    }
    await fsp.access(path.join(tempRoot, "ui_project", "AGENTS.md"));
    await fsp.access(path.join(tempRoot, "ui_project", ".co-auto-research", "project.json"));
    const renamed = await postJson(`http://127.0.0.1:${port}/api/projects/rename`, { project: created.project.id, name: "renamed ui project" });
    if (renamed.project?.display_name !== "renamed ui project") {
      throw new Error("project rename did not update display name");
    }
    let deleteRejected = false;
    try {
      await postJson(`http://127.0.0.1:${port}/api/projects/delete`, { project: created.project.id, confirm: "ui project" });
    } catch {
      deleteRejected = true;
    }
    if (!deleteRejected) {
      throw new Error("project deletion did not require exact confirmation name");
    }
    const deleted = await postJson(`http://127.0.0.1:${port}/api/projects/delete`, { project: created.project.id, confirm: "renamed ui project" });
    if ((deleted.projects || []).some((project) => project.id === created.project.id)) {
      throw new Error("deleted project still appears in project list");
    }
    try {
      await fsp.access(path.join(tempRoot, "ui_project", "AGENTS.md"));
      throw new Error("deleted project directory still exists");
    } catch (error) {
      if (error.message === "deleted project directory still exists") throw error;
    }
    const afterCreate = (created.projects || []).map((project) => project.display_name).sort();
    if (JSON.stringify(afterCreate) !== JSON.stringify(["project", "project-two", "sibling project", "ui project"])) {
      throw new Error(`project creation returned unexpected projects: ${afterCreate.join(", ")}`);
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
