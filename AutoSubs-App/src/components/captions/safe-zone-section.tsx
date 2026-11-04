import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addSafeZoneOverlay,
  getTimelineResolution,
  removeSafeZoneOverlay,
} from "@/api/resolve-api";
import {
  SAFE_ZONES,
  aspectMatches,
  drawSafeZonePng,
  getSafeZone,
  recommendedCaptionPosition,
} from "@/lib/safe-zones";
import { writeSafeZonePng } from "@/utils/file-utils";
import { useSettingsStore } from "@/stores/settings-store";

const NONE = "__none__";

/**
 * Platform picker for the send panel: shows where the platform's UI covers
 * the frame, the subtitle position to use, and can lay a guide overlay on
 * the Resolve timeline.
 */
export function SafeZoneSection() {
  const { t } = useTranslation();
  const platform = useSettingsStore((s) => s.safeZonePlatform);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const zone = getSafeZone(platform);
  const [resolution, setResolution] = React.useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!zone) return;
    let cancelled = false;
    getTimelineResolution()
      .then((r) => {
        if (!cancelled && r?.width && r?.height) setResolution({ width: r.width, height: r.height });
      })
      .catch(() => {
        if (!cancelled) setResolution(null);
      });
    return () => {
      cancelled = true;
    };
  }, [zone]);

  const showOverlay = async () => {
    if (!zone) return;
    setBusy(true);
    try {
      const res = resolution ?? (await getTimelineResolution());
      const png = await drawSafeZonePng(zone, res.width, res.height);
      const path = await writeSafeZonePng(`safezone-${zone.id}-${res.width}x${res.height}.png`, png);
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

  const pos = zone && resolution ? recommendedCaptionPosition(zone, resolution.width, resolution.height) : null;
  const mismatch = zone && resolution && !aspectMatches(zone, resolution.width, resolution.height);

  return (
    <section className="space-y-1.5">
      <Label className="pl-1 text-xs text-muted-foreground">{t("safeZone.label")}</Label>
      <Select
        value={platform ?? NONE}
        onValueChange={(v) => updateSetting("safeZonePlatform", v === NONE ? null : v)}
      >
        <SelectTrigger className="bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("safeZone.none")}</SelectItem>
          <SelectSeparator />
          {SAFE_ZONES.map((z) => (
            <SelectItem key={z.id} value={z.id}>
              {z.label} ({z.aspectLabel})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {zone && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2.5 text-xs">
          {pos && resolution ? (
            <p className="text-muted-foreground">
              {t("safeZone.position", {
                y: pos.fromBottom,
                percent: Math.round((pos.fromBottom / resolution.height) * 100),
                width: resolution.width,
                height: resolution.height,
              })}
            </p>
          ) : (
            <p className="text-muted-foreground">{t("safeZone.noResolution")}</p>
          )}
          {mismatch && (
            <p className="text-amber-600 dark:text-amber-500">
              {t("safeZone.mismatch", { aspect: zone.aspectLabel })}
            </p>
          )}
          <div className="flex gap-2">
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
      )}
    </section>
  );
}
