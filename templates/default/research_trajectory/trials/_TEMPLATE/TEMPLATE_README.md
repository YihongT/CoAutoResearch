# V2 Trial Artifact Template Directory

These files are contract examples, not copy-without-edit templates.

- `*.example.json` are schema-valid examples for parser and scaffolder development.
- `*.md.tpl` are human-readable rendering skeletons.
- Runtime scaffolding must generate JSON with real identifiers, timestamps, paths, hashes, and revision values, validate it against `schemas/`, then generate or consistency-check Markdown.
- Agent-authored artifacts must never self-assign accepted canonical status.
- `MERGE_DECISION`, `PUBLISH_RECEIPT`, and the published `GOAL_GATE` are service-owned.
- Any staged bundle modification changes the stage hash and invalidates stale post-stage reviews.
