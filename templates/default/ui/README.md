# CoAutoResearch Web UI

This is a local, file-backed web interface for the CoAutoResearch scaffold. The main surface starts as a project-framing chat, then becomes a conversation connected to the selected real agent CLI session after autoresearch is launched. Codex is the default backend; Claude Code is optional. Project materials open from the left sidebar when needed.

## Run

From the repository root:

```bash
python3 ui/server.py
```

Open:

```text
http://127.0.0.1:8765
```

Optional host and port:

```bash
python3 ui/server.py --host 127.0.0.1 --port 8780
```

If the requested port is busy, the server automatically tries the next available
port and prints the actual URL to open.

On Windows, direct server use is usually:

```powershell
py -3 ui/server.py --host 127.0.0.1 --port 8780
```

If an agent CLI fails to start on Windows, verify `codex --version` or
`claude --version` in the same PowerShell session used to launch the UI. The
backend resolves `.cmd`, `.exe`, and `.bat` shims; set `COAUTO_CODEX` or
`COAUTO_CLAUDE` to `(Get-Command <tool>).Source` if your PATH differs between
terminals.

From the package CLI, a parent folder can be served as a multi-project
dashboard:

```bash
co-auto-research ui --projects-dir /path/to/projects
```

In dashboard mode, click `+` in the left sidebar to create a new project inside
that folder. The UI uses the same immutable template as `co-auto-research init`.

No npm or pip install is required.

## Files

- `server.py`: Python standard-library backend for static serving, file summaries, cold-start writes, Codex or Claude Code runs, session settings, and git status.
- `index.html`: Cold start and agent-session single-page application shell.
- `styles.css`: responsive, warm minimal workspace styling.
- `app.js`: client-side rendering, polling, previews, cold-start submission, session controls, and agent chat commands.
- `PRODUCT_REQUIREMENTS.md`: product specification.

## User Experience

- Project framing: write the research brief, set target venue / audience, attach optional resources, and review or edit the generated `PROJECT.md` draft in the main chat surface.
- Launch autoresearch: opens a settings dialog and starts the first real agent CLI session only after the user confirms launch.
- Session chat: after launch, the same UI shows the captured transcript and sends follow-up messages to the same resumed session.
- Chat: enabled only after a session exists, and sends follow-up instructions through Codex `exec resume` or Claude Code `--resume`.
- Continue: resumes the current session and asks it to continue the research loop without an extra user instruction.
- Session controls: passes provider-specific model, reasoning effort, permissions, live web search, and advanced Codex `-c key=value` overrides where applicable.
- Slash commands: sends commands such as `/goal`, `/ps`, `/status`, `/permissions`, `/model`, `/plan`, and `/diff` to the current session.
- Left sidebar: switches the main area between Agents, Resources, Trials, Reviews, and Manuscript.
- Project switcher: in multi-project mode, the left sidebar switches between
  independent generated projects. Each project has its own files, UI runtime
  state, settings, and agent session. The `+` button creates another independent
  project in the served parent folder.
- Resources and Trials: shown as expandable file-browser views.
- Markdown preview: shown beside editable Markdown in cold start and inline file views.
- Source preview: shown inline at the file's own position and can save supported text files.

The UI controls a real local Codex or Claude Code CLI session. It does not control an already-open conversation inside an IDE panel.

## File Writes

The UI writes only when the user submits a form:

- Project-framing input: `resources/user_input/INITIAL_BRIEF.md`.
- Project draft editor: `PROJECT.md`.
- Source preview save: supported text files inside the repository.
- Target venue text: `resources/target_venue/TARGET_VENUE.md`.
- Local resources: files or folders selected in the UI are attached into `resources/ongoing_work/`, `resources/literature/`, `resources/proposals/`, or `resources/data_sources/` based on the selected type; the backend creates symlinks when possible and falls back to copy only when symlink creation fails.
- Agent runs: whatever repository files the active Codex or Claude Code session edits after the user launches autoresearch, continues, chats, or sends slash commands.

Do not put real secrets into uploaded files or markdown resources.
