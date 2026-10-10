/**
 * Mounted around upstream's <App/> (main.tsx). Desktop mode stays mounted
 * underneath, inert, so both share one store and switching back finds it as it
 * was (spec §11).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { native } from "../native";
import { useLauncher } from "../store";
import { suspendSpatialNavigation } from "../spatial";
import { bpNative, type PadPress } from "./bpNative";
import { SidecarStore } from "./data/sidecar";
import { bigPictureMode, closeBigPicture, openBigPicture } from "./mode";
import { BpContext, type Bp, type InputFamily } from "./context";
import { keyAction, padAction, type InputAction } from "./input/actions";
import { RepeatFilter } from "./input/repeat";
import { InputGate } from "./input/gate";
import { InputRouter } from "./input/router";
import { ConsoleCatalog } from "./consoles/consoles";
import { useBridge } from "./useBridge";
import { isInstalled, type BpState } from "./bridge";
import { withArtOverrides } from "./art/art";
import { Shell } from "./views/Shell";
import { usePlayFlow } from "./updates/PlayFlow";
import { AssetPicker } from "./updates/AssetPicker";
import { Notices } from "./views/Notices";
import { ControllerToast } from "./ControllerToast";
import "./bigpicture.css";

const io = { read: bpNative.readSidecar, write: bpNative.writeSidecar };

export function BigPictureHost({ children }: { children: ReactNode }) {
  const open = useSyncExternalStore(bigPictureMode.subscribe, bigPictureMode.isOpen);
  const [sidecar, setSidecar] = useState<SidecarStore | null>(null);
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const logError = (e: unknown) => void native.logError(`bigpicture.json: ${String(e)}`).catch(() => {});
    void SidecarStore.load(io, 500, logError).then(async (store) => {
      if (cancelled) return;
      setSidecar(store);
      const args = await bpNative.launchArgs().catch(() => ({ bigPicture: false, debug: false }));
      setDebug(args.debug);
      if (args.bigPicture || store.settings.startInBigPicture) openBigPicture();
    });
    return () => void (cancelled = true);
  }, []);

  return (
    <>
      <div className="bp-desktop" inert={open}>
        {children}
      </div>
      {open && sidecar && <BigPicture sidecar={sidecar} debug={debug} />}
      {!open && sidecar && <ControllerToast enabled={sidecar.settings.offerBigPictureOnControllerConnect} />}
    </>
  );
}

function useWindowHeight() {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return height;
}

function BigPicture({ sidecar, debug }: { sidecar: SidecarStore; debug: boolean }) {
  const launcher = useLauncher();
  const store = useBridge();
  const data = useSyncExternalStore(sidecar.subscribe, () => sidecar.snapshot);
  // The player's own pictures over the catalog's (spec §10); everything else reads the bridge as it is.
  const apps = useMemo(() => withArtOverrides(store.apps, data.apps), [store.apps, data.apps]);
  const bridge = useMemo(() => ({ ...store, apps }), [store, apps]);
  const [family, setFamily] = useState<InputFamily>("keyboard");
  /** QUIVER_BP_DEBUG=1: the last controller events, and whether input is getting through. */
  const [events, setEvents] = useState<string[]>([]);
  /** The cursor shows while the mouse moves, and hides again at the first key or button. */
  const [pointer, setPointer] = useState(false);
  /** A game Big Picture started is running (spec §11): input is closed and animations rest. */
  const [inGame, setInGame] = useState(false);
  const height = useWindowHeight();
  const scale = Math.max(0.6, (height / 720) * data.settings.uiScale);

  const router = useMemo(() => new InputRouter(), []);
  const gate = useMemo(() => new InputGate(new RepeatFilter((e) => router.dispatch(e))), [router]);
  const consoles = useMemo(() => new ConsoleCatalog(launcher.consoles), [launcher.consoles]);

  // When a download finishes, note when: Home's "Recently installed" (upstream doesn't keep it).
  const states = useRef(new Map<string, BpState>());
  useEffect(() => {
    for (const app of bridge.apps) {
      const before = states.current.get(app.id);
      if ((before === "downloading" || before === "updating") && isInstalled(app)) sidecar.updateApp(app.id, { installedAt: Date.now() });
      states.current.set(app.id, app.state);
    }
  }, [bridge.apps, sidecar]);

  // Big Picture reads controllers itself while it's open (SDL3, src-tauri/src/bigpicture/pads.rs):
  // upstream's reader loses them on Windows once the window has lost focus.
  const [pads, setPads] = useState<string[]>([]);
  useEffect(() => {
    const names = listen<string[]>("bp-pads", ({ payload }) => setPads(payload));
    void names.then(() => bpNative.padsStart()).catch((e) => native.logError(`bigpicture pads: ${String(e)}`).catch(() => {}));
    return () => {
      void names.then((stop) => stop());
      void bpNative.padsStop().catch(() => {});
    };
  }, []);

  // Fullscreen while showing; back to the player's own choice after.
  const desktopFullscreen = Boolean(launcher.settings.fullscreen);
  useEffect(() => {
    void native.setFullscreen(true).catch(() => {});
    return () => void native.setFullscreen(desktopFullscreen).catch(() => {});
  }, [desktopFullscreen]);

  // Controllers (Windows.Gaming.Input) and keys only reach the window in front: take it.
  useEffect(() => {
    void bpNative.focus().catch(() => {});
  }, []);

  // The chosen monitor (Settings → Screen), once fullscreen.
  const monitor = data.settings.monitor;
  useEffect(() => {
    if (monitor) void bpNative.useMonitor(monitor).catch(() => {});
  }, [monitor]);

  // Big Picture takes the keyboard and controllers from upstream's spatial navigation while it shows.
  useEffect(() => {
    suspendSpatialNavigation(true);
    // A key's action is fixed when it goes down: Shift let go before Tab mustn't turn its release into another action.
    const keysDown = new Map<string, InputAction>();
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      // The on-screen keyboard takes typing from a physical one too.
      const typing = router.top?.onText;
      if (typing && down && gate.isOpen && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const text = e.key === "Backspace" ? "\b" : e.key === "Enter" ? "\n" : e.key.length === 1 ? e.key : null;
        if (text !== null) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setFamily("keyboard");
          typing(text);
          return;
        }
      }
      const action = down ? keyAction(e) : keysDown.get(e.code);
      if (!action) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (down) {
        if (e.repeat) return;
        keysDown.set(e.code, action);
        setFamily("keyboard");
        setPointer(false);
      } else keysDown.delete(e.code);
      gate.input(`key:${e.code}`, action, down);
    };
    const keyDown = onKey(true);
    const keyUp = onKey(false);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);
    const onPointer = (e: MouseEvent) => (e.movementX || e.movementY) && setPointer(true);
    window.addEventListener("mousemove", onPointer);

    const pad = listen<PadPress>("bp-pad", ({ payload }) => {
      if (debug) {
        const time = new Date().toLocaleTimeString(undefined, { hour12: false });
        const line = `${time} pad ${payload.pad} ${payload.key} ${payload.down ? "down" : "up"} · ${payload.family} · ${gate.isOpen ? "open" : "dropped (window not in front)"}`;
        setEvents((e) => [line, ...e].slice(0, 8));
      }
      const action = padAction(payload.key);
      if (!action) return;
      if (payload.down && gate.isOpen) {
        setFamily(payload.family);
        setPointer(false);
      }
      gate.input(`pad${payload.pad}:${payload.key}`, action, payload.down);
    });

    // The native window's focus, not the page's: a webview not clicked yet can say it isn't focused while its window is in front.
    const win = getCurrentWindow();
    const setActive = (active: boolean) => {
      // Back in front during a game (alt-tab, or a launcher that never quits): the player is here, listen again.
      if (active && gate.gameInForeground) {
        gate.gameInForeground = false;
        setInGame(false);
      }
      gate.windowActive = active;
      if (debug) setEvents((e) => [`${new Date().toLocaleTimeString(undefined, { hour12: false })} window ${active ? "in front" : "behind"}`, ...e].slice(0, 8));
    };
    void win.isFocused().then(setActive, () => setActive(true));
    const focus = win.onFocusChanged(({ payload }) => setActive(payload));
    // Game sessions (src-tauri/src/bigpicture/session.rs): closed while one runs, and back in front when it ends.
    const started = listen("bp-game-started", () => {
      gate.gameInForeground = true;
      setInGame(true);
    });
    const exited = listen("bp-game-exited", () => {
      gate.gameInForeground = false;
      setInGame(false);
      void bpNative.focus().catch(() => {});
    });
    return () => {
      void started.then((stop) => stop());
      void exited.then((stop) => stop());
      suspendSpatialNavigation(false);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("mousemove", onPointer);
      void focus.then((stop) => stop(), () => {});
      void pad.then((stop) => stop());
    };
  }, [gate, router, debug]);

  /** Starts the game (no more questions) and counts the play. */
  const launch = (id: string) => {
    sidecar.updateApp(id, (s) => ({ ...s, playCount: (s.playCount ?? 0) + 1 }));
    void bridge.play(id);
  };
  const flow = usePlayFlow({ bridge, sidecar, data, launch });

  const value: Bp = {
    sidecar,
    data,
    router,
    family,
    bridge,
    consoles,
    scale,
    pads,
    pointer,
    tap: (action) => {
      router.dispatch({ action, phase: "press" });
      router.dispatch({ action, phase: "release" });
    },
    play: flow.play,
    exit: () => {
      void sidecar.flush();
      closeBigPicture();
    },
  };

  return (
    <BpContext.Provider value={value}>
      <div
        className={`bp-root${data.settings.reduceMotion ? " bp-reduce-motion" : ""}${pointer ? " bp-pointer" : ""}${inGame ? " bp-in-game" : ""}`}
        style={{ "--u": `${scale}px` } as CSSProperties}
        role="application"
        aria-label="Big Quiver Launcher, Big Picture"
      >
        <Shell />
        {flow.ui}
        <AssetPicker />
        <Notices />
        {debug && (
          <aside className="bp-debug">
            <strong>
              Input: {gate.isOpen ? "open" : "closed"} · glyphs {family} · pads {pads.length ? pads.join(", ") : "none"}
            </strong>
            {events.length ? events.map((e, i) => <span key={i}>{e}</span>) : <span>No controller events yet</span>}
          </aside>
        )}
      </div>
    </BpContext.Provider>
  );
}
