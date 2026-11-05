import * as React from "react";
import { useTranslation } from "react-i18next";
import { getTimelineResolution } from "@/api/resolve-api";
import { colorKeywords } from "@/lib/keyword-markup";
import { getActiveProfile, profileKeywords } from "@/lib/customer-profiles";
import { loadPresetFont } from "@/lib/preset-fonts";
import { useSettingsStore } from "@/stores/settings-store";
import type { Subtitle, TrackStyle } from "@/types";

const SAMPLE = "Lennart Karl trifft für Bayern München";

const FALLBACK_STYLE: TrackStyle = {
  font: "Helvetica",
  fontFace: "Regular",
  size: 38,
  color: "#ffffff",
  shadow: true,
  shadowColor: "#000000",
  shadowOffsetX: 25,
  shadowOffsetY: -25,
  shadowBlur: 7,
  shadowOpacity: 75,
};

function hexToRgba(hex: string, alpha: number) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return `rgba(0,0,0,${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

/**
 * What Resolve's subtitle track will look like: the customer's track style
 * (font, size, colour, drop shadow) with keywords in the profile colour. The
 * track has no animation, so neither does the preview.
 */
export function SubtitleTrackPreview() {
  const { t } = useTranslation();
  const profiles = useSettingsStore((s) => s.customerProfiles);
  const activeProfileId = useSettingsStore((s) => s.activeProfileId);
  const profile = getActiveProfile({ customerProfiles: profiles, activeProfileId });
  const style = { ...FALLBACK_STYLE, ...(profile?.trackStyle ?? {}) };

  const [frame, setFrame] = React.useState({ width: 1080, height: 1920 });
  React.useEffect(() => {
    getTimelineResolution()
      .then((r) => r?.width && r?.height && setFrame({ width: r.width, height: r.height }))
      .catch(() => undefined);
  }, []);

  const [fontFamily, setFontFamily] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    loadPresetFont(style.font, style.fontFace).then((name) => !cancelled && setFontFamily(name));
    return () => {
      cancelled = true;
    };
  }, [style.font, style.fontFace]);

  // Split the sample into plain and keyword-coloured runs.
  const color = profile?.keywordColor ?? "#C8102E";
  const marked = colorKeywords([{ text: SAMPLE } as Subtitle], profileKeywords(profile), color)[0].text ?? SAMPLE;
  const runs: { text: string; color?: string }[] = [];
  const re = /<font color="([^"]+)">(.*?)<\/font>/g;
  let last = 0;
  for (const m of marked.matchAll(re)) {
    if ((m.index ?? 0) > last) runs.push({ text: marked.slice(last, m.index) });
    runs.push({ text: m[2], color: m[1] });
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < marked.length) runs.push({ text: marked.slice(last) });

  // Resolve's track sizes are relative to a 1080-high frame; the shadow
  // fields are in tenths of that unit.
  // Calibrated against Resolve's viewer: size 38 on a 1920-high frame
  // renders about 4 % of the frame height tall.
  const boxH = 300;
  const unit = (boxH / 1080) * 1.2;
  const boxW = Math.round((boxH * frame.width) / frame.height);
  const shadow = style.shadow
    ? `${style.shadowOffsetX * 0.1 * unit}px ${-style.shadowOffsetY * 0.1 * unit}px ${style.shadowBlur * 0.1 * unit}px ${hexToRgba(style.shadowColor, style.shadowOpacity / 100)}`
    : undefined;

  return (
    <section className="space-y-1.5">
      <p className="pl-1 text-xs text-muted-foreground">{t("trackPreview.label")}</p>
      <div className="flex gap-3 rounded-md border bg-muted/30 p-2.5">
        <div
          className="relative shrink-0 overflow-hidden rounded-sm bg-neutral-800"
          style={{ width: Math.min(boxW, 300), height: boxH * (Math.min(boxW, 300) / boxW) }}
        >
          <div
            className="absolute inset-x-0 text-center"
            style={{
              top: "62%",
              padding: "0 6%",
              fontFamily: `${fontFamily ? `"${fontFamily}", ` : ""}"${style.font}", -apple-system, Helvetica, sans-serif`,
              fontSize: style.size * unit * (Math.min(boxW, 300) / boxW),
              lineHeight: 1.2,
              color: style.color,
              textShadow: shadow,
            }}
          >
            {runs.map((r, i) => (
              <span key={i} style={r.color ? { color: r.color } : undefined}>
                {r.text}
              </span>
            ))}
          </div>
        </div>
        <div className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
          <p>{t("trackPreview.explain")}</p>
          <p>
            {style.font} {style.fontFace} · {style.size} · {style.color}
            {style.shadow ? ` · ${t("trackPreview.shadow")}` : ""}
          </p>
          <p>{t("trackPreview.fusionOnly")}</p>
        </div>
      </div>
    </section>
  );
}
