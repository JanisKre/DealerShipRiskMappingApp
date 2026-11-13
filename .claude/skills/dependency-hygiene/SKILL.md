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
  permissions they need. The repository enforces SHA pinning and allows only
  GitHub-owned actions plus `ossf/scorecard-action`; a new third-party action
  has to be added to that allowlist in the repository settings first.
- Dependabot version and security updates are enabled
  (`.github/dependabot.yml`). Review its PRs with the same checks; keep
  native-module rebuilds in mind for Electron, `better-sqlite3`,
  `onnxruntime-node` and `sharp` bumps.
