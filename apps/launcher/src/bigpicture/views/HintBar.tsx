/**
 * The footer: Menu on the left, always; on the right what the buttons do now,
 * which is always the top handler's hints (spec §5.6).
 */
import { useSyncExternalStore, type PointerEvent } from "react";
import { useBp } from "../context";
import { Glyph } from "./Glyph";
import type { InputAction } from "../input/actions";

/** Pressing a hint with the mouse presses its button, held as long as the mouse is, so holds work too. */
function useHintPress() {
  const { router } = useBp();
  return (action: InputAction) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      router.dispatch({ action, phase: "press" });
    },
    onPointerUp: () => router.dispatch({ action, phase: "release" }),
    onPointerCancel: () => router.dispatch({ action, phase: "release" }),
  });
}

export function HintBar() {
  const { router } = useBp();
  const press = useHintPress();
  useSyncExternalStore(router.subscribe, router.snapshot);
  const hints = router.hints();
  return (
    <footer className="bp-hints">
      <span className="bp-hint bp-hint-menu" role="button" {...press("menu")}>
        <Glyph action="menu" />
        Menu
      </span>
      <span className="bp-hints-right">
        {hints.map((hint) => (
          <span key={hint.action} className="bp-hint" role="button" {...press(hint.action)}>
            <Glyph action={hint.action} />
            {hint.label}
            {hint.hold && <span className="bp-hold-note">hold</span>}
          </span>
        ))}
      </span>
    </footer>
  );
}
