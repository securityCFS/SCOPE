# Contributing to SCOPE

Thank you for helping improve SCOPE! Keep pull requests focused, well-tested, and clean of machine-specific state.

## Architecture Guidelines

- **Frontend UI**: Place components and styles under their respective `features/<domain>/` directory; keep shared logic in `lib/` or focused hooks. Keep UI strings wrapped with `tr(zh, en)` via `useLocale()` when adding user-facing settings or navigation controls.
- **Backend Bridge**: Route handlers belong in `bridge/routes/`; agent transport and output parsing belong in `bridge/providers/`; scheduling and persistence belong in `bridge/workbench/`.
- **Session & Execution Safety**: Preserve native session IDs, never silently retry ambiguous launches, never fall back to direct execution when a user-configured pre-launch command fails, and never terminate unrelated processes or external user terminals.
- **No Personal Data or Hardcoded Defaults**: Never commit `.scope/`, `.env*`, real IP addresses, hostnames, emails, or personal proxy commands.

## Local Checks

Before opening a pull request, run the full check suite:

```sh
npm run typecheck
npm run build
npm run test:unit
npm run lint
npm run export:opensource -- --check
```

Use `npm run preview:fixture` to inspect UI and theme changes (light & dark modes, narrow & wide viewports, `zh-CN` & `en`) safely without connecting to live SSH hosts or paid model APIs.
