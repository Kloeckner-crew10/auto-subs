//! Font files for the caption style previews.
//!
//! The webview may not see fonts the user installed for Resolve (e.g. a
//! customer font in ~/Library/Fonts), so the preview asks for the file and
//! registers it itself. Matching is by file name: family plus style words.

use std::path::{Path, PathBuf};
use tauri::command;
use tauri::ipc::Response;

fn font_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join("Library/Fonts"));
        dirs.push(home.join(".local/share/fonts"));
        dirs.push(home.join(".fonts"));
    }
    if let Some(local) = dirs::data_local_dir() {
        dirs.push(local.join("Microsoft/Windows/Fonts"));
    }
    for d in [
        "/Library/Fonts",
        "/System/Library/Fonts",
        "/System/Library/Fonts/Supplemental",
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        "C:\\Windows\\Fonts",
    ] {
        dirs.push(PathBuf::from(d));
    }
    dirs
}

fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() && depth > 0 {
            collect(&p, out, depth - 1);
        } else if matches!(
            p.extension().and_then(|x| x.to_str()).map(|x| x.to_ascii_lowercase()).as_deref(),
            Some("ttf" | "otf")
        ) {
            out.push(p);
        }
    }
}

/// Best file for `family` + `style`: exact style match, then a regular
/// cut, then any file of the family.
fn find_font(family: &str, style: &str) -> Option<PathBuf> {
    let fam = squash(family);
    if fam.is_empty() {
        return None;
    }
    let sty = squash(style);
    let mut files = Vec::new();
    for d in font_dirs() {
        collect(&d, &mut files, 2);
    }
    let named: Vec<(PathBuf, String)> = files
        .into_iter()
        .filter_map(|p| {
            let stem = squash(p.file_stem()?.to_str()?);
            stem.starts_with(&fam).then_some((p, stem))
        })
        .collect();
    let rest = |stem: &str| stem[fam.len()..].to_string();
    named
        .iter()
        .find(|(_, s)| !sty.is_empty() && rest(s) == sty)
        .or_else(|| named.iter().find(|(_, s)| !sty.is_empty() && rest(s).contains(&sty)))
        .or_else(|| named.iter().find(|(_, s)| matches!(rest(s).as_str(), "" | "regular" | "roman" | "book")))
        .or_else(|| named.first())
        .map(|(p, _)| p.clone())
}

/// Raw bytes of the installed font file, or an error when none matches.
#[command]
pub fn read_font_file(family: String, style: Option<String>) -> Result<Response, String> {
    let path = find_font(&family, style.as_deref().unwrap_or(""))
        .ok_or_else(|| format!("font not found: {family}"))?;
    let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::squash;

    #[test]
    fn squash_normalises_names() {
        assert_eq!(squash("Tipico Medium"), "tipicomedium");
        assert_eq!(squash("Arial Rounded MT Bold"), "arialroundedmtbold");
    }
}

#[derive(serde::Serialize)]
pub struct FontFamily {
    pub family: String,
    pub faces: Vec<String>,
}

/// Installed font families with their faces (the same names Resolve's
/// Inspector lists). Sync command: Tauri runs it on the main thread, which
/// NSFontManager requires.
#[command]
pub fn list_system_fonts() -> Result<Vec<FontFamily>, String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSFontManager;
        use objc2_foundation::NSString;
        let mtm = MainThreadMarker::new().ok_or("font list must run on the main thread")?;
        let fm = NSFontManager::sharedFontManager(mtm);
        let mut out = Vec::new();
        for fam in fm.availableFontFamilies().iter() {
            let name = fam.to_string();
            if name.starts_with('.') {
                continue; // hidden system UI fonts
            }
            let mut faces = Vec::new();
            if let Some(members) = fm.availableMembersOfFontFamily(&fam) {
                for m in members.iter() {
                    if let Some(style) = m.iter().nth(1).and_then(|o| o.downcast::<NSString>().ok()) {
                        let s = style.to_string();
                        if !faces.contains(&s) {
                            faces.push(s);
                        }
                    }
                }
            }
            out.push(FontFamily { family: name, faces });
        }
        out.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()));
        Ok(out)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Vec::new())
    }
}
