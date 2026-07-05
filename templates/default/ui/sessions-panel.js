/* CoAutoResearch — Sessions rail + isolated Chat surface.
 * The rail lists one fixed CoAutoResearch run and any number of ordinary Chat
 * sessions. Chat sessions are independent CLI contexts with private workspaces.
 */
(function () {
  "use strict";

  var FIXED_RUN_LABEL = "CoAutoResearch";

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
    planModeArmed: {},
    clearNotices: {},
    editingMessageIndex: null,
  };

  var autoCreateCheckedFor = "";
  var pendingRenameSessionId = "";
  var pendingClearSessionId = "";

  function projectId() { return window.activeProjectId || ""; }

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

  function currentSettings() {
    var settings = typeof ui().settingsFromForm === "function" ? ui().settingsFromForm() : {};
    settings = Object.assign({}, settings || {});
    var controller = composerController();
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

  function normalizeSession(session) {
    if (!session) return session;
    var normalized = Object.assign({}, session);
    if (normalized.kind === "monitor" || normalized.kind === "idea") {
      normalized.kind = "chat";
    }
    normalized.chat_history = Array.isArray(normalized.chat_history) ? normalized.chat_history : [];
    normalized.transcript = Array.isArray(normalized.transcript) ? normalized.transcript : [];
    normalized.plan_artifacts = normalized.plan_artifacts && typeof normalized.plan_artifacts === "object" ? normalized.plan_artifacts : {};
    return normalized;
  }

  function visibleSessions() {
    return state.sessions.map(normalizeSession).filter(function (session) {
      return session && (session.kind === "chat" || session.kind === "evolution");
    });
  }

  function displayTitle(session) {
    if (session && session.kind === "evolution") return FIXED_RUN_LABEL;
    return String(session?.title || KIND_META.chat.label || "Chat");
  }

  function railTitle(session) {
    if (session && session.kind === "evolution") return "Autoresearch session";
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
      var existing = (r.sessions || []).map(normalizeSession);
      var hasEvolution = existing.some(function (session) { return session.kind === "evolution"; });
      if (!hasEvolution) {
        await apiCall("/api/sessions", { method: "POST", body: JSON.stringify({ kind: "evolution", title: FIXED_RUN_LABEL }) });
        r = await apiCall("/api/sessions");
        existing = (r.sessions || []).map(normalizeSession);
      }
      state.sessions = mergeSessionList(existing);
      if (!state.activeId && state.sessions.length) {
        var evolution = state.sessions.find(function (session) { return session.kind === "evolution"; });
        state.activeId = evolution ? evolution.id : state.sessions[0].id;
      }
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
    // Same rule for both kinds: only show a status dot when there's an
    // actual status to report, so Autoresearch session (usually idle) reads
    // as plain text exactly like an idle chat row, with no icon of its own.
    var showDot = statusClass !== "idle";
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
      await ui().copyTextToClipboard(command, "Resume command copied.");
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      notify("Resume command copied.");
    } catch {
      notify("Could not copy resume command.", true);
    }
  }

  function sessionStatusClass(session) {
    if (session && session.running) return "running";
    var status = String((session && session.status) || "idle").toLowerCase();
    if (status === "error") return "error";
    if (status === "interrupted") return "interrupted";
    return "idle";
  }

  function sessionStatusLabel(session) {
    if (session && session.running) return "Running";
    var status = String((session && session.status) || "idle").toLowerCase();
    if (status === "error") return "Error";
    if (status === "interrupted") return "Interrupted";
    return "Idle";
  }

  function renderSessionView(options) {
    var session = visibleSessions().find(function (item) { return item.id === state.activeId; });
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
        return ui().planCardHtml(
          { id: "session-plan-" + planId, kind: "plan", artifact: artifact },
          { includeProjectLaunch: false }
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
    });
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
        title: "What should we work on?",
        body: "Ask about this project, brainstorm ideas, or check the current research progress.",
      });
    }
    return sessionMessageHtml({
      role: "control",
      text: "What should we work on?\n\nAsk about this project, brainstorm ideas, or check the current research progress.",
    }, "empty");
  }

  function renderSessionComposer(session) {
    hydrateSessionComposer(session);
    var input = document.getElementById("sv-chat-input");
    var sendBtn = document.getElementById("sv-chat-send");
    document.querySelectorAll("[data-session-clear-context]").forEach(function (button) {
      button.dataset.sessionClearContext = session?.id || "";
      button.disabled = !session?.id || session?.kind === "evolution";
    });
    document.querySelectorAll("[data-session-monitor-prompt]").forEach(function (button) {
      button.dataset.sessionMonitorPrompt = session?.id || "";
      button.disabled = !session?.id || session?.kind === "evolution";
    });
    if (input) {
      input.placeholder = session.running ? "Session is running…" : "Message this session…";
      input.disabled = !!session.running;
      autoResizeSessionInput(input);
    }
    var controller = composerController();
    if (sendBtn && controller?.syncAction) {
      controller.syncAction({
        stopMode: !!session.running,
        disabled: !session.running && !composerHasContent(),
        sendHtml: sendIconHtml(),
      });
      sendBtn.dataset.stopMode = session.running ? "true" : "false";
    } else if (sendBtn) {
      var stopMode = !!session.running;
      sendBtn.classList.toggle("is-stop-mode", stopMode);
      sendBtn.dataset.stopMode = stopMode ? "true" : "false";
      sendBtn.disabled = stopMode ? false : !composerHasContent();
      sendBtn.setAttribute("aria-label", stopMode ? "Stop answering" : "Send");
      sendBtn.title = stopMode ? "Stop answering" : "Send";
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
    var base = composerBaseSettings();
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

  function composerBaseSettings() {
    var form = document.getElementById("session-settings-form");
    return {
      backend: form?.elements?.backend?.value || "",
      model: document.getElementById("composer-model")?.value || form?.elements?.model?.value || "",
      reasoningEffort: document.getElementById("composer-reasoning")?.value || form?.elements?.reasoningEffort?.value || "",
    };
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
    renderSessionComposer(visibleSessions().find(function (item) { return item.id === state.activeId; }) || {});
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

  function addAttachmentFiles(files) {
    Array.from(files || []).forEach(function (file) {
      state.attachments.push({
        id: String(Date.now()) + "-" + Math.random().toString(16).slice(2),
        file: file,
        name: file.name || "attachment",
        size: file.size || 0,
        type: file.type || "",
      });
    });
    renderAttachmentTray();
    renderSessionComposer(visibleSessions().find(function (item) { return item.id === state.activeId; }) || {});
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
      if (state.wsPath) {
        var parts = state.wsPath.split("/").filter(Boolean);
        var root = el("span", null, "/");
        root.style.cursor = "pointer";
        root.onclick = function () { loadWorkspace(currentSessionId(), ""); };
        bcEl.appendChild(root);
        var acc = "";
        parts.forEach(function (part) {
          bcEl.appendChild(el("span", null, " / "));
          acc = acc ? acc + "/" + part : part;
          (function (path, label) {
            var seg = el("span", null, label);
            seg.style.cursor = "pointer";
            seg.onclick = function () { loadWorkspace(currentSessionId(), path); };
            bcEl.appendChild(seg);
          })(acc, part);
        });
      } else {
        bcEl.appendChild(el("span", null, "/"));
      }
    }

    var listEl = document.getElementById("sv-ws-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (state.wsPath) {
      var back = el("div", "sv-ws-back", "↑ ..");
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
      row.appendChild(el("span", "sv-ws-item-icon", item.is_dir ? "▸" : fileIcon(item.name)));
      row.appendChild(el("span", "sv-ws-item-name", item.name));
      if (!item.is_dir) {
        var actions = el("div", "sv-ws-item-actions");
        var viewBtn = el("button", "sv-ws-item-act", "Preview");
        viewBtn.title = "Preview";
        viewBtn.onclick = function (event) { event.stopPropagation(); previewFile(currentSessionId(), item.path); };
        actions.appendChild(viewBtn);
        var dlBtn = el("button", "sv-ws-item-act", "Download");
        dlBtn.title = "Download";
        dlBtn.onclick = function (event) { event.stopPropagation(); downloadFile(currentSessionId(), item.path); };
        actions.appendChild(dlBtn);
        row.appendChild(actions);
      }
      row.onclick = function () {
        if (item.is_dir) {
          var nextPath = state.wsPath ? state.wsPath + "/" + item.name : item.name;
          loadWorkspace(currentSessionId(), nextPath);
        } else {
          previewFile(currentSessionId(), item.path);
        }
      };
      listEl.appendChild(row);
    });
  }

  function currentSessionId() { return state.activeId; }

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

  function openViewer(name, content, isImage, imageUrl, options) {
    options = options || {};
    closeViewer();
    var overlay = el("div", "cas-viewer-overlay");
    overlay.id = "cas-viewer-overlay";
    overlay.onclick = closeViewer;
    document.body.appendChild(overlay);

    var modal = el("div", "cas-viewer");
    modal.id = "cas-viewer";
    var head = el("div", "cas-viewer-head");
    head.appendChild(el("span", null, name));
    var closeBtn = el("button", "cas-viewer-close", "×");
    closeBtn.onclick = closeViewer;
    head.appendChild(closeBtn);
    modal.appendChild(head);

    var body = el("div", "cas-viewer-body");
    if (isImage && imageUrl) {
      var img = el("img");
      img.src = imageUrl;
      body.appendChild(img);
    } else if (options.kind === "pdf" && options.url) {
      var pdf = el("iframe", "cas-viewer-frame");
      pdf.src = options.url;
      pdf.title = name;
      body.appendChild(pdf);
    } else if (options.kind === "html" && options.url) {
      var html = el("iframe", "cas-viewer-frame");
      html.src = options.url;
      html.title = name;
      html.setAttribute("sandbox", "");
      body.appendChild(html);
    } else {
      body.textContent = content;
    }
    modal.appendChild(body);
    document.body.appendChild(modal);
  }

  function closeViewer() {
    var overlay = document.getElementById("cas-viewer-overlay");
    var modal = document.getElementById("cas-viewer");
    if (overlay) overlay.remove();
    if (modal) modal.remove();
  }

  async function loadSessions() {
    try {
      if (!projectId()) {
        state.sessions = [];
        state.activeId = "";
        state.surfaceActive = false;
        renderAll();
        return;
      }
      await ensureDefaults();
      var previousActive = visibleSessions().find(function (session) { return session.id === state.activeId; });
      var r = await apiCall("/api/sessions");
      state.sessions = mergeSessionList((r.sessions || []).map(normalizeSession));
      if (!state.activeId && state.sessions.length) {
        var evolution = state.sessions.find(function (session) { return session.kind === "evolution"; });
        state.activeId = evolution ? evolution.id : state.sessions[0].id;
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
    try {
      var r = await apiCall("/api/sessions", { method: "POST", body: JSON.stringify({ kind: "chat" }) });
      state.sessions = mergeSessionList((r.result.sessions || state.sessions).map(normalizeSession));
      state.activeId = r.result.session.id;
      state.surfaceActive = true;
      state.attachments = [];
      state.wsPath = "";
      state.wsItems = [];
      await selectSession(r.result.session.id);
      focusSessionComposer();
    } catch (err) {
      notify("Create failed: " + err.message, true);
    }
  }

  async function deleteSession(id) {
    if (!confirm("Delete this chat session? Its workspace and context will be permanently removed.")) return;
    var deletedActive = state.activeId === id;
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id), { method: "DELETE" });
      state.sessions = mergeSessionList((r.result.sessions || []).map(normalizeSession));
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
      updateSession(normalizeSession(r.result.session));
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
      state.sessions = mergeSessionList((r.result.sessions || state.sessions).map(normalizeSession));
      updateSession(normalizeSession(r.result.session));
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
    var current = visibleSessions().find(function (session) { return session.id === id; });
    state.activeId = id;
    state.surfaceActive = Boolean(current && current.kind !== "evolution");
    state.openMenuId = "";
    state.attachments = [];
    state.editingMessageIndex = null;
    state.wsPath = "";
    state.wsItems = [];

    if (current && current.kind === "evolution") {
      enterEvolutionView();
      return;
    }

    renderAll();
    connectEvents(id);
    loadWorkspace(id, "");

    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id));
      if (state.activeId !== id) return;
      var fetched = normalizeSession(r.session);
      updateSession(fetched);
      state.surfaceActive = Boolean(fetched && fetched.kind !== "evolution");
      if (fetched && fetched.kind === "evolution") {
        enterEvolutionView();
        return;
      }
    } catch (err) {
      console.warn("[sessions] failed to fetch session", err);
    }
    if (state.activeId !== id) return;
    renderAll();
  }

  function sessionSummaryKey(session) {
    if (!session) return "";
    var transcript = Array.isArray(session.transcript) ? session.transcript : [];
    var latestTranscript = transcript.length ? (transcript[transcript.length - 1]?.id || transcript[transcript.length - 1]?.content || "") : "";
    return [session.id, session.title || "", session.status || "", session.running ? "1" : "0", session.started_at || "", session.last_event_at || "", session.last_event_summary || "", transcript.length, latestTranscript].join("|");
  }

  async function refreshSessionSnapshot(id, options) {
    options = options || {};
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id));
      updateSession(normalizeSession(r.session));
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
    options = options || {};
    var editIndex = Number.isInteger(options.editIndex) ? options.editIndex : null;
    var isEdit = editIndex !== null;
    var planState = sessionPlanModeState(id);
    var isPlanSend = !isEdit && planState.armed;
    var requestText = requestMessageText(text);
    var displayText = displayMessageText(text);
    var files = [];
    var attachmentSnapshot = state.attachments.slice();
    if (!isEdit) {
      try {
        files = await collectAttachmentPayloads();
      } catch (err) {
        notify("Attachment read failed: " + err.message, true);
        return;
      }
      var input = document.getElementById("sv-chat-input");
      if (input) {
        input.value = "";
        autoResizeSessionInput(input);
      }
      state.attachments = [];
    }
    var session = state.sessions.find(function (item) { return item.id === id; });
    var previousHistory = session ? (session.chat_history || []).slice() : [];
    var previousStatus = session ? session.status : "idle";
    var previousTranscript = session ? (session.transcript || []).slice() : [];
    var previousStartedAt = session ? session.started_at : "";
    if (session) {
      session.chat_history = isEdit ? previousHistory.slice(0, editIndex) : (session.chat_history || []);
      session.chat_history.push({ role: "user", text: displayText });
      session.running = true;
      session.status = "running";
      session.started_at = new Date().toISOString();
      session.transcript = [];
      state.editingMessageIndex = null;
      state.clearNotices[id] = "";
      renderSessionView(isEdit ? { focusIndex: editIndex, scrollToBottom: false } : { scrollToBottom: true });
    }
    try {
      var body = { message: requestText, settings: currentSettings() };
      var endpoint = "/api/sessions/" + encodeURIComponent(id) + (isPlanSend ? "/plan" : "/chat");
      if (isPlanSend) {
        body.files = files;
        if (planState.revisePlanId) body.revisePlanId = planState.revisePlanId;
      } else if (isEdit) {
        body.editIndex = editIndex;
      } else {
        body.files = files;
      }
      var r = await apiCall(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (isPlanSend) setSessionPlanModeState(id, null);
      if (!isEdit) state.attachments = [];
      updateSession(normalizeSession(r.result.session));
      if (state.activeId === id) connectEvents(id);
      renderAll();
      if (isEdit && state.activeId === id) scrollSessionMessageIntoView(editIndex);
      if (state.activeId === id) loadWorkspace(id, state.wsPath || "");
    } catch (err) {
      if (session) {
        session.chat_history = previousHistory;
        session.running = false;
        session.status = previousStatus;
        session.transcript = previousTranscript;
        session.started_at = previousStartedAt;
      }
      if (isEdit) {
        state.editingMessageIndex = editIndex;
      } else {
        state.attachments = attachmentSnapshot;
        var input = document.getElementById("sv-chat-input");
        if (input && !input.value) {
          input.value = text;
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
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/monitor-progress-prompt");
      if (state.activeId !== id) return;
      var controller = composerController();
      var input = controller?.textarea || document.getElementById("sv-chat-input");
      if (!input) return;
      if (controller?.setValue) controller.setValue(String(r.prompt || "").trim());
      else input.value = String(r.prompt || "").trim();
      autoResizeSessionInput(input);
      renderSessionComposer(visibleSessions().find(function (item) { return item.id === state.activeId; }) || {});
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
    if (state.activeId !== id) return;
    var requestedPath = relPath || "";
    state.wsPath = requestedPath;
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/workspace?path=" + encodeURIComponent(requestedPath));
      if (state.activeId !== id) return;
      state.wsItems = r.items || [];
      renderWorkspace();
    } catch (err) {
      if (state.activeId !== id) return;
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
      var isImage = kind === "image" || mime.startsWith("image/");
      var rawUrl = withProject("/api/sessions/" + encodeURIComponent(id) + "/workspace/file?path=" + encodeURIComponent(relPath) + "&raw=1");
      var imageUrl = isImage ? "data:" + r.content_type + ";base64," + r.content : "";
      openViewer(r.name || relPath, isImage ? "" : (r.content || "(empty)"), isImage, imageUrl, {
        kind: kind || (mime.includes("pdf") ? "pdf" : ""),
        mime: r.content_type || "",
        url: rawUrl,
      });
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
    session = normalizeSession(session);
    rememberSessionEventId(session);
    var idx = state.sessions.findIndex(function (item) { return item.id === session.id; });
    if (idx >= 0) state.sessions[idx] = Object.assign({}, state.sessions[idx], session);
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

  function mergeSessionList(sessions) {
    var previous = {};
    state.sessions.forEach(function (session) { previous[session.id] = session; });
    return (sessions || []).map(function (session) {
      session = normalizeSession(session);
      rememberSessionEventId(session);
      return Object.assign({}, previous[session.id] || {}, session);
    });
  }

  function connectEvents(id) {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
      state.eventSourceId = "";
    }
    if (!id) return;
    var since = Number(state.eventLastIds[id] || 0);
    var url = withProject("/api/sessions/" + encodeURIComponent(id) + "/events" + (since > 0 ? "?since=" + encodeURIComponent(String(since)) : ""));
    var es = new EventSource(url);
    state.eventSource = es;
    state.eventSourceId = id;
    es.addEventListener("research", function (event) {
      try {
        if (state.eventSourceId !== id) return;
        var data = JSON.parse(event.data);
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
        } else if (data.kind === "completed" || data.kind === "error") {
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
      note.textContent = "Renaming changes the chat label only. It does not move workspace files.";
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
        autoResizeSessionInput(input);
        renderSessionComposer(visibleSessions().find(function (item) { return item.id === state.activeId; }) || {});
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
        var planApprove = event.target.closest("[data-plan-approve]");
        if (planApprove) {
          event.preventDefault();
          event.stopPropagation();
          var approvePlanId = planApprove.dataset.planApprove || "";
          apiCall("/api/sessions/" + encodeURIComponent(state.activeId) + "/plan/approve", {
            method: "POST",
            body: JSON.stringify({ planId: approvePlanId, settings: currentSettings() }),
          }).then(function (r) {
            updateSession(normalizeSession(r.result.session));
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
          renderSessionMessages(visibleSessions().find(function (item) { return item.id === state.activeId; }) || {}, { preserveScroll: true });
          return;
        }
        var editButton = event.target.closest("[data-session-message-edit]");
        if (!editButton) return;
        var index = Number(editButton.dataset.sessionMessageEdit);
        var session = visibleSessions().find(function (item) { return item.id === state.activeId; });
        var message = session?.chat_history?.[index];
        if (!message || session?.running) return;
        state.editingMessageIndex = index;
        renderSessionMessages(session, { focusIndex: index, scrollToBottom: false });
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
      event.currentTarget.dataset.hydratedFor = state.activeId || "";
      event.currentTarget.dataset.hydratedKey = currentSessionComposerHydrationKey();
      syncSessionReasoningOptions();
      fitSessionComposerSelects();
    });
    document.getElementById("sv-composer-reasoning")?.addEventListener("change", function (event) {
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
        renderAttachmentTray();
        renderSessionComposer(visibleSessions().find(function (item) { return item.id === state.activeId; }) || {});
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

    setInterval(function () {
      if (!window.activeProjectId) return;
      var shouldRefresh = state.surfaceActive || state.sessions.some(function (session) { return session.running; });
      if (shouldRefresh) loadSessions();
    }, 15000);
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
    state.activeId = "";
    state.surfaceActive = false;
    state.wsPath = "";
    state.wsItems = [];
    loadSessions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }

  window.CoAutoSessions = {
    syncProject: syncActiveProject,
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
