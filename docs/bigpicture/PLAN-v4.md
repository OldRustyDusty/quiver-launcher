# Big Picture on v4: how the spec translates

Big Quiver Launcher is a fork of [Quiver Launcher](https://github.com/tgeorgiadis/quiver-launcher) (MIT), created by [Dibo](https://github.com/SirDiabo) and maintained by [Thomas Georgiadis](https://github.com/tgeorgiadis), who wrote its Quiver 4 rewrite. Everything outside the Big Picture code is theirs and their contributors'.

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

As built (updated 2026-10-13; the S0 sketch had a few more files that ended up merged):

```
apps/launcher/src/bigpicture/
  BigPictureHost.tsx   # wraps <App/>; desktop mode stays mounted (inert) under the fullscreen shell; desktop dialogs
  BigPictureButton.tsx, ControllerToast.tsx, mode.ts, context.tsx
  bridge.ts, useBridge.ts  # adapter over useLauncher(): BpApp view-model, serial install queue
  bpNative.ts          # invoke() wrappers for the fork's Rust commands
  input/    actions.ts  repeat.ts  gate.ts  router.ts
  nav/      grid.ts  shelf.ts
  consoles/ consoles.ts (short names + years keyed by catalog id)  resolve.ts  tabs.ts
  art/      art.ts (override chain)  fitted.ts (oversized logos)  useIconColors.ts
  data/     sidecar.ts (bigpicture.json)
  updates/  policy.ts  PlayFlow.tsx (update prompt at Play)  AssetPicker.tsx
  share/    "Use the same games folder as Quiver 3" (§12): v3share.ts (plan)  useShare.ts  ShareDialog.tsx
  programs/ which program starts a game (§14): programs.ts  usePrograms.ts  ProgramPicker.tsx;
            ownPrograms.tsx ("Add programs on this computer", §12)
  views/    Shell, TabStrip, Home, GridTab, Discover, Downloads, Details, Osk, Settings, HintBar, GameTile, Notices…
  glyphs/   Kenney SVGs
  dev/      preview.ts (the browser preview, Tauri mocked)
apps/launcher/src-tauri/src/bigpicture/
  mod.rs       # sidecar read/write (atomic), launch args, monitors, focus
  pads.rs      # SDL3 controller reader (Big Picture only); Start + Select closes the game
  session.rs   # game sessions: wait, launcher-stub handover, game logs, failure notices, closing a game
  programs.rs  # a game's programs, for the program picker (§14)
  art.rs       # oversized art fitted once into art-cache/
  v3.rs, v3share.rs  # finding Quiver 3, and the shared games folder (§12)
  archives.rs  # archives without extensions, archives inside archives, .tar.xz
  hostenv.rs, proton.rs, pointer.rs  # Linux only (§13)
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
* ~~Risk to verify at S5 on hardware: DualSense over Bluetooth through WGI, and the Steam-open case.~~ Resolved by the SDL3
  reader above; the user confirmed Xbox Elite 2 and DualSense, wireless, with Steam open.
* **Search (2026-10-13):** View / Create. The hint bar shows Search beside Menu while a tab is in front (not in Details,
  Settings, dialogs or the on-screen keyboard), since nothing on screen said where search was.
* **Start + Select, held 1 s on one pad, closes the game** started from Big Picture and everything it started (2026-10-13,
  for games with no way to quit). pads.rs watches for it, because the page may be throttled behind the game. Linux asks
  politely, then forces after 3 s; Windows forces at once (no polite signal there; WM_CLOSE could be tried first). Setting
  *Close a game with Start + Select*, on by default. quiver.log records each hold and its outcome.
* **Mouse pointer with Select (Linux, 2026-10-13):** while a game runs, hold Select: the right stick moves a pointer, RT
  clicks, LT right-clicks, the left stick scrolls (a virtual mouse through /dev/uinput, `pointer.rs`). For launchers that only
  take the mouse, unusable in Steam's Game Mode before. Setting *Mouse pointer with Select*.

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

Upstream touch: `launch` passes the spawned `Child` to `bigpicture::session::track` (see FORK_CHANGES for the lines). The
command signature seen by TS is unchanged. The Rust side waits for exit. If the process exits within 10 s it was a launcher
stub, and the session polls (every 2 s, `sysinfo`) until nothing of the game's runs: a program inside the game's folder, or
(added 2026-10-13) one started since the game whose working folder is the game's. That second kind is how Bloodborne's
Windows port works: `launch_gui.bat` starts `python.exe` from elsewhere and exits. Then it emits `bp-game-exited`, and Big
Picture clears input and restores the foreground.

**Game logs and failures (2026-10-13).** Upstream discarded the game's output, so a game that failed did so silently. Now its
stdout and stderr go to `game-logs/<folder>.log` in the data folder, started afresh at each launch. A game that closes with an
error within 10 s with nothing of it left running, or crashes (a crash signal; Linux only), shows *Game didn't start* / *Game
crashed* with its last telling line and the log's path, in Big Picture and as the app's error on the desktop card.

**A game that needs its ROM (2026-10-13, the user's choice of option 1).** Most ports ask for the player's ROM themselves;
some only quit. GoldenEye 007's PC port says "no ROM found (tried ge007.ntsc-final.z64|baserom.u.z64 in data/ and exe dir)"
and exits with code 1, which read as a technical error. The catalog has no field for "needs your own game files", so the
game's output is read (`romneed.rs`): a line about a missing ROM gives the file name and folder it wants. Big Picture and
desktop mode then show *Game needs your own copy of the game*, with **Choose the file…** (the system file picker; Big Quiver
copies the player's file there under that name, then plays again), **Open folder**, **Read the instructions** (its README)
and **Close**. The desktop card keeps the plain message. A catalog field for this would be the better fix; until then, a
warning before the first Play (from the README) was offered and left for later.

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

## 9. Upstream touches

`FORK_CHANGES.md` is the record of every upstream file touched, why, and when. (The S0 guess that stood here is superseded:
`gamepad.rs` ended up untouched, and `windows-sys` wasn't needed.)

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
  follows the catalog), Change program (only once a program was picked, §14: the next Play asks again), Open folder,
  Uninstall (hold A, or the mouse, for 1.5 s; files go to the Recycle Bin as upstream's remove does).
* **Left out:** *Manage mods in desktop mode*, because v4 has no mods. *Change artwork* waits for SteamGridDB (deferred). The
  sidecar's art overrides already apply when set.
* Settings has every §6 setting except the SteamGridDB key (deferred), plus *After getting a game*, *Use the same games
  folder as Quiver 3* (§12), *Add programs on this computer* (§12), *Close a game with Start + Select*, *Mouse pointer with
  Select* (Linux), *Screen*, *Unassigned games* and *Switch to desktop mode*. Accounts and sign-in stay in desktop mode.
* Search: View / Create opens the on-screen keyboard. Library tabs filter as you type (Home and Downloads jump to All).
  Discover searches the catalog once typing pauses. B clears the search. A physical keyboard types into the on-screen one.
* Desktop mode shows a note when a controller is turned on (upstream's controller events). A or a click opens Big Picture.


## 12. One games folder, shared with Quiver 3.5 (planned and built 2026-10-10)

**Status: built, tested by the user on their real library, and released in alpha 2** (2026-10-10). The code is
`src/bigpicture/share/` (plan, controller, dialog) and `src-tauri/src/bigpicture/v3share.rs`. It was also checked in the browser
preview (`?share`) and by unit tests, including a round trip on a copy of the user's real `apps.json`. Where the build differs
from the plan below:

* **Custom apps only Quiver 3 has** come over as upstream's import brings them (`customEntry`, nothing downloaded). (First built
  without them; added the same day.)
* **Added 2026-10-10 (the user's scenarios A, B, C):**
  * **A.** A folder you fill made in Big Quiver goes into Quiver 3's games folder and is listed in Quiver 3 as a manual app.
    Earlier ones in Quiver 4's apps folder move there.
  * **B.** Quiver 3's manual apps come into Big Quiver as folders you fill, where they are.
  * **C.** At every start (not only when it's turned on), whatever Quiver 3 has that Big Quiver doesn't comes over, with a short
    note.
  * Quiver 4's *A program on this computer* is hidden in Add an app, for parity with Quiver 3, unless the setting *Add programs
    on this computer* is on (off by default; in desktop Settings and Big Picture Settings, added 2026-10-13 at the user's request).
    Turning it on warns first that these games only exist in Big Quiver Launcher. Programs added that way stay Big Quiver's
    only: Quiver 3 lists apps by folder, so a program loose in a shared folder would make Quiver 3's Delete take the whole folder.
* **Backups:** each write first saves `apps.json` into Quiver 3's own `Backups/apps` (SHA-256 names, as Quiver 3 names them).
  The first backup's path is kept in `bigpicture.json` (`v3Share.backup`).
* **Steam shortcuts** aren't detected. The result lists moved games and says to add them to Steam again. Desktop shortcuts with
  the game's name are made again.
* **A running game isn't moved** (its files are locked; the copy would leave two). It's moved on a later start.
* **Key order:** `apps.json` is re-serialized with keys sorted (serde_json without `preserve_order`). Quiver 3 reads fields by
  name, so the order doesn't matter to it.

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

**Opt-in.** Off by default, and never switched on without a yes. Users who never had 3.5 never see any of it. The setting,
the "don't ask again" flag and the backup's location are in `bigpicture.json`.

* **At import:** right after "Bring them over", in Big Picture and in desktop mode. Desktop mode's import banner is upstream's,
  so the fork shows the follow-up itself, like the controller note.
* **Once, for people who imported earlier:** on the first start with this feature, if 3.5 is found and they haven't opted in.
  It carries the preview counts and has a third button, *Don't ask again*. *Not now* asks again on the next start.
* **Any time:** in Big Picture Settings.

Wording (user's direction, 2026-10-10). Avoid "in step" and "sync". Name the app as **Big Quiver Launcher**, and the old one as
**Quiver 3**.

> **Use the same games folder as Quiver 3?**
> This is a new feature, and is **Recommended**. When enabled, Quiver 3 and Big Quiver Launcher will share the same game files and folders, so each game is installed once, and its updates and saves work in both.
> If this feature isn't enabled, note that Quiver 3 will not see game updates or newly installed games from Big Quiver Launcher, if launched separately on its own.
> (The user's wording, 2026-10-10: the prompt has to say why, and what happens without it.)
> Games you get in Big Quiver Launcher will install to `<3.5 games folder>` with your Quiver 3 games, and show up in Quiver 3 too.
> [Yes] [Not now] ([Don't ask again] on the one-time prompt)

The Settings row is **Use the same games folder as Quiver 3** (On / Off), with the detail *Recommended: Quiver 3 and Big Quiver
share the same game files and folders (`<folder>`)*. Turning it off asks first, with its own prompt.

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

**Turning it off.** Switching the setting off stops it, but doesn't undo anything; the opt-in backup restores `apps.json` exactly.

**Upstream touches (logged in FORK_CHANGES).** `store.tsx`, about 15 lines:
* `get()` installs new games into a given folder and records it as `dir` (`setNewInstallDir`).
* `adopt(id, install)` records a moved install, or a game found in Quiver 3.

Both go through upstream's own persistence, and the data formats stay unchanged. Writing 3.5's `apps.json` is fork code
(Rust, `src-tauri/src/bigpicture/v3share.rs`). It's a deliberate, approved exception: rule 3 covers Quiver 4's files, and 3.5's
are written only in its own format, under its own lock.

**Tests before touching real files.**
* Every catch-up case, on a copy of the user's `apps.json`.
* A move cut short at each step.
* 3.5 running (lock held).
* Two copies of one game.
* An `apps.json` round-trip that keeps unknown fields untouched.

## 13. Linux (Bazzite, 2026-10-13)

Tested on Bazzite (KDE, Wayland; Steam's Game Mode too) from an AppImage built on Ubuntu 22.04 (the hand-started workflow
`.github/workflows/bigpicture-linux.yml`). Released as alpha 3, a Linux-only pre-release. What changed for Linux:

* **Games get the system's environment**, not the AppImage's (`hostenv.rs`): they loaded its older libraries, and ROM pickers
  (zenity) crashed. Only inside an AppImage.
* **Windows-only games run through Proton** (`proton.rs`): Bazzite has no `wine` but ships `umu-run`, so Steam's newest
  Proton runs them, in a prefix per game (`proton-prefixes/` in the data folder). Only when `wine` is the program.
* **Downloads:** `.tar.xz` and `.elf` builds are taken; Flatpak bundles rank last (a bundle has no program to start); Linux
  programs get the executable permission back after unpacking from Windows-made zips.
* **On every OS:** `.rar` releases are offered (the installer always unpacked them, but none was ever picked), and
  extension-less download names with a version's dots are accepted, unpacked by their first bytes, with a lone archive inside
  unpacked too (Duke Nukem Zero Hour: Recompiled).
* **Oversized logos** (more pixels than a 4K screen) are shown from a 2048 px copy in `art-cache/`: LEGO Island's 18106×4509
  logo made Details lag on WebKitGTK.
* SDL3 is built without video on Linux; controllers come straight from udev.

Open on Linux: DualSense untested; games that ask for a ROM through the launcher mostly untested; a one-off freeze when WebKit's
network process died (likely the bundled libsoup 3.0); links still open with the AppImage's environment.

## 14. Which program starts a game (2026-10-13)

When the catalog names no program for this computer, upstream takes the first program in the folder (shallowest, then
alphabetical). That can be a tool beside the game. Big Picture (`programs/`, `programs.rs`) decides instead, in both modes, at
each Play and for desktop and Steam shortcuts:

1. The program the player picked before (`bigpicture.json`, `program`).
2. The catalog's names for this computer.
3. On Linux, the catalog's Windows names without `.exe` (Star Fox Enhanced: `starfox_pc`, not `starfox_asset_builder`).
4. Otherwise, when there's a real choice, the player picks once, and it's remembered:
   * Linux: more than one program in the folder.
   * Windows: several programs side by side at the shallowest level that has any, so upstream would be guessing. Crash
     handlers (Unity's, crashpad) don't count, and `.bat` / `.cmd` scripts are offered too. Bloodborne's Windows port has five
     programs in `out\` (the first, `bb-gpu-capabilities.exe`, is a GPU check) and starts from `launch_gui.bat`; Perfect Dark
     started its Japanese build. Unreal and Unity games, with one program on top, aren't asked.
5. Else upstream's own pick.

Details' *Change program* forgets the pick, so the next Play asks again.

## 15. Releases

| Release | Platform | Notes |
|---|---|---|
| v4.0.0-alpha.1-bigpicture.1 | Windows | Big Picture (S0–S12), Quiver 3 import |
| v4.0.0-alpha.1-bigpicture.2 | Windows (Latest) | Adds "Use the same games folder as Quiver 3" |
| v4.0.0-alpha.1-bigpicture.3 | Linux AppImage (pre-release) | §13, Start + Select, the Search hint, oversized logos, game logs and failure notices |

The installer's file name carries upstream's version (`4.0.0-alpha.1`); the release names carry the alpha number. The changes
since alpha 3 (built and tested on Windows on 2026-10-13: the Bazzite fixes, §14 on Windows, *Add programs on this computer*)
aren't released yet.
