import type { SubtitleAnimation } from "@/types";

/**
 * Fields of Resolve's subtitle animations (Inspector > Track once the
 * animation is on the subtitle track), read from Resolve 21. Keys are the
 * Resolve labels; "#1" = second label of that name, "@1" = second control.
 */
export interface AnimationField {
  key: string;
  label: string;
  type: "number" | "color" | "text";
  /** Resolve's default. */
  placeholder?: string;
  step?: number;
  min?: number;
  max?: number;
  /** Heading the field sits under in Resolve. */
  group: string;
}

const n = (key: string, label: string, group: string, def: string, min: number, max: number, step = 0.01): AnimationField =>
  ({ key, label, group, type: "number", placeholder: def, min, max, step });

const text: AnimationField[] = [
  n("Tracking", "Tracking", "Text", "1.0", 0, 3),
  n("Line Spacing", "Line Spacing", "Text", "1.0", 0, 3),
];
const wordSpacing = n("Word Spacing", "Word Spacing", "Text", "1.0", 0, 3);
const anchors: AnimationField[] = [
  n("V Anchor", "V Anchor", "Layout", "0.0", -1, 1),
  n("H Anchor", "H Anchor", "Layout", "0.0", -1, 1),
];

export const ANIMATION_FIELDS: Record<Exclude<SubtitleAnimation, "none">, AnimationField[]> = {
  "Word Highlight": [
    ...text,
    wordSpacing,
    { key: "Highlight Color", label: "Color", type: "color", group: "Highlight", placeholder: "#FFE64A" },
    n("Softness", "Softness", "Highlight", "0.0", 0, 1),
    n("Glow", "Glow", "Highlight", "0.0", 0, 1),
    n("Blend", "Blend", "Highlight", "1.0", 0, 1),
    { key: "Outline Color", label: "Color", type: "color", group: "Outline" },
    n("Thickness", "Thickness", "Outline", "0.02", 0, 0.2, 0.005),
    { key: "Background Color", label: "Color", type: "color", group: "Background" },
    n("Offset X", "Offset X", "Background", "0.0", -1, 1),
    n("Offset Y", "Offset Y", "Background", "0.0", -1, 1),
    n("Width", "Width", "Background", "0.0", 0, 1),
    n("Height", "Height", "Background", "0.0", 0, 1),
    n("Round", "Round", "Background", "0.1", 0, 1),
    n("Softness#1", "Softness", "Background", "0.0", 0, 1),
    n("Glow#1", "Glow", "Background", "0.0", 0, 1),
    n("Blend#1", "Blend", "Background", "1.0", 0, 1),
  ],
  Lollipop: [
    ...text,
    wordSpacing,
    { key: "Outline 1 Color", label: "Color", type: "color", group: "Outline" },
    n("Thickness", "Thickness", "Outline", "0.0", 0, 0.2, 0.005),
  ],
  Rotate: [...text, ...anchors],
  "Slide In": [
    ...text,
    ...anchors,
    { key: "Order", label: "Order", type: "text", placeholder: "Random But One by One", group: "Animation" },
    { key: "Delay type", label: "Delay Type", type: "text", placeholder: "Between Each Character", group: "Animation" },
    n("Delay", "Delay", "Animation", "2.0", 0, 10, 0.1),
  ],
  Statement: [
    ...text,
    n("V Anchor", "V Anchor", "Layout", "0.0", -1, 1),
    n("V Justify", "V Justify", "Layout", "0.0", -1, 1),
    n("H Anchor", "H Anchor", "Layout", "0.0", -1, 1),
    n("H Justify", "H Justify", "Layout", "0.0", -1, 1),
    { key: "Direction", label: "Direction", type: "text", placeholder: "Automatic", group: "Layout" },
    { key: "Line Direction", label: "Line Direction", type: "text", placeholder: "Automatic", group: "Layout" },
    n("Write On@0", "Write On Start", "Animation", "0.0", 0, 1),
    n("Write On@1", "Write On End", "Animation", "1.0", 0, 1),
  ],
};
