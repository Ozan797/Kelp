use std::ops::Range;

use tauri::http::{Request, Response, StatusCode, header};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::error::AppError;
use crate::providers::StorageProvider;
use crate::state::AppState;

const PIECE: u64 = 8 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub struct Answer {
    pub status: u16,
    pub content_type: &'static str,
    pub content_range: Option<String>,
    pub body: Vec<u8>,
}

fn decode(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = segment.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn parse_preview_path(path: &str) -> Option<(Uuid, String, String)> {
    let mut parts = path.trim_start_matches('/').splitn(3, '/');
    let id = Uuid::parse_str(parts.next()?).ok()?;
    let bucket = decode(parts.next()?)?;
    let key = parts
        .next()?
        .split('/')
        .map(decode)
        .collect::<Option<Vec<_>>>()?
        .join("/");
    if bucket.is_empty() || key.is_empty() {
        return None;
    }
    Some((id, bucket, key))
}

pub fn parse_range(header: &str, size: u64) -> Option<Range<u64>> {
    let (start, end) = header.strip_prefix("bytes=")?.split_once('-')?;
    let range = if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        size.saturating_sub(suffix)..size
    } else {
        let first: u64 = start.parse().ok()?;
        let last = if end.is_empty() {
            size.saturating_sub(1)
        } else {
            end.parse::<u64>().ok()?.min(size.saturating_sub(1))
        };
        first..last.saturating_add(1)
    };
    (range.start < range.end && range.end <= size).then_some(range)
}

pub fn content_type(key: &str) -> &'static str {
    let extension = key
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "avif" => "image/avif",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "json" => "application/json",
        "txt" | "md" | "csv" | "log" | "yml" | "yaml" | "xml" | "html" => {
            "text/plain; charset=utf-8"
        }
        _ => "application/octet-stream",
    }
}

pub async fn respond(
    provider: &dyn StorageProvider,
    bucket: &str,
    key: &str,
    range: Option<&str>,
) -> Result<Answer, AppError> {
    let info = provider.head(bucket, key).await?;
    let content_type = content_type(key);
    let Some(header) = range else {
        let body = if info.size == 0 {
            Vec::new()
        } else {
            provider
                .get_bytes(bucket, key, &info.etag, 0..info.size)
                .await?
                .to_vec()
        };
        return Ok(Answer {
            status: 200,
            content_type,
            content_range: None,
            body,
        });
    };
    let Some(wanted) = parse_range(header, info.size) else {
        return Ok(Answer {
            status: 416,
            content_type,
            content_range: Some(format!("bytes */{}", info.size)),
            body: Vec::new(),
        });
    };
    let served = wanted.start..wanted.end.min(wanted.start + PIECE);
    let body = provider
        .get_bytes(bucket, key, &info.etag, served.clone())
        .await?
        .to_vec();
    Ok(Answer {
        status: 206,
        content_type,
        content_range: Some(format!(
            "bytes {}-{}/{}",
            served.start,
            served.end - 1,
            info.size
        )),
        body,
    })
}

fn plain(status: StatusCode, message: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.into_bytes())
        .unwrap_or_default()
}

