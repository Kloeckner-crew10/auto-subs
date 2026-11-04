import type { Subtitle } from "@/types";

/**
 * Colour customer keywords (players, clubs) in subtitle text with SRT
 * `<font color>` tags, for Resolve's plain-text subtitle track.
 *
 * Matching mirrors the Rust side (`keywords.rs`): whole words, case- and
 * punctuation-insensitive, Unicode-aware ("München"), longest phrase first,
 * and phrases may span two cues ("… was Lennart | Karl für …"). Only the word
 * cores are coloured; surrounding punctuation keeps the normal colour.
 */

interface Token {
  sub: number;
  /** Offsets of the word core inside the cue text. */
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

function tokenize(subtitles: Subtitle[]): Token[] {
  const tokens: Token[] = [];
  subtitles.forEach((s, sub) => {
    const text = s.text ?? "";
    for (const m of text.matchAll(/\S+/g)) {
      const core = m[0].match(CORE);
      if (!core || core.index === undefined) continue;
      const coreStart = (m.index ?? 0) + core.index;
      tokens.push({ sub, coreStart, coreEnd: coreStart + core[0].length, norm: core[0].toLowerCase() });
    }
  });
  return tokens;
}

export function colorKeywords(subtitles: Subtitle[], keywords: string[], color: string): Subtitle[] {
  const phrases = compile(keywords);
  if (!phrases.length) return subtitles;
  const tokens = tokenize(subtitles);

  const hit = new Array<boolean>(tokens.length).fill(false);
  for (let i = 0; i < tokens.length; ) {
    const p = phrases.find(
      (ph) => i + ph.length <= tokens.length && ph.every((w, k) => tokens[i + k].norm === w),
    );
    if (p) {
      for (let k = 0; k < p.length; k++) hit[i + k] = true;
      i += p.length;
    } else {
      i += 1;
    }
  }

  // Group hits into runs per cue; a run never crosses a cue or a line break.
  const runsBySub = new Map<number, Array<[number, number]>>();
  for (let i = 0; i < tokens.length; i++) {
    if (!hit[i]) continue;
    const t = tokens[i];
    const text = subtitles[t.sub].text ?? "";
    const runs = runsBySub.get(t.sub) ?? [];
    const last = runs[runs.length - 1];
    const prev = i > 0 ? tokens[i - 1] : undefined;
    const joinable =
      last && prev && hit[i - 1] && prev.sub === t.sub && !text.slice(prev.coreEnd, t.coreStart).includes("\n");
    if (joinable) last[1] = t.coreEnd;
    else runs.push([t.coreStart, t.coreEnd]);
    runsBySub.set(t.sub, runs);
  }

  return subtitles.map((s, sub) => {
    const runs = runsBySub.get(sub);
    if (!runs) return s;
    let text = s.text ?? "";
    for (const [start, end] of [...runs].reverse()) {
      text = `${text.slice(0, start)}<font color="${color}">${text.slice(start, end)}</font>${text.slice(end)}`;
    }
    return { ...s, text };
  });
}
