/**
 * "Add programs on this computer" (off by default): desktop mode's Add an app
 * offers "A program on this computer" (own.tsx), which starts a program (.exe)
 * where it is. Quiver 3 has no such thing and never lists them (share/v3share.ts
 * leaves programs out), so turning it on warns first. Turning it off only hides
 * the option: programs already added stay in the library.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { MonitorPlay } from "lucide-react";
import { useLauncher } from "../../store";
import { useInputHandler } from "../context";
import type { InputAction } from "../input/actions";
import { LAYER, type ButtonHint } from "../input/router";
import { Glyph } from "../views/Glyph";
import type { SidecarStore } from "../data/sidecar";

export type OwnPrograms = {
  on: boolean;
  /** The warning is showing. */
  asking: boolean;
  /** Turning on: shows the warning first. */
  ask(): void;
  confirm(): void;
  cancel(): void;
  turnOff(): void;
};

const OFF: OwnPrograms = { on: false, asking: false, ask() {}, confirm() {}, cancel() {}, turnOff() {} };
const nothing = () => () => {};

export const OwnProgramsContext = createContext<OwnPrograms>(OFF);
/** For desktop mode and Big Picture alike (BigPictureHost provides it). */
export const useOwnPrograms = () => useContext(OwnProgramsContext);

export function useOwnProgramsState(sidecar: SidecarStore | null): OwnPrograms {
  const on = useSyncExternalStore(sidecar?.subscribe ?? nothing, () => sidecar?.settings.allowPrograms ?? false);
  const [asking, setAsking] = useState(false);
  if (!sidecar) return OFF;
  return {
    on,
    asking,
    ask: () => setAsking(true),
    confirm: () => (sidecar.setSettings({ allowPrograms: true }), setAsking(false)),
    cancel: () => setAsking(false),
    turnOff: () => sidecar.setSettings({ allowPrograms: false }),
  };
}

const HINTS: ButtonHint[] = [
  { action: "accept", label: "Turn on" },
  { action: "back", label: "Cancel" },
];

function press(programs: OwnPrograms, action: InputAction) {
  if (action === "accept") programs.confirm();
  else if (action === "back") programs.cancel();
}

function Frame({ programs, glyphs }: { programs: OwnPrograms; glyphs: boolean }) {
  const { config } = useLauncher();
  const program = config.os === "windows" ? "a game's program (.exe)" : "a game's program";
  return (
    <div className="bp-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Add programs on this computer">
      <section className="bp-dialog bp-share">
        <div className="bp-dialog-body">
          <h2>
            <MonitorPlay aria-hidden="true" /> Add programs on this computer?
          </h2>
          <p className="bp-dialog-lead">
            Add an app, in desktop mode, will offer <b>A program on this computer</b>: choose {program} and Big Quiver Launcher starts it where it is. Nothing is
            downloaded, moved or deleted.
          </p>
          <p className="bp-dialog-lead">
            <b>Games added this way only exist in Big Quiver Launcher.</b> They won't show up in Quiver 3.5, even when it uses the same games folder.
          </p>
          <div className="bp-dialog-buttons">
            {HINTS.map((h) => (
              <button key={h.action} type="button" className={h.action === "accept" ? "primary" : ""} onClick={() => press(programs, h.action)}>
                {glyphs && <Glyph action={h.action} size={22} />}
                {h.label}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/** In Big Picture: on top, with the controller. */
export function OwnProgramsDialogBp({ programs }: { programs: OwnPrograms }) {
  useInputHandler({ onAction: (a) => press(programs, a), hints: () => HINTS }, LAYER.dialog, programs.asking);
  if (!programs.asking) return null;
  return <Frame programs={programs} glyphs />;
}

/** In desktop mode: an ordinary dialog, over upstream's Settings. */
export function OwnProgramsDialogDesktop({ programs }: { programs: OwnPrograms }) {
  const { asking, cancel } = programs;
  useEffect(() => {
    if (!asking) return;
    // Ahead of Settings' own Escape, which would close it too.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), cancel());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [asking, cancel]);
  if (!asking) return null;
  return (
    <div className="bp-share-desktop">
      <Frame programs={programs} glyphs={false} />
    </div>
  );
}

/** The checkbox in desktop mode's Settings (App.tsx). */
export function OwnProgramsSetting() {
  const programs = useOwnPrograms();
  const { config } = useLauncher();
  return (
    <label className="toggle">
      <input type="checkbox" checked={programs.on} onChange={(e) => (e.target.checked ? programs.ask() : programs.turnOff())} />
      Add programs on this computer{config.os === "windows" ? " (.exe)" : ""}: Big Quiver Launcher only, not Quiver 3.5
    </label>
  );
}
