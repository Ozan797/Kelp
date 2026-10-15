use std::time::Duration;

use crate::error::AppError;

const LONGEST_WAIT_SECS: u64 = 30;

pub fn is_retryable(error: &AppError) -> bool {
    matches!(error, AppError::Network | AppError::Busy)
}

pub fn backoff(attempt: u32, jitter: f64) -> Duration {
    let doubling = 1u64 << attempt.saturating_sub(1).min(16);
    let base = doubling.min(LONGEST_WAIT_SECS) as f64;
    Duration::from_secs_f64(base * (1.0 + jitter.clamp(0.0, 1.0) / 2.0))
}

pub fn jitter() -> f64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.subsec_nanos())
        .unwrap_or(0);
    f64::from(nanos) / 1_000_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_network_and_busy_errors_are_retried() {
        assert!(is_retryable(&AppError::Network) && is_retryable(&AppError::Busy));
        assert!(!is_retryable(&AppError::AccessDenied) && !is_retryable(&AppError::ObjectChanged));
    }

    #[test]
    fn backoff_doubles_from_one_second_and_stops_at_thirty() {
        assert_eq!(backoff(1, 0.0), Duration::from_secs(1));
        assert_eq!(backoff(5, 0.0), Duration::from_secs(16));
        assert_eq!(backoff(9, 0.0), Duration::from_secs(30));
    }

    #[test]
    fn jitter_adds_at_most_half() {
        assert_eq!(backoff(2, 1.0), Duration::from_secs(3));
        let value = jitter();
        assert!((0.0..=1.0).contains(&value));
    }
}
