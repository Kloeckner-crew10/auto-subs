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
        // Exactly one caption must be selected: with several (or a video clip
        // too) Resolve hides the Track tab. The Lua side parked the playhead on
        // the first caption; with auto-select on the subtitle track only,
        // "Select All Clips Under Playhead" picks just that caption.
        // The Inspector must be open to show the selection.
        let nodes = r.nodes()?;
        if let Some(i) = nodes.iter().position(|n| n.role == "AXCheckBox" && n.title == "Inspector") {
            if nodes[i].value == "0" { press(&nodes[i].el); sleep(Duration::from_millis(250)); }
        }
        r.menu(&["Edit", "Deselect All"])?;
        r.menu(&["Timeline", "Auto Select", "Auto Select All Tracks"])?;
        r.menu(&["Timeline", "Auto Select", "Auto Select/Deselect All Video"])?;
        r.menu(&["Timeline", "Auto Select", "Auto Select/Deselect All Audio"])?;
        r.menu(&["Trim", "Select All Clips Under Playhead"])?;
        let restore = |r: &Resolve| {
            let _ = r.menu(&["Edit", "Deselect All"]);
            let _ = r.menu(&["Timeline", "Auto Select", "Auto Select All Tracks"]);
        };
        let t = Instant::now();
        let mut selected = false;
        while t.elapsed() < Duration::from_millis(2000) {
            sleep(Duration::from_millis(100));
            if r.nodes().map(|n| n.iter().any(|m| m.role == "AXCheckBox" && m.title == "Caption")).unwrap_or(false) {
                selected = true;
                break;
            }
        }
        if !selected {
            restore(&r);
            return Err("Resolve did not select a caption. Click one caption on the subtitle track and send again.".into());
        }
        let result = set_values(&r, style);
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
        press(&l.nodes[bi].el);
        // Find the "Colors" panel (press once more if a just-enabled section
        // swallowed the first press).
        let t = Instant::now();
        let mut repressed = false;
        let panel = loop {
            let wins = attr(r.app.as_CFTypeRef(), "AXWindows");
            let found = wins.and_then(|w| {
                let arr: CFArray<CFType> = unsafe { CFArray::wrap_under_get_rule(w.as_CFTypeRef() as CFArrayRef) };
                arr.iter().find(|w| attr_string(w.as_CFTypeRef(), "AXTitle") == "Colors").map(|w| w.clone())
            });
            if let Some(p) = found { break p; }
            if !repressed && t.elapsed() > Duration::from_millis(800) {
                repressed = true;
                if let Ok(l2) = layout(r) {
                    if let Some(li2) = in_sec(&l2, section, label) {
                        if let Some(b2) = (li2.saturating_sub(4)..li2).rev().find(|&i| l2.nodes[i].role == "AXButton" && l2.nodes[i].desc.contains("rgb")) {
                            press(&l2.nodes[b2].el);
                        }
                    }
                }
            }
            if t.elapsed() > Duration::from_millis(2500) {
                return Err(format!("{section} > {label}: colour panel did not open"));
            }
            sleep(Duration::from_millis(60));
        };
        sleep(Duration::from_millis(150));
        let mut nodes = Vec::new();
        collect(&panel, 0, &mut nodes);
        let hex_field = nodes.iter().find(|n| n.role == "AXTextField" && n.title.is_empty() && n.value.len() == 6)
            .ok_or("colour panel: hex field not found")?;
        let ok = nodes.iter().find(|n| n.role == "AXButton" && n.title == "OK").ok_or("colour panel: OK not found")?;
        let key = CFString::new("AXValue");
        let val = CFString::new(&format!("{:02X}{:02X}{:02X}", tr, tg, tb));
        unsafe {
            AXUIElementSetAttributeValue(hex_field.el.as_CFTypeRef(), CFString::new("AXFocused").as_concrete_TypeRef(), CFBoolean::true_value().as_CFTypeRef());
            AXUIElementSetAttributeValue(hex_field.el.as_CFTypeRef(), key.as_concrete_TypeRef(), val.as_CFTypeRef());
            AXUIElementPerformAction(hex_field.el.as_CFTypeRef(), CFString::new("AXConfirm").as_concrete_TypeRef());
        }
        sleep(Duration::from_millis(120));
        press(&ok.el);
        sleep(Duration::from_millis(250));
        Ok(())
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
