# Security Policy

## Supported Versions

Security reports should target the latest released version. The first planned
package version is `0.1.0`.

## Reporting a Vulnerability

Please report security issues privately through GitHub security advisories once
the repository is published, or email <yihong.tang.edu@gmail.com>. Do not open a
public issue for secrets exposure, arbitrary command execution, path traversal,
or UI access-control problems.

## Local UI Security Notes

The web UI can browse files, attach resources, and launch a local agent CLI
process inside a generated project. Codex is the default backend; Claude Code is
optional. Bind the UI to `127.0.0.1` by default. Do not expose it directly on a
public interface without an authenticated tunnel or other access control.
