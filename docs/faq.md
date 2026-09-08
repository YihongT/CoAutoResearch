# Frequently asked questions

## Can I use my existing coding-agent login?

Yes. Reuse an authenticated Codex or Claude Code CLI. Available models, usage limits and billing depend on your provider account; model discovery in Settings shows what the selected backend exposes.

## Where does my research go?

Project files remain in your chosen local or server folder. The configured model provider processes the context sent to it. External resource lookup can use the network. Review sensitive material before attaching it. This release targets one trusted researcher, not public multi-user hosting.

## Can I pause and come back?

Request **Pause after current turn**, wait for **Paused**, then use **Resume autoresearch**. Closing a browser tab does not stop a running server. Server interruptions may require explicit recovery. [Control semantics →](research-controls)

## What remains my responsibility?

Choosing the question, evaluating scientific claims, resolving decisions that require human judgment and reviewing anything you share or submit. [Research practices →](best-practices.md)

## Do I need the npm package?

No. You can run CoAutoResearch directly from a GitHub checkout. The source CLI
has no application dependency installation or build step. Follow
[agent setup](agent-setup.md) for the dashboard and separate paper tools. An
older npm version may not include the current source features.

## How do I change the documentation theme?

The documentation opens in light mode by default. Use **Dark mode** or
**Light mode** below the sidebar search, or in the mobile header. Your choice
is saved in this browser and kept when you open another page.

## Where can I ask a question or report a problem?

Use [GitHub Issues](https://github.com/YihongT/CoAutoResearch/issues) for
reproducible bugs and feature requests. For general enquiries, contact
[yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca). Report security
issues privately through the repository’s [security policy](https://github.com/YihongT/CoAutoResearch/security/policy).
