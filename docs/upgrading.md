# Upgrading

CoAutoResearch v2.0 separates the installed package from project data. Updating
the npm package changes the CLI and package-managed server; migrating a project
is a separate, explicit, backup-first operation.

Update the installed CLI and package-managed UI runtime with npm:

```bash
npm install -g co-auto-research@latest
```

Check the installed version:

```bash
co-auto-research version
```

Each generated project includes:

```text
.co-auto-research-template/manifest.json
```

The manifest records the template version used to create the project.
`co-auto-research upgrade` reports the installed CLI version, the detected
project template version, and the npm update command.

Updating the npm package updates the CLI, dashboard, and default UI runtime used
by `co-auto-research ui` and `co-auto-research attach`. Existing project
research files are not rewritten automatically.

## Preview And Apply A Project Upgrade

Stop agent runs first, create and rehearse a manifest-verified project backup,
and preview the exact managed changes:

```bash
co-auto-research backup . --output ../backups/project-before-v2-upgrade
co-auto-research restore ../backups/project-before-v2-upgrade ../restore-rehearsal \
  --expected-manifest-sha256 <sha256-from-backup-output>
co-auto-research upgrade-project --dry-run
co-auto-research upgrade-project
```

The backup contains canonical state, trials, resources, manuscript, and runtime
configuration with raw credentials removed. Restore verifies all SHA-256 values
and requires a missing or empty destination, so the rehearsal cannot overwrite
the source project. Start the restored project once with `co-auto-research
attach ../restore-rehearsal`, inspect its Research Board, then remove the
rehearsal only after the upgrade has passed its canary period.
The rehearsal remains read-only until explicitly released with
`co-auto-research restore-acknowledge ../restore-rehearsal
--expected-manifest-sha256 <sha256> --operator <name>`.

For all projects in the default dashboard folder:

```bash
co-auto-research upgrade-project --all --projects-dir co-autoresearch-projects
```

The command classifies the project as legacy, v2, future, or corrupt before it
writes. It refuses unsafe or ambiguous states. Managed reviewer/instruction
bytes are backed up under `archive/template_migrations/`. The protocol migration
uses `archive/v2_migrations/<migration_id>/` for its manifest, exact before
snapshots, receipt, and `ROLLBACK.md`.

Migration is additive: it creates typed v2 state and metadata without deleting
v1 trials, Markdown research content, reviewer history, custom instructions, or
user-owned resources. Re-running a completed migration is idempotent. A v1
trial without a v2 review manifest remains available through the labeled
legacy fixed-eight reviewer fallback.

After migration, canonical JSON, merge decisions, goal gates, transactions, and
publish receipts are service-owned. Do not hand-edit them. The next agent run
proposes one bounded trial through staging and review; only a receipt-backed
transaction advances the canonical revision.

## Project-data Rollback

Project-data rollback is supported only before newer v2 canonical work depends
on the migrated state.

1. Stop the UI and every agent process for the project.
2. Copy the project or take a filesystem snapshot before rollback.
3. Confirm that no post-migration v2 trial, receipt, canonical revision, staging
   artifact, or transaction must be retained.
4. From the project directory, run:

   ```bash
   co-auto-research upgrade-project --rollback
   ```

5. The rollback verifies the committed migration's after-hashes, restores exact
   before bytes, removes only migration-created files, verifies the preserved v1
   hashes, and retains `archive/v2_migrations/<migration_id>/` as evidence.
6. Start the UI and confirm the project is classified as legacy, the original
   trials/reviews/resources remain readable, and no recovery diagnostic is open.

Rollback refuses an active project, an incomplete migration, changed migration
targets, or newer v2 canonical artifacts. Do not bypass that refusal by deleting
receipts or transaction files. Preserve the project and recover or export the
newer work first. If startup reports an interrupted migration, let deterministic
recovery complete before requesting explicit rollback.

`upgrade-project --rollback` covers the protocol migration. If you also need to
undo a managed instruction sync, restore the recorded files from the matching
`archive/template_migrations/` backup only while the project is stopped, then
run `co-auto-research doctor` and verify the instruction baseline. Custom files
outside the managed core set are never rollback targets.

## Legacy Deliverables After Upgrade

Older Critical Path, `PAPER_PLAN.md`, `BLUEPRINT.md`, Resource Scout, and
reviewer Markdown remain readable history. In v2.0, the executable bottleneck,
findings, line/campaign state, gate, and publication truth come from validated
typed artifacts; Markdown cannot override them. Existing manuscript content is
preserved and may be updated by a later reviewed trial.

The UI now gates the Paper-Writing Pack. If the blueprint is still a stub,
contains planned slots, lacks real result sources, or has blocking missing
evidence, export a Research Status Pack instead. The status pack is compatible
with legacy projects and is intentionally labeled as incomplete.

For the current v2 workflow, use **Manuscript → Generate paper** after reviewed
results have been recorded and project agents are idle. The product prepares
the evidence, runs its writing agent and offers a PDF for human review. Export
packs remain available for inspecting or carrying research material elsewhere;
they are not a prerequisite for in-product paper generation. See
[paper generation](paper-generation.md) for setup and readiness checks.
