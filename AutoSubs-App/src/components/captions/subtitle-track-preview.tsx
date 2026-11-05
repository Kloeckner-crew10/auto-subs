import * as React from "react";
import { Check, ChevronRight, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getTimelineResolution } from "@/api/resolve-api";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { colorKeywords, karaokeSubtitles } from "@/lib/keyword-markup";
import { getActiveProfile, profileKeywords } from "@/lib/customer-profiles";
import { loadPresetFont } from "@/lib/preset-fonts";
import { TIPICO_TRACK_STYLE } from "@/presets/built-in-profiles";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";
import { fullTrackStyle } from "@/lib/track-style";
import { TrackInspectorEditor } from "@/components/captions/track-inspector-editor";
import type { Subtitle, SubtitleAnimation, SubtitleStyleDef, TrackStyle } from "@/types";

const SAMPLE_WORDS = ["Lennart Karl", "trifft", "für", "Bayern München"];
const SAMPLE: Subtitle = {
  id: 0,
  start: 0,
  end: SAMPLE_WORDS.length,
  text: SAMPLE_WORDS.join(" "),
  words: SAMPLE_WORDS.map((w, i) => ({ word: i ? ` ${w}` : w, start: i, end: i + 1 })),
} as Subtitle;
const STEP_MS = 650;

/** Rough stand-ins for Resolve's subtitle animations, for the preview only. */
const PREVIEW_KEYFRAMES = `
@keyframes as-slide { 0% { transform: translateX(-40%); opacity: 0 } 30%, 100% { transform: none; opacity: 1 } }
@keyframes as-rotate { 0% { transform: rotate(-90deg) scale(.5); opacity: 0 } 30%, 100% { transform: none; opacity: 1 } }
@keyframes as-pop { 0% { transform: scale(.2) } 15% { transform: scale(1.15) } 30%, 100% { transform: scale(1) } }
`;

function previewAnimation(animation?: string) {
  switch (animation) {
    case "Slide In": return "as-slide 2.6s ease-out infinite";
    case "Rotate": return "as-rotate 2.6s ease-out infinite";
    case "Lollipop":
    case "Statement": return "as-pop 2.6s ease-out infinite";
    default: return undefined;
  }
}

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
 * Styles for Resolve's own subtitle track. Each style is a track look (font,
 * size, colour, shadow, which the editor sets once in Resolve's Inspector)
 * plus how AutoSubs writes the cues: plain, or one cue per word with the
 * active word highlighted. Users can add, edit, duplicate and delete styles.
 */
