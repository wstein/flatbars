//! **Migration idiom metrics** over a parsed template — the measurement that *finds
//! the parameters* for idiomatic lowering (`docs/15`).
//!
//! A naive Mustache→`.truss` lowering is a 1:1 node map. An *idiomatic* one collapses
//! recurring shapes — a section and its complementary inverse become `{{#if}}…{{else}}`,
//! a trivial pair becomes a ternary, a run of exclusive flags hints at `{{#case}}`. Which
//! collapses pay off (and their thresholds) is an empirical question: this module counts
//! the idiom candidates in a template (or, aggregated, a corpus) so the lowering's
//! parameters are chosen from data, not guessed.
//!
//! Detection is purely structural (no schema): it locates the *candidates*; the lowering
//! decides which to apply under its [`crate::lower`] options. Currently Mustache-only.

use crate::Span;
use crate::mustache::{Name, Node};

/// A recognised idiom candidate (or residual) kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Idiom {
    /// I1: `{{#x}}A{{/x}}{{^x}}B{{/x}}` (either order) → `{{#if x}}A{{else}}B{{/if}}`.
    ComplementaryIf,
    /// I3: a complementary pair whose arms are each a single literal/variable →
    /// `{{x ? A : B}}`.
    TrivialTernary,
    /// I2: an unpaired `{{^x}}B{{/x}}` → `{{#unless x}}B{{/unless}}`.
    LoneUnless,
    /// I5: a run of ≥2 adjacent sections over distinct names (a `{{#case}}` hint —
    /// measure-only, low confidence).
    CaseRun,
    /// A dynamic partial `{{>*x}}` — inadmissible (residual).
    DynamicPartial,
    /// Template inheritance `{{<parent}}` / `{{$block}}` — no direct lowering (residual).
    Inheritance,
    /// A set-delimiter directive — dropped (MaxBars has fixed delimiters).
    SetDelimiter,
}

/// A located idiom candidate.
#[derive(Debug, Clone, PartialEq)]
pub struct Site {
    /// The source span the idiom covers.
    pub span: Span,
    /// The idiom kind.
    pub idiom: Idiom,
    /// A short human detail (e.g. the section name, or the run length).
    pub detail: String,
}

/// Structural + idiom-candidate metrics for a parsed Mustache template.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Metrics {
    /// Total nodes (recursively).
    pub total_nodes: usize,
    /// Variable interpolations.
    pub variables: usize,
    /// Non-inverted sections `{{#x}}`.
    pub sections: usize,
    /// Inverted sections `{{^x}}`.
    pub inverted: usize,
    /// Partial references `{{> x}}` (static).
    pub partials: usize,
    /// Comments.
    pub comments: usize,
    /// Maximum section nesting depth.
    pub max_depth: usize,
    /// I1 complementary pairs.
    pub complementary_pairs: usize,
    /// I3 trivial-ternary candidates (a subset of the complementary pairs).
    pub trivial_ternaries: usize,
    /// I2 lone inverted sections.
    pub lone_inverteds: usize,
    /// I5 case-run lengths (one entry per detected run of ≥2).
    pub case_run_lengths: Vec<usize>,
    /// Dynamic partials (residual).
    pub dynamic_partials: usize,
    /// Inheritance constructs (residual).
    pub inheritance: usize,
    /// Set-delimiter directives (dropped).
    pub set_delimiters: usize,
    /// The located candidates, in source order.
    pub sites: Vec<Site>,
}

impl Metrics {
    /// Total residual (needs-a-human) candidates.
    #[must_use]
    pub fn residuals(&self) -> usize {
        self.dynamic_partials + self.inheritance
    }
}

/// Compute idiom metrics for a parsed Mustache template.
#[must_use]
pub fn mustache(nodes: &[Node]) -> Metrics {
    let mut m = Metrics::default();
    walk(nodes, 1, &mut m);
    m
}

