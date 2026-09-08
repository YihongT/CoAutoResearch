# Production Deployment Profile P1

Supported v2.0 production use:

- one trusted human operator;
- a local dashboard may browse and launch multiple projects;
- local-first use;
- loopback binding by default;
- authenticated reverse proxy or authenticated tunnel for remote production access;
- one sequential autoresearch trial at a time;
- one active project agent worker per dashboard process; each agent worker is a separate OS process with a single project root as its working directory;
- Codex or Claude Code backend;
- Node.js 20+ and Python 3.10+;
- Ubuntu, macOS, and Windows CI coverage.

Not supported by this profile:

- public unauthenticated long-running service;
- multi-tenant user isolation;
- shared untrusted accounts;
- concurrent multi-trial batches;
- cross-project agent concurrency in one dashboard process;
- undeclared specialized domain authority beyond installed, registry-routed packs.

The dashboard owns admission and monitoring but does not execute research logic in its own interpreter: it launches the selected CLI as a project-bound child worker. The local agent worker runs with the OS user's privileges. Canonical staging and transaction controls protect research-state integrity but are not a general OS security sandbox.
