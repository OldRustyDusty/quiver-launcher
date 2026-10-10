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

7. **Shared data with the official app (decided 2026-10-10).** Big Quiver Launcher keeps upstream's identifier
   (`com.quiverlauncher.app`), so it uses the same data folder as the official Quiver Launcher 4. People can switch between
   the two freely, for example going back to the official app when upstream releases before the fork catches up. This is why
   rule 3 matters: upstream's files are only ever written through upstream's own code, and all of the fork's own state is in
   `bigpicture.json`, which upstream ignores. Only the product name differs (installer, Start menu, title bar).

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


## 12. One games folder, shared with Quiver 3.5 (planned 2026-10-10, not built)

**Status: planned only.** The user approved the design, and asked for the plan before any build. It needs a separate go-ahead
to build. Until then nothing below exists.

**Why.** Official Quiver 4.0 isn't released (upstream's latest is 3.5.0), so Big Quiver users come straight from 3.5. Upstream's
import leaves imported games in 3.5's folder and puts new ones in `%APPDATA%\com.quiverlauncher.app\apps`. So games end up in
two folders, 3.5 never sees games got in Quiver 4, and 3.5 shows stale versions for games Quiver 4 updated. The user wants
**one known location per game, kept consistent in both apps**, with no orphaned or inconsistent files.

**The rule.** 3.5's games folder is home: `settings.json` `AppsPath`, or `<3.5 root>\Apps` when that's empty. Every game lives in
exactly one folder, recorded at that location by both apps. A game 3.5 already keeps in its own custom folder (`installPath`
outside the games folder, such as `Q:\N64 PC Ports\…`) **stays where it is**, because both apps already agree on it (user's choice).

**Facts this rests on** (checked against `E:\QuiverLauncher` and upstream `main`):
* 3.5's library is `apps.json`: `{ "apps": [ … ] }` with `name`, `folderName`, `installPath`, `repository`, `repositorySource`,
  `catalogEntryId`, `catalog`, `project`, `tags`, `appIconUrl`, `preferredVersion`, `skippedUpdateVersion`, and sometimes
  `filesToAdd`, `mods` and `releaseAssetFilter`. Every entry of the user's has an `installPath`.
* 3.5 reads a game's installed version from `version.txt` in the game's folder, not from `apps.json`.
* 3.5 writes `apps.json` under an exclusive `apps.json.lock` (`Services/LibraryFileStore.cs`), and keeps the library in memory
  while it runs.
* Quiver 4 marks its installs with `.quiver-version`. It updates and removes a folder only when that file, or (for adopted
  installs) `version.txt`, is there. An install with `dir` set lives there; otherwise it's `apps/<folder>`.

**Opt-in.** Offered at import ("Keep Quiver 3 in step, in one games folder"), and in Big Picture Settings for people who
imported earlier. Off by default. The setting and the backup's location are in `bigpicture.json`.

**Catch-up on opt-in.** Games are matched by provider and repository, as upstream's import does. First a dry-run preview of
counts and names. If 3.5 is running, the user is asked to close it. Then `apps.json` is backed up and the changes are applied:

| Case | Action |
|---|---|
| Imported, already in a 3.5 location | Nothing. If Quiver 4's version is newer, write it into `version.txt` |
| Installed by Quiver 4 into its own `apps` folder | **Move** it to 3.5's games folder, then record it in both apps |
| Only in 3.5 | Bring it into Quiver 4 through upstream's import, in place |
| The same game in both, two copies | Keep the newer version in 3.5's location. The other copy goes to the Recycle Bin, after the user confirms the list |
| Uninstalled in Quiver 4 before opt-in | Leave 3.5 alone (catch-up never removes from `apps.json`) |

**A move, per game.**
1. Skip it while it's running, downloading or updating, and retry next start.
2. Check free space.
3. Copy with progress, then check the copy (file count and sizes).
4. Write `.quiver-version` and `version.txt`.
5. Record the location: Quiver 4's install gets `dir`, and `apps.json` gets an entry with `installPath`.
6. **Only then** send the original to the Recycle Bin (user's choice).

On a same-volume move, do a rename instead of the copy. If the move is cut short, the original stays, and nothing points at a
partial copy.

**Ongoing, while on.**
* **New installs from Big Quiver** go into 3.5's games folder (with `dir` recorded) and are added to `apps.json`.
* **Updates** write `version.txt` too.
* **Uninstalls** remove the game's `apps.json` entry.
* **Games found in Quiver 4's own `apps` folder on start** are swept into 3.5's folder, the same way. Those are installs by the
  official Quiver 4 once it ships, which doesn't know this setting.
* **When 3.5 is running,** `apps.json` changes wait until it's closed (they're queued in `bigpicture.json`). Writes take
  `apps.json.lock`, and back up `apps.json` first.

**Side effects to show the user.**
* Desktop shortcuts to moved games break: recreate them with upstream's shortcut code.
* Steam shortcuts break too, and re-adding one changes its app id (Steam keys it on exe and name), losing that shortcut's
  playtime, art and controller layout. List the affected games.
* Saves inside a game's folder move with it.

**Turning it off.** "Stop keeping Quiver 3 in step" turns it off. It doesn't undo anything; the opt-in backup restores
`apps.json` exactly.

**Upstream touches (need logging in FORK_CHANGES).** `store.tsx`, about 15 lines:
* `get()` installs new games into a given folder and records it as `dir`.
* A `relocate(id, dir)` function records a moved install.

Both go through upstream's own persistence, and the data formats stay unchanged. Writing 3.5's `apps.json` is fork code
(Rust, `src-tauri/src/bigpicture/v3sync.rs`). It's a deliberate, approved exception: rule 3 covers Quiver 4's files, and 3.5's
are written only in its own format, under its own lock.

**Tests before touching real files.**
* Every catch-up case, on a copy of the user's `apps.json`.
* A move cut short at each step.
* 3.5 running (lock held).
* Two copies of one game.
* An `apps.json` round-trip that keeps unknown fields untouched.
