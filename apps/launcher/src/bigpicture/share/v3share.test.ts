import { describe, expect, test } from "vitest";
import type { Entry } from "@quiverlauncher/api";
import type { Install } from "../../store";
import { compareVersions, findV3, idForV3, matchFor, plan, planIsEmpty, previewLines, samePath, v3EntryFor, type Repos, type V3Entry, type V3Library } from "./v3share";

const repos: Repos = {
  byId: new Map([
    ["k-banjo", { provider: "github", repository: "BanjoRecomp/BanjoRecomp" }],
    ["k-zelda", { provider: "github", repository: "Zelda64Recomp/Zelda64Recomp" }],
    ["k-dk", { provider: "github", repository: "Rekongpiled/DK64" }],
    ["k-mario", { provider: "github", repository: "Paper/Boat" }],
    ["k-new", { provider: "github", repository: "New/Game" }],
  ]),
  byRepo: new Map(),
};
for (const [id, r] of repos.byId) repos.byRepo.set(`${r.provider}:${r.repository}`.toLowerCase(), id);

const v3 = (over: Partial<V3Entry>): V3Entry => ({ name: "Game", folderName: null, repository: null, provider: "github", catalogEntryId: null, dir: null, version: null, ...over });
const install = (over: Partial<Install>): Install => ({ version: "v1.0.0", folder: "Game", executables: [], ...over });

const library: V3Library = {
  root: "E:\\QuiverLauncher",
  gamesDir: "E:\\QuiverLauncher\\Apps",
  running: false,
  entries: [
    // Imported, still where Quiver 3 put it (its own custom folder).
    v3({ name: "Banjo-Kazooie", catalogEntryId: "k-banjo", repository: "BanjoRecomp/BanjoRecomp", dir: "Q:\\N64\\Banjo\\", version: "v1.0.2" }),
    // Also installed by Quiver 4, separately.
    v3({ name: "Zelda", catalogEntryId: "k-zelda", repository: "Zelda64Recomp/Zelda64Recomp", folderName: "Zelda64", dir: "E:\\QuiverLauncher\\Apps\\Zelda64", version: "v1.1.0" }),
    // Only in Quiver 3: matched by repository (an older entry without a catalog id).
    v3({ name: "Paper Mario", repository: "paper/boat", dir: "E:\\QuiverLauncher\\Apps\\PaperBoat", version: "v0.9" }),
    // Only in Quiver 3, and not in the catalog: a custom app.
    v3({ name: "Homebrew", repository: "me/homebrew", dir: "E:\\QuiverLauncher\\Apps\\Homebrew", version: "v1" }),
    // No repository at all.
    v3({ name: "Manual", dir: "E:\\QuiverLauncher\\Apps\\Manual" }),
    // Listed but not installed: not a game on disk, left alone.
    v3({ name: "Wishlist", catalogEntryId: "k-dk", repository: "Rekongpiled/DK64" }),
  ],
};

const installs: Record<string, Install> = {
  "k-banjo": install({ dir: "q:\\n64\\banjo", version: "v1.1.0", folder: "BanjoKazooie-BanjoRecompiled" }),
  "k-zelda": install({ version: "v1.2.0", folder: "Zelda64" }),
  "k-dk": install({ folder: "DK64" }),
  "k-new": install({ folder: "NewGame" }),
  "local:mine": install({ local: true, folder: "Mine" }),
};

const base = {
  v3: library,
  libraryIds: ["k-banjo", "k-zelda", "k-dk", "k-new", "local:mine"],
  installs,
  appsDir: "C:\\Users\\Me\\AppData\\Roaming\\com.quiverlauncher.app\\apps",
  repos,
  busy: () => false,
  sep: "\\",
};

