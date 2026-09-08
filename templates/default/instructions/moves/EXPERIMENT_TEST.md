# Experiment or Analytical Test Move

## Use when

A concrete empirical, simulation, analytical, comparative, benchmark, or evaluation question blocks the active line or campaign.

## Required work

1. State the tested claim or discriminating question.
2. Define data/population, split or sample, baseline/comparator, metric or criterion, configuration, and interpretation rule.
3. Verify the evaluation definition before running.
4. Run a small smoke test before expensive execution.
5. Preserve commands, seeds/configs, raw outputs, and logs.
6. Compare under equivalent conditions.
7. Report uncertainty, variation, failure cases, and alternative explanations appropriate to scope.
8. Produce a result even when null/negative; diagnose execution failure separately from hypothesis failure.

## Sequencing rule

Do not automatically run main result, every ablation, sensitivity analysis, utility study, and downstream task in one trial. First close the chartered empirical question. Campaigns schedule later components only if the main signal and story justify them.

## Local completeness

Complete when the comparison/result is interpretable, or when failure is diagnosed enough to select the next move. A single result may be tentative rather than globally complete.

## Result cards

Typical cards: positive evidence, negative evidence, diagnostic insight, boundary condition.
