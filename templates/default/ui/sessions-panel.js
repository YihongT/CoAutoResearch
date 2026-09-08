/* CoAutoResearch — Sessions rail + isolated Chat surface.
 * The rail lists one fixed CoAutoResearch run and any number of ordinary Chat
 * sessions. Chat sessions are independent CLI contexts with private workspaces.
 */
(function () {
  "use strict";

  var FIXED_RUN_LABEL = "CoAutoResearch";
  var DRAFT_CHAT_ID = "__draft_chat__";

  var KIND_META = {
    chat: {
      label: "Chat",
      icon: "✦",
      hint: "Use this as an ordinary project chat. Monitor progress is available as an editable prompt.",
    },
    evolution: {
      label: FIXED_RUN_LABEL,
      icon: "⚙",
      hint: "The persistent autoresearch loop. Use the main controls to start, pause, resume, or continue it.",
    },
  };

  var state = {
    sessions: [],
    draftSession: null,
    activeId: "",
    surfaceActive: false,
    eventSource: null,
    eventSourceId: "",
    eventLastIds: {},
    wsPath: "",
    wsItems: [],
    loadedProjectId: "",
    openMenuId: "",
    attachments: [],
    attachmentLoad: Promise.resolve(),
    planModeArmed: {},
    clearNotices: {},
    composerSelections: {},
    editingMessageIndex: null,
  };

  var pendingSessionSends = new Set();
  var autoCreateCheckedFor = "";
  var pendingRenameSessionId = "";
  var pendingClearSessionId = "";

  function projectId() { return window.activeProjectId || ""; }

  function activeSessionStorageKey() {
    var pid = projectId();
    return pid ? "coauto:sessions:active:" + pid : "";
  }

  function readStoredActiveSessionId() {
    var key = activeSessionStorageKey();
    if (!key) return "";
    try {
      return String(localStorage.getItem(key) || "").trim();
    } catch {
      return "";
    }
  }

  function writeStoredActiveSessionId(id) {
    var key = activeSessionStorageKey();
    if (!key) return;
    try {
      if (id) localStorage.setItem(key, String(id));
      else localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable in private contexts; state.activeId still
      // preserves selection for the current page lifetime.
    }
  }

  function ui() { return window.CoAutoChatUi || {}; }

  function escapeHtml(value) {
    if (ui().escapeHtml) return ui().escapeHtml(value);
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function withProject(path) {
    var pid = projectId();
    if (!pid) return path;
    var join = path.indexOf("?") >= 0 ? "&" : "?";
    return path + join + "project=" + encodeURIComponent(pid);
  }

  async function apiCall(path, options) {
    options = options || {};
    var res = await fetch(withProject(path), Object.assign({
      headers: Object.assign({ "Content-Type": "application/json" }, options.headers || {}),
    }, options));
    var payload = await res.json();
    if (!res.ok || payload.ok === false) {
      throw new Error(payload.error || ("Request failed: " + res.status));
    }
    return payload;
  }

  function notify(message, isError) {
    if (typeof ui().showToast === "function") ui().showToast(message, isError);
    else if (isError) alert(message);
  }

  function currentSettings(includeComposer = true) {
    var settings = typeof ui().settingsFromForm === "function" ? ui().settingsFromForm() : {};
    settings = Object.assign({}, settings || {});
    var controller = includeComposer ? composerController() : null;
    return controller?.settings ? controller.settings(settings) : settings;
  }

  function composerController() {
    if (typeof ui().createComposerController !== "function") return null;
    return ui().createComposerController({
      root: "#sv-chat-form",
      textarea: "#sv-chat-input",
      sendButton: "#sv-chat-send",
      modelSelect: "#sv-composer-model",
      reasoningSelect: "#sv-composer-reasoning",
    });
  }

  function sendIconHtml() {
    return typeof ui().composerSendIconHtml === "function"
      ? ui().composerSendIconHtml()
      : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 19V5m0 0-6 6m6-6 6 6"/></svg>';
  }

  function stopIconHtml() {
    return typeof ui().composerStopIconHtml === "function"
      ? ui().composerStopIconHtml()
      : '<span class="composer-stop-square" aria-hidden="true"></span>';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function normalizeSession(session, previous) {
    if (!session) return session;
    var normalized = Object.assign({}, previous || {}, session);
    if (normalized.kind === "monitor" || normalized.kind === "idea") {
      normalized.kind = "chat";
    }
    var has = Object.prototype.hasOwnProperty;
    normalized.chat_history = has.call(session, "chat_history")
      ? (Array.isArray(session.chat_history) ? session.chat_history : [])
      : (Array.isArray(previous?.chat_history) ? previous.chat_history : []);
    normalized.transcript = has.call(session, "transcript")
      ? (Array.isArray(session.transcript) ? session.transcript : [])
      : (Array.isArray(previous?.transcript) ? previous.transcript : []);
    normalized.plan_artifacts = has.call(session, "plan_artifacts")
      ? (session.plan_artifacts && typeof session.plan_artifacts === "object" ? session.plan_artifacts : {})
      : (previous?.plan_artifacts && typeof previous.plan_artifacts === "object" ? previous.plan_artifacts : {});
    return normalized;
  }

  function isDraftSessionId(id) {
    return String(id || "") === DRAFT_CHAT_ID;
  }

  function newDraftSession() {
    var settings = currentSettings(false);
    return normalizeSession({
      id: DRAFT_CHAT_ID,
      kind: "chat",
      title: "New chat",
      status: "idle",
      running: false,
      backend: normalizeSessionBackend(settings.backend),
      settings: settings,
      chat_history: [],
      transcript: [],
      plan_artifacts: {},
      draft: true,
    });
  }

  function activeSessionForView() {
    if (isDraftSessionId(state.activeId)) return state.draftSession || null;
    return state.sessions.find(function (item) { return item.id === state.activeId; }) || null;
  }

  function chatSessionMessageCount(session) {
    var direct = Number(session?.chat_history_count ?? session?.message_count ?? 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    if (Array.isArray(session?.chat_history)) return session.chat_history.length;
    return 0;
  }

  function sessionTranscriptCount(session) {
    var direct = Number(session?.transcript_count ?? 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    if (Array.isArray(session?.transcript)) return session.transcript.length;
    return 0;
  }

  function isEstablishedChatSession(session) {
    if (!session || session.kind !== "chat" || session.draft) return false;
    if (session.running || String(session.status || "").toLowerCase() === "running") return true;
    if (session.has_chat_history === true) return true;
    if (chatSessionMessageCount(session) > 0) return true;
    if (sessionTranscriptCount(session) > 0) return true;
    if (String(session.cli_session_id || "").trim()) return true;
    return false;
  }

  function visibleSessions() {
    return state.sessions.map(normalizeSession).filter(function (session) {
      if (!session) return false;
      if (session.kind === "evolution") return true;
      return isEstablishedChatSession(session);
    });
  }

  function displayTitle(session) {
    if (session && session.kind === "evolution") return FIXED_RUN_LABEL;
    return String(session?.title || KIND_META.chat.label || "Chat");
  }

  function railTitle(session) {
    if (session && session.kind === "evolution") return "Research session";
    return displayTitle(session);
  }

  function chatSessions() {
    return visibleSessions().filter(function (session) { return session.kind === "chat"; });
  }

  function sessionTime(session) {
    var raw = session?.updated_at || session?.last_event_at || session?.created_at || "";
    var time = Date.parse(raw);
    return Number.isFinite(time) ? time : 0;
  }

  function sortByRecent(a, b) {
    return sessionTime(b) - sessionTime(a);
  }

  async function ensureDefaults() {
    var pid = projectId();
    if (!pid || autoCreateCheckedFor === pid) return;
    autoCreateCheckedFor = pid;
    try {
      var r = await apiCall("/api/sessions");
      if (pid !== projectId()) return;
      var existing = (r.sessions || []).map(normalizeSession);
      var hasEvolution = existing.some(function (session) { return session.kind === "evolution"; });
      if (!hasEvolution) {
        await apiCall("/api/sessions", { method: "POST", body: JSON.stringify({ kind: "evolution", title: FIXED_RUN_LABEL }) });
        if (pid !== projectId()) return;
        r = await apiCall("/api/sessions");
        if (pid !== projectId()) return;
        existing = (r.sessions || []).map(normalizeSession);
      }
      state.sessions = mergeSessionList(existing);
    } catch (err) {
      console.warn("[sessions] ensureDefaults failed", err);
    }
  }

  function clearLegacyDocks() {
    if (typeof window.syncBriefComposerDock === "function") {
      try { window.syncBriefComposerDock(false); } catch (err) { console.warn("[sessions] dock cleanup failed", err); }
    }
    if (typeof window.renderAutoresearchDock === "function") {
      try { window.renderAutoresearchDock("", false); } catch (err) { console.warn("[sessions] autoresearch dock cleanup failed", err); }
    }
    document.body.classList.remove("has-brief-dock", "has-autoresearch-dock", "has-framing-scroll-button");
    var scrollButton = document.getElementById("framing-scroll-bottom");
    if (scrollButton) scrollButton.hidden = true;
  }

  function showSessionsView(show) {
    if (show && (ui().activeNavigationPanel?.() || "chat") !== "chat" && typeof window.setPanel === "function") {
      window.setPanel("chat", { scrollToLatest: false });
    }
    document.body.classList.toggle("has-sessions-active", show);
    var view = document.getElementById("sessions-view");
    if (view) view.classList.toggle("is-active", show);
    if (show) {
      clearLegacyDocks();
      document.querySelectorAll(".rail-action").forEach(function (button) { button.classList.remove("is-active"); });
    }
  }

  function renderRail() {
    var listEl = document.getElementById("rail-sessions-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    var navEl = document.getElementById("rail-sessions");
    // COAUTORESEARCH/Autoresearch session, New chat/Search chats, and the
    // CHATS list are three separate top-level rail children (in that order)
    // so their spacing can be controlled independently of the indented
    // #rail-sessions nav, which now holds only the CHATS list.
    var evolutionSlot = document.getElementById("rail-sessions-evolution");
    var actionsSlot = document.getElementById("rail-sessions-actions-slot");
    if (evolutionSlot) evolutionSlot.innerHTML = "";
    if (actionsSlot) actionsSlot.innerHTML = "";
    // The sessions list is always shown alongside Project files/Resources/...
    // (like Projects is) rather than behind its own "Sessions" toggle -- that
    // toggle made New chat/Search chats/Autoresearch session disappear
    // whenever you looked at another panel, and didn't read as clearly
    // affiliated with Sessions when it was visible.
    var sessionsRailVisible = Boolean(projectId());
    if (navEl) navEl.hidden = !sessionsRailVisible;
    if (evolutionSlot) evolutionSlot.hidden = !sessionsRailVisible;
    if (actionsSlot) actionsSlot.hidden = !sessionsRailVisible;
    // Sidebar-only cosmetics (project list subtitle, rail-nav spacing) key
    // off this instead of has-sessions-active, which only reflects whether
    // the NEW aux chat surface -- not the evolution session -- is the
    // visible main-content panel. Tying sidebar cosmetics to that made them
    // flip depending on which kind of session was last selected.
    document.body.classList.toggle("sessions-rail-active", sessionsRailVisible);
    if (!projectId()) return;

    var sessions = visibleSessions();
    var evolution = sessions.find(function (session) { return session.kind === "evolution"; });
    var chats = chatSessions().sort(sortByRecent);

    if (evolutionSlot) {
      evolutionSlot.appendChild(el("div", "rail-sessions-section-label", "COAUTORESEARCH"));
      if (evolution) evolutionSlot.appendChild(sessionRailItem(evolution));
    }

    var actions = el("div", "rail-sessions-actions");
    var newChat = el("button", "rail-session-action");
    newChat.type = "button";
    newChat.dataset.sessionNewChat = "true";
    newChat.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 19h4L19 9a2.8 2.8 0 0 0-4-4L5 15v4Zm10-12 2 2"/></svg><span>New chat</span>';
    actions.appendChild(newChat);
    var searchChats = el("button", "rail-session-action");
    searchChats.type = "button";
    searchChats.dataset.sessionSearchChats = "true";
    searchChats.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M16 16l5 5"/></svg><span>Search chats</span>';
    actions.appendChild(searchChats);
    if (actionsSlot) actionsSlot.appendChild(actions);

    var history = el("div", "rail-chat-history-scroll");
    history.appendChild(el("div", "rail-sessions-section-label", "CHATS"));
    if (!chats.length) {
      history.appendChild(el("div", "rail-sessions-empty", "No chat sessions"));
    }
    history.addEventListener("scroll", closeOpenSessionMenu);
    chats.forEach(function (session) {
      history.appendChild(sessionRailItem(session));
    });
    listEl.appendChild(history);
    requestAnimationFrame(positionOpenSessionMenu);
  }

  function sessionSelector(id, attr) {
    var escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(String(id || ""))
      : String(id || "").replace(/"/g, '\\"');
    return "[" + attr + "=\"" + escaped + "\"]";
  }

  function positionOpenSessionMenu() {
    if (!state.openMenuId) return;
    var button = document.querySelector(sessionSelector(state.openMenuId, "data-session-menu"));
    var menu = document.querySelector(sessionSelector(state.openMenuId, "data-session-menu-panel"));
    if (!button || !menu || menu.hidden) return;
    var margin = 8;
    menu.style.position = "fixed";
    menu.style.right = "auto";
    menu.style.bottom = "auto";
    menu.style.maxHeight = "calc(100vh - " + (margin * 2) + "px)";
    menu.style.overflowY = "auto";
    var buttonRect = button.getBoundingClientRect();
    var menuRect = menu.getBoundingClientRect();
    var left = Math.min(
      window.innerWidth - menuRect.width - margin,
      Math.max(margin, buttonRect.right - menuRect.width)
    );
    var below = buttonRect.bottom + 6;
    var above = buttonRect.top - menuRect.height - 6;
    var top = below + menuRect.height + margin <= window.innerHeight
      ? below
      : Math.max(margin, above);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  function closeOpenSessionMenu() {
    if (!state.openMenuId) return;
    state.openMenuId = "";
    renderRail();
  }

  function sessionRailItem(session) {
    var kind = session.kind === "evolution" ? "evolution" : "chat";
    var active = state.activeId === session.id && (kind === "evolution" ? !state.surfaceActive : state.surfaceActive);
    var statusClass = sessionStatusClass(session);
    // Idle sessions have no marker. Running sessions share Paper's trailing
    // spinner; errors retain their existing status marker.
    var showDot = statusClass !== "idle" && statusClass !== "running";
    var row = el(
      "div",
      "project-switch-row rail-session-row is-" + kind
        + (active ? " is-active" : "")
        + (showDot ? "" : " has-no-status")
    );
    row.dataset.sessionRow = session.id;
    row.onclick = function (event) {
      if (event.target.closest("[data-session-menu], .rail-session-menu")) return;
      selectSession(session.id);
    };

    var button = el("button", "project-switch rail-session-switch");
    button.type = "button";
    button.onclick = function (event) {
      event.stopPropagation();
      selectSession(session.id);
    };
    if (showDot) {
      var dot = el("span", "project-status-dot " + statusClass);
      dot.title = sessionStatusLabel(session);
      dot.setAttribute("aria-label", sessionStatusLabel(session));
      button.appendChild(dot);
    }
    var text = el("span");
    text.innerHTML = '<strong>' + escapeHtml(railTitle(session)) + '</strong>';
    button.appendChild(text);
    if (statusClass === "running") {
      var spinner = el("span", "nav-running-indicator");
      spinner.title = sessionStatusLabel(session);
      spinner.setAttribute("aria-label", sessionStatusLabel(session));
    }
    row.appendChild(button);

    if (kind === "chat") {
      var menuOpen = state.openMenuId === session.id;
      var menuButton = el("button", "project-menu-button");
      menuButton.type = "button";
      menuButton.dataset.sessionMenu = session.id;
      menuButton.setAttribute("aria-label", "Session options");
      menuButton.setAttribute("aria-haspopup", "menu");
      menuButton.setAttribute("aria-expanded", menuOpen ? "true" : "false");
      menuButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>';
      if (spinner) { menuButton.innerHTML = ""; menuButton.appendChild(spinner); menuButton.title = sessionStatusLabel(session) + " · Session options"; }
      menuButton.onclick = function (event) {
        event.stopPropagation();
        state.openMenuId = state.openMenuId === session.id ? "" : session.id;
        renderRail();
      };
      row.appendChild(menuButton);

      var menu = el("div", "project-menu-popover rail-session-menu");
      menu.setAttribute("role", "menu");
      menu.dataset.sessionMenuPanel = session.id;
      menu.hidden = !menuOpen;
      menu.innerHTML = ''
        + '<button type="button" role="menuitem" data-session-monitor="' + escapeHtml(session.id) + '">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/></svg><span>Monitor progress</span></button>'
        + '<button type="button" role="menuitem" data-session-rename="' + escapeHtml(session.id) + '">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Zm11-13 2 2"/></svg><span>Rename</span></button>'
        + '<button class="is-danger" type="button" role="menuitem" data-session-delete="' + escapeHtml(session.id) + '">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg><span>Delete</span></button>';
      row.appendChild(menu);
    } else {
      // Same slot/size as the chat row's "..." menu button, but a static
      // pinned indicator instead -- evolution has no rename/delete/monitor
      // menu, so this isn't a button, just a same-size visual match.
      var pinBadge = el("span", "project-menu-button rail-session-pin-badge");
      pinBadge.title = "Pinned";
      pinBadge.setAttribute("aria-hidden", "true");
      pinBadge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
      if (spinner) { pinBadge.innerHTML = ""; pinBadge.appendChild(spinner); pinBadge.title = sessionStatusLabel(session); pinBadge.removeAttribute("aria-hidden"); }
      row.appendChild(pinBadge);
    }
    return row;
  }

  function sessionSubtitle(session) {
    if (session && session.running) return "running";
    var status = sessionStatusLabel(session).toLowerCase();
    // Only the CLI's own resumable session id is meaningful here -- it's
    // unique. Falling back to our own session.id (kind + creation
    // timestamp) showed the SAME truncated prefix for every session created
    // the same day, e.g. two different idle chats both showing "CHA20260".
    var id = String(session?.cli_session_id || "").slice(0, 8);
    return id ? status + " · " + id : status;
  }

  function agentLabel(session) {
    var backend = String(session?.backend || session?.settings?.backend || "codex").toLowerCase();
    return backend === "claude" ? "Claude" : "Codex";
  }

  function resumeCommand(session) {
    if (typeof ui().resumeCommandForSession === "function") return ui().resumeCommandForSession(session);
    var sessionId = String(session?.cli_session_id || "").trim();
    if (!sessionId) return "";
    var backend = String(session?.backend || session?.settings?.backend || "codex").toLowerCase();
    var projectRoot = String(session?.project_root || "").trim();
    var workspace = String(session?.workspace || "").trim();
    var quote = typeof ui().shellQuote === "function" ? ui().shellQuote : function (value) {
      var text = String(value || "");
      return /^[A-Za-z0-9_./:=@%+-]+$/.test(text) ? text : "'" + text.replaceAll("'", "'\\''") + "'";
    };
    if (backend === "claude") {
      var claudeParts = ["claude"];
      if (workspace) claudeParts.push("--add-dir", quote(workspace));
      claudeParts.push("--resume", quote(sessionId));
      return projectRoot ? "cd " + quote(projectRoot) + " && " + claudeParts.join(" ") : claudeParts.join(" ");
    }
    var parts = ["codex"];
    if (projectRoot) parts.push("--cd", quote(projectRoot));
    if (workspace) parts.push("--add-dir", quote(workspace));
    parts.push("resume", "--include-non-interactive", quote(sessionId));
    return parts.join(" ");
  }

  async function copySessionResumeCommand() {
    var command = document.getElementById("sv-resume-command-bar")?.dataset?.command || "";
    if (!command) return;
    if (typeof ui().copyTextToClipboard === "function") {
      await ui().copyTextToClipboard(command, "CLI continuation command copied.");
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      notify("CLI continuation command copied.");
    } catch {
      notify("Could not copy resume command.", true);
    }
  }

  function sessionStatusClass(session) {
    var status = String((session && session.status) || "idle").toLowerCase();
    // The initial session list lacks the main run's pause reason. Wait for
    // syncResearchSession before showing an interruption marker.
    if (session?.kind === "evolution" && status === "interrupted" && session.loop_stop_reason === undefined) return "idle";
    if (session?.running || status === "running" || status === "stopping") return "running";
    if (status === "error" || status === "failed") return "error";
    if (status === "interrupted") return "interrupted";
    return "idle";
  }

  function sessionStatusLabel(session) {
    var status = String((session && session.status) || "idle").toLowerCase();
    if (status === "stopping") return "Stopping";
    if (session?.running || status === "running") return "Running";
    if (status === "error") return "Error";
    if (status === "failed") return "Failed";
    if (status === "interrupted" && session.kind === "evolution" && session.loop_stop_reason === "paused_by_user") return "Paused";
    if (status === "interrupted") return "Interrupted";
    return "Idle";
  }

  function renderSessionView(options) {
    var session = activeSessionForView();
    if (!session || !state.surfaceActive) {
      showSessionsView(false);
      return;
    }
    if (session.kind === "evolution") {
      enterEvolutionView();
      return;
    }

    showSessionsView(true);
    renderSessionResumeBar(session);
    renderSessionMessages(session, options);
    renderSessionComposer(session);
    renderWorkspace();
  }

  function enterEvolutionView() {
    state.surfaceActive = false;
    showSessionsView(false);
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
      state.eventSourceId = "";
    }
    if (typeof window.setPanel === "function") {
      try { window.setPanel("chat", { scrollToLatest: false }); } catch (err) { console.warn("[sessions] failed to enter evolution view", err); }
    }
    if (typeof window.renderFramingConversation === "function") {
      try { window.renderFramingConversation(); } catch (err) { console.warn("[sessions] failed to render evolution view", err); }
    }
    renderRail();
    // No rail-action button represents the evolution session, so none
    // should read as active while viewing it -- belt-and-suspenders in case
    // window.setPanel above wasn't available to do this itself.
    document.querySelectorAll(".rail-action").forEach(function (button) {
      button.classList.remove("is-active");
    });
  }

  function renderSessionResumeBar(session) {
    var bar = document.getElementById("sv-resume-command-bar");
    var label = document.getElementById("sv-resume-command-label");
    var text = document.getElementById("sv-resume-command-text");
    var copy = document.getElementById("sv-copy-resume-command");
    if (!bar || !text) return;
    var command = resumeCommand(session);
    var sessionId = String(session?.cli_session_id || "").trim();
    bar.hidden = !sessionId;
    bar.dataset.command = command;
    text.textContent = sessionId ? sessionId.slice(0, 8) : "";
    text.title = command;
    if (label) label.textContent = agentLabel(session) + " CLI";
    if (copy) copy.hidden = !command;
  }

  function renderSessionMessages(session, options) {
    options = options || {};
    var logEl = document.getElementById("sv-chat-log");
    if (!logEl) return;
    var previousScrollTop = logEl.scrollTop;
    var history = session.chat_history || [];
    var resetNotice = state.clearNotices[session.id] || "";
    var showEmpty = !history.length && !session.running && !resetNotice;
    var html = "";
    logEl.classList.toggle("is-empty", showEmpty);
    if (showEmpty) {
      html += emptySessionHtml();
    }
    history.forEach(function (message, index) {
      html += sessionMessageHtml(message, index, session);
    });
    if (resetNotice) {
      html += sessionMessageHtml({ role: "control", text: resetNotice }, "reset", session);
    }
    if (session.running) {
      html += thinkingMessageHtml(session);
    } else if (session.status === "interrupted" && history.length) {
      html += sessionMessageHtml({ role: "control", text: "Response stopped. Send a new message, or edit and resend your previous message to continue." }, "interrupted", session);
    }
    logEl.innerHTML = html;
    if (typeof ui().scheduleWorkingTicker === "function") ui().scheduleWorkingTicker();
    else if (typeof ui().updateWorkingDurations === "function") ui().updateWorkingDurations();
    if (Number.isInteger(options.focusIndex)) {
      scrollSessionMessageIntoView(options.focusIndex);
      return;
    }
    if (options.preserveScroll) {
      logEl.scrollTop = previousScrollTop;
      return;
    }
    if (options.scrollToBottom !== false) {
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function scrollSessionMessageIntoView(index) {
    requestAnimationFrame(function () {
      var selector = '[data-session-message-index="' + CSS.escape(String(index)) + '"]';
      var message = document.querySelector(selector);
      if (message) message.scrollIntoView({ block: "nearest" });
    });
  }

  function sessionEntryTimeValue(value) {
    var text = String(value?.created_at || value?.at || value?.updated_at || "");
    var parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sessionArtifactUpdatedTimeValue(value) {
    var text = String(value?.updated_at || value?.created_at || value?.at || "");
    var parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sessionTranscriptRole(entry) {
    var role = String(entry?.role || "").toLowerCase();
    if (role) return role;
    var kind = String(entry?.kind || "").toLowerCase();
    if (kind === "command") return "command";
    if (kind === "tool") return "tool";
    if (kind === "error") return "tool";
    if (kind === "final") return "final";
    return "assistant";
  }

  function normalizedSessionText(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function sessionPlanActivityEntries(message, index, session, artifact) {
    var entries = Array.isArray(session?.transcript) ? session.transcript : [];
    if (!entries.length) return [];
    var planId = String(message?.plan_id || artifact?.id || "").trim();
    var planText = normalizedSessionText(artifact?.plan_text || artifact?.text || message?.text || "");
    var history = Array.isArray(session?.chat_history) ? session.chat_history : [];
    var userMessage = null;
    for (var cursor = Number(index) - 1; cursor >= 0; cursor -= 1) {
      if (String(history[cursor]?.role || "").toLowerCase() === "user") {
        userMessage = history[cursor];
        break;
      }
    }
    var start = sessionEntryTimeValue(userMessage);
    var end = sessionArtifactUpdatedTimeValue(artifact) || sessionEntryTimeValue(message);
    return entries.filter(function (entry) {
      if (sessionTranscriptRole(entry) === "user") return false;
      var entryArtifactId = String(entry?.artifact?.id || "").trim();
      if (planId && entryArtifactId === planId) return true;
      if (String(entry?.kind || "").toLowerCase() === "plan" && planText && normalizedSessionText(entry?.content) === planText) return true;
      var createdAt = sessionEntryTimeValue(entry);
      if (!start || !createdAt || createdAt < start - 1000) return false;
      if (end && createdAt > end + 1000) return false;
      return true;
    });
  }

  function sessionPlanActivityHtml(message, index, session, artifact) {
    if (typeof ui().inlineRunActivityHtml !== "function") return "";
    var entries = sessionPlanActivityEntries(message, index, session, artifact);
    if (!entries.length) return "";
    var history = Array.isArray(session?.chat_history) ? session.chat_history : [];
    var userMessage = null;
    for (var cursor = Number(index) - 1; cursor >= 0; cursor -= 1) {
      if (String(history[cursor]?.role || "").toLowerCase() === "user") {
        userMessage = history[cursor];
        break;
      }
    }
    var planId = String(message?.plan_id || artifact?.id || "").trim();
    return ui().inlineRunActivityHtml(
      {
        id: "session:" + String(session?.id || "") + ":plan:" + String(planId || index),
        role: "user",
        raw_type: "ui.plan",
        content: userMessage?.text || artifact?.request?.display_message || artifact?.request?.message || "",
        created_at: userMessage?.at || userMessage?.created_at || artifact?.created_at || "",
      },
      entries,
      {
        key: "session-plan:" + String(session?.id || "") + ":" + String(planId || index),
        backend: session?.backend || session?.settings?.backend || artifact?.provider || "codex",
        subtitle: "Plan worked activity",
      }
    );
  }

  function focusSessionEditTextarea(index) {
    requestAnimationFrame(function () {
      var selector = '[data-session-edit-form="' + CSS.escape(String(index)) + '"] textarea';
      var textarea = document.querySelector(selector);
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      var end = String(textarea.value || "").length;
      try { textarea.setSelectionRange(end, end); } catch {}
    });
  }

  function sessionMessageHtml(message, index, session) {
    if (message?.kind === "plan" && message.plan_id) {
      var planId = String(message.plan_id || "").trim();
      var artifact = session?.plan_artifacts && session.plan_artifacts[planId];
      if (session?.running && (!artifact || (!String(artifact.plan_text || artifact.text || artifact.error || "").trim()))) {
        return "";
      }
      if (!artifact) {
        return ui().conversationMessageHtml({ role: "assistant", text: "Planning..." }, {
          id: String(index),
          idAttr: "data-session-message-index",
          role: "assistant",
          title: "CoAutoResearch",
          markdown: false,
          copy: false,
          canEdit: false,
          classExtra: " is-thinking",
        });
      }
      if (typeof ui().planCardHtml === "function") {
        var activityHtml = sessionPlanActivityHtml(message, index, session, artifact);
        return ui().planCardHtml(
          { id: "session-plan-" + planId, kind: "plan", artifact: artifact },
          {
            includeProjectLaunch: false,
            activityHtml: activityHtml,
            handoffToResearch: Boolean(session?.read_only || ui().currentV2ResearchBoard?.()?.legacy === false),
          }
        );
      }
    }
    var role = message.role === "assistant" || message.role === "final"
      ? "assistant"
      : (message.role === "control" || message.role === "system" ? "control" : "user");
    var title = role === "user" ? "You" : (role === "control" ? "Session" : "CoAutoResearch");
    var text = String(message.text || "");
    return ui().conversationMessageHtml({ role: role, text: text }, {
      id: String(index),
      idAttr: "data-session-message-index",
      editFormAttr: "data-session-edit-form",
      editCancelAttr: "data-session-message-edit-cancel",
      editButtonAttr: "data-session-message-edit",
      role: role,
      title: title,
      markdown: role === "assistant" || role === "control",
      copy: role !== "control",
      canEdit: role === "user",
      editing: role === "user" && state.editingMessageIndex === index,
      extraActionsHtml: role === "assistant" && session?.read_only && String(message.text || "").trim()
        ? '<button class="text-button" type="button" data-session-handoff="' + index + '" title="Review this suggestion in the research draft before sending">Add to research draft</button>'
        : "",
    });
  }

  function handoffPlanToResearch(planId) {
    var session = activeSessionForView();
    var artifact = session?.plan_artifacts?.[planId];
    var text = String(artifact?.plan_text || artifact?.text || "").trim();
    if (!artifact || artifact.status !== "ready" || !text) {
      notify("This plan is still being prepared. Wait for it to finish before adding it to your research draft.", true);
      return;
    }
    handoffToResearch(text, "plan");
  }

  function handoffMessageToResearch(index) {
    var session = activeSessionForView();
    var message = session?.chat_history?.[index];
    if (!session?.read_only || message?.role !== "assistant" || !String(message.text || "").trim()) return;
    handoffToResearch(message.text, "suggestion");
  }

  function handoffToResearch(text, label) {
    if (typeof ui().insertComposerPrompt !== "function") {
      notify("The research draft is not ready. Reopen the research session and try again.", true);
      return;
    }
    var main = state.sessions.find(function (item) { return item.kind === "evolution"; });
    if (main) {
      state.activeId = main.id;
      writeStoredActiveSessionId(main.id);
    }
    enterEvolutionView();
    ui().insertComposerPrompt("## Discussion " + label + "\n\n" + text);
    notify("Added to your research draft. Review it before sending.");
  }

  function thinkingMessageHtml(session) {
    if (typeof ui().sessionRunLiveStatusHtml === "function") {
      return ui().sessionRunLiveStatusHtml(session);
    }
    return ui().conversationMessageHtml({ role: "assistant", text: "Working..." }, {
      id: "thinking",
      idAttr: "data-session-message-index",
      role: "assistant",
      title: "CoAutoResearch",
      markdown: false,
      copy: false,
      classExtra: " is-thinking",
      articleExtraAttrs: 'aria-live="polite"',
    });
  }

  function emptySessionHtml() {
    if (typeof ui().emptyWelcomeHtml === "function") {
      return ui().emptyWelcomeHtml({
        eyebrow: "Chat",
        title: "What is worth understanding next?",
        body: "Discuss findings, question an approach, or prepare a suggestion. Add it to the research draft when you are ready to send it.",
      });
    }
    return sessionMessageHtml({
      role: "control",
      text: "What is worth understanding next?\n\nDiscuss findings, question an approach, or prepare a suggestion. Add it to the research draft when you are ready to send it.",
    }, "empty");
  }

  function renderSessionComposer(session) {
    var submitting = pendingSessionSends.has(projectId() + "/" + session.id);
    hydrateSessionComposer(session);
    var input = document.getElementById("sv-chat-input");
    var sendBtn = document.getElementById("sv-chat-send");
    var boundary = document.getElementById("sv-discussion-boundary");
    if (boundary) boundary.hidden = !session.read_only;
    document.querySelectorAll("[data-session-clear-context]").forEach(function (button) {
      button.dataset.sessionClearContext = session?.id || "";
      button.disabled = !session?.id || session?.draft || session?.kind === "evolution";
    });
    document.querySelectorAll("[data-session-monitor-prompt]").forEach(function (button) {
      button.dataset.sessionMonitorPrompt = session?.id || "";
      button.disabled = !session?.id || session?.draft || session?.kind === "evolution";
    });
    if (input) {
      input.placeholder = session.running ? "Session is running…" : "Message this session…";
      input.disabled = !!session.running || submitting;
      autoResizeSessionInput(input);
    }
    var controller = composerController();
    if (sendBtn && controller?.syncAction) {
      controller.syncAction({
        stopMode: !!session.running,
        disabled: submitting || (!session.running && !composerHasContent()),
        sendHtml: sendIconHtml(),
      });
      sendBtn.dataset.stopMode = session.running ? "true" : "false";
    } else if (sendBtn) {
      var stopMode = !!session.running;
      sendBtn.classList.toggle("is-stop-mode", stopMode);
      sendBtn.dataset.stopMode = stopMode ? "true" : "false";
      sendBtn.disabled = submitting || (!stopMode && !composerHasContent());
      sendBtn.setAttribute("aria-label", stopMode ? "Stop current run" : "Send");
      sendBtn.title = stopMode ? "Stop current run" : "Send";
      sendBtn.innerHTML = stopMode ? stopIconHtml() : sendIconHtml();
    }
    renderSessionPlanMode();
    renderAttachmentTray();
    // Workspace panel hidden for now -- re-enable by uncommenting the two
    // lines below (and removing the `hidden` attribute on #sv-ws-col in
    // index.html) once it's ready to ship.
    // var wsCol = document.getElementById("sv-ws-col");
    // if (wsCol) wsCol.hidden = false;
  }

  function hydrateSessionComposer(session) {
    var base = composerBaseSettings(session);
    var backend = normalizeSessionBackend(base.backend || "codex");
    var modelValue = String(base.model || "gpt-5.5");
    var reasoningValue = String(base.reasoningEffort || "medium");
    var hydrationKey = sessionComposerHydrationKey(session?.id || "", backend, modelValue, reasoningValue);
    var model = document.getElementById("sv-composer-model");
    var reasoning = document.getElementById("sv-composer-reasoning");
    if (model?.dataset?.hydratedKey === hydrationKey && reasoning?.dataset?.hydratedKey === hydrationKey) {
      fitSessionComposerSelects();
      return;
    }
    if (model) {
      if (typeof ui().syncModelSelectOptions === "function") {
        ui().syncModelSelectOptions(model, backend, modelValue);
      } else {
        ensureSelectOption(model, modelValue);
        model.value = modelValue;
      }
      model.dataset.hydratedFor = session?.id || "";
      model.dataset.hydratedKey = hydrationKey;
    }
    if (reasoning) {
      if (typeof ui().syncReasoningSelectOptions === "function") {
        ui().syncReasoningSelectOptions(reasoning, backend, model?.value || modelValue, reasoningValue);
      } else {
        ensureSelectOption(reasoning, reasoningValue);
        reasoning.value = reasoningValue;
      }
      reasoning.dataset.hydratedFor = session?.id || "";
      reasoning.dataset.hydratedKey = hydrationKey;
    }
    fitSessionComposerSelects();
  }

  function storedComposerSelection(key) {
    if (state.composerSelections[key]) return state.composerSelections[key];
    try {
      var value = JSON.parse(localStorage.getItem("coauto:sessions:selection:" + key) || "null");
      if (value && typeof value.model === "string" && typeof value.reasoningEffort === "string") {
        state.composerSelections[key] = value;
        return value;
      }
    } catch { /* Fall back to this session's saved runner settings. */ }
    return null;
  }

  function saveComposerSelection(key, value) {
    if (value) state.composerSelections[key] = value;
    else delete state.composerSelections[key];
    try {
      if (value) localStorage.setItem("coauto:sessions:selection:" + key, JSON.stringify(value));
      else localStorage.removeItem("coauto:sessions:selection:" + key);
    } catch {
      notify("Chat model selection could not be saved. Check it before sending after a refresh.", true);
    }
  }

  function composerBaseSettings(session) {
    var form = document.getElementById("session-settings-form");
    var base = {
      backend: form?.elements?.backend?.value || "",
      model: document.getElementById("composer-model")?.value || form?.elements?.model?.value || "",
      reasoningEffort: document.getElementById("composer-reasoning")?.value || form?.elements?.reasoningEffort?.value || "",
    };
    session = session || activeSessionForView();
    var selected = storedComposerSelection(projectId() + "/" + (session?.id || "")) || session?.settings;
    if (selected?.model && normalizeSessionBackend(selected.backend) === normalizeSessionBackend(base.backend)) {
      base.model = selected.model;
      base.reasoningEffort = selected.reasoningEffort;
    }
    return base;
  }

  function rememberComposerSelection() {
    saveComposerSelection(projectId() + "/" + state.activeId, {
      backend: activeComposerBackend(),
      model: document.getElementById("sv-composer-model")?.value || "",
      reasoningEffort: document.getElementById("sv-composer-reasoning")?.value || "",
    });
  }

  function normalizeSessionBackend(value) {
    return typeof ui().normalizeAgentBackend === "function" ? ui().normalizeAgentBackend(value) : (String(value || "").toLowerCase() === "claude" ? "claude" : "codex");
  }

  function activeComposerBackend() {
    var base = composerBaseSettings();
    return normalizeSessionBackend(base.backend || "codex");
  }

  function sessionComposerHydrationKey(id, backend, model, reasoning) {
    return [id || "", normalizeSessionBackend(backend), model || "", reasoning || ""].join("|");
  }

  function currentSessionComposerHydrationKey() {
    var base = composerBaseSettings();
    return sessionComposerHydrationKey(
      state.activeId || "",
      base.backend || "codex",
      base.model || "gpt-5.5",
      base.reasoningEffort || "medium"
    );
  }

  function syncSessionReasoningOptions() {
    var model = document.getElementById("sv-composer-model");
    var reasoning = document.getElementById("sv-composer-reasoning");
    if (!model || !reasoning || typeof ui().syncReasoningSelectOptions !== "function") return;
    ui().syncReasoningSelectOptions(reasoning, activeComposerBackend(), model.value, reasoning.value);
  }

  function clearSessionComposerHydration() {
    ["sv-composer-model", "sv-composer-reasoning"].forEach(function (id) {
      var select = document.getElementById(id);
      if (!select?.dataset) return;
      delete select.dataset.hydratedFor;
      delete select.dataset.hydratedKey;
    });
  }

  function rerenderActiveSessionComposer() {
    if (!state.surfaceActive) return;
    clearSessionComposerHydration();
    renderSessionComposer(activeSessionForView() || {});
  }

  function fitSessionComposerSelects() {
    if (typeof ui().fitComposerSelectWidth !== "function") return;
    requestAnimationFrame(function () {
      ui().fitComposerSelectWidth(document.getElementById("sv-composer-model"));
      ui().fitComposerSelectWidth(document.getElementById("sv-composer-reasoning"));
    });
  }

  function ensureSelectOption(select, value) {
    if (!select || !value) return;
    var exists = Array.from(select.options || []).some(function (option) { return option.value === value; });
    if (!exists) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
  }

  function composerHasContent() {
    return Boolean(String(document.getElementById("sv-chat-input")?.value || "").trim() || state.attachments.length);
  }

  function sessionPlanModeState(id) {
    var entry = state.planModeArmed[id || state.activeId] || {};
    return {
      armed: Boolean(entry.armed),
      revisePlanId: String(entry.revisePlanId || ""),
    };
  }

  function setSessionPlanModeState(id, next) {
    if (!id) return;
    if (!next || !next.armed) {
      delete state.planModeArmed[id];
      return;
    }
    state.planModeArmed[id] = {
      armed: true,
      revisePlanId: String(next.revisePlanId || ""),
    };
  }

  function renderSessionPlanMode() {
    var planState = sessionPlanModeState(state.activeId);
    document.querySelectorAll("[data-session-plan-mode-toggle]").forEach(function (button) {
      button.classList.toggle("is-active", planState.armed);
      button.setAttribute("aria-pressed", planState.armed ? "true" : "false");
      button.setAttribute("aria-label", planState.armed ? "Turn off Plan mode" : "Use Plan mode");
      button.title = planState.revisePlanId
        ? "Plan revision mode"
        : planState.armed ? "Turn off Plan mode" : "Plan mode";
    });
  }

  function renderAttachmentTray() {
    var tray = document.getElementById("sv-attachment-tray");
    if (!tray) return;
    tray.innerHTML = "";
    tray.hidden = !state.attachments.length;
    state.attachments.forEach(function (item) {
      var chip = el("span", "attachment-chip");
      chip.innerHTML = '<span>' + escapeHtml(item.name) + '</span>'
        + '<button type="button" data-session-remove-attachment="' + escapeHtml(item.id) + '" aria-label="Remove ' + escapeHtml(item.name) + '">×</button>';
      tray.appendChild(chip);
    });
  }

  function attachmentDraftKey(id, pid) {
    return (pid || projectId()) + "/chat/" + (id || state.activeId);
  }

  function textDraftKey(key) {
    return "coauto:sessions:draft:" + (key || attachmentDraftKey());
  }

  function saveTextDraft() {
    if (!state.activeId || !state.surfaceActive) return;
    var text = document.getElementById("sv-chat-input")?.value || "";
    try {
      if (text) localStorage.setItem(textDraftKey(), text);
      else localStorage.removeItem(textDraftKey());
    } catch {
      notify("Chat draft could not be saved. Keep this page open or copy your message before leaving.", true);
    }
  }

  function restoreTextDraft() {
    var input = document.getElementById("sv-chat-input");
    if (!input) return;
    try {
      input.value = localStorage.getItem(textDraftKey()) || "";
    } catch {
      input.value = "";
      notify("Chat draft could not be loaded.", true);
    }
    autoResizeSessionInput(input);
  }

  function saveAttachmentDraft() {
    return ui().saveUploadDraft(attachmentDraftKey(), state.attachments);
  }

  function restoreSessionAttachments() {
    var key = attachmentDraftKey();
    state.attachmentLoad = ui().loadUploadDraft(key).then(function (items) {
      if (key !== attachmentDraftKey()) return;
      state.attachments = Array.isArray(items) ? items : [];
      renderAttachmentTray();
      renderSessionComposer(activeSessionForView() || {});
    }).catch(function () {
      if (key === attachmentDraftKey()) notify("Saved attachments could not be loaded. Check them before sending.", true);
    });
    return state.attachmentLoad;
  }

  async function addAttachmentFiles(files) {
    var key = attachmentDraftKey();
    var selectedFiles = Array.from(files || []);
    await state.attachmentLoad;
    if (key !== attachmentDraftKey()) return;
    selectedFiles.forEach(function (file) {
      state.attachments.push({
        id: String(Date.now()) + "-" + Math.random().toString(16).slice(2),
        file: file,
        name: file.name || "attachment",
        size: file.size || 0,
        type: file.type || "",
      });
    });
    saveAttachmentDraft();
    renderAttachmentTray();
    renderSessionComposer(activeSessionForView() || {});
  }

  function fileToPayload(item) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var value = String(reader.result || "");
        resolve({
          name: item.name,
          type: item.type,
          size: item.size,
          contentBase64: value.includes(",") ? value.split(",", 2)[1] : value,
        });
      };
      reader.onerror = function () { reject(reader.error || new Error("Could not read " + item.name)); };
      reader.readAsDataURL(item.file);
    });
  }

  async function collectAttachmentPayloads() {
    return Promise.all(state.attachments.map(fileToPayload));
  }

  function renderWorkspace() {
    var wsCol = document.getElementById("sv-ws-col");
    if (!wsCol || wsCol.hidden) return;

    var bcEl = document.getElementById("sv-ws-breadcrumb");
    if (bcEl) {
      bcEl.innerHTML = "";
      var root = el("button", "sv-ws-crumb", "/");
      root.type = "button";
      root.disabled = !state.wsPath;
      root.onclick = function () { loadWorkspace(currentSessionId(), ""); };
      bcEl.appendChild(root);
      if (state.wsPath) {
        var parts = state.wsPath.split("/").filter(Boolean);
        var acc = "";
        parts.forEach(function (part) {
          var separator = el("span", "sv-ws-crumb-separator", "/");
          separator.setAttribute("aria-hidden", "true");
          bcEl.appendChild(separator);
          acc = acc ? acc + "/" + part : part;
          (function (path, label) {
            var seg = el("button", "sv-ws-crumb", label);
            seg.type = "button";
            seg.disabled = path === state.wsPath;
            seg.onclick = function () { loadWorkspace(currentSessionId(), path); };
            bcEl.appendChild(seg);
          })(acc, part);
        });
      }
    }

    var listEl = document.getElementById("sv-ws-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (state.wsPath) {
      var back = el("button", "sv-ws-back", "↑ ..");
      back.type = "button";
      back.onclick = function () {
        var parts = state.wsPath.split("/").filter(Boolean);
        parts.pop();
        loadWorkspace(currentSessionId(), parts.join("/"));
      };
      listEl.appendChild(back);
    }

    if (!state.wsItems.length) {
      listEl.appendChild(el("div", "sv-ws-empty", state.wsPath ? "(empty folder)" : "(no files yet)"));
      return;
    }

    state.wsItems.forEach(function (item) {
      var row = el("div", "sv-ws-item" + (item.is_dir ? " is-dir" : ""));
      var openBtn = el("button", "sv-ws-item-open");
      openBtn.type = "button";
      openBtn.title = item.is_dir ? "Open folder" : "Preview file";
      openBtn.appendChild(el("span", "sv-ws-item-icon", item.is_dir ? "▸" : fileIcon(item.name)));
      openBtn.appendChild(el("span", "sv-ws-item-name", item.name));
      openBtn.onclick = function () {
        if (item.is_dir) {
          var nextPath = state.wsPath ? state.wsPath + "/" + item.name : item.name;
          loadWorkspace(currentSessionId(), nextPath);
        } else {
          previewFile(currentSessionId(), item.path);
        }
      };
      row.appendChild(openBtn);
      if (!item.is_dir) {
        var actions = el("div", "sv-ws-item-actions");
        var dlBtn = el("button", "sv-ws-item-act", "Download");
        dlBtn.type = "button";
        dlBtn.title = "Download";
        dlBtn.onclick = function () { downloadFile(currentSessionId(), item.path); };
        actions.appendChild(dlBtn);
        row.appendChild(actions);
      }
      listEl.appendChild(row);
    });
  }

  function currentSessionId() { return isDraftSessionId(state.activeId) ? "" : state.activeId; }

  function fileIcon(name) {
    var ext = (name.split(".").pop() || "").toLowerCase();
    if (["md", "txt", "docx", "pptx"].includes(ext)) return "doc";
    if (ext === "pdf") return "pdf";
    if (["html", "htm"].includes(ext)) return "web";
    if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return "img";
    if (["json", "jsonl", "ipynb", "yaml", "yml", "toml"].includes(ext)) return "cfg";
    if (["py", "js", "jsx", "ts", "tsx", "sh", "bash", "zsh", "r", "rb", "php", "pl", "lua", "java", "go", "rs", "c", "h", "cpp", "hpp", "m", "mm", "swift", "kt", "kts", "sql"].includes(ext)) return "code";
    if (["csv", "tsv", "xlsx"].includes(ext)) return "data";
    return "file";
  }

  async function loadSessions() {
    var pid = projectId();
    try {
      if (!projectId()) {
        state.sessions = [];
        state.draftSession = null;
        delete state.planModeArmed[DRAFT_CHAT_ID];
        state.activeId = "";
        state.surfaceActive = false;
        renderAll();
        return;
      }
      var mergeBase = state.sessions.slice();
      await ensureDefaults();
      if (pid !== projectId()) return;
      var previousActive = visibleSessions().find(function (session) { return session.id === state.activeId; });
      var r = await apiCall("/api/sessions");
      if (pid !== projectId()) return;
      state.sessions = mergeSessionList(r.sessions || [], mergeBase);
      if (isDraftSessionId(state.activeId) && state.surfaceActive && state.draftSession) {
        renderAll();
        return;
      }
      if (!state.activeId && state.sessions.length) {
        var storedId = readStoredActiveSessionId();
        var visible = visibleSessions();
        var stored = storedId ? visible.find(function (session) { return session.id === storedId; }) : null;
        var evolution = visible.find(function (session) { return session.kind === "evolution"; });
        var fallback = stored || evolution || visible.find(function (session) { return session.kind === "chat"; });
        state.activeId = fallback ? fallback.id : "";
        state.surfaceActive = (ui().activeNavigationPanel?.() || "chat") === "chat"
          && Boolean(fallback && fallback.kind !== "evolution");
        if (stored && state.surfaceActive) {
          renderRail();
          selectSession(stored.id);
          return;
        }
      }
      var nextActive = visibleSessions().find(function (session) { return session.id === state.activeId; });
      renderRail();
      if (!state.surfaceActive || !nextActive) return;
      if (previousActive && sessionSummaryKey(previousActive) === sessionSummaryKey(nextActive)) return;
      renderSessionView();
    } catch (err) {
      console.warn("[sessions] load failed", err);
    }
  }

  async function createSession() {
    state.draftSession = newDraftSession();
    state.activeId = DRAFT_CHAT_ID;
    state.surfaceActive = true;
    state.openMenuId = "";
    state.attachments = [];
    restoreTextDraft();
    await restoreSessionAttachments();
    state.editingMessageIndex = null;
    delete state.planModeArmed[DRAFT_CHAT_ID];
    state.wsPath = "";
    state.wsItems = [];
    writeStoredActiveSessionId("");
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
      state.eventSourceId = "";
    }
    renderAll();
    focusSessionComposer();
  }

  async function deleteSession(id) {
    if (!confirm("Delete this chat session? Its workspace and context will be permanently removed.")) return;
    var deletedActive = state.activeId === id;
    var deletedAttachmentKey = attachmentDraftKey(id);
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id), { method: "DELETE" });
      await ui().saveUploadDraft(deletedAttachmentKey, []);
      localStorage.removeItem(textDraftKey(deletedAttachmentKey));
      saveComposerSelection(projectId() + "/" + id, null);
      state.sessions = mergeSessionList(r.result.sessions || []);
      delete state.eventLastIds[id];
      if (!deletedActive) {
        renderRail();
        return;
      }
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
        state.eventSourceId = "";
      }
      var nextChat = state.sessions.find(function (session) { return session.kind === "chat"; });
      var evolution = state.sessions.find(function (session) { return session.kind === "evolution"; });
      state.activeId = nextChat ? nextChat.id : (evolution ? evolution.id : "");
      state.wsPath = "";
      state.wsItems = [];
      if (state.activeId) selectSession(state.activeId);
      else {
        state.surfaceActive = false;
        renderAll();
      }
    } catch (err) {
      notify("Delete failed: " + err.message, true);
    }
  }

  async function refreshSession(id) {
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/refresh", { method: "POST", body: "{}" });
      updateSession(r.result.session);
      state.wsPath = "";
      state.clearNotices[id] = "Agent context reset. Chat history stayed visible; the next run will start fresh and reread the saved chat history.";
      renderAll();
    } catch (err) {
      throw err;
    }
  }

  async function renameSession(id, title) {
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ title: title }) });
      state.sessions = mergeSessionList(r.result.sessions || state.sessions);
      updateSession(r.result.session);
      renderRail();
      if (state.activeId === id) renderSessionView({ preserveScroll: true });
      notify("Session renamed.");
    } catch (err) {
      throw err;
    }
  }

  async function stopSession(id) {
    try {
      await apiCall("/api/sessions/" + encodeURIComponent(id) + "/stop", { method: "POST", body: "{}" });
      var session = state.sessions.find(function (item) { return item.id === id; });
      if (session) {
        session.running = false;
        session.status = "interrupted";
      }
      renderAll();
    } catch (err) {
      notify("Stop failed: " + err.message, true);
    }
  }

  async function selectSession(id) {
    var pid = projectId();
    var current = visibleSessions().find(function (session) { return session.id === id; });
    if (!current) return;
    state.draftSession = null;
    delete state.planModeArmed[DRAFT_CHAT_ID];
    state.activeId = id;
    state.surfaceActive = Boolean(current && current.kind !== "evolution");
    writeStoredActiveSessionId(id);
    state.openMenuId = "";
    state.attachments = [];
    state.editingMessageIndex = null;
    state.wsPath = "";
    state.wsItems = [];

    if (current && current.kind === "evolution") {
      enterEvolutionView();
      return;
    }

    restoreTextDraft();
    await restoreSessionAttachments();
    if (pid !== projectId() || state.activeId !== id) return;

    renderAll();
    connectEvents(id);
    loadWorkspace(id, "");

    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id));
      if (pid !== projectId() || state.activeId !== id || !state.surfaceActive) return;
      var existing = state.sessions.find(function (item) { return item.id === id; });
      var fetched = normalizeSession(r.session, existing);
      updateSession(fetched);
      state.surfaceActive = Boolean(fetched && fetched.kind !== "evolution");
      if (fetched && fetched.kind === "evolution") {
        enterEvolutionView();
        return;
      }
    } catch (err) {
      console.warn("[sessions] failed to fetch session", err);
    }
    if (pid !== projectId() || state.activeId !== id || !state.surfaceActive) return;
    renderAll();
  }

  function sessionSummaryKey(session) {
    if (!session) return "";
    var transcript = Array.isArray(session.transcript) ? session.transcript : [];
    var latestTranscript = transcript.length ? (transcript[transcript.length - 1]?.id || transcript[transcript.length - 1]?.content || "") : "";
    return [session.id, session.title || "", session.status || "", session.running ? "1" : "0", session.started_at || "", session.last_event_at || "", session.last_event_summary || "", transcript.length, latestTranscript].join("|");
  }

  async function refreshSessionSnapshot(id, options) {
    var pid = projectId();
    options = options || {};
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id));
      if (pid !== projectId()) return;
      updateSession(r.session);
      renderAll();
      if (options.workspace && state.activeId === id) loadWorkspace(id, state.wsPath || "");
    } catch (err) {
      console.warn("[sessions] snapshot refresh failed", err);
    }
  }

  function displayMessageText(text) {
    var value = String(text || "").trim();
    if (value) return value;
    if (state.attachments.length) return "Please review the attached file(s).";
    return "";
  }

  function requestMessageText(text) {
    return displayMessageText(text);
  }

  async function sendMessage(id, text, options) {
    var pid = projectId();
    var key = pid + "/" + id;
    if (pendingSessionSends.has(key)) return;
    pendingSessionSends.add(key);
    renderSessionComposer(activeSessionForView() || {});
    try {
      return await submitSessionMessage(id, text, options);
    } finally {
      pendingSessionSends.delete(key);
      if (pid === projectId()) renderSessionComposer(activeSessionForView() || {});
    }
  }

  async function submitSessionMessage(id, text, options) {
    var pid = projectId();
    await state.attachmentLoad;
    if (pid !== projectId() || state.activeId !== id) return;
    options = options || {};
    var editIndex = Number.isInteger(options.editIndex) ? options.editIndex : null;
    var isEdit = editIndex !== null;
    var planState = sessionPlanModeState(id);
    var previousPlanState = { armed: planState.armed, revisePlanId: planState.revisePlanId };
    var isPlanSend = planState.armed;
    var requestText = requestMessageText(text);
    var displayText = displayMessageText(text);
    var files = [];
    var attachmentSnapshot = state.attachments.slice();
    var draftSend = isDraftSessionId(id);
    var draftSessionAtStart = state.draftSession;
    var draftSessionSnapshot = draftSend && draftSessionAtStart ? normalizeSession(draftSessionAtStart) : null;
    if (!isEdit) {
      try {
        files = await collectAttachmentPayloads();
      } catch (err) {
        if (pid !== projectId() || state.activeId !== id) return;
        notify("Attachment read failed: " + err.message, true);
        return;
      }
      if (pid !== projectId() || state.activeId !== id) return;
      var input = document.getElementById("sv-chat-input");
      if (input) {
        input.value = "";
        saveTextDraft();
        autoResizeSessionInput(input);
      }
      state.attachments = [];
      saveAttachmentDraft();
    }
    if (draftSend) {
      try {
        var created = await apiCall("/api/sessions", { method: "POST", body: JSON.stringify({ kind: "chat" }) });
        if (pid !== projectId()) return;
        var draftStillSelected = state.surfaceActive && state.activeId === DRAFT_CHAT_ID && state.draftSession === draftSessionAtStart;
        state.sessions = mergeSessionList(created.result.sessions || state.sessions);
        updateSession(created.result.session);
        var createdId = String(created.result.session?.id || "");
        if (!createdId) throw new Error("Created session missing id");
        if (isPlanSend) {
          setSessionPlanModeState(createdId, previousPlanState);
          if (draftStillSelected) delete state.planModeArmed[DRAFT_CHAT_ID];
          planState = sessionPlanModeState(createdId);
          previousPlanState = { armed: planState.armed, revisePlanId: planState.revisePlanId };
        }
        if (draftStillSelected) {
          var selectionKey = pid + "/" + DRAFT_CHAT_ID;
          if (state.composerSelections[selectionKey]) {
            saveComposerSelection(pid + "/" + createdId, state.composerSelections[selectionKey]);
            saveComposerSelection(selectionKey, null);
          }
          state.draftSession = null;
          state.activeId = createdId;
          state.surfaceActive = true;
          writeStoredActiveSessionId(createdId);
        }
        id = createdId;
        renderRail();
      } catch (err) {
        if (pid !== projectId()) return;
        if (state.activeId !== DRAFT_CHAT_ID || state.draftSession !== draftSessionAtStart) {
          notify("Create failed: " + err.message, true);
          return;
        }
        state.draftSession = draftSessionSnapshot || newDraftSession();
        state.activeId = DRAFT_CHAT_ID;
        state.surfaceActive = true;
        if (isPlanSend) setSessionPlanModeState(DRAFT_CHAT_ID, previousPlanState);
        if (!isEdit) {
          state.attachments = attachmentSnapshot;
          saveAttachmentDraft();
          var draftInput = document.getElementById("sv-chat-input");
          if (draftInput && !draftInput.value) {
            draftInput.value = text;
            saveTextDraft();
            autoResizeSessionInput(draftInput);
          }
          renderAttachmentTray();
        }
        renderSessionView({ preserveScroll: true });
        notify("Create failed: " + err.message, true);
        return;
      }
    }
    var session = state.sessions.find(function (item) { return item.id === id; });
    var previousHistory = session ? (session.chat_history || []).slice() : [];
    var previousStatus = session ? session.status : "idle";
    var previousTranscript = session ? (session.transcript || []).slice() : [];
    var previousStartedAt = session ? session.started_at : "";
    var originalPlanId = "";
    if (isEdit && previousHistory[editIndex + 1]?.kind === "plan") {
      originalPlanId = String(previousHistory[editIndex + 1].plan_id || "").trim();
    }
    var collapsePreviousDuplicateUser = false;
    if (isEdit && editIndex > 0) {
      var previousMessage = previousHistory[editIndex - 1] || {};
      var editedMessage = previousHistory[editIndex] || {};
      collapsePreviousDuplicateUser = String(previousMessage.role || "").toLowerCase() === "user"
        && String(editedMessage.role || "").toLowerCase() === "user"
        && String(previousMessage.text || "").trim() === String(editedMessage.text || "").trim()
        && String(editedMessage.text || "").trim() === displayText;
    }
    if (session) {
      session.chat_history = isEdit ? previousHistory.slice(0, editIndex) : (session.chat_history || []);
      if (collapsePreviousDuplicateUser) session.chat_history.pop();
      session.chat_history.push({ role: "user", text: displayText });
      if (isPlanSend) {
        session.chat_history.push({
          role: "assistant",
          kind: "plan",
          plan_id: "pending-" + id + "-" + Date.now(),
          text: "",
          at: new Date().toISOString(),
        });
      }
      session.running = true;
      session.status = "running";
      session.started_at = new Date().toISOString();
      session.transcript = [];
      state.clearNotices[id] = "";
      renderRail();
      if (state.activeId === id) {
        state.editingMessageIndex = null;
        renderSessionView(isEdit ? { focusIndex: editIndex, scrollToBottom: false } : { scrollToBottom: true });
      }
    }
    try {
      var body = { message: requestText, settings: currentSettings() };
      var endpoint = "/api/sessions/" + encodeURIComponent(id) + (isPlanSend ? "/plan" : "/chat");
      if (isPlanSend) {
        body.files = files;
        if (isEdit) body.editIndex = editIndex;
        if (planState.revisePlanId || originalPlanId) body.revisePlanId = planState.revisePlanId || originalPlanId;
      } else if (isEdit) {
        body.editIndex = editIndex;
      } else {
        body.files = files;
      }
      var r = await apiCall(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (pid !== projectId()) return;
      if (isPlanSend) setSessionPlanModeState(id, null);
      updateSession(r.result.session);
      if (state.activeId === id) connectEvents(id);
      renderAll();
      if (isEdit && state.activeId === id) scrollSessionMessageIntoView(editIndex);
      if (state.activeId === id) loadWorkspace(id, state.wsPath || "");
    } catch (err) {
      if (pid !== projectId()) return;
      if (session) {
        session.chat_history = previousHistory;
        session.running = false;
        session.status = previousStatus;
        session.transcript = previousTranscript;
        session.started_at = previousStartedAt;
      }
      if (isPlanSend) setSessionPlanModeState(id, previousPlanState);
      if (isEdit && state.activeId === id) {
        state.editingMessageIndex = editIndex;
      } else if (!isEdit && state.activeId === id) {
        state.attachments = attachmentSnapshot;
        saveAttachmentDraft();
        var input = document.getElementById("sv-chat-input");
        if (input && !input.value) {
          input.value = text;
          saveTextDraft();
          autoResizeSessionInput(input);
        }
        renderAttachmentTray();
      }
      if (state.activeId === id) renderSessionView({ preserveScroll: true });
      else renderRail();
      notify("Send failed: " + err.message, true);
      loadSessions();
    }
  }

  async function insertMonitorPrompt(id) {
    if (isDraftSessionId(id)) return;
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/monitor-progress-prompt");
      if (state.activeId !== id) return;
      var controller = composerController();
      var input = controller?.textarea || document.getElementById("sv-chat-input");
      if (!input) return;
      if (controller?.setValue) controller.setValue(String(r.prompt || "").trim());
      else input.value = String(r.prompt || "").trim();
      saveTextDraft();
      autoResizeSessionInput(input);
      renderSessionComposer(activeSessionForView() || {});
      if (controller?.focus) controller.focus();
      else input.focus({ preventScroll: true });
      input.setSelectionRange(0, 0);
      input.scrollTop = 0;
      requestAnimationFrame(function () { input.scrollTop = 0; });
      setTimeout(function () { input.scrollTop = 0; }, 50);
    } catch (err) {
      notify("Could not load monitor prompt: " + err.message, true);
    }
  }

  async function loadWorkspace(id, relPath) {
    var pid = projectId();
    if (isDraftSessionId(id)) return;
    if (state.activeId !== id) return;
    var requestedPath = relPath || "";
    state.wsPath = requestedPath;
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/workspace?path=" + encodeURIComponent(requestedPath));
      if (pid !== projectId() || state.activeId !== id || state.wsPath !== requestedPath) return;
      state.wsItems = r.items || [];
      renderWorkspace();
    } catch (err) {
      if (pid !== projectId() || state.activeId !== id || state.wsPath !== requestedPath) return;
      state.wsItems = [];
      renderWorkspace();
      console.warn("[sessions] workspace load failed", err);
    }
  }

  async function previewFile(id, relPath) {
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/workspace/file?path=" + encodeURIComponent(relPath));
      var kind = String(r.kind || "").toLowerCase();
      var mime = String(r.content_type || "").toLowerCase();
      var rawUrl = withProject("/api/sessions/" + encodeURIComponent(id) + "/workspace/file?path=" + encodeURIComponent(relPath) + "&raw=1");
      if (typeof ui().openFilePayloadFullscreen !== "function") throw new Error("File viewer is unavailable");
      ui().openFilePayloadFullscreen({
        exists: true,
        is_dir: false,
        path: relPath,
        text: r.content || "",
        editable: false,
        kind: kind || (mime.includes("pdf") ? "pdf" : "text"),
        mime: r.content_type || "",
        url: rawUrl,
      }, { title: r.name || relPath, cache: false });
    } catch (err) {
      notify("Preview failed: " + err.message, true);
    }
  }

  function downloadFile(id, relPath) {
    var url = withProject("/api/sessions/" + encodeURIComponent(id) + "/workspace/file?path=" + encodeURIComponent(relPath) + "&download=1");
    var a = document.createElement("a");
    a.href = url;
    a.download = relPath.split("/").pop() || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function updateSession(session) {
    if (!session) return;
    var idx = state.sessions.findIndex(function (item) { return item.id === session.id; });
    var previous = idx >= 0 ? state.sessions[idx] : null;
    session = normalizeSession(session, previous);
    rememberSessionEventId(session);
    if (idx >= 0) state.sessions[idx] = session;
    else state.sessions.push(session);
  }

  function rememberSessionEventId(session) {
    if (!session || !session.id) return;
    var eventId = Number(session.event_id || 0);
    if (eventId > Number(state.eventLastIds[session.id] || 0)) {
      state.eventLastIds[session.id] = eventId;
    }
  }

  function upsertSessionTranscriptEntry(session, entry) {
    if (!session || !entry || !entry.content) return;
    var transcript = Array.isArray(session.transcript) ? session.transcript.slice() : [];
    var id = String(entry.id || "").trim();
    if (id) {
      var index = transcript.findIndex(function (item) { return String(item?.id || "") === id; });
      if (index >= 0) transcript[index] = Object.assign({}, transcript[index], entry);
      else transcript.push(entry);
    } else {
      var key = [entry.role || "", entry.kind || "", entry.raw_type || "", entry.content || ""].join("\n");
      var exists = transcript.some(function (item) {
        return [item.role || "", item.kind || "", item.raw_type || "", item.content || ""].join("\n") === key;
      });
      if (!exists) transcript.push(entry);
    }
    session.transcript = transcript.slice(-120);
  }

  function mergeSessionList(sessions, baseSessions) {
    var previous = {};
    (baseSessions || state.sessions).forEach(function (session) { previous[session.id] = session; });
    return (sessions || []).map(function (session) {
      session = normalizeSession(session, previous[session.id]);
      rememberSessionEventId(session);
      return session;
    });
  }

  function connectEvents(id) {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
      state.eventSourceId = "";
    }
    if (!id || isDraftSessionId(id)) return;
    var since = Number(state.eventLastIds[id] || 0);
    var url = withProject("/api/sessions/" + encodeURIComponent(id) + "/events" + (since > 0 ? "?since=" + encodeURIComponent(String(since)) : ""));
    var es = new EventSource(url);
    state.eventSource = es;
    state.eventSourceId = id;
    es.addEventListener("research", function (event) {
      try {
        if (state.eventSource !== es) return;
        var data = JSON.parse(event.data);
        if (data.event_stream_reset) state.eventLastIds[id] = 0;
        var eventId = Number(data.event_id || 0);
        if (eventId > 0) {
          if (eventId <= Number(state.eventLastIds[id] || 0)) return;
          state.eventLastIds[id] = eventId;
        }
        if (data.kind === "plan" && data.plan?.id) {
          var planSession = state.sessions.find(function (item) { return item.id === id; });
          if (planSession) {
            planSession.plan_artifacts = planSession.plan_artifacts && typeof planSession.plan_artifacts === "object" ? planSession.plan_artifacts : {};
            planSession.plan_artifacts[data.plan.id] = data.plan;
            if (state.activeId === id) renderSessionView();
          }
        } else if (data.kind === "completed" || data.kind === "error" || (data.kind === "session" && data.status === "interrupted")) {
          refreshSessionSnapshot(id, { workspace: true });
        } else if (data.log || data.transcript_entry) {
          var session = state.sessions.find(function (item) { return item.id === id; });
          if (session) {
            if (data.log) session.last_event_summary = data.log;
            if (data.transcript_entry) upsertSessionTranscriptEntry(session, data.transcript_entry);
            renderSessionView();
          }
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    });
    es.onerror = function () {};
  }

  function renderAll() {
    renderRail();
    renderSessionView();
  }

  function openSessionRenameDialog(id) {
    var session = visibleSessions().find(function (item) { return item.id === id; });
    if (!session || session.kind === "evolution") return;
    pendingRenameSessionId = id;
    var form = document.getElementById("session-rename-form");
    var input = document.getElementById("session-rename-name");
    var note = document.getElementById("session-rename-note");
    form?.reset();
    if (input) input.value = session.title || "";
    if (note) {
      note.textContent = "";
      note.dataset.tone = "";
    }
    var dialog = document.getElementById("session-rename-dialog");
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute("open", "");
    requestAnimationFrame(function () { input?.focus(); input?.select(); });
  }

  function closeSessionRenameDialog() {
    pendingRenameSessionId = "";
    var dialog = document.getElementById("session-rename-dialog");
    if (!dialog) return;
    if (dialog.close) dialog.close();
    else dialog.removeAttribute("open");
  }

  async function renameSessionFromDialog(event) {
    event.preventDefault();
    if (!pendingRenameSessionId) return;
    var form = event.currentTarget;
    var submit = form.querySelector('button[type="submit"]');
    var input = document.getElementById("session-rename-name");
    var title = String(input?.value || "").trim();
    if (!title) {
      notify("Session title is required.", true);
      return;
    }
    submit.disabled = true;
    try {
      await renameSession(pendingRenameSessionId, title);
      closeSessionRenameDialog();
    } catch (err) {
      var note = document.getElementById("session-rename-note");
      if (note) {
        note.textContent = err.message;
        note.dataset.tone = "error";
      }
      notify("Rename failed: " + err.message, true);
    } finally {
      submit.disabled = false;
    }
  }

  function openClearContextDialog(id) {
    var session = visibleSessions().find(function (item) { return item.id === id; });
    if (!session || session.kind === "evolution") return;
    pendingClearSessionId = id;
    var note = document.getElementById("session-clear-context-note");
    if (note) {
      // Restore the default helper text (distinct from the warning box above
      // it) in case a previous open left an error message here -- it was
      // accidentally duplicating the warning's own sentence instead.
      note.textContent = "Workspace, title, and visible chat history are kept. This does not affect CoAutoResearch or other chats.";
      note.dataset.tone = "";
    }
    var dialog = document.getElementById("session-clear-context-dialog");
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute("open", "");
  }

  function closeClearContextDialog() {
    pendingClearSessionId = "";
    var dialog = document.getElementById("session-clear-context-dialog");
    if (!dialog) return;
    if (dialog.close) dialog.close();
    else dialog.removeAttribute("open");
  }

  async function clearContextFromDialog(event) {
    event.preventDefault();
    if (!pendingClearSessionId) return;
    var form = event.currentTarget;
    var submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      var id = pendingClearSessionId;
      await refreshSession(id);
      closeClearContextDialog();
    } catch (err) {
      var note = document.getElementById("session-clear-context-note");
      if (note) {
        note.textContent = err.message;
        note.dataset.tone = "error";
      }
      notify("Reset failed: " + err.message, true);
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function sessionSearchGroup(session) {
    var time = sessionTime(session);
    if (!time) return "Older";
    var start = new Date(time);
    start.setHours(0, 0, 0, 0);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var diffDays = Math.round((today.getTime() - start.getTime()) / 86400000);
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return "Previous 7 days";
    return "Older";
  }

  function searchMatches(session, query) {
    if (!query) return true;
    var haystack = [
      displayTitle(session),
      session?.id || "",
      session?.cli_session_id || "",
      sessionSubtitle(session),
    ].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function renderSessionSearchResults() {
    var results = document.getElementById("session-search-results");
    if (!results) return;
    var input = document.getElementById("session-search-input");
    var query = String(input?.value || "").trim();
    results.innerHTML = "";

    var newRow = el("button", "session-search-new-chat");
    newRow.type = "button";
    newRow.dataset.sessionSearchNewChat = "true";
    newRow.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 19h4L19 9a2.8 2.8 0 0 0-4-4L5 15v4Zm10-12 2 2"/></svg><span>New chat</span>';
    results.appendChild(newRow);

    var matches = chatSessions().filter(function (session) {
      return searchMatches(session, query);
    }).sort(sortByRecent);
    if (!matches.length) {
      results.appendChild(el("div", "session-search-empty", query ? "No matching chats" : "No chat history yet"));
      return;
    }

    var groups = ["Today", "Yesterday", "Previous 7 days", "Older"];
    groups.forEach(function (group) {
      var groupItems = matches.filter(function (session) { return sessionSearchGroup(session) === group; });
      if (!groupItems.length) return;
      results.appendChild(el("div", "session-search-group-label", group));
      groupItems.forEach(function (session) {
        var row = el("button", "session-search-result");
        row.type = "button";
        row.dataset.sessionSearchSelect = session.id;
        row.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 7a6 6 0 0 1 6-4h2a6 6 0 0 1 0 12h-1l-4 4v-4H7a6 6 0 0 1-2-8Z"/></svg>'
          + '<span><strong>' + escapeHtml(displayTitle(session)) + '</strong><small>' + escapeHtml(sessionSubtitle(session)) + '</small></span>';
        results.appendChild(row);
      });
    });
  }

  function openSessionSearchDialog() {
    renderSessionSearchResults();
    var dialog = document.getElementById("session-search-dialog");
    var input = document.getElementById("session-search-input");
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute("open", "");
    requestAnimationFrame(function () {
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  function closeSessionSearchDialog() {
    var dialog = document.getElementById("session-search-dialog");
    if (!dialog) return;
    if (dialog.close) dialog.close();
    else dialog.removeAttribute("open");
  }

  function focusSessionComposer() {
    var controller = composerController();
    var input = controller?.textarea || document.getElementById("sv-chat-input");
    if (!input) return;
    requestAnimationFrame(function () {
      input.focus({ preventScroll: true });
      autoResizeSessionInput(input);
    });
  }

  function mount() {
    var form = document.getElementById("sv-chat-form");
    if (form) {
      form.onsubmit = function (event) {
        event.preventDefault();
        var send = document.getElementById("sv-chat-send");
        if (send?.dataset?.stopMode === "true") {
          stopSession(state.activeId);
          return;
        }
      var input = document.getElementById("sv-chat-input");
      if (!input) return;
      var text = input.value.trim();
      if (!text && !state.attachments.length) return;
      sendMessage(state.activeId, text);
    };
    }
    var input = document.getElementById("sv-chat-input");
    if (input) {
      input.addEventListener("input", function () {
        saveTextDraft();
        autoResizeSessionInput(input);
        renderSessionComposer(activeSessionForView() || {});
      });
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          form?.requestSubmit();
        }
      });
    }

    var log = document.getElementById("sv-chat-log");
    if (log) {
      log.addEventListener("click", function (event) {
        var messageHandoff = event.target.closest("[data-session-handoff]");
        if (messageHandoff) {
          event.preventDefault();
          handoffMessageToResearch(Number(messageHandoff.dataset.sessionHandoff));
          return;
        }
        var planHandoff = event.target.closest("[data-plan-handoff]");
        var planApprove = event.target.closest("[data-plan-approve]");
        if (planHandoff || planApprove) {
          event.preventDefault();
          event.stopPropagation();
          if (planHandoff || activeSessionForView()?.read_only || ui().currentV2ResearchBoard?.()?.legacy === false) {
            handoffPlanToResearch(planHandoff?.dataset.planHandoff || planApprove.dataset.planApprove || "");
            return;
          }
          var approvePlanId = planApprove.dataset.planApprove || "";
          apiCall("/api/sessions/" + encodeURIComponent(state.activeId) + "/plan/approve", {
            method: "POST",
            body: JSON.stringify({ planId: approvePlanId, settings: currentSettings() }),
          }).then(function (r) {
            updateSession(r.result.session);
            if (state.activeId) connectEvents(state.activeId);
            renderAll();
          }).catch(function (err) {
            notify("Plan approval failed: " + err.message, true);
          });
          return;
        }
        var planRevise = event.target.closest("[data-plan-revise]");
        if (planRevise) {
          event.preventDefault();
          event.stopPropagation();
          setSessionPlanModeState(state.activeId, { armed: true, revisePlanId: planRevise.dataset.planRevise || "" });
          renderSessionPlanMode();
          document.getElementById("sv-chat-input")?.focus();
          return;
        }
        var cancelButton = event.target.closest("[data-session-message-edit-cancel]");
        if (cancelButton) {
          state.editingMessageIndex = null;
          renderSessionMessages(activeSessionForView() || {}, { preserveScroll: true });
          return;
        }
        var editButton = event.target.closest("[data-session-message-edit]");
        if (!editButton) return;
        var index = Number(editButton.dataset.sessionMessageEdit);
        var session = activeSessionForView();
        var message = session?.chat_history?.[index];
        if (!message || session?.running) return;
        var nextMessage = session?.chat_history?.[index + 1];
        if (nextMessage?.kind === "plan" && nextMessage.plan_id) {
          setSessionPlanModeState(state.activeId, { armed: true, revisePlanId: nextMessage.plan_id });
        }
        state.editingMessageIndex = index;
        renderSessionMessages(session, { focusIndex: index, scrollToBottom: false });
        renderSessionPlanMode();
        focusSessionEditTextarea(index);
      });
      log.addEventListener("submit", function (event) {
        var form = event.target.closest("[data-session-edit-form]");
        if (!form) return;
        event.preventDefault();
        var index = Number(form.dataset.sessionEditForm);
        var text = String(form.elements.message?.value || "").trim();
        if (!text) return;
        sendMessage(state.activeId, text, { editIndex: index });
      });
    }

    document.querySelector("[data-session-attach]")?.addEventListener("click", function () {
      document.getElementById("sv-composer-file-input")?.click();
    });
    document.getElementById("sv-composer-file-input")?.addEventListener("change", function (event) {
      addAttachmentFiles(event.target.files || []);
      event.target.value = "";
    });
    document.querySelector("[data-session-plan-mode-toggle]")?.addEventListener("click", function () {
      var current = sessionPlanModeState(state.activeId);
      setSessionPlanModeState(state.activeId, current.armed ? null : { armed: true, revisePlanId: "" });
      renderSessionPlanMode();
    });
    document.getElementById("sv-composer-model")?.addEventListener("change", function (event) {
      syncSessionReasoningOptions();
      rememberComposerSelection();
      event.currentTarget.dataset.hydratedFor = state.activeId || "";
      event.currentTarget.dataset.hydratedKey = currentSessionComposerHydrationKey();
      fitSessionComposerSelects();
    });
    document.getElementById("sv-composer-reasoning")?.addEventListener("change", function (event) {
      rememberComposerSelection();
      event.currentTarget.dataset.hydratedFor = state.activeId || "";
      event.currentTarget.dataset.hydratedKey = currentSessionComposerHydrationKey();
      fitSessionComposerSelects();
    });
    document.getElementById("session-settings-form")?.addEventListener("input", rerenderActiveSessionComposer);
    document.getElementById("session-settings-form")?.addEventListener("change", rerenderActiveSessionComposer);
    document.addEventListener("agent-models-updated", rerenderActiveSessionComposer);
    document.addEventListener("coauto-composer-settings-synced", rerenderActiveSessionComposer);

    var wsRefresh = document.querySelector("[data-sessions-ws-refresh]");
    if (wsRefresh) wsRefresh.onclick = function () { loadWorkspace(currentSessionId(), state.wsPath); };

    document.getElementById("session-search-input")?.addEventListener("input", renderSessionSearchResults);
    document.getElementById("session-search-dialog")?.addEventListener("close", function () {
      var input = document.getElementById("session-search-input");
      if (input) input.value = "";
    });

    document.body.addEventListener("click", function (event) {
      var newChat = event.target.closest("[data-session-new-chat], [data-session-search-new-chat]");
      if (newChat) {
        event.preventDefault();
        closeSessionSearchDialog();
        createSession();
        return;
      }
      var searchChats = event.target.closest("[data-session-search-chats]");
      if (searchChats) {
        event.preventDefault();
        openSessionSearchDialog();
        return;
      }
      var searchSelect = event.target.closest("[data-session-search-select]");
      if (searchSelect) {
        event.preventDefault();
        var selectedId = searchSelect.dataset.sessionSearchSelect;
        closeSessionSearchDialog();
        if (selectedId) selectSession(selectedId).then(focusSessionComposer);
        return;
      }
      if (event.target.closest("[data-session-search-close]")) {
        event.preventDefault();
        closeSessionSearchDialog();
        return;
      }
      var monitor = event.target.closest("[data-session-monitor]");
      var monitorPrompt = event.target.closest("[data-session-monitor-prompt]");
      if (monitor || monitorPrompt) {
        event.preventDefault();
        var id = monitor?.dataset?.sessionMonitor || monitorPrompt?.dataset?.sessionMonitorPrompt || state.activeId;
        state.openMenuId = "";
        if (id) selectSession(id).then(function () { insertMonitorPrompt(id); });
        return;
      }
      var rename = event.target.closest("[data-session-rename]");
      if (rename) {
        event.preventDefault();
        state.openMenuId = "";
        openSessionRenameDialog(rename.dataset.sessionRename);
        renderRail();
        return;
      }
      var del = event.target.closest("[data-session-delete]");
      if (del) {
        event.preventDefault();
        state.openMenuId = "";
        deleteSession(del.dataset.sessionDelete);
        return;
      }
      var clear = event.target.closest("[data-session-clear-context]");
      if (clear) {
        event.preventDefault();
        openClearContextDialog(clear.dataset.sessionClearContext || state.activeId);
        return;
      }
      var remove = event.target.closest("[data-session-remove-attachment]");
      if (remove) {
        event.preventDefault();
        state.attachments = state.attachments.filter(function (item) { return item.id !== remove.dataset.sessionRemoveAttachment; });
        saveAttachmentDraft();
        renderAttachmentTray();
        renderSessionComposer(activeSessionForView() || {});
        return;
      }
      var copyResume = event.target.closest("[data-session-copy-resume]");
      if (copyResume) {
        event.preventDefault();
        copySessionResumeCommand();
        return;
      }
      if (state.openMenuId && !event.target.closest(".rail-session-menu") && !event.target.closest("[data-session-menu]")) {
        state.openMenuId = "";
        renderRail();
      }
    });

    document.getElementById("session-rename-form")?.addEventListener("submit", renameSessionFromDialog);
    document.querySelectorAll("[data-session-rename-close]").forEach(function (button) {
      button.addEventListener("click", closeSessionRenameDialog);
    });
    document.getElementById("session-rename-dialog")?.addEventListener("close", function () {
      pendingRenameSessionId = "";
    });
    document.getElementById("session-clear-context-form")?.addEventListener("submit", clearContextFromDialog);
    document.querySelectorAll("[data-session-clear-context-close]").forEach(function (button) {
      button.addEventListener("click", closeClearContextDialog);
    });
    document.getElementById("session-clear-context-dialog")?.addEventListener("close", function () {
      pendingClearSessionId = "";
    });

    renderRail();

    if (window.activeProjectId) {
      state.loadedProjectId = window.activeProjectId;
      loadSessions();
    }

    setInterval(syncActiveProject, 1500);

    var railPollPending = false;
    var lastRailPoll = 0;
    setInterval(async function () {
      if (!window.activeProjectId) return;
      var running = state.sessions.some(function (session) { return sessionStatusClass(session) === "running"; });
      if (railPollPending || (!running && (!state.surfaceActive || Date.now() - lastRailPoll < 15000))) return;
      railPollPending = true;
      lastRailPoll = Date.now();
      try { await loadSessions(); } finally { railPollPending = false; }
    }, 2000);
  }

  // Also called directly by app.js (window.CoAutoSessions.syncProject) the
  // moment it resolves the real activeProjectId, since that's frequently
  // still empty at mount (before /api/projects returns) -- without the
  // direct call, the whole Sessions rail area stayed blank for however long
  // the 1500ms poll in mount() took to notice the change.
  function syncActiveProject() {
    var pid = window.activeProjectId || "";
    if (pid === state.loadedProjectId) return;
    state.loadedProjectId = pid;
    autoCreateCheckedFor = "";
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
      state.eventSourceId = "";
    }
    state.sessions = [];
    state.draftSession = null;
    state.planModeArmed = {};
    state.clearNotices = {};
    state.eventLastIds = {};
    state.attachments = [];
    state.editingMessageIndex = null;
    state.openMenuId = "";
    state.activeId = "";
    state.surfaceActive = false;
    state.wsPath = "";
    state.wsItems = [];
    var input = document.getElementById("sv-chat-input");
    if (input) input.value = "";
    renderAll();
    loadSessions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  function syncResearchSession(pid, session, running) {
    if (pid !== projectId() || !session?.status) return;
    var evolution = state.sessions.find(function (item) { return item.kind === "evolution"; });
    var stopReason = String(session.loop_stop_reason || "");
    if (!evolution || (evolution.status === session.status && evolution.running === running && evolution.loop_stop_reason === stopReason)) return;
    evolution.status = session.status;
    evolution.running = running;
    evolution.loop_stop_reason = stopReason;
    renderRail();
  }

  window.CoAutoSessions = {
    syncProject: syncActiveProject,
    syncResearchSession: syncResearchSession,
    leave: function () {
      if (!state.surfaceActive && !document.body.classList.contains("has-sessions-active")) return;
      state.surfaceActive = false;
      state.openMenuId = "";
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
        state.eventSourceId = "";
      }
      showSessionsView(false);
      renderRail();
    },
    reload: loadSessions,
  };

  function autoResizeSessionInput(input) {
    if (!input) return;
    input.style.height = "auto";
    var max = 180;
    var nextHeight = Math.min(max, Math.max(44, input.scrollHeight || 44));
    input.style.height = nextHeight + "px";
    input.closest(".sessions-chat-form")?.classList.toggle(
      "has-expanded-input",
      nextHeight > 58 || String(input.value || "").includes("\n")
    );
  }
})();
