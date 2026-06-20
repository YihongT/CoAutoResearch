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
let composerDraft = "";
const localMessages = [];
let activeResourceCategory = "ongoing_work";
const selectedResourceItems = [];
const selectedUploadItems = [];
const coldFiles = {};
const inlineFiles = {};
const inlineFilePayloads = {};
const inlineFileModes = {};
const COLD_AUTOSAVE_DELAY = 900;

const panelTitles = {
  workspace: "Project files",
  resources: "Resources",
  trials: "Trials",
  reviews: "Reviews",
  manuscript: "Manuscript",
};

const defaultSessionSettings = {
  model: "gpt-5.5",
  reasoningEffort: "medium",
  permissionPreset: "default",
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  webSearch: true,
  extraConfig: "",
  reviewCheckpointInterval: 100,
};

const allowedThemeModes = new Set(["light"]);
let currentThemeMode = normalizeThemeMode(localStorage.getItem("coAutoResearchTheme") || document.documentElement.dataset.theme || "light");

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
  GITHUB_TOKEN: "Lets Codex inspect private repos or GitHub APIs when needed.",
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

## What Codex Should Clarify Next

- The central research problem and why it matters.
- The perspective, claim, or contribution that could fit the target audience.
- Which attached resources are prior work, papers, proposals, data, or miscellaneous context.
- What evidence, synthesis, benchmark, method, or manuscript outcome would count as useful progress.

## Launch Readiness

Autoresearch should launch only after this framing is specific enough for Codex to choose a coherent first research objective.
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
            return { kind, path, name: String(item.name || basename(path)), category };
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
    return `<button class="markdown-file-link" type="button" data-inline-fullscreen="${escapeHtml(path)}">${escapeHtml(text)}</button>`;
  }
  return escapeHtml(text);
}

function inlineMarkup(text) {
  return escapeHtml(text)
    .replaceAll(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (_, label, href) => markdownLinkHtml(label, href))
    .replaceAll(/`([^`]+)`/g, "<code>$1</code>")
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

function scopedGet(key, fallback = "") {
  return localStorage.getItem(scopedStorageKey(key)) ?? localStorage.getItem(key) ?? fallback;
}

function scopedSet(key, value) {
  localStorage.setItem(scopedStorageKey(key), value);
}

function scopedRemove(key) {
  localStorage.removeItem(scopedStorageKey(key));
}

function normalizeThemeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return allowedThemeModes.has(mode) ? mode : "light";
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

function mergeSessionFromApiResponse(payload) {
  const session =
    payload?.result?.session ||
    payload?.session ||
    payload?.result?.result?.session ||
    null;
  if (!session) return false;
  if (!appState) appState = {};
  appState.research_session = session;
  renderChatState();
  renderSession();
  renderResumeCommandBar();
  renderComposerSuggestions();
  return true;
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
      const reviewerOutdated = Boolean(project.reviewer_status?.outdated || project.reviewerStatus?.outdated);
      return `
        <div class="project-switch-row ${selected ? "is-active" : ""}" data-project-row="${escapeHtml(project.id)}">
          <button class="project-switch" type="button" data-project-switch="${escapeHtml(project.id)}">
            <span class="project-status-dot ${escapeHtml(statusClass)}" aria-hidden="true"></span>
            <span>
              <strong>${escapeHtml(project.display_name || project.title || "Project")}</strong>
              <small>${escapeHtml(label)}${project.session_id ? ` · ${escapeHtml(String(project.session_id).slice(0, 8))}` : ""}</small>
              ${reviewerOutdated ? `<small class="project-warning-line">Reviewers outdated</small>` : ""}
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
  localMessages.splice(0);
  selectedResourceItems.splice(0);
  selectedUploadItems.splice(0);
  sentFramingResourceItems.splice(0);
  sentFramingUploadItems.splice(0);
  clearObject(coldFiles);
  clearObject(inlineFiles);
  clearObject(inlineFilePayloads);
  clearObject(inlineFileModes);
}

