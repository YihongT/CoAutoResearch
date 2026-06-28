# Resource Scout Protocol

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

Every substantive trial `PLAN.md` must include a `Resource Scout Brief`.

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

Skipping is allowed only when the trial is narrow local-only work over already
verified resources, explicitly offline, or when no external source could
plausibly affect the objective. A skipped scout requires a concrete `Skip
reason:` in `PLAN.md`.

Do not skip merely because the agent thinks it already knows the area, the trial
is small, search may take time, the needed resource type is unclear, or current
resources look probably sufficient.

When the plan says `Scout: required`, the main execution agent must run the
Resource Scout after `PLAN.md` and `reviews/PLAN_REVIEW.md`, before main
execution, by following this explicit action:

`spawn a Resource Scout subagent to search, file, and report potentially relevant resources for the overall research goal and current trial, including files, papers, datasets, reports, news, and other external resources via web search or appropriate external sources`

If the search scope is too broad for one focused scout, the plan may split the
brief into multiple scoped Resource Scout subagents. Each scout must still write
or contribute to the same trial resource-scout report and manifest update.

If the scout materially changes assumptions, required resources, risks, or
success criteria, the main execution agent must revise `PLAN.md` and rerun the
Plan reviewer before execution.

If the runtime cannot spawn this required subagent, do not silently do the work
inline. Record the blocker in `REPORT.md`, skip final pass, and set the
autoresearch gate to `blocked` or `needs_human`.

## Required Inputs

The scout reads only what is needed for the overall research goal and current
trial:

- `AGENTS.md`
- `PROJECT.md`
- `research_trajectory/STATE.md`
- `research_trajectory/CURRENT_FINDINGS.md`
- current trial `PLAN.md`
- current trial `reviews/PLAN_REVIEW.md`
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

Use `resources/` for raw inputs. Scout-discovered resources must be recorded as
`autoresearch_discovered` in `resources/user_input/RESOURCE_MANIFEST.md`; they
are not current truth until the main execution agent promotes them into
`STATE.md`, `CURRENT_FINDINGS.md`, `PROJECT.md`, manuscript files, or a trial
report.

Default handling:

- Open-access PDFs and small public artifacts: download or save into the
  appropriate `resources/` folder when legally and practically available.
- Paywalled or restricted materials: save metadata, DOI/link, access note, and
  summary only.
- News, reports, and articles: save URL, title, publisher, date, short summary,
  and only a minimal compliant excerpt when needed.
- Large datasets, checkpoints, and repositories: save link, license, size,
  access instructions, and summary by default. Download only when the current
  trial explicitly needs a local copy and resource constraints permit it.

Never write secrets into tracked files. Do not bypass access controls. Respect
license, terms, robots, and privacy constraints.

## Destination Defaults

- `resources/literature/`: papers, surveys, bibliographies, literature notes.
- `resources/data_sources/`: datasets, benchmark definitions, data-access
  notes, licenses, codebooks.
- `resources/target_venue/`: CFPs, author guidelines, venue seed papers, style
  notes, figure/table notes.
- `resources/ongoing_work/`: relevant public repositories or prior-work links
  when they are raw research inputs.
- `resources/other/`: mixed or unclear resources.

Large or restricted resources may be link-only entries in the manifest.

## Required Outputs

Write a scout report at:

`research_trajectory/trials/<trial_id>/artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md`

Update:

`resources/user_input/RESOURCE_MANIFEST.md`

Save downloaded or copied artifacts under the appropriate `resources/` folder.

## Scout Report Format

Use this structure:

```markdown
# Resource Scout Report

## Scope
- Trial:
- Objective:
- Scout brief:
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
```

Candidate implications are leads for the main execution agent. They are not
accepted findings.

## Boundaries

The scout must not:

- edit `PROJECT.md`, `STATE.md`, `CURRENT_FINDINGS.md`, or manuscript files;
- mark claims as accepted, tentative, or rejected;
- write any core reviewer file;
- decide the final gate;
- start unrelated broad literature review beyond the trial scope;
- download large/restricted assets without an explicit trial need.

The main execution agent decides whether scout-discovered resources affect
current state, findings, manuscript structure, references, or future plans.
