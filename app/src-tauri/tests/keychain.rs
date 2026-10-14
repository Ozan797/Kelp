use kelp_lib::secrets::{KeychainStore, SecretStore};
use uuid::Uuid;

#[test]
#[ignore = "writes to the real macOS Keychain"]
fn keychain_round_trip() {
    let store = KeychainStore;
    let id = Uuid::new_v4();
    store.set(&id, "kelp-test-secret").unwrap();
    assert_eq!(store.get(&id).unwrap(), "kelp-test-secret");
    store.delete(&id).unwrap();
    assert!(store.get(&id).is_err());
}
