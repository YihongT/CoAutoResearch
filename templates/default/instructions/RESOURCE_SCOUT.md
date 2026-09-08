# Resource Scout Protocol

> **V2 control-plane override.** Resource Scout is preflight or a dedicated resource-acquisition move, not a reviewer. It writes under the current trial artifacts and permitted raw-resource destinations. It never edits canonical findings/lines/campaigns directly. The plan declares whether Scout is required; a material scout result increments plan revision and requires a new Plan Review.

In v2 agent execution, the permitted raw-resource destination is
`resources/autoresearch_discovered/<trial_id>`. Record discovery provenance in
the current trial's stage/revision-scoped `RESOURCE_SCOUT_MANIFEST.json` and
`RESOURCE_SCOUT_REPORT.md`. Those two trial artifacts are the authoritative v2
registration. `resources/user_input/RESOURCE_MANIFEST.md` is service-managed
intake state because Restart behavior depends on its user-provenance fields; a
v2 agent must read it when relevant but must never modify it. Do not write
promoted resource destinations directly from the v2 agent process.

V2 `PLAN.resource_scout.expected_destinations` must name the exact Scout
subdirectory or files under the current trial's `artifacts/resource_scout/`,
plus any raw material under `resources/autoresearch_discovered/<trial_id>`.
Use a stage/revision-specific Scout subdirectory, for example
`artifacts/resource_scout/<stage_id>/plan-r<plan_revision>/`; do not declare
the entire Scout root, `workspace`, or general resource roots as destinations.
Both the report and manifest must exist before a required Scout can pass
preflight. Plan Review must list every file in those destinations in its
`reviewed_inputs`; unrelated workspace scaffolds are not Scout evidence.


## Purpose

The Resource Scout is a research-resource subagent for finding, filing, and
summarizing resources before main execution. It serves the overall research goal
first and the current trial objective second, so scout work should be grounded
in `PROJECT.md`, current state/findings, and the active trial plan.

It discovers materials that may help this research and this trial, records
provenance, and saves small public artifacts under `resources/`. It does not
decide project truth, promote findings, rewrite canonical state, or replace any
of the eight core reviewers.

## When To Use

Every trial `PLAN.md` must include a `Resource Scout Brief`.

Default:

`Scout: required`

Require a scout when any of these are true:

- the trial may change project framing, research question, claim, method,
  dataset, literature base, benchmark, venue fit, or manuscript evidence;
- the current state depends on sources that may be incomplete, stale, weakly
  cited, or not yet externally grounded;
- the latest user message, project files, or manifest contains papers, data,
  reports, repositories, standards, news, websites, institutions, products,
  policies, or other resource clues;
- the trial needs evidence, examples, comparisons, baselines, target-venue
  expectations, standards, reproducibility materials, or external factual
  context;
- the project is entering a new domain, topic, subquestion, method, data source,
  or evaluation frame;
- the trial uses or interprets external facts that could have changed;
- there is material uncertainty about what resources exist.

Skipping is allowed only when the trial is purely local work over already
verified resources, explicitly offline, or when no external source could
plausibly affect the objective. A skipped scout requires a concrete `Skip
reason:` in `PLAN.md`.

Do not skip merely because the agent thinks it already knows the area, the trial
is small, search may take time, the needed resource type is unclear, or current
resources look probably sufficient.

In v2, when the plan says `Scout: required`, complete Resource Scout after
drafting the Plan and before the final passing Plan Review, within the service's
plan/preflight phase. Do not defer it until execution: service approval freezes
the reviewed Plan and Scout material. If Scout changes material assumptions,
revise the paired Plan and obtain a fresh review of those exact outputs.

In legacy v1, run Resource Scout after `PLAN.md` and
`reviews/PLAN_REVIEW.md`, before main execution. In both versions, the main
execution agent follows this explicit action:

`spawn a Resource Scout subagent to search, file, and report potentially relevant resources for the overall research goal and current trial, including files, papers, datasets, reports, news, and other external resources via web search or appropriate external sources`

If the search scope is too broad for one focused scout, the plan may split the
brief into multiple scoped Resource Scout subagents. Each scout must still write
or contribute to the same trial resource-scout report and manifest update.

If the scout materially changes assumptions, required resources, risks, or
success criteria, the main execution agent must revise `PLAN.md` and rerun the
Plan reviewer before execution.

Prefer a real Resource Scout subagent when the runtime supports it. If subagent
orchestration is unavailable, stalls, or fails, complete the same scout work
inline as a clearly labeled `Resource Scout fallback`, write the scout report /
manifest updates / resource files, disclose the fallback in `REPORT.md`, and
continue. Do not set the gate to `blocked` or `needs_human` solely because
Resource Scout subagent orchestration failed. `blocked` and `needs_human` are
whole-loop hard stops, not scout-local outcomes.

