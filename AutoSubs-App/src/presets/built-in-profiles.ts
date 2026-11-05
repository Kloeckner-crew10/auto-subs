import type { CustomerProfile, SubtitleStyleDef, TrackStyle } from "@/types";

/**
 * Customer profiles offered once on first start. They are ordinary profiles
 * after that: editable, and deleting one keeps it deleted (see
 * `seedBuiltInProfiles`).
 *
 * Tipico: player and club names are always drawn fully in Tipico red.
 * Surnames are listed on their own as well, because commentary mostly uses
 * them alone ("Karl weg von den Bayern"). Extend the list in the profile
 * dialog; it is only a starting point.
 */
const TIPICO_CLUBS = [
  // Bundesliga and frequent 2. Bundesliga clubs, with common short forms
  "FC Bayern München", "FC Bayern", "Bayern München", "Bayern",
  "Borussia Dortmund", "BVB", "Dortmund",
  "Bayer 04 Leverkusen", "Bayer Leverkusen", "Leverkusen",
  "RB Leipzig", "Leipzig",
  "VfB Stuttgart", "Stuttgart",
  "Eintracht Frankfurt", "Eintracht", "Frankfurt",
  "SC Freiburg", "Freiburg",
  "VfL Wolfsburg", "Wolfsburg",
  "Borussia Mönchengladbach", "Mönchengladbach", "Gladbach",
  "SV Werder Bremen", "Werder Bremen", "Werder", "Bremen",
  "1. FC Union Berlin", "Union Berlin",
  "TSG Hoffenheim", "Hoffenheim",
  "FC Augsburg", "Augsburg",
  "1. FSV Mainz 05", "Mainz 05", "Mainz",
  "FC St. Pauli", "St. Pauli",
  "1. FC Heidenheim", "Heidenheim",
  "Hamburger SV", "HSV",
  "1. FC Köln", "Köln",
  "FC Schalke 04", "Schalke 04", "Schalke",
  "Hertha BSC", "Hertha",
  "Fortuna Düsseldorf", "Fortuna",
  "VfL Bochum", "Bochum",
  "1. FC Kaiserslautern", "Kaiserslautern",
  "Hannover 96",
  "1. FC Nürnberg", "Nürnberg",
  "Holstein Kiel",
  // Big European clubs that come up a lot
  "Real Madrid", "FC Barcelona", "Barcelona", "Barça",
  "Atlético Madrid", "Manchester City", "Manchester United",
  "FC Liverpool", "Liverpool", "FC Arsenal", "Arsenal", "FC Chelsea", "Chelsea",
  "Tottenham Hotspur", "Tottenham",
  "Paris Saint-Germain", "PSG", "Juventus Turin", "Juventus",
  "Inter Mailand", "AC Mailand", "SSC Neapel",
];

const TIPICO_PLAYERS = [
  // From the first Tipico clip; add more in the profile dialog.
  "Lennart Karl", "Karl",
  "Michael Ballack", "Ballack",
  "Leroy Sané", "Sané",
];

/** Tipico subtitle track as set up in Resolve (Inspector → Track). */
export const TIPICO_TRACK_STYLE: TrackStyle = {
  font: "Tipico",
  fontFace: "Medium",
  size: 38,
  color: "#ffffff",
  shadow: true,
  shadowColor: "#000000",
  shadowOffsetX: 25,
  shadowOffsetY: -25,
  shadowBlur: 7,
  shadowOpacity: 75,
};

export const BUILT_IN_PROFILES: CustomerProfile[] = [
  {
    id: "builtin:tipico",
    name: "Tipico",
    presetId: null,
    keywords: [...TIPICO_PLAYERS, ...TIPICO_CLUBS],
    keywordColor: "#C8102E",
    trackStyle: TIPICO_TRACK_STYLE,
    replacements: [
      { from: "Ballak", to: "Ballack" },
      { from: "Balak", to: "Ballack" },
      { from: "Ballag", to: "Ballack" },
      { from: "Sane", to: "Sané" },
      { from: "Tipiko", to: "Tipico" },
    ],
    minDurationSec: null,
    maxDurationSec: null,
    pauseSplitSec: null,
  },
];

/** Subtitle-track styles offered once on first start. */
export const BUILT_IN_SUBTITLE_STYLES: SubtitleStyleDef[] = [
  { id: "builtin:tipico-track", name: "Tipico", mode: "plain", highlightColor: "#FFE64A", look: TIPICO_TRACK_STYLE },
  { id: "builtin:tipico-karaoke", name: "Tipico Wort-Highlight", mode: "karaoke", highlightColor: "#FFE64A", look: TIPICO_TRACK_STYLE },
  {
    id: "builtin:standard-white",
    name: "Standard (weiß)",
    mode: "plain",
    highlightColor: "#FFE64A",
    look: { ...TIPICO_TRACK_STYLE, font: "Helvetica Neue", fontFace: "Bold" },
  },
];
