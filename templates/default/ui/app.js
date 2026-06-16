let appState = null;
let activeProjectId = new URLSearchParams(window.location.search).get("project") || localStorage.getItem("coAutoResearchActiveProject") || "";
let activeView = "chat";
let activePanel = "resources";
let activeStage = "1";
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
let projectDraftEditMode = false;
let editingFramingId = "";
let projectRenderedScrollTop = 0;
let overviewPollTimer = null;
let lastFramingHtml = "";
let initialProjectDialogOpened = false;
let openProjectMenuId = "";
let pendingRenameProject = null;
let pendingDeleteProject = null;
let selectedTrialIndex = 0;
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
};

const resourceCategories = {
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

function normalizeFramingMessage(message) {
  if (!message || !["user", "assistant"].includes(message.role)) return null;
  const allowedKinds = new Set(["text", "project", "goal-launch"]);
  const kind = allowedKinds.has(message.kind) ? message.kind : "text";
  const artifact = message.artifact && typeof message.artifact === "object"
    ? {
        path: String(message.artifact.path || "").trim(),
        text: String(message.artifact.text || "").trim(),
      }
    : null;
  const text = String(message.text || "").trim();
  if (kind === "project" && (!artifact?.text || isPlaceholderProject(artifact.text))) return null;
  if (!text && !(artifact?.path && artifact?.text)) return null;
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
  return {
    id: String(message.id || newMessageId()).trim(),
    role: message.role,
    kind,
    text,
    created_at: String(message.created_at || new Date().toISOString()),
    ...(artifact?.path && artifact?.text ? { artifact } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
}

function latestProjectMessage() {
  for (let index = localMessages.length - 1; index >= 0; index -= 1) {
    const message = localMessages[index];
    if (message?.role === "assistant" && message.kind === "project" && message.artifact?.path === "PROJECT.md") return message;
  }
  return null;
}

function setHiddenProjectDraft(text) {
  const editor = $("#project-draft-editor");
  if (editor) editor.value = String(text || "");
  updateProjectDraftPreview();
}

function inlineMarkup(text) {
  return escapeHtml(text)
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
    scheduleOverviewPoll(isSessionRunning() || framingDraftPending ? 1000 : 3500);
  }, delay);
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
  if (hasRealText(manuscript.target) || hasRealText(manuscript.contribution) || hasRealText(manuscript.core_story)) return true;
  const sections = [
    ...(manuscript.claims || []),
    ...(manuscript.section_blueprint || []),
    ...(manuscript.figures || []),
    ...(manuscript.tables || []),
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
  return ["running", "stopping"].includes(sessionState().status);
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
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(command);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = command;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast("Codex resume command copied.");
  } catch (error) {
    showToast("Could not copy command.", true);
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

function canMessage() {
  return hasLaunched() && hasSession() && !isSessionRunning();
}

function isLocalSlashControl(text) {
  const normalized = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  return ["/goal", "/goal pause", "/goal resume", "/goal clear", "/status", "/ps", "/diff"].includes(normalized);
}

function canSendLocalSlashControl(text) {
  const normalized = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!isLocalSlashControl(normalized)) return false;
  if (normalized === "/goal resume") return hasLaunched() && hasSession();
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
  await api("/api/framing/messages", {
    method: "POST",
    body: JSON.stringify({ messages: localMessages.slice(-80) }),
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

function latestProjectIndex(messages = localMessages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.kind === "project") return index;
  }
  return -1;
}

function latestUserIndex(messages = localMessages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return index;
  }
  return -1;
}

function isGoalLaunchMessage(message) {
  const text = String(message?.text || "").trim().toLowerCase();
  return message?.role === "user" && (
    message.kind === "goal-launch" ||
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
    text: "Start autoresearch with /goal.",
    created_at: new Date().toISOString(),
  });
}

function restoreFramingMessages() {
  const nextMessages = [];
  const serverMessages = appState?.framing?.messages || [];
  let shouldPersist = false;
  const savedBrief = String(coldFiles["resources/user_input/INITIAL_BRIEF.md"] || "").trim();
  const session = sessionState();
  const visibleSessionTranscript = Array.isArray(session.transcript)
    ? session.transcript.filter((entry) => !isHiddenUiTranscript(entry))
    : [];
  const hasStartedSession = hasSession() || Boolean(session.mode) || !["", "idle"].includes(String(session.status || "").toLowerCase());
  const hasOnlyOrphanLocalUserMessage =
    Array.isArray(serverMessages) &&
    serverMessages.length === 1 &&
    String(serverMessages[0]?.role || "") === "user" &&
    !hasStartedSession &&
    visibleSessionTranscript.length === 0;
  if (Array.isArray(serverMessages)) {
    for (const rawMessage of serverMessages) {
      const message = normalizeFramingMessage(rawMessage);
      if (!message) continue;
      if (message.role === "user" && (isDefaultBriefTemplate(message.text) || hasOnlyOrphanLocalUserMessage)) {
        shouldPersist = true;
        continue;
      }
      nextMessages.push(message);
    }
  }
  const projectText = String(appState?.files?.project?.text || "").trim();
  const framingInProgress = framingDraftPending || isFramingRunning();
  if (!framingInProgress && projectText && !isPlaceholderProject(projectText) && appState?.framing?.project_ready) {
    const projectIndex = latestProjectIndex(nextMessages);
    const userIndex = latestUserIndex(nextMessages);
    const projectBelongsAfterLatestUser = projectIndex >= 0 && projectIndex > userIndex;
    if (projectBelongsAfterLatestUser) {
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
        text: projectIndex >= 0
          ? "I updated PROJECT.md. Review the new draft here, edit it directly, or keep chatting to refine the framing."
          : "I drafted PROJECT.md. Review it here, edit it directly, or keep chatting to refine the framing.",
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
  replaceFramingMessagesIfChanged(nextMessages);
  const lastUser = [...localMessages].reverse().find((message) => message.role === "user");
  const brief = savedBrief;
  const hasMessageAttachments = localMessages.some((message) => Array.isArray(message.attachments) && message.attachments.length);
  if (lastUser && brief && String(lastUser.text || "").trim() === brief && selectedResourceItems.length && !hasMessageAttachments) {
    lastUser.attachments = currentComposerAttachments();
    sentFramingResourceItems.push(...selectedResourceItems.map((item) => ({ ...item })));
    selectedResourceItems.splice(0);
    saveResourceSelections();
    renderSelectedResources();
    saveFramingMessages().catch(() => {});
  }
  if (shouldPersist) saveFramingMessages().catch(() => {});
  const projectMessage = latestProjectMessage();
  setHiddenProjectDraft(projectMessage?.artifact?.text || "");
}

function appendFramingMessage(role, text, extras = {}) {
  const message = normalizeFramingMessage({ id: newMessageId(role), role, text, ...extras });
  if (!message) return null;
  localMessages.push(message);
  lastFramingHtml = "";
  saveFramingMessages().catch((error) => showToast(error.message, true));
  renderFramingConversation();
  return message;
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
    saveFramingMessages().catch((error) => showToast(error.message, true));
  }
  setHiddenProjectDraft(draft);
}

function framingMessageHtml(message) {
  if (message.kind === "project" && message.artifact?.text) return projectDraftCardHtml(message);
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
  return `
    <article class="framing-message ${role}" data-framing-id="${escapeHtml(message.id)}">
      <div class="transcript-meta">${title}</div>
      ${messageAttachmentsHtml(message)}
      <div class="transcript-body">${transcriptContentHtml(message.text)}</div>
      ${
        role === "user"
          ? `<div class="framing-actions"><button class="text-button" type="button" data-framing-edit="${escapeHtml(message.id)}">Edit</button></div>`
          : ""
      }
    </article>
  `;
}

function framingThinkingHtml() {
  const status = hasLaunched()
    ? "Codex is working"
    : isSessionRunning()
      ? "Drafting PROJECT.md"
      : "Starting Codex";
  return `
    <article class="framing-message assistant is-thinking" aria-live="polite">
      <div class="transcript-meta">CoAutoResearch</div>
      <div class="transcript-body thinking-bubble">
        <div class="thinking-status-row">
          <span class="thinking-dot"></span>
          <span class="thinking-dot"></span>
          <span class="thinking-dot"></span>
          <strong>${escapeHtml(status)}</strong>
        </div>
        ${framingProgressHtml()}
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

function framingProgressHtml() {
  const session = sessionState();
  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  const entries = transcript
    .filter((entry) => {
      const role = transcriptRole(entry);
      const content = String(entry?.content || "").trim();
      const rawType = String(entry?.raw_type || "").toLowerCase();
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
        ${canStartGoal ? '<button class="primary-button small-button" type="button" data-project-launch>Start with /goal</button>' : ""}
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
  const interactionMessages = localMessages.filter((message) => !(message.kind === "project" && message.artifact?.text));
  const projectMessages = localMessages.filter((message) => message.kind === "project" && message.artifact?.text);
  const messages = interactionMessages.map(framingMessageHtml).join("");
  const projectCards = projectMessages.map(framingMessageHtml).join("");
  const transcriptEntries = sessionTranscriptEntries();
  const hasLocalTranscript = transcriptEntries.some(isUiLocalTranscript);
  const sessionTranscript = hasLaunched() || hasLocalTranscript
    ? sessionTimelineHtml(transcriptEntries)
    : "";
  const shouldShowPending = (framingDraftPending || isSessionRunning()) && !sessionTranscript;
  const pending = shouldShowPending ? framingThinkingHtml() : "";
  const hasThreadContent = Boolean(messages || sessionTranscript || pending || projectCards);
  const nextHtml = [messages, sessionTranscript, pending, projectCards].filter(Boolean).join("");
  if (nextHtml !== lastFramingHtml) {
    const renderedDraft = document.querySelector(".project-rendered");
    if (renderedDraft) projectRenderedScrollTop = renderedDraft.scrollTop;
    thread.innerHTML = nextHtml;
    lastFramingHtml = nextHtml;
    requestAnimationFrame(() => {
      const nextRenderedDraft = document.querySelector(".project-rendered");
      if (nextRenderedDraft) {
        nextRenderedDraft.scrollTop = Math.min(projectRenderedScrollTop, nextRenderedDraft.scrollHeight);
      }
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
  };
}

function hydrateSettingsDialog(settings) {
  const form = $("#settings-form");
  const codex = normalizeSessionSettings(settings?.codex || {});
  form.elements.settingsModel.value = codex.model || "";
  form.elements.settingsReasoningEffort.value = codex.reasoningEffort;
  form.elements.settingsPermissionPreset.value = codex.permissionPreset;
  form.elements.settingsWebSearch.checked = Boolean(codex.webSearch);
  form.elements.settingsExtraConfig.value = codex.extraConfig || "";

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
    framingDraftPending = false;
    renderFramingConversation();
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
  if (activeStage === "2") return "Start with /goal.";
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
    launchButton.textContent = gatePassed ? "Reviewer gates passed" : launched ? "Continue /goal" : "Start /goal";
    launchButton.title = gatePassed
      ? "All reviewer gates have passed."
      : locked
        ? "Finish PROJECT.md before starting /goal."
        : "Run the autoresearch loop until reviewer gates pass.";
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
  const hasFramingThread = localMessages.length > 0 || framingDraftPending;
  const nextEditorValue = hasFramingThread ? "" : coldFiles[activeColdPath] ?? "";
  editor.placeholder = hasFramingThread
    ? "Ask Codex to revise PROJECT.md, narrow the scope, change the target venue, or add constraints..."
    : "Research topic, problem, scope, and data or materials to use...";
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
      ${statusMetricHtml("Web", settings.web_search ? "Live search" : "Off")}
    </div>
  `;
}

function statusCardHtml(payload, entry) {
  const sessionId = payload.session_id || "not started";
  const process = payload.process || {};
  const events = payload.events || {};
  const gate = payload.gate || "missing";
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
          ${statusMetricHtml("Trials", `${payload.trials_reported || 0} reported`)}
          ${statusMetricHtml("Gate", gate, gate === "pass" ? "active" : "")}
          ${statusMetricHtml("Stop reason", payload.stop_reason || "none")}
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

function visibleTrialReports() {
  return (appState?.trials || [])
    .filter((trial) => hasVisibleTrial(trial) && String(trial.report_path || "").trim())
    .filter((trial) => !/^0*_?project_conversion/i.test(String(trial.id || "")))
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
}

function reportForIteration(iteration) {
  const index = Math.max(0, Number(iteration || 1) - 1);
  return visibleTrialReports()[index] || null;
}

function currentTrialIndex(reports = visibleTrialReports()) {
  const loopIteration = Number(sessionState().loop_iteration || 0);
  if (isSessionRunning() && loopIteration > 0) return Math.min(Math.max(loopIteration, 1), Math.max(reports.length, 1));
  return Math.max(reports.length, 1);
}

function selectedTrial(reports = visibleTrialReports()) {
  if (!reports.length) return 0;
  const fallback = currentTrialIndex(reports);
  const value = Number(selectedTrialIndex || 0);
  return Math.min(Math.max(value || fallback, 1), reports.length);
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
  if (!report) return "";
  const finalEntry = [...entries].reverse().find((entry) => ["final", "assistant"].includes(transcriptRole(entry)) && String(entry.content || "").trim());
  const fallback = finalEntry ? compactText(finalEntry.content, 260) : "";
  const reportSummary = cleanText(report.report_summary, "");
  const summary = reportSummary || fallback || "Summary is not available yet.";
  const running = isSessionRunning() && Number(sessionState().loop_iteration || 0) === Number(iteration);
  const status = running ? "running" : "completed";
  return `
    <article class="trial-report-card ${running ? "is-running" : "is-complete"}" data-trial-panel="${escapeHtml(iteration)}">
      <div class="trial-report-head">
        <div>
          <strong>Trial ${escapeHtml(iteration)}</strong>
          <em>${escapeHtml(status)}</em>
        </div>
        <span>${escapeHtml(report.id)} / ${escapeHtml(report.report_path)}</span>
      </div>
      <p>${escapeHtml(summary)}</p>
      <div class="trial-report-actions">
        ${report.report_path ? `<button class="secondary-button small-button" type="button" data-inline-fullscreen="${escapeHtml(report.report_path)}">Open report</button>` : ""}
        ${report.review_path ? `<button class="secondary-button small-button" type="button" data-inline-fullscreen="${escapeHtml(report.review_path)}">Open review</button>` : ""}
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

function iterationNavHtml(trials, activeTrial) {
  if (!trials.length) return "";
  return `
    <nav class="trial-strip" aria-label="Autoresearch trials">
      <span>Trials</span>
      <button class="trial-scroll-button" type="button" data-trial-scroll="-1" aria-label="Previous trials">‹</button>
      <div class="trial-strip-scroll">
        ${trials
          .map(({ iteration, entries, report }) => {
            const running = isSessionRunning() && Number(sessionState().loop_iteration || 0) === Number(iteration);
            const label = running ? "Running" : "Done";
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

function trialHistoryHtml(trials, activeTrial, activeTrialData) {
  if (!trials.length) return "";
  const selectedLabel = activeTrial ? `Trial ${activeTrial}` : "No trial selected";
  const latest = trials[trials.length - 1];
  const latestReport = latest?.report?.id ? cleanText(latest.report.id, "") : "";
  return `
    <section class="trial-history-card" aria-label="Autoresearch trials">
      <header class="trial-history-head">
        <div>
          <strong>Trials</strong>
          <span>${escapeHtml(trials.length)} reported · ${escapeHtml(selectedLabel)}</span>
        </div>
        ${latestReport ? `<p>Latest: ${escapeHtml(latestReport)}</p>` : ""}
      </header>
      <div class="trial-history-body">
        ${iterationNavHtml(trials, activeTrial)}
        ${activeTrialData ? trialReportSummaryHtml(activeTrialData.iteration, activeTrialData.entries, activeTrialData.report) : ""}
      </div>
    </section>
  `;
}

function currentRunActivityHtml(entries) {
  if (!entries.length && !isSessionRunning()) return "";
  return `
    <details class="current-run-card">
      <summary>
        <div>
          <strong>${escapeHtml(isSessionRunning() ? "Current session activity" : "Latest session activity")}</strong>
          <span>${escapeHtml(entries.length)} event${entries.length === 1 ? "" : "s"}</span>
        </div>
        <p>Live Codex messages and grouped tool calls from the active session. These are not separate trial reports.</p>
      </summary>
      <div class="current-run-events">
        ${entries.length ? transcriptEntriesHtml(entries) : `<div class="run-waiting">Codex is working. Live events will appear here.</div>`}
      </div>
    </details>
  `;
}

function localSessionActivityHtml(blocks) {
  if (!blocks.length) return "";
  return `
    <details class="current-run-card local-run-card">
      <summary>
        <div>
          <strong>Codex framing activity</strong>
          <span>${escapeHtml(blocks.length)} event${blocks.length === 1 ? "" : "s"}</span>
        </div>
        <p>Commands, tool calls, and intermediate Codex events. Expand only when debugging the run.</p>
      </summary>
      <div class="current-run-events">
        ${blocks.join("")}
      </div>
    </details>
  `;
}

function sessionTimelineHtml(entries) {
  if (!entries.length && !visibleTrialReports().length) return "";
  const localBlocks = [];
  const trialGroups = new Map();
  let currentIteration = 0;
  const hasTrialContext = hasLaunched() || hasGoalStarted() || visibleTrialReports().length > 0;
  entries.forEach((entry) => {
    const nextIteration = effectiveIteration(entry, currentIteration);
    const belongsToGoal = nextIteration > 0 && hasTrialContext;
    if (!belongsToGoal) {
      if (!isUiLocalTranscript(entry)) currentIteration = 0;
      localBlocks.push(transcriptEntryHtml(entry));
      return;
    }
    currentIteration = nextIteration;
    const group = trialGroups.get(currentIteration) || [];
    group.push(entry);
    trialGroups.set(currentIteration, group);
  });

  const reports = visibleTrialReports();
  const maxTrial = Math.max(reports.length, ...Array.from(trialGroups.keys()), 0);
  const trials = [];
  for (let index = 1; index <= maxTrial; index += 1) {
    const trialEntries = trialGroups.get(index) || [];
    const report = reports[index - 1] || null;
    trials.push({ iteration: index, entries: trialEntries, report });
  }
  const activeTrial = selectedTrial(reports);
  const activeTrialData = trials.find((trial) => Number(trial.iteration) === Number(activeTrial));
  const liveTrial = isSessionRunning() ? currentTrialIndex(reports) : 0;
  const liveActivityEntries = liveTrial ? trialGroups.get(liveTrial) || [] : [];
  return `
    <section class="transcript-timeline with-axis" aria-label="Codex transcript">
      ${trialHistoryHtml(trials, activeTrial, activeTrialData)}
      ${currentRunActivityHtml(liveActivityEntries)}
      ${localSessionActivityHtml(localBlocks)}
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

function renderTree(node, depth = 0) {
  if (!node) return empty("No files here yet.");
  if (node.type === "file") {
    if (!node.previewable) {
      return `
        <div class="tree-file is-disabled">
          <span>${escapeHtml(node.name)}</span>
          <small>${escapeHtml(node.path)}</small>
        </div>
      `;
    }
    return `
      <details class="tree-file-node" data-file-details="${escapeHtml(node.path)}">
        <summary>
          <span>${escapeHtml(node.name)}</span>
          <small>${escapeHtml(node.path)}</small>
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
  return `
    <details class="tree-folder" ${depth <= 1 ? "open" : ""}>
      <summary>
        <span>${escapeHtml(node.name)}</span>
        <small>${children.length} ${itemLabel}</small>
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

function renderManuscriptPanel() {
  const manuscript = appState.summaries.manuscript;
  const blueprintViewer = `
    <div class="card-inline-file is-open" data-inline-file="manuscript/BLUEPRINT.md" data-autoload-file="manuscript/BLUEPRINT.md" data-compact-inline="true">
      <div class="tree-empty">Loading blueprint...</div>
    </div>
  `;
  return [
    contextCard("Blueprint", blueprintViewer),
    contextCard("Story", `<p>${escapeHtml(cleanText(manuscript.core_story, "No manuscript story yet."))}</p>`),
    contextCard("Claims", sectionList(manuscript.claims, "No claims yet.")),
    contextCard("Sections", sectionList(manuscript.section_blueprint, "No section plan yet.")),
    contextCard("Figures", sectionList([...(manuscript.figures || []), ...(manuscript.figure_specs || [])], "No figure plan yet."), "", previewButton("manuscript/figures/FIGURE_SPECS.md", "Specs")),
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
  if (!attachments.length) return "";
  return `<div class="message-attachments">${attachments.map(messageAttachmentChip).join("")}</div>`;
}

function renderAttachmentTrays() {
  const html = [...selectedResourceItems.map(linkToChip), ...selectedUploadItems.map(uploadToChip)].join("");
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

function addFilesFromList(files, source = "file") {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return 0;
  list.forEach((file) => addUploadFile(file));
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

function currentBriefText() {
  const editorValue = String($("#cold-file-editor")?.value || "");
  if (activeColdPath && (!hasProjectDraftReady() || editorValue.trim())) coldFiles[activeColdPath] = editorValue;
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
  const current = String(editor.value || "").trim();
  editor.value = current ? `${current}\n${text}` : text;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  editor.focus();
  const end = editor.value.length;
  editor.setSelectionRange(end, end);
}

function renderComposerSuggestions() {
  const row = $("#composer-suggestions");
  if (!row) return;
  const session = sessionState();
  const show = activeView === "chat" && Boolean(session.session_id);
  row.hidden = !show;
  if (!show) return;
  const running = isSessionRunning();
  const loopActive = Boolean(session.loop_active);
  const gateStatus = String(session.gate?.status || session.gate?.raw_status || "").toLowerCase();
  const chips = [];
  const addChip = (label, prompt) => chips.push(`<button class="composer-suggestion-chip" type="button" data-composer-prompt="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`);

  if (gateStatus === "pass") {
    addChip("Show /goal", "/goal");
    addChip("Status", "/status");
    addChip("Diff", "/diff");
  } else if (running) {
    if (loopActive) addChip("Pause /goal", "/goal pause");
    addChip("Show /goal", "/goal");
    addChip("Status", "/status");
    addChip("Processes", "/ps");
  } else {
    if (loopActive) {
      addChip("Pause /goal", "/goal pause");
    } else {
      addChip("Resume /goal", "/goal resume");
    }
    addChip("Show /goal", "/goal");
    addChip("Status", "/status");
    if (running) addChip("Processes", "/ps");
    else addChip("Diff", "/diff");
  }

  row.classList.toggle("is-running", running);
  const label = gateStatus === "pass" ? "Goal passed" : running ? "Running" : loopActive ? "Goal active" : "Goal paused";
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
    showToast("Autoresearch /goal has already started for this session.", true);
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
    if (!hasGoalLaunchMessage()) appendFramingMessage("user", "Start autoresearch with /goal.", { kind: "goal-launch" });
    framingDraftPending = true;
    renderFramingConversation();
    scrollFramingToBottomSoon();
    await saveProjectDraft({ silent: true });
    const files = await collectUploadFiles();
    const response = await api("/api/research/cold-start", {
      method: "POST",
      body: JSON.stringify({ confirmLaunch: true, brief, targetVenue, fileEdits, resourceLinks: collectResourceLinks(), files, settings: settingsFromForm() }),
    });
    mergeSessionFromApiResponse(response);
    framingDraftPending = false;
    $("#launch-dialog")?.close();
    coldDirty = false;
    showToast("Started autoresearch loop with /goal.");
    activeStage = "1";
    await loadOverview(true);
    scrollFramingToBottomSoon();
  } catch (error) {
    framingDraftPending = false;
    renderFramingConversation();
    showToast(error.message, true);
  }
}

async function sendSessionComposerMessage(message) {
  if (!hasActiveProject()) {
    openProjectCreateDialog();
    showToast("Create a project first.", true);
    return;
  }
  const text = String(message || "").trim();
  if (!text && !selectedUploadItems.length) return;
  const localControl = canSendLocalSlashControl(text);
  if (!canMessage() && !localControl) {
    showToast("Wait for the current Codex run to finish before sending another message.", true);
    return;
  }
  const files = await collectUploadFiles();
  const endpoint = text.startsWith("/") ? "/api/research/command" : "/api/research/chat";
  const body = text.startsWith("/")
    ? { command: text, settings: settingsFromForm() }
    : { message: text, files, resourceLinks: collectResourceLinks(), settings: settingsFromForm() };
  const response = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
  mergeSessionFromApiResponse(response);
  renderFramingConversation();
  if (!text.startsWith("/")) selectedUploadItems.splice(0);
  renderSelectedResources();
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
  return response;
}

async function coldStartFromPrepare() {
  if (!hasActiveProject()) {
    openProjectCreateDialog();
    showToast("Create a project first.", true);
    return;
  }
  const input = String($("#cold-file-editor")?.value || "").trim();
  if (!input) {
    showToast(hasProjectDraftReady() ? "Write a message to refine the project." : "Write a research brief before framing.", true);
    setColdViewMode("source");
    $("#cold-file-editor")?.focus();
    return;
  }
  try {
    if (canSendLocalSlashControl(input)) {
      await sendSessionComposerMessage(input);
      $("#cold-file-editor").value = "";
      clearFramingComposerAttachments();
      resizeColdEditor();
      await loadOverview(true);
      scrollFramingToBottomSoon();
      return;
    }
    if (hasLaunched()) {
      await sendSessionComposerMessage(input);
      $("#cold-file-editor").value = "";
      clearFramingComposerAttachments();
      resizeColdEditor();
      await loadOverview(true);
      scrollFramingToBottomSoon();
      return;
    }
    if (isSessionRunning()) {
      showToast("Codex is already running. Wait for the current run to finish.", true);
      return;
    }
    const attachments = currentComposerAttachments();
    appendFramingMessage("user", input, { attachments });
    $("#cold-file-editor").value = "";
    clearFramingComposerAttachments();
    resizeColdEditor();
    framingDraftPending = true;
    renderFramingConversation();
    scrollFramingToBottomSoon();
    await startFramingRun(input);
    framingDraftPending = false;
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
  editingFramingId = "";
  if (index >= 0) {
    localMessages.splice(index + 1, localMessages.length - index - 1);
  }
  setHiddenProjectDraft("");
  projectDraftDirty = false;
  await saveFramingMessages();
  renderFramingConversation();
  try {
    framingDraftPending = true;
    renderFramingConversation();
    scrollFramingToBottomSoon();
    await startFramingRun(next);
    framingDraftPending = false;
    renderFramingConversation();
    scrollFramingToBottomSoon();
    showToast("Codex is reframing PROJECT.md.");
    await loadOverview(true);
    scrollFramingToBottomSoon();
  } catch (error) {
    framingDraftPending = false;
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
  if (!message && !selectedUploadItems.length) return;
  const localControl = canSendLocalSlashControl(message);
  if (!canMessage() && !localControl) {
    showToast("Wait for the current Codex run to finish before sending another message.", true);
    return;
  }

  try {
    const files = await collectUploadFiles();
    const endpoint = message.startsWith("/") ? "/api/research/command" : "/api/research/chat";
    const body = message.startsWith("/")
      ? { command: message, settings: settingsFromForm() }
      : { message, files, resourceLinks: collectResourceLinks(), settings: settingsFromForm() };
    const response = await api(endpoint, { method: "POST", body: JSON.stringify(body) });
    mergeSessionFromApiResponse(response);
    if (!message.startsWith("/")) selectedUploadItems.splice(0);
    renderSelectedResources();
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

function resizeComposer() {
  const textarea = $("#chat-form textarea");
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
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
    if (!hasProjectDraftReady() && activeColdPath) {
      coldFiles[activeColdPath] = $("#cold-file-editor").value;
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
      const card = cardPreview.closest(".context-card");
      const target = card?.querySelector(".card-inline-file");
      if (target) {
        target.hidden = !target.hidden;
        if (!target.hidden && !target.dataset.loaded) {
          target.dataset.loaded = "true";
          loadInlineFile(cardPreview.dataset.cardPreview, target, true);
        }
      }
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
        strip.scrollBy({
          left: Number(trialScroll.dataset.trialScroll || 1) * Math.max(180, strip.clientWidth * 0.72),
          behavior: "smooth",
        });
      }
      return;
    }
    const trialSelect = event.target.closest("[data-trial-select]");
    if (trialSelect) {
      const strip = trialSelect.closest(".trial-strip")?.querySelector(".trial-strip-scroll");
      const scrollLeft = strip ? strip.scrollLeft : 0;
      selectedTrialIndex = Number(trialSelect.dataset.trialSelect || 0);
      renderFramingConversation();
      requestAnimationFrame(() => {
        const nextStrip = document.querySelector(".trial-strip-scroll");
        if (nextStrip) nextStrip.scrollLeft = scrollLeft;
      });
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
