#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

function assertJsonEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

function loadAppContext() {
  const elements = new Map();
  const storage = new Map();
  const clipboardWrites = [];
  const element = (extra = {}) => ({
    value: "",
    hidden: false,
    innerHTML: "",
    textContent: "",
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    dispatchEvent() {},
    appendChild() {},
    remove() {},
    select() {},
    focus() {},
    setSelectionRange() {},
    toggleAttribute(name, force) { this[name] = Boolean(force); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    ...extra,
  });
  const coldEditor = element();
  const projectEditor = element({ value: "# Project\n\nReady." });
  const trialStripScroll = element({
    clientWidth: 300,
    scrollWidth: 1200,
    scrollLeft: 0,
  });
  const launchDialog = element({
    close() { this.closed = true; },
    showModal() { this.open = true; },
  });
  const restartDialog = element({
    close() { this.closed = true; },
    showModal() { this.open = true; },
  });
  [
    ["#cold-file-editor", coldEditor],
    ["#launch-files", element()],
    ["#cold-file-tabs", element()],
    ["#cold-editor-title", element()],
    ["#cold-editor-path", element()],
    ["#cold-save-status", element()],
    ["#cold-file-preview", element()],
    ["#cold-editor-workbench", element()],
    [".trial-strip-scroll", trialStripScroll],
    ["#project-draft-editor", projectEditor],
    ["#target-venue", element()],
    ["#framing-thread", element()],
    ["#brief-editor-shell", element({ parentElement: null })],
    ["#brief-editor-anchor", element()],
    ["#framing-scroll-bottom", element()],
    ["#cold-start-workspace", element()],
    ["#framing-project-panel", element()],
    ["#open-launch-dialog", element()],
    ["#open-launch-dialog-inline", element()],
    ["#composer-suggestions", element()],
    ["#launch-dialog", launchDialog],
    ["#restart-autoresearch-dialog", restartDialog],
    ["#restart-autoresearch-reason", element()],
    ["#chat-thread", element()],
  ].forEach(([selector, value]) => elements.set(selector, value));

  const context = {
    console,
    URLSearchParams,
    FormData: class FormData {
      constructor(form) {
        this.form = form;
      }
      get(name) {
        return this.form?.values?.[name] || "";
      }
    },
    CSS: { escape: (value) => String(value) },
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
    window: {
      location: { search: "?project=p1" },
      innerHeight: 900,
      addEventListener() {},
      scrollTo() {},
    },
    document: {
      body: element(),
      documentElement: { scrollHeight: 0, clientHeight: 0, dataset: {} },
      querySelector(selector) {
        return elements.get(selector) || null;
      },
      querySelectorAll() {
        return [];
      },
      createElement() {
        return element();
      },
      execCommand() {
        return true;
      },
      addEventListener() {},
    },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    navigator: { clipboard: { writeText: async (text) => { clipboardWrites.push(String(text)); } } },
    requestAnimationFrame(callback) {
      callback();
    },
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    globalThis: null,
  };
  context.globalThis = context;
  vm.createContext(context);
  const appPath = path.join(root, "templates", "default", "ui", "app.js");
  const appCode = fs
    .readFileSync(appPath, "utf8")
    .replace(/init\(\)\.catch\(\(error\) => showToast\(error\.message, true\)\);\s*$/, "globalThis.__appLoaded = true;");
  vm.runInContext(appCode, context, { filename: appPath });
  vm.runInContext(
    `
    globalThis.__apiCalls = [];
    globalThis.__renderCount = 0;
    globalThis.__persistCount = 0;
    globalThis.__scrollCount = 0;
    globalThis.__collectSeen = null;
    globalThis.__toastMessages = [];
    activeProjectId = "p1";
    activeView = "chat";
    appState = {
      project: { id: "p1", display_name: "project" },
      projects: [{ id: "p1", display_name: "project" }],
      active_project_id: "p1",
      files: { project: { text: "# Project\\n\\nReady." } },
      framing: { messages: [], project_ready: true },
      trials: [],
      research_session: {
        id: "s1",
        session_id: "sid",
        status: "completed",
        mode: "chat",
        started_at: "2026-06-17T10:00:00.000Z",
        transcript: []
      }
    };
    projectDraftDirty = false;
    coldFiles["PROJECT.md"] = "# Project\\n\\nReady.";
    persistFramingMessages = async () => {
      globalThis.__persistCount += 1;
      globalThis.__persistedMessages = globalThis.__messages();
      return { ok: true };
    };
    renderFramingConversation = () => {
      globalThis.__renderCount += 1;
      globalThis.__lastRenderedMessages = globalThis.__messages();
    };
    renderChatState = () => {};
    renderSession = () => {};
    renderResumeCommandBar = () => {};
    renderComposerSuggestions = () => {};
    renderSelectedResources = () => {};
    saveResourceSelections = () => {};
    resizeColdEditor = () => {};
    renderColdPreview = () => {};
    resizeComposer = () => {};
    scrollFramingToBottomSoon = () => { globalThis.__scrollCount += 1; };
    scrollThread = () => { globalThis.__scrollCount += 1; };
    notifyResourceHandlingFromResponse = () => {};
    settingsFromForm = () => ({});
    showToast = (message, error = false) => { globalThis.__toastMessages.push({ message, error }); };
    openProjectCreateDialog = () => {};
    setColdViewMode = () => {};
    markPrepareSaved = () => {};
    renderStage = () => {};
    loadOverview = async () => {};
    saveProjectDraft = async () => {};
    startFramingRun = async (brief) => {
      globalThis.__startedFramingBrief = brief;
      appState.research_session = { ...appState.research_session, mode: "framing", status: "running" };
      return { ok: true };
    };
    collectUploadFiles = async () => {
      globalThis.__collectSeen = {
        messages: globalThis.__messages(),
        editorValue: document.querySelector("#cold-file-editor")?.value || "",
        renderCount: globalThis.__renderCount,
      };
      if (globalThis.__collectPromise) return globalThis.__collectPromise;
      return [];
    };
    api = async (endpoint, options = {}) => {
      if (globalThis.__apiError) throw new Error(globalThis.__apiError);
      const body = options.body ? JSON.parse(options.body) : {};
      globalThis.__apiCalls.push({ endpoint, body });
      return globalThis.__apiResponse || {
        ok: true,
        result: {
          session: {
            id: "s2",
            session_id: "sid",
            status: "running",
            mode: endpoint.includes("command") ? "command" : "chat",
            started_at: "2026-06-17T10:01:00.000Z",
            transcript: []
          }
        }
      };
    };
    globalThis.__messages = () => localMessages.map((message) => ({
      id: message.id,
      role: message.role,
      kind: message.kind,
      text: message.text,
      edited_at: message.edited_at || "",
      attachments: message.attachments || [],
      resumeFromTrial: message.resumeFromTrial || null,
      artifact: message.artifact || null,
    }));
    globalThis.__setMessages = (messages) => {
      localMessages.splice(0, localMessages.length, ...messages.map((message) => normalizeFramingMessage(message)).filter(Boolean));
      lastFramingHtml = "";
    };
    globalThis.__setSession = (session) => {
      appState.research_session = session;
    };
    globalThis.__setServerMessages = (messages) => {
      appState.framing.messages = messages;
    };
    globalThis.__setTranscript = (transcript) => {
      appState.research_session.transcript = transcript;
    };
    globalThis.__setSelectedResources = (items) => {
      selectedResourceItems.splice(0, selectedResourceItems.length, ...items);
    };
    globalThis.__selectedResources = () => selectedResourceItems.map((item) => ({ ...item }));
    globalThis.__setSelectedUploads = (items) => {
      selectedUploadItems.splice(0, selectedUploadItems.length, ...items);
    };
    globalThis.__themeState = () => ({
      mode: currentThemeMode,
      dataset: document.documentElement.dataset.theme,
      stored: localStorage.getItem("coAutoResearchTheme"),
    });
    globalThis.__resetRuntimeFlags = () => {
      framingDraftPending = false;
      framingReplyPending = false;
      pendingFramingUserMessageId = "";
      framingPendingSince = 0;
      framingMessagesPersisting = false;
      sentFramingResourceItems.splice(0);
      sentFramingUploadItems.splice(0);
      selectedResourceItems.splice(0);
      selectedUploadItems.splice(0);
      selectedResumeTrialContext = null;
      pendingResumeTrialConfirm = null;
      pendingRestartAutoresearchConfirm = null;
      globalThis.__apiCalls = [];
      globalThis.__apiError = "";
      globalThis.__confirmCalls = [];
      globalThis.__confirmResume = true;
      globalThis.__restartConfirmCalls = [];
      globalThis.__confirmRestart = true;
      globalThis.__renderCount = 0;
      globalThis.__persistCount = 0;
      globalThis.__collectSeen = null;
      globalThis.__collectPromise = null;
      globalThis.__resolveCollect = null;
      document.querySelector("#cold-file-editor").value = "";
      document.querySelector("#launch-dialog").closed = false;
    };
    globalThis.__installBlockingCollect = () => {
      globalThis.__collectPromise = new Promise((resolve) => {
        globalThis.__resolveCollect = () => resolve([]);
      });
    };
    globalThis.__setPendingFlags = () => {
      framingReplyPending = true;
      framingMessagesPersisting = true;
    };
    globalThis.__pendingState = () => ({
      reply: framingReplyPending,
      draft: framingDraftPending,
      pendingId: pendingFramingUserMessageId,
      since: framingPendingSince,
    });
    globalThis.__setResumeTrialContext = (context) => {
      selectedResumeTrialContext = normalizeResumeTrialContext(context);
    };
    globalThis.__resumeTrialContext = () => selectedResumeTrialContext;
    globalThis.__confirmCalls = [];
    globalThis.__confirmResume = true;
    confirmResumeTrialSend = async (context, text, attachments) => {
      globalThis.__confirmCalls.push({ context, text, attachments });
      return globalThis.__confirmResume;
    };
    globalThis.__restartConfirmCalls = [];
    globalThis.__confirmRestart = true;
    confirmRestartAutoresearch = async (reason) => {
      globalThis.__restartConfirmCalls.push(reason);
      return globalThis.__confirmRestart;
    };
    globalThis.__latestUnansweredText = () => latestUnansweredUserMessage(localMessages)?.text || "";
    globalThis.__restore = () => restoreFramingMessages();
    globalThis.__activityProbe = () => {
      const entries = sessionTranscriptEntries();
      const activity = buildFramingActivityByMessage(localMessages, entries);
      const assistant = localMessages.find((message) => message.role === "assistant" && message.kind !== "project");
      const html = assistant ? (activity.htmlBeforeMessageId.get(assistant.id) || "") : "";
      return {
        hasWorked: html.includes("Worked for"),
        hasPartial: html.includes("partial status"),
        hasFinal: html.includes("Final **answer**"),
        omittedCount: activity.omittedEntryIds.size,
      };
    };
    globalThis.__messageHtml = (index = 0) => framingMessageHtml(localMessages[index]);
    globalThis.__sessionTimelineProbe = () => sessionTimelineHtml(sessionTranscriptEntries());
    globalThis.__thinkingProbe = () => framingThinkingHtml();
    globalThis.__progressDetailsProbe = () => framingProgressDetailsHtml();
    globalThis.__formatWorkedDuration = (seconds) => formatWorkedDuration(seconds);
    globalThis.__statusCardProbe = (payload) => statusCardHtml(payload, { id: "status-test" });
    globalThis.__trialStripScrollProbe = (scrollLeft, clientWidth = 300, scrollWidth = 1200) => {
      const strip = document.querySelector(".trial-strip-scroll");
      strip.clientWidth = clientWidth;
      strip.scrollWidth = scrollWidth;
      strip.scrollLeft = scrollLeft;
      rememberTrialStripScroll(strip);
      strip.scrollLeft = 0;
      restoreTrialStripScroll();
      return strip.scrollLeft;
    };
    globalThis.__renderManuscriptPanelProbe = (payload) => {
      appState.summaries = { ...(appState.summaries || {}), manuscript: payload };
      return renderManuscriptPanel();
    };
    globalThis.__copyTextProbe = async (text) => copyTextToClipboard(text, "Probe copied.");
    `,
    context
  );
  return {
    context,
    run(expression) {
      return vm.runInContext(expression, context);
    },
    coldEditor,
    launchDialog,
    clipboardWrites,
  };
}

function sourceText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function extractButtonTags(text) {
  return [...text.matchAll(/<button\b[\s\S]*?<\/button>/gi)].map((match) => match[0]);
}

function extractDataAttrs(tag) {
  return [...tag.matchAll(/\bdata-([a-z0-9-]+)(?:=|\s|>)/gi)].map((match) => match[1]);
}

function extractClassNames(tag) {
  const match = tag.match(/\bclass=(["'])(.*?)\1/s);
  return match ? match[2].split(/\s+/).filter(Boolean) : [];
}

function extractId(tag) {
  return tag.match(/\bid=(["'])(.*?)\1/s)?.[2] || "";
}

function extractType(tag) {
  return tag.match(/\btype=(["'])(.*?)\1/s)?.[2] || "";
}

function handledButtonDataAttrs(appJs) {
  const attrs = new Set();
  for (const match of appJs.matchAll(/closest\("\[data-([a-z0-9-]+)(?:[=\]"])/gi)) attrs.add(match[1]);
  for (const match of appJs.matchAll(/\$\$\("\[data-([a-z0-9-]+)(?:[=\]"])/gi)) attrs.add(match[1]);
  return attrs;
}

function directlyHandledButtonIds(appJs) {
  const ids = new Set();
  for (const match of appJs.matchAll(/\$\("#([^"]+)"\)\??\.addEventListener\("click"/g)) ids.add(match[1]);
  for (const match of appJs.matchAll(/closest\("#([^"]+)"\)/g)) ids.add(match[1]);
  return ids;
}

function testButtonInventoryHasHandlers() {
  const appJs = sourceText("templates/default/ui/app.js");
  const indexHtml = sourceText("templates/default/ui/index.html");
  const handledData = handledButtonDataAttrs(appJs);
  const handledIds = directlyHandledButtonIds(appJs);
  const handledClasses = new Set(["rail-action", "settings-nav-button", "stage-pill"]);
  const passiveDataAttrs = new Set(["inline-path"]);
  const issues = [];
  const dynamicActionAttrs = [...appJs.matchAll(/addActionChip\([^,]+,\s*"data-([a-z0-9-]+)"/g)].map((match) => match[1]);
  const buttons = [
    ...extractButtonTags(indexHtml).map((tag) => ({ tag, source: "index.html" })),
    ...extractButtonTags(appJs).map((tag) => ({ tag, source: "app.js" })),
  ];

  for (const { tag, source } of buttons) {
    if (/\bdisabled\b/i.test(tag)) continue;
    if (tag.includes("${action}") && tag.includes("composer-suggestion-chip")) continue;
    const type = extractType(tag).toLowerCase();
    if (type === "submit" || /\bformmethod=(["'])dialog\1/i.test(tag)) continue;
    const id = extractId(tag);
    const dataAttrs = extractDataAttrs(tag).filter((attr) => !passiveDataAttrs.has(attr));
    const classes = extractClassNames(tag);
    const hasHandledData = dataAttrs.some((attr) => handledData.has(attr));
    const hasHandledId = id && handledIds.has(id);
    const hasHandledClass = classes.some((name) => handledClasses.has(name));
    if (!hasHandledData && !hasHandledId && !hasHandledClass) {
      issues.push(`${source}: ${tag.replace(/\s+/g, " ").slice(0, 180)}`);
    }
  }

  assert.deepEqual(issues, [], "all enabled buttons should have a direct handler, delegated handler, submit role, dialog role, or explicit disabled state");
  assert.deepEqual(dynamicActionAttrs.filter((attr) => !handledData.has(attr)), [], "dynamic composer action chips should only use delegated data handlers");
  assert.equal(appJs.includes('const card = cardPreview.closest(".context-card, .review-card")'), true, "Preview buttons must search both manuscript/context and review cards");
  assert.equal(appJs.includes('String(action || "").includes("data-card-preview")'), true, "context card previews must allocate an inline target slot");
  assert.equal(appJs.includes("[data-copy-text]"), true, "copy controls must have a delegated handler");
  assert.equal(appJs.includes("[data-inline-fullscreen]"), true, "open controls must use the inline fullscreen handler");
}

async function testImmediateUserMessage() {
  const app = loadAppContext();
  app.coldEditor.value = "Can you explain the project?";
  app.run("__installBlockingCollect()");
  const pending = app.run('sendSessionComposerMessage("Can you explain the project?")');
  assert.equal(app.coldEditor.value, "", "composer should clear before upload collection or API");
  assert.equal(app.context.__collectSeen.editorValue, "", "upload collection should see an already-cleared composer");
  assert.ok(app.context.__collectSeen.renderCount > 0, "message should render before upload collection");
  const pendingState = app.context.__pendingState();
  assert.equal(pendingState.reply, true, "normal chat messages should show immediate pending feedback");
  assert.equal(pendingState.pendingId, app.context.__messages()[0].id, "normal chat pending state should be tied to the sent message");
  assert.ok(pendingState.since > 0, "normal chat pending state should start a visible working timer");
  assertJsonEqual(
    app.context.__messages().map((message) => `${message.role}:${message.text}`),
    ["user:Can you explain the project?"],
    "sent chat message should be visible immediately"
  );
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat");
  assert.equal(app.context.__apiCalls[0].body.message, "Can you explain the project?");
}

async function testAttachmentOnlyMessage() {
  const app = loadAppContext();
  app.run('__setSelectedResources([{ path: "/tmp/paper.pdf", category: "literature" }])');
  app.run("__installBlockingCollect()");
  const pending = app.run("sendSessionComposerMessage('')");
  const [message] = app.context.__messages();
  assert.equal(message.text, "Attached 1 resource.");
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].kind, "link");
  assert.equal(app.context.__pendingState().reply, true, "attachment-only messages should show immediate pending feedback");
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].body.message, "Attached 1 resource.");
  assertJsonEqual(app.context.__apiCalls[0].body.resourceLinks, [{ path: "/tmp/paper.pdf", category: "literature" }]);
}

async function testResumeFromTrialRequiresConfirmationAndSendsPayload() {
  const app = loadAppContext();
  app.coldEditor.value = "Try a stricter reviewer pass from here.";
  app.run(`
    __setResumeTrialContext({
      id: "000003_evidence_audit",
      path: "research_trajectory/trials/000003_evidence_audit",
      iteration: 3,
      name: "000003_evidence_audit",
      reportPath: "research_trajectory/trials/000003_evidence_audit/REPORT.md",
      checkpointExists: false
    });
  `);
  app.run("__installBlockingCollect()");
  const pending = app.run('sendSessionComposerMessage("Try a stricter reviewer pass from here.")');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.context.__confirmCalls.length, 1, "resume-from-trial sends must ask for confirmation");
  assert.equal(app.context.__confirmCalls[0].context.id, "000003_evidence_audit");
  assert.equal(app.coldEditor.value, "", "confirmed resume send should clear the composer before upload collection");
  const [message] = app.context.__messages();
  assert.equal(message.resumeFromTrial.id, "000003_evidence_audit", "visible user message should retain resume context");
  assert.equal(app.context.__resumeTrialContext(), null, "confirmed resume send should remove the staged chip");
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/resume-from-trial");
  assert.equal(app.context.__apiCalls[0].body.resumeFromTrial.id, "000003_evidence_audit");
  assert.equal(app.context.__apiCalls[0].body.resumeFromTrial.checkpointExists, false);
}

async function testResumeFromTrialCancelPreservesComposer() {
  const app = loadAppContext();
  app.coldEditor.value = "Do not submit yet.";
  app.context.__confirmResume = false;
  app.run(`
    __setResumeTrialContext({
      id: "000002_style_review",
      path: "research_trajectory/trials/000002_style_review",
      iteration: 2,
      name: "000002_style_review",
      reportPath: "research_trajectory/trials/000002_style_review/REPORT.md",
      checkpointExists: true
    });
  `);
  const sent = await app.run('sendSessionComposerMessage("Do not submit yet.")');
  assert.equal(sent, false, "cancelled resume send should report that nothing was submitted");
  assert.equal(app.context.__apiCalls.length, 0, "cancelled resume send must not call the backend");
  assert.equal(app.context.__messages().length, 0, "cancelled resume send must not append a user message");
  assert.equal(app.coldEditor.value, "Do not submit yet.", "cancelled resume send should preserve typed text");
  assert.equal(app.context.__resumeTrialContext().id, "000002_style_review", "cancelled resume send should preserve the staged chip");
}

async function testResumeTrialSlashCommandIsBlocked() {
  const app = loadAppContext();
  app.coldEditor.value = "/goal resume";
  app.run(`
    __setResumeTrialContext({
      id: "000001_uploaded_manuscript_baseline_audit",
      path: "research_trajectory/trials/000001_uploaded_manuscript_baseline_audit",
      iteration: 1,
      name: "000001_uploaded_manuscript_baseline_audit",
      reportPath: "research_trajectory/trials/000001_uploaded_manuscript_baseline_audit/REPORT.md",
      checkpointExists: true
    });
  `);
  const sent = await app.run('sendSessionComposerMessage("/goal resume")');
  assert.equal(sent, false, "/goal resume with a staged trial must not be converted into a fork send");
  assert.equal(app.coldEditor.value, "/goal resume", "blocked slash command should preserve composer text");
  assert.equal(app.context.__resumeTrialContext().id, "000001_uploaded_manuscript_baseline_audit", "blocked slash command should preserve the staged trial chip");
  assert.equal(app.context.__messages().length, 0, "blocked slash command must not append a user message");
  assert.equal(app.context.__apiCalls.length, 0, "blocked slash command must not call the backend");
}

async function testFailedSessionSendRestoresComposerState() {
  const app = loadAppContext();
  app.coldEditor.value = "Continue from here with a stricter pass.";
  app.context.__apiError = "Backend rejected the fork.";
  app.run(`
    __setSelectedResources([{ path: "/tmp/evidence.pdf", category: "literature" }]);
    __setResumeTrialContext({
      id: "000003_evidence_audit",
      path: "research_trajectory/trials/000003_evidence_audit",
      iteration: 3,
      name: "000003_evidence_audit",
      reportPath: "research_trajectory/trials/000003_evidence_audit/REPORT.md",
      checkpointExists: false
    });
  `);
  await assert.rejects(
    app.run('sendSessionComposerMessage("Continue from here with a stricter pass.")'),
    /Backend rejected the fork/
  );
  assert.equal(app.coldEditor.value, "Continue from here with a stricter pass.", "backend failure must restore the typed text");
  assert.equal(app.context.__resumeTrialContext().id, "000003_evidence_audit", "backend failure must restore the staged trial chip");
  assertJsonEqual(app.context.__selectedResources(), [{ path: "/tmp/evidence.pdf", category: "literature" }], "backend failure must restore selected resources");
  assert.equal(app.context.__messages().length, 0, "backend failure must remove the optimistic user message");
}

async function testSlashCommandVisibleAndIgnoredAsUnanswered() {
  const app = loadAppContext();
  app.coldEditor.value = "/goal resume";
  app.run("__installBlockingCollect()");
  const pending = app.run('sendSessionComposerMessage("/goal resume")');
  const [message] = app.context.__messages();
  assert.equal(message.kind, "command");
  assert.equal(message.text, "/goal resume");
  const pendingState = app.context.__pendingState();
  assert.equal(pendingState.reply, true, "slash commands should show immediate pending feedback while the command posts");
  assert.equal(pendingState.pendingId, message.id, "slash command pending state should be tied to the visible command row");
  assert.ok(pendingState.since > 0, "slash command pending state should start a visible working timer");
  const html = app.run("__messageHtml(0)");
  assert.equal(html.includes('class="framing-message control"'), true, "slash command should render as a control row, not a user bubble");
  assert.equal(html.includes("Resume autoresearch"), true, "slash command control row should render human-facing autoresearch copy");
  assert.equal(html.includes("/goal resume"), false, "slash command control row should not expose the internal command text");
  assert.equal(html.includes(">You<"), false, "slash command control row should not be labelled as a user chat turn");
  assert.equal(html.includes("data-framing-edit"), false, "slash command control row should not be editable like a normal user message");
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/command");
  assert.equal(app.run("__latestUnansweredText()"), "", "slash command should not create a fake unanswered chat state");
}

async function testRestartCommandRequiresConfirmationAndSendsRestartEndpoint() {
  const app = loadAppContext();
  app.coldEditor.value = "/goal restart";
  app.run("__installBlockingCollect()");
  const pending = app.run('sendSessionComposerMessage("/goal restart")');
  assert.equal(app.context.__restartConfirmCalls.length, 1, "restart must ask for explicit confirmation");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(app.coldEditor.value, "", "confirmed restart should clear composer before backend work");
  const [message] = app.context.__messages();
  assert.equal(message.kind, "command", "restart command should render as a command control row");
  const html = app.run("__messageHtml(0)");
  assert.equal(html.includes("Restart autoresearch"), true, "restart command should use human-facing copy");
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/restart");
  assert.equal(app.context.__apiCalls[0].body.message, "/goal restart");
}

async function testRestartCancelPreservesComposer() {
  const app = loadAppContext();
  app.context.__confirmRestart = false;
  app.coldEditor.value = "/goal restart";
  const sent = await app.run('sendSessionComposerMessage("/goal restart")');
  assert.equal(sent, false, "cancelled restart should not submit");
  assert.equal(app.context.__apiCalls.length, 0, "cancelled restart must not call backend");
  assert.equal(app.context.__messages().length, 0, "cancelled restart must not append a command row");
  assert.equal(app.coldEditor.value, "/goal restart", "cancelled restart should preserve typed command");
}

function testStaleOverviewDoesNotSwallowPendingUser() {
  const app = loadAppContext();
  app.run(`
    __setMessages([{ id: "u1", role: "user", kind: "text", text: "message survives", created_at: "2026-06-17T10:00:00.000Z" }]);
    __setServerMessages([]);
    __setSession({ id: "s1", session_id: "sid", status: "running", mode: "chat", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
    __setPendingFlags();
    __restore();
  `);
  const texts = app.context.__messages().map((message) => message.text);
  assert.equal(texts[0], "message survives");
  assert.ok(texts.includes("message survives"), "pending user message should survive stale overview restore");
}

function testTranscriptRecoveryUsesOnlyFinalAssistant() {
  const app = loadAppContext();
  app.run(`
    __setMessages([]);
    __setServerMessages([]);
    __setSession({ id: "s1", session_id: "sid", status: "completed", mode: "chat", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
    __setTranscript([
      { id: "tu1", role: "user", kind: "user", raw_type: "ui.chat", content: "Question", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "ta1", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "partial status", created_at: "2026-06-17T10:00:03.000Z" },
      { id: "tf1", role: "final", kind: "final", raw_type: "turn.completed", content: "Final **answer**", created_at: "2026-06-17T10:00:05.000Z" }
    ]);
    __restore();
  `);
  assertJsonEqual(app.context.__messages().filter((message) => message.kind !== "project").map((message) => `${message.role}:${message.text}`), [
    "user:Question",
    "assistant:Final **answer**",
  ]);
  const activity = app.run("__activityProbe()");
  assert.equal(activity.hasWorked, true, "activity should fold before the final assistant response");
  assert.equal(activity.hasPartial, true, "intermediate status should live inside folded activity");
  assert.equal(activity.hasFinal, false, "final answer should not be hidden inside folded activity");
}

async function testEditTruncatesLaterConversationBeforeResend() {
  const app = loadAppContext();
  app.run(`
    __setMessages([
      { id: "u1", role: "user", kind: "text", text: "old question", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "old answer", created_at: "2026-06-17T10:00:01.000Z" },
      { id: "u2", role: "user", kind: "text", text: "later question", created_at: "2026-06-17T10:00:02.000Z" },
      { id: "a2", role: "assistant", kind: "text", text: "later answer", created_at: "2026-06-17T10:00:03.000Z" }
    ]);
  `);
  await app.run('resendFramingMessage("u1", "edited question")');
  const messages = app.context.__messages();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "edited question");
  assert.ok(messages[0].edited_at, "edited user message should record edited_at");
  assert.equal(app.context.__startedFramingBrief, "edited question");
}

async function testLaunchGoalMessageBeforeBackendWork() {
  const app = loadAppContext();
  app.coldEditor.value = "launch brief";
  app.run("__installBlockingCollect()");
  const pending = app.run("launchAutoresearch()");
  assert.equal(app.launchDialog.closed, true, "launch dialog should close before uploads/API complete");
  assert.ok(app.context.__messages().some((message) => message.kind === "goal-launch"), "goal launch message should render immediately");
  const pendingState = app.context.__pendingState();
  assert.equal(pendingState.draft, true, "goal launch should show immediate pending feedback");
  assert.ok(pendingState.since > 0, "goal launch pending state should start a visible working timer");
  const html = app.run("__messageHtml(0)");
  assert.equal(html.includes('class="framing-message control"'), true, "goal launch should render as a control row, not a user bubble");
  assert.equal(html.includes("Autoresearch"), true);
  assert.equal(html.includes("Start autoresearch"), true);
  assert.equal(html.includes("/goal"), false);
  assert.equal(html.includes("Command sent"), false);
  assert.equal(html.includes("Autoresearch control"), false);
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/cold-start");
}

function testSessionTimelineDoesNotRenderCurrentActivityCard() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [];
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "running",
      mode: "goal",
      loop_active: true,
      loop_iteration: 1,
      started_at: "2026-06-17T10:00:00.000Z",
      active_run: {
        running: true,
        mode: "goal",
        run_id: "s1",
        started_at: "2026-06-17T10:00:00.000Z",
        trial_iteration: 1,
        trial_label: "Trial 1",
        status_label: "Codex is working on Trial 1"
      },
      transcript: [
        { id: "tu1", role: "user", kind: "user", raw_type: "ui.goal", content: "Start autoresearch loop with /goal.", created_at: "2026-06-17T10:00:00.000Z" },
        { id: "tc1", role: "command", kind: "command", raw_type: "process.started", content: "codex exec resume", created_at: "2026-06-17T10:00:01.000Z" },
        { id: "ta1", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Checking sources.", created_at: "2026-06-17T10:00:04.000Z" }
      ]
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("Current session activity"), false, "trial timeline must not append the old current-session activity card");
  assert.equal(html.includes("Latest session activity"), false, "trial timeline must not append legacy session activity labels");
  assert.equal(html.includes("Codex is working on Trial 1"), true, "running trials should use the server-provided active run label");
  assert.equal(html.includes("Pause after current turn"), true, "running trial live status should expose a loop pause button");
  assert.equal(html.includes("data-pause-autoresearch"), true, "contextual pause button should pause the loop after the current turn");
  assert.equal(html.includes("Stop current run"), true, "running trial live status should expose a contextual stop button");
  assert.equal(html.includes("data-stop-current-run"), true, "contextual stop button should stop the active Codex process");
  assert.equal(html.includes("Live trial activity"), true, "running trial event details should be folded under the live status row");
  assert.equal(html.includes("Report pending"), false, "running trial should not render a low-information pending report card");
  assert.equal(html.includes("Report is not available yet."), false, "running trial should not render a low-information pending report card");
  assert.equal(html.includes("<span>Trial activity</span>"), false, "running trial details should stay in the live status row instead of a duplicate report card");
  const thinkingHtml = app.run("__thinkingProbe()");
  assert.equal(thinkingHtml.includes("Codex is working on Trial 1"), true, "working bubble should name the active trial");
  assert.equal(thinkingHtml.includes("Working for"), true, "working bubble should show elapsed running time");
  assert.equal(thinkingHtml.includes("Trial 1"), true, "working bubble should include the trial axis for autoresearch runs");
  assert.equal(thinkingHtml.includes("Update: Checking sources."), true, "current run activity summary should expose the latest update");
}

function testPassedGoalDoesNotShowStaleRunningTrial() {
  const app = loadAppContext();
  app.run(`
    appState.trials = Array.from({ length: 6 }, (_, index) => {
      const iteration = index + 1;
      return {
        id: String(iteration).padStart(6, "0") + "_reported_trial",
        status: "reported",
        report_path: "research_trajectory/trials/" + String(iteration).padStart(6, "0") + "_reported_trial/REPORT.md",
        report_summary: "Reported trial " + iteration
      };
    });
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "running",
      mode: "goal",
      loop_active: false,
      loop_iteration: 2,
      gate: { status: "pass" },
      started_at: "2026-06-17T10:00:00.000Z",
      transcript: [
        { id: "tc1", role: "command", kind: "command", raw_type: "process.started", iteration: 2, content: "codex exec resume", created_at: "2026-06-17T10:00:01.000Z" },
        { id: "ta1", role: "assistant", kind: "assistant", raw_type: "item.completed", iteration: 2, content: "Old trial 2 event.", created_at: "2026-06-17T10:00:04.000Z" }
      ]
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("Trial 2 is running"), false, "passed goals must not show stale loop_iteration as a live trial");
  assert.equal(html.includes("Live trial activity"), false, "passed goals must not show live activity for stale trial events");
  assert.equal(html.includes(">Running<"), false, "reported trials must not retain the Running chip label after gates pass");
  assert.equal(html.includes("Trial 6"), true, "passed goals should default to the latest reported trial");
  assert.equal(html.includes("Autoresearch complete"), true, "passed goals should mark the whole autoresearch trajectory complete");
  app.run(`
    appState.research_session.gate = { status: "continue" };
  `);
  const continuingHtml = app.run("__sessionTimelineProbe()");
  assert.equal(continuingHtml.includes("Autoresearch complete"), false, "incomplete gates must not show the autoresearch complete tag");
}

function testCurrentRunActivityShowsPauseForChatRun() {
  const app = loadAppContext();
  app.run(`
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "running",
      mode: "chat",
      loop_active: false,
      loop_iteration: 0,
      started_at: "2026-06-17T10:00:00.000Z",
      active_run: {
        running: true,
        mode: "chat",
        run_id: "s1",
        started_at: "2026-06-17T10:00:00.000Z",
        trial_iteration: null,
        trial_label: "",
        status_label: "Codex is working"
      },
      transcript: [
        { id: "tr1", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Checking the selected trial boundary.", created_at: "2026-06-17T10:00:02.000Z" }
      ]
    });
  `);
  const html = app.run("__progressDetailsProbe()");
  assert.equal(html.includes("Current run activity"), true, "running chat sessions should still show current run activity");
  assert.equal(html.includes("Pause after current turn"), false, "running chat sessions should not show autoresearch loop pause");
  assert.equal(html.includes("data-pause-autoresearch"), false, "chat runs do not have an autoresearch next turn to pause");
  assert.equal(html.includes("Stop current run"), true, "running chat sessions should expose a current-run stop control");
  assert.equal(html.includes("data-stop-current-run"), true, "current-run stop must terminate the active process");
  assert.equal(html.includes("Current run"), true, "chat run summary should identify the scope without showing a trial");
  assert.equal(html.includes("Update: Checking the selected trial boundary."), true, "chat run summary should expose the latest update");
}

function testWorkingDurationFormatter() {
  const app = loadAppContext();
  assert.equal(app.run("__formatWorkedDuration(45)"), "45s");
  assert.equal(app.run("__formatWorkedDuration(192)"), "3m 12s");
  assert.equal(app.run("__formatWorkedDuration(7440)"), "2h 4m");
  assert.equal(app.run("__formatWorkedDuration(108120)"), "1d 6h 2m");
  assert.equal(app.run("__formatWorkedDuration(93784)"), "1d 2h 3m 4s");
}

function testTrialStripScrollRestoresAcrossRender() {
  const app = loadAppContext();
  assert.equal(app.run("__trialStripScrollProbe(420)"), 420, "trial strip scroll should restore after DOM rerender");
  assert.equal(app.run("__trialStripScrollProbe(2400)"), 900, "trial strip scroll restore should clamp to the maximum scrollable offset");
}

function testStatusCardShowsReviewCheckpoint() {
  const app = loadAppContext();
  const html = app.run(`__statusCardProbe({
    kind: "status_card",
    session_id: "sid",
    run_status: "completed",
    goal_loop: "paused",
    loop_iteration: 37,
    loop_review_checkpoint_iteration: 100,
    review_checkpoint_interval: 100,
    trials_reported: 4,
    gate: "continue",
    stop_reason: "review_checkpoint_reached",
    settings: { review_checkpoint_interval: 100 },
    process: { active: false },
    events: { raw_logs: 12, transcript: 5 },
    limits: [],
    limitations: []
  })`);
  assert.equal(html.includes("Iteration"), true, "status card should label current loop iteration");
  assert.equal(html.includes(">37<"), true, "status card should show current loop iteration");
  assert.equal(html.includes("Next review"), true, "status card should label next human review checkpoint");
  assert.equal(html.includes(">100<"), true, "status card should show next human review checkpoint");
  assert.equal(html.includes("Review checkpoint reached"), true, "status card should humanize checkpoint stop reason");
  assert.equal(html.includes("Review checkpoint"), true, "Codex settings should show checkpoint interval");
}

function testComposerPlaceholderBecomesGeneralAfterLaunch() {
  const app = loadAppContext();
  app.run(`
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "framing",
      started_at: "2026-06-17T10:00:00.000Z",
      transcript: []
    });
  `);
  const framingPlaceholder = app.run("coldComposerPlaceholder(true)");
  assert.equal(framingPlaceholder.includes("PROJECT.md"), true, "prelaunch framing placeholder should mention PROJECT.md");
  app.run(`
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 1,
      started_at: "2026-06-17T10:00:00.000Z",
      transcript: []
    });
  `);
  const launchedPlaceholder = app.run("coldComposerPlaceholder(true)");
  assert.equal(launchedPlaceholder.includes("PROJECT.md"), false, "launched placeholder should not be limited to PROJECT.md edits");
  assert.equal(launchedPlaceholder.includes("current research"), true, "launched placeholder should describe general research-session chat");
}

function testSettingsRenderPreservesComposerDraft() {
  const app = loadAppContext();
  app.run(`
    appState.cold_start_files = [{ path: "resources/user_input/INITIAL_BRIEF.md", text: "" }];
    activeColdPath = "resources/user_input/INITIAL_BRIEF.md";
    __setMessages([{ id: "u1", role: "user", kind: "text", text: "previous message", created_at: "2026-06-17T10:00:00.000Z" }]);
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 1,
      started_at: "2026-06-17T10:00:00.000Z",
      transcript: []
    });
  `);
  app.coldEditor.value = "Do not wipe this draft when reasoning changes.";
  app.run("renderColdStartEditor()");
  assert.equal(
    app.coldEditor.value,
    "Do not wipe this draft when reasoning changes.",
    "rendering settings/chat state must not clear an unsent composer draft"
  );
}

function testThemeModePersistsAndApplies() {
  const app = loadAppContext();
  let theme = app.run('__themeState()');
  assert.equal(theme.mode, "graphite-aurora");
  assert.equal(theme.dataset, "graphite-aurora");
  app.run('applyThemeMode("unsupported")');
  theme = app.run('__themeState()');
  assert.equal(theme.mode, "graphite-aurora", "unsupported theme modes should normalize to Graphite Aurora");
  assert.equal(theme.dataset, "graphite-aurora", "unsupported theme modes should leave the document on Graphite Aurora");
  assert.equal(theme.stored, "graphite-aurora", "unsupported theme modes should persist as Graphite Aurora");
  app.run('applyThemeMode("light")');
  theme = app.run('__themeState()');
  assert.equal(theme.dataset, "graphite-aurora", "legacy Light selection should map to Graphite Aurora");
  assert.equal(theme.stored, "graphite-aurora", "legacy Light selection should persist as Graphite Aurora");
  app.run('applyThemeMode("dark-glass")');
  theme = app.run('__themeState()');
  assert.equal(theme.dataset, "dark-glass");
  assert.equal(theme.stored, "dark-glass");
}

function testComposerPromptInsertionIsIdempotent() {
  const app = loadAppContext();
  app.coldEditor.value = "";
  app.run('insertComposerPrompt("/goal")');
  assert.equal(app.coldEditor.value, "/goal", "empty composer should receive the selected prompt");
  app.run('insertComposerPrompt("/goal")');
  assert.equal(app.coldEditor.value, "/goal", "clicking the same prompt twice should not duplicate it");

  app.coldEditor.value = "Please explain this run";
  app.run('insertComposerPrompt("/goal")');
  assert.equal(app.coldEditor.value, "Please explain this run\n/goal", "prompt should append once after existing user text");
  app.run('insertComposerPrompt("/goal")');
  assert.equal(app.coldEditor.value, "Please explain this run\n/goal", "existing user text plus prompt should remain idempotent");

  app.coldEditor.value = "/goal";
  app.run('insertComposerPrompt("/status")');
  assert.equal(app.coldEditor.value, "/status", "a lone command should be replaced by the newly selected command");

  app.coldEditor.value = "Please explain this run\n/goal";
  app.run('insertComposerPrompt("/status")');
  assert.equal(app.coldEditor.value, "Please explain this run\n/status", "the trailing command line should be replaced while preserving user text");

  app.run(`
    __setResumeTrialContext({
      id: "000001_uploaded_manuscript_baseline_audit",
      path: "research_trajectory/trials/000001_uploaded_manuscript_baseline_audit",
      iteration: 1,
      name: "000001_uploaded_manuscript_baseline_audit",
      reportPath: "research_trajectory/trials/000001_uploaded_manuscript_baseline_audit/REPORT.md",
      checkpointExists: true
    });
  `);
  app.coldEditor.value = "";
  app.run('insertComposerPrompt("/goal restart")');
  assert.equal(app.coldEditor.value, "/goal restart", "restart prompt should insert the selected command once");
  app.run('insertComposerPrompt("/goal restart")');
  assert.equal(app.coldEditor.value, "/goal restart", "restart prompt should not duplicate");
  app.run('insertComposerPrompt("/goal resume")');
  assert.equal(app.coldEditor.value, "/goal resume", "command prompt should replace an existing slash command");
  assert.equal(app.context.__resumeTrialContext().id, "000001_uploaded_manuscript_baseline_audit", "command prompt should not discard staged continue-from-trial context");
}

async function testCopyTextHelperWritesClipboard() {
  const app = loadAppContext();
  await app.run('__copyTextProbe("copy me")');
  assert.equal(app.clipboardWrites.at(-1), "copy me", "copy helper should write the requested text to the clipboard");
  assert.equal(app.context.__toastMessages.at(-1).message, "Probe copied.");
}

function testManuscriptPanelRendersPaperFiguresTablesAndTraceability() {
  const app = loadAppContext();
  const payload = {
    core_story: "A manuscript story.",
    claims: [],
    sections: [{
      title: "Section 2: Calibration result",
      body: [
        "Purpose: Explain the calibrated result.",
        "Section thesis: Calibration changes the observed outcome in the accepted evidence.",
        "Reader question answered: What result should the reader take away?",
        "Narrative role in target venue: Results-like argument.",
        "Accepted claims: C1.",
        "Evidence: E1.",
        "Figures / tables: Figure 1 active.",
        "Paragraph plan:",
        "",
        "| Para | Rhetorical move | Content to cover, not full prose | Claims / evidence | Results / artifacts | Figures / tables | Citation posture | Required qualification | Transition job |",
        "|---|---|---|---|---|---|---|---|---|",
        "| P1 | State result | Put the calibration result beside Figure 1. | C1 / E1 | `research_trajectory/CURRENT_FINDINGS.md` | Figure 1 | cite source trial | none | sets up interpretation |"
      ].join("\n")
    }],
    figure_plans: [{
      title: "Figure F000001: Calibration Map",
      body: [
        "Status: active",
        "Caption: Calibration map caption.",
        "Source artifact path: `manuscript/figures/calibration_map.pdf`"
      ].join("\n")
    }],
    table_plans: [],
    no_table_rationale: "No active tables are present because the current evidence is figure-led.",
    traceability: "Claim C1 maps to calibration evidence E1.",
    missing_evidence: [],
    figure_specs: [{
          title: "Figure F000001: Calibration Map",
          body: [
            "Status:",
            "generated / needs source-level review",
            "Figure type:",
            "conceptual diagram / taxonomy",
            "Purpose:",
            "Show that calibrated perceived safety is an action standard.",
            "Show that calibrated perceived safety is an action standard.",
            "Caption from revised source:",
            "Calibrated perceived safety is an action standard, not a comfort score.",
            "Existing source files:",
            "`manuscript/figures/calibration_map.pdf`",
            "Evidence / conceptual basis:",
            "- Source trial: Trial 000001."
          ].join("\n")
    }]
  };
  const html = app.run(`__renderManuscriptPanelProbe(${JSON.stringify(payload)})`);
  assert.equal(html.includes("Writing blueprint"), true);
  assert.equal(html.includes("Figures"), true);
  assert.equal(html.includes("Tables"), true);
  assert.equal(html.includes("Traceability"), true);
  assert.equal(html.includes("Section 2: Calibration result"), true);
  assert.equal(html.includes("Section thesis"), true);
  assert.equal(html.includes("Reader question"), true);
  assert.equal(html.includes("Narrative role"), true);
  assert.equal(html.includes("Paragraph plan"), true);
  assert.equal(html.includes("Rhetorical move"), true);
  assert.equal(html.includes("Put the calibration result beside Figure 1."), true);
  assert.equal(html.includes("Figure specs at this location"), true);
  assert.equal(html.indexOf("Section 2: Calibration result") < html.indexOf("Inline figure spec"), true, "figure spec should render beside the relevant paper section");
  assert.equal(html.includes("figure-spec-card"), true);
  assert.equal(html.includes("Figure F000001: Calibration Map"), true);
  assert.equal(html.includes("generated / needs source-level review"), true);
  assert.equal(html.includes("Show that calibrated perceived safety is an action standard."), true);
  assert.equal(html.includes("Calibrated perceived safety is an action standard"), true);
  assert.equal(html.includes("Copy spec"), true);
  assert.equal(html.includes("Copy caption"), true);
  assert.equal(html.includes("Open source"), true);
  assert.equal(html.includes("manuscript/figures/calibration_map.pdf"), true);
  assert.equal(html.includes("No active tables"), true);
  assert.equal(html.includes("No active tables are present because the current evidence is figure-led."), true);
  assert.equal(html.includes("Claim C1 maps to calibration evidence E1."), true);
  assert.equal(html.includes("Figure descriptions"), false);
}

testButtonInventoryHasHandlers();
await testImmediateUserMessage();
await testAttachmentOnlyMessage();
await testResumeFromTrialRequiresConfirmationAndSendsPayload();
await testResumeFromTrialCancelPreservesComposer();
await testResumeTrialSlashCommandIsBlocked();
await testFailedSessionSendRestoresComposerState();
await testSlashCommandVisibleAndIgnoredAsUnanswered();
await testRestartCommandRequiresConfirmationAndSendsRestartEndpoint();
await testRestartCancelPreservesComposer();
testStaleOverviewDoesNotSwallowPendingUser();
testTranscriptRecoveryUsesOnlyFinalAssistant();
await testEditTruncatesLaterConversationBeforeResend();
await testLaunchGoalMessageBeforeBackendWork();
testSessionTimelineDoesNotRenderCurrentActivityCard();
testPassedGoalDoesNotShowStaleRunningTrial();
testCurrentRunActivityShowsPauseForChatRun();
testWorkingDurationFormatter();
testTrialStripScrollRestoresAcrossRender();
testStatusCardShowsReviewCheckpoint();
testComposerPlaceholderBecomesGeneralAfterLaunch();
testSettingsRenderPreservesComposerDraft();
testThemeModePersistsAndApplies();
testComposerPromptInsertionIsIdempotent();
await testCopyTextHelperWritesClipboard();
testManuscriptPanelRendersPaperFiguresTablesAndTraceability();

console.log("UI flow test passed.");
