/**
 * Platform safe zones: the share of the frame each platform's UI (captions,
 * buttons, profile row) may cover. Values are fractions of the frame and are
 * guide values from the platforms' creative guidelines, rounded towards the
 * safe side; the overlay shows them so the editor can judge by eye.
 */
export type SafeZonePlatform =
  | "reels"
  | "tiktok"
  | "shorts"
  | "youtube"
  | "square"
  | "portrait";

export interface SafeZone {
  id: SafeZonePlatform;
  label: string;
  /** Intended aspect ratio, width / height. */
  aspect: number;
  aspectLabel: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const SAFE_ZONES: SafeZone[] = [
  { id: "reels", label: "Instagram Reels / Story", aspect: 9 / 16, aspectLabel: "9:16", top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 },
  { id: "tiktok", label: "TikTok", aspect: 9 / 16, aspectLabel: "9:16", top: 0.08, bottom: 0.25, left: 0.06, right: 0.13 },
  { id: "shorts", label: "YouTube Shorts", aspect: 9 / 16, aspectLabel: "9:16", top: 0.08, bottom: 0.22, left: 0.06, right: 0.16 },
  { id: "youtube", label: "YouTube 16:9", aspect: 16 / 9, aspectLabel: "16:9", top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 },
  { id: "square", label: "Instagram Feed 1:1", aspect: 1, aspectLabel: "1:1", top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
  { id: "portrait", label: "Instagram Feed 4:5", aspect: 4 / 5, aspectLabel: "4:5", top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
];

export function getSafeZone(id: string | null | undefined): SafeZone | undefined {
  return SAFE_ZONES.find((z) => z.id === id);
}

/** True when the timeline is roughly the platform's aspect ratio. */
export function aspectMatches(zone: SafeZone, width: number, height: number): boolean {
  return Math.abs(width / height - zone.aspect) / zone.aspect < 0.03;
}

/**
 * Where subtitles should sit: their bottom edge just above the bottom safe
 * margin. Returned in pixels, measured both from the top and from the bottom
 * of the frame, because Resolve's position fields depend on the anchor.
 */
export function recommendedCaptionPosition(zone: SafeZone, width: number, height: number) {
  const fromBottom = Math.round(height * (zone.bottom + 0.02));
  return {
    fromBottom,
    fromTop: height - fromBottom,
    // Resolve's subtitle track measures X/Y in pixels with the origin at the
    // bottom-left; the horizontal centre stays the frame centre.
    x: Math.round(width / 2),
  };
}

/** Draw the guide PNG at the timeline's resolution. */
export async function drawSafeZonePng(zone: SafeZone, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  const top = Math.round(height * zone.top);
  const bottom = Math.round(height * zone.bottom);
  const left = Math.round(width * zone.left);
  const right = Math.round(width * zone.right);
  const unit = Math.max(2, Math.round(Math.min(width, height) / 270));

  // Covered areas: tinted red.
  ctx.fillStyle = "rgba(200, 16, 46, 0.30)";
  ctx.fillRect(0, 0, width, top);
  ctx.fillRect(0, height - bottom, width, bottom);
  ctx.fillRect(0, top, left, height - top - bottom);
  ctx.fillRect(width - right, top, right, height - top - bottom);

  // Safe area outline.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = unit;
  ctx.setLineDash([unit * 6, unit * 4]);
  ctx.strokeRect(left, top, width - left - right, height - top - bottom);

  // Recommended subtitle baseline.
  const pos = recommendedCaptionPosition(zone, width, height);
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255, 214, 0, 0.95)";
  ctx.beginPath();
  ctx.moveTo(left, pos.fromTop);
  ctx.lineTo(width - right, pos.fromTop);
  ctx.stroke();

  // Labels.
  const font = Math.round(Math.min(width, height) / 28);
  ctx.font = `600 ${font}px -apple-system, Helvetica, Arial, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fillText(`Safe Zone · ${zone.label}`, left + unit * 4, top + unit * 4);
  ctx.fillStyle = "rgba(255, 214, 0, 0.95)";
  ctx.textBaseline = "bottom";
  ctx.fillText("Untertitel bis hier", left + unit * 4, pos.fromTop - unit * 2);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not render the safe-zone image");
  return new Uint8Array(await blob.arrayBuffer());
}
