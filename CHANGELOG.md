# Changelog

## 2.0.1 — Unreleased

### Fixes

- Preserve conversation history and edit drafts when a resend is rejected; update
  history only after the service accepts the request.
- Keep activity events and elapsed times attached to the correct run, including
  the accessible label shown immediately after sending a message.
- Check whether a project can accept a run before importing attachments, and
  preserve drafts when the project is busy.
- Copy local material folders into bounded, independent snapshots; reject nested
  links, junctions, special files and recursive copies. Migrate legacy external
  folder links through the dashboard template update with per-folder rollback.
- Avoid optional Git index refreshes during read-only agent inspection, and stop
  treating ordinary empty-directory cleanup as an unauthorized plan file change.
- Keep external URL evidence bound to its JSON record without requiring a local
  file; retain path and hash validation for local evidence.
- Recognize labeled references and populated inline manuscript tables. Correct
  false readiness warnings for supported paragraph plans and field names while
  continuing to reject missing evidence and unfinished artifacts.
- Separate table titles from lowercase metadata and label replacement findings
  as superseding earlier results rather than being superseded themselves.
- Use UTF-8 for agent text streams and paper files, and portable relative paths
  for paper snapshots and source archives.
- Improve recoverable error visibility and distinguish rejected research briefs
  from successfully saved ones.

### Recovery guidance

- Point repair runs to retained reviews and candidate material, encourage batched
  reads and incremental edits, and preserve successful computation evidence.
  New plan approval and exact-stage review remain required.

### Upgrade and validation scope

- Stop at a safe point before updating. In each existing project, choose
  **Project options → Update project template** before starting another run.
  Legacy external material folders become independent copies; later edits to
  their source folders are not automatically reflected in the project.
- The fixes were exercised in macOS Chrome with Codex/Luna. Additional checks
  covered non-UTF-8 environments and Windows-style path serialization, not native
  Windows or Linux execution. API fields, protocol versions and review standards
  are unchanged.
- This patch does not claim to eliminate model/provider delays or guarantee
  generated-paper correctness. Browser-policy-blocked downloads and retention of
  an older ready PDF during regeneration were not fully validated in this pass.

## 2.0.0 — 2026-09-11

### Reliability and example papers

- Added bounded recovery for verified execution-directory placement errors within
  the same Trial, preserving evidence and computation budgets before fresh review.
- Preserved receipt-backed historical references and separated current repair
  diagnostics from human guidance when research resumes.
- Generated migration candidates from validated JSON while preserving original
  historical files and enforcing publication checks.
- Reduced initial project and settings loading work and improved retained-run,
  queued-message, and recovery controls.
- Strengthened paper figure-overlap checks, focused revisions, claim-scope review,
  and portable source exports without rerunning frozen experiments.
- Added two reviewed example-paper layouts from developer-operated Digits and
  Ising projects, with explicit scientific limitations. Their PDFs and previews
  are included in the documentation repository and excluded from the npm package.

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
