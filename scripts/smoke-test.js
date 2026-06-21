#!/usr/bin/env node

import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const cli = path.join(root, "bin", "auto-research.js");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "co-auto-research-smoke-"));
const projectDir = path.join(tempRoot, "project");
const projectTwoDir = path.join(tempRoot, "project-two");
let nextTestPort = 32100;

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ");
}

function findPython() {
  const candidates = [
    { command: process.env.COAUTO_PYTHON || "", args: [] },
    { command: "python3", args: [] },
    { command: "python", args: [] },
    { command: "py", args: ["-3"] }
  ].filter((candidate) => candidate.command);
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  throw new Error("No Python executable found for smoke tests.");
}

async function freePort() {
  for (let attempts = 0; attempts < 1000; attempts += 1) {
    const port = nextTestPort;
    nextTestPort += 1;
    const server = await tryReservePort(port);
    if (!server) continue;
    await closeServer(server);
    return port;
  }
  throw new Error("Could not find a free low-numbered localhost port for the smoke test.");
}

function tryReservePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function parseThemeTokens(stylesCss, theme) {
  const selector = `html[data-theme="${theme}"]`;
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...stylesCss.matchAll(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, "g"))];
  const match = matches.at(-1);
  if (!match) throw new Error(`missing CSS token block for ${theme} theme`);
  const tokens = {};
  for (const tokenMatch of match[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) {
    tokens[tokenMatch[1]] = tokenMatch[2].trim();
  }
  return tokens;
}

function hexToRgb(hex) {
  const normalized = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`expected a six-digit hex color, got ${hex}`);
  }
  return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255);
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

function assertThemeContrast(stylesCss) {
  const requiredPairs = [
    ["ink", "bg", 4.5],
    ["ink", "surface", 4.5],
    ["muted", "surface", 4.5],
    ["rail-ink", "rail", 4.5],
    ["primary-ink", "accent", 4.5],
    ["primary-ink", "danger", 4.5],
    ["danger-primary-ink", "danger", 4.5],
    ["danger-primary-ink", "danger-hover", 4.5],
    ["feedback-saving-ink", "feedback-saving-bg", 4.5],
    ["success", "feedback-saved-bg", 4.5],
    ["danger", "feedback-failed-bg", 4.5],
    ["page-ink", "page-bg", 4.5],
    ["panel-ink", "panel-bg", 4.5],
    ["panel-muted", "panel-bg", 4.5],
    ["assistant-ink", "assistant-bg", 4.5],
    ["user-bubble-ink", "user-bubble-bg", 4.5],
    ["composer-ink", "composer-bg", 4.5],
    ["control-ink", "control-bg", 4.5],
    ["primary-text", "primary-bg", 4.5],
    ["secondary-text", "secondary-bg", 4.5],
    ["code-ink", "code-bg", 4.5],
    ["code-block-ink", "code-block-bg", 4.5],
    ["link", "assistant-bg", 4.5],
    ["complete-ink", "complete-bg", 4.5],
    ["warning-ink", "warning-bg", 4.5],
    ["danger-ink", "danger-bg", 4.5],
  ];
  for (const theme of ["graphite-aurora", "museum-tech", "dark-glass"]) {
    const tokens = parseThemeTokens(stylesCss, theme);
    for (const [foregroundToken, backgroundToken, minimum] of requiredPairs) {
      const foreground = tokens[foregroundToken];
      const background = tokens[backgroundToken];
      if (!foreground || !background) {
        throw new Error(`${theme} theme is missing ${foregroundToken}/${backgroundToken} contrast tokens`);
      }
      const ratio = contrastRatio(foreground, background);
      if (ratio < minimum) {
        throw new Error(`${theme} theme ${foregroundToken} on ${backgroundToken} contrast ${ratio.toFixed(2)} is below ${minimum}`);
      }
    }
  }
}

async function reserveFallbackTestPort() {
  for (let port = 31000; port < 32000; port += 1) {
    const occupied = await tryReservePort(port);
    if (!occupied) continue;
    const next = await tryReservePort(port + 1);
    if (next) {
      await closeServer(next);
      return { server: occupied, port };
    }
    await closeServer(occupied);
  }
  throw new Error("Could not reserve a contiguous fallback port pair for the UI smoke test.");
}

async function writeFakeCodexBin(directory) {
  await fsp.mkdir(directory, { recursive: true });
  const cmdCodex = path.join(directory, "codex.cmd");
  const cmdClaude = path.join(directory, "claude.cmd");
  await fsp.writeFile(
    cmdCodex,
    "@echo off\r\nif \"%1\"==\"login\" if \"%2\"==\"status\" (echo Logged in& exit /b 0)\r\necho codex fake 0.0.0\r\n",
    "utf8"
  );
  await fsp.writeFile(
    cmdClaude,
    "@echo off\r\nif \"%1\"==\"auth\" if \"%2\"==\"status\" (echo Authenticated& exit /b 0)\r\necho claude fake 0.0.0\r\n",
    "utf8"
  );
  if (process.platform !== "win32") {
    const shellCodex = path.join(directory, "codex");
    const shellClaude = path.join(directory, "claude");
    await fsp.writeFile(
      shellCodex,
      "#!/bin/sh\nif [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then echo Logged in; exit 0; fi\necho codex fake 0.0.0\n",
      "utf8"
    );
    await fsp.writeFile(
      shellClaude,
      "#!/bin/sh\nif [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then echo Authenticated; exit 0; fi\necho claude fake 0.0.0\n",
      "utf8"
    );
    await fsp.chmod(shellCodex, 0o755);
    await fsp.chmod(shellClaude, 0o755);
    await fsp.chmod(cmdCodex, 0o755);
    await fsp.chmod(cmdClaude, 0o755);
  }
}

async function writeFakeAuthFailureBin(directory, backend) {
  await fsp.mkdir(directory, { recursive: true });
  const name = backend === "claude" ? "claude" : "codex";
  const cmd = path.join(directory, `${name}.cmd`);
  const authArgs = backend === "claude" ? 'if "%1"=="auth" if "%2"=="status"' : 'if "%1"=="login" if "%2"=="status"';
  await fsp.writeFile(cmd, `@echo off\r\n${authArgs} (echo Not authenticated& exit /b 1)\r\necho ${name} fake 0.0.0\r\n`, "utf8");
  if (process.platform !== "win32") {
    const shell = path.join(directory, name);
    const authTest = backend === "claude"
      ? '[ "$1" = "auth" ] && [ "$2" = "status" ]'
      : '[ "$1" = "login" ] && [ "$2" = "status" ]';
    await fsp.writeFile(shell, `#!/bin/sh\nif ${authTest}; then echo Not authenticated; exit 1; fi\necho ${name} fake 0.0.0\n`, "utf8");
    await fsp.chmod(shell, 0o755);
    await fsp.chmod(cmd, 0o755);
  }
}

async function writeFakeClaudePermissionBin(directory, modes) {
  await fsp.mkdir(directory, { recursive: true });
  const quotedModes = modes.map((mode) => `"${mode}"`).join(", ");
  const help = `Usage: claude [options]\n  --permission-mode <mode> Permission mode to use for the session (choices: ${quotedModes})\n`;
  const cmd = path.join(directory, "claude.cmd");
  await fsp.writeFile(
    cmd,
    [
      "@echo off",
      "if \"%1\"==\"auth\" if \"%2\"==\"status\" (echo Authenticated& exit /b 0)",
      "if \"%1\"==\"--help\" goto help",
      "echo claude fake 0.0.0",
      "exit /b 0",
      ":help",
      "echo Usage: claude [options]",
      `echo   --permission-mode ^<mode^> Permission mode to use for the session choices: ${quotedModes}`,
      "exit /b 0",
      "",
    ].join("\r\n"),
    "utf8"
  );
  if (process.platform !== "win32") {
    const shell = path.join(directory, "claude");
    await fsp.writeFile(
      shell,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then echo Authenticated; exit 0; fi",
        `if [ "$1" = "--help" ]; then printf '%s\\n' ${JSON.stringify(help)}; exit 0; fi`,
        "echo claude fake 0.0.0",
        "",
      ].join("\n"),
      "utf8"
    );
    await fsp.chmod(shell, 0o755);
    await fsp.chmod(cmd, 0o755);
  }
}

