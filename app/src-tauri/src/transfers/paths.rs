use std::fs::OpenOptions;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub struct Throttle {
    every: Duration,
    last: Option<Instant>,
}

impl Throttle {
    pub fn new(every: Duration) -> Self {
        Self { every, last: None }
    }

    pub fn ready(&mut self, now: Instant, finished: bool) -> bool {
        let due = self
            .last
            .is_none_or(|last| now.duration_since(last) >= self.every);
        if finished || due {
            self.last = Some(now);
            return true;
        }
        false
    }
}

pub fn safe_file_name(key: &str) -> String {
    match key.rsplit('/').next() {
        Some(name) if !name.is_empty() && name != "." && name != ".." => name.to_string(),
        _ => "download".to_string(),
    }
}

pub fn part_path(target: &Path) -> PathBuf {
    let mut part = target.as_os_str().to_owned();
    part.push(".part");
    PathBuf::from(part)
}

fn is_taken(path: &Path) -> bool {
    path.exists() || part_path(path).exists()
}

pub fn unique_download_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !is_taken(&first) {
        return first;
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(name);
    let extension = path.extension().and_then(|ext| ext.to_str());
    (1..)
        .map(|n| match extension {
            Some(ext) => dir.join(format!("{stem} ({n}).{ext}")),
            None => dir.join(format!("{stem} ({n})")),
        })
        .find(|candidate| !is_taken(candidate))
        .unwrap_or(first)
}

pub fn reserve_download(dir: &Path, name: &str) -> std::io::Result<(PathBuf, PathBuf)> {
    loop {
        let target = unique_download_path(dir, name);
        let part = part_path(&target);
        match OpenOptions::new().write(true).create_new(true).open(&part) {
            Ok(_) => return Ok((target, part)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
}

pub async fn open_reserved(path: &Path) -> std::io::Result<tokio::fs::File> {
    tokio::fs::OpenOptions::new().write(true).open(path).await
}

pub fn finish_download(
    dir: &Path,
    name: &str,
    part: &Path,
    mut target: PathBuf,
) -> std::io::Result<PathBuf> {
    loop {
        match std::fs::hard_link(part, &target) {
            Ok(()) => {
                std::fs::remove_file(part).ok();
                return Ok(target);
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                target = unique_download_path(dir, name);
            }
            Err(error) => return Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;

    #[test]
    fn progress_is_sent_at_most_ten_times_a_second() {
        let start = Instant::now();
        let mut throttle = Throttle::new(Duration::from_millis(100));
        assert!(throttle.ready(start, false));
        assert!(!throttle.ready(start + Duration::from_millis(50), false));
        assert!(throttle.ready(start + Duration::from_millis(100), false));
        assert!(throttle.ready(start + Duration::from_millis(101), true));
    }

    #[test]
    fn file_names_come_from_the_last_part_of_the_key() {
        assert_eq!(safe_file_name("vimeo/2025/teaser.mp4"), "teaser.mp4");
        assert_eq!(safe_file_name("notes.md"), "notes.md");
        for odd in ["", "a/", "a/..", "a/.", ".."] {
            assert_eq!(safe_file_name(odd), "download", "{odd:?}");
        }
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kelp-downloads-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn downloads_never_overwrite_existing_files() {
        let dir = temp_dir();
        assert_eq!(
            unique_download_path(&dir, "teaser.mp4"),
            dir.join("teaser.mp4")
        );
        std::fs::write(dir.join("teaser.mp4"), "").unwrap();
        assert_eq!(
            unique_download_path(&dir, "teaser.mp4"),
            dir.join("teaser (1).mp4")
        );
        std::fs::write(dir.join("teaser (1).mp4"), "").unwrap();
        assert_eq!(
            unique_download_path(&dir, "teaser.mp4"),
            dir.join("teaser (2).mp4")
        );
    }

    #[test]
    fn an_unfinished_download_also_counts_as_taken() {
        let dir = temp_dir();
        std::fs::write(dir.join("notes.md.part"), "").unwrap();
        assert_eq!(
            unique_download_path(&dir, "notes.md"),
            dir.join("notes (1).md")
        );
    }

    #[test]
    fn names_without_an_extension_get_a_number_too() {
        let dir = temp_dir();
        std::fs::write(dir.join("README"), "").unwrap();
        assert_eq!(unique_download_path(&dir, "README"), dir.join("README (1)"));
    }

    #[test]
    fn two_quick_downloads_of_one_file_reserve_different_names() {
        let dir = temp_dir();
        let (first, first_part) = reserve_download(&dir, "a.txt").unwrap();
        let (second, second_part) = reserve_download(&dir, "a.txt").unwrap();
        assert_eq!(first, dir.join("a.txt"));
        assert_eq!(second, dir.join("a (1).txt"));
        assert!(first_part.exists() && second_part.exists());
    }

    #[test]
    fn finishing_never_overwrites_a_file_that_appeared_meanwhile() {
        let dir = temp_dir();
        let (target, part) = reserve_download(&dir, "a.txt").unwrap();
        std::fs::write(&part, "new").unwrap();
        std::fs::write(&target, "existing").unwrap();
        let saved = finish_download(&dir, "a.txt", &part, target.clone()).unwrap();
        assert_eq!(saved, dir.join("a (1).txt"));
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "existing");
        assert_eq!(std::fs::read_to_string(&saved).unwrap(), "new");
        assert!(!part.exists());
    }

    #[tokio::test]
    async fn opening_a_reserved_file_never_creates_it() {
        let dir = temp_dir();
        let missing = dir.join("gone.part");
        assert!(open_reserved(&missing).await.is_err());
        assert!(!missing.exists());
        let (_, part) = reserve_download(&dir, "a.txt").unwrap();
        assert!(open_reserved(&part).await.is_ok());
    }
}