async function switchProject(projectId) {
  const next = String(projectId || "").trim();
  if (!next || next === activeProjectId) return;
  activeProjectId = next;
  localStorage.setItem("coAutoResearchActiveProject", activeProjectId);
  resetProjectClientState();
  $("#target-venue").value = scopedGet("autoResearchTargetVenue", "");
  restoreSessionSettings();
  restoreResourceSelections();
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
  const name = String(new FormData(form).get("projectName") || "").trim();
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
    showToast("Project deleted.");
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
  const name = String(new FormData(form).get("projectName") || "").trim();
  if (!name) {
    showToast("Project name is required.", true);
    return;
  }
  submit.disabled = true;
  try {
    $("#project-create-note")?.removeAttribute("data-tone");
    const payload = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
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
    $("#target-venue").value = scopedGet("autoResearchTargetVenue", "");
    restoreSessionSettings();
    restoreResourceSelections();
    await loadUiSettings();
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
    }
    const session = appState.research_session || {};
    if (framingDraftPending && session.mode === "framing" && !["running", "stopping"].includes(session.status)) {
      framingDraftPending = false;
      reconcileFramingPending(localMessages);
    }
    $("#sync-state").textContent = `Synced ${new Date(appState.generated_at).toLocaleTimeString()}`;
    renderProjectList();
    renderRailVisibility();
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
    hasRealText(manuscript.no_table_rationale) ||
    hasRealText(manuscript.traceability)
  ) return true;
  const sections = [
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

function codexResumeCommand() {
  const sessionId = String(sessionState().session_id || "").trim();
  if (!sessionId) return "";
  const repoRoot = String(appState?.repo_root || "").trim();
  const parts = ["codex", "resume", "--include-non-interactive"];
  if (repoRoot) parts.push("-C", shellQuote(repoRoot));
  parts.push(shellQuote(sessionId));
  return parts.join(" ");
}

function renderResumeCommandBar() {
  const bar = $("#resume-command-bar");
  const text = $("#resume-command-text");
  if (!bar || !text) return;
  const command = codexResumeCommand();
  const sessionId = String(sessionState().session_id || "").trim();
  bar.hidden = !command;
  text.textContent = sessionId ? `session ${sessionId.slice(0, 8)}` : "";
  text.title = command;
  bar.dataset.command = command;
}

async function copyResumeCommand() {
  const command = codexResumeCommand();
  if (!command) return;
  await copyTextToClipboard(command, "Codex resume command copied.");
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
  if (isAutoresearchActiveRun()) return `Codex is working on Trial ${activeRunTrialIteration()}`;
  return "Codex is working";
}

function activeRunScopeLabel() {
  const iteration = activeRunTrialIteration();
  if (isAutoresearchActiveRun() && iteration) return `Trial ${iteration} · Running`;
  return "Current run";
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
  const targetVenue = String($("#target-venue")?.value || scopedGet("autoResearchTargetVenue", "") || "").trim();
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

function latestAssistantTextMessage(messages = localMessages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.kind !== "project" && String(message.text || "").trim()) return message;
  }
  return null;
}

function canLaunchAutoresearchFromAssistant(message) {
  const latest = latestAssistantTextMessage();
  return Boolean(
    message?.id &&
    latest?.id === message.id &&
    hasProjectDraftReady() &&
    !hasGoalStarted() &&
    !isSessionRunning()
  );
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
  const actions = role === "user" && !message.resumeFromTrial
    ? `<div class="framing-actions"><button class="text-button" type="button" data-framing-edit="${escapeHtml(message.id)}">Edit</button></div>`
    : canLaunchAutoresearchFromAssistant(message)
      ? `<div class="framing-actions"><button class="primary-button small-button" type="button" data-project-launch>Start autoresearch</button></div>`
      : "";
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
  const status = hasLaunched()
    ? activeRunStatusLabel()
    : isSessionRunning()
      ? "Drafting PROJECT.md"
      : "Starting Codex";
  const trialHistory = isAutoresearchActiveRun() ? activeTrialHistoryHtml() : "";
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
        ${trialHistory}
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
    return `<div class="framing-progress is-empty">Waiting for Codex events...</div>`;
  }
  return `
    <div class="framing-progress" aria-label="Codex progress">
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
    : "Waiting for Codex events...";
  const runControls = runControlButtonsHtml();
  return `
    <details class="framing-progress-details">
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
  button.hidden = !shouldShow;
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

