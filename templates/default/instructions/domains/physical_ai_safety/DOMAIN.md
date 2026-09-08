# Physical AI Safety Domain Pack

## Purpose

Apply safety-case discipline to research about embodied or physical-world AI. This pack narrows claims to what the inspected evidence can support; it does not certify a system or replace engineering, regulatory, or human safety review.

## Required framing

Record, before making a safety claim:

- the system boundary, components, interfaces, autonomy level, and lifecycle phase;
- the operational design domain and material out-of-domain conditions;
- exposed people, operators, bystanders, infrastructure, and other protected assets;
- hazards, initiating conditions, failure modes, severity, likelihood posture, and uncertainty;
- prevention, detection, mitigation, fallback, recovery, and human-control mechanisms;
- the exact evidence type for each claim: observed, experimental, simulated, analytical, documentary, assumed, or proposed.

## Evidence rules

- Build an explicit claim-hazard-control-evidence-residual-risk chain.
- Separate leading indicators and proxy metrics from realized safety outcomes.
- Include adverse, null, contradictory, and boundary evidence, not only successful demonstrations.
- Evaluate foreseeable misuse, operator error, automation surprise, degraded sensing or actuation, distribution shift, communication loss, and unsafe handoff where applicable.
- State population, environment, task, duration, sample, and implementation limits for every empirical result.
- Treat standards and regulations as requirements or comparison frames only when their identity, edition, applicability, and provenance are verified.

## Claim limits

- No observed incident is not proof of safety.
- Simulation or laboratory evidence cannot silently become a deployment claim.
- A control proposal is not an implemented or validated control.
- A scoped safety improvement is not overall system safety.
- A structured candidate that passes automated review is not a certification, regulatory approval, or independent safety assurance.

## Missing expertise

When the work requires domain-specific hazard analysis, functional safety, cybersecurity, legal, regulatory, clinical, transportation, aviation, or human-subject expertise that is not installed and reviewed, record the missing pack and its impact. Narrow the result or require a human specialist; do not infer that this pack supplies the missing authority.
