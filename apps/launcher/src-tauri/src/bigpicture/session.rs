//! Game sessions (spec §11): when a launched game ends, so Big Picture can come
//! back in front and listen again.
//!
//! The game's own process is waited on. A launcher stub (one that starts the
//! real game and exits within a few seconds) hands over to processes running
//! from the game's folder, which are then watched until none is left.
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter};

/// A newer game supersedes an older one's tracking.
static LATEST: AtomicU64 = AtomicU64::new(0);

/// A process that exits sooner than this was a launcher stub (spec §11).
const STUB_TIME: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_secs(2);

/// Called with each game the launcher starts.
pub fn track(app: &AppHandle, mut child: Child, dir: PathBuf) {
    let session = LATEST.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app.emit("bp-game-started", session);
    let app = app.clone();
    std::thread::Builder::new()
        .name("bp-session".into())
        .spawn(move || {
            let started = Instant::now();
            let _ = child.wait();
            if started.elapsed() < STUB_TIME {
                let mut system = System::new();
                while running_from(&mut system, &dir) {
                    std::thread::sleep(POLL);
                }
            }
            if LATEST.load(Ordering::SeqCst) == session {
                let _ = app.emit("bp-game-exited", session);
            }
        })
        .ok();
}

/// Whether any process is running a program from inside `dir`. Processes whose
/// path can't be read (access denied) don't count.
pub(crate) fn running_from(system: &mut System, dir: &Path) -> bool {
    system.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
    system.processes().values().any(|p| p.exe().is_some_and(|exe| inside(exe, dir)))
}

/// `exe` is in `dir` or below it. Windows paths compare without regard to case.
fn inside(exe: &Path, dir: &Path) -> bool {
    if cfg!(windows) {
        let (exe, dir) = (exe.to_string_lossy().to_lowercase(), dir.to_string_lossy().to_lowercase());
        let dir = dir.trim_end_matches(['\\', '/']);
        exe.len() > dir.len() && exe.starts_with(dir) && matches!(exe.as_bytes()[dir.len()], b'\\' | b'/')
    } else {
        exe.starts_with(dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_belongs_to_the_folder_it_runs_from_and_not_to_a_neighbour() {
        let dir = if cfg!(windows) { Path::new(r"C:\Apps\Game") } else { Path::new("/apps/Game") };
        let inner = if cfg!(windows) { Path::new(r"c:\apps\game\bin\game.exe") } else { Path::new("/apps/Game/bin/game") };
        let neighbour = if cfg!(windows) { Path::new(r"C:\Apps\GameTwo\game.exe") } else { Path::new("/apps/GameTwo/game") };
        assert!(inside(inner, dir));
        assert!(!inside(neighbour, dir));
    }

    #[test]
    fn this_test_runs_from_its_own_folder() {
        let exe = std::env::current_exe().unwrap();
        let mut system = System::new();
        assert!(running_from(&mut system, exe.parent().unwrap()));
        assert!(!running_from(&mut system, Path::new(if cfg!(windows) { r"C:\no\such\folder" } else { "/no/such/folder" })));
    }
}
