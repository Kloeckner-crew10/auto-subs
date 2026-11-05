import { DEFAULT_SAFE_ZONE_SETTINGS } from "@/lib/safe-zones";
import { BUILT_IN_PROFILES, BUILT_IN_SUBTITLE_STYLES, TIPICO_TRACK_STYLE } from "@/presets/built-in-profiles";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { platform } from "@tauri-apps/plugin-os";
import { CaptionStyle, Settings } from "@/types";
import { getPreferredUiLanguage, normalizeUiLanguage, initI18n } from "@/i18n";
import {
  models,
  modelSupportsLanguage,
  getFirstRecommendedModelForLanguage,
} from "@/lib/models";
import { DEFAULT_PRESET_ID } from "@/presets/built-in-presets";
import { createTauriStorage, hasStoredValue } from "@/lib/tauri-storage";

// ─── Store file config ────────────────────────────────────────────────────
// Same file + key as the previous SettingsContext so existing user data
// continues to load without migration.
const STORE_FILE = "autosubs-store.json";
const STORE_KEY = "settings";

// ─── Default settings ─────────────────────────────────────────────────────
export const DEFAULT_SETTINGS: Settings = {
  // Mode
  audioInputMode: "timeline",
  preferredEditorIntegration: "davinci",

  // UI settings
  uiLanguage: "en",
  onboardingCompleted: false,
  lastSeenVersion: "",
  showEnglishOnlyModels: false,
  subtitlePanelWidth: 340,

  // Survey notification settings
  timesDismissedSurvey: 0,
  lastSurveyDate: new Date().toISOString(),

  // Milestone tracking
  transcriptionsCompleted: 0,
  subSlateMilestoneShown: false,

  // Processing settings
  model: 0,
  language: "auto",
  translate: false,
  targetLanguage: "en",
  enableDTW: true, // gpu enabled by default on mac and linux, disabled by default on windows
  enableForcedAlignment: false,
  enableGpu: true,
  enableVad: true,
  enableDiarize: false,
  maxSpeakers: null,
  diarizeBackend: "sortformer",
  exportRange: "inout",

  // Text settings
  textDensity: "standard",
  maxLinesPerSubtitle: 1,
  splitOnPunctuation: true,
  textCase: "none",
  removePunctuation: false,
  enableCensor: false,
  censoredWords: [],
  censorStyle: "middle",
  activeCensorLists: [],
  customPrompt: "",
  customMaxCharsPerLine: 38,
  customMaxWordsPerLine: 3,
  customDensityUnit: "words",

  // Resolve settings
  selectedInputTracksByApp: {
    davinci: ["1"],
    premiere: [],
    aftereffects: [],
    standalone: [],
  },
  selectedOutputTrack: "1",

  // Caption style
  captionStyle: { source: "autosubs", presetId: DEFAULT_PRESET_ID },

  // Output
  outputTarget: "video",
  speakerColors: false,
  subtitleTrackStyle: { mode: "plain", highlightColor: "#FFE64A" },
  subtitleStyles: [],
  activeSubtitleStyleId: null,
  seededSubtitleStyles: [],
  safeZone: DEFAULT_SAFE_ZONE_SETTINGS,

  // Double proof
  proofModel: null,
  proofPolicy: "confidence",

  // Customer profiles
  customerProfiles: [],
  activeProfileId: null,
  seededProfiles: [],
};

// ─── Persisted-shape normalisation ────────────────────────────────────────
/**
 * Reshape settings loaded from disk into the current schema.
 *
 * Before the `captionStyle` union, the caption selection lived in three
 * fields (`captionMode`, `selectedTemplate`, `presetId`) that callers had to
 * keep in agreement. Older settings files still carry them, so map them onto
 * the union and drop them.
 *
 * The Tauri storage adapter has no version field (it stores the bare settings
 * object so the on-disk format stays readable), so this runs on every load and
 * must be idempotent: already-migrated settings pass straight through.
 */
export function normalizePersistedSettings(persisted: unknown): Partial<Settings> {
  return seedBuiltInProfiles(normalizeCaptionStyle(persisted));
}

