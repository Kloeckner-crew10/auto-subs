import * as React from "react";
import { Check, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getTimelineResolution } from "@/api/resolve-api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { Subtitle, SubtitleStyleDef, TrackStyle } from "@/types";

const SAMPLE_WORDS = ["Lennart Karl", "trifft", "für", "Bayern München"];
const SAMPLE: Subtitle = {
  id: 0,
  start: 0,
  end: SAMPLE_WORDS.length,
  text: SAMPLE_WORDS.join(" "),
  words: SAMPLE_WORDS.map((w, i) => ({ word: i ? ` ${w}` : w, start: i, end: i + 1 })),
} as Subtitle;
const STEP_MS = 650;

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
    name: t("trackStyles.newName"),
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
            badge={style.mode === "karaoke" ? t("trackPreview.karaoke") : t("trackPreview.plain")}
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
      style.mode === "karaoke"
        ? karaokeSubtitles([SAMPLE], keywords, keywordColor, style.highlightColor)
        : colorKeywords([SAMPLE], keywords, keywordColor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [style.mode, style.highlightColor, keywordColor, keywords.join("|")],
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
  const num = (v: string, fallback: number) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? t("trackStyles.add") : t("trackStyles.edit")}</DialogTitle>
          <DialogDescription>{t("trackStyles.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-lg border">
          <TrackPreviewBox style={draft} />
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <Field label={t("trackStyles.name")} wide>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label={t("trackStyles.mode")}>
            <Select value={draft.mode} onValueChange={(v) => setDraft({ ...draft, mode: v as SubtitleStyleDef["mode"] })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plain">{t("trackPreview.plain")}</SelectItem>
                <SelectItem value="karaoke">{t("trackPreview.karaoke")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("trackPreview.highlightColor")}>
            <ColorInput
              value={draft.highlightColor}
              disabled={draft.mode !== "karaoke"}
              onChange={(v) => setDraft({ ...draft, highlightColor: v })}
            />
          </Field>
          <Field label={t("trackStyles.font")}>
            <Input value={draft.look.font} onChange={(e) => setLook({ font: e.target.value })} />
          </Field>
          <Field label={t("trackStyles.fontFace")}>
            <Input value={draft.look.fontFace} onChange={(e) => setLook({ fontFace: e.target.value })} />
          </Field>
          <Field label={t("trackStyles.size")}>
            <Input inputMode="decimal" value={draft.look.size} onChange={(e) => setLook({ size: num(e.target.value, draft.look.size) })} />
          </Field>
          <Field label={t("trackStyles.color")}>
            <ColorInput value={draft.look.color} onChange={(v) => setLook({ color: v })} />
          </Field>
          <Field label={t("trackPreview.shadow")} wide>
            <label className="flex items-center gap-2">
              <Checkbox checked={draft.look.shadow} onCheckedChange={(v) => setLook({ shadow: v === true })} />
              {t("trackStyles.shadowOn")}
            </label>
          </Field>
          {draft.look.shadow && (
            <>
              <Field label={t("trackStyles.shadowColor")}>
                <ColorInput value={draft.look.shadowColor} onChange={(v) => setLook({ shadowColor: v })} />
              </Field>
              <Field label={t("trackStyles.shadowOpacity")}>
                <Input inputMode="decimal" value={draft.look.shadowOpacity} onChange={(e) => setLook({ shadowOpacity: num(e.target.value, draft.look.shadowOpacity) })} />
              </Field>
              <Field label={t("trackStyles.offsetX")}>
                <Input inputMode="decimal" value={draft.look.shadowOffsetX} onChange={(e) => setLook({ shadowOffsetX: num(e.target.value, draft.look.shadowOffsetX) })} />
              </Field>
              <Field label={t("trackStyles.offsetY")}>
                <Input inputMode="decimal" value={draft.look.shadowOffsetY} onChange={(e) => setLook({ shadowOffsetY: num(e.target.value, draft.look.shadowOffsetY) })} />
              </Field>
              <Field label={t("trackStyles.blur")}>
                <Input inputMode="decimal" value={draft.look.shadowBlur} onChange={(e) => setLook({ shadowBlur: num(e.target.value, draft.look.shadowBlur) })} />
              </Field>
            </>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("trackStyles.resolveHint")}</p>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-1">
            {!isNew && (
              <>
                <Button variant="ghost" className="text-destructive" onClick={() => onDelete(style.id)}>
                  <Trash2 className="size-4" />
                  {t("profiles.delete")}
                </Button>
                <Button variant="ghost" onClick={() => onDuplicate(draft)}>
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
            <Button onClick={() => onSave({ ...draft, name: draft.name.trim() || t("trackStyles.newName") })}>
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
