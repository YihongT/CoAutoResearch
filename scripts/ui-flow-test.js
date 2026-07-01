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
    const listeners = new Map();
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
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(callback);
      },
      dispatchEvent(event) {
        const callbacks = listeners.get(event?.type) || [];
        callbacks.forEach((callback) => callback(event));
      },
      appendChild(child) {
        if (child && typeof child === "object") child.parentElement = this;
        return child;
      },
      insertAdjacentElement(_position, child) {
        if (child && typeof child === "object") child.parentElement = this.parentElement || this;
        return child;
      },
      remove() {},
      select() {},
      focus() {},
      setAttribute(name, value) { this[name] = String(value); },
      getAttribute(name) { return this[name]; },
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
  const briefComposerRow = element();
  const coldEditorWorkbench = element({
    querySelector(selector) {
      return selector === ".brief-composer-row" ? briefComposerRow : null;
    },
  });
  const projectEditor = element({ value: "# Project\n\nReady." });
  const composerFileInput = element({
    clickCount: 0,
    click() {
      this.clickCount += 1;
    },
  });
  const composerAttachButton = element({
    getBoundingClientRect() {
      return { left: 350, top: 720, right: 390, bottom: 760, width: 40, height: 40 };
    },
    closest(selector) {
      return selector === "#composer-attach-button" ? this : null;
    },
  });
  const planModeChip = element({
    click() {
      this.dispatchEvent({ type: "click", target: this });
    },
  });
  const chatPlanModeChip = element({
    click() {
      this.dispatchEvent({ type: "click", target: this });
    },
  });
  const attachmentMenu = element({ hidden: true, offsetHeight: 114 });
  const resumeCommandBar = element({ hidden: true });
  const resumeCommandLabel = element();
  const resumeCommandText = element();
  const copyResumeCommand = element();
  const framingThread = element({
    clientHeight: 600,
    scrollHeight: 1200,
    scrollTop: 0,
    scrollTo(options) {
      this.scrollTop = Number(options?.top || 0);
    },
    contains(target) {
      return target === this;
    },
  });
  const briefEditorShell = element({ parentElement: null });
  const coldStartWorkspace = element();
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
  const agentSetupDialog = element({
    close() { this.closed = true; this.open = false; },
    showModal() { this.open = true; this.closed = false; },
  });
  const agentSetupTitle = element();
  const agentSetupIntro = element();
  const agentSetupGrid = element();
  const agentSetupCreateProject = element({ hidden: true });
  const agentSetupSettings = element();
  const agentSetupRecheck = element();
  const projectDialog = element({
    close() { this.closed = true; },
    showModal() { this.open = true; },
  });
  const restartDialog = element({
    close() { this.closed = true; },
    showModal() { this.open = true; },
  });
  const resumeAutoresearchDialog = element({
    close() { this.closed = true; this.open = false; },
    showModal() { this.open = true; this.closed = false; },
  });
  const resumeAutoresearchSummary = element();
  const resumeAutoresearchInstruction = element();
  const resumeAutoresearchConfirm = element();
  const largeImportDialog = element({
    close() { this.closed = true; this.open = false; },
    showModal() { this.open = true; },
  });
  const exportConfirmDialog = element({
    close() { this.closed = true; this.open = false; },
    showModal() { this.open = true; this.closed = false; },
  });
  const settingsDialog = element({
    _rect: { width: 1180, height: 820 },
    close() { this.closed = true; this.open = false; },
    showModal() { this.open = true; this.closed = false; },
    getBoundingClientRect() {
      return {
        width: Number.parseFloat(this.style.width) || this._rect.width,
        height: Number.parseFloat(this.style.height) || this._rect.height,
      };
    },
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
      themeMode: field("atelier-ivory"),
      settingsBackend: field("codex"),
      settingsModel: field("gpt-5.5"),
      settingsReasoningEffort: field("medium"),
      settingsPermissionPreset: field("default"),
      settingsWebSearch: field("", { checked: true }),
      settingsExtraConfig: field(""),
      settingsReviewCheckpointInterval: field("100"),
      settingsCodexProvider: field("cli"),
      settingsCodexApiKey: field(""),
      settingsClaudeProvider: field("external"),
      settingsClaudeApiKey: field(""),
      settingsClaudeBaseUrl: field(""),
      settingsClaudeAuthMethod: field("ANTHROPIC_AUTH_TOKEN"),
      settingsClaudeCredential: field(""),
      settingsClaudeSonnetModel: field(""),
      settingsClaudeOpusModel: field(""),
      settingsClaudeHaikuModel: field(""),
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
  const resourceBrowserEyebrow = element();
  const resourceBrowserTitle = element();
  const codexProviderField = element();
  const codexApiKeySettings = element({ hidden: true });
  const codexApiKeyStatus = element();
  const codexApiKeyClear = element({ hidden: true, dataset: {} });
  const claudeProviderField = element();
  const claudeApiKeySettings = element({ hidden: true });
  const claudeApiKeyStatus = element();
  const claudeApiKeyClear = element({ hidden: true, dataset: {} });
  const claudeGatewaySettings = element({ hidden: true });
  const claudeCredentialStatus = element();
  const claudeCredentialClear = element({ hidden: true, dataset: {} });
  [
    ["#cold-file-editor", coldEditor],
    ["#launch-files", element()],
    ["#cold-file-tabs", element()],
    ["#cold-editor-title", element()],
    ["#cold-editor-path", element()],
    ["#cold-save-status", element()],
    ["#cold-file-preview", element()],
    ["#cold-editor-workbench", coldEditorWorkbench],
    [".brief-composer-row", briefComposerRow],
    ["#project-loading-state", element()],
    ["#project-loading-eyebrow", element()],
    ["#project-loading-title", element()],
    ["#project-loading-detail", element()],
    ["#project-loading-retry", element({ hidden: true })],
    ["#project-list", element()],
    [".main-stage", mainStage],
    [".chat-header", element()],
    ["#chat-view", chatView],
    ["#material-view", materialView],
    ["#material-title", element()],
    ["#context-content", contextContent],
    ["#brief-attachment-tray", element()],
    ["#chat-attachment-tray", element()],
    ["#composer-file-input", composerFileInput],
    ["#composer-attach-button", composerAttachButton],
    ["[data-plan-mode-toggle]", planModeChip],
    ["#attachment-menu", attachmentMenu],
    ["#resource-browser-title", resourceBrowserTitle],
    [".local-browser-head .eyebrow", resourceBrowserEyebrow],
    [".trial-strip-scroll", trialStripScroll],
    ["#project-draft-editor", projectEditor],
    ["#target-venue", element()],
    ["#framing-thread", framingThread],
    ["#brief-editor-shell", briefEditorShell],
    ["#brief-editor-anchor", element()],
    ["#framing-scroll-bottom", element()],
    ["#cold-start-workspace", coldStartWorkspace],
    ["#framing-project-panel", element()],
    ["#chat-eyebrow", element()],
    ["#chat-title", element()],
    ["#session-pill", element()],
    ["#chat-form textarea", element()],
    ["#chat-form .send-button", element()],
    ["#continue-research", element()],
    ["#prepare-cold-start", element()],
    ["#open-launch-dialog", element()],
    ["#open-launch-dialog-inline", element()],
    ["#composer-suggestions", element()],
    ["#launch-dialog", launchDialog],
    ["#launch-autoresearch", element()],
    ["#launch-agent-status", element()],
    ["#launch-instruction", element()],
    ["#agent-setup-dialog", agentSetupDialog],
    ["#agent-setup-title", agentSetupTitle],
    ["#agent-setup-intro", agentSetupIntro],
    ["#agent-setup-grid", agentSetupGrid],
    ["[data-agent-setup-create-project]", agentSetupCreateProject],
    ["[data-agent-setup-settings]", agentSetupSettings],
    ["[data-agent-setup-recheck]", agentSetupRecheck],
    ["#project-dialog", projectDialog],
    ["#project-create-form", projectCreateForm],
    ["#project-name", projectCreateForm.elements.projectName],
    ["#project-agent-backend", projectCreateForm.elements.agentBackend],
    ["#project-agent-backend-note", element()],
    ["#project-create-note", element()],
    ["#restart-autoresearch-dialog", restartDialog],
    ["#restart-autoresearch-reason", element()],
    ["#resume-autoresearch-dialog", resumeAutoresearchDialog],
    ["#resume-autoresearch-summary", resumeAutoresearchSummary],
    ["#resume-autoresearch-instruction", resumeAutoresearchInstruction],
    ["[data-resume-autoresearch-confirm]", resumeAutoresearchConfirm],
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
    ["#settings-dialog", settingsDialog],
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
    ["#resume-command-bar", resumeCommandBar],
    ["#resume-command-label", resumeCommandLabel],
    ["#resume-command-text", resumeCommandText],
    ["#copy-resume-command", copyResumeCommand],
    ["#sync-state", element()],
    ["#browser-roots", element()],
    ["#browser-current-path", element()],
    ["#browser-up", element()],
    ["#browser-add-current", element()],
    ["#browser-search", element()],
    ["#browser-jump", element()],
    ["#browser-note", element()],
    ["#browser-entries", element()],
    ["#settings-secret-grid", element()],
    ["#settings-agent-status", element()],
    ["#codex-api-key-settings", codexApiKeySettings],
    ["#settings-codex-api-key-status", codexApiKeyStatus],
    ["#settings-codex-api-key-clear", codexApiKeyClear],
    ["#claude-api-key-settings", claudeApiKeySettings],
    ["#settings-claude-api-key-status", claudeApiKeyStatus],
    ["#settings-claude-api-key-clear", claudeApiKeyClear],
    ["#claude-gateway-settings", claudeGatewaySettings],
    ["#settings-claude-credential-status", claudeCredentialStatus],
    ["#settings-claude-credential-clear", claudeCredentialClear],
  ].forEach(([selector, value]) => elements.set(selector, value));

  const eventSources = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      this.listeners = new Map();
      eventSources.push(this);
    }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    emit(type, payload = {}) {
      const event = type === "research" || type === "message"
        ? { data: JSON.stringify(payload) }
        : payload;
      (this.listeners.get(type) || []).forEach((callback) => callback(event));
      const handler = this[`on${type}`];
      if (typeof handler === "function") handler(event);
    }
    close() {
      this.closed = true;
    }
  }

  const context = {
    console,
    URL,
    URLSearchParams,
    EventSource: FakeEventSource,
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
    FileReader: class FileReader {
      readAsDataURL(file) {
        this.result = `data:${file?.type || "application/octet-stream"};base64,${file?.contentBase64 || ""}`;
        if (typeof this.onload === "function") this.onload();
      }
    },
    window: {
      location: { search: "?project=p1", origin: "http://localhost" },
      origin: "http://localhost",
      innerWidth: 1400,
      innerHeight: 900,
      confirm(message) {
        context.__confirmMessages.push(String(message || ""));
        return context.__confirmNext !== false;
      },
      addEventListener() {},
      setTimeout,
      clearTimeout,
      scrollTo() {},
    },
    document: {
      body: element(),
      documentElement: {
        scrollHeight: 0,
        clientHeight: 0,
        dataset: {},
        style: {
          setProperty(name, value) { this[name] = String(value); },
          removeProperty(name) { delete this[name]; },
        },
      },
      getElementById(id) {
        return elements.get(`#${id}`) || null;
      },
      querySelector(selector) {
        if (selector === ".brief-editor-shell.is-framing-dock") {
          return briefEditorShell.classList.contains("is-framing-dock") ? briefEditorShell : null;
        }
        if (selector === "#cold-start-workspace.has-framing-thread .framing-thread") {
          return coldStartWorkspace.classList.contains("has-framing-thread") && !framingThread.hidden ? framingThread : null;
        }
        return elements.get(selector) || null;
      },
      querySelectorAll(selector) {
        if (selector === ".rail-action") return railActions;
        if (selector === "[data-plan-mode-toggle]") return [planModeChip, chatPlanModeChip];
        if (selector === "[data-codex-provider-field]") return [codexProviderField];
        if (selector === "[data-claude-provider-field]") return [claudeProviderField];
        return [];
      },
      createElement() {
        const created = element();
        Object.defineProperty(created, "id", {
          get() { return this.__id || ""; },
          set(value) {
            this.__id = String(value || "");
            if (this.__id) elements.set(`#${this.__id}`, this);
          },
          configurable: true,
        });
        return created;
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
    sessionStorage: {
      getItem(key) { return storage.has(`session:${key}`) ? storage.get(`session:${key}`) : null; },
      setItem(key, value) { storage.set(`session:${key}`, String(value)); },
      removeItem(key) { storage.delete(`session:${key}`); },
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
  context.window.EventSource = FakeEventSource;
  context.__eventSources = eventSources;
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
    globalThis.__confirmMessages = [];
    globalThis.__confirmNext = true;
    globalThis.__renderCount = 0;
    globalThis.__persistCount = 0;
    globalThis.__scrollCount = 0;
    globalThis.__loadOverviewCalls = [];
    globalThis.__browserOpenCount = 0;
    globalThis.__browserOpenCategory = "";
    globalThis.__browserOpenMode = "";
    globalThis.__browserOpenEditMessageId = "";
    globalThis.__collectSeen = null;
    globalThis.__toastMessages = [];
    activeProjectId = "p1";
    activeView = "chat";
    projectLoadPhase = "ready";
    projectLoadError = "";
    appState = {
      project: { id: "p1", display_name: "project" },
      projects: [{ id: "p1", display_name: "project" }],
      active_project_id: "p1",
      runtime: { remote: false },
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
    renderProjectLoadingState();
    globalThis.__renderFramingConversationImpl = renderFramingConversation;
    globalThis.__loadOverviewImpl = loadOverview;
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
    globalThis.__renderResumeCommandBarImpl = renderResumeCommandBar;
    globalThis.__renderComposerSuggestionsImpl = renderComposerSuggestions;
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
    showResourceBrowser = (options = {}) => {
      globalThis.__browserOpenCount += 1;
      globalThis.__browserOpenCategory = activeResourceCategory;
      globalThis.__browserOpenMode = options.mode || "default";
      globalThis.__browserOpenEditMessageId = options.editMessageId || "";
    };
    showToast = (message, error = false) => { globalThis.__toastMessages.push({ message, error }); };
    openProjectCreateDialog = () => {};
    setColdViewMode = () => {};
    markPrepareSaved = () => {};
    renderStage = () => {};
    loadOverview = async (silent = false) => { globalThis.__loadOverviewCalls.push(silent); };
    saveProjectDraft = async () => {};
    startFramingRun = async (brief, options = {}) => {
      globalThis.__startedFramingBrief = brief;
      globalThis.__startedFramingOptions = options;
      appState.research_session = { ...appState.research_session, mode: "framing", status: "running" };
      return { ok: true };
    };
    collectUploadFiles = async (items = selectedUploadItems) => {
      globalThis.__collectSeen = {
        messages: globalThis.__messages(),
        editorValue: document.querySelector("#cold-file-editor")?.value || "",
        renderCount: globalThis.__renderCount,
      };
      if (globalThis.__collectPromise) return globalThis.__collectPromise;
      if (items !== selectedUploadItems && Array.isArray(items) && items.length) {
        return items
          .filter((item) => item.file)
          .map((item) => ({
            category: item.category,
            name: item.name,
            relativePath: item.name,
            contentBase64: item.file.contentBase64 || "",
          }));
      }
      return [];
    };
    api = async (endpoint, options = {}) => {
      if (globalThis.__apiError) throw new Error(globalThis.__apiError);
      const body = options.body ? JSON.parse(options.body) : {};
      globalThis.__apiCalls.push({ endpoint, body, method: options.method || "GET" });
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
          ...(endpoint === "/api/research/plan" ? {
            plan: {
              id: "P_test",
              provider: "codex",
              model: "gpt-5.5",
              status: "running",
              plan_text: "",
              steps: [],
            },
          } : {}),
          session: {
            id: "s2",
            session_id: "sid",
            status: "running",
            mode: endpoint.includes("command") ? "command" : endpoint === "/api/research/plan" ? "plan" : "chat",
            started_at: "2026-06-17T10:01:00.000Z",
            transcript: [],
            latest_plan: endpoint === "/api/research/plan"
              ? {
                  id: "P_test",
                  provider: "codex",
                  model: "gpt-5.5",
                  status: "running",
                  plan_text: "",
                  steps: [],
                }
              : {}
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
      mode: message.mode || "",
      revisePlanId: message.revisePlanId || "",
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
      settingsNote: document.querySelector("#settings-agent-status")?.innerHTML || document.querySelector("#settings-agent-status")?.textContent || "",
      settingsTone: document.querySelector("#settings-agent-status")?.dataset?.tone || "",
      launchNote: document.querySelector("#launch-agent-status")?.innerHTML || document.querySelector("#launch-agent-status")?.textContent || "",
      launchTone: document.querySelector("#launch-agent-status")?.dataset?.tone || "",
      projectNote: document.querySelector("#project-agent-backend-note")?.innerHTML || document.querySelector("#project-agent-backend-note")?.textContent || "",
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
    globalThis.__composerActionButtonsProbe = () => {
      renderComposerActionButtons();
      const cold = document.querySelector("#prepare-cold-start");
      const chat = document.querySelector("#chat-form .send-button");
      return {
        coldStopMode: cold?.dataset?.stopMode || "",
        coldClass: cold?.classList?.toString?.() || "",
        coldDisabled: Boolean(cold?.disabled),
        chatStopMode: chat?.dataset?.stopMode || "",
        chatClass: chat?.classList?.toString?.() || "",
        chatDisabled: Boolean(chat?.disabled),
      };
    };
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
        pendingEditMessageId: input?.dataset?.editMessageId || "",
        clicks: input?.clickCount || 0,
      };
    };
    globalThis.__attachmentMenuState = () => {
      const menu = document.querySelector("#attachment-menu");
      const button = document.querySelector("#composer-attach-button");
      return {
        ...globalThis.__filePickerState(),
        hidden: menu?.hidden ?? true,
        parentIsBody: menu?.parentElement === document.body,
        left: menu?.style?.left || "",
        top: menu?.style?.top || "",
        bottom: menu?.style?.bottom || "",
        width: menu?.style?.width || "",
        uploadSourceHidden: uploadSourceMenu?.hidden ?? true,
        uploadSourceLeft: uploadSourceMenu?.style?.left || "",
        uploadSourceTop: uploadSourceMenu?.style?.top || "",
        expanded: button?.getAttribute?.("aria-expanded") || button?.["aria-expanded"] || "",
        browserOpenCount: globalThis.__browserOpenCount,
        browserOpenCategory: globalThis.__browserOpenCategory,
        browserOpenMode: globalThis.__browserOpenMode,
        browserOpenEditMessageId: globalThis.__browserOpenEditMessageId,
      };
    };
    globalThis.__toggleAttachmentMenuProbe = () => {
      toggleAttachmentMenu();
      return globalThis.__attachmentMenuState();
    };
    globalThis.__bodyClickAttachmentButtonProbe = () => {
      const event = {
        type: "click",
        target: document.querySelector("#composer-attach-button"),
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
      };
      document.body.dispatchEvent(event);
      return { ...globalThis.__attachmentMenuState(), defaultPrevented: event.defaultPrevented };
    };
    globalThis.__attachmentActionProbe = (action) => {
      handleAttachmentMenuAction(action);
      return globalThis.__attachmentMenuState();
    };
    globalThis.__uploadSourceChoiceProbe = (source) => {
      handleUploadSourceChoice(source);
      return globalThis.__attachmentMenuState();
    };
    globalThis.__editUploadSourceProbe = (messageId, source) => {
      showUploadSourcePicker({ editMessageId: messageId });
      if (source) handleUploadSourceChoice(source);
      return globalThis.__attachmentMenuState();
    };
    globalThis.__closeAttachmentMenuProbe = () => {
      setAttachmentMenuOpen(false);
      return globalThis.__attachmentMenuState();
    };
    globalThis.__renderBrowserModeProbe = (mode = "default") => {
      browserSelectionMode = mode;
      renderBrowserEntries({
        path: "/remote",
        parent: "/",
        truncated: false,
        roots: [],
        entries: [
          { name: "data", path: "/remote/data", type: "directory" },
          { name: "paper.pdf", path: "/remote/paper.pdf", type: "file" }
        ]
      });
      return {
        mode: browserSelectionMode,
        title: document.querySelector("#resource-browser-title")?.textContent || "",
        eyebrow: document.querySelector(".local-browser-head .eyebrow")?.textContent || "",
        note: document.querySelector("#browser-note")?.textContent || "",
        addCurrentHidden: Boolean(document.querySelector("#browser-add-current")?.hidden),
        addCurrentDisabled: Boolean(document.querySelector("#browser-add-current")?.disabled),
        addCurrentPath: document.querySelector("#browser-add-current")?.dataset?.resourceAddPath || "",
        entriesHtml: document.querySelector("#browser-entries")?.innerHTML || "",
      };
    };
    globalThis.__browserPathClassificationProbe = (values) => values.map((value) => [value, isBrowserPathInput(value)]);
    globalThis.__browserInputProbe = async (value) => {
      globalThis.__apiCalls = [];
      globalThis.__apiHandler = async (endpoint) => ({
        ok: true,
        path: "/current",
        parent: "/",
        roots: [],
        entries: [{ name: "paper.pdf", path: "/current/paper.pdf", type: "file" }],
      });
      localBrowserPath = "/current";
      document.querySelector("#browser-search").value = value;
      handleBrowserSearchInput(value);
      await new Promise((resolve) => setTimeout(resolve, 220));
      clearTimeout(browserSearchTimer);
      const calls = globalThis.__apiCalls.map((call) => call.endpoint);
      globalThis.__apiHandler = null;
      return {
        calls,
        query: browserSearchQuery,
        searchValue: document.querySelector("#browser-search")?.value || "",
        entriesHtml: document.querySelector("#browser-entries")?.innerHTML || "",
      };
    };
    globalThis.__browserJumpProbe = async (value, responsePath = "/jumped", failMessage = "") => {
      globalThis.__apiCalls = [];
      globalThis.__toastMessages = [];
      globalThis.__apiHandler = async (endpoint) => {
        if (failMessage) throw new Error(failMessage);
        return {
          ok: true,
          path: responsePath,
          parent: "/",
          roots: [],
          entries: [{ name: "selected", path: responsePath + "/selected", type: "directory" }],
          selected_path: "",
          selected_type: "",
        };
      };
      localBrowserPath = "/current";
      document.querySelector("#browser-search").value = value;
      browserSearchQuery = value;
      await jumpLocalBrowserInput();
      clearTimeout(browserSearchTimer);
      const calls = globalThis.__apiCalls.map((call) => call.endpoint);
      globalThis.__apiHandler = null;
      return {
        calls,
        path: localBrowserPath,
        query: browserSearchQuery,
        searchValue: document.querySelector("#browser-search")?.value || "",
        entriesHtml: document.querySelector("#browser-entries")?.innerHTML || "",
        toasts: globalThis.__toastMessages,
      };
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
    globalThis.__setConfirmNext = (value) => {
      globalThis.__confirmNext = Boolean(value);
    };
    globalThis.__confirmMessageLog = () => [...globalThis.__confirmMessages];
    globalThis.__startEdit = (id) => {
      editingFramingId = id;
      editAttachmentDraftForMessage(id);
      renderFramingConversation();
      return framingMessageHtml(localMessages.find((message) => message.id === id));
    };
    globalThis.__editDraftState = (id) => {
      const draft = editAttachmentDraftForMessage(id);
      return {
        resources: draft.resources.map((item) => ({ path: item.path, category: item.category, alreadyImported: Boolean(item.alreadyImported) })),
        retained: draft.retained.map((item) => ({ name: item.name, path: item.path, category: item.category, originalKind: item.originalKind })),
        uploads: draft.uploads.map((item) => ({ name: item.name, category: item.category, size: item.size })),
      };
    };
    globalThis.__removeEditAttachment = (id, token) => {
      editingFramingId = id;
      removeEditAttachment(id, token);
      return globalThis.__editDraftState(id);
    };
    globalThis.__addEditResource = (id, path, options = {}) => {
      addEditResourcePath(id, path, options);
      return globalThis.__editDraftState(id);
    };
    globalThis.__addEditUpload = (id, file, options = {}) => {
      addEditUploadFile(id, file, options);
      return globalThis.__editDraftState(id);
    };
    globalThis.__collectEditUploads = async (id) => collectUploadFiles(editAttachmentDraftForMessage(id).uploads);
    globalThis.__editUploadHasFile = (id) => Boolean(editAttachmentDraftForMessage(id).uploads[0]?.file);
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
      activityPanelSources.clear();
      const entries = sessionTranscriptEntries();
      const activity = buildFramingActivityByMessage(localMessages, entries);
      const assistant = localMessages.find((message) => message.role === "assistant" && message.kind !== "project");
      const html = assistant ? framingMessageHtml(assistant, { activityHtml: activity.htmlBeforeMessageId.get(assistant.id) || "" }) : "";
      const source = [...activityPanelSources.values()].find((item) => String(item.subtitle || "").includes("worked activity")) || null;
      const panelHtml = source ? activityPanelHtml(source) : "";
      return {
        hasWorked: html.includes("Worked for"),
        hasActivityOpen: html.includes("data-activity-open"),
        hasInlineContainer: html.includes("inline-run-activity-summary"),
        hasInlineDetails: html.includes("<details"),
        hasPartial: html.includes("partial status"),
        hasFinal: html.includes("Final **answer**"),
        panelHasPartial: panelHtml.includes("partial status"),
        panelHasFinal: panelHtml.includes("Final **answer**"),
        sourceKeys: [...activityPanelSources.keys()],
        omittedCount: activity.omittedEntryIds.size,
      };
    };
    globalThis.__activityPanelProbe = (key = "") => {
      const sourceKey = key || [...activityPanelSources.keys()][0] || "";
      if (sourceKey) openActivityPanel(sourceKey);
      return {
        key: activeActivityPanelKey,
        hidden: Boolean(activityPanelElement?.hidden),
        bodyClass: document.body.classList.toString(),
        html: activityPanelElement?.innerHTML || "",
      };
    };
    globalThis.__messageHtml = (index = 0) => framingMessageHtml(localMessages[index]);
    globalThis.__sessionTimelineProbe = () => sessionTimelineHtml(sessionTranscriptEntries());
    globalThis.__autoresearchPanelCollapseProbe = () => ({
      collapsed: autoresearchPanelCollapsed(),
      stored: localStorage.getItem(scopedStorageKey(AUTORESEARCH_PANEL_COLLAPSED_KEY)),
      html: sessionTimelineHtml(sessionTranscriptEntries()),
    });
    globalThis.__toggleAutoresearchPanelCollapse = () => {
      toggleAutoresearchPanelCollapsed();
      return globalThis.__autoresearchPanelCollapseProbe();
    };
    globalThis.__framingThreadHtmlProbe = () => {
      const thread = $("#framing-thread");
      renderFramingConversation();
      const directMessages = visibleFramingMessagesForRender(localMessages).map((message) => framingMessageHtml(message)).join("");
      const directPanel = persistentAutoresearchPanelHtml(sessionTranscriptEntries());
      return lastFramingHtml || thread?.innerHTML || directMessages + directPanel || "";
    };
    globalThis.__autoresearchDockProbe = () => {
      globalThis.__renderFramingConversationImpl();
      return {
        dockHtml: lastAutoresearchDockHtml,
        dockHidden: Boolean(autoresearchDockElement?.hidden),
        dockClass: autoresearchDockElement?.classList?.toString?.() || autoresearchDockElement?.className || "",
        threadHtml: $("#framing-thread")?.innerHTML || "",
        bodyClass: document.body.classList.toString(),
        shellDocked: Boolean($("#brief-editor-shell")?.classList.contains("is-framing-dock")),
      };
    };
    globalThis.__thinkingProbe = () => framingThinkingHtml();
    globalThis.__progressDetailsProbe = () => framingProgressDetailsHtml();
    globalThis.__composerSuggestionsProbe = () => {
      globalThis.__renderComposerSuggestionsImpl();
      const row = document.querySelector("#composer-suggestions");
      return { hidden: Boolean(row?.hidden), html: row?.innerHTML || "", className: row?.className || "" };
    };
    globalThis.__prelaunchState = () => prelaunchAffordanceState();
    globalThis.__setProjectLoadPhase = (phase, options = {}) => {
      setProjectLoadPhase(phase, options);
      return globalThis.__projectLoadingProbe();
    };
    globalThis.__projectLoadingProbe = () => ({
      phase: projectLoadPhase,
      error: projectLoadError,
      bodyClass: document.body.classList.toString(),
      panelHidden: Boolean(document.querySelector("#project-loading-state")?.hidden),
      title: document.querySelector("#project-loading-title")?.textContent || "",
      detail: document.querySelector("#project-loading-detail")?.textContent || "",
      retryHidden: Boolean(document.querySelector("#project-loading-retry")?.hidden),
      sync: document.querySelector("#sync-state")?.textContent || "",
      coldDisabled: Boolean(document.querySelector("#cold-file-editor")?.disabled),
      coldPlaceholder: document.querySelector("#cold-file-editor")?.placeholder || "",
    });
    globalThis.__projectLaunchFallbackProbe = () => {
      const panel = document.querySelector("#project-launch-fallback");
      return {
        exists: Boolean(panel),
        hidden: Boolean(panel?.hidden),
        html: panel?.innerHTML || "",
      };
    };
    globalThis.__projectInlinePayloadProbe = () => inlineFilePayloads["PROJECT.md"] || null;
    globalThis.__latestProjectAttachmentHtml = () => {
      const latest = currentProjectDraftFooterMessage();
      return latest ? projectDraftAttachmentHtml(latest) : "";
    };
    globalThis.__queuedItems = () => queuedChatItems().map((item) => ({ ...item }));
    globalThis.__moveQueuedItem = async (id, direction) => moveQueuedChatItem(id, direction);
    globalThis.__deleteQueuedItem = async (id) => deleteQueuedChatItem(id);
    globalThis.__stopAndSendQueued = async () => handleStopAndSendQueuedComposer();
    globalThis.__progressSummaryProbe = () => {
      const entries = currentProgressEntries();
      return currentRunReadableSummary(entries);
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
    globalThis.__trialStripSelectedProbe = () => {
      __setSession({
        id: "s1",
        session_id: "sid",
        status: "completed",
        mode: "goal",
        loop_active: false,
        gate: { status: "continue" },
        transcript: []
      });
      const originalQuerySelector = document.querySelector.bind(document);
      const reviewStrip = {
        dataset: {},
        clientWidth: 300,
        scrollWidth: 1200,
        scrollLeft: 0,
        addEventListener() {},
        getBoundingClientRect: () => ({ left: 0, right: 300 }),
        querySelector: () => null,
      };
      const strip = originalQuerySelector(".trial-strip-scroll");
      strip.clientWidth = 300;
      strip.scrollWidth = 1200;
      strip.scrollLeft = 0;
      strip.getBoundingClientRect = () => ({ left: 0, right: 300 });
      const chip = {
        offsetWidth: 80,
        offsetLeft: 900,
        getBoundingClientRect: () => ({ left: 900 - strip.scrollLeft, right: 980 - strip.scrollLeft }),
      };
      strip.querySelector = (selector) => selector === '[data-trial-select="18"]' ? chip : null;
      selectedTrialIndex = 18;
      trialStripScrollState = { mode: "manual", left: 0, liveIteration: 0, selectedIteration: 18, touchedAt: Date.now() };
      document.querySelector = (selector) => {
        if (String(selector).includes("#autoresearch-dock")) return strip;
        if (selector === ".trial-strip-scroll") return reviewStrip;
        return originalQuerySelector(selector);
      };
      try {
        restoreTrialStripScroll({ selectedIteration: 18 });
        return { left: strip.scrollLeft, reviewLeft: reviewStrip.scrollLeft, state: { ...trialStripScrollState } };
      } finally {
        document.querySelector = originalQuerySelector;
      }
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
    globalThis.__autoFigureImageProbe = async (payload, options = {}) => {
      appState.summaries = { ...(appState.summaries || {}), manuscript: payload };
      activeView = "materials";
      activePanel = "manuscript";
      document.querySelector("#session-settings-form").elements.backend.value = options.backend || "codex";
      uiSettings = {
        ...(uiSettings || {}),
        agent_status: options.envOverride ? { env_override: options.envOverride } : {},
      };
      figureImageJobs.clear();
      figureImageAutoStarted.clear();
      figureImagePollTimers.forEach((timer) => clearTimeout(timer));
      figureImagePollTimers.clear();
      clearTimeout(figureImageAutoTimer);
      globalThis.__apiCalls = [];
      let title = "";
      globalThis.__apiHandler = (endpoint, body) => {
        if (endpoint === "/api/manuscript/figure-image/start") {
          title = body.title;
          return { ok: true, job: { id: "figure_job_1", title, status: "running" } };
        }
        if (endpoint.startsWith("/api/manuscript/figure-image/status")) {
          return { ok: true, job: { id: "figure_job_1", title, status: options.status || "failed", error: "fake stop" } };
        }
        return { ok: true };
      };
      renderContext();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const calls = globalThis.__apiCalls.slice();
      globalThis.__apiHandler = null;
      figureImagePollTimers.forEach((timer) => clearTimeout(timer));
      figureImagePollTimers.clear();
      return { calls, html: document.querySelector("#context-content").innerHTML };
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
        if (endpoint === "/api/export/start") return { ok: true, export: startJob || { id: "ex1", kind: body.kind, label: "Paper-Writing Pack", status: "packaging", phase: "packaging", total_bytes: estimate.total_bytes || 0, bytes_done: 0, file_count: estimate.file_count || 0, files_done: 0 } };
        if (endpoint.startsWith("/api/export/status")) return { ok: true, export: startJob || { id: "ex1", kind, label: "Paper-Writing Pack", status: "ready", phase: "ready", total_bytes: estimate.total_bytes || 0, bytes_done: estimate.total_bytes || 0, file_count: estimate.file_count || 0, files_done: estimate.file_count || 0, download_url: "/api/export/download?id=ex1" } };
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
    globalThis.__settingsDialogResizeProbe = (dx, dy, startWidth = 1180, startHeight = 820) => {
      const dialog = document.querySelector("#settings-dialog");
      dialog._rect = { width: startWidth, height: startHeight };
      dialog.style.removeProperty("width");
      dialog.style.removeProperty("height");
      const handle = {
        dataset: { settingsResize: "corner" },
        captured: null,
        released: null,
        setPointerCapture(pointerId) { this.captured = pointerId; },
        releasePointerCapture(pointerId) { this.released = pointerId; },
      };
      const target = { closest(selector) { return selector === "[data-settings-resize]" ? handle : null; } };
      const baseEvent = {
        target,
        pointerId: 87,
        clientX: 200,
        clientY: 220,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
      };
      startSettingsDialogResize(baseEvent);
      updateSettingsDialogResize({
        clientX: 200 + dx,
        clientY: 220 + dy,
        preventDefault() { this.prevented = true; },
      });
      const during = {
        width: dialog.style.width,
        height: dialog.style.height,
      };
      finishSettingsDialogResize({ target });
      return {
        ...during,
        captured: handle.captured,
        released: handle.released,
        persisted: localStorage.getItem(SETTINGS_DIALOG_SIZE_KEY),
        resizing: document.body.classList.contains("is-resizing-settings-dialog"),
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
  for (const match of appJs.matchAll(/querySelector(?:All)?\("[^"]*\[data-([a-z0-9-]+)(?:[=\]"])/gi)) attrs.add(match[1]);
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
  assert.equal(appJs.includes("function checkIconSvg()"), true, "message copy controls should render a check icon after copying");
  assert.equal(appJs.includes("markCopyButtonCopied(copyText)"), true, "message copy controls should switch to copied state after successful copy");
  assert.equal(appJs.includes("[data-inline-fullscreen]"), true, "open controls must use the inline fullscreen handler");
}

async function testImmediateUserMessage() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({ id: "", session_id: "", status: "idle", mode: "", transcript: [] });
    renderFramingConversation = () => {
      globalThis.__renderCount += 1;
      globalThis.__renderFramingConversationImpl();
    };
  `);
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
  const threadHtml = app.run('document.querySelector("#framing-thread")?.innerHTML || ""');
  assert.equal(threadHtml.includes("run-live-status"), true, "normal chat sends should render the working status immediately");
  assert.equal(threadHtml.includes("Preparing response..."), true, "normal chat sends should show the pending placeholder before backend polling responds");
  assert.equal(threadHtml.includes("Working"), true, "normal chat sends should show a visible working timer before backend polling responds");
  assertJsonEqual(
    app.context.__messages().map((message) => `${message.role}:${message.text}`),
    ["user:Can you explain the project?"],
    "sent chat message should be visible immediately"
  );
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat");
  assert.equal(app.context.__apiCalls[0].body.message, "Can you explain the project?");
  assert.equal(app.context.__startedFramingBrief, undefined, "pre-project chat must not start a PROJECT.md framing run");
  assert.equal(app.context.__messages().some((message) => message.kind === "project"), false, "ordinary pre-project chat should not create a draft card by itself");
}

async function testTerminalSendResponseClearsImmediatePending() {
  const app = loadAppContext();
  app.context.__apiResponse = {
    ok: true,
    result: {
      session: {
        id: "s-terminal",
        session_id: "sid",
        status: "completed",
        mode: "chat",
        started_at: "2026-06-17T10:01:00.000Z",
        active_run: { running: false, mode: "chat", run_id: "s-terminal", started_at: "2026-06-17T10:01:00.000Z" },
        transcript: [],
      },
    },
  };
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({ id: "", session_id: "", status: "idle", mode: "", transcript: [] });
    renderFramingConversation = () => {
      globalThis.__renderCount += 1;
      globalThis.__renderFramingConversationImpl();
    };
  `);
  await app.run('sendSessionComposerMessage("Can you explain the project?")');
  const pendingState = app.context.__pendingState();
  const threadHtml = app.run('document.querySelector("#framing-thread")?.innerHTML || ""');
  assert.equal(pendingState.reply, false, "terminal backend responses without a reply should not leave chat permanently pending");
  assert.equal(threadHtml.includes("The run completed without a saved response."), true, "terminal backend responses without a reply should show the existing no-response status");
}

async function testExistingProjectComposerUsesChatEndpoint() {
  const app = loadAppContext();
  app.coldEditor.value = "Let's discuss the analysis method.";
  app.run('document.querySelector("#target-venue").value = "Nature Communications";');
  await app.run("coldStartFromPrepare()");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat", "existing PROJECT.md composer messages should use chat, not framing");
  assert.equal(app.context.__apiCalls[0].body.message, "Let's discuss the analysis method.");
  assert.equal(app.context.__apiCalls[0].body.targetVenue, "Nature Communications", "chat payload should preserve the target venue input for metadata and prompt context");
  assert.equal(app.context.__startedFramingBrief, undefined, "existing project chat must not start a framing run");
}

async function testEmptyProjectPrepareUsesChatEndpoint() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({ id: "", session_id: "", status: "idle", mode: "", transcript: [] });
  `);
  app.coldEditor.value = "How should I use this tool?";
  await app.run("coldStartFromPrepare()");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat", "empty project first message should use chat, not framing");
  assert.equal(app.context.__apiCalls[0].body.message, "How should I use this tool?");
  assert.equal(app.context.__startedFramingBrief, undefined, "empty project first message must not start the framing helper");
  assert.equal(app.context.__confirmMessageLog().length, 0, "ordinary empty-project chat should not ask for a regenerate confirmation");
}

function testProjectLoadingStates() {
  const app = loadAppContext();
  let state = app.run(`
    __setProjectLoadPhase("projects");
    renderProjectAvailability();
    __projectLoadingProbe();
  `);
  assert.equal(state.title, "Loading projects...", "initial load should show a project loading state");
  assert.equal(state.detail, "Finding available research workspaces");
  assert.equal(state.bodyClass.includes("is-project-loading"), true, "body should expose loading state immediately");
  assert.equal(state.coldDisabled, true, "composer should be disabled while projects are loading");
  assert.equal(state.coldPlaceholder, "Opening project...");
  assert.equal(state.retryHidden, true);

  state = app.run(`
    __setProjectLoadPhase("overview");
    renderProjectAvailability();
    __projectLoadingProbe();
  `);
  assert.equal(state.title, "Opening project...", "overview load should name the active project");
  assert.equal(state.detail, "Reading project files and session state");
  assert.equal(state.sync, "Reading files");

  state = app.run(`
    __setProjectLoadPhase("error", { error: "Permission denied" });
    renderProjectAvailability();
    __projectLoadingProbe();
  `);
  assert.equal(state.title, "Could not open project");
  assert.equal(state.detail, "Permission denied");
  assert.equal(state.sync, "Could not read files");
  assert.equal(state.retryHidden, false, "overview errors should expose Retry");
}

async function testSilentOverviewPollDoesNotShowLoading() {
  const app = loadAppContext();
  const state = await app.run(`
    (async () => {
      __setProjectLoadPhase("ready");
      globalThis.__apiHandler = async (endpoint) => {
        if (endpoint.startsWith("/api/overview")) {
          return {
            ...appState,
            generated_at: "2026-06-17T10:00:00.000Z",
            research_session: { ...appState.research_session, status: "completed", mode: "chat", active_run: { running: false } }
          };
        }
        return { ok: true };
      };
      await __loadOverviewImpl(true);
      const afterSuccess = __projectLoadingProbe();
      globalThis.__apiHandler = async (endpoint) => {
        if (endpoint.startsWith("/api/overview")) throw new Error("temporary network blip");
        return { ok: true };
      };
      await __loadOverviewImpl(true);
      const afterFailure = __projectLoadingProbe();
      globalThis.__apiHandler = null;
      return { afterSuccess, afterFailure, toasts: globalThis.__toastMessages };
    })()
  `);
  assert.equal(state.afterSuccess.phase, "ready", "silent overview poll success should not enter overview loading");
  assert.equal(state.afterSuccess.bodyClass.includes("is-project-loading"), false, "silent overview poll success must not show the loading canvas");
  assert.equal(state.afterSuccess.panelHidden, true);
  assert.equal(state.afterSuccess.sync.startsWith("Synced "), true, "silent overview poll success should only update sync state");
  assert.equal(state.afterFailure.phase, "ready", "silent overview poll failure should keep the current project visible");
  assert.equal(state.afterFailure.bodyClass.includes("is-project-loading"), false, "silent overview poll failure must not show the loading canvas");
  assert.equal(state.afterFailure.panelHidden, true);
  assert.equal(state.afterFailure.sync, "Could not sync");
  assert.equal(state.toasts.some((item) => item.message.includes("temporary network blip")), false, "silent poll failures should not spam error toasts");
}

async function testPrelaunchAffordanceStatesAndActions() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({ id: "", session_id: "", status: "idle", mode: "", transcript: [] });
    __setMessages([{ id: "u1", role: "user", kind: "text", text: "Let's study embodied AI safety evidence.", created_at: "2026-06-17T10:00:00.000Z" }]);
  `);
  let state = app.run("__prelaunchState()");
  assert.equal(state.state, "hidden", "pre-start conversation without PROJECT.md should not expose a manual draft action");
  assert.equal(app.run('document.querySelector("#prelaunch-affordance") === null'), true, "composer prelaunch strip should not be created");
  assert.equal(app.context.__startedFramingBrief, undefined, "draft action must not start a framing run from the UI");

  const ready = loadAppContext();
  ready.run(`
    __setMessages([
      { id: "a1", role: "assistant", kind: "text", text: "I updated the launch frame.", created_at: "2026-06-17T09:59:59.000Z" },
      { id: "p1", role: "assistant", kind: "project", text: "Project draft", artifact: { path: "PROJECT.md", text: "# Project\\n\\nReady." }, created_at: "2026-06-17T10:00:00.000Z" }
    ]);
  `);
  state = ready.run("__prelaunchState()");
  assert.equal(state.state, "ready", "valid PROJECT.md before autoresearch should offer Start");
  ready.run("__renderFramingConversationImpl()");
  assert.equal(ready.run("__framingThreadHtmlProbe()").includes("data-project-launch"), true, "latest assistant reply should expose Start autoresearch");
  assert.equal(ready.run("__latestProjectAttachmentHtml()").includes('data-inline-fullscreen="PROJECT.md"'), true, "latest PROJECT.md attachment should keep the clickable file link");
  assert.equal(ready.run("__latestProjectAttachmentHtml()").includes("project-rendered"), false, "PROJECT.md must stay collapsed by default");
  assert.equal(ready.run("__latestProjectAttachmentHtml()").includes("data-project-edit"), false, "PROJECT.md footer should not expose the old inline edit path");
  assert.equal(ready.run("__latestProjectAttachmentHtml()").includes(">Edit<"), false, "PROJECT.md footer editing should live in the file viewer Source mode");
  assert.equal(ready.run("__projectInlinePayloadProbe()").editable, true, "cached PROJECT.md payload must stay editable in Source mode");
  await ready.run("openLaunchDialog()");
  assert.equal(ready.launchDialog.open, true, "project attachment Start should use the existing launch dialog");

  const stale = loadAppContext();
  stale.run(`
    __setMessages([
      { id: "a1", role: "assistant", kind: "text", text: "I updated PROJECT.md.", created_at: "2026-06-17T09:59:59.000Z" },
      { id: "p1", role: "assistant", kind: "project", text: "Project draft", artifact: { path: "PROJECT.md", text: "# Project\\n\\nReady." }, created_at: "2026-06-17T10:00:00.000Z" },
      { id: "u2", role: "user", kind: "text", text: "Actually narrow the scope to exposed humans.", created_at: "2026-06-17T10:01:00.000Z" }
    ]);
  `);
  state = stale.run("__prelaunchState()");
  assert.equal(state.state, "ready", "new user framing after PROJECT.md should not expose a manual update action");
  stale.run("__renderFramingConversationImpl()");
  const staleHtml = stale.run("__framingThreadHtmlProbe()");
  assert.equal(staleHtml.includes("Start autoresearch"), true);
  assert.equal(staleHtml.includes("Update PROJECT.md"), false);
  assert.equal(staleHtml.includes("Start anyway"), false);
  assert.equal(stale.context.__startedFramingBrief, undefined, "update action must not start a framing run from the UI");

  const started = loadAppContext();
  started.run('__setSession({ id: "g1", session_id: "sid", status: "completed", mode: "goal", loop_iteration: 1, transcript: [] });');
  assert.equal(started.run("__prelaunchState()").state, "hidden", "Start affordance must disappear after autoresearch has started");

  const blocked = loadAppContext();
  blocked.run('pendingResourceImports.push({ id: "r1", status: "copying", name: "large.zip" });');
  state = blocked.run("__prelaunchState()");
  assert.equal(state.state, "blocked", "resource import should block prelaunch actions");
  assert.equal(state.showStart, true, "blocked valid PROJECT.md should still expose the disabled Start affordance");
  assert.equal(state.reason, "Wait for resource copy to finish before continuing.");
}

async function testPlanComposerModeUsesPlanEndpoint() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({ id: "", session_id: "", status: "idle", mode: "", transcript: [] });
    renderFramingConversation = () => {
      globalThis.__renderCount += 1;
      globalThis.__renderFramingConversationImpl();
    };
  `);
  assert.equal(app.run('document.querySelector("[data-composer-mode]") === null'), true, "Plan mode should not render a Chat/Plan segmented control");
  assert.equal(app.run('document.querySelectorAll("[data-plan-mode-toggle]").length >= 1'), true, "Plan mode should render a single Plan chip");
  app.run("togglePlanComposerMode()");
  assert.equal(app.run('isPlanComposerMode()'), true, "using the Plan chip should enable plan mode");
  assert.equal(app.run('document.querySelector("[data-plan-mode-toggle]").classList.contains("is-active")'), true, "enabled Plan chip should show active state");
  app.coldEditor.value = "Plan the first implementation pass.";
  app.run("__installBlockingCollect()");
  const pending = app.run("coldStartFromPrepare()");
  const threadHtml = app.run('document.querySelector("#framing-thread")?.innerHTML || ""');
  assert.equal(threadHtml.includes("run-live-status"), true, "Plan mode sends should render the working status immediately");
  assert.equal(threadHtml.includes("Preparing response..."), true, "Plan mode sends should show the pending placeholder before backend polling responds");
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/plan", "Plan mode should use the real plan endpoint");
  assert.equal(app.context.__apiCalls[0].body.message, "Plan the first implementation pass.");
  assert.equal(app.context.__apiCalls[0].body.conversationHistory.length >= 1, true, "plan requests should send conversation history");
  assert.equal(app.context.__startedFramingBrief, undefined, "Plan mode must not start the framing helper");
  assert.equal(app.context.__messages()[0].mode, "plan", "visible plan request should remember its mode for resend");
}

async function testPlanChipCanReturnToChat() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({ id: "", session_id: "", status: "idle", mode: "", transcript: [] });
    setComposerMode("plan");
    togglePlanComposerMode();
  `);
  assert.equal(app.run('isPlanComposerMode()'), false, "using the active Plan chip should return to chat mode");
  app.coldEditor.value = "Continue the normal discussion.";
  await app.run("coldStartFromPrepare()");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat", "after turning Plan off, normal messages should use chat");
}

async function testTypedPlanSlashIsConvertedLocally() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({ id: "", session_id: "", status: "idle", mode: "", transcript: [] });
  `);
  const sent = await app.run('sendSessionComposerMessage("/plan fix the upload flow")');
  assert.equal(sent, true, "typed /plan should submit as a plan request");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/plan", "typed /plan must not hit the slash command endpoint");
  assert.equal(app.context.__apiCalls[0].body.message, "fix the upload flow", "typed /plan prefix should be stripped");
  assert.equal(app.context.__messages()[0].kind, "text", "typed /plan should render as a normal user request, not a command row");
  assert.equal(app.context.__messages()[0].text, "fix the upload flow");
  assert.equal(app.run('isPlanComposerMode()'), true, "typed /plan should activate the Plan chip locally");
}

async function testPlanRequestBlockedDuringActiveRun() {
  const app = loadAppContext();
  app.run(`
    setComposerMode("plan");
    __setSession({ id: "active", session_id: "sid", status: "running", mode: "chat", active_run: { running: true }, transcript: [] });
  `);
  const sent = await app.run('sendSessionComposerMessage("Plan while active")');
  assert.equal(sent, false, "plan requests should not queue behind an active run");
  assert.equal(app.context.__apiCalls.length, 0, "blocked plan requests must not call the backend");
  assert.equal(app.context.__toastMessages.some((item) => item.message.includes("starting a plan")), true);
}

async function testPlanCardApproveReviseAndResend() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.research_session.latest_plan = {
      id: "P_ready",
      provider: "codex",
      model: "gpt-5.5",
      status: "ready",
      plan_text: "# Plan\\n\\n1. Update the UI.",
      steps: [{ step: "Inspect UI", status: "completed" }, { step: "Patch flow", status: "pending" }],
      created_at: "2026-06-26T10:00:00.000Z"
    };
    restoreFramingMessages();
  `);
  const planMessage = app.context.__messages().find((message) => message.kind === "plan");
  assert.equal(Boolean(planMessage), true, "overview restore should surface latest ready plan as a plan card message");
  const html = app.run('framingMessageHtml(localMessages.find((message) => message.kind === "plan"))');
  assert.equal(html.includes("data-plan-approve"), true, "ready plan card should show approve action");
  assert.equal(html.includes("data-plan-revise"), true, "ready plan card should show revise action");
  assert.equal(html.includes("data-project-launch"), false, "plan card should not show Start without a ready PROJECT.md");

  app.run('revisePlan("P_ready")');
  app.coldEditor.value = "Make it more conservative.";
  await app.run("coldStartFromPrepare()");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/plan", "revising a plan should send a plan request");
  assert.equal(app.context.__apiCalls[0].body.revisePlanId, "P_ready", "plan revision should include prior plan id");

  app.context.__apiCalls.length = 0;
  app.run(`__setSession({ id: "done", session_id: "", status: "completed", mode: "plan", active_run: { running: false }, transcript: [] });`);
  await app.run('approvePlan("P_ready")');
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/plan/approve", "approve should call the plan approve endpoint");
  assert.equal(app.context.__apiCalls[0].body.planId, "P_ready");
  assert.equal(app.run('isPlanComposerMode()'), false, "approving a plan should return the composer to chat mode");
}

async function testPlanCardShowsLaunchWhenProjectReady() {
  const app = loadAppContext();
  app.run(`
    appState.research_session.latest_plan = {
      id: "P_ready",
      provider: "codex",
      model: "gpt-5.5",
      status: "ready",
      plan_text: "# Plan\\n\\n1. Start the research loop after review.",
      steps: [],
      created_at: "2026-06-26T10:00:00.000Z"
    };
    restoreFramingMessages();
  `);
  const launchState = app.run("__prelaunchState()");
  assert.equal(launchState.showStart, true, `ready PROJECT.md should pass prelaunch Start gating: ${JSON.stringify(launchState)}`);
  assert.equal(app.run('planCardHtml.toString().includes("projectDraftLaunchButtonHtml")'), true, "plan card implementation should render the PROJECT.md launch button");
  const html = app.run('framingMessageHtml(localMessages.find((message) => message.kind === "plan"))');
  assert.equal(html.includes("data-project-launch"), true, "ready PROJECT.md should expose Start autoresearch from the plan card");
  assert.equal(html.includes("data-plan-approve"), true, "plan approval should remain available on the plan card");
  assert.equal(html.includes("data-plan-revise"), true, "plan revision should remain available on the plan card");
  await app.run("openLaunchDialog()");
  assert.equal(app.launchDialog.open, true, "plan card Start autoresearch should use the existing launch dialog");

  app.context.__apiCalls.length = 0;
  app.run(`__setSession({ id: "done", session_id: "", status: "completed", mode: "plan", active_run: { running: false }, transcript: [] });`);
  await app.run('approvePlan("P_ready")');
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/plan/approve", "plan approval must stay on the plan approve endpoint");
}

function testPlanCardHidesLaunchAfterAutoresearchStarts() {
  const app = loadAppContext();
  app.run(`
    appState.research_session.latest_plan = {
      id: "P_ready",
      provider: "codex",
      model: "gpt-5.5",
      status: "ready",
      plan_text: "# Plan\\n\\n1. Start the research loop after review.",
      steps: [],
      created_at: "2026-06-26T10:00:00.000Z"
    };
    __setSession({ id: "g1", session_id: "sid", status: "completed", mode: "goal", loop_iteration: 1, transcript: [], latest_plan: appState.research_session.latest_plan });
    restoreFramingMessages();
  `);
  const html = app.run('framingMessageHtml(localMessages.find((message) => message.kind === "plan"))');
  assert.equal(html.includes("data-project-launch"), false, "plan card should hide Start after autoresearch starts");
  assert.equal(html.includes("data-plan-approve"), true, "plan approval remains a plan-specific action");
}

async function testFreshRemoteProjectFirstMessageSends() {
  const app = loadAppContext();
  app.run(`
    appState.runtime = { remote: true };
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({ id: "", session_id: "", status: "idle", mode: "", active_run: { running: false }, trajectory: { next_trial_number: 1 }, transcript: [] });
  `);
  assert.equal(app.run("hasAutoresearchTrajectory()"), false, "default next trial number alone is not an existing trajectory");
  app.coldEditor.value = "nihao";
  await app.run("coldStartFromPrepare()");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat", "fresh remote project first message should reach chat endpoint");
  assert.equal(app.context.__apiCalls[0].body.message, "nihao");
  assert.equal(
    app.context.__toastMessages.some((item) => item.message.includes("Wait for the current agent run")),
    false,
    "fresh remote project first message must not be blocked by the current-run toast"
  );
}

async function testFreshRemoteProjectStaleRunningSnapshotStillSends() {
  const app = loadAppContext();
  app.run(`
    appState.runtime = { remote: true };
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({
      id: "stale",
      session_id: "",
      status: "running",
      mode: "framing",
      active_run: { running: false },
      trajectory: { next_trial_number: 1 },
      transcript: []
    });
  `);
  assert.equal(app.run("hasAutoresearchTrajectory()"), false, "stale default next trial number alone is not an existing trajectory");
  app.coldEditor.value = "nihao";
  await app.run("coldStartFromPrepare()");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat", "stale remote running snapshot should not block the first message");
  assert.equal(app.context.__apiCalls[0].body.message, "nihao");
  assert.equal(
    app.context.__toastMessages.some((item) => item.message.includes("Wait for the current agent run")),
    false,
    "stale remote running snapshot must not trigger the current-run toast"
  );
}

function testPrestartPendingExpectedTrialDoesNotShowAutoresearchPanel() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    appState.files.project.text = "# Project\\n\\nReady.";
    appState.framing.project_ready = true;
    appState.trials = [];
    __setSession({
      id: "s-chat",
      session_id: "sid",
      status: "completed",
      mode: "chat",
      loop_active: false,
      loop_iteration: 0,
      gate: { status: "continue" },
      trajectory: { next_trial_number: 1 },
      expected_trial: {
        status: "pending",
        expected_iteration: 1,
        pending_intervention_ids: ["I0001"],
        pending_intervention_paths: ["research_trajectory/human_interventions/I0001_prestart.md"],
        updated_at: "2026-06-25T00:11:20-04:00"
      },
      transcript: []
    });
    __setMessages([
      { id: "a1", role: "assistant", kind: "text", text: "I updated the launch frame.", created_at: "2026-06-17T10:00:01.000Z" }
    ]);
  `);
  assert.equal(app.run("hasAutoresearchTrajectory()"), false, "pending expected trial alone must not count as started autoresearch");
  assert.equal(app.run("__prelaunchState()").state, "ready", "pre-start PROJECT.md should still expose Start");
  const html = app.run("__framingThreadHtmlProbe()");
  assert.equal(html.includes("Trial 1"), false, "pre-start pending expected marker must not render an autoresearch panel");
  assert.equal(html.includes("data-resume-autoresearch"), false, "pre-start pending expected marker must not expose Resume");
  assert.equal(html.includes("data-project-launch"), true, "pre-start ready PROJECT.md should expose Start instead");
}

async function testRunningChatMessageIsQueued() {
  const app = loadAppContext();
  app.run('__setSession({ id: "s1", session_id: "sid", status: "running", mode: "goal", loop_active: true, started_at: "2026-06-17T10:00:00.000Z", transcript: [] })');
  app.context.__apiResponse = {
    ok: true,
    result: {
      files: { queued_chat: { queued: true, count: 1, run_after_current: true } },
      session: { id: "s1", session_id: "sid", status: "running", mode: "goal", loop_active: true, started_at: "2026-06-17T10:00:00.000Z", transcript: [] }
    }
  };
  const sent = await app.run('sendSessionComposerMessage("Can you show progress?")');
  assert.equal(sent, true, "ordinary chat should queue while an autoresearch run is active");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/queue");
  assert.equal(app.context.__apiCalls[0].body.message, "Can you show progress?");
  assert.equal(app.context.__messages().length, 0, "queued chat should not render as a sent transcript turn");
  assert.equal(app.context.__toastMessages.at(-1).message, "Queued; CoAutoResearch will reply after the current run finishes.");
  assert.equal(app.context.__pendingState().reply, false, "queued chat should not leave a visible chat run pending");
}

async function testRunningSteeringLookingMessageIsQueuedTheSameWay() {
  const app = loadAppContext();
  app.run('__setSession({ id: "s1", session_id: "sid", status: "running", mode: "goal", loop_active: true, started_at: "2026-06-17T10:00:00.000Z", transcript: [] })');
  app.run('__setMessages([{ id: "u1", role: "user", kind: "text", text: "previous visible message", created_at: "2026-06-17T09:58:00.000Z" }])');
  app.context.__apiResponse = {
    ok: true,
    result: {
      files: { queued_chat: { queued: true, count: 1, run_after_current: true } },
      session: { id: "s1", session_id: "sid", status: "running", mode: "goal", loop_active: true, started_at: "2026-06-17T10:00:00.000Z", transcript: [] }
    }
  };
  const sent = await app.run('sendSessionComposerMessage("intervention: change target venue to Nature Machine Intelligence")');
  assert.equal(sent, true, "steering-looking text should use the same queued chat path while autoresearch is active");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/queue");
  assert.equal(app.context.__apiCalls[0].body.message, "intervention: change target venue to Nature Machine Intelligence");
  assert.equal(app.context.__apiCalls[0].body.conversationHistory.length, 1, "queued chat request should still send the authoritative visible history");
  assert.equal(app.context.__apiCalls[0].body.conversationHistory[0].text, "previous visible message");
}

async function testQueuedChatCanReorderAndDelete() {
  const app = loadAppContext();
  app.run(`
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "running",
      mode: "goal",
      queued_chat_items: [
        { id: "q1", text: "first queued item", created_at: "2026-06-17T10:00:00.000Z", priority: "normal" },
        { id: "q2", text: "second queued item", created_at: "2026-06-17T10:01:00.000Z", priority: "normal" }
      ],
      transcript: []
    });
  `);
  app.context.__apiHandler = (endpoint, body, options) => {
    if (endpoint === "/api/research/queue/reorder") {
      return {
        ok: true,
        result: {},
        queued_chat_items: body.ids.map((id) => ({ id, text: id === "q2" ? "second queued item" : "first queued item", priority: "normal" })),
      };
    }
    if (endpoint === "/api/research/queue") {
      return {
        ok: true,
        result: {},
        queued_chat_items: [{ id: "q2", text: "second queued item", priority: "normal" }],
      };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  await app.run('__moveQueuedItem("q2", -1)');
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/queue/reorder");
  assertJsonEqual(app.context.__apiCalls[0].body.ids, ["q2", "q1"], "queue move should submit full ordered ids");
  assertJsonEqual(app.context.__queuedItems().map((item) => item.id), ["q2", "q1"], "queue order should update from API response");
  await app.run('__deleteQueuedItem("q1")');
  assert.equal(app.context.__apiCalls[1].endpoint, "/api/research/queue");
  assert.equal(app.context.__apiCalls[1].method, "DELETE");
  assert.equal(app.context.__apiCalls[1].body.id, "q1");
}

async function testStopAndSendQueuesPriorityThenStops() {
  const app = loadAppContext();
  app.run('__setSession({ id: "s1", session_id: "sid", status: "running", mode: "goal", loop_active: true, started_at: "2026-06-17T10:00:00.000Z", transcript: [] })');
  app.coldEditor.value = "Run this immediately after stopping.";
  app.context.__apiHandler = (endpoint, body) => {
    if (endpoint === "/api/research/queue") {
      return {
        ok: true,
        result: {
          files: { queued_chat: { queued: true, count: 1, run_after_current: true } },
          session: {
            id: "s1",
            session_id: "sid",
            status: "running",
            mode: "goal",
            queued_chat_items: [{ id: "q1", text: body.message, priority: body.priority }],
            transcript: [],
          },
        },
      };
    }
    if (endpoint === "/api/research/stop") {
      return {
        ok: true,
        result: {
          session: { id: "s1", session_id: "sid", status: "stopping", mode: "goal", transcript: [] },
        },
      };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  await app.run("__stopAndSendQueued()");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/queue");
  assert.equal(app.context.__apiCalls[0].body.priority, "send_after_stop");
  assert.equal(app.context.__apiCalls[1].endpoint, "/api/research/stop");
}

function testDuplicateQueuedUserTurnsRestoreFromServerMessages() {
  const app = loadAppContext();
  app.run(`
    __setServerMessages([
      { id: "qd1", role: "user", kind: "text", text: "您好", created_at: "2026-06-17T10:01:00.000Z" },
      { id: "qd2", role: "user", kind: "text", text: "您好", created_at: "2026-06-17T10:02:00.000Z" }
    ]);
    __setSession({ id: "s1", session_id: "sid", status: "completed", mode: "chat", transcript: [] });
    __restore();
  `);
  assertJsonEqual(app.context.__messages().filter((message) => message.role === "user").map((message) => message.id), ["qd1", "qd2"], "server-persisted queued user turns should survive even when the text is identical");
}

function testRepeatedQueuedTranscriptUserTurnsAreRecovered() {
  const app = loadAppContext();
  app.run(`
    __setServerMessages([
      { id: "u1", role: "user", kind: "text", text: "Hi", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "Hi! How can I help?", created_at: "2026-06-17T10:00:01.000Z" }
    ]);
    __setSession({ id: "s1", session_id: "claude-sid", status: "completed", mode: "chat", backend: "claude", transcript: [] });
    __setTranscript([
      { id: "tu1", role: "user", kind: "user", raw_type: "ui.chat", content: "Hi", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "tf1", role: "final", kind: "final", raw_type: "result.success", content: "Hi! How can I help?", created_at: "2026-06-17T10:00:01.000Z" },
      { id: "tu2", role: "user", kind: "user", raw_type: "ui.chat", content: "Hi", created_at: "2026-06-17T10:00:05.000Z" },
      { id: "tf2", role: "final", kind: "final", raw_type: "result.success", content: "Hi again! Still here.", created_at: "2026-06-17T10:00:06.000Z" }
    ]);
    __restore();
  `);
  assertJsonEqual(app.context.__messages().filter((message) => message.kind !== "project").map((message) => `${message.role}:${message.text}`), [
    "user:Hi",
    "assistant:Hi! How can I help?",
    "user:Hi",
    "assistant:Hi again! Still here.",
  ]);
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

async function testResourceLinksDoNotRepeatAcrossMessages() {
  const app = loadAppContext();
  app.context.__apiResponse = {
    ok: true,
    result: {
      session: {
        id: "s-completed",
        session_id: "sid",
        status: "completed",
        mode: "chat",
        started_at: "2026-06-17T10:01:00.000Z",
        transcript: []
      }
    }
  };
  app.run('__setSelectedResources([{ path: "/tmp/paper.pdf", category: "literature" }])');
  await app.run('sendSessionComposerMessage("Use this paper.")');
  assertJsonEqual(app.context.__apiCalls[0].body.resourceLinks, [{ path: "/tmp/paper.pdf", category: "literature" }]);
  await app.run('sendSessionComposerMessage("Now answer without new attachments.")');
  assertJsonEqual(app.context.__apiCalls[1].body.resourceLinks, [], "second message must not resend previous resource links");
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
  app.coldEditor.value = "/status";
  app.run("__installBlockingCollect()");
  const pending = app.run('sendSessionComposerMessage("/status")');
  const [message] = app.context.__messages();
  assert.equal(message.kind, "command");
  assert.equal(message.text, "/status");
  const pendingState = app.context.__pendingState();
  assert.equal(pendingState.reply, true, "slash commands should show immediate pending feedback while the command posts");
  assert.equal(pendingState.pendingId, message.id, "slash command pending state should be tied to the visible command row");
  assert.ok(pendingState.since > 0, "slash command pending state should start a visible working timer");
  const html = app.run("__messageHtml(0)");
  assert.equal(html.includes('class="framing-message control"'), true, "slash command should render as a control row, not a user bubble");
  assert.equal(html.includes("Show status"), true, "slash command control row should render human-facing status copy");
  assert.equal(html.includes("/status"), false, "slash command control row should not expose the internal command text");
  assert.equal(html.includes(">You<"), false, "slash command control row should not be labelled as a user chat turn");
  assert.equal(html.includes("data-framing-edit"), false, "slash command control row should not be editable like a normal user message");
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/command");
  assert.equal(app.run("__latestUnansweredText()"), "", "slash command should not create a fake unanswered chat state");
}

async function testLegacyGoalRestartCommandUsesCommandEndpoint() {
  const app = loadAppContext();
  app.coldEditor.value = "/goal restart";
  app.run("__installBlockingCollect()");
  const pending = app.run('sendSessionComposerMessage("/goal restart")');
  assert.equal(app.context.__restartConfirmCalls.length, 0, "typed legacy /goal restart must not invoke restart confirmation");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(app.coldEditor.value, "", "legacy command should clear composer before backend work");
  const [message] = app.context.__messages();
  assert.equal(message.kind, "command", "legacy command should render as a command control row");
  const html = app.run("__messageHtml(0)");
  assert.equal(html.includes("/goal restart"), true, "legacy command row should show the typed compatibility command");
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/command");
  assert.equal(app.context.__apiCalls[0].body.command, "/goal restart");
}

async function testLegacyGoalRestartIgnoresRestartCancelFlag() {
  const app = loadAppContext();
  app.context.__confirmRestart = false;
  app.coldEditor.value = "/goal restart";
  const sent = await app.run('sendSessionComposerMessage("/goal restart")');
  assert.equal(sent, true, "legacy restart command should submit as a compatibility command");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/command", "legacy restart command must not call restart endpoint");
  assert.equal(app.context.__messages()[0].kind, "command", "legacy restart command should append a command row");
  assert.equal(app.coldEditor.value, "", "successful legacy command should clear composer");
}

async function testTypedLegacyGoalControlsStayOnCommandEndpoint() {
  const app = loadAppContext();
  app.run(`
    __setSession({
      id: "s-claude",
      session_id: "00000000-0000-0000-0000-000000000cla",
      backend: "claude",
      settings: { backend: "claude" },
      status: "completed",
      mode: "goal"
    });
  `);
  app.coldEditor.value = "/goal restart";
  app.run("__installBlockingCollect()");
  const pending = app.run('sendSessionComposerMessage("/goal restart")');
  assert.equal(app.context.__restartConfirmCalls.length, 0, "typed legacy restart must not use product restart confirmation");
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/command", "typed legacy /goal restart must stay on command endpoint");
  assert.equal(app.context.__apiCalls[0].body.command, "/goal restart");
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

function testRunningReplyKeepsWorkingAfterShortAnswer() {
  const app = loadAppContext();
  app.run(`
    __setMessages([
      { id: "u1", role: "user", kind: "text", text: "What does this table mean?", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "I am checking the table before answering.", created_at: "2026-06-17T10:00:03.000Z" }
    ]);
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "running",
      mode: "chat",
      loop_active: false,
      started_at: "2026-06-17T10:00:00.000Z",
      active_run: {
        running: true,
        mode: "chat",
        run_id: "s1",
        started_at: "2026-06-17T10:00:00.000Z",
        status_label: "Codex is working"
      },
      transcript: [
        { id: "tu1", role: "user", kind: "user", raw_type: "ui.chat", content: "What does this table mean?", created_at: "2026-06-17T10:00:00.000Z" },
        { id: "tc1", role: "command", kind: "command", raw_type: "process.started", content: "codex exec resume", created_at: "2026-06-17T10:00:01.000Z" }
      ]
    });
    framingReplyPending = true;
    pendingFramingUserMessageId = "u1";
    framingPendingSince = Date.parse("2026-06-17T10:00:00.000Z");
    renderFramingConversation = () => {
      globalThis.__renderCount += 1;
      globalThis.__renderFramingConversationImpl();
    };
  `);
  const html = app.run("__framingThreadHtmlProbe()");
  const pendingState = app.context.__pendingState();
  assert.equal(pendingState.reply, true, "running chat should keep reply pending after a visible short assistant answer");
  assert.equal(html.includes("I am checking the table before answering."), true, "short assistant answer should remain visible");
  assert.equal(html.includes("run-live-status"), true, "running chat should keep showing the live working status after a short answer");
  assert.equal(html.includes("Working"), true, "running chat should keep showing a working timer after a short answer");
  assert.equal(html.includes("Preparing response..."), true, "running chat should keep a quiet pending placeholder when no readable update exists yet");
  assert.equal(html.includes("data-activity-open"), true, "running chat should keep an Activity entry available after a short answer");
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
  assert.equal(activity.hasWorked, true, "activity entry should render before the final assistant response");
  assert.equal(activity.hasActivityOpen, true, "worked activity should open the Activity panel");
  assert.equal(activity.hasInlineContainer, true, "worked activity should render inside the assistant turn, not as a standalone thread item");
  assert.equal(activity.hasInlineDetails, false, "worked activity should no longer expand inline");
  assert.equal(activity.hasPartial, false, "intermediate status should move out of the main thread");
  assert.equal(activity.panelHasPartial, true, "intermediate status should live inside the Activity panel");
  assert.equal(activity.panelHasFinal, false, "final answer should not be hidden inside worked activity");
  const html = app.run("__framingThreadHtmlProbe()");
  assert.equal(html.includes("partial status"), false, "completed turns should not expose intermediate updates as main-thread reply text");
  assert.equal(html.includes("run-live-status"), false, "completed turns should not keep the live working status after final recovery");
}

function testClaudeResultSuccessRecoversAssistantReply() {
  const app = loadAppContext();
  app.run(`
    __setMessages([]);
    __setServerMessages([]);
    __setSession({ id: "s1", session_id: "claude-sid", status: "completed", mode: "chat", backend: "claude", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
    __setTranscript([
      { id: "tu1", role: "user", kind: "user", raw_type: "ui.chat", content: "Hi", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "tf1", role: "final", kind: "final", raw_type: "result.success", content: "Hi! How can I help you with your research project today?", created_at: "2026-06-17T10:00:01.000Z" }
    ]);
    __restore();
  `);
  const messages = app.context.__messages().filter((message) => message.kind !== "project");
  assertJsonEqual(messages.map((message) => `${message.role}:${message.text}`), [
    "user:Hi",
    "assistant:Hi! How can I help you with your research project today?",
  ]);
  assert.equal(app.run("__latestUnansweredText()"), "", "Claude result.success should count as a saved assistant response");
  const html = app.run("__framingThreadHtmlProbe()");
  assert.equal(html.includes("The run completed without a saved response."), false, "Claude result.success must not render the no-response error state");
}

function testClaudeWorkedActivityUsesActivityPanel() {
  const app = loadAppContext();
  app.run(`
    __setMessages([]);
    __setServerMessages([]);
    __setSession({ id: "s1", session_id: "claude-sid", status: "completed", mode: "chat", backend: "claude", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
    __setTranscript([
      { id: "tu1", role: "user", kind: "user", raw_type: "ui.chat", content: "Summarize", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "th1", role: "assistant", kind: "reasoning", raw_type: "thinking", content: "Reading the manuscript context and deciding what to summarize.", created_at: "2026-06-17T10:00:01.000Z" },
      { id: "ta1", role: "assistant", kind: "assistant", raw_type: "assistant", content: "Drafting a concise summary.", created_at: "2026-06-17T10:00:02.000Z" },
      { id: "tf1", role: "final", kind: "final", raw_type: "result.success", content: "Here is the summary.", created_at: "2026-06-17T10:00:03.000Z" }
    ]);
    __restore();
  `);
  assertJsonEqual(app.context.__messages().filter((message) => message.kind !== "project").map((message) => `${message.role}:${message.text}`), [
    "user:Summarize",
    "assistant:Here is the summary.",
  ]);
  const activity = app.run("__activityProbe()");
  assert.equal(activity.hasActivityOpen, true, "Claude worked activity should open the Activity panel");
  assert.equal(activity.hasInlineContainer, true, "Claude worked activity should render inside the assistant turn");
  assert.equal(activity.hasInlineDetails, false, "Claude worked activity should not expand inline");
  assert.equal(activity.panelHasPartial, false, "Claude fixture should not depend on the Codex partial status text");
  const panel = app.run(`__activityPanelProbe(${JSON.stringify(activity.sourceKeys[0])})`);
  assert.equal(panel.html.includes("Reading the manuscript context"), true, "Claude thinking should render inside Activity panel");
  assert.equal(panel.html.includes("Drafting a concise summary."), true, "Claude assistant update should render inside Activity panel");
  assert.equal(panel.html.includes("Here is the summary."), false, "Claude final answer should stay in the main conversation");
}

async function testResearchEventStreamUpsertsTranscriptAndCompletes() {
  const app = loadAppContext();
  const state = await app.run(`
    (async () => {
      startResearchEventStream();
      const first = globalThis.__eventSources.at(-1);
      first.emit("open", {});
      first.emit("research", {
        schema_version: 1,
        event_id: 1,
        kind: "transcript",
        project_id: "p1",
        run_id: "s-stream",
        backend: "codex",
        mode: "chat",
        status: "running",
        session_patch: { status: "running", last_event_summary: "Assistant is writing." },
        transcript_entry: {
          id: "ta-stream",
          role: "assistant",
          kind: "assistant",
          title: "Assistant",
          content: "Hel",
          raw_type: "item.agentMessage.delta",
          created_at: "2026-06-17T10:00:01.000Z",
          run_id: "s-stream",
          streaming: true
        }
      });
      first.emit("research", {
        schema_version: 1,
        event_id: 2,
        kind: "transcript",
        project_id: "p1",
        run_id: "s-stream",
        backend: "codex",
        mode: "chat",
        status: "running",
        session_patch: { status: "running", last_event_summary: "Assistant is writing more." },
        transcript_entry: {
          id: "ta-stream",
          role: "assistant",
          kind: "assistant",
          title: "Assistant",
          content: "Hello",
          raw_type: "item.agentMessage.delta",
          created_at: "2026-06-17T10:00:01.000Z",
          run_id: "s-stream",
          streaming: true
        }
      });
      first.emit("research", {
        schema_version: 1,
        event_id: 3,
        kind: "completed",
        project_id: "p1",
        run_id: "s-stream",
        backend: "codex",
        mode: "chat",
        status: "completed",
        session_patch: { status: "completed", returncode: 0 }
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        url: first.url,
        lastId: researchEventLastId,
        transcript: appState.research_session.transcript,
        status: appState.research_session.status,
        overviewCalls: globalThis.__loadOverviewCalls
      };
    })()
  `);
  assert.equal(state.url, "/api/research/events?project=p1", "EventSource should open a project-scoped stream");
  assert.equal(state.lastId, "3", "streaming events should advance Last-Event-ID");
  assert.equal(state.transcript.length, 1, "streaming transcript updates must upsert by id");
  assert.equal(state.transcript[0].content, "Hello");
  assert.equal(state.status, "completed");
  assertJsonEqual(state.overviewCalls, [true], "completion should request one silent overview reconciliation");
}

function testResearchEventStreamSyncsPlanArtifact() {
  const app = loadAppContext();
  const state = app.run(`
    appState.latest_plan = {
      type: "plan",
      id: "P_old_global",
      status: "ready",
      plan_text: "# Old global plan"
    };
    appState.research_session.latest_plan = {
      type: "plan",
      id: "P_old_session",
      status: "ready",
      plan_text: "# Old session plan"
    };
    startResearchEventStream();
    const first = globalThis.__eventSources.at(-1);
    first.emit("research", {
      schema_version: 1,
      event_id: 1,
      kind: "transcript",
      project_id: "p1",
      run_id: "s-plan",
      backend: "codex",
      mode: "plan",
      status: "running",
      session_patch: { status: "running", last_event_summary: "Planning." },
      transcript_entry: {
        id: "tp-stream",
        role: "assistant",
        kind: "plan",
        title: "Plan",
        content: "# Plan\\n\\nStreamed plan.",
        raw_type: "ui.plan.artifact",
        artifact: {
          type: "plan",
          id: "P_stream",
          provider: "codex",
          model: "gpt-5.5",
          status: "ready",
          plan_text: "# Plan\\n\\nStreamed plan.",
          steps: []
        }
      }
    });
    const planMessage = localMessages.find((message) => message.kind === "plan" && message.artifact?.id === "P_stream");
    const html = planMessage ? framingMessageHtml(planMessage) : "";
    ({
      latestId: appState.latest_plan?.id || "",
      sessionLatestId: appState.research_session.latest_plan?.id || "",
      messageStatus: planMessage?.artifact?.status || "",
      htmlHasApprove: html.includes("data-plan-approve")
    });
  `);
  assert.equal(state.latestId, "P_stream", "streamed plan artifact should update appState.latest_plan");
  assert.equal(state.sessionLatestId, "P_stream", "streamed plan artifact should update the live session latest_plan");
  assert.equal(state.messageStatus, "ready", "streamed plan artifact should upsert the visible plan message");
  assert.equal(state.htmlHasApprove, true, "streamed ready plan should render plan-specific actions immediately");
}

function testResearchEventStreamProjectSwitchAndErrorFallback() {
  const app = loadAppContext();
  const state = app.run(`
    startResearchEventStream();
    const first = globalThis.__eventSources.at(-1);
    activeProjectId = "p2";
    resetProjectClientState();
    startResearchEventStream();
    const second = globalThis.__eventSources.at(-1);
    second.emit("error", {});
    const afterOneError = { failureCount: researchEventFailureCount, reconnectScheduled: Boolean(researchEventReconnectTimer) };
    clearTimeout(researchEventReconnectTimer);
    researchEventReconnectTimer = null;
    startResearchEventStream({ force: true });
    globalThis.__eventSources.at(-1).emit("error", {});
    clearTimeout(researchEventReconnectTimer);
    researchEventReconnectTimer = null;
    startResearchEventStream({ force: true });
    globalThis.__eventSources.at(-1).emit("error", {});
    const beforeFallbackCount = globalThis.__eventSources.length;
    startResearchEventStream();
    ({
      firstClosed: first.closed,
      secondUrl: second.url,
      afterOneError,
      failureCount: researchEventFailureCount,
      sourceCount: globalThis.__eventSources.length,
      beforeFallbackCount
    });
  `);
  assert.equal(state.firstClosed, true, "project reset should close the previous EventSource");
  assert.equal(state.secondUrl, "/api/research/events?project=p2", "project switch should reopen for the new project");
  assert.equal(state.afterOneError.failureCount, 1, "stream errors should be counted");
  assert.equal(state.afterOneError.reconnectScheduled, true, "first stream error should schedule a retry");
  assert.equal(state.failureCount, 3, "repeated stream errors should reach fallback threshold");
  assert.equal(state.sourceCount, state.beforeFallbackCount, "after repeated failures, normal starts should fall back to polling");
}

function testTranscriptEntriesDoNotExposeEdit() {
  const app = loadAppContext();
  app.run(`
    __setSession({ id: "s1", session_id: "sid", status: "completed", mode: "chat", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
  `);
  const html = app.run(`transcriptEntryHtml({
    id: "tu1",
    role: "user",
    kind: "user",
    raw_type: "ui.chat",
    content: "Editable transcript message",
    editable: true,
    created_at: "2026-06-17T10:00:00.000Z"
  })`);
  assert.equal(html.includes("data-transcript-edit"), false, "transcript/activity entries should not expose a second edit model");
  assert.equal(html.includes("transcript-edit-form"), false, "transcript/activity entries should not render resend forms");
}

async function testEditTruncatesLaterConversationBeforeResend() {
  const app = loadAppContext();
  app.run(`
    __setMessages([
      {
        id: "u1",
        role: "user",
        kind: "text",
        text: "old question",
        created_at: "2026-06-17T10:00:00.000Z",
        attachments: [{ kind: "link", path: "resources/old/paper.pdf", category: "literature" }]
      },
      { id: "a1", role: "assistant", kind: "text", text: "old answer", created_at: "2026-06-17T10:00:01.000Z" },
      { id: "u2", role: "user", kind: "text", text: "later question", created_at: "2026-06-17T10:00:02.000Z" },
      { id: "a2", role: "assistant", kind: "text", text: "later answer", created_at: "2026-06-17T10:00:03.000Z" }
    ]);
  `);
  await app.run('resendConversationMessage("u1", "edited question")');
  const messages = app.context.__messages();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "edited question");
  assert.ok(messages[0].edited_at, "edited user message should record edited_at");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat", "editing an established discussion turn should regenerate a chat reply");
  assert.equal(app.context.__apiCalls[0].body.message, "edited question");
  assert.equal(app.context.__apiCalls[0].body.clientMessageId, "u1", "resend should identify the edited message");
  assertJsonEqual(app.context.__apiCalls[0].body.resourceLinks, [{ path: "resources/old/paper.pdf", category: "literature", alreadyImported: true }], "retained link attachments on the edited message should be resubmitted as current references");
  assertJsonEqual(app.context.__apiCalls[0].body.conversationHistory[0].attachments, [{ kind: "link", name: "paper.pdf", path: "resources/old/paper.pdf", category: "literature" }], "conversation history should include attachment summaries");
  assert.equal(app.context.__startedFramingBrief, undefined, "discussion resend must not start a framing run");
  assert.equal(app.context.__toastMessages.at(-1).message, "Regenerating reply.");
}

async function testEditAfterAutoresearchFirstMessageUsesChat() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "# Project\\n\\nReady.";
    appState.files.project.text = "# Project\\n\\nReady.";
    appState.trials = [{ id: "000001_seed", status: "reported", path: "research_trajectory/trials/000001_seed" }];
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_iteration: 1,
      trajectory: { latest_active_trial: "000001_seed", next_trial_number: 2 },
      transcript: []
    });
    __setMessages([
      { id: "u-initial", role: "user", kind: "text", text: "old initial brief", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "old answer", created_at: "2026-06-17T10:00:01.000Z" }
    ]);
  `);
  await app.run('resendConversationMessage("u-initial", "edited first message after trials")');
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat", "editing the first message after autoresearch must use chat");
  assert.equal(app.context.__startedFramingBrief, undefined, "post-autoresearch edit must not restart framing");
  assert.equal(app.context.__confirmMessageLog().length, 0, "chat resend should not show destructive framing confirmation");
}

async function testSteeringResendStartsVisibleNormalChatRun() {
  const app = loadAppContext();
  app.run(`
    __setMessages([
      { id: "u1", role: "user", kind: "text", text: "old method instruction", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "old answer", created_at: "2026-06-17T10:00:01.000Z" }
    ]);
    globalThis.__apiHandler = (endpoint, body) => {
      if (endpoint === "/api/framing/messages") {
        appState.framing.messages = body.messages || [];
        return { ok: true };
      }
      if (endpoint.startsWith("/api/overview")) {
        return { ...appState, generated_at: "2026-06-17T10:01:00.000Z" };
      }
      if (endpoint === "/api/research/chat") {
        return {
          ok: true,
          result: {
            session: {
              id: "s-chat",
              session_id: "sid",
              status: "running",
              mode: "chat",
              started_at: "2026-06-17T10:01:00.000Z",
              active_run: {
                running: true,
                mode: "chat",
                trial_iteration: null,
                status_label: "Codex is working"
              },
              transcript: []
            }
          }
        };
      }
      return { ok: true };
    };
  `);
  await app.run('resendConversationMessage("u1", "我觉得对于这些找到的resources的分析，得用更好的方法，你先别考虑现在方法的思维，先考虑一下，从最好的效果和预期来说，应该怎么分析")');
  const messages = app.context.__messages();
  assert.equal(messages.length, 1, "resend should keep the edited user turn and wait for the agent reply");
  assert.equal(messages[0].role, "user");
  assert.equal(app.context.__pendingState().reply, true, "resend chat should keep reply pending while Codex works");
  assert.equal(app.run("__thinkingProbe()").includes("Working for"), true, "resend chat should show the normal working UI");
  const chatCalls = app.context.__apiCalls.filter((call) => call.endpoint === "/api/research/chat");
  assert.equal(chatCalls.length, 1, "resend should call chat once");
  assert.equal(chatCalls[0].body.clientMessageId, "u1", "resend should identify the edited message");
  assert.equal(chatCalls[0].body.resendContext.forceFreshSession, true, "resend should force a fresh non-resumed chat session");
  assert.equal(chatCalls[0].body.resendContext.archivedCount, 1, "resend should archive the truncated assistant tail");
  assert.equal(app.context.__startedFramingBrief, undefined, "resend must not start framing");
}

async function testResendRendersEditedUserBeforeSlowUploadCollection() {
  const app = loadAppContext();
  app.run(`
    __setMessages([
      { id: "u1", role: "user", kind: "text", text: "old question", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "old answer", created_at: "2026-06-17T10:00:01.000Z" }
    ]);
    __installBlockingCollect();
  `);
  const pending = app.run('resendConversationMessage("u1", "edited question while upload waits")');
  await Promise.resolve();
  await Promise.resolve();
  const messages = app.context.__messages();
  assert.equal(messages.length, 1, "resend should truncate stale tail immediately");
  assert.equal(messages[0].text, "edited question while upload waits", "edited user turn should be visible before slow file collection finishes");
  assert.equal(app.context.__pendingState().reply, true, "resend should mark reply pending before slow file collection finishes");
  assert.ok(app.context.__collectSeen.renderCount > 0, "edited message should render before collectUploadFiles waits");
  app.context.__resolveCollect();
  await pending;
  assert.equal(app.context.__apiCalls.some((call) => call.endpoint === "/api/research/chat"), true, "resend should still call chat after collection resolves");
}

async function testLegacyRecordedInterventionMessageStillRenders() {
  const app = loadAppContext();
  app.run(`
    __setMessages([
      { id: "u1", role: "user", kind: "text", text: "old method instruction", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "i1", role: "assistant", kind: "intervention-recorded", text: "Recorded this as a pending human intervention: research_trajectory/human_interventions/I0011_ui_intervention.md.", created_at: "2026-06-17T10:00:01.000Z" }
    ]);
  `);
  assert.equal(app.context.__messages()[1].kind, "intervention-recorded", "legacy intervention-recorded history should still be accepted");
  assert.equal(app.context.__messages()[1].text.includes("I0011_ui_intervention.md"), true, "legacy acknowledgement should retain the recorded path");
}

async function testEditPreProjectMessageUsesChat() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({ id: "", session_id: "", status: "idle", mode: "", transcript: [] });
    __setMessages([
      { id: "u-initial", role: "user", kind: "text", text: "old initial brief", created_at: "2026-06-17T10:00:00.000Z" }
    ]);
  `);
  await app.run('resendConversationMessage("u-initial", "edited initial brief")');
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat", "editing a pre-project message should regenerate a chat reply");
  assert.equal(app.context.__apiCalls[0].body.message, "edited initial brief");
  assert.equal(app.context.__apiCalls[0].body.clientMessageId, "u-initial");
  assert.equal(app.context.__startedFramingBrief, undefined, "editing a pre-project message must not start the framing helper");
  assert.equal(app.context.__confirmMessageLog().length, 0, "pre-project chat resend should not require regenerate confirmation");
}

async function testEditPreProjectMessageDoesNotUseRegenerateConfirmation() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "";
    appState.framing.project_ready = false;
    appState.trials = [];
    __setSession({ id: "", session_id: "", status: "idle", mode: "", transcript: [] });
    __setMessages([
      { id: "u-initial", role: "user", kind: "text", text: "old initial brief", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "old answer", created_at: "2026-06-17T10:00:01.000Z" }
    ]);
    __setConfirmNext(false);
  `);
  await app.run('resendConversationMessage("u-initial", "edited initial brief")');
  const messages = app.context.__messages();
  assert.equal(messages.length, 1, "pre-project chat resend should truncate stale later messages and wait for a fresh answer");
  assert.equal(messages[0].text, "edited initial brief");
  assert.ok(messages[0].edited_at, "pre-project chat resend should mark the edited message");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/chat");
  assert.equal(app.context.__confirmMessageLog().length, 0, "pre-project chat resend should not show the framing confirmation");
  assert.equal(app.context.__startedFramingBrief, undefined);
}

async function testEditAttachmentsCanRemoveRetainAndAdd() {
  const app = loadAppContext();
  app.run(`
    __setMessages([
      {
        id: "u1",
        role: "user",
        kind: "text",
        text: "old question",
        created_at: "2026-06-17T10:00:00.000Z",
        attachments: [
          { kind: "link", path: "resources/old/paper.pdf", category: "literature", alreadyImported: true },
          { kind: "upload", name: "old_note.md", category: "user_input", type: "text/markdown", size: 12 }
        ]
      },
      { id: "a1", role: "assistant", kind: "text", text: "old answer", created_at: "2026-06-17T10:00:01.000Z" }
    ]);
    __startEdit("u1");
    __removeEditAttachment("u1", "resources:0");
    __addEditResource("u1", "/tmp/new-folder", { category: "ongoing_work" });
    __addEditUpload("u1", { name: "new_note.md", type: "text/markdown", size: 8, lastModified: 1, contentBase64: "bmV3IG5vdGU=" }, { category: "user_input" });
  `);
  const draftState = app.run('__editDraftState("u1")');
  assert.equal(draftState.uploads.length, 1, `edit draft should contain the new upload: ${JSON.stringify(draftState)}`);
  assert.equal(app.run('__editUploadHasFile("u1")'), true, "edit draft upload should retain its File object");
  const uploadPayload = await app.run('__collectEditUploads("u1")');
  assert.equal(uploadPayload.length, 1, "edit draft upload should be collectable before resend");
  await app.run('resendConversationMessage("u1", "")');
  const call = app.context.__apiCalls.find((item) => item.endpoint === "/api/research/chat");
  assert.ok(call, "edit attachment resend should call chat");
  assert.equal(call.endpoint, "/api/research/chat");
  assert.equal(call.body.message, "Attached 3 resources.", "attachment-only edited resend should use attachment summary text");
  assertJsonEqual(call.body.resourceLinks, [{ path: "/tmp/new-folder", category: "ongoing_work" }], "resend should include only retained/new current link attachments");
  assertJsonEqual(call.body.retainedAttachments, [{ kind: "upload", name: "old_note.md", path: "", category: "user_input", type: "text/markdown", size: 12, alreadyImported: false }], "resend should retain old upload metadata without re-uploading it");
  assert.equal(call.body.files.length, 1, "new edit upload should be submitted as a fresh upload");
  assert.equal(call.body.files[0].name, "new_note.md");
  assert.equal(call.body.files[0].contentBase64, "bmV3IG5vdGU=");
  assert.equal(app.context.__messages()[0].attachments.length, 3, "edited visible message should reflect current attachments only");
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
  const thinkingHtml = app.run("__thinkingProbe()");
  assert.equal(thinkingHtml.includes("Trial 1"), true, "pending UI should name the optimistic trial immediately");
  assert.equal(thinkingHtml.includes("Working for"), true, "pending UI should show the running timer immediately");
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

function testStartAutoresearchAppearsAtAssistantReplyEnd() {
  const app = loadAppContext();
  app.run(`
    __setSession({ id: "s1", session_id: "sid", status: "completed", mode: "framing", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
    __setMessages([
      { id: "a1", role: "assistant", kind: "text", text: "Updated PROJECT.md and it is ready.", created_at: "2026-06-17T10:00:01.000Z" },
      { id: "p1", role: "assistant", kind: "project", text: "Project draft", artifact: { path: "PROJECT.md", text: "# Project\\n\\nReady to launch." }, created_at: "2026-06-17T10:00:02.000Z" }
    ]);
  `);
  const html = app.run("__framingThreadHtmlProbe()");
  const assistantIndex = html.indexOf("Updated PROJECT.md and it is ready.");
  const linkIndex = html.indexOf('data-inline-fullscreen="PROJECT.md"');
  const launchIndex = html.indexOf("data-project-launch");
  const copyIndex = html.indexOf("message-copy-button");
  const projectInlineIndex = html.indexOf("project-draft-inline");
  const actionRowIndex = html.indexOf("has-project-launch");
  assert.ok(assistantIndex >= 0, "assistant reply should render");
  assert.ok(linkIndex > assistantIndex, "PROJECT.md link should sit after the assistant reply");
  assert.ok(projectInlineIndex > assistantIndex && actionRowIndex > projectInlineIndex, "PROJECT.md reference should sit above the copy/start action row");
  assert.ok(copyIndex > linkIndex && launchIndex > copyIndex, "Start autoresearch should sit on the copy action row after the copy button");
  assert.equal(html.includes("has-project-launch"), true, "Start action should share the assistant action row");
  assert.equal(html.includes("project-rendered"), false, "PROJECT.md must not render expanded markdown by default");
  assert.equal(html.includes("inline-fullscreen-button"), false, "collapsed PROJECT.md should use the text link, not a fullscreen icon button");
  assert.equal(html.includes("data-project-edit"), false, "assistant-attached PROJECT.md footer should not contain inline edit controls");
}

function testStartAutoresearchAppearsWhenProjectArtifactPrecedesReply() {
  const app = loadAppContext();
  app.run(`
    __setSession({ id: "s1", session_id: "sid", status: "completed", mode: "chat", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
    __setMessages([
      { id: "u1", role: "user", kind: "text", text: "Let's discuss this prior work.", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "p1", role: "assistant", kind: "project", text: "Project draft", artifact: { path: "PROJECT.md", text: "# Project\\n\\nReady to launch." }, created_at: "2026-06-17T10:00:14.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "I recorded the launch framing in PROJECT.md.", created_at: "2026-06-17T10:00:29.000Z" }
    ]);
  `);
  const html = app.run("__framingThreadHtmlProbe()");
  const assistantIndex = html.indexOf("I recorded the launch framing in PROJECT.md.");
  const linkIndex = html.indexOf('data-inline-fullscreen="PROJECT.md"');
  const launchIndex = html.indexOf("data-project-launch");
  assert.ok(assistantIndex >= 0, "final assistant reply should render");
  assert.ok(linkIndex > assistantIndex, "PROJECT.md link should attach to the final assistant reply even when the artifact was recorded earlier");
  assert.ok(launchIndex > linkIndex, "Start autoresearch should attach after the PROJECT.md link");
  assert.equal(html.includes("Project draft"), false, "standalone project artifact message should stay collapsed out of the thread");
}

function testChatGeneratedProjectDraftIsSurfaced() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    coldFiles["PROJECT.md"] = "";
    appState.files.project.text = "# Project\\n\\nReady from chat.";
    appState.framing.project_ready = false;
    appState.framing.messages = [
      { id: "u1", role: "user", kind: "text", text: "Please draft PROJECT.md for this study.", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "I drafted a project frame after answering the request.", created_at: "2026-06-17T10:00:01.000Z" }
    ];
    __setSession({ id: "s-chat", session_id: "sid", status: "completed", mode: "chat", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
    __restore();
  `);
  const messages = app.context.__messages();
  const project = messages.find((message) => message.kind === "project");
  assert.ok(project, "ready PROJECT.md from chat should be surfaced as a draft card");
  assert.equal(project.artifact.path, "PROJECT.md");
  assert.equal(project.artifact.text, "# Project\n\nReady from chat.");
  const html = app.run("__framingThreadHtmlProbe()");
  assert.equal(html.includes("data-project-launch"), true, "chat-generated PROJECT.md attachment should keep the canonical launch button");
  assert.equal(html.includes('data-inline-fullscreen="PROJECT.md"'), true, "chat-generated PROJECT.md attachment should expose the collapsed file link");
  assert.equal(html.includes("project-rendered"), false, "chat-generated PROJECT.md should stay collapsed by default");
}

function testStartAutoresearchUsesCurrentProjectDraftWithoutArtifactMessage() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    __setMessages([
      { id: "u1", role: "user", kind: "text", text: "Which venue?", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "I recommend Nature Human Behaviour and updated the launch frame.", created_at: "2026-06-17T10:00:01.000Z" }
    ]);
    appState.project = { id: activeProjectId, display_name: "Loaded project" };
    appState.projects = [];
    appState.files.project.text = "# Project\\n\\nReady from file state.";
    appState.framing.project_ready = true;
    __setSession({ id: "s-chat", session_id: "sid", status: "completed", mode: "chat", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
  `);
  const html = app.run("__framingThreadHtmlProbe()");
  assert.equal(html.includes("I recommend Nature Human Behaviour"), true, "assistant host should render");
  assert.equal(html.includes("data-project-launch"), true, "ready PROJECT.md should expose Start even without a project artifact message");
  assert.equal(html.includes('data-inline-fullscreen="PROJECT.md"'), true, "ready PROJECT.md should expose the file link");
  assert.equal(html.includes("Ready from file state"), false, "PROJECT.md should stay collapsed instead of rendering inline");
  assert.equal(html.includes("data-project-edit"), false, "collapsed footer should not contain inline edit controls");
}

function testProjectLaunchFallbackWithoutAssistantReply() {
  const app = loadAppContext();
  app.run(`
    document.querySelector("#project-draft-editor").value = "";
    __setMessages([
      { id: "u1", role: "user", kind: "text", text: "Launch this.", created_at: "2026-06-17T10:00:00.000Z" }
    ]);
    appState.files.project.text = "# Project\\n\\nReady fallback.";
    appState.framing.project_ready = true;
    __setSession({ id: "s-chat", session_id: "sid", status: "completed", mode: "chat", started_at: "2026-06-17T10:00:00.000Z", transcript: [] });
    __renderFramingConversationImpl();
  `);
  const fallback = app.run("__projectLaunchFallbackProbe()");
  assert.equal(fallback.hidden, true, "composer fallback must stay hidden; Start belongs to assistant replies, not the input box");
  assert.equal(fallback.html.includes("data-project-launch"), false);
}

function testMarkdownSoftBreakRendersAsSeparator() {
  const app = loadAppContext();
  const html = app.run('markdownToHtml("# Project\\n\\nIntro text.\\n\\n...\\n\\nNext section.\\n\\n---\\n\\nFinal section.")');
  assert.equal(html.includes("<p>...</p>"), false, "standalone ellipsis should not render as a bulky paragraph");
  assert.equal(html.includes('class="markdown-section-break"'), true, "standalone ellipsis should render as a styled separator");
  assert.equal(html.includes("<hr>"), true, "markdown horizontal rules should keep semantic hr markup");
}

function testMarkdownOrderedListsPreserveExplicitNumbers() {
  const app = loadAppContext();
  const html = app.run('markdownToHtml("1. **First**\\n\\nBody text.\\n\\n2. **Second**\\n\\n- detail\\n\\n3. **Third**")');
  assert.equal(html.includes('<ol class="is-explicit-markers"><li value="1" data-marker="1"><strong>First</strong></li></ol>'), true, "first ordered segment should render marker 1");
  assert.equal(html.includes('<ol class="is-explicit-markers" start="2"><li value="2" data-marker="2"><strong>Second</strong></li></ol>'), true, "second ordered segment should preserve marker 2 after a paragraph break");
  assert.equal(html.includes('<ol class="is-explicit-markers" start="3"><li value="3" data-marker="3"><strong>Third</strong></li></ol>'), true, "third ordered segment should preserve marker 3 after a bullet block");
  assert.equal(html.includes('data-marker="2"'), true, "ordered markers should be available to the custom CSS counter");
  assert.equal(html.includes('data-marker="3"'), true, "later ordered markers should be available to the custom CSS counter");

  const jump = app.run('markdownToHtml("7. Seven\\n8. Eight")');
  assert.equal(jump.includes('<ol class="is-explicit-markers" start="7">'), true, "ordered lists that start above 1 should keep their semantic start value");
  assert.equal(jump.includes('<li value="7" data-marker="7">Seven</li>'), true, "first explicit marker should be preserved");
  assert.equal(jump.includes('<li value="8" data-marker="8">Eight</li>'), true, "subsequent explicit marker should be preserved");
}

function testMarkdownImagesResolveRelativeToSourceFile() {
  const app = loadAppContext();
  const html = app.run('markdownToHtml("Preview image:\\n\\n![Figure F000001](figures/generated/calibration.png)", { basePath: "manuscript/BLUEPRINT.md" })');
  assert.equal(html.includes('class="markdown-image-preview"'), true, "markdown images should render as image previews");
  assert.equal(html.includes('src="/api/file/raw?path=manuscript%2Ffigures%2Fgenerated%2Fcalibration.png'), true, "relative blueprint images should resolve under manuscript/");
  assert.equal(html.includes('data-inline-fullscreen="figures/generated/calibration.png"'), false, "markdown image syntax should not degrade into a file button");

  const checkpointHtml = app.run('markdownToHtml("![Figure F000001](figures/generated/calibration.png)", { basePath: "research_trajectory/checkpoints/000021_source_integration/manuscript/BLUEPRINT.md" })');
  assert.equal(
    checkpointHtml.includes('src="/api/file/raw?path=research_trajectory%2Fcheckpoints%2F000021_source_integration%2Fmanuscript%2Ffigures%2Fgenerated%2Fcalibration.png'),
    true,
    "checkpoint manuscript images should resolve to the checkpoint snapshot, not the latest manuscript"
  );
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
  assert.equal(assistantHtml.includes('aria-label="Copy response"'), true, "assistant copy icon should use response-oriented labeling");
  assert.equal(assistantHtml.includes(encodeURIComponent("Copy this assistant message")), true);
  assert.equal(projectHtml.includes("message-copy-button"), true, "compact PROJECT.md messages should expose a copy icon");
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
        { id: "tu1", role: "user", kind: "user", raw_type: "ui.goal", content: "Start autoresearch loop.", created_at: "2026-06-17T10:00:00.000Z" },
        { id: "tc1", role: "command", kind: "command", raw_type: "process.started", content: "codex exec resume", created_at: "2026-06-17T10:00:01.000Z" },
        { id: "ta1", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Checking sources.", created_at: "2026-06-17T10:00:04.000Z" },
        { id: "ta2", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Narrowing the evidence matrix for Trial 1.", created_at: "2026-06-17T10:00:04.500Z" },
        { id: "tc2", role: "command", kind: "command", raw_type: "process.started", content: "git status --short", created_at: "2026-06-17T10:00:05.000Z" }
      ]
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("Current session activity"), false, "trial timeline must not append the old current-session activity card");
  assert.equal(html.includes("Latest session activity"), false, "trial timeline must not append legacy session activity labels");
  assert.equal(html.includes("Codex is working on Trial 1"), false, "running trials should not render the verbose active run label");
  assert.equal(html.includes("trial-history-micro-spinner"), true, "running autoresearch header should show the micro spinner");
  assert.equal(html.includes("trial-history-card is-expanded is-running"), true, "running autoresearch panel should default to expanded while exposing running state");
  assert.equal(html.includes("trial-report-card is-running"), true, "running trial panel should use the standard trial report card layout");
  assert.equal(html.includes("Pause after current turn"), true, "running trial panel should expose a loop pause button");
  assert.equal(html.includes("data-pause-autoresearch"), true, "contextual pause button should pause the loop after the current turn");
  assert.equal(html.includes("Stop current run"), false, "running trial panel should not duplicate the composer stop control");
  assert.equal(html.includes("data-stop-current-run"), false, "running trial panel should not render a separate stop control");
  const actionButtons = app.run("__composerActionButtonsProbe()");
  assert.equal(actionButtons.coldStopMode, "true", "empty autoresearch composer should turn the send button into stop");
  assert.equal(actionButtons.coldClass.includes("is-stop-mode"), true, "composer stop affordance should use stop-mode styling");
  assert.equal(actionButtons.coldDisabled, false, "composer stop affordance should remain clickable while the run is active");
  assert.equal(html.includes("trial-report-control-actions"), true, "running trial controls should use the standard trial action row");
  assert.equal(html.includes("Live trial activity"), true, "running trial event details should be folded under the standard trial card");
  assert.equal(html.includes("data-resume-autoresearch"), false, "running trial panel should not duplicate resume controls");
  assert.equal(html.includes("data-restart-autoresearch"), false, "running trial panel should not duplicate restart controls");
  assert.equal(html.includes("Open latest manuscript"), false, "first running trial should not expose latest manuscript before a report exists");
  assert.equal(html.includes("Report pending"), false, "running trial should not render a low-information pending report card");
  assert.equal(html.includes("Report is not available yet."), false, "running trial should not render a low-information pending report card");
  assert.equal(html.includes("<span>Trial activity</span>"), false, "running trial details should keep the live activity label instead of a duplicate report label");
  const liveStatusBlock = html.match(/<section class="trial-live-status-block"[\s\S]*?<\/section>/)?.[0] || "";
  assert.equal(liveStatusBlock.includes("Live status"), true, "running trial should render the unified live status section");
  assert.equal(liveStatusBlock.includes("Checking sources."), false, "running trial should keep older process updates in the folded activity");
  assert.equal(liveStatusBlock.includes("Narrowing the evidence matrix for Trial 1."), true, "running trial should show the latest process update outside the folded activity");
  assert.equal(liveStatusBlock.includes("git status --short"), false, "running trial visible updates should not promote raw commands");
  const composer = app.run("__composerSuggestionsProbe()");
  assert.equal(composer.hidden, true, "autoresearch composer suggestion row should stay hidden while running");
  assert.equal(composer.html.includes("Show autoresearch"), false, "composer suggestions should not expose Show autoresearch");
  assert.equal(composer.html.includes("Status"), false, "composer suggestions should not expose Status");
  assert.equal(composer.html.includes("Processes"), false, "composer suggestions should not expose Processes");
  const thinkingHtml = app.run("__thinkingProbe()");
  assert.equal(thinkingHtml.includes("Codex is working on Trial 1"), false, "working bubble should avoid the verbose active run label");
  assert.equal(thinkingHtml.includes("Working for"), true, "working bubble should show elapsed running time");
  assert.equal(thinkingHtml.includes("Trial 1"), true, "working bubble should include the trial axis for autoresearch runs");
  assert.equal(thinkingHtml.includes("Current run activity"), false, "autoresearch working bubble should not duplicate the trial live activity panel");
  assert.equal(thinkingHtml.includes("Live trial activity"), true, "autoresearch working bubble should keep the trial live activity panel");
  assert.equal(thinkingHtml.includes("<span>Run activity</span>"), false, "autoresearch working bubble should not use the ordinary chat activity label");
  const thinkingLiveStatusBlock = thinkingHtml.match(/<section class="trial-live-status-block"[\s\S]*?<\/section>/)?.[0] || "";
  assert.equal(thinkingLiveStatusBlock.includes("Update: Narrowing the evidence matrix for Trial 1."), false, "trial live status should not duplicate updates as a prefixed summary");
  assert.equal(app.run("__progressSummaryProbe()"), "Update: Narrowing the evidence matrix for Trial 1.", "collapsed current run summary should prefer readable Codex updates over later commands");
}

function testRunningTrialHidesArtifactButtons() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000018_best_effect_analysis_method_design",
      iteration: 18,
      status: "reported",
      is_closed: false,
      report_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/REPORT.md",
      review_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Gate update in progress."
    }];
    __setSession({
      id: "s18",
      session_id: "sid",
      status: "running",
      mode: "goal",
      loop_active: true,
      loop_iteration: 18,
      started_at: "2026-06-17T10:00:00.000Z",
      active_run: {
        running: true,
        mode: "goal",
        run_id: "s18",
        started_at: "2026-06-17T10:00:00.000Z",
        trial_iteration: 18,
        trial_label: "Trial 18",
        status_label: "Codex is working on Trial 18"
      },
      transcript: [
        { id: "tu18", role: "user", kind: "user", raw_type: "ui.goal", content: "Continue autoresearch.", created_at: "2026-06-17T10:00:00.000Z" },
        { id: "ta18", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Update: Gate update in progress.", created_at: "2026-06-17T10:00:04.000Z" }
      ]
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("Open latest manuscript"), false, "latest manuscript action should no longer live in the header");
  assert.equal(html.includes("Open manuscript"), false, "running trial panel should not expose a manuscript artifact before the trial boundary closes");
  assert.equal(html.includes("Open report"), false, "running trial panel should not expose report artifacts before the trial boundary closes");
  assert.equal(html.includes("Open review"), false, "running trial panel should not expose review artifacts before the trial boundary closes");
  assert.equal(html.includes("trial-report-open-actions"), false, "running trial panel should not render artifact open actions");
}

function testTrialOpenButtonsUseManuscriptSnapshotWhenAvailable() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000003_manuscript_revision",
      iteration: 3,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000003_manuscript_revision/REPORT.md",
      review_path: "research_trajectory/trials/000003_manuscript_revision/reviews/FINAL_GATE_REVIEW.md",
      manuscript_snapshot_path: "research_trajectory/checkpoints/000003_manuscript_revision/manuscript/BLUEPRINT.md",
      manuscript_snapshot_exists: true,
      report_summary: "Manuscript revised."
    }];
    __setSession({
      id: "s3",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 3,
      gate: { status: "continue" },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  const openGroup = html.match(/<div class="trial-report-open-actions">([\s\S]*?)<\/div>/)?.[1] || "";
  assert.equal(openGroup.includes('data-inline-fullscreen="research_trajectory/checkpoints/000003_manuscript_revision/manuscript/BLUEPRINT.md"'), true, "trial manuscript action should open the checkpoint manuscript snapshot");
  assert.equal(openGroup.includes('data-inline-fullscreen="manuscript/BLUEPRINT.md"'), false, "snapshot-backed trials should not open the latest manuscript from the trial action");
  assert.ok(openGroup.indexOf("Open manuscript") < openGroup.indexOf("Open report"), "snapshot manuscript action should still lead report artifacts");
}

function testTrialOpenButtonsFallBackToLatestManuscript() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000004_legacy_trial_without_checkpoint",
      iteration: 4,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000004_legacy_trial_without_checkpoint/REPORT.md",
      review_path: "research_trajectory/trials/000004_legacy_trial_without_checkpoint/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Legacy trial."
    }];
    __setSession({
      id: "s4",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 4,
      gate: { status: "continue" },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  const openGroup = html.match(/<div class="trial-report-open-actions">([\s\S]*?)<\/div>/)?.[1] || "";
  assert.equal(openGroup.includes('data-inline-fullscreen="manuscript/BLUEPRINT.md"'), true, "trials without a snapshot should keep the latest manuscript fallback");
  assert.equal(openGroup.includes("Open manuscript"), true, "fallback manuscript action should keep the same visible label");
}

function testManualTrialSelectionOverridesRunningPanel() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000016_reported_baseline",
      iteration: 16,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000016_reported_baseline/REPORT.md",
      review_path: "research_trajectory/trials/000016_reported_baseline/reviews/FINAL_GATE_REVIEW.md",
      manuscript_snapshot_path: "research_trajectory/checkpoints/000016_reported_baseline/manuscript/BLUEPRINT.md",
      manuscript_snapshot_exists: true,
      report_summary: "Trial 16 historical manuscript panel."
    }, {
      id: "000018_latest_done",
      iteration: 18,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000018_latest_done/REPORT.md",
      review_path: "research_trajectory/trials/000018_latest_done/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Trial 18 latest closed panel."
    }];
    __setSession({
      id: "s19",
      session_id: "sid",
      status: "running",
      mode: "goal",
      loop_active: true,
      loop_iteration: 19,
      started_at: "2026-06-17T10:00:00.000Z",
      active_run: {
        running: true,
        mode: "goal",
        run_id: "s19",
        started_at: "2026-06-17T10:00:00.000Z",
        trial_iteration: 19,
        trial_label: "Trial 19",
        status_label: "Codex is working on Trial 19"
      },
      trajectory: {
        latest_active_trial: "000018_latest_done",
        next_trial_number: 20
      },
      gate: { status: "continue" },
      transcript: [
        { id: "tu19", role: "user", kind: "user", raw_type: "ui.goal", content: "Continue autoresearch.", created_at: "2026-06-17T10:00:00.000Z" },
        { id: "ta19", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Running Trial 19 update.", created_at: "2026-06-17T10:00:04.000Z" }
      ]
    });
    selectedTrialIndex = 16;
    trialStripScrollState = { mode: "manual", left: 0, liveIteration: 19, selectedIteration: 16, touchedAt: Date.now() };
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes('data-trial-select="19"'), true, "running trial chip should remain visible while another trial is selected");
  assert.equal(html.includes("Trial 16 historical manuscript panel."), true, "manual selection should render the selected historical trial panel while a run is active");
  assert.equal(html.includes("Running Trial 19 update."), false, "manual selection should not force the running trial live panel into the selected trial body");
  assert.equal(html.includes("Live trial activity"), false, "manual selection should hide the running trial live details until the running chip is selected");
  assert.equal(html.includes('data-inline-fullscreen="research_trajectory/checkpoints/000016_reported_baseline/manuscript/BLUEPRINT.md"'), true, "selected historical trial should keep its manuscript snapshot action");
}

