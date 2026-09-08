# Method Build Move

## Use when

The next bottleneck is constructing or repairing a method, model, framework, workflow, implementation, prototype, pipeline, prompt, analysis procedure, or evaluation mechanism.

## Required work

1. State the capability or hypothesis the method must enable.
2. Define interfaces, inputs, outputs, assumptions, and failure modes.
3. Build the smallest credible version that can answer the local question.
4. Add a smoke test and save reproducible configuration.
5. Compare against the prior method or a minimal sanity baseline when relevant.
6. Record implementation artifacts separately from evidence claims.
7. State what still requires empirical validation.

## Local completeness

Complete when the method artifact works for its declared interface or its failure is diagnosed enough to decide repair, abandon, or reframe. Building a method does not by itself support performance, utility, or generalization claims.

## Result cards

Typical cards: artifact, method decision, diagnostic insight, boundary condition.

## Do not

- expand into a full production system unless the charter requires it;
- describe implementation completion as empirical success;
- silently alter evaluation definitions to make the method look better.
