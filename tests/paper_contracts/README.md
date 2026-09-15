# Paper contract tests

These tests expose a small, public set of software invariants that correspond to
claims in the CoAutoResearch system paper. They use synthetic artifacts and
synthetic passing reviewer outputs. They do **not** evaluate scientific quality,
autonomous-agent performance, or real reviewer judgments.

Run from the repository root:

```bash
python -m unittest discover -s tests/paper_contracts -p 'test_*.py' -v
```

The suite currently checks:

- historical mentions do not become accepted evidence merely by appearing in canonical state;
- superseded evidence cannot silently return as active support;
- one accepted Result Card may be composed into multiple Research Lines;
- an execution-approved Plan must target a current actionable Critical Path item;
- a publication smoke path binds Publish Receipt, transaction, and canonical revision.
