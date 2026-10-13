//! Game sessions (spec §11): when a launched game ends, so Big Picture can come
//! back in front and listen again.
//!
//! The game's own process is waited on. A launcher stub (one that starts the
//! real game and exits within a few seconds) hands over to processes running
//! from the game's folder, which are then watched until none is left.
//!
//! A game that closes with an error before it really started, or crashes, is
//! reported ("bp-game-failed") with the last telling line of its output, which
//! goes to a log in the data folder instead of nowhere.
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter};

/// A newer game supersedes an older one's tracking.
static LATEST: AtomicU64 = AtomicU64::new(0);

/// A process that exits sooner than this was a launcher stub (spec §11).
const STUB_TIME: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_secs(2);

/// Where a game's output goes: `game-logs/<folder>.log` in the data folder,
/// started afresh at each launch.
pub struct GameLog {
    path: Option<PathBuf>,
    file: Option<File>,
}

impl GameLog {
    pub fn new(data_dir: &Path, folder: &str) -> GameLog {
        let name: String = folder.chars().map(|c| if c.is_alphanumeric() || "-_. ".contains(c) { c } else { '_' }).collect();
        let path = data_dir.join("game-logs").join(format!("{}.log", name.trim_start_matches('.')));
        let file = path.parent().and_then(|dir| std::fs::create_dir_all(dir).ok()).and_then(|_| File::create(&path).ok());
        GameLog { path: file.as_ref().map(|_| path), file }
    }

    /// The log for stdout or stderr; nowhere if it couldn't be made.
    pub fn stdio(&self) -> Stdio {
        self.file.as_ref().and_then(|f| f.try_clone().ok()).map_or_else(Stdio::null, Stdio::from)
    }
}

#[derive(Clone, Serialize)]
struct Failure {
    /// The install's folder name, as the page knows it.
    folder: String,
    message: String,
    /// Closed right after starting, rather than crashing.
    early: bool,
}

/// Called with each game the launcher starts.
pub fn track(app: &AppHandle, mut child: Child, dir: PathBuf, folder: String, log: GameLog) {
    let session = LATEST.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = app.emit("bp-game-started", session);
    let app = app.clone();
    std::thread::Builder::new()
        .name("bp-session".into())
        .spawn(move || {
            let started = Instant::now();
            let status = child.wait().ok();
            let quick = started.elapsed() < STUB_TIME;
            let mut handed_over = false;
            if quick {
                let mut system = System::new();
                while running_from(&mut system, &dir) {
                    handed_over = true;
                    std::thread::sleep(POLL);
                }
            }
            if let Some(problem) = status.and_then(|s| problem(s, quick && !handed_over)) {
                let early = matches!(problem, Problem::ClosedEarly(_));
                let message = message(&problem, log.path.as_deref());
                let _ = app.emit("bp-game-failed", Failure { folder, message, early });
            }
            if LATEST.load(Ordering::SeqCst) == session {
                let _ = app.emit("bp-game-exited", session);
            }
        })
        .ok();
}

#[derive(Debug, PartialEq)]
enum Problem {
    /// Closed with an error before it really started (no stub handing over).
    ClosedEarly(i32),
    /// Ended by a crash signal, whenever it came.
    Crashed(&'static str),
}

/// What went wrong, if anything: `early` is an exit within the stub time with
/// nothing left running. Signals that stop a game on purpose aren't problems.
fn problem(status: ExitStatus, early: bool) -> Option<Problem> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return crash_name(signal).map(Problem::Crashed);
        }
    }
    match status.code() {
        Some(code) if code != 0 && early => Some(Problem::ClosedEarly(code)),
        _ => None,
    }
}

#[cfg(unix)]
fn crash_name(signal: i32) -> Option<&'static str> {
    // Linux numbering (SIGBUS differs on macOS, so it's left out there).
    match signal {
        4 => Some("illegal instruction"),
        6 => Some("it aborted"),
        7 if cfg!(target_os = "linux") => Some("bus error"),
        8 => Some("arithmetic error"),
        11 => Some("segmentation fault"),
        _ => None,
    }
}

