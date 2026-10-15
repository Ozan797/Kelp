use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: Theme,
}

pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn new(dir: &Path) -> Self {
        Self {
            path: dir.join("settings.json"),
        }
    }

    pub fn load(&self) -> Settings {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, settings: &Settings) -> Result<(), AppError> {
        crate::json_file::write(&self.path, settings)
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use uuid::Uuid;

    use super::*;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("kelp-settings-{}", Uuid::new_v4()))
    }

    #[test]
    fn settings_follow_the_system_until_changed() {
        assert_eq!(SettingsStore::new(&temp_dir()).load().theme, Theme::System);
    }

    #[test]
    fn settings_are_saved_and_loaded() {
        let store = SettingsStore::new(&temp_dir());
        store.save(&Settings { theme: Theme::Dark }).unwrap();
        assert_eq!(store.load(), Settings { theme: Theme::Dark });
    }

    #[test]
    fn a_damaged_settings_file_falls_back_to_the_defaults() {
        let dir = temp_dir();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), "{ nope").unwrap();
        assert_eq!(SettingsStore::new(&dir).load(), Settings::default());
    }

    #[test]
    fn the_theme_is_written_in_lower_case() {
        let json = serde_json::to_string(&Settings {
            theme: Theme::Light,
        })
        .unwrap();
        assert_eq!(json, r#"{"theme":"light"}"#);
    }
}
