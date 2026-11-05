/**
 * Safe-zone overlay, modelled on crew10's VisibleZone Resolve plugin:
 *
 *  - Safe Zone: platform colour at (default) 50 % outside the safe area.
 *  - Icons: a mock of the platform UI (top bar, action column, caption area).
 *  - Grid: rows × columns guide lines.
 *
 * 9:16 safe areas are measured from the plugin's SafeZone_*.png masks
 * (1080×1920): a rectangle whose lower right corner is cut away for the
 * action column (`notchY` / `rightBelow`). Feed and landscape formats have no
 * plugin mask and use guide margins (1:1 also keeps clear of the 3:4 crop
 * Instagram's profile grid applies).
 *
 * All coordinates are pixels in the template's reference frame
 * (`refW`×`refH`) and are scaled to the timeline resolution.
 */
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Bookmark,
  Camera,
  Ellipsis,
  EllipsisVertical,
  Forward,
  Heart,
  MessageCircle,
  MessageSquare,
  Music,
  Repeat,
  Search,
  Send,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

export type SafeZoneTemplateId =
  | "universal"
  | "reels"
  | "tiktok"
  | "shorts"
  | "feed11"
  | "feed45"
  | "feed34"
  | "youtube";

export type IconPlatform = "reels" | "tiktok" | "shorts";

export interface SafeZoneTemplate {
  id: SafeZoneTemplateId;
  label: string;
  aspect: number;
  aspectLabel: string;
  color: string;
  refW: number;
  refH: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  notchY?: number;
  rightBelow?: number;
}

export const SAFE_ZONE_TEMPLATES: SafeZoneTemplate[] = [
  { id: "universal", label: "Universal", aspect: 9 / 16, aspectLabel: "9:16", color: "#313036",
    refW: 1080, refH: 1920, top: 253, bottom: 1540, left: 120, right: 951, notchY: 719, rightBelow: 879 },
  { id: "reels", label: "Instagram Reels", aspect: 9 / 16, aspectLabel: "9:16", color: "#9a09f5",
    refW: 1080, refH: 1920, top: 250, bottom: 1594, left: 120, right: 960, notchY: 1131, rightBelow: 845 },
  { id: "tiktok", label: "TikTok", aspect: 9 / 16, aspectLabel: "9:16", color: "#00f2ea",
    refW: 1080, refH: 1920, top: 159, bottom: 1440, left: 120, right: 960, notchY: 839, rightBelow: 781 },
  { id: "shorts", label: "YouTube Shorts", aspect: 9 / 16, aspectLabel: "9:16", color: "#f40407",
    refW: 1080, refH: 1920, top: 240, bottom: 1540, left: 60, right: 961, notchY: 719, rightBelow: 879 },
  // Instagram feed: 1:1 posts are cropped to 3:4 in the profile grid (810 px
  // wide), so the safe area also keeps clear of the cropped sides.
  { id: "feed11", label: "Instagram Feed 1:1", aspect: 1, aspectLabel: "1:1", color: "#9a09f5",
    refW: 1080, refH: 1080, top: 54, bottom: 1026, left: 165, right: 915 },
  { id: "feed45", label: "Instagram Feed 4:5", aspect: 4 / 5, aspectLabel: "4:5", color: "#9a09f5",
    refW: 1080, refH: 1350, top: 68, bottom: 1282, left: 64, right: 1016 },
  { id: "feed34", label: "Instagram Feed 3:4", aspect: 3 / 4, aspectLabel: "3:4", color: "#9a09f5",
    refW: 1080, refH: 1440, top: 72, bottom: 1368, left: 54, right: 1026 },
  { id: "youtube", label: "YouTube 16:9", aspect: 16 / 9, aspectLabel: "16:9", color: "#f40407",
    refW: 1920, refH: 1080, top: 54, bottom: 972, left: 96, right: 1824 },
];

export const ICON_PLATFORMS: { id: IconPlatform; label: string }[] = [
  { id: "reels", label: "Instagram Reels" },
  { id: "tiktok", label: "TikTok" },
  { id: "shorts", label: "YouTube Shorts" },
];

/** Same controls as the VisibleZone plugin. */
export interface SafeZoneSettings {
  safeZoneEnabled: boolean;
  template: SafeZoneTemplateId;
  safeZoneOpacity: number;
  iconsEnabled: boolean;
  iconPlatform: IconPlatform;
  iconsOpacity: number;
  gridEnabled: boolean;
  gridRows: number;
  gridColumns: number;
}

export const DEFAULT_SAFE_ZONE_SETTINGS: SafeZoneSettings = {
  safeZoneEnabled: true,
  template: "universal",
  safeZoneOpacity: 0.5,
  iconsEnabled: true,
  iconPlatform: "reels",
  iconsOpacity: 1,
  gridEnabled: false,
  gridRows: 3,
  gridColumns: 3,
};

