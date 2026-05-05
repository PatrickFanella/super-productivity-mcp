# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately through one of these channels:

- **GitHub private security advisory** (preferred): open a draft advisory at  
  <https://github.com/PatrickFanella/super-productivity-mcp/security/advisories/new>
- **Email**: contact the maintainer directly via the email address on their GitHub profile.

Include as much detail as possible:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal proof-of-concept is very helpful)
- Any suggested mitigations

You will receive an acknowledgement within **72 hours** and an initial assessment within **7 days**.

## Scope

This policy covers the Go binary (`cmd/sp-mcp`), the JavaScript plugin bridge (`plugin/bridge`), and the IPC transport (`internal/pluginipc`).

## Supported versions

Only the latest release is actively maintained. Please test against the latest version before reporting.
