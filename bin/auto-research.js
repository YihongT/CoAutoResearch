#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
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
  co-auto-research ls [--projects-dir <dir>]
  co-auto-research attach [project-name-or-path] [--projects-dir <dir>] [--host 127.0.0.1] [--port 8765] [--open] [--no-open] [--remote]
  co-auto-research ui [--host 127.0.0.1] [--port 8765] [--open] [--no-open] [--remote]
  co-auto-research ui --projects-dir <dir> [--host 127.0.0.1] [--port 8765] [--open] [--no-open] [--remote]
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
    if (arg === "--open" || arg === "--no-open" || arg === "--remote") {
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

function isProjectRootSync(root) {
  return (
    fs.existsSync(path.join(root, "ui", "server.py")) &&
    (
      fs.existsSync(path.join(root, ".co-auto-research-template", "manifest.json")) ||
      (fs.existsSync(path.join(root, "AGENTS.md")) && fs.existsSync(path.join(root, "PROJECT.md")))
    )
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
    templateVersion: String(metadata.templateVersion || "").trim()
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
    scanImmediateProjects(candidates, path.join(cwd, "local-projects"));
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
    project.relativePath
  ]);
  const headers = ["#", "name", "status", "path"];
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

function findCodexCommand(env = process.env) {
  const configured = (env.COAUTO_CODEX || env.CODEX_BIN || "").trim().replace(/^"|"$/g, "");
  if (configured) {
    const expanded = configured.replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || "~");
    if (fs.existsSync(expanded)) return expanded;
    const configuredOnPath = findOnPath(expanded, env);
    if (configuredOnPath) return configuredOnPath;
    return expanded;
  }
  return findOnPath("codex", env) || "codex";
}

function codexAvailable() {
  const command = findCodexCommand();
  const shell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const result = spawnSync(command, ["--version"], { encoding: "utf8", shell });
  const output = [result.stdout, result.stderr].filter(Boolean).join("").trim();
  return {
    ok: result.status === 0,
    status: result.status,
    output: output.split(/\r?\n/)[0] || command
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
  const user = process.env.USER || process.env.LOGNAME || process.env.USERNAME || os.userInfo().username || "user";
  const host = process.env.HOSTNAME || os.hostname() || "server";
  return `${user}@${host}`;
}

function printRemoteAccessHint(url, options) {
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
  console.log("If the SSH target above is not the exact alias you used, replace it with the same server name from your ssh command.");
  console.log("VS Code Remote, Cursor Remote, and Codespaces users can instead forward the printed port from the Ports panel.");
  if (!localhostHost(options.host || DEFAULT_HOST)) {
    console.log("");
    console.log(`Warning: --remote is safest with --host 127.0.0.1. Current host is ${options.host}.`);
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
        printRemoteAccessHint(match[1], options);
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
    ["codex", codexAvailable()]
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
  let projectsDir = options["projects-dir"] ? path.resolve(process.cwd(), options["projects-dir"]) : "";
  const projectRoot = options.project ? path.resolve(process.cwd(), options.project) : process.cwd();
  const projectServerPath = path.join(projectRoot, "ui", "server.py");
  if (!projectsDir && !fs.existsSync(projectServerPath)) {
    projectsDir = path.resolve(process.cwd(), "local-projects");
    fs.mkdirSync(projectsDir, { recursive: true });
  }
  const serverPath = projectsDir
    ? path.join(TEMPLATE_ROOT, "ui", "server.py")
    : projectServerPath;
  if (!fs.existsSync(serverPath)) {
    throw new Error("No ui/server.py found. Run this inside a generated CoAutoResearch project, or pass --projects-dir.");
  }
  if (options.remote) {
    console.log("Remote mode enabled: CoAutoResearch will not try to open a browser on this server.");
    if (localhostHost(host)) {
      console.log("The UI will stay bound to localhost; tunnel instructions will appear after startup.");
    } else {
      console.log(`The UI is configured with --host ${host}. Prefer --host 127.0.0.1 unless this server is protected by a VPN or firewall.`);
    }
    console.log("");
  }
  const serverArgs = [serverPath, "--host", host, "--port", String(port)];
  if (projectsDir) serverArgs.push("--projects-dir", projectsDir);
  else if (options.project) serverArgs.push("--project-root", projectRoot);
  const child = spawn(python.command, [...python.args, ...serverArgs], {
    cwd: projectsDir || projectRoot,
    env: { ...process.env, COAUTO_TEMPLATE_ROOT: TEMPLATE_ROOT },
    stdio: ["inherit", "pipe", "inherit"]
  });
  attachServerOutput(child, options);
  let shuttingDown = false;
  function forwardSignal(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!child.killed) child.kill(signal);
    const timeout = setTimeout(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    }, 3000);
    timeout.unref?.();
  }
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));
  child.on("exit", (code, signal) => {
    if (signal === "SIGINT") process.exit(130);
    if (signal === "SIGTERM") process.exit(143);
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
  if (command === "ls" || command === "list") return commandList(args);
  if (command === "attach") return commandAttach(args);
  if (command === "ui") return commandUi(args);
  if (command === "doctor") return commandDoctor(args);
  if (command === "upgrade") return commandUpgrade(args);
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  console.error(`CoAutoResearch: ${error.message}`);
  process.exit(1);
});
