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

        // Calculate ETA strictly: remaining / current_speed (None if speed <= 0)
        let eta = if let Some(total) = self.total_bytes {
            let remaining = total - current_downloaded;
            if remaining <= 0 {
                Some(0)
            } else if current_speed > 0.0 {
                Some((remaining as f64 / current_speed).ceil() as i64)
            } else {
                None
            }
        } else {
            None
        };

        (current_speed, average_speed, eta)
    }

    pub fn average_speed(&self) -> f64 {
        let now = Instant::now();
        let total_elapsed = now.duration_since(self.start_time).as_secs_f64();
        if let Some(last) = self.samples.back() {
            let total_downloaded_in_session = last.bytes - self.initial_downloaded;
            if total_elapsed > 0.1 && total_downloaded_in_session > 0 {
                total_downloaded_in_session as f64 / total_elapsed
            } else {
                0.0
            }
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;

    #[test]
    fn test_speed_tracker_basic() {
        let mut tracker = SpeedTracker::new(0, Some(100_000_000), 2.5);
        sleep(Duration::from_millis(100));
        let (speed, avg_speed, eta) = tracker.record_progress(1_000_000);
        assert!(speed > 0.0);
        assert!(avg_speed > 0.0);
        assert!(eta.is_some());
    }

    #[test]
    fn test_speed_tracker_zero_speed_null_eta() {
        let mut tracker = SpeedTracker::new(1000, Some(100_000_000), 2.5);
        let (speed, _, eta) = tracker.record_progress(1000); // 0 bytes downloaded
        assert_eq!(speed, 0.0);
        assert_eq!(eta, None);
    }

    #[test]
    fn test_speed_tracker_completed_zero_eta() {
        let mut tracker = SpeedTracker::new(0, Some(1000), 2.5);
        let (_, _, eta) = tracker.record_progress(1000);
        assert_eq!(eta, Some(0));
    }
}