Wait for a delegated Scout at most once. If that wait returns without a
completed result, classify the delegation as stalled immediately, emit the
`fallback` progress line, and complete the work inline; never enter a repeated
subagent-wait loop.

If human input would help but the main agent can still continue with metadata,
alternate public sources, a follow-up retrieval trial, manuscript cleanup, or
evidence/state work, include a `Human Task Candidates` entry in the scout report
for the main execution agent to merge. Do not edit
`research_trajectory/HUMAN_TASKS.md` directly.

## Visible Progress Line

The main execution agent must emit this exact visible status format for scout
work:

```text
Subagent update: Resource Scout | status: <starting | waiting | completed | fallback> | task: <short task> | output: <path or none>
```

Use the actual stage/revision-scoped report path in v2. In legacy v1 use
`output: research_trajectory/trials/<trial_id>/artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`
when the report path is known.

## Required Inputs

The scout reads only what is needed for the overall research goal and current
trial:

- `AGENTS.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- current trial `PLAN.md`
- current trial `reviews/PLAN_REVIEW.md`, when a prior or preliminary review exists
- `instructions/RESOURCE_INTAKE.md`
- this file
- existing `resources/user_input/RESOURCE_MANIFEST.md`, when present
- relevant existing files under `resources/`

When the scout uses existing user-provided resources as search clues or
summarizes their content, it must obey the Content Inspection Gate in
`instructions/RESOURCE_INTAKE.md`. A manifest entry, symlink listing, filename,
or short user description is only path-level context.

## Required PLAN Brief

Each trial plan must include:

```markdown
## Resource Scout Brief
Scout: required | skipped
Criticality: research-critical | contextual
Decision reason:
Skip reason:
Search scope:
Resource types:
Disciplines/domains:
Known resource clues:
Freshness / date sensitivity:
Download policy:
Expected destinations:
Stop criteria:
```

Every `Expected destinations` entry is a canonical project-relative path. A
directory entry names the directory without a trailing `/`; schema-valid paths
and the runtime path normalizer use the same no-trailing-slash contract.

Use short, concrete entries. `Decision reason:` must explain why the scout is
required or skipped for the overall research goal and current trial. `Scout:
skipped` is invalid unless `Skip reason:` explains why web/resource search would
not help this trial.

## Search Taxonomy

Search according to the overall research target, current state/findings, and
trial objective. Common resource types include files, papers, surveys, datasets,
benchmarks, code repositories, reports, news, standards, policies, venue
materials, model cards, evaluation artifacts, leaderboards, and reproducibility
materials.

Use web search, official websites, scholarly indexes, dataset portals, standards
or policy repositories, public code hosts, venue pages, and existing resource
clues as appropriate for the project domain and trial need.

Default domain cues:

- ML/AI: papers, surveys, Papers-with-Code-style artifacts, benchmarks, model
  cards, leaderboards, evaluation reports, reproducibility repositories.
- Biomedical: PubMed or preprint papers, clinical guidelines, trial registry
  entries, GEO/SRA-style datasets, reporting checklists.
- Social science: survey instruments, codebooks, OSF materials, census and
  statistical agency datasets, replication packages.
- Economics/policy: working papers, government data, OECD/World Bank/IMF data,
  policy reports, regulatory filings, evaluation reports.
- Robotics/vision/NLP: datasets, simulation assets, benchmark definitions,
  leaderboards, annotation guidelines, reproducibility repositories.
- Climate/geo: NOAA/NASA/IPCC-style reports, GIS layers, satellite products,
  reanalysis datasets, data portals.
- Security/safety/privacy: incident databases, standards, governance reports,
  advisories, vulnerability databases, audit reports.
- Industry/product domains: technical reports, filings, whitepapers, public
  incident/news sources, documentation, changelogs.

Expand this taxonomy when the project domain calls for discipline-specific
sources not listed here.

## Saving Policy

Use `resources/` for raw inputs. In v2, Scout-discovered resources must be
recorded as `autoresearch_discovered` in the current trial's
stage/revision-scoped `RESOURCE_SCOUT_MANIFEST.json` and human-readable report;
never modify `resources/user_input/RESOURCE_MANIFEST.md`. In legacy v1, retain
the existing behavior of recording discoveries in that user-input manifest.
Scout discoveries are not current truth until a reviewed trial promotes their
research meaning into canonical state, manuscript files, or a trial report.

Default handling:

- Open-access PDFs and small public artifacts: download or save into the
  appropriate `resources/` folder when legally and practically available.
- Paywalled or restricted materials: save metadata, DOI/link, access note, and
  summary only.
- News, reports, and articles: save URL, title, publisher, date, short summary,
  and only a minimal compliant excerpt when needed.
- Contextual large datasets, checkpoints, and repositories: save link, license,
  size, access instructions, and summary by default. Download only when the
  current trial explicitly needs a local copy and resource constraints permit it.
- Research-critical resources: follow the Research-Critical Acquisition Mandate
  below. Link-only is forbidden unless the ladder reaches a documented terminal
  verdict.

Never write secrets into tracked files. Do not bypass access controls. Respect
license, terms, robots, and privacy constraints.

## Destination Defaults

In v2, downloaded or copied Scout material goes only under
`resources/autoresearch_discovered/<trial_id>`. Record the intended promoted
category in the Scout manifest; do not write the category destinations below
directly. The legacy v1 defaults are:

- `resources/literature/`: papers, surveys, bibliographies, literature notes.
- `resources/data_sources/`: datasets, benchmark definitions, data-access
  notes, licenses, codebooks.
- `resources/target_venue/`: CFPs, author guidelines, venue seed papers, style
  notes, figure/table notes.
- `resources/ongoing_work/`: relevant public repositories or prior-work links
  when they are raw research inputs.
- `resources/other/`: mixed or unclear resources.

Contextual large or restricted resources may be link-only entries in the
manifest. Research-critical resources need an acquisition decision record.

## Research-Critical Acquisition Mandate

`Criticality: research-critical` means a `STATE.md` Critical Path item depends
on the resource. That Critical Path link is the explicit trial need for the
acquisition mandate below. A research-critical public dataset, code release,
benchmark, model, or source file must be acquired, activated from existing
user-provided materials, substituted within the research objective, or end in a
documented terminal verdict. Link-only is not a terminal verdict for this class.

Run this ordered substitution ladder and record every rung's attempt and
outcome:

1. Check `resources/ongoing_work/` and `workspace/` for user data, code,
   checkpoints, prior results, derived data, or manuscript sources already in
   hand.
2. Check local caches and prior downloads in the project tree.
3. Try the official public download. Within this rung, follow the full Download
   Integrity And Fallback Ladder below.
4. Try an alternate year or version from the same official source when it still
   answers the research objective.
5. Try an alternate public dataset that answers the research question, and state
   any fidelity loss.
6. If the only remaining path changes the objective, core claims, population,
   period, dataset vintage beyond an in-objective substitution, venue, or
   deliverable, write a scope-downgrade proposal using
   `instructions/PROJECT_FRAMING.md`.
7. Use `Status: needs_human` with a concrete `Response to human:` naming the
   exact file, URL, credential, permission, or decision required, plus what was
   tried.

Rungs 1-5 must complete within two trials of a resource becoming
research-critical. After that, a terminal verdict is mandatory:
`acquired`, `substituted:<what>`, `scope_downgrade_proposed`, or
`human_required`.

A failed rung still counts as empirical progress when the trial writes the
`ACQUISITION_DECISION.md` with the rung attempted, evidence inspected, outcome,
and next rung or terminal verdict. Empty searching, link collection, or
unexamined blocker recording does not count.

For each research-critical resource, write `ACQUISITION_DECISION.md` beside
the scoped Scout report in v2. The legacy v1 path is:

`research_trajectory/trials/<trial_id>/artifacts/resource_scout/ACQUISITION_DECISION.md`

Use this structure:

```markdown
# Acquisition Decision

