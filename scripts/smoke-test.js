#!/usr/bin/env node

import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const cli = path.join(root, "bin", "auto-research.js");
const npmCli = process.platform === "win32" ? "npm.cmd" : "npm";

function execCommandSync(command, args, options = {}) {
  const commandNeedsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  return execFileSync(command, args, {
    ...options,
    shell: commandNeedsShell ? true : options.shell
  });
}

function execNpmSync(args, options = {}) {
  return execCommandSync(npmCli, args, options);
}
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "co-auto-research-smoke-"));
const projectDir = path.join(tempRoot, "project");
const projectTwoDir = path.join(tempRoot, "project-two");
let nextTestPort = 32100;

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ");
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeTempRootBestEffort(target) {
  const timeoutMs = process.platform === "win32" ? 3000 : 8000;
  const result = await Promise.race([
    fsp.rm(target, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 }).then(
      () => ({ ok: true }),
      (error) => ({ error })
    ),
    sleepMs(timeoutMs).then(() => ({ timeout: true }))
  ]);
  if (result.ok) return;
  const reason = result.timeout ? `timed out after ${timeoutMs}ms` : (result.error?.message || result.error);
  console.warn(`Warning: could not remove smoke-test temp directory ${target}: ${reason}`);
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

function waitForProcessOutput(proc, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for process output:\n${output}`));
    }, timeoutMs);
    const handleChunk = (chunk) => {
      output += chunk.toString();
      if (predicate(output)) {
        clearTimeout(timeout);
        resolve(output);
      }
    };
    proc.stdout?.on("data", handleChunk);
    proc.stderr?.on("data", handleChunk);
    proc.once("exit", (code, signal) => {
      if (!predicate(output)) {
        clearTimeout(timeout);
        reject(new Error(`Process exited before expected output (code=${code}, signal=${signal}):\n${output}`));
      }
    });
  });
}

async function terminateProcess(proc) {
  if (proc.exitCode !== null || proc.signalCode) return;
  proc.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => proc.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  if (proc.exitCode === null && !proc.signalCode) proc.kill("SIGKILL");
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
  for (const theme of ["atelier-ivory", "atelier-nocturne"]) {
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
  const cmdCloudflared = path.join(directory, "cloudflared.cmd");
  const cmdGraftcp = path.join(directory, "graftcp.cmd");
  await fsp.writeFile(
    cmdCodex,
    "@echo off\r\nif \"%1\"==\"login\" if \"%2\"==\"status\" (echo Logged in& exit /b 0)\r\necho codex fake 0.0.0\r\n",
    "utf8"
  );
  await fsp.writeFile(
    cmdClaude,
    "@echo off\r\nif \"%1\"==\"auth\" if \"%2\"==\"status\" (echo {\"authenticated\":true}& exit /b 0)\r\necho claude fake 0.0.0\r\n",
    "utf8"
  );
  await fsp.writeFile(cmdCloudflared, "@echo off\r\necho cloudflared fake 0.0.0\r\n", "utf8");
  await fsp.writeFile(cmdGraftcp, "@echo off\r\necho graftcp fake 0.0.0\r\n", "utf8");
  if (process.platform !== "win32") {
    const shellCodex = path.join(directory, "codex");
    const shellClaude = path.join(directory, "claude");
    const shellCloudflared = path.join(directory, "cloudflared");
    const shellGraftcp = path.join(directory, "graftcp");
    await fsp.writeFile(
      shellCodex,
      "#!/bin/sh\nif [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then echo Logged in; exit 0; fi\necho codex fake 0.0.0\n",
      "utf8"
    );
    await fsp.writeFile(
      shellClaude,
      "#!/bin/sh\nif [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then printf '%s\\n' '{\"authenticated\":true}'; exit 0; fi\necho claude fake 0.0.0\n",
      "utf8"
    );
    await fsp.writeFile(shellCloudflared, "#!/bin/sh\necho cloudflared fake 0.0.0\n", "utf8");
    await fsp.writeFile(shellGraftcp, "#!/bin/sh\necho graftcp fake 0.0.0\n", "utf8");
    await fsp.chmod(shellCodex, 0o755);
    await fsp.chmod(shellClaude, 0o755);
    await fsp.chmod(shellCloudflared, 0o755);
    await fsp.chmod(shellGraftcp, 0o755);
    await fsp.chmod(cmdCodex, 0o755);
    await fsp.chmod(cmdClaude, 0o755);
    await fsp.chmod(cmdCloudflared, 0o755);
    await fsp.chmod(cmdGraftcp, 0o755);
  }
}

async function runRemoteCliSmoke(extraEnv, expected, extraArgs = []) {
  const port = await freePort();
  const proc = spawn("node", [cli, "ui", "--project", projectDir, "--remote", "--port", String(port), ...extraArgs], {
    cwd: root,
    env: { ...process.env, COAUTO_REMOTE_PROXY_MODE: "off", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const output = await waitForProcessOutput(proc, expected.waitFor, 15000);
    await expected.assert(output);
  } finally {
    await terminateProcess(proc);
  }
}

async function smokeRemoteCloudflareLink() {
  await runRemoteCliSmoke(
    { COAUTO_REMOTE_TUNNEL_MOCK_URL: "https://example.trycloudflare.com" },
    {
      waitFor: (output) => output.includes("https://example.trycloudflare.com") && output.includes("Keep this terminal open."),
      assert: (output) => {
        if (!output.includes("Open:")) {
          throw new Error(`remote Cloudflare output should use compact Open heading:\n${output}`);
        }
        if (!output.includes("https://example.trycloudflare.com")) {
          throw new Error(`remote Cloudflare mock URL should be printed:\n${output}`);
        }
        if (output.includes("coauto_token")) {
          throw new Error(`remote Cloudflare URL should not expose a query token:\n${output}`);
        }
        if (!output.includes("Keep this terminal open. Press Ctrl+C to stop.")) {
          throw new Error(`remote Cloudflare output should explain lifecycle:\n${output}`);
        }
        if (output.includes("ssh -N -L")) {
          throw new Error(`remote Cloudflare success should not show SSH tunnel as primary output:\n${output}`);
        }
      }
    }
  );
}

async function smokeRemoteCloudflareParserIgnoresApiUrl() {
  if (process.platform === "win32") return;
  const fakeCloudflared = path.join(tempRoot, "fake-cloudflared-parser");
  await fsp.writeFile(
    fakeCloudflared,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo cloudflared fake parser 0.0.0; exit 0; fi",
      "printf '%s\\n' 'request to https://api.trycloudflare.com/tunnel\": ignored' >&2",
      "printf '%s\\n' 'quick tunnel https://parser-good.trycloudflare.com ready' >&2",
      "while true; do /bin/sleep 1; done"
    ].join("\n"),
    "utf8"
  );
  await fsp.chmod(fakeCloudflared, 0o755);
  await runRemoteCliSmoke(
    { COAUTO_CLOUDFLARED: fakeCloudflared },
    {
      waitFor: (output) => output.includes("https://parser-good.trycloudflare.com") && output.includes("Keep this terminal open."),
      assert: (output) => {
        if (output.includes("api.trycloudflare.com") || output.includes("coauto_token")) {
          throw new Error(`remote Cloudflare parser should ignore API URLs and avoid tokens:\n${output}`);
        }
      }
    }
  );
}

async function smokeRemoteCloudflareTimeoutSummary() {
  if (process.platform === "win32") return;
  const fakeCloudflared = path.join(tempRoot, "fake-cloudflared-timeout");
  await fsp.writeFile(
    fakeCloudflared,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo cloudflared fake timeout 0.0.0; exit 0; fi",
      "printf '%s\\n' '2026-06-25T23:37:58Z INF Thank you for trying Cloudflare Tunnel.' >&2",
      "printf '%s\\n' 'failed to request quick Tunnel: Post \"https://api.trycloudflare.com/tunnel\": context deadline exceeded (Client.Timeout exceeded while awaiting headers)' >&2",
      "exit 1"
    ].join("\n"),
    "utf8"
  );
  await fsp.chmod(fakeCloudflared, 0o755);
  await runRemoteCliSmoke(
    { COAUTO_CLOUDFLARED: fakeCloudflared, COAUTO_REMOTE_TUNNEL_RETRY_DELAY_MS: "10", npm_command: "exec", npm_lifecycle_event: "npx" },
    {
      waitFor: (output) => output.includes("Cloudflare link failed:") && output.includes("Details: failed to request quick Tunnel: Post \"https://api.trycloudflare.com/tunnel\": context deadline exceeded"),
      assert: (output) => {
        if (!output.includes("Details: failed to request quick Tunnel: Post \"https://api.trycloudflare.com/tunnel\": context deadline exceeded")) {
          throw new Error(`Cloudflare timeout should include the actionable failed request line:\n${output}`);
        }
        if (!output.includes("Cloudflare link attempt 1/3 failed:") || !output.includes("Retrying in 10ms")) {
          throw new Error(`Cloudflare timeout should log retry attempts:\n${output}`);
        }
        if (output.includes("Thank you for trying Cloudflare Tunnel")) {
          throw new Error(`Cloudflare timeout should not print the long informational banner:\n${output}`);
        }
      }
    }
  );
}

async function smokeRemoteCloudflareTimeoutSuggestsGraftcp() {
  if (process.platform === "win32") return;
  const fakeCloudflared = path.join(tempRoot, "fake-cloudflared-timeout-proxy");
  await fsp.writeFile(
    fakeCloudflared,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo cloudflared fake timeout proxy 0.0.0; exit 0; fi",
      "printf '%s\\n' 'failed to request quick Tunnel: Post \"https://api.trycloudflare.com/tunnel\": context deadline exceeded (Client.Timeout exceeded while awaiting headers)' >&2",
      "exit 1"
    ].join("\n"),
    "utf8"
  );
  await fsp.chmod(fakeCloudflared, 0o755);
  await runRemoteCliSmoke(
    {
      COAUTO_CLOUDFLARED: fakeCloudflared,
      COAUTO_REMOTE_TUNNEL_RETRY_DELAY_MS: "10",
      COAUTO_REMOTE_PROXY_MODE: "off",
      HTTPS_PROXY: "http://10.21.11.21:8888",
      npm_command: "exec",
      npm_lifecycle_event: "npx"
    },
    {
      waitFor: (output) => output.includes("Cloudflare link failed:") && output.includes("cloudflared may bypass proxy environment variables") && output.includes("COAUTO_REMOTE_PROXY_MODE=off"),
      assert: (output) => {
        if (!output.includes("cloudflared may bypass proxy environment variables") || !output.includes("COAUTO_REMOTE_PROXY_MODE=off")) {
          throw new Error(`Cloudflare timeout with proxy env should explain proxy bypass and disabled helper mode:\n${output}`);
        }
        if (!output.includes("Cloudflare link attempt 1/3 failed:") || !output.includes("Retrying in 10ms")) {
          throw new Error(`Cloudflare timeout with proxy env should log retry attempts:\n${output}`);
        }
      }
    }
  );
}

async function writeFakeCloudflaredTunnel(target, url) {
  await fsp.writeFile(
    target,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then echo cloudflared fake tunnel 0.0.0; exit 0; fi",
      `printf '%s\\n' 'quick tunnel ${url} ready' >&2`,
      "while true; do /bin/sleep 1; done"
    ].join("\n"),
    "utf8"
  );
  await fsp.chmod(target, 0o755);
}

async function writeFakeGraftcpTunnel(target, recordPath, url) {
  await fsp.writeFile(
    target,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--help\" ]; then echo graftcp fake tunnel 0.0.0; exit 0; fi",
      `printf '%s\\n' "$*" > ${JSON.stringify(recordPath)}`,
      `printf '%s\\n' 'quick tunnel ${url} ready' >&2`,
      "while true; do /bin/sleep 1; done"
    ].join("\n"),
    "utf8"
  );
  await fsp.chmod(target, 0o755);
}

async function smokeRemoteProxyUsesGraftcp() {
  if (process.platform !== "linux") return;
  const fakeCloudflared = path.join(tempRoot, "fake-cloudflared-proxy");
  const fakeGraftcp = path.join(tempRoot, "fake-graftcp-proxy");
  const recordPath = path.join(tempRoot, "graftcp-proxy.args");
  await writeFakeCloudflaredTunnel(fakeCloudflared, "https://proxy-good.trycloudflare.com");
  await writeFakeGraftcpTunnel(fakeGraftcp, recordPath, "https://proxy-good.trycloudflare.com");
  await runRemoteCliSmoke(
    {
      COAUTO_CLOUDFLARED: fakeCloudflared,
      COAUTO_GRAFTCP: fakeGraftcp,
      COAUTO_REMOTE_PROXY_MODE: "",
      HTTPS_PROXY: "http://10.21.11.21:8888"
    },
    {
      waitFor: (output) => output.includes("https://proxy-good.trycloudflare.com") && output.includes("Keep this terminal open."),
      assert: async (output) => {
        const args = await fsp.readFile(recordPath, "utf8");
        if (!output.includes("https://proxy-good.trycloudflare.com")) {
          throw new Error(`proxy remote should print the graftcp tunnel URL:\n${output}`);
        }
        if (!args.includes("--select_proxy_mode only_http_proxy") || !args.includes("--http_proxy 10.21.11.21:8888") || !args.includes("--protocol http2")) {
          throw new Error(`proxy remote should wrap cloudflared with graftcp and force http2:\n${args}`);
        }
      }
    }
  );
}

async function smokeRemoteProxyOptionOverridesEnv() {
  if (process.platform !== "linux") return;
  const fakeCloudflared = path.join(tempRoot, "fake-cloudflared-proxy-override");
  const fakeGraftcp = path.join(tempRoot, "fake-graftcp-proxy-override");
  const recordPath = path.join(tempRoot, "graftcp-proxy-override.args");
  await writeFakeCloudflaredTunnel(fakeCloudflared, "https://proxy-override.trycloudflare.com");
  await writeFakeGraftcpTunnel(fakeGraftcp, recordPath, "https://proxy-override.trycloudflare.com");
  await runRemoteCliSmoke(
    {
      COAUTO_CLOUDFLARED: fakeCloudflared,
      COAUTO_GRAFTCP: fakeGraftcp,
      COAUTO_REMOTE_PROXY_MODE: "",
      HTTPS_PROXY: "http://wrong.proxy:1111"
    },
    {
      waitFor: (output) => output.includes("https://proxy-override.trycloudflare.com") && output.includes("Keep this terminal open."),
      assert: async () => {
        const args = await fsp.readFile(recordPath, "utf8");
        if (!args.includes("--http_proxy right.proxy:9999") || args.includes("wrong.proxy")) {
          throw new Error(`--proxy should override proxy environment variables:\n${args}`);
        }
      }
    },
    ["--proxy", "http://right.proxy:9999"]
  );
}

async function smokeRemoteProxyModeOffDisablesGraftcp() {
  if (process.platform === "win32") return;
  const fakeCloudflared = path.join(tempRoot, "fake-cloudflared-proxy-off");
  const fakeGraftcp = path.join(tempRoot, "fake-graftcp-proxy-off");
  const recordPath = path.join(tempRoot, "graftcp-proxy-off.args");
  await writeFakeCloudflaredTunnel(fakeCloudflared, "https://proxy-off.trycloudflare.com");
  await writeFakeGraftcpTunnel(fakeGraftcp, recordPath, "https://should-not-use-graftcp.trycloudflare.com");
  await runRemoteCliSmoke(
    {
      COAUTO_CLOUDFLARED: fakeCloudflared,
      COAUTO_GRAFTCP: fakeGraftcp,
      COAUTO_REMOTE_PROXY_MODE: "off",
      HTTPS_PROXY: "http://10.21.11.21:8888"
    },
    {
      waitFor: (output) => output.includes("https://proxy-off.trycloudflare.com") && output.includes("Keep this terminal open."),
      assert: async (output) => {
        if (!output.includes("https://proxy-off.trycloudflare.com")) {
          throw new Error(`proxy mode off should use direct cloudflared output:\n${output}`);
        }
        let usedGraftcp = false;
        try {
          await fsp.access(recordPath);
          usedGraftcp = true;
        } catch {
          usedGraftcp = false;
        }
        if (usedGraftcp) {
          throw new Error("COAUTO_REMOTE_PROXY_MODE=off should not invoke graftcp");
        }
      }
    }
  );
}

async function smokeRemoteCloudflaredMissing() {
  await runRemoteCliSmoke(
    { COAUTO_CLOUDFLARED: path.join(tempRoot, "missing-cloudflared"), npm_command: "exec", npm_lifecycle_event: "npx" },
    {
      waitFor: (output) => output.includes("Remote mode needs cloudflared to create a browser link.") && output.includes("https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"),
      assert: (output) => {
        if (
          !output.includes("1. Install cloudflared") ||
          !output.includes("Linux (no sudo):") ||
          !output.includes("npx --yes co-auto-research install-cloudflared") ||
          output.includes("cloudflared-linux-${arch}") ||
          output.includes("sudo apt-get install cloudflared") ||
          !output.includes("brew install cloudflared") ||
          !output.includes("winget install -e --id Cloudflare.cloudflared") ||
          !output.includes("2. Run") ||
          !output.includes("npx --yes co-auto-research ui --remote") ||
          !output.includes("3. Check") ||
          !output.includes("npx --yes co-auto-research doctor")
        ) {
          throw new Error(`missing cloudflared output should include setup-style install, run, and check steps:\n${output}`);
        }
        if (!output.includes("https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/")) {
          throw new Error(`missing cloudflared output should include official downloads page:\n${output}`);
        }
        if (output.includes("CoAutoResearch UI serving")) {
          throw new Error(`missing cloudflared should be detected before starting the UI server:\n${output}`);
        }
        if (output.includes("ssh -N -L")) {
          throw new Error(`missing cloudflared should not default to SSH tunnel instructions:\n${output}`);
        }
      }
    }
  );
}

async function smokeRemoteGraftcpMissing() {
  if (process.platform !== "linux") return;
  const fakeCloudflared = path.join(tempRoot, "fake-cloudflared-graftcp-missing");
  await writeFakeCloudflaredTunnel(fakeCloudflared, "https://should-not-start.trycloudflare.com");
  await runRemoteCliSmoke(
    {
      COAUTO_CLOUDFLARED: fakeCloudflared,
      COAUTO_GRAFTCP: path.join(tempRoot, "missing-graftcp"),
      COAUTO_REMOTE_PROXY_MODE: "",
      HTTPS_PROXY: "http://10.21.11.21:8888",
      npm_command: "exec",
      npm_lifecycle_event: "npx"
    },
    {
      waitFor: (output) => output.includes("This server uses an HTTP proxy for internet access.") && output.includes("install-graftcp"),
      assert: (output) => {
        if (!output.includes("npx --yes co-auto-research install-graftcp") || !output.includes("npx --yes co-auto-research ui --remote")) {
          throw new Error(`missing graftcp output should include setup and rerun commands:\n${output}`);
        }
        if (output.includes("CoAutoResearch UI serving") || output.includes("ssh -N -L")) {
          throw new Error(`missing graftcp should be detected before starting the UI and should not print SSH as primary output:\n${output}`);
        }
      }
    }
  );
}

async function smokeRemoteSshMode() {
  await runRemoteCliSmoke(
    { COAUTO_REMOTE_MODE: "ssh" },
    {
      waitFor: (output) => output.includes("ssh -N -L"),
      assert: (output) => {
        if (!output.includes("Remote browser access") || output.includes("Remote browser link:")) {
          throw new Error(`SSH remote mode should print only SSH tunnel instructions:\n${output}`);
        }
      }
    }
  );
}

async function smokeRemoteCloudflareFallback() {
  await runRemoteCliSmoke(
    { COAUTO_REMOTE_TUNNEL_MOCK_FAIL: "1", COAUTO_REMOTE_TUNNEL_RETRY_DELAY_MS: "10", npm_command: "exec", npm_lifecycle_event: "npx" },
    {
      waitFor: (output) => output.includes("Cloudflare link failed:") && output.includes("COAUTO_REMOTE_MODE=ssh npx --yes co-auto-research ui --remote"),
      assert: (output) => {
        if (!output.includes("Check that cloudflared can reach Cloudflare") || !output.includes("COAUTO_REMOTE_MODE=ssh npx --yes co-auto-research ui --remote")) {
          throw new Error(`Cloudflare failure should point to troubleshooting and explicit SSH fallback:\n${output}`);
        }
        if (!output.includes("Cloudflare link attempt 1/3 failed:") || !output.includes("Retrying in 10ms")) {
          throw new Error(`Cloudflare failure should log retry attempts before fallback:\n${output}`);
        }
        if (output.includes("ssh -N -L")) {
          throw new Error(`Cloudflare failure should not print SSH tunnel command by default:\n${output}`);
        }
      }
    }
  );
}

async function smokeInstallCloudflaredCommand() {
  if (process.platform === "win32") return;
  const installDir = path.join(tempRoot, "cloudflared-install");
  const output = execFileSync(process.execPath, [cli, "install-cloudflared"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: "",
      COAUTO_CLOUDFLARED_INSTALL_DIR: installDir,
      COAUTO_CLOUDFLARED_INSTALL_MOCK: "1"
    },
    encoding: "utf8"
  });
  const installedPath = path.join(installDir, "cloudflared");
  let installed = false;
  try {
    await fsp.access(installedPath);
    installed = true;
  } catch {
    installed = false;
  }
  if (!installed || !output.includes(`Installing cloudflared to ${installedPath}`) || !output.includes("Installed cloudflared: cloudflared fake installed 0.0.0")) {
    throw new Error(`install-cloudflared should install into the user install directory:\n${output}`);
  }
  if (!output.includes("npx --yes co-auto-research ui --remote")) {
    throw new Error(`install-cloudflared should print the npx remote command when no global CLI is on PATH:\n${output}`);
  }
}

async function smokeInstallCloudflaredGlobalCommandHint() {
  if (process.platform === "win32") return;
  const installDir = path.join(tempRoot, "cloudflared-global-hint-install");
  const fakeBin = path.join(tempRoot, "fake-coauto-bin");
  await fsp.mkdir(fakeBin, { recursive: true });
  const fakeCoauto = path.join(fakeBin, "co-auto-research");
  await fsp.writeFile(fakeCoauto, "#!/bin/sh\nexit 0\n", "utf8");
  await fsp.chmod(fakeCoauto, 0o755);
  const output = execFileSync(process.execPath, [cli, "install-cloudflared"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: fakeBin,
      COAUTO_CLOUDFLARED_INSTALL_DIR: installDir,
      COAUTO_CLOUDFLARED_INSTALL_MOCK: "1"
    },
    encoding: "utf8"
  });
  if (!output.includes("  co-auto-research ui --remote") || output.includes("npx --yes co-auto-research ui --remote")) {
    throw new Error(`install-cloudflared should print the short command when the CLI is on PATH:\n${output}`);
  }
}

async function smokeInstallCloudflaredUsesCurl() {
  if (process.platform === "win32") return;
  const installDir = path.join(tempRoot, "cloudflared-curl-install");
  const fakeBin = path.join(tempRoot, "fake-curl-bin");
  await fsp.mkdir(fakeBin, { recursive: true });
  const fakeCurl = path.join(fakeBin, "curl");
  await fsp.writeFile(
    fakeCurl,
    [
      "#!/bin/sh",
      "out=\"\"",
      "while [ \"$#\" -gt 0 ]; do",
      "  if [ \"$1\" = \"-o\" ]; then shift; out=\"$1\"; fi",
      "  shift",
      "done",
      "if [ -z \"$out\" ]; then exit 2; fi",
      "printf '%s\\n' '#!/bin/sh' 'echo cloudflared fake curl 0.0.0' > \"$out\""
    ].join("\n"),
    "utf8"
  );
  await fsp.chmod(fakeCurl, 0o755);
  const output = execFileSync(process.execPath, [cli, "install-cloudflared"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: fakeBin,
      COAUTO_CLOUDFLARED_INSTALL_DIR: installDir,
      COAUTO_CLOUDFLARED_DOWNLOAD_URL: "https://example.invalid/cloudflared"
    },
    encoding: "utf8"
  });
  if (!output.includes("Downloading https://example.invalid/cloudflared") || !output.includes("Installed cloudflared: cloudflared fake curl 0.0.0")) {
    throw new Error(`install-cloudflared should prefer curl before fetch:\n${output}`);
  }
}

async function smokeInstallGraftcpCommand() {
  if (process.platform === "win32") return;
  const installDir = path.join(tempRoot, "graftcp-install");
  const output = execFileSync(process.execPath, [cli, "install-graftcp"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: "",
      COAUTO_GRAFTCP_INSTALL_DIR: installDir,
      COAUTO_GRAFTCP_INSTALL_MOCK: "1"
    },
    encoding: "utf8"
  });
  const installedPath = path.join(installDir, "graftcp");
  let installed = false;
  try {
    await fsp.access(installedPath);
    installed = true;
  } catch {
    installed = false;
  }
  if (!installed || !output.includes(`Installing graftcp to ${installedPath}`) || !output.includes("Installed graftcp: graftcp fake installed 0.0.0")) {
    throw new Error(`install-graftcp should install into the user install directory:\n${output}`);
  }
  if (!output.includes("npx --yes co-auto-research ui --remote")) {
    throw new Error(`install-graftcp should print the npx remote command when no global CLI is on PATH:\n${output}`);
  }
}

async function smokeRemoteAuth() {
  const python = findPython();
  const port = await freePort();
  const serverPath = path.join(root, "templates", "default", "ui", "server.py");
  const proc = spawn(python.command, [...python.args, serverPath, "--host", "127.0.0.1", "--port", String(port), "--project-root", projectDir, "--remote"], {
    cwd: projectDir,
    env: { ...process.env, COAUTO_TEMPLATE_ROOT: path.join(root, "templates", "default"), COAUTO_REMOTE_AUTH_TOKEN: "test-token" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForProcessOutput(proc, (output) => output.includes(`Open http://127.0.0.1:${port}`), 15000);
    const baseUrl = `http://127.0.0.1:${port}`;
    const unauthorized = await fetch(`${baseUrl}/api/health`);
    if (unauthorized.status !== 401) {
      throw new Error(`remote auth should reject missing token, got ${unauthorized.status}`);
    }
    const redirect = await fetch(`${baseUrl}/?coauto_token=test-token`, { redirect: "manual" });
    const setCookie = redirect.headers.get("set-cookie") || "";
    if (redirect.status !== 302 || !setCookie.includes("coauto_remote_auth=test-token")) {
      throw new Error(`remote auth should set cookie on tokenized first load, got ${redirect.status} ${setCookie}`);
    }
    const cookie = setCookie.split(";")[0];
    const authorized = await fetch(`${baseUrl}/api/health`, { headers: { Cookie: cookie } });
    if (authorized.status !== 200) {
      throw new Error(`remote auth should accept cookie, got ${authorized.status}`);
    }
    const overview = await fetch(`${baseUrl}/api/overview`, { headers: { Cookie: cookie } });
    const overviewPayload = await overview.json();
    if (overview.status !== 200 || overviewPayload.runtime?.remote !== true) {
      throw new Error(`remote overview should report remote runtime, got ${overview.status} ${JSON.stringify(overviewPayload.runtime)}`);
    }
    const unauthorizedEvents = await fetch(`${baseUrl}/api/research/events`);
    if (unauthorizedEvents.status !== 401) {
      throw new Error(`remote auth should protect research events, got ${unauthorizedEvents.status}`);
    }
    const eventsController = new AbortController();
    const authorizedEvents = await fetch(`${baseUrl}/api/research/events`, { headers: { Cookie: cookie }, signal: eventsController.signal });
    if (authorizedEvents.status !== 200 || !(authorizedEvents.headers.get("content-type") || "").includes("text/event-stream")) {
      throw new Error(`remote auth should allow authorized research events, got ${authorizedEvents.status} ${authorizedEvents.headers.get("content-type")}`);
    }
    await authorizedEvents.body?.cancel();
    eventsController.abort();
    const badToken = await fetch(`${baseUrl}/api/health`, { headers: { Authorization: "Bearer wrong-token" } });
    if (badToken.status !== 401) {
      throw new Error(`remote auth should reject wrong bearer token, got ${badToken.status}`);
    }
    const rawFile = await fetch(`${baseUrl}/api/file/raw?path=README.md`);
    if (rawFile.status !== 401) {
      throw new Error(`remote auth should protect raw files, got ${rawFile.status}`);
    }
    const exportDownload = await fetch(`${baseUrl}/api/export/download?id=missing`);
    if (exportDownload.status !== 401) {
      throw new Error(`remote auth should protect export downloads, got ${exportDownload.status}`);
    }
  } finally {
    await terminateProcess(proc);
  }
}

function parseSseFrame(frame) {
  const event = { event: "message", data: "" };
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) event.event = line.slice("event:".length).trim();
    if (line.startsWith("data:")) event.data += line.slice("data:".length).trimStart();
  }
  if (!event.data) return null;
  return { ...event, payload: JSON.parse(event.data) };
}

function parseLastJsonObjectLine(output, label) {
  const lines = String(output || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    return JSON.parse(line);
  }
  throw new Error(`${label} did not print a JSON probe line:\n${output}`);
}

