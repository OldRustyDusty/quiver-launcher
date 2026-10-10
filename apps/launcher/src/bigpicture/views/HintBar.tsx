/**
 * The footer: Menu on the left, always; on the right what the buttons do now,
 * which is always the top handler's hints (spec §5.6).
 */
import { useSyncExternalStore } from "react";
import { useBp } from "../context";
import { Glyph } from "./Glyph";

export function HintBar() {
  const { router } = useBp();
  useSyncExternalStore(router.subscribe, router.snapshot);
  const hints = router.hints();
  return (
    <footer className="bp-hints">
      <span className="bp-hint bp-hint-menu">
        <Glyph action="menu" />
        Menu
      </span>
      <span className="bp-hints-right">
        {hints.map((hint) => (
          <span key={hint.action} className="bp-hint">
            <Glyph action={hint.action} />
            {hint.label}
            {hint.hold && <span className="bp-hold-note">hold</span>}
          </span>
        ))}
      </span>
    </footer>
  );
}
