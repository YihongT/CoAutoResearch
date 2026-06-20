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

### 2. Session Chat

The main screen is a centered conversation with the active agent session.

- Normal messages resume the current agent session.
- Messages starting with `/` are handled as local CoAutoResearch controls or sent to the current agent session.
- `Continue` resumes the current session and asks it to continue the research loop.
- Chat is disabled until the first agent session exists.
- The UI must not fake assistant work. The session log should show what the real agent process is doing.

### 3. Session Controls

Session controls are shown in Step 2 before launch, not in Step 1.

The user can adjust:

- model;
- reasoning effort;
- backend (`codex` or `claude`);
- provider-specific permissions;
- live web search;
- advanced Codex `-c key=value` config overrides.

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
- automatically drawing figures;
- launching arbitrary dangerous commands from browser controls.
