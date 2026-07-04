# Conversion Protocol

## Purpose

Use this protocol to convert raw materials into the canonical project state.

Raw materials may include old repositories, ongoing work, proposals, notes, literature, datasets, seed papers, or a short user brief.

Conversion does not fetch new external resources, but it MUST inventory,
migrate, and activate everything the user already provided. It reinterprets
filed raw materials into canonical project state. Conversion does not mean
trusting old work; it means inspecting it, extracting what is useful, and
recording what is current, tentative, deprecated, or unknown.

Before conversion, run `instructions/RESOURCE_INTAKE.md` unless the relevant materials are already filed in `resources/` and listed in `resources/user_input/RESOURCE_MANIFEST.md`. Filed and listed is not enough for conversion claims: before deriving canonical state from a user-provided resource, complete the Content Inspection Gate in `instructions/RESOURCE_INTAKE.md`.

---

## When To Run Conversion

Run conversion only when canonical project state needs to be built or reinterpreted, such as:

- newly filed resources materially affect `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, or manuscript direction;
- a formal human intervention changes the research goal, method, target venue, claim, priority, or resource use;
- a plan-level correction makes the active plan or current project framing invalid;
- an imported or newly created project does not yet have coherent `PROJECT.md`, `STATE.md`, and `CURRENT_FINDINGS.md`.

### Mandatory Conversion Trigger

If `resources/ongoing_work/` contains research-bearing content, including via a
symlink, a full `research_trajectory/trials/000000_project_conversion/` trial is
required before any normal trial in both cold starts and restarts.
Research-bearing content includes code, datasets, model checkpoints, generated
results, metrics, manuscript sources, notebooks, configuration files, or prior
reports. Restart intake does not satisfy this trigger.

Do not run conversion for ordinary progress questions, simple continuation of the current plan, small attachments that do not affect project definition, documentation or UI edits, or a normal next trial inside an already coherent project.

---

## Inputs

Possible inputs:

- `resources/user_input/INITIAL_BRIEF.md`
- `resources/user_input/NOTES.md`
- `resources/ongoing_work/`
- `resources/proposals/`
- `resources/literature/`
- `resources/data_sources/`
- `resources/target_venue/`

These are raw materials. They are not current truth until reflected in `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, or a trial report.

Also inspect `resources/user_input/RESOURCE_MANIFEST.md` before conversion. Resolve, defer, or explicitly record any unresolved or ambiguous resource entries that affect project state. Reading the manifest is path-level intake only; it does not substitute for reading the content-bearing files of the provided resources.

When converting an ongoing-work bundle, verify that `instructions/RESOURCE_INTAKE.md` has surfaced embedded bibliographies, literature, venue materials, and data-source artifacts into the appropriate `resources/` subfolders. If the embedded scan has not happened, do it before deriving canonical state. Conversion must inspect the bundle's human-authored and research-bearing content files before using the bundle for project framing, evidence, methods, results, or manuscript direction. Later evidence, venue, and manuscript steps should not depend on rediscovering hidden files inside `ongoing_work/`.

Do not interpret an empty `resources/target_venue/papers/` folder as proof that no literature exists. It only means no local selected target-venue seed-paper copies are stored there. General manuscript references from ongoing work belong in `resources/literature/` unless deliberately selected as seed papers.

---

## Outputs

Conversion should produce or update:

- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- `research_trajectory/trials/000000_project_conversion/PLAN.md`
- `research_trajectory/trials/000000_project_conversion/reviews/`
- `research_trajectory/trials/000000_project_conversion/REPORT.md`
- `manuscript/BLUEPRINT.md`, if enough information exists

---

## Conversion Trial

Conversion itself is a trial:

`research_trajectory/trials/000000_project_conversion/`

The conversion `REPORT.md` should explain:

- what raw materials were inspected;
- what the prior or proposed project was trying to do;
- what should be reused;
- what should not be trusted;
- what useful working artifacts should be migrated into `workspace/`;
- which large data, checkpoints, and result folders remain in place as active
  resources with exact paths;
- how the Critical Path was seeded from existing versus missing materials;
- how `PROJECT.md` was derived;
- how `STATE.md` was initialized;
- whether any findings are already active, tentative, superseded, or rejected;
- what the next trial should be.

---

## Handling Existing Repositories

Do not treat an old repo as automatically current, and do not leave it as
passive context when it contains research-bearing materials.

Required checklist:

1. Keep the original snapshot under `resources/ongoing_work/`.
2. Complete a full inventory with content-inspection status. Distinguish files
   inspected, skipped, unreadable, too large, or irrelevant.
3. Migrate runnable code, configs, notebooks, evaluation harnesses, prototypes,
   and derived working data that future trials should modify into `workspace/`.
4. Register large data, checkpoints, raw result trees, and prior output folders
   in place as active resources in `STATE.md` with exact paths, rather than
   copying them blindly.
5. Convert every prior quantitative result into a tentative finding in
   `research_trajectory/CURRENT_FINDINGS.md` with `prior work, unverified`
   provenance. Do not silently drop prior results, and do not silently accept
   them as current truth.
6. Seed `STATE.md` `## Critical Path` from what already exists versus what is
   missing for real results, figures, tables, references, and the deliverable.
7. Record explicit `not migrated because ...` entries for anything skipped.
8. Record accepted/tentative/rejected findings only when evidence supports that
   status.

---

## User Intent

If the user provides a short natural-language input, preserve it in:

`resources/user_input/INITIAL_BRIEF.md`

Then convert it into a structured project definition in:

`PROJECT.md`

Do not overwrite raw user input unless explicitly asked.

---

## Consistency Requirements

After conversion, check that:

- `PROJECT.md` contains the canonical goal, scope, target venue/audience, and contribution expectation;
- `STATE.md` contains the current action state, not raw findings;
- `CURRENT_FINDINGS.md` contains current knowledge state, not raw logs;
- trial artifacts or workspace paths are cited from `REPORT.md` when used as evidence;
- manuscript files only contain manuscript-facing synthesis, not raw exploratory outputs.
