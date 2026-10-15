use std::ops::Range;

use tauri::http::{Method, Request, Response, StatusCode, header};
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

pub fn parse_preview_address(path: &str, query: Option<&str>) -> Option<(Uuid, String, String)> {
    let id = Uuid::parse_str(path.trim_start_matches('/')).ok()?;
    let (mut bucket, mut key) = (None, None);
    for pair in query?.split('&') {
        let (name, value) = pair.split_once('=')?;
        match name {
            "bucket" => bucket = Some(decode(value)?),
            "key" => key = Some(decode(value)?),
            _ => {}
        }
    }
    let (bucket, key) = (bucket?, key?);
    (!bucket.is_empty() && !key.is_empty()).then_some((id, bucket, key))
}

pub fn allowed_origin(origin: Option<&str>) -> Option<&str> {
    let origin = origin?;
    let ours = origin == "tauri://localhost"
        || origin == "http://tauri.localhost"
        || origin.starts_with("http://localhost:");
    ours.then_some(origin)
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
    if info.size == 0 {
        return Ok(Answer {
            status: 200,
            content_type,
            content_range: None,
            body: Vec::new(),
        });
    }
    let range = range.or((info.size > PIECE).then_some("bytes=0-"));
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

fn reply(origin: Option<&str>, status: StatusCode) -> tauri::http::response::Builder {
    let builder = Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Content-Range");
    match allowed_origin(origin) {
        Some(origin) => builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin),
        None => builder,
    }
}

fn plain(origin: Option<&str>, status: StatusCode, message: String) -> Response<Vec<u8>> {
    reply(origin, status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.into_bytes())
        .unwrap_or_default()
}

pub async fn handle(app: &AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let origin = origin.as_deref();
    if request.method() == Method::OPTIONS {
        return reply(origin, StatusCode::NO_CONTENT)
            .body(Vec::new())
            .unwrap_or_default();
    }
    if request.method() != Method::GET {
        return plain(origin, StatusCode::METHOD_NOT_ALLOWED, "Only GET".into());
    }
    let Some((id, bucket, key)) =
        parse_preview_address(request.uri().path(), request.uri().query())
    else {
        return plain(origin, StatusCode::NOT_FOUND, "Not found".into());
    };
    let provider = match app.state::<AppState>().provider(id).await {
        Ok(provider) => provider,
        Err(error) => return plain(origin, StatusCode::NOT_FOUND, error.to_string()),
    };
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok());
    match respond(provider.as_ref(), &bucket, &key, range).await {
        Ok(answer) => {
            let mut response = reply(
                origin,
                StatusCode::from_u16(answer.status).unwrap_or(StatusCode::OK),
            )
            .header(header::CONTENT_TYPE, answer.content_type)
            .header(header::ACCEPT_RANGES, "bytes");
            if let Some(content_range) = answer.content_range {
                response = response.header(header::CONTENT_RANGE, content_range);
            }
            response.body(answer.body).unwrap_or_default()
        }
        Err(error) => plain(origin, StatusCode::BAD_GATEWAY, error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use uuid::Uuid;

    use super::*;
    use crate::testing::FakeProvider;

    #[test]
    fn preview_addresses_round_trip_awkward_keys() {
        let id = Uuid::new_v4();
        let path = format!("/{id}");
        let query = "bucket=media%20archive&key=a%20b%23c%3Fd%2F..%2F%C3%BC%2B.txt";
        assert_eq!(
            parse_preview_address(&path, Some(query)),
            Some((
                id,
                "media archive".to_string(),
                "a b#c?d/../ü+.txt".to_string()
            ))
        );
        assert_eq!(
            parse_preview_address("/not-a-uuid", Some("bucket=b&key=k")),
            None
        );
        assert_eq!(parse_preview_address(&path, Some("bucket=b")), None);
        assert_eq!(
            parse_preview_address(&path, Some("bucket=b&key=bad%zz")),
            None
        );
        assert_eq!(parse_preview_address(&path, None), None);
    }

    #[test]
    fn only_the_app_itself_may_read_previews() {
        assert_eq!(
            allowed_origin(Some("tauri://localhost")),
            Some("tauri://localhost")
        );
        assert_eq!(
            allowed_origin(Some("http://localhost:1420")),
            Some("http://localhost:1420")
        );
        assert_eq!(allowed_origin(Some("https://evil.example")), None);
        assert_eq!(allowed_origin(None), None);
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
    async fn a_big_file_without_a_range_still_comes_in_pieces() {
        let answer = respond(fake().as_ref(), "b", "v/clip.mp4", None)
            .await
            .unwrap();
        assert_eq!(answer.status, 206);
        assert_eq!(answer.body.len(), 8 * 1024 * 1024);
    }

    #[tokio::test]
    async fn an_empty_file_is_an_empty_answer_even_with_a_range() {
        let provider = Arc::new(FakeProvider::empty().with_objects(vec![("e.txt", Vec::new())]));
        let answer = respond(provider.as_ref(), "b", "e.txt", Some("bytes=0-1048575"))
            .await
            .unwrap();
        assert_eq!((answer.status, answer.body.len()), (200, 0));
    }

    #[tokio::test]
    async fn a_range_past_the_end_is_refused() {
        let answer = respond(fake().as_ref(), "b", "v/clip.mp4", Some("bytes=999999999-"))
            .await
            .unwrap();
        assert_eq!(answer.status, 416);
    }
}
