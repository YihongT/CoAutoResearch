# Worktree and Parallel Orchestration - v2.1 Design Only

Parallel batches are not part of the v2.0 production definition of done.

V2.0 remains one invocation, one trial, sequential publication. Do not build a generic multi-agent concurrency framework as part of v2.0.

A future v2.1 may add:

- explicit Batch IDs and Batch Plans;
- independent worker assignments;
- one isolated git worktree per worker;
- no worker access to canonical publication;
- a batch merge board;
- one reviewed staged snapshot and one sequential transaction.

Do not infer that ordinary subagents create separate trials. In v2.0, helper subagents are internal to the current trial and write only under its artifacts/staging scope.
