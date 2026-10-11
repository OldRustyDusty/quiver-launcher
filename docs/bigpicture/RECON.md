# Big Picture fork: recon (S0)

Fork: `OldRustyDusty/quiver-launcher-big-picture` (renamed from `quiver-launcher` on 2026-10-10), branch `bigpicture`, based on upstream `v4` @ `320013f` (2026-10-09).
Upstream: `tgeorgiadis/quiver-launcher` by Thomas Georgiadis, MIT.

## Why v4 and not `main`

`main` is Quiver Launcher 3.x (.NET 10, Avalonia 12.1.1). That's what the original spec assumed. `v4` is the
rewrite (Tauri 2 + React 19 + Rust), and its README says 3.x stays on `main`. A fork of 3.x couldn't keep merging upstream once v4 ships,
so on 2026-10-09 we chose to build on `v4`. The 3.x findings are kept in the appendix for reference.

## v4 layout

| Path | What |
|---|---|
| `apps/launcher/src` | React UI (~7.5k lines). State: `store.tsx` (React context `useLauncher()`). Rust bridge: `native.ts` |
| `apps/launcher/src-tauri/src` | Rust core: `lib.rs` (commands), `install.rs`, `gamepad.rs` (gilrs), `steam.rs`, `shortcut.rs` |
| `packages/api` | Typed catalog client (`Entry`, `Console`, `Release`, `Asset`…) |
| `packages/ui` | Catalog components shared with quiverlauncher.com |
| `e2e` | WebDriver journeys against the real app and a mock catalog |

## R1–R11 (v4)

| # | Question | Answer |
|---|---|---|
| R1 | UI framework | React 19 + Vite 7 + TypeScript 5.9 in WebView2 (Windows) or WebKitGTK (Linux). Tests: vitest. The XYFocus question doesn't apply |
| R2 | Android | Not in v4. Tauri has `mobile_entry_point`, but there's no Android project. There's no packaging constraint |
| R3 | State / MVVM | **React context store** (`store.tsx`: `useLauncher()`), plain `useState`, no state library. Big Picture uses it directly through an adapter |
| R4 | Gamepad backend | **gilrs 0.11.2** on its own thread (`gamepad.rs`). It emits a raw `pad` event `{key, down}` (`South`, `DPadUp`, `LeftStickLeft`…) and `pads` (names). On Windows it uses Windows.Gaming.Input `RawGameController` for every pad, with SDL_GameControllerDB mappings, so DualSense goes through the raw path. **It doesn't report controller type**, but gilrs exposes `vendor_id()`/`product_id()` |
| R5 | Where action logic lives | All in `store.tsx`: `get(entry, release?)` = add to library + download/install, `play(id)`, `remove(id)` (uninstalls **and** removes from library), `setUpdates`, `customize`. The asset picker is a store-level `choice` promise. That's clean: the bridge is a thin TS adapter |
| R6 | Per-app state/progress | `installs[id]` (version, `updates: auto\|pinned`, `skip`, `lastPlayed`, `unverified`…), `jobs[id]` = `Progress {phase, received, total}` or `{error}`, plus helpers `hasUpdate()` and `skipped()` |
| R7 | Process handle on launch | **No.** `launch` in `lib.rs` calls `.spawn()` and drops the `Child`. Session tracking needs a small upstream touch |
| R8 | Last-played | **Yes**: `installs[id].lastPlayed` (ms), set by `play()`. There's no play count, so the sidecar owns `playCount` only |
| R9 | App → console | **Direct from the catalog.** `Entry.consoles[]` (ids from `/facets`) and `Entry.basedOn.console`. A live sample of all 313 apps: 313/313 have `consoles`, 310 have `basedOn.console`, 17 are multi-console. Custom apps carry `GameArt` with consoles when matched to a game. Observed ids are in the table below |
| R10 | Data dir | Rust `Data` struct: `QUIVER_DATA`, else `portable.txt`→`./data`, else `app_data_dir()`. State files are `{library,installs,catalog,settings,collections}.json` (a whitelist in `state_file`). Writes are atomic (tmp + rename). The sidecar goes at `{Data}/bigpicture.json`, through fork-owned commands |
| R11 | Download concurrency | **Concurrent, no queue.** Each `get()` runs independently and `jobs[id]` blocks duplicates. But `choice` (the asset picker) is a single slot, so two concurrent installs that both need a pick would clash. Big Picture adds a **serial queue** in its adapter |

## Catalog sample (live API, 313 apps, 2026-10-09)

Art coverage: capsule (2:3) 310, hero 312, logo 309. Project types: port 309, tool 2, emulator 1, game 1.

| Console id | Apps | Console id | Apps | Console id | Apps |
|---|---|---|---|---|---|
| ps1 | 72 | gba | 16 | nds | 3 |
| n64 | 67 | mobile | 13 | arcade | 3 |
| pc | 43 | gcn | 12 | saturn | 3 |
| x360 | 40 | ps2 | 8 | og xbox | 2 |
| snes | 22 | wii | 7 | vb, ps4, switch | 2 each |
| gbc | 6 | gb, psp | 5 each | nes, gen | 4 each |
| 32x, dreamcast, gg, 3ds, wiiu | 1 each | | | | |

Facet order (`/facets`) is already manufacturer-then-era: Nintendo → PlayStation → Xbox → Sega → Other.
Ids differ from the spec's table: `gcn` (not `gc`), `gen` (not `genesis`), `og xbox` (with a space). Upstream has no NEC, SNK or Atari ids.

## Baseline (0.12), 2026-10-09

Toolchain: Node 22.23.2, pnpm 10.16.0, Rust 1.99.0, MSVC Build Tools 2022, WebView2 154.

| Check | Result |
|---|---|
| `pnpm typecheck` | ✅ api, ui, launcher |
| `pnpm test` | ✅ 77 tests (ui 30, launcher 47) |
| `cargo test` (src-tauri) | ✅ 8 tests |
| e2e | not run (needs `tauri-driver` + WebDriver) |

---

## Appendix: 3.x (`main`) findings, not used

.NET 10, Avalonia 12.1.1, hand-rolled INPC, SDL2 via `ppy.SDL2-CS` polled on a UI `DispatcherTimer`, ~5k lines of gamepad
navigation, `GameStatus` enum, `GameInfo.GameProcessStarted`, `LastPlayed.txt`, `CatalogEntryId` → catalog `consoles[]`,
data at `QuiverLauncherPaths.UserDataRoot`.
