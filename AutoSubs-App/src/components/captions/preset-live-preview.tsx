import * as React from "react";
import type { CaptionPreset } from "@/types";
import { loadPresetFont } from "@/lib/preset-fonts";

/**
 * Animated stand-in for a caption preset: a sample line drawn with the
 * preset's font, colours, outline, shadow, highlight and reveal animation.
 *
 * It is an approximation in CSS so the gallery can show every style at a
 * glance without a round trip into Resolve; Fusion stays the source of truth
 * for the exact look (see AGENTS.md 3b).
 */
const SAMPLE = ["Lennart", "Karl", "trifft", "für", "Bayern", "München"];
/** Sample words drawn in the keyword colour (players, clubs). */
const SAMPLE_KEYWORDS = new Set([0, 1, 4, 5]);
const WORD_MS = 420;
const HOLD_MS = 1300;

type Settings = Record<string, unknown>;

const num = (s: Settings, key: string, fallback: number) => {
  const v = s[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

const rgb = (s: Settings, prefix: string, fallback: [number, number, number]) => {
  const c = (k: string, f: number) => Math.round(Math.min(1, Math.max(0, num(s, `${prefix}${k}`, f))) * 255);
  return `rgb(${c("Red", fallback[0])}, ${c("Green", fallback[1])}, ${c("Blue", fallback[2])})`;
};

function fontWeight(style: unknown): number {
  const s = String(style ?? "").toLowerCase();
  if (s.includes("black") || s.includes("heavy")) return 900;
  if (s.includes("extra") && s.includes("bold")) return 800;
  if (s.includes("semi") || s.includes("demi")) return 600;
  if (s.includes("bold")) return 700;
  if (s.includes("medium")) return 500;
  if (s.includes("light")) return 300;
  return 400;
}

export function PresetLivePreview({ preset, className }: { preset: CaptionPreset; className?: string }) {
  const s = (preset.macroSettings ?? {}) as Settings;

  const pop = num(s, "PopInEnabled", 0) === 1;
  const fade = num(s, "FadeEnabled", 0) === 1;
  const slide = num(s, "SlideUpEnabled", 0) === 1;
  const animated = pop || fade || slide;
  const wordByWord = num(s, "AnimationLevel", 1) === 1;
  const highlightOn = num(s, "HighlightEnabled", 0) === 1;
  const highlightStyle = num(s, "HighlightStyle", 0); // 0 Fill, 1 Outline, 2 Shadow, 3 Bubble
  const keywordsOn = num(s, "KeywordEnabled", 1) === 1;
  const durationMs = Math.max(80, num(s, "AnimationLength", 0.2) * 1000);

  // The preset's own font file, so customer fonts (e.g. "Tipico Medium")
  // show even when the webview cannot see user-installed fonts.
  const fontName = String(s.Font ?? "Arial");
  const fontStyle = String(s.Style ?? "Regular");
  const [loadedFont, setLoadedFont] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    setLoadedFont(null);
    loadPresetFont(fontName, fontStyle).then((name) => {
      if (!cancelled) setLoadedFont(name);
    });
    return () => {
      cancelled = true;
    };
  }, [fontName, fontStyle]);

  // Step through the words, hold the full line, start again.
  const [active, setActive] = React.useState(0);
  React.useEffect(() => {
    const last = active >= SAMPLE.length - 1;
    const id = window.setTimeout(() => setActive(last ? 0 : active + 1), last ? HOLD_MS : WORD_MS);
    return () => window.clearTimeout(id);
  }, [active]);

  const fill = rgb(s, "FillColor", [1, 1, 1]);
  const outline = rgb(s, "OutlineColor", [0, 0, 0]);
  const shadow = rgb(s, "ShadowColor", [0, 0, 0]);
  const highlight = rgb(s, "HighlightColor", [1, 0.9, 0.3]);
  const keyword = rgb(s, "KeywordColor", [0.784, 0.063, 0.18]); // #C8102E
  const fillOn = num(s, "FillEnabled", 1) === 1;
  const outlineOn = num(s, "OutlineEnabled", 0) === 1;
  const shadowOn = num(s, "ShadowEnabled", 0) === 1;
  const outlineEm = Math.min(0.25, num(s, "OutlineThickness", 0.05) * 1.6);

  const size = num(s, "TextSize", 0.07);
  const pos = Array.isArray(s.TextPosition) ? (s.TextPosition as number[]) : [0.5, 0.12];
  const [x, y] = [pos[0] ?? 0.5, pos[1] ?? 0.12];

  const wordStyle = (i: number): React.CSSProperties => {
    const isActive = highlightOn && i === active;
    const isKeyword = keywordsOn && SAMPLE_KEYWORDS.has(i);
    const color = isActive && highlightStyle === 0 ? highlight : isKeyword ? keyword : fillOn ? fill : "transparent";
    const stroke = isActive && highlightStyle === 1 ? highlight : outline;
    const showStroke = outlineOn || (isActive && highlightStyle === 1);
    const shadowColor = isActive && highlightStyle === 2 ? highlight : shadow;
    const showShadow = shadowOn || (isActive && highlightStyle === 2);

    const revealed = !animated || (wordByWord ? i <= active : true);
    const entering = animated && (wordByWord ? i === active : active === 0);

    return {
      color,
      WebkitTextStroke: showStroke ? `${outlineEm}em ${stroke}` : undefined,
      paintOrder: "stroke fill",
      textShadow: showShadow ? `0.06em 0.08em 0.12em ${shadowColor}` : undefined,
      background: isActive && highlightStyle === 3 ? highlight : undefined,
      borderRadius: "0.25em",
      padding: "0 0.12em",
      display: "inline-block",
      opacity: revealed ? 1 : 0,
      transform: entering && pop ? "scale(1)" : undefined,
      animation: entering
        ? `${pop ? "as-pop" : slide ? "as-slide" : "as-fade"} ${durationMs}ms ease-out`
        : undefined,
    };
  };

  return (
    <div
      className={className}
      // Positioning comes from `className` (the card passes `absolute inset-0`);
      // an inline `position` here would override it and collapse the box.
      style={{ overflow: "hidden", containerType: "size" }}
      aria-hidden
    >
      <style>{`
        @keyframes as-pop { 0% { transform: scale(0.3); opacity: 0 } 70% { transform: scale(1.12); opacity: 1 } 100% { transform: scale(1) } }
        @keyframes as-slide { 0% { transform: translateY(0.6em); opacity: 0 } 100% { transform: translateY(0); opacity: 1 } }
        @keyframes as-fade { 0% { opacity: 0 } 100% { opacity: 1 } }
      `}</style>
      <div
        style={{
          position: "absolute",
          left: `${x * 100}%`,
          bottom: `${y * 100}%`,
          transform: "translateX(-50%)",
          width: "92%",
          textAlign: "center",
          lineHeight: 1.15,
          fontFamily: `${loadedFont ? `"${loadedFont}", ` : ""}"${fontName}", -apple-system, Helvetica, Arial, sans-serif`,
          // A loaded file already is the right cut; only synthesise weight
          // and slant for fonts picked by family name.
          fontWeight: loadedFont ? undefined : fontWeight(fontStyle),
          fontStyle: !loadedFont && fontStyle.toLowerCase().includes("italic") ? "italic" : undefined,
          // Fusion sizes Text+ relative to the frame width.
          fontSize: `${Math.max(3, size * 100)}cqw`,
        }}
      >
        {SAMPLE.map((w, i) => (
          <React.Fragment key={i}>
            <span style={wordStyle(i)}>{w}</span>{" "}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
