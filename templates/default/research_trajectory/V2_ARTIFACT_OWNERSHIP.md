# V2 Artifact Ownership

| Artifact | Primary writer | Canonical only after | Notes |
|---|---|---|---|
| TRIAL | service scaffolder, then current trial agent, then service transaction finalizer | durable commit | agent proposes lifecycle state through distill; service atomically binds `published`, stage id, review level, outcome, and publish revision |
| PLAN / EXPERT_ROUTE / REPORT / RESULT_CARDS / MERGE_REQUEST | current trial agent | publication receipt | worker proposals and audit |
| DISTILLED_RESULT_CARDS | service stage runtime | first valid staged distillation | immutable hashes of complete result-card payloads; corrections add a new superseding card |
| Candidate canonical snapshot / HUMAN_BRIEF / GATE_EVIDENCE | lead role inside current sequential invocation | exact-stage review and service publication | stored only in trial/staging until publish |
| MERGE_DECISION | service MergeEvaluator | exact-stage review closure | derived from the reviewed stage, Merge Request, manifest, and reviewer outputs |
| REVIEW_MANIFEST | service review router | immediately as routing metadata | agent may request escalation only |
| Reviewer outputs | reviewer invocations | exact-stage closure | each binds stage hash |
| GOAL_GATE | service gate evaluator | transaction publication | never agent-authored canonical status |
| PUBLISH_RECEIPT / CANONICAL_REVISION / transaction journal | service transaction applier | durable commit | never agent-authored |
| STATE / CURRENT_FINDINGS / lines / campaigns / target venue / manuscript control files | service transaction applier from reviewed candidate files | durable commit | protected canonical paths |
