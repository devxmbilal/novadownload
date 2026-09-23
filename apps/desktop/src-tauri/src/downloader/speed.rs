use std::collections::VecDeque;
use std::time::Instant;

#[derive(Debug, Clone)]
struct ByteSample {
    timestamp: Instant,
    bytes: i64,
}

#[derive(Debug)]
pub struct SpeedTracker {
    window_duration_secs: f64,
    samples: VecDeque<ByteSample>,
    start_time: Instant,
    initial_downloaded: i64,
    total_bytes: Option<i64>,
}

impl SpeedTracker {
    pub fn new(initial_downloaded: i64, total_bytes: Option<i64>, window_duration_secs: f64) -> Self {
        let now = Instant::now();
        let mut samples = VecDeque::new();
        samples.push_back(ByteSample {
            timestamp: now,
            bytes: initial_downloaded,
        });

        Self {
            window_duration_secs,
            samples,
            start_time: now,
            initial_downloaded,
            total_bytes,
        }
    }

    pub fn record_progress(&mut self, current_downloaded: i64) -> (f64, f64, Option<i64>) {
        let now = Instant::now();
        self.samples.push_back(ByteSample {
            timestamp: now,
            bytes: current_downloaded,
        });

        // Prune old samples beyond the window duration
        while let Some(front) = self.samples.front() {
            if now.duration_since(front.timestamp).as_secs_f64() > self.window_duration_secs && self.samples.len() > 2 {
                self.samples.pop_front();
            } else {
                break;
            }
        }

        // Calculate current speed from window
        let current_speed = if let (Some(first), Some(last)) = (self.samples.front(), self.samples.back()) {
            let dt = last.timestamp.duration_since(first.timestamp).as_secs_f64();
            let db = last.bytes - first.bytes;
            if dt > 0.05 && db >= 0 {
                db as f64 / dt
            } else {
                0.0
            }
        } else {
            0.0
        };

        // Calculate average speed from overall elapsed time
        let total_elapsed = now.duration_since(self.start_time).as_secs_f64();
        let total_downloaded_in_session = current_downloaded - self.initial_downloaded;
        let average_speed = if total_elapsed > 0.1 && total_downloaded_in_session > 0 {
            total_downloaded_in_session as f64 / total_elapsed
        } else {
            current_speed
        };

        // Calculate ETA
        let eta = if let Some(total) = self.total_bytes {
            let remaining = total - current_downloaded;
            if remaining <= 0 {
                Some(0)
            } else {
                let speed_for_eta = if current_speed > 1024.0 {
                    current_speed
                } else if average_speed > 1024.0 {
                    average_speed
                } else {
                    0.0
                };

                if speed_for_eta > 0.0 {
                    Some((remaining as f64 / speed_for_eta).ceil() as i64)
                } else {
                    None
                }
            }
        } else {
            None
        };

        (current_speed, average_speed, eta)
    }
}
