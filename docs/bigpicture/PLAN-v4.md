# Big Picture on v4: how the spec translates

The original spec (`SPEC.md`) still governs **scope, hard rules, locked decisions, the button
map, screens and the test plan**. This file records only what changes because the base is v4
(Tauri/React/Rust) instead of 3.x (.NET/Avalonia). Each change cites the spec section it replaces.

## 1. Hard rules, restated for v4

1. All fork code lives in `apps/launcher/src/bigpicture/` (TS/React, tests alongside as `*.test.ts(x)`) and
   `apps/launcher/src-tauri/src/bigpicture/` (Rust). Upstream touches are logged in `FORK_CHANGES.md`.
2. Don't restructure upstream code. Big Picture calls the store (`useLauncher()`) through an adapter.
3. Upstream JSON files (`library`, `installs`, `settings`…) are never written by Big Picture except through the store's own
   functions. Fork state lives in `{Data}/bigpicture.json`.
4. Licenses, no embedded keys, keyboard parity, and stop-and-ask are unchanged.
5. "Desktop mode keeps working" means `pnpm typecheck`, `pnpm test` and `cargo test` stay green after every step.
6. The Android rule (§1.7) no longer applies: v4 has no Android head.

## 2. Architecture (replaces §3)

```
apps/launcher/src/bigpicture/
  BigPictureHost.tsx        # mounted beside <App/>; renders nothing, the toast, or the fullscreen shell
  bridge.ts                 # adapter over useLauncher(): BpApp view-model, serial install queue
  bpNative.ts               # invoke() wrappers for the fork's Rust commands
  input/  actions.ts  padMap.ts  keyboard.ts  repeat.ts  gate.ts  router.ts
  nav/    grid.ts  shelf.ts
  consoles/  consoles.ts (short names + ordering metadata keyed by catalog id)  resolve.ts  tabs.ts
  art/    art.ts  fallbackTile.tsx
  data/   sidecar.ts
  updates/ policy.ts
  session/ session.ts
  views/  Shell, TabStrip, Home, Grid, Discover, Downloads, Details, UpdatePrompt, Osk, Settings, HintBar, GameTile
  glyphs/ (Kenney SVGs)
apps/launcher/src-tauri/src/bigpicture/
  mod.rs        # commands: bp_read, bp_write (atomic sidecar), bp_args, bp_monitors, bp_focus
  session.rs    # child-process wait + install-dir polling (sysinfo), emits bp-game-started / bp-game-exited
  foreground.rs # Windows foreground restore (§11), Linux no-op
```

**One window, one store.** Big Picture is a fullscreen React layer in the same webview, so it shares the store instance by construction (spec §11).

## 3. Bridge (replaces §4)

`bridge.ts` exposes the same shape as `IQuiverBridge`, implemented over `useLauncher()`:

| Spec | v4 implementation |
|---|---|
| `AppKey` | `LibraryItem.id` / `Entry.id` (catalog id, `github:owner/repo`, or `local:…`) |
| `GetLibrary()` + state | `library` × `installs` × `jobs` × `catalog` → `BpApp { id, name, consoleId, state, installed, latest, progress, art }` |
| `BridgeAppState` | derived: `jobs[id]` progress → Downloading/Updating, `{error}` → Error, `hasUpdate()` → UpdateAvailable, `installs[id]` → Installed, else NotInstalled |
| `GetCatalogNotInLibrary` | `client.apps({ os, console, cursor })` pages, minus library ids |
| `AddToLibrary` + `Download` | `get(entry)`: it already does both |
| `Update` | `get(catalog[id])` (same path upstream uses) |
| `GetReleases` / `InstallVersion` | `client.releases(slug)` / `get(entry, release)` |
| `Launch` | `play(id)`. Exit tracking comes from the Rust session events (§6 below) |
| `Uninstall` | `remove(id)`, matching upstream (decided 2026-10-09): it uninstalls and removes from the library. Catalog apps reappear in Discover |
| `CheckUpdates` | Upstream refreshes the catalog itself. The bridge exposes `refresh()` if a hook exists, otherwise it's omitted |
| `AssetChoiceRequired` | Store's `choice` slot → controller picker. The remembered pick goes in the sidecar `assetPattern` |
| Concurrency (R11) | Bridge serializes installs (one at a time), so `choice` never clashes |