describe("plan", () => {
  const p = plan(base);

  test("a game imported from Quiver 3 is already shared, and Quiver 3 gets the newer version Quiver 4 installed", () => {
    expect(p.shared).toEqual(["k-banjo"]);
    expect(p.versions).toEqual([{ id: "k-banjo", dir: "q:\\n64\\banjo", version: "v1.1.0", to: "folder" }]);
  });

  test("Quiver 3's newer version goes into Quiver 4's record instead", () => {
    const older = plan({ ...base, installs: { ...installs, "k-banjo": install({ dir: "Q:\\N64\\Banjo", version: "v1.0.0" }) } });
    expect(older.versions).toEqual([{ id: "k-banjo", dir: "Q:\\N64\\Banjo", version: "v1.0.2", to: "record" }]);
  });

  test("games in Quiver 4's own folder move, under Quiver 3's folder name when it has one", () => {
    expect(p.moves).toEqual([
      { id: "k-dk", from: `${base.appsDir}\\DK64`, folder: "DK64" },
      { id: "k-new", from: `${base.appsDir}\\NewGame`, folder: "NewGame" },
    ]);
  });

  test("a game both launchers installed keeps the newer copy", () => {
    expect(p.duplicates).toEqual([
      { id: "k-zelda", v4Dir: `${base.appsDir}\\Zelda64`, v4Version: "v1.2.0", v3Dir: "E:\\QuiverLauncher\\Apps\\Zelda64", v3Version: "v1.1.0", keep: "v4" },
    ]);
    const v3Newer = plan({ ...base, installs: { ...installs, "k-zelda": install({ version: "v1.0.0", folder: "Zelda64" }) } });
    expect(v3Newer.duplicates[0].keep).toBe("v3");
  });

  test("games only Quiver 3 installed come over, matched by catalog id or repository; custom apps by their repository", () => {
    expect(p.bringOver.map((b) => b.id)).toEqual(["k-mario", "github:me/homebrew"]);
    expect(p.notInCatalog).toEqual(["Manual"]);
  });

  test("the player's own files are never touched", () => {
    const all = [...p.shared, ...p.moves.map((m) => m.id), ...p.duplicates.map((d) => d.id), ...p.addToV3.map((a) => a.id)];
    expect(all).not.toContain("local:mine");
  });

  test("a game Quiver 4 keeps outside its folder but Quiver 3 doesn't list is added to Quiver 3's list", () => {
    const outside = plan({ ...base, installs: { ...installs, "k-new": install({ dir: "D:\\Games\\New", folder: "NewGame" }) } });
    expect(outside.addToV3).toEqual([{ id: "k-new", dir: "D:\\Games\\New" }]);
  });

  test("a game downloading now is left for later", () => {
    const busy = plan({ ...base, busy: (id) => id === "k-dk" });
    expect(busy.busy).toEqual(["k-dk"]);
    expect(busy.moves.map((m) => m.id)).toEqual(["k-new"]);
  });

  test("the preview says what will happen, and nothing when there's nothing", () => {
    expect(previewLines(p, "E:\\QuiverLauncher\\Apps")).toEqual([
      "1 game is already in Quiver 3's folders",
      "2 games to move into E:\\QuiverLauncher\\Apps",
      "1 game is installed twice: the newer copy is kept, and the other goes to the Recycle Bin",
      "2 games from Quiver 3 to add to your library",
      "1 version number to bring up to date",
      "1 Quiver 3 game isn't in the catalog, so it stays in Quiver 3 only",
    ]);
    const empty = plan({ ...base, v3: { ...library, entries: [] }, libraryIds: [], installs: {} });
    expect(planIsEmpty(empty)).toBe(true);
    expect(previewLines(empty, "X")).toEqual([]);
  });
});

describe("helpers", () => {
  test("versions compare by their numbers", () => {
    expect(compareVersions("v1.10.0", "v1.9.9")).toBe(1);
    expect(compareVersions("1.0", "v1.0.0")).toBe(0);
    expect(compareVersions("v0.9", "v1")).toBe(-1);
  });

  test("Windows paths compare without case or a trailing separator", () => {
    expect(samePath("Q:\\N64\\Banjo\\", "q:\\n64\\banjo")).toBe(true);
    expect(samePath("/a/B", "/a/b", false)).toBe(false);
  });

  test("custom apps match by repository; catalog games by id first", () => {
    expect(matchFor("github:me/homebrew", { provider: "github", repository: "me/homebrew" })).toEqual({ repository: "me/homebrew", provider: "github" });
    expect(matchFor("k-banjo", repos.byId.get("k-banjo"))).toEqual({ catalogEntryId: "k-banjo", repository: "BanjoRecomp/BanjoRecomp", provider: "github" });
    expect(findV3(library.entries, "k-mario", repos.byId.get("k-mario"))?.name).toBe("Paper Mario");
    expect(idForV3(library.entries[4], repos)).toBeNull();
  });

  test("a new Quiver 3 entry has only fields Quiver 3 reads, in the shapes it checks", () => {
    const entry = {
      id: "k-new",
      slug: "new",
      name: "New Game",
      projectName: "New: Recompiled",
      artwork: "https://x/icon.png",
      tags: ["n64", "recomp"],
      launcher: { folderName: "NewGame", filesToAdd: ["portable.txt"], releaseAssetFilter: "" },
    } as unknown as Entry;
    expect(v3EntryFor(entry, { provider: "github", repository: "New/Game" }, "NewGame", false)).toEqual({
      name: "New Game",
      folderName: "NewGame",
      appIconUrl: "https://x/icon.png",
      repository: "New/Game",
      preferredVersion: null,
      skippedUpdateVersion: null,
      project: "New: Recompiled",
      tags: ["n64", "recomp"],
      catalogEntryId: "k-new",
      catalog: { name: "New Game", project: "New: Recompiled", appIconUrl: "https://x/icon.png", tags: ["n64", "recomp"] },
      filesToAdd: ["portable.txt"],
    });
    const custom = v3EntryFor(entry, { provider: "gitlab", repository: "me/x" }, "X", true);
    expect(custom.repositorySource).toBe("gitlab");
    expect(custom.catalogEntryId).toBeUndefined();
  });
});
