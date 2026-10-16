use std::collections::{HashMap, VecDeque};
use std::ops::Range;
use std::time::{Duration, Instant};

use bytes::Bytes;
use std::sync::Arc;
use tokio::sync::{Mutex, OnceCell};
use tokio::task::JoinSet;

use tauri::http::{Method, Request, Response, StatusCode, header};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::error::AppError;
use crate::providers::{ObjectInfo, StorageProvider};
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

pub const BLOCK: u64 = 1024 * 1024;
pub const MAX_BLOCKS: usize = 32;
pub const READ_AHEAD: u64 = 8;
const INFO_FOR: Duration = Duration::from_secs(60);

type ObjectKey = (Uuid, String, String);
type Slot = (ObjectKey, u64);
type Cell = Arc<OnceCell<Bytes>>;

#[derive(Default)]
struct Held {
    infos: HashMap<ObjectKey, (ObjectInfo, Instant)>,
    blocks: HashMap<Slot, Cell>,
    order: VecDeque<Slot>,
}

#[derive(Default)]
pub struct PreviewCache {
    held: Mutex<Held>,
}

impl PreviewCache {
    pub async fn blocks_held(&self) -> usize {
        let held = self.held.lock().await;
        held.blocks
            .values()
            .filter(|cell| cell.initialized())
            .count()
    }

    async fn forget(&self, object: &ObjectKey) {
        let mut held = self.held.lock().await;
        held.infos.remove(object);
        held.blocks.retain(|(key, _), _| key != object);
        held.order.retain(|(key, _)| key != object);
    }

    async fn info(
        &self,
        object: &ObjectKey,
        provider: &dyn StorageProvider,
    ) -> Result<ObjectInfo, AppError> {
        if let Some((info, at)) = self.held.lock().await.infos.get(object)
            && at.elapsed() < INFO_FOR
        {
            return Ok(info.clone());
        }
        let info = provider.head(&object.1, &object.2).await?;
        self.held
            .lock()
            .await
            .infos
            .insert(object.clone(), (info.clone(), Instant::now()));
        Ok(info)
    }

    async fn cell(&self, slot: Slot) -> Cell {
        let mut held = self.held.lock().await;
        if let Some(cell) = held.blocks.get(&slot) {
            return cell.clone();
        }
        let cell = Cell::default();
        held.blocks.insert(slot.clone(), cell.clone());
        held.order.push_back(slot);
        while held.order.len() > MAX_BLOCKS {
            if let Some(oldest) = held.order.pop_front() {
                held.blocks.remove(&oldest);
            }
        }
        cell
    }

    async fn block(
        self: Arc<Self>,
        object: ObjectKey,
        provider: Arc<dyn StorageProvider>,
        info: ObjectInfo,
        index: u64,
    ) -> Result<Bytes, AppError> {
        let cell = self.cell((object.clone(), index)).await;
        cell.get_or_try_init(|| async {
            let start = index * BLOCK;
            let range = start..(start + BLOCK).min(info.size);
            provider
                .get_bytes(&object.1, &object.2, &info.etag, range)
                .await
        })
        .await
        .cloned()
    }

    fn read_ahead(
        self: &Arc<Self>,
        object: &ObjectKey,
        provider: &Arc<dyn StorageProvider>,
        info: &ObjectInfo,
        after: u64,
    ) {
        let last = info.size.saturating_sub(1) / BLOCK;
        for index in after + 1..=(after + READ_AHEAD).min(last) {
            let job = self
                .clone()
                .block(object.clone(), provider.clone(), info.clone(), index);
            tokio::spawn(async move {
                job.await.ok();
            });
        }
    }

