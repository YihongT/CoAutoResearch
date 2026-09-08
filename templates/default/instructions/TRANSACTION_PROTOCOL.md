# Recoverable Canonical Publication Protocol

## Observable guarantee

CoAutoResearch does not claim an impossible single multi-file atomic rename. It guarantees that API readers observe either the prior committed canonical revision or the next committed revision, and that interrupted publication is recoverable.

## Preconditions

- protected-path guard passed;
- staged manifest and all staged JSON validate;
- JSON and Markdown views are consistent;
- review routing and closure validate;
- merge decision is coherent with reviews;
- staged Human Brief exists;
- goal gate evaluation succeeds;
- base revision equals current revision.

## Transaction structure

`research_trajectory/.transactions/<transaction_id>/` contains:

- `TRANSACTION_MANIFEST.json`
- `JOURNAL.json`
- `before/`
- `after/`
- `COMMITTED` marker after success
- diagnostic logs

## Publication algorithm

1. Acquire exclusive project transaction lock.
2. Re-read the current canonical revision and abort on mismatch.
3. Materialize and validate all after files.
4. Snapshot every replaced file into `before/`.
5. Record create/replace operations and hashes.
6. Write and fsync transaction state `prepared`.
7. For each operation, write a same-directory temporary file, fsync it, replace the destination, fsync the destination and parent where supported, then journal the applied operation.
8. Atomically replace the reviewed trial proposal with the service-finalized
   `TRIAL.json`, binding its published lifecycle state, stage id, review level,
   outcome, and publish revision.
9. Write the new canonical revision.
10. Write and fsync the `COMMITTED` marker.
11. Mark the manifest committed, release the lock, and write the trial publish receipt.

V2.0 does not permit destructive delete operations through this transaction. Deprecate or archive through a separate reviewed protocol.

## Reader behavior

Overview and gate readers acquire the coherent-read lock or retry if publication is active. Every overview response includes the canonical revision used.

## Recovery

At startup and before a new publication:

- no commit marker: restore all before snapshots and remove created destinations, then mark rolled back;
- commit marker present: verify target hashes and revision, recreate missing receipt if needed, then mark finalized;
- recovery is idempotent;
- failures remain visible in diagnostics and UI.

## Required tests

Inject failure before prepare, after prepare, after each replacement position, before revision write, before commit marker, and after commit marker. Repeated recovery must produce the same coherent revision.
