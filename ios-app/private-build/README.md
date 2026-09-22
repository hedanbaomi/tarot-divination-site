# Private iOS build inputs and orchestration

This directory holds the open-source side of the private iOS build: the native
LXXXI provider, its authentication XCTest, and the build orchestration scripts.
It is compiled and exercised **only** inside the private build pipeline — none of
these files are referenced by `Quareia.xcodeproj`, so ordinary public builds
never compile them.

## Layout

- `provider/IntegratedLxxxiProvider.swift` — in-memory AES-GCM provider selected
  by `AppRoute` under the `PRIVATE_LXXXI_PROVIDER` compilation condition. It
  contains no key material; the generated `IntegratedVaultMaterial` enum is
  supplied per build.
- `tests/IntegratedLxxxiAuthenticationTests.swift` — XCTest that decrypts every
  real record, validates the decoded image, and rejects tampered inputs.
- `scripts/` — the private build harness:
  - `materialize.py` — combines `provider/` + `tests/` from this directory with
    the encrypted records (`--records-root`) from the private repository and the
    `LXXXI_MATERIAL_JSON` secret, emitting the ephemeral input tree and manifest.
  - `source_gate.py` — fail-closed boundary gate for the public and private
    tracked-source sets.
  - `build.py` — private-CI orchestrator wrapping `tools/run-private-integration.py`.
  - `test_*.py` — unit tests for the scripts.

## Boundary contract

The private repository keeps only what cannot be public: the 82 encrypted
`.qv` records, the GitHub Actions workflow entry point, and the
`LXXXI_MATERIAL_JSON` Actions secret. `source_gate.py` enforces that split —
`IntegratedVaultMaterial.swift`, `.qv` payloads, `PrivateInputs/` staging paths
and `.private/` metadata must never be tracked by either repository, and the two
overlay Swift sources may exist only under this directory.

The provider reads `PrivateAssets/lxxxi/*.qv` from the app bundle at runtime.
Those records are staged by the private pipeline; they are never committed here.
