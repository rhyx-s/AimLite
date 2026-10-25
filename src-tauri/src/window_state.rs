//! Window geometry: saved on close, restored on launch only if it is still on a connected monitor.
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

const FILE: &str = "window-state.json";
const MIN_W: u32 = 900;
const MIN_H: u32 = 600;

#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// True when at least 160×40 px of the window's top strip (the title bar) is on some monitor.
pub fn visible_on(g: &Geometry, monitors: &[Rect]) -> bool {
    let top = Rect {
        x: g.x,
        y: g.y,
        w: g.width as i32,
        h: 40,
    };
    monitors.iter().any(|m| {
        let ix = (top.x + top.w).min(m.x + m.w) - top.x.max(m.x);
        let iy = (top.y + top.h).min(m.y + m.h) - top.y.max(m.y);
        ix >= 160 && iy >= 40
    })
}

pub fn load(dir: &Path) -> Option<Geometry> {
    let s = std::fs::read_to_string(dir.join(FILE)).ok()?;
    let g: Geometry = serde_json::from_str(&s).ok()?;
    (g.width >= MIN_W / 2 && g.height >= MIN_H / 2 && g.width <= 16000 && g.height <= 16000)
        .then_some(g)
}

pub fn save(dir: &Path, w: &WebviewWindow) {
    let (Ok(pos), Ok(size), Ok(max)) = (w.outer_position(), w.inner_size(), w.is_maximized())
    else {
        return;
    };
    if w.is_minimized().unwrap_or(false) || w.is_fullscreen().unwrap_or(false) {
        return; // keep the last normal geometry
    }
    let g = Geometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized: max,
    };
    if let Ok(s) = serde_json::to_string(&g) {
        let _ = std::fs::write(dir.join(FILE), s);
    }
}

fn rects(monitors: &[Monitor]) -> Vec<Rect> {
    monitors
        .iter()
        .map(|m| Rect {
            x: m.position().x,
            y: m.position().y,
            w: m.size().width as i32,
            h: m.size().height as i32,
        })
        .collect()
}

/// Apply saved geometry when it fits the current monitors; otherwise keep the centred default.
pub fn restore(dir: &Path, w: &WebviewWindow) {
    let Some(g) = load(dir) else { return };
    let monitors = w.available_monitors().unwrap_or_default();
    if !visible_on(&g, &rects(&monitors)) {
        return;
    }
    let _ = w.set_size(PhysicalSize::new(
        g.width.max(MIN_W / 2),
        g.height.max(MIN_H / 2),
    ));
    let _ = w.set_position(PhysicalPosition::new(g.x, g.y));
    if g.maximized {
        let _ = w.maximize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_screen_geometry_is_rejected() {
        let mons = [Rect {
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
        }];
        let on = Geometry {
            x: 100,
            y: 100,
            width: 1200,
            height: 800,
            maximized: false,
        };
        let off = Geometry {
            x: 3000,
            y: 100,
            width: 1200,
            height: 800,
            maximized: false,
        };
        let edge = Geometry {
            x: 1850,
            y: 100,
            width: 1200,
            height: 800,
            maximized: false,
        };
        assert!(visible_on(&on, &mons));
        assert!(!visible_on(&off, &mons));
        assert!(!visible_on(&edge, &mons));
        let two = [
            mons[0],
            Rect {
                x: 1920,
                y: 0,
                w: 2560,
                h: 1440,
            },
        ];
        assert!(visible_on(&off, &two));
    }
}
