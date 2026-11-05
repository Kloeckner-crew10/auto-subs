import * as React from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColorField, FontPicker, loadFonts, type FontFamily } from "@/components/captions/track-inspector-editor";
import { ANIMATION_FIELDS, type AnimationField } from "@/lib/animation-fields";
import type { SubtitleAnimation, TrackStyle } from "@/types";

type Settings = Record<string, number | string>;

/**
 * Settings of the chosen Resolve animation. Every field is optional: empty
 * keeps the style's own value (font, colour, size) or Resolve's default.
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
  const font = (value.Font as string | undefined) ?? "";
  const faces = fonts.find((f) => f.family === (font || look.font))?.faces ?? [];

  return (
    <div className="space-y-1.5 rounded-lg border p-3 text-xs">
      <div className="pb-1 font-semibold">{t("trackStyles.animationSettings", { name: animation })}</div>
      <p className="pb-1 text-[11px] text-muted-foreground">{t("trackStyles.animationSettingsHint")}</p>

      <Row label="Font" onClear={font ? () => onChange(omit(value, ["Font", "Font Face"])) : undefined}>
        <FontPicker fonts={fonts} value={font || `${look.font} (${t("trackStyles.fromStyle")})`} onChange={(f) => set("Font", f)} />
      </Row>
      <Row label="Font Face" onClear={value["Font Face"] ? () => set("Font Face", undefined) : undefined}>
        <Select value={(value["Font Face"] as string) ?? ""} onValueChange={(v) => set("Font Face", v)}>
          <SelectTrigger className="h-8">
            <SelectValue placeholder={`${look.fontFace} (${t("trackStyles.fromStyle")})`} />
          </SelectTrigger>
          <SelectContent>
            {faces.map((f) => (
              <SelectItem key={f} value={f}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Color" onClear={value.Color ? () => set("Color", undefined) : undefined}>
        {value.Color ? (
          <ColorField value={value.Color as string} onChange={(c) => set("Color", c)} />
        ) : (
          <button type="button" className="h-7 w-full rounded-md border px-2 text-left text-muted-foreground" onClick={() => set("Color", look.color)}>
            {look.color} ({t("trackStyles.fromStyle")})
          </button>
        )}
      </Row>
      <Row label="Size" onClear={value.Size !== undefined ? () => set("Size", undefined) : undefined}>
        <NumberInput value={value.Size} placeholder={t("trackStyles.fromStyle")} step={0.005} onChange={(n) => set("Size", n)} />
      </Row>

      {ANIMATION_FIELDS[animation].map((f) => (
        <FieldRow key={f.key} field={f} value={value[f.key]} onChange={(v) => set(f.key, v)} />
      ))}
    </div>
  );
}

function omit(v: Settings, keys: string[]) {
  const next = { ...v };
  for (const k of keys) delete next[k];
  return next;
}

function FieldRow({ field, value, onChange }: { field: AnimationField; value: number | string | undefined; onChange: (v: number | string | undefined) => void }) {
  const clear = value !== undefined ? () => onChange(undefined) : undefined;
  return (
    <Row label={field.label} onClear={clear}>
      {field.type === "number" ? (
        <NumberInput value={value} placeholder={field.placeholder} step={field.step} onChange={onChange} />
      ) : field.type === "color" ? (
        value ? (
          <ColorField value={value as string} onChange={onChange} />
        ) : (
          <button type="button" className="h-7 w-full rounded-md border px-2 text-left text-muted-foreground" onClick={() => onChange("#ffffff")}>
            Resolve
          </button>
        )
      ) : (
        <Input className="h-7" value={(value as string) ?? ""} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </Row>
  );
}

function NumberInput({ value, placeholder, step, onChange }: { value: number | string | undefined; placeholder?: string; step?: number; onChange: (v: number | undefined) => void }) {
  const [text, setText] = React.useState(value === undefined ? "" : String(value));
  React.useEffect(() => setText(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    if (text.trim() === "") return onChange(undefined);
    const n = Number(text.replace(",", "."));
    if (Number.isFinite(n)) onChange(n);
  };
  return (
    <Input
      className="h-7 text-right"
      inputMode="decimal"
      step={step}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function Row({ label, onClear, children }: { label: string; onClear?: () => void; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr_20px] items-center gap-2">
      <span className="text-right text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
      {onClear ? (
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onClear} aria-label="Reset">
          <X className="size-3.5" />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
