---
layout: default
title: Platform Support
---

# Platform Support

CoAutoResearch is designed to run on macOS, Linux, and Windows.

## Required Tools

- Node.js 18 or newer.
- Python 3.
- Git.
- OpenAI Codex CLI.

The package CLI starts the local web UI with Python. It tries these Python
commands in order:

1. `COAUTO_PYTHON` or `PYTHON`, if set.
2. `python3`
3. `python`
4. `py -3`

## macOS And Linux

The normal flow is:

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

Windows native use should work with Node.js, Python 3, Git, and Codex CLI on the
Windows `PATH`.

PowerShell examples:

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
and Codex CLI installed. Keep the UI bound to `127.0.0.1` and forward the port
with SSH or an equivalent secure tunnel.

See [Remote server setup](remote-server.html).
