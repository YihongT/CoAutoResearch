# Canonical Write Guard

## Purpose

Prevent an agent process from turning proposed research into canonical truth before validation, review, and service publication.

## Protected paths

The service loads the versioned registry in `requirements/PROTECTED_PATHS.yaml` or its installed equivalent. Protected paths include project definition, current state/findings, human tasks, lines, campaigns, venue state, manuscript control files, and managed instructions.

## Before launch

The service must:

1. acquire the run-start guard lock;
2. record the current canonical revision;
3. hash every protected file;
4. copy recoverable baseline bytes and metadata to a run guard directory;
5. record allowed write roots for the current trial and stage;
6. release the guard lock and launch the agent.

## After agent exit

Before parsing proposed output, the service must:

1. reacquire the guard lock;
2. compare protected files and paths with the baseline;
3. quarantine unauthorized added/changed/deleted content;
4. restore every unauthorized protected change;
5. record a protocol-violation artifact and semantic trace event;
6. prevent acceptance of affected claims until the violation is reviewed;
7. release the guard lock.

The guard is an integrity control under the local trusted-user deployment profile. It is not an OS-level sandbox against a malicious process with the same user privileges.

## Allowed writes

The agent may write only to:

- the current trial directory;
- the current staging directory;
- `workspace/**`, including ephemeral tool scratch under `workspace/tmp/`;
- explicitly permitted resource acquisition destinations;
- note proposals;
- instruction patch proposals.

Project-root `tmp/`, `output/`, and cache directories are not agent write roots. Managed prompts override any generic tool or skill convention that would place scratch files there.

The service alone writes:

- canonical revision;
- transaction directories;
- publish receipts;
- published canonical files.