/// Recurse a node list at `depth`, accumulating counts and detecting sibling-level
/// idioms (which only exist within one list).
fn walk(nodes: &[Node], depth: usize, m: &mut Metrics) {
    m.max_depth = m.max_depth.max(depth);
    detect_complementary(nodes, m);
    detect_case_run(nodes, m);

    let mut i = 0;
    while i < nodes.len() {
        let n = &nodes[i];
        m.total_nodes += 1;
        match n {
            Node::Text { .. } => {}
            Node::Variable { .. } => m.variables += 1,
            Node::Comment { .. } => m.comments += 1,
            Node::SetDelimiter { span, .. } => {
                m.set_delimiters += 1;
                m.sites.push(Site {
                    span: *span,
                    idiom: Idiom::SetDelimiter,
                    detail: "set-delimiter dropped".to_string(),
                });
            }
            Node::Partial {
                span,
                name,
                dynamic,
                ..
            } => {
                if *dynamic {
                    m.dynamic_partials += 1;
                    m.sites.push(Site {
                        span: *span,
                        idiom: Idiom::DynamicPartial,
                        detail: name.clone(),
                    });
                } else {
                    m.partials += 1;
                }
            }
            Node::Section {
                name,
                inverted,
                body,
                ..
            } => {
                // Complementary pairing and lone-inverse counting are done per sibling
                // list in `detect_complementary`; here we only tally and recurse.
                let _ = name;
                if *inverted {
                    m.inverted += 1;
                } else {
                    m.sections += 1;
                }
                walk(body, depth + 1, m);
            }
            Node::Parent { span, body, .. } => {
                m.inheritance += 1;
                m.sites.push(Site {
                    span: *span,
                    idiom: Idiom::Inheritance,
                    detail: "parent".to_string(),
                });
                walk(body, depth + 1, m);
            }
            Node::Block { span, body, .. } => {
                m.inheritance += 1;
                m.sites.push(Site {
                    span: *span,
                    idiom: Idiom::Inheritance,
                    detail: "block".to_string(),
                });
                walk(body, depth + 1, m);
            }
        }
        i += 1;
    }
}

/// The dotted key of a name (`.` for the implicit iterator), for sibling matching.
fn name_key(name: &Name) -> String {
    match name {
        Name::Implicit => ".".to_string(),
        Name::Dotted(segs) => segs.join("."),
    }
}

/// Whether the list holds a section of `key` with the given `inverted` polarity.
fn has_sibling_section(nodes: &[Node], name: &Name, inverted: bool) -> bool {
    let key = name_key(name);
    nodes.iter().any(|n| match n {
        Node::Section {
            name: n2,
            inverted: inv2,
            ..
        } => *inv2 == inverted && name_key(n2) == key,
        _ => false,
    })
}

/// Whether a section body is a single literal/variable (so it can be a ternary arm).
fn trivial_body(body: &[Node]) -> bool {
    matches!(body.len(), 1) && matches!(&body[0], Node::Text { .. } | Node::Variable { .. })
}

/// Detect I1 complementary pairs (and the I3 trivial-ternary subset, and I2 lone
/// inverteds) within one sibling list. A pair is a section and the next non-blank
/// sibling being its same-name opposite-polarity twin.
fn detect_complementary(nodes: &[Node], m: &mut Metrics) {
    let mut paired = vec![false; nodes.len()];
    for i in 0..nodes.len() {
        let Node::Section {
            span,
            name,
            inverted,
            body,
        } = &nodes[i]
        else {
            continue;
        };
        if paired[i] {
            continue;
        }
        let Some(j) = next_section(nodes, i) else {
            continue;
        };
        let Node::Section {
            span: span2,
            name: name2,
            inverted: inv2,
            body: body2,
        } = &nodes[j]
        else {
            continue;
        };
        if name_key(name) == name_key(name2) && *inverted != *inv2 {
            paired[i] = true;
            paired[j] = true;
            m.complementary_pairs += 1;
            let cover = Span::new(span.start.min(span2.start), span.end.max(span2.end));
            m.sites.push(Site {
                span: cover,
                idiom: Idiom::ComplementaryIf,
                detail: name_key(name),
            });
            if trivial_body(body) && trivial_body(body2) {
                m.trivial_ternaries += 1;
                m.sites.push(Site {
                    span: cover,
                    idiom: Idiom::TrivialTernary,
                    detail: name_key(name),
                });
            }
        }
    }
    // Lone inverted = an inverted section with no same-name non-inverted sibling.
    for n in nodes {
        if let Node::Section {
            span,
            name,
            inverted: true,
            ..
        } = n
            && !has_sibling_section(nodes, name, false)
        {
            m.lone_inverteds += 1;
            m.sites.push(Site {
                span: *span,
                idiom: Idiom::LoneUnless,
                detail: name_key(name),
            });
        }
    }
}

/// The index of the next section sibling after `i`, skipping only blank-text nodes
/// (so layout whitespace between the pair is tolerated).
fn next_section(nodes: &[Node], i: usize) -> Option<usize> {
    let mut j = i + 1;
    while j < nodes.len() {
        match &nodes[j] {
            Node::Text { text, .. } if text.trim().is_empty() => j += 1,
            Node::Section { .. } => return Some(j),
            _ => return None,
        }
    }
    None
}

