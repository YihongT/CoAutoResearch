# Project Framing Protocol

> **V2 control-plane override.** Framing changes during autoresearch are proposed through a Framing trial, result cards, merge request, and staged project/line/venue updates. A locked venue or project-identity change requires formal human authority. Initial pre-trial framing may be applied by the project initialization service.


## Purpose

`PROJECT.md` is the canonical launch frame for autoresearch. It defines the
research objective, scope, audience or venue, likely contribution, important
resources, constraints, assumptions, exclusions, success criteria, and open
uncertainties. `resources/target_venue/TARGET_VENUE.json` is the authoritative
structured venue state. Its `target_venue` may be `null`. The service
deterministically renders the compact
`resources/target_venue/TARGET_VENUE.md` view from that JSON.

Use this protocol whenever creating, revising, or deciding whether to preserve a
change in `PROJECT.md`.

---

## Before Autoresearch Starts

Before the first autoresearch run, treat `PROJECT.md` as live launch framing.
An agent edit is a candidate: the service restores the direct write, validates
the quarantined bytes after a successful chat turn, and commits the candidate
as a trusted service write. This framing commit does not start autoresearch;
only the user's explicit Start action creates Trial 1.

Evaluate the full latest turn, not only the user's raw message. If your planned
answer itself establishes or materially changes the launch frame, write a
complete `PROJECT.md` candidate before sending the final response. Do not leave
launch-ready framing only in the chat transcript.

Preserve the user's conditions as well as the desired outcome. In particular,
record any action reserved for later human authorization under Constraints,
including the action, the required decision, and whether that decision is still
pending. Quote the short controlling instruction when paraphrasing could lose
its meaning. A request to discuss something before authorizing a final evaluation
is not permission to run that evaluation after merely freezing a plan. Clicking
Start or Resume authorizes the currently permitted work; it does not remove a
separate human approval condition. Check the candidate against the user's
message for omitted prerequisites, exclusions, budgets and environment
requirements before yielding. Surface pending decisions in the final summary.

Update or draft `PROJECT.md` when the latest turn:

- explicitly asks to draft, revise, frame, reframe, narrow, broaden, redirect,
  or prepare the project;
- changes the research objective, central question, scope, proposal/story,
  target venue or audience, expected output, contribution type, constraints,
  assumptions, exclusions, success criteria, or important uncertainties;
- clarifies a previously vague idea enough that it can become a useful launch
  frame;
- corrects the agent's understanding of the project;
- provides resource context that has completed Resource Intake or is explicitly
  not required to be filed before framing;
- produces a substantive recommendation that chooses or changes the target venue
  or audience, paper outline, research objective, contribution type, success
  gate, expected output, constraints, assumptions, exclusions, or launch scope.

Do not wait for the user to say "revise `PROJECT.md`" when the new framing is
clear enough to preserve and would affect how autoresearch should begin. When
the candidate chooses, changes, or clears the target venue or audience, write
both `PROJECT.md` and a schema-valid
`resources/target_venue/TARGET_VENUE.json` candidate. The JSON must bind the
current project and revision 0. Do not hand-author the paired Markdown; the
service owns it.

Read the current `project_id` from `research_trajectory/STATE.json` and reuse
that exact value in the venue candidate. Do not invent an identifier, copy an
example identifier, or use the project folder name. Validate the candidate's
identity as well as its schema before yielding; a rejected candidate is not a
saved research brief.

If the service rejects a candidate, its direct writes are restored after the
agent reply. Re-read the actual files before repairing them; earlier tool
successes and chat claims do not prove those files survived. Reconstruct the
complete requested framing from the user's brief, including PROJECT.md when
the restored file is still the empty scaffold.

Do not update `PROJECT.md` for greetings, UI/how-to questions, status questions,
ordinary discussion, purely casual chat, or early brainstorming that does not
yet choose a direction. In those cases, answer normally and, when useful,
summarize candidate framing in the reply without committing it to canonical
state.

---

## Resources And Evidence

Resource references are not automatically current research truth.

If a message names prior work, a repository, paper, dataset, folder, proposal, or
other external material, follow `instructions/RESOURCE_INTAKE.md` before treating
that material as evidence or as an active project input.

For resource-grounded framing, Resource Intake must include the Content
Inspection Gate. Do not choose a venue, contribution type, scope, evidence
standard, or project claim from only a manifest entry, symlink listing, filename,
or short user description. If the resource content has not been inspected, say
the framing is provisional or path-level only.

You may mention unresolved resource clues in `PROJECT.md` as uncertainties or
pending intake items only when that helps frame the project. Do not describe
unfiled or unvalidated resources as attached evidence.

---

## After Autoresearch Starts

After autoresearch starts, `PROJECT.md` is no longer a live chat draft. It is a
canonical control artifact that should remain consistent with trajectory state.

Update `PROJECT.md` after launch only when:

- the user explicitly changes the project direction, scope, venue, audience,
  constraints, resources, claims, or priorities;
- a formal human intervention requires canonical reframing;
- Resource Intake or Conversion shows that the canonical project framing is
  incomplete, wrong, or stale;

Do not rewrite `PROJECT.md` after launch for ordinary chat, local wording
preferences, temporary trial observations, raw outputs, or speculative ideas.
When in doubt, record a pending human intervention or ask for clarification
instead of silently changing the launch frame.

### Agent-Proposed Scope Changes

After launch, an agent-initiated change to the objective, research question,
population, period, dataset vintage, target venue, or deliverable is a proposal,
not a direct edit. Write:

`research_trajectory/human_interventions/pending/SCOPE_CHANGE_<id>.md`

Use this structure:

```markdown
# Scope Change Proposal

Old objective:
New objective:
Why:
Critical-path impact:
Default if unanswered: keep old scope
```

Continue on the old scope. If the old scope cannot advance, set the
Autoresearch Goal Gate to `Status: needs_human` with `Response to human:`
pointing to the scope decision.

Dataset substitution within the existing research objective under
`instructions/RESOURCE_SCOUT.md` ladder rungs 4-5 is not a scope change. Record
it in `ACQUISITION_DECISION.md`. Ladder rung 6, scope-downgrade proposal, is a
scope change and requires the proposal above.

---

## Response Contract

Always answer the user's latest message first. If you update `PROJECT.md`, report
the change after the answer and briefly state why the update belonged in the
launch frame.

If you propose a target venue or audience change, report the structured venue
candidate. The service reports and renders the synchronized Markdown after it
validates and commits the candidate.

Do not use a file-update summary such as "Updated `PROJECT.md`" as a substitute
for answering the user's question.