    async fn read(
        self: &Arc<Self>,
        object: &ObjectKey,
        provider: &Arc<dyn StorageProvider>,
        info: &ObjectInfo,
        range: Range<u64>,
    ) -> Result<Vec<u8>, AppError> {
        let (first, last) = (range.start / BLOCK, (range.end - 1) / BLOCK);
        let mut fetching = JoinSet::new();
        for index in first..=last {
            let job = self
                .clone()
                .block(object.clone(), provider.clone(), info.clone(), index);
            fetching.spawn(async move { (index, job.await) });
        }
        let mut blocks = HashMap::new();
        while let Some(joined) = fetching.join_next().await {
            let (index, block) = joined.map_err(|_| AppError::Network)?;
            blocks.insert(index, block?);
        }
        self.read_ahead(object, provider, info, last);
        let mut body = Vec::with_capacity((range.end - range.start) as usize);
        for index in first..=last {
            let block = &blocks[&index];
            let block_start = index * BLOCK;
            let from = range.start.max(block_start) - block_start;
            let to = range.end.min(block_start + block.len() as u64) - block_start;
            body.extend_from_slice(&block[from as usize..to as usize]);
        }
        Ok(body)
    }

    pub async fn respond(
        self: &Arc<Self>,
        connection: Uuid,
        provider: Arc<dyn StorageProvider>,
        bucket: &str,
        key: &str,
        range: Option<&str>,
    ) -> Result<Answer, AppError> {
        let object = (connection, bucket.to_string(), key.to_string());
        match self.answer(&object, &provider, range).await {
            Err(AppError::ObjectChanged) => {
                self.forget(&object).await;
                self.answer(&object, &provider, range).await
            }
            other => other,
        }
    }

