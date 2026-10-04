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
- IPC requests are accepted only from the app's trusted `BrowserWindow`
- Renderer navigation and external links are restricted to approved origins
- Session permission requests are denied by default
- A restrictive Content Security Policy blocks object embeds, framing, and
  non-self scripts
- LLM provider API keys are stored via Electron's `safeStorage` (OS-keychain
  encrypted) — never written to disk in plaintext, never exposed to the
  renderer
- The local model provider only accepts loopback URLs (`localhost`,
  `127.0.0.0/8`, `[::1]`) and never sends an API key, so a cloud token cannot
  reach whatever listens on a local port. Ollama pulls accept only
  `hf.co/<owner>/<repo>:<quant>` references, validated at the IPC boundary
- Natural hazard API connectors send only the location's coordinates, require
  HTTPS endpoints without embedded credentials, and keep one key per provider
  in the OS keychain
- Hugging Face model discovery sends only the search term to the public Hub
  API (`huggingface.co`); no token or portfolio data is transmitted
- ONNX model inference runs in a separate `utilityProcess`, isolated from the
  main IPC event loop
- The Overture Maps dealer directory is downloaded on explicit request only,
  in its own `utilityProcess`. URLs taken from the remote STAC catalog are
  accepted only over HTTPS from `stac.overturemaps.org` and the public
  Overture S3 bucket; no portfolio data is sent. Location search sends the
  typed text and the map centre to Photon (`photon.komoot.io`)

Reports about missing multi-user auth, rate limiting, or similar are out of
scope by design — this is not a hosted, multi-tenant service.
