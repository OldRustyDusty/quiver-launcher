//! Which program starts a game, when the catalog doesn't name one for this
//! computer. Upstream then takes the first program it finds, which can be a
//! tool beside the game: Star Fox Enhanced's Linux build has
//! starfox_asset_builder before starfox_pc. The page asks the player instead.
//!
//! On Windows it asks only when upstream would be guessing: several programs
//! side by side at the shallowest level that has any. Bloodborne's Windows port
//! has five in out\ (bb-gpu-capabilities.exe first) and is started by
//! launch_gui.bat, so scripts (.bat, .cmd) are offered there too.
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
    /// A Flatpak bundle in the folder, which needs installing with Flatpak.
    flatpak: Option<String>,
    /// Windows: several programs at the shallowest level, so upstream's pick is a guess.
    unsure: bool,
}

#[tauri::command]
pub fn bp_programs(data: State<Data>, folder: String, dir: Option<String>, hints: Vec<String>) -> Result<Programs, String> {
    let dir = crate::app_dir(&data, &folder, dir)?;
    Ok(programs(&dir, &hints, crate::OS))
}

fn programs(dir: &Path, hints: &[String], os: &str) -> Programs {
    let files = app_files(dir);
    let flatpak = files.iter().find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("flatpak"))).map(|p| p.to_string_lossy().into_owned());
    let windows = os == "windows";
    let found: Vec<_> = files.into_iter().filter(|p| (is_program(p, os) && !(windows && crash_handler(p))) || (windows && is_script(p))).collect();
    let name = |p: &Path| p.file_name().map(|n| n.to_string_lossy().into_owned());
    let matched = crate::install::preferred_file(&found, hints).and_then(|p| name(&p));
    let relative: Vec<_> = found.iter().filter_map(|p| p.strip_prefix(dir).ok()).collect();
    let unsure = windows && {
        let depths: Vec<usize> = relative.iter().filter(|p| !is_script(p)).map(|p| p.components().count()).collect();
        depths.iter().min().is_some_and(|top| depths.iter().filter(|d| *d == top).count() > 1)
    };
    let choices = relative.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    Programs { matched, choices, flatpak, unsure }
}

/// A Windows script that can start a game, as Bloodborne's launch_gui.bat does.
fn is_script(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("bat") || e.eq_ignore_ascii_case("cmd"))
}

/// Unity's UnityCrashHandler64.exe and Chromium's crashpad_handler.exe sit beside many games.
fn crash_handler(p: &Path) -> bool {
    let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    name.contains("crashhandler") || name.contains("crashpad")
}

#[cfg(test)]
mod windows_tests {
    use super::*;

    fn folder(files: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for name in files {
            let path = dir.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"x").unwrap();
        }
        dir
    }

    #[test]
    fn several_programs_side_by_side_are_a_guess_and_scripts_are_offered() {
        let dir = folder(&["launch_gui.bat", "run.bat", "README.md", "out/bb-gpu-capabilities.exe", "out/bb-probe.exe", "out/bbport.exe"]);
        let found = programs(dir.path(), &[], "windows");
        assert!(found.unsure);
        assert_eq!(found.choices.len(), 5);
        assert!(found.choices[0].ends_with("launch_gui.bat"));
    }

    #[test]
    fn one_program_above_the_rest_and_a_crash_handler_are_no_guess() {
        let unreal = folder(&["Game.exe", "Game/Binaries/Win64/Game-Win64-Shipping.exe", "Game/Binaries/Win64/Tool.exe"]);
        assert!(!programs(unreal.path(), &[], "windows").unsure);
        let unity = folder(&["Daggerfall.exe", "UnityCrashHandler64.exe"]);
        let found = programs(unity.path(), &[], "windows");
        assert!(!found.unsure);
        assert_eq!(found.choices, ["Daggerfall.exe"]);
    }

    #[test]
    fn a_picked_script_is_matched() {
        let dir = folder(&["launch_gui.bat", "out/a.exe", "out/b.exe"]);
        assert_eq!(programs(dir.path(), &["launch_gui.bat".into()], "windows").matched.as_deref(), Some("launch_gui.bat"));
    }
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

    #[test]
    fn a_flatpak_bundle_is_found_but_isnt_a_program() {
        let dir = folder(&[("io.github.banjorecomp.banjorecomp.flatpak", true), ("portable.txt", false)]);
        let found = programs(dir.path(), &[], "linux");
        assert!(found.choices.is_empty());
        assert!(found.flatpak.is_some_and(|p| p.ends_with("banjorecomp.flatpak")));
    }
}