export function SubtitleTrackPreview() {
  const { t } = useTranslation();
  const styles = useSettingsStore((s) => s.subtitleStyles) ?? [];
  const activeId = useSettingsStore((s) => s.activeSubtitleStyleId);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const [editing, setEditing] = React.useState<{ style: SubtitleStyleDef; isNew: boolean } | null>(null);

  const active = styles.find((s) => s.id === activeId) ?? styles[0];

  const save = (style: SubtitleStyleDef) => {
    const exists = styles.some((s) => s.id === style.id);
    updateSetting("subtitleStyles", exists ? styles.map((s) => (s.id === style.id ? style : s)) : [...styles, style]);
    updateSetting("activeSubtitleStyleId", style.id);
    setEditing(null);
  };
  const remove = (id: string) => {
    const next = styles.filter((s) => s.id !== id);
    updateSetting("subtitleStyles", next);
    if (activeId === id) updateSetting("activeSubtitleStyleId", next[0]?.id ?? null);
    setEditing(null);
  };
  const newStyle = (): SubtitleStyleDef => ({
    id: crypto.randomUUID(),
    name: "",
    mode: "plain",
    highlightColor: "#FFE64A",
    look: { ...(active?.look ?? TIPICO_TRACK_STYLE) },
  });

  return (
    <section className="space-y-1.5">
      <p className="pl-1 text-xs text-muted-foreground">{t("trackPreview.label")}</p>
      <div className="grid gap-2">
        {styles.map((style) => (
          <StyleCard
            key={style.id}
            title={style.name}
            badge={style.animation && style.animation !== "none" ? style.animation : t("trackPreview.plain")}
            selected={style.id === active?.id}
            onSelect={() => updateSetting("activeSubtitleStyleId", style.id)}
            onEdit={() => setEditing({ style, isNew: false })}
            editLabel={t("common.edit", "Edit")}
          >
            <TrackPreviewBox style={style} />
          </StyleCard>
        ))}
        <button
          type="button"
          onClick={() => setEditing({ style: newStyle(), isNew: true })}
          className="flex h-14 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          <Plus className="size-4" />
          {t("trackStyles.add")}
        </button>
      </div>
      {active && (
        <div className="space-y-1 px-1 pt-1 text-[11px] text-muted-foreground">
          <p>
            {t("trackPreview.explain")} {active.look.font} {active.look.fontFace} · {active.look.size} ·{" "}
            {active.look.color}
            {active.look.shadow ? ` · ${t("trackPreview.shadow")}` : ""}
          </p>
          <p>{t("trackPreview.fusionOnly")}</p>
        </div>
      )}
      {editing && (
        <SubtitleStyleDialog
          style={editing.style}
          isNew={editing.isNew}
          onSave={save}
          onDuplicate={(s) =>
            setEditing({ style: { ...structuredClone(s), id: crypto.randomUUID(), name: `${s.name} ${t("trackStyles.copySuffix")}` }, isNew: true })
          }
          onDelete={remove}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function StyleCard({
  title,
  badge,
  selected,
  onSelect,
  onEdit,
  editLabel,
  children,
}: {
  title: string;
  badge: string;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  editLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-xl border bg-card transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-foreground/30",
      )}
    >
      {children}
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-5 pt-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{title}</span>
        <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 text-[10px] text-white/80">{badge}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={editLabel}
          className="size-6 text-white/80 hover:bg-white/15 hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
      {selected && (
        <span className="absolute bottom-2 right-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-2.5" />
        </span>
      )}
    </div>
  );
}

function TrackPreviewBox({ style }: { style: SubtitleStyleDef }) {
  const look = style.look;
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

  const cues = React.useMemo(
    () =>
      style.animation === "Word Highlight"
        ? karaokeSubtitles([SAMPLE], keywords, keywordColor, style.highlightColor)
        : colorKeywords([SAMPLE], keywords, keywordColor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [style.animation, style.highlightColor, keywordColor, keywords.join("|")],
  );
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    if (cues.length < 2) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % cues.length), STEP_MS);
    return () => window.clearInterval(id);
  }, [cues.length]);
  const runs = toRuns(cues[Math.min(step, cues.length - 1)]?.text ?? SAMPLE.text);

  const frameH = 190;
  const frameW = Math.round((frameH * frame.width) / frame.height);
  // Calibrated against Resolve's viewer: size 38 on a 1920-high frame is
  // about 4 % of the frame height; shadow fields are in tenths of that unit.
  const unit = (frameH / 1080) * 1.2;
  const full = fullTrackStyle(look);
  const shadow = full.shadow
    ? `${full.shadowOffsetX * 0.1 * unit}px ${-full.shadowOffsetY * 0.1 * unit}px ${full.shadowBlur * 0.1 * unit}px ${hexToRgba(full.shadowColor, (full.shadowOpacity / 100) * (full.opacity / 100))}`
    : undefined;
  // Resolve measures Position from the bottom-left of the frame.
  const bottomPct = (full.positionY / frame.height) * 100;
  const shiftPct = (full.positionX / frame.width - 0.5) * 100;
  const textTransform =
    full.fontCase === "All Caps" ? "uppercase" : full.fontCase === "All Lowercase" ? "lowercase" : full.fontCase === "Title Caps" ? "capitalize" : undefined;

  return (
    <div className="flex h-[190px] items-center justify-center bg-neutral-900">
      <div className="relative h-full overflow-hidden bg-neutral-800" style={{ width: frameW }}>
        <div
          className="absolute inset-x-0"
          style={{
            bottom: `${bottomPct}%`,
            transform: `translate(${shiftPct}%, 50%) scale(${full.zoomX}, ${full.zoomY})`,
            padding: "0 6%",
            textAlign: full.alignment === "justify" ? "justify" : full.alignment,
            fontFamily: `${fontFamily ? `"${fontFamily}", ` : ""}"${full.font}", -apple-system, Helvetica, sans-serif`,
            fontSize: full.size * unit,
            lineHeight: 1.2 + full.lineSpacing / 100,
            letterSpacing: `${full.kerning / 100}em`,
            fontVariant: full.fontCase === "Small Caps" ? "small-caps" : undefined,
            textTransform,
            color: full.color,
            opacity: full.opacity / 100,
            textShadow: shadow,
            WebkitTextStroke: full.strokeSize > 0 ? `${full.strokeSize * 0.1 * unit}px ${full.strokeColor}` : undefined,
            paintOrder: full.strokeOutsideOnly ? "stroke fill" : undefined,
          }}
        >
          <style>{PREVIEW_KEYFRAMES}</style>
          <span
            key={`${style.animation}-${step}`}
            style={
              full.background || style.animation === "Statement"
                ? {
                    display: "inline-block",
                    animation: previewAnimation(style.animation),
                    background: style.animation === "Statement" && !full.background ? "#e00000" : hexToRgba(full.backgroundColor, full.backgroundOpacity / 100),
                    outline: full.backgroundOutlineWidth > 0 ? `${full.backgroundOutlineWidth * 0.1 * unit}px solid ${full.backgroundOutlineColor}` : undefined,
                    borderRadius: `${full.backgroundCornerRadius * 100}%`,
                    padding: "0 0.25em",
                    boxDecorationBreak: "clone",
                    WebkitBoxDecorationBreak: "clone",
                  }
                : { display: "inline-block", animation: previewAnimation(style.animation) }
            }
          >
          {runs.map((r, i) => (
            <span key={i} style={r.color ? { color: r.color } : undefined}>
              {r.text}
            </span>
          ))}
          </span>
        </div>
      </div>
    </div>
  );
}

