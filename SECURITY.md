# Security Policy

## Supported Versions

This project is pre-1.0 and under active development. Only the latest
version on the `main` branch is supported with security fixes.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| older   | :x:                |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use GitHub's private reporting feature:
[Report a vulnerability](https://github.com/JanisKre/DealerShipRiskMappingApp/security/advisories/new)

If that isn't available, open a regular issue asking for a private contact
channel, without describing the vulnerability itself.

You can expect an initial response within a few days. This is a solo/small
open-source project maintained outside of working hours, so please be patient.

## Scope & Design Notes

Dealership Risk Mapping is a **local, single-user Electron desktop app** —
there is no multi-tenant backend, no hosted server, and no user accounts.
Relevant security properties already in place:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` in all
  renderer windows
- The renderer reaches Node **only** through channels explicitly exposed by
  the preload script (`window.api`)
- All IPC payloads are validated at the boundary with Zod
- LLM provider API keys are stored via Electron's `safeStorage` (OS-keychain
  encrypted) — never written to disk in plaintext, never exposed to the
  renderer
- ONNX model inference runs in a separate `utilityProcess`, isolated from the
  main IPC event loop

Reports about missing multi-user auth, rate limiting, or similar are out of
scope by design — this is not a hosted, multi-tenant service.
