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

async function fetchWithTimeout(url, options = {}, timeoutMs = 750) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForJson(url, timeoutMs = 8000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetchWithTimeout(url);
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
      const response = await fetchWithTimeout(url);
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
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, 4000);
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
  const resourceIntakeInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "RESOURCE_INTAKE.md"), "utf8");
  const conversionInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "CONVERSION.md"), "utf8");
  const executionInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "EXECUTION_AGENT.md"), "utf8");
  const resourceManifestTemplate = await fsp.readFile(path.join(root, "templates", "default", "resources", "user_input", "RESOURCE_MANIFEST.md"), "utf8");
  const literatureReadme = await fsp.readFile(path.join(root, "templates", "default", "resources", "literature", "README.md"), "utf8");
  if (
    !resourceIntakeInstructions.includes("## Embedded Resource Scan") ||
    !resourceIntakeInstructions.includes("A general bibliography embedded in an ongoing manuscript is not automatically a target-venue seed-paper set") ||
    !conversionInstructions.includes("Do not interpret an empty `resources/target_venue/papers/` folder as proof that no literature exists") ||
    !executionInstructions.includes("A manuscript `references.bib` or bibliography inside `resources/ongoing_work/` is literature grounding") ||
    !resourceManifestTemplate.includes("## Embedded Resource Surfacing") ||
    !literatureReadme.includes("surface them here")
  ) {
    throw new Error("resource intake must surface embedded ongoing-work bibliographies without confusing them with target-venue seed papers");
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

  const singlePort = await freePort();
  const singleServer = spawn("node", [cli, "ui", "--project", projectDir, "--host", "127.0.0.1", "--port", String(singlePort), "--no-open"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const singleBoundPort = await waitForOpenPort(singleServer);
    if (singleBoundPort !== singlePort) {
      throw new Error(`single-project UI bound unexpected port ${singleBoundPort}, expected ${singlePort}`);
    }
    const payload = await waitForJson(`http://127.0.0.1:${singleBoundPort}/api/projects`);
    if (payload.multi_project || (payload.projects || []).length !== 1) {
      throw new Error("single-project UI did not start in single-project mode");
    }
    const created = await postJson(`http://127.0.0.1:${singleBoundPort}/api/projects`, { name: "sibling project" });
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
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const defaultBoundPort = await waitForOpenPort(defaultServer);
    if (defaultBoundPort !== defaultPort) {
      throw new Error(`default UI bound unexpected port ${defaultBoundPort}, expected ${defaultPort}`);
    }
    const payload = await waitForJson(`http://127.0.0.1:${defaultBoundPort}/api/projects`);
    if (!payload.multi_project || (payload.projects || []).length !== 0) {
      throw new Error("default UI did not start as an empty dashboard");
    }
    await waitForHtml(`http://127.0.0.1:${defaultBoundPort}/`);
    const created = await postJson(`http://127.0.0.1:${defaultBoundPort}/api/projects`, { name: "from ui" });
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
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const boundPort = await waitForOpenPort(server);
    if (boundPort !== port) {
      throw new Error(`multi-project UI bound unexpected port ${boundPort}, expected ${port}`);
    }
    const payload = await waitForJson(`http://127.0.0.1:${boundPort}/api/projects`);
    const names = (payload.projects || []).map((project) => project.display_name).sort();
    if (JSON.stringify(names) !== JSON.stringify(["project", "project-two", "sibling project"])) {
      throw new Error(`multi-project API returned unexpected projects: ${names.join(", ")}`);
    }
    const created = await postJson(`http://127.0.0.1:${boundPort}/api/projects`, { name: "ui project" });
    if (created.project?.display_name !== "ui project") {
      throw new Error("UI project creation did not preserve display name");
    }
    await fsp.access(path.join(tempRoot, "ui_project", "AGENTS.md"));
    await fsp.access(path.join(tempRoot, "ui_project", ".co-auto-research", "project.json"));
    const renamed = await postJson(`http://127.0.0.1:${boundPort}/api/projects/rename`, { project: created.project.id, name: "renamed ui project" });
    if (renamed.project?.display_name !== "renamed ui project") {
      throw new Error("project rename did not update display name");
    }
    let deleteRejected = false;
    try {
      await postJson(`http://127.0.0.1:${boundPort}/api/projects/delete`, { project: created.project.id, confirm: "ui project" });
    } catch {
      deleteRejected = true;
    }
    if (!deleteRejected) {
      throw new Error("project deletion did not require exact confirmation name");
    }
    const deleted = await postJson(`http://127.0.0.1:${boundPort}/api/projects/delete`, { project: created.project.id, confirm: "renamed ui project" });
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
