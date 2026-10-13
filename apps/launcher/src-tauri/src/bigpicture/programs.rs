//! Which program starts a game, when the catalog doesn't name one for this
//! computer (Linux, macOS). Upstream then takes the first program it finds,
//! which can be a tool beside the game: Star Fox Enhanced's Linux build has
//! starfox_asset_builder before starfox_pc. The page asks the player instead.
use serde::Serialize;
use std::path::Path;
use tauri::State;

use crate::install::{app_files, is_program};
use crate::Data;

#[derive(Serialize)]
pub struct Programs {
    /// The file name of the first program matching the hints, if any.
    matched: Option<String>,
    /// Every program in the folder, relative to it, shallowest first.
    choices: Vec<String>,
}

#[tauri::command]
pub fn bp_programs(data: State<Data>, folder: String, dir: Option<String>, hints: Vec<String>) -> Result<Programs, String> {
    let dir = crate::app_dir(&data, &folder, dir)?;
    Ok(programs(&dir, &hints, crate::OS))
}

fn programs(dir: &Path, hints: &[String], os: &str) -> Programs {
    let found: Vec<_> = app_files(dir).into_iter().filter(|p| is_program(p, os)).collect();
    let name = |p: &Path| p.file_name().map(|n| n.to_string_lossy().into_owned());
    let matched = crate::install::preferred_file(&found, hints).and_then(|p| name(&p));
    let choices = found.iter().filter_map(|p| p.strip_prefix(dir).ok()).map(|p| p.to_string_lossy().into_owned()).collect();
    Programs { matched, choices }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn folder(files: &[(&str, bool)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (name, runs) in files {
            let path = dir.path().join(name);
            std::fs::write(&path, b"x").unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(if *runs { 0o755 } else { 0o644 })).unwrap();
        }
        dir
    }

    #[test]
    fn the_windows_name_without_exe_finds_the_linux_program() {
        let dir = folder(&[("starfox_asset_builder", true), ("starfox_pc", true), ("README.md", false)]);
        let found = programs(dir.path(), &["starfox_pc".into()], "linux");
        assert_eq!(found.matched.as_deref(), Some("starfox_pc"));
        assert_eq!(found.choices, ["starfox_asset_builder", "starfox_pc"]);
    }

    #[test]
    fn a_hint_matching_only_a_file_that_isnt_a_program_matches_nothing() {
        let dir = folder(&[("game", false), ("game_tool", true), ("game_bin", true)]);
        let found = programs(dir.path(), &["game".into()], "linux");
        assert_eq!(found.matched, None);
        assert_eq!(found.choices.len(), 2);
    }
}
