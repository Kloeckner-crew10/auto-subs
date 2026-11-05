import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Check,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fullTrackStyle } from "@/lib/track-style";
import type { FontCase, TrackStyle } from "@/types";

export interface FontFamily {
  family: string;
  faces: string[];
}

let fontCache: Promise<FontFamily[]> | null = null;
export function loadFonts(): Promise<FontFamily[]> {
  fontCache ??= invoke<FontFamily[]>("list_system_fonts").catch(() => []);
  return fontCache;
}

const FONT_CASES: FontCase[] = ["Mixed", "All Caps", "All Lowercase", "Small Caps", "Title Caps"];

/**
 * Editor for a subtitle-track look, laid out like Resolve's Inspector > Track
 * (same sections, order and field names) so values can be read 1:1.
 */
export function TrackInspectorEditor({
  look,
  onChange,
}: {
  look: TrackStyle;
  onChange: (patch: Partial<TrackStyle>) => void;
}) {
  const { t } = useTranslation();
  const v = fullTrackStyle(look);
  const [fonts, setFonts] = React.useState<FontFamily[]>([]);
  React.useEffect(() => {
    loadFonts().then(setFonts);
  }, []);
  const faces = fonts.find((f) => f.family === v.font)?.faces ?? [];

  return (
    <div className="divide-y rounded-lg border text-xs">
      <Section title="Character">
        <Row label="Font">
          <FontPicker fonts={fonts} value={v.font} onChange={(font) => {
            const fam = fonts.find((f) => f.family === font);
            const face = fam && !fam.faces.includes(v.fontFace) ? (fam.faces.find((x) => /regular|medium|book/i.test(x)) ?? fam.faces[0]) : v.fontFace;
            onChange({ font, fontFace: face });
          }} />
        </Row>
        <Row label="Font Face">
          {faces.length ? (
            <Select value={v.fontFace} onValueChange={(fontFace) => onChange({ fontFace })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {faces.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input className="h-8" value={v.fontFace} onChange={(e) => onChange({ fontFace: e.target.value })} />
          )}
        </Row>
        <Row label="Color"><ColorField value={v.color} onChange={(color) => onChange({ color })} /></Row>
        <Row label="Size"><SliderField value={v.size} min={1} max={200} onChange={(size) => onChange({ size })} /></Row>
        <Row label="Line Spacing"><SliderField value={v.lineSpacing} min={-100} max={100} onChange={(lineSpacing) => onChange({ lineSpacing })} /></Row>
        <Row label="Kerning"><SliderField value={v.kerning} min={-100} max={100} onChange={(kerning) => onChange({ kerning })} /></Row>
        <Row label="Font Case">
          <Select value={v.fontCase} onValueChange={(fontCase) => onChange({ fontCase: fontCase as FontCase })}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FONT_CASES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Alignment">
          <IconToggle
            value={v.alignment}
            onChange={(alignment) => onChange({ alignment: alignment as TrackStyle["alignment"] })}
            items={[["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight], ["justify", AlignJustify]]}
          />
        </Row>
      </Section>

      <Section title="Stroke">
        <Row label="Color"><ColorField value={v.strokeColor} onChange={(strokeColor) => onChange({ strokeColor })} /></Row>
        <Row label="Size"><SliderField value={v.strokeSize} min={0} max={20} onChange={(strokeSize) => onChange({ strokeSize })} /></Row>
        <Row label="">
          <label className="flex items-center gap-2">
            <Checkbox checked={v.strokeOutsideOnly} onCheckedChange={(c) => onChange({ strokeOutsideOnly: c === true })} />
            Outside Only
          </label>
        </Row>
      </Section>

      <Section title="Transform">
        <Row label="Position"><XYField x={v.positionX} y={v.positionY} onChange={(positionX, positionY) => onChange({ positionX, positionY })} /></Row>
        <Row label="Zoom"><XYField x={v.zoomX} y={v.zoomY} step={0.01} onChange={(zoomX, zoomY) => onChange({ zoomX, zoomY })} /></Row>
        <Row label="Opacity"><SliderField value={v.opacity} min={0} max={100} onChange={(opacity) => onChange({ opacity })} /></Row>
        <Row label="Anchor">
          <div className="flex gap-2">
            <IconToggle
              value={v.anchorV}
              onChange={(anchorV) => onChange({ anchorV: anchorV as TrackStyle["anchorV"] })}
              items={[["top", AlignVerticalJustifyStart], ["middle", AlignVerticalJustifyCenter], ["bottom", AlignVerticalJustifyEnd]]}
            />
            <IconToggle
              value={v.anchorH}
              onChange={(anchorH) => onChange({ anchorH: anchorH as TrackStyle["anchorH"] })}
              items={[["left", AlignHorizontalJustifyStart], ["center", AlignHorizontalJustifyCenter], ["right", AlignHorizontalJustifyEnd]]}
            />
          </div>
        </Row>
      </Section>

      <Section title="Drop Shadow" enabled={v.shadow} onToggle={(shadow) => onChange({ shadow })}>
        <Row label="Color"><ColorField value={v.shadowColor} onChange={(shadowColor) => onChange({ shadowColor })} /></Row>
        <Row label="Offset"><XYField x={v.shadowOffsetX} y={v.shadowOffsetY} onChange={(shadowOffsetX, shadowOffsetY) => onChange({ shadowOffsetX, shadowOffsetY })} /></Row>
        <Row label="Blur"><SliderField value={v.shadowBlur} min={0} max={100} onChange={(shadowBlur) => onChange({ shadowBlur })} /></Row>
        <Row label="Opacity"><SliderField value={v.shadowOpacity} min={0} max={100} onChange={(shadowOpacity) => onChange({ shadowOpacity })} /></Row>
      </Section>

      <Section title="Background" enabled={v.background} onToggle={(background) => onChange({ background })}>
        <Row label="Color"><ColorField value={v.backgroundColor} onChange={(backgroundColor) => onChange({ backgroundColor })} /></Row>
        <Row label="Outline Color"><ColorField value={v.backgroundOutlineColor} onChange={(backgroundOutlineColor) => onChange({ backgroundOutlineColor })} /></Row>
        <Row label="Outline Width"><SliderField value={v.backgroundOutlineWidth} min={0} max={20} onChange={(backgroundOutlineWidth) => onChange({ backgroundOutlineWidth })} /></Row>
        <Row label="Corner Radius"><SliderField value={v.backgroundCornerRadius} min={0} max={0.5} step={0.001} onChange={(backgroundCornerRadius) => onChange({ backgroundCornerRadius })} /></Row>
        <Row label="Opacity"><SliderField value={v.backgroundOpacity} min={0} max={100} onChange={(backgroundOpacity) => onChange({ backgroundOpacity })} /></Row>
        <Row label="">
          <label className="flex items-center gap-2">
            <Checkbox checked={v.backgroundOverrideSizing} onCheckedChange={(c) => onChange({ backgroundOverrideSizing: c === true })} />
            Override Sizing
          </label>
        </Row>
      </Section>

      <Section title="Subtitle Settings" enabled={v.subtitleSettings} onToggle={(subtitleSettings) => onChange({ subtitleSettings })}>
        <Row label="">
          <label className="flex items-center gap-2">
            <Checkbox checked={v.useProjectSettings} onCheckedChange={(c) => onChange({ useProjectSettings: c === true })} />
            Use Project Settings
          </label>
        </Row>
        <div className={cn(v.useProjectSettings && "pointer-events-none opacity-50")}>
          <Row label="Max Line Length"><SliderField value={v.maxLineLength} min={1} max={200} onChange={(maxLineLength) => onChange({ maxLineLength })} /></Row>
          <Row label="Min Duration"><SliderField value={v.minDuration} min={0} max={20} step={0.1} onChange={(minDuration) => onChange({ minDuration })} /></Row>
          <Row label="Max CPS"><SliderField value={v.maxCps} min={1} max={100} onChange={(maxCps) => onChange({ maxCps })} /></Row>
        </div>
      </Section>
      <p className="px-3 py-2 text-[11px] text-muted-foreground">{t("trackStyles.inspectorHint")}</p>
    </div>
  );
}

export function Section({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 py-1">
        {onToggle && <Switch checked={!!enabled} onCheckedChange={onToggle} className="scale-75" />}
        <button type="button" className="flex flex-1 items-center gap-1 text-left font-semibold" onClick={() => setOpen(!open)}>
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
          {title}
        </button>
      </div>
      {open && <div className={cn("space-y-1.5 pb-1 pt-1", onToggle && !enabled && "pointer-events-none opacity-50")}>{children}</div>}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-3">
      <span className="text-right text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function num(s: string, fallback: number) {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export function SliderField({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  return (
    <div className="flex items-center gap-3">
      <Slider className="flex-1" value={[Math.min(max, Math.max(min, value))]} min={min} max={max} step={step} onValueChange={([x]) => onChange(x)} />
      <Input
        className="h-7 w-20 text-right"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(num(text, value))}
        onKeyDown={(e) => e.key === "Enter" && onChange(num(text, value))}
      />
    </div>
  );
}

function XYField({ x, y, step = 1, onChange }: { x: number; y: number; step?: number; onChange: (x: number, y: number) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["X", "Y"] as const).map((axis) => (
        <label key={axis} className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{axis}</span>
          <Input
            className="h-7 text-right"
            type="number"
            step={step}
            value={axis === "X" ? x : y}
            onChange={(e) => (axis === "X" ? onChange(num(e.target.value, x), y) : onChange(x, num(e.target.value, y)))}
          />
        </label>
      ))}
    </div>
  );
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-10 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
      />
      <Input className="h-7 font-mono" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function IconToggle({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (v: string) => void;
  items: [string, React.ComponentType<{ className?: string }>][];
}) {
  return (
    <ToggleGroup type="single" value={value} onValueChange={(x) => x && onChange(x)} className="justify-start">
      {items.map(([key, Icon]) => (
        <ToggleGroupItem key={key} value={key} size="sm" className="size-7 p-0" aria-label={key}>
          <Icon className="size-3.5" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function FontPicker({ fonts, value, onChange }: { fonts: FontFamily[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-8 w-full items-center justify-between rounded-md border bg-transparent px-3 text-left">
          <span className="truncate">{value}</span>
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder={t("trackStyles.searchFont")} />
          <CommandList className="max-h-72">
            <CommandEmpty>{t("trackStyles.noFont")}</CommandEmpty>
            {fonts.map((f) => (
              <CommandItem key={f.family} value={f.family} onSelect={() => { onChange(f.family); setOpen(false); }}>
                <Check className={cn("size-3.5", f.family === value ? "opacity-100" : "opacity-0")} />
                <span style={{ fontFamily: `"${f.family}"` }}>{f.family}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