function settingsFromForm() {
  const form = $("#session-settings-form");
  const data = new FormData(form);
  const permissionPreset = normalizePermissionPreset(data.get("permissionPreset"));
  const settings = {
    model: String(data.get("model") || "").trim(),
    reasoningEffort: normalizeReasoningEffort(data.get("reasoningEffort")),
    permissionPreset,
    ...permissionPresets[permissionPreset],
    webSearch: Boolean(data.get("webSearch")),
    extraConfig: String(data.get("extraConfig") || "").trim(),
    reviewCheckpointInterval: normalizeReviewCheckpointInterval(data.get("reviewCheckpointInterval")),
  };
  scopedSet("autoResearchSessionSettings", JSON.stringify(settings));
  renderSettingsSummary(settings);
  syncComposerSettings(settings);
  return settings;
}

function syncComposerSettings(settings) {
  const merged = normalizeSessionSettings(settings);
  const model = $("#composer-model");
  const reasoning = $("#composer-reasoning");
  if (model) model.value = merged.model || defaultSessionSettings.model;
  if (reasoning) reasoning.value = merged.reasoningEffort || defaultSessionSettings.reasoningEffort;
}

function updateSessionSettingsFromComposer() {
  const form = $("#session-settings-form");
  const model = $("#composer-model");
  const reasoning = $("#composer-reasoning");
  if (!form || !model || !reasoning) return;
  form.elements.model.value = model.value || defaultSessionSettings.model;
  form.elements.reasoningEffort.value = normalizeReasoningEffort(reasoning.value);
  settingsFromForm();
}

function normalizeReasoningEffort(value) {
  const reasoning = String(value || "").trim();
  return allowedReasoningEfforts.has(reasoning) ? reasoning : defaultSessionSettings.reasoningEffort;
}

function normalizeReviewCheckpointInterval(value) {
  const interval = Number(String(value ?? "").trim());
  return Number.isInteger(interval) && interval > 0 ? interval : defaultSessionSettings.reviewCheckpointInterval;
}

function inferPermissionPreset(settings = {}) {
  const explicit = String(settings.permissionPreset || "").trim();
  if (allowedPermissionPresets.has(explicit)) return explicit;
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
  const merged = { ...defaultSessionSettings, ...(settings || {}) };
  merged.reasoningEffort = normalizeReasoningEffort(merged.reasoningEffort);
  merged.reviewCheckpointInterval = normalizeReviewCheckpointInterval(merged.reviewCheckpointInterval);
  merged.permissionPreset = normalizePermissionPreset(merged.permissionPreset, merged);
  Object.assign(merged, permissionPresets[merged.permissionPreset]);
  if (!allowedApprovalPolicies.has(merged.approvalPolicy)) {
    Object.assign(merged, permissionPresets[defaultSessionSettings.permissionPreset]);
    merged.permissionPreset = defaultSessionSettings.permissionPreset;
  }
  return merged;
}

function applySessionSettings(settings, persist = false) {
  const merged = normalizeSessionSettings(settings);
  const form = $("#session-settings-form");
  form.elements.model.value = merged.model || "";
  form.elements.reasoningEffort.value = merged.reasoningEffort;
  form.elements.permissionPreset.value = merged.permissionPreset;
  form.elements.webSearch.checked = Boolean(merged.webSearch);
  form.elements.extraConfig.value = merged.extraConfig || "";
  if (form.elements.reviewCheckpointInterval) form.elements.reviewCheckpointInterval.value = merged.reviewCheckpointInterval;
  if (persist) scopedSet("autoResearchSessionSettings", JSON.stringify(merged));
  renderSettingsSummary(merged);
  syncComposerSettings(merged);
}

function restoreSessionSettings() {
  let settings = { ...defaultSessionSettings };
  try {
    settings = { ...settings, ...JSON.parse(scopedGet("autoResearchSessionSettings", "{}") || "{}") };
  } catch {
    settings = { ...defaultSessionSettings };
  }
  applySessionSettings(settings);
}

