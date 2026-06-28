# Project Framing Protocol

## Purpose

`PROJECT.md` is the canonical launch frame for autoresearch. It defines the
research objective, scope, audience or venue, likely contribution, important
resources, constraints, assumptions, exclusions, success criteria, and open
uncertainties.

Use this protocol whenever creating, revising, or deciding whether to preserve a
change in `PROJECT.md`.

---

## Before Autoresearch Starts

Before the first autoresearch run, treat `PROJECT.md` as a live framing
document. Keep it current whenever the conversation produces a clearer or
materially different launch frame.

Update or draft `PROJECT.md` when the latest user message:

- explicitly asks to draft, revise, frame, reframe, narrow, broaden, redirect,
  or prepare the project;
- changes the research objective, central question, scope, proposal/story,
  target venue or audience, expected output, contribution type, constraints,
  assumptions, exclusions, success criteria, or important uncertainties;
- clarifies a previously vague idea enough that it can become a useful launch
  frame;
- corrects the agent's understanding of the project;
- provides resource context that has completed Resource Intake or is explicitly
  not required to be filed before framing.

Do not wait for the user to say "revise `PROJECT.md`" when the new framing is
clear enough to preserve and would affect how autoresearch should begin.

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
- the execution agent intentionally promotes a verified project-definition
  change and updates related trajectory artifacts consistently.

Do not rewrite `PROJECT.md` after launch for ordinary chat, local wording
preferences, temporary trial observations, raw outputs, or speculative ideas.
When in doubt, record a pending human intervention or ask for clarification
instead of silently changing the launch frame.

---

## Response Contract

Always answer the user's latest message first. If you update `PROJECT.md`, report
the change after the answer and briefly state why the update belonged in the
launch frame.

Do not use a file-update summary such as "Updated `PROJECT.md`" as a substitute
for answering the user's question.
