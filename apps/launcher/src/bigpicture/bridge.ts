/**
 * The only way Big Picture reaches upstream (spec §4): a view of the store's
 * library, installs, jobs and catalog as one list of apps, and its actions
 * (get, play, remove) behind a queue that installs one app at a time, so two
 * installs never both wait on the store's single release-file choice.
 */
import type { LibraryArt, ProjectType } from "@quiverlauncher/api";
import { hasUpdate, type CatalogEntry, type Install, type Job, type LibraryItem } from "../store";

export type BpState = "notInstalled" | "queued" | "downloading" | "installed" | "updateAvailable" | "updating" | "error";

export type BpApp = {
  /** The catalog entry's id (or "github:…" / "local:…"): the key for the sidecar and focus memory. */
  id: string;
  slug: string;
  /** What the library card shows: the project's name, or the player's own name for it. */
  title: string;
  /** The game it plays, such as "The Legend of Zelda: Majora's Mask". */
  gameTitle: string;
  entry: CatalogEntry;
  inLibrary: boolean;
  state: BpState;
  installedVersion?: string;
  latestVersion?: string;
  /** 0–1 while downloading with a known size; null otherwise. */
  progress: number | null;
  phase?: "downloading" | "installing";
  error?: string;
  /** Upstream's per-app update choice: undefined asks. */
  updates?: Install["updates"];
  lastPlayed?: number;
  addedAt?: number;
  consoles: string[];
  basedOn?: string;
  projectType: ProjectType;
  tags: string[];
  art: LibraryArt & { icon?: string };
};

export type BridgeInput = {
  library: LibraryItem[];
  installs: Record<string, Install>;
  jobs: Record<string, Job>;
  catalog: Record<string, CatalogEntry>;
  /** Ids waiting in Big Picture's install queue. */
  queued?: ReadonlySet<string>;
};

function stateOf(entry: CatalogEntry, install: Install | undefined, job: Job | undefined, queued: boolean): BpState {
  if (job && "error" in job) return "error";
  if (job) return install ? "updating" : "downloading";
  if (queued) return "queued";
  if (!install) return "notInstalled";
  if (!install.local && hasUpdate(entry, install)) return "updateAvailable";
  return "installed";
}

/** One app as Big Picture shows it, with the player's own name and cover over the catalog's (as upstream's library does). */
export function toBpApp(entry: CatalogEntry, input: BridgeInput, item?: LibraryItem): BpApp {
  const install = input.installs[entry.id];
  const job = input.jobs[entry.id];
  const cover = item?.overrides?.cover;
  const art = { ...entry.libraryArt, ...(cover ? { header: cover, hero: cover } : {}), icon: entry.artwork };
  const progress = job && !("error" in job) && job.total ? Math.min(1, job.received / job.total) : null;
  return {
    id: entry.id,
    slug: entry.slug,
    title: item?.overrides?.name || entry.projectName || entry.name,
    gameTitle: entry.name,
    entry,
    inLibrary: Boolean(item),
    state: stateOf(entry, install, job, input.queued?.has(entry.id) ?? false),
    installedVersion: install?.version,
    latestVersion: entry.verified?.version,
    progress,
    phase: job && !("error" in job) ? job.phase : undefined,
    error: job && "error" in job ? job.error : undefined,
    updates: install?.updates,
    lastPlayed: install?.lastPlayed,
    addedAt: item?.addedAt,
    consoles: entry.consoles ?? [],
    basedOn: entry.basedOn?.console,
    projectType: entry.projectType,
    tags: [...entry.tags, ...(item?.overrides?.tags ?? [])],
    art,
  };
}

/** The library as Big Picture shows it: removed apps and ones whose catalog entry hasn't loaded yet are left out. */
export function libraryApps(input: BridgeInput): BpApp[] {
  return input.library.flatMap((item) => {
    const entry = input.catalog[item.id];
    return !item.removed && entry ? [toBpApp(entry, input, item)] : [];
  });
}

/** Installed (including updating or with an update): what console tabs and All show. */
export const isInstalled = (app: BpApp) => app.state === "installed" || app.state === "updateAvailable" || app.state === "updating";

type Task = { id: string; run: () => Promise<void>; done: () => void };

/** Installs one app at a time, in the order asked. */
export class InstallQueue {
  private waiting: Task[] = [];
  private current: Task | null = null;
  private readonly listeners = new Set<() => void>();
  private ids: ReadonlySet<string> = new Set();

  /** Resolves once the app's install has finished (or failed, or was taken out of the queue). Asking again for one already waiting or running does nothing more. */
  enqueue(id: string, run: () => Promise<void>): Promise<void> {
    if (this.current?.id === id || this.waiting.some((t) => t.id === id)) return Promise.resolve();
    return new Promise<void>((done) => {
      this.waiting.push({ id, run, done });
      this.changed();
      this.next();
    });
  }

  /** Takes an app out of the queue before it starts; one already installing carries on. */
  cancel(id: string): boolean {
    const task = this.waiting.find((t) => t.id === id);
    if (!task) return false;
    this.waiting = this.waiting.filter((t) => t !== task);
    task.done();
    this.changed();
    return true;
  }

  /** Apps waiting their turn (not the one installing). */
  get queued(): ReadonlySet<string> {
    return this.ids;
  }

  get active(): string | null {
    return this.current?.id ?? null;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private next() {
    if (this.current || !this.waiting.length) return;
    const task = this.waiting.shift()!;
    this.current = task;
    this.changed();
    // The store reports failures itself (jobs[id].error); the queue only moves on.
    void task
      .run()
      .catch(() => {})
      .finally(() => {
        this.current = null;
        task.done();
        this.changed();
        this.next();
      });
  }

  private changed() {
    this.ids = new Set(this.waiting.map((t) => t.id));
    for (const listener of this.listeners) listener();
  }
}
