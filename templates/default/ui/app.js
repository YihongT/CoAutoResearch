let appState = null;
let activeProjectId = new URLSearchParams(window.location.search).get("project") || localStorage.getItem("coAutoResearchActiveProject") || "";
let activeView = "chat";
let activePanel = "resources";
let activeStage = "1";
const FRAMING_MESSAGES_CLIENT_VERSION = "20260617-trial-selection";
let activeColdPath = "";
let toastTimer = null;
let coldAutosaveTimer = null;
let editingTranscriptId = "";
let coldDirty = false;
let localBrowserPath = "";
let localBrowserPayload = null;
let browserSearchQuery = "";
let browserSearchTimer = null;
let prepareSaved = false;
let coldViewMode = "source";
let uiSettings = null;
let settingsSecretKeys = [];
let projectDraftDirty = false;
let framingDraftPending = false;
let framingReplyPending = false;
let pendingFramingUserMessageId = "";
let framingPendingSince = 0;
let projectDraftEditMode = false;
let editingFramingId = "";
let projectRenderedScrollTop = 0;
let overviewPollTimer = null;
let workingTickerTimer = null;
let lastFramingHtml = "";
let framingMessagesPersisting = false;
let framingMessagesSaveVersion = 0;
let initialProjectDialogOpened = false;
let openProjectMenuId = "";
let pendingRenameProject = null;
let pendingDeleteProject = null;
let selectedTrialIndex = 0;
let trialStripScrollLeft = 0;
let selectedResumeTrialContext = null;
let pendingResumeTrialConfirm = null;
let pendingRestartAutoresearchConfirm = null;
let activeLargeResourceImportId = "";
let optimisticResearchSession = null;
let fileViewerResizeState = null;
let fileViewerReturnPath = "";
let composerDraft = "";
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
const COLD_AUTOSAVE_DELAY = 900;
const MAX_BROWSER_UPLOAD_BYTES = 50 * 1024 * 1024;
const LARGE_RESOURCE_CHUNK_BYTES = 8 * 1024 * 1024;
const FILE_VIEWER_SIZE_KEY = "coAutoResearchFileViewerSize";
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
  model: "gpt-5.5",
  reasoningEffort: "medium",
  permissionPreset: "default",
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  webSearch: true,
  fastMode: false,
  extraConfig: "",
  reviewCheckpointInterval: 100,
};
const defaultClaudeSessionSettings = {
  model: "sonnet",
  reasoningEffort: "medium",
  permissionPreset: "auto-review",
  permissionMode: "auto",
  webSearch: true,
  fastMode: false,
  extraConfig: "",
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
    ["sonnet", "Claude Sonnet"],
    ["opus", "Claude Opus"],
    ["haiku", "Claude Haiku"],
  ],
};

const defaultThemeMode = "graphite-aurora";
const allowedThemeModes = new Set([defaultThemeMode, "museum-tech", "dark-glass"]);
let currentThemeMode = normalizeThemeMode(localStorage.getItem("coAutoResearchTheme") || document.documentElement.dataset.theme || defaultThemeMode);

