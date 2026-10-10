/**
 * "Use the same games folder as Quiver 3" (docs/bigpicture/PLAN-v4.md §12): what
 * turning it on would do, worked out from both libraries without touching
 * anything. Pure, so every case is tested; useShare.ts carries it out.
 */
import type { Entry } from "@quiverlauncher/api";
import type { Install } from "../../store";

/** A game in Quiver 3's apps.json (src-tauri/src/bigpicture/v3share.rs). */
export type V3Entry = {
  name: string;
  folderName: string | null;
  repository: string | null;
  provider: string;
  catalogEntryId: string | null;
  /** Its folder, when it's there. */
  dir: string | null;
  /** From the folder's version.txt. */
  version: string | null;
};

export type V3Library = { root: string; gamesDir: string; running: boolean; entries: V3Entry[] };

export type V3Match = { catalogEntryId?: string; repository?: string; provider: string };
export type V3Change =
  | { kind: "upsert"; match: V3Match; installPath: string; entry: Record<string, unknown> }
  | { kind: "remove"; match: V3Match; installPath: string };

/** Where a game comes from: its GitHub or GitLab repository. */
export type Repo = { provider: string; repository: string };

/** Catalog games' repositories (upstream's release-status feed), both ways. */
export type Repos = { byId: Map<string, Repo>; byRepo: Map<string, string> };
export const repoKey = (r: Repo) => `${r.provider}:${r.repository}`.toLowerCase();

/** A custom app's id is its repository ("github:owner/repo", upstream's customKey). */
export function repoOf(id: string, repos: Repos): Repo | undefined {
  const known = repos.byId.get(id);
  if (known) return known;
  const custom = /^(github|gitlab):(.+)$/.exec(id);
  return custom ? { provider: custom[1], repository: custom[2] } : undefined;
}
export const isCustomId = (id: string) => /^(github|gitlab):/.test(id);

export const matchFor = (id: string, repo: Repo | undefined): V3Match => ({
  ...(isCustomId(id) ? {} : { catalogEntryId: id }),
  ...(repo ? { repository: repo.repository } : {}),
  provider: repo?.provider ?? "github",
});

/** Quiver 3's entry for a game: by the catalog's id, or by repository. */
export function findV3(entries: V3Entry[], id: string, repo: Repo | undefined): V3Entry | undefined {
  return (
    entries.find((e) => e.catalogEntryId === id) ??
    (repo ? entries.find((e) => e.repository && repoKey({ provider: e.provider, repository: e.repository }) === repoKey(repo)) : undefined)
  );
}

/**
 * The library id a Quiver 3 game would have: the catalog's, or a custom app's (null without a repository).
 * `known`: ids the library or its cached catalog already has, for when the catalog can't be reached.
 */
export function idForV3(entry: V3Entry, repos: Repos, known: ReadonlySet<string> = new Set()): string | null {
  if (entry.catalogEntryId && (repos.byId.has(entry.catalogEntryId) || known.has(entry.catalogEntryId))) return entry.catalogEntryId;
  if (!entry.repository) return null;
  const repo = { provider: entry.provider, repository: entry.repository };
  return repos.byRepo.get(repoKey(repo)) ?? `${repo.provider}:${repo.repository.toLowerCase()}`;
}

/** Paths compare without a trailing separator, and (Windows) without regard to case. */
export function samePath(a: string, b: string, windows = true) {
  const trim = (p: string) => p.replace(/[\\/]+$/, "");
  return windows ? trim(a).toLowerCase() === trim(b).toLowerCase() : trim(a) === trim(b);
}
export const join = (dir: string, name: string, sep: string) => `${dir.replace(/[\\/]+$/, "")}${sep}${name}`;