function testAutoresearchPanelCollapsePersists() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000018_best_effect_analysis_method_design",
      iteration: 18,
      status: "reported",
      is_closed: true,
      plan_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/PLAN.md",
      report_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/REPORT.md",
      review_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/reviews/FINAL_GATE_REVIEW.md",
      objective: "Compare candidate effect-analysis designs before the final gate.",
      report_summary: "Gate complete."
    }];
    __setSession({
      id: "s18",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 18,
      transcript: [{
        id: "assistant-progress-18",
        role: "assistant",
        raw_type: "item.message",
        content: "Synthesizing the latest evidence table.",
        created_at: "2026-01-01T00:00:00Z"
      }]
    });
  `);
  const initial = app.run("__autoresearchPanelCollapseProbe()");
  assert.equal(initial.collapsed, false, "autoresearch panel should default to expanded");
  assert.equal(initial.html.includes('data-autoresearch-panel-collapsed="false"'), true, "expanded state should render on the trial card by default");
  assert.equal(initial.html.includes("trial-history-title-row"), false, "trial history header should not render the redundant title/count row");
  assert.equal(initial.html.includes("trial-history-kicker-icon"), true, "trial history header should render the autoresearch glyph");
  assert.equal(initial.html.includes('href="#brand-mark-glyph"'), true, "trial history header should reuse the app brand glyph");
  assert.equal(initial.html.includes("trial-history-micro-spinner"), false, "completed autoresearch header should not animate");
  assert.equal(initial.html.includes("trial-history-kicker-status"), true, "trial history header should render inline trial status");
  assert.equal(initial.html.includes("Trial 18 · Done"), true, "trial status should render in the live strip meta column");
  assert.equal(initial.html.includes("Working on: Compare candidate effect-analysis designs before the final gate."), true, "trial header should include the plan objective when PLAN.md exists");
  assert.equal(initial.html.includes("trial-history-collapsed-summary"), false, "collapsed state should not render the old compact summary row");
  assert.equal(initial.html.includes("trial-history-latest\">Latest:"), false, "collapsed state should not render the redundant latest artifact line");
  assert.equal(initial.html.includes("trial-history-mini-axis"), false, "collapsed state should not render a right-side mini trial axis");
  assert.equal(initial.html.includes("trial-history-disclosure"), true, "collapsed state should expose the inline disclosure cue");
  assert.equal(initial.html.includes("Show all trials"), false, "collapsed state should not render the old right-side expand label");
  assert.equal(initial.html.includes("trial-history-toggle-icon"), false, "collapsed state should not render the old standalone chevron button");
  assert.equal(initial.html.includes("trial-history-latest-update"), true, "collapsed state should render the latest process update");
  assert.equal(initial.html.includes("Synthesizing the latest evidence table."), true, "collapsed state should include the latest agent progress text");
  assert.equal(initial.html.includes("trial-live-strip"), true, "trial history header should render the live strip shell");
  assert.equal(initial.html.includes("trial-live-main"), true, "live strip should keep the main collapse target separate");
  assert.equal(initial.html.includes("trial-live-actions"), true, "live strip should render a separate action cluster");
  assert.equal(initial.html.includes("trial-history-activity-button"), true, "live strip should expose an Activity button");
  const initialMainButton = initial.html.match(/<button class="trial-history-toggle trial-live-main"[\s\S]*?<\/button>/)?.[0] || "";
  assert.equal(initialMainButton.includes("data-activity-open"), false, "Activity button must not be nested inside the collapse button");
  const collapsed = app.run("__toggleAutoresearchPanelCollapse()");
  assert.equal(collapsed.collapsed, true, "toggle should collapse the autoresearch panel");
  assert.equal(collapsed.stored, "true", "collapsed state should persist in scoped localStorage");
  assert.equal(collapsed.html.includes('data-autoresearch-panel-collapsed="true"'), true, "collapsed state should render on the trial card");
  const expanded = app.run("__toggleAutoresearchPanelCollapse()");
  assert.equal(expanded.collapsed, false, "second toggle should expand the autoresearch panel again");
  assert.equal(expanded.stored, "false", "expanded state should persist in scoped localStorage");
  assert.equal(expanded.html.includes('data-autoresearch-panel-collapsed="false"'), true, "expanded state should render on the trial card");
  app.run(`
    appState.trials[0].is_closed = false;
    appState.trials[0].progress = {
      stage: "reviewing",
      stage_label: "Reviewing",
      stage_index: 5,
      total_stages: 6,
      reviewer_count: 3,
      reviewer_total: 8
    };
  `);
  const reviewing = app.run("__autoresearchPanelCollapseProbe()");
  assert.equal(reviewing.html.includes("Trial 18 · Reviewing"), true, "trial header should use the selected trial's real progress label when it is not complete");
  assert.equal(reviewing.html.includes("Trial 18: Incomplete"), false, "trial header should not collapse active progress into a generic incomplete status");
}

function testAutoresearchLiveStripZeroEventActivity() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [];
    activityPanelSources.clear();
    __setSession({
      id: "s22",
      session_id: "sid",
      status: "running",
      mode: "goal",
      loop_active: true,
      loop_iteration: 22,
      started_at: "2026-06-17T10:00:00.000Z",
      active_run: {
        running: true,
        mode: "goal",
        run_id: "s22",
        started_at: "2026-06-17T10:00:00.000Z",
        trial_iteration: 22,
        trial_label: "Trial 22",
        status_label: "Codex is working on Trial 22",
        progress: {
          stage_index: 1,
          stage_label: "Planning",
          detail: "Trial 22 is being prepared."
        }
      },
      transcript: [
        { id: "tu22", role: "user", kind: "user", raw_type: "ui.goal", content: "Continue autoresearch.", created_at: "2026-06-17T10:00:00.000Z" }
      ]
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("trial-live-strip"), true, "zero-event running trial should still render the live strip");
  assert.equal(html.includes("Trial 22 · Planning"), true, "zero-event running trial should show the active planning state");
  assert.equal(html.includes("Waiting for agent update."), true, "zero-event running trial should show a friendly waiting update");
  assert.equal(html.includes("trial-history-activity-button"), true, "zero-event running trial should still expose Activity");
  assert.equal(html.includes("<strong>waiting</strong>"), true, "zero-event Activity button should show waiting");
  const mainButton = html.match(/<button class="trial-history-toggle trial-live-main"[\s\S]*?<\/button>/)?.[0] || "";
  assert.equal(mainButton.includes("data-activity-open"), false, "zero-event Activity button must remain outside the collapse button");
  const keys = app.run("[...activityPanelSources.keys()]");
  assert.equal(keys.includes("trial-history:p1:22:running"), true, "zero-event live strip should register a running Activity source");
  const panel = app.run('__activityPanelProbe("trial-history:p1:22:running")');
  assert.equal(panel.hidden, false, "zero-event live strip Activity should open the Activity panel");
  assert.equal(panel.html.includes("Waiting for agent update."), true, "zero-event Activity panel should render the waiting empty state");
  const dock = app.run("__autoresearchDockProbe()");
  assert.equal(dock.dockClass.includes("is-running"), true, "floating dock should expose the running state class");
}

function testAutoresearchTrajectoryGraphIsNotRenderedInDock() {
  const app = loadAppContext();
  app.run(`
    activityPanelSources.clear();
    appState.trials = [
      {
        id: "000016_reference_and_submission_source_repair",
        iteration: 16,
        status: "reported",
        is_closed: true,
        report_path: "research_trajectory/trials/000016_reference_and_submission_source_repair/REPORT.md",
        review_path: "research_trajectory/trials/000016_reference_and_submission_source_repair/reviews/FINAL_GATE_REVIEW.md",
        objective: "Repair reference and source handling.",
        report_summary: "Reference repair complete."
      },
      {
        id: "000021_source_integration",
        iteration: 21,
        status: "reported",
        is_closed: true,
        report_path: "research_trajectory/trials/000021_source_integration/REPORT.md",
        review_path: "research_trajectory/trials/000021_source_integration/reviews/FINAL_GATE_REVIEW.md",
        objective: "Integrate public safety sources.",
        report_summary: "Source integration complete."
      }
    ];
    appState.trajectory_graph = { trials: [{ iteration: 22, title: "Hidden graph payload" }] };
    __setSession({
      id: "s21",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 21,
      trajectory: { next_trial_number: 22 },
      transcript: []
    });
  `);
  const expanded = app.run("__sessionTimelineProbe()");
  assert.equal(expanded.includes("research-trajectory-graph"), false, "expanded dock should not render the trajectory graph");
  assert.equal(expanded.includes("trajectory-lane"), false, "expanded dock should not render trajectory lanes");
  assert.equal(expanded.includes("Hidden graph payload"), false, "trajectory payload should not leak into the dock");
  assert.equal(expanded.includes("trial-live-strip"), true, "expanded dock should keep the live strip");
  assert.equal(expanded.includes("trial-strip"), true, "expanded dock should keep the trial strip");
  const collapsed = app.run("__toggleAutoresearchPanelCollapse()");
  assert.equal(collapsed.html.includes("research-trajectory-graph"), false, "collapsed dock should not render the trajectory graph");
  assert.equal(collapsed.html.includes("trial-live-strip"), true, "collapsed dock should keep the live strip");
}

function testAutoresearchPanelRendersInFloatingDock() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000018_best_effect_analysis_method_design",
      iteration: 18,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/REPORT.md",
      review_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Gate complete."
    }];
    __setSession({
      id: "s18",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 18,
      transcript: [{
        id: "assistant-progress-18",
        role: "assistant",
        raw_type: "item.message",
        content: "Synthesizing the latest evidence table.",
        created_at: "2026-01-01T00:00:00Z"
      }]
    });
  `);
  const dock = app.run("__autoresearchDockProbe()");
  assert.equal(dock.dockHidden, false, "autoresearch panel should be visible in the floating dock");
  assert.equal(dock.dockHtml.includes("trial-history-card"), true, "floating dock should own the trial history card");
  assert.equal(dock.dockHtml.includes("trial-live-strip"), true, "floating dock should render the research live strip");
  assert.equal(dock.dockHtml.includes("Trial 18 · Done"), true, "floating dock should preserve the panel header content");
  assert.equal(dock.dockHtml.includes("trial-history-activity-button"), true, "floating dock should expose the Activity trigger");
  assert.equal(dock.dockClass.includes("is-expanded"), true, "floating dock should expose the expanded state class");
  assert.equal(dock.threadHtml.includes("trial-history-card"), false, "trial history card should not remain in the transcript thread");
  assert.equal(dock.bodyClass.includes("has-autoresearch-dock"), true, "body should expose the autoresearch dock state");
  assert.equal(dock.shellDocked, true, "composer dock should stay active while the autoresearch dock is visible");
}

