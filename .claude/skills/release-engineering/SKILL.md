---
name: release-engineering
description: Prepare trustworthy Electron releases and release metadata without assuming code-signing certificates.
---

# Release engineering

- Releases are produced from versioned tags and must run the full verification
  suite before packaging.
- Build platform artifacts with `electron-builder`, then generate SHA-256
  checksums and a CycloneDX SBOM.
- Generate GitHub build provenance attestations when the repository supports
  them. Never claim an artifact is signed when signing certificates are absent.
- Keep release filenames, README download links, version badges, changelog, and
  package metadata consistent.
- Document unsigned macOS/Windows behavior until notarization and signing are
  available.
