use security_framework::access_control::SecAccessControl;
use security_framework::base::Error;
use security_framework::passwords::{
    AccessControlOptions, PasswordOptions, delete_generic_password_options, generic_password,
    set_generic_password_options,
};
use uuid::Uuid;

use super::protected::Vault;
use super::{KeychainStore, SERVICE, SecretStore, keychain_error};
use crate::error::AppError;

const ITEM_NOT_FOUND: i32 = -25300;
const USER_CANCELED: i32 = -128;
const MISSING_ENTITLEMENT: i32 = -34018;

pub struct KeychainVault;

fn vault_error(error: Error) -> AppError {
    match error.code() {
        USER_CANCELED => AppError::KeychainCancelled,
        MISSING_ENTITLEMENT => AppError::KeychainNotSigned,
        _ => keychain_error(error),
    }
}

fn options(account: &str) -> PasswordOptions {
    let mut options = PasswordOptions::new_generic_password(SERVICE, account);
    options.use_protected_keychain();
    options
}

impl Vault for KeychainVault {
    fn read(&self, account: &str) -> Result<Option<String>, AppError> {
        match generic_password(options(account)) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| AppError::KeychainDamaged),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(None),
            Err(error) => Err(vault_error(error)),
        }
    }

    fn add(&self, account: &str, contents: &str) -> Result<(), AppError> {
        let access =
            SecAccessControl::create_with_flags(AccessControlOptions::USER_PRESENCE.bits())
                .map_err(vault_error)?;
        let mut options = options(account);
        options.set_access_control(access);
        options.set_access_synchronized(Some(false));
        set_generic_password_options(contents.as_bytes(), options).map_err(vault_error)
    }

    fn remove(&self, account: &str) -> Result<(), AppError> {
        match delete_generic_password_options(options(account)) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ITEM_NOT_FOUND => Ok(()),
            Err(error) => Err(vault_error(error)),
        }
    }

    fn read_legacy(&self, id: &Uuid) -> Result<Option<String>, AppError> {
        match KeychainStore::entry(id)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keychain_error(error)),
        }
    }

    fn remove_legacy(&self, id: &Uuid) -> Result<(), AppError> {
        KeychainStore.delete(id)
    }
}

#[cfg(test)]
mod tests {
    use security_framework::base::Error;

    use super::*;

    #[test]
    fn macos_codes_become_kelp_errors() {
        assert_eq!(
            vault_error(Error::from_code(-128)),
            AppError::KeychainCancelled
        );
        assert_eq!(
            vault_error(Error::from_code(-34018)),
            AppError::KeychainNotSigned
        );
        assert!(matches!(
            vault_error(Error::from_code(-25308)),
            AppError::Keychain(_)
        ));
    }
}
