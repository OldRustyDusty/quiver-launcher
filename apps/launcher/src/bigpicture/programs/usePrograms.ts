/**
 * At each Play: which program starts the game (programs.ts), asking the player
 * when it can't be told. And a game that closed with an error or crashed after
 * it started (src-tauri/src/bigpicture/session.rs) shows as the app's error, in
 * both modes, like a launch that failed.
 */
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { setLaunchPrograms, useLauncher } from "../../store";
import { bpNative } from "../bpNative";
import type { SidecarStore } from "../data/sidecar";
import { fileName, literal, programHints } from "./programs";

export type ProgramChoice = { title: string; choices: string[]; resolve: (choice: string | null) => void };

type Failure = { folder: string; message: string; early: boolean };

const flatpakMessage = (bundle: string) =>
  `What was downloaded is a Flatpak bundle, which Big Quiver can't start. Uninstall it and get it again: Big Quiver now picks the regular Linux download when there is one. Or install the bundle yourself: flatpak install --user "${bundle}"`;

export function usePrograms(sidecar: SidecarStore | null): ProgramChoice | null {
  const launcher = useLauncher();
  const latest = useRef(launcher);
  latest.current = launcher;
  const [choice, setChoice] = useState<ProgramChoice | null>(null);

  useEffect(() => {
    if (!sidecar) return;
    setLaunchPrograms(async (id, install) => {
      const { config, catalog, jobs, dismiss } = latest.current;
      // A new try: an error from the last one isn't news any more.
      if (jobs[id] && "error" in jobs[id]) dismiss(id);
      if (install.program || config.os === "windows") return install.executables;
      const entry = catalog[id];
      const hints = programHints(config.os, install.executables, entry?.launcher?.preferredExecutables, sidecar.app(id).program);
      const found = await bpNative.programs(install.folder, install.dir, hints).catch(() => null);
      if (!found) return install.executables;
      if (found.matched) return [literal(found.matched)];
      if (!found.choices.length && found.flatpak) {
        latest.current.fail(id, flatpakMessage(found.flatpak));
        return null;
      }
      // One program or none: upstream's own search finds it, or says there's none.
      if (found.choices.length < 2) return install.executables;
      const title = entry?.projectName || entry?.name || "this game";
      const picked = await new Promise<string | null>((resolve) => setChoice({ title, choices: found.choices, resolve }));
      setChoice(null);
      if (!picked) return null;
      sidecar.updateApp(id, { program: fileName(picked) });
      return [literal(fileName(picked))];
    });
    return () => setLaunchPrograms(null);
  }, [sidecar]);

  useEffect(() => {
    const stop = listen<Failure>("bp-game-failed", ({ payload }) => {
      const { installs, fail } = latest.current;
      const id = Object.keys(installs).find((key) => installs[key].folder === payload.folder);
      if (!id) return;
      let message = payload.message;
      // A picked program that won't start may be the wrong one: next time, the player picks again.
      if (payload.early && sidecar?.app(id).program) {
        sidecar.updateApp(id, { program: undefined });
        message += " Next time you press Play, Big Quiver asks which program to start.";
      }
      fail(id, message);
    });
    return () => void stop.then((s) => s());
  }, [sidecar]);

  return choice;
}
