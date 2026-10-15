use std::collections::HashMap;

use kelp_lib::connection::{ConnectionSettings, ProviderKind};
use kelp_lib::providers::StorageProvider;
use kelp_lib::providers::s3::S3Provider;

fn load_env_file() -> HashMap<String, String> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/.env.test");
    let text = std::fs::read_to_string(path)
        .expect("create app/src-tauri/.env.test first (see this file's header)");
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| {
            (
                key.trim().to_string(),
                value.trim().trim_matches('"').to_string(),
            )
        })
        .collect()
}

#[tokio::test]
#[ignore = "needs real Hetzner keys in .env.test"]
async fn lists_a_real_hetzner_bucket() {
    let env = load_env_file();
    let get = |key: &str| {
        env.get(key)
            .cloned()
            .unwrap_or_else(|| panic!("{key} is missing from .env.test"))
    };

    let settings = ConnectionSettings {
        kind: ProviderKind::Hetzner,
        endpoint: None,
        region: get("KELP_TEST_REGION"),
        path_style: false,
        access_key_id: get("KELP_TEST_ACCESS_KEY_ID"),
    };
    let provider = S3Provider::new(&settings, &get("KELP_TEST_SECRET_ACCESS_KEY"))
        .expect("settings are valid");
    let bucket = get("KELP_TEST_BUCKET");

    let page = provider
        .list(&bucket, "", None)
        .await
        .unwrap_or_else(|error| panic!("listing {bucket} failed: {error}"));

    println!(
        "folders ({}): {:?}",
        page.folders.len(),
        page.folders.iter().take(5).collect::<Vec<_>>()
    );
    println!("objects ({}):", page.objects.len());
    for object in page.objects.iter().take(5) {
        println!(
            "  {}  {} bytes  {}",
            object.key,
            object.size,
            object.last_modified.as_deref().unwrap_or("-")
        );
    }
    println!("more pages: {}", page.next_token.is_some());

    assert!(
        !page.folders.is_empty() || !page.objects.is_empty(),
        "the bucket looks empty"
    );

    if let Some(folder) = page.folders.first() {
        let inner = provider
            .list(&bucket, folder, None)
            .await
            .expect("listing a folder works");
        println!(
            "inside {folder}: {} folders, {} objects",
            inner.folders.len(),
            inner.objects.len()
        );
        assert!(
            inner
                .objects
                .iter()
                .all(|object| object.key.starts_with(folder.as_str()))
        );
    }
}

fn real_provider(env: &HashMap<String, String>) -> S3Provider {
    let get = |key: &str| {
        env.get(key)
            .cloned()
            .unwrap_or_else(|| panic!("{key} is missing from .env.test"))
    };
    let settings = ConnectionSettings {
        kind: ProviderKind::Hetzner,
        endpoint: None,
        region: get("KELP_TEST_REGION"),
        path_style: false,
        access_key_id: get("KELP_TEST_ACCESS_KEY_ID"),
    };
    S3Provider::new(&settings, &get("KELP_TEST_SECRET_ACCESS_KEY")).expect("settings are valid")
}

#[tokio::test]
#[ignore = "needs real Hetzner keys in .env.test"]
async fn round_trips_a_small_file() {
    let env = load_env_file();
    let provider = real_provider(&env);
    let bucket = env["KELP_TEST_BUCKET"].clone();
    assert!(
        provider
            .list_buckets()
            .await
            .expect("list buckets")
            .contains(&bucket)
    );

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let folder = format!("kelp-test-{stamp}/");
    let key = format!("{folder}hello.txt");
    let scratch = std::env::temp_dir().join(format!("kelp-roundtrip-{stamp}"));
    std::fs::create_dir_all(&scratch).unwrap();
    let source = scratch.join("hello.txt");
    std::fs::write(&source, b"hello from kelp").unwrap();

    provider
        .create_folder(&bucket, &folder)
        .await
        .expect("create folder");
    let sent = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let sent_seen = sent.clone();
    provider
        .put_file(
            &bucket,
            &key,
            &source,
            std::sync::Arc::new(move |n| sent_seen.store(n, std::sync::atomic::Ordering::SeqCst)),
        )
        .await
        .expect("upload");
    assert_eq!(sent.load(std::sync::atomic::Ordering::SeqCst), 15);

    let target = scratch.join("downloaded.txt");
    let info = provider.head(&bucket, &key).await.expect("head");
    assert_eq!(info.size, 15);
    std::fs::write(&target, vec![0; 15]).unwrap();
    provider
        .get_range(
            &bucket,
            &key,
            &info.etag,
            0..15,
            &target,
            std::sync::Arc::new(|_| {}),
        )
        .await
        .expect("download");
    assert_eq!(std::fs::read(&target).unwrap(), b"hello from kelp");

    let keys: Vec<String> = provider
        .list_keys(&bucket, &folder, None)
        .await
        .expect("list keys")
        .objects
        .into_iter()
        .map(|object| object.key)
        .collect();
    assert_eq!(keys.len(), 2);
    provider.delete(&bucket, &keys).await.expect("delete");
    assert!(
        provider
            .list_keys(&bucket, &folder, None)
            .await
            .unwrap()
            .objects
            .is_empty()
    );
}
