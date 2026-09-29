//! Keeps the macOS traffic lights at the position set in `tauri.macos.conf.json`.
//!
//! tao only re-applies a custom `trafficLightPosition` on `drawRect:` and when leaving
//! fullscreen. When the window resigns or becomes key, AppKit re-lays out the title bar
//! container and the buttons can end up outside it, so they vanish instead of turning grey.
//! We re-apply the same inset tao uses after focus and resize changes.

use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
use tauri::{Runtime, WebviewWindow, WindowEvent};

/// Must match `trafficLightPosition` in `tauri.macos.conf.json`.
const TRAFFIC_LIGHT_X: f64 = 14.0;
const TRAFFIC_LIGHT_Y: f64 = 31.0;

pub fn install<R: Runtime>(window: &WebviewWindow<R>) {
    let handle = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(_) | WindowEvent::Resized(_) | WindowEvent::ThemeChanged(_)) {
            reapply_later(&handle);
        }
    });
    reapply_later(window);
}

fn reapply_later<R: Runtime>(window: &WebviewWindow<R>) {
    let target = window.clone();
    // Queue on the main thread so it runs after AppKit's own title bar layout pass.
    let _ = window.run_on_main_thread(move || {
        if let Ok(ptr) = target.ns_window() {
            // SAFETY: Tauri hands out the live NSWindow pointer of this window, and we are on the main thread.
            unsafe { inset_traffic_lights(&*(ptr as *const NSWindow)) };
        }
    });
}

/// Same geometry as tao's `inset_traffic_lights`.
unsafe fn inset_traffic_lights(window: &NSWindow) {
    let (Some(close), Some(miniaturize), Some(zoom)) = (
        window.standardWindowButton(NSWindowButton::CloseButton),
        window.standardWindowButton(NSWindowButton::MiniaturizeButton),
        window.standardWindowButton(NSWindowButton::ZoomButton),
    ) else {
        return;
    };
    let Some(container) = close.superview().and_then(|view| view.superview()) else {
        return;
    };

    let close_rect = close.frame();
    let title_bar_height = close_rect.size.height + TRAFFIC_LIGHT_Y;
    let mut title_bar_rect = NSView::frame(&container);
    title_bar_rect.size.height = title_bar_height;
    title_bar_rect.origin.y = window.frame().size.height - title_bar_height;
    container.setFrame(title_bar_rect);

    let spacing = miniaturize.frame().origin.x - close_rect.origin.x;
    for (index, button) in [close, miniaturize, zoom].iter().enumerate() {
        let mut origin = button.frame().origin;
        origin.x = TRAFFIC_LIGHT_X + index as f64 * spacing;
        button.setFrameOrigin(origin);
    }
}
