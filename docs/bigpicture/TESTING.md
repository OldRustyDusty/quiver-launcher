# Big Picture: running and testing

## Run

| What | How |
|---|---|
| Dev app (real data) | `pnpm dev` at the repo root. Controller icon in the top bar, or `--bigpicture`, or Settings → Start in Big Picture |
| Dev app on test data | `$env:QUIVER_DATA="<folder>"; pnpm dev` (a seeded library folder; see `src/bigpicture/dev/preview.ts` for the shape) |
| Import a Quiver 3 library from elsewhere | `$env:QUIVER_V3_DATA="E:\QuiverLauncher"` before the first start of v4 |
| Input overlay | `$env:QUIVER_BP_DEBUG="1"` shows controller events and whether they get through |
| DevTools probe | `$env:QUIVER_DEBUG_PORT="9222"` (debug builds) opens WebView2's remote debugging port |
| Browser preview, no Tauri | `pnpm --filter @quiver/launcher dev`, then open `http://localhost:1420/bigpicture-preview.html`. `?reset`, `?apps=250`, `?desktop`, `?debug`, `?failLaunch`, `?share` (a Quiver 3 library for "Use the same games folder as Quiver 3"; `?share=open` keeps Quiver 3 open for 10 s, `?share=later` adds two games "added in Quiver 3 since"; `?needRom` makes games quit for a missing ROM); `bpPad("South")` in the console presses a control |
| Linux AppImage | GitHub → Actions → **Linux AppImage** → Run workflow (or `gh workflow run "Linux AppImage" --ref bigpicture`); the AppImage is the run's artifact. Built on Ubuntu 22.04; SDL3 is built without video on Linux |
| Release exe and installer | `pnpm --filter @quiver/launcher tauri build --bundles nsis` → `apps/launcher/src-tauri/target/release/quiver-launcher.exe` and `bundle/nsis/Big Quiver Launcher_<version>_x64-setup.exe` (`--no-bundle` for the exe only). Build only when a test needs it |
| Game logs | `game-logs/<folder>.log` in the data folder: each game's output from its last start. `quiver.log` there records Start + Select holds and controllers connecting |
| Automated checks | `pnpm typecheck`, `pnpm test` (Big Picture tests are in `src/bigpicture/**/*.test.ts`), `cargo test --manifest-path apps/launcher/src-tauri/Cargo.toml` |

## Manual checklist (spec §14), status 2026-10-13

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
| Holding A in a game does nothing in Quiver; after the game, Quiver is in front and A works within 1 s | ✅ games start and come back (Bazzite, Desktop and Game Mode); a timed A check not done |
| A launcher stub that exits at once and starts the real game is tracked until the game exits | ✅ by the user on Windows: Bloodborne's `launch_gui.bat` (starts Python elsewhere, working in the game's folder); unit-tested for both kinds |
| 200+ tiles: no hitching holding Right/Down | ✅ script work per step ~6 ms (worst 12 ms) over 250 tiles; frame timing at full size in the real app still to watch |
| Keyboard-only full pass | ✅ every screen in the preview by keyboard (and mouse) |
| Scale at 720p / 1080p / 4K | ✅ in the preview (scale 1 / 1.5 / 3, no overflow) |
| Use the same games folder as Quiver 3: prompt, preview, catch-up, then a new install, an uninstall | ✅ by the user on their real library (released in alpha 2); also in the preview and by Rust unit tests |
| Start + Select closes a game started from Big Picture | ✅ Bazzite (Desktop and Game Mode); ✅ Windows (Daggerfall Unity, 2026-10-13, forced at once) |
| A game that fails shows *didn't start* with its last message and the log | ✅ Bazzite (Star Fox's cancelled ROM picker); Windows build has it, a failing game not yet tried |
| A game that quits for its missing ROM: plain dialog, Choose the file… copies it and plays | ✅ in the preview (`?needRom`, both modes); GoldenEye 007 on Windows to try |
| Which program starts a game: asked once when unsure, remembered, *Change program* asks again | ✅ Bazzite (Star Fox Enhanced); ✅ Windows by the user (Bloodborne) |
| Add programs on this computer: off by default, warning on turning on, then *A program on this computer* in Add an app | ✅ in the preview (desktop by mouse, Big Picture by controller); adding a real .exe not yet tried |
| `.rar` and extension-less downloads install (GoldenEye 007, Ace Combat, Duke Nukem Zero Hour) | ✅ Bazzite; Windows: Duke Nukem Zero Hour starts (game log, 2026-10-13), GoldenEye and Ace Combat not yet tried |
| Linux: Proton for Windows-only games, `.tar.xz` builds, Steam Game Mode | ✅ Bazzite (see PLAN-v4 §13); DualSense on Linux not yet tested |