    async fn answer(
        self: &Arc<Self>,
        object: &ObjectKey,
        provider: &Arc<dyn StorageProvider>,
        range: Option<&str>,
    ) -> Result<Answer, AppError> {
        let info = self.info(object, provider.as_ref()).await?;
        let content_type = content_type(&object.2);
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
            let body = self.read(object, provider, &info, 0..info.size).await?;
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
        let body = self.read(object, provider, &info, served.clone()).await?;
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
    match app
        .state::<Arc<PreviewCache>>()
        .respond(id, provider, &bucket, &key, range)
        .await
    {
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
    async fn many_tiny_reads_cost_one_head_and_one_fetch() {
        let provider = fake();
        let cache = Arc::new(PreviewCache::default());
        let id = Uuid::new_v4();
        for header in [
            "bytes=0-1",
            "bytes=0-7",
            "bytes=32-39",
            "bytes=148-155",
            "bytes=84625-84632",
        ] {
            let answer = cache
                .respond(id, provider.clone(), "b", "v/clip.mp4", Some(header))
                .await
                .unwrap();
            assert_eq!(answer.status, 206);
        }
        let read = cache
            .respond(id, provider.clone(), "b", "v/clip.mp4", Some("bytes=10-19"))
            .await
            .unwrap();
        assert_eq!(read.body, (10..20).map(|n| n as u8).collect::<Vec<u8>>());
        assert_eq!(provider.calls("head"), 1);
        assert!(provider.calls("get_bytes") <= 1 + READ_AHEAD as usize);
    }

    #[tokio::test]
    async fn playback_reads_ahead_so_the_next_blocks_are_ready() {
        let provider = fake();
        let cache = Arc::new(PreviewCache::default());
        cache
            .respond(
                Uuid::nil(),
                provider.clone(),
                "b",
                "v/clip.mp4",
                Some("bytes=0-99"),
            )
            .await
            .unwrap();
        for _ in 0..200 {
            if cache.blocks_held().await > READ_AHEAD as usize {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        let fetched = provider.calls("get_bytes");
        assert_eq!(fetched, 1 + READ_AHEAD as usize);
        cache
            .respond(
                Uuid::nil(),
                provider.clone(),
                "b",
                "v/clip.mp4",
                Some(&format!("bytes={}-{}", 3 * BLOCK, 3 * BLOCK + 9)),
            )
            .await
            .unwrap();
        assert!(provider.calls("get_bytes") <= fetched + READ_AHEAD as usize);
        assert_eq!(
            cache.blocks_held().await.min(MAX_BLOCKS),
            cache.blocks_held().await
        );
    }

    #[tokio::test]
    async fn two_requests_for_one_block_fetch_it_once() {
        let provider = fake();
        provider.hold();
        let cache = Arc::new(PreviewCache::default());
        let first = {
            let (cache, provider) = (cache.clone(), provider.clone());
            tokio::spawn(async move {
                cache
                    .respond(Uuid::nil(), provider, "b", "v/clip.mp4", Some("bytes=0-9"))
                    .await
            })
        };
        let second = {
            let (cache, provider) = (cache.clone(), provider.clone());
            tokio::spawn(async move {
                cache
                    .respond(Uuid::nil(), provider, "b", "v/clip.mp4", Some("bytes=5-15"))
                    .await
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        provider.release();
        first.await.unwrap().unwrap();
        second.await.unwrap().unwrap();
        let block_zero_fetches = provider.calls("get_bytes");
        assert!(
            block_zero_fetches <= 1 + READ_AHEAD as usize,
            "{block_zero_fetches}"
        );
    }

    #[tokio::test]
    async fn a_read_across_blocks_joins_them() {
        let provider = fake();
        let cache = Arc::new(PreviewCache::default());
        let start = BLOCK - 3;
        let header = format!("bytes={start}-{}", BLOCK + 2);
        let answer = cache
            .respond(
                Uuid::nil(),
                provider.clone(),
                "b",
                "v/clip.mp4",
                Some(&header),
            )
            .await
            .unwrap();
        let expected: Vec<u8> = (start..BLOCK + 3).map(|n| (n % 251) as u8).collect();
        assert_eq!(answer.body, expected);
    }

    #[tokio::test]
    async fn the_cache_forgets_old_blocks() {
        let provider = fake();
        let cache = Arc::new(PreviewCache::default());
        for block in 0..(MAX_BLOCKS as u64 + 1) {
            let at = (block * BLOCK) % (20 * 1024 * 1024);
            let header = format!("bytes={at}-{at}");
            cache
                .respond(
                    Uuid::nil(),
                    provider.clone(),
                    "b",
                    "v/clip.mp4",
                    Some(&header),
                )
                .await
                .unwrap();
        }
        assert!(cache.blocks_held().await <= MAX_BLOCKS);
    }

    #[tokio::test]
    async fn a_whole_small_file_comes_back_as_200() {
        let provider =
            Arc::new(FakeProvider::empty().with_objects(vec![("a.txt", b"hello".to_vec())]));
        let answer = Arc::new(PreviewCache::default())
            .respond(Uuid::nil(), provider.clone(), "b", "a.txt", None)
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
        let first = Arc::new(PreviewCache::default())
            .respond(
                Uuid::nil(),
                provider.clone(),
                "b",
                "v/clip.mp4",
                Some("bytes=0-"),
            )
            .await
            .unwrap();
        assert_eq!(first.status, 206);
        assert_eq!(first.body.len(), 8 * 1024 * 1024);
        assert_eq!(
            first.content_range.as_deref(),
            Some(format!("bytes 0-8388607/{size}").as_str())
        );
        let later = Arc::new(PreviewCache::default())
            .respond(
                Uuid::nil(),
                provider.clone(),
                "b",
                "v/clip.mp4",
                Some("bytes=10-19"),
            )
            .await
            .unwrap();
        assert_eq!(later.body, (10..20).map(|n| n as u8).collect::<Vec<u8>>());
    }

    #[tokio::test]
    async fn a_big_file_without_a_range_still_comes_in_pieces() {
        let answer = Arc::new(PreviewCache::default())
            .respond(Uuid::nil(), fake(), "b", "v/clip.mp4", None)
            .await
            .unwrap();
        assert_eq!(answer.status, 206);
        assert_eq!(answer.body.len(), 8 * 1024 * 1024);
    }

    #[tokio::test]
    async fn an_empty_file_is_an_empty_answer_even_with_a_range() {
        let provider = Arc::new(FakeProvider::empty().with_objects(vec![("e.txt", Vec::new())]));
        let answer = Arc::new(PreviewCache::default())
            .respond(
                Uuid::nil(),
                provider.clone(),
                "b",
                "e.txt",
                Some("bytes=0-1048575"),
            )
            .await
            .unwrap();
        assert_eq!((answer.status, answer.body.len()), (200, 0));
    }

    #[tokio::test]
    async fn a_range_past_the_end_is_refused() {
        let answer = Arc::new(PreviewCache::default())
            .respond(
                Uuid::nil(),
                fake(),
                "b",
                "v/clip.mp4",
                Some("bytes=999999999-"),
            )
            .await
            .unwrap();
        assert_eq!(answer.status, 416);
    }
}
