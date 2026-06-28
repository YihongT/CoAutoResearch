# Resource Intake Protocol

## Purpose

Use this protocol to acquire and file raw materials before interpreting them as research truth.

Resource intake answers: what materials has the user provided or implied, where are they, where should they live under `resources/`, and what remains missing or ambiguous?

Resource intake does not decide the final project definition. Conversion and normal execution do that after the raw materials are filed or explicitly marked unavailable.

---

## When To Use

Use this protocol when the latest user message, UI payload, or project state mentions or implies:

- files, folders, paths, repositories, codebases, or ongoing work;
- papers, bibliographies, literature folders, reviews, or prior submissions;
- datasets, benchmarks, logs, model checkpoints, or data-source notes;
- proposals, grants, drafts, target venue materials, CFPs, or author guidelines;
- old experiments, existing results, or prior research artifacts.

Do not frame or revise `PROJECT.md` from a message that names prior work, a repo, dataset, papers, or files until resource intake is complete, blocked with a clear user question, or explicitly not needed. After intake, follow `instructions/PROJECT_FRAMING.md` to decide whether the material should update the canonical launch frame.

---

## Explicit UI Resources

Resources selected through the UI are authoritative raw inputs:

- uploaded or dragged files;
- local-browser selected files;
- local-browser selected folders.

Do not debate whether explicit UI resources are relevant before filing them. File them under `resources/`, record them in `resources/user_input/RESOURCE_MANIFEST.md`, then inspect only what is needed for the next step.

---

## Inferred Natural-Language Resources

Paths, repo names, paper titles, dataset names, or folder names mentioned only in text are resource clues, not permission to silently copy arbitrary material.

For each important clue:

1. Normalize the clue without destroying the original text.
2. Try likely exact paths first, including user home, project parent, mounted volumes, and platform-specific drive roots when appropriate.
3. If an exact path does not work, search by the final path component or named artifact when bounded and safe.
4. If exactly one plausible candidate exists, file it or ask for confirmation when the source is large, sensitive, or surprising.
5. If several candidates exist, record the ambiguity and ask the user to choose.
6. If no candidate exists, record the missing clue and ask for a path, upload, or transfer instruction when the resource is important.

Text-only resource clues must be recorded in `RESOURCE_MANIFEST.md` even when unresolved.

---

## Routing

Use these default destinations:

- existing repos, partial work, old experiments, or prior implementations: `resources/ongoing_work/`
- papers, bibliographies, `.bib`, `.ris`, literature notes, or reviews: `resources/literature/`
- datasets, benchmarks, logs, model checkpoints, or data-source notes: `resources/data_sources/`
- proposals, grants, prior submissions, reviewer comments, or drafts: `resources/proposals/`
- target venue notes, CFPs, author guidelines, seed papers, or style notes: `resources/target_venue/`
- raw briefs and user notes: `resources/user_input/`
- composer-uploaded files without a more specific classification: `resources/user_input/attachments/`
- unclear or mixed materials: `resources/other/`

If a filed resource later appears misclassified, move it only when that improves clarity and record the decision in `RESOURCE_MANIFEST.md` or the relevant trial report.

---

## Embedded Resource Scan

After filing a folder under `resources/ongoing_work/`, `resources/proposals/`, or `resources/other/`, do a bounded scan for nested resource-like materials before conversion, evidence review, venue review, or manuscript work.

Look for:

- `.bib`, `.ris`, `references*`, `bibliography*`, citation exports, literature notes, and research-source PDFs;
- author guidelines, CFPs, target-venue notes, style exemplars, or seed-paper folders;
- datasets, benchmark definitions, logs, model artifacts, or data-access notes.

Surface discovered materials into the corresponding resource area:

- general manuscript bibliographies and research-source literature go under `resources/literature/`;
- target-venue guidelines, style notes, seed-paper lists, and selected seed-paper local copies go under `resources/target_venue/`;
- dataset and benchmark materials go under `resources/data_sources/`.

