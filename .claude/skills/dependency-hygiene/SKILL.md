---
name: dependency-hygiene
description: Review npm and GitHub Actions dependency changes and Dependabot update PRs.
---

# Dependency hygiene

- Keep `package.json` and `package-lock.json` synchronized.
- Run `npm audit`, `npm outdated`, typecheck, lint, tests, and build after
  dependency changes.
- Review transitive dependencies and lockfile integrity, not only direct
  versions.
- Keep dependency-review checks on incoming PRs.
- GitHub Actions must be pinned to full commit SHAs and granted the minimum
  permissions they need.
- Dependabot version and security updates are enabled
  (`.github/dependabot.yml`). Review its PRs with the same checks; keep
  native-module rebuilds in mind for Electron, `better-sqlite3`,
  `onnxruntime-node` and `sharp` bumps.