## 4. Input (replaces §5.1 and §5.3)

* **Superseded 2026-10-10: Big Picture reads controllers with SDL3 (`src-tauri/src/bigpicture/pads.rs`)** while it's open. gilrs's Windows backend stopped delivering input after the window lost focus, and didn't recover. Upstream's gilrs stays for desktop mode. The original note follows.
* ~~Keep upstream gilrs. Don't add SDL3.~~ gilrs already runs on its own thread and reaches DualSense through WGI `RawGameController` on Windows.
  The upstream touch is to add the pad's **vendor id** to the `pad` event, so Big Picture can pick glyphs
  (`0x054C` Sony → PlayStation, `0x045E` Microsoft → Xbox, else Generic).
* Pad key → action (gilrs names): `South`→Accept, `East`→Back, `West`→Secondary, `North`→Details,
  `LeftTrigger`→TabPrev, `RightTrigger`→TabNext (gilrs calls the bumpers LeftTrigger/RightTrigger), `LeftTrigger2`/`RightTrigger2`→PagePrev/Next,
  `Select`→Search, `Start`→Menu, D-pad and `LeftStick*`→directions. `Mode` (Guide/PS) is never mapped.
* **LT / RT (changed 2026-10-10 at the user's request; replaces spec §5.2's page and letter jumps):** they go straight
  between the library tab last shown (Home, All or a console), Discover and Downloads, round and round. RT goes forward, LT
  goes back. LB / RB still step through every tab. Page and letter jumps felt like skipping through games at random.
