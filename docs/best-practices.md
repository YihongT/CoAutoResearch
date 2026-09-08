# Research together, build on evidence

Use CoAutoResearch to advance work you can understand, question and revise.
The agent can carry out a sequence of research steps; you bring context,
decide what matters and remain responsible for interpreting the result.

## Start with a useful brief

An initial question is enough to begin a conversation. A stronger brief explains
what is known, what remains uncertain and which constraints matter. Add a
proposal, prior experiments or notes when available. Say which conclusions
would change your next decision, rather than requiring a positive result.

For example: “Compare these two methods under a fixed compute budget. Report
uncertainty and failure cases. Do not use the final test set to choose settings.”
A target venue helps shape reporting, but does not establish novelty or supply
missing evidence.

When an action needs a later decision, name that action and its prerequisite.
Review the prepared brief before Start to confirm the condition was retained.
Starting autonomous work does not waive a separate approval you reserved.

## Bring existing work without losing its meaning

Upload research material or link an accessible folder through the composer.
Uploads are copied; linked material stays in place. Include enough context to
distinguish raw data, derived results, abandoned experiments and current code.
Do not include credentials or unrelated private files.

Research-bearing material in `resources/ongoing_work/` triggers a conversion
trial before ordinary research. It inventories existing work, records resource
locations and treats earlier quantitative results as tentative until checked.
An imported number is not automatically a verified new finding. Preserve source
files and explain how earlier results were produced.

## Use discussion to improve the next step

Open **New chat** while autoresearch is working. Ask a specific question: Is the
comparison fair? Would the finding survive a different split? Which alternative
explanation remains? Discussions can inspect the project without directly
changing its research files.

When an answer suggests a useful change, choose **Add to research draft**.
Review the wording and send it to the research session. Make the intended scope
explicit: “Before the next evaluation, add class-level error analysis” is easier
to apply than “make the study better.” Check the following plan or result to see
how the instruction was handled. Adding a suggestion to a draft does not send it to the research session.

## Keep each trial focused

A trial should resolve a concrete uncertainty or remove a blocker. Define a
bounded next move with an observable outcome: acquire data, compare methods,
repair an experiment, investigate a failure, or organize verified findings.
Prefer a small useful run before spending more compute.

For statistical work, establish evaluation rules in advance. Fit preprocessing
only on training data, preserve an untouched test set where appropriate, record
seeds and account for uncertainty. Do not repeatedly change splits until a result
looks attractive. A careful negative comparison can be more useful than an
unreliable improvement.

Read live updates for the current action, observations and next step. Review
technical details when investigating a specific problem. If a run stalls, check
whether it is waiting for a provider, executing work or asking for a decision;
a failed page refresh is not itself evidence of a failed experiment.

### Resolve execution setup before experiments

Ask the agent to verify its project-local interpreter and dependencies before
using evaluation data. If a copied Python environment cannot start, inspect the
error and try an installed interpreter with the required version. Do not treat
a failed installation as an experimental result or silently inherit system
packages when isolation was requested.

Codex web search and command networking are separate settings. If dependency
downloads fail, inspect the actual error and host connectivity first. When the
cause is the workspace command network restriction, you can enable downloads
for this project in **Settings → Agent → Advanced config** with
`sandbox_workspace_write.network_access=true`, save, and resume the stopped run.
This enables network access for commands, not just the browser search tool.
See the [official Codex network documentation](https://learn.chatgpt.com/docs/agent-approvals-security#network-access).

## Give guidance at the right boundary

Use **Pause after current turn** when you want to review progress before automatic
continuation. Wait for **Paused** before assuming work has stopped. Resume with
specific guidance when the current direction remains useful.

Use **Stop current run** when an active execution must be interrupted; its work
may be incomplete. Reserve **Restart autoresearch** for returning to the original
launch direction, with later work archived. A follow-up message usually preserves
more useful context than editing and resending an earlier message.

## Read findings with their limits

Distinguish a proposed idea, a measured observation and a reviewed result recorded
in the project. Inspect data provenance, comparison conditions, uncertainty,
failed attempts and unresolved explanations. Internal review checks the research
record; it does not substitute for independent replication or peer review.

Candidate routes are directions still available to explore. Rejected or replaced
routes belong to history and help explain how the current direction was chosen.
Avoid treating the number of trials or review files as a measure of scientific
progress. Ask what the latest evidence actually allows you to claim.

## Move from manuscript to paper in the product

Use **Manuscript** to read the evolving research story and inspect its evidence.
The underlying `manuscript/PAPER_PLAN.md` describes the writing plan;
`manuscript/BLUEPRINT.md` connects content to supporting material. Missing analysis
belongs in the research process, not in invented prose.

Once reviewed results are recorded and project agents are idle, choose
**Generate paper**. The product's internal agent uses scientific writing,
visualization, citation and venue-template skills to produce a draft and PDF
from the saved evidence. It does not run new experiments during writing.

Choose a general research report when the work is an exploratory comparison.
For a conference target, specify the venue and year. A template or a long PDF
cannot compensate for missing evidence. Review notes should distinguish issues
that better writing can resolve from gaps requiring further research.

Check every figure against its source data. Numeric figures should preserve
uncertainty, units and comparison conditions. Conceptual illustrations must not
be presented as experimental evidence. Then inspect citations, author details,
limitations, ethics statements and the actual venue requirements before sharing.
See [paper generation](paper-generation.md) for tools, cancellation and recovery.
