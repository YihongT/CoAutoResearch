# Human Presentation

## Purpose

Present the current research judgment, not protocol ceremony. `HUMAN_BRIEF` explains the reviewed outcome; `GOAL_GATE` separately owns the global status.

## User-facing communication

Follow the user’s language for replies and progress updates. Explain the research action, the observation, and the next useful step in short, concrete sentences. Separate proposals, observations, reviewed results and unresolved limitations. Describe service publication as recording results in the project; it is not external peer review. Keep internal artifact names, hashes and schema repair in technical details unless the user needs them to decide. Report only confirmed causes and recovery actions, and never expose private reasoning. These presentation rules do not change the artifact contracts, review requirements or write boundaries below.

## Timing and ownership

Create the final-form Human Brief inside the staged candidate bundle before post-stage review. Required reviewers inspect it together with the candidate canonical snapshot, Merge Request, and Gate Evidence.

If any review or repair materially changes the brief, candidate state, or evidence, create a new stage hash and rerun every affected review. The service publishes the reviewed brief and independently publishes `GOAL_GATE`; do not duplicate a mutable gate-status field inside `HUMAN_BRIEF`.

## Required content

- trial outcome;
- one-line outcome in plain language;
- neutral outcome changes represented by the exact candidate stage;
- evidence links and scope;
- active-line impact;
- campaign impact;
- venue impact;
- negative and limiting evidence;
- current best line;
- current bottleneck;
- recommended next bounded move;
- human action.

`trial_outcome` describes the whole trial under the same blocker semantics as
the service-computed Goal Gate. Use `blocked` only when a non-human operational
dependency prevents every valuable next move. Use `needs_human` only when one
blocking human dependency prevents every valuable next move. A failed or
incomplete local acquisition with a viable changed-ingress move and a
non-blocking human request is not `blocked`; use `informative_negative`,
`no_state_change`, or `advanced` according to the actual research outcome.

The brief must not describe a current-trial change as canonically accepted. Use neutral outcome language. The UI labels a change applied only when the published Merge Decision and Publish Receipt confirm it; if the Merge Decision cannot approve the exact represented outcome, the stage must be repaired rather than silently rewriting the brief after review.

## Human action rules

For a blocking human dependency:

- exactly one question;
- the dependency blocks every valuable move;
- explain why it is needed now;
- list bounded options when useful;
- include a recommendation when appropriate;
- `needed=true`;
- `blocking=true`;
- `can_continue_meanwhile=false`.

For a non-blocking request:

- Gate Evidence recommends `continue`;
- add or merge a task in staged Human Tasks;
- do not use a blocking Human Brief request.
- do not set Human Brief `trial_outcome` to `blocked` or `needs_human`.

## UI priority

The UI joins the published Goal Gate and published Human Brief. It uses the Human Brief first for narrative, accepted/qualified result cards second for evidence, and legacy Report summaries only as fallback. Reviews appear as quality-control detail, not the main story.
