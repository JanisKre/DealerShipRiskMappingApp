---
name: testing-quality
description: Extend the repository's unit, coverage, smoke, and regression verification.
---

# Testing quality

- Add focused tests for new business logic and boundary conditions.
- Keep tests deterministic and independent of live external APIs; use fixtures
  or mocks for network and model behavior.
- Run typecheck, lint, unit tests, coverage, and production build before handoff.
- Preserve a coverage threshold that prevents regression without pretending
  untested UI paths are covered. Coverage counts every source file
  (`coverage.include` in `vitest.config.ts`), also those no test loads; the
  thresholds sit just below the measured figures. Raise them when coverage
  rises, never lower them to make a change pass.
- Add an Electron smoke/E2E test when a user-visible workflow cannot be
  meaningfully verified by unit tests.
