/** Big Picture's own Rust commands (src-tauri/src/bigpicture). Upstream's are in ../native.ts. */
import { invoke } from "@tauri-apps/api/core";

export const bpNative = {
  /** bigpicture.json from the data folder; null when there's none yet or it's unreadable. */
  readSidecar: () => invoke<unknown>("bp_read_sidecar"),
  /** Replaces bigpicture.json atomically. */
  writeSidecar: (value: unknown) => invoke<void>("bp_write_sidecar", { value }),
  /** Whether the launcher was started with --bigpicture, and QUIVER_BP_DEBUG (an input overlay for testing controllers). */
  launchArgs: () => invoke<{ bigPicture: boolean; debug: boolean }>("bp_launch_args"),
};
