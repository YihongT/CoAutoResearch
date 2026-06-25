# Remote Servers

Run the UI on the remote server in remote mode:

```bash
cd my-project
co-auto-research ui --remote
```

Remote mode keeps the UI bound to `127.0.0.1`, skips browser launch on the
server, runs the official `cloudflared` CLI to create a temporary Cloudflare
Quick Tunnel, and prints a browser URL you can open from your local machine:

```text
Open:
  https://example.trycloudflare.com/?coauto_token=...
```

Keep the terminal running while you use the UI. Press `Ctrl+C` to stop both the
UI and the temporary link.

## Install cloudflared

Install `cloudflared` once on the remote server for the best remote experience:

```bash
# macOS
brew install cloudflared

# Windows
winget install --id Cloudflare.cloudflared
```

For Linux packages and other platforms, use the official downloads page:
<https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>.

If `cloudflared` is installed in a non-standard location, set
`COAUTO_CLOUDFLARED=/path/to/cloudflared`.

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

Or, with the same remote browser link:

```bash
co-auto-research ui --projects-dir . --remote
```

Cloudflare Quick Tunnels are intended for development and personal temporary
access. CoAutoResearch adds a one-time token to the printed URL and stores it in
a session cookie on first load, but the link is still a temporary public URL.
Do not use it as a long-running public service.

## SSH Fallback

If the server cannot use Cloudflare, force the SSH-only advanced path:

```bash
COAUTO_REMOTE_MODE=ssh co-auto-research ui --remote
```

From your local machine, forward the printed port:

```bash
ssh -N -L 8765:127.0.0.1:8765 user@<ssh-host>
```

Use the same SSH host or alias you used to connect to the server. CoAutoResearch
does not guess the host from the server machine name because that is often an
internal hostname. To print a fully concrete command, start the UI with
`COAUTO_REMOTE_TARGET=user@host` set on the server.

If the server prints a different URL because port `8765` was already in use,
forward that printed port instead, for example
`ssh -N -L 8766:127.0.0.1:8766 user@<ssh-host>`.

Then open:

```text
http://127.0.0.1:8765
```

If the server prints a tokenized local URL, open that full URL.

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

Prefer `--remote` for temporary remote access because it keeps the UI bound to
localhost and adds a one-time token to the Cloudflare link. Avoid
`--host 0.0.0.0` unless the server is protected by network controls and
authentication. The UI can read project files and launch local agent CLI runs,
so it should not be exposed as an unauthenticated public web service.