* **Grids wrap Left/Right in reading order (2026-10-10, at the user's request; spec §8.2 had edges at every row end)**,
  and go round: Right on the last tile goes to the first, and Left on the first goes to the last. Up and Down are unchanged,
  and shelves don't wrap.
* **LB / RB on Discover (2026-10-10, at the user's request):** from the games, the first press goes to the console chips,
  starting on the console shown. Moving across console chips applies each one at once. Pressed again there, LB / RB change tabs.
* **After Get (2026-10-10, at the user's request):** the setting `afterGet` is "stay" (default) or "library". With
  stay, the game stays in place in Discover with its progress, then greyed with ✓ Installed (A plays) until Discover is left.
  With library, Big Picture goes to the game's console tab with the game focused. Either way, the game joins the library at
  once, and library tabs show first downloads (`inLibraryView`).
* While Big Picture is active, upstream's spatial navigation is suspended (a small exported switch in `spatial.ts`, an upstream touch),
  and Big Picture owns keyboard and pad input. The keyboard map is as in §5.1.
* RepeatFilter, InputGate and InputRouter are pure TS with fake-clock vitest tests. The timings are as in §5.4.
* **Risk to verify at S5 on hardware:** DualSense over Bluetooth through WGI, and the Steam-open case. If gilrs fails
  there, the fallback is SDL3 through the Rust `sdl3` crate in place of gilrs (zlib/MIT). That's a bigger upstream touch, so we'd raise it first.

## 5. Consoles (replaces §7.1–7.2)

Resolution, first match wins:
1. Sidecar `consoleOverride`.
2. `projectType` ∈ {tool, emulator} → **Apps & Tools**. The catalog says these aren't games, even when they list consoles
   (mGBA lists gba/gbc/gb, Wheel Wizard lists wii). A literal reading of spec §7.2 would have put them in console tabs.
3. `entry.basedOn.console` (310/313 apps).
4. `entry.consoles[0]`. Custom/local apps get their matched game's consoles here, from upstream's `customEntry`/`localEntry`.
5. An app/tool tag → **Apps & Tools**.
6. Otherwise → **Other**.

Maker order follows spec §7.1 (Nintendo, Sega, Sony, Microsoft, then others), then release year. That's not the catalog's facet order (Nintendo, PlayStation, Xbox, Sega).

There's no tag-alias guessing for catalog apps, because the catalog is authoritative. `consoles.ts` holds only **short labels** and **release
years** keyed by the live ids (`gcn`, `gen`, `og xbox`…). Unknown future ids fall back to the catalog name, ordered by the facet order.
Tab ordering modes, hide-when-empty, and fall back to All are unchanged (§7.3).

## 6. Game sessions (replaces the R7 dependency in §11)

Upstream touch: `launch` passes the spawned `Child` to `bigpicture::session::track(app, id, child, install_dir)`.
That's about 3 lines, and the command signature seen by TS is unchanged. The Rust side waits for exit. If the process exits within 10 s, it polls (every 2 s, `sysinfo`)
for processes whose exe is under the install dir. Then it emits `bp-game-exited`, and Big Picture clears input and restores the foreground.

## 7. Artwork (replaces §10)

Chain, first hit wins:
1. Sidecar override.
2. Upstream `overrides.cover`.
3. `item.art` (custom apps).
4. Catalog `libraryArt` (capsule / hero / logo).
5. Fallback tile (icon on gradient + title).

**SteamGridDB is deferred past v1** (decided 2026-10-09). Catalog art covers 310/313 apps. When it's added later, it slots in
before the fallback, with the user key in the OS keychain through upstream `secret_get`/`secret_set`.

The webview handles decoding and HTTP caching. We use `loading="lazy"`/`decoding="async"` and **virtualized grids** to keep 200+ tiles smooth.
The disk cache and LRU sections are dropped (they were Avalonia-specific).

## 8. Updates (§9, interplay with upstream)

Upstream already has a per-app mode: `ask` (default) / `auto` (installs in the background) / `pinned`. Big Picture's global
`updateBehavior` applies at **Play** time only to apps in upstream `ask` mode. `pinned` apps never prompt, and `auto` apps are already
handled upstream. "Skip this version" is stored in the sidecar, as in the spec.

## 9. Upstream touches (expected)

| File | Change |
|---|---|
| `src-tauri/src/lib.rs` | `mod bigpicture;`, register the fork commands, hand `Child` to session tracking in `launch` |
| `src-tauri/src/gamepad.rs` | add `vendor` to the `pad` event payload |
| `src-tauri/Cargo.toml` | `sysinfo`, `windows-sys` (for foreground restore) |
| `src/spatial.ts` | export a suspend switch |
| `src/main.tsx` | mount `<BigPictureHost/>` |
| `src/App.tsx` | "Big Picture" button in the header, "Switch to desktop" from Big Picture |

## 10. Build order (replaces §13)

| Step | Deliverable |
|---|---|
| S0 | Recon, this plan, FORK_CHANGES, THIRD_PARTY ✅ |
| S1 | `bridge.ts` + sidecar (Rust `bp_read`/`bp_write` + TS store) + tests |
| S2 | Console resolve + tab builder + tests |
| S3 | Input: actions, keyboard, repeat, gate, router + tests |
| S4 | Host + shell + All grid (virtualized) + hint bar, keyboard only, `--bigpicture` flag |
| S5 | Pad mapping, vendor-id family, glyphs. **Hardware check: Xbox + DualSense, USB + BT, Steam closed/open** |
| S6 | Console tabs, Home shelves, per-tab focus memory |
| S7 | Update policy + prompt + X update + Update all |
| S8 | Discover (filter row, add+download) + Downloads tab + asset picker |
| S9 | Art: catalog chain + fallback tile (SteamGridDB deferred) |
| S10 | Session tracking + foreground restore + input gating |
| S11 | Details, settings overlay, OSK + search, Unassigned, controller toast |
| S12 | Polish: transitions, reduce motion, scale 720p–4K, empty/error states |

## 11. Details and settings (S11)

* Details buttons: Play (or Install / Get), Update, Change version (the catalog's releases), Console (picker; Automatic
  follows the catalog), Open folder, Uninstall (hold A, or the mouse, for 1.5 s; files go to the Recycle Bin as upstream's
  remove does).
* **Left out:** *Manage mods in desktop mode*, because v4 has no mods. *Change artwork* waits for SteamGridDB (deferred). The
  sidecar's art overrides already apply when set.
* Settings has every §6 setting except the SteamGridDB key (deferred), plus *After getting a game*, *Unassigned games*
  and *Switch to desktop mode*. Accounts and sign-in stay in desktop mode.
* Search: View / Create opens the on-screen keyboard. Library tabs filter as you type (Home and Downloads jump to All).
  Discover searches the catalog once typing pauses. B clears the search. A physical keyboard types into the on-screen one.
* Desktop mode shows a note when a controller is turned on (upstream's controller events). A or a click opens Big Picture.

