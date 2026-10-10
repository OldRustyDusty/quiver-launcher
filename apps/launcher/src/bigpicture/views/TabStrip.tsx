/**
 * LB  Home  All  N64  PS1 …  │ Discover  Downloads•2  RB
 * Discover and Downloads stay put at the end; the library's tabs use short
 * console names when the full ones don't fit, and scroll if even those don't.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { Tab } from "../consoles/tabs";
import { Glyph } from "./Glyph";

function TabLabel({ tab, selected, compact }: { tab: Tab; selected: boolean; compact: boolean }) {
  return (
    <span role="tab" aria-selected={selected} className={`bp-tab${selected ? " selected" : ""}`}>
      {compact && tab.kind === "console" ? tab.short : tab.label}
      {tab.kind === "downloads" && tab.count ? <span className="bp-tab-count">{tab.count}</span> : null}
    </span>
  );
}

export function TabStrip({ tabs, selected }: { tabs: Tab[]; selected: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const library = tabs.filter((t) => t.kind !== "discover" && t.kind !== "downloads");
  const end = tabs.filter((t) => t.kind === "discover" || t.kind === "downloads");
  const key = library.map((t) => t.id).join(" ");
  // Full names first whenever the tabs change; short ones if they overflow.
  useLayoutEffect(() => setCompact(false), [key]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !compact && el.scrollWidth > el.clientWidth) setCompact(true);
  });
  useLayoutEffect(() => {
    ref.current?.querySelector(".bp-tab.selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, compact]);

  return (
    <nav className="bp-tabstrip" aria-label="Library" role="tablist">
      <Glyph action="tabPrev" />
      <div className="bp-tabs" ref={ref}>
        {library.map((tab) => (
          <TabLabel key={tab.id} tab={tab} selected={tab.id === selected} compact={compact} />
        ))}
      </div>
      <div className="bp-tabs-end">
        {end.map((tab) => (
          <TabLabel key={tab.id} tab={tab} selected={tab.id === selected} compact={compact} />
        ))}
      </div>
      <Glyph action="tabNext" />
    </nav>
  );
}