const localSlashCommandRegistry = {
  "/goal": { label: "Autoresearch", value: "Show autoresearch" },
  "/goal pause": { label: "Autoresearch", value: "Pause after current turn" },
  "/goal resume": { label: "Autoresearch", value: "Resume autoresearch", requiresSession: true },
  "/goal restart": { label: "Autoresearch", value: "Restart autoresearch", requiresSession: true, destructive: true },
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
const permissionPresets = {
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
const allowedPermissionPresets = new Set(Object.keys(permissionPresets));
const allowedReasoningEfforts = new Set(["low", "medium", "high", "xhigh"]);

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

function rawFileUrl(path) {
  const params = new URLSearchParams({ path });
  if (activeProjectId) params.set("project", activeProjectId);
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
  const allowedKinds = new Set(["text", "project", "goal-launch", "command"]);
  const kind = allowedKinds.has(message.kind) ? message.kind : "text";
  const artifact = message.artifact && typeof message.artifact === "object"
    ? {
        path: String(message.artifact.path || "").trim(),
        text: String(message.artifact.text || "").trim(),
      }
    : null;
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
  const text = String(message.text || "").trim() || (message.role === "user" && attachments.length ? attachmentOnlyMessage(attachments) : "");
  if (kind === "project" && (!artifact?.text || isPlaceholderProject(artifact.text))) return null;
  if (!text && !(artifact?.path && artifact?.text)) return null;
  return {
    id: String(message.id || newMessageId()).trim(),
    role: message.role,
    kind,
    text,
    created_at: String(message.created_at || new Date().toISOString()),
    ...(String(message.edited_at || "").trim() ? { edited_at: String(message.edited_at || "").trim() } : {}),
    ...(artifact?.path && artifact?.text ? { artifact } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(resumeFromTrial ? { resumeFromTrial } : {}),
  };
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

function setHiddenProjectDraft(text) {
  const editor = $("#project-draft-editor");
  if (editor) editor.value = String(text || "");
  updateProjectDraftPreview();
}

function markdownLinkHtml(label, href) {
  const text = String(label || "").trim();
  const target = String(href || "").trim();
  if (!text || !target) return escapeHtml(text || target);
  if (/^(https?:\/\/|mailto:)/i.test(target)) {
    return `<a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
  }
  const path = repoRelativePath(target);
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

function inlineMarkup(text) {
  return escapeHtml(text)
    .replaceAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, label, href) => markdownLinkHtml(label, href))
    .replaceAll(/`([^`]+)`/g, (_, value) => markdownCodeHtml(value))
    .replaceAll(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function markdownToHtml(text) {
  const lines = String(text || "").split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let list = [];
  let inCode = false;
  let code = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkup(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    html.push(`<ul>${list.map((item) => `<li>${inlineMarkup(item)}</li>`).join("")}</ul>`);
    list = [];
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
    `<${tag}${align && align !== "left" ? ` style="text-align:${align}"` : ""}>${inlineMarkup(cell)}</${tag}>`;
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
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkup(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
      continue;
    }
    paragraph.push(line.trim());
  }

  if (inCode) flushCode();
  flushParagraph();
  flushList();
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
  return `coAutoResearch:${activeProjectId || "default"}:${key}`;
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

function scopedJsonGet(key, fallback = {}) {
  try {
    const raw = scopedGet(key, "", { legacyFallback: false });
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeAgentBackend(value) {
  const backend = String(value || "").trim().toLowerCase();
  return allowedAgentBackends.has(backend) ? backend : defaultAgentSettings.backend;
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
  return raw ? normalizeAgentBackend(raw) : "";
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
  if (status?.message) {
    const label = forced && requested !== effective ? `${agentLabel(effective)} readiness` : `${agentLabel(effective)} readiness`;
    parts.push(`${label}: ${status.message}`);
  }
  return parts.join(" ");
}

function renderAgentStatusNote(selector, backend, scope = "settings") {
  const note = $(selector);
  if (!note) return;
  const effective = effectiveBackend(backend);
  const status = statusForBackend(effective);
  const message = agentStatusText(backend, scope);
  note.textContent = message;
  const tone = agentStatusEnvelope().env_warning ? "warning" : statusTone(status);
  if (tone) note.dataset.tone = tone;
  else delete note.dataset.tone;
}

function renderAllAgentStatusNotes() {
  renderAgentStatusNote("#settings-agent-status", $("#settings-form")?.elements?.settingsBackend?.value || activeSettingsBackend(), "settings");
  renderAgentStatusNote("#launch-agent-status", currentLaunchBackend(), "launch");
  renderAgentStatusNote("#project-agent-backend-note", $("#project-agent-backend")?.value || activeSettingsBackend(), "project");
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

function persistSessionSettings(settings) {
  scopedSet("autoResearchSessionSettings", JSON.stringify(sessionSettingsForStorage(settings)));
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
  if (mode === "light") return defaultThemeMode;
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
    .map((trial) => trialIterationValue(trial))
    .filter((value) => Number.isFinite(value) && value > 0);
  const reportedLatest = Math.max(...trialIterations, 0);
  const sessionIteration = Number(sessionState().loop_iteration || 0);
  const trajectoryNext = Number(appState?.research_session?.trajectory?.next_trial_number || 0);
  const latest = Math.max(reportedLatest, Number.isFinite(sessionIteration) ? sessionIteration : 0);
  if (Number.isFinite(trajectoryNext) && trajectoryNext > latest) return trajectoryNext;
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
        content: "Start autoresearch loop with /goal.",
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

function projectById(projectId) {
  const id = String(projectId || "");
  const projects = Array.isArray(appState?.projects) ? appState.projects : [];
  return projects.find((project) => String(project.id || "") === id) || null;
}

function hasActiveProject() {
  const projects = Array.isArray(appState?.projects) ? appState.projects : [];
  return Boolean(activeProjectId && projects.some((project) => String(project.id || "") === String(activeProjectId)));
}

function hasNoProject() {
  return Boolean(appState?.multi_project && !hasActiveProject());
}

function renderProjectAvailability() {
  const noProject = hasNoProject();
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
    if (element) element.disabled = noProject;
  });
  $$(".material-action-chip, .composer-suggestion-chip").forEach((button) => {
    button.disabled = noProject;
    button.setAttribute("aria-disabled", noProject ? "true" : "false");
  });
  updateResourceImportActionState();
  if (!noProject) return;
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
  const projects = Array.isArray(appState?.projects) ? appState.projects : [];
  if (initialProjectDialogOpened || !appState?.multi_project || projects.length) return;
  initialProjectDialogOpened = true;
  window.setTimeout(() => {
    const dialog = $("#project-dialog");
    if (dialog?.open) return;
    openProjectCreateDialog();
  }, 120);
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
  if (!projects.length) {
    target.innerHTML = `<div class="project-empty">No projects yet. Use + to create one.</div>`;
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
              ${reviewerOutdated ? `<small class="project-warning-line">Reviewer templates outdated</small>` : ""}
            </span>
          </button>
          <button class="project-menu-button" type="button" data-project-menu="${escapeHtml(project.id)}" aria-label="Project options" aria-haspopup="menu" aria-expanded="${menuOpen ? "true" : "false"}">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>
          </button>
          <div class="project-menu-popover" role="menu" data-project-menu-panel="${escapeHtml(project.id)}" ${menuOpen ? "" : "hidden"}>
            ${reviewerOutdated ? `
              <button type="button" role="menuitem" data-project-upgrade-reviewers="${escapeHtml(project.id)}">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>
                <span>Update reviewers</span>
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
  activeColdPath = "";
  coldDirty = false;
  prepareSaved = false;
  projectDraftDirty = false;
  framingDraftPending = false;
  projectDraftEditMode = false;
  editingFramingId = "";
  editingTranscriptId = "";
  lastFramingHtml = "";
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
  const coldEditor = $("#cold-file-editor");
  if (coldEditor) coldEditor.value = "";
  const targetVenue = $("#target-venue");
  if (targetVenue) targetVenue.value = "";
}

async function switchProject(projectId) {
  const next = String(projectId || "").trim();
  if (!next || next === activeProjectId) return;
  activeProjectId = next;
  localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
  resetProjectClientState();
  hydrateTargetVenueField({ force: true });
  restoreSessionSettings();
  restoreResourceSelections();
  restorePendingResourceImports();
  await loadUiSettings();
  await loadOverview(true);
}

async function loadProjects() {
  const payload = await api("/api/projects");
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const known = new Set(projects.map((project) => String(project.id || "")));
  if (!activeProjectId || !known.has(activeProjectId)) {
    activeProjectId = String(payload.active_project_id || projects[0]?.id || "");
    if (activeProjectId) localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
    else localStorage.removeItem("coAutoResearchActiveProject");
  }
  appState = { ...(appState || {}), projects, active_project_id: activeProjectId, multi_project: Boolean(payload.multi_project) };
  renderProjectList();
  renderProjectAvailability();
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
  if (id === activeProjectId) await loadOverview(true);
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
  try {
    const deletingActive = String(pendingDeleteProject.id || "") === String(activeProjectId || "");
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
      await loadOverview(true);
    } else {
      renderProjectAvailability();
      maybeOpenInitialProjectDialog();
    }
    showToast(payload.stopped_active_run ? "Stopped active run and deleted project." : "Project deleted.");
  } catch (error) {
    const note = $("#project-delete-note");
    if (note) {
      note.textContent = error.message;
      note.dataset.tone = "error";
    }
    showToast(error.message, true);
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
    resetProjectClientState();
    appState = {
      ...(appState || {}),
      projects: Array.isArray(payload.projects) ? payload.projects : [],
      active_project_id: activeProjectId,
      multi_project: Boolean(payload.multi_project),
    };
    closeProjectCreateDialog();
    renderProjectList();
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
  if (!activeProjectId && appState?.multi_project) {
    $("#sync-state").textContent = "Create a project";
    renderProjectList();
    renderProjectAvailability();
    maybeOpenInitialProjectDialog();
    return;
  }
  try {
    const holdMaterialTree = activeView === "materials";
    appState = await api("/api/overview");
    if (appState.active_project_id && appState.active_project_id !== activeProjectId) {
      activeProjectId = appState.active_project_id;
      localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
      resetProjectClientState();
      restoreResourceSelections();
      restorePendingResourceImports();
    }
    const session = appState.research_session || {};
    if (framingDraftPending && session.mode === "framing" && !["running", "stopping"].includes(session.status)) {
      framingDraftPending = false;
      reconcileFramingPending(localMessages);
    }
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
    if (!holdMaterialTree) renderContext();
    renderSession();
    scheduleWorkingTicker();
    if (!silent) showToast("Refreshed from repository files.");
  } catch (error) {
    $("#sync-state").textContent = "Could not read files";
    showToast(error.message, true);
  }
}

function scheduleOverviewPoll(delay) {
  clearTimeout(overviewPollTimer);
  overviewPollTimer = setTimeout(async () => {
    if (activeProjectId) await loadOverview(true);
    else await loadProjects().catch((error) => showToast(error.message, true));
    scheduleOverviewPoll(isSessionRunning() || framingDraftPending || framingReplyPending ? 1000 : 3500);
  }, delay);
}

function updateWorkingDurations() {
  $$("[data-working-started-at]").forEach((node) => {
    node.textContent = workingDurationText(node.dataset.workingStartedAt || "");
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
  return ["running", "stopping"].includes(sessionState().status);
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

function agentResumeCommand() {
  const sessionId = String(sessionState().session_id || "").trim();
  if (!sessionId) return "";
  const repoRoot = String(appState?.repo_root || "").trim();
  const backend = sessionBackend();
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
  const command = agentResumeCommand();
  const sessionId = String(sessionState().session_id || "").trim();
  bar.hidden = !command;
  const label = $("#resume-command-label");
  if (label) label.textContent = `Resume in ${agentLabel(sessionBackend())} CLI`;
  text.textContent = sessionId ? `session ${sessionId.slice(0, 8)}` : "";
  text.title = command;
  bar.dataset.command = command;
}

async function copyResumeCommand() {
  const command = agentResumeCommand();
  if (!command) return;
  await copyTextToClipboard(command, `${agentLabel(sessionBackend())} resume command copied.`);
}

async function copyTextToClipboard(text, successMessage = "Copied.") {
  const value = String(text || "");
  if (!value.trim()) return;
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
  } catch (error) {
    showToast("Could not copy text.", true);
  }
}

function hasLaunched() {
  const session = sessionState();
  const mode = String(session.mode || "").toLowerCase();
  return ["goal", "chat", "research", "command"].includes(mode);
}

function hasGoalStarted() {
  const session = sessionState();
  const mode = String(session.mode || "").toLowerCase();
  return ["goal", "research"].includes(mode) || Boolean(session.loop_active) || Number(session.loop_iteration || 0) > 0;
}

function isGoalPassed() {
  const gate = sessionState().gate || {};
  const status = String(gate.status || gate.raw_status || "").trim().toLowerCase();
  return status === "pass" || status === "passed";
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
  const summary = String(wait.last_event_summary || "").trim();
  if (kind === "rate_limited") {
    return `Rate limit reported${ageText ? ` · last event ${ageText} ago` : ""}`;
  }
  if (kind === "idle") {
    return `No agent events${ageText ? ` for ${ageText}` : ""}; process is still running.`;
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
  return `
    ${canPauseActiveRunAfterCurrentTurn() ? `<button class="secondary-button small-button current-run-control-button" type="button" data-pause-autoresearch>Pause after current turn</button>` : ""}
    <button class="secondary-button small-button current-run-control-button" type="button" data-stop-current-run>Stop current run</button>
  `;
}

function canMessage() {
  return hasLaunched() && hasSession() && !isSessionRunning();
}

function canChatWithFramingDraft() {
  const session = sessionState();
  const mode = String(session.mode || "").toLowerCase();
  return mode === "framing" && hasProjectDraftReady() && hasSession() && !isSessionRunning();
}

function canSendSessionComposerMessage() {
  return canMessage() || canChatWithFramingDraft();
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
  if (target === "2") return prepareSaved || hasLaunched();
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
  const editor = $("#project-draft-editor");
  if (editor) return String(editor.value || "");
  return String(appState?.files?.project?.text || "");
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
    String(message?.artifact?.text || "").trim(),
  ].join("\n");
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
    if (!message || message.role !== "user") return false;
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
  return ["ui.framing", "ui.chat"].includes(rawType) && role === "user" && text && !isDefaultBriefTemplate(text);
}

function transcriptFramingMessageId(entry) {
  const id = String(entry?.id || "").trim();
  return id ? `framing-${id.slice(0, 80)}` : "";
}

function isAssistantReplyCandidate(entry, cutWindows) {
  const rawType = String(entry?.raw_type || "").toLowerCase();
  const role = String(entry?.role || "").toLowerCase();
  const content = String(entry?.content || "").trim();
  return (
    content &&
    !isEntryInsideEditedCut(entry, cutWindows) &&
    ["assistant", "final"].includes(role) &&
    ["item.completed", "turn.completed"].includes(rawType)
  );
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
    if (message.role !== "assistant" || message.kind === "project") return true;
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
      if (!message || existingIds.has(message.id) || existingKeys.has(framingMessageDedupeKey(message))) return null;
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

function isGoalLaunchMessage(message) {
  const text = String(message?.text || "").trim().toLowerCase();
  return message?.role === "user" && (
    message.kind === "goal-launch" ||
    text === "start autoresearch." ||
    text === "start autoresearch" ||
    text === "start autoresearch with /goal." ||
    text === "start autoresearch with /goal" ||
    text === "/goal"
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
  if (framingDraftPending || isSessionRunning() || hasGoalStarted() || visibleTrialReports().length) return messages;
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
  if (!framingInProgress && projectText && !isPlaceholderProject(projectText) && appState?.framing?.project_ready) {
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
  if (!hasGoalLaunchMessage(nextMessages) && (hasGoalStarted() || visibleTrialReports().length)) {
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
    exists: true,
    is_dir: false,
    path: "PROJECT.md",
    text,
    kind: "markdown",
    mime: "text/markdown",
    editable: false,
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

function framingMessageHtml(message) {
  if (message.kind === "project" && message.artifact?.text) return projectDraftCardHtml(message);
  if (isControlFramingMessage(message)) return framingControlMessageHtml(message);
  const role = message.role === "user" ? "user" : "assistant";
  const title = role === "user" ? "You" : "CoAutoResearch";
  if (role === "user" && editingFramingId === message.id) {
    return `
      <article class="framing-message ${role} is-editing" data-framing-id="${escapeHtml(message.id)}">
        <div class="transcript-meta">${title}</div>
        ${messageAttachmentsHtml(message)}
        <form class="framing-edit-form" data-framing-edit-form="${escapeHtml(message.id)}">
          <textarea name="message" rows="3">${escapeHtml(message.text)}</textarea>
          <div class="framing-actions">
            <button class="secondary-button small-button" type="button" data-framing-cancel="${escapeHtml(message.id)}">Cancel</button>
            <button class="primary-button small-button" type="submit">Resend</button>
          </div>
        </form>
      </article>
    `;
  }
  const actionItems = [
    messageCopyButton(message.text, `Copy ${role === "user" ? "your" : "CoAutoResearch"} message`),
    role === "user" && !message.resumeFromTrial
      ? `<button class="text-button" type="button" data-framing-edit="${escapeHtml(message.id)}">Edit</button>`
      : "",
  ].filter(Boolean);
  const actions = actionItems.length ? `<div class="framing-actions message-action-row">${actionItems.join("")}</div>` : "";
  return `
    <article class="framing-message ${role}" data-framing-id="${escapeHtml(message.id)}">
      <div class="transcript-meta">${title}</div>
      ${messageAttachmentsHtml(message)}
      <div class="transcript-body">${transcriptContentHtml(message.text, { markdown: role === "assistant" })}</div>
      ${actions}
    </article>
  `;
}

function framingThinkingHtml() {
  const showTrialHistory = isAutoresearchActiveRun();
  if (showTrialHistory) return activeTrialHistoryHtml();

  const status = hasLaunched()
    ? activeRunStatusLabel()
    : isSessionRunning()
      ? "Drafting PROJECT.md"
      : `Starting ${agentLabel(sessionBackend())}`;
  return `
    <article class="framing-message assistant is-thinking" aria-live="polite">
      <div class="transcript-meta">CoAutoResearch</div>
      <div class="transcript-body thinking-bubble">
        <div class="thinking-status-row">
          <span class="thinking-dot"></span>
          <span class="thinking-dot"></span>
          <span class="thinking-dot"></span>
          <strong>${escapeHtml(status)}</strong>
          ${isSessionRunning() ? workingDurationHtml() : ""}
        </div>
        ${framingProgressDetailsHtml()}
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
  if (rawType.includes("reasoning") || kind === "reasoning") {
    return "Reasoning about the project framing.";
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

function currentProgressStartTime(transcript) {
  const sessionStarted = entryTimeValue({ created_at: sessionState().started_at });
  const latestRunStart = transcript.reduce((latest, entry) => {
    if (!transcriptRunStart(entry)) return latest;
    return Math.max(latest, entryTimeValue(entry));
  }, 0);
  const pendingSince = Number(framingPendingSince || 0);
  return Math.max(sessionStarted, latestRunStart, pendingSince);
}

function currentProgressEntries() {
  const session = sessionState();
  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  const progressStart = currentProgressStartTime(transcript);
  return transcript
    .filter((entry) => {
      const role = transcriptRole(entry);
      const content = String(entry?.content || "").trim();
      const rawType = String(entry?.raw_type || "").toLowerCase();
      if (progressStart) {
        const createdAt = entryTimeValue(entry);
        if (createdAt && createdAt < progressStart - 1000) return false;
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
          const collapsible = ["Command", "Tool", "File change"].includes(title) || role === "command" || role === "tool";
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

function framingProgressDetailsHtml() {
  const entries = currentProgressEntries();
  const count = entries.length;
  const latestEntry = latestTrialProgressEntry(entries);
  const latestText = latestEntry
    ? `${framingProgressTitle(latestEntry)}: ${framingProgressContent(latestEntry)}`
    : agentWaitStateText() || "Waiting for agent events...";
  const runControls = runControlButtonsHtml();
  const activityKey = activeRunActivityDetailsKey();
  return `
    <details class="framing-progress-details" data-run-activity-details="${escapeHtml(activityKey)}"${runActivityOpenAttribute(activityKey)}>
      <summary>
        <span>Current run activity</span>
        <span class="current-run-summary">
          ${isSessionRunning() ? workingDurationHtml() : ""}
          <span>${escapeHtml(activeRunScopeLabel())}</span>
          <span>${escapeHtml(compactText(latestText, 180))}</span>
          <strong>${escapeHtml(count ? `${count} event${count === 1 ? "" : "s"}` : "waiting")}</strong>
        </span>
        ${runControls}
      </summary>
      ${framingProgressRowsHtml(entries)}
    </details>
  `;
}

function projectDraftCardHtml(message) {
  const latest = latestProjectMessage();
  const isLatest = latest && latest.id === message.id;
  const canStartGoal = isLatest && !hasGoalStarted();
  const draft = String(message?.artifact?.text || currentProjectDraft());
  cacheProjectDraftInlinePayload(draft);
  const body = projectDraftEditMode && isLatest
    ? `
      <textarea class="project-inline-editor" data-project-inline-editor spellcheck="false">${escapeHtml(draft)}</textarea>
      <div class="project-card-actions">
        <button class="secondary-button small-button" type="button" data-project-edit-cancel>Cancel</button>
        <button class="primary-button small-button" type="button" data-project-edit-save>Save</button>
      </div>
    `
    : `
      <div class="project-rendered markdown-preview">${markdownToHtml(draft)}</div>
      <div class="project-card-actions" ${isLatest ? "" : "hidden"}>
        ${messageCopyButton(draft, "Copy PROJECT.md draft", "PROJECT.md draft copied.")}
        <button class="secondary-button small-button" type="button" data-project-edit> Edit Markdown</button>
        ${canStartGoal ? '<button class="primary-button small-button" type="button" data-project-launch>Start autoresearch</button>' : ""}
      </div>
    `;
  return `
    <article class="framing-message assistant project-draft-message" data-framing-id="${escapeHtml(message.id)}" data-role="assistant" data-kind="project">
      <div class="transcript-meta">CoAutoResearch / PROJECT.md</div>
      <div class="transcript-body project-draft-bubble">
        <div class="project-card-head">
          <div>
            <strong>Project framing draft</strong>
            <span>${isLatest ? "Review the scope before launching autoresearch." : "Earlier draft kept in the conversation history."}</span>
          </div>
          ${fullscreenButtonHtml("PROJECT.md")}
        </div>
        ${body}
      </div>
    </article>
  `;
}

function renderFramingConversation() {
  const thread = $("#framing-thread");
  if (!thread) return;
  const wasNearBottom = isPageNearBottom();
  const visibleMessages = collapseProjectDraftMessages(localMessages);
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
  const sessionTranscript = !localPending && (hasLaunched() || hasLocalTranscript)
    ? sessionTimelineHtml(transcriptEntries, { omittedEntryIds: activity.omittedEntryIds, omitLocal: true })
    : "";
  const shouldShowPending = localPending || (isSessionRunning() && !sessionTranscript);
  const pending = shouldShowPending ? framingThinkingHtml() : "";
  const hasThreadContent = Boolean(messages || sessionTranscript || pending);
  const nextHtml = [messages, pending, sessionTranscript].filter(Boolean).join("");
  if (nextHtml !== lastFramingHtml) {
    const renderedDraft = document.querySelector(".project-rendered");
    if (renderedDraft) projectRenderedScrollTop = renderedDraft.scrollTop;
    rememberTrialStripScroll();
    thread.innerHTML = nextHtml;
    lastFramingHtml = nextHtml;
    requestAnimationFrame(() => {
      const nextRenderedDraft = document.querySelector(".project-rendered");
      if (nextRenderedDraft) {
        nextRenderedDraft.scrollTop = Math.min(projectRenderedScrollTop, nextRenderedDraft.scrollHeight);
      }
      restoreTrialStripScroll();
    });
    if (pending && wasNearBottom) {
      scrollFramingToBottomSoon();
    } else {
      requestAnimationFrame(() => {
        updateBriefDockGeometry();
        updateFramingScrollButton();
      });
    }
  }
  thread.hidden = !hasThreadContent;
  $("#cold-start-workspace")?.classList.toggle("has-framing-thread", hasThreadContent);
  $("#framing-project-panel")?.toggleAttribute("hidden", true);
  $("#open-launch-dialog")?.toggleAttribute("hidden", true);
  $("#open-launch-dialog-inline")?.toggleAttribute("hidden", true);
  syncBriefComposerDock(activeView === "chat" && hasThreadContent);
  renderComposerSuggestions();
  updateFramingScrollButton();
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
}

function updateBriefDockGeometry() {
  const shell = $("#brief-editor-shell");
  const main = $(".main-stage");
  if (!shell || !main || !shell.classList.contains("is-framing-dock")) return;
  const rect = main.getBoundingClientRect();
  const available = Math.max(320, rect.width - 48);
  const width = Math.min(900, available);
  const left = rect.left + rect.width / 2;
  const height = Math.max(88, shell.getBoundingClientRect().height || 0);
  shell.style.setProperty("--brief-dock-left", `${left}px`);
  shell.style.setProperty("--brief-dock-width", `${width}px`);
  shell.style.setProperty("--brief-dock-height", `${height}px`);
  document.documentElement.style.setProperty("--brief-dock-left", `${left}px`);
  document.documentElement.style.setProperty("--brief-dock-width", `${width}px`);
  document.documentElement.style.setProperty("--brief-dock-height", `${height}px`);
  requestAnimationFrame(updateFramingScrollButton);
}

function pageScroller() {
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

function modelOptionsForBackend(backend) {
  return modelOptionsByBackend[normalizeAgentBackend(backend)] || modelOptionsByBackend.codex;
}

function syncModelSelectOptions(select, backend, selected = "") {
  if (!select) return;
  const options = modelOptionsForBackend(backend);
  const value = String(selected || "").trim();
  select.innerHTML = options.map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}">${escapeHtml(label)}</option>`).join("");
  const allowed = new Set(options.map(([optionValue]) => optionValue));
  select.value = allowed.has(value) ? value : defaultSettingsForBackend(backend).model;
}

function settingsFromForm() {
  const form = $("#session-settings-form");
  const data = new FormData(form);
  const backend = normalizeAgentBackend(data.get("backend") || form?.elements?.backend?.value || activeSettingsBackend());
  const permissionPreset = normalizePermissionPreset(data.get("permissionPreset"), { backend });
  const settings = normalizeSessionSettings({
    backend,
    model: String(data.get("model") || "").trim(),
    reasoningEffort: normalizeReasoningEffort(data.get("reasoningEffort"), backend),
    permissionPreset,
    ...permissionPresets[permissionPreset],
    webSearch: Boolean(data.get("webSearch")),
    fastMode: Boolean(data.get("fastMode")),
    extraConfig: String(data.get("extraConfig") || "").trim(),
    reviewCheckpointInterval: normalizeReviewCheckpointInterval(data.get("reviewCheckpointInterval")),
  });
  persistSessionSettings(settings);
  renderSettingsSummary(settings);
  syncComposerSettings(settings);
  renderAllAgentStatusNotes();
  return settings;
}

function syncComposerSettings(settings) {
  const merged = normalizeSessionSettings(settings);
  const backend = normalizeAgentBackend(merged.backend);
  const model = $("#composer-model");
  const reasoning = $("#composer-reasoning");
  syncModelSelectOptions(model, backend, merged.model);
  if (reasoning) reasoning.value = merged.reasoningEffort || defaultSettingsForBackend(backend).reasoningEffort;
}

function updateSessionSettingsFromComposer() {
  const form = $("#session-settings-form");
  const model = $("#composer-model");
  const reasoning = $("#composer-reasoning");
  if (!form || !model || !reasoning) return;
  const backend = normalizeAgentBackend(form.elements.backend?.value || activeSettingsBackend());
  syncModelSelectOptions(form.elements.model, backend, model.value || defaultSettingsForBackend(backend).model);
  form.elements.reasoningEffort.value = normalizeReasoningEffort(reasoning.value, backend);
  settingsFromForm();
}

function normalizeReasoningEffort(value, backend = "") {
  const reasoning = String(value || "").trim();
  return allowedReasoningEfforts.has(reasoning) ? reasoning : defaultSettingsForBackend(backend).reasoningEffort;
}

function normalizeReviewCheckpointInterval(value) {
  const interval = Number(String(value ?? "").trim());
  return Number.isInteger(interval) && interval > 0 ? interval : defaultSessionSettings.reviewCheckpointInterval;
}

function inferPermissionPreset(settings = {}) {
  const backend = normalizeAgentBackend(settings.backend);
  const explicit = String(settings.permissionPreset || "").trim();
  if (allowedPermissionPresets.has(explicit)) return explicit;
  if (backend === "claude") {
    const mode = String(settings.permissionMode || "").trim();
    if (mode === "bypassPermissions") return "full-access";
    if (mode === "auto") return "auto-review";
    return defaultClaudeSessionSettings.permissionPreset;
  }
  const sandbox = String(settings.sandbox || "").trim();
  const approvalPolicy = String(settings.approvalPolicy || "").trim();
  if (sandbox === "danger-full-access" && approvalPolicy === "never") return "full-access";
  if (sandbox === "workspace-write" && approvalPolicy === "never") return "auto-review";
  return defaultSessionSettings.permissionPreset;
}

function normalizePermissionPreset(value, settings = {}) {
  const preset = String(value || "").trim();
  return allowedPermissionPresets.has(preset) ? preset : inferPermissionPreset(settings);
}

function normalizeSessionSettings(settings = {}) {
  const backend = normalizeAgentBackend(settings?.backend || settings?.agent?.backend || activeSettingsBackend());
  const defaults = defaultSettingsForBackend(backend);
  const merged = { ...defaults, ...(settings || {}), backend };
  const allowedModels = new Set(modelOptionsForBackend(backend).map(([value]) => value));
  if (!merged.model || (backend === "codex" && !allowedModels.has(merged.model))) merged.model = defaults.model;
  if (backend === "claude" && !String(merged.model || "").trim()) merged.model = defaults.model;
  merged.reasoningEffort = normalizeReasoningEffort(merged.reasoningEffort, backend);
  merged.reviewCheckpointInterval = normalizeReviewCheckpointInterval(merged.reviewCheckpointInterval);
  merged.fastMode = Boolean(merged.fastMode);
  merged.permissionPreset = normalizePermissionPreset(merged.permissionPreset, merged);
  if (backend === "claude") {
    const modeByPreset = { default: "acceptEdits", "auto-review": "auto", "full-access": "bypassPermissions" };
    merged.permissionMode = modeByPreset[merged.permissionPreset] || defaultClaudeSessionSettings.permissionMode;
    delete merged.sandbox;
    delete merged.approvalPolicy;
  } else {
    Object.assign(merged, permissionPresets[merged.permissionPreset]);
  }
  if (backend === "codex" && !allowedApprovalPolicies.has(merged.approvalPolicy)) {
    Object.assign(merged, permissionPresets[defaultSessionSettings.permissionPreset]);
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
  form.elements.reasoningEffort.value = merged.reasoningEffort;
  form.elements.permissionPreset.value = merged.permissionPreset;
  form.elements.webSearch.checked = Boolean(merged.webSearch);
  if (form.elements.fastMode) form.elements.fastMode.checked = Boolean(merged.fastMode);
  form.elements.extraConfig.value = merged.extraConfig || "";
  if (form.elements.reviewCheckpointInterval) form.elements.reviewCheckpointInterval.value = merged.reviewCheckpointInterval;
  if (persist) persistSessionSettings(merged);
  renderSettingsSummary(merged);
  syncComposerSettings(merged);
  renderAllAgentStatusNotes();
}

function switchSessionBackend(backend) {
  const normalized = normalizeAgentBackend(backend);
  const scoped = scopedSessionSettings();
  applySessionSettings({
    ...providerSettingsFromUi(normalized),
    ...providerSettingsFromScoped(scoped, normalized),
    backend: normalized,
  }, true);
}

function restoreSessionSettings() {
  applySessionSettings(mergedProjectSessionSettings(uiSettings || {}));
}

function settingsLabel(settings) {
  const normalized = normalizeSessionSettings(settings || defaultSessionSettings);
  const parts = [];
  parts.push(agentLabel(normalized.backend));
  if (normalized.model) parts.push(normalized.model);
  parts.push(labelForReasoning(normalized.reasoningEffort));
  parts.push(permissionPresets[normalized.permissionPreset]?.label || "Default permissions");
  if (normalized.fastMode) parts.push("fast");
  parts.push(`review ${normalized.reviewCheckpointInterval}`);
  if (normalized.webSearch) parts.push("web");
  return parts.join(" / ");
}

function labelForReasoning(value) {
  const labels = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high" };
  return labels[normalizeReasoningEffort(value)] || "Medium";
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

function settingsProviderFromModal(backend) {
  const form = $("#settings-form");
  const data = new FormData(form);
  const normalizedBackend = normalizeAgentBackend(backend);
  const permissionPreset = normalizePermissionPreset(data.get("settingsPermissionPreset"), { backend: normalizedBackend });
  return normalizeSessionSettings({
    backend: normalizedBackend,
    model: String(data.get("settingsModel") || "").trim(),
    reasoningEffort: normalizeReasoningEffort(data.get("settingsReasoningEffort"), normalizedBackend),
    permissionPreset,
    ...permissionPresets[permissionPreset],
    webSearch: Boolean(data.get("settingsWebSearch")),
    extraConfig: String(data.get("settingsExtraConfig") || "").trim(),
    reviewCheckpointInterval: normalizeReviewCheckpointInterval(data.get("settingsReviewCheckpointInterval")),
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
  form.elements.settingsReasoningEffort.value = provider.reasoningEffort;
  form.elements.settingsPermissionPreset.value = provider.permissionPreset;
  form.elements.settingsWebSearch.checked = Boolean(provider.webSearch);
  form.elements.settingsExtraConfig.value = provider.extraConfig || "";
  if (form.elements.settingsReviewCheckpointInterval) form.elements.settingsReviewCheckpointInterval.value = provider.reviewCheckpointInterval;
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
                ? `<button class="settings-clear-button" type="button" data-clear-secret="${escapeHtml(key)}">Clear</button>`
                : `<span class="secret-status">Empty</span>`
            }
          </span>
          <input name="env_${escapeHtml(key)}" type="${inputType}" placeholder="${saved ? "Saved - leave blank to keep" : "Paste value"}" autocomplete="off" />
          <span class="settings-secret-help">${escapeHtml(secretKeyHelp[key] || "Passed to selected agent subprocesses.")}</span>
        </label>
      `;
    })
    .join("");
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
      const payload = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ ...settingsPayload, env, clear_env: clearEnv }),
      });
      uiSettings = payload.settings || {};
      settingsSecretKeys = payload.secret_keys || settingsSecretKeys;
      hydrateSettingsDialog(uiSettings);
      applySessionSettings(mergedProjectSessionSettings(uiSettings), true);
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
  applySessionSettings(mergedProjectSessionSettings(uiSettings), true);
  showToast(`${secretKeyLabels[key] || key} cleared.`);
}

function setPanel(panel) {
  if (appState && visiblePanels()[panel] === false) {
    showToast(`${panelTitles[panel] || panel} has no content yet.`);
    return;
  }
  activeView = panel === "chat" ? "chat" : "materials";
  if (panel !== "chat") activePanel = panel;

  renderRailVisibility();

  if (activeView === "chat") {
    renderFramingConversation();
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
    const resourceBlocked = hasBlockingResourceImports();
    const blockedAgent = launchBlockingStatus();
    launchButton.disabled = locked || isSessionRunning() || gatePassed || resourceBlocked || Boolean(blockedAgent);
    launchButton.textContent = gatePassed ? "Reviewer gates passed" : launched ? "Continue autoresearch" : "Start autoresearch";
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
  textarea.disabled = !canMessage();
  send.disabled = !canMessage() || resourceBlocked;
  cont.disabled = !canMessage() || resourceBlocked;
  textarea.placeholder = canMessage() ? "Message the current agent session..." : "Run cold start before messaging...";
  renderComposerSuggestions();
  renderChatSummary();
}

function coldComposerPlaceholder(hasFramingThread) {
  if (hasLaunched()) {
    return "Message the agent about the current research, ask for status, attach resources, or steer the next step...";
  }
  return hasFramingThread
    ? "Ask the agent to revise PROJECT.md, narrow the scope, change the target venue, or add constraints..."
    : "Research topic, problem, scope, and data or materials to use...";
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
        ${payload.gate_summary ? `<p class="status-note">${escapeHtml(payload.gate_summary)}</p>` : ""}
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

function visibleTrialReports() {
  return (appState?.trials || [])
    .filter((trial) => hasVisibleTrial(trial) && trial?.is_archived !== true && String(trial.report_path || "").trim())
    .filter((trial) => !/^0*_?project_conversion/i.test(String(trial.id || "")))
    .sort((a, b) => trialIterationValue(a) - trialIterationValue(b) || String(a.id || "").localeCompare(String(b.id || "")));
}

function reportForIteration(iteration) {
  const target = Number(iteration || 0);
  return visibleTrialReports().find((trial) => trialIterationValue(trial) === target) || null;
}

function currentTrialIndex(trials = visibleTrialReports()) {
  const loopIteration = activeRunTrialIteration();
  const items = Array.isArray(trials) ? trials : visibleTrialReports();
  const iterations = items.map((trial) => Number(trial.iteration || trialIterationValue(trial) || 0)).filter(Boolean);
  const latest = Math.max(...iterations, 0);
  return Math.max(latest, 1);
}

function selectedTrial(trials = visibleTrialReports()) {
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
  return rawType === "ui.goal" || content.includes("start autoresearch loop with /goal") || content.includes("continue autoresearch loop");
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
    if (currentIteration > explicit && isCodexRuntimeEntry(entry)) return currentIteration;
    return explicit;
  }
  if (startsGoalIteration(entry)) return Math.max(1, currentIteration + 1);
  if ((hasGoalStarted() || visibleTrialReports().length > 0) && isCodexRuntimeEntry(entry)) {
    return Math.max(1, currentIteration || currentTrialIndex());
  }
  return currentIteration;
}

function trialReportSummaryHtml(iteration, entries, reportOverride = null) {
  const report = reportOverride || reportForIteration(iteration);
  const finalEntry = [...entries].reverse().find((entry) => ["final", "assistant"].includes(transcriptRole(entry)) && String(entry.content || "").trim());
  const fallback = finalEntry ? compactText(finalEntry.content, 260) : "";
  const reportSummary = cleanText(report?.report_summary, "");
  const summary = reportSummary || fallback || (report ? "Summary is not available yet." : "Report is not available yet. Agent activity for this trial is shown below.");
  const reportStatus = cleanText(report?.status, "");
  const running = isTrialLive(iteration, report);
  const status = running ? "running" : reportStatus === "reported" ? "completed" : reportStatus || (report ? "completed" : "active");
  const latestCompletedIteration = currentTrialIndex();
  const marksAutoresearchComplete = isGoalPassed() && Number(iteration) === Number(latestCompletedIteration);
  return `
    <article class="trial-report-card ${running ? "is-running" : report ? "is-complete" : "is-pending"}" data-trial-panel="${escapeHtml(iteration)}">
      <div class="trial-report-head">
        <div>
          <strong>Trial ${escapeHtml(iteration)}</strong>
          <em>${escapeHtml(status)}</em>
          ${marksAutoresearchComplete ? `<em class="is-autoresearch-complete">Autoresearch complete</em>` : ""}
        </div>
        <span>${report ? `${escapeHtml(report.id)} / ${escapeHtml(report.report_path)}` : "Report pending"}</span>
      </div>
      <p>${escapeHtml(summary)}</p>
      <div class="trial-report-actions">
        ${report?.report_path && !running ? `<button class="secondary-button small-button" type="button" data-trial-continue="${escapeHtml(iteration)}">Continue from this trial</button>` : ""}
        ${report?.report_path ? `<button class="secondary-button small-button" type="button" data-inline-fullscreen="${escapeHtml(report.report_path)}">Open report</button>` : ""}
        ${report?.review_path ? `<button class="secondary-button small-button" type="button" data-inline-fullscreen="${escapeHtml(report.review_path)}">Open review</button>` : ""}
      </div>
      ${
        entries.length
          ? `<details class="trial-detail-activity">
              <summary>
                <span>Trial activity</span>
                <strong>${escapeHtml(entries.length)} event${entries.length === 1 ? "" : "s"}</strong>
              </summary>
              <div class="trial-detail-events">${transcriptEntriesHtml(entries)}</div>
            </details>`
          : ""
      }
    </article>
  `;
}

function latestTrialProgressEntry(entries) {
  const candidates = [...(entries || [])].reverse().filter((entry) => {
    const role = transcriptRole(entry);
    const rawType = String(entry?.raw_type || "").toLowerCase();
    return role !== "user" && rawType !== "turn.completed" && String(entry?.content || "").trim();
  });
  return candidates.find((entry) => ["Error", "Done", "Update", "File change"].includes(framingProgressTitle(entry))) || candidates[0] || null;
}

function runningTrialStatusHtml(trial) {
  const iteration = Number(trial?.iteration || activeRunTrialIteration() || 0);
  if (!iteration || !isTrialLive(iteration)) return "";
  const entries = Array.isArray(trial?.entries) ? trial.entries : [];
  const report = trial?.report || reportForIteration(iteration);
  const reportSummary = cleanText(report?.report_summary, "");
  const latestEntry = latestTrialProgressEntry(entries);
  const latestText = latestEntry
    ? `${framingProgressTitle(latestEntry)}: ${framingProgressContent(latestEntry)}`
    : reportSummary || agentWaitStateText() || "Waiting for agent events...";
  const eventLabel = entries.length ? `${entries.length} event${entries.length === 1 ? "" : "s"}` : "waiting";
  const actions = [
    report?.report_path ? `<button class="secondary-button small-button" type="button" data-inline-fullscreen="${escapeHtml(report.report_path)}">Open report</button>` : "",
    report?.review_path ? `<button class="secondary-button small-button" type="button" data-inline-fullscreen="${escapeHtml(report.review_path)}">Open review</button>` : "",
  ].filter(Boolean).join("");
  return `
    <section class="trial-live-status" aria-live="polite">
      <div class="trial-live-status-head">
        <div class="thinking-status-row trial-live-status-title">
          <span class="thinking-dot"></span>
          <span class="thinking-dot"></span>
          <span class="thinking-dot"></span>
          <strong>${escapeHtml(activeRunStatusLabel())}</strong>
          ${workingDurationHtml()}
        </div>
        <div class="trial-live-status-actions">
          <span>${escapeHtml(eventLabel)}</span>
          ${runControlButtonsHtml()}
        </div>
      </div>
      ${agentWaitStateHtml() || `<p>${escapeHtml(compactText(latestText, 240))}</p>`}
      ${actions ? `<div class="trial-report-actions">${actions}</div>` : ""}
      ${
        entries.length
          ? `<details class="trial-live-details">
              <summary>
                <span>Live trial activity</span>
                <strong>${escapeHtml(eventLabel)}</strong>
              </summary>
              <div class="trial-detail-events">${transcriptEntriesHtml(entries)}</div>
            </details>`
          : ""
      }
    </section>
  `;
}

function clampTrialStripScrollLeft(strip, value) {
  const requested = Math.max(0, Number(value) || 0);
  const max = Math.max(0, Number(strip?.scrollWidth || 0) - Number(strip?.clientWidth || 0));
  return max ? Math.min(requested, max) : requested;
}

function rememberTrialStripScroll(strip = document.querySelector(".trial-strip-scroll")) {
  if (!strip) return;
  trialStripScrollLeft = clampTrialStripScrollLeft(strip, strip.scrollLeft);
}

function restoreTrialStripScroll() {
  const strip = document.querySelector(".trial-strip-scroll");
  if (!strip) return;
  strip.scrollLeft = clampTrialStripScrollLeft(strip, trialStripScrollLeft);
  strip.addEventListener("scroll", () => rememberTrialStripScroll(strip), { passive: true });
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
            const reportStatus = cleanText(report?.status, "");
            const running = isTrialLive(iteration, report);
            const label = running ? "Running" : reportStatus === "reported" ? "Done" : reportStatus || (report ? "Done" : "Active");
            const title = report ? cleanText(report.id, `Trial ${iteration}`) : `Trial ${iteration}`;
            const active = Number(iteration) === Number(activeTrial);
            const summary = report ? cleanText(report.report_summary, title) : title;
            return `
              <button class="trial-chip ${active ? "is-active" : ""} ${running ? "is-running" : ""}" type="button" data-trial-select="${escapeHtml(iteration)}" title="${escapeHtml(compactText(summary, 180))}">
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
  const selectedLabel = activeTrial ? `Trial ${activeTrial}` : "No trial selected";
  const reportedCount = trials.filter((trial) => trial.report?.report_path).length;
  const countLabel = `${trials.length} trial${trials.length === 1 ? "" : "s"}${reportedCount ? ` · ${reportedCount} reported` : ""}`;
  const latest = trials[trials.length - 1];
  const latestReport = latest?.report?.id ? cleanText(latest.report.id, "") : "";
  const activeTrialIsRunning = runningTrialData
    && activeTrialData
    && Number(runningTrialData.iteration) === Number(activeTrialData.iteration);
  const shouldShowActiveTrialReport = activeTrialData && !activeTrialIsRunning;
  return `
    <section class="trial-history-card" aria-label="Autoresearch trials">
      <header class="trial-history-head">
        <div>
          <strong>Trials</strong>
          <span>${escapeHtml(countLabel)} · ${escapeHtml(selectedLabel)}</span>
          ${autoresearchCompleteBadgeHtml()}
          ${reportedCount ? `<button class="secondary-button small-button" type="button" data-inline-fullscreen="manuscript/BLUEPRINT.md">Open latest manuscript</button>` : ""}
        </div>
        ${latestReport ? `<p>Latest: ${escapeHtml(latestReport)}</p>` : ""}
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

function workingDurationText(startedAt = activeRun().started_at || sessionState().started_at) {
  const start = Date.parse(String(startedAt || ""));
  if (!Number.isFinite(start) || start <= 0) return "Working";
  return `Working for ${formatWorkedDuration((Date.now() - start) / 1000)}`;
}

function workingDurationHtml(startedAt = activeRun().started_at || sessionState().started_at) {
  const started = String(startedAt || "");
  return `<span class="working-duration" data-working-started-at="${escapeHtml(started)}">${escapeHtml(workingDurationText(started))}</span>`;
}

function workedDurationLabel(userEntry, entries) {
  const start = entryTimeValue(userEntry);
  const end = entries.reduce((latest, entry) => Math.max(latest, entryTimeValue(entry)), start);
  if (!start || !end || end < start) return "Worked";
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
  return role === "user" && ["ui.framing", "ui.chat", "ui.research", "ui.goal"].includes(rawType);
}

function normalizedTranscriptText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function transcriptRunGroups(entries) {
  const groups = [];
  let current = null;
  entries.forEach((entry) => {
    if (transcriptRunStart(entry)) {
      current = { userEntry: entry, entries: [] };
      groups.push(current);
      return;
    }
    if (current) current.entries.push(entry);
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
  if (!entries.length && !visibleTrialReports().length && !activeRunTrialIteration()) return "";
  const omittedEntryIds = options.omittedEntryIds || new Set();
  const trialGroups = new Map();
  let currentIteration = 0;
  const hasTrialContext = hasLaunched() || hasGoalStarted() || visibleTrialReports().length > 0;
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

  const reports = visibleTrialReports();
  const liveIteration = isLiveGoalSession() ? activeRunTrialIteration() : 0;
  const reportByIteration = new Map(reports.map((report) => [trialIterationValue(report), report]));
  const iterationValues = new Set([
    ...reports.map((report) => trialIterationValue(report)).filter(Boolean),
    ...Array.from(trialGroups.keys()).filter(Boolean),
  ]);
  if (liveIteration) iterationValues.add(liveIteration);
  const trials = Array.from(iterationValues)
    .sort((a, b) => a - b)
    .map((iteration) => ({
      iteration,
      entries: trialGroups.get(iteration) || [],
      report: reportByIteration.get(iteration) || null,
    }));
  const activeTrial = liveIteration || selectedTrial(trials);
  const activeTrialData = trials.find((trial) => Number(trial.iteration) === Number(activeTrial));
  const runningTrialData = liveIteration ? trials.find((trial) => isTrialLive(trial.iteration)) : null;
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

function isCollapsibleToolEntry(entry) {
  const role = transcriptRole(entry);
  return (role === "tool" || role === "command") && !parseFileChangeInfo(String(entry?.content || ""));
}

function toolGroupKind(entry) {
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
  return `
    <article class="transcript-message tool is-tool-group">
      <details class="tool-group-event">
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
  const editable = Boolean(entry?.editable) && role === "user" && canMessage();
  const isEditing = editingTranscriptId === id;
  const meta = transcriptMeta(entry);
  const fileChange = parseFileChangeInfo(content);
  const statusPayload = isUiCommandResult(entry) ? parseStatusCardPayload(content) : null;
  if (isEditing) {
    return `
      <article class="transcript-message ${role} is-editing" data-transcript-id="${escapeHtml(id)}">
        <div class="transcript-meta">${escapeHtml(meta || "Edit message")}</div>
        <form class="transcript-edit-form" data-transcript-edit-form="${escapeHtml(id)}">
          <textarea name="message" rows="4">${escapeHtml(content)}</textarea>
          <div class="transcript-actions">
            <button class="text-button" type="button" data-transcript-cancel="${escapeHtml(id)}">Cancel</button>
            <button class="primary-button" type="submit">Resend</button>
          </div>
        </form>
      </article>
    `;
  }
  if (statusPayload) {
    return statusCardHtml(statusPayload, entry);
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
    messageCopyButton(content, `Copy ${role === "user" ? "your" : "transcript"} message`),
    editable ? `<button class="text-button" type="button" data-transcript-edit="${escapeHtml(id)}">Edit</button>` : "",
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
  const value = repoRelativePath(path);
  if (!value || value.includes("*")) return "";
  return `<button class="secondary-button small-button" type="button" data-inline-fullscreen="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
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

function renderReviewsPanel() {
  const reviews = (appState.reviews || []).filter(hasVisibleReview).sort((a, b) => reviewSortKey(a).localeCompare(reviewSortKey(b)));
  if (!reviews.length) return empty("No review files yet.");
  return `
    <section class="reviews-panel">
      ${reviews
        .map((review) => {
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
                  <h3>${escapeHtml(reviewDisplayTitle(review))}</h3>
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
        })
        .join("")}
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

function normalizeFieldLabel(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/:$/, "");
}

function markdownFieldValue(body, label) {
  const target = normalizeFieldLabel(label);
  const values = [];
  let collecting = false;
  for (const rawLine of String(body || "").replaceAll(/\r\n/g, "\n").split("\n")) {
    const trimmed = rawLine.trim();
    const line = trimmed.replace(/^[-*]\s+/, "");
    const match = line.match(/^([^:]{2,90}):\s*(.*)$/);
    if (match) {
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

function paragraphPlanHtml(section) {
  const plan = manuscriptFieldValue(section, ["Paragraph plan", "Paragraph-level plan", "Writing plan"]);
  if (!hasRealText(plan)) return "";
  return `
    <div class="paragraph-plan-block">
      <h5>Paragraph plan</h5>
      <div class="markdown-preview">${markdownToHtml(plan)}</div>
    </div>
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
          .map((section) => {
            const caption = manuscriptFieldValue(section, ["Caption draft or current caption", "Caption draft", "Caption"]);
            const sourcePath = firstArtifactPath([
              manuscriptFieldValue(section, ["Source artifact path", "Source artifact", "Artifact path"]),
              section.body,
            ].filter(Boolean).join("\n"));
            return `
              <article class="table-plan-row">
                <header class="paper-section-head">
                  <p>Table blueprint</p>
                  <h4>${escapeHtml(cleanText(section.title, "Untitled table"))}</h4>
                </header>
                ${manuscriptActionsHtml([
                  copyButton([`### ${section.title}`, section.body].join("\n\n"), "Copy table", "Table content copied."),
                  caption ? copyButton(caption, "Copy caption", "Caption copied.") : "",
                  sourcePath ? inlineOpenButton(sourcePath, "Open source") : "",
                ])}
                <div class="markdown-preview">${markdownToHtml(section.body)}</div>
              </article>
            `;
          })
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

function renderArchitectureOverview(manuscript) {
  const toc = cleanText(manuscript.toc, "");
  if (hasRealText(toc)) {
    return `<div class="markdown-preview architecture-overview">${markdownToHtml(toc)}</div>`;
  }
  const blocks = (manuscript.architecture || manuscript.sections || []).filter(sectionHasRealContent);
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

function architectureFieldGridHtml(block) {
  const fields = [
    ["Target-venue role", manuscriptFieldValue(block, ["Target-venue role", "Narrative role in target venue", "Section role"])],
    ["Reader question", manuscriptFieldValue(block, ["Reader question answered", "Reader question"])],
    ["Local thesis / purpose", manuscriptFieldValue(block, ["Local thesis / purpose", "Section thesis", "Thesis", "Purpose"])],
    ["Local claims", manuscriptFieldValue(block, ["Local claims in plain language", "Accepted claims", "Claims"])],
    ["Evidence / results / artifacts", manuscriptFieldValue(block, ["Local evidence, results, or artifacts", "Evidence", "Results / artifacts", "Results or artifacts"])],
    ["Placed objects", manuscriptFieldValue(block, ["Placed displays / methods / results", "Figures / tables", "Displays / methods / results"])],
    ["Qualifications", manuscriptFieldValue(block, ["Local qualifications", "Required qualifications", "Required qualification"])],
    ["Transition", manuscriptFieldValue(block, ["Transition job"])],
  ].filter(([, value]) => hasRealText(value));
  if (!fields.length) return "";
  return `
    <dl class="paper-field-grid architecture-field-grid">
      ${fields
        .map(([label, value]) => `
          <div>
            <dt>${escapeHtml(label)}</dt>
            <dd><div class="markdown-preview">${markdownToHtml(value)}</div></dd>
          </div>
        `)
        .join("")}
    </dl>
  `;
}

function artifactKindLabel(kind) {
  const value = String(kind || "").toLowerCase();
  if (value === "figure") return "Figure";
  if (value === "table") return "Table";
  if (value === "algorithm") return "Algorithm / method";
  if (value === "result") return "Dataset / benchmark / result";
  return "Artifact";
}

function manuscriptArtifactCardHtml(block) {
  const kind = artifactKindLabel(block.kind);
  const status = manuscriptFieldValue(block, ["Inclusion status", "Status"]);
  const placement = manuscriptFieldValue(block, ["Placement"]);
  const role = manuscriptFieldValue(block, ["Purpose or result role", "Argument or result role", "Purpose"]);
  const caption = manuscriptFieldValue(block, ["Caption draft or current caption", "Caption draft", "Caption"]);
  const sourcePath = firstArtifactPath([
    manuscriptFieldValue(block, ["Source artifact or spec path", "Source artifact path", "Source code or artifact links", "Source artifact"]),
    block.body,
  ].filter(Boolean).join("\n"));
  const details = [
    ["Placement", placement],
    ["Purpose / role", role],
    ["Content", manuscriptFieldValue(block, ["Content and panel layout", "Columns, rows, or comparison logic", "Pseudocode / interface sketch", "Metric or result summary"])],
    ["Evidence / basis", manuscriptFieldValue(block, ["Result shown or conceptual basis", "Key result or conceptual contrast shown", "Validation evidence", "Manuscript claim supported in plain language"])],
    ["Provenance", manuscriptFieldValue(block, ["Provenance links", "Source links"])],
    ["Target-venue fit", manuscriptFieldValue(block, ["Target-venue fit rationale"])],
    ["Remaining blocker", manuscriptFieldValue(block, ["Remaining blocker"])],
  ].filter(([, value]) => hasRealText(value));
  return `
    <article class="manuscript-artifact-card artifact-${escapeHtml(String(block.kind || "artifact"))} depth-${Math.max(3, Math.min(6, Number(block.level || 3)))}">
      <header class="figure-spec-head">
        <div>
          <p>${escapeHtml(kind)} block</p>
          <h4>${escapeHtml(cleanText(block.title, "Untitled artifact"))}</h4>
        </div>
        ${status ? `<span class="figure-status ${figureSpecStatusClass(status)}">${escapeHtml(figureSpecExcerpt(status, 90))}</span>` : ""}
      </header>
      ${manuscriptActionsHtml([
        copyButton([`${"#".repeat(Number(block.level || 4))} ${block.title}`, block.body].join("\n\n"), "Copy block", "Artifact block copied."),
        caption ? copyButton(caption, "Copy caption", "Caption copied.") : "",
        sourcePath ? inlineOpenButton(sourcePath, "Open source") : "",
      ])}
      ${caption ? `<blockquote class="figure-caption">${inlineMarkup(figureSpecExcerpt(caption, 520))}</blockquote>` : ""}
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
  const paragraphPlan = paragraphPlanHtml(block);
  const fieldGrid = architectureFieldGridHtml(block);
  const fallback = fieldGrid || paragraphPlan ? "" : `<div class="markdown-preview">${markdownToHtml(block.body)}</div>`;
  return `
    <article class="paper-section-row architecture-section-row depth-${Math.max(3, Math.min(6, Number(block.level || 3)))}">
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
  const blocks = (manuscript.architecture || []).filter(sectionHasRealContent);
  if (blocks.length) {
    return `<section class="manuscript-architecture">${blocks.map(manuscriptArchitectureBlockHtml).join("")}</section>`;
  }
  return renderPaperOutline(manuscript);
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

function renderManuscriptPanel() {
  const manuscript = appState.summaries?.manuscript || {};
  const blueprintViewer = `
    <div class="card-inline-file is-open" data-inline-file="manuscript/BLUEPRINT.md" data-autoload-file="manuscript/BLUEPRINT.md" data-compact-inline="true">
      <div class="tree-empty">Loading blueprint...</div>
    </div>
  `;
  return [
    contextCard("Architecture overview", renderArchitectureOverview(manuscript), "Full target-venue table of contents for the planned manuscript."),
    contextCard("Manuscript architecture", renderManuscriptArchitecture(manuscript), "Self-contained section order with local claims, evidence, displays, methods, results, and captions where they belong."),
    contextCard("Audit / provenance", renderManuscriptAuditPanel(manuscript), "Secondary links and legacy indexes; not the primary reading path.", inlineOpenButton("manuscript/figures/FIGURE_SPECS.md", "Open specs")),
    contextCard("Missing evidence", list(manuscript.missing_evidence, "No evidence gaps recorded yet.")),
    contextCard("Current manuscript file", blueprintViewer, "Raw BLUEPRINT.md for editing and audit.", `<button class="secondary-button small-button" type="button" data-inline-fullscreen="manuscript/BLUEPRINT.md">Open latest manuscript</button>`),
  ].join("");
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
  if (activePanel === "workspace") content.innerHTML = renderWorkspacePanel();
  if (activePanel === "resources") content.innerHTML = renderResourcesPanel();
  if (activePanel === "trials") content.innerHTML = renderTrialsPanel();
  if (activePanel === "reviews") content.innerHTML = renderReviewsPanel();
  if (activePanel === "manuscript") content.innerHTML = renderManuscriptPanel();
  autoloadInlineFiles(content);
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

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let amount = bytes;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
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
  $("#cold-file-editor")?.focus();
  if (selectedResumeTrialContext) showToast(`Ready to continue from ${resumeTrialLabel(selectedResumeTrialContext)}. Add instructions, then send.`);
}

function clearResumeTrialContext() {
  selectedResumeTrialContext = null;
  renderAttachmentTrays();
  renderComposerSuggestions();
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
  const label = `${resourceLabel(item.category)} · ${isLink ? item.alreadyImported ? "copied" : "linked" : "upload"}`;
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

function showMaterialTypeDialog() {
  const dialog = $("#material-type-dialog");
  if (!dialog) return showResourceBrowser();
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeMaterialTypeDialog() {
  const dialog = $("#material-type-dialog");
  if (!dialog) return;
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
}

function chooseMaterialType(category) {
  setResourceCategory(category);
  closeMaterialTypeDialog();
  showResourceBrowser();
}

function openComposerFilePicker(category = "user_input") {
  const input = $("#composer-file-input");
  if (!input) return;
  input.dataset.resourceCategory = resourceCategories[category] ? category : "user_input";
  input.click();
}

function updateSelectedResourceCategory(index, category) {
  const item = selectedResourceItems[Number(index)];
  if (!item || !resourceCategories[category]) return;
  item.category = category;
  saveResourceSelections();
  renderSelectedResources();
}

function showResourceBrowser() {
  const dialog = $("#resource-browser");
  if (!dialog) return;
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
  loadLocalBrowser(localBrowserPath);
}

function closeResourceBrowser() {
  const dialog = $("#resource-browser");
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
  renderBrowserRoots(payload.roots || []);
  localBrowserPath = payload.path || "";
  $("#browser-current-path").textContent = localBrowserPath;
  $("#browser-up").disabled = !payload.parent;
  $("#browser-up").dataset.browserParent = payload.parent || "";
  $("#browser-add-current").dataset.resourceAddPath = localBrowserPath;
  $("#browser-note").textContent = payload.truncated
    ? "Showing the first files in this folder. Choose a more specific folder if needed."
    : `Selected material will be attached as ${resourceLabel(activeResourceCategory)}. Folders are symlinked when possible; files are copied into this repo.`;

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
      return `
        <div class="browser-entry-row">
          <button class="browser-entry-main" type="button" data-browser-open="${escapeHtml(entry.path)}" data-browser-type="${escapeHtml(entry.type)}">
            <span class="browser-entry-icon" aria-hidden="true">${isDir ? "DIR" : "FILE"}</span>
            <span>
              <strong>${escapeHtml(entry.name)}</strong>
              <small>${escapeHtml(entry.path)}</small>
            </span>
          </button>
          <button class="mini-button" type="button" data-resource-add-path="${escapeHtml(entry.path)}">Use</button>
        </div>
      `;
    })
    .join("");
}

async function loadLocalBrowser(path = "", options = {}) {
  const { keepSearch = false } = options;
  const entries = $("#browser-entries");
  entries.innerHTML = `<div class="tree-empty">Loading local files...</div>`;
  if (!keepSearch) {
    browserSearchQuery = "";
    const search = $("#browser-search");
    if (search) search.value = "";
  }
  try {
    const params = new URLSearchParams({ path: path || "" });
    if (browserSearchQuery.trim()) params.set("q", browserSearchQuery.trim());
    const payload = await api(`/api/local/browse?${params.toString()}`);
    renderBrowserEntries(payload);
  } catch (error) {
    entries.innerHTML = `<div class="tree-empty">${escapeHtml(error.message)}</div>`;
    showToast(error.message, true);
  }
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
    return `<div class="markdown-preview inline-preview">${markdownToHtml(text)}</div>`;
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

async function loadInlineFile(path, container, compact = false) {
  try {
    const payload = await api(`/api/file?path=${encodeURIComponent(path)}`);
    if (!payload.exists || payload.is_dir) {
      container.innerHTML = `<div class="tree-empty">${escapeHtml(payload.error || "File not found.")}</div>`;
      return;
    }
    inlineFiles[payload.path || path] = payload.text || "";
    inlineFilePayloads[payload.path || path] = payload;
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
    container.innerHTML = inlineEditorHtml(payload, container.dataset.compactInline === "true");
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
  fileViewerResizeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    width: rect.width,
    height: rect.height,
  };
  handle.setPointerCapture?.(event.pointerId);
  document.body.classList.add("is-resizing-file-viewer");
}

function updateFileViewerResize(event) {
  if (!fileViewerResizeState) return;
  event.preventDefault();
  const dialog = $("#file-viewer-dialog");
  if (!dialog) return;
  const size = clampFileViewerSize(
    fileViewerResizeState.width + event.clientX - fileViewerResizeState.startX,
    fileViewerResizeState.height + event.clientY - fileViewerResizeState.startY
  );
  dialog.style.width = `${size.width}px`;
  dialog.style.height = `${size.height}px`;
}

function finishFileViewerResize(event) {
  if (!fileViewerResizeState) return;
  const dialog = $("#file-viewer-dialog");
  const handle = event?.target?.closest?.("[data-file-viewer-resize]") || document.querySelector("[data-file-viewer-resize]");
  try {
    handle?.releasePointerCapture?.(fileViewerResizeState.pointerId);
  } catch (error) {
    // Pointer capture may already be gone if the drag ended outside the dialog.
  }
  fileViewerResizeState = null;
  document.body.classList.remove("is-resizing-file-viewer");
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
  if (!payload?.exists || payload?.is_dir) {
    showToast(payload?.error || "File not found.", true);
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
  body.innerHTML = inlineEditorHtml(payload, false);
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
  }
  fileViewerReturnPath = "";
  updateFileViewerReturnAction("");
}

function filesFromApiResponse(payload) {
  return payload?.result?.files || payload?.files || payload?.result?.result?.files || {};
}

function notifyResourceHandlingFromResponse(payload) {
  const files = filesFromApiResponse(payload);
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
  const links = [
    ...selectedResourceItems,
    ...sentFramingResourceItems,
    ...localMessages.flatMap((message) => (message.attachments || []).filter((item) => item.kind === "link")),
  ];
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

async function collectUploadFiles() {
  const uploads = [...selectedUploadItems, ...sentFramingUploadItems];
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
  notifyResourceHandlingFromResponse(response);
  showToast("Restarted autoresearch.");
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
  return /^\/(?:permissions|model|plan)(?:\s+.*)?$/.test(normalized);
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
  if (!row) return;
  const session = sessionState();
  const show = activeView === "chat" && Boolean(session.session_id);
  row.hidden = !show;
  if (!show) return;
  const running = isSessionRunning();
  const interrupted = isSessionInterrupted();
  const loopActive = Boolean(session.loop_active);
  const gateStatus = String(session.gate?.status || session.gate?.raw_status || "").toLowerCase();
  const gateOverallStatus = String(session.gate?.overall_status || session.gate?.raw_status || "").toLowerCase();
  const gateIncompletePass = gateOverallStatus === "pass" && gateStatus !== "pass";
  const resumeFromTrial = selectedResumeTrialPayload();
  const chips = [];
  const addChip = (label, prompt) => chips.push(`<button class="composer-suggestion-chip" type="button" data-composer-prompt="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`);
  const addActionChip = (label, action) => chips.push(`<button class="composer-suggestion-chip" type="button" ${action}>${escapeHtml(label)}</button>`);

  if (resumeFromTrial) {
    addActionChip(`Continue from ${resumeTrialLabel(resumeFromTrial)}`, "data-resume-trial-submit");
    addActionChip("Cancel trial continue", "data-resume-trial-remove");
  } else if (gateStatus === "pass") {
    addChip("Show autoresearch", "/goal");
    addActionChip("Restart autoresearch", "data-restart-autoresearch");
    addChip("Status", "/status");
    addChip("Diff", "/diff");
  } else if (gateIncompletePass) {
    addChip("Resume autoresearch", "/goal resume");
    addActionChip("Restart autoresearch", "data-restart-autoresearch");
    addChip("Show autoresearch", "/goal");
    addChip("Status", "/status");
    addChip("Diff", "/diff");
  } else if (running) {
    if (canPauseActiveRunAfterCurrentTurn()) addActionChip("Pause after current turn", "data-pause-autoresearch");
    addActionChip("Stop current run", "data-stop-current-run");
    addChip("Show autoresearch", "/goal");
    addChip("Status", "/status");
    addChip("Processes", "/ps");
  } else if (interrupted) {
    addChip("Resume autoresearch", "/goal resume");
    addChip("Show autoresearch", "/goal");
    addChip("Status", "/status");
    addChip("Diff", "/diff");
  } else {
    if (loopActive) {
      addChip("Pause autoresearch", "/goal pause");
    } else {
      addChip("Resume autoresearch", "/goal resume");
    }
    addActionChip("Restart autoresearch", "data-restart-autoresearch");
    addChip("Show autoresearch", "/goal");
    addChip("Status", "/status");
    if (running) addChip("Processes", "/ps");
    else addChip("Diff", "/diff");
  }

  row.classList.toggle("is-running", running);
  const label = resumeFromTrial ? "Trial continue" : gateStatus === "pass" ? "Autoresearch complete" : gateIncompletePass ? "Gate incomplete" : running ? "Running" : interrupted ? "Goal interrupted" : loopActive ? "Goal active" : "Goal paused";
  row.innerHTML = `<span>${label}</span>${chips.join("")}`;
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
  if (!brief && !hasLaunched()) {
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
    notifyResourceHandlingFromResponse(response);
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

async function sendSessionComposerMessage(message) {
  if (!ensureResourceImportsReady()) return false;
  if (!hasActiveProject()) {
    openProjectCreateDialog();
    showToast("Create a project first.", true);
    return false;
  }
  const text = String(message || "").trim();
  const attachments = currentComposerAttachments();
  let resumeFromTrial = selectedResumeTrialPayload();
  if (!text && !attachments.length && !resumeFromTrial) return false;
  const localControl = canSendLocalSlashControl(text);
  if (!canSendSessionComposerMessage() && !localControl) {
    showToast("Wait for the current agent run to finish before sending another message.", true);
    return false;
  }
  let isCommand = text.startsWith("/");
  const normalizedCommand = isCommand ? text.toLowerCase().replace(/\s+/g, " ").trim() : "";
  let messageText = text;
  if (resumeFromTrial && isCommand) {
    showToast("Remove the Continue from Trial chip before sending a slash command, or send a normal instruction for this fork.", true);
    return false;
  }
  if (resumeFromTrial) {
    const confirmed = await confirmResumeTrialSend(resumeFromTrial, messageText, attachments);
    if (!confirmed) return false;
  }
  if (normalizedCommand === "/goal restart") {
    const confirmed = await confirmRestartAutoresearch(text);
    if (!confirmed) return false;
  }
  const composerSnapshot = snapshotFramingComposerState();
  const displayText = isCommand ? text : messageText || attachmentOnlyMessage(attachments) || resumeTrialOnlyMessage(resumeFromTrial);
  let appendedMessage = null;
  if (!isCommand) {
    appendedMessage = appendFramingMessage("user", displayText, { attachments, resumeFromTrial });
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
  const endpoint = normalizedCommand === "/goal restart"
    ? "/api/research/restart"
    : isCommand
      ? "/api/research/command"
      : resumeFromTrial
        ? "/api/research/resume-from-trial"
        : "/api/research/chat";
  let response = null;
  try {
    const files = await collectUploadFiles();
    const body = normalizedCommand === "/goal restart"
      ? { message: text, settings: settingsFromForm() }
      : isCommand
      ? { command: text, settings: settingsFromForm() }
      : { message: messageText || displayText, files, resourceLinks: collectResourceLinks(), resumeFromTrial, settings: settingsFromForm() };
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
  notifyResourceHandlingFromResponse(response);
  reconcileFramingPending(localMessages);
  renderFramingConversation();
  renderSelectedResources();
  return true;
}

async function startFramingRun(brief) {
  if (!ensureResourceImportsReady()) throw new Error(blockingResourceImportMessage());
  if (!hasActiveProject()) throw new Error("Create a project first.");
  const text = String(brief || "").trim();
  if (!text) throw new Error("Research brief is required.");
  if (activeColdPath) coldFiles[activeColdPath] = text;
  await saveColdFiles({ refresh: false });
  setColdSaveStatus("Autosaved", "saved");
  const fileEdits = Object.entries(coldFiles).map(([path, value]) => ({ path, text: value }));
  const targetVenue = String($("#target-venue")?.value || "").trim();
  const files = await collectUploadFiles();
  const response = await api("/api/research/framing", {
    method: "POST",
    body: JSON.stringify({
      brief: text,
      targetVenue,
      fileEdits,
      resourceLinks: collectResourceLinks(),
      files,
      settings: settingsFromForm(),
    }),
  });
  const session = response?.result?.session;
  if (appState && session) appState.research_session = session;
  mergeSessionFromApiResponse(response);
  notifyResourceHandlingFromResponse(response);
  return response;
}

async function coldStartFromPrepare() {
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
    showToast(hasProjectDraftReady() ? "Write a message to refine the project." : "Write a research brief before framing.", true);
    setColdViewMode("source");
    $("#cold-file-editor")?.focus();
    return;
  }
  const displayInput = input || attachmentOnlyMessage(attachments) || resumeTrialOnlyMessage(resumeFromTrial);
  let composerSnapshot = null;
  try {
    if (canSendLocalSlashControl(input)) {
      const sent = await sendSessionComposerMessage(input);
      if (!sent) return;
      await loadOverview(true);
      scrollFramingToBottomSoon();
      return;
    }
    if (hasLaunched() || canChatWithFramingDraft()) {
      const sent = await sendSessionComposerMessage(input);
      if (!sent) return;
      await loadOverview(true);
      scrollFramingToBottomSoon();
      return;
    }
    if (isSessionRunning()) {
      showToast(`${agentLabel(sessionBackend())} is already running. Wait for the current run to finish.`, true);
      return;
    }
    const attachments = currentComposerAttachments();
    composerSnapshot = snapshotFramingComposerState();
    framingDraftPending = true;
    const message = appendFramingMessage("user", displayInput, { attachments });
    beginFramingPending(message?.id || "");
    $("#cold-file-editor").value = "";
    clearFramingComposerAttachments();
    resizeColdEditor();
    renderFramingConversation();
    scrollFramingToBottomSoon();
    await persistFramingMessages();
    await startFramingRun(displayInput);
    clearComposerDraft();
    framingDraftPending = false;
    reconcileFramingPending(localMessages);
    renderFramingConversation();
    scrollFramingToBottomSoon();
    markPrepareSaved(true);
    $("#cold-file-editor").placeholder = "Ask for a change to PROJECT.md, or add a new constraint before launch...";
    resizeColdEditor();
    activeStage = "1";
    renderStage();
    renderChatState();
    showToast(`${agentLabel(sessionBackend())} is framing PROJECT.md.`);
    await loadOverview(true);
    scrollFramingToBottomSoon();
  } catch (error) {
    framingDraftPending = false;
    reconcileFramingPending(localMessages);
    if (composerSnapshot) restoreFramingComposerState(composerSnapshot);
    renderFramingConversation();
    showToast(error.message, true);
  }
}

async function resendFramingMessage(id, text) {
  const message = localMessages.find((item) => item.id === id && item.role === "user");
  const next = String(text || "").trim();
  if (!message || !next) return;
  if (isSessionRunning()) {
    showToast(`${agentLabel(sessionBackend())} is already running. Wait for the current run to finish.`, true);
    return;
  }
  const index = localMessages.findIndex((item) => item.id === id);
  message.text = next;
  message.edited_at = new Date().toISOString();
  editingFramingId = "";
  if (index >= 0) {
    localMessages.splice(index + 1, localMessages.length - index - 1);
  }
  setHiddenProjectDraft("");
  projectDraftDirty = false;
  await persistFramingMessages();
  renderFramingConversation();
  try {
    framingDraftPending = true;
    beginFramingPending(id);
    renderFramingConversation();
    scrollFramingToBottomSoon();
    await startFramingRun(next);
    framingDraftPending = false;
    reconcileFramingPending(localMessages);
    renderFramingConversation();
    scrollFramingToBottomSoon();
    showToast(`${agentLabel(sessionBackend())} is reframing PROJECT.md.`);
    await loadOverview(true);
    scrollFramingToBottomSoon();
  } catch (error) {
    framingDraftPending = false;
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

async function resendTranscriptMessage(id, message) {
  const text = String(message || "").trim();
  if (!text) return;
  if (!canMessage()) {
    showToast("Wait for the current agent run to finish before resending.", true);
    return;
  }
  try {
    const response = await api("/api/research/chat", {
      method: "POST",
      body: JSON.stringify({ message: text, settings: settingsFromForm() }),
    });
    mergeSessionFromApiResponse(response);
    editingTranscriptId = "";
    await loadOverview(true);
    scrollThread();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleGoal(event) {
  event.preventDefault();
  const input = event.currentTarget.elements.goal;
  const goal = String(input.value || "").trim();
  if (!goal) return;
  input.value = "";
  await sendCommand(`/goal ${goal}`);
}

async function handleStopSession() {
  try {
    const response = await api("/api/research/stop", { method: "POST", body: JSON.stringify({}) });
    mergeSessionFromApiResponse(response);
    showToast("Stop requested.");
    await loadOverview(true);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handlePauseAutoresearch() {
  await sendCommand("/goal pause");
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
    $("#settings-dialog").showModal();
  });
  $$("[data-settings-close]").forEach((button) => {
    button.addEventListener("click", () => $("#settings-dialog").close());
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
  $("#restart-autoresearch-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeRestartAutoresearchDialog(false);
  });
  $("#restart-autoresearch-dialog")?.addEventListener("close", () => {
    if (pendingRestartAutoresearchConfirm) closeRestartAutoresearchDialog(false);
  });
  $("#prepare-cold-start").addEventListener("click", coldStartFromPrepare);
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
  });
  $("#target-venue").addEventListener("input", (event) => {
    scopedSet("autoResearchTargetVenue", event.target.value || "");
    if (!projectDraftDirty && currentProjectDraft().trim() && !isPlaceholderProject(currentProjectDraft())) {
      renderProjectDraft(true);
    }
  });
  $("#continue-research").addEventListener("click", handleContinue);
  $("#stop-session").addEventListener("click", handleStopSession);
  $("#chat-form").addEventListener("submit", handleChat);
  $("#goal-form").addEventListener("submit", handleGoal);
  $("#session-settings-form").addEventListener("input", () => settingsFromForm());
  $("#session-settings-form")?.elements?.backend?.addEventListener("change", (event) => switchSessionBackend(event.target.value));
  $("#settings-form")?.elements?.settingsBackend?.addEventListener("change", (event) => switchSettingsBackend(event.target.value));
  $("#composer-model")?.addEventListener("change", updateSessionSettingsFromComposer);
  $("#composer-reasoning")?.addEventListener("change", updateSessionSettingsFromComposer);
  $("#framing-scroll-bottom")?.addEventListener("click", scrollFramingToBottom);
  $("#copy-resume-command")?.addEventListener("click", copyResumeCommand);
  $("#chat-form textarea").addEventListener("input", resizeComposer);
  $("#browser-search").addEventListener("input", (event) => {
    browserSearchQuery = event.target.value || "";
    clearTimeout(browserSearchTimer);
    browserSearchTimer = setTimeout(() => loadLocalBrowser(localBrowserPath, { keepSearch: true }), 180);
  });
  window.addEventListener("resize", () => {
    resizeColdEditor();
    updateBriefDockGeometry();
    updateFramingScrollButton();
  });
  window.addEventListener("scroll", updateFramingScrollButton, { passive: true });
  $(".main-stage")?.addEventListener("scroll", updateFramingScrollButton, { passive: true });
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
  $("#composer-attach-button")?.addEventListener("click", () => {
    openComposerFilePicker("user_input");
  });
  $("#composer-file-input")?.addEventListener("change", (event) => {
    const category = resourceCategories[event.target.dataset.resourceCategory] ? event.target.dataset.resourceCategory : "user_input";
    addFilesFromList(event.target.files, "file picker", { category });
    delete event.target.dataset.resourceCategory;
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
    const materialType = event.target.closest("[data-material-type]");
    if (materialType) {
      chooseMaterialType(materialType.dataset.materialType);
      return;
    }
    const materialTypeClose = event.target.closest("[data-material-type-close]");
    if (materialTypeClose) {
      closeMaterialTypeDialog();
      return;
    }
    const clearSecret = event.target.closest("[data-clear-secret]");
    if (clearSecret) {
      clearSavedSecret(clearSecret.dataset.clearSecret);
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
      addResourcePath(addResource.dataset.resourceAddPath);
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
    const copyText = event.target.closest("[data-copy-text]");
    if (copyText) {
      event.preventDefault();
      let text = copyText.dataset.copyText || "";
      try {
        text = decodeURIComponent(text);
      } catch {
        text = copyText.dataset.copyText || "";
      }
      copyTextToClipboard(text, copyText.dataset.copyLabel || "Copied.").catch((error) => showToast(error.message, true));
      return;
    }
    const removeResumeTrial = event.target.closest("[data-resume-trial-remove]");
    if (removeResumeTrial) {
      clearResumeTrialContext();
      return;
    }
    const stopCurrentRun = event.target.closest("[data-stop-current-run]");
    if (stopCurrentRun) {
      event.preventDefault();
      event.stopPropagation();
      handleStopSession();
      return;
    }
    const pauseAutoresearch = event.target.closest("[data-pause-autoresearch]");
    if (pauseAutoresearch) {
      event.preventDefault();
      event.stopPropagation();
      handlePauseAutoresearch();
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
      coldStartFromPrepare();
      return;
    }
    const browserOpen = event.target.closest("[data-browser-open]");
    if (browserOpen) {
      if (browserOpen.dataset.browserType === "directory") loadLocalBrowser(browserOpen.dataset.browserOpen);
      else addResourcePath(browserOpen.dataset.browserOpen);
      return;
    }
    const save = event.target.closest("[data-inline-save]");
    if (save) {
      saveInlineFile(save.dataset.inlineSave, save.closest(".inline-editor-shell"));
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
    const command = event.target.closest("[data-command]");
    if (command) {
      insertComposerPrompt(command.dataset.command);
      return;
    }
    const trialScroll = event.target.closest("[data-trial-scroll]");
    if (trialScroll) {
      const strip = trialScroll.closest(".trial-strip")?.querySelector(".trial-strip-scroll");
      if (strip) {
        const delta = Number(trialScroll.dataset.trialScroll || 1) * Math.max(180, strip.clientWidth * 0.72);
        trialStripScrollLeft = clampTrialStripScrollLeft(strip, strip.scrollLeft + delta);
        strip.scrollLeft = trialStripScrollLeft;
      }
      return;
    }
    const trialSelect = event.target.closest("[data-trial-select]");
    if (trialSelect) {
      const strip = trialSelect.closest(".trial-strip")?.querySelector(".trial-strip-scroll");
      rememberTrialStripScroll(strip);
      selectedTrialIndex = Number(trialSelect.dataset.trialSelect || 0);
      renderFramingConversation();
      requestAnimationFrame(restoreTrialStripScroll);
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
      renderFramingConversation();
      requestAnimationFrame(() => document.querySelector(`[data-framing-edit-form="${CSS.escape(editingFramingId)}"] textarea`)?.focus());
      return;
    }
    const framingCancel = event.target.closest("[data-framing-cancel]");
    if (framingCancel) {
      editingFramingId = "";
      renderFramingConversation();
      return;
    }
    const projectEdit = event.target.closest("[data-project-edit]");
    if (projectEdit) {
      projectDraftEditMode = true;
      renderFramingConversation();
      requestAnimationFrame(() => document.querySelector("[data-project-inline-editor]")?.focus());
      return;
    }
    const projectEditCancel = event.target.closest("[data-project-edit-cancel]");
    if (projectEditCancel) {
      projectDraftEditMode = false;
      renderFramingConversation();
      return;
    }
    const projectEditSave = event.target.closest("[data-project-edit-save]");
    if (projectEditSave) {
      const inlineEditor = document.querySelector("[data-project-inline-editor]");
      const hiddenEditor = $("#project-draft-editor");
      if (inlineEditor && hiddenEditor) {
        hiddenEditor.value = inlineEditor.value;
        updateLatestProjectDraftMessage(inlineEditor.value);
        projectDraftDirty = true;
        updateProjectDraftPreview();
        withButtonFeedback(projectEditSave, () => saveProjectDraft())
          .then(() => {
            projectDraftEditMode = false;
            renderFramingConversation();
          })
          .catch((error) => showToast(error.message, true));
      }
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
    const editTranscript = event.target.closest("[data-transcript-edit]");
    if (editTranscript) {
      editingTranscriptId = editTranscript.dataset.transcriptEdit;
      renderChatSummary();
      requestAnimationFrame(() => document.querySelector(`[data-transcript-edit-form="${CSS.escape(editingTranscriptId)}"] textarea`)?.focus());
      return;
    }
    const cancelTranscript = event.target.closest("[data-transcript-cancel]");
    if (cancelTranscript) {
      editingTranscriptId = "";
      renderChatSummary();
    }
  });

  $("#file-viewer-dialog")?.addEventListener("click", (event) => {
    if (event.target?.id === "file-viewer-dialog") closeInlineFullscreen();
  });
  $("#file-viewer-dialog")?.addEventListener("pointerdown", startFileViewerResize);
  document.addEventListener("pointermove", updateFileViewerResize);
  document.addEventListener("pointerup", finishFileViewerResize);
  document.addEventListener("pointercancel", finishFileViewerResize);
  $("#file-viewer-dialog")?.addEventListener("close", () => {
    if (fileViewerResizeState) finishFileViewerResize();
    const body = $("#file-viewer-body");
    if (!body) return;
    body.innerHTML = "";
    delete body.dataset.inlineFullscreenFile;
    fileViewerReturnPath = "";
    updateFileViewerReturnAction("");
  });

  document.body.addEventListener("submit", (event) => {
    const framingForm = event.target.closest("[data-framing-edit-form]");
    if (framingForm) {
      event.preventDefault();
      resendFramingMessage(framingForm.dataset.framingEditForm, framingForm.elements.message.value);
      return;
    }
    const form = event.target.closest("[data-transcript-edit-form]");
    if (!form) return;
    event.preventDefault();
    resendTranscriptMessage(form.dataset.transcriptEditForm, form.elements.message.value);
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
  await loadProjects().catch((error) => showToast(error.message, true));
  if (!activeProjectId && appState?.multi_project) {
    $("#sync-state").textContent = "Create a project";
    renderProjectAvailability();
    maybeOpenInitialProjectDialog();
    scheduleOverviewPoll(3500);
    return;
  }
  hydrateTargetVenueField({ force: true });
  restoreSessionSettings();
  await loadUiSettings();
  restoreResourceSelections();
  restorePendingResourceImports();
  resizeComposer();
  resizeColdEditor();
  await loadOverview(true);
  scheduleOverviewPoll(1000);
}

init().catch((error) => showToast(error.message, true));
