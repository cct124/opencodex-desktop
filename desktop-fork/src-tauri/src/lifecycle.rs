use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Starting,
    Ready,
    Loaded,
    Stopping,
    Stopped,
    Error,
    Exiting,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Intent {
    Stop,
    Restart,
    Exit,
    Failure,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Completion {
    Stopped,
    Restart,
    Error,
    Exit,
    Stale,
}

pub struct Lifecycle {
    pub phase: Phase,
    pub generation: u64,
    pub active: bool,
    pending: Option<Intent>,
}

impl Default for Lifecycle {
    fn default() -> Self {
        Self {
            phase: Phase::Stopped,
            generation: 0,
            active: false,
            pending: None,
        }
    }
}

impl Lifecycle {
    pub fn can_start(&self) -> bool {
        !self.active && self.phase != Phase::Exiting
    }
    pub fn can_stop(&self) -> bool {
        self.active && self.pending.is_none()
    }
    pub fn can_restart(&self) -> bool {
        self.can_stop() && self.phase == Phase::Loaded
    }

    pub fn start(&mut self) -> Option<u64> {
        if !self.can_start() {
            return None;
        }
        self.generation += 1;
        self.active = true;
        self.pending = None;
        self.phase = Phase::Starting;
        Some(self.generation)
    }

    pub fn ready(&mut self, generation: u64) -> bool {
        if self.generation != generation || self.phase != Phase::Starting {
            return false;
        }
        self.phase = Phase::Ready;
        true
    }

    pub fn loaded(&mut self, generation: u64) -> bool {
        if self.generation != generation || self.phase != Phase::Ready {
            return false;
        }
        self.phase = Phase::Loaded;
        true
    }

    pub fn stop(&mut self, intent: Intent) {
        // Quit always wins over a queued restart; an explicit stop cancels it too.
        if self.pending == Some(Intent::Exit) {
            return;
        }
        self.pending = Some(intent);
        self.phase = match intent {
            Intent::Exit => Phase::Exiting,
            Intent::Failure => Phase::Error,
            _ => Phase::Stopping,
        };
    }

    pub fn finished(&mut self, generation: u64, success: bool) -> Completion {
        if self.generation != generation || !self.active {
            return Completion::Stale;
        }
        self.active = false;
        let outcome = match (self.pending.take(), success) {
            (Some(Intent::Exit), _) => Completion::Exit,
            (Some(Intent::Restart), true) => Completion::Restart,
            (Some(Intent::Stop), true) => Completion::Stopped,
            _ => Completion::Error,
        };
        self.phase = match outcome {
            Completion::Exit => Phase::Exiting,
            Completion::Error => Phase::Error,
            _ => Phase::Stopped,
        };
        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_waits_for_cleanup_and_ignores_old_events() {
        let mut state = Lifecycle::default();
        let first = state.start().unwrap();
        assert_eq!(state.start(), None);
        assert!(state.ready(first));
        assert!(state.loaded(first));
        state.stop(Intent::Restart);
        assert_eq!(state.start(), None);
        assert!(!state.loaded(first));
        assert_eq!(state.finished(first, true), Completion::Restart);
        let second = state.start().unwrap();
        assert!(!state.ready(first));
        assert_eq!(state.finished(first, true), Completion::Stale);
        assert!(state.ready(second));
        assert!(state.active);
    }

    #[test]
    fn quit_cancels_restart_and_cannot_be_cancelled() {
        let mut state = Lifecycle::default();
        let run = state.start().unwrap();
        state.stop(Intent::Restart);
        state.stop(Intent::Exit);
        state.stop(Intent::Restart);
        assert_eq!(state.finished(run, true), Completion::Exit);
        assert!(!state.can_start());
    }

    #[test]
    fn explicit_stop_cancels_a_queued_restart() {
        let mut state = Lifecycle::default();
        let run = state.start().unwrap();
        state.stop(Intent::Restart);
        state.stop(Intent::Stop);
        assert_eq!(state.finished(run, true), Completion::Stopped);
        assert!(state.can_start());
    }

    #[test]
    fn failed_cleanup_never_automatically_restarts() {
        let mut state = Lifecycle::default();
        let run = state.start().unwrap();
        state.stop(Intent::Restart);
        assert_eq!(state.finished(run, false), Completion::Error);
        assert!(state.can_start());
        assert!(state.start().is_some()); // recovery requires a new explicit action
    }

    #[test]
    fn unexpected_exit_requires_manual_retry_even_with_zero_exit_code() {
        let mut state = Lifecycle::default();
        let run = state.start().unwrap();
        assert_eq!(state.finished(run, true), Completion::Error);
        assert!(state.can_start());
    }
}
