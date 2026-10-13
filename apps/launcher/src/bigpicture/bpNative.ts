/** Big Picture's own Rust commands (src-tauri/src/bigpicture). Upstream's are in ../native.ts. */
import { invoke } from "@tauri-apps/api/core";
import type { V3Change, V3Library } from "./share/v3share";

export const bpNative = {
  /** bigpicture.json from the data folder; null when there's none yet or it's unreadable. */
  readSidecar: () => invoke<unknown>("bp_read_sidecar"),
  /** Replaces bigpicture.json atomically. */
  writeSidecar: (value: unknown) => invoke<void>("bp_write_sidecar", { value }),
  /** Whether the launcher was started with --bigpicture, and QUIVER_BP_DEBUG (an input overlay for testing controllers). */
  launchArgs: () => invoke<{ bigPicture: boolean; debug: boolean }>("bp_launch_args"),
  /** Brings the window in front with the keyboard; resolves to whether it's focused now. */
  focus: () => invoke<boolean>("bp_focus"),
  /** Starts Big Picture's own controller reader (SDL3): "bp-pad" presses and "bp-pads" names. Listen first. */
  padsStart: () => invoke<void>("bp_pads_start"),
  padsStop: () => invoke<void>("bp_pads_stop"),
  /** A smaller copy (PNG) of a web picture far bigger than it's shown (art/fitted.ts). */
  fitArt: (url: string) => invoke<ArrayBuffer>("bp_fit_art", { url }),
  /** Whether holding Start + Select closes the game being played. */
  closeCombo: (on: boolean) => invoke<void>("bp_close_combo", { on }),
  /** Linux: whether holding Select makes the right stick a mouse pointer while a game runs. */
  pointer: (on: boolean) => invoke<void>("bp_pointer", { on }),
  /** Fullscreen on this monitor (or stay where it is); resolves to the monitor used. */
  useMonitor: (name: string | null) => invoke<string | null>("bp_use_monitor", { name }),
  monitors: () => invoke<string[]>("bp_monitors"),
  /** The programs in a game's folder (relative paths), and the file name of the first one matching `hints` (programs/programs.ts). */
  programs: (folder: string, dir: string | undefined, hints: string[]) =>
    invoke<{ matched: string | null; choices: string[]; flatpak: string | null }>("bp_programs", { folder, dir, hints }),

  // "Use the same games folder as Quiver 3" (src-tauri/src/bigpicture/v3share.rs).
  /** Quiver 3's library, its games folder, and whether it's open; null without one. */
  v3Library: () => invoke<V3Library | null>("bp_v3_library"),
  /** Changes Quiver 3's apps.json (refused while it's open); resolves to the backup of how it was, or null when nothing changed. */
  v3Write: (changes: V3Change[]) => invoke<string | null>("bp_v3_write", { changes }),
  /** A game's folder in Quiver 3's games folder, and what's in it now. */
  gameDir: (gamesDir: string, folder: string) => invoke<[string, DirState]>("bp_game_dir", { gamesDir, folder }),
  /** The installed version, where both launchers read it (.quiver-version and version.txt). */
  writeVersions: (dir: string, version: string) => invoke<void>("bp_write_versions", { dir, version }),
  /** A game's folder to the Recycle Bin (only one a launcher installed). */
  trashGame: (dir: string) => invoke<void>("bp_trash_game", { dir }),
  /** Moves a game's folder; "bp-move-progress" events say how far. The original goes to the Recycle Bin. */
  moveGame: (id: string, from: string, to: string) => invoke<{ trashed: boolean }>("bp_move_game", { id, from, to }),
  hasDesktopShortcut: (name: string) => invoke<boolean>("bp_has_desktop_shortcut", { name }),
  /** A new folder for an app you fill yourself, in Quiver 3's games folder, opened for you; resolves to its path. */
  makeFolder: (gamesDir: string, name: string) => invoke<string>("bp_make_folder", { gamesDir, name }),
};

export type DirState = "free" | "ours" | "v3" | "other";

/** A press from Big Picture's controller reader, named as gilrs names controls. */
export type PadPress = { key: string; down: boolean; family: "xbox" | "playstation" | "generic"; pad: number };
