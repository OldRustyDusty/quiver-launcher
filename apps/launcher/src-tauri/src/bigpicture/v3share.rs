//! "Use the same games folder as Quiver 3" (docs/bigpicture/PLAN-v4.md §12).
//!
//! Quiver Launcher 3 keeps its library in `apps.json`, and each game's installed
//! version in a `version.txt` inside the game's folder. With the setting on, Big
//! Quiver installs games into 3's games folder, moves the ones it put in its own
//! folder there, and keeps `apps.json` and `version.txt` up to date, so both
//! launchers see the same games in the same folders.
//!
//! `apps.json` is written the way 3 writes it (`Services/LibraryFileStore.cs` on
//! upstream `main`): under its lock file, never while 3 is open, with a backup in
//! 3's own `Backups/apps` (named by the SHA-256 of the content, as 3 names them),
//! and atomically. Fields Big Quiver doesn't know are kept as they are.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use sysinfo::System;
use tauri::{AppHandle, Emitter};

use crate::install::{plain_name, VERSION_FILE};

/// 3's own version file, in each game's folder.
const V3_VERSION_FILE: &str = "version.txt";

/// Where 3 keeps `apps.json`, as upstream's import looks for it (`v3.rs`), plus a moved or portable 3.
fn roots() -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let home = env("HOME").or_else(|| env("USERPROFILE"));
    [
        env("QUIVER_V3_DATA"),
        env("LOCALAPPDATA").map(|d| d.join("QuiverLauncher")),
        env("XDG_DATA_HOME").map(|d| d.join("QuiverLauncher")),
        home.as_ref().map(|h| h.join(".local/share/QuiverLauncher")),
        home.as_ref().map(|h| h.join("Library/Application Support/QuiverLauncher")),
    ]
    .into_iter()
    .flatten()
    .chain(super::v3::velopack_dirs())
    .collect()
}

fn find_root() -> Option<PathBuf> {
    roots().into_iter().find(|d| d.join("apps.json").is_file())
}

/// A field by name in any letter case (3 wrote both camelCase and PascalCase).
fn field<'a>(v: &'a Value, name: &str) -> Option<&'a str> {
    v.as_object()?.iter().find(|(k, _)| k.eq_ignore_ascii_case(name))?.1.as_str().filter(|s| !s.trim().is_empty())
}

