/**
 * "Use the same games folder as Quiver 3" (docs/bigpicture/PLAN-v4.md §12),
 * carried out. Mounted for the whole app (BigPictureHost), in desktop mode too:
 * it asks once, catches up when turned on, and then keeps Quiver 3 in the
 * picture as games are installed, updated, moved and uninstalled.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Entry } from "@quiverlauncher/api";
import { listen } from "@tauri-apps/api/event";
import { native } from "../../native";
import { setNewInstallDir, useLauncher, type Install } from "../../store";
import { bpNative } from "../bpNative";
import type { SidecarStore } from "../data/sidecar";
import {
  findV3,
  isCustomId,
  matchFor,
  plan as makePlan,
  repoKey,
  repoOf,
  samePath,
  v3EntryFor,
  v3Path,
  type Plan,
  type Repos,
  type V3Change,
  type V3Library,
} from "./v3share";

export type ShareDialog =
  | { kind: "ask"; oneTime: boolean; plan: Plan | null; running: boolean; gamesDir: string; error?: string }
  | { kind: "working"; title: string; step: number; steps: number; current: string; done: number; total: number }
  | { kind: "done"; title: string; lines: string[] }
  | null;

export type Share = {
  /** Quiver 3 is on this computer. */
  available: boolean;
  on: boolean;
  gamesDir: string | null;
  dialog: ShareDialog;
  /** Settings: show the question (and what it would do). */
  ask(): void;
  accept(): void;
  notNow(): void;
  dontAsk(): void;
  closeDialog(): void;
  turnOff(): void;
};

/** The catalog's repositories, fetched once (upstream's release-status feed), and its games' slugs. */
let reposOnce: Promise<Repos> | null = null;
const slugs = new Map<string, string>();
function loadRepos(releaseStatus: (cursor?: string | null) => Promise<{ items: { id: string; slug: string; provider: string; repository?: string }[]; nextCursor: string | null; isDone: boolean }>) {
  reposOnce ??= (async () => {
    const repos: Repos = { byId: new Map(), byRepo: new Map() };
    for (let cursor: string | null = null, done = false; !done; ) {
      const page = await releaseStatus(cursor);
      for (const s of page.items) {
        slugs.set(s.id, s.slug);
        if (!s.repository) continue;
        const repo = { provider: s.provider, repository: s.repository };
        repos.byId.set(s.id, repo);
        repos.byRepo.set(repoKey(repo), s.id);
      }
      [cursor, done] = [page.nextCursor, page.isDone];
    }
    return repos;
  })().catch((e) => {
    reposOnce = null;
    throw e;
  });
  return reposOnce;
}

/** "A, B, C and 12 more": long lists stay readable. */
export const some = (names: string[], max = 6) =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;

const noStore = { subscribe: () => () => {}, snapshot: null };
const managed = (i: Install | undefined): i is Install => Boolean(i && !i.local && !i.program);
const OPEN = "Quiver 3 is open.";

