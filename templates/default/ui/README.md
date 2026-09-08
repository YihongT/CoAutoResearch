# CoAutoResearch dashboard runtime

The dashboard is the research workspace for CoAutoResearch. A research brief
starts the conversation; the researcher chooses when to start Autoresearch.
Separate chats support parallel discussion, with suggestions reviewed and sent
through the main research draft. Manuscript and Paper connect the research
record to a readable narrative and generated PDF.

## Run a generated project

From this generated project's root, with Python 3.10+:

```bash
python3 ui/server.py --host 127.0.0.1 --port 8765
```

On Windows, `py -3 ui/server.py` can select Python. Open the URL printed by the
server and keep the process running. For a folder containing several projects,
prefer the package CLI:

```bash
co-auto-research ui --projects-dir /path/to/projects
```

The dashboard uses the Python standard library and has no npm application
dependencies. Research environments and paper-generation tools are separate.
Keep loopback binding for local use; configure supported authentication before
remote access. This deployment is intended for one trusted researcher.

## Main files

| File | Responsibility |
| --- | --- |
| `server.py` | HTTP serving, project operations, agent runs and lifecycle coordination |
| `index.html`, `styles.css` | Application shell, themes and responsive layout |
| `app.js` | Research views, controls, polling, previews and settings |
| `sessions-panel.js`, `aux_sessions.py` | Separate discussion sessions and research suggestions |
| `v2_*.py` | Typed research lifecycle, review, publication and recovery |
| `paper_export.py`, `paper_tools.py` | Isolated evidence-to-paper execution and its tool environment |

## Agent access

The selected backend must be installed and authenticated. Refresh login and
model discovery after changing a CLI or account. An installed executable alone
does not prove model access. A missing selected backend blocks the run with
setup guidance; the service does not silently switch providers.

The runtime launches Codex or Claude Code through their CLIs. It does not
control an already-open IDE conversation. Use `COAUTO_CODEX` or `COAUTO_CLAUDE`
for an executable outside PATH. On Windows, supported executable shims are
resolved by the server. Shell aliases are not inherited by subprocesses.

## State and control boundaries

Project creation does not start research. Sending a brief prepares the research
direction; starting Autoresearch authorizes the bounded lifecycle. A pause
request takes effect after the current agent turn, which may leave a trial
unfinished. Stop interrupts execution. Resume continues the current process;
Restart restores the first-launch direction and archives later work.

In v2, auxiliary discussions are read-only with respect to research files.
**Add to research draft** changes the composer, not the research state. The
researcher reviews and sends the suggestion. Uploaded files are copied into
project resources; linked folders remain at their source location. A remote
server can access only paths available on that host.

Validated JSON and service-owned transaction records determine v2 state.
Markdown views make it readable. Internal publication means a reviewed result
was recorded in the project, not scientific endorsement or external publication.
Keep API paths, schemas, status enums and history markers compatible when
changing display text. Provider errors used by recovery logic must retain their
original diagnostics.

Paper generation snapshots eligible evidence into an isolated writing workspace.
It creates figures, sources and a PDF without running new experiments. A ready
paper is a draft for human review. Cancellation or a failed replacement leaves
an earlier completed paper available.
