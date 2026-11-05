import { Check } from "lucide-react";
import { CaptionPreset } from "@/types";
import { cn } from "@/lib/utils";
import { CAPTION_PREVIEW_DIR } from "@/lib/caption-previews";
import { PresetLivePreview } from "@/components/captions/preset-live-preview";

/**
 * Directory (under the app local data dir) holding one thumbnail per animated
 * preset. Previews are captured when a preset is saved and named after the
 * preset id, so deleting a preset can delete its image by convention.
 */
export { CAPTION_PREVIEW_DIR };

/**
 * Preview for an animated caption preset: always the animated sample line
 * (crew10). A captured Resolve still is often an empty frame and cannot show
 * the reveal or the highlight, so it is no longer displayed here.
 */
export function PresetThumbnail({
  preset,
  selected,
  className,
}: {
  preset: CaptionPreset;
  selected?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Captions are designed to overlay footage, so the preview sits on a
        // dark neutral in both themes.
        "relative flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded border bg-neutral-800",
        selected ? "border-primary" : "border-border",
        className,
      )}
    >
      <PresetLivePreview preset={preset} className="absolute inset-0" />

      {selected && (
        <span className="absolute bottom-2 right-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <Check className="size-2.5" />
        </span>
      )}
    </div>
  );
}
