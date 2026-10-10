/** What every Big Picture view shares while it's open. */
import { createContext, useContext, useEffect, useRef } from "react";
import type { Bridge } from "./useBridge";
import type { BpSidecar, SidecarStore } from "./data/sidecar";
import type { ConsoleCatalog } from "./consoles/consoles";
import type { ControllerFamily } from "./input/actions";
import { LAYER, type InputHandler, type InputRouter, type Layer } from "./input/router";

/** Whose button names the hints show: the last thing pressed. */
export type InputFamily = ControllerFamily | "keyboard";

export type Bp = {
  sidecar: SidecarStore;
  /** The sidecar now; a new object after every change. */
  data: BpSidecar;
  router: InputRouter;
  family: InputFamily;
  bridge: Bridge;
  consoles: ConsoleCatalog;
  /** 1 at 720p, times the player's UI scale. */
  scale: number;
  /** Back to desktop mode. */
  exit(): void;
};

export const BpContext = createContext<Bp | null>(null);
export const useBp = () => useContext(BpContext)!;

/**
 * Puts a handler on the input stack while the component is mounted (and
 * `active`). The handler can change every render; the router always calls the
 * latest one, and the hint bar follows its hints.
 */
export function useInputHandler(handler: InputHandler, layer: Layer = LAYER.view, active = true) {
  const { router } = useBp();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!active) return;
    return router.push(
      {
        onAction: (a, repeat) => latest.current.onAction(a, repeat),
        onHold: (a) => latest.current.onHold?.(a),
        holdFor: (a) => latest.current.holdFor?.(a),
        hints: () => latest.current.hints(),
      },
      layer,
    );
  }, [router, layer, active]);
  // Hints often depend on what's focused: let the hint bar look again after every render.
  useEffect(() => {
    if (active) router.refresh();
  });
}
