import type { Subtitle } from "@/types";

/**
 * Colour markup for Resolve's plain-text subtitle track (SRT `<font color>`).
 *
 * - Keywords (players, clubs): whole words, case- and punctuation-insensitive,
 *   Unicode-aware ("München"), longest phrase first, and phrases may span two
 *   cues ("… was Lennart | Karl für …"). Mirrors the Rust side (`keywords.rs`).
 * - Word highlight ("karaoke"): each cue is split into one cue per spoken
 *   word; the full line stays on screen and the active word is drawn in the
 *   highlight colour. The track has no animation, so this is the closest it
 *   gets to the animated Fusion highlight.
 *
 * Only word cores are coloured; punctuation keeps the normal colour.
 */

interface Token {
  sub: number;
  /** Index among the cue's whitespace-separated tokens. */
  pos: number;
  coreStart: number;
  coreEnd: number;
  norm: string;
}

const CORE = /[\p{L}\p{N}](?:[\p{L}\p{N}'’.\-]*[\p{L}\p{N}])?/u;

function normWord(word: string): string {
  const m = word.match(CORE);
  return m ? m[0].toLowerCase() : "";
}

function compile(keywords: string[]): string[][] {
  const seen = new Set<string>();
  const phrases: string[][] = [];
  for (const k of keywords) {
    const p = k.split(/\s+/).map(normWord).filter(Boolean);
    const key = p.join(" ");
    if (p.length && !seen.has(key)) {
      seen.add(key);
      phrases.push(p);
    }
  }
  return phrases.sort((a, b) => b.length - a.length);
}

/** Whitespace tokens of one text with their word cores (null for pure punctuation). */
function textTokens(text: string) {
  return [...text.matchAll(/\S+/g)].map((m) => {
    const core = m[0].match(CORE);
    const start = (m.index ?? 0) + (core?.index ?? 0);
    return core ? { start, end: start + core[0].length, norm: core[0].toLowerCase() } : null;
  });
}

/** Per cue, per whitespace token: is it part of a keyword? */
function keywordHits(subtitles: Subtitle[], keywords: string[]): boolean[][] {
  const hits = subtitles.map((s) => textTokens(s.text ?? "").map(() => false));
  const phrases = compile(keywords);
  if (!phrases.length) return hits;

  const tokens: Token[] = [];
  subtitles.forEach((s, sub) => {
    textTokens(s.text ?? "").forEach((t, pos) => {
      if (t) tokens.push({ sub, pos, coreStart: t.start, coreEnd: t.end, norm: t.norm });
    });
  });
  for (let i = 0; i < tokens.length; ) {
    const p = phrases.find((ph) => i + ph.length <= tokens.length && ph.every((w, k) => tokens[i + k].norm === w));
    if (p) {
      for (let k = 0; k < p.length; k++) hits[tokens[i + k].sub][tokens[i + k].pos] = true;
      i += p.length;
    } else {
      i += 1;
    }
  }
  return hits;
}

/**
 * Rebuild a cue's text with per-token colours. Consecutive tokens of the same
 * colour on one line share one tag, so "Bayern München" is a single run.
 */
function renderColored(text: string, colors: (string | null)[]): string {
  const toks = textTokens(text);
  let out = "";
  let cursor = 0;
  let open: string | null = null;
  toks.forEach((t, i) => {
    if (!t) return;
    const color = colors[i] ?? null;
    const between = text.slice(cursor, t.start);
    if (open && (open !== color || between.includes("\n") || /[^\s]/.test(between))) {
      out += "</font>";
      open = null;
    }
    out += between;
    if (color && open !== color) {
      out += `<font color="${color}">`;
      open = color;
    }
    out += text.slice(t.start, t.end);
    cursor = t.end;
  });
  if (open) out += "</font>";
  return out + text.slice(cursor);
}

export function colorKeywords(subtitles: Subtitle[], keywords: string[], color: string): Subtitle[] {
  const hits = keywordHits(subtitles, keywords);
  return subtitles.map((s, i) =>
    hits[i].some(Boolean) ? { ...s, text: renderColored(s.text ?? "", hits[i].map((h) => (h ? color : null))) } : s,
  );
}

/**
 * Map each whitespace token of the cue text to the word timing it belongs to.
 * A word may hold several tokens ("Bayern München" is kept as one word);
 * returns null when text and words no longer line up (e.g. edited text).
 */
function tokenTimes(sub: Subtitle): { start: number; end: number }[] | null {
  const words = sub.words ?? [];
  const count = (s: string) => (s.match(/\S+/g) ?? []).length;
  const total = count(sub.text ?? "");
  if (!words.length || !total) return null;
  const times: { start: number; end: number }[] = [];
  for (const w of words) {
    for (let k = 0; k < count(w.word ?? ""); k++) times.push({ start: w.start, end: w.end });
  }
  return times.length === total ? times : null;
}

/**
 * One cue per spoken word: full line visible, active word in `highlight`,
 * keywords in `keywordColor`. Cues whose words no longer match the text are
 * kept as one cue with keyword colours only.
 */
export function karaokeSubtitles(
  subtitles: Subtitle[],
  keywords: string[],
  keywordColor: string,
  highlight: string,
): Subtitle[] {
  const hits = keywordHits(subtitles, keywords);
  const out: Subtitle[] = [];
  subtitles.forEach((s, i) => {
    const base = hits[i].map((h) => (h ? keywordColor : null));
    const times = tokenTimes(s);
    if (!times) {
      out.push({ ...s, text: renderColored(s.text ?? "", base) });
      return;
    }
    // Group tokens spoken together (one word may cover several tokens).
    const groups: { from: number; to: number; start: number }[] = [];
    times.forEach((t, k) => {
      const last = groups[groups.length - 1];
      if (last && last.start === t.start) last.to = k;
      else groups.push({ from: k, to: k, start: t.start });
    });
    groups.forEach((g, gi) => {
      const start = gi === 0 ? s.start : Math.max(s.start, g.start);
      const end = gi + 1 < groups.length ? Math.max(start, groups[gi + 1].start) : s.end;
      if (end <= start) return;
      const colors = base.map((c, k) => (k >= g.from && k <= g.to ? highlight : c));
      out.push({ ...s, start, end, text: renderColored(s.text ?? "", colors) });
    });
  });
  return out;
}
