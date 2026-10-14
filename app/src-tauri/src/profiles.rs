use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::connection::ConnectionSettings;
use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub bucket: String,
    pub prefix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: Uuid,
    pub name: String,
    pub settings: ConnectionSettings,
    pub bucket: Option<String>,
    pub last_location: Option<Location>,
}

pub struct ProfileStore {
    path: PathBuf,
}

impl ProfileStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("connections.json"),
        }
    }

    pub fn load(&self) -> Result<Vec<ConnectionProfile>, AppError> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => serde_json::from_str(&text)
                .map_err(|error| AppError::Io(format!("connections.json is damaged ({error})"))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn save(&self, profiles: &[ConnectionProfile]) -> Result<(), AppError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let json =
            serde_json::to_vec_pretty(profiles).map_err(|error| AppError::Io(error.to_string()))?;
        let temporary = self.path.with_extension("json.tmp");
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(&json)?;
        file.sync_all()?;
        std::fs::rename(&temporary, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::ProviderKind;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kelp-profiles-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn profile(name: &str) -> ConnectionProfile {
        ConnectionProfile {
            id: Uuid::new_v4(),
            name: name.into(),
            settings: ConnectionSettings {
                kind: ProviderKind::Hetzner,
                endpoint: None,
                region: "hel1".into(),
                path_style: false,
                access_key_id: "AKIDEXAMPLE".into(),
            },
            bucket: None,
            last_location: Some(Location {
                bucket: "media".into(),
                prefix: "vimeo/".into(),
            }),
        }
    }

    #[test]
    fn a_missing_file_means_no_connections() {
        assert!(ProfileStore::new(&temp_dir()).load().unwrap().is_empty());
    }

    #[test]
    fn saved_profiles_load_back() {
        let store = ProfileStore::new(&temp_dir());
        let saved = vec![profile("media"), profile("backups")];
        store.save(&saved).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, saved[0].id);
        assert_eq!(loaded[1].name, "backups");
        assert_eq!(loaded[0].last_location, saved[0].last_location);
    }

    #[test]
    fn the_file_uses_camel_case_and_never_holds_a_secret() {
        let dir = temp_dir();
        ProfileStore::new(&dir).save(&[profile("media")]).unwrap();
        let text = std::fs::read_to_string(dir.join("connections.json")).unwrap();
        assert!(text.contains("accessKeyId"));
        assert!(text.contains("lastLocation"));
        assert!(!text.to_lowercase().contains("secret"));
    }

    #[test]
    fn saving_leaves_no_temporary_file_behind() {
        let dir = temp_dir();
        ProfileStore::new(&dir).save(&[profile("media")]).unwrap();
        let names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("connections.json")]);
    }

    #[test]
    fn a_damaged_file_is_reported_not_wiped() {
        let dir = temp_dir();
        std::fs::write(dir.join("connections.json"), "{ not json").unwrap();
        let error = ProfileStore::new(&dir).load().unwrap_err();
        assert!(matches!(error, AppError::Io(message) if message.contains("connections.json")));
        assert_eq!(
            std::fs::read_to_string(dir.join("connections.json")).unwrap(),
            "{ not json"
        );
    }

    #[test]
    fn save_creates_the_folder_if_needed() {
        let dir = temp_dir().join("nested");
        ProfileStore::new(&dir).save(&[profile("media")]).unwrap();
        assert!(dir.join("connections.json").exists());
    }
}
