//! Downloads that upstream's installer would misread (seen on Linux):
//! - A file whose name has no extension can still be an archive: GitLab package
//!   files such as Duke Nukem Zero Hour: Recompiled's "DNZHRecompiled-0.0.3-Linux-X64-Release"
//!   are zips. Their first bytes say so.
//! - A build artifact is often an archive holding one archive (a zip with a
//!   .tar.gz inside); the inner one is unpacked too.
use std::fs;
use std::io::Read;
use std::path::Path;

const ARCHIVES: [&str; 5] = [".zip", ".tar.gz", ".tgz", ".7z", ".rar"];

fn is_archive_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    ARCHIVES.iter().any(|ext| lower.ends_with(ext))
}

/// The name to unpack the download by: its own, or with the extension its
/// first bytes show, when its name has none of the archive extensions.
pub fn named(file: &Path, name: &str) -> String {
    if is_archive_name(name) {
        return name.into();
    }
    let mut head = [0u8; 6];
    let read = fs::File::open(file).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
    let head = &head[..read];
    let ext = if head.starts_with(b"PK\x03\x04") {
        ".zip"
    } else if head.starts_with(&[0x1f, 0x8b]) {
        ".tar.gz"
    } else if head.starts_with(b"7z\xbc\xaf\x27\x1c") {
        ".7z"
    } else if head.starts_with(b"Rar!") {
        ".rar"
    } else {
        return name.into();
    };
    format!("{name}{ext}")
}

/// When `out` holds just one file and it's an archive, unpacks that into `out` in its place.
pub fn unwrap_inner(out: &Path, extract: impl Fn(&Path, &str, &Path) -> Result<(), String>) -> Result<(), String> {
    let entries: Vec<_> = fs::read_dir(out).map_err(|e| e.to_string())?.flatten().collect();
    let [only] = entries.as_slice() else { return Ok(()) };
    let name = only.file_name().to_string_lossy().into_owned();
    if !only.path().is_file() || !is_archive_name(&name) {
        return Ok(());
    }
    let staged = out.with_extension("inner");
    fs::rename(only.path(), &staged).map_err(|e| e.to_string())?;
    let result = extract(&staged, &name, out);
    let _ = fs::remove_file(&staged);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_of(name: &str, bytes: &[u8]) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut out);
        zip.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(bytes).unwrap();
        zip.finish().unwrap();
        out.into_inner()
    }

    #[test]
    fn an_archive_without_an_extension_is_named_by_its_first_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("Game-Linux-X64-Release");
        fs::write(&zip, zip_of("a", b"x")).unwrap();
        let program = dir.path().join("game");
        fs::write(&program, b"\x7fELF....").unwrap();
        assert_eq!(named(&zip, "Game-Linux-X64-Release"), "Game-Linux-X64-Release.zip");
        assert_eq!(named(&program, "game"), "game");
        assert_eq!(named(&zip, "Game.AppImage"), "Game.AppImage.zip");
        assert_eq!(named(&zip, "Game.tar.gz"), "Game.tar.gz");
    }

    #[test]
    fn a_lone_archive_inside_is_unpacked_in_its_place() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("out");
        fs::create_dir(&out).unwrap();
        fs::write(out.join("inner.zip"), zip_of("game", b"run me")).unwrap();
        let extract = |file: &Path, name: &str, to: &Path| -> Result<(), String> {
            assert_eq!(name, "inner.zip");
            zip::ZipArchive::new(fs::File::open(file).unwrap()).unwrap().extract(to).map_err(|e| e.to_string())
        };
        unwrap_inner(&out, extract).unwrap();
        let names: Vec<_> = fs::read_dir(&out).unwrap().flatten().map(|e| e.file_name().into_string().unwrap()).collect();
        assert_eq!(names, ["game"]);
        assert!(!out.with_extension("inner").exists());
        // A program on its own, or several files, stay as they are.
        unwrap_inner(&out, |_: &Path, _: &str, _: &Path| -> Result<(), String> { panic!("not an archive") }).unwrap();
    }
}
