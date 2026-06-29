const initialUrlParams = new URLSearchParams(window.location.search);
const MATERIAL_NAVIGATION_PANELS = new Set(["workspace", "resources", "trials", "reviews", "manuscript"]);
const NAVIGATION_PANELS = new Set(["chat", ...MATERIAL_NAVIGATION_PANELS]);
const COMPOSER_MODES = new Set(["chat", "plan"]);

function projectScopedStorageKey(projectId, key) {
  return `coAutoResearch:${projectId || "default"}:${key}`;
}

function projectScopedGet(projectId, key, fallback = "") {
  return localStorage.getItem(projectScopedStorageKey(projectId, key)) ?? fallback;
}

function normalizeNavigationPanel(panel, fallback = "chat") {
  const value = String(panel || "").trim();
  return NAVIGATION_PANELS.has(value) ? value : fallback;
}

function normalizeMaterialPanel(panel, fallback = "resources") {
  const value = String(panel || "").trim();
  return MATERIAL_NAVIGATION_PANELS.has(value) ? value : fallback;
}

function initialNavigationPanel(projectId) {
  return normalizeNavigationPanel(
    initialUrlParams.get("view") ||
      initialUrlParams.get("panel") ||
      projectScopedGet(projectId, "activeNavigationPanel", localStorage.getItem("coAutoResearchActivePanel") || "chat")
  );
}

function initialMaterialPanel(projectId) {
  return normalizeMaterialPanel(
    projectScopedGet(projectId, "activeMaterialPanel", localStorage.getItem("coAutoResearchActiveMaterialPanel") || "resources")
  );
}

function normalizeComposerMode(mode, fallback = "chat") {
  const value = String(mode || "").trim().toLowerCase();
  return COMPOSER_MODES.has(value) ? value : fallback;
}

function initialComposerMode(projectId) {
  return normalizeComposerMode(projectScopedGet(projectId, "composerMode", "chat"));
}

let appState = null;
let activeProjectId = initialUrlParams.get("project") || localStorage.getItem("coAutoResearchActiveProject") || "";
let composerMode = initialComposerMode(activeProjectId);
let pendingPlanRevisionId = "";
const restoredNavigationPanel = initialNavigationPanel(activeProjectId);
let activeView = restoredNavigationPanel === "chat" ? "chat" : "materials";
let activePanel = restoredNavigationPanel === "chat" ? initialMaterialPanel(activeProjectId) : restoredNavigationPanel;
let activeStage = "1";
const FRAMING_MESSAGES_CLIENT_VERSION = "20260617-trial-selection";
let activeColdPath = "";
let toastTimer = null;
let coldAutosaveTimer = null;
let coldDirty = false;
let localBrowserPath = "";
let localBrowserPayload = null;
let browserSearchQuery = "";
let browserSearchTimer = null;
let browserSelectionMode = "default";
let uploadSourceMenu = null;
let uploadSourceMenuAnchor = null;
let pendingUploadSourceEditMessageId = "";
let prepareSaved = false;
let coldViewMode = "source";
let uiSettings = null;
let settingsSecretKeys = [];
let projectDraftDirty = false;
let framingDraftPending = false;
let framingReplyPending = false;
let stopRequestPending = false;
let pendingFramingUserMessageId = "";
let framingPendingSince = 0;
let editingFramingId = "";
let editingQueuedChatId = "";
let draggingQueuedChatId = "";
let queueActionMenuOpen = false;
const editAttachmentDrafts = new Map();
let activeEditResourceTargetId = "";
let pendingPreProjectResendConfirm = null;
let overviewPollTimer = null;
let overviewPollGeneration = 0;
const framingThreadScrollListeners = new WeakSet();
let researchEventSource = null;
let researchEventProjectId = "";
let researchEventLastId = "";
let researchEventReconnectTimer = null;
let researchEventFailureCount = 0;
let researchEventOverviewRefreshPending = false;
let workingTickerTimer = null;
let lastFramingHtml = "";
let framingMessagesPersisting = false;
let framingMessagesSaveVersion = 0;
let serverClockOffsetMs = 0;
let projectLoadPhase = "projects";
let projectLoadError = "";
let initialProjectDialogOpened = false;
let openProjectMenuId = "";
let pendingRenameProject = null;
let pendingDeleteProject = null;
let selectedTrialIndex = 0;
let selectedReviewGroupKey = "";
let trialStripScrollState = {
  mode: "auto",
  left: 0,
  liveIteration: 0,
  selectedIteration: 0,
  touchedAt: 0,
};
let selectedResumeTrialContext = null;
let pendingResumeTrialConfirm = null;
let pendingRestartAutoresearchConfirm = null;
let resumeAutoresearchSubmitting = false;
let activeLargeResourceImportId = "";
let activeExportJob = null;
let exportPollTimer = null;
let pendingExportEstimate = null;
let optimisticResearchSession = null;
let fileViewerResizeState = null;
let settingsResizeState = null;
let fileViewerReturnPath = "";
let viewScrollPersistTimer = null;
let suppressViewScrollPersistence = false;
let viewScrollRestoreToken = 0;
let chatScrollRestoredProjectId = "";
let composerDraft = "";
let autoresearchDockElement = null;
let lastAutoresearchDockHtml = "";
let targetVenueProjectId = activeProjectId || "";
const localMessages = [];
const openRunActivityDetails = new Set();
let activeResourceCategory = "ongoing_work";
const selectedResourceItems = [];
const selectedUploadItems = [];
const pendingResourceImports = [];
const coldFiles = {};
const inlineFiles = {};
const inlineFilePayloads = {};
const inlineFileModes = {};
const figureImageJobs = new Map();
const figureImagePollTimers = new Map();
const figureImageAutoStarted = new Set();
let figureImageAutoTimer = null;
const MAX_AUTO_FIGURE_IMAGE_JOBS = 3;
const COLD_AUTOSAVE_DELAY = 900;
const MAX_BROWSER_UPLOAD_BYTES = 50 * 1024 * 1024;
const LARGE_RESOURCE_CHUNK_BYTES = 8 * 1024 * 1024;
const FILE_VIEWER_SIZE_KEY = "coAutoResearchFileViewerSize";
const SETTINGS_DIALOG_SIZE_KEY = "coAutoResearchSettingsDialogSize";
const INITIAL_PREFLIGHT_DISMISSED_KEY = "coAutoResearchInitialPreflightDismissed";
const AUTORESEARCH_PANEL_COLLAPSED_KEY = "autoresearchPanelCollapsed";
const LATEST_MANUSCRIPT_PATH = "manuscript/BLUEPRINT.md";

const panelTitles = {
  workspace: "Project files",
  resources: "Resources",
  trials: "Trials",
  reviews: "Reviews",
  manuscript: "Manuscript",
};

const defaultAgentSettings = {
  backend: "codex",
};

const agentBackends = {
  codex: "Codex",
  claude: "Claude Code",
};
const allowedAgentBackends = new Set(Object.keys(agentBackends));

const defaultCodexSessionSettings = {
  provider: "cli",
  model: "gpt-5.5",
  reasoningEffort: "medium",
  permissionPreset: "default",
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  webSearch: true,
  fastMode: false,
  extraConfig: "",
  preExecScript: "",
  reviewCheckpointInterval: 100,
};
const defaultClaudeSessionSettings = {
  model: "sonnet",
  reasoningEffort: "high",
  permissionPreset: "auto",
  permissionMode: "auto",
  provider: "external",
  webSearch: true,
  fastMode: false,
  extraConfig: "",
  preExecScript: "",
  reviewCheckpointInterval: 100,
};
const defaultSessionSettings = defaultCodexSessionSettings;
const sessionDefaultsByBackend = {
  codex: defaultCodexSessionSettings,
  claude: defaultClaudeSessionSettings,
};
const modelOptionsByBackend = {
  codex: [
    ["gpt-5.5", "GPT-5.5"],
    ["gpt-5.4", "GPT-5.4"],
    ["gpt-5.4-mini", "GPT-5.4 Mini"],
    ["gpt-5.3-codex", "GPT-5.3 Codex"],
    ["gpt-5.3-codex-spark", "GPT-5.3 Codex Spark"],
    ["gpt-5.2", "GPT-5.2"],
  ],
  claude: [
    ["default", "Claude Default"],
    ["best", "Claude Best"],
    ["opus", "Claude Opus 4.8"],
    ["opus[1m]", "Claude Opus 4.8 1M"],
    ["opusplan", "Claude Opus Plan"],
    ["opusplan[1m]", "Claude Opus Plan 1M"],
    ["sonnet", "Claude Sonnet 4.6"],
    ["sonnet[1m]", "Claude Sonnet 4.6 1M"],
    ["haiku", "Claude Haiku 4.5"],
    ["glm-5.2[1m]", "GLM-5.2 1M"],
    ["glm-5.2", "GLM-5.2"],
    ["glm-5-turbo", "GLM-5 Turbo"],
    ["glm-4.7", "GLM-4.7"],
  ],
};
const codexModelValues = new Set(modelOptionsByBackend.codex.map(([value]) => value));
const discoveredModelsByBackend = {};
const modelDiscoveryInflight = {};

function isKnownCodexModel(value) {
  const model = String(value || "").trim().toLowerCase();
  if (!model) return false;
  if (codexModelValues.has(model)) return true;
  const discovered = discoveredModelsByBackend.codex;
  return Array.isArray(discovered) && discovered.some(([candidate]) => String(candidate || "").trim().toLowerCase() === model);
}

const codexProviderLabels = {
  cli: "Use existing Codex CLI login",
  openai_api_key: "OpenAI API key",
};
const allowedCodexProviders = new Set(Object.keys(codexProviderLabels));
const claudeProviderLabels = {
  external: "Use existing Claude Code configuration",
  anthropic_api_key: "Anthropic API key",
  zai_glm: "Z.AI GLM Coding Plan",
  custom_anthropic: "Custom Anthropic-compatible gateway",
};
const allowedClaudeProviders = new Set(Object.keys(claudeProviderLabels));
const zaiClaudeEnvDefaults = {
  ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
  API_TIMEOUT_MS: "3000000",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1000000",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.5-air",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.2[1m]",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.2[1m]",
};
const codexSecretKeys = new Set(["OPENAI_API_KEY"]);
const claudeGatewaySecretKeys = new Set(["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]);

const backendDocLinks = {
  codex: [
    { label: "Setup", href: "https://developers.openai.com/codex/cli" },
    { label: "Login", href: "https://developers.openai.com/codex/auth" },
    { label: "Models", href: "https://developers.openai.com/api/docs/models" },
    { label: "Latest model guide", href: "https://developers.openai.com/api/docs/guides/latest-model" },
  ],
  claude: [
    { label: "Setup", href: "https://code.claude.com/docs/en/quickstart" },
    { label: "Login", href: "https://code.claude.com/docs/en/iam" },
    { label: "Models", href: "https://docs.claude.com/en/docs/about-claude/models/overview" },
    { label: "Pick a model", href: "https://docs.claude.com/en/docs/about-claude/models/choosing-a-model" },
  ],
};

const defaultThemeMode = "atelier-ivory";
const allowedThemeModes = new Set([defaultThemeMode, "atelier-nocturne"]);
const legacyThemeModes = {
  "graphite-aurora": "atelier-ivory",
  "museum-tech": "atelier-ivory",
  "dark-glass": "atelier-nocturne",
  "light": "atelier-ivory",
  "dark": "atelier-nocturne",
};
let currentThemeMode = normalizeThemeMode(localStorage.getItem("coAutoResearchTheme") || document.documentElement.dataset.theme || defaultThemeMode);

const localSlashCommandRegistry = {
  "/status": { label: "Session", value: "Show status" },
  "/ps": { label: "Session", value: "Show processes" },
  "/diff": { label: "Session", value: "Show diff" },
};
const localSlashCommandSet = new Set(Object.keys(localSlashCommandRegistry));

const resourceCategories = {
  user_input: "User input",
  ongoing_work: "Ongoing work",
  literature: "Papers",
  proposals: "Proposal",
  data_sources: "Data",
  target_venue: "Target venue",
  other: "Other",
};

const sentFramingResourceItems = [];
const sentFramingUploadItems = [];

const allowedApprovalPolicies = new Set(["on-request", "untrusted", "never"]);
const codexPermissionPresets = {
  default: {
    label: "Default permissions",
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
  },
  "auto-review": {
    label: "Auto-review",
    sandbox: "workspace-write",
    approvalPolicy: "never",
  },
  "full-access": {
    label: "Full access",
    sandbox: "danger-full-access",
    approvalPolicy: "never",
  },
};
const claudePermissionPresets = {
  default: {
    label: "Default (ask before edits)",
    permissionMode: "default",
  },
  acceptEdits: {
    label: "Accept edits",
    permissionMode: "acceptEdits",
  },
  plan: {
    label: "Plan mode",
    permissionMode: "plan",
  },
  auto: {
    label: "Auto mode",
    permissionMode: "auto",
  },
  dontAsk: {
    label: "Don't ask",
    permissionMode: "dontAsk",
  },
  bypassPermissions: {
    label: "Bypass permissions",
    permissionMode: "bypassPermissions",
  },
};
const permissionPresetsByBackend = {
  codex: codexPermissionPresets,
  claude: claudePermissionPresets,
};
const legacyClaudePermissionPresets = {
  "auto-review": "auto",
  "full-access": "bypassPermissions",
  "accept-edits": "acceptEdits",
  "dont-ask": "dontAsk",
  "bypass-permissions": "bypassPermissions",
};
const codexReasoningOptions = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra high"],
];
const claudeReasoningOptionsByFamily = {
  opusRecent: [
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
    ["xhigh", "Extra high"],
    ["max", "Max"],
  ],
  opus46: [
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
    ["max", "Max"],
  ],
  opus: [
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
    ["xhigh", "Extra high"],
    ["max", "Max"],
  ],
  sonnet: [
    ["low", "Low"],
    ["medium", "Medium"],
    ["high", "High"],
    ["max", "Max"],
  ],
  defaultOnly: [["", "Default"]],
};

const secretKeyLabels = {
  GITHUB_TOKEN: "GitHub token",
  HF_TOKEN: "Hugging Face token",
};

const secretKeyHelp = {
  GITHUB_TOKEN: "Lets the selected agent inspect private repos or GitHub APIs when needed.",
  HF_TOKEN: "Lets research scripts access private Hugging Face models, datasets, or gated artifacts.",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
applyThemeMode(currentThemeMode);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function looksPlaceholder(value) {
  const text = String(value || "").trim();
  if (!text || text === "..." || text === "--" || text === "Not specified" || text === "Not recorded") return true;
  if (text.startsWith("<") || text.endsWith(">")) return true;
  if (/^No .* yet\.?$/i.test(text)) return true;
  if (/^No detail yet\.?$/i.test(text)) return true;
  if (/^Content to include\b/i.test(text)) return true;
  if (/^Status:\s*planned/i.test(text)) return true;
  if (/conceptual figures should be specified/i.test(text)) return true;
  return false;
}

function cleanText(value, fallback = "Not set yet") {
  const text = String(value || "").trim();
  return looksPlaceholder(text) ? fallback : text;
}

function compactText(value, limit = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}...`;
}

function hasRealText(value) {
  const text = String(value || "").trim();
  if (looksPlaceholder(text)) return false;
  if (/^placeholder\b/i.test(text)) return false;
  if (text === "...") return false;
  return true;
}

function basename(path) {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean);
  return parts.pop() || path;
}

function extension(path) {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function fileExtensionFromMime(type, fallback = "") {
  const mime = String(type || "").toLowerCase();
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "application/pdf") return ".pdf";
  if (fallback) return fallback.startsWith(".") ? fallback : `.${fallback}`;
  return "";
}

function shortFileType(name, type = "") {
  const ext = extension(name).replace(".", "");
  if (ext) return ext.toUpperCase();
  if (String(type).startsWith("image/")) return "IMAGE";
  if (String(type).includes("pdf")) return "PDF";
  return "FILE";
}

function isProjectResourcePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "").startsWith("resources/");
}

function rawFileUrl(path, options = {}) {
  const params = new URLSearchParams({ path });
  if (activeProjectId) params.set("project", activeProjectId);
  if (options.download) params.set("download", "1");
  return `/api/file/raw?${params.toString()}`;
}

function isDefaultBriefTemplate(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  return (
    value.includes("Write one sentence or a few paragraphs describing what you want this research") &&
    value.includes("project to do.") &&
    value.includes("Include any known target venue, audience, deliverable, constraints, old work,") &&
    value.includes("datasets, papers, or open questions.")
  );
}

function isPlaceholderProject(text) {
  const value = String(text || "");
  return !value.trim() || /<[^>\n]+>/.test(value);
}

function buildProjectDraft(brief, targetVenue) {
  const goal = String(brief || "").trim() || "Define the research direction with the user before launch.";
  const target = String(targetVenue || "").trim() || "Not specified yet.";
  return `# Project Definition

## Research Direction

${goal}

## Target Venue / Audience

${target}

## Working Scope

This project is still in framing. The immediate objective is to turn the user's topic, prior work, and attached resources into a precise research scope before launching the full autoresearch loop.

## What The Agent Should Clarify Next

- The central research problem and why it matters.
- The perspective, claim, or contribution that could fit the target audience.
- Which attached resources are prior work, papers, proposals, data, or miscellaneous context.
- What evidence, synthesis, benchmark, method, or manuscript outcome would count as useful progress.

## Launch Readiness

Autoresearch should launch only after this framing is specific enough for the agent to choose a coherent first research objective.
`;
}

function newMessageId(prefix = "m") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function normalizeResumeTrialContext(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim();
  const path = String(value.path || "").trim();
  if (!id && !path) return null;
  const iteration = Number(value.iteration || 0);
  const name = String(value.name || id || path || "trial").trim();
  return {
    id,
    path,
    iteration: Number.isFinite(iteration) && iteration > 0 ? iteration : 0,
    name,
    reportPath: String(value.reportPath || value.report_path || "").trim(),
    checkpointPath: String(value.checkpointPath || value.checkpoint_path || "").trim(),
    checkpointExists: Boolean(value.checkpointExists ?? value.checkpoint_exists),
  };
}

function normalizeFramingMessage(message) {
  if (!message || !["user", "assistant"].includes(message.role)) return null;
  const allowedKinds = new Set(["text", "project", "plan", "goal-launch", "command", "intervention-recorded"]);
  const kind = allowedKinds.has(message.kind) ? message.kind : "text";
  let artifact = null;
  if (message.artifact && typeof message.artifact === "object") {
    if (kind === "plan") {
      const rawSteps = Array.isArray(message.artifact.steps) ? message.artifact.steps : [];
      artifact = {
        type: "plan",
        id: String(message.artifact.id || message.planId || "").trim(),
        provider: normalizeAgentBackend(message.artifact.provider || ""),
        model: String(message.artifact.model || "").trim(),
        status: String(message.artifact.status || "pending").trim(),
        text: String(message.artifact.text || message.artifact.plan_text || "").trim(),
        plan_text: String(message.artifact.plan_text || message.artifact.text || "").trim(),
        steps: rawSteps
          .map((step) => ({
            step: String(step?.step || step?.text || "").trim(),
            status: String(step?.status || "").trim(),
          }))
          .filter((step) => step.step),
        explanation: String(message.artifact.explanation || "").trim(),
        error: String(message.artifact.error || "").trim(),
        created_at: String(message.artifact.created_at || "").trim(),
        updated_at: String(message.artifact.updated_at || "").trim(),
        approved_at: String(message.artifact.approved_at || "").trim(),
        implemented_run_id: String(message.artifact.implemented_run_id || "").trim(),
      };
    } else {
      artifact = {
        path: String(message.artifact.path || "").trim(),
        text: String(message.artifact.text || "").trim(),
      };
    }
  }
  const attachments = Array.isArray(message.attachments)
    ? message.attachments
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const kind = item.kind === "upload" ? "upload" : item.kind === "link" ? "link" : "";
          if (!kind) return null;
          const category = resourceCategories[item.category] ? item.category : inferClientResourceCategory(item.path || item.name || "");
          if (kind === "link") {
            const path = String(item.path || "").trim();
            if (!path) return null;
            const normalized = { kind, path, name: String(item.name || basename(path)), category };
            if (item.alreadyImported || item.imported || isProjectResourcePath(path)) normalized.alreadyImported = true;
            return normalized;
          }
          const name = String(item.name || "").trim();
          if (!name) return null;
          return {
            kind,
            name,
            category,
            type: String(item.type || ""),
            size: Number(item.size || 0),
          };
        })
        .filter(Boolean)
    : [];
  const resumeFromTrial = normalizeResumeTrialContext(message.resumeFromTrial);
  const text = String(message.text || "").trim()
    || (kind === "plan" ? String(artifact?.plan_text || artifact?.error || "Planning...").trim() : "")
    || (message.role === "user" && attachments.length ? attachmentOnlyMessage(attachments) : "");
  if (kind === "project" && (!artifact?.text || isPlaceholderProject(artifact.text))) return null;
  if (kind === "plan" && !artifact?.id) return null;
  if (!text && !(artifact?.path && artifact?.text) && !(kind === "plan" && artifact?.id)) return null;
  return {
    id: String(message.id || newMessageId()).trim(),
    role: message.role,
    kind,
    text,
    created_at: String(message.created_at || new Date().toISOString()),
    ...(String(message.edited_at || "").trim() ? { edited_at: String(message.edited_at || "").trim() } : {}),
    ...(kind === "plan" && artifact?.id ? { artifact, planId: artifact.id } : {}),
    ...(kind !== "plan" && artifact?.path && artifact?.text ? { artifact } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(resumeFromTrial ? { resumeFromTrial } : {}),
    ...(String(message.mode || "").trim() ? { mode: String(message.mode || "").trim() } : {}),
    ...(String(message.revisePlanId || "").trim() ? { revisePlanId: String(message.revisePlanId || "").trim() } : {}),
  };
}

function chatHistoryItemForRequest(message) {
  const normalized = normalizeFramingMessage(message);
  if (!normalized) return null;
  if (!["user", "assistant"].includes(normalized.role)) return null;
  if (normalized.kind === "project") return null;
  const item = {
    id: normalized.id,
    role: normalized.role,
    kind: normalized.kind || "text",
    text: normalized.kind === "plan"
      ? String(normalized.artifact?.plan_text || normalized.artifact?.text || normalized.text || "").trim()
      : String(normalized.text || "").trim(),
    created_at: normalized.created_at || "",
  };
  if (Array.isArray(normalized.attachments) && normalized.attachments.length) {
    item.attachments = normalized.attachments.map((attachment) => ({
      kind: attachment.kind || "attachment",
      name: attachment.name || basename(attachment.path || ""),
      path: attachment.path || "",
      category: attachment.category || "",
    }));
  }
  return item;
}

function conversationHistoryForRequest(messages = localMessages) {
  return (Array.isArray(messages) ? messages : [])
    .map(chatHistoryItemForRequest)
    .filter((item) => item && item.text)
    .slice(-80);
}

function attachmentOnlyMessage(attachments = []) {
  const count = Array.isArray(attachments) ? attachments.length : 0;
  return count ? `Attached ${count} ${count === 1 ? "resource" : "resources"}.` : "";
}

function isProjectDraftMessage(message) {
  return message?.role === "assistant" && message.kind === "project" && message.artifact?.path === "PROJECT.md" && message.artifact?.text;
}

function latestProjectMessage(messages = localMessages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isProjectDraftMessage(message)) return message;
  }
  return null;
}

function collapseProjectDraftMessages(messages) {
  const latest = latestProjectMessage(messages);
  if (!latest) return messages;
  return messages.filter((message) => !isProjectDraftMessage(message) || message.id === latest.id);
}

function currentProjectDraftFooterMessage(messages = localMessages) {
  const latest = latestProjectMessage(messages);
  const draft = String(latest?.artifact?.text || currentProjectDraft() || "").trim();
  if (!draft || isPlaceholderProject(draft)) return null;
  return {
    id: latest?.id || "current-project-draft",
    role: "assistant",
    kind: "project",
    text: latest?.text || "PROJECT.md ready.",
    created_at: latest?.created_at || new Date().toISOString(),
    artifact: { path: "PROJECT.md", text: draft },
  };
}

function canHostProjectDraftAttachment(message) {
  return (
    message?.role === "assistant" &&
    !isProjectDraftMessage(message) &&
    message.kind !== "plan" &&
    !isControlFramingMessage(message)
  );
}

function attachProjectDraftToLatestAssistant(messages) {
  const items = Array.isArray(messages) ? messages : [];
  const latest = currentProjectDraftFooterMessage(items);
  if (!latest) return items;
  const projectIndex = items.findIndex((message) => message?.id === latest.id);
  let hostId = "";
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.id !== latest.id && canHostProjectDraftAttachment(items[index])) {
      hostId = items[index].id;
      break;
    }
  }
  if (!hostId) return items;
  return items
    .filter((message) => projectIndex < 0 || message?.id !== latest.id)
    .map((message) => (message?.id === hostId ? { ...message, attachedProjectDraft: latest } : message));
}

function visibleFramingMessagesForRender(messages = localMessages) {
  return attachProjectDraftToLatestAssistant(collapseProjectDraftMessages(messages));
}

function setHiddenProjectDraft(text) {
  const editor = $("#project-draft-editor");
  if (editor) editor.value = String(text || "");
  updateProjectDraftPreview();
}

const MARKDOWN_IMAGE_SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);

function normalizeMarkdownPath(path) {
  const parts = [];
  for (const part of String(path || "").replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function markdownBaseDir(path) {
  const value = repoRelativePath(path);
  const index = value.lastIndexOf("/");
  return index >= 0 ? value.slice(0, index) : "";
}

function markdownFilePath(target, options = {}) {
  const raw = repoRelativePath(target);
  if (!raw || raw.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#")) return raw;
  if (/^(resources|research_trajectory|manuscript|workspace|archive|instructions|templates|ui|data|analysis)\//.test(raw)) {
    return normalizeMarkdownPath(raw);
  }
  const baseDir = markdownBaseDir(options.basePath || "");
  return normalizeMarkdownPath(baseDir ? `${baseDir}/${raw}` : raw);
}

function markdownImageHtml(label, href, options = {}) {
  const text = String(label || "").trim() || "Image";
  const target = String(href || "").trim();
  if (!target) return escapeHtml(text);
  if (/^https?:\/\//i.test(target)) {
    return `<img class="markdown-image-preview" src="${escapeHtml(target)}" alt="${escapeHtml(text)}" loading="lazy">`;
  }
  const path = markdownFilePath(target, options);
  if (path && !path.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(path) && MARKDOWN_IMAGE_SUFFIXES.has(extension(path))) {
    return `<img class="markdown-image-preview" src="${escapeHtml(rawFileUrl(path))}" alt="${escapeHtml(text)}" loading="lazy">`;
  }
  return `!${markdownLinkHtml(text, target, options)}`;
}

function markdownLinkHtml(label, href, options = {}) {
  const text = String(label || "").trim();
  const target = String(href || "").trim();
  if (!text || !target) return escapeHtml(text || target);
  if (/^(https?:\/\/|mailto:)/i.test(target)) {
    return `<a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
  }
  const path = markdownFilePath(target, options);
  if (path && !path.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return markdownFileButtonHtml(path, text);
  }
  return escapeHtml(text);
}

function markdownFileButtonHtml(path, label = path) {
  const value = repoRelativePath(path);
  if (!value || value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return `<code>${escapeHtml(label)}</code>`;
  return `<button class="markdown-file-link" type="button" data-inline-fullscreen="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
}

function markdownCodeHtml(value) {
  const text = String(value || "");
  const linkTarget = text.includes("::") ? text.split("::")[0] : text;
  const path = repoRelativePath(linkTarget.replace(/[.,;:)]+$/, ""));
  if (/^(?:resources|research_trajectory|manuscript|workspace|archive|instructions|templates|ui)\//.test(path) || /^[A-Z0-9_./-]+\.(?:md|pdf|png|jpg|jpeg|svg|csv|tsv|json|jsonl|txt|tex|bib|py|js|ts|tsx|jsx|html|css)$/i.test(path)) {
    return markdownFileButtonHtml(path, text);
  }
  return `<code>${escapeHtml(text)}</code>`;
}

function inlineMarkup(text, options = {}) {
  return escapeHtml(text)
    .replaceAll(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (_, label, href) => markdownImageHtml(label, href, options))
    .replaceAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, label, href) => markdownLinkHtml(label, href, options))
    .replaceAll(/`([^`]+)`/g, (_, value) => markdownCodeHtml(value))
    .replaceAll(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function markdownHeadingId(title) {
  const base = String(title || "")
    .replaceAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, "$1")
    .replaceAll(/`([^`]+)`/g, "$1")
    .replaceAll(/\*\*([^*]+)\*\*/g, "$1")
    .replaceAll(/<[^>]*>/g, "")
    .toLowerCase()
    .replaceAll(/&[a-z0-9#]+;/g, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return base || "section";
}

function markdownToHtml(text, options = {}) {
  const lines = String(text || "").split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let list = [];
  let listType = "ul";
  let quote = [];
  let inCode = false;
  let code = [];
  const headingIds = new Map();

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkup(paragraph.join(" "), options)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    if (listType === "ol") {
      const start = Math.max(1, Number(list[0]?.marker || 1));
      const startAttr = start === 1 ? "" : ` start="${escapeHtml(start)}"`;
      html.push(`<ol class="is-explicit-markers"${startAttr}>${list.map((item) => {
        const marker = Math.max(1, Number(item.marker || 1));
        return `<li value="${escapeHtml(marker)}" data-marker="${escapeHtml(marker)}">${inlineMarkup(item.text, options)}</li>`;
      }).join("")}</ol>`);
    } else {
      html.push(`<ul>${list.map((item) => `<li>${inlineMarkup(item.text, options)}</li>`).join("")}</ul>`);
    }
    list = [];
    listType = "ul";
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote>${inlineMarkup(quote.join(" "), options)}</blockquote>`);
    quote = [];
  };
  const flushCode = () => {
    html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
  };
  const splitTableRow = (line) => {
    const trimmed = line.trim();
    if (!trimmed.includes("|")) return [];
    const body = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
    const withoutTail = body.endsWith("|") ? body.slice(0, -1) : body;
    return withoutTail.split("|").map((cell) => cell.trim());
  };
  const isRule = (line) => /^ {0,3}([-*_])(?:\s*\1){1,}\s*$/.test(line);
  const isSoftBreak = (line) => /^ {0,3}(?:\.{3}|…)\s*$/.test(line);
  const isTableDivider = (line) => {
    const cells = splitTableRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  };
  const tableAlignments = (divider) =>
    splitTableRow(divider).map((cell) => {
      const value = cell.trim();
      if (value.startsWith(":") && value.endsWith(":")) return "center";
      if (value.endsWith(":")) return "right";
      return "left";
    });
  const tableCellHtml = (cell, tag, align) =>
    `<${tag}${align && align !== "left" ? ` style="text-align:${align}"` : ""}>${inlineMarkup(cell, options)}</${tag}>`;
  const tableHtml = (rows, alignments) => {
    const [head, ...body] = rows;
    return `
      <div class="markdown-table-wrap">
        <table>
          <thead><tr>${head.map((cell, index) => tableCellHtml(cell, "th", alignments[index])).join("")}</tr></thead>
          <tbody>${body.map((row) => `<tr>${row.map((cell, index) => tableCellHtml(cell, "td", alignments[index])).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    `;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        flushQuote();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(rawLine);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }
    const quoteLine = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quoteLine) {
      flushParagraph();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }
    if (quote.length) flushQuote();
    if (isSoftBreak(line)) {
      flushParagraph();
      flushList();
      html.push('<div class="markdown-section-break" aria-hidden="true"></div>');
      continue;
    }
    if (isRule(line)) {
      flushParagraph();
      flushList();
      html.push("<hr>");
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const rows = [splitTableRow(line)];
      const alignments = tableAlignments(lines[index + 1]);
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      flushParagraph();
      flushList();
      html.push(tableHtml(rows, alignments));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      let idAttr = "";
      if (options.headingAnchors) {
        const baseId = markdownHeadingId(heading[2]);
        const count = headingIds.get(baseId) || 0;
        headingIds.set(baseId, count + 1);
        const id = count ? `${baseId}-${count + 1}` : baseId;
        idAttr = ` id="${escapeHtml(id)}"`;
      }
      html.push(`<h${level}${idAttr}>${inlineMarkup(heading[2], options)}</h${level}>`);
      continue;
    }
    const orderedItem = line.match(/^(\d{1,9})\.\s+(.+)$/);
    const bulletItem = line.match(/^[-*]\s+(.+)$/);
    if (orderedItem || bulletItem) {
      flushParagraph();
      const nextType = orderedItem ? "ol" : "ul";
      if (list.length && listType !== nextType) flushList();
      listType = nextType;
      list.push(orderedItem
        ? { marker: Number(orderedItem[1]), text: orderedItem[2] }
        : { text: bulletItem[1] });
      continue;
    }
    paragraph.push(line.trim());
  }

  if (inCode) flushCode();
  flushParagraph();
  flushList();
  flushQuote();
  return html.join("") || "<p>No content yet.</p>";
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.style.borderColor = isError ? "var(--danger)" : "var(--line-strong)";
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function setButtonFeedback(button, state, label) {
  if (!button) return;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.textContent.trim();
  button.dataset.feedbackState = state;
  button.setAttribute("aria-busy", state === "saving" ? "true" : "false");
  if (label) button.textContent = label;
}

function restoreButtonFeedback(button, disabled) {
  if (!button) return;
  button.disabled = disabled;
  button.textContent = button.dataset.defaultLabel || button.textContent;
  button.removeAttribute("aria-busy");
  delete button.dataset.feedbackState;
}

async function withButtonFeedback(button, task, labels = {}) {
  if (!button) return task();
  const originalDisabled = button.disabled;
  clearTimeout(button._feedbackTimer);
  button.disabled = true;
  setButtonFeedback(button, "saving", labels.saving || "Saving...");
  try {
    const result = await task();
    setButtonFeedback(button, "saved", labels.saved || "Saved");
    await new Promise((resolve) => setTimeout(resolve, labels.settleMs ?? 350));
    button._feedbackTimer = setTimeout(() => restoreButtonFeedback(button, originalDisabled), 1000);
    return result;
  } catch (error) {
    setButtonFeedback(button, "failed", labels.failed || "Failed");
    button._feedbackTimer = setTimeout(() => restoreButtonFeedback(button, originalDisabled), 1400);
    throw error;
  }
}

function setColdSaveStatus(message, tone = "") {
  const status = $("#cold-save-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function resizeColdEditor() {
  const editor = $("#cold-file-editor");
  if (!editor) return;
  const compactComposer = Boolean(editor.closest?.(".brief-composer-row"));
  if (compactComposer) {
    const minHeight = 44;
    const maxHeight = Math.min(window.innerHeight * 0.34, 320);
    editor.rows = 1;
    editor.classList.remove("is-compact-single-line");
    editor.style.height = "auto";
    const measuredHeight = Math.max(editor.scrollHeight || minHeight, minHeight);
    const nextHeight = Math.min(measuredHeight, maxHeight);
    editor.style.height = `${nextHeight}px`;
    editor.style.overflowY = measuredHeight > maxHeight ? "auto" : "hidden";
    updateBriefDockGeometry();
    return;
  }
  editor.style.height = "auto";
  const maxHeight = Math.min(window.innerHeight * 0.34, 320);
  const nextHeight = Math.min(Math.max(editor.scrollHeight, 54), maxHeight);
  editor.style.height = `${nextHeight}px`;
  editor.style.overflowY = editor.scrollHeight > maxHeight ? "auto" : "hidden";
  updateBriefDockGeometry();
}

function scheduleColdAutosave() {
  clearTimeout(coldAutosaveTimer);
  setColdSaveStatus("Saving...", "pending");
  coldAutosaveTimer = setTimeout(async () => {
    try {
      await saveColdFiles({ silent: true, refresh: false, markPrepared: false });
      setColdSaveStatus("Autosaved", "saved");
    } catch (error) {
      setColdSaveStatus("Save failed", "error");
      showToast(error.message, true);
    }
  }, COLD_AUTOSAVE_DELAY);
}

function scopedStorageKey(key) {
  return projectScopedStorageKey(activeProjectId, key);
}

function scopedGet(key, fallback = "", options = {}) {
  const scoped = localStorage.getItem(scopedStorageKey(key));
  if (scoped !== null) return scoped;
  if (options.legacyFallback === false) return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function scopedSet(key, value) {
  localStorage.setItem(scopedStorageKey(key), value);
}

function scopedRemove(key) {
  localStorage.removeItem(scopedStorageKey(key));
}

function isPlanComposerMode() {
  return composerMode === "plan";
}

function renderComposerModeControls() {
  $$("[data-plan-mode-toggle]").forEach((button) => {
    const active = isPlanComposerMode();
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.setAttribute("aria-label", active ? "Turn off Plan mode" : "Use Plan mode");
    button.title = active ? "Turn off Plan mode" : "Plan mode";
  });
}

function setComposerMode(mode, options = {}) {
  const next = normalizeComposerMode(mode);
  composerMode = next;
  if (options.persist !== false) scopedSet("composerMode", next);
  if (next !== "plan") pendingPlanRevisionId = "";
  renderComposerModeControls();
  renderComposerActionButtons();
}

function togglePlanComposerMode() {
  setComposerMode(isPlanComposerMode() ? "chat" : "plan");
}

function scopedJsonGet(key, fallback = {}) {
  try {
    const raw = scopedGet(key, "", { legacyFallback: false });
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function activeNavigationPanel() {
  return activeView === "chat" ? "chat" : normalizeMaterialPanel(activePanel);
}

function restoreNavigationState() {
  const panel = initialNavigationPanel(activeProjectId);
  activeView = panel === "chat" ? "chat" : "materials";
  activePanel = panel === "chat" ? initialMaterialPanel(activeProjectId) : normalizeMaterialPanel(panel);
}

function persistNavigationState({ updateUrl = false } = {}) {
  const panel = activeNavigationPanel();
  scopedSet("activeNavigationPanel", panel);
  if (panel !== "chat") scopedSet("activeMaterialPanel", panel);
  localStorage.setItem("coAutoResearchActivePanel", panel);
  if (panel !== "chat") localStorage.setItem("coAutoResearchActiveMaterialPanel", panel);
  if (updateUrl) updateNavigationUrl(panel);
}

function updateNavigationUrl(panel = activeNavigationPanel()) {
  if (!window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (activeProjectId) url.searchParams.set("project", activeProjectId);
  else url.searchParams.delete("project");
  url.searchParams.set("view", normalizeNavigationPanel(panel));
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, "", next);
  }
}

function scrollablePageNode() {
  const framingThread = framingThreadScroller();
  if (framingThread) return framingThread;
  return $(".main-stage") || document.scrollingElement || document.documentElement;
}

function readPageScrollTop(scroller = scrollablePageNode()) {
  if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }
  return scroller.scrollTop || 0;
}

function writePageScrollTop(value, scroller = scrollablePageNode()) {
  const next = Math.max(0, Number(value) || 0);
  if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
    window.scrollTo({ top: next, behavior: "auto" });
  } else {
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.min(next, max);
  }
}

function persistActiveViewScrollPosition() {
  if (!activeProjectId) return;
  scopedSet(`viewScroll:${activeNavigationPanel()}`, String(Math.round(readPageScrollTop())));
}

function schedulePersistActiveViewScrollPosition() {
  if (suppressViewScrollPersistence) return;
  clearTimeout(viewScrollPersistTimer);
  viewScrollPersistTimer = setTimeout(persistActiveViewScrollPosition, 120);
}

function restoreActiveViewScrollPosition({ defaultTop = 0 } = {}) {
  const panel = activeNavigationPanel();
  const raw = scopedGet(`viewScroll:${panel}`, "", { legacyFallback: false });
  const target = raw === "" ? defaultTop : Number(raw);
  if (target === null || !Number.isFinite(Number(target))) return;
  const token = ++viewScrollRestoreToken;
  suppressViewScrollPersistence = true;
  requestAnimationFrame(() => {
    if (token !== viewScrollRestoreToken || activeNavigationPanel() !== panel) {
      if (token === viewScrollRestoreToken) suppressViewScrollPersistence = false;
      return;
    }
    writePageScrollTop(Number(target));
    requestAnimationFrame(() => {
      if (token === viewScrollRestoreToken) {
        suppressViewScrollPersistence = false;
        updateFramingScrollButton();
      }
    });
  });
}

function markChatScrollRestoredForCurrentProject() {
  chatScrollRestoredProjectId = activeProjectId || "default";
}

function restoreInitialChatScrollPosition() {
  if (activeView !== "chat") return;
  const projectId = activeProjectId || "default";
  if (chatScrollRestoredProjectId === projectId) return;
  chatScrollRestoredProjectId = projectId;
  restoreActiveViewScrollPosition();
}

function normalizeAgentBackend(value) {
  const backend = String(value || "").trim().toLowerCase();
  return allowedAgentBackends.has(backend) ? backend : defaultAgentSettings.backend;
}

function validAgentBackend(value) {
  const backend = String(value || "").trim().toLowerCase();
  return allowedAgentBackends.has(backend) ? backend : "";
}

function normalizeCodexProvider(value) {
  const raw = String(value || "").trim().toLowerCase().replaceAll("-", "_");
  const aliases = {
    openai: "openai_api_key",
    openai_key: "openai_api_key",
    api_key: "openai_api_key",
  };
  const provider = aliases[raw] || raw;
  return allowedCodexProviders.has(provider) ? provider : defaultCodexSessionSettings.provider;
}

function normalizeClaudeProvider(value) {
  const raw = String(value || "").trim().toLowerCase().replaceAll("-", "_");
  const aliases = {
    anthropic: "anthropic_api_key",
    api_key: "anthropic_api_key",
    custom: "custom_anthropic",
    gateway: "custom_anthropic",
  };
  const provider = aliases[raw] || raw;
  return allowedClaudeProviders.has(provider) ? provider : defaultClaudeSessionSettings.provider;
}

function isValidCustomClaudeModel(value) {
  const model = String(value || "").trim();
  return Boolean(model) && !isKnownCodexModel(model) && /^[A-Za-z0-9][A-Za-z0-9._:/+\-[\]]{1,140}$/.test(model);
}

function claudeModelFamily(model) {
  const value = String(model || "").trim().toLowerCase();
  if (value === "best") return "opusRecent";
  if (value.includes("fable")) return "defaultOnly";
  if (value.includes("opus")) {
    if (/\bopus[-_]?4[-_]?6\b/.test(value)) return "opus46";
    return "opusRecent";
  }
  if (value.includes("sonnet")) return "sonnet";
  if (value.includes("haiku")) return "defaultOnly";
  return "defaultOnly";
}

function reasoningOptionsForBackendModel(backend, model = "") {
  const normalized = normalizeAgentBackend(backend);
  if (normalized === "codex") return codexReasoningOptions;
  return claudeReasoningOptionsByFamily[claudeModelFamily(model)] || claudeReasoningOptionsByFamily.defaultOnly;
}

function permissionPresetsForBackend(backend) {
  return permissionPresetsByBackend[normalizeAgentBackend(backend)] || codexPermissionPresets;
}

function permissionPresetForBackend(backend, preset) {
  const presets = permissionPresetsForBackend(backend);
  return presets[preset] || presets[defaultSettingsForBackend(backend).permissionPreset] || Object.values(presets)[0] || {};
}

function defaultReasoningEffortForBackendModel(backend, model = "") {
  const normalized = normalizeAgentBackend(backend);
  if (normalized === "codex") return defaultCodexSessionSettings.reasoningEffort;
  const options = reasoningOptionsForBackendModel(normalized, model);
  if (options.some(([value]) => value === "high")) return "high";
  return options[0]?.[0] || "";
}

function agentLabel(backend) {
  return agentBackends[normalizeAgentBackend(backend)] || agentBackends.codex;
}

function defaultSettingsForBackend(backend) {
  return sessionDefaultsByBackend[normalizeAgentBackend(backend)] || defaultSessionSettings;
}

function activeSettingsBackend() {
  return normalizeAgentBackend(uiSettings?.agent?.backend || defaultAgentSettings.backend);
}

function providerSettingsFromUi(backend) {
  const normalized = normalizeAgentBackend(backend);
  return uiSettings?.[normalized] || defaultSettingsForBackend(normalized);
}

function agentStatusEnvelope(settings = uiSettings || {}) {
  const status = settings?.agent_status;
  return status && typeof status === "object" ? status : {};
}

function envForcedBackend(settings = uiSettings || {}) {
  const raw = agentStatusEnvelope(settings).env_override || settings?.agent_env_override || "";
  return raw ? validAgentBackend(raw) : "";
}

function effectiveBackend(backend, settings = uiSettings || {}) {
  return envForcedBackend(settings) || normalizeAgentBackend(backend);
}

function statusForBackend(backend, settings = uiSettings || {}) {
  const backends = agentStatusEnvelope(settings).backends || {};
  const status = backends[normalizeAgentBackend(backend)];
  return status && typeof status === "object" ? status : null;
}

function statusTone(status) {
  if (!status) return "";
  if (status.blocking) return "error";
  if (status.auth === "unknown" || /could not|did not return/i.test(String(status.message || ""))) return "warning";
  return "";
}

function currentLaunchBackend() {
  const form = $("#session-settings-form");
  return normalizeAgentBackend(form?.elements?.backend?.value || activeSettingsBackend());
}

function launchBlockingStatus() {
  const backend = effectiveBackend(currentLaunchBackend());
  const status = statusForBackend(backend);
  return status?.blocking ? status : null;
}

function agentStatusText(backend, scope = "settings") {
  const requested = normalizeAgentBackend(backend);
  const forced = envForcedBackend();
  const effective = forced || requested;
  const status = statusForBackend(effective);
  const parts = [];
  const envWarning = String(agentStatusEnvelope().env_warning || "").trim();
  if (envWarning) parts.push(envWarning);
  if (forced) {
    const forcedLabel = agentLabel(forced);
    if (scope === "project") {
      parts.push(`COAUTO_AGENT_BACKEND forces ${forcedLabel} while active; new projects can still save a default, but runs use the forced backend.`);
    } else if (scope === "launch") {
      parts.push(`COAUTO_AGENT_BACKEND forces ${forcedLabel} for runs while active; this launch uses ${forcedLabel}.`);
    } else {
      parts.push(`COAUTO_AGENT_BACKEND forces ${forcedLabel} while active; saved Settings choices apply after the env var is removed.`);
    }
  }
  if (scope === "project" && status) {
    const label = agentLabel(effective);
    if (status.blocking) {
      parts.push(`${label} readiness: You can create the project, but first run will be blocked until setup is complete. ${status.message || ""}`.trim());
    } else {
      parts.push(`${label} readiness: Ready to run after project creation.`);
    }
  } else if (status?.message) {
    const label = forced && requested !== effective ? `${agentLabel(effective)} readiness` : `${agentLabel(effective)} readiness`;
    parts.push(`${label}: ${status.message}`);
  }
  if (effective === "claude" && scope === "settings") {
    parts.push("Shell aliases/functions are not inherited; use Claude settings, this gateway form, or COAUTO_CLAUDE pointing to a wrapper script.");
  }
  return parts.join(" ");
}

function renderAgentStatusNote(selector, backend, scope = "settings") {
  const note = $(selector);
  if (!note) return;
  const effective = effectiveBackend(backend);
  const status = statusForBackend(effective);
  const message = agentStatusText(backend, scope);
  note.innerHTML = agentStatusNoteHtml(effective, status, message, scope);
  const tone = agentStatusEnvelope().env_warning ? "warning" : statusTone(status);
  if (tone) note.dataset.tone = tone;
  else delete note.dataset.tone;
}

function renderAllAgentStatusNotes() {
  renderAgentStatusNote("#settings-agent-status", $("#settings-form")?.elements?.settingsBackend?.value || activeSettingsBackend(), "settings");
  renderAgentStatusNote("#launch-agent-status", currentLaunchBackend(), "launch");
  renderAgentStatusNote("#project-agent-backend-note", $("#project-agent-backend")?.value || activeSettingsBackend(), "project");
  renderAgentStatusBanner();
}

const agentInstallGuides = {
  claude: {
    label: "Claude Code",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    login: "claude auth login",
    run: "claude",
    verify: "claude --version",
    authStatus: "claude auth status",
    docs: "https://code.claude.com/docs/en/quickstart",
    authDocs: "https://code.claude.com/docs/en/iam",
    description: "Anthropic's CLI for driving Claude (Opus / Sonnet / Haiku) inside a terminal session.",
  },
  codex: {
    label: "Codex CLI",
    install: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    login: "codex login",
    run: "codex",
    verify: "codex --version",
    authStatus: "codex login status",
    docs: "https://developers.openai.com/codex/cli",
    authDocs: "https://developers.openai.com/codex/auth",
    description: "OpenAI's CLI for GPT-5 family coding sessions.",
  },
};

function backendInstallGuide(backend) {
  return agentInstallGuides[normalizeAgentBackend(backend)] || agentInstallGuides.claude;
}

function agentSetupCommands(backend, status = {}) {
  const normalized = normalizeAgentBackend(backend);
  const guide = backendInstallGuide(normalized);
  const installed = Boolean(status.installed);
  const auth = String(status.auth || "unknown");
  const commands = [];
  if (!installed) {
    commands.push({ label: "Install", command: guide.install, copy: `${guide.label} install command copied.` });
    commands.push({ label: "Verify", command: status.version_command || guide.verify, copy: `${guide.label} verify command copied.` });
    commands.push({ label: "Log in", command: guide.login || guide.run, copy: `${guide.label} login command copied.` });
    return commands;
  }
  if (auth === "missing") {
    commands.push({ label: "Log in", command: status.login_command || guide.login || guide.run, copy: `${guide.label} login command copied.` });
    commands.push({ label: "Check", command: status.auth_status_command || guide.authStatus, copy: `${guide.label} auth check copied.` });
    return commands;
  }
  if (auth === "unknown") {
    commands.push({ label: "Check", command: status.auth_status_command || guide.authStatus, copy: `${guide.label} auth check copied.` });
  }
  return commands;
}

function agentSetupCommandRowsHtml(commands, variant = "") {
  if (!commands.length) return "";
  const className = variant ? ` agent-setup-command-list--${escapeHtml(variant)}` : "";
  return `
    <div class="agent-setup-command-list${className}">
      ${commands.map(({ label, command, copy }) => `
        <div class="agent-setup-command-row">
          <span>${escapeHtml(label)}</span>
          <code>${escapeHtml(command)}</code>
          ${copyButton(command, "Copy", copy)}
        </div>
      `).join("")}
    </div>
  `;
}

function agentSetupLinksHtml(backend, { compact = false } = {}) {
  const guide = backendInstallGuide(backend);
  const links = [
    { label: compact ? "Setup" : "Setup guide", href: guide.docs },
    { label: compact ? "Login" : "Login guide", href: guide.authDocs || guide.docs },
  ];
  return `
    <span class="agent-setup-links">
      ${links.map(({ label, href }) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`).join("")}
    </span>
  `;
}

function agentStatusNoteHtml(backend, status = {}, message = "", scope = "settings") {
  const safeMessage = escapeHtml(message || "");
  if (!message && !status?.blocking) return "";
  if (!status?.blocking) return safeMessage;
  const commands = agentSetupCommands(backend, status);
  if (!commands.length) return safeMessage;
  const label = escapeHtml(agentLabel(backend));
  const links = agentSetupLinksHtml(backend, { compact: true });
  const commandRows = agentSetupCommandRowsHtml(commands, scope === "project" ? "compact" : "note");
  return `
    <span class="agent-status-note-main">${safeMessage}</span>
    <span class="agent-status-note-help">${label} setup: ${links}</span>
    ${commandRows}
  `;
}

function renderAgentStatusBanner() {
  const banner = document.getElementById("agent-status-banner");
  if (!banner) return;
  const envelope = agentStatusEnvelope();
  const envWarning = String(envelope.env_warning || "").trim();
  const forced = envForcedBackend();
  const requested = normalizeAgentBackend(envelope.selected || activeSettingsBackend());
  const effective = forced || requested;
  const status = statusForBackend(effective);
  const otherBackend = Object.keys(envelope.backends || {}).find((name) => normalizeAgentBackend(name) !== effective);
  const otherStatus = otherBackend ? statusForBackend(otherBackend) : null;
  const otherUsable = Boolean(otherStatus?.ok && !otherStatus?.blocking);

  let tone = "";
  let kicker = "";
  let message = "";
  const actions = [];

  if (envWarning) {
    tone = "warning";
    kicker = "Configuration";
    message = envWarning;
    actions.push({ kind: "button", label: "Open settings", onClick: () => openSettingsDialog("codex") });
  } else if (status?.blocking) {
    tone = "error";
    const label = agentLabel(effective);
    kicker = `${label} unavailable`;
    message = status.message || `${label} CLI is not installed or not authenticated.`;
    const guide = backendInstallGuide(effective);
    actions.push({ kind: "link", label: "Install guide", href: guide.docs });
    if (otherUsable && otherBackend) {
      const otherLabel = agentLabel(otherBackend);
      actions.push({ kind: "button", label: `Switch to ${otherLabel}`, onClick: () => switchActiveBackend(otherBackend) });
    }
    actions.push({ kind: "button", label: "Open settings", onClick: () => openSettingsDialog("codex") });
  } else if (status && statusTone(status) === "warning") {
    tone = "warning";
    kicker = `${agentLabel(effective)} readiness`;
    message = status.message || "Status could not be confirmed.";
    actions.push({ kind: "button", label: "Re-check", onClick: refreshAgentStatuses });
  } else if (forced) {
    tone = "info";
    kicker = "Backend override";
    message = `COAUTO_AGENT_BACKEND forces ${agentLabel(forced)}. Saved Settings choices apply once the env var is removed.`;
  } else {
    if (banner.dataset.bannerKey !== "hidden") {
      banner.classList.remove("is-visible");
      banner.hidden = true;
      banner.innerHTML = "";
      banner.dataset.bannerKey = "hidden";
    }
    return;
  }

  const actionsHtml = actions
    .map((action, index) => {
      if (action.kind === "link") {
        return `<a href="${escapeHtml(action.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(action.label)}</a>`;
      }
      return `<button type="button" data-banner-action="${index}">${escapeHtml(action.label)}</button>`;
    })
    .join("");
  // Skip rebuilding identical banner content on every poll tick.
  const bannerKey = `${tone}|${kicker}|${message}|${actions.map((a) => a.label).join(",")}`;
  if (banner.dataset.bannerKey === bannerKey) return;
  banner.dataset.bannerKey = bannerKey;
  banner.hidden = false;
  banner.classList.add("is-visible");
  banner.dataset.tone = tone || "info";
  banner.innerHTML = `
    <span class="agent-status-banner-dot" aria-hidden="true"></span>
    <div class="agent-status-banner-body">
      <div class="agent-status-banner-kicker">${escapeHtml(kicker)}</div>
      <div class="agent-status-banner-message">${escapeHtml(message)}</div>
    </div>
    <div class="agent-status-banner-actions">${actionsHtml}</div>
  `;
  banner.querySelectorAll("button[data-banner-action]").forEach((button) => {
    const index = Number(button.dataset.bannerAction || 0);
    const action = actions[index];
    if (action?.onClick) button.addEventListener("click", action.onClick);
  });
}

function openSettingsDialog(tab = "") {
  const dialog = document.getElementById("settings-dialog");
  if (!dialog) return;
  if (typeof loadUiSettings === "function") {
    Promise.resolve(loadUiSettings()).finally(() => {
      if (tab) switchSettingsTab(tab);
      applySettingsDialogSize(dialog);
      try { dialog.showModal(); } catch (_) { /* already open */ }
    });
  } else {
    if (tab) switchSettingsTab(tab);
    applySettingsDialogSize(dialog);
    try { dialog.showModal(); } catch (_) { /* already open */ }
  }
}

function switchActiveBackend(backend) {
  const target = normalizeAgentBackend(backend);
  const form = document.getElementById("session-settings-form");
  if (form?.elements?.backend) {
    form.elements.backend.value = target;
  }
  const settingsForm = document.getElementById("settings-form");
  if (settingsForm?.elements?.settingsBackend) {
    settingsForm.elements.settingsBackend.value = target;
  }
  const projectBackend = document.getElementById("project-agent-backend");
  if (projectBackend) projectBackend.value = target;
  try {
    if (typeof settingsFromForm === "function") settingsFromForm();
  } catch (_) {
    // Form may not exist yet.
  }
  renderAllAgentStatusNotes();
  refreshDiscoveredModels([target]);
}

async function saveActiveBackendChoice(backend) {
  const target = normalizeAgentBackend(backend);
  switchActiveBackend(target);
  const payload = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ agent: { backend: target } }),
  });
  uiSettings = payload.settings || uiSettings || {};
  settingsSecretKeys = payload.secret_keys || settingsSecretKeys;
  hydrateSettingsDialog(uiSettings);
  restoreSessionSettings();
  renderAllAgentStatusNotes();
  renderAgentSetupCards();
  return target;
}

async function refreshAgentStatuses() {
  try {
    const payload = await api("/api/settings");
    uiSettings = payload.settings || uiSettings || {};
    hydrateSettingsDialog(uiSettings);
    restoreSessionSettings();
    renderAllAgentStatusNotes();
    renderAgentSetupCards();
  } catch (error) {
    showToast(error.message, true);
  }
}

function backendReady(status) {
  return Boolean(status?.ok && !status?.blocking);
}

function allBackendsBlocking() {
  const backends = agentStatusEnvelope().backends || {};
  const entries = Object.values(backends).filter((status) => status && typeof status === "object");
  if (!entries.length) return false;
  return entries.every((status) => status.blocking === true);
}

function noProjectsDashboard() {
  const projects = Array.isArray(appState?.projects) ? appState.projects : [];
  return Boolean(appState?.multi_project && !projects.length);
}

function initialPreflightDismissed() {
  try {
    return sessionStorage.getItem(INITIAL_PREFLIGHT_DISMISSED_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function dismissInitialPreflight() {
  try {
    sessionStorage.setItem(INITIAL_PREFLIGHT_DISMISSED_KEY, "1");
  } catch (_) {
    // Storage can be unavailable in private or embedded contexts.
  }
}

function selectedEffectiveBackend(settings = uiSettings || {}) {
  const envelope = agentStatusEnvelope(settings);
  return effectiveBackend(envelope.selected || settings?.agent?.backend || activeSettingsBackend(), settings);
}

function orderedAgentSetupBackends(settings = uiSettings || {}) {
  const selected = selectedEffectiveBackend(settings);
  return [selected, ...Object.keys(agentBackends).filter((backend) => backend !== selected)];
}

function agentSetupGatewayText(backend, status = {}) {
  if (normalizeAgentBackend(backend) !== "claude") return "";
  const gateway = status.gateway && typeof status.gateway === "object" ? status.gateway : {};
  if (gateway.complete || status.auth === "gateway") {
    const credential = gateway.credential_key ? ` via ${gateway.credential_key}` : "";
    return `Gateway configured${credential}.`;
  }
  if (gateway.base_url && !gateway.has_credential) {
    return "Gateway missing credential.";
  }
  return "Using existing Claude Code auth.";
}

function agentSetupAuthText(status = {}) {
  const auth = String(status.auth || "unknown");
  if (auth === "ok") return "Auth: authenticated.";
  if (auth === "api_key") return "Auth: API key.";
  if (auth === "gateway") return "Auth: gateway credential.";
  if (auth === "missing") return "Auth: login, API key, or gateway credential needed.";
  if (status.blocking) return "Auth: status check failed.";
  return "Auth: not confirmed yet.";
}

function updateAgentSetupDialogUi({ initial = false } = {}) {
  const dialog = document.getElementById("agent-setup-dialog");
  if (!dialog) return;
  const title = document.getElementById("agent-setup-title");
  if (title) title.textContent = "Check your agent runtime";
  const intro = document.getElementById("agent-setup-intro");
  if (intro) {
    intro.textContent = "CoAutoResearch can create projects before an agent is ready, but agent runs need Codex or Claude Code to be installed and authenticated.";
  }
  const createButton = document.querySelector("[data-agent-setup-create-project]");
  if (createButton) createButton.hidden = !(initial || noProjectsDashboard());
  const settingsButton = document.querySelector("[data-agent-setup-settings]");
  if (settingsButton) settingsButton.hidden = false;
}

function openAgentSetupDialog(options = {}) {
  const dialog = document.getElementById("agent-setup-dialog");
  if (!dialog) return;
  updateAgentSetupDialogUi(options);
  renderAgentSetupCards();
  if (dialog.open) return;
  try { dialog.showModal(); } catch (_) { /* may already be open */ }
}

function maybeShowAgentSetupDialog(options = {}) {
  if (!options.force && !allBackendsBlocking()) return;
  openAgentSetupDialog({ initial: options.initial || noProjectsDashboard() });
}

function runInitialPreflightFlow(options = {}) {
  if (!noProjectsDashboard()) return;
  if (initialProjectDialogOpened && !options.force) return;
  if (initialPreflightDismissed() && !options.force) return;
  const backends = agentStatusEnvelope().backends || {};
  if (!Object.keys(backends).length) return;
  initialProjectDialogOpened = true;
  window.setTimeout(() => {
    if (!noProjectsDashboard()) return;
    if (initialPreflightDismissed() && !options.force) return;
    const selected = selectedEffectiveBackend();
    const selectedStatus = statusForBackend(selected);
    if (backendReady(selectedStatus)) {
      const setupDialog = document.getElementById("agent-setup-dialog");
      if (setupDialog?.open) {
        try { setupDialog.close(); } catch (_) { /* ignore */ }
      }
      const projectDialog = $("#project-dialog");
      if (!projectDialog?.open) openProjectCreateDialog();
      return;
    }
    openAgentSetupDialog({ initial: true });
  }, 120);
}

async function useAgentSetupBackend(backend) {
  const target = normalizeAgentBackend(backend);
  if (envForcedBackend()) return;
  try {
    await saveActiveBackendChoice(target);
    if (noProjectsDashboard()) {
      dismissInitialPreflight();
      const dialog = document.getElementById("agent-setup-dialog");
      if (dialog?.open) {
        try { dialog.close(); } catch (_) { /* ignore */ }
      }
      openProjectCreateDialog();
    } else {
      showToast(`Using ${agentLabel(target)} for new runs.`);
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

function createProjectFromSetupDialog() {
  dismissInitialPreflight();
  const dialog = document.getElementById("agent-setup-dialog");
  if (dialog?.open) {
    try { dialog.close(); } catch (_) { /* ignore */ }
  }
  openProjectCreateDialog();
}

function openSettingsFromSetupDialog() {
  const dialog = document.getElementById("agent-setup-dialog");
  if (dialog?.open) {
    try { dialog.close(); } catch (_) { /* ignore */ }
  }
  openSettingsDialog("codex");
}

function renderAgentSetupCards() {
  const grid = document.getElementById("agent-setup-grid");
  if (!grid) return;
  const backends = agentStatusEnvelope().backends || {};
  const forced = envForcedBackend();
  const selected = selectedEffectiveBackend();
  const envWarning = String(agentStatusEnvelope().env_warning || "").trim();
  const order = orderedAgentSetupBackends();
  grid.innerHTML = order
    .map((backend) => {
      const status = backends[backend] || {};
      const guide = backendInstallGuide(backend);
      const ready = backendReady(status);
      const installed = Boolean(status.installed);
      const state = ready ? "ready" : installed ? "warning" : "missing";
      const stateLabel = ready ? "Ready" : installed ? "Setup needed" : "Not detected";
      const installText = installed
        ? `Installed: ${status.version || status.executable || `${guide.label} CLI found`}.`
        : "Installed: not found.";
      const detailLines = [installText, agentSetupAuthText(status)];
      const gatewayText = agentSetupGatewayText(backend, status);
      if (gatewayText) detailLines.push(`Gateway: ${gatewayText}`);
      if (status.message) detailLines.push(status.message);
      const canSwitch = ready && backend !== selected && !forced;
      const switchAction = canSwitch
        ? `<button class="secondary-button small-button" type="button" data-agent-setup-use="${escapeHtml(backend)}">Use ${escapeHtml(agentLabel(backend))}</button>`
        : "";
      const forcedNote = forced && backend !== forced
        ? `<p class="agent-setup-card-note">${escapeHtml(envWarning || `COAUTO_AGENT_BACKEND forces ${agentLabel(forced)} while active.`)}</p>`
        : "";
      const commands = agentSetupCommands(backend, status);
      const commandRows = agentSetupCommandRowsHtml(commands, "card");
      return `
        <article class="agent-setup-card" data-agent-setup-card="${escapeHtml(backend)}">
          <div class="agent-setup-card-head">
            <strong>${escapeHtml(guide.label)}</strong>
            <span class="agent-setup-card-status" data-state="${escapeHtml(state)}">${escapeHtml(stateLabel)}</span>
          </div>
          <p>${escapeHtml(guide.description)}</p>
          <ul class="agent-setup-checks">
            ${detailLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
          </ul>
          ${forcedNote}
          ${commandRows}
          <div class="agent-setup-card-actions">
            ${agentSetupLinksHtml(backend)}
            ${switchAction}
          </div>
        </article>
      `;
    })
    .join("");
}

function scopedSessionSettings() {
  const settings = scopedJsonGet("autoResearchSessionSettings", {});
  return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
}

function providerSettingsFromScoped(scoped, backend) {
  if (!scoped || typeof scoped !== "object") return {};
  const normalized = normalizeAgentBackend(backend);
  if (scoped[normalized] && typeof scoped[normalized] === "object") return scoped[normalized];
  if (!scoped.codex && !scoped.claude && !scoped.agent) return scoped;
  return {};
}

function mergedProjectSessionSettings(settings = uiSettings || {}) {
  const scoped = scopedSessionSettings();
  const backend = normalizeAgentBackend(scoped?.agent?.backend || scoped?.backend || settings?.agent?.backend || settings?.backend);
  return normalizeSessionSettings({
    ...providerSettingsFromUi(backend),
    ...(settings?.[backend] || {}),
    ...providerSettingsFromScoped(scoped, backend),
    backend,
  });
}

function sessionSettingsForStorage(settings) {
  const normalized = normalizeSessionSettings(settings);
  const backend = normalizeAgentBackend(normalized.backend);
  const envelope = scopedSessionSettings();
  const next = envelope && typeof envelope === "object" && (envelope.agent || envelope.codex || envelope.claude)
    ? { ...envelope }
    : {
        agent: { backend },
        codex: normalizeSessionSettings({ ...providerSettingsFromUi("codex"), backend: "codex" }),
        claude: normalizeSessionSettings({ ...providerSettingsFromUi("claude"), backend: "claude" }),
      };
  next.agent = { backend };
  next[backend] = { ...normalized };
  delete next[backend].backend;
  return next;
}

function projectSessionSettingsForStorage(settings = uiSettings || {}) {
  const backend = normalizeAgentBackend(settings?.agent?.backend || settings?.backend);
  const codex = normalizeSessionSettings({
    ...providerSettingsFromUi("codex"),
    ...(settings?.codex || {}),
    backend: "codex",
  });
  const claude = normalizeSessionSettings({
    ...providerSettingsFromUi("claude"),
    ...(settings?.claude || {}),
    backend: "claude",
  });
  return {
    agent: { backend },
    codex: stripBackendSetting(codex),
    claude: stripBackendSetting(claude),
  };
}

function persistSessionSettings(settings) {
  scopedSet("autoResearchSessionSettings", JSON.stringify(sessionSettingsForStorage(settings)));
}

function persistProjectSessionSettings(settings = uiSettings || {}) {
  scopedSet("autoResearchSessionSettings", JSON.stringify(projectSessionSettingsForStorage(settings)));
}

function storedComposerDraft() {
  return scopedGet("autoResearchComposerDraft", "", { legacyFallback: false });
}

function persistComposerDraft(value = "") {
  const text = String(value ?? "");
  composerDraft = text;
  if (text) scopedSet("autoResearchComposerDraft", text);
  else scopedRemove("autoResearchComposerDraft");
}

function clearComposerDraft() {
  persistComposerDraft("");
}

function hydrateTargetVenueField(options = {}) {
  const input = $("#target-venue");
  if (!input) return "";
  const projectId = String(activeProjectId || appState?.active_project_id || "");
  const projectChanged = projectId !== targetVenueProjectId;
  if (projectChanged) {
    targetVenueProjectId = projectId;
  }
  const stored = scopedGet("autoResearchTargetVenue", "", { legacyFallback: false });
  if (options.force || projectChanged) {
    input.value = stored || "";
    localStorage.removeItem("autoResearchTargetVenue");
    return input.value;
  }
  if (stored && !String(input.value || "").trim() && document.activeElement !== input) {
    input.value = stored;
  }
  return input.value;
}

function normalizeThemeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (legacyThemeModes[mode]) return legacyThemeModes[mode];
  return allowedThemeModes.has(mode) ? mode : defaultThemeMode;
}

function applyThemeMode(value, options = {}) {
  const mode = normalizeThemeMode(value);
  currentThemeMode = mode;
  document.documentElement.dataset.theme = mode;
  if (options.persist !== false) localStorage.setItem("coAutoResearchTheme", mode);
  hydrateThemeControls();
  return mode;
}

function hydrateThemeControls() {
  $$('[data-theme-option]').forEach((input) => {
    input.checked = input.value === currentThemeMode;
  });
}

function apiPath(path) {
  if (!path.startsWith("/api/") || path.startsWith("/api/projects")) return path;
  if (!activeProjectId) return path;
  const url = new URL(path, window.location.origin);
  if (!url.searchParams.has("project")) url.searchParams.set("project", activeProjectId);
  return `${url.pathname}${url.search}`;
}

async function api(path, options = {}) {
  const response = await fetch(apiPath(path), {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function apiBinary(path, body, options = {}) {
  const response = await fetch(apiPath(path), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", ...(options.headers || {}) },
    body,
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function researchEventsPath() {
  const query = researchEventLastId ? `?since=${encodeURIComponent(researchEventLastId)}` : "";
  return apiPath(`/api/research/events${query}`);
}

function stopResearchEventStream(options = {}) {
  clearTimeout(researchEventReconnectTimer);
  researchEventReconnectTimer = null;
  if (researchEventSource) {
    researchEventSource.close();
    researchEventSource = null;
  }
  researchEventProjectId = "";
  if (options.resetLastId) researchEventLastId = "";
}

function clearOverviewPoll() {
  clearTimeout(overviewPollTimer);
  overviewPollTimer = null;
  overviewPollGeneration += 1;
}

function queueStreamingOverviewRefresh() {
  if (researchEventOverviewRefreshPending) return;
  researchEventOverviewRefreshPending = true;
  setTimeout(async () => {
    researchEventOverviewRefreshPending = false;
    if (!activeProjectId) return;
    try {
      await loadOverview(true);
    } catch (_error) {
      // Overview polling remains the correctness fallback.
    }
  }, 0);
}

function upsertSessionTranscriptEntry(session, entry) {
  if (!entry || typeof entry !== "object") return false;
  const transcript = Array.isArray(session.transcript) ? [...session.transcript] : [];
  const entryId = String(entry.id || "").trim();
  let updated = false;
  if (entryId) {
    const index = transcript.findIndex((item) => String(item?.id || "") === entryId);
    if (index >= 0) {
      transcript[index] = { ...transcript[index], ...entry };
      updated = true;
    }
  }
  if (!updated) transcript.push(entry);
  session.transcript = transcript.slice(-600);
  return true;
}

function syncPlanArtifactFromTranscriptEntry(entry, session = null) {
  const artifact = entry?.artifact && typeof entry.artifact === "object" ? entry.artifact : null;
  if (!artifact || artifact.type !== "plan" || !artifact.id) return false;
  if (!appState) appState = {};
  appState.latest_plan = artifact;
  if (session && typeof session === "object") {
    session.latest_plan = artifact;
  } else if (appState.research_session && typeof appState.research_session === "object") {
    appState.research_session.latest_plan = artifact;
  }
  if (upsertLatestPlanMessage(localMessages, artifact)) lastFramingHtml = "";
  return true;
}

function applyResearchEventPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  const eventProjectId = String(payload.project_id || "").trim();
  if (eventProjectId && activeProjectId && eventProjectId !== activeProjectId) return false;
  if (payload.event_id !== undefined) {
    const nextEventId = Number(payload.event_id || 0);
    const currentEventId = Number(researchEventLastId || 0);
    if (Number.isFinite(nextEventId) && nextEventId > currentEventId) researchEventLastId = String(nextEventId);
  }
  if (!appState) appState = {};
  const currentSession = appState.research_session && typeof appState.research_session === "object" ? appState.research_session : {};
  const sessionPatch = payload.session_patch && typeof payload.session_patch === "object" ? payload.session_patch : {};
  const nextSession = {
    ...currentSession,
    ...(payload.run_id ? { id: payload.run_id } : {}),
    ...(payload.backend ? { backend: payload.backend } : {}),
    ...(payload.mode ? { mode: payload.mode } : {}),
    ...(payload.status ? { status: payload.status } : {}),
    ...sessionPatch,
  };
  upsertSessionTranscriptEntry(nextSession, payload.transcript_entry);
  syncPlanArtifactFromTranscriptEntry(payload.transcript_entry, nextSession);
  if (payload.log) {
    const logs = Array.isArray(nextSession.logs) ? [...nextSession.logs] : [];
    const line = String(payload.log || "");
    if (line && logs[logs.length - 1] !== line) logs.push(line);
    nextSession.logs = logs.slice(-500);
  }
  appState.research_session = nextSession;
  renderChatState();
  renderSession();
  renderResumeCommandBar();
  renderComposerSuggestions();
  scheduleWorkingTicker();
  if (payload.kind === "completed" || payload.kind === "error") queueStreamingOverviewRefresh();
  return true;
}

function handleResearchEventMessage(event) {
  try {
    applyResearchEventPayload(JSON.parse(event.data));
  } catch (_error) {
    // Ignore malformed stream frames; overview polling will reconcile state.
  }
}

function scheduleResearchEventReconnect() {
  clearTimeout(researchEventReconnectTimer);
  if (!activeProjectId || researchEventFailureCount >= 3) return;
  const delay = Math.min(10000, 1000 * Math.max(1, researchEventFailureCount));
  researchEventReconnectTimer = setTimeout(() => startResearchEventStream({ force: true }), delay);
}

function startResearchEventStream(options = {}) {
  if (!activeProjectId || typeof EventSource === "undefined") return;
  if (researchEventFailureCount >= 3 && !options.force) return;
  if (researchEventSource && researchEventProjectId === activeProjectId && !options.force) return;
  const previousProjectId = researchEventProjectId;
  stopResearchEventStream({ resetLastId: previousProjectId && previousProjectId !== activeProjectId });
  researchEventProjectId = activeProjectId;
  const source = new EventSource(researchEventsPath());
  researchEventSource = source;
  source.addEventListener("research", handleResearchEventMessage);
  source.onmessage = handleResearchEventMessage;
  source.onopen = () => {
    researchEventFailureCount = 0;
  };
  source.onerror = () => {
    if (researchEventSource === source) {
      researchEventFailureCount += 1;
      stopResearchEventStream();
      scheduleResearchEventReconnect();
    }
  };
}

function mergeSessionFromApiResponse(payload) {
  const session =
    payload?.result?.session ||
    payload?.session ||
    payload?.result?.result?.session ||
    null;
  if (!session) return false;
  optimisticResearchSession = null;
  if (!appState) appState = {};
  appState.research_session = session;
  const plan = payload?.result?.plan || session.latest_plan || null;
  if (plan && typeof plan === "object" && plan.id) {
    appState.latest_plan = plan;
    if (upsertLatestPlanMessage(localMessages)) lastFramingHtml = "";
  }
  startResearchEventStream();
  renderChatState();
  renderSession();
  renderResumeCommandBar();
  renderComposerSuggestions();
  return true;
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object") return value || null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return { ...value };
  }
}

function nextOptimisticTrialIteration() {
  const trialIterations = (appState?.trials || [])
    .filter((trial) => trial?.is_closed === true || (trial?.is_closed === undefined && String(trial?.report_path || "").trim()))
    .map((trial) => trialIterationValue(trial))
    .filter((value) => Number.isFinite(value) && value > 0);
  const closedLatest = Math.max(...trialIterations, 0);
  const trajectoryNext = Number(appState?.research_session?.trajectory?.next_trial_number || 0);
  if (Number.isFinite(trajectoryNext) && trajectoryNext > 0) return trajectoryNext;
  const sessionIteration = Number(sessionState().loop_iteration || 0);
  const latest = Math.max(closedLatest, Number.isFinite(sessionIteration) ? sessionIteration : 0);
  return Math.max(1, latest + (latest ? 1 : 0));
}

function optimisticAutoresearchSession(settings) {
  const startedAt = new Date().toISOString();
  const backend = normalizeAgentBackend(settings?.backend || activeSettingsBackend());
  const iteration = nextOptimisticTrialIteration();
  const statusLabel = `Starting autoresearch on Trial ${iteration}`;
  return {
    ...(clonePlainObject(appState?.research_session) || {}),
    id: `optimistic_goal_${Date.now()}`,
    session_id: "",
    backend,
    backend_label: agentLabel(backend),
    status: "running",
    mode: "goal",
    command: "Starting selected agent...",
    settings: normalizeSessionSettings(settings || {}),
    started_at: startedAt,
    ended_at: "",
    returncode: null,
    logs: [],
    raw_logs: [],
    transcript: [
      {
        id: `optimistic_goal_user_${Date.now()}`,
        role: "user",
        title: "User",
        content: "Start autoresearch loop.",
        raw_type: "ui.goal",
        created_at: startedAt,
        iteration,
      },
    ],
    loop_active: true,
    loop_iteration: iteration,
    loop_max_iterations: normalizeReviewCheckpointInterval(settings?.reviewCheckpointInterval),
    loop_review_checkpoint_iteration: iteration + normalizeReviewCheckpointInterval(settings?.reviewCheckpointInterval) - 1,
    loop_stop_reason: "",
    gate: { status: "continue", raw_status: "continue" },
    active_run: {
      running: true,
      mode: "goal",
      started_at: startedAt,
      trial_iteration: iteration,
      trial_label: `Trial ${iteration}`,
      status_label: statusLabel,
      trajectory_mismatch: false,
    },
  };
}

function startOptimisticAutoresearchSession(settings) {
  optimisticResearchSession = optimisticAutoresearchSession(settings);
  selectedTrialIndex = Number(optimisticResearchSession.loop_iteration || 0) || selectedTrialIndex;
  renderStage();
  renderChatState();
  renderSession();
  renderResumeCommandBar();
  renderComposerSuggestions();
}

function clearOptimisticAutoresearchSession(previousSession = null) {
  optimisticResearchSession = null;
  if (previousSession && appState) appState.research_session = previousSession;
  renderStage();
  renderChatState();
  renderSession();
  renderResumeCommandBar();
  renderComposerSuggestions();
}

function projectStatusClass(project) {
  const status = String(project?.status || "").toLowerCase();
  if (status === "running" || status === "stopping" || project?.loop_active) return "running";
  if (project?.has_session) return "active";
  if (project?.project_ready) return "ready";
  return "idle";
}

function projectStatusLabel(project) {
  const status = String(project?.status || "idle").toLowerCase();
  if (status === "running") return "running";
  if (status === "stopping") return "stopping";
  if (project?.loop_active) return "goal loop";
  if (project?.has_session) return "session";
  if (project?.project_ready) return "ready";
  return "new";
}

function projectReviewerStatus(project) {
  const status = project?.reviewer_status || project?.reviewerStatus || {};
  return status && typeof status === "object" ? status : {};
}

function hasStatusItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function projectReviewerInstructionsOutdated(project) {
  const status = projectReviewerStatus(project);
  const baseline = String(status.baseline_version || "");
  const latest = String(status.latest_baseline_version || "");
  return Boolean(
    hasStatusItems(status.missing) ||
    hasStatusItems(status.changed) ||
    hasStatusItems(status.metadata_missing) ||
    hasStatusItems(status.protocol_missing) ||
    hasStatusItems(status.protocol_changed) ||
    hasStatusItems(status.protocol_metadata_missing) ||
    (latest && baseline !== latest)
  );
}

function currentProject() {
  const projects = Array.isArray(appState?.projects) ? appState.projects : [];
  return projects.find((project) => String(project.id || "") === String(activeProjectId || appState?.active_project_id || "")) || appState?.project || {};
}

function currentProjectName() {
  const project = currentProject();
  return String(project.display_name || project.title || "Project").trim();
}

function projectNameForId(projectId = activeProjectId) {
  const project = projectById(projectId) || currentProject();
  return String(project?.display_name || project?.title || "Project").trim();
}

function projectLoadingCopy() {
  if (projectLoadPhase === "projects") {
    return {
      eyebrow: "Projects",
      title: "Loading projects...",
      detail: "Finding available research workspaces",
      sync: "Loading projects",
      retry: false,
    };
  }
  if (projectLoadPhase === "overview") {
    const name = projectNameForId();
    return {
      eyebrow: "Opening project",
      title: `Opening ${name}...`,
      detail: "Reading project files and session state",
      sync: "Reading files",
      retry: false,
    };
  }
  if (projectLoadPhase === "error") {
    const name = projectNameForId();
    return {
      eyebrow: "Project unavailable",
      title: `Could not open ${name}`,
      detail: projectLoadError || "The project files could not be read.",
      sync: "Could not read files",
      retry: true,
    };
  }
  return {
    eyebrow: "",
    title: "",
    detail: "",
    sync: "",
    retry: false,
  };
}

function isProjectLoading() {
  return projectLoadPhase === "projects" || projectLoadPhase === "overview" || projectLoadPhase === "error";
}

function renderProjectLoadingState() {
  const loading = isProjectLoading() && !hasNoProject();
  const copy = projectLoadingCopy();
  document.body.classList.toggle("is-project-loading", loading);
  document.body.classList.toggle("is-project-loading-error", projectLoadPhase === "error");
  const panel = $("#project-loading-state");
  if (panel) {
    panel.hidden = !loading;
    $("#project-loading-eyebrow").textContent = copy.eyebrow;
    $("#project-loading-title").textContent = copy.title;
    $("#project-loading-detail").textContent = copy.detail;
    const retry = $("#project-loading-retry");
    if (retry) retry.hidden = !copy.retry;
  }
  if (copy.sync) $("#sync-state").textContent = copy.sync;
}

function setProjectLoadPhase(phase, options = {}) {
  projectLoadPhase = phase || "ready";
  projectLoadError = String(options.error || "");
  renderProjectLoadingState();
  renderComposerActionButtons();
}

function projectById(projectId) {
  const id = String(projectId || "");
  const projects = Array.isArray(appState?.projects) ? appState.projects : [];
  return projects.find((project) => String(project.id || "") === id) || null;
}

function normalizeProjectAlias(value) {
  return String(value || "").trim().replaceAll("\\", "/").replaceAll(/^\/+|\/+$/g, "").toLowerCase();
}

function projectDirectorySlug(value) {
  return String(value || "").trim().replaceAll(/[^A-Za-z0-9._-]+/g, "_").replaceAll(/^[ ._-]+|[ ._-]+$/g, "").slice(0, 80) || "project";
}

function resolveProjectIdAlias(projects, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const exact = projects.find((project) => String(project.id || "") === text);
  if (exact?.id) return String(exact.id);
  const alias = normalizeProjectAlias(text);
  if (!alias) return "";
  const match = projects.find((project) => {
    const root = String(project.root || "");
    const displayName = String(project.display_name || "").trim();
    const title = String(project.title || "").trim();
    const candidates = [
      displayName,
      title,
      root,
      basename(root),
      projectDirectorySlug(displayName),
      projectDirectorySlug(title),
    ];
    return candidates.some((candidate) => normalizeProjectAlias(candidate) === alias);
  });
  return match?.id ? String(match.id) : "";
}

function hasActiveProject() {
  const id = String(activeProjectId || appState?.active_project_id || "");
  if (!id) return false;
  const projects = Array.isArray(appState?.projects) ? appState.projects : [];
  if (projects.some((project) => String(project.id || "") === id)) return true;
  return String(appState?.project?.id || "") === id;
}

function hasNoProject() {
  return Boolean(appState?.multi_project && !hasActiveProject());
}

function renderProjectAvailability() {
  const noProject = hasNoProject();
  const loading = isProjectLoading() && !noProject;
  document.body.classList.toggle("has-no-project", noProject);
  const controls = [
    "#cold-file-editor",
    "#prepare-cold-start",
    "#target-venue",
    "#composer-model",
    "#composer-reasoning",
  ];
  controls.forEach((selector) => {
    const element = $(selector);
    if (element) element.disabled = noProject || loading;
  });
  $$(".composer-attach-button, [data-attachment-action], .composer-suggestion-chip").forEach((button) => {
    button.disabled = noProject || loading;
    button.setAttribute("aria-disabled", noProject || loading ? "true" : "false");
  });
  updateResourceImportActionState();
  renderComposerActionButtons();
  renderProjectLoadingState();
  if (loading) {
    renderProjectLaunchFallbackPanel(false);
    const editor = $("#cold-file-editor");
    if (editor) editor.placeholder = "Opening project...";
    $("#session-pill")?.toggleAttribute("hidden", true);
    $("#resume-command-bar")?.toggleAttribute("hidden", true);
    $("#composer-suggestions")?.toggleAttribute("hidden", true);
    return;
  }
  if (!noProject) return;
  renderProjectLaunchFallbackPanel(false);
  const editor = $("#cold-file-editor");
  if (editor) {
    editor.value = "";
    editor.placeholder = "Create a project first...";
  }
  const eyebrow = $("#chat-eyebrow");
  if (eyebrow) eyebrow.textContent = "Projects";
  const title = $("#chat-title");
  if (title) title.textContent = "Create your first research project.";
  $("#session-pill")?.toggleAttribute("hidden", true);
  $("#resume-command-bar")?.toggleAttribute("hidden", true);
  $("#composer-suggestions")?.toggleAttribute("hidden", true);
}

function maybeOpenInitialProjectDialog() {
  runInitialPreflightFlow();
}

function renderProjectCreateButton() {
  const button = $("#open-project-create");
  if (!button) return;
  button.hidden = false;
}

function closeProjectMenu() {
  openProjectMenuId = "";
  renderProjectList();
}

function renderProjectList() {
  const target = $("#project-list");
  if (!target) return;
  const projects = Array.isArray(appState?.projects) ? appState.projects : [];
  renderProjectCreateButton();
  if (projectLoadPhase === "projects" && !projects.length) {
    target.innerHTML = `
      <div class="project-switch-row is-loading">
        <div class="project-switch project-switch-skeleton">
          <span class="project-status-dot idle" aria-hidden="true"></span>
          <span>
            <strong>Loading projects...</strong>
            <small>Reading workspaces</small>
          </span>
        </div>
      </div>
      <div class="project-switch-row is-loading">
        <div class="project-switch project-switch-skeleton">
          <span class="project-status-dot idle" aria-hidden="true"></span>
          <span>
            <strong>&nbsp;</strong>
            <small>&nbsp;</small>
          </span>
        </div>
      </div>
    `;
    renderRailVisibility();
    renderProjectAvailability();
    return;
  }
  if (!projects.length) {
    target.innerHTML = `
      <button class="project-empty project-empty-action" type="button" data-create-first-project>
        <span>No projects yet.</span>
        <strong>Create project</strong>
      </button>
    `;
    renderRailVisibility();
    renderProjectAvailability();
    return;
  }
  target.innerHTML = projects
    .map((project) => {
      const selected = String(project.id || "") === String(activeProjectId || appState?.active_project_id || "");
      const statusClass = projectStatusClass(project);
      const label = projectStatusLabel(project);
      const menuOpen = String(project.id || "") === String(openProjectMenuId || "");
      const reviewerOutdated = projectReviewerInstructionsOutdated(project);
      return `
        <div class="project-switch-row ${selected ? "is-active" : ""}" data-project-row="${escapeHtml(project.id)}">
          <button class="project-switch" type="button" data-project-switch="${escapeHtml(project.id)}">
            <span class="project-status-dot ${escapeHtml(statusClass)}" aria-hidden="true"></span>
            <span>
              <strong>${escapeHtml(project.display_name || project.title || "Project")}</strong>
              <small>${escapeHtml(label)}${project.session_id ? ` · ${escapeHtml(String(project.session_id).slice(0, 8))}` : ""}</small>
            </span>
          </button>
          <button class="project-menu-button" type="button" data-project-menu="${escapeHtml(project.id)}" aria-label="Project options" aria-haspopup="menu" aria-expanded="${menuOpen ? "true" : "false"}">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>
          </button>
          <div class="project-menu-popover" role="menu" data-project-menu-panel="${escapeHtml(project.id)}" ${menuOpen ? "" : "hidden"}>
            ${reviewerOutdated ? `
              <button type="button" role="menuitem" data-project-upgrade-reviewers="${escapeHtml(project.id)}">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>
                <span>Update instructions</span>
              </button>
            ` : ""}
            <button type="button" role="menuitem" data-project-rename="${escapeHtml(project.id)}">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Zm11-13 2 2"/></svg>
              <span>Rename</span>
            </button>
            <button class="is-danger" type="button" role="menuitem" data-project-delete="${escapeHtml(project.id)}">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>
              <span>Delete</span>
            </button>
          </div>
        </div>
      `;
    })
    .join("");
  renderRailVisibility();
  renderProjectAvailability();
}

function clearObject(object) {
  Object.keys(object).forEach((key) => delete object[key]);
}

function resetProjectClientState() {
  stopResearchEventStream({ resetLastId: true });
  researchEventFailureCount = 0;
  activeColdPath = "";
  coldDirty = false;
  prepareSaved = false;
  projectDraftDirty = false;
  framingDraftPending = false;
  editingFramingId = "";
  lastFramingHtml = "";
  chatScrollRestoredProjectId = "";
  framingMessagesSaveVersion += 1;
  framingMessagesPersisting = false;
  framingReplyPending = false;
  pendingFramingUserMessageId = "";
  framingPendingSince = 0;
  selectedTrialIndex = 0;
  targetVenueProjectId = activeProjectId || "";
  composerDraft = "";
  openRunActivityDetails.clear();
  localMessages.splice(0);
  selectedResourceItems.splice(0);
  selectedUploadItems.splice(0);
  pendingResourceImports.splice(0);
  sentFramingResourceItems.splice(0);
  sentFramingUploadItems.splice(0);
  clearObject(coldFiles);
  clearObject(inlineFiles);
  clearObject(inlineFilePayloads);
  clearObject(inlineFileModes);
  figureImageJobs.clear();
  figureImageAutoStarted.clear();
  figureImagePollTimers.forEach((timer) => clearTimeout(timer));
  figureImagePollTimers.clear();
  clearTimeout(figureImageAutoTimer);
  figureImageAutoTimer = null;
  const coldEditor = $("#cold-file-editor");
  if (coldEditor) coldEditor.value = "";
  const targetVenue = $("#target-venue");
  if (targetVenue) targetVenue.value = "";
}

async function switchProject(projectId) {
  const next = String(projectId || "").trim();
  if (!next || next === activeProjectId) return;
  clearOverviewPoll();
  persistActiveViewScrollPosition();
  persistNavigationState();
  activeProjectId = next;
  localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
  updateNavigationUrl();
  setProjectLoadPhase("overview");
  composerMode = initialComposerMode(activeProjectId);
  pendingPlanRevisionId = "";
  resetProjectClientState();
  restoreNavigationState();
  hydrateTargetVenueField({ force: true });
  restoreSessionSettings();
  restoreResourceSelections();
  restorePendingResourceImports();
  await loadUiSettings();
  await loadOverview(true);
}

async function loadProjects(options = {}) {
  if (options.showLoading) setProjectLoadPhase("projects");
  const previousActiveProjectId = activeProjectId;
  const payload = await api("/api/projects");
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const known = new Set(projects.map((project) => String(project.id || "")));
  const resolvedProjectId = resolveProjectIdAlias(projects, activeProjectId);
  if (resolvedProjectId && resolvedProjectId !== activeProjectId) {
    activeProjectId = resolvedProjectId;
    localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
    composerMode = initialComposerMode(activeProjectId);
    pendingPlanRevisionId = "";
  }
  if (!activeProjectId || !known.has(activeProjectId)) {
    activeProjectId = String(resolveProjectIdAlias(projects, payload.active_project_id) || projects[0]?.id || "");
    if (activeProjectId) localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
    else localStorage.removeItem("coAutoResearchActiveProject");
    composerMode = initialComposerMode(activeProjectId);
    pendingPlanRevisionId = "";
  }
  if (String(activeProjectId || "") !== String(previousActiveProjectId || "")) {
    resetProjectClientState();
    updateNavigationUrl();
  }
  appState = { ...(appState || {}), projects, active_project_id: activeProjectId, multi_project: Boolean(payload.multi_project) };
  renderProjectList();
  renderProjectAvailability();
  renderComposerModeControls();
  if (options.showLoading && activeProjectId) setProjectLoadPhase("overview");
  else setProjectLoadPhase("ready");
  maybeOpenInitialProjectDialog();
}

async function upgradeProjectReviewers(projectId) {
  const id = String(projectId || activeProjectId || "").trim();
  if (!id) return;
  const project = projectById(id) || {};
  const payload = await api("/api/projects/upgrade-reviewers", {
    method: "POST",
    body: JSON.stringify({ project: id }),
  });
  appState = {
    ...(appState || {}),
    projects: Array.isArray(payload.projects) ? payload.projects : appState?.projects || [],
    active_project_id: payload.active_project_id || activeProjectId,
    multi_project: Boolean(payload.multi_project ?? appState?.multi_project),
  };
  renderProjectList();
  if (id === activeProjectId) {
    setProjectLoadPhase("overview");
    await loadOverview(true);
  }
  showToast(`Updated reviewers for ${project.display_name || project.title || "project"}.`);
}

function openProjectCreateDialog() {
  const form = $("#project-create-form");
  const dialog = $("#project-dialog");
  const note = $("#project-create-note");
  form?.reset();
  const backendSelect = $("#project-agent-backend");
  if (backendSelect) backendSelect.value = activeSettingsBackend();
  renderAgentStatusNote("#project-agent-backend-note", backendSelect?.value || activeSettingsBackend(), "project");
  if (note) {
    note.textContent = appState?.multi_project
      ? "Creates a separate project inside the served projects folder."
      : "Creates a sibling project next to the current project, then switches this UI into a multi-project dashboard.";
    note.dataset.tone = "";
  }
  if (dialog?.showModal) dialog.showModal();
  else dialog?.setAttribute("open", "");
  requestAnimationFrame(() => $("#project-name")?.focus());
}

function closeProjectCreateDialog() {
  const dialog = $("#project-dialog");
  if (!dialog) return;
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
}

function openProjectRenameDialog(projectId) {
  const project = projectById(projectId);
  if (!project) return;
  pendingRenameProject = project;
  closeProjectMenu();
  const form = $("#project-rename-form");
  const input = $("#project-rename-name");
  const note = $("#project-rename-note");
  form?.reset();
  if (input) input.value = project.display_name || project.title || "";
  if (note) {
    note.textContent = "Renaming changes the dashboard label only. It does not move or rename the project folder.";
    note.dataset.tone = "";
  }
  const dialog = $("#project-rename-dialog");
  if (dialog?.showModal) dialog.showModal();
  else dialog?.setAttribute("open", "");
  requestAnimationFrame(() => input?.focus());
}

function closeProjectRenameDialog() {
  pendingRenameProject = null;
  const dialog = $("#project-rename-dialog");
  if (!dialog) return;
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
}

async function renameProjectFromDialog(event) {
  event.preventDefault();
  if (!pendingRenameProject) return;
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const name = String(data.get("projectName") || "").trim();
  const agentBackend = normalizeAgentBackend(data.get("agentBackend") || activeSettingsBackend());
  if (!name) {
    showToast("Project name is required.", true);
    return;
  }
  submit.disabled = true;
  try {
    const payload = await api("/api/projects/rename", {
      method: "POST",
      body: JSON.stringify({ project: pendingRenameProject.id, name }),
    });
    activeProjectId = String(payload.active_project_id || payload.project?.id || activeProjectId || "");
    if (activeProjectId) localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
    appState = {
      ...(appState || {}),
      projects: Array.isArray(payload.projects) ? payload.projects : [],
      active_project_id: activeProjectId,
      multi_project: Boolean(payload.multi_project),
    };
    closeProjectRenameDialog();
    renderProjectList();
    renderChatState();
    showToast("Project renamed.");
  } catch (error) {
    const note = $("#project-rename-note");
    if (note) {
      note.textContent = error.message;
      note.dataset.tone = "error";
    }
    showToast(error.message, true);
  } finally {
    submit.disabled = false;
  }
}

function updateDeleteSubmitState() {
  const input = $("#project-delete-confirm");
  const button = $("#project-delete-submit");
  const expected = String(pendingDeleteProject?.display_name || "").trim();
  const matches = Boolean(expected && String(input?.value || "").trim() === expected);
  if (button) button.disabled = !matches;
}

function openProjectDeleteDialog(projectId) {
  const project = projectById(projectId);
  if (!project) return;
  pendingDeleteProject = project;
  closeProjectMenu();
  const form = $("#project-delete-form");
  const input = $("#project-delete-confirm");
  const name = project.display_name || project.title || "Project";
  const nameTarget = $("#project-delete-name");
  const note = $("#project-delete-note");
  form?.reset();
  if (nameTarget) nameTarget.textContent = name;
  if (input) {
    input.value = "";
    input.placeholder = name;
  }
  if (note) {
    note.textContent = "Deletion is disabled until the project name matches exactly.";
    note.dataset.tone = "";
  }
  updateDeleteSubmitState();
  const dialog = $("#project-delete-dialog");
  if (dialog?.showModal) dialog.showModal();
  else dialog?.setAttribute("open", "");
  requestAnimationFrame(() => input?.focus());
}

function closeProjectDeleteDialog() {
  pendingDeleteProject = null;
  const dialog = $("#project-delete-dialog");
  if (!dialog) return;
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
}

async function deleteProjectFromDialog(event) {
  event.preventDefault();
  if (!pendingDeleteProject) return;
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const confirm = String(new FormData(form).get("confirmName") || "").trim();
  const expected = String(pendingDeleteProject.display_name || "").trim();
  if (confirm !== expected) {
    showToast("Project name does not match.", true);
    return;
  }
  submit.disabled = true;
  const deletingActive = String(pendingDeleteProject.id || "") === String(activeProjectId || "");
  if (deletingActive) {
    clearOverviewPoll();
    stopResearchEventStream({ resetLastId: true });
    researchEventOverviewRefreshPending = false;
    framingMessagesSaveVersion += 1;
    framingMessagesPersisting = false;
  }
  try {
    const payload = await api("/api/projects/delete", {
      method: "POST",
      body: JSON.stringify({ project: pendingDeleteProject.id, confirm }),
    });
    activeProjectId = String(payload.active_project_id || "");
    if (activeProjectId) localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
    else localStorage.removeItem("coAutoResearchActiveProject");
    if (deletingActive) resetProjectClientState();
    appState = {
      ...(appState || {}),
      projects: Array.isArray(payload.projects) ? payload.projects : [],
      active_project_id: activeProjectId,
      multi_project: Boolean(payload.multi_project),
    };
    closeProjectDeleteDialog();
    renderProjectList();
    if (activeProjectId) {
      setProjectLoadPhase("overview");
      await loadUiSettings();
      await loadOverview(true);
      scheduleOverviewPoll(1000);
    } else {
      setProjectLoadPhase("ready");
      renderProjectAvailability();
      maybeOpenInitialProjectDialog();
      scheduleOverviewPoll(3500);
    }
    showToast(payload.stopped_active_run ? "Stopped active run and deleted project." : "Project deleted.");
  } catch (error) {
    const note = $("#project-delete-note");
    if (note) {
      note.textContent = error.message;
      note.dataset.tone = "error";
    }
    showToast(error.message, true);
    if (deletingActive) scheduleOverviewPoll(1000);
  } finally {
    submit.disabled = false;
    updateDeleteSubmitState();
  }
}

async function createProjectFromDialog(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const name = String(data.get("projectName") || "").trim();
  const agentBackend = normalizeAgentBackend(data.get("agentBackend") || activeSettingsBackend());
  if (!name) {
    showToast("Project name is required.", true);
    return;
  }
  submit.disabled = true;
  try {
    $("#project-create-note")?.removeAttribute("data-tone");
    const payload = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, agentBackend }),
    });
    const project = payload.project || {};
    activeProjectId = String(project.id || payload.active_project_id || "");
    if (activeProjectId) localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
    clearOverviewPoll();
    updateNavigationUrl();
    resetProjectClientState();
    appState = {
      ...(appState || {}),
      projects: Array.isArray(payload.projects) ? payload.projects : [],
      active_project_id: activeProjectId,
      multi_project: Boolean(payload.multi_project),
    };
    closeProjectCreateDialog();
    renderProjectList();
    setProjectLoadPhase("overview");
    hydrateTargetVenueField({ force: true });
    restoreResourceSelections();
    await loadUiSettings();
    restoreSessionSettings();
    await loadOverview(true);
    scheduleOverviewPoll(1000);
    showToast(`Created ${project.display_name || name}.`);
  } catch (error) {
    const note = $("#project-create-note");
    if (note) {
      note.textContent = error.message;
      note.dataset.tone = "error";
    }
    showToast(error.message, true);
  } finally {
    submit.disabled = false;
  }
}

async function loadOverview(silent = false) {
  const requestedProjectId = String(activeProjectId || "");
  const showOverviewLoading = !silent || projectLoadPhase === "overview" || projectLoadPhase === "projects";
  if (!activeProjectId && appState?.multi_project) {
    $("#sync-state").textContent = "Create a project";
    setProjectLoadPhase("ready");
    renderProjectList();
    renderProjectAvailability();
    maybeOpenInitialProjectDialog();
    return;
  }
  try {
    if (showOverviewLoading && projectLoadPhase !== "overview" && projectLoadPhase !== "projects") setProjectLoadPhase("overview");
    const materialContent = $("#context-content");
    const holdMaterialTree = activeView === "materials" && Boolean(materialContent?.childElementCount);
    const overviewPath = requestedProjectId ? `/api/overview?project=${encodeURIComponent(requestedProjectId)}` : "/api/overview";
    const overviewPayload = await api(overviewPath);
    if (requestedProjectId && activeProjectId && requestedProjectId !== String(activeProjectId || "")) {
      return;
    }
    appState = overviewPayload;
    syncServerClockOffset(appState.generated_at);
    if (appState.active_project_id && appState.active_project_id !== activeProjectId) {
      activeProjectId = appState.active_project_id;
      localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
      updateNavigationUrl();
      resetProjectClientState();
      restoreNavigationState();
      restoreResourceSelections();
      restorePendingResourceImports();
    }
    startResearchEventStream();
    const session = appState.research_session || {};
    if (framingDraftPending && session.mode === "framing" && !["running", "stopping"].includes(session.status)) {
      framingDraftPending = false;
      reconcileFramingPending(localMessages);
    }
    if (!["running", "stopping"].includes(String(session.status || "").toLowerCase())) {
      reconcileFramingPending(localMessages);
    }
    setProjectLoadPhase("ready");
    $("#sync-state").textContent = `Synced ${new Date(appState.generated_at).toLocaleTimeString()}`;
    renderProjectList();
    renderRailVisibility();
    hydrateTargetVenueField();
    hydrateColdStartFiles();
    restoreFramingMessages();
    restorePrepareSaved();
    renderColdStartEditor();
    renderChatState();
    renderStage();
    if (activeView === "materials") {
      $("#material-title").textContent = panelTitles[activePanel] || "Resources";
      if (!holdMaterialTree) renderContext();
    }
    renderSession();
    scheduleWorkingTicker();
    if (!silent) showToast("Refreshed from repository files.");
  } catch (error) {
    if (/Unknown project|Project is no longer available|Project was deleted/i.test(String(error.message || ""))) {
      const staleProjectId = activeProjectId;
      stopResearchEventStream({ resetLastId: true });
      clearOverviewPoll();
      try {
        await loadProjects({ showLoading: true });
        if (activeProjectId && activeProjectId !== staleProjectId) {
          await loadUiSettings();
          await loadOverview(true);
          scheduleOverviewPoll(1000);
          return;
        }
        if (!activeProjectId && appState?.multi_project) {
          setProjectLoadPhase("ready");
          renderProjectAvailability();
          maybeOpenInitialProjectDialog();
          scheduleOverviewPoll(3500);
          return;
        }
      } catch (_recoverError) {
        // Fall through to the normal unavailable-project state.
      }
    }
    if (showOverviewLoading) {
      setProjectLoadPhase("error", { error: error.message });
      showToast(error.message, true);
    } else {
      const sync = $("#sync-state");
      if (sync) sync.textContent = "Could not sync";
    }
  }
}

function scheduleOverviewPoll(delay, options = {}) {
  clearTimeout(overviewPollTimer);
  const generation = options.generation || (overviewPollGeneration += 1);
  overviewPollTimer = setTimeout(async () => {
    if (generation !== overviewPollGeneration) return;
    const pollProjectId = String(activeProjectId || "");
    if (activeProjectId) await loadOverview(true);
    else await loadProjects().catch((error) => {
      setProjectLoadPhase("error", { error: error.message });
      showToast(error.message, true);
    });
    if (generation !== overviewPollGeneration) return;
    if (pollProjectId !== String(activeProjectId || "")) {
      scheduleOverviewPoll(1000);
      return;
    }
    scheduleOverviewPoll(isSessionRunning() || framingDraftPending || framingReplyPending ? 1000 : 3500, { generation });
  }, delay);
}

function updateWorkingDurations() {
  $$("[data-working-started-at]").forEach((node) => {
    node.textContent = workingDurationText(node.dataset.workingStartedAt || "", {
      serverClock: node.dataset.workingServerClock === "true",
    });
  });
}

function scheduleWorkingTicker() {
  clearTimeout(workingTickerTimer);
  if (!isSessionRunning()) return;
  updateWorkingDurations();
  workingTickerTimer = setTimeout(scheduleWorkingTicker, 1000);
}

function hasVisibleTrial(trial) {
  if (!trial) return false;
  const report = String(trial.report_summary || "");
  const implications = String(trial.manuscript_implications || "");
  const status = String(trial.status || "");
  return (
    status === "reported" ||
    (hasRealText(report) && !/fill after cold start|no report summary/i.test(report)) ||
    (hasRealText(implications) && !/^no manuscript implications/i.test(implications)) ||
    (Array.isArray(trial.artifacts) && trial.artifacts.length > 0)
  );
}

function hasVisibleReview(review) {
  if (!review) return false;
  const name = String(review.name || "");
  const summary = String(review.summary || "");
  const title = String(review.title || "");
  return !/placeholder/i.test(name) && (hasRealText(summary) || hasRealText(title) || hasRealText(review.verdict));
}

function sectionHasRealContent(section) {
  const title = String(section?.title || "");
  const body = String(section?.body || "");
  if (looksPlaceholder(title) || looksPlaceholder(body)) return false;
  if (title.includes("<") || body.includes("<")) return false;
  const genericTitle = /^(Contribution Style|Core Story|Section Blueprint|Figure Plan|Table Plan)$/i.test(title);
  return hasRealText(body) || (hasRealText(title) && !genericTitle);
}

function hasVisibleManuscript() {
  const manuscript = appState?.summaries?.manuscript || {};
  if (
    hasRealText(manuscript.target) ||
    hasRealText(manuscript.contribution) ||
    hasRealText(manuscript.core_story) ||
    hasRealText(manuscript.toc) ||
    hasRealText(manuscript.no_table_rationale) ||
    hasRealText(manuscript.provenance) ||
    hasRealText(manuscript.traceability)
  ) return true;
  const sections = [
    ...(manuscript.architecture || []),
    ...(manuscript.inline_artifacts || []),
    ...(manuscript.claims || []),
    ...(manuscript.sections || []),
    ...(manuscript.section_blueprint || []),
    ...(manuscript.figure_plans || []),
    ...(manuscript.figures || []),
    ...(manuscript.table_plans || []),
    ...(manuscript.tables || []),
    ...(manuscript.figure_specs || []),
  ];
  if (sections.some(sectionHasRealContent)) return true;
  if ((manuscript.references || []).length) return true;
  return (manuscript.missing_evidence || []).some(hasRealText);
}

function visiblePanels() {
  return {
    chat: true,
    workspace: true,
    resources: true,
    trials: (appState?.trials || []).some(hasVisibleTrial),
    reviews: (appState?.reviews || []).some(hasVisibleReview),
    manuscript: hasVisibleManuscript(),
  };
}

function renderRailVisibility() {
  const nav = $(".rail-nav");
  if (nav) nav.hidden = !hasActiveProject();
  if (!hasActiveProject()) {
    $$(".rail-action").forEach((button) => {
      button.classList.remove("is-active");
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    });
    $("#chat-view").classList.add("is-active");
    $("#material-view").classList.remove("is-active");
    return;
  }
  const visible = visiblePanels();
  $$(".rail-action").forEach((button) => {
    const view = button.dataset.view;
    const disabled = visible[view] === false;
    button.hidden = disabled;
    button.disabled = disabled;
    button.classList.toggle("is-empty", disabled);
    button.setAttribute("aria-disabled", disabled ? "true" : "false");
    button.title = disabled ? `${panelTitles[view] || view} has no content yet.` : "";
  });
  if (activeView === "materials" && visible[activePanel] === false) {
    activeView = "chat";
    persistNavigationState({ updateUrl: true });
  }
  $$(".rail-action").forEach((button) => {
    const selected = activeView === "chat" ? button.dataset.view === "chat" : button.dataset.view === activePanel;
    button.classList.toggle("is-active", selected);
  });
  $("#chat-view").classList.toggle("is-active", activeView === "chat");
  $("#material-view").classList.toggle("is-active", activeView === "materials");
}

function hydrateColdStartFiles() {
  if (coldDirty || !appState) return;
  const files = appState.cold_start_files || [];
  files.forEach((file) => {
    coldFiles[file.path] = isDefaultBriefTemplate(file.text) ? "" : file.text || "";
  });
  if (!activeColdPath && files.length) activeColdPath = files[0].path;
}

function sessionState() {
  if (optimisticResearchSession) return optimisticResearchSession;
  return appState?.research_session || {};
}

function isSessionRunning() {
  if (isGoalPassed()) return false;
  const session = sessionState();
  const status = String(session.status || "").toLowerCase();
  if (!["running", "stopping"].includes(status)) return false;
  if (session.active_run && session.active_run.running === false) return false;
  return true;
}

function canStopCurrentRun() {
  return isSessionRunning();
}

function isStopCurrentRunPending() {
  return stopRequestPending || String(sessionState().status || "").toLowerCase() === "stopping";
}

function isSessionInterrupted() {
  return String(sessionState().status || "").toLowerCase() === "interrupted";
}

function isFramingRunning() {
  return sessionState().mode === "framing" && isSessionRunning();
}

function hasSession() {
  return Boolean(sessionState().session_id);
}

function shellQuote(value) {
  const text = String(value || "");
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function sessionBackend() {
  const session = sessionState();
  return normalizeAgentBackend(session.backend || session.settings?.backend || activeSettingsBackend());
}

function selectedRunBackend() {
  return isSessionRunning() ? sessionBackend() : effectiveBackend(currentLaunchBackend());
}

function agentResumeCommand() {
  const sessionId = String(sessionState().session_id || "").trim();
  if (!sessionId) return "";
  const repoRoot = String(appState?.repo_root || "").trim();
  const backend = selectedRunBackend();
  if (backend !== sessionBackend()) return "";
  const parts = backend === "claude" ? ["claude", "--resume"] : ["codex", "resume", "--include-non-interactive"];
  if (repoRoot && backend === "codex") parts.push("-C", shellQuote(repoRoot));
  if (repoRoot && backend === "claude") parts.push("--add-dir", shellQuote(repoRoot));
  parts.push(shellQuote(sessionId));
  return parts.join(" ");
}

function codexResumeCommand() {
  return agentResumeCommand();
}

function renderResumeCommandBar() {
  const bar = $("#resume-command-bar");
  const text = $("#resume-command-text");
  if (!bar || !text) return;
  const sessionId = String(sessionState().session_id || "").trim();
  const backend = selectedRunBackend();
  const copyButton = $("#copy-resume-command");
  const label = $("#resume-command-label");
  if (sessionId && backend !== sessionBackend() && !isSessionRunning()) {
    bar.hidden = false;
    if (label) label.textContent = `Next run uses ${agentLabel(backend)} CLI`;
    text.textContent = "new session";
    text.title = "";
    bar.dataset.command = "";
    if (copyButton) copyButton.hidden = true;
    return;
  }
  const command = agentResumeCommand();
  bar.hidden = !command;
  if (label) label.textContent = `Resume in ${agentLabel(backend)} CLI`;
  text.textContent = sessionId ? `session ${sessionId.slice(0, 8)}` : "";
  text.title = command;
  bar.dataset.command = command;
  if (copyButton) copyButton.hidden = false;
}

async function copyResumeCommand() {
  const command = agentResumeCommand();
  if (!command) return;
  await copyTextToClipboard(command, `${agentLabel(sessionBackend())} resume command copied.`);
}

async function copyTextToClipboard(text, successMessage = "Copied.") {
  const value = String(text || "");
  if (!value.trim()) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast(successMessage);
    return true;
  } catch (error) {
    showToast("Could not copy text.", true);
    return false;
  }
}

function markCopyButtonCopied(button) {
  if (!button?.classList?.contains("message-copy-button")) return;
  const defaultLabel = button.dataset.copyDefaultLabel || button.getAttribute("aria-label") || button.title || "Copy response";
  button.dataset.copyDefaultLabel = defaultLabel;
  button.classList.add("is-copied");
  button.innerHTML = checkIconSvg();
  button.setAttribute("aria-label", "Copied");
  button.title = "Copied";
  clearTimeout(button._copyFeedbackTimer);
  button._copyFeedbackTimer = setTimeout(() => {
    button.classList.remove("is-copied");
    button.innerHTML = copyIconSvg();
    button.setAttribute("aria-label", defaultLabel);
    button.title = defaultLabel;
  }, 1800);
}

function hasLaunched() {
  return hasAutoresearchTrajectory();
}

function hasGoalStarted() {
  const session = sessionState();
  const mode = String(session.mode || "").toLowerCase();
  return ["goal", "research"].includes(mode) || Boolean(session.loop_active) || Number(session.loop_iteration || 0) > 0;
}

function expectedTrialMarker() {
  const marker = sessionState().expected_trial || {};
  return marker && typeof marker === "object" ? marker : {};
}

function pendingExpectedTrialIteration() {
  const marker = expectedTrialMarker();
  const status = String(marker.status || "").trim().toLowerCase();
  if (!["pending", "mismatch"].includes(status)) return 0;
  const expected = Number(marker.expected_iteration || 0);
  return Number.isFinite(expected) && expected > 0 ? expected : 0;
}

function latestTrajectoryTrialIteration() {
  const session = sessionState();
  const trajectory = session.trajectory && typeof session.trajectory === "object" ? session.trajectory : {};
  const explicit = trialIterationValue({ id: cleanText(trajectory.latest_active_trial, "") });
  if (explicit > 0) return explicit;
  const loopIteration = Number(session.loop_iteration || 0);
  if (loopIteration > 0) return loopIteration;
  return visibleTrialReports().reduce((latest, trial) => {
    if (trial?.is_closed !== true || !String(trial?.report_path || "").trim()) return latest;
    return Math.max(latest, trialIterationValue(trial));
  }, 0);
}

function hasAutoresearchTrajectory() {
  const session = sessionState();
  const trajectory = session.trajectory && typeof session.trajectory === "object" ? session.trajectory : {};
  return hasGoalStarted()
    || visibleTrials().length > 0
    || Boolean(trajectory.base_trial || trajectory.latest_active_trial);
}

function isGoalPassed() {
  const gate = sessionState().gate || {};
  const status = String(gate.status || gate.raw_status || "").trim().toLowerCase();
  return status === "pass" || status === "passed";
}

function gateHumanResponse() {
  const gate = sessionState().gate || {};
  return cleanText(gate.response_to_human, "");
}

function gateHumanResponseLooksActionable(value) {
  const text = cleanText(value, "");
  if (!text) return false;
  if (/[?？]/.test(text)) return true;
  return /\b(please|should|choose|confirm|approve|review|decide|provide|select|upload|edit|clarify|respond|answer|input|instruction|instructions|required|requires)\b/i.test(text);
}

function gateRequiresHumanResponse() {
  const gate = sessionState().gate || {};
  const response = gateHumanResponse();
  if (!gateHumanResponseLooksActionable(response)) return false;
  const status = String(gate.status || "").trim().toLowerCase();
  const raw = String(gate.raw_status || "").trim().toLowerCase();
  return status === "blocked" || /\b(needs[_\s-]*human|human|clarification)\b/.test(raw);
}

function trialHumanResponseHtml(iteration) {
  const target = Number(iteration || 0);
  if (!target || target !== latestTrajectoryTrialIteration()) return "";
  if (isGoalPassed() || !gateRequiresHumanResponse()) return "";
  return `
    <div class="trial-human-response" role="note">
      <strong>Needs human input</strong>
      <p>${escapeHtml(gateHumanResponse())}</p>
    </div>
  `;
}

function autoresearchCompleteBadgeHtml() {
  return isGoalPassed() ? `<span class="autoresearch-complete-tag">Autoresearch complete</span>` : "";
}

function activeRun() {
  const run = sessionState().active_run || {};
  return typeof run === "object" && run ? run : {};
}

function activeRunWaitState() {
  const wait = activeRun().wait_state || sessionState().agent_wait_state || {};
  return typeof wait === "object" && wait ? wait : {};
}

function activeRunProgress() {
  const progress = activeRun().progress || {};
  return typeof progress === "object" && progress ? progress : {};
}

function activeRunMode() {
  return String(activeRun().mode || sessionState().mode || "").toLowerCase();
}

function activeRunTrialIteration() {
  const value = Number(activeRun().trial_iteration || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isAutoresearchActiveRun() {
  const mode = activeRunMode();
  return Boolean(activeRun().running) && ["goal", "research"].includes(mode) && activeRunTrialIteration() > 0 && !isGoalPassed();
}

function isLiveGoalSession() {
  return isAutoresearchActiveRun();
}

function isTrialReported(report) {
  return cleanText(report?.status, "").toLowerCase() === "reported";
}

function isTrialLive(iteration) {
  const liveIteration = activeRunTrialIteration();
  return isLiveGoalSession() && liveIteration > 0 && Number(iteration) === liveIteration && !activeRun().trajectory_mismatch;
}

function activeRunStatusLabel() {
  const label = String(activeRun().status_label || "").trim();
  if (label) return label;
  const provider = agentLabel(sessionBackend());
  if (isAutoresearchActiveRun()) return `${provider} is working on Trial ${activeRunTrialIteration()}`;
  return `${provider} is working`;
}

function agentWaitStateText(waitState = activeRunWaitState()) {
  const wait = waitState && typeof waitState === "object" ? waitState : {};
  const kind = String(wait.kind || "").toLowerCase();
  const age = Number(wait.last_event_age_seconds);
  const ageText = Number.isFinite(age) ? formatWorkedDuration(age) : "";
  const rawSummary = String(wait.last_event_summary || "").trim();
  const summary = isNoisyAgentLifecycleText(rawSummary) || isNoisyCodexResultText(rawSummary) ? "" : rawSummary;
  if (kind === "rate_limited") {
    return `Rate limit reported${ageText ? ` · last event ${ageText} ago` : ""}`;
  }
  if (kind === "idle") {
    const base = `No agent events${ageText ? ` for ${ageText}` : ""}; process is still running.`;
    if (sessionBackend() === "claude") {
      return `${base} Check Claude provider auth, gateway URL, model name, first-run API key approval, or shell alias configuration.`;
    }
    return base;
  }
  if (kind === "active" && ageText) {
    return `Last event ${ageText} ago${summary ? ` · ${compactText(summary, 140)}` : ""}`;
  }
  return String(wait.message || "").trim();
}

function agentWaitStateHtml(waitState = activeRunWaitState()) {
  const wait = waitState && typeof waitState === "object" ? waitState : {};
  const kind = String(wait.kind || "").toLowerCase();
  if (!["idle", "rate_limited"].includes(kind)) return "";
  const text = agentWaitStateText(wait);
  if (!text) return "";
  return `<p class="run-waiting is-${escapeHtml(kind)}">${escapeHtml(text)}</p>`;
}

function activeRunScopeLabel() {
  const iteration = activeRunTrialIteration();
  if (isAutoresearchActiveRun() && iteration) return `Trial ${iteration} · Running`;
  return "Current run";
}

function queuedChatItems() {
  const items = sessionState().queued_chat_items;
  return Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [];
}

function canQueueComposerWhileRunning() {
  return isSessionRunning() && hasActiveProject();
}

function queuedChatAttachmentCount(item) {
  const clientAttachments = Array.isArray(item?.client_attachments) ? item.client_attachments.length : 0;
  if (clientAttachments) return clientAttachments;
  const attachments = item?.attachments && typeof item.attachments === "object" ? item.attachments : {};
  return ["saved_files", "resource_links", "retained_attachments", "resource_clues", "metadata_files"]
    .reduce((count, key) => count + (Array.isArray(attachments[key]) ? attachments[key].length : 0), 0);
}

function queuedChatDispatchId(items = queuedChatItems()) {
  const priority = items.find((item) => String(item.priority || "") === "send_after_stop");
  return String((priority || items[0] || {}).id || "");
}

function queuedChatSummaryText(item) {
  return compactText(String(item?.text || item?.prepared_message || "Queued message").trim(), 180);
}

function queuedChatItemHtml(item, index, items) {
  const id = String(item?.id || "");
  const active = id && id === queuedChatDispatchId(items);
  const attachments = queuedChatAttachmentCount(item);
  const created = item?.created_at ? formatTimestamp(item.created_at) : "";
  const priority = String(item?.priority || "") === "send_after_stop" ? "Stop and send" : "Queued";
  if (editingQueuedChatId === id) {
    return `
      <div class="queue-item is-editing" data-queue-item="${escapeHtml(id)}">
        <textarea class="queue-edit-textarea" data-queue-edit-text="${escapeHtml(id)}" rows="2">${escapeHtml(String(item.text || ""))}</textarea>
        <div class="queue-edit-actions">
          <button class="secondary-button small-button" type="button" data-queue-edit-cancel="${escapeHtml(id)}">Cancel</button>
          <button class="primary-button small-button" type="button" data-queue-edit-save="${escapeHtml(id)}">Save</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="queue-item ${active ? "is-next" : ""}" draggable="true" data-queue-item="${escapeHtml(id)}" data-queue-index="${escapeHtml(index)}">
      <span class="queue-drag-handle" aria-hidden="true" title="Drag to reorder" data-queue-drag-handle>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"/></svg>
      </span>
      <div class="queue-item-copy">
        <div class="queue-item-text">${escapeHtml(queuedChatSummaryText(item))}</div>
        <div class="queue-item-meta">
          <span>${escapeHtml(priority)}</span>
          ${attachments ? `<span>${escapeHtml(attachments)} attachment${attachments === 1 ? "" : "s"}</span>` : ""}
          ${created ? `<span>${escapeHtml(created)}</span>` : ""}
        </div>
      </div>
      <div class="queue-item-actions">
        <button class="queue-icon-button" type="button" data-queue-move="${escapeHtml(id)}" data-queue-direction="-1" aria-label="Move queued message up" title="Move up"${index === 0 ? " disabled" : ""}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>
        </button>
        <button class="queue-icon-button" type="button" data-queue-move="${escapeHtml(id)}" data-queue-direction="1" aria-label="Move queued message down" title="Move down"${index >= items.length - 1 ? " disabled" : ""}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14m0 0 6-6m-6 6-6-6"/></svg>
        </button>
        <button class="queue-icon-button" type="button" data-queue-edit="${escapeHtml(id)}" aria-label="Edit queued message" title="Edit">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z M13.5 7.5l3 3"/></svg>
        </button>
        <button class="queue-icon-button" type="button" data-queue-delete="${escapeHtml(id)}" aria-label="Delete queued message" title="Delete">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13"/></svg>
        </button>
      </div>
    </div>
  `;
}

function ensureQueuedChatPanel() {
  const workbench = $("#cold-editor-workbench");
  const row = workbench?.querySelector(".brief-composer-row");
  if (!workbench || !row) return null;
  let panel = $("#queue-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "queue-panel";
    panel.className = "queue-panel";
    panel.setAttribute("aria-label", "Queued messages");
    row.insertAdjacentElement("beforebegin", panel);
  }
  return panel;
}

function ensureQueueActionMenu() {
  const row = $("#brief-editor-shell .brief-composer-row");
  const send = $("#prepare-cold-start");
  if (!row || !send) return null;
  let button = $("#queue-action-menu-toggle");
  if (!button) {
    button = document.createElement("button");
    button.id = "queue-action-menu-toggle";
    button.className = "queue-action-menu-toggle";
    button.type = "button";
    button.dataset.queueActionMenuToggle = "true";
    button.setAttribute("aria-label", "Queue send options");
    button.setAttribute("aria-haspopup", "menu");
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m7 10 5 5 5-5"/></svg>';
    send.insertAdjacentElement("beforebegin", button);
  }
  let menu = $("#queue-action-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "queue-action-menu";
    menu.className = "queue-action-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button type="button" role="menuitem" data-queue-action="queue">Queue</button>
      <button type="button" role="menuitem" data-queue-action="stop-send">Stop and Send</button>
    `;
    button.insertAdjacentElement("afterend", menu);
  }
  return { button, menu };
}

function renderQueuedChatPanel() {
  const items = queuedChatItems();
  const panel = ensureQueuedChatPanel();
  if (!panel) return;
  const visible = items.slice(0, 3);
  const extra = Math.max(0, items.length - visible.length);
  panel.hidden = !items.length;
  panel.innerHTML = items.length
    ? `
      <div class="queue-panel-inner">
        <div class="queue-panel-head">
          <span>Queued</span>
          <strong>${escapeHtml(items.length)} message${items.length === 1 ? "" : "s"}</strong>
        </div>
        <div class="queue-list">
          ${visible.map((item, index) => queuedChatItemHtml(item, index, items)).join("")}
        </div>
        ${extra ? `<div class="queue-more">${escapeHtml(extra)} more queued</div>` : ""}
      </div>
    `
    : "";
  requestAnimationFrame(updateBriefDockGeometry);
}

function ensureProjectLaunchFallbackPanel() {
  const workbench = $("#cold-editor-workbench");
  const row = workbench?.querySelector(".brief-composer-row");
  if (!workbench || !row) return null;
  let panel = $("#project-launch-fallback");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "project-launch-fallback";
    panel.className = "project-launch-fallback";
    panel.setAttribute("aria-label", "PROJECT.md launch action");
    const queuePanel = ensureQueuedChatPanel();
    if (queuePanel) queuePanel.insertAdjacentElement("afterend", panel);
    else row.insertAdjacentElement("beforebegin", panel);
  }
  return panel;
}

function projectFooterIsAttached(messages = []) {
  return (Array.isArray(messages) ? messages : []).some((message) => message?.attachedProjectDraft);
}

function renderProjectLaunchFallbackPanel(show) {
  const panel = ensureProjectLaunchFallbackPanel();
  if (!panel) return;
  const message = currentProjectDraftFooterMessage();
  const shouldShow = Boolean(show && message && !isProjectLoading() && prelaunchAffordanceState().showStart);
  panel.hidden = !shouldShow;
  panel.innerHTML = shouldShow
    ? `
      <div class="project-launch-fallback-inner">
        <span>PROJECT.md ready</span>
        ${projectDraftActionsHtml(message, { label: "" })}
      </div>
    `
    : "";
  requestAnimationFrame(updateBriefDockGeometry);
}

function renderQueueActionMenu() {
  const controls = ensureQueueActionMenu();
  if (!controls) return;
  const show = canQueueComposerWhileRunning() && coldComposerHasSendableContent();
  controls.button.hidden = !show;
  controls.menu.hidden = !show || !queueActionMenuOpen;
  controls.button.setAttribute("aria-expanded", show && queueActionMenuOpen ? "true" : "false");
}

function normalUserFramingMessages(messages = localMessages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === "user" && !isControlFramingMessage(message) && String(message.text || "").trim());
}

function latestNormalUserFramingMessage(messages = localMessages) {
  const items = normalUserFramingMessages(messages);
  return items.length ? items[items.length - 1] : null;
}

function latestProjectDraftTimestamp() {
  const message = latestProjectMessage();
  return message ? framingMessageTime(message, 0) : 0;
}

function isPrelaunchPhase() {
  if (isProjectLoading()) return false;
  if (!hasActiveProject()) return false;
  if (isSessionRunning()) return false;
  if (isGoalPassed()) return false;
  if (hasGoalStarted()) return false;
  if (visibleTrials().length > 0) return false;
  if (hasAutoresearchTrajectory()) return false;
  return true;
}

function prelaunchBlockReason() {
  if (hasBlockingResourceImports()) return blockingResourceImportMessage();
  const blockedAgent = launchBlockingStatus();
  if (blockedAgent) return blockedAgent.message || `${agentLabel(effectiveBackend(currentLaunchBackend()))} is not ready.`;
  return "";
}

function prelaunchAffordanceState() {
  if (!isPrelaunchPhase()) return { state: "hidden", hidden: true };
  const draftReady = hasProjectDraftReady();
  if (!draftReady) return { state: "hidden", hidden: true };
  const blockedReason = prelaunchBlockReason();
  if (blockedReason) {
    return {
      state: "blocked",
      hidden: false,
      title: "PROJECT.md ready",
      detail: blockedReason,
      primaryLabel: "Start autoresearch",
      primaryAction: "start",
      disabled: true,
      showStart: draftReady,
      reason: blockedReason,
    };
  }
  return {
    state: "ready",
    hidden: false,
    title: "PROJECT.md ready",
    detail: "Review settings, then start autoresearch.",
    primaryLabel: "Start autoresearch",
    primaryAction: "start",
    showStart: true,
  };
}

function updateQueuedChatSessionFromPayload(payload) {
  const session =
    payload?.result?.session ||
    payload?.session ||
    payload?.result?.result?.session ||
    null;
  const queueSummary =
    (Array.isArray(payload?.result?.queued_chat_items) ? payload.result : null) ||
    (Array.isArray(payload?.queued_chat_items) ? payload : null) ||
    (Array.isArray(payload?.result?.result?.queued_chat_items) ? payload.result.result : null);
  if (session) {
    if (!appState) appState = {};
    appState.research_session = {
      ...session,
      ...(queueSummary || {}),
    };
  } else if (queueSummary) {
    if (!appState) appState = {};
    const current = appState.research_session || {};
    appState.research_session = {
      ...current,
      ...queueSummary,
    };
  }
  renderComposerActionButtons();
  renderComposerSuggestions();
}

async function reorderQueuedChatItems(ids) {
  const response = await api("/api/research/queue/reorder", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  updateQueuedChatSessionFromPayload(response);
  return response;
}

function queuedChatIds() {
  return queuedChatItems().map((item) => String(item.id || "")).filter(Boolean);
}

async function moveQueuedChatItem(id, direction) {
  const ids = queuedChatIds();
  const index = ids.indexOf(String(id || ""));
  const target = index + Number(direction || 0);
  if (index < 0 || target < 0 || target >= ids.length) return;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  await reorderQueuedChatItems(next);
}

async function saveQueuedChatEdit(id) {
  const textarea = document.querySelector(`[data-queue-edit-text="${CSS.escape(id)}"]`);
  const text = String(textarea?.value || "").trim();
  if (!text) {
    showToast("Queued message text is required.", true);
    return;
  }
  const response = await api("/api/research/queue", {
    method: "PATCH",
    body: JSON.stringify({ id, text }),
  });
  editingQueuedChatId = "";
  updateQueuedChatSessionFromPayload(response);
  showToast("Updated queued message.");
}

async function deleteQueuedChatItem(id) {
  const response = await api("/api/research/queue", {
    method: "DELETE",
    body: JSON.stringify({ id }),
  });
  if (editingQueuedChatId === id) editingQueuedChatId = "";
  updateQueuedChatSessionFromPayload(response);
  showToast("Removed queued message.");
}

async function queueCurrentComposerMessage(priority = "normal") {
  const text = String($("#cold-file-editor")?.value || "").trim();
  return sendSessionComposerMessage(text, { forceQueue: true, queuePriority: priority });
}

function activeRunActivityDetailsKey() {
  const run = activeRun();
  const session = sessionState();
  return [
    "current",
    activeProjectId || appState?.active_project_id || "",
    String(run.run_id || session.run_id || session.id || session.session_id || ""),
    String(run.started_at || session.started_at || ""),
    String(run.trial_iteration || ""),
  ].join(":");
}

function runActivityOpenAttribute(key) {
  return openRunActivityDetails.has(key) ? " open" : "";
}

function autoresearchPanelCollapsed() {
  return scopedGet(AUTORESEARCH_PANEL_COLLAPSED_KEY, "false", { legacyFallback: false }) === "true";
}

function setAutoresearchPanelCollapsed(collapsed) {
  scopedSet(AUTORESEARCH_PANEL_COLLAPSED_KEY, collapsed ? "true" : "false");
}

function toggleAutoresearchPanelCollapsed() {
  const collapsed = !autoresearchPanelCollapsed();
  setAutoresearchPanelCollapsed(collapsed);
  renderFramingConversation();
  if (!collapsed) requestAnimationFrame(restoreTrialStripScroll);
}

function rememberRunActivityDetailsState(details) {
  const key = details?.dataset?.runActivityDetails || "";
  if (!key) return;
  if (details.open) openRunActivityDetails.add(key);
  else openRunActivityDetails.delete(key);
}

function canPauseActiveRunAfterCurrentTurn() {
  return isAutoresearchActiveRun();
}

function runControlButtonsHtml() {
  if (!isSessionRunning()) return "";
  return canPauseActiveRunAfterCurrentTurn()
    ? `<button class="secondary-button small-button current-run-control-button" type="button" data-pause-autoresearch>Pause after current turn</button>`
    : "";
}

function composerSendIconHtml() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>';
}

function composerStopIconHtml() {
  return '<span class="composer-stop-square" aria-hidden="true"></span>';
}

function syncComposerActionButton(button, { stopMode, disabled, sendHtml, sendLabel = "Send" } = {}) {
  if (!button) return;
  const stopping = isStopCurrentRunPending();
  button.classList.toggle("is-stop-mode", Boolean(stopMode));
  button.dataset.stopMode = stopMode ? "true" : "false";
  button.disabled = stopMode ? stopping : Boolean(disabled);
  button.setAttribute("aria-label", stopMode ? "Stop answering" : sendLabel);
  button.title = stopMode ? (stopping ? "Stopping..." : "Stop answering") : sendLabel;
  button.innerHTML = stopMode ? composerStopIconHtml() : sendHtml;
}

function coldComposerHasSendableContent() {
  return Boolean(
    String($("#cold-file-editor")?.value || "").trim() ||
    currentComposerAttachments().length ||
    selectedResumeTrialPayload()
  );
}

function chatComposerHasSendableContent() {
  return Boolean(
    String($("#chat-form textarea")?.value || "").trim() ||
    currentComposerAttachments().length ||
    selectedResumeTrialPayload()
  );
}

function renderComposerActionButtons() {
  renderComposerModeControls();
  const queueMode = canQueueComposerWhileRunning();
  const resourceBlocked = hasBlockingResourceImports();
  const blockedMessage = blockingResourceImportMessage();
  const loading = isProjectLoading();
  const coldStopMode = canStopCurrentRun() && !coldComposerHasSendableContent();
  syncComposerActionButton($("#prepare-cold-start"), {
    stopMode: coldStopMode,
    disabled: hasNoProject() || resourceBlocked || loading,
    sendHtml: composerSendIconHtml(),
    sendLabel: queueMode ? "Queue follow-up" : "Send",
  });
  const coldButton = $("#prepare-cold-start");
  if (coldButton && !coldStopMode) {
    if (resourceBlocked) coldButton.title = blockedMessage;
    else if (queueMode) coldButton.title = "Queue follow-up";
    coldButton.dataset.queueMode = queueMode ? "true" : "false";
  }

  const send = $("#chat-form .send-button");
  const chatStopMode = canStopCurrentRun() && !chatComposerHasSendableContent();
  syncComposerActionButton(send, {
    stopMode: chatStopMode,
    disabled: !(canMessage() || queueMode) || resourceBlocked || hasNoProject() || loading,
    sendHtml: queueMode ? "Queue" : "Send",
    sendLabel: queueMode ? "Queue follow-up" : "Send",
  });
  if (send) {
    send.type = "submit";
    if (!chatStopMode) {
      if (resourceBlocked) send.title = blockedMessage;
      else if (queueMode) send.title = "Queue follow-up";
    }
  }
  renderQueuedChatPanel();
  renderQueueActionMenu();
}

function canMessage() {
  if (isProjectLoading()) return false;
  return hasLaunched() && hasSession() && !isSessionRunning();
}

function canChatWithProjectDraft() {
  if (isProjectLoading()) return false;
  return hasProjectDraftReady() && !isSessionRunning();
}

function canChatWithFramingDraft() {
  const session = sessionState();
  const mode = String(session.mode || "").toLowerCase();
  return mode === "framing" && hasProjectDraftReady() && hasSession() && !isSessionRunning();
}

function canChatBeforeProjectDraft() {
  const mode = String(sessionState().mode || "").toLowerCase();
  return (
    !isSessionRunning() &&
    !hasProjectDraftReady() &&
    !hasAutoresearchTrajectory() &&
    !["goal", "research", "command"].includes(mode)
  );
}

function canSendSessionComposerMessage() {
  return canMessage() || canChatWithFramingDraft() || canChatWithProjectDraft() || canChatBeforeProjectDraft();
}

function isTruePreProjectBriefResend(index) {
  if (!Number.isInteger(Number(index)) || Number(index) < 0) return false;
  const message = localMessages[Number(index)];
  return Boolean(message?.kind === "project-brief");
}

function isLocalSlashControl(text) {
  const normalized = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  return localSlashCommandSet.has(normalized);
}

function canSendLocalSlashControl(text) {
  const normalized = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!isLocalSlashControl(normalized)) return false;
  if (localSlashCommandRegistry[normalized]?.requiresSession) return hasLaunched() && hasSession();
  return true;
}

function canQueueChatDuringAutoresearchRun(text, attachments, resumeFromTrial) {
  return (
    isSessionRunning() &&
    !resumeFromTrial &&
    !String(text || "").trim().startsWith("/") &&
    Array.isArray(attachments) &&
    (String(text || "").trim() || attachments.length)
  );
}

function isUiLocalTranscript(entry) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  return rawType.startsWith("ui.command") || rawType === "ui.file_edit";
}

function isHiddenUiTranscript(entry) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  return rawType === "ui.cold_start" || rawType === "ui.file_edit";
}

function prepareFingerprint() {
  const paths = (appState?.cold_start_files || []).map((file) => file.path);
  const knownPaths = paths.length ? paths : Object.keys(coldFiles);
  return JSON.stringify([...knownPaths].sort().map((path) => [path, coldFiles[path] ?? ""]));
}

function restorePrepareSaved() {
  const stored = scopedGet("autoResearchPrepareFingerprint", "");
  prepareSaved = Boolean(stored && stored === prepareFingerprint());
}

function canOpenStage(stage) {
  const target = String(stage || "1");
  if (target === "1") return true;
  if (target === "2") return prepareSaved || hasProjectDraftReady() || hasLaunched();
  if (target === "3") return hasLaunched();
  return false;
}

function stageBlockedMessage(stage) {
  const target = String(stage || "1");
  if (target === "2") return "Save the brief before launch.";
  if (target === "3") return "Launch autoresearch before opening chat.";
  return "This step is not available yet.";
}

function markPrepareSaved(value) {
  prepareSaved = Boolean(value);
  if (prepareSaved) scopedSet("autoResearchPrepareFingerprint", prepareFingerprint());
  else scopedRemove("autoResearchPrepareFingerprint");
  renderStage();
}

function currentProjectDraft() {
  const projectMessage = latestProjectMessage();
  if (projectMessage?.artifact?.text) return String(projectMessage.artifact.text || "");
  const stateDraft = String(appState?.files?.project?.text || "");
  const editor = $("#project-draft-editor");
  const editorDraft = String(editor?.value || "");
  if (editorDraft.trim()) return editorDraft;
  return stateDraft;
}

function hasProjectDraftReady() {
  const draft = currentProjectDraft();
  return Boolean(draft.trim()) && !isPlaceholderProject(draft);
}

function projectDraftFromBrief() {
  const targetVenue = String($("#target-venue")?.value || "").trim();
  return buildProjectDraft(currentBriefText(), targetVenue);
}

function applyFramingMessageToDraft(message) {
  const text = String(message || "").trim();
  if (!text) return "";
  const current = currentProjectDraft();
  let next = "";
  if (!current.trim() || isPlaceholderProject(current)) {
    next = projectDraftFromBrief();
  } else if (!current.includes("## User Refinement Notes")) {
    next = `${current.trim()}\n\n---\n\n## User Refinement Notes\n\n- ${text}\n`;
  } else {
    next = `${current.trim()}\n- ${text}\n`;
  }
  setHiddenProjectDraft(next);
  projectDraftDirty = true;
  return next;
}

function updateProjectDraftPreview() {
  const preview = $("#project-draft-preview");
  if (!preview) return;
  preview.innerHTML = markdownToHtml(currentProjectDraft());
}

function renderProjectDraft(force = false) {
  const editor = $("#project-draft-editor");
  if (!editor || !appState) return;
  const focused = document.activeElement === editor;
  if (focused && projectDraftDirty && !force) return;
  const existing = appState.files?.project?.text || "";
  const draft = isPlaceholderProject(existing) ? (force ? projectDraftFromBrief() : "") : existing;
  const before = editor.value;
  if (force || !projectDraftDirty || !editor.value.trim()) setHiddenProjectDraft(draft);
  else updateProjectDraftPreview();
  if (force || before !== editor.value) renderFramingConversation();
}

async function saveProjectDraft(options = {}) {
  const { silent = false } = options;
  const text = currentProjectDraft().trim();
  if (!text) throw new Error("Project draft is empty.");
  await api("/api/file/save", {
    method: "POST",
    body: JSON.stringify({ path: "PROJECT.md", text, record: false }),
  });
  projectDraftDirty = false;
  if (!silent) showToast("PROJECT.md draft saved.");
}

async function saveFramingMessages() {
  return api("/api/framing/messages", {
    method: "POST",
    body: JSON.stringify({ clientVersion: FRAMING_MESSAGES_CLIENT_VERSION, messages: localMessages.slice(-80) }),
  });
}

function persistFramingMessages() {
  const version = ++framingMessagesSaveVersion;
  framingMessagesPersisting = true;
  return saveFramingMessages().finally(() => {
    if (version === framingMessagesSaveVersion) framingMessagesPersisting = false;
  });
}

function framingMessagesSignature(messages) {
  return JSON.stringify(
    (messages || []).map((message) => ({
      id: message.id,
      role: message.role,
      kind: message.kind,
      text: message.text,
      attachments: message.attachments || [],
      artifact: message.artifact ? { path: message.artifact.path, text: message.artifact.text } : null,
      resumeFromTrial: message.resumeFromTrial || null,
    }))
  );
}

function replaceFramingMessagesIfChanged(nextMessages) {
  const next = nextMessages.filter(Boolean);
  if (framingMessagesSignature(next) === framingMessagesSignature(localMessages)) return false;
  localMessages.splice(0, localMessages.length, ...next);
  lastFramingHtml = "";
  return true;
}

function framingMessageDedupeKey(message) {
  return [
    String(message?.role || ""),
    String(message?.text || "").trim(),
    String(message?.resumeFromTrial?.id || ""),
    String(message?.resumeFromTrial?.path || ""),
    String(message?.artifact?.path || ""),
    String(message?.artifact?.id || ""),
    String(message?.artifact?.text || "").trim(),
    String(message?.artifact?.plan_text || "").trim(),
  ].join("\n");
}

function isAssistantFramingMessage(message) {
  return message?.role === "assistant" && message.kind !== "project";
}

function framingMessageTime(message, fallback) {
  const value = Date.parse(String(message?.created_at || ""));
  return Number.isFinite(value) ? value : fallback;
}

function beginFramingPending(messageId = "") {
  framingPendingSince = Date.now();
  if (messageId) pendingFramingUserMessageId = messageId;
}

function messageHasAssistantAfter(messageId, messages = localMessages) {
  const index = messages.findIndex((message) => message?.id === messageId && message.role === "user");
  if (index < 0) return false;
  const nextUserIndex = messages.findIndex((message, itemIndex) => itemIndex > index && message?.role === "user");
  const endIndex = nextUserIndex < 0 ? messages.length : nextUserIndex;
  return messages.slice(index + 1, endIndex).some((message) => message?.role === "assistant" && message.kind !== "project");
}

function isControlFramingMessage(message) {
  const text = String(message?.text || "").trim();
  return message?.kind === "command" || message?.kind === "goal-launch" || text.startsWith("/") || isGoalLaunchMessage(message);
}

function latestUnansweredUserMessage(messages = localMessages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (isControlFramingMessage(message)) continue;
    const hasReply = messages.slice(index + 1).some((item) => item?.role === "assistant" && item.kind !== "project");
    return hasReply ? null : message;
  }
  return null;
}

function reconcileFramingPending(messages = localMessages) {
  const session = sessionState();
  const terminalStatus = ["completed", "failed", "interrupted", "idle"].includes(String(session.status || "").toLowerCase());
  if (!isSessionRunning() && terminalStatus) {
    framingDraftPending = false;
    framingReplyPending = false;
    pendingFramingUserMessageId = "";
  }
  if (framingReplyPending && pendingFramingUserMessageId && messageHasAssistantAfter(pendingFramingUserMessageId, messages)) {
    framingReplyPending = false;
    pendingFramingUserMessageId = "";
  }
  if (framingReplyPending && !latestUnansweredUserMessage(messages)) {
    framingReplyPending = false;
    pendingFramingUserMessageId = "";
  }
  if (!framingReplyPending && !framingDraftPending && !isSessionRunning()) {
    framingPendingSince = 0;
  }
}

function editedTranscriptCutWindows(messages) {
  return messages
    .filter((message) => message?.role === "user" && message.edited_at)
    .map((message) => {
      const start = Date.parse(String(message.created_at || ""));
      const end = Date.parse(String(message.edited_at || ""));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      return { start, end };
    })
    .filter(Boolean);
}

function transcriptEntryTime(entry) {
  const value = Date.parse(String(entry?.created_at || ""));
  return Number.isFinite(value) ? value : 0;
}

function isEntryInsideEditedCut(entry, windows) {
  const value = transcriptEntryTime(entry);
  return Boolean(value && windows.some((window) => value >= window.start && value < window.end));
}

function mergePendingLocalFramingMessages(nextMessages) {
  if (!localMessages.length || !(framingMessagesPersisting || framingDraftPending || framingReplyPending || isSessionRunning())) {
    return nextMessages;
  }
  const nextIds = new Set(nextMessages.map((message) => String(message?.id || "")).filter(Boolean));
  const nextKeys = new Set(nextMessages.map(framingMessageDedupeKey));
  const pending = localMessages.filter((message) => {
    if (!message || (message.role !== "user" && message.kind !== "intervention-recorded")) return false;
    if (isDefaultBriefTemplate(message.text)) return false;
    const id = String(message.id || "");
    if (id && nextIds.has(id)) return false;
    return !nextKeys.has(framingMessageDedupeKey(message));
  });
  if (!pending.length) return nextMessages;
  return [...nextMessages, ...pending].sort((a, b) => framingMessageTime(a, 0) - framingMessageTime(b, 0));
}

function isFramingThreadUserTranscript(entry) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  const role = String(entry?.role || "").toLowerCase();
  const text = String(entry?.content || "").trim();
  return ["ui.framing", "ui.chat", "ui.plan"].includes(rawType) && role === "user" && text && !isDefaultBriefTemplate(text);
}

function transcriptFramingMessageId(entry) {
  const id = String(entry?.id || "").trim();
  return id ? `framing-${id.slice(0, 80)}` : "";
}

function isAssistantReplyCandidate(entry, cutWindows) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  const role = String(entry?.role || "").toLowerCase();
  const content = String(entry?.content || "").trim();
  const replyRawType =
    rawType === "assistant" ||
    rawType.startsWith("assistant.") ||
    rawType === "result" ||
    rawType.startsWith("result.") ||
    ["item.completed", "turn.completed"].includes(rawType);
  return (
    content &&
    !isEntryInsideEditedCut(entry, cutWindows) &&
    ["assistant", "final"].includes(role) &&
    replyRawType
  );
}

function hasAssistantReplyBetweenTimes(start, end, messages, transcript, cutWindows) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);
  const messageReply = messages.some((message) => {
    if (!isAssistantFramingMessage(message)) return false;
    const value = framingMessageTime(message, 0);
    return value > lower && value < upper;
  });
  if (messageReply) return true;
  return transcript.some((entry) => {
    if (!isAssistantReplyCandidate(entry, cutWindows)) return false;
    const value = transcriptEntryTime(entry);
    return value > lower && value < upper;
  });
}

function isDuplicateRecoveredUserMessage(message, existingMessages, transcript, cutWindows) {
  const id = String(message?.id || "");
  if (id && existingMessages.some((item) => String(item?.id || "") === id)) return true;
  const key = framingMessageDedupeKey(message);
  const candidateTime = framingMessageTime(message, 0);
  return existingMessages.some((existing) => {
    if (framingMessageDedupeKey(existing) !== key) return false;
    const existingTime = framingMessageTime(existing, 0);
    if (hasAssistantReplyBetweenTimes(existingTime, candidateTime, existingMessages, transcript, cutWindows)) return false;
    return true;
  });
}

function transcriptReplyWindows(cutWindows) {
  const transcript = Array.isArray(sessionState().transcript) ? sessionState().transcript : [];
  const runStarts = transcript
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => transcriptRunStart(entry) && !isEntryInsideEditedCut(entry, cutWindows));
  return runStarts.flatMap(({ entry, index }, itemIndex) => {
    if (!isFramingThreadUserTranscript(entry)) return [];
    const nextUserIndex = runStarts[itemIndex + 1]?.index ?? transcript.length;
    const completed = nextUserIndex < transcript.length || !isSessionRunning();
    const candidates = transcript.slice(index + 1, nextUserIndex).filter((candidate) => isAssistantReplyCandidate(candidate, cutWindows));
    return [{
      entry,
      index,
      nextUserIndex,
      completed,
      candidates,
      finalEntry: completed && candidates.length ? candidates[candidates.length - 1] : null,
    }];
  });
}

function pruneNonFinalRecoveredAssistantMessages(messages) {
  const cutWindows = editedTranscriptCutWindows(messages);
  const windows = transcriptReplyWindows(cutWindows);
  const finalIds = new Set(windows.map((window) => transcriptFramingMessageId(window.finalEntry)).filter(Boolean));
  const finalTexts = new Set(windows.map((window) => normalizedTranscriptText(window.finalEntry?.content)).filter(Boolean));
  const staleIds = new Set();
  const staleTexts = new Set();
  windows.forEach((window) => {
    const finalId = transcriptFramingMessageId(window.finalEntry);
    const finalText = normalizedTranscriptText(window.finalEntry?.content);
    window.candidates.forEach((candidate) => {
      const id = transcriptFramingMessageId(candidate);
      const text = normalizedTranscriptText(candidate?.content);
      if (id && id !== finalId) staleIds.add(id);
      if (text && text !== finalText) staleTexts.add(text);
    });
  });
  if (!staleIds.size && !staleTexts.size) return messages;
  return messages.filter((message) => {
    const id = String(message?.id || "");
    if (message.role !== "assistant" || message.kind === "project" || message.kind === "plan") return true;
    if (finalIds.has(id)) return true;
    if (staleIds.has(id)) return false;
    const text = normalizedTranscriptText(message.text);
    return !(staleTexts.has(text) && !finalTexts.has(text));
  });
}

function recoveredFramingMessagesFromSession(existingMessages) {
  const transcript = Array.isArray(sessionState().transcript) ? sessionState().transcript : [];
  if (!transcript.length) return [];
  const existingKeys = new Set(existingMessages.map(framingMessageDedupeKey));
  const existingIds = new Set(existingMessages.map((message) => String(message?.id || "")).filter(Boolean));
  const cutWindows = editedTranscriptCutWindows(existingMessages);
  const messagesWithRecovered = existingMessages.slice();
  const recovered = transcript
    .map((entry) => {
      const text = String(entry?.content || "").trim();
      if (!isFramingThreadUserTranscript(entry)) return null;
      if (isEntryInsideEditedCut(entry, cutWindows)) return null;
      const message = normalizeFramingMessage({
        id: transcriptFramingMessageId(entry) || newMessageId("user"),
        role: "user",
        kind: "text",
        text,
        created_at: String(entry?.created_at || new Date().toISOString()),
      });
      if (!message || isDuplicateRecoveredUserMessage(message, messagesWithRecovered, transcript, cutWindows)) return null;
      existingIds.add(message.id);
      existingKeys.add(framingMessageDedupeKey(message));
      messagesWithRecovered.push(message);
      return message;
    })
    .filter(Boolean);
  transcriptReplyWindows(cutWindows).forEach(({ entry, finalEntry }) => {
    const text = String(entry?.content || "").trim();
    if (!text || !finalEntry) return;
    if (finalEntry) {
      const message = normalizeFramingMessage({
        id: transcriptFramingMessageId(finalEntry) || newMessageId("assistant"),
        role: "assistant",
        kind: "text",
        text: String(finalEntry.content || "").trim(),
        created_at: String(finalEntry?.created_at || new Date().toISOString()),
      });
      if (message && !existingIds.has(message.id) && !existingKeys.has(framingMessageDedupeKey(message))) {
        existingIds.add(message.id);
        existingKeys.add(framingMessageDedupeKey(message));
        messagesWithRecovered.push(message);
        recovered.push(message);
      }
    }
  });
  return recovered;
}

function sortFramingMessagesByTime(messages) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const delta = framingMessageTime(a.message, a.index) - framingMessageTime(b.message, b.index);
      return delta || a.index - b.index;
    })
    .map((item) => item.message);
}

function latestProjectIndex(messages = localMessages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isProjectDraftMessage(messages[index])) return index;
  }
  return -1;
}

function planMessageFromArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return null;
  const id = String(artifact.id || "").trim();
  if (!id) return null;
  const text = String(artifact.plan_text || artifact.text || artifact.error || "Planning...").trim();
  return normalizeFramingMessage({
    id: `plan-${id}`,
    role: "assistant",
    kind: "plan",
    text,
    created_at: String(artifact.created_at || new Date().toISOString()),
    artifact: {
      type: "plan",
      id,
      provider: artifact.provider || "",
      model: artifact.model || "",
      status: artifact.status || "pending",
      text,
      plan_text: artifact.plan_text || artifact.text || "",
      steps: Array.isArray(artifact.steps) ? artifact.steps : [],
      explanation: artifact.explanation || "",
      error: artifact.error || "",
      created_at: artifact.created_at || "",
      updated_at: artifact.updated_at || "",
      approved_at: artifact.approved_at || "",
      implemented_run_id: artifact.implemented_run_id || "",
    },
  });
}

function latestPlanMessageIndex(messages = localMessages, planId = "") {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.kind !== "plan") continue;
    if (!planId || String(message.artifact?.id || "") === String(planId)) return index;
  }
  return -1;
}

function upsertLatestPlanMessage(messages, planArtifact = null) {
  const latestPlan = planArtifact || appState?.research_session?.latest_plan || appState?.latest_plan || {};
  const message = planMessageFromArtifact(latestPlan);
  if (!message) return false;
  const index = latestPlanMessageIndex(messages, message.artifact?.id || "");
  if (index >= 0) {
    if (JSON.stringify(messages[index].artifact || {}) !== JSON.stringify(message.artifact || {})) {
      messages[index] = { ...messages[index], ...message };
      return true;
    }
    return false;
  }
  messages.push(message);
  return true;
}

function isGoalLaunchMessage(message) {
  const text = String(message?.text || "").trim().toLowerCase();
  return message?.role === "user" && (
    message.kind === "goal-launch" ||
    text === "start autoresearch." ||
    text === "start autoresearch" ||
    text === "start autoresearch loop." ||
    text === "start autoresearch loop"
  );
}

function hasGoalLaunchMessage(messages = localMessages) {
  return messages.some(isGoalLaunchMessage);
}

function goalLaunchMessage() {
  return normalizeFramingMessage({
    id: newMessageId("goal-launch"),
    role: "user",
    kind: "goal-launch",
    text: "Start autoresearch.",
    created_at: new Date().toISOString(),
  });
}

function pruneStaleGoalLaunchMessages(messages) {
  if (framingDraftPending || isSessionRunning() || hasGoalStarted() || visibleTrials().length) return messages;
  return messages.filter((message) => !isGoalLaunchMessage(message));
}

function restoreFramingMessages() {
  let nextMessages = [];
  const serverMessages = appState?.framing?.messages || [];
  let shouldPersist = false;
  const savedBrief = String(coldFiles["resources/user_input/INITIAL_BRIEF.md"] || "").trim();
  if (Array.isArray(serverMessages)) {
    for (const rawMessage of serverMessages) {
      const message = normalizeFramingMessage(rawMessage);
      if (!message) continue;
      if (message.role === "user" && isDefaultBriefTemplate(message.text)) {
        shouldPersist = true;
        continue;
      }
      nextMessages.push(message);
    }
  }
  const prunedMessages = pruneNonFinalRecoveredAssistantMessages(nextMessages);
  if (prunedMessages.length !== nextMessages.length) {
    nextMessages = prunedMessages;
    shouldPersist = true;
  }
  const recoveredMessages = recoveredFramingMessagesFromSession(nextMessages);
  if (recoveredMessages.length) {
    nextMessages.push(...recoveredMessages);
    shouldPersist = true;
  }
  const projectText = String(appState?.files?.project?.text || "").trim();
  const framingInProgress = framingDraftPending || isFramingRunning();
  if (!framingInProgress && projectText && !isPlaceholderProject(projectText)) {
    const projectIndex = latestProjectIndex(nextMessages);
    if (projectIndex >= 0) {
      const existing = nextMessages[projectIndex];
      if (existing.artifact?.text !== projectText) {
        nextMessages[projectIndex] = {
          ...existing,
          text: existing.text || "I drafted PROJECT.md. Review it here, edit it directly, or keep chatting to refine the framing.",
          artifact: { path: "PROJECT.md", text: projectText },
        };
        shouldPersist = true;
      }
    } else {
      nextMessages.push({
        id: newMessageId("project"),
        role: "assistant",
        kind: "project",
        text: "I drafted PROJECT.md. Review it here, edit it directly, or keep chatting to refine the framing.",
        created_at: new Date().toISOString(),
        artifact: { path: "PROJECT.md", text: projectText },
      });
      shouldPersist = true;
    }
  }
  if (upsertLatestPlanMessage(nextMessages)) shouldPersist = true;
  if (!hasGoalLaunchMessage(nextMessages) && (hasGoalStarted() || visibleTrials().length)) {
    const message = goalLaunchMessage();
    if (message) {
      const projectIndex = latestProjectIndex(nextMessages);
      nextMessages.splice(projectIndex >= 0 ? projectIndex + 1 : nextMessages.length, 0, message);
      shouldPersist = true;
    }
  }
  const prunedGoalMessages = pruneStaleGoalLaunchMessages(nextMessages);
  if (prunedGoalMessages.length !== nextMessages.length) {
    nextMessages = prunedGoalMessages;
    shouldPersist = true;
  }
  const sortedMessages = sortFramingMessagesByTime(mergePendingLocalFramingMessages(nextMessages));
  const restoredMessages = collapseProjectDraftMessages(sortedMessages);
  if (restoredMessages.length !== sortedMessages.length) shouldPersist = true;
  replaceFramingMessagesIfChanged(restoredMessages);
  reconcileFramingPending(localMessages);
  const lastUser = [...localMessages].reverse().find((message) => message.role === "user");
  const brief = savedBrief;
  const hasMessageAttachments = localMessages.some((message) => Array.isArray(message.attachments) && message.attachments.length);
  if (lastUser && brief && String(lastUser.text || "").trim() === brief && selectedResourceItems.length && !hasMessageAttachments) {
    lastUser.attachments = currentComposerAttachments();
    sentFramingResourceItems.push(...selectedResourceItems.map((item) => ({ ...item })));
    selectedResourceItems.splice(0);
    saveResourceSelections();
    renderSelectedResources();
    persistFramingMessages().catch(() => {});
  }
  if (shouldPersist) persistFramingMessages().catch(() => {});
  const projectMessage = latestProjectMessage();
  setHiddenProjectDraft(projectMessage?.artifact?.text || "");
}

function appendFramingMessage(role, text, extras = {}) {
  const message = normalizeFramingMessage({ id: newMessageId(role), role, text, ...extras });
  if (!message) return null;
  localMessages.push(message);
  lastFramingHtml = "";
  persistFramingMessages().catch((error) => showToast(error.message, true));
  renderFramingConversation();
  return message;
}

function removeFramingMessage(id) {
  const index = localMessages.findIndex((message) => message.id === id);
  if (index >= 0) {
    localMessages.splice(index, 1);
    lastFramingHtml = "";
  }
}

function appendProjectDraftMessage(text, summary = "I drafted PROJECT.md. Review it here, edit it directly, or keep chatting to refine the framing.") {
  const draft = String(text || "").trim();
  if (!draft) return null;
  setHiddenProjectDraft(draft);
  projectDraftDirty = true;
  return appendFramingMessage("assistant", summary, {
    kind: "project",
    artifact: { path: "PROJECT.md", text: draft },
  });
}

function updateLatestProjectDraftMessage(text) {
  const draft = String(text || "").trim();
  const message = latestProjectMessage();
  if (message) {
    message.artifact = { path: "PROJECT.md", text: draft };
    message.text = "I updated PROJECT.md. Review the new draft here, edit it directly, or keep chatting to refine the framing.";
    lastFramingHtml = "";
    persistFramingMessages().catch((error) => showToast(error.message, true));
  }
  setHiddenProjectDraft(draft);
}

function cacheProjectDraftInlinePayload(draft) {
  const text = String(draft || "");
  inlineFiles["PROJECT.md"] = text;
  inlineFilePayloads["PROJECT.md"] = {
    ...(inlineFilePayloads["PROJECT.md"] || {}),
    exists: true,
    is_dir: false,
    path: "PROJECT.md",
    text,
    kind: "markdown",
    mime: "text/markdown",
    editable: true,
  };
}

function framingControlMessageHtml(message) {
  const text = String(message?.text || "").trim();
  const { label, value } = controlMessageDisplay(message, text);
  return `
    <article class="framing-message control" data-framing-id="${escapeHtml(message.id)}" data-role="control" data-kind="${escapeHtml(message.kind || "command")}">
      <div class="framing-control-pill">
        <span>${escapeHtml(label)}</span>
        <code>${escapeHtml(value || "command")}</code>
      </div>
    </article>
  `;
}

function controlMessageDisplay(message, text = String(message?.text || "").trim()) {
  const normalized = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (isGoalLaunchMessage(message)) return { label: "Autoresearch", value: "Start autoresearch" };
  if (localSlashCommandRegistry[normalized]) return localSlashCommandRegistry[normalized];
  return { label: "Command", value: text || "Command sent" };
}

function planStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "ready") return "Ready";
  if (value === "approved") return "Approved";
  if (value === "failed") return "Failed";
  if (value === "running") return "Planning";
  return "Pending";
}

function planStepsHtml(steps = []) {
  if (!Array.isArray(steps) || !steps.length) return "";
  return `
    <ol class="plan-step-list">
      ${steps
        .map((step) => `
          <li>
            <span>${escapeHtml(step.status || "step")}</span>
            <p>${escapeHtml(step.step || "")}</p>
          </li>
        `)
        .join("")}
    </ol>
  `;
}

function planCardHtml(message) {
  const artifact = message.artifact || {};
  const planId = String(artifact.id || message.planId || "").trim();
  const status = String(artifact.status || "pending").toLowerCase();
  const planText = String(artifact.plan_text || artifact.text || message.text || "").trim();
  const error = String(artifact.error || "").trim();
  const ready = status === "ready";
  const approved = status === "approved";
  const provider = agentLabel(artifact.provider || sessionBackend());
  const model = String(artifact.model || "").trim();
  if (!planText && !error) {
    return `
      <article class="framing-message assistant plan-card-message" data-framing-id="${escapeHtml(message.id)}" data-role="assistant" data-kind="plan">
        <div class="transcript-meta plan-message-meta">
          <span>CoAutoResearch</span>
          <em>Plan mode</em>
          <em class="plan-status ${escapeHtml(status)}">${escapeHtml(planStatusLabel(status))}</em>
        </div>
        <div class="transcript-body plan-message-body">
          ${planStepsHtml(artifact.steps)}
          <p class="plan-empty">Planning...</p>
        </div>
      </article>
    `;
  }
  const body = error
    ? `<div class="plan-error">${escapeHtml(error)}</div>`
    : `<div class="plan-rendered markdown-preview">${markdownToHtml(planText)}</div>`;
  const actionItems = [
    planText ? messageCopyButton(planText, "Copy plan", "Plan copied.") : "",
    projectDraftLaunchButtonHtml(currentProjectDraftFooterMessage()),
    ready ? `<button class="secondary-button small-button" type="button" data-plan-revise="${escapeHtml(planId)}">Revise</button>` : "",
    ready ? `<button class="primary-button small-button" type="button" data-plan-approve="${escapeHtml(planId)}">Approve &amp; run</button>` : "",
    approved ? `<span class="plan-approved-note">Implementation started.</span>` : "",
  ].filter(Boolean);
  const actions = actionItems.length
    ? `<div class="project-card-actions plan-card-actions">${actionItems.join("")}</div>`
    : "";
  return `
    <article class="framing-message assistant plan-card-message" data-framing-id="${escapeHtml(message.id)}" data-role="assistant" data-kind="plan">
      <div class="transcript-meta">CoAutoResearch / Plan</div>
      <div class="transcript-body project-draft-bubble plan-card-bubble">
        <div class="project-card-head plan-card-head">
          <div>
            <strong>Plan</strong>
            <span>${escapeHtml(provider)}${model ? ` / ${escapeHtml(model)}` : ""}</span>
          </div>
          <span class="plan-status ${escapeHtml(status)}">${escapeHtml(planStatusLabel(status))}</span>
        </div>
        ${planStepsHtml(artifact.steps)}
        ${body}
        ${actions}
      </div>
    </article>
  `;
}

function framingMessageHtml(message) {
  if (message.kind === "project" && message.artifact?.text) return projectDraftCardHtml(message);
  if (message.kind === "plan" && message.artifact?.id) return planCardHtml(message);
  if (isControlFramingMessage(message)) return framingControlMessageHtml(message);
  const role = message.role === "user" ? "user" : "assistant";
  const title = role === "user" ? "You" : "CoAutoResearch";
  if (role === "user" && editingFramingId === message.id) {
    return `
      <article class="framing-message ${role} is-editing" data-framing-id="${escapeHtml(message.id)}">
        <div class="transcript-meta">${title}</div>
        <form class="framing-edit-form" data-framing-edit-form="${escapeHtml(message.id)}">
          <textarea name="message" rows="3">${escapeHtml(message.text)}</textarea>
          ${editAttachmentsHtml(message.id)}
          <div class="framing-actions">
            <button class="secondary-button small-button" type="button" data-framing-cancel="${escapeHtml(message.id)}">Cancel</button>
            <button class="primary-button small-button" type="submit">Resend</button>
          </div>
        </form>
      </article>
    `;
  }
  const projectAttachmentMessage = role === "assistant" && message.attachedProjectDraft ? message.attachedProjectDraft : null;
  const launchAction = projectAttachmentMessage ? projectDraftLaunchButtonHtml(projectAttachmentMessage) : "";
  const actionItems = [
    messageCopyButton(message.text, role === "user" ? "Copy your message" : "Copy response"),
    role === "user" && !message.resumeFromTrial
      ? `<button class="text-button" type="button" data-framing-edit="${escapeHtml(message.id)}">Edit</button>`
      : "",
    launchAction,
  ].filter(Boolean);
  const actionClass = `framing-actions message-action-row${launchAction ? " has-project-launch" : ""}`;
  const actions = actionItems.length ? `<div class="${actionClass}">${actionItems.join("")}</div>` : "";
  const projectAttachment = projectAttachmentMessage ? projectDraftAttachmentHtml(projectAttachmentMessage) : "";
  return `
    <article class="framing-message ${role}" data-framing-id="${escapeHtml(message.id)}">
      <div class="transcript-meta">${title}</div>
      ${messageAttachmentsHtml(message)}
      <div class="transcript-body">${transcriptContentHtml(message.text, { markdown: role === "assistant" })}</div>
      ${projectAttachment}
      ${actions}
    </article>
  `;
}

function framingThinkingHtml() {
  const showTrialHistory = isAutoresearchActiveRun();
  if (showTrialHistory) return activeTrialHistoryHtml();

  return currentRunLiveStatusHtml();
}

function currentRunLiveStatusHtml() {
  const entries = currentProgressEntries();
  const processUpdates = currentRunProcessUpdatesHtml(entries);
  const waitNotice = agentWaitStateHtml();
  const showWaitNotice = Boolean(waitNotice);
  const placeholder = !showWaitNotice ? currentRunPendingPlaceholderHtml(entries) : "";
  const eventLabel = currentRunActivityEventLabel(entries.length);
  return `
    <article class="framing-message assistant is-thinking" aria-live="polite">
      <div class="transcript-meta">CoAutoResearch</div>
      <div class="transcript-body thinking-bubble">
        <section class="run-live-status" aria-live="polite" aria-label="Current run status">
          <div class="run-live-status-head">
            <div class="thinking-status-row run-live-status-title">
              <span class="thinking-dot"></span>
              <span class="thinking-dot"></span>
              <span class="thinking-dot"></span>
              ${isRunVisiblyPending() ? workingDurationHtml() : ""}
            </div>
            <div class="run-live-status-actions">
              <span>${escapeHtml(eventLabel)}</span>
              ${runControlButtonsHtml()}
            </div>
          </div>
          ${processUpdates}
          ${placeholder}
          ${showWaitNotice ? waitNotice : ""}
          ${currentRunActivityDetailsHtml(entries)}
        </section>
      </div>
    </article>
  `;
}

function framingProgressTitle(entry) {
  const kind = String(entry?.kind || "").toLowerCase();
  const role = transcriptRole(entry);
  const rawType = String(entry?.raw_type || "").toLowerCase();
  const content = String(entry?.content || "");
  if (kind === "error" || rawType.includes("failed") || rawType.includes("error")) return "Error";
  if (rawType.includes("reasoning") || kind === "reasoning") return "Reasoning";
  if (webSearchActivityInfo(entry)) return "Web search";
  if (content.includes("file_change")) return "File change";
  if (role === "command" || /\/bin\/(?:zsh|bash|sh)\s+-lc/.test(content)) return "Command";
  if (role === "tool" || kind === "tool") return "Tool";
  if (role === "final" || kind === "final") return "Done";
  return "Update";
}

function framingProgressContent(entry) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  const kind = String(entry?.kind || "").toLowerCase();
  const content = String(entry?.content || "").trim();
  if (!content) return "";
  const webSearch = webSearchActivityInfo(entry);
  if (webSearch) return webSearch.summary;
  if (rawType.includes("reasoning") || kind === "reasoning") {
    return compactText(content, 220);
  }
  if (content.includes("file_change")) {
    const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
    const file = lines.find((line) => line.includes("/") || line.endsWith(".md"));
    const action = lines.includes("update") ? "updated" : "changed";
    const state = lines.includes("completed") ? "completed" : lines.includes("in_progress") ? "in progress" : "";
    return compactText(`${file ? basename(file) : "file"} ${action}${state ? `, ${state}` : ""}`, 180);
  }
  return compactText(content.replace(/^\/bin\/(?:zsh|bash|sh)\s+-lc\s+/, ""), 220);
}

function normalizedAgentEventPrefix(value) {
  return String(value || "")
    .trim()
    .split(/\s+/, 1)[0]
    .replace(/[._]+/g, "/")
    .replace(/-+/g, "-")
    .replace(/:+$/, "")
    .toLowerCase();
}

function isNoisyAgentLifecycleText(value) {
  const eventName = normalizedAgentEventPrefix(value);
  if (
    eventName.startsWith("account/") ||
    eventName.startsWith("remotecontrol/") ||
    eventName.startsWith("thread/") ||
    eventName.startsWith("turn/") ||
    (eventName.startsWith("mcpserver/") && !eventName.includes("toolcall"))
  ) {
    return true;
  }
  return new Set([
    "thread/started",
    "turn/started",
    "thread/settings/updated",
    "thread/status/changed",
    "thread/tokenusage/updated",
    "thread/token-usage/updated",
    "thread/token_usage/updated",
    "thread/token/usage/updated",
    "account/ratelimits/updated",
    "account/rate-limits/updated",
    "account/rate_limits/updated",
    "account/rate/limits/updated",
    "mcpserver/startupstatus/updated",
    "mcpserver/startup-status/updated",
    "mcpserver/startup_status/updated",
    "mcpserver/startup/status/updated",
  ]).has(eventName);
}

function isNoisyCodexResultText(value) {
  const text = String(value || "")
    .trim()
    .replace(/^[A-Za-z][\w./-]*:\s+/, "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(text)) return false;
  return (
    /\/\.codex\/sessions\//i.test(text) ||
    /\bnotLoaded\s+inProgress\b/i.test(text) ||
    /\breadOnly\b/i.test(text) ||
    /^[0-9a-f-]{36}\s+[0-9a-f-]{36}\s+(?:true|false)\s+\w+/i.test(text)
  );
}

function isNoisyAgentLifecycleEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const rawType = String(entry.raw_type || "");
  const content = String(entry.content || "");
  const rawEventName = normalizedAgentEventPrefix(rawType);
  const role = String(entry.role || "").toLowerCase();
  const kind = String(entry.kind || "").toLowerCase();
  if ((role === "final" || kind === "final") && !isNoisyCodexResultText(content)) return false;
  return (
    isNoisyAgentLifecycleText(rawType) ||
    isNoisyAgentLifecycleText(content) ||
    rawEventName === "item/started" ||
    (rawEventName === "item/completed" && /(?:Plan only\. Do not implement|Authoritative UI conversation history|Use this history as the current UI truth)/i.test(content)) ||
    ((normalizedAgentEventPrefix(rawType) === "event" || !rawType.trim()) && isNoisyCodexResultText(content))
  );
}

function hasLocalPendingRunScope() {
  return Boolean(Number(framingPendingSince || 0) && (framingReplyPending || framingDraftPending || pendingFramingUserMessageId));
}

function isRunVisiblyPending() {
  return isSessionRunning() || hasLocalPendingRunScope();
}

function currentProgressLeewayMs() {
  return hasLocalPendingRunScope() && !isSessionRunning() ? 0 : 1000;
}

function explicitCurrentRunStartTime(transcript = []) {
  const activeRunStarted = entryTimeValue({ created_at: activeRun().started_at });
  const latestRunStart = (Array.isArray(transcript) ? transcript : []).reduce((latest, entry) => {
    if (!transcriptRunStart(entry)) return latest;
    return Math.max(latest, entryTimeValue(entry));
  }, 0);
  return Math.max(activeRunStarted, latestRunStart);
}

function currentProgressStartTime(transcript) {
  const sessionStarted = entryTimeValue({ created_at: sessionState().started_at });
  const explicitRunStart = explicitCurrentRunStartTime(transcript);
  const pendingSince = Number(framingPendingSince || 0);
  if (isSessionRunning() && explicitRunStart) return explicitRunStart;
  if (hasLocalPendingRunScope()) return pendingSince;
  return explicitRunStart || pendingSince || sessionStarted;
}

function currentRunScopedEntries(entries) {
  const transcript = Array.isArray(sessionState().transcript) ? sessionState().transcript : [];
  const progressStart = currentProgressStartTime(transcript);
  const leeway = currentProgressLeewayMs();
  if (!progressStart) return entries || [];
  return (entries || []).filter((entry) => {
    const createdAt = entryTimeValue(entry);
    return !createdAt || createdAt >= progressStart - leeway;
  });
}

function currentProgressEntries() {
  const session = sessionState();
  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  const progressStart = currentProgressStartTime(transcript);
  const leeway = currentProgressLeewayMs();
  return transcript
    .filter((entry) => {
      const role = transcriptRole(entry);
      const content = String(entry?.content || "").trim();
      const rawType = String(entry?.raw_type || "").toLowerCase();
      if (isNoisyAgentLifecycleEntry(entry)) return false;
      if (progressStart) {
        const createdAt = entryTimeValue(entry);
        if (createdAt && createdAt < progressStart - leeway) return false;
      }
      return content && role !== "user" && rawType !== "turn.completed";
    })
    .reduceRight((items, entry) => {
      const key = `${framingProgressTitle(entry)}\n${framingProgressContent(entry)}`;
      if (!items.seen.has(key)) {
        items.seen.add(key);
        items.entries.unshift(entry);
      }
      return items;
    }, { seen: new Set(), entries: [] }).entries
    .slice(-6);
}

function currentRunActivityEventLabel(count) {
  return count ? `${count} event${count === 1 ? "" : "s"}` : "waiting";
}

function currentRunReadableEntry(entries) {
  const primaryTitles = new Set(["Error", "Done", "Update", "File change"]);
  const primary = [...(entries || [])].reverse().find((entry) => {
    const title = framingProgressTitle(entry);
    return primaryTitles.has(title) && framingProgressContent(entry);
  });
  if (primary) return primary;
  return [...(entries || [])].reverse().find((entry) => {
    const title = framingProgressTitle(entry);
    return title === "Reasoning" && framingProgressContent(entry);
  }) || null;
}

function currentRunReadableSummary(entries = currentProgressEntries()) {
  const entry = currentRunReadableEntry(entries);
  if (entry) return `${framingProgressTitle(entry)}: ${framingProgressContent(entry)}`;
  return agentWaitStateText() || (isSessionRunning() ? `Waiting for ${agentLabel(sessionBackend())} events...` : "Waiting for agent events...");
}

function isVisibleProcessUpdateEntry(entry) {
  const title = framingProgressTitle(entry);
  if (!["Update", "Reasoning"].includes(title)) return false;
  const role = transcriptRole(entry);
  if (title === "Update" && role !== "assistant") return false;
  const rawType = String(entry?.raw_type || "").toLowerCase();
  if (rawType.startsWith("turn.") || rawType.startsWith("session.")) return false;
  const content = framingProgressContent(entry);
  if (!content) return false;
  if (/^(turn|session|run|response)\.[a-z_.-]+$/i.test(content.trim())) return false;
  return true;
}

function visibleProcessUpdateText(entry) {
  return framingProgressContent(entry).replace(/^(?:update|reasoning)\s*:\s*/i, "").trim();
}

function currentRunProcessUpdateEntries(entries = currentProgressEntries(), limit = 3) {
  const seen = new Set();
  return (entries || [])
    .filter((entry) => {
      if (!isVisibleProcessUpdateEntry(entry)) return false;
      const content = visibleProcessUpdateText(entry);
      if (!content || seen.has(content)) return false;
      seen.add(content);
      return true;
    })
    .slice(-limit);
}

function currentRunProcessUpdatesHtml(entries = currentProgressEntries(), options = {}) {
  const updates = currentRunProcessUpdateEntries(entries, options.limit || 3);
  if (!updates.length) return "";
  const className = options.className || "run-live-updates";
  return `
    <div class="${escapeHtml(className)}" aria-label="${escapeHtml(options.label || `${agentLabel(sessionBackend())} updates`)}">
      ${updates
        .map((entry) => `<p>${escapeHtml(compactText(visibleProcessUpdateText(entry), options.maxLength || 360))}</p>`)
        .join("")}
    </div>
  `;
}

function currentRunPendingPlaceholderHtml(entries = currentProgressEntries(), options = {}) {
  if (!isRunVisiblyPending()) return "";
  if (currentRunProcessUpdateEntries(entries, 1).length) return "";
  const className = options.className || "run-live-placeholder";
  const text = options.text || "Preparing response...";
  return `<p class="${escapeHtml(className)}">${escapeHtml(text)}</p>`;
}

function framingProgressRowsHtml(entries) {
  if (!entries.length) {
    return `<div class="framing-progress is-empty">${agentWaitStateHtml() || "Waiting for agent events..."}</div>`;
  }
  return `
    <div class="framing-progress" aria-label="Agent progress">
      ${entries
        .map((entry) => {
          const title = framingProgressTitle(entry);
          const content = framingProgressContent(entry);
          const role = transcriptRole(entry);
          const collapsible = ["Command", "Tool", "Web search", "File change"].includes(title) || role === "command" || role === "tool";
          if (collapsible) {
            return `
              <details class="framing-progress-row is-collapsible ${escapeHtml(role)}">
                <summary>
                  <span>${escapeHtml(title)}</span>
                  <p>${escapeHtml(content)}</p>
                </summary>
                <pre>${escapeHtml(String(entry?.content || "").trim())}</pre>
              </details>
            `;
          }
          return `
            <div class="framing-progress-row ${escapeHtml(role)}">
              <span>${escapeHtml(title)}</span>
              <p>${escapeHtml(content)}</p>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function currentRunActivityDetailsHtml(entries = currentProgressEntries()) {
  const count = entries.length;
  const activityKey = activeRunActivityDetailsKey();
  const eventLabel = currentRunActivityEventLabel(count);
  return `
    <details class="run-live-details" data-run-activity-details="${escapeHtml(activityKey)}"${runActivityOpenAttribute(activityKey)}>
      <summary>
        <span>Run activity</span>
        <strong>${escapeHtml(eventLabel)}</strong>
      </summary>
      ${framingProgressRowsHtml(entries)}
    </details>
  `;
}

function framingProgressDetailsHtml() {
  return currentRunActivityDetailsHtml(currentProgressEntries());
}

function terminalRunNoResponseHtml(unansweredUser) {
  if (!unansweredUser) return "";
  const session = sessionState();
  const status = String(session.status || "").toLowerCase();
  if (isSessionRunning() || !["completed", "failed", "interrupted"].includes(status)) return "";
  const mode = String(session.mode || activeRunMode() || "").toLowerCase();
  if (!["chat", "framing"].includes(mode)) return "";
  const statusText = status === "failed"
    ? "The run failed before a response was saved."
    : status === "interrupted"
      ? "The run stopped before a response was saved."
      : "The run completed without a saved response.";
  const hasReturncode = session.returncode !== null && session.returncode !== undefined && String(session.returncode).trim() !== "";
  const returncode = hasReturncode ? Number(session.returncode) : NaN;
  const detailParts = [];
  if (Number.isFinite(returncode)) detailParts.push(`Exit code ${returncode}.`);
  const lastSummary = String(session.last_event_summary || "").trim();
  if (lastSummary) detailParts.push(compactText(lastSummary, 220));
  const entries = currentProgressEntries();
  return `
    <article class="framing-message assistant is-run-ended" aria-live="polite">
      <div class="transcript-meta">CoAutoResearch</div>
      <div class="transcript-body thinking-bubble">
        <section class="run-ended-status" aria-label="Run ended without a saved response">
          <p>${escapeHtml(statusText)}</p>
          ${detailParts.length ? `<p class="run-ended-detail">${escapeHtml(detailParts.join(" "))}</p>` : ""}
          ${entries.length ? currentRunActivityDetailsHtml(entries) : ""}
        </section>
      </div>
    </article>
  `;
}

function projectDraftReferenceHtml(message, options = {}) {
  const label = options.label === undefined ? "Updated" : String(options.label || "");
  const draft = String(message?.artifact?.text || currentProjectDraft());
  cacheProjectDraftInlinePayload(draft);
  return `
    <div class="project-inline-reference">
      ${label ? `<span>${escapeHtml(label)}</span>` : ""}
      ${markdownFileButtonHtml("PROJECT.md", "PROJECT.md")}
    </div>
  `;
}

function projectDraftLaunchButtonHtml(message) {
  const launchState = prelaunchAffordanceState();
  if (!launchState.showStart) return "";
  const launchDisabled = launchState.disabled ? " disabled" : "";
  const launchTitle = launchState.reason ? ` title="${escapeHtml(launchState.reason)}"` : "";
  const draft = String(message?.artifact?.text || currentProjectDraft());
  cacheProjectDraftInlinePayload(draft);
  return `<button class="primary-button small-button project-launch-action" type="button" data-project-launch ${launchDisabled}${launchTitle}>Start autoresearch</button>`;
}

function projectDraftActionsHtml(message, options = {}) {
  const draft = String(message?.artifact?.text || currentProjectDraft());
  cacheProjectDraftInlinePayload(draft);
  return `
    ${projectDraftReferenceHtml(message, options)}
    <div class="project-card-actions">
      ${messageCopyButton(draft, "Copy PROJECT.md draft", "PROJECT.md draft copied.")}
      ${projectDraftLaunchButtonHtml(message)}
    </div>
  `;
}

function projectDraftAttachmentHtml(message) {
  return `
    <div class="project-draft-inline" data-project-attachment="${escapeHtml(message.id || "")}">
      ${projectDraftReferenceHtml(message)}
    </div>
  `;
}

function projectDraftCardHtml(message) {
  const summary = String(message?.text || "").trim() || "PROJECT.md was updated.";
  return `
    <article class="framing-message assistant project-draft-message is-compact-project" data-framing-id="${escapeHtml(message.id)}" data-role="assistant" data-kind="project">
      <div class="transcript-meta">CoAutoResearch</div>
      <div class="transcript-body">
        ${transcriptContentHtml(summary, { markdown: true })}
        ${projectDraftActionsHtml(message)}
      </div>
    </article>
  `;
}

function renderFramingConversation() {
  const thread = $("#framing-thread");
  if (!thread) return;
  reconcileFramingPending(localMessages);
  const wasNearBottom = isPageNearBottom();
  const visibleMessages = visibleFramingMessagesForRender(localMessages);
  const hasAttachedProjectFooter = projectFooterIsAttached(visibleMessages);
  const transcriptEntries = sessionTranscriptEntries();
  const activity = buildFramingActivityByMessage(visibleMessages, transcriptEntries);
  const messages = visibleMessages
    .map((message) => `${activity.htmlBeforeMessageId.get(message.id) || ""}${framingMessageHtml(message)}`)
    .join("");
  const hasLocalTranscript = transcriptEntries.some(isUiLocalTranscript);
  const unansweredUser = latestUnansweredUserMessage(visibleMessages);
  const inferredReplyPending = Boolean(unansweredUser && (framingReplyPending || framingMessagesPersisting || isSessionRunning()));
  if (inferredReplyPending && !framingPendingSince) {
    framingPendingSince = framingMessageTime(unansweredUser, Date.now());
  }
  const localPending = framingDraftPending || framingReplyPending || inferredReplyPending;
  const transcriptTrialPanel = !localPending && (hasLaunched() || hasLocalTranscript)
    ? sessionTimelineHtml(transcriptEntries, { omittedEntryIds: activity.omittedEntryIds, omitLocal: true })
    : "";
  const shouldShowPending = localPending || (isSessionRunning() && !transcriptTrialPanel);
  const pendingHtml = shouldShowPending ? framingThinkingHtml() : "";
  const terminalNoResponseHtml = !shouldShowPending ? terminalRunNoResponseHtml(unansweredUser) : "";
  const pendingShowsAutoresearch = shouldShowPending && isAutoresearchActiveRun();
  const footerAutoresearchPanel = pendingShowsAutoresearch
    ? ""
    : (transcriptTrialPanel || persistentAutoresearchPanelHtml(transcriptEntries, { omittedEntryIds: activity.omittedEntryIds, omitLocal: true }));
  const autoresearchDockHtml = pendingShowsAutoresearch ? pendingHtml : footerAutoresearchPanel;
  const pending = pendingShowsAutoresearch ? "" : `${pendingHtml}${terminalNoResponseHtml}`;
  const hasInlineThreadContent = Boolean(messages || pending);
  const hasThreadContent = Boolean(hasInlineThreadContent || autoresearchDockHtml);
  const nextHtml = [messages, pending].filter(Boolean).join("");
  if (nextHtml !== lastFramingHtml) {
    thread.innerHTML = nextHtml;
    lastFramingHtml = nextHtml;
    requestAnimationFrame(() => {
      restoreTrialStripScroll();
    });
    if (activeView === "chat" && pending && wasNearBottom) {
      scrollFramingToBottomSoon();
    } else {
      requestAnimationFrame(() => {
        updateBriefDockGeometry();
        updateFramingScrollButton();
      });
    }
  }
  restoreInitialChatScrollPosition();
  thread.hidden = !hasInlineThreadContent;
  $("#cold-start-workspace")?.classList.toggle("has-framing-thread", hasThreadContent);
  renderProjectLaunchFallbackPanel(false);
  $("#framing-project-panel")?.toggleAttribute("hidden", true);
  $("#open-launch-dialog")?.toggleAttribute("hidden", true);
  $("#open-launch-dialog-inline")?.toggleAttribute("hidden", true);
  syncBriefComposerDock(activeView === "chat" && hasThreadContent);
  renderAutoresearchDock(autoresearchDockHtml, activeView === "chat" && hasThreadContent);
  renderComposerSuggestions();
  updateFramingScrollButton();
}

function ensureAutoresearchDock() {
  const existing = $("#autoresearch-dock");
  if (existing) {
    autoresearchDockElement = existing;
    return existing;
  }
  if (autoresearchDockElement) return autoresearchDockElement;
  const dock = document.createElement("div");
  dock.id = "autoresearch-dock";
  dock.className = "autoresearch-dock";
  dock.hidden = true;
  document.body.appendChild(dock);
  autoresearchDockElement = dock;
  return dock;
}

function syncAutoresearchDockGeometry() {
  const dock = autoresearchDockElement || $("#autoresearch-dock");
  const visible = Boolean(dock && !dock.hidden && String(dock.innerHTML || "").trim());
  let height = 0;
  if (visible && typeof dock.getBoundingClientRect === "function") {
    height = Math.max(44, dock.getBoundingClientRect().height || 0);
  }
  document.documentElement?.style?.setProperty?.("--autoresearch-dock-height", `${height}px`);
}

function renderAutoresearchDock(html, active = true) {
  const dock = ensureAutoresearchDock();
  const nextHtml = active && html ? html : "";
  if (nextHtml !== lastAutoresearchDockHtml) {
    dock.innerHTML = nextHtml;
    lastAutoresearchDockHtml = nextHtml;
    requestAnimationFrame(restoreTrialStripScroll);
  }
  dock.hidden = !nextHtml;
  document.body.classList.toggle("has-autoresearch-dock", Boolean(nextHtml));
  syncAutoresearchDockGeometry();
  requestAnimationFrame(() => {
    syncAutoresearchDockGeometry();
    updateFramingScrollButton();
  });
}

function syncBriefComposerDock(active) {
  const shell = $("#brief-editor-shell");
  const anchor = $("#brief-editor-anchor");
  const scrollButton = $("#framing-scroll-bottom");
  if (!shell || !anchor) return;
  document.body.classList.toggle("has-brief-dock", Boolean(active));
  shell.classList.toggle("is-framing-dock", Boolean(active));
  if (active) {
    if (shell.parentElement !== document.body) document.body.appendChild(shell);
    if (scrollButton && scrollButton.parentElement !== document.body) document.body.appendChild(scrollButton);
    updateBriefDockGeometry();
  } else {
    if (shell.parentElement !== anchor.parentElement) {
      anchor.insertAdjacentElement("afterend", shell);
    }
    if (scrollButton) {
      scrollButton.hidden = true;
      const thread = $("#framing-thread");
      if (thread && scrollButton.parentElement !== thread.parentElement) {
        thread.insertAdjacentElement("afterend", scrollButton);
      }
    }
  }
  if (!active) renderAutoresearchDock("", false);
}

function updateBriefDockGeometry() {
  const shell = $("#brief-editor-shell");
  const main = $(".main-stage");
  if (!shell || !main || !shell.classList.contains("is-framing-dock")) return;
  const rect = typeof main.getBoundingClientRect === "function"
    ? main.getBoundingClientRect()
    : { left: 0, width: window.innerWidth || 980 };
  const available = Math.max(320, rect.width - 56);
  const width = Math.min(980, available);
  const left = rect.left + rect.width / 2;
  const shellRect = typeof shell.getBoundingClientRect === "function" ? shell.getBoundingClientRect() : { height: 0 };
  const height = Math.max(88, shellRect.height || 0);
  const bottom = window.innerWidth <= 760 ? 18 : 22;
  shell.style.setProperty("--brief-dock-left", `${left}px`);
  shell.style.setProperty("--brief-dock-width", `${width}px`);
  shell.style.setProperty("--brief-dock-height", `${height}px`);
  shell.style.setProperty("--brief-dock-bottom", `${bottom}px`);
  const rootStyle = document.documentElement?.style;
  rootStyle?.setProperty?.("--brief-dock-left", `${left}px`);
  rootStyle?.setProperty?.("--brief-dock-width", `${width}px`);
  rootStyle?.setProperty?.("--brief-dock-height", `${height}px`);
  rootStyle?.setProperty?.("--brief-dock-bottom", `${bottom}px`);
  updateFramingThreadGeometry(height, bottom);
  syncAutoresearchDockGeometry();
  requestAnimationFrame(updateFramingScrollButton);
}

function updateFramingThreadGeometry(dockHeight = null, dockBottom = null) {
  const thread = $("#cold-start-workspace.has-framing-thread .framing-thread");
  if (!thread || thread.hidden) return;
  const rect = typeof thread.getBoundingClientRect === "function" ? thread.getBoundingClientRect() : { top: 0 };
  const viewportHeight = Number(window.innerHeight || 0);
  const height = Number.isFinite(dockHeight) ? dockHeight : Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--brief-dock-height")) || 132;
  const bottom = Number.isFinite(dockBottom) ? dockBottom : Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--brief-dock-bottom")) || 22;
  const minHeight = Number(window.innerWidth || 0) <= 760 ? 48 : 180;
  const available = Math.max(minHeight, viewportHeight - Number(rect.top || 0) - height - bottom - 18);
  document.documentElement?.style?.setProperty?.("--framing-thread-height", `${available}px`);
}

function markFramingThreadScrolling(thread) {
  if (!thread) return;
  thread.classList.add("is-scrolling");
  clearTimeout(thread._framingScrollTimer);
  thread._framingScrollTimer = setTimeout(() => thread.classList.remove("is-scrolling"), 760);
}

function ensureFramingThreadScrollListener(thread) {
  if (!thread || framingThreadScrollListeners.has(thread)) return;
  framingThreadScrollListeners.add(thread);
  thread.addEventListener("scroll", () => {
    markFramingThreadScrolling(thread);
  }, { passive: true });
}

function framingThreadScroller() {
  if (!document.body?.classList?.contains("has-brief-dock")) return null;
  const thread = $("#cold-start-workspace.has-framing-thread .framing-thread");
  if (!thread || thread.hidden) return null;
  ensureFramingThreadScrollListener(thread);
  return thread;
}

function handleFramingStageWheel(event) {
  const thread = framingThreadScroller();
  if (!thread || thread.contains(event.target)) return;
  if (event.ctrlKey || event.metaKey) return;
  if (event.target?.closest?.(".brief-editor-shell.is-framing-dock, dialog, input, textarea, select, .attachment-menu")) return;
  const maxScroll = Math.max(0, thread.scrollHeight - thread.clientHeight);
  if (!maxScroll) return;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
  const delta = (event.deltaY || 0) * unit;
  if (!delta) return;
  const next = Math.max(0, Math.min(maxScroll, thread.scrollTop + delta));
  if (next === thread.scrollTop) return;
  event.preventDefault();
  thread.scrollTop = next;
  markFramingThreadScrolling(thread);
}

function pageScroller() {
  const framingThread = framingThreadScroller();
  if (framingThread) return framingThread;
  const main = $(".main-stage");
  if (main && main.scrollHeight > main.clientHeight + 2) return main;
  return document.scrollingElement || document.documentElement;
}

function scrollerMetrics(scroller = pageScroller()) {
  const isDocument = scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
  return {
    scroller,
    isDocument,
    viewportHeight: isDocument ? window.innerHeight : scroller.clientHeight,
    scrollTop: isDocument ? window.scrollY : scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
  };
}

function isPageNearBottom(threshold = 24) {
  const { viewportHeight, scrollTop, scrollHeight } = scrollerMetrics();
  return scrollHeight - (scrollTop + viewportHeight) <= threshold;
}

function updateFramingScrollButton() {
  const button = $("#framing-scroll-bottom");
  if (!button) return;
  const dockActive = Boolean($(".brief-editor-shell.is-framing-dock"));
  const chatVisible = activeView === "chat" && !$("#chat-view")?.hidden;
  const shouldShow = chatVisible && dockActive && !isPageNearBottom(36);
  const wasShowing = document.body.classList.contains("has-framing-scroll-button");
  button.hidden = !shouldShow;
  document.body.classList.toggle("has-framing-scroll-button", shouldShow);
  if (dockActive && wasShowing !== shouldShow) {
    requestAnimationFrame(updateBriefDockGeometry);
  }
}

function scrollFramingToBottom() {
  const { scroller, isDocument, scrollHeight } = scrollerMetrics();
  if (isDocument) {
    window.scrollTo({ top: scrollHeight, behavior: "smooth" });
  } else {
    scroller.scrollTo({ top: scrollHeight, behavior: "smooth" });
  }
  requestAnimationFrame(updateFramingScrollButton);
}

function scrollFramingToBottomInstant() {
  const { scroller, isDocument, scrollHeight } = scrollerMetrics();
  if (isDocument) {
    window.scrollTo({ top: scrollHeight, behavior: "auto" });
  } else {
    scroller.scrollTop = scrollHeight;
  }
  requestAnimationFrame(updateFramingScrollButton);
}

function scrollFramingToBottomSoon() {
  requestAnimationFrame(() => {
    updateBriefDockGeometry();
    scrollFramingToBottomInstant();
  });
}

function mergeModelOptionsLists(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!Array.isArray(entry) || entry.length < 1) continue;
      const value = String(entry[0] || "").trim();
      if (!value || seen.has(value)) continue;
      const label = String(entry[1] || value).trim() || value;
      seen.add(value);
      merged.push([value, label]);
    }
  }
  return merged;
}

function modelOptionsForBackend(backend) {
  const normalized = normalizeAgentBackend(backend);
  const base = modelOptionsByBackend[normalized] || modelOptionsByBackend.codex;
  const discovered = discoveredModelsByBackend[normalized];
  const merged = Array.isArray(discovered) && discovered.length ? mergeModelOptionsLists(base, discovered) : base;
  if (normalized !== "claude") return merged;
  return merged.filter(([value, label]) => {
    const text = `${value} ${label}`.toLowerCase();
    return !text.includes("fable") && !isKnownCodexModel(value);
  });
}

async function discoverModelsForBackend(backend) {
  const normalized = normalizeAgentBackend(backend);
  if (modelDiscoveryInflight[normalized]) return modelDiscoveryInflight[normalized];
  const promise = (async () => {
    try {
      const payload = await api(`/api/agent/models?backend=${encodeURIComponent(normalized)}`);
      const list = Array.isArray(payload?.models) ? payload.models : [];
      if (payload?.source === "discovered" && list.length) {
        const pairs = list
          .map((entry) => [String(entry?.value || "").trim(), String(entry?.label || entry?.value || "").trim()])
          .filter(([value]) => value);
        if (pairs.length) {
          discoveredModelsByBackend[normalized] = pairs;
          return pairs;
        }
      }
      return null;
    } catch (_) {
      return null;
    } finally {
      delete modelDiscoveryInflight[normalized];
    }
  })();
  modelDiscoveryInflight[normalized] = promise;
  return promise;
}

async function refreshDiscoveredModels(backends = ["codex", "claude"]) {
  const results = await Promise.all(backends.map((backend) => discoverModelsForBackend(backend)));
  const updated = results.some((value) => Array.isArray(value) && value.length);
  if (updated) document.dispatchEvent(new CustomEvent("agent-models-updated"));
  return updated;
}

// Re-render each model <select> against ITS OWN form's backend. Skips a select
// the user is actively interacting with (focused), and preserves its value.
function resyncAllModelSelects() {
  const sessionForm = document.getElementById("session-settings-form");
  const settingsForm = document.getElementById("settings-form");
  const targets = [
    {
      select: sessionForm?.elements?.model || null,
      backend: normalizeAgentBackend(sessionForm?.elements?.backend?.value || activeSettingsBackend()),
    },
    {
      select: document.getElementById("composer-model"),
      backend: normalizeAgentBackend(sessionForm?.elements?.backend?.value || activeSettingsBackend()),
    },
    {
      select: settingsForm?.elements?.settingsModel || null,
      backend: normalizeAgentBackend(settingsForm?.elements?.settingsBackend?.value || activeSettingsBackend()),
    },
  ];
  for (const { select, backend } of targets) {
    if (!select) continue;
    if (select === document.activeElement) continue; // don't fold an open dropdown
    syncModelSelectOptions(select, backend, select.value || "");
  }
  fitComposerSelectWidths();
}

let composerSelectMeasureContext = null;

function measureSelectOptionLabel(select, label) {
  if (!select || !label || typeof document === "undefined") return 0;
  if (!composerSelectMeasureContext) {
    const canvas = document.createElement?.("canvas");
    composerSelectMeasureContext = canvas?.getContext?.("2d") || null;
  }
  if (!composerSelectMeasureContext) return 0;
  const style = window.getComputedStyle?.(select);
  composerSelectMeasureContext.font = `${style?.fontWeight || "500"} ${style?.fontSize || "12px"} ${style?.fontFamily || "monospace"}`;
  return composerSelectMeasureContext.measureText(String(label)).width;
}

function fitComposerSelectWidth(select) {
  if (!select?.options?.length || !select.style?.setProperty) return;
  const selected = select.selectedOptions?.[0] || Array.from(select.options).find((option) => option.value === select.value) || select.options[0];
  const label = selected?.textContent || selected?.label || selected?.value || "";
  const textWidth = measureSelectOptionLabel(select, label);
  if (!textWidth) return;
  const arrowAndPadding = 28;
  const width = Math.ceil(Math.max(52, Math.min(176, textWidth + arrowAndPadding)));
  select.style.setProperty("--select-fit-width", `${width}px`);
}

function fitComposerSelectWidths() {
  fitComposerSelectWidth($("#composer-model"));
  fitComposerSelectWidth($("#composer-reasoning"));
}

function syncModelSelectOptions(select, backend, selected = "") {
  if (!select) return;
  const options = [...modelOptionsForBackend(backend)];
  const value = String(selected || "").trim();
  let allowed = new Set(options.map(([optionValue]) => optionValue));
  if (normalizeAgentBackend(backend) === "claude" && value && !allowed.has(value) && isValidCustomClaudeModel(value)) {
    options.push([value, `Custom: ${value}`]);
    allowed = new Set(options.map(([optionValue]) => optionValue));
  }
  const resolvedValue = allowed.has(value) ? value : defaultSettingsForBackend(backend).model;

  // Compute the desired option signature and compare with what is already rendered.
  // If nothing would change, do NOT touch the DOM — rebuilding the <select>'s
  // innerHTML would collapse it if the user has the dropdown open, and a no-op
  // rebuild on every poll is exactly what caused the "folds when I expand it" bug.
  const desiredSignature = options.map(([optionValue]) => optionValue).join("|");
  const renderedOptions = select.options || select.querySelectorAll?.("option") || [];
  const currentSignature = Array.from(renderedOptions).map((opt) => opt.value).join("|");
  const optionsUnchanged = desiredSignature === currentSignature;
  const valueUnchanged = select.value === resolvedValue;

  // Never rebuild a select the user is actively interacting with (its popup is open).
  const isActive = select === document.activeElement;

  if (optionsUnchanged) {
    if (!valueUnchanged && !isActive) select.value = resolvedValue;
    syncBackendDocLinks(backend);
    fitComposerSelectWidth(select);
    return;
  }
  if (isActive) {
    // Options differ but the dropdown is open; defer the rebuild until it closes
    // so we don't fold it under the user.
    syncBackendDocLinks(backend);
    return;
  }
  select.innerHTML = options.map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}">${escapeHtml(label)}</option>`).join("");
  select.value = resolvedValue;
  syncBackendDocLinks(backend);
  fitComposerSelectWidth(select);
}

function syncReasoningSelectOptions(select, backend, model = "", selected = "") {
  if (!select) return;
  const options = reasoningOptionsForBackendModel(backend, model);
  const allowed = new Set(options.map(([optionValue]) => optionValue));
  const rawValue = String(selected ?? "").trim();
  const resolvedValue = allowed.has(rawValue) ? rawValue : defaultReasoningEffortForBackendModel(backend, model);
  const desiredSignature = options.map(([optionValue]) => optionValue).join("|");
  const renderedOptions = select.options || select.querySelectorAll?.("option") || [];
  const currentSignature = Array.from(renderedOptions).map((opt) => opt.value).join("|");
  const isActive = select === document.activeElement;

  if (desiredSignature === currentSignature) {
    if (select.value !== resolvedValue && !isActive) select.value = resolvedValue;
    fitComposerSelectWidth(select);
    return;
  }
  if (isActive) return;
  select.innerHTML = options
    .map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}">${escapeHtml(label)}</option>`)
    .join("");
  select.value = resolvedValue;
  fitComposerSelectWidth(select);
}

function syncPermissionSelectOptions(select, backend, selected = "") {
  if (!select) return;
  const presets = permissionPresetsForBackend(backend);
  const selectedValue = normalizePermissionPreset(selected, { backend });
  const desiredSignature = Object.keys(presets).join("|");
  const renderedOptions = select.options || select.querySelectorAll?.("option") || [];
  const currentSignature = Array.from(renderedOptions).map((opt) => opt.value).join("|");
  const isActive = select === document.activeElement;
  if (desiredSignature === currentSignature) {
    if (select.value !== selectedValue && !isActive) select.value = selectedValue;
    return;
  }
  if (isActive) return;
  select.innerHTML = Object.entries(presets)
    .map(([value, config]) => `<option value="${escapeHtml(value)}">${escapeHtml(config.label || value)}</option>`)
    .join("");
  select.value = selectedValue;
}

function syncBackendDocLinks(backend) {
  const container = document.getElementById("settings-doc-links");
  if (!container) return;
  const links = backendDocLinks[normalizeAgentBackend(backend)] || backendDocLinks.codex;
  container.innerHTML = links
    .map(({ label, href }) => `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`)
    .join("");
}

function settingsFromForm() {
  const form = $("#session-settings-form");
  const data = new FormData(form);
  const backend = normalizeAgentBackend(data.get("backend") || form?.elements?.backend?.value || activeSettingsBackend());
  const permissionPreset = normalizePermissionPreset(data.get("permissionPreset"), { backend });
  const settings = normalizeSessionSettings({
    ...providerSettingsFromUi(backend),
    backend,
    model: String(data.get("model") || "").trim(),
    reasoningEffort: normalizeReasoningEffort(data.get("reasoningEffort"), backend, String(data.get("model") || "").trim()),
    permissionPreset,
    ...permissionPresetForBackend(backend, permissionPreset),
    webSearch: Boolean(data.get("webSearch")),
    fastMode: Boolean(data.get("fastMode")),
    extraConfig: String(data.get("extraConfig") || "").trim(),
    reviewCheckpointInterval: normalizeReviewCheckpointInterval(data.get("reviewCheckpointInterval")),
  });
  persistSessionSettings(settings);
  renderSettingsSummary(settings);
  syncComposerSettings(settings);
  renderAllAgentStatusNotes();
  renderResumeCommandBar();
  return settings;
}

function syncComposerSettings(settings) {
  const merged = normalizeSessionSettings(settings);
  const backend = normalizeAgentBackend(merged.backend);
  const model = $("#composer-model");
  const reasoning = $("#composer-reasoning");
  syncModelSelectOptions(model, backend, merged.model);
  syncReasoningSelectOptions(reasoning, backend, merged.model, merged.reasoningEffort);
  fitComposerSelectWidths();
}

function updateSessionSettingsFromComposer() {
  const form = $("#session-settings-form");
  const model = $("#composer-model");
  const reasoning = $("#composer-reasoning");
  if (!form || !model || !reasoning) return;
  const backend = normalizeAgentBackend(form.elements.backend?.value || activeSettingsBackend());
  syncModelSelectOptions(form.elements.model, backend, model.value || defaultSettingsForBackend(backend).model);
  syncReasoningSelectOptions(reasoning, backend, model.value, reasoning.value);
  syncReasoningSelectOptions(form.elements.reasoningEffort, backend, model.value, reasoning.value);
  form.elements.reasoningEffort.value = normalizeReasoningEffort(reasoning.value, backend, model.value);
  settingsFromForm();
  fitComposerSelectWidths();
}

function normalizeReasoningEffort(value, backend = "", model = "") {
  const reasoning = String(value || "").trim();
  const options = reasoningOptionsForBackendModel(backend, model);
  const allowed = new Set(options.map(([optionValue]) => optionValue));
  return allowed.has(reasoning) ? reasoning : defaultReasoningEffortForBackendModel(backend, model);
}

function normalizeReviewCheckpointInterval(value) {
  const interval = Number(String(value ?? "").trim());
  return Number.isInteger(interval) && interval > 0 ? interval : defaultSessionSettings.reviewCheckpointInterval;
}

function inferPermissionPreset(settings = {}) {
  const backend = normalizeAgentBackend(settings.backend);
  const explicit = String(settings.permissionPreset || "").trim();
  const presets = permissionPresetsForBackend(backend);
  if (presets[explicit]) return explicit;
  if (backend === "claude") {
    if (legacyClaudePermissionPresets[explicit]) return legacyClaudePermissionPresets[explicit];
    const mode = String(settings.permissionMode || "").trim();
    if (presets[mode]) return mode;
    return defaultClaudeSessionSettings.permissionPreset;
  }
  const sandbox = String(settings.sandbox || "").trim();
  const approvalPolicy = String(settings.approvalPolicy || "").trim();
  if (sandbox === "danger-full-access" && approvalPolicy === "never") return "full-access";
  if (sandbox === "workspace-write" && approvalPolicy === "never") return "auto-review";
  return defaultSessionSettings.permissionPreset;
}

function normalizePermissionPreset(value, settings = {}) {
  const backend = normalizeAgentBackend(settings.backend);
  const preset = String(value || "").trim();
  return permissionPresetsForBackend(backend)[preset] ? preset : inferPermissionPreset({ ...settings, permissionPreset: preset });
}

function normalizeSessionSettings(settings = {}) {
  const backend = normalizeAgentBackend(settings?.backend || settings?.agent?.backend || activeSettingsBackend());
  const defaults = defaultSettingsForBackend(backend);
  const merged = { ...defaults, ...(settings || {}), backend };
  const allowedModels = new Set(modelOptionsForBackend(backend).map(([value]) => value));
  if (!merged.model || (backend === "codex" && !allowedModels.has(merged.model))) merged.model = defaults.model;
  if (backend === "claude") {
    const claudeModel = String(merged.model || "").trim();
    // A claude model is valid if it is a known alias/discovered option, or a full
    // Claude/custom gateway model ID. Anything else (e.g. a leftover codex
    // "gpt-5.5") is rejected.
    const validClaudeModel =
      Boolean(claudeModel) &&
      !isKnownCodexModel(claudeModel) &&
      (allowedModels.has(claudeModel) || isValidCustomClaudeModel(claudeModel));
    if (!validClaudeModel) merged.model = defaults.model;
    merged.provider = normalizeClaudeProvider(merged.provider);
  } else {
    merged.provider = normalizeCodexProvider(merged.provider);
  }
  merged.reasoningEffort = normalizeReasoningEffort(merged.reasoningEffort, backend, merged.model);
  merged.reviewCheckpointInterval = normalizeReviewCheckpointInterval(merged.reviewCheckpointInterval);
  merged.fastMode = Boolean(merged.fastMode);
  merged.preExecScript = String(merged.preExecScript || "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\0", "").trim().slice(0, 4000);
  merged.permissionPreset = normalizePermissionPreset(merged.permissionPreset, merged);
  if (backend === "claude") {
    merged.permissionMode = permissionPresetForBackend(backend, merged.permissionPreset).permissionMode || defaultClaudeSessionSettings.permissionMode;
    delete merged.sandbox;
    delete merged.approvalPolicy;
  } else {
    Object.assign(merged, permissionPresetForBackend(backend, merged.permissionPreset));
  }
  if (backend === "codex" && !allowedApprovalPolicies.has(merged.approvalPolicy)) {
    Object.assign(merged, permissionPresetForBackend(backend, defaultSessionSettings.permissionPreset));
    merged.permissionPreset = defaultSessionSettings.permissionPreset;
  }
  return merged;
}

function applySessionSettings(settings, persist = false) {
  const merged = normalizeSessionSettings(settings);
  const form = $("#session-settings-form");
  const backend = normalizeAgentBackend(merged.backend);
  if (form.elements.backend) form.elements.backend.value = backend;
  syncModelSelectOptions(form.elements.model, backend, merged.model);
  form.elements.model.value = merged.model || "";
  syncReasoningSelectOptions(form.elements.reasoningEffort, backend, merged.model, merged.reasoningEffort);
  form.elements.reasoningEffort.value = merged.reasoningEffort;
  syncPermissionSelectOptions(form.elements.permissionPreset, backend, merged.permissionPreset);
  form.elements.permissionPreset.value = merged.permissionPreset;
  form.elements.webSearch.checked = Boolean(merged.webSearch);
  if (form.elements.fastMode) form.elements.fastMode.checked = Boolean(merged.fastMode);
  form.elements.extraConfig.value = merged.extraConfig || "";
  if (form.elements.reviewCheckpointInterval) form.elements.reviewCheckpointInterval.value = merged.reviewCheckpointInterval;
  if (persist) persistSessionSettings(merged);
  renderSettingsSummary(merged);
  syncComposerSettings(merged);
  renderAllAgentStatusNotes();
  renderResumeCommandBar();
}

function switchSessionBackend(backend) {
  const normalized = normalizeAgentBackend(backend);
  const scoped = scopedSessionSettings();
  applySessionSettings({
    ...providerSettingsFromUi(normalized),
    ...providerSettingsFromScoped(scoped, normalized),
    backend: normalized,
  }, true);
  if (activePanel === "manuscript") renderContext();
}

function restoreSessionSettings() {
  applySessionSettings(mergedProjectSessionSettings(uiSettings || {}));
}

function settingsLabel(settings) {
  const normalized = normalizeSessionSettings(settings || defaultSessionSettings);
  const parts = [];
  parts.push(agentLabel(normalized.backend));
  if (normalized.model) parts.push(normalized.model);
  parts.push(labelForReasoning(normalized.reasoningEffort, normalized.backend, normalized.model));
  parts.push(permissionPresetForBackend(normalized.backend, normalized.permissionPreset)?.label || "Default permissions");
  if (normalized.fastMode) parts.push("fast");
  parts.push(`review ${normalized.reviewCheckpointInterval}`);
  if (normalized.webSearch) parts.push("web");
  return parts.join(" / ");
}

function labelForReasoning(value, backend = "", model = "") {
  const normalized = normalizeReasoningEffort(value, backend, model);
  const labels = { "": "Default effort", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
  return labels[normalized] || "Default effort";
}

function renderSettingsSummary(settings) {
  const label = settingsLabel(settings || defaultSessionSettings);
  const summary = $("#settings-summary");
  if (summary) summary.textContent = label;
  $("#session-settings").textContent = `Settings: ${label}`;
}

function switchSettingsTab(tab) {
  const target = tab || "general";
  $$(".settings-nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.settingsTab === target);
  });
  $$(".settings-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.settingsPanel === target);
  });
}

function stripBackendSetting(settings) {
  const copy = { ...settings };
  delete copy.backend;
  return copy;
}

function publicCodexEnv(settings = uiSettings || {}) {
  const payload = settings?.codex_env;
  return payload && typeof payload === "object" ? payload : {};
}

function publicCodexEnvPresent(settings = uiSettings || {}) {
  const present = publicCodexEnv(settings).present;
  return present && typeof present === "object" ? present : {};
}

function publicClaudeEnv(settings = uiSettings || {}) {
  const payload = settings?.claude_env;
  return payload && typeof payload === "object" ? payload : {};
}

function publicClaudeEnvValues(settings = uiSettings || {}) {
  const values = publicClaudeEnv(settings).values;
  return values && typeof values === "object" ? values : {};
}

function publicClaudeEnvPresent(settings = uiSettings || {}) {
  const present = publicClaudeEnv(settings).present;
  return present && typeof present === "object" ? present : {};
}

function codexProviderFromSettings(settings = uiSettings || {}) {
  return normalizeCodexProvider(settings?.codex?.provider || publicCodexEnv(settings).provider || defaultCodexSessionSettings.provider);
}

function claudeProviderFromSettings(settings = uiSettings || {}) {
  return normalizeClaudeProvider(settings?.claude?.provider || publicClaudeEnv(settings).provider || defaultClaudeSessionSettings.provider);
}

function claudeGatewayFieldValue(settings, key, provider) {
  const normalizedProvider = normalizeClaudeProvider(provider);
  const savedProvider = claudeProviderFromSettings(settings);
  if (normalizedProvider === "zai_glm" && savedProvider !== "zai_glm") {
    return zaiClaudeEnvDefaults[key] || "";
  }
  const values = publicClaudeEnvValues(settings);
  const saved = String(values[key] || "").trim();
  if (saved) return saved;
  return normalizedProvider === "zai_glm" ? (zaiClaudeEnvDefaults[key] || "") : "";
}

function codexEnvPayloadFromModal() {
  const form = $("#settings-form");
  const provider = normalizeCodexProvider(form.elements.settingsCodexProvider?.value || codexProviderFromSettings());
  const env = {};
  const clear = [];
  if (provider !== "openai_api_key") return { env, clear };
  const apiKey = String(form.elements.settingsCodexApiKey?.value || "").trim();
  if (apiKey) env.OPENAI_API_KEY = apiKey;
  return { env, clear };
}

function claudeEnvPayloadFromModal() {
  const form = $("#settings-form");
  const provider = normalizeClaudeProvider(form.elements.settingsClaudeProvider?.value || claudeProviderFromSettings());
  const env = {};
  const clear = [];
  if (provider === "external") {
    return { env, clear };
  }

  if (provider === "anthropic_api_key") {
    const apiKey = String(form.elements.settingsClaudeApiKey?.value || "").trim();
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
    return { env, clear };
  }

  const authMethod = String(form.elements.settingsClaudeAuthMethod?.value || "ANTHROPIC_AUTH_TOKEN").trim();
  const credentialKey = claudeGatewaySecretKeys.has(authMethod) ? authMethod : "ANTHROPIC_AUTH_TOKEN";
  const credentialValue = String(form.elements.settingsClaudeCredential?.value || "").trim();
  const nonSecretFields = {
    ANTHROPIC_BASE_URL: String(form.elements.settingsClaudeBaseUrl?.value || "").trim(),
    ANTHROPIC_DEFAULT_SONNET_MODEL: String(form.elements.settingsClaudeSonnetModel?.value || "").trim(),
    ANTHROPIC_DEFAULT_OPUS_MODEL: String(form.elements.settingsClaudeOpusModel?.value || "").trim(),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: String(form.elements.settingsClaudeHaikuModel?.value || "").trim(),
  };
  const base = provider === "zai_glm" ? { ...zaiClaudeEnvDefaults, ...nonSecretFields } : nonSecretFields;
  Object.entries(base).forEach(([key, value]) => {
    const text = String(value || "").trim();
    if (text) env[key] = text;
    else clear.push(key);
  });
  if (provider === "zai_glm") {
    env.API_TIMEOUT_MS = zaiClaudeEnvDefaults.API_TIMEOUT_MS;
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = zaiClaudeEnvDefaults.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = zaiClaudeEnvDefaults.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  }
  if (credentialValue) {
    env[credentialKey] = credentialValue;
    clear.push(credentialKey === "ANTHROPIC_AUTH_TOKEN" ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN");
  }
  return { env, clear };
}

function settingsProviderFromModal(backend) {
  const form = $("#settings-form");
  const data = new FormData(form);
  const normalizedBackend = normalizeAgentBackend(backend);
  const permissionPreset = normalizePermissionPreset(data.get("settingsPermissionPreset"), { backend: normalizedBackend });
  return normalizeSessionSettings({
    backend: normalizedBackend,
    model: String(data.get("settingsModel") || "").trim(),
    reasoningEffort: normalizeReasoningEffort(data.get("settingsReasoningEffort"), normalizedBackend, String(data.get("settingsModel") || "").trim()),
    permissionPreset,
    ...permissionPresetForBackend(normalizedBackend, permissionPreset),
    webSearch: Boolean(data.get("settingsWebSearch")),
    extraConfig: String(data.get("settingsExtraConfig") || "").trim(),
    preExecScript: String(data.get(normalizedBackend === "claude" ? "settingsClaudePreExecScript" : "settingsCodexPreExecScript") || ""),
    reviewCheckpointInterval: normalizeReviewCheckpointInterval(data.get("settingsReviewCheckpointInterval")),
    provider: normalizedBackend === "claude"
      ? normalizeClaudeProvider(data.get("settingsClaudeProvider") || claudeProviderFromSettings())
      : normalizeCodexProvider(data.get("settingsCodexProvider") || codexProviderFromSettings()),
  });
}

function settingsPayloadFromModal() {
  const form = $("#settings-form");
  const backend = normalizeAgentBackend(form.elements.settingsBackend?.value || activeSettingsBackend());
  const codex = normalizeSessionSettings({ ...(uiSettings?.codex || defaultCodexSessionSettings), backend: "codex" });
  const claude = normalizeSessionSettings({ ...(uiSettings?.claude || defaultClaudeSessionSettings), backend: "claude" });
  const current = settingsProviderFromModal(backend);
  return {
    agent: { backend },
    codex: stripBackendSetting(backend === "codex" ? current : codex),
    claude: stripBackendSetting(backend === "claude" ? current : claude),
  };
}

function codexSettingsFromModal() {
  return stripBackendSetting(settingsProviderFromModal("codex"));
}

function hydrateSettingsDialog(settings) {
  const form = $("#settings-form");
  const backend = normalizeAgentBackend(settings?.agent?.backend || activeSettingsBackend());
  const provider = normalizeSessionSettings({ ...(settings?.[backend] || providerSettingsFromUi(backend)), backend });
  hydrateThemeControls();
  if (form.elements.settingsBackend) form.elements.settingsBackend.value = backend;
  syncModelSelectOptions(form.elements.settingsModel, backend, provider.model);
  syncReasoningSelectOptions(form.elements.settingsReasoningEffort, backend, provider.model, provider.reasoningEffort);
  form.elements.settingsReasoningEffort.value = provider.reasoningEffort;
  syncPermissionSelectOptions(form.elements.settingsPermissionPreset, backend, provider.permissionPreset);
  form.elements.settingsPermissionPreset.value = provider.permissionPreset;
  form.elements.settingsWebSearch.checked = Boolean(provider.webSearch);
  form.elements.settingsExtraConfig.value = provider.extraConfig || "";
  const codexProvider = normalizeSessionSettings({ ...(settings?.codex || defaultCodexSessionSettings), backend: "codex" });
  const claudeProvider = normalizeSessionSettings({ ...(settings?.claude || defaultClaudeSessionSettings), backend: "claude" });
  if (form.elements.settingsCodexPreExecScript) form.elements.settingsCodexPreExecScript.value = codexProvider.preExecScript || "";
  if (form.elements.settingsClaudePreExecScript) form.elements.settingsClaudePreExecScript.value = claudeProvider.preExecScript || "";
  if (form.elements.settingsReviewCheckpointInterval) form.elements.settingsReviewCheckpointInterval.value = provider.reviewCheckpointInterval;
  hydrateCodexProviderSettings(settings, backend, provider.provider);
  hydrateClaudeProviderSettings(settings, backend, provider.provider);
  renderAgentStatusNote("#settings-agent-status", backend, "settings");

  const envPresent = settings?.env_present || {};
  const keys = settingsSecretKeys.length ? settingsSecretKeys : Object.keys(secretKeyLabels);
  $("#settings-secret-grid").innerHTML = keys
    .map((key) => {
      const saved = Boolean(envPresent[key]);
      const inputType = key.endsWith("_URL") ? "url" : "password";
      return `
        <label class="settings-secret-card">
          <span class="settings-secret-head">
            <span>
              <strong>${escapeHtml(secretKeyLabels[key] || key)}</strong>
              <em>${escapeHtml(key)}</em>
            </span>
            ${
              saved
                ? `<button class="settings-clear-button" type="button" data-clear-secret="${escapeHtml(key)}">Clear project override</button>`
                : `<span class="secret-status">No project override</span>`
            }
          </span>
          <input name="env_${escapeHtml(key)}" type="${inputType}" placeholder="${saved ? "Project override saved - leave blank to keep" : "Paste value"}" autocomplete="off" />
          <span class="settings-secret-help">${escapeHtml(secretKeyHelp[key] || "Passed to selected agent subprocesses.")}</span>
        </label>
      `;
    })
    .join("");
}

function hydrateCodexProviderSettings(settings = uiSettings || {}, backend = activeSettingsBackend(), providerOverride = "") {
  const form = $("#settings-form");
  if (!form) return;
  const isCodex = normalizeAgentBackend(backend) === "codex";
  const provider = normalizeCodexProvider(providerOverride || settings?.codex?.provider || defaultCodexSessionSettings.provider);
  if (form.elements.settingsCodexProvider) form.elements.settingsCodexProvider.value = provider;
  document.querySelectorAll("[data-codex-provider-field]").forEach((node) => {
    node.hidden = !isCodex;
  });
  const panel = $("#codex-api-key-settings");
  if (panel) panel.hidden = !isCodex || provider !== "openai_api_key";
  if (!isCodex) return;

  const envPresent = publicCodexEnvPresent(settings);
  const saved = Boolean(envPresent.OPENAI_API_KEY);
  if (form.elements.settingsCodexApiKey) {
    form.elements.settingsCodexApiKey.value = "";
    form.elements.settingsCodexApiKey.placeholder = saved ? "Project override saved - leave blank to keep" : "Paste OpenAI API key";
  }
  const status = $("#settings-codex-api-key-status");
  setProviderSecretStatus(status, saved ? "Project override saved" : "No project key saved", saved ? "saved" : "missing");
  const clearButton = $("#settings-codex-api-key-clear");
  if (clearButton) {
    clearButton.hidden = !saved;
    clearButton.dataset.clearCodexSecret = "OPENAI_API_KEY";
  }
}

function hydrateClaudeProviderSettings(settings = uiSettings || {}, backend = activeSettingsBackend(), providerOverride = "") {
  const form = $("#settings-form");
  if (!form) return;
  const isClaude = normalizeAgentBackend(backend) === "claude";
  const provider = normalizeClaudeProvider(providerOverride || settings?.claude?.provider || defaultClaudeSessionSettings.provider);
  if (form.elements.settingsClaudeProvider) form.elements.settingsClaudeProvider.value = provider;
  document.querySelectorAll("[data-claude-provider-field]").forEach((node) => {
    node.hidden = !isClaude;
  });
  const panel = $("#claude-gateway-settings");
  if (panel) panel.hidden = !isClaude || !["zai_glm", "custom_anthropic"].includes(provider);
  const apiKeyPanel = $("#claude-api-key-settings");
  if (apiKeyPanel) apiKeyPanel.hidden = !isClaude || provider !== "anthropic_api_key";
  if (!isClaude) return;

  const envPresent = publicClaudeEnvPresent(settings);
  const authTokenSaved = Boolean(envPresent.ANTHROPIC_AUTH_TOKEN);
  const apiKeySaved = Boolean(envPresent.ANTHROPIC_API_KEY);
  const defaultAuth = apiKeySaved && !authTokenSaved ? "ANTHROPIC_API_KEY" : "ANTHROPIC_AUTH_TOKEN";
  if (form.elements.settingsClaudeAuthMethod) form.elements.settingsClaudeAuthMethod.value = defaultAuth;
  if (form.elements.settingsClaudeBaseUrl) form.elements.settingsClaudeBaseUrl.value = claudeGatewayFieldValue(settings, "ANTHROPIC_BASE_URL", provider);
  if (form.elements.settingsClaudeSonnetModel) form.elements.settingsClaudeSonnetModel.value = claudeGatewayFieldValue(settings, "ANTHROPIC_DEFAULT_SONNET_MODEL", provider);
  if (form.elements.settingsClaudeOpusModel) form.elements.settingsClaudeOpusModel.value = claudeGatewayFieldValue(settings, "ANTHROPIC_DEFAULT_OPUS_MODEL", provider);
  if (form.elements.settingsClaudeHaikuModel) form.elements.settingsClaudeHaikuModel.value = claudeGatewayFieldValue(settings, "ANTHROPIC_DEFAULT_HAIKU_MODEL", provider);
  if (form.elements.settingsClaudeCredential) {
    form.elements.settingsClaudeCredential.value = "";
    form.elements.settingsClaudeCredential.placeholder = authTokenSaved || apiKeySaved ? "Project override saved - leave blank to keep" : "Paste gateway credential";
  }
  if (form.elements.settingsClaudeApiKey) {
    form.elements.settingsClaudeApiKey.value = "";
    form.elements.settingsClaudeApiKey.placeholder = apiKeySaved ? "Project override saved - leave blank to keep" : "Paste Anthropic API key";
  }
  const apiKeyStatus = $("#settings-claude-api-key-status");
  setProviderSecretStatus(apiKeyStatus, apiKeySaved ? "Project override saved" : "No project key saved", apiKeySaved ? "saved" : "missing");
  const apiKeyClearButton = $("#settings-claude-api-key-clear");
  if (apiKeyClearButton) {
    apiKeyClearButton.hidden = !apiKeySaved;
    apiKeyClearButton.dataset.clearClaudeSecret = "ANTHROPIC_API_KEY";
  }
  const status = $("#settings-claude-credential-status");
  const clearButton = $("#settings-claude-credential-clear");
  const savedCredentialKey = authTokenSaved ? "ANTHROPIC_AUTH_TOKEN" : apiKeySaved ? "ANTHROPIC_API_KEY" : "";
  setProviderSecretStatus(status, savedCredentialKey ? "Project override saved" : "No project key saved", savedCredentialKey ? "saved" : "missing");
  if (clearButton) {
    clearButton.hidden = !savedCredentialKey;
    clearButton.dataset.clearClaudeSecret = savedCredentialKey;
  }
}

function setProviderSecretStatus(node, text, state) {
  if (!node) return;
  node.textContent = text;
  node.dataset.state = state || "";
}

function setProviderSecretDraftStatus(input, status, saved, savedText, missingText, pendingText = "Unsaved key") {
  const hasDraft = Boolean(String(input?.value || "").trim());
  if (hasDraft) {
    setProviderSecretStatus(status, pendingText, "pending");
    return;
  }
  setProviderSecretStatus(status, saved ? savedText : missingText, saved ? "saved" : "missing");
}

function refreshCodexApiKeyDraftStatus() {
  const form = $("#settings-form");
  setProviderSecretDraftStatus(
    form?.elements?.settingsCodexApiKey,
    $("#settings-codex-api-key-status"),
    Boolean(publicCodexEnvPresent(uiSettings || {}).OPENAI_API_KEY),
    "Project override saved",
    "No project key saved",
    "Unsaved project key"
  );
}

function refreshClaudeApiKeyDraftStatus() {
  const form = $("#settings-form");
  setProviderSecretDraftStatus(
    form?.elements?.settingsClaudeApiKey,
    $("#settings-claude-api-key-status"),
    Boolean(publicClaudeEnvPresent(uiSettings || {}).ANTHROPIC_API_KEY),
    "Project override saved",
    "No project key saved",
    "Unsaved project key"
  );
}

function refreshClaudeCredentialDraftStatus() {
  const form = $("#settings-form");
  const present = publicClaudeEnvPresent(uiSettings || {});
  const savedKey = present.ANTHROPIC_AUTH_TOKEN ? "ANTHROPIC_AUTH_TOKEN" : present.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "";
  setProviderSecretDraftStatus(
    form?.elements?.settingsClaudeCredential,
    $("#settings-claude-credential-status"),
    Boolean(savedKey),
    "Project override saved",
    "No project key saved",
    "Unsaved project credential"
  );
}

function switchSettingsBackend(backend) {
  const normalized = normalizeAgentBackend(backend);
  const form = $("#settings-form");
  if (form?.elements?.settingsBackend) form.elements.settingsBackend.value = normalized;
  hydrateSettingsDialog({
    ...(uiSettings || {}),
    agent: { backend: normalized },
  });
}

async function loadUiSettings() {
  try {
    const payload = await api("/api/settings");
    uiSettings = payload.settings || {};
    settingsSecretKeys = payload.secret_keys || Object.keys(secretKeyLabels);
    hydrateSettingsDialog(uiSettings);
    restoreSessionSettings();
    renderAllAgentStatusNotes();
    renderAgentStatusBanner();
    refreshDiscoveredModels().then((updated) => {
      // Only repaint selects if discovery actually added options, AND never while
      // a dialog is open — rebuilding a <select> mid-interaction collapses it.
      // Hydrate already set correct options before the dialog opened; the
      // discovered extras get applied on the next open instead.
      if (updated && !document.querySelector("dialog[open]")) resyncAllModelSelects();
    });
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveUiSettings(event) {
  event.preventDefault();
  const submit = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  try {
    await withButtonFeedback(submit, async () => {
      const form = $("#settings-form");
      const env = {};
      const clearEnv = [];
      applyThemeMode(form.elements.themeMode?.value || currentThemeMode);
      const keys = settingsSecretKeys.length ? settingsSecretKeys : Object.keys(secretKeyLabels);
      keys.forEach((key) => {
        const value = String(form.elements[`env_${key}`]?.value || "").trim();
        if (value) env[key] = value;
      });
      const settingsPayload = settingsPayloadFromModal();
      const codexEnvPayload = codexEnvPayloadFromModal();
      const claudeEnvPayload = claudeEnvPayloadFromModal();
      const payload = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          ...settingsPayload,
          env,
          clear_env: clearEnv,
          codex_env: codexEnvPayload.env,
          clear_codex_env: codexEnvPayload.clear,
          claude_env: claudeEnvPayload.env,
          clear_claude_env: claudeEnvPayload.clear,
        }),
      });
      uiSettings = payload.settings || {};
      settingsSecretKeys = payload.secret_keys || settingsSecretKeys;
      hydrateSettingsDialog(uiSettings);
      // Force the per-project scoped session envelope to follow Settings completely;
      // stale browser-only overrides must not shadow saved project runtime settings.
      const savedBackend = normalizeAgentBackend(uiSettings?.agent?.backend || "");
      persistProjectSessionSettings(uiSettings);
      const merged = normalizeSessionSettings({
        ...providerSettingsFromUi(savedBackend),
        ...(uiSettings?.[savedBackend] || {}),
        backend: savedBackend,
      });
      applySessionSettings(merged, false);
      renderAgentStatusBanner();
      showToast("Settings saved locally.");
    });
  } catch (error) {
    showToast(error.message, true);
  }
}

async function clearSavedSecret(key) {
  if (!settingsSecretKeys.includes(key)) return;
  const settingsPayload = settingsPayloadFromModal();
  const payload = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ ...settingsPayload, env: {}, clear_env: [key] }),
  });
  uiSettings = payload.settings || {};
  settingsSecretKeys = payload.secret_keys || settingsSecretKeys;
  hydrateSettingsDialog(uiSettings);
  persistProjectSessionSettings(uiSettings);
  applySessionSettings(mergedProjectSessionSettings(uiSettings), false);
  showToast(`${secretKeyLabels[key] || key} project override cleared.`);
}

async function clearSavedCodexSecret(key) {
  if (!codexSecretKeys.has(key)) return;
  const settingsPayload = settingsPayloadFromModal();
  const payload = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ ...settingsPayload, codex_env: {}, clear_codex_env: [key] }),
  });
  uiSettings = payload.settings || {};
  hydrateSettingsDialog(uiSettings);
  persistProjectSessionSettings(uiSettings);
  applySessionSettings(mergedProjectSessionSettings(uiSettings), false);
  showToast(`${key} project override cleared.`);
}

async function clearSavedClaudeSecret(key) {
  if (!claudeGatewaySecretKeys.has(key)) return;
  const settingsPayload = settingsPayloadFromModal();
  const payload = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ ...settingsPayload, claude_env: {}, clear_claude_env: [key] }),
  });
  uiSettings = payload.settings || {};
  hydrateSettingsDialog(uiSettings);
  persistProjectSessionSettings(uiSettings);
  applySessionSettings(mergedProjectSessionSettings(uiSettings), false);
  showToast(`${key} project override cleared.`);
}

function setPanel(panel, options = {}) {
  const targetPanel = normalizeNavigationPanel(panel);
  if (appState && visiblePanels()[targetPanel] === false) {
    showToast(`${panelTitles[targetPanel] || targetPanel} has no content yet.`);
    return;
  }
  const previousPanel = activeNavigationPanel();
  const enteringChatFromOtherPanel = targetPanel === "chat" && previousPanel !== "chat";
  if (targetPanel !== previousPanel) persistActiveViewScrollPosition();
  activeView = targetPanel === "chat" ? "chat" : "materials";
  if (targetPanel !== "chat") activePanel = normalizeMaterialPanel(targetPanel);
  persistNavigationState({ updateUrl: true });

  renderRailVisibility();

  if (activeView === "chat") {
    if (options.scrollToLatest ?? enteringChatFromOtherPanel) markChatScrollRestoredForCurrentProject();
    renderFramingConversation();
    if (options.scrollToLatest ?? enteringChatFromOtherPanel) scrollFramingToBottomSoon();
    else restoreActiveViewScrollPosition();
    return;
  }
  syncBriefComposerDock(false);
  renderComposerSuggestions();
  $("#material-title").textContent = panelTitles[activePanel] || "Resources";
  renderContext();
}

function setStage(stage) {
  const target = String(stage || "1");
  if (!canOpenStage(target)) {
    showToast(stageBlockedMessage(target), true);
    return;
  }
  activeStage = target;
  renderStage();
  renderChatState();
}

function stageTitle() {
  if (activeStage === "1") return "Where should the research begin?";
  if (activeStage === "2") return "Start autoresearch.";
  if (activeStage === "3") return hasLaunched() ? "Continue the research thread." : "Message session after launch.";
  return "";
}

function renderStage() {
  const launched = hasLaunched();
  activeStage = "1";
  $(".chat-header")?.classList.toggle("is-framing", true);
  $$(".stage-pill").forEach((button) => {
    const stage = button.dataset.stage;
    const locked = !canOpenStage(stage);
    button.classList.toggle("is-active", stage === activeStage);
    button.classList.toggle("is-complete", (stage === "1" && (prepareSaved || launched)) || (stage === "2" && launched));
    button.classList.toggle("is-locked", locked);
    button.disabled = locked;
    button.setAttribute("aria-disabled", locked ? "true" : "false");
  });
  $$("[data-stage-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.stagePanel !== activeStage;
    panel.classList.toggle("is-active", panel.dataset.stagePanel === activeStage);
  });
  const launchButton = $("#launch-autoresearch");
  if (launchButton) {
    const draft = currentProjectDraft();
    const locked = !prepareSaved && (!draft.trim() || isPlaceholderProject(draft));
    const gatePassed = sessionState()?.gate?.status === "pass";
    const goalStarted = hasGoalStarted() || visibleTrials().length > 0;
    const resourceBlocked = hasBlockingResourceImports();
    const blockedAgent = launchBlockingStatus();
    launchButton.disabled = locked || isSessionRunning() || gatePassed || resourceBlocked || Boolean(blockedAgent);
    launchButton.textContent = gatePassed ? "Reviewer gates passed" : goalStarted ? "Continue autoresearch" : "Start autoresearch";
    launchButton.title = resourceBlocked
      ? blockingResourceImportMessage()
      : gatePassed
      ? "All reviewer gates have passed."
      : blockedAgent
        ? blockedAgent.message || `${agentLabel(effectiveBackend(currentLaunchBackend()))} is not ready.`
      : locked
        ? "Finish PROJECT.md before starting autoresearch."
        : "Run the autoresearch loop until strict reviewer gates pass.";
  }
  renderAllAgentStatusNotes();
  renderFramingConversation();
}

function renderChatState() {
  if (isProjectLoading()) {
    renderProjectLoadingState();
    renderProjectLaunchFallbackPanel(false);
    $("#chat-thread").hidden = true;
    $("#framing-thread").hidden = true;
    $("#cold-start-workspace")?.classList.remove("has-framing-thread");
    $("#open-launch-dialog")?.toggleAttribute("hidden", true);
    $("#open-launch-dialog-inline")?.toggleAttribute("hidden", true);
    $("#session-pill")?.toggleAttribute("hidden", true);
    $("#resume-command-bar")?.toggleAttribute("hidden", true);
    const textarea = $("#chat-form textarea");
    const send = $("#chat-form .send-button");
    const cont = $("#continue-research");
    if (textarea) {
      textarea.disabled = true;
      textarea.placeholder = "Opening project...";
    }
    if (send) send.disabled = true;
    if (cont) cont.disabled = true;
    renderComposerActionButtons();
    renderComposerSuggestions();
    syncBriefComposerDock(false);
    renderAutoresearchDock("", false);
    return;
  }
  const session = sessionState();
  const launched = hasLaunched();
  const running = isSessionRunning();
  activeStage = "1";
  const sessionStage = $(".session-stage");
  if (sessionStage) {
    sessionStage.classList.toggle("is-locked", !launched);
    sessionStage.classList.toggle("is-ready", launched);
  }
  $("#chat-thread").hidden = true;
  const gateStatus = session?.gate?.status || "";
  const loopIteration = Number(session?.loop_iteration || 0);
  const projectName = currentProjectName();
  const eyebrow = $("#chat-eyebrow");
  if (eyebrow) eyebrow.textContent = `${projectName} / Project framing`;
  $("#chat-title").textContent = launched
    ? running
      ? `Autoresearch loop is running${loopIteration ? `, trial ${loopIteration}` : ""}.`
      : gateStatus === "pass"
        ? "Reviewer gates passed."
        : "Continue the autoresearch loop."
    : stageTitle();
  const sessionPill = $("#session-pill");
  sessionPill.textContent = session.session_id
    ? `${gateStatus === "pass" ? "Passed" : session.loop_active ? "Loop" : "Session"} ${session.session_id.slice(0, 8)}`
    : running ? "Launching" : "";
  sessionPill.hidden = !launched && !running;
  renderResumeCommandBar();
  renderStage();

  const textarea = $("#chat-form textarea");
  const send = $("#chat-form .send-button");
  const cont = $("#continue-research");
  const resourceBlocked = hasBlockingResourceImports();
  const canQueue = canQueueComposerWhileRunning();
  textarea.disabled = !(canMessage() || canQueue);
  send.disabled = !(canMessage() || canQueue) || resourceBlocked;
  cont.disabled = !canMessage() || resourceBlocked;
  textarea.placeholder = canQueue
    ? "Queue a follow-up for when the agent finishes..."
    : canMessage()
      ? "Steer the research, add constraints, answer questions, or ask for status..."
      : "Run cold start before messaging...";
  renderComposerActionButtons();
  renderComposerSuggestions();
  renderChatSummary();
}

function coldComposerPlaceholder(hasFramingThread) {
  if (isProjectLoading()) return "Opening project...";
  if (canQueueComposerWhileRunning()) {
    return "Queue a follow-up for when the agent finishes...";
  }
  if (hasLaunched()) {
    return "Steer the research, add constraints, answer questions, or ask for status...";
  }
  if (hasProjectDraftReady()) {
    return "Refine the research direction, scope, venue, or constraints before autoresearch starts...";
  }
  return hasFramingThread
    ? "Ask a follow-up, describe the project, attach materials, or discuss next steps..."
    : "Ask a question, describe the project, attach materials, or discuss next steps...";
}

function renderColdStartEditor() {
  const files = appState?.cold_start_files || [];
  if (!files.length) return;
  if (!activeColdPath) activeColdPath = files[0].path;

  $("#launch-files").innerHTML = "";
  $("#cold-file-tabs").innerHTML = "";
  $("#cold-editor-title").textContent = "Research brief";
  $("#cold-editor-path").textContent = appState?.cold_start_files?.[0]?.derived_from_project
    ? "Drafted from existing PROJECT.md. Edit before launch."
    : "Saved to resources/user_input/INITIAL_BRIEF.md";
  const editor = $("#cold-file-editor");
  if (isProjectLoading()) {
    editor.placeholder = "Opening project...";
    editor.disabled = true;
    return;
  }
  const hasFramingThread = localMessages.length > 0 || framingDraftPending || framingReplyPending;
  const currentEditorValue = String(editor.value || "");
  const sessionComposerMode = hasProjectDraftReady() || hasLaunched() || hasFramingThread;
  if (sessionComposerMode && document.activeElement === editor) {
    persistComposerDraft(currentEditorValue);
  }
  const savedComposerDraft = composerDraft || storedComposerDraft();
  const nextEditorValue = sessionComposerMode
    ? (currentEditorValue || savedComposerDraft || "")
    : (savedComposerDraft || coldFiles[activeColdPath] || "");
  editor.placeholder = coldComposerPlaceholder(hasFramingThread);
  if (document.activeElement !== editor && editor.value !== nextEditorValue) {
    editor.value = nextEditorValue;
  }
  composerDraft = String(editor.value || nextEditorValue || "");
  resizeColdEditor();
  setColdSaveStatus(coldDirty ? "Unsaved changes" : "Autosaved", coldDirty ? "pending" : "saved");
  renderColdPreview();
  setColdViewMode("source", { persist: false });
  renderComposerActionButtons();
  renderFramingConversation();
}

function renderColdPreview() {
  const preview = $("#cold-file-preview");
  if (!preview) return;
  const text = $("#cold-file-editor")?.value || coldFiles[activeColdPath] || "";
  if (extension(activeColdPath) === ".md") {
    preview.innerHTML = markdownToHtml(text);
  } else {
    preview.innerHTML = `<pre><code>${escapeHtml(text || "No content yet.")}</code></pre>`;
  }
}

function setColdViewMode(mode, options = {}) {
  const nextMode = mode === "rendered" ? "rendered" : "source";
  const { persist = true } = options;
  if (activeColdPath) coldFiles[activeColdPath] = $("#cold-file-editor")?.value || coldFiles[activeColdPath] || "";
  coldViewMode = nextMode;
  renderColdPreview();
  const workbench = $("#cold-editor-workbench");
  if (workbench) {
    workbench.classList.toggle("is-source", coldViewMode === "source");
    workbench.classList.toggle("is-rendered", coldViewMode === "rendered");
  }
  $$("[data-cold-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.coldView === coldViewMode);
  });
}

function switchColdFile(path) {
  if (activeColdPath) coldFiles[activeColdPath] = $("#cold-file-editor").value;
  activeColdPath = path;
  renderColdStartEditor();
}

async function saveColdFiles(options = {}) {
  const { silent = false, refresh = true, markPrepared = true } = options;
  if (activeColdPath) coldFiles[activeColdPath] = $("#cold-file-editor").value;
  const edits = Object.entries(coldFiles).map(([path, text]) => ({ path, text }));
  await Promise.all(edits.map((edit) => api("/api/file/save", {
    method: "POST",
    body: JSON.stringify({ ...edit, record: false }),
  })));
  coldDirty = false;
  if (markPrepared) markPrepareSaved(true);
  if (!silent) showToast("Brief saved.");
  if (refresh) await loadOverview(true);
}

function pill(value, tone = "") {
  return `<span class="pill ${tone}">${escapeHtml(cleanText(value, "Unknown"))}</span>`;
}

function transcriptRole(entry) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  if (rawType === "ui.command") return isRealUserUiCommand(entry) ? "user" : "command";
  const role = String(entry?.role || "assistant");
  if (["user", "assistant", "tool", "command", "final"].includes(role)) return role;
  return "assistant";
}

function transcriptTitle(entry) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  if (rawType === "ui.command" && isRealUserUiCommand(entry)) return "You";
  const title = String(entry?.title || "").trim();
  if (title) return title;
  const role = transcriptRole(entry);
  if (role === "user") return "You";
  if (role === "tool") return "Tool";
  if (role === "command") return "Command";
  if (role === "final") return "Final";
  return agentLabel(sessionBackend());
}

function transcriptMeta(entry) {
  const role = transcriptRole(entry);
  if (role === "user") return "You";
  if (role === "assistant" || role === "final") return transcriptTitle(entry) || "CoAutoResearch";
  if (role === "tool") return "Tool";
  if (role === "command") return "Command";
  return transcriptTitle(entry);
}

function isRealUserUiCommand(entry) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  if (rawType !== "ui.command") return false;
  const role = String(entry?.role || "").toLowerCase();
  const title = String(entry?.title || "").trim().toLowerCase();
  return role === "user" || title === "user" || title === "you";
}

function isLegacySyntheticUiCommand(entry) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  return rawType === "ui.command" && !isRealUserUiCommand(entry);
}

function isUiCommandResult(entry) {
  return String(entry?.raw_type || "").toLowerCase() === "ui.command.result";
}

function transcriptContentHtml(content, options = {}) {
  const text = String(content || "").trim();
  if (!text) return "<p>No content.</p>";
  if (options.markdown) {
    return `<div class="markdown-preview transcript-markdown">${markdownToHtml(text)}</div>`;
  }
  if (text.includes("\n") || text.length > 180) {
    return `<pre>${escapeHtml(text)}</pre>`;
  }
  return `<p>${escapeHtml(text)}</p>`;
}

function parseStatusCardPayload(content) {
  try {
    const parsed = JSON.parse(String(content || ""));
    if (parsed && parsed.kind === "status_card") return parsed;
  } catch {
    return null;
  }
  return null;
}

function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return new Intl.NumberFormat("en-US").format(Math.round(number));
}

function formatStatusText(value, fallback = "Unknown") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatStopReason(value) {
  const reason = String(value || "").trim();
  const labels = {
    all_reviewer_gates_passed: "Reviewer gates passed",
    gate_requires_human_input: "Needs human input",
    review_checkpoint_reached: "Review checkpoint reached",
    paused_by_user: "Paused by user",
    cleared_by_user: "Cleared by user",
    stopped_by_user: "Stopped by user",
  };
  return labels[reason] || formatStatusText(reason.replaceAll("_", " "), "none");
}

function statusMetricHtml(label, value, tone = "") {
  return `
    <div class="status-metric ${tone ? `is-${escapeHtml(tone)}` : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatStatusText(value))}</strong>
    </div>
  `;
}

function statusUsageRowsHtml(usage = {}) {
  const rows = [
    ["Input", usage.input_tokens],
    ["Cached input", usage.cached_input_tokens],
    ["Output", usage.output_tokens],
    ["Reasoning", usage.reasoning_output_tokens],
    ["Total", usage.total_tokens],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!rows.length) {
    return `<p class="status-note">No token usage has been reported by agent stream events yet.</p>`;
  }
  return `
    <div class="status-usage-grid">
      ${rows
        .map(([label, value]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(formatCount(value) || String(value))}</strong>
          </div>
        `)
        .join("")}
    </div>
  `;
}

function statusLimitRowsHtml(limits = [], limitations = [], backend = "codex") {
  const analyticsUrl = "https://chatgpt.com/codex/cloud/settings/analytics";
  if (!Array.isArray(limits) || !limits.length) {
    const note = (limitations && limitations[0]) || "Remaining usage windows are not available from agent stream events.";
    return `
      <div class="status-limit-fallback">
        <p class="status-note">${escapeHtml(note)}</p>
        ${normalizeAgentBackend(backend) === "codex" ? `<a class="status-link-button" href="${analyticsUrl}" target="_blank" rel="noopener noreferrer">Open Codex analytics</a>` : ""}
      </div>
    `;
  }
  return `
    <div class="status-limit-list">
      ${limits
        .map((limit) => {
          const left = Number(limit.left_percent);
          const hasPercent = Number.isFinite(left);
          const width = hasPercent ? Math.max(0, Math.min(100, left)) : 0;
          const reset = formatStatusText(limit.reset, "");
          const value = hasPercent ? `${Math.round(left)}% left` : [limit.remaining, limit.limit].filter(Boolean).join(" / ");
          return `
            <div class="status-limit-row">
              <div>
                <strong>${escapeHtml(formatStatusText(limit.label, "limit"))}</strong>
                <span>${escapeHtml([value || "reported", reset ? `resets ${reset}` : ""].filter(Boolean).join(" · "))}</span>
              </div>
              ${hasPercent ? `<div class="status-meter" aria-label="${escapeHtml(limit.label)} ${escapeHtml(value)}"><span style="width:${width}%"></span></div>` : ""}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function statusSettingsHtml(settings = {}) {
  const permission = settings.permission || settings.permission_mode || [settings.sandbox, settings.approval].filter(Boolean).join(" / ");
  return `
    <div class="status-settings">
      ${statusMetricHtml("Backend", agentLabel(settings.backend))}
      ${statusMetricHtml("Model", settings.model || "Default")}
      ${statusMetricHtml("Reasoning", settings.reasoning || "medium")}
      ${statusMetricHtml("Permissions", permission || "Default")}
      ${statusMetricHtml("Mode", settings.fast_mode ? "Fast" : "Standard")}
      ${statusMetricHtml("Review checkpoint", `${settings.review_checkpoint_interval || 100} turns`)}
      ${statusMetricHtml("Web", settings.web_search ? "Live search" : "Off")}
    </div>
  `;
}

function statusCardHtml(payload, entry) {
  const sessionId = payload.session_id || "not started";
  const provider = payload.backend_label || agentLabel(payload.backend);
  const process = payload.process || {};
  const events = payload.events || {};
  const waitState = payload.agent_wait_state || {};
  const lastEventAge = Number(events.last_event_age_seconds);
  const lastEvent = Number.isFinite(lastEventAge) ? `${formatWorkedDuration(lastEventAge)} ago` : "none";
  const gate = payload.gate || "missing";
  const iteration = Number.isFinite(Number(payload.loop_iteration)) ? Number(payload.loop_iteration) : 0;
  const interval = Number.isFinite(Number(payload.review_checkpoint_interval)) && Number(payload.review_checkpoint_interval) > 0 ? Number(payload.review_checkpoint_interval) : 100;
  const checkpoint = Number.isFinite(Number(payload.loop_review_checkpoint_iteration)) && Number(payload.loop_review_checkpoint_iteration) > 0
    ? Number(payload.loop_review_checkpoint_iteration)
    : iteration + interval;
  return `
    <article class="transcript-message assistant is-status-card" data-transcript-id="${escapeHtml(entry?.id || "")}">
      <div class="status-card">
        <div class="status-card-head">
          <div>
            <span>Status</span>
            <strong>${escapeHtml(sessionId)}</strong>
          </div>
          <em>${escapeHtml(formatStatusText(payload.run_status, "idle"))}</em>
        </div>
        <div class="status-card-grid">
          ${statusMetricHtml("Goal loop", payload.goal_loop || "paused", ["active", "passed"].includes(payload.goal_loop) ? "active" : "")}
          ${statusMetricHtml("Iteration", iteration)}
          ${statusMetricHtml("Next review", checkpoint)}
          ${statusMetricHtml("Trials", `${payload.trials_reported || 0} reported`)}
          ${statusMetricHtml("Gate", gate, gate === "pass" ? "active" : "")}
          ${statusMetricHtml("Stop reason", formatStopReason(payload.stop_reason))}
          ${statusMetricHtml("Events", `${events.raw_logs || 0} raw · ${events.transcript || 0} shown`)}
          ${statusMetricHtml("Last event", lastEvent)}
          ${statusMetricHtml("Process", process.active ? `pid ${process.pid}` : "not running", process.active ? "active" : "")}
        </div>
        ${agentWaitStateHtml(waitState)}
        ${payload.gate_response_to_human ? `
          <p class="status-note status-human-response">
            <strong>Needs human input</strong>
            <span>${escapeHtml(payload.gate_response_to_human)}</span>
          </p>
        ` : payload.gate_summary ? `<p class="status-note">${escapeHtml(payload.gate_summary)}</p>` : ""}
        <section>
          <h4>${escapeHtml(provider)} settings</h4>
          ${statusSettingsHtml(payload.settings || {})}
        </section>
        <section>
          <h4>Limits</h4>
          ${statusLimitRowsHtml(payload.limits || [], payload.limitations || [], payload.backend)}
        </section>
        <details class="status-details">
          <summary>Usage</summary>
          ${statusUsageRowsHtml(payload.usage || {})}
        </details>
      </div>
    </article>
  `;
}

function compactCommandText(content) {
  return String(content || "").replace(/^\/bin\/(?:zsh|bash|sh)\s+-lc\s+/, "").trim();
}

function webSearchActivityInfo(entry) {
  const content = String(typeof entry === "string" ? entry : entry?.content || "").replace(/\s+/g, " ").trim();
  const rawType = String(typeof entry === "string" ? "" : entry?.raw_type || "").toLowerCase();
  const title = String(typeof entry === "string" ? "" : entry?.title || "").toLowerCase();
  if (!content && !rawType && !title) return null;
  let query = "";
  const legacyMatch = content.match(/^ws_[a-z0-9_-]+\s+web_search(?:_call)?\b\s*(.*)$/i);
  const friendlyMatch = content.match(/^Searching the web(?:\s*:\s*(.*))?$/i);
  if (legacyMatch) {
    query = legacyMatch[1] || "";
  } else if (friendlyMatch) {
    query = friendlyMatch[1] || "";
  } else if (rawType.includes("web_search") || title.includes("web search")) {
    query = content;
  } else {
    return null;
  }
  query = query
    .replace(/\bws_[a-z0-9_-]+\b/gi, "")
    .replace(/\bweb_search(?:_call)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: "Web search",
    summary: query ? `Searching the web: ${compactText(query, 180)}` : "Searching the web",
    raw: content,
  };
}

function repoRelativePath(path) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  const root = String(appState?.repo_root || "").replace(/\/+$/, "");
  if (root && raw.startsWith(`${root}/`)) return raw.slice(root.length + 1);
  return raw.replace(/^\.?\//, "");
}

function parseFileChangeInfo(content) {
  const text = String(content || "");
  if (!text.includes("file_change")) return null;
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const pathLine = lines.find((line) => line.includes("/") || /\.[A-Za-z0-9]+$/.test(line)) || "";
  const path = repoRelativePath(pathLine);
  if (!path) return null;
  const action = lines.includes("update") ? "updated" : lines.includes("create") ? "created" : lines.includes("delete") ? "deleted" : "changed";
  const status = lines.includes("completed") ? "completed" : lines.includes("in_progress") ? "in progress" : "";
  const id = lines[0] && lines[0] !== "file_change" ? lines[0] : path;
  return { id, path, action, status };
}

function fileChangeKey(info) {
  if (!info) return "";
  return `${info.id}\n${info.path}\n${info.action}`;
}

function sessionTranscriptEntries() {
  const transcript = Array.isArray(sessionState().transcript) ? sessionState().transcript : [];
  const entries = [];
  const seenAdjacent = new Set();
  let previousIncludedWasUserCommand = false;
  const completedFileChanges = new Set(
    transcript
      .map((entry) => parseFileChangeInfo(entry?.content))
      .filter((info) => info?.status === "completed")
      .map(fileChangeKey)
  );
  transcript.forEach((entry) => {
    const content = String(entry?.content || "").trim();
    if (!content) return;
    const originalRawType = String(entry?.raw_type || "");
    if (isNoisyAgentLifecycleEntry(entry)) return;
    if (isHiddenUiTranscript(entry)) return;
    if (isLegacySyntheticUiCommand(entry)) {
      previousIncludedWasUserCommand = false;
      return;
    }
    if (isUiCommandResult(entry) && !previousIncludedWasUserCommand) {
      previousIncludedWasUserCommand = false;
      return;
    }
    const fileChange = parseFileChangeInfo(content);
    if (fileChange && fileChange.status !== "completed" && completedFileChanges.has(fileChangeKey(fileChange))) return;
    const role = transcriptRole(entry);
    const rawType = originalRawType.replace(/item\.(started|completed)/, "item");
    const key = `${role}\n${entry?.kind || ""}\n${rawType}\n${content}`;
    if (seenAdjacent.has(key)) return;
    seenAdjacent.clear();
    seenAdjacent.add(key);
    entries.push(entry);
    previousIncludedWasUserCommand = isRealUserUiCommand(entry);
  });
  return entries;
}

function trialIterationValue(trial) {
  const explicit = Number(trial?.iteration || 0);
  if (explicit > 0) return explicit;
  const match = String(trial?.id || "").match(/^0*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function visibleTrials() {
  return (appState?.trials || [])
    .filter((trial) => hasVisibleTrial(trial) && trial?.is_archived !== true)
    .filter((trial) => !/^0*_?project_conversion/i.test(String(trial.id || "")))
    .sort((a, b) => trialIterationValue(a) - trialIterationValue(b) || String(a.id || "").localeCompare(String(b.id || "")));
}

function visibleTrialReports() {
  return visibleTrials().filter((trial) => String(trial.report_path || "").trim());
}

function pendingExpectedTrialReport(iteration = pendingExpectedTrialIteration()) {
  const expected = Number(iteration || 0);
  if (!expected) return null;
  const marker = expectedTrialMarker();
  const interventionIds = Array.isArray(marker.pending_intervention_ids)
    ? marker.pending_intervention_ids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const summary = interventionIds.length
    ? `Pending autoresearch step with ${interventionIds.join(", ")}.`
    : "Pending autoresearch step.";
  return {
    id: `${String(expected).padStart(6, "0")}_pending_autoresearch`,
    iteration: expected,
    status: "working",
    is_closed: false,
    report_path: "",
    review_path: "",
    report_summary: summary,
    objective: "Resume autoresearch to create or complete this trial boundary.",
    progress: {
      stage_index: 1,
      stage_label: "Planning",
      summary,
      detail: "Waiting for Resume autoresearch.",
      updated_at: marker.updated_at || marker.created_at || "",
    },
  };
}

function reportForIteration(iteration) {
  const target = Number(iteration || 0);
  const visible = visibleTrialReports().find((trial) => trialIterationValue(trial) === target) || null;
  if (visible) return visible;
  return hasAutoresearchTrajectory() && pendingExpectedTrialIteration() === target ? pendingExpectedTrialReport(target) : null;
}

function currentTrialIndex(trials = visibleTrials()) {
  const loopIteration = activeRunTrialIteration();
  const items = Array.isArray(trials) ? trials : visibleTrials();
  const iterations = items.map((trial) => Number(trial.iteration || trialIterationValue(trial) || 0)).filter(Boolean);
  const latest = Math.max(...iterations, 0);
  return Math.max(latest, 1);
}

function selectedTrial(trials = visibleTrials()) {
  if (!trials.length) return 0;
  const fallback = currentTrialIndex(trials);
  const value = Number(selectedTrialIndex || 0);
  const iterations = trials.map((trial) => Number(trial.iteration || 0)).filter(Boolean);
  if (value && iterations.includes(value)) return value;
  return iterations.includes(fallback) ? fallback : iterations[iterations.length - 1];
}

function startsGoalIteration(entry) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  const content = String(entry?.content || "").toLowerCase();
  return rawType === "ui.goal" || content.includes("start autoresearch loop") || content.includes("continue autoresearch loop");
}

function isCodexRuntimeEntry(entry) {
  if (isUiLocalTranscript(entry)) return false;
  const role = transcriptRole(entry);
  const rawType = String(entry?.raw_type || "").toLowerCase();
  const content = String(entry?.content || "");
  if (parseFileChangeInfo(content)) return true;
  if (["assistant", "final", "tool", "command"].includes(role)) return true;
  return rawType.startsWith("item.") || rawType.startsWith("turn.") || rawType.startsWith("process.");
}

function inferredTrialIterationFromText(value) {
  const text = String(value || "");
  const pathMatch = text.match(/(?:^|[\\/])trials[\\/](\d{6})(?:[_\\/]|\/|\b)/i);
  if (pathMatch) return Number(pathMatch[1]);
  const idMatch = text.match(/\b(\d{6})_[a-z0-9][a-z0-9_]*\b/i);
  if (idMatch) return Number(idMatch[1]);
  const possessiveMatch = text.match(/\bTrial\s+(\d{1,4})(?:'s|’s)\b/i);
  if (possessiveMatch) return Number(possessiveMatch[1]);
  const actionMatch = text.match(/\b(?:start(?:ing)?|started|create|creating|move|moving|continue|continuing|validate|validating|complete|completed|finish|finishing)\s+(?:the\s+)?(?:current\s+)?Trial\s+(\d{1,4})\b/i);
  if (actionMatch) return Number(actionMatch[1]);
  return 0;
}

function effectiveIteration(entry, currentIteration) {
  if (isUiLocalTranscript(entry)) return 0;
  const inferred = inferredTrialIterationFromText(entry?.content);
  if (inferred > 0) return inferred;
  const explicit = Number(entry?.iteration || 0);
  if (explicit > 0) {
    const liveIteration = isLiveGoalSession() ? activeRunTrialIteration() : 0;
    if (liveIteration > explicit && isCodexRuntimeEntry(entry)) {
      return currentIteration >= liveIteration ? currentIteration : liveIteration;
    }
    if (currentIteration > explicit && isCodexRuntimeEntry(entry)) return currentIteration;
    return explicit;
  }
  if (startsGoalIteration(entry)) return Math.max(1, currentIteration + 1);
  if ((hasGoalStarted() || visibleTrials().length > 0) && isCodexRuntimeEntry(entry)) {
    return Math.max(1, currentIteration || currentTrialIndex());
  }
  return currentIteration;
}

const TRIAL_PROGRESS_STAGES = [
  { key: "planning", label: "Planning" },
  { key: "working", label: "Working" },
  { key: "synthesizing", label: "Synthesizing" },
  { key: "reporting", label: "Reporting" },
  { key: "reviewing", label: "Reviewing" },
  { key: "gate_update", label: "Gate update" },
];

function trialProgressForIteration(iteration, report = null) {
  const target = Number(iteration || 0);
  if (!target) return {};
  if (isTrialLive(target)) return activeRunProgress();
  const source = report || reportForIteration(target);
  const progress = source?.progress || {};
  return progress && typeof progress === "object" ? progress : {};
}

function trialProgressSummaryText(progress, fallback = "") {
  const summary = cleanText(progress?.summary, "");
  if (summary) return summary;
  const label = cleanText(progress?.stage_label, "");
  const reviewerCount = Number(progress?.reviewer_count || 0);
  const reviewerTotal = Number(progress?.reviewer_total || 0);
  const artifactsCount = Number(progress?.artifacts_count || 0);
  if (label && reviewerTotal > 0 && label.toLowerCase().includes("review")) return `${label} · ${reviewerCount}/${reviewerTotal} reviewer files`;
  if (label && artifactsCount > 0) return `${label} · ${artifactsCount} artifact${artifactsCount === 1 ? "" : "s"}`;
  if (label) return label;
  return fallback;
}

function trialProgressDetailText(progress) {
  const detail = cleanText(progress?.detail, "");
  const updated = cleanText(progress?.updated_at, "");
  if (detail && updated) return `${detail} · updated ${formatTimestamp(updated)}`;
  return detail;
}

function trialProgressStepperHtml(progress) {
  if (!progress || typeof progress !== "object") return "";
  const totalStages = Number(progress.total_stages || TRIAL_PROGRESS_STAGES.length);
  const currentIndex = Math.max(1, Math.min(Number(progress.stage_index || 0), totalStages || TRIAL_PROGRESS_STAGES.length));
  if (!currentIndex) return "";
  const stages = Array.isArray(progress.stages) && progress.stages.length ? progress.stages : TRIAL_PROGRESS_STAGES;
  return `
    <div class="trial-progress-stepper" aria-label="Trial progress">
      ${stages
        .map((stage, index) => {
          const step = index + 1;
          const state = step < currentIndex ? "complete" : step === currentIndex ? "current" : "pending";
          const label = cleanText(stage?.label, `Stage ${step}`);
          return `
            <span class="trial-progress-step is-${state}" title="${escapeHtml(label)}">
              <span class="trial-progress-marker" aria-hidden="true">${state === "complete" ? "✓" : escapeHtml(step)}</span>
              <span>${escapeHtml(label)}</span>
            </span>
          `;
        })
        .join("")}
    </div>
  `;
}

function trialActionIconHtml(kind) {
  const icons = {
    continue: '<path d="M5 7h6a5 5 0 0 1 5 5v5" /><path d="M13 14l3 3 3-3" />',
    resume: '<polygon points="7 5 18 12 7 19 7 5" />',
    restart: '<path d="M4 12a8 8 0 1 0 2.34-5.66" /><path d="M4 4v6h6" />',
  };
  return `<span class="trial-action-icon trial-action-icon-${escapeHtml(kind)}" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${icons[kind] || ""}</svg></span>`;
}

function trialLifecycleActionButtonsHtml(iteration, report, running) {
  if (running || !hasAutoresearchTrajectory()) return "";
  const actions = [];
  const resumeFromTrial = selectedResumeTrialPayload();
  if (resumeFromTrial) {
    actions.push(`<button class="primary-button small-button trial-flow-button" type="button" data-resume-trial-submit>Continue from ${escapeHtml(resumeTrialLabel(resumeFromTrial))}</button>`);
    actions.push('<button class="secondary-button small-button trial-flow-button" type="button" data-resume-trial-remove>Cancel</button>');
  } else if (!isGoalPassed()) {
    const reportPath = String(report?.report_path || "").trim();
    const latestBoundary = Number(iteration || 0) > 0
      && Number(iteration || 0) === latestTrajectoryTrialIteration()
      && report?.is_closed === true
      && reportPath;
    if ((report && report?.is_closed !== true && !reportPath) || latestBoundary) {
      actions.push(`<button class="primary-button small-button trial-flow-button" type="button" data-resume-autoresearch aria-label="Resume">${trialActionIconHtml("resume")}<span>Resume</span></button>`);
    } else if (resumeTrialContextFromReport(iteration, report)) {
      actions.push(`<button class="secondary-button small-button trial-flow-button" type="button" data-trial-continue="${escapeHtml(iteration)}" aria-label="Continue from this trial">${trialActionIconHtml("continue")}<span>Continue from this trial</span></button>`);
    }
  }
  actions.push(`<button class="secondary-button small-button trial-danger-button" type="button" data-restart-autoresearch aria-label="Restart">${trialActionIconHtml("restart")}<span>Restart</span></button>`);
  return actions.join("");
}

function trialArtifactIconHtml(kind) {
  const icons = {
    manuscript: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h6" /><path d="M8 9h2" />',
    report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 18v-4" /><path d="M12 18v-7" /><path d="M16 18v-2" />',
    review: '<circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="m8 11 2 2 4-4" />',
  };
  return `<span class="trial-artifact-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${icons[kind] || icons.report}</svg></span>`;
}

function trialArtifactActionButtonHtml(path, kind, label) {
  return `<button class="secondary-button small-button trial-artifact-button" type="button" data-inline-fullscreen="${escapeHtml(path)}" aria-label="Open ${escapeHtml(label.toLowerCase())}">${trialArtifactIconHtml(kind)}<span>${escapeHtml(label)}</span></button>`;
}

function trialManuscriptPath(report) {
  return cleanText(report?.manuscript_snapshot_path, "") || LATEST_MANUSCRIPT_PATH;
}

function trialOpenActionButtonsHtml(report, options = {}) {
  return [
    options.includeManuscript ? trialArtifactActionButtonHtml(trialManuscriptPath(report), "manuscript", "Manuscript") : "",
    report?.report_path ? trialArtifactActionButtonHtml(report.report_path, "report", "Report") : "",
    report?.review_path ? trialArtifactActionButtonHtml(report.review_path, "review", "Review") : "",
  ].filter(Boolean).join("");
}

function cleanTrialReportSummaryText(value) {
  const text = cleanText(value, "");
  if (!text) return "";
  if (/^Created\s+Trial\s+[`'"]?0*\d{1,6}_[a-z0-9_ -]+[`'"]?(?:\.|\s+as\s+the\s+next\b.*)?$/i.test(text)) return "";
  return text;
}

function comparableTrialReportText(value) {
  return normalizedTranscriptText(value)
    .toLowerCase()
    .replace(/[`"']/g, "")
    .replace(/[.。]+$/g, "")
    .trim();
}

function trialReportSummaryHtml(iteration, entries, reportOverride = null) {
  const report = reportOverride || reportForIteration(iteration);
  const finalEntry = [...entries].reverse().find((entry) => ["final", "assistant"].includes(transcriptRole(entry)) && String(entry.content || "").trim());
  const fallback = finalEntry ? compactText(finalEntry.content, 260) : "";
  const reportSummary = cleanText(report?.report_summary, "");
  const objective = cleanText(report?.objective, "");
  const rawSummary = reportSummary || fallback || objective || (report ? "Summary is not available yet." : "Report is not available yet. Agent activity for this trial is shown below.");
  const summary = cleanTrialReportSummaryText(rawSummary);
  const running = isTrialLive(iteration, report);
  const status = running ? "running" : trialStatusLabel(iteration, report).toLowerCase();
  const latestCompletedIteration = currentTrialIndex(visibleTrialReports());
  const marksAutoresearchComplete = isGoalPassed() && Number(iteration) === Number(latestCompletedIteration);
  const progress = trialProgressForIteration(iteration, report);
  const progressSummary = trialProgressSummaryText(progress, "");
  const progressDetail = trialProgressDetailText(progress);
  const summaryDuplicatesProgress = summary
    && progressSummary
    && comparableTrialReportText(summary) === comparableTrialReportText(progressSummary);
  const openActions = trialOpenActionButtonsHtml(report, { includeManuscript: true });
  const controlActions = trialLifecycleActionButtonsHtml(iteration, report, running);
  return `
    <article class="trial-report-card ${running ? "is-running" : report?.is_closed === true ? "is-complete" : "is-pending"}" data-trial-panel="${escapeHtml(iteration)}">
      <div class="trial-report-head">
        <div>
          <strong>Trial ${escapeHtml(iteration)}</strong>
          <em>${escapeHtml(status)}</em>
          ${marksAutoresearchComplete ? `<em class="is-autoresearch-complete">Autoresearch complete</em>` : ""}
          ${progressDetail ? `<span class="trial-report-head-progress">${escapeHtml(progressDetail)}</span>` : ""}
        </div>
      </div>
      ${trialProgressStepperHtml(progress)}
      ${progressSummary ? `<p class="trial-progress-summary">${escapeHtml(progressSummary)}</p>` : ""}
      ${trialHumanResponseHtml(iteration)}
      ${summary && !summaryDuplicatesProgress ? `<p>${escapeHtml(summary)}</p>` : ""}
      <div class="trial-report-actions">
        ${openActions ? `<div class="trial-report-open-actions">${openActions}</div>` : ""}
        ${controlActions ? `<div class="trial-report-control-actions">${controlActions}</div>` : ""}
      </div>
      ${(() => {
        const activity = trialActivityEntries(entries);
        return activity.length
          ? `<details class="trial-detail-activity" data-run-activity-details="trial-report-${escapeHtml(iteration)}"${runActivityOpenAttribute(`trial-report-${iteration}`)}>
              <summary>
                <span>Trial activity</span>
                <strong>${escapeHtml(activity.length)} event${activity.length === 1 ? "" : "s"}</strong>
              </summary>
              <div class="trial-detail-events">${transcriptEntriesHtml(activity)}</div>
            </details>`
          : "";
      })()}
    </article>
  `;
}

function trialActivityEntries(entries) {
  return (entries || []).filter((entry) => transcriptRole(entry) !== "user");
}

function latestTrialProgressEntry(entries) {
  const candidates = [...(entries || [])].reverse().filter((entry) => {
    const role = transcriptRole(entry);
    const rawType = String(entry?.raw_type || "").toLowerCase();
    return role !== "user" && rawType !== "turn.completed" && String(entry?.content || "").trim();
  });
  const primary = candidates.find((entry) => ["Error", "Done", "Update", "File change"].includes(framingProgressTitle(entry)));
  return primary || candidates.find((entry) => framingProgressTitle(entry) === "Reasoning") || null;
}

function latestTrialUpdateText(activeTrialData, runningTrialData = null) {
  const source = runningTrialData || activeTrialData;
  const rawEntries = Array.isArray(source?.entries) ? source.entries : [];
  const entries = runningTrialData ? currentRunScopedEntries(rawEntries) : rawEntries;
  const latestEntry = latestTrialProgressEntry(trialActivityEntries(entries));
  if (!latestEntry) return "";
  return compactText(`${framingProgressTitle(latestEntry)}: ${framingProgressContent(latestEntry)}`, 180);
}

function runningTrialStatusHtml(trial) {
  const iteration = Number(trial?.iteration || activeRunTrialIteration() || 0);
  if (!iteration || !isTrialLive(iteration)) return "";
  const entries = Array.isArray(trial?.entries) ? trial.entries : [];
  const liveEntries = currentRunScopedEntries(entries);
  // Trial activity reflects agent/tool work only — never the human's steering messages.
  const activity = trialActivityEntries(liveEntries);
  const report = trial?.report || reportForIteration(iteration);
  const progress = trialProgressForIteration(iteration, report);
  const progressSummary = trialProgressSummaryText(progress, "");
  const progressDetail = trialProgressDetailText(progress);
  const processUpdates = currentRunProcessUpdatesHtml(liveEntries, { className: "trial-live-updates", label: `${agentLabel(sessionBackend())} trial updates`, limit: 1, maxLength: 260 });
  const eventLabel = activity.length ? `${activity.length} event${activity.length === 1 ? "" : "s"}` : "waiting";
  const waitNotice = agentWaitStateHtml();
  const showWaitNotice = Boolean(waitNotice);
  return `
    <article class="trial-report-card is-running" data-trial-panel="${escapeHtml(iteration)}" aria-live="polite">
      <div class="trial-report-head">
        <div>
          <strong>Trial ${escapeHtml(iteration)}</strong>
          <em>Running</em>
          ${workingDurationHtml()}
          ${progressDetail ? `<span class="trial-report-head-progress">${escapeHtml(progressDetail)}</span>` : ""}
        </div>
      </div>
      ${trialProgressStepperHtml(progress)}
      ${!processUpdates && progressSummary ? `<p class="trial-progress-summary">${escapeHtml(compactText(progressSummary, 220))}</p>` : ""}
      ${processUpdates}
      ${trialHumanResponseHtml(iteration)}
      ${showWaitNotice ? waitNotice : ""}
      <div class="trial-report-actions">
        <div class="trial-report-control-actions">${runControlButtonsHtml()}</div>
      </div>
      ${
        activity.length
          ? `<details class="trial-detail-activity" data-run-activity-details="trial-live-${escapeHtml(iteration)}"${runActivityOpenAttribute(`trial-live-${iteration}`)}>
              <summary>
                <span>Live trial activity</span>
                <strong>${escapeHtml(eventLabel)}</strong>
              </summary>
              <div class="trial-detail-events">${transcriptEntriesHtml(activity)}</div>
            </details>`
          : ""
      }
    </article>
  `;
}

function clampTrialStripScrollLeft(strip, value) {
  const requested = Math.max(0, Number(value) || 0);
  const max = Math.max(0, Number(strip?.scrollWidth || 0) - Number(strip?.clientWidth || 0));
  return max ? Math.min(requested, max) : requested;
}

const TRIAL_STRIP_MANUAL_EXPIRE_MS = 30000;

function liveTrialStripIteration() {
  return isLiveGoalSession() ? activeRunTrialIteration() : 0;
}

function continuedBaseTrialId() {
  const baseTrial = cleanText(appState?.research_session?.trajectory?.base_trial, "");
  const latestTrial = cleanText(appState?.research_session?.trajectory?.latest_active_trial, "");
  if (!baseTrial || !latestTrial || baseTrial === latestTrial) return "";
  return baseTrial;
}

function isContinuedTrial(iteration, trial) {
  if (trial?.is_closed !== true) return false;
  const baseTrial = continuedBaseTrialId();
  if (!baseTrial) return false;
  const trialId = cleanText(trial?.id, "");
  if (trialId && trialId === baseTrial) return true;
  return trialIterationValue({ id: baseTrial }) === Number(iteration || trialIterationValue(trial));
}

function isLatestClosedTrial(iteration, trial) {
  if (trial?.is_closed !== true) return false;
  const target = Number(iteration || trialIterationValue(trial) || 0);
  return target > 0 && target === latestTrajectoryTrialIteration();
}

function isHistoricalReportedTrial(iteration, trial) {
  if (!String(trial?.report_path || "").trim()) return false;
  const target = Number(iteration || trialIterationValue(trial) || 0);
  return target > 0 && target < latestTrajectoryTrialIteration();
}

function isDisplayIncompleteTrial(iteration, trial, running = false) {
  if (!trial || running || trial?.is_closed === true) return false;
  if (isHistoricalReportedTrial(iteration, trial)) return false;
  return true;
}

function trialStatusLabel(iteration, trial) {
  if (isTrialLive(iteration, trial)) return "Running";
  const reportStatus = cleanText(trial?.status, "");
  if (isContinuedTrial(iteration, trial)) return "Continued";
  if (reportStatus === "blocked") return "Blocked";
  if (isLatestClosedTrial(iteration, trial)) return "Done";
  if (trial?.is_closed === true) return "Reported";
  if (isHistoricalReportedTrial(iteration, trial)) return "Reported";
  if (String(trial?.report_path || "").trim()) return "Incomplete";
  if (trial) return "Incomplete";
  return "Active";
}

function trialHeaderStatusLabel(iteration, trial) {
  const target = Number(iteration || trialIterationValue(trial) || 0);
  const lifecycleLabel = trialStatusLabel(target, trial);
  if (["Blocked", "Continued", "Done", "Reported"].includes(lifecycleLabel)) {
    return lifecycleLabel;
  }
  const progress = target ? trialProgressForIteration(target, trial) : {};
  const progressLabel = cleanText(progress?.stage_label, "");
  return progressLabel || lifecycleLabel;
}

function trialWorkingOnText(trial) {
  if (!String(trial?.plan_path || "").trim()) return "";
  const objective = cleanText(trial?.objective, "");
  if (!objective || /^objective\s+not\s+recorded\.?$/i.test(objective)) return "";
  return compactText(objective.replace(/^[-*]\s+/, ""), 160);
}

function trialWorkingOnHtml(trial) {
  const text = trialWorkingOnText(trial);
  if (!text) return "";
  return `<span class="trial-history-working-on" title="${escapeHtml(`Working on: ${text}`)}">Working on: ${escapeHtml(text)}</span>`;
}

function resetTrialStripToAuto(liveIteration = liveTrialStripIteration()) {
  trialStripScrollState = {
    ...trialStripScrollState,
    mode: "auto",
    liveIteration,
    touchedAt: 0,
  };
}

function updateTrialStripLiveScope() {
  const liveIteration = liveTrialStripIteration();
  if (liveIteration !== trialStripScrollState.liveIteration) {
    resetTrialStripToAuto(liveIteration);
  }
  return liveIteration;
}

function markTrialStripManual(strip, options = {}) {
  if (!strip) return;
  trialStripScrollState = {
    mode: "manual",
    left: clampTrialStripScrollLeft(strip, options.left ?? strip.scrollLeft),
    liveIteration: liveTrialStripIteration(),
    selectedIteration: Number(options.selectedIteration || selectedTrialIndex || 0),
    touchedAt: Date.now(),
  };
}

function trialStripManualActive() {
  if (trialStripScrollState.mode !== "manual") return false;
  if (Date.now() - Number(trialStripScrollState.touchedAt || 0) > TRIAL_STRIP_MANUAL_EXPIRE_MS) {
    resetTrialStripToAuto();
    return false;
  }
  return true;
}

function currentAutoresearchTrialStrip() {
  const selectors = [
    "#autoresearch-dock .trial-strip:not(.review-trial-strip) .trial-strip-scroll",
    ".autoresearch-dock .trial-strip:not(.review-trial-strip) .trial-strip-scroll",
    ".trial-history-card .trial-strip:not(.review-trial-strip) .trial-strip-scroll",
    ".trial-strip:not(.review-trial-strip) .trial-strip-scroll",
    ".trial-strip-scroll:not(.review-trial-strip-scroll)",
    ".trial-strip-scroll",
  ];
  for (const selector of selectors) {
    const strip = document.querySelector(selector);
    if (strip) return strip;
  }
  return null;
}

function rememberTrialStripScroll(strip = currentAutoresearchTrialStrip(), options = {}) {
  if (!strip) return;
  if (options.manual) markTrialStripManual(strip, options);
}

function bindTrialStripScrollState(strip) {
  if (!strip || strip.dataset.trialStripScrollBound === "true") return;
  strip.dataset.trialStripScrollBound = "true";
  const noteUserIntent = () => {
    strip.dataset.trialStripUserScroll = "true";
  };
  strip.addEventListener("pointerdown", noteUserIntent, { passive: true });
  strip.addEventListener("touchstart", noteUserIntent, { passive: true });
  strip.addEventListener("wheel", noteUserIntent, { passive: true });
  strip.addEventListener("keydown", noteUserIntent);
  strip.addEventListener("scroll", () => {
    if (strip.dataset.trialStripUserScroll === "true") {
      markTrialStripManual(strip);
    }
  }, { passive: true });
}

function activeTrialChip(strip) {
  if (!strip) return null;
  return strip.querySelector(".trial-chip.is-running") || strip.querySelector(".trial-chip.is-active");
}

function trialChipForIteration(strip, iteration) {
  const target = Number(iteration || 0);
  if (!strip || !target) return null;
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(String(target))
    : String(target);
  return strip.querySelector(`[data-trial-select="${escaped}"]`);
}

function scrollTrialStripToChip(strip, chip, options = {}) {
  if (!strip || !chip) return false;
  const stripRect = strip.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  const pad = 14;
  if (!options.force && chipRect.left >= stripRect.left + pad && chipRect.right <= stripRect.right - pad) {
    return false;
  }
  const stripWidth = Number(strip.clientWidth || 0);
  const chipWidth = Number(chip.offsetWidth || chipRect.width || 0);
  const offsetLeft = Number(chip.offsetLeft);
  const nextLeft = Number.isFinite(offsetLeft) && stripWidth
    ? offsetLeft - Math.max(0, (stripWidth - chipWidth) / 2)
    : strip.scrollLeft + chipRect.left - stripRect.left - Math.max(0, (stripWidth - chipWidth) / 2);
  strip.scrollLeft = clampTrialStripScrollLeft(strip, nextLeft);
  return true;
}

function scrollTrialStripToActive(strip) {
  const chip = activeTrialChip(strip);
  if (!scrollTrialStripToChip(strip, chip)) return false;
  trialStripScrollState = {
    ...trialStripScrollState,
    mode: "auto",
    left: strip.scrollLeft,
    liveIteration: liveTrialStripIteration(),
  };
  return true;
}

function restoreTrialStripScroll(options = {}) {
  const strip = options.strip || currentAutoresearchTrialStrip();
  if (!strip) return;
  bindTrialStripScrollState(strip);
  const forcedSelection = Number(options.selectedIteration || 0);
  if (forcedSelection) {
    const selectedChip = trialChipForIteration(strip, forcedSelection);
    if (selectedChip && scrollTrialStripToChip(strip, selectedChip, { force: true })) {
      trialStripScrollState = {
        ...trialStripScrollState,
        mode: "manual",
        left: clampTrialStripScrollLeft(strip, strip.scrollLeft),
        selectedIteration: forcedSelection,
        liveIteration: liveTrialStripIteration(),
        touchedAt: Date.now(),
      };
      return;
    }
  }
  updateTrialStripLiveScope();
  if (trialStripManualActive()) {
    const selectedIteration = Number(trialStripScrollState.selectedIteration || 0);
    const shouldCenterSelection = selectedIteration && selectedIteration === Number(selectedTrialIndex || 0);
    const selectedChip = shouldCenterSelection ? trialChipForIteration(strip, selectedIteration) : null;
    if (selectedChip && scrollTrialStripToChip(strip, selectedChip, { force: true })) {
      trialStripScrollState = {
        ...trialStripScrollState,
        mode: "manual",
        left: clampTrialStripScrollLeft(strip, strip.scrollLeft),
        selectedIteration,
        liveIteration: liveTrialStripIteration(),
      };
      return;
    }
    strip.scrollLeft = clampTrialStripScrollLeft(strip, trialStripScrollState.left);
    return;
  }
  if (scrollTrialStripToActive(strip)) return;
  trialStripScrollState = {
    ...trialStripScrollState,
    mode: "auto",
    left: clampTrialStripScrollLeft(strip, strip.scrollLeft),
    liveIteration: liveTrialStripIteration(),
  };
}

function iterationNavHtml(trials, activeTrial) {
  if (!trials.length) return "";
  return `
    <nav class="trial-strip" aria-label="Autoresearch trials">
      <span>Trials</span>
      <button class="trial-scroll-button" type="button" data-trial-scroll="-1" aria-label="Previous trials">‹</button>
      <div class="trial-strip-scroll">
        ${trials
          .map(({ iteration, entries, report }) => {
            const running = isTrialLive(iteration, report);
            const incomplete = isDisplayIncompleteTrial(iteration, report, running);
            const continued = isContinuedTrial(iteration, report);
            const label = trialStatusLabel(iteration, report);
            const title = report ? cleanText(report.id, `Trial ${iteration}`) : `Trial ${iteration}`;
            const active = Number(iteration) === Number(activeTrial);
            const summary = report ? cleanText(report.report_summary, cleanText(report.objective, title)) : title;
            return `
              <button class="trial-chip ${active ? "is-active" : ""} ${running ? "is-running" : ""} ${incomplete ? "is-incomplete" : ""} ${continued ? "is-continued" : ""}" type="button" data-trial-select="${escapeHtml(iteration)}" title="${escapeHtml(compactText(summary, 180))}">
                <strong class="trial-chip-index">${escapeHtml(iteration)}</strong>
                <span class="trial-chip-status">${escapeHtml(label)}</span>
              </button>
            `;
          })
          .join("")}
      </div>
      <button class="trial-scroll-button" type="button" data-trial-scroll="1" aria-label="Next trials">›</button>
    </nav>
  `;
}

function trialHistoryHtml(trials, activeTrial, activeTrialData, runningTrialData = null) {
  if (!trials.length) return "";
  const latest = trials[trials.length - 1];
  const collapsed = autoresearchPanelCollapsed();
  const miniTrialData = activeTrialData || latest || null;
  const miniTrialIteration = miniTrialData?.iteration || activeTrial || 0;
  const miniTrialReport = miniTrialData?.report || null;
  const miniTrialLabel = miniTrialIteration ? trialHeaderStatusLabel(miniTrialIteration, miniTrialReport) : "Active";
  const miniTrialWorkingOn = trialWorkingOnHtml(miniTrialReport);
  const kickerStatus = miniTrialIteration
    ? `<span class="trial-history-kicker-status"><span>Trial ${escapeHtml(miniTrialIteration)}: ${escapeHtml(miniTrialLabel)}</span>${miniTrialWorkingOn}</span>`
    : "";
  const collapsedCompleteBadge = collapsed ? autoresearchCompleteBadgeHtml() : "";
  const latestUpdate = latestTrialUpdateText(activeTrialData, runningTrialData);
  const running = Boolean(runningTrialData);
  const activeTrialIsRunning = runningTrialData
    && activeTrialData
    && Number(runningTrialData.iteration) === Number(activeTrialData.iteration);
  const shouldShowActiveTrialReport = activeTrialData && !activeTrialIsRunning;
  return `
    <section class="trial-history-card ${collapsed ? "is-collapsed" : "is-expanded"} ${running ? "is-running" : ""}" aria-label="Autoresearch trials" data-autoresearch-panel-collapsed="${collapsed ? "true" : "false"}">
      <header class="trial-history-head">
        <div class="trial-history-kicker" aria-label="Autoresearch">
          ${
            running
              ? `<span class="trial-history-micro-spinner" aria-hidden="true"></span>`
              : `<span class="trial-history-kicker-icon" aria-hidden="true">
                  <svg class="brand-glyph" viewBox="0 0 32 32" focusable="false">
                    <use href="#brand-mark-glyph"></use>
                  </svg>
                </span>`
          }
          <span>Autoresearch</span>
          ${kickerStatus}
          ${collapsedCompleteBadge}
        </div>
        <button class="trial-history-toggle" type="button" data-autoresearch-panel-toggle aria-expanded="${collapsed ? "false" : "true"}">
          <span class="trial-history-toggle-copy">
            <span class="trial-history-latest-update">
              <span class="trial-history-disclosure" aria-hidden="true">›</span>
              <span>Agent update</span>
              <em>${escapeHtml(latestUpdate || "No recent agent update.")}</em>
            </span>
          </span>
        </button>
      </header>
      <div class="trial-history-body">
        ${iterationNavHtml(trials, activeTrial)}
        ${runningTrialData ? runningTrialStatusHtml(runningTrialData) : ""}
        ${shouldShowActiveTrialReport ? trialReportSummaryHtml(activeTrialData.iteration, activeTrialData.entries, activeTrialData.report) : ""}
      </div>
    </section>
  `;
}

function entryTimeValue(entry) {
  const value = Date.parse(String(entry?.created_at || ""));
  return Number.isFinite(value) ? value : 0;
}

function formatTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return String(value || "");
  return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatWorkedDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  if (value <= 0) return "1s";
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainingSeconds = value % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (remainingSeconds || !parts.length) parts.push(`${remainingSeconds}s`);
  return parts.join(" ");
}

function syncServerClockOffset(generatedAt) {
  const serverNow = Date.parse(String(generatedAt || ""));
  if (!Number.isFinite(serverNow)) return;
  serverClockOffsetMs = serverNow - Date.now();
}

function currentClockMs(options = {}) {
  return Date.now() + (options.serverClock ? Number(serverClockOffsetMs || 0) : 0);
}

function currentRunStartedAtMs() {
  const transcript = Array.isArray(sessionState().transcript) ? sessionState().transcript : [];
  return currentProgressStartTime(transcript);
}

function currentRunStartedAtString(fallback = "") {
  const text = String(fallback || "").trim();
  if (text) return text;
  const start = currentRunStartedAtMs();
  return start ? new Date(start).toISOString() : "";
}

function workingDurationText(startedAt = "", options = {}) {
  const explicit = String(startedAt || "").trim();
  const start = explicit ? Date.parse(explicit) : currentRunStartedAtMs();
  if (!Number.isFinite(start) || start <= 0) return "Working";
  return `Working for ${formatWorkedDuration((currentClockMs(options) - start) / 1000)}`;
}

function workingDurationHtml(startedAt = "") {
  const fallback = isSessionRunning() ? (activeRun().started_at || sessionState().started_at || "") : "";
  const started = currentRunStartedAtString(startedAt || fallback);
  const serverClock = Boolean(startedAt || fallback);
  return `<span class="working-duration" data-working-started-at="${escapeHtml(started)}" data-working-server-clock="${serverClock ? "true" : "false"}">${escapeHtml(workingDurationText(started, { serverClock }))}</span>`;
}

function workedDurationLabel(userEntry, entries) {
  const start = entryTimeValue(userEntry);
  const end = entries.reduce((latest, entry) => Math.max(latest, entryTimeValue(entry)), start);
  if (!start || !end || end < start) return "Worked";
  if (end - start < 2000 && entries.length > 1) return "Worked";
  return `Worked for ${formatWorkedDuration((end - start) / 1000)}`;
}

function inlineRunActivityHtml(userEntry, entries) {
  if (!entries.length) return "";
  const label = workedDurationLabel(userEntry, entries);
  const activityKey = [
    "inline",
    activeProjectId || appState?.active_project_id || "",
    String(userEntry?.id || entryTimeValue(userEntry) || ""),
  ].join(":");
  return `
    <details class="framing-run-activity" data-run-activity-details="${escapeHtml(activityKey)}"${runActivityOpenAttribute(activityKey)}>
      <summary aria-label="${escapeHtml(`${label}, ${entries.length} event${entries.length === 1 ? "" : "s"}`)}">
        <span>${escapeHtml(label)}</span>
      </summary>
      <div class="current-run-events">
        ${transcriptEntriesHtml(entries)}
      </div>
    </details>
  `;
}

function transcriptRunStart(entry) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  const role = String(entry?.role || "").toLowerCase();
  return role === "user" && ["ui.framing", "ui.chat", "ui.plan", "ui.research", "ui.goal"].includes(rawType);
}

function normalizedTranscriptText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function transcriptRunGroups(entries) {
  const groups = [];
  let current = null;
  entries.forEach((entry, index) => {
    if (transcriptRunStart(entry)) {
      if (current) current.endIndex = index;
      current = { userEntry: entry, entries: [], startIndex: index, endIndex: entries.length, completed: false };
      groups.push(current);
      return;
    }
    if (current) current.entries.push(entry);
  });
  groups.forEach((group, index) => {
    group.completed = index < groups.length - 1 || !isSessionRunning();
  });
  return groups.filter((group) => group.userEntry && group.entries.length);
}

function buildFramingActivityByMessage(messages, entries) {
  const htmlBeforeMessageId = new Map();
  const omittedEntryIds = new Set();
  const usedUserIndexes = new Set();
  const cutWindows = editedTranscriptCutWindows(messages);
  const visibleEntries = entries.filter((entry) => !isEntryInsideEditedCut(entry, cutWindows));
  transcriptRunGroups(visibleEntries).forEach((group) => {
    if (!group.completed) return;
    const prompt = normalizedTranscriptText(group.userEntry?.content);
    if (!prompt) return;
    const finalEntry = [...group.entries].reverse().find((entry) => {
      const role = transcriptRole(entry);
      return ["assistant", "final"].includes(role) && normalizedTranscriptText(entry?.content);
    });
    const finalText = normalizedTranscriptText(finalEntry?.content);
    const userIndex = messages.findIndex((message, index) => {
      if (usedUserIndexes.has(index)) return false;
      return message?.role === "user" && normalizedTranscriptText(message.text) === prompt;
    });
    if (userIndex < 0) return;
    usedUserIndexes.add(userIndex);
    const nextUserIndex = messages.findIndex((message, index) => index > userIndex && message?.role === "user");
    const endIndex = nextUserIndex < 0 ? messages.length : nextUserIndex;
    let attachIndex = -1;
    const renderedAssistantTexts = new Set();
    for (let index = userIndex + 1; index < endIndex; index += 1) {
      if (messages[index]?.role !== "assistant") continue;
      const messageText = normalizedTranscriptText(messages[index].text);
      if (attachIndex < 0 || (finalText && messageText === finalText)) attachIndex = index;
      if (messages[index].kind !== "project") {
        renderedAssistantTexts.add(messageText);
      }
    }
    if (attachIndex < 0) return;
    const attachMessage = messages[attachIndex];
    if (!attachMessage?.id) return;
    const activityEntries = group.entries.filter((entry) => {
      if (entry === finalEntry || (finalEntry?.id && entry?.id === finalEntry.id)) return false;
      const role = transcriptRole(entry);
      if (!["assistant", "final"].includes(role)) return true;
      return !renderedAssistantTexts.has(normalizedTranscriptText(entry?.content));
    });
    if (activityEntries.length) {
      htmlBeforeMessageId.set(attachMessage.id, inlineRunActivityHtml(group.userEntry, activityEntries));
    }
    if (group.userEntry?.id) omittedEntryIds.add(String(group.userEntry.id));
    group.entries.forEach((entry) => {
      if (entry?.id) omittedEntryIds.add(String(entry.id));
    });
  });
  return { htmlBeforeMessageId, omittedEntryIds };
}

function trialTimelineContentHtml(entries, options = {}) {
  const pendingExpected = pendingExpectedTrialIteration();
  const omittedEntryIds = options.omittedEntryIds || new Set();
  const trialGroups = new Map();
  let currentIteration = 0;
  const hasTrialContext = hasLaunched() || hasGoalStarted() || visibleTrials().length > 0;
  const showPendingExpected = Boolean(pendingExpected && hasTrialContext);
  if (!entries.length && !visibleTrials().length && !activeRunTrialIteration() && !showPendingExpected) return "";
  entries.forEach((entry) => {
    if (entry?.id && omittedEntryIds.has(String(entry.id))) return;
    const nextIteration = effectiveIteration(entry, currentIteration);
    const belongsToGoal = nextIteration > 0 && hasTrialContext;
    if (!belongsToGoal) {
      if (!isUiLocalTranscript(entry)) currentIteration = 0;
      return;
    }
    currentIteration = nextIteration;
    const group = trialGroups.get(currentIteration) || [];
    group.push(entry);
    trialGroups.set(currentIteration, group);
  });

  const reports = [...visibleTrials()];
  if (showPendingExpected && !reports.some((report) => trialIterationValue(report) === pendingExpected) && !isGoalPassed()) {
    const pendingReport = pendingExpectedTrialReport(pendingExpected);
    if (pendingReport) reports.push(pendingReport);
  }
  const liveIteration = isLiveGoalSession() ? activeRunTrialIteration() : 0;
  const reportByIteration = new Map(reports.map((report) => [trialIterationValue(report), report]));
  const iterationValues = new Set([
    ...reports.map((report) => trialIterationValue(report)).filter(Boolean),
  ]);
  if (liveIteration) iterationValues.add(liveIteration);
  const trials = Array.from(iterationValues)
    .sort((a, b) => a - b)
    .map((iteration) => ({
      iteration,
      entries: trialGroups.get(iteration) || [],
      report: reportByIteration.get(iteration) || null,
    }));
  const selected = selectedTrial(trials);
  const manuallySelected = Number(selectedTrialIndex || 0) > 0 && trialStripManualActive();
  const activeTrial = manuallySelected ? selected : (liveIteration || (showPendingExpected ? pendingExpected : 0) || selected);
  const activeTrialData = trials.find((trial) => Number(trial.iteration) === Number(activeTrial));
  const runningTrialData = liveIteration && Number(activeTrial) === Number(liveIteration)
    ? trials.find((trial) => isTrialLive(trial.iteration))
    : null;
  return trialHistoryHtml(trials, activeTrial, activeTrialData, runningTrialData);
}

function activeTrialHistoryHtml() {
  return trialTimelineContentHtml(sessionTranscriptEntries());
}

function sessionTimelineHtml(entries, options = {}) {
  const trialHistory = trialTimelineContentHtml(entries, options);
  if (!trialHistory) return "";
  return `
    <section class="transcript-timeline with-axis" aria-label="Agent transcript">
      ${trialHistory}
    </section>
  `;
}

function persistentAutoresearchPanelHtml(entries, options = {}) {
  if (!hasAutoresearchTrajectory()) return "";
  return sessionTimelineHtml(entries, options);
}

function isCollapsibleToolEntry(entry) {
  const role = transcriptRole(entry);
  return (role === "tool" || role === "command") && !parseFileChangeInfo(String(entry?.content || ""));
}

function toolGroupKind(entry) {
  if (webSearchActivityInfo(entry)) return "search";
  const content = compactCommandText(String(entry?.content || ""));
  if (/\b(rg|grep|find|fd)\b/.test(content)) return "search";
  if (/\b(sed|cat|head|tail|nl|wc|ls)\b/.test(content)) return "read";
  return "run";
}

function toolGroupSummary(entries) {
  const counts = entries.reduce(
    (memo, entry) => {
      memo[toolGroupKind(entry)] += 1;
      return memo;
    },
    { read: 0, search: 0, run: 0 },
  );
  const parts = [];
  if (counts.read) parts.push(`${counts.read} read${counts.read === 1 ? "" : "s"}`);
  if (counts.search) parts.push(`${counts.search} search${counts.search === 1 ? "" : "es"}`);
  if (counts.run) parts.push(`${counts.run} command${counts.run === 1 ? "" : "s"}`);
  return parts.join(", ") || `${entries.length} tool call${entries.length === 1 ? "" : "s"}`;
}

function toolGroupPreview(entries) {
  return entries
    .slice(0, 3)
    .map((entry) => compactText(compactCommandText(entry?.content || ""), 56))
    .filter(Boolean)
    .join(" · ");
}

function transcriptToolGroupHtml(entries) {
  if (!entries.length) return "";
  // Anchor the open-state key to the group's FIRST entry id, which stays stable
  // even as more tool calls stream into the same group during a live run. This
  // lets the existing run-activity persistence keep the group open across polls.
  const anchorId = String(entries.find((entry) => entry?.id)?.id || "");
  const key = anchorId ? `toolgroup-${anchorId}` : "";
  const dataAttr = key ? ` data-run-activity-details="${escapeHtml(key)}"` : "";
  const openAttr = key ? runActivityOpenAttribute(key) : "";
  return `
    <article class="transcript-message tool is-tool-group">
      <details class="tool-group-event"${dataAttr}${openAttr}>
        <summary>
          <span>Tool calls</span>
          <strong>${escapeHtml(toolGroupSummary(entries))}</strong>
          <code>${escapeHtml(toolGroupPreview(entries))}</code>
        </summary>
        <div class="tool-group-list">
          ${entries.map(transcriptEntryHtml).join("")}
        </div>
      </details>
    </article>
  `;
}

function transcriptEntriesHtml(entries) {
  const html = [];
  let toolGroup = [];
  const flushToolGroup = () => {
    if (!toolGroup.length) return;
    html.push(transcriptToolGroupHtml(toolGroup));
    toolGroup = [];
  };

  entries.forEach((entry) => {
    if (isCollapsibleToolEntry(entry)) {
      toolGroup.push(entry);
      return;
    }
    flushToolGroup();
    html.push(transcriptEntryHtml(entry));
  });
  flushToolGroup();
  return html.join("");
}

function transcriptEntryHtml(entry) {
  const role = transcriptRole(entry);
  const id = String(entry?.id || "");
  const content = String(entry?.content || "");
  const rawType = String(entry?.raw_type || "");
  const meta = transcriptMeta(entry);
  const fileChange = parseFileChangeInfo(content);
  const statusPayload = isUiCommandResult(entry) ? parseStatusCardPayload(content) : null;
  const webSearch = webSearchActivityInfo(entry);
  if (statusPayload) {
    return statusCardHtml(statusPayload, entry);
  }
  if (webSearch) {
    return `
      <article class="transcript-message tool is-compact" data-transcript-id="${escapeHtml(id)}">
        <details class="tool-event">
          <summary>
            <span>${escapeHtml(webSearch.title)}</span>
            <code>${escapeHtml(webSearch.summary)}</code>
          </summary>
          <pre>${escapeHtml(webSearch.raw)}</pre>
        </details>
      </article>
    `;
  }
  if (fileChange) {
    const status = [fileChange.action, fileChange.status].filter(Boolean).join(" / ");
    return `
      <article class="transcript-message tool is-file-change" data-transcript-id="${escapeHtml(id)}">
        <details class="file-change-event" data-file-details="${escapeHtml(fileChange.path)}">
          <summary>
            <span>File</span>
            <strong>${escapeHtml(basename(fileChange.path))}</strong>
            <em>${escapeHtml(status)}</em>
            <code>${escapeHtml(fileChange.path)}</code>
          </summary>
          <div class="inline-file" data-inline-file="${escapeHtml(fileChange.path)}">
            <div class="tree-empty">Open to load file.</div>
          </div>
        </details>
      </article>
    `;
  }
  if (role === "tool" || role === "command") {
    const label = role === "command" ? "Command" : "Tool";
    return `
      <article class="transcript-message ${role} is-compact" data-transcript-id="${escapeHtml(id)}">
        <details class="tool-event">
          <summary>
            <span>${escapeHtml(label)}</span>
            <code>${escapeHtml(compactCommandText(content))}</code>
          </summary>
          <pre>${escapeHtml(content)}</pre>
        </details>
      </article>
    `;
  }
  const actionItems = [
    messageCopyButton(content, role === "user" ? "Copy your message" : "Copy response"),
  ].filter(Boolean);
  const actions = actionItems.length ? `<div class="transcript-actions message-action-row">${actionItems.join("")}</div>` : "";
  return `
    <article class="transcript-message ${role}" data-transcript-id="${escapeHtml(id)}">
      <div class="transcript-meta">${escapeHtml(meta || transcriptTitle(entry))}</div>
      <div class="transcript-body">
        ${transcriptContentHtml(content, { markdown: role === "assistant" || role === "final" })}
      </div>
      ${actions}
    </article>
  `;
}

function renderChatSummary() {
  if (!appState || !hasLaunched()) return;
  const session = sessionState();
  const project = appState.summaries.project;
  const transcript = sessionTranscriptEntries();
  const summary = `
    <article class="message assistant project-status">
      <div class="message-body">
        <p><strong>${escapeHtml(cleanText(project.one_sentence, "Cold start is preparing the project."))}</strong></p>
        <div class="bubble-actions">
          ${session.session_id ? pill(`session ${session.session_id.slice(0, 8)}`) : pill(session.status || "launching")}
        </div>
      </div>
    </article>
  `;
  const body = transcript.length
    ? sessionTimelineHtml(transcript)
    : `<div class="transcript-empty">Cold start creates the first real agent session.</div>`;
  $("#dynamic-messages").innerHTML = summary + body;
}

function renderSession() {
  if (!appState) return;
  const session = sessionState();
  const status = session.status || "idle";
  const mode = session.mode ? ` / ${session.mode}` : "";
  const sessionId = session.session_id ? ` / ${session.session_id.slice(0, 8)}` : "";
  const loop = session.loop_active ? ` / trial ${session.loop_iteration || 0}` : session.gate?.status === "pass" ? " / gates passed" : "";
  $("#session-title").textContent = `${status}${mode}${sessionId}${loop}`;
  $("#session-command").textContent = session.command || "No agent run yet.";
  const settings = Object.keys(session.settings || {}).length ? session.settings : settingsFromForm();
  renderSettingsSummary(settings);
  const rawLogs = session.raw_logs || [];
  $("#session-log").textContent = rawLogs.length ? rawLogs.join("\n") : "No raw agent logs yet.";
  $("#stop-session").disabled = !["running", "stopping"].includes(status);
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function countTreeFiles(node) {
  if (!node) return 0;
  if (node.type === "file") return 1;
  return (node.children || []).reduce((total, child) => total + countTreeFiles(child), 0);
}

function countTreeFolders(node) {
  if (!node || node.type === "file") return 0;
  return 1 + (node.children || []).reduce((total, child) => total + countTreeFolders(child), 0);
}

function previewButton(path, label = "Preview") {
  if (!path) return "";
  return `<button class="mini-button" type="button" data-card-preview="${escapeHtml(path)}">${escapeHtml(label)}</button>`;
}

function copyButton(text, label = "Copy", message = "Copied.") {
  const value = String(text || "").trim();
  if (!value) return "";
  return `<button class="secondary-button small-button" type="button" data-copy-text="${escapeHtml(encodeURIComponent(value))}" data-copy-label="${escapeHtml(message)}">${escapeHtml(label)}</button>`;
}

function copyIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="8" y="8" width="11" height="11" rx="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path>
    </svg>
  `;
}

function checkIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12.5l4.2 4.2L19 6.8"></path>
    </svg>
  `;
}

function messageCopyButton(text, label = "Copy message", message = "Message copied.") {
  const value = String(text || "").trim();
  if (!value) return "";
  return `
    <button class="message-copy-button" type="button" data-copy-text="${escapeHtml(encodeURIComponent(value))}" data-copy-label="${escapeHtml(message)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      ${copyIconSvg()}
    </button>
  `;
}

function inlineOpenButton(path, label = "Open source") {
  const raw = String(path || "");
  const zipSplit = raw.includes("::") ? raw.split("::", 1)[0] : raw;
  const value = repoRelativePath(zipSplit);
  if (!value || value.includes("*")) return "";
  const adjustedLabel = raw.includes("::") && label === "Open source" ? "Open source archive" : label;
  return `<button class="secondary-button small-button" type="button" data-inline-fullscreen="${escapeHtml(value)}" title="${escapeHtml(raw)}">${escapeHtml(adjustedLabel)}</button>`;
}

function renderTree(node, depth = 0) {
  if (!node) return empty("No files here yet.");
  if (node.type === "file") {
    const filePath = repoRelativePath(node.path || node.name);
    const fileMeta = node.is_symlink ? `${filePath} · linked` : filePath;
    if (!node.previewable) {
      return `
        <div class="tree-file is-disabled">
          <span>${escapeHtml(node.name)}</span>
          <small>${escapeHtml(fileMeta)}</small>
        </div>
      `;
    }
    return `
      <details class="tree-file-node" data-file-details="${escapeHtml(filePath)}">
        <summary>
          <span>${escapeHtml(node.name)}</span>
          <small>${escapeHtml(fileMeta)}</small>
        </summary>
        <div class="inline-file" data-inline-file="${escapeHtml(filePath)}">
          <div class="tree-empty">Open to load file.</div>
        </div>
      </details>
    `;
  }
  const children = node.children || [];
  const body = children.length ? children.map((child) => renderTree(child, depth + 1)).join("") : `<div class="tree-empty">Empty</div>`;
  const itemLabel = children.length === 1 ? "item" : "items";
  const folderMeta = `${children.length} ${itemLabel}${node.is_symlink ? " · linked folder" : ""}`;
  return `
    <details class="tree-folder ${node.is_symlink ? "is-symlink" : ""}" ${depth <= 1 ? "open" : ""}>
      <summary>
        <span>${escapeHtml(node.name)}</span>
        <small>${escapeHtml(folderMeta)}</small>
      </summary>
      <div class="tree-children">${body}</div>
    </details>
  `;
}

function renderFileManager(title, rootPath, tree, emptyText) {
  const files = countTreeFiles(tree);
  const folders = Math.max(0, countTreeFolders(tree) - 1);
  const fileLabel = files === 1 ? "file" : "files";
  const folderLabel = folders === 1 ? "folder" : "folders";
  return `
    <section class="file-manager">
      <header class="file-manager-head">
        <div>
          <p class="eyebrow">File browser</p>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(rootPath)}</p>
        </div>
        <div class="file-manager-count">
          <strong>${files}</strong>
          <span>${fileLabel} / ${folders} ${folderLabel}</span>
        </div>
      </header>
      <div class="file-manager-body">
        ${tree ? `<section class="tree-shell">${renderTree(tree)}</section>` : empty(emptyText)}
      </div>
    </section>
  `;
}

function renderWorkspacePanel() {
  return renderFileManager(
    "Project files",
    appState?.repo_root || "./",
    appState.trees?.workspace,
    "No project files found."
  );
}

function contextCard(title, body, meta = "", action = "") {
  const inlineSlot = String(action || "").includes("data-card-preview") ? `<div class="card-inline-file" hidden></div>` : "";
  return `
    <section class="context-card">
      <div class="item-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${meta ? `<div class="meta">${meta}</div>` : ""}
        </div>
        ${action}
      </div>
      ${body}
      ${inlineSlot}
    </section>
  `;
}

function list(items, emptyText = "Nothing here yet.") {
  const values = (items || []).filter((item) => !looksPlaceholder(item));
  if (!values.length) return empty(emptyText);
  return `<ul class="context-list">${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderResourcesPanel() {
  return renderFileManager("Resources", "resources/", appState.trees?.resources, "No resource files yet.");
}

function renderTrialsPanel() {
  return renderFileManager("Trials and research trajectory", "research_trajectory/", appState.trees?.trials, "No trials yet.");
}

function reviewTypeLabel(type) {
  const labels = {
    trial_review: "Trial review",
    process_review: "Process review",
    manuscript_review: "Manuscript review",
    figure_table_review: "Figure/table review",
  };
  return labels[type] || String(type || "Review").replaceAll("_", " ");
}

function reviewTrialId(review) {
  const explicit = String(review.source_trial || "").trim();
  if (explicit) return explicit.replace(/^research_trajectory\/trials\//, "").replace(/\/$/, "");
  const path = String(review.path || "");
  const match = path.match(/research_trajectory\/(?:[^/]+\/)?trials\/([^/]+)/);
  return match ? match[1] : "";
}

function reviewTrialNumber(trialId) {
  const match = String(trialId || "").match(/^0*(\d+)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function reviewReadableTrial(trialId) {
  const text = String(trialId || "").trim();
  if (!text) return "";
  const number = reviewTrialNumber(text);
  const name = text.replace(/^\d+_?/, "").replaceAll("_", " ");
  return Number.isFinite(number) ? `Trial ${number}: ${name || text}` : text.replaceAll("_", " ");
}

function reviewDisplayTitle(review) {
  const trialId = reviewTrialId(review);
  if (trialId) return reviewReadableTrial(trialId);
  const title = cleanText(review.title, "");
  if (title) return title.replaceAll("_", " ");
  return basename(review.path || review.name || "Review");
}

function reviewDecision(review) {
  const decision = cleanText(review.decision || review.verdict, "");
  return decision ? decision.replaceAll("_", " ") : "";
}

function reviewSummary(review) {
  const summary = cleanText(review.summary, "");
  if (!summary) return "No summary recorded.";
  if (/^(Reviewer|Decision|Status|Verdict):/i.test(summary)) return "Review metadata recorded.";
  return summary;
}

function reviewSortKey(review) {
  const type = String(review.type || "");
  const trialId = reviewTrialId(review);
  const number = reviewTrialNumber(trialId);
  const path = String(review.path || "");
  return `${Number.isFinite(number) ? String(number).padStart(6, "0") : "999999"}-${type}-${path}`;
}

function reviewWorkflowOrder(review) {
  const path = String(review.path || review.name || "").toUpperCase();
  const reviewer = String(review.reviewer || "").toLowerCase();
  const pairs = [
    ["PLAN_REVIEW", "plan"],
    ["PROCESS_REVIEW", "process"],
    ["EVIDENCE_REVIEW", "evidence"],
    ["VENUE_FIT_REVIEW", "venue"],
    ["MANUSCRIPT_REVIEW", "manuscript"],
    ["FIGURE_TABLE_REVIEW", "figure"],
    ["REFERENCE_REVIEW", "reference"],
    ["FINAL_GATE_REVIEW", "final"],
  ];
  const index = pairs.findIndex(([fileToken, reviewerToken]) => path.includes(fileToken) || reviewer.includes(reviewerToken));
  return index >= 0 ? index : pairs.length;
}

function reviewTrialGroupKey(review) {
  const trialId = reviewTrialId(review);
  if (trialId) return `trial:${trialId}`;
  return `other:${review.type || "review"}`;
}

function reviewTrialGroupLabel(group) {
  if (group.trialId) return reviewReadableTrial(group.trialId);
  if (group.type === "manuscript_review") return "Manuscript-level reviews";
  if (group.type === "figure_table_review") return "Figure/table reviews";
  if (group.type === "process_review") return "Process reviews";
  return "Other reviews";
}

function reviewDecisionCounts(reviews) {
  const counts = { pass: 0, continue: 0, other: 0 };
  for (const review of reviews) {
    const decision = reviewDecision(review).toLowerCase();
    if (decision === "pass") counts.pass += 1;
    else if (decision === "continue") counts.continue += 1;
    else counts.other += 1;
  }
  return counts;
}

function groupedReviews(reviews) {
  const groups = new Map();
  for (const review of reviews) {
    const key = reviewTrialGroupKey(review);
    if (!groups.has(key)) {
      const trialId = reviewTrialId(review);
      groups.set(key, {
        key,
        trialId,
        type: review.type || "review",
        number: trialId ? reviewTrialNumber(trialId) : Number.NEGATIVE_INFINITY,
        reviews: [],
      });
    }
    groups.get(key).reviews.push(review);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      reviews: group.reviews.sort((a, b) => {
        const order = reviewWorkflowOrder(a) - reviewWorkflowOrder(b);
        if (order) return order;
        return reviewSortKey(a).localeCompare(reviewSortKey(b));
      }),
    }))
    .sort((a, b) => {
      const aNumber = Number.isFinite(a.number) ? a.number : -1;
      const bNumber = Number.isFinite(b.number) ? b.number : -1;
      if (aNumber !== bNumber) return aNumber - bNumber;
      return reviewTrialGroupLabel(a).localeCompare(reviewTrialGroupLabel(b));
    });
}

function reviewGroupStatusLabel(group) {
  const counts = reviewDecisionCounts(group.reviews);
  return [
    `${group.reviews.length} review${group.reviews.length === 1 ? "" : "s"}`,
    counts.pass ? `${counts.pass} pass` : "",
    counts.continue ? `${counts.continue} continue` : "",
    counts.other ? `${counts.other} other` : "",
  ].filter(Boolean).join(" · ");
}

function reviewGroupShortStatus(group) {
  const counts = reviewDecisionCounts(group.reviews);
  if (counts.continue) return "continue";
  if (counts.other) return "mixed";
  if (counts.pass && counts.pass === group.reviews.length) return "pass";
  return `${group.reviews.length}`;
}

function reviewGroupIndexLabel(group) {
  if (Number.isFinite(group.number) && group.number >= 0) return String(group.number);
  if (group.type === "manuscript_review") return "M";
  if (group.type === "figure_table_review") return "F";
  if (group.type === "process_review") return "P";
  return "R";
}

function selectedReviewGroup(groups) {
  if (!groups.length) return null;
  const selected = selectedReviewGroupKey ? groups.find((group) => group.key === selectedReviewGroupKey) : null;
  if (selected) return selected;
  const latestTrial = [...groups].reverse().find((group) => Number.isFinite(group.number) && group.number >= 0);
  const fallback = latestTrial || groups[0];
  selectedReviewGroupKey = fallback.key;
  return fallback;
}

function reviewTrialStripHtml(groups, activeGroup) {
  if (!groups.length) return "";
  return `
    <nav class="trial-strip review-trial-strip" aria-label="Review trials">
      <span>Trials</span>
      <button class="trial-scroll-button" type="button" data-review-trial-scroll="-1" aria-label="Previous review trials">‹</button>
      <div class="trial-strip-scroll review-trial-strip-scroll">
        ${groups
          .map((group) => {
            const active = activeGroup?.key === group.key;
            const label = reviewTrialGroupLabel(group);
            const status = reviewGroupStatusLabel(group);
            return `
              <button class="trial-chip review-trial-chip ${active ? "is-active" : ""}" type="button" data-review-trial-select="${escapeHtml(group.key)}" data-review-status="${escapeHtml(reviewGroupShortStatus(group))}" title="${escapeHtml(`${label} · ${status}`)}" aria-label="${escapeHtml(`${label}: ${status}`)}">
                <strong class="trial-chip-index">${escapeHtml(reviewGroupIndexLabel(group))}</strong>
                <span class="trial-chip-status">${escapeHtml(reviewGroupShortStatus(group))}</span>
              </button>
            `;
          })
          .join("")}
      </div>
      <button class="trial-scroll-button" type="button" data-review-trial-scroll="1" aria-label="Next review trials">›</button>
    </nav>
  `;
}

function restoreReviewTrialStripScroll() {
  const strip = document.querySelector(".review-trial-strip-scroll");
  if (!strip) return;
  const active = strip.querySelector(".review-trial-chip.is-active");
  if (!active) return;
  const stripRect = strip.getBoundingClientRect();
  const chipRect = active.getBoundingClientRect();
  const pad = 14;
  if (chipRect.left >= stripRect.left + pad && chipRect.right <= stripRect.right - pad) return;
  const nextLeft = strip.scrollLeft + chipRect.left - stripRect.left - Math.max(0, (strip.clientWidth - active.offsetWidth) / 2);
  strip.scrollLeft = Math.max(0, nextLeft);
}

function reviewCardHtml(review) {
  const trialId = reviewTrialId(review);
  const decision = reviewDecision(review);
  const reviewer = cleanText(review.reviewer, "");
  const fileName = basename(review.path || review.name || "REVIEW.md");
  const meta = [
    reviewTypeLabel(review.type),
    trialId ? trialId : "",
    reviewer,
    decision,
  ].filter(Boolean);
  return `
    <article class="review-card">
      <header class="review-card-head">
        <div class="review-title-block">
          <p class="review-kicker">${escapeHtml(fileName)}</p>
          <h3>${escapeHtml(reviewer || fileName.replace(/\.md$/i, "").replaceAll("_", " ").toLowerCase())}</h3>
        </div>
        ${previewButton(review.path)}
      </header>
      <div class="review-meta-row">
        ${meta.map((item) => `<span class="review-chip">${escapeHtml(item)}</span>`).join("")}
      </div>
      <p class="review-summary">${escapeHtml(reviewSummary(review))}</p>
      <p class="review-path">${escapeHtml(review.path || "")}</p>
      <div class="card-inline-file" hidden></div>
    </article>
  `;
}

function renderReviewsPanel() {
  const reviews = (appState.reviews || []).filter(hasVisibleReview).sort((a, b) => reviewSortKey(a).localeCompare(reviewSortKey(b)));
  if (!reviews.length) return empty("No review files yet.");
  const groups = groupedReviews(reviews);
  const activeGroup = selectedReviewGroup(groups);
  return `
    <section class="reviews-panel">
      ${reviewTrialStripHtml(groups, activeGroup)}
      <section class="review-selected-group">
        <header class="review-selected-head">
          <div>
            <p class="review-group-eyebrow">${activeGroup?.trialId ? "Trial reviews" : reviewTypeLabel(activeGroup?.type)}</p>
            <h3>${escapeHtml(reviewTrialGroupLabel(activeGroup || {}))}</h3>
          </div>
          <span>${escapeHtml(activeGroup ? reviewGroupStatusLabel(activeGroup) : "")}</span>
        </header>
        <div class="review-trial-list">
          ${(activeGroup?.reviews || []).map(reviewCardHtml).join("")}
        </div>
      </section>
    </section>
  `;
}

function sectionList(sections, emptyText) {
  const values = sections || [];
  if (!values.length) return empty(emptyText);
  return `<ul class="context-list">${values
    .map(
      (section) => `
      <li>
        <strong>${escapeHtml(section.title)}</strong>
        <p class="muted">${escapeHtml(cleanText(section.body, "No detail yet.").slice(0, 260))}</p>
      </li>
    `
    )
    .join("")}</ul>`;
}

const figureSpecFieldLabels = new Set([
  "Status",
  "Figure type",
  "Purpose",
  "Argument or result role",
  "Content",
  "Content and panel layout",
  "Visual status",
  "Visual style",
  "Detailed generation-style prompt",
  "Caption",
  "Caption draft",
  "Caption draft or current caption",
  "Caption from revised source",
  "Evidence / conceptual basis",
  "Result shown or conceptual basis",
  "Linked manuscript paragraphs",
  "Linked claims",
  "Linked evidence",
  "Source trial",
  "Source artifact path",
  "Source artifact or spec path",
  "Preview image",
  "Existing source files",
  "Inclusion status",
  "Target-venue fit",
  "Target-venue fit rationale",
  "Remaining blocker",
  "Result",
  "Result shown",
  "Key results shown",
  "Small table preview, if compact enough",
  "Notes",
]);

function figureSpecFields(body) {
  const fields = {};
  let current = "";
  String(body || "")
    .replaceAll(/\r\n/g, "\n")
    .split("\n")
    .forEach((line) => {
      const match = line.trim().match(/^(.+?):\s*(.*)$/);
      const label = match ? match[1].trim() : line.trim().replace(/:$/, "");
      if (match && figureSpecFieldLabels.has(label)) {
        current = label;
        fields[current] = match[2] || "";
        return;
      }
      if (!current) return;
      fields[current] = `${fields[current]}${fields[current] ? "\n" : ""}${line}`;
    });
  Object.keys(fields).forEach((key) => {
    fields[key] = fields[key].trim();
  });
  return fields;
}

function figureSpecStatusClass(status) {
  const text = String(status || "").toLowerCase();
  if (/unused|candidate|needs|review/.test(text)) return "is-caution";
  if (/generated|referenced|active|pass/.test(text)) return "is-ready";
  return "";
}

function figureSpecExcerpt(value, limit = 320) {
  return compactText(cleanText(value, ""), limit);
}

function figureSpecDetail(label, value, limit = 320) {
  const text = figureSpecExcerpt(value, limit);
  if (!text) return "";
  return `
    <div class="figure-spec-detail">
      <strong>${escapeHtml(label)}</strong>
      <div class="markdown-preview">${markdownToHtml(text)}</div>
    </div>
  `;
}

function normalizeManuscriptKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function figureImageJobKey(title) {
  return normalizeManuscriptKey(title) || String(title || "").trim();
}

function figureImageAutoKey(title, sourcePath = "") {
  return `${figureImageJobKey(title)}::${repoRelativePath(sourcePath)}`;
}

function figureImageGenerationAvailable() {
  return effectiveBackend(currentLaunchBackend()) === "codex";
}

function isFigureImagePath(path) {
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(extension(path));
}

function figureSourceImageHtml(path, title = "Figure image") {
  const value = repoRelativePath(path);
  if (!value || !isFigureImagePath(value)) return "";
  return `
    <figure class="figure-source-preview">
      <img src="${escapeHtml(rawFileUrl(value))}" alt="${escapeHtml(title)}" loading="lazy">
      <figcaption>${escapeHtml(value)}</figcaption>
    </figure>
  `;
}

function figureImageStatusHtml(title) {
  const key = figureImageJobKey(title);
  const job = figureImageJobs.get(key);
  if (!job) return "";
  const status = String(job.status || "").toLowerCase();
  const text = status === "succeeded"
    ? `Generated ${job.output_path || ""}`.trim()
    : status === "failed"
      ? (job.error || "Image generation failed.")
      : "Generating image...";
  return `<p class="figure-image-job-status is-${escapeHtml(status || "running")}" data-figure-image-status="${escapeHtml(key)}">${escapeHtml(text)}</p>`;
}

function figureImageInFlightCount() {
  return [...figureImageJobs.values()]
    .filter((job) => ["pending", "running"].includes(String(job?.status || "").toLowerCase()))
    .length;
}

function shouldAutoGenerateFigureImage(candidate) {
  if (!figureImageGenerationAvailable()) return false;
  const title = cleanText(candidate?.title, "");
  const description = cleanText(candidate?.description, "");
  const sourcePath = repoRelativePath(candidate?.sourcePath || "");
  if (!title || !description) return false;
  if (sourcePath && isFigureImagePath(sourcePath)) return false;
  const job = figureImageJobs.get(figureImageJobKey(title));
  if (job) return false;
  return !figureImageAutoStarted.has(figureImageAutoKey(title, sourcePath));
}

function normalizeFieldLabel(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/:$/, "");
}

function markdownFieldValue(body, label) {
  const target = normalizeFieldLabel(label);
  const values = [];
  let collecting = false;
  const looksLikeLabel = (candidate) => {
    if (!candidate) return false;
    if (candidate.length > 70) return false;
    // Real field labels never contain prose punctuation in the label part.
    if (/[.,;!?]/.test(candidate)) return false;
    // Real field labels start with an uppercase letter (e.g. "Caption draft").
    // Mid-prose "X: Y" fragments like "plus scenario: validated scope" start lowercase.
    if (!/^[A-Z]/.test(candidate)) return false;
    return true;
  };
  for (const rawLine of String(body || "").replaceAll(/\r\n/g, "\n").split("\n")) {
    const trimmed = rawLine.trim();
    const line = trimmed.replace(/^[-*]\s+/, "");
    const match = line.match(/^([^:]{2,90}):\s*(.*)$/);
    if (match && looksLikeLabel(match[1].trim())) {
      const current = normalizeFieldLabel(match[1]);
      if (collecting && current !== target) break;
      if (current === target) {
        collecting = true;
        if (match[2]) values.push(match[2]);
        continue;
      }
    }
    if (collecting) values.push(rawLine);
  }
  return cleanText(values.join("\n").trim(), "");
}

function manuscriptFieldValue(section, labels) {
  for (const label of labels) {
    const value = markdownFieldValue(section?.body, label);
    if (hasRealText(value)) return value;
  }
  return "";
}

function figureDescriptionPayload(block) {
  const sections = [
    { label: "Purpose or result role", alts: ["Purpose or result role", "Argument or result role", "Purpose"] },
    { label: "Content and panel layout", alts: ["Content and panel layout", "Pseudocode / interface sketch", "Metric or result summary"] },
    { label: "Visual style", alts: ["Visual style"] },
    { label: "Caption draft or current caption", alts: ["Caption draft or current caption", "Caption draft", "Caption"] },
  ];
  return sections
    .map(({ label, alts }) => {
      const raw = manuscriptFieldValue(block, alts);
      if (!hasRealText(raw)) return "";
      const flat = String(raw).replace(/\s+/g, " ").trim();
      return `${label}: ${flat}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function paragraphPlanHtml(section) {
  const plan = manuscriptFieldValue(section, ["Paragraph plan", "Paragraph-level plan", "Writing plan"]);
  if (!hasRealText(plan)) return "";
  return `
    <section class="paragraph-plan-block architecture-paragraph-plan">
      <h5>Paragraph plan</h5>
      <div class="paragraph-plan-scroll">
        <div class="architecture-field-value">${markdownToHtml(plan)}</div>
      </div>
    </section>
  `;
}

function figureReferenceKeys(value) {
  const keys = new Set();
  const text = String(value || "");
  for (const match of text.matchAll(/\bF0*(\d{1,6})\b/gi)) {
    const number = Number(match[1]);
    if (!number) continue;
    keys.add(`figure-${number}`);
    keys.add(`f${String(number).padStart(6, "0")}`);
  }
  for (const match of text.matchAll(/\bFigure\s+(\d{1,6})\b/gi)) {
    const number = Number(match[1]);
    if (number) keys.add(`figure-${number}`);
  }
  return keys;
}

function figureTitleAlias(title) {
  return normalizeManuscriptKey(
    String(title || "")
      .replace(/^figure\s+(?:f?\d{1,6}|\d+)\s*:?\s*/i, "")
      .replace(/^figure\s+plan\s*:?\s*/i, "")
  );
}

function figureMatchKeys(section) {
  const keys = figureReferenceKeys(`${section?.title || ""}\n${section?.body || ""}`);
  const titleKey = normalizeManuscriptKey(section?.title);
  const alias = figureTitleAlias(section?.title);
  if (titleKey) keys.add(titleKey);
  if (alias) keys.add(`title-${alias}`);
  return keys;
}

function intersectSets(left, right) {
  for (const item of left) {
    if (right.has(item)) return true;
  }
  return false;
}

function figureSpecsForSection(section, specs) {
  const sectionKeys = figureMatchKeys(section);
  const sectionCorpus = normalizeManuscriptKey(`${section?.title || ""}\n${section?.body || ""}`);
  return (specs || [])
    .filter((spec) => sectionHasRealContent(spec))
    .filter((spec) => {
      const specKeys = figureMatchKeys(spec);
      if (intersectSets(sectionKeys, specKeys)) return true;
      const alias = figureTitleAlias(spec.title);
      return Boolean(alias && sectionCorpus.includes(alias));
    });
}

function findFigureSpecForPlan(plan, specs) {
  return figureSpecsForSection(plan, specs)[0] || null;
}

function figureSpecCaption(fields) {
  return (
    fields["Caption from revised source"] ||
    fields["Caption draft or current caption"] ||
    fields["Caption draft"] ||
    fields.Caption ||
    ""
  );
}

function firstArtifactPath(value) {
  const text = String(value || "");
  const candidates = [];
  for (const match of text.matchAll(/`([^`]+)`/g)) candidates.push(match[1]);
  for (const match of text.matchAll(/\b(?:manuscript|research_trajectory|resources|data|analysis|figures|outputs)\/[^\s`"')\]}>,;]+/g)) {
    candidates.push(match[0]);
  }
  for (const candidate of candidates) {
    const normalized = repoRelativePath(String(candidate || "").replace(/[.,;:)]+$/, ""));
    if (!normalized || normalized.includes("*")) continue;
    if (/\.[A-Za-z0-9]{2,8}$/.test(normalized)) return normalized;
  }
  return "";
}

function figureSpecSourcePath(fields, body) {
  return firstArtifactPath(
    [
      fields["Source artifact path"],
      fields["Existing source files"],
      fields["Visual status"],
      fields.Notes,
      body,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function figureSpecFullText(section) {
  return [`### ${cleanText(section?.title, "Untitled figure")}`, section?.body || ""].join("\n\n").trim();
}

function manuscriptActionsHtml(items) {
  const buttons = items.filter(Boolean).join("");
  return buttons ? `<div class="manuscript-actions">${buttons}</div>` : "";
}

function figureSpecCardHtml(section, options = {}) {
  const fields = figureSpecFields(section.body);
  const status = figureSpecExcerpt(fields.Status || fields["Inclusion status"], 90);
  const type = figureSpecExcerpt(fields["Figure type"], 120);
  const caption = figureSpecCaption(fields);
  const sourcePath = figureSpecSourcePath(fields, section.body);
  const compact = Boolean(options.compact);
  return `
    <article class="figure-spec-card ${compact ? "is-compact" : ""}">
      <header class="figure-spec-head">
        <div>
          <p>${escapeHtml(options.label || "Figure spec")}</p>
          <h4>${escapeHtml(cleanText(section.title, "Untitled figure"))}</h4>
        </div>
        ${status ? `<span class="figure-status ${figureSpecStatusClass(status)}">${escapeHtml(status)}</span>` : ""}
      </header>
      ${manuscriptActionsHtml([
        copyButton(figureSpecFullText(section), "Copy spec", "Figure spec copied."),
        caption ? copyButton(caption, "Copy caption", "Caption copied.") : "",
        sourcePath ? inlineOpenButton(sourcePath, "Open source") : "",
      ])}
      ${type ? `<p class="figure-type">${escapeHtml(type)}</p>` : ""}
      ${figureSpecDetail("Purpose", fields.Purpose)}
      ${figureSpecDetail("Content", fields["Content and panel layout"] || fields.Content, compact ? 220 : 340)}
      ${caption ? `<blockquote class="figure-caption">${inlineMarkup(figureSpecExcerpt(caption, compact ? 240 : 420))}</blockquote>` : ""}
      ${figureSourceImageHtml(sourcePath, section.title)}
      ${figureSpecDetail("Evidence / conceptual basis", fields["Evidence / conceptual basis"] || fields["Linked evidence"], compact ? 220 : 300)}
      ${figureSpecDetail("Target-venue fit", fields["Target-venue fit"] || fields["Target-venue fit rationale"], compact ? 180 : 260)}
      ${sourcePath ? `<p class="figure-source-path">Source: <code>${escapeHtml(sourcePath)}</code></p>` : ""}
      <details class="figure-spec-full">
        <summary>Full spec</summary>
        <div class="markdown-preview">${markdownToHtml(section.body)}</div>
      </details>
    </article>
  `;
}

function figureSpecCardsHtml(specs, options = {}) {
  const values = (specs || []).filter((section) => sectionHasRealContent(section));
  if (!values.length) return empty("No figure descriptions recorded yet.");
  return `
    <div class="figure-spec-grid">
      ${values.map((section) => figureSpecCardHtml(section, options)).join("")}
    </div>
  `;
}

function paperSectionHtml(section, specs) {
  const fields = [
    ["Section thesis", manuscriptFieldValue(section, ["Section thesis", "Thesis"])],
    ["Reader question", manuscriptFieldValue(section, ["Reader question answered", "Reader question"])],
    ["Narrative role", manuscriptFieldValue(section, ["Narrative role in target venue", "Target-venue role", "Role", "Section role"])],
    ["Purpose", manuscriptFieldValue(section, ["Purpose"])],
    ["Claims/evidence", manuscriptFieldValue(section, ["Accepted claims", "Evidence", "Claims / evidence"])],
    ["Figures/tables", manuscriptFieldValue(section, ["Figures / tables", "Figures", "Tables"])],
  ].filter(([, value]) => hasRealText(value));
  const paragraphPlan = paragraphPlanHtml(section);
  const relatedSpecs = figureSpecsForSection(section, specs);
  const fallback = fields.length || paragraphPlan ? "" : `<div class="markdown-preview">${markdownToHtml(section.body)}</div>`;
  return `
    <article class="paper-section-row">
      <header class="paper-section-head">
        <p>Blueprint section</p>
        <h4>${escapeHtml(cleanText(section.title, "Untitled section"))}</h4>
      </header>
      ${fields.length ? `
        <dl class="paper-field-grid">
          ${fields
            .map(([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd><div class="markdown-preview">${markdownToHtml(value)}</div></dd>
              </div>
            `)
            .join("")}
        </dl>
      ` : ""}
      ${paragraphPlan}
      ${fallback}
      ${relatedSpecs.length ? `
        <div class="paper-linked-block">
          <h5>Figure specs at this location</h5>
          ${figureSpecCardsHtml(relatedSpecs, { compact: true, label: "Inline figure spec" })}
        </div>
      ` : ""}
    </article>
  `;
}

function renderPaperOutline(manuscript) {
  const sections = (manuscript.sections || manuscript.section_blueprint || []).filter(sectionHasRealContent);
  const specs = (manuscript.figure_specs || []).filter(sectionHasRealContent);
  if (!sections.length) return empty("No paper outline is available yet.");
  return `
    <section class="paper-outline">
      ${hasRealText(manuscript.core_story) ? `<p class="paper-story">${escapeHtml(manuscript.core_story)}</p>` : ""}
      ${sections.map((section) => paperSectionHtml(section, specs)).join("")}
    </section>
  `;
}

function figurePlanRowHtml(plan, specs, usedSpecs) {
  const spec = findFigureSpecForPlan(plan, specs);
  if (spec) usedSpecs.add(spec);
  return `
    <article class="figure-plan-row">
      <header class="paper-section-head">
        <p>Figure plan</p>
        <h4>${escapeHtml(cleanText(plan.title, spec?.title || "Untitled figure"))}</h4>
      </header>
      ${manuscriptActionsHtml([
        copyButton([`### ${plan.title}`, plan.body].join("\n\n"), "Copy plan", "Figure plan copied."),
        spec ? copyButton(figureSpecFullText(spec), "Copy spec", "Figure spec copied.") : "",
      ])}
      <div class="markdown-preview">${markdownToHtml(plan.body)}</div>
      ${spec ? figureSpecCardHtml(spec, { label: "Matched figure spec" }) : empty("No matching figure spec found in FIGURE_SPECS.md.")}
    </article>
  `;
}

function renderFiguresPanel(manuscript) {
  const plans = (manuscript.figure_plans || manuscript.figures || []).filter(sectionHasRealContent);
  const specs = (manuscript.figure_specs || []).filter(sectionHasRealContent);
  const usedSpecs = new Set();
  const planned = plans.map((plan) => figurePlanRowHtml(plan, specs, usedSpecs)).join("");
  const unplannedSpecs = specs.filter((spec) => !usedSpecs.has(spec));
  if (!planned && !unplannedSpecs.length) return empty("No figure plan or figure specs are available yet.");
  return `
    <section class="manuscript-figures">
      ${planned}
      ${unplannedSpecs.length ? `
        <div class="paper-linked-block">
          <h5>Additional figure specs</h5>
          ${figureSpecCardsHtml(unplannedSpecs, { label: "Figure spec" })}
        </div>
      ` : ""}
    </section>
  `;
}

function realTablePlans(manuscript) {
  const source = manuscript.table_plans?.length ? manuscript.table_plans : (manuscript.tables || []);
  return source
    .filter(sectionHasRealContent)
    .filter((section) => !/^table\s+plan$/i.test(String(section.title || "").trim()))
    .filter((section) => !/^no-table rationale$/i.test(String(section.title || "").trim()));
}

function renderTablesPanel(manuscript) {
  const plans = realTablePlans(manuscript);
  if (plans.length) {
    return `
      <section class="manuscript-tables">
        ${plans
          .map((section) => manuscriptTableCardHtml({ ...section, kind: "table", is_artifact: true }))
          .join("")}
      </section>
    `;
  }
  const fallback = cleanText(manuscript.no_table_rationale, "No active tables are specified for this manuscript.");
  return `
    <section class="table-empty-rationale">
      <div>
        <h4>No active tables</h4>
        <div class="markdown-preview">${markdownToHtml(fallback)}</div>
      </div>
      ${copyButton(fallback, "Copy rationale", "No-table rationale copied.")}
    </section>
  `;
}

function renderTraceabilityPanel(manuscript) {
  const traceability = cleanText(manuscript.traceability, "");
  if (hasRealText(traceability)) {
    return `
      <details class="traceability-details">
        <summary>Claims and evidence map</summary>
        ${copyButton(traceability, "Copy traceability", "Traceability copied.")}
        <div class="markdown-preview">${markdownToHtml(traceability)}</div>
      </details>
    `;
  }
  return sectionList(manuscript.claims, "No traceability map is available yet.");
}

function manuscriptArchitectureBlocks(manuscript) {
  const primary = (manuscript.architecture || manuscript.sections || []).filter(sectionHasRealContent);
  const artifacts = (manuscript.inline_artifacts || []).filter(sectionHasRealContent);
  const seen = new Set();
  return [...primary, ...artifacts].filter((block) => {
    const key = [
      (block.is_artifact ? String(block.kind || "artifact") : "section").toLowerCase(),
      cleanText(block.path, ""),
      cleanText(block.title, ""),
      cleanText(block.body, "").slice(0, 120),
    ].join("::");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderArchitectureOverview(manuscript) {
  const toc = cleanText(manuscript.toc, "");
  if (hasRealText(toc)) {
    return `<div class="markdown-preview architecture-overview">${markdownToHtml(toc)}</div>`;
  }
  const blocks = manuscriptArchitectureBlocks(manuscript);
  if (!blocks.length) return empty("No manuscript architecture overview is available yet.");
  return `
    <nav class="architecture-toc" aria-label="Manuscript architecture">
      ${blocks
        .map((block) => `
          <div class="architecture-toc-row depth-${Math.max(3, Math.min(6, Number(block.level || 3)))}">
            <span>${escapeHtml(block.is_artifact ? String(block.kind || "artifact").toUpperCase() : "SECTION")}</span>
            <strong>${escapeHtml(cleanText(block.title, "Untitled"))}</strong>
          </div>
        `)
        .join("")}
    </nav>
  `;
}

function dedupeManuscriptBlocks(blocks) {
  const seen = new Set();
  return (blocks || []).filter((block) => {
    const key = [
      String(block?.kind || "").toLowerCase(),
      cleanText(block?.path, ""),
      cleanText(block?.title, ""),
      cleanText(block?.body, "").slice(0, 160),
    ].join("::");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function manuscriptSectionBlocks(manuscript) {
  const preferred = (manuscript.sections?.length ? manuscript.sections : manuscript.section_blueprint) || [];
  const fallback = manuscript.architecture || [];
  return dedupeManuscriptBlocks([...(preferred || []), ...(fallback || [])])
    .filter(sectionHasRealContent)
    .filter((block) => !block?.is_artifact);
}

function manuscriptArtifactBlocks(manuscript) {
  return dedupeManuscriptBlocks([
    ...(manuscript.inline_artifacts || []),
    ...(manuscript.architecture || []).filter((block) => block?.is_artifact),
    ...(manuscript.figure_plans || []).map((block) => ({ ...block, kind: block.kind || "figure", is_artifact: true })),
    ...(manuscript.table_plans || []).map((block) => ({ ...block, kind: block.kind || "table", is_artifact: true })),
  ])
    .filter(sectionHasRealContent)
    .filter((block) => block?.is_artifact);
}

function manuscriptBlueprintArtifactBlocks(manuscript) {
  return dedupeManuscriptBlocks([
    ...(manuscript?.inline_artifacts || []),
    ...(manuscript?.architecture || []).filter((block) => block?.is_artifact),
  ])
    .filter(sectionHasRealContent)
    .filter((block) => block?.is_artifact);
}

function figureImageCandidateFromBlock(block) {
  if (String(block?.kind || "").toLowerCase() !== "figure") return null;
  const title = cleanText(block?.title, "Untitled figure");
  const description = figureDescriptionPayload(block);
  const sourcePath = firstArtifactPath([
    manuscriptFieldValue(block, ["Source artifact or spec path", "Source artifact path", "Source code or artifact links", "Source artifact"]),
    block?.body,
  ].filter(Boolean).join("\n"));
  if (!title || !description) return null;
  return { title, description, sourcePath };
}

function automaticManuscriptFigureImageCandidates(manuscript) {
  const seen = new Set();
  return manuscriptBlueprintArtifactBlocks(manuscript || {})
    .map(figureImageCandidateFromBlock)
    .filter(Boolean)
    .filter((candidate) => {
      const key = figureImageJobKey(candidate.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizedPathCandidates(block) {
  const values = [
    block?.path,
    block?.title,
    ...(Array.isArray(block?.parents) ? block.parents : []),
  ];
  return values.map((value) => normalizeManuscriptKey(value)).filter(Boolean);
}

function findArtifactSectionIndex(artifact, sections) {
  const parents = Array.isArray(artifact?.parents) ? artifact.parents : [];
  for (let index = parents.length - 1; index >= 0; index -= 1) {
    const parentKey = normalizeManuscriptKey(parents[index]);
    if (!parentKey) continue;
    const matchIndex = sections.findIndex((section) => normalizedPathCandidates(section).includes(parentKey));
    if (matchIndex >= 0) return matchIndex;
  }

  const artifactPath = normalizeManuscriptKey(artifact?.path);
  if (artifactPath) {
    let best = { index: -1, length: 0 };
    sections.forEach((section, index) => {
      for (const candidate of normalizedPathCandidates(section)) {
        if (!candidate || artifactPath === candidate) continue;
        if ((artifactPath.startsWith(`${candidate}-`) || artifactPath.startsWith(candidate)) && candidate.length > best.length) {
          best = { index, length: candidate.length };
        }
      }
    });
    if (best.index >= 0) return best.index;
  }

  const placement = normalizeManuscriptKey(manuscriptFieldValue(artifact, ["Placement"]));
  if (placement) {
    const matchIndex = sections.findIndex((section) => normalizedPathCandidates(section).some((candidate) => candidate && placement.includes(candidate)));
    if (matchIndex >= 0) return matchIndex;
  }

  return -1;
}

function buildManuscriptStoryMap(manuscript) {
  const safeManuscript = manuscript || {};
  const sections = manuscriptSectionBlocks(safeManuscript).map((section) => ({ section, artifacts: [] }));
  const unplaced = [];
  for (const artifact of manuscriptArtifactBlocks(safeManuscript)) {
    const index = findArtifactSectionIndex(artifact, sections.map((node) => node.section));
    if (index >= 0) sections[index].artifacts.push(artifact);
    else unplaced.push(artifact);
  }
  return { sections, unplaced };
}

function storyMapMetaHtml(manuscript) {
  manuscript = manuscript || {};
  const rows = [
    ["Target venue", manuscript.target],
    ["Audience", manuscript.audience],
    ["Article type", manuscript.article_type],
    ["Contribution", manuscript.contribution],
    ["Evidence standard", manuscript.evidence_standard],
  ].filter(([, value]) => hasRealText(value));
  const coreStory = cleanText(manuscript.core_story, "");
  if (!rows.length && !hasRealText(coreStory)) return "";
  return `
    <header class="story-map-hero">
      <div>
        <p class="story-map-kicker">Finished-results blueprint</p>
        <h3>Manuscript story map</h3>
        ${hasRealText(coreStory) ? `<div class="story-map-core">${markdownToHtml(coreStory)}</div>` : ""}
      </div>
      ${rows.length ? `
        <dl class="story-map-meta">
          ${rows.map(([label, value]) => `
            <div>
              <dt>${escapeHtml(label)}</dt>
              <dd>${inlineMarkup(figureSpecExcerpt(value, 220))}</dd>
            </div>
          `).join("")}
        </dl>
      ` : ""}
    </header>
  `;
}

function storyMapNavHtml(manuscript, map) {
  manuscript = manuscript || {};
  const toc = cleanText(manuscript.toc, "");
  const referencesNav = (manuscript.references || []).length
    ? `<a href="#manuscript-references"><span>References</span><strong>${(manuscript.references || []).length} references</strong></a>`
    : "";
  if (hasRealText(toc)) {
    return `
      <nav class="story-map-nav" aria-label="Paper flow">
        <h4>Paper flow</h4>
        <div class="story-map-toc">${markdownToHtml(toc)}</div>
        ${referencesNav ? `<div class="story-map-link-list">${referencesNav}</div>` : ""}
      </nav>
    `;
  }
  const rows = (map.sections || []).map(({ section }) => `
    <a href="#${escapeHtml(blueprintAnchorForTitle(section.title))}">
      <span>${escapeHtml(isAbstractArchitectureBlock(section) ? "Abstract" : "Section")}</span>
      <strong>${escapeHtml(cleanText(section.title, "Untitled section"))}</strong>
    </a>
  `).join("");
  return rows || referencesNav ? `
    <nav class="story-map-nav" aria-label="Paper flow">
      <h4>Paper flow</h4>
      <div class="story-map-link-list">${rows}${referencesNav}</div>
    </nav>
  ` : "";
}

function storyPointHtml(label, value, className = "") {
  if (!hasRealText(value)) return "";
  return `
    <div class="story-point ${className}">
      <h5>${escapeHtml(label)}</h5>
      <div class="story-point-body">${markdownToHtml(value)}</div>
    </div>
  `;
}

function sectionWhyHereValue(section) {
  const question = manuscriptFieldValue(section, ["Reader question answered", "Reader question"]);
  const transition = manuscriptFieldValue(section, ["Transition job"]);
  const parts = [];
  if (hasRealText(question)) parts.push(`Reader question: ${question}`);
  if (hasRealText(transition)) parts.push(`Transition: ${transition}`);
  return parts.join("\n\n");
}

function nonEmptyDisplayText(value) {
  const text = cleanText(value, "");
  if (!hasRealText(text)) return "";
  if (/^(?:none|no active display|no display|no displays|n\/a)\.?$/i.test(text)) return "";
  return text;
}

function artifactTakeawayHtml(block) {
  const kind = artifactKindLabel(block.kind);
  const kindSlug = escapeHtml(normalizeManuscriptKey(block.kind) || "artifact");
  const isTable = String(block.kind || "").toLowerCase() === "table";
  const status = manuscriptFieldValue(block, ["Inclusion status", "Status"]);
  const title = isTable
    ? manuscriptFieldValue(block, ["Table number/title", "Table title", "Title"]) || cleanText(block.title, "Untitled table")
    : cleanText(block.title, "Untitled artifact");
  const takeaway = manuscriptFieldValue(block, [
    "Reader takeaway",
    "Purpose or result role",
    "Argument or result role",
    "Result shown or conceptual basis",
    "Key result or conceptual contrast shown",
    "Metric or result summary",
    "Purpose",
  ]);
  const caption = manuscriptFieldValue(block, ["Caption draft or current caption", "Caption draft", "Caption"]);
  const sourcePath = firstArtifactPath([
    manuscriptFieldValue(block, ["Source artifact or spec path", "Source artifact path", "Source code or artifact links", "Source artifact"]),
    block.body,
  ].filter(Boolean).join("\n"));
  const description = !isTable ? figureDescriptionPayload(block) : "";
  const tableBody = isTable ? publicationReadyTableMarkdown(block) : "";
  const notes = isTable ? manuscriptFieldValue(block, ["Table notes / definitions / abbreviations", "Table notes", "Notes"]) : "";
  return `
    <article id="${escapeHtml(blueprintAnchorForTitle(block.title))}" class="manuscript-artifact-card story-artifact-card ${isTable ? "manuscript-table-card " : ""}artifact-${kindSlug}">
      <header class="figure-spec-head story-artifact-head">
        <div>
          <p>${escapeHtml(kind)} block</p>
          <h5>${escapeHtml(title)}</h5>
        </div>
        ${status ? `<span class="figure-status ${figureSpecStatusClass(status)}">${escapeHtml(figureSpecExcerpt(status, 90))}</span>` : ""}
      </header>
      ${manuscriptActionsHtml([
        !isTable
          ? copyButton(
              description,
              "Copy description",
              "Figure description copied.",
            )
          : "",
        sourcePath ? inlineOpenButton(sourcePath, "Open source") : "",
      ])}
      ${storyPointHtml("Reader takeaway", takeaway, "is-takeaway")}
      ${caption ? `<blockquote class="figure-caption">${inlineMarkup(figureSpecExcerpt(caption, 520))}</blockquote>` : ""}
      ${!isTable ? figureSourceImageHtml(sourcePath, title) : ""}
      ${!isTable ? figureImageStatusHtml(title) : ""}
      ${isTable ? (tableBody ? `<div class="publication-table-preview markdown-preview">${markdownToHtml(tableBody)}</div>` : `<p class="table-missing-warning">Missing publication-ready table body. Active tables must include a Markdown table in this block.</p>`) : ""}
      ${hasRealText(notes) ? `<div class="table-notes markdown-preview"><strong>Notes.</strong> ${markdownToHtml(notes)}</div>` : ""}
      ${sourcePath ? `<p class="figure-source-path">Source: <code>${escapeHtml(sourcePath)}</code></p>` : ""}
      <details class="story-details artifact-full-block">
        <summary>Full block</summary>
        <div class="markdown-preview">${markdownToHtml(block.body)}</div>
      </details>
    </article>
  `;
}

function sectionDisplaysHtml(node) {
  const placed = nonEmptyDisplayText(manuscriptFieldValue(node.section, ["Placed displays / methods / results", "Figures / tables", "Displays / methods / results"]));
  const artifacts = (node.artifacts || []).map(artifactTakeawayHtml).join("");
  if (!hasRealText(placed) && !artifacts) {
    return storyPointHtml("Displays", "No display, method, table, or result block is placed here.", "is-display-empty");
  }
  return `
    <section class="story-displays">
      <h5>Displays</h5>
      ${hasRealText(placed) ? `<div class="story-display-note">${markdownToHtml(placed)}</div>` : ""}
      ${artifacts ? `<div class="story-artifact-list">${artifacts}</div>` : ""}
    </section>
  `;
}

function sectionStoryDetailsHtml(section) {
  const fieldList = architectureFieldListHtml(section);
  const paragraphPlan = paragraphPlanHtml(section);
  const qualification = manuscriptFieldValue(section, ["Local qualifications", "Required qualifications", "Required qualification"]);
  if (!fieldList && !paragraphPlan && !hasRealText(qualification)) return "";
  return `
    <details class="story-details section-story-details">
      <summary>Writing plan and constraints</summary>
      ${hasRealText(qualification) ? storyPointHtml("Qualifications", qualification) : ""}
      ${paragraphPlan}
      ${fieldList ? `
        <section class="story-raw-fields">
          <h5>Structured fields</h5>
          ${fieldList}
        </section>
      ` : ""}
    </details>
  `;
}

function sectionStoryHtml(node) {
  const section = node.section;
  const sectionBrief = manuscriptFieldValue(section, ["Section brief", "Reader-facing brief", "Story brief"]);
  const mainTakeaway = manuscriptFieldValue(section, ["Local thesis / purpose", "Section thesis", "Thesis", "Purpose"]);
  const claims = manuscriptFieldValue(section, ["Local claims in plain language", "Accepted claims", "Claims"]);
  const evidence = manuscriptFieldValue(section, ["Local evidence, results, or artifacts", "Evidence", "Results / artifacts", "Results or artifacts"]);
  const whyHere = sectionWhyHereValue(section);
  const isAbstract = isAbstractArchitectureBlock(section);
  return `
    <article id="${escapeHtml(blueprintAnchorForTitle(section.title))}" class="story-section-card paper-section-row ${isAbstract ? "manuscript-abstract-card is-abstract" : ""} depth-${Math.max(3, Math.min(6, Number(section.level || 3)))}">
      <header class="story-section-head">
        <p>${escapeHtml(isAbstract ? "Abstract" : (section.path && section.path !== section.title ? section.path : "Manuscript section"))}</p>
        <h4>${escapeHtml(cleanText(section.title, "Untitled section"))}</h4>
      </header>
      ${hasRealText(sectionBrief) ? `<div class="story-section-brief">${markdownToHtml(sectionBrief)}</div>` : ""}
      <div class="story-section-grid">
        ${storyPointHtml("Main takeaway", mainTakeaway, "is-main")}
        ${storyPointHtml("What this section says", claims)}
        ${storyPointHtml("Evidence / results", evidence)}
        ${storyPointHtml("Why here", whyHere)}
      </div>
      ${sectionDisplaysHtml(node)}
      ${sectionStoryDetailsHtml(section)}
    </article>
  `;
}

function unplacedArtifactsHtml(artifacts) {
  if (!artifacts?.length) return "";
  return `
    <section class="story-unplaced">
      <h4>Unplaced displays / result blocks</h4>
      <p>These blocks are parsed from the blueprint but are not attached to a manuscript section.</p>
      <div class="story-artifact-list">
        ${artifacts.map(artifactTakeawayHtml).join("")}
      </div>
    </section>
  `;
}

function renderManuscriptStoryMap(manuscript) {
  manuscript = manuscript || {};
  const map = buildManuscriptStoryMap(manuscript);
  if (!map.sections.length && !map.unplaced.length && !hasRealText(manuscript.core_story)) {
    return empty("No manuscript story map is available yet.");
  }
  return `
    <section class="manuscript-story-map" id="manuscript-story-map">
      ${storyMapMetaHtml(manuscript)}
      ${storyMapNavHtml(manuscript, map)}
      <div class="story-section-list">
        ${map.sections.map(sectionStoryHtml).join("")}
      </div>
      ${unplacedArtifactsHtml(map.unplaced)}
    </section>
  `;
}

function architectureFieldListHtml(block) {
  const fields = [
    { label: "Target-venue role", value: manuscriptFieldValue(block, ["Target-venue role", "Narrative role in target venue", "Section role"]) },
    { label: "Reader question", value: manuscriptFieldValue(block, ["Reader question answered", "Reader question"]) },
    { label: "Local thesis / purpose", value: manuscriptFieldValue(block, ["Local thesis / purpose", "Section thesis", "Thesis", "Purpose"]) },
    { label: "Local claims", value: manuscriptFieldValue(block, ["Local claims in plain language", "Accepted claims", "Claims"]) },
    { label: "Evidence / results / artifacts", value: manuscriptFieldValue(block, ["Local evidence, results, or artifacts", "Evidence", "Results / artifacts", "Results or artifacts"]), long: true },
    { label: "Placed objects", value: manuscriptFieldValue(block, ["Placed displays / methods / results", "Figures / tables", "Displays / methods / results"]), long: true },
    { label: "Qualifications", value: manuscriptFieldValue(block, ["Local qualifications", "Required qualifications", "Required qualification"]) },
    { label: "Transition", value: manuscriptFieldValue(block, ["Transition job"]) },
  ].filter((field) => hasRealText(field.value));
  if (!fields.length) return "";
  return `
    <dl class="architecture-field-list">
      ${fields
        .map((field) => `
          <div class="architecture-field-row ${field.long ? "is-long" : "is-short"}">
            <dt>${escapeHtml(field.label)}</dt>
            <dd><div class="architecture-field-value">${markdownToHtml(field.value)}</div></dd>
          </div>
        `)
        .join("")}
    </dl>
  `;
}

function architectureFieldGridHtml(block) {
  return architectureFieldListHtml(block);
}

function artifactKindLabel(kind) {
  const value = String(kind || "").toLowerCase();
  if (value === "figure") return "Figure";
  if (value === "table") return "Table";
  if (value === "algorithm") return "Algorithm / method";
  if (value === "method") return "Method";
  if (value === "dataset") return "Dataset";
  if (value === "benchmark") return "Benchmark";
  if (value === "result") return "Dataset / benchmark / result";
  return "Artifact";
}

function isAbstractArchitectureBlock(block) {
  const title = cleanText(block?.title, "").toLowerCase();
  return /^abstract(?:\s+plan|\b)/.test(title);
}

function firstMarkdownTable(text) {
  const lines = String(text || "").replaceAll(/\r\n/g, "\n").split("\n");
  const splitTableRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const isDivider = (line) => {
    if (!line.includes("|")) return false;
    const cells = splitTableRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  };
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes("|") || !isDivider(lines[index + 1])) continue;
    const tableLines = [lines[index], lines[index + 1]];
    index += 2;
    while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
      tableLines.push(lines[index]);
      index += 1;
    }
    return tableLines.join("\n");
  }
  return "";
}

function publicationReadyTableMarkdown(block) {
  const field = manuscriptFieldValue(block, ["Publication-ready table", "Publication ready table", "Table body"]);
  return firstMarkdownTable(field) || firstMarkdownTable(block?.body || "");
}

function manuscriptAbstractCardHtml(block) {
  const paragraphPlan = paragraphPlanHtml(block);
  const fieldGrid = architectureFieldGridHtml(block);
  const fallback = fieldGrid || paragraphPlan ? "" : `<div class="markdown-preview">${markdownToHtml(block.body)}</div>`;
  return `
    <article id="${escapeHtml(blueprintAnchorForTitle(block.title))}" class="paper-section-row manuscript-abstract-card depth-${Math.max(3, Math.min(6, Number(block.level || 3)))}">
      <header class="paper-section-head abstract-section-head">
        <p>Abstract</p>
        <h4>${escapeHtml(cleanText(block.title, "Abstract plan"))}</h4>
      </header>
      ${fieldGrid}
      ${paragraphPlan}
      ${fallback}
    </article>
  `;
}

function manuscriptTableCardHtml(block) {
  const status = manuscriptFieldValue(block, ["Inclusion status", "Status"]);
  const placement = manuscriptFieldValue(block, ["Placement"]);
  const role = manuscriptFieldValue(block, ["Purpose or result role", "Argument or result role", "Purpose"]);
  const tableTitle = manuscriptFieldValue(block, ["Table number/title", "Table title", "Title"]) || cleanText(block.title, "Untitled table");
  const tableBody = publicationReadyTableMarkdown(block);
  const caption = manuscriptFieldValue(block, ["Caption draft or current caption", "Caption draft", "Caption"]);
  const notes = manuscriptFieldValue(block, ["Table notes / definitions / abbreviations", "Table notes", "Notes"]);
  const sourcePath = firstArtifactPath([
    manuscriptFieldValue(block, ["Source artifact or spec path", "Source artifact path", "Source artifact"]),
    block.body,
  ].filter(Boolean).join("\n"));
  const details = [
    ["Placement", placement],
    ["Purpose / role", role],
    ["Key result / contrast", manuscriptFieldValue(block, ["Key result or conceptual contrast shown"])],
    ["Provenance", manuscriptFieldValue(block, ["Provenance links", "Source links"])],
    ["Target-venue fit", manuscriptFieldValue(block, ["Target-venue fit rationale"])],
    ["Remaining blocker", manuscriptFieldValue(block, ["Remaining blocker"])],
  ].filter(([, value]) => hasRealText(value));
  return `
    <article id="${escapeHtml(blueprintAnchorForTitle(block.title))}" class="manuscript-artifact-card manuscript-table-card artifact-table depth-${Math.max(3, Math.min(6, Number(block.level || 3)))}">
      <header class="figure-spec-head table-card-head">
        <div>
          <p>Publication-ready table</p>
          <h4>${escapeHtml(tableTitle)}</h4>
        </div>
        ${status ? `<span class="figure-status ${figureSpecStatusClass(status)}">${escapeHtml(figureSpecExcerpt(status, 90))}</span>` : ""}
      </header>
      ${manuscriptActionsHtml([
        tableBody ? copyButton(tableBody, "Copy table", "Table copied.") : "",
        sourcePath ? inlineOpenButton(sourcePath, "Open source") : "",
      ])}
      ${caption ? `<blockquote class="figure-caption table-caption">${inlineMarkup(figureSpecExcerpt(caption, 520))}</blockquote>` : ""}
      ${tableBody ? `<div class="publication-table-preview markdown-preview">${markdownToHtml(tableBody)}</div>` : `<p class="table-missing-warning">Missing publication-ready table body. Active tables must include a Markdown table in this block.</p>`}
      ${hasRealText(notes) ? `<div class="table-notes markdown-preview"><strong>Notes.</strong> ${markdownToHtml(notes)}</div>` : ""}
      ${details.length ? `
        <dl class="paper-field-grid artifact-field-grid">
          ${details
            .map(([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd><div class="markdown-preview">${markdownToHtml(value)}</div></dd>
              </div>
            `)
            .join("")}
        </dl>
      ` : ""}
      ${sourcePath ? `<p class="figure-source-path">Source: <code>${escapeHtml(sourcePath)}</code></p>` : ""}
      <details class="figure-spec-full">
        <summary>Full block</summary>
        <div class="markdown-preview">${markdownToHtml(block.body)}</div>
      </details>
    </article>
  `;
}

function manuscriptArtifactCardHtml(block) {
  if (String(block.kind || "").toLowerCase() === "table") return manuscriptTableCardHtml(block);
  const kind = artifactKindLabel(block.kind);
  const status = manuscriptFieldValue(block, ["Inclusion status", "Status"]);
  const placement = manuscriptFieldValue(block, ["Placement"]);
  const role = manuscriptFieldValue(block, ["Purpose or result role", "Argument or result role", "Purpose"]);
  const caption = manuscriptFieldValue(block, ["Caption draft or current caption", "Caption draft", "Caption"]);
  const isFigure = String(block.kind || "").toLowerCase() === "figure";
  const sourcePath = firstArtifactPath([
    manuscriptFieldValue(block, ["Source artifact or spec path", "Source artifact path", "Source code or artifact links", "Source artifact"]),
    block.body,
  ].filter(Boolean).join("\n"));
  const description = isFigure ? figureDescriptionPayload(block) : "";
  const details = [
    ["Placement", placement],
    ["Purpose / role", role],
    ["Content", manuscriptFieldValue(block, ["Content and panel layout", "Pseudocode / interface sketch", "Metric or result summary"])],
    ["Evidence / basis", manuscriptFieldValue(block, ["Result shown or conceptual basis", "Key result or conceptual contrast shown", "Validation evidence", "Manuscript claim supported in plain language"])],
    ["Provenance", manuscriptFieldValue(block, ["Provenance links", "Source links"])],
    ["Target-venue fit", manuscriptFieldValue(block, ["Target-venue fit rationale"])],
    ["Remaining blocker", manuscriptFieldValue(block, ["Remaining blocker"])],
  ].filter(([, value]) => hasRealText(value));
  return `
    <article id="${escapeHtml(blueprintAnchorForTitle(block.title))}" class="manuscript-artifact-card artifact-${escapeHtml(String(block.kind || "artifact"))} depth-${Math.max(3, Math.min(6, Number(block.level || 3)))}">
      <header class="figure-spec-head">
        <div>
          <p>${escapeHtml(kind)} block</p>
          <h4>${escapeHtml(cleanText(block.title, "Untitled artifact"))}</h4>
        </div>
        ${status ? `<span class="figure-status ${figureSpecStatusClass(status)}">${escapeHtml(figureSpecExcerpt(status, 90))}</span>` : ""}
      </header>
      ${manuscriptActionsHtml([
        isFigure ? copyButton(description, "Copy description", "Figure description copied.") : "",
        sourcePath ? inlineOpenButton(sourcePath, "Open source") : "",
      ])}
      ${caption ? `<blockquote class="figure-caption">${inlineMarkup(figureSpecExcerpt(caption, 520))}</blockquote>` : ""}
      ${isFigure ? figureSourceImageHtml(sourcePath, block.title) : ""}
      ${isFigure ? figureImageStatusHtml(block.title) : ""}
      ${details.length ? `
        <dl class="paper-field-grid artifact-field-grid">
          ${details
            .map(([label, value]) => `
              <div>
                <dt>${escapeHtml(label)}</dt>
                <dd><div class="markdown-preview">${markdownToHtml(value)}</div></dd>
              </div>
            `)
            .join("")}
        </dl>
      ` : `<div class="markdown-preview">${markdownToHtml(block.body)}</div>`}
      ${sourcePath ? `<p class="figure-source-path">Source: <code>${escapeHtml(sourcePath)}</code></p>` : ""}
      <details class="figure-spec-full">
        <summary>Full block</summary>
        <div class="markdown-preview">${markdownToHtml(block.body)}</div>
      </details>
    </article>
  `;
}

function manuscriptArchitectureBlockHtml(block) {
  if (block.is_artifact) return manuscriptArtifactCardHtml(block);
  if (isAbstractArchitectureBlock(block)) return manuscriptAbstractCardHtml(block);
  const paragraphPlan = paragraphPlanHtml(block);
  const fieldGrid = architectureFieldGridHtml(block);
  const fallback = fieldGrid || paragraphPlan ? "" : `<div class="markdown-preview">${markdownToHtml(block.body)}</div>`;
  return `
    <article id="${escapeHtml(blueprintAnchorForTitle(block.title))}" class="paper-section-row architecture-section-row depth-${Math.max(3, Math.min(6, Number(block.level || 3)))}">
      <header class="paper-section-head">
        <p>${escapeHtml(block.path && block.path !== block.title ? block.path : "Manuscript section")}</p>
        <h4>${escapeHtml(cleanText(block.title, "Untitled section"))}</h4>
      </header>
      ${fieldGrid}
      ${paragraphPlan}
      ${fallback}
    </article>
  `;
}

function renderManuscriptArchitecture(manuscript) {
  return renderManuscriptStoryMap(manuscript);
}

function renderManuscriptAuditPanel(manuscript) {
  const provenance = cleanText(manuscript.provenance || manuscript.traceability, "");
  const legacy = [
    hasRealText(provenance)
      ? `<details class="traceability-details" open>
          <summary>Provenance / audit index</summary>
          ${copyButton(provenance, "Copy provenance", "Provenance copied.")}
          <div class="markdown-preview">${markdownToHtml(provenance)}</div>
        </details>`
      : "",
    (manuscript.figure_specs || []).filter(sectionHasRealContent).length
      ? `<details class="traceability-details">
          <summary>Secondary figure specs</summary>
          ${figureSpecCardsHtml(manuscript.figure_specs, { label: "Secondary spec" })}
        </details>`
      : "",
    realTablePlans(manuscript).length || hasRealText(manuscript.no_table_rationale)
      ? `<details class="traceability-details">
          <summary>Legacy table/source notes</summary>
          ${renderTablesPanel(manuscript)}
        </details>`
      : "",
  ].filter(Boolean).join("");
  return legacy || empty("No provenance or secondary audit notes are available yet.");
}

function renderManuscriptAppendixPanel(manuscript) {
  manuscript = manuscript || {};
  const plan = cleanText(manuscript.appendix_plan, "");
  const files = (manuscript.appendix_files || []).filter((file) => hasRealText(file?.path) || hasRealText(file?.title));
  if (!hasRealText(plan) && !files.length) return empty("No appendix or supplement plan is available yet.");
  const fileCards = files.length ? `
    <div class="appendix-file-list">
      ${files.map((file) => {
        const path = repoRelativePath(file.path || "");
        const title = cleanText(file.title, basename(path || "Appendix file"));
        const summary = cleanText(file.summary, "");
        return `
          <article class="appendix-file-card">
            <header>
              <p>Appendix file</p>
              <h4>${escapeHtml(title)}</h4>
            </header>
            ${summary ? `<div class="appendix-file-summary markdown-preview">${markdownToHtml(summary)}</div>` : ""}
            ${path ? `
              ${manuscriptActionsHtml([
                inlineOpenButton(path, "Open appendix"),
                `<button class="secondary-button small-button" type="button" data-inline-fullscreen="${escapeHtml(path)}">Fullscreen</button>`,
              ])}
              <p class="figure-source-path"><code>${escapeHtml(path)}</code></p>
            ` : ""}
          </article>
        `;
      }).join("")}
    </div>
  ` : "";
  return `
    <div class="manuscript-appendix" id="manuscript-appendix">
      ${hasRealText(plan) ? `
        <section class="appendix-plan">
          <h4>Appendix / supplement plan</h4>
          <div class="markdown-preview">${markdownToHtml(plan)}</div>
        </section>
      ` : ""}
      ${fileCards}
    </div>
  `;
}

function renderManuscriptReferences(manuscript) {
  manuscript = manuscript || {};
  const references = (manuscript.references || []).filter((ref) => hasRealText(ref?.reference) || hasRealText(ref?.key));
  if (!references.length) return empty("No resolved reference list is available yet.");
  const status = cleanText(manuscript.reference_status, "");
  const items = references.map((ref, index) => {
    const locator = cleanText(ref.locator, "");
    const isUrl = /^https?:\/\//i.test(locator);
    const locatorHtml = locator
      ? (isUrl
        ? `<a class="reference-locator" href="${escapeHtml(locator)}" target="_blank" rel="noopener noreferrer">${escapeHtml(locator)}</a>`
        : `<span class="reference-locator">${escapeHtml(locator)}</span>`)
      : "";
    return `
      <li class="reference-item">
        <span class="reference-index">${index + 1}</span>
        <div class="reference-body">
          <div class="reference-text">${inlineMarkup(cleanText(ref.reference, ""))}</div>
          <div class="reference-meta">
            ${hasRealText(ref.key) ? `<code class="reference-key">${escapeHtml(cleanText(ref.key, ""))}</code>` : ""}
            ${locatorHtml}
          </div>
        </div>
      </li>
    `;
  }).join("");
  return `
    <div class="manuscript-references" id="manuscript-references">
      ${hasRealText(status) ? `<p class="reference-status">${inlineMarkup(status)}</p>` : ""}
      <ol class="reference-list">${items}</ol>
    </div>
  `;
}

function manuscriptOutlineItemHtml(item) {
  return `
    <a class="manuscript-outline-link depth-${Math.max(1, Math.min(6, Number(item.depth || 1)))}" href="${escapeHtml(item.href)}">
      <span>${escapeHtml(item.type || "")}</span>
      <strong>${escapeHtml(item.label)}</strong>
      ${item.meta ? `<em>${escapeHtml(item.meta)}</em>` : ""}
    </a>
  `;
}

function manuscriptOutlineGroupHtml(label, items, options = {}) {
  const values = (items || []).filter((item) => item?.href && hasRealText(item?.label));
  if (!values.length) return "";
  return `
    <details class="manuscript-outline-group" ${options.open ? "open" : ""}>
      <summary>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(values.length)}</strong>
      </summary>
      <div class="manuscript-outline-links">
        ${values.map(manuscriptOutlineItemHtml).join("")}
      </div>
    </details>
  `;
}

function manuscriptOutlineHtml(manuscript) {
  manuscript = manuscript || {};
  const map = buildManuscriptStoryMap(manuscript);
  const artifacts = [
    ...map.sections.flatMap((node) => node.artifacts || []),
    ...(map.unplaced || []),
  ];
  const sectionItems = (map.sections || []).map(({ section }) => ({
    href: `#${blueprintAnchorForTitle(section.title)}`,
    type: isAbstractArchitectureBlock(section) ? "Abstract" : "Section",
    label: cleanText(section.title, "Untitled section"),
    depth: section.level || 3,
  }));
  const artifactItems = (kind) => artifacts
    .filter((block) => String(block.kind || "").toLowerCase() === kind)
    .map((block) => ({
      href: `#${blueprintAnchorForTitle(block.title)}`,
      type: artifactKindLabel(block.kind),
      label: cleanText(block.title, `Untitled ${kind}`),
      meta: manuscriptFieldValue(block, ["Inclusion status", "Status"]),
      depth: block.level || 4,
    }));
  const methodItems = artifacts
    .filter((block) => !["figure", "table"].includes(String(block.kind || "").toLowerCase()))
    .map((block) => ({
      href: `#${blueprintAnchorForTitle(block.title)}`,
      type: artifactKindLabel(block.kind),
      label: cleanText(block.title, "Untitled result"),
      meta: manuscriptFieldValue(block, ["Inclusion status", "Status"]),
      depth: block.level || 4,
    }));
  const appendixFiles = (manuscript.appendix_files || []).filter((file) => hasRealText(file?.path) || hasRealText(file?.title));
  const appendixItems = hasRealText(manuscript.appendix_plan) || appendixFiles.length
    ? [{
        href: "#manuscript-appendix-section",
        type: "Appendix",
        label: "Appendix / supplement",
        meta: appendixFiles.length ? `${appendixFiles.length} file${appendixFiles.length === 1 ? "" : "s"}` : "Plan",
      }]
    : [];
  const references = (manuscript.references || []).filter((ref) => hasRealText(ref?.reference) || hasRealText(ref?.key));
  const referenceItems = references.length
    ? [{ href: "#manuscript-references-section", type: "References", label: "Resolved references", meta: `${references.length} reference${references.length === 1 ? "" : "s"}` }]
    : [];
  const auditItems = hasRealText(manuscript.provenance || manuscript.traceability) || (manuscript.figure_specs || []).some(sectionHasRealContent)
    ? [{ href: "#manuscript-audit-section", type: "Audit", label: "Audit / provenance", meta: "Traceability" }]
    : [];
  const missingEvidence = (manuscript.missing_evidence || []).filter((item) => !looksPlaceholder(item));
  const missingItems = missingEvidence.length
    ? [{ href: "#manuscript-missing-evidence-section", type: "Evidence", label: "Missing evidence", meta: `${missingEvidence.length} item${missingEvidence.length === 1 ? "" : "s"}` }]
    : [];

  return `
    <aside class="manuscript-outline-panel" aria-label="Manuscript outline">
      <div class="manuscript-outline-brand">
        <span class="manuscript-outline-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M5 18V6" />
            <path d="M5 8h10" />
            <path d="M5 13h7" />
            <path d="M5 18h12" />
            <circle cx="5" cy="8" r="1.4" />
            <circle cx="5" cy="13" r="1.4" />
            <circle cx="5" cy="18" r="1.4" />
          </svg>
        </span>
        <div>
          <p>Manuscript map</p>
          <strong>Outline</strong>
        </div>
      </div>
      <nav class="manuscript-outline-nav">
        ${manuscriptOutlineGroupHtml("Outline", sectionItems, { open: true })}
        ${manuscriptOutlineGroupHtml("Manuscript", [
          { href: "#manuscript-blueprint-section", type: "File", label: "Current manuscript file", meta: "BLUEPRINT.md" },
        ], { open: true })}
        ${manuscriptOutlineGroupHtml("Figures", artifactItems("figure"))}
        ${manuscriptOutlineGroupHtml("Tables", artifactItems("table"))}
        ${manuscriptOutlineGroupHtml("Results / methods", methodItems)}
        ${manuscriptOutlineGroupHtml("Appendix", appendixItems)}
        ${manuscriptOutlineGroupHtml("References", referenceItems)}
        ${manuscriptOutlineGroupHtml("Audit", [...auditItems, ...missingItems])}
      </nav>
    </aside>
  `;
}

function renderManuscriptPanel() {
  const manuscript = appState.summaries?.manuscript || {};
  const blueprintViewer = `
    <div class="card-inline-file is-open" data-inline-file="manuscript/BLUEPRINT.md" data-autoload-file="manuscript/BLUEPRINT.md" data-compact-inline="true">
      <div class="tree-empty">Loading blueprint...</div>
    </div>
  `;
  const reader = [
    renderManuscriptExportBar(),
    `<div id="manuscript-story-section">${contextCard("Manuscript story map", renderManuscriptArchitecture(manuscript), "Finished-results paper map in manuscript reading order.")}</div>`,
    `<div id="manuscript-appendix-section">${contextCard("Appendix / supplement", renderManuscriptAppendixPanel(manuscript), "Supporting material and supplement files tied to the manuscript deliverable.")}</div>`,
    `<div id="manuscript-audit-section">${contextCard("Audit / provenance", renderManuscriptAuditPanel(manuscript), "Secondary links and legacy indexes; not the primary reading path.", inlineOpenButton("manuscript/figures/FIGURE_SPECS.md", "Open specs"))}</div>`,
    `<div id="manuscript-references-section">${contextCard("References", renderManuscriptReferences(manuscript), "Resolved reference list for the current source candidate.", inlineOpenButton("manuscript/references.bib", "Open .bib"))}</div>`,
    `<div id="manuscript-missing-evidence-section">${contextCard("Missing evidence", list(manuscript.missing_evidence, "No evidence gaps recorded yet."))}</div>`,
    `<div id="manuscript-blueprint-section">${contextCard("Current manuscript file", blueprintViewer, "Raw BLUEPRINT.md for editing and audit.", manuscriptActionsHtml([
      `<button class="secondary-button small-button" type="button" data-download-single-file="${escapeHtml(LATEST_MANUSCRIPT_PATH)}">Download BLUEPRINT.md</button>`,
    ]))}</div>`,
  ].join("");
  return `
    <section class="manuscript-layout">
      ${manuscriptOutlineHtml(manuscript)}
      <div class="manuscript-reader">
        ${reader}
      </div>
    </section>
  `;
}

function renderManuscriptExportBar() {
  return `
    <section class="manuscript-export-bar" id="manuscript-export" aria-label="Manuscript downloads">
      ${renderExportPanel()}
    </section>
  `;
}

function scheduleAutomaticManuscriptFigureImages() {
  clearTimeout(figureImageAutoTimer);
  figureImageAutoTimer = null;
  if (activeView !== "materials" || activePanel !== "manuscript") return;
  if (!figureImageGenerationAvailable()) return;
  const slots = Math.max(0, MAX_AUTO_FIGURE_IMAGE_JOBS - figureImageInFlightCount());
  if (!slots) return;
  const manuscript = appState?.summaries?.manuscript || {};
  const candidates = automaticManuscriptFigureImageCandidates(manuscript)
    .filter(shouldAutoGenerateFigureImage)
    .slice(0, slots);
  if (!candidates.length) return;
  figureImageAutoTimer = setTimeout(() => {
    figureImageAutoTimer = null;
    candidates.forEach((candidate) => {
      startFigureImageGeneration(candidate, { automatic: true, suppressPendingRender: true }).catch((error) => showToast(error.message, true));
    });
    if (activePanel === "manuscript") renderContext();
  }, 0);
}

function autoloadInlineFiles(root) {
  root.querySelectorAll("[data-autoload-file]").forEach((container) => {
    if (container.dataset.loaded) return;
    container.dataset.loaded = "true";
    loadInlineFile(container.dataset.autoloadFile, container, container.dataset.compactInline === "true");
  });
}

function renderContext() {
  if (!appState || activeView !== "materials") return;
  const content = $("#context-content");
  const materialView = $("#material-view");
  if (materialView) materialView.dataset.panel = activePanel;
  content.dataset.panel = activePanel;
  suppressViewScrollPersistence = true;
  if (activePanel === "workspace") content.innerHTML = renderWorkspacePanel();
  if (activePanel === "resources") content.innerHTML = renderResourcesPanel();
  if (activePanel === "trials") content.innerHTML = renderTrialsPanel();
  if (activePanel === "reviews") content.innerHTML = renderReviewsPanel();
  if (activePanel === "manuscript") content.innerHTML = renderManuscriptPanel();
  autoloadInlineFiles(content);
  if (activePanel === "manuscript") scheduleAutomaticManuscriptFigureImages();
  if (activePanel === "reviews") requestAnimationFrame(restoreReviewTrialStripScroll);
  restoreActiveViewScrollPosition();
}

function normalizeResourceItem(value) {
  if (typeof value === "string") return { path: value, category: "ongoing_work", alreadyImported: false };
  const path = String(value?.path || "").trim();
  const category = resourceCategories[value?.category] ? value.category : inferClientResourceCategory(path);
  return { path, category, alreadyImported: Boolean(value?.alreadyImported || value?.imported) };
}

function inferClientResourceCategory(path) {
  const text = String(path || "").toLowerCase();
  const ext = extension(path);
  if (text.includes("proposal") || text.includes("grant") || text.includes("application") || text.includes("aims")) return "proposals";
  if ([".pdf", ".bib", ".ris"].includes(ext) || text.includes("paper") || text.includes("literature") || text.includes("reference")) return "literature";
  if (text.includes("data") || [".csv", ".tsv", ".jsonl", ".xlsx", ".parquet"].includes(ext)) return "data_sources";
  return "ongoing_work";
}

function resourceLabel(category) {
  return resourceCategories[category] || resourceCategories.ongoing_work;
}

function saveResourceSelections() {
  scopedSet("autoResearchResourcePaths", JSON.stringify(selectedResourceItems));
}

function restoreResourceSelections() {
  selectedResourceItems.splice(0);
  try {
    const values = JSON.parse(scopedGet("autoResearchResourcePaths", "[]") || "[]");
    if (Array.isArray(values)) {
      values
        .map(normalizeResourceItem)
        .filter((item) => item.path)
        .forEach((item) => addResourcePath(item.path, { category: item.category, alreadyImported: item.alreadyImported, persist: false, notify: false }));
    }
  } catch {
    selectedResourceItems.splice(0);
  }
  renderSelectedResources();
}

function renderSelectedResources() {
  const target = $("#resource-selections");
  if (target) {
    if (!selectedResourceItems.length && !selectedUploadItems.length) {
      target.innerHTML = `<div class="resource-empty">No material attached yet.</div>`;
    } else {
      const linked = selectedResourceItems
        .map(
          (item, index) => `
            <div class="resource-chip">
              <div>
                <strong>${escapeHtml(basename(item.path))}</strong>
                <small>${escapeHtml(item.path)}</small>
              </div>
              <label class="resource-category-select">
                <span>Type</span>
                <select data-resource-category-select="${index}">
                  ${Object.entries(resourceCategories)
                    .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === item.category ? "selected" : ""}>${escapeHtml(label)}</option>`)
                    .join("")}
                </select>
              </label>
              <button class="resource-remove-button" type="button" data-resource-remove="${escapeHtml(item.path)}" aria-label="Remove ${escapeHtml(basename(item.path))}">Remove</button>
            </div>
          `
        )
        .join("");
      const uploads = selectedUploadItems
        .map(
          (item, index) => `
            <div class="resource-chip">
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <small>${escapeHtml(shortFileType(item.name, item.type))} upload · ${formatBytes(item.size)}</small>
              </div>
              <label class="resource-category-select">
                <span>Type</span>
                <select data-upload-category-select="${index}">
                  ${Object.entries(resourceCategories)
                    .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === item.category ? "selected" : ""}>${escapeHtml(label)}</option>`)
                    .join("")}
                </select>
              </label>
              <button class="resource-remove-button" type="button" data-upload-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)}">Remove</button>
            </div>
          `
        )
        .join("");
      target.innerHTML = linked + uploads;
    }
  }
  renderAttachmentTrays();
}

function addResourcePath(path, options = {}) {
  const { category = activeResourceCategory, alreadyImported = false, persist = true, notify = true } = options;
  const value = String(path || "").trim();
  if (!value || selectedResourceItems.some((item) => item.path === value)) {
    renderSelectedResources();
    return;
  }
  selectedResourceItems.push({ path: value, category: resourceCategories[category] ? category : inferClientResourceCategory(value), alreadyImported: Boolean(alreadyImported) });
  if (persist) saveResourceSelections();
  renderSelectedResources();
  if (notify) showToast(`${resourceLabel(category)} selected for launch.`);
}

function addResourcePathToActiveTarget(path, options = {}) {
  if (activeEditResourceTargetId) {
    addEditResourcePath(activeEditResourceTargetId, path, options);
    return;
  }
  addResourcePath(path, options);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function exportKindLabel(kind) {
  return kind === "final_project" ? "Clean Project Package" : "Paper-Writing Pack";
}

function exportJobTerminal(job) {
  return ["ready", "failed", "cancelled"].includes(String(job?.status || ""));
}

function exportStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "estimating") return "Estimating";
  if (value === "packaging") return "Packaging";
  if (value === "cancelling") return "Cancelling";
  if (value === "ready") return "Ready";
  if (value === "failed") return "Failed";
  if (value === "cancelled") return "Cancelled";
  return value ? value[0].toUpperCase() + value.slice(1) : "Preparing";
}

function exportProgressPercent(job) {
  const total = Number(job?.total_bytes || 0);
  const done = Number(job?.bytes_done || 0);
  if (!total) return exportJobTerminal(job) ? 100 : 0;
  return Math.max(0, Math.min(100, (done / total) * 100));
}

function exportSummaryLine(job) {
  if (!job) return "";
  const status = String(job.status || job.phase || "");
  if (status === "estimating") return "Estimating bundle size";
  if (status === "ready") return `${formatBytes(job.bytes_done || job.total_bytes)} packaged`;
  if (status === "failed") return job.error || "Export failed.";
  if (status === "cancelled") return "Export cancelled.";
  const filesDone = Number(job.files_done || 0);
  const fileCount = Number(job.file_count || 0);
  const bytesDone = Number(job.bytes_done || 0);
  const totalBytes = Number(job.total_bytes || 0);
  const parts = [];
  if (fileCount) parts.push(`${filesDone}/${fileCount} files`);
  if (totalBytes) parts.push(`${formatBytes(bytesDone)} / ${formatBytes(totalBytes)}`);
  return parts.join(" · ") || "Packaging";
}

function exportFileRows(files, limit = 8) {
  const items = Array.isArray(files) ? files.slice(0, limit) : [];
  if (!items.length) return `<p class="export-muted">None</p>`;
  return `<ul class="export-file-list">
    ${items.map((item) => `
      <li>
        <code>${escapeHtml(item.bundle_path || item.source_path || "file")}</code>
        <span>${formatBytes(item.size || 0)}</span>
      </li>
    `).join("")}
  </ul>`;
}

function exportPathRows(paths, limit = 10) {
  const items = Array.isArray(paths) ? paths.slice(0, limit) : [];
  if (!items.length) return `<p class="export-muted">None</p>`;
  return `<ul class="export-file-list is-compact">
    ${items.map((item) => `
      <li>
        <code>${escapeHtml(item.path || item.bundle_path || "path")}</code>
        <span>${escapeHtml(item.reason || item.target || "")}</span>
      </li>
    `).join("")}
  </ul>`;
}

function renderExportProgress(job) {
  if (!job) return "";
  const status = String(job.status || job.phase || "packaging");
  const percent = exportProgressPercent(job);
  const currentFile = job.current_file ? `<code title="${escapeHtml(job.current_file)}">${escapeHtml(job.current_file)}</code>` : "";
  const canCancel = ["packaging", "cancelling"].includes(status) && !job.cancel_requested;
  const canDownload = status === "ready" && job.id;
  return `
    <section class="export-job is-${escapeHtml(status)}" aria-live="polite">
      <div class="export-job-head">
        <div>
          <strong>${escapeHtml(job.label || exportKindLabel(job.kind))}</strong>
          <span>${escapeHtml(exportSummaryLine(job))}</span>
        </div>
        <span class="export-status-pill">${escapeHtml(exportStatusLabel(job.phase || status))}</span>
      </div>
      <div class="export-progress-track" aria-hidden="true">
        <span style="width: ${percent.toFixed(1)}%"></span>
      </div>
      <div class="export-job-meta">
        <span>${formatBytes(job.bytes_done || 0)} / ${formatBytes(job.total_bytes || 0)}</span>
        <span>${Number(job.files_done || 0)} / ${Number(job.file_count || 0)} files</span>
      </div>
      ${currentFile ? `<div class="export-current-file">${currentFile}</div>` : ""}
      ${job.error ? `<p class="export-error">${escapeHtml(job.error)}</p>` : ""}
      <div class="export-job-actions">
        ${canCancel ? `<button class="secondary-button small-button" type="button" data-export-cancel="${escapeHtml(job.id)}">Cancel</button>` : ""}
        ${canDownload ? `<button class="primary-button small-button" type="button" data-export-download="${escapeHtml(job.id)}">Download</button>` : ""}
      </div>
    </section>
  `;
}

function renderExportPanel() {
  const busy = activeExportJob && !exportJobTerminal(activeExportJob);
  return `
    <div class="export-panel">
      <div class="export-actions export-package-list">
        <section class="export-package-option">
          <div>
            <header>
              <strong>Paper-writing pack</strong>
              <em>Best for GPT/Claude drafting</em>
            </header>
            <p>Includes BLUEPRINT.md, final findings, venue notes, references, figure/table specs, and referenced final manuscript assets when available.</p>
          </div>
          <button class="secondary-button small-button" type="button" data-export-kind="blueprint" ${busy ? "disabled" : ""}>Download paper-writing pack</button>
        </section>
        <section class="export-package-option">
          <div>
            <header>
              <strong>Clean project package</strong>
              <em>Best for project handoff</em>
            </header>
            <p>Includes final-facing manuscript, workspace, resources, and generated outputs; excludes autoresearch logs, checkpoints, caches, and secrets.</p>
          </div>
          <button class="secondary-button small-button" type="button" data-export-kind="final_project" ${busy ? "disabled" : ""}>Download clean project package</button>
        </section>
      </div>
      ${renderExportProgress(activeExportJob)}
    </div>
  `;
}

function renderExportEstimateDetails(estimate) {
  return `
    <div class="export-confirm-summary">
      <div class="export-confirm-grid">
        <div><span>Total size</span><strong>${formatBytes(estimate?.total_bytes || 0)}</strong></div>
        <div><span>Files</span><strong>${Number(estimate?.file_count || 0)}</strong></div>
        <div><span>Threshold</span><strong>${formatBytes(estimate?.confirmation_threshold_bytes || 0)}</strong></div>
      </div>
      <details open>
        <summary>Largest files</summary>
        ${exportFileRows(estimate?.largest_files || [], 10)}
      </details>
      <details>
        <summary>Files over threshold</summary>
        ${exportFileRows(estimate?.large_files || [], 10)}
      </details>
      <details>
        <summary>Skipped content</summary>
        ${exportPathRows(estimate?.skipped || [], 12)}
      </details>
      <details>
        <summary>Missing externals</summary>
        ${exportPathRows(estimate?.missing_externals || [], 12)}
      </details>
    </div>
  `;
}

function setActiveExportJob(job) {
  activeExportJob = job || null;
  if (activePanel === "manuscript") renderContext();
}

async function beginExportFlow(kind) {
  const cleanKind = kind === "final_project" ? "final_project" : "blueprint";
  setActiveExportJob({
    kind: cleanKind,
    label: exportKindLabel(cleanKind),
    status: "estimating",
    phase: "estimating",
    total_bytes: 0,
    bytes_done: 0,
    file_count: 0,
    files_done: 0,
  });
  try {
    const estimate = await api(`/api/export/estimate?kind=${encodeURIComponent(cleanKind)}`);
    if (estimate.requires_confirmation) {
      setActiveExportJob(null);
      openExportConfirmDialog(estimate);
      return;
    }
    await startExportJob(cleanKind, false);
  } catch (error) {
    setActiveExportJob({ kind: cleanKind, label: exportKindLabel(cleanKind), status: "failed", phase: "failed", error: error.message });
    showToast(error.message, true);
  }
}

async function startExportJob(kind, confirmed = false) {
  clearTimeout(exportPollTimer);
  const response = await api("/api/export/start", {
    method: "POST",
    body: JSON.stringify({ kind, confirmed }),
  });
  const job = response.export || response.result || response;
  setActiveExportJob(job);
  scheduleExportPoll();
  showToast("Export started.");
  return job;
}

function scheduleExportPoll(delay = 900) {
  clearTimeout(exportPollTimer);
  if (!activeExportJob?.id || exportJobTerminal(activeExportJob)) return;
  exportPollTimer = setTimeout(pollExportStatus, delay);
}

async function pollExportStatus() {
  if (!activeExportJob?.id || exportJobTerminal(activeExportJob)) return;
  try {
    const response = await api(`/api/export/status?id=${encodeURIComponent(activeExportJob.id)}`);
    const job = response.export || response.result || response;
    setActiveExportJob(job);
    scheduleExportPoll(job.status === "packaging" ? 900 : 1400);
  } catch (error) {
    setActiveExportJob({ ...activeExportJob, status: "failed", phase: "failed", error: error.message });
  }
}

async function cancelExportJob(exportId) {
  if (!exportId) return;
  try {
    const response = await api("/api/export/cancel", {
      method: "POST",
      body: JSON.stringify({ id: exportId }),
    });
    const job = response.export || response.result || response;
    setActiveExportJob(job);
    scheduleExportPoll(400);
  } catch (error) {
    showToast(error.message, true);
  }
}

function downloadExportJob(exportId) {
  const job = activeExportJob?.id === exportId ? activeExportJob : null;
  const path = job?.download_url || `/api/export/download?id=${encodeURIComponent(exportId)}`;
  window.location.href = apiPath(path);
}

function downloadSingleFile(path) {
  if (!path) return;
  window.location.href = apiPath(rawFileUrl(path, { download: true }));
}

function openExportConfirmDialog(estimate) {
  pendingExportEstimate = estimate;
  const dialog = $("#export-confirm-dialog");
  const summary = $("#export-confirm-summary");
  const title = $("#export-confirm-title");
  if (title) title.textContent = `${estimate.label || exportKindLabel(estimate.kind)} is large`;
  if (summary) summary.innerHTML = renderExportEstimateDetails(estimate);
  dialog?.showModal();
}

function closeExportConfirmDialog() {
  pendingExportEstimate = null;
  $("#export-confirm-dialog")?.close();
}

async function confirmExportDialog() {
  const estimate = pendingExportEstimate;
  if (!estimate?.kind) return;
  closeExportConfirmDialog();
  try {
    await startExportJob(estimate.kind, true);
  } catch (error) {
    setActiveExportJob({ kind: estimate.kind, label: exportKindLabel(estimate.kind), status: "failed", phase: "failed", error: error.message });
    showToast(error.message, true);
  }
}

function resourceImportDestination(category) {
  const targets = {
    user_input: "resources/user_input/attachments/",
    ongoing_work: "resources/ongoing_work/",
    literature: "resources/literature/",
    proposals: "resources/proposals/",
    data_sources: "resources/data_sources/",
    target_venue: "resources/target_venue/",
    other: "resources/other/",
  };
  return targets[category] || targets.ongoing_work;
}

function activeResourceImportRecords() {
  return pendingResourceImports.filter((item) => !["done", "cancelled"].includes(item.status));
}

function hasBlockingResourceImports() {
  return activeResourceImportRecords().length > 0;
}

function blockingResourceImportMessage() {
  const active = activeResourceImportRecords();
  if (!active.length) return "";
  if (active.some((item) => item.status === "copying" || item.status === "finalizing")) {
    return "Wait for resource copy to finish before continuing.";
  }
  if (active.some((item) => item.status === "failed")) {
    return "Resolve failed resource copies before continuing.";
  }
  return "Confirm or cancel pending resource copies before continuing.";
}

function ensureResourceImportsReady() {
  if (!hasBlockingResourceImports()) return true;
  showToast(blockingResourceImportMessage(), true);
  renderAttachmentTrays();
  return false;
}

function savePendingResourceImports() {
  const serializable = activeResourceImportRecords().map((item) => ({
    id: item.id,
    importId: item.importId || "",
    name: item.name,
    type: item.type || "",
    size: item.size || 0,
    lastModified: item.lastModified || 0,
    category: item.category || "ongoing_work",
    destination: item.destination || resourceImportDestination(item.category),
    status: item.status,
    progress: Number(item.progress || 0),
    received: Number(item.received || 0),
    error: item.error || "",
  }));
  if (serializable.length) scopedSet("autoResearchResourceImports", JSON.stringify(serializable));
  else scopedRemove("autoResearchResourceImports");
}

function restorePendingResourceImports() {
  pendingResourceImports.splice(0);
  try {
    const values = JSON.parse(scopedGet("autoResearchResourceImports", "[]", { legacyFallback: false }) || "[]");
    if (Array.isArray(values)) {
      values.forEach((item) => {
        if (!item || ["done", "cancelled"].includes(item.status)) return;
        pendingResourceImports.push({
          id: String(item.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`),
          importId: String(item.importId || ""),
          name: String(item.name || "large-resource"),
          type: String(item.type || ""),
          size: Number(item.size || 0),
          lastModified: Number(item.lastModified || 0),
          category: resourceCategories[item.category] ? item.category : "ongoing_work",
          destination: String(item.destination || resourceImportDestination(item.category)),
          status: "failed",
          progress: Number(item.progress || 0),
          received: Number(item.received || 0),
          stale: true,
          error: item.error || "Page refreshed before this copy completed. Cancel it and attach the file again.",
        });
      });
    }
  } catch {
    pendingResourceImports.splice(0);
  }
  savePendingResourceImports();
  renderAttachmentTrays();
}

function updateResourceImportActionState() {
  const blocked = hasBlockingResourceImports();
  const message = blockingResourceImportMessage();
  ["#prepare-cold-start", "#open-launch-dialog", "#open-launch-dialog-inline", "#launch-autoresearch"].forEach((selector) => {
    const button = $(selector);
    if (!button) return;
    if (blocked) {
      button.disabled = true;
      button.dataset.resourceImportBlocked = "true";
      button.title = message;
    } else if (button.dataset.resourceImportBlocked === "true") {
      delete button.dataset.resourceImportBlocked;
      button.removeAttribute("title");
    }
  });
  const send = $("#chat-form .send-button");
  const cont = $("#continue-research");
  if (blocked) {
    if (send) send.disabled = true;
    if (cont) cont.disabled = true;
  }
  renderComposerActionButtons();
}

function resourceImportProgressPercent(item) {
  const size = Number(item.size || 0);
  const progress = Number(item.progress || 0);
  if (Number.isFinite(progress) && progress > 0) return Math.max(0, Math.min(100, progress * 100));
  if (!size) return 0;
  return Math.max(0, Math.min(100, (Number(item.received || 0) / size) * 100));
}

function resourceImportStatusText(item) {
  if (item.status === "pending_confirm") return `${resourceLabel(item.category)} · needs confirmation · ${formatBytes(item.size)}`;
  if (item.status === "copying") return `${resourceLabel(item.category)} · copying ${Math.round(resourceImportProgressPercent(item))}%`;
  if (item.status === "finalizing") return `${resourceLabel(item.category)} · finalizing`;
  if (item.status === "failed") return item.error || "Copy failed.";
  return `${resourceLabel(item.category)} · ${formatBytes(item.size)}`;
}

function resourceImportToChip(item) {
  const percent = resourceImportProgressPercent(item);
  const canRetry = item.status === "failed" && item.file && !item.stale;
  const copyAction = item.status === "pending_confirm"
    ? `<button class="attachment-action-button" type="button" data-resource-import-open="${escapeHtml(item.id)}">Copy</button>`
    : "";
  const retryAction = canRetry
    ? `<button class="attachment-action-button" type="button" data-resource-import-retry="${escapeHtml(item.id)}">Retry</button>`
    : "";
  const showProgress = item.status === "copying" || item.status === "finalizing";
  return `
    <div class="attachment-chip resource-import-chip is-${escapeHtml(item.status)}">
      <span class="attachment-icon">${escapeHtml(shortFileType(item.name, item.type))}</span>
      <span class="attachment-copy">
        <strong>${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(resourceImportStatusText(item))}</small>
        ${showProgress ? `<span class="attachment-progress" aria-hidden="true"><span style="width: ${percent}%"></span></span>` : ""}
      </span>
      <span class="attachment-chip-actions">
        ${copyAction}
        ${retryAction}
        <button type="button" data-resource-import-cancel="${escapeHtml(item.id)}" aria-label="Cancel ${escapeHtml(item.name)}">×</button>
      </span>
    </div>
  `;
}

function uploadToChip(item, index) {
  return `
    <div class="attachment-chip">
      <span class="attachment-icon">${escapeHtml(shortFileType(item.name, item.type))}</span>
      <span class="attachment-copy">
        <strong>${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(resourceLabel(item.category))} · upload · ${formatBytes(item.size)}</small>
      </span>
      <button type="button" data-upload-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)}">×</button>
    </div>
  `;
}

function linkToChip(item) {
  const mode = item.alreadyImported ? "copied" : "linked";
  return `
    <div class="attachment-chip">
      <span class="attachment-icon">${escapeHtml(shortFileType(item.path))}</span>
      <span class="attachment-copy">
        <strong>${escapeHtml(basename(item.path))}</strong>
        <small>${escapeHtml(resourceLabel(item.category))} · ${escapeHtml(mode)}</small>
      </span>
      <button type="button" data-resource-remove="${escapeHtml(item.path)}" aria-label="Remove ${escapeHtml(basename(item.path))}">×</button>
    </div>
  `;
}

function resumeTrialLabel(context) {
  const iteration = Number(context?.iteration || 0);
  return iteration > 0 ? `Trial ${iteration}` : "selected trial";
}

function resumeTrialContextFromReport(iteration, report) {
  if (!report?.report_path) return null;
  const actualIteration = trialIterationValue(report) || Number(iteration || 0);
  return normalizeResumeTrialContext({
    id: report.id || "",
    path: report.path || "",
    iteration: actualIteration,
    name: report.id || `Trial ${actualIteration}`,
    reportPath: report.report_path || "",
    checkpointPath: report.checkpoint_path || "",
    checkpointExists: Boolean(report.checkpoint_exists),
  });
}

function resumeContextChipHtml(context, options = {}) {
  const value = normalizeResumeTrialContext(context);
  if (!value) return "";
  const removable = options.removable !== false;
  const checkpointLabel = value.checkpointExists ? "checkpoint available" : "best-effort restore";
  return `
    <div class="attachment-chip resume-context-chip">
      <span class="attachment-icon">TRIAL</span>
      <span class="attachment-copy">
        <strong>Continue from ${escapeHtml(resumeTrialLabel(value))}</strong>
        <small>${escapeHtml(value.name)} · ${escapeHtml(checkpointLabel)}</small>
      </span>
      ${removable ? `<button type="button" data-resume-trial-remove aria-label="Remove continue-from-trial context">×</button>` : ""}
    </div>
  `;
}

function setResumeTrialContext(context) {
  selectedResumeTrialContext = normalizeResumeTrialContext(context);
  renderAttachmentTrays();
  renderComposerSuggestions();
  renderFramingConversation();
  $("#cold-file-editor")?.focus();
  if (selectedResumeTrialContext) showToast(`Ready to continue from ${resumeTrialLabel(selectedResumeTrialContext)}. Add instructions, then send.`);
}

function clearResumeTrialContext() {
  selectedResumeTrialContext = null;
  renderAttachmentTrays();
  renderComposerSuggestions();
  renderFramingConversation();
}

function selectedResumeTrialPayload() {
  const context = normalizeResumeTrialContext(selectedResumeTrialContext);
  return context ? { ...context } : null;
}

function resumeTrialOnlyMessage(context) {
  return `Continue from ${resumeTrialLabel(context)}.`;
}

function messageResumeContextHtml(message) {
  const context = normalizeResumeTrialContext(message?.resumeFromTrial);
  if (!context) return "";
  return `<div class="message-attachments">${resumeContextChipHtml(context, { removable: false })}</div>`;
}

function messageAttachmentChip(item) {
  const isLink = item.kind === "link";
  const name = isLink ? basename(item.path) : item.name;
  const label = `${resourceLabel(item.category)} · ${isLink ? item.alreadyImported ? "copied" : "linked" : item.kind === "retained" ? "retained" : "upload"}`;
  return `
    <div class="message-attachment-chip">
      <span class="attachment-icon">${escapeHtml(shortFileType(name, item.type))}</span>
      <span class="attachment-copy">
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml(label)}</small>
      </span>
    </div>
  `;
}

function normalizeEditAttachmentDraft(message) {
  const draft = { resources: [], uploads: [], retained: [] };
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") continue;
    const category = resourceCategories[attachment.category] ? attachment.category : inferClientResourceCategory(attachment.path || attachment.name || "");
    if (attachment.kind === "link" && attachment.path) {
      if (!draft.resources.some((item) => item.path === attachment.path)) {
        draft.resources.push({
          path: attachment.path,
          category,
          alreadyImported: Boolean(attachment.alreadyImported || isProjectResourcePath(attachment.path)),
        });
      }
      continue;
    }
    draft.retained.push({
      id: attachment.id || `${attachment.kind || "attachment"}_${draft.retained.length}`,
      kind: "retained",
      originalKind: attachment.kind || "attachment",
      name: attachment.name || basename(attachment.path || "attachment"),
      path: attachment.path || "",
      category,
      type: attachment.type || "",
      size: attachment.size || 0,
      alreadyImported: Boolean(attachment.alreadyImported),
    });
  }
  return draft;
}

function editAttachmentDraftForMessage(messageId) {
  const id = String(messageId || "");
  if (!id) return { resources: [], uploads: [], retained: [] };
  if (!editAttachmentDrafts.has(id)) {
    const message = localMessages.find((item) => item.id === id);
    editAttachmentDrafts.set(id, normalizeEditAttachmentDraft(message));
  }
  return editAttachmentDrafts.get(id);
}

function editDraftAttachments(id) {
  const draft = editAttachmentDraftForMessage(id);
  return [
    ...draft.resources.map((item) => {
      const attachment = {
        kind: "link",
        path: item.path,
        name: basename(item.path),
        category: item.category,
      };
      if (item.alreadyImported) attachment.alreadyImported = true;
      return attachment;
    }),
    ...draft.retained.map((item) => ({
      kind: "retained",
      name: item.name,
      path: item.path,
      category: item.category,
      type: item.type,
      size: item.size,
      originalKind: item.originalKind,
      alreadyImported: item.alreadyImported,
    })),
    ...draft.uploads.map((item) => ({
      kind: "upload",
      name: item.name,
      category: item.category,
      type: item.type,
      size: item.size,
    })),
  ];
}

function editAttachmentChip(item, index, group) {
  const isLink = item.kind === "link";
  const name = isLink ? basename(item.path) : item.name;
  const source = isLink ? item.alreadyImported ? "copied" : "linked" : item.kind === "retained" ? "retained" : "upload";
  return `
    <div class="message-attachment-chip is-editable">
      <span class="attachment-icon">${escapeHtml(shortFileType(name, item.type))}</span>
      <span class="attachment-copy">
        <strong>${escapeHtml(name || "Attachment")}</strong>
        <small>${escapeHtml(resourceLabel(item.category))} · ${escapeHtml(source)}</small>
      </span>
      <button class="attachment-remove-inline" type="button" data-edit-attachment-remove="${escapeHtml(group)}:${escapeHtml(index)}" aria-label="Remove ${escapeHtml(name || "attachment")}">Remove</button>
    </div>
  `;
}

function editAttachmentsHtml(messageId) {
  const draft = editAttachmentDraftForMessage(messageId);
  const chips = [
    ...draft.resources.map((item, index) => editAttachmentChip({ kind: "link", ...item, name: basename(item.path) }, index, "resources")),
    ...draft.retained.map((item, index) => editAttachmentChip(item, index, "retained")),
    ...draft.uploads.map((item, index) => editAttachmentChip({ kind: "upload", ...item }, index, "uploads")),
  ].join("");
  return `
    <div class="framing-edit-attachments">
      <div class="message-attachments">${chips || `<span class="attachment-empty">No resources attached.</span>`}</div>
      <div class="framing-edit-attachment-actions">
        <button class="secondary-button small-button" type="button" data-edit-upload="${escapeHtml(messageId)}">Upload files</button>
        <button class="secondary-button small-button" type="button" data-edit-link="${escapeHtml(messageId)}">Link files/folders</button>
      </div>
    </div>
  `;
}

function removeEditAttachment(messageId, token) {
  const [group, rawIndex] = String(token || "").split(":");
  const index = Number(rawIndex);
  const draft = editAttachmentDraftForMessage(messageId);
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(draft[group])) return;
  draft[group].splice(index, 1);
  renderFramingConversation();
}

function addEditResourcePath(messageId, path, options = {}) {
  const draft = editAttachmentDraftForMessage(messageId);
  const value = String(path || "").trim();
  if (!value || draft.resources.some((item) => item.path === value)) return;
  const category = resourceCategories[options.category] ? options.category : inferClientResourceCategory(value);
  draft.resources.push({
    path: value,
    category,
    alreadyImported: Boolean(options.alreadyImported || isProjectResourcePath(value)),
  });
  renderFramingConversation();
  showToast(`${resourceLabel(category)} linked to edited message.`);
}

function addEditUploadFile(messageId, file, options = {}) {
  const draft = editAttachmentDraftForMessage(messageId);
  if (!file || (!file.name && !file.type)) return { accepted: false, error: false, message: "" };
  const fallbackExt = fileExtensionFromMime(file.type, extension(file.name) || ".bin");
  const generatedName = `pasted_image_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}${fallbackExt || ".bin"}`;
  const name = file.name || generatedName;
  const size = Number(file.size || 0);
  if (size > MAX_BROWSER_UPLOAD_BYTES) {
    const message = uploadTooLargeMessage(name, size);
    showToast(message, true);
    return { accepted: false, error: true, message };
  }
  const duplicate = draft.uploads.some((item) => item.name === name && item.size === file.size && item.lastModified === file.lastModified);
  if (duplicate) return { accepted: false, error: false, message: `${name} is already attached.` };
  const category = resourceCategories[options.category] ? options.category : "user_input";
  draft.uploads.push({
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    file,
    name,
    type: file.type || "",
    size,
    lastModified: file.lastModified || 0,
    category,
  });
  renderFramingConversation();
  return { accepted: true, error: false, message: `${name} attached.` };
}

function addEditFilesFromList(messageId, files, source = "file picker", options = {}) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return 0;
  const results = list.map((file) => addEditUploadFile(messageId, file, options));
  const accepted = results.filter((result) => result?.accepted).length;
  const errors = results.filter((result) => result?.error && result.message);
  if (accepted) showToast(`${accepted} ${accepted === 1 ? "file" : "files"} attached to edited message from ${source}.`);
  else if (errors.length === 1) showToast(errors[0].message, true);
  return accepted;
}

function messageAttachmentsHtml(message) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const attachmentHtml = attachments.length ? `<div class="message-attachments">${attachments.map(messageAttachmentChip).join("")}</div>` : "";
  return `${messageResumeContextHtml(message)}${attachmentHtml}`;
}

function renderAttachmentTrays() {
  const html = [
    resumeContextChipHtml(selectedResumeTrialContext),
    ...selectedResourceItems.map(linkToChip),
    ...selectedUploadItems.map(uploadToChip),
    ...activeResourceImportRecords().map(resourceImportToChip),
  ].filter(Boolean).join("");
  ["#brief-attachment-tray", "#chat-attachment-tray"].forEach((selector) => {
    const tray = $(selector);
    if (!tray) return;
    tray.innerHTML = html;
    tray.hidden = !html;
  });
  requestAnimationFrame(() => {
    updateBriefDockGeometry();
    updateFramingScrollButton();
  });
  updateResourceImportActionState();
}

function uploadTooLargeMessage(name, size) {
  return `${name} is ${formatBytes(size)}. Copy it into project resources before sending.`;
}

function queueLargeResourceImport(file, options = {}) {
  const fallbackExt = fileExtensionFromMime(file.type, extension(file.name) || ".bin");
  const generatedName = `large_resource_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}${fallbackExt || ".bin"}`;
  const name = file.name || generatedName;
  const size = Number(file.size || 0);
  const category = resourceCategories[options.category] ? options.category : activeResourceCategory || "ongoing_work";
  const duplicate = pendingResourceImports.some((item) => (
    !["done", "cancelled"].includes(item.status) &&
    item.name === name &&
    item.size === size &&
    item.lastModified === (file.lastModified || 0)
  ));
  if (duplicate) {
    renderAttachmentTrays();
    return { accepted: false, error: false, pendingImport: true, message: `${name} is already pending copy.` };
  }
  const record = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    file,
    name,
    type: file.type || "",
    size,
    lastModified: file.lastModified || 0,
    category,
    destination: resourceImportDestination(category),
    status: "pending_confirm",
    progress: 0,
    received: 0,
    importId: "",
    error: "",
    stale: false,
  };
  pendingResourceImports.push(record);
  savePendingResourceImports();
  renderAttachmentTrays();
  openLargeResourceImportDialog(record.id);
  return { accepted: false, error: false, pendingImport: true, message: uploadTooLargeMessage(name, size) };
}

function largeResourceImportById(id) {
  return pendingResourceImports.find((item) => item.id === id) || null;
}

function renderLargeResourceImportDialog(record) {
  const title = $("#large-import-title");
  const fileName = $("#large-import-file-name");
  const fileSize = $("#large-import-file-size");
  const category = $("#large-import-category");
  const destination = $("#large-import-destination");
  const note = $("#large-import-note");
  if (title) title.textContent = "Copy into resources?";
  if (fileName) fileName.textContent = record?.name || "";
  if (fileSize) fileSize.textContent = formatBytes(record?.size || 0);
  if (category) {
    category.innerHTML = Object.entries(resourceCategories)
      .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === record?.category ? "selected" : ""}>${escapeHtml(label)}</option>`)
      .join("");
    category.value = record?.category || "ongoing_work";
  }
  if (destination) destination.textContent = resourceImportDestination(record?.category || "ongoing_work");
  if (note) note.textContent = "Large browser files are copied in chunks. Sending is blocked until the copy finishes or is cancelled.";
}

function openLargeResourceImportDialog(id) {
  const record = largeResourceImportById(id);
  if (!record || record.status !== "pending_confirm") return;
  const dialog = $("#large-resource-import-dialog");
  if (!dialog) {
    showToast(uploadTooLargeMessage(record.name, record.size), true);
    return;
  }
  activeLargeResourceImportId = id;
  renderLargeResourceImportDialog(record);
  if (dialog.showModal && !dialog.open) dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeLargeResourceImportDialog() {
  const dialog = $("#large-resource-import-dialog");
  activeLargeResourceImportId = "";
  if (!dialog) return;
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
}

function removeResourceImportRecord(id) {
  const index = pendingResourceImports.findIndex((item) => item.id === id);
  if (index >= 0) pendingResourceImports.splice(index, 1);
  savePendingResourceImports();
  renderAttachmentTrays();
}

async function cancelLargeResourceImport(id, options = {}) {
  const record = largeResourceImportById(id);
  if (!record) return;
  record.cancelRequested = true;
  if (record.controller) record.controller.abort();
  if (record.importId) {
    try {
      await api("/api/resource-import/cancel", {
        method: "POST",
        body: JSON.stringify({ import_id: record.importId }),
      });
    } catch (error) {
      if (!options.silent) showToast(error.message, true);
    }
  }
  record.status = "cancelled";
  removeResourceImportRecord(id);
  if (activeLargeResourceImportId === id) closeLargeResourceImportDialog();
  if (!options.silent) showToast(`${record.name} copy cancelled.`);
  renderChatState();
  renderStage();
  renderProjectAvailability();
}

async function confirmLargeResourceImport(id, categoryOverride = "") {
  const record = largeResourceImportById(id);
  if (!record) return;
  if (categoryOverride && resourceCategories[categoryOverride]) {
    record.category = categoryOverride;
    record.destination = resourceImportDestination(categoryOverride);
  }
  if (!record.file || typeof record.file.slice !== "function") {
    record.status = "failed";
    record.error = "The browser no longer has access to this File. Cancel it and attach the file again.";
    record.stale = true;
    savePendingResourceImports();
    renderAttachmentTrays();
    return;
  }
  if (record.importId && record.status === "failed") {
    try {
      await api("/api/resource-import/cancel", {
        method: "POST",
        body: JSON.stringify({ import_id: record.importId }),
      });
    } catch {
      // Best-effort cleanup before retrying with a fresh staging file.
    }
    record.importId = "";
  }
  record.status = "copying";
  record.error = "";
  record.progress = 0;
  record.received = 0;
  record.cancelRequested = false;
  record.controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  savePendingResourceImports();
  renderAttachmentTrays();
  closeLargeResourceImportDialog();
  try {
    const start = await api("/api/resource-import/start", {
      method: "POST",
      body: JSON.stringify({
        name: record.name,
        size: record.size,
        type: record.type,
        category: record.category,
      }),
    });
    record.importId = start.import_id || start.result?.import_id || "";
    record.destination = start.destination || start.result?.destination || resourceImportDestination(record.category);
    const chunkSize = Number(start.chunk_size || start.result?.chunk_size || LARGE_RESOURCE_CHUNK_BYTES) || LARGE_RESOURCE_CHUNK_BYTES;
    savePendingResourceImports();
    let offset = 0;
    while (offset < record.size) {
      if (record.cancelRequested) throw new Error("Copy cancelled.");
      const end = Math.min(offset + chunkSize, record.size);
      const chunk = record.file.slice(offset, end);
      const body = await chunk.arrayBuffer();
      const response = await apiBinary(`/api/resource-import/chunk?import_id=${encodeURIComponent(record.importId)}&offset=${offset}`, body, {
        signal: record.controller?.signal,
      });
      offset = Number(response.received || response.result?.received || end);
      record.received = offset;
      record.progress = record.size ? offset / record.size : 0;
      savePendingResourceImports();
      renderAttachmentTrays();
    }
    record.status = "finalizing";
    savePendingResourceImports();
    renderAttachmentTrays();
    const finished = await api("/api/resource-import/finish", {
      method: "POST",
      body: JSON.stringify({ import_id: record.importId }),
    });
    const resource = finished.resource || finished.result?.resource || {
      path: finished.path || finished.result?.path || record.destination,
      category: record.category,
      alreadyImported: true,
    };
    addResourcePath(resource.path, {
      category: resource.category || record.category,
      alreadyImported: true,
      notify: false,
    });
    record.status = "done";
    removeResourceImportRecord(id);
    showToast(`${record.name} copied into ${resource.path}.`);
    renderChatState();
    renderStage();
    renderProjectAvailability();
  } catch (error) {
    if (record.cancelRequested || error.name === "AbortError") {
      await cancelLargeResourceImport(id, { silent: true });
      return;
    }
    record.status = "failed";
    record.error = error.message || "Copy failed.";
    savePendingResourceImports();
    renderAttachmentTrays();
    showToast(record.error, true);
  } finally {
    record.controller = null;
  }
}

function addUploadFile(file, options = {}) {
  const notify = options.notify !== false;
  if (!file || !file.name && !file.type) return { accepted: false, error: false, message: "" };
  const fallbackExt = fileExtensionFromMime(file.type, extension(file.name) || ".bin");
  const generatedName = `pasted_image_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}${fallbackExt || ".bin"}`;
  const name = file.name || generatedName;
  const size = Number(file.size || 0);
  if (size > MAX_BROWSER_UPLOAD_BYTES) {
    const result = queueLargeResourceImport(file, options);
    if (notify) showToast(result.message);
    return result;
  }
  const category = options.category || activeResourceCategory || "ongoing_work";
  const duplicate = selectedUploadItems.some((item) => item.name === name && item.size === file.size && item.lastModified === file.lastModified);
  if (duplicate) {
    renderSelectedResources();
    return { accepted: false, error: false, message: `${name} is already attached.` };
  }
  selectedUploadItems.push({
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    file,
    name,
    type: file.type || "",
    size,
    lastModified: file.lastModified || 0,
    category: resourceCategories[category] ? category : "ongoing_work",
  });
  renderSelectedResources();
  if (notify) showToast(`${name} attached.`);
  return { accepted: true, error: false, message: `${name} attached.` };
}

function removeUploadFile(id) {
  const index = selectedUploadItems.findIndex((item) => item.id === id);
  if (index >= 0) {
    selectedUploadItems.splice(index, 1);
    renderSelectedResources();
  }
}

function updateSelectedUploadCategory(index, category) {
  const item = selectedUploadItems[Number(index)];
  if (!item || !resourceCategories[category]) return;
  item.category = category;
  renderSelectedResources();
}

function hasDroppedDirectory(dataTransfer) {
  return Array.from(dataTransfer?.items || []).some((item) => {
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    return Boolean(entry?.isDirectory);
  });
}

function addFilesFromList(files, source = "file", options = {}) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return 0;
  const results = list.map((file) => addUploadFile(file, { ...options, notify: false }));
  const accepted = results.filter((result) => result?.accepted).length;
  const pending = results.filter((result) => result?.pendingImport).length;
  const errors = results.filter((result) => result?.error && result.message);
  if (accepted) {
    showToast(`${accepted} ${accepted === 1 ? "file" : "files"} attached from ${source}.`);
    if (pending) showToast(`${pending} large ${pending === 1 ? "file needs" : "files need"} resource-copy confirmation.`);
  } else if (pending) {
    showToast(`${pending} large ${pending === 1 ? "file needs" : "files need"} resource-copy confirmation.`);
  } else if (errors.length === 1) {
    showToast(errors[0].message, true);
  } else if (errors.length > 1) {
    showToast(`${errors.length} files were not attached. Use Browse resources and select local files or folders so CoAutoResearch can copy or symlink them.`, true);
  }
  return accepted;
}

function handleAttachmentPaste(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const files = items.map((item) => item.kind === "file" ? item.getAsFile() : null).filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  addFilesFromList(files, "clipboard");
}

function handleAttachmentDrop(event) {
  const hasFiles = Array.from(event.dataTransfer?.types || []).includes("Files");
  if (!hasFiles) return;
  event.preventDefault();
  document.body.classList.remove("is-dragging-file");
  if (hasDroppedDirectory(event.dataTransfer)) {
    showToast("Folder drag-and-drop cannot expose a stable local path. Use the file browser for folders so they can be symlinked.", true);
    showResourceBrowser();
    return;
  }
  addFilesFromList(event.dataTransfer.files, "drop");
}

function removeResourcePath(path) {
  const index = selectedResourceItems.findIndex((item) => item.path === path);
  if (index >= 0) {
    selectedResourceItems.splice(index, 1);
    saveResourceSelections();
    renderSelectedResources();
  }
}

function setResourceCategory(category) {
  if (!resourceCategories[category]) return;
  activeResourceCategory = category;
  $$("[data-resource-category]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.resourceCategory === category);
    button.setAttribute("aria-checked", button.dataset.resourceCategory === category ? "true" : "false");
  });
  const selectedType = $("#selected-material-type");
  if (selectedType) selectedType.textContent = `Material type: ${resourceLabel(activeResourceCategory)}`;
  const note = $("#browser-note");
  if (note) note.textContent = `Selected material will be attached as ${resourceLabel(activeResourceCategory)}. Folders are symlinked when possible; files are copied into this repo.`;
}

function isRemoteUi() {
  return Boolean(appState?.runtime?.remote);
}

function openComposerFilePicker(category = "user_input", editMessageId = "") {
  const input = $("#composer-file-input");
  if (!input) return;
  input.dataset.resourceCategory = resourceCategories[category] ? category : "user_input";
  if (editMessageId) input.dataset.editMessageId = String(editMessageId);
  else delete input.dataset.editMessageId;
  input.click();
}

function ensureAttachmentMenu() {
  let menu = $("#attachment-menu");
  const button = $("#composer-attach-button");
  if (menu) {
    if (menu.parentElement !== document.body) document.body.appendChild(menu);
    if (button) {
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-controls", "attachment-menu");
    }
    return menu;
  }
  if (!button) return null;
  menu = document.createElement("div");
  menu.className = "attachment-menu";
  menu.id = "attachment-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Attach resources");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" role="menuitem" data-attachment-action="upload-files">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4v10m0-10 4 4m-4-4-4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>
      <span>Upload files</span>
    </button>
    <button type="button" role="menuitem" data-attachment-action="link-folders">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h4.1c.7 0 1.3.3 1.8.8l1.1 1.2h4A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z"/></svg>
      <span>Link folders/files</span>
    </button>
  `;
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-controls", "attachment-menu");
  document.body.appendChild(menu);
  return menu;
}

function positionAttachmentMenu(menu = $("#attachment-menu"), button = $("#composer-attach-button")) {
  if (!menu || !button || menu.hidden || typeof button.getBoundingClientRect !== "function") return;
  const buttonRect = button.getBoundingClientRect();
  const composerRect = button.closest?.(".brief-composer-row")?.getBoundingClientRect?.() || null;
  const anchorTop = Math.min(buttonRect.top, Number.isFinite(composerRect?.top) ? composerRect.top : buttonRect.top);
  const anchorBottom = Math.max(buttonRect.bottom, Number.isFinite(composerRect?.bottom) ? composerRect.bottom : buttonRect.bottom);
  const menuWidth = Math.min(260, Math.max(220, window.innerWidth - 40));
  menu.style.width = `${menuWidth}px`;
  const menuHeight = menu.offsetHeight || 114;
  const left = Math.min(Math.max(20, buttonRect.left), Math.max(20, window.innerWidth - menuWidth - 20));
  let top = anchorTop - menuHeight - 10;
  if (top < 12) top = Math.min(window.innerHeight - menuHeight - 12, anchorBottom + 10);
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(12, top)}px`;
  menu.style.bottom = "auto";
}

function setAttachmentMenuOpen(open) {
  const menu = ensureAttachmentMenu();
  const button = $("#composer-attach-button");
  if (!menu) return;
  if (open) {
    menu.hidden = false;
    positionAttachmentMenu(menu, button);
  } else {
    menu.hidden = true;
  }
  if (button) button.setAttribute("aria-expanded", open ? "true" : "false");
}

function ensureUploadSourceMenu() {
  if (uploadSourceMenu) return uploadSourceMenu;
  const menu = document.createElement("div");
  menu.className = "attachment-menu upload-source-menu";
  menu.id = "upload-source-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Choose file source");
  menu.hidden = true;
  menu.innerHTML = `
    <button type="button" role="menuitem" data-upload-source="computer">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8A2.5 2.5 0 0 1 17.5 17h-11A2.5 2.5 0 0 1 4 14.5v-8ZM9 20h6m-3-3v3"/></svg>
      <span class="attachment-choice-copy"><strong>From this computer</strong><small>Upload browser-selected files to the remote project.</small></span>
    </button>
    <button type="button" role="menuitem" data-upload-source="server">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 6.5C5 5.1 8.1 4 12 4s7 1.1 7 2.5S15.9 9 12 9 5 7.9 5 6.5Zm0 0v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5M5 11.5v5C5 17.9 8.1 19 12 19s7-1.1 7-2.5v-5"/></svg>
      <span class="attachment-choice-copy"><strong>From server</strong><small>Select an existing file on the remote server.</small></span>
    </button>
  `;
  document.body.appendChild(menu);
  uploadSourceMenu = menu;
  return menu;
}

function positionUploadSourceMenu() {
  positionAttachmentMenu(ensureUploadSourceMenu(), uploadSourceMenuAnchor || $("#composer-attach-button"));
}

function setUploadSourceMenuOpen(open, anchor = null) {
  const menu = ensureUploadSourceMenu();
  if (!menu) return;
  uploadSourceMenuAnchor = open ? (anchor || $("#composer-attach-button")) : null;
  menu.hidden = !open;
  if (open) positionUploadSourceMenu();
}

function showUploadSourcePicker(options = {}) {
  pendingUploadSourceEditMessageId = String(options.editMessageId || "");
  setAttachmentMenuOpen(false);
  setUploadSourceMenuOpen(true, options.anchor || null);
}

function closeUploadSourcePicker() {
  pendingUploadSourceEditMessageId = "";
  setUploadSourceMenuOpen(false);
}

function handleUploadSourceChoice(source) {
  const editMessageId = pendingUploadSourceEditMessageId;
  setUploadSourceMenuOpen(false);
  pendingUploadSourceEditMessageId = "";
  if (source === "computer") {
    openComposerFilePicker("user_input", editMessageId);
    return;
  }
  if (source === "server") {
    setResourceCategory("user_input");
    showResourceBrowser({ mode: "server-file", editMessageId });
  }
}

function toggleAttachmentMenu() {
  const menu = ensureAttachmentMenu();
  closeUploadSourcePicker();
  setAttachmentMenuOpen(Boolean(menu?.hidden));
}

window.addEventListener("resize", () => {
  positionAttachmentMenu();
  positionUploadSourceMenu();
});
window.addEventListener("scroll", () => {
  positionAttachmentMenu();
  positionUploadSourceMenu();
}, true);

function handleAttachmentMenuAction(action) {
  setAttachmentMenuOpen(false);
  if (action === "upload-files") {
    if (isRemoteUi()) {
      showUploadSourcePicker();
      return;
    }
    openComposerFilePicker("user_input");
    return;
  }
  if (action === "link-folders") {
    setResourceCategory("ongoing_work");
    showResourceBrowser();
  }
}

function updateSelectedResourceCategory(index, category) {
  const item = selectedResourceItems[Number(index)];
  if (!item || !resourceCategories[category]) return;
  item.category = category;
  saveResourceSelections();
  renderSelectedResources();
}

function showResourceBrowser(options = {}) {
  activeEditResourceTargetId = String(options.editMessageId || "");
  browserSelectionMode = options.mode === "server-file" ? "server-file" : "default";
  const dialog = $("#resource-browser");
  if (!dialog) return;
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
  loadLocalBrowser(localBrowserPath);
}

function closeResourceBrowser() {
  const dialog = $("#resource-browser");
  activeEditResourceTargetId = "";
  browserSelectionMode = "default";
  if (!dialog) return;
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
}

function renderBrowserRoots(roots) {
  const target = $("#browser-roots");
  target.innerHTML = (roots || [])
    .map((root) => `<button class="root-chip" type="button" data-browser-root="${escapeHtml(root.path)}">${escapeHtml(root.label)}</button>`)
    .join("");
}

function renderBrowserEntries(payload) {
  localBrowserPayload = payload;
  const serverFileMode = browserSelectionMode === "server-file";
  const eyebrow = document.querySelector(".local-browser-head .eyebrow");
  if (eyebrow) eyebrow.textContent = serverFileMode ? "Server files" : "Local browser";
  const title = $("#resource-browser-title");
  if (title) title.textContent = serverFileMode ? "Choose a server file." : "Choose files or folders.";
  renderBrowserRoots(payload.roots || []);
  localBrowserPath = payload.path || "";
  $("#browser-current-path").textContent = localBrowserPath;
  $("#browser-up").disabled = !payload.parent;
  $("#browser-up").dataset.browserParent = payload.parent || "";
  const addCurrent = $("#browser-add-current");
  if (addCurrent) {
    addCurrent.hidden = serverFileMode;
    addCurrent.disabled = serverFileMode;
    addCurrent.dataset.resourceAddPath = serverFileMode ? "" : localBrowserPath;
  }
  $("#browser-note").textContent = serverFileMode
    ? (payload.truncated
      ? "Showing the first server files in this folder. Choose a more specific folder if needed."
      : "Choose a file that already exists on the server. Folders can be opened here but only files can be attached from Upload files.")
    : (payload.truncated
      ? "Showing the first files in this folder. Choose a more specific folder if needed."
      : `Selected material will be attached as ${resourceLabel(activeResourceCategory)}. Folders are symlinked when possible; files are copied into this repo.`);

  const query = browserSearchQuery.trim().toLowerCase();
  const entries = (payload.entries || []).filter((entry) => {
    if (!query) return true;
    return String(entry.name || "").toLowerCase().includes(query) || String(entry.path || "").toLowerCase().includes(query);
  });
  if (!entries.length) {
    $("#browser-entries").innerHTML = `<div class="tree-empty">${query ? "No files match this search." : "This folder is empty or cannot be read."}</div>`;
    return;
  }

  $("#browser-entries").innerHTML = entries
    .map((entry) => {
      const isDir = entry.type === "directory";
      const useButton = serverFileMode && isDir
        ? ""
        : `<button class="mini-button" type="button" data-resource-add-path="${escapeHtml(entry.path)}">Use</button>`;
      return `
        <div class="browser-entry-row">
          <button class="browser-entry-main" type="button" data-browser-open="${escapeHtml(entry.path)}" data-browser-type="${escapeHtml(entry.type)}">
            <span class="browser-entry-icon" aria-hidden="true">${isDir ? "DIR" : "FILE"}</span>
            <span>
              <strong>${escapeHtml(entry.name)}</strong>
              <small>${escapeHtml(entry.path)}</small>
            </span>
          </button>
          ${useButton}
        </div>
      `;
    })
    .join("");
}

function cleanBrowserPathInput(value) {
  let text = String(value || "").trim();
  const pairs = {
    "`": "`",
    '"': '"',
    "'": "'",
    "“": "”",
    "‘": "’",
    "<": ">",
  };
  let changed = true;
  while (changed && text.length >= 2) {
    changed = false;
    const first = text[0];
    const last = text[text.length - 1];
    if (pairs[first] === last) {
      text = text.slice(1, -1).trim();
      changed = true;
    }
  }
  return text;
}

function isBrowserPathInput(value) {
  const text = cleanBrowserPathInput(value);
  if (!text) return false;
  if (/^file:\/\//i.test(text)) return true;
  if (/^[A-Za-z]:(?:[\\/].*)?$/.test(text)) return true;
  if (/^[\\/]{2}\?[\\/]/.test(text)) return true;
  if (/^\\\\[^\\]+\\[^\\]+/.test(text)) return true;
  if (/^\/\/[^/?#]+\/[^/?#]+/.test(text)) return true;
  if (/^(?:~|\.{1,2})(?:[\\/]|$)/.test(text)) return true;
  if (/^\//.test(text)) return true;
  return false;
}

function handleBrowserSearchInput(value) {
  browserSearchQuery = value || "";
  clearTimeout(browserSearchTimer);
  if (isBrowserPathInput(browserSearchQuery)) return;
  browserSearchTimer = setTimeout(() => loadLocalBrowser(localBrowserPath, { keepSearch: true }), 180);
}

async function loadLocalBrowser(path = "", options = {}) {
  const { keepSearch = false } = options;
  const entries = $("#browser-entries");
  entries.innerHTML = `<div class="tree-empty">${browserSelectionMode === "server-file" ? "Loading server files..." : "Loading local files..."}</div>`;
  try {
    const params = new URLSearchParams({ path: path || "" });
    if (keepSearch && browserSearchQuery.trim()) params.set("q", browserSearchQuery.trim());
    const payload = await api(`/api/local/browse?${params.toString()}`);
    if (!keepSearch) {
      browserSearchQuery = "";
      const search = $("#browser-search");
      if (search) search.value = "";
    }
    renderBrowserEntries(payload);
  } catch (error) {
    entries.innerHTML = `<div class="tree-empty">${escapeHtml(error.message)}</div>`;
    showToast(error.message, true);
  }
}

async function jumpLocalBrowserInput() {
  const search = $("#browser-search");
  const value = cleanBrowserPathInput(search?.value || browserSearchQuery);
  if (!value) return;
  clearTimeout(browserSearchTimer);
  if (isBrowserPathInput(value)) {
    await loadLocalBrowser(value, { keepSearch: false });
    return;
  }
  browserSearchQuery = value;
  if (search) search.value = value;
  await loadLocalBrowser(localBrowserPath, { keepSearch: true });
}

function defaultInlineMode(payload) {
  const kind = payload.kind || (extension(payload.path) === ".md" ? "markdown" : "text");
  if (kind === "markdown") return "rendered";
  if (["json", "jsonl", "yaml", "xml"].includes(kind)) return "preview";
  if (kind === "image" || kind === "pdf") return "preview";
  return "source";
}

function inlineViewModes(payload) {
  const kind = payload.kind || "text";
  if (kind === "markdown") {
    return [
      ["rendered", "Rendered"],
      ["source", "Source"],
    ];
  }
  if (["json", "jsonl", "yaml", "xml"].includes(kind)) {
    return [
      ["preview", "Preview"],
      ["source", "Source"],
    ];
  }
  return [];
}

function structuredText(text, kind) {
  const value = String(text || "");
  if (kind === "json") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  if (kind === "jsonl") {
    return value
      .split(/\r?\n/)
      .map((line) => {
        if (!line.trim()) return "";
        try {
          return JSON.stringify(JSON.parse(line), null, 2);
        } catch {
          return line;
        }
      })
      .join("\n");
  }
  return value;
}

function inlineModeSwitchHtml(path, payload, mode) {
  const modes = inlineViewModes(payload);
  if (!modes.length) return "";
  return `
    <div class="inline-view-switch" role="tablist" aria-label="File view mode">
      ${modes
        .map(
          ([value, label]) => `
          <button class="${mode === value ? "is-active" : ""}" type="button" data-inline-mode="${escapeHtml(value)}" data-inline-path="${escapeHtml(path)}">${escapeHtml(label)}</button>
        `
        )
        .join("")}
    </div>
  `;
}

function fullscreenButtonHtml(path) {
  if (!path) return "";
  return `
    <button class="icon-button inline-fullscreen-button" type="button" data-inline-fullscreen="${escapeHtml(path)}" aria-label="Open fullscreen preview">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M9 4H4v5M4 4l6.5 6.5M15 4h5v5M20 4l-6.5 6.5M9 20H4v-5M4 20l6.5-6.5M15 20h5v-5M20 20l-6.5-6.5"/>
      </svg>
    </button>
  `;
}

function inlineFileBodyHtml(payload, mode) {
  const path = payload.path || "";
  const text = payload.text || "";
  const kind = payload.kind || "text";
  const mime = payload.mime || "";
  const url = payload.url || rawFileUrl(path);
  if (kind === "image") {
    return `
      <figure class="file-media-frame">
        <img class="file-media-preview" src="${escapeHtml(url)}" alt="${escapeHtml(path)}" loading="lazy">
        <figcaption>${escapeHtml(mime || shortFileType(path))}</figcaption>
      </figure>
    `;
  }
  if (kind === "pdf") {
    return `<iframe class="file-pdf-preview" src="${escapeHtml(url)}" title="${escapeHtml(path)}"></iframe>`;
  }
  if (kind === "markdown" && mode === "rendered") {
    return `<div class="markdown-preview inline-preview">${markdownToHtml(text, { basePath: path })}</div>`;
  }
  if (["json", "jsonl", "yaml", "xml"].includes(kind) && mode === "preview") {
    return `<pre class="file-code-preview"><code>${escapeHtml(structuredText(text, kind))}</code></pre>`;
  }
  if (payload.editable) {
    return `<textarea class="inline-editor" data-inline-editor="${escapeHtml(path)}" spellcheck="false">${escapeHtml(text)}</textarea>`;
  }
  return `<pre class="file-code-preview"><code>${escapeHtml(text || "No preview available.")}</code></pre>`;
}

function inlineEditorHtml(payload, compact = false) {
  const path = payload.path || "";
  const mode = inlineFileModes[path] || defaultInlineMode(payload);
  inlineFileModes[path] = mode;
  const editableInSource = payload.editable && mode === "source";
  return `
    <div class="inline-editor-shell ${compact ? "is-compact" : ""}">
      <div class="inline-editor-head">
        <span>${escapeHtml(path)}</span>
        <div class="inline-editor-actions">
          ${inlineModeSwitchHtml(path, payload, mode)}
          ${editableInSource ? `<button class="secondary-button small-button" type="button" data-inline-save="${escapeHtml(path)}">Save & notify</button>` : ""}
          ${fullscreenButtonHtml(path)}
        </div>
      </div>
      <div class="inline-editor-grid">
        ${inlineFileBodyHtml(payload, mode)}
      </div>
    </div>
  `;
}

function isLatestManuscriptPath(path) {
  return repoRelativePath(path) === LATEST_MANUSCRIPT_PATH;
}

function blueprintAnchorForTitle(title) {
  return markdownHeadingId(cleanText(title, "section"));
}

function blueprintArtifactFallbackPath(block) {
  return firstArtifactPath([
    manuscriptFieldValue(block, ["Source artifact or spec path", "Source artifact path", "Source code or artifact links", "Source artifact", "Provenance links", "Source links"]),
    block.body,
  ].filter(Boolean).join("\n"));
}

function blueprintSidebarItemHtml(item) {
  const label = cleanText(item.label, "Untitled");
  const meta = cleanText(item.meta, "");
  const eyebrow = cleanText(item.eyebrow, "");
  const depth = Math.max(1, Math.min(6, Number(item.depth || 1)));
  const classes = ["blueprint-sidebar-item", `depth-${depth}`, item.kind ? `kind-${item.kind}` : "", item.disabled ? "is-disabled" : ""].filter(Boolean).join(" ");
  const content = `
      ${eyebrow ? `<span class="blueprint-sidebar-eyebrow">${escapeHtml(eyebrow)}</span>` : ""}
      <span class="blueprint-sidebar-label">${escapeHtml(label)}</span>
      ${meta ? `<span class="blueprint-sidebar-meta">${escapeHtml(meta)}</span>` : ""}
  `;
  if (item.anchor) {
    return `
      <button class="${classes}" type="button" data-blueprint-anchor="${escapeHtml(item.anchor)}"${item.fallbackPath ? ` data-blueprint-fallback="${escapeHtml(item.fallbackPath)}"` : ""}>
        ${content}
      </button>
    `;
  }
  if (item.path) {
    return `
      <button class="${classes}" type="button" data-inline-fullscreen="${escapeHtml(item.path)}">
        ${content}
      </button>
    `;
  }
  return `
    <button class="${classes}" type="button" disabled>
      ${content}
    </button>
  `;
}

function blueprintSidebarSectionHtml(title, items, emptyText) {
  const rows = (items || []).filter(Boolean);
  const count = rows.length;
  return `
    <details class="blueprint-sidebar-section">
      <summary>
        <span>${escapeHtml(title)}</span>
        <small>${escapeHtml(String(count))}</small>
      </summary>
      <div class="blueprint-sidebar-list">
        ${rows.length ? rows.join("") : `<p class="blueprint-sidebar-empty">${escapeHtml(emptyText)}</p>`}
      </div>
    </details>
  `;
}

function blueprintTocItemsFromMarkdown(toc) {
  return String(toc || "")
    .split(/\r?\n/)
    .map((line) => {
      const text = line.trim();
      if (!text) return null;
      const heading = text.match(/^(#{1,6})\s+(.+)$/);
      const bullet = text.match(/^[-*]\s+(.+)$/);
      const body = heading ? heading[2] : bullet ? bullet[1] : text;
      const link = body.match(/\[([^\]\n]+)\]\(#([^)]+)\)/);
      const label = link ? link[1] : body.replace(/^\d+(?:\.\d+)*\.?\s+/, "").replaceAll(/[`*_]/g, "");
      const anchor = link ? link[2] : blueprintAnchorForTitle(label);
      return blueprintSidebarItemHtml({
        label,
        anchor,
        depth: heading ? heading[1].length : Math.max(1, Math.floor((line.length - line.trimStart().length) / 2) + 1),
        kind: "outline",
      });
    })
    .filter(Boolean);
}

function blueprintHeadingRowsFromText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const heading = line.trimEnd().match(/^(#{1,6})\s+(.+)$/);
      if (!heading) return null;
      const title = heading[2].trim();
      return {
        title,
        level: heading[1].length,
        anchor: blueprintAnchorForTitle(title),
      };
    })
    .filter(Boolean);
}

function blueprintTextArtifactKind(title) {
  const match = String(title || "").trim().match(/^(Figure|Table|Algorithm|Method|Dataset|Benchmark|Result)\b/i);
  return match ? match[1].toLowerCase() : "";
}

function blueprintOutlineItems(manuscript, sourceText = "") {
  const blocks = (manuscript.architecture || manuscript.sections || [])
    .filter(sectionHasRealContent)
    .filter((block) => !block.is_artifact);
  if (blocks.length) {
    return blocks.map((block) => blueprintSidebarItemHtml({
      label: cleanText(block.title, "Untitled section"),
      meta: block.path && block.path !== block.title ? block.path : "",
      anchor: blueprintAnchorForTitle(block.title),
      depth: block.level || 1,
      kind: "outline",
    }));
  }
  const tocItems = blueprintTocItemsFromMarkdown(manuscript.toc);
  if (tocItems.length) return tocItems;
  return blueprintHeadingRowsFromText(sourceText)
    .filter((row) => !blueprintTextArtifactKind(row.title))
    .map((row) => blueprintSidebarItemHtml({
      label: row.title,
      anchor: row.anchor,
      depth: row.level,
      kind: "outline",
    }));
}

function blueprintArtifactItems(manuscript, kinds, sourceText = "") {
  const allowed = new Set(kinds);
  const blocks = [
    ...(manuscript.inline_artifacts || []),
    ...(manuscript.architecture || []).filter((block) => block.is_artifact),
  ].filter((block, index, all) => {
    const kind = String(block.kind || "").toLowerCase();
    const key = `${kind}:${cleanText(block.title, "")}:${cleanText(block.path, "")}`;
    return allowed.has(kind) && all.findIndex((candidate) => {
      const candidateKind = String(candidate.kind || "").toLowerCase();
      const candidateKey = `${candidateKind}:${cleanText(candidate.title, "")}:${cleanText(candidate.path, "")}`;
      return candidateKey === key;
    }) === index;
  });
  if (blocks.length) return blocks.map((block) => {
    const kind = String(block.kind || "artifact").toLowerCase();
    const status = manuscriptFieldValue(block, ["Inclusion status", "Status"]);
    const placement = manuscriptFieldValue(block, ["Placement"]);
    const fallbackPath = blueprintArtifactFallbackPath(block);
    const meta = [status ? figureSpecExcerpt(status, 80) : "", placement ? figureSpecExcerpt(placement, 100) : ""].filter(Boolean).join(" · ");
    return blueprintSidebarItemHtml({
      label: cleanText(block.title, `${artifactKindLabel(kind)} block`),
      meta,
      eyebrow: artifactKindLabel(kind),
      anchor: blueprintAnchorForTitle(block.title),
      fallbackPath,
      depth: block.level || 4,
      kind,
    });
  });
  return blueprintHeadingRowsFromText(sourceText)
    .map((row) => ({ ...row, kind: blueprintTextArtifactKind(row.title) }))
    .filter((row) => allowed.has(row.kind))
    .map((row) => blueprintSidebarItemHtml({
      label: row.title,
      meta: "From BLUEPRINT.md",
      eyebrow: artifactKindLabel(row.kind),
      anchor: row.anchor,
      depth: row.level,
      kind: row.kind,
    }));
}

function blueprintTableItems(manuscript, sourceText = "") {
  const tables = blueprintArtifactItems(manuscript, ["table"], sourceText);
  if (tables.length) return tables;
  const rationale = cleanText(manuscript.no_table_rationale, "");
  if (!rationale) return [];
  return [blueprintSidebarItemHtml({
    label: "No active table",
    meta: figureSpecExcerpt(rationale, 150),
    kind: "table",
    disabled: true,
  })];
}

function blueprintReferenceItems(manuscript) {
  return (manuscript.references || [])
    .filter((ref) => hasRealText(ref?.reference) || hasRealText(ref?.key))
    .map((ref) => {
      const yearMatch = String(ref.reference || "").match(/\b(?:19|20)\d{2}\b/);
      return blueprintSidebarItemHtml({
        label: cleanText(ref.key, "") || figureSpecExcerpt(cleanText(ref.reference, ""), 40),
        meta: figureSpecExcerpt(cleanText(ref.reference, ""), 80),
        eyebrow: yearMatch ? yearMatch[0] : "",
        anchor: "manuscript-references",
        kind: "reference",
      });
    });
}

function blueprintAppendixItems(manuscript) {
  const items = [];
  if (hasRealText(manuscript?.appendix_plan)) {
    items.push(blueprintSidebarItemHtml({
      label: "Appendix / supplement plan",
      meta: figureSpecExcerpt(manuscript.appendix_plan, 110),
      anchor: "manuscript-appendix",
      kind: "appendix",
    }));
  }
  for (const file of manuscript?.appendix_files || []) {
    const path = repoRelativePath(file.path || "");
    items.push(blueprintSidebarItemHtml({
      label: cleanText(file.title, basename(path || "Appendix file")),
      meta: figureSpecExcerpt(cleanText(file.summary, "") || path, 110),
      eyebrow: "Appendix file",
      path,
      kind: "appendix",
    }));
  }
  return items;
}

function latestBlueprintReviewSelection(reviews) {
  const visible = (reviews || []).filter(hasVisibleReview);
  const numbered = visible
    .map((review) => ({ review, number: reviewTrialNumber(reviewTrialId(review)) }))
    .filter((entry) => Number.isFinite(entry.number));
  const activeIteration = activeRunTrialIteration();
  let trialNumber = 0;
  if (activeIteration && numbered.some((entry) => entry.number === activeIteration)) {
    trialNumber = activeIteration;
  } else if (numbered.length) {
    trialNumber = Math.max(...numbered.map((entry) => entry.number));
  } else if (activeIteration) {
    trialNumber = activeIteration;
  }
  return {
    trialNumber,
    reviews: trialNumber ? numbered.filter((entry) => entry.number === trialNumber).map((entry) => entry.review) : [],
    emptyText: trialNumber ? `No saved reviews for Trial ${trialNumber} yet.` : "No saved reviewer files yet.",
  };
}

function blueprintReviewItems(reviews) {
  return (reviews || [])
    .filter(hasVisibleReview)
    .sort((a, b) => reviewSortKey(a).localeCompare(reviewSortKey(b)))
    .map((review) => {
      const path = repoRelativePath(review.path || "");
      const reviewer = cleanText(review.reviewer, "") || basename(path || review.name || "Review").replace(/_REVIEW\.md$/i, "").replaceAll("_", " ");
      const decision = reviewDecision(review);
      const trial = reviewReadableTrial(reviewTrialId(review));
      return blueprintSidebarItemHtml({
        label: reviewer,
        meta: [decision, trial].filter(Boolean).join(" · "),
        eyebrow: basename(path || review.name || "Review"),
        path,
        kind: "review",
      });
    });
}

function blueprintSidebarHtml(manuscript, reviews, sourceText = "") {
  const reviewSelection = latestBlueprintReviewSelection(reviews);
  return `
    <aside class="blueprint-inspector-sidebar" aria-label="Blueprint inspector">
      <div class="blueprint-sidebar-heading">
        <p class="eyebrow">Blueprint inspector</p>
        <h2>Current manuscript</h2>
      </div>
      ${blueprintSidebarSectionHtml("Outline", blueprintOutlineItems(manuscript, sourceText), "No manuscript outline parsed yet.")}
      ${blueprintSidebarSectionHtml("Figures", blueprintArtifactItems(manuscript, ["figure"], sourceText), "No inline figures parsed yet.")}
      ${blueprintSidebarSectionHtml("Tables", blueprintTableItems(manuscript, sourceText), "No inline tables parsed yet.")}
      ${blueprintSidebarSectionHtml("Results / Methods", blueprintArtifactItems(manuscript, ["result", "algorithm", "dataset", "benchmark", "method"], sourceText), "No result or method blocks parsed yet.")}
      ${blueprintSidebarSectionHtml("Appendix", blueprintAppendixItems(manuscript), "No appendix or supplement parsed yet.")}
      ${blueprintSidebarSectionHtml("References", blueprintReferenceItems(manuscript), "No references parsed yet.")}
      ${blueprintSidebarSectionHtml("Reviews", blueprintReviewItems(reviewSelection.reviews), reviewSelection.emptyText)}
    </aside>
  `;
}

function blueprintStructuredBodyHtml(manuscript) {
  const blocks = manuscriptArchitectureBlocks(manuscript);
  const hasStructuredBlueprint = blocks.length || hasRealText(manuscript.toc) || hasRealText(manuscript.provenance || manuscript.traceability);
  if (!hasStructuredBlueprint) return "";
  return `
    <div class="inline-preview blueprint-rendered blueprint-structured-preview">
      <section class="blueprint-render-section">
        <h3>Manuscript story map</h3>
        ${renderManuscriptArchitecture(manuscript)}
      </section>
      <section class="blueprint-render-section">
        <h3>Appendix / supplement</h3>
        ${renderManuscriptAppendixPanel(manuscript)}
      </section>
      ${(manuscript.references || []).length ? `
      <section class="blueprint-render-section">
        <h3>References</h3>
        ${renderManuscriptReferences(manuscript)}
      </section>` : ""}
      <section class="blueprint-render-section">
        <h3>Audit / provenance</h3>
        ${renderManuscriptAuditPanel(manuscript)}
      </section>
    </div>
  `;
}

function renderBlueprintInspector(payload) {
  const manuscript = appState.summaries?.manuscript || {};
  const reviews = appState.reviews || [];
  const path = payload.path || LATEST_MANUSCRIPT_PATH;
  const mode = inlineFileModes[path] || defaultInlineMode(payload);
  inlineFileModes[path] = mode;
  const editableInSource = payload.editable && mode === "source";
  const renderedBody = payload.kind === "markdown" && mode === "rendered"
    ? blueprintStructuredBodyHtml(manuscript) || `<div class="markdown-preview inline-preview blueprint-rendered">${markdownToHtml(payload.text || "", { headingAnchors: true, basePath: path })}</div>`
    : inlineFileBodyHtml(payload, mode);
  return `
    <div class="blueprint-inspector">
      ${blueprintSidebarHtml(manuscript, reviews, payload.text || "")}
      <section class="inline-editor-shell blueprint-inspector-main" aria-label="Rendered blueprint">
        <div class="inline-editor-head">
          <span>${escapeHtml(path)}</span>
          <div class="inline-editor-actions">
            ${inlineModeSwitchHtml(path, payload, mode)}
            ${editableInSource ? `<button class="secondary-button small-button" type="button" data-inline-save="${escapeHtml(path)}">Save & notify</button>` : ""}
          </div>
        </div>
        <div class="inline-editor-grid">
          ${renderedBody}
        </div>
      </section>
    </div>
  `;
}

async function loadInlineFile(path, container, compact = false) {
  try {
    let payload = await api(`/api/file?path=${encodeURIComponent(path)}`);
    let resolvedPath = path;
    if (payload?.exists && payload?.is_dir) {
      const dirPath = path.replace(/\/+$/, "");
      for (const name of ["REPORT.md", "README.md", "INDEX.md", "PLAN.md"]) {
        const candidatePath = `${dirPath}/${name}`;
        try {
          const subPayload = await api(`/api/file?path=${encodeURIComponent(candidatePath)}`);
          if (subPayload?.exists && !subPayload?.is_dir) {
            payload = subPayload;
            resolvedPath = candidatePath;
            break;
          }
        } catch (_) {
          // Try next candidate.
        }
      }
    }
    if (!payload.exists || payload.is_dir) {
      const friendly = payload?.is_dir
        ? `${path} is a folder — open it from Project files.`
        : (payload.error || "File not found.");
      container.innerHTML = `<div class="tree-empty">${escapeHtml(friendly)}</div>`;
      return;
    }
    inlineFiles[payload.path || resolvedPath] = payload.text || "";
    inlineFilePayloads[payload.path || resolvedPath] = payload;
    container.dataset.compactInline = compact ? "true" : "false";
    container.innerHTML = inlineEditorHtml(payload, compact);
  } catch (error) {
    showToast(error.message, true);
  }
}

function setInlineFileMode(path, mode) {
  const payload = inlineFilePayloads[path];
  if (!payload) return;
  inlineFileModes[path] = mode;
  document.querySelectorAll(`[data-inline-file="${CSS.escape(path)}"], [data-inline-fullscreen-file="${CSS.escape(path)}"]`).forEach((container) => {
    const fullscreen = container.dataset.inlineFullscreenFile === path;
    container.innerHTML = fullscreen && isLatestManuscriptPath(path)
      ? renderBlueprintInspector(payload)
      : inlineEditorHtml(payload, container.dataset.compactInline === "true");
  });
}

async function saveInlineFile(path, root = document) {
  const scopedEditor = root?.querySelector?.(`[data-inline-editor="${CSS.escape(path)}"]`);
  const editor = scopedEditor || document.querySelector(`[data-inline-editor="${CSS.escape(path)}"]`);
  if (!editor) return;
  const saveButton = root?.querySelector?.(`[data-inline-save="${CSS.escape(path)}"]`) || document.querySelector(`[data-inline-save="${CSS.escape(path)}"]`);
  try {
    await withButtonFeedback(saveButton, async () => {
      const payload = await api("/api/file/save", {
        method: "POST",
        body: JSON.stringify({ path, text: editor.value }),
      });
      const file = payload.file || {};
      inlineFiles[file.path || path] = file.text || editor.value || "";
      inlineFilePayloads[file.path || path] = file;
    showToast("File saved and noted for the agent.");
      await loadOverview(true);
    }, { saved: "Saved & noted" });
  } catch (error) {
    showToast(error.message, true);
  }
}

function codexFigureImageSettingsPayload() {
  const backend = effectiveBackend(currentLaunchBackend());
  return {
    agent: { backend },
    codex: stripBackendSetting(normalizeSessionSettings({
      ...(uiSettings?.codex || defaultCodexSessionSettings),
      backend: "codex",
    })),
  };
}

function rememberFigureImageJob(job) {
  if (!job?.title) return;
  figureImageJobs.set(figureImageJobKey(job.title), job);
}

async function pollFigureImageJob(jobId, title) {
  const key = figureImageJobKey(title);
  const existing = figureImagePollTimers.get(key);
  if (existing) clearTimeout(existing);
  try {
    const payload = await api(`/api/manuscript/figure-image/status?id=${encodeURIComponent(jobId)}`);
    const job = payload.job || payload;
    rememberFigureImageJob(job);
    if (job.status === "succeeded") {
      figureImagePollTimers.delete(key);
      showToast(`Generated ${job.output_path || "figure image"}.`);
      await loadOverview(true);
      if (activePanel === "manuscript") renderContext();
      return;
    }
    if (job.status === "failed") {
      figureImagePollTimers.delete(key);
      showToast(job.error || "Image generation failed.", true);
      if (activePanel === "manuscript") renderContext();
      return;
    }
    const timer = setTimeout(() => {
      pollFigureImageJob(jobId, title).catch((error) => {
        figureImagePollTimers.delete(key);
        showToast(error.message, true);
      });
    }, 1500);
    figureImagePollTimers.set(key, timer);
  } catch (error) {
    figureImagePollTimers.delete(key);
    showToast(error.message, true);
  }
}

async function startFigureImageGeneration(candidate, options = {}) {
  if (!candidate) return;
  if (!figureImageGenerationAvailable()) return;
  const title = cleanText(candidate.title, "");
  const description = cleanText(candidate.description, "");
  const sourcePath = repoRelativePath(candidate.sourcePath || "");
  if (!title || !description) {
    showToast("Figure title and description are required.", true);
    return;
  }
  if (options.automatic) figureImageAutoStarted.add(figureImageAutoKey(title, sourcePath));
  rememberFigureImageJob({ id: "", title, status: "pending", output_path: "", error: "" });
  if (!options.suppressPendingRender && activePanel === "manuscript") renderContext();
  try {
    const payload = await api("/api/manuscript/figure-image/start", {
      method: "POST",
      body: JSON.stringify({
        title,
        description,
        sourcePath,
        settings: codexFigureImageSettingsPayload(),
      }),
    });
    const job = payload.job || payload;
    rememberFigureImageJob(job);
    if (activePanel === "manuscript") renderContext();
    await pollFigureImageJob(job.id, title);
  } catch (error) {
    rememberFigureImageJob({ id: "", title, status: "failed", output_path: "", error: error.message });
    if (activePanel === "manuscript") renderContext();
    showToast(error.message, true);
  }
}

function clampSettingsDialogSize(width, height) {
  const maxWidth = Math.max(360, Number(window.innerWidth || 0) - 70);
  const maxHeight = Math.max(320, Number(window.innerHeight || 0) - 70);
  const minWidth = Math.min(760, maxWidth);
  const minHeight = Math.min(520, maxHeight);
  return {
    width: Math.min(maxWidth, Math.max(minWidth, Math.round(Number(width) || maxWidth))),
    height: Math.min(maxHeight, Math.max(minHeight, Math.round(Number(height) || maxHeight))),
  };
}

function storedSettingsDialogSize() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_DIALOG_SIZE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return null;
    const width = Number(parsed.width || 0);
    const height = Number(parsed.height || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return clampSettingsDialogSize(width, height);
  } catch (error) {
    return null;
  }
}

function applySettingsDialogSize(dialog = $("#settings-dialog")) {
  if (!dialog) return;
  const size = storedSettingsDialogSize();
  if (!size) {
    dialog.style.removeProperty("width");
    dialog.style.removeProperty("height");
    return;
  }
  dialog.style.width = `${size.width}px`;
  dialog.style.height = `${size.height}px`;
}

function persistSettingsDialogSize(dialog = $("#settings-dialog")) {
  if (!dialog) return;
  const rect = dialog.getBoundingClientRect();
  const size = clampSettingsDialogSize(rect.width, rect.height);
  localStorage.setItem(SETTINGS_DIALOG_SIZE_KEY, JSON.stringify(size));
}

function startSettingsDialogResize(event) {
  const handle = event.target?.closest?.("[data-settings-resize]");
  if (!handle) return;
  const dialog = $("#settings-dialog");
  if (!dialog) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = dialog.getBoundingClientRect();
  settingsResizeState = {
    handle,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    width: rect.width,
    height: rect.height,
  };
  handle.setPointerCapture?.(event.pointerId);
  document.body.classList.add("is-resizing-settings-dialog");
}

function updateSettingsDialogResize(event) {
  if (!settingsResizeState) return;
  event.preventDefault();
  const dialog = $("#settings-dialog");
  if (!dialog) return;
  const deltaX = event.clientX - settingsResizeState.startX;
  const deltaY = event.clientY - settingsResizeState.startY;
  const size = clampSettingsDialogSize(settingsResizeState.width + deltaX, settingsResizeState.height + deltaY);
  dialog.style.width = `${size.width}px`;
  dialog.style.height = `${size.height}px`;
}

function finishSettingsDialogResize(event) {
  if (!settingsResizeState) return;
  const dialog = $("#settings-dialog");
  const handle = settingsResizeState.handle || event?.target?.closest?.("[data-settings-resize]") || document.querySelector("[data-settings-resize]");
  try {
    handle?.releasePointerCapture?.(settingsResizeState.pointerId);
  } catch (error) {
    // Pointer capture may already be gone if the drag ended outside the dialog.
  }
  settingsResizeState = null;
  document.body.classList.remove("is-resizing-settings-dialog");
  if (dialog) persistSettingsDialogSize(dialog);
}

function clampFileViewerSize(width, height) {
  const maxWidth = Math.max(320, Number(window.innerWidth || 0) - 36);
  const maxHeight = Math.max(280, Number(window.innerHeight || 0) - 36);
  const minWidth = Math.min(520, maxWidth);
  const minHeight = Math.min(360, maxHeight);
  return {
    width: Math.min(maxWidth, Math.max(minWidth, Math.round(Number(width) || maxWidth))),
    height: Math.min(maxHeight, Math.max(minHeight, Math.round(Number(height) || maxHeight))),
  };
}

function storedFileViewerSize() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILE_VIEWER_SIZE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return null;
    const width = Number(parsed.width || 0);
    const height = Number(parsed.height || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return clampFileViewerSize(width, height);
  } catch (error) {
    return null;
  }
}

function applyFileViewerSize(dialog = $("#file-viewer-dialog")) {
  if (!dialog) return;
  const size = storedFileViewerSize();
  if (!size) {
    dialog.style.removeProperty("width");
    dialog.style.removeProperty("height");
    return;
  }
  dialog.style.width = `${size.width}px`;
  dialog.style.height = `${size.height}px`;
}

function persistFileViewerSize(dialog = $("#file-viewer-dialog")) {
  if (!dialog) return;
  const rect = dialog.getBoundingClientRect();
  const size = clampFileViewerSize(rect.width, rect.height);
  localStorage.setItem(FILE_VIEWER_SIZE_KEY, JSON.stringify(size));
}

function startFileViewerResize(event) {
  const handle = event.target?.closest?.("[data-file-viewer-resize]");
  if (!handle) return;
  const dialog = $("#file-viewer-dialog");
  if (!dialog) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = dialog.getBoundingClientRect();
  const axis = ["right", "bottom", "corner"].includes(handle.dataset.fileViewerResize) ? handle.dataset.fileViewerResize : "corner";
  fileViewerResizeState = {
    axis,
    handle,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    width: rect.width,
    height: rect.height,
  };
  handle.setPointerCapture?.(event.pointerId);
  document.body.dataset.fileViewerResizeAxis = axis;
  document.body.classList.add("is-resizing-file-viewer");
}

function updateFileViewerResize(event) {
  if (!fileViewerResizeState) return;
  event.preventDefault();
  const dialog = $("#file-viewer-dialog");
  if (!dialog) return;
  const deltaX = event.clientX - fileViewerResizeState.startX;
  const deltaY = event.clientY - fileViewerResizeState.startY;
  const axis = fileViewerResizeState.axis || "corner";
  const size = clampFileViewerSize(
    axis === "right" || axis === "corner" ? fileViewerResizeState.width + deltaX : fileViewerResizeState.width,
    axis === "bottom" || axis === "corner" ? fileViewerResizeState.height + deltaY : fileViewerResizeState.height
  );
  dialog.style.width = `${size.width}px`;
  dialog.style.height = `${size.height}px`;
}

function finishFileViewerResize(event) {
  if (!fileViewerResizeState) return;
  const dialog = $("#file-viewer-dialog");
  const handle = fileViewerResizeState.handle || event?.target?.closest?.("[data-file-viewer-resize]") || document.querySelector("[data-file-viewer-resize]");
  try {
    handle?.releasePointerCapture?.(fileViewerResizeState.pointerId);
  } catch (error) {
    // Pointer capture may already be gone if the drag ended outside the dialog.
  }
  fileViewerResizeState = null;
  document.body.classList.remove("is-resizing-file-viewer");
  delete document.body.dataset.fileViewerResizeAxis;
  if (dialog) persistFileViewerSize(dialog);
}

function updateFileViewerReturnAction(currentPath) {
  const button = document.querySelector("[data-file-viewer-return]");
  if (!button) return;
  const current = repoRelativePath(currentPath);
  const target = repoRelativePath(fileViewerReturnPath || button.dataset.fileViewerReturn || LATEST_MANUSCRIPT_PATH);
  const show = Boolean(target && current && current !== target && fileViewerReturnPath);
  button.hidden = !show;
  button.dataset.fileViewerReturn = target || LATEST_MANUSCRIPT_PATH;
}

async function openInlineFullscreen(path, options = {}) {
  const dialog = $("#file-viewer-dialog");
  const body = $("#file-viewer-body");
  const title = $("#file-viewer-title");
  if (!dialog || !body || !title) return;
  const previousPath = repoRelativePath(body.dataset.inlineFullscreenFile || "");
  const requestedReturnPath = repoRelativePath(options.returnPath || "");
  let payload = inlineFilePayloads[path];
  if (!payload) {
    try {
      payload = await api(`/api/file?path=${encodeURIComponent(path)}`);
    } catch (error) {
      showToast(error.message, true);
      return;
    }
  }
  if (payload?.exists && payload?.is_dir) {
    // Directory link: try the canonical entry files inside before giving up.
    const dirPath = path.replace(/\/+$/, "");
    const entryCandidates = ["REPORT.md", "README.md", "INDEX.md", "PLAN.md"];
    for (const name of entryCandidates) {
      const candidatePath = `${dirPath}/${name}`;
      try {
        const subPayload = inlineFilePayloads[candidatePath]
          || (await api(`/api/file?path=${encodeURIComponent(candidatePath)}`));
        if (subPayload?.exists && !subPayload?.is_dir) {
          inlineFilePayloads[candidatePath] = subPayload;
          payload = subPayload;
          path = candidatePath;
          break;
        }
      } catch (_) {
        // Try next candidate.
      }
    }
  }
  if (!payload?.exists || payload?.is_dir) {
    const friendly = payload?.is_dir
      ? `${path} is a folder — open it from Project files.`
      : (payload?.error || "File not found.");
    showToast(friendly, true);
    return;
  }
  inlineFilePayloads[payload.path || path] = payload;
  inlineFiles[payload.path || path] = payload.text || "";
  const resolvedPath = payload.path || path;
  const normalizedResolvedPath = repoRelativePath(resolvedPath);
  if (normalizedResolvedPath === LATEST_MANUSCRIPT_PATH) {
    fileViewerReturnPath = "";
  } else if (requestedReturnPath) {
    fileViewerReturnPath = requestedReturnPath;
  } else if (dialog.open && previousPath === LATEST_MANUSCRIPT_PATH) {
    fileViewerReturnPath = LATEST_MANUSCRIPT_PATH;
  } else if (!dialog.open) {
    fileViewerReturnPath = "";
  }
  title.textContent = basename(resolvedPath);
  body.dataset.inlineFullscreenFile = resolvedPath;
  body.dataset.compactInline = "false";
  body.dataset.fileViewerKind = isLatestManuscriptPath(resolvedPath) ? "blueprint" : String(payload.kind || "file");
  body.innerHTML = body.dataset.fileViewerKind === "blueprint" ? renderBlueprintInspector(payload) : inlineEditorHtml(payload, false);
  updateFileViewerReturnAction(resolvedPath);
  applyFileViewerSize(dialog);
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeInlineFullscreen() {
  const dialog = $("#file-viewer-dialog");
  const body = $("#file-viewer-body");
  if (!dialog) return;
  if (fileViewerResizeState) finishFileViewerResize();
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
  if (body) {
    body.innerHTML = "";
    delete body.dataset.inlineFullscreenFile;
    delete body.dataset.fileViewerKind;
  }
  fileViewerReturnPath = "";
  updateFileViewerReturnAction("");
}

function filesFromApiResponse(payload) {
  return payload?.result?.files || payload?.files || payload?.result?.result?.files || {};
}

async function notifyResourceHandlingFromResponse(payload) {
  const files = filesFromApiResponse(payload);
  const queuedChat = files && typeof files.queued_chat === "object" ? files.queued_chat : null;
  if (queuedChat?.queued) {
    framingReplyPending = false;
    pendingFramingUserMessageId = "";
    framingPendingSince = 0;
    showToast("Queued; CoAutoResearch will reply after the current run finishes.");
    return;
  }
  const savedFiles = Array.isArray(files.saved_files) ? files.saved_files : [];
  const links = Array.isArray(files.resource_links) ? files.resource_links : [];
  const clues = Array.isArray(files.resource_clues) ? files.resource_clues : [];
  if (savedFiles.length || links.length) {
    const count = savedFiles.length + links.length;
    showToast(`Attached ${count} explicit ${count === 1 ? "resource" : "resources"}.`);
    return;
  }
  if (clues.length) {
    showToast(`${clues.length} resource ${clues.length === 1 ? "clue" : "clues"} noted for agent intake.`);
    return;
  }
  const metadataFiles = Array.isArray(files.metadata_files) ? files.metadata_files : [];
  if (metadataFiles.length) showToast("Resource references noted in manifest.");
}

function collectResourceLinks() {
  const links = [...selectedResourceItems];
  const seen = new Set();
  return links
    .map((item) => {
      const link = { path: item.path, category: item.category };
      if (item.alreadyImported || isProjectResourcePath(item.path)) link.alreadyImported = true;
      return link;
    })
    .filter((item) => {
      const key = `${item.category}:${item.path}`;
      if (!item.path || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function collectEditResourceLinks(messageId) {
  const draft = editAttachmentDraftForMessage(messageId);
  const seen = new Set();
  return draft.resources
    .map((item) => {
      const link = { path: item.path, category: item.category };
      if (item.alreadyImported || isProjectResourcePath(item.path)) link.alreadyImported = true;
      return link;
    })
    .filter((item) => {
      const key = `${item.category}:${item.path}`;
      if (!item.path || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function collectEditRetainedAttachments(messageId) {
  const draft = editAttachmentDraftForMessage(messageId);
  return draft.retained
    .map((item) => ({
      kind: item.originalKind || "attachment",
      name: item.name || basename(item.path || ""),
      path: item.path || "",
      category: item.category || "",
      type: item.type || "",
      size: item.size || 0,
      alreadyImported: Boolean(item.alreadyImported),
    }))
    .filter((item) => item.name || item.path);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name || "file"}.`));
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",", 2)[1] : result);
    };
    reader.readAsDataURL(file);
  });
}

async function collectUploadFiles(items = selectedUploadItems) {
  const uploads = [...items];
  const seen = new Set();
  return Promise.all(
    uploads
      .filter((item) => {
        const key = `${item.name}:${item.size}:${item.lastModified}`;
        if (!item.file || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(async (item) => ({
        category: item.category,
        name: item.name,
        relativePath: item.name,
        contentBase64: await fileToBase64(item.file),
      }))
  );
}

function currentComposerAttachments() {
  return [
    ...selectedResourceItems.map((item) => {
      const attachment = {
        kind: "link",
        path: item.path,
        name: basename(item.path),
        category: item.category,
      };
      if (item.alreadyImported) attachment.alreadyImported = true;
      return attachment;
    }),
    ...selectedUploadItems.map((item) => ({
      kind: "upload",
      name: item.name,
      category: item.category,
      type: item.type,
      size: item.size,
    })),
  ];
}

function clearFramingComposerAttachments() {
  sentFramingResourceItems.push(...selectedResourceItems.map((item) => ({ ...item })));
  sentFramingUploadItems.push(...selectedUploadItems.map((item) => ({ ...item })));
  selectedResourceItems.splice(0);
  selectedUploadItems.splice(0);
  saveResourceSelections();
  renderSelectedResources();
}

function copyComposerItems(items) {
  return items.map((item) => ({ ...item }));
}

function replaceComposerItems(target, items) {
  target.splice(0, target.length, ...copyComposerItems(items || []));
}

function snapshotFramingComposerState() {
  const editor = $("#cold-file-editor");
  return {
    text: String(editor?.value || ""),
    composerDraft,
    activeColdPath,
    activeColdText: activeColdPath ? coldFiles[activeColdPath] : undefined,
    selectedResources: copyComposerItems(selectedResourceItems),
    selectedUploads: copyComposerItems(selectedUploadItems),
    sentResources: copyComposerItems(sentFramingResourceItems),
    sentUploads: copyComposerItems(sentFramingUploadItems),
    resumeContext: normalizeResumeTrialContext(selectedResumeTrialContext),
  };
}

function restoreFramingComposerState(snapshot) {
  if (!snapshot) return;
  const editor = $("#cold-file-editor");
  if (editor) editor.value = snapshot.text || "";
  persistComposerDraft(String(snapshot.composerDraft || snapshot.text || ""));
  if (snapshot.activeColdPath && !hasProjectDraftReady() && !hasLaunched()) {
    coldFiles[snapshot.activeColdPath] = snapshot.text || snapshot.activeColdText || "";
  }
  replaceComposerItems(selectedResourceItems, snapshot.selectedResources);
  replaceComposerItems(selectedUploadItems, snapshot.selectedUploads);
  replaceComposerItems(sentFramingResourceItems, snapshot.sentResources);
  replaceComposerItems(sentFramingUploadItems, snapshot.sentUploads);
  selectedResumeTrialContext = normalizeResumeTrialContext(snapshot.resumeContext);
  saveResourceSelections();
  renderSelectedResources();
  renderAttachmentTrays();
  resizeColdEditor();
  renderColdPreview();
}

function clearFramingComposerText(expectedText = "") {
  const editor = $("#cold-file-editor");
  if (!editor) return;
  const current = String(editor.value || "");
  if (expectedText && current.trim() !== String(expectedText || "").trim()) return;
  editor.value = "";
  clearComposerDraft();
  resizeColdEditor();
  renderColdPreview();
  renderComposerActionButtons();
}

function closeResumeTrialDialog(confirmed = false) {
  const pending = pendingResumeTrialConfirm;
  pendingResumeTrialConfirm = null;
  const dialog = $("#resume-trial-dialog");
  if (dialog) {
    if (dialog.close) dialog.close();
    else dialog.removeAttribute("open");
  }
  if (pending) pending.resolve(Boolean(confirmed));
}

function renderResumeTrialDialog(context, text, attachments) {
  const value = normalizeResumeTrialContext(context);
  const trialLabel = resumeTrialLabel(value);
  const title = $("#resume-trial-title");
  const summary = $("#resume-trial-summary");
  const warning = $("#resume-trial-warning");
  const confirm = $("[data-resume-trial-confirm]");
  if (title) title.textContent = `Continue from ${trialLabel}?`;
  if (summary) {
    const attachedCount = Array.isArray(attachments) ? attachments.length : 0;
    summary.innerHTML = `
      <p>This will fork the active trajectory from the completed boundary of <strong>${escapeHtml(trialLabel)}</strong>.</p>
      <ul>
        <li>Trials after ${escapeHtml(trialLabel)} will move to <code>archive/resume_forks/</code>.</li>
        <li>Your current message and ${escapeHtml(attachedCount)} ${attachedCount === 1 ? "attachment" : "attachments"} will become the new fork instruction.</li>
        <li>The active trials axis will continue from this selected boundary.</li>
      </ul>
      ${text ? `<p><strong>Instruction:</strong> ${escapeHtml(compactText(text, 180))}</p>` : ""}
    `;
  }
  if (warning) {
    warning.hidden = Boolean(value?.checkpointExists);
    warning.textContent = value?.checkpointExists
      ? ""
      : "Best-effort restore: this trial has no saved checkpoint, so CoAutoResearch will archive later trials and continue from the closest available current project state.";
  }
  if (confirm) confirm.textContent = `Continue from ${trialLabel}`;
}

function confirmResumeTrialSend(context, text, attachments) {
  const dialog = $("#resume-trial-dialog");
  if (!dialog) {
    if (typeof window.confirm === "function") {
      return Promise.resolve(window.confirm(`Continue from ${resumeTrialLabel(context)}? Later trials will be archived.`));
    }
    return Promise.resolve(true);
  }
  renderResumeTrialDialog(context, text, attachments);
  return new Promise((resolve) => {
    pendingResumeTrialConfirm = { resolve };
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
  });
}

function pendingInterventionSummaryItems() {
  const marker = expectedTrialMarker();
  const ids = Array.isArray(marker.pending_intervention_ids)
    ? marker.pending_intervention_ids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const paths = Array.isArray(marker.pending_intervention_paths)
    ? marker.pending_intervention_paths.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return ids.map((id, index) => ({ id, path: paths[index] || "" }));
}

function resumeAutoresearchSummaryHtml() {
  const session = sessionState();
  const trajectory = session.trajectory && typeof session.trajectory === "object" ? session.trajectory : {};
  const expected = pendingExpectedTrialIteration();
  const nextTrial = expected || Number(trajectory.next_trial_number || 0) || 0;
  const trials = visibleTrials();
  const latest = trials[trials.length - 1] || null;
  const latestReported = [...trials].reverse().find((trial) => trial?.report_path || trial?.report?.report_path) || null;
  const latestReportedLabel = cleanText(latestReported?.id || latestReported?.report?.id, "");
  const latestLabel = cleanText(latest?.id, "");
  const baseTrial = cleanText(trajectory.base_trial, "");
  const latestActive = cleanText(trajectory.latest_active_trial, "");
  const queuedCount = Number(session.queued_chat_count || 0);
  const queuedAt = cleanText(session.queued_chat_latest_at, "");
  const pendingItems = pendingInterventionSummaryItems();
  const pendingHtml = pendingItems.length
    ? `<ul>${pendingItems.map((item) => `<li><code>${escapeHtml(item.id)}</code>${item.path ? ` · <code>${escapeHtml(item.path)}</code>` : ""}</li>`).join("")}</ul>`
    : "<p>No pending interventions are currently queued.</p>";
  const boundaryParts = [];
  if (latestReportedLabel) boundaryParts.push(`latest reported ${latestReportedLabel}`);
  if (latestActive && latestActive !== latestReportedLabel) boundaryParts.push(`active boundary ${latestActive}`);
  if (!boundaryParts.length && latestLabel) boundaryParts.push(`latest visible trial ${latestLabel}`);
  return `
    <p>Resume will continue the current autoresearch trajectory. It will not restart, archive, or renumber existing trials.</p>
    <ul>
      <li><strong>Next boundary:</strong> ${nextTrial ? `Trial ${escapeHtml(nextTrial)}` : "computed from current project state"}</li>
      <li><strong>Current boundary:</strong> ${escapeHtml(boundaryParts.join(" · ") || "current closed trajectory boundary")}</li>
      ${baseTrial ? `<li><strong>Fork base:</strong> ${escapeHtml(baseTrial)}</li>` : ""}
      <li><strong>Queued chat:</strong> ${queuedCount ? `${escapeHtml(queuedCount)} message${queuedCount === 1 ? "" : "s"}${queuedAt ? `, latest ${escapeHtml(formatTimestamp(queuedAt))}` : ""}` : "none"}</li>
    </ul>
    <p><strong>Pending interventions for this resume:</strong></p>
    ${pendingHtml}
  `;
}

function resetResumeAutoresearchDialog() {
  resumeAutoresearchSubmitting = false;
  const instruction = $("#resume-autoresearch-instruction");
  if (instruction) instruction.value = "";
  const confirm = $("[data-resume-autoresearch-confirm]");
  if (confirm) {
    confirm.disabled = false;
    confirm.textContent = "Resume autoresearch";
  }
  $$("[data-resume-autoresearch-cancel]").forEach((button) => {
    button.disabled = false;
  });
}

function setResumeAutoresearchSubmitting(active) {
  resumeAutoresearchSubmitting = Boolean(active);
  const confirm = $("[data-resume-autoresearch-confirm]");
  if (confirm) {
    confirm.disabled = Boolean(active);
    confirm.textContent = active ? "Resuming..." : "Resume autoresearch";
  }
  $$("[data-resume-autoresearch-cancel]").forEach((button) => {
    button.disabled = Boolean(active);
  });
}

function closeResumeAutoresearchDialog({ clear = true } = {}) {
  const dialog = $("#resume-autoresearch-dialog");
  if (dialog) {
    if (dialog.close) dialog.close();
    else dialog.removeAttribute("open");
  }
  if (clear) resetResumeAutoresearchDialog();
}

function openResumeAutoresearchDialog() {
  if (!hasActiveProject()) {
    openProjectCreateDialog();
    showToast("Create a project first.", true);
    return false;
  }
  if (isSessionRunning()) {
    showToast("Autoresearch is already running.", true);
    return false;
  }
  const dialog = $("#resume-autoresearch-dialog");
  if (!dialog) {
    handleResumeAutoresearch().catch((error) => showToast(error.message, true));
    return true;
  }
  const summary = $("#resume-autoresearch-summary");
  if (summary) summary.innerHTML = resumeAutoresearchSummaryHtml();
  resetResumeAutoresearchDialog();
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
  requestAnimationFrame(() => $("#resume-autoresearch-instruction")?.focus());
  return true;
}

async function confirmResumeAutoresearch() {
  if (resumeAutoresearchSubmitting) return false;
  const resumeInstruction = String($("#resume-autoresearch-instruction")?.value || "").trim();
  setResumeAutoresearchSubmitting(true);
  try {
    const result = await handleResumeAutoresearch({ resumeInstruction });
    if (result) closeResumeAutoresearchDialog();
    else setResumeAutoresearchSubmitting(false);
    return Boolean(result);
  } catch (error) {
    showToast(error.message, true);
    setResumeAutoresearchSubmitting(false);
    return false;
  }
}

function confirmPreProjectFramingResend(messageText, archivedCount) {
  const summary = compactText(messageText || "edited initial brief", 180);
  const warning = [
    "Regenerate the initial PROJECT.md framing from this edited brief?",
    "",
    "This will truncate later framing conversation after the edited message and start a new framing run.",
    "It will not archive or modify trials.",
    archivedCount ? `Messages to archive from the visible framing thread: ${archivedCount}.` : "",
    summary ? `Edited brief: ${summary}` : "",
  ].filter(Boolean).join("\n");
  if (typeof window.confirm === "function") return Promise.resolve(window.confirm(warning));
  return Promise.resolve(true);
}

function closeRestartAutoresearchDialog(confirmed = false) {
  const pending = pendingRestartAutoresearchConfirm;
  pendingRestartAutoresearchConfirm = null;
  const dialog = $("#restart-autoresearch-dialog");
  if (dialog) {
    if (dialog.close) dialog.close();
    else dialog.removeAttribute("open");
  }
  if (pending) pending.resolve(Boolean(confirmed));
}

function renderRestartAutoresearchDialog(reason) {
  const reasonBox = $("#restart-autoresearch-reason");
  if (reasonBox) {
    reasonBox.hidden = !String(reason || "").trim();
    reasonBox.textContent = String(reason || "").trim();
  }
}

function confirmRestartAutoresearch(reason = "") {
  const dialog = $("#restart-autoresearch-dialog");
  if (!dialog) {
    if (typeof window.confirm === "function") {
      return Promise.resolve(window.confirm("Restart autoresearch? Current generated trials and runtime state will be archived before a new run starts."));
    }
    return Promise.resolve(true);
  }
  renderRestartAutoresearchDialog(reason);
  return new Promise((resolve) => {
    pendingRestartAutoresearchConfirm = { resolve };
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
  });
}

async function handleRestartAutoresearch(reason = "") {
  if (!hasActiveProject()) {
    openProjectCreateDialog();
    showToast("Create a project first.", true);
    return false;
  }
  if (isSessionRunning()) {
    showToast("Stop the current agent run before restarting autoresearch.", true);
    return false;
  }
  const confirmed = await confirmRestartAutoresearch(reason);
  if (!confirmed) return false;
  const response = await api("/api/research/restart", {
    method: "POST",
    body: JSON.stringify({ message: String(reason || "").trim(), settings: settingsFromForm() }),
  });
  mergeSessionFromApiResponse(response);
  await notifyResourceHandlingFromResponse(response);
  showToast("Restarted autoresearch.");
  await loadOverview(true);
  scrollFramingToBottomSoon();
  return true;
}

async function handleResumeAutoresearch(options = {}) {
  if (!hasActiveProject()) {
    openProjectCreateDialog();
    showToast("Create a project first.", true);
    return false;
  }
  if (isSessionRunning()) {
    showToast("Autoresearch is already running.", true);
    return false;
  }
  const resumeInstruction = String(options?.resumeInstruction || "").trim();
  const response = await api("/api/research/resume", {
    method: "POST",
    body: JSON.stringify({ settings: settingsFromForm(), resumeInstruction }),
  });
  mergeSessionFromApiResponse(response);
  await notifyResourceHandlingFromResponse(response);
  showToast("Resume autoresearch requested.");
  await loadOverview(true);
  scrollFramingToBottomSoon();
  return true;
}

function currentBriefText() {
  const editorValue = String($("#cold-file-editor")?.value || "");
  if (activeColdPath && !hasProjectDraftReady() && !hasLaunched()) coldFiles[activeColdPath] = editorValue;
  const savedBrief = String(coldFiles["resources/user_input/INITIAL_BRIEF.md"] || "").trim();
  if (savedBrief) return savedBrief;
  const lastUser = [...localMessages].reverse().find((message) => message.role === "user" && String(message.text || "").trim());
  return String(lastUser?.text || "");
}

function insertComposerPrompt(prompt) {
  const editor = $("#cold-file-editor");
  if (!editor) return;
  const text = String(prompt || "").trim();
  if (!text) return;
  editor.value = composerPromptNextValue(editor.value, text);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  editor.focus();
  const end = editor.value.length;
  editor.setSelectionRange(end, end);
}

function isComposerCommandLine(line) {
  const normalized = String(line || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized.startsWith("/")) return false;
  if (isLocalSlashControl(normalized)) return true;
  return /^\/(?:permissions|model)(?:\s+.*)?$/.test(normalized);
}

function parsePlanSlashCommand(text) {
  const value = String(text || "").trim();
  if (!/^\/plan(?:\s|$)/i.test(value)) return null;
  return value.replace(/^\/plan(?:\s+)?/i, "").trim();
}

function composerPromptNextValue(currentValue, prompt) {
  const promptText = String(prompt || "").trim();
  if (!promptText) return String(currentValue || "");
  const current = String(currentValue || "").trimEnd();
  if (!current.trim()) return promptText;
  const lines = current.split(/\r?\n/);
  if (lines.some((line) => line.trim() === promptText)) return current;
  const lastNonEmptyIndex = (() => {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (lines[index].trim()) return index;
    }
    return -1;
  })();
  if (promptText.startsWith("/") && lastNonEmptyIndex >= 0 && isComposerCommandLine(lines[lastNonEmptyIndex])) {
    lines[lastNonEmptyIndex] = promptText;
    return lines.join("\n").trimEnd();
  }
  return `${current}\n${promptText}`;
}

function renderComposerSuggestions() {
  const row = $("#composer-suggestions");
  if (row) {
    row.hidden = true;
    row.classList.remove("is-running");
    row.innerHTML = "";
  }
  requestAnimationFrame(() => {
    updateBriefDockGeometry();
    updateFramingScrollButton();
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openLaunchDialog() {
  if (!ensureResourceImportsReady()) return;
  if (hasGoalStarted()) {
    showToast("Autoresearch has already started for this session.", true);
    return;
  }
  const draft = currentProjectDraft().trim();
  if (!draft || isPlaceholderProject(draft)) {
    showToast("Frame the project before launching autoresearch.", true);
    $("#cold-file-editor")?.focus();
    return;
  }
  try {
    await saveProjectDraft({ silent: true });
    renderAllAgentStatusNotes();
    $("#launch-dialog").showModal();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function launchAutoresearch() {
  if (!ensureResourceImportsReady()) return;
  if (!hasActiveProject()) {
    openProjectCreateDialog();
    showToast("Create a project first.", true);
    return;
  }
  if (isSessionRunning()) {
    showToast("Autoresearch is already running.", true);
    return;
  }
  if (!hasProjectDraftReady()) {
    showToast("Frame the project before launching autoresearch.", true);
    return;
  }
  const blockedAgent = launchBlockingStatus();
  if (blockedAgent) {
    const message = blockedAgent.message || `${agentLabel(effectiveBackend(currentLaunchBackend()))} is not ready.`;
    showToast(message, true);
    renderAllAgentStatusNotes();
    return;
  }
  const brief = currentBriefText().trim();
  if (!brief && !hasProjectDraftReady() && !hasLaunched()) {
    showToast("Write a brief before launching.", true);
    return;
  }
  const fileEdits = Object.entries(coldFiles).map(([path, text]) => ({ path, text }));
  fileEdits.push({ path: "PROJECT.md", text: currentProjectDraft() });
  const targetVenue = String($("#target-venue")?.value || "").trim();
  const launchInstruction = String($("#launch-instruction")?.value || "").trim();
  const launchComposerText = String($("#cold-file-editor")?.value || "");
  const settings = settingsFromForm();
  let launchMessage = null;
  let previousSession = null;
  try {
    framingDraftPending = true;
    previousSession = clonePlainObject(appState?.research_session);
    if (!hasGoalLaunchMessage()) launchMessage = appendFramingMessage("user", "Start autoresearch.", { kind: "goal-launch" });
    beginFramingPending(launchMessage?.id || "");
    $("#launch-dialog")?.close();
    startOptimisticAutoresearchSession(settings);
    renderFramingConversation();
    scrollFramingToBottomSoon();
    await persistFramingMessages();
    await saveProjectDraft({ silent: true });
    const files = await collectUploadFiles();
    const response = await api("/api/research/cold-start", {
      method: "POST",
      body: JSON.stringify({ confirmLaunch: true, brief, targetVenue, launchInstruction, fileEdits, resourceLinks: collectResourceLinks(), files, settings }),
    });
    mergeSessionFromApiResponse(response);
    await notifyResourceHandlingFromResponse(response);
    framingDraftPending = false;
    reconcileFramingPending(localMessages);
    coldDirty = false;
    if (String($("#cold-file-editor")?.value || "").trim() === launchComposerText.trim()) {
      clearFramingComposerText(launchComposerText);
    } else if (storedComposerDraft() === launchComposerText) {
      clearComposerDraft();
    }
    showToast("Started autoresearch.");
    activeStage = "1";
    await loadOverview(true);
    scrollFramingToBottomSoon();
  } catch (error) {
    framingDraftPending = false;
    clearOptimisticAutoresearchSession(previousSession);
    const prunedMessages = pruneStaleGoalLaunchMessages(localMessages);
    if (prunedMessages.length !== localMessages.length) {
      localMessages.splice(0, localMessages.length, ...prunedMessages);
      lastFramingHtml = "";
      persistFramingMessages().catch(() => {});
    }
    reconcileFramingPending(localMessages);
    renderFramingConversation();
    showToast(error.message, true);
  }
}

async function sendSessionComposerMessage(message, options = {}) {
  if (!ensureResourceImportsReady()) return false;
  if (!hasActiveProject()) {
    openProjectCreateDialog();
    showToast("Create a project first.", true);
    return false;
  }
  const text = String(message || "").trim();
  const planSlashMessage = parsePlanSlashCommand(text);
  const isPlanRequest = planSlashMessage !== null || (!text.startsWith("/") && isPlanComposerMode());
  const isCommand = text.startsWith("/") && !isPlanRequest;
  const attachments = currentComposerAttachments();
  const resourceLinksForRequest = isCommand ? [] : collectResourceLinks();
  const uploadItemsForRequest = isCommand ? [] : copyComposerItems(selectedUploadItems);
  const targetVenue = isCommand ? "" : String($("#target-venue")?.value || "").trim();
  let resumeFromTrial = selectedResumeTrialPayload();
  if (!text && !attachments.length && !resumeFromTrial) return false;
  const localControl = canSendLocalSlashControl(text);
  if (isPlanRequest && isSessionRunning()) {
    showToast("Wait for the current agent run to finish before starting a plan.", true);
    return false;
  }
  if (options.forceQueue && (isPlanRequest || isCommand || resumeFromTrial)) {
    showToast("Only ordinary chat messages can be queued in this version.", true);
    return false;
  }
  const queueChatDuringRun = !isPlanRequest && !isCommand && canQueueChatDuringAutoresearchRun(text, attachments, resumeFromTrial);
  if (!canSendSessionComposerMessage() && !localControl && !queueChatDuringRun) {
    showToast("Wait for the current agent run to finish before sending another message.", true);
    return false;
  }
  const commandSettings = isCommand ? settingsFromForm() : null;
  let messageText = planSlashMessage !== null ? planSlashMessage : text;
  if (isPlanRequest && !messageText && !attachments.length) {
    showToast("Write what you want the agent to plan.", true);
    return false;
  }
  if (resumeFromTrial && isCommand) {
    showToast("Remove the Continue from Trial chip before sending a slash command, or send a normal instruction for this fork.", true);
    return false;
  }
  if (resumeFromTrial && isPlanRequest) {
    showToast("Remove the Continue from Trial chip before starting a plan.", true);
    return false;
  }
  if (resumeFromTrial) {
    const confirmed = await confirmResumeTrialSend(resumeFromTrial, messageText, attachments);
    if (!confirmed) return false;
  }
  const composerSnapshot = snapshotFramingComposerState();
  const displayText = isCommand ? text : messageText || attachmentOnlyMessage(attachments) || resumeTrialOnlyMessage(resumeFromTrial);
  if (queueChatDuringRun || options.forceQueue) {
    try {
      const files = await collectUploadFiles(uploadItemsForRequest);
      const response = await api("/api/research/queue", {
        method: "POST",
        body: JSON.stringify({
          message: messageText || displayText,
          displayMessage: displayText,
          clientMessageId: newMessageId("queued"),
          clientAttachments: attachments,
          conversationHistory: conversationHistoryForRequest(localMessages),
          files,
          resourceLinks: resourceLinksForRequest,
          targetVenue,
          settings: settingsFromForm(),
          priority: options.queuePriority === "send_after_stop" ? "send_after_stop" : "normal",
        }),
      });
      mergeSessionFromApiResponse(response);
      updateQueuedChatSessionFromPayload(response);
      await notifyResourceHandlingFromResponse(response);
      clearFramingComposerText(text || displayText);
      clearFramingComposerAttachments();
      selectedResumeTrialContext = null;
      renderAttachmentTrays();
      renderFramingConversation();
      renderSelectedResources();
      return true;
    } catch (error) {
      restoreFramingComposerState(composerSnapshot);
      throw error;
    }
  }
  let appendedMessage = null;
  if (!isCommand) {
    appendedMessage = appendFramingMessage("user", displayText, {
      attachments,
      resumeFromTrial,
      ...(isPlanRequest ? { mode: "plan", revisePlanId: pendingPlanRevisionId } : {}),
    });
    framingReplyPending = true;
    beginFramingPending(appendedMessage?.id || "");
    clearFramingComposerText(text || displayText);
    clearFramingComposerAttachments();
    selectedResumeTrialContext = null;
    renderAttachmentTrays();
    renderFramingConversation();
    scrollFramingToBottomSoon();
  } else {
    appendedMessage = appendFramingMessage("user", displayText, { kind: "command" });
    framingReplyPending = true;
    beginFramingPending(appendedMessage?.id || "");
    clearFramingComposerText(text);
    renderFramingConversation();
    scrollFramingToBottomSoon();
  }
  const endpoint = isCommand
      ? "/api/research/command"
      : isPlanRequest
        ? "/api/research/plan"
      : resumeFromTrial
        ? "/api/research/resume-from-trial"
        : "/api/research/chat";
  let response = null;
  try {
    const files = await collectUploadFiles(uploadItemsForRequest);
    const body = isCommand
      ? { command: text, settings: commandSettings }
      : {
          message: messageText || displayText,
          clientMessageId: appendedMessage?.id || "",
          conversationHistory: conversationHistoryForRequest(localMessages),
          files,
          resourceLinks: resourceLinksForRequest,
          targetVenue,
          resumeFromTrial: isPlanRequest ? null : resumeFromTrial,
          ...(isPlanRequest && pendingPlanRevisionId ? { revisePlanId: pendingPlanRevisionId } : {}),
          settings: settingsFromForm(),
        };
    if (appendedMessage) await persistFramingMessages();
    response = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
  } catch (error) {
    if (appendedMessage) {
      removeFramingMessage(appendedMessage.id);
      framingReplyPending = false;
      if (pendingFramingUserMessageId === appendedMessage?.id) pendingFramingUserMessageId = "";
      restoreFramingComposerState(composerSnapshot);
      reconcileFramingPending(localMessages);
      renderFramingConversation();
      persistFramingMessages().catch(() => {});
    }
    throw error;
  }
  mergeSessionFromApiResponse(response);
  if (planSlashMessage !== null) setComposerMode("plan");
  if (isPlanRequest) pendingPlanRevisionId = "";
  await notifyResourceHandlingFromResponse(response);
  reconcileFramingPending(localMessages);
  renderFramingConversation();
  renderSelectedResources();
  return true;
}

async function startFramingRun(brief, options = {}) {
  if (!ensureResourceImportsReady()) throw new Error(blockingResourceImportMessage());
  if (!hasActiveProject()) throw new Error("Create a project first.");
  const text = String(brief || "").trim();
  if (!text) throw new Error("Research brief is required.");
  if (activeColdPath && options.updateActiveColdPath !== false) coldFiles[activeColdPath] = text;
  await saveColdFiles({ refresh: false });
  setColdSaveStatus("Autosaved", "saved");
  const fileEdits = Object.entries(coldFiles).map(([path, value]) => ({ path, text: value }));
  const targetVenue = String($("#target-venue")?.value || "").trim();
  const files = Array.isArray(options.files) ? options.files : await collectUploadFiles();
  const resourceLinks = Array.isArray(options.resourceLinks) ? options.resourceLinks : collectResourceLinks();
  const conversationHistory = Array.isArray(options.conversationHistory)
    ? options.conversationHistory
    : conversationHistoryForRequest(localMessages);
  const response = await api("/api/research/framing", {
    method: "POST",
    body: JSON.stringify({
      brief: text,
      targetVenue,
      fileEdits,
      resourceLinks,
      files,
      conversationHistory,
      settings: settingsFromForm(),
    }),
  });
  const session = response?.result?.session;
  if (appState && session) appState.research_session = session;
  mergeSessionFromApiResponse(response);
  await notifyResourceHandlingFromResponse(response);
  return response;
}

async function coldStartFromPrepare() {
  if ($("#prepare-cold-start")?.dataset?.stopMode === "true") {
    await handleStopSession();
    return;
  }
  if (!ensureResourceImportsReady()) return;
  if (!hasActiveProject()) {
    openProjectCreateDialog();
    showToast("Create a project first.", true);
    return;
  }
  const input = String($("#cold-file-editor")?.value || "").trim();
  const attachments = currentComposerAttachments();
  const resumeFromTrial = selectedResumeTrialPayload();
  if (!input && !attachments.length && !resumeFromTrial) {
    showToast(hasProjectDraftReady() ? "Write a message to refine the project." : "Write a message describing the project before launch.", true);
    setColdViewMode("source");
    $("#cold-file-editor")?.focus();
    return;
  }
  try {
    const sent = await sendSessionComposerMessage(input);
    if (!sent) return;
    resizeColdEditor();
    activeStage = "1";
    renderStage();
    renderChatState();
    await loadOverview(true);
    scrollFramingToBottomSoon();
  } catch (error) {
    reconcileFramingPending(localMessages);
    renderFramingConversation();
    showToast(error.message, true);
  }
}

async function approvePlan(planId) {
  const id = String(planId || "").trim();
  if (!id) return;
  if (isSessionRunning()) {
    showToast("Wait for the current agent run to finish before approving a plan.", true);
    return;
  }
  try {
    framingReplyPending = true;
    beginFramingPending("");
    const response = await api("/api/research/plan/approve", {
      method: "POST",
      body: JSON.stringify({ planId: id, settings: settingsFromForm() }),
    });
    mergeSessionFromApiResponse(response);
    setComposerMode("chat");
    showToast("Started implementation run.");
    await loadOverview(true);
    scrollFramingToBottomSoon();
  } catch (error) {
    framingReplyPending = false;
    reconcileFramingPending(localMessages);
    renderFramingConversation();
    showToast(error.message, true);
  }
}

function revisePlan(planId) {
  const id = String(planId || "").trim();
  if (!id) return;
  pendingPlanRevisionId = id;
  setComposerMode("plan");
  showToast("Plan revision mode is ready.");
  $("#cold-file-editor")?.focus();
}

async function resendConversationMessage(id, text) {
  const message = localMessages.find((item) => item.id === id && item.role === "user");
  const next = String(text || "").trim();
  if (!message) return;
  if (isSessionRunning()) {
    showToast(`${agentLabel(sessionBackend())} is already running. Wait for the current run to finish.`, true);
    return;
  }
  const index = localMessages.findIndex((item) => item.id === id);
  const usePlanRun = message.mode === "plan";
  const useFramingRun = !usePlanRun && isTruePreProjectBriefResend(index);
  const editAttachments = editDraftAttachments(id);
  const displayText = next || attachmentOnlyMessage(editAttachments);
  if (!displayText) return;
  const archivedMessages = index >= 0 ? localMessages.slice(index + 1).map(chatHistoryItemForRequest).filter(Boolean) : [];
  if (useFramingRun) {
    const confirmed = await confirmPreProjectFramingResend(displayText, archivedMessages.length);
    if (!confirmed) {
      showToast("Reframing cancelled.");
      return;
    }
  }
  const resourceLinks = collectEditResourceLinks(id);
  const retainedAttachments = collectEditRetainedAttachments(id);
  message.edited_at = new Date().toISOString();
  message.text = displayText;
  if (editAttachments.length) message.attachments = editAttachments;
  else delete message.attachments;
  editingFramingId = "";
  if (index >= 0) {
    localMessages.splice(index + 1, localMessages.length - index - 1);
  }
  setHiddenProjectDraft("");
  projectDraftDirty = false;
  if (useFramingRun) framingDraftPending = true;
  else framingReplyPending = true;
  beginFramingPending(id);
  renderFramingConversation();
  scrollFramingToBottomSoon();
  try {
    await persistFramingMessages();
    const files = await collectUploadFiles(editAttachmentDraftForMessage(id).uploads);
    if (useFramingRun) {
      await startFramingRun(displayText, { files, resourceLinks });
    } else {
      const body = {
        message: displayText,
        clientMessageId: message.id,
        conversationHistory: conversationHistoryForRequest(localMessages),
        targetVenue: String($("#target-venue")?.value || "").trim(),
        resendContext: {
          editedMessageId: message.id,
          archivedCount: archivedMessages.length,
          archivedMessages,
          forceFreshSession: true,
        },
        settings: settingsFromForm(),
      };
      if (usePlanRun) {
        delete body.resendContext.forceFreshSession;
        if (message.revisePlanId) body.revisePlanId = message.revisePlanId;
      }
      if (files.length) body.files = files;
      if (resourceLinks.length) body.resourceLinks = resourceLinks;
      if (retainedAttachments.length) body.retainedAttachments = retainedAttachments;
      const response = await api(usePlanRun ? "/api/research/plan" : "/api/research/chat", {
        method: "POST",
        body: JSON.stringify(body),
      });
      mergeSessionFromApiResponse(response);
      await notifyResourceHandlingFromResponse(response);
    }
    editAttachmentDrafts.delete(id);
    framingDraftPending = false;
    if (!useFramingRun && !isSessionRunning()) framingReplyPending = false;
    reconcileFramingPending(localMessages);
    renderFramingConversation();
    scrollFramingToBottomSoon();
    showToast(useFramingRun ? `${agentLabel(sessionBackend())} is reframing PROJECT.md.` : "Regenerating reply.");
    await loadOverview(true);
    scrollFramingToBottomSoon();
  } catch (error) {
    framingDraftPending = false;
    framingReplyPending = false;
    reconcileFramingPending(localMessages);
    renderFramingConversation();
    showToast(error.message, true);
  }
}

function appendUserMessage(text) {
  localMessages.push({ role: "user", text });
  renderChatSummary();
  scrollThread();
}

function appendAssistantMessage(text) {
  localMessages.push({ role: "assistant", text });
  renderChatSummary();
  scrollThread();
}

function scrollThread() {
  const thread = $("#chat-thread");
  requestAnimationFrame(() => {
    thread.scrollTop = thread.scrollHeight;
  });
}

async function handleChat(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const message = String(data.get("message") || "").trim();
  if (hasNoChatFormContent(message)) return;
  try {
    const sent = await sendSessionComposerMessage(message);
    if (!sent) return;
    form.reset();
    resizeComposer();
    await loadOverview(true);
    scrollThread();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleContinue() {
  if (!ensureResourceImportsReady()) return;
  if (!canMessage()) {
    showToast("Run cold start first.", true);
    return;
  }
  try {
    const response = await api("/api/research/go", { method: "POST", body: JSON.stringify({ settings: settingsFromForm() }) });
    mergeSessionFromApiResponse(response);
    await loadOverview(true);
    scrollThread();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function sendCommand(command) {
  if (!ensureResourceImportsReady()) return;
  const localControl = canSendLocalSlashControl(command);
  if (!canMessage() && !localControl) {
    showToast("Wait for the current agent run to finish before sending another message.", true);
    return;
  }
  try {
    const response = await api("/api/research/command", {
      method: "POST",
      body: JSON.stringify({ command, settings: settingsFromForm() }),
    });
    mergeSessionFromApiResponse(response);
    await loadOverview(true);
    scrollThread();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleStopSession() {
  if (stopRequestPending) return;
  if (!canStopCurrentRun()) {
    showToast("No active agent run to stop.", true);
    return;
  }
  stopRequestPending = true;
  renderComposerActionButtons();
  try {
    const response = await api("/api/research/stop", { method: "POST", body: JSON.stringify({}) });
    mergeSessionFromApiResponse(response);
    showToast("Stop requested.");
    await loadOverview(true);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    stopRequestPending = false;
    renderComposerActionButtons();
  }
}

async function handleStopAndSendQueuedComposer() {
  if (!canStopCurrentRun()) {
    showToast("No active agent run to stop.", true);
    return;
  }
  const queued = await queueCurrentComposerMessage("send_after_stop");
  if (!queued) return;
  await handleStopSession();
}

async function handlePauseAutoresearch() {
  try {
    const response = await api("/api/research/pause", {
      method: "POST",
      body: JSON.stringify({ settings: settingsFromForm() }),
    });
    mergeSessionFromApiResponse(response);
    showToast("Autoresearch will pause after the current turn.");
    await loadOverview(true);
  } catch (error) {
    showToast(error.message, true);
  }
}

function resizeComposer() {
  const textarea = $("#chat-form textarea");
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
}

function hasNoChatFormContent(message) {
  if (!message && !currentComposerAttachments().length) return !selectedResumeTrialPayload();
  return false;
}

function bindEvents() {
  $$(".rail-action").forEach((button) => {
    button.addEventListener("click", () => setPanel(button.dataset.view));
  });
  $("#open-project-create")?.addEventListener("click", openProjectCreateDialog);
  $("#project-list")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-create-first-project]")) openProjectCreateDialog();
  });
  $("#project-create-form")?.addEventListener("submit", createProjectFromDialog);
  $("#project-agent-backend")?.addEventListener("change", (event) => {
    renderAgentStatusNote("#project-agent-backend-note", event.target.value, "project");
  });
  $$("[data-project-close]").forEach((button) => {
    button.addEventListener("click", closeProjectCreateDialog);
  });
  $("#project-rename-form")?.addEventListener("submit", renameProjectFromDialog);
  $$("[data-project-rename-close]").forEach((button) => {
    button.addEventListener("click", closeProjectRenameDialog);
  });
  $("#project-rename-dialog")?.addEventListener("close", () => {
    pendingRenameProject = null;
  });
  $("#project-delete-form")?.addEventListener("submit", deleteProjectFromDialog);
  $("#project-delete-confirm")?.addEventListener("input", updateDeleteSubmitState);
  $$("[data-project-delete-close]").forEach((button) => {
    button.addEventListener("click", closeProjectDeleteDialog);
  });
  $("#project-delete-dialog")?.addEventListener("close", () => {
    pendingDeleteProject = null;
  });
  $("#open-settings").addEventListener("click", async () => {
    await loadUiSettings();
    switchSettingsTab("general");
    const dialog = $("#settings-dialog");
    applySettingsDialogSize(dialog);
    dialog.showModal();
  });
  $$("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) dialog.close();
    });
  });
  $$("[data-settings-close]").forEach((button) => {
    button.addEventListener("click", () => $("#settings-dialog").close());
  });
  $$("[data-agent-setup-close]").forEach((button) => {
    button.addEventListener("click", () => {
      if (noProjectsDashboard()) dismissInitialPreflight();
      const dialog = document.getElementById("agent-setup-dialog");
      if (dialog?.open) {
        try { dialog.close(); } catch (_) { /* ignore */ }
      }
    });
  });
  $("[data-agent-setup-create-project]")?.addEventListener("click", () => {
    createProjectFromSetupDialog();
  });
  $("[data-agent-setup-settings]")?.addEventListener("click", () => {
    openSettingsFromSetupDialog();
  });
  $("#agent-setup-grid")?.addEventListener("click", (event) => {
    const button = event.target && event.target.closest("[data-agent-setup-use]");
    if (!button) return;
    useAgentSetupBackend(button.dataset.agentSetupUse);
  });
  $$("[data-agent-setup-recheck]").forEach((button) => {
    button.addEventListener("click", async () => {
      await refreshAgentStatuses();
      maybeShowAgentSetupDialog({ force: true, initial: noProjectsDashboard() });
    });
  });
  $$(".settings-nav-button").forEach((button) => {
    button.addEventListener("click", () => switchSettingsTab(button.dataset.settingsTab));
  });
  $$("[data-theme-option]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) applyThemeMode(input.value);
    });
  });
  $("#settings-form").addEventListener("submit", saveUiSettings);
  $$(".stage-pill").forEach((button) => {
    button.addEventListener("click", () => setStage(button.dataset.stage));
  });
  $$("[data-plan-mode-toggle]").forEach((button) => {
    button.addEventListener("click", togglePlanComposerMode);
  });

  $("#launch-autoresearch").addEventListener("click", launchAutoresearch);
  $("#open-launch-dialog").addEventListener("click", openLaunchDialog);
  $("#open-launch-dialog-inline").addEventListener("click", openLaunchDialog);
  $$("[data-launch-close]").forEach((button) => {
    button.addEventListener("click", () => $("#launch-dialog").close());
  });
  $("#resume-trial-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeResumeTrialDialog(false);
  });
  $("#resume-trial-dialog")?.addEventListener("close", () => {
    if (pendingResumeTrialConfirm) closeResumeTrialDialog(false);
  });
  $("#resume-autoresearch-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeResumeAutoresearchDialog();
  });
  $("#resume-autoresearch-dialog")?.addEventListener("close", () => {
    if (!resumeAutoresearchSubmitting) resetResumeAutoresearchDialog();
  });
  $("#restart-autoresearch-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeRestartAutoresearchDialog(false);
  });
  $("#restart-autoresearch-dialog")?.addEventListener("close", () => {
    if (pendingRestartAutoresearchConfirm) closeRestartAutoresearchDialog(false);
  });
  $("#prepare-cold-start").addEventListener("click", (event) => {
    coldStartFromPrepare();
  });
  $("#save-project-draft").addEventListener("click", (event) => {
    withButtonFeedback(event.currentTarget, () => saveProjectDraft(), { saved: "Draft saved" })
      .catch((error) => showToast(error.message, true));
  });
  $("#project-draft-editor").addEventListener("input", () => {
    projectDraftDirty = true;
    updateProjectDraftPreview();
    renderFramingConversation();
  });
  $("#cold-file-editor").addEventListener("input", () => {
    const value = $("#cold-file-editor").value;
    persistComposerDraft(value);
    if (hasProjectDraftReady() || hasLaunched()) {
      composerDraft = value;
    } else if (activeColdPath) {
      coldFiles[activeColdPath] = value;
      coldDirty = true;
      markPrepareSaved(false);
      scheduleColdAutosave();
    }
    resizeColdEditor();
    renderColdPreview();
    renderComposerActionButtons();
  });
  $("#target-venue").addEventListener("input", (event) => {
    scopedSet("autoResearchTargetVenue", event.target.value || "");
    if (!projectDraftDirty && currentProjectDraft().trim() && !isPlaceholderProject(currentProjectDraft())) {
      renderProjectDraft(true);
    }
  });
  $("#continue-research").addEventListener("click", handleContinue);
  $("#stop-session").addEventListener("click", handleStopSession);
  $("#chat-form .send-button").addEventListener("click", (event) => {
    if (event.currentTarget?.dataset?.stopMode === "true") {
      event.preventDefault();
      event.stopPropagation();
      handleStopSession();
    }
  });
  $("#chat-form").addEventListener("submit", handleChat);
  $("#session-settings-form").addEventListener("input", () => settingsFromForm());
  $("#session-settings-form")?.elements?.backend?.addEventListener("change", (event) => switchSessionBackend(event.target.value));
  $("#session-settings-form")?.elements?.model?.addEventListener("change", () => {
    const form = $("#session-settings-form");
    const backend = normalizeAgentBackend(form?.elements?.backend?.value || activeSettingsBackend());
    syncReasoningSelectOptions(form?.elements?.reasoningEffort, backend, form?.elements?.model?.value, form?.elements?.reasoningEffort?.value);
    if (form?.elements?.reasoningEffort) {
      form.elements.reasoningEffort.value = normalizeReasoningEffort(form.elements.reasoningEffort.value, backend, form?.elements?.model?.value);
    }
    settingsFromForm();
  });
  $("#settings-form")?.elements?.settingsBackend?.addEventListener("change", (event) => switchSettingsBackend(event.target.value));
  $("#settings-form")?.elements?.settingsCodexProvider?.addEventListener("change", () => {
    const provider = $("#settings-form")?.elements?.settingsCodexProvider?.value || "";
    hydrateCodexProviderSettings(uiSettings || {}, "codex", provider);
    renderAgentStatusNote("#settings-agent-status", "codex", "settings");
  });
  $("#settings-form")?.elements?.settingsClaudeProvider?.addEventListener("change", () => {
    const provider = $("#settings-form")?.elements?.settingsClaudeProvider?.value || "";
    hydrateClaudeProviderSettings(uiSettings || {}, "claude", provider);
    renderAgentStatusNote("#settings-agent-status", "claude", "settings");
  });
  $("#settings-form")?.elements?.settingsCodexApiKey?.addEventListener("input", refreshCodexApiKeyDraftStatus);
  $("#settings-form")?.elements?.settingsClaudeApiKey?.addEventListener("input", refreshClaudeApiKeyDraftStatus);
  $("#settings-form")?.elements?.settingsClaudeCredential?.addEventListener("input", refreshClaudeCredentialDraftStatus);
  $("#settings-form")?.elements?.settingsModel?.addEventListener("change", () => {
    const form = $("#settings-form");
    const backend = normalizeAgentBackend(form?.elements?.settingsBackend?.value || activeSettingsBackend());
    syncReasoningSelectOptions(form?.elements?.settingsReasoningEffort, backend, form?.elements?.settingsModel?.value, form?.elements?.settingsReasoningEffort?.value);
    if (form?.elements?.settingsReasoningEffort) {
      form.elements.settingsReasoningEffort.value = normalizeReasoningEffort(form.elements.settingsReasoningEffort.value, backend, form?.elements?.settingsModel?.value);
    }
  });
  $("#composer-model")?.addEventListener("change", updateSessionSettingsFromComposer);
  $("#composer-reasoning")?.addEventListener("change", updateSessionSettingsFromComposer);
  $("#framing-scroll-bottom")?.addEventListener("click", scrollFramingToBottom);
  $("#copy-resume-command")?.addEventListener("click", copyResumeCommand);
  $("#chat-form textarea").addEventListener("input", () => {
    resizeComposer();
    renderComposerActionButtons();
  });
  $("#browser-search").addEventListener("input", (event) => {
    handleBrowserSearchInput(event.target.value || "");
  });
  $("#browser-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    jumpLocalBrowserInput();
  });
  $("#browser-jump")?.addEventListener("click", jumpLocalBrowserInput);
  window.addEventListener("resize", () => {
    resizeColdEditor();
    updateBriefDockGeometry();
    updateFramingScrollButton();
    fitComposerSelectWidths();
    if ($("#settings-dialog")?.open) applySettingsDialogSize();
  });
  window.addEventListener("scroll", () => {
    updateFramingScrollButton();
    schedulePersistActiveViewScrollPosition();
  }, { passive: true });
  $(".main-stage")?.addEventListener("scroll", () => {
    updateFramingScrollButton();
    schedulePersistActiveViewScrollPosition();
  }, { passive: true });
  $(".main-stage")?.addEventListener("wheel", handleFramingStageWheel, { passive: false });
  $("#chat-form textarea").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("#chat-form").requestSubmit();
    }
  });
  $("#cold-file-editor").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      coldStartFromPrepare();
    }
  });
  $("#cold-file-editor").addEventListener("paste", handleAttachmentPaste);
  $("#chat-form textarea").addEventListener("paste", handleAttachmentPaste);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setAttachmentMenuOpen(false);
      closeUploadSourcePicker();
    }
  });
  $("#composer-file-input")?.addEventListener("change", (event) => {
    const category = resourceCategories[event.target.dataset.resourceCategory] ? event.target.dataset.resourceCategory : "user_input";
    const editMessageId = String(event.target.dataset.editMessageId || "");
    if (editMessageId) addEditFilesFromList(editMessageId, event.target.files, "file picker", { category });
    else addFilesFromList(event.target.files, "file picker", { category });
    delete event.target.dataset.resourceCategory;
    delete event.target.dataset.editMessageId;
    event.target.value = "";
  });
  $("#large-import-category")?.addEventListener("change", (event) => {
    const record = largeResourceImportById(activeLargeResourceImportId);
    const category = event.target.value;
    if (!record || !resourceCategories[category]) return;
    record.category = category;
    record.destination = resourceImportDestination(category);
    savePendingResourceImports();
    renderLargeResourceImportDialog(record);
    renderAttachmentTrays();
  });
  $("#large-resource-import-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeLargeResourceImportDialog();
  });
  $("#export-confirm-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeExportConfirmDialog();
  });
  document.addEventListener("dragover", (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    document.body.classList.add("is-dragging-file");
  });
  document.addEventListener("dragleave", (event) => {
    if (event.relatedTarget) return;
    document.body.classList.remove("is-dragging-file");
  });
  document.addEventListener("drop", handleAttachmentDrop);

  document.body.addEventListener("dragstart", (event) => {
    const item = event.target.closest?.("[data-queue-item]");
    if (!item || !item.closest("#queue-panel")) return;
    draggingQueuedChatId = item.dataset.queueItem || "";
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggingQueuedChatId);
    item.classList.add("is-dragging");
  });
  document.body.addEventListener("dragend", (event) => {
    const item = event.target.closest?.("[data-queue-item]");
    if (item) item.classList.remove("is-dragging");
    draggingQueuedChatId = "";
  });
  document.body.addEventListener("dragover", (event) => {
    const item = event.target.closest?.("[data-queue-item]");
    if (!draggingQueuedChatId || !item || !item.closest("#queue-panel")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  document.body.addEventListener("drop", (event) => {
    const item = event.target.closest?.("[data-queue-item]");
    if (!draggingQueuedChatId || !item || !item.closest("#queue-panel")) return;
    event.preventDefault();
    const targetId = item.dataset.queueItem || "";
    if (!targetId || targetId === draggingQueuedChatId) return;
    const ids = queuedChatIds();
    const from = ids.indexOf(draggingQueuedChatId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    reorderQueuedChatItems(next).catch((error) => showToast(error.message, true));
  });

  document.body.addEventListener("click", (event) => {
    const projectMenuButton = event.target.closest("[data-project-menu]");
    if (projectMenuButton) {
      const projectId = projectMenuButton.dataset.projectMenu;
      openProjectMenuId = openProjectMenuId === projectId ? "" : projectId;
      renderProjectList();
      return;
    }
    const projectRename = event.target.closest("[data-project-rename]");
    if (projectRename) {
      openProjectRenameDialog(projectRename.dataset.projectRename);
      return;
    }
    const projectDelete = event.target.closest("[data-project-delete]");
    if (projectDelete) {
      openProjectDeleteDialog(projectDelete.dataset.projectDelete);
      return;
    }
    const projectUpgradeReviewers = event.target.closest("[data-project-upgrade-reviewers]");
    if (projectUpgradeReviewers) {
      upgradeProjectReviewers(projectUpgradeReviewers.dataset.projectUpgradeReviewers)
        .catch((error) => showToast(error.message, true));
      return;
    }
    if (openProjectMenuId && !event.target.closest(".project-menu-popover")) {
      openProjectMenuId = "";
      renderProjectList();
    }
    const queueMenuToggle = event.target.closest("[data-queue-action-menu-toggle]");
    if (queueMenuToggle) {
      event.preventDefault();
      queueActionMenuOpen = !queueActionMenuOpen;
      renderQueueActionMenu();
      return;
    }
    const queueAction = event.target.closest("[data-queue-action]");
    if (queueAction) {
      event.preventDefault();
      const action = queueAction.dataset.queueAction || "";
      queueActionMenuOpen = false;
      renderQueueActionMenu();
      if (action === "queue") {
        coldStartFromPrepare();
      } else if (action === "stop-send") {
        handleStopAndSendQueuedComposer().catch((error) => showToast(error.message, true));
      }
      return;
    }
    if (queueActionMenuOpen && !event.target.closest("#queue-action-menu") && !event.target.closest("#queue-action-menu-toggle")) {
      queueActionMenuOpen = false;
      renderQueueActionMenu();
    }
    const queueMove = event.target.closest("[data-queue-move]");
    if (queueMove) {
      event.preventDefault();
      moveQueuedChatItem(queueMove.dataset.queueMove, Number(queueMove.dataset.queueDirection || 0))
        .catch((error) => showToast(error.message, true));
      return;
    }
    const queueEdit = event.target.closest("[data-queue-edit]");
    if (queueEdit) {
      editingQueuedChatId = queueEdit.dataset.queueEdit || "";
      renderQueuedChatPanel();
      requestAnimationFrame(() => document.querySelector(`[data-queue-edit-text="${CSS.escape(editingQueuedChatId)}"]`)?.focus());
      return;
    }
    const queueEditCancel = event.target.closest("[data-queue-edit-cancel]");
    if (queueEditCancel) {
      editingQueuedChatId = "";
      renderQueuedChatPanel();
      return;
    }
    const queueEditSave = event.target.closest("[data-queue-edit-save]");
    if (queueEditSave) {
      saveQueuedChatEdit(queueEditSave.dataset.queueEditSave || "").catch((error) => showToast(error.message, true));
      return;
    }
    const queueDelete = event.target.closest("[data-queue-delete]");
    if (queueDelete) {
      deleteQueuedChatItem(queueDelete.dataset.queueDelete || "").catch((error) => showToast(error.message, true));
      return;
    }
    const attachmentButton = event.target.closest("#composer-attach-button");
    if (attachmentButton) {
      event.preventDefault();
      toggleAttachmentMenu();
      return;
    }
    const attachmentAction = event.target.closest("[data-attachment-action]");
    if (attachmentAction) {
      handleAttachmentMenuAction(attachmentAction.dataset.attachmentAction);
      return;
    }
    const uploadSourceAction = event.target.closest("[data-upload-source]");
    if (uploadSourceAction) {
      handleUploadSourceChoice(uploadSourceAction.dataset.uploadSource);
      return;
    }
    if (!$("#attachment-menu")?.hidden && !event.target.closest("#attachment-menu") && !event.target.closest("#composer-attach-button")) {
      setAttachmentMenuOpen(false);
    }
    if (uploadSourceMenu && !uploadSourceMenu.hidden && !event.target.closest("#upload-source-menu") && !event.target.closest("#composer-attach-button") && !event.target.closest("[data-edit-upload]")) {
      closeUploadSourcePicker();
    }
    const projectLoadingRetry = event.target.closest("[data-project-loading-retry]");
    if (projectLoadingRetry) {
      const retry = activeProjectId
        ? loadOverview(true)
        : loadProjects({ showLoading: true });
      retry.catch((error) => {
        setProjectLoadPhase("error", { error: error.message });
        showToast(error.message, true);
      });
      return;
    }
    const projectSwitch = event.target.closest("[data-project-switch]");
    if (projectSwitch) {
      switchProject(projectSwitch.dataset.projectSwitch).catch((error) => showToast(error.message, true));
      return;
    }
    const resourceCategory = event.target.closest("[data-resource-category]");
    if (resourceCategory) {
      setResourceCategory(resourceCategory.dataset.resourceCategory);
      return;
    }
    const browseResources = event.target.closest("#browse-resources");
    if (browseResources) {
      showResourceBrowser();
      return;
    }
    const clearSecret = event.target.closest("[data-clear-secret]");
    if (clearSecret) {
      clearSavedSecret(clearSecret.dataset.clearSecret);
      return;
    }
    const clearCodexSecret = event.target.closest("[data-clear-codex-secret]");
    if (clearCodexSecret) {
      clearSavedCodexSecret(clearCodexSecret.dataset.clearCodexSecret);
      return;
    }
    const clearClaudeSecret = event.target.closest("[data-clear-claude-secret]");
    if (clearClaudeSecret) {
      clearSavedClaudeSecret(clearClaudeSecret.dataset.clearClaudeSecret);
      return;
    }
    const closeBrowser = event.target.closest("[data-browser-close]");
    if (closeBrowser) {
      closeResourceBrowser();
      return;
    }
    const browserRoot = event.target.closest("[data-browser-root]");
    if (browserRoot) {
      loadLocalBrowser(browserRoot.dataset.browserRoot);
      return;
    }
    const browserUp = event.target.closest("#browser-up");
    if (browserUp && !browserUp.disabled) {
      loadLocalBrowser(browserUp.dataset.browserParent);
      return;
    }
    const addResource = event.target.closest("[data-resource-add-path]");
    if (addResource) {
      addResourcePathToActiveTarget(addResource.dataset.resourceAddPath);
      return;
    }
    const removeResource = event.target.closest("[data-resource-remove]");
    if (removeResource) {
      removeResourcePath(removeResource.dataset.resourceRemove);
      return;
    }
    const removeUpload = event.target.closest("[data-upload-remove]");
    if (removeUpload) {
      removeUploadFile(removeUpload.dataset.uploadRemove);
      return;
    }
    const openResourceImport = event.target.closest("[data-resource-import-open]");
    if (openResourceImport) {
      openLargeResourceImportDialog(openResourceImport.dataset.resourceImportOpen);
      return;
    }
    const retryResourceImport = event.target.closest("[data-resource-import-retry]");
    if (retryResourceImport) {
      confirmLargeResourceImport(retryResourceImport.dataset.resourceImportRetry).catch((error) => showToast(error.message, true));
      return;
    }
    const cancelResourceImport = event.target.closest("[data-resource-import-cancel]");
    if (cancelResourceImport) {
      cancelLargeResourceImport(cancelResourceImport.dataset.resourceImportCancel).catch((error) => showToast(error.message, true));
      return;
    }
    const confirmLargeImport = event.target.closest("[data-large-import-confirm]");
    if (confirmLargeImport) {
      const category = $("#large-import-category")?.value || "";
      confirmLargeResourceImport(activeLargeResourceImportId, category).catch((error) => showToast(error.message, true));
      return;
    }
    const cancelLargeImport = event.target.closest("[data-large-import-cancel]");
    if (cancelLargeImport) {
      cancelLargeResourceImport(activeLargeResourceImportId).catch((error) => showToast(error.message, true));
      return;
    }
    const closeLargeImport = event.target.closest("[data-large-import-close]");
    if (closeLargeImport) {
      closeLargeResourceImportDialog();
      return;
    }
    const startExport = event.target.closest("[data-export-kind]");
    if (startExport) {
      beginExportFlow(startExport.dataset.exportKind).catch((error) => showToast(error.message, true));
      return;
    }
    const exportConfirmGenerate = event.target.closest("[data-export-confirm-generate]");
    if (exportConfirmGenerate) {
      confirmExportDialog().catch((error) => showToast(error.message, true));
      return;
    }
    const exportConfirmCancel = event.target.closest("[data-export-confirm-cancel]");
    const exportConfirmClose = event.target.closest("[data-export-confirm-close]");
    if (exportConfirmCancel || exportConfirmClose) {
      closeExportConfirmDialog();
      return;
    }
    const exportCancel = event.target.closest("[data-export-cancel]");
    if (exportCancel) {
      cancelExportJob(exportCancel.dataset.exportCancel);
      return;
    }
    const exportDownload = event.target.closest("[data-export-download]");
    if (exportDownload) {
      downloadExportJob(exportDownload.dataset.exportDownload);
      return;
    }
    const singleFileDownload = event.target.closest("[data-download-single-file]");
    if (singleFileDownload) {
      downloadSingleFile(singleFileDownload.dataset.downloadSingleFile);
      return;
    }
    const copyText = event.target.closest("[data-copy-text]");
    if (copyText) {
      event.preventDefault();
      let text = copyText.dataset.copyText || "";
      try {
        text = decodeURIComponent(text);
      } catch {
        text = copyText.dataset.copyText || "";
      }
      copyTextToClipboard(text, copyText.dataset.copyLabel || "Copied.")
        .then((copied) => {
          if (copied) markCopyButtonCopied(copyText);
        })
        .catch((error) => showToast(error.message, true));
      return;
    }
    const removeResumeTrial = event.target.closest("[data-resume-trial-remove]");
    if (removeResumeTrial) {
      clearResumeTrialContext();
      return;
    }
    const pauseAutoresearch = event.target.closest("[data-pause-autoresearch]");
    if (pauseAutoresearch) {
      event.preventDefault();
      event.stopPropagation();
      handlePauseAutoresearch();
      return;
    }
    const resumeAutoresearch = event.target.closest("[data-resume-autoresearch]");
    if (resumeAutoresearch) {
      event.preventDefault();
      event.stopPropagation();
      openResumeAutoresearchDialog();
      return;
    }
    const resumeAutoresearchConfirm = event.target.closest("[data-resume-autoresearch-confirm]");
    if (resumeAutoresearchConfirm) {
      event.preventDefault();
      event.stopPropagation();
      confirmResumeAutoresearch();
      return;
    }
    const resumeAutoresearchCancel = event.target.closest("[data-resume-autoresearch-cancel]");
    if (resumeAutoresearchCancel) {
      event.preventDefault();
      event.stopPropagation();
      closeResumeAutoresearchDialog();
      return;
    }
    const restartAutoresearch = event.target.closest("[data-restart-autoresearch]");
    if (restartAutoresearch) {
      event.preventDefault();
      event.stopPropagation();
      handleRestartAutoresearch().catch((error) => showToast(error.message, true));
      return;
    }
    const restartConfirm = event.target.closest("[data-restart-autoresearch-confirm]");
    if (restartConfirm) {
      event.preventDefault();
      closeRestartAutoresearchDialog(true);
      return;
    }
    const restartCancel = event.target.closest("[data-restart-autoresearch-cancel]");
    if (restartCancel) {
      event.preventDefault();
      closeRestartAutoresearchDialog(false);
      return;
    }
    const submitResumeTrial = event.target.closest("[data-resume-trial-submit]");
    if (submitResumeTrial) {
      event.preventDefault();
      event.stopPropagation();
      const input = String($("#cold-file-editor")?.value || "").trim();
      sendSessionComposerMessage(input)
        .then((sent) => {
          if (!sent) return;
          loadOverview(true).then(scrollFramingToBottomSoon).catch((error) => showToast(error.message, true));
        })
        .catch((error) => showToast(error.message, true));
      return;
    }
    const browserOpen = event.target.closest("[data-browser-open]");
    if (browserOpen) {
      if (browserOpen.dataset.browserType === "directory") loadLocalBrowser(browserOpen.dataset.browserOpen);
      else addResourcePathToActiveTarget(browserOpen.dataset.browserOpen);
      return;
    }
    const save = event.target.closest("[data-inline-save]");
    if (save) {
      saveInlineFile(save.dataset.inlineSave, save.closest(".inline-editor-shell"));
      return;
    }
    const blueprintAnchor = event.target.closest("[data-blueprint-anchor]");
    if (blueprintAnchor) {
      const anchor = blueprintAnchor.dataset.blueprintAnchor || "";
      const viewerBody = $("#file-viewer-body");
      const target = anchor
        ? viewerBody?.querySelector?.(`#${CSS.escape(anchor)}`) || document.getElementById?.(anchor)
        : null;
      if (target) {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
      } else if (blueprintAnchor.dataset.blueprintFallback) {
        openInlineFullscreen(blueprintAnchor.dataset.blueprintFallback, { returnPath: LATEST_MANUSCRIPT_PATH });
      } else {
        showToast("That blueprint section is not visible in the rendered file yet.", true);
      }
      return;
    }
    const inlineFullscreen = event.target.closest("[data-inline-fullscreen]");
    if (inlineFullscreen) {
      const sourcePath = repoRelativePath(
        inlineFullscreen.closest("[data-inline-fullscreen-file]")?.dataset.inlineFullscreenFile ||
        inlineFullscreen.closest("[data-inline-file]")?.dataset.inlineFile ||
        ""
      );
      const targetPath = repoRelativePath(inlineFullscreen.dataset.inlineFullscreen || "");
      const returnPath = sourcePath === LATEST_MANUSCRIPT_PATH && targetPath !== LATEST_MANUSCRIPT_PATH ? LATEST_MANUSCRIPT_PATH : fileViewerReturnPath;
      openInlineFullscreen(inlineFullscreen.dataset.inlineFullscreen, { returnPath });
      return;
    }
    const fileViewerReturn = event.target.closest("[data-file-viewer-return]");
    if (fileViewerReturn) {
      openInlineFullscreen(fileViewerReturn.dataset.fileViewerReturn || LATEST_MANUSCRIPT_PATH);
      return;
    }
    const fileViewerClose = event.target.closest("[data-file-viewer-close]");
    if (fileViewerClose) {
      closeInlineFullscreen();
      return;
    }
    const inlineMode = event.target.closest("[data-inline-mode]");
    if (inlineMode) {
      setInlineFileMode(inlineMode.dataset.inlinePath, inlineMode.dataset.inlineMode);
      return;
    }
    const cardPreview = event.target.closest("[data-card-preview]");
    if (cardPreview) {
      const card = cardPreview.closest(".context-card, .review-card");
      const target = card?.querySelector(".card-inline-file");
      if (target) {
        target.hidden = !target.hidden;
        if (!target.hidden && !target.dataset.loaded) {
          target.dataset.loaded = "true";
          loadInlineFile(cardPreview.dataset.cardPreview, target, true);
        }
      }
      return;
    }
    const composerPrompt = event.target.closest("[data-composer-prompt]");
    if (composerPrompt) {
      insertComposerPrompt(composerPrompt.dataset.composerPrompt);
      return;
    }
    const autoresearchPanelToggle = event.target.closest("[data-autoresearch-panel-toggle]");
    if (autoresearchPanelToggle) {
      event.preventDefault();
      event.stopPropagation();
      toggleAutoresearchPanelCollapsed();
      return;
    }
    const command = event.target.closest("[data-command]");
    if (command) {
      if (String(command.dataset.command || "").trim().toLowerCase() === "/plan") {
        setComposerMode("plan");
        $("#cold-file-editor")?.focus();
        return;
      }
      insertComposerPrompt(command.dataset.command);
      return;
    }
    const trialScroll = event.target.closest("[data-trial-scroll]");
    if (trialScroll) {
      const strip = trialScroll.closest(".trial-strip")?.querySelector(".trial-strip-scroll");
      if (strip) {
        const delta = Number(trialScroll.dataset.trialScroll || 1) * Math.max(180, strip.clientWidth * 0.72);
        const nextLeft = clampTrialStripScrollLeft(strip, strip.scrollLeft + delta);
        strip.scrollLeft = nextLeft;
        markTrialStripManual(strip, { left: nextLeft });
      }
      return;
    }
    const trialSelect = event.target.closest("[data-trial-select]");
    if (trialSelect) {
      const strip = trialSelect.closest(".trial-strip")?.querySelector(".trial-strip-scroll");
      selectedTrialIndex = Number(trialSelect.dataset.trialSelect || 0);
      rememberTrialStripScroll(strip, { manual: true, selectedIteration: selectedTrialIndex });
      renderFramingConversation();
      requestAnimationFrame(() => restoreTrialStripScroll({ selectedIteration: selectedTrialIndex }));
      return;
    }
    const reviewTrialScroll = event.target.closest("[data-review-trial-scroll]");
    if (reviewTrialScroll) {
      const strip = reviewTrialScroll.closest(".review-trial-strip")?.querySelector(".review-trial-strip-scroll");
      if (strip) {
        const delta = Number(reviewTrialScroll.dataset.reviewTrialScroll || 1) * Math.max(180, strip.clientWidth * 0.72);
        strip.scrollLeft = Math.max(0, strip.scrollLeft + delta);
      }
      return;
    }
    const reviewTrialSelect = event.target.closest("[data-review-trial-select]");
    if (reviewTrialSelect) {
      selectedReviewGroupKey = reviewTrialSelect.dataset.reviewTrialSelect || "";
      renderContext();
      return;
    }
    const trialContinue = event.target.closest("[data-trial-continue]");
    if (trialContinue) {
      const iteration = Number(trialContinue.dataset.trialContinue || 0);
      const report = reportForIteration(iteration);
      const context = resumeTrialContextFromReport(iteration, report);
      if (!context) {
        showToast("This trial does not have a completed report to continue from.", true);
        return;
      }
      setResumeTrialContext(context);
      return;
    }
    const resumeTrialCancel = event.target.closest("[data-resume-trial-cancel]");
    if (resumeTrialCancel) {
      closeResumeTrialDialog(false);
      return;
    }
    const resumeTrialConfirm = event.target.closest("[data-resume-trial-confirm]");
    if (resumeTrialConfirm) {
      closeResumeTrialDialog(true);
      return;
    }
    const framingEdit = event.target.closest("[data-framing-edit]");
    if (framingEdit) {
      editingFramingId = framingEdit.dataset.framingEdit;
      editAttachmentDraftForMessage(editingFramingId);
      renderFramingConversation();
      requestAnimationFrame(() => document.querySelector(`[data-framing-edit-form="${CSS.escape(editingFramingId)}"] textarea`)?.focus());
      return;
    }
    const framingCancel = event.target.closest("[data-framing-cancel]");
    if (framingCancel) {
      editAttachmentDrafts.delete(framingCancel.dataset.framingCancel || editingFramingId);
      editingFramingId = "";
      renderFramingConversation();
      return;
    }
    const editUpload = event.target.closest("[data-edit-upload]");
    if (editUpload) {
      activeEditResourceTargetId = editUpload.dataset.editUpload || "";
      if (isRemoteUi()) {
        showUploadSourcePicker({ editMessageId: activeEditResourceTargetId, anchor: editUpload });
      } else {
        openComposerFilePicker("user_input", activeEditResourceTargetId);
      }
      return;
    }
    const editLink = event.target.closest("[data-edit-link]");
    if (editLink) {
      activeEditResourceTargetId = editLink.dataset.editLink || "";
      setResourceCategory("ongoing_work");
      showResourceBrowser({ editMessageId: activeEditResourceTargetId });
      return;
    }
    const editAttachmentRemove = event.target.closest("[data-edit-attachment-remove]");
    if (editAttachmentRemove) {
      removeEditAttachment(editingFramingId, editAttachmentRemove.dataset.editAttachmentRemove);
      return;
    }
    const planApprove = event.target.closest("[data-plan-approve]");
    if (planApprove) {
      approvePlan(planApprove.dataset.planApprove).catch((error) => showToast(error.message, true));
      return;
    }
    const planRevise = event.target.closest("[data-plan-revise]");
    if (planRevise) {
      revisePlan(planRevise.dataset.planRevise);
      return;
    }
    const projectLaunch = event.target.closest("[data-project-launch]");
    if (projectLaunch) {
      openLaunchDialog();
      return;
    }
    const coldView = event.target.closest("[data-cold-view]");
    if (coldView) setColdViewMode(coldView.dataset.coldView);
    const stageLink = event.target.closest("[data-stage-link]");
    if (stageLink) setStage(stageLink.dataset.stageLink);
    const coldFile = event.target.closest("[data-cold-file]");
    if (coldFile) switchColdFile(coldFile.dataset.coldFile);
  });

  $("#file-viewer-dialog")?.addEventListener("click", (event) => {
    if (event.target?.id === "file-viewer-dialog") closeInlineFullscreen();
  });
  $("#file-viewer-dialog")?.addEventListener("pointerdown", startFileViewerResize);
  document.addEventListener("pointermove", updateFileViewerResize);
  document.addEventListener("pointerup", finishFileViewerResize);
  document.addEventListener("pointercancel", finishFileViewerResize);
  $("#settings-dialog")?.addEventListener("pointerdown", startSettingsDialogResize);
  document.addEventListener("pointermove", updateSettingsDialogResize);
  document.addEventListener("pointerup", finishSettingsDialogResize);
  document.addEventListener("pointercancel", finishSettingsDialogResize);
  $("#settings-dialog")?.addEventListener("close", () => {
    if (settingsResizeState) finishSettingsDialogResize();
  });
  $("#file-viewer-dialog")?.addEventListener("close", () => {
    if (fileViewerResizeState) finishFileViewerResize();
    const body = $("#file-viewer-body");
    if (!body) return;
    body.innerHTML = "";
    delete body.dataset.inlineFullscreenFile;
    fileViewerReturnPath = "";
    updateFileViewerReturnAction("");
  });
  $("#resource-browser")?.addEventListener("close", () => {
    activeEditResourceTargetId = "";
  });

  document.body.addEventListener("submit", (event) => {
    const framingForm = event.target.closest("[data-framing-edit-form]");
    if (framingForm) {
      event.preventDefault();
      resendConversationMessage(framingForm.dataset.framingEditForm, framingForm.elements.message.value);
      return;
    }
  });

  document.body.addEventListener("change", (event) => {
    const categorySelect = event.target.closest("[data-resource-category-select]");
    if (categorySelect) updateSelectedResourceCategory(categorySelect.dataset.resourceCategorySelect, categorySelect.value);
    const uploadCategorySelect = event.target.closest("[data-upload-category-select]");
    if (uploadCategorySelect) updateSelectedUploadCategory(uploadCategorySelect.dataset.uploadCategorySelect, uploadCategorySelect.value);
  });

  document.addEventListener(
    "toggle",
    (event) => {
      const activityDetails = event.target.closest?.("[data-run-activity-details]");
      if (activityDetails === event.target) {
        rememberRunActivityDetailsState(activityDetails);
      }
      const details = event.target.closest?.("[data-file-details]");
      if (!details || !details.open) return;
      const path = details.dataset.fileDetails;
      const container = details.querySelector(`[data-inline-file="${CSS.escape(path)}"]`);
      if (container && !container.dataset.loaded) {
        container.dataset.loaded = "true";
        loadInlineFile(path, container);
      }
    },
    true
  );
}

async function init() {
  bindEvents();
  setResourceCategory(activeResourceCategory);
  setProjectLoadPhase("projects");
  await loadProjects({ showLoading: true }).catch((error) => {
    setProjectLoadPhase("error", { error: error.message });
    showToast(error.message, true);
  });
  await loadUiSettings();
  restoreNavigationState();
  if (!activeProjectId && appState?.multi_project) {
    $("#sync-state").textContent = "Create a project";
    renderProjectAvailability();
    maybeOpenInitialProjectDialog();
    scheduleOverviewPoll(3500);
    return;
  }
  hydrateTargetVenueField({ force: true });
  restoreSessionSettings();
  restoreResourceSelections();
  restorePendingResourceImports();
  resizeComposer();
  resizeColdEditor();
  await loadOverview(true);
  scheduleOverviewPoll(1000);
}

init().catch((error) => showToast(error.message, true));
