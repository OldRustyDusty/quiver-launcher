/**
 * Dev only: the whole launcher in a plain browser, with Tauri's commands
 * mocked, so Big Picture can be worked on without a Tauri build or a
 * controller. Run `pnpm --filter @quiver/launcher dev` and open
 * http://localhost:1420/bigpicture-preview.html
 *
 * - The library is the catalog's first apps, most installed, some with an
 *   update, some not yet installed; it's kept in localStorage (?reset starts again).
 * - ?desktop starts in desktop mode instead of Big Picture; ?debug shows the input overlay.
 * - Controllers: bpPad("South") in the console presses and releases a control
 *   (gilrs names); bpPad("DPadRight", true) holds it, bpPad("DPadRight", false)
 *   lets go. The last argument is the pad's family ("playstation" for its glyphs).
 * - Installs pretend to download for a few seconds.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";

const API = "https://api.quiverlauncher.com/api/v1";
const PREFIX = "bp-preview:";
const params = new URLSearchParams(location.search);

const load = (name: string): unknown => JSON.parse(localStorage.getItem(PREFIX + name) ?? "null");
const save = (name: string, value: unknown) => localStorage.setItem(PREFIX + name, JSON.stringify(value));

type Entry = { id: string; slug: string; verified?: { version: string; releasedAt: number } };

async function seed() {
  if (params.has("reset")) Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  if (load("library")) return;
  const page = (await (await fetch(`${API}/apps?limit=${params.get("apps") ?? 60}`)).json()) as { items: Entry[] };
  const now = Date.now();
  const installs: Record<string, unknown> = {};
  page.items.forEach((e, i) => {
    if (i % 6 === 5) return; // In the library, not installed.
    const behind = i % 7 === 3; // An update is waiting.
    installs[e.id] = {
      version: behind ? "v0.0.1" : (e.verified?.version ?? "v1.0.0"),
      releasedAt: behind ? 0 : (e.verified?.releasedAt ?? now),
      folder: e.slug,
      executables: [],
      ...(i % 3 === 0 ? { lastPlayed: now - i * 3_600_000 } : {}),
    };
  });
  save("library", page.items.map((e, i) => ({ id: e.id, slug: e.slug, addedAt: now - i * 86_400_000 })));
  save("installs", installs);
  save("catalog", Object.fromEntries(page.items.map((e) => [e.id, e])));
  save("settings", { telemetryNoticeSeen: true, launched: true });
  save("collections", []);
}

/** A download that takes about three seconds. */
async function fakeInstall(request: { id: string; folder: string; version: string }) {
  const total = 50_000_000;
  for (let received = 0; received <= total; received += total / 12) {
    await emit("install-progress", { id: request.id, phase: "downloading", received, total });
    await new Promise((r) => setTimeout(r, 250));
  }
  return { dir: `C:/QuiverApps/${request.folder}`, version: request.version };
}

mockIPC(
  async (cmd, args) => {
    const a = (args ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (cmd) {
      case "config":
        return {
          api: API,
          convex: "https://convex.quiverlauncher.com",
          githubApi: "https://api.github.com",
          gitlabApi: "https://gitlab.com/api/v4",
          returnTo: "http://localhost:1420/",
          os: "windows",
          arch: "x64",
          appsDir: "C:/QuiverApps",
          posthogHost: "http://localhost:9",
          version: "4.0.0-preview",
          home: null,
          user: null,
        };
      case "read_state":
        return load(a.name);
      case "write_state":
        return save(a.name, a.value);
      case "bp_read_sidecar":
        return load("bigpicture");
      case "bp_write_sidecar":
        return save("bigpicture", a.value);
      case "bp_launch_args":
        return { bigPicture: !params.has("desktop"), debug: params.has("debug") };
      case "plugin:window|is_focused":
        return true;
      case "install":
        return fakeInstall(a.request);
      case "launch":
        console.info("[preview] launch", a);
        return null;
      case "find_v3_library":
        return [];
      case "controllers":
        return ["Preview controller"];
      case "bp_pads_start":
        setTimeout(() => void emit("bp-pads", ["Preview controller"]), 50);
        return null;
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

mockWindows("main");

Object.assign(window, {
  bpPad: (key: string, down?: boolean, family = "xbox") => {
    if (down !== undefined) return emit("bp-pad", { key, down, family, pad: 0 });
    void emit("bp-pad", { key, down: true, family, pad: 0 });
    setTimeout(() => void emit("bp-pad", { key, down: false, family, pad: 0 }), 60);
  },
});

await seed();
await import("../../main");
