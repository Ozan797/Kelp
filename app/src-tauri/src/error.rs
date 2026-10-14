use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum AppError {
    #[error("{0}")]
    InvalidSettings(String),

    #[error("Access denied. Check that this key is allowed to read the bucket.")]
    AccessDenied,

    #[error(
        "The bucket \"{0}\" doesn't exist, or this key can't see it. Check the name and the region."
    )]
    BucketNotFound(String),

    #[error("The secret key doesn't match the access key ID. Copy both again from your provider.")]
    BadCredentials,

    #[error(
        "Your Mac's clock is too far off for the provider. Turn on \"Set time and date automatically\" in System Settings."
    )]
    ClockWrong,

    #[error(
        "Kelp couldn't reach the storage provider. Check the endpoint and your internet connection."
    )]
    Network,

    #[error("The storage provider returned an error: {0}")]
    Provider(String),

    #[error("This key can't list buckets. Enter the bucket you want to open.")]
    NotListable,

    #[error(
        "Kelp couldn't use the macOS Keychain: {0}. Try again, and restart your Mac if it keeps happening."
    )]
    Keychain(String),

    #[error("Kelp couldn't read or write a file on this Mac: {0}")]
    Io(String),

    #[error("This file is larger than 5 GB. Uploads this large arrive in a later version of Kelp.")]
    FileTooLarge,

    #[error("This connection no longer exists. Add it again.")]
    ConnectionNotFound,

    #[error("A file named \"{0}\" is already in this folder.")]
    AlreadyExists(String),
}

impl AppError {
    pub fn from_provider_code(code: Option<&str>, message: Option<&str>, bucket: &str) -> Self {
        match code {
            Some("AccessDenied") => Self::AccessDenied,
            Some("NoSuchBucket") => Self::BucketNotFound(bucket.to_string()),
            Some("SignatureDoesNotMatch" | "InvalidAccessKeyId") => Self::BadCredentials,
            Some("RequestTimeTooSkewed") => Self::ClockWrong,
            _ => Self::Provider(message.or(code).unwrap_or("unknown error").to_string()),
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::InvalidSettings(_) => "invalidSettings",
            Self::AccessDenied => "accessDenied",
            Self::BucketNotFound(_) => "bucketNotFound",
            Self::BadCredentials => "badCredentials",
            Self::ClockWrong => "clockWrong",
            Self::Network => "network",
            Self::Provider(_) => "provider",
            Self::NotListable => "notListable",
            Self::Keychain(_) => "keychain",
            Self::Io(_) => "io",
            Self::FileTooLarge => "fileTooLarge",
            Self::ConnectionNotFound => "connectionNotFound",
            Self::AlreadyExists(_) => "alreadyExists",
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut fields = serializer.serialize_struct("AppError", 2)?;
        fields.serialize_field("kind", self.kind())?;
        fields.serialize_field("message", &self.to_string())?;
        fields.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_codes_become_friendly_errors() {
        let from = |code| AppError::from_provider_code(Some(code), Some("raw message"), "photos");
        assert_eq!(from("AccessDenied"), AppError::AccessDenied);
        assert_eq!(
            from("NoSuchBucket"),
            AppError::BucketNotFound("photos".into())
        );
        assert_eq!(from("SignatureDoesNotMatch"), AppError::BadCredentials);
        assert_eq!(from("InvalidAccessKeyId"), AppError::BadCredentials);
        assert_eq!(from("RequestTimeTooSkewed"), AppError::ClockWrong);
    }

    #[test]
    fn unknown_codes_keep_the_providers_message() {
        let error = AppError::from_provider_code(
            Some("SlowDown"),
            Some("Please reduce your request rate."),
            "b",
        );
        assert_eq!(
            error,
            AppError::Provider("Please reduce your request rate.".into())
        );
    }

    #[test]
    fn missing_message_falls_back_to_the_code_then_a_generic_text() {
        assert_eq!(
            AppError::from_provider_code(Some("Weird"), None, "b"),
            AppError::Provider("Weird".into())
        );
        assert_eq!(
            AppError::from_provider_code(None, None, "b"),
            AppError::Provider("unknown error".into())
        );
    }

    #[test]
    fn serialises_kind_and_message_for_the_ui() {
        let value = serde_json::to_value(AppError::BadCredentials).unwrap();
        assert_eq!(value["kind"], "badCredentials");
        assert_eq!(value["message"], AppError::BadCredentials.to_string());
    }

    #[test]
    fn every_variant_has_a_camel_case_kind() {
        let cases = [
            (AppError::InvalidSettings("x".into()), "invalidSettings"),
            (AppError::AccessDenied, "accessDenied"),
            (AppError::BucketNotFound("b".into()), "bucketNotFound"),
            (AppError::BadCredentials, "badCredentials"),
            (AppError::ClockWrong, "clockWrong"),
            (AppError::Network, "network"),
            (AppError::Provider("x".into()), "provider"),
            (AppError::NotListable, "notListable"),
            (AppError::Keychain("x".into()), "keychain"),
            (AppError::Io("x".into()), "io"),
            (AppError::FileTooLarge, "fileTooLarge"),
            (AppError::ConnectionNotFound, "connectionNotFound"),
            (AppError::AlreadyExists("a.txt".into()), "alreadyExists"),
        ];
        for (error, kind) in cases {
            assert_eq!(error.kind(), kind);
        }
    }

    #[test]
    fn io_errors_become_io() {
        let error: AppError =
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied").into();
        assert!(matches!(error, AppError::Io(message) if message.contains("denied")));
    }
}
