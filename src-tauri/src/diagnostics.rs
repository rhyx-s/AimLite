//! Read-only system diagnostics. Nothing here changes a system setting.
use serde::Serialize;

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct MouseAcceleration {
    /// Windows "Enhance pointer precision" (SPI_GETMOUSE acceleration flag ≠ 0).
    pub enabled: bool,
    pub threshold1: i32,
    pub threshold2: i32,
}

#[cfg(windows)]
mod win {
    use super::MouseAcceleration;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETMOUSE, SPI_GETMOUSESPEED,
    };

    pub fn mouse_speed() -> Option<u32> {
        let mut v: u32 = 0;
        // SAFETY: SPI_GETMOUSESPEED writes one u32 to the pointer we pass.
        let ok =
            unsafe { SystemParametersInfoW(SPI_GETMOUSESPEED, 0, (&mut v as *mut u32).cast(), 0) };
        (ok != 0).then_some(v)
    }

    pub fn mouse_acceleration() -> Option<MouseAcceleration> {
        let mut v = [0i32; 3];
        // SAFETY: SPI_GETMOUSE writes an array of three ints.
        let ok = unsafe { SystemParametersInfoW(SPI_GETMOUSE, 0, v.as_mut_ptr().cast(), 0) };
        (ok != 0).then_some(MouseAcceleration {
            threshold1: v[0],
            threshold2: v[1],
            enabled: v[2] != 0,
        })
    }

    pub fn window_dpi(hwnd: *mut core::ffi::c_void) -> Option<u32> {
        // SAFETY: hwnd comes from our own live window.
        let d = unsafe { GetDpiForWindow(hwnd) };
        (d != 0).then_some(d)
    }

    fn reg_string(name: &str) -> Option<String> {
        let key: Vec<u16> = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\0"
            .encode_utf16()
            .collect();
        let val: Vec<u16> = format!("{name}\0").encode_utf16().collect();
        let mut buf = [0u16; 256];
        let mut len = (buf.len() * 2) as u32;
        // SAFETY: buffers are valid and sized; RegGetValueW writes at most `len` bytes.
        let rc = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                key.as_ptr(),
                val.as_ptr(),
                RRF_RT_REG_SZ,
                core::ptr::null_mut(),
                buf.as_mut_ptr().cast(),
                &mut len,
            )
        };
        if rc != 0 {
            return None;
        }
        let n = (len as usize / 2).saturating_sub(1).min(buf.len());
        Some(String::from_utf16_lossy(&buf[..n]))
    }

    pub fn os_version() -> String {
        let name = reg_string("ProductName").unwrap_or_else(|| "Windows".into());
        let disp = reg_string("DisplayVersion").unwrap_or_default();
        let build = reg_string("CurrentBuild").unwrap_or_default();
        format!(
            "{} {disp} (build {build})",
            super::product_name(&name, &build)
        )
        .trim()
        .to_string()
    }
}

/// Windows 11 still reports "Windows 10 …" as ProductName; build 22000+ is Windows 11.
pub fn product_name(name: &str, build: &str) -> String {
    match build.parse::<u32>() {
        Ok(b) if b >= 22000 && name.starts_with("Windows 10") => {
            name.replacen("Windows 10", "Windows 11", 1)
        }
        _ => name.to_string(),
    }
}

#[cfg(windows)]
pub use win::{mouse_acceleration, mouse_speed, os_version, window_dpi};

#[cfg(not(windows))]
pub fn mouse_speed() -> Option<u32> {
    None
}
#[cfg(not(windows))]
pub fn mouse_acceleration() -> Option<MouseAcceleration> {
    None
}
#[cfg(not(windows))]
pub fn window_dpi(_: *mut core::ffi::c_void) -> Option<u32> {
    None
}
#[cfg(not(windows))]
pub fn os_version() -> String {
    std::env::consts::OS.to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn windows_11_is_named_by_build() {
        assert_eq!(
            super::product_name("Windows 10 Home", "26200"),
            "Windows 11 Home"
        );
        assert_eq!(
            super::product_name("Windows 10 Pro", "19045"),
            "Windows 10 Pro"
        );
        assert_eq!(super::product_name("Windows 10 Pro", "?"), "Windows 10 Pro");
    }
}