function testPausedAutoresearchActionsRenderInTrialPanel() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000001_method_design",
      iteration: 1,
      status: "working",
      is_closed: false,
      report_summary: "Method design needs another pass."
    }];
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 1,
      gate: { status: "continue" },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("data-resume-autoresearch"), true, "paused incomplete autoresearch should show Resume Autoresearch in the selected trial row");
  assert.equal(html.includes("<span>Resume</span>"), true, "paused incomplete autoresearch should use the short Resume label");
  assert.equal(html.includes("trial-action-icon-resume"), true, "paused incomplete autoresearch should render a Resume icon");
  assert.equal(html.includes("trial-report-open-actions"), true, "incomplete trials should still show manuscript artifact actions");
  assert.equal(html.includes("Open manuscript"), true, "incomplete trials should expose the manuscript from the artifact action group");
  assert.equal(html.includes("trial-report-control-actions"), true, "autoresearch controls should be grouped on the right side of the trial action row");
  assert.equal(html.includes('data-trial-continue="1"'), false, "incomplete trials without a report boundary should not show fork-style continue");
  assert.equal(html.includes("data-restart-autoresearch"), true, "paused incomplete autoresearch should keep Restart beside the trial actions");
  assert.equal(html.includes("<span>Restart</span>"), true, "paused incomplete autoresearch should use the short Restart label");
  assert.equal(html.includes("trial-action-icon-restart"), true, "paused incomplete autoresearch should render a Restart icon");
  assert.equal(html.includes("trial-danger-button"), true, "Restart should use the caution treatment");
  assert.equal(html.includes("trial-history-actions"), false, "autoresearch lifecycle actions should not render as a separate bottom row");
  assert.equal(html.includes("Show autoresearch"), false, "Trials panel should not expose the old Show autoresearch chip");
  assert.equal(html.includes(">Status<"), false, "Trials panel should not expose the old Status chip");
  assert.equal(html.includes(">Diff<"), false, "Trials panel should not expose the old Diff chip");
  assert.equal(html.includes("Pause after current turn"), false, "paused panel should not show running controls");
  const composer = app.run("__composerSuggestionsProbe()");
  assert.equal(composer.hidden, true, "composer suggestion row should be hidden for paused autoresearch");
  assert.equal(composer.html, "", "composer suggestion row should not render lifecycle chips");
}

