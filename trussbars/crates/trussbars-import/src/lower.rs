//! **Lower** a parsed Mustache template to the Trussbars IR ([`trussbars_template::ast`]),
//! applying idiomatic collapses driven by the [`crate::metrics`] catalogue and recording
//! a migration report (`docs/15`).
//!
//! Applied by default: **I1** complementary `{{#x}}A{{/x}}{{^x}}B{{/x}}` →
//! `{{#if x}}A{{else}}B{{/if}}`; **I2** lone `{{^x}}` → `{{#unless x}}`; **I4** section
//! shape → `{{#each}}` / `{{#with}}` / `{{#if}}` from an optional data sample (heuristic
//! fallback: assume iteration). Gated by [`LowerOptions`]: **I3** a trivial complementary
//! pair → a `{{x ? A : B}}` ternary.
//!
//! Two annotation channels feed the inline `{{! migrate: … }}` comments and the report:
//! a span-keyed [`Notes`] map for caveats on an emitted node (shape guess, truthiness),
//! and `Node::Text`-injected comments for *dropped* constructs (dynamic partials,
//! inheritance, set-delimiters) that have no IR node. Mustache comments are preserved as
//! injected `{{! … }}` surface comments (the IR has no comment node).

use crate::Span;
use crate::lift::Notes;
use crate::mustache::{Name, Node as M};
use trussbars_template::ast as ir;

/// The runtime shape of a value at a path — used to disambiguate a Mustache section.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    /// A list → `{{#each}}`.
    Array,
    /// An object → `{{#with}}` (re-root).
    Object,
    /// A scalar (bool/number/string/null) → `{{#if}}`.
    Scalar,
    /// Unknown (no sample / not found) → heuristic.
    Unknown,
}

/// A shape oracle: the runtime shape of the value at an absolute path, when known.
pub trait ShapeOracle {
    /// The shape at the dotted `path` from the data root (`[]` is the root itself).
    fn shape_at(&self, path: &[String]) -> Shape;
}

/// The trivial oracle: every path is [`Shape::Unknown`] (forces the heuristic).
pub struct NoShapes;

impl ShapeOracle for NoShapes {
    fn shape_at(&self, _path: &[String]) -> Shape {
        Shape::Unknown
    }
}

/// The severity of a migration note.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    /// An informational note (a faithful, lossless choice).
    Info,
    /// A caveat to verify (a guess, or a documented semantic delta).
    Warn,
    /// A residual — an inadmissible construct that needs a human.
    Residual,
}

/// A structured migration note for the report.
#[derive(Debug, Clone, PartialEq)]
pub struct MigrationNote {
    /// The source span the note concerns.
    pub span: Span,
    /// The severity.
    pub severity: Severity,
    /// The message.
    pub message: String,
}

/// Options that parameterise the idiomatic collapses (the metric-informed knobs).
#[derive(Debug, Clone, Default)]
pub struct LowerOptions {
    /// I3: collapse a *trivial* complementary pair (each arm a single literal/escaped
    /// variable) to a `{{x ? A : B}}` ternary instead of `{{#if}}…{{else}}`.
    pub ternary: bool,
}

/// The result of lowering: the IR, the node-attached notes (for [`crate::lift`]), and
/// the structured migration report.
#[derive(Debug, Clone)]
pub struct Lowered {
    /// The lowered IR node list.
    pub ir: Vec<ir::Node>,
    /// Node-attached inline notes, keyed by source-span start.
    pub notes: Notes,
    /// The structured migration report, in source order.
    pub report: Vec<MigrationNote>,
}

/// Lower a parsed Mustache template to the Trussbars IR + a migration report.
#[must_use]
pub fn mustache(nodes: &[M], shapes: &dyn ShapeOracle, opts: &LowerOptions) -> Lowered {
    let mut c = Lower {
        shapes,
        opts,
        notes: Notes::new(),
        report: Vec::new(),
    };
    let ir = c.nodes(nodes, &[]);
    Lowered {
        ir,
        notes: c.notes,
        report: c.report,
    }
}

struct Lower<'a> {
    shapes: &'a dyn ShapeOracle,
    opts: &'a LowerOptions,
    notes: Notes,
    report: Vec<MigrationNote>,
}

