# Security Policy

## Architecture & Trust Model

SCOPE is designed as a **single-operator control surface**. By default, both the Web UI (`127.0.0.1:3000`) and Bridge (`127.0.0.1:4815`) listen strictly on loopback and execute SSH commands using your local user credentials.

- **Never expose ports `3000` or `4815` directly to `0.0.0.0` or the public internet.**
- For remote browser access, use SSH port forwarding, `npm run private-gateway` behind Tailscale Serve (never Funnel), or `npm run shared-gateway` with TLS and an explicit IP allowlist.
- **Local Secrets**: SMTP credentials (`.scope/email-smtp-secret.json`), relay bearer tokens (`.scope/agent-email-relay.json`), gateway access keys, and session caches live exclusively inside the git-ignored `.scope/` directory with `0600` file permissions where supported.
- **Remote Notifications**: Remote hosts only receive a loopback HTTP endpoint (`http://127.0.0.1:4922/v1/notify`) and a scoped bearer token—never your SMTP username or password.
- **Forwarded ports (`/scope-port`)**: Forwarded web apps share the SCOPE origin unless `SCOPE_PORT_ORIGIN` points the gateway at a separate hostname. On the shared origin, any script in a forwarded page can act as the signed-in operator, so only forward content you trust, or enable the isolated port origin (see `docs/remote-access.md`).
- **Opt-in public static document shares (`SCOPE_SHARE_ORIGIN`)**: Disabled by default. When enabled on a separate origin (recommended) or via `SCOPE_ALLOW_SAME_ORIGIN_SHARE=1`, only explicitly shared connected ports are served under an unguessable 192-bit token, strictly limited to anonymous `GET`/`HEAD` requests (no cookies/auth headers forwarded, no `Set-Cookie`, no WebSockets, no Service Workers, `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`). Stopping the port or revoking the share invalidates the URL immediately.
- **Plugins**: Locally imported plugins execute in the same Node.js process as the Bridge. Only install plugins whose source code you have audited.

## Reporting a Vulnerability

Please do not disclose security vulnerabilities, credentials, or private transcripts in public issues. Use the repository's private security advisory feature (GitHub Security Advisories) or contact the maintainers privately with reproduction details, affected commit, and impact.
