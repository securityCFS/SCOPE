# Security Policy

## Architecture & Trust Model

SCOPE is designed as a **single-operator control surface**. By default, both the Web UI (`127.0.0.1:3000`) and Bridge (`127.0.0.1:4815`) listen strictly on loopback and execute SSH commands using your local user credentials.

- **Never expose ports `3000` or `4815` directly to `0.0.0.0` or the public internet.**
- For remote browser access, use SSH port forwarding, `npm run private-gateway` behind Tailscale Serve (never Funnel), or `npm run shared-gateway` with TLS and an explicit IP allowlist.
- **Local Secrets**: SMTP credentials (`.scope/email-smtp-secret.json`), relay bearer tokens (`.scope/agent-email-relay.json`), gateway access keys, and session caches live exclusively inside the git-ignored `.scope/` directory with `0600` file permissions where supported.
- **Remote Notifications**: Remote hosts only receive a loopback HTTP endpoint (`http://127.0.0.1:4922/v1/notify`) and a scoped bearer token—never your SMTP username or password.
- **Plugins**: Locally imported plugins execute in the same Node.js process as the Bridge. Only install plugins whose source code you have audited.

## Reporting a Vulnerability

Please do not disclose security vulnerabilities, credentials, or private transcripts in public issues. Use the repository's private security advisory feature (GitHub Security Advisories) or contact the maintainers privately with reproduction details, affected commit, and impact.
