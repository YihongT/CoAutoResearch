# Execution Agent Compatibility Entry

The v2.0 canonical execution protocol is `instructions/KERNEL.md`.

This filename is retained because existing server prompts, projects, and upgrade logic may reference it. Read `KERNEL.md` and follow it as the source of truth. Then load the applicable cold-start, framing, conversion, intake, intervention, resource, manuscript, move, venue, review, and self-improvement instructions named there.

Do not use legacy wording that tells an agent to write canonical state directly or to require all eight reviewers for every v2 trial. V2 canonical updates are staged and service-published; v2 reviewer closure follows `REVIEW_MANIFEST.json`. V1 trials without a manifest retain legacy behavior.

For a v1 project or a legacy trial without valid v2 machine state, read
`instructions/LEGACY_EXECUTION_AGENT.md` and follow its detailed v1 fallback
contract. The v2 write boundary and service-owned publication rules always
take precedence when valid v2 state is present.
