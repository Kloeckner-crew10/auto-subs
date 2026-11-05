import * as React from "react";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addSafeZoneOverlay,
  getTimelineResolution,
  removeSafeZoneOverlay,
} from "@/api/resolve-api";
import {
  DEFAULT_SAFE_ZONE_SETTINGS,
  ICON_PLATFORMS,
  SAFE_ZONE_TEMPLATES,
  aspectMatches,
  drawSafeZoneCanvas,
  drawSafeZonePng,
  getTemplate,
  recommendedCaptionPosition,
  templateForResolution,
  type SafeZoneSettings,
} from "@/lib/safe-zones";
import { writeSafeZonePng } from "@/utils/file-utils";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";

/**
 * Safe-zone overlay for the send panel, with the same controls as crew10's
 * VisibleZone plugin (Safe Zone / Icons / Grid), a live preview, and buttons
 * that lay the overlay on the Resolve timeline or remove it again.
 */
export function SafeZoneSection() {
  const { t } = useTranslation();
  const stored = useSettingsStore((s) => s.safeZone);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const settings: SafeZoneSettings = { ...DEFAULT_SAFE_ZONE_SETTINGS, ...stored };
  const set = (patch: Partial<SafeZoneSettings>) => updateSetting("safeZone", { ...settings, ...patch });

  const [resolution, setResolution] = React.useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getTimelineResolution()
      .then((r) => {
        if (!cancelled && r?.width && r?.height) setResolution({ width: r.width, height: r.height });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const template = getTemplate(settings.template);
  // Preview frame: the timeline when known, else the template's own format.
  const frame = resolution ?? { width: template.refW, height: template.refH };
  const vertical = aspectMatches(9 / 16, frame.width, frame.height);

  React.useEffect(() => {
    let cancelled = false;
    const scale = 270 / frame.height;
    drawSafeZoneCanvas(settings, Math.round(frame.width * scale), 270)
      .then((canvas) => {
        if (!cancelled) setPreview(canvas.toDataURL("image/png"));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(settings), frame.width, frame.height]);

  const showOverlay = async () => {
    setBusy(true);
    try {
      const res = resolution ?? (await getTimelineResolution());
      const png = await drawSafeZonePng(settings, res.width, res.height);
      const path = await writeSafeZonePng(
        `safezone-${settings.template}-${settings.iconPlatform}-${res.width}x${res.height}.png`,
        png,
      );
      const result = await addSafeZoneOverlay(path);
      toast.success(t("safeZone.added"), {
        description: result.covered === false ? t("safeZone.partial") : t("safeZone.removeHint"),
        closeButton: true,
      });
    } catch (err) {
      toast.error(t("safeZone.failed"), { description: String((err as Error)?.message ?? err), closeButton: true });
    } finally {
      setBusy(false);
    }
  };

  const hideOverlay = async () => {
    setBusy(true);
    try {
      await removeSafeZoneOverlay();
      toast.success(t("safeZone.removed"), { closeButton: true });
    } catch (err) {
      toast.error(t("safeZone.failed"), { description: String((err as Error)?.message ?? err), closeButton: true });
    } finally {
      setBusy(false);
    }
  };

  const pos = resolution ? recommendedCaptionPosition(template, resolution.width, resolution.height) : null;
  const mismatch = resolution && !aspectMatches(template.aspect, resolution.width, resolution.height);
  const suggested = resolution ? templateForResolution(resolution.width, resolution.height) : undefined;

  return (
    <section className="space-y-2">
      <Label className="pl-1 text-xs text-muted-foreground">{t("safeZone.label")}</Label>

      <div className="flex gap-3 rounded-md border bg-muted/30 p-2.5">
        {preview && (
          <img
            src={preview}
            alt=""
            className="h-[135px] w-auto shrink-0 rounded-sm bg-neutral-900 object-contain"
          />
        )}
        <div className="min-w-0 flex-1 space-y-1.5 text-xs text-muted-foreground">
          {pos && resolution ? (
            <p>
              {t("safeZone.position", {
                y: pos.fromBottom,
                percent: Math.round((pos.fromBottom / resolution.height) * 100),
                width: resolution.width,
                height: resolution.height,
              })}{" "}
              {t("safeZone.maxWidth", { width: pos.maxWidth })}
            </p>
          ) : (
            <p>{t("safeZone.noResolution")}</p>
          )}
          {mismatch && (
            <p className="text-amber-600 dark:text-amber-500">
              {t("safeZone.mismatch", { aspect: template.aspectLabel })}
              {suggested && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={() => set({ template: suggested.id })}
                  >
                    {t("safeZone.useSuggested", { name: suggested.label })}
                  </button>
                </>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={showOverlay}>
              <Eye className="size-3.5" />
              {t("safeZone.show")}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={hideOverlay}>
              <EyeOff className="size-3.5" />
              {t("safeZone.hide")}
            </Button>
          </div>
        </div>
      </div>

      <div className="divide-y rounded-md border">
        <Group title={t("safeZone.groups.safeZone")} defaultOpen>
          <CheckRow
            label={t("safeZone.enableSafeZone")}
            checked={settings.safeZoneEnabled}
            onChange={(v) => set({ safeZoneEnabled: v })}
          />
          <Row label={t("safeZone.template")}>
            <Select value={settings.template} onValueChange={(v) => set({ template: v as SafeZoneSettings["template"] })}>
              <SelectTrigger className="h-8 bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SAFE_ZONE_TEMPLATES.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.label} ({z.aspectLabel})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <OpacityRow
            label={t("safeZone.opacity")}
            value={settings.safeZoneOpacity}
            onChange={(v) => set({ safeZoneOpacity: v })}
          />
        </Group>

        <Group title={t("safeZone.groups.icons")} defaultOpen>
          <CheckRow
            label={t("safeZone.enableIcons")}
            checked={settings.iconsEnabled}
            onChange={(v) => set({ iconsEnabled: v })}
          />
          <Row label={t("safeZone.platform")}>
            <Select
              value={settings.iconPlatform}
              onValueChange={(v) => set({ iconPlatform: v as SafeZoneSettings["iconPlatform"] })}
            >
              <SelectTrigger className="h-8 bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ICON_PLATFORMS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <OpacityRow
            label={t("safeZone.opacity")}
            value={settings.iconsOpacity}
            onChange={(v) => set({ iconsOpacity: v })}
          />
          {!vertical && <p className="pl-1 text-[11px] text-muted-foreground">{t("safeZone.iconsVerticalOnly")}</p>}
        </Group>

        <Group title={t("safeZone.groups.grid")}>
          <CheckRow
            label={t("safeZone.enableGrid")}
            checked={settings.gridEnabled}
            onChange={(v) => set({ gridEnabled: v })}
          />
          <NumberRow label={t("safeZone.rows")} value={settings.gridRows} onChange={(v) => set({ gridRows: v })} />
          <NumberRow label={t("safeZone.columns")} value={settings.gridColumns} onChange={(v) => set({ gridColumns: v })} />
        </Group>
      </div>
    </section>
  );
}

function Group({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(Boolean(defaultOpen));
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2.5 py-2 text-xs font-medium">
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-2.5 pb-2.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="text-right text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label="">
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
        {label}
      </label>
    </Row>
  );
}

function OpacityRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[value]}
          onValueChange={([v]) => onChange(v)}
          className="flex-1"
        />
        <span className="w-8 text-right tabular-nums">{value.toFixed(1)}</span>
      </div>
    </Row>
  );
}

function NumberRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Row label={label}>
      <Input
        type="number"
        min={1}
        max={12}
        value={value}
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n)) onChange(Math.min(12, Math.max(1, n)));
        }}
        className="h-8 w-20 text-xs"
      />
    </Row>
  );
}
