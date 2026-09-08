# Generate a paper in the dashboard

After reviewed research results are recorded in your project, open **Manuscript → Generate paper**.
Enter a target venue (include the year when it matters), choose a model and
reasoning effort, and click **Generate paper**. New Codex paper generations
default to **GPT-5.6-Luna · High** when that model is available. Subsequent
generations retain your chosen settings. Writing and automatic repair share
a **3-hour** execution budget; cancellation remains available throughout. The project's internal coding
agent writes the article, creates figures from saved evidence, checks references,
uses an official venue template when available, and builds the PDF.

The page shows human-readable progress and **Cancel generation**. You can switch
pages or close the browser while the server continues working. Return to
Manuscript for the latest status. Once generated, **Paper** appears beside
Manuscript in the sidebar, with the browser’s built-in PDF viewer,
**Download PDF**, **Download source**, and **Review notes**. Keep the dashboard server running. A server
restart interrupts unfinished generation; the page offers a retry. When the
target and frozen evidence are unchanged, retries reuse any existing draft
and figures as starting material. The agent rechecks content completeness and
expands underdeveloped methods, analysis and figures using available evidence.
It records the review in `qa/content-review.md`, separating writing omissions
from research gaps. A venue template alone is not a full conference article;
page limits are ceilings, and missing research cannot be repaired by padding.
After an interruption, a same-evidence retry also carries forward the last
diagnostics and prioritizes unfinished compilation and checks; completed work
and already verified records are reused.

The source ZIP includes LaTeX, plotting code, the evidence snapshot, bibliography,
and build/review notes. A generated paper is a draft for human review, not an
approved submission. An unavailable requested-year template must be disclosed;
an older style must never be renamed to look current.

## Setup contract for the coding agent

This section is part of [one-instruction setup](agent-setup.md). The setup agent
prepares the tools once; paper generation subsequently happens inside the
product. Do not manually write a paper as a substitute for testing the button.

1. Reuse the authenticated Codex or Claude Code installation configured for the
   dashboard. No separate model or image API is required. Research is processed
   by the selected provider using its existing login; public citation/template
   lookup requires network access.
2. Find Python **3.12+**, Git, **latexmk**, a LaTeX installation including common
   conference packages, and **Poppler** (`pdfinfo`, `pdffonts`, `pdftoppm`). Reuse existing
   tools. For missing tools use the platform's normal installer, preserving
   existing environments. On macOS, MacTeX supplies LaTeX and `brew install
   poppler` supplies previews. On Debian/Ubuntu, the usual packages are
   `latexmk texlive-latex-extra texlive-fonts-recommended poppler-utils`.
   For Claude Code on Linux/WSL2 also install its sandbox prerequisites (`bubblewrap`
   and `socat`). Claude paper generation requires its native sandbox; on Windows
   run that backend in WSL2. On Windows with Codex use a supported TeX distribution
   and Poppler on PATH. Verify the
   installed commands rather than assuming the package installation succeeded.
3. From the source checkout, run the product's installer with that Python:

   ```bash
   python3 templates/default/ui/paper_tools.py --setup
   ```

   For an installed generated project the same command is
   `python3 ui/paper_tools.py --setup`. Set `COAUTO_PAPER_TOOLS_DIR` only if a
   custom location is required; use the same environment for setup and the
   dashboard. The default is under `~/.co-auto-research/paper-tools/`.
4. Require the command to report `"smoke_test": "passed"`. It installs the four
   pinned skills, creates an isolated Python environment, checks the skill
   helper commands, compiles a tiny LaTeX document and renders its page. It
   normalizes child-process locale settings, including on macOS. A missing
   executable, failed download or failed compile is an incomplete paper setup;
   resolve it and rerun the command. Dashboard setup can be reported separately.
5. Open Manuscript and confirm the target/model/reasoning controls appear.
   Do not start an experiment or generate a research paper merely to check
   installation. When the user asks for a paper, start it with the UI button.

The installer uses a sparse Git checkout of just these four skills from
[K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills),
pinned to commit `9cf7d9aea7d84754db4c167ab04b299d33c444bc`:

| Skill | Responsibility |
| --- | --- |
| `scientific-writing` | Evidence-bound prose, consistency checks and unresolved human review |
| `scientific-visualization` | Reproducible numeric figures, legible styles and provenance |
| `citation-management` | Retrieve, enrich, deduplicate and validate reference metadata |
| `venue-templates` | Verify actual venue rules, template provenance and PDF format |

They are copied into each isolated writing workspace and explicitly named in the
internal agent prompt. No global skill installation or new coding-agent session
is needed. The upstream license and citation metadata remain in the tool cache;
the setup receipt records source hashes. Python dependencies are pinned in
`ui/paper_tools.py` and installed in that cache's virtual environment, separate
from both the dashboard and research experiment environments.

## Evidence and execution boundaries

Paper generation requires reviewed v2 results recorded in the project and waits until project agents
are idle. It snapshots the current manuscript, findings, published trial reports
and small saved scientific artifacts. Unpublished stages, chat sessions, secret
files, raw dataset/model arrays and transient caches are excluded. Oversized
inputs fail with an actionable message rather than being silently omitted.

The internal agent works in a separate service-owned paper workspace. It must
read the frozen snapshot, use all four skills, and generate figures from existing
metrics. It must not train models, rerun held-out evaluations or edit the original
research. The service checks snapshot hashes after writing. Recording new
scientific results remains a separate autoresearch operation.

Writing and compilation run as supervised processes with time limits and a
cancellation path. The service recompiles with shell escape disabled, checks for
unresolved references/citations, overflow and font problems, returns concrete
errors to the writing agent for at most two repair passes, renders every PDF
page and releases a separate
artifact copy only after these steps pass. The browser exposes only named
artifacts belonging to the current project. Successful compilation is not proof
of scientific accuracy: inspect the preview and review notes before using the
paper.

The manuscript must preserve evidence limits, failed experiments and uncertain
technical causes. It must not manufacture results, authors, bibliographic records,
novelty claims, ethics approvals or human verification. If the K-Dense skills
materially contribute, their own citation guidance applies and the agent records
that use alongside the paper's other tools.

The **Paper** entry appears alongside **Manuscript** in the project sidebar only after a paper has been generated. Start the first generation and follow its progress in **Manuscript**. Its spinner
tracks generation even while you use another page. A green check means a draft
was generated, not that it passed scientific or submission review. The PDF opens in the browser's built-in reader, with its native zoom, scrolling,
search, text selection and print controls where supported. **Open PDF** opens it
in a separate tab for more reading space or browsers that cannot display an
embedded PDF. No manuscript regeneration is needed for existing papers.
Generate new draft keeps the
previous PDF available until its replacement succeeds, including after cancellation,
failure, or a server restart. When research advances, the paper shows its older
evidence revision and offers generation of a new draft.
