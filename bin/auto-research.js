#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_ROOT = path.join(PACKAGE_ROOT, "templates", "default");
const MANIFEST_PATH = path.join(TEMPLATE_ROOT, ".co-auto-research-template", "manifest.json");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "8765";

function usage() {
  return `CoAutoResearch

Usage:
  co-auto-research init <dir>
  co-auto-research ui [--host 127.0.0.1] [--port 8765]
  co-auto-research ui --projects-dir <dir> [--host 127.0.0.1] [--port 8765]
  co-auto-research doctor [--host 127.0.0.1] [--port 8765]
  co-auto-research upgrade
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

async function commandDoctor(args) {
  const { options } = parseOptions(args);
  const host = options.host || DEFAULT_HOST;
  const port = options.port || DEFAULT_PORT;
  const python = findPythonCommand();
  const checks = [
    ["node", { ok: Number(process.versions.node.split(".")[0]) >= 18, output: process.version }],
    ["python", { ok: python.ok, output: python.output || python.label }],
    ["git", commandAvailable("git")],
    ["codex", commandAvailable("codex")]
  ];

  for (const [name, result] of checks) {
    const label = result.ok ? "ok" : name === "codex" ? "warn" : "missing";
    console.log(`${label.padEnd(7)} ${name}${result.output ? ` - ${result.output}` : ""}`);
  }

  const portCheck = await checkPort(host, port);
  console.log(`${(portCheck.ok ? "ok" : "warn").padEnd(7)} port ${host}:${port}${portCheck.error ? ` - ${portCheck.error}` : ""}`);

  const projectUi = path.join(process.cwd(), "ui", "server.py");
  console.log(`${fs.existsSync(projectUi) ? "ok" : "warn"}      project ui/server.py${fs.existsSync(projectUi) ? "" : " not found in current directory"}`);
}

function commandUi(args) {
  const { options } = parseOptions(args);
  const host = options.host || DEFAULT_HOST;
  const port = options.port || DEFAULT_PORT;
  const python = findPythonCommand();
  if (!python.ok) {
    throw new Error("No Python 3 executable found. Install Python 3 or set COAUTO_PYTHON to the Python executable path.");
  }
  const projectsDir = options["projects-dir"] ? path.resolve(process.cwd(), options["projects-dir"]) : "";
  const projectRoot = options.project ? path.resolve(process.cwd(), options.project) : process.cwd();
  const serverPath = projectsDir
    ? path.join(TEMPLATE_ROOT, "ui", "server.py")
    : path.join(projectRoot, "ui", "server.py");
  if (!fs.existsSync(serverPath)) {
    throw new Error("No ui/server.py found. Run this inside a generated CoAutoResearch project, or pass --projects-dir.");
  }
  const serverArgs = [serverPath, "--host", host, "--port", String(port)];
  if (projectsDir) serverArgs.push("--projects-dir", projectsDir);
  else if (options.project) serverArgs.push("--project-root", projectRoot);
  const child = spawn(python.command, [...python.args, ...serverArgs], {
    cwd: projectsDir || projectRoot,
    stdio: "inherit"
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
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
  console.log(`Available template version: ${packageManifest.templateVersion}`);
  if (projectManifestPath) {
    const projectManifest = await readJson(projectManifestPath);
    console.log(`Current project template version: ${projectManifest.templateVersion || "unknown"}`);
  } else {
    console.log("Current project template version: not detected in this directory.");
  }
  console.log("Automated upgrades are not implemented in 0.1.0. Generated projects are independent working copies.");
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (command === "init") return commandInit(args);
  if (command === "ui") return commandUi(args);
  if (command === "doctor") return commandDoctor(args);
  if (command === "upgrade") return commandUpgrade(args);
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`CoAutoResearch: ${error.message}`);
  process.exit(1);
});