async function readSseUntil(url, predicate, timeoutMs = 8000, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`SSE request failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const parsed = parseSseFrame(frame);
        if (parsed?.event === "research" && predicate(parsed.payload)) {
          controller.abort();
          clearTimeout(timeout);
          return parsed.payload;
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(timeout);
    try {
      await response?.body?.cancel();
    } catch {
      // The stream may already be aborted.
    }
  }
  throw new Error(`Timed out waiting for SSE event from ${url}`);
}

async function waitForFinalOverview(baseUrl, expectedText, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/overview`);
    lastPayload = await response.json();
    const session = lastPayload.research_session || {};
    const status = String(session.status || "");
    const transcript = Array.isArray(session.transcript) ? session.transcript : [];
    if (!["running", "stopping"].includes(status) && session.returncode === 0 && transcript.some((entry) => String(entry.content || "").includes(expectedText))) {
      return lastPayload;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for final overview with ${expectedText}: ${JSON.stringify(lastPayload?.research_session || {})}`);
}

async function waitForCompletedOverview(baseUrl, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/overview`);
    lastPayload = await response.json();
    const session = lastPayload.research_session || {};
    const status = String(session.status || "");
    if (!["running", "stopping"].includes(status) && session.returncode === 0) {
      return lastPayload;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for completed overview: ${JSON.stringify(lastPayload?.research_session || {})}`);
}

async function writeStreamingFakeAgents(directory) {
  await fsp.mkdir(directory, { recursive: true });
  const codex = path.join(directory, "codex");
  const claude = path.join(directory, "claude");
  await fsp.writeFile(
    codex,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then echo Logged in; exit 0; fi",
      "if [ \"$1\" = \"--version\" ]; then echo codex fake stream 0.0.0; exit 0; fi",
      "printf '%s\\n' '{\"type\":\"thread.started\",\"session_id\":\"codex-stream-session\"}'",
      "sleep 0.15",
      "printf '%s\\n' '{\"type\":\"item.agentMessage.delta\",\"delta\":\"Hello \"}'",
      "sleep 0.15",
      "printf '%s\\n' '{\"type\":\"item.agentMessage.delta\",\"delta\":\"Codex\"}'",
      "sleep 0.15",
      "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Hello Codex\"}}'",
      "printf '%s\\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":2}}'",
      "exit 0"
    ].join("\n"),
    "utf8"
  );
  await fsp.writeFile(
    claude,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then printf '%s\\n' '{\"authenticated\":true}'; exit 0; fi",
      "if [ \"$1\" = \"--version\" ]; then echo claude fake stream 0.0.0; exit 0; fi",
      "printf '%s\\n' '{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"claude-stream-session\"}'",
      "sleep 0.15",
      "printf '%s\\n' '{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello \"}}'",
      "sleep 0.15",
      "printf '%s\\n' '{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Claude\"}}'",
      "sleep 0.15",
      "printf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Hello Claude\"}],\"stop_reason\":\"end_turn\"}}'",
      "printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"Hello Claude\",\"session_id\":\"claude-stream-session\"}'",
      "exit 0"
    ].join("\n"),
    "utf8"
  );
  await fsp.chmod(codex, 0o755);
  await fsp.chmod(claude, 0o755);
  return { codex, claude };
}

async function smokeStreamingHttpIntegrationForBackend(backend) {
  if (process.platform === "win32") {
    console.log(`Skipping ${backend} streaming HTTP smoke: POSIX fake agent scripts are not available on Windows.`);
    return;
  }
  const python = findPython();
  const port = await freePort();
  const fakeBin = path.join(tempRoot, `streaming-fake-bin-${backend}`);
  const fakeAgents = await writeStreamingFakeAgents(fakeBin);
  const streamProjectDir = path.join(tempRoot, `streaming-project-${backend}`);
  execFileSync("node", [cli, "init", streamProjectDir], { cwd: root, stdio: "pipe" });
  const serverPath = path.join(root, "templates", "default", "ui", "server.py");
  const proc = spawn(python.command, [...python.args, serverPath, "--host", "127.0.0.1", "--port", String(port), "--project-root", streamProjectDir], {
    cwd: streamProjectDir,
    env: {
      ...process.env,
      COAUTO_TEMPLATE_ROOT: path.join(root, "templates", "default"),
      COAUTO_CODEX: fakeAgents.codex,
      COAUTO_CLAUDE: fakeAgents.claude,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForProcessOutput(proc, (output) => output.includes(`Open http://127.0.0.1:${port}`), 15000);
    const baseUrl = `http://127.0.0.1:${port}`;
    const expected = backend === "claude" ? "Hello Claude" : "Hello Codex";
    const streamed = readSseUntil(
      `${baseUrl}/api/research/events`,
      (payload) => payload.kind === "transcript" && payload.transcript_entry?.streaming === true && String(payload.transcript_entry?.content || "").includes("Hello"),
      8000
    );
    const start = await fetch(`${baseUrl}/api/research/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "stream this harmless smoke response", settings: { backend } })
    });
    const startPayload = await start.json();
    if (start.status !== 200 || startPayload.ok === false) {
      throw new Error(`${backend} streaming chat should start, got ${start.status} ${JSON.stringify(startPayload)}`);
    }
    const streamedPayload = await streamed;
    if (!String(streamedPayload.transcript_entry?.content || "").includes("Hello")) {
      throw new Error(`${backend} SSE should deliver a visible partial transcript before completion: ${JSON.stringify(streamedPayload)}`);
    }
    const finalPayload = await waitForFinalOverview(baseUrl, expected);
    const finalSession = finalPayload.research_session || {};
    if (finalSession.status !== "completed" || finalSession.returncode !== 0) {
      throw new Error(`${backend} final overview should stay consistent after streaming: ${JSON.stringify(finalSession)}`);
    }
  } finally {
    await terminateProcess(proc);
    await fsp.rm(streamProjectDir, { recursive: true, force: true });
  }
}

async function smokeStreamingHttpIntegration() {
  await smokeStreamingHttpIntegrationForBackend("codex");
  await smokeStreamingHttpIntegrationForBackend("claude");
}

function realAgentAuthStatus(backend) {
  const command = backend === "claude" ? (process.env.COAUTO_CLAUDE || "claude") : (process.env.COAUTO_CODEX || "codex");
  const args = backend === "claude" ? ["auth", "status"] : ["login", "status"];
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10000 });
  if (result.error) return { ok: false, command, reason: result.error.message };
  if (result.status !== 0) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    return { ok: false, command, reason: output || `exit ${result.status}` };
  }
  return { ok: true, command, reason: "" };
}

async function smokeRealCliStreamingForBackend(backend, command) {
  const python = findPython();
  const port = await freePort();
  const realProjectDir = path.join(tempRoot, `real-streaming-project-${backend}`);
  execFileSync("node", [cli, "init", realProjectDir], { cwd: root, stdio: "pipe" });
  const serverPath = path.join(root, "templates", "default", "ui", "server.py");
  const env = {
    ...process.env,
    COAUTO_TEMPLATE_ROOT: path.join(root, "templates", "default"),
    ...(backend === "claude" ? { COAUTO_CLAUDE: command } : { COAUTO_CODEX: command })
  };
  const proc = spawn(python.command, [...python.args, serverPath, "--host", "127.0.0.1", "--port", String(port), "--project-root", realProjectDir], {
    cwd: realProjectDir,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForProcessOutput(proc, (output) => output.includes(`Open http://127.0.0.1:${port}`), 15000);
    const baseUrl = `http://127.0.0.1:${port}`;
    const streamed = readSseUntil(
      `${baseUrl}/api/research/events`,
      (payload) => payload.kind === "transcript" && String(payload.transcript_entry?.content || "").trim().length > 0,
      120000
    );
    const start = await fetch(`${baseUrl}/api/research/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Do not edit files. Reply exactly: stream-smoke-ok.",
        settings: { backend }
      })
    });
    const startPayload = await start.json();
    if (start.status !== 200 || startPayload.ok === false) {
      throw new Error(`${backend} real streaming chat should start, got ${start.status} ${JSON.stringify(startPayload)}`);
    }
    await streamed;
    const finalPayload = await waitForCompletedOverview(baseUrl, 120000);
    const transcript = finalPayload.research_session?.transcript || [];
    if (!Array.isArray(transcript) || transcript.length < 2) {
      throw new Error(`${backend} real streaming overview should include a persisted transcript: ${JSON.stringify(finalPayload.research_session || {})}`);
    }
  } finally {
    await terminateProcess(proc);
    await fsp.rm(realProjectDir, { recursive: true, force: true });
  }
}

async function smokeRealCliStreamingIfAvailable() {
  if (process.env.COAUTO_REAL_CLI_STREAM_SMOKE !== "1") {
    console.log("Skipping real CLI streaming smoke: COAUTO_REAL_CLI_STREAM_SMOKE=1 is not set.");
    return;
  }
  const codex = realAgentAuthStatus("codex");
  const claude = realAgentAuthStatus("claude");
  if (!codex.ok || !claude.ok) {
    const reasons = [];
    if (!codex.ok) reasons.push(`Codex unavailable: ${codex.reason}`);
    if (!claude.ok) reasons.push(`Claude unavailable: ${claude.reason}`);
    console.log(`Skipping real CLI streaming smoke: ${reasons.join("; ")}`);
    return;
  }
  await smokeRealCliStreamingForBackend("codex", codex.command);
  await smokeRealCliStreamingForBackend("claude", claude.command);
}

async function smokeEmptyDashboardSettings() {
  const python = findPython();
  const port = await freePort();
  const emptyProjectsDir = path.join(tempRoot, "empty-dashboard-projects");
  await fsp.mkdir(emptyProjectsDir, { recursive: true });
  const serverPath = path.join(root, "templates", "default", "ui", "server.py");
  const proc = spawn(python.command, [...python.args, serverPath, "--host", "127.0.0.1", "--port", String(port), "--projects-dir", emptyProjectsDir], {
    cwd: emptyProjectsDir,
    env: { ...process.env, COAUTO_TEMPLATE_ROOT: path.join(root, "templates", "default") },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForProcessOutput(proc, (output) => output.includes(`Open http://127.0.0.1:${port}`), 15000);
    const baseUrl = `http://127.0.0.1:${port}`;
    const projects = await fetch(`${baseUrl}/api/projects`);
    const projectPayload = await projects.json();
    if (projects.status !== 200 || !Array.isArray(projectPayload.projects) || projectPayload.projects.length !== 0) {
      throw new Error(`empty dashboard should return an empty project list, got ${projects.status} ${JSON.stringify(projectPayload)}`);
    }
    const settings = await fetch(`${baseUrl}/api/settings`);
    const settingsPayload = await settings.json();
    if (settings.status !== 200 || !settingsPayload.settings?.agent?.backend) {
      throw new Error(`empty dashboard settings should not require a project, got ${settings.status} ${JSON.stringify(settingsPayload)}`);
    }
    const saved = await fetch(`${baseUrl}/api/settings`, {
      method: "POST",
      body: JSON.stringify({ agent: { backend: "claude" } })
    });
    const savedPayload = await saved.json();
    if (saved.status !== 200 || savedPayload.settings?.agent?.backend !== "claude") {
      throw new Error(`empty dashboard settings should be saved in dashboard runtime, got ${saved.status} ${JSON.stringify(savedPayload)}`);
    }
  } finally {
    await terminateProcess(proc);
  }
}

async function writeFakeAuthFailureBin(directory, backend) {
  await fsp.mkdir(directory, { recursive: true });
  const name = backend === "claude" ? "claude" : "codex";
  const cmd = path.join(directory, `${name}.cmd`);
  const authArgs = backend === "claude" ? 'if "%1"=="auth" if "%2"=="status"' : 'if "%1"=="login" if "%2"=="status"';
  const authFailureOutput = backend === "claude" ? "{\"authenticated\":false}" : "No credentials";
  await fsp.writeFile(cmd, `@echo off\r\n${authArgs} (echo ${authFailureOutput}& exit /b 1)\r\necho ${name} fake 0.0.0\r\n`, "utf8");
  if (process.platform !== "win32") {
    const shell = path.join(directory, name);
    const authTest = backend === "claude"
      ? '[ "$1" = "auth" ] && [ "$2" = "status" ]'
      : '[ "$1" = "login" ] && [ "$2" = "status" ]';
    const shellAuthFailureOutput = backend === "claude" ? "printf '%s\\n' '{\"authenticated\":false}'" : "echo No credentials";
    await fsp.writeFile(shell, `#!/bin/sh\nif ${authTest}; then ${shellAuthFailureOutput}; exit 1; fi\necho ${name} fake 0.0.0\n`, "utf8");
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
      "if \"%1\"==\"auth\" if \"%2\"==\"status\" (echo {\"authenticated\":true}& exit /b 0)",
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
        "if [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then printf '%s\\n' '{\"authenticated\":true}'; exit 0; fi",
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
  try {
    await fsp.access(path.join(projectDir, "ui", ".runtime", "research_session.json"));
    throw new Error("init copied local UI runtime state into a new project");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
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
  const attachProbe = parseLastJsonObjectLine(attachProbeOutput, "attach");
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
  const projectUiProbe = parseLastJsonObjectLine(projectUiProbeOutput, "project ui");
  const projectUiProbeProjectRoot = await fsp.realpath(projectUiProbe.projectRoot);
  if (
    projectUiProbe.serverPath !== packageServerPath ||
    projectUiProbeProjectRoot !== realProjectDir ||
    projectUiProbe.usingPackageServer !== true ||
    projectUiProbe.serverArgs.includes("--remote")
  ) {
    throw new Error(`ui from a project directory should use the package-managed UI server:\n${projectUiProbeOutput}`);
  }
  const remoteUiProbeOutput = execFileSync("node", [cli, "ui", "--project", projectDir, "--remote", "--no-open"], {
    cwd: root,
    env: { ...process.env, COAUTO_PRINT_UI_INVOCATION: "1", COAUTO_REMOTE_TUNNEL_MOCK_URL: "https://probe.trycloudflare.com" },
    encoding: "utf8"
  }).trim();
  const remoteUiProbe = parseLastJsonObjectLine(remoteUiProbeOutput, "remote ui");
  if (!Array.isArray(remoteUiProbe.serverArgs) || !remoteUiProbe.serverArgs.includes("--remote")) {
    throw new Error(`remote UI should pass --remote to the package-managed server:\n${remoteUiProbeOutput}`);
  }
  const defaultDashboardRoot = path.join(tempRoot, "default-dashboard-root");
  await fsp.mkdir(defaultDashboardRoot, { recursive: true });
  const defaultDashboardProbeOutput = execFileSync("node", [cli, "ui", "--no-open"], {
    cwd: defaultDashboardRoot,
    env: { ...process.env, COAUTO_PRINT_UI_INVOCATION: "1" },
    encoding: "utf8"
  }).trim();
  const defaultDashboardProbe = parseLastJsonObjectLine(defaultDashboardProbeOutput, "default dashboard");
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
  if (
    !reviewerMetadata.coreReviewerFiles?.["REFERENCE_REVIEWER.md"] ||
    !reviewerMetadata.coreProtocolFiles?.["PROJECT_FRAMING.md"] ||
    !reviewerMetadata.coreProtocolFiles?.["RESOURCE_SCOUT.md"] ||
    !reviewerMetadata.coreProtocolFiles?.["REVIEWER_SCOPE_ANALYST.md"]
  ) {
    throw new Error("new projects should record reference reviewer and core protocol baselines");
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
  const customInstruction = path.join(staleReviewerProject, "instructions", "CUSTOM_PROTOCOL.md");
  await fsp.writeFile(customReviewer, "# Custom Reviewer\n", "utf8");
  await fsp.writeFile(customInstruction, "# Custom Protocol\n", "utf8");
  await fsp.rm(path.join(staleReviewerProject, "instructions", "reviewers", "FINAL_GATE_REVIEWER.md"));
  await fsp.rm(path.join(staleReviewerProject, "instructions", "RESOURCE_SCOUT.md"));
  await fsp.rm(path.join(staleReviewerProject, "instructions", "REVIEWER_SCOPE_ANALYST.md"));
  await fsp.rm(path.join(staleReviewerProject, "instructions", ".co-auto-research-instructions.json"));
  const dryRunUpgrade = execFileSync("node", [cli, "upgrade-project", staleReviewerProject, "--dry-run"], { cwd: root, encoding: "utf8" });
  if (!dryRunUpgrade.includes("would sync core reviewers, core protocol instructions")) {
    throw new Error(`upgrade-project --dry-run should report planned reviewer sync:\n${dryRunUpgrade}`);
  }
  const reviewerUpgradeOutput = execFileSync("node", [cli, "upgrade-project", staleReviewerProject], { cwd: root, encoding: "utf8" });
  if (!reviewerUpgradeOutput.includes("synced 10 core reviewers") || !reviewerUpgradeOutput.includes("synced 5 core protocol instructions")) {
    throw new Error(`upgrade-project should sync core reviewers:\n${reviewerUpgradeOutput}`);
  }
  const upgradedMetadata = JSON.parse(await fsp.readFile(path.join(staleReviewerProject, "instructions", ".co-auto-research-instructions.json"), "utf8"));
  if (upgradedMetadata.reviewerBaselineVersion !== "2026-06-publication-ready-tables" || upgradedMetadata.reviewStorageVersion !== "per-reviewer-files-v1") {
    throw new Error("upgrade-project should write reviewer baseline metadata");
  }
  if (
    !upgradedMetadata.coreReviewerFiles?.["REFERENCE_REVIEWER.md"] ||
    !upgradedMetadata.coreProtocolFiles?.["PROJECT_FRAMING.md"] ||
    !upgradedMetadata.coreProtocolFiles?.["RESOURCE_SCOUT.md"] ||
    !upgradedMetadata.coreProtocolFiles?.["REVIEWER_SCOPE_ANALYST.md"]
  ) {
    throw new Error("upgrade-project should write core reviewer and protocol baseline hashes");
  }
  try {
    await fsp.access(customReviewer);
    await fsp.access(customInstruction);
  } catch {
    throw new Error("upgrade-project should preserve custom extra reviewer and instruction files");
  }
  try {
    await fsp.access(path.join(staleReviewerProject, "instructions", "reviewers", "REFERENCE_REVIEWER.md"));
    await fsp.access(path.join(staleReviewerProject, "instructions", "RESOURCE_SCOUT.md"));
    await fsp.access(path.join(staleReviewerProject, "instructions", "REVIEWER_SCOPE_ANALYST.md"));
  } catch {
    throw new Error("upgrade-project should install reference reviewer and core protocol files");
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
  const resourceScoutInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "RESOURCE_SCOUT.md"), "utf8");
  const reviewerScopeInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "REVIEWER_SCOPE_ANALYST.md"), "utf8");
  const planReviewerInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "reviewers", "PLAN_REVIEWER.md"), "utf8");
  const processReviewerInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "reviewers", "PROCESS_REVIEWER.md"), "utf8");
  const evidenceReviewerInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "reviewers", "EVIDENCE_REVIEWER.md"), "utf8");
  const referenceReviewerInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "reviewers", "REFERENCE_REVIEWER.md"), "utf8");
  const finalGateReviewerInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "reviewers", "FINAL_GATE_REVIEWER.md"), "utf8");
  const reviewTaxonomyInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "reviewers", "REVIEW_TAXONOMY.md"), "utf8");
  const notesEntrypointTemplate = await fsp.readFile(path.join(root, "templates", "default", "research_trajectory", "notes", "NOTES.md"), "utf8");
  const notesIndexTemplate = await fsp.readFile(path.join(root, "templates", "default", "research_trajectory", "notes", "index.md"), "utf8");
  const humanTasksTemplate = await fsp.readFile(path.join(root, "templates", "default", "research_trajectory", "HUMAN_TASKS.md"), "utf8");
  const resourceManifestTemplate = await fsp.readFile(path.join(root, "templates", "default", "resources", "user_input", "RESOURCE_MANIFEST.md"), "utf8");
  const literatureReadme = await fsp.readFile(path.join(root, "templates", "default", "resources", "literature", "README.md"), "utf8");
  const stylesCss = await fsp.readFile(path.join(root, "templates", "default", "ui", "styles.css"), "utf8");
  const appJs = await fsp.readFile(path.join(root, "templates", "default", "ui", "app.js"), "utf8");
  const serverPy = await fsp.readFile(path.join(root, "templates", "default", "ui", "server.py"), "utf8");
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
  if (
    !resourceScoutInstructions.includes("## Resource Scout Brief") ||
    !resourceScoutInstructions.includes("Scout: required | skipped") ||
    !resourceScoutInstructions.includes("Require a scout when any of these are true") ||
    !resourceScoutInstructions.includes("Decision reason:") ||
    !resourceScoutInstructions.includes("Known resource clues:") ||
    !resourceScoutInstructions.includes("Freshness / date sensitivity:") ||
    !resourceScoutInstructions.includes("spawn a Resource Scout subagent to search, file, and report potentially relevant resources for the overall research goal and current trial, including files, papers, datasets, reports, news, and other external resources via web search or appropriate external sources") ||
    !resourceScoutInstructions.includes("Download Integrity And Fallback Ladder") ||
    !resourceScoutInstructions.includes("Quarantine bad downloads") ||
    !resourceScoutInstructions.includes("verify magic bytes") ||
    !resourceScoutInstructions.includes("try available network profiles already configured for the environment") ||
    !resourceScoutInstructions.includes("Resource Scout fallback") ||
    resourceScoutInstructions.includes("do not silently do the work") ||
    !resourceScoutInstructions.includes("Do not set the gate to `blocked` or `needs_human` solely because") ||
    !resourceScoutInstructions.includes("Resource Scout subagent orchestration failed") ||
    !resourceScoutInstructions.includes("research_trajectory/trials/<trial_id>/artifacts/resource_scout/RESOURCE_SCOUT_REPORT.md") ||
    !resourceScoutInstructions.includes("resources/user_input/RESOURCE_MANIFEST.md") ||
    !resourceScoutInstructions.includes("autoresearch_discovered") ||
    resourceScoutInstructions.includes("spawn or run the Resource Scout") ||
    !executionInstructions.includes("including the required `Resource Scout Brief`") ||
    !executionInstructions.includes("RESOURCE_SCOUT_REPORT.md") ||
    !executionInstructions.includes("Download Integrity And Fallback Ladder") ||
    !executionInstructions.includes("External file access failures are not automatically human blockers") ||
    !executionInstructions.includes("REVIEWER_SPAWN_DECISION.md") ||
    !executionInstructions.includes("inline Reviewer Scope Analyst fallback") ||
    !executionInstructions.includes("not a ninth core reviewer") ||
    !reviewerScopeInstructions.includes("spawn a Reviewer Scope Analyst subagent to decide whether the eight core reviewers cover the current trial's review risks") ||
    !reviewerScopeInstructions.includes("Reviewer Scope Analyst fallback") ||
    reviewerScopeInstructions.includes("do not silently do the work") ||
    !reviewerScopeInstructions.includes("research_trajectory/trials/<trial_id>/artifacts/reviewer_spawn/REVIEWER_SPAWN_DECISION.md") ||
    !reviewerScopeInstructions.includes("Spawn needed: yes | no") ||
    !resourceIntakeInstructions.includes("## Resource Scout Discoveries") ||
    !resourceIntakeInstructions.includes("Scout-discovered materials remain raw inputs") ||
    !planReviewerInstructions.includes("includes the required `Resource Scout Brief`") ||
    !planReviewerInstructions.includes("gives a concrete `Decision reason:`") ||
    !planReviewerInstructions.includes("does not skip Resource Scout merely because") ||
    !planReviewerInstructions.includes("gives a concrete `Skip reason:`") ||
    !processReviewerInstructions.includes("Resource Scout process status") ||
    !processReviewerInstructions.includes("Reviewer Scope Analyst decision status") ||
    !evidenceReviewerInstructions.includes("scout-discovered resources treated as raw inputs") ||
    !evidenceReviewerInstructions.includes("reviewer spawn decision") ||
    !referenceReviewerInstructions.includes("citation-ready metadata") ||
    !finalGateReviewerInstructions.includes("Resource Scout status") ||
    !finalGateReviewerInstructions.includes("Reviewer Scope Analyst status")
  ) {
    throw new Error("resource scout and reviewer-scope protocols must be wired into execution, intake, and relevant reviewers");
  }
  if (
    !executionInstructions.includes("Response to human: <one concise user-facing question or decision request>") ||
    !executionInstructions.includes("`Next action` is the system's next step. `Response to human` is the user-facing") ||
    !reviewTaxonomyInstructions.includes("Response to human: <required when Decision or Gate impact is blocked or needs_human")
  ) {
    throw new Error("blocked and needs_human gates/reviewers must define a human-facing response field");
  }
  if (
    !humanTasksTemplate.includes("# Human Tasks") ||
    !humanTasksTemplate.includes("Keep at most three open tasks") ||
    !executionInstructions.includes("research_trajectory/HUMAN_TASKS.md") ||
    !executionInstructions.includes("only hard stop when no meaningful non-human work remains") ||
    !executionInstructions.includes("The `Status:` value must be exactly one bare token") ||
    !executionInstructions.includes("main execution agent is the only") ||
    !executionInstructions.includes("Human task candidates") ||
    !reviewTaxonomyInstructions.includes("whole autoresearch loop") ||
    !reviewTaxonomyInstructions.includes("Human Task Candidates") ||
    !reviewTaxonomyInstructions.includes("Reviewers must not edit") ||
    !resourceScoutInstructions.includes("Human Task Candidates") ||
    !resourceScoutInstructions.includes("Do not edit") ||
    !resourceScoutInstructions.includes("HUMAN_TASKS.md` directly") ||
    resourceScoutInstructions.includes("record the request in `research_trajectory/HUMAN_TASKS.md`") ||
    !reviewerScopeInstructions.includes("Human Task Candidates") ||
    !reviewerScopeInstructions.includes("Do not edit `research_trajectory/HUMAN_TASKS.md` directly") ||
    reviewerScopeInstructions.includes("record the request in `research_trajectory/HUMAN_TASKS.md`") ||
    !serverPy.includes("def read_human_tasks") ||
    !serverPy.includes('"human_tasks": read_human_tasks()') ||
    !appJs.includes("function trialHumanTasksHtml") ||
    !appJs.includes("function humanTasksListHtml") ||
    !appJs.includes("humanTasksListHtml(payload.human_tasks") ||
    !stylesCss.includes(".trial-human-tasks") ||
    !stylesCss.includes(".status-human-tasks")
  ) {
    throw new Error("non-blocking human tasks must have a template, parser, prompt rules, payloads, and distinct UI rendering");
  }
  if (
    !executionInstructions.includes("Subagent update: <Resource Scout | Reviewer Scope Analyst | Specialized reviewer>") ||
    !serverPy.includes("Subagent update: Resource Scout") ||
    !serverPy.includes("Subagent update: Reviewer Scope Analyst") ||
    !serverPy.includes("Subagent update: Specialized reviewer") ||
    !serverPy.includes("First try useful non-human work") ||
    serverPy.includes("If PROJECT.md is insufficient or contradictory, ask for clarification in the final message, set `Status: needs_human`") ||
    !appJs.includes("function parseSubagentUpdateLine") ||
    !appJs.includes("function liveStatusHtml") ||
    !appJs.includes("function liveStatusIconHtml") ||
    !appJs.includes("function subagentAgentKind") ||
    !appJs.includes("function subagentOutputLinkHtml") ||
    !appJs.includes('class="trial-live-status-block"') ||
    !appJs.includes('data-inline-fullscreen="${escapeHtml(path)}"') ||
    !appJs.includes("agentWaitStateHtml(waitState, { suppressIdle: true })") ||
    appJs.includes("const processUpdates = currentRunProcessUpdatesHtml(liveEntries") ||
    appJs.includes("const subagentActivity = subagentActivityHtml(liveEntries)") ||
    !appJs.includes("function subagentActivityHtml") ||
    !appJs.includes("trial-subagent-activity") ||
    !appJs.includes("The top-level agent may be waiting on a subagent") ||
    !stylesCss.includes(".trial-live-status-block") ||
    !stylesCss.includes(".trial-live-status-block-icon") ||
    !stylesCss.includes(".trial-live-status-block-output.is-link") ||
    !stylesCss.includes(".trial-subagent-activity") ||
    appJs.includes("trial-subagent-activity is-blocked") ||
    stylesCss.includes(".trial-subagent-activity.is-blocked") ||
    appJs.includes("trial-live-status-block is-blocked") ||
    stylesCss.includes(".trial-live-status-block.is-blocked")
  ) {
    throw new Error("subagent visibility and whole-loop hard-stop prompts must be wired without blocked-gate styling");
  }
  if (
    executionInstructions.includes("Mandatory note triggers") ||
    !executionInstructions.includes("## Knowledge Capture Contract") ||
    !executionInstructions.includes("Every trial report must include a `Knowledge Capture` section") ||
    !executionInstructions.includes("Note updated: research_trajectory/notes/<topic>.md") ||
    !executionInstructions.includes("Promoted elsewhere: <PROJECT.md, STATE.md, CURRENT_FINDINGS.md, or manifest path> because <reason>") ||
    !executionInstructions.includes("topic in kebab case") ||
    !planReviewerInstructions.includes("declares possible knowledge-capture outputs") ||
    !processReviewerInstructions.includes("topic-based notes index") ||
    !processReviewerInstructions.includes("reusable knowledge buried in reports") ||
    !notesEntrypointTemplate.includes("compatibility") ||
    !notesEntrypointTemplate.includes("research_trajectory/notes/index.md") ||
    notesEntrypointTemplate.includes("Durable Project Notes") ||
    !notesIndexTemplate.includes("# Knowledge Notes Index") ||
    !notesIndexTemplate.includes("## Active Notes") ||
    !notesIndexTemplate.includes("## Retired / Superseded Notes")
  ) {
    throw new Error("knowledge notes must use CORAL-style sparse topic notes with an index and trial-level capture outcomes");
  }
  const indexHtml = await fsp.readFile(path.join(root, "templates", "default", "ui", "index.html"), "utf8");
  // Cache-busting asset versions are bumped on every UI revision; assert their
  // presence and internal consistency rather than pinning exact literals (which
  // would break CI on every design bump).
  const stylesVersion = (indexHtml.match(/styles\.css\?v=([\w.-]+)/) || [])[1] || "";
  const appVersion = (indexHtml.match(/app\.js\?v=([\w.-]+)/) || [])[1] || "";
  if (!stylesVersion || !appVersion) {
    throw new Error("index.html must reference styles.css and app.js with cache-busting ?v= version tokens");
  }
  const readme = await fsp.readFile(path.join(root, "README.md"), "utf8");
  const gitignore = await fsp.readFile(path.join(root, ".gitignore"), "utf8");
  const docsConfig = await fsp.readFile(path.join(root, "docs", "conf.py"), "utf8");
  const docsRequirements = await fsp.readFile(path.join(root, "docs", "requirements.txt"), "utf8");
  const docsIndex = await fsp.readFile(path.join(root, "docs", "index.md"), "utf8");
  const remoteDocs = await fsp.readFile(path.join(root, "docs", "remote-server.md"), "utf8");
  const gettingStartedDocs = await fsp.readFile(path.join(root, "docs", "getting-started.md"), "utf8");
  const cliDocs = await fsp.readFile(path.join(root, "docs", "cli.md"), "utf8");
  const contributingDocs = await fsp.readFile(path.join(root, "CONTRIBUTING.md"), "utf8");
  const securityDocs = await fsp.readFile(path.join(root, "SECURITY.md"), "utf8");
  const upgradingDocs = await fsp.readFile(path.join(root, "docs", "upgrading.md"), "utf8");
  const pagesWorkflow = await fsp.readFile(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
  const ciWorkflow = await fsp.readFile(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const cliSource = await fsp.readFile(path.join(root, "bin", "auto-research.js"), "utf8");
  const helpOutput = execFileSync("node", [cli, "help"], { cwd: root, encoding: "utf8" });
  if (
    !helpOutput.includes("[--remote]") ||
    !cliSource.includes("function printRemoteAccessHint") ||
    !cliSource.includes("async function startRemoteTunnel") ||
    !cliSource.includes("function findCloudflaredCommand") ||
    !cliSource.includes("function findGraftcpCommand") ||
    !cliSource.includes("function remoteProxy") ||
    !cliSource.includes("install-graftcp") ||
    !cliSource.includes('["tunnel", "--url", localUrl]') ||
    !cliSource.includes('"--protocol", "http2"') ||
    !cliSource.includes("COAUTO_REMOTE_TUNNEL_MOCK_URL") ||
    !cliSource.includes("COAUTO_REMOTE_TUNNEL_MOCK_FAIL") ||
    !cliSource.includes("COAUTO_CLOUDFLARED") ||
    !cliSource.includes("COAUTO_GRAFTCP") ||
    !cliSource.includes("COAUTO_REMOTE_PROXY") ||
    cliSource.includes("coauto_token") ||
    !cliSource.includes("ssh -N -L") ||
    !cliSource.includes("user}@<ssh-host>") ||
    cliSource.includes("os.hostname") ||
    !cliSource.includes("Remote mode enabled") ||
    !readme.includes("co-auto-research ui --remote") ||
    !readme.includes("Cloudflare browser link") ||
    !readme.includes("cloudflared") ||
    !remoteDocs.includes("co-auto-research ui --remote") ||
    !remoteDocs.includes("Cloudflare Quick Tunnel") ||
    !remoteDocs.includes("Cloudflare CLI setup") ||
    !remoteDocs.includes("Linux without sudo") ||
    !remoteDocs.includes("npx --yes co-auto-research install-cloudflared") ||
    !remoteDocs.includes("npx --yes co-auto-research install-graftcp") ||
    !remoteDocs.includes("HTTP proxy servers") ||
    !remoteDocs.includes("COAUTO_REMOTE_PROXY") ||
    !remoteDocs.includes("COAUTO_GRAFTCP") ||
    remoteDocs.includes("cloudflared-linux-${arch}") ||
    remoteDocs.includes("sudo apt-get install cloudflared") ||
    !remoteDocs.includes("brew install cloudflared") ||
    !remoteDocs.includes("winget install -e --id Cloudflare.cloudflared") ||
    !remoteDocs.includes("COAUTO_CLOUDFLARED") ||
    remoteDocs.includes("coauto_token") ||
    !remoteDocs.includes("COAUTO_REMOTE_MODE=ssh") ||
    !remoteDocs.includes("user@<ssh-host>") ||
    !remoteDocs.includes("COAUTO_REMOTE_TARGET=user@host") ||
    !securityDocs.includes("official `cloudflared` CLI") ||
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
    packageManifest.dependencies?.untun ||
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
    !gettingStartedDocs.includes("Cloudflare browser link") ||
    !gettingStartedDocs.includes("cloudflared") ||
    !gettingStartedDocs.includes("co-auto-research ui") ||
    !cliDocs.includes("COAUTO_CLOUDFLARED") ||
    !cliDocs.includes("COAUTO_GRAFTCP") ||
    !cliDocs.includes("COAUTO_REMOTE_PROXY") ||
    !cliDocs.includes("COAUTO_REMOTE_MODE") ||
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
  if (!stylesCss.includes(".rail-nav[hidden]")) {
    throw new Error("rail navigation hidden state must not be overridden by display styles");
  }
  if (
    !stylesCss.includes("Final shell centering guard") ||
    !stylesCss.includes("html[data-theme] .app-shell") ||
    !stylesCss.includes("html[data-theme] .main-stage") ||
    !stylesCss.includes("margin-left: var(--rail-width);") ||
    !stylesCss.includes("width: calc(100vw - var(--rail-width));") ||
    !stylesCss.includes("max-width: calc(100vw - var(--rail-width));") ||
    !stylesCss.includes("html[data-theme] :is(.material-header, .context-content)") ||
    !stylesCss.includes("margin-inline: auto;") ||
    !/html\[data-theme\]\s+\.context-content\s*>\s*\*\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?\}/.test(stylesCss)
  ) {
    throw new Error("material workspace pages must center inside the fixed-rail main stage without grid-item overflow");
  }
  if (
    !/--framing-column-width:\s*\d+px/.test(stylesCss) ||
    !stylesCss.includes(".brief-editor-shell.is-framing-dock") ||
    !stylesCss.includes(".framing-message.user") ||
    !stylesCss.includes("justify-self: center !important")
  ) {
    throw new Error("framing composer and CoAutoResearch returns must share a centered column");
  }
  if (
    !stylesCss.includes("Final empty-framing bottom guard") ||
    !stylesCss.includes("#cold-start-workspace:not(.has-framing-thread)") ||
    !stylesCss.includes("min-height: calc(100dvh - 36px)") ||
    !stylesCss.includes("margin: clamp(24px, 8vh, 92px) auto auto !important;")
  ) {
    throw new Error("empty framing page must keep target/composer bottom-aligned even on short CSS viewports");
  }
  if (
    !appVersion ||
    !stylesCss.includes("Reader typography: match the composer text across content surfaces.") ||
    !stylesCss.includes(".framing-message .transcript-body") ||
    !stylesCss.includes("font-family: var(--reader);")
  ) {
    throw new Error("content typography must use the same reader font as the composer");
  }
  const projectFramingInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "PROJECT_FRAMING.md"), "utf8");
  const projectFramingInstructionsText = projectFramingInstructions.replace(/\r\n/g, "\n");
  const interventionInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "INTERVENTION_PROTOCOL.md"), "utf8");
  const agentsInstructions = await fsp.readFile(path.join(root, "templates", "default", "AGENTS.md"), "utf8");
  if (
    !serverPy.includes("REMOTE_AUTH_TOKEN") ||
    !serverPy.includes("authorize_remote_request") ||
    !serverPy.includes("Set-Cookie") ||
    !serverPy.includes("coauto_remote_auth") ||
    !serverPy.includes("def reconcile_research_process_state") ||
    !serverPy.includes("SESSION_STARTUP_GRACE_SECONDS") ||
    !serverPy.includes("def is_client_disconnect_error") ||
    !serverPy.includes("if is_client_disconnect_error(exc):") ||
    !serverPy.includes('"--remote"') ||
    !serverPy.includes("UI_REMOTE_MODE = bool(args.remote)")
  ) {
    throw new Error("server must keep remote auth, remote metadata, and stale run reconciliation");
  }
  if (!appJs.includes("session.active_run && session.active_run.running === false")) {
    throw new Error("UI running-state checks must not lock the composer when the server reports no active run");
  }
  const blueprintTemplate = await fsp.readFile(path.join(root, "templates", "default", "manuscript", "BLUEPRINT.md"), "utf8");
  const manuscriptInstructions = await fsp.readFile(path.join(root, "templates", "default", "instructions", "MANUSCRIPT.md"), "utf8");
  const figureTableReviewer = await fsp.readFile(path.join(root, "templates", "default", "instructions", "reviewers", "FIGURE_TABLE_REVIEWER.md"), "utf8");
  const finalGateReviewer = await fsp.readFile(path.join(root, "templates", "default", "instructions", "reviewers", "FINAL_GATE_REVIEWER.md"), "utf8");
  const themeOptionValues = [...indexHtml.matchAll(/name="themeMode"\s+value="([^"]+)"/g)].map((match) => match[1]);
  const explicitThemeBlocks = [...stylesCss.matchAll(/html\[data-theme="([^"]+)"\]/g)].map((match) => match[1]);
  const expectedThemes = ["atelier-ivory", "atelier-nocturne"];
  if (
    themeOptionValues.length !== expectedThemes.length ||
    !expectedThemes.every((theme) => themeOptionValues.includes(theme)) ||
    !expectedThemes.every((theme) => explicitThemeBlocks.includes(theme)) ||
    !indexHtml.includes('document.documentElement.dataset.theme = allowedThemes.has(stored) ? stored : "atelier-ivory"') ||
    !appJs.includes('localStorage.getItem("coAutoResearchTheme")') ||
    !appJs.includes('localStorage.setItem("coAutoResearchTheme", mode)') ||
    !appJs.includes("function applyThemeMode") ||
    !appJs.includes('const defaultThemeMode = "atelier-ivory"') ||
    !appJs.includes('new Set([defaultThemeMode, "atelier-nocturne"])') ||
    !appJs.includes('$$("[data-theme-option]")') ||
    !stylesCss.includes(".theme-mode-control") ||
    !readme.includes("Ivory and Nocturne") ||
    !gettingStartedDocs.includes("Ivory and Nocturne") ||
    !cliDocs.includes("Ivory and Nocturne")
  ) {
    throw new Error("settings must expose the persisted dashboard themes");
  }
  const loadSettingsStart = appJs.indexOf("async function loadUiSettings");
  const loadSettingsEnd = appJs.indexOf("async function saveUiSettings", loadSettingsStart);
  const loadSettingsBody = loadSettingsStart >= 0 && loadSettingsEnd > loadSettingsStart
    ? appJs.slice(loadSettingsStart, loadSettingsEnd)
    : "";
  const initStart = appJs.indexOf("async function init()");
  const initEnd = appJs.indexOf("init().catch", initStart);
  const initBody = initStart >= 0 && initEnd > initStart ? appJs.slice(initStart, initEnd) : "";
  const initLoadProjectsIndex = initBody.indexOf("await loadProjects({ showLoading: true })");
  const initLoadSettingsIndex = initBody.indexOf("await loadUiSettings()");
  if (
    !appJs.includes("function scopedJsonGet") ||
    !appJs.includes("function scopedSessionSettings") ||
    !appJs.includes("function mergedProjectSessionSettings") ||
    !appJs.includes("function persistSessionSettings") ||
    !appJs.includes("function projectSessionSettingsForStorage") ||
    !appJs.includes("function persistProjectSessionSettings") ||
    !appJs.includes('scopedGet("autoResearchComposerDraft", "", { legacyFallback: false })') ||
    !appJs.includes('scopedGet("autoResearchTargetVenue", "", { legacyFallback: false })') ||
    !appJs.includes('scopedSet("autoResearchTargetVenue", event.target.value || "")') ||
    !appJs.includes('scopedSet("autoResearchSessionSettings", JSON.stringify(sessionSettingsForStorage(settings)))') ||
    !appJs.includes('scopedSet("autoResearchSessionSettings", JSON.stringify(projectSessionSettingsForStorage(settings)))') ||
    !appJs.includes("persistProjectSessionSettings(uiSettings);") ||
    !loadSettingsBody.includes("hydrateSettingsDialog(uiSettings);") ||
    !loadSettingsBody.includes("restoreSessionSettings();") ||
    loadSettingsBody.includes("applySessionSettings(")
  ) {
    throw new Error("project-scoped UI persistence must keep drafts/settings in scoped storage and keep loadUiSettings from overwriting browser overrides");
  }
  if (
    initLoadProjectsIndex < 0 ||
    initLoadSettingsIndex < 0 ||
    initLoadProjectsIndex > initLoadSettingsIndex ||
    !appJs.includes("function clearOverviewPoll") ||
    !appJs.includes("Project is no longer available") ||
    !serverPy.includes("def ensure_current_project_writeable") ||
    !serverPy.includes("context.deleted = True")
  ) {
    throw new Error("remote project deletion must clear stale polling and validate the project before loading project-scoped settings");
  }
  if (
    !indexHtml.includes("Using external CLI auth keeps tokens outside the project") ||
    !indexHtml.includes("Clear project override") ||
    !appJs.includes("Project override saved") ||
    !appJs.includes("No project key saved")
  ) {
    throw new Error("settings UI must label provider credentials as project-local overrides");
  }
  if (
    !gitignore.includes(".claude/") ||
    !gitignore.includes("ui/.runtime/") ||
    !gitignore.includes("**/ui/.runtime/") ||
    !gitignore.includes(".env") ||
    !gitignore.includes(".env.*") ||
    !gitignore.includes("secrets/*")
  ) {
    throw new Error("local agent settings, env files, project runtime settings, and local secrets must stay git-ignored");
  }
  assertThemeContrast(stylesCss);
  if (
    !serverPy.includes('{"text", "project", "plan", "goal-launch", "command", "intervention-recorded"}') ||
    !serverPy.includes('clean["text"] = f"Attached {count}') ||
    !serverPy.includes('display_message = "Attached resources."')
  ) {
    throw new Error("server must preserve goal-launch messages and keep attachment-only chat turns visible");
  }
  if (
    !projectFramingInstructionsText.includes("# Project Framing Protocol") ||
    !projectFramingInstructionsText.includes("Before Autoresearch Starts") ||
    !projectFramingInstructionsText.includes("After Autoresearch Starts") ||
    !projectFramingInstructionsText.includes("Evaluate the full latest turn, not only the user's raw message") ||
    !projectFramingInstructionsText.includes("planned\nanswer itself establishes or materially changes the launch frame") ||
    !projectFramingInstructionsText.includes("Do not leave launch-ready\nframing only in the chat transcript") ||
    !projectFramingInstructionsText.includes("Do not wait for the user to say") ||
    !projectFramingInstructionsText.includes("After autoresearch starts, `PROJECT.md` is no longer a live chat draft")
  ) {
    throw new Error("PROJECT_FRAMING.md must define before/after autoresearch PROJECT.md update policy");
  }
  if (
    !interventionInstructions.includes("Before autoresearch has started, do not create human intervention files") ||
    !interventionInstructions.includes("Pre-start changes to venue, scope, paper outline") ||
    !interventionInstructions.includes("if autoresearch has not started, do not create or update intervention files; use `PROJECT.md` launch framing instead") ||
    !agentsInstructions.includes("ordinary interaction, pre-start launch framing, or formal human intervention") ||
    !agentsInstructions.includes("Before autoresearch starts, messages that change venue, scope, outline") ||
    !agentsInstructions.includes("do not create human intervention files before there is an autoresearch trajectory")
  ) {
    throw new Error("intervention instructions must route pre-start launch framing to PROJECT.md instead of pending intervention files");
  }
  if (
    !serverPy.includes("def chat_research_prompt") ||
    !serverPy.includes("def chat_intent_prompt_section") ||
    !serverPy.includes("Latest-message intent hint") ||
    !serverPy.includes("ordinary explanation/question") ||
    !serverPy.includes("This is not an autoresearch launch") ||
    !serverPy.includes("the server has not classified it for you") ||
    !serverPy.includes("Before autoresearch starts, do not create or update human intervention files") ||
    !serverPy.includes("Treat venue, scope, outline, objective, contribution, success-gate, constraint, exclusion, and output changes as `PROJECT.md` launch-framing updates instead") ||
    !serverPy.includes("After autoresearch starts, if the message is a formal human intervention, create or update a pending intervention file") ||
    !serverPy.includes("If a post-start message clarifies an existing pending intervention, update that same pending intervention") ||
    !serverPy.includes("The final response must first answer the user's current question or discussion request with substantive analysis") ||
    !serverPy.includes("Read and follow `instructions/PROJECT_FRAMING.md`") ||
    !serverPy.includes("before sending the final response check whether that planned answer establishes or materially changes the launch frame") ||
    !serverPy.includes("Before autoresearch starts, if your planned answer chooses or changes the target venue") ||
    !serverPy.includes("Do not leave launch-ready framing only in chat") ||
    serverPy.includes("Treat file updates as optional follow-through") ||
    !serverPy.includes("read instructions/PROJECT_FRAMING.md") ||
    !serverPy.includes('Do not use a file-update summary such as "Updated PROJECT.md" as a substitute for answering the user') ||
    serverPy.includes("def intervention_chat_prompt") ||
    serverPy.includes("is_human_intervention_candidate") ||
    serverPy.includes("INTERVENTION_EN_PATTERNS") ||
    serverPy.includes("INTERVENTION_ZH_PATTERNS") ||
    !appJs.includes("function canChatBeforeProjectDraft") ||
    !appJs.includes("canChatWithProjectDraft() || canChatBeforeProjectDraft()") ||
    !appJs.includes("function isTruePreProjectBriefResend") ||
    !appJs.includes("async function resendConversationMessage") ||
    !appJs.includes("function confirmPreProjectFramingResend") ||
    !appJs.includes("function editAttachmentDraftForMessage") ||
    !appJs.includes("data-edit-upload") ||
    !appJs.includes("data-edit-link") ||
    !appJs.includes("retainedAttachments") ||
    !serverPy.includes("def retained_attachments_from_payload") ||
    !serverPy.includes("framing cannot be restarted for an active trajectory") ||
    appJs.includes("function isHumanInterventionCandidateText") ||
    appJs.includes("function canSendInterventionDuringRun") ||
    appJs.includes("appendInterventionAcknowledgementFromResponse") ||
    !appJs.includes("function canQueueChatDuringAutoresearchRun") ||
    !appJs.includes("Queued; CoAutoResearch will reply after the current run finishes.") ||
    !appJs.includes('const allowedKinds = new Set(["text", "project", "plan", "goal-launch", "command", "intervention-recorded"])') ||
    !appJs.includes("clientMessageId: message.id") ||
    !appJs.includes("clientMessageId: appendedMessage?.id") ||
    !appJs.includes("conversationHistory: conversationHistoryForRequest(localMessages)") ||
    !appJs.includes("forceFreshSession: true") ||
    !serverPy.includes("queued_chat_messages_path") ||
    !serverPy.includes("maybe_start_queued_chat_after_run") ||
    !serverPy.includes("sync_human_intervention_indexes") ||
    !serverPy.includes("sync_expected_trial_pending_interventions") ||
    appJs.includes("resendTranscriptMessage") ||
    appJs.includes("data-transcript-edit") ||
    appJs.includes("transcript-edit-form") ||
    !appJs.includes("const usePlanRun = message.mode === \"plan\"") ||
    !appJs.includes("const useFramingRun = !usePlanRun && isTruePreProjectBriefResend(index)") ||
    !appJs.includes('showToast(useFramingRun ? `${agentLabel(sessionBackend())} is reframing PROJECT.md.` : "Regenerating reply.")') ||
    !serverPy.includes("CHAT_PROTECTED_PATHS") ||
    !serverPy.includes("create_chat_protected_snapshot() if mode == \"chat\" else None") ||
    !serverPy.includes("restore_chat_protected_snapshot") ||
    !serverPy.includes("Chat mode guard restored protected autoresearch artifacts") ||
    !serverPy.includes("read_trajectory_state() if chat_guard_active else sync_trajectory_state(\"snapshot\")")
  ) {
    throw new Error("chat mode must not be able to create or sync autoresearch trial artifacts");
  }
  if (
    !serverPy.includes("def start_research_plan") ||
    !serverPy.includes("def start_research_plan_approve") ||
    !serverPy.includes("def plan_research_prompt") ||
    !serverPy.includes("Do not create, edit, delete, rename, or move any project/repository files.") ||
    !serverPy.includes("def codex_app_server_command") ||
    !serverPy.includes('args.extend(["app-server", "--listen", "stdio://"])') ||
    !serverPy.includes('"capabilities": {"experimentalApi": True}') ||
    !serverPy.includes('"collaborationMode"') ||
    !serverPy.includes('"mode": "plan"') ||
    !serverPy.includes('"sandboxPolicy": {"type": "readOnly"') ||
    !serverPy.includes("Codex app-server did not return a plan item") ||
    !serverPy.includes("def write_claude_plan_hook") ||
    !serverPy.includes('"PermissionRequest"') ||
    !serverPy.includes('"matcher": "ExitPlanMode"') ||
    !serverPy.includes('"behavior": "deny"') ||
    !serverPy.includes('"interrupt": True') ||
    !serverPy.includes("Use Plan mode for `/plan`; CoAutoResearch will not forward `/plan` to the agent.") ||
    !appJs.includes("function parsePlanSlashCommand") ||
    !appJs.includes('const isPlanRequest = planSlashMessage !== null || (!text.startsWith("/") && isPlanComposerMode())') ||
    !appJs.includes('"/api/research/plan"') ||
    !appJs.includes('"/api/research/plan/approve"') ||
    !appJs.includes("function planCardHtml") ||
    !appJs.includes("data-plan-approve") ||
    !appJs.includes("data-plan-revise") ||
    !appJs.includes("[data-plan-mode-toggle]") ||
    !indexHtml.includes("data-plan-mode-toggle") ||
    indexHtml.includes("data-composer-mode") ||
    indexHtml.includes(">Chat</button>") ||
    !stylesCss.includes(".plan-mode-chip.is-active") ||
    stylesCss.includes(".composer-mode-toggle")
  ) {
    throw new Error("real Plan Mode must use dedicated plan APIs, Codex app-server, Claude ExitPlanMode capture, and a single Plan chip without forwarding /plan");
  }
  if (
    !indexHtml.includes('id="composer-attach-button"') ||
    !indexHtml.includes('id="composer-file-input"') ||
    !indexHtml.includes('type="file" multiple hidden') ||
    !indexHtml.includes('/styles.css?v=20260626-stop-preexec') ||
    !indexHtml.includes('/app.js?v=20260626-stop-preexec') ||
    indexHtml.includes("Claude Fable") ||
    !indexHtml.includes('id="attachment-menu"') ||
    !indexHtml.includes('data-attachment-action="upload-files"') ||
    !indexHtml.includes('data-attachment-action="link-folders"') ||
    !indexHtml.includes("Drag files here, or use + to upload files/link folders") ||
    indexHtml.includes("material-action-chip") ||
    indexHtml.includes("material-type-dialog") ||
    !appJs.includes('event.target.closest("#composer-attach-button")') ||
    !appJs.includes('$("#composer-file-input")?.addEventListener("change"') ||
    !appJs.includes("function openComposerFilePicker") ||
    !appJs.includes("function isRemoteUi") ||
    !appJs.includes("function showUploadSourcePicker") ||
    !appJs.includes('data-upload-source="computer"') ||
    !appJs.includes('data-upload-source="server"') ||
    !appJs.includes("function ensureAttachmentMenu") ||
    !appJs.includes("document.body.appendChild(menu)") ||
    !appJs.includes("function positionAttachmentMenu") ||
    !appJs.includes("function fitComposerSelectWidths") ||
    !appJs.includes("function reasoningOptionsForBackendModel") ||
    !appJs.includes("function syncPermissionSelectOptions") ||
    !appJs.includes("bypassPermissions") ||
    appJs.includes("Claude Fable") ||
    !appJs.includes("function toggleAttachmentMenu") ||
    !appJs.includes("function handleAttachmentMenuAction") ||
    !appJs.includes('showResourceBrowser({ mode: "server-file", editMessageId })') ||
    !appJs.includes('browserSelectionMode === "server-file"') ||
    !appJs.includes("function resolveProjectIdAlias") ||
    !appJs.includes("const resolvedProjectId = resolveProjectIdAlias(projects, activeProjectId)") ||
    appJs.includes("function chooseMaterialType") ||
    appJs.includes("function showMaterialTypeDialog") ||
    !appJs.includes("const MAX_BROWSER_UPLOAD_BYTES = 50 * 1024 * 1024") ||
    !appJs.includes("size > MAX_BROWSER_UPLOAD_BYTES") ||
    !appJs.includes("Copy it into project resources before sending.") ||
    !appJs.includes("showResourceBrowser();") ||
    !appJs.includes('addFilesFromList(event.target.files, "file picker", { category })') ||
    !appJs.includes('user_input: "User input"') ||
    !serverPy.includes('"user_input": "resources/user_input/attachments"') ||
    !serverPy.includes("UI_REMOTE_MODE = False") ||
    !serverPy.includes('"remote": UI_REMOTE_MODE') ||
    !serverPy.includes('help="Expose UI runtime metadata for a browser connected to a remote server."') ||
    !stylesCss.includes(".composer-attach-button") ||
    !stylesCss.includes(".composer-file-input") ||
    !stylesCss.includes(".attachment-menu") ||
    !stylesCss.includes(".attachment-choice-copy") ||
    !stylesCss.includes("position: fixed;") ||
    !stylesCss.includes("z-index: 1400;") ||
    !readme.includes("composer `+` button") ||
    !readme.includes("resources/user_input/attachments/") ||
    !gettingStartedDocs.includes("resources/user_input/attachments/") ||
    !gettingStartedDocs.includes("resources/user_input/RESOURCE_MANIFEST.md")
  ) {
    throw new Error("composer must expose a local file attach button and document project-local attachment storage");
  }
  if (
    !indexHtml.includes('name="settingsCodexPreExecScript"') ||
    !indexHtml.includes('name="settingsClaudePreExecScript"') ||
    !appJs.includes("function renderComposerActionButtons") ||
    !appJs.includes("Stop answering") ||
    !appJs.includes("stopRequestPending") ||
    !stylesCss.includes(".composer-stop-square") ||
    !serverPy.includes('"preExecScript": ""') ||
    !serverPy.includes("def create_agent_pre_exec_wrapper") ||
    !serverPy.includes("def agent_settings_for_probe") ||
    !serverPy.includes("run_agent_probe(backend: str") ||
    !serverPy.includes("popen_command, use_shell, wrapper_path = popen_command_for_agent(command, agent_settings_for_probe(backend, settings), process_env)") ||
    !serverPy.includes("agent-shell-setup") ||
    !serverPy.includes("start_new_session=os.name != \"nt\"") ||
    !serverPy.includes("def signal_research_process")
  ) {
    throw new Error("composer stop mode and per-agent shell setup must stay wired through UI and server launch");
  }
  if (
    !serverPy.includes("/api/research/queue") ||
    !serverPy.includes("def dispatch_next_queued_chat") ||
    !serverPy.includes('"queued_chat_items"') ||
    !appJs.includes("function renderQueuedChatPanel") ||
    !appJs.includes("data-queue-action=\"stop-send\"") ||
    !stylesCss.includes(".queue-panel") ||
    !stylesCss.includes(".queue-item.is-next")
  ) {
    throw new Error("agent follow-up queue must expose API, composer UI, and dispatch state");
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
    !appJs.includes('["ui.framing", "ui.chat", "ui.plan"].includes(rawType)') ||
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
  const sendImmediateStart = appJs.indexOf("let appendedMessage = null", sendSessionStart);
  const sendAppendIndex = appJs.indexOf('appendFramingMessage("user", displayText', sendImmediateStart);
  const sendClearIndex = appJs.indexOf("clearFramingComposerText(text || displayText)", sendAppendIndex);
  const sendCollectIndex = appJs.indexOf("const files = await collectUploadFiles(uploadItemsForRequest)", sendImmediateStart);
  if (
    !(
      sendSessionStart >= 0 &&
      sendImmediateStart > sendSessionStart &&
      sendAppendIndex > sendImmediateStart &&
      sendClearIndex > sendAppendIndex &&
      sendCollectIndex > sendClearIndex
    )
  ) {
    throw new Error("session composer must render the sent message and clear input before collecting uploads or posting");
  }
  const launchStart = appJs.indexOf("async function launchAutoresearch");
  const launchCloseIndex = appJs.indexOf('$("#launch-dialog")?.close();', launchStart);
  const launchPersistIndex = appJs.indexOf("await persistFramingMessages();", launchStart);
  const launchApiIndex = appJs.indexOf('api("/api/research/cold-start"', launchStart);
  if (!(launchStart >= 0 && launchCloseIndex > launchStart && launchPersistIndex > launchCloseIndex && launchApiIndex > launchCloseIndex)) {
    throw new Error("launch dialog must close immediately after local launch pending UI is rendered");
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
    !appVersion
  ) {
    throw new Error("Codex assistant responses must render Markdown in framing chat");
  }
  if (
    !serverPy.includes('"active_run": active_run') ||
    !serverPy.includes('"trial_iteration": active_trial_iteration if active_trial_iteration > 0 else None') ||
    !appJs.includes("function activeRun()") ||
    !appJs.includes("function activeRunTrialIteration()") ||
    !appJs.includes("function isAutoresearchActiveRun()") ||
    !serverPy.includes('"expected_trial": expected_trial') ||
    !appJs.includes("function pendingExpectedTrialIteration()") ||
    !appJs.includes("function pendingExpectedTrialReport") ||
    !appJs.includes("function persistentAutoresearchPanelHtml") ||
    !appJs.includes("const showPendingExpected = Boolean(pendingExpected && hasTrialContext)") ||
    !appJs.includes("const activeTrial = manuallySelected ? selected : (liveIteration || (showPendingExpected ? pendingExpected : 0) || selected)") ||
    !appJs.includes("Number(activeTrial) === Number(liveIteration)") ||
    !(
      (
        appJs.includes("const countParts = [`${trials.length} active trial") &&
        appJs.includes("if (reportedCount) countParts.push(`${reportedCount} reported`)")
      ) ||
      (
        appJs.includes("data-autoresearch-panel-collapsed") &&
        appJs.includes("trial-history-latest-update")
      )
    ) ||
    appJs.includes("const activeTrial = selectedTrial(reports)") ||
    !appJs.includes("function isTrialClosingDuringLiveHandoff") ||
    !appJs.includes('if (trial?.is_closed === true) return "Done"') ||
    appJs.includes('if (trial?.is_closed === true) return "Reported"') ||
    !(appJs.includes("Report pending") || appJs.includes("is-pending")) ||
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
    !appJs.includes("trial-report-card is-running") ||
    !appJs.includes("Live trial activity") ||
    !appJs.includes("data-pause-autoresearch") ||
    !appJs.includes("Pause after current turn") ||
    appJs.includes("data-stop-current-run") ||
    appJs.includes("Stop current run") ||
    !appJs.includes("function canStopCurrentRun()") ||
    !appJs.includes("function composerStopIconHtml()") ||
    !appJs.includes('button.dataset.stopMode = stopMode ? "true" : "false"') ||
    !appJs.includes("const coldStopMode = canStopCurrentRun() && !coldComposerHasSendableContent()") ||
    !appJs.includes("const chatStopMode = canStopCurrentRun() && !chatComposerHasSendableContent()") ||
    !appJs.includes("trial-report-control-actions") ||
    !stylesCss.includes(".current-run-control-button") ||
    !stylesCss.includes(".is-stop-mode") ||
    !stylesCss.includes(".trial-report-card") ||
    !stylesCss.includes(".trial-report-control-actions") ||
    appJs.includes("const liveIteration = isLiveGoalSession() ? Number(sessionState().loop_iteration || 0) : 0") ||
    appJs.includes("isSessionRunning() && hasGoalStarted() ? Number(sessionState().loop_iteration || 0) : 0") ||
    appJs.includes("const running = isSessionRunning() && Number(sessionState().loop_iteration || 0) === Number(iteration)")
  ) {
    throw new Error("trial history must show live status only for truly active, unreported trials");
  }
  const hasAutoresearchTrajectoryBlock = appJs.match(/function hasAutoresearchTrajectory\(\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  if (!hasAutoresearchTrajectoryBlock || hasAutoresearchTrajectoryBlock.includes("pendingExpectedTrialIteration")) {
    throw new Error("pending NEXT_TRIAL markers alone must not count as started autoresearch");
  }
  if (
    !appJs.includes("function isSessionInterrupted()") ||
    appJs.includes("claudeAutoresearchGoalCommand") ||
    !appJs.includes("function trialLifecycleActionButtonsHtml") ||
    !appJs.includes("Resume autoresearch") ||
    !appJs.includes("Continue from this trial") ||
    !appJs.includes("trial-report-open-actions") ||
    !appJs.includes("trial-report-control-actions") ||
    !stylesCss.includes(".trial-report-open-actions") ||
    !stylesCss.includes("html[data-theme] .trial-report-open-actions") ||
    stylesCss.includes(":is(.trial-report-actions button, .trial-live-actions button)") ||
    !indexHtml.includes('id="resume-autoresearch-dialog"') ||
    !indexHtml.includes('id="resume-autoresearch-instruction"') ||
    !appJs.includes("data-resume-autoresearch") ||
    !appJs.includes("function openResumeAutoresearchDialog()") ||
    !appJs.includes("function confirmResumeAutoresearch()") ||
    !appJs.includes("function handleResumeAutoresearch(options = {})") ||
    !appJs.includes("body: JSON.stringify({ settings: settingsFromForm(), resumeInstruction })") ||
    !appJs.includes('api("/api/research/resume"') ||
    !appJs.includes('api("/api/research/pause"') ||
    appJs.includes("sendSessionComposerMessage(sessionGoalResumeCommand())") ||
    appJs.includes("sendCommand(sessionGoalPauseCommand())") ||
    !appJs.includes("data-trial-continue") ||
    !appJs.includes('row.hidden = true;') ||
    !appJs.includes('row.innerHTML = "";')
  ) {
    throw new Error("autoresearch lifecycle controls must live in the Trials panel while slash commands stay supported");
  }
  if (
    !appVersion ||
    !appJs.includes('const allowedKinds = new Set(["text", "project", "plan", "goal-launch", "command", "intervention-recorded"])') ||
    !appJs.includes('appendFramingMessage("user", displayText, { kind: "command" })') ||
    !appJs.includes('beginFramingPending(appendedMessage?.id || "");') ||
    !appJs.includes("function framingControlMessageHtml(message)") ||
    !appJs.includes("function controlMessageDisplay(message") ||
    !appJs.includes("const localSlashCommandRegistry = {") ||
    !appJs.includes('return { label: "Autoresearch", value: "Start autoresearch" }') ||
    appJs.includes('"/goal resume": { label: "Autoresearch", value: "Resume autoresearch"') ||
    appJs.includes('"/goal restart": { label: "Autoresearch", value: "Restart autoresearch"') ||
    !appJs.includes("function prelaunchAffordanceState()") ||
    !appJs.includes('primaryLabel: "Start autoresearch"') ||
    !appJs.includes("data-project-launch") ||
    appJs.includes("data-prelaunch-action") ||
    appJs.includes("prelaunchAffordanceHtml") ||
    appJs.includes("renderPrelaunchAffordance") ||
    stylesCss.includes("prelaunch-strip") ||
    appJs.includes('primaryLabel: "Draft PROJECT.md"') ||
    appJs.includes('primaryLabel: "Update PROJECT.md"') ||
    appJs.includes('secondaryLabel: "Start anyway"') ||
    !(
      appJs.includes('data-resume-autoresearch>Resume autoresearch') ||
      (
        appJs.includes('data-resume-autoresearch aria-label="Resume"') &&
        appJs.includes("<span>Resume</span>")
      )
    ) ||
    !(
      appJs.includes('data-trial-continue="${escapeHtml(iteration)}">Continue from this trial') ||
      (
        appJs.includes('data-trial-continue="${escapeHtml(iteration)}" aria-label="Continue from this trial"') &&
        appJs.includes("<span>Continue from this trial</span>")
      )
    ) ||
    !(
      appJs.includes('trial-danger-button" type="button" data-restart-autoresearch>Restart autoresearch') ||
      (
        appJs.includes('data-restart-autoresearch aria-label="Restart"') &&
        appJs.includes("<span>Restart</span>")
      )
    ) ||
    !stylesCss.includes(".trial-report-open-actions") ||
    !stylesCss.includes(".trial-report-control-actions") ||
    !indexHtml.includes(">Start autoresearch<") ||
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
    !stylesVersion ||
    !appJs.includes("function currentProgressStartTime(transcript)") ||
    !appJs.includes("function explicitCurrentRunStartTime(transcript = [])") ||
    !appJs.includes("const latestRunStart = (Array.isArray(transcript) ? transcript : []).reduce") ||
    !appJs.includes("if (isSessionRunning() && explicitRunStart) return explicitRunStart;") ||
    !appJs.includes("function currentRunLiveStatusHtml()") ||
    !appJs.includes("function currentRunActivityDetailsHtml") ||
    !appJs.includes("function currentRunReadableSummary") ||
    !appJs.includes("function liveStatusHtml") ||
    !appJs.includes("const liveStatus = liveStatusHtml(liveEntries, progress, waitState)") ||
    !appJs.includes("agentWaitStateHtml(waitState, { suppressIdle: true })") ||
    !appJs.includes('class="trial-live-status-block"') ||
    !appJs.includes('`Waiting for ${agentLabel(sessionBackend())} events...`') ||
    !appJs.includes('`${agentLabel(sessionBackend())} updates`') ||
    appJs.includes("Waiting for Codex events") ||
    appJs.includes('"Codex updates"') ||
    appJs.includes('"Codex trial updates"') ||
    appJs.includes('details class="run-live-details"') ||
    appJs.includes('details class="trial-detail-activity"') ||
    appJs.includes('details class="framing-run-activity"') ||
    !appJs.includes("let activeActivityPanelKey") ||
    !appJs.includes("let activeActivityPanelSource") ||
    !appJs.includes("const activityPanelSources = new Map()") ||
    !appJs.includes("function ensureActivityPanel()") ||
    !appJs.includes("function openActivityPanel(key)") ||
    !appJs.includes("function closeActivityPanel()") ||
    !appJs.includes("function activityPanelHtml(source)") ||
    !appJs.includes("function activityTimelineHtml(entries, options = {})") ||
    !appJs.includes("data-activity-open") ||
    !appJs.includes("data-activity-key") ||
    !appJs.includes("data-activity-close") ||
    appJs.includes("${framingProgressHtml()}") ||
    !stylesCss.includes(".run-live-status") ||
    !stylesCss.includes(".trial-live-status-block") ||
    !stylesCss.includes(".activity-panel") ||
    !stylesCss.includes(".activity-open-button") ||
    !stylesCss.includes(".activity-timeline") ||
    !stylesCss.includes(".activity-event-card")
  ) {
    throw new Error("running agent progress must be scoped to the current run, opened through the Activity panel, and labeled for the active backend");
  }
  if (
    !appJs.includes("buildFramingActivityByMessage") ||
    !appJs.includes("transcriptRunGroups") ||
    !appJs.includes("inlineRunActivityHtml") ||
    !appJs.includes("registerActivityPanelSource(activityKey") ||
    !appJs.includes("activityOpenButtonHtml") ||
    !appJs.includes("Worked for") ||
    !appJs.includes("htmlBeforeMessageId") ||
    !appJs.includes("entry === finalEntry") ||
    !appJs.includes("messageText === finalText") ||
    !appJs.includes("omitLocal: true") ||
    !appJs.includes("omittedEntryIds") ||
    !stylesCss.includes(".framing-run-activity") ||
    !stylesCss.includes(".framing-run-activity.activity-open-button")
  ) {
    throw new Error("Codex activity must render as a lightweight Worked Activity trigger before its corresponding framing response");
  }
  if (
    appJs.includes("Codex framing activity") ||
    appJs.includes("localSessionActivityHtml") ||
    appJs.includes("Current session activity") ||
    appJs.includes("Latest session activity") ||
    appJs.includes("currentRunActivityHtml") ||
    stylesCss.includes(".current-run-card")
  ) {
    throw new Error("framing/chat Codex events must render as Activity panel triggers or trial activity, not separate current-session cards");
  }
  if (
    appJs.includes("canLaunchAutoresearchFromAssistant") ||
    appJs.includes("latestAssistantTextMessage") ||
    !appJs.includes("function projectDraftAttachmentHtml") ||
    !appJs.includes("function attachProjectDraftToLatestAssistant") ||
    !appJs.includes("function currentProjectDraftFooterMessage") ||
    !appJs.includes("function renderProjectLaunchFallbackPanel") ||
    !appJs.includes("visibleFramingMessagesForRender(localMessages)") ||
    !appJs.includes('markdownFileButtonHtml("PROJECT.md", "PROJECT.md")') ||
    !appJs.includes("function projectDraftLaunchButtonHtml") ||
    !appJs.includes("const launchState = prelaunchAffordanceState()") ||
    !appJs.includes("if (!launchState.showStart) return") ||
    !appJs.includes("has-project-launch") ||
    !appJs.includes("project-launch-action") ||
    !appJs.includes('id: latest?.id || "current-project-draft"') ||
    !appJs.includes('editable: true') ||
    !appJs.includes("PROJECT.md ready") ||
    appJs.includes("projectDraftEditMode") ||
    appJs.includes("data-project-edit") ||
    appJs.includes("data-project-edit-save") ||
    appJs.includes("data-project-edit-cancel") ||
    stylesCss.includes("project-inline-editor") ||
    stylesCss.includes("project-inline-edit")
  ) {
    throw new Error("assistant replies must own collapsed PROJECT.md launch attachments");
  }
  if (
    !indexHtml.includes("project-loading-state") ||
    !indexHtml.includes("Loading projects...") ||
    !indexHtml.includes("Finding available research workspaces") ||
    !appJs.includes("let projectLoadPhase = \"projects\"") ||
    !appJs.includes("function setProjectLoadPhase") ||
    !appJs.includes("function renderProjectLoadingState") ||
    !appJs.includes("const showOverviewLoading = !silent || projectLoadPhase === \"overview\" || projectLoadPhase === \"projects\"") ||
    !appJs.includes("if (showOverviewLoading && projectLoadPhase !== \"overview\" && projectLoadPhase !== \"projects\") setProjectLoadPhase(\"overview\")") ||
    !appJs.includes('sync.textContent = "Could not sync"') ||
    !appJs.includes("Opening project...") ||
    !appJs.includes("Could not read files") ||
    !appJs.includes("data-project-loading-retry") ||
    !stylesCss.includes(".project-loading-state") ||
    !stylesCss.includes("body.is-project-loading")
  ) {
    throw new Error("remote project loading must show an immediate professional loading/error state");
  }
  if (
    appJs.includes("Open BLUEPRINT.md") ||
    appJs.includes('data-inline-fullscreen="${escapeHtml(LATEST_MANUSCRIPT_PATH)}"') ||
    !appJs.includes('data-autoload-file="manuscript/BLUEPRINT.md"') ||
    !appJs.includes('data-download-single-file="${escapeHtml(LATEST_MANUSCRIPT_PATH)}"') ||
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
    !stylesCss.includes("html[data-theme] .trial-chip-index") ||
    !(stylesCss.includes("height: 22px;") || stylesCss.includes("height: 25px;")) ||
    !stylesCss.includes("html[data-theme] :is(.trial-chip.is-active, .trial-chip.is-running) .trial-chip-index") ||
    !(stylesCss.includes("background: color-mix(in srgb, var(--primary-text) 18%, transparent);") || stylesCss.includes("color-mix(in srgb, var(--primary-text) 22%, transparent)")) ||
    !stylesCss.includes("color: var(--primary-text);")
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
    !appJs.includes("function renderManuscriptAppendixPanel") ||
    !appJs.includes("function blueprintAppendixItems") ||
    !appJs.includes("function renderManuscriptAuditPanel") ||
    !appJs.includes("function figureSpecCardsHtml") ||
    !appJs.includes("function figureSpecFields") ||
    !appJs.includes('contextCard("Manuscript story map"') ||
    !appJs.includes('contextCard("Appendix / supplement"') ||
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
    !appJs.includes("https://developers.openai.com/codex/cli") ||
    !appJs.includes("https://developers.openai.com/codex/auth") ||
    !appJs.includes("curl -fsSL https://chatgpt.com/codex/install.sh | sh") ||
    !appJs.includes("https://code.claude.com/docs/en/quickstart") ||
    !appJs.includes("https://code.claude.com/docs/en/iam") ||
    !appJs.includes("curl -fsSL https://claude.ai/install.sh | bash") ||
    !appJs.includes("agentSetupCommandRowsHtml") ||
    !stylesCss.includes(".agent-setup-command-row") ||
    !appJs.includes("Copy description") ||
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
    !serverPy.includes('"appendix_plan"') ||
    !serverPy.includes('"appendix_files"') ||
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
    !stylesCss.includes(".manuscript-appendix") ||
    !stylesCss.includes(".appendix-file-card") ||
    !stylesCss.includes(".publication-table-preview") ||
    !stylesCss.includes(".table-missing-warning") ||
    !stylesCss.includes(".architecture-toc") ||
    !stylesCss.includes(".paragraph-plan-block") ||
    !stylesCss.includes(".manuscript-actions") ||
    !stylesCss.includes(".traceability-details") ||
    !appJs.includes("Download paper-writing pack") ||
    !appJs.includes("Best for GPT/Claude drafting") ||
    !appJs.includes("Best for project handoff") ||
    appJs.includes("Open BLUEPRINT.md") ||
    !appJs.includes("Download BLUEPRINT.md") ||
    !appJs.includes("data-download-single-file") ||
    !appJs.includes("downloadSingleFile") ||
    appJs.includes('data-inline-fullscreen="${escapeHtml(LATEST_MANUSCRIPT_PATH)}"') ||
    !serverPy.includes('query.get("download"') ||
    !serverPy.includes('"attachment" if download else "inline"')
  ) {
    throw new Error("manuscript panel must render a self-contained architecture blueprint with inline artifact blocks, provenance, and copy/open controls");
  }
  const settingsDocLinkRule = stylesCss.match(/\.settings-doc-links a\s*\{[^}]+\}/)?.[0] || "";
  const settingsSmallRule = stylesCss.match(/\.settings-content \.field small\s*\{[^}]+\}/)?.[0] || "";
  const settingsGridRule = stylesCss.match(/\.modal-settings-grid\s*\{[^}]+\}/)?.[0] || "";
  if (
    !indexHtml.includes('id="agent-setup-dialog"') ||
    !indexHtml.includes('id="project-agent-backend-note"') ||
    !indexHtml.includes('id="settings-doc-links"') ||
    !appJs.includes("function runInitialPreflightFlow") ||
    !appJs.includes("function maybeShowAgentSetupDialog") ||
    !appJs.includes("function agentSetupCommands") ||
    !appJs.includes("function agentSetupCommandRowsHtml") ||
    !appJs.includes("function syncBackendDocLinks") ||
    !appJs.includes("function launchBlockingStatus") ||
    !appJs.includes("function startOptimisticAutoresearchSession") ||
    !appJs.includes("function openResumeAutoresearchDialog") ||
    !appJs.includes("function confirmRestartAutoresearch") ||
    !appJs.includes("Remove the Continue from Trial chip before sending a slash command") ||
    !appJs.includes("https://developers.openai.com/codex/cli") ||
    !appJs.includes("https://code.claude.com/docs/en/quickstart") ||
    !stylesCss.includes(".agent-setup-command-row") ||
    !stylesCss.includes(".modal-settings-grid") ||
    !stylesCss.includes(".settings-doc-callout") ||
    !settingsGridRule.includes("grid-template-columns: repeat(2, minmax(0, 1fr))") ||
    !settingsGridRule.includes("align-items: start") ||
    !settingsSmallRule.includes("text-transform: none") ||
    !settingsSmallRule.includes("letter-spacing: 0") ||
    !settingsDocLinkRule.includes("text-decoration: underline") ||
    settingsDocLinkRule.includes("border") ||
    settingsDocLinkRule.includes("border-radius") ||
    settingsDocLinkRule.includes("min-height") ||
    !/@media \(max-width: 900px\)[\s\S]+?\.modal-settings-grid\s*\{[^}]+grid-template-columns: 1fr;/.test(stylesCss)
  ) {
    throw new Error("UI setup/readiness, settings layout, and autoresearch lifecycle controls must keep their checklist coverage contracts");
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
    !appJs.includes("data-resume-trial-remove") ||
    !appJs.includes("function trialLifecycleActionButtonsHtml") ||
    !appJs.includes("function confirmResumeTrialSend") ||
    !appJs.includes("data-resume-trial-confirm") ||
    !appJs.includes('"/api/research/resume-from-trial"') ||
    !appJs.includes("Remove the Continue from Trial chip before sending a slash command") ||
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
    indexHtml.includes('data-command="/goal restart"') ||
    appJs.includes('"/goal restart"') ||
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
    !appJs.includes("const visibleMessages = visibleFramingMessagesForRender(localMessages)") ||
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
  await smokeRemoteCloudflareLink();
  await smokeRemoteCloudflareParserIgnoresApiUrl();
  await smokeRemoteCloudflareTimeoutSummary();
  await smokeRemoteCloudflareTimeoutSuggestsGraftcp();
  await smokeRemoteProxyUsesGraftcp();
  await smokeRemoteProxyOptionOverridesEnv();
  await smokeRemoteProxyModeOffDisablesGraftcp();
  await smokeInstallCloudflaredCommand();
  await smokeInstallCloudflaredGlobalCommandHint();
  await smokeInstallCloudflaredUsesCurl();
  await smokeInstallGraftcpCommand();
  await smokeRemoteCloudflaredMissing();
  await smokeRemoteGraftcpMissing();
  await smokeRemoteSshMode();
  await smokeRemoteCloudflareFallback();
  await smokeRemoteAuth();
  await smokeStreamingHttpIntegration();
  await smokeRealCliStreamingIfAvailable();
  await smokeEmptyDashboardSettings();

  const fakeBin = path.join(tempRoot, "fake-bin");
  await writeFakeCodexBin(fakeBin);
  const doctorOutput = execFileSync("node", [cli, "doctor", "--port", String(await freePort())], {
    cwd: root,
    env: { ...process.env, COAUTO_REMOTE_PROXY_MODE: "off", PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    encoding: "utf8"
  });
  if (!doctorOutput.includes("codex fake 0.0.0")) {
    throw new Error("doctor did not resolve fake Codex executable from PATH");
  }
  if (!doctorOutput.includes("claude fake 0.0.0")) {
    throw new Error("doctor did not resolve fake Claude executable from PATH");
  }
  if (!doctorOutput.includes("cloudflared fake 0.0.0")) {
    throw new Error("doctor did not resolve fake cloudflared executable from PATH");
  }
  if (!doctorOutput.includes("graftcp fake 0.0.0")) {
    throw new Error("doctor did not resolve fake graftcp executable from PATH");
  }
  if (!doctorOutput.includes("package-managed runtime") || !doctorOutput.includes("legacy project ui/server.py")) {
    throw new Error(`doctor should report package-managed UI runtime and legacy project UI fallback:\n${doctorOutput}`);
  }
  const missingCloudflaredDoctorOutput = execFileSync("node", [cli, "doctor", "--port", String(await freePort())], {
    cwd: root,
    env: { ...process.env, COAUTO_REMOTE_PROXY_MODE: "off", COAUTO_CLOUDFLARED: path.join(tempRoot, "missing-cloudflared"), PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    encoding: "utf8"
  });
  if (!missingCloudflaredDoctorOutput.includes("warn    cloudflared") || !missingCloudflaredDoctorOutput.includes("required for best --remote experience")) {
    throw new Error(`doctor should warn when cloudflared is missing:\n${missingCloudflaredDoctorOutput}`);
  }
  if (process.platform === "linux") {
    const missingGraftcpDoctorOutput = execFileSync("node", [cli, "doctor", "--port", String(await freePort())], {
      cwd: root,
      env: {
        ...process.env,
        COAUTO_GRAFTCP: path.join(tempRoot, "missing-graftcp-doctor"),
        HTTPS_PROXY: "http://10.21.11.21:8888",
        COAUTO_REMOTE_PROXY_MODE: "",
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`
      },
      encoding: "utf8"
    });
    if (!missingGraftcpDoctorOutput.includes("warn    graftcp") || !missingGraftcpDoctorOutput.includes("remote proxy - detected http://10.21.11.21:8888")) {
      throw new Error(`doctor should warn when graftcp is missing behind an HTTP proxy:\n${missingGraftcpDoctorOutput}`);
    }
  }
  const invalidBackendDoctorOutput = execFileSync("node", [cli, "doctor", "--port", String(await freePort())], {
    cwd: root,
    env: { ...process.env, COAUTO_REMOTE_PROXY_MODE: "off", COAUTO_AGENT_BACKEND: "not-a-backend", PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    encoding: "utf8"
  });
  if (!invalidBackendDoctorOutput.includes("invalid value") || !invalidBackendDoctorOutput.includes("COAUTO_AGENT_BACKEND")) {
    throw new Error(`doctor should warn about invalid COAUTO_AGENT_BACKEND:\n${invalidBackendDoctorOutput}`);
  }

  const packedName = execNpmSync(["pack", "--pack-destination", tempRoot], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim().split(/\r?\n/).at(-1);
  const packedTarball = path.join(tempRoot, packedName);
  const npmPrefix = path.join(tempRoot, "npm-prefix");
  execNpmSync(["install", "--global", "--prefix", npmPrefix, packedTarball], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe"
  });
  const installedCli = process.platform === "win32"
    ? path.join(npmPrefix, "co-auto-research.cmd")
    : path.join(npmPrefix, "bin", "co-auto-research");
  const installedVersion = execCommandSync(installedCli, ["--version"], { encoding: "utf8" }).trim();
  if (installedVersion !== packageManifest.version) {
    throw new Error(`installed tarball CLI version did not match package.json: ${installedVersion}`);
  }
  const installedDoctorOutput = execCommandSync(installedCli, ["doctor", "--port", String(await freePort())], {
    cwd: root,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    encoding: "utf8"
  });
  if (!installedDoctorOutput.includes("package-managed runtime") || !installedDoctorOutput.includes("codex fake 0.0.0") || !installedDoctorOutput.includes("claude fake 0.0.0") || !installedDoctorOutput.includes("cloudflared fake 0.0.0")) {
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
      "import importlib.util, json, os, pathlib",
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
      "assert module.auth_probe_status('codex', {'ok': True, 'returncode': 0, 'output': 'API key'}) == 'ok'",
      "assert module.auth_probe_status('codex', {'ok': False, 'returncode': 1, 'output': 'No credentials'}) == 'missing'",
      "assert module.auth_probe_status('codex', {'ok': False, 'returncode': 2, 'output': 'unknown subcommand login status'}) == 'unknown'",
      "assert module.auth_probe_status('claude', {'ok': True, 'returncode': 0, 'output': '{\"authenticated\": true}'}) == 'ok'",
      "assert module.auth_probe_status('claude', {'ok': False, 'returncode': 1, 'output': '{\"authenticated\": false}'}) == 'missing'",
      "assert module.auth_probe_status('claude', {'ok': True, 'returncode': 0, 'output': '{\"status\": \"unauthenticated\"}'}) == 'missing'",
      "assert module.auth_probe_status('claude', {'ok': True, 'returncode': 0, 'output': '{\"status\": \"authenticated\"}'}) == 'ok'",
      "no_auto_env = dict(os.environ, PATH=os.environ['COAUTO_CLAUDE_NO_AUTO_PATH'], COAUTO_CLAUDE='', CLAUDE_BIN='')",
      "no_auto = module.claude_permission_mode_status({'permissionPreset': 'auto-review'}, no_auto_env)",
      "assert no_auto['blocking'] and no_auto['mode'] == 'auto', no_auto",
      "default_mode = module.claude_permission_mode_status({'permissionPreset': 'default'}, no_auto_env)",
      "assert default_mode['ok'] and not default_mode['blocking'] and default_mode['mode'] == 'default', default_mode",
      "plan_mode = module.claude_permission_mode_status({'permissionPreset': 'plan'}, no_auto_env)",
      "assert plan_mode['ok'] and not plan_mode['blocking'] and plan_mode['mode'] == 'plan', plan_mode",
      "try:",
      "    module.ensure_agent_ready('claude', no_auto_env, {'permissionPreset': 'auto-review'})",
      "    raise AssertionError('unsupported Claude auto permission mode should block readiness')",
      "except ValueError as exc:",
      "    assert 'permission mode `auto`' in str(exc), str(exc)",
      "missing = module.agent_setup_status('codex', dict(os.environ, PATH='', COAUTO_CODEX='', CODEX_BIN=''))",
      "assert missing['blocking'] and 'COAUTO_CODEX' in missing['message'], missing",
      "assert missing['version_command'] == 'codex --version', missing",
      "assert missing['login_command'] == 'codex login', missing",
      "assert missing['auth_status_command'] == 'codex login status', missing",
      "assert 'COAUTO_CODEX' in missing['env_vars'] and 'CODEX_BIN' in missing['env_vars'], missing",
      "codex_auth = module.agent_setup_status('codex', dict(os.environ, PATH=os.environ['COAUTO_CODEX_FAIL_PATH'], COAUTO_CODEX='', CODEX_BIN=''))",
      "assert codex_auth['blocking'] and 'codex login' in codex_auth['message'], codex_auth",
      "assert codex_auth['login_command'] == 'codex login' and codex_auth['auth_status_command'] == 'codex login status', codex_auth",
      "claude_auth = module.agent_setup_status('claude', dict(os.environ, PATH=os.environ['COAUTO_CLAUDE_FAIL_PATH'], COAUTO_CLAUDE='', CLAUDE_BIN=''))",
      "assert claude_auth['blocking'] and 'claude auth login' in claude_auth['message'], claude_auth",
      "assert claude_auth['version_command'] == 'claude --version', claude_auth",
      "assert claude_auth['login_command'] == 'claude auth login' and claude_auth['auth_status_command'] == 'claude auth status', claude_auth",
      "assert 'COAUTO_CLAUDE' in claude_auth['env_vars'] and 'CLAUDE_BIN' in claude_auth['env_vars'], claude_auth",
      "old_resolve = module.resolve_agent_executable",
      "old_probe = module.run_agent_probe",
      "try:",
      "    module.resolve_agent_executable = lambda backend, process_env=None: 'codex'",
      "    def unknown_probe(backend, executable, args, env=None, timeout=6.0, settings=None):",
      "        if args == ['--version']:",
      "            return {'ok': True, 'returncode': 0, 'output': 'codex fake 0.0.0', 'error': '', 'timeout': False}",
      "        return {'ok': False, 'returncode': 2, 'output': 'unknown subcommand login status', 'error': '', 'timeout': False}",
      "    module.run_agent_probe = unknown_probe",
      "    codex_unknown = module.agent_setup_status('codex', dict(os.environ, PATH=os.environ['COAUTO_FAKE_PATH'], COAUTO_CODEX='', CODEX_BIN=''))",
      "    assert codex_unknown['blocking'] and codex_unknown['auth'] == 'unknown' and 'could not be verified' in codex_unknown['message'], codex_unknown",
      "finally:",
      "    module.resolve_agent_executable = old_resolve",
      "    module.run_agent_probe = old_probe",
      "old_resolve = module.resolve_agent_executable",
      "old_probe = module.run_agent_probe",
      "try:",
      "    module.resolve_agent_executable = lambda backend, *args, **kwargs: backend",
      "    api_probe_calls = []",
      "    def api_provider_probe(backend, executable, args, env=None, timeout=6.0, settings=None):",
      "        api_probe_calls.append(tuple(args))",
      "        if args == ['--version']:",
      "            return {'ok': True, 'returncode': 0, 'output': f'{executable} 1.0.0', 'error': '', 'timeout': False}",
      "        return {'ok': False, 'returncode': 1, 'output': 'No credentials', 'error': '', 'timeout': False}",
      "    module.run_agent_probe = api_provider_probe",
      "    context.ui_settings_path.write_text(json.dumps({'agent': {'backend': 'codex'}, 'codex': {'provider': 'openai_api_key'}, 'claude': {'provider': 'external'}, 'env': {}, 'codex_env': {}, 'claude_env': {}}), encoding='utf-8')",
      "    api_probe_calls.clear()",
      "    codex_api = module.agent_setup_status('codex', dict(os.environ, OPENAI_API_KEY='sk-openai-test'))",
      "    assert codex_api['ok'] and codex_api['auth'] == 'api_key' and ('login', 'status') not in api_probe_calls, (codex_api, api_probe_calls)",
      "    codex_api_missing = module.agent_setup_status('codex', dict(os.environ, OPENAI_API_KEY=''))",
      "    assert codex_api_missing['blocking'] and 'OpenAI API key' in codex_api_missing['message'], codex_api_missing",
      "    context.ui_settings_path.write_text(json.dumps({'agent': {'backend': 'claude'}, 'codex': {'provider': 'cli'}, 'claude': {'provider': 'anthropic_api_key'}, 'env': {}, 'codex_env': {}, 'claude_env': {}}), encoding='utf-8')",
      "    api_probe_calls.clear()",
      "    claude_api = module.agent_setup_status('claude', dict(os.environ, ANTHROPIC_API_KEY='sk-ant-test'))",
      "    assert claude_api['ok'] and claude_api['auth'] == 'api_key' and ('auth', 'status') not in api_probe_calls, (claude_api, api_probe_calls)",
      "    claude_api_missing = module.agent_setup_status('claude', dict(os.environ, ANTHROPIC_API_KEY=''))",
      "    assert claude_api_missing['blocking'] and 'Anthropic API key' in claude_api_missing['message'], claude_api_missing",
      "    context.ui_settings_path.write_text(json.dumps({'agent': {'backend': 'claude'}, 'codex': {'provider': 'cli'}, 'claude': {'provider': 'custom_anthropic'}, 'env': {}, 'codex_env': {}, 'claude_env': {'ANTHROPIC_BASE_URL': 'https://gateway.example'}}), encoding='utf-8')",
      "    custom_missing = module.agent_setup_status('claude', dict(os.environ, ANTHROPIC_BASE_URL='', ANTHROPIC_AUTH_TOKEN='', ANTHROPIC_API_KEY=''))",
      "    assert custom_missing['blocking'] and 'base URL and credential' in custom_missing['message'], custom_missing",
      "finally:",
      "    module.resolve_agent_executable = old_resolve",
      "    module.run_agent_probe = old_probe",
      "context.ui_settings_path.write_text(json.dumps({'agent': {'backend': 'claude'}, 'codex': {'provider': 'cli'}, 'claude': {'provider': 'external'}, 'env': {}, 'codex_env': {}, 'claude_env': {}}), encoding='utf-8')",
      "gateway_env = dict(os.environ, PATH=os.environ['COAUTO_CLAUDE_FAIL_PATH'], COAUTO_CLAUDE='', CLAUDE_BIN='', ANTHROPIC_BASE_URL='https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN='zai-test')",
      "claude_gateway = module.agent_setup_status('claude', gateway_env)",
      "assert claude_gateway['ok'] and not claude_gateway['blocking'] and claude_gateway['auth'] == 'gateway', claude_gateway",
      "partial_gateway = module.agent_setup_status('claude', dict(os.environ, PATH=os.environ['COAUTO_CLAUDE_FAIL_PATH'], COAUTO_CLAUDE='', CLAUDE_BIN='', ANTHROPIC_BASE_URL='https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN='', ANTHROPIC_API_KEY=''))",
      "assert partial_gateway['blocking'] and 'ANTHROPIC_AUTH_TOKEN' in partial_gateway['message'], partial_gateway",
      "(project_root / '.claude').mkdir(exist_ok=True)",
      "(project_root / '.claude' / 'settings.local.json').write_text(json.dumps({'env': {'ANTHROPIC_BASE_URL': 'https://api.z.ai/api/anthropic', 'ANTHROPIC_AUTH_TOKEN': 'local-test'}}), encoding='utf-8')",
      "old_gateway_path = os.environ.get('PATH', '')",
      "old_gateway_claude = os.environ.get('COAUTO_CLAUDE', '')",
      "old_gateway_claude_bin = os.environ.get('CLAUDE_BIN', '')",
      "try:",
      "    os.environ['PATH'] = os.environ['COAUTO_CLAUDE_FAIL_PATH']",
      "    os.environ['COAUTO_CLAUDE'] = ''",
      "    os.environ['CLAUDE_BIN'] = ''",
      "    local_gateway = module.agent_setup_status('claude')",
      "    assert local_gateway['ok'] and local_gateway['auth'] == 'gateway', local_gateway",
      "finally:",
      "    os.environ['PATH'] = old_gateway_path",
      "    os.environ['COAUTO_CLAUDE'] = old_gateway_claude",
      "    os.environ['CLAUDE_BIN'] = old_gateway_claude_bin",
      "(project_root / '.claude' / 'settings.local.json').unlink(missing_ok=True)",
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
      "context.ui_settings_path.parent.mkdir(parents=True, exist_ok=True)",
      "saved_response = module.save_ui_settings({'agent': {'backend': 'codex'}, 'codex': {'provider': 'openai_api_key'}, 'claude': {'provider': 'anthropic_api_key'}, 'env': {}, 'codex_env': {'OPENAI_API_KEY': 'ui-openai-secret'}, 'claude_env': {'ANTHROPIC_API_KEY': 'ui-anthropic-secret'}})",
      "saved_text = json.dumps(saved_response)",
      "assert saved_response['codex']['provider'] == 'openai_api_key', saved_response",
      "assert saved_response['codex_env']['present']['OPENAI_API_KEY'], saved_response",
      "assert saved_response['claude_env']['present']['ANTHROPIC_API_KEY'], saved_response",
      "assert 'ui-openai-secret' not in saved_text and 'ui-anthropic-secret' not in saved_text, saved_response",
      "other_root = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']).parent / 'settings-other-project'",
      "other_context = module.ProjectContext(other_root)",
      "module._CONTEXT.project = other_context",
      "other_settings = module.load_ui_settings()",
      "assert other_settings['agent']['backend'] in {'codex', 'claude'} and not other_settings['codex_env'] and not other_settings['claude_env'], other_settings",
      "module.save_ui_settings({'agent': {'backend': 'claude'}, 'codex': {'provider': 'cli'}, 'claude': {'provider': 'external'}, 'env': {}, 'codex_env': {}, 'claude_env': {}})",
      "assert module.load_ui_settings()['agent']['backend'] == 'claude'",
      "module._CONTEXT.project = context",
      "assert module.load_ui_settings()['agent']['backend'] == 'codex' and module.load_ui_settings()['codex_env'].get('OPENAI_API_KEY') == 'ui-openai-secret'",
      "api_codex_env = module.agent_process_env('codex')",
      "api_claude_env = module.agent_process_env('claude')",
      "assert api_codex_env.get('OPENAI_API_KEY') == 'ui-openai-secret' and 'ANTHROPIC_API_KEY' not in api_codex_env, api_codex_env",
      "assert api_claude_env.get('ANTHROPIC_API_KEY') == 'ui-anthropic-secret' and 'OPENAI_API_KEY' not in api_claude_env and 'ANTHROPIC_BASE_URL' not in api_claude_env, api_claude_env",
      "context.ui_settings_path.write_text(json.dumps({'agent': {'backend': 'codex'}, 'codex': {'provider': 'cli'}, 'codex_env': {'OPENAI_API_KEY': 'ui-openai-secret'}, 'claude': {'provider': 'external'}, 'env': {}, 'claude_env': {}}), encoding='utf-8')",
      "cli_codex_env = module.agent_process_env('codex')",
      "assert 'OPENAI_API_KEY' not in cli_codex_env and 'ANTHROPIC_API_KEY' not in cli_codex_env, cli_codex_env",
      "context.ui_settings_path.write_text(json.dumps({'agent': {'backend': 'codex'}, 'codex': {}, 'claude': {'provider': 'zai_glm'}, 'env': {}, 'claude_env': {'ANTHROPIC_AUTH_TOKEN': 'ui-zai-test'}}), encoding='utf-8')",
      "codex_env = module.agent_process_env('codex')",
      "claude_env = module.agent_process_env('claude')",
      "assert 'ANTHROPIC_AUTH_TOKEN' not in codex_env and 'ANTHROPIC_BASE_URL' not in codex_env, codex_env",
      "assert claude_env.get('ANTHROPIC_AUTH_TOKEN') == 'ui-zai-test' and claude_env.get('ANTHROPIC_BASE_URL') == 'https://api.z.ai/api/anthropic', claude_env",
      "context.ui_settings_path.write_text(json.dumps({'agent': {'backend': 'claude'}, 'codex': {}, 'claude': {'provider': 'external'}, 'env': {}, 'claude_env': {'ANTHROPIC_AUTH_TOKEN': 'ui-zai-test', 'ANTHROPIC_BASE_URL': 'https://api.z.ai/api/anthropic'}}), encoding='utf-8')",
      "external_claude_env = module.agent_process_env('claude')",
      "assert external_claude_env.get('ANTHROPIC_AUTH_TOKEN') != 'ui-zai-test' and external_claude_env.get('ANTHROPIC_BASE_URL') != 'https://api.z.ai/api/anthropic', external_claude_env",
      "codex_settings = module.normalize_research_settings({'backend': 'codex', 'model': 'gpt-5.5', 'reasoningEffort': 'medium', 'permissionPreset': 'auto-review', 'webSearch': True, 'reviewCheckpointInterval': '30'})",
      "context.session.update({'session_id': '00000000-0000-0000-0000-000000000111', 'backend': 'codex', 'settings': codex_settings, 'logs': [], 'raw_logs': [], 'transcript': []})",
      "codex_new_cmd = module.agent_command_for_prompt(False, codex_settings)",
      "codex_resume_cmd = module.agent_command_for_prompt(True, codex_settings)",
      "assert pathlib.Path(codex_new_cmd[0]).name.startswith('codex'), codex_new_cmd",
      "assert codex_new_cmd[1] == 'exec' and '--json' in codex_new_cmd and codex_new_cmd[-1] == '-', codex_new_cmd",
      "assert codex_resume_cmd[1:3] == ['exec', 'resume'] and '00000000-0000-0000-0000-000000000111' in codex_resume_cmd and codex_resume_cmd[-1] == '-', codex_resume_cmd",
      "stale_claude_codex_settings = module.normalize_research_settings({'backend': 'codex', 'model': 'sonnet', 'reasoningEffort': 'medium'})",
      "assert stale_claude_codex_settings['model'] == 'gpt-5.5', stale_claude_codex_settings",
      "direct_codex_args = module.settings_to_codex_args({'model': 'sonnet'}, False)",
      "assert 'sonnet' not in direct_codex_args and 'gpt-5.5' in direct_codex_args, direct_codex_args",
      "settings = module.normalize_research_settings({'backend': 'claude', 'model': 'sonnet', 'reasoningEffort': 'high', 'permissionPreset': 'bypassPermissions', 'webSearch': False, 'reviewCheckpointInterval': '25'})",
      "context.session.update({'session_id': '00000000-0000-0000-0000-000000000123', 'backend': 'claude', 'settings': settings, 'logs': [], 'raw_logs': [], 'transcript': []})",
      "new_cmd = module.agent_command_for_prompt(False, settings)",
      "resume_cmd = module.agent_command_for_prompt(True, settings)",
      "assert pathlib.Path(new_cmd[0]).name.startswith('claude'), new_cmd",
      "assert '-p' in new_cmd and 'stream-json' in new_cmd and '--include-partial-messages' in new_cmd, new_cmd",
      "assert '--permission-mode' in new_cmd and 'bypassPermissions' in new_cmd, new_cmd",
      "assert '--disallowedTools' in new_cmd and 'WebSearch,WebFetch' in new_cmd, new_cmd",
      "assert '--resume' in resume_cmd and '00000000-0000-0000-0000-000000000123' in resume_cmd, resume_cmd",
      "sonnet_max = module.normalize_research_settings({'backend': 'claude', 'model': 'sonnet', 'reasoningEffort': 'max'})",
      "assert sonnet_max['reasoningEffort'] == 'max', sonnet_max",
      "assert '--effort' in module.settings_to_claude_args(sonnet_max, False) and 'max' in module.settings_to_claude_args(sonnet_max, False), module.settings_to_claude_args(sonnet_max, False)",
      "sonnet_xhigh = module.normalize_research_settings({'backend': 'claude', 'model': 'sonnet', 'reasoningEffort': 'xhigh'})",
      "assert sonnet_xhigh['reasoningEffort'] == 'high', sonnet_xhigh",
      "opus_xhigh = module.normalize_research_settings({'backend': 'claude', 'model': 'opus', 'reasoningEffort': 'xhigh'})",
      "assert opus_xhigh['reasoningEffort'] == 'xhigh', opus_xhigh",
      "opus46_xhigh = module.normalize_research_settings({'backend': 'claude', 'model': 'claude-opus-4-6', 'reasoningEffort': 'xhigh'})",
      "assert opus46_xhigh['reasoningEffort'] == 'high', opus46_xhigh",
      "default_effort = module.normalize_research_settings({'backend': 'claude', 'model': 'default', 'reasoningEffort': 'high'})",
      "assert default_effort['reasoningEffort'] == '', default_effort",
      "default_cmd = module.settings_to_claude_args(default_effort, False)",
      "assert not ('--model' in default_cmd and default_cmd[default_cmd.index('--model') + 1] == 'default'), default_cmd",
      "stale_codex_model = module.normalize_research_settings({'backend': 'claude', 'model': 'gpt-5.5', 'reasoningEffort': 'medium'})",
      "assert stale_codex_model['model'] == 'sonnet' and 'gpt-5.5' not in module.settings_to_claude_args(stale_codex_model, False), stale_codex_model",
      "glm_settings = module.normalize_research_settings({'backend': 'claude', 'model': 'glm-5.2[1m]', 'reasoningEffort': 'high'})",
      "glm_cmd = module.settings_to_claude_args(glm_settings, False)",
      "assert glm_settings['model'] == 'glm-5.2[1m]' and glm_settings['reasoningEffort'] == '', glm_settings",
      "assert '--model' in glm_cmd and 'glm-5.2[1m]' in glm_cmd, glm_cmd",
      "disabled_fable = module.normalize_research_settings({'backend': 'claude', 'model': 'fable', 'reasoningEffort': 'max'})",
      "assert disabled_fable['model'] == 'sonnet' and disabled_fable['reasoningEffort'] == 'max', disabled_fable",
      "assert 'fable' not in module.settings_to_claude_args(disabled_fable, False), module.settings_to_claude_args(disabled_fable, False)",
      "haiku_effort = module.normalize_research_settings({'backend': 'claude', 'model': 'haiku', 'reasoningEffort': 'high'})",
      "haiku_cmd = module.settings_to_claude_args(haiku_effort, False)",
      "assert haiku_effort['reasoningEffort'] == '', haiku_effort",
      "assert '--effort' not in haiku_cmd, haiku_cmd",
      "legacy_auto = module.normalize_research_settings({'backend': 'claude', 'permissionPreset': 'auto-review'})",
      "assert legacy_auto['permissionPreset'] == 'auto' and legacy_auto['permissionMode'] == 'auto', legacy_auto",
      "legacy_full = module.normalize_research_settings({'backend': 'claude', 'permissionPreset': 'full-access'})",
      "assert legacy_full['permissionPreset'] == 'bypassPermissions' and legacy_full['permissionMode'] == 'bypassPermissions', legacy_full",
      "official_default = module.settings_to_claude_args(module.normalize_research_settings({'backend': 'claude', 'permissionPreset': 'default'}), False)",
      "assert '--permission-mode' in official_default and 'default' in official_default, official_default",
      "claude_plan_exec = module.implementation_settings_from_payload({'backend': 'claude', 'permissionPreset': 'plan', 'permissionMode': 'plan'})",
      "assert claude_plan_exec['permissionPreset'] == 'default' and claude_plan_exec['permissionMode'] == 'default', claude_plan_exec",
      "assert 'plan' not in module.settings_to_claude_args(claude_plan_exec, False), module.settings_to_claude_args(claude_plan_exec, False)",
      "context.session.update({'session_id': '00000000-0000-0000-0000-000000000111', 'backend': 'codex', 'settings': codex_settings, 'status': 'completed'})",
      "assert module.should_resume_research_session(codex_settings) is True",
      "assert module.should_resume_research_session(settings) is False",
      "context.session.update({'session_id': '019f11fa-506f-75d3-a706-bc20958e7823', 'plan_thread_id': '019f11fa-506f-75d3-a706-bc20958e7823', 'backend': 'codex', 'settings': codex_settings, 'status': 'completed', 'mode': 'plan'})",
      "assert module.should_resume_research_session(codex_settings) is False",
      "context.session.update({'mode': 'goal', 'status': 'completed'})",
      "assert module.should_resume_research_session(codex_settings) is False",
      "context.session_state_path.write_text(json.dumps({'session_id': '019f11fa-506f-75d3-a706-bc20958e7823', 'plan_thread_id': '019f11fa-506f-75d3-a706-bc20958e7823', 'plan_turn_id': 'turn-plan', 'backend': 'codex', 'settings': codex_settings, 'status': 'completed', 'mode': 'goal'}), encoding='utf-8')",
      "reloaded_context = module.ProjectContext(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
      "module._CONTEXT.project = reloaded_context",
      "assert reloaded_context.session['plan_thread_id'] == '019f11fa-506f-75d3-a706-bc20958e7823' and reloaded_context.session['plan_turn_id'] == 'turn-plan', reloaded_context.session",
      "assert module.should_resume_research_session(codex_settings) is False",
      "module._CONTEXT.project = context",
      "context.session.update({'session_id': '00000000-0000-0000-0000-000000000456', 'backend': 'claude', 'settings': settings, 'status': 'completed', 'mode': 'plan', 'plan_thread_id': ''})",
      "assert module.should_resume_research_session(settings) is False",
      "context.session.update({'session_id': '00000000-0000-0000-0000-000000000789', 'backend': 'claude', 'settings': {'backend': 'claude', 'permissionPreset': 'plan', 'permissionMode': 'plan'}, 'status': 'completed', 'mode': 'chat', 'plan_thread_id': ''})",
      "assert module.should_resume_research_session(settings) is False",
      "context.session.update({'session_id': '00000000-0000-0000-0000-000000000123', 'backend': 'claude', 'settings': settings, 'status': 'completed', 'mode': 'chat'})",
      "assert not hasattr(module, 'is_claude_goal_command')",
      "assert not hasattr(module, 'claude_goal_loop_active')",
      "assert module.handle_local_slash_command('/goal', '/goal', {'backend': 'claude'}) is not None",
      "assert module.handle_local_slash_command('/goal clear', '/goal clear', {'backend': 'claude'}) is not None",
      "captured = []",
      "module.start_research_run = lambda prompt, mode, resume, settings_payload=None, loop_active=None, **kwargs: captured.append({'prompt': prompt, 'mode': mode, 'resume': resume, 'loop_active': loop_active, 'settings': settings_payload}) or {'ok': True}",
      "context.session.update({'session_id': '', 'backend': 'claude', 'settings': settings, 'logs': [], 'raw_logs': [], 'transcript': [], 'status': ''})",
      "module.start_research_command({'command': '/goal pause', 'settings': {'backend': 'claude'}})",
      "assert captured == [] and context.session['loop_active'] is False, captured",
      "context.session.update({'session_id': '00000000-0000-0000-0000-000000000123', 'status': 'completed'})",
      "module.start_research_command({'command': '/goal Complete the work', 'settings': {'backend': 'claude'}})",
      "assert captured == [] and context.session['loop_active'] is False, captured",
      "system_line = json.dumps({'type': 'system', 'subtype': 'init', 'session_id': '00000000-0000-0000-0000-000000000999'})",
      "assistant_line = json.dumps({'type': 'assistant', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': 'Final assistant text.'}], 'stop_reason': 'end_turn', 'usage': {'input_tokens': 3, 'output_tokens': 5}}})",
      "tool_line = json.dumps({'type': 'assistant', 'message': {'role': 'assistant', 'content': [{'type': 'tool_use', 'name': 'Bash', 'input': {'command': 'pwd'}}], 'stop_reason': 'tool_use'}})",
      "result_line = json.dumps({'type': 'result', 'subtype': 'success', 'result': 'Done.', 'session_id': '00000000-0000-0000-0000-000000000999', 'total_cost_usd': 0.012})",
      "result_success_line = json.dumps({'type': 'result.success', 'success': 'Hi! How can I help?', 'session_id': '00000000-0000-0000-0000-000000000999'})",
      "nested_success_line = json.dumps({'type': 'result', 'subtype': 'success', 'result': {'success': 'Nested success reply.'}, 'session_id': '00000000-0000-0000-0000-000000000999'})",
      "assert module.transcript_from_claude_line(system_line) is None",
      "assert module.transcript_from_claude_line(assistant_line)['content'] == 'Final assistant text.'",
      "assert module.transcript_from_claude_line(tool_line)['kind'] == 'tool'",
      "assert module.transcript_from_claude_line(result_line)['role'] == 'final'",
      "assert module.transcript_from_claude_line(result_success_line)['content'] == 'Hi! How can I help?'",
      "assert module.transcript_from_claude_line(result_success_line)['raw_type'] == 'result.success'",
      "assert module.transcript_from_claude_line(nested_success_line)['content'] == 'Nested success reply.'",
      "assert module.format_claude_event(result_success_line) == 'result.success: Hi! How can I help?'",
      "context.session.update({'backend': 'claude', 'settings': settings, 'status': 'completed', 'raw_logs': [result_success_line], 'transcript': [{'id': 'tu-old', 'role': 'user', 'kind': 'user', 'raw_type': 'ui.chat', 'content': 'Hi', 'created_at': '2026-06-17T10:00:00.000Z'}]})",
      "assert module.backfill_claude_result_transcript_from_raw_logs() is True",
      "assert any(item.get('raw_type') == 'result.success' and item.get('content') == 'Hi! How can I help?' for item in context.session['transcript']), context.session['transcript']",
      "assert module.backfill_claude_result_transcript_from_raw_logs() is False",
      "module.append_research_log(system_line)",
      "module.append_research_log(assistant_line)",
      "module.append_research_log(tool_line)",
      "module.append_research_log(result_line)",
      "observed_session_id = context.session['session_id']",
      "observed_usage = module.latest_agent_usage()",
      "context.session.clear(); context.session.update(module.new_research_session()); context.session.update({'id': 'S_claude_stream', 'backend': 'claude', 'settings': settings, 'status': 'running', 'mode': 'chat', 'transcript': []})",
      "claude_delta_a = json.dumps({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': 'Hello '}})",
      "claude_delta_b = json.dumps({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': 'Claude'}})",
      "module.append_research_log(claude_delta_a); module.append_research_log(claude_delta_b)",
      "claude_stream = [item for item in context.session['transcript'] if item.get('streaming')]",
      "assert len(claude_stream) == 1 and claude_stream[0]['content'] == 'Hello Claude', context.session['transcript']",
      "claude_final = json.dumps({'type': 'result', 'subtype': 'success', 'result': 'Hello Claude', 'session_id': '00000000-0000-0000-0000-000000000abc'})",
      "module.append_research_log(claude_final)",
      "assert len(context.session['transcript']) == 1 and context.session['transcript'][0]['content'] == 'Hello Claude' and not context.session['transcript'][0].get('streaming'), context.session['transcript']",
      "context.session.clear(); context.session.update(module.new_research_session()); context.session.update({'id': 'S_codex_stream', 'backend': 'codex', 'settings': codex_settings, 'status': 'running', 'mode': 'chat', 'transcript': [], 'last_event_summary': 'Preparing response'})",
      "codex_lifecycle_lines = [json.dumps({'method': 'thread/settings/updated', 'params': {'model': 'gpt-5.5', 'cwd': '/tmp/project'}}), json.dumps({'method': 'thread/status/changed', 'params': {'status': 'active'}}), json.dumps({'method': 'mcpServer/startupStatus/updated', 'params': {'server': 'codex_apps', 'status': 'ready'}}), json.dumps({'method': 'remoteControl/status/changed', 'params': {'status': 'disabled', 'serverName': 'Mac.local'}}), json.dumps({'id': 2, 'result': {'thread': {'id': '019f121a-f385-7541-98e0-3ef965165505', 'sessionId': '019f121a-f385-7541-98e0-3ef965165505', 'status': {'type': 'idle'}, 'path': '/Users/yihong/.codex/sessions/2026/06/29/rollout.jsonl'}, 'modelProvider': 'openai'}}), json.dumps({'id': 3, 'result': {'turn': {'id': '019f121a-f445-77e0-b818-e36c876eee50', 'itemsView': 'notLoaded', 'status': 'inProgress'}}}), json.dumps({'method': 'item/started', 'params': {'item': {'type': 'userMessage', 'content': [{'type': 'text', 'text': 'Plan only. Do not implement.'}]}}}), json.dumps({'method': 'item/completed', 'params': {'item': {'type': 'userMessage', 'content': [{'type': 'text', 'text': 'Plan only. Do not implement.'}]}}}), json.dumps({'method': 'turn/completed', 'params': {'turn': {'id': '019f121a-f445-77e0-b818-e36c876eee50', 'itemsView': 'notLoaded', 'status': 'completed'}}})]",
      "[module.append_research_log(line) for line in codex_lifecycle_lines]",
      "assert context.session['transcript'] == [] and context.session['logs'] == [] and context.session['last_event_summary'] == 'Preparing response', context.session",
      "assert all(module.format_codex_event(line) == '' and module.transcript_from_codex_line(line) is None for line in codex_lifecycle_lines)",
      "codex_delta_a = json.dumps({'type': 'item/agentMessage/delta', 'delta': 'Hello '})",
      "codex_delta_b = json.dumps({'type': 'item/agentMessage/delta', 'delta': 'Codex'})",
      "module.append_research_log(codex_delta_a); module.append_research_log(codex_delta_b)",
      "codex_stream = [item for item in context.session['transcript'] if item.get('kind') == 'assistant']",
      "assert len(codex_stream) == 1 and codex_stream[0]['content'] == 'Hello Codex' and codex_stream[0].get('streaming'), context.session['transcript']",
      "codex_tool_delta = json.dumps({'type': 'item/commandExecution/outputDelta', 'delta': 'stdout line'})",
      "module.append_research_log(codex_tool_delta)",
      "assert any(item.get('kind') == 'tool' and item.get('content') == 'stdout line' for item in context.session['transcript']), context.session['transcript']",
      "codex_final = json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'Hello Codex'}})",
      "module.append_research_log(codex_final)",
      "assert len([item for item in context.session['transcript'] if item.get('kind') == 'assistant']) == 1 and not [item for item in context.session['transcript'] if item.get('kind') == 'assistant'][0].get('streaming'), context.session['transcript']",
      "context.session.clear(); context.session.update(module.new_research_session()); context.session.update({'id': 'S_plan_stream', 'backend': 'codex', 'settings': codex_settings, 'status': 'running', 'mode': 'plan', 'transcript': []})",
      "plan_thread_line = json.dumps({'method': 'thread/started', 'params': {'thread_id': '019f11fa-506f-75d3-a706-bc20958e7823'}})",
      "module.append_research_log(plan_thread_line)",
      "assert context.session['session_id'] == '', context.session",
      "plan_delta = json.dumps({'method': 'item/plan/delta', 'params': {'itemId': 'plan', 'delta': 'Plan text'}})",
      "module.append_research_log(plan_delta)",
      "assert context.session['transcript'] == [], context.session['transcript']",
      "context.session.clear(); context.session.update(module.new_research_session()); context.session.update({'id': 'S_claude_plan_stream', 'backend': 'claude', 'settings': settings, 'status': 'running', 'mode': 'plan', 'transcript': []})",
      "claude_plan_init = json.dumps({'type': 'system', 'subtype': 'init', 'session_id': '00000000-0000-0000-0000-000000000456'})",
      "module.append_research_log(claude_plan_init)",
      "assert context.session['session_id'] == '', context.session",
      "context.research_events.clear(); context.research_event_id = 0; context.session.update({'id': 'S_events', 'backend': 'codex', 'status': 'running', 'mode': 'chat'})",
      "[module.emit_research_event('agent_event', {'log': str(i)}) for i in range(505)]",
      "assert len(context.research_events) == module.RESEARCH_EVENT_BUFFER_MAX and context.research_events[0]['event_id'] == 6 and context.research_events[-1]['event_id'] == 505, (len(context.research_events), context.research_events[0]['event_id'], context.research_events[-1]['event_id'])",
      "replayed = module.research_events_since(context, 503)",
      "assert [event['event_id'] for event in replayed] == [504, 505], replayed",
      "frame = module.format_research_sse_event(replayed[0])",
      "assert frame.startswith('id: 504\\nevent: research\\ndata: ') and frame.endswith('\\n\\n'), frame",
      "usage = observed_usage; context.session['session_id'] = observed_session_id",
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

  const figureImageOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    [
      "import importlib.util, json, os, pathlib, stat, sys, time",
      "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
      "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "project_root = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT'])",
      "context = module.ProjectContext(project_root)",
      "module.PROJECT_REGISTRY = None",
      "module._BOOTSTRAP_CONTEXT = context",
      "module._CONTEXT.project = context",
      "context.ui_settings_path.parent.mkdir(parents=True, exist_ok=True)",
      "context.ui_settings_path.write_text(json.dumps({'agent': {'backend': 'claude'}, 'codex': {'provider': 'cli', 'model': 'gpt-5.5', 'reasoningEffort': 'medium'}, 'claude': {'provider': 'external'}, 'env': {}, 'codex_env': {}, 'claude_env': {}}), encoding='utf-8')",
      "fig_dir = project_root / 'manuscript' / 'figures'",
      "fig_dir.mkdir(parents=True, exist_ok=True)",
      "blueprint = project_root / 'manuscript' / 'BLUEPRINT.md'",
      "blueprint.write_text('# Manuscript Blueprint\\n\\n## Manuscript Architecture\\n\\n##### Figure F000001: Calibration Map\\n\\nPlacement: Section 2.\\n\\nCaption draft or current caption: Old caption.\\n\\nSource artifact or spec path: `manuscript/figures/old.pdf`\\n\\nResult shown or conceptual basis: Evidence.\\n\\n##### Table T000001: Evidence\\n\\nSource artifact or spec path: `manuscript/tables/evidence.csv`\\n', encoding='utf-8')",
      "title = 'Figure F000001: Calibration Map'",
      "assert module.figure_image_output_path(title, 'manuscript/figures/custom.png') == 'manuscript/figures/custom.png'",
      "assert module.figure_image_output_path(title, 'manuscript/figures/custom.pdf') == 'manuscript/figures/generated/figure_f000001_calibration_map.png'",
      "prompt = module.figure_image_prompt(title, 'Purpose: test description', 'manuscript/figures/generated/out.png')",
      "assert 'Use your built-in image generation tool only' in prompt and 'Purpose: test description' in prompt and 'manuscript/figures/generated/out.png' in prompt",
      "inserted = module.replace_or_insert_source_path('Caption draft or current caption: Caption.\\n\\nResult shown or conceptual basis: Evidence.', 'manuscript/figures/generated/inserted.png', title)",
      "assert 'Source artifact or spec path: `manuscript/figures/generated/inserted.png`' in inserted and inserted.index('Source artifact') < inserted.index('Result shown'), inserted",
      "assert 'Preview image:' in inserted and '![Figure F000001: Calibration Map](figures/generated/inserted.png)' in inserted, inserted",
      "try:",
      "    module.start_manuscript_figure_image({'title': title, 'description': 'Purpose: generated figure'})",
      "    raise AssertionError('Saved Claude backend should not start Codex image generation')",
      "except ValueError as exc:",
      "    assert 'Codex' in str(exc), exc",
      "try:",
      "    module.start_manuscript_figure_image({'title': title, 'description': 'Purpose: generated figure', 'settings': {'agent': {'backend': 'claude'}}})",
      "    raise AssertionError('Claude backend should not start Codex image generation')",
      "except ValueError as exc:",
      "    assert 'Codex' in str(exc), exc",
      "try:",
      "    module.start_manuscript_figure_image({'title': title, 'description': 'Purpose: generated figure', 'settings': {'agent': {'backend': 'bad-agent'}}})",
      "    raise AssertionError('Invalid backend should not default into Codex image generation')",
      "except ValueError as exc:",
      "    assert 'Codex' in str(exc), exc",
      "codex_home = pathlib.Path(os.environ['COAUTO_FAKE_CODEX_HOME'])",
      "fake_bin = pathlib.Path(os.environ['COAUTO_FAKE_CODEX_BIN'])",
      "fake_bin.mkdir(parents=True, exist_ok=True)",
      "fake_codex = fake_bin / ('codex.cmd' if os.name == 'nt' else 'codex')",
      "fake_codex_script = fake_bin / 'codex_fake.py'",
      "fake_codex_body = \"\"\"import base64, json, os, pathlib, sys\\nsys.stdin.read()\\nthread_id = '019f0000-0000-7000-8000-000000000123'\\noutdir = pathlib.Path(os.environ['CODEX_HOME']) / 'generated_images' / thread_id\\noutdir.mkdir(parents=True, exist_ok=True)\\npng = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=')\\n(outdir / 'ig_fake.png').write_bytes(png)\\nprint(json.dumps({'type': 'thread.started', 'thread_id': thread_id}), flush=True)\\nprint(json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'generated inline'}}), flush=True)\\n\"\"\"",
      "fake_codex_script.write_text(fake_codex_body, encoding='utf-8')",
      "if os.name == 'nt':",
      "    fake_codex.write_text('@echo off\\r\\n\"{}\" \"{}\"\\r\\n'.format(sys.executable, fake_codex_script), encoding='utf-8')",
      "else:",
      "    fake_codex.write_text('#!/usr/bin/env python3\\n' + fake_codex_body, encoding='utf-8')",
      "fake_codex.chmod(fake_codex.stat().st_mode | stat.S_IXUSR)",
      "os.environ['COAUTO_CODEX'] = str(fake_codex)",
      "os.environ['CODEX_HOME'] = str(codex_home)",
      "module.ensure_agent_ready = lambda *args, **kwargs: {'ok': True}",
      "job = module.start_manuscript_figure_image({'title': title, 'description': 'Purpose: generated figure', 'sourcePath': 'manuscript/figures/old.pdf', 'settings': {'agent': {'backend': 'codex'}, 'codex': {'model': 'gpt-5.5', 'reasoningEffort': 'medium'}}})",
      "full_job = module.FIGURE_IMAGE_JOBS[job['id']]",
      "assert '--ephemeral' in full_job['command'] and '--json' in full_job['command'] and 'approval_policy=\"never\"' in full_job['command'], full_job['command']",
      "deadline = time.time() + 8",
      "status = job",
      "while status['status'] in {'pending', 'running'} and time.time() < deadline:",
      "    time.sleep(0.05)",
      "    status = module.manuscript_figure_image_status(job['id'])",
      "assert status['status'] == 'succeeded', status",
      "assert status['thread_id'] == '019f0000-0000-7000-8000-000000000123', status",
      "assert status['output_path'] == 'manuscript/figures/generated/figure_f000001_calibration_map.png', status",
      "assert (project_root / status['output_path']).read_bytes().startswith(b'\\x89PNG'), status",
      "blueprint_text = blueprint.read_text(encoding='utf-8')",
      "assert 'manuscript/figures/generated/figure_f000001_calibration_map.png' in blueprint_text and 'old.pdf' not in blueprint_text, blueprint_text",
      "assert 'Preview image:' in blueprint_text and '![Figure F000001: Calibration Map](figures/generated/figure_f000001_calibration_map.png)' in blueprint_text, blueprint_text",
      "assert 'manuscript/tables/evidence.csv' in blueprint_text, blueprint_text",
      "print(json.dumps({'status': status['status'], 'output': status['output_path'], 'thread': status['thread_id']}))"
    ].join("\n")
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir,
      COAUTO_FAKE_CODEX_HOME: path.join(tempRoot, "fake-codex-home"),
      COAUTO_FAKE_CODEX_BIN: path.join(tempRoot, "fake-codex-bin")
    },
    encoding: "utf8"
  }).trim();
  if (!figureImageOutput.includes('"status": "succeeded"') || !figureImageOutput.includes("figure_f000001_calibration_map.png")) {
    throw new Error(`Figure image generation smoke test returned unexpected output: ${figureImageOutput}`);
  }

  const chatBoundaryOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    [
      "import importlib.util, json, os, pathlib, shutil",
      "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
      "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "root = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']).parent / 'intervention-project'",
      "shutil.rmtree(root, ignore_errors=True)",
      "(root / 'research_trajectory' / 'trials' / '000001_seed').mkdir(parents=True, exist_ok=True)",
      "(root / 'research_trajectory' / 'trials' / '000001_seed' / 'PLAN.md').write_text('# Plan\\n', encoding='utf-8')",
      "(root / 'research_trajectory' / 'STATE.md').write_text('# Research State\\n\\n## Autoresearch Goal Gate\\n\\nStatus: continue\\n', encoding='utf-8')",
      "context = module.ProjectContext(root)",
      "module._CONTEXT.project = context",
      "settings = module.normalize_research_settings({'backend': 'codex', 'reviewCheckpointInterval': 5})",
      "assert not module.continue_autoresearch_loop_prompt({'status': 'continue', 'summary': 'still open'}, 2).lstrip().startswith('/goal')",
      "captured = []",
      "module.start_research_run = lambda prompt, mode, resume, settings_payload=None, loop_active=None, **kwargs: captured.append({'prompt': prompt, 'mode': mode, 'resume': resume, 'loop_active': loop_active, 'settings': settings_payload, 'kwargs': kwargs}) or {'id': 'mock-session', 'status': 'running', 'mode': mode}",
      "context.session.update({'process': None, 'status': 'completed', 'mode': 'goal', 'loop_active': False, 'loop_iteration': 1, 'settings': settings, 'session_id': '00000000-0000-0000-0000-000000000abc', 'logs': [], 'raw_logs': [], 'transcript': []})",
      "guard_ns = {'module': module, 'settings': settings, 'guarded': False}",
      "exec(\"try:\\n module.start_research_framing({'brief': 'rewrite project', 'settings': settings})\\nexcept ValueError as exc:\\n guarded = 'framing cannot be restarted' in str(exc)\\n\", guard_ns)",
      "assert guard_ns['guarded'], 'framing guard did not reject existing autoresearch context'",
      "ordinary = module.start_research_chat({'message': 'Can you show progress?', 'settings': settings})",
      "assert captured[-1]['mode'] == 'chat' and 'chat/framing mode' in captured[-1]['prompt'], captured[-1]",
      "assert 'human-intervention intake mode' not in captured[-1]['prompt'], captured[-1]['prompt']",
      "assert 'server has not classified it for you' in captured[-1]['prompt'], captured[-1]['prompt']",
      "assert ordinary['files'].get('intervention') is None, ordinary",
      "captured.clear()",
      "module.start_research_chat({'message': '我觉得现在正文里那个结果，还是不够好，现在那个 table 啥意思啊?', 'settings': settings})",
      "assert 'Latest-message intent hint' in captured[-1]['prompt'], captured[-1]['prompt']",
      "assert 'ordinary explanation/question' in captured[-1]['prompt'], captured[-1]['prompt']",
      "assert 'Do not create or update pending intervention files' in captured[-1]['prompt'], captured[-1]['prompt']",
      "captured.clear()",
      "codex_chat_settings = module.normalize_research_settings({'backend': 'codex', 'reviewCheckpointInterval': 5})",
      "context.session.update({'process': None, 'status': 'completed', 'mode': 'chat', 'loop_active': False, 'loop_iteration': 0, 'settings': codex_chat_settings, 'session_id': '', 'logs': [], 'raw_logs': [], 'transcript': []})",
      "module.start_research_chat({'message': 'Recommend a venue and outline before launch.', 'settings': codex_chat_settings})",
      "assert captured[-1]['mode'] == 'chat' and captured[-1]['settings']['backend'] == 'codex', captured[-1]",
      "assert 'Before autoresearch starts, do not create or update human intervention files' in captured[-1]['prompt'], captured[-1]['prompt']",
      "assert 'PROJECT.md` launch-framing updates instead' in captured[-1]['prompt'], captured[-1]['prompt']",
      "assert 'After autoresearch starts, if the message is a formal human intervention' in captured[-1]['prompt'], captured[-1]['prompt']",
      "captured.clear()",
      "claude_chat_settings = module.normalize_research_settings({'backend': 'claude', 'reviewCheckpointInterval': 5})",
      "context.session.update({'process': None, 'status': 'completed', 'mode': 'chat', 'loop_active': False, 'loop_iteration': 0, 'settings': claude_chat_settings, 'session_id': '', 'logs': [], 'raw_logs': [], 'transcript': []})",
      "module.start_research_chat({'message': 'Recommend a venue and outline before launch.', 'settings': claude_chat_settings})",
      "assert captured[-1]['mode'] == 'chat' and captured[-1]['settings']['backend'] == 'claude', captured[-1]",
      "assert 'Before autoresearch starts, do not create or update human intervention files' in captured[-1]['prompt'], captured[-1]['prompt']",
      "assert 'PROJECT.md` launch-framing updates instead' in captured[-1]['prompt'], captured[-1]['prompt']",
      "assert 'After autoresearch starts, if the message is a formal human intervention' in captured[-1]['prompt'], captured[-1]['prompt']",
      "marker_path = root / 'research_trajectory' / 'NEXT_TRIAL.json'",
      "module.sync_expected_trial_pending_interventions('no_pending_interventions')",
      "assert not marker_path.exists(), 'empty pending sync must not create NEXT_TRIAL.json'",
      "intervention_dir = root / 'research_trajectory' / 'human_interventions'",
      "intervention_dir.mkdir(parents=True, exist_ok=True)",
      "intervention_path = intervention_dir / 'I0001_method_direction.md'",
      "intervention_path.write_text('# Human Intervention I0001\\n\\n## Current Effective Instruction\\n\\nUse a better method direction.\\n\\n## Rationale / User Intent\\n\\nThe user wants stronger analysis.\\n\\n## Expected Autoresearch Consequence\\n\\nNext trial should plan around this.\\n\\n## Scope / Non-goals\\n\\nDo not rewrite old trials.\\n\\n## Open Questions\\n\\nNone.\\n\\n## Amendment History\\n\\n- 2026-06-17: created.\\n\\n## Source Chat Turns\\n\\n- u1\\n', encoding='utf-8')",
      "module.sync_human_intervention_indexes('test_agent_created_intervention')",
      "index_payload = json.loads((intervention_dir / 'INDEX.json').read_text(encoding='utf-8'))",
      "assert index_payload['interventions'][0]['status'] == 'pending' and index_payload['interventions'][0]['id'] == 'I0001', index_payload",
      "pending = module.pending_human_interventions()",
      "assert [item['id'] for item in pending] == ['I0001'], pending",
      "marker = module.read_expected_trial_marker()",
      "assert marker.get('pending_intervention_ids') == ['I0001'], marker",
      "assert marker.get('pending_intervention_paths') == ['research_trajectory/human_interventions/I0001_method_direction.md'], marker",
      "RunningProc = type('RunningProc', (), {'poll': lambda self: None})",
      "captured.clear()",
      "context.session.update({'process': RunningProc(), 'status': 'running', 'mode': 'goal', 'loop_active': True, 'loop_iteration': 2, 'settings': settings, 'session_id': '00000000-0000-0000-0000-000000000abc'})",
      "queued = module.start_research_chat({'message': 'prioritize source-level evidence before drafting', 'settings': settings, 'clientMessageId': 'q1'})",
      "assert queued['files']['queued_chat']['queued'] is True and queued['files']['queued_chat']['count'] == 1, queued",
      "priority = module.enqueue_research_queue_item({'message': 'answer this right after stop', 'settings': settings, 'clientMessageId': 'q0', 'priority': 'send_after_stop'})",
      "assert priority['queued_chat_count'] == 2 and priority['queued_chat_items'][0]['id'] == 'q0', priority",
      "assert captured == [], captured",
      "assert context.session['loop_active'] is True",
      "context.session.update({'process': None, 'status': 'completed', 'mode': 'goal', 'loop_active': False, 'loop_iteration': 2, 'settings': settings})",
      "captured.clear()",
      "started_queued_chat = module.maybe_start_queued_chat_after_run('goal', 0)",
      "assert started_queued_chat is True, started_queued_chat",
      "assert captured and captured[-1]['mode'] == 'chat' and captured[-1]['resume'] is True and captured[-1]['loop_active'] is False, captured",
      "assert 'answer this right after stop' in captured[-1]['prompt'], captured[-1]['prompt']",
      "assert 'Before autoresearch starts, do not create or update human intervention files' in captured[-1]['prompt'], captured[-1]['prompt']",
      "framing_after_first_queue = module.load_framing_messages()",
      "assert framing_after_first_queue[-1]['id'] == 'q0' and framing_after_first_queue[-1]['text'] == 'answer this right after stop', framing_after_first_queue",
      "assert [item['id'] for item in module.read_queued_chat_messages()] == ['q1'], module.read_queued_chat_messages()",
      "captured.clear()",
      "context.session.update({'process': None, 'status': 'completed', 'mode': 'chat', 'loop_active': False, 'loop_iteration': 2, 'settings': settings, 'session_id': '00000000-0000-0000-0000-000000000abc'})",
      "started_second_queued_chat = module.maybe_start_queued_chat_after_run('chat', 0)",
      "assert started_second_queued_chat is True and 'prioritize source-level evidence' in captured[-1]['prompt'], captured",
      "assert 'PROJECT.md` launch-framing updates instead' in captured[-1]['prompt'], captured[-1]['prompt']",
      "framing_after_second_queue = module.load_framing_messages()",
      "assert [message['id'] for message in framing_after_second_queue[-2:]] == ['q0', 'q1'], framing_after_second_queue",
      "assert module.read_queued_chat_messages() == [], module.read_queued_chat_messages()",
      "module.write_queued_chat_messages([{'id': 'qd1', 'text': '您好', 'prepared_message': '您好', 'settings': settings}, {'id': 'qd2', 'text': '您好', 'prepared_message': '您好', 'settings': settings}])",
      "context.session.update({'process': None, 'status': 'completed', 'mode': 'chat', 'loop_active': False, 'loop_iteration': 2, 'settings': settings, 'session_id': '00000000-0000-0000-0000-000000000abc'})",
      "assert module.dispatch_next_queued_chat()['started'] is True",
      "context.session.update({'process': None, 'status': 'completed', 'mode': 'chat', 'loop_active': False, 'loop_iteration': 2, 'settings': settings, 'session_id': '00000000-0000-0000-0000-000000000abc'})",
      "assert module.dispatch_next_queued_chat()['started'] is True",
      "duplicate_framing = [message for message in module.load_framing_messages() if message.get('text') == '您好']",
      "assert [message['id'] for message in duplicate_framing[-2:]] == ['qd1', 'qd2'], duplicate_framing",
      "legacy_queue_path = module.queued_chat_messages_path()",
      "legacy_queue_path.parent.mkdir(parents=True, exist_ok=True)",
      "legacy_queue_path.write_text(json.dumps([{'text': 'legacy queued message', 'message': 'legacy queued message'}]), encoding='utf-8')",
      "legacy_first_id = module.read_queued_chat_messages()[0]['id']",
      "legacy_second_id = module.read_queued_chat_messages()[0]['id']",
      "assert legacy_first_id == legacy_second_id and legacy_first_id.startswith('queued_'), (legacy_first_id, legacy_second_id)",
      "legacy_queue_path.write_text(json.dumps([{'text': 'duplicate legacy', 'message': 'duplicate legacy'}, {'text': 'duplicate legacy', 'message': 'duplicate legacy'}]), encoding='utf-8')",
      "legacy_ids = [item['id'] for item in module.read_queued_chat_messages()]",
      "assert len(legacy_ids) == 2 and len(set(legacy_ids)) == 2, legacy_ids",
      "module.delete_research_queue_item({'id': legacy_ids[0]})",
      "remaining_legacy_ids = [item['id'] for item in module.read_queued_chat_messages()]",
      "assert remaining_legacy_ids == [legacy_ids[1]], (legacy_ids, remaining_legacy_ids)",
      "module.clear_queued_chat_messages()",
      "module.write_queued_chat_messages([{'id': 'qa', 'text': 'old text', 'prepared_message': 'old text', 'attachments': {'saved_files': ['resources/user_input/file.pdf'], 'resource_links': [{'mode': 'linked', 'category': 'literature', 'path': 'resources/literature/paper.pdf', 'source': 'paper.pdf'}], 'retained_attachments': [{'kind': 'file', 'path': 'resources/old.csv', 'category': 'data'}], 'resource_clues': [], 'metadata_files': ['resources/user_input/RESOURCE_MANIFEST.md']}, 'settings': settings}])",
      "module.update_research_queue_item({'id': 'qa', 'text': 'new text'})",
      "edited_queue_item = module.read_queued_chat_messages()[0]",
      "assert edited_queue_item['text'] == 'new text', edited_queue_item",
      "assert 'resources/user_input/file.pdf' in edited_queue_item['prepared_message'] and 'resources/literature/paper.pdf' in edited_queue_item['prepared_message'] and 'resources/old.csv' in edited_queue_item['prepared_message'], edited_queue_item['prepared_message']",
      "module.clear_queued_chat_messages()",
      "captured.clear()",
      "module.start_research_command({'command': '/goal Follow the new intervention', 'settings': {'backend': 'codex'}})",
      "assert captured == [] and context.session['loop_active'] is False, captured",
      "claude_settings = module.normalize_research_settings({'backend': 'claude'})",
      "captured.clear()",
      "context.session.update({'process': None, 'status': 'completed', 'mode': 'goal', 'loop_active': False, 'loop_iteration': 2, 'settings': claude_settings, 'session_id': '00000000-0000-0000-0000-000000000abc'})",
      "module.start_research_chat({'message': 'intervention: change method to simulation', 'settings': claude_settings})",
      "assert captured and captured[-1]['mode'] == 'chat' and captured[-1]['settings']['backend'] == 'claude', captured",
      "assert 'Treat the latest user message as an ordinary explanation/question' not in captured[-1]['prompt'], captured[-1]['prompt']",
      "captured.clear()",
      "context.session.update({'process': RunningProc(), 'status': 'running', 'mode': 'goal', 'loop_active': True, 'loop_iteration': 3, 'settings': claude_settings, 'session_id': '00000000-0000-0000-0000-000000000abc'})",
      "queued_without_settings = module.start_research_chat({'message': 'queue without explicit settings', 'clientMessageId': 'qc'})",
      "assert queued_without_settings['files']['queued_chat']['queued'] is True, queued_without_settings",
      "assert module.read_queued_chat_messages()[0]['settings']['backend'] == 'claude', module.read_queued_chat_messages()",
      "context.session.update({'process': None, 'status': 'completed', 'mode': 'goal', 'loop_active': False, 'loop_iteration': 3, 'settings': claude_settings, 'session_id': '00000000-0000-0000-0000-000000000abc'})",
      "started_claude_queue = module.maybe_start_queued_chat_after_run('goal', 0)",
      "assert started_claude_queue is True and captured[-1]['settings']['backend'] == 'claude', captured",
      "assert 'Before autoresearch starts, do not create or update human intervention files' in captured[-1]['prompt'], captured[-1]['prompt']",
      "assert 'PROJECT.md` launch-framing updates instead' in captured[-1]['prompt'], captured[-1]['prompt']",
      "print(json.dumps({'queued': queued['files']['queued_chat']['count'], 'pending': len(module.pending_human_interventions()), 'prompt': captured[-1]['mode']}))",
    ].join("; ")
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir,
      COAUTO_CODEX: process.platform === "win32" ? path.join(fakeBin, "codex.cmd") : path.join(fakeBin, "codex"),
      COAUTO_CLAUDE: process.platform === "win32" ? path.join(fakeBin, "claude.cmd") : path.join(fakeBin, "claude")
    },
    encoding: "utf8"
  }).trim();
  if (!chatBoundaryOutput.includes('"queued": 1') || !chatBoundaryOutput.includes('"pending": 1') || !chatBoundaryOutput.includes('"prompt": "chat"')) {
    throw new Error(`Python chat boundary fixture returned unexpected output: ${chatBoundaryOutput}`);
  }

  const launchPromptOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    [
      "import importlib.util, json, os, pathlib",
      "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
      "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "base = module.autoresearch_goal_prompt()",
      "custom = module.autoresearch_goal_prompt('Prioritize source-level evidence.')",
      "continue_prompt = module.continue_autoresearch_loop_prompt({'status': 'continue', 'summary': 'still open'}, 2)",
      "intervention_prompt = module.intervention_goal_prompt('research_trajectory/human_interventions/pending/I0001.md', 'change scope')",
      "manual_continue_prompt = module.continue_research_prompt()",
      "manual_instruction_prompt = module.continue_research_prompt('Continue the research work.')",
      "assert not base.lstrip().startswith('/goal'), base.splitlines()[0]",
      "assert base.startswith('Start the CoAutoResearch autoresearch process from PROJECT.md.'), base.splitlines()[0]",
      "assert not custom.lstrip().startswith('/goal'), custom.splitlines()[0]",
      "assert 'Additional user instruction for this launch' not in base",
      "assert 'Prioritize source-level evidence.' in custom",
      "assert 'Complete exactly the next coherent trial boundary' in custom",
      "assert 'Required reviewer gates must all be strict `pass`' in custom",
      "resume = module.resume_from_trial_prompt({'id': 'trial_1', 'path': 'research_trajectory/trials/trial_1', 'report_path': 'research_trajectory/trials/trial_1/REPORT.md', 'checkpoint_path': ''}, 'Continue from here.', 'best_effort', 'archive/resume_forks/fork_1/manifest.json', 'research_trajectory/human_interventions/INDEX.md', [], 1, 2)",
      "assert not resume.lstrip().startswith('/goal'), resume.splitlines()[0]",
      "assert resume.startswith('Resume the CoAutoResearch autoresearch process from the selected trial boundary.'), resume.splitlines()[0]",
      "restart = module.restart_autoresearch_prompt('restart_1', 'archive/restarts/restart_1/restart_manifest.json', '')",
      "assert not restart.lstrip().startswith('/goal'), restart.splitlines()[0]",
      "assert restart.startswith('Restart the CoAutoResearch autoresearch process from a clean active trajectory.'), restart.splitlines()[0]",
      "prompts = {'base': base, 'custom': custom, 'continue': continue_prompt, 'intervention': intervention_prompt, 'resume': resume, 'restart': restart}",
      "manual_prompts = {'manual_continue': manual_continue_prompt, 'manual_instruction': manual_instruction_prompt}",
      "review_files = ['PLAN_REVIEW.md', 'PROCESS_REVIEW.md', 'EVIDENCE_REVIEW.md', 'VENUE_FIT_REVIEW.md', 'MANUSCRIPT_REVIEW.md', 'FIGURE_TABLE_REVIEW.md', 'REFERENCE_REVIEW.md', 'FINAL_GATE_REVIEW.md']",
      "assert all('## Resource Scout Brief' in prompt for prompt in prompts.values()), prompts",
      "assert all('Scout: required | skipped' in prompt for prompt in prompts.values()), prompts",
      "assert all('Decision reason:' in prompt for prompt in prompts.values()), prompts",
      "assert all('Skip reason:' in prompt for prompt in prompts.values()), prompts",
      "assert all('Known resource clues:' in prompt for prompt in prompts.values()), prompts",
      "assert all('Freshness / date sensitivity:' in prompt for prompt in prompts.values()), prompts",
      "assert all('RESOURCE_SCOUT_REPORT.md' in prompt for prompt in prompts.values()), prompts",
      "assert all('instructions/RESOURCE_SCOUT.md' in prompt for prompt in prompts.values()), prompts",
      "assert all('spawn a Resource Scout subagent to search, file, and report potentially relevant resources for the overall research goal and current trial, including files, papers, datasets, reports, news, and other external resources via web search or appropriate external sources' in prompt for prompt in prompts.values()), prompts",
      "assert all('Resource Scout fallback' in prompt for prompt in prompts.values()), prompts",
      "assert all('Subagent update: Resource Scout' in prompt for prompt in prompts.values()), prompts",
      "assert all('Download Integrity And Fallback Ladder' in prompt for prompt in prompts.values()), prompts",
      "assert all('quarantine HTML/error-page downloads' in prompt for prompt in prompts.values()), prompts",
      "assert all('spawn a Reviewer Scope Analyst subagent to decide whether the eight core reviewers cover the current trial\\'s review risks' in prompt for prompt in prompts.values()), prompts",
      "assert all('Reviewer Scope Analyst fallback' in prompt for prompt in prompts.values()), prompts",
      "assert all('Subagent update: Reviewer Scope Analyst' in prompt for prompt in prompts.values()), prompts",
      "assert all('Subagent update: Specialized reviewer' in prompt for prompt in prompts.values()), prompts",
      "assert all('Human Task Candidates' in prompt for prompt in prompts.values()), prompts",
      "assert all('only hard stop when no meaningful non-human work remains in the whole autoresearch loop' in prompt for prompt in prompts.values()), prompts",
      "assert all('REVIEWER_SPAWN_DECISION.md' in prompt for prompt in prompts.values()), prompts",
      "assert all('instructions/REVIEWER_SCOPE_ANALYST.md' in prompt for prompt in prompts.values()), prompts",
      "assert all('spawn or run the Resource Scout' not in prompt for prompt in prompts.values()), prompts",
      "assert all('do not silently do the work inline' not in prompt for prompt in prompts.values()), prompts",
      "assert all('autoresearch_discovered' in prompt and 'not current truth' in prompt for prompt in prompts.values()), prompts",
      "assert all(all(name in prompt for name in review_files) for prompt in prompts.values()), prompts",
      "assert all('Reference' in prompt and 'Final gate' in prompt for prompt in prompts.values()), prompts",
      "assert all('Response to human' in prompt for prompt in prompts.values()), prompts",
      "assert all('Subagent update: Resource Scout' in prompt for prompt in manual_prompts.values()), manual_prompts",
      "assert all('Subagent update: Reviewer Scope Analyst' in prompt for prompt in manual_prompts.values()), manual_prompts",
      "assert all('Subagent update: Specialized reviewer' in prompt for prompt in manual_prompts.values()), manual_prompts",
      "assert all('Human Task Candidates' in prompt and 'research_trajectory/HUMAN_TASKS.md' in prompt for prompt in manual_prompts.values()), manual_prompts",
      "subagent_line = 'Subagent update: Resource Scout | status: starting | task: Find source files | output: none'",
      "codex_final = json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'content': subagent_line}})",
      "codex_parsed = module.transcript_from_agent_line(codex_final, 'codex')",
      "assert codex_parsed and codex_parsed['role'] == 'assistant' and subagent_line in codex_parsed['content'], codex_parsed",
      "codex_delta = json.dumps({'method': 'item.agentMessage.delta', 'params': {'item': {'id': 'msg1', 'type': 'agent_message'}, 'delta': subagent_line}})",
      "codex_stream = module.streaming_update_from_agent_line(codex_delta, 'codex')",
      "assert codex_stream and codex_stream['role'] == 'assistant' and subagent_line in codex_stream['text'], codex_stream",
      "claude_delta = json.dumps({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': subagent_line}})",
      "claude_stream = module.streaming_update_from_agent_line(claude_delta, 'claude')",
      "assert claude_stream and claude_stream['role'] == 'assistant' and subagent_line in claude_stream['text'], claude_stream",
      "claude_final = json.dumps({'type': 'assistant', 'message': {'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': subagent_line}]}})",
      "claude_parsed = module.transcript_from_agent_line(claude_final, 'claude')",
      "assert claude_parsed and claude_parsed['role'] == 'assistant' and subagent_line in claude_parsed['content'], claude_parsed",
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

  const localBrowserPathScript = [
    "import importlib.util, json, os, pathlib",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "root = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT'])",
    "module._CONTEXT.project = module.ProjectContext(root)",
    "fixture = root / 'workspace' / 'path fixture'",
    "fixture.mkdir(parents=True, exist_ok=True)",
    "source_file = fixture / 'source note.txt'",
    "source_file.write_text('local browser path fixture\\n', encoding='utf-8')",
    "quoted = module.clean_local_path_input(f'\"{fixture}\"')",
    "assert pathlib.Path(quoted).resolve() == fixture.resolve(), quoted",
    "os.environ['COAUTO_PATH_FIXTURE'] = str(fixture)",
    "expanded = module.clean_local_path_input('%COAUTO_PATH_FIXTURE%')",
    "assert pathlib.Path(expanded).resolve() == fixture.resolve(), expanded",
    "assert module.clean_local_path_input(r'\\\\?\\E:\\Github\\Repo') == r'E:\\Github\\Repo'",
    "unc = module.clean_local_path_input(r'\\\\?\\UNC\\server\\share')",
    "assert unc.startswith(('\\\\\\\\server', '//server')), unc",
    "directory = module.browse_local_path(fixture.as_uri())",
    "assert directory['ok'] is True and pathlib.Path(directory['path']).resolve() == fixture.resolve(), directory",
    "selected = module.browse_local_path(source_file.as_uri())",
    "assert selected['ok'] is True and pathlib.Path(selected['path']).resolve() == fixture.resolve(), selected",
    "assert selected['selected_type'] == 'file' and pathlib.Path(selected['selected_path']).resolve() == source_file.resolve(), selected",
    "missing = module.browse_local_path(str(fixture / 'missing folder'))",
    "assert missing['ok'] is False and missing['error'].startswith('Path does not exist or cannot be opened:'), missing",
    "saved = module.save_resource_links({'resourceLinks': [{'path': source_file.as_uri(), 'category': 'user_input'}]})",
    "assert saved and pathlib.Path(saved[0]['source']).resolve() == source_file.resolve(), saved",
    "print(json.dumps({'directory': directory['path'], 'selected': selected['selected_type'], 'saved': saved[0]['path']}))"
  ].join("\n");
  const localBrowserPathOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    localBrowserPathScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py"),
      COAUTO_PROJECT_ROOT: projectDir
    },
    encoding: "utf8"
  }).trim();
  if (!localBrowserPathOutput.includes('"selected": "file"')) {
    throw new Error(`local browser path smoke returned ${localBrowserPathOutput}`);
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
    "linked_resource_file_visible = any(item['path'].endswith('LLMShopper-TBS-Test/README.md') for item in ongoing['files'])",
    "tree = module.directory_tree('resources')",
    "ongoing_tree = next(child for child in tree['children'] if child['name'] == 'ongoing_work')",
    "linked_tree = next(child for child in ongoing_tree['children'] if child['name'] == 'LLMShopper-TBS-Test')",
    "if linked_tree.get('is_symlink') is True:",
    "    assert linked_tree['children'] == [], linked_tree",
    "else:",
    "    assert linked_resource_file_visible and any(child['name'] == 'README.md' for child in linked_tree.get('children', [])), linked_tree",
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
    "    (trial_dir / 'PLAN.md').write_text('# Plan\\n\\nFinal gate smoke plan.\\n\\n## Resource Scout Brief\\n\\nScout: skipped\\n\\nDecision reason: fixture uses local synthetic artifacts only and no external source can affect this smoke objective.\\n\\nSkip reason: fixture uses local synthetic artifacts only.\\n\\nSearch scope: none.\\n\\nResource types: none.\\n\\nDisciplines/domains: none.\\n\\nKnown resource clues: none.\\n\\nFreshness / date sensitivity: none.\\n\\nDownload policy: none.\\n\\nExpected destinations: none.\\n\\nStop criteria: fixture complete.\\n', encoding='utf-8')",
    "    (trial_dir / 'REPORT.md').write_text('# Report\\n\\nFinal gate smoke report.\\n', encoding='utf-8')",
    "    scout_dir = trial_dir / 'artifacts' / 'resource_scout'",
    "    scout_dir.mkdir(parents=True, exist_ok=True)",
    "    (scout_dir / 'RESOURCE_SCOUT_REPORT.md').write_text('# Resource Scout Report\\n\\nScout: skipped\\n\\n## Reason\\n\\nFixture uses local synthetic artifacts only.\\n', encoding='utf-8')",
    "    spawn_dir = trial_dir / 'artifacts' / 'reviewer_spawn'",
    "    spawn_dir.mkdir(parents=True, exist_ok=True)",
    "    (spawn_dir / 'REVIEWER_SPAWN_DECISION.md').write_text('# Reviewer Scope Analyst Decision\\n\\nSpawn needed: no\\n\\n## Reasoning\\n\\nThe core reviewers cover this synthetic final-gate fixture.\\n', encoding='utf-8')",
    "    blueprint.write_text(\"\"\"# Manuscript Blueprint\n\n## Target Venue / Audience / Article Type\n\nTarget venue: General research venue.\n\nAudience: Researchers.\n\nArticle type: Perspective.\n\nContribution posture: Conceptual synthesis.\n\nEvidence standard: Cited and qualified.\n\nExpected display / method / result style: Minimal displays.\n\n---\n\n## Target-Venue Organization Rationale\n\nThe organization follows a venue-facing perspective structure with problem framing, evidence synthesis, implications, and limits.\n\n---\n\n## Core Story\n\nThe project advances a calibrated, evidence-bounded argument for the declared audience.\n\n---\n\n## Architecture Overview / Table of Contents\n\n- [Section 1: Introduction](#section-1-introduction)\n\n---\n\n## Manuscript Architecture\n\n### Section 1: Introduction\n\nTarget-venue role: Open the perspective with a qualified evidence synthesis.\n\nReader question answered: Why should this perspective exist and what claim is supported?\n\nLocal thesis / purpose: The bounded accepted claim is important but constrained by the reviewed evidence.\n\nLocal claims in plain language: The manuscript makes one bounded claim that is understandable without opening a claim/evidence index.\n\nLocal evidence, results, or artifacts: `research_trajectory/CURRENT_FINDINGS.md` supports the claim through the current source audit.\n\nPlaced displays / methods / results: none.\n\nLocal qualifications: The claim remains bounded to the reviewed evidence.\n\nTransition job: sets up the implication section.\n\nParagraph plan:\n\n| Para | Rhetorical move | Content to cover, not full prose | Local evidence / result / artifact | Display / method / result block | Citation posture | Required qualification | Transition job |\n|---|---|---|---|---|---|---|---|\n| P1 | Establish problem and bounded claim | State the research problem and say exactly what the current finding supports without drafting final prose. | `research_trajectory/CURRENT_FINDINGS.md` | none | cite the accepted source audit | bounded to reviewed evidence | sets up the implication section |\n\n---\n\n## Reference / Literature Grounding Plan\n\nUse the current source audit and seed literature recorded in CURRENT_FINDINGS.\n\n---\n\n## Appendix / Supplement Plan\n\nNo appendix is needed for the scoped perspective; provenance remains in trial reports. No active tables are needed because the comparison is carried locally in Section 1 paragraph P1.\n\n---\n\n## Blocking Missing Evidence\n\n- none\n\n---\n\n## Required Qualifications / Claim Constraints\n\nThe claim remains qualified to the cited evidence and that qualification is reflected in Section 1 paragraph P1.\n\n---\n\n## Provenance / Audit Index\n\n### Claim / Evidence Index\n\nC000001 maps to the local Section 1 claim and `research_trajectory/CURRENT_FINDINGS.md`.\n\n### Display / Method / Result Inventory\n\nNo active displays, methods, datasets, benchmarks, or result blocks are required for this scoped fixture.\n\n### Source Links\n\n- `research_trajectory/CURRENT_FINDINGS.md`\n\n---\n\n## Deprecated Or Superseded Ideas\n\nNone active.\n\n---\n\n## Submission-Readiness Summary\n\nReady for the declared scope after all reviewer gates pass.\n\"\"\", encoding='utf-8')",
    "    review_template = \"\"\"Reviewer: {reviewer}\nScope: {scope}\nDecision: pass\nGate impact: pass\nConfidence: high\nSource trial: `000001_final_smoke`\nGenerated at: 2026-06-20T00:00:00Z\nInstruction file: `{instruction}`\nMigration source: `none`\n\n## Reviewed Inputs\n\n- `PROJECT.md`\n- `research_trajectory/STATE.md`\n- `research_trajectory/trials/000001_final_smoke/PLAN.md`\n- `research_trajectory/trials/000001_final_smoke/REPORT.md`\n\n## Context Summary\n\nSmoke test reviewer fixture.\n\n## Blocking Issues\n\n- none\n\n## Required Actions Before Pass\n\n- none\n\n## Qualified / Partial Passes\n\n- none\n\n## Unassessed Areas\n\n- none\n\"\"\"",
    "    for key, config in module.REQUIRED_REVIEWER_OUTPUTS.items():",
    "        if key == 'final_gate':",
    "            continue",
    "        (review_dir / config['file']).write_text(review_template.format(reviewer=config['label'], scope=config['scope'], instruction=config['instruction']), encoding='utf-8')",
    "    (review_dir / 'FINAL_GATE_REVIEW.md').write_text(\"\"\"Reviewer: Final gate reviewer\nScope: final-gate\nDecision: pass\nGate impact: pass\nConfidence: high\nSource trial: `000001_final_smoke`\nGenerated at: 2026-06-20T00:00:00Z\nInstruction file: `instructions/reviewers/FINAL_GATE_REVIEWER.md`\nMigration source: `none`\n\n## Reviewed Inputs\n\n- `research_trajectory/trials/000001_final_smoke/reviews/PLAN_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/PROCESS_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/EVIDENCE_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/VENUE_FIT_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/MANUSCRIPT_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/FIGURE_TABLE_REVIEW.md`\n- `research_trajectory/trials/000001_final_smoke/reviews/REFERENCE_REVIEW.md`\n\n## Context Summary\n\nSmoke test final gate fixture.\n\n## Artifact Consistency Audit\n\n- core instruction baseline status: current\n- final blueprint section completeness: complete\n- target manual section title/order fidelity: complete\n- paragraph plan completeness: complete\n- accepted claims vs candidate claims status: accepted\n- blocking missing evidence status: none\n- figure plan completeness: complete\n- figure paragraph placement completeness: complete\n- table plan or no-table rationale completeness: complete\n- table paragraph placement and source/result completeness: complete\n- reference/literature grounding completeness: complete\n- Resource Scout status: skipped with valid reason\n- Reviewer Scope Analyst status: decision present; no specialized review needed\n- appendix/supplement plan completeness: complete\n- stale contradiction scan result: none\n- exact reason the gate can pass: all required checks passed\n\n## Blocking Issues\n\n- none\n\n## Required Actions Before Pass\n\n- none\n\n## Qualified / Partial Passes\n\n- none\n\n## Unassessed Areas\n\n- none\n\"\"\", encoding='utf-8')",
    "    module.write_reviewer_baseline_metadata(pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']))",
    "assert module.normalize_gate_status('ready for targeted revision') == 'continue'",
    "assert module.normalize_gate_status('completed') == 'continue'",
    "assert module.normalize_gate_status('approved') == 'continue'",
    "assert module.normalize_gate_status('pass for display inventory') == 'continue'",
    "assert module.normalize_gate_status('pass - architecture coherent; targeted revision required') == 'continue'",
    "assert module.normalize_gate_status('pass - all completed trials have approved plans and reports.') == 'pass'",
    "assert module.normalize_gate_status('pass - no blockers remain') == 'pass'",
    "tasks_path = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']) / 'research_trajectory' / 'HUMAN_TASKS.md'",
    "tasks_path.unlink(missing_ok=True)",
    "empty_tasks = module.read_human_tasks()",
    "assert empty_tasks['open'] == [] and empty_tasks['open_count'] == 0 and empty_tasks['path'] == 'research_trajectory/HUMAN_TASKS.md', empty_tasks",
    "empty_overview = module.build_overview()",
    "empty_session = module.research_session_snapshot()",
    "empty_status = module.build_status_payload()",
    "assert empty_overview['human_tasks']['open'] == [] and empty_overview['human_tasks']['open_count'] == 0, empty_overview['human_tasks']",
    "assert empty_session['human_tasks']['open'] == [] and empty_session['human_tasks']['open_count'] == 0, empty_session['human_tasks']",
    "assert empty_status['human_tasks']['open'] == [] and empty_status['human_tasks']['open_count'] == 0, empty_status['human_tasks']",
    "tasks_path.write_text(\"\"\"# Human Tasks\n\n## Open Tasks\n\n### HT0004: Low priority\nStatus: open\nPriority: low\nBlocks: none\nQuestion: Later low priority question?\nWhy needed: Optional preference.\nContinue meanwhile: Continue evidence cleanup.\nSource: research_trajectory/STATE.md\nCreated: 2026-06-30T00:00:00Z\nUpdated: 2026-06-30T00:00:00Z\n\n### HT0002: High priority\nStatus: open\nPriority: high\nBlocks: final_pass\nQuestion: Confirm final venue?\nWhy needed: Venue affects final pass.\nContinue meanwhile: Continue source audit.\nSource: research_trajectory/trials/000001_final_smoke/REPORT.md\nCreated: 2026-06-30T00:00:00Z\nUpdated: 2026-06-30T00:00:00Z\n\n### HT0003: Medium priority\nStatus: open\nPriority: medium\nBlocks: future_trial\nQuestion: Upload private appendix later?\nWhy needed: Appendix may improve a future trial.\nContinue meanwhile: Continue public-source synthesis.\nSource: research_trajectory/STATE.md\nCreated: 2026-06-30T00:00:00Z\nUpdated: 2026-06-30T00:00:00Z\n\n### HT0001: Closed task\nStatus: closed\nPriority: high\nBlocks: none\nQuestion: Already answered?\nWhy needed: Historical.\nContinue meanwhile: none\nSource: research_trajectory/STATE.md\nCreated: 2026-06-30T00:00:00Z\nUpdated: 2026-06-30T00:00:00Z\n\n### HT0005: Extra high\nStatus: open\nPriority: high\nBlocks: none\nQuestion: Extra visible count?\nWhy needed: Count should include hidden tasks.\nContinue meanwhile: Continue local cleanup.\nSource: research_trajectory/STATE.md\nCreated: 2026-06-30T00:00:00Z\nUpdated: 2026-06-30T00:00:00Z\n\"\"\", encoding='utf-8')",
    "tasks = module.read_human_tasks()",
    "assert tasks['open_count'] == 4 and len(tasks['open']) == 3, tasks",
    "assert [item['id'] for item in tasks['open']] == ['HT0002', 'HT0005', 'HT0003'], tasks",
    "assert tasks['closed'][0]['id'] == 'HT0001', tasks",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: continue - missing source audit\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n- Reference reviewer: pass\n- Final gate reviewer: pass\n\nNext action: finish evidence audit.\n\"\"\", encoding='utf-8')",
    "gate = module.read_autoresearch_gate()",
    "assert gate['overall_status'] == 'pass', gate",
    "assert gate['status'] == 'continue', gate",
    "assert gate['reviewer_statuses']['evidence'] == 'continue', gate",
    "assert gate['all_reviewers_passed'] is False, gate",
    "assert module.gate_has_passed(gate) is False, gate",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: needs_human\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: needs_human - current process requires a decision\n- Evidence reviewer: continue\n- Venue fit reviewer: pass\n- Manuscript reviewer: continue\n- Figure/table reviewer: continue\n- Reference reviewer: pass\n- Final gate reviewer: needs_human\n\nNext action: wait for the user's CSEUA decision.\nResponse to human: Should the next trial run the CSEUA pilot now, or should CSEUA be explicitly deferred?\n\"\"\", encoding='utf-8')",
    "human_gate = module.read_autoresearch_gate()",
    "assert human_gate['status'] == 'blocked', human_gate",
    "assert human_gate['raw_status'] == 'needs_human', human_gate",
    "assert human_gate['response_to_human'] == 'Should the next trial run the CSEUA pilot now, or should CSEUA be explicitly deferred?', human_gate",
    "assert human_gate['response_to_human_source'] == 'response_to_human', human_gate",
    "assert module.gate_has_passed(human_gate) is False, human_gate",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: needs_human\n\nCurrent gate reason: The gate cannot choose between a pilot and a deferral.\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: needs_human\n- Evidence reviewer: continue\n- Venue fit reviewer: pass\n- Manuscript reviewer: continue\n- Figure/table reviewer: continue\n- Reference reviewer: pass\n- Final gate reviewer: needs_human\n\nNext action: ask the user whether to pilot now or defer.\n\"\"\", encoding='utf-8')",
    "legacy_human_gate = module.read_autoresearch_gate()",
    "assert legacy_human_gate['status'] == 'blocked', legacy_human_gate",
    "assert legacy_human_gate['response_to_human'] == 'The gate cannot choose between a pilot and a deferral. ask the user whether to pilot now or defer.', legacy_human_gate",
    "assert legacy_human_gate['response_to_human_source'] == 'legacy_gate_fields', legacy_human_gate",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: blocked\n\nCurrent gate reason: Required private corpus credentials are unavailable.\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: blocked\n- Evidence reviewer: continue\n- Venue fit reviewer: pass\n- Manuscript reviewer: continue\n- Figure/table reviewer: continue\n- Reference reviewer: pass\n- Final gate reviewer: blocked\n\nNext action: ask the user to provide the corpus credentials or approve an alternative public corpus.\n\"\"\", encoding='utf-8')",
    "legacy_blocked_gate = module.read_autoresearch_gate()",
    "assert legacy_blocked_gate['status'] == 'blocked', legacy_blocked_gate",
    "assert legacy_blocked_gate['raw_status'] == 'blocked', legacy_blocked_gate",
    "assert legacy_blocked_gate['response_to_human'] == 'Required private corpus credentials are unavailable. ask the user to provide the corpus credentials or approve an alternative public corpus.', legacy_blocked_gate",
    "assert legacy_blocked_gate['response_to_human_source'] == 'legacy_gate_fields', legacy_blocked_gate",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: pass\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n- Reference reviewer: pass\n\nNext action: none.\n\"\"\", encoding='utf-8')",
    "missing_final = module.read_autoresearch_gate()",
    "assert missing_final['status'] == 'continue', missing_final",
    "assert 'final_gate' in missing_final['missing_reviewers'], missing_final",
    "assert module.gate_has_passed(missing_final) is False, missing_final",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/PLAN_REVIEW.md`\n- Process reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/PROCESS_REVIEW.md`\n- Evidence reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/EVIDENCE_REVIEW.md`\n- Venue fit reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/VENUE_FIT_REVIEW.md`\n- Manuscript reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/MANUSCRIPT_REVIEW.md`\n- Figure/table reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/FIGURE_TABLE_REVIEW.md`\n- Reference reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/REFERENCE_REVIEW.md`\n- Final gate reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/FINAL_GATE_REVIEW.md`\n\nNext action: none.\n\"\"\", encoding='utf-8')",
    "stale = module.read_autoresearch_gate()",
    "assert stale['status'] == 'continue', stale",
    "assert stale['consistency_blockers'], stale",
    "assert module.gate_has_passed(stale) is False, stale",
    "write_final_artifacts()",
    "pass_gate_with_paths = \"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/PLAN_REVIEW.md\n- Process reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/PROCESS_REVIEW.md\n- Evidence reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/EVIDENCE_REVIEW.md\n- Venue fit reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/VENUE_FIT_REVIEW.md\n- Manuscript reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/MANUSCRIPT_REVIEW.md\n- Figure/table reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/FIGURE_TABLE_REVIEW.md\n- Reference reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/REFERENCE_REVIEW.md\n- Final gate reviewer: pass - research_trajectory/trials/000001_final_smoke/reviews/FINAL_GATE_REVIEW.md\n\nNext action: none.\n\"\"\"",
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
    "assert len(trial_review_paths) == 8, trial_review_paths",
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
    "continue_gate = \"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: continue\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: pass\n- Evidence reviewer: continue - missing source audit\n- Venue fit reviewer: pass\n- Manuscript reviewer: pass\n- Figure/table reviewer: pass\n- Reference reviewer: pass\n- Final gate reviewer: pass\n\nNext action: finish evidence audit.\n\"\"\"",
    "pass_gate = \"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: pass\n\nRequired reviewer gates:\n- Plan reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/PLAN_REVIEW.md`\n- Process reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/PROCESS_REVIEW.md`\n- Evidence reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/EVIDENCE_REVIEW.md`\n- Venue fit reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/VENUE_FIT_REVIEW.md`\n- Manuscript reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/MANUSCRIPT_REVIEW.md`\n- Figure/table reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/FIGURE_TABLE_REVIEW.md`\n- Reference reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/REFERENCE_REVIEW.md`\n- Final gate reviewer: pass - `research_trajectory/trials/000001_final_smoke/reviews/FINAL_GATE_REVIEW.md`\n\nNext action: none.\n\"\"\"",
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
    "calls = []",
    "module.start_research_run = lambda prompt, mode, resume, settings_payload=None, loop_active=None, **kwargs: calls.append({'ok': True, 'mode': mode, 'resume': resume, 'loop_active': loop_active, 'kwargs': kwargs, 'prompt': prompt}) or calls[-1]",
    "tasks_path = pathlib.Path(os.environ['COAUTO_PROJECT_ROOT']) / 'research_trajectory' / 'HUMAN_TASKS.md'",
    "tasks_path.write_text('# Human Tasks\\n\\n### HT0001: Confirm later\\nStatus: open\\nPriority: high\\nBlocks: final_pass\\nQuestion: Confirm final venue later?\\nWhy needed: Final venue may affect final pass.\\nContinue meanwhile: Continue evidence audit.\\nSource: research_trajectory/STATE.md\\nCreated: 2026-06-30T00:00:00Z\\nUpdated: 2026-06-30T00:00:00Z\\n', encoding='utf-8')",
    "context.session.update({'loop_active': True, 'mode': 'goal', 'loop_iteration': 2, 'loop_review_checkpoint_iteration': 100, 'loop_stop_reason': '', 'settings': {'backend': 'codex', 'reviewCheckpointInterval': 100}, 'session_id': '00000000-0000-0000-0000-000000000000', 'logs': [], 'raw_logs': [], 'transcript': []})",
    "module.maybe_continue_autoresearch_loop(0)",
    "assert calls and calls[-1]['mode'] == 'goal' and context.session.get('loop_stop_reason') != 'gate_requires_human_input', (calls, context.session)",
    "state.write_text(\"\"\"# Research State\n\n## Autoresearch Goal Gate\n\nStatus: needs_human\n\nRequired reviewer gates:\n- Plan reviewer: pass\n- Process reviewer: needs_human\n- Evidence reviewer: continue\n- Venue fit reviewer: pass\n- Manuscript reviewer: continue\n- Figure/table reviewer: continue\n- Reference reviewer: pass\n- Final gate reviewer: needs_human\n\nNext action: wait for the user's decision.\nResponse to human: Choose the target venue before any useful work can continue?\n\"\"\", encoding='utf-8')",
    "context.session.update({'loop_active': True, 'mode': 'goal', 'loop_iteration': 2, 'loop_review_checkpoint_iteration': 100, 'loop_stop_reason': '', 'settings': {'backend': 'codex', 'reviewCheckpointInterval': 100}, 'session_id': '00000000-0000-0000-0000-000000000000', 'logs': [], 'raw_logs': [], 'transcript': []})",
    "module.maybe_continue_autoresearch_loop(0)",
    "assert context.session['loop_active'] is False and context.session['loop_stop_reason'] == 'gate_requires_human_input', context.session",
    "state.write_text(continue_gate, encoding='utf-8')",
    "context.session.update({'loop_active': False, 'mode': 'goal', 'loop_iteration': 100, 'loop_review_checkpoint_iteration': 100, 'loop_stop_reason': 'review_checkpoint_reached', 'settings': {'reviewCheckpointInterval': 100}, 'session_id': '00000000-0000-0000-0000-000000000000', 'logs': [], 'raw_logs': [], 'transcript': []})",
    "legacy = module.handle_local_slash_command('/goal resume', '/goal resume', {'backend': 'codex', 'reviewCheckpointInterval': 25})",
    "assert legacy and legacy.get('local') is True, legacy",
    "assert context.session['loop_active'] is False, context.session",
    "expected_checkpoint_base = module.latest_active_trial_iteration()",
    "resumed = module.start_resume_autoresearch({'settings': {'backend': 'codex', 'reviewCheckpointInterval': 25}, 'resumeInstruction': 'Prioritize resume evidence.'})",
    "assert resumed and resumed.get('resumed') is True, resumed",
    "assert 'Additional user instruction for this resume' in resumed['session']['prompt'], resumed['session']['prompt']",
    "assert 'Prioritize resume evidence.' in resumed['session']['prompt'], resumed['session']['prompt']",
    "assert context.session['loop_instruction'] == 'Prioritize resume evidence.', context.session",
    "assert context.session['loop_active'] is True, context.session",
    "assert context.session['loop_review_checkpoint_iteration'] == expected_checkpoint_base + 25, context.session",
    "context.session.update({'loop_active': False, 'loop_instruction': 'Stale resume instruction', 'loop_stop_reason': 'review_checkpoint_reached', 'process': None})",
    "blank = module.start_resume_autoresearch({'settings': {'backend': 'codex', 'reviewCheckpointInterval': 25}, 'resumeInstruction': ''})",
    "assert 'Stale resume instruction' not in blank['session']['prompt'], blank['session']['prompt']",
    "assert context.session['loop_instruction'] == '', context.session",
    "print(json.dumps({'default': module.DEFAULT_REVIEW_CHECKPOINT_INTERVAL, 'checkpoint_stop': 'review_checkpoint_reached', 'resumed_checkpoint': context.session['loop_review_checkpoint_iteration'], 'blank_instruction': context.session['loop_instruction']}))"
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
    !checkpointOutput.includes('"resumed_checkpoint":') ||
    !checkpointOutput.includes('"blank_instruction": ""')
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
    "(root / 'research_trajectory' / 'STATE.md').write_text(\"\"\"# Research State\\n\\n## Autoresearch Goal Gate\\n\\nStatus: continue\\n\\nRequired reviewer gates:\\n- Plan reviewer: continue\\n- Process reviewer: continue\\n- Evidence reviewer: continue\\n- Venue fit reviewer: continue\\n- Manuscript reviewer: continue\\n- Figure/table reviewer: continue\\n- Reference reviewer: continue\\n- Final gate reviewer: continue\\n\\nNext action: continue.\\n\"\"\", encoding='utf-8')",
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
    "assert completed_marker['status'] == 'pending', completed_marker",
    "assert 'completion_blocked_reason' in completed_marker, completed_marker",
    "assert 'Server repair:' not in (root / 'research_trajectory' / 'STATE.md').read_text(encoding='utf-8')",
    "context.session.update({'process': None, 'process_thread': object(), 'status': 'running', 'mode': 'framing', 'started_at': '2000-01-01T00:00:00+00:00', 'ended_at': '', 'loop_active': False})",
    "stale_snapshot = module.research_session_snapshot()",
    "assert stale_snapshot['status'] == 'interrupted', stale_snapshot",
    "assert stale_snapshot['active_run']['running'] is False, stale_snapshot['active_run']",
    "assert context.session.get('process_thread') is None, context.session",
    "print(json.dumps({'complete_marker': complete_snapshot['active_run']['trial_iteration'], 'pending_marker': pending_snapshot['active_run']['trial_iteration'], 'completed_gate': completed_snapshot['gate']['status'], 'completed_marker_status': completed_marker['status'], 'blocked': bool(completed_marker.get('completion_blocked_reason')), 'stale_status': stale_snapshot['status'], 'stale_running': stale_snapshot['active_run']['running']}))"
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
    !activeTrialMarkerOutput.includes('"completed_marker_status": "pending"') ||
    !activeTrialMarkerOutput.includes('"blocked": true') ||
    !activeTrialMarkerOutput.includes('"stale_status": "interrupted"') ||
    !activeTrialMarkerOutput.includes('"stale_running": false')
  ) {
    throw new Error(`active trial marker smoke test returned unexpected output: ${activeTrialMarkerOutput}`);
  }

  const trajectoryClosedBoundaryScript = [
    "import importlib.util, json, os, pathlib, tempfile",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server_trajectory_boundary', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "root = pathlib.Path(tempfile.mkdtemp(prefix='coauto-trajectory-boundary-'))",
    "(root / 'PROJECT.md').write_text('# Trajectory Boundary Smoke\\n', encoding='utf-8')",
    "trials_root = root / 'research_trajectory' / 'trials'",
    "def make_trial(number, slug, closed):",
    "    trial = trials_root / f'{number:06d}_{slug}'",
    "    (trial / 'reviews').mkdir(parents=True, exist_ok=True)",
    "    (trial / 'PLAN.md').write_text('# Plan\\n', encoding='utf-8')",
    "    (trial / 'REPORT.md').write_text('# Report\\n', encoding='utf-8')",
    "    review_names = module.REQUIRED_REVIEWER_FILES if closed else ['PLAN_REVIEW.md']",
    "    for name in review_names:",
    "        (trial / 'reviews' / name).write_text('Decision: pass\\nGate impact: pass\\n', encoding='utf-8')",
    "    return trial",
    "trial1 = make_trial(1, 'closed_boundary', True)",
    "trial2 = make_trial(2, 'closed_boundary', True)",
    "trial3 = make_trial(3, 'reported_not_closed', False)",
    "trajectory_path = root / 'research_trajectory' / 'TRAJECTORY.json'",
    "trajectory_path.write_text(json.dumps({'schema_version': module.TRAJECTORY_SCHEMA_VERSION, 'latest_active_trial': trial3.name, 'next_trial_number': 4, 'archived_trial_ids': [], 'last_sync_reason': 'stale_overview'}, indent=2), encoding='utf-8')",
    "(root / 'research_trajectory' / 'STATE.md').write_text('# State\\n', encoding='utf-8')",
    "context = module.ProjectContext(root)",
    "module._CONTEXT.project = context",
    "synced = module.sync_trajectory_state('overview')",
    "assert synced['latest_active_trial'] == trial2.name, synced",
    "assert synced['next_trial_number'] == 3, synced",
    "assert module.latest_active_trial_iteration() == 2, module.latest_active_trial_iteration()",
    "assert module.next_active_trial_iteration() == 3, module.next_active_trial_iteration()",
    "trials = {item['iteration']: item for item in module.collect_trials()}",
    "assert trials[3]['status'] == 'reported' and trials[3]['is_closed'] is False, trials[3]",
    "print(json.dumps({'latest': synced['latest_active_trial'], 'next': synced['next_trial_number'], 'trial3_closed': trials[3]['is_closed']}))"
  ].join("\n");
  const trajectoryClosedBoundaryOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    trajectoryClosedBoundaryScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py")
    },
    encoding: "utf8"
  }).trim();
  if (
    !trajectoryClosedBoundaryOutput.includes('"next": 3') ||
    !trajectoryClosedBoundaryOutput.includes('"trial3_closed": false')
  ) {
    throw new Error(`trajectory closed-boundary smoke test returned unexpected output: ${trajectoryClosedBoundaryOutput}`);
  }

  const specializedReviewOutputPathScript = [
    "import importlib.util, json, os, pathlib, tempfile",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server_specialized_output_path', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "root = pathlib.Path(tempfile.mkdtemp(prefix='coauto-specialized-output-path-'))",
    "(root / 'PROJECT.md').write_text('# Specialized Output Path Smoke\\n', encoding='utf-8')",
    "(root / 'research_trajectory' / 'STATE.md').parent.mkdir(parents=True, exist_ok=True)",
    "(root / 'research_trajectory' / 'STATE.md').write_text('# Research State\\n\\n## Autoresearch Goal Gate\\n\\nStatus: continue\\n', encoding='utf-8')",
    "trial = root / 'research_trajectory' / 'trials' / '000001_specialized_review'",
    "(trial / 'artifacts' / 'resource_scout').mkdir(parents=True, exist_ok=True)",
    "(trial / 'artifacts' / 'reviewer_spawn').mkdir(parents=True, exist_ok=True)",
    "(trial / 'reviews').mkdir(parents=True, exist_ok=True)",
    "plan = \"\"\"# Plan\n\n## Resource Scout Brief\n\nScout: skipped\nDecision reason: local fixture only\nSearch scope: none\nResource types: none\nDisciplines/domains: fixture\nKnown resource clues: none\nFreshness / date sensitivity: none\nDownload policy: none\nExpected destinations: none\nStop criteria: fixture complete\nSkip reason: no external resources needed\n\"\"\"",
    "(trial / 'PLAN.md').write_text(plan, encoding='utf-8')",
    "(trial / 'REPORT.md').write_text('# Report\\n\\nClosed fixture.\\n', encoding='utf-8')",
    "(trial / 'artifacts' / 'resource_scout' / 'RESOURCE_SCOUT_REPORT.md').write_text('# Resource Scout Report\\n\\nScout: skipped\\n\\n## Reason\\n\\nFixture uses local artifacts only.\\n', encoding='utf-8')",
    "(trial / 'artifacts' / 'reviewer_spawn' / 'REVIEWER_SPAWN_DECISION.md').write_text('Spawn needed: yes\\nSpecialized review output path: `research_trajectory/trials/000001_specialized_review/reviews/SPECIALIZED_REVIEW.md`\\n', encoding='utf-8')",
    "(trial / 'reviews' / 'SPECIALIZED_REVIEW.md').write_text('Reviewer: Specialized Reviewer\\nDecision: pass\\nGate impact: pass\\n', encoding='utf-8')",
    "for config in module.REQUIRED_REVIEWER_OUTPUTS.values():",
    "    (trial / 'reviews' / config['file']).write_text(f\"Reviewer: {config['label']}\\nDecision: pass\\nGate impact: pass\\n\", encoding='utf-8')",
    "context = module.ProjectContext(root)",
    "module._CONTEXT.project = context",
    "assert module.trial_dir_is_closed(trial), module.trial_dir_is_closed(trial)",
    "blockers = module.trial_protocol_file_blockers(trial)",
    "assert blockers == [], blockers",
    "(root / 'research_trajectory' / 'NEXT_TRIAL.json').write_text(json.dumps({'schema_version': 1, 'status': 'pending', 'expected_iteration': 1}, indent=2), encoding='utf-8')",
    "assert module.pending_expected_trial_iteration() == 0, module.pending_expected_trial_iteration()",
    "module.validate_expected_trial_marker()",
    "marker = json.loads((root / 'research_trajectory' / 'NEXT_TRIAL.json').read_text(encoding='utf-8'))",
    "assert marker['status'] == 'fulfilled', marker",
    "print(json.dumps({'blockers': blockers, 'marker': marker['status']}))"
  ].join("\n");
  const specializedReviewOutputPathOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    specializedReviewOutputPathScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py")
    },
    encoding: "utf8"
  }).trim();
  if (!specializedReviewOutputPathOutput.includes('"marker": "fulfilled"')) {
    throw new Error(`specialized review output path smoke test returned unexpected output: ${specializedReviewOutputPathOutput}`);
  }

  const legacyBoundaryScript = [
    "import importlib.util, json, os, pathlib, tempfile",
    "server_path = pathlib.Path(os.environ['COAUTO_SERVER_PY'])",
    "spec = importlib.util.spec_from_file_location('coauto_server_legacy_boundary', server_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "root = pathlib.Path(tempfile.mkdtemp(prefix='coauto-legacy-boundary-'))",
    "(root / 'PROJECT.md').write_text('# Legacy Boundary Smoke\\n', encoding='utf-8')",
    "(root / 'research_trajectory').mkdir(parents=True, exist_ok=True)",
    "(root / 'research_trajectory' / 'STATE.md').write_text('# Research State\\n\\n## Autoresearch Goal Gate\\n\\nStatus: continue\\n', encoding='utf-8')",
    "trials = root / 'research_trajectory' / 'trials'",
    "trials.mkdir(parents=True, exist_ok=True)",
    "for iteration in range(1, 21):",
    "    trial = trials / f'{iteration:06d}_legacy_reported'",
    "    (trial / 'artifacts' / 'reviewer_spawn').mkdir(parents=True, exist_ok=True)",
    "    (trial / 'PLAN.md').write_text('# Plan\\n', encoding='utf-8')",
    "    (trial / 'REPORT.md').write_text('# Report\\n', encoding='utf-8')",
    "    (trial / 'reviews').mkdir(exist_ok=True)",
    "    for review_name in module.REQUIRED_REVIEWER_FILES:",
    "        (trial / 'reviews' / review_name).write_text('Decision: pass\\nGate impact: pass\\n', encoding='utf-8')",
    "    (trial / 'artifacts' / 'reviewer_spawn' / 'REVIEWER_SPAWN_DECISION.md').write_text('Spawn needed: no\\n', encoding='utf-8')",
    "partial = trials / '000021_partial_plan_only'",
    "(partial).mkdir(parents=True, exist_ok=True)",
    "(partial / 'PLAN.md').write_text('# Partial plan\\n', encoding='utf-8')",
    "context = module.ProjectContext(root)",
    "module._CONTEXT.project = context",
    "context.session.update({'process': None, 'status': 'completed', 'mode': 'goal', 'loop_active': False, 'loop_iteration': 0, 'logs': [], 'raw_logs': [], 'transcript': []})",
    "assert module.latest_active_trial_iteration() == 20, module.latest_active_trial_iteration()",
    "assert module.next_active_trial_iteration() == 21, module.next_active_trial_iteration()",
    "trajectory = module.sync_trajectory_state('legacy_boundary_smoke')",
    "assert trajectory['latest_active_trial'] == '000020_legacy_reported', trajectory",
    "assert trajectory['next_trial_number'] == 21, trajectory",
    "(root / 'research_trajectory' / 'NEXT_TRIAL.json').write_text(json.dumps({'schema_version': 1, 'status': 'pending', 'expected_iteration': 20}, indent=2), encoding='utf-8')",
    "module.validate_expected_trial_marker()",
    "marker = json.loads((root / 'research_trajectory' / 'NEXT_TRIAL.json').read_text(encoding='utf-8'))",
    "assert marker['status'] == 'pending', marker",
    "assert module.pending_expected_trial_iteration() == 20, module.pending_expected_trial_iteration()",
    "cleanup = module.archive_interrupted_trial_tail('legacy_boundary_smoke')",
    "archived_ids = [item['id'] for item in cleanup['archived']]",
    "assert archived_ids == ['000021_partial_plan_only'], cleanup",
    "assert (trials / '000020_legacy_reported').exists(), 'reported legacy trial must remain active'",
    "assert not (trials / '000021_partial_plan_only').exists(), 'partial unreported tail should be archived'",
    "trajectory_after = json.loads((root / 'research_trajectory' / 'TRAJECTORY.json').read_text(encoding='utf-8'))",
    "assert trajectory_after['latest_active_trial'] == '000020_legacy_reported' and trajectory_after['next_trial_number'] == 21, trajectory_after",
    "print(json.dumps({'latest': trajectory['latest_active_trial'], 'next': trajectory['next_trial_number'], 'archived': archived_ids, 'marker': marker['status'], 'pending': module.pending_expected_trial_iteration()}))"
  ].join("\n");
  const legacyBoundaryOutput = execFileSync(python.command, [
    ...python.args,
    "-c",
    legacyBoundaryScript
  ], {
    cwd: root,
    env: {
      ...process.env,
      COAUTO_SERVER_PY: path.join(root, "templates", "default", "ui", "server.py")
    },
    encoding: "utf8"
  }).trim();
  if (
    !legacyBoundaryOutput.includes('"latest": "000020_legacy_reported"') ||
    !legacyBoundaryOutput.includes('"next": 21') ||
    !legacyBoundaryOutput.includes('"000021_partial_plan_only"') ||
    !legacyBoundaryOutput.includes('"marker": "pending"') ||
    !legacyBoundaryOutput.includes('"pending": 20')
  ) {
    throw new Error(`legacy boundary smoke test returned unexpected output: ${legacyBoundaryOutput}`);
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
    "    reviews = path / 'reviews'",
    "    reviews.mkdir(parents=True, exist_ok=True)",
    "    for review_name in module.REQUIRED_REVIEWER_FILES:",
    "        (reviews / review_name).write_text('# Review\\n', encoding='utf-8')",
    "    return path",
    "base = make_trial('000001_base_boundary', 'Base checkpoint trial.')",
    "later = make_trial('000002_later_superseded', 'Later trial to archive.')",
    "(root / 'PROJECT.md').write_text('# Checkpoint project\\n', encoding='utf-8')",
    "(root / 'research_trajectory' / 'STATE.md').write_text('# Research State\\n\\n## Autoresearch Goal Gate\\n\\nStatus: continue\\n', encoding='utf-8')",
    "(root / 'research_trajectory' / 'CURRENT_FINDINGS.md').write_text('# Findings at checkpoint\\n', encoding='utf-8')",
    "(root / 'manuscript' / 'BLUEPRINT.md').write_text('# Manuscript at checkpoint\\n', encoding='utf-8')",
    "(root / 'resources' / 'user_input' / 'RESOURCE_MANIFEST.md').write_text('# Manifest at checkpoint\\n', encoding='utf-8')",
    "(root / 'research_trajectory' / 'HUMAN_TASKS.md').write_text(\"\"\"# Human Tasks\n\n### HT0001: Checkpoint task\nStatus: open\nPriority: high\nBlocks: final_pass\nQuestion: Restore this task?\nWhy needed: Checkpoint smoke.\nContinue meanwhile: Keep testing.\nSource: research_trajectory/STATE.md\nCreated: 2026-06-30T00:00:00Z\nUpdated: 2026-06-30T00:00:00Z\n\"\"\", encoding='utf-8')",
    "base_trial = module.active_reported_trials()[0]",
    "checkpoint = module.write_trial_checkpoint(base_trial)",
    "assert checkpoint['created'] is True, checkpoint",
    "checkpoint_blueprint = root / checkpoint['path'] / 'manuscript' / 'BLUEPRINT.md'",
    "assert checkpoint_blueprint.read_text(encoding='utf-8') == '# Manuscript at checkpoint\\n'",
    "checkpoint_tasks = root / checkpoint['path'] / 'research_trajectory' / 'HUMAN_TASKS.md'",
    "assert 'Restore this task?' in checkpoint_tasks.read_text(encoding='utf-8'), checkpoint_tasks",
    "collected_base = next(item for item in module.collect_trials() if item['id'] == '000001_base_boundary')",
    "assert collected_base['manuscript_snapshot_path'] == checkpoint['path'] + '/manuscript/BLUEPRINT.md', collected_base",
    "assert collected_base['manuscript_snapshot_exists'] is True, collected_base",
    "assert collected_base['manuscript_snapshot_source'] == 'checkpoint', collected_base",
    "snapshot_file = module.read_text_file(collected_base['manuscript_snapshot_path'])",
    "assert snapshot_file['exists'] is True and snapshot_file['editable'] is False, snapshot_file",
    "active_blueprint = module.read_text_file('manuscript/BLUEPRINT.md')",
    "assert active_blueprint['exists'] is True and active_blueprint['editable'] is True, active_blueprint",
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
    "(root / 'research_trajectory' / 'HUMAN_TASKS.md').write_text(\"\"\"# Human Tasks\n\n### HT9999: Stale task\nStatus: open\nPriority: low\nBlocks: none\nQuestion: stale?\nWhy needed: stale.\nContinue meanwhile: stale.\nSource: research_trajectory/STATE.md\nCreated: 2026-06-30T00:00:00Z\nUpdated: 2026-06-30T00:00:00Z\n\"\"\", encoding='utf-8')",
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
    "restored_tasks = (root / 'research_trajectory' / 'HUMAN_TASKS.md').read_text(encoding='utf-8')",
    "assert 'Restore this task?' in restored_tasks and 'stale?' not in restored_tasks, restored_tasks",
    "assert calls and calls[0]['kwargs']['resume'] is False, calls",
    "assert 'archived' in calls[0]['prompt'].lower(), calls[0]['prompt']",
    "assert 'The next active trial is Trial 2' in calls[0]['prompt'], calls[0]['prompt']",
    "json_index = root / 'archive' / 'resume_forks' / 'INDEX.json'",
    "assert json_index.exists(), 'resume fork JSON index should be written'",
    "json_payload = json.loads(json_index.read_text(encoding='utf-8'))",
    "assert json_payload['forks'][0]['fork_id'] == fork['fork_id'], json_payload",
    "assert json_payload['forks'][0]['archived_trials'][0]['id'] == '000002_later_superseded', json_payload",
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
    "assert 'HUMAN_TASKS.md' in calls[0]['prompt'], calls[0]['prompt']",
    "index_text = pathlib.Path(root / best_fork['fork_index']).read_text(encoding='utf-8')",
    "assert '## F0001' in index_text and '## F0002' in index_text, index_text",
    "assert 'resume from checkpoint' in index_text and 'resume without checkpoint' in index_text, index_text",
    "json_payload = json.loads(json_index.read_text(encoding='utf-8'))",
    "assert [item['fork_number'] for item in json_payload['forks']] == ['F0001', 'F0002'], json_payload",
    "overview = module.build_overview()",
    "graph = overview['trajectory_graph']",
    "assert graph['active']['fork_id'] == best_fork['fork_id'], graph",
    "assert any(item['fork_number'] == 'F0002' for item in graph['forks']), graph",
    "assert any(item.get('is_next_expected') for item in graph['trials']), graph",
    "json_index.unlink()",
    "fallback_forks = module.collect_resume_forks()",
    "assert len(fallback_forks) == 2 and fallback_forks[0]['fork_number'] == 'F0001', fallback_forks",
    "print(json.dumps({'checkpoint': fork['restore_mode'], 'best_effort': best_fork['restore_mode'], 'archived': len(fork['archived_trials']) + len(best_fork['archived_trials']), 'sequences': [fork['fork_sequence'], best_fork['fork_sequence']], 'graph_forks': len(graph['forks'])}))"
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
    "(root / 'research_trajectory' / 'HUMAN_TASKS.md').write_text(\"\"\"# Human Tasks\n\n### HT0001: Old task\nStatus: open\nPriority: high\nBlocks: final_pass\nQuestion: Old question?\nWhy needed: Restart smoke.\nContinue meanwhile: Old work.\nSource: research_trajectory/STATE.md\nCreated: 2026-06-30T00:00:00Z\nUpdated: 2026-06-30T00:00:00Z\n\"\"\", encoding='utf-8')",
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
    "active_tasks = (root / 'research_trajectory' / 'HUMAN_TASKS.md').read_text(encoding='utf-8')",
    "assert '# Human Tasks' in active_tasks and 'Old question?' not in active_tasks and '- none' in active_tasks, active_tasks",
    "assert any(item.endswith('research_trajectory/HUMAN_TASKS.md') for item in restart['snapshot_files']), restart",
    "assert 'research_trajectory/HUMAN_TASKS.md' in restart['reset_files'], restart",
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
      "project_ctx = dashboard.context_for('project')",
      "assert project_ctx.root.resolve() == project_dir.resolve(), project_ctx.root",
      "assert dashboard.context_for(project_ctx.id).root.resolve() == project_dir.resolve()",
      "assert dashboard.context_for(project_dir.name).root.resolve() == project_dir.resolve()",
      "assert dashboard.context_for(project_dir.relative_to(temp_root).as_posix()).root.resolve() == project_dir.resolve()",
      "assert dashboard.context_for(str(project_dir)).root.resolve() == project_dir.resolve()",
      "assert dashboard.context_for('project-two').root.name == 'project-two'",
      "stub_dir = temp_root / 'stub_project'",
      "(stub_dir / 'research_trajectory').mkdir(parents=True)",
      "(stub_dir / 'research_trajectory' / 'TRAJECTORY.json').write_text('{}\\n', encoding='utf-8')",
      "stub_created = dashboard.create_project({'name': 'stub project'})",
      "assert stub_created['display_name'] == 'stub project', stub_created",
      "assert (stub_dir / 'PROJECT.md').exists() and (stub_dir / 'ui' / 'server.py').exists()",
      "dashboard.delete_project({'project': stub_created['id'], 'confirm': 'stub project'})",
      "runtime_stub_dir = temp_root / 'runtime_stub_project'",
      "(runtime_stub_dir / 'ui' / '.runtime').mkdir(parents=True)",
      "(runtime_stub_dir / 'ui' / '.runtime' / 'framing_messages.json').write_text('[]\\n', encoding='utf-8')",
      "runtime_stub_created = dashboard.create_project({'name': 'runtime stub project'})",
      "assert runtime_stub_created['display_name'] == 'runtime stub project', runtime_stub_created",
      "assert (runtime_stub_dir / 'PROJECT.md').exists() and (runtime_stub_dir / 'ui' / 'server.py').exists()",
      "dashboard.delete_project({'project': runtime_stub_created['id'], 'confirm': 'runtime stub project'})",
      "blocked_stub_dir = temp_root / 'blocked_stub_project'",
      "(blocked_stub_dir / 'research_trajectory').mkdir(parents=True)",
      "(blocked_stub_dir / 'research_trajectory' / 'STATE.md').write_text('# State\\n', encoding='utf-8')",
      "try:",
      "    dashboard.create_project({'name': 'blocked stub project'})",
      "    raise AssertionError('blocked project stub was recreated without surfacing the blocking entry')",
      "except ValueError as exc:",
      "    assert 'Blocking entries' in str(exc) and 'research_trajectory/STATE.md' in str(exc), exc",
      "shutil.rmtree(blocked_stub_dir)",
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
      "    assert progress['stage'] == 'gate_update' and progress['gate_updated'] is True and progress['reviewer_count'] == len(reviewer_items), progress",
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
      "        raw_archive_dir = export_ctx.root / 'resources' / 'ongoing_work'",
      "        raw_archive_dir.mkdir(parents=True, exist_ok=True)",
      "        (raw_archive_dir / 'raw_bundle.zip').write_bytes(b'raw-source-archive')",
      "        (export_ctx.root / 'manuscript' / 'BLUEPRINT.md').write_text('Use `research_trajectory/trials/000001_export/artifacts/final_figure.png`. Reference-only raw archive: `resources/ongoing_work/raw_bundle.zip`. Reference-only workspace output: `workspace/results/model.bin`.\\n', encoding='utf-8')",
      "        symlink_created = False",
      "        try:",
      "            os.symlink('/definitely/missing/coauto-export.csv', resources_dir / 'missing.csv')",
      "            symlink_created = True",
      "        except (OSError, NotImplementedError):",
      "            pass",
      "        module.EXPORT_CONFIRMATION_BYTES = 32",
      "        final_estimate = module.export_estimate('final_project')",
      "        assert final_estimate['requires_confirmation'] is True, final_estimate",
      "        assert final_estimate['label'] == 'Clean Project Package', final_estimate",
      "        assert final_estimate['filename'].endswith('-clean-project-package.zip'), final_estimate",
      "        final_plan = module.build_export_plan('final_project')",
      "        final_paths = {item['bundle_path'] for item in final_plan['entries']}",
      "        assert 'manuscript/BLUEPRINT.md' in final_paths, final_paths",
      "        assert 'workspace/results/model.bin' in final_paths, final_paths",
      "        assert 'resources/data_sources/data.csv' in final_paths, final_paths",
      "        assert not any(path.startswith('research_trajectory/') for path in final_paths), final_paths",
      "        if symlink_created:",
      "            assert any(item['path'] == 'resources/data_sources/missing.csv' for item in final_estimate['missing_externals']), final_estimate['missing_externals']",
      "        blueprint_estimate = module.export_estimate('blueprint')",
      "        assert blueprint_estimate['label'] == 'Paper-Writing Pack', blueprint_estimate",
      "        assert blueprint_estimate['filename'].endswith('-paper-writing-pack.zip'), blueprint_estimate",
      "        blueprint_paths = {item['bundle_path'] for item in blueprint_estimate['largest_files']}",
      "        assert 'FINDINGS.md' in blueprint_paths, blueprint_paths",
      "        assert any(path.startswith('assets/') for path in blueprint_paths), blueprint_paths",
      "        assert 'assets/raw_bundle.zip' not in blueprint_paths, blueprint_paths",
      "        assert 'assets/model.bin' not in blueprint_paths, blueprint_paths",
      "        assert not any(path.startswith('research_trajectory/') for path in blueprint_paths), blueprint_paths",
      "        skipped_paths = {item['path'] for item in blueprint_estimate['skipped']}",
      "        assert 'resources/ongoing_work/raw_bundle.zip' in skipped_paths, skipped_paths",
      "        assert 'workspace/results/model.bin' in skipped_paths, skipped_paths",
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
      "            assert 'assets/raw_bundle.zip' not in names, names",
      "            assert 'assets/model.bin' not in names, names",
      "            assert not any(name.startswith('research_trajectory/') for name in names), names",
      "            readme = archive.read('README.md').decode('utf-8')",
      "            assert '# Paper-Writing Pack' in readme, readme",
      "            assert 'human-machine paper writing' in readme, readme",
      "            manifest = json.loads(archive.read('MANIFEST.json').decode('utf-8'))",
      "            assert any(item['bundle_path'] == 'FINDINGS.md' and item['sha256'] for item in manifest['files']), manifest",
      "    finally:",
      "        module.EXPORT_CONFIRMATION_BYTES = original_threshold",
      "dashboard.delete_project({'project': export_probe['id'], 'confirm': 'export probe'})",
      "ctx = dashboard.context_for(created['id'])",
      "stale_ctx = ctx",
      "proc = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])",
      "ctx.session['process'] = proc",
      "ctx.session['status'] = 'running'",
      "deleted = dashboard.delete_project({'project': created['id'], 'confirm': 'renamed ui project'})",
      "assert deleted['stopped_active_run'] is True, deleted",
      "assert proc.poll() is not None, proc.poll()",
      "module._CONTEXT.project = stale_ctx",
      "try:",
      "    try:",
      "        module.save_framing_messages([{'id': 'stale', 'role': 'user', 'text': 'stale write'}])",
      "        raise AssertionError('stale deleted project context was allowed to recreate runtime files')",
      "    except ValueError as exc:",
      "        assert 'deleted' in str(exc) or 'available' in str(exc), exc",
      "finally:",
      "    delattr(module._CONTEXT, 'project')",
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
  await removeTempRootBestEffort(tempRoot);
}
process.exit(0);
