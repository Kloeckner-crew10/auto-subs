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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectorTrackStyle {
    pub font: String,
    pub font_face: String,
    pub size: f64,
    pub shadow: bool,
    pub shadow_offset_x: f64,
    pub shadow_offset_y: f64,
    pub shadow_blur: f64,
    pub shadow_opacity: f64,
    pub position_x: Option<f64>,
    pub position_y: Option<f64>,
    pub stroke_size: Option<f64>,
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

        fn window(&self) -> Result<CFType, String> {
            let wins = attr(self.app.as_CFTypeRef(), "AXWindows").ok_or("Resolve has no window")?;
            let arr: CFArray<CFType> = unsafe { CFArray::wrap_under_get_rule(wins.as_CFTypeRef() as CFArrayRef) };
            for w in arr.iter() {
                if attr_string(w.as_CFTypeRef(), "AXTitle").starts_with("DaVinci Resolve") {
                    return Ok(w.clone());
                }
            }
            arr.iter().next().map(|w| w.clone()).ok_or_else(|| "Resolve has no window".into())
        }

        fn nodes(&self) -> Result<Vec<Node>, String> {
            let w = self.window()?;
            let mut out = Vec::with_capacity(512);
            collect(&w, 0, &mut out);
            Ok(out)
        }

        fn bring_front(&self) -> Result<(), String> {
            let key = CFString::new("AXFrontmost");
            unsafe {
                AXUIElementSetAttributeValue(self.app.as_CFTypeRef(), key.as_concrete_TypeRef(), CFBoolean::true_value().as_CFTypeRef());
            }
            let t = Instant::now();
            while t.elapsed() < Duration::from_secs(2) {
                if attr_string(self.app.as_CFTypeRef(), "AXFrontmost") == "1" {
                    sleep(Duration::from_millis(80));
                    return Ok(());
                }
                sleep(Duration::from_millis(40));
            }
            Err("Could not bring DaVinci Resolve to the front".into())
        }

        fn is_front(&self) -> bool {
            attr_string(self.app.as_CFTypeRef(), "AXFrontmost") == "1"
        }

        fn menu(&self, top: &str, item: &str) -> Result<(), String> {
            let bar = attr(self.app.as_CFTypeRef(), "AXMenuBar").ok_or("no menu bar")?;
            for m in children(bar.as_CFTypeRef()) {
                if attr_string(m.as_CFTypeRef(), "AXTitle") != top { continue; }
                for menu in children(m.as_CFTypeRef()) {
                    for it in children(menu.as_CFTypeRef()) {
                        if attr_string(it.as_CFTypeRef(), "AXTitle") == item {
                            press(&it);
                            return Ok(());
                        }
                    }
                }
            }
            Err(format!("menu item {top} > {item} not found"))
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
        r.menu("Edit", "Select All")?;
        sleep(Duration::from_millis(250));

        // Inspector open, Video tab, Track sub-tab.
        let nodes = r.nodes()?;
        if let Some(i) = nodes.iter().position(|n| n.role == "AXCheckBox" && n.title == "Inspector") {
            if nodes[i].value == "0" { press(&nodes[i].el); sleep(Duration::from_millis(250)); }
        }
        let nodes = r.nodes()?;
        if let Some(i) = nodes.iter().position(|n| n.role == "AXCheckBox" && n.title == "Video") {
            if nodes[i].value == "0" { press(&nodes[i].el); sleep(Duration::from_millis(200)); }
        }
        let nodes = r.nodes()?;
        let track = nodes.iter().position(|n| n.role == "AXCheckBox" && n.title == "Track" && nodes.iter().any(|m| m.title == "Caption"))
            .ok_or("No subtitle selected: is there a caption on the subtitle track?")?;
        if nodes[track].value == "0" { press(&nodes[track].el); sleep(Duration::from_millis(200)); }

        // Character
        choose_combo(&r, 0, &style.font)?;
        choose_combo(&r, 1, &style.font_face)?;
        set_slider(&r, |l| {
            let ch = find_label(&l.nodes, l.start, l.end, "Character")?;
            let s = (l.start..ch).find(|&i| l.nodes[i].role == "AXStaticText" && l.nodes[i].label() == "Size")?;
            before(&l.nodes, s, "AXSlider")
        }, style.size)?;
        if let Some(stroke) = style.stroke_size {
            set_slider(&r, |l| {
                let tr = find_label(&l.nodes, l.start, l.end, "Transform")?;
                let st = find_label(&l.nodes, tr, l.end, "Stroke")?;
                let s = (tr..st).find(|&i| l.nodes[i].role == "AXStaticText" && l.nodes[i].label() == "Size")?;
                before(&l.nodes, s, "AXSlider")
            }, stroke)?;
        }

        // Drop shadow
        {
            let l = layout(&r)?;
            if let Some(d) = find_label(&l.nodes, l.start, l.end, "Drop Shadow") {
                if let Some(cb) = before(&l.nodes, d, "AXCheckBox") {
                    if (l.nodes[cb].value == "1") != style.shadow {
                        press(&l.nodes[cb].el);
                        sleep(Duration::from_millis(150));
                    }
                }
            }
        }
        if style.shadow {
            let section = |l: &Layout| -> Option<(usize, usize)> {
                let d = find_label(&l.nodes, l.start, l.end, "Drop Shadow")?;
                let from = find_label(&l.nodes, l.start, d, "Style and Position").unwrap_or(l.start);
                Some((from, d))
            };
            set_slider(&r, |l| {
                let (a, b) = section(l)?;
                before(&l.nodes, find_label(&l.nodes, a, b, "Blur")?, "AXSlider")
            }, style.shadow_blur)?;
            set_slider(&r, |l| {
                let (a, b) = section(l)?;
                before(&l.nodes, find_label(&l.nodes, a, b, "Opacity")?, "AXSlider")
            }, style.shadow_opacity)?;
            edit_number(&r, style.shadow_offset_x, |l| {
                let (a, b) = section(l)?;
                xy_field(&l.nodes, find_label(&l.nodes, a, b, "Offset")?, "X")
            })?;
            edit_number(&r, style.shadow_offset_y, |l| {
                let (a, b) = section(l)?;
                xy_field(&l.nodes, find_label(&l.nodes, a, b, "Offset")?, "Y")
            })?;
        }

        // Position
        let pos = |l: &Layout| -> Option<usize> {
            let tr = find_label(&l.nodes, l.start, l.end, "Transform")?;
            let ch = find_label(&l.nodes, l.start, tr, "Character")?;
            find_label(&l.nodes, ch, tr, "Position")
        };
        if let Some(x) = style.position_x {
            edit_number(&r, x, |l| xy_field(&l.nodes, pos(l)?, "X"))?;
        }
        if let Some(y) = style.position_y {
            edit_number(&r, y, |l| xy_field(&l.nodes, pos(l)?, "Y"))?;
        }

        let _ = r.menu("Edit", "Deselect All");
        Ok(format!("Track style set in {} ms", t0.elapsed().as_millis()))
    }

    fn set_slider<F>(r: &Resolve, locate: F, value: f64) -> Result<(), String>
    where
        F: Fn(&Layout) -> Option<usize>,
    {
        let l = layout(r)?;
        let i = locate(&l).ok_or("Inspector slider not found")?;
        let current: f64 = l.nodes[i].value.parse().unwrap_or(f64::NAN);
        if (current - value).abs() < 0.0005 {
            return Ok(());
        }
        // Qt sliders report integer steps; the label next to the slider shows
        // the real value. Scale by the ratio when they differ (e.g. 0..1 x 100).
        let shown: f64 = l.nodes.get(i + 1).and_then(|n| n.label().parse().ok()).unwrap_or(current);
        let scale = if shown != 0.0 && current.is_finite() && (current / shown - 1.0).abs() > 0.01 { current / shown } else { 1.0 };
        if !set_number(&l.nodes[i].el, (value * scale).round()) {
            return Err("Resolve refused a slider value".into());
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