impl Lower<'_> {
    /// A node-attached note: recorded in the report *and* woven inline before the node.
    fn note(&mut self, span: Span, severity: Severity, message: String) {
        self.notes
            .entry(span.start)
            .or_default()
            .push(message.clone());
        self.report.push(MigrationNote {
            span,
            severity,
            message,
        });
    }

    /// A report-only note (for dropped constructs whose inline comment is injected as text).
    fn report_only(&mut self, span: Span, severity: Severity, message: String) {
        self.report.push(MigrationNote {
            span,
            severity,
            message,
        });
    }

    fn nodes(&mut self, ns: &[M], scope: &[String]) -> Vec<ir::Node> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < ns.len() {
            if let Some(next) = self.try_complementary(ns, i, scope, &mut out) {
                i = next;
                continue;
            }
            self.node(&ns[i], scope, &mut out);
            i += 1;
        }
        out
    }

    /// I1/I3: if `ns[i]` opens a complementary pair (its same-name opposite-polarity twin
    /// is the next non-blank sibling), emit the collapsed node and return the index past
    /// the pair; else `None`.
    fn try_complementary(
        &mut self,
        ns: &[M],
        i: usize,
        scope: &[String],
        out: &mut Vec<ir::Node>,
    ) -> Option<usize> {
        let (span_a, name_a, inv_a, body_a) = section(&ns[i])?;
        let j = next_nonblank(ns, i)?;
        let (span_b, name_b, inv_b, body_b) = section(&ns[j])?;
        if key(name_a) != key(name_b) || inv_a == inv_b {
            return None;
        }
        // Canonicalise: the non-inverted section is the `then` arm.
        let (then_body, else_body) = if inv_a {
            (body_b, body_a)
        } else {
            (body_a, body_b)
        };
        let span = Span::new(span_a.start.min(span_b.start), span_a.end.max(span_b.end));

        // Note any always-rendered whitespace between the two tags that the collapse drops.
        if dropped_between(ns, i, j) {
            self.report_only(
                span,
                Severity::Warn,
                "collapsed complementary sections; inter-tag whitespace dropped".to_string(),
            );
        }

        let cond = lower_name(name_a);

        // I3: a trivial pair becomes a ternary when enabled.
        if self.opts.ternary
            && let (Some(a), Some(b)) = (trivial_arm(then_body), trivial_arm(else_body))
        {
            self.truthiness_note(span, name_a);
            out.push(ir::Node::Output {
                span,
                expr: ir::Expr::App("ternary".into(), vec![cond, a, b]),
                raw: false,
            });
            return Some(j + 1);
        }

        // I1: `{{#if x}}then{{else}}else{{/if}}`.
        self.truthiness_note(span, name_a);
        let body = self.nodes(then_body, scope);
        let otherwise = self.nodes(else_body, scope);
        out.push(ir::Node::Cond(ir::Cond {
            span,
            negated: false,
            cond,
            body,
            elifs: Vec::new(),
            otherwise,
        }));
        Some(j + 1)
    }

    fn node(&mut self, n: &M, scope: &[String], out: &mut Vec<ir::Node>) {
        match n {
            M::Text { text, .. } => out.push(ir::Node::Text(text.clone())),
            M::Variable {
                span,
                name,
                escaped,
            } => out.push(ir::Node::Output {
                span: *span,
                expr: lower_name(name),
                raw: !escaped,
            }),
            M::Section {
                span,
                name,
                inverted,
                body,
            } => self.section(*span, name, *inverted, body, scope, out),
            M::Partial {
                span,
                name,
                dynamic,
                ..
            } => {
                if *dynamic {
                    self.report_only(
                        *span,
                        Severity::Residual,
                        format!("dynamic partial `{{{{>*{name}}}}}` is inadmissible (computed name crosses the names-static / data-dynamic boundary); supply a static partial"),
                    );
                    out.push(comment(&format!(
                        "dynamic partial >*{name} — needs a human"
                    )));
                } else {
                    out.push(ir::Node::Partial {
                        span: *span,
                        name: name.clone(),
                        ctx: None,
                    });
                }
            }
            M::Comment { text, .. } => out.push(preserved_comment(text)),
            M::SetDelimiter { span, .. } => self.report_only(
                *span,
                Severity::Info,
                "set-delimiter directive dropped (MaxBars has fixed `{{ }}` delimiters)"
                    .to_string(),
            ),
            M::Parent { span, name, .. } => {
                self.report_only(
                    *span,
                    Severity::Residual,
                    format!(
                        "Mustache inheritance `{{{{<{name}}}}}` has no direct MaxBars lowering"
                    ),
                );
                out.push(comment(&format!(
                    "inheritance parent <{name} — needs a human"
                )));
            }
            M::Block { span, name, body } => {
                self.report_only(
                    *span,
                    Severity::Residual,
                    format!("Mustache inheritance block `{{{{${name}}}}}` has no direct MaxBars lowering"),
                );
                out.push(comment(&format!(
                    "inheritance block ${name} — needs a human"
                )));
                // Keep the default body as plain content so it is not silently lost.
                let inner = self.nodes(body, scope);
                out.extend(inner);
            }
        }
    }

    fn section(
        &mut self,
        span: Span,
        name: &Name,
        inverted: bool,
        body: &[M],
        scope: &[String],
        out: &mut Vec<ir::Node>,
    ) {
        let cond = lower_name(name);
        if inverted {
            // A lone inverse → `{{#unless x}}` (a paired one is handled in try_complementary).
            self.truthiness_note(span, name);
            let body = self.nodes(body, scope);
            out.push(ir::Node::Cond(ir::Cond {
                span,
                negated: true,
                cond,
                body,
                elifs: Vec::new(),
                otherwise: Vec::new(),
            }));
            return;
        }

        let abs = abs_path(scope, name);
        let shape = match &abs {
            Some(p) => self.shapes.shape_at(p),
            None => Shape::Unknown,
        };
        let inner_scope = abs.as_deref().unwrap_or(scope);
        match shape {
            Shape::Array => {
                let body = self.nodes(body, inner_scope);
                out.push(each(span, cond, body));
            }
            Shape::Object => {
                self.truthiness_note(span, name);
                let body = self.nodes(body, inner_scope);
                out.push(ir::Node::With(ir::With {
                    span,
                    subject: cond,
                    body,
                    otherwise: Vec::new(),
                }));
            }
            Shape::Scalar => {
                self.truthiness_note(span, name);
                let body = self.nodes(body, scope);
                out.push(ir::Node::Cond(ir::Cond {
                    span,
                    negated: false,
                    cond,
                    body,
                    elifs: Vec::new(),
                    otherwise: Vec::new(),
                }));
            }
            Shape::Unknown => {
                self.note(
                    span,
                    Severity::Warn,
                    format!(
                        "assumed iteration for `{}` (no data sample); if it is a boolean use `{{{{#if}}}}`, if a single object use `{{{{#with}}}}`",
                        key(name)
                    ),
                );
                let body = self.nodes(body, inner_scope);
                out.push(each(span, cond, body));
            }
        }
    }

    /// Attach the truthiness-delta caveat to a boolean/scope use of `name`.
    fn truthiness_note(&mut self, span: Span, name: &Name) {
        self.note(
            span,
            Severity::Warn,
            format!(
                "truthiness of `{}` differs: Mustache treats 0/\"\"/{{}} as truthy, MaxBars `nonEmpty` treats \"\"/[]/{{}} as falsy — verify",
                key(name)
            ),
        );
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SectionRef<'a> = (Span, &'a Name, bool, &'a [M]);

/// Destructure a section node.
fn section(n: &M) -> Option<SectionRef<'_>> {
    match n {
        M::Section {
            span,
            name,
            inverted,
            body,
        } => Some((*span, name, *inverted, body)),
        _ => None,
    }
}