export function getTemplate(id: string | null | undefined): SafeZoneTemplate {
  return SAFE_ZONE_TEMPLATES.find((z) => z.id === id) ?? SAFE_ZONE_TEMPLATES[0];
}

export function aspectMatches(aspect: number, width: number, height: number): boolean {
  return Math.abs(width / height - aspect) / aspect < 0.03;
}

/** Template that fits the timeline best (first one with the same aspect). */
export function templateForResolution(width: number, height: number): SafeZoneTemplate | undefined {
  return SAFE_ZONE_TEMPLATES.find((z) => aspectMatches(z.aspect, width, height));
}

function scaled(zone: SafeZoneTemplate, width: number, height: number) {
  const sx = width / zone.refW;
  const sy = height / zone.refH;
  return {
    top: Math.round(zone.top * sy),
    bottom: Math.round(zone.bottom * sy),
    left: Math.round(zone.left * sx),
    right: Math.round(zone.right * sx),
    notchY: zone.notchY !== undefined ? Math.round(zone.notchY * sy) : undefined,
    rightBelow: zone.rightBelow !== undefined ? Math.round(zone.rightBelow * sx) : undefined,
  };
}

/** Subtitle position: bottom edge on the safe lower edge, width left of the action column. */
export function recommendedCaptionPosition(zone: SafeZoneTemplate, width: number, height: number) {
  const s = scaled(zone, width, height);
  const right = s.rightBelow ?? s.right;
  return {
    fromTop: s.bottom,
    fromBottom: height - s.bottom,
    maxWidth: right - s.left,
    centerX: Math.round((s.left + right) / 2),
  };
}

// ── Drawing ───────────────────────────────────────────────────────────────

const iconCache = new Map<string, Promise<HTMLImageElement>>();

/** Lucide icon as an image, for drawing onto the canvas. */
function iconImage(Icon: ComponentType<Record<string, unknown>>, key: string, color: string, filled = false) {
  const id = `${key}|${color}|${filled}`;
  let img = iconCache.get(id);
  if (!img) {
    const svg = renderToStaticMarkup(
      createElement(Icon, {
        color,
        fill: filled ? color : "none",
        strokeWidth: 2,
        width: 96,
        height: 96,
        xmlns: "http://www.w3.org/2000/svg",
      }),
    );
    img = new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    iconCache.set(id, img);
  }
  return img;
}

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Mock of the platform UI in the 1080×1920 reference frame (scaled by the
 * caller), positioned like the plugin's icon overlays.
 */
