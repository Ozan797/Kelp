use std::ops::Range;
use std::path::{Path, PathBuf};

use super::model::{Item, ItemState};
use crate::error::AppError;

pub const MIB: u64 = 1024 * 1024;
pub const MULTIPART_THRESHOLD: u64 = 16 * MIB;
pub const PART_SIZE: u64 = 8 * MIB;
const MAX_PARTS: u64 = 10_000;

pub fn uses_multipart(size: u64) -> bool {
    size > MULTIPART_THRESHOLD
}

pub fn part_size(size: u64) -> u64 {
    let smallest = size.div_ceil(MAX_PARTS).div_ceil(MIB) * MIB;
    smallest.max(PART_SIZE)
}

pub fn walk_folder(root: &Path) -> Result<Vec<(PathBuf, String, u64)>, AppError> {
    let mut found = Vec::new();
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        for entry in std::fs::read_dir(&folder)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            let path = entry.path();
            if kind.is_dir() {
                folders.push(path);
            } else if kind.is_file() && entry.file_name() != ".DS_Store" {
                let relative = relative_key(root, &path)?;
                found.push((path, relative, entry.metadata()?.len()));
            }
        }
    }
    found.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(found)
}

fn relative_key(root: &Path, path: &Path) -> Result<String, AppError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::Io("A file is outside the folder.".into()))?;
    let parts: Option<Vec<&str>> = relative.iter().map(|part| part.to_str()).collect();
    parts
        .map(|parts| parts.join("/"))
        .ok_or_else(|| AppError::Io("A file name isn't valid text.".into()))
}

pub fn local_name(root: &Path) -> Result<String, AppError> {
    root.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or_else(|| AppError::Io("That folder has no name.".into()))
}

pub fn upload_items(root: &Path, prefix: &str) -> Result<Vec<Item>, AppError> {
    let name = local_name(root)?;
    Ok(walk_folder(root)?
        .into_iter()
        .map(|(local, relative, size)| Item {
            local,
            key: format!("{prefix}{name}/{relative}"),
            size,
            state: ItemState::Pending,
            resume: None,
            source_key: None,
        })
        .collect())
}

pub fn download_target(prefix: &str, key: &str, dir: &Path) -> Option<PathBuf> {
    let relative = key.strip_prefix(prefix)?;
    let relative = relative.strip_suffix('/').unwrap_or(relative);
    if relative.is_empty() {
        return Some(dir.to_path_buf());
    }
    let mut target = dir.to_path_buf();
    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return None;
        }
        target.push(segment);
    }
    Some(target)
}

pub fn folder_name(prefix: &str) -> String {
    match prefix.trim_end_matches('/').rsplit('/').next() {
        Some(name) if !name.is_empty() && name != "." && name != ".." => name.to_string(),
        _ => "download".to_string(),
    }
}

pub fn ranges(size: u64, part: u64) -> Vec<Range<u64>> {
    (0..size.div_ceil(part))
        .map(|index| index * part..((index + 1) * part).min(size))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_and_medium_files_use_eight_mebibyte_parts() {
        assert_eq!(part_size(16 * MIB), 8 * MIB);
        assert_eq!(part_size(80_000_000_000), 8 * MIB);
        assert_eq!(part_size(80 * 1024 * MIB), 9 * MIB);
    }

    #[test]
    fn huge_files_grow_their_parts_to_stay_under_ten_thousand() {
        let hundred_gib = 100 * 1024 * MIB;
        assert_eq!(part_size(hundred_gib), 11 * MIB);
        assert!(hundred_gib.div_ceil(part_size(hundred_gib)) <= 10_000);
        let five_tib = 5 * 1024 * 1024 * MIB;
        assert!(five_tib.div_ceil(part_size(five_tib)) <= 10_000);
    }

    #[test]
    fn ranges_cover_the_file_and_the_last_one_is_shorter() {
        assert_eq!(
            ranges(20 * MIB, 8 * MIB),
            vec![0..8 * MIB, 8 * MIB..16 * MIB, 16 * MIB..20 * MIB]
        );
        assert_eq!(ranges(16 * MIB, 8 * MIB).len(), 2);
        assert!(ranges(0, 8 * MIB).is_empty());
    }

    fn temp_tree() -> PathBuf {
        let root = std::env::temp_dir()
            .join(format!("kelp-walk-{}", uuid::Uuid::new_v4()))
            .join("photos");
        std::fs::create_dir_all(root.join("raw")).unwrap();
        std::fs::write(root.join("a.jpg"), b"aa").unwrap();
        std::fs::write(root.join("raw").join("b.dng"), b"bbb").unwrap();
        std::fs::write(root.join(".DS_Store"), b"x").unwrap();
        std::os::unix::fs::symlink(root.join("a.jpg"), root.join("link.jpg")).unwrap();
        root
    }

    #[test]
    fn walking_a_folder_finds_files_but_not_links_or_finder_files() {
        let root = temp_tree();
        let found: Vec<(String, u64)> = walk_folder(&root)
            .unwrap()
            .into_iter()
            .map(|(_, relative, size)| (relative, size))
            .collect();
        assert_eq!(
            found,
            vec![("a.jpg".to_string(), 2), ("raw/b.dng".to_string(), 3)]
        );
    }

    #[test]
    fn uploaded_folders_keep_their_own_name_in_the_key() {
        let root = temp_tree();
        let items = upload_items(&root, "2026/").unwrap();
        let keys: Vec<&str> = items.iter().map(|item| item.key.as_str()).collect();
        assert_eq!(keys, vec!["2026/photos/a.jpg", "2026/photos/raw/b.dng"]);
        assert_eq!(items[1].local, root.join("raw").join("b.dng"));
        assert_eq!(items[1].size, 3);
    }

    #[test]
    fn downloaded_keys_map_inside_the_target_folder() {
        let dir = Path::new("/Users/me/Downloads/photos");
        assert_eq!(
            download_target("2026/photos/", "2026/photos/raw/b.dng", dir),
            Some(dir.join("raw").join("b.dng"))
        );
        assert_eq!(
            download_target("2026/photos/", "2026/photos/raw/", dir),
            Some(dir.join("raw"))
        );
    }

    #[test]
    fn unsafe_keys_never_leave_the_target_folder() {
        let dir = Path::new("/Users/me/Downloads/photos");
        for key in [
            "2026/photos/../x",
            "2026/photos//x",
            "2026/photos/./x",
            "2026/photos/a/../../x",
            "elsewhere/x",
        ] {
            assert_eq!(download_target("2026/photos/", key, dir), None, "{key}");
        }
    }

    #[test]
    fn folder_names_come_from_the_last_part_of_the_prefix() {
        assert_eq!(folder_name("2026/photos/"), "photos");
        assert_eq!(folder_name("photos/"), "photos");
        assert_eq!(folder_name("../"), "download");
        assert_eq!(folder_name(""), "download");
    }

    #[test]
    fn only_files_over_sixteen_mebibytes_use_multipart() {
        assert!(!uses_multipart(16 * MIB));
        assert!(uses_multipart(16 * MIB + 1));
    }
}
