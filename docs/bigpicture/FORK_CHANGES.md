# Upstream files touched by the Big Picture fork

Base: upstream `v4`. List every upstream file changed, why, and the commit. Fork-only paths (`src/bigpicture/`,
`src-tauri/src/bigpicture/`, `docs/bigpicture/`) aren't listed.

| File | Change | Reason | Step / commit |
|---|---|---|---|
| `apps/launcher/src-tauri/src/lib.rs` | `mod bigpicture;` and register `bigpicture::bp_read_sidecar`, `bp_write_sidecar` in `generate_handler!` | Tauri commands must be registered in the one builder. Big Picture's own code reads `Data` from the child module without changing it | S1 |
