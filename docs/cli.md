# CLI Reference

The package exposes two equivalent commands:

```bash
co-auto-research
auto-research
```

These commands are available after installing the npm package:

```bash
npm install -g co-auto-research
```

To update:

```bash
npm install -g co-auto-research@latest
```

For the current source checkout, use `node bin/auto-research.js` in place of
`co-auto-research` in the examples below. There is no build step. See
[Getting started](getting-started.md) for the difference between the source
version and the published npm release, and [agent setup](agent-setup.md) to
have your coding agent install and verify it.

CoAutoResearch v2.0 requires Node.js 20 or newer and Python 3.10 or newer.

## Commands

| Command | Purpose |
| --- | --- |
| `init <dir>` | Copy the template into a new empty project directory. |
| `ls` | List generated projects under the current folder and `co-autoresearch-projects/`. |
| `attach [project]` | Reopen the UI for an existing generated project. |
| `ui` | Start the local web UI. |
| `ui --projects-dir <dir>` | Start a dashboard over several generated projects. |
| `install-cloudflared` | Install the Cloudflare tunnel CLI into the user directory on Linux, without sudo. |
| `install-graftcp` | Install the Linux proxy helper used when `--remote` runs behind an HTTP proxy. |
| `doctor` | Check local prerequisites and port availability. |
| `upgrade` | Print installed version, detected project template version, and npm update command. |
| `upgrade-project` | Plan or apply an additive v1-to-v2 project migration and sync managed instructions, with backups. |
| `backup` | Create a hash-manifested project recovery directory without raw runtime secrets, staging, or transaction snapshots. |
| `restore` | Verify and restore such a backup into a missing or empty project directory. |
| `version` | Print the installed CLI package version. |

## Start the UI

```bash
co-auto-research ui
```

Inside a generated project, this serves that project using the package-managed
UI runtime. Outside a generated project, it creates or serves `co-autoresearch-projects/`
as a dashboard.

## Project Dashboard

```bash
co-auto-research ui --projects-dir ./projects
```

The dashboard lists generated projects directly inside `./projects` and can
create new projects from the UI.

## Return to Existing Work

```bash
co-auto-research ls
co-auto-research attach my-project
```

`ls` scans the current directory, immediate generated-project children, and a
`co-autoresearch-projects/` dashboard folder when present. It prints project names,
statuses, and paths.

`attach` resolves a project by display name, directory name, path, or project ID
prefix, then starts the same UI server that `ui --project <path>` would use.
This is the normal command when you closed the browser or terminal yesterday and
want to continue a previous project today.

If you keep projects somewhere else:

```bash
co-auto-research ls --projects-dir ./projects
co-auto-research attach my-project --projects-dir ./projects
```

## Autoresearch Commands

The dashboard exposes these as buttons, and the composer also accepts the same
slash commands:

| Command | Meaning |
| --- | --- |
| `/goal` | Show the current autoresearch state. |
| `/goal resume` | Resume the loop from the latest active trial. |
| `/goal pause` | Let the current agent turn finish, then pause automatic continuation; the trial may be unfinished. |
| `/goal restart` | Confirm, archive the current trajectory, and start a new Trial 1. |
| `/status` | Show session and gate status. |
| `/ps` | Show running process state. |
| `/diff` | Show changed files. |

`/goal restart` is not a lightweight reset. It archives existing trials, runtime
state, working manuscript, generated workspace, and current findings under
`archive/restarts/`. Legacy projects retain user-uploaded or user-confirmed
resources; autoresearch-discovered or generated resources become prior-run
context until you explicitly reattach or confirm them.

For v2, Restart restores the immutable first-launch `PROJECT.md`, explicit
resource set, and chat prefix through the original `Start autoresearch.` record.
It archives later chat, appends a new `Restart autoresearch.` record, rebuilds
canonical revision 0, and allocates `000001_restart`. Retry continues that exact
Trial 1/stage. Resume—not Restart—is the operation that continues the current
canonical trajectory and numbering.

The dashboard ships with Ivory and Nocturne themes.
The setting is local to the browser and does not clear composer text,
attachments, or context chips.

## v2.0 Run Semantics

