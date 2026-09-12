---
name: dependency-hygiene
description: Review npm and GitHub Actions dependency changes without creating unrequested update PRs.
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
- Automatic Dependabot PRs are disabled in this repository; report or document
  alerts, but do not re-enable PR generation implicitly.
