//! Big Picture (fork): a controller-first fullscreen mode. Its own commands
//! live here; upstream's lib.rs only registers them (docs/bigpicture/FORK_CHANGES.md).
use std::path::{Path, PathBuf};
use tauri::State;

use super::Data;

#[cfg(any(windows, target_os = "linux"))]
mod pads;
pub mod archives;
pub mod hostenv;
pub mod programs;
pub mod session;
pub mod v3;
pub mod v3share;

/// Big Picture's own settings and per-app state, beside upstream's JSON files,
/// which it never writes itself.
fn sidecar_path(data: &Data) -> PathBuf {
    data.0.join("bigpicture.json")
}

/// The file's JSON, or None when it's missing or unreadable (Big Picture then starts from defaults).
fn read_json(path: &Path) -> Option<serde_json::Value> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

/// Writes beside the file, then renames over it: a crash never leaves half a file.
fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
        .and_then(|_| std::fs::rename(&temp, path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bp_read_sidecar(data: State<Data>) -> Option<serde_json::Value> {
    read_json(&sidecar_path(&data))
}

#[tauri::command]
pub fn bp_write_sidecar(data: State<Data>, value: serde_json::Value) -> Result<(), String> {
    write_json_atomic(&sidecar_path(&data), &value)
}

/// How the launcher was started: `--bigpicture` opens straight into Big Picture.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchArgs {
    big_picture: bool,
    /// `QUIVER_BP_DEBUG=1`: an overlay of controller events, for testing controllers.
    debug: bool,
}

#[tauri::command]
pub fn bp_launch_args() -> LaunchArgs {
    LaunchArgs {
        big_picture: std::env::args().any(|a| a == "--bigpicture"),
        debug: std::env::var_os("QUIVER_BP_DEBUG").is_some_and(|v| v != "0"),
    }
}

/// Brings the launcher's window in front and gives it the keyboard: controllers
/// (Windows.Gaming.Input) and keys only reach the window in front. Windows lets
/// a window that isn't in front take focus only in some cases, so this can
/// still leave it flashing in the taskbar; it says whether it worked.
/// Async so it runs off the main thread: window calls from a synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn bp_focus(window: tauri::WebviewWindow) -> bool {
    let _ = window.unminimize();
    let _ = window.show();
    // tao tries SetForegroundWindow, then again after a simulated Alt press.
    let _ = window.set_focus();
    if window.is_focused().unwrap_or(false) {
        return true;
    }
    // Last resort (spec §11): minimizing and restoring brings a window in front.
    let _ = window.minimize();
    std::thread::sleep(std::time::Duration::from_millis(150));
    let _ = window.unminimize();
    let _ = window.set_focus();
    std::thread::sleep(std::time::Duration::from_millis(150));
    window.is_focused().unwrap_or(false)
}

/// Big Picture's controller reader (pads.rs): one for the app, running while Big Picture is open.
#[cfg(any(windows, target_os = "linux"))]
static PADS: std::sync::LazyLock<pads::Pads> = std::sync::LazyLock::new(Default::default);

/// Starts reading controllers (Big Picture opened). SDL announces the pads already
/// connected as it starts ("bp-pads"); listen before calling this.
#[tauri::command]
pub async fn bp_pads_start(app: tauri::AppHandle) {
    #[cfg(any(windows, target_os = "linux"))]
    PADS.start(app);
    #[cfg(not(any(windows, target_os = "linux")))]
    let _ = app;
}

/// Stops reading controllers (back to desktop mode, where upstream's reader is used).
#[tauri::command]
pub async fn bp_pads_stop() {
    #[cfg(any(windows, target_os = "linux"))]
    PADS.stop();
}

/// Big Picture's screen (spec §11): fullscreen on the monitor named, or the one
/// the window is on when there's none (or it's gone). Resolves to the monitor used.
#[tauri::command]
pub async fn bp_use_monitor(window: tauri::WebviewWindow, name: Option<String>) -> Result<Option<String>, String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let target = name.and_then(|n| monitors.into_iter().find(|m| m.name().is_some_and(|mn| *mn == n)));
    let Some(monitor) = target else {
        return Ok(window.current_monitor().ok().flatten().and_then(|m| m.name().cloned()));
    };
    // Out of fullscreen to move, then back in on the new monitor.
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    window.set_position(*monitor.position()).map_err(|e| e.to_string())?;
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    Ok(monitor.name().cloned())
}

/// The monitors there are, by name, for the setting.
#[tauri::command]
pub async fn bp_monitors(window: tauri::WebviewWindow) -> Vec<String> {
    window.available_monitors().unwrap_or_default().iter().filter_map(|m| m.name().cloned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn writes_and_reads_back_without_leaving_a_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("bigpicture.json");
        let value = json!({ "version": 1, "settings": { "updateBehavior": "ask" }, "apps": {} });
        write_json_atomic(&path, &value).unwrap();
        assert_eq!(read_json(&path), Some(value));
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn replaces_an_existing_file_and_keeps_fields_it_does_not_know() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bigpicture.json");
        write_json_atomic(&path, &json!({ "version": 1 })).unwrap();
        let next = json!({ "version": 1, "fromANewerFork": { "x": [1, 2] } });
        write_json_atomic(&path, &next).unwrap();
        assert_eq!(read_json(&path), Some(next));
    }

    #[test]
    fn a_missing_or_broken_file_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bigpicture.json");
        assert_eq!(read_json(&path), None);
        std::fs::write(&path, b"{ not json").unwrap();
        assert_eq!(read_json(&path), None);
    }
}
