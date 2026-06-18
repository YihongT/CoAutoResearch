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
  const launchDialog = element({
    close() { this.closed = true; },
    showModal() { this.open = true; },
  });
  [
    ["#cold-file-editor", coldEditor],
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
    navigator: { clipboard: { writeText: async () => {} } },
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
      globalThis.__apiCalls = [];
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
    globalThis.__statusCardProbe = (payload) => statusCardHtml(payload, { id: "status-test" });
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
  };
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
    appState.trials = [
      {
        id: "000001_source_evidence_audit",
        status: "running",
        report_path: "research_trajectory/trials/000001_source_evidence_audit/REPORT.md",
        report_summary: "Checked the source evidence."
      }
    ];
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "running",
      mode: "goal",
      loop_active: true,
      loop_iteration: 1,
      started_at: "2026-06-17T10:00:00.000Z",
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
  assert.equal(html.includes("Trial 1 is running"), true, "running trials should have a visible live status row");
  assert.equal(html.includes("Live trial activity"), true, "running trial event details should be folded under the live status row");
  assert.equal(html.includes("Trial activity"), true, "live Codex events should stay inside the selected trial activity fold");
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

function testThemeModePersistsAndApplies() {
  const app = loadAppContext();
  let theme = app.run('__themeState()');
  assert.equal(theme.mode, "light");
  assert.equal(theme.dataset, "light");
  app.run('applyThemeMode("night")');
  theme = app.run('__themeState()');
  assert.equal(theme.mode, "night", "theme mode should update client state");
  assert.equal(theme.dataset, "night", "theme mode should update the document theme attribute");
  assert.equal(theme.stored, "night", "theme mode should persist in localStorage");
  app.run('applyThemeMode("light")');
  theme = app.run('__themeState()');
  assert.equal(theme.dataset, "light");
  assert.equal(theme.stored, "light");
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
}

function testManuscriptPanelRendersFigureDescriptions() {
  const app = loadAppContext();
  app.run(`
    appState.summaries = {
      manuscript: {
        core_story: "A manuscript story.",
        claims: [],
        section_blueprint: [],
        figures: [],
        missing_evidence: [],
        figure_specs: [{
          title: "Figure F000001: Calibration Map",
          body: [
            "Status:",
            "",
            "generated / needs source-level review",
            "",
            "Figure type:",
            "",
            "conceptual diagram / taxonomy",
            "",
            "Purpose:",
            "",
            "Show that calibrated perceived safety is an action standard.",
            "",
            "Caption draft:",
            "",
            "Calibrated perceived safety is an action standard, not a comfort score.",
            "",
            "Evidence / conceptual basis:",
            "",
            "- Source trial: Trial 000001."
          ].join("\\n")
        }]
      }
    };
  `);
  const html = app.run("renderManuscriptPanel()");
  assert.equal(html.includes("Figure descriptions"), true);
  assert.equal(html.includes("figure-spec-card"), true);
  assert.equal(html.includes("Figure F000001: Calibration Map"), true);
  assert.equal(html.includes("generated / needs source-level review"), true);
  assert.equal(html.includes("Show that calibrated perceived safety is an action standard."), true);
  assert.equal(html.includes("Calibrated perceived safety is an action standard"), true);
}

await testImmediateUserMessage();
await testAttachmentOnlyMessage();
await testSlashCommandVisibleAndIgnoredAsUnanswered();
testStaleOverviewDoesNotSwallowPendingUser();
testTranscriptRecoveryUsesOnlyFinalAssistant();
await testEditTruncatesLaterConversationBeforeResend();
await testLaunchGoalMessageBeforeBackendWork();
testSessionTimelineDoesNotRenderCurrentActivityCard();
testPassedGoalDoesNotShowStaleRunningTrial();
testStatusCardShowsReviewCheckpoint();
testThemeModePersistsAndApplies();
testComposerPromptInsertionIsIdempotent();
testManuscriptPanelRendersFigureDescriptions();

console.log("UI flow test passed.");
