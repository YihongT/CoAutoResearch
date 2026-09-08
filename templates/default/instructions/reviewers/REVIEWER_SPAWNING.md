# Specialized Reviewer Registration and Spawning

## Purpose

Add domain-, method-, risk-, or project-specific review coverage when the eight core reviewers are insufficient. Specialized reviewers are routed by registered expert packs; they do not create an untracked ninth global gate.

All specialized reviewers inherit
`instructions/reviewers/REVIEW_TAXONOMY.md` and its machine-output contract.

## V2.0 baseline

The enabled `general_research` pack may register no specialized reviewers. The Review Manifest must state this explicitly when none are required.

## When specialized coverage is required

Examples include:

- statistics or causal inference;
- dataset/benchmark validity or leakage;
- human-subjects, ethics, privacy, safety, or dual use;
- theory/proof correctness;
- model/LLM evaluation validity;
- reproducibility or artifact execution;
- domain-specific clinical, legal, policy, or scientific judgment;
- repeated blind spots identified by Process Review;
- explicit formal human request.

## Registry contract

A reusable specialized reviewer belongs to an enabled domain/method/risk pack registry and defines:

- stable reviewer ID and version;
- deterministic trigger conditions;
- purpose and scope;
- required reading;
- detailed criteria;
- output filename/path;
- whether it is advisory or closure-required;
- which core reviewer(s) consume its findings;
- valid/invalid fixtures and routing tests.

Do not create a reviewer ad hoc merely to obtain a favorable decision. If a one-off project-specific reviewer is needed, create a versioned instruction patch proposal and require the ReviewRouter/human to approve its registration before it counts for closure.

## Output rules

- Use `schemas/reviewer-output.schema.json` with `scope: specialized`.
- Bind post-stage output to the exact stage hash.
- List the reviewer in `REVIEW_MANIFEST.json`.
- Record its trigger and instruction path.
- A closure-required specialized reviewer must pass before final publication.
- Its blocker is propagated through the relevant core reviewer and Merge/Gate evaluators; it does not independently rewrite global status.

## Prohibitions

- Do not replace or silently omit a required core reviewer.
- Do not store reviewer instructions in research trajectory state.
- Do not write review results into the instruction directory.
- Do not allow a specialized pack to override the kernel, write guard, transaction, state vocabulary, or gate priority.
