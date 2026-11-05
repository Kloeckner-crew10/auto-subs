import { invoke } from "@tauri-apps/api/core";

/**
 * Load a font installed on this machine (e.g. a customer font only Resolve
 * knows about) into the webview for the caption previews. Resolves to the
 * CSS family name to use, or null when no matching file was found; system
 * fonts the webview already knows then still work by their own name.
 */
const cache = new Map<string, Promise<string | null>>();

export function loadPresetFont(family: string, style: string): Promise<string | null> {
  const key = `${family}|${style}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const data = await invoke<ArrayBuffer>("read_font_file", { family, style });
        const name = `AutoSubsPreview ${family} ${style}`.trim();
        const face = new FontFace(name, data);
        await face.load();
        document.fonts.add(face);
        return name;
      } catch {
        return null;
      }
    })();
    cache.set(key, pending);
  }
  return pending;
}