fn message(problem: &Problem, log: Option<&Path>) -> String {
    let mut text = match problem {
        Problem::ClosedEarly(code) => format!("It closed right after starting (exit code {code})."),
        Problem::Crashed(what) => format!("It crashed ({what})."),
    };
    if let Some(line) = log.and_then(|path| telling_line(&tail(path))) {
        text.push_str(&format!(" Its last message: \u{201c}{line}\u{201d}"));
    }
    if let Some(path) = log {
        text.push_str(&format!(" Full log: {}", path.display()));
    }
    text
}

/// The end of the log, at most 16 KB.
fn tail(path: &Path) -> String {
    let mut out = Vec::new();
    if let Ok(mut file) = File::open(path) {
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        let _ = file.seek(SeekFrom::Start(size.saturating_sub(16 * 1024)));
        let _ = file.read_to_end(&mut out);
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The last line that says what went wrong, else the last line; colour codes removed.
fn telling_line(output: &str) -> Option<String> {
    const TELLING: [&str; 15] = [
        "error", "fail", "usage", "not found", "missing", "cannot", "can't", "couldn't", "unable", "denied", "invalid", "no such", "exception",
        "panicked", "fatal",
    ];
    let lines: Vec<String> = output.lines().map(plain).filter(|l| !l.is_empty()).collect();
    let line = lines.iter().rev().find(|l| TELLING.iter().any(|w| l.to_lowercase().contains(w))).or(lines.last())?;
    let mut line: String = line.chars().take(200).collect();
    if line.chars().count() == 200 {
        line.push('…');
    }
    Some(line)
}

/// A line without terminal colour codes (ESC [ … letter), trimmed.
fn plain(line: &str) -> String {
    let mut out = String::new();
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.next() == Some('[') {
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
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

    #[test]
    fn the_telling_line_is_the_last_one_that_says_what_went_wrong() {
        let output = "WARNING: radv is not a conformant Vulkan implementation\n\
                      starfox_pc failed: runtime input selection was canceled\n\
                      \u{1b}[33m(zenity:27455): Adwaita-WARNING **: Using GtkSettings\u{1b}[0m\n\n";
        assert_eq!(telling_line(output).as_deref(), Some("starfox_pc failed: runtime input selection was canceled"));
        assert_eq!(telling_line("usage: starfox_asset_builder RETAIL_ROM\n").as_deref(), Some("usage: starfox_asset_builder RETAIL_ROM"));
        assert_eq!(telling_line("Loading…\nBye\n").as_deref(), Some("Bye"));
        assert_eq!(telling_line("\n  \n"), None);
    }

    #[cfg(unix)]
    #[test]
    fn closing_with_an_error_early_or_crashing_is_a_problem_and_quitting_is_not() {
        use std::os::unix::process::ExitStatusExt;
        let exited = |code: i32| ExitStatus::from_raw(code << 8);
        let signalled = ExitStatus::from_raw;
        assert_eq!(problem(exited(2), true), Some(Problem::ClosedEarly(2)));
        assert_eq!(problem(exited(2), false), None);
        assert_eq!(problem(exited(0), true), None);
        assert_eq!(problem(signalled(11), false), Some(Problem::Crashed("segmentation fault")));
        assert_eq!(problem(signalled(15), true), None);
        assert_eq!(problem(signalled(9), true), None);
    }

    #[test]
    fn the_message_says_what_happened_and_where_the_log_is() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("Game.log");
        std::fs::write(&log, "usage: tool ROM\n").unwrap();
        let text = message(&Problem::ClosedEarly(2), Some(&log));
        assert!(text.starts_with("It closed right after starting (exit code 2). Its last message: \u{201c}usage: tool ROM\u{201d} Full log: "), "{text}");
        assert_eq!(message(&Problem::Crashed("segmentation fault"), None), "It crashed (segmentation fault).");
    }
}
