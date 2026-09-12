# Coding agent instructions

## Project scope

Dealership Risk Mapping is a local, single-user Electron application. The
renderer is untrusted web content, the preload is a narrow typed bridge, and
the main process owns filesystem, network, database, and native-module access.
Read the relevant skill in `.claude/skills/` before changing a governed area.

## Non-negotiable boundaries

- Keep `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- Every IPC channel needs a constant, a Zod request/response schema, a main
  handler, and a typed preload method. Validate the sender and payload in the
  main process; never use unchecked casts at the IPC boundary.
- Never commit API keys, customer/dealership data, ONNX model binaries, or
  generated build output.
- Keep external URLs and Electron navigation allowlisted and validate custom
  provider URLs before fetching.
- Preserve provenance, confidence, limitations, and fallback information in
  risk calculations.

## Development workflow

Run from `desktop-app/`:

```bash
npm ci
npm run rebuild
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
```

Native dependencies (`better-sqlite3`, `onnxruntime-node`, and `sharp`) must be
rebuilt after dependency or Electron changes. Update the lockfile together
with `package.json` and run `npm audit` for dependency changes.

## Pull requests and releases

- Keep changes focused and update tests and documentation together.
- Do not bypass the protected `main` branch or modify security controls to make
  a check pass.
- Use the PR template and explain user impact, risk, and verification.
- Releases are tag-driven. Generate checksums, the SBOM, and build provenance;
  code signing is optional until certificates are available.
- Dependabot automatic PRs are intentionally disabled. Do not add a
  Dependabot update configuration unless the maintainer explicitly requests it.

## Data and risk-model changes

Risk-model changes require a short methodology note, deterministic fixtures or
tests, and a clear statement of data sources and limitations. Do not present a
screening estimate as an engineering, legal, or insurance decision without
the appropriate qualification.
