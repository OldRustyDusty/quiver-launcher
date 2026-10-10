# Third-party components added by the Big Picture fork

Allowed licenses: MIT, BSD, Apache-2.0, zlib, CC0, OFL. Open each LICENSE before adding, then record it here.

| Component | Version | Use | License | Verified from |
|---|---|---|---|---|
| Kenney Input Prompts | 1.5A (2026-07-11) | Xbox, PlayStation and keyboard button glyphs: 42 SVGs in `apps/launcher/src/bigpicture/glyphs/`, renamed by action | CC0 1.0 | `License.txt` in `kenney_input-prompts_1.5.zip` from kenney.nl/assets/input-prompts, copied to `glyphs/LICENSE-kenney.txt` |
| SDL3 (via `sdl3-sys` 0.7.2, `sdl3-src` 3.4.18) | 3.4.18 | Controller input in Big Picture (`src-tauri/src/bigpicture/pads.rs`), built from source and linked statically | zlib (SDL), Zlib (bindings) | crates.io metadata for `sdl3-sys` and `sdl3-src`; SDL's LICENSE.txt (zlib) |
| sysinfo | 0.39 | Which processes run from a game's folder (`src-tauri/src/bigpicture/session.rs`), and free disk space before a game is moved (`v3share.rs`) | MIT | crates.io metadata for `sysinfo` 0.39 |

Reference only (no code copied): Playnite (JosefNemec/Playnite, MIT), for the fullscreen layout. In the end focus restore didn't need Playnite's approach: tao's `set_focus` already calls SetForegroundWindow and retries after a simulated Alt press, and `bp_focus` adds the spec's minimize-and-restore fallback.
