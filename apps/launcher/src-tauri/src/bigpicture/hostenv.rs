//! Games start with the system's environment, not the AppImage's (Linux).
//!
//! An AppImage's AppRun points PATH, LD_LIBRARY_PATH, XDG_DATA_DIRS and the GTK,
//! GIO, Python and Qt variables into its own mount, so the launcher's WebKit finds
//! its bundled libraries. A game inheriting them loads those older libraries
//! instead of the system's: on Bazzite, zenity (the file picker Star Fox Enhanced
//! and 2 Ship 2 Harkinian open for a ROM) dies on a glib symbol, and the game quits.
use std::ffi::OsString;
use std::process::Command;

/// The AppImage's own variables, set by its runtime and AppRun.
const OWN: [&str; 4] = ["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

/// Gives `command` the environment the launcher was started with, as far as it
/// can be told apart. Outside an AppImage, nothing changes.
pub fn restore(command: &mut Command) {
    let Some(appdir) = std::env::var_os("APPDIR") else { return };
    for (key, value) in changes(std::env::vars_os(), &appdir) {
        match value {
            Some(value) => command.env(key, value),
            None => command.env_remove(key),
        };
    }
}

/// What to change: lists lose their entries inside `appdir` (or go, once
/// empty), and any other variable pointing into it goes.
fn changes(vars: impl Iterator<Item = (OsString, OsString)>, appdir: &OsString) -> Vec<(OsString, Option<OsString>)> {
    let appdir = appdir.to_string_lossy();
    let appdir = appdir.trim_end_matches('/');
    let inside = |entry: &str| entry == appdir || entry.starts_with(&format!("{appdir}/"));
    vars.filter_map(|(key, value)| {
        if OWN.iter().any(|own| key == *own) {
            return Some((key, None));
        }
        let entries: Vec<&str> = value.to_str()?.split(':').collect();
        if !entries.iter().any(|entry| inside(entry)) {
            return None;
        }
        let kept: Vec<&str> = entries.into_iter().filter(|entry| !entry.is_empty() && !inside(entry)).collect();
        Some((key, (!kept.is_empty()).then(|| kept.join(":").into())))
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(vars: &[(&str, &str)]) -> Vec<(String, Option<String>)> {
        let vars = vars.iter().map(|(k, v)| (OsString::from(k), OsString::from(v)));
        changes(vars, &"/tmp/.mount_Big Qu1".into())
            .into_iter()
            .map(|(k, v)| (k.into_string().unwrap(), v.map(|v| v.into_string().unwrap())))
            .collect()
    }

    #[test]
    fn lists_keep_only_the_systems_entries() {
        let got = run(&[
            ("PATH", "/tmp/.mount_Big Qu1/usr/bin/:/tmp/.mount_Big Qu1/bin/:/usr/local/bin:/usr/bin"),
            ("XDG_DATA_DIRS", "/tmp/.mount_Big Qu1/usr/share/:/usr/share:/var/lib/flatpak/exports/share"),
        ]);
        assert_eq!(got[0], ("PATH".into(), Some("/usr/local/bin:/usr/bin".into())));
        assert_eq!(got[1], ("XDG_DATA_DIRS".into(), Some("/usr/share:/var/lib/flatpak/exports/share".into())));
    }

    #[test]
    fn the_appimages_own_variables_go() {
        let got = run(&[
            ("LD_LIBRARY_PATH", "/tmp/.mount_Big Qu1/usr/lib/:/tmp/.mount_Big Qu1/usr/lib/x86_64-linux-gnu/"),
            ("GTK_EXE_PREFIX", "/tmp/.mount_Big Qu1//usr"),
            ("PYTHONHOME", "/tmp/.mount_Big Qu1/usr/"),
            ("APPIMAGE", "/home/me/Big Quiver Launcher.AppImage"),
            ("OWD", "/home/me"),
        ]);
        assert!(got.iter().all(|(_, v)| v.is_none()), "{got:?}");
        assert_eq!(got.len(), 5);
    }

    #[test]
    fn the_rest_is_left_alone() {
        let got = run(&[
            ("HOME", "/home/me"),
            ("STEAM_COMPAT_DATA_PATH", "/tmp/.mount_Big Qu10/elsewhere"),
            ("GTK_THEME", "Adwaita:dark"),
        ]);
        assert!(got.is_empty(), "{got:?}");
    }
}
