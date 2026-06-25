# Platform Support

CoAutoResearch is designed to run on macOS, Linux, and Windows.

## Required Tools

- Node.js 18 or newer.
- Python 3.
- Git.
- OpenAI Codex CLI for the default backend.
- Claude Code CLI for the optional Claude backend.

The package CLI starts the local web UI with Python. It tries these Python
commands in order:

1. `COAUTO_PYTHON` or `PYTHON`, if set.
2. `python3`
3. `python`
4. `py -3`

## macOS And Linux

The simplest dashboard-first flow is:

```bash
co-auto-research ui
```

The CLI opens the UI in your browser after the server starts. If that is not
available, open the printed URL manually, then create projects from the sidebar.
For a scripted command-line flow:

```bash
co-auto-research init my-project
cd my-project
co-auto-research ui
```

For direct UI server use:

```bash
python3 ui/server.py --host 127.0.0.1 --port 8765
```

## Windows Native

Windows native use should work with Node.js, Python 3, Git, and the selected
agent CLI on the Windows `PATH`.

PowerShell examples:

```powershell
co-auto-research ui
```

The CLI opens the UI in your browser after the server starts. If that is not
available, open the printed URL manually, then create projects from the sidebar.
For a scripted command-line flow:

```powershell
co-auto-research init my-project
cd my-project
co-auto-research ui
```

For direct UI server use:

```powershell
py -3 ui/server.py --host 127.0.0.1 --port 8765
```

If `py -3` is unavailable but `python` works, use:

```powershell
python ui/server.py --host 127.0.0.1 --port 8765
```

### Agent Executable Resolution

Codex remains the default backend. Choose Codex or Claude Code when creating a
project, change the per-project default in Settings, or override one launch from
the launch dialog. Set `COAUTO_AGENT_BACKEND=claude` or
`COAUTO_AGENT_BACKEND=codex` only when the server environment should force one
backend; while set, runtime launches use the forced backend even if the UI saves
a different choice. Other values are ignored with a visible warning.

The UI resolves Codex in this order:

1. `COAUTO_CODEX`, if set.
2. `CODEX_BIN`, if set.
3. `codex.cmd`, `codex.exe`, `codex.bat`, then `codex` on `PATH`.

This matters on Windows because npm global binaries are commonly installed as
`.cmd` shims. If Codex fails to start, run:

```powershell
codex --version
codex login status
Get-Command codex
```

Then start `co-auto-research ui` from the same PowerShell session. If needed,
pin the executable explicitly:

```powershell
$env:COAUTO_CODEX = (Get-Command codex).Source
co-auto-research ui
```

The UI resolves Claude Code similarly:

1. `COAUTO_CLAUDE`, if set.
2. `CLAUDE_BIN`, if set.
3. `claude.cmd`, `claude.exe`, `claude.bat`, then `claude` on `PATH`.

```powershell
claude --version
claude auth status
Get-Command claude
$env:COAUTO_AGENT_BACKEND = "claude"
$env:COAUTO_CLAUDE = (Get-Command claude).Source
co-auto-research ui
```

Before starting framing, autoresearch, chat, resume, or restart, the UI checks
the selected backend with `--version` and the provider auth status command. A
definitely missing or unauthenticated selected backend blocks startup with
provider-specific instructions; the UI never silently falls back to the other
backend.

### Claude Code With Anthropic-Compatible Gateways

Claude Code can run through an Anthropic-compatible gateway while CoAutoResearch
still drives the normal Claude Code CLI. In Settings, choose `Claude Code`, then
set **Claude provider** to `Z.AI GLM Coding Plan` or `Custom
Anthropic-compatible gateway`. Z.AI GLM uses:

```powershell
$env:ANTHROPIC_BASE_URL = "https://api.z.ai/api/anthropic"
$env:ANTHROPIC_AUTH_TOKEN = "<your Z.AI key>"
```

The UI also detects gateway credentials in `~/.claude/settings.json` and the
project's `.claude/settings.local.json` `env` blocks. A complete gateway config
is treated as usable even if `claude auth status` reports that no Anthropic login
is present.

Use `https://api.z.ai/api/anthropic` for Claude Code. Z.AI's
OpenAI-compatible endpoint, `https://api.z.ai/api/coding/paas/v4`, is for
OpenAI-compatible clients and should not be used as Claude Code's
`ANTHROPIC_BASE_URL`.

Shell aliases and functions are not used when CoAutoResearch starts Claude Code;
the UI launches a real executable with `subprocess`. If your GLM setup is a
shell alias such as `glm() { ... claude "$@"; }`, move the env values into
Claude settings or the UI Settings form, or set `COAUTO_CLAUDE` to a wrapper
script file.

Codex also documents native Windows sandbox modes. If native sandbox setup is
blocked by enterprise policy or admin restrictions, use WSL2.

## Windows With WSL2

WSL2 is a good option when the research code, datasets, or build tools expect a
Linux environment. In WSL2, use the macOS/Linux commands above.

For best filesystem performance, keep projects under the Linux home directory,
for example:

```bash
mkdir -p ~/code
cd ~/code
co-auto-research init my-project
```

Avoid working from `/mnt/c/...` for large projects when possible.

## File Attachment Behavior

The UI can attach local files and folders into a generated project. Files are
copied. Folders are symlinked when possible and copied if symlinks are not
available. This fallback matters on Windows, where symlink permission can vary
by user policy.

## Remote Servers

Remote use is OS-independent as long as the server has Node.js, Python 3, Git,
and the selected agent CLI installed. Keep the UI bound to `127.0.0.1` and forward the port
with SSH or an equivalent secure tunnel.

See [Remote server setup](remote-server.md).