export function useShare(sidecar: SidecarStore | null): Share {
  const launcher = useLauncher();
  const latest = useRef(launcher);
  latest.current = launcher;
  const store = sidecar ?? noStore;
  const data = useSyncExternalStore(store.subscribe, () => (sidecar ? sidecar.snapshot : null));
  const state = data?.v3Share;
  const on = Boolean(state?.on);
  const [lib, setLib] = useState<V3Library | null>(null);
  const libRef = useRef(lib);
  libRef.current = lib;
  const [dialog, setDialog] = useState<ShareDialog>(null);
  const asked = useRef(false);
  const startedEmpty = useRef(launcher.library.length === 0);
  const working = useRef(false);
  const windows = launcher.config.os === "windows";
  const sep = windows ? "\\" : "/";

  const refresh = useCallback(async () => {
    const found = await bpNative.v3Library().catch(() => null);
    setLib(found);
    return found;
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const repos = () => loadRepos((c) => latest.current.client.releaseStatus(c));
  const busy = (id: string) => {
    const job = latest.current.jobs[id];
    return Boolean(job && !("error" in job));
  };
  const name = (id: string) => {
    const e = latest.current.catalog[id];
    return e?.projectName || e?.name || id;
  };

  async function planNow(found: V3Library): Promise<Plan> {
    const L = latest.current;
    return makePlan({
      v3: found,
      libraryIds: L.library.map((i) => i.id),
      installs: L.installs,
      appsDir: L.config.appsDir,
      repos: await repos(),
      busy,
      sep,
      windows,
      known: new Set([...L.library.map((i) => i.id), ...Object.keys(L.catalog)]),
    });
  }

  /** The change that puts a game's folder in Quiver 3's list. */
  async function upsert(id: string, dir: string): Promise<V3Change | null> {
    const entry = latest.current.catalog[id];
    const repo = repoOf(id, await repos().catch(() => ({ byId: new Map(), byRepo: new Map() }) as Repos));
    if (!entry || !repo) return null;
    const install = latest.current.installs[id];
    const folder = dir.split(/[\\/]/).filter(Boolean).at(-1) ?? install?.folder ?? entry.slug;
    return { kind: "upsert", match: matchFor(id, repo), installPath: v3Path(dir, sep), entry: v3EntryFor(entry, repo, folder, isCustomId(id)) };
  }

  /** Writes changes to Quiver 3's list now, or keeps them for when it's closed. Resolves to the backup made, if any. */
  async function write(changes: V3Change[]): Promise<{ backup: string | null; waiting: boolean }> {
    const all = [...((sidecar?.snapshot.v3Share?.pending ?? []) as V3Change[]), ...changes];
    if (!all.length) return { backup: null, waiting: false };
    try {
      const backup = await bpNative.v3Write(all);
      sidecar?.setV3Share({ pending: [] });
      return { backup, waiting: false };
    } catch (e) {
      sidecar?.setV3Share({ pending: all });
      if (String(e) !== OPEN) void native.logError(`bigpicture v3 share: ${String(e)}`).catch(() => {});
      return { backup: null, waiting: true };
    }
  }

  /**
   * The catalog entry for a game Quiver 3 has. Custom apps (not in the catalog) aren't brought over here:
   * upstream adds those only by installing them, which would download a game that's already there.
   */
  async function entryFor(id: string): Promise<Entry | null> {
    const L = latest.current;
    if (L.catalog[id]) return L.catalog[id];
    if (isCustomId(id)) return null;
    await repos();
    const slug = slugs.get(id);
    return slug ? ((await L.client.app(slug).catch(() => null))?.entry ?? null) : null;
  }

  /** Does what the plan says. Changes to Quiver 3's list are written last, in one go. */
  async function carryOut(p: Plan, found: V3Library, auto: boolean) {
    if (working.current) return;
    working.current = true;
    const L = () => latest.current;
    const os = L().config.os as "windows" | "linux" | "macos";
    const changes: V3Change[] = [];
    const moved: string[] = [];
    const remade: string[] = [];
    const problems: string[] = [];
    const steps = p.bringOver.length + p.versions.length + p.addToV3.length + p.duplicates.length + p.moves.length;
    let step = 0;
    const title = auto ? "Moving games into your Quiver 3 games folder" : "Setting up one games folder";
    const show = (current: string, done = 0, total = 0) => setDialog({ kind: "working", title, step, steps, current, done, total });
    const off = listen<{ id: string; done: number; total: number }>("bp-move-progress", ({ payload }) =>
      setDialog((d) => (d?.kind === "working" ? { ...d, done: payload.done, total: payload.total } : d)),
    );
    const place = (id: string, patch: Partial<Install>) => {
      const install = L().installs[id];
      if (install) L().adopt(id, { ...install, ...patch });
    };
    const add = async (id: string, dir: string) => {
      const change = await upsert(id, dir);
      if (change) changes.push(change);
    };

    try {
      for (const b of p.bringOver) {
        step++;
        show(b.v3.name);
        const entry = await entryFor(b.id).catch(() => null);
        if (!entry) {
          problems.push(
            isCustomId(b.id)
              ? `${b.v3.name} isn't in the catalog, so it stays in Quiver 3 only. To add it here, use Add a game in desktop mode with its repository.`
              : `${b.v3.name} couldn't be found online, so it stays in Quiver 3 only for now.`,
          );
          continue;
        }
        L().cache([entry]);
        L().add(entry);
        if (b.v3.dir && b.v3.version) {
          L().adopt(entry.id, { dir: b.v3.dir, version: b.v3.version, folder: entry.launcher.folderName || entry.slug, executables: entry.launcher.preferredExecutables?.[os] ?? [] });
          await bpNative.writeVersions(b.v3.dir, b.v3.version).catch(() => {});
        }
      }
      for (const v of p.versions) {
        step++;
        show(name(v.id));
        if (v.to === "record") place(v.id, { version: v.version });
        await bpNative.writeVersions(v.dir, v.version).catch((e) => problems.push(`${name(v.id)}: ${String(e)}`));
      }
      for (const a of p.addToV3) {
        step++;
        await add(a.id, a.dir);
      }
      for (const d of p.duplicates) {
        step++;
        show(name(d.id));
        try {
          if (d.keep === "v4") {
            // Only once the newer copy is known to be movable does the older one go.
            const cut = Math.max(d.v4Dir.lastIndexOf("\\"), d.v4Dir.lastIndexOf("/"));
            const [, mine] = await bpNative.gameDir(d.v4Dir.slice(0, cut), d.v4Dir.slice(cut + 1));
            if (mine !== "ours") throw new Error(`${d.v4Dir} isn't a folder Quiver installed, so neither copy was touched.`);
            await bpNative.trashGame(d.v3Dir);
            const result = await bpNative.moveGame(d.id, d.v4Dir, d.v3Dir);
            place(d.id, { dir: d.v3Dir });
            await bpNative.writeVersions(d.v3Dir, d.v4Version);
            if (!result.trashed) problems.push(`${name(d.id)}: the old copy at ${d.v4Dir} couldn't go to the Recycle Bin.`);
          } else {
            place(d.id, { dir: d.v3Dir, version: d.v3Version || L().installs[d.id]?.version });
            await bpNative.writeVersions(d.v3Dir, d.v3Version || L().installs[d.id]?.version || "");
            await bpNative.trashGame(d.v4Dir);
          }
          await add(d.id, d.v3Dir);
          moved.push(name(d.id));
        } catch (e) {
          problems.push(`${name(d.id)}: ${String(e)}`);
        }
      }
      for (const m of p.moves) {
        step++;
        show(name(m.id));
        try {
          const [to, there] = await bpNative.gameDir(found.gamesDir, m.folder);
          if (there !== "free") {
            problems.push(`${name(m.id)} wasn't moved: ${to} already has files in it.`);
            continue;
          }
          const result = await bpNative.moveGame(m.id, m.from, to);
          place(m.id, { dir: to });
          const install = L().installs[m.id];
          if (install) await bpNative.writeVersions(to, install.version).catch(() => {});
          await add(m.id, to);
          moved.push(name(m.id));
          if (!result.trashed) problems.push(`${name(m.id)}: the old copy at ${m.from} couldn't go to the Recycle Bin.`);
          // Desktop shortcuts start the game's program by its path: make them again.
          const entry = L().catalog[m.id];
          if (entry && install && (await bpNative.hasDesktopShortcut(entry.projectName).catch(() => false))) {
            const art = entry.libraryArt ?? {};
            await native
              .createShortcut({
                name: entry.projectName,
                folder: install.folder,
                dir: to,
                preferred: install.executables,
                wine: Boolean(install.wine),
                art: { icon: entry.artwork ?? art.logo, header: art.header, capsule: art.capsule, hero: art.hero, logo: art.logo },
              })
              .then(() => remade.push(entry.projectName), () => {});
          }
        } catch (e) {
          problems.push(`${name(m.id)} wasn't moved: ${String(e)}`);
        }
      }
      const { backup, waiting } = await write(changes);
      if (!auto) sidecar?.setV3Share({ on: true, ...(backup ? { backup } : {}) });
      else if (backup && !sidecar?.snapshot.v3Share?.backup) sidecar?.setV3Share({ backup });

      const lines: string[] = [];
      if (!auto) lines.push(`Games you get now install to ${found.gamesDir}, and show up in Quiver 3 too.`);
      if (moved.length) lines.push(`Moved ${moved.length === 1 ? "1 game" : `${moved.length} games`}: ${some(moved)}.`);
      if (remade.length) lines.push(`Desktop shortcuts made again: ${some(remade)}.`);
      if (moved.length) lines.push("If you added any of these to Steam, add them again from their page in desktop mode.");
      if (waiting) lines.push("Quiver 3 was opened, so its list will be updated when it's closed.");
      if (p.notInCatalog.length) lines.push(`Staying in Quiver 3 only: ${some(p.notInCatalog)}.`);
      lines.push(...problems);
      // On its own at start: only news when games moved; what couldn't move (running, a folder in the way) waits for next time.
      if (auto && !moved.length) {
        for (const problem of problems) void native.logError(`bigpicture v3 share: ${problem}`).catch(() => {});
        setDialog(null);
      } else setDialog({ kind: "done", title: auto ? "Games moved" : "One games folder", lines });
    } finally {
      void off.then((stop) => stop());
      working.current = false;
      void refresh();
    }
  }

  async function openAsk(oneTime: boolean) {
    const found = await refresh();
    if (!found) return;
    setDialog({ kind: "ask", oneTime, plan: null, running: found.running, gamesDir: found.gamesDir });
    try {
      const p = await planNow(found);
      setDialog((d) => (d?.kind === "ask" ? { ...d, plan: p } : d));
    } catch {
      setDialog((d) => (d?.kind === "ask" ? { ...d, error: "Couldn't reach quiverlauncher.com to match your games. Check your connection and try again." } : d));
    }
  }

  // While the question is up: whether Quiver 3 is still open, and the plan as things are now.
  const asking = dialog?.kind === "ask";
  useEffect(() => {
    if (!asking) return;
    const timer = setInterval(async () => {
      const found = await bpNative.v3Library().catch(() => null);
      if (!found) return;
      setLib(found);
      const p = await planNow(found).catch(() => null);
      setDialog((d) => (d?.kind === "ask" ? { ...d, running: found.running, ...(p ? { plan: p, error: undefined } : {}) } : d));
    }, 2000);
    return () => clearInterval(timer);
  }, [asking]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ask once: after an import, or (people who imported earlier) on the first start with this feature.
  const libraryCount = launcher.library.length;
  const importPending = launcher.oldApps.length > 0;
  useEffect(() => {
    if (!sidecar || !lib || on || state?.dontAsk || asked.current || dialog || !libraryCount || importPending) return;
    asked.current = true;
    void openAsk(!startedEmpty.current);
  }, [sidecar, lib, on, state?.dontAsk, dialog, libraryCount, importPending]); // eslint-disable-line react-hooks/exhaustive-deps

  // New installs go into Quiver 3's games folder: a folder that's free, already Quiver 4's, or Quiver 3's copy of the same game.
  useEffect(() => {
    if (!on || !lib) return;
    setNewInstallDir(async (entry, folder) => {
      const current = libRef.current ?? lib;
      const theirs = findV3(current.entries, entry.id, repoOf(entry.id, await repos().catch(() => ({ byId: new Map(), byRepo: new Map() }) as Repos)));
      const [dir, there] = await bpNative.gameDir(current.gamesDir, theirs?.folderName || folder).catch(() => ["", "other"] as const);
      if (!dir) return undefined;
      const taken = Object.values(latest.current.installs).some((i) => i.dir && samePath(i.dir, dir, windows));
      if (taken) return undefined;
      if (there === "free" || there === "ours") return dir;
      if (there === "v3" && theirs?.dir && samePath(theirs.dir, dir, windows)) return dir;
      return undefined;
    });
    return () => setNewInstallDir(null);
  }, [on, lib]); // eslint-disable-line react-hooks/exhaustive-deps

  // While on: what happens to installs from here on, Quiver 3 hears about.
  const before = useRef(launcher.installs);
  const [sweep, setSweep] = useState(0);
  useEffect(() => {
    const prev = before.current;
    const now = launcher.installs;
    before.current = now;
    if (!on || working.current || prev === now) return;
    void (async () => {
      const changes: V3Change[] = [];
      let strays = false;
      for (const id of new Set([...Object.keys(prev), ...Object.keys(now)])) {
        const [was, is] = [prev[id], now[id]];
        if (managed(is)) {
          if (!is.dir) strays = true;
          else if (!was || was.version !== is.version || was.dir !== is.dir) {
            await bpNative.writeVersions(is.dir, is.version).catch(() => {});
            const change = await upsert(id, is.dir);
            if (change) changes.push(change);
          }
        } else if (managed(was) && !is && was.dir) {
          const repo = repoOf(id, await repos().catch(() => ({ byId: new Map(), byRepo: new Map() }) as Repos));
          changes.push({ kind: "remove", match: matchFor(id, repo), installPath: was.dir });
        }
      }
      if (changes.length) await write(changes);
      if (strays) setSweep((n) => n + 1);
    })();
  }, [launcher.installs, on]); // eslint-disable-line react-hooks/exhaustive-deps

  // Games in Quiver 4's own folder (the official app's installs, or one that couldn't go to Quiver 3's): moved over, at start and when one appears.
  useEffect(() => {
    if (!on || !lib || working.current || dialog) return;
    const strays = launcher.library.some((i) => managed(launcher.installs[i.id]) && !launcher.installs[i.id].dir && !busy(i.id));
    if (!strays) return;
    void (async () => {
      const p = await planNow(lib).catch(() => null);
      if (!p || (!p.moves.length && !p.duplicates.length)) return;
      await carryOut({ ...p, bringOver: [], versions: [], addToV3: [], notInCatalog: [] }, lib, true);
    })();
  }, [on, lib, sweep]); // eslint-disable-line react-hooks/exhaustive-deps

  // Changes waiting for Quiver 3 to close: tried now and then.
  const waiting = (state?.pending?.length ?? 0) > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void write([]), 15_000);
    return () => clearInterval(timer);
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo<Share>(
    () => ({
      available: Boolean(lib),
      on,
      gamesDir: lib?.gamesDir ?? null,
      dialog,
      ask: () => void openAsk(false),
      accept: () => {
        if (dialog?.kind !== "ask" || !dialog.plan || dialog.running || !lib) return;
        void carryOut(dialog.plan, lib, false);
      },
      notNow: () => setDialog(null),
      dontAsk: () => {
        sidecar?.setV3Share({ dontAsk: true });
        setDialog(null);
      },
      closeDialog: () => setDialog((d) => (d?.kind === "working" ? d : null)),
      turnOff: () => sidecar?.setV3Share({ on: false }),
    }),
    [lib, on, dialog, sidecar], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