Resource:
Critical path item:
Criticality: research-critical
Decision date:

## Ladder Attempts
| Rung | Attempt | Evidence / artifact | Outcome |
|---|---|---|---|
| 1 | <ongoing_work/workspace check> | <path or none> | <outcome> |

## Terminal Verdict
Verdict: acquired | substituted:<what> | scope_downgrade_proposed | human_required
Evidence / artifact:
Next action:
Response to human:
```

Mirror terminal verdicts in `research_trajectory/STATE.md`.

## Download Integrity And Fallback Ladder

When a trial needs the actual body of an external file, do not treat a completed
HTTP request as a completed download. After every download attempt, verify the
artifact before using it or marking it downloaded:

- record URL, tool, proxy/profile used, HTTP status, content type, byte size,
  and sha256 when available;
- reject HTML/XML/text error pages saved with a data extension;
- for ZIP files, verify magic bytes and run an archive listing/test before
  extracting;
- for CSV/TSV/text files, inspect the header and first rows;
- compare expected size, checksum, filename, or documented row/file counts when
  the source provides them.

If verification fails for a public resource, run this fallback ladder before
asking the user for help:

1. retry with safe downloader variants such as `curl`, `wget`, and Python
   stdlib, following redirects and using a normal browser-like user agent;
2. try available network profiles already configured for the environment
   (for example sourced proxy setup scripts, proxy env vars, and direct mode);
3. inspect response headers/body snippets to distinguish 403/404/rate-limit
   pages from real data;
4. try official alternate links from the same source, parent directory, catalog
   page, or documented mirror;
5. search the project tree, `resources/`, trial artifacts, workspace caches,
   and obvious local download/cache locations for an existing copy, then verify
   it with the same checks;
6. if the file is large, restricted, or still inaccessible, save a link-only
   manifest entry plus an access-failure report instead of pretending it was
   downloaded.

Quarantine bad downloads under the trial artifacts with a clear suffix such as
`.bad-download.html` or `.bad-download.txt`; never leave a verified-false HTML
error page at the final `.zip`, `.csv`, `.pdf`, or dataset path. Do not set the
gate to `blocked` or `needs_human` for a public download until this ladder is
exhausted and recorded. For contextual resources, if useful work can continue
with metadata, alternate sources, or a follow-up retrieval trial, set
`Status: continue`. For research-critical resources, proceed to the next rung of
the Research-Critical Acquisition Mandate and record the verdict.

## Required Outputs

In v2, write `RESOURCE_SCOUT_REPORT.md` and `RESOURCE_SCOUT_MANIFEST.json`
together in the stage/revision-specific subdirectory declared in the Plan,
under `research_trajectory/trials/<trial_id>/artifacts/resource_scout/`.
For every research-critical resource, write `ACQUISITION_DECISION.md` there too.

In legacy v1, write a scout report at:

`research_trajectory/trials/<trial_id>/artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`

For every legacy v1 research-critical resource, also write:

`research_trajectory/trials/<trial_id>/artifacts/resource_scout/ACQUISITION_DECISION.md`

The v2 manifest must register every discovered primary and alternate resource with
`autoresearch_discovered` provenance, stable locator, access date, trial/stage
and report binding, link-only/downloaded disposition, access/license note,
resource type/domain, relevance, and local or intended destination. Do not
update `resources/user_input/RESOURCE_MANIFEST.md` in v2.

Legacy v1 Scout runs continue to update
`resources/user_input/RESOURCE_MANIFEST.md`.

Save v2 downloaded or copied artifacts under
`resources/autoresearch_discovered/<trial_id>`; use the legacy destination
defaults only for v1.

Report any non-blocking user request under `Human Task Candidates` for the main
execution agent to merge into `research_trajectory/HUMAN_TASKS.md`.

## Scout Report Format

Use this structure:

```markdown
# Resource Scout Report