function testAutoresearchPanelPersistsAfterFramingReply() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000017_table_appendix_provenance_repair",
      iteration: 17,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000017_table_appendix_provenance_repair/REPORT.md",
      review_path: "research_trajectory/trials/000017_table_appendix_provenance_repair/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Table appendix provenance repaired."
    }];
    __setMessages([
      {
        id: "u1",
        role: "user",
        kind: "text",
        text: "我觉得得用更好的方法，你先别考虑现在方法的思维，先考虑一下，从最好的效果和预期来说，应该怎么分析",
        created_at: "2026-06-25T00:00:00.000Z"
      },
      {
        id: "a1",
        role: "assistant",
        kind: "text",
        text: "Updated PROJECT.md for the pre-loop framing pass.",
        created_at: "2026-06-25T00:01:00.000Z"
      }
    ]);
    __setSession({
      id: "s-chat",
      session_id: "sid",
      status: "completed",
      mode: "framing",
      loop_active: false,
      loop_iteration: 17,
      gate: { status: "continue" },
      trajectory: {
        base_trial: "000016_reference_and_submission_source_repair",
        latest_active_trial: "000017_table_appendix_provenance_repair",
        next_trial_number: 18
      },
      expected_trial: {
        status: "pending",
        expected_iteration: 18,
        pending_intervention_ids: ["I0008"],
        pending_intervention_paths: ["research_trajectory/human_interventions/I0008_ui_intervention.md"],
        updated_at: "2026-06-25T00:11:20-04:00"
      },
      transcript: []
    });
  `);
  const html = app.run("__framingThreadHtmlProbe()");
  assert.equal(html.includes("Updated PROJECT.md for the pre-loop framing pass."), true, "ordinary framing reply should remain visible");
  assert.equal(html.includes("Trial 18"), true, "pending expected trial should remain visible after a framing reply");
  assert.equal(html.includes("Pending autoresearch step with I0008."), true, "pending intervention should be summarized in the trial panel");
  const reportCard = html.match(/<article class="trial-report-card[\s\S]*?<\/article>/)?.[0] || "";
  assert.equal((reportCard.match(/Pending autoresearch step with I0008\./g) || []).length, 1, "pending intervention summary should not duplicate inside the trial report card");
  assert.equal(html.includes("data-resume-autoresearch"), true, "pending expected trial should expose Resume autoresearch");
  assert.equal(html.includes('data-trial-select="17"'), true, "latest reported trial should remain available in the trial axis");
  assert.equal(html.includes("Latest: 000017_table_appendix_provenance_repair"), false, "redundant latest header context should not render");
}

function testReportedTrialShowsContinueFromThisTrial() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000001_method_design",
      iteration: 1,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000001_method_design/REPORT.md",
      review_path: "research_trajectory/trials/000001_method_design/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Method design reported.",
      progress: {
        detail: "3/8 reviewer gates are pass.",
        updated_at: "2026-06-25T07:01:00.000Z"
      }
    }];
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 1,
      gate: { status: "continue" },
      trajectory: {
        latest_active_trial: "000002_later_boundary",
        next_trial_number: 3
      },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("data-resume-autoresearch"), false, "reported trial boundary should not show generic Resume Autoresearch");
  assert.equal(html.includes('data-trial-continue="1"'), true, "reported trial boundary should keep the fork-style continue action");
  assert.equal(html.includes("Continue from this trial"), true, "reported trial boundary should use Continue copy");
  assert.equal(html.includes("trial-action-icon-continue"), true, "reported trial boundary should render a Continue icon");
  assert.equal(html.includes("trial-report-head-progress"), true, "reported trial progress detail should render in the header row");
  assert.equal(html.includes("3/8 reviewer gates are pass."), true, "reported trial progress detail should stay visible");
  assert.equal(html.includes('<p class="trial-progress-detail">3/8 reviewer gates are pass.'), false, "reported trial progress detail should not render as a separate row");
  assert.equal(html.includes("Open latest manuscript"), false, "reported trial boundary should not show the old header manuscript action");
  assert.equal(html.includes("Open manuscript"), true, "reported trial boundary should keep Open manuscript in artifact actions");
  assert.equal(html.includes("Open report"), true, "reported trial boundary should keep Open report");
  assert.equal(html.includes("Open review"), true, "reported trial boundary should keep Open review");
  assert.equal(
    html.includes("000001_method_design / research_trajectory/trials/000001_method_design/REPORT.md"),
    false,
    "reported trial header should not expose the long report path"
  );
  assert.equal(html.includes("trial-report-open-actions"), true, "Open actions should render in their own left-side group");
  assert.equal(html.includes("trial-report-control-actions"), true, "Autoresearch controls should render in their own right-side group");
  const openGroup = html.match(/<div class="trial-report-open-actions">([\s\S]*?)<\/div>/)?.[1] || "";
  assert.ok(openGroup.indexOf("Open manuscript") < openGroup.indexOf("Open report"), "Open manuscript should lead report artifacts");
  assert.ok(
    html.indexOf("trial-report-open-actions") < html.indexOf("trial-report-control-actions"),
    "Open actions should be ordered before autoresearch controls in the row"
  );
  assert.equal(html.includes("data-restart-autoresearch"), true, "reported trial boundary should keep Restart beside the trial actions");
}

function testLatestClosedTrialShowsResumeAutoresearch() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000018_best_effect_analysis_method_design",
      iteration: 18,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/REPORT.md",
      review_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Gate continues after Trial 18."
    }];
    __setSession({
      id: "s18",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 18,
      gate: {
        status: "blocked",
        raw_status: "needs_human",
        response_to_human: "Should the next trial run the CSEUA pilot now, or explicitly defer it?"
      },
      trajectory: {
        latest_active_trial: "000018_best_effect_analysis_method_design",
        next_trial_number: 19
      },
      expected_trial: {
        status: "fulfilled",
        expected_iteration: 18
      },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("data-resume-autoresearch"), true, "latest closed non-pass boundary should expose Resume autoresearch for the next trial");
  assert.equal(html.includes("<span>Resume</span>"), true, "latest closed non-pass boundary should use short Resume copy");
  assert.equal(html.includes("trial-action-icon-resume"), true, "latest closed non-pass boundary should render a Resume icon");
  assert.equal(html.includes("Blocked"), true, "latest closed boundary should not look Done when the gate is blocked");
  assert.equal(html.includes("Needs human input"), true, "latest closed needs_human boundary should show the human-facing prompt");
  assert.equal(html.includes("Should the next trial run the CSEUA pilot now, or explicitly defer it?"), true, "latest closed boundary should show response_to_human");
  assert.equal(html.includes('data-trial-continue="18"'), false, "latest boundary should not use fork-style Continue from this trial");
  assert.equal(html.includes("data-restart-autoresearch"), true, "latest closed boundary should keep Restart beside Resume");
}

function testLowInformationTrialSummaryIsOmitted() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000018_best_effect_analysis_method_design",
      iteration: 18,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/REPORT.md",
      review_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/reviews/FINAL_GATE_REVIEW.md"
    }];
    __setSession({
      id: "s18",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 18,
      transcript: [{
        id: "assistant-created-trial",
        role: "assistant",
        raw_type: "item.message",
        content: "Created Trial \`000018_best_effect_analysis_method_design\` as the next",
        created_at: "2026-01-01T00:00:00Z"
      }]
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  const reportVisibleBody = html.slice(html.indexOf("trial-report-head"), html.indexOf("trial-report-actions"));
  assert.equal(reportVisibleBody.includes("Created Trial"), false, "low-information Created Trial summary should not render in the visible trial report body");
  assert.equal(html.includes("trial-report-card"), true, "trial report should still render without the low-information summary");
}

function testNonActionableHumanResponseIsOmitted() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000018_best_effect_analysis_method_design",
      iteration: 18,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/REPORT.md",
      review_path: "research_trajectory/trials/000018_best_effect_analysis_method_design/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Gate continues after Trial 18."
    }];
    __setSession({
      id: "s18",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 18,
      gate: {
        status: "blocked",
        raw_status: "needs_human",
        response_to_human: "Trial 18 is already closed and applied intervention stop and return control to the UI at the closed Trial 18 boundary."
      },
      trajectory: {
        latest_active_trial: "000018_best_effect_analysis_method_design",
        next_trial_number: 19
      }
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("data-resume-autoresearch"), true, "latest closed non-pass boundary should still expose Resume");
  assert.equal(html.includes("Needs human input"), false, "non-actionable boundary status should not render as a human input prompt");
  assert.equal(html.includes("already closed and applied intervention stop"), false, "non-actionable boundary status should stay out of the trial panel");
  assert.equal(html.includes("Autoresearch blocked"), true, "blocked gate should still render a visible fallback notice");
}

function testBlockedGateWithoutHumanResponseShowsNotice() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000001_restart_intake_and_launch_rebuild",
      iteration: 1,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000001_restart_intake_and_launch_rebuild/REPORT.md",
      review_path: "research_trajectory/trials/000001_restart_intake_and_launch_rebuild/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Gate update · STATE.md gate refreshed"
    }];
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 1,
      loop_stop_reason: "gate_requires_human_input",
      gate: {
        status: "blocked",
        raw_status: "blocked",
        summary: "- Final gate reviewer: blocked"
      },
      trajectory: {
        latest_active_trial: "000001_restart_intake_and_launch_rebuild",
        next_trial_number: 2
      },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("Autoresearch blocked"), true, "blocked gate without response_to_human should render a visible notice");
  assert.equal(html.includes("The autoresearch loop paused at a blocked gate."), true, "blocked gate should show a useful fallback message");
  assert.equal(html.includes("Blocked"), true, "latest closed blocked gate should label the trial as Blocked");
  assert.equal(html.includes("data-resume-autoresearch"), true, "blocked boundary should keep the resume action available");
}

function testUnclosedPreviousTrialShowsClosingDuringNextLiveRun() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000001_restart_intake_and_launch_rebuild",
      iteration: 1,
      status: "reported",
      is_closed: false,
      report_path: "research_trajectory/trials/000001_restart_intake_and_launch_rebuild/REPORT.md",
      review_path: "research_trajectory/trials/000001_restart_intake_and_launch_rebuild/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Reviewing · 4/8 reviewer files",
      progress: {
        stage_label: "Reviewing",
        stage_index: 5,
        total_stages: 6,
        summary: "Reviewing · 4/8 reviewer files",
        detail: "0/8 reviewer gates are pass.",
        report_exists: true,
        reviewer_count: 4,
        reviewer_total: 8,
        stages: TRIAL_PROGRESS_STAGES
      }
    }];
    __setSession({
      id: "s2",
      session_id: "sid",
      status: "running",
      mode: "goal",
      loop_active: true,
      loop_iteration: 2,
      active_run: {
        running: true,
        mode: "goal",
        trial_iteration: 2,
        trial_label: "Trial 2",
        status_label: "Codex is working on Trial 2",
        progress: {
          stage_label: "Planning",
          stage_index: 1,
          total_stages: 6,
          summary: "Planning · waiting for trial files",
          detail: "Trial 2 has started, but its trial directory is not visible yet.",
          stages: TRIAL_PROGRESS_STAGES
        }
      },
      trajectory: {
        latest_active_trial: "000001_restart_intake_and_launch_rebuild",
        next_trial_number: 2
      },
      transcript: []
    });
    selectedTrialIndex = 1;
    trialStripScrollState = {
      mode: "manual",
      selectedIteration: 1,
      liveIteration: 2,
      touchedAt: Date.now(),
      left: 0
    };
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("Closing"), true, "previous unclosed trial should be labeled as closing during the next live run");
  assert.equal(html.includes("Incomplete"), false, "previous unclosed trial should not look like a failed/incomplete boundary during live handoff");
  assert.equal(html.includes('data-trial-continue="1"'), false, "previous trial should not expose continue controls while autoresearch is still running");
  assert.equal(html.includes("data-restart-autoresearch"), false, "old trial panel should not expose restart while a live run is active");
}

function testOldTrialDoesNotShowStaleHumanResponse() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000017_table_appendix_provenance_repair",
      iteration: 17,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000017_table_appendix_provenance_repair/REPORT.md",
      review_path: "research_trajectory/trials/000017_table_appendix_provenance_repair/reviews/FINAL_GATE_REVIEW.md",
      report_summary: "Trial 17 was closed earlier."
    }];
    __setSession({
      id: "s17",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 18,
      gate: {
        status: "blocked",
        raw_status: "needs_human",
        response_to_human: "This belongs to the latest Trial 18 gate, not Trial 17."
      },
      trajectory: {
        latest_active_trial: "000018_best_effect_analysis_method_design",
        next_trial_number: 19
      },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("Trial 17"), true, "old selected trial should still render");
  assert.equal(html.includes("This belongs to the latest Trial 18 gate, not Trial 17."), false, "old selected trial should not show the current gate's human prompt");
  assert.equal(html.includes("Needs human input"), false, "old selected trial should not show a stale needs-human notice");
}

function testPassedAutoresearchPanelHidesResumeAllowsRestart() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000002_final_gate",
      iteration: 2,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000002_final_gate/REPORT.md",
      report_summary: "Final gate passed."
    }];
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 2,
      gate: { status: "pass" },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("data-resume-autoresearch"), false, "passed autoresearch should not show Resume");
  assert.equal(html.includes("data-trial-continue"), false, "passed autoresearch should not show trial-boundary resume");
  assert.equal(html.includes("data-restart-autoresearch"), true, "passed autoresearch should still allow Restart");
  assert.equal(html.includes("<span>Restart</span>"), true, "passed autoresearch should use the short Restart label");
  assert.equal(html.includes("trial-action-icon-restart"), true, "passed autoresearch Restart should render an icon");
  assert.equal(html.includes("trial-danger-button"), true, "passed autoresearch Restart should use the caution treatment");
  const composer = app.run("__composerSuggestionsProbe()");
  assert.equal(composer.hidden, true, "composer suggestion row should stay hidden for passed autoresearch");
  assert.equal(composer.html.includes("Restart autoresearch"), false, "Restart should move out of composer suggestions");
}

function testStagedTrialContinueActionsRenderInTrialPanel() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000003_evidence_repair",
      iteration: 3,
      status: "reported",
      is_closed: true,
      report_path: "research_trajectory/trials/000003_evidence_repair/REPORT.md",
      report_summary: "Evidence repair completed."
    }];
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 3,
      gate: { status: "continue" },
      transcript: []
    });
    __setResumeTrialContext({
      iteration: 3,
      id: "000003_evidence_repair",
      name: "000003_evidence_repair",
      path: "research_trajectory/trials/000003_evidence_repair",
      reportPath: "research_trajectory/trials/000003_evidence_repair/REPORT.md",
      checkpointExists: true
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("data-resume-trial-submit"), true, "staged continue-from-trial should show its submit control in the Trials panel");
  assert.equal(html.includes("Continue from Trial 3"), true, "staged continue-from-trial should name the source trial");
  assert.equal(html.includes("data-resume-trial-remove"), true, "staged continue-from-trial should show a cancel control in the Trials panel");
  const composer = app.run("__composerSuggestionsProbe()");
  assert.equal(composer.hidden, true, "composer suggestion row should stay hidden for staged trial continue");
  assert.equal(composer.html.includes("Cancel trial continue"), false, "staged trial continue controls should move out of composer suggestions");
}

async function testResumeAutoresearchActionUsesResumeEndpoint() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [{
      id: "000004_resume_target",
      iteration: 4,
      status: "working",
      is_closed: false,
      report_summary: "Resume target."
    }];
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "completed",
      mode: "goal",
      loop_active: false,
      loop_iteration: 4,
      gate: { status: "continue" },
      trajectory: {
        latest_active_trial: "000003_previous_boundary",
        next_trial_number: 4
      },
      expected_trial: {
        status: "pending",
        expected_iteration: 4,
        pending_intervention_ids: ["I0012"],
        pending_intervention_paths: ["research_trajectory/human_interventions/I0012_ui_intervention.md"]
      },
      queued_chat_count: 1,
      queued_chat_latest_at: "2026-06-17T10:02:00.000Z",
      transcript: []
    });
  `);
  const opened = app.run("openResumeAutoresearchDialog()");
  assert.equal(opened, true, "resume action should open the confirmation dialog");
  assert.equal(app.run('$("#resume-autoresearch-dialog").open'), true, "resume dialog should be open");
  assert.equal(app.context.__apiCalls.length, 0, "opening resume dialog must not call the resume endpoint");
  assert.equal(app.run('$("#resume-autoresearch-summary").innerHTML.includes("Trial 4")'), true, "resume dialog should summarize the next trial boundary");
  assert.equal(app.run('$("#resume-autoresearch-summary").innerHTML.includes("I0012")'), true, "resume dialog should summarize pending interventions");
  app.run('$("#resume-autoresearch-instruction").value = "Do not send yet."; closeResumeAutoresearchDialog();');
  assert.equal(app.context.__apiCalls.length, 0, "cancelling resume dialog must not call the resume endpoint");
  assert.equal(app.run('$("#resume-autoresearch-dialog").open'), false, "cancelled resume dialog should close");
  app.run("openResumeAutoresearchDialog()");
  app.run('$("#resume-autoresearch-instruction").value = "Prioritize quote-backed method design."');
  const sent = await app.run("confirmResumeAutoresearch()");
  assert.equal(sent, true, "confirming resume should submit successfully");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/research/resume", "confirmed resume action should use the resume endpoint");
  assert.equal(app.context.__apiCalls[0].body.settings.backend, "codex", "confirmed resume action should include current settings");
  assert.equal(app.context.__apiCalls[0].body.resumeInstruction, "Prioritize quote-backed method design.", "confirmed resume action should include the optional instruction");
  assert.equal(app.context.__messages().length, 0, "confirmed resume action should not append a legacy command row");
  assert.equal(app.run('$("#resume-autoresearch-dialog").open'), false, "successful resume confirmation should close the dialog");
}