/// The next non-blank sibling index after `i` *if it is a section* (blank text tolerated).
fn next_nonblank(ns: &[M], i: usize) -> Option<usize> {
    let mut j = i + 1;
    while j < ns.len() {
        match &ns[j] {
            M::Text { text, .. } if text.trim().is_empty() => j += 1,
            M::Section { .. } => return Some(j),
            _ => return None,
        }
    }
    None
}

/// Whether any (blank) text sits between the sections at `i` and `j`.
fn dropped_between(ns: &[M], i: usize, j: usize) -> bool {
    ns[i + 1..j]
        .iter()
        .any(|n| matches!(n, M::Text { text, .. } if !text.is_empty()))
}

/// The dotted key of a name (`.` for the implicit iterator).
fn key(name: &Name) -> String {
    match name {
        Name::Implicit => ".".to_string(),
        Name::Dotted(segs) => segs.join("."),
    }
}

/// The absolute path of a section name from the current scope (`None` for the implicit
/// iterator, which cannot be resolved against a sample).
fn abs_path(scope: &[String], name: &Name) -> Option<Vec<String>> {
    match name {
        Name::Implicit => None,
        Name::Dotted(segs) => {
            let mut p = scope.to_vec();
            p.extend(segs.iter().cloned());
            Some(p)
        }
    }
}

