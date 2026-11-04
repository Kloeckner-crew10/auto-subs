import type { CustomerProfile, Settings, SubtitleRules, WordReplacement } from "@/types";

/** Profile picked for the next run, or undefined when none is active. */
export function getActiveProfile(
  settings: Pick<Settings, "customerProfiles" | "activeProfileId">,
): CustomerProfile | undefined {
  if (!settings.activeProfileId) return undefined;
  return settings.customerProfiles.find((p) => p.id === settings.activeProfileId);
}

export function newProfile(name: string): CustomerProfile {
  return {
    id: crypto.randomUUID(),
    name,
    presetId: null,
    keywords: [],
    replacements: [],
    minDurationSec: null,
    maxDurationSec: null,
    pauseSplitSec: null,
  };
}

/** Rules the Rust formatter applies; undefined when the profile has none. */
export function profileRules(profile: CustomerProfile | undefined): SubtitleRules | undefined {
  if (!profile) return undefined;
  const rules: SubtitleRules = {
    replacements: profile.replacements.filter((r) => r.from.trim()),
    keywords: profileKeywords(profile),
    minDurationSec: profile.minDurationSec,
    maxDurationSec: profile.maxDurationSec,
    pauseSplitSec: profile.pauseSplitSec,
  };
  const empty =
    rules.replacements.length === 0 &&
    (rules.keywords?.length ?? 0) === 0 &&
    rules.minDurationSec == null &&
    rules.maxDurationSec == null &&
    rules.pauseSplitSec == null;
  return empty ? undefined : rules;
}

/**
 * Whisper's vocabulary hint: the user's own prompt plus the profile's
 * keywords and correct spellings, so names are heard right in the first place.
 * Whisper only reads the last ~220 tokens, so the list is capped.
 */
export function profilePrompt(profile: CustomerProfile | undefined, customPrompt: string): string {
  const base = customPrompt.trim();
  if (!profile) return base;
  const terms = [
    ...profile.keywords,
    ...profile.replacements.map((r) => r.to).filter(Boolean),
  ]
    .map((t) => t.trim())
    .filter(Boolean);
  const unique = Array.from(new Set(terms));
  let vocab = "";
  for (const term of unique) {
    const next = vocab ? `${vocab}, ${term}` : term;
    if (next.length > 600) break;
    vocab = next;
  }
  return [base, vocab].filter(Boolean).join(" ");
}

/** Keywords to colour in Resolve, if the active profile has any. */
export function profileKeywords(profile: CustomerProfile | undefined): string[] {
  return profile?.keywords.map((k) => k.trim()).filter(Boolean) ?? [];
}

// ── Text-area round trip for the editor ──────────────────────────────────

/** One keyword per line (commas also split). */
export function parseKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,;]/)
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  );
}

export function formatKeywords(keywords: string[]): string {
  return keywords.join("\n");
}

/** One rule per line: `wrong => right`; `ähm =>` removes the word. */
export function parseReplacements(text: string): WordReplacement[] {
  const rules: WordReplacement[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^(.*?)\s*(?:=>|->|→)\s*(.*)$/);
    if (!match) continue;
    const from = match[1].trim();
    if (!from) continue;
    rules.push({ from, to: match[2].trim() });
  }
  return rules;
}

export function formatReplacements(rules: WordReplacement[]): string {
  return rules.map((r) => `${r.from} => ${r.to}`.trimEnd()).join("\n");
}

/** Blank or invalid input means "use the default". */
export function parseSeconds(text: string): number | null {
  const value = Number(text.replace(",", ".").trim());
  return text.trim() && Number.isFinite(value) && value >= 0 ? value : null;
}
