# Best Practices

CoAutoResearch is **Co** as much as **Auto**: the agent does the heavy lifting,
but you stay the PI — you bring the context, steer the direction, and own the
result. The autonomy is a means; the goal is research you can understand,
revise, and defend. These patterns get the most out of that.

## Best ways to start

The agent works best when you give it real research context to ground in, not
just a one-line prompt. Two starting points work especially well — both are
uploaded through the composer `+` button and filed under your project's
`resources/`.

### Bring a proposal and a deep-research report

If you've already shaped an idea with ChatGPT or Claude — a proposal, plus a
deep-research report on the landscape — upload both and let CoAutoResearch take
it from there. It grounds its trials, evidence, and manuscript in your framing
instead of starting cold, so the direction is yours from the first step.

### Continue a half-finished project

Have work already in progress? Upload the folder, or a `.zip` of your ongoing
project — drafts, notes, data, prior experiments. CoAutoResearch surfaces what's
there, files it as resources, and continues the research rather than restarting
it.

Either way, uploaded material is copied into `resources/` and recorded, so the
agent can cite it and you can trace where everything came from.

For ongoing projects, put research-bearing material under
`resources/ongoing_work/` or upload it through the UI. CoAutoResearch now runs a
mandatory conversion trial before normal autoresearch when that folder contains
code, data, checkpoints, results, manuscript sources, or metrics. The conversion
trial inventories what is present, activates large resources in place, migrates
runnable code or derived data into `workspace/`, and registers prior quantitative
results as tentative findings until the new run verifies them.

## Keep the Critical Path empirical

The loop is driven by the Critical Path in `research_trajectory/STATE.md`. Each
trial should target the current bottleneck: acquire or substitute data, run or
repair methods, produce results, build figures/tables, or assemble the
deliverable. Audits and register cleanup are useful only when they unblock one
of those items.

When a public dataset or file is research-critical, the agent should not leave
it as a link-only note. It should record an acquisition decision, try user
provided ongoing work and local caches first, then official downloads and
acceptable substitutes within the objective. A human decision is reserved for
credentials, private resources, scope changes, or substitutions that would
change the core claim.

## Working with the manuscript blueprint

CoAutoResearch uses two manuscript artifacts. `manuscript/PAPER_PLAN.md` is the
working venue-format plan: section obligations, planned figures/tables, evidence
gaps, and blockers live there. `manuscript/BLUEPRINT.md` is the exportable
blueprint: it should contain only real, source-backed content, including real
results, figure/table blocks, references, appendix posture, and provenance.

The blueprint is not finished prose. That is deliberate. Today's models can plan
and ground a paper far more reliably than they can write the full narrative with
correct, defensible reasoning end to end. So we keep the part that must be right
and traceable — the research itself — as the deliverable, and leave the final
sentence-level prose to you.

This is the Co in CoAutoResearch: every claim is tied to evidence you can check,
and you can revise the argument before a single paragraph is written. You own
and can defend the result, instead of inheriting prose you would have to
reverse-engineer.

When the paper is complete, hand the **Paper-Writing Pack** to GPT or Claude and
ask it to write the paper from the blueprint. Because the structure, claims, and
evidence are already fixed, the model is rendering your research into prose —
not inventing it.

If the UI offers a **Research Status Pack** instead, the run is not ready for
paper writing. That export is an honest checkpoint containing `PAPER_PLAN.md`,
state, findings, and blockers.

## Generating figures

Figures follow the same split. The blueprint gives a **description/spec for each
figure** rather than treating a generated image as the source of truth. The
figure block should say what the display must do, where it belongs in the paper,
which evidence or concept it carries, what caption it needs, and what still
blocks it from being final.

If you are using the Codex backend and image generation is available,
CoAutoResearch can create candidate figure previews from active inline figure
specs. Generated previews are saved under `manuscript/figures/generated/`, and
the matching `manuscript/BLUEPRINT.md` figure block records the source path and
Markdown `Preview image`. Claude Code does not start Codex figure-image jobs.

You can also work manually: copy the figure description into an image model,
save the result under `manuscript/figures/`, and update the figure block with
its source path and preview image. Either way, the blueprint remains the
auditable source for what the figure must show; the image is a candidate display
until you accept it as part of the manuscript.

## Staying in the loop

The Co is the point: step in whenever you want to change direction, scope,
methods, claims, or target venue. Your interventions become part of the project
record, so the research stays yours — steerable while it runs, and defensible
after the agent hands off.
