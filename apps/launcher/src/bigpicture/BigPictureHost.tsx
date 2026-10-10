/**
 * Mounted around upstream's <App/> (main.tsx). Desktop mode stays mounted
 * underneath, inert, so both share one store and switching back finds it as it
 * was (spec §11).
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { native } from "../native";
import { useLauncher } from "../store";
import { suspendSpatialNavigation } from "../spatial";
import { bpNative } from "./bpNative";
import { SidecarStore } from "./data/sidecar";
import { bigPictureMode, closeBigPicture, openBigPicture } from "./mode";
import { BpContext, type Bp, type InputFamily } from "./context";
import { familyOf, keyAction, padAction, type InputAction } from "./input/actions";
import { RepeatFilter } from "./input/repeat";
import { InputGate } from "./input/gate";
import { InputRouter } from "./input/router";
import { ConsoleCatalog } from "./consoles/consoles";
import { useBridge } from "./useBridge";
import { Shell } from "./views/Shell";
import "./bigpicture.css";

const io = { read: bpNative.readSidecar, write: bpNative.writeSidecar };

export function BigPictureHost({ children }: { children: ReactNode }) {
  const open = useSyncExternalStore(bigPictureMode.subscribe, bigPictureMode.isOpen);
  const [sidecar, setSidecar] = useState<SidecarStore | null>(null);

  useEffect(() => {
    let cancelled = false;
    const logError = (e: unknown) => void native.logError(`bigpicture.json: ${String(e)}`).catch(() => {});
    void SidecarStore.load(io, 500, logError).then(async (store) => {
      if (cancelled) return;
      setSidecar(store);
      const args = await bpNative.launchArgs().catch(() => ({ bigPicture: false }));
      if (args.bigPicture || store.settings.startInBigPicture) openBigPicture();
    });
    return () => void (cancelled = true);
  }, []);

  return (
    <>
      <div className="bp-desktop" inert={open}>
        {children}
      </div>
      {open && sidecar && <BigPicture sidecar={sidecar} />}
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

function BigPicture({ sidecar }: { sidecar: SidecarStore }) {
  const launcher = useLauncher();
  const bridge = useBridge();
  const data = useSyncExternalStore(sidecar.subscribe, () => sidecar.snapshot);
  const [family, setFamily] = useState<InputFamily>("keyboard");
  const height = useWindowHeight();
  const scale = Math.max(0.6, (height / 720) * data.settings.uiScale);

  const router = useMemo(() => new InputRouter(), []);
  const gate = useMemo(() => new InputGate(new RepeatFilter((e) => router.dispatch(e))), [router]);
  const consoles = useMemo(() => new ConsoleCatalog(launcher.consoles), [launcher.consoles]);

  // Fullscreen while showing; back to the player's own choice after.
  const desktopFullscreen = Boolean(launcher.settings.fullscreen);
  useEffect(() => {
    void native.setFullscreen(true).catch(() => {});
    return () => void native.setFullscreen(desktopFullscreen).catch(() => {});
  }, [desktopFullscreen]);

  // Big Picture takes the keyboard and controllers from upstream's spatial navigation while it shows.
  useEffect(() => {
    suspendSpatialNavigation(true);
    // A key's action is fixed when it goes down: Shift let go before Tab mustn't turn its release into another action.
    const keysDown = new Map<string, InputAction>();
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const action = down ? keyAction(e) : keysDown.get(e.code);
      if (!action) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (down) {
        if (e.repeat) return;
        keysDown.set(e.code, action);
        setFamily("keyboard");
      } else keysDown.delete(e.code);
      gate.input(`key:${e.code}`, action, down);
    };
    const keyDown = onKey(true);
    const keyUp = onKey(false);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);

    const pad = listen<{ key: string; down: boolean; vendor?: number }>("pad", ({ payload }) => {
      const action = padAction(payload.key);
      if (!action) return;
      if (payload.down && gate.isOpen) setFamily(familyOf(payload.vendor));
      gate.input(`pad:${payload.key}`, action, payload.down);
    });

    const onFocus = () => (gate.windowActive = document.hasFocus());
    onFocus();
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onFocus);
    return () => {
      suspendSpatialNavigation(false);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onFocus);
      void pad.then((stop) => stop());
    };
  }, [gate]);

  const value: Bp = {
    sidecar,
    data,
    router,
    family,
    bridge,
    consoles,
    scale,
    exit: () => {
      void sidecar.flush();
      closeBigPicture();
    },
  };

  return (
    <BpContext.Provider value={value}>
      <div
        className={`bp-root${data.settings.reduceMotion ? " bp-reduce-motion" : ""}`}
        style={{ "--u": `${scale}px` } as CSSProperties}
        role="application"
        aria-label="Quiver Launcher Big Picture"
      >
        <Shell />
      </div>
    </BpContext.Provider>
  );
}
