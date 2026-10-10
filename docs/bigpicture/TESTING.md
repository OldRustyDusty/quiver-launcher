# Big Picture: running and testing

## Run

| What | How |
|---|---|
| Dev app (real data) | `pnpm dev` at the repo root. Controller icon in the top bar, or `--bigpicture`, or Settings → Start in Big Picture |
| Dev app on test data | `$env:QUIVER_DATA="<folder>"; pnpm dev` (a seeded library folder; see `src/bigpicture/dev/preview.ts` for the shape) |
| Import a Quiver 3 library from elsewhere | `$env:QUIVER_V3_DATA="E:\QuiverLauncher"` before the first start of v4 |
| Input overlay | `$env:QUIVER_BP_DEBUG="1"` shows controller events and whether they get through |
| DevTools probe | `$env:QUIVER_DEBUG_PORT="9222"` (debug builds) opens WebView2's remote debugging port |
| Browser preview, no Tauri | `pnpm --filter @quiver/launcher dev`, then open `http://localhost:1420/bigpicture-preview.html`. `?reset`, `?apps=250`, `?desktop`, `?debug`, `?failLaunch`, `?share` (a Quiver 3 library for "Use the same games folder as Quiver 3"; `?share=open` keeps Quiver 3 open for 10 s); `bpPad("South")` in the console presses a control |
| Release exe | `pnpm --filter @quiver/launcher tauri build --no-bundle` → `apps/launcher/src-tauri/target/release/quiver-launcher.exe` |
| Automated checks | `pnpm typecheck`, `pnpm test` (Big Picture tests are in `src/bigpicture/**/*.test.ts`), `cargo test --manifest-path apps/launcher/src-tauri/Cargo.toml` |

## Manual checklist (spec §14), status 2026-10-10

| Check | Status |
|---|---|
| Xbox pad (Elite 2) navigates, glyphs follow it | ✅ by the user, wireless |
| DualSense navigates, glyphs switch to PlayStation | ✅ by the user, wireless |
| Steam open (Steam Input for desktop) | ✅ by the user: Steam was running throughout |
| USB pads | Not yet tested (the user chose wireless) |
| Hot-plug in Big Picture; two pads at once | ✅ hot-plug (pad turned on after start); two pads ✅ by the user |
| Install a game for a new console: its tab appears; uninstall its last: tab goes, focus on All | ✅ in the preview (tab appears with the first download; All after uninstall) |
| Update prompt: each of the four choices; Auto; Off; failure path | ✅ Update & play, Skip, in the preview; Off/Auto by unit tests; failure dialog not yet seen on a real failed update |
| Discover → A → downloads → appears in its console tab → plays | ✅ by the user (real games) and in the preview |
| Holding A in a game does nothing in Quiver; after the game, Quiver is in front and A works within 1 s | Built (S10); needs a run with a real game |
| A launcher stub that exits at once and starts the real game is tracked until the game exits | Built and unit-tested (process-in-folder check); needs a real stub game |
| 200+ tiles: no hitching holding Right/Down | ✅ script work per step ~6 ms (worst 12 ms) over 250 tiles; frame timing at full size in the real app still to watch |
| Keyboard-only full pass | ✅ every screen in the preview by keyboard (and mouse) |
| Scale at 720p / 1080p / 4K | ✅ in the preview (scale 1 / 1.5 / 3, no overflow) |
| Use the same games folder as Quiver 3: prompt, preview, catch-up, then a new install, an uninstall | ✅ in the preview (Big Picture and desktop mode); Rust unit tests for moves, `apps.json` changes, backups, and a round trip on a copy of the user's real `apps.json`. Not yet run on real game files |