/// Detect I5 case-run candidates: a maximal run of ≥2 adjacent non-inverted sections
/// over *distinct* names (blank text tolerated). Measure-only.
fn detect_case_run(nodes: &[Node], m: &mut Metrics) {
    let mut run: Vec<String> = Vec::new();
    let mut run_span: Option<Span> = None;
    let flush = |run: &mut Vec<String>, run_span: &mut Option<Span>, m: &mut Metrics| {
        if run.len() >= 2
            && let Some(sp) = run_span
        {
            m.case_run_lengths.push(run.len());
            m.sites.push(Site {
                span: *sp,
                idiom: Idiom::CaseRun,
                detail: run.join(","),
            });
        }
        run.clear();
        *run_span = None;
    };
    for n in nodes {
        match n {
            Node::Text { text, .. } if text.trim().is_empty() => {}
            Node::Section {
                span,
                name,
                inverted: false,
                ..
            } => {
                let key = name_key(name);
                if run.contains(&key) {
                    flush(&mut run, &mut run_span, m);
                }
                run.push(key);
                run_span = Some(match run_span {
                    Some(sp) => Span::new(sp.start, span.end),
                    None => *span,
                });
            }
            _ => flush(&mut run, &mut run_span, m),
        }
    }
    flush(&mut run, &mut run_span, m);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mustache::parse;

    fn m(src: &str) -> Metrics {
        mustache(&parse(src).expect("parse"))
    }

    #[test]
    fn counts_basics_and_depth() {
        let met = m("{{a}}{{#b}}{{c}}{{#d}}{{e}}{{/d}}{{/b}}");
        assert_eq!(met.variables, 3);
        assert_eq!(met.sections, 2);
        assert_eq!(met.max_depth, 3);
    }

    #[test]
    fn complementary_pair_either_order() {
        let f = m("{{#ok}}Y{{/ok}}{{^ok}}N{{/ok}}");
        assert_eq!(f.complementary_pairs, 1);
        assert_eq!(f.lone_inverteds, 0);
        let r = m("{{^ok}}N{{/ok}}{{#ok}}Y{{/ok}}");
        assert_eq!(r.complementary_pairs, 1);
    }

    #[test]
    fn complementary_tolerates_blank_text() {
        let f = m("{{#ok}}Y{{/ok}}\n  {{^ok}}N{{/ok}}");
        assert_eq!(f.complementary_pairs, 1);
    }

    #[test]
    fn non_blank_between_breaks_the_pair() {
        let f = m("{{#ok}}Y{{/ok}}x{{^ok}}N{{/ok}}");
        assert_eq!(f.complementary_pairs, 0);
        // The inverse is now lone (no adjacency), but its non-inverted twin exists, so
        // it is not counted lone either — it is just an unpaired pair candidate.
        assert_eq!(f.lone_inverteds, 0);
    }

    #[test]
    fn trivial_ternary_is_a_subset() {
        let triv = m("{{#ok}}{{yes}}{{/ok}}{{^ok}}no{{/ok}}");
        assert_eq!(triv.complementary_pairs, 1);
        assert_eq!(triv.trivial_ternaries, 1);
        let rich = m("{{#ok}}a{{b}}{{/ok}}{{^ok}}n{{/ok}}");
        assert_eq!(rich.complementary_pairs, 1);
        assert_eq!(rich.trivial_ternaries, 0); // first arm has 2 nodes
    }

    #[test]
    fn lone_inverse() {
        let f = m("{{^empty}}nothing{{/empty}}");
        assert_eq!(f.lone_inverteds, 1);
        assert_eq!(f.complementary_pairs, 0);
    }

    #[test]
    fn case_run_distinct_names() {
        let f = m("{{#a}}A{{/a}}{{#b}}B{{/b}}{{#c}}C{{/c}}");
        assert_eq!(f.case_run_lengths, vec![3]);
    }

    #[test]
    fn residuals_dynamic_partial_and_inheritance_and_setdelim() {
        let f = m("{{>*dyn}}{{<base}}{{$x}}d{{/x}}{{/base}}{{=<% %>=}}");
        assert_eq!(f.dynamic_partials, 1);
        assert_eq!(f.inheritance, 2); // parent + block
        assert_eq!(f.set_delimiters, 1);
        assert_eq!(f.residuals(), 3);
    }
}