try {
  execFileSync("node", [cli, "init", projectDir], { cwd: root, stdio: "pipe" });
  execFileSync("node", [cli, "init", projectTwoDir], { cwd: root, stdio: "pipe" });
  const realProjectDir = await fsp.realpath(projectDir);
  await fsp.access(path.join(projectDir, "AGENTS.md"));
  await fsp.access(path.join(projectDir, "ui", "server.py"));
  await fsp.access(path.join(projectDir, ".co-auto-research", "project.json"));
  const projectMetadata = JSON.parse(await fsp.readFile(path.join(projectDir, ".co-auto-research", "project.json"), "utf8"));
  if (projectMetadata.displayName !== "project" || !projectMetadata.projectId) {
    throw new Error("project metadata was not initialized correctly");
  }
  const projectListOutput = execFileSync("node", [cli, "ls", "--projects-dir", tempRoot], { cwd: root, encoding: "utf8" });
  const projectListAliasOutput = execFileSync("node", [cli, "list", "--projects-dir", tempRoot], { cwd: root, encoding: "utf8" });
  if (
    !projectListOutput.includes("Found 2 CoAutoResearch projects") ||
    !projectListOutput.includes("project-two") ||
    !projectListOutput.includes("co-auto-research attach") ||
    !projectListAliasOutput.includes("project")
  ) {
    throw new Error(`project list output was not useful:\n${projectListOutput}`);
  }
  let ambiguousAttachOutput = "";
  let ambiguousAttachFailed = false;
  try {
    execFileSync("node", [cli, "attach", "--projects-dir", tempRoot], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    ambiguousAttachFailed = true;
    ambiguousAttachOutput = `${error.stdout || ""}${error.stderr || ""}`;
  }
  if (!ambiguousAttachFailed || !ambiguousAttachOutput.includes("Multiple CoAutoResearch projects found")) {
    throw new Error(`attach should ask the user to choose when several projects exist:\n${ambiguousAttachOutput}`);
  }
  const packageServerPath = path.join(root, "templates", "default", "ui", "server.py");
  const attachProbeOutput = execFileSync("node", [cli, "attach", "project", "--projects-dir", tempRoot, "--no-open"], {
    cwd: root,
    env: { ...process.env, COAUTO_PRINT_UI_INVOCATION: "1" },
    encoding: "utf8"
  }).trim();
  const attachProbe = JSON.parse(attachProbeOutput.split(/\r?\n/).at(-1));
  const attachProbeProjectRoot = await fsp.realpath(attachProbe.projectRoot);
  if (
    attachProbe.serverPath !== packageServerPath ||
    attachProbeProjectRoot !== realProjectDir ||
    attachProbe.usingPackageServer !== true
  ) {
    throw new Error(`attach should use the package-managed UI server for existing projects:\n${attachProbeOutput}`);
  }
  const projectUiProbeOutput = execFileSync("node", [cli, "ui", "--no-open"], {
    cwd: projectDir,
    env: { ...process.env, COAUTO_PRINT_UI_INVOCATION: "1" },
    encoding: "utf8"
  }).trim();
  const projectUiProbe = JSON.parse(projectUiProbeOutput.split(/\r?\n/).at(-1));
  const projectUiProbeProjectRoot = await fsp.realpath(projectUiProbe.projectRoot);
  if (
    projectUiProbe.serverPath !== packageServerPath ||
    projectUiProbeProjectRoot !== realProjectDir ||
    projectUiProbe.usingPackageServer !== true
  ) {
    throw new Error(`ui from a project directory should use the package-managed UI server:\n${projectUiProbeOutput}`);
  }
  const defaultDashboardRoot = path.join(tempRoot, "default-dashboard-root");
  await fsp.mkdir(defaultDashboardRoot, { recursive: true });
  const defaultDashboardProbeOutput = execFileSync("node", [cli, "ui", "--no-open"], {
    cwd: defaultDashboardRoot,
    env: { ...process.env, COAUTO_PRINT_UI_INVOCATION: "1" },
    encoding: "utf8"
  }).trim();
  const defaultDashboardProbe = JSON.parse(defaultDashboardProbeOutput.split(/\r?\n/).at(-1));
  const expectedDefaultProjectsDir = path.join(defaultDashboardRoot, "co-autoresearch-projects");
  const defaultProbeProjectsDir = await fsp.realpath(defaultDashboardProbe.projectsDir);
  if (
    defaultDashboardProbe.projectRoot !== "" ||
    defaultProbeProjectsDir !== await fsp.realpath(expectedDefaultProjectsDir)
  ) {
    throw new Error(`default dashboard should use co-autoresearch-projects:\n${defaultDashboardProbeOutput}`);
  }
  const legacyDashboardRoot = path.join(tempRoot, "legacy-dashboard-root");
  const legacyProjectDir = path.join(legacyDashboardRoot, "local-projects", "legacy-project");
  execFileSync("node", [cli, "init", legacyProjectDir], { cwd: root, stdio: "pipe" });
  const legacyListOutput = execFileSync("node", [cli, "ls"], {
    cwd: legacyDashboardRoot,
    encoding: "utf8"
  });
  if (!legacyListOutput.includes("legacy-project")) {
    throw new Error(`ls should still discover legacy local-projects folders:\n${legacyListOutput}`);
  }
  const manifest = JSON.parse(await fsp.readFile(path.join(projectDir, ".co-auto-research-template", "manifest.json"), "utf8"));
  if (manifest.templateVersion !== "0.1.0") {
    throw new Error(`unexpected template version ${manifest.templateVersion}`);
  }
  const reviewerMetadataPath = path.join(projectDir, "instructions", ".co-auto-research-instructions.json");
  const reviewerMetadata = JSON.parse(await fsp.readFile(reviewerMetadataPath, "utf8"));
  if (reviewerMetadata.reviewerBaselineVersion !== "2026-06-publication-ready-tables") {
    throw new Error("new projects should record the reviewer baseline");
  }
  const staleReviewerFixtureRoot = path.join(tempRoot, "upgrade-fixtures");
  await fsp.mkdir(staleReviewerFixtureRoot, { recursive: true });
  const staleReviewerProject = path.join(staleReviewerFixtureRoot, "stale-reviewers");
  execFileSync("node", [cli, "init", staleReviewerProject], { cwd: root, stdio: "pipe" });
  const staleTrial = path.join(staleReviewerProject, "research_trajectory", "trials", "000001_legacy_review_split");
  await fsp.mkdir(path.join(staleTrial, "artifacts"), { recursive: true });
  await fsp.writeFile(path.join(staleTrial, "PLAN.md"), "# Plan\n\nLegacy split fixture.\n", "utf8");
  await fsp.writeFile(path.join(staleTrial, "REPORT.md"), "# Report\n\nLegacy split fixture.\n", "utf8");
  await fsp.writeFile(path.join(staleTrial, "REVIEW.md"), `# Review

## Plan Review

Reviewer: Plan reviewer
Scope: plan
Decision: pass
Gate impact: pass
Confidence: high

## Blocking Issues

- none

## Required Actions Before Pass

- none

## Qualified / Partial Passes

- none

## Unassessed Areas

- none

## Evidence Review

Reviewer: Evidence reviewer
Scope: evidence
Decision: continue
Gate impact: continue
Confidence: medium

## Blocking Issues

- source audit remains incomplete

## Required Actions Before Pass

- complete the source audit

## Qualified / Partial Passes

- none

## Unassessed Areas

- source-level provenance
`, "utf8");
  const customReviewer = path.join(staleReviewerProject, "instructions", "reviewers", "CUSTOM_REVIEWER.md");
  await fsp.writeFile(customReviewer, "# Custom Reviewer\n", "utf8");
  await fsp.rm(path.join(staleReviewerProject, "instructions", "reviewers", "FINAL_GATE_REVIEWER.md"));
  await fsp.rm(path.join(staleReviewerProject, "instructions", ".co-auto-research-instructions.json"));
  const dryRunUpgrade = execFileSync("node", [cli, "upgrade-project", staleReviewerProject, "--dry-run"], { cwd: root, encoding: "utf8" });
  if (!dryRunUpgrade.includes("would sync core reviewers")) {
    throw new Error(`upgrade-project --dry-run should report planned reviewer sync:\n${dryRunUpgrade}`);
  }
  const reviewerUpgradeOutput = execFileSync("node", [cli, "upgrade-project", staleReviewerProject], { cwd: root, encoding: "utf8" });
  if (!reviewerUpgradeOutput.includes("synced 9 core reviewers")) {
    throw new Error(`upgrade-project should sync core reviewers:\n${reviewerUpgradeOutput}`);
  }
  const upgradedMetadata = JSON.parse(await fsp.readFile(path.join(staleReviewerProject, "instructions", ".co-auto-research-instructions.json"), "utf8"));
  if (upgradedMetadata.reviewerBaselineVersion !== "2026-06-publication-ready-tables" || upgradedMetadata.reviewStorageVersion !== "per-reviewer-files-v1") {
    throw new Error("upgrade-project should write reviewer baseline metadata");
  }
  try {
    await fsp.access(customReviewer);
  } catch {
    throw new Error("upgrade-project should preserve custom extra reviewers");
  }
  const migrationDirs = await fsp.readdir(path.join(staleReviewerProject, "archive", "template_migrations"));
  if (!migrationDirs.length) {
    throw new Error("upgrade-project should create a template migration backup");
  }
  const splitPlanReview = await fsp.readFile(path.join(staleTrial, "reviews", "PLAN_REVIEW.md"), "utf8");
  const splitEvidenceReview = await fsp.readFile(path.join(staleTrial, "reviews", "EVIDENCE_REVIEW.md"), "utf8");
  if (!splitPlanReview.includes("Migration source:") || !splitPlanReview.includes("Decision: pass")) {
    throw new Error("upgrade-project should split legacy plan review sections into per-reviewer files");
  }
  if (!splitEvidenceReview.includes("Decision: continue") || !splitEvidenceReview.includes("source audit remains incomplete")) {
    throw new Error("upgrade-project should preserve legacy evidence review status when splitting");
  }
  const latestMigrationDir = migrationDirs.sort().at(-1);
  await fsp.access(path.join(staleReviewerProject, "archive", "template_migrations", latestMigrationDir, "review_storage_backups", "research_trajectory", "trials", "000001_legacy_review_split", "REVIEW.md"));
  const packageManifest = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8"));
  const resourceIntakeInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "RESOURCE_INTAKE.md"), "utf8");
  const conversionInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "CONVERSION.md"), "utf8");
  const executionInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "EXECUTION_AGENT.md"), "utf8");
  const resourceManifestTemplate = await fsp.readFile(path.join(root, "templates", "default", "resources", "user_input", "RESOURCE_MANIFEST.md"), "utf8");
  const literatureReadme = await fsp.readFile(path.join(root, "templates", "default", "resources", "literature", "README.md"), "utf8");
  if (
    !resourceIntakeInstructions.includes("## Embedded Resource Scan") ||
    !resourceIntakeInstructions.includes("A general bibliography embedded in an ongoing manuscript is not automatically a target-venue seed-paper set") ||
    !resourceIntakeInstructions.includes("resources/user_input/attachments/") ||
    !conversionInstructions.includes("Do not interpret an empty `resources/target_venue/papers/` folder as proof that no literature exists") ||
    !executionInstructions.includes("A manuscript `references.bib` or bibliography inside `resources/ongoing_work/` is literature grounding") ||
    !resourceManifestTemplate.includes("## Embedded Resource Surfacing") ||
    !literatureReadme.includes("surface them here")
  ) {
    throw new Error("resource intake must surface embedded ongoing-work bibliographies without confusing them with target-venue seed papers");
  }
  const indexHtml = await fsp.readFile(path.join(root, "templates", "default", "ui", "index.html"), "utf8");
  const readme = await fsp.readFile(path.join(root, "README.md"), "utf8");
  const docsConfig = await fsp.readFile(path.join(root, "docs", "conf.py"), "utf8");
  const docsRequirements = await fsp.readFile(path.join(root, "docs", "requirements.txt"), "utf8");
  const docsIndex = await fsp.readFile(path.join(root, "docs", "index.md"), "utf8");
  const remoteDocs = await fsp.readFile(path.join(root, "docs", "remote-server.md"), "utf8");
  const gettingStartedDocs = await fsp.readFile(path.join(root, "docs", "getting-started.md"), "utf8");
  const cliDocs = await fsp.readFile(path.join(root, "docs", "cli.md"), "utf8");
  const contributingDocs = await fsp.readFile(path.join(root, "CONTRIBUTING.md"), "utf8");
  const upgradingDocs = await fsp.readFile(path.join(root, "docs", "upgrading.md"), "utf8");
  const pagesWorkflow = await fsp.readFile(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
  const ciWorkflow = await fsp.readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const cliSource = await fsp.readFile(path.join(root, "bin", "auto-research.js"), "utf8");
  const helpOutput = execFileSync("node", [cli, "help"], { cwd: root, encoding: "utf8" });
  if (
    !helpOutput.includes("[--remote]") ||
    !cliSource.includes("function printRemoteAccessHint") ||
    !cliSource.includes("ssh -N -L") ||
    !cliSource.includes("user}@<ssh-host>") ||
    cliSource.includes("os.hostname") ||
    !cliSource.includes("Remote mode enabled") ||
    !readme.includes("co-auto-research ui --remote") ||
    !remoteDocs.includes("co-auto-research ui --remote") ||
    !remoteDocs.includes("user@<ssh-host>") ||
    !remoteDocs.includes("COAUTO_REMOTE_TARGET=user@host") ||
    !docsIndex.includes("```{toctree}") ||
    !docsIndex.includes("Welcome to CoAutoResearch's documentation") ||
    !docsConfig.includes('html_theme = "sphinx_rtd_theme"') ||
    !docsConfig.includes('"sphinxcontrib.mermaid"') ||
    !docsConfig.includes('html_baseurl = "https://yihongt.github.io/CoAutoResearch/"') ||
    !docsRequirements.includes("sphinx-rtd-theme") ||
    !docsRequirements.includes("myst-parser") ||
    !docsRequirements.includes("sphinxcontrib-mermaid") ||
    !pagesWorkflow.includes("sphinx-build -b html docs ./_site") ||
    !ciWorkflow.includes("ubuntu-latest") ||
    !ciWorkflow.includes("macos-latest") ||
    !ciWorkflow.includes("windows-latest") ||
    !ciWorkflow.includes("npm test") ||
    !ciWorkflow.includes("npm pack --dry-run") ||
    pagesWorkflow.includes("jekyll-build-pages") ||
    pagesWorkflow.includes("ENABLE_PRIVATE_PAGES") ||
    packageManifest.name !== "co-auto-research" ||
    packageManifest.repository?.url !== "git+https://github.com/YihongT/CoAutoResearch.git" ||
    packageManifest.homepage !== "https://yihongt.github.io/CoAutoResearch/" ||
    packageManifest.publishConfig?.access !== "public" ||
    !packageManifest.packageManager?.startsWith("npm@") ||
    !pagesWorkflow.includes("sphinx-build -b html docs ./_site") ||
    !readme.includes("npm install -g co-auto-research") ||
    !docsIndex.includes("npm install -g co-auto-research") ||
    !gettingStartedDocs.includes("npm install -g co-auto-research") ||
    !cliDocs.includes("npm install -g co-auto-research") ||
    !readme.includes("npm install -g co-auto-research@latest") ||
    !docsIndex.includes("npm install -g co-auto-research@latest") ||
    !gettingStartedDocs.includes("npm install -g co-auto-research@latest") ||
    !cliDocs.includes("npm install -g co-auto-research@latest") ||
    readme.includes("git clone https://github.com/YihongT/CoAutoResearch.git") ||
    docsIndex.includes("git clone https://github.com/YihongT/CoAutoResearch.git") ||
    gettingStartedDocs.includes("git clone https://github.com/YihongT/CoAutoResearch.git") ||
    cliDocs.includes("git clone https://github.com/YihongT/CoAutoResearch.git") ||
    !gettingStartedDocs.includes("co-auto-research upgrade") ||
    !contributingDocs.includes("npm publish --provenance") ||
    !contributingDocs.includes("git clone https://github.com/YihongT/CoAutoResearch.git") ||
    !contributingDocs.includes("npm link") ||
    !contributingDocs.includes("npm install -g co-auto-research@latest") ||
    readme.includes("node bin/auto-research.js ui") ||
    gettingStartedDocs.includes("node bin/auto-research.js ui") ||
    !gettingStartedDocs.includes("co-auto-research ui") ||
    !cliDocs.includes("COAUTO_REMOTE_TARGET") ||
    !helpOutput.includes("co-auto-research attach") ||
    !readme.includes("co-auto-research attach my-project") ||
    !cliDocs.includes("Return to Existing Work") ||
    readme.includes("npm run pack:dry-run") ||
    readme.includes("## Development") ||
    readme.includes("GitHub Pages") ||
    docsIndex.includes("GitHub Pages") ||
    gettingStartedDocs.includes("ignored by this repository") ||
    upgradingDocs.includes("Future automated upgrades should") ||
    readme.includes("docs/hosting-docs.md") ||
    docsIndex.includes("hosting-docs")
  ) {
    throw new Error("CLI and public docs must explain remote browser access through the product docs template without hosting-instruction pages");
  }
  const releaseWorkflow = await fsp.readFile(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  if (
    !releaseWorkflow.includes('node-version: "24"') ||
    !releaseWorkflow.includes("npm pack --dry-run") ||
    !releaseWorkflow.includes("npm publish --provenance --access public") ||
    releaseWorkflow.includes("npm-dry-run")
  ) {
    throw new Error("release workflow must publish the npm package with provenance after tests and package dry run");
  }
  if (!/<nav class="rail-nav"[^>]*hidden/.test(indexHtml)) {
    throw new Error("current project navigation must be hidden before a project is active");
  }
  const stylesCss = await fsp.readFile(path.join(root, "templates", "default", "ui", "styles.css"), "utf8");
  if (!stylesCss.includes(".rail-nav[hidden]")) {
    throw new Error("rail navigation hidden state must not be overridden by display styles");
  }
  if (
    !stylesCss.includes("--framing-column-width: 900px") ||
    !stylesCss.includes(".brief-editor-shell.is-framing-dock") ||
    !stylesCss.includes(".framing-message.user") ||
    !stylesCss.includes("justify-self: center !important")
  ) {
    throw new Error("framing composer and CoAutoResearch returns must share a centered column");
  }
  if (
    !indexHtml.includes("20260620-story-map1") ||
    !stylesCss.includes("Reader typography: match the composer text across content surfaces.") ||
    !stylesCss.includes(".framing-message .transcript-body") ||
    !stylesCss.includes("font-family: var(--reader);")
  ) {
    throw new Error("content typography must use the same reader font as the composer");
  }
  const appJs = await fsp.readFile(path.join(root, "templates", "default", "ui", "app.js"), "utf8");
  const serverPy = await fsp.readFile(path.join(root, "templates", "default", "ui", "server.py"), "utf8");
  const blueprintTemplate = await fsp.readFile(path.join(root, "templates", "default", "manuscript", "BLUEPRINT.md"), "utf8");
  const manuscriptInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "MANUSCRIPT.md"), "utf8");
  const figureTableReviewer = await fsp.readFile(path.join(root, "templates", "default", "instructions", "reviewers", "FIGURE_TABLE_REVIEWER.md"), "utf8");
  const finalGateReviewer = await fsp.readFile(path.join(root, "templates", "default", "instructions", "reviewers", "FINAL_GATE_REVIEWER.md"), "utf8");
  const themeOptionValues = [...indexHtml.matchAll(/name="themeMode"\s+value="([^"]+)"/g)].map((match) => match[1]);
  const explicitThemeBlocks = [...stylesCss.matchAll(/html\[data-theme="([^"]+)"\]/g)].map((match) => match[1]);
  const expectedThemes = ["graphite-aurora", "museum-tech", "dark-glass"];
  if (
    themeOptionValues.length !== expectedThemes.length ||
    !expectedThemes.every((theme) => themeOptionValues.includes(theme)) ||
    !expectedThemes.every((theme) => explicitThemeBlocks.includes(theme)) ||
    !indexHtml.includes('document.documentElement.dataset.theme = allowedThemes.has(stored) ? stored : "graphite-aurora"') ||
    !appJs.includes('localStorage.getItem("coAutoResearchTheme")') ||
    !appJs.includes('localStorage.setItem("coAutoResearchTheme", mode)') ||
    !appJs.includes("function applyThemeMode") ||
    !appJs.includes('const defaultThemeMode = "graphite-aurora"') ||
    !appJs.includes('new Set([defaultThemeMode, "museum-tech", "dark-glass"])') ||
    !appJs.includes('$$("[data-theme-option]")') ||
    !stylesCss.includes(".theme-mode-control") ||
    !readme.includes("Graphite Aurora, Museum Tech, and Dark Glass") ||
    !gettingStartedDocs.includes("Graphite Aurora, Museum Tech, and Dark Glass") ||
    !cliDocs.includes("Graphite Aurora, Museum Tech, and Dark Glass")
  ) {
    throw new Error("settings must expose the persisted dashboard themes");
  }
  const loadSettingsStart = appJs.indexOf("async function loadUiSettings");
  const loadSettingsEnd = appJs.indexOf("async function saveUiSettings", loadSettingsStart);
  const loadSettingsBody = loadSettingsStart >= 0 && loadSettingsEnd > loadSettingsStart
    ? appJs.slice(loadSettingsStart, loadSettingsEnd)
    : "";
  if (
    !appJs.includes("function scopedJsonGet") ||
    !appJs.includes("function scopedSessionSettings") ||
    !appJs.includes("function mergedProjectSessionSettings") ||
    !appJs.includes("function persistSessionSettings") ||
    !appJs.includes('scopedGet("autoResearchComposerDraft", "", { legacyFallback: false })') ||
    !appJs.includes('scopedGet("autoResearchTargetVenue", "", { legacyFallback: false })') ||
    !appJs.includes('scopedSet("autoResearchTargetVenue", event.target.value || "")') ||
    !appJs.includes('scopedSet("autoResearchSessionSettings", JSON.stringify(sessionSettingsForStorage(settings)))') ||
    !loadSettingsBody.includes("hydrateSettingsDialog(uiSettings);") ||
    !loadSettingsBody.includes("restoreSessionSettings();") ||
    loadSettingsBody.includes("applySessionSettings(")
  ) {
    throw new Error("project-scoped UI persistence must keep drafts/settings in scoped storage and keep loadUiSettings from overwriting browser overrides");
  }
  assertThemeContrast(stylesCss);
  if (
    !serverPy.includes('{"text", "project", "goal-launch", "command"}') ||
    !serverPy.includes('clean["text"] = f"Attached {count}') ||
    !serverPy.includes('display_message = "Attached resources."')
  ) {
    throw new Error("server must preserve goal-launch messages and keep attachment-only chat turns visible");
  }
  if (
    !serverPy.includes("def chat_research_prompt") ||
    !serverPy.includes("This is not an autoresearch launch") ||
    !serverPy.includes("CHAT_PROTECTED_PATHS") ||
    !serverPy.includes("create_chat_protected_snapshot() if mode == \"chat\" else None") ||
    !serverPy.includes("restore_chat_protected_snapshot") ||
    !serverPy.includes("Chat mode guard restored protected autoresearch artifacts") ||
    !serverPy.includes("read_trajectory_state() if chat_guard_active else sync_trajectory_state(\"snapshot\")")
  ) {
    throw new Error("chat mode must not be able to create or sync autoresearch trial artifacts");
  }
  if (
    !indexHtml.includes('id="composer-attach-button"') ||
    !indexHtml.includes('id="composer-file-input"') ||
    !indexHtml.includes('type="file" multiple hidden') ||
    !indexHtml.includes("Browse or drop resources") ||
    !appJs.includes('$("#composer-attach-button")?.addEventListener("click"') ||
    !appJs.includes('$("#composer-file-input")?.addEventListener("change"') ||
    !appJs.includes("function openComposerFilePicker") ||
    !appJs.includes("const MAX_BROWSER_UPLOAD_BYTES = 50 * 1024 * 1024") ||
    !appJs.includes("size > MAX_BROWSER_UPLOAD_BYTES") ||
    !appJs.includes("Copy it into project resources before sending.") ||
    !appJs.includes("function chooseMaterialType") ||
    !appJs.includes("showResourceBrowser();") ||
    !appJs.includes('addFilesFromList(event.target.files, "file picker", { category })') ||
    !appJs.includes('user_input: "User input"') ||
    !serverPy.includes('"user_input": "resources/user_input/attachments"') ||
    !stylesCss.includes(".composer-attach-button") ||
    !stylesCss.includes(".composer-file-input") ||
    !readme.includes("composer `+` button") ||
    !readme.includes("resources/user_input/attachments/") ||
    !gettingStartedDocs.includes("resources/user_input/attachments/") ||
    !gettingStartedDocs.includes("resources/user_input/RESOURCE_MANIFEST.md")
  ) {
    throw new Error("composer must expose a local file attach button and document project-local attachment storage");
  }
  if (
    !appJs.includes("function uploadTooLargeMessage") ||
    !appJs.includes("function queueLargeResourceImport") ||
    !appJs.includes("function confirmLargeResourceImport") ||
    !appJs.includes("hasBlockingResourceImports()") ||
    !serverPy.includes("/api/resource-import/start") ||
    !serverPy.includes("/api/resource-import/chunk") ||
    !serverPy.includes("def start_resource_import") ||
    !serverPy.includes("def write_resource_import_chunk") ||
    !serverPy.includes("alreadyImported") ||
    !appJs.includes("const accepted = results.filter((result) => result?.accepted).length") ||
    !appJs.includes("return accepted;") ||
    appJs.includes("showToast(`${list.length} ${list.length === 1 ? \"file\" : \"files\"} attached from ${source}.`)") ||
    !stylesCss.includes(".brief-editor-shell.is-framing-dock .attachment-tray[hidden]") ||
    !stylesCss.includes(".brief-editor-shell.is-framing-dock .attachment-chip") ||
    !stylesCss.includes(".attachment-progress")
  ) {
    throw new Error("composer attachments must show accepted files and route large drops through resource-copy flow");
  }
  if (
    !serverPy.includes("WinError 10013") ||
    !serverPy.includes("isinstance(exc, PermissionError)") ||
    !serverPy.includes('getattr(exc, "winerror", None) == 10013')
  ) {
    throw new Error("UI server port fallback must treat Windows WinError 10013 as an unavailable port");
  }
  if (!appJs.includes("maybeOpenInitialProjectDialog") || !appJs.includes("Create a project first.")) {
    throw new Error("empty dashboard must auto-open project creation and block composer submission");
  }
  if (
    appJs.includes('nextMessages.push(normalizeFramingMessage({ role: "user", text: brief }))') ||
    !appJs.includes("isHiddenUiTranscript") ||
    !appJs.includes("record: false") ||
    !appJs.includes('event.key === "Enter" && (event.metaKey || event.ctrlKey)')
  ) {
    throw new Error("autosaved brief/file edits must not render as sent chat messages");
  }
  if (
    appJs.includes("hasOnlyOrphanLocalUserMessage") ||
    !appJs.includes("mergePendingLocalFramingMessages") ||
    !appJs.includes("recoveredFramingMessagesFromSession") ||
    !appJs.includes("isFramingThreadUserTranscript") ||
    !appJs.includes('["ui.framing", "ui.chat"].includes(rawType)') ||
    !appJs.includes("editedTranscriptCutWindows") ||
    !appJs.includes("message.edited_at = new Date().toISOString()") ||
    !appJs.includes("framingReplyPending = true") ||
    !appJs.includes("latestUnansweredUserMessage") ||
    !appJs.includes("const inferredReplyPending = Boolean(unansweredUser && (framingReplyPending || framingMessagesPersisting || isSessionRunning()))") ||
    appJs.includes("framingReplyPending && !isSessionRunning() && !framingDraftPending") ||
    !appJs.includes("isSessionRunning() || framingDraftPending || framingReplyPending ? 1000 : 3500") ||
    !appJs.includes("framingMessagesPersisting || framingDraftPending || framingReplyPending || isSessionRunning()") ||
    !appJs.includes("attachmentOnlyMessage(attachments)") ||
    !appJs.includes("clearFramingComposerText(text || displayText)") ||
    !appJs.includes("const files = await collectUploadFiles()") ||
    !appJs.includes("framingMessagesPersisting") ||
    !appJs.includes("await persistFramingMessages();") ||
    !appJs.includes("transcriptReplyWindows") ||
    !appJs.includes("const runStarts = transcript") ||
    !appJs.includes("transcriptRunStart(entry)") ||
    !appJs.includes("if (!isFramingThreadUserTranscript(entry)) return []") ||
    !appJs.includes("pruneNonFinalRecoveredAssistantMessages") ||
    !appJs.includes("staleTexts") ||
    !appJs.includes("completed && candidates.length ? candidates[candidates.length - 1] : null") ||
    !appJs.includes("FRAMING_MESSAGES_CLIENT_VERSION")
  ) {
    throw new Error("first user framing message must survive stale overview snapshots");
  }
  const sendSessionStart = appJs.indexOf("async function sendSessionComposerMessage");
  const sendAppendIndex = appJs.indexOf('appendFramingMessage("user", displayText', sendSessionStart);
  const sendClearIndex = appJs.indexOf("clearFramingComposerText(text || displayText)", sendSessionStart);
  const sendCollectIndex = appJs.indexOf("const files = await collectUploadFiles()", sendSessionStart);
  if (!(sendSessionStart >= 0 && sendAppendIndex > sendSessionStart && sendClearIndex > sendAppendIndex && sendCollectIndex > sendClearIndex)) {
    throw new Error("session composer must render the sent message and clear input before collecting uploads or posting");
  }
  const launchStart = appJs.indexOf("async function launchAutoresearch");
  const launchCloseIndex = appJs.indexOf('$("#launch-dialog")?.close();', launchStart);
  const launchPersistIndex = appJs.indexOf("await persistFramingMessages();", launchStart);
  const launchApiIndex = appJs.indexOf('api("/api/research/cold-start"', launchStart);
  if (!(launchStart >= 0 && launchCloseIndex > launchStart && launchPersistIndex > launchCloseIndex && launchApiIndex > launchCloseIndex)) {
    throw new Error("launch dialog must close immediately after local /goal pending UI is rendered");
  }
  if (
    !indexHtml.includes('id="launch-instruction"') ||
    !indexHtml.includes("Optional launch instruction") ||
    !appJs.includes('const launchInstruction = String($("#launch-instruction")?.value || "").trim()') ||
    !appJs.includes("launchInstruction, fileEdits") ||
    !serverPy.includes("def autoresearch_goal_prompt(launch_instruction") ||
    !serverPy.includes("Additional user instruction for this launch") ||
    !serverPy.includes('autoresearch_goal_prompt(str(payload.get("launchInstruction", ""))[:4000], bool(settings.get("fastMode")))')
  ) {
    throw new Error("launch dialog must support an optional one-run autoresearch instruction");
  }
  if (
    !indexHtml.includes('name="fastMode"') ||
    !indexHtml.includes("Fast mode") ||
    !appJs.includes("fastMode: Boolean(data.get(\"fastMode\"))") ||
    !appJs.includes("if (normalized.fastMode) parts.push(\"fast\")") ||
    !serverPy.includes('"fastMode": False') ||
    !serverPy.includes("def fast_mode_prompt_section") ||
    !serverPy.includes("Fast mode is enabled for this autoresearch loop")
  ) {
    throw new Error("launch dialog must expose a Fast mode setting and pass it into autoresearch prompts");
  }
  if (
    !appJs.includes("let optimisticResearchSession = null") ||
    !appJs.includes("function startOptimisticAutoresearchSession") ||
    !appJs.includes("Starting autoresearch on Trial") ||
    !appJs.includes("if (optimisticResearchSession) return optimisticResearchSession") ||
    !appJs.includes("startOptimisticAutoresearchSession(settings)") ||
    !appJs.includes("clearOptimisticAutoresearchSession(previousSession)")
  ) {
    throw new Error("launching autoresearch must show immediate optimistic running feedback");
  }
  if (
    !appJs.includes("markdownLinkHtml") ||
    !appJs.includes('transcriptContentHtml(message.text, { markdown: role === "assistant" })') ||
    !stylesCss.includes(".markdown-file-link") ||
    !indexHtml.includes("20260620-story-map1")
  ) {
    throw new Error("Codex assistant responses must render Markdown in framing chat");
  }
  if (
    !serverPy.includes('"active_run": active_run') ||
    !serverPy.includes('"trial_iteration": active_trial_iteration if active_trial_iteration > 0 else None') ||
    !appJs.includes("function activeRun()") ||
    !appJs.includes("function activeRunTrialIteration()") ||
    !appJs.includes("function isAutoresearchActiveRun()") ||
    !appJs.includes("const activeTrial = liveIteration || selectedTrial(trials)") ||
    !appJs.includes("const countLabel = `${trials.length} trial") ||
    !appJs.includes("reportedCount ? ` · ${reportedCount} reported`") ||
    appJs.includes("const activeTrial = selectedTrial(reports)") ||
    !appJs.includes('reportStatus === "reported" ? "Done"') ||
    !appJs.includes("Report pending") ||
    !appJs.includes("Report is not available yet. Agent activity for this trial is shown below.") ||
    !appJs.includes("function isGoalPassed()") ||
    !appJs.includes("function isTrialLive(iteration)") ||
    !(appJs.includes("const liveIteration = isLiveGoalSession() ? activeRunTrialIteration() : 0") || appJs.includes("const liveIteration = activeRunTrialIteration();")) ||
    !appJs.includes("const fallback = currentTrialIndex(trials);") ||
    !appJs.includes("function runningTrialStatusHtml") ||
    !appJs.includes("activeRunStatusLabel()") ||
    !appJs.includes("workingDurationHtml()") ||
    !appJs.includes("function activeTrialHistoryHtml()") ||
    !appJs.includes("function scheduleWorkingTicker()") ||
    !appJs.includes("trial-live-status") ||
    !appJs.includes("Live trial activity") ||
    !appJs.includes("data-pause-autoresearch") ||
    !appJs.includes("Pause after current turn") ||
    !appJs.includes("data-stop-current-run") ||
    !appJs.includes("Stop current run") ||
    !appJs.includes("trial-live-status-actions") ||
    !stylesCss.includes(".current-run-control-button") ||
    !stylesCss.includes(".trial-live-status") ||
    !stylesCss.includes(".trial-live-status-actions") ||
    appJs.includes("const liveIteration = isLiveGoalSession() ? Number(sessionState().loop_iteration || 0) : 0") ||
    appJs.includes("isSessionRunning() && hasGoalStarted() ? Number(sessionState().loop_iteration || 0) : 0") ||
    appJs.includes("const running = isSessionRunning() && Number(sessionState().loop_iteration || 0) === Number(iteration)")
  ) {
    throw new Error("trial history must show live status only for truly active, unreported trials");
  }
  if (
    !appJs.includes("function isSessionInterrupted()") ||
    !appJs.includes('addChip("Resume autoresearch", "/goal resume");') ||
    !appJs.includes('"Gate incomplete"') ||
    !appJs.includes('interrupted ? "Goal interrupted"')
  ) {
    throw new Error("interrupted goal sessions must show resume controls instead of pause controls");
  }
  if (
    !indexHtml.includes("app.js?v=20260620-story-map1") ||
    !appJs.includes('const allowedKinds = new Set(["text", "project", "goal-launch", "command"])') ||
    !appJs.includes('appendFramingMessage("user", displayText, { kind: "command" })') ||
    !appJs.includes('beginFramingPending(appendedMessage?.id || "");') ||
    !appJs.includes("function framingControlMessageHtml(message)") ||
    !appJs.includes("function controlMessageDisplay(message") ||
    !appJs.includes("const localSlashCommandRegistry = {") ||
    !appJs.includes('return { label: "Autoresearch", value: "Start autoresearch" }') ||
    !appJs.includes('"/goal resume": { label: "Autoresearch", value: "Resume autoresearch"') ||
    !appJs.includes('"/goal restart": { label: "Autoresearch", value: "Restart autoresearch"') ||
    !indexHtml.includes(">Start autoresearch<") ||
    !indexHtml.includes(">Resume autoresearch<") ||
    !indexHtml.includes(">Show autoresearch<") ||
    !indexHtml.includes(">Pause after current turn<") ||
    !indexHtml.includes(">Stop current run<") ||
    !indexHtml.includes(">Pause autoresearch<") ||
    !indexHtml.includes(">Restart autoresearch<") ||
    />\/goal(?:\s+\w+)?<\/button>/.test(indexHtml) ||
    appJs.includes("Start with /goal") ||
    appJs.includes("Start /goal") ||
    appJs.includes("Continue /goal") ||
    appJs.includes("Show /goal") ||
    appJs.includes("Pause /goal") ||
    appJs.includes("Resume /goal") ||
    indexHtml.includes("Start with /goal") ||
    indexHtml.includes("Start /goal") ||
    indexHtml.includes("Continue /goal") ||
    indexHtml.includes("Show /goal") ||
    indexHtml.includes("Pause /goal") ||
    indexHtml.includes("Resume /goal") ||
    appJs.includes("Autoresearch control") ||
    !appJs.includes("if (isControlFramingMessage(message)) return framingControlMessageHtml(message);") ||
    !appJs.includes("function isControlFramingMessage(message)") ||
    !appJs.includes("if (isControlFramingMessage(message)) continue;") ||
    !appJs.includes("if (appendedMessage) await persistFramingMessages();") ||
    !appJs.includes("function hasNoChatFormContent(message)") ||
    !appJs.includes("return !selectedResumeTrialPayload();") ||
    !stylesCss.includes(".framing-message.control") ||
    !stylesCss.includes(".framing-control-pill")
  ) {
    throw new Error("slash commands sent from the composer must render as visible control rows and immediate pending feedback");
  }
  const controlBlock = stylesCss.match(/\.framing-message\.control\s*\{[^}]*\}/)?.[0] || "";
  const controlPillBlock = stylesCss.match(/\.framing-control-pill\s*\{[^}]*\}/)?.[0] || "";
  if (
    !controlBlock.includes("justify-self: center;") ||
    !controlBlock.includes("justify-content: center;") ||
    !controlPillBlock.includes("justify-content: center;")
  ) {
    throw new Error("slash command control rows must be centered in the framing column with centered pill contents");
  }
  const commandAppendIndex = appJs.indexOf('appendFramingMessage("user", displayText, { kind: "command" })', sendSessionStart);
  const commandPendingIndex = appJs.indexOf('beginFramingPending(appendedMessage?.id || "");', commandAppendIndex);
  const commandRenderIndex = appJs.indexOf("renderFramingConversation();", commandAppendIndex);
  if (!(commandAppendIndex > sendSessionStart && commandPendingIndex > commandAppendIndex && commandPendingIndex < commandRenderIndex)) {
    throw new Error("slash command pending state must start before the command row is rendered");
  }
  if (
    !indexHtml.includes("styles.css?v=20260620-story-map1") ||
    !appJs.includes("function currentProgressStartTime(transcript)") ||
    !appJs.includes("const latestRunStart = transcript.reduce") ||
    !appJs.includes("function framingProgressDetailsHtml()") ||
    !appJs.includes('details class="framing-progress-details"') ||
    appJs.includes("${framingProgressHtml()}") ||
    !stylesCss.includes(".framing-progress-details > summary") ||
    !stylesCss.includes(".framing-progress-details[open] > summary::before")
  ) {
    throw new Error("running Codex progress must be scoped to the current run and collapsed by default");
  }
  if (
    !appJs.includes("buildFramingActivityByMessage") ||
    !appJs.includes("transcriptRunGroups") ||
    !appJs.includes("inlineRunActivityHtml") ||
    !appJs.includes("Worked for") ||
    !appJs.includes("htmlBeforeMessageId") ||
    !appJs.includes("entry === finalEntry") ||
    !appJs.includes("messageText === finalText") ||
    !appJs.includes("omitLocal: true") ||
    !appJs.includes("omittedEntryIds") ||
    !stylesCss.includes(".framing-run-activity")
  ) {
    throw new Error("Codex activity must render as a folded Worked row before its corresponding framing response");
  }
  if (
    appJs.includes("Codex framing activity") ||
    appJs.includes("localSessionActivityHtml") ||
    appJs.includes("Current session activity") ||
    appJs.includes("Latest session activity") ||
    appJs.includes("currentRunActivityHtml") ||
    stylesCss.includes(".current-run-card")
  ) {
    throw new Error("framing/chat Codex events must render as Worked rows or trial activity, not separate current-session cards");
  }
  if (
    appJs.includes("canLaunchAutoresearchFromAssistant") ||
    appJs.includes("latestAssistantTextMessage") ||
    !appJs.includes("function projectDraftCardHtml") ||
    !appJs.includes("data-project-launch>Start autoresearch</button>") ||
    !appJs.includes("fullscreenButtonHtml(\"PROJECT.md\")")
  ) {
    throw new Error("PROJECT.md draft card must own launch and fullscreen actions");
  }
  if (
    !appJs.includes("Open latest manuscript") ||
    !appJs.includes('data-inline-fullscreen="manuscript/BLUEPRINT.md"') ||
    !appJs.includes("Raw BLUEPRINT.md for editing and audit.") ||
    !appJs.includes("function composerPromptNextValue") ||
    !appJs.includes("function isComposerCommandLine") ||
    !appJs.includes("if (lines.some((line) => line.trim() === promptText)) return current;") ||
    appJs.includes("editor.value = current ? `${current}\\n${text}` : text;")
  ) {
    throw new Error("UI must expose the latest manuscript and make quick prompt insertion idempotent");
  }
  if (
    !indexHtml.includes("data-file-viewer-resize") ||
    !indexHtml.includes('data-file-viewer-resize="right"') ||
    !indexHtml.includes('data-file-viewer-resize="bottom"') ||
    !indexHtml.includes('data-file-viewer-resize="corner"') ||
    !indexHtml.includes("data-file-viewer-return=\"manuscript/BLUEPRINT.md\"") ||
    !appJs.includes("function startFileViewerResize") ||
    !appJs.includes("function clampFileViewerSize") ||
    !appJs.includes("function updateFileViewerReturnAction") ||
    !appJs.includes("fileViewerResizeAxis") ||
    !appJs.includes("function renderBlueprintInspector") ||
    !appJs.includes("function blueprintSidebarHtml") ||
    !appJs.includes("[data-blueprint-anchor]") ||
    !appJs.includes("LATEST_MANUSCRIPT_PATH") ||
    !appJs.includes("FILE_VIEWER_SIZE_KEY") ||
    !stylesCss.includes(".file-viewer-resize-handle") ||
    !stylesCss.includes(".file-viewer-resize-zone") ||
    !stylesCss.includes(".file-viewer-return") ||
    !stylesCss.includes(".blueprint-inspector-sidebar") ||
    !stylesCss.includes("body.is-resizing-file-viewer")
  ) {
    throw new Error("fullscreen file preview must expose a draggable resize handle, return-to-manuscript action, and blueprint inspector sidebar");
  }
  if (
    !appJs.includes("function messageCopyButton") ||
    !appJs.includes("message-copy-button") ||
    !stylesCss.includes(".message-copy-button") ||
    !stylesCss.includes(".message-action-row")
  ) {
    throw new Error("chat and transcript messages must expose copy controls");
  }
  if (
    appJs.includes('class="tree-file-actions"') ||
    stylesCss.includes(".tree-file-actions") ||
    !appJs.includes('data-file-details="${escapeHtml(filePath)}"') ||
    !appJs.includes('data-inline-file="${escapeHtml(filePath)}"') ||
    !appJs.includes('return `<iframe class="file-pdf-preview"') ||
    !stylesCss.includes(".file-pdf-preview")
  ) {
    throw new Error("Project files and resources must keep clean expandable rows while rendering PDF previews through the inline viewer");
  }
  if (
    !appJs.includes('class="trial-chip-index"') ||
    !appJs.includes('class="trial-chip-status"') ||
    !stylesCss.includes(".trial-chip-index") ||
    !stylesCss.includes("width: 28px;") ||
    !stylesCss.includes("height: 28px;") ||
    !stylesCss.includes(".trial-chip.is-active .trial-chip-index") ||
    !stylesCss.includes("color: #ffffff;")
  ) {
    throw new Error("trial strip numbers must render as high-contrast fixed-size badges");
  }
  if (
    !appJs.includes("function renderArchitectureOverview") ||
    !appJs.includes("function renderManuscriptArchitecture") ||
    !appJs.includes("function buildManuscriptStoryMap") ||
    !appJs.includes("function renderManuscriptStoryMap") ||
    !appJs.includes("function sectionStoryHtml") ||
    !appJs.includes("function artifactTakeawayHtml") ||
    !appJs.includes("function manuscriptArtifactCardHtml") ||
    !appJs.includes("function manuscriptTableCardHtml") ||
    !appJs.includes("function manuscriptAbstractCardHtml") ||
    !appJs.includes("function renderManuscriptExportBar") ||
    !appJs.includes("function architectureFieldListHtml") ||
    !appJs.includes("function publicationReadyTableMarkdown") ||
    !appJs.includes("Missing publication-ready table body") ||
    !appJs.includes("function renderManuscriptAuditPanel") ||
    !appJs.includes("function figureSpecCardsHtml") ||
    !appJs.includes("function figureSpecFields") ||
    !appJs.includes('contextCard("Manuscript story map"') ||
    appJs.includes('contextCard("Architecture overview"') ||
    appJs.includes('contextCard("Manuscript architecture"') ||
    !appJs.includes('contextCard("Audit / provenance"') ||
    !appJs.includes("Finished-results blueprint") ||
    !appJs.includes("Main takeaway") ||
    !appJs.includes("What this section says") ||
    !appJs.includes("Reader takeaway") ||
    !appJs.includes("function paragraphPlanHtml") ||
    !appJs.includes("Paragraph plan") ||
    !appJs.includes("Provenance / audit index") ||
    !appJs.includes("Secondary figure specs") ||
    !appJs.includes("data-copy-text") ||
    !appJs.includes("Copy block") ||
    !appJs.includes("Copy caption") ||
    !appJs.includes("markdownFileButtonHtml") ||
    !serverPy.includes('"architecture"') ||
    !serverPy.includes('"inline_artifacts"') ||
    !serverPy.includes('"toc"') ||
    !serverPy.includes('"article_type"') ||
    !serverPy.includes('"evidence_standard"') ||
    !serverPy.includes('"figure_plans"') ||
    !serverPy.includes('"table_plans"') ||
    !serverPy.includes('"provenance"') ||
    !stylesCss.includes(".figure-spec-card") ||
    !stylesCss.includes(".figure-caption") ||
    !stylesCss.includes(".figure-status.is-caution") ||
    !stylesCss.includes(".manuscript-architecture") ||
    !stylesCss.includes(".manuscript-story-map") ||
    !stylesCss.includes(".story-map-hero") ||
    !stylesCss.includes(".story-section-card") ||
    !stylesCss.includes(".story-artifact-card") ||
    !stylesCss.includes(".story-section-grid") ||
    !stylesCss.includes(".manuscript-export-bar") ||
    !stylesCss.includes(".architecture-field-list") ||
    !stylesCss.includes(".architecture-field-row.is-long") ||
    !stylesCss.includes(".paragraph-plan-scroll") ||
    !stylesCss.includes(".manuscript-artifact-card") ||
    !stylesCss.includes(".manuscript-abstract-card") ||
    !stylesCss.includes(".manuscript-table-card") ||
    !stylesCss.includes(".publication-table-preview") ||
    !stylesCss.includes(".table-missing-warning") ||
    !stylesCss.includes(".architecture-toc") ||
    !stylesCss.includes(".paragraph-plan-block") ||
    !stylesCss.includes(".manuscript-actions") ||
    !stylesCss.includes(".traceability-details")
  ) {
    throw new Error("manuscript panel must render a self-contained architecture blueprint with inline artifact blocks, provenance, and copy/open controls");
  }
  if (
    !blueprintTemplate.includes("Section brief:") ||
    !blueprintTemplate.includes("Reader takeaway:") ||
    !manuscriptInstructions.includes("Section brief") ||
    !compactText(manuscriptInstructions).includes("Reader takeaway") ||
    !compactText(manuscriptInstructions).includes("finished-results paper map") ||
    !compactText(finalGateReviewer).includes("reader-facing section briefs") ||
    !compactText(finalGateReviewer).includes("reader takeaways")
  ) {
    throw new Error("blueprint contract must require readable section briefs and artifact reader takeaways");
  }
  if (
    appJs.includes('class="paper-field-grid architecture-field-grid"') ||
    stylesCss.includes(".paper-field-grid dd .markdown-preview") ||
    stylesCss.includes("font-size: clamp(20px, 2vw, 26px)")
  ) {
    throw new Error("manuscript architecture fields must use the readable definition-list layout instead of auto-fit preview cards");
  }
  if (
    !manuscriptInstructions.includes("Publication-ready table:") ||
    !compactText(figureTableReviewer).includes("publication-ready Markdown") ||
    !compactText(finalGateReviewer).includes("publication-ready Markdown table body") ||
    !serverPy.includes("def markdown_has_table")
  ) {
    throw new Error("blueprint table contract must require publication-ready inline table bodies");
  }
  if (
    !appJs.includes("selectedResumeTrialContext") ||
    !appJs.includes("function normalizeResumeTrialContext") ||
    !appJs.includes("resumeFromTrial") ||
    !appJs.includes("data-trial-continue") ||
    !appJs.includes("data-resume-trial-submit") ||
    !appJs.includes("function confirmResumeTrialSend") ||
    !appJs.includes("data-resume-trial-confirm") ||
    !appJs.includes('"/api/research/resume-from-trial"') ||
    !appJs.includes("Remove the Continue from Trial chip before sending a slash command") ||
    !appJs.includes('"Trial continue"') ||
    !indexHtml.includes('id="resume-trial-dialog"') ||
    !indexHtml.includes("Trajectory fork") ||
    !stylesCss.includes(".resume-context-chip") ||
    !stylesCss.includes(".resume-trial-warning") ||
    !serverPy.includes("def start_resume_from_trial") ||
    !serverPy.includes('"archive"') ||
    !serverPy.includes('"resume_forks"') ||
    !serverPy.includes("def trial_checkpoint_dir") ||
    !serverPy.includes("resumeFromTrial") ||
    !serverPy.includes('"/api/research/resume-from-trial"') ||
    !serverPy.includes("TRAJECTORY.json") ||
    !serverPy.includes("The next active trial is Trial {next_iteration}")
  ) {
    throw new Error("UI/server must support confirmed continue-from-trial fork contexts");
  }
  if (
    !indexHtml.includes('id="restart-autoresearch-dialog"') ||
    !indexHtml.includes('data-command="/goal restart"') ||
    !appJs.includes('"/goal restart"') ||
    !appJs.includes("function confirmRestartAutoresearch") ||
    !appJs.includes('"/api/research/restart"') ||
    !appJs.includes("data-restart-autoresearch") ||
    !serverPy.includes("def start_restart_autoresearch") ||
    !serverPy.includes('"/api/research/restart"') ||
    !serverPy.includes('REPO_ROOT / "archive" / "restarts"') ||
    !serverPy.includes("restart_manifest.json") ||
    !serverPy.includes("RESTART_RETAINED_PROVENANCE")
  ) {
    throw new Error("UI/server must support confirmed restart autoresearch flow");
  }
  if (
    appJs.includes("projectCards") ||
    appJs.includes("[messages, sessionTranscript, pending, projectCards]") ||
    appJs.includes("projectBelongsAfterLatestUser") ||
    !appJs.includes("collapseProjectDraftMessages") ||
    !appJs.includes("const visibleMessages = collapseProjectDraftMessages(localMessages)") ||
    !appJs.includes('details class="framing-progress-row is-collapsible')
  ) {
    throw new Error("framing timeline must keep message order, collapse old PROJECT.md drafts, and keep tool details collapsed");
  }
  const versionOutput = execFileSync("node", [cli, "--version"], { cwd: root, encoding: "utf8" }).trim();
  if (versionOutput !== packageManifest.version) {
    throw new Error(`version output did not match package.json: ${versionOutput}`);
  }
  const upgradeOutput = execFileSync("node", [cli, "upgrade"], { cwd: projectDir, encoding: "utf8" });
  if (
    !upgradeOutput.includes(`CoAutoResearch CLI version: ${packageManifest.version}`) ||
    !upgradeOutput.includes("npm install -g co-auto-research@latest") ||
    !upgradeOutput.includes("Generated project research files are not rewritten automatically")
  ) {
    throw new Error("upgrade advisory output did not match expectation");
  }

  const fakeBin = path.join(tempRoot, "fake-bin");
  await writeFakeCodexBin(fakeBin);
  const doctorOutput = execFileSync("node", [cli, "doctor", "--port", String(await freePort())], {
    cwd: root,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    encoding: "utf8"
  });
  if (!doctorOutput.includes("codex fake 0.0.0")) {
    throw new Error("doctor did not resolve fake Codex executable from PATH");
  }
  if (!doctorOutput.includes("claude fake 0.0.0")) {
    throw new Error("doctor did not resolve fake Claude executable from PATH");
  }
  if (!doctorOutput.includes("package-managed runtime") || !doctorOutput.includes("legacy project ui/server.py")) {
    throw new Error(`doctor should report package-managed UI runtime and legacy project UI fallback:\n${doctorOutput}`);
  }
  const invalidBackendDoctorOutput = execFileSync("node", [cli, "doctor", "--port", String(await freePort())], {
    cwd: root,
    env: { ...process.env, COAUTO_AGENT_BACKEND: "not-a-backend", PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    encoding: "utf8"
  });
  if (!invalidBackendDoctorOutput.includes("invalid value") || !invalidBackendDoctorOutput.includes("COAUTO_AGENT_BACKEND")) {
    throw new Error(`doctor should warn about invalid COAUTO_AGENT_BACKEND:\n${invalidBackendDoctorOutput}`);
  }

  const packedName = execFileSync("npm", ["pack", "--pack-destination", tempRoot], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim().split(/\r?\n/).at(-1);
  const packedTarball = path.join(tempRoot, packedName);
  const npmPrefix = path.join(tempRoot, "npm-prefix");
  execFileSync("npm", ["install", "--global", "--prefix", npmPrefix, packedTarball], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe"
  });
  const installedCli = process.platform === "win32"
    ? path.join(npmPrefix, "co-auto-research.cmd")
    : path.join(npmPrefix, "bin", "co-auto-research");
  const installedVersion = execFileSync(installedCli, ["--version"], { encoding: "utf8" }).trim();
  if (installedVersion !== packageManifest.version) {
    throw new Error(`installed tarball CLI version did not match package.json: ${installedVersion}`);
  }
  const installedDoctorOutput = execFileSync(installedCli, ["doctor", "--port", String(await freePort())], {
    cwd: root,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    encoding: "utf8"
  });
  if (!installedDoctorOutput.includes("package-managed runtime") || !installedDoctorOutput.includes("codex fake 0.0.0") || !installedDoctorOutput.includes("claude fake 0.0.0")) {
    throw new Error(`installed tarball CLI doctor output was not useful:\n${installedDoctorOutput}`);
  }

  const python = findPython();
  const spacedBinRoot = path.join(tempRoot, "Program Files", "CoAuto Agents");
  const spacedCodexDir = path.join(spacedBinRoot, "Codex CLI");
  const spacedClaudeDir = path.join(spacedBinRoot, "Claude Code");
  await fsp.mkdir(spacedCodexDir, { recursive: true });
  await fsp.mkdir(spacedClaudeDir, { recursive: true });
  const spacedCodexCmd = path.join(spacedCodexDir, "codex.cmd");
  const spacedCodexExe = path.join(spacedCodexDir, "codex.exe");
  const spacedClaudeCmd = path.join(spacedClaudeDir, "claude.cmd");
  await fsp.writeFile(spacedCodexCmd, "@echo off\r\necho codex fake 0.0.0\r\n", "utf8");
  await fsp.writeFile(spacedCodexExe, "", "utf8");
  await fsp.writeFile(spacedClaudeCmd, "@echo off\r\necho claude fake 0.0.0\r\n", "utf8");
  const resolverOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    [
      "import importlib.util, os, pathlib",
      "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
      "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "resolved = pathlib.Path(module.resolve_codex_executable({'PATH': os.environ['COAUTO_FAKE_PATH']}, windows=True)).name.lower()",
      "claude = pathlib.Path(module.resolve_claude_executable({'PATH': os.environ['COAUTO_FAKE_PATH']}, windows=True)).name.lower()",
      "needs_shell = module.executable_requires_windows_shell('C:/Program Files/nodejs/codex.cmd', windows=True)",
      "space_codex = os.environ['COAUTO_SPACED_CODEX']",
      "space_claude = os.environ['COAUTO_SPACED_CLAUDE']",
      "assert module.resolve_codex_executable({'PATH': '', 'COAUTO_CODEX': space_codex}, windows=True) == space_codex",
      "assert module.resolve_claude_executable({'PATH': '', 'COAUTO_CLAUDE': space_claude}, windows=True) == space_claude",
      "assert module.executable_requires_windows_shell(space_codex, windows=True) is True",
      "assert module.executable_requires_windows_shell(os.environ['COAUTO_SPACED_CODEX_EXE'], windows=True) is False",
      "print(f'{resolved}|{claude}|{needs_shell}|space-ok')",
      "assert resolved == 'codex.cmd', resolved",
      "assert claude == 'claude.cmd', claude",
      "assert needs_shell is True"
    ].join("; ")
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_FAKE_PATH: fakeBin,
      COAUTO_SPACED_CODEX: spacedCodexCmd,
      COAUTO_SPACED_CODEX_EXE: spacedCodexExe,
      COAUTO_SPACED_CLAUDE: spacedClaudeCmd
    },
    encoding: "utf8"
  }).trim();
  if (resolverOutput !== "codex.cmd|claude.cmd|True|space-ok") {
    throw new Error(`Python agent resolver returned ${resolverOutput}`);
  }

  const codexAuthFailBin = path.join(tempRoot, "fake-codex-auth-fail");
  const claudeAuthFailBin = path.join(tempRoot, "fake-claude-auth-fail");
  const claudeNoAutoBin = path.join(tempRoot, "fake-claude-no-auto");
  await writeFakeAuthFailureBin(codexAuthFailBin, "codex");
  await writeFakeAuthFailureBin(claudeAuthFailBin, "claude");
  await writeFakeClaudePermissionBin(claudeNoAutoBin, ["acceptEdits", "bypassPermissions", "default", "dontAsk", "plan"]);
  const readinessOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    [
      "import importlib.util, json, os, pathlib",
      "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
      "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "project_root = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT'])",
      "context = module.ProjectContext(project_root)",
      "module._CONTEXT.project = context",
      "module.write_default_project_ui_settings(project_root, 'claude')",
      "assert module.selected_agent_backend_from_env({'COAUTO_AGENT_BACKEND': 'bogus'}) == 'codex'",
      "assert 'invalid COAUTO_AGENT_BACKEND' in module.agent_backend_env_warning({'COAUTO_AGENT_BACKEND': 'bogus'})",
      "old_backend = os.environ.get('COAUTO_AGENT_BACKEND', '')",
      "old_path_for_invalid = os.environ.get('PATH', '')",
      "old_codex_for_invalid = os.environ.get('COAUTO_CODEX', '')",
      "old_claude_for_invalid = os.environ.get('COAUTO_CLAUDE', '')",
      "os.environ['COAUTO_AGENT_BACKEND'] = 'bogus'",
      "os.environ['PATH'] = os.environ['COAUTO_FAKE_PATH']",
      "os.environ['COAUTO_CODEX'] = ''",
      "os.environ['COAUTO_CLAUDE'] = ''",
      "try:",
      "    invalid_env_settings = module.normalize_research_settings({})",
      "    assert invalid_env_settings['backend'] == 'claude', invalid_env_settings",
      "    public_settings = module.public_ui_settings()",
      "    assert 'invalid COAUTO_AGENT_BACKEND' in public_settings['agent_status']['env_warning'], public_settings['agent_status']",
      "finally:",
      "    os.environ['COAUTO_AGENT_BACKEND'] = old_backend",
      "    os.environ['PATH'] = old_path_for_invalid",
      "    os.environ['COAUTO_CODEX'] = old_codex_for_invalid",
      "    os.environ['COAUTO_CLAUDE'] = old_claude_for_invalid",
      "ok_env = dict(os.environ, PATH=os.environ['COAUTO_FAKE_PATH'], COAUTO_CODEX='', CODEX_BIN='', COAUTO_CLAUDE='', CLAUDE_BIN='')",
      "codex_ok = module.agent_setup_status('codex', ok_env)",
      "claude_ok = module.agent_setup_status('claude', ok_env)",
      "assert codex_ok['ok'] and codex_ok['auth'] == 'ok', codex_ok",
      "assert claude_ok['ok'] and claude_ok['auth'] == 'ok', claude_ok",
      "no_auto_env = dict(os.environ, PATH=os.environ['COAUTO_CLAUDE_NO_AUTO_PATH'], COAUTO_CLAUDE='', CLAUDE_BIN='')",
      "no_auto = module.claude_permission_mode_status({'permissionPreset': 'auto-review'}, no_auto_env)",
      "assert no_auto['blocking'] and no_auto['mode'] == 'auto', no_auto",
      "default_mode = module.claude_permission_mode_status({'permissionPreset': 'default'}, no_auto_env)",
      "assert default_mode['ok'] and not default_mode['blocking'], default_mode",
      "try:",
      "    module.ensure_agent_ready('claude', no_auto_env, {'permissionPreset': 'auto-review'})",
      "    raise AssertionError('unsupported Claude auto permission mode should block readiness')",
      "except ValueError as exc:",
      "    assert 'permission mode `auto`' in str(exc), str(exc)",
      "missing = module.agent_setup_status('codex', dict(os.environ, PATH='', COAUTO_CODEX='', CODEX_BIN=''))",
      "assert missing['blocking'] and 'COAUTO_CODEX' in missing['message'], missing",
      "codex_auth = module.agent_setup_status('codex', dict(os.environ, PATH=os.environ['COAUTO_CODEX_FAIL_PATH'], COAUTO_CODEX='', CODEX_BIN=''))",
      "assert codex_auth['blocking'] and 'codex login' in codex_auth['message'], codex_auth",
      "claude_auth = module.agent_setup_status('claude', dict(os.environ, PATH=os.environ['COAUTO_CLAUDE_FAIL_PATH'], COAUTO_CLAUDE='', CLAUDE_BIN=''))",
      "assert claude_auth['blocking'] and 'claude auth login' in claude_auth['message'], claude_auth",
      "old_path = os.environ.get('PATH', '')",
      "old_claude = os.environ.get('COAUTO_CLAUDE', '')",
      "old_claude_bin = os.environ.get('CLAUDE_BIN', '')",
      "os.environ['PATH'] = os.environ['COAUTO_CLAUDE_FAIL_PATH']",
      "os.environ['COAUTO_CLAUDE'] = ''",
      "os.environ['CLAUDE_BIN'] = ''",
      "module.agent_command_for_prompt = lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError('command generated before readiness preflight'))",
      "try:",
      "    module.start_research_run('hello', 'chat', False, settings_payload={'backend': 'claude'})",
      "    raise AssertionError('auth-missing Claude should block startup')",
      "except ValueError as exc:",
      "    assert 'claude auth login' in str(exc), str(exc)",
      "finally:",
      "    os.environ['PATH'] = old_path",
      "    os.environ['COAUTO_CLAUDE'] = old_claude",
      "    os.environ['CLAUDE_BIN'] = old_claude_bin",
      "print(json.dumps({'codex': codex_ok['auth'], 'claude': claude_ok['auth'], 'blocked': 'claude auth login', 'permission': no_auto['mode'], 'invalid': invalid_env_settings['backend']}))",
    ].join("\n")
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir,
      COAUTO_FAKE_PATH: fakeBin,
      COAUTO_CODEX_FAIL_PATH: codexAuthFailBin,
      COAUTO_CLAUDE_FAIL_PATH: claudeAuthFailBin,
      COAUTO_CLAUDE_NO_AUTO_PATH: claudeNoAutoBin
    },
    encoding: "utf8"
  }).trim();
  if (!readinessOutput.includes('"blocked": "claude auth login"') || !readinessOutput.includes('"permission": "auto"') || !readinessOutput.includes('"invalid": "claude"')) {
    throw new Error(`Python readiness fixture returned unexpected output: ${readinessOutput}`);
  }

  const agentBackendOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    [
      "import importlib.util, json, os, pathlib",
      "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
      "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "context = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
      "module._CONTEXT.project = context",
      "codex_settings = module.normalize_research_settings({'backend': 'codex', 'model': 'gpt-5.5', 'reasoningEffort': 'medium', 'permissionPreset': 'auto-review', 'webSearch': True, 'reviewCheckpointInterval': '30'})",
      "context.session.update({'session_id': '00000000-0000-0000-0000-000000000111', 'backend': 'codex', 'settings': codex_settings, 'logs': [], 'raw_logs': [], 'transcript': []})",
      "codex_new_cmd = module.agent_command_for_prompt(False, codex_settings)",
      "codex_resume_cmd = module.agent_command_for_prompt(True, codex_settings)",
      "assert pathlib.Path(codex_new_cmd[0]).name.startswith('codex'), codex_new_cmd",
      "assert codex_new_cmd[1] == 'exec' and '--json' in codex_new_cmd and codex_new_cmd[-1] == '-', codex_new_cmd",
      "assert codex_resume_cmd[1:3] == ['exec', 'resume'] and '00000000-0000-0000-0000-000000000111' in codex_resume_cmd and codex_resume_cmd[-1] == '-', codex_resume_cmd",
      "settings = module.normalize_research_settings({'backend': 'claude', 'model': 'sonnet', 'reasoningEffort': 'high', 'permissionPreset': 'full-access', 'webSearch': False, 'reviewCheckpointInterval': '25'})",
      "context.session.update({'session_id': '00000000-0000-0000-0000-000000000123', 'backend': 'claude', 'settings': settings, 'logs': [], 'raw_logs': [], 'transcript': []})",
      "new_cmd = module.agent_command_for_prompt(False, settings)",
      "resume_cmd = module.agent_command_for_prompt(True, settings)",
      "assert pathlib.Path(new_cmd[0]).name.startswith('claude'), new_cmd",
      "assert '-p' in new_cmd and 'stream-json' in new_cmd and '--include-partial-messages' in new_cmd, new_cmd",
      "assert '--permission-mode' in new_cmd and 'bypassPermissions' in new_cmd, new_cmd",
      "assert '--disallowedTools' in new_cmd and 'WebSearch,WebFetch' in new_cmd, new_cmd",
      "assert '--resume' in resume_cmd and '00000000-0000-0000-0000-000000000123' in resume_cmd, resume_cmd",
      "system_line = json.dumps({'type': 'system', 'subtype': 'init', 'session_id': '00000000-0000-0000-0000-000000000999'})",
      "assistant_line = json.dumps({'type': 'assistant', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'Final assistant text.'}], 'stop_reason': 'end_turn', 'usage': {'input_tokens': 3, 'output_tokens': 5}}})",
      "tool_line = json.dumps({'type': 'assistant', 'message': {'role': 'assistant', 'content': [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': 'pwd'}}], 'stop_reason': 'tool_use'}})",
      "result_line = json.dumps({'type': 'result', 'subtype': 'success', 'result': 'Done.', 'session_id': '00000000-0000-0000-0000-000000000999', 'total_cost_usd': 0.012})",
      "assert module.transcript_from_claude_line(system_line) is None",
      "assert module.transcript_from_claude_line(assistant_line)['content'] == 'Final assistant text.'",
      "assert module.transcript_from_claude_line(tool_line)['kind'] == 'tool'",
      "assert module.transcript_from_claude_line(result_line)['role'] == 'final'",
      "module.append_research_log(system_line)",
      "module.append_research_log(assistant_line)",
      "module.append_research_log(tool_line)",
      "module.append_research_log(result_line)",
      "usage = module.latest_agent_usage()",
      "assert context.session['session_id'] == '00000000-0000-0000-0000-000000000999', context.session['session_id']",
      "assert usage['usage']['input_tokens'] == 3 and usage['cost_usd'] == 0.012, usage",
      "print(json.dumps({'backend': settings['backend'], 'command': new_cmd[1:4], 'transcript': len(context.session['transcript']), 'cost': usage['cost_usd']}))",
    ].join("; ")
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir,
      COAUTO_AGENT_BACKEND: "",
      COAUTO_CODEX: process.platform === "win32" ? path.join(fakeBin, "codex.cmd") : path.join(fakeBin, "codex"),
      COAUTO_CLAUDE: process.platform === "win32" ? path.join(fakeBin, "claude.cmd") : path.join(fakeBin, "claude")
    },
    encoding: "utf8"
  }).trim();
  if (!agentBackendOutput.includes('"backend": "claude"') || !agentBackendOutput.includes('"cost": 0.012')) {
    throw new Error(`Python Claude backend fixture returned unexpected output: ${agentBackendOutput}`);
  }

  const launchPromptOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    [
      "import importlib.util, os, pathlib",
      "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
      "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "base = module.autoresearch_goal_prompt()",
      "custom = module.autoresearch_goal_prompt('Prioritize source-level evidence.')",
      "assert 'Additional user instruction for this launch' not in base",
      "assert 'Prioritize source-level evidence.' in custom",
      "assert 'Required reviewer gates must all be strict `pass`' in custom",
      "assert module.infer_trial_status('Resource intake is no longer blocked by stale clues.', '', '# Report\\n\\nReplaced scaffold placeholders.') == 'reported'",
      "assert module.infer_trial_status('Status: blocked', '', '') == 'blocked'",
      "print('launch-prompt-ok')",
    ].join("; ")
  ], {
    cwd: root,
    env: { ...process.env, COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py") },
    encoding: "utf8"
  }).trim();
  if (launchPromptOutput !== "launch-prompt-ok") {
    throw new Error(`launch prompt smoke returned ${launchPromptOutput}`);
  }

  const legacyFileReferenceScript = [
    "import importlib.util, json, os, pathlib",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module._CONTEXT.project = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
    "legacy_project = module.read_text_file('/Users/example/legacy/local-projects/demo/PROJECT.md')",
    "legacy_manifest = module.read_text_file('/Users/example/legacy/local-projects/demo/resources/user_input/RESOURCE_MANIFEST.md')",
    "basename_manifest = module.read_text_file('RESOURCE_MANIFEST.md')",
    "assert legacy_project.get('exists') is True and legacy_project.get('path') == 'PROJECT.md', legacy_project",
    "assert legacy_manifest.get('exists') is True and legacy_manifest.get('path') == 'resources/user_input/RESOURCE_MANIFEST.md', legacy_manifest",
    "assert basename_manifest.get('exists') is True and basename_manifest.get('path') == 'resources/user_input/RESOURCE_MANIFEST.md', basename_manifest",
    "print(json.dumps({'project': legacy_project['path'], 'manifest': basename_manifest['path']}))"
  ].join("\n");
  const legacyFileReferenceOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    legacyFileReferenceScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (!legacyFileReferenceOutput.includes("RESOURCE_MANIFEST.md")) {
    throw new Error(`legacy file reference resolver returned ${legacyFileReferenceOutput}`);
  }

  const resourceImportScript = [
    "import importlib.util, json, os, pathlib",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "root = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT'])",
    "module._CONTEXT.project = module.ProjectContext(root)",
    "payload = module.start_resource_import({'name': 'large.bin', 'size': 11, 'category': 'data_sources'})",
    "module.write_resource_import_chunk(payload['import_id'], 0, b'hello ')",
    "try:\n    module.write_resource_import_chunk(payload['import_id'], 1, b'bad')\n    raise AssertionError('invalid offset accepted')\nexcept ValueError:\n    pass",
    "module.write_resource_import_chunk(payload['import_id'], 6, b'world')",
    "finished = module.finish_resource_import({'import_id': payload['import_id']})",
    "dest = root / finished['path']",
    "assert finished['path'].startswith('resources/data_sources/'), finished",
    "assert dest.read_bytes() == b'hello world'",
    "payload2 = module.start_resource_import({'name': 'cancel.bin', 'size': 4, 'category': 'other'})",
    "module.write_resource_import_chunk(payload2['import_id'], 0, b'ab')",
    "cancelled = module.cancel_resource_import({'import_id': payload2['import_id']})",
    "assert cancelled['cancelled'] is True",
    "runtime = root / 'ui' / '.runtime' / 'resource_imports'",
    "assert not any(path.name.startswith(payload2['import_id']) for path in runtime.glob('*'))",
    "saved = module.save_resource_links({'resourceLinks': [{'path': finished['path'], 'category': 'data_sources', 'alreadyImported': True}]})",
    "assert saved and saved[0]['mode'] == 'imported' and saved[0]['path'] == finished['path'], saved",
    "print(json.dumps({'path': finished['path'], 'mode': saved[0]['mode']}))"
  ].join("\n");
  const resourceImportOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    resourceImportScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (!resourceImportOutput.includes("resources/data_sources")) {
    throw new Error(`resource import smoke returned ${resourceImportOutput}`);
  }

  const externalRepo = path.join(tempRoot, "LLMShopper-TBS-Test");
  await fsp.mkdir(externalRepo, { recursive: true });
  await fsp.writeFile(path.join(externalRepo, "README.md"), "external repo material\n", "utf8");
  const resourceResolverScript = [
    "import importlib.util, json, os, pathlib",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module._CONTEXT.project = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
    "payload = module.prepare_payload_resources({'resourceLinks': []}, [os.environ['COAUTO_RESOURCE_TEXT']])",
    "links = payload.get('resourceLinks', [])",
    "assert links == [], links",
    "clues = payload.get('_resourceResolution', [])",
    "assert clues and any(item.get('path', '').endswith('LLMShopper-TBS-Test') for item in clues), clues",
    "saved = module.save_resource_links(payload)",
    "assert saved == [], saved",
    "module.write_ui_metadata(payload, [], [])",
    "manifest = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']) / 'resources/user_input/RESOURCE_MANIFEST.md'",
    "text = manifest.read_text(encoding='utf-8')",
    "assert 'Inferred Resource References' in text and 'LLMShopper-TBS-Test' in text, text",
    "assert not (pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']) / 'resources/ongoing_work/LLMShopper-TBS-Test').exists()",
    "explicit_payload = {'resourceLinks': [{'path': os.environ['COAUTO_EXTERNAL_REPO'], 'category': 'ongoing_work'}]}",
    "explicit_saved = module.save_resource_links(explicit_payload)",
    "module.write_ui_metadata(explicit_payload, [], explicit_saved)",
    "assert explicit_saved and pathlib.Path(explicit_saved[0]['path']).parts[0] == 'resources', explicit_saved",
    "resources = module.collect_resources()",
    "ongoing = next(group for group in resources if group['path'] == 'resources/ongoing_work')",
    "assert any(item['path'].endswith('LLMShopper-TBS-Test/README.md') for item in ongoing['files']), ongoing",
    "tree = module.directory_tree('resources')",
    "ongoing_tree = next(child for child in tree['children'] if child['name'] == 'ongoing_work')",
    "linked_tree = next(child for child in ongoing_tree['children'] if child['name'] == 'LLMShopper-TBS-Test')",
    "assert linked_tree.get('is_symlink') is True and any(child['name'] == 'README.md' for child in linked_tree['children']), linked_tree",
    "workspace_tree = module.directory_tree('.', max_depth=4, exclude_names={'node_modules', '.venv', 'venv', 'dist', 'build', '.pytest_cache', '.mypy_cache', '.ruff_cache'})",
    "instructions_tree = next(child for child in workspace_tree['children'] if child['name'] == 'instructions')",
    "assert any(child['name'] == 'COLD_START.md' for child in instructions_tree['children']), instructions_tree",
    "trajectory_tree = next(child for child in workspace_tree['children'] if child['name'] == 'research_trajectory')",
    "assert any(child['name'] == 'STATE.md' for child in trajectory_tree['children']), trajectory_tree",
    "explicit_text = manifest.read_text(encoding='utf-8')",
    "assert 'Explicit UI Resources' in explicit_text and 'Attached Resources' in explicit_text, explicit_text",
    "print(json.dumps({'clues': len(clues), 'saved': explicit_saved[0]['path']}))"
  ].join("\n");
  const resourceResolverOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    resourceResolverScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir,
      COAUTO_EXTERNAL_REPO: externalRepo,
      COAUTO_RESOURCE_TEXT: 'please continue in "E:\\Github\\LLMShopper-TBS-Test" repo'
    },
    encoding: "utf8"
  }).trim();
  if (!resourceResolverOutput.includes("LLMShopper-TBS-Test")) {
    throw new Error(`resource resolver did not report the external repo: ${resourceResolverOutput}`);
  }

  const gateParserScript = [
    "import importlib.util, json, os, pathlib",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "context = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
    "module._CONTEXT.project = context",
    "state = context.research_state_path",
    "blueprint = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']) / 'manuscript' / 'BLUEPRINT.md'",
    "trial_dir = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']) / 'research_trajectory' / 'trials' / '000001_final_smoke'",
    "review_dir = trial_dir / 'reviews'",
    "review_dir.mkdir(parents=True, exist_ok=True)",
    "def write_final_artifacts():",
    "    trial_dir.mkdir(parents=True, exist_ok=True)",
    "    (trial_dir / 'PLAN.md').write_text('# Plan\\n\\nFinal gate smoke plan.\\n', encoding='utf-8')",
    "    (trial_dir / 'REPORT.md').write_text('# Report\\n\\nFinal gate smoke report.\\n', encoding='utf-8')",
    "    blueprint.write_text(\"\"\"# Manuscript Blueprint\n\n## Target Venue / Audience / Article Type\n\nTarget venue: General research venue.\n\nAudience: Researchers.\n\nArticle type: Perspective.\n\nContribution posture: Conceptual synthesis.\n\nEvidence standard: Cited and qualified.\n\nExpected display / method / result style: Minimal displays.\n\n---\n\n## Target-Venue Organization Rationale\n\nThe organization follows a venue-facing perspective structure with problem framing, evidence synthesis, implications, and limits.\n\n---\n\n## Core Story\n\nThe project advances a calibrated, evidence-bounded argument for the declared audience.\n\n---\n\n## Architecture Overview / Table of Contents\n\n- [Section 1: Introduction](#section-1-introduction)\n\n---\n\n## Manuscript Architecture\n\n### Section 1: Introduction\n\nTarget-venue role: Open the perspective with a qualified evidence synthesis.\n\nReader question answered: Why should this perspective exist and what claim is supported?\n\nLocal thesis / purpose: The bounded accepted claim is important but constrained by the reviewed evidence.\n\nLocal claims in plain language: The manuscript makes one bounded claim that is understandable without opening a claim/evidence index.\n\nLocal evidence, results, or artifacts: `research_trajectory/CURRENT_FINDINGS.md` supports the claim through the current source audit.\n\nPlaced displays / methods / results: none.\n\nLocal qualifications: The claim remains bounded to the reviewed evidence.\n\nTransition job: sets up the implication section.\n\nParagraph plan:\n\n| Para | Rhetorical move | Content to cover, not full prose | Local evidence / result / artifact | Display / method / result block | Citation posture | Required qualification | Transition job |\n|---|---|---|---|---|---|---|---|\n| P1 | Establish problem and bounded claim | State the research problem and say exactly what the current finding supports without drafting final prose. | `research_trajectory/CURRENT_FINDINGS.md` | none | cite the accepted source audit | bounded to reviewed evidence | sets up the implication section |\n\n---\n\n## Reference / Literature Grounding Plan\n\nUse the current source audit and seed literature recorded in CURRENT_FINDINGS.\n\n---\n\n## Appendix / Supplement Plan\n\nNo appendix is needed for the scoped perspective; provenance remains in trial reports. No active tables are needed because the comparison is carried locally in Section 1 paragraph P1.\n\n---\n\n## Blocking Missing Evidence\n\n- none\n\n---\n\n## Required Qualifications / Claim Constraints\n\nThe claim remains qualified to the cited evidence and that qualification is reflected in Section 1 paragraph P1.\n\n---\n\n## Provenance / Audit Index\n\n### Claim / Evidence Index\n\nC000001 maps to the local Section 1 claim and `research_trajectory/CURRENT_FINDINGS.md`.\n\n### Display / Method / Result Inventory\n\nNo active displays, methods, datasets, benchmarks, or result blocks are required for this scoped fixture.\n\n### Source Links\n\n- `research_trajectory/CURRENT_FINDINGS.md`\n\n---\n\n## Deprecated Or Superseded Ideas\n\nNone active.\n\n---\n\n## Submission-Readiness Summary\n\nReady for the declared scope after all reviewer gates pass.\n\"\"\", encoding='utf-8')",
    "    review_template = \"\"\"Reviewer: {reviewer}\nScope: {scope}\nDecision: pass\nGate impact: pass\nConfidence: high\nSource trial: `000001_final_smoke`\nGenerated at: 2026-06-20T00:00:00Z\nInstruction file: `{instruction}`\nMigration source: `none`\n\n## Reviewed Inputs\n\n- `PROJECT.md`\n- `research_trajectory/STATE.md`\n- `research_trajectory/trials/000001_final_smoke/PLAN.md`\n- `research_trajectory/trials/000001_final_smoke/REPORT.md`\n\n## Context Summary\n\nSmoke test reviewer fixture.\n\n## Blocking Issues\n\n- none\n\n## Required Actions Before Pass\n\n- none\n\n## Qualified / Partial Passes\n\n- none\n\n## Unassessed Areas\n\n- none\n\"\"\"",
    "    for key, config in module.REQUIRED_REVIEWER_OUTPUTS.items():",
    "        if key == 'final_gate':",
    "            continue",
    "        (review_dir / config['file']).write_text(review_template.format(reviewer=config['label'], scope=config['scope'], instruction=config['instruction']), encoding='utf-8')",
    "    (review_dir / 'FINAL_GATE_REVIEW.md').write_text(\"\"\"Reviewer: Final gate reviewer\nScope: final-gate\nDecision: pass\nGate impact: pass\nConfidence: high\nSource trial: `000001_final_smoke`\nGenerated at: 2026-06-20T00:00:00Z\nInstruction file: `instructions/reviewers/FINAL_GATE_REVIEWER.md`\nMigration source: `none`\n\n## Reviewed Inputs\n\n- `research_trajectory/trials/000001_final_smoke/reviews/PLAN_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/PROCESS_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/EVIDENCE_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/VENUE_FIT_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/MANUSCRIPT_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/FIGURE_TABLE_REVIEW.md`\n\n## Context Summary\n\nSmoke test final gate fixture.\n\n## Artifact Consistency Audit\n\n- reviewer baseline status: current\n- final blueprint section completeness: complete\n- target manual section title/order fidelity: complete\n- paragraph plan completeness: complete\n- accepted claims vs candidate claims status: accepted\n- blocking missing evidence status: none\n- figure plan completeness: complete\n- figure paragraph placement completeness: complete\n- table plan or no-table rationale completeness: complete\n- table paragraph placement and source/result completeness: complete\n- reference/literature grounding completeness: complete\n- appendix/supplement plan completeness: complete\n- stale contradiction scan result: none\n- exact reason the gate can pass: all required checks passed\n\n## Blocking Issues\n\n- none\n\n## Required Actions Before Pass\n\n- none\n\n## Qualified / Partial Passes\n\n- none\n\n## Unassessed Areas\n\n- none\n\"\"\", encoding='utf-8')",
    "assert module.normalize_gate_status('ready for targeted revision') == 'continue'",
    "assert module.normalize_gate_status('completed') == 'continue'",
    "assert module.normalize_gate_status('approved') == 'continue'",
    "assert module.normalize_gate_status('pass for display inventory') == 'continue'",
    "assert module.normalize_gate_status('pass - architecture coherent; targeted revision required') == 'continue'",
    "assert module.normalize_gate_status('pass - all completed trials have approved plans and reports.') == 'pass'",
    "assert module.normalize_gate_status('pass - no blockers remain') == 'pass'",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: continue - missing source audit\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n- Final gate reviewer: pass\n\nNext action: finish evidence audit.\n\"\"\", encoding='utf-8')",
    "gate = module.read_autoresearch_gate()",
    "assert gate['overall_status'] == 'pass', gate",
    "assert gate['status'] == 'continue', gate",
    "assert gate['reviewer_statuses']['evidence'] == 'continue', gate",
    "assert gate['all_reviewers_passed'] is False, gate",
    "assert module.gate_has_passed(gate) is False, gate",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: pass\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n\nNext action: none.\n\"\"\", encoding='utf-8')",
    "missing_final = module.read_autoresearch_gate()",
    "assert missing_final['status'] == 'continue', missing_final",
    "assert 'final_gate' in missing_final['missing_reviewers'], missing_final",
    "assert module.gate_has_passed(missing_final) is False, missing_final",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/PLAN_REVIEW.md`\n- Process reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/PROCESS_REVIEW.md`\n- Evidence reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/EVIDENCE_REVIEW.md`\n- Venue fit reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/VENUE_FIT_REVIEW.md`\n- Manuscript reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/MANUSCRIPT_REVIEW.md`\n- Figure/table reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/FIGURE_TABLE_REVIEW.md`\n- Final gate reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/FINAL_GATE_REVIEW.md`\n\nNext action: none.\n\"\"\", encoding='utf-8')",
    "stale = module.read_autoresearch_gate()",
    "assert stale['status'] == 'continue', stale",
    "assert stale['consistency_blockers'], stale",
    "assert module.gate_has_passed(stale) is False, stale",
    "write_final_artifacts()",
    "pass_gate_with_paths = \"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/PLAN_REVIEW.md\n- Process reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/PROCESS_REVIEW.md\n- Evidence reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/EVIDENCE_REVIEW.md\n- Venue fit reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/VENUE_FIT_REVIEW.md\n- Manuscript reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/MANUSCRIPT_REVIEW.md\n- Figure/table reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/FIGURE_TABLE_REVIEW.md\n- Final gate reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/FINAL_GATE_REVIEW.md\n\nNext action: none.\n\"\"\"",
    "evidence_review = review_dir / 'EVIDENCE_REVIEW.md'",
    "original_evidence = evidence_review.read_text(encoding='utf-8')",
    "evidence_review.write_text(original_evidence.replace('Decision: pass', 'Decision: continue').replace('Gate impact: pass', 'Gate impact: continue'), encoding='utf-8')",
    "state.write_text(pass_gate_with_paths, encoding='utf-8')",
    "nonpass_file = module.read_autoresearch_gate()",
    "assert nonpass_file['status'] == 'continue', nonpass_file",
    "assert any('EVIDENCE_REVIEW.md' in blocker for blocker in nonpass_file['consistency_blockers']), nonpass_file",
    "evidence_review.write_text(original_evidence, encoding='utf-8')",
    "collected = module.collect_reviews()",
    "trial_review_paths = sorted(item['path'] for item in collected if '000001_final_smoke/reviews/' in item['path'])",
    "assert len(trial_review_paths) == 7, trial_review_paths",
    "state.write_text(pass_gate_with_paths, encoding='utf-8')",
    "passed = module.read_autoresearch_gate()",
    "assert passed['status'] == 'pass', passed",
    "assert passed['all_reviewers_passed'] is True, passed",
    "assert module.gate_has_passed(passed) is True, passed",
    "print(json.dumps({'blocked': gate['status'], 'passed': passed['status']}))"
  ].join("\n");
  const gateParserOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    gateParserScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (!gateParserOutput.includes('"blocked": "continue"') || !gateParserOutput.includes('"passed": "pass"')) {
    throw new Error(`gate parser smoke test returned unexpected output: ${gateParserOutput}`);
  }

  const checkpointScript = [
    "import importlib.util, json, os, pathlib",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "context = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
    "module._CONTEXT.project = context",
    "state = context.research_state_path",
    "continue_gate = \"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: continue\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: continue - missing source audit\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n- Final gate reviewer: pass\n\nNext action: finish evidence audit.\n\"\"\"",
    "pass_gate = \"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/PLAN_REVIEW.md`\n- Process reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/PROCESS_REVIEW.md`\n- Evidence reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/EVIDENCE_REVIEW.md`\n- Venue fit reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/VENUE_FIT_REVIEW.md`\n- Manuscript reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/MANUSCRIPT_REVIEW.md`\n- Figure/table reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/FIGURE_TABLE_REVIEW.md`\n- Final gate reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/FINAL_GATE_REVIEW.md`\n\nNext action: none.\n\"\"\"",
    "assert module.DEFAULT_REVIEW_CHECKPOINT_INTERVAL == 100",
    "assert module.normalize_review_checkpoint_interval(None) == 100",
    "assert module.normalize_research_settings({'reviewCheckpointInterval': '25'})['reviewCheckpointInterval'] == 25",
    "module.save_ui_settings({'codex': {'reviewCheckpointInterval': '25'}})",
    "assert module.load_ui_settings()['codex']['reviewCheckpointInterval'] == 25",
    "state.write_text(continue_gate, encoding='utf-8')",
    "context.session.update({'loop_active': True, 'mode': 'goal', 'loop_iteration': 100, 'loop_review_checkpoint_iteration': 100, 'settings': {'reviewCheckpointInterval': 100}, 'logs': [], 'raw_logs': [], 'transcript': []})",
    "module.maybe_continue_autoresearch_loop(0)",
    "assert context.session['loop_active'] is False, context.session",
    "assert context.session['loop_stop_reason'] == 'review_checkpoint_reached', context.session",
    "state.write_text(pass_gate, encoding='utf-8')",
    "context.session.update({'loop_active': True, 'mode': 'goal', 'loop_iteration': 2, 'loop_review_checkpoint_iteration': 100, 'loop_stop_reason': '', 'settings': {'reviewCheckpointInterval': 100}, 'logs': [], 'raw_logs': [], 'transcript': []})",
    "module.maybe_continue_autoresearch_loop(0)",
    "assert context.session['loop_active'] is False, context.session",
    "assert context.session['loop_stop_reason'] == 'all_reviewer_gates_passed', context.session",
    "state.write_text(continue_gate, encoding='utf-8')",
    "context.session.update({'loop_active': False, 'mode': 'goal', 'loop_iteration': 100, 'loop_review_checkpoint_iteration': 100, 'loop_stop_reason': 'review_checkpoint_reached', 'settings': {'reviewCheckpointInterval': 100}, 'session_id': '00000000-0000-0000-0000-000000000000', 'logs': [], 'raw_logs': [], 'transcript': []})",
    "module.start_research_run = lambda *args, **kwargs: {'ok': True, 'kwargs': kwargs}",
    "resumed = module.handle_local_slash_command('/goal resume', '/goal resume', {'reviewCheckpointInterval': 25})",
    "assert resumed and resumed.get('local') is True, resumed",
    "assert context.session['loop_active'] is True, context.session",
    "assert context.session['loop_review_checkpoint_iteration'] == 26, context.session",
    "print(json.dumps({'default': module.DEFAULT_REVIEW_CHECKPOINT_INTERVAL, 'checkpoint_stop': 'review_checkpoint_reached', 'resumed_checkpoint': context.session['loop_review_checkpoint_iteration']}))"
  ].join("\n");
  const checkpointOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    checkpointScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (
    !checkpointOutput.includes('"default": 100') ||
    !checkpointOutput.includes('"checkpoint_stop": "review_checkpoint_reached"') ||
    !checkpointOutput.includes('"resumed_checkpoint": 26')
  ) {
    throw new Error(`checkpoint smoke test returned unexpected output: ${checkpointOutput}`);
  }

  const activeTrialMarkerScript = [
    "import importlib.util, json, os, pathlib, tempfile",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server_marker', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "root = pathlib.Path(tempfile.mkdtemp(prefix='coauto-marker-smoke-'))",
    "(root / 'PROJECT.md').write_text('# Marker Smoke\\n', encoding='utf-8')",
    "(root / 'research_trajectory' / 'trials' / '000011_final_gate' ).mkdir(parents=True)",
    "(root / 'research_trajectory' / 'trials' / '000011_final_gate' / 'REPORT.md').write_text('# Report\\n', encoding='utf-8')",
    "(root / 'research_trajectory' / 'STATE.md').write_text(\"\"\"# Research State\\n\\n## Autoresearch Goal Gate\\n\\nStatus: continue\\n\\nRequired reviewer gates:\\n- Plan reviewer: continue\\n- Process reviewer: continue\\n- Evidence reviewer: continue\\n- Venue fit reviewer: continue\\n- Manuscript reviewer: continue\\n- Figure/table reviewer: continue\\n- Final gate reviewer: continue\\n\\nNext action: continue.\\n\"\"\", encoding='utf-8')",
    "context = module.ProjectContext(root)",
    "module._CONTEXT.project = context",
    "class RunningProc:",
    "    def poll(self):",
    "        return None",
    "context.session.update({'process': RunningProc(), 'status': 'running', 'mode': 'goal', 'loop_active': True, 'loop_iteration': 12, 'settings': {'backend': 'codex'}, 'logs': [], 'raw_logs': [], 'transcript': []})",
    "(root / 'research_trajectory' / 'NEXT_TRIAL.json').write_text(json.dumps({'status': 'complete', 'expected_iteration': 12}, indent=2), encoding='utf-8')",
    "complete_snapshot = module.research_session_snapshot()",
    "assert complete_snapshot['active_run']['trial_iteration'] == 11, complete_snapshot['active_run']",
    "(root / 'research_trajectory' / 'NEXT_TRIAL.json').write_text(json.dumps({'status': 'pending', 'expected_iteration': 12}, indent=2), encoding='utf-8')",
    "pending_snapshot = module.research_session_snapshot()",
    "assert pending_snapshot['active_run']['trial_iteration'] == 12, pending_snapshot['active_run']",
    "pass_lines = ['# Research State', '', '## Autoresearch Goal Gate', '', 'Status: pass', '', 'Required reviewer gates:']",
    "for key, config in module.REQUIRED_REVIEWER_GATES.items():",
    "    pass_lines.append(f'- {config}: pass - `research_trajectory/trials/000011_final_gate/reviews/{key}.md`')",
    "(root / 'research_trajectory' / 'STATE.md').write_text('\\n'.join(pass_lines), encoding='utf-8')",
    "context.session.update({'process': None, 'status': 'completed', 'mode': 'goal', 'loop_active': False, 'loop_stop_reason': 'all_reviewer_gates_passed', 'loop_iteration': 11})",
    "completed_snapshot = module.research_session_snapshot()",
    "assert completed_snapshot['gate']['status'] == 'pass', completed_snapshot['gate']",
    "assert completed_snapshot['active_run']['trial_iteration'] is None, completed_snapshot['active_run']",
    "completed_marker = json.loads((root / 'research_trajectory' / 'NEXT_TRIAL.json').read_text(encoding='utf-8'))",
    "assert completed_marker['status'] == 'complete', completed_marker",
    "assert 'Server repair:' not in (root / 'research_trajectory' / 'STATE.md').read_text(encoding='utf-8')",
    "print(json.dumps({'complete_marker': complete_snapshot['active_run']['trial_iteration'], 'pending_marker': pending_snapshot['active_run']['trial_iteration'], 'completed_gate': completed_snapshot['gate']['status'], 'completed_marker_status': completed_marker['status']}))"
  ].join("\n");
  const activeTrialMarkerOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    activeTrialMarkerScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py")
    },
    encoding: "utf8"
  }).trim();
  if (
    !activeTrialMarkerOutput.includes('"complete_marker": 11') ||
    !activeTrialMarkerOutput.includes('"pending_marker": 12') ||
    !activeTrialMarkerOutput.includes('"completed_gate": "pass"') ||
    !activeTrialMarkerOutput.includes('"completed_marker_status": "complete"')
  ) {
    throw new Error(`active trial marker smoke test returned unexpected output: ${activeTrialMarkerOutput}`);
  }

  const resumeForkScript = [
    "import importlib.util, json, os, pathlib, shutil, stat",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "context = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
    "module._CONTEXT.project = context",
    "root = context.root",
    "trials_root = root / 'research_trajectory' / 'trials'",
    "checkpoints_root = root / 'research_trajectory' / 'checkpoints'",
    "archive_root = root / 'archive' / 'resume_forks'",
    "shutil.rmtree(trials_root, ignore_errors=True)",
    "shutil.rmtree(checkpoints_root, ignore_errors=True)",
    "shutil.rmtree(archive_root, ignore_errors=True)",
    "trials_root.mkdir(parents=True, exist_ok=True)",
    "def make_trial(name, summary):",
    "    path = trials_root / name",
    "    path.mkdir(parents=True, exist_ok=True)",
    "    (path / 'PLAN.md').write_text('# Plan\\n', encoding='utf-8')",
    "    (path / 'REPORT.md').write_text('# Report\\n\\n## Summary\\n\\n' + summary + '\\n', encoding='utf-8')",
    "    (path / 'REVIEW.md').write_text('# Review\\n', encoding='utf-8')",
    "    return path",
    "base = make_trial('000001_base_boundary', 'Base checkpoint trial.')",
    "later = make_trial('000002_later_superseded', 'Later trial to archive.')",
    "(root / 'PROJECT.md').write_text('# Checkpoint project\\n', encoding='utf-8')",
    "(root / 'research_trajectory' / 'STATE.md').write_text('# Research State\\n\\n## Autoresearch Goal Gate\\n\\nStatus: continue\\n', encoding='utf-8')",
    "(root / 'research_trajectory' / 'CURRENT_FINDINGS.md').write_text('# Findings at checkpoint\\n', encoding='utf-8')",
    "(root / 'manuscript' / 'BLUEPRINT.md').write_text('# Manuscript at checkpoint\\n', encoding='utf-8')",
    "(root / 'resources' / 'user_input' / 'RESOURCE_MANIFEST.md').write_text('# Manifest at checkpoint\\n', encoding='utf-8')",
    "base_trial = module.active_reported_trials()[0]",
    "checkpoint = module.write_trial_checkpoint(base_trial)",
    "assert checkpoint['created'] is True, checkpoint",
    "checkpoint_state = root / checkpoint['path'] / 'research_trajectory' / 'STATE.md'",
    "checkpoint_state.chmod(stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)",
    "assert not (checkpoint_state.stat().st_mode & stat.S_IWUSR), oct(checkpoint_state.stat().st_mode)",
    "(root / 'PROJECT.md').write_text('# Later project should be restored away\\n', encoding='utf-8')",
    "calls = []",
    "def fake_start(prompt, *args, **kwargs):",
    "    calls.append({'prompt': prompt, 'kwargs': kwargs})",
    "    return {'ok': True, 'kwargs': kwargs}",
    "module.start_research_run = fake_start",
    "context.session.update({'process': None, 'loop_active': False, 'mode': 'goal', 'loop_iteration': 0, 'logs': [], 'raw_logs': [], 'transcript': []})",
    "result = module.start_resume_from_trial({'resumeFromTrial': {'id': '000001_base_boundary', 'path': 'research_trajectory/trials/000001_base_boundary'}, 'settings': {'reviewCheckpointInterval': 5}}, 'resume from checkpoint', {'saved_files': [], 'resource_links': [], 'resource_clues': [], 'metadata_files': []})",
    "fork = result['files']['resume_fork']",
    "assert fork['fork_sequence'] == 1, fork",
    "assert pathlib.Path(root / fork['fork_manifest']).read_text(encoding='utf-8').startswith('# Resume Fork F0001'), fork",
    "assert fork['restore_mode'] == 'checkpoint', fork",
    "restored_state = root / 'research_trajectory' / 'STATE.md'",
    "assert restored_state.stat().st_mode & stat.S_IWUSR, oct(restored_state.stat().st_mode)",
    "assert not later.exists(), 'later checkpoint trial should be archived'",
    "assert fork['archived_trials'] and fork['archived_trials'][0]['from'].endswith('000002_later_superseded'), fork",
    "assert '# Checkpoint project' in (root / 'PROJECT.md').read_text(encoding='utf-8')",
    "assert calls and calls[0]['kwargs']['resume'] is False, calls",
    "assert 'archived' in calls[0]['prompt'].lower(), calls[0]['prompt']",
    "assert 'The next active trial is Trial 2' in calls[0]['prompt'], calls[0]['prompt']",
    "shutil.rmtree(trials_root, ignore_errors=True)",
    "shutil.rmtree(checkpoints_root, ignore_errors=True)",
    "trials_root.mkdir(parents=True, exist_ok=True)",
    "best_base = make_trial('000010_best_effort_base', 'Best effort base trial.')",
    "best_later = make_trial('000011_best_effort_later', 'Best effort later trial.')",
    "(root / 'PROJECT.md').write_text('# Best effort current project\\n', encoding='utf-8')",
    "calls.clear()",
    "context.session.update({'process': None, 'loop_active': False, 'mode': 'goal', 'loop_iteration': 0, 'logs': [], 'raw_logs': [], 'transcript': []})",
    "best = module.start_resume_from_trial({'resumeFromTrial': {'id': '000010_best_effort_base', 'path': 'research_trajectory/trials/000010_best_effort_base'}, 'settings': {}}, 'resume without checkpoint', {'saved_files': [], 'resource_links': [], 'resource_clues': [], 'metadata_files': []})",
    "best_fork = best['files']['resume_fork']",
    "assert best_fork['fork_sequence'] == 2, best_fork",
    "assert best_fork['restore_mode'] == 'best_effort', best_fork",
    "assert not best_later.exists(), 'later best-effort trial should be archived'",
    "assert '# Best effort current project' in (root / 'PROJECT.md').read_text(encoding='utf-8')",
    "assert 'best-effort fork' in calls[0]['prompt'].lower(), calls[0]['prompt']",
    "index_text = pathlib.Path(root / best_fork['fork_index']).read_text(encoding='utf-8')",
    "assert '## F0001' in index_text and '## F0002' in index_text, index_text",
    "assert 'resume from checkpoint' in index_text and 'resume without checkpoint' in index_text, index_text",
    "print(json.dumps({'checkpoint': fork['restore_mode'], 'best_effort': best_fork['restore_mode'], 'archived': len(fork['archived_trials']) + len(best_fork['archived_trials']), 'sequences': [fork['fork_sequence'], best_fork['fork_sequence']]}))"
  ].join("\n");
  const resumeForkOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    resumeForkScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (!resumeForkOutput.includes('"checkpoint": "checkpoint"') || !resumeForkOutput.includes('"best_effort": "best_effort"')) {
    throw new Error(`resume-from-trial smoke test returned unexpected output: ${resumeForkOutput}`);
  }

  const restartScript = [
    "import importlib.util, json, os, pathlib, shutil",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "context = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
    "module._CONTEXT.project = context",
    "root = context.root",
    "trials_root = root / 'research_trajectory' / 'trials'",
    "checkpoints_root = root / 'research_trajectory' / 'checkpoints'",
    "workspace_root = root / 'workspace'",
    "restart_root = root / 'archive' / 'restarts'",
    "user_resource = root / 'resources' / 'user_input' / 'attachments' / 'user_note.md'",
    "unknown_resource = root / 'resources' / 'target_venue' / 'unknown_seed.md'",
    "generated_resource = root / 'resources' / 'literature' / 'generated_source.md'",
    "shutil.rmtree(trials_root, ignore_errors=True)",
    "shutil.rmtree(checkpoints_root, ignore_errors=True)",
    "shutil.rmtree(workspace_root, ignore_errors=True)",
    "shutil.rmtree(restart_root, ignore_errors=True)",
    "trials_root.mkdir(parents=True, exist_ok=True)",
    "checkpoints_root.mkdir(parents=True, exist_ok=True)",
    "workspace_root.mkdir(parents=True, exist_ok=True)",
    "for name in ['000001_old', '000002_old']:",
    "    path = trials_root / name",
    "    path.mkdir(parents=True, exist_ok=True)",
    "    (path / 'PLAN.md').write_text('# Plan\\n', encoding='utf-8')",
    "    (path / 'REPORT.md').write_text('# Report\\n', encoding='utf-8')",
    "(checkpoints_root / '000001_old').mkdir(parents=True, exist_ok=True)",
    "(workspace_root / 'generated_note.md').write_text('generated\\n', encoding='utf-8')",
    "user_resource.parent.mkdir(parents=True, exist_ok=True)",
    "unknown_resource.parent.mkdir(parents=True, exist_ok=True)",
    "generated_resource.parent.mkdir(parents=True, exist_ok=True)",
    "user_resource.write_text('user\\n', encoding='utf-8')",
    "unknown_resource.write_text('unknown\\n', encoding='utf-8')",
    "generated_resource.write_text('generated\\n', encoding='utf-8')",
    "(root / 'research_trajectory' / 'CURRENT_FINDINGS.md').write_text('# Old findings\\n', encoding='utf-8')",
    "(root / 'resources' / 'user_input' / 'RESOURCE_MANIFEST.md').write_text(\"\"\"# Old manifest\n\n## Attached Resources\n\n- upload copied: `resources/user_input/attachments/user_note.md`\n  - Provenance: `user_explicit`\n- discovered seed: `resources/target_venue/unknown_seed.md`\n  - Provenance: `unknown`\n- generated source: `resources/literature/generated_source.md`\n  - Provenance: `autoresearch_generated`\n\"\"\", encoding='utf-8')",
    "calls = []",
    "def fake_start(prompt, *args, **kwargs):",
    "    calls.append({'prompt': prompt, 'kwargs': kwargs})",
    "    return {'ok': True, 'kwargs': kwargs}",
    "module.start_research_run = fake_start",
    "context.session.update({'process': None, 'loop_active': False, 'mode': 'goal', 'loop_iteration': 12, 'logs': [], 'raw_logs': [], 'transcript': []})",
    "result = module.start_restart_autoresearch({'message': 'clean restart', 'settings': {'reviewCheckpointInterval': 7}})",
    "restart = result['files']['restart']",
    "manifest = json.loads((root / restart['restart_manifest']).read_text(encoding='utf-8'))",
    "assert restart['restart_sequence'] == 1, restart",
    "assert manifest['resource_policy']['retained'] == ['user_confirmed', 'user_explicit'], manifest",
    "assert len(manifest['retained_resource_entries']) == 1, manifest",
    "assert len(manifest['inactive_resource_entries']) == 2, manifest",
    "assert not any(path.is_dir() for path in trials_root.iterdir() if path.name != '.gitkeep'), list(trials_root.iterdir())",
    "assert not any(path.is_dir() for path in checkpoints_root.iterdir() if path.name != '.gitkeep'), list(checkpoints_root.iterdir())",
    "assert not (workspace_root / 'generated_note.md').exists(), 'workspace generated artifact should be archived'",
    "assert user_resource.exists(), 'user-explicit resource should remain active'",
    "assert not unknown_resource.exists(), 'unknown resource should be moved out of active resources'",
    "assert not generated_resource.exists(), 'autoresearch-generated resource should be moved out of active resources'",
    "inactive_root = root / 'archive' / 'restarts' / pathlib.Path(restart['restart_manifest']).parent.name / 'inactive_resources'",
    "assert (inactive_root / 'resources' / 'target_venue' / 'unknown_seed.md').exists(), inactive_root",
    "assert (inactive_root / 'resources' / 'literature' / 'generated_source.md').exists(), inactive_root",
    "assert (root / 'archive' / 'restarts' / pathlib.Path(restart['restart_manifest']).parent.name / 'archived_trials').exists(), restart",
    "trajectory = json.loads((root / 'research_trajectory' / 'TRAJECTORY.json').read_text(encoding='utf-8'))",
    "assert trajectory['next_trial_number'] == 1 and trajectory['restart_id'] == restart['restart_id'], trajectory",
    "assert 'Restart Resource Policy' in (root / 'resources' / 'user_input' / 'RESOURCE_MANIFEST.md').read_text(encoding='utf-8')",
    "assert calls and calls[0]['kwargs']['loop_iteration_override'] == 1, calls",
    "assert 'Start a new active trajectory at Trial 1' in calls[0]['prompt'], calls[0]['prompt']",
    "print(json.dumps({'restart_id': restart['restart_id'], 'moved': len(restart['moved_paths']), 'next': trajectory['next_trial_number']}))"
  ].join("\n");
  const restartOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    restartScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (!restartOutput.includes('"next": 1') || !restartOutput.includes('"moved":')) {
    throw new Error(`restart smoke test returned unexpected output: ${restartOutput}`);
  }

  const occupied = await reserveFallbackTestPort();
  try {
    const fallbackOutput = execFileSync(python.command, [
      ...python.args,
      "-c",
      [
        "import importlib.util, os, pathlib",
        "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
        "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
        "module = importlib.util.module_from_spec(spec)",
        "spec.loader.exec_module(module)",
        "requested = int(os.environ['COAUTO_OCCUPIED_PORT'])",
        "httpd, bound = module.bind_http_server('127.0.0.1', requested)",
        "print(bound)",
        "httpd.server_close()",
        "assert bound != requested, bound"
      ].join("; ")
    ], {
      cwd: root,
      env: {
        ...process.env,
        COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
        COAUTO_OCCUPIED_PORT: String(occupied.port)
      },
      encoding: "utf8"
    }).trim();
    const boundPort = Number(fallbackOutput);
    if (boundPort === occupied.port) {
      throw new Error("UI did not move away from an occupied port");
    }
    if (!Number.isInteger(boundPort) || boundPort < 1 || boundPort > 65535) {
      throw new Error(`Python fallback test returned an invalid port: ${fallbackOutput}`);
    }
  } finally {
    await closeServer(occupied.server);
  }

  const registryOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    [
      "import importlib.util, json, os, pathlib, shutil, subprocess, sys, time, zipfile",
      "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
      "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "temp_root = pathlib.Path(os.environ['COAUTO_TEMP_ROOT'])",
      "project_dir = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT'])",
      "single = module.ProjectRegistry(project_dir)",
      "single_projects = single.summaries()",
      "assert len(single_projects) == 1 and not single.multi_project, single_projects",
      "created_sibling = single.create_project({'name': 'sibling project'})",
      "single_names = sorted(item['display_name'] for item in single.summaries())",
      "assert single.multi_project and single_names == ['project', 'project-two', 'sibling project'], single_names",
      "assert (temp_root / 'sibling_project' / 'AGENTS.md').exists()",
      "default_cwd = temp_root / 'default-dashboard'",
      "default_projects = default_cwd / 'co-autoresearch-projects'",
      "default_cwd.mkdir(exist_ok=True)",
      "empty_dashboard = module.ProjectRegistry(default_cwd, default_projects)",
      "assert empty_dashboard.multi_project and empty_dashboard.summaries() == []",
      "from_ui = empty_dashboard.create_project({'name': 'from ui', 'agentBackend': 'claude'})",
      "assert from_ui['display_name'] == 'from ui', from_ui",
      "assert (default_projects / 'from_ui' / 'AGENTS.md').exists()",
      "from_ui_settings = json.loads((default_projects / 'from_ui' / 'ui' / '.runtime' / 'settings.json').read_text(encoding='utf-8'))",
      "assert from_ui_settings['agent']['backend'] == 'claude', from_ui_settings",
      "dashboard = module.ProjectRegistry(temp_root, temp_root)",
      "names = sorted(item['display_name'] for item in dashboard.summaries())",
      "assert names == ['project', 'project-two', 'sibling project'], names",
      "created = dashboard.create_project({'name': 'ui project'})",
      "assert created['display_name'] == 'ui project', created",
      "assert (temp_root / 'ui_project' / '.co-auto-research' / 'project.json').exists()",
      "renamed = dashboard.rename_project({'project': created['id'], 'name': 'renamed ui project'})",
      "assert renamed['display_name'] == 'renamed ui project', renamed",
      "try:",
      "    dashboard.delete_project({'project': created['id'], 'confirm': 'ui project'})",
      "    raise AssertionError('project deletion did not require exact confirmation name')",
      "except ValueError:",
      "    pass",
      "chat_guard = dashboard.create_project({'name': 'chat guard'})",
      "module.PROJECT_REGISTRY = dashboard",
      "guard_ctx = dashboard.context_for(chat_guard['id'])",
      "with module.using_project(chat_guard['id']):",
      "    state_path = guard_ctx.root / 'research_trajectory' / 'STATE.md'",
      "    original_state = state_path.read_text(encoding='utf-8') if state_path.exists() else None",
      "    snapshot = module.create_chat_protected_snapshot()",
      "    bad_trial = guard_ctx.root / 'research_trajectory' / 'trials' / '000001_wrong_chat_trial'",
      "    bad_trial.mkdir(parents=True)",
      "    (bad_trial / 'REPORT.md').write_text('bad chat trial', encoding='utf-8')",
      "    state_path.parent.mkdir(parents=True, exist_ok=True)",
      "    state_path.write_text('bad chat state', encoding='utf-8')",
      "    restored = module.restore_chat_protected_snapshot(snapshot)",
      "    assert 'research_trajectory/trials' in restored, restored",
      "    assert 'research_trajectory/STATE.md' in restored, restored",
      "    assert not bad_trial.exists()",
      "    if original_state is None:",
      "        assert not state_path.exists()",
      "    else:",
      "        assert state_path.read_text(encoding='utf-8') == original_state",
      "dashboard.delete_project({'project': chat_guard['id'], 'confirm': 'chat guard'})",
      "progress_probe = dashboard.create_project({'name': 'progress probe'})",
      "progress_ctx = dashboard.context_for(progress_probe['id'])",
      "with module.using_project(progress_probe['id']):",
      "    trial_dir = progress_ctx.root / 'research_trajectory' / 'trials' / '000001_progress_probe'",
      "    trial_dir.mkdir(parents=True, exist_ok=True)",
      "    (trial_dir / 'PLAN.md').write_text('# Plan\\n\\n## Objective\\nProbe progress inference.', encoding='utf-8')",
      "    progress = module.collect_trials()[0]['progress']",
      "    assert progress['stage'] == 'working' and progress['stage_index'] == 2, progress",
      "    artifacts = trial_dir / 'artifacts'",
      "    artifacts.mkdir()",
      "    (artifacts / 'note.md').write_text('artifact', encoding='utf-8')",
      "    progress = module.collect_trials()[0]['progress']",
      "    assert progress['stage'] == 'synthesizing' and progress['artifacts_count'] == 1, progress",
      "    (trial_dir / 'REPORT.md').write_text('# Report\\n\\n## Findings\\nProbe report ready.', encoding='utf-8')",
      "    progress = module.collect_trials()[0]['progress']",
      "    assert progress['stage'] == 'reporting' and progress['report_exists'] is True, progress",
      "    reviews = trial_dir / 'reviews'",
      "    reviews.mkdir()",
      "    reviewer_items = list(module.REQUIRED_REVIEWER_OUTPUTS.items())",
      "    for key, config in reviewer_items[:5]:",
      "        (reviews / config['file']).write_text('Decision: pass\\nGate impact: pass\\n', encoding='utf-8')",
      "    progress = module.collect_trials()[0]['progress']",
      "    assert progress['stage'] == 'reviewing' and progress['reviewer_count'] == 5, progress",
      "    for key, config in reviewer_items[5:]:",
      "        (reviews / config['file']).write_text('Decision: pass\\nGate impact: pass\\n', encoding='utf-8')",
      "    gate_lines = ['# Research State', '', '## Autoresearch Goal Gate', '', 'Status: continue', '', 'Required reviewer gates:']",
      "    for key, config in reviewer_items:",
      "        gate_lines.append(f\"- {config['label']}: pass - `research_trajectory/trials/000001_progress_probe/reviews/{config['file']}`\")",
      "    state_path = progress_ctx.root / 'research_trajectory' / 'STATE.md'",
      "    state_path.write_text('\\n'.join(gate_lines), encoding='utf-8')",
      "    progress = module.collect_trials()[0]['progress']",
      "    assert progress['stage'] == 'gate_update' and progress['gate_updated'] is True and progress['reviewer_count'] == 7, progress",
      "dashboard.delete_project({'project': progress_probe['id'], 'confirm': 'progress probe'})",
      "export_probe = dashboard.create_project({'name': 'export probe'})",
      "export_ctx = dashboard.context_for(export_probe['id'])",
      "with module.using_project(export_probe['id']):",
      "    original_threshold = module.EXPORT_CONFIRMATION_BYTES",
      "    try:",
      "        (export_ctx.root / 'PROJECT.md').write_text('# Export Probe\\n', encoding='utf-8')",
      "        (export_ctx.root / 'research_trajectory').mkdir(parents=True, exist_ok=True)",
      "        (export_ctx.root / 'research_trajectory' / 'CURRENT_FINDINGS.md').write_text('# Current Findings\\n\\nFinal finding.', encoding='utf-8')",
      "        artifact_dir = export_ctx.root / 'research_trajectory' / 'trials' / '000001_export' / 'artifacts'",
      "        artifact_dir.mkdir(parents=True, exist_ok=True)",
      "        (artifact_dir / 'final_figure.png').write_bytes(b'final-figure')",
      "        figure_dir = export_ctx.root / 'manuscript' / 'figures'",
      "        figure_dir.mkdir(parents=True, exist_ok=True)",
      "        (export_ctx.root / 'manuscript' / 'BLUEPRINT.md').write_text('Use `research_trajectory/trials/000001_export/artifacts/final_figure.png`.\\n', encoding='utf-8')",
      "        (figure_dir / 'FIGURE_SPECS.md').write_text('Existing source files: `research_trajectory/trials/000001_export/artifacts/final_figure.png`\\n', encoding='utf-8')",
      "        venue_dir = export_ctx.root / 'resources' / 'target_venue'",
      "        venue_dir.mkdir(parents=True, exist_ok=True)",
      "        for name in ['TARGET_VENUE.md', 'STYLE_NOTES.md', 'FIGURE_TABLE_NOTES.md', 'SEED_PAPERS.md']:",
      "            (venue_dir / name).write_text(name + '\\n', encoding='utf-8')",
      "        workspace_dir = export_ctx.root / 'workspace' / 'results'",
      "        workspace_dir.mkdir(parents=True, exist_ok=True)",
      "        (workspace_dir / 'model.bin').write_bytes(b'x' * 64)",
      "        resources_dir = export_ctx.root / 'resources' / 'data_sources'",
      "        resources_dir.mkdir(parents=True, exist_ok=True)",
      "        (resources_dir / 'data.csv').write_text('a,b\\n1,2\\n', encoding='utf-8')",
      "        symlink_created = False",
      "        try:",
      "            os.symlink('/definitely/missing/coauto-export.csv', resources_dir / 'missing.csv')",
      "            symlink_created = True",
      "        except (OSError, NotImplementedError):",
      "            pass",
      "        module.EXPORT_CONFIRMATION_BYTES = 32",
      "        final_estimate = module.export_estimate('final_project')",
      "        assert final_estimate['requires_confirmation'] is True, final_estimate",
      "        final_plan = module.build_export_plan('final_project')",
      "        final_paths = {item['bundle_path'] for item in final_plan['entries']}",
      "        assert 'manuscript/BLUEPRINT.md' in final_paths, final_paths",
      "        assert 'workspace/results/model.bin' in final_paths, final_paths",
      "        assert 'resources/data_sources/data.csv' in final_paths, final_paths",
      "        assert not any(path.startswith('research_trajectory/') for path in final_paths), final_paths",
      "        if symlink_created:",
      "            assert any(item['path'] == 'resources/data_sources/missing.csv' for item in final_estimate['missing_externals']), final_estimate['missing_externals']",
      "        blueprint_estimate = module.export_estimate('blueprint')",
      "        blueprint_paths = {item['bundle_path'] for item in blueprint_estimate['largest_files']}",
      "        assert 'FINDINGS.md' in blueprint_paths, blueprint_paths",
      "        assert any(path.startswith('assets/') for path in blueprint_paths), blueprint_paths",
      "        assert not any(path.startswith('research_trajectory/') for path in blueprint_paths), blueprint_paths",
      "        job = module.start_export({'kind': 'blueprint', 'confirmed': True})",
      "        deadline = time.time() + 10",
      "        status = job",
      "        while status['status'] == 'packaging' and time.time() < deadline:",
      "            time.sleep(0.05)",
      "            status = module.export_status(job['id'])",
      "        assert status['status'] == 'ready', status",
      "        zip_path = pathlib.Path(module.EXPORT_JOBS[job['id']]['zip_path'])",
      "        assert zip_path.exists(), zip_path",
      "        with zipfile.ZipFile(zip_path) as archive:",
      "            names = set(archive.namelist())",
      "            assert {'README.md', 'PROJECT.md', 'BLUEPRINT.md', 'FIGURE_SPECS.md', 'FINDINGS.md', 'MANIFEST.json'} <= names, names",
      "            assert any(name.startswith('assets/') and name.endswith('final_figure.png') for name in names), names",
      "            assert not any(name.startswith('research_trajectory/') for name in names), names",
      "            manifest = json.loads(archive.read('MANIFEST.json').decode('utf-8'))",
      "            assert any(item['bundle_path'] == 'FINDINGS.md' and item['sha256'] for item in manifest['files']), manifest",
      "    finally:",
      "        module.EXPORT_CONFIRMATION_BYTES = original_threshold",
      "dashboard.delete_project({'project': export_probe['id'], 'confirm': 'export probe'})",
      "ctx = dashboard.context_for(created['id'])",
      "proc = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])",
      "ctx.session['process'] = proc",
      "ctx.session['status'] = 'running'",
      "deleted = dashboard.delete_project({'project': created['id'], 'confirm': 'renamed ui project'})",
      "assert deleted['stopped_active_run'] is True, deleted",
      "assert proc.poll() is not None, proc.poll()",
      "assert all(item['id'] != created['id'] for item in deleted['projects'])",
      "assert not (temp_root / 'ui_project').exists()",
      "print(json.dumps({'single': single_names, 'default': from_ui['display_name'], 'renamed': renamed['display_name'], 'deleted': deleted['deleted_project_id']}))"
    ].join("\n")
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_TEMPLATE_ROOT: path.join(root, "templates", "default"),
      COAUTO_TEMP_ROOT: tempRoot,
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (!registryOutput.includes("renamed ui project")) {
    throw new Error(`project registry smoke test returned unexpected output: ${registryOutput}`);
  }
  console.log("Smoke test passed.");
} finally {
  await fsp.rm(tempRoot, { recursive: true, force: true });
}
