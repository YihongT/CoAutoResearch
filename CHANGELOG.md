# Changelog

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