function testRunningTrialIgnoresPreviousRunUpdate() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [];
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "running",
      mode: "goal",
      loop_active: true,
      loop_iteration: 18,
      started_at: "2026-06-17T09:00:00.000Z",
      active_run: {
        running: true,
        mode: "goal",
        run_id: "s1",
        started_at: "2026-06-17T10:00:10.000Z",
        trial_iteration: 18,
        trial_label: "Trial 18",
        status_label: "Codex is working on Trial 18",
        progress: {
          stage_index: 1,
          stage_label: "Planning",
          detail: "Trial 18 has started, but its trial directory is not visible yet."
        }
      },
      transcript: [
        { id: "old1", role: "assistant", kind: "assistant", raw_type: "item.completed", iteration: 18, content: "Stale previous assistant response.", created_at: "2026-06-17T10:00:04.000Z" },
        { id: "cmd1", role: "command", kind: "command", raw_type: "process.started", iteration: 18, content: "codex exec resume", created_at: "2026-06-17T10:00:11.000Z" }
      ]
    });
  `);
  const html = app.run("__thinkingProbe()");
  assert.equal(html.includes("Stale previous assistant response."), false, "running trial live summary should ignore updates before the active run start");
  assert.equal(html.includes("Update:"), false, "running trial should not show an Update line before the current run has a readable update");
  assert.equal(html.includes("Command: codex exec resume"), false, "running trial should not expose raw commands as the main summary");
  assert.equal(html.includes("Trial 18 has started, but its trial directory is not visible yet."), true, "running trial should still show current progress detail");
  assert.equal(html.includes("codex exec resume"), false, "running trial should not inline raw command details");
  const panel = app.run("__activityPanelProbe()");
  assert.equal(panel.hidden, false, "live activity should open in the Activity panel");
  assert.equal(panel.html.includes("codex exec resume"), true, "Activity panel should keep current raw command details");
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
  assert.equal(html.includes("Open manuscript"), true, "reported trials should expose the latest manuscript shortcut in artifact actions");
  assert.equal(html.includes("Autoresearch complete"), true, "passed goals should mark the whole autoresearch trajectory complete");
  const expandedHeader = html.match(/<header class="trial-history-head">([\s\S]*?)<\/header>/)?.[1] || "";
  assert.equal(expandedHeader.includes("Autoresearch complete"), false, "expanded completed goals should rely on the active trial card complete tag");
  const collapsedHtml = app.run("__toggleAutoresearchPanelCollapse().html");
  const collapsedHeader = collapsedHtml.match(/<header class="trial-history-head">([\s\S]*?)<\/header>/)?.[1] || "";
  assert.equal(collapsedHeader.includes("Autoresearch complete"), true, "collapsed completed goals should keep the complete state visible in the header");
  app.run(`
    appState.research_session.gate = { status: "continue" };
  `);
  const continuingHtml = app.run("__sessionTimelineProbe()");
  assert.equal(continuingHtml.includes("Autoresearch complete"), false, "incomplete gates must not show the autoresearch complete tag");
}

function testContinuedBaseTrialStatusLabel() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [16, 17].map((iteration) => {
      const id = String(iteration).padStart(6, "0") + (iteration === 16 ? "_reference_repair" : "_appendix_repair");
      return {
        id,
        iteration,
        status: "reported",
        is_closed: true,
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
      loop_iteration: 17,
      trajectory: {
        base_trial: "000016_reference_repair",
        latest_active_trial: "000017_appendix_repair",
        next_trial_number: 18
      },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  assert.equal(html.includes("<span class=\"trial-chip-status\">Continued</span>"), true, "continued base trial should be labeled Continued");
  assert.equal(html.includes("<span class=\"trial-chip-status\">Done</span>"), true, "latest closed trial should remain Done");
}

function testClosedTrialsUseDoneStatus() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [16, 17, 18].map((iteration) => {
      const id = String(iteration).padStart(6, "0") + (iteration === 16 ? "_reference_repair" : iteration === 17 ? "_appendix_repair" : "_method_design");
      return {
        id,
        iteration,
        status: "reported",
        is_closed: true,
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
      loop_iteration: 18,
      trajectory: {
        base_trial: "000016_reference_repair",
        latest_active_trial: "000018_method_design",
        next_trial_number: 19
      },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  const trialStrip = html.match(/<div class="trial-strip-scroll">([\s\S]*?)<\/div>/)?.[1] || "";
  const chipStatuses = [...trialStrip.matchAll(/<span class="trial-chip-status">([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(chipStatuses, ["Continued", "Done", "Done"], "closed historical trials should use the same Done label as the latest closed trial");
}

function testHistoricalReportedTrialsDoNotUseIncompleteChipStyle() {
  const app = loadAppContext();
  app.run(`
    appState.trials = [13, 14, 15, 17, 18].map((iteration) => {
      const id = String(iteration).padStart(6, "0") + "_reported_trial";
      return {
        id,
        iteration,
        status: "reported",
        is_closed: iteration >= 17,
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
      loop_iteration: 18,
      trajectory: {
        latest_active_trial: "000018_reported_trial",
        next_trial_number: 19
      },
      transcript: []
    });
  `);
  const html = app.run("__sessionTimelineProbe()");
  const chipMatches = [...html.matchAll(/<button class="trial-chip([^"]*)"[^>]*>\s*<strong class="trial-chip-index">([^<]+)<\/strong>\s*<span class="trial-chip-status">([^<]+)<\/span>/g)];
  const chips = chipMatches.map((match) => ({ classes: match[1], iteration: match[2], status: match[3] }));
  assert.deepEqual(chips.map((chip) => `${chip.iteration}:${chip.status}`), ["13:Done", "14:Done", "15:Done", "17:Done", "18:Done"], "historical reported trials should not expose the internal Reported label in the strip");
  assert.deepEqual(chips.filter((chip) => chip.classes.includes("is-incomplete")).map((chip) => chip.iteration), [], "historical reported trials must not use incomplete chip styling");
  assert.equal(html.includes("15 incomplete"), false, "historical reported trials should not inflate the incomplete count");
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

function testChatRunThinkingUsesLiveStatus() {
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
        { id: "tn1", role: "assistant", kind: "assistant", raw_type: "thread/settings/updated", content: "thread/settings/updated 019f1203-693c-7312-923f-e42bca2d2e00 /tmp/project never user readOnly True gpt-5.5 openai high", created_at: "2026-06-17T10:00:00.500Z" },
        { id: "tn2", role: "assistant", kind: "assistant", raw_type: "thread/status/changed", content: "thread/status/changed 019f1203-693c-7312-923f-e42bca2d2e00 active", created_at: "2026-06-17T10:00:00.700Z" },
        { id: "tn3", role: "assistant", kind: "assistant", raw_type: "mcpServer/startupStatus/updated", content: "mcpServer/startupStatus/updated codex_apps ready", created_at: "2026-06-17T10:00:00.900Z" },
        { id: "tn4", role: "assistant", kind: "assistant", raw_type: "remoteControl/status/changed", content: "remoteControl/status/changed disabled Mac.local 66182b41-c2ff-49c3-8778-894df1788109", created_at: "2026-06-17T10:00:01.000Z" },
        { id: "tn5", role: "assistant", kind: "assistant", raw_type: "event", content: "019f121a-f385-7541-98e0-3ef965165505 019f121a-f385-7541-98e0-3ef965165505 False openai 1782715184 1782715184 idle /Users/yihong/.codex/sessions/2026/06/29/rollout.jsonl", created_at: "2026-06-17T10:00:01.100Z" },
        { id: "tn6", role: "assistant", kind: "assistant", raw_type: "event", content: "019f121a-f445-77e0-b818-e36c876eee50 notLoaded inProgress", created_at: "2026-06-17T10:00:01.200Z" },
        { id: "tn7", role: "assistant", kind: "assistant", raw_type: "item/started", content: "Plan only. Do not implement.\\n\\nUser request:\\nhi\\n\\nAuthoritative UI conversation history for this chat turn:", created_at: "2026-06-17T10:00:01.300Z" },
        { id: "tn8", role: "assistant", kind: "assistant", raw_type: "item/completed", content: "Plan only. Do not implement.\\n\\nUser request:\\nhi\\n\\nUse this history as the current UI truth for this chat turn.", created_at: "2026-06-17T10:00:01.400Z" },
        { id: "tn9", role: "assistant", kind: "assistant", raw_type: "turn/completed", content: "turn/completed\\n019f121a-f385-7541-98e0-3ef965165505\\n019f121a-f445-77e0-b818-e36c876eee50\\nnotLoaded\\ncompleted", created_at: "2026-06-17T10:00:01.450Z" },
        { id: "tr0", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Update: Preparing the current project context.", created_at: "2026-06-17T10:00:01.500Z" },
        { id: "tr1", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Checking the selected trial boundary.", created_at: "2026-06-17T10:00:02.000Z" },
        { id: "tr2", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Comparing the manuscript title against the current story logic.", created_at: "2026-06-17T10:00:02.500Z" },
        { id: "tc1", role: "command", kind: "command", raw_type: "process.started", content: "git diff -- PROJECT.md", created_at: "2026-06-17T10:00:03.000Z" }
      ]
    });
  `);
  const html = app.run("__thinkingProbe()");
  const transcriptText = app.run("sessionTranscriptEntries().map((entry) => entry.content).join('\\n')");
  assert.equal(transcriptText.includes("thread/settings/updated"), false, "stored transcript should filter Codex thread settings lifecycle events");
  assert.equal(transcriptText.includes("thread/status/changed"), false, "stored transcript should filter Codex thread status lifecycle events");
  assert.equal(transcriptText.includes("mcpServer/startupStatus/updated"), false, "stored transcript should filter Codex MCP startup lifecycle events");
  assert.equal(transcriptText.includes("remoteControl/status/changed"), false, "stored transcript should filter Codex remote-control lifecycle events");
  assert.equal(transcriptText.includes("/.codex/sessions/"), false, "stored transcript should filter Codex thread ACK payloads");
  assert.equal(transcriptText.includes("notLoaded inProgress"), false, "stored transcript should filter Codex turn ACK payloads");
  assert.equal(transcriptText.includes("Plan only. Do not implement"), false, "stored transcript should filter hidden Codex prompt lifecycle items");
  assert.equal(transcriptText.includes("turn/completed"), false, "stored transcript should filter Codex turn completion lifecycle events");
  assert.equal(html.includes("run-live-status"), true, "running chat sessions should use the lightweight live status surface");
  assert.equal(html.includes("thread/settings/updated"), false, "Codex thread settings lifecycle events should not render in the running UI");
  assert.equal(html.includes("thread/status/changed"), false, "Codex thread status lifecycle events should not render in the running UI");
  assert.equal(html.includes("mcpServer/startupStatus/updated"), false, "Codex MCP startup lifecycle events should not render in the running UI");
  assert.equal(html.includes("remoteControl/status/changed"), false, "Codex remote-control lifecycle events should not render in the running UI");
  assert.equal(html.includes("/.codex/sessions/"), false, "Codex thread ACK payloads should not render in the running UI");
  assert.equal(html.includes("notLoaded inProgress"), false, "Codex turn ACK payloads should not render in the running UI");
  assert.equal(html.includes("Plan only. Do not implement"), false, "Codex hidden prompt lifecycle items should not render in the running UI");
  assert.equal(html.includes("turn/completed"), false, "Codex turn completion lifecycle events should not render in the running UI");
  assert.equal(html.includes("Codex is working"), false, "running chat status should not render the verbose active run label");
  assert.equal(html.includes("Working for"), true, "running chat status should show elapsed running time");
  assert.equal(html.includes("Run activity"), true, "running chat sessions should keep raw events folded under run activity");
  assert.equal(html.includes("Current run activity"), false, "running chat sessions should not show the legacy current-run activity panel");
  assert.equal(html.includes("Pause after current turn"), false, "running chat sessions should not show autoresearch loop pause");
  assert.equal(html.includes("data-pause-autoresearch"), false, "chat runs do not have an autoresearch next turn to pause");
  assert.equal(html.includes("Stop current run"), false, "running chat sessions should not duplicate the composer stop control");
  assert.equal(html.includes("data-stop-current-run"), false, "running chat sessions should not render a separate stop control");
  const actionButtons = app.run("__composerActionButtonsProbe()");
  assert.equal(actionButtons.chatStopMode, "true", "empty chat composer should turn the send button into stop");
  assert.equal(actionButtons.chatClass.includes("is-stop-mode"), true, "chat composer stop affordance should use stop-mode styling");
  assert.equal(actionButtons.chatDisabled, false, "chat composer stop affordance should remain clickable while the run is active");
  assert.equal(html.includes("Update: Comparing the manuscript title against the current story logic."), false, "chat run status should not duplicate updates as a prefixed summary");
  const visibleUpdates = html.match(/<div class="run-live-updates"[\s\S]*?<\/div>/)?.[0] || "";
  assert.equal(visibleUpdates.includes("Preparing the current project context."), true, "chat run should show assistant updates even when the raw transcript used an Update prefix");
  assert.equal(visibleUpdates.includes("Update: Preparing the current project context."), false, "visible process updates should strip redundant Update prefixes");
  assert.equal(visibleUpdates.includes("Checking the selected trial boundary."), true, "chat run should show process assistant updates outside the raw activity fold");
  assert.equal(visibleUpdates.includes("Comparing the manuscript title against the current story logic."), true, "chat run should show multiple process assistant updates");
  assert.equal(visibleUpdates.includes("git diff -- PROJECT.md"), false, "chat run visible updates should not promote raw commands");
  assert.equal(html.includes("Planning"), false, "ordinary chat thinking should not render trial progress stages");
  assert.equal(html.includes("Synthesizing"), false, "ordinary chat thinking should not render trial progress stages");
  assert.equal(html.includes("Gate update"), false, "ordinary chat thinking should not render trial progress stages");
  assert.equal(app.run("__progressSummaryProbe()"), "Update: Comparing the manuscript title against the current story logic.", "chat run summary should prefer readable updates over later commands");
  const activityButtonHtml = app.run("__progressDetailsProbe()");
  assert.equal(activityButtonHtml.includes("data-activity-open"), true, "run activity should render an Activity panel trigger");
  assert.equal(activityButtonHtml.includes("git diff -- PROJECT.md"), false, "run activity trigger should not inline raw command details");
  const panel = app.run("__activityPanelProbe(activeRunActivityDetailsKey())");
  assert.equal(panel.hidden, false, "run activity panel should stay open across re-render");
  assert.equal(panel.html.includes("git diff -- PROJECT.md"), true, "Activity panel should still include raw command details");
  assert.equal(panel.html.includes("thread/settings/updated"), false, "Activity panel should hide Codex thread settings lifecycle events");
  assert.equal(panel.html.includes("thread/status/changed"), false, "Activity panel should hide Codex thread status lifecycle events");
  assert.equal(panel.html.includes("mcpServer/startupStatus/updated"), false, "Activity panel should hide Codex MCP startup lifecycle events");
  assert.equal(panel.html.includes("remoteControl/status/changed"), false, "Activity panel should hide Codex remote-control lifecycle events");
  assert.equal(panel.html.includes("/.codex/sessions/"), false, "Activity panel should hide Codex thread ACK payloads");
  assert.equal(panel.html.includes("notLoaded inProgress"), false, "Activity panel should hide Codex turn ACK payloads");
  assert.equal(panel.html.includes("Plan only. Do not implement"), false, "Activity panel should hide Codex hidden prompt lifecycle items");
  assert.equal(panel.html.includes("turn/completed"), false, "Activity panel should hide Codex turn completion lifecycle events");
}

function testChatRunCommandOnlyKeepsRawCommandFolded() {
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
        { id: "tc1", role: "command", kind: "command", raw_type: "process.started", content: "codex exec resume", created_at: "2026-06-17T10:00:03.000Z" }
      ]
    });
  `);
  const html = app.run("__thinkingProbe()");
  const summary = app.run("__progressSummaryProbe()");
  assert.equal(summary.includes("codex exec resume"), false, "command-only chat runs should not expose raw commands as the main summary");
  assert.match(summary, /Waiting|No agent events|Last event|Rate limit/i, "command-only chat runs should show a user-readable waiting summary");
  assert.equal(html.includes("Preparing response..."), true, "command-only chat runs should show a quiet pending placeholder until the first process update arrives");
  assert.equal(html.includes("Run activity"), true, "command-only chat runs should still expose Activity details");
  assert.equal(html.includes("codex exec resume"), false, "command-only chat runs should not inline raw command content");
  const panel = app.run("__activityPanelProbe(activeRunActivityDetailsKey())");
  assert.equal(panel.html.includes("codex exec resume"), true, "Activity panel should retain raw command content for debugging");
  assert.equal(html.includes("Current run activity"), false, "command-only chat runs should not use the legacy activity label");
}

function testLocalPendingDoesNotFlashPreviousRunUpdates() {
  const app = loadAppContext();
  app.run(`
    const now = Date.now();
    framingReplyPending = true;
    framingPendingSince = now;
    pendingFramingUserMessageId = "u2";
    __setMessages([
      { id: "u2", role: "user", kind: "text", text: "new question", created_at: new Date(now).toISOString() }
    ]);
    __setSession({
      id: "old",
      session_id: "sid",
      status: "completed",
      mode: "chat",
      started_at: new Date(now - 120000).toISOString(),
      active_run: {
        running: false,
        mode: "chat",
        run_id: "old",
        started_at: new Date(now - 120000).toISOString()
      },
      transcript: [
        { id: "old-user", role: "user", kind: "user", raw_type: "ui.chat", content: "old question", created_at: new Date(now - 2000).toISOString() },
        { id: "old-assistant", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Old process update should not flash.", created_at: new Date(now - 500).toISOString() }
      ]
    });
  `);
  const html = app.run("__thinkingProbe()");
  assert.equal(html.includes("Old process update should not flash."), false, "new local pending scope should filter previous run updates even if they are very recent");
  assert.equal(html.includes("Preparing response..."), true, "new local pending scope should show the quiet pending placeholder");
}

function testRunningProgressIgnoresLateLocalPendingTimestamp() {
  const app = loadAppContext();
  app.run(`
    framingPendingSince = Date.parse("2026-06-17T10:05:00.000Z");
    framingReplyPending = true;
    pendingFramingUserMessageId = "tu1";
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "running",
      mode: "chat",
      loop_active: false,
      loop_iteration: 0,
      started_at: "2026-06-17T09:00:00.000Z",
      active_run: {
        running: true,
        mode: "chat",
        run_id: "s1",
        started_at: "2026-06-17T10:00:00.000Z",
        status_label: "Codex is working"
      },
      transcript: [
        { id: "tu1", role: "user", kind: "user", raw_type: "ui.chat", content: "Discuss title direction.", created_at: "2026-06-17T10:00:00.000Z" },
        { id: "ta1", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Checking the title/story mismatch.", created_at: "2026-06-17T10:00:10.000Z" }
      ]
    });
  `);
  assert.equal(
    app.run("currentProgressStartTime(sessionState().transcript)"),
    Date.parse("2026-06-17T10:00:00.000Z"),
    "server active_run start should win over a later local pending timestamp"
  );
  assert.equal(app.run("__progressSummaryProbe()"), "Update: Checking the title/story mismatch.", "late local pending time must not filter out real Codex updates");
  const html = app.run("__thinkingProbe()");
  assert.equal(html.includes('data-working-started-at="2026-06-17T10:00:00.000Z"'), true, "running timer should use the server run start, not the later local pending timestamp");
  assert.equal(html.includes('data-working-started-at="2026-06-17T10:05:00.000Z"'), false, "running timer must not reset to local pending time once the server run is active");
}

function testTerminalChatRunWithoutAssistantShowsStatus() {
  const app = loadAppContext();
  app.run(`
    __setMessages([
      { id: "u1", role: "user", kind: "text", text: "Discuss this linked work.", created_at: "2026-06-17T10:00:00.000Z" }
    ]);
    __setSession({
      id: "s1",
      session_id: "sid",
      status: "failed",
      mode: "chat",
      returncode: 1,
      started_at: "2026-06-17T10:00:00.000Z",
      ended_at: "2026-06-17T10:00:06.000Z",
      last_event_summary: "Network connection closed before final response.",
      active_run: {
        running: false,
        mode: "chat",
        run_id: "s1",
        started_at: "2026-06-17T10:00:00.000Z"
      },
      transcript: [
        { id: "tu1", role: "user", kind: "user", raw_type: "ui.chat", content: "Discuss this linked work.", created_at: "2026-06-17T10:00:00.000Z" },
        { id: "te1", role: "assistant", kind: "error", raw_type: "error", content: "Network connection closed before final response.", created_at: "2026-06-17T10:00:04.000Z" }
      ]
    });
  `);
  const html = app.run("terminalRunNoResponseHtml(latestUnansweredUserMessage(collapseProjectDraftMessages(localMessages)))");
  assert.equal(html.includes("The run failed before a response was saved."), true, "failed runs without an assistant answer should leave a visible status in the thread");
  assert.equal(html.includes("Exit code 1."), true, "terminal status should expose the process exit code when available");
  assert.equal(html.includes("Run activity"), true, "terminal status should keep available run activity inspectable");
}

function testRunningProgressFallsBackToReasoningSummary() {
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
        status_label: "Codex is working"
      },
      transcript: [
        { id: "tr1", role: "assistant", kind: "reasoning", raw_type: "item.reasoning", content: "Comparing the manuscript title with the current story logic.", created_at: "2026-06-17T10:00:03.000Z" },
        { id: "tc1", role: "command", kind: "command", raw_type: "process.started", content: "rg title manuscript", created_at: "2026-06-17T10:00:04.000Z" }
      ]
    });
  `);
  const summary = app.run("__progressSummaryProbe()");
  assert.equal(summary, "Reasoning: Comparing the manuscript title with the current story logic.", "running summary should use process reasoning when no user-facing update exists yet");
  const html = app.run("__thinkingProbe()");
  assert.equal(html.includes("Reasoning: Comparing the manuscript title with the current story logic."), false, "live status should not duplicate reasoning as a prefixed summary");
  assert.equal(html.includes("Comparing the manuscript title with the current story logic."), true, "live status should expose the compact reasoning text");
  assert.equal(html.includes("Command: rg title manuscript"), false, "live status should not promote raw commands over reasoning");
}

function testCurrentRunningTranscriptGroupDoesNotRenderWorkedActivity() {
  const app = loadAppContext();
  app.run(`
    __setMessages([
      { id: "u1", role: "user", kind: "text", text: "Discuss title direction.", created_at: "2026-06-17T10:00:00.000Z" },
      { id: "a1", role: "assistant", kind: "text", text: "Partial current answer.", created_at: "2026-06-17T10:00:05.000Z" }
    ]);
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
        status_label: "Codex is working"
      },
      transcript: [
        { id: "tu1", role: "user", kind: "user", raw_type: "ui.chat", content: "Discuss title direction.", created_at: "2026-06-17T10:00:00.000Z" },
        { id: "tr1", role: "assistant", kind: "reasoning", raw_type: "item.reasoning", content: "Thinking through the current response.", created_at: "2026-06-17T10:00:01.000Z" },
        { id: "ta1", role: "assistant", kind: "assistant", raw_type: "item.completed", content: "Partial current answer.", created_at: "2026-06-17T10:00:02.000Z" }
      ]
    });
  `);
  const activity = app.run("__activityProbe()");
  assert.equal(activity.hasWorked, false, "current running transcript group should stay in the live status, not render as completed Worked activity");
}

function testWorkingDurationFormatter() {
  const app = loadAppContext();
  assert.equal(app.run("__formatWorkedDuration(45)"), "45s");
  assert.equal(app.run("__formatWorkedDuration(192)"), "3m 12s");
  assert.equal(app.run("__formatWorkedDuration(7440)"), "2h 4m");
  assert.equal(app.run("__formatWorkedDuration(108120)"), "1d 6h 2m");
  assert.equal(app.run("__formatWorkedDuration(93784)"), "1d 2h 3m 4s");
}

function testWorkingDurationUsesServerClockOffset() {
  const app = loadAppContext();
  const clientNow = Date.now();
  const serverOffsetMs = 5 * 60 * 1000;
  const serverStartedAt = new Date(clientNow + serverOffsetMs - 125000).toISOString();
  const state = app.run(`
    serverClockOffsetMs = ${serverOffsetMs};
    ({
      text: workingDurationText("${serverStartedAt}", { serverClock: true }),
      html: workingDurationHtml("${serverStartedAt}")
    });
  `);
  assert.equal(state.text, "Working for 2m 5s", "running timer should use server-clock offset for remote projects");
  assert.equal(state.html.includes('data-working-server-clock="true"'), true, "running timer markup should remember that the timestamp came from the server");
}