async function drawIcons(ctx: Ctx, platform: IconPlatform) {
  const white = "#ffffff";
  const light = "#d9d9d9";
  const text = (t: string, x: number, y: number, size: number, weight = 600, align: CanvasTextAlign = "left") => {
    ctx.font = `${weight} ${size}px -apple-system, Helvetica, Arial, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillStyle = white;
    ctx.fillText(t, x, y);
  };
  const icon = async (I: ComponentType<Record<string, unknown>>, key: string, cx: number, cy: number, size: number, filled = false) => {
    const img = await iconImage(I, key, white, filled);
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  };
  const column = async (items: [ComponentType<Record<string, unknown>>, string, string][], x: number, y0: number, step: number) => {
    for (const [I, key, label] of items) {
      await icon(I, key, x, y0, 64);
      if (label) text(label, x, y0 + 62, 30, 600, "center");
      y0 += step;
    }
  };
  const bar = (x: number, y: number, w: number, h = 36) => {
    ctx.fillStyle = light;
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
  };
  const avatar = (cx: number, cy: number, r: number) => {
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };

  if (platform === "reels") {
    text("Reels", 108, 177, 52, 700);
    ctx.strokeStyle = white;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(262, 168); ctx.lineTo(276, 182); ctx.lineTo(290, 168);
    ctx.stroke();
    await icon(Camera, "camera", 958, 177, 64);
    await column(
      [[Heart, "heart", "950K"], [MessageCircle, "comment", "1,000"], [Send, "send", "150K"]],
      950, 1243, 170,
    );
    await icon(Ellipsis, "more", 950, 1748, 56);
    avatar(135, 1666, 47);
    text("channelname", 205, 1666, 32, 400);
    ctx.strokeStyle = white;
    ctx.lineWidth = 5;
    roundRect(ctx, 427, 1641, 144, 59, 8);
    ctx.stroke();
    bar(87, 1747, 767);
    await icon(Music, "music", 125, 1846, 40);
    bar(156, 1828, 545);
    ctx.fillStyle = light;
    roundRect(ctx, 906, 1793, 94, 94, 8);
    ctx.fill();
  } else if (platform === "tiktok") {
    ctx.strokeStyle = white;
    ctx.lineWidth = 5;
    roundRect(ctx, 80, 130, 70, 50, 8);
    ctx.stroke();
    text("LIVE", 115, 156, 22, 800, "center");
    text("Following", 410, 155, 40, 700, "center");
    text("For You", 648, 155, 40, 700, "center");
    await icon(Search, "search", 960, 155, 60);
    avatar(960, 960, 56);
    ctx.fillStyle = "#e5304b";
    ctx.beginPath();
    ctx.arc(960, 1018, 24, 0, Math.PI * 2);
    ctx.fill();
    text("+", 960, 1016, 36, 700, "center");
    await column(
      [[Heart, "heart", "950K"], [MessageCircle, "comment", "950K"], [Bookmark, "bookmark", "1,000"], [Forward, "share", "150K"]],
      960, 1110, 175,
    );
    avatar(960, 1830, 50);
    bar(110, 1570, 470, 60);
    text("Name of the Person", 110, 1680, 32, 700);
    text("This is two lines of description.", 110, 1730, 30, 400);
    text("This is line two of the description. #awesome", 110, 1778, 30, 400);
    await icon(Music, "music", 120, 1850, 40);
    bar(170, 1832, 460);
    await icon(Search, "search-s", 118, 1890, 34);
    text("Search · …", 150, 1890, 26, 600);
  } else {
    await icon(Search, "search", 735, 175, 60);
    await icon(Camera, "camera", 860, 175, 60);
    await icon(EllipsisVertical, "dots", 975, 175, 60);
    await column(
      [[ThumbsUp, "up", "1,000"], [ThumbsDown, "down", "Dislike"], [MessageSquare, "comments", "Comments"],
       [Forward, "share", "Share"], [Repeat, "remix", "Remix"]],
      960, 1035, 175,
    );
    avatar(130, 1660, 47);
    text("@channelname", 205, 1660, 32, 400);
    ctx.fillStyle = "#e5302a";
    roundRect(ctx, 455, 1633, 220, 55, 4);
    ctx.fill();
    bar(80, 1730, 650);
    bar(80, 1775, 650);
    bar(80, 1820, 650);
    await icon(Music, "music", 105, 1885, 42);
    text("Original Sound", 145, 1885, 34, 600);
    ctx.fillStyle = light;
    roundRect(ctx, 906, 1813, 94, 94, 8);
    ctx.fill();
  }
}

/** Draw the full overlay (safe zone, icons, grid) at the given resolution. */
export async function drawSafeZoneCanvas(settings: SafeZoneSettings, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const zone = getTemplate(settings.template);
  const s = scaled(zone, width, height);

  if (settings.safeZoneEnabled) {
    const safe = new Path2D();
    safe.moveTo(s.left, s.top);
    safe.lineTo(s.right, s.top);
    if (s.notchY !== undefined && s.rightBelow !== undefined) {
      safe.lineTo(s.right, s.notchY);
      safe.lineTo(s.rightBelow, s.notchY);
      safe.lineTo(s.rightBelow, s.bottom);
    } else {
      safe.lineTo(s.right, s.bottom);
    }
    safe.lineTo(s.left, s.bottom);
    safe.closePath();

    const layer = document.createElement("canvas");
    layer.width = width;
    layer.height = height;
    const l = layer.getContext("2d")!;
    l.fillStyle = zone.color;
    l.fillRect(0, 0, width, height);
    l.globalCompositeOperation = "destination-out";
    l.fill(safe);
    ctx.globalAlpha = Math.min(1, Math.max(0, settings.safeZoneOpacity));
    ctx.drawImage(layer, 0, 0);
    ctx.globalAlpha = 1;
  }

  // The platform UI mock only exists for vertical video.
  if (settings.iconsEnabled && aspectMatches(9 / 16, width, height)) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, settings.iconsOpacity));
    ctx.scale(width / 1080, height / 1920);
    await drawIcons(ctx, settings.iconPlatform);
    ctx.restore();
  }

  if (settings.gridEnabled) {
    const rows = Math.max(1, Math.round(settings.gridRows));
    const cols = Math.max(1, Math.round(settings.gridColumns));
    ctx.strokeStyle = "#ffff00";
    ctx.lineWidth = Math.max(1, Math.round(Math.min(width, height) / 540));
    ctx.beginPath();
    for (let r = 1; r < rows; r++) {
      const y = Math.round((height * r) / rows) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    for (let c = 1; c < cols; c++) {
      const x = Math.round((width * c) / cols) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.stroke();
  }
  return canvas;
}

export async function drawSafeZonePng(settings: SafeZoneSettings, width: number, height: number): Promise<Uint8Array> {
  const canvas = await drawSafeZoneCanvas(settings, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not render the safe-zone image");
  return new Uint8Array(await blob.arrayBuffer());
}
