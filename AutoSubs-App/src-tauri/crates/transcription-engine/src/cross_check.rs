//! Double proof: cross-check a primary transcript against a second model.
//!
//! The primary transcript (model 1) owns everything structural: segment
//! boundaries, word timings and speaker labels. The proof transcript (model 2)
//! only gets a vote on the *spelling* of individual words. Both are aligned
//! word by word inside each primary segment's time window; where the two
//! disagree on a single word (a 1:1 substitution, never an insertion or a
//! deletion, so timing stays intact) the policy decides which spelling wins.
//!
//! Everything here is pure data manipulation, so it runs on any engine pair
//! and is covered by unit tests without loading a model.

use serde::{Deserialize, Serialize};

use crate::types::{Segment, WordTimestamp};

/// How a disagreement between the two models is resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CrossCheckPolicy {
    /// The model that is more confident about the word wins. When either side
    /// reports no confidence the primary spelling is kept and the
    /// disagreement is only reported.
    #[default]
    Confidence,
    /// The proof model always wins a disagreement.
    Proof,
    /// Nothing is changed; disagreements are only reported.
    Report,
}

impl CrossCheckPolicy {
    pub fn from_name(name: &str) -> Self {
        match name.to_ascii_lowercase().as_str() {
            "proof" => Self::Proof,
            "report" => Self::Report,
            _ => Self::Confidence,
        }
    }
}

/// One word on which the two models disagreed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrossCheckChange {
    pub start: f64,
    pub end: f64,
    /// Spelling from the primary model.
    pub original: String,
    /// Spelling from the proof model.
    pub proposed: String,
    /// Whether the proposed spelling was written into the transcript.
    pub applied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrossCheckReport {
    pub proof_model: String,
    /// Primary words that had a counterpart in the proof transcript.
    pub compared_words: usize,
    pub changes: Vec<CrossCheckChange>,
    /// Set when the proof pass could not run; the primary transcript is
    /// then returned unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CrossCheckReport {
    pub fn applied_count(&self) -> usize {
        self.changes.iter().filter(|c| c.applied).count()
    }
}

/// Slack around a primary segment when collecting proof words for it.
const WINDOW_PAD_SEC: f64 = 0.35;
/// A substituted pair must sit this close in time to count as the same word.
const MAX_MID_DRIFT_SEC: f64 = 0.8;
/// Below this character similarity the pair is treated as a different word
/// heard differently, not as a spelling variant, and left alone.
const MIN_SIMILARITY: f64 = 0.5;

/// Lowercased word core without surrounding punctuation or whitespace.
fn normalize(word: &str) -> String {
    core_of(word).to_lowercase()
}

/// Split a token into (prefix, core, suffix) where prefix and suffix are the
/// whitespace and punctuation around the alphanumeric core.
fn split_token(word: &str) -> (&str, &str, &str) {
    let is_core = |c: char| c.is_alphanumeric();
    let start = word.find(is_core).unwrap_or(word.len());
    let end = word
        .char_indices()
        .rev()
        .find(|&(_, c)| is_core(c))
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(start);
    if start >= end {
        return (word, "", "");
    }
    (&word[..start], &word[start..end], &word[end..])
}

fn core_of(word: &str) -> &str {
    split_token(word).1
}

