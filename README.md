# Big Quiver Launcher

**Quiver Launcher with a Big Picture mode.** It turns [Quiver Launcher 4](https://github.com/tgeorgiadis/quiver-launcher)
into a fullscreen, controller-first launcher, like Steam's Big Picture or the Steam Deck. You can browse your library by
console, find new games, download them and play, all from the couch with an Xbox or PlayStation controller.

This is an unofficial fork. Everything Quiver Launcher 4 does still works in desktop mode: the catalog, the library, installs,
updates, playlists and accounts. Big Picture is an extra fullscreen mode on top. Both modes use the same library, and so does the
official Quiver Launcher 4 (see [Your library](#your-library)).

> **Alpha.** It's built on Quiver Launcher 4, which is itself still a work in progress. Tested on Windows 11 with Xbox and
> DualSense controllers.

## Features

- **Fullscreen, controller-first.** Big art tiles, smooth focus, and a hint bar at the bottom that shows the buttons for
  the controller in your hand (Xbox or PlayStation glyphs, switching on the fly).
- **A tab for each console.** Games are sorted into tabs (SNES, N64, GameCube, Genesis, PS1…) from the Quiver catalog, plus
  **Home** (recently played, updates available and recently installed), **All**, and **Apps & Tools** for emulators and utilities. Tabs come
  and go as you install and uninstall games.
- **Discover.** Browse the whole Quiver catalog by console, press A, and the game is added to your library and downloaded.
  You can stay and keep picking games while they download, or jump straight to the new game. Your choice, in Settings.
- **Downloads.** Watch progress and queue several games. Cancel a queued download by holding X for a second.
- **Updates your way.** When you press Play on a game with an update, Big Picture can ask (Update & play, Play this version,
  Skip this version), update first, or never update. You can also pick an older version from a game's details.
- **Game details.** Hero art, version, console and size. From here you can play, update, change version, move the game to
  another console tab, open its folder or uninstall it (hold to confirm).
- **Search with the controller.** An on-screen keyboard filters the library as you type and searches the catalog in Discover.
- **Gets out of the way while you play.** Quiver ignores the controller while a game is in front. When the game closes, Quiver
  comes back to the front, ready for input. This also works for games that start through a small launcher first.
- **Mouse, keyboard and controller all at once.** Use whichever is in your hand; every screen works with each of them.
- **Fits any screen.** Scales from 720p to 4K, with a size setting on top, and can open on the monitor of your choice
  (for example the TV).

## Install

### Download (Windows)

1. Download `Big Quiver Launcher_<version>_x64-setup.exe` from the [Releases](../../releases) page.
2. Run it. It installs for your Windows user only, with no admin rights needed, and adds **Big Quiver Launcher** to the Start menu.
3. Open it, then press the controller icon in the top bar to enter Big Picture.

Windows may warn you that the installer isn't from a known publisher. The builds aren't code-signed, so click **More info → Run anyway**.

Big Quiver Launcher installs beside the official Quiver Launcher 4 under its own name, and you can keep both.

### Build from source

You need Windows 10 or 11 (x64), [Node 22](https://nodejs.org), [pnpm](https://pnpm.io), [Rust](https://rustup.rs),
[CMake](https://cmake.org) (to build SDL3) and the Visual Studio C++ build tools.

```sh
git clone -b bigpicture https://github.com/OldRustyDusty/quiver-launcher-big-picture.git
cd quiver-launcher-big-picture
pnpm install
pnpm --filter @quiver/launcher tauri build --bundles nsis
```

The installer is written to `apps/launcher/src-tauri/target/release/bundle/nsis/`.

Linux builds should work, because the SDL3 reader builds there too, but they haven't been tested yet.

## Opening Big Picture

There are four ways in:

- The **controller icon** in the top bar of desktop mode.
- **Turning on a controller** while Quiver is open: a note offers Big Picture, and A opens it.
- **Settings → Start in Big Picture**, so Quiver always opens straight into it.
- The **`--bigpicture`** command-line flag. For example, a desktop or Steam shortcut to
  `"Big Quiver Launcher.exe" --bigpicture`.

To go back, open Settings (Menu / Options) and choose **Switch to desktop mode**. Signing in and account settings are there.

## Controls

| Controller | Keyboard | What it does |
|---|---|---|
| D-pad / left stick | Arrow keys | Move. Left and Right run through a grid in reading order, and wrap round at the ends |
| A / ✕ | Enter | Play, Get, or confirm |
| B / ○ | Esc / Backspace | Back, cancel, or clear a search |
| X / □ | X | Update the game; on a queued download, hold to cancel |
| Y / △ | Y | Game details |
| LB / RB (L1 / R1) | Q / E, or Shift+Tab / Tab | Previous / next tab. In Discover, the first press jumps to the console row |
| LT / RT (L2 / R2) | Page Up / Page Down | Jump between your library, Discover and Downloads |
| View / Create | / | Search |
| Menu / Options | F10 | Settings |

The mouse works everywhere too: pointing at a tile focuses it, a click does what A does, and a right click opens its
details. Destructive actions need a hold (Uninstall 1.5 s, Cancel 1 s), with a button or the mouse, and show a fill while you hold.

The Xbox / PS button is never used, so Steam and Windows keep it.

## Settings

Open Settings with Menu / Options, or F10.

| Setting | Choices |
|---|---|
| Updates when playing | Ask · Don't update · Update first |
| After getting a game | Stay in Discover (the game shows ✓ Installed there) · Go to it |
| Start in Big Picture | On · Off |
| Offer Big Picture when a controller connects | On · Off |
| Home tab | On · Off |
| Console tab order | Maker, then year · Most games first · A–Z |
| All tab order | A–Z · Recently played |
| Size | 75 % to 150 % |
| Reduce motion | On · Off |
| Screen | Which monitor Big Picture uses |
| Unassigned games | Give games under *Other* their console |
| Switch to desktop mode | |

## Your library

**Big Quiver Launcher uses the same data folder as the official Quiver Launcher 4**
(`%APPDATA%\com.quiverlauncher.app` on Windows). That's deliberate:

- Your library, installed games and settings appear in both apps.
- You can go back to the official app at any time, for example when it updates before this fork does, and your games are all
  still there.
- Big Picture's own settings (console overrides, skipped versions, play counts) live in a separate file,
  `bigpicture.json`, which the official app ignores. Big Quiver never changes the format of the official app's files.

**Run one at a time.** If both apps are open together, each saves its own copy of the library over the other's.

**Coming from Quiver Launcher 3?** On first start, the app offers to bring over your Quiver 3 library and installed games, as
the official app does. It also finds Quiver 3 when you installed it somewhere other than the default folder. If the library
is empty, Home shows the offer; press A to import.

## How it works

Big Picture is a fullscreen React layer inside the same Tauri window as desktop mode. Because both modes share one app state,
an install started in one shows up in the other at once.

- **Controllers** are read by [SDL3](https://libsdl.org), built from source into the app and running on its own thread. It reads
  them even while the window isn't focused, and Big Picture decides whether to use each press: it only does when Quiver is in front
  and no game is. SDL3 also says which kind of controller it is, so the button glyphs match. Desktop mode keeps upstream's own
  controller support.
- **Consoles** come from the Quiver catalog (`basedOn.console`, then `consoles`). Emulators and tools go to Apps & Tools, and
  you can move any game yourself.
- **Game sessions:** when you press Play, the Rust core keeps an eye on the game's process. If the process exits within 10
  seconds, it was probably a launcher, so the core watches for any process running from the game's folder instead. When the game
  ends, Quiver brings itself back to the front.
- **Art** comes from the catalog's library art (capsule, header, hero and logo). Games without art get a generated tile.
- Installs, updates and uninstalls all go through upstream Quiver's own code. Big Picture only decides when to call it.

Fork code lives in `apps/launcher/src/bigpicture/` (TypeScript) and `apps/launcher/src-tauri/src/bigpicture/` (Rust).
Each change to an upstream file is small and listed in [`docs/bigpicture/FORK_CHANGES.md`](docs/bigpicture/FORK_CHANGES.md),
which keeps merging upstream updates easy. The design and its decisions are in [`docs/bigpicture/`](docs/bigpicture).

## Develop

```sh
pnpm install
pnpm dev          # run the app; the controller icon in the top bar opens Big Picture
pnpm typecheck && pnpm test
cargo test --manifest-path apps/launcher/src-tauri/Cargo.toml
```

[`docs/bigpicture/TESTING.md`](docs/bigpicture/TESTING.md) covers running on test data, a controller-input overlay
(`QUIVER_BP_DEBUG=1`), a browser preview with no Tauri, and the manual test checklist.

| Path            | What it is                                                                 |
| --------------- | -------------------------------------------------------------------------- |
| `apps/launcher` | The Tauri app: React UI in `src`, Rust core in `src-tauri`                  |
| `packages/api`  | Typed client for the catalog API (`https://api.quiverlauncher.com/api/v1`) |
| `packages/ui`   | Catalog components and styles shared with quiverlauncher.com               |
| `e2e`           | User journeys run against the real app with WebDriver and a mock catalog   |

`QUIVER_API` points the app at another catalog and `QUIVER_DATA` at another data folder. A `portable.txt` beside the
executable keeps everything in a `data` folder next to it.

## Usage data

Upstream Quiver Launcher can send anonymous usage data to PostHog, but only when it's built with Quiver's project token.
This fork's builds don't include that token, so **they send no usage data**.

## Credits

- [Quiver Launcher](https://github.com/tgeorgiadis/quiver-launcher) by tgeorgiadis: everything that isn't Big Picture, and
  the [quiverlauncher.com](https://quiverlauncher.com) catalog. This fork isn't affiliated with or endorsed by Quiver.
- Button glyphs: [Kenney Input Prompts](https://kenney.nl/assets/input-prompts) (CC0).
- Controller input: [SDL3](https://libsdl.org) (zlib). Game-process tracking: [sysinfo](https://crates.io/crates/sysinfo) (MIT).

See [`docs/bigpicture/THIRD_PARTY.md`](docs/bigpicture/THIRD_PARTY.md).

## License

MIT, like upstream.
