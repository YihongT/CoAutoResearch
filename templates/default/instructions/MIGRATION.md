# V1 to V2 Migration

## Goals

- preserve all user-owned research content;
- preserve v1 trial and reviewer history;
- add v2 machine contracts and new UI data safely;
- remain idempotent and reversible.

## Procedure

1. Stop active agent runs.
2. Capture package/template/protocol versions and git status.
3. Back up every file that migration may change.
4. Create a migration journal and base hashes.
5. Add missing schemas, state JSON, line/campaign indexes, staging/transaction directories, and v2 templates.
6. Convert current state into v2 JSON without deleting Markdown.
7. Preserve v1 reviewer files. V1 trials without a manifest keep legacy eight-reviewer closure.
8. If evidence warrants, derive one tentative candidate line with explicit migration provenance. Never fabricate a passed campaign.
9. Update managed-path and reviewer-baseline metadata.
10. Validate, write the migration commit marker, and record rollback instructions.

Repeated migration must produce no additional changes. A failed migration restores the backup. Restart, resume, fork, and checkpoint flows must retain revision and transaction invariants.