/// 3's games folder: its settings' `AppsPath`, or `Apps` beside `apps.json`.
fn games_dir(root: &Path) -> PathBuf {
    fs::read(root.join("settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(strip_bom(&b)).ok())
        .and_then(|s| field(&s, "appsPath").map(PathBuf::from))
        .unwrap_or_else(|| root.join("Apps"))
}

fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct V3Entry {
    pub name: String,
    pub folder_name: Option<String>,
    pub repository: Option<String>,
    /// `github` unless the entry says otherwise.
    pub provider: String,
    pub catalog_entry_id: Option<String>,
    /// The game's folder, when it's there.
    pub dir: Option<String>,
    /// From the folder's `version.txt`.
    pub version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct V3Library {
    pub root: String,
    pub games_dir: String,
    /// 3 is open: `apps.json` waits until it closes.
    pub running: bool,
    pub entries: Vec<V3Entry>,
}

fn entries(doc: &Value, games: &Path) -> Vec<V3Entry> {
    let list = doc.as_object().and_then(|o| o.iter().find(|(k, _)| k.eq_ignore_ascii_case("apps"))).map(|(_, v)| v);
    list.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|app| {
            let name = field(app, "name")?.to_string();
            let dir = field(app, "installPath")
                .map(PathBuf::from)
                .or_else(|| field(app, "folderName").map(|f| games.join(f)))
                .filter(|d| d.is_dir());
            Some(V3Entry {
                name,
                folder_name: field(app, "folderName").map(str::to_string),
                repository: field(app, "repository").map(str::to_string),
                provider: field(app, "repositorySource").unwrap_or("github").to_lowercase(),
                catalog_entry_id: field(app, "catalogEntryId").map(str::to_string),
                version: dir.as_ref().and_then(|d| fs::read_to_string(d.join(V3_VERSION_FILE)).ok()).map(|v| v.trim().to_string()).filter(|v| !v.is_empty()),
                dir: dir.map(|d| d.to_string_lossy().into()),
            })
        })
        .collect()
}

/// Whether 3 is open: a program running from its folder.
fn running(root: &Path) -> bool {
    let mut system = System::new();
    super::session::running_from(&mut system, root)
}

/// Quiver 3's library on this computer, or None when there's none.
#[tauri::command]
pub fn bp_v3_library() -> Option<V3Library> {
    let root = find_root()?;
    let doc = serde_json::from_slice::<Value>(strip_bom(&fs::read(root.join("apps.json")).ok()?)).ok()?;
    let games = games_dir(&root);
    Some(V3Library {
        running: running(&root),
        entries: entries(&doc, &games),
        games_dir: games.to_string_lossy().into(),
        root: root.to_string_lossy().into(),
    })
}

/// Which entry a change is for: the catalog's id when both have one, else the repository,
/// else (an app of the player's own, with no repository) its folder.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct V3Match {
    pub catalog_entry_id: Option<String>,
    pub repository: Option<String>,
    pub provider: String,
    #[serde(default)]
    pub install_path: Option<String>,
}

impl V3Match {
    fn matches(&self, app: &Value) -> bool {
        if let (Some(id), Some(theirs)) = (&self.catalog_entry_id, field(app, "catalogEntryId")) {
            return id == theirs;
        }
        let provider = field(app, "repositorySource").unwrap_or("github");
        match (&self.repository, field(app, "repository")) {
            (Some(ours), Some(theirs)) => ours.eq_ignore_ascii_case(theirs) && self.provider.eq_ignore_ascii_case(provider),
            (None, None) => match (&self.install_path, field(app, "installPath")) {
                (Some(ours), Some(theirs)) => same_path(ours, theirs),
                _ => false,
            },
            _ => false,
        }
    }
}

#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum V3Change {
    /// The game is in this folder: an existing entry gets the folder, else `entry` is added.
    Upsert { r#match: V3Match, install_path: String, entry: Map<String, Value> },
    /// The game was uninstalled from this folder: its entry goes, unless it points somewhere else.
    Remove { r#match: V3Match, install_path: String },
}

/// Paths compare without a trailing separator, and without regard to case on Windows.
fn same_path(a: &str, b: &str) -> bool {
    let trim = |p: &str| p.trim_end_matches(['\\', '/']).to_string();
    if cfg!(windows) {
        trim(a).eq_ignore_ascii_case(&trim(b))
    } else {
        trim(a) == trim(b)
    }
}

/// 3 checks the shape of every entry when it loads (`ValidateLocalAppShape`) and refuses
/// the whole library if one is wrong, so a new entry is checked the same way first.
fn valid_entry(entry: &Map<String, Value>) -> bool {
    let strings = |v: Option<&Value>| match v {
        None | Some(Value::Null) => true,
        Some(Value::Array(items)) => items.iter().all(Value::is_string),
        _ => false,
    };
    entry.get("name").is_some_and(Value::is_string)
        && strings(entry.get("tags"))
        && strings(entry.get("filesToAdd"))
        && !entry.contains_key("mods")
        && entry.get("autoUpdate").is_none_or(|v| v.is_boolean() || v.is_null())
}

/// The changes applied to `apps.json`'s document. Returns whether anything changed.
fn apply(doc: &mut Value, changes: &[V3Change]) -> Result<bool, String> {
    let apps = doc
        .as_object_mut()
        .and_then(|o| o.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case("apps")).map(|(_, v)| v))
        .and_then(Value::as_array_mut)
        .ok_or("Quiver 3's library isn't in a form Big Quiver knows, so it wasn't changed.")?;
    let mut changed = false;
    for change in changes {
        match change {
            V3Change::Upsert { r#match, install_path, entry } => {
                if let Some(app) = apps.iter_mut().find(|a| r#match.matches(a)) {
                    let object = app.as_object_mut().ok_or("A Quiver 3 library entry isn't an object.")?;
                    let key = object.keys().find(|k| k.eq_ignore_ascii_case("installPath")).cloned().unwrap_or("installPath".into());
                    if object.get(&key).and_then(Value::as_str).is_none_or(|p| !same_path(p, install_path)) {
                        object.insert(key, Value::String(install_path.clone()));
                        changed = true;
                    }
                } else {
                    if !valid_entry(entry) {
                        return Err("A new Quiver 3 library entry wasn't in the form Quiver 3 reads, so nothing was changed.".into());
                    }
                    let mut entry = entry.clone();
                    entry.insert("installPath".into(), Value::String(install_path.clone()));
                    apps.push(Value::Object(entry));
                    changed = true;
                }
            }
            V3Change::Remove { r#match, install_path } => {
                let before = apps.len();
                apps.retain(|a| !(r#match.matches(a) && field(a, "installPath").is_some_and(|p| same_path(p, install_path))));
                changed |= apps.len() != before;
            }
        }
    }
    Ok(changed)
}

/// 3's lock on `apps.json`: held while reading and writing, as 3 does. Never deleted.
struct Lock(#[allow(dead_code)] fs::File);

fn lock(path: &Path) -> Result<Lock, String> {
    let lock = path.with_extension("json.lock");
    let started = Instant::now();
    loop {
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        match options.open(&lock) {
            Ok(file) => return Ok(Lock(file)),
            Err(_) if started.elapsed() < Duration::from_secs(5) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(format!("Quiver 3's library is busy ({e}).")),
        }
    }
}

/// A copy in 3's own backups folder, named by its content's SHA-256 as 3 names them.
fn backup(root: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = root.join("Backups").join("apps");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!("{:X}.json", Sha256::digest(bytes));
    let path = dir.join(name);
    if !path.exists() {
        write_atomic(&path, bytes)?;
    }
    Ok(path)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temp, bytes).and_then(|_| fs::rename(&temp, path)).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e.to_string()
    })
}

/// Pretty JSON with two-space indents, as 3 writes it.
fn to_bytes(doc: &Value) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(doc).map_err(|e| e.to_string())
}