pub async fn handle(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some((id, bucket, key)) = parse_preview_path(request.uri().path()) else {
        return plain(StatusCode::NOT_FOUND, "Not found".into());
    };
    let provider = match app.state::<AppState>().provider(id).await {
        Ok(provider) => provider,
        Err(error) => return plain(StatusCode::NOT_FOUND, error.to_string()),
    };
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    match respond(provider.as_ref(), &bucket, &key, range).await {
        Ok(answer) => {
            let mut response = Response::builder()
                .status(answer.status)
                .header(header::CONTENT_TYPE, answer.content_type)
                .header(header::ACCEPT_RANGES, "bytes");
            if let Some(content_range) = answer.content_range {
                response = response.header(header::CONTENT_RANGE, content_range);
            }
            response.body(answer.body).unwrap_or_default()
        }
        Err(error) => plain(StatusCode::BAD_GATEWAY, error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use uuid::Uuid;

    use super::*;
    use crate::testing::FakeProvider;

    #[test]
    fn preview_paths_round_trip_awkward_keys() {
        let id = Uuid::new_v4();
        let path = format!("/{id}/media%20archive/a%20b%23c%3Fd/%C3%BC.txt");
        assert_eq!(
            parse_preview_path(&path),
            Some((id, "media archive".to_string(), "a b#c?d/ü.txt".to_string()))
        );
        assert_eq!(parse_preview_path("/not-a-uuid/b/k"), None);
        assert_eq!(parse_preview_path(&format!("/{id}/bucket")), None);
        assert_eq!(parse_preview_path(&format!("/{id}/b/bad%zz")), None);
    }

    #[test]
    fn ranges_follow_the_http_rules() {
        assert_eq!(parse_range("bytes=0-", 100), Some(0..100));
        assert_eq!(parse_range("bytes=10-19", 100), Some(10..20));
        assert_eq!(parse_range("bytes=90-200", 100), Some(90..100));
        assert_eq!(parse_range("bytes=-5", 100), Some(95..100));
        for bad in [
            "bytes=50-10",
            "bytes=100-",
            "items=0-1",
            "bytes=a-b",
            "bytes=-0",
        ] {
            assert_eq!(parse_range(bad, 100), None, "{bad}");
        }
    }

    #[test]
    fn content_types_come_from_the_extension() {
        let cases = [
            ("a.JPG", "image/jpeg"),
            ("a.png", "image/png"),
            ("a.gif", "image/gif"),
            ("a.webp", "image/webp"),
            ("a.mp4", "video/mp4"),
            ("a.mov", "video/quicktime"),
            ("a.txt", "text/plain; charset=utf-8"),
            ("a.md", "text/plain; charset=utf-8"),
            ("a.json", "application/json"),
            ("a.bin", "application/octet-stream"),
        ];
        for (key, kind) in cases {
            assert_eq!(content_type(key), kind, "{key}");
        }
    }

    fn fake() -> Arc<FakeProvider> {
        let bytes: Vec<u8> = (0..20 * 1024 * 1024).map(|n| (n % 251) as u8).collect();
        Arc::new(FakeProvider::empty().with_objects(vec![("v/clip.mp4", bytes)]))
    }

    #[tokio::test]
    async fn a_whole_small_file_comes_back_as_200() {
        let provider =
            Arc::new(FakeProvider::empty().with_objects(vec![("a.txt", b"hello".to_vec())]));
        let answer = respond(provider.as_ref(), "b", "a.txt", None)
            .await
            .unwrap();
        assert_eq!(answer.status, 200);
        assert_eq!(answer.body, b"hello");
        assert_eq!(answer.content_type, "text/plain; charset=utf-8");
        assert_eq!(answer.content_range, None);
    }

    #[tokio::test]
    async fn video_is_served_in_pieces_so_it_can_seek() {
        let provider = fake();
        let size = 20 * 1024 * 1024;
        let first = respond(provider.as_ref(), "b", "v/clip.mp4", Some("bytes=0-"))
            .await
            .unwrap();
        assert_eq!(first.status, 206);
        assert_eq!(first.body.len(), 8 * 1024 * 1024);
        assert_eq!(
            first.content_range.as_deref(),
            Some(format!("bytes 0-8388607/{size}").as_str())
        );
        let later = respond(provider.as_ref(), "b", "v/clip.mp4", Some("bytes=10-19"))
            .await
            .unwrap();
        assert_eq!(later.body, (10..20).map(|n| n as u8).collect::<Vec<u8>>());
    }

    #[tokio::test]
    async fn a_range_past_the_end_is_refused() {
        let answer = respond(fake().as_ref(), "b", "v/clip.mp4", Some("bytes=999999999-"))
            .await
            .unwrap();
        assert_eq!(answer.status, 416);
    }
}