Surfacing means creating a small copy, a relative symlink, or a pointer note in the destination folder and recording the source path in `RESOURCE_MANIFEST.md`. Do not move originals out of `ongoing_work/`; treat the filed bundle as the raw snapshot.

A general bibliography embedded in an ongoing manuscript is not automatically a target-venue seed-paper set. Put it in `resources/literature/` unless specific entries are deliberately selected as venue/style seed papers. Only put files in `resources/target_venue/papers/` when they are local copies of selected target-venue seed papers and are legally and practically available.

If no relevant embedded resources are found, record that the embedded scan was performed and found none.

---

## Resource Scout Discoveries

Resources discovered by `instructions/RESOURCE_SCOUT.md` are raw materials found
by an autoresearch run, not user-provided truth.

Record each scout-discovered material in
`resources/user_input/RESOURCE_MANIFEST.md` with provenance
`autoresearch_discovered`. Include:

- source URL, DOI, repository, registry id, or other stable locator;
- title/name, publisher or host, date/year, and access date when relevant;
- trial id and scout report path;
- local destination path, or link-only status with reason;
- resource type and discipline/domain;
- license or access constraints when known;
- short reason the scout considered it relevant;
- whether it is downloaded, link-only, restricted, large/deferred, or missing.

Scout-discovered materials remain raw inputs until the main execution agent
promotes them into `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, manuscript
files, or the current trial `REPORT.md`. A scout report may describe candidate
implications, but it must not convert those implications into accepted findings.

---

## Copy And Symlink Rules

- Small files should normally be copied.
- Folders should normally be symlinked when possible; copy only if symlinks fail or are inappropriate.
- Keep original repos and prior work read-only under `resources/`; migrate only selected working artifacts into `workspace/`, such as executable pieces, prototypes, configs, evaluation harnesses, design/system implementation materials, or derived data needed for future work.
- Do not copy `.git/`, `node_modules/`, virtual environments, caches, `__pycache__/`, build outputs, secrets, credentials, or large generated artifacts unless there is a specific reason.
- For large or restricted resources, record the external location and acquisition instructions instead of copying blindly.
- Never write real secrets into tracked files.

---

## Manifest Requirements

Maintain `resources/user_input/RESOURCE_MANIFEST.md` as a raw intake record. It should include:

- explicit UI resources and their categories;
- inferred resource references from user text;
- attached resources with source, destination, mode, and reason;
- resource provenance for each material when known:
  - `user_explicit`: selected, uploaded, pasted, dragged, or directly linked by the user;
  - `user_confirmed`: discovered or inferred by the system and then confirmed by the user as active input;
  - `autoresearch_discovered`: found by an autoresearch run without explicit user confirmation;
  - `autoresearch_generated`: created by an autoresearch run;
  - `unknown`: legacy or ambiguous provenance;
- embedded resources surfaced from filed bundles, including source bundle, destination, mode, and reason;
- unresolved or ambiguous resources;
- intake decisions, including why a clue was ignored or deferred.

Restart behavior depends on provenance: a full autoresearch restart keeps
`user_explicit` and `user_confirmed` materials available as active inputs, while
`autoresearch_discovered`, `autoresearch_generated`, and `unknown` materials
become archived prior-run context until the user explicitly reattaches or
confirms them.

The manifest is provenance and intake state. It is not current research truth until promoted into `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, or a trial report. Use `instructions/PROJECT_FRAMING.md` before promoting resource context into `PROJECT.md`.

---

## Completion Gate

Resource intake is complete only when every important resource clue is one of:

- attached and recorded;
- embedded-scan completed or explicitly deferred with a reason;
- explicitly unavailable and recorded;
- ambiguous, recorded, and paired with a user question;
- judged irrelevant or unnecessary, with a reason.

After resource intake, run conversion only if the filed materials or user corrections require canonical project state to be rebuilt or reinterpreted.
