/**
 * All and console tabs: a grid of 2:3 tiles (spec §8). Only the rows near the
 * screen are drawn, so a library of hundreds scrolls smoothly. Focus is the
 * view's own (not the browser's), and the focused tile is scrolled to stay a
 * row away from the edge.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useBp, useInputHandler } from "../context";
import type { BpApp } from "../bridge";
import type { InputAction } from "../input/actions";
import type { ButtonHint } from "../input/router";
import { GridNavigator, jumpLetter } from "../nav/grid";
import { GameTile } from "./GameTile";

export type Back = { label: string; go: () => void };

type Props = {
  tabId: string;
  apps: BpApp[];
  /** LT / RT jump between letters (All sorted by name) instead of paging. */
  letterJump: boolean;
  memory: Map<string, string>;
  onFocus: (app: BpApp | null) => void;
  onGlobal: (action: InputAction) => boolean;
  back?: Back;
  onDetails: (app: BpApp) => void;
  onDownloads: () => void;
};

/** Sizes at 720p, times the scale. */
export function gridMetrics(scale: number, width: number) {
  const tileW = 150 * scale;
  const tileH = 225 * scale;
  const gap = 22 * scale;
  const padX = 48 * scale;
  const padY = 22 * scale;
  const columns = Math.max(1, Math.floor((width - 2 * padX + gap) / (tileW + gap)));
  return { tileW, tileH, gap, padX, padY, columns, rowH: tileH + gap };
}

export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** What A does on a tile, and the hints that go with it (spec §5.2). */
export function tileHints(app: BpApp | undefined, back?: Back): ButtonHint[] {
  const hints: ButtonHint[] = [];
  switch (app?.state) {
    case "installed":
      hints.push({ action: "accept", label: "Play" });
      break;
    case "updateAvailable":
      hints.push({ action: "accept", label: "Play" }, { action: "secondary", label: "Update" });
      break;
    case "downloading":
    case "updating":
      hints.push({ action: "accept", label: "Downloads" });
      break;
    case "queued":
      hints.push({ action: "accept", label: "Downloads" }, { action: "secondary", label: "Cancel", hold: true });
      break;
    case "error":
      hints.push({ action: "accept", label: "Retry" });
      break;
    case "notInstalled":
      hints.push({ action: "accept", label: "Get" });
      break;
  }
  if (app) hints.push({ action: "details", label: "Details" });
  if (back) hints.push({ action: "back", label: back.label });
  return hints;
}

export const CANCEL_HOLD_MS = 1000;

export function GridTab({ tabId, apps, letterJump, memory, onFocus, onGlobal, back, onDetails, onDownloads }: Props) {
  const { bridge, scale, data } = useBp();
  const scroller = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(scroller);
  const m = gridMetrics(scale, width);

  // Focus follows the app, not the position: an install or a rename reorders the grid under it.
  const [focus, setFocus] = useState(() => {
    const id = memory.get(tabId);
    return { id, index: Math.max(0, apps.findIndex((a) => a.id === id)) };
  });
  const found = focus.id ? apps.findIndex((a) => a.id === focus.id) : -1;
  const index = found >= 0 ? found : Math.min(focus.index, Math.max(0, apps.length - 1));
  const app = apps[index];

  const focusAt = (i: number) => {
    const next = apps[i];
    if (!next) return;
    setFocus({ id: next.id, index: i });
    memory.set(tabId, next.id);
  };

  useEffect(() => onFocus(app ?? null), [app, onFocus]);

  // Keep the focused row a row away from the top and bottom where there's room for it.
  const [scrollTop, setScrollTop] = useState(0);
  const row = Math.floor(index / m.columns);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !height) return;
    const top = m.padY + row * m.rowH;
    const minTop = top + m.tileH + m.rowH - height; // a row below shows
    const maxTop = top - m.rowH; // a row above shows
    let target = el.scrollTop;
    if (minTop > maxTop) target = top - (height - m.tileH) / 2;
    else if (target > maxTop) target = maxTop;
    else if (target < minTop) target = minTop;
    target = Math.max(0, target);
    if (Math.abs(target - el.scrollTop) > 1) el.scrollTo({ top: target, behavior: data.settings.reduceMotion ? "auto" : "smooth" });
  }, [row, height, m.rowH, m.tileH, m.padY, data.settings.reduceMotion]);

  const rows = Math.ceil(apps.length / m.columns);
  const visibleRows = Math.max(1, Math.floor(height / m.rowH));
  const firstRow = Math.max(0, Math.floor(scrollTop / m.rowH) - 2);
  const lastRow = Math.min(rows - 1, Math.ceil((scrollTop + height) / m.rowH) + 2);

  useInputHandler({
    onAction(action) {
      if (onGlobal(action)) return;
      const nav = new GridNavigator().reset(apps.length, m.columns, index);
      switch (action) {
        case "up":
        case "down":
        case "left":
        case "right": {
          const moved = nav.move(action);
          if (moved.moved) focusAt(moved.index);
          return;
        }
        case "pagePrev":
        case "pageNext": {
          const direction = action === "pageNext" ? 1 : -1;
          focusAt(letterJump ? jumpLetter(apps.map((a) => a.title), index, direction) : nav.page(direction, visibleRows));
          return;
        }
        case "accept":
          if (!app) return;
          if (app.state === "installed" || app.state === "updateAvailable") void bridge.play(app.id);
          else if (app.state === "downloading" || app.state === "updating" || app.state === "queued") onDownloads();
          else if (app.state === "error") void (app.installedVersion ? bridge.update(app.id) : bridge.install(app.entry));
          else void bridge.install(app.entry);
          return;
        case "secondary":
          // A manual update ignores the update setting and a skipped version (spec §9).
          if (app?.state === "updateAvailable") void bridge.update(app.id);
          return;
        case "details":
          if (app) onDetails(app);
          return;
        case "back":
          back?.go();
          return;
      }
    },
    holdFor: (action) => (action === "secondary" && app?.state === "queued" ? CANCEL_HOLD_MS : undefined),
    onHold(action) {
      if (action === "secondary" && app?.state === "queued") bridge.cancelQueued(app.id);
    },
    hints: () => tileHints(app, back),
  });

  const tiles: ReactNode[] = [];
  for (let r = firstRow; r <= lastRow; r++) {
    for (let c = 0; c < m.columns; c++) {
      const i = r * m.columns + c;
      const a = apps[i];
      if (!a) break;
      tiles.push(
        <GameTile
          key={a.id}
          app={a}
          focused={i === index}
          x={m.padX + c * (m.tileW + m.gap)}
          y={m.padY + r * m.rowH}
          w={m.tileW}
          h={m.tileH}
        />,
      );
    }
  }

  return (
    <div className="bp-grid-scroll" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      {apps.length ? (
        <div className="bp-grid" style={{ height: m.padY * 2 + rows * m.rowH }}>
          {width > 0 && tiles}
        </div>
      ) : (
        <div className="bp-empty">
          <h2>No games here yet</h2>
          <p>Find something to play in Discover.</p>
        </div>
      )}
    </div>
  );
}
