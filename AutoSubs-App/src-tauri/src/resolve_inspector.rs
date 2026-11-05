//! Set the look of Resolve's subtitle track through Resolve's own Inspector.
//!
//! Resolve's scripting API cannot read or write a subtitle track's style, but
//! the Inspector exposes its controls through macOS accessibility. This module
//! drives those controls directly: sliders and checkboxes are set through
//! accessibility (no clicks), combo boxes are opened and typed into, and the
//! numeric X/Y fields are double-clicked at the position accessibility
//! reports. Keystrokes are posted to Resolve's process only, never to
//! whichever app happens to be in front.
//!
//! The caller selects the subtitle clips first (video and audio tracks are
//! locked by the Lua side so Edit > Select All only picks subtitles).

use serde::Deserialize;

/// Every field of Resolve's Inspector > Track. The app sends the full set
/// (missing values filled with Resolve's defaults).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct InspectorTrackStyle {
    pub font: String,
    pub font_face: String,
    pub color: String,
    pub size: f64,
    pub line_spacing: f64,
    pub kerning: f64,
    pub font_case: String,
    pub alignment: String,
    pub stroke_color: String,
    pub stroke_size: f64,
    pub stroke_outside_only: bool,
    pub position_x: f64,
    pub position_y: f64,
    pub zoom_x: f64,
    pub zoom_y: f64,
    pub opacity: f64,
    pub anchor_v: String,
    pub anchor_h: String,
    pub shadow: bool,
    pub shadow_color: String,
    pub shadow_offset_x: f64,
    pub shadow_offset_y: f64,
    pub shadow_blur: f64,
    pub shadow_opacity: f64,
    pub background: bool,
    pub background_color: String,
    pub background_outline_color: String,
    pub background_outline_width: f64,
    pub background_corner_radius: f64,
    pub background_opacity: f64,
    pub background_override_sizing: bool,
    pub subtitle_settings: bool,
    pub use_project_settings: bool,
    pub max_line_length: f64,
    pub min_duration: f64,
    pub max_cps: f64,
    /// Resolve subtitle animation (Effects > Titles > Animated); "" = none.
    pub animation: String,
    pub highlight_color: String,
    pub frame_width: f64,
    pub frame_height: f64,
}

impl Default for InspectorTrackStyle {
    fn default() -> Self {
        Self {
            font: "Open Sans".into(), font_face: "Semibold".into(), color: "#ffffff".into(),
            size: 58.0, line_spacing: 0.0, kerning: 0.0, font_case: "Mixed".into(), alignment: "center".into(),
            stroke_color: "#ffffff".into(), stroke_size: 1.0, stroke_outside_only: false,
            position_x: 1080.0, position_y: 768.0, zoom_x: 1.0, zoom_y: 1.0, opacity: 100.0,
            anchor_v: "middle".into(), anchor_h: "center".into(),
            shadow: false, shadow_color: "#000000".into(), shadow_offset_x: 0.0, shadow_offset_y: 0.0,
            shadow_blur: 20.0, shadow_opacity: 75.0,
            background: false, background_color: "#000000".into(), background_outline_color: "#000000".into(),
            background_outline_width: 0.0, background_corner_radius: 0.01, background_opacity: 50.0,
            background_override_sizing: false,
            subtitle_settings: true, use_project_settings: true, max_line_length: 60.0, min_duration: 3.0, max_cps: 30.0,
            animation: String::new(), highlight_color: "#FFE64A".into(), frame_width: 1920.0, frame_height: 1080.0,
        }
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::InspectorTrackStyle;
    use core_foundation::array::{CFArray, CFArrayRef};
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton, EventField, ScrollEventUnit};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use core_graphics::geometry::CGPoint;
    use std::ffi::c_void;
    use std::thread::sleep;
    use std::time::{Duration, Instant};