fn levenshtein(a: &[char], b: &[char]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let sub = prev[j] + usize::from(ca != cb);
            cur[j + 1] = sub.min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// 1.0 for identical strings, 0.0 for nothing in common.
fn similarity(a: &str, b: &str) -> f64 {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let longest = a.len().max(b.len());
    if longest == 0 {
        return 1.0;
    }
    1.0 - levenshtein(&a, &b) as f64 / longest as f64
}

/// Word-level alignment (edit distance with unit costs). Returns the index
/// pairs that the alignment matched or substituted; gaps are dropped.
fn align(a: &[String], b: &[String]) -> Vec<(usize, usize)> {
    let (n, m) = (a.len(), b.len());
    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in dp.iter_mut().enumerate() {
        row[0] = i;
    }
    for j in 0..=m {
        dp[0][j] = j;
    }
    for i in 1..=n {
        for j in 1..=m {
            let sub = dp[i - 1][j - 1] + usize::from(a[i - 1] != b[j - 1]);
            dp[i][j] = sub.min(dp[i - 1][j] + 1).min(dp[i][j - 1] + 1);
        }
    }
    let mut pairs = Vec::new();
    let (mut i, mut j) = (n, m);
    while i > 0 && j > 0 {
        let sub = dp[i - 1][j - 1] + usize::from(a[i - 1] != b[j - 1]);
        if dp[i][j] == sub {
            pairs.push((i - 1, j - 1));
            i -= 1;
            j -= 1;
        } else if dp[i][j] == dp[i - 1][j] + 1 {
            i -= 1;
        } else {
            j -= 1;
        }
    }
    pairs.reverse();
    pairs
}

fn mid(w: &WordTimestamp) -> f64 {
    (w.start + w.end) / 2.0
}

/// Cross-check `primary` against `proof` in place and report every
/// disagreement. Segments without word timings are left untouched.
pub fn cross_check(
    primary: &mut [Segment],
    proof: &[Segment],
    policy: CrossCheckPolicy,
    proof_model: &str,
) -> CrossCheckReport {
    let mut proof_words: Vec<&WordTimestamp> = proof
        .iter()
        .filter_map(|s| s.words.as_ref())
        .flatten()
        .filter(|w| !core_of(&w.text).is_empty())
        .collect();
    proof_words.sort_by(|a, b| mid(a).total_cmp(&mid(b)));

    let mut report = CrossCheckReport {
        proof_model: proof_model.to_string(),
        ..Default::default()
    };

    for segment in primary.iter_mut() {
        let Some(words) = segment.words.as_mut() else { continue };

        // Primary words with a real core, keeping their index into `words`.
        let primary_idx: Vec<usize> =
            (0..words.len()).filter(|&i| !core_of(&words[i].text).is_empty()).collect();
        if primary_idx.is_empty() {
            continue;
        }

        let lo = segment.start - WINDOW_PAD_SEC;
        let hi = segment.end + WINDOW_PAD_SEC;
        let first = proof_words.partition_point(|w| mid(w) < lo);
        let window: Vec<&WordTimestamp> =
            proof_words[first..].iter().take_while(|w| mid(w) <= hi).copied().collect();
        if window.is_empty() {
            continue;
        }

        let a: Vec<String> = primary_idx.iter().map(|&i| normalize(&words[i].text)).collect();
        let b: Vec<String> = window.iter().map(|w| normalize(&w.text)).collect();

        let mut text_changed = false;
        for (ai, bi) in align(&a, &b) {
            let word = &mut words[primary_idx[ai]];
            let other = window[bi];
            if (mid(word) - mid(other)).abs() > MAX_MID_DRIFT_SEC {
                continue;
            }
            report.compared_words += 1;

            let (prefix, core, suffix) = split_token(&word.text);
            let proposed_core = core_of(&other.text);
            // Identical words, or a difference only in letter case (which the
            // formatting pass and the customer profile already own).
            if core == proposed_core || a[ai] == b[bi] {
                continue;
            }
            if similarity(&a[ai], &b[bi]) < MIN_SIMILARITY {
                continue;
            }

            let apply = match policy {
                CrossCheckPolicy::Proof => true,
                CrossCheckPolicy::Report => false,
                CrossCheckPolicy::Confidence => match (word.probability, other.probability) {
                    (Some(p1), Some(p2)) => p2 > p1,
                    _ => false,
                },
            };

            report.changes.push(CrossCheckChange {
                start: word.start,
                end: word.end,
                original: core.to_string(),
                proposed: proposed_core.to_string(),
                applied: apply,
            });

            if apply {
                word.text = format!("{prefix}{proposed_core}{suffix}");
                word.probability = other.probability.or(word.probability);
                text_changed = true;
            }
        }

        if text_changed {
            segment.text = words.iter().map(|w| w.text.as_str()).collect::<String>();
        }
    }

    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(text: &str, start: f64, end: f64, p: Option<f32>) -> WordTimestamp {
        WordTimestamp { text: text.into(), start, end, probability: p }
    }

    fn seg(words: Vec<WordTimestamp>) -> Segment {
        let start = words.first().map(|w| w.start).unwrap_or(0.0);
        let end = words.last().map(|w| w.end).unwrap_or(0.0);
        Segment {
            start,
            end,
            text: words.iter().map(|w| w.text.as_str()).collect(),
            words: Some(words),
            speaker_id: Some("1".into()),
        }
    }

    #[test]
    fn proof_policy_fixes_spelling_and_keeps_punctuation_and_timing() {
        let mut primary = vec![seg(vec![
            w(" Willkommen", 0.0, 0.5, Some(0.9)),
            w(" bei", 0.5, 0.7, Some(0.9)),
            w(" Tipiko.", 0.7, 1.2, Some(0.4)),
        ])];
        let proof = vec![seg(vec![
            w("willkommen", 0.0, 0.5, None),
            w("bei", 0.5, 0.7, None),
            w("Tipico", 0.72, 1.18, None),
        ])];
        let report = cross_check(&mut primary, &proof, CrossCheckPolicy::Proof, "m2");
        let words = primary[0].words.as_ref().unwrap();
        assert_eq!(words[2].text, " Tipico.");
        assert_eq!((words[2].start, words[2].end), (0.7, 1.2));
        assert_eq!(primary[0].text, " Willkommen bei Tipico.");
        assert_eq!(primary[0].speaker_id.as_deref(), Some("1"));
        assert_eq!(report.compared_words, 3);
        assert_eq!(report.applied_count(), 1);
    }

    #[test]
    fn confidence_policy_picks_the_surer_model() {
        let mut primary = vec![seg(vec![w(" Haus", 0.0, 0.4, Some(0.9)), w(" Maus", 0.4, 0.8, Some(0.3))])];
        let proof = vec![seg(vec![w("Hans", 0.0, 0.4, Some(0.5)), w("Mais", 0.4, 0.8, Some(0.8))])];
        let report = cross_check(&mut primary, &proof, CrossCheckPolicy::Confidence, "m2");
        let words = primary[0].words.as_ref().unwrap();
        assert_eq!(words[0].text, " Haus");
        assert_eq!(words[1].text, " Mais");
        assert_eq!(report.changes.len(), 2);
        assert_eq!(report.applied_count(), 1);
    }

    #[test]
    fn missing_confidence_keeps_primary_and_report_changes_nothing() {
        let proof = vec![seg(vec![w("Tipico", 0.0, 0.5, None)])];
        for policy in [CrossCheckPolicy::Confidence, CrossCheckPolicy::Report] {
            let mut primary = vec![seg(vec![w(" Tipiko", 0.0, 0.5, None)])];
            let report = cross_check(&mut primary, &proof, policy, "m2");
            assert_eq!(primary[0].words.as_ref().unwrap()[0].text, " Tipiko");
            assert_eq!(report.changes.len(), 1);
            assert!(!report.changes[0].applied);
        }
    }

    #[test]
    fn insertions_deletions_and_unrelated_words_are_ignored() {
        let mut primary = vec![seg(vec![
            w(" das", 0.0, 0.2, None),
            w(" ist", 0.2, 0.4, None),
            w(" gut", 0.4, 0.6, None),
        ])];
        // Proof drops "ist", adds a word, and hears "Brot" for "gut".
        let proof = vec![seg(vec![
            w("das", 0.0, 0.2, None),
            w("Brot", 0.4, 0.6, None),
            w("ja", 0.6, 0.7, None),
        ])];
        let report = cross_check(&mut primary, &proof, CrossCheckPolicy::Proof, "m2");
        assert_eq!(primary[0].text, " das ist gut");
        assert_eq!(primary[0].words.as_ref().unwrap().len(), 3);
        assert_eq!(report.applied_count(), 0);
    }

    #[test]
    fn case_only_differences_are_not_changes() {
        let mut primary = vec![seg(vec![w(" hallo", 0.0, 0.5, Some(0.1))])];
        let proof = vec![seg(vec![w("Hallo", 0.0, 0.5, Some(0.9))])];
        let report = cross_check(&mut primary, &proof, CrossCheckPolicy::Proof, "m2");
        assert!(report.changes.is_empty());
        assert_eq!(report.compared_words, 1);
    }

    #[test]
    fn split_token_handles_punctuation_only_and_unicode() {
        assert_eq!(split_token(" „Größe“,"), (" „", "Größe", "“,"));
        assert_eq!(split_token(" ..."), (" ...", "", ""));
    }
}