/// Lower a Mustache name to a `this`-rooted IR expression (the runtime re-roots `this`
/// inside `{{#each}}` / `{{#with}}`, so bare names resolve against the element/object).
fn lower_name(name: &Name) -> ir::Expr {
    match name {
        Name::Implicit => ir::Expr::nullary("this"),
        Name::Dotted(segs) => {
            let mut args = vec![ir::Expr::nullary("this")];
            args.extend(segs.iter().map(|s| ir::Expr::str(s)));
            ir::Expr::App("lookup".into(), args)
        }
    }
}

/// A ternary arm if `body` is a single literal/escaped-variable; else `None`.
fn trivial_arm(body: &[M]) -> Option<ir::Expr> {
    match body {
        [M::Text { text, .. }] => Some(ir::Expr::str(text)),
        [
            M::Variable {
                name,
                escaped: true,
                ..
            },
        ] => Some(lower_name(name)),
        _ => None,
    }
}

/// A bare `{{#each subject}}` (re-roots `this`), no binding.
fn each(span: Span, subject: ir::Expr, body: Vec<ir::Node>) -> ir::Node {
    ir::Node::Each(ir::Each {
        span,
        subject,
        item: None,
        index: None,
        label: None,
        body,
        otherwise: Vec::new(),
    })
}

/// An injected migration comment as literal `.truss` surface (`{{! migrate: … }}`).
fn comment(msg: &str) -> ir::Node {
    ir::Node::Text(format!("{{{{! migrate: {} }}}}", sanitize(msg)))
}

/// A preserved Mustache comment, re-emitted as a `.truss` comment.
fn preserved_comment(text: &str) -> ir::Node {
    ir::Node::Text(format!("{{{{!{}}}}}", sanitize(text)))
}

