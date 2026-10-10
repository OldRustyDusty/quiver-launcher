/**
 * A button's name in the style of whatever was pressed last: Xbox (also for
 * other pads), PlayStation, or the keyboard. Kenney's glyph art replaces the
 * lettering in S5.
 */
import { useSyncExternalStore, type CSSProperties } from "react";
import { useBp } from "../context";
import type { InputAction } from "../input/actions";

type Label = { text: string; face?: string };

const XBOX: Record<InputAction, Label> = {
  accept: { text: "A", face: "#5dc21e" },
  back: { text: "B", face: "#e53935" },
  secondary: { text: "X", face: "#1e88e5" },
  details: { text: "Y", face: "#f9b81c" },
  tabPrev: { text: "LB" },
  tabNext: { text: "RB" },
  pagePrev: { text: "LT" },
  pageNext: { text: "RT" },
  search: { text: "View" },
  menu: { text: "Menu" },
  up: { text: "↑" },
  down: { text: "↓" },
  left: { text: "←" },
  right: { text: "→" },
};

const PLAYSTATION: Record<InputAction, Label> = {
  ...XBOX,
  accept: { text: "✕", face: "#7aa6e8" },
  back: { text: "○", face: "#e8707e" },
  secondary: { text: "□", face: "#d98fd6" },
  details: { text: "△", face: "#4fc5a3" },
  tabPrev: { text: "L1" },
  tabNext: { text: "R1" },
  pagePrev: { text: "L2" },
  pageNext: { text: "R2" },
  search: { text: "Create" },
  menu: { text: "Options" },
};

const KEYBOARD: Record<InputAction, Label> = {
  ...XBOX,
  accept: { text: "Enter" },
  back: { text: "Esc" },
  secondary: { text: "X" },
  details: { text: "Y" },
  tabPrev: { text: "Q" },
  tabNext: { text: "E" },
  pagePrev: { text: "PgUp" },
  pageNext: { text: "PgDn" },
  search: { text: "/" },
  menu: { text: "F10" },
};

export function Glyph({ action }: { action: InputAction }) {
  const { family, router } = useBp();
  useSyncExternalStore(router.subscribe, router.snapshot);
  const hold = router.holding;
  const label = (family === "playstation" ? PLAYSTATION : family === "keyboard" ? KEYBOARD : XBOX)[action];
  const round = label.text.length === 1 && family !== "keyboard";
  const holding = hold?.action === action;
  return (
    <span
      className={`bp-glyph${round ? " round" : ""}${family === "keyboard" ? " key" : ""}${holding ? " holding" : ""}`}
      style={{ "--face": label.face, "--hold": holding ? `${hold.duration}ms` : undefined } as CSSProperties}
      aria-label={label.text}
    >
      {label.text}
    </span>
  );
}
