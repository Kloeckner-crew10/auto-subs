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
  /** Resolve's default, shown as placeholder. */
  placeholder?: string;
  step?: number;
}

const common: AnimationField[] = [
  { key: "Tracking", label: "Tracking", type: "number", placeholder: "1.0", step: 0.01 },
  { key: "Line Spacing", label: "Line Spacing", type: "number", placeholder: "1.0", step: 0.01 },
];

const anchors: AnimationField[] = [
  { key: "V Anchor", label: "V Anchor", type: "number", placeholder: "0.0", step: 0.1 },
  { key: "H Anchor", label: "H Anchor", type: "number", placeholder: "0.0", step: 0.1 },
];

export const ANIMATION_FIELDS: Record<Exclude<SubtitleAnimation, "none">, AnimationField[]> = {
  "Word Highlight": [
    ...common,
    { key: "Word Spacing", label: "Word Spacing", type: "number", placeholder: "1.0", step: 0.01 },
    { key: "Softness", label: "Highlight Softness", type: "number", placeholder: "0.0", step: 0.01 },
    { key: "Glow", label: "Highlight Glow", type: "number", placeholder: "0.0", step: 0.01 },
    { key: "Blend", label: "Highlight Blend", type: "number", placeholder: "1.0", step: 0.01 },
    { key: "Outline Color", label: "Outline Color", type: "color" },
    { key: "Thickness", label: "Outline Thickness", type: "number", placeholder: "0.02", step: 0.005 },
    { key: "Background Color", label: "Background Color", type: "color" },
    { key: "Offset X", label: "Background Offset X", type: "number", placeholder: "0.0", step: 0.01 },
    { key: "Offset Y", label: "Background Offset Y", type: "number", placeholder: "0.0", step: 0.01 },
    { key: "Width", label: "Background Width", type: "number", placeholder: "0.0", step: 0.01 },
    { key: "Height", label: "Background Height", type: "number", placeholder: "0.0", step: 0.01 },
    { key: "Round", label: "Background Round", type: "number", placeholder: "0.1", step: 0.01 },
    { key: "Softness#1", label: "Background Softness", type: "number", placeholder: "0.0", step: 0.01 },
    { key: "Glow#1", label: "Background Glow", type: "number", placeholder: "0.0", step: 0.01 },
    { key: "Blend#1", label: "Background Blend", type: "number", placeholder: "1.0", step: 0.01 },
  ],
  Lollipop: [
    ...common,
    { key: "Word Spacing", label: "Word Spacing", type: "number", placeholder: "1.0", step: 0.01 },
    { key: "Outline 1 Color", label: "Outline Color", type: "color" },
    { key: "Thickness", label: "Outline Thickness", type: "number", placeholder: "0.0", step: 0.005 },
  ],
  Rotate: [...common, ...anchors],
  "Slide In": [
    ...common,
    ...anchors,
    { key: "Order", label: "Order", type: "text", placeholder: "Random But One by One" },
    { key: "Delay type", label: "Delay Type", type: "text", placeholder: "Between Each Character" },
    { key: "Delay", label: "Delay", type: "number", placeholder: "2.0", step: 0.1 },
  ],
  Statement: [
    ...common,
    { key: "V Anchor", label: "V Anchor", type: "number", placeholder: "0.0", step: 0.1 },
    { key: "V Justify", label: "V Justify", type: "number", placeholder: "0.0", step: 0.1 },
    { key: "H Anchor", label: "H Anchor", type: "number", placeholder: "0.0", step: 0.1 },
    { key: "H Justify", label: "H Justify", type: "number", placeholder: "0.0", step: 0.1 },
    { key: "Direction", label: "Direction", type: "text", placeholder: "Automatic" },
    { key: "Line Direction", label: "Line Direction", type: "text", placeholder: "Automatic" },
    { key: "Write On@0", label: "Write On Start", type: "number", placeholder: "0.0", step: 0.01 },
    { key: "Write On@1", label: "Write On End", type: "number", placeholder: "1.0", step: 0.01 },
  ],
};
