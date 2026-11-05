import * as React from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getTimelineResolution } from "@/api/resolve-api";
import { colorKeywords, karaokeSubtitles } from "@/lib/keyword-markup";
import { getActiveProfile, profileKeywords } from "@/lib/customer-profiles";
import { loadPresetFont } from "@/lib/preset-fonts";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";
import type { Subtitle, SubtitleTrackStyle, TrackStyle } from "@/types";

const SAMPLE_WORDS = ["Lennart Karl", "trifft", "für", "Bayern München"];
const SAMPLE: Subtitle = {
  id: 0,
  start: 0,
  end: SAMPLE_WORDS.length,
  text: SAMPLE_WORDS.join(" "),
  words: SAMPLE_WORDS.map((w, i) => ({ word: i ? ` ${w}` : w, start: i, end: i + 1 })),
} as Subtitle;
const STEP_MS = 650;

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

/** Split SRT `<font color>` markup into coloured runs. */
function toRuns(marked: string) {
  const runs: { text: string; color?: string }[] = [];
  let last = 0;
  for (const m of marked.matchAll(/<font color="([^"]+)">(.*?)<\/font>/g)) {
    if ((m.index ?? 0) > last) runs.push({ text: marked.slice(last, m.index) });
    runs.push({ text: m[2], color: m[1] });
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < marked.length) runs.push({ text: marked.slice(last) });
  return runs;
}

/**
 * Styles for Resolve's own subtitle track: the customer's track look (font,
 * size, colour, shadow, set once in Resolve) plus how AutoSubs writes the
 * cues: plain, or one cue per word with the active word highlighted.
 */
export function SubtitleTrackPreview() {
  const { t } = useTranslation();
  const profiles = useSettingsStore((s) => s.customerProfiles);
  const activeProfileId = useSettingsStore((s) => s.activeProfileId);
  const trackStyle = useSettingsStore((s) => s.subtitleTrackStyle) ?? { mode: "plain", highlightColor: "#FFE64A" };
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const profile = getActiveProfile({ customerProfiles: profiles, activeProfileId });
  const look = { ...FALLBACK_STYLE, ...(profile?.trackStyle ?? {}) };

  const select = (patch: Partial<SubtitleTrackStyle>) =>
    updateSetting("subtitleTrackStyle", { ...trackStyle, ...patch });

  return (
    <section className="space-y-1.5">
      <p className="pl-1 text-xs text-muted-foreground">{t("trackPreview.label")}</p>
      <div className="grid gap-2">
        <StyleCard
          title={t("trackPreview.plain")}
          selected={trackStyle.mode === "plain"}
          onSelect={() => select({ mode: "plain" })}
        >
          <TrackPreviewBox look={look} mode="plain" highlight={trackStyle.highlightColor} />
        </StyleCard>
        <StyleCard
          title={t("trackPreview.karaoke")}
          selected={trackStyle.mode === "karaoke"}
          onSelect={() => select({ mode: "karaoke" })}
          action={
            <input
              type="color"
              title={t("trackPreview.highlightColor")}
              aria-label={t("trackPreview.highlightColor")}
              value={trackStyle.highlightColor}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => select({ mode: "karaoke", highlightColor: e.target.value })}
              className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          }
        >
          <TrackPreviewBox look={look} mode="karaoke" highlight={trackStyle.highlightColor} />
        </StyleCard>
      </div>
      <div className="space-y-1 px-1 pt-1 text-[11px] text-muted-foreground">
        <p>
          {t("trackPreview.explain")} {look.font} {look.fontFace} · {look.size} · {look.color}
          {look.shadow ? ` · ${t("trackPreview.shadow")}` : ""}
        </p>
        <p>{t("trackPreview.fusionOnly")}</p>
      </div>
    </section>
  );
}

function StyleCard({
  title,
  selected,
  onSelect,
  action,
  children,
}: {
  title: string;
  selected: boolean;
  onSelect: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      className={cn(
        "relative cursor-pointer overflow-hidden rounded-xl border bg-card transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-foreground/30",
      )}
    >
      {children}
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-5 pt-2">
        <span className="flex-1 truncate text-xs font-semibold text-white">{title}</span>
        {action}
      </div>
      {selected && (
        <span className="absolute bottom-2 right-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-2.5" />
        </span>
      )}
    </div>
  );
}

function TrackPreviewBox({ look, mode, highlight }: { look: TrackStyle; mode: SubtitleTrackStyle["mode"]; highlight: string }) {
  const profiles = useSettingsStore((s) => s.customerProfiles);
  const activeProfileId = useSettingsStore((s) => s.activeProfileId);
  const profile = getActiveProfile({ customerProfiles: profiles, activeProfileId });
  const keywordColor = profile?.keywordColor ?? "#C8102E";
  const keywords = profileKeywords(profile);

  const [frame, setFrame] = React.useState({ width: 1080, height: 1920 });
  React.useEffect(() => {
    getTimelineResolution()
      .then((r) => r?.width && r?.height && setFrame({ width: r.width, height: r.height }))
      .catch(() => undefined);
  }, []);

  const [fontFamily, setFontFamily] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    loadPresetFont(look.font, look.fontFace).then((name) => !cancelled && setFontFamily(name));
    return () => {
      cancelled = true;
    };
  }, [look.font, look.fontFace]);

  // Karaoke: step through the per-word cues the SRT will contain.
  const cues = React.useMemo(
    () =>
      mode === "karaoke"
        ? karaokeSubtitles([SAMPLE], keywords, keywordColor, highlight)
        : colorKeywords([SAMPLE], keywords, keywordColor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, highlight, keywordColor, keywords.join("|")],
  );
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    if (cues.length < 2) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % cues.length), STEP_MS);
    return () => window.clearInterval(id);
  }, [cues.length]);
  const runs = toRuns(cues[Math.min(step, cues.length - 1)]?.text ?? SAMPLE.text);

  // Card is landscape; the frame (e.g. 9:16) sits centred inside it.
  const cardH = 190;
  const frameH = cardH;
  const frameW = Math.round((frameH * frame.width) / frame.height);
  // Calibrated against Resolve's viewer: size 38 on a 1920-high frame is
  // about 4 % of the frame height; shadow fields are in tenths of that unit.
  const unit = (frameH / 1080) * 1.2;
  const shadow = look.shadow
    ? `${look.shadowOffsetX * 0.1 * unit}px ${-look.shadowOffsetY * 0.1 * unit}px ${look.shadowBlur * 0.1 * unit}px ${hexToRgba(look.shadowColor, look.shadowOpacity / 100)}`
    : undefined;

  return (
    <div className="flex h-[190px] items-center justify-center bg-neutral-900">
      <div className="relative h-full overflow-hidden bg-neutral-800" style={{ width: frameW }}>
        <div
          className="absolute inset-x-0 text-center"
          style={{
            top: "62%",
            padding: "0 6%",
            fontFamily: `${fontFamily ? `"${fontFamily}", ` : ""}"${look.font}", -apple-system, Helvetica, sans-serif`,
            fontSize: look.size * unit,
            lineHeight: 1.2,
            color: look.color,
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
    </div>
  );
}
