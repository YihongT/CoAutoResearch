# Changelog

## 2.0.0 — Unreleased

### Research experience and documentation

- Unified research-session, research-guidance, pause and evidence terminology.
- Reworked the README around human direction, autonomous research and a shared evidence record.
- Added one-instruction setup guidance and an in-product manuscript-to-paper workflow.
- Updated theme-aware branding and accessible collaboration diagrams.
- Clarified edit/resend consequences, review revisions, first-run guidance and paper prerequisites.
- Fixed double-escaped inline code and link text in Markdown previews.
- Corrected paused-session loading labels, stale trial panels during project switches, narrow-screen activity labels and paper error contrast.
- Clarified retained resume guidance and preserved communication language across autonomous phases.
- Prevented first-launch intake from overwriting the Markdown paired with authoritative venue JSON.
- Added portable UTC timestamp guidance for agent runs on macOS.
- Strengthened research framing guidance to preserve explicit prerequisites and pending human authorization across Start and Resume.
- Documented copy-based project virtual environments to avoid external interpreter links rejected by the existing write guard.
- Corrected interrupted-trial status precedence after stopping a run and clarified file-write-check failures without replacing the diagnostic details.
- Made installation checks distinguish an optional user project from required runtime files, and standardized paper-generation progress messages in English.
- Cleared archived auxiliary sessions from memory and refreshed the chat list after a full Restart.
- Prevented rejected research framing from appearing saved or offering a ready Start action, and clarified project-identity binding during framing.
- Replaced image-based paper previews and custom page/zoom controls with the browser’s native PDF reader, including existing papers.

### Collaboration and paper generation

- Added parallel read-only discussion chats and suggestions prepared in the main research draft.
- Improved live activity, pause/resume controls, narrow-screen navigation, and
  shared running indicators.
- Added paper generation from recorded evidence using four pinned scientific
  skills, local figures and PDF compilation, cancellation, and retry.
- Added a separate Paper view with continuous previews and PDF/source downloads.
- Default new Codex paper runs to GPT-5.6-Luna with High reasoning when available;
  writing and automatic repair share a three-hour execution budget.

### Protocol and Research Board

- Added the typed v2.0 trial lifecycle: bounded proposal, protected staging,
  material-bound review routing, service-derived merge and goal-gate truth,
  recoverable canonical transaction, and immutable publish receipt.
- Added a receipt-backed Research Board with explicit proposed, qualified,
  limiting, negative, legacy, and published states, plus transaction-recovery
  diagnostics and typed trial detail endpoints.
- Kept one sequential trial per invocation; concurrent trial batches remain a
  documented v2.1 extension.

### Migration

- Added backup-first, add-only v1-to-v2 migration with classification,
  idempotence, crash recovery, exact before-hash verification, explicit
  rollback, and preserved v1 trials, reviews, resources, and Markdown history.
- Added fail-closed handling for corrupt, future-version, active-run, and newer
  canonical states.

### Compatibility

- Extended `/api/overview` additively and retained the existing research,
  session, event, and file endpoints.
- Added a labeled read-only legacy projection and fixed-eight reviewer fallback
  for v1 projects without claiming v2 publication.
- Retained Codex and Claude Code adapters. The supported runtime floor is now
  Node.js 20 and Python 3.10.

### Deployment profile and security

- Defined the v2.0 deployment profile as local-first, one trusted human, one
  project per UI server process, and one active trial at a time.
- Kept loopback binding as the default and added access-key authentication,
  host/origin checks, cross-site mutation rejection, no-store responses,
  sensitive-path denial, trace/log redaction, and external write-guard recovery.

### Non-goals

- V2.0 does not claim public unauthenticated hosting, multi-user or multi-tenant
  isolation, shared untrusted accounts, parallel multi-trial execution, or
  automatic specialized domain packs beyond `general_research`.
- Quick Tunnels remain temporary personal access. Sustained remote production
  use requires an authenticated network boundary operated by the user.

## 0.1.2

- Changed `co-auto-research ui --remote` to use the official `cloudflared` CLI
  for a temporary Cloudflare browser link.
- Added `co-auto-research install-cloudflared` for no-sudo Linux setup into the
  user directory used automatically by `--remote`.
- Added proxy-aware `--remote` support through `graftcp`, plus
  `co-auto-research install-graftcp` for Linux servers that reach the internet
  through an HTTP proxy.
- Added first-class Settings providers for Codex OpenAI API keys and Claude
  Anthropic API keys, with backend-scoped secret injection.
- Fixed Claude Code `/goal` handling so Claude backend commands follow Claude
  Code native goal semantics.
- Passed Claude `/goal` clear aliases through correctly: `clear`, `stop`,
  `off`, `reset`, `none`, and `cancel`.
- Kept Codex autoresearch loop controls separate from Claude Code native goal
  commands.

## 0.1.1

- Changed the default dashboard project folder from `local-projects/` to
  `co-autoresearch-projects/`.
- Kept legacy `local-projects/` discovery for existing local dashboards.

## 0.1.0

- Initial CoAutoResearch project structure.
- Added immutable `templates/default/` project template.
- Added `co-auto-research` CLI skeleton with `init`, `ui`, `doctor`, and
  advisory `upgrade` commands.
- Added `co-auto-research ls` and `co-auto-research attach` for returning to
  existing generated projects.
- Added `co-auto-research ui --remote` hints for SSH-tunneled browser access on
  remote servers.
- Reworked public docs with a product-docs layout, sidebar navigation, and
  Mermaid rendering.
- Added remote-server, upgrading, security, and platform docs.
