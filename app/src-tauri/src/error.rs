use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
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
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
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
    fn serialises_to_the_readable_message() {
        let json = serde_json::to_string(&AppError::AccessDenied).unwrap();
        assert_eq!(json, format!("\"{}\"", AppError::AccessDenied));
    }
}
