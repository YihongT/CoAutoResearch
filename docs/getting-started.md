---
layout: default
title: Getting Started
description: Install prerequisites, start the UI, and create your first CoAutoResearch project.
---

# Getting Started

Start here if you want to use CoAutoResearch from a local machine.

## Prerequisites

Install:

- Node.js 18 or newer
- Python 3
- Git
- OpenAI Codex CLI

Check the basics:

```bash
node --version
python3 --version
codex --version
```

On Windows, use `python --version` or `py -3 --version` if `python3` is not
available.

## Start the Dashboard

From a checkout of this repository:

```bash
node bin/auto-research.js ui
```

After npm publication, the intended command is:

```bash
co-auto-research ui
```

The UI opens in your browser. If browser launch is unavailable, open the printed
URL manually.

## Create a Project

1. Click `+` in the left sidebar.
2. Enter a project name.
3. Add a research brief, existing folder, paper bundle, or other resources.
4. Review the generated framing before starting the autoresearch loop.

If you run `co-auto-research ui` outside a generated project, CoAutoResearch
creates a local dashboard folder:

```text
local-projects/
```

Projects created from the UI live there and are ignored by this repository.

## Return Later

If you closed the browser or terminal, you can find and reopen existing
projects from the same folder:

```bash
co-auto-research ls
co-auto-research attach my-project
```

`attach` starts the UI for that generated project again. It does not depend on a
previous UI process still running.

## Start From the CLI

For scripting or a single fixed project:

```bash
co-auto-research init my-project
cd my-project
co-auto-research ui
```

## Remote Server

If you are SSH'd into a server:

```bash
co-auto-research ui --remote
```

The CLI prints the SSH tunnel command and local browser URL after the server
starts.
