//! Windows games on Linux without Wine. Upstream starts them with `wine`, which
//! Bazzite doesn't ship. It has umu-run, which runs a game with Proton the way
//! Steam does: with Steam's own Proton when one is installed (else umu-run
//! downloads its own the first time), in a prefix of the game's own.
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The program to start instead of `program`, and its extra environment: umu-run
/// when `program` is Wine that isn't installed and umu-run is. Else unchanged.
pub fn runner(program: &Path, data_dir: &Path, folder: &str) -> (PathBuf, Vec<(&'static str, OsString)>) {
    if program != Path::new("wine") || find("wine").is_some() {
        return (program.to_path_buf(), vec![]);
    }
    let Some(umu) = find("umu-run") else { return (program.to_path_buf(), vec![]) };
    let name: String = folder.chars().map(|c| if c.is_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
    let prefix = data_dir.join("proton-prefixes").join(name.trim_start_matches('.'));
    let _ = std::fs::create_dir_all(&prefix);
    let mut env = vec![("GAMEID", OsString::from("umu-default")), ("WINEPREFIX", prefix.into_os_string())];
    if let Some(proton) = std::env::var_os("HOME").and_then(|home| steam_proton(Path::new(&home))) {
        env.push(("PROTONPATH", proton.into_os_string()));
    }
    (umu, env)
}

/// A program on PATH.
fn find(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?).map(|dir| dir.join(name)).find(|p| p.is_file())
}

/// The newest Proton Steam has installed (its own, or one in compatibilitytools.d, such as GE-Proton).
fn steam_proton(home: &Path) -> Option<PathBuf> {
    const STEAM: [&str; 3] = [".steam/steam", ".local/share/Steam", ".var/app/com.valvesoftware.Steam/.local/share/Steam"];
    STEAM
        .iter()
        .flat_map(|root| ["steamapps/common", "compatibilitytools.d"].map(|sub| home.join(root).join(sub)))
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flat_map(|entries| entries.flatten().map(|e| e.path()))
        .filter(|dir| dir.join("proton").is_file())
        .max_by_key(|dir| version(&dir.file_name().unwrap_or_default().to_string_lossy()))
}

/// The numbers in a Proton's name, to find the newest: "Proton 11.0" > "GE-Proton10-25" > "Proton - Experimental".
fn version(name: &str) -> Vec<u32> {
    name.split(|c: char| !c.is_ascii_digit()).filter_map(|n| n.parse().ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_newest_numbered_proton_is_taken() {
        let home = tempfile::tempdir().unwrap();
        for dir in [".steam/steam/steamapps/common/Proton 9.0 (Beta)", ".steam/steam/steamapps/common/Proton 11.0", ".steam/steam/steamapps/common/Proton - Experimental", ".steam/steam/compatibilitytools.d/GE-Proton10-25"] {
            std::fs::create_dir_all(home.path().join(dir)).unwrap();
            std::fs::write(home.path().join(dir).join("proton"), "").unwrap();
        }
        std::fs::create_dir_all(home.path().join(".steam/steam/steamapps/common/Proton 12.0 (not installed)")).unwrap();
        assert_eq!(steam_proton(home.path()).unwrap().file_name().unwrap(), "Proton 11.0");
        assert_eq!(steam_proton(tempfile::tempdir().unwrap().path()), None);
    }

    #[test]
    fn anything_but_wine_is_left_alone() {
        let (program, env) = runner(Path::new("/games/Game/game"), Path::new("/data"), "Game");
        assert_eq!(program, Path::new("/games/Game/game"));
        assert!(env.is_empty());
    }
}
