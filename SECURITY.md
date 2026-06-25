# Security Policy

## Supported Versions

Security fixes target the latest version published on npm. Please upgrade to the
latest release before reporting.

## Reporting a Vulnerability

Please report security issues privately through GitHub security advisories
(**Security → Report a vulnerability** on the repository), or email
<yihong.tang.edu@gmail.com>. Do not open a
public issue for secrets exposure, arbitrary command execution, path traversal,
or UI access-control problems.

## Local UI Security Notes

The web UI can browse files, attach resources, and launch a local agent CLI
process inside a generated project. Codex is the default backend; Claude Code is
optional. Bind the UI to `127.0.0.1` by default. Do not expose it directly on a
public interface without an authenticated tunnel or other access control.

`co-auto-research ui --remote` uses the official `cloudflared` CLI to create a
temporary Cloudflare Quick Tunnel URL for browser access from another machine.
CoAutoResearch protects that URL with a one-time token stored in a session
cookie after first load, but the URL is still publicly reachable while the
terminal process is running. Treat it as temporary personal access, not a
long-running shared service.

Before launching an agent run, the UI may execute local readiness probes for the
selected backend: `codex --version`, `codex login status`, `claude --version`,
or `claude auth status`. These checks are used only to produce clearer setup
errors. CoAutoResearch does not read, store, or transmit provider credentials;
authentication remains managed by the Codex or Claude Code CLI.
