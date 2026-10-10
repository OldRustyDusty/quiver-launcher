/** What Discover and Downloads list (spec §8), and the remembered release file. Pure. */
import type { Asset } from "@quiverlauncher/api";
import { isInstalled, type BpApp } from "../bridge";
import type { BpSidecar } from "../data/sidecar";
import { isBusy } from "./tileActions";

/** Discover's library filter: what's not in the library yet, what's in it but not installed, or both. */
export type LibraryFilter = "notInLibrary" | "inLibrary" | "all";

/**
 * Discover: games to get. Installed games aren't here (they're in the library's tabs).
 * `library` is the library as Big Picture shows it; `catalog` the catalog's pages
 * (already for the chosen console), seen as apps.
 */
export function discoverApps(library: readonly BpApp[], catalog: readonly BpApp[], filter: LibraryFilter, consoleId: string | null): BpApp[] {
  const ids = new Set(library.map((a) => a.id));
  const onConsole = (a: BpApp) => !consoleId || a.basedOn === consoleId || a.consoles.includes(consoleId);
  const mine = library.filter((a) => !isInstalled(a) && onConsole(a));
  const theirs = catalog.filter((a) => !ids.has(a.id));
  return filter === "inLibrary" ? mine : filter === "notInLibrary" ? theirs : [...mine, ...theirs];
}

export type DownloadRow = { kind: "updateAll"; apps: BpApp[] } | { kind: "app"; app: BpApp; status: "active" | "queued" | "failed" | "done" };

/**
 * Downloads: Update all (when there are updates), then what's downloading, what's waiting, what failed,
 * and what finished since `since` (this session), newest first.
 */
export function downloadRows(apps: readonly BpApp[], data: BpSidecar, since: number): DownloadRow[] {
  const updates = apps.filter((a) => a.state === "updateAvailable");
  const active = apps.filter((a) => a.state === "downloading" || a.state === "updating");
  const queued = apps.filter((a) => a.state === "queued");
  const failed = apps.filter((a) => a.state === "error");
  const done = apps
    .filter((a) => isInstalled(a) && !isBusy(a) && a.state !== "error" && (data.apps[a.id]?.installedAt ?? 0) >= since)
    .sort((a, b) => (data.apps[b.id]?.installedAt ?? 0) - (data.apps[a.id]?.installedAt ?? 0));
  return [
    ...(updates.length ? [{ kind: "updateAll" as const, apps: updates }] : []),
    ...active.map((app) => ({ kind: "app" as const, app, status: "active" as const })),
    ...queued.map((app) => ({ kind: "app" as const, app, status: "queued" as const })),
    ...failed.map((app) => ({ kind: "app" as const, app, status: "failed" as const })),
    ...done.map((app) => ({ kind: "app" as const, app, status: "done" as const })),
  ];
}

/** The file the player picked before, found again among a new release's (spec §4: never asked again); null when it's not clear which. */
export function rememberedAsset(assets: readonly Asset[], pattern: string | undefined): Asset | null {
  const wanted = pattern?.trim().toLowerCase();
  if (!wanted) return null;
  const matches = assets.filter((a) => a.filename.toLowerCase().includes(wanted));
  return matches.length === 1 ? matches[0] : null;
}
