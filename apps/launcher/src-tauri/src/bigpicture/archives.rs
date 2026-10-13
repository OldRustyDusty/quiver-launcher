//! Downloads that upstream's installer would misread (seen on Linux):
//! - A file whose name has no extension can still be an archive: GitLab package
//!   files such as Duke Nukem Zero Hour: Recompiled's "DNZHRecompiled-0.0.3-Linux-X64-Release"
//!   are zips. Their first bytes say so.
//! - A build artifact is often an archive holding one archive (a zip with a
//!   .tar.gz inside); the inner one is unpacked too.
//! - Linux builds are often .tar.xz (Taisei, Tails Adventure Remake), which
//!   upstream doesn't unpack.
//! - Zips made on Windows don't keep the "executable" permission, so a Linux
//!   program in one wouldn't start: real programs get it back.
use std::fs;
use std::io::{BufReader, BufWriter, Read};
use std::path::Path;

const ARCHIVES: [&str; 7] = [".zip", ".tar.gz", ".tgz", ".tar.xz", ".txz", ".7z", ".rar"];

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
    } else if head.starts_with(b"\xfd7zXZ\x00") {
        ".tar.xz"
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

/// Whether `name` is a .tar.xz, which [`unpack_tar_xz`] unpacks.
pub fn is_tar_xz(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".tar.xz") || lower.ends_with(".txz")
}

/// Unpacks a .tar.xz into `out`, through a .tar beside it.
pub fn unpack_tar_xz(file: &Path, out: &Path) -> Result<(), String> {
    let text = |e: &dyn std::fmt::Display| e.to_string();
    let tar = file.with_extension("unpacked-tar");
    let result = (|| {
        let mut from = BufReader::new(fs::File::open(file).map_err(|e| text(&e))?);
        let mut to = BufWriter::new(fs::File::create(&tar).map_err(|e| text(&e))?);
        lzma_rs::xz_decompress(&mut from, &mut to).map_err(|e| format!("The .tar.xz couldn't be unpacked: {e:?}"))?;
        drop(to);
        // unpack keeps every entry inside `out`.
        tar::Archive::new(fs::File::open(&tar).map_err(|e| text(&e))?).unpack(out).map_err(|e| text(&e))
    })();
    let _ = fs::remove_file(&tar);
    result
}

/// Gives every Linux program under `dir` the "executable" permission it may
/// have lost: ELF binaries, AppImages and shell scripts.
pub fn mark_programs(dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                mark_programs(&path);
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            let mode = meta.permissions().mode();
            if !kind.is_file() || mode & 0o111 != 0 {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            let named = [".appimage", ".sh", ".x86_64", ".elf"].iter().any(|ext| name.ends_with(ext));
            let mut head = [0u8; 4];
            let elf = fs::File::open(&path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && head == *b"\x7fELF";
            if named || elf {
                let _ = fs::set_permissions(&path, fs::Permissions::from_mode(mode | 0o111));
            }
        }
    }
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
        let xz = dir.path().join("game-linux");
        fs::write(&xz, b"\xfd7zXZ\x00rest").unwrap();
        assert_eq!(named(&xz, "game-linux"), "game-linux.tar.xz");
    }

    #[test]
    fn a_tar_xz_unpacks() {
        let dir = tempfile::tempdir().unwrap();
        let mut tar = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(6);
        header.set_mode(0o755);
        header.set_cksum();
        tar.append_data(&mut header, "Taisei/taisei", &b"run me"[..]).unwrap();
        let tar = tar.into_inner().unwrap();
        let mut xz = Vec::new();
        lzma_rs::xz_compress(&mut &tar[..], &mut xz).unwrap();
        let file = dir.path().join("Taisei-linux.tar.xz");
        fs::write(&file, xz).unwrap();
        let out = dir.path().join("out");
        assert!(is_tar_xz("Taisei-linux.tar.xz"));
        unpack_tar_xz(&file, &out).unwrap();
        assert_eq!(fs::read(out.join("Taisei/taisei")).unwrap(), b"run me");
        assert!(!file.with_extension("unpacked-tar").exists());
    }

    #[cfg(unix)]
    #[test]
    fn linux_programs_get_back_the_executable_permission() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("bin")).unwrap();
        let files = [("bin/game", &b"\x7fELF...."[..]), ("start.sh", b"#!/bin/sh"), ("readme", b"hello"), ("data.pak", b"\x00\x01")];
        for (name, bytes) in files {
            fs::write(dir.path().join(name), bytes).unwrap();
            fs::set_permissions(dir.path().join(name), fs::Permissions::from_mode(0o644)).unwrap();
        }
        mark_programs(dir.path());
        let runs = |name: &str| fs::metadata(dir.path().join(name)).unwrap().permissions().mode() & 0o111 != 0;
        assert!(runs("bin/game") && runs("start.sh"));
        assert!(!runs("readme") && !runs("data.pak"));
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
