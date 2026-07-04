#!/usr/bin/env node

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "tmp", "theme-screenshots");
const stylesHref = pathToFileURL(path.join(root, "templates", "default", "ui", "styles.css")).href;
const rmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 150 };

const themes = [
  ["atelier-ivory", "Ivory"],
  ["atelier-nocturne", "Nocturne"],
];

const shots = [
  { name: "dashboard-desktop", width: 1440, height: 1000, kind: "dashboard" },
  { name: "dashboard-mobile", width: 390, height: 844, kind: "dashboard" },
  { name: "activity-desktop", width: 1440, height: 1000, kind: "activity" },
  { name: "activity-mobile", width: 390, height: 844, kind: "activity" },
  { name: "settings-desktop", width: 1440, height: 1000, kind: "settings" },
  { name: "panels-desktop", width: 1440, height: 1200, kind: "panels" },
  { name: "shell-desktop", width: 1440, height: 1000, kind: "shell" },
];

function findChrome() {
  const explicit = process.env.CHROME_BIN || process.env.CHROME || "";
  const candidates = [
    explicit,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "msedge",
    "chrome",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.status === 0) return candidate;
  }

  throw new Error(
    "Could not find Chrome/Chromium for screenshots. Set CHROME_BIN to a Chrome executable and rerun npm run visual:themes."
  );
}

function chromeArgs({ width, height, userDataDir }) {
  return [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-features=CalculateNativeWinOcclusion",
    "--hide-scrollbars",
    "--run-all-compositor-stages-before-draw",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    "about:blank",
  ];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForChildExit(child, timeoutMs = 1000) {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function stopChromeChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  const exited = await waitForChildExit(child, 800);
  if (exited) return;
  child.kill("SIGKILL");
  await waitForChildExit(child, 1200);
}

function waitForDevToolsUrl(child, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for Chrome DevTools URL. Output:\n${stderr}`));
    }, timeoutMs);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready, code ${code ?? ""}${signal ? ` signal ${signal}` : ""}.\n${stderr}`));
    });
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (event) => reject(event.error || new Error("Chrome DevTools WebSocket failed")));
      this.ws.addEventListener("message", (event) => this.handleMessage(event.data));
    });
  }

  handleMessage(raw) {
    const message = JSON.parse(raw);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message || "CDP error"} ${message.error.data || ""}`.trim()));
      else resolve(message.result || {});
      return;
    }

    const listeners = this.listeners.get(message.method);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(message);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitFor(method, predicate = () => true, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for CDP event ${method}`));
      }, timeoutMs);
      const listener = (message) => {
        if (!predicate(message)) return;
        cleanup();
        resolve(message);
      };
      const cleanup = () => {
        clearTimeout(timer);
        const listeners = this.listeners.get(method);
        if (listeners) listeners.delete(listener);
      };
      if (!this.listeners.has(method)) this.listeners.set(method, new Set());
      this.listeners.get(method).add(listener);
    });
  }

  close() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.close();
  }
}

async function captureScreenshot(chrome, { width, height, url, screenshot, userDataDir }) {
  const child = spawn(chrome, chromeArgs({ width, height, userDataDir }), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let client;
  try {
    const wsUrl = await waitForDevToolsUrl(child);
    client = new CdpClient(wsUrl);
    await client.connect();
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 760,
      screenWidth: width,
      screenHeight: height,
    }, sessionId);
    const loadPromise = client.waitFor("Page.loadEventFired", (message) => message.sessionId === sessionId, 8000);
    await client.send("Page.navigate", { url }, sessionId);
    await loadPromise;
    await client.send("Runtime.evaluate", {
      expression: "document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true",
      awaitPromise: true,
    }, sessionId);
    await wait(120);
    const { data } = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    }, sessionId);
    await fsp.writeFile(screenshot, Buffer.from(data, "base64"));
  } finally {
    client?.close();
    await stopChromeChild(child);
  }
}

