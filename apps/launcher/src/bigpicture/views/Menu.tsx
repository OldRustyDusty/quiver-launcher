/** The settings overlay (Menu / Options). For now only the way back to desktop mode; the settings come in S11. */
import { useState } from "react";
import { useBp, useInputHandler } from "../context";
import { LAYER } from "../input/router";
import type { UpdateBehavior } from "../data/sidecar";

const UPDATE_LABELS: Record<UpdateBehavior, string> = { ask: "Ask", off: "Don't update", auto: "Update first" };

export function Menu({ onClose }: { onClose: () => void }) {
  const { exit, sidecar, data } = useBp();
  const behavior = data.settings.updateBehavior;
  const items = [
    {
      // Ask → Off → Auto (the full settings screen comes in S11).
      label: `Updates when playing: ${UPDATE_LABELS[behavior]}`,
      run: () => sidecar.setSettings({ updateBehavior: behavior === "ask" ? "off" : behavior === "off" ? "auto" : "ask" }),
    },
    { label: "Switch to desktop mode", run: exit },
  ];
  const [index, setIndex] = useState(0);
  useInputHandler(
    {
      onAction(action) {
        if (action === "up") setIndex((i) => Math.max(0, i - 1));
        else if (action === "down") setIndex((i) => Math.min(items.length - 1, i + 1));
        else if (action === "accept") items[index].run();
        else if (action === "back" || action === "menu") onClose();
      },
      hints: () => [
        { action: "accept", label: "Select" },
        { action: "back", label: "Close" },
      ],
    },
    LAYER.overlay,
  );
  return (
    <section className="bp-overlay bp-menu" role="dialog" aria-label="Settings">
      <h2>Big Picture</h2>
      <ul>
        {items.map((item, i) => (
          <li key={item.label} className={i === index ? "focused" : ""} onMouseMove={() => setIndex(i)} onClick={item.run}>
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
