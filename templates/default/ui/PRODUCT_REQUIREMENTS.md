# CoAutoResearch Web UI Requirements

## Product Goal

Provide a minimal, beautiful, Cold-start-first interface for starting and steering a CoAutoResearch project through a real local agent CLI session. Codex is the default backend; Claude Code is optional.

The UI should feel closer to a calm research workspace and ChatGPT-style session than to an IDE dashboard. Repository markdown files remain the source of truth.

---

## Core Experience

### 1. Cold Start

Cold start is the required prelaunch workflow, shown as a three-step main screen.

It exposes editable files before launch:

- `resources/user_input/INITIAL_BRIEF.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `manuscript/BLUEPRINT.md`

Only the active step's content is visible:

- Step 1: edit cold-start files, preview Markdown, set target venue / audience as a string, and attach optional resources.
- Step 2: review launch settings and run `Cold start and launch`.
- Step 3: message the captured agent session.

The user can choose a resource type, browse local files or folders from the UI, and add them as optional resources. Supported types are ongoing work, papers/literature, proposals, and data/other. The backend attaches each selected item into the matching resource folder, creates a symlink when possible, and falls back to copying only if symlink creation fails. PDF, DOCX, and other binary files can be stored as resources, but only supported text files are rendered or edited inline.

When the UI creates a project from dashboard mode, the creation dialog includes
an agent backend selector. Codex is selected by default; Claude Code is
available as an optional project default. Project creation does not require the
selected CLI to be installed yet.

### 2. Session Chat

The main screen is a centered conversation with the active agent session.

- Normal messages resume the current agent session.
- Messages starting with `/` are handled as local CoAutoResearch controls or sent to the current agent session.
- `Continue` resumes the current session and asks it to continue the research loop.
- Chat is disabled until the first agent session exists.
- The UI must not fake assistant work. The session log should show what the real agent process is doing.

### 2.1 Structured Agent Trace

Agent runs should render as a progressively disclosed service trace while
preserving the chat transcript fallback. Backend parsers may attach an optional
`payload` object to transcript entries; entries without payload must render
exactly as legacy transcript items.

Supported payload types are:

- `command`: command, cwd, status, exit code, output tail, duration.
- `tool_call`: tool name, call id, args, result, status, error flag.
- `file_change`: one or more path/action/diff summaries with plus/minus counts.
- `plan_update`: live checklist steps from Codex plan updates or Claude TodoWrite.
- `approval`: display-only approval request/resolution cards, ready for future user decisions.
- `usage`: token, cost, duration, model, and turn summary.
- `web_search` and `error`: compact activity/error cards.

The trace never exposes hidden chain-of-thought. Reasoning entries may display
only official reasoning summaries emitted by the agent. Every payload entry must
also include readable `content` so copy/export and legacy clients still have a
text fallback.

### 3. Session Controls

Session controls are shown in Step 2 before launch, not in Step 1.

The user can adjust:

- model;
- reasoning effort;
- backend (`codex` or `claude`);
- provider-specific permissions;
- live web search;
- structured trace cards;
- experimental Codex app-server chat/framing, default off;
- advanced Codex `-c key=value` config overrides.

Settings store the per-project default backend. Launch controls can override it
for a single run. If `COAUTO_AGENT_BACKEND` is set in the server environment,
the UI must show that the environment is forcing the runtime backend and should
not silently use a different backend. Invalid `COAUTO_AGENT_BACKEND` values are
ignored with a visible warning instead of silently becoming Codex.

Before starting framing, autoresearch, chat, resume, or restart, the backend
checks the selected runtime backend with provider-specific setup commands:
`codex --version`, `codex login status`, `claude --version`, and
`claude auth status`. A definitely missing or unauthenticated selected backend
blocks startup with provider-specific setup guidance. Unknown auth status from
older CLIs is a warning, not a hard block.

The UI exposes common local slash commands:

- `/status`
- `/ps`
- `/goal`
- `/goal pause`
- `/goal resume`
- `/goal restart`
- `/permissions`
- `/model`
- `/plan`
- `/diff`

### 4. Session Log

The chat screen includes a compact agent session panel:

- current status;
- captured session id;
- command used to start or resume the agent;
- recent JSONL/log output;
- stop control for the active subprocess.

The UI must never use `--last` implicitly. It should resume only the captured session id.

### 5. Repository Materials

The left sidebar opens material views:

- Resources
- Trials
- Reviews
- Manuscript

Resources and Trials are expandable file-browser views. File contents open inline at the file's own position and provide text-file editing where supported.

The Manuscript view may surface candidate figure previews for active inline
figure specs when the active backend is Codex and image generation is available.
Generated images are candidate manuscript assets, not independent research
results: the blueprint remains the source of truth and must record the source
path, Markdown preview image, provenance, and remaining blocker for each active
figure.

---

## Visual Direction

- three-step studio workflow before chat;
- quiet dark left navigation;
- editorial workspace composition with editor/preview and resource panels;
- thin borders;
- restrained accent color;
- editorial serif headings with clean system sans-serif controls;
- no decorative dashboard charts;
- no runner screen;
- no educational copy aimed at execution agents;
- no Cold start modal;
- no Project sidebar item.

---

## Non-Goals

- replacing the IDE;
- replacing git;
- storing hidden state in a database;
- creating a generic shell runner UI;
- writing pending intervention files from chat;
- promoting speculative figure images as final research results;
- launching arbitrary dangerous commands from browser controls.