function baseHead(theme, title, bodyClass = "visual-fixture") {
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="${stylesHref}" />
    <style>
      body { min-height: 100vh; }
      .visual-fixture .main-stage { min-height: 100vh; }
      .visual-fixture .chat-frame { min-height: 100vh; padding-bottom: 220px; }
      .visual-fixture .framing-thread { display: grid; gap: 28px; width: min(1180px, calc(100% - 56px)); margin: 0 auto; padding: 72px 0 40px; }
      .visual-fixture .framing-message { display: grid; gap: 8px; }
      .visual-fixture .framing-message.user { justify-items: end; }
      .visual-fixture .framing-message.assistant, .visual-fixture .trial-history-card, .visual-fixture .autoresearch-dock, .visual-fixture .file-viewer-shell { width: min(1040px, 100%); justify-self: center; }
      .visual-fixture .framing-message.user .transcript-body { max-width: min(760px, 82%); }
      .visual-fixture .brief-editor-shell.is-framing-dock { position: fixed; left: max(260px, 50%); bottom: 34px; transform: translateX(-50%); width: min(1040px, calc(100vw - 320px)); min-height: 148px; z-index: 20; }
      .visual-fixture.has-activity-panel .brief-editor-shell.is-framing-dock {
        left: calc(var(--rail-width, 224px) + (100vw - var(--rail-width, 224px) - var(--activity-panel-width, min(480px, calc(100vw - 32px)))) / 2);
        width: min(980px, calc(100vw - var(--rail-width, 224px) - var(--activity-panel-width, min(480px, calc(100vw - 32px))) - 56px));
      }
      .visual-fixture .autoresearch-dock { position: relative; left: auto; top: auto; bottom: auto; transform: none; max-width: 100%; }
      .visual-fixture .autoresearch-dock + .autoresearch-dock { margin-top: 18px; }
      .visual-fixture .file-viewer-shell { overflow: hidden; border-radius: 24px; }
      .visual-fixture .file-viewer-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, .8fr); min-height: 260px; }
      .visual-fixture .settings-dialog { position: relative; display: block; margin: 42px auto; }
      @media (max-width: 820px) {
        .visual-fixture .app-shell { display: block; }
        .visual-fixture .rail { display: none; }
        .visual-fixture .main-stage,
        .visual-fixture .chat-frame,
        .visual-fixture .framing-thread { width: 100%; max-width: 100vw; min-width: 0; overflow-x: hidden; box-sizing: border-box; }
        .visual-fixture .framing-thread { margin: 0; padding: 24px 12px 260px; }
        .visual-fixture .framing-message,
        .visual-fixture .framing-message.assistant,
        .visual-fixture .trial-history-card,
        .visual-fixture .autoresearch-dock,
        .visual-fixture .file-viewer-shell { justify-self: stretch; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
        .visual-fixture .framing-message.user { width: 100%; max-width: 100%; justify-items: end; }
        .visual-fixture .framing-message.user .transcript-body { width: fit-content; max-width: min(100%, calc(100vw - 36px)); overflow-wrap: anywhere; }
        .visual-fixture .trial-history-head { display: grid; align-items: stretch; gap: 12px; }
        .visual-fixture .trial-history-title-row { display: grid; grid-template-columns: 1fr; gap: 5px; min-width: 0; }
        .visual-fixture .trial-history-head strong { white-space: nowrap; }
        .visual-fixture .trial-history-head span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .visual-fixture .trial-report-actions { flex-wrap: wrap; }
        .visual-fixture .trial-report-actions button { flex: 1 1 150px; min-width: 0; }
        .visual-fixture .brief-editor-shell.is-framing-dock { left: 12px; right: 12px; bottom: 12px; width: auto; max-width: calc(100vw - 24px); transform: none; }
        .visual-fixture .brief-editor-shell.is-framing-dock .queue-item { grid-template-columns: 20px minmax(0, 1fr) auto; }
        .visual-fixture .brief-editor-shell.is-framing-dock .brief-composer-row { align-items: flex-start; flex-wrap: wrap; min-height: 0; }
        .visual-fixture .brief-editor-shell.is-framing-dock .composer-attach-button { order: 1; }
        .visual-fixture .brief-editor-shell.is-framing-dock textarea { order: 2; flex: 1 1 calc(100% - 112px); }
        .visual-fixture .brief-editor-shell.is-framing-dock .send-button { order: 3; flex: 0 0 44px; }
        .visual-fixture .brief-editor-shell.is-framing-dock .brief-run-controls { order: 4; flex: 0 0 auto; width: auto; margin-left: auto; justify-content: flex-end; }
        .visual-fixture .brief-editor-shell.is-framing-dock .brief-run-controls label { flex: 0 0 auto; min-width: 0; }
        .visual-fixture .composer-suggestion-row { flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto; }
        .visual-fixture .composer-suggestion-chip { flex: 0 0 auto; max-width: 220px; }
        .visual-fixture .file-viewer-body { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body class="${bodyClass}">
    <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
      <symbol id="brand-mark-glyph" viewBox="0 0 32 32">
        <circle cx="5.5" cy="24" r="2.7" fill="none" stroke="currentColor" stroke-width="1.9" />
        <path d="M8.4 24 H15 L24.4 10.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="15" cy="24" r="1.7" fill="currentColor" />
        <circle cx="25.5" cy="8.5" r="3.2" fill="currentColor" />
      </symbol>
      <symbol id="ic-agents" viewBox="0 0 24 24"><path d="M12 3.2c.5 3.6 1.4 4.5 5 5-3.6.5-4.5 1.4-5 5-.5-3.6-1.4-4.5-5-5 3.6-.5 4.5-1.4 5-5Z"/><path d="M18.5 13.5c.25 1.6.7 2 2.3 2.3-1.6.25-2 .7-2.3 2.3-.25-1.6-.7-2-2.3-2.3 1.6-.3 2-.7 2.3-2.3Z"/></symbol>
      <symbol id="ic-files" viewBox="0 0 24 24"><path d="M4 7a2 2 0 0 1 2-2h3.5l2 2.2H18a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/></symbol>
      <symbol id="ic-resources" viewBox="0 0 24 24"><path d="M4.5 5.5A1.5 1.5 0 0 1 6 4h6v15H6a1.5 1.5 0 0 0-1.5 1.5Z"/><path d="M12 4h6a1.5 1.5 0 0 1 1.5 1.5V19H12Z"/></symbol>
      <symbol id="ic-trials" viewBox="0 0 24 24"><path d="M9.5 3v6.2L4.8 17a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3l-4.7-7.8V3"/><path d="M8.5 3h7M8 13h8"/></symbol>
    </defs></svg>`;
}

function railHtml() {
  return `<aside class="rail" aria-label="CoAutoResearch navigation">
    <div class="brand">
      <div class="brand-mark" aria-hidden="true"><svg class="brand-glyph" viewBox="0 0 32 32"><use href="#brand-mark-glyph"/></svg></div>
      <div>
        <div class="brand-title">CoAutoResearch</div>
        <div class="brand-subtitle">Research agent</div>
      </div>
    </div>
    <nav class="rail-nav" aria-label="Views">
      <div class="rail-section-label">Current project</div>
      <button class="rail-action is-active" type="button"><svg class="rail-ic" viewBox="0 0 24 24"><use href="#ic-agents"/></svg><span>Agents</span></button>
      <button class="rail-action" type="button"><svg class="rail-ic" viewBox="0 0 24 24"><use href="#ic-files"/></svg><span>Project files</span></button>
      <button class="rail-action" type="button"><svg class="rail-ic" viewBox="0 0 24 24"><use href="#ic-resources"/></svg><span>Resources</span></button>
      <button class="rail-action" type="button"><svg class="rail-ic" viewBox="0 0 24 24"><use href="#ic-trials"/></svg><span>Trials</span></button>
    </nav>
    <div class="rail-footer">
      <button class="rail-settings-button" type="button"><span>Settings</span></button>
      <div class="rail-sync-row"><span class="sync-dot"></span><span>Synced now</span></div>
    </div>
  </aside>`;
}

function composerHtml() {
  return `<section class="brief-editor-shell is-framing-dock" aria-label="Composer">
    <div class="queue-panel" aria-label="Queued messages">
      <div class="queue-panel-inner">
        <div class="queue-panel-head"><span>Queued</span><strong>3 messages</strong></div>
        <div class="queue-list">
          <div class="queue-item is-next">
            <span class="queue-drag-handle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"/></svg></span>
            <div class="queue-item-copy"><div class="queue-item-text">Update the reviewer gate summary and keep it aligned with Trial 18.</div><div class="queue-item-meta"><span>Queued</span><span>1 attachment</span><span>10:02 AM</span></div></div>
            <div class="queue-item-actions"><button class="queue-icon-button" type="button">↑</button><button class="queue-icon-button" type="button">↓</button><button class="queue-icon-button" type="button">✎</button><button class="queue-icon-button" type="button">×</button></div>
          </div>
          <div class="queue-item">
            <span class="queue-drag-handle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01"/></svg></span>
            <div class="queue-item-copy"><div class="queue-item-text">Check whether the manuscript outline should be collapsible by default.</div><div class="queue-item-meta"><span>Queued</span><span>10:03 AM</span></div></div>
            <div class="queue-item-actions"><button class="queue-icon-button" type="button">↑</button><button class="queue-icon-button" type="button">↓</button><button class="queue-icon-button" type="button">✎</button><button class="queue-icon-button" type="button">×</button></div>
          </div>
        </div>
        <div class="queue-more">1 more queued</div>
      </div>
    </div>
    <div class="brief-composer-row">
      <button class="composer-attach-button" type="button" aria-label="Attach resources" aria-haspopup="menu" aria-expanded="false">+</button>
      <textarea class="is-compact-single-line" aria-label="Message" placeholder="Message the research agent..."></textarea>
      <div class="brief-run-controls">
        <label><select><option>GPT-5.5</option></select></label>
        <label><select><option>Medium</option></select></label>
      </div>
      <button class="queue-action-menu-toggle" type="button" aria-label="Queue send options"><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></button>
      <button class="send-button" type="button" aria-label="Send">Up</button>
    </div>
    <div class="composer-suggestion-row">
      <span>Goal paused</span>
      <button class="composer-suggestion-chip" type="button">Resume</button>
      <button class="composer-suggestion-chip" type="button">Restart</button>
      <button class="composer-suggestion-chip" type="button">Show autoresearch</button>
      <button class="composer-suggestion-chip" type="button">Status</button>
      <button class="composer-suggestion-chip" type="button">Diff</button>
    </div>
  </section>`;
}

function dashboardHtml(theme, label) {
  return `${baseHead(theme, `${label} dashboard`)}
    <div class="app-shell">
      ${railHtml()}
      <main class="main-stage">
        <section class="chat-frame">
          <section class="framing-thread">
            <article class="framing-message user">
              <div class="transcript-meta">You</div>
              <div class="transcript-body">Continue from Trial 1.</div>
            </article>
            <article class="framing-message assistant">
              <div class="transcript-meta">CoAutoResearch</div>
              <div class="transcript-body">
                <div class="markdown-preview transcript-markdown">
                  <p>Updated the project and kept the active manuscript reviewable.</p>
                  <p>The current contribution is a <strong>target-venue-ready research blueprint</strong> with traceable claims, figures, tables, references, and reviewer gates.</p>
                  <ul>
                    <li><a href="#">PROJECT.md</a> and <a href="#">BLUEPRINT.md</a> remain linked.</li>
                    <li>Evidence notes use <code>resources/</code> and trial reports for provenance.</li>
                  </ul>
                  <ol>
                    <li>Frame the question and record the brief.</li>
                    <li>Run one complete research attempt, then report.</li>
                  </ol>
                  <blockquote>A traceable trajectory you can defend and revise — not an artifact you cannot explain.</blockquote>
                  <hr>
                </div>
                <div class="framing-progress" aria-label="Agent progress">
                  <div class="framing-progress-row assistant">Planned the complete research objective.</div>
                  <div class="framing-progress-row tool">Ran Trial 8 and recorded the report.</div>
                  <div class="framing-progress-row assistant">Updated findings and project state.</div>
                </div>
              </div>
            </article>
            <div class="autoresearch-dock is-expanded is-running">
              <section class="trial-history-card is-expanded is-running" data-autoresearch-panel-collapsed="false">
                <header class="trial-history-head">
                  <div class="trial-live-strip">
                    <button class="trial-live-chevron" type="button" data-autoresearch-panel-toggle aria-expanded="true" aria-label="Collapse autoresearch"><span class="trial-history-disclosure" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m9 18 6-6-6-6"/></svg></span></button>
                    <button class="trial-history-toggle trial-live-main" type="button" data-autoresearch-panel-toggle aria-expanded="true">
                      <span class="trial-history-kicker trial-live-brand" aria-label="Autoresearch">
                        <span class="trial-history-micro-spinner" aria-hidden="true"></span>
                        <span>Autoresearch</span>
                      </span>
                      <span class="trial-history-kicker-status trial-live-primary"><span>Trial 8 · Running</span><span class="trial-history-working-on" title="Working on: Stabilize the final review gate.">Working on: Stabilize the final review gate.</span></span>
                      <span class="trial-history-latest-update trial-live-update"><span>Agent update</span><em>Update: Prepared final gate handoff.</em></span>
                    </button>
                    <div class="trial-live-actions">
                      <button class="activity-open-button trial-history-activity-button" type="button" data-activity-open data-activity-key="visual-trial-expanded"><span class="activity-open-label">Activity</span><span class="activity-open-separator" aria-hidden="true">&middot;</span><strong>6 events</strong></button>
                    </div>
                  </div>
                </header>
                <div class="trial-history-body">
                  <nav class="trial-strip" aria-label="Autoresearch trials">
                    <button class="trial-scroll-button" type="button">&lt;</button>
                    <div class="trial-strip-scroll">
                      <button class="trial-chip is-incomplete" type="button"><strong class="trial-chip-index">1</strong><span class="trial-chip-status">Blocked</span></button>
                      <button class="trial-chip is-continued" type="button"><strong class="trial-chip-index">2</strong><span class="trial-chip-status">Continued</span></button>
                      <button class="trial-chip" type="button"><strong class="trial-chip-index">3</strong><span class="trial-chip-status">Reported</span></button>
                      <button class="trial-chip is-active" type="button"><strong class="trial-chip-index">8</strong><span class="trial-chip-status">Done</span></button>
                    </div>
                    <button class="trial-scroll-button" type="button">&gt;</button>
                  </nav>
                  <article class="trial-report-card is-complete">
                    <div class="trial-report-head">
                      <div><strong>Trial 8</strong><em>completed</em><em class="is-autoresearch-complete">Autoresearch complete</em><span class="trial-report-head-progress">3/8 reviewer gates are pass. · updated 03:01 AM</span></div>
                    </div>
                    <div class="trial-progress-stepper" aria-label="Trial progress">
                      <span class="trial-progress-step is-complete"><span class="trial-progress-marker" aria-hidden="true">✓</span><span>Planning</span></span>
                      <span class="trial-progress-step is-complete"><span class="trial-progress-marker" aria-hidden="true">✓</span><span>Working</span></span>
                      <span class="trial-progress-step is-complete"><span class="trial-progress-marker" aria-hidden="true">✓</span><span>Synthesizing</span></span>
                      <span class="trial-progress-step is-complete"><span class="trial-progress-marker" aria-hidden="true">✓</span><span>Reporting</span></span>
                      <span class="trial-progress-step is-complete"><span class="trial-progress-marker" aria-hidden="true">✓</span><span>Reviewing</span></span>
                      <span class="trial-progress-step is-current"><span class="trial-progress-marker" aria-hidden="true">6</span><span>Gate update</span></span>
                    </div>
                    <p>Reviewed the revised working manuscript and final autoresearch gate after targeted revision.</p>
                    <div class="trial-report-actions">
                      <div class="trial-report-open-actions">
                        <button class="secondary-button small-button trial-artifact-button" type="button" aria-label="Open manuscript"><span class="trial-artifact-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h6" /><path d="M8 9h2" /></svg></span><span>Manuscript</span></button>
                        <button class="secondary-button small-button trial-artifact-button" type="button" aria-label="Open report"><span class="trial-artifact-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 18v-4" /><path d="M12 18v-7" /><path d="M16 18v-2" /></svg></span><span>Report</span></button>
                        <button class="secondary-button small-button trial-artifact-button" type="button" aria-label="Open review"><span class="trial-artifact-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="m8 11 2 2 4-4" /></svg></span><span>Review</span></button>
                      </div>
                      <div class="trial-report-control-actions">
                        <button class="secondary-button small-button trial-flow-button" type="button" aria-label="Continue from this trial"><span class="trial-action-icon trial-action-icon-continue" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 7h6a5 5 0 0 1 5 5v5" /><path d="M13 14l3 3 3-3" /></svg></span><span>Continue from this trial</span></button>
                        <button class="secondary-button small-button trial-danger-button" type="button" aria-label="Restart"><span class="trial-action-icon trial-action-icon-restart" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.34-5.66" /><path d="M4 4v6h6" /></svg></span><span>Restart</span></button>
                      </div>
                    </div>
                  </article>
                </div>
              </section>
            </div>
            <div class="autoresearch-dock is-collapsed is-running">
              <section class="trial-history-card is-collapsed is-running" data-autoresearch-panel-collapsed="true">
                <header class="trial-history-head">
                  <div class="trial-live-strip">
                    <button class="trial-live-chevron" type="button" data-autoresearch-panel-toggle aria-expanded="false" aria-label="Expand autoresearch"><span class="trial-history-disclosure" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m9 18 6-6-6-6"/></svg></span></button>
                    <button class="trial-history-toggle trial-live-main" type="button" data-autoresearch-panel-toggle aria-expanded="false">
                      <span class="trial-history-kicker trial-live-brand" aria-label="Autoresearch">
                        <span class="trial-history-micro-spinner" aria-hidden="true"></span>
                        <span>Autoresearch</span>
                      </span>
                      <span class="trial-history-kicker-status trial-live-primary"><span>Trial 8 · Running</span></span>
                      <span class="trial-history-latest-update trial-live-update"><span>Agent update</span><em>Update: Prepared final gate handoff.</em></span>
                    </button>
                    <div class="trial-live-actions">
                      <button class="activity-open-button trial-history-activity-button" type="button" data-activity-open data-activity-key="visual-trial-collapsed"><span class="activity-open-label">Activity</span><span class="activity-open-separator" aria-hidden="true">&middot;</span><strong>6 events</strong></button>
                    </div>
                  </div>
                </header>
                <div class="trial-history-body">
                  <nav class="trial-strip" aria-label="Autoresearch trials"></nav>
                </div>
              </section>
            </div>
            <section class="file-viewer-shell">
              <header class="file-viewer-head"><div><p class="eyebrow">File preview</p><h2>BLUEPRINT.md</h2></div><button class="dialog-close-button" type="button">x</button></header>
              <div class="file-viewer-body">
                <div class="markdown-preview">
                  <h1>Final Blueprint</h1>
                  <p>This preview checks markdown text, links, code, tables, captions, and prose density.</p>
                  <table><thead><tr><th>Claim</th><th>Evidence</th><th>Status</th></tr></thead><tbody><tr><td>C01</td><td>R00001</td><td>accepted</td></tr></tbody></table>
                </div>
                <pre class="file-code-preview"># Figure Plan\\n\\nFigure 1: calibration map\\nCaption: A self-contained visual argument.</pre>
              </div>
            </section>
          </section>
          ${composerHtml()}
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function activityHtml(theme, label) {
  return `${baseHead(theme, `${label} activity`, "visual-fixture has-activity-panel")}
    <div class="app-shell">
      ${railHtml()}
      <main class="main-stage">
        <section class="chat-frame">
          <section class="framing-thread">
            <article class="framing-message user">
              <div class="transcript-meta">You</div>
              <div class="transcript-body">Convert the manuscript to a PDF and verify the result.</div>
            </article>
            <article class="framing-message assistant">
              <div class="transcript-meta">CoAutoResearch</div>
              <div class="transcript-body thinking-bubble">
                <section class="run-live-status">
                  <div class="run-live-status-head">
                    <div class="thinking-status-row run-live-status-title">
                      <span class="thinking-dot"></span>
                      <span class="thinking-dot"></span>
                      <span class="thinking-dot"></span>
                      <span class="working-duration">Working for 3m 27s</span>
                    </div>
                    <div class="run-live-status-actions"><span>6 events</span></div>
                  </div>
                  <div class="run-live-updates" aria-label="Codex updates">
                    <p>Checking the exported PDF metadata and reviewing the rendered page count.</p>
                    <p>Verifying the final manuscript preview before handing back the file.</p>
                  </div>
                  <div class="run-live-activity-entry">
                    <button class="activity-open-button run-live-activity-button" type="button" data-activity-open data-activity-key="fixture">
                      <span class="activity-open-label">Run activity</span>
                      <span class="activity-open-separator" aria-hidden="true">&middot;</span><strong>6 events</strong>
                    </button>
                  </div>
                </section>
              </div>
            </article>
            <article class="framing-message assistant">
              <div class="transcript-meta">CoAutoResearch</div>
              <div class="inline-run-activity-summary">
                <button class="activity-open-button framing-run-activity" type="button" data-activity-open data-activity-key="worked">
                  <span class="activity-open-label">Worked for 3m 27s</span>
                  <span class="activity-open-separator" aria-hidden="true">&middot;</span><strong>6 events</strong>
                </button>
              </div>
              <div class="transcript-body">The PDF is ready and the rendered page count matches the source.</div>
            </article>
          </section>
          ${composerHtml()}
        </section>
      </main>
    </div>
    <aside id="activity-panel" class="activity-panel" style="--activity-progress: 42%;" role="complementary" aria-label="Activity">
      <header class="activity-panel-header">
        <div>
          <h2>Activity <span>&middot; 3m 27s</span></h2>
          <p>Codex run</p>
        </div>
        <button class="activity-panel-close" type="button" data-activity-close aria-label="Close activity">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </header>
      <div class="activity-panel-progress" aria-hidden="true"><span></span></div>
      <div class="activity-panel-body" tabindex="0">
        <div class="activity-timeline" aria-label="Activity timeline">
          <article class="activity-timeline-item assistant is-reasoning">
            <div class="activity-timeline-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg></div>
            <div class="activity-timeline-content">
              <header class="activity-timeline-title"><strong>Reasoning</strong><span>10:02 AM</span></header>
              <div class="activity-readable-text is-reasoning">
                <p>Everything looks good so far, but I should verify the PDF metadata, page count, and final rendered page before completing the turn.</p>
              </div>
            </div>
          </article>
          <article class="activity-timeline-item assistant is-update">
            <div class="activity-timeline-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg></div>
            <div class="activity-timeline-content">
              <header class="activity-timeline-title"><strong>Update</strong><span>10:03 AM</span></header>
              <div class="activity-readable-text">
                <p>Verified PDF metadata and page count. The exported file is readable and contains the expected nine pages.</p>
              </div>
            </div>
          </article>
          <article class="activity-timeline-item tool is-file-change">
            <div class="activity-timeline-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg></div>
            <div class="activity-timeline-content">
              <header class="activity-timeline-title"><strong>File change</strong><span>10:04 AM</span></header>
              <p class="activity-timeline-summary">Constructive_Reviewer_Report.pdf updated, completed</p>
              <div class="activity-event-card">
                <article class="transcript-message tool is-file-change">
                  <details class="file-change-event" open>
                    <summary><span>File</span><strong>Reviewer_Report.pdf</strong><em>update / completed</em><code>outputs/Reviewer_Report.pdf</code></summary>
                    <div class="inline-file"><div class="tree-empty">Open to load file.</div></div>
                  </details>
                </article>
              </div>
            </div>
          </article>
          <article class="activity-timeline-item command is-command">
            <div class="activity-timeline-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 9 3 3-3 3"/><path d="M13 15h3"/></svg></div>
            <div class="activity-timeline-content">
              <header class="activity-timeline-title"><strong>Command</strong><span>10:05 AM</span></header>
              <p class="activity-timeline-summary">python scripts/verify_pdf.py outputs/Reviewer_Report.pdf</p>
              <div class="activity-event-card">
                <article class="transcript-message command is-compact">
                  <details class="tool-event" open>
                    <summary><span>Python</span><code>python scripts/verify_pdf.py outputs/Reviewer_Report.pdf</code></summary>
                    <pre>PDF: outputs/Reviewer_Report.pdf
Pages: 9
Encrypted: False</pre>
                  </details>
                </article>
              </div>
            </div>
          </article>
          <article class="activity-timeline-item assistant is-done">
            <div class="activity-timeline-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 6.8"/></svg></div>
            <div class="activity-timeline-content">
              <header class="activity-timeline-title"><strong>Done</strong><span>10:06 AM</span></header>
              <div class="activity-readable-text">
                <p>The PDF is ready. Metadata and page count match the expected manuscript output.</p>
              </div>
              <div class="activity-event-card">
                <article class="transcript-message assistant is-status-card">
                  <div class="status-card">
                    <div class="status-card-head"><div><span>Output</span><strong>PDF verification</strong></div><em>passed</em></div>
                    <div class="status-card-grid">
                      <div class="status-metric"><span>Pages</span><strong>9</strong></div>
                      <div class="status-metric"><span>Encrypted</span><strong>false</strong></div>
                      <div class="status-metric"><span>Readable</span><strong>yes</strong></div>
                    </div>
                  </div>
                </article>
              </div>
            </div>
          </article>
        </div>
      </div>
    </aside>
  </body>
</html>`;
}

function settingsHtml(theme, label) {
  return `${baseHead(theme, `${label} settings`)}
    <dialog class="settings-dialog" open>
      <section class="settings-shell">
        <aside class="settings-sidebar">
          <button class="settings-close" type="button">x</button>
          <nav class="settings-nav">
            <button class="settings-nav-button is-active" type="button"><span>G</span><strong>General</strong></button>
            <button class="settings-nav-button" type="button"><span>{}</span><strong>Codex</strong></button>
          </nav>
        </aside>
        <form class="settings-content">
          <header class="settings-titlebar">
            <div><h2>Settings</h2><p>Local configuration for CoAutoResearch and the Codex session runner.</p></div>
            <button class="settings-save-button" type="button">Save</button>
          </header>
          <section class="settings-panel is-active">
            <div class="settings-row">
              <div><h3>Theme</h3><p>CoAutoResearch currently uses the Light theme.</p></div>
              <fieldset class="theme-mode-control">
                <label><input type="radio" checked /><span>${label}</span></label>
              </fieldset>
            </div>
            <div class="settings-row">
              <div><h3>Runtime storage</h3><p>Settings and tokens are stored locally and ignored by git.</p></div>
              <span class="settings-value">Local only</span>
            </div>
            <section class="settings-secret-card">
              <div class="settings-secret-head"><div><strong>OpenAI API key</strong><em>OPENAI_API_KEY</em></div><span class="secret-status is-saved">Saved</span></div>
              <input type="password" value="sk-visual-fixture" />
              <div class="settings-secret-help">This fixture checks settings contrast, form controls, and saved status.</div>
            </section>
            <div class="settings-doc-callout">
              <div><h3>Documentation</h3><p>Open local and published docs from the dashboard.</p></div>
              <div class="settings-doc-links"><a href="#">README</a><a href="#">Docs</a></div>
            </div>
          </section>
        </form>
      </section>
    </dialog>
  </body>
</html>`;
}

function shellHtml(theme, label) {
  return `${baseHead(theme, `${label} shell`)}
    <svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
      <symbol id="ic-reviews" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2"/><path d="M8.6 12.2l2.3 2.3 4.5-4.8"/></symbol>
      <symbol id="ic-manuscript" viewBox="0 0 24 24"><path d="M6.5 3.5h7l4 4v13h-11Z"/><path d="M13.5 3.5v4h4M9 13h6M9 16.5h4.5"/></symbol>
    </defs></svg>
    <div class="app-shell">
      <aside class="rail" aria-label="navigation">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"><svg class="brand-glyph" viewBox="0 0 32 32"><use href="#brand-mark-glyph"/></svg></div>
          <div><div class="brand-title">CoAutoResearch</div><div class="brand-subtitle">Research agent</div></div>
        </div>
        <section class="project-switcher" aria-label="Projects">
          <div class="project-switcher-head"><div class="rail-section-label">Projects</div></div>
          <div class="project-list">
            <div class="project-switch-row is-active">
              <button class="project-switch is-active" type="button">
                <span class="project-status-dot active" aria-hidden="true"></span>
                <span><strong>test</strong><small>Active · synced</small></span>
              </button>
            </div>
            <div class="project-switch-row">
              <button class="project-switch" type="button">
                <span class="project-status-dot idle" aria-hidden="true"></span>
                <span><strong>protein-design</strong><small>Idle</small></span>
              </button>
            </div>
          </div>
        </section>
        <nav class="rail-nav" aria-label="Views">
          <div class="rail-section-label">Current project</div>
          <button class="rail-action is-active" type="button"><svg class="rail-ic" viewBox="0 0 24 24"><use href="#ic-agents"/></svg><span>Agents</span></button>
          <button class="rail-action" type="button"><svg class="rail-ic" viewBox="0 0 24 24"><use href="#ic-files"/></svg><span>Project files</span></button>
          <button class="rail-action" type="button"><svg class="rail-ic" viewBox="0 0 24 24"><use href="#ic-resources"/></svg><span>Resources</span></button>
          <button class="rail-action" type="button"><svg class="rail-ic" viewBox="0 0 24 24"><use href="#ic-trials"/></svg><span>Trials</span></button>
          <button class="rail-action" type="button"><svg class="rail-ic" viewBox="0 0 24 24"><use href="#ic-reviews"/></svg><span>Reviews</span></button>
          <button class="rail-action" type="button"><svg class="rail-ic" viewBox="0 0 24 24"><use href="#ic-manuscript"/></svg><span>Manuscript</span></button>
        </nav>
        <div class="rail-footer">
          <button class="rail-settings-button" type="button"><span>Settings</span></button>
          <div class="rail-sync-row"><span class="sync-dot"></span><span>Reading files</span></div>
        </div>
      </aside>
      <main class="main-stage">
        <section class="workspace-view chat-view is-active">
          <div class="chat-frame">
            <header class="chat-header is-framing">
              <div><p class="eyebrow">Project framing</p><h1>Diffusion models for protein design</h1></div>
              <div class="header-tools"><div class="session-pill">No session</div></div>
            </header>
            <section class="cold-start-workspace">
              <section class="stage-panel is-active" data-stage-panel="1">
                <section class="assistant-card cold-card">
                  <div class="card-head"><div>
                    <p class="eyebrow">Framing</p>
                    <h2>Where should the research begin?</h2>
                    <p class="setup-copy">Describe the research topic, problem, scope, and any data or materials the agent should use. A proposal or prior writeup is recommended.</p>
                  </div></div>
                  <div class="compact-fields brief-context-fields">
                    <label class="field"><span>Target venue / audience</span><input type="text" placeholder="Venue: Nature, NeurIPS, CHI, ICLR, policy memo; audience optional..." /></label>
                  </div>
                  <div class="material-quick-actions" aria-label="Attachment hint">
                    <span class="material-actions-label">Drag files here, or use + to upload files/link folders</span>
                  </div>
                </section>
              </section>
            </section>
          </div>
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function panelsHtml(theme, label) {
  return `${baseHead(theme, `${label} panels`)}
    <main class="main-stage" style="display:block;">
      <div style="display:grid; gap:36px; width:min(1080px, calc(100% - 64px)); margin:0 auto; padding:56px 0;">
        <header class="material-header">
          <p class="eyebrow">Manuscript</p>
          <h1>Working blueprint</h1>
          <p>Editorial document layout — mono eyebrows, Fraunces titles, hairline rules.</p>
        </header>

        <div class="autoresearch-dock is-collapsed is-running" style="position:relative; left:auto; top:auto; bottom:auto; transform:none; width:100%; max-width:100%; margin:0; z-index:1;">
          <section class="trial-history-card is-collapsed is-running" data-autoresearch-panel-collapsed="true">
            <header class="trial-history-head">
              <div class="trial-live-strip">
                <button class="trial-live-chevron" type="button" data-autoresearch-panel-toggle aria-expanded="false" aria-label="Expand autoresearch"><span class="trial-history-disclosure" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m9 18 6-6-6-6"/></svg></span></button>
                <button class="trial-history-toggle trial-live-main" type="button" data-autoresearch-panel-toggle aria-expanded="false">
                  <span class="trial-history-kicker trial-live-brand" aria-label="Autoresearch"><span class="trial-history-micro-spinner" aria-hidden="true"></span><span>Autoresearch</span></span>
                  <span class="trial-history-kicker-status trial-live-primary"><span>Trial 22 · Planning</span></span>
                  <span class="trial-history-latest-update trial-live-update"><span>Agent update</span><em>Waiting for agent update.</em></span>
                </button>
                <div class="trial-live-actions">
                  <button class="activity-open-button trial-history-activity-button" type="button" data-activity-open data-activity-key="visual-live-waiting"><span class="activity-open-label">Activity</span><span class="activity-open-separator" aria-hidden="true">&middot;</span><strong>waiting</strong></button>
                </div>
              </div>
            </header>
            <div class="trial-history-body"></div>
          </section>
        </div>

        <div class="autoresearch-dock is-expanded is-running" style="position:relative; left:auto; top:auto; bottom:auto; transform:none; width:100%; max-width:100%; margin:0; z-index:1;">
          <section class="trial-history-card is-expanded is-running" data-autoresearch-panel-collapsed="false">
            <header class="trial-history-head">
              <div class="trial-live-strip">
                <button class="trial-live-chevron" type="button" data-autoresearch-panel-toggle aria-expanded="true" aria-label="Collapse autoresearch"><span class="trial-history-disclosure" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m9 18 6-6-6-6"/></svg></span></button>
                <button class="trial-history-toggle trial-live-main" type="button" data-autoresearch-panel-toggle aria-expanded="true">
                  <span class="trial-history-kicker trial-live-brand" aria-label="Autoresearch"><span class="trial-history-micro-spinner" aria-hidden="true"></span><span>Autoresearch</span></span>
                  <span class="trial-history-kicker-status trial-live-primary"><span>Trial 22 · Planning</span><span class="trial-history-working-on" title="Working on: Rebuild the source/result relationship.">Working on: Rebuild the source/result relationship.</span></span>
                  <span class="trial-history-latest-update trial-live-update"><span>Agent update</span><em>Update: mapping the evidence table into the final result argument.</em></span>
                </button>
                <div class="trial-live-actions">
                  <button class="activity-open-button trial-history-activity-button" type="button" data-activity-open data-activity-key="visual-live-expanded"><span class="activity-open-label">Activity</span><span class="activity-open-separator" aria-hidden="true">&middot;</span><strong>11 events</strong></button>
                </div>
              </div>
            </header>
            <div class="trial-history-body">
              <nav class="trial-strip" aria-label="Autoresearch trials">
                <span>Trials</span>
                <button class="trial-scroll-button" type="button">&lt;</button>
                <div class="trial-strip-scroll">
                  <button class="trial-chip" type="button"><strong class="trial-chip-index">20</strong><span class="trial-chip-status">Reported</span></button>
                  <button class="trial-chip is-continued" type="button"><strong class="trial-chip-index">21</strong><span class="trial-chip-status">Continued</span></button>
                  <button class="trial-chip is-active is-running" type="button"><strong class="trial-chip-index">22</strong><span class="trial-chip-status">Running</span></button>
                </div>
                <button class="trial-scroll-button" type="button">&gt;</button>
              </nav>
              <article class="trial-report-card is-running"><div class="trial-report-head"><div><strong>Trial 22</strong><em>running</em><span class="trial-report-head-progress">Planning result claim and evidence coverage.</span></div></div><p class="trial-progress-summary">The live strip stays compact while the inspector keeps trial details available.</p></article>
            </div>
          </section>
        </div>

        <section class="manuscript-layout">
          <aside class="manuscript-outline-panel" aria-label="Manuscript outline">
            <div class="manuscript-outline-brand">
              <span class="manuscript-outline-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 18V6" /><path d="M5 8h10" /><path d="M5 13h7" /><path d="M5 18h12" /><circle cx="5" cy="8" r="1.4" /><circle cx="5" cy="13" r="1.4" /><circle cx="5" cy="18" r="1.4" /></svg></span>
              <div><p>Manuscript map</p><strong>Outline</strong></div>
            </div>
            <nav class="manuscript-outline-nav">
              <details class="manuscript-outline-group" open>
                <summary><span>Outline</span><strong>3</strong></summary>
                <div class="manuscript-outline-links">
                  <a class="manuscript-outline-link" href="#abstract"><span>Abstract</span><strong>Abstract</strong></a>
                  <a class="manuscript-outline-link" href="#section-one"><span>Section</span><strong>Section 1: Safety evidence must guide action</strong></a>
                  <a class="manuscript-outline-link" href="#section-two"><span>Section</span><strong>Section 2: Perceived safety is not trust</strong></a>
                </div>
              </details>
              <details class="manuscript-outline-group">
                <summary><span>Figures</span><strong>2</strong></summary>
                <div class="manuscript-outline-links">
                  <a class="manuscript-outline-link" href="#figure-one"><span>Figure</span><strong>Figure F1: Calibration map</strong><em>active</em></a>
                </div>
              </details>
            </nav>
          </aside>
          <div class="manuscript-reader">
            <section class="context-card">
              <div class="item-head">
                <div><h3>Manuscript story map</h3><div class="meta">Finished-results paper map in manuscript reading order.</div></div>
              </div>
              <section class="manuscript-story-map" id="story-map-fixture">
                <header class="story-map-hero">
                  <div>
                    <p class="story-map-kicker">Finished-results blueprint</p>
                    <h3>Manuscript story map</h3>
                    <div class="story-map-core"><p>A quiet reader column with a marginal outline keeps manuscript navigation visible without turning the page into a file inspector.</p></div>
                  </div>
                  <dl class="story-map-meta"><div><dt>Target venue</dt><dd>Nature Machine Intelligence</dd></div><div><dt>Article type</dt><dd>Perspective</dd></div></dl>
                </header>
              </section>
            </section>
          </div>
        </section>

        <nav class="trial-strip" aria-label="Autoresearch trials">
          <span>Trials</span>
          <button class="trial-scroll-button" type="button">&lt;</button>
          <div class="trial-strip-scroll">
            <button class="trial-chip is-incomplete" type="button"><strong class="trial-chip-index">12</strong><span class="trial-chip-status">Blocked</span></button>
            <button class="trial-chip" type="button"><strong class="trial-chip-index">13</strong><span class="trial-chip-status">Reported</span></button>
            <button class="trial-chip" type="button"><strong class="trial-chip-index">14</strong><span class="trial-chip-status">Reported</span></button>
            <button class="trial-chip" type="button"><strong class="trial-chip-index">15</strong><span class="trial-chip-status">Reported</span></button>
            <button class="trial-chip is-continued" type="button"><strong class="trial-chip-index">16</strong><span class="trial-chip-status">Continued</span></button>
            <button class="trial-chip" type="button"><strong class="trial-chip-index">17</strong><span class="trial-chip-status">Reported</span></button>
            <button class="trial-chip is-active" type="button"><strong class="trial-chip-index">18</strong><span class="trial-chip-status">Done</span></button>
          </div>
          <button class="trial-scroll-button" type="button">&gt;</button>
        </nav>

        <article class="trial-report-card is-running">
          <div class="trial-report-head">
            <div><strong>Trial 8</strong><em>running</em></div>
          </div>
          <div class="trial-progress-stepper" aria-label="Trial progress">
            <span class="trial-progress-step is-complete"><span class="trial-progress-marker" aria-hidden="true">✓</span><span>Planning</span></span>
            <span class="trial-progress-step is-complete"><span class="trial-progress-marker" aria-hidden="true">✓</span><span>Working</span></span>
            <span class="trial-progress-step is-complete"><span class="trial-progress-marker" aria-hidden="true">✓</span><span>Synthesizing</span></span>
            <span class="trial-progress-step is-complete"><span class="trial-progress-marker" aria-hidden="true">✓</span><span>Reporting</span></span>
            <span class="trial-progress-step is-complete"><span class="trial-progress-marker" aria-hidden="true">✓</span><span>Reviewing</span></span>
            <span class="trial-progress-step is-current"><span class="trial-progress-marker" aria-hidden="true">6</span><span>Gate update</span></span>
          </div>
          <p class="trial-progress-summary">Gate update is preparing the final project state.</p>
        </article>

        <article class="story-section-card paper-section-row">
          <header class="story-section-head">
            <p>3.2 Method</p>
            <h4>A calibrated estimator for sparse regimes</h4>
          </header>
          <div class="story-section-brief"><div class="markdown-preview"><p>The section brief reads as tonal prose with a quiet hairline rule, not a heavy accent bar.</p></div></div>
          <div class="story-section-grid">
            <div class="story-point is-main"><h5>Main takeaway</h5><div class="story-point-body"><div class="markdown-preview"><p>The estimator stays unbiased under the stated assumptions.</p></div></div></div>
            <div class="story-point"><h5>Evidence / results</h5><div class="story-point-body"><div class="markdown-preview"><p>See Figure 2 and Table 1 for the calibration evidence.</p></div></div></div>
          </div>
          <div class="manuscript-artifact-card artifact-figure">
            <p class="figure-type">Figure 2</p>
            <span class="figure-status is-ready">Ready</span>
            <p class="figure-caption">A self-contained visual argument for calibration quality.</p>
          </div>
        </article>

        <section class="reviews-panel">
          <article class="review-card">
            <header class="review-card-head">
              <div class="review-title-block">
                <p class="review-kicker">final_gate_review.md</p>
                <h3>final gate review</h3>
              </div>
              <button class="secondary-button small-button" type="button">Open</button>
            </header>
            <div class="review-meta-row">
              <span class="review-chip">Accepted</span>
              <span class="review-chip">3 claims</span>
            </div>
            <p class="review-summary">The revised manuscript clears the final autoresearch gate with traceable claims.</p>
            <p class="review-path">manuscript/reviews/final_gate_review.md</p>
          </article>
        </section>

        <section class="resource-panel">
          <div class="resource-chip">
            <div><strong>seed_paper.pdf</strong><small>resources/seed_paper.pdf - 1.2 MB</small></div>
            <label class="resource-category-select"><span>Category</span><select><option>Seed paper</option></select></label>
            <button class="secondary-button small-button" type="button">Open</button>
          </div>
        </section>

        <dialog class="project-dialog" open style="position:relative; display:block; margin:0;">
          <form class="project-dialog-shell" method="dialog">
            <header class="project-dialog-head">
              <div><p class="eyebrow">New project</p><h2>Create a research project.</h2></div>
              <button class="icon-button dialog-close-button" type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
            </header>
            <label class="field"><span>Project name</span><input type="text" placeholder="paper-a, dissertation-chapter..." /></label>
            <label class="field"><span>Agent backend</span><select><option>Codex</option></select><small>Codex is the default.</small></label>
            <p class="project-dialog-note">Creates a separate project from the clean template.</p>
            <footer class="project-dialog-actions">
              <button class="secondary-button" type="button">Cancel</button>
              <button class="primary-button" type="submit">Create project</button>
            </footer>
          </form>
        </dialog>
      </div>
    </main>
  </body>
</html>`;
}

async function main() {
  const chrome = findChrome();
  await fsp.rm(outDir, rmOptions);
  await fsp.mkdir(outDir, { recursive: true });

  for (const [theme, label] of themes) {
    for (const shot of shots) {
      const html = shot.kind === "settings"
        ? settingsHtml(theme, label)
        : shot.kind === "panels"
          ? panelsHtml(theme, label)
          : shot.kind === "shell"
            ? shellHtml(theme, label)
            : shot.kind === "activity"
              ? activityHtml(theme, label)
              : dashboardHtml(theme, label);
      const htmlPath = path.join(outDir, `${theme}-${shot.name}.html`);
      const pngPath = path.join(outDir, `${theme}-${shot.name}.png`);
      const userDataDir = path.join(os.tmpdir(), `co-auto-research-chrome-${process.pid}-${theme}-${shot.name}`);
      await fsp.writeFile(htmlPath, html, "utf8");
      await fsp.rm(userDataDir, rmOptions);
      await captureScreenshot(chrome, {
        width: shot.width,
        height: shot.height,
        url: pathToFileURL(htmlPath).href,
        screenshot: pngPath,
        userDataDir,
      });
      await fsp.rm(userDataDir, rmOptions);
      const stat = await fsp.stat(pngPath).catch(() => null);
      if (!stat?.size) {
        throw new Error(`Chrome screenshot did not create ${pngPath}`);
      }
    }
  }

  console.log(`Theme screenshots written to ${path.relative(root, outDir)}/`);
  for (const [theme] of themes) {
    console.log(`- ${theme}: dashboard desktop/mobile, activity desktop/mobile, settings desktop`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