function settingsLabel(settings) {
  const normalized = normalizeSessionSettings(settings || defaultSessionSettings);
  const parts = [];
  if (normalized.model) parts.push(normalized.model);
  parts.push(labelForReasoning(normalized.reasoningEffort));
  parts.push(permissionPresets[normalized.permissionPreset]?.label || "Default permissions");
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

function codexSettingsFromModal() {
  const form = $("#settings-form");
  const data = new FormData(form);
  const permissionPreset = normalizePermissionPreset(data.get("settingsPermissionPreset"));
  return {
    model: String(data.get("settingsModel") || "").trim(),
    reasoningEffort: normalizeReasoningEffort(data.get("settingsReasoningEffort")),
    permissionPreset,
    ...permissionPresets[permissionPreset],
    webSearch: Boolean(data.get("settingsWebSearch")),
    extraConfig: String(data.get("settingsExtraConfig") || "").trim(),
    reviewCheckpointInterval: normalizeReviewCheckpointInterval(data.get("settingsReviewCheckpointInterval")),
  };
}

function hydrateSettingsDialog(settings) {
  const form = $("#settings-form");
  const codex = normalizeSessionSettings(settings?.codex || {});
  hydrateThemeControls();
  form.elements.settingsModel.value = codex.model || "";
  form.elements.settingsReasoningEffort.value = codex.reasoningEffort;
  form.elements.settingsPermissionPreset.value = codex.permissionPreset;
  form.elements.settingsWebSearch.checked = Boolean(codex.webSearch);
  form.elements.settingsExtraConfig.value = codex.extraConfig || "";
  if (form.elements.settingsReviewCheckpointInterval) form.elements.settingsReviewCheckpointInterval.value = codex.reviewCheckpointInterval;

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
          <span class="settings-secret-help">${escapeHtml(secretKeyHelp[key] || "Passed to Codex subprocesses.")}</span>
        </label>
      `;
    })
    .join("");
}

async function loadUiSettings() {
  try {
    const payload = await api("/api/settings");
    uiSettings = payload.settings || {};
    settingsSecretKeys = payload.secret_keys || Object.keys(secretKeyLabels);
    hydrateSettingsDialog(uiSettings);
    applySessionSettings(uiSettings.codex || defaultSessionSettings, true);
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
      const payload = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ codex: codexSettingsFromModal(), env, clear_env: clearEnv }),
      });
      uiSettings = payload.settings || {};
      settingsSecretKeys = payload.secret_keys || settingsSecretKeys;
      hydrateSettingsDialog(uiSettings);
      applySessionSettings(uiSettings.codex || defaultSessionSettings, true);
      showToast("Settings saved locally.");
    });
  } catch (error) {
    showToast(error.message, true);
  }
}

async function clearSavedSecret(key) {
  if (!settingsSecretKeys.includes(key)) return;
  const payload = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ codex: codexSettingsFromModal(), env: {}, clear_env: [key] }),
  });
  uiSettings = payload.settings || {};
  settingsSecretKeys = payload.secret_keys || settingsSecretKeys;
  hydrateSettingsDialog(uiSettings);
  applySessionSettings(uiSettings.codex || defaultSessionSettings, true);
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
    launchButton.disabled = locked || isSessionRunning() || gatePassed;
    launchButton.textContent = gatePassed ? "Reviewer gates passed" : launched ? "Continue autoresearch" : "Start autoresearch";
    launchButton.title = gatePassed
      ? "All reviewer gates have passed."
      : locked
        ? "Finish PROJECT.md before starting autoresearch."
        : "Run the autoresearch loop until strict reviewer gates pass.";
  }
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
  textarea.disabled = !canMessage();
  send.disabled = !canMessage();
  cont.disabled = !canMessage();
  textarea.placeholder = canMessage() ? "Message the current Codex session..." : "Run cold start before messaging...";
  renderComposerSuggestions();
  renderChatSummary();
}

function coldComposerPlaceholder(hasFramingThread) {
  if (hasLaunched()) {
    return "Message Codex about the current research, ask for status, attach resources, or steer the next step...";
  }
  return hasFramingThread
    ? "Ask Codex to revise PROJECT.md, narrow the scope, change the target venue, or add constraints..."
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
    composerDraft = currentEditorValue;
  }
  const nextEditorValue = sessionComposerMode
    ? (currentEditorValue || composerDraft || "")
    : coldFiles[activeColdPath] ?? "";
  editor.placeholder = coldComposerPlaceholder(hasFramingThread);
  if (document.activeElement !== editor && editor.value !== nextEditorValue) {
    editor.value = nextEditorValue;
  }
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
  return "Codex";
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
    return `<p class="status-note">No token usage has been reported by Codex JSON events yet.</p>`;
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

function statusLimitRowsHtml(limits = [], limitations = []) {
  const analyticsUrl = "https://chatgpt.com/codex/cloud/settings/analytics";
  if (!Array.isArray(limits) || !limits.length) {
    const note = (limitations && limitations[0]) || "Remaining usage windows are not available from Codex JSON events.";
    return `
      <div class="status-limit-fallback">
        <p class="status-note">${escapeHtml(note)}</p>
        <a class="status-link-button" href="${analyticsUrl}" target="_blank" rel="noopener noreferrer">Open Codex analytics</a>
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
  const permission = settings.permission || [settings.sandbox, settings.approval].filter(Boolean).join(" / ");
  return `
    <div class="status-settings">
      ${statusMetricHtml("Model", settings.model || "Default")}
      ${statusMetricHtml("Reasoning", settings.reasoning || "medium")}
      ${statusMetricHtml("Permissions", permission || "Default")}
      ${statusMetricHtml("Review checkpoint", `${settings.review_checkpoint_interval || 100} turns`)}
      ${statusMetricHtml("Web", settings.web_search ? "Live search" : "Off")}
    </div>
  `;
}

function statusCardHtml(payload, entry) {
  const sessionId = payload.session_id || "not started";
  const process = payload.process || {};
  const events = payload.events || {};
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
          ${statusMetricHtml("Process", process.active ? `pid ${process.pid}` : "not running", process.active ? "active" : "")}
        </div>
        ${payload.gate_summary ? `<p class="status-note">${escapeHtml(payload.gate_summary)}</p>` : ""}
        <section>
          <h4>Codex settings</h4>
          ${statusSettingsHtml(payload.settings || {})}
        </section>
        <section>
          <h4>Limits</h4>
          ${statusLimitRowsHtml(payload.limits || [], payload.limitations || [])}
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

function effectiveIteration(entry, currentIteration) {
  if (isUiLocalTranscript(entry)) return 0;
  const explicit = Number(entry?.iteration || 0);
  if (explicit > 0) return explicit;
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
  const summary = reportSummary || fallback || (report ? "Summary is not available yet." : "Report is not available yet. Codex activity for this trial is shown below.");
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
  return [...(entries || [])].reverse().find((entry) => {
    const role = transcriptRole(entry);
    const rawType = String(entry?.raw_type || "").toLowerCase();
    return role !== "user" && rawType !== "turn.completed" && String(entry?.content || "").trim();
  });
}

function runningTrialStatusHtml(trial) {
  const iteration = Number(trial?.iteration || activeRunTrialIteration() || 0);
  if (!iteration || !isTrialLive(iteration)) return "";
  const entries = Array.isArray(trial?.entries) ? trial.entries : [];
  const latestEntry = latestTrialProgressEntry(entries);
  const latestText = latestEntry
    ? `${framingProgressTitle(latestEntry)}: ${framingProgressContent(latestEntry)}`
    : "Waiting for Codex events...";
  const eventLabel = entries.length ? `${entries.length} event${entries.length === 1 ? "" : "s"}` : "waiting";
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
      <p>${escapeHtml(compactText(latestText, 240))}</p>
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
                <strong>${escapeHtml(iteration)}</strong>
                <span>${escapeHtml(label)}</span>
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
  const activeTrialIsRunningWithoutReport = runningTrialData
    && activeTrialData
    && Number(runningTrialData.iteration) === Number(activeTrialData.iteration)
    && !activeTrialData.report?.report_path;
  const shouldShowActiveTrialReport = activeTrialData && !activeTrialIsRunningWithoutReport;
  return `
    <section class="trial-history-card" aria-label="Autoresearch trials">
      <header class="trial-history-head">
        <div>
          <strong>Trials</strong>
          <span>${escapeHtml(countLabel)} · ${escapeHtml(selectedLabel)}</span>
          ${autoresearchCompleteBadgeHtml()}
          <button class="secondary-button small-button" type="button" data-inline-fullscreen="manuscript/BLUEPRINT.md">Open latest manuscript</button>
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
  return `
    <details class="framing-run-activity">
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
    <section class="transcript-timeline with-axis" aria-label="Codex transcript">
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
  return `
    <article class="transcript-message ${role}" data-transcript-id="${escapeHtml(id)}">
      <div class="transcript-meta">${escapeHtml(meta || transcriptTitle(entry))}</div>
      <div class="transcript-body">
        ${transcriptContentHtml(content, { markdown: role === "assistant" || role === "final" })}
      </div>
      ${
        editable
          ? `<div class="transcript-actions"><button class="text-button" type="button" data-transcript-edit="${escapeHtml(id)}">Edit</button></div>`
          : ""
      }
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
    : `<div class="transcript-empty">Cold start creates the first real Codex exec session.</div>`;
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
  $("#session-command").textContent = session.command || "No Codex exec run yet.";
  const settings = Object.keys(session.settings || {}).length ? session.settings : settingsFromForm();
  renderSettingsSummary(settings);
  const rawLogs = session.raw_logs || [];
  $("#session-log").textContent = rawLogs.length ? rawLogs.join("\n") : "No raw Codex JSON logs yet.";
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

function inlineOpenButton(path, label = "Open source") {
  const value = repoRelativePath(path);
  if (!value || value.includes("*")) return "";
  return `<button class="secondary-button small-button" type="button" data-inline-fullscreen="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
}

function renderTree(node, depth = 0) {
  if (!node) return empty("No files here yet.");
  if (node.type === "file") {
    const fileMeta = node.is_symlink ? `${node.path} · linked` : node.path;
    if (!node.previewable) {
      return `
        <div class="tree-file is-disabled">
          <span>${escapeHtml(node.name)}</span>
          <small>${escapeHtml(fileMeta)}</small>
        </div>
      `;
    }
    return `
      <details class="tree-file-node" data-file-details="${escapeHtml(node.path)}">
        <summary>
          <span>${escapeHtml(node.name)}</span>
          <small>${escapeHtml(fileMeta)}</small>
        </summary>
        <div class="inline-file" data-inline-file="${escapeHtml(node.path)}">
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
    ["Purpose", manuscriptFieldValue(section, ["Purpose"])],
    ["Role", manuscriptFieldValue(section, ["Target-venue role", "Role", "Section role"])],
    ["Evidence/result", manuscriptFieldValue(section, ["Evidence", "Accepted claims", "Result", "Results", "Content to include"])],
    ["Figures/tables", manuscriptFieldValue(section, ["Figures / tables", "Figures", "Tables"])],
  ].filter(([, value]) => hasRealText(value));
  const relatedSpecs = figureSpecsForSection(section, specs);
  const fallback = fields.length ? "" : `<div class="markdown-preview">${markdownToHtml(section.body)}</div>`;
  return `
    <article class="paper-section-row">
      <header class="paper-section-head">
        <p>Paper section</p>
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
            const sourcePath = firstArtifactPath(section.body);
            return `
              <article class="table-plan-row">
                <header class="paper-section-head">
                  <p>Table</p>
                  <h4>${escapeHtml(cleanText(section.title, "Untitled table"))}</h4>
                </header>
                ${manuscriptActionsHtml([
                  copyButton([`### ${section.title}`, section.body].join("\n\n"), "Copy table", "Table content copied."),
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

function renderManuscriptPanel() {
  const manuscript = appState.summaries?.manuscript || {};
  const blueprintViewer = `
    <div class="card-inline-file is-open" data-inline-file="manuscript/BLUEPRINT.md" data-autoload-file="manuscript/BLUEPRINT.md" data-compact-inline="true">
      <div class="tree-empty">Loading blueprint...</div>
    </div>
  `;
  return [
    contextCard("Current manuscript", blueprintViewer, "Latest manuscript blueprint synthesized from accepted findings and trial reports.", `<button class="secondary-button small-button" type="button" data-inline-fullscreen="manuscript/BLUEPRINT.md">Open latest manuscript</button>`),
    contextCard("Paper outline", renderPaperOutline(manuscript), "Human-readable manuscript architecture with figures attached where they belong."),
    contextCard("Figures", renderFiguresPanel(manuscript), "One card per planned figure, matched to FIGURE_SPECS.md.", inlineOpenButton("manuscript/figures/FIGURE_SPECS.md", "Open specs")),
    contextCard("Tables", renderTablesPanel(manuscript), "Render stable table content here; otherwise explain why no table is active."),
    contextCard("Traceability", renderTraceabilityPanel(manuscript), "Secondary audit map for claims and evidence."),
    contextCard("Missing evidence", list(manuscript.missing_evidence, "No evidence gaps recorded yet.")),
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
  if (typeof value === "string") return { path: value, category: "ongoing_work" };
  const path = String(value?.path || "").trim();
  const category = resourceCategories[value?.category] ? value.category : inferClientResourceCategory(path);
  return { path, category };
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
        .forEach((item) => addResourcePath(item.path, { category: item.category, persist: false, notify: false }));
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
              <button class="icon-button" type="button" data-resource-remove="${escapeHtml(item.path)}" aria-label="Remove ${escapeHtml(basename(item.path))}">Remove</button>
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
              <button class="icon-button" type="button" data-upload-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)}">Remove</button>
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
  const { category = activeResourceCategory, persist = true, notify = true } = options;
  const value = String(path || "").trim();
  if (!value || selectedResourceItems.some((item) => item.path === value)) {
    renderSelectedResources();
    return;
  }
  selectedResourceItems.push({ path: value, category: resourceCategories[category] ? category : inferClientResourceCategory(value) });
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
  return `
    <div class="attachment-chip">
      <span class="attachment-icon">${escapeHtml(shortFileType(item.path))}</span>
      <span class="attachment-copy">
        <strong>${escapeHtml(basename(item.path))}</strong>
        <small>${escapeHtml(resourceLabel(item.category))} · linked</small>
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
  const label = `${resourceLabel(item.category)} · ${isLink ? "linked" : "upload"}`;
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
  ].filter(Boolean).join("");
  ["#brief-attachment-tray", "#chat-attachment-tray"].forEach((selector) => {
    const tray = $(selector);
    if (!tray) return;
    tray.innerHTML = html;
    tray.hidden = !html;
  });
}

function addUploadFile(file, options = {}) {
  if (!file || !file.name && !file.type) return;
  const fallbackExt = fileExtensionFromMime(file.type, extension(file.name) || ".bin");
  const generatedName = `pasted_image_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}${fallbackExt || ".bin"}`;
  const name = file.name || generatedName;
  const category = options.category || activeResourceCategory || "ongoing_work";
  const duplicate = selectedUploadItems.some((item) => item.name === name && item.size === file.size && item.lastModified === file.lastModified);
  if (duplicate) {
    renderSelectedResources();
    return;
  }
  selectedUploadItems.push({
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    file,
    name,
    type: file.type || "",
    size: file.size || 0,
    lastModified: file.lastModified || 0,
    category: resourceCategories[category] ? category : "ongoing_work",
  });
  renderSelectedResources();
  showToast(`${name} attached.`);
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
  list.forEach((file) => addUploadFile(file, options));
  showToast(`${list.length} ${list.length === 1 ? "file" : "files"} attached from ${source}.`);
  return list.length;
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
      showToast("File saved and noted for Codex.");
      await loadOverview(true);
    }, { saved: "Saved & noted" });
  } catch (error) {
    showToast(error.message, true);
  }
}

async function openInlineFullscreen(path) {
  const dialog = $("#file-viewer-dialog");
  const body = $("#file-viewer-body");
  const title = $("#file-viewer-title");
  if (!dialog || !body || !title) return;
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
  title.textContent = basename(resolvedPath);
  body.dataset.inlineFullscreenFile = resolvedPath;
  body.dataset.compactInline = "false";
  body.innerHTML = inlineEditorHtml(payload, false);
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeInlineFullscreen() {
  const dialog = $("#file-viewer-dialog");
  const body = $("#file-viewer-body");
  if (!dialog) return;
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
  if (body) {
    body.innerHTML = "";
    delete body.dataset.inlineFullscreenFile;
  }
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
    showToast(`${clues.length} resource ${clues.length === 1 ? "clue" : "clues"} noted for Codex intake.`);
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
    .map((item) => ({ path: item.path, category: item.category }))
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
    ...selectedResourceItems.map((item) => ({
      kind: "link",
      path: item.path,
      name: basename(item.path),
      category: item.category,
    })),
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
  composerDraft = String(snapshot.composerDraft ?? snapshot.text ?? "");
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
  composerDraft = "";
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
    showToast("Stop the current Codex run before restarting autoresearch.", true);
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
    $("#launch-dialog").showModal();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function launchAutoresearch() {
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
  const brief = currentBriefText().trim();
  if (!brief && !hasLaunched()) {
    showToast("Write a brief before launching.", true);
    return;
  }
  const fileEdits = Object.entries(coldFiles).map(([path, text]) => ({ path, text }));
  fileEdits.push({ path: "PROJECT.md", text: currentProjectDraft() });
  const targetVenue = String($("#target-venue")?.value || "").trim();
  try {
    framingDraftPending = true;
    beginFramingPending();
    if (!hasGoalLaunchMessage()) appendFramingMessage("user", "Start autoresearch.", { kind: "goal-launch" });
    renderFramingConversation();
    scrollFramingToBottomSoon();
    $("#launch-dialog")?.close();
    await persistFramingMessages();
    await saveProjectDraft({ silent: true });
    const files = await collectUploadFiles();
    const response = await api("/api/research/cold-start", {
      method: "POST",
      body: JSON.stringify({ confirmLaunch: true, brief, targetVenue, fileEdits, resourceLinks: collectResourceLinks(), files, settings: settingsFromForm() }),
    });
    mergeSessionFromApiResponse(response);
    notifyResourceHandlingFromResponse(response);
    framingDraftPending = false;
    reconcileFramingPending(localMessages);
    coldDirty = false;
    showToast("Started autoresearch.");
    activeStage = "1";
    await loadOverview(true);
    scrollFramingToBottomSoon();
  } catch (error) {
    framingDraftPending = false;
    reconcileFramingPending(localMessages);
    renderFramingConversation();
    showToast(error.message, true);
  }
}

async function sendSessionComposerMessage(message) {
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
    showToast("Wait for the current Codex run to finish before sending another message.", true);
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
      showToast("Codex is already running. Wait for the current run to finish.", true);
      return;
    }
    const attachments = currentComposerAttachments();
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
    showToast("Codex is framing PROJECT.md.");
    await loadOverview(true);
    scrollFramingToBottomSoon();
  } catch (error) {
    framingDraftPending = false;
    reconcileFramingPending(localMessages);
    renderFramingConversation();
    showToast(error.message, true);
  }
}

async function resendFramingMessage(id, text) {
  const message = localMessages.find((item) => item.id === id && item.role === "user");
  const next = String(text || "").trim();
  if (!message || !next) return;
  if (isSessionRunning()) {
    showToast("Codex is already running. Wait for the current run to finish.", true);
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
    showToast("Codex is reframing PROJECT.md.");
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
  const localControl = canSendLocalSlashControl(command);
  if (!canMessage() && !localControl) {
    showToast("Wait for the current Codex run to finish before sending another message.", true);
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
    showToast("Wait for the current Codex run to finish before resending.", true);
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
    $("#composer-file-input")?.click();
  });
  $("#composer-file-input")?.addEventListener("change", (event) => {
    addFilesFromList(event.target.files, "file picker", { category: "user_input" });
    event.target.value = "";
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
      openInlineFullscreen(inlineFullscreen.dataset.inlineFullscreen);
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
  $("#file-viewer-dialog")?.addEventListener("close", () => {
    const body = $("#file-viewer-body");
    if (!body) return;
    body.innerHTML = "";
    delete body.dataset.inlineFullscreenFile;
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
  $("#target-venue").value = scopedGet("autoResearchTargetVenue", "");
  restoreSessionSettings();
  await loadUiSettings();
  restoreResourceSelections();
  resizeComposer();
  resizeColdEditor();
  await loadOverview(true);
  scheduleOverviewPoll(1000);
}

init().catch((error) => showToast(error.message, true));
