# Start your first research project

CoAutoResearch is a research system for working with an autonomous agent over
multiple iterations. Bring a question, a proposal, or work already in progress.
You can discuss findings as the research runs and decide which suggestions to
send back into the research session.

## Set up with your coding agent

Give your coding agent this instruction:

> Set up and launch CoAutoResearch from https://github.com/YihongT/CoAutoResearch. Follow docs/agent-setup.md, reuse my existing coding-agent login, configure paper generation, verify the setup, and open the dashboard.

The agent checks prerequisites, reuses your Codex or Claude Code login, starts
the dashboard and prepares the paper tools. Complete any interactive provider
login yourself. Dashboard readiness and paper-tool readiness are separate:
research can start while a missing PDF dependency is being resolved.

The dashboard needs Node.js 20+, Python 3.10+, Git and one supported coding-agent
CLI. Paper generation additionally needs Python 3.12+, LaTeX, Poppler and the
four writing skills installed by the product's setup command. Projects may
need their own scientific packages. There is no dashboard build step.
See [agent setup](agent-setup.md) for the executable checklist and
[paper generation](paper-generation.md) for the PDF environment.

For a source checkout, the manual entry point is:

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

Keep the server terminal open. Open the URL it prints. If the port is occupied,
use `--port 8766`; use `--projects-dir /path/to/projects` to choose where research
is stored. Before choosing the npm distribution, compare its published version
with the source version. See the [CLI guide](cli.md) for installation and updates.

## Define your research

Choose **Create project**, name it, and select a backend. Creating a project
makes a research workspace; it does not start an investigation.

In the research brief, explain:

- the question you want to answer and why it matters;
- relevant material or existing work;
- limits on time, compute, data access and scope;
- what would count as useful evidence, including a negative result.

Use **+** to attach materials. Uploads copy files into the project. Linked
folders remain at their original location and must stay accessible to the
server. A path on another computer is not automatically available to a remote
server. Review attachment names and paths before sending.

Send your brief. The agent prepares the research direction and may ask for
missing information. Review the resulting brief, discuss changes, and choose
**Start autoresearch** when you want autonomous work to begin.
Check that the brief preserves your limits and any actions awaiting separate
approval. For example, “ask me before using the final test set” must remain a
pending decision, not become permission to test as soon as a plan is ready.

## Choose the agent settings

**Settings → Agent** separates installed CLI, authentication and discovered
models. Use **Refresh login and models** after updating or logging in. A CLI
being installed does not prove the account can run a model. Resolve discovery
errors before starting; choose from the models your provider actually exposes.

The composer controls the model and supported reasoning effort for your next
message. Autoresearch has its own launch controls. A running turn keeps the
settings captured when it started. Paper generation has separate controls and
shows its selected model before you launch it.

## Work together as research progresses

A **Trial** is one focused research iteration. It can test a method, analyze
an unexpected result, acquire evidence or resolve a research blocker.

Use the autoresearch panel to follow the current action and live activity.
**Trials** keeps earlier iterations, **Reviews** shows their checks, and
**Resources** shows available material. A result recorded in the project has
passed the applicable workflow checks; it has not been externally published
or proved scientifically correct.

Choose **New chat** to discuss findings while the research session works.
These discussions do not directly change research files. **Add to research
draft** transfers a reply or plan to the research input. Review or edit the
draft, then send it to make it an instruction for the main research process.
When the main agent is busy, the input explains whether the message will wait
for the current turn. Adding a draft alone does not apply a suggestion.

(research-controls)=

## Pause, continue or start over

| Action | What happens |
| --- | --- |
| **Pause after current turn** | Requests a pause after the active agent turn. The current trial may still be unfinished. **Pause requested** means the request is pending; **Paused** means automatic continuation has stopped. |
| **Resume autoresearch** | Continues from the current research state. Optional guidance applies to this resumed loop; leave it blank to continue with existing instructions. |
| **Stop current run** | Interrupts the active execution. The current turn or trial may remain incomplete. Read its status before resuming. |
| **Restart autoresearch** | Returns to the brief and materials saved at the first start. Later research work and auxiliary chats are archived, and a new process begins at Trial 1. Review the confirmation dialog carefully. |

When resuming an unfinished trial, leaving the new instruction blank keeps any
previous resume guidance; entering new guidance replaces it. The resume dialog
explains this rule before you continue.

Editing an earlier message is different from sending a follow-up. Read the
confirmation for that message: resending can replace later conversation or
rerun work. Use a new message when you want to preserve the conversation and
add a correction. **Continue in agent CLI** copies a provider command; it is
separate from the dashboard's **Resume autoresearch** action.

Closing a browser tab does not pause the server. Keep the server process alive
for work to continue. A stopped or restarted server can interrupt execution;
return to the dashboard and inspect the recovery action instead of assuming
that work finished. See [multiple projects](multiple-projects.md) and
[remote access](remote-server.md) when returning from another machine.

## Read the manuscript and generate a paper

**Manuscript** brings the research narrative, supporting evidence and remaining
gaps together. After reviewed results are recorded and project agents are idle,
choose **Generate paper**, enter a venue and year or a general research-report
target, and review the model settings.

The internal agent writes from a frozen evidence snapshot, builds figures,
checks citations and compiles the PDF. Follow progress in Manuscript; you can
cancel. After a successful generation, **Paper** appears beside Manuscript for
preview, source downloads and review notes. When replacing a draft, the previous
PDF stays available if the new generation fails or is cancelled.

Read the claims, figures, citations, limitations and venue requirements before
sharing a paper. A green check means a draft was generated, not that it is ready
for submission. See [paper generation](paper-generation.md) and
[best practices](best-practices.md) for review guidance.
