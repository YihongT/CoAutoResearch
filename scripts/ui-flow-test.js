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
  const element = (extra = {}) => {
    const classes = new Set(extra.classNames || []);
    return {
      value: "",
      hidden: false,
      innerHTML: "",
      textContent: "",
      dataset: {},
      style: {
        setProperty(name, value) { this[name] = String(value); },
        removeProperty(name) { delete this[name]; },
      },
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)); },
        remove(...names) { names.forEach((name) => classes.delete(name)); },
        toggle(name, force) {
          const enabled = force === undefined ? !classes.has(name) : Boolean(force);
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
        contains(name) { return classes.has(name); },
        toString() { return Array.from(classes).join(" "); },
      },
      addEventListener() {},
      dispatchEvent() {},
      appendChild() {},
      insertAdjacentElement() {},
      remove() {},
      select() {},
      focus() {},
      setAttribute(name, value) { this[name] = String(value); },
      removeAttribute(name) { delete this[name]; },
      setSelectionRange() {},
      toggleAttribute(name, force) { this[name] = Boolean(force); },
      closest() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      ...extra,
    };
  };
  const coldEditor = element({
    __compactComposer: true,
    rows: 2,
    scrollHeight: 44,
    closest(selector) {
      return selector === ".brief-composer-row" && this.__compactComposer ? {} : null;
    },
  });
  const projectEditor = element({ value: "# Project\n\nReady." });
  const composerFileInput = element({
    clickCount: 0,
    click() {
      this.clickCount += 1;
    },
  });
  const trialStripScroll = element({
    clientWidth: 300,
    scrollWidth: 1200,
    scrollLeft: 0,
  });
  const mainStage = element({
    clientHeight: 900,
    scrollHeight: 2400,
    scrollTop: 0,
    scrollTo(options) {
      this.scrollTop = Number(options?.top || 0);
    },
  });
  const chatView = element({ classNames: ["workspace-view", "chat-view", "is-active"] });
  const materialView = element({ classNames: ["workspace-view", "material-view"] });
  const contextContent = element({
    querySelectorAll() {
      return [];
    },
  });
  const railActions = ["chat", "workspace", "resources", "trials", "reviews", "manuscript"].map((view) =>
    element({ dataset: { view }, classNames: ["rail-action"] })
  );
  const launchDialog = element({
    close() { this.closed = true; },
    showModal() { this.open = true; },
  });
  const projectDialog = element({
    close() { this.closed = true; },
    showModal() { this.open = true; },
  });
  const restartDialog = element({
    close() { this.closed = true; },
    showModal() { this.open = true; },
  });
  const largeImportDialog = element({
    close() { this.closed = true; this.open = false; },
    showModal() { this.open = true; },
  });
  const exportConfirmDialog = element({
    close() { this.closed = true; this.open = false; },
    showModal() { this.open = true; this.closed = false; },
  });
  const fileViewerDialog = element({
    _rect: { width: 900, height: 680 },
    close() { this.closed = true; this.open = false; },
    showModal() { this.open = true; },
    getBoundingClientRect() {
      return {
        width: Number.parseFloat(this.style.width) || this._rect.width,
        height: Number.parseFloat(this.style.height) || this._rect.height,
      };
    },
  });
  const fileViewerBody = element();
  const field = (value = "", extra = {}) => element({ value, ...extra });
  const sessionForm = element({
    elements: {
      backend: field("codex"),
      model: field("gpt-5.5"),
      reasoningEffort: field("medium"),
      permissionPreset: field("default"),
      webSearch: field("", { checked: true }),
      extraConfig: field(""),
      reviewCheckpointInterval: field("100"),
    },
  });
  const settingsForm = element({
    elements: {
      themeMode: field("graphite-aurora"),
      settingsBackend: field("codex"),
      settingsModel: field("gpt-5.5"),
      settingsReasoningEffort: field("medium"),
      settingsPermissionPreset: field("default"),
      settingsWebSearch: field("", { checked: true }),
      settingsExtraConfig: field(""),
      settingsReviewCheckpointInterval: field("100"),
    },
    querySelector() {
      return element();
    },
  });
  const projectCreateSubmit = element();
  const projectCreateForm = element({
    elements: {
      projectName: field(""),
      agentBackend: field("codex"),
    },
    reset() {
      this.elements.projectName.value = "";
      this.elements.agentBackend.value = "codex";
    },
    querySelector(selector) {
      return selector === 'button[type="submit"]' ? projectCreateSubmit : null;
    },
  });
  const composerModel = sessionForm.elements.model;
  const composerReasoning = sessionForm.elements.reasoningEffort;
  [
    ["#cold-file-editor", coldEditor],
    ["#launch-files", element()],
    ["#cold-file-tabs", element()],
    ["#cold-editor-title", element()],
    ["#cold-editor-path", element()],
    ["#cold-save-status", element()],
    ["#cold-file-preview", element()],
    ["#cold-editor-workbench", element()],
    [".main-stage", mainStage],
    ["#chat-view", chatView],
    ["#material-view", materialView],
    ["#material-title", element()],
    ["#context-content", contextContent],
    ["#brief-attachment-tray", element()],
    ["#chat-attachment-tray", element()],
    ["#composer-file-input", composerFileInput],
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
    ["#launch-autoresearch", element()],
    ["#launch-agent-status", element()],
    ["#launch-instruction", element()],
    ["#project-dialog", projectDialog],
    ["#project-create-form", projectCreateForm],
    ["#project-name", projectCreateForm.elements.projectName],
    ["#project-agent-backend", projectCreateForm.elements.agentBackend],
    ["#project-agent-backend-note", element()],
    ["#project-create-note", element()],
    ["#restart-autoresearch-dialog", restartDialog],
    ["#restart-autoresearch-reason", element()],
    ["#large-resource-import-dialog", largeImportDialog],
    ["#large-import-title", element()],
    ["#large-import-file-name", element()],
    ["#large-import-file-size", element()],
    ["#large-import-category", element()],
    ["#large-import-destination", element()],
    ["#large-import-note", element()],
    ["#export-confirm-dialog", exportConfirmDialog],
    ["#export-confirm-title", element()],
    ["#export-confirm-summary", element()],
    ["#file-viewer-dialog", fileViewerDialog],
    ["#file-viewer-body", fileViewerBody],
    ["#file-viewer-title", element()],
    ["#chat-thread", element()],
    ["#session-settings-form", sessionForm],
    ["#settings-form", settingsForm],
    ["#composer-model", composerModel],
    ["#composer-reasoning", composerReasoning],
    ["#settings-summary", element()],
    ["#session-settings", element()],
    ["#settings-secret-grid", element()],
    ["#settings-agent-status", element()],
  ].forEach(([selector, value]) => elements.set(selector, value));

  const context = {
    console,
    URL,
    URLSearchParams,
    FormData: class FormData {
      constructor(form) {
        this.form = form;
      }
      get(name) {
        const field = this.form?.elements?.[name];
        if (field) {
          if ("checked" in field && !field.value) return field.checked ? "on" : "";
          return field.value || "";
        }
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
      location: { search: "?project=p1", origin: "http://localhost" },
      origin: "http://localhost",
      innerWidth: 1400,
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
      querySelectorAll(selector) {
        if (selector === ".rail-action") return railActions;
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
    globalThis.__browserOpenCount = 0;
    globalThis.__browserOpenCategory = "";
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
    globalThis.__renderStageImpl = renderStage;
    scheduleOverviewPoll = () => {};
    renderChatState = () => {};
    renderSession = () => {};
    renderResumeCommandBar = () => {};
    renderComposerSuggestions = () => {};
    renderSelectedResources = () => renderAttachmentTrays();
    saveResourceSelections = () => {};
    globalThis.__resizeColdEditorImpl = resizeColdEditor;
    updateBriefDockGeometry = () => {};
    resizeColdEditor = () => {};
    renderColdPreview = () => {};
    resizeComposer = () => {};
    scrollFramingToBottomSoon = () => { globalThis.__scrollCount += 1; };
    scrollThread = () => { globalThis.__scrollCount += 1; };
    notifyResourceHandlingFromResponse = () => {};
    showResourceBrowser = () => {
      globalThis.__browserOpenCount += 1;
      globalThis.__browserOpenCategory = activeResourceCategory;
    };
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
      if (globalThis.__apiHandler) return globalThis.__apiHandler(endpoint, body, options);
      if (endpoint === "/api/resource-import/start") {
        return {
          ok: true,
          import_id: "import_1",
          chunk_size: 1000000000,
          destination: "resources/" + (body.category || "ongoing_work") + "/" + (body.name || "file.bin"),
          category: body.category || "ongoing_work",
        };
      }
      if (endpoint === "/api/resource-import/finish") {
        return {
          ok: true,
          resource: {
            path: "resources/ongoing_work/perceived_safety.zip",
            category: "ongoing_work",
            alreadyImported: true,
          },
        };
      }
      if (endpoint === "/api/resource-import/cancel") {
        return { ok: true, cancelled: true };
      }
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
    apiBinary = async (endpoint, body) => {
      const offset = Number(new URL(endpoint, "http://local").searchParams.get("offset") || 0);
      const length = body?.byteLength || body?.length || 0;
      const received = Math.min(globalThis.__activeImportSize || offset + length, offset + 1000000000);
      globalThis.__apiCalls.push({ endpoint, binaryBytes: length });
      return { ok: true, received, size: globalThis.__activeImportSize || received, progress: 1 };
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
    globalThis.__targetVenueState = () => ({
      value: document.querySelector("#target-venue")?.value || "",
      scoped: localStorage.getItem(scopedStorageKey("autoResearchTargetVenue")),
      legacy: localStorage.getItem("autoResearchTargetVenue"),
      projectId: activeProjectId,
    });
    globalThis.__sessionSettingsState = () => {
      const form = document.querySelector("#session-settings-form");
      return {
        projectId: activeProjectId,
        formBackend: form?.elements?.backend?.value || "",
        composerModel: document.querySelector("#composer-model")?.value || "",
        composerReasoning: document.querySelector("#composer-reasoning")?.value || "",
        formModel: form?.elements?.model?.value || "",
        formReasoning: form?.elements?.reasoningEffort?.value || "",
        formPermission: form?.elements?.permissionPreset?.value || "",
        formWebSearch: Boolean(form?.elements?.webSearch?.checked),
        formReviewInterval: form?.elements?.reviewCheckpointInterval?.value || "",
        summary: document.querySelector("#settings-summary")?.textContent || "",
        stored: localStorage.getItem(scopedStorageKey("autoResearchSessionSettings")),
        legacy: localStorage.getItem("autoResearchSessionSettings"),
      };
    };
    globalThis.__agentStatusState = () => ({
      settingsNote: document.querySelector("#settings-agent-status")?.textContent || "",
      settingsTone: document.querySelector("#settings-agent-status")?.dataset?.tone || "",
      launchNote: document.querySelector("#launch-agent-status")?.textContent || "",
      launchTone: document.querySelector("#launch-agent-status")?.dataset?.tone || "",
      projectNote: document.querySelector("#project-agent-backend-note")?.textContent || "",
      projectTone: document.querySelector("#project-agent-backend-note")?.dataset?.tone || "",
      launchDisabled: Boolean(document.querySelector("#launch-autoresearch")?.disabled),
      launchTitle: document.querySelector("#launch-autoresearch")?.title || "",
      createBackend: document.querySelector("#project-agent-backend")?.value || "",
    });
    globalThis.__composerDraftState = () => ({
      projectId: activeProjectId,
      value: document.querySelector("#cold-file-editor")?.value || "",
      composerDraft,
      stored: localStorage.getItem(scopedStorageKey("autoResearchComposerDraft")),
      legacy: localStorage.getItem("autoResearchComposerDraft"),
    });
    globalThis.__setProjectId = (projectId) => {
      activeProjectId = projectId;
      resetProjectClientState();
      appState = { ...appState, active_project_id: projectId, project: { id: projectId, display_name: projectId } };
    };
    globalThis.__hydrateTargetVenue = (payload = {}, options = {}) => {
      appState = { ...appState, ...payload };
      hydrateTargetVenueField(options);
      return globalThis.__targetVenueState();
    };
    globalThis.__filePickerState = () => {
      const input = document.querySelector("#composer-file-input");
      return {
        activeCategory: activeResourceCategory,
        pendingCategory: input?.dataset?.resourceCategory || "",
        clicks: input?.clickCount || 0,
      };
    };
    globalThis.__chooseMaterialTypeProbe = (category) => {
      chooseMaterialType(category);
      return {
        ...globalThis.__filePickerState(),
        browserOpenCount: globalThis.__browserOpenCount,
        browserOpenCategory: globalThis.__browserOpenCategory,
      };
    };
    globalThis.__openFilePickerProbe = (category) => {
      openComposerFilePicker(category);
      return globalThis.__filePickerState();
    };
    globalThis.__addUploadProbe = (file, options = {}) => {
      const before = selectedUploadItems.length;
      addUploadFile(file, options);
      return {
        before,
        after: selectedUploadItems.length,
        uploads: selectedUploadItems.map((item) => ({ name: item.name, size: item.size, category: item.category })),
        imports: pendingResourceImports.map((item) => ({ name: item.name, size: item.size, category: item.category, status: item.status, path: item.destination || "" })),
        trayExists: Boolean(document.querySelector("#brief-attachment-tray")),
        briefTray: document.querySelector("#brief-attachment-tray")?.innerHTML || "",
        briefTrayHidden: Boolean(document.querySelector("#brief-attachment-tray")?.hidden),
        toasts: globalThis.__toastMessages,
      };
    };
    globalThis.__addFilesProbe = (files, source = "drop", options = {}) => {
      const before = selectedUploadItems.length;
      const accepted = addFilesFromList(files, source, options);
      return {
        accepted,
        before,
        after: selectedUploadItems.length,
        uploads: selectedUploadItems.map((item) => ({ name: item.name, size: item.size, category: item.category })),
        imports: pendingResourceImports.map((item) => ({ name: item.name, size: item.size, category: item.category, status: item.status, path: item.destination || "" })),
        briefTray: document.querySelector("#brief-attachment-tray")?.innerHTML || "",
        briefTrayHidden: Boolean(document.querySelector("#brief-attachment-tray")?.hidden),
        toasts: globalThis.__toastMessages,
      };
    };
    globalThis.__pendingResourceImportState = () => ({
      imports: pendingResourceImports.map((item) => ({ name: item.name, status: item.status, path: item.destination || "", category: item.category, error: item.error || "" })),
      resources: selectedResourceItems.map((item) => ({ path: item.path, category: item.category, alreadyImported: Boolean(item.alreadyImported) })),
      blocked: hasBlockingResourceImports(),
      tray: document.querySelector("#brief-attachment-tray")?.innerHTML || "",
    });
    globalThis.__confirmFirstResourceImport = async () => {
      const record = pendingResourceImports[0];
      if (!record) return globalThis.__pendingResourceImportState();
      globalThis.__activeImportSize = record.size;
      record.file.slice = () => ({ arrayBuffer: async () => new ArrayBuffer(1) });
      await confirmLargeResourceImport(record.id, record.category);
      return globalThis.__pendingResourceImportState();
    };
    globalThis.__resizeColdEditorProbe = ({ value = "", scrollHeight = 44, compact = true } = {}) => {
      const editor = document.querySelector("#cold-file-editor");
      editor.value = value;
      editor.scrollHeight = scrollHeight;
      editor.__compactComposer = compact;
      editor.style.height = "";
      editor.style.overflowY = "";
      editor.classList.remove("is-compact-single-line");
      globalThis.__resizeColdEditorImpl();
      return {
        height: editor.style.height,
        overflowY: editor.style.overflowY,
        rows: editor.rows,
        singleLine: editor.classList.contains("is-compact-single-line"),
      };
    };
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
    globalThis.__progressSummaryProbe = () => {
      const entries = currentProgressEntries();
      const entry = latestTrialProgressEntry(entries);
      return entry ? framingProgressTitle(entry) + ": " + framingProgressContent(entry) : "Waiting for Codex events...";
    };
    globalThis.__formatWorkedDuration = (seconds) => formatWorkedDuration(seconds);
    globalThis.__statusCardProbe = (payload) => statusCardHtml(payload, { id: "status-test" });
    globalThis.__renderProjectListProbe = (payload) => {
      appState = {
        ...(appState || {}),
        multi_project: true,
        active_project_id: payload.active_project_id || "project-1",
        projects: payload.projects || [],
      };
      activeProjectId = appState.active_project_id;
      openProjectMenuId = payload.open_project_menu || "";
      renderProjectList();
      return document.querySelector("#project-list")?.innerHTML || "";
    };
    globalThis.__trialStripScrollProbe = (scrollLeft, clientWidth = 300, scrollWidth = 1200) => {
      const strip = document.querySelector(".trial-strip-scroll");
      strip.clientWidth = clientWidth;
      strip.scrollWidth = scrollWidth;
      strip.scrollLeft = scrollLeft;
      rememberTrialStripScroll(strip, { manual: true });
      strip.scrollLeft = 0;
      restoreTrialStripScroll();
      return strip.scrollLeft;
    };
    globalThis.__trialStripAutoProbe = () => {
      const strip = document.querySelector(".trial-strip-scroll");
      strip.clientWidth = 300;
      strip.scrollWidth = 1200;
      strip.scrollLeft = 0;
      strip.getBoundingClientRect = () => ({ left: 0, right: 300 });
      const chip = {
        offsetWidth: 80,
        getBoundingClientRect: () => ({ left: 900 - strip.scrollLeft, right: 980 - strip.scrollLeft }),
      };
      strip.querySelector = (selector) => selector === ".trial-chip.is-running" ? chip : null;
      trialStripScrollState = { mode: "auto", left: 0, liveIteration: 0, selectedIteration: 0, touchedAt: 0 };
      __setSession({
        id: "s1",
        session_id: "sid",
        status: "running",
        mode: "goal",
        loop_active: true,
        gate: { status: "continue" },
        active_run: {
          running: true,
          mode: "goal",
          trial_iteration: 12,
          status_label: "Codex is working on Trial 12"
        },
        transcript: []
      });
      restoreTrialStripScroll();
      const first = strip.scrollLeft;
      strip.scrollLeft = 0;
      restoreTrialStripScroll();
      return { first, second: strip.scrollLeft, state: { ...trialStripScrollState } };
    };
    globalThis.__liveTrialStatusProbe = (session) => {
      __setSession(session);
      appState.trials = [];
      return activeTrialHistoryHtml();
    };
    globalThis.__renderManuscriptPanelProbe = (payload) => {
      appState.summaries = { ...(appState.summaries || {}), manuscript: payload };
      return renderManuscriptPanel();
    };
    globalThis.__renderReviewsPanelProbe = (reviews) => {
      appState.reviews = reviews;
      return renderReviewsPanel();
    };
    globalThis.__renderExportPanelProbe = (job = null) => {
      activeExportJob = job;
      return renderExportPanel();
    };
    globalThis.__beginExportFlowProbe = async (kind, estimate, startJob = null) => {
      globalThis.__apiHandler = async (endpoint, body) => {
        if (endpoint.startsWith("/api/export/estimate")) return { ok: true, ...estimate };
        if (endpoint === "/api/export/start") return { ok: true, export: startJob || { id: "ex1", kind: body.kind, label: "Blueprint Pack", status: "packaging", phase: "packaging", total_bytes: estimate.total_bytes || 0, bytes_done: 0, file_count: estimate.file_count || 0, files_done: 0 } };
        if (endpoint.startsWith("/api/export/status")) return { ok: true, export: startJob || { id: "ex1", kind, label: "Blueprint Pack", status: "ready", phase: "ready", total_bytes: estimate.total_bytes || 0, bytes_done: estimate.total_bytes || 0, file_count: estimate.file_count || 0, files_done: estimate.file_count || 0, download_url: "/api/export/download?id=ex1" } };
        return { ok: true };
      };
      await beginExportFlow(kind);
      clearTimeout(exportPollTimer);
      exportPollTimer = null;
      const dialog = document.querySelector("#export-confirm-dialog");
      return {
        calls: globalThis.__apiCalls,
        dialogOpen: Boolean(dialog?.open),
        dialogSummary: document.querySelector("#export-confirm-summary")?.innerHTML || "",
        activeExportJob,
        panel: renderExportPanel(),
      };
    };
    globalThis.__blueprintInspectorProbe = (payload, manuscript, reviews = [], session = null) => {
      appState.summaries = { ...(appState.summaries || {}), manuscript };
      appState.reviews = reviews;
      if (session) appState.research_session = session;
      inlineFilePayloads[payload.path] = payload;
      inlineFileModes[payload.path] = "rendered";
      return renderBlueprintInspector(payload);
    };
    globalThis.__inlineEditorProbe = (payload, compact = false) => inlineEditorHtml(payload, compact);
    globalThis.__fileViewerResizeProbe = (axis, dx, dy, startWidth = 900, startHeight = 680) => {
      const dialog = document.querySelector("#file-viewer-dialog");
      dialog._rect = { width: startWidth, height: startHeight };
      dialog.style.removeProperty("width");
      dialog.style.removeProperty("height");
      const handle = {
        dataset: { fileViewerResize: axis },
        captured: null,
        released: null,
        setPointerCapture(pointerId) { this.captured = pointerId; },
        releasePointerCapture(pointerId) { this.released = pointerId; },
      };
      const target = { closest(selector) { return selector === "[data-file-viewer-resize]" ? handle : null; } };
      const baseEvent = {
        target,
        pointerId: 42,
        clientX: 100,
        clientY: 120,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
      };
      startFileViewerResize(baseEvent);
      updateFileViewerResize({
        clientX: 100 + dx,
        clientY: 120 + dy,
        preventDefault() { this.prevented = true; },
      });
      const during = {
        width: dialog.style.width,
        height: dialog.style.height,
        axis: document.body.dataset.fileViewerResizeAxis || "",
      };
      finishFileViewerResize({ target });
      return {
        ...during,
        captured: handle.captured,
        released: handle.released,
        persisted: localStorage.getItem(FILE_VIEWER_SIZE_KEY),
        activeAxis: document.body.dataset.fileViewerResizeAxis || "",
        resizing: document.body.classList.contains("is-resizing-file-viewer"),
      };
    };
    globalThis.__treeHtmlProbe = (tree) => renderTree(tree);
    globalThis.__inlinePdfBodyProbe = (payload = {}) => inlineFileBodyHtml({
      path: "resources/papers/paper.pdf",
      kind: "pdf",
      mime: "application/pdf",
      url: "/api/file/raw?path=resources%2Fpapers%2Fpaper.pdf",
      ...payload,
    }, "preview");
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

async function testPrepareSubmitWithResumeContextSendsResumePayload() {
  const app = loadAppContext();
  app.coldEditor.value = "Collect a cross-company and cross-region results corpus.";
  app.run(`
    __setResumeTrialContext({
      id: "000012_final_blueprint_gate_repair",
      path: "research_trajectory/trials/000012_final_blueprint_gate_repair",
      iteration: 12,
      name: "000012_final_blueprint_gate_repair",
      reportPath: "research_trajectory/trials/000012_final_blueprint_gate_repair/REPORT.md",
      checkpointPath: "research_trajectory/checkpoints/000012_final_blueprint_gate_repair",
      checkpointExists: true
    });
  `);
  await app.run("coldStartFromPrepare()");
  assert.equal(app.context.__confirmCalls.length, 1, "prepare submit with a staged trial must confirm the fork");
  assert.equal(app.context.__confirmCalls[0].context.id, "000012_final_blueprint_gate_repair");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/resume-from-trial");
  assert.equal(app.context.__apiCalls[0].body.message, "Collect a cross-company and cross-region results corpus.");
  assert.equal(app.context.__apiCalls[0].body.resumeFromTrial.id, "000012_final_blueprint_gate_repair");
  const [message] = app.context.__messages();
  assert.equal(message.resumeFromTrial.id, "000012_final_blueprint_gate_repair", "visible user message should show the resume context");
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
  app.run('persistComposerDraft("Continue from here with a stricter pass.")');
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
  assert.equal(app.context.__composerDraftState().stored, "Continue from here with a stricter pass.", "backend failure must restore the project-scoped composer draft");
  assert.equal(app.context.__resumeTrialContext().id, "000003_evidence_audit", "backend failure must restore the staged trial chip");
  assertJsonEqual(app.context.__selectedResources(), [{ path: "/tmp/evidence.pdf", category: "literature" }], "backend failure must restore selected resources");
  assert.equal(app.context.__messages().length, 0, "backend failure must remove the optimistic user message");
}

async function testSuccessfulSessionSendClearsComposerDraft() {
  const app = loadAppContext();
  app.coldEditor.value = "Submit this draft.";
  app.run('persistComposerDraft("Submit this draft.")');
  await app.run('sendSessionComposerMessage("Submit this draft.")');
  const state = app.context.__composerDraftState();
  assert.equal(app.coldEditor.value, "", "successful sends should clear the visible composer");
  assert.equal(state.stored, null, "successful sends should clear the project-scoped composer draft");
  assert.equal(state.legacy, null, "composer drafts must not use the legacy global key");
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
  app.run('document.querySelector("#launch-instruction").value = "Prioritize source-level evidence before drafting."');
  app.run('persistComposerDraft("launch brief")');
  app.run("__installBlockingCollect()");
  const pending = app.run("launchAutoresearch()");
  assert.equal(app.launchDialog.closed, true, "launch dialog should close before uploads/API complete");
  assert.ok(app.context.__messages().some((message) => message.kind === "goal-launch"), "goal launch message should render immediately");
  const pendingState = app.context.__pendingState();
  assert.equal(pendingState.draft, true, "goal launch should show immediate pending feedback");
  assert.ok(pendingState.since > 0, "goal launch pending state should start a visible working timer");
  const optimisticSession = app.run("sessionState()");
  assert.equal(optimisticSession.status, "running", "goal launch should immediately expose a running session");
  assert.equal(optimisticSession.mode, "goal", "goal launch should immediately expose goal mode");
  assert.equal(optimisticSession.loop_iteration, 1, "goal launch should immediately show the first trial");
  assert.equal(optimisticSession.active_run.trial_iteration, 1, "goal launch should mark Trial 1 as the active run");
  assert.equal(app.run("__thinkingProbe()").includes("Starting autoresearch on Trial 1"), true, "pending UI should name the optimistic trial immediately");
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
  assert.equal(app.context.__apiCalls[0].body.launchInstruction, "Prioritize source-level evidence before drafting.");
  assert.equal(app.run("Boolean(optimisticResearchSession)"), false, "real backend session should replace optimistic launch state");
  assert.equal(app.coldEditor.value, "", "successful launch should clear the submitted composer draft");
  assert.equal(app.context.__composerDraftState().stored, null, "successful launch should clear the project-scoped composer draft");
}

function testStartAutoresearchOnlyAppearsOnProjectDraftCard() {
  const app = loadAppContext();
  app.run(`
    __setSession({ id: "s1", session_id: "sid", status: "completed", mode: "framing", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
    __setMessages([
      { id: "a1", role: "assistant", kind: "text", text: "Updated PROJECT.md and it is ready.", created_at: "2026-06-17T10:00:01.000Z" },
      { id: "p1", role: "assistant", kind: "project", text: "Project draft", artifact: { path: "PROJECT.md", text: "# Project\\n\\nReady to launch." }, created_at: "2026-06-17T10:00:02.000Z" }
    ]);
  `);
  const assistantHtml = app.run("__messageHtml(0)");
  const projectHtml = app.run("__messageHtml(1)");
  assert.equal(assistantHtml.includes("data-project-launch"), false, "assistant text messages must not duplicate the project launch button");
  assert.equal(projectHtml.includes("data-project-launch"), true, "project draft card should keep the canonical launch button");
  assert.equal(projectHtml.includes('data-inline-fullscreen="PROJECT.md"'), true, "project draft card should expose the canonical fullscreen preview");
  assert.equal(projectHtml.includes("inline-fullscreen-button"), true);
  assert.equal(projectHtml.includes("Open full view"), false);
}

function testMessagesExposeCopyButtons() {
  const app = loadAppContext();
  app.run(`
    __setMessages([
      { id: "u-copy", role: "user", kind: "text", text: "Copy this user message", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a-copy", role: "assistant", kind: "text", text: "Copy this assistant message", created_at: "2026-06-17T10:00:01.000Z" },
      { id: "p-copy", role: "assistant", kind: "project", text: "Project draft", artifact: { path: "PROJECT.md", text: "# Copyable Project\\n\\nDraft body." }, created_at: "2026-06-17T10:00:02.000Z" }
    ]);
    __setSession({
      id: "s-copy",
      session_id: "sid-copy",
      status: "completed",
      mode: "chat",
      started_at: "2026-06-17T10:00:00.000Z",
      transcript: [
        { id: "t-copy", role: "assistant", kind: "assistant", raw_type: "turn.completed", content: "Copy this transcript response.", created_at: "2026-06-17T10:00:03.000Z" }
      ]
    });
  `);
  const userHtml = app.run("__messageHtml(0)");
  const assistantHtml = app.run("__messageHtml(1)");
  const projectHtml = app.run("__messageHtml(2)");
  const transcriptHtml = app.run(`transcriptEntryHtml({
    id: "t-copy",
    role: "assistant",
    kind: "assistant",
    raw_type: "item.completed",
    content: "Copy this transcript response.",
    created_at: "2026-06-17T10:00:03.000Z"
  })`);
  assert.equal(userHtml.includes("message-copy-button"), true, "user messages should expose a copy icon");
  assert.equal(userHtml.includes(encodeURIComponent("Copy this user message")), true);
  assert.equal(assistantHtml.includes("message-copy-button"), true, "assistant messages should expose a copy icon");
  assert.equal(assistantHtml.includes(encodeURIComponent("Copy this assistant message")), true);
  assert.equal(projectHtml.includes("message-copy-button"), true, "project draft cards should expose a copy icon");
  assert.equal(projectHtml.includes(encodeURIComponent("# Copyable Project\n\nDraft body.")), true);
  assert.equal(transcriptHtml.includes("message-copy-button"), true, "transcript messages should expose a copy icon");
  assert.equal(transcriptHtml.includes(encodeURIComponent("Copy this transcript response.")), true);
}

function testFileTreePdfPreviewControls() {
  const app = loadAppContext();
  const tree = {
    type: "directory",
    name: "resources",
    path: "resources",
    children: [
      {
        type: "file",
        name: "paper.pdf",
        path: "resources/papers/paper.pdf",
        previewable: true,
        kind: "pdf",
        mime: "application/pdf",
      },
    ],
  };
  const html = app.run(`__treeHtmlProbe(${JSON.stringify(tree)})`);
  assert.equal(html.includes('data-file-details="resources/papers/paper.pdf"'), true, "previewable PDFs in file trees should be expandable");
  assert.equal(html.includes('data-inline-file="resources/papers/paper.pdf"'), true, "tree rows should still keep inline expansion for previewable files");
  assert.equal(html.includes('tree-file-actions'), false, "file tree rows should not add extra action controls that disrupt the browser layout");
  const pdfHtml = app.run("__inlinePdfBodyProbe()");
  assert.equal(pdfHtml.includes('class="file-pdf-preview"'), true, "PDF previews should render in an iframe");
  assert.equal(pdfHtml.includes("/api/file/raw?path=resources%2Fpapers%2Fpaper.pdf"), true, "PDF previews should use the raw file endpoint");
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
        { id: "ta1", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Checking sources.", created_at: "2026-06-17T10:00:04.000Z" },
        { id: "tc2", role: "command", kind: "command", raw_type: "process.started", content: "git status --short", created_at: "2026-06-17T10:00:05.000Z" }
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
  assert.equal(html.includes("Open latest manuscript"), false, "first running trial should not expose latest manuscript before a report exists");
  assert.equal(html.includes("Report pending"), false, "running trial should not render a low-information pending report card");
  assert.equal(html.includes("Report is not available yet."), false, "running trial should not render a low-information pending report card");
  assert.equal(html.includes("<span>Trial activity</span>"), false, "running trial details should stay in the live status row instead of a duplicate report card");
  const thinkingHtml = app.run("__thinkingProbe()");
  assert.equal(thinkingHtml.includes("Codex is working on Trial 1"), true, "working bubble should name the active trial");
  assert.equal(thinkingHtml.includes("Working for"), true, "working bubble should show elapsed running time");
  assert.equal(thinkingHtml.includes("Trial 1"), true, "working bubble should include the trial axis for autoresearch runs");
  assert.equal(thinkingHtml.includes("Current run activity"), false, "autoresearch working bubble should not duplicate the trial live activity panel");
  assert.equal(thinkingHtml.includes("Live trial activity"), true, "autoresearch working bubble should keep the trial live activity panel");
  assert.equal(thinkingHtml.includes("Update: Checking sources."), true, "trial live activity summary should expose the latest update");
  assert.equal(app.run("__progressSummaryProbe()"), "Update: Checking sources.", "collapsed current run summary should prefer readable Codex updates over later commands");
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
  assert.equal(html.includes("Open latest manuscript"), true, "reported trials should expose the latest manuscript shortcut");
  assert.equal(html.includes("Autoresearch complete"), true, "passed goals should mark the whole autoresearch trajectory complete");
  app.run(`
    appState.research_session.gate = { status: "continue" };
  `);
  const continuingHtml = app.run("__sessionTimelineProbe()");
  assert.equal(continuingHtml.includes("Autoresearch complete"), false, "incomplete gates must not show the autoresearch complete tag");
}

function testUncreatedTrialMentionDoesNotCreateTimelineTrial() {
  const app = loadAppContext();
  app.run(`
    appState.trials = Array.from({ length: 12 }, (_, index) => {
      const iteration = index + 1;
      const id = String(iteration).padStart(6, "0") + "_reported_trial";
      return {
        id,
        iteration,
        status: "reported",
        report_path: "research_trajectory/trials/" + id + "/REPORT.md",
        report_summary: "Reported trial " + iteration
      };
    });
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 13,
      gate: { status: "pass" },
      started_at: "2026-06-17T10:00:00.000Z",
      transcript: [
        { id: "tg13", role: "user", kind: "user", raw_type: "ui.goal", content: "Continue autoresearch loop (Trial 13).", created_at: "2026-06-17T10:00:01.000Z" },
        { id: "tc13", role: "command", kind: "command", raw_type: "process.started", content: "codex exec resume", created_at: "2026-06-17T10:00:02.000Z" },
        { id: "ta13", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "No Trial 13 was created because the stop condition is satisfied.", created_at: "2026-06-17T10:00:03.000Z" }
      ]
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("Trial 13"), false, "mentions of an uncreated trial must not become a trial nav item");
  assert.equal(html.includes("Report pending"), false, "uncreated trials must not render report-pending cards");
  assert.equal(html.includes("Trial 12"), true, "timeline should stay anchored to the latest materialized trial");
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
        { id: "tr1", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Checking the selected trial boundary.", created_at: "2026-06-17T10:00:02.000Z" },
        { id: "tc1", role: "command", kind: "command", raw_type: "process.started", content: "git diff -- PROJECT.md", created_at: "2026-06-17T10:00:03.000Z" }
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
  assert.equal(app.run("__progressSummaryProbe()"), "Update: Checking the selected trial boundary.", "chat run summary should prefer readable updates over later commands");
  const expandedHtml = app.run(`
    openRunActivityDetails.add(activeRunActivityDetailsKey());
    __progressDetailsProbe();
  `);
  assert.match(expandedHtml, /data-run-activity-details="[^"]+" open/, "current run activity should stay expanded across re-render");
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
  assert.equal(app.run("__trialStripScrollProbe(420)"), 420, "manual trial strip scroll should restore after DOM rerender");
  assert.equal(app.run("__trialStripScrollProbe(2400)"), 900, "trial strip scroll restore should clamp to the maximum scrollable offset");
  const auto = app.run("__trialStripAutoProbe()");
  assert.ok(auto.first > 0, "auto trial strip restore should bring the running chip into view");
  assert.equal(auto.second, auto.first, "poll-driven rerenders must not reset auto-centered trial strip scroll to the left edge");
  assert.equal(auto.state.mode, "auto", "auto-centering should not become sticky manual scroll state");
}

function testRunningTrialUsesProgressFallback() {
  const app = loadAppContext();
  const html = app.run(`__liveTrialStatusProbe({
    id: "s1",
    session_id: "sid",
    status: "running",
    mode: "goal",
    loop_active: true,
    started_at: "2026-06-17T10:00:00.000Z",
    gate: { status: "continue" },
    agent_wait_state: { kind: "idle", last_event_age_seconds: 120 },
    active_run: {
      running: true,
      mode: "goal",
      run_id: "s1",
      trial_iteration: 8,
      status_label: "Codex is working on Trial 8",
      wait_state: { kind: "idle", last_event_age_seconds: 120 },
      progress: {
        stage: "reviewing",
        stage_label: "Reviewing",
        stage_index: 5,
        total_stages: 6,
        summary: "Reviewing · 5/7 reviewer files",
        detail: "3/7 reviewer gates are pass.",
        reviewer_count: 5,
        reviewer_total: 7,
        artifacts_count: 3
      }
    },
    transcript: []
  })`);
  assert.equal(html.includes("Reviewing · 5/7 reviewer files"), true, "running trial without transcript events should show file-backed progress");
  assert.equal(html.includes("trial-progress-stepper"), true, "running trial should render the compact progress stepper");
  assert.equal(html.includes("Waiting for agent events"), false, "progress fallback should replace the weak waiting placeholder");
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

function testReviewStorageOutdatedDoesNotShowProjectWarning() {
  const app = loadAppContext();
  const storageOnly = app.run(`projectReviewerInstructionsOutdated({
    reviewer_status: {
      baseline_version: "2026-06-publication-ready-tables",
      latest_baseline_version: "2026-06-publication-ready-tables",
      missing: [],
      changed: [],
      metadata_missing: [],
      review_storage: { outdated: true }
    }
  })`);
  assert.equal(storageOnly, false, "review storage/state sync issues should not show the project-list reviewer-template warning");
  const changedTemplate = app.run(`projectReviewerInstructionsOutdated({
    reviewer_status: {
      baseline_version: "old",
      latest_baseline_version: "2026-06-publication-ready-tables",
      missing: [],
      changed: ["EVIDENCE_REVIEWER.md"],
      metadata_missing: []
    }
  })`);
  assert.equal(changedTemplate, true, "actual reviewer template drift should still be detected for the project menu maintenance action");
  const html = app.run(`__renderProjectListProbe({
    active_project_id: "project-1",
    open_project_menu: "project-1",
    projects: [{
      id: "project-1",
      display_name: "perceived safety",
      status: "running",
      session_id: "019ee62",
      reviewer_status: {
        baseline_version: "old",
        latest_baseline_version: "2026-06-publication-ready-tables",
        missing: [],
        changed: ["EVIDENCE_REVIEWER.md"],
        metadata_missing: []
      }
    }]
  })`);
  assert.equal(html.includes("Reviewer templates outdated"), false, "project sidebar card should not show maintenance reviewer-template status");
}

function testReviewsPanelGroupsByTrial() {
  const app = loadAppContext();
  const reviews = [{
    type: "trial_review",
    path: "research_trajectory/trials/000012_final_blueprint_gate_repair/reviews/FINAL_GATE_REVIEW.md",
    name: "FINAL_GATE_REVIEW.md",
    source_trial: "000012_final_blueprint_gate_repair",
    reviewer: "Final gate reviewer",
    decision: "pass",
    summary: "Gate passes."
  }, {
    type: "trial_review",
    path: "research_trajectory/trials/000011_reference_cleanup/reviews/EVIDENCE_REVIEW.md",
    name: "EVIDENCE_REVIEW.md",
    source_trial: "000011_reference_cleanup",
    reviewer: "Evidence reviewer",
    decision: "continue",
    summary: "Needs citation cleanup."
  }, {
    type: "trial_review",
    path: "research_trajectory/trials/000012_final_blueprint_gate_repair/reviews/MANUSCRIPT_REVIEW.md",
    name: "MANUSCRIPT_REVIEW.md",
    source_trial: "000012_final_blueprint_gate_repair",
    reviewer: "Manuscript reviewer",
    decision: "pass",
    summary: "Manuscript passes."
  }, {
    type: "trial_review",
    path: "research_trajectory/trials/000012_final_blueprint_gate_repair/reviews/PLAN_REVIEW.md",
    name: "PLAN_REVIEW.md",
    source_trial: "000012_final_blueprint_gate_repair",
    reviewer: "Plan reviewer",
    decision: "pass",
    summary: "Plan passes."
  }];
  const html = app.run(`__renderReviewsPanelProbe(${JSON.stringify(reviews)})`);
  assert.equal(html.includes("review-trial-strip"), true, "reviews should render a horizontal trial selector");
  assert.equal(html.includes("review-selected-group"), true, "reviews should render one selected trial group");
  assert.equal(html.includes('data-review-trial-select="trial:000012_final_blueprint_gate_repair"'), true);
  assert.equal(html.includes('data-review-trial-select="trial:000011_reference_cleanup"'), true);
  assert.equal(html.includes("Trial 12: final blueprint gate repair"), true);
  assert.equal(html.includes("Trial 11: reference cleanup"), true);
  assert.equal(html.indexOf("Trial 11: reference cleanup") < html.indexOf("Trial 12: final blueprint gate repair"), true, "review trial axis should increase left to right");
  assert.equal(html.includes("3 reviews · 3 pass"), true, "group summary should show review counts and pass counts");
  assert.equal(html.includes("Needs citation cleanup."), false, "older trial review summaries should not appear in the selected trial body");
  assert.equal(html.indexOf("PLAN_REVIEW.md") < html.indexOf("MANUSCRIPT_REVIEW.md"), true, "group should use reviewer workflow ordering");
  assert.equal(html.indexOf("MANUSCRIPT_REVIEW.md") < html.indexOf("FINAL_GATE_REVIEW.md"), true, "final gate should appear after manuscript review");
  assert.equal(html.includes('data-card-preview="research_trajectory/trials/000012_final_blueprint_gate_repair/reviews/PLAN_REVIEW.md"'), true);
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

function testProjectScopedSessionSettingsOverrideServerDefaults() {
  const app = loadAppContext();
  let state = app.run(`
    uiSettings = {
      codex: {
        model: "gpt-5.5",
        reasoningEffort: "medium",
        permissionPreset: "default",
        webSearch: true,
        reviewCheckpointInterval: 100
      }
    };
    localStorage.setItem(scopedStorageKey("autoResearchSessionSettings"), JSON.stringify({
      model: "gpt-5.4-mini",
      reasoningEffort: "xhigh",
      permissionPreset: "auto-review",
      webSearch: false,
      reviewCheckpointInterval: 12
    }));
    restoreSessionSettings();
    __sessionSettingsState();
  `);
  assert.equal(state.composerModel, "gpt-5.4-mini", "scoped browser model override should beat server defaults");
  assert.equal(state.composerReasoning, "xhigh", "scoped browser reasoning override should beat server defaults");
  assert.equal(state.formModel, "gpt-5.4-mini");
  assert.equal(state.formReasoning, "xhigh");
  assert.equal(state.formPermission, "auto-review");
  assert.equal(state.formWebSearch, false);
  assert.equal(Number(state.formReviewInterval), 12);
  assert.equal(state.legacy, null, "session settings must not use the legacy global key");

  state = app.run(`
    __setProjectId("p2");
    uiSettings = {
      codex: {
        model: "gpt-5.5",
        reasoningEffort: "medium",
        permissionPreset: "default",
        webSearch: true,
        reviewCheckpointInterval: 100
      }
    };
    restoreSessionSettings();
    __sessionSettingsState();
  `);
  assert.equal(state.projectId, "p2");
  assert.equal(state.composerModel, "gpt-5.5", "another project must not inherit p1 model override");
  assert.equal(state.composerReasoning, "medium", "another project must not inherit p1 reasoning override");
  assert.equal(state.stored, null);
}

function testComposerModelReasoningChangesPersistProjectScoped() {
  const app = loadAppContext();
  let state = app.run(`
    document.querySelector("#composer-model").value = "gpt-5.3-codex";
    document.querySelector("#composer-reasoning").value = "high";
    updateSessionSettingsFromComposer();
    __sessionSettingsState();
  `);
  let stored = JSON.parse(state.stored);
  assert.equal(stored.agent.backend, "codex");
  assert.equal(stored.codex.model, "gpt-5.3-codex");
  assert.equal(stored.codex.reasoningEffort, "high");
  assert.equal(state.composerModel, "gpt-5.3-codex");
  assert.equal(state.composerReasoning, "high");
  assert.equal(state.formModel, "gpt-5.3-codex");
  assert.equal(state.formReasoning, "high");

  state = app.run(`
    __setProjectId("p2");
    uiSettings = { codex: { model: "gpt-5.5", reasoningEffort: "medium" } };
    restoreSessionSettings();
    __sessionSettingsState();
  `);
  assert.equal(state.composerModel, "gpt-5.5");
  assert.equal(state.composerReasoning, "medium");
  assert.equal(state.stored, null);

  state = app.run(`
    __setProjectId("p1");
    restoreSessionSettings();
    __sessionSettingsState();
  `);
  stored = JSON.parse(state.stored);
  assert.equal(stored.agent.backend, "codex");
  assert.equal(stored.codex.model, "gpt-5.3-codex");
  assert.equal(stored.codex.reasoningEffort, "high");
  assert.equal(state.composerModel, "gpt-5.3-codex", "returning to p1 should restore its model override");
  assert.equal(state.composerReasoning, "high", "returning to p1 should restore its reasoning override");
}

function testAgentBackendSelectorPersistsProviderSettings() {
  const app = loadAppContext();
  let state = app.run(`
    uiSettings = {
      agent: { backend: "codex" },
      codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
      claude: { model: "sonnet", reasoningEffort: "medium", permissionPreset: "auto-review", webSearch: true, reviewCheckpointInterval: 100 }
    };
    switchSessionBackend("claude");
    __sessionSettingsState();
  `);
  let stored = JSON.parse(state.stored);
  assert.equal(state.formBackend, "claude");
  assert.equal(state.composerModel, "sonnet");
  assert.equal(stored.agent.backend, "claude");
  assert.equal(stored.claude.model, "sonnet");

  state = app.run(`
    document.querySelector("#composer-model").value = "opus";
    document.querySelector("#composer-reasoning").value = "high";
    updateSessionSettingsFromComposer();
    __sessionSettingsState();
  `);
  stored = JSON.parse(state.stored);
  assert.equal(stored.agent.backend, "claude");
  assert.equal(stored.claude.model, "opus");
  assert.equal(stored.claude.reasoningEffort, "high");
  assert.equal(stored.codex.model, "gpt-5.5", "Codex settings should remain provider-specific");

  state = app.run(`
    switchSessionBackend("codex");
    __sessionSettingsState();
  `);
  stored = JSON.parse(state.stored);
  assert.equal(state.formBackend, "codex");
  assert.equal(state.composerModel, "gpt-5.5");
  assert.equal(stored.agent.backend, "codex");
}

async function testProjectCreateSendsBackendAndLoadsProjectDefault() {
  const app = loadAppContext();
  const result = await app.run(`
    (async () => {
      const settingsPayload = {
        agent: { backend: "claude" },
        codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
        claude: { model: "sonnet", reasoningEffort: "medium", permissionPreset: "auto-review", webSearch: true, reviewCheckpointInterval: 100 },
        agent_status: { selected: "claude", backends: {} }
      };
      api = async (endpoint, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : {};
        globalThis.__apiCalls.push({ endpoint, body });
        if (endpoint === "/api/projects") {
          return {
            ok: true,
            project: { id: "p2", display_name: "Claude Project" },
            active_project_id: "p2",
            projects: [{ id: "p2", display_name: "Claude Project" }],
            multi_project: true
          };
        }
        if (endpoint === "/api/settings") {
          return { ok: true, settings: settingsPayload, secret_keys: [] };
        }
        return { ok: true };
      };
      const form = document.querySelector("#project-create-form");
      form.elements.projectName.value = "Claude Project";
      form.elements.agentBackend.value = "claude";
      await createProjectFromDialog({ preventDefault() {}, currentTarget: form });
      return {
        calls: globalThis.__apiCalls,
        activeProjectId,
        state: __sessionSettingsState(),
        toasts: globalThis.__toastMessages,
        name: form.elements.projectName.value,
        backend: form.elements.agentBackend.value
      };
    })()
  `);
  const createCall = result.calls.find((call) => call.endpoint === "/api/projects");
  assert.ok(createCall, `project create API call missing: ${JSON.stringify(result)}`);
  assert.equal(createCall.body.agentBackend, "claude", "project create should send the selected backend");
  assert.equal(result.activeProjectId, "p2");
  assert.equal(result.state.formBackend, "claude", "new project should load with its seeded backend default");
  assert.equal(result.state.composerModel, "sonnet");
}

function testAgentReadinessStatusBlocksLaunchUi() {
  const app = loadAppContext();
  const state = app.run(`
    uiSettings = {
      agent: { backend: "claude" },
      codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
      claude: { model: "sonnet", reasoningEffort: "medium", permissionPreset: "auto-review", webSearch: true, reviewCheckpointInterval: 100 },
      agent_status: {
        selected: "claude",
        backends: {
          codex: { ok: true, blocking: false, message: "Codex CLI is installed and authenticated." },
          claude: {
            ok: false,
            blocking: true,
            auth: "missing",
            message: "Claude Code is not authenticated. Run claude auth login and verify claude auth status before starting a run."
          }
        }
      }
    };
    prepareSaved = true;
    appState.files.project.text = "# Project\\n\\nReady.";
    applySessionSettings({ backend: "claude", model: "sonnet", reasoningEffort: "medium", permissionPreset: "auto-review", webSearch: true, reviewCheckpointInterval: 100 }, true);
    globalThis.__renderStageImpl();
    __agentStatusState();
  `);
  assert.equal(state.launchDisabled, true, "blocking selected backend should disable launch");
  assert.equal(state.launchTone, "error");
  assert.equal(state.launchNote.includes("claude auth login"), true, "launch status should include Claude setup guidance");
  assert.equal(state.launchTitle.includes("claude auth login"), true, "disabled launch title should include provider-specific guidance");
}

function testEnvForcedBackendStatusMessage() {
  const app = loadAppContext();
  const state = app.run(`
    uiSettings = {
      agent: { backend: "claude" },
      codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
      claude: { model: "sonnet", reasoningEffort: "medium", permissionPreset: "auto-review", webSearch: true, reviewCheckpointInterval: 100 },
      agent_status: {
        selected: "claude",
        env_override: "claude",
        backends: {
          claude: { ok: true, blocking: false, auth: "ok", message: "Claude Code CLI is installed and authenticated." }
        }
      }
    };
    const form = document.querySelector("#project-create-form");
    form.elements.agentBackend.value = "codex";
    renderAgentStatusNote("#project-agent-backend-note", "codex", "project");
    __agentStatusState();
  `);
  assert.equal(state.projectNote.includes("COAUTO_AGENT_BACKEND forces Claude Code"), true);
  assert.equal(state.projectNote.includes("runs use the forced backend"), true);
}

function testInvalidEnvBackendStatusWarning() {
  const app = loadAppContext();
  const state = app.run(`
    uiSettings = {
      agent: { backend: "claude" },
      codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
      claude: { model: "sonnet", reasoningEffort: "medium", permissionPreset: "auto-review", webSearch: true, reviewCheckpointInterval: 100 },
      agent_status: {
        selected: "claude",
        env_override: "",
        env_warning: "Ignoring invalid COAUTO_AGENT_BACKEND='bogus'; expected \`codex\` or \`claude\`.",
        backends: {
          claude: { ok: true, blocking: false, auth: "ok", message: "Claude Code CLI is installed and authenticated." }
        }
      }
    };
    renderAgentStatusNote("#settings-agent-status", "claude", "settings");
    __agentStatusState();
  `);
  assert.equal(state.settingsTone, "warning");
  assert.equal(state.settingsNote.includes("invalid COAUTO_AGENT_BACKEND"), true);
  assert.equal(state.settingsNote.includes("Claude Code CLI is installed"), true);
}

function testProviderSpecificResumeCommand() {
  const app = loadAppContext();
  const codex = app.run(`
    appState.repo_root = "/tmp/project root";
    __setSession({ session_id: "00000000-0000-0000-0000-000000000001", backend: "codex", settings: { backend: "codex" } });
    agentResumeCommand();
  `);
  assert.equal(codex.includes("codex resume --include-non-interactive"), true, "Codex resume command should use Codex CLI");
  assert.equal(codex.includes("-C '/tmp/project root'"), true, "Codex resume command should include cwd");

  const claude = app.run(`
    __setSession({ session_id: "00000000-0000-0000-0000-000000000002", backend: "claude", settings: { backend: "claude" } });
    agentResumeCommand();
  `);
  assert.equal(claude.includes("claude --resume"), true, "Claude resume command should use Claude Code CLI");
  assert.equal(claude.includes("--add-dir '/tmp/project root'"), true, "Claude resume command should include allowed project dir");
  assert.equal(claude.includes("codex"), false, "Claude resume command should not use Codex");
}

async function testSettingsModalSaveSyncsScopedSessionSettings() {
  const app = loadAppContext();
  const state = await app.run(`
    (async () => {
      const form = document.querySelector("#settings-form");
      form.querySelector = () => null;
      form.elements.themeMode.value = "museum-tech";
      form.elements.settingsModel.value = "gpt-5.2";
      form.elements.settingsReasoningEffort.value = "low";
      form.elements.settingsPermissionPreset.value = "full-access";
      form.elements.settingsWebSearch.checked = false;
      form.elements.settingsExtraConfig.value = "sandbox note";
      form.elements.settingsReviewCheckpointInterval.value = "17";
      const payload = settingsPayloadFromModal();
      globalThis.__apiResponse = { settings: payload, secret_keys: [] };
      await saveUiSettings({ preventDefault() {}, currentTarget: form, submitter: null });
      return __sessionSettingsState();
    })()
  `);
  const stored = JSON.parse(state.stored);
  assert.equal(stored.agent.backend, "codex");
  assert.equal(stored.codex.model, "gpt-5.2");
  assert.equal(stored.codex.reasoningEffort, "low");
  assert.equal(stored.codex.permissionPreset, "full-access");
  assert.equal(stored.codex.webSearch, false);
  assert.equal(Number(stored.codex.reviewCheckpointInterval), 17);
  assert.equal(state.composerModel, "gpt-5.2", "Settings save should sync the composer model");
  assert.equal(state.composerReasoning, "low", "Settings save should sync the composer reasoning");
  assert.equal(state.formPermission, "full-access", "Settings save should sync launch/session form values");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/settings");
}

function testProjectScopedComposerDraftAndTargetVenueRestore() {
  const app = loadAppContext();
  let state = app.run(`
    appState.cold_start_files = [{ path: "resources/user_input/INITIAL_BRIEF.md", text: "" }];
    activeColdPath = "resources/user_input/INITIAL_BRIEF.md";
    persistComposerDraft("Draft for project one");
    scopedSet("autoResearchTargetVenue", "Nature Methods");
    document.querySelector("#cold-file-editor").value = "";
    document.querySelector("#target-venue").value = "";
    renderColdStartEditor();
    hydrateTargetVenueField({ force: true });
    ({ draft: __composerDraftState(), venue: __targetVenueState() });
  `);
  assert.equal(state.draft.value, "Draft for project one", "composer draft should restore for the active project");
  assert.equal(state.draft.stored, "Draft for project one");
  assert.equal(state.venue.value, "Nature Methods", "target venue should restore for the active project");
  assert.equal(state.venue.scoped, "Nature Methods");
  assert.equal(state.draft.legacy, null);
  assert.equal(state.venue.legacy, null);

  state = app.run(`
    __setProjectId("p2");
    appState.cold_start_files = [{ path: "resources/user_input/INITIAL_BRIEF.md", text: "" }];
    activeColdPath = "resources/user_input/INITIAL_BRIEF.md";
    renderColdStartEditor();
    hydrateTargetVenueField({ force: true });
    ({ draft: __composerDraftState(), venue: __targetVenueState() });
  `);
  assert.equal(state.draft.value, "", "another project must not inherit p1 composer draft");
  assert.equal(state.draft.stored, null);
  assert.equal(state.venue.value, "", "another project must not inherit p1 target venue");
  assert.equal(state.venue.scoped, null);

  state = app.run(`
    persistComposerDraft("Draft for project two");
    scopedSet("autoResearchTargetVenue", "NeurIPS");
    __setProjectId("p1");
    renderColdStartEditor();
    hydrateTargetVenueField({ force: true });
    ({ draft: __composerDraftState(), venue: __targetVenueState() });
  `);
  assert.equal(state.draft.value, "Draft for project one", "returning to p1 should restore its own composer draft");
  assert.equal(state.venue.value, "Nature Methods", "returning to p1 should restore its own target venue");
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

function testTargetVenueUsesOnlyProjectScopedDraft() {
  const app = loadAppContext();
  let state = app.run(`
    localStorage.setItem("autoResearchTargetVenue", "Old global venue");
    activeProjectId = "new-project";
    appState = {
      ...(appState || {}),
      active_project_id: "new-project",
      inputs: {},
      summaries: { project: { target: "Not specified" }, manuscript: { target: "" } }
    };
    __hydrateTargetVenue({}, { force: true });
  `);
  assert.equal(state.value, "", "global target venue drafts must not be restored into a project");
  assert.equal(state.scoped, null);
  assert.equal(state.legacy, null);

  state = app.run(`
    scopedSet("autoResearchTargetVenue", "Old scoped venue");
    __hydrateTargetVenue({
      inputs: { target_venue: "ICLR workshop, benchmark report" },
      summaries: { project: { target: "Not specified" }, manuscript: { target: "" } }
    }, { force: true });
  `);
  assert.equal(state.value, "Old scoped venue", "current project scoped target venue should restore after refresh");
  assert.equal(state.scoped, "Old scoped venue");

  state = app.run(`
    scopedRemove("autoResearchTargetVenue");
    __hydrateTargetVenue({
      inputs: { target_venue: "ICLR workshop, benchmark report" },
      summaries: { project: { target: "Not specified" }, manuscript: { target: "" } }
    }, { force: true });
  `);
  assert.equal(state.value, "", "server target venue metadata must remain a hint, not a prefilled input value");
  assert.equal(state.scoped, null);

  state = app.run(`
    document.querySelector("#target-venue").value = "Audience: methods reviewers";
    scopedSet("autoResearchTargetVenue", "Audience: methods reviewers");
    __hydrateTargetVenue({
      inputs: { target_venue: "ICLR workshop, benchmark report" },
      summaries: { project: { target: "Not specified" }, manuscript: { target: "" } }
    });
  `);
  assert.equal(state.value, "Audience: methods reviewers", "overview polling should not clear active target venue input");
  assert.equal(state.scoped, "Audience: methods reviewers");

  state = app.run(`
    __hydrateTargetVenue({ inputs: { target_venue: "Server refreshed venue" } }, { force: true });
  `);
  assert.equal(state.value, "Audience: methods reviewers", "forced project hydration should keep the project-scoped target venue draft");
}

function testMaterialTypeChipsUseLocalBrowserAndPlusUsesFilePicker() {
  const app = loadAppContext();
  let state = app.run('__chooseMaterialTypeProbe("literature")');
  assert.equal(state.activeCategory, "literature", "material chips should still set the selected resource type");
  assert.equal(state.browserOpenCategory, "literature", "material chips should open the local browser with the selected type");
  assert.equal(state.browserOpenCount, 1, "material chips should use the server local browser for copy/symlink resources");
  assert.equal(state.clicks, 0, "material chips must not use browser File upload for resource folders or large zip files");

  state = app.run('__openFilePickerProbe("user_input")');
  assert.equal(state.activeCategory, "literature", "generic plus browsing should not change the active material type");
  assert.equal(state.pendingCategory, "user_input", "generic plus browsing should keep the default user-input category");
  assert.equal(state.clicks, 1);
}

async function testLargeBrowserUploadsUseResourceCopyFlow() {
  const app = loadAppContext();
  let state = app.run('__addUploadProbe({ name: "small-note.md", type: "text/markdown", size: 1024, lastModified: 1 }, { category: "user_input" })');
  assert.equal(state.after, 1, "small browser uploads should still attach normally");
  assert.equal(state.uploads[0].name, "small-note.md");
  assert.equal(state.briefTrayHidden, false, "attached files should make the composer attachment tray visible");
  assert.equal(
    state.briefTray.includes("small-note.md"),
    true,
    `attached files should render as composer chips: exists=${state.trayExists} hidden=${state.briefTrayHidden} html=${state.briefTray}`
  );

  state = app.run('__addFilesProbe([{ name: "perceived_safety.zip", type: "application/zip", size: 1593975145, lastModified: 2, slice(start, end) { return { arrayBuffer: async () => new ArrayBuffer(end - start) }; } }], "drop", { category: "ongoing_work" })');
  assert.equal(state.before, 1);
  assert.equal(state.accepted, 0, "large dropped browser uploads should not be counted as normal browser uploads");
  assert.equal(state.after, 1, "large browser uploads should not become base64 upload chips");
  assert.equal(state.imports.length, 1, "large dropped browser uploads should enter the resource-copy queue");
  assert.equal(state.imports[0].status, "pending_confirm");
  assert.equal(state.briefTray.includes("perceived_safety.zip"), true, "pending large imports should render in the composer tray");
  assert.equal(app.run("__pendingResourceImportState()").blocked, true, "pending large imports should block send and launch actions");
  assert.equal(
    state.toasts.some((toast) => !toast.error && toast.message.includes("resource-copy confirmation")),
    true,
    "large upload should ask for resource-copy confirmation"
  );
  assert.equal(
    state.toasts.some((toast) => !toast.error && toast.message.includes("attached from drop")),
    false,
    "large pending drops must not show a false attached-from-drop success toast"
  );

  state = await app.run('__confirmFirstResourceImport()');
  assert.equal(state.blocked, false, "completed large resource imports should unblock sending");
  assert.equal(state.imports.length, 0, "completed imports should leave the pending queue");
  assert.equal(state.resources.length, 1, "completed imports should add a resource link chip");
  assert.equal(state.resources[0].path, "resources/ongoing_work/perceived_safety.zip");
  assert.equal(state.resources[0].alreadyImported, true);
}

function testCompactComposerAutosizesFromCenteredBase() {
  const app = loadAppContext();
  let state = app.run('__resizeColdEditorProbe({ value: "", scrollHeight: 44 })');
  assert.equal(state.singleLine, false, "compact composer should not rely on a forced single-line class");
  assert.equal(state.rows, 1, "compact composer should start from a one-row textarea");
  assert.equal(state.height, "44px");
  assert.equal(state.overflowY, "hidden");

  state = app.run('__resizeColdEditorProbe({ value: "S", scrollHeight: 44 })');
  assert.equal(state.singleLine, false, "single-character input should stay on the normal autosize path");
  assert.equal(state.height, "44px");
  assert.equal(state.overflowY, "hidden");

  state = app.run('__resizeColdEditorProbe({ value: "Line one\\nLine two", scrollHeight: 88 })');
  assert.equal(state.singleLine, false);
  assert.equal(state.height, "88px");
  assert.equal(state.overflowY, "hidden");

  state = app.run('__resizeColdEditorProbe({ value: "A long wrapped composer line", scrollHeight: 88 })');
  assert.equal(state.singleLine, false);
  assert.equal(state.height, "88px");
  assert.equal(state.overflowY, "hidden");

  state = app.run('__resizeColdEditorProbe({ value: "Overflowing composer content", scrollHeight: 400 })');
  assert.equal(state.singleLine, false);
  assert.equal(state.height, "306px");
  assert.equal(state.overflowY, "auto");
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

async function testExportBundleFlow() {
  const base = loadAppContext();
  const panel = base.run("__renderExportPanelProbe(null)");
  assert.equal(panel.includes("Download BLUEPRINT.md"), true);
  assert.equal(panel.includes('data-download-single-file="manuscript/BLUEPRINT.md"'), true);
  assert.equal(panel.includes("Download blueprint pack"), true);
  assert.equal(panel.includes("Download final project pack"), true);
  const singleFileHref = base.run(`
    downloadSingleFile("manuscript/BLUEPRINT.md");
    window.location.href;
  `);
  assert.equal(singleFileHref.includes("/api/file/raw?"), true);
  assert.equal(singleFileHref.includes("path=manuscript%2FBLUEPRINT.md"), true);
  assert.equal(singleFileHref.includes("project=p1"), true);
  assert.equal(singleFileHref.includes("download=1"), true);

  const readyPanel = base.run(`__renderExportPanelProbe(${JSON.stringify({
    id: "ex_ready",
    kind: "blueprint",
    label: "Blueprint Pack",
    status: "ready",
    phase: "ready",
    total_bytes: 2048,
    bytes_done: 2048,
    file_count: 3,
    files_done: 3,
    download_url: "/api/export/download?id=ex_ready"
  })})`);
  assert.equal(readyPanel.includes("data-export-download"), true);
  assert.equal(readyPanel.includes("Download</button>"), true);

  const cancelledPanel = base.run(`__renderExportPanelProbe(${JSON.stringify({
    id: "ex_cancelled",
    kind: "final_project",
    label: "Final Project Pack",
    status: "cancelled",
    phase: "cancelled",
    total_bytes: 4096,
    bytes_done: 1024,
    file_count: 5,
    files_done: 2
  })})`);
  assert.equal(cancelledPanel.includes("data-export-download"), false);
  assert.equal(cancelledPanel.includes("Cancelled"), true);

  const under = loadAppContext();
  const underResult = await under.run(`__beginExportFlowProbe("blueprint", ${JSON.stringify({
    kind: "blueprint",
    label: "Blueprint Pack",
    total_bytes: 500000,
    file_count: 4,
    largest_files: [],
    large_files: [],
    skipped: [],
    missing_externals: [],
    requires_confirmation: false,
    confirmation_threshold_bytes: 1073741824
  })}, ${JSON.stringify({
    id: "ex_under",
    kind: "blueprint",
    label: "Blueprint Pack",
    status: "packaging",
    phase: "packaging",
    total_bytes: 500000,
    bytes_done: 100000,
    file_count: 4,
    files_done: 1,
    current_file: "BLUEPRINT.md"
  })})`);
  assert.equal(underResult.dialogOpen, false);
  assert.equal(underResult.calls.some((call) => call.endpoint.startsWith("/api/export/estimate")), true);
  assert.equal(underResult.calls.some((call) => call.endpoint === "/api/export/start"), true);
  assert.equal(underResult.activeExportJob.status, "packaging");
  assert.equal(underResult.panel.includes("BLUEPRINT.md"), true);

  const over = loadAppContext();
  const overEstimate = {
    kind: "final_project",
    label: "Final Project Pack",
    total_bytes: 2 * 1024 * 1024 * 1024,
    file_count: 12,
    largest_files: [{ bundle_path: "workspace/results/model.bin", source_path: "workspace/results/model.bin", size: 1500000000 }],
    large_files: [{ bundle_path: "workspace/results/model.bin", source_path: "workspace/results/model.bin", size: 1500000000 }],
    skipped: [{ path: "research_trajectory", reason: "not part of final result export" }],
    missing_externals: [{ path: "resources/data/missing.csv", target: "../missing.csv", reason: "missing symlink target" }],
    requires_confirmation: true,
    confirmation_threshold_bytes: 1073741824
  };
  const overResult = await over.run(`__beginExportFlowProbe("final_project", ${JSON.stringify(overEstimate)})`);
  assert.equal(overResult.dialogOpen, true);
  assert.equal(overResult.calls.some((call) => call.endpoint === "/api/export/start"), false);
  assert.equal(overResult.dialogSummary.includes("workspace/results/model.bin"), true);
  assert.equal(overResult.dialogSummary.includes("research_trajectory"), true);
  await over.run("confirmExportDialog()");
  const overCalls = over.run("globalThis.__apiCalls");
  assert.equal(overCalls.some((call) => call.endpoint === "/api/export/start" && call.body.confirmed === true), true);

  const download = loadAppContext();
  const href = download.run(`
    activeExportJob = { id: "ex_dl", kind: "blueprint", label: "Blueprint Pack", status: "ready", phase: "ready", download_url: "/api/export/download?id=ex_dl" };
    downloadExportJob("ex_dl");
    window.location.href;
  `);
  assert.equal(href.includes("/api/export/download?id=ex_dl"), true);
  assert.equal(href.includes("project=p1"), true);
}

function testBlueprintInspectorRendersSidebarForLatestManuscriptOnly() {
  const app = loadAppContext();
  const manuscript = {
    target: "Nature Machine Intelligence",
    article_type: "Perspective",
    contribution: "Finished conceptual result.",
    core_story: "The paper argues that calibration changes how safety evidence is read and acted on.",
    toc: "- [Section 2: Calibration result](#section-2-calibration-result)",
    architecture: [{
      title: "Abstract",
      level: 2,
      is_artifact: false,
      path: "Abstract",
      body: "Target-venue role: Summarize the argument.\nSection brief: The abstract states the finished argument and evidence posture without drafting final prose.\nLocal thesis / purpose: Calibration is the paper's central result.\nLocal claims in plain language: The paper advances one bounded claim.\nLocal evidence, results, or artifacts: E1 supports the claim.\nParagraph plan:\n\n| Para | Rhetorical move | Content to cover, not full prose | Local evidence / result / artifact | Display / method / result block | Citation posture | Required qualification | Transition job |\n|---|---|---|---|---|---|---|---|\n| A1 | State contribution | Summarize the result. | E1 | none | no citations | none | open paper |"
    }, {
      title: "Section 2: Calibration result",
      level: 2,
      is_artifact: false,
      path: "Section 2",
      body: "Target-venue role: Results-like argument.\nSection brief: This section explains the calibration result, ties it to reviewed evidence, and places the figure and table where readers need them.\nReader question answered: What result should the reader take away?\nLocal thesis / purpose: Calibration changes the observed outcome in the accepted evidence.\nLocal claims in plain language: The local claim is understandable without opening an ID map.\nLocal evidence, results, or artifacts: Evidence E1 supports the local result.\nPlaced displays / methods / results: Figure F000001 and Table T000001.\nTransition job: sets up interpretation."
    }],
    inline_artifacts: [{
      title: "Figure F000001: Calibration Map",
      level: 3,
      kind: "figure",
      is_artifact: true,
      body: [
        "Placement: Section 2 paragraph P1.",
        "Inclusion status: active.",
        "Reader takeaway: The calibration map is the visual result for Section 2.",
        "Source artifact or spec path: `manuscript/figures/calibration_map.pdf`"
      ].join("\n")
    }, {
      title: "Table T000001: Evidence Matrix",
      level: 3,
      kind: "table",
      is_artifact: true,
      body: [
        "Placement: Section 2 paragraph P2.",
        "Status: candidate.",
        "Reader takeaway: The table makes the evidence mapping inspectable.",
        "Publication-ready table:",
        "",
        "| Claim | Evidence | Status |",
        "|---|---|---|",
        "| C1 | E1 | candidate |",
        "Caption draft or current caption: Evidence matrix caption.",
        "Source artifact or spec path: `manuscript/tables/evidence_matrix.csv`"
      ].join("\n")
    }, {
      title: "Result R000001: Benchmark Summary",
      level: 3,
      kind: "result",
      is_artifact: true,
      body: [
        "Placement: Section 2 paragraph P3.",
        "Status: active.",
        "Reader takeaway: The benchmark summary is treated as a result block.",
        "Source artifact: `research_trajectory/CURRENT_FINDINGS.md`"
      ].join("\n")
    }],
  };
  const payload = {
    path: "manuscript/BLUEPRINT.md",
    exists: true,
    kind: "markdown",
    editable: true,
    text: [
      "# Architecture Overview",
      "## Section 2: Calibration result",
      "### Figure F000001: Calibration Map",
      "### Table T000001: Evidence Matrix",
      "### Result R000001: Benchmark Summary"
    ].join("\n\n")
  };
  const reviews = [{
    type: "trial_review",
    path: "research_trajectory/trials/000001_seed/reviews/EVIDENCE_REVIEW.md",
    reviewer: "Old evidence reviewer",
    decision: "continue",
    source_trial: "000001_seed",
    summary: "Old evidence review."
  }, {
    type: "trial_review",
    path: "research_trajectory/trials/000002_active/reviews/EVIDENCE_REVIEW.md",
    reviewer: "Evidence reviewer",
    decision: "pass",
    source_trial: "000002_active",
    summary: "Evidence passes."
  }, {
    type: "trial_review",
    path: "research_trajectory/trials/000003_later/reviews/EVIDENCE_REVIEW.md",
    reviewer: "Later evidence reviewer",
    decision: "pass",
    source_trial: "000003_later",
    summary: "Later evidence review."
  }];
  const activeTrialSession = {
    status: "running",
    mode: "goal",
    active_run: { running: true, trial_iteration: 2 },
  };
  const html = app.run(`__blueprintInspectorProbe(${JSON.stringify(payload)}, ${JSON.stringify(manuscript)}, ${JSON.stringify(reviews)}, ${JSON.stringify(activeTrialSession)})`);
  assert.equal(html.includes("blueprint-inspector"), true);
  assert.equal(html.includes("manuscript-story-map"), true);
  assert.equal(html.includes("Manuscript story map"), true);
  assert.equal(html.includes("Finished-results blueprint"), true);
  assert.equal(html.includes("Main takeaway"), true);
  assert.equal(html.includes("What this section says"), true);
  assert.equal(html.includes("Evidence / results"), true);
  assert.equal(html.includes("Displays"), true);
  assert.equal(html.includes("manuscript-abstract-card"), true);
  assert.equal(html.includes("architecture-field-list"), true);
  assert.equal(html.includes("paper-field-grid architecture-field-grid"), false);
  assert.equal(html.includes("publication-table-preview"), true);
  assert.equal(html.includes("Blueprint inspector"), true);
  assert.equal(html.includes('<details class="blueprint-sidebar-section">'), true, "blueprint sidebar sections should be collapsed details by default");
  assert.equal(html.includes("<summary>"), true);
  assert.equal(html.includes("<small>1</small>"), true, "sidebar summaries should include section counts");
  assert.equal(html.includes("Outline"), true);
  assert.equal(html.includes("Figures"), true);
  assert.equal(html.includes("Tables"), true);
  assert.equal(html.includes("Results / Methods"), true);
  assert.equal(html.includes("Reviews"), true);
  assert.equal(html.includes('data-blueprint-anchor="section-2-calibration-result"'), true);
  assert.equal(html.includes('id="section-2-calibration-result"'), true);
  assert.equal(html.includes("Figure F000001: Calibration Map"), true);
  const sectionAnchorIndex = html.indexOf('id="section-2-calibration-result"');
  assert.equal(sectionAnchorIndex >= 0, true);
  assert.equal(html.indexOf("Figure F000001: Calibration Map", sectionAnchorIndex) > sectionAnchorIndex, true, "figure block should be nested after its manuscript section");
  assert.equal(html.includes("Table T000001: Evidence Matrix"), true);
  assert.equal(html.includes("<td>C1</td>"), true);
  assert.equal(html.includes("Result R000001: Benchmark Summary"), true);
  assert.equal(html.includes("Evidence reviewer"), true);
  assert.equal(html.includes("Old evidence reviewer"), false, "blueprint inspector should not show older trial reviews when active trial reviews exist");
  assert.equal(html.includes("Later evidence reviewer"), false, "blueprint inspector should prefer active trial reviews over later historical reviews when active reviews exist");
  assert.equal(html.includes('data-inline-fullscreen="research_trajectory/trials/000002_active/reviews/EVIDENCE_REVIEW.md"'), true);

  const historicalHtml = app.run(`__blueprintInspectorProbe(${JSON.stringify(payload)}, ${JSON.stringify(manuscript)}, ${JSON.stringify(reviews)}, ${JSON.stringify({
    status: "running",
    mode: "goal",
    active_run: { running: true, trial_iteration: 4 },
  })})`);
  assert.equal(historicalHtml.includes("Later evidence reviewer"), true, "blueprint inspector should fall back to the highest reviewed trial when the active trial has no saved reviews");
  assert.equal(historicalHtml.includes("Evidence reviewer"), false);

  const emptyReviewHtml = app.run(`__blueprintInspectorProbe(${JSON.stringify(payload)}, ${JSON.stringify(manuscript)}, [], ${JSON.stringify({
    status: "running",
    mode: "goal",
    active_run: { running: true, trial_iteration: 4 },
  })})`);
  assert.equal(emptyReviewHtml.includes("No saved reviews for Trial 4 yet."), true);

  const fallbackHtml = app.run(`__blueprintInspectorProbe(${JSON.stringify(payload)}, ${JSON.stringify({ architecture: [], inline_artifacts: [], toc: "" })}, [])`);
  assert.equal(fallbackHtml.includes('data-blueprint-anchor="section-2-calibration-result"'), true, "blueprint inspector should fall back to rendered markdown headings when server summary is empty");
  assert.equal(fallbackHtml.includes("Figure F000001: Calibration Map"), true);
  assert.equal(fallbackHtml.includes("Table T000001: Evidence Matrix"), true);
  assert.equal(fallbackHtml.includes("Result R000001: Benchmark Summary"), true);
  assert.equal(fallbackHtml.includes("From BLUEPRINT.md"), true);

  const genericHtml = app.run(`__inlineEditorProbe(${JSON.stringify({
    path: "PROJECT.md",
    exists: true,
    kind: "markdown",
    editable: true,
    text: "# Project\\n\\nReady."
  })})`);
  assert.equal(genericHtml.includes("blueprint-inspector"), false, "ordinary markdown previews should not render the blueprint sidebar");
}

function testFileViewerResizeZonesRespectDragAxis() {
  const app = loadAppContext();
  let state = app.run('__fileViewerResizeProbe("right", 120, 90, 900, 680)');
  assert.equal(state.width, "1020px", "right resize zone should change width");
  assert.equal(state.height, "680px", "right resize zone should preserve height");
  assert.equal(state.axis, "right");
  assert.equal(state.activeAxis, "", "resize axis should be cleared after pointerup");
  assert.equal(state.resizing, false);
  assert.equal(state.captured, 42);
  assert.equal(state.released, 42);
  assert.deepEqual(JSON.parse(state.persisted), { width: 1020, height: 680 });

  state = app.run('__fileViewerResizeProbe("bottom", 120, 90, 900, 680)');
  assert.equal(state.width, "900px", "bottom resize zone should preserve width");
  assert.equal(state.height, "770px", "bottom resize zone should change height");
  assert.equal(state.axis, "bottom");
  assert.deepEqual(JSON.parse(state.persisted), { width: 900, height: 770 });

  state = app.run('__fileViewerResizeProbe("corner", 120, 90, 900, 680)');
  assert.equal(state.width, "1020px", "corner resize zone should change width");
  assert.equal(state.height, "770px", "corner resize zone should change height");
  assert.equal(state.axis, "corner");
  assert.deepEqual(JSON.parse(state.persisted), { width: 1020, height: 770 });
}

function testManuscriptPanelRendersPaperFiguresTablesAndTraceability() {
  const app = loadAppContext();
  const payload = {
    target: "Nature Machine Intelligence",
    article_type: "Perspective",
    contribution: "A finished result map for calibrated safety.",
    evidence_standard: "Reviewed evidence only.",
    core_story: "A manuscript story.",
    toc: [
      "- [Section 2: Calibration result](#section-2-calibration-result)",
      "  - [Figure F000001: Calibration Map](#figure-f000001-calibration-map)"
    ].join("\n"),
    architecture: [{
      title: "Abstract",
      level: 3,
      kind: "section",
      is_artifact: false,
      body: [
        "Target-venue role: Summarize the paper in the target venue style.",
        "Section brief: The abstract gives the reader a finished overview of the contribution, evidence posture, and implication.",
        "Reader question answered: What is the contribution and evidence posture?",
        "Local thesis / purpose: The abstract states the calibrated-safety contribution.",
        "Local claims in plain language: The manuscript advances one bounded claim.",
        "Local evidence, results, or artifacts: Evidence E1 supports the scope.",
        "Placed displays / methods / results: none.",
        "Local qualifications: scoped to reviewed evidence.",
        "Transition job: opens the manuscript.",
        "Paragraph plan:",
        "",
        "| Para | Rhetorical move | Content to cover, not full prose | Local evidence / result / artifact | Display / method / result block | Citation posture | Required qualification | Transition job |",
        "|---|---|---|---|---|---|---|---|",
        "| A1 | Frame contribution | State the problem, contribution, evidence posture, and implication. | E1 | none | target venue abstract style | bounded claim | open paper |"
      ].join("\n")
    }, {
      title: "Section 2: Calibration result",
      level: 3,
      kind: "section",
      is_artifact: false,
      body: [
        "Target-venue role: Results-like argument.",
        "Section brief: This section states the calibration result, anchors it in accepted evidence, and places the figure at the moment the reader needs it.",
        "Reader question answered: What result should the reader take away?",
        "Local thesis / purpose: Calibration changes the observed outcome in the accepted evidence.",
        "Local claims in plain language: The local claim is understandable without opening an ID map.",
        "Local evidence, results, or artifacts: Evidence E1 supports the local result.",
        "Placed displays / methods / results: Figure F000001.",
        "Local qualifications: none.",
        "Transition job: sets up interpretation.",
        "Paragraph plan:",
        "",
        "| Para | Rhetorical move | Content to cover, not full prose | Local evidence / result / artifact | Display / method / result block | Citation posture | Required qualification | Transition job |",
        "|---|---|---|---|---|---|---|---|",
        "| P1 | State result | Put the calibration result beside Figure F000001. | E1 and `research_trajectory/CURRENT_FINDINGS.md` | Figure F000001 | cite source trial | none | sets up interpretation |"
      ].join("\n")
    }, {
      title: "Figure F000001: Calibration Map",
      level: 4,
      kind: "figure",
      is_artifact: true,
      path: "Section 2: Calibration result / Figure F000001: Calibration Map",
      body: [
        "Placement: Section 2 paragraph P1.",
        "Inclusion status: active",
        "Purpose or result role: Shows the calibration map at the point of use.",
        "Reader takeaway: The figure is the manuscript's compact visual result.",
        "Content and panel layout: Two-panel conceptual display.",
        "Visual style: restrained.",
        "Caption draft or current caption: Calibration map caption.",
        "Source artifact or spec path: `manuscript/figures/calibration_map.pdf`",
        "Result shown or conceptual basis: Evidence E1.",
        "Provenance links: `research_trajectory/CURRENT_FINDINGS.md`",
        "Target-venue fit rationale: Fits a compact result-led display.",
        "Remaining blocker: none."
      ].join("\n")
    }, {
      title: "Table T000001: Evidence Matrix",
      level: 4,
      kind: "table",
      is_artifact: true,
      path: "Section 2: Calibration result / Table T000001: Evidence Matrix",
      body: [
        "Placement: Section 2 paragraph P2.",
        "Inclusion status: active",
        "Purpose or result role: Provides the manuscript-ready evidence matrix.",
        "Reader takeaway: The table lets readers inspect the accepted evidence mapping.",
        "Table number/title: Table 1. Evidence matrix.",
        "Publication-ready table:",
        "",
        "| Claim | Evidence | Readiness |",
        "|---|---|---|",
        "| Calibration claim | Source audit E1 | Ready |",
        "Caption draft or current caption: Table 1. Evidence matrix for the calibration claim.",
        "Table notes / definitions / abbreviations: E1 denotes the accepted source audit.",
        "Source artifact or spec path: `manuscript/tables/evidence_matrix.csv`",
        "Key result or conceptual contrast shown: The claim is tied to reviewed evidence.",
        "Provenance links: `research_trajectory/CURRENT_FINDINGS.md`",
        "Target-venue fit rationale: Compact enough for the main text.",
        "Remaining blocker: none."
      ].join("\n")
    }],
    claims: [],
    sections: [],
    figure_plans: [],
    table_plans: [],
    no_table_rationale: "No active tables are present because the current evidence is figure-led.",
    provenance: "Claim C1 maps to calibration evidence E1.",
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
  assert.equal(html.includes("manuscript-export-bar"), true);
  assert.equal(html.includes("Download BLUEPRINT.md"), true);
  assert.equal(html.includes('data-download-single-file="manuscript/BLUEPRINT.md"'), true);
  assert.equal(html.includes("Download blueprint pack"), true);
  assert.equal(html.includes("Download final project pack"), true);
  assert.equal(html.indexOf("manuscript-export-bar") < html.indexOf("context-card"), true, "export controls should render before manuscript context cards");
  assert.equal(html.includes("Manuscript story map"), true);
  assert.equal(html.includes("manuscript-story-map"), true);
  assert.equal(html.includes("Finished-results blueprint"), true);
  assert.equal(html.includes("Paper flow"), true);
  assert.equal(html.includes("Nature Machine Intelligence"), true);
  assert.equal(html.includes("Perspective"), true);
  assert.equal(html.includes("Audit / provenance"), true);
  assert.equal(html.indexOf("manuscript-story-map") < html.indexOf("Audit / provenance"), true, "story map should render before audit and raw file sections");
  assert.equal(html.includes("manuscript-abstract-card"), true);
  assert.equal(html.includes("architecture-field-list"), true);
  assert.equal(html.includes("architecture-field-row is-long"), true);
  assert.equal(html.includes("paragraph-plan-scroll"), true);
  assert.equal(html.includes("paper-field-grid architecture-field-grid"), false);
  assert.equal(html.includes("Main takeaway"), true);
  assert.equal(html.includes("What this section says"), true);
  assert.equal(html.includes("Evidence / results"), true);
  assert.equal(html.includes("Why here"), true);
  assert.equal(html.includes("This section states the calibration result"), true);
  assert.equal(html.includes("Frame contribution"), true);
  assert.equal(html.includes("Section 2: Calibration result"), true);
  assert.equal(html.includes("Structured fields"), true);
  assert.equal(html.includes("Paragraph plan"), true);
  assert.equal(html.includes("Rhetorical move"), true);
  assert.equal(html.includes("Put the calibration result beside Figure F000001."), true);
  assert.equal(html.includes("Figure block"), true);
  assert.equal(html.indexOf("Section 2: Calibration result") < html.indexOf("Figure block"), true, "inline figure block should render in manuscript order");
  assert.equal(html.includes("manuscript-artifact-card"), true);
  assert.equal(html.includes("Figure F000001: Calibration Map"), true);
  assert.equal(html.includes("active"), true);
  assert.equal(html.includes("Shows the calibration map at the point of use."), true);
  assert.equal(html.includes("compact visual result"), true);
  assert.equal(html.includes("Calibration map caption"), true);
  assert.equal(html.includes("Copy block"), true);
  assert.equal(html.includes("Copy caption"), true);
  assert.equal(html.includes("Open source"), true);
  assert.equal(html.includes("manuscript/figures/calibration_map.pdf"), true);
  assert.equal(html.includes("No active tables are present because the current evidence is figure-led."), true);
  assert.equal(html.includes("Claim C1 maps to calibration evidence E1."), true);
  assert.equal(html.includes("Figure descriptions"), false);
  assert.equal(html.includes("manuscript-table-card"), true);
  assert.equal(html.includes("Table block"), true);
  assert.equal(html.includes("Calibration claim"), true);
  assert.equal(html.includes("Table 1. Evidence matrix for the calibration claim."), true);
  assert.equal(html.includes("E1 denotes the accepted source audit."), true);
  assert.equal(html.includes("table-missing-warning"), false);

  const missingTableHtml = app.run(`__renderManuscriptPanelProbe(${JSON.stringify({
    architecture: [{
      title: "Table T000002: Missing Body",
      level: 4,
      kind: "table",
      is_artifact: true,
      body: "Placement: Section 3.\nInclusion status: active\nPurpose or result role: summarize evidence.\nCaption draft or current caption: Missing body caption."
    }],
    toc: "",
    figure_specs: [],
    table_plans: []
  })})`);
  assert.equal(missingTableHtml.includes("table-missing-warning"), true);
  assert.equal(missingTableHtml.includes("Missing publication-ready table body"), true);
}

function testNavigationStatePersistsPanelAndScroll() {
  const app = loadAppContext();
  const state = app.run(`
    appState.summaries = {
      manuscript: {
        target: "Nature Machine Intelligence",
        contribution: "Perspective",
        core_story: "A finished-results paper map.",
        architecture: [{
          title: "Section 1: Result logic",
          level: 3,
          body: "Section brief: This section explains the final result and why it appears here.\\nLocal thesis / purpose: The section carries the main result.\\nLocal claims in plain language: The claim is reader-facing.\\nLocal evidence, results, or artifacts: Reviewed evidence supports it.\\nPlaced displays / methods / results: none.\\nTransition job: moves to limits."
        }]
      }
    };
    const main = document.querySelector(".main-stage");
    main.scrollTop = 640;
    setPanel("manuscript");
    main.scrollTop = 720;
    persistActiveViewScrollPosition();

    activeView = "chat";
    activePanel = "resources";
    main.scrollTop = 0;
    restoreNavigationState();
    renderRailVisibility();
    renderContext();

    ({
      activeView,
      activePanel,
      scrollTop: main.scrollTop,
      storedPanel: localStorage.getItem(scopedStorageKey("activeNavigationPanel")),
      storedScroll: localStorage.getItem(scopedStorageKey("viewScroll:manuscript")),
      chatActive: document.querySelector("#chat-view").classList.contains("is-active"),
      materialActive: document.querySelector("#material-view").classList.contains("is-active")
    });
  `);
  assert.equal(state.storedPanel, "manuscript", "material panel selection should be stored project-locally");
  assert.equal(state.activeView, "materials", "refresh restore should reopen the material view");
  assert.equal(state.activePanel, "manuscript", "refresh restore should reopen the last material panel");
  assert.equal(state.materialActive, true, "material view should be active after restore");
  assert.equal(state.chatActive, false, "Agents view should not stay active after restoring a material panel");
  assert.equal(state.storedScroll, "720", "active material scroll position should be persisted");
  assert.equal(state.scrollTop, 720, "material panel scroll position should be restored after re-render");
}

testButtonInventoryHasHandlers();
testNavigationStatePersistsPanelAndScroll();
await testImmediateUserMessage();
await testAttachmentOnlyMessage();
await testResumeFromTrialRequiresConfirmationAndSendsPayload();
await testPrepareSubmitWithResumeContextSendsResumePayload();
await testResumeFromTrialCancelPreservesComposer();
await testResumeTrialSlashCommandIsBlocked();
await testFailedSessionSendRestoresComposerState();
await testSuccessfulSessionSendClearsComposerDraft();
await testSlashCommandVisibleAndIgnoredAsUnanswered();
await testRestartCommandRequiresConfirmationAndSendsRestartEndpoint();
await testRestartCancelPreservesComposer();
testStaleOverviewDoesNotSwallowPendingUser();
testTranscriptRecoveryUsesOnlyFinalAssistant();
await testEditTruncatesLaterConversationBeforeResend();
await testLaunchGoalMessageBeforeBackendWork();
testStartAutoresearchOnlyAppearsOnProjectDraftCard();
testMessagesExposeCopyButtons();
testFileTreePdfPreviewControls();
testSessionTimelineDoesNotRenderCurrentActivityCard();
testPassedGoalDoesNotShowStaleRunningTrial();
testCurrentRunActivityShowsPauseForChatRun();
testWorkingDurationFormatter();
testTrialStripScrollRestoresAcrossRender();
testRunningTrialUsesProgressFallback();
testStatusCardShowsReviewCheckpoint();
testReviewStorageOutdatedDoesNotShowProjectWarning();
testReviewsPanelGroupsByTrial();
testComposerPlaceholderBecomesGeneralAfterLaunch();
testUncreatedTrialMentionDoesNotCreateTimelineTrial();
testSettingsRenderPreservesComposerDraft();
testProjectScopedSessionSettingsOverrideServerDefaults();
testComposerModelReasoningChangesPersistProjectScoped();
testAgentBackendSelectorPersistsProviderSettings();
await testProjectCreateSendsBackendAndLoadsProjectDefault();
testAgentReadinessStatusBlocksLaunchUi();
testEnvForcedBackendStatusMessage();
testInvalidEnvBackendStatusWarning();
testProviderSpecificResumeCommand();
await testSettingsModalSaveSyncsScopedSessionSettings();
testProjectScopedComposerDraftAndTargetVenueRestore();
testThemeModePersistsAndApplies();
testTargetVenueUsesOnlyProjectScopedDraft();
testMaterialTypeChipsUseLocalBrowserAndPlusUsesFilePicker();
await testLargeBrowserUploadsUseResourceCopyFlow();
testCompactComposerAutosizesFromCenteredBase();
testComposerPromptInsertionIsIdempotent();
await testCopyTextHelperWritesClipboard();
await testExportBundleFlow();
testBlueprintInspectorRendersSidebarForLatestManuscriptOnly();
testFileViewerResizeZonesRespectDragAxis();
testManuscriptPanelRendersPaperFiguresTablesAndTraceability();

console.log("UI flow test passed.");