/// Neutralise any `}}` in injected comment text so it cannot close the comment early.
fn sanitize(s: &str) -> String {
    s.replace("}}", "} }")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lift::to_truss_annotated;
    use crate::mustache::parse;
    use std::collections::HashMap;

    struct MapShapes(HashMap<Vec<String>, Shape>);
    impl ShapeOracle for MapShapes {
        fn shape_at(&self, path: &[String]) -> Shape {
            self.0.get(path).copied().unwrap_or(Shape::Unknown)
        }
    }
    fn shapes(pairs: &[(&[&str], Shape)]) -> MapShapes {
        MapShapes(
            pairs
                .iter()
                .map(|(p, s)| (p.iter().map(|x| (*x).to_string()).collect(), *s))
                .collect(),
        )
    }

    fn low(src: &str, oracle: &dyn ShapeOracle, opts: &LowerOptions) -> Lowered {
        mustache(&parse(src).expect("parse"), oracle, opts)
    }
    /// Lower and render to `.truss` (with inline notes) for end-to-end assertions.
    fn truss(src: &str, oracle: &dyn ShapeOracle, opts: &LowerOptions) -> String {
        let l = low(src, oracle, opts);
        to_truss_annotated(&l.ir, &l.notes)
    }

    #[test]
    fn variable_and_raw() {
        let l = low("{{a}}{{{b}}}", &NoShapes, &LowerOptions::default());
        assert!(matches!(&l.ir[0], ir::Node::Output { raw: false, .. }));
        assert!(matches!(&l.ir[1], ir::Node::Output { raw: true, .. }));
    }

    #[test]
    fn complementary_collapses_to_if_else() {
        let l = low(
            "{{#ok}}Y{{/ok}}{{^ok}}N{{/ok}}",
            &NoShapes,
            &LowerOptions::default(),
        );
        assert_eq!(l.ir.len(), 1);
        let ir::Node::Cond(c) = &l.ir[0] else {
            panic!("{:?}", l.ir)
        };
        assert!(!c.negated);
        assert_eq!(c.body.len(), 1);
        assert_eq!(c.otherwise.len(), 1);
    }

    #[test]
    fn complementary_reversed_order_canonicalises() {
        // `{{^ok}}N{{/ok}}{{#ok}}Y{{/ok}}` → `{{#if ok}}Y{{else}}N{{/if}}`.
        let s = truss(
            "{{^ok}}N{{/ok}}{{#ok}}Y{{/ok}}",
            &NoShapes,
            &LowerOptions::default(),
        );
        assert!(s.contains("{{#if ok}}Y{{else}}N{{/if}}"), "{s}");
    }

    #[test]
    fn trivial_pair_becomes_ternary_when_enabled() {
        // The ternary IR is emitted here; its idiomatic `?:` rendering is the Lift's job.
        let opts = LowerOptions { ternary: true };
        let l = low("{{#ok}}{{yes}}{{/ok}}{{^ok}}no{{/ok}}", &NoShapes, &opts);
        assert!(matches!(
            &l.ir[0],
            ir::Node::Output { expr: ir::Expr::App(h, args), .. } if h == "ternary" && args.len() == 3
        ));
    }

    #[test]
    fn trivial_pair_stays_if_else_without_option() {
        let l = low(
            "{{#ok}}{{yes}}{{/ok}}{{^ok}}no{{/ok}}",
            &NoShapes,
            &LowerOptions::default(),
        );
        assert!(matches!(&l.ir[0], ir::Node::Cond(_)));
    }

    #[test]
    fn lone_inverse_becomes_unless() {
        let s = truss(
            "{{^empty}}none{{/empty}}",
            &NoShapes,
            &LowerOptions::default(),
        );
        assert!(s.contains("{{#unless empty}}none{{/unless}}"), "{s}");
    }

    #[test]
    fn section_shape_from_sample() {
        let arr = shapes(&[(&["items"], Shape::Array)]);
        assert!(matches!(
            &low(
                "{{#items}}{{name}}{{/items}}",
                &arr,
                &LowerOptions::default()
            )
            .ir[0],
            ir::Node::Each(_)
        ));
        let obj = shapes(&[(&["user"], Shape::Object)]);
        assert!(matches!(
            &low("{{#user}}{{name}}{{/user}}", &obj, &LowerOptions::default()).ir[0],
            ir::Node::With(_)
        ));
        let sca = shapes(&[(&["ok"], Shape::Scalar)]);
        assert!(matches!(
            &low("{{#ok}}y{{/ok}}", &sca, &LowerOptions::default()).ir[0],
            ir::Node::Cond(_)
        ));
    }

    #[test]
    fn nested_scope_resolves_against_sample() {
        let oracle = shapes(&[
            (&["items"], Shape::Array),
            (&["items", "tags"], Shape::Array),
        ]);
        let l = low(
            "{{#items}}{{#tags}}{{.}}{{/tags}}{{/items}}",
            &oracle,
            &LowerOptions::default(),
        );
        let ir::Node::Each(outer) = &l.ir[0] else {
            panic!("{:?}", l.ir)
        };
        assert!(matches!(&outer.body[0], ir::Node::Each(_)));
    }

    #[test]
    fn unknown_section_defaults_to_each_with_note() {
        let l = low("{{#xs}}{{.}}{{/xs}}", &NoShapes, &LowerOptions::default());
        assert!(matches!(&l.ir[0], ir::Node::Each(_)));
        assert!(
            l.report
                .iter()
                .any(|n| n.severity == Severity::Warn && n.message.contains("assumed iteration"))
        );
    }

    #[test]
    fn dynamic_partial_is_a_residual_comment() {
        let l = low("{{>*dyn}}", &NoShapes, &LowerOptions::default());
        assert!(matches!(&l.ir[0], ir::Node::Text(t) if t.contains("{{! migrate:")));
        assert!(l.report.iter().any(|n| n.severity == Severity::Residual));
    }

    #[test]
    fn comment_is_preserved() {
        let s = truss("{{! hi }}x", &NoShapes, &LowerOptions::default());
        assert!(s.starts_with("{{! hi }}"), "{s}");
    }

    #[test]
    fn set_delimiter_dropped_and_reported() {
        let l = low("{{=<% %>=}}<%x%>", &NoShapes, &LowerOptions::default());
        // No node for the directive; the variable after it still lowers.
        assert!(matches!(&l.ir[0], ir::Node::Output { .. }));
        assert!(l.report.iter().any(|n| n.message.contains("set-delimiter")));
    }

    #[test]
    fn truthiness_note_on_conditional() {
        let sca = shapes(&[(&["ok"], Shape::Scalar)]);
        let l = low("{{#ok}}y{{/ok}}", &sca, &LowerOptions::default());
        assert!(l.report.iter().any(|n| n.message.contains("truthiness")));
    }
}