/** -1, 0 or 1: versions compared by their numbers ("v1.10" after "v1.9"); 0 when they can't be told apart. */
export function compareVersions(a: string, b: string) {
  const nums = (v: string) => (v.match(/\d+/g) ?? []).map(Number);
  const [x, y] = [nums(a), nums(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Installs Big Quiver can move or share: not the player's own files or programs. */
const managed = (install: Install) => !install.local && !install.program;

export type Plan = {
  /** Already in a folder Quiver 3 lists for them. */
  shared: string[];
  /** A version to write: into the folder (Quiver 4's is newer) or into Quiver 4's record (Quiver 3's is). */
  versions: { id: string; dir: string; version: string; to: "folder" | "record" }[];
  /** In Quiver 4's own apps folder: moving to Quiver 3's games folder, under this folder name. */
  moves: { id: string; from: string; folder: string }[];
  /** Installed by both launchers in two folders: the newer copy stays, in Quiver 3's folder. */
  duplicates: { id: string; v4Dir: string; v4Version: string; v3Dir: string; v3Version: string; keep: "v4" | "v3" }[];
  /** Installed by Quiver 3 only: into the library, where it is. */
  bringOver: { id: string; v3: V3Entry }[];
  /** Installed by Quiver 4 outside its apps folder, but missing from Quiver 3's list. */
  addToV3: { id: string; dir: string }[];
  /** Installed by Quiver 3, with no repository to find it by. */
  notInCatalog: string[];
  /** Downloading or updating now: left for later. */
  busy: string[];
};

export type PlanInput = {
  v3: V3Library;
  libraryIds: string[];
  installs: Record<string, Install>;
  appsDir: string;
  repos: Repos;
  busy: (id: string) => boolean;
  sep: string;
  windows?: boolean;
  /** Ids in the library or its cached catalog. */
  known?: ReadonlySet<string>;
};

export function plan({ v3, libraryIds, installs, appsDir, repos, busy, sep, windows = true, known = new Set() }: PlanInput): Plan {
  const out: Plan = { shared: [], versions: [], moves: [], duplicates: [], bringOver: [], addToV3: [], notInCatalog: [], busy: [] };
  const claimed = new Set<V3Entry>();
  const inLibrary = new Set(libraryIds);

  for (const id of libraryIds) {
    const install = installs[id];
    if (!install || !managed(install)) continue;
    const repo = repoOf(id, repos);
    const theirs = findV3(v3.entries, id, repo);
    if (theirs) claimed.add(theirs);
    if (busy(id)) {
      out.busy.push(id);
      continue;
    }
    const v4Dir = install.dir ?? join(appsDir, install.folder, sep);
    if (theirs?.dir && samePath(theirs.dir, v4Dir, windows)) {
      out.shared.push(id);
      const order = theirs.version ? compareVersions(install.version, theirs.version) : 1;
      if (order > 0 || (!theirs.version && install.version)) out.versions.push({ id, dir: v4Dir, version: install.version, to: "folder" });
      else if (order < 0 && theirs.version) out.versions.push({ id, dir: v4Dir, version: theirs.version, to: "record" });
    } else if (theirs?.dir) {
      const v3Version = theirs.version ?? "";
      out.duplicates.push({ id, v4Dir, v4Version: install.version, v3Dir: theirs.dir, v3Version, keep: compareVersions(install.version, v3Version) > 0 ? "v4" : "v3" });
    } else if (install.dir) {
      out.addToV3.push({ id, dir: install.dir });
    } else {
      out.moves.push({ id, from: v4Dir, folder: theirs?.folderName || install.folder });
    }
  }

  for (const entry of v3.entries) {
    if (claimed.has(entry) || !entry.dir) continue;
    const id = idForV3(entry, repos, known);
    if (!id) out.notInCatalog.push(entry.name);
    else if (!(inLibrary.has(id) && installs[id])) out.bringOver.push({ id, v3: entry });
  }
  return out;
}

/** Nothing to do but turn it on. */
export const planIsEmpty = (p: Plan) =>
  !p.versions.length && !p.moves.length && !p.duplicates.length && !p.bringOver.length && !p.addToV3.length;

/**
 * A new entry for Quiver 3's apps.json, as Quiver 3 writes one (SerializeApp on
 * upstream main): only fields it reads, in the shapes it checks.
 */
export function v3EntryFor(entry: Entry, repo: Repo, folder: string, custom: boolean): Record<string, unknown> {
  const tags = (entry.tags ?? []).filter((t): t is string => typeof t === "string");
  const out: Record<string, unknown> = {
    name: entry.name,
    folderName: folder,
    appIconUrl: entry.artwork ?? null,
    repository: repo.repository,
    preferredVersion: null,
    skippedUpdateVersion: null,
  };
  if (entry.projectName?.trim()) out.project = entry.projectName.trim();
  if (repo.provider !== "github") out.repositorySource = repo.provider;
  if (tags.length) out.tags = tags;
  if (!custom) {
    out.catalogEntryId = entry.id;
    out.catalog = { name: entry.name, project: entry.projectName ?? null, appIconUrl: entry.artwork ?? null, tags };
  }
  const files = (entry.launcher.filesToAdd ?? []).filter((f): f is string => typeof f === "string");
  if (files.length) out.filesToAdd = files;
  if (entry.launcher.releaseAssetFilter?.trim()) out.releaseAssetFilter = entry.launcher.releaseAssetFilter.trim();
  return out;
}

/** Quiver 3 writes folders with a trailing separator. */
export const v3Path = (dir: string, sep: string) => (/[\\/]$/.test(dir) ? dir : dir + sep);

/** The preview's lines, in the order they happen; only those with something to say. */
export function previewLines(p: Plan, gamesDir: string): string[] {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const lines: string[] = [];
  if (p.shared.length) lines.push(`${n(p.shared.length, "game is", "games are")} already in Quiver 3's folders`);
  if (p.moves.length) lines.push(`${n(p.moves.length, "game", "games")} to move into ${gamesDir}`);
  if (p.duplicates.length) lines.push(`${n(p.duplicates.length, "game is", "games are")} installed twice: the newer copy is kept, and the other goes to the Recycle Bin`);
  if (p.bringOver.length) lines.push(`${n(p.bringOver.length, "game", "games")} from Quiver 3 to add to your library`);
  if (p.addToV3.length) lines.push(`${n(p.addToV3.length, "game", "games")} to add to Quiver 3's list`);
  if (p.versions.length) lines.push(`${n(p.versions.length, "version number", "version numbers")} to bring up to date`);
  if (p.notInCatalog.length) lines.push(`${n(p.notInCatalog.length, "Quiver 3 game isn't", "Quiver 3 games aren't")} in the catalog, so ${p.notInCatalog.length === 1 ? "it stays" : "they stay"} in Quiver 3 only`);
  if (p.busy.length) lines.push(`${n(p.busy.length, "game is", "games are")} downloading, and will follow when ${p.busy.length === 1 ? "it's" : "they're"} done`);
  return lines;
}
