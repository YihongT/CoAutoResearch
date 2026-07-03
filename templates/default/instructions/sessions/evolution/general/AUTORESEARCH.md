# Autoresearch Session Context

This is the persistent autoresearch loop. It is driven by the standard
CoAutoResearch instruction chain and has full access to the research
trajectory, trials, and manuscript.

## Instruction chain
- `AGENTS.md`
- `instructions/EXECUTION_AGENT.md`
- `instructions/reviewers/`

## Runtime control
Use the Start, Pause, Resume, Continue, and Restart controls in the UI to drive
this loop. Ordinary Chat sessions are auxiliary conversations; they do not
start or continue the autoresearch loop.
