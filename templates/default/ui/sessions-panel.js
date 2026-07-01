/* CoAutoResearch — Multi-session panel (isolated monitor / idea / evolution).
 * Self-contained: mounts its own floating sidebar and talks to /api/sessions/*.
 * Does not depend on app.js internals beyond the global `activeProjectId`. */
(function () {
  "use strict";

  var KIND_META = {
    monitor: { label: "Monitor", icon: "📊", hint: "Ask about progress, best result, vs baseline, which ideas worked." },
    idea: { label: "Idea", icon: "💡", hint: "Discuss ideas, clone repos, read papers, reproduce baselines." },
    evolution: { label: "Evolution", icon: "⚙️", hint: "The persistent autoresearch loop." },
  };

  var state = {
    sessions: [],
    activeId: "",
    eventSource: null,
    open: false,
  };

  function projectId() {
    return window.activeProjectId || "";
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

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ---- rendering --------------------------------------------------------
  function render() {
    var root = document.getElementById("cas-panel");
    if (!root) return;
    var list = root.querySelector(".cas-list");
    list.innerHTML = "";

    ["monitor", "idea", "evolution"].forEach(function (kind) {
      var group = state.sessions.filter(function (s) { return s.kind === kind; });
      var header = el("div", "cas-group-head");
      header.appendChild(el("span", "cas-group-title", KIND_META[kind].icon + " " + KIND_META[kind].label));
      var addBtn = el("button", "cas-add", "+");
      addBtn.title = "New " + KIND_META[kind].label + " session";
      addBtn.onclick = function () { createSession(kind); };
      header.appendChild(addBtn);
      list.appendChild(header);

      if (!group.length) {
        list.appendChild(el("div", "cas-empty", "No " + KIND_META[kind].label.toLowerCase() + " sessions"));
      }
      group.forEach(function (s) {
        var card = el("div", "cas-card" + (s.id === state.activeId ? " is-active" : ""));
        var dot = el("span", "cas-dot " + (s.running ? "running" : (s.status || "idle")));
        card.appendChild(dot);
        var main = el("div", "cas-card-main");
        main.appendChild(el("div", "cas-card-title", s.title || s.id));
        main.appendChild(el("div", "cas-card-sub", (s.running ? "running" : (s.status || "idle")) + (s.last_event_at ? " · " + s.last_event_at.slice(11, 16) : "")));
        card.appendChild(main);
        card.onclick = function () { selectSession(s.id); };

        var actions = el("div", "cas-card-actions");
        var refreshBtn = el("button", "cas-icon-btn", "⟳");
        refreshBtn.title = "Refresh (clear context, start fresh)";
        refreshBtn.onclick = function (e) { e.stopPropagation(); refreshSession(s.id); };
        actions.appendChild(refreshBtn);
        var delBtn = el("button", "cas-icon-btn cas-danger", "✕");
        delBtn.title = "Delete session";
        delBtn.onclick = function (e) { e.stopPropagation(); deleteSession(s.id); };
        actions.appendChild(delBtn);
        card.appendChild(actions);
        list.appendChild(card);
      });
    });

    renderChat();
  }

  function renderChat() {
    var pane = document.getElementById("cas-chat");
    if (!pane) return;
    var s = state.sessions.find(function (x) { return x.id === state.activeId; });
    if (!s) {
      pane.innerHTML = '<div class="cas-chat-empty">Select or create a session to start.</div>';
      return;
    }
    pane.innerHTML = "";
    var head = el("div", "cas-chat-head");
    head.appendChild(el("span", "cas-chat-title", KIND_META[s.kind].icon + " " + (s.title || s.id)));
    if (s.kind === "idea" && s.workspace) {
      var ws = el("span", "cas-chat-ws", "workspace: " + s.workspace);
      ws.title = s.workspace;
      head.appendChild(ws);
    }
    pane.appendChild(head);
    pane.appendChild(el("div", "cas-chat-hint", KIND_META[s.kind].hint));

    var log = el("div", "cas-chat-log");
    (s.chat_history || []).forEach(function (m) {
      var row = el("div", "cas-msg cas-msg-" + (m.role || "user"));
      row.appendChild(el("div", "cas-msg-role", m.role === "assistant" ? "Agent" : "You"));
      row.appendChild(el("div", "cas-msg-text", m.text || ""));
      log.appendChild(row);
    });
    if (s.running) {
      var busy = el("div", "cas-msg cas-msg-assistant");
      busy.appendChild(el("div", "cas-msg-role", "Agent"));
      busy.appendChild(el("div", "cas-msg-text cas-busy", "…thinking (" + (s.last_event_summary || "working") + ")"));
      log.appendChild(busy);
    }
    pane.appendChild(log);
    log.scrollTop = log.scrollHeight;

    var form = el("form", "cas-chat-form");
    var input = el("textarea", "cas-chat-input");
    input.placeholder = s.running ? "Session is running…" : "Message this session…";
    input.disabled = !!s.running;
    form.appendChild(input);
    var send = el("button", "cas-send", "Send");
    send.type = "submit";
    send.disabled = !!s.running;
    form.appendChild(send);
    form.onsubmit = function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      sendMessage(s.id, text);
      input.value = "";
    };
    pane.appendChild(form);
  }

  // ---- actions ----------------------------------------------------------
  async function loadSessions() {
    try {
      var r = await apiCall("/api/sessions");
      state.sessions = r.sessions || [];
      if (!state.activeId && state.sessions.length) state.activeId = state.sessions[0].id;
      render();
    } catch (err) { console.warn("[sessions] load failed", err); }
  }

  async function createSession(kind) {
    var title = prompt("Name this " + KIND_META[kind].label + " session:", KIND_META[kind].label + " " + (state.sessions.filter(function (s) { return s.kind === kind; }).length + 1));
    if (title === null) return;
    try {
      var r = await apiCall("/api/sessions", { method: "POST", body: JSON.stringify({ kind: kind, title: title }) });
      state.sessions = r.result.sessions || state.sessions;
      state.activeId = r.result.session.id;
      render();
    } catch (err) { alert("Create failed: " + err.message); }
  }

  async function deleteSession(id) {
    if (!confirm("Delete this session? Its workspace and context will be permanently removed.")) return;
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id), { method: "DELETE" });
      state.sessions = r.result.sessions || [];
      if (state.activeId === id) state.activeId = state.sessions.length ? state.sessions[0].id : "";
      render();
    } catch (err) { alert("Delete failed: " + err.message); }
  }

  async function refreshSession(id) {
    if (!confirm("Refresh this session? The conversation context will be cleared (like opening a fresh session).")) return;
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/refresh", { method: "POST", body: "{}" });
      updateSession(r.result.session);
      render();
    } catch (err) { alert("Refresh failed: " + err.message); }
  }

  async function selectSession(id) {
    state.activeId = id;
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id));
      updateSession(r.session);
    } catch (err) { /* ignore */ }
    render();
    connectEvents(id);
  }

  async function sendMessage(id, text) {
    var s = state.sessions.find(function (x) { return x.id === id; });
    if (s) { (s.chat_history = s.chat_history || []).push({ role: "user", text: text }); s.running = true; renderChat(); }
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/chat", { method: "POST", body: JSON.stringify({ message: text }) });
      updateSession(r.result.session);
      connectEvents(id);
      render();
    } catch (err) { alert("Send failed: " + err.message); loadSessions(); }
  }

  function updateSession(session) {
    if (!session) return;
    var idx = state.sessions.findIndex(function (x) { return x.id === session.id; });
    if (idx >= 0) state.sessions[idx] = Object.assign({}, state.sessions[idx], session);
    else state.sessions.push(session);
  }

  // ---- per-session SSE --------------------------------------------------
  function connectEvents(id) {
    if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
    if (!id) return;
    var url = withProject("/api/sessions/" + encodeURIComponent(id) + "/events");
    var es = new EventSource(url);
    state.eventSource = es;
    es.addEventListener("research", function (ev) {
      try {
        var data = JSON.parse(ev.data);
        if (data.kind === "completed" || data.kind === "error") {
          selectSession(id);
        } else if (data.log || data.transcript_entry) {
          var s = state.sessions.find(function (x) { return x.id === id; });
          if (s && data.log) { s.last_event_summary = data.log; renderChat(); }
        }
      } catch (e) { /* ignore */ }
    });
    es.onerror = function () { /* auto-reconnect handled by browser */ };
  }

  // ---- mount ------------------------------------------------------------
  function mount() {
    if (document.getElementById("cas-launcher")) return;
    var launcher = el("button", "cas-launcher", "⚗ Sessions");
    launcher.id = "cas-launcher";
    launcher.title = "Isolated research sessions";
    launcher.onclick = toggle;
    document.body.appendChild(launcher);

    var panel = el("div", "cas-panel");
    panel.id = "cas-panel";
    panel.hidden = true;
    var head = el("div", "cas-panel-head");
    head.appendChild(el("strong", null, "Research Sessions"));
    var close = el("button", "cas-close", "×");
    close.onclick = toggle;
    head.appendChild(close);
    panel.appendChild(head);
    var body = el("div", "cas-panel-body");
    body.appendChild(el("div", "cas-list"));
    body.appendChild(el("div", "cas-chat", null)).id = "cas-chat";
    panel.appendChild(body);
    document.body.appendChild(panel);
    loadSessions();
    setInterval(function () { if (state.open) loadSessions(); }, 8000);
  }

  function toggle() {
    state.open = !state.open;
    var panel = document.getElementById("cas-panel");
    if (panel) panel.hidden = !state.open;
    if (state.open) loadSessions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
