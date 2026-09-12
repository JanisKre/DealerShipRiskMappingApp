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
  untested UI paths are covered.
- Add an Electron smoke/E2E test when a user-visible workflow cannot be
  meaningfully verified by unit tests.
