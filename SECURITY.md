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

The v2.0 web UI can browse files, attach resources, and launch a local agent CLI
process inside a generated project. Codex is the default backend; Claude Code is
optional. Bind the UI to `127.0.0.1` by default. Do not expose it directly on a
public interface without an authenticated tunnel or other access control.

The supported production profile assumes one trusted human and one project per
UI server process. It is not a multi-user or multi-tenant isolation boundary,
and the agent still runs with the operating-system user's privileges. The
canonical write guard, staged review, path checks, and transaction protocol
protect project-state integrity; they are not a general OS sandbox.

On POSIX systems, cleanup covers the dedicated process group and discoverable
descendants that retain `COAUTO_PROCESS_TREE_ID`, including `setsid()`
descendants that retain it. A same-user process that clears the marker can
evade this mechanism; hostile-workload containment requires a cgroup,
container, or platform supervisor.

`co-auto-research ui --remote` uses the official `cloudflared` CLI to create a
temporary Cloudflare Quick Tunnel URL for browser access from another machine.
On Linux servers that require an HTTP proxy, CoAutoResearch may run
`cloudflared` through `graftcp` so the same temporary tunnel can reach
Cloudflare.
The URL is publicly routable while the terminal process is running, but the UI
requires the generated access key printed in that terminal. The key is stored in
an HttpOnly, SameSite cookie after login; unauthenticated API requests receive
`401`, and foreign-origin or cross-site mutations are rejected. Treat the URL
and key as temporary personal access, do not share either, and do not use a
Quick Tunnel as a long-running production service. Remote production requires
an authenticated reverse proxy, VPN, Cloudflare Access, or equivalent network
boundary in addition to the application token.

Project-relative file APIs reject traversal, encoded traversal, Windows and
POSIX absolute paths, symlink escapes, secrets, UI runtime state, staging data,
transaction snapshots, migration backups, and Git internals. JSON and file
responses use `no-store`; public session, overview, trace, and log data redact
configured credentials and private guard paths.

On native Windows, runtime-session persistence pins project ancestors with
no-follow handles and compares the volume serial number plus the complete
128-bit file identity. Use NTFS or ReFS; providers that do not expose a
trustworthy identity fail closed before session state is read or published.

During a v2 trial, agent writes are compared with a private baseline outside the
project. Unauthorized canonical changes are quarantined and restored before
publication can proceed. Canonical updates are applied only by the service
through a locked, journaled transaction with before/after hashes and crash
recovery. Do not manually edit service-owned JSON or transaction evidence.

## Dependency Audit Policy

The application currently has no npm dependencies. Maintainers must review
changes to the lockfile and run `npm audit --omit=dev --audit-level=high` before
publishing. High or critical production findings block the release. Optional
paper tools have separately pinned Python dependencies; review those alongside
their upstream skills when updating `ui/paper_tools.py`.

There are currently no accepted dependency-audit exceptions. Any future
exception must be recorded in this section before release with the advisory ID,
affected package and versions, exposure analysis, compensating controls, owner,
approval date, and a time-bounded review or expiry date. An undocumented audit exception is never accepted.

Before launching an agent run, the UI may execute local readiness probes for the
selected backend: `codex --version`, `codex login status`, `claude --version`,
or `claude auth status`. These checks are used only to produce clearer setup
errors. If you choose an API-key provider in Settings, CoAutoResearch stores that
key in the local UI settings file and injects it only into the selected backend's
child process environment. `/api/settings` reports only whether a key is present;
it never returns the raw key. Do not commit the local UI runtime settings folder
or share it with other users.
