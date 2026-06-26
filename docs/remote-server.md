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
  https://example.trycloudflare.com
```

Keep the terminal running while you use the UI. Press `Ctrl+C` to stop both the
UI and the temporary link.

## Cloudflare CLI setup

Install `cloudflared` once on the remote server for the best remote experience.

### 1. Install cloudflared

Linux without sudo:

```bash
npx --yes co-auto-research install-cloudflared
```

This installs the standalone `cloudflared` binary into `~/.local/bin`. The
CoAutoResearch CLI checks that location automatically, so you do not need to
change `PATH` before rerunning `--remote`.

macOS/Homebrew:

```bash
brew install cloudflared
```

Windows/PowerShell:

```powershell
winget install -e --id Cloudflare.cloudflared
```

System packages and other platforms:
<https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>.

If the Linux server can reach the internet only through an HTTP proxy, keep
using the same `--remote` command. CoAutoResearch detects
`COAUTO_REMOTE_PROXY`, `HTTPS_PROXY`, or `HTTP_PROXY` and routes `cloudflared`
through `graftcp` when the helper is installed.

Install the proxy helper without sudo:

```bash
npx --yes co-auto-research install-graftcp
```

This installs `graftcp` into the CoAutoResearch user tool directory. The CLI
checks that location automatically, so you do not need to change `PATH`.

### 2. Run

```bash
co-auto-research ui --remote
```

If you use CoAutoResearch through `npx`, keep the prefix:
`npx --yes co-auto-research ui --remote`. The CLI setup prompt prints the
matching command automatically.

### 3. Check

```bash
co-auto-research doctor
```

If `cloudflared` is installed in a non-standard location, set
`COAUTO_CLOUDFLARED=/path/to/cloudflared`.

If `graftcp` is installed in a non-standard location, set
`COAUTO_GRAFTCP=/path/to/graftcp`.

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
access. The printed link is a temporary public URL while the terminal process is
running. Do not share it broadly or use it as a long-running public service.

## HTTP proxy servers

Some remote servers cannot reach the internet directly and must use an
HTTP(S) proxy such as `http://10.21.11.21:8888`. In that environment,
`cloudflared` may bypass proxy environment variables. On Linux, CoAutoResearch
uses `graftcp` to route `cloudflared` connections through the proxy while still
keeping the user command simple:

```bash
co-auto-research ui --remote
```

Proxy detection order:

```text
COAUTO_REMOTE_PROXY
HTTPS_PROXY / https_proxy
HTTP_PROXY / http_proxy
```

To pass a proxy explicitly for one run:

```bash
co-auto-research ui --remote --proxy http://10.21.11.21:8888
```

Equivalent manual command for debugging:

```bash
graftcp --select_proxy_mode only_http_proxy \
  --http_proxy 10.21.11.21:8888 \
  cloudflared tunnel --url http://127.0.0.1:8765 --protocol http2
```

Use `COAUTO_REMOTE_PROXY_MODE=off` to disable automatic proxy-helper wrapping.
When proxy mode is enabled, CoAutoResearch forces `cloudflared --protocol http2`
because HTTP proxies do not carry QUIC/UDP reliably.

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
localhost and uses Cloudflare Quick Tunnel instead of opening a server port.
Avoid `--host 0.0.0.0` unless the server is protected by network controls and
authentication. The UI can read project files and launch local agent CLI runs,
so it should not be exposed as a long-running public web service.
