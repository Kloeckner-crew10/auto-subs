import type { TrackStyle } from "@/types";

/** Resolve's own defaults for Inspector > Track (subtitle track). */
export const RESOLVE_TRACK_DEFAULTS: Required<TrackStyle> = {
  font: "Open Sans",
  fontFace: "Semibold",
  size: 58,
  color: "#ffffff",
  lineSpacing: 0,
  kerning: 0,
  fontCase: "Mixed",
  alignment: "center",
  strokeColor: "#ffffff",
  strokeSize: 1,
  strokeOutsideOnly: false,
  positionX: 1080,
  positionY: 768,
  zoomX: 1,
  zoomY: 1,
  opacity: 100,
  anchorV: "middle",
  anchorH: "center",
  shadow: false,
  shadowColor: "#000000",
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowBlur: 20,
  shadowOpacity: 75,
  background: false,
  backgroundColor: "#000000",
  backgroundOutlineColor: "#000000",
  backgroundOutlineWidth: 0,
  backgroundCornerRadius: 0.01,
  backgroundOpacity: 50,
  backgroundOverrideSizing: false,
  subtitleSettings: true,
  useProjectSettings: true,
  maxLineLength: 60,
  minDuration: 3,
  maxCps: 30,
};

/** A stored look with every Inspector field filled in. */
export function fullTrackStyle(look: Partial<TrackStyle>): Required<TrackStyle> {
  const out = { ...RESOLVE_TRACK_DEFAULTS };
  for (const [k, v] of Object.entries(look)) {
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
