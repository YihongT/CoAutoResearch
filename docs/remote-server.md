---
layout: default
title: Remote Server Use
description: Open a CoAutoResearch UI running on a remote server from your local browser.
---

# Remote Servers

Run the UI on the remote server in remote mode:

```bash
cd my-project
co-auto-research ui --remote
```

Remote mode keeps the UI bound to `127.0.0.1`, skips browser launch on the
server, and prints the SSH tunnel command plus local browser URL after the UI
starts.

Equivalent explicit command:

```bash
cd my-project
co-auto-research ui --host 127.0.0.1 --port 8765 --no-open
```

For a dashboard over several projects on the server:

```bash
cd /path/to/projects
co-auto-research ui --projects-dir . --host 127.0.0.1 --port 8765 --no-open
```

Or, with the same remote-mode hints:

```bash
co-auto-research ui --projects-dir . --remote
```

From your local machine, forward the printed port:

```bash
ssh -N -L 8765:127.0.0.1:8765 user@server
```

If the server prints a different URL because port `8765` was already in use,
forward that printed port instead, for example
`ssh -N -L 8766:127.0.0.1:8766 user@server`.

Then open:

```text
http://127.0.0.1:8765
```

`--remote` is the recommended command because it prints the correct local
instructions after the server picks its actual port.

## File Access Semantics

- The UI server runs on the remote machine.
- The server-side file browser sees the remote filesystem.
- In multi-project mode, uploads and file operations go to the project selected
  in the left sidebar.
- Drag-and-drop or browser file picker uploads local browser files into the
  remote project over HTTP.
- Folder drag-and-drop is not a stable remote path mechanism; use the
  server-side browser for folders already present on the server.
- Large files should be transferred with `scp`, `rsync`, `rclone`, Git LFS, or
  dataset hosting, then attached from the server filesystem.

## Security

Prefer SSH tunnels. Avoid `--host 0.0.0.0` unless the server is protected by
network controls and authentication. The UI can read project files and launch
Codex CLI runs, so it should not be exposed as an unauthenticated public web
service.
