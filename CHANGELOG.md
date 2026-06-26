# Changelog

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
