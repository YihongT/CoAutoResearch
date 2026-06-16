---
layout: default
title: Remote Server Use
---

# Remote Server Use

Run the UI on the remote server bound to localhost:

```bash
cd my-project
python3 ui/server.py --host 127.0.0.1 --port 8765
```

For a dashboard over several projects on the server:

```bash
cd /path/to/projects
co-auto-research ui --projects-dir . --host 127.0.0.1 --port 8765 --no-open
```

From your local machine, forward that port:

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

The CLI skips automatic browser launch in SSH sessions by default. `--no-open`
makes this explicit and keeps the remote server from trying to open a browser on
the server machine.

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
