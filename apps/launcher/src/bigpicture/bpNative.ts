/** Big Picture's own Rust commands (src-tauri/src/bigpicture). Upstream's are in ../native.ts. */
import { invoke } from "@tauri-apps/api/core";

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
};

/** A press from Big Picture's controller reader, named as gilrs names controls. */
export type PadPress = { key: string; down: boolean; family: "xbox" | "playstation" | "generic"; pad: number };