/** Offer each built-in customer profile once; a deleted one is not re-added. */
function seedBuiltInProfiles(next: Partial<Settings>): Partial<Settings> {
  const seeded = new Set(next.seededProfiles ?? []);
  // Tipico red changed from #be1825 to #C8102E after the profile was first seeded.
  const profiles = (next.customerProfiles ?? []).map((p) =>
    p.id === "builtin:tipico" && p.keywordColor === "#be1825" ? { ...p, keywordColor: "#C8102E" } : p,
  ).map((p) =>
    // Track style added after the Tipico profile was first seeded.
    p.id === "builtin:tipico" && !p.trackStyle ? { ...p, trackStyle: TIPICO_TRACK_STYLE } : p,
  );
  for (const profile of BUILT_IN_PROFILES) {
    if (seeded.has(profile.id)) continue;
    if (!profiles.some((p) => p.id === profile.id)) profiles.push(structuredClone(profile));
    seeded.add(profile.id);
  }
  // Subtitle-track styles: same offer-once rule.
  const seededStyles = new Set(next.seededSubtitleStyles ?? []);
  let styles = [...(next.subtitleStyles ?? [])];
  // One-time cleanup (Nov 2026): only the Tipico subtitle style stays, with
  // the values set in Resolve's Track Style. Styles added later are kept.
  const TIPICO_ONLY = "reset:tipico-only-2026-11";
  if (!seededStyles.has(TIPICO_ONLY)) {
    styles = [];
    seededStyles.clear();
    seededStyles.add(TIPICO_ONLY);
    next = { ...next, activeSubtitleStyleId: "builtin:tipico-track" };
  }
  // The one-cue-per-word "karaoke" SRT is not shown by Resolve; it became
  // Resolve's own "Word Highlight" animation.
  styles = styles.map((st) =>
    st.mode === "karaoke" ? { ...st, mode: "plain" as const, animation: st.animation ?? "Word Highlight" } : st,
  );
  // Highlight colour moved into the Word Highlight settings.
  styles = styles.map((st) =>
    st.animation === "Word Highlight" && st.highlightColor && !st.animationSettings?.["Highlight Color"]
      ? { ...st, animationSettings: { ...(st.animationSettings ?? {}), "Highlight Color": st.highlightColor } }
      : st,
  );
  // Position and stroke were added to the Tipico look later.
  styles = styles.map((st) =>
    st.id === "builtin:tipico-track" && st.look && st.look.positionY == null
      ? { ...st, look: { ...st.look, positionX: 1080, positionY: 1100, strokeSize: 0 } }
      : st,
  );
  for (const style of BUILT_IN_SUBTITLE_STYLES) {
    if (seededStyles.has(style.id)) continue;
    if (!styles.some((s) => s.id === style.id)) styles.push(structuredClone(style));
    seededStyles.add(style.id);
  }
  const activeSubtitleStyleId =
    next.activeSubtitleStyleId && styles.some((s) => s.id === next.activeSubtitleStyleId)
      ? next.activeSubtitleStyleId
      : styles[0]?.id ?? null;

  return {
    ...next,
    customerProfiles: profiles,
    seededProfiles: [...seeded],
    subtitleStyles: styles,
    seededSubtitleStyles: [...seededStyles],
    activeSubtitleStyleId,
  };
}

function normalizeCaptionStyle(persisted: unknown): Partial<Settings> {
  if (!persisted || typeof persisted !== "object") return {};
  const {
    captionMode,
    selectedTemplate,
    presetId,
    captionStyle,
    ...rest
  } = persisted as Record<string, unknown>;

  const next = rest as Partial<Settings>;

  if (isCaptionStyle(captionStyle)) {
    next.captionStyle = captionStyle;
    return next;
  }

  const templateName =
    selectedTemplate && typeof selectedTemplate === "object"
      ? (selectedTemplate as { value?: unknown }).value
      : undefined;

  if (captionMode === "regular" && typeof templateName === "string" && templateName) {
    next.captionStyle = { source: "resolve", templateName };
  } else {
    // Anything else (including a missing mode) lands on the animated default,
    // which is what every install has shipped with.
    next.captionStyle = {
      source: "autosubs",
      presetId: typeof presetId === "string" && presetId ? presetId : DEFAULT_PRESET_ID,
    };
  }

  return next;
}

