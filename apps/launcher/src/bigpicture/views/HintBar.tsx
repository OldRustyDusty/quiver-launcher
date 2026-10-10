/** What the buttons do right now: always the top handler's hints (spec §5.6). */
import { useSyncExternalStore } from "react";
import { useBp } from "../context";
import { Glyph } from "./Glyph";

export function HintBar() {
  const { router } = useBp();
  useSyncExternalStore(router.subscribe, router.snapshot);
  return (
    <footer className="bp-hints">
      {router.hints().map((hint) => (
        <span key={hint.action} className="bp-hint">
          <Glyph action={hint.action} />
          {hint.label}
          {hint.hold && <span className="bp-hold-note">(hold)</span>}
        </span>
      ))}
    </footer>
  );
}