## Scope
- Trial:
- Objective:
- Scout brief:
- Criticality:
- Search date:

## Queries And Sources
- Query/source:
- Rationale:
- Result count reviewed:

## Saved Resources
| Resource | Type | Source | Local path or link | Provenance | License/access | Relevance |
|---|---|---|---|---|---|---|

## Link-Only Resources
| Resource | Type | Source | Reason not downloaded | Access instructions | Relevance |
|---|---|---|---|---|---|

## Discipline-Specific Coverage
- Covered:
- Gaps:

## Candidate Implications
- Potential assumptions affected:
- Potential evidence or method implications:
- Potential venue/manuscript implications:

## Stop Criteria
- Criteria from PLAN:
- Met:
- Residual gaps:

## Download Integrity / Access Failures
| Resource | Attempts | Verification result | Fallbacks tried | Final status | Next step |
|---|---|---|---|---|---|

## Acquisition Decisions
| Resource | Critical path item | Ladder rung reached | Terminal verdict | Decision artifact |
|---|---|---|---|---|

## Human Task Candidates
- <none, or Priority; Blocks; Question/request; Why needed; Continue meanwhile; Source>
```

Candidate implications are leads for the main execution agent. They are not
accepted findings.

## Boundaries

The scout must not:

- edit `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, or manuscript files;
- mark claims as accepted, tentative, or rejected;
- write any core reviewer file;
- decide the final gate;
- edit `research_trajectory/HUMAN_TASKS.md` directly;
- start unrelated broad literature review beyond the trial scope;
- download large/restricted assets without an explicit trial need. A current
  `Criticality: research-critical` resource tied to a Critical Path item is such
  a need, but license, disk, credential, and safety checks still apply.

The main execution agent decides whether scout-discovered resources affect
current state, findings, manuscript structure, references, or future plans.


## V2 Machine Output

When Scout runs, write a machine-readable report under the current trial artifacts with: decision, queries/inspection performed, acquired and rejected resources, provenance, license/access notes, local paths, integrity checks, substitution-ladder position, planning impact, and human-task candidates. A human-readable `RESOURCE_SCOUT_REPORT.md` must agree with the JSON.
