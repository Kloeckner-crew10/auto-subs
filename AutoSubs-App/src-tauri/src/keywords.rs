//! Customer-profile keywords (players, clubs, brands) that the caption macro
//! draws in its own colour.
//!
//! Matching happens here, on the Rust side, right before a subtitle document
//! goes to Resolve: Lua's string library only lowercases ASCII, which would
//! miss "München" or "Müller". Each matching word gets `"keyword": true`; the
//! macro turns that into colour. Multi-word keywords ("Bayern München") match
//! consecutive words, also across subtitle boundaries, because one name often
//! straddles two cues ("… was Lennart | Karl für …").

use serde_json::Value;

/// Lowercased word core without surrounding punctuation.
fn norm(word: &str) -> String {
    word.trim()
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase()
}

/// Keyword phrases as lists of normalized words, longest first so
/// "Bayern München" wins over "Bayern" at the same position.
fn compile(keywords: &[String]) -> Vec<Vec<String>> {
    let mut phrases: Vec<Vec<String>> = keywords
        .iter()
        .map(|k| k.split_whitespace().map(norm).filter(|w| !w.is_empty()).collect::<Vec<_>>())
        .filter(|p: &Vec<String>| !p.is_empty())
        .collect();
    phrases.sort_by(|a, b| b.len().cmp(&a.len()));
    phrases.dedup();
    phrases
}

/// Mark keyword words in a subtitle document (`{ segments: [{ words: [...] }] }`)
/// in place. Returns how many words were marked. Existing marks are cleared
/// first so a changed list never leaves stale colour behind.
pub fn mark_keywords(doc: &mut Value, keywords: &[String]) -> usize {
    let phrases = compile(keywords);
    let Some(segments) = doc.get_mut("segments").and_then(Value::as_array_mut) else {
        return 0;
    };

    // Flat (segment, word) index over the whole document.
    let mut flat: Vec<(usize, usize, String)> = Vec::new();
    for (si, seg) in segments.iter_mut().enumerate() {
        if let Some(words) = seg.get_mut("words").and_then(Value::as_array_mut) {
            for (wi, w) in words.iter_mut().enumerate() {
                if let Some(obj) = w.as_object_mut() {
                    obj.remove("keyword");
                }
                // A word can hold a joined keyword ("Bayern München"), so
                // match on its space-separated parts.
                let text = w.get("word").and_then(Value::as_str).unwrap_or("");
                for part in text.split_whitespace() {
                    let n = norm(part);
                    if !n.is_empty() {
                        flat.push((si, wi, n));
                    }
                }
            }
        }
    }
    if phrases.is_empty() {
        return 0;
    }

    let mut hits = vec![false; flat.len()];
    let mut i = 0;
    while i < flat.len() {
        let matched = phrases.iter().find(|p| {
            i + p.len() <= flat.len() && p.iter().enumerate().all(|(k, w)| flat[i + k].2 == *w)
        });
        match matched {
            Some(p) => {
                for k in 0..p.len() {
                    hits[i + k] = true;
                }
                i += p.len();
            }
            None => i += 1,
        }
    }

    let mut marked = std::collections::BTreeSet::new();
    for ((si, wi, _), hit) in flat.iter().zip(hits) {
        if hit {
            segments[*si]["words"][*wi]["keyword"] = Value::Bool(true);
            marked.insert((*si, *wi));
        }
    }
    marked.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc() -> Value {
        json!({ "segments": [
            { "text": "Völlig egal, was Lennart", "words": [
                { "word": "Völlig" }, { "word": " egal," }, { "word": " was" }, { "word": " Lennart" } ] },
            { "text": "Karl für Bayern München.", "words": [
                { "word": "Karl" }, { "word": " für" }, { "word": " Bayern" }, { "word": " München.", "keyword": true } ] },
            { "text": "Bayern", "words": [ { "word": " bayern" } ] }
        ]})
    }

    fn marked(d: &Value) -> Vec<String> {
        d["segments"].as_array().unwrap().iter()
            .flat_map(|s| s["words"].as_array().unwrap().iter())
            .filter(|w| w["keyword"] == Value::Bool(true))
            .map(|w| w["word"].as_str().unwrap().trim().to_string())
            .collect()
    }

    #[test]
    fn marks_phrases_across_cues_and_umlauts() {
        let mut d = doc();
        let n = mark_keywords(&mut d, &["Lennart Karl".into(), "Bayern München".into(), "Bayern".into()]);
        assert_eq!(marked(&d), vec!["Lennart", "Karl", "Bayern", "München.", "bayern"]);
        assert_eq!(n, 5);
    }

    #[test]
    fn joined_keyword_word_is_marked_once() {
        let mut d = json!({ "segments": [ { "words": [ { "word": " bei" }, { "word": " Bayern München," } ] } ] });
        assert_eq!(mark_keywords(&mut d, &["Bayern München".into()]), 1);
        assert_eq!(marked(&d), vec!["Bayern München,"]);
    }

    #[test]
    fn partial_phrase_is_not_marked_and_stale_marks_are_cleared() {
        let mut d = doc();
        mark_keywords(&mut d, &["Lennart Karlsson".into()]);
        assert!(marked(&d).is_empty());
    }
}
