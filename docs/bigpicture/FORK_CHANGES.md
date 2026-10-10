# Upstream files touched by the Big Picture fork

Base: upstream `v4`. List every upstream file changed, why, and the commit. Fork-only paths (`src/bigpicture/`,
`src-tauri/src/bigpicture/`, `docs/bigpicture/`) aren't listed.

| File | Change | Reason | Step / commit |
|---|---|---|---|
| `apps/launcher/src-tauri/src/lib.rs` | `mod bigpicture;` and register `bigpicture::bp_read_sidecar`, `bp_write_sidecar` in `generate_handler!` | Tauri commands must be registered in the one builder. Big Picture's own code reads `Data` from the child module without changing it | S1 |
| `apps/launcher/src-tauri/src/lib.rs` | register `bigpicture::bp_launch_args` | `--bigpicture` flag (spec §11) | S4 |
| `apps/launcher/src/spatial.ts` | `suspendSpatialNavigation(on)` plus an early return in its key and pad listeners | Big Picture owns keys and pads while open. Upstream's window-capture listener runs before any later one, so it has to step aside itself | S4 |
| `apps/launcher/src/main.tsx` | wrap `<App/>` in `<BigPictureHost>` (1 import, 2 lines) | One window and one store: Big Picture overlays desktop mode and makes it inert (spec §11) | S4 |
| `apps/launcher/src/App.tsx` | `<BigPictureButton />` in the top bar (1 import, 1 line) | "The desktop window gets a Big Picture button" (spec §11) | S4 |
| `apps/launcher/src-tauri/src/lib.rs` | register `bigpicture::bp_focus`, `bp_pads_start`, `bp_pads_stop` | Bring the window in front; Big Picture's own SDL3 controller reader | S5 |
| `apps/launcher/src-tauri/Cargo.toml` | `sdl3-sys` (built from source, static) for Windows and Linux | Big Picture reads controllers with SDL3: upstream's gilrs (Windows.Gaming.Input) stops delivering input after the window loses focus. Upstream's `gamepad.rs` is untouched (an earlier vendor-id change was reverted) | S5 |
| `apps/launcher/bigpicture-preview.html` (new) | Dev-only page that runs the launcher in a browser with Tauri mocked | Vite serves pages from the app root. The page's code is in `src/bigpicture/dev/`. It isn't part of the build | S4 |
