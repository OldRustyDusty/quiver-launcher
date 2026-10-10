//! Where Quiver Launcher 3 is, when it isn't where upstream looks (`v3.rs`):
//! a portable copy, or one installed to another drive. 3.x updates itself with
//! Velopack, which notes its folder in `%LOCALAPPDATA%\velopack\velopack_QuiverLauncher.log`
//! every time it starts ("… using packages directory: E:\QuiverLauncher\packages").
//! Those folders, most recent first, let the import find it with nothing to set.
use std::path::PathBuf;

/// 3.x folders named in Velopack's log, most recently used first.
pub fn velopack_dirs() -> Vec<PathBuf> {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else { return vec![] };
    let log = PathBuf::from(local).join("velopack").join("velopack_QuiverLauncher.log");
    std::fs::read_to_string(log).map(|text| dirs_in(&text)).unwrap_or_default()
}

/// The folder before `\packages` in each "packages directory:" line, latest first, each once.
fn dirs_in(log: &str) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for line in log.lines().rev() {
        let Some((_, rest)) = line.split_once("packages directory: ") else { continue };
        let packages = PathBuf::from(rest.trim());
        if let Some(root) = packages.parent().filter(|_| packages.file_name().is_some_and(|n| n.eq_ignore_ascii_case("packages"))) {
            if !dirs.iter().any(|d| d == root) {
                dirs.push(root.to_path_buf());
            }
        }
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_each_folder_once_latest_first() {
        let log = "\
[lib-csharp:1] [00:10:00] [Information] Root directory is writable, using packages directory: C:\\Old\\QuiverLauncher\\packages
[lib-csharp:2] [00:55:01] [Information] Root directory is writable, using packages directory: E:\\QuiverLauncher\\packages
[lib-csharp:2] [00:55:01] [Information] Initialized WindowsVelopackLocator for QuiverLauncher v3.5.0
[lib-csharp:3] [01:20:00] [Information] Root directory is writable, using packages directory: E:\\QuiverLauncher\\packages";
        assert_eq!(dirs_in(log), vec![PathBuf::from(r"E:\QuiverLauncher"), PathBuf::from(r"C:\Old\QuiverLauncher")]);
    }

    #[test]
    fn ignores_lines_that_name_something_else() {
        assert!(dirs_in("using packages directory: E:\\Somewhere\\cache\nnothing here").is_empty());
    }
}
