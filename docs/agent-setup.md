# Set up CoAutoResearch with a coding agent

These instructions are for the user's coding agent. The requested outcome is a usable research workspace, ready for the user to define the research and choose when to start. Finish with a running,
verified dashboard and its URL, plus the paper-export environment described in
[paper generation](paper-generation.md). Reuse the user's existing installation
and projects when available.

## 1. Identify the installation

If this repository is already open, use it. Otherwise clone
`https://github.com/YihongT/CoAutoResearch.git` into an unused directory and
read its README. Preserve existing checkouts and local changes; do not reset
them or replace a global CLI as part of setup.

Read `package.json` to report the source version. When using npm instead,
compare `npm view co-auto-research version` first. Do not claim the published
package contains unreleased repository features.

The source CLI has no application dependencies or build step. Run it with
`node /absolute/path/to/CoAutoResearch/bin/auto-research.js`; no `npm link`,
global installation, Python virtual environment, or `pip install` is needed
to start the dashboard. Individual research projects can need their own
scientific dependencies later.

## 2. Check prerequisites and the selected backend

Verify Node.js **20+**, Python **3.10+**, and Git. Try `python3`, `python`, or
Windows `py -3`; set `COAUTO_PYTHON` to an available supported executable when
autodetection does not find it. Install missing prerequisites using the
platform's normal method, preserving existing versions and shell settings.

Reuse the user's installed, authenticated Codex or Claude Code. If both are
ready and the user has no preference, keep CoAutoResearch's Codex default.
Only one backend is needed.

| Backend | Install | Login | Verify |
| --- | --- | --- | --- |
| Codex | `npm install -g @openai/codex@latest` | `codex login` | `codex --version` and `codex login status` |
| Claude Code, macOS/Linux/WSL | `curl -fsSL https://claude.ai/install.sh \| bash` | `claude auth login` | `claude --version` and `claude auth status` |
| Claude Code, Windows PowerShell | `irm https://claude.ai/install.ps1 \| iex` | `claude auth login` | `claude --version` and `claude auth status` |

Ask the user to complete any interactive provider login. Do not read or copy
credential files, log out an existing account, or ask for secrets in chat.
Existing CLI authentication is sufficient. If the user chooses API billing,
they can enter the appropriate key in **Settings → Agent**.

Run login on the host where CoAutoResearch runs. For headless Codex, the
official alternative is `codex login --device-auth`. CLI executables outside
PATH can be selected with `COAUTO_CODEX` or `COAUTO_CLAUDE`.

Verify current provider instructions when installation or login differs:
[Codex setup](https://developers.openai.com/codex/cli),
[Codex login](https://developers.openai.com/codex/auth),
[Claude setup](https://code.claude.com/docs/en/setup),
[Claude login](https://code.claude.com/docs/en/authentication).

## 3. Start and verify the dashboard

From the source checkout, run:

```bash
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

Keep the UI process running. If the agent's command runner closes background
processes when a task ends, start the command in a persistent terminal and
tell the user which terminal must stay open. Use `--port 8766` if the default
port is already occupied. Only enable remote access if the user needs it;
see [remote setup](remote-server.md).

Verify all of the following before reporting success:

1. The server remains alive and its printed local URL opens the dashboard.
2. The setup dialog identifies the chosen CLI and authentication correctly.
   The other backend may remain uninstalled. Use **Refresh login and models**
   after logging in or updating a CLI.
3. Create a disposable project in the UI, select the chosen backend, and
   confirm it opens. If the user already supplied a real project, open that
   instead. Do not start autoresearch merely to verify installation.
4. **Settings → Agent** shows models and compatible reasoning options.
   Save the chosen backend. If model discovery fails, resolve that error;
   do not substitute a guessed model ID or report the agent ready to run.
5. Return to the main research chat and verify its input is usable. Close
   and reopen the page to confirm the project persists.

Doctor checks tool installation; it does not prove provider access or model
inference. Login and the browser checks above are separate acceptance steps.
When a browser tool is unavailable, report precisely which check the user
still needs to perform.

## 4. Prepare paper generation

Follow the **Setup contract for the coding agent** in
[paper-generation.md](paper-generation.md). Run the product paper-tools installer to install its four pinned skills, prepare
the isolated Python environment, and verify a LaTeX-to-PDF build and page rendering. Reuse existing
LaTeX and Poppler installations. Do not generate a research paper or start a trial
as part of installation.

Keep the dashboard running while preparing these tools. Report dashboard readiness
and paper-export readiness separately if a download, permission, or dependency
prevents completing the latter. Installing skills alone is not a successful PDF
setup. The dashboard itself still needs only the prerequisites above.

## 5. Leave the workspace ready

Report the installed/source version, dashboard URL, project folder, selected
backend/model, the four skill locations and pinned revision, the paper-environment
Python path, the PDF/render smoke-check result, and the exact command to reopen it.
Tell the user to open **Manuscript → Generate paper** when they want a paper;
the product handles generation through its internal agent.
The default project folder
is `co-autoresearch-projects/` under the launch directory; respect an existing
folder or explicit `--projects-dir` choice. Explain that the terminal owns
the server and must remain open. Leave the dashboard ready for the user's
research brief and their decision to start autoresearch.