For a v2 project, Start and Restart establish a Trial 1 boundary, Resume
continues the current canonical trajectory, and Resume From Trial creates a
bounded fork. One invocation never starts a second trial. Agent output remains proposed until the service validates the typed
artifacts, stages and hashes the candidate snapshot, derives the review route,
closes the required reviews, evaluates merge and gate truth, and commits a
recoverable publication transaction. The UI reports a canonical revision only
when a matching publish receipt exists.

The service, not the agent, owns canonical JSON, merge decisions, gate results,
transactions, and receipts. Existing v1 projects continue through a labeled
legacy read-only Research Board until an additive migration succeeds.

## Update Project Instructions

The npm package updates the CLI and UI runtime. Existing project research files
are not rewritten automatically, but core reviewer and trial-protocol
instructions can be synced when `doctor` or the UI reports an outdated
instruction baseline:

```bash
co-auto-research upgrade-project --dry-run
co-auto-research upgrade-project
```

For a dashboard folder:

```bash
co-auto-research upgrade-project --all --projects-dir co-autoresearch-projects
```

Managed instruction backups are stored under `archive/template_migrations/`.
The v2 migration journal, exact before snapshots, receipt, and rollback
instructions are stored under `archive/v2_migrations/`. The migration preserves
v1 trials, reviewer history, Markdown research content, and custom files outside
the managed core set.

Rollback is deliberately fail-closed and is allowed only while the project is
idle and no newer v2 canonical artifacts depend on the migrated state:

```bash
co-auto-research upgrade-project --rollback
```

The command verifies recorded after-hashes before restoring exact before bytes.
It refuses to discard newer work. See [Upgrading](upgrading.md) for the separate
managed-instruction backup procedure.

## Project Backup And Restore

Stop active work, then create a private backup outside the project directory:

```bash
co-auto-research backup ./my-project --output ./backups/my-project-2026-07-14
```

When run inside a project, the project argument may be omitted. The backup
includes canonical state, trials, resources, manuscript files, schemas,
instructions, and project configuration. It omits `.env`, secret directories,
live staging, and transaction snapshots. `ui/.runtime/settings.json` is kept
only in structurally useful redacted form; token, password, credential, cookie,
and API-key values become `[redacted]`. `BACKUP_MANIFEST.json` records every
included path, size, source mode, and SHA-256.
Keep the `manifest sha256` printed by the backup command separately; restore
requires that value so a replaced manifest cannot silently redefine the backup.

Rehearse recovery into a clean path rather than overwriting a working project:

```bash
co-auto-research restore ./backups/my-project-2026-07-14 ./restore-check/my-project \
  --expected-manifest-sha256 <sha256-from-backup-output>
co-auto-research attach ./restore-check/my-project
```

Restore verifies every manifest entry before it exposes the destination and
refuses a non-empty target, a symlink, a duplicate/unsafe path, or any size/hash
mismatch. The attached Research Board reports `recovery_required`, the restored
project is read-only, and research run controls remain disabled. After inspection,
explicitly release the recovery gate:

```bash
co-auto-research restore-acknowledge ./restore-check/my-project \
  --expected-manifest-sha256 <sha256-from-backup-output> \
  --operator <operator-identifier>
```

Acknowledgement rehashes the restored tree and validates canonical provenance
and retained transaction audit metadata. Resource symlinks are recorded but
never followed or recreated; relink those paths deliberately. Re-enter backend
credentials after restore because raw secrets are deliberately not recoverable.

## Port and Browser Options

```bash
co-auto-research ui --port 8780
co-auto-research ui --no-open
co-auto-research ui --open
co-auto-research attach my-project --port 8780
```

If the requested port is busy, the server tries the next available port and
prints the actual URL.

## Remote Mode

```bash
co-auto-research ui --remote
co-auto-research ui --remote --proxy http://10.21.11.21:8888
```

Remote mode is for SSH-accessible servers. It keeps browser launch disabled on
the server, keeps the UI bound to `127.0.0.1`, and prints a temporary
Cloudflare browser link plus an access key. The browser must present that key;
API requests without it receive `401`. Install the official `cloudflared` CLI
on the remote server for this one-command browser access.
If `cloudflared` is missing, the command prints a short Cloudflare CLI setup
guide with install, run, and check commands. Keep the terminal open while using
the link.

