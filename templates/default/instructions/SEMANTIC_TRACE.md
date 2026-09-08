# Semantic Research Trace

Emit structured research-stage events in addition to existing command, tool, file, plan, approval, usage, web, and error trace.

Allowed phases:

- observe
- orient
- route
- charter
- preflight
- execute
- distill
- stage
- review
- brief
- gate
- publish
- recovery

Each event includes run ID, optional trial ID, sequence, phase, status, concise message, redacted details, and timestamp. Do not place secrets, raw credentials, or sensitive file content in trace details.

The UI renders these events as a calm research progress narrative. Trace events do not change gate or canonical state by themselves.
