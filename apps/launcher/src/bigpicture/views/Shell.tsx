/**
 * Big Picture's frame (spec §8): the tab strip, the focused game's backdrop
 * and header, the tab's view, the hint bar, and overlays above them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useBp } from "../context";
import { isInstalled, type BpApp } from "../bridge";
import { resolveConsole } from "../consoles/resolve";
import { buildTabs, keepTab } from "../consoles/tabs";
import type { InputAction } from "../input/actions";
import type { AllSort } from "../data/sidecar";
import { TabStrip } from "./TabStrip";
import { GridTab } from "./GridTab";
import { HintBar } from "./HintBar";
import { Backdrop, GameHeader } from "./GameHeader";
import { Details } from "./Details";
import { Menu } from "./Menu";
import { Placeholder } from "./Placeholder";

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
  const [focused, setFocused] = useState<BpApp | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);

  const step = (by: 1 | -1) => {
    const i = tabs.findIndex((t) => t.id === tab.id);
    setSelectedId(tabs[Math.min(tabs.length - 1, Math.max(0, i + by))].id);
  };
  /** Actions every tab's view leaves to the frame. */
  const global = (action: InputAction) => {
    if (action === "tabPrev") step(-1);
    else if (action === "tabNext") step(1);
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
  const shown = grid ? focused : null;

  return (
    <>
      <Backdrop app={shown} />
      <TabStrip tabs={tabs} selected={tab.id} />
      <GameHeader app={shown} consoleName={shown ? consoles.get(consoleOf.get(shown.id) ?? "other").name : ""} />
      <main className="bp-content">
        {grid ? (
          <GridTab
            key={tab.id}
            tabId={tab.id}
            apps={apps}
            letterJump={tab.kind === "all" && settings.allSort === "name"}
            memory={memory.current}
            onFocus={setFocused}
            onGlobal={global}
            back={toFirst}
            onDetails={(app) => setOverlay({ kind: "details", id: app.id })}
            onDownloads={() => setSelectedId("downloads")}
          />
        ) : (
          <Placeholder key={tab.id} tab={tab} onGlobal={global} back={toFirst} />
        )}
      </main>
      <HintBar />
      {overlay?.kind === "details" && <Details id={overlay.id} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "menu" && <Menu onClose={() => setOverlay(null)} />}
    </>
  );
}