/// Applies changes to Quiver 3's `apps.json`. Refuses while 3 is open, as 3 would
/// save its own copy over them. Resolves to the backup of the library as it was.
#[tauri::command]
pub async fn bp_v3_write(changes: Vec<V3Change>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = find_root().ok_or("Quiver 3's library wasn't found.")?;
        if running(&root) {
            return Err("Quiver 3 is open.".into());
        }
        let path = root.join("apps.json");
        let _lock = lock(&path)?;
        let before = fs::read(&path).map_err(|e| e.to_string())?;
        let mut doc: Value = serde_json::from_slice(strip_bom(&before)).map_err(|_| "Quiver 3's library couldn't be read, so it wasn't changed.".to_string())?;
        if !apply(&mut doc, &changes)? {
            return Ok(None);
        }
        let saved = backup(&root, &before)?;
        let after = to_bytes(&doc)?;
        backup(&root, &after)?;
        write_atomic(&path, &after)?;
        Ok(Some(saved.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What's in a folder Big Quiver might install into or move to.
#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DirState {
    /// Not there, or empty.
    Free,
    /// A Quiver 4 install.
    Ours,
    /// A Quiver 3 install.
    V3,
    /// Someone else's files.
    Other,
}

fn dir_state(dir: &Path) -> DirState {
    let Ok(mut entries) = fs::read_dir(dir) else { return DirState::Free };
    if entries.next().is_none() {
        DirState::Free
    } else if dir.join(VERSION_FILE).is_file() {
        DirState::Ours
    } else if dir.join(V3_VERSION_FILE).is_file() {
        DirState::V3
    } else {
        DirState::Other
    }
}

/// The folder a game would get in 3's games folder, and what's there now.
#[tauri::command]
pub fn bp_game_dir(games_dir: String, folder: String) -> Result<(String, DirState), String> {
    let dir = PathBuf::from(games_dir).join(plain_name(&folder)?);
    let state = dir_state(&dir);
    Ok((dir.to_string_lossy().into(), state))
}

/// Writes the installed version where both launchers read it: Quiver 4's
/// `.quiver-version` and 3's `version.txt`. Only into a game's folder.
#[tauri::command]
pub fn bp_write_versions(dir: String, version: String) -> Result<(), String> {
    let dir = PathBuf::from(dir);
    if !matches!(dir_state(&dir), DirState::Ours | DirState::V3) {
        return Err("That folder isn't a game's folder.".into());
    }
    fs::write(dir.join(VERSION_FILE), &version).and_then(|_| fs::write(dir.join(V3_VERSION_FILE), &version)).map_err(|e| e.to_string())
}

/// Sends a game's folder to the Recycle Bin: only one either launcher installed.
#[tauri::command]
pub async fn bp_trash_game(dir: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = PathBuf::from(dir);
        match dir_state(&dir) {
            DirState::Free => Ok(()),
            DirState::Ours | DirState::V3 => trash::delete(&dir).map_err(|e| e.to_string()),
            DirState::Other => Err("That folder isn't a game's folder, so it was left alone.".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MoveProgress {
    id: String,
    done: u64,
    total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved {
    /// False when the original couldn't go to the Recycle Bin and is still there.
    trashed: bool,
}

/// Every file under `dir`, with its size, relative to `dir`.
fn files(dir: &Path) -> std::io::Result<Vec<(PathBuf, u64)>> {
    let mut out = Vec::new();
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        for entry in fs::read_dir(dir.join(&rel))? {
            let entry = entry?;
            let kind = entry.file_type()?;
            let path = rel.join(entry.file_name());
            if kind.is_dir() {
                stack.push(path);
            } else {
                out.push((path, entry.metadata()?.len()));
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Free space on the drive that holds `dir` (or the nearest folder above it that exists).
fn free_space(dir: &Path) -> Option<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let target = dir.ancestors().find(|d| d.exists())?.canonicalize().ok()?;
    disks
        .list()
        .iter()
        .filter(|d| target.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space())
}

/// `owned`: a folder Quiver made in its own apps folder (an app the player fills), which has no version file.
fn move_game(from: &Path, to: &Path, rename: bool, owned: bool, progress: impl Fn(u64, u64)) -> Result<Moved, String> {
    if dir_state(from) != DirState::Ours && !owned {
        return Err("That game's folder isn't one Quiver installed, so it wasn't moved.".into());
    }
    if dir_state(to) != DirState::Free {
        return Err(format!("{} already has files in it.", to.display()));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // An empty folder in the way (Free) is fine to replace.
    let _ = fs::remove_dir(to);
    // Same drive: renaming moves it at once, and either happens or doesn't.
    if rename && fs::rename(from, to).is_ok() {
        return Ok(Moved { trashed: true });
    }
    let list = files(from).map_err(|e| e.to_string())?;
    let total: u64 = list.iter().map(|(_, size)| size).sum();
    if free_space(to).is_some_and(|free| free < total + total / 50) {
        return Err(format!("There isn't enough free space on that drive ({} MB needed).", total / 1_000_000 + 1));
    }
    // Copied beside the target first: nothing points at a half-copied folder, and the original stays until the copy is checked.
    let name = to.file_name().ok_or("No folder name.")?.to_string_lossy();
    let temp = to.with_file_name(format!(".{name}.quiver-moving"));
    let _ = fs::remove_dir_all(&temp);
    let copy = || -> Result<(), String> {
        let mut done = 0;
        let mut last = Instant::now();
        for (rel, size) in &list {
            let target = temp.join(rel);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(from.join(rel), &target).map_err(|e| format!("{}: {e}", rel.display()))?;
            done += size;
            if last.elapsed() > Duration::from_millis(100) {
                progress(done, total);
                last = Instant::now();
            }
        }
        progress(total, total);
        if files(&temp).map_err(|e| e.to_string())? != list {
            return Err("The copy didn't match the original, so the game wasn't moved.".into());
        }
        fs::rename(&temp, to).map_err(|e| e.to_string())
    };
    if let Err(e) = copy() {
        let _ = fs::remove_dir_all(&temp);
        return Err(e);
    }
    Ok(Moved { trashed: trash::delete(from).is_ok() })
}

/// Moves a game Quiver 4 installed into another folder (3's games folder). The
/// original goes to the Recycle Bin once the copy is checked. Progress comes as
/// `bp-move-progress` events.
#[tauri::command]
pub async fn bp_move_game(app: AppHandle, data: tauri::State<'_, super::Data>, id: String, from: String, to: String) -> Result<Moved, String> {
    // Only a folder right inside Quiver 4's own apps folder counts as Quiver's without a version file.
    let apps = data.apps();
    let owned = Path::new(&from).parent().is_some_and(|parent| same_path(&parent.to_string_lossy(), &apps.to_string_lossy()));
    tauri::async_runtime::spawn_blocking(move || {
        // A running game's files are locked: the copy would work but the original couldn't go, leaving two.
        if running(Path::new(&from)) {
            return Err("It's running. Close it, and it'll be moved next time.".into());
        }
        move_game(Path::new(&from), Path::new(&to), true, owned, |done, total| {
            let _ = app.emit("bp-move-progress", MoveProgress { id: id.clone(), done, total });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A new folder in Quiver 3's games folder for an app the player fills themselves, opened for them.
/// Never one that's already there with files in it: it could be another app's.
#[tauri::command]
pub fn bp_make_folder(games_dir: String, name: String) -> Result<String, String> {
    let dir = PathBuf::from(games_dir).join(plain_name(&name)?);
    if dir_state(&dir) != DirState::Free {
        return Err(format!("There's already a folder named {name} in your Quiver 3 games folder. Choose another name."));
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    if std::env::var_os("QUIVER_OPENED").is_none() {
        let _ = open::that_detached(&dir);
    }
    Ok(dir.to_string_lossy().into())
}

/// Whether the desktop has a shortcut with this game's name (as upstream's Desktop shortcut names it).
#[tauri::command]
pub fn bp_has_desktop_shortcut(name: String) -> bool {
    let Some(desktop) = dirs::desktop_dir().or_else(|| dirs::home_dir().map(|h| h.join("Desktop"))) else { return false };
    let ext = if cfg!(windows) { "lnk" } else { "desktop" };
    desktop.join(format!("{}.{ext}", crate::shortcut::file_name(&name))).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bq-v3share-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn library() -> Value {
        json!({ "apps": [
            { "name": "Banjo-Kazooie", "folderName": "BanjoKazooie-BanjoRecompiled", "installPath": "Q:\\N64\\Banjo\\",
              "repository": "BanjoRecomp/BanjoRecomp", "catalogEntryId": "k1", "mods": { "path": "mods" }, "tags": ["n64"] },
            { "name": "Old", "folderName": "Old", "installPath": null, "repository": "Someone/Old" }
        ]})
    }

    fn m(id: Option<&str>, repo: &str) -> V3Match {
        V3Match { catalog_entry_id: id.map(str::to_string), repository: Some(repo.into()), provider: "github".into(), install_path: None }
    }

    #[test]
    fn an_existing_entry_only_gets_its_folder_and_keeps_everything_else() {
        let mut doc = library();
        let change = V3Change::Upsert { r#match: m(Some("k1"), "x/x"), install_path: "E:\\Apps\\Banjo\\".into(), entry: Map::new() };
        assert!(apply(&mut doc, &[change]).unwrap());
        let banjo = &doc["apps"][0];
        assert_eq!(banjo["installPath"], "E:\\Apps\\Banjo\\");
        assert_eq!(banjo["mods"]["path"], "mods");
        assert_eq!(banjo["tags"][0], "n64");
        assert_eq!(doc["apps"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn the_same_folder_again_changes_nothing() {
        let mut doc = library();
        let change = V3Change::Upsert { r#match: m(Some("k1"), ""), install_path: "q:\\n64\\banjo".into(), entry: Map::new() };
        assert_eq!(apply(&mut doc, &[change]).unwrap(), cfg!(not(windows)));
    }

    #[test]
    fn a_new_game_is_added_when_its_entry_is_in_the_form_quiver_3_reads() {
        let mut doc = library();
        let entry = json!({ "name": "Zelda", "folderName": "Zelda", "repository": "Z/Z", "tags": ["n64"], "filesToAdd": ["portable.txt"] });
        let change = V3Change::Upsert { r#match: m(Some("k2"), "Z/Z"), install_path: "E:\\Apps\\Zelda\\".into(), entry: entry.as_object().unwrap().clone() };
        assert!(apply(&mut doc, &[change]).unwrap());
        assert_eq!(doc["apps"][2]["installPath"], "E:\\Apps\\Zelda\\");

        let bad = json!({ "name": "Bad", "tags": "n64" });
        let change = V3Change::Upsert { r#match: m(None, "B/B"), install_path: "E:\\B".into(), entry: bad.as_object().unwrap().clone() };
        assert!(apply(&mut library(), &[change]).is_err());
    }

    #[test]
    fn games_match_by_repository_when_either_has_no_catalog_id() {
        let mut doc = library();
        let change = V3Change::Upsert { r#match: m(None, "someone/old"), install_path: "E:\\Apps\\Old".into(), entry: Map::new() };
        assert!(apply(&mut doc, &[change]).unwrap());
        assert_eq!(doc["apps"][1]["installPath"], "E:\\Apps\\Old");
        assert_eq!(doc["apps"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn uninstalling_removes_the_entry_only_when_it_points_at_that_folder() {
        let mut doc = library();
        let elsewhere = V3Change::Remove { r#match: m(Some("k1"), ""), install_path: "C:\\Somewhere".into() };
        assert!(!apply(&mut doc, &[elsewhere]).unwrap());
        let here = V3Change::Remove { r#match: m(Some("k1"), ""), install_path: "Q:\\N64\\Banjo".into() };
        assert!(apply(&mut doc, &[here]).unwrap());
        assert_eq!(doc["apps"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn changes_read_as_the_ui_sends_them() {
        let sent = json!([
            { "kind": "upsert", "match": { "catalogEntryId": "k1", "repository": "A/B", "provider": "github" }, "installPath": "E:/G/", "entry": { "name": "G" } },
            { "kind": "remove", "match": { "provider": "github", "repository": "A/B" }, "installPath": "E:/G" }
        ]);
        let changes: Vec<V3Change> = serde_json::from_value(sent).unwrap();
        assert!(matches!(&changes[0], V3Change::Upsert { install_path, .. } if install_path == "E:/G/"));
        assert!(matches!(&changes[1], V3Change::Remove { r#match, .. } if r#match.catalog_entry_id.is_none()));
    }

    #[test]
    fn a_library_without_apps_is_left_alone() {
        assert!(apply(&mut json!({ "standard": [] }), &[]).is_err());
    }

    #[test]
    fn reads_entries_and_their_versions_from_version_txt() {
        let dir = temp("read");
        let games = dir.join("Apps");
        fs::create_dir_all(games.join("Old")).unwrap();
        fs::write(games.join("Old").join("version.txt"), "v1.2\n").unwrap();
        let found = entries(&library(), &games);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].dir, None, "Q: isn't there");
        assert_eq!(found[1].version.as_deref(), Some("v1.2"));
        assert_eq!(found[1].dir.as_deref(), Some(games.join("Old").to_string_lossy().as_ref()));
        assert_eq!(found[0].catalog_entry_id.as_deref(), Some("k1"));
    }

    #[test]
    fn folders_say_whose_they_are() {
        let dir = temp("state");
        assert_eq!(dir_state(&dir.join("missing")), DirState::Free);
        assert_eq!(dir_state(&dir), DirState::Free);
        fs::write(dir.join("readme.txt"), "").unwrap();
        assert_eq!(dir_state(&dir), DirState::Other);
        fs::write(dir.join("version.txt"), "v1").unwrap();
        assert_eq!(dir_state(&dir), DirState::V3);
        fs::write(dir.join(VERSION_FILE), "v1").unwrap();
        assert_eq!(dir_state(&dir), DirState::Ours);
    }

    #[test]
    fn a_move_takes_every_file_and_never_lands_on_another_folder() {
        let dir = temp("move");
        let from = dir.join("apps").join("Game");
        fs::create_dir_all(from.join("saves")).unwrap();
        fs::write(from.join(VERSION_FILE), "v1").unwrap();
        fs::write(from.join("game.exe"), vec![7u8; 4096]).unwrap();
        fs::write(from.join("saves").join("slot1"), "save").unwrap();
        let before = files(&from).unwrap();

        let busy = dir.join("Games").join("Busy");
        fs::create_dir_all(&busy).unwrap();
        fs::write(busy.join("mine.txt"), "").unwrap();
        assert!(move_game(&from, &busy, true, false, |_, _| {}).is_err());
        assert!(from.join("game.exe").is_file(), "nothing moved");

        // Copied, as across drives (a rename can't be), then the original goes to the Recycle Bin.
        let to = dir.join("Games").join("Game");
        let steps = std::cell::RefCell::new(Vec::new());
        move_game(&from, &to, false, false, |done, total| steps.borrow_mut().push((done, total))).unwrap();
        assert_eq!(files(&to).unwrap(), before);
        assert_eq!(steps.borrow().last(), Some(&(4102, 4102)));
        assert!(!dir.join("Games").join(".Game.quiver-moving").exists());

        // On one drive, a rename.
        let back = dir.join("apps").join("Again");
        move_game(&to, &back, true, false, |_, _| {}).unwrap();
        assert_eq!(files(&back).unwrap(), before);
        assert!(!to.exists());
    }

    #[test]
    fn only_a_quiver_install_is_moved() {
        let dir = temp("notours");
        let from = dir.join("Mine");
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("file"), "").unwrap();
        assert!(move_game(&from, &dir.join("To"), false, false, |_, _| {}).is_err());
        assert!(from.join("file").is_file());
        // A folder Quiver made for the player to fill (the command checks it's in Quiver's own apps folder).
        move_game(&from, &dir.join("To"), false, true, |_, _| {}).unwrap();
        assert!(dir.join("To").join("file").is_file());
    }

    #[test]
    fn apps_of_the_players_own_match_by_folder() {
        let mut doc = json!({ "apps": [
            { "name": "Mine", "folderName": "Mine", "installPath": "E:\\Apps\\Mine\\" },
            { "name": "Repo", "folderName": "Repo", "installPath": "E:\\Apps\\Mine\\", "repository": "a/b" }
        ]});
        let here = V3Match { catalog_entry_id: None, repository: None, provider: "github".into(), install_path: Some("e:/apps/mine".replace('/', "\\")) };
        let gone = V3Change::Remove { r#match: here.clone(), install_path: "E:\\Apps\\Mine".into() };
        assert!(apply(&mut doc, &[gone]).unwrap());
        assert_eq!(doc["apps"].as_array().unwrap().len(), 1, "only the app without a repository");
        assert_eq!(doc["apps"][0]["name"], "Repo");
        let back = V3Change::Upsert { r#match: here, install_path: "E:\\Apps\\Mine\\".into(), entry: json!({ "name": "Mine", "folderName": "Mine", "appIconUrl": null }).as_object().unwrap().clone() };
        assert!(apply(&mut doc, &[back]).unwrap());
        assert_eq!(doc["apps"][1]["name"], "Mine");
    }

    #[test]
    fn versions_are_written_only_into_a_game_folder() {
        let dir = temp("versions");
        assert!(bp_write_versions(dir.to_string_lossy().into(), "v2".into()).is_err());
        fs::write(dir.join("version.txt"), "v1").unwrap();
        bp_write_versions(dir.to_string_lossy().into(), "v2".into()).unwrap();
        assert_eq!(fs::read_to_string(dir.join("version.txt")).unwrap(), "v2");
        assert_eq!(fs::read_to_string(dir.join(VERSION_FILE)).unwrap(), "v2");
    }

    /// Against a copy of a real Quiver 3 library: `BQ_V3_SAMPLE=<copy of apps.json> cargo test -- --ignored real_library`.
    /// Every entry Big Quiver didn't touch comes back exactly as it was.
    #[test]
    #[ignore]
    fn real_library_round_trip() {
        let path = PathBuf::from(std::env::var("BQ_V3_SAMPLE").expect("BQ_V3_SAMPLE"));
        let before: Value = serde_json::from_slice(strip_bom(&fs::read(&path).unwrap())).unwrap();
        let mut doc = before.clone();
        let first = &before["apps"][0];
        let existing = V3Change::Upsert {
            r#match: V3Match { catalog_entry_id: field(first, "catalogEntryId").map(str::to_string), repository: field(first, "repository").map(str::to_string), provider: "github".into(), install_path: None },
            install_path: "E:/Moved/Here/".into(),
            entry: Map::new(),
        };
        let added = json!({ "name": "New", "folderName": "New", "repository": "new/new", "tags": ["n64"], "catalogEntryId": "k-new" });
        let new = V3Change::Upsert { r#match: m(Some("k-new"), "new/new"), install_path: "E:/Apps/New/".into(), entry: added.as_object().unwrap().clone() };
        assert!(apply(&mut doc, &[existing, new]).unwrap());
        let (was, now) = (before["apps"].as_array().unwrap(), doc["apps"].as_array().unwrap());
        assert_eq!(now.len(), was.len() + 1);
        assert_eq!(now[0]["installPath"], "E:/Moved/Here/");
        let mut first_rest = now[0].clone();
        first_rest["installPath"] = was[0]["installPath"].clone();
        assert_eq!(first_rest, was[0], "only the folder changed");
        assert_eq!(&now[1..was.len()], &was[1..], "every other entry exactly as it was");
        // Written and read back as Quiver 3 would read it.
        let reread: Value = serde_json::from_slice(&to_bytes(&doc).unwrap()).unwrap();
        assert_eq!(reread, doc);
        for app in now {
            assert!(valid_entry(app.as_object().unwrap()) || app.get("mods").is_some(), "{app}");
        }
    }

    #[test]
    fn backups_are_named_by_their_content_as_quiver_3_names_them() {
        let dir = temp("backup");
        let path = backup(&dir, b"{\"apps\":[]}").unwrap();
        assert_eq!(path.parent().unwrap(), dir.join("Backups").join("apps"));
        let name = path.file_stem().unwrap().to_string_lossy().to_string();
        assert_eq!(name.len(), 64);
        assert_eq!(name, name.to_uppercase());
    }
}
