use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use tokio::time::sleep;

#[derive(Clone)]
pub struct RateLimiter {
    bytes_per_second: Arc<AtomicU64>,
    state: Arc<Mutex<LimiterState>>,
}

struct LimiterState {
    tokens: f64,
    last_refill: Instant,
}

impl RateLimiter {
    pub fn new(bytes_per_second: u64) -> Self {
        Self {
            bytes_per_second: Arc::new(AtomicU64::new(bytes_per_second)),
            state: Arc::new(Mutex::new(LimiterState {
                tokens: bytes_per_second as f64,
                last_refill: Instant::now(),
            })),
        }
    }

    pub fn set_limit(&self, bytes_per_second: u64) {
        self.bytes_per_second.store(bytes_per_second, Ordering::Relaxed);
    }

    pub fn get_limit(&self) -> u64 {
        self.bytes_per_second.load(Ordering::Relaxed)
    }

    pub async fn acquire(&self, count: usize) {
        let limit = self.bytes_per_second.load(Ordering::Relaxed);
        if limit == 0 {
            return; // Unlimited
        }

        let max_tokens = limit as f64;
        let requested = count as f64;

        loop {
            let mut state = self.state.lock().await;
            let now = Instant::now();
            let elapsed = now.duration_since(state.last_refill).as_secs_f64();
            state.last_refill = now;

            // Refill tokens
            state.tokens = (state.tokens + elapsed * max_tokens).min(max_tokens);

            if state.tokens >= requested {
                state.tokens -= requested;
                return;
            }

            // Need to wait for tokens
            let missing = requested - state.tokens;
            let wait_secs = (missing / max_tokens).max(0.01).min(1.0);
            drop(state);

            sleep(std::time::Duration::from_secs_f64(wait_secs)).await;
        }
    }
}