On Linux servers that require an HTTP proxy for internet access, CoAutoResearch
detects `COAUTO_REMOTE_PROXY`, `HTTPS_PROXY`, or `HTTP_PROXY` and runs
`cloudflared` through `graftcp` with `--protocol http2`. If the proxy helper is
missing, the CLI prints `co-auto-research install-graftcp` before starting the
UI server.

If Cloudflare is blocked on the server, set `COAUTO_REMOTE_MODE=ssh` to force
SSH-only remote mode. In that fallback path, the command uses
`user@<ssh-host>` unless `COAUTO_REMOTE_TARGET` is set, because server
hostnames are often not valid SSH aliases from your laptop.

## Supervised experiment execution

From a generated project, coding agents can run a worker with an external wall
deadline and durable exit evidence:

```bash
python3 -B ui/compute_runner.py --wall-seconds 300 \
  --output-dir workspace/run-evidence/attempt-001 -- python3 -u workspace/experiment.py
```

Use the Python executable available on the host and the wall limit approved for
the experiment. The evidence directory must be new: existing output is never
overwritten. `events.jsonl` records the start and final status; `stdout.log` and
`stderr.log` capture worker output. Workers should flush milestone output.
Success requires `status: succeeded`, exit code `0`, and completed process
cleanup. A signal, nonzero exit, timeout, or cleanup failure remains a failed
execution even if partial result files exist. Research conclusions still need
their normal evidence validation.

On POSIX, cleanup covers the worker's isolated process group without requiring
access to the host process table. Workers and their children must remain in that
group: do not daemonize or create detached sessions. On Windows, cleanup uses a
Job Object. The recorded `cleanup_scope` identifies this boundary. The runner
enforces wall time, not aggregate CPU time; a separately approved CPU limit still
needs an appropriate external mechanism. No worker-side profiling timer is needed.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `COAUTO_PYTHON` | Python executable used to start the UI server. |
| `COAUTO_AGENT_BACKEND` | Force the runtime backend for UI-launched agent runs: `codex` or `claude`. Other values are ignored with a warning. Codex remains the default when unset. |
| `COAUTO_CODEX` | Explicit Codex executable path. |
| `CODEX_BIN` | Alternate Codex executable path. |
| `COAUTO_CLAUDE` | Explicit Claude Code executable path. |
| `CLAUDE_BIN` | Alternate Claude Code executable path. |
| `OPENAI_API_KEY` | Used by the Codex `OpenAI API key` provider when no saved Settings key is present. Not passed to Claude Code runs. |
| `ANTHROPIC_API_KEY` | Used by the Claude `Anthropic API key` provider when no saved Settings key is present. Not passed to Codex runs. |
| `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` | Used by Claude gateway providers such as Z.AI GLM or custom Anthropic-compatible gateways. Not passed to Codex runs. |
| `COAUTO_NO_OPEN` | Disable automatic browser launch. |
| `COAUTO_CLOUDFLARED` | Explicit `cloudflared` executable path for `--remote`. |
| `COAUTO_CLOUDFLARED_DOWNLOAD_URL` | Override the standalone `cloudflared` download URL used by `install-cloudflared`. |
| `COAUTO_GRAFTCP` | Explicit `graftcp` executable path for proxy-aware `--remote`. |
| `COAUTO_GRAFTCP_DOWNLOAD_URL` | Override the standalone `graftcp` archive URL used by `install-graftcp`. |
| `COAUTO_REMOTE_PROXY` | HTTP proxy used for proxy-aware `--remote`, for example `http://10.21.11.21:8888`. |
| `COAUTO_REMOTE_PROXY_MODE` | Set to `off` to disable automatic `graftcp` wrapping even when proxy variables are present. |
| `COAUTO_REMOTE_MODE` | Set to `ssh` to disable the default Cloudflare Quick Tunnel link and print SSH tunnel instructions instead. |
| `COAUTO_REMOTE_TARGET` | Override the SSH target printed by the SSH fallback path, for example `yihong@login.example.edu`. |
| `COAUTO_REMOTE_AUTH_TOKEN` | Optional fixed remote access key; must contain at least 32 characters. If unset, `--remote` generates one for that process. |
| `COAUTO_ALLOWED_HOSTS` | Comma-separated Host allowlist for an authenticated reverse-proxy deployment. |
| `COAUTO_ALLOWED_ORIGINS` | Comma-separated browser Origin allowlist for state-changing requests through a reverse proxy. |