function SubtitleStyleDialog({
  style,
  isNew,
  onSave,
  onDuplicate,
  onDelete,
  onClose,
}: {
  style: SubtitleStyleDef;
  isNew: boolean;
  onSave: (s: SubtitleStyleDef) => void;
  onDuplicate: (s: SubtitleStyleDef) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState<SubtitleStyleDef>(structuredClone(style));
  const setLook = (patch: Partial<TrackStyle>) => setDraft((d) => ({ ...d, look: { ...d.look, ...patch } }));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? t("trackStyles.add") : t("trackStyles.edit")}</DialogTitle>
          <DialogDescription>{t("trackStyles.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <Field label={t("trackStyles.name")} wide>
            <Input
              value={draft.name}
              autoFocus={isNew}
              placeholder={t("trackStyles.namePlaceholder")}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label={t("trackStyles.animation")}>
            <Select
              value={draft.animation ?? "none"}
              onValueChange={(v) => setDraft({ ...draft, mode: "plain", animation: v as SubtitleAnimation })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("trackStyles.animationNone")}</SelectItem>
                {(["Word Highlight", "Lollipop", "Rotate", "Slide In", "Statement"] as const).map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("trackPreview.highlightColor")}>
            <ColorInput
              value={draft.highlightColor}
              disabled={draft.animation !== "Word Highlight"}
              onChange={(v) => setDraft({ ...draft, highlightColor: v })}
            />
          </Field>
        </div>

        {/* Resolve imports subtitles onto subtitle track 1 only, so a
            subtitle-track style cannot carry its own look; that is what the
            Fusion styles (video track) are for. */}
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          {t("trackStyles.oneLookHint")}
        </p>

        <Collapsible defaultOpen>
          <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
            <ChevronRight className="size-3.5" />
            {t("trackStyles.previewValues")}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <div className="overflow-hidden rounded-lg border">
              <TrackPreviewBox style={draft} />
            </div>
            <TrackInspectorEditor look={draft.look} onChange={setLook} />
          </CollapsibleContent>
        </Collapsible>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-1">
            {!isNew && (
              <>
                <Button variant="ghost" className="text-destructive" onClick={() => onDelete(style.id)}>
                  <Trash2 className="size-4" />
                  {t("profiles.delete")}
                </Button>
                <Button variant="ghost" onClick={() => onDuplicate({ ...draft, trackName: undefined })}>
                  <Copy className="size-4" />
                  {t("trackStyles.duplicate")}
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!draft.name.trim()}
              onClick={() => onSave({ ...draft, name: draft.name.trim() || t("trackStyles.newName") })}
            >
              {t("profiles.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1", wide && "col-span-2")}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ColorInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", disabled && "opacity-50")}>
      <input
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="size-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
      />
      <Input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="font-mono" />
    </div>
  );
}
