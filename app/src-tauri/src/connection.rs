use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    S3,
    R2,
    Hetzner,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionSettings {
    pub kind: ProviderKind,
    pub endpoint: Option<String>,
    pub region: String,
    pub path_style: bool,
    pub access_key_id: String,
}

impl ConnectionSettings {
    pub fn signing_region(&self) -> Result<String, AppError> {
        match self.kind {
            ProviderKind::Hetzner => hetzner_location(&self.region),
            ProviderKind::S3 | ProviderKind::R2 => Ok(self.region.trim().to_string()),
        }
    }

    pub fn endpoint_url(&self) -> Result<Option<String>, AppError> {
        if let Some(endpoint) = &self.endpoint {
            return Ok(Some(endpoint.trim().trim_end_matches('/').to_string()));
        }
        match self.kind {
            ProviderKind::S3 => Ok(None),
            ProviderKind::R2 => Err(AppError::InvalidSettings(
                "Cloudflare R2 needs an endpoint: https://<account id>.r2.cloudflarestorage.com"
                    .into(),
            )),
            ProviderKind::Hetzner => {
                let location = hetzner_location(&self.region)?;
                Ok(Some(format!("https://{location}.your-objectstorage.com")))
            }
        }
    }
}

fn hetzner_location(typed: &str) -> Result<String, AppError> {
    let host = typed
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    let location = host
        .strip_suffix(".your-objectstorage.com")
        .unwrap_or(&host);
    if location.is_empty()
        || !location
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
    {
        return Err(AppError::InvalidSettings(
            "Enter the Hetzner location as a plain name, such as fsn1, nbg1 or hel1.".into(),
        ));
    }
    Ok(location.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(kind: ProviderKind, region: &str, endpoint: Option<&str>) -> ConnectionSettings {
        ConnectionSettings {
            kind,
            endpoint: endpoint.map(String::from),
            region: region.into(),
            path_style: false,
            access_key_id: "AKIDEXAMPLE".into(),
        }
    }

    #[test]
    fn hetzner_endpoint_comes_from_the_location() {
        let s = settings(ProviderKind::Hetzner, "fsn1", None);
        assert_eq!(
            s.endpoint_url(),
            Ok(Some("https://fsn1.your-objectstorage.com".into()))
        );
    }

    #[test]
    fn amazon_s3_uses_the_aws_default() {
        assert_eq!(
            settings(ProviderKind::S3, "eu-west-2", None).endpoint_url(),
            Ok(None)
        );
    }

    #[test]
    fn a_custom_endpoint_wins_and_loses_its_trailing_slash() {
        let s = settings(
            ProviderKind::R2,
            "auto",
            Some(" https://abc123.r2.cloudflarestorage.com/ "),
        );
        assert_eq!(
            s.endpoint_url(),
            Ok(Some("https://abc123.r2.cloudflarestorage.com".into()))
        );
    }

    #[test]
    fn r2_without_an_endpoint_is_explained() {
        let error = settings(ProviderKind::R2, "auto", None)
            .endpoint_url()
            .unwrap_err();
        assert!(
            matches!(error, AppError::InvalidSettings(m) if m.contains("r2.cloudflarestorage.com"))
        );
    }

    #[test]
    fn hetzner_accepts_the_endpoint_host_people_copy_from_the_console() {
        for typed in [
            "hel1",
            "HEL1",
            "hel1.your-objectstorage.com",
            " https://hel1.your-objectstorage.com/ ",
        ] {
            let s = settings(ProviderKind::Hetzner, typed, None);
            assert_eq!(
                s.endpoint_url(),
                Ok(Some("https://hel1.your-objectstorage.com".into())),
                "{typed:?}"
            );
            assert_eq!(s.signing_region(), Ok("hel1".into()), "{typed:?}");
        }
    }

    #[test]
    fn other_providers_sign_with_the_region_as_entered() {
        assert_eq!(
            settings(ProviderKind::S3, "eu-west-2", None).signing_region(),
            Ok("eu-west-2".into())
        );
        let r2 = settings(
            ProviderKind::R2,
            "auto",
            Some("https://x.r2.cloudflarestorage.com"),
        );
        assert_eq!(r2.signing_region(), Ok("auto".into()));
    }

    #[test]
    fn hetzner_location_must_be_a_plain_name() {
        // The location becomes part of a host name, so anything but letters and digits is rejected.
        for bad in ["", "fsn1.evil.com/", "FSN 1"] {
            let error = settings(ProviderKind::Hetzner, bad, None)
                .endpoint_url()
                .unwrap_err();
            assert!(
                matches!(error, AppError::InvalidSettings(m) if m.contains("fsn1")),
                "accepted {bad:?}"
            );
        }
    }
}
