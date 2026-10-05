//! Keeps the computer from idle-sleeping while a translation runs (a sleeping Mac stops the
//! requests: a 15-min nap is 15 min with no progress). One assertion for the whole app,
//! counted: the first running project takes it, the last one to stop gives it back.
//! macOS: `caffeinate -i -w <pid>` (dies with the app). Windows: `SetThreadExecutionState`
//! on a thread of its own. A closed lid still sleeps the Mac (the system decides that).

use std::sync::Mutex;

static AWAKE: Mutex<Awake> = Mutex::new(Awake { holders: 0, inner: None });

struct Awake {
    holders: usize,
    inner: Option<Assertion>,
}

/// Held while a project translates; dropping it releases the app's assertion when it was the last.
pub struct KeepAwake(());

impl KeepAwake {
    pub fn acquire() -> KeepAwake {
        let mut awake = AWAKE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        awake.holders += 1;
        if awake.holders == 1 {
            awake.inner = Assertion::take();
        }
        KeepAwake(())
    }

    /// Whether the app is currently holding the computer awake.
    pub fn active() -> bool {
        AWAKE.lock().map(|awake| awake.inner.is_some()).unwrap_or(false)
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        let mut awake = AWAKE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        awake.holders = awake.holders.saturating_sub(1);
        if awake.holders == 0 {
            if let Some(assertion) = awake.inner.take() {
                assertion.release();
            }
        }
    }
}

#[cfg(target_os = "macos")]
struct Assertion(std::process::Child);

#[cfg(target_os = "macos")]
impl Assertion {
    fn take() -> Option<Assertion> {
        if cfg!(test) {
            return None;
        }
        std::process::Command::new("/usr/bin/caffeinate")
            .args(["-i", "-w", &std::process::id().to_string()])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()
            .map(Assertion)
    }

    fn release(mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[cfg(windows)]
struct Assertion(std::sync::mpsc::Sender<()>);

#[cfg(windows)]
impl Assertion {
    fn take() -> Option<Assertion> {
        use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
        if cfg!(test) {
            return None;
        }
        // The state belongs to the thread that set it: one thread holds it until released.
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        std::thread::Builder::new()
            .name("oghma-keep-awake".into())
            .spawn(move || {
                unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
                let _ = rx.recv();
                unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
            })
            .ok()?;
        Some(Assertion(tx))
    }

    fn release(self) {
        let _ = self.0.send(());
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
struct Assertion;

#[cfg(not(any(target_os = "macos", windows)))]
impl Assertion {
    fn take() -> Option<Assertion> {
        None
    }

    fn release(self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_holders() {
        let first = KeepAwake::acquire();
        let second = KeepAwake::acquire();
        assert_eq!(AWAKE.lock().unwrap().holders, 2);
        drop(first);
        assert_eq!(AWAKE.lock().unwrap().holders, 1);
        drop(second);
        assert_eq!(AWAKE.lock().unwrap().holders, 0);
    }
}
