/**
 * The top bar: Quiver's mark, the tabs (LB  Home  All  N64 … │ Discover
 * Downloads  RB) with an underline that slides to the selected one, and on the
 * right downloads, controllers and the time. The library's tabs use short
 * console names when the full ones don't fit, and scroll if even those don't.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Gamepad2 } from "lucide-react";
import { useBp } from "../context";
import type { Tab } from "../consoles/tabs";
import { Glyph } from "./Glyph";

function TabLabel({ tab, selected, compact }: { tab: Tab; selected: boolean; compact: boolean }) {
  return (
    <span role="tab" aria-selected={selected} data-tab={tab.id} className={`bp-tab${selected ? " selected" : ""}`}>
      {compact && tab.kind === "console" ? tab.short : tab.label}
      {tab.kind === "downloads" && tab.count ? <span className="bp-tab-count">{tab.count}</span> : null}
    </span>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A ring filling with the active download, and how many are going. */
function DownloadStatus() {
  const { bridge } = useBp();
  const busy = bridge.apps.filter((a) => a.state === "downloading" || a.state === "updating" || a.state === "queued");
  if (!busy.length) return null;
  const active = busy.find((a) => a.progress !== null);
  const p = active?.progress ?? 0;
  return (
    <span className="bp-status-downloads" title={`${busy.length} downloading`}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15" className="track" />
        <circle cx="18" cy="18" r="15" className="fill" style={{ strokeDashoffset: 94.25 * (1 - p) }} />
      </svg>
      <span>{busy.length}</span>
    </span>
  );
}

export function TabStrip({ tabs, selected }: { tabs: Tab[]; selected: string }) {
  const { pads } = useBp();
  const clock = useClock();
  const nav = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const library = tabs.filter((t) => t.kind !== "discover" && t.kind !== "downloads");
  const end = tabs.filter((t) => t.kind === "discover" || t.kind === "downloads");
  const key = library.map((t) => t.id).join(" ");

  // Full names first whenever the tabs change; short ones if they overflow.
  useLayoutEffect(() => setCompact(false), [key]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && !compact && el.scrollWidth > el.clientWidth) setCompact(true);
  });
  // The underline follows the selected tab.
  useLayoutEffect(() => {
    const tab = nav.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(selected)}"]`);
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const frame = nav.current?.getBoundingClientRect();
    const box = tab?.getBoundingClientRect();
    setBar(frame && box ? { left: box.left - frame.left, width: box.width } : null);
  }, [selected, compact, key, tabs.length]);

  return (
    <nav className="bp-topbar" aria-label="Library" ref={nav}>
      <img className="bp-mark" src="/quiver-icon-96.png" alt="Quiver" />
      <Glyph action="tabPrev" />
      <div className="bp-tabs" ref={scroller} role="tablist">
        {library.map((tab) => (
          <TabLabel key={tab.id} tab={tab} selected={tab.id === selected} compact={compact} />
        ))}
      </div>
      <div className="bp-tabs-end" role="tablist">
        {end.map((tab) => (
          <TabLabel key={tab.id} tab={tab} selected={tab.id === selected} compact={compact} />
        ))}
      </div>
      <Glyph action="tabNext" />
      {bar && <span className="bp-tab-bar" style={{ left: bar.left, width: bar.width }} />}
      <div className="bp-status">
        <DownloadStatus />
        <span className={`bp-status-pads${pads.length ? " on" : ""}`} title={pads.join(", ") || "No controller connected"}>
          <Gamepad2 aria-hidden="true" />
          {pads.length > 1 ? pads.length : null}
        </span>
        <span className="bp-clock">{clock}</span>
      </div>
    </nav>
  );
}
