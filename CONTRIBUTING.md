# Contributing & Development

Quick guide for working on **Dealership Risk Mapping**. The app is a local,
single-user Electron app; there is no backend deployment.

By participating in this project, you agree to abide by the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Setup

Requires: **Node.js ≥ 22**.

```bash
cd desktop-app
npm install
npm run rebuild   # rebuild native modules against the Electron ABI
npm run dev
```

> After every `npm install` that touches `better-sqlite3`, `onnxruntime-node`,
> or `sharp`, run `npm run rebuild` — otherwise Electron won't load the
> native modules.

## Before every commit

```bash
npm run typecheck   # node + web
npm run lint        # 0 warnings allowed
npm run test        # Vitest
npm run test:coverage
npm run build
npm run smoke       # starts the built app briefly where a display is available
```

## Conventions

- **TypeScript strict** — no `any` shortcuts at the IPC boundary.
- **IPC is the boundary.** Every new channel needs:
  1. A channel name as a constant in `src/shared/ipc-channels.ts`
  2. A Zod schema for the payload in `src/shared/ipc-schema.ts`
  3. A handler in `src/main/ipc/`
  4. Exposure in the preload (`window.api`) — this is the only way the
     renderer reaches Node.
- **Shared types** live in `src/shared/` and are imported by both Main
  **and** Renderer — no duplicates.
- **Business logic** belongs in `src/main/services/`, not in handlers or
  React components.
- **Formatting:** Prettier (`npm run format`). No manual reformatting.

## Commit messages

Short, imperative, one topic per commit. Split up multiple changes.
Example: `Add pluvial flood peril to risk.service`.

## What doesn't belong in the repo

`node_modules/`, `out/`, `release/`, `dist/`, `*.log`, `.DS_Store`, local
data (`data/`), and the ONNX model (`resources/models/*.onnx`) are excluded
via `.gitignore`. **Never commit API keys or secrets** — the app manages
these at runtime via `safeStorage`.

## Releasing

Pushing a tag matching `v*.*.*` triggers
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which
runs typecheck/lint/test/coverage/build/smoke/audit, then builds and publishes
unsigned macOS (dmg, arm64 + x64) and Windows (nsis) installers. Each release
also includes SHA-256 checksums, a CycloneDX SBOM, and GitHub build provenance.

```bash
# bump "version" in desktop-app/package.json first, then:
git tag v0.2.0
git push origin v0.2.0
```

The release download buttons in the root [README](../README.md) link to
fixed filenames (`releases/latest/download/...`), so they always point to
whatever the most recent release published — no manual link updates needed.
