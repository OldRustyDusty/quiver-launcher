/**
 * Big Picture's frame (spec §8): the tab strip, the focused game's backdrop
 * and header, the tab's view, the hint bar, and overlays above them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useBp } from "../context";
import { isInstalled, type BpApp } from "../bridge";
import { resolveConsole } from "../consoles/resolve";
import { buildTabs, cycleTab, keepTab } from "../consoles/tabs";
import type { InputAction } from "../input/actions";
import type { AllSort } from "../data/sidecar";
import { TabStrip } from "./TabStrip";
import { GridTab } from "./GridTab";
import { HintBar } from "./HintBar";
import { Backdrop, GameHeader } from "./GameHeader";
import { Details } from "./Details";
import { Menu } from "./Menu";
import { Placeholder } from "./Placeholder";
import { Home } from "./Home";
import { ShelfNavigator } from "../nav/shelf";

type Overlay = { kind: "details"; id: string } | { kind: "menu" } | null;

const byTitle = (a: BpApp, b: BpApp) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
export function sortApps(apps: BpApp[], sort: AllSort) {
  return [...apps].sort(sort === "recent" ? (a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || byTitle(a, b) : byTitle);
}

export function Shell() {
  const { bridge, data, consoles } = useBp();
  const { settings } = data;

  const consoleOf = useMemo(
    () => new Map(bridge.apps.map((app) => [app.id, resolveConsole(app, data.apps[app.id]?.consoleOverride)])),
    [bridge.apps, data.apps],
  );
  const installed = useMemo(() => bridge.apps.filter(isInstalled), [bridge.apps]);
  const busy = bridge.apps.filter((a) => a.state === "downloading" || a.state === "updating" || a.state === "queued").length;
  const tabs = useMemo(
    () => buildTabs(installed.map((a) => consoleOf.get(a.id)!), consoles, settings, busy),
    [installed, consoleOf, consoles, settings, busy],
  );

  const [selectedId, setSelectedId] = useState(() => tabs[0].id);
  const tab = keepTab(tabs, selectedId);
  // Its last game uninstalled: the console's tab is gone, so All is shown (and remembered).
  useEffect(() => {
    if (tab.id !== selectedId) setSelectedId(tab.id);
  }, [tab.id, selectedId]);

  /** Each tab's focused app, so coming back to a tab finds the same tile. */
  const memory = useRef(new Map<string, string>());
  const homeNav = useRef(new ShelfNavigator());
  const [focused, setFocused] = useState<BpApp | null>(null);
  /** Which way the last tab change went, for the page's slide. */
  const [direction, setDirection] = useState<1 | -1>(1);
  const [overlay, setOverlay] = useState<Overlay>(null);

  /** Shows a tab, sliding the page in from the side it's on. */
  const go = (id: string) => {
    if (id === tab.id) return;
    setDirection(tabs.findIndex((t) => t.id === id) < tabs.findIndex((t) => t.id === tab.id) ? -1 : 1);
    setSelectedId(id);
  };
  /** LB / RB: the next or previous tab. */
  const step = (by: 1 | -1) => {
    const i = tabs.findIndex((t) => t.id === tab.id);
    go(tabs[Math.min(tabs.length - 1, Math.max(0, i + by))].id);
  };
  /** The library tab (Home, All or a console) last shown, to come back to from Discover and Downloads. */
  const library = useRef(tabs[0].id);
  if (tab.kind !== "discover" && tab.kind !== "downloads") library.current = tab.id;
  const cycle = (by: 1 | -1) => go(cycleTab(tabs, tab.id, library.current, by));
  /** Actions every tab's view leaves to the frame. */
  const global = (action: InputAction) => {
    if (action === "tabPrev") step(-1);
    else if (action === "tabNext") step(1);
    else if (action === "pagePrev") cycle(-1);
    else if (action === "pageNext") cycle(1);
    else if (action === "menu") setOverlay({ kind: "menu" });
    else if (action === "search") return true; // Search comes with the on-screen keyboard (S11).
    else return false;
    return true;
  };
  const first = tabs[0];
  const toFirst = tab.id === first.id ? undefined : { label: first.label, go: () => setSelectedId(first.id) };

  const grid = tab.kind === "all" || tab.kind === "console";
  const apps = useMemo(() => {
    if (tab.kind === "all") return sortApps(installed, settings.allSort);
    if (tab.kind === "console") return sortApps(installed.filter((a) => consoleOf.get(a.id) === tab.console!.id), "name");
    return [];
  }, [tab, installed, consoleOf, settings.allSort]);
  const shown = grid || tab.kind === "home" ? focused : null;
  const consoleName = (app: BpApp) => consoles.get(consoleOf.get(app.id) ?? "other").name;

  return (
    <>
      <Backdrop app={shown} />
      <TabStrip
        tabs={tabs}
        selected={tab.id}
        onSelect={go}
      />
      <main className="bp-content">
        <div className={`bp-page${direction < 0 ? " from-left" : ""}`} key={tab.id}>
          {tab.kind === "home" ? (
            <Home
              nav={homeNav.current}
              onFocus={setFocused}
              onGlobal={global}
              onDetails={(app) => setOverlay({ kind: "details", id: app.id })}
              onDownloads={() => setSelectedId("downloads")}
              consoleName={consoleName}
            />
          ) : grid ? (
            <div className="bp-library">
              <GameHeader app={shown} consoleName={shown ? consoleName(shown) : ""} />
              <GridTab
                tabId={tab.id}
                apps={apps}
                memory={memory.current}
                onFocus={setFocused}
                onGlobal={global}
                back={toFirst}
                onDetails={(app) => setOverlay({ kind: "details", id: app.id })}
                onDownloads={() => setSelectedId("downloads")}
              />
            </div>
          ) : (
            <Placeholder tab={tab} onGlobal={global} back={toFirst} />
          )}
        </div>
      </main>
      <HintBar />
      {overlay?.kind === "details" && <Details id={overlay.id} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "menu" && <Menu onClose={() => setOverlay(null)} />}
    </>
  );
}
