/**
 * Home (spec §8): the focused game large across the top, and shelves below:
 * recently played, updates (with Update all), recently installed. Each shelf
 * remembers its column; the whole thing remembers its place across tabs.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useBp, useInputHandler } from "../context";
import type { BpApp } from "../bridge";
import type { InputAction } from "../input/actions";
import { ShelfNavigator } from "../nav/shelf";
import { GameTile } from "./GameTile";
import { GameChips, GameLogo } from "./GameHeader";
import { Glyph } from "./Glyph";
import { appAt, homeShelves, rowLength } from "./homeShelves";
import { tileHints, useTileActions } from "./tileActions";

type Props = {
  nav: ShelfNavigator;
  onFocus: (app: BpApp | null) => void;
  onGlobal: (action: InputAction) => boolean;
  onDetails: (app: BpApp) => void;
  onDownloads: () => void;
  consoleName: (app: BpApp) => string;
};

/** Sizes at 720p, times the scale. */
const TILE_W = 124;
const TILE_H = 186;
const GAP = 18;

function UpdateAllCard({ count, focused }: { count: number; focused: boolean }) {
  return (
    <div className={`bp-tile bp-update-all${focused ? " focused" : ""}`} aria-label="Update all">
      <div className="bp-tile-inner">
        <RefreshCw aria-hidden="true" />
        <strong>Update all</strong>
        <span>
          {count} {count === 1 ? "game" : "games"}
        </span>
        <span className="bp-update-all-glyph">
          <Glyph action="secondary" />
        </span>
      </div>
    </div>
  );
}

export function Home({ nav, onFocus, onGlobal, onDetails, onDownloads, consoleName }: Props) {
  const { bridge, data, scale } = useBp();
  const actions = useTileActions(onDownloads);
  const shelves = useMemo(() => homeShelves(bridge.apps, data), [bridge.apps, data]);
  const lengths = shelves.map(rowLength);
  nav.reset(lengths);
  const [, setVersion] = useState(0);
  const shelf = shelves[nav.row];
  const app = shelf ? appAt(shelf, nav.col) : null;

  useEffect(() => onFocus(app), [app, onFocus]);

  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    list.current?.querySelector(`[data-row="${nav.row}"]`)?.scrollIntoView({ block: "nearest", behavior: data.settings.reduceMotion ? "auto" : "smooth" });
  }, [nav.row, data.settings.reduceMotion]);

  useInputHandler({
    onAction(action) {
      if (onGlobal(action)) return;
      if (action === "up" || action === "down" || action === "left" || action === "right") {
        if (nav.move(action).moved) setVersion((v) => v + 1);
      } else if (action === "accept") {
        if (shelf?.updateAll && !app) actions.updateAll(shelf.apps);
        else actions.primary(app);
      } else if (action === "secondary") {
        if (shelf?.updateAll && !app) actions.updateAll(shelf.apps);
        else actions.update(app);
      } else if (action === "details" && app) onDetails(app);
    },
    holdFor: (action) => (action === "secondary" ? actions.holdFor(app) : undefined),
    onHold: (action) => action === "secondary" && actions.cancel(app),
    hints: () => (shelf?.updateAll && !app ? [{ action: "secondary", label: "Update all" }] : tileHints(app)),
  });

  if (!shelves.length) {
    return (
      <div className="bp-empty">
        <h2>Your library is empty</h2>
        <p>Find something to play in Discover.</p>
      </div>
    );
  }

  const hero = app?.art.hero ?? app?.art.capsule;
  const step = (TILE_W + GAP) * scale;
  return (
    <div className="bp-home">
      <section className="bp-home-hero" aria-live="polite">
        {hero && <img key={hero} className="bp-home-hero-art" src={hero} alt="" decoding="async" />}
        <div className="bp-home-info" key={app?.id ?? "all"}>
          {app ? (
            <>
              <GameLogo app={app} className="large" />
              <GameChips app={app} consoleName={consoleName(app)} />
            </>
          ) : (
            <>
              <h1 className="bp-title large">Updates waiting</h1>
              <p className="bp-lead">Update every game with one press, then play the newest versions.</p>
            </>
          )}
        </div>
      </section>
      <div className="bp-shelves" ref={list}>
        {shelves.map((s, row) => {
          const length = rowLength(s);
          const col = row === nav.row ? nav.col : (nav.memory[row] ?? 0);
          // Keep the focused tile a tile away from the right edge while there's more to show.
          const visible = Math.max(1, Math.floor((window.innerWidth - 96 * scale) / step));
          const offset = Math.max(0, Math.min(col - visible + 2, length - visible)) * step;
          return (
            <section key={s.id} className={`bp-shelf${row === nav.row ? " active" : ""}`} data-row={row}>
              <h3>
                {s.title}
                <span className="bp-shelf-count">{s.apps.length}</span>
              </h3>
              <div className="bp-shelf-row" style={{ height: TILE_H * scale }}>
                <div className="bp-shelf-track" style={{ transform: `translateX(${-offset}px)` }}>
                  {Array.from({ length }, (_, c) => {
                    const a = appAt(s, c);
                    const focused = row === nav.row && c === nav.col;
                    const x = c * step;
                    return a ? (
                      <GameTile key={a.id} app={a} focused={focused} x={x} y={0} w={TILE_W * scale} h={TILE_H * scale} />
                    ) : (
                      <div key="all" className="bp-tile-slot" style={{ left: x, width: TILE_W * scale, height: TILE_H * scale }}>
                        <UpdateAllCard count={s.apps.length} focused={focused} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
