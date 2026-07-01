/* CoAutoResearch — Multi-session panel (embedded in rail + main-stage).
 * Session list lives in the left rail; selecting a session shows its chat
 * in the #sessions-view alongside the workspace file browser.
 * Selecting the Evolution session switches back to the main chat-view.
 */
(function () {
  "use strict";

  var KIND_META = {
    monitor: { label: "Monitor", icon: "📊", hint: "Ask about progress, best result, vs baseline, which ideas worked. Context auto-refreshes before each message." },
    idea: { label: "Idea", icon: "💡", hint: "Discuss ideas, clone repos, read papers, reproduce baselines. Files saved in workspace on the right." },
    evolution: { label: "Evolution", icon: "⚙️", hint: "The persistent autoresearch loop. Use Start / Pause / Resume in the main UI." },
  };

  var state = {
    sessions: [],
    activeId: "",
    eventSource: null,
    wsPath: "",
    wsItems: [],
  };

  function projectId() { return window.activeProjectId || ""; }

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

  // ---- auto-create default sessions -----------------------------------
  var autoCreateChecked = false;

  async function ensureDefaults() {
    if (autoCreateChecked) return;
    autoCreateChecked = true;
    try {
      var r = await apiCall("/api/sessions");
      var existing = r.sessions || [];
      var hasMonitor = existing.some(function (s) { return s.kind === "monitor"; });
      var hasEvolution = existing.some(function (s) { return s.kind === "evolution"; });
      var created = false;
      if (!hasMonitor) {
        await apiCall("/api/sessions", { method: "POST", body: JSON.stringify({ kind: "monitor", title: "Monitor" }) });
        created = true;
      }
      if (!hasEvolution) {
        await apiCall("/api/sessions", { method: "POST", body: JSON.stringify({ kind: "evolution", title: "Evolution Run" }) });
        created = true;
      }
      if (created) {
        r = await apiCall("/api/sessions");
        state.sessions = r.sessions || [];
      } else {
        state.sessions = existing;
      }
      if (!state.activeId && state.sessions.length) {
        var mon = state.sessions.find(function (s) { return s.kind === "monitor"; });
        state.activeId = mon ? mon.id : state.sessions[0].id;
      }
    } catch (err) { console.warn("[sessions] ensureDefaults failed", err); }
  }

  // ---- show / hide sessions-view vs chat-view -------------------------
  function showSessionsView(show) {
    document.body.classList.toggle("has-sessions-active", show);
    var sv = document.getElementById("sessions-view");
    if (sv) sv.classList.toggle("is-active", show);
    if (show) {
      document.querySelectorAll(".rail-action").forEach(function (b) { b.classList.remove("is-active"); });
    } else {
      var chatBtn = document.querySelector('.rail-action[data-view="chat"]');
      if (chatBtn) chatBtn.classList.add("is-active");
    }
  }

  // ---- rendering: rail session list -----------------------------------
  function renderRail() {
    var listEl = document.getElementById("rail-sessions-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    var navEl = document.getElementById("rail-sessions");
    if (navEl) navEl.hidden = !projectId();

    ["monitor", "idea", "evolution"].forEach(function (kind) {
      var group = state.sessions.filter(function (s) { return s.kind === kind; });
      var groupWrap = el("div", "rail-sessions-group");
      var label = el("div", "rail-sessions-group-label");
      label.appendChild(el("span", null, KIND_META[kind].icon + " " + KIND_META[kind].label));
      var addBtn = el("button", "rail-sessions-add", "+");
      addBtn.title = "New " + KIND_META[kind].label + " session";
      addBtn.onclick = function () { createSession(kind); };
      label.appendChild(addBtn);
      groupWrap.appendChild(label);

      if (!group.length) {
        groupWrap.appendChild(el("div", "rail-sessions-empty", "No " + kind + " sessions"));
      }
      group.forEach(function (s) {
        var item = el("div", "rail-session-item" + (s.id === state.activeId ? " is-active" : "") + (kind === "evolution" ? " is-evolution" : ""));
        var dot = el("span", "rail-session-dot " + (s.running ? "running" : (s.status || "idle")));
        item.appendChild(dot);
        item.appendChild(el("span", "rail-session-name", s.title || s.id));
        var actions = el("div", "rail-session-actions");
        var refreshBtn = el("button", "rail-session-act", "⟳");
        refreshBtn.title = "Clear context";
        refreshBtn.onclick = function (e) { e.stopPropagation(); refreshSession(s.id); };
        actions.appendChild(refreshBtn);
        var delBtn = el("button", "rail-session-act danger", "✕");
        delBtn.title = "Delete session";
        delBtn.onclick = function (e) { e.stopPropagation(); deleteSession(s.id); };
        actions.appendChild(delBtn);
        item.appendChild(actions);
        item.onclick = function () { selectSession(s.id); };
        groupWrap.appendChild(item);
      });
      listEl.appendChild(groupWrap);
    });
  }

  // ---- rendering: main-stage session view -----------------------------
  function renderSessionView() {
    var s = state.sessions.find(function (x) { return x.id === state.activeId; });
    if (!s) {
      showSessionsView(false);
      return;
    }

    // Evolution session → show main chat-view
    if (s.kind === "evolution") {
      showSessionsView(false);
      // Restore the Agents rail-action as active
      var chatBtn = document.querySelector('.rail-action[data-view="chat"]');
      if (chatBtn) chatBtn.classList.add("is-active");
      return;
    }

    // Monitor / Idea → show sessions-view
    showSessionsView(true);

    // Title
    var titleEl = document.getElementById("sv-title");
    if (titleEl) titleEl.textContent = KIND_META[s.kind].icon + " " + (s.title || s.id);

    // Hint
    var hintEl = document.getElementById("sv-hint");
    if (hintEl) hintEl.textContent = KIND_META[s.kind].hint;

    // Toolbar
    var toolsEl = document.getElementById("sv-tools");
    if (toolsEl) {
      toolsEl.innerHTML = "";
      if (s.running) {
        var stopBtn = el("button", "sv-tool-btn stop", "⏹ Stop");
        stopBtn.title = "Terminate the current run";
        stopBtn.onclick = function () { stopSession(s.id); };
        toolsEl.appendChild(stopBtn);
      }
      var clearBtn = el("button", "sv-tool-btn clear", "🗑 Clear Context");
      clearBtn.title = "Clear conversation context and rebuild from latest project state";
      clearBtn.onclick = function () { refreshSession(s.id); };
      toolsEl.appendChild(clearBtn);
    }

    // Chat log
    var logEl = document.getElementById("sv-chat-log");
    if (logEl) {
      logEl.innerHTML = "";
      (s.chat_history || []).forEach(function (m) {
        var row = el("div", "sv-msg sv-msg-" + (m.role || "user"));
        row.appendChild(el("div", "sv-msg-role", m.role === "assistant" ? "Agent" : "You"));
        row.appendChild(el("div", "sv-msg-text", m.text || ""));
        logEl.appendChild(row);
      });
      if (s.running) {
        var busy = el("div", "sv-msg sv-msg-assistant");
        busy.appendChild(el("div", "sv-msg-role", "Agent"));
        busy.appendChild(el("div", "sv-msg-text sv-msg-busy", "…thinking (" + (s.last_event_summary || "working") + ")"));
        logEl.appendChild(busy);
      }
      logEl.scrollTop = logEl.scrollHeight;
    }

    // Input form
    var input = document.getElementById("sv-chat-input");
    var sendBtn = document.querySelector("#sv-chat-form .sessions-chat-send");
    if (input) {
      input.placeholder = s.running ? "Session is running…" : "Message this session…";
      input.disabled = !!s.running;
    }
    if (sendBtn) sendBtn.disabled = !!s.running;

    // Workspace column visibility
    var wsCol = document.getElementById("sv-ws-col");
    if (wsCol) wsCol.hidden = false;

    renderWorkspace();
  }

  // ---- rendering: workspace file browser ------------------------------
  function renderWorkspace() {
    var wsCol = document.getElementById("sv-ws-col");
    if (!wsCol || wsCol.hidden) return;

    var head = wsCol.querySelector(".sessions-ws-head");
    // Breadcrumb
    var bcEl = document.getElementById("sv-ws-breadcrumb");
    if (bcEl) {
      bcEl.innerHTML = "";
      if (state.wsPath) {
        var parts = state.wsPath.split("/").filter(Boolean);
        var bc = el("span", null, "/");
        bc.style.cursor = "pointer";
        bc.onclick = function () { loadWorkspace(currentSessionId(), ""); };
        bcEl.appendChild(bc);
        var acc = "";
        parts.forEach(function (p, i) {
          bcEl.appendChild(el("span", null, " / "));
          acc = acc ? acc + "/" + p : p;
          (function (path) {
            var seg = el("span", null, p);
            seg.style.cursor = "pointer";
            seg.onclick = function () { loadWorkspace(currentSessionId(), path); };
            bcEl.appendChild(seg);
          })(acc);
        });
      } else {
        bcEl.appendChild(el("span", null, "/"));
      }
    }

    var listEl = document.getElementById("sv-ws-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (state.wsPath) {
      var back = el("div", "sv-ws-back", "⬆ ..");
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
      row.appendChild(el("span", "sv-ws-item-icon", item.is_dir ? "📂" : _fileIcon(item.name)));
      row.appendChild(el("span", "sv-ws-item-name", item.name));
      if (!item.is_dir) {
        var actions = el("div", "sv-ws-item-actions");
        var viewBtn = el("button", "sv-ws-item-act", "👁");
        viewBtn.title = "Preview";
        viewBtn.onclick = function (e) { e.stopPropagation(); previewFile(currentSessionId(), item.path); };
        actions.appendChild(viewBtn);
        var dlBtn = el("button", "sv-ws-item-act", "⬇");
        dlBtn.title = "Download";
        dlBtn.onclick = function (e) { e.stopPropagation(); downloadFile(currentSessionId(), item.path); };
        actions.appendChild(dlBtn);
        row.appendChild(actions);
      }
      row.onclick = function () {
        if (item.is_dir) {
          var np = state.wsPath ? state.wsPath + "/" + item.name : item.name;
          loadWorkspace(currentSessionId(), np);
        } else {
          previewFile(currentSessionId(), item.path);
        }
      };
      listEl.appendChild(row);
    });
  }

  function currentSessionId() {
    return state.activeId;
  }

  function _fileIcon(name) {
    var ext = (name.split(".").pop() || "").toLowerCase();
    if (["md", "txt"].includes(ext)) return "📄";
    if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return "🖼";
    if (["json", "yaml", "yml", "toml"].includes(ext)) return "⚙";
    if (["py", "js", "ts", "sh", "r"].includes(ext)) return "📜";
    if (["csv", "tsv", "xlsx"].includes(ext)) return "📊";
    return "📋";
  }

  // ---- file viewer modal ----------------------------------------------
  function openViewer(name, content, isImage, imageUrl) {
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

  // ---- actions --------------------------------------------------------
  async function loadSessions() {
    try {
      await ensureDefaults();
      var r = await apiCall("/api/sessions");
      state.sessions = r.sessions || [];
      if (!state.activeId && state.sessions.length) {
        var mon = state.sessions.find(function (s) { return s.kind === "monitor"; });
        state.activeId = mon ? mon.id : state.sessions[0].id;
      }
      renderAll();
    } catch (err) { console.warn("[sessions] load failed", err); }
  }

  async function createSession(kind) {
    var title = prompt("Name this " + KIND_META[kind].label + " session:", KIND_META[kind].label + " " + (state.sessions.filter(function (s) { return s.kind === kind; }).length + 1));
    if (title === null) return;
    try {
      var r = await apiCall("/api/sessions", { method: "POST", body: JSON.stringify({ kind: kind, title: title }) });
      state.sessions = r.result.sessions || state.sessions;
      state.activeId = r.result.session.id;
      state.wsPath = "";
      renderAll();
      connectEvents(r.result.session.id);
    } catch (err) { alert("Create failed: " + err.message); }
  }

  async function deleteSession(id) {
    if (!confirm("Delete this session? Its workspace and context will be permanently removed.")) return;
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id), { method: "DELETE" });
      state.sessions = r.result.sessions || [];
      if (state.activeId === id) {
        var mon = state.sessions.find(function (s) { return s.kind === "monitor"; });
        state.activeId = mon ? mon.id : (state.sessions.length ? state.sessions[0].id : "");
      }
      renderAll();
    } catch (err) { alert("Delete failed: " + err.message); }
  }

  async function refreshSession(id) {
    if (!confirm("Clear conversation context? A fresh context will be rebuilt from the latest project state.")) return;
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/refresh", { method: "POST", body: "{}" });
      updateSession(r.result.session);
      state.wsPath = "";
      renderAll();
    } catch (err) { alert("Clear failed: " + err.message); }
  }

  async function stopSession(id) {
    try {
      await apiCall("/api/sessions/" + encodeURIComponent(id) + "/stop", { method: "POST", body: "{}" });
      var s = state.sessions.find(function (x) { return x.id === id; });
      if (s) { s.running = false; s.status = "interrupted"; }
      renderAll();
    } catch (err) { alert("Stop failed: " + err.message); }
  }

  async function selectSession(id) {
    state.activeId = id;
    state.wsPath = "";
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id));
      updateSession(r.session);
    } catch (err) { /* ignore */ }
    renderAll();
    connectEvents(id);
    var s = state.sessions.find(function (x) { return x.id === id; });
    if (s && s.kind !== "evolution") {
      loadWorkspace(id, "");
    }
  }

  async function sendMessage(id, text) {
    var s = state.sessions.find(function (x) { return x.id === id; });
    if (s) { (s.chat_history = s.chat_history || []).push({ role: "user", text: text }); s.running = true; renderSessionView(); }
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/chat", { method: "POST", body: JSON.stringify({ message: text }) });
      updateSession(r.result.session);
      connectEvents(id);
      renderAll();
    } catch (err) { alert("Send failed: " + err.message); loadSessions(); }
  }

  // ---- workspace file browser actions ---------------------------------
  async function loadWorkspace(id, relPath) {
    state.wsPath = relPath || "";
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/workspace?path=" + encodeURIComponent(relPath || ""));
      state.wsItems = r.items || [];
      renderWorkspace();
    } catch (err) {
      state.wsItems = [];
      renderWorkspace();
      console.warn("[sessions] workspace load failed", err);
    }
  }

  async function previewFile(id, relPath) {
    try {
      var r = await apiCall("/api/sessions/" + encodeURIComponent(id) + "/workspace/file?path=" + encodeURIComponent(relPath));
      var isImage = (r.content_type || "").startsWith("image/");
      var imageUrl = "";
      if (isImage) {
        imageUrl = "data:" + r.content_type + ";base64," + r.content;
      }
      openViewer(r.name || relPath, isImage ? "" : (r.content || "(empty)"), isImage, imageUrl);
    } catch (err) { alert("Preview failed: " + err.message); }
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
    var idx = state.sessions.findIndex(function (x) { return x.id === session.id; });
    if (idx >= 0) state.sessions[idx] = Object.assign({}, state.sessions[idx], session);
    else state.sessions.push(session);
  }

  // ---- per-session SSE ------------------------------------------------
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
          if (s && data.log) { s.last_event_summary = data.log; renderSessionView(); }
        }
      } catch (e) { /* ignore */ }
    });
    es.onerror = function () { /* auto-reconnect handled by browser */ };
  }

  // ---- render all -----------------------------------------------------
  function renderAll() {
    renderRail();
    renderSessionView();
  }

  // ---- mount ----------------------------------------------------------
  function mount() {
    // Wire up the chat form
    var form = document.getElementById("sv-chat-form");
    if (form) {
      form.onsubmit = function (e) {
        e.preventDefault();
        var input = document.getElementById("sv-chat-input");
        if (!input) return;
        var text = input.value.trim();
        if (!text) return;
        sendMessage(state.activeId, text);
        input.value = "";
      };
    }

    // Wire up workspace refresh button
    var wsRefresh = document.getElementById("sv-ws-refresh");
    if (wsRefresh) {
      wsRefresh.onclick = function () { loadWorkspace(currentSessionId(), state.wsPath); };
    }

    // If project already loaded
    if (window.activeProjectId) {
      loadSessions();
    }

    // Poll for project changes (app.js sets window.activeProjectId directly)
    var lastPid = window.activeProjectId || "";
    setInterval(function () {
      var curPid = window.activeProjectId || "";
      if (curPid !== lastPid) {
        lastPid = curPid;
        if (curPid) {
          autoCreateChecked = false;
          state.sessions = [];
          state.activeId = "";
          loadSessions();
        } else {
          state.sessions = [];
          state.activeId = "";
          renderAll();
        }
      }
    }, 500);

    // Periodic refresh
    setInterval(function () { if (window.activeProjectId) loadSessions(); }, 8000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
