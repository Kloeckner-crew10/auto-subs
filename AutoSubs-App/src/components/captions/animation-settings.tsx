import * as React from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColorField, FontPicker, loadFonts, Section, type FontFamily } from "@/components/captions/track-inspector-editor";
import { ANIMATION_FIELDS, type AnimationField } from "@/lib/animation-fields";
import type { SubtitleAnimation, TrackStyle } from "@/types";

type Settings = Record<string, number | string>;

/**
 * Settings of the chosen Resolve animation, laid out like Resolve's
 * Inspector (one collapsible section, grouped fields, reset arrows). Every
 * field is optional: unset keeps the style's own value (font, colour, size)
 * or Resolve's default.
 */
export function AnimationSettings({
  animation,
  look,
  value,
  onChange,
}: {
  animation: Exclude<SubtitleAnimation, "none">;
  look: TrackStyle;
  value: Settings;
  onChange: (v: Settings) => void;
}) {
  const { t } = useTranslation();
  const [fonts, setFonts] = React.useState<FontFamily[]>([]);
  React.useEffect(() => {
    loadFonts().then(setFonts);
  }, []);
  const set = (key: string, v: number | string | undefined) => {
    const next = { ...value };
    if (v === undefined || v === "") delete next[key];
    else next[key] = v;
    onChange(next);
  };
  const reset = (key: string) => (value[key] !== undefined ? () => set(key, undefined) : undefined);
  const font = (value.Font as string | undefined) ?? look.font;
  const faces = fonts.find((f) => f.family === font)?.faces ?? [];
  const fromStyle = t("trackStyles.fromStyle");

  const fields = ANIMATION_FIELDS[animation];
  const groups = [...new Set(fields.map((f) => f.group))];

  return (
    <div className="divide-y rounded-lg border text-xs">
      <Section title={t("trackStyles.animationSettings", { name: animation })}>
        <p className="pb-1 text-[11px] text-muted-foreground">{t("trackStyles.animationSettingsHint")}</p>
        {groups.map((group) => (
          <div key={group} className="space-y-1.5 pt-2">
            <div className="pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
            {group === "Text" && (
              <>
                <InspectorRow label="Font" onReset={value.Font ? () => onChange(omit(value, ["Font", "Font Face"])) : undefined}>
                  <FontPicker fonts={fonts} value={value.Font ? font : `${look.font} (${fromStyle})`} onChange={(f) => set("Font", f)} />
                </InspectorRow>
                <InspectorRow label="Font Face" onReset={reset("Font Face")}>
                  <Select value={(value["Font Face"] as string) ?? ""} onValueChange={(v) => set("Font Face", v)}>
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder={`${look.fontFace} (${fromStyle})`} />
                    </SelectTrigger>
                    <SelectContent>
                      {faces.map((f) => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </InspectorRow>
                <InspectorRow label="Color" onReset={reset("Color")}>
                  <ColorField value={(value.Color as string) ?? look.color} onChange={(c) => set("Color", c)} />
                </InspectorRow>
                <InspectorRow label="Size" onReset={reset("Size")}>
                  <NumberBox value={value.Size} placeholder={fromStyle} onChange={(v) => set("Size", v)} />
                </InspectorRow>
              </>
            )}
            {fields.filter((f) => f.group === group).map((f) => (
              <FieldRow key={f.key} field={f} value={value[f.key]} onChange={(v) => set(f.key, v)} onReset={reset(f.key)} />
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}

function omit(v: Settings, keys: string[]) {
  const next = { ...v };
  for (const k of keys) delete next[k];
  return next;
}

function FieldRow({
  field,
  value,
  onChange,
  onReset,
}: {
  field: AnimationField;
  value: number | string | undefined;
  onChange: (v: number | string | undefined) => void;
  onReset?: () => void;
}) {
  if (field.type === "color") {
    return (
      <InspectorRow label={field.label} onReset={onReset}>
        <ColorField value={(value as string) ?? "#ffffff"} onChange={onChange} />
      </InspectorRow>
    );
  }
  if (field.type === "text") {
    return (
      <InspectorRow label={field.label} onReset={onReset}>
        <Input className="h-7" value={(value as string) ?? ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      </InspectorRow>
    );
  }
  const def = Number(field.placeholder ?? 0);
  const current = typeof value === "number" ? value : def;
  return (
    <InspectorRow label={field.label} onReset={onReset}>
      <div className="flex items-center gap-3">
        <Slider
          className="flex-1"
          value={[Math.min(field.max ?? 1, Math.max(field.min ?? 0, current))]}
          min={field.min ?? 0}
          max={field.max ?? 1}
          step={field.step ?? 0.01}
          onValueChange={([x]) => onChange(Math.round(x * 10000) / 10000)}
        />
        <NumberBox value={value} placeholder={field.placeholder} onChange={onChange} />
      </div>
    </InspectorRow>
  );
}

function NumberBox({ value, placeholder, onChange }: { value: number | string | undefined; placeholder?: string; onChange: (v: number | undefined) => void }) {
  const [text, setText] = React.useState(value === undefined ? "" : String(value));
  React.useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    if (text.trim() === "") return onChange(undefined);
    const n = Number(text.replace(",", "."));
    if (Number.isFinite(n)) onChange(n);
  };
  return (
    <Input
      className="h-7 w-20 text-right"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

/** Same grid as the Track inspector rows, plus Resolve's reset arrow. */
function InspectorRow({ label, onReset, children }: { label: string; onReset?: () => void; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr_18px] items-center gap-3">
      <span className="text-right text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
      <button
        type="button"
        className="text-muted-foreground disabled:opacity-25 enabled:hover:text-foreground"
        onClick={onReset}
        disabled={!onReset}
        aria-label="Reset"
      >
        <RotateCcw className="size-3.5" />
      </button>
    </div>
  );
}