    type AXUIElementRef = CFTypeRef;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(el: AXUIElementRef, attr: CFStringRef, value: *mut CFTypeRef) -> i32;
        fn AXUIElementSetAttributeValue(el: AXUIElementRef, attr: CFStringRef, value: CFTypeRef) -> i32;
        fn AXUIElementPerformAction(el: AXUIElementRef, action: CFStringRef) -> i32;
        fn AXUIElementSetMessagingTimeout(el: AXUIElementRef, seconds: f32) -> i32;
        fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
        fn AXValueGetValue(value: CFTypeRef, the_type: u32, out: *mut c_void) -> bool;
    }

    const AX_POINT: u32 = 1;
    const AX_SIZE: u32 = 2;

    #[derive(Clone)]
    struct Node {
        el: CFType,
        role: String,
        title: String,
        #[allow(dead_code)]
        desc: String,
        value: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    }

    impl Node {
        fn label(&self) -> &str {
            if !self.title.is_empty() { &self.title } else { &self.value }
        }
        fn center(&self) -> CGPoint {
            CGPoint::new(self.x + self.w / 2.0, self.y + self.h / 2.0)
        }
    }

    fn attr(el: CFTypeRef, name: &str) -> Option<CFType> {
        let key = CFString::new(name);
        let mut out: CFTypeRef = std::ptr::null();
        let err = unsafe { AXUIElementCopyAttributeValue(el, key.as_concrete_TypeRef(), &mut out) };
        if err != 0 || out.is_null() {
            return None;
        }
        Some(unsafe { CFType::wrap_under_create_rule(out) })
    }

    fn attr_string(el: CFTypeRef, name: &str) -> String {
        match attr(el, name) {
            Some(v) => {
                if let Some(s) = v.downcast::<CFString>() {
                    s.to_string()
                } else if let Some(n) = v.downcast::<CFNumber>() {
                    n.to_f64().map(|f| f.to_string()).unwrap_or_default()
                } else if let Some(b) = v.downcast::<CFBoolean>() {
                    if bool::from(b) { "1".into() } else { "0".into() }
                } else {
                    String::new()
                }
            }
            None => String::new(),
        }
    }

    fn attr_point(el: CFTypeRef, name: &str, kind: u32) -> (f64, f64) {
        let mut buf = [0f64; 2];
        if let Some(v) = attr(el, name) {
            unsafe { AXValueGetValue(v.as_CFTypeRef(), kind, buf.as_mut_ptr() as *mut c_void) };
        }
        (buf[0], buf[1])
    }

    fn children(el: CFTypeRef) -> Vec<CFType> {
        match attr(el, "AXChildren") {
            Some(v) => {
                let arr: CFArray<CFType> = unsafe { CFArray::wrap_under_get_rule(v.as_CFTypeRef() as CFArrayRef) };
                arr.iter().map(|c| c.clone()).collect()
            }
            None => vec![],
        }
    }

    fn collect(el: &CFType, depth: usize, out: &mut Vec<Node>) {
        if depth > 16 || out.len() > 4000 {
            return;
        }
        for c in children(el.as_CFTypeRef()) {
            let r = c.as_CFTypeRef();
            let (x, y) = attr_point(r, "AXPosition", AX_POINT);
            let (w, h) = attr_point(r, "AXSize", AX_SIZE);
            out.push(Node {
                role: attr_string(r, "AXRole"),
                title: attr_string(r, "AXTitle"),
                desc: attr_string(r, "AXDescription"),
                value: attr_string(r, "AXValue"),
                x, y, w, h,
                el: c.clone(),
            });
            collect(&c, depth + 1, out);
        }
    }

    fn press(el: &CFType) -> bool {
        let a = CFString::new("AXPress");
        unsafe { AXUIElementPerformAction(el.as_CFTypeRef(), a.as_concrete_TypeRef()) == 0 }
    }

    fn set_number(el: &CFType, v: f64) -> bool {
        let key = CFString::new("AXValue");
        let n = CFNumber::from(v);
        unsafe { AXUIElementSetAttributeValue(el.as_CFTypeRef(), key.as_concrete_TypeRef(), n.as_CFTypeRef()) == 0 }
    }

    struct Resolve {
        pid: i32,
        app: CFType,
    }

    impl Resolve {
        fn find() -> Result<Self, String> {
            let out = std::process::Command::new("pgrep").args(["-x", "Resolve"]).output()
                .map_err(|e| e.to_string())?;
            let pid: i32 = String::from_utf8_lossy(&out.stdout).lines().next()
                .and_then(|l| l.trim().parse().ok())
                .ok_or("DaVinci Resolve is not running")?;
            let app = unsafe { CFType::wrap_under_create_rule(AXUIElementCreateApplication(pid)) };
            unsafe { AXUIElementSetMessagingTimeout(app.as_CFTypeRef(), 3.0) };
            Ok(Self { pid, app })
        }

        /// Resolve's main window: the largest one. Its title is the project
        /// name in full-screen/tabbed setups, and a thin title-bar window may
        /// be listed first.
        fn window(&self) -> Result<CFType, String> {
            let t = Instant::now();
            loop {
                if let Some(wins) = attr(self.app.as_CFTypeRef(), "AXWindows") {
                    let arr: CFArray<CFType> = unsafe { CFArray::wrap_under_get_rule(wins.as_CFTypeRef() as CFArrayRef) };
                    let best = arr.iter()
                        .filter(|w| attr_string(w.as_CFTypeRef(), "AXTitle") != "Colors")
                        .map(|w| {
                            let (ww, hh) = attr_point(w.as_CFTypeRef(), "AXSize", AX_SIZE);
                            (ww * hh, w.clone())
                        })
                        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
                    if let Some((area, w)) = best {
                        if area > 200_000.0 {
                            return Ok(w);
                        }
                    }
                }
                if std::env::var_os("AUTOSUBS_AX_DEBUG").is_some() {
                    let key = CFString::new("AXWindows");
                    let mut out: CFTypeRef = std::ptr::null();
                    let err = unsafe { AXUIElementCopyAttributeValue(self.app.as_CFTypeRef(), key.as_concrete_TypeRef(), &mut out) };
                    eprintln!("AXWindows err={err} pid={} front={}", self.pid, attr_string(self.app.as_CFTypeRef(), "AXFrontmost"));
                    if !out.is_null() {
                        let arr: CFArray<CFType> = unsafe { CFArray::wrap_under_create_rule(out as CFArrayRef) };
                        for w in arr.iter() { eprintln!("  win '{}' {:?}", attr_string(w.as_CFTypeRef(), "AXTitle"), attr_point(w.as_CFTypeRef(), "AXSize", AX_SIZE)); }
                    }
                }
                if t.elapsed() > Duration::from_secs(3) {
                    return Err("Resolve's window is not reachable. Bring DaVinci Resolve to the front and send again.".into());
                }
                sleep(Duration::from_millis(100));
            }
        }

        fn nodes(&self) -> Result<Vec<Node>, String> {
            let w = self.window()?;
            let mut out = Vec::with_capacity(512);
            collect(&w, 0, &mut out);
            Ok(out)
        }

        fn bring_front(&self) -> Result<(), String> {
            // `open -a` also switches to Resolve's Space (full screen or
            // another desktop); setting AXFrontmost alone does not.
            let opened = std::process::Command::new("open").args(["-a", "DaVinci Resolve"]).status()
                .map(|s| s.success()).unwrap_or(false);
            if !opened {
                let key = CFString::new("AXFrontmost");
                unsafe {
                    AXUIElementSetAttributeValue(self.app.as_CFTypeRef(), key.as_concrete_TypeRef(), CFBoolean::true_value().as_CFTypeRef());
                }
            }
            let t = Instant::now();
            while t.elapsed() < Duration::from_secs(4) {
                if attr_string(self.app.as_CFTypeRef(), "AXFrontmost") == "1" {
                    // Let a Space switch finish before reading the window.
                    let _ = self.window()?;
                    sleep(Duration::from_millis(150));
                    return Ok(());
                }
                sleep(Duration::from_millis(40));
            }
            Err("Could not bring DaVinci Resolve to the front".into())
        }

        fn is_front(&self) -> bool {
            attr_string(self.app.as_CFTypeRef(), "AXFrontmost") == "1"
        }

        /// Press a menu item by its path, e.g. ["Timeline", "Auto Select", "Auto Select All Tracks"].
        fn menu(&self, path: &[&str]) -> Result<(), String> {
            let bar = attr(self.app.as_CFTypeRef(), "AXMenuBar").ok_or("no menu bar")?;
            let mut level = children(bar.as_CFTypeRef());
            for (depth, name) in path.iter().enumerate() {
                let found = level.iter().find(|e| attr_string(e.as_CFTypeRef(), "AXTitle") == *name).cloned()
                    .ok_or_else(|| format!("menu item {} not found", path.join(" > ")))?;
                if depth == path.len() - 1 {
                    press(&found);
                    sleep(Duration::from_millis(60));
                    return Ok(());
                }
                // The item's single child is its menu; that menu's children are the items.
                level = children(found.as_CFTypeRef()).into_iter()
                    .flat_map(|m| children(m.as_CFTypeRef()))
                    .collect();
            }
            Err("empty menu path".into())
        }

        fn key(&self, code: u16, flags: CGEventFlags) {
            let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
            for down in [true, false] {
                if let Ok(e) = CGEvent::new_keyboard_event(src.clone(), code, down) {
                    e.set_flags(flags);
                    e.post_to_pid(self.pid);
                }
                sleep(Duration::from_millis(8));
            }
        }

        fn type_text(&self, text: &str) {
            let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
            for ch in text.chars() {
                for down in [true, false] {
                    if let Ok(e) = CGEvent::new_keyboard_event(src.clone(), 0, down) {
                        e.set_string(&ch.to_string());
                        e.post_to_pid(self.pid);
                    }
                }
                sleep(Duration::from_millis(12));
            }
        }

        fn double_click(&self, p: CGPoint) -> Result<(), String> {
            if !self.is_front() {
                return Err("DaVinci Resolve lost focus; style not finished".into());
            }
            let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
            for click in [1i64, 2] {
                for t in [CGEventType::LeftMouseDown, CGEventType::LeftMouseUp] {
                    let e = CGEvent::new_mouse_event(src.clone(), t, p, CGMouseButton::Left).map_err(|_| "mouse event")?;
                    e.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, click);
                    e.post(CGEventTapLocation::HID);
                    sleep(Duration::from_millis(15));
                }
            }
            Ok(())
        }

        fn click(&self, p: CGPoint) -> Result<(), String> {
            if !self.is_front() {
                return Err("DaVinci Resolve lost focus; style not finished".into());
            }
            let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
            for t in [CGEventType::LeftMouseDown, CGEventType::LeftMouseUp] {
                let e = CGEvent::new_mouse_event(src.clone(), t, p, CGMouseButton::Left).map_err(|_| "mouse event")?;
                e.post(CGEventTapLocation::HID);
                sleep(Duration::from_millis(20));
            }
            Ok(())
        }

        /// Mouse drag from `a` to `b` (Resolve must be in front).
        fn drag(&self, a: CGPoint, b: CGPoint) -> Result<(), String> {
            if !self.is_front() {
                return Err("DaVinci Resolve lost focus; style not finished".into());
            }
            let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
            let post = |t: CGEventType, p: CGPoint| -> Result<(), String> {
                let e = CGEvent::new_mouse_event(src.clone(), t, p, CGMouseButton::Left).map_err(|_| "mouse event")?;
                e.post(CGEventTapLocation::HID);
                Ok(())
            };
            post(CGEventType::MouseMoved, a)?;
            sleep(Duration::from_millis(60));
            post(CGEventType::LeftMouseDown, a)?;
            sleep(Duration::from_millis(150));
            let steps = 24;
            for i in 1..=steps {
                let f = i as f64 / steps as f64;
                post(CGEventType::LeftMouseDragged, CGPoint::new(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f))?;
                sleep(Duration::from_millis(18));
            }
            sleep(Duration::from_millis(250));
            post(CGEventType::LeftMouseDragged, b)?;
            sleep(Duration::from_millis(150));
            post(CGEventType::LeftMouseUp, b)?;
            sleep(Duration::from_millis(300));
            Ok(())
        }

        fn scroll(&self, p: CGPoint, lines: i32) {
            let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).unwrap();
            if let Ok(m) = CGEvent::new_mouse_event(src.clone(), CGEventType::MouseMoved, p, CGMouseButton::Left) {
                m.post(CGEventTapLocation::HID);
            }
            sleep(Duration::from_millis(20));
            if let Ok(e) = CGEvent::new_scroll_event(src, ScrollEventUnit::LINE, 1, lines, 0, 0) {
                e.set_location(p);
                e.post(CGEventTapLocation::HID);
            }
            sleep(Duration::from_millis(60));
        }
    }

    /// Index of the first node at or after `from` whose label is `label`.
    fn find_label(nodes: &[Node], from: usize, to: usize, label: &str) -> Option<usize> {
        (from..to.min(nodes.len())).find(|&i| nodes[i].role == "AXStaticText" && nodes[i].label() == label)
    }

    /// Nearest node before `idx` (within 3) with the given role.
    fn before(nodes: &[Node], idx: usize, role: &str) -> Option<usize> {
        (idx.saturating_sub(3)..idx).rev().find(|&i| nodes[i].role == role)
    }

    /// Inspector layout, recomputed after every change (Qt rebuilds widgets).
    struct Layout {
        nodes: Vec<Node>,
        /// Inspector's visible area (the scroll area holding the controls).
        area: (f64, f64, f64, f64),
        /// Index range of the Track tab controls.
        start: usize,
        end: usize,
    }

    fn layout(r: &Resolve) -> Result<Layout, String> {
        let nodes = r.nodes()?;
        let sp = nodes.iter().position(|n| n.role == "AXStaticText" && n.label() == "Style and Position")
            .ok_or("The Inspector does not show the subtitle Track tab")?;
        let end = nodes.iter().position(|n| n.role == "AXStaticText" && n.label() == "Subtitle Settings")
            .unwrap_or(nodes.len());
        let start = nodes.iter().position(|n| n.role == "AXCheckBox" && n.title == "Track" && n.value == "1")
            .unwrap_or(sp.saturating_sub(80));
        let sb = (end..(end + 4).min(nodes.len())).find(|&i| nodes[i].role == "AXScrollBar");
        let area = match sb {
            Some(i) => {
                let s = &nodes[i];
                (nodes[sp].x - 20.0, s.y, s.x + s.w - (nodes[sp].x - 20.0), s.h)
            }
            None => (nodes[sp].x - 20.0, nodes[sp].y, 420.0, 800.0),
        };
        Ok(Layout { nodes, area, start, end: end.max(sp) })
    }

    fn visible(area: (f64, f64, f64, f64), n: &Node) -> bool {
        n.h > 0.0 && n.y >= area.1 + 4.0 && n.y + n.h <= area.1 + area.3 - 4.0
    }

    /// Double-click a numeric field (found by `locate`) and type `value`.
    fn edit_number<F>(r: &Resolve, value: f64, locate: F) -> Result<(), String>
    where
        F: Fn(&Layout) -> Option<usize>,
    {
        for _ in 0..12 {
            let l = layout(r)?;
            let idx = locate(&l).ok_or("Inspector field not found")?;
            let n = &l.nodes[idx];
            if (n.label().parse::<f64>().unwrap_or(f64::NAN) - value).abs() < 0.0005 {
                return Ok(());
            }
            if visible(l.area, n) {
                r.double_click(n.center())?;
                sleep(Duration::from_millis(80));
                // Only type into a focused text field: stray keys would hit
                // Resolve shortcuts (viewer zoom, edits) instead.
                let focused = attr(r.app.as_CFTypeRef(), "AXFocusedUIElement")
                    .map(|f| attr_string(f.as_CFTypeRef(), "AXRole"))
                    .unwrap_or_default();
                if focused != "AXTextField" {
                    return Err(format!("Could not open the Inspector field for {value}"));
                }
                r.key(0, CGEventFlags::CGEventFlagCommand); // cmd+A
                r.type_text(&format_number(value));
                r.key(36, CGEventFlags::empty()); // return
                sleep(Duration::from_millis(80));
                return Ok(());
            }
            let mid = CGPoint::new(l.area.0 + l.area.2 / 2.0, l.area.1 + l.area.3 / 2.0);
            let lines = if n.y < l.area.1 { 6 } else { -6 };
            r.scroll(mid, lines);
        }
        Err("Could not scroll the Inspector to a field".into())
    }

    /// The numeric X or Y field of a two-value row (Position, Offset) whose
    /// row label is at `label`: the value right after the "X"/"Y" caption.
    /// Each field is followed by an empty element and the row ends with a
    /// reset button, so fixed offsets from the label are not safe.
    fn xy_field(nodes: &[Node], label: usize, axis: &str) -> Option<usize> {
        let from = label.saturating_sub(10);
        let a = (from..label).rev().find(|&i| nodes[i].role == "AXStaticText" && nodes[i].label() == axis)?;
        (a + 1..label).find(|&i| nodes[i].role == "AXStaticText" && nodes[i].label().parse::<f64>().is_ok())
    }

    fn format_number(v: f64) -> String {
        if v.fract() == 0.0 { format!("{}", v as i64) } else { format!("{v}") }
    }

    fn choose_combo(r: &Resolve, nth: usize, text: &str) -> Result<(), String> {
        let l = layout(r)?;
        let combos: Vec<&Node> = l.nodes[l.start..l.end].iter().filter(|n| n.role == "AXComboBox").collect();
        let c = combos.get(nth).ok_or("Inspector font box not found")?;
        if c.title.eq_ignore_ascii_case(text) {
            return Ok(());
        }
        press(&c.el);
        sleep(Duration::from_millis(250));
        r.type_text(text);
        sleep(Duration::from_millis(80));
        r.key(36, CGEventFlags::empty());
        sleep(Duration::from_millis(250));
        let l = layout(r)?;
        let now = l.nodes[l.start..l.end].iter().filter(|n| n.role == "AXComboBox").nth(nth)
            .map(|n| n.title.clone()).unwrap_or_default();
        if !now.eq_ignore_ascii_case(text) {
            return Err(format!("Resolve has no \"{text}\" (it chose \"{now}\")"));
        }
        Ok(())
    }

    /// Select exactly one caption: with several (or a video clip too)
    /// Resolve hides the Track tab. The Lua side parked the playhead on the
    /// first caption; with auto-select on the subtitle track only, "Select
    /// All Clips Under Playhead" picks just that caption.
    fn select_caption(r: &Resolve) -> Result<(), String> {
        r.menu(&["Edit", "Deselect All"])?;
        r.menu(&["Timeline", "Auto Select", "Auto Select All Tracks"])?;
        r.menu(&["Timeline", "Auto Select", "Auto Select/Deselect All Video"])?;
        r.menu(&["Timeline", "Auto Select", "Auto Select/Deselect All Audio"])?;
        r.menu(&["Trim", "Select All Clips Under Playhead"])?;
        let t = Instant::now();
        while t.elapsed() < Duration::from_millis(2500) {
            sleep(Duration::from_millis(100));
            if r.nodes().map(|n| n.iter().any(|m| m.role == "AXCheckBox" && m.title == "Caption")).unwrap_or(false) {
                // Track sub-tab
                let nodes = r.nodes()?;
                if let Some(i) = nodes.iter().position(|n| n.role == "AXCheckBox" && n.title == "Track" && n.desc.is_empty() && n.y > 60.0 && nodes.iter().any(|m| m.title == "Caption" && (m.y - n.y).abs() < 4.0)) {
                    if nodes[i].value == "0" { press(&nodes[i].el); sleep(Duration::from_millis(250)); }
                }
                return Ok(());
            }
        }
        Err("Resolve did not select a caption. Click one caption on the subtitle track and send again.".into())
    }

    fn has_fusion_subtitle(r: &Resolve) -> Result<bool, String> {
        Ok(r.nodes()?.iter().any(|n| n.role == "AXButton" && n.desc == "Remove Fusion Subtitle"))
    }

    /// The Inspector's visible scroll area: the group right below the
    /// Caption/Track tabs. Controls outside it are scrolled out of view.
    fn viewport_of(nodes: &[Node], x: f64, _y: f64) -> (f64, f64, f64, f64) {
        let track = nodes.iter().find(|n| n.role == "AXCheckBox" && n.title == "Track"
            && nodes.iter().any(|m| m.role == "AXCheckBox" && m.title == "Caption" && (m.y - n.y).abs() < 4.0));
        if let Some(t) = track {
            if let Some(g) = nodes.iter()
                .filter(|n| n.role == "AXGroup" && n.h > 60.0 && n.y >= t.y + 5.0 && n.x <= x && x <= n.x + n.w)
                .min_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal)
                    .then((a.w * a.h).partial_cmp(&(b.w * b.h)).unwrap_or(std::cmp::Ordering::Equal)))
            {
                return (g.x, g.y, g.w, g.h);
            }
        }
        // Unknown layout: treat nothing as visible, so callers scroll and
        // finally give up instead of clicking outside the Inspector.
        (x, 0.0, 0.0, 0.0)
    }

    /// Scroll a control into view and click it.
    fn click_visible<F>(r: &Resolve, what: &str, locate: F) -> Result<(), String>
    where
        F: Fn(&[Node]) -> Option<usize>,
    {
        click_visible_n(r, what, locate, false)
    }

    fn click_visible_n<F>(r: &Resolve, what: &str, locate: F, double: bool) -> Result<(), String>
    where
        F: Fn(&[Node]) -> Option<usize>,
    {
        for _ in 0..14 {
            let nodes = r.nodes()?;
            let i = locate(&nodes).ok_or(format!("{what} not found"))?;
            let n = &nodes[i];
            let area = viewport_of(&nodes, n.x + 1.0, n.y + 1.0);
            // The control itself is inside its group; use the group above it
            // that is the Inspector viewport (taller than the control).
            if n.y >= area.1 + 2.0 && n.y + n.h <= area.1 + area.3 - 2.0 && n.h > 0.0 {
                return if double { r.double_click(n.center()) } else { r.click(n.center()) };
            }
            let mid = CGPoint::new(area.0 + area.2 / 2.0, area.1 + area.3 / 2.0);
            r.scroll(mid, if n.y < area.1 { 6 } else { -6 });
        }
        Err(format!("Could not reach {what} in the Inspector"))
    }

    fn remove_fusion_subtitle(r: &Resolve) -> Result<(), String> {
        let nodes = r.nodes()?;
        if let Some(b) = nodes.iter().find(|n| n.role == "AXButton" && n.desc == "Remove Fusion Subtitle") {
            press(&b.el);
        }
        sleep(Duration::from_millis(500));
        if has_fusion_subtitle(r)? {
            click_visible(r, "Remove Fusion Subtitle", |n| n.iter().position(|m| m.role == "AXButton" && m.desc == "Remove Fusion Subtitle"))?;
            sleep(Duration::from_millis(600));
        }
        if has_fusion_subtitle(r)? {
            return Err("Could not remove the previous subtitle animation".into());
        }
        Ok(())
    }

    /// Screen pixels of a rectangle (global points) as RGB rows, plus the
    /// pixels-per-point scale. Uses `screencapture`, which needs the Screen
    /// Recording permission for AutoSubs.
    fn capture(x: f64, y: f64, w: f64, h: f64) -> Result<(Vec<[u8; 3]>, usize, usize, f64), String> {
        let path = std::env::temp_dir().join(format!("autosubs-ax-{}.bmp", std::process::id()));
        let rect = format!("{},{},{},{}", x.round() as i64, y.round() as i64, w.round().max(1.0) as i64, h.round().max(1.0) as i64);
        let ok = std::process::Command::new("screencapture").args(["-x", "-t", "bmp", "-R", &rect])
            .arg(&path).status().map(|s| s.success()).unwrap_or(false);
        let data = std::fs::read(&path).map_err(|_| "Screen capture failed: allow AutoSubs under System Settings > Privacy & Security > Screen Recording".to_string())?;
        let _ = std::fs::remove_file(&path);
        if !ok || data.len() < 54 || &data[0..2] != b"BM" {
            return Err("Screen capture failed: allow AutoSubs under System Settings > Privacy & Security > Screen Recording".into());
        }
        let rd32 = |o: usize| u32::from_le_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]]);
        let off = rd32(10) as usize;
        let width = rd32(18) as i32;
        let height = rd32(22) as i32;
        let bpp = u16::from_le_bytes([data[28], data[29]]) as usize;
        let (wpx, hpx) = (width.unsigned_abs() as usize, height.unsigned_abs() as usize);
        let bytes = bpp / 8;
        let row = (wpx * bytes + 3) / 4 * 4;
        let mut px = vec![[0u8; 3]; wpx * hpx];
        for yy in 0..hpx {
            let src_y = if height > 0 { hpx - 1 - yy } else { yy };
            for xx in 0..wpx {
                let i = off + src_y * row + xx * bytes;
                if i + 2 < data.len() {
                    px[yy * wpx + xx] = [data[i + 2], data[i + 1], data[i]];
                }
            }
        }
        Ok((px, wpx, hpx, wpx as f64 / w.max(1.0)))
    }

    /// Runs (start, end) in pixel rows of a one-column strip where `pred` holds.
    fn runs(col: &[[u8; 3]], pred: impl Fn([u8; 3]) -> bool, min_len: usize) -> Vec<(usize, usize)> {
        let mut out = vec![];
        let mut start = None;
        for (i, c) in col.iter().enumerate() {
            match (pred(*c), start) {
                (true, None) => start = Some(i),
                (false, Some(s)) => { if i - s >= min_len { out.push((s, i)); } start = None; }
                _ => {}
            }
        }
        if let Some(s) = start { if col.len() - s >= min_len { out.push((s, col.len())); } }
        out
    }

    fn contains(n: &Node, x: f64, y: f64) -> bool {
        n.x <= x && x <= n.x + n.w && n.y <= y && y <= n.y + n.h
    }

    /// Drag a Resolve subtitle animation from Effects > Titles onto the
    /// subtitle track. Works with any panel layout: the effect is found with
    /// the Effects search (it is then the first tile), the subtitle track by
    /// the beige colour strip at the left edge of its track header.
    fn apply_animation(r: &Resolve, name: &str) -> Result<(), String> {
        // Effects panel open.
        let nodes = r.nodes()?;
        if let Some(fx) = nodes.iter().filter(|n| n.role == "AXCheckBox" && n.title == "Effects")
            .min_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal)) {
            if fx.value == "0" { press(&fx.el); sleep(Duration::from_millis(500)); }
        }
        // Effects library: the split group holding the "Favorites" entry.
        let find_lib = |nodes: &[Node]| -> Option<(Node, Node)> {
            let fav = nodes.iter().find(|n| n.role == "AXStaticText" && n.label() == "Favorites")?;
            let sg = nodes.iter()
                .filter(|n| n.role == "AXSplitGroup" && n.w > 300.0 && contains(n, fav.x + 2.0, fav.y + 2.0))
                .min_by(|a, b| (a.w * a.h).partial_cmp(&(b.w * b.h)).unwrap_or(std::cmp::Ordering::Equal))?.clone();
            let list = nodes.iter()
                .filter(|n| n.role == "AXGroup" && n.x > fav.x + 60.0 && n.h > 60.0 && contains(&sg, n.x + 1.0, n.y + 1.0))
                .max_by(|a, b| (a.w * a.h).partial_cmp(&(b.w * b.h)).unwrap_or(std::cmp::Ordering::Equal))?.clone();
            Some((sg, list))
        };
        if std::env::var_os("AUTOSUBS_AX_DEBUG").is_some() {
            let fav: Vec<_> = nodes.iter().filter(|n| n.label() == "Favorites").map(|n| (n.role.clone(), n.x, n.y)).collect();
            let sgs: Vec<_> = nodes.iter().filter(|n| n.role == "AXSplitGroup").map(|n| (n.x, n.y, n.w, n.h)).collect();
            eprintln!("nodes {} fav {:?} splitgroups {:?}", nodes.len(), fav, sgs);
        }
        let (sg, _) = find_lib(&nodes).ok_or("Effects library not found: open the Effects panel in Resolve")?;
        // Search field.
        let search = nodes.iter()
            .filter(|n| n.role == "AXCheckBox" && n.desc == "Search" && n.x >= sg.x && n.x <= sg.x + sg.w + 40.0 && n.y < sg.y + 5.0 && n.y > sg.y - 60.0)
            .min_by(|a, b| (sg.y - a.y).abs().partial_cmp(&(sg.y - b.y).abs()).unwrap_or(std::cmp::Ordering::Equal))
            .ok_or("Effects search not found")?;
        if search.value == "0" { press(&search.el); sleep(Duration::from_millis(400)); }
        let nodes = r.nodes()?;
        let field = nodes.iter()
            .filter(|n| n.role == "AXTextField" && n.y >= sg.y - 10.0 && n.y < sg.y + 60.0 && n.x >= sg.x - 5.0 && n.x < sg.x + sg.w)
            .min_by(|a, b| a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal))
            .ok_or("Effects search field not found")?;
        set_text(&field.el, name);
        sleep(Duration::from_millis(700));

        // The first tile in the filtered list: its black thumbnail.
        let nodes = r.nodes()?;
        let (_, list) = find_lib(&nodes).ok_or("Effects list not found")?;
        let (px, wpx, hpx, scale) = capture(list.x, list.y, 60.0, list.h)?;
        let colx = ((22.0 * scale) as usize).min(wpx.saturating_sub(1));
        let col: Vec<[u8; 3]> = (0..hpx).map(|y| px[y * wpx + colx]).collect();
        let tiles = runs(&col, |c| c[0] < 22 && c[1] < 22 && c[2] < 22, (10.0 * scale) as usize);
        let (t0, t1) = *tiles.first().ok_or(format!("\"{name}\" not found in Resolve's Effects (Titles > Animated)"))?;
        let from = CGPoint::new(list.x + 150.0, list.y + ((t0 + t1) as f64 / 2.0) / scale);

        // Subtitle track header: beige strip at the timeline's left edge.
        let tvo = nodes.iter().find(|n| n.role == "AXMenuButton" && n.desc == "Timeline View Options")
            .ok_or("Timeline not found")?;
        let tl = nodes.iter()
            .filter(|n| n.role == "AXSplitGroup" && n.y >= tvo.y && n.y <= tvo.y + 90.0 && n.x <= tvo.x + 5.0 && n.h > 100.0)
            .max_by(|a, b| (a.w * a.h).partial_cmp(&(b.w * b.h)).unwrap_or(std::cmp::Ordering::Equal))
            .ok_or("Timeline area not found")?.clone();
        let (px, wpx, hpx, scale) = capture(tl.x, tl.y, 6.0, tl.h)?;
        let colx = ((2.0 * scale) as usize).min(wpx.saturating_sub(1));
        let col: Vec<[u8; 3]> = (0..hpx).map(|y| px[y * wpx + colx]).collect();
        let beige = runs(&col, |c| c[0] > 140 && c[1] > 130 && c[2] > 100 && (c[0] as i32 - c[2] as i32) > 20, (8.0 * scale) as usize);
        let (b0, b1) = *beige.first().ok_or("Subtitle track not found in the timeline (no beige track header)")?;
        let to = CGPoint::new(tl.x + 45.0, tl.y + ((b0 + b1) as f64 / 2.0) / scale);

        r.drag(from, to)?;
        sleep(Duration::from_millis(600));
        // Leave the Effects search as it was.
        let nodes = r.nodes()?;
        if let Some(f) = nodes.iter().find(|n| n.role == "AXTextField" && n.value == name) { set_text(&f.el, ""); }
        if let Some(sb) = nodes.iter().find(|n| n.role == "AXCheckBox" && n.desc == "Search" && n.value == "1" && n.x >= sg.x && n.x <= sg.x + sg.w + 40.0) {
            press(&sb.el);
        }
        Ok(())
    }

    fn set_text(el: &CFType, text: &str) {
        unsafe {
            AXUIElementSetAttributeValue(el.as_CFTypeRef(), CFString::new("AXFocused").as_concrete_TypeRef(), CFBoolean::true_value().as_CFTypeRef());
            AXUIElementSetAttributeValue(el.as_CFTypeRef(), CFString::new("AXValue").as_concrete_TypeRef(), CFString::new(text).as_CFTypeRef());
            AXUIElementPerformAction(el.as_CFTypeRef(), CFString::new("AXConfirm").as_concrete_TypeRef());
        }
        sleep(Duration::from_millis(80));
    }

    fn fmt4(v: f64) -> String {
        let s = format!("{:.4}", v);
        let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
        if s.is_empty() || s == "-" { "0".into() } else { s }
    }

    /// Fields of the Fusion subtitle (shown under Track once an animation is
    /// applied): each label is followed by its control.
    fn set_fusion_values(r: &Resolve, s: &InspectorTrackStyle) -> Result<(), String> {
        let fw = if s.frame_width > 0.0 { s.frame_width } else { 1920.0 };
        let fh = if s.frame_height > 0.0 { s.frame_height } else { 1080.0 };
        let field_after = |nodes: &[Node], label: &str, axis: Option<&str>| -> Option<usize> {
            let li = nodes.iter().position(|n| n.role == "AXStaticText" && n.label() == label)?;
            let from = match axis {
                Some(a) => (li..(li + 8).min(nodes.len())).find(|&i| nodes[i].role == "AXStaticText" && nodes[i].label() == a)?,
                None => li,
            };
            (from + 1..(from + 4).min(nodes.len())).find(|&i| nodes[i].role == "AXTextField")
        };
        let set = |label: &str, axis: Option<&str>, v: f64| -> Result<(), String> {
            let nodes = r.nodes()?;
            let i = field_after(&nodes, label, axis).ok_or(format!("Animation field {label} not found"))?;
            let cur: f64 = nodes[i].value.parse().unwrap_or(f64::NAN);
            if (cur - v).abs() > 0.00005 {
                set_text(&nodes[i].el, &fmt4(v));
            }
            Ok(())
        };
        // Font and face: the two combo boxes after "Font".
        for (k, want) in [(0usize, &s.font), (1, &s.font_face)] {
            let nodes = r.nodes()?;
            let li = nodes.iter().position(|n| n.role == "AXStaticText" && n.label() == "Font").ok_or("Animation field Font not found")?;
            let combos: Vec<usize> = (li + 1..(li + 12).min(nodes.len())).filter(|&i| nodes[i].role == "AXComboBox").collect();
            if let Some(&ci) = combos.get(k) {
                if !nodes[ci].title.eq_ignore_ascii_case(want) {
                    press(&nodes[ci].el);
                    sleep(Duration::from_millis(250));
                    r.type_text(want);
                    sleep(Duration::from_millis(80));
                    r.key(36, CGEventFlags::empty());
                    sleep(Duration::from_millis(300));
                }
            }
        }
        set("Center", Some("X"), s.position_x / fw)?;
        set("Center", Some("Y"), s.position_y / fh)?;
        // Track Style size 58 is Resolve's default, the Fusion default 0.06.
        // Fusion sizes follow the frame width, the track style the height,
        // so portrait frames need the height/width ratio on top.
        set("Size", None, s.size * 0.06 / 58.0 * (fh / fw).max(1.0))?;
        set("Tracking", None, 1.0 + s.kerning / 100.0)?;
        set("Line Spacing", None, 1.0 + s.line_spacing / 100.0)?;
        set("Thickness", None, if s.stroke_size > 0.0 { s.stroke_size * 0.01 } else { 0.0 })?;
        // Colours: best effort (the Fusion colour swatch has no accessible
        // value); a failure here keeps the rest of the look.
        for (label, hex) in [("Color", &s.color), ("Highlight Color", &s.highlight_color), ("Outline Color", &s.stroke_color)] {
            if let Err(e) = fusion_color(r, label, hex) {
                if std::env::var_os("AUTOSUBS_AX_DEBUG").is_some() { eprintln!("colour {label}: {e}"); }
            }
        }
        Ok(())
    }

    /// Fusion colour swatch: click it and set the macOS colour panel, if the
    /// swatch opens one.
    fn fusion_color(r: &Resolve, label: &str, hex: &str) -> Result<(), String> {
        let (tr, tg, tb) = parse_hex(hex).ok_or(format!("bad colour {hex}"))?;
        let locate = |nodes: &[Node]| -> Option<usize> {
            let li = nodes.iter().position(|n| n.role == "AXStaticText" && n.label() == label)?;
            (li + 1..(li + 3).min(nodes.len())).find(|&i| nodes[i].role == "AXButton")
        };
        // A double click on a Fusion colour swatch opens the colour panel.
        click_visible_n(r, label, locate, true)?;
        let t = Instant::now();
        let panel = loop {
            if let Some(p) = find_color_panel(r) { break p; }
            if t.elapsed() > Duration::from_millis(1200) { return Err("no colour panel".into()); }
            sleep(Duration::from_millis(80));
        };
        sleep(Duration::from_millis(150));
        let mut nodes = Vec::new();
        collect(&panel, 0, &mut nodes);
        let hex_field = nodes.iter().find(|n| n.role == "AXTextField" && n.title.is_empty() && n.value.len() == 6)
            .ok_or("colour panel: hex field not found")?;
        set_text(&hex_field.el, &format!("{:02X}{:02X}{:02X}", tr, tg, tb));
        let ok = attr(panel.as_CFTypeRef(), "AXDefaultButton")
            .or_else(|| nodes.iter().find(|n| n.role == "AXButton" && n.title == "OK").map(|n| n.el.clone()))
            .ok_or("colour panel: OK not found")?;
        press(&ok);
        let t = Instant::now();
        while find_color_panel(r).is_some() && t.elapsed() < Duration::from_millis(1500) {
            sleep(Duration::from_millis(60));
        }
        Ok(())
    }

    pub fn apply(style: &InspectorTrackStyle) -> Result<String, String> {
        let t0 = Instant::now();
        let opts = CFDictionary::from_CFType_pairs(&[(
            CFString::new("AXTrustedCheckOptionPrompt").as_CFType(),
            CFBoolean::true_value().as_CFType(),
        )]);
        if !unsafe { AXIsProcessTrustedWithOptions(opts.as_CFTypeRef()) } {
            return Err("AutoSubs needs Accessibility access: System Settings > Privacy & Security > Accessibility > AutoSubs".into());
        }
        let r = Resolve::find()?;
        r.bring_front()?;
        // Exactly one caption must be selected: with several (or a video clip
        // too) Resolve hides the Track tab. The Lua side parked the playhead on
        // the first caption; with auto-select on the subtitle track only,
        // "Select All Clips Under Playhead" picks just that caption.
        // The Inspector must be open to show the selection.
        let nodes = r.nodes()?;
        if let Some(i) = nodes.iter().position(|n| n.role == "AXCheckBox" && n.title == "Inspector") {
            if nodes[i].value == "0" { press(&nodes[i].el); sleep(Duration::from_millis(250)); }
        }
        let restore = |r: &Resolve| {
            let _ = r.menu(&["Edit", "Deselect All"]);
            let _ = r.menu(&["Timeline", "Auto Select", "Auto Select All Tracks"]);
        };
        if let Err(e) = select_caption(&r) {
            restore(&r);
            return Err(e);
        }
        let result = (|| -> Result<(), String> {
            // A Resolve animation replaces the track style with a Fusion
            // subtitle. Remove an existing one so the new choice applies.
            if has_fusion_subtitle(&r)? {
                remove_fusion_subtitle(&r)?;
                select_caption(&r)?;
            }
            if style.animation.is_empty() {
                set_values(&r, style)
            } else {
                apply_animation(&r, &style.animation)?;
                select_caption(&r)?;
                set_fusion_values(&r, style)
            }
        })();
        restore(&r);
        result.map(|_| format!("Track style set in {} ms", t0.elapsed().as_millis()))
    }

    const SECTIONS: [&str; 7] = ["Character", "Transform", "Stroke", "Style and Position", "Drop Shadow", "Background", "Subtitle Settings"];

    /// Index range of a Inspector section. Accessibility lists a section's
    /// controls first and its title last, sections in SECTIONS order.
    fn sec(l: &Layout, name: &str) -> Option<(usize, usize)> {
        let upto = (l.end + 1).min(l.nodes.len());
        let pos = |n: &str| find_label(&l.nodes, l.start, upto, n);
        let me = pos(name)?;
        let k = SECTIONS.iter().position(|s| *s == name)?;
        let from = SECTIONS[..k].iter().rev().find_map(|s| pos(s)).unwrap_or(l.start);
        Some((from, me))
    }

    fn in_sec(l: &Layout, section: &str, label: &str) -> Option<usize> {
        let (a, b) = sec(l, section)?;
        find_label(&l.nodes, a, b, label)
    }

    fn slider_in(r: &Resolve, section: &'static str, label: &'static str, value: f64, scale: f64) -> Result<(), String> {
        set_slider(r, move |l| before(&l.nodes, in_sec(l, section, label)?, "AXSlider"), value, scale)
            .map_err(|e| format!("{section} > {label}: {e}"))
    }

    fn xy_in(r: &Resolve, section: &'static str, label: &'static str, x: f64, y: f64) -> Result<(), String> {
        edit_number(r, x, move |l| xy_field(&l.nodes, in_sec(l, section, label)?, "X"))?;
        edit_number(r, y, move |l| xy_field(&l.nodes, in_sec(l, section, label)?, "Y"))
    }

    /// Section on/off switch: the checkbox right before the section title.
    fn section_toggle(r: &Resolve, section: &str, on: bool) -> Result<(), String> {
        let l = layout(r)?;
        let (_, t) = sec(&l, section).ok_or(format!("{section} not found"))?;
        let cb = before(&l.nodes, t, "AXCheckBox").ok_or(format!("{section} switch not found"))?;
        if (l.nodes[cb].value == "1") != on {
            press(&l.nodes[cb].el);
            sleep(Duration::from_millis(350));
        }
        Ok(())
    }

    fn titled_checkbox(r: &Resolve, title: &str, on: bool) -> Result<(), String> {
        let l = layout(r)?;
        let i = (l.start..l.nodes.len()).find(|&i| l.nodes[i].role == "AXCheckBox" && l.nodes[i].title == title)
            .ok_or(format!("{title} not found"))?;
        if (l.nodes[i].value == "1") != on {
            press(&l.nodes[i].el);
            sleep(Duration::from_millis(120));
        }
        Ok(())
    }

    /// Icon button row (Alignment, Anchor): the checkboxes right before the
    /// label; `pick` is the index of the one to switch on. These need a real
    /// click: an accessibility press flips the button but Resolve keeps the
    /// old value.
    fn icon_row(r: &Resolve, section: &str, label: &str, pick: usize) -> Result<(), String> {
        for _ in 0..12 {
            let l = layout(r)?;
            let li = in_sec(&l, section, label).ok_or(format!("{label} not found"))?;
            // Walk back over the row's reset button / spacers to its checkboxes.
            let mut boxes = vec![];
            let mut i = li;
            while i > 0 {
                i -= 1;
                let n = &l.nodes[i];
                if n.role == "AXCheckBox" {
                    boxes.insert(0, i);
                } else if !boxes.is_empty() || !(n.role == "AXButton" || (n.role == "AXStaticText" && n.label().is_empty())) {
                    break;
                }
            }
            let target = *boxes.get(pick).ok_or(format!("{label}: option {pick} missing"))?;
            let n = &l.nodes[target];
            if n.value == "1" {
                return Ok(());
            }
            if visible(l.area, n) {
                r.click(n.center())?;
                sleep(Duration::from_millis(150));
                return Ok(());
            }
            let mid = CGPoint::new(l.area.0 + l.area.2 / 2.0, l.area.1 + l.area.3 / 2.0);
            r.scroll(mid, if n.y < l.area.1 { 6 } else { -6 });
        }
        Err(format!("Could not reach {label} in the Inspector"))
    }

    fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
        let h = hex.trim().trim_start_matches('#');
        if h.len() != 6 { return None; }
        Some((u8::from_str_radix(&h[0..2], 16).ok()?, u8::from_str_radix(&h[2..4], 16).ok()?, u8::from_str_radix(&h[4..6], 16).ok()?))
    }

    /// Colour well (the button right before a "Color" label): opens the macOS
    /// colour panel, which has a hex field and an OK button.
    fn color_in(r: &Resolve, section: &str, label: &str, hex: &str) -> Result<(), String> {
        let (tr, tg, tb) = parse_hex(hex).ok_or(format!("bad colour {hex}"))?;
        let l = layout(r)?;
        let li = in_sec(&l, section, label).ok_or(format!("{section} > {label} not found"))?;
        let bi = (li.saturating_sub(4)..li).rev().find(|&i| l.nodes[i].role == "AXButton" && l.nodes[i].desc.contains("rgb"))
            .ok_or(format!("{section} > {label}: no colour button"))?;
        let desc: String = {
            let mut out = String::new();
            let mut tag = false;
            for c in l.nodes[bi].desc.chars() {
                match c { '<' => tag = true, '>' => tag = false, _ if !tag => out.push(c), _ => {} }
            }
            out
        };
        let nums: Vec<u8> = desc.split(|c: char| !c.is_ascii_digit()).filter_map(|x| x.parse().ok()).collect();
        if nums.len() >= 3 && (nums[0], nums[1], nums[2]) == (tr, tg, tb) {
            return Ok(());
        }
        if std::env::var_os("AUTOSUBS_AX_DEBUG").is_some() {
            eprintln!("color {section}>{label}: label#{li} @{},{} button#{bi} @{},{} desc={desc}", l.nodes[li].x, l.nodes[li].y, l.nodes[bi].x, l.nodes[bi].y);
        }
        let panel = open_color_panel(r, section, label)?;
        sleep(Duration::from_millis(150));
        let mut nodes = Vec::new();
        collect(&panel, 0, &mut nodes);
        let hex_field = nodes.iter().find(|n| n.role == "AXTextField" && n.title.is_empty() && n.value.len() == 6)
            .ok_or("colour panel: hex field not found")?;
        let ok = attr(panel.as_CFTypeRef(), "AXDefaultButton")
            .or_else(|| nodes.iter().find(|n| n.role == "AXButton" && n.title == "OK").map(|n| n.el.clone()))
            .ok_or("colour panel: OK not found")?;
        let key = CFString::new("AXValue");
        let val = CFString::new(&format!("{:02X}{:02X}{:02X}", tr, tg, tb));
        unsafe {
            AXUIElementSetAttributeValue(hex_field.el.as_CFTypeRef(), CFString::new("AXFocused").as_concrete_TypeRef(), CFBoolean::true_value().as_CFTypeRef());
            AXUIElementSetAttributeValue(hex_field.el.as_CFTypeRef(), key.as_concrete_TypeRef(), val.as_CFTypeRef());
            AXUIElementPerformAction(hex_field.el.as_CFTypeRef(), CFString::new("AXConfirm").as_concrete_TypeRef());
        }
        sleep(Duration::from_millis(120));
        press(&ok);
        // Wait for the panel to close before the next control.
        let t = Instant::now();
        while find_color_panel(r).is_some() && t.elapsed() < Duration::from_millis(1500) {
            sleep(Duration::from_millis(60));
        }
        Ok(())
    }

    /// The colour dialog: a window with a colour well (title is localised).
    fn find_color_panel(r: &Resolve) -> Option<CFType> {
        let wins = attr(r.app.as_CFTypeRef(), "AXWindows")?;
        let arr: CFArray<CFType> = unsafe { CFArray::wrap_under_get_rule(wins.as_CFTypeRef() as CFArrayRef) };
        let found = arr.iter().find(|w| {
            let mut nodes = Vec::new();
            let (ww, hh) = attr_point(w.as_CFTypeRef(), "AXSize", AX_SIZE);
            if ww * hh > 400_000.0 { return false; } // the main window
            collect(w, 0, &mut nodes);
            nodes.iter().any(|n| n.role == "AXColorWell")
        }).map(|w| w.clone());
        found
    }

    /// Open the colour dialog for a colour button: scroll it into view and
    /// click it (a freshly enabled section ignores an accessibility press);
    /// fall back to an accessibility press.
    fn open_color_panel(r: &Resolve, section: &str, label: &str) -> Result<CFType, String> {
        let button = |l: &Layout| -> Option<usize> {
            let li = in_sec(l, section, label)?;
            (li.saturating_sub(4)..li).rev().find(|&i| l.nodes[i].role == "AXButton" && l.nodes[i].desc.contains("rgb"))
        };
        for attempt in 0..3 {
            // Scroll into view (up to 12 steps), then click.
            let mut clicked = false;
            for _ in 0..12 {
                let l = layout(r)?;
                let bi = button(&l).ok_or(format!("{section} > {label}: no colour button"))?;
                let n = &l.nodes[bi];
                if visible(l.area, n) {
                    if attempt < 2 { r.click(n.center())?; } else { press(&n.el); }
                    clicked = true;
                    break;
                }
                let mid = CGPoint::new(l.area.0 + l.area.2 / 2.0, l.area.1 + l.area.3 / 2.0);
                r.scroll(mid, if n.y < l.area.1 { 6 } else { -6 });
            }
            if !clicked {
                return Err(format!("{section} > {label}: could not scroll to the colour button"));
            }
            let t = Instant::now();
            while t.elapsed() < Duration::from_millis(1500) {
                sleep(Duration::from_millis(80));
                if let Some(p) = find_color_panel(r) {
                    sleep(Duration::from_millis(150));
                    return Ok(p);
                }
            }
        }
        Err(format!("{section} > {label}: colour panel did not open"))
    }

    fn set_values(r: &Resolve, s: &InspectorTrackStyle) -> Result<(), String> {
        // Video tab, Track sub-tab.
        let nodes = r.nodes()?;
        if let Some(i) = nodes.iter().position(|n| n.role == "AXCheckBox" && n.title == "Video") {
            if nodes[i].value == "0" { press(&nodes[i].el); sleep(Duration::from_millis(200)); }
        }
        let nodes = r.nodes()?;
        let track = nodes.iter().position(|n| n.role == "AXCheckBox" && n.title == "Track" && nodes.iter().any(|m| m.title == "Caption"))
            .ok_or("No subtitle selected: is there a caption on the subtitle track?")?;
        if nodes[track].value == "0" { press(&nodes[track].el); sleep(Duration::from_millis(200)); }

        // Character
        choose_combo(r, 0, &s.font)?;
        choose_combo(r, 1, &s.font_face)?;
        color_in(r, "Character", "Color", &s.color)?;
        slider_in(r, "Character", "Size", s.size, 1.0)?;
        slider_in(r, "Character", "Line Spacing", s.line_spacing, 1.0)?;
        slider_in(r, "Character", "Kerning", s.kerning, 1.0)?;
        choose_combo(r, 2, &s.font_case)?;
        let align = ["left", "center", "right", "justify"].iter().position(|a| *a == s.alignment).unwrap_or(1);
        icon_row(r, "Character", "Alignment", align)?;

        // Stroke
        color_in(r, "Stroke", "Color", &s.stroke_color)?;
        slider_in(r, "Stroke", "Size", s.stroke_size, 1.0)?;
        titled_checkbox(r, "Outside Only", s.stroke_outside_only)?;

        // Transform
        xy_in(r, "Transform", "Position", s.position_x, s.position_y)?;
        xy_in(r, "Transform", "Zoom", s.zoom_x, s.zoom_y)?;
        slider_in(r, "Transform", "Opacity", s.opacity, 100.0)?;
        let v = ["top", "middle", "bottom"].iter().position(|a| *a == s.anchor_v).unwrap_or(1);
        let h = ["left", "center", "right"].iter().position(|a| *a == s.anchor_h).unwrap_or(1);
        icon_row(r, "Transform", "Anchor", v)?;
        icon_row(r, "Transform", "Anchor", 3 + h)?;

        // Drop Shadow
        section_toggle(r, "Drop Shadow", s.shadow)?;
        if s.shadow {
            color_in(r, "Drop Shadow", "Color", &s.shadow_color)?;
            xy_in(r, "Drop Shadow", "Offset", s.shadow_offset_x, s.shadow_offset_y)?;
            slider_in(r, "Drop Shadow", "Blur", s.shadow_blur, 1.0)?;
            slider_in(r, "Drop Shadow", "Opacity", s.shadow_opacity, 1.0)?;
        }

        // Background
        section_toggle(r, "Background", s.background)?;
        if s.background {
            color_in(r, "Background", "Color", &s.background_color)?;
            color_in(r, "Background", "Outline Color", &s.background_outline_color)?;
            slider_in(r, "Background", "Outline Width", s.background_outline_width, 1.0)?;
            slider_in(r, "Background", "Corner Radius", s.background_corner_radius, 1000.0)?;
            slider_in(r, "Background", "Opacity", s.background_opacity, 1.0)?;
            titled_checkbox(r, "Override Sizing", s.background_override_sizing)?;
        }

        // Subtitle Settings
        section_toggle(r, "Subtitle Settings", s.subtitle_settings)?;
        if s.subtitle_settings {
            titled_checkbox(r, "Use Project Settings", s.use_project_settings)?;
            if !s.use_project_settings {
                slider_in(r, "Subtitle Settings", "Max Line Length", s.max_line_length, 1.0)?;
                slider_in(r, "Subtitle Settings", "Min Duration", s.min_duration, 1.0)?;
                slider_in(r, "Subtitle Settings", "Max CPS", s.max_cps, 1.0)?;
            }
        }
        Ok(())
    }

    /// Set a slider through accessibility. Qt sliders hold integer steps:
    /// `scale` converts the shown value to steps (Opacity 100.00 = 10000).
    fn set_slider<F>(r: &Resolve, locate: F, value: f64, scale: f64) -> Result<(), String>
    where
        F: Fn(&Layout) -> Option<usize>,
    {
        let l = layout(r)?;
        let i = locate(&l).ok_or("slider not found")?;
        let target = (value * scale).round();
        let current: f64 = l.nodes[i].value.parse().unwrap_or(f64::NAN);
        if (current - target).abs() < 0.5 {
            return Ok(());
        }
        if !set_number(&l.nodes[i].el, target) {
            return Err("Resolve refused the value".into());
        }
        sleep(Duration::from_millis(60));
        Ok(())
    }
}

/// `autosubs --apply-track-style '<json>'`: run once and exit (testing aid).
pub fn handle_args() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("--apply-track-style") {
        return;
    }
    let style: InspectorTrackStyle = match args.get(2).map(|s| serde_json::from_str(s)) {
        Some(Ok(s)) => s,
        _ => { eprintln!("usage: --apply-track-style '<json>'"); std::process::exit(2) }
    };
    #[cfg(target_os = "macos")]
    match mac::apply(&style) {
        Ok(m) => { println!("{m}"); std::process::exit(0) }
        Err(e) => { eprintln!("{e}"); std::process::exit(1) }
    }
    #[cfg(not(target_os = "macos"))]
    std::process::exit(1);
}

#[tauri::command]
pub async fn apply_resolve_track_style(style: InspectorTrackStyle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || mac::apply(&style))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = style;
        Err("Setting the subtitle track style is only available on macOS".into())
    }
}