function isCaptionStyle(value: unknown): value is CaptionStyle {
  if (!value || typeof value !== "object") return false;
  const style = value as Partial<CaptionStyle> & { source?: string };
  if (style.source === "autosubs") {
    return typeof (style as { presetId?: unknown }).presetId === "string";
  }
  if (style.source === "resolve") {
    return typeof (style as { templateName?: unknown }).templateName === "string";
  }
  return false;
}

// ─── Store type ───────────────────────────────────────────────────────────
interface SettingsStore extends Settings {
  /** Whether the store has finished loading from disk. */
  isHydrated: boolean;

  // Actions
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
  /** Mark the store as hydrated. */
  setHydrated: () => void;
}

// ─── Store creation ───────────────────────────────────────────────────────
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      isHydrated: false,

      updateSetting: (key, value) =>
        set((state) => {
          const patch: Partial<Settings> = {
            [key]:
              key === "uiLanguage"
                ? (normalizeUiLanguage(value as string) as Settings[typeof key])
                : value,
          };

          // If language changed and the current model doesn't support it,
          // auto-switch to the first recommended model that does.
          if (key === "language" && value !== state.language) {
            const currentModel = models[state.model];
            if (!modelSupportsLanguage(currentModel, value as string)) {
              const recommended = getFirstRecommendedModelForLanguage(value as string);
              if (recommended) {
                const idx = models.findIndex((m) => m.value === recommended.value);
                if (idx !== -1) patch.model = idx;
              }
            }
          }

          return patch;
        }),

      resetSettings: () =>
        set((state) => ({
          ...DEFAULT_SETTINGS,
          uiLanguage: getPreferredUiLanguage(),
          onboardingCompleted: true,
          // Preserve milestone tracking and usage data
          transcriptionsCompleted: state.transcriptionsCompleted,
          subSlateMilestoneShown: state.subSlateMilestoneShown,
          timesDismissedSurvey: state.timesDismissedSurvey,
          lastSurveyDate: state.lastSurveyDate,
          lastSeenVersion: state.lastSeenVersion,
        })),

      setHydrated: () => set({ isHydrated: true }),
    }),
    {
      name: STORE_KEY,
      storage: createTauriStorage<Settings>(STORE_FILE, STORE_KEY),
      merge: (persisted, current) => ({
        ...current,
        ...normalizePersistedSettings(persisted),
      }),
      // Only persist the settings fields — never the hydration flag or actions.
      partialize: (state) => {
        const {
          isHydrated,
          updateSetting,
          resetSettings,
          setHydrated,
          ...settings
        } = state;
        return settings;
      },
      // We handle rehydration manually in SettingsProvider so we can detect
      // first-run (for platform-specific enableDTW default) before loading.
      skipHydration: true,
    },
  ),
);

// ─── Manual rehydration ───────────────────────────────────────────────────
/**
 * Load settings from the Tauri store, applying platform-specific defaults
 * on first run. This mirrors the previous SettingsContext init flow:
 *
 * 1. Detect platform (for Windows enableDTW default on first run).
 * 2. Check whether persisted data exists.
 * 3. If first run, apply platform-specific defaults before rehydration.
 * 4. Rehydrate from storage (zustand's default merge spreads persisted
 *    fields over the in-memory defaults).
 * 5. Mark as hydrated.
 */
export async function hydrateSettingsStore(): Promise<void> {
  try {
    const currentPlatform = await platform();
    const isWindows = currentPlatform === "windows";

    const hasData = await hasStoredValue(STORE_FILE, STORE_KEY);

    if (!hasData) {
      // First run — apply platform-specific defaults that differ from
      // DEFAULT_SETTINGS. With no persisted data, zustand's default merge
      // keeps these values as-is.
      useSettingsStore.setState({
        enableDTW: !isWindows,
        uiLanguage: getPreferredUiLanguage(),
      });
    }

    // Trigger persist's rehydration (zustand merges persisted state over
    // the current in-memory state).
    await useSettingsStore.persist.rehydrate();

    // Initialise i18n with the hydrated UI language *before* marking the
    // store as hydrated. SettingsProvider gates children on isHydrated, so
    // this guarantees the first render of children uses the correct language
    // and avoids a one-frame flash of the default (en) UI for returning
    // non-English users.
    initI18n(useSettingsStore.getState().uiLanguage);
  } catch (error) {
    console.error("Error initializing settings store:", error);
  } finally {
    useSettingsStore.getState().setHydrated();
  }
}
