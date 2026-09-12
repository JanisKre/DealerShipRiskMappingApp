---
name: repository-governance
description: Maintain contribution, review, issue, and release governance for this repository.
---

# Repository governance

Use this skill when changing `.github/`, contribution docs, branch rules, issue
templates, or pull-request workflows.

- Keep `main` protected: pull request, required CI, no force-push/deletion, and
  no administrator bypass.
- Keep CODEOWNERS, issue forms, `SUPPORT.md`, `SECURITY.md`, and the PR template
  aligned with the actual project workflow.
- Prefer one focused PR per issue and require tests plus documentation for
  behavior changes.
- Never include secrets or sensitive dealership data in issues, fixtures, logs,
  screenshots, or examples.
- Verify the community profile after changing health files.