function testTrialStripScrollRestoresAcrossRender() {
  const app = loadAppContext();
  assert.equal(app.run("__trialStripScrollProbe(420)"), 420, "manual trial strip scroll should restore after DOM rerender");
  assert.equal(app.run("__trialStripScrollProbe(2400)"), 900, "trial strip scroll restore should clamp to the maximum scrollable offset");
  const auto = app.run("__trialStripAutoProbe()");
  assert.ok(auto.first > 0, "auto trial strip restore should bring the running chip into view");
  assert.equal(auto.second, auto.first, "poll-driven rerenders must not reset auto-centered trial strip scroll to the left edge");
  assert.equal(auto.state.mode, "auto", "auto-centering should not become sticky manual scroll state");
  const selected = app.run("__trialStripSelectedProbe()");
  assert.ok(selected.left > 0, "selected trial restore should center the selected chip even when stale scrollLeft is zero");
  assert.equal(selected.reviewLeft, 0, "selected trial restore should target the autoresearch strip instead of the first generic strip");
  assert.equal(selected.state.mode, "manual", "selected trial restore should keep the user's selected-trial state manual");
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
        summary: "Reviewing · 5/8 reviewer files",
        detail: "3/8 reviewer gates are pass.",
        reviewer_count: 5,
        reviewer_total: 8,
        artifacts_count: 3
      }
    },
    transcript: []
  })`);
  assert.equal(html.includes("Reviewing · 5/8 reviewer files"), true, "running trial without transcript events should show file-backed progress");
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

function testStatusCardShowsGateHumanResponse() {
  const app = loadAppContext();
  const html = app.run(`__statusCardProbe({
    kind: "status_card",
    session_id: "sid",
    run_status: "completed",
    goal_loop: "paused",
    loop_iteration: 18,
    trials_reported: 18,
    gate: "needs_human",
    gate_summary: "- Final gate reviewer: needs_human",
    gate_response_to_human: "Should the next trial run the CSEUA pilot now, or explicitly defer it?",
    stop_reason: "gate_requires_human_input",
    settings: {},
    process: { active: false },
    events: { raw_logs: 12, transcript: 5 },
    limits: []
  })`);
  assert.equal(html.includes("Needs human input"), true, "status card should label the human-facing gate response");
  assert.equal(html.includes("Should the next trial run the CSEUA pilot now, or explicitly defer it?"), true, "status card should show gate_response_to_human");
  assert.equal(html.includes("- Final gate reviewer: needs_human"), false, "human response should take priority over reviewer-line gate summary");
}

function testReviewStorageOutdatedDoesNotShowProjectWarning() {
  const app = loadAppContext();
  const storageOnly = app.run(`projectReviewerInstructionsOutdated({
    reviewer_status: {
      baseline_version: "2026-07-result-block-schema",
      latest_baseline_version: "2026-07-result-block-schema",
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
      latest_baseline_version: "2026-07-result-block-schema",
      missing: [],
      changed: ["EVIDENCE_REVIEWER.md"],
      metadata_missing: []
    }
  })`);
  assert.equal(changedTemplate, true, "actual reviewer template drift should still be detected for the project menu maintenance action");
  const missingProtocol = app.run(`projectReviewerInstructionsOutdated({
    reviewer_status: {
      baseline_version: "2026-07-result-block-schema",
      latest_baseline_version: "2026-07-result-block-schema",
      missing: [],
      changed: [],
      metadata_missing: [],
      protocol_missing: ["RESOURCE_SCOUT.md"],
      protocol_changed: [],
      protocol_metadata_missing: []
    }
  })`);
  assert.equal(missingProtocol, true, "missing core protocol instructions should show the project maintenance action");
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
        latest_baseline_version: "2026-07-result-block-schema",
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
  assert.equal(framingPlaceholder.includes("PROJECT.md"), false, "prelaunch framing placeholder should not sound like a file-editing command");
  assert.equal(
    framingPlaceholder,
    "Refine the research direction, scope, venue, or constraints before autoresearch starts...",
    "prelaunch framing placeholder should describe how to guide autoresearch",
  );
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
  assert.equal(
    launchedPlaceholder,
    "Steer the research, add constraints, answer questions, or ask for status...",
    "launched placeholder should describe follow-up steering options",
  );
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

  state = app.run(`
    localStorage.setItem(scopedStorageKey("autoResearchSessionSettings"), JSON.stringify({
      agent: { backend: "codex" },
      codex: { model: "gpt-5.2", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
      claude: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "auto", webSearch: true, reviewCheckpointInterval: 100 }
    }));
    switchSessionBackend("claude");
    __sessionSettingsState();
  `);
  stored = JSON.parse(state.stored);
  assert.equal(state.formBackend, "claude", "switching to Claude should update the session backend");
  assert.equal(state.composerModel, "sonnet", "switching to Claude must not keep a stale GPT model");
  assert.equal(state.formModel, "sonnet");
  assert.equal(stored.agent.backend, "claude");
  assert.equal(stored.claude.model, "sonnet", "persisted Claude session settings must not keep a stale GPT model");
}

function testSettingsBackendSwitchNormalizesModelFamily() {
  const app = loadAppContext();
  const state = app.run(`
    uiSettings = {
      agent: { backend: "codex" },
      codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
      claude: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "auto", provider: "external", webSearch: true, reviewCheckpointInterval: 100 }
    };
    switchSettingsBackend("claude");
    const payload = settingsPayloadFromModal();
    ({
      settingsBackend: document.querySelector("#settings-form").elements.settingsBackend.value,
      settingsModel: document.querySelector("#settings-form").elements.settingsModel.value,
      payloadClaudeModel: payload.claude.model,
      payloadCodexModel: payload.codex.model
    });
  `);
  assert.equal(state.settingsBackend, "claude");
  assert.equal(state.settingsModel, "sonnet", "Settings backend switch to Claude must normalize stale GPT defaults");
  assert.equal(state.payloadClaudeModel, "sonnet");
  assert.equal(state.payloadCodexModel, "gpt-5.5", "Codex defaults should remain provider-specific");
}

function testReasoningOptionsFollowBackendModel() {
  const app = loadAppContext();
  const state = app.run(`(() => {
    const values = (backend, model) => reasoningOptionsForBackendModel(backend, model).map(([value]) => value);
    const labels = (backend, model) => reasoningOptionsForBackendModel(backend, model).map(([, label]) => label);
    const select = document.querySelector("#composer-reasoning");
    syncReasoningSelectOptions(select, "claude", "sonnet", "xhigh");
    const sonnetHtml = select.innerHTML;
    const sonnetValue = select.value;
    syncReasoningSelectOptions(select, "claude", "opus", "xhigh");
    const opusHtml = select.innerHTML;
    const opusValue = select.value;
    syncReasoningSelectOptions(select, "claude", "claude-opus-4-6", "xhigh");
    const opus46Value = select.value;
    syncReasoningSelectOptions(select, "claude", "haiku", "high");
    syncReasoningSelectOptions(select, "claude", "glm-5.2[1m]", "high");
    const glmReasoningValue = select.value;
    const modelSelect = document.querySelector("#composer-model");
    syncModelSelectOptions(modelSelect, "claude", "z-ai/glm-4.7");
    const customModelValue = modelSelect.value;
    const customModelHtml = modelSelect.innerHTML;
    syncModelSelectOptions(modelSelect, "claude", "gpt-5.5");
    const leftoverCodexModelValue = modelSelect.value;
    const leftoverCodexModelHtml = modelSelect.innerHTML;
    const leftoverCodexSettings = normalizeSessionSettings({ backend: "claude", model: "gpt-5.5", reasoningEffort: "medium" });
    discoveredModelsByBackend.codex = [["gpt-6-codex", "GPT-6 Codex"]];
    syncModelSelectOptions(modelSelect, "claude", "gpt-6-codex");
    const discoveredCodexModelValue = modelSelect.value;
    const discoveredCodexModelHtml = modelSelect.innerHTML;
    const discoveredCodexSettings = normalizeSessionSettings({ backend: "claude", model: "gpt-6-codex", reasoningEffort: "medium" });
    const permissionSelect = document.querySelector("#session-settings-form").elements.permissionPreset;
    const optionValuesFromHtml = (html) => Array.from(String(html || "").matchAll(/<option value="([^"]*)"/g)).map((match) => match[1]);
    const optionLabelsFromHtml = (html) => Array.from(String(html || "").matchAll(/<option value="[^"]*">([^<]*)<\\/option>/g)).map((match) => match[1]);
    syncPermissionSelectOptions(permissionSelect, "claude", "auto-review");
    const claudePermissions = optionValuesFromHtml(permissionSelect.innerHTML);
    const claudePermissionLabels = optionLabelsFromHtml(permissionSelect.innerHTML);
    const legacyAutoValue = permissionSelect.value;
    syncPermissionSelectOptions(permissionSelect, "codex", "full-access");
    const codexPermissions = optionValuesFromHtml(permissionSelect.innerHTML);
      return {
      codex: values("codex", "gpt-5.5"),
      claudeDefault: values("claude", "default"),
      best: values("claude", "best"),
      sonnet: values("claude", "sonnet"),
      opus: values("claude", "opus"),
      opus1m: values("claude", "opus[1m]"),
      opus46: values("claude", "claude-opus-4-6"),
      fable: modelOptionsForBackend("claude").some(([value, label]) => String(value + " " + label).toLowerCase().includes("fable")),
      haiku: values("claude", "haiku"),
      haikuLabels: labels("claude", "haiku"),
      glm: values("claude", "glm-5.2[1m]"),
      normalizedGlmHigh: normalizeReasoningEffort("high", "claude", "glm-5.2[1m]"),
      glmOption: modelOptionsForBackend("claude").some(([value]) => value === "glm-5.2[1m]"),
      customModelValue,
      customModelHtml,
      leftoverCodexModelValue,
      leftoverCodexModelHtml,
      leftoverCodexSettings,
      discoveredCodexModelValue,
      discoveredCodexModelHtml,
      discoveredCodexSettings,
      normalizedSonnetXhigh: normalizeReasoningEffort("xhigh", "claude", "sonnet"),
      normalizedSonnetMax: normalizeReasoningEffort("max", "claude", "sonnet"),
      normalizedOpusXhigh: normalizeReasoningEffort("xhigh", "claude", "opus"),
      normalizedHaikuHigh: normalizeReasoningEffort("high", "claude", "haiku"),
      labelHaiku: labelForReasoning("", "claude", "haiku"),
      sonnetHtml,
      sonnetValue,
      opusHtml,
      opusValue,
      opus46Value,
      haikuValue: "",
      glmReasoningValue,
      claudePermissions,
      claudePermissionLabels,
      legacyAutoValue,
      codexPermissions,
    };
  })()`);
  assertJsonEqual(state.codex, ["low", "medium", "high", "xhigh"], "Codex should keep its own four effort levels");
  assertJsonEqual(state.claudeDefault, [""], "Claude default model should omit explicit effort because it resolves by account/provider");
  assertJsonEqual(state.best, ["low", "medium", "high", "xhigh", "max"], "Claude best should use the Opus effort family while Fable is unavailable");
  assertJsonEqual(state.sonnet, ["low", "medium", "high", "max"], "Claude Sonnet should not expose xhigh");
  assertJsonEqual(state.opus, ["low", "medium", "high", "xhigh", "max"], "Claude Opus should expose xhigh and max");
  assertJsonEqual(state.opus1m, ["low", "medium", "high", "xhigh", "max"], "Claude Opus 1M should expose xhigh and max");
  assertJsonEqual(state.opus46, ["low", "medium", "high", "max"], "Claude Opus 4.6 should not expose xhigh");
  assert.equal(state.fable, false, "Claude Fable should not be exposed while unavailable");
  assertJsonEqual(state.haiku, [""], "Claude Haiku should use CLI default and omit --effort");
  assertJsonEqual(state.haikuLabels, ["Default"], "Claude Haiku select should render a Default option");
  assertJsonEqual(state.glm, [""], "Custom GLM models should use default Claude Code effort");
  assert.equal(state.normalizedGlmHigh, "", "GLM should not keep an explicit effort by default");
  assert.equal(state.glmOption, true, "Common GLM model should be present in Claude options");
  assert.equal(state.customModelValue, "z-ai/glm-4.7", "custom Claude gateway model IDs should be preserved");
  assert.equal(state.customModelHtml.includes("Custom: z-ai/glm-4.7"), true, "custom model option should be inserted dynamically");
  assert.equal(state.leftoverCodexModelValue, "sonnet", "Claude model select must not preserve a stale Codex/GPT model");
  assert.equal(state.leftoverCodexModelHtml.includes("gpt-5.5"), false, "Claude model select must not render Codex/GPT options");
  assert.equal(state.leftoverCodexSettings.model, "sonnet", "Claude settings must normalize stale Codex/GPT models back to Claude defaults");
  assert.equal(state.discoveredCodexModelValue, "sonnet", "Claude model select must reject dynamically discovered Codex models");
  assert.equal(state.discoveredCodexModelHtml.includes("gpt-6-codex"), false, "Claude model select must not render dynamically discovered Codex options");
  assert.equal(state.discoveredCodexSettings.model, "sonnet", "Claude settings must normalize dynamically discovered Codex models back to Claude defaults");
  assert.equal(state.normalizedSonnetXhigh, "high", "Sonnet xhigh should normalize down to high");
  assert.equal(state.normalizedSonnetMax, "max", "Sonnet max should be accepted");
  assert.equal(state.normalizedOpusXhigh, "xhigh", "Opus xhigh should be accepted");
  assert.equal(state.normalizedHaikuHigh, "", "Haiku should not keep an explicit effort");
  assert.equal(state.labelHaiku, "Default effort");
  assert.equal(state.sonnetHtml.includes("Extra high"), false, "Sonnet select should not render Extra high");
  assert.equal(state.sonnetHtml.includes("Max"), true, "Sonnet select should render Max");
  assert.equal(state.sonnetValue, "high");
  assert.equal(state.opusHtml.includes("Extra high"), true, "Opus select should render Extra high");
  assert.equal(state.opusValue, "xhigh");
  assert.equal(state.opus46Value, "high", "Opus 4.6 xhigh should normalize down to high");
  assert.equal(state.haikuValue, "");
  assert.equal(state.glmReasoningValue, "");
  assertJsonEqual(state.claudePermissions, ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"], "Claude permission modes must match official Claude Code modes");
  assert.equal(state.claudePermissionLabels.includes("Auto-review"), false, "Claude permissions should not show the old CoAutoResearch Auto-review label");
  assert.equal(state.legacyAutoValue, "auto", "Legacy Claude auto-review preset should migrate to official auto mode");
  assertJsonEqual(state.codexPermissions, ["default", "auto-review", "full-access"], "Codex should keep its own permission presets");
}

async function testProjectCreateSendsBackendAndLoadsProjectDefault() {
  const app = loadAppContext();
  const result = await app.run(`
    (async () => {
      window.location.href = "http://localhost/?project=p1";
      window.location.pathname = "/";
      window.location.hash = "";
      window.history = {
        replaceState(_state, _title, next) {
          const url = new URL(next, window.location.href);
          window.location.href = url.href;
          window.location.pathname = url.pathname;
          window.location.search = url.search;
          window.location.hash = url.hash;
        }
      };
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
      localStorage.setItem(projectScopedStorageKey("p2", "autoResearchSessionSettings"), JSON.stringify({
        agent: { backend: "claude" },
        claude: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "auto", webSearch: true, reviewCheckpointInterval: 100 }
      }));
      await createProjectFromDialog({ preventDefault() {}, currentTarget: form });
      return {
        calls: globalThis.__apiCalls,
        activeProjectId,
        search: window.location.search,
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
  assert.equal(result.search.includes("project=p2"), true, "project create should update the URL to the opened project");
  assert.equal(result.state.formBackend, "claude", "new project should load with its seeded backend default");
  assert.equal(result.state.composerModel, "sonnet");
  assert.equal(result.state.formModel, "sonnet");
}

async function testStaleOverviewResponseDoesNotReopenPreviousProject() {
  const app = loadAppContext();
  const result = await app.run(`
    (async () => {
      activeProjectId = "p1";
      appState = {
        active_project_id: "p1",
        project: { id: "p1", display_name: "Old Project" },
        projects: [
          { id: "p1", display_name: "Old Project" },
          { id: "p2", display_name: "New Project" }
        ],
        multi_project: true,
        files: { project: { text: "# Old Project" } },
        framing: { messages: [], project_ready: true },
        summaries: { project: {}, manuscript: {} }
      };
      api = async (endpoint) => {
        if (endpoint.startsWith("/api/overview")) {
          return {
            ok: true,
            active_project_id: "p1",
            project: { id: "p1", display_name: "Old Project" },
            projects: [
              { id: "p1", display_name: "Old Project" },
              { id: "p2", display_name: "New Project" }
            ],
            multi_project: true,
            generated_at: "2026-06-28T00:00:00Z",
            files: { project: { text: "# Stale Old Project" } },
            framing: { messages: [], project_ready: true },
            summaries: { project: {}, manuscript: {} },
            research_session: {}
          };
        }
        return { ok: true };
      };
      const pending = loadOverview(true);
      activeProjectId = "p2";
      appState = {
        active_project_id: "p2",
        project: { id: "p2", display_name: "New Project" },
        projects: [
          { id: "p1", display_name: "Old Project" },
          { id: "p2", display_name: "New Project" }
        ],
        multi_project: true,
        files: { project: { text: "# New Project" } },
        framing: { messages: [], project_ready: true },
        summaries: { project: {}, manuscript: {} }
      };
      await pending;
      return {
        activeProjectId,
        appActive: appState.active_project_id,
        projectText: appState.files.project.text
      };
    })()
  `);
  assert.equal(result.activeProjectId, "p2", "stale overview responses must not switch back to the previous project");
  assert.equal(result.appActive, "p2", "stale overview payloads must not replace current project state");
  assert.equal(result.projectText, "# New Project", "stale overview files must not render over the newly opened project");
}

async function testOverviewRequestPinsActiveProject() {
  const app = loadAppContext();
  const result = await app.run(`
    (async () => {
      activeProjectId = "pinned-project";
      appState = {
        active_project_id: "pinned-project",
        project: { id: "pinned-project", display_name: "Pinned Project" },
        projects: [{ id: "pinned-project", display_name: "Pinned Project" }],
        multi_project: true,
        files: { project: { text: "# Pinned Project" } },
        framing: { messages: [], project_ready: true },
        summaries: { project: {}, manuscript: {} }
      };
      let seenEndpoint = "";
      api = async (endpoint) => {
        seenEndpoint = endpoint;
        return {
          ok: true,
          active_project_id: "pinned-project",
          project: { id: "pinned-project", display_name: "Pinned Project" },
          projects: [{ id: "pinned-project", display_name: "Pinned Project" }],
          multi_project: true,
          generated_at: "2026-06-28T00:00:00Z",
          files: { project: { text: "# Pinned Project" } },
          framing: { messages: [], project_ready: true },
          summaries: { project: {}, manuscript: {} },
          research_session: {}
        };
      };
      await __loadOverviewImpl(true);
      return seenEndpoint;
    })()
  `);
  assert.equal(result, "/api/overview?project=pinned-project", "overview requests must be pinned to the active project at request start");
}

async function testProjectAliasCanonicalizesBeforeAvailability() {
  const app = loadAppContext();
  const result = await app.run(`
    (async () => {
      window.location.href = "http://localhost/?project=abc&view=chat";
      window.location.pathname = "/";
      window.location.search = "?project=abc&view=chat";
      window.location.hash = "";
      window.history = {
        replaceState(_state, _title, next) {
          const url = new URL(next, window.location.href);
          window.location.href = url.href;
          window.location.pathname = url.pathname;
          window.location.search = url.search;
          window.location.hash = url.hash;
        }
      };
      activeProjectId = "abc";
      localStorage.setItem("coAutoResearchActiveProject", "abc");
      api = async (endpoint) => {
        if (endpoint === "/api/projects") {
          return {
            ok: true,
            active_project_id: "0dc5adcb-54e6-4b5c-abfa-37858f8a1736",
            projects: [{
              id: "0dc5adcb-54e6-4b5c-abfa-37858f8a1736",
              display_name: "abc",
              title: "Project Definition",
              root: "/Users/example/co-autoresearch-projects/abc"
            }],
            multi_project: true
          };
        }
        return { ok: true };
      };
      await loadProjects();
      return {
        activeProjectId,
        stored: localStorage.getItem("coAutoResearchActiveProject"),
        search: window.location.search,
        noProject: hasNoProject(),
        attachDisabled: Boolean(document.querySelector("#composer-attach-button")?.disabled),
        menuActionDisabled: Boolean(document.querySelector("[data-attachment-action]")?.disabled)
      };
    })()
  `);
  assert.equal(result.activeProjectId, "0dc5adcb-54e6-4b5c-abfa-37858f8a1736", "project display-name aliases should canonicalize to UUIDs");
  assert.equal(result.stored, "0dc5adcb-54e6-4b5c-abfa-37858f8a1736", "canonical UUID should replace the project alias in localStorage");
  assert.equal(result.search, "?project=0dc5adcb-54e6-4b5c-abfa-37858f8a1736&view=chat", "canonical UUID should replace the project alias in the URL");
  assert.equal(result.noProject, false, "resolved project aliases must not trigger no-project mode");
  assert.equal(result.attachDisabled, false, "composer attach button should stay enabled after alias resolution");
  assert.equal(result.menuActionDisabled, false, "attachment menu actions should stay enabled after alias resolution");
}

function testEmptyDashboardStateSurvivesStaleActiveProject() {
  const app = loadAppContext();
  const state = app.run(`
    activeProjectId = "stale-project";
    localStorage.setItem("coAutoResearchActiveProject", "stale-project");
    appState = {
      projects: [],
      active_project_id: "stale-project",
      multi_project: true,
      files: { project: { text: "# Project\\n\\nReady." } },
      framing: { messages: [], project_ready: false },
      research_session: { id: "", session_id: "", status: "", mode: "", transcript: [] }
    };
    renderProjectList();
    ({
      noProjectsDashboard: noProjectsDashboard(),
      hasNoProject: hasNoProject(),
      projectList: document.querySelector("#project-list")?.innerHTML || "",
      coldDisabled: Boolean(document.querySelector("#cold-file-editor")?.disabled),
      coldValue: document.querySelector("#cold-file-editor")?.value || "",
      coldPlaceholder: document.querySelector("#cold-file-editor")?.placeholder || "",
      modelDisabled: Boolean(document.querySelector("#composer-model")?.disabled),
      reasoningDisabled: Boolean(document.querySelector("#composer-reasoning")?.disabled),
      title: document.querySelector("#chat-title")?.textContent || "",
      eyebrow: document.querySelector("#chat-eyebrow")?.textContent || "",
      sessionHidden: Boolean(document.querySelector("#session-pill")?.hidden),
      storedActive: localStorage.getItem("coAutoResearchActiveProject")
    });
  `);
  assert.equal(state.noProjectsDashboard, true, "empty multi-project dashboard should be recognized even with a stale active project id");
  assert.equal(state.hasNoProject, true, "stale active project id should not count as an active project");
  assert.equal(state.projectList.includes("data-create-first-project"), true, "empty sidebar must expose a first-project action");
  assert.equal(state.projectList.includes("No projects yet."), true, "empty sidebar should explain the empty state");
  assert.equal(state.projectList.includes("Create project"), true, "empty sidebar should make project creation obvious");
  assert.equal(state.coldDisabled, true, "brief composer should be disabled until a project exists");
  assert.equal(state.modelDisabled, true, "composer model should be disabled until a project exists");
  assert.equal(state.reasoningDisabled, true, "composer reasoning should be disabled until a project exists");
  assert.equal(state.coldValue, "", "stale project data must be cleared from the no-project composer");
  assert.equal(state.coldPlaceholder, "Create a project first...");
  assert.equal(state.title, "Create your first research project.");
  assert.equal(state.eyebrow, "Projects");
  assert.equal(state.sessionHidden, true);
  assert.equal(state.storedActive, "stale-project", "rendering the empty dashboard should not rewrite user storage by itself");
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
            installed: true,
            auth: "missing",
            login_command: "claude auth login",
            auth_status_command: "claude auth status",
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

function testAgentReadinessMatrixShowsActionableSetup() {
  const app = loadAppContext();
  const state = app.run(`
    (() => {
    const missingCodex = {
      ok: false,
      blocking: true,
      installed: false,
      auth: "missing",
      message: "Codex CLI is not available. Install Codex CLI, verify codex --version, or set COAUTO_CODEX."
    };
    const codexAuthMissing = {
      ok: false,
      blocking: true,
      installed: true,
      auth: "missing",
      login_command: "codex login",
      auth_status_command: "codex login status",
      message: "Codex is not authenticated."
    };
    const claudeAuthUnknown = {
      ok: false,
      blocking: true,
      installed: true,
      auth: "unknown",
      auth_status_command: "claude auth status",
      version: "claude 2.0.0",
      message: "Claude Code authentication status could not be verified. Run claude auth status or update Claude Code CLI, then try again."
    };
    const readyClaude = {
      ok: true,
      blocking: false,
      installed: true,
      auth: "ok",
      version: "claude 2.0.0",
      message: "Claude Code CLI is installed and authenticated."
    };
    uiSettings = {
      agent: { backend: "codex" },
      codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
      claude: { model: "sonnet", reasoningEffort: "high", permissionPreset: "auto", provider: "external", webSearch: true, reviewCheckpointInterval: 100 },
      agent_status: { selected: "codex", backends: { codex: missingCodex, claude: claudeAuthUnknown } }
    };
    renderAgentSetupCards();
    renderAgentStatusNote("#project-agent-backend-note", "codex", "project");
    const blockingGrid = document.querySelector("#agent-setup-grid")?.innerHTML || "";
    const projectState = __agentStatusState();
    const commands = {
      missingCodex: agentSetupCommands("codex", missingCodex).map((item) => item.command),
      codexAuthMissing: agentSetupCommands("codex", codexAuthMissing).map((item) => item.command),
      claudeAuthUnknown: agentSetupCommands("claude", claudeAuthUnknown).map((item) => item.command),
      readyClaude: agentSetupCommands("claude", readyClaude).map((item) => item.command),
    };
    const gateway = {
      external: agentSetupGatewayText("claude", {}),
      missing: agentSetupGatewayText("claude", { gateway: { base_url: "https://api.z.ai/api/anthropic", has_credential: false } }),
      ready: agentSetupGatewayText("claude", { auth: "gateway", gateway: { complete: true, credential_key: "ANTHROPIC_AUTH_TOKEN" } }),
    };

    uiSettings = { ...uiSettings, agent_status: { selected: "codex", backends: { codex: codexAuthMissing, claude: readyClaude } } };
    renderAgentSetupCards();
    const authMissingGrid = document.querySelector("#agent-setup-grid")?.innerHTML || "";

    return { blockingGrid, authMissingGrid, projectState, commands, gateway };
    })()
  `);
  assertJsonEqual(state.commands.missingCodex, [
    "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    "codex --version",
    "codex login",
  ], "missing Codex should show install, verify, and login commands");
  assertJsonEqual(state.commands.codexAuthMissing, ["codex login", "codex login status"], "auth-missing Codex should show login and auth check commands");
  assertJsonEqual(state.commands.claudeAuthUnknown, ["claude auth status"], "auth-unknown Claude should only ask the user to check auth");
  assertJsonEqual(state.commands.readyClaude, [], "ready backends should not show setup command rows");
  assert.equal(state.blockingGrid.includes("Not detected"), true, "missing CLI should render a clear missing state");
  assert.equal(state.blockingGrid.includes("Setup needed"), true, "auth-unknown CLI should block launch until the official status command works");
  assert.equal(state.blockingGrid.includes("Auth: status check failed."), true, "auth-unknown CLI should tell the user the official status check failed");
  assert.equal(state.blockingGrid.includes("https://developers.openai.com/codex/cli"), true, "Codex setup link should point at the official setup page");
  assert.equal(state.blockingGrid.includes("https://code.claude.com/docs/en/iam"), true, "Claude login link should point at the official auth page");
  assert.equal(state.authMissingGrid.includes("Use Claude Code"), true, "ready alternate backend should be directly selectable");
  assert.equal(state.projectState.projectTone, "error", "blocked project backend note should use an error tone");
  assert.equal(state.projectState.projectNote.includes("You can create the project"), true, "project creation should remain allowed while first run is blocked");
  assert.equal(state.projectState.projectNote.includes("codex --version"), true, "project create note should show a verify command when the CLI is missing");
  assert.equal(state.gateway.external, "Using existing Claude Code auth.");
  assert.equal(state.gateway.missing, "Gateway missing credential.");
  assert.equal(state.gateway.ready, "Gateway configured via ANTHROPIC_AUTH_TOKEN.");
}

function testLaunchBlockingStateMatrix() {
  const app = loadAppContext();
  const state = app.run(`
    (() => {
    const readyCodex = { ok: true, blocking: false, installed: true, auth: "ok", message: "Codex CLI is installed and authenticated." };
    const blockedCodex = {
      ok: false,
      blocking: true,
      installed: true,
      auth: "missing",
      message: "Codex is not authenticated. Run codex login and verify codex login status before starting a run.",
      login_command: "codex login",
      auth_status_command: "codex login status"
    };
    uiSettings = {
      agent: { backend: "codex" },
      codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
      claude: { model: "sonnet", reasoningEffort: "high", permissionPreset: "auto", provider: "external", webSearch: true, reviewCheckpointInterval: 100 },
      agent_status: { selected: "codex", backends: { codex: readyCodex } }
    };
    applySessionSettings(uiSettings.codex, true);
    prepareSaved = true;
    appState.files.project.text = "# Project\\n\\nReady.";
    const capture = () => ({
      disabled: Boolean(document.querySelector("#launch-autoresearch")?.disabled),
      title: document.querySelector("#launch-autoresearch")?.title || "",
      text: document.querySelector("#launch-autoresearch")?.textContent || "",
      note: document.querySelector("#launch-agent-status")?.innerHTML || "",
      tone: document.querySelector("#launch-agent-status")?.dataset?.tone || ""
    });

    __setSession({ id: "s1", session_id: "sid", status: "completed", mode: "framing", started_at: "2026-06-17T10:00:00.000Z", gate: { status: "continue" }, transcript: [] });
    __renderStageImpl();
    const ready = capture();

    __setSession({ id: "s1", session_id: "sid", status: "completed", mode: "goal", started_at: "2026-06-17T10:00:00.000Z", gate: { status: "pass" }, transcript: [] });
    __renderStageImpl();
    const gatePassed = capture();

    __setSession({ id: "s1", session_id: "sid", status: "completed", mode: "framing", started_at: "2026-06-17T10:00:00.000Z", gate: { status: "continue" }, transcript: [] });
    pendingResourceImports.splice(0, pendingResourceImports.length, { id: "copy-1", name: "large.pdf", status: "copying", category: "papers" });
    __renderStageImpl();
    const resourceCopying = capture();

    pendingResourceImports.splice(0, pendingResourceImports.length);
    uiSettings = { ...uiSettings, agent_status: { selected: "codex", backends: { codex: blockedCodex } } };
    __renderStageImpl();
    const blockedAgent = capture();

    __setSession({ id: "s1", session_id: "sid", status: "running", mode: "goal", loop_active: true, started_at: "2026-06-17T10:00:00.000Z", gate: { status: "continue" }, transcript: [] });
    uiSettings = { ...uiSettings, agent_status: { selected: "codex", backends: { codex: readyCodex } } };
    __renderStageImpl();
    const running = capture();

    return { ready, gatePassed, resourceCopying, blockedAgent, running };
    })()
  `);
  assert.equal(state.ready.disabled, false, "ready prepared project should enable launch");
  assert.equal(state.ready.title, "Run the autoresearch loop until strict reviewer gates pass.");
  assert.equal(state.gatePassed.disabled, true, "passed final gate should disable launch");
  assert.equal(state.gatePassed.text, "Reviewer gates passed");
  assert.equal(state.gatePassed.title, "All reviewer gates have passed.");
  assert.equal(state.resourceCopying.disabled, true, "resource import should block launch");
  assert.equal(state.resourceCopying.title, "Wait for resource copy to finish before continuing.");
  assert.equal(state.blockedAgent.disabled, true, "agent readiness should block launch");
  assert.equal(state.blockedAgent.tone, "error");
  assert.equal(state.blockedAgent.title.includes("codex login"), true, "blocked launch title should be actionable");
  assert.equal(state.blockedAgent.note.includes("codex login status"), true, "blocked launch note should include auth check guidance");
  assert.equal(state.running.disabled, true, "running sessions should block starting another launch");
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
    applySessionSettings({ backend: "claude", model: "sonnet", reasoningEffort: "medium", permissionPreset: "auto-review", webSearch: true, reviewCheckpointInterval: 100 }, true);
    __setSession({ session_id: "00000000-0000-0000-0000-000000000002", backend: "claude", settings: { backend: "claude" } });
    agentResumeCommand();
  `);
  assert.equal(claude.includes("claude --resume"), true, "Claude resume command should use Claude Code CLI");
  assert.equal(claude.includes("--add-dir '/tmp/project root'"), true, "Claude resume command should include allowed project dir");
  assert.equal(claude.includes("codex"), false, "Claude resume command should not use Codex");

  const switched = app.run(`
    __setSession({ session_id: "00000000-0000-0000-0000-000000000003", backend: "codex", settings: { backend: "codex" }, status: "completed" });
    applySessionSettings({ backend: "claude", model: "sonnet", reasoningEffort: "medium", permissionPreset: "auto-review", webSearch: true, reviewCheckpointInterval: 100 }, true);
    __renderResumeCommandBarImpl();
    ({
      command: agentResumeCommand(),
      label: document.querySelector("#resume-command-label")?.textContent || "",
      text: document.querySelector("#resume-command-text")?.textContent || "",
      copyHidden: document.querySelector("#copy-resume-command")?.hidden || false,
      barHidden: document.querySelector("#resume-command-bar")?.hidden || false,
      selected: selectedRunBackend(),
      sessionBackend: sessionBackend(),
      sessionId: sessionState().session_id || "",
      running: isSessionRunning()
    });
  `);
  assert.equal(switched.command, "", "backend switch must not build a cross-provider resume command");
  assert.equal(switched.label, "Next run uses Claude Code CLI", `resume bar should reflect the selected backend after settings change: ${JSON.stringify(switched)}`);
  assert.equal(switched.text, "new session", "backend switch should explain that the next run starts fresh");
  assert.equal(switched.copyHidden, true, "copy button should be hidden when there is no valid resume command");
  assert.equal(switched.barHidden, false, "resume bar should stay visible with the selected backend state");
}

async function testSettingsModalSaveSyncsScopedSessionSettings() {
  const app = loadAppContext();
  const state = await app.run(`
    (async () => {
      const form = document.querySelector("#settings-form");
      form.querySelector = () => null;
      localStorage.setItem(scopedStorageKey("autoResearchSessionSettings"), JSON.stringify({
        agent: { backend: "claude" },
        codex: { model: "gpt-5.3-codex", reasoningEffort: "xhigh", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 99 },
        claude: { model: "opus", reasoningEffort: "max", permissionPreset: "bypassPermissions", provider: "zai_glm", preExecScript: "stale claude setup", webSearch: false, reviewCheckpointInterval: 88 }
      }));
      form.elements.themeMode.value = "atelier-nocturne";
      form.elements.settingsModel.value = "gpt-5.2";
      form.elements.settingsReasoningEffort.value = "low";
      form.elements.settingsPermissionPreset.value = "full-access";
      form.elements.settingsWebSearch.checked = false;
      form.elements.settingsExtraConfig.value = "sandbox note";
      form.elements.settingsReviewCheckpointInterval.value = "17";
      const payload = settingsPayloadFromModal();
      payload.claude = {
        model: "sonnet",
        reasoningEffort: "high",
        permissionPreset: "auto",
        permissionMode: "auto",
        provider: "external",
        webSearch: true,
        fastMode: false,
        extraConfig: "",
        preExecScript: "project claude setup",
        reviewCheckpointInterval: 23
      };
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
  assert.equal(stored.claude.model, "sonnet", "Settings save should replace stale scoped Claude model with project settings");
  assert.equal(stored.claude.preExecScript, "project claude setup", "Settings save should replace stale scoped Claude shell setup");
  assert.equal(Number(stored.claude.reviewCheckpointInterval), 23);
  assert.equal(state.composerModel, "gpt-5.2", "Settings save should sync the composer model");
  assert.equal(state.composerReasoning, "low", "Settings save should sync the composer reasoning");
  assert.equal(state.formPermission, "full-access", "Settings save should sync launch/session form values");
  assert.equal(app.context.__apiCalls[0].endpoint, "/api/settings");
}

async function testApiKeyProviderSettingsPayloads() {
  const app = loadAppContext();
  const state = await app.run(`
    (async () => {
      uiSettings = {
        agent: { backend: "codex" },
        codex: { provider: "cli", model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
        claude: { model: "sonnet", reasoningEffort: "high", permissionPreset: "auto", provider: "external", webSearch: true, reviewCheckpointInterval: 100 },
        codex_env: { present: {}, values: {} },
        claude_env: { present: {}, values: {} },
        agent_status: { selected: "codex", backends: {} }
      };
      const form = document.querySelector("#settings-form");
      form.querySelector = () => null;
      hydrateSettingsDialog(uiSettings);

      form.elements.settingsBackend.value = "codex";
      form.elements.settingsCodexProvider.value = "openai_api_key";
      hydrateCodexProviderSettings(uiSettings, "codex", "openai_api_key");
      const codexMissingStatus = {
        text: document.querySelector("#settings-codex-api-key-status").textContent,
        state: document.querySelector("#settings-codex-api-key-status").dataset.state || ""
      };
      form.elements.settingsCodexApiKey.value = "sk-openai-test";
      refreshCodexApiKeyDraftStatus();
      const codexPendingStatus = {
        text: document.querySelector("#settings-codex-api-key-status").textContent,
        state: document.querySelector("#settings-codex-api-key-status").dataset.state || ""
      };
      globalThis.__apiResponse = {
        settings: {
          ...uiSettings,
          codex: { ...uiSettings.codex, provider: "openai_api_key" },
          codex_env: { present: { OPENAI_API_KEY: true }, masked: { OPENAI_API_KEY: "Saved" }, values: {} }
        },
        secret_keys: []
      };
      await saveUiSettings({ preventDefault() {}, currentTarget: form, submitter: null });
      const codexCall = globalThis.__apiCalls[0];
      const codexStatus = document.querySelector("#settings-codex-api-key-status").textContent;
      const codexStatusState = document.querySelector("#settings-codex-api-key-status").dataset.state || "";
      const codexInputAfterSave = form.elements.settingsCodexApiKey.value;
      const codexClearHidden = document.querySelector("#settings-codex-api-key-clear").hidden;

      form.elements.settingsBackend.value = "claude";
      switchSettingsBackend("claude");
      form.elements.settingsClaudeProvider.value = "anthropic_api_key";
      hydrateClaudeProviderSettings(uiSettings, "claude", "anthropic_api_key");
      const claudeMissingStatus = {
        text: document.querySelector("#settings-claude-api-key-status").textContent,
        state: document.querySelector("#settings-claude-api-key-status").dataset.state || ""
      };
      form.elements.settingsClaudeApiKey.value = "sk-ant-test";
      refreshClaudeApiKeyDraftStatus();
      const claudePendingStatus = {
        text: document.querySelector("#settings-claude-api-key-status").textContent,
        state: document.querySelector("#settings-claude-api-key-status").dataset.state || ""
      };
      globalThis.__apiResponse = {
        settings: {
          ...uiSettings,
          agent: { backend: "claude" },
          codex: { ...uiSettings.codex, provider: "openai_api_key" },
          codex_env: { present: { OPENAI_API_KEY: true }, masked: { OPENAI_API_KEY: "Saved" }, values: {} },
          claude: { ...uiSettings.claude, provider: "anthropic_api_key" },
          claude_env: { present: { ANTHROPIC_API_KEY: true }, masked: { ANTHROPIC_API_KEY: "Saved" }, values: {} }
        },
        secret_keys: []
      };
      await saveUiSettings({ preventDefault() {}, currentTarget: form, submitter: null });
      const claudeCall = globalThis.__apiCalls[1];
      const claudeStatus = document.querySelector("#settings-claude-api-key-status").textContent;
      const claudeStatusState = document.querySelector("#settings-claude-api-key-status").dataset.state || "";
      const claudeInputAfterSave = form.elements.settingsClaudeApiKey.value;
      const gatewayHidden = document.querySelector("#claude-gateway-settings").hidden;
      const apiPanelHidden = document.querySelector("#claude-api-key-settings").hidden;

      globalThis.__apiResponse = {
        settings: {
          ...uiSettings,
          codex: { ...uiSettings.codex, provider: "openai_api_key" },
          codex_env: { present: {}, masked: {}, values: {} }
        },
        secret_keys: []
      };
      await clearSavedCodexSecret("OPENAI_API_KEY");
      const clearCall = globalThis.__apiCalls[2];
      return {
        codexCall,
        codexMissingStatus,
        codexPendingStatus,
        codexStatus,
        codexStatusState,
        codexInputAfterSave,
        codexClearHidden,
        claudeCall,
        claudeMissingStatus,
        claudePendingStatus,
        claudeStatus,
        claudeStatusState,
        claudeInputAfterSave,
        gatewayHidden,
        apiPanelHidden,
        clearCall
      };
    })()
  `);
  assert.equal(state.codexCall.body.codex.provider, "openai_api_key");
  assert.equal(state.codexCall.body.codex_env.OPENAI_API_KEY, "sk-openai-test");
  assertJsonEqual(state.codexMissingStatus, { text: "No project key saved", state: "missing" });
  assertJsonEqual(state.codexPendingStatus, { text: "Unsaved project key", state: "pending" });
  assert.equal(state.codexStatus, "Project override saved");
  assert.equal(state.codexStatusState, "saved");
  assert.equal(state.codexInputAfterSave, "", "saved Codex API key must not be echoed into the input");
  assert.equal(state.codexClearHidden, false, "saved Codex API key should expose a clear action");
  assert.equal(state.claudeCall.body.claude.provider, "anthropic_api_key");
  assert.equal(state.claudeCall.body.claude_env.ANTHROPIC_API_KEY, "sk-ant-test");
  assert.equal(state.claudeCall.body.claude_env.ANTHROPIC_BASE_URL, undefined);
  assertJsonEqual(state.claudeMissingStatus, { text: "No project key saved", state: "missing" });
  assertJsonEqual(state.claudePendingStatus, { text: "Unsaved project key", state: "pending" });
  assert.equal(state.claudeStatus, "Project override saved");
  assert.equal(state.claudeStatusState, "saved");
  assert.equal(state.claudeInputAfterSave, "", "saved Claude API key must not be echoed into the input");
  assert.equal(state.gatewayHidden, true, "official Anthropic API key provider should not show gateway fields");
  assert.equal(state.apiPanelHidden, false, "official Anthropic API key provider should show API key field");
  assert.equal(JSON.stringify(state.clearCall.body.clear_codex_env), JSON.stringify(["OPENAI_API_KEY"]));
}

async function testClaudeGatewaySettingsPayload() {
  const app = loadAppContext();
  const state = await app.run(`
    (async () => {
      uiSettings = {
        agent: { backend: "claude" },
        codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
        claude: { model: "glm-5.2[1m]", reasoningEffort: "", permissionPreset: "auto", provider: "external", webSearch: true, reviewCheckpointInterval: 100 },
        claude_env: { present: {}, values: {} },
        agent_status: { selected: "claude", backends: {} }
      };
      const form = document.querySelector("#settings-form");
      form.querySelector = () => null;
      hydrateSettingsDialog(uiSettings);
      form.elements.settingsBackend.value = "claude";
      form.elements.settingsClaudeProvider.value = "zai_glm";
      hydrateClaudeProviderSettings(uiSettings, "claude", "zai_glm");
      form.elements.settingsModel.value = "glm-5.2[1m]";
      form.elements.settingsReasoningEffort.value = "";
      form.elements.settingsClaudeCredential.value = "secret-zai-key";
      const responseSettings = {
        agent: { backend: "claude" },
        codex: uiSettings.codex,
        claude: { ...uiSettings.claude, provider: "zai_glm" },
        claude_env: {
          present: { ANTHROPIC_AUTH_TOKEN: true },
          values: {
            ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
            ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.2[1m]",
            ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.2[1m]",
            ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.5-air"
          }
        }
      };
      globalThis.__apiResponse = { settings: responseSettings, secret_keys: [] };
      await saveUiSettings({ preventDefault() {}, currentTarget: form, submitter: null });
      return {
        call: globalThis.__apiCalls[0],
        credentialAfterHydrate: form.elements.settingsClaudeCredential.value,
        credentialStatus: document.querySelector("#settings-claude-credential-status").textContent,
        gatewayHidden: document.querySelector("#claude-gateway-settings").hidden,
        composerModel: document.querySelector("#composer-model").value
      };
    })()
  `);
  assert.equal(state.call.endpoint, "/api/settings");
  assert.equal(state.call.body.claude.provider, "zai_glm");
  assert.equal(state.call.body.claude.model, "glm-5.2[1m]");
  assert.equal(state.call.body.claude_env.ANTHROPIC_BASE_URL, "https://api.z.ai/api/anthropic");
  assert.equal(state.call.body.claude_env.ANTHROPIC_AUTH_TOKEN, "secret-zai-key");
  assert.equal(state.call.body.claude_env.ANTHROPIC_DEFAULT_SONNET_MODEL, "glm-5.2[1m]");
  assert.equal(state.call.body.claude_env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "glm-4.5-air");
  assert.equal(state.credentialAfterHydrate, "", "saved credentials must not be echoed into the input");
  assert.equal(state.credentialStatus, "Project override saved");
  assert.equal(state.gatewayHidden, false);
  assert.equal(state.composerModel, "glm-5.2[1m]", "saved GLM model should sync into composer settings");
}

async function testInitialRuntimePreflightFlow() {
  const app = loadAppContext();
  const state = await app.run(`
    (async () => {
      const readyCodex = { backend: "codex", ok: true, blocking: false, installed: true, auth: "ok", version: "codex 1.0.0", message: "Codex CLI is installed and authenticated." };
      const readyClaudeGateway = {
        backend: "claude",
        ok: true,
        blocking: false,
        installed: true,
        auth: "gateway",
        version: "claude 1.0.0",
        message: "Claude Code CLI is installed and an Anthropic-compatible gateway is configured via ANTHROPIC_AUTH_TOKEN.",
        gateway: { complete: true, base_url: "https://api.z.ai/api/anthropic", has_credential: true, credential_key: "ANTHROPIC_AUTH_TOKEN" }
      };
      const missingCodex = { backend: "codex", ok: false, blocking: true, installed: false, auth: "missing", message: "Install Codex CLI." };
      const partialClaudeGateway = {
        backend: "claude",
        ok: false,
        blocking: true,
        installed: true,
        auth: "missing",
        version: "claude 1.0.0",
        message: "Claude Code has an Anthropic-compatible gateway base URL configured, but no ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY is available.",
        gateway: { complete: false, base_url: "https://api.z.ai/api/anthropic", has_credential: false, credential_key: "" }
      };
      const resetNoProject = (settings) => {
        uiSettings = settings;
        activeProjectId = "";
        appState = { projects: [], active_project_id: "", multi_project: true };
        initialProjectDialogOpened = false;
        sessionStorage.removeItem("coAutoResearchInitialPreflightDismissed");
        document.querySelector("#project-dialog").open = false;
        document.querySelector("#agent-setup-dialog").open = false;
        globalThis.__projectOpenCount = 0;
        openProjectCreateDialog = () => {
          globalThis.__projectOpenCount += 1;
          document.querySelector("#project-dialog").showModal();
        };
      };
      const wait = () => new Promise((resolve) => setTimeout(resolve, 150));

      resetNoProject({
        agent: { backend: "codex" },
        codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
        claude: { model: "sonnet", reasoningEffort: "high", permissionPreset: "auto", provider: "external", webSearch: true, reviewCheckpointInterval: 100 },
        agent_status: { selected: "codex", backends: { codex: readyCodex, claude: partialClaudeGateway } }
      });
      runInitialPreflightFlow();
      await wait();
      const selectedReady = {
        projectOpen: document.querySelector("#project-dialog").open,
        setupOpen: document.querySelector("#agent-setup-dialog").open,
        projectOpenCount: globalThis.__projectOpenCount,
        dismissed: sessionStorage.getItem("coAutoResearchInitialPreflightDismissed")
      };

      resetNoProject({
        agent: { backend: "claude" },
        codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
        claude: { model: "sonnet", reasoningEffort: "high", permissionPreset: "auto", provider: "external", webSearch: true, reviewCheckpointInterval: 100 },
        agent_status: { selected: "claude", backends: { codex: readyCodex, claude: partialClaudeGateway } }
      });
      runInitialPreflightFlow();
      await wait();
      const switchSetup = {
        projectOpenCount: globalThis.__projectOpenCount,
        setupOpen: document.querySelector("#agent-setup-dialog").open,
        createHidden: document.querySelector("[data-agent-setup-create-project]").hidden,
        hasUseCodex: document.querySelector("#agent-setup-grid").innerHTML.includes("Use Codex"),
        hasGatewayMissing: document.querySelector("#agent-setup-grid").innerHTML.includes("Gateway missing credential")
      };
      globalThis.__apiCalls = [];
      globalThis.__apiResponse = {
        settings: {
          ...uiSettings,
          agent: { backend: "codex" },
          agent_status: { selected: "codex", backends: { codex: readyCodex, claude: partialClaudeGateway } }
        },
        secret_keys: []
      };
      await useAgentSetupBackend("codex");
      const settingsSaveCall = globalThis.__apiCalls.find((call) => call.endpoint === "/api/settings") || {};
      const afterUseReadyBackend = {
        savedBackend: settingsSaveCall.body?.agent?.backend || "",
        projectOpenCount: globalThis.__projectOpenCount,
        dismissed: sessionStorage.getItem("coAutoResearchInitialPreflightDismissed"),
        setupOpen: document.querySelector("#agent-setup-dialog").open
      };

      resetNoProject({
        agent: { backend: "claude" },
        codex: { model: "gpt-5.5", reasoningEffort: "medium", permissionPreset: "default", webSearch: true, reviewCheckpointInterval: 100 },
        claude: { model: "sonnet", reasoningEffort: "high", permissionPreset: "auto", provider: "zai_glm", webSearch: true, reviewCheckpointInterval: 100 },
        agent_status: { selected: "claude", backends: { codex: missingCodex, claude: partialClaudeGateway } }
      });
      runInitialPreflightFlow();
      await wait();
      const allBlocking = {
        projectOpenCount: globalThis.__projectOpenCount,
        setupOpen: document.querySelector("#agent-setup-dialog").open,
        hasGatewayMissing: document.querySelector("#agent-setup-grid").innerHTML.includes("Gateway missing credential")
      };
      createProjectFromSetupDialog();
      const afterCreateFirst = {
        projectOpenCount: globalThis.__projectOpenCount,
        setupOpen: document.querySelector("#agent-setup-dialog").open,
        dismissed: sessionStorage.getItem("coAutoResearchInitialPreflightDismissed")
      };
      document.querySelector("#project-dialog").open = false;
      globalThis.__projectOpenCount = 0;
      initialProjectDialogOpened = false;
      runInitialPreflightFlow();
      await wait();
      const afterDismissedRetry = {
        projectOpenCount: globalThis.__projectOpenCount,
        setupOpen: document.querySelector("#agent-setup-dialog").open
      };

      sessionStorage.removeItem("coAutoResearchInitialPreflightDismissed");
      document.querySelector("#agent-setup-dialog").open = false;
      maybeShowAgentSetupDialog({ force: true, initial: true });
      const recheckLike = {
        setupOpen: document.querySelector("#agent-setup-dialog").open,
        dismissed: sessionStorage.getItem("coAutoResearchInitialPreflightDismissed")
      };

      activeProjectId = "p1";
      appState = { projects: [{ id: "p1", display_name: "Existing" }], active_project_id: "p1", multi_project: true };
      document.querySelector("#project-dialog").open = false;
      document.querySelector("#agent-setup-dialog").open = false;
      globalThis.__projectOpenCount = 0;
      initialProjectDialogOpened = false;
      runInitialPreflightFlow({ force: true });
      await wait();
      const existingProject = {
        projectOpenCount: globalThis.__projectOpenCount,
        setupOpen: document.querySelector("#agent-setup-dialog").open
      };

      uiSettings = { ...uiSettings, agent_status: { selected: "claude", backends: { codex: missingCodex, claude: readyClaudeGateway } } };
      renderAgentSetupCards();
      const gatewayReady = document.querySelector("#agent-setup-grid").innerHTML.includes("Gateway configured via ANTHROPIC_AUTH_TOKEN");

      return { selectedReady, switchSetup, afterUseReadyBackend, allBlocking, afterCreateFirst, afterDismissedRetry, recheckLike, existingProject, gatewayReady };
    })()
  `);
  assert.equal(state.selectedReady.projectOpen, true, "ready selected backend should open project creation");
  assert.equal(state.selectedReady.setupOpen, false, "ready selected backend should not open setup");
  assert.equal(state.selectedReady.projectOpenCount, 1);
  assert.equal(state.selectedReady.dismissed, null, "automatic ready path should not mark preflight dismissed");
  assert.equal(state.switchSetup.setupOpen, true, "blocking selected backend should open setup");
  assert.equal(state.switchSetup.projectOpenCount, 0);
  assert.equal(state.switchSetup.createHidden, false);
  assert.equal(state.switchSetup.hasUseCodex, true, "ready alternate backend should render a switch action");
  assert.equal(state.switchSetup.hasGatewayMissing, true, "partial Claude gateway should be visible");
  assert.equal(state.afterUseReadyBackend.savedBackend, "codex", "Use Codex should persist Settings backend");
  assert.equal(state.afterUseReadyBackend.projectOpenCount, 1, "Use ready backend should continue to project creation");
  assert.equal(state.afterUseReadyBackend.dismissed, "1");
  assert.equal(state.afterUseReadyBackend.setupOpen, false);
  assert.equal(state.allBlocking.setupOpen, true);
  assert.equal(state.allBlocking.projectOpenCount, 0);
  assert.equal(state.allBlocking.hasGatewayMissing, true);
  assert.equal(state.afterCreateFirst.projectOpenCount, 1);
  assert.equal(state.afterCreateFirst.setupOpen, false);
  assert.equal(state.afterCreateFirst.dismissed, "1");
  assert.equal(state.afterDismissedRetry.projectOpenCount, 0, "dismissed preflight should not reopen project dialog in this tab");
  assert.equal(state.afterDismissedRetry.setupOpen, false, "dismissed preflight should not reopen setup in this tab");
  assert.equal(state.recheckLike.setupOpen, true, "forced re-check should render setup");
  assert.equal(state.recheckLike.dismissed, null, "re-check should not mark preflight dismissed");
  assert.equal(state.existingProject.projectOpenCount, 0, "existing projects should not trigger first-run create dialog");
  assert.equal(state.existingProject.setupOpen, false);
  assert.equal(state.gatewayReady, true, "Claude gateway-ready status should be rendered");
}

function testSettingsLayoutAndLinkContracts() {
  const styles = sourceText("templates/default/ui/styles.css");
  const appJs = sourceText("templates/default/ui/app.js");
  const indexHtml = sourceText("templates/default/ui/index.html");
  const docLinkRule = styles.match(/\.settings-doc-links a\s*\{[^}]+\}/)?.[0] || "";
  const settingsSmallRule = styles.match(/\.settings-content \.field small\s*\{[^}]+\}/)?.[0] || "";
  const settingsGridRule = styles.match(/\.modal-settings-grid\s*\{[^}]+\}/)?.[0] || "";
  const mobileSettingsGrid = styles.match(/@media \(max-width: 900px\)[\s\S]+?\.modal-settings-grid\s*\{[^}]+grid-template-columns: 1fr;[\s\S]+?\}/)?.[0] || "";
  const codexKeyIndex = indexHtml.indexOf('id="codex-api-key-settings"');
  const advancedConfigIndex = indexHtml.indexOf('name="settingsExtraConfig"');

  assert.equal(indexHtml.includes('id="settings-doc-links"'), true, "settings header should expose a docs link region");
  assert.equal(appJs.includes("function syncBackendDocLinks"), true, "settings docs links should be updated from the active backend");
  assert.equal(appJs.includes("https://developers.openai.com/codex/cli"), true, "Codex setup link should remain available");
  assert.equal(appJs.includes("https://code.claude.com/docs/en/quickstart"), true, "Claude setup link should remain available");
  assert.equal(docLinkRule.includes("text-decoration: underline"), true, "settings doc actions should look like plain links");
  assert.equal(docLinkRule.includes("border"), false, "settings doc links must not be styled as buttons");
  assert.equal(docLinkRule.includes("border-radius"), false, "settings doc links must not be rounded button chips");
  assert.equal(docLinkRule.includes("min-height"), false, "settings doc links should not reserve button-like height");
  assert.equal(settingsGridRule.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), true, "desktop settings form should use an aligned two-column grid");
  assert.equal(settingsGridRule.includes("align-items: start"), true, "settings form controls should top-align across columns");
  assert.equal(settingsSmallRule.includes("text-transform: none"), true, "settings help text should stay readable sentence text");
  assert.equal(settingsSmallRule.includes("letter-spacing: 0"), true, "settings help text should not use spaced-out labels");
  assert.ok(mobileSettingsGrid, "settings form should collapse to one column on narrow screens");
  assert.equal(styles.includes(".settings-content .modal-settings-grid > .toggle-field"), true, "toggle rows need explicit vertical alignment in the settings grid");
  assert.equal(styles.includes("[data-codex-provider-field][hidden]"), true, "Codex provider field should hide cleanly when Claude settings are active");
  assert.equal(codexKeyIndex > 0 && advancedConfigIndex > codexKeyIndex, true, "API key settings should appear before advanced config");
  assert.equal(styles.includes('.provider-secret-status[data-state="missing"]'), true, "missing provider secrets should have a distinct warning style");
  assert.equal(styles.includes(".settings-advanced-config textarea"), true, "advanced config should have a compact settings-specific textarea height");
  assert.equal(indexHtml.includes('data-settings-resize="corner"'), true, "settings dialog should expose a bottom-right resize handle");
  assert.equal(styles.includes(".settings-resize-handle"), true, "settings resize handle should be styled");
  assert.equal(appJs.includes("function startSettingsDialogResize"), true, "settings dialog resize should be wired in app code");
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
  assert.equal(theme.mode, "atelier-ivory");
  assert.equal(theme.dataset, "atelier-ivory");
  app.run('applyThemeMode("unsupported")');
  theme = app.run('__themeState()');
  assert.equal(theme.mode, "atelier-ivory", "unsupported theme modes should normalize to Ivory");
  assert.equal(theme.dataset, "atelier-ivory", "unsupported theme modes should leave the document on Ivory");
  assert.equal(theme.stored, "atelier-ivory", "unsupported theme modes should persist as Ivory");
  app.run('applyThemeMode("light")');
  theme = app.run('__themeState()');
  assert.equal(theme.dataset, "atelier-ivory", "legacy Light selection should map to Ivory");
  assert.equal(theme.stored, "atelier-ivory", "legacy Light selection should persist as Ivory");
  app.run('applyThemeMode("dark-glass")');
  theme = app.run('__themeState()');
  assert.equal(theme.dataset, "atelier-nocturne", "legacy Dark Glass should map to Nocturne");
  assert.equal(theme.stored, "atelier-nocturne", "legacy Dark Glass should persist as Nocturne");
  app.run('applyThemeMode("atelier-nocturne")');
  theme = app.run('__themeState()');
  assert.equal(theme.dataset, "atelier-nocturne");
  assert.equal(theme.stored, "atelier-nocturne");
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

function testAttachmentMenuRoutesUploadAndLinkActions() {
  const app = loadAppContext();
  let state = app.run("__toggleAttachmentMenuProbe()");
  assert.equal(state.hidden, false, "composer plus should open the attachment menu");
  assert.equal(state.expanded, "true", "composer plus should expose menu expanded state");
  assert.equal(state.parentIsBody, true, "attachment menu should be portaled to body so the composer cannot clip it");
  assert.equal(state.left, "350px", "attachment menu should be positioned from the attach button");
  assert.equal(state.top, "596px", "attachment menu should sit above the attach button when there is room");
  assert.equal(state.bottom, "auto", "attachment menu should not keep bottom positioning after viewport placement");
  assert.equal(state.width, "260px", "attachment menu should receive a stable viewport width");

  state = app.run('__attachmentActionProbe("upload-files")');
  assert.equal(state.hidden, true, "upload action should close the attachment menu");
  assert.equal(state.expanded, "false", "upload action should collapse menu state");
  assert.equal(state.pendingCategory, "user_input", "upload files should use the default user-input category");
  assert.equal(state.browserOpenCount, 0, "upload files must not open the server local browser");
  assert.equal(state.clicks, 1, "upload files should use the browser native file input");

  state = app.run("__toggleAttachmentMenuProbe()");
  assert.equal(state.hidden, false, "composer plus should reopen the attachment menu");
  state = app.run('__attachmentActionProbe("link-folders")');
  assert.equal(state.hidden, true, "link action should close the attachment menu");
  assert.equal(state.expanded, "false", "link action should collapse menu state");
  assert.equal(state.activeCategory, "ongoing_work", "linked folders/files should default to ongoing work");
  assert.equal(state.browserOpenCount, 1, "link folders/files should open the server local browser");
  assert.equal(state.browserOpenCategory, "ongoing_work", "local browser should inherit the linked-resource category");
  assert.equal(state.browserOpenMode, "default", "link folders/files should keep the default server browser mode");
  assert.equal(state.clicks, 1, "link folders/files should not trigger the native file picker");

  state = app.run('appState.runtime = { remote: true }; __attachmentActionProbe("upload-files")');
  assert.equal(state.hidden, true, "remote upload should still close the main attachment menu");
  assert.equal(state.uploadSourceHidden, false, "remote upload should ask where files come from");
  assert.equal(state.clicks, 1, "remote upload should not immediately open the native file picker");
  assert.equal(state.browserOpenCount, 1, "remote upload source choice should not open the server browser yet");

  state = app.run('__uploadSourceChoiceProbe("computer")');
  assert.equal(state.uploadSourceHidden, true, "choosing this computer should close the upload source menu");
  assert.equal(state.pendingCategory, "user_input", "local remote uploads should attach as user input");
  assert.equal(state.pendingEditMessageId, "", "composer local uploads should not target an edit by default");
  assert.equal(state.clicks, 2, "choosing this computer should open the native file picker");

  state = app.run('appState.runtime = { remote: true }; __attachmentActionProbe("upload-files"); __uploadSourceChoiceProbe("server")');
  assert.equal(state.uploadSourceHidden, true, "choosing server should close the upload source menu");
  assert.equal(state.activeCategory, "user_input", "server upload choice should attach selected files as user input");
  assert.equal(state.browserOpenCount, 2, "choosing server should open the server file browser");
  assert.equal(state.browserOpenCategory, "user_input", "server upload choice should set user-input resource category");
  assert.equal(state.browserOpenMode, "server-file", "server upload choice should use file-only browser mode");
  assert.equal(state.clicks, 2, "choosing server should not trigger the native file picker");

  state = app.run('appState.runtime = { remote: true }; __attachmentActionProbe("link-folders")');
  assert.equal(state.browserOpenCount, 3, "remote link folders/files should still open the server browser");
  assert.equal(state.browserOpenCategory, "ongoing_work", "remote link folders/files should keep ongoing-work category");
  assert.equal(state.browserOpenMode, "default", "remote link folders/files should not use file-only upload mode");

  state = app.run('appState.runtime = { remote: true }; __editUploadSourceProbe("message-1", "computer")');
  assert.equal(state.pendingEditMessageId, "message-1", "edit uploads from this computer should target the edited message");
  assert.equal(state.clicks, 3, "edit upload from this computer should open the native file picker");

  state = app.run('appState.runtime = { remote: true }; __editUploadSourceProbe("message-2", "server")');
  assert.equal(state.browserOpenCount, 4, "edit upload from server should open the server browser");
  assert.equal(state.browserOpenMode, "server-file", "edit upload from server should use file-only mode");
  assert.equal(state.browserOpenEditMessageId, "message-2", "server files selected while editing should attach to that edit draft");

  state = app.run("__toggleAttachmentMenuProbe(); __closeAttachmentMenuProbe();");
  assert.equal(state.hidden, true, "attachment menu should support explicit close");
  assert.equal(state.expanded, "false", "explicit close should collapse menu state");
}

function testServerFileBrowserModeRestrictsFolders() {
  const app = loadAppContext();
  let state = app.run('__renderBrowserModeProbe("server-file")');
  assert.equal(state.title, "Choose a server file.");
  assert.equal(state.eyebrow, "Server files");
  assert.equal(state.addCurrentHidden, true, "server-file mode should hide Add current folder");
  assert.equal(state.addCurrentDisabled, true, "server-file mode should disable Add current folder");
  assert.equal(state.addCurrentPath, "", "server-file mode should not expose current folder as a resource link");
  assert.equal(state.entriesHtml.includes('data-browser-open="/remote/data"'), true, "server-file mode should still allow browsing into folders");
  assert.equal(state.entriesHtml.includes('data-resource-add-path="/remote/data"'), false, "server-file mode should not allow using folders");
  assert.equal(state.entriesHtml.includes('data-resource-add-path="/remote/paper.pdf"'), true, "server-file mode should allow using files");
  assert.equal(state.note.includes("only files can be attached"), true, "server-file mode should explain that only files can be attached");

  state = app.run('__renderBrowserModeProbe("default")');
  assert.equal(state.title, "Choose files or folders.");
  assert.equal(state.eyebrow, "Local browser");
  assert.equal(state.addCurrentHidden, false, "default browser mode should show Add current folder");
  assert.equal(state.addCurrentDisabled, false, "default browser mode should enable Add current folder");
  assert.equal(state.addCurrentPath, "/remote", "default browser mode should allow the current folder");
  assert.equal(state.entriesHtml.includes('data-resource-add-path="/remote/data"'), true, "default browser mode should allow using folders");
  assert.equal(state.entriesHtml.includes('data-resource-add-path="/remote/paper.pdf"'), true, "default browser mode should allow using files");
}

async function testLocalBrowserSearchAcceptsPaths() {
  const app = loadAppContext();
  const classified = app.run(`__browserPathClassificationProbe([
    "E:\\\\Github\\\\Repo",
    "E:/Github/Repo",
    "C:",
    "\\\\\\\\server\\\\share\\\\folder",
    "\\\\\\\\?\\\\E:\\\\Github\\\\Repo",
    "file:///E:/Github/Repo",
    "file:///Users/example/Repo",
    "~/Repo",
    "./Repo",
    "../Repo",
    "/Users/example/Repo",
    "paper title"
  ])`);
  const actual = Object.fromEntries(classified);
  assert.equal(actual["E:\\Github\\Repo"], true, "Windows drive paths should be treated as paths");
  assert.equal(actual["E:/Github/Repo"], true, "Windows slash paths should be treated as paths");
  assert.equal(actual["C:"], true, "drive roots should be treated as paths");
  assert.equal(actual["\\\\server\\share\\folder"], true, "UNC paths should be treated as paths");
  assert.equal(actual["\\\\?\\E:\\Github\\Repo"], true, "Windows long paths should be treated as paths");
  assert.equal(actual["file:///E:/Github/Repo"], true, "Windows file URLs should be treated as paths");
  assert.equal(actual["file:///Users/example/Repo"], true, "Unix file URLs should be treated as paths");
  assert.equal(actual["~/Repo"], true, "home-relative paths should be treated as paths");
  assert.equal(actual["./Repo"], true, "relative dot paths should be treated as paths");
  assert.equal(actual["../Repo"], true, "parent-relative paths should be treated as paths");
  assert.equal(actual["/Users/example/Repo"], true, "absolute Unix paths should be treated as paths");
  assert.equal(actual["paper title"], false, "ordinary search text should stay a search");

  let state = await app.context.__browserInputProbe("E:\\Github\\Repo");
  assert.equal(state.calls.length, 0, "typing a path should not issue a current-folder search");

  state = await app.context.__browserInputProbe("paper");
  assert.equal(state.calls.length, 1, "typing ordinary search text should search current folder");
  let url = new URL(state.calls[0], "http://local");
  assert.equal(url.pathname, "/api/local/browse");
  assert.equal(url.searchParams.get("path"), "/current");
  assert.equal(url.searchParams.get("q"), "paper");

  state = await app.context.__browserJumpProbe("E:\\Github\\Repo", "E:\\Github\\Repo");
  assert.equal(state.calls.length, 1, "Go should browse pasted paths");
  url = new URL(state.calls[0], "http://local");
  assert.equal(url.searchParams.get("path"), "E:\\Github\\Repo");
  assert.equal(url.searchParams.has("q"), false);
  assert.equal(state.path, "E:\\Github\\Repo");
  assert.equal(state.searchValue, "", "successful path jumps should clear the search box");

  state = await app.context.__browserJumpProbe("paper", "/current");
  url = new URL(state.calls[0], "http://local");
  assert.equal(url.searchParams.get("path"), "/current");
  assert.equal(url.searchParams.get("q"), "paper");
  assert.equal(state.searchValue, "paper", "ordinary Go searches should preserve the search text");

  state = await app.context.__browserJumpProbe("Z:\\missing", "/current", "Path does not exist or cannot be opened: Z:\\missing");
  assert.equal(state.entriesHtml.includes("Path does not exist or cannot be opened"), true, "path failures should show backend path errors");
  assert.equal(state.toasts.some((toast) => toast.error && toast.message.includes("Path does not exist")), true);
  assert.equal(state.searchValue, "Z:\\missing", "failed path jumps should leave the typed path available");
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
  assert.equal(state.singleLine, true, "empty compact composer should use the single-line centering class");
  assert.equal(state.rows, 1, "compact composer should start from a one-row textarea");
  assert.equal(state.height, "44px");
  assert.equal(state.overflowY, "hidden");

  state = app.run('__resizeColdEditorProbe({ value: "S", scrollHeight: 44 })');
  assert.equal(state.singleLine, true, "single-line input should use the centering class");
  assert.equal(state.height, "44px");
  assert.equal(state.overflowY, "hidden");

  state = app.run('__resizeColdEditorProbe({ value: "Line one\\nLine two", scrollHeight: 88 })');
  assert.equal(state.singleLine, false, "explicit multiline input should not use single-line centering");
  assert.equal(state.height, "88px");
  assert.equal(state.overflowY, "hidden");

  state = app.run('__resizeColdEditorProbe({ value: "A long wrapped composer line", scrollHeight: 88 })');
  assert.equal(state.singleLine, false, "wrapped input should not use single-line centering");
  assert.equal(state.height, "88px");
  assert.equal(state.overflowY, "hidden");

  state = app.run('__resizeColdEditorProbe({ value: "Overflowing composer content", scrollHeight: 400 })');
  assert.equal(state.singleLine, false, "overflowing input should not use single-line centering");
  assert.equal(state.height, "306px");
  assert.equal(state.overflowY, "auto");
}

function testComposerPromptInsertionIsIdempotent() {
  const app = loadAppContext();
  app.coldEditor.value = "";
  app.run('insertComposerPrompt("/status")');
  assert.equal(app.coldEditor.value, "/status", "empty composer should receive the selected prompt");
  app.run('insertComposerPrompt("/status")');
  assert.equal(app.coldEditor.value, "/status", "clicking the same prompt twice should not duplicate it");

  app.coldEditor.value = "Please explain this run";
  app.run('insertComposerPrompt("/status")');
  assert.equal(app.coldEditor.value, "Please explain this run\n/status", "prompt should append once after existing user text");
  app.run('insertComposerPrompt("/status")');
  assert.equal(app.coldEditor.value, "Please explain this run\n/status", "existing user text plus prompt should remain idempotent");

  app.coldEditor.value = "/status";
  app.run('insertComposerPrompt("/diff")');
  assert.equal(app.coldEditor.value, "/diff", "a lone command should be replaced by the newly selected command");

  app.coldEditor.value = "Please explain this run\n/status";
  app.run('insertComposerPrompt("/diff")');
  assert.equal(app.coldEditor.value, "Please explain this run\n/diff", "the trailing command line should be replaced while preserving user text");

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
  app.run('insertComposerPrompt("/status")');
  assert.equal(app.coldEditor.value, "/status", "status prompt should insert the selected command once");
  app.run('insertComposerPrompt("/status")');
  assert.equal(app.coldEditor.value, "/status", "status prompt should not duplicate");
  app.run('insertComposerPrompt("/diff")');
  assert.equal(app.coldEditor.value, "/diff", "command prompt should replace an existing slash command");
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
  assert.equal(panel.includes("Download paper-writing pack"), true);
  assert.equal(panel.includes('data-export-kind="blueprint"'), true);
  assert.equal(panel.includes("Download clean project package"), true);
  assert.equal(panel.includes('data-export-kind="final_project"'), true);
  assert.equal(panel.includes("Best for GPT/Claude drafting"), true);
  assert.equal(panel.includes("Best for project handoff"), true);
  assert.equal(panel.includes('class="primary-button small-button" type="button" data-export-kind="blueprint"'), true);
  assert.equal(panel.includes('class="secondary-button small-button" type="button" data-export-kind="final_project"'), true);
  assert.equal(panel.includes("Open BLUEPRINT.md"), false);
  assert.equal(panel.includes("Paper-writing handoff"), true);
  assert.equal(panel.includes("Download blueprint pack"), false);
  assert.equal(panel.includes("Download final project pack"), false);

  const readyPanel = base.run(`__renderExportPanelProbe(${JSON.stringify({
    id: "ex_ready",
    kind: "blueprint",
    label: "Paper-Writing Pack",
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
    label: "Clean Project Package",
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
    label: "Paper-Writing Pack",
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
    label: "Paper-Writing Pack",
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
  assert.equal(underResult.calls.some((call) => call.endpoint === "/api/export/start" && call.body.kind === "blueprint"), true);
  assert.equal(underResult.activeExportJob.status, "packaging");
  assert.equal(underResult.panel.includes("BLUEPRINT.md"), true);
  assert.equal(underResult.panel.includes('data-export-kind="blueprint" disabled'), true);
  assert.equal(underResult.panel.includes('data-export-kind="final_project" disabled'), true);
  assert.equal(underResult.panel.includes("Open BLUEPRINT.md"), false);

  const over = loadAppContext();
  const overEstimate = {
    kind: "final_project",
    label: "Clean Project Package",
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
  assert.equal(overCalls.some((call) => call.endpoint === "/api/export/start" && call.body.kind === "final_project" && call.body.confirmed === true), true);

  const download = loadAppContext();
  const href = download.run(`
    activeExportJob = { id: "ex_dl", kind: "blueprint", label: "Paper-Writing Pack", status: "ready", phase: "ready", download_url: "/api/export/download?id=ex_dl" };
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
      body: "Target-venue role: Summarize the argument.\nSection brief: The abstract states the finished argument and evidence posture without drafting final prose.\nLocal thesis / purpose: Calibration is the paper's central result.\nLocal claims in plain language: The paper advances one bounded claim.\nEvidence: E1 supports the claim.\nParagraph plan:\n\n| Para | Rhetorical move | Content to cover, not full prose | Local evidence / result / artifact | Display / method / result block | Citation posture | Required qualification | Transition job |\n|---|---|---|---|---|---|---|---|\n| A1 | State contribution | Summarize the result. | E1 | none | no citations | none | open paper |"
    }, {
      title: "Section 2: Calibration result",
      level: 2,
      is_artifact: false,
      path: "Section 2",
      body: "Target-venue role: Results-like argument.\nSection brief: This section explains the calibration result, ties it to reviewed evidence, and places the figure and table where readers need them.\nReader question answered: What result should the reader take away?\nLocal thesis / purpose: Calibration changes the observed outcome in the accepted evidence.\nLocal claims in plain language: The local claim is understandable without opening an ID map.\nEvidence: Evidence E1 supports the local result.\nPlaced displays / methods / results: Figure F000001 and Table T000001.\nTransition job: sets up interpretation."
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
        "Source artifact or spec path: `manuscript/figures/calibration_map.pdf`",
        "Preview image: none"
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
    appendix_plan: "Supplement A explains the source classes, coding rubric, and aggregation limits for Table T000001.",
    appendix_files: [{
      path: "manuscript/appendix/table_t1_source_method.md",
      title: "Table T1 source and method appendix",
      summary: "Reader-facing appendix for source classes, coding fields, and aggregation rules."
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
  assert.equal(html.includes("Evidence / results") || html.includes("Evidence / results / artifacts"), true);
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
  assert.equal(html.includes("Appendix"), true);
  assert.equal(html.includes("Appendix / supplement"), true);
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
  assert.equal(html.includes("Supplement A explains the source classes"), true);
  assert.equal(html.includes("Table T1 source and method appendix"), true);
  assert.equal(html.includes('data-inline-fullscreen="manuscript/appendix/table_t1_source_method.md"'), true);
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

function testSettingsDialogResizeHandlePersistsSize() {
  const app = loadAppContext();
  let state = app.run("__settingsDialogResizeProbe(120, 80, 1180, 820)");
  assert.equal(state.width, "1300px", "settings resize handle should change width");
  assert.equal(state.height, "830px", "settings resize handle should clamp height to the viewport");
  assert.equal(state.captured, 87);
  assert.equal(state.released, 87);
  assert.equal(state.resizing, false, "settings resize class should be cleared after pointerup");
  assert.deepEqual(JSON.parse(state.persisted), { width: 1300, height: 830 });

  state = app.run("__settingsDialogResizeProbe(-600, -500, 900, 650)");
  assert.equal(state.width, "760px", "settings resize should clamp to minimum width");
  assert.equal(state.height, "520px", "settings resize should clamp to minimum height");
  assert.deepEqual(JSON.parse(state.persisted), { width: 760, height: 520 });
}

async function testManuscriptPanelRendersPaperFiguresTablesAndTraceability() {
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
        "Evidence: Evidence E1 supports the local result.",
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
        "Preview image: none",
        "Result shown or conceptual basis: Evidence E1.",
        "Provenance links: `research_trajectory/CURRENT_FINDINGS.md`",
        "Target-venue fit rationale: Fits a compact result-led display.",
        "Remaining blocker: none."
      ].join("\n")
    }, {
      title: "Figure F000002: Rendered Image",
      level: 4,
      kind: "figure",
      is_artifact: true,
      path: "Section 2: Calibration result / Figure F000002: Rendered Image",
      body: [
        "Placement: Section 2 paragraph P2.",
        "Inclusion status: active",
        "Purpose or result role: Shows the generated manuscript image.",
        "Reader takeaway: The generated image is displayed inline.",
        "Content and panel layout: Single panel visual.",
        "Visual style: restrained.",
        "Caption draft or current caption: Rendered image caption.",
        "Source artifact or spec path: `manuscript/figures/generated/rendered_image.png`",
        "Preview image:",
        "",
        "![Figure F000002: Rendered Image](figures/generated/rendered_image.png)",
        "Result shown or conceptual basis: Evidence E2.",
        "Provenance links: `research_trajectory/CURRENT_FINDINGS.md`",
        "Target-venue fit rationale: Fits an image-led display.",
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
    appendix_plan: "Appendix A carries source provenance and the table coding method.",
    appendix_files: [{
      path: "manuscript/appendix/table_t1_source_method.md",
      title: "Table T1 source and method appendix",
      summary: "Source classes, coding fields, aggregation rules, exclusions, and limits."
    }],
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
  assert.equal(html.includes("manuscript-layout"), true, "manuscript panel should render the outline/reader layout shell");
  assert.equal(html.includes("manuscript-outline-panel"), true, "manuscript panel should render a left outline panel");
  assert.equal(html.includes("manuscript-reader"), true, "manuscript panel should render a centered reader column");
  assert.equal(html.indexOf("manuscript-outline-panel") < html.indexOf("manuscript-reader"), true, "outline should render before the reader column");
  assert.equal(html.includes('id="manuscript-story-map"'), true, "manuscript panel should still render the story map section");
  assert.equal(html.includes('href="#section-2-calibration-result"'), true, "outline should link to manuscript sections");
  assert.equal(html.includes('href="#table-t000001-evidence-matrix"'), true, "outline should link to table artifacts");
  assert.equal(html.includes('href="#manuscript-blueprint-section"'), true, "outline should link to the current manuscript file");
  assert.equal(html.includes("manuscript-export-bar"), true);
  assert.equal(html.includes("Paper-writing handoff"), true);
  assert.equal(html.includes("Download paper-writing pack"), true);
  assert.equal(html.includes("Download clean project package"), true);
  assert.equal(html.includes("Best for GPT/Claude drafting"), true);
  assert.equal(html.includes("Best for project handoff"), true);
  assert.equal(html.includes("Paper package ready"), true);
  assert.equal(html.includes("Open BLUEPRINT.md"), false);
  assert.equal(html.includes("Download BLUEPRINT.md"), true);
  assert.equal(html.includes('data-inline-fullscreen="manuscript/BLUEPRINT.md"'), false);
  assert.equal(html.includes('data-download-single-file="manuscript/BLUEPRINT.md"'), true);
  assert.equal(html.includes("<span>Manuscript</span>"), true);
  assert.equal(html.includes("Current manuscript file"), true);
  assert.equal(html.includes('href="#manuscript-export"'), false, "manuscript outline group should not link to the export package");
  assert.equal(html.includes("<span>Overview</span>"), false);
  assert.equal(html.includes("Export final results"), false);
  assert.equal(html.includes("Download blueprint pack"), false);
  assert.equal(html.includes("Download final project pack"), false);
  assert.equal(html.indexOf("manuscript-export-bar") < html.indexOf("context-card"), true, "export controls should render before manuscript context cards");
  assert.equal(
    html.indexOf('<div class="export-panel">') < html.indexOf("Download paper-writing pack"),
    true,
    "export panel should render the package choices directly"
  );
  assert.equal(html.includes("Manuscript story map"), true);
  assert.equal(html.includes("manuscript-story-map"), true);
  assert.equal(html.includes("Finished-results blueprint"), true);
  assert.equal(html.includes("Paper flow"), true);
  assert.equal(html.includes("Nature Machine Intelligence"), true);
  assert.equal(html.includes("Perspective"), true);
  assert.equal(html.includes("Audit / provenance"), true);
  assert.equal(html.includes("Appendix / supplement"), true);
  assert.equal(html.indexOf('id="manuscript-story-section"') < html.indexOf('id="manuscript-appendix-section"'), true, "story map should render before appendix and audit sections");
  assert.equal(html.indexOf('id="manuscript-appendix-section"') < html.indexOf('id="manuscript-audit-section"'), true, "appendix should render before audit and provenance");
  assert.equal(html.indexOf('id="manuscript-story-section"') < html.indexOf('id="manuscript-audit-section"'), true, "story map should render before audit and raw file sections");
  assert.equal(html.includes("manuscript-abstract-card"), true);
  assert.equal(html.includes("architecture-field-list"), true);
  assert.equal(html.includes("architecture-field-row is-long"), true);
  assert.equal(html.includes("paragraph-plan-scroll"), true);
  assert.equal(html.includes("paper-field-grid architecture-field-grid"), false);
  assert.equal(html.includes("Main takeaway"), true);
  assert.equal(html.includes("What this section says"), true);
  assert.equal(html.includes("Evidence / results") || html.includes("Evidence / results / artifacts"), true);
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
  assert.equal(html.includes("Copy description"), true);
  assert.equal(html.includes("Generate image"), false, "image generation should run automatically without rendering a Generate image button");
  assert.equal(html.includes("Open source"), true);
  assert.equal(html.includes("manuscript/figures/calibration_map.pdf"), true);
  assert.equal(html.includes("manuscript/figures/generated/rendered_image.png"), true);
  assert.equal(html.includes('src="/api/file/raw?path=manuscript%2Ffigures%2Fgenerated%2Frendered_image.png'), true, "image source paths should render inline previews");
  assert.equal(html.includes('src="/api/file/raw?path=manuscript%2Ffigures%2Fcalibration_map.pdf'), false, "PDF source paths should not render as inline images");
  const tableBlockIndex = html.indexOf("Table block");
  assert.equal(tableBlockIndex >= 0, true);
  const tableBlockEnd = html.indexOf("</article>", tableBlockIndex);
  const tableBlockHtml = html.slice(tableBlockIndex, tableBlockEnd);
  assert.equal(tableBlockHtml.includes("Generate image"), false, "table blocks should not render figure image generation actions");
  assert.equal(html.includes("No active tables are present because the current evidence is figure-led."), true);
  assert.equal(html.includes("Claim C1 maps to calibration evidence E1."), true);
  assert.equal(html.includes("Appendix A carries source provenance"), true);
  assert.equal(html.includes("Table T1 source and method appendix"), true);
  assert.equal(html.includes("manuscript/appendix/table_t1_source_method.md"), true);
  assert.equal(html.includes("Figure descriptions"), false);
  assert.equal(html.includes("manuscript-table-card"), true);
  assert.equal(html.includes("Table block"), true);
  assert.equal(html.includes("Calibration claim"), true);
  assert.equal(html.includes("Table 1. Evidence matrix for the calibration claim."), true);
  assert.equal(html.includes("E1 denotes the accepted source audit."), true);
  assert.equal(html.includes("table-missing-warning"), false);

  app.run('document.querySelector("#session-settings-form").elements.backend.value = "claude"');
  const claudeHtml = app.run(`__renderManuscriptPanelProbe(${JSON.stringify(payload)})`);
  assert.equal(claudeHtml.includes("Copy description"), true);
  assert.equal(claudeHtml.includes("Generate image"), false, "Claude Code backend should not render Codex image generation actions");

  const codexAuto = await app.run(`__autoFigureImageProbe(${JSON.stringify(payload)}, { backend: "codex" })`);
  const codexStart = codexAuto.calls.find((call) => call.endpoint === "/api/manuscript/figure-image/start");
  assert.equal(Boolean(codexStart), true, "Codex backend should auto-start figure image generation");
  assert.equal(codexStart.body.title, "Figure F000001: Calibration Map");
  assert.equal(codexStart.body.sourcePath, "manuscript/figures/calibration_map.pdf");

  const fourMissingPayload = JSON.parse(JSON.stringify(payload));
  fourMissingPayload.architecture[3].body = fourMissingPayload.architecture[3].body
    .replace("manuscript/figures/generated/rendered_image.png", "manuscript/figures/rendered_image.pdf");
  fourMissingPayload.architecture.splice(4, 0, {
    title: "Figure F000003: Third Missing Image",
    level: 4,
    kind: "figure",
    is_artifact: true,
    body: [
      "Placement: Section 2 paragraph P3.",
      "Inclusion status: active",
      "Purpose or result role: Shows a third missing figure.",
      "Content and panel layout: Single panel visual.",
      "Visual style: restrained.",
      "Caption draft or current caption: Third image caption.",
      "Source artifact or spec path: `manuscript/figures/third_missing.pdf`",
      "Preview image: none",
    ].join("\n")
  }, {
    title: "Figure F000004: Fourth Missing Image",
    level: 4,
    kind: "figure",
    is_artifact: true,
    body: [
      "Placement: Section 2 paragraph P4.",
      "Inclusion status: active",
      "Purpose or result role: Shows a fourth missing figure.",
      "Content and panel layout: Single panel visual.",
      "Visual style: restrained.",
      "Caption draft or current caption: Fourth image caption.",
      "Source artifact or spec path: `manuscript/figures/fourth_missing.pdf`",
      "Preview image: none",
    ].join("\n")
  });
  const fourMissingAuto = await app.run(`__autoFigureImageProbe(${JSON.stringify(fourMissingPayload)}, { backend: "codex", status: "running" })`);
  const fourMissingStarts = fourMissingAuto.calls.filter((call) => call.endpoint === "/api/manuscript/figure-image/start");
  assert.equal(fourMissingStarts.length, 3, "automatic figure image generation should cap concurrent Codex jobs at three");
  assertJsonEqual(
    fourMissingStarts.map((call) => call.body.title),
    ["Figure F000001: Calibration Map", "Figure F000002: Rendered Image", "Figure F000003: Third Missing Image"],
    "automatic figure image generation should start the first three eligible missing figures"
  );

  const claudeAuto = await app.run(`__autoFigureImageProbe(${JSON.stringify(payload)}, { backend: "claude" })`);
  assert.equal(claudeAuto.calls.some((call) => call.endpoint === "/api/manuscript/figure-image/start"), false, "Claude Code backend should not auto-start Codex image generation");

  const forcedCodexAuto = await app.run(`__autoFigureImageProbe(${JSON.stringify(payload)}, { backend: "claude", envOverride: "codex" })`);
  assert.equal(forcedCodexAuto.calls.some((call) => call.endpoint === "/api/manuscript/figure-image/start"), true, "Codex env override should auto-start generation even if the form shows Claude");

  const forcedClaudeAuto = await app.run(`__autoFigureImageProbe(${JSON.stringify(payload)}, { backend: "codex", envOverride: "claude" })`);
  assert.equal(forcedClaudeAuto.calls.some((call) => call.endpoint === "/api/manuscript/figure-image/start"), false, "Claude env override should block Codex image generation even if the form shows Codex");

  const invalidOverrideAuto = await app.run(`__autoFigureImageProbe(${JSON.stringify(payload)}, { backend: "claude", envOverride: "bad-agent" })`);
  assert.equal(invalidOverrideAuto.calls.some((call) => call.endpoint === "/api/manuscript/figure-image/start"), false, "Invalid env override should not default into Codex image generation");

  app.run('uiSettings = { ...(uiSettings || {}), agent_status: {} }');
  app.run('document.querySelector("#session-settings-form").elements.backend.value = "codex"');

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

  const malformedResultHtml = app.run(`__renderManuscriptPanelProbe(${JSON.stringify({
    architecture: [{
      title: "Result 2: Adult-kin source enrichment",
      level: 4,
      kind: "result",
      is_artifact: true,
      body: [
        "Target-venue role: source-role distribution result.",
        "Section brief: This should compare source-resident shares with roster availability.",
        "Local claims in plain language: planned only.",
        "Local evidence, results, or artifacts: pending source-role and null-check trial.",
        "Placed displays / methods / results: Figure F2, planned.",
        "Transition job: Leads to household structure."
      ].join("\\n")
    }],
    toc: "",
    figure_specs: [],
    table_plans: []
  })})`);
  assert.equal(malformedResultHtml.includes("artifact-schema-warning"), true);
  assert.equal(malformedResultHtml.includes("using section-planning fields instead of result fields"), true);
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

function testFramingThreadScrollUpdatesBottomButtonImmediately() {
  const app = loadAppContext();
  const state = app.run(`
    activeView = "chat";
    document.querySelector("#chat-view").hidden = false;
    document.querySelector("#brief-editor-shell").classList.add("is-framing-dock");
    document.querySelector("#cold-start-workspace").classList.add("has-framing-thread");
    document.body.classList.add("has-brief-dock");

    const thread = document.querySelector("#framing-thread");
    const button = document.querySelector("#framing-scroll-bottom");
    thread.hidden = false;
    thread.clientHeight = 600;
    thread.scrollHeight = 1400;
    thread.scrollTop = 0;

    updateFramingScrollButton();
    const visibleBefore = !button.hidden && document.body.classList.contains("has-framing-scroll-button");

    thread.scrollTop = 800;
    thread.dispatchEvent({ type: "scroll", target: thread });
    const hiddenAtBottom = button.hidden && !document.body.classList.contains("has-framing-scroll-button");

    thread.scrollTop = 520;
    thread.dispatchEvent({ type: "scroll", target: thread });
    const hiddenNearBottom = button.hidden && !document.body.classList.contains("has-framing-scroll-button");

    thread.scrollTop = 120;
    thread.dispatchEvent({ type: "scroll", target: thread });
    const visibleAfterLeavingBottom = !button.hidden && document.body.classList.contains("has-framing-scroll-button");

    ({ visibleBefore, hiddenAtBottom, hiddenNearBottom, visibleAfterLeavingBottom });
  `);
  assert.equal(state.visibleBefore, true, "scroll-to-bottom button should show when the framing thread is away from the bottom");
  assert.equal(state.hiddenAtBottom, true, "framing thread scroll events should hide the button immediately at the bottom");
  assert.equal(state.hiddenNearBottom, true, "scroll-to-bottom button should stay hidden until the thread is meaningfully away from the bottom");
  assert.equal(state.visibleAfterLeavingBottom, true, "framing thread scroll events should show the button immediately after crossing the reveal threshold");
}

function testAgentPanelScrollRestoreAndEntryBehavior() {
  const app = loadAppContext();
  const state = app.run(`
    const main = document.querySelector(".main-stage");

    activeView = "chat";
    activePanel = "resources";
    chatScrollRestoredProjectId = "";
    globalThis.__scrollCount = 0;
    main.scrollTop = 360;
    persistActiveViewScrollPosition();
    main.scrollTop = 0;
    globalThis.__renderFramingConversationImpl();
    const refreshAgentScrollTop = main.scrollTop;
    const refreshAgentScrollCount = globalThis.__scrollCount;

    main.scrollTop = 420;
    persistActiveViewScrollPosition();
    main.scrollTop = 0;
    setPanel("chat");
    const sameAgentScrollTop = main.scrollTop;
    const sameAgentScrollCount = globalThis.__scrollCount;

    activeView = "materials";
    activePanel = "manuscript";
    main.scrollTop = 700;
    setPanel("chat");

    ({
      refreshAgentScrollTop,
      refreshAgentScrollCount,
      sameAgentScrollTop,
      sameAgentScrollCount,
      afterMaterialScrollCount: globalThis.__scrollCount,
      activeView,
      activePanel,
      storedAgentScroll: localStorage.getItem(scopedStorageKey("viewScroll:chat")),
      storedMaterialScroll: localStorage.getItem(scopedStorageKey("viewScroll:manuscript"))
    });
  `);
  assert.equal(state.refreshAgentScrollTop, 360, "refresh-style Agent render should restore the previous Agent scroll position");
  assert.equal(state.refreshAgentScrollCount, 0, "refresh-style Agent render should not force-scroll to latest");
  assert.equal(state.sameAgentScrollTop, 420, "refresh-style Agent restore should keep the user's previous Agent scroll position");
  assert.equal(state.sameAgentScrollCount, 0, "re-entering Agent from Agent should not force-scroll to latest");
  assert.equal(state.afterMaterialScrollCount, 1, "entering Agent from another panel should scroll to the latest interaction");
  assert.equal(state.activeView, "chat", "Agent view should be active after switching from a material panel");
  assert.equal(state.storedAgentScroll, "420", "Agent scroll should be persisted project-locally");
  assert.equal(state.storedMaterialScroll, "700", "leaving a material panel should persist its scroll before switching to Agent");
}

testButtonInventoryHasHandlers();
testNavigationStatePersistsPanelAndScroll();
testFramingThreadScrollUpdatesBottomButtonImmediately();
testAgentPanelScrollRestoreAndEntryBehavior();
await testImmediateUserMessage();
await testTerminalSendResponseClearsImmediatePending();
await testExistingProjectComposerUsesChatEndpoint();
await testEmptyProjectPrepareUsesChatEndpoint();
testProjectLoadingStates();
await testSilentOverviewPollDoesNotShowLoading();
await testPrelaunchAffordanceStatesAndActions();
await testPlanComposerModeUsesPlanEndpoint();
await testPlanChipCanReturnToChat();
await testTypedPlanSlashIsConvertedLocally();
await testPlanRequestBlockedDuringActiveRun();
await testPlanCardApproveReviseAndResend();
await testPlanCardShowsLaunchWhenProjectReady();
testPlanCardHidesLaunchAfterAutoresearchStarts();
await testFreshRemoteProjectFirstMessageSends();
await testFreshRemoteProjectStaleRunningSnapshotStillSends();
testPrestartPendingExpectedTrialDoesNotShowAutoresearchPanel();
await testRunningChatMessageIsQueued();
await testRunningSteeringLookingMessageIsQueuedTheSameWay();
await testQueuedChatCanReorderAndDelete();
await testStopAndSendQueuesPriorityThenStops();
testDuplicateQueuedUserTurnsRestoreFromServerMessages();
testRepeatedQueuedTranscriptUserTurnsAreRecovered();
await testAttachmentOnlyMessage();
await testResourceLinksDoNotRepeatAcrossMessages();
await testResumeFromTrialRequiresConfirmationAndSendsPayload();
await testPrepareSubmitWithResumeContextSendsResumePayload();
await testResumeFromTrialCancelPreservesComposer();
await testResumeTrialSlashCommandIsBlocked();
await testFailedSessionSendRestoresComposerState();
await testSuccessfulSessionSendClearsComposerDraft();
await testSlashCommandVisibleAndIgnoredAsUnanswered();
await testLegacyGoalRestartCommandUsesCommandEndpoint();
await testLegacyGoalRestartIgnoresRestartCancelFlag();
await testTypedLegacyGoalControlsStayOnCommandEndpoint();
testStaleOverviewDoesNotSwallowPendingUser();
testRunningReplyKeepsWorkingAfterShortAnswer();
testTranscriptRecoveryUsesOnlyFinalAssistant();
testClaudeResultSuccessRecoversAssistantReply();
testClaudeWorkedActivityUsesActivityPanel();
await testResearchEventStreamUpsertsTranscriptAndCompletes();
testResearchEventStreamSyncsPlanArtifact();
testResearchEventStreamProjectSwitchAndErrorFallback();
testTranscriptEntriesDoNotExposeEdit();
await testEditTruncatesLaterConversationBeforeResend();
await testEditAfterAutoresearchFirstMessageUsesChat();
await testSteeringResendStartsVisibleNormalChatRun();
await testResendRendersEditedUserBeforeSlowUploadCollection();
await testLegacyRecordedInterventionMessageStillRenders();
await testEditPreProjectMessageUsesChat();
await testEditPreProjectMessageDoesNotUseRegenerateConfirmation();
await testEditAttachmentsCanRemoveRetainAndAdd();
await testLaunchGoalMessageBeforeBackendWork();
testStartAutoresearchAppearsAtAssistantReplyEnd();
testStartAutoresearchAppearsWhenProjectArtifactPrecedesReply();
testChatGeneratedProjectDraftIsSurfaced();
testStartAutoresearchUsesCurrentProjectDraftWithoutArtifactMessage();
testProjectLaunchFallbackWithoutAssistantReply();
testMarkdownSoftBreakRendersAsSeparator();
testMarkdownOrderedListsPreserveExplicitNumbers();
testMarkdownImagesResolveRelativeToSourceFile();
testMessagesExposeCopyButtons();
testFileTreePdfPreviewControls();
testSessionTimelineDoesNotRenderCurrentActivityCard();
testRunningTrialHidesArtifactButtons();
testTrialOpenButtonsUseManuscriptSnapshotWhenAvailable();
testTrialOpenButtonsFallBackToLatestManuscript();
testManualTrialSelectionOverridesRunningPanel();
testAutoresearchPanelCollapsePersists();
testAutoresearchLiveStripZeroEventActivity();
testAutoresearchTrajectoryGraphIsNotRenderedInDock();
testAutoresearchPanelRendersInFloatingDock();
testPausedAutoresearchActionsRenderInTrialPanel();
testAutoresearchPanelPersistsAfterFramingReply();
testReportedTrialShowsContinueFromThisTrial();
testLatestClosedTrialShowsResumeAutoresearch();
testLowInformationTrialSummaryIsOmitted();
testNonActionableHumanResponseIsOmitted();
testBlockedGateWithoutHumanResponseShowsNotice();
testUnclosedPreviousTrialShowsClosingDuringNextLiveRun();
testOldTrialDoesNotShowStaleHumanResponse();
testPassedAutoresearchPanelHidesResumeAllowsRestart();
testStagedTrialContinueActionsRenderInTrialPanel();
await testResumeAutoresearchActionUsesResumeEndpoint();
testRunningTrialIgnoresPreviousRunUpdate();
testPassedGoalDoesNotShowStaleRunningTrial();
testContinuedBaseTrialStatusLabel();
testClosedTrialsUseDoneStatus();
testHistoricalReportedTrialsDoNotUseIncompleteChipStyle();
testChatRunThinkingUsesLiveStatus();
testChatRunCommandOnlyKeepsRawCommandFolded();
testLocalPendingDoesNotFlashPreviousRunUpdates();
testRunningProgressIgnoresLateLocalPendingTimestamp();
testTerminalChatRunWithoutAssistantShowsStatus();
testRunningProgressFallsBackToReasoningSummary();
testCurrentRunningTranscriptGroupDoesNotRenderWorkedActivity();
testWorkingDurationFormatter();
testWorkingDurationUsesServerClockOffset();
testTrialStripScrollRestoresAcrossRender();
testRunningTrialUsesProgressFallback();
testStatusCardShowsReviewCheckpoint();
testStatusCardShowsGateHumanResponse();
testReviewStorageOutdatedDoesNotShowProjectWarning();
testReviewsPanelGroupsByTrial();
testComposerPlaceholderBecomesGeneralAfterLaunch();
testUncreatedTrialMentionDoesNotCreateTimelineTrial();
testSettingsRenderPreservesComposerDraft();
testProjectScopedSessionSettingsOverrideServerDefaults();
testComposerModelReasoningChangesPersistProjectScoped();
testAgentBackendSelectorPersistsProviderSettings();
testSettingsBackendSwitchNormalizesModelFamily();
testReasoningOptionsFollowBackendModel();
await testProjectCreateSendsBackendAndLoadsProjectDefault();
await testStaleOverviewResponseDoesNotReopenPreviousProject();
await testOverviewRequestPinsActiveProject();
await testProjectAliasCanonicalizesBeforeAvailability();
testEmptyDashboardStateSurvivesStaleActiveProject();
testAgentReadinessStatusBlocksLaunchUi();
testAgentReadinessMatrixShowsActionableSetup();
testLaunchBlockingStateMatrix();
testEnvForcedBackendStatusMessage();
testInvalidEnvBackendStatusWarning();
testProviderSpecificResumeCommand();
await testSettingsModalSaveSyncsScopedSessionSettings();
await testApiKeyProviderSettingsPayloads();
await testClaudeGatewaySettingsPayload();
await testInitialRuntimePreflightFlow();
testSettingsLayoutAndLinkContracts();
testProjectScopedComposerDraftAndTargetVenueRestore();
testThemeModePersistsAndApplies();
testTargetVenueUsesOnlyProjectScopedDraft();
testAttachmentMenuRoutesUploadAndLinkActions();
testServerFileBrowserModeRestrictsFolders();
await testLocalBrowserSearchAcceptsPaths();
await testLargeBrowserUploadsUseResourceCopyFlow();
testCompactComposerAutosizesFromCenteredBase();
testComposerPromptInsertionIsIdempotent();
await testCopyTextHelperWritesClipboard();
await testExportBundleFlow();
testBlueprintInspectorRendersSidebarForLatestManuscriptOnly();
testFileViewerResizeZonesRespectDragAxis();
testSettingsDialogResizeHandlePersistsSize();
await testManuscriptPanelRendersPaperFiguresTablesAndTraceability();

console.log("UI flow test passed.");
process.exit(0);
