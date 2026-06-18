#!/usr/bin/env node

import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const cli = path.join(root, "bin", "auto-research.js");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "co-auto-research-smoke-"));
const projectDir = path.join(tempRoot, "project");
const projectTwoDir = path.join(tempRoot, "project-two");
let nextTestPort = 32100;

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

async function freePort() {
  for (let attempts = 0; attempts < 1000; attempts += 1) {
    const port = nextTestPort;
    nextTestPort += 1;
    const server = await tryReservePort(port);
    if (!server) continue;
    await closeServer(server);
    return port;
  }
  throw new Error("Could not find a free low-numbered localhost port for the smoke test.");
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

async function reserveFallbackTestPort() {
  for (let port = 31000; port < 32000; port += 1) {
    const occupied = await tryReservePort(port);
    if (!occupied) continue;
    const next = await tryReservePort(port + 1);
    if (next) {
      await closeServer(next);
      return { server: occupied, port };
    }
    await closeServer(occupied);
  }
  throw new Error("Could not reserve a contiguous fallback port pair for the UI smoke test.");
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
  const realProjectDir = await fsp.realpath(projectDir);
  await fsp.access(path.join(projectDir, "AGENTS.md"));
  await fsp.access(path.join(projectDir, "ui", "server.py"));
  await fsp.access(path.join(projectDir, ".co-auto-research", "project.json"));
  const projectMetadata = JSON.parse(await fsp.readFile(path.join(projectDir, ".co-auto-research", "project.json"), "utf8"));
  if (projectMetadata.displayName !== "project" || !projectMetadata.projectId) {
    throw new Error("project metadata was not initialized correctly");
  }
  const projectListOutput = execFileSync("node", [cli, "ls", "--projects-dir", tempRoot], { cwd: root, encoding: "utf8" });
  const projectListAliasOutput = execFileSync("node", [cli, "list", "--projects-dir", tempRoot], { cwd: root, encoding: "utf8" });
  if (
    !projectListOutput.includes("Found 2 CoAutoResearch projects") ||
    !projectListOutput.includes("project-two") ||
    !projectListOutput.includes("co-auto-research attach") ||
    !projectListAliasOutput.includes("project")
  ) {
    throw new Error(`project list output was not useful:\n${projectListOutput}`);
  }
  let ambiguousAttachOutput = "";
  let ambiguousAttachFailed = false;
  try {
    execFileSync("node", [cli, "attach", "--projects-dir", tempRoot], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    ambiguousAttachFailed = true;
    ambiguousAttachOutput = `${error.stdout || ""}${error.stderr || ""}`;
  }
  if (!ambiguousAttachFailed || !ambiguousAttachOutput.includes("Multiple CoAutoResearch projects found")) {
    throw new Error(`attach should ask the user to choose when several projects exist:\n${ambiguousAttachOutput}`);
  }
  const packageServerPath = path.join(root, "templates", "default", "ui", "server.py");
  const attachProbeOutput = execFileSync("node", [cli, "attach", "project", "--projects-dir", tempRoot, "--no-open"], {
    cwd: root,
    env: { ...process.env, COAUTO_PRINT_UI_INVOCATION: "1" },
    encoding: "utf8"
  }).trim();
  const attachProbe = JSON.parse(attachProbeOutput.split(/\r?\n/).at(-1));
  const attachProbeProjectRoot = await fsp.realpath(attachProbe.projectRoot);
  if (
    attachProbe.serverPath !== packageServerPath ||
    attachProbeProjectRoot !== realProjectDir ||
    attachProbe.usingPackageServer !== true
  ) {
    throw new Error(`attach should use the package-managed UI server for existing projects:\n${attachProbeOutput}`);
  }
  const projectUiProbeOutput = execFileSync("node", [cli, "ui", "--no-open"], {
    cwd: projectDir,
    env: { ...process.env, COAUTO_PRINT_UI_INVOCATION: "1" },
    encoding: "utf8"
  }).trim();
  const projectUiProbe = JSON.parse(projectUiProbeOutput.split(/\r?\n/).at(-1));
  const projectUiProbeProjectRoot = await fsp.realpath(projectUiProbe.projectRoot);
  if (
    projectUiProbe.serverPath !== packageServerPath ||
    projectUiProbeProjectRoot !== realProjectDir ||
    projectUiProbe.usingPackageServer !== true
  ) {
    throw new Error(`ui from a project directory should use the package-managed UI server:\n${projectUiProbeOutput}`);
  }
  const defaultDashboardRoot = path.join(tempRoot, "default-dashboard-root");
  await fsp.mkdir(defaultDashboardRoot, { recursive: true });
  const defaultDashboardProbeOutput = execFileSync("node", [cli, "ui", "--no-open"], {
    cwd: defaultDashboardRoot,
    env: { ...process.env, COAUTO_PRINT_UI_INVOCATION: "1" },
    encoding: "utf8"
  }).trim();
  const defaultDashboardProbe = JSON.parse(defaultDashboardProbeOutput.split(/\r?\n/).at(-1));
  const expectedDefaultProjectsDir = path.join(defaultDashboardRoot, "co-autoresearch-projects");
  const defaultProbeProjectsDir = await fsp.realpath(defaultDashboardProbe.projectsDir);
  if (
    defaultDashboardProbe.projectRoot !== "" ||
    defaultProbeProjectsDir !== await fsp.realpath(expectedDefaultProjectsDir)
  ) {
    throw new Error(`default dashboard should use co-autoresearch-projects:\n${defaultDashboardProbeOutput}`);
  }
  const legacyDashboardRoot = path.join(tempRoot, "legacy-dashboard-root");
  const legacyProjectDir = path.join(legacyDashboardRoot, "local-projects", "legacy-project");
  execFileSync("node", [cli, "init", legacyProjectDir], { cwd: root, stdio: "pipe" });
  const legacyListOutput = execFileSync("node", [cli, "ls"], {
    cwd: legacyDashboardRoot,
    encoding: "utf8"
  });
  if (!legacyListOutput.includes("legacy-project")) {
    throw new Error(`ls should still discover legacy local-projects folders:\n${legacyListOutput}`);
  }
  const manifest = JSON.parse(await fsp.readFile(path.join(projectDir, ".co-auto-research-template", "manifest.json"), "utf8"));
  if (manifest.templateVersion !== "0.1.0") {
    throw new Error(`unexpected template version ${manifest.templateVersion}`);
  }
  const packageManifest = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8"));
  const resourceIntakeInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "RESOURCE_INTAKE.md"), "utf8");
  const conversionInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "CONVERSION.md"), "utf8");
  const executionInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "EXECUTION_AGENT.md"), "utf8");
  const resourceManifestTemplate = await fsp.readFile(path.join(root, "templates", "default", "resources", "user_input", "RESOURCE_MANIFEST.md"), "utf8");
  const literatureReadme = await fsp.readFile(path.join(root, "templates", "default", "resources", "literature", "README.md"), "utf8");
  if (
    !resourceIntakeInstructions.includes("## Embedded Resource Scan") ||
    !resourceIntakeInstructions.includes("A general bibliography embedded in an ongoing manuscript is not automatically a target-venue seed-paper set") ||
    !resourceIntakeInstructions.includes("resources/user_input/attachments/") ||
    !conversionInstructions.includes("Do not interpret an empty `resources/target_venue/papers/` folder as proof that no literature exists") ||
    !executionInstructions.includes("A manuscript `references.bib` or bibliography inside `resources/ongoing_work/` is literature grounding") ||
    !resourceManifestTemplate.includes("## Embedded Resource Surfacing") ||
    !literatureReadme.includes("surface them here")
  ) {
    throw new Error("resource intake must surface embedded ongoing-work bibliographies without confusing them with target-venue seed papers");
  }
  const indexHtml = await fsp.readFile(path.join(root, "templates", "default", "ui", "index.html"), "utf8");
  const readme = await fsp.readFile(path.join(root, "README.md"), "utf8");
  const docsConfig = await fsp.readFile(path.join(root, "docs", "conf.py"), "utf8");
  const docsRequirements = await fsp.readFile(path.join(root, "docs", "requirements.txt"), "utf8");
  const docsIndex = await fsp.readFile(path.join(root, "docs", "index.md"), "utf8");
  const remoteDocs = await fsp.readFile(path.join(root, "docs", "remote-server.md"), "utf8");
  const gettingStartedDocs = await fsp.readFile(path.join(root, "docs", "getting-started.md"), "utf8");
  const cliDocs = await fsp.readFile(path.join(root, "docs", "cli.md"), "utf8");
  const contributingDocs = await fsp.readFile(path.join(root, "CONTRIBUTING.md"), "utf8");
  const upgradingDocs = await fsp.readFile(path.join(root, "docs", "upgrading.md"), "utf8");
  const pagesWorkflow = await fsp.readFile(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
  const cliSource = await fsp.readFile(path.join(root, "bin", "auto-research.js"), "utf8");
  const helpOutput = execFileSync("node", [cli, "help"], { cwd: root, encoding: "utf8" });
  if (
    !helpOutput.includes("[--remote]") ||
    !cliSource.includes("function printRemoteAccessHint") ||
    !cliSource.includes("ssh -N -L") ||
    !cliSource.includes("user}@<ssh-host>") ||
    cliSource.includes("os.hostname") ||
    !cliSource.includes("Remote mode enabled") ||
    !readme.includes("co-auto-research ui --remote") ||
    !remoteDocs.includes("co-auto-research ui --remote") ||
    !remoteDocs.includes("user@<ssh-host>") ||
    !remoteDocs.includes("COAUTO_REMOTE_TARGET=user@host") ||
    !docsIndex.includes("```{toctree}") ||
    !docsIndex.includes("Welcome to CoAutoResearch's documentation") ||
    !docsConfig.includes('html_theme = "sphinx_rtd_theme"') ||
    !docsConfig.includes('"sphinxcontrib.mermaid"') ||
    !docsConfig.includes('html_baseurl = "https://yihongt.github.io/CoAutoResearch/"') ||
    !docsRequirements.includes("sphinx-rtd-theme") ||
    !docsRequirements.includes("myst-parser") ||
    !docsRequirements.includes("sphinxcontrib-mermaid") ||
    !pagesWorkflow.includes("sphinx-build -b html docs ./_site") ||
    pagesWorkflow.includes("jekyll-build-pages") ||
    pagesWorkflow.includes("ENABLE_PRIVATE_PAGES") ||
    packageManifest.name !== "co-auto-research" ||
    packageManifest.repository?.url !== "git+https://github.com/YihongT/CoAutoResearch.git" ||
    packageManifest.homepage !== "https://yihongt.github.io/CoAutoResearch/" ||
    packageManifest.publishConfig?.access !== "public" ||
    !packageManifest.packageManager?.startsWith("npm@") ||
    !pagesWorkflow.includes("sphinx-build -b html docs ./_site") ||
    !readme.includes("npm install -g co-auto-research") ||
    !docsIndex.includes("npm install -g co-auto-research") ||
    !gettingStartedDocs.includes("npm install -g co-auto-research") ||
    !cliDocs.includes("npm install -g co-auto-research") ||
    !readme.includes("npm install -g co-auto-research@latest") ||
    !docsIndex.includes("npm install -g co-auto-research@latest") ||
    !gettingStartedDocs.includes("npm install -g co-auto-research@latest") ||
    !cliDocs.includes("npm install -g co-auto-research@latest") ||
    readme.includes("git clone https://github.com/YihongT/CoAutoResearch.git") ||
    docsIndex.includes("git clone https://github.com/YihongT/CoAutoResearch.git") ||
    gettingStartedDocs.includes("git clone https://github.com/YihongT/CoAutoResearch.git") ||
    cliDocs.includes("git clone https://github.com/YihongT/CoAutoResearch.git") ||
    !gettingStartedDocs.includes("co-auto-research upgrade") ||
    !contributingDocs.includes("npm publish --provenance") ||
    !contributingDocs.includes("git clone https://github.com/YihongT/CoAutoResearch.git") ||
    !contributingDocs.includes("npm link") ||
    !contributingDocs.includes("npm install -g co-auto-research@latest") ||
    readme.includes("node bin/auto-research.js ui") ||
    gettingStartedDocs.includes("node bin/auto-research.js ui") ||
    !gettingStartedDocs.includes("co-auto-research ui") ||
    !cliDocs.includes("COAUTO_REMOTE_TARGET") ||
    !helpOutput.includes("co-auto-research attach") ||
    !readme.includes("co-auto-research attach my-project") ||
    !cliDocs.includes("Return to Existing Work") ||
    readme.includes("npm run pack:dry-run") ||
    readme.includes("## Development") ||
    readme.includes("GitHub Pages") ||
    docsIndex.includes("GitHub Pages") ||
    gettingStartedDocs.includes("ignored by this repository") ||
    upgradingDocs.includes("Future automated upgrades should") ||
    readme.includes("docs/hosting-docs.md") ||
    docsIndex.includes("hosting-docs")
  ) {
    throw new Error("CLI and public docs must explain remote browser access through the product docs template without hosting-instruction pages");
  }
  const releaseWorkflow = await fsp.readFile(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  if (
    !releaseWorkflow.includes('node-version: "24"') ||
    !releaseWorkflow.includes("npm pack --dry-run") ||
    !releaseWorkflow.includes("npm publish --provenance --access public") ||
    releaseWorkflow.includes("npm-dry-run")
  ) {
    throw new Error("release workflow must publish the npm package with provenance after tests and package dry run");
  }
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
  if (
    !indexHtml.includes("20260617-figure-cards") ||
    !stylesCss.includes("Reader typography: match the composer text across content surfaces.") ||
    !stylesCss.includes(".framing-message .transcript-body") ||
    !stylesCss.includes("font-family: var(--reader);")
  ) {
    throw new Error("content typography must use the same reader font as the composer");
  }
  const appJs = await fsp.readFile(path.join(root, "templates", "default", "ui", "app.js"), "utf8");
  const serverPy = await fsp.readFile(path.join(root, "templates", "default", "ui", "server.py"), "utf8");
  if (
    !indexHtml.includes('name="themeMode" value="light"') ||
    !indexHtml.includes('name="themeMode" value="night"') ||
    !indexHtml.includes('document.documentElement.dataset.theme = theme === "night" ? "night" : "light"') ||
    !appJs.includes('localStorage.getItem("coAutoResearchTheme")') ||
    !appJs.includes('localStorage.setItem("coAutoResearchTheme", mode)') ||
    !appJs.includes("function applyThemeMode") ||
    !appJs.includes('$$("[data-theme-option]")') ||
    !stylesCss.includes('html[data-theme="night"]') ||
    !stylesCss.includes(".theme-mode-control")
  ) {
    throw new Error("settings must support persisted Light/Night theme switching");
  }
  if (
    !serverPy.includes('{"text", "project", "goal-launch", "command"}') ||
    !serverPy.includes('clean["text"] = f"Attached {count}') ||
    !serverPy.includes('display_message = "Attached resources."')
  ) {
    throw new Error("server must preserve goal-launch messages and keep attachment-only chat turns visible");
  }
  if (
    !indexHtml.includes('id="composer-attach-button"') ||
    !indexHtml.includes('id="composer-file-input"') ||
    !indexHtml.includes('type="file" multiple hidden') ||
    !appJs.includes('$("#composer-attach-button")?.addEventListener("click"') ||
    !appJs.includes('$("#composer-file-input")?.addEventListener("change"') ||
    !appJs.includes('addFilesFromList(event.target.files, "file picker", { category: "user_input" })') ||
    !appJs.includes('user_input: "User input"') ||
    !serverPy.includes('"user_input": "resources/user_input/attachments"') ||
    !stylesCss.includes(".composer-attach-button") ||
    !stylesCss.includes(".composer-file-input") ||
    !readme.includes("composer `+` button") ||
    !readme.includes("resources/user_input/attachments/") ||
    !gettingStartedDocs.includes("resources/user_input/attachments/") ||
    !gettingStartedDocs.includes("resources/user_input/RESOURCE_MANIFEST.md")
  ) {
    throw new Error("composer must expose a local file attach button and document project-local attachment storage");
  }
  if (
    !serverPy.includes("WinError 10013") ||
    !serverPy.includes("isinstance(exc, PermissionError)") ||
    !serverPy.includes('getattr(exc, "winerror", None) == 10013')
  ) {
    throw new Error("UI server port fallback must treat Windows WinError 10013 as an unavailable port");
  }
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
    appJs.includes("hasOnlyOrphanLocalUserMessage") ||
    !appJs.includes("mergePendingLocalFramingMessages") ||
    !appJs.includes("recoveredFramingMessagesFromSession") ||
    !appJs.includes("isFramingThreadUserTranscript") ||
    !appJs.includes('["ui.framing", "ui.chat"].includes(rawType)') ||
    !appJs.includes("editedTranscriptCutWindows") ||
    !appJs.includes("message.edited_at = new Date().toISOString()") ||
    !appJs.includes("framingReplyPending = true") ||
    !appJs.includes("latestUnansweredUserMessage") ||
    !appJs.includes("const inferredReplyPending = Boolean(unansweredUser && (framingReplyPending || framingMessagesPersisting || isSessionRunning()))") ||
    appJs.includes("framingReplyPending && !isSessionRunning() && !framingDraftPending") ||
    !appJs.includes("isSessionRunning() || framingDraftPending || framingReplyPending ? 1000 : 3500") ||
    !appJs.includes("framingMessagesPersisting || framingDraftPending || framingReplyPending || isSessionRunning()") ||
    !appJs.includes("attachmentOnlyMessage(attachments)") ||
    !appJs.includes("clearFramingComposerText(text || displayText)") ||
    !appJs.includes("const files = await collectUploadFiles()") ||
    !appJs.includes("framingMessagesPersisting") ||
    !appJs.includes("await persistFramingMessages();") ||
    !appJs.includes("transcriptReplyWindows") ||
    !appJs.includes("const runStarts = transcript") ||
    !appJs.includes("transcriptRunStart(entry)") ||
    !appJs.includes("if (!isFramingThreadUserTranscript(entry)) return []") ||
    !appJs.includes("pruneNonFinalRecoveredAssistantMessages") ||
    !appJs.includes("staleTexts") ||
    !appJs.includes("completed && candidates.length ? candidates[candidates.length - 1] : null") ||
    !appJs.includes("FRAMING_MESSAGES_CLIENT_VERSION")
  ) {
    throw new Error("first user framing message must survive stale overview snapshots");
  }
  const sendSessionStart = appJs.indexOf("async function sendSessionComposerMessage");
  const sendAppendIndex = appJs.indexOf('appendFramingMessage("user", displayText', sendSessionStart);
  const sendClearIndex = appJs.indexOf("clearFramingComposerText(text || displayText)", sendSessionStart);
  const sendCollectIndex = appJs.indexOf("const files = await collectUploadFiles()", sendSessionStart);
  if (!(sendSessionStart >= 0 && sendAppendIndex > sendSessionStart && sendClearIndex > sendAppendIndex && sendCollectIndex > sendClearIndex)) {
    throw new Error("session composer must render the sent message and clear input before collecting uploads or posting");
  }
  const launchStart = appJs.indexOf("async function launchAutoresearch");
  const launchCloseIndex = appJs.indexOf('$("#launch-dialog")?.close();', launchStart);
  const launchPersistIndex = appJs.indexOf("await persistFramingMessages();", launchStart);
  const launchApiIndex = appJs.indexOf('api("/api/research/cold-start"', launchStart);
  if (!(launchStart >= 0 && launchCloseIndex > launchStart && launchPersistIndex > launchCloseIndex && launchApiIndex > launchCloseIndex)) {
    throw new Error("launch dialog must close immediately after local /goal pending UI is rendered");
  }
  if (
    !appJs.includes("markdownLinkHtml") ||
    !appJs.includes('transcriptContentHtml(message.text, { markdown: role === "assistant" })') ||
    !stylesCss.includes(".markdown-file-link") ||
    !indexHtml.includes("20260617-figure-cards")
  ) {
    throw new Error("Codex assistant responses must render Markdown in framing chat");
  }
  if (
    !appJs.includes("const activeTrial = selectedTrial(trials)") ||
    !appJs.includes("const countLabel = `${trials.length} trial") ||
    !appJs.includes("reportedCount ? ` · ${reportedCount} reported`") ||
    appJs.includes("const activeTrial = selectedTrial(reports)") ||
    !appJs.includes('reportStatus === "reported" ? "Done"') ||
    !appJs.includes("Report pending") ||
    !appJs.includes("Report is not available yet. Codex activity for this trial is shown below.") ||
    !appJs.includes("function isGoalPassed()") ||
    !appJs.includes("function isTrialLive(iteration, report = null)") ||
    !appJs.includes("if (isGoalPassed()) return false;") ||
    !appJs.includes("const liveIteration = isLiveGoalSession() ? Number(sessionState().loop_iteration || 0) : 0") ||
    !appJs.includes("const fallback = currentTrialIndex(trials);") ||
    !appJs.includes("function runningTrialStatusHtml") ||
    !appJs.includes('class="trial-live-status"') ||
    !appJs.includes("Live trial activity") ||
    !stylesCss.includes(".trial-live-status") ||
    appJs.includes("isSessionRunning() && hasGoalStarted() ? Number(sessionState().loop_iteration || 0) : 0") ||
    appJs.includes("const running = isSessionRunning() && Number(sessionState().loop_iteration || 0) === Number(iteration)")
  ) {
    throw new Error("trial history must show live status only for truly active, unreported trials");
  }
  if (
    !appJs.includes("function isSessionInterrupted()") ||
    !appJs.includes('addChip("Resume autoresearch", "/goal resume");') ||
    !appJs.includes('interrupted ? "Goal interrupted"')
  ) {
    throw new Error("interrupted goal sessions must show resume controls instead of pause controls");
  }
  if (
    !indexHtml.includes("app.js?v=20260617-figure-cards") ||
    !appJs.includes('const allowedKinds = new Set(["text", "project", "goal-launch", "command"])') ||
    !appJs.includes('appendFramingMessage("user", displayText, { kind: "command" })') ||
    !appJs.includes('beginFramingPending(appendedMessage?.id || "");') ||
    !appJs.includes("function framingControlMessageHtml(message)") ||
    !appJs.includes("function controlMessageDisplay(message") ||
    !appJs.includes('return { label: "Autoresearch", value: "Start autoresearch" }') ||
    !appJs.includes('return { label: "Autoresearch", value: "Resume autoresearch" }') ||
    !indexHtml.includes(">Start autoresearch<") ||
    !indexHtml.includes(">Resume autoresearch<") ||
    !indexHtml.includes(">Show autoresearch<") ||
    !indexHtml.includes(">Pause autoresearch<") ||
    !indexHtml.includes(">Clear autoresearch state<") ||
    />\/goal(?:\s+\w+)?<\/button>/.test(indexHtml) ||
    appJs.includes("Start with /goal") ||
    appJs.includes("Start /goal") ||
    appJs.includes("Continue /goal") ||
    appJs.includes("Show /goal") ||
    appJs.includes("Pause /goal") ||
    appJs.includes("Resume /goal") ||
    indexHtml.includes("Start with /goal") ||
    indexHtml.includes("Start /goal") ||
    indexHtml.includes("Continue /goal") ||
    indexHtml.includes("Show /goal") ||
    indexHtml.includes("Pause /goal") ||
    indexHtml.includes("Resume /goal") ||
    appJs.includes("Autoresearch control") ||
    !appJs.includes("if (isControlFramingMessage(message)) return framingControlMessageHtml(message);") ||
    !appJs.includes("function isControlFramingMessage(message)") ||
    !appJs.includes("if (isControlFramingMessage(message)) continue;") ||
    !appJs.includes("if (appendedMessage) await persistFramingMessages();") ||
    !appJs.includes("if (!message && !currentComposerAttachments().length) return;") ||
    !stylesCss.includes(".framing-message.control") ||
    !stylesCss.includes(".framing-control-pill")
  ) {
    throw new Error("slash commands sent from the composer must render as visible control rows and immediate pending feedback");
  }
  const controlBlock = stylesCss.match(/\.framing-message\.control\s*\{[^}]*\}/)?.[0] || "";
  const controlPillBlock = stylesCss.match(/\.framing-control-pill\s*\{[^}]*\}/)?.[0] || "";
  if (
    !controlBlock.includes("justify-self: center;") ||
    !controlBlock.includes("justify-content: center;") ||
    !controlPillBlock.includes("justify-content: center;")
  ) {
    throw new Error("slash command control rows must be centered in the framing column with centered pill contents");
  }
  const commandAppendIndex = appJs.indexOf('appendFramingMessage("user", displayText, { kind: "command" })', sendSessionStart);
  const commandPendingIndex = appJs.indexOf('beginFramingPending(appendedMessage?.id || "");', commandAppendIndex);
  const commandRenderIndex = appJs.indexOf("renderFramingConversation();", commandAppendIndex);
  if (!(commandAppendIndex > sendSessionStart && commandPendingIndex > commandAppendIndex && commandPendingIndex < commandRenderIndex)) {
    throw new Error("slash command pending state must start before the command row is rendered");
  }
  if (
    !indexHtml.includes("styles.css?v=20260617-figure-cards") ||
    !appJs.includes("function currentProgressStartTime(transcript)") ||
    !appJs.includes("const latestRunStart = transcript.reduce") ||
    !appJs.includes("function framingProgressDetailsHtml()") ||
    !appJs.includes('details class="framing-progress-details"') ||
    appJs.includes("${framingProgressHtml()}") ||
    !stylesCss.includes(".framing-progress-details > summary") ||
    !stylesCss.includes(".framing-progress-details[open] > summary::before")
  ) {
    throw new Error("running Codex progress must be scoped to the current run and collapsed by default");
  }
  if (
    !appJs.includes("buildFramingActivityByMessage") ||
    !appJs.includes("transcriptRunGroups") ||
    !appJs.includes("inlineRunActivityHtml") ||
    !appJs.includes("Worked for") ||
    !appJs.includes("htmlBeforeMessageId") ||
    !appJs.includes("entry === finalEntry") ||
    !appJs.includes("messageText === finalText") ||
    !appJs.includes("omitLocal: true") ||
    !appJs.includes("omittedEntryIds") ||
    !stylesCss.includes(".framing-run-activity")
  ) {
    throw new Error("Codex activity must render as a folded Worked row before its corresponding framing response");
  }
  if (
    appJs.includes("Codex framing activity") ||
    appJs.includes("localSessionActivityHtml") ||
    appJs.includes("Current session activity") ||
    appJs.includes("Latest session activity") ||
    appJs.includes("currentRunActivityHtml") ||
    stylesCss.includes(".current-run-card")
  ) {
    throw new Error("framing/chat Codex events must render as Worked rows or trial activity, not separate current-session cards");
  }
  if (
    !appJs.includes("canLaunchAutoresearchFromAssistant") ||
    !appJs.includes("latestAssistantTextMessage") ||
    !appJs.includes("data-project-launch>Start autoresearch</button>") ||
    !appJs.includes("latest?.id === message.id") ||
    !appJs.includes("hasProjectDraftReady()") ||
    !appJs.includes("!hasGoalStarted()") ||
    !appJs.includes("!isSessionRunning()")
  ) {
    throw new Error("latest pre-goal assistant reply must expose a Start autoresearch action");
  }
  if (
    !appJs.includes("Open latest manuscript") ||
    !appJs.includes('data-inline-fullscreen="manuscript/BLUEPRINT.md"') ||
    !appJs.includes("Latest manuscript blueprint synthesized from accepted findings and trial reports.") ||
    !appJs.includes("function composerPromptNextValue") ||
    !appJs.includes("function isComposerCommandLine") ||
    !appJs.includes("if (lines.some((line) => line.trim() === promptText)) return current;") ||
    appJs.includes("editor.value = current ? `${current}\\n${text}` : text;")
  ) {
    throw new Error("UI must expose the latest manuscript and make quick prompt insertion idempotent");
  }
  if (
    !appJs.includes("function figureSpecCardsHtml") ||
    !appJs.includes("function figureSpecFields") ||
    !appJs.includes('contextCard("Figure descriptions"') ||
    !appJs.includes("figureSpecDetail(\"Purpose\"") ||
    !appJs.includes("figureSpecDetail(\"Evidence / conceptual basis\"") ||
    !stylesCss.includes(".figure-spec-card") ||
    !stylesCss.includes(".figure-caption") ||
    !stylesCss.includes(".figure-status.is-caution")
  ) {
    throw new Error("manuscript panel must render framed figure descriptions from FIGURE_SPECS.md");
  }
  if (
    appJs.includes("projectCards") ||
    appJs.includes("[messages, sessionTranscript, pending, projectCards]") ||
    appJs.includes("projectBelongsAfterLatestUser") ||
    !appJs.includes("collapseProjectDraftMessages") ||
    !appJs.includes("const visibleMessages = collapseProjectDraftMessages(localMessages)") ||
    !appJs.includes('details class="framing-progress-row is-collapsible')
  ) {
    throw new Error("framing timeline must keep message order, collapse old PROJECT.md drafts, and keep tool details collapsed");
  }
  const versionOutput = execFileSync("node", [cli, "--version"], { cwd: root, encoding: "utf8" }).trim();
  if (versionOutput !== packageManifest.version) {
    throw new Error(`version output did not match package.json: ${versionOutput}`);
  }
  const upgradeOutput = execFileSync("node", [cli, "upgrade"], { cwd: projectDir, encoding: "utf8" });
  if (
    !upgradeOutput.includes(`CoAutoResearch CLI version: ${packageManifest.version}`) ||
    !upgradeOutput.includes("npm install -g co-auto-research@latest") ||
    !upgradeOutput.includes("Generated project research files are not rewritten automatically")
  ) {
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
  if (!doctorOutput.includes("package-managed runtime") || !doctorOutput.includes("legacy project ui/server.py")) {
    throw new Error(`doctor should report package-managed UI runtime and legacy project UI fallback:\n${doctorOutput}`);
  }

  const packedName = execFileSync("npm", ["pack", "--pack-destination", tempRoot], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim().split(/\r?\n/).at(-1);
  const packedTarball = path.join(tempRoot, packedName);
  const npmPrefix = path.join(tempRoot, "npm-prefix");
  execFileSync("npm", ["install", "--global", "--prefix", npmPrefix, packedTarball], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe"
  });
  const installedCli = process.platform === "win32"
    ? path.join(npmPrefix, "co-auto-research.cmd")
    : path.join(npmPrefix, "bin", "co-auto-research");
  const installedVersion = execFileSync(installedCli, ["--version"], { encoding: "utf8" }).trim();
  if (installedVersion !== packageManifest.version) {
    throw new Error(`installed tarball CLI version did not match package.json: ${installedVersion}`);
  }
  const installedDoctorOutput = execFileSync(installedCli, ["doctor", "--port", String(await freePort())], {
    cwd: root,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    encoding: "utf8"
  });
  if (!installedDoctorOutput.includes("package-managed runtime") || !installedDoctorOutput.includes("codex fake 0.0.0")) {
    throw new Error(`installed tarball CLI doctor output was not useful:\n${installedDoctorOutput}`);
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

  const externalRepo = path.join(tempRoot, "LLMShopper-TBS-Test");
  await fsp.mkdir(externalRepo, { recursive: true });
  await fsp.writeFile(path.join(externalRepo, "README.md"), "external repo material\n", "utf8");
  const resourceResolverScript = [
    "import importlib.util, json, os, pathlib",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module._CONTEXT.project = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
    "payload = module.prepare_payload_resources({'resourceLinks': []}, [os.environ['COAUTO_RESOURCE_TEXT']])",
    "links = payload.get('resourceLinks', [])",
    "assert links == [], links",
    "clues = payload.get('_resourceResolution', [])",
    "assert clues and any(item.get('path', '').endswith('LLMShopper-TBS-Test') for item in clues), clues",
    "saved = module.save_resource_links(payload)",
    "assert saved == [], saved",
    "module.write_ui_metadata(payload, [], [])",
    "manifest = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']) / 'resources/user_input/RESOURCE_MANIFEST.md'",
    "text = manifest.read_text(encoding='utf-8')",
    "assert 'Inferred Resource References' in text and 'LLMShopper-TBS-Test' in text, text",
    "assert not (pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']) / 'resources/ongoing_work/LLMShopper-TBS-Test').exists()",
    "explicit_payload = {'resourceLinks': [{'path': os.environ['COAUTO_EXTERNAL_REPO'], 'category': 'ongoing_work'}]}",
    "explicit_saved = module.save_resource_links(explicit_payload)",
    "module.write_ui_metadata(explicit_payload, [], explicit_saved)",
    "assert explicit_saved and pathlib.Path(explicit_saved[0]['path']).parts[0] == 'resources', explicit_saved",
    "resources = module.collect_resources()",
    "ongoing = next(group for group in resources if group['path'] == 'resources/ongoing_work')",
    "assert any(item['path'].endswith('LLMShopper-TBS-Test/README.md') for item in ongoing['files']), ongoing",
    "tree = module.directory_tree('resources')",
    "ongoing_tree = next(child for child in tree['children'] if child['name'] == 'ongoing_work')",
    "linked_tree = next(child for child in ongoing_tree['children'] if child['name'] == 'LLMShopper-TBS-Test')",
    "assert linked_tree.get('is_symlink') is True and any(child['name'] == 'README.md' for child in linked_tree['children']), linked_tree",
    "explicit_text = manifest.read_text(encoding='utf-8')",
    "assert 'Explicit UI Resources' in explicit_text and 'Attached Resources' in explicit_text, explicit_text",
    "print(json.dumps({'clues': len(clues), 'saved': explicit_saved[0]['path']}))"
  ].join("\n");
  const resourceResolverOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    resourceResolverScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir,
      COAUTO_EXTERNAL_REPO: externalRepo,
      COAUTO_RESOURCE_TEXT: 'please continue in "E:\\Github\\LLMShopper-TBS-Test" repo'
    },
    encoding: "utf8"
  }).trim();
  if (!resourceResolverOutput.includes("LLMShopper-TBS-Test")) {
    throw new Error(`resource resolver did not report the external repo: ${resourceResolverOutput}`);
  }

  const gateParserScript = [
    "import importlib.util, json, os, pathlib",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "context = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
    "module._CONTEXT.project = context",
    "state = context.research_state_path",
    "assert module.normalize_gate_status('ready for targeted revision') == 'continue'",
    "assert module.normalize_gate_status('completed') == 'continue'",
    "assert module.normalize_gate_status('approved') == 'continue'",
    "assert module.normalize_gate_status('pass for display inventory') == 'continue'",
    "assert module.normalize_gate_status('pass - architecture coherent; targeted revision required') == 'continue'",
    "assert module.normalize_gate_status('pass - no blockers remain') == 'pass'",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: continue - missing source audit\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n- Final gate reviewer: pass\n\nNext action: finish evidence audit.\n\"\"\", encoding='utf-8')",
    "gate = module.read_autoresearch_gate()",
    "assert gate['overall_status'] == 'pass', gate",
    "assert gate['status'] == 'continue', gate",
    "assert gate['reviewer_statuses']['evidence'] == 'continue', gate",
    "assert gate['all_reviewers_passed'] is False, gate",
    "assert module.gate_has_passed(gate) is False, gate",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: pass\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n\nNext action: none.\n\"\"\", encoding='utf-8')",
    "missing_final = module.read_autoresearch_gate()",
    "assert missing_final['status'] == 'continue', missing_final",
    "assert 'final_gate' in missing_final['missing_reviewers'], missing_final",
    "assert module.gate_has_passed(missing_final) is False, missing_final",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: pass\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n- Final gate reviewer: pass\n\nNext action: none.\n\"\"\", encoding='utf-8')",
    "passed = module.read_autoresearch_gate()",
    "assert passed['status'] == 'pass', passed",
    "assert passed['all_reviewers_passed'] is True, passed",
    "assert module.gate_has_passed(passed) is True, passed",
    "print(json.dumps({'blocked': gate['status'], 'passed': passed['status']}))"
  ].join("\n");
  const gateParserOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    gateParserScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (!gateParserOutput.includes('"blocked": "continue"') || !gateParserOutput.includes('"passed": "pass"')) {
    throw new Error(`gate parser smoke test returned unexpected output: ${gateParserOutput}`);
  }

  const checkpointScript = [
    "import importlib.util, json, os, pathlib",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "context = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
    "module._CONTEXT.project = context",
    "state = context.research_state_path",
    "continue_gate = \"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: continue\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: continue - missing source audit\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n- Final gate reviewer: pass\n\nNext action: finish evidence audit.\n\"\"\"",
    "pass_gate = \"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: pass\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n- Final gate reviewer: pass\n\nNext action: none.\n\"\"\"",
    "assert module.DEFAULT_REVIEW_CHECKPOINT_INTERVAL == 100",
    "assert module.normalize_review_checkpoint_interval(None) == 100",
    "assert module.normalize_research_settings({'reviewCheckpointInterval': '25'})['reviewCheckpointInterval'] == 25",
    "module.save_ui_settings({'codex': {'reviewCheckpointInterval': '25'}})",
    "assert module.load_ui_settings()['codex']['reviewCheckpointInterval'] == 25",
    "state.write_text(continue_gate, encoding='utf-8')",
    "context.session.update({'loop_active': True, 'mode': 'goal', 'loop_iteration': 100, 'loop_review_checkpoint_iteration': 100, 'settings': {'reviewCheckpointInterval': 100}, 'logs': [], 'raw_logs': [], 'transcript': []})",
    "module.maybe_continue_autoresearch_loop(0)",
    "assert context.session['loop_active'] is False, context.session",
    "assert context.session['loop_stop_reason'] == 'review_checkpoint_reached', context.session",
    "state.write_text(pass_gate, encoding='utf-8')",
    "context.session.update({'loop_active': True, 'mode': 'goal', 'loop_iteration': 2, 'loop_review_checkpoint_iteration': 100, 'loop_stop_reason': '', 'settings': {'reviewCheckpointInterval': 100}, 'logs': [], 'raw_logs': [], 'transcript': []})",
    "module.maybe_continue_autoresearch_loop(0)",
    "assert context.session['loop_active'] is False, context.session",
    "assert context.session['loop_stop_reason'] == 'all_reviewer_gates_passed', context.session",
    "state.write_text(continue_gate, encoding='utf-8')",
    "context.session.update({'loop_active': False, 'mode': 'goal', 'loop_iteration': 100, 'loop_review_checkpoint_iteration': 100, 'loop_stop_reason': 'review_checkpoint_reached', 'settings': {'reviewCheckpointInterval': 100}, 'session_id': '00000000-0000-0000-0000-000000000000', 'logs': [], 'raw_logs': [], 'transcript': []})",
    "module.start_research_run = lambda *args, **kwargs: {'ok': True, 'kwargs': kwargs}",
    "resumed = module.handle_local_slash_command('/goal resume', '/goal resume', {'reviewCheckpointInterval': 25})",
    "assert resumed and resumed.get('local') is True, resumed",
    "assert context.session['loop_active'] is True, context.session",
    "assert context.session['loop_review_checkpoint_iteration'] == 125, context.session",
    "print(json.dumps({'default': module.DEFAULT_REVIEW_CHECKPOINT_INTERVAL, 'checkpoint_stop': 'review_checkpoint_reached', 'resumed_checkpoint': context.session['loop_review_checkpoint_iteration']}))"
  ].join("\n");
  const checkpointOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    checkpointScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (
    !checkpointOutput.includes('"default": 100') ||
    !checkpointOutput.includes('"checkpoint_stop": "review_checkpoint_reached"') ||
    !checkpointOutput.includes('"resumed_checkpoint": 125')
  ) {
    throw new Error(`checkpoint smoke test returned unexpected output: ${checkpointOutput}`);
  }

  const occupied = await reserveFallbackTestPort();
  try {
    const fallbackOutput = execFileSync(python.command, [
      ...python.args,
      "-c",
      [
        "import importlib.util, os, pathlib",
        "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
        "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
        "module = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(module)",
        "requested = int(os.environ['COAUTO_OCCUPIED_PORT'])",
        "httpd, bound = module.bind_http_server('127.0.0.1', requested)",
        "print(bound)",
        "httpd.server_close()",
        "assert bound != requested, bound"
      ].join("; ")
    ], {
      cwd: root,
      env: {
        ...process.env,
        COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
        COAUTO_OCCUPIED_PORT: String(occupied.port)
      },
      encoding: "utf8"
    }).trim();
    const boundPort = Number(fallbackOutput);
    if (boundPort === occupied.port) {
      throw new Error("UI did not move away from an occupied port");
    }
    if (!Number.isInteger(boundPort) || boundPort < 1 || boundPort > 65535) {
      throw new Error(`Python fallback test returned an invalid port: ${fallbackOutput}`);
    }
  } finally {
    await closeServer(occupied.server);
  }

  const registryOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    [
      "import importlib.util, json, os, pathlib, shutil",
      "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
      "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "temp_root = pathlib.Path(os.environ['COAUTO_TEMP_ROOT'])",
      "project_dir = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT'])",
      "single = module.ProjectRegistry(project_dir)",
      "single_projects = single.summaries()",
      "assert len(single_projects) == 1 and not single.multi_project, single_projects",
      "created_sibling = single.create_project({'name': 'sibling project'})",
      "single_names = sorted(item['display_name'] for item in single.summaries())",
      "assert single.multi_project and single_names == ['project', 'project-two', 'sibling project'], single_names",
      "assert (temp_root / 'sibling_project' / 'AGENTS.md').exists()",
      "default_cwd = temp_root / 'default-dashboard'",
      "default_projects = default_cwd / 'co-autoresearch-projects'",
      "default_cwd.mkdir(exist_ok=True)",
      "empty_dashboard = module.ProjectRegistry(default_cwd, default_projects)",
      "assert empty_dashboard.multi_project and empty_dashboard.summaries() == []",
      "from_ui = empty_dashboard.create_project({'name': 'from ui'})",
      "assert from_ui['display_name'] == 'from ui', from_ui",
      "assert (default_projects / 'from_ui' / 'AGENTS.md').exists()",
      "dashboard = module.ProjectRegistry(temp_root, temp_root)",
      "names = sorted(item['display_name'] for item in dashboard.summaries())",
      "assert names == ['project', 'project-two', 'sibling project'], names",
      "created = dashboard.create_project({'name': 'ui project'})",
      "assert created['display_name'] == 'ui project', created",
      "assert (temp_root / 'ui_project' / '.co-auto-research' / 'project.json').exists()",
      "renamed = dashboard.rename_project({'project': created['id'], 'name': 'renamed ui project'})",
      "assert renamed['display_name'] == 'renamed ui project', renamed",
      "try:",
      "    dashboard.delete_project({'project': created['id'], 'confirm': 'ui project'})",
      "    raise AssertionError('project deletion did not require exact confirmation name')",
      "except ValueError:",
      "    pass",
      "deleted = dashboard.delete_project({'project': created['id'], 'confirm': 'renamed ui project'})",
      "assert all(item['id'] != created['id'] for item in deleted['projects'])",
      "assert not (temp_root / 'ui_project').exists()",
      "print(json.dumps({'single': single_names, 'default': from_ui['display_name'], 'renamed': renamed['display_name'], 'deleted': deleted['deleted_project_id']}))"
    ].join("\n")
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_TEMPLATE_ROOT: path.join(root, "templates", "default"),
      COAUTO_TEMP_ROOT: tempRoot,
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (!registryOutput.includes("renamed ui project")) {
    throw new Error(`project registry smoke test returned unexpected output: ${registryOutput}`);
  }
  console.log("Smoke test passed.");
} finally {
  await fsp.rm(tempRoot, { recursive: true, force: true });
}
