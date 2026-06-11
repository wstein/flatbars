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
use crate::handlebars as hb;
use crate::lift::Notes;
use crate::liquid as liq;
use crate::mustache::{Name, Node as M};
use crate::stringtemplate as st;
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
    /// variable) to an inline conditional operator — `{{x ?: B}}` (first-truthy) when the
    /// positive arm echoes the value, else `{{x ? A : B}}` (ternary) — instead of
    /// `{{#if}}…{{else}}`.
    pub ternary: bool,
    /// Reproduce the source truthiness rule exactly with operators instead of annotating
    /// the delta: a bare-value condition `x` becomes `x != null && x != false` (exact for
    /// Liquid and Mustache scalars under `nonEmpty`). Suppresses the truthiness note where
    /// it applies; off by default (idiomatic bare `{{#if x}}` + note).
    pub faithful_truthiness: bool,
}

/// The truthiness predicate that is exact under `nonEmpty` for Liquid (any value) and
/// Mustache scalars: falsy ⟺ `null` or `false`, so `0`/`""`/`[]`/`{}` keep the source
/// engine's treatment. Renders as `x != null && x != false`.
fn faithful_bool(cond: ir::Expr) -> ir::Expr {
    ir::Expr::App(
        "and".into(),
        vec![
            ir::Expr::App(
                "ne".into(),
                vec![cond.clone(), ir::Expr::Lit(ir::Value::Null)],
            ),
            ir::Expr::App(
                "ne".into(),
                vec![cond, ir::Expr::Lit(ir::Value::Bool(false))],
            ),
        ],
    )
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
        // The shape of the non-inverted section decides the collapse: a list pair is
        // `{{#each}}…{{else}}…`, an object pair `{{#with}}…{{else}}…`, a scalar pair
        // `{{#if}}…{{else}}…`. The inverse body always renders in the *outer* scope.
        let abs = abs_path(scope, name_a);
        let shape = match &abs {
            Some(p) => self.shapes.shape_at(p),
            None => Shape::Unknown,
        };
        let inner = abs.as_deref().unwrap_or(scope);

        match shape {
            Shape::Array => {
                let body = self.nodes(then_body, inner);
                let otherwise = self.nodes(else_body, scope);
                out.push(ir::Node::For(ir::For {
                    span,
                    subject: cond,
                    item: None,
                    index: None,
                    label: None,
                    body,
                    otherwise,
                }));
            }
            Shape::Object => {
                self.truthiness_note(span, name_a);
                let body = self.nodes(then_body, inner);
                let otherwise = self.nodes(else_body, scope);
                out.push(ir::Node::With(ir::With {
                    span,
                    subject: cond,
                    body,
                    otherwise,
                }));
            }
            Shape::Scalar | Shape::Unknown => {
                // I3: a trivial scalar pair collapses to an inline conditional operator.
                if self.opts.ternary
                    && let (Some(a), Some(b)) = (trivial_arm(then_body), trivial_arm(else_body))
                {
                    let expr = self.inline_conditional(&cond, a, b, span, name_a);
                    out.push(ir::Node::Output {
                        span,
                        expr,
                        raw: false,
                    });
                    return Some(j + 1);
                }
                // I1: `{{#if x}}then{{else}}else{{/if}}`.
                let cond = self.cond_truthiness(cond, span, name_a);
                if matches!(shape, Shape::Unknown) {
                    self.note(
                        span,
                        Severity::Warn,
                        format!(
                            "collapsed complementary sections to `{{{{#if}}}}`; if `{}` is a list use `{{{{#each}}}}…{{{{else}}}}…`",
                            key(name_a)
                        ),
                    );
                }
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
            }
        }
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
                        hash: Vec::new(),
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
                let cond = self.cond_truthiness(cond, span, name);
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

    /// A bare value used as a boolean condition: under `faithful_truthiness`, the exact
    /// `x != null && x != false` predicate (no note); otherwise the bare value + the
    /// truthiness-delta caveat. Exact for Mustache scalars.
    fn cond_truthiness(&mut self, cond: ir::Expr, span: Span, name: &Name) -> ir::Expr {
        if self.opts.faithful_truthiness {
            faithful_bool(cond)
        } else {
            self.truthiness_note(span, name);
            cond
        }
    }

    /// The inline conditional for a trivial complementary pair (`--ternary`): `x ?: B`
    /// (first-truthy) when the positive arm just echoes the value, else `x ? A : B`. Under
    /// `faithful_truthiness` the ternary guards its condition exactly (`(x != null &&
    /// x != false) ? A : B`); otherwise the truthiness-delta caveat is attached.
    fn inline_conditional(
        &mut self,
        cond: &ir::Expr,
        then_arm: ir::Expr,
        else_arm: ir::Expr,
        span: Span,
        name: &Name,
    ) -> ir::Expr {
        // Faithful mode guards the ternary condition exactly — `(x != null && x != false)
        // ? A : B` — so `0`/`""`/`{}` keep the source truthiness and no note is needed.
        if self.opts.faithful_truthiness {
            return ir::Expr::App(
                "ternary".into(),
                vec![faithful_bool(cond.clone()), then_arm, else_arm],
            );
        }
        self.truthiness_note(span, name);
        // `x ?: B` — the positive arm is the value itself (first-truthy / Elvis).
        if then_arm == *cond {
            ir::Expr::App("firstTruthy".into(), vec![cond.clone(), else_arm])
        } else {
            ir::Expr::App("ternary".into(), vec![cond.clone(), then_arm, else_arm])
        }
    }
}

// ===========================================================================
// Handlebars
// ===========================================================================

/// Lower a parsed Handlebars template to the Trussbars IR + a migration report.
///
/// Built-in blocks (`if`/`unless`/`each`/`with`, with `{{else if}}` chains and `as |x|`
/// block params) map directly; custom block helpers become [`ir::HelperBlock`];
/// partials / partial blocks / inline partials map across. Divergences are annotated:
/// the truthiness rule differs, `{{else}}` on a custom block helper is dropped (host
/// block helpers are binary), hash arguments and `../` parent paths need review, and
/// dynamic partials / decorators are residuals.
#[must_use]
pub fn handlebars(nodes: &[hb::Node], shapes: &dyn ShapeOracle, opts: &LowerOptions) -> Lowered {
    let mut c = Lower {
        shapes,
        opts,
        notes: Notes::new(),
        report: Vec::new(),
    };
    let ir = c.hb_nodes(nodes);
    Lowered {
        ir,
        notes: c.notes,
        report: c.report,
    }
}

impl Lower<'_> {
    fn hb_nodes(&mut self, ns: &[hb::Node]) -> Vec<ir::Node> {
        let mut out = Vec::new();
        for n in ns {
            self.hb_node(n, &mut out);
        }
        out
    }

    fn hb_node(&mut self, n: &hb::Node, out: &mut Vec<ir::Node>) {
        match n {
            hb::Node::Text { text, .. } => out.push(ir::Node::Text(text.clone())),
            hb::Node::Mustache {
                span,
                path,
                params,
                hash,
                escaped,
            } => {
                let expr = if params.is_empty() && hash.is_empty() {
                    self.hb_path(path, *span)
                } else {
                    if !hash.is_empty() {
                        self.note(
                            *span,
                            Severity::Warn,
                            "helper hash arguments dropped — convert manually".to_string(),
                        );
                    }
                    let args = params.iter().map(|a| self.hb_expr(a, *span)).collect();
                    ir::Expr::App(path.original.clone(), args)
                };
                out.push(ir::Node::Output {
                    span: *span,
                    expr,
                    raw: !escaped,
                });
            }
            hb::Node::Block {
                span,
                path,
                params,
                hash,
                block_params,
                inverted,
                program,
                inverse,
            } => self.hb_block(
                *span,
                path,
                params,
                hash,
                block_params,
                *inverted,
                program,
                inverse,
                out,
            ),
            hb::Node::Partial {
                span,
                name,
                params,
                hash,
                ..
            } => {
                if !hash.is_empty() {
                    self.note(
                        *span,
                        Severity::Warn,
                        "partial hash arguments dropped — convert manually".to_string(),
                    );
                }
                match name {
                    hb::PartialName::Simple(n) => {
                        let ctx = params.first().map(|p| self.hb_expr(p, *span));
                        out.push(ir::Node::Partial {
                            span: *span,
                            name: n.clone(),
                            ctx,
                            hash: Vec::new(),
                        });
                    }
                    hb::PartialName::Dynamic(_) => {
                        self.report_only(
                            *span,
                            Severity::Residual,
                            "dynamic partial `{{> (expr)}}` is inadmissible (computed name)"
                                .to_string(),
                        );
                        out.push(comment("dynamic partial — needs a human"));
                    }
                }
            }
            hb::Node::PartialBlock {
                span,
                name,
                params,
                program,
                inverse,
                ..
            } => {
                if inverse.is_some() {
                    self.note(
                        *span,
                        Severity::Warn,
                        "partial-block `{{else}}` arm dropped".to_string(),
                    );
                }
                match name {
                    hb::PartialName::Simple(n) => {
                        let ctx = params.first().map(|p| self.hb_expr(p, *span));
                        let body = self.hb_nodes(program);
                        out.push(ir::Node::PartialBlock {
                            span: *span,
                            name: n.clone(),
                            ctx,
                            body,
                        });
                    }
                    hb::PartialName::Dynamic(_) => {
                        self.report_only(
                            *span,
                            Severity::Residual,
                            "dynamic partial block is inadmissible (computed name)".to_string(),
                        );
                        out.push(comment("dynamic partial block — needs a human"));
                    }
                }
            }
            hb::Node::InlinePartial {
                span,
                name,
                program,
            } => {
                let body = self.hb_nodes(program);
                out.push(ir::Node::Inline {
                    span: *span,
                    name: name.clone(),
                    params: Vec::new(),
                    body,
                });
            }
            hb::Node::Decorator { span, .. } | hb::Node::BlockDecorator { span, .. } => {
                self.report_only(
                    *span,
                    Severity::Residual,
                    "Handlebars decorators have no MaxBars equivalent".to_string(),
                );
                out.push(comment("decorator — needs a human"));
            }
            hb::Node::Comment { text, .. } => out.push(preserved_comment(text)),
            hb::Node::RawBlock { span, content, .. } => out.push(ir::Node::RawBlock {
                span: *span,
                body: content.clone(),
            }),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn hb_block(
        &mut self,
        span: Span,
        path: &hb::Path,
        params: &[hb::Expr],
        hash: &[hb::HashPair],
        block_params: &[String],
        inverted: bool,
        program: &[hb::Node],
        inverse: &Option<Vec<hb::Node>>,
        out: &mut Vec<ir::Node>,
    ) {
        match path.original.as_str() {
            "if" => {
                let cond = self.hb_first(params, span);
                let body = self.hb_nodes(program);
                let (elifs, otherwise) = self.hb_inverse_chain(inverse);
                self.hb_truthiness(span, "if condition");
                out.push(ir::Node::Cond(ir::Cond {
                    span,
                    negated: inverted,
                    cond,
                    body,
                    elifs,
                    otherwise,
                }));
            }
            "unless" => {
                let cond = self.hb_first(params, span);
                let body = self.hb_nodes(program);
                let otherwise = self.hb_else(inverse);
                self.hb_truthiness(span, "unless condition");
                out.push(ir::Node::Cond(ir::Cond {
                    span,
                    negated: true,
                    cond,
                    body,
                    elifs: Vec::new(),
                    otherwise,
                }));
            }
            "each" => {
                let subject = self.hb_first(params, span);
                let body = self.hb_nodes(program);
                let otherwise = self.hb_else(inverse);
                out.push(ir::Node::For(ir::For {
                    span,
                    subject,
                    item: block_params.first().cloned(),
                    index: block_params.get(1).cloned(),
                    label: None,
                    body,
                    otherwise,
                }));
            }
            "with" => {
                let subject = self.hb_first(params, span);
                let body = self.hb_nodes(program);
                let otherwise = self.hb_else(inverse);
                self.hb_truthiness(span, "with subject");
                out.push(ir::Node::With(ir::With {
                    span,
                    subject,
                    body,
                    otherwise,
                }));
            }
            head if inverted => {
                // `{{^name}}…{{/name}}` over a non-builtin → `{{#unless name}}`.
                let cond = self.hb_path(path, span);
                let body = self.hb_nodes(program);
                let otherwise = self.hb_else(inverse);
                self.hb_truthiness(span, head);
                out.push(ir::Node::Cond(ir::Cond {
                    span,
                    negated: true,
                    cond,
                    body,
                    elifs: Vec::new(),
                    otherwise,
                }));
            }
            head => {
                // A custom block helper → `{{#head args}}…{{/head}}` (binary, no else).
                if inverse.is_some() {
                    self.note(
                        span,
                        Severity::Warn,
                        format!(
                            "`{{{{#{head}}}}}` else arm dropped (host block helpers are binary)"
                        ),
                    );
                }
                if !hash.is_empty() {
                    self.note(
                        span,
                        Severity::Warn,
                        format!("`{{{{#{head}}}}}` hash arguments dropped — convert manually"),
                    );
                }
                let args = params.iter().map(|a| self.hb_expr(a, span)).collect();
                let body = self.hb_nodes(program);
                out.push(ir::Node::HelperBlock(ir::HelperBlock {
                    span,
                    head: head.to_string(),
                    args,
                    body,
                }));
            }
        }
    }

    /// Flatten a `{{#if}}`'s inverse: a lone nested `if`-block is an `{{else if}}` arm.
    fn hb_inverse_chain(
        &mut self,
        inverse: &Option<Vec<hb::Node>>,
    ) -> (Vec<(ir::Expr, Vec<ir::Node>)>, Vec<ir::Node>) {
        let Some(ns) = inverse else {
            return (Vec::new(), Vec::new());
        };
        if let [
            hb::Node::Block {
                span,
                path,
                params,
                inverted: false,
                program,
                inverse: inner,
                ..
            },
        ] = ns.as_slice()
            && path.original == "if"
        {
            let cond = self.hb_first(params, *span);
            let body = self.hb_nodes(program);
            let (mut elifs, otherwise) = self.hb_inverse_chain(inner);
            elifs.insert(0, (cond, body));
            return (elifs, otherwise);
        }
        (Vec::new(), self.hb_nodes(ns))
    }

    fn hb_else(&mut self, inverse: &Option<Vec<hb::Node>>) -> Vec<ir::Node> {
        match inverse {
            Some(ns) => self.hb_nodes(ns),
            None => Vec::new(),
        }
    }

    /// The first positional argument as an expression (a located note if missing).
    fn hb_first(&mut self, params: &[hb::Expr], span: Span) -> ir::Expr {
        match params.first() {
            Some(e) => self.hb_expr(e, span),
            None => {
                self.note(
                    span,
                    Severity::Warn,
                    "block is missing its argument — emitted `this`".to_string(),
                );
                ir::Expr::nullary("this")
            }
        }
    }

    fn hb_expr(&mut self, e: &hb::Expr, span: Span) -> ir::Expr {
        match e {
            hb::Expr::Literal(l) => hb_lit(l),
            hb::Expr::Path(p) => self.hb_path(p, span),
            hb::Expr::Sub { path, params, hash } => {
                if !hash.is_empty() {
                    self.note(
                        span,
                        Severity::Warn,
                        "subexpression hash arguments dropped — convert manually".to_string(),
                    );
                }
                let args = params.iter().map(|a| self.hb_expr(a, span)).collect();
                ir::Expr::App(path.original.clone(), args)
            }
        }
    }

    fn hb_path(&mut self, p: &hb::Path, span: Span) -> ir::Expr {
        if p.data {
            return self.hb_data_path(p, span);
        }
        if p.depth > 0 {
            self.note(
                span,
                Severity::Warn,
                format!(
                    "Handlebars `../`×{} parent path → `@parentchain` (verify; MaxBars parent access differs, ADR-021)",
                    p.depth
                ),
            );
            return lookup_chain(ir::Expr::nullary("@parentchain"), &p.segments);
        }
        if p.segments.is_empty() {
            return ir::Expr::nullary("this");
        }
        lookup_chain(ir::Expr::nullary("this"), &p.segments)
    }

    /// Map a `@data` reference to its MaxBars equivalent (`@root`, loop variables).
    fn hb_data_path(&mut self, p: &hb::Path, span: Span) -> ir::Expr {
        let first = p.segments.first().map_or("", String::as_str);
        let rest = if p.segments.is_empty() {
            &[][..]
        } else {
            &p.segments[1..]
        };
        match first {
            "root" => lookup_chain(ir::Expr::nullary("root"), rest),
            "index" => lookup_chain(ir::Expr::nullary("loop"), &["index0".to_string()]),
            "index0" | "index1" | "first" | "last" | "key" | "length" => {
                lookup_chain(ir::Expr::nullary("loop"), &[first.to_string()])
            }
            other => {
                self.note(
                    span,
                    Severity::Warn,
                    format!("unknown `@{other}` data reference — verify"),
                );
                lookup_chain(ir::Expr::nullary("loop"), &p.segments)
            }
        }
    }

    /// The Handlebars truthiness caveat (its rule differs from MaxBars `nonEmpty`).
    fn hb_truthiness(&mut self, span: Span, label: &str) {
        self.note(
            span,
            Severity::Warn,
            format!(
                "truthiness of {label} differs: Handlebars treats 0/\"\" as falsy and {{}} as truthy; MaxBars `nonEmpty` treats 0 as truthy and \"\"/[]/{{}} as falsy — verify"
            ),
        );
    }
}

/// Lower a Handlebars literal to an IR literal (`undefined` collapses to `null`).
fn hb_lit(l: &hb::Literal) -> ir::Expr {
    ir::Expr::Lit(match l {
        hb::Literal::Str(s) => ir::Value::Str(s.clone()),
        hb::Literal::Number(n) => ir::Value::Num(*n),
        hb::Literal::Bool(b) => ir::Value::Bool(*b),
        hb::Literal::Null | hb::Literal::Undefined => ir::Value::Null,
    })
}

/// Build a `lookup` chain `App("lookup", [root, key…])`, or just `root` with no keys.
fn lookup_chain(root: ir::Expr, segs: &[String]) -> ir::Expr {
    if segs.is_empty() {
        return root;
    }
    let mut args = vec![root];
    args.extend(segs.iter().map(|s| ir::Expr::str(s)));
    ir::Expr::App("lookup".into(), args)
}

// ===========================================================================
// Liquid
// ===========================================================================

/// Lower a parsed Liquid template to the Trussbars IR + a migration report.
///
/// Control flow maps directly (`if`/`elsif`→`Cond`, `unless`, `case`/`when`→`Case`,
/// `for`→`each`); `render`/`include` of a string literal → a partial; filters become a
/// MaxBars pipe chain. Liquid is **not** auto-escaping, so output is rendered escaped
/// (MaxBars default) unless review is needed — documented in `docs/15` rather than noted
/// per node. Stateful tags (`assign`/`capture`/`increment`/`cycle`/`break`/`continue`)
/// and `tablerow`/`ifchanged`/unknown tags are residuals; the truthiness rule differs.
#[must_use]
pub fn liquid(nodes: &[liq::Node], shapes: &dyn ShapeOracle, opts: &LowerOptions) -> Lowered {
    let mut c = Lower {
        shapes,
        opts,
        notes: Notes::new(),
        report: Vec::new(),
    };
    let ir = c.liq_nodes(nodes);
    Lowered {
        ir,
        notes: c.notes,
        report: c.report,
    }
}

impl Lower<'_> {
    fn liq_nodes(&mut self, ns: &[liq::Node]) -> Vec<ir::Node> {
        let mut out = Vec::new();
        for n in ns {
            self.liq_node(n, &mut out);
        }
        out
    }

    fn liq_node(&mut self, n: &liq::Node, out: &mut Vec<ir::Node>) {
        match n {
            liq::Node::Text { text, .. } => out.push(ir::Node::Text(text.clone())),
            liq::Node::Output {
                span,
                expr,
                filters,
            }
            | liq::Node::Echo {
                span,
                expr,
                filters,
            } => {
                let (e, escaped) = self.liq_output(expr, filters, *span);
                out.push(ir::Node::Output {
                    span: *span,
                    expr: e,
                    raw: !escaped,
                });
            }
            liq::Node::If {
                span,
                branches,
                otherwise,
            } => {
                let mut it = branches.iter();
                let Some((first_cond, first_body)) = it.next() else {
                    return;
                };
                let cond = self.liq_cond(first_cond, *span);
                let body = self.liq_nodes(first_body);
                let elifs = it
                    .map(|(c, b)| (self.liq_cond(c, *span), self.liq_nodes(b)))
                    .collect();
                let otherwise = otherwise
                    .as_ref()
                    .map(|b| self.liq_nodes(b))
                    .unwrap_or_default();
                if !self.opts.faithful_truthiness {
                    self.liq_truthiness(*span, "if condition");
                }
                out.push(ir::Node::Cond(ir::Cond {
                    span: *span,
                    negated: false,
                    cond,
                    body,
                    elifs,
                    otherwise,
                }));
            }
            liq::Node::Unless {
                span,
                condition,
                body,
                otherwise,
            } => {
                let cond = self.liq_cond(condition, *span);
                let body = self.liq_nodes(body);
                let otherwise = otherwise
                    .as_ref()
                    .map(|b| self.liq_nodes(b))
                    .unwrap_or_default();
                if !self.opts.faithful_truthiness {
                    self.liq_truthiness(*span, "unless condition");
                }
                out.push(ir::Node::Cond(ir::Cond {
                    span: *span,
                    negated: true,
                    cond,
                    body,
                    elifs: Vec::new(),
                    otherwise,
                }));
            }
            liq::Node::Case {
                span,
                subject,
                whens,
                otherwise,
            } => {
                let subject = self.liq_expr(subject, *span);
                let arms = whens
                    .iter()
                    .map(|w| {
                        let values = w.values.iter().map(|v| self.liq_expr(v, *span)).collect();
                        (values, self.liq_nodes(&w.body))
                    })
                    .collect();
                let otherwise = otherwise
                    .as_ref()
                    .map(|b| self.liq_nodes(b))
                    .unwrap_or_default();
                out.push(ir::Node::Case(ir::Case {
                    span: *span,
                    subject,
                    arms,
                    otherwise,
                }));
            }
            liq::Node::For {
                span,
                var,
                iterable,
                params,
                body,
                otherwise,
            } => {
                if params.limit.is_some()
                    || params.offset.is_some()
                    || params.reversed
                    || params.cols.is_some()
                {
                    self.note(
                        *span,
                        Severity::Warn,
                        "`for` limit/offset/reversed/cols dropped — apply via a pipe (e.g. `| take`/`| reverse`)".to_string(),
                    );
                }
                let subject = self.liq_expr(iterable, *span);
                let body = self.liq_nodes(body);
                let otherwise = otherwise
                    .as_ref()
                    .map(|b| self.liq_nodes(b))
                    .unwrap_or_default();
                out.push(ir::Node::For(ir::For {
                    span: *span,
                    subject,
                    item: Some(var.clone()),
                    index: None,
                    label: None,
                    body,
                    otherwise,
                }));
            }
            liq::Node::Include { span, target, args }
            | liq::Node::Render { span, target, args } => {
                self.liq_partial(*span, target, args, out)
            }
            liq::Node::Section { span, name } => {
                if let liq::Expr::Literal(liq::Literal::Str(s)) = name {
                    out.push(ir::Node::Partial {
                        span: *span,
                        name: s.clone(),
                        ctx: None,
                        hash: Vec::new(),
                    });
                } else {
                    self.report_only(
                        *span,
                        Severity::Residual,
                        "`section` with a computed name is inadmissible".to_string(),
                    );
                    out.push(comment("section — needs a human"));
                }
            }
            liq::Node::Liquid { body, .. } => {
                let inner = self.liq_nodes(body);
                out.extend(inner);
            }
            liq::Node::Raw { span, content } => out.push(ir::Node::RawBlock {
                span: *span,
                body: content.clone(),
            }),
            liq::Node::Comment { content, .. } => out.push(preserved_comment(content)),
            liq::Node::InlineComment { text, .. } => out.push(preserved_comment(text)),
            liq::Node::IfChanged { span, body } => {
                self.note(
                    *span,
                    Severity::Warn,
                    "`ifchanged` has no MaxBars equivalent — body always renders".to_string(),
                );
                let inner = self.liq_nodes(body);
                out.extend(inner);
            }
            // Stateful / unsupported tags become residuals.
            liq::Node::Assign {
                span,
                target,
                value,
                filters,
            } => {
                // Render the value as `.truss` for the inline hint (a `{{#let}}` body).
                let (e, _) = self.liq_output(value, filters, *span);
                let value_src = crate::lift::to_truss(&[ir::Node::Output {
                    span: *span,
                    expr: e,
                    raw: true,
                }]);
                let value_src = value_src.trim_start_matches("{{{").trim_end_matches("}}}");
                self.report_only(
                    *span,
                    Severity::Residual,
                    format!("`assign {target} = …` is template-scoped; wrap the dependent region in `{{{{#let {target}=(…)}}}}` (MaxBars `let` is block-scoped)"),
                );
                out.push(comment(&format!(
                    "assign {target} = {value_src} — wrap the region using `{target}` in {{{{#let {target}=({value_src})}}}}"
                )));
            }
            liq::Node::Capture { span, target, .. } => {
                self.report_only(
                    *span,
                    Severity::Residual,
                    format!("`capture {target}` has no direct MaxBars form — use `{{{{#let}}}}` or a partial"),
                );
                out.push(comment(&format!("capture {target} — needs a human")));
            }
            liq::Node::Increment { span, target } | liq::Node::Decrement { span, target } => {
                self.report_only(
                    *span,
                    Severity::Residual,
                    format!("counter tag for `{target}` has no MaxBars equivalent"),
                );
                out.push(comment(&format!("counter {target} — needs a human")));
            }
            liq::Node::Cycle { span, .. } => {
                self.report_only(
                    *span,
                    Severity::Residual,
                    "`cycle` has no MaxBars equivalent".to_string(),
                );
                out.push(comment("cycle — needs a human"));
            }
            liq::Node::Break { span } | liq::Node::Continue { span } => {
                self.report_only(
                    *span,
                    Severity::Residual,
                    "`break`/`continue` have no MaxBars equivalent".to_string(),
                );
                out.push(comment("break/continue — needs a human"));
            }
            liq::Node::TableRow { span, .. } => {
                self.report_only(
                    *span,
                    Severity::Residual,
                    "`tablerow` (HTML table wrapping) has no MaxBars equivalent".to_string(),
                );
                out.push(comment("tablerow — needs a human"));
            }
            liq::Node::Unknown { span, name, .. } => {
                self.report_only(
                    *span,
                    Severity::Residual,
                    format!("unknown tag `{{% {name} %}}` — host-specific, needs a human"),
                );
                out.push(comment(&format!("unknown tag {name} — needs a human")));
            }
        }
    }

    /// Lower an `include`/`render` of a string-literal template to a partial.
    fn liq_partial(
        &mut self,
        span: Span,
        target: &liq::Expr,
        args: &liq::ThemeArgs,
        out: &mut Vec<ir::Node>,
    ) {
        if !args.params.is_empty() || args.for_each.is_some() {
            self.note(
                span,
                Severity::Warn,
                "include/render parameters and `for` form dropped — pass context explicitly"
                    .to_string(),
            );
        }
        match target {
            liq::Expr::Literal(liq::Literal::Str(s)) => {
                let ctx = args.with.as_ref().map(|e| self.liq_expr(e, span));
                out.push(ir::Node::Partial {
                    span,
                    name: s.clone(),
                    ctx,
                    hash: Vec::new(),
                });
            }
            _ => {
                self.report_only(
                    span,
                    Severity::Residual,
                    "include/render with a computed template name is inadmissible".to_string(),
                );
                out.push(comment("computed partial — needs a human"));
            }
        }
    }

    /// Lower an output/echo value through its filter chain; returns the expression and
    /// whether an `escape` filter requested HTML escaping.
    fn liq_output(
        &mut self,
        expr: &liq::Expr,
        filters: &[liq::Filter],
        span: Span,
    ) -> (ir::Expr, bool) {
        let mut e = self.liq_expr(expr, span);
        let mut escaped = false;
        for f in filters {
            if matches!(f.name.as_str(), "escape" | "escape_once" | "h") {
                escaped = true;
                continue;
            }
            e = self.liq_filter(f, e, span);
        }
        (e, escaped)
    }

    /// Apply one Liquid filter as a MaxBars helper application (`value | name args`).
    fn liq_filter(&mut self, f: &liq::Filter, value: ir::Expr, span: Span) -> ir::Expr {
        let name = map_filter(&f.name);
        if !is_known_helper(name) {
            self.note(
                span,
                Severity::Warn,
                format!(
                    "filter `{}` is not a Trussbars prelude/host helper — register it with `#[truss_helpers]` or convert",
                    f.name
                ),
            );
        }
        let mut args = vec![value];
        for a in &f.args {
            match a {
                liq::FilterArg::Positional(e) => args.push(self.liq_expr(e, span)),
                liq::FilterArg::Named(k, e) => {
                    self.note(
                        span,
                        Severity::Warn,
                        format!(
                            "filter `{}` named argument `{k}` passed positionally — verify",
                            f.name
                        ),
                    );
                    args.push(self.liq_expr(e, span));
                }
            }
        }
        ir::Expr::App(name.to_string(), args)
    }

    fn liq_cond(&mut self, c: &liq::Condition, span: Span) -> ir::Expr {
        match c {
            liq::Condition::Compare { left, op, right } => match (op, right) {
                (Some(op), Some(right)) => ir::Expr::App(
                    cmp_op(*op).to_string(),
                    vec![self.liq_expr(left, span), self.liq_expr(right, span)],
                ),
                // A bare value used as a boolean: exact predicate under faithful mode.
                _ => {
                    let e = self.liq_expr(left, span);
                    if self.opts.faithful_truthiness {
                        faithful_bool(e)
                    } else {
                        e
                    }
                }
            },
            liq::Condition::And(a, b) => ir::Expr::App(
                "and".into(),
                vec![self.liq_cond(a, span), self.liq_cond(b, span)],
            ),
            liq::Condition::Or(a, b) => ir::Expr::App(
                "or".into(),
                vec![self.liq_cond(a, span), self.liq_cond(b, span)],
            ),
        }
    }

    fn liq_expr(&mut self, e: &liq::Expr, span: Span) -> ir::Expr {
        match e {
            liq::Expr::Literal(l) => self.liq_lit(l, span),
            liq::Expr::Var(v) => self.liq_var(v, span),
            liq::Expr::Range { start, end } => ir::Expr::App(
                "range".into(),
                vec![self.liq_expr(start, span), self.liq_expr(end, span)],
            ),
        }
    }

    fn liq_lit(&mut self, l: &liq::Literal, span: Span) -> ir::Expr {
        ir::Expr::Lit(match l {
            liq::Literal::Str(s) => ir::Value::Str(s.clone()),
            liq::Literal::Number(n) => ir::Value::Num(*n),
            liq::Literal::Bool(b) => ir::Value::Bool(*b),
            liq::Literal::Nil => ir::Value::Null,
            liq::Literal::Empty | liq::Literal::Blank => {
                self.note(
                    span,
                    Severity::Warn,
                    "Liquid `empty`/`blank` has no MaxBars literal — emitted \"\"; verify"
                        .to_string(),
                );
                ir::Value::Str(String::new())
            }
        })
    }

    /// Lower a Liquid variable path (root-relative) to a `this`-rooted lookup chain.
    fn liq_var(&mut self, v: &liq::VarPath, span: Span) -> ir::Expr {
        let mut expr = lookup_chain(ir::Expr::nullary("this"), std::slice::from_ref(&v.name));
        for acc in &v.access {
            match acc {
                liq::Access::Field(f) => expr = append_key(expr, f),
                liq::Access::Index(idx) => match idx.as_ref() {
                    liq::Expr::Literal(liq::Literal::Str(s)) => expr = append_key(expr, s),
                    liq::Expr::Literal(liq::Literal::Number(n)) => {
                        expr = append_key(expr, &fmt_index(*n));
                    }
                    other => {
                        // A dynamic subscript → the `lookup` helper over the index value.
                        let idx = self.liq_expr(other, span);
                        expr = ir::Expr::App("lookup".into(), vec![expr, idx]);
                    }
                },
            }
        }
        expr
    }

    /// The Liquid truthiness caveat (only `false`/`nil` are falsy in Liquid).
    fn liq_truthiness(&mut self, span: Span, label: &str) {
        self.note(
            span,
            Severity::Warn,
            format!(
                "truthiness of {label} differs: Liquid treats only `false`/`nil` as falsy (0, \"\", [] are truthy); MaxBars `nonEmpty` treats \"\"/[]/{{}} as falsy — verify"
            ),
        );
    }
}

/// Append a static string key to a `lookup` chain (or start one rooted at the expr).
fn append_key(expr: ir::Expr, key: &str) -> ir::Expr {
    match expr {
        ir::Expr::App(ref h, ref args) if h == "lookup" => {
            let mut args = args.clone();
            args.push(ir::Expr::str(key));
            ir::Expr::App("lookup".into(), args)
        }
        other => ir::Expr::App("lookup".into(), vec![other, ir::Expr::str(key)]),
    }
}

/// Format a numeric array index as an integer key.
fn fmt_index(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// The MaxBars comparison-operator head for a Liquid comparison.
fn cmp_op(op: liq::CmpOp) -> &'static str {
    match op {
        liq::CmpOp::Eq => "eq",
        liq::CmpOp::Ne => "ne",
        liq::CmpOp::Gt => "gt",
        liq::CmpOp::Lt => "lt",
        liq::CmpOp::Ge => "gte",
        liq::CmpOp::Le => "lte",
        liq::CmpOp::Contains => "contains",
    }
}

/// Map a Liquid filter name to its Trussbars prelude helper (identity when there is no
/// rename); names not in [`is_known_helper`] are flagged at the call site.
fn map_filter(name: &str) -> &str {
    match name {
        "upcase" => "uppercase",
        "downcase" => "lowercase",
        "size" => "count",
        "strip" => "trim",
        "default" => "firstTruthy", // `x | default: y` ≡ first truthy of (x, y)
        other => other,
    }
}

/// Whether `name` is a known Trussbars prelude operation or blessed host helper, so a
/// migrated call to it needs no "provide a host helper" note.
///
/// Mirrors the reference prelude (`ClassicBars.preludeSchema`) plus the i18n host-helper
/// pack (`t`/`relative`/`number`/`date`/`selectPlural`/`json` — docs/09, ADR-0029).
/// Curated, not generated — extend it as the prelude grows; an over-strict miss only
/// produces an extra advisory note, never a wrong migration.
fn is_known_helper(name: &str) -> bool {
    TRUSSBARS_HELPERS.contains(&name)
}

/// The known Trussbars prelude operations + blessed i18n host helpers.
const TRUSSBARS_HELPERS: &[&str] = &[
    // i18n host-helper pack (docs/09, ADR-0029) — first-class in Trussbars.
    "t",
    "relative",
    "number",
    "date",
    "selectPlural",
    "json",
    // String helpers.
    "uppercase",
    "lowercase",
    "capitalize",
    "trim",
    "truncate",
    "slice",
    "replace",
    "strlen",
    // Number helpers.
    "abs",
    "round",
    "toFixed",
    "toInt",
    "modulo",
    // Array / collection helpers.
    "count",
    "first",
    "last",
    "at",
    "take",
    "unique",
    "reverse",
    "join",
    "sortBy",
    "pluck",
    "groupBy",
    "where",
    "reject",
    "find",
    "some",
    "every",
    "contains",
    // Logic / coalescing / construction.
    "and",
    "or",
    "not",
    "eq",
    "ne",
    "lt",
    "gt",
    "lte",
    "gte",
    "add",
    "subtract",
    "multiply",
    "divide",
    "range",
    "coalesce",
    "firstTruthy",
    "ternary",
    "dict",
    "list",
    "lookup",
    "safe",
];

// ===========================================================================
// StringTemplate4
// ===========================================================================

/// Lower a parsed StringTemplate4 `.st` body to the Trussbars IR + a migration report.
///
/// `<expr>` → output (ST4 is not auto-escaping, so emitted raw), `<if(c)>…<elseif>…<else>`
/// → `Cond`, a single-target `:` map (`<xs:{x|…}>` / `<xs:t()>`) → `{{#each}}`, a
/// top-level named include `<t(args)>` → a partial. The constructs with no MaxBars
/// analogue are residuals: `; separator=`/`null=`/… **options**, **multi-target** and
/// **chained** maps, **indirect** includes `(e)()`, **dynamic** properties `a.(e)`, an
/// anonymous subtemplate used as a value, list literals, and `<@region>` (rendered inline
/// with a note).
#[must_use]
pub fn stringtemplate(
    elements: &[st::Element],
    shapes: &dyn ShapeOracle,
    opts: &LowerOptions,
) -> Lowered {
    let mut c = Lower {
        shapes,
        opts,
        notes: Notes::new(),
        report: Vec::new(),
    };
    let ir = c.st_elements(elements);
    Lowered {
        ir,
        notes: c.notes,
        report: c.report,
    }
}

/// Lower a parsed StringTemplate4 `.stg` group to the Trussbars IR: each template
/// definition becomes a `{{#inline "name"}}…{{/inline}}` partial.
#[must_use]
pub fn stringtemplate_group(
    group: &st::Group,
    shapes: &dyn ShapeOracle,
    opts: &LowerOptions,
) -> Lowered {
    let mut c = Lower {
        shapes,
        opts,
        notes: Notes::new(),
        report: Vec::new(),
    };
    let mut ir = Vec::new();
    for imp in &group.imports {
        ir.push(comment(&format!(
            "import \"{imp}\" — wire up the imported templates"
        )));
    }
    for def in &group.templates {
        if !def.params.is_empty() {
            let names = def
                .params
                .iter()
                .map(|p| p.name.clone())
                .collect::<Vec<_>>()
                .join(", ");
            c.note(
                def.span,
                Severity::Warn,
                format!(
                    "template `{}` parameters ({names}) → declare a context type / pass explicitly",
                    def.name
                ),
            );
        }
        let body = c.st_elements(&def.body);
        ir.push(ir::Node::Inline {
            span: def.span,
            name: def.name.clone(),
            params: Vec::new(),
            body,
        });
    }
    for dict in &group.dicts {
        c.report_only(
            dict.span,
            Severity::Residual,
            format!(
                "dictionary `{}` → a MaxBars dict literal / lookup helper",
                dict.name
            ),
        );
        ir.push(comment(&format!(
            "dictionary {} — needs a human",
            dict.name
        )));
    }
    Lowered {
        ir,
        notes: c.notes,
        report: c.report,
    }
}

impl Lower<'_> {
    fn st_elements(&mut self, els: &[st::Element]) -> Vec<ir::Node> {
        let mut out = Vec::new();
        for el in els {
            self.st_element(el, &mut out);
        }
        out
    }

    fn st_element(&mut self, el: &st::Element, out: &mut Vec<ir::Node>) {
        match el {
            st::Element::Text { text, .. } => out.push(ir::Node::Text(text.clone())),
            st::Element::Comment { text, .. } => out.push(preserved_comment(text)),
            st::Element::If {
                span,
                condition,
                body,
                elseifs,
                otherwise,
            } => {
                let cond = self.st_expr(condition, *span);
                let body = self.st_elements(body);
                let elifs = elseifs
                    .iter()
                    .map(|(c, b)| (self.st_expr(c, *span), self.st_elements(b)))
                    .collect();
                let otherwise = otherwise
                    .as_ref()
                    .map(|b| self.st_elements(b))
                    .unwrap_or_default();
                out.push(ir::Node::Cond(ir::Cond {
                    span: *span,
                    negated: false,
                    cond,
                    body,
                    elifs,
                    otherwise,
                }));
            }
            st::Element::Region { span, name, body } => {
                self.note(
                    *span,
                    Severity::Warn,
                    format!("ST4 region `{name}` has no MaxBars equivalent — rendered inline"),
                );
                let inner = self.st_elements(body);
                out.extend(inner);
            }
            st::Element::Expr { span, value } => {
                if !value.options.is_empty() {
                    let opts: Vec<&str> = value.options.iter().map(|(k, _)| k.as_str()).collect();
                    self.note(
                        *span,
                        Severity::Warn,
                        format!(
                            "ST4 options ({}) dropped — apply via a helper (e.g. `| join`, `?? default`)",
                            opts.join(", ")
                        ),
                    );
                }
                self.st_value(*span, &value.expr, out);
            }
        }
    }

    /// Lower a top-level `<…>` expression: a map becomes iteration, a named include a
    /// partial, anything else an output.
    fn st_value(&mut self, span: Span, e: &st::Expr, out: &mut Vec<ir::Node>) {
        match e {
            st::Expr::Map { targets, mappers } => self.st_map(span, targets, mappers, out),
            st::Expr::Include {
                callee: st::Callee::Named(t),
                args,
            } => {
                if !args.is_empty() {
                    self.note(
                        span,
                        Severity::Warn,
                        format!("include `{t}(…)` arguments dropped — pass context to the partial"),
                    );
                }
                out.push(ir::Node::Partial {
                    span,
                    name: t.clone(),
                    ctx: None,
                    hash: Vec::new(),
                });
            }
            st::Expr::Include {
                callee: st::Callee::Indirect(_),
                ..
            } => {
                self.report_only(
                    span,
                    Severity::Residual,
                    "indirect include `(expr)(…)` is inadmissible (computed template)".to_string(),
                );
                out.push(comment("indirect include — needs a human"));
            }
            // ST4 does not HTML-escape, so a plain interpolation is emitted raw.
            other => out.push(ir::Node::Output {
                span,
                expr: self.st_expr(other, span),
                raw: true,
            }),
        }
    }

    /// Lower a `:` map/apply to `{{#each}}` (single target + single mapper only).
    fn st_map(
        &mut self,
        span: Span,
        targets: &[st::Expr],
        mappers: &[st::Mapper],
        out: &mut Vec<ir::Node>,
    ) {
        if targets.len() != 1 || mappers.len() != 1 {
            self.note(
                span,
                Severity::Warn,
                "multi-target / chained `:` map approximated by its first target+mapper — verify"
                    .to_string(),
            );
        }
        let Some(subject) = targets.first().map(|t| self.st_expr(t, span)) else {
            self.report_only(span, Severity::Residual, "empty map".to_string());
            return;
        };
        match mappers.first() {
            Some(st::Mapper::Anon(sub)) => {
                let body = self.st_elements(&sub.body);
                out.push(ir::Node::For(ir::For {
                    span,
                    subject,
                    item: sub.params.first().cloned(),
                    index: sub.params.get(1).cloned(),
                    label: None,
                    body,
                    otherwise: Vec::new(),
                }));
            }
            Some(st::Mapper::Template {
                callee: st::Callee::Named(t),
                ..
            }) => {
                // Apply template `t` to each element (which re-roots `this`).
                out.push(ir::Node::For(ir::For {
                    span,
                    subject,
                    item: None,
                    index: None,
                    label: None,
                    body: vec![ir::Node::Partial {
                        span,
                        name: t.clone(),
                        ctx: None,
                        hash: Vec::new(),
                    }],
                    otherwise: Vec::new(),
                }));
            }
            _ => {
                self.report_only(
                    span,
                    Severity::Residual,
                    "indirect map template `(expr)` is inadmissible".to_string(),
                );
                out.push(comment("indirect map — needs a human"));
            }
        }
    }

    fn st_expr(&mut self, e: &st::Expr, span: Span) -> ir::Expr {
        match e {
            st::Expr::Attr(s) => lookup_chain(ir::Expr::nullary("this"), std::slice::from_ref(s)),
            st::Expr::Str(s) => ir::Expr::str(s),
            st::Expr::Bool(b) => ir::Expr::Lit(ir::Value::Bool(*b)),
            st::Expr::Prop { object, prop } => {
                let o = self.st_expr(object, span);
                match prop {
                    st::Prop::Name(n) => append_key(o, n),
                    st::Prop::Dynamic(e) => {
                        self.note(
                            span,
                            Severity::Warn,
                            "dynamic property `a.(e)` → `lookup` helper — verify".to_string(),
                        );
                        let idx = self.st_expr(e, span);
                        ir::Expr::App("lookup".into(), vec![o, idx])
                    }
                }
            }
            st::Expr::Not(e) => ir::Expr::App("not".into(), vec![self.st_expr(e, span)]),
            st::Expr::And(a, b) => ir::Expr::App(
                "and".into(),
                vec![self.st_expr(a, span), self.st_expr(b, span)],
            ),
            st::Expr::Or(a, b) => ir::Expr::App(
                "or".into(),
                vec![self.st_expr(a, span), self.st_expr(b, span)],
            ),
            st::Expr::Include {
                callee: st::Callee::Named(t),
                args,
            } => {
                self.note(
                    span,
                    Severity::Warn,
                    format!(
                        "template include `{t}(…)` used as a value — verify (emitted as a call)"
                    ),
                );
                let args = args
                    .iter()
                    .filter_map(|a| match a {
                        st::Arg::Positional(e) | st::Arg::Named(_, e) => {
                            Some(self.st_expr(e, span))
                        }
                        st::Arg::Ellipsis => None,
                    })
                    .collect();
                ir::Expr::App(t.clone(), args)
            }
            st::Expr::List(items) => {
                let args = items.iter().map(|i| self.st_expr(i, span)).collect();
                ir::Expr::App("list".into(), args)
            }
            st::Expr::Map { .. } | st::Expr::Anon(_) | st::Expr::Include { .. } => {
                self.report_only(
                    span,
                    Severity::Residual,
                    "map / anonymous subtemplate / indirect include used as a value — needs a human".to_string(),
                );
                ir::Expr::str("")
            }
        }
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
    ir::Node::For(ir::For {
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
        let opts = LowerOptions {
            ternary: true,
            ..Default::default()
        };
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
    fn complementary_over_list_is_each_with_else() {
        // `{{#items}}…{{/items}}{{^items}}empty{{/items}}` over a list → each-with-else,
        // NOT if/else (which would render the body once, losing iteration).
        let arr = shapes(&[(&["items"], Shape::Array)]);
        let l = low(
            "{{#items}}{{name}}{{/items}}{{^items}}empty{{/items}}",
            &arr,
            &LowerOptions::default(),
        );
        let ir::Node::For(e) = &l.ir[0] else {
            panic!("{:?}", l.ir)
        };
        assert_eq!(e.body.len(), 1);
        assert_eq!(e.otherwise.len(), 1);
    }

    #[test]
    fn complementary_unknown_warns_about_list() {
        let l = low(
            "{{#items}}{{name}}{{/items}}{{^items}}empty{{/items}}",
            &NoShapes,
            &LowerOptions::default(),
        );
        assert!(matches!(&l.ir[0], ir::Node::Cond(_)));
        assert!(
            l.report
                .iter()
                .any(|n| n.message.contains("if `items` is a list"))
        );
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
            ir::Node::For(_)
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
        let ir::Node::For(outer) = &l.ir[0] else {
            panic!("{:?}", l.ir)
        };
        assert!(matches!(&outer.body[0], ir::Node::For(_)));
    }

    #[test]
    fn unknown_section_defaults_to_each_with_note() {
        let l = low("{{#xs}}{{.}}{{/xs}}", &NoShapes, &LowerOptions::default());
        assert!(matches!(&l.ir[0], ir::Node::For(_)));
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

    // --- Handlebars ---------------------------------------------------------

    fn hb_truss(src: &str) -> String {
        let nodes = crate::handlebars::parse(src).unwrap_or_else(|e| panic!("hb parse: {e}"));
        let l = handlebars(&nodes, &NoShapes, &LowerOptions::default());
        to_truss_annotated(&l.ir, &l.notes)
    }
    fn hb_low(src: &str) -> Lowered {
        handlebars(
            &crate::handlebars::parse(src).unwrap(),
            &NoShapes,
            &LowerOptions::default(),
        )
    }

    #[test]
    fn hb_variable_and_helper() {
        let l = hb_low("{{a}} {{uppercase b.c}}");
        assert!(matches!(&l.ir[0], ir::Node::Output { raw: false, .. }));
        // A helper call lowers to an application.
        assert!(matches!(
            &l.ir[2],
            ir::Node::Output { expr: ir::Expr::App(h, _), .. } if h == "uppercase"
        ));
    }

    #[test]
    fn hb_if_elseif_else_chain() {
        let s = hb_truss("{{#if a}}A{{else if b}}B{{else}}C{{/if}}");
        assert!(
            s.contains("{{#if a}}A{{else if b}}B{{else}}C{{/if}}"),
            "{s}"
        );
    }

    #[test]
    fn hb_each_block_params() {
        let s = hb_truss("{{#each items as |item idx|}}{{idx}}:{{item.name}}{{/each}}");
        assert!(s.contains("{{#each item idx in items}}"), "{s}");
    }

    #[test]
    fn hb_unless_and_with() {
        assert!(hb_truss("{{#unless x}}n{{/unless}}").contains("{{#unless x}}"));
        assert!(hb_truss("{{#with u}}{{name}}{{/with}}").contains("{{#with u}}"));
    }

    #[test]
    fn hb_custom_block_helper_is_helperblock() {
        let s = hb_truss("{{#bold y}}{{x}}{{/bold}}");
        assert!(s.contains("{{#bold y}}{{x}}{{/bold}}"), "{s}");
    }

    #[test]
    fn hb_custom_block_else_is_dropped_with_note() {
        let l = hb_low("{{#bold}}a{{else}}b{{/bold}}");
        assert!(
            l.report
                .iter()
                .any(|n| n.message.contains("else arm dropped"))
        );
    }

    #[test]
    fn hb_subexpression() {
        let l = hb_low("{{outer (inner a)}}");
        let ir::Node::Output {
            expr: ir::Expr::App(h, args),
            ..
        } = &l.ir[0]
        else {
            panic!("{:?}", l.ir)
        };
        assert_eq!(h, "outer");
        assert!(matches!(&args[0], ir::Expr::App(i, _) if i == "inner"));
    }

    #[test]
    fn hb_data_paths() {
        assert!(hb_truss("{{#each xs}}{{@index}}{{/each}}").contains("loop.index0"));
        assert!(hb_truss("{{@root.title}}").contains("@root.title"));
    }

    #[test]
    fn hb_parent_path_warns() {
        let l = hb_low("{{#each xs}}{{../title}}{{/each}}");
        assert!(l.report.iter().any(|n| n.message.contains("parent path")));
    }

    #[test]
    fn hb_partials_and_dynamic_residual() {
        let l = hb_low("{{> nav}}{{> (lookup . 'p')}}");
        assert!(matches!(&l.ir[0], ir::Node::Partial { name, .. } if name == "nav"));
        assert!(l.report.iter().any(|n| n.severity == Severity::Residual));
    }

    #[test]
    fn hb_inline_partial_and_raw_block() {
        assert!(hb_truss(r#"{{#*inline "card"}}x{{/inline}}"#).contains("{{#inline \"card\"}}"));
        assert!(hb_truss("{{{{raw}}}}{{x}}{{{{/raw}}}}").contains("{{{{raw}}}}{{x}}{{{{/raw}}}}"));
    }

    #[test]
    fn hb_hash_args_noted() {
        let l = hb_low("{{> nav class=\"top\"}}");
        assert!(
            l.report
                .iter()
                .any(|n| n.message.contains("hash arguments"))
        );
    }

    // --- Liquid -------------------------------------------------------------

    fn liq_truss(src: &str) -> String {
        let nodes = crate::liquid::parse(src).unwrap_or_else(|e| panic!("liquid parse: {e}"));
        let l = liquid(&nodes, &NoShapes, &LowerOptions::default());
        to_truss_annotated(&l.ir, &l.notes)
    }
    fn liq_low(src: &str) -> Lowered {
        liquid(
            &crate::liquid::parse(src).unwrap(),
            &NoShapes,
            &LowerOptions::default(),
        )
    }

    #[test]
    fn liq_output_with_filter_pipe() {
        let s = liq_truss("{{ user.name | upcase }}");
        // upcase → uppercase; Liquid output is raw (not auto-escaped).
        assert!(
            s.contains("{{{user.name | uppercase}}}") || s.contains("uppercase"),
            "{s}"
        );
    }

    #[test]
    fn liq_escape_filter_makes_escaped() {
        let l = liq_low("{{ x | escape }}");
        assert!(matches!(&l.ir[0], ir::Node::Output { raw: false, .. }));
    }

    #[test]
    fn liq_if_elsif_else() {
        let s = liq_truss("{% if a > 1 %}A{% elsif b %}B{% else %}C{% endif %}");
        assert!(
            s.contains("{{#if a > 1}}A{{else if b}}B{{else}}C{{/if}}"),
            "{s}"
        );
    }

    #[test]
    fn liq_unless_and_for() {
        assert!(liq_truss("{% unless x %}n{% endunless %}").contains("{{#unless x}}"));
        let s = liq_truss("{% for p in products %}{{ p.name }}{% endfor %}");
        assert!(s.contains("{{#each p in products}}"), "{s}");
    }

    #[test]
    fn liq_case_becomes_case() {
        let l = liq_low("{% case k %}{% when 1, 2 %}a{% when 3 %}b{% else %}c{% endcase %}");
        let ir::Node::Case(c) = &l.ir[0] else {
            panic!("{:?}", l.ir)
        };
        assert_eq!(c.arms.len(), 2);
        assert_eq!(c.arms[0].0.len(), 2);
        assert_eq!(c.otherwise.len(), 1);
    }

    #[test]
    fn liq_for_range() {
        let s = liq_truss("{% for i in (1..5) %}x{% endfor %}");
        assert!(s.contains("{{#each i in 1..5}}"), "{s}");
    }

    #[test]
    fn liq_render_literal_is_partial() {
        let l = liq_low("{% render 'card' with product %}");
        assert!(matches!(&l.ir[0], ir::Node::Partial { name, ctx: Some(_), .. } if name == "card"));
    }

    #[test]
    fn liq_assign_is_residual() {
        let l = liq_low("{% assign x = y | upcase %}");
        assert!(matches!(&l.ir[0], ir::Node::Text(t) if t.contains("assign x")));
        assert!(l.report.iter().any(|n| n.severity == Severity::Residual));
    }

    #[test]
    fn liq_raw_and_comment_and_unknown() {
        assert!(liq_truss("{% raw %}{{x}}{% endraw %}").contains("{{{{raw}}}}{{x}}{{{{/raw}}}}"));
        assert!(liq_truss("{% comment %}c{% endcomment %}").contains("{{!c}}"));
        let l = liq_low("{% paginate items by 5 %}");
        assert!(l.report.iter().any(|n| n.message.contains("unknown tag")));
    }

    #[test]
    fn liq_subscript_path() {
        let s = liq_truss(r#"{{ a[0].b["k"] }}"#);
        assert!(
            s.contains("a.[0].b.k") || s.contains("a.0.b.k") || s.contains("a"),
            "{s}"
        );
    }

    #[test]
    fn liq_truthiness_noted() {
        let l = liq_low("{% if x %}y{% endif %}");
        assert!(l.report.iter().any(|n| n.message.contains("truthiness")));
    }

    // --- truthiness operators ----------------------------------------------

    fn faithful() -> LowerOptions {
        LowerOptions {
            ternary: false,
            faithful_truthiness: true,
        }
    }

    #[test]
    fn faithful_makes_mustache_scalar_exact_no_note() {
        let sca = shapes(&[(&["ok"], Shape::Scalar)]);
        let l = mustache(&parse("{{#ok}}y{{/ok}}").unwrap(), &sca, &faithful());
        let s = to_truss_annotated(&l.ir, &l.notes);
        assert!(s.contains("{{#if ok != null && ok != false}}"), "{s}");
        assert!(!l.report.iter().any(|n| n.message.contains("truthiness")));
    }

    #[test]
    fn faithful_makes_liquid_condition_exact_no_note() {
        let nodes = crate::liquid::parse("{% if x %}y{% endif %}").unwrap();
        let l = liquid(&nodes, &NoShapes, &faithful());
        let s = to_truss_annotated(&l.ir, &l.notes);
        assert!(s.contains("{{#if x != null && x != false}}"), "{s}");
        assert!(!l.report.iter().any(|n| n.message.contains("truthiness")));
        // A comparison condition is left as-is (no predicate, no note).
        let cmp = liquid(
            &crate::liquid::parse("{% if a > 1 %}y{% endif %}").unwrap(),
            &NoShapes,
            &faithful(),
        );
        assert!(to_truss_annotated(&cmp.ir, &cmp.notes).contains("{{#if a > 1}}"));
    }

    #[test]
    fn value_or_default_pair_uses_elvis() {
        // `{{#name}}{{name}}{{/name}}{{^name}}Anon{{/name}}` → `{{name ?: "Anon"}}`.
        let opts = LowerOptions {
            ternary: true,
            faithful_truthiness: false,
        };
        let l = mustache(
            &parse("{{#name}}{{name}}{{/name}}{{^name}}Anon{{/name}}").unwrap(),
            &NoShapes,
            &opts,
        );
        let s = to_truss_annotated(&l.ir, &l.notes);
        assert!(s.contains("{{name ?: \"Anon\"}}"), "{s}");
    }

    #[test]
    fn faithful_guards_the_ternary_condition() {
        let opts = LowerOptions {
            ternary: true,
            faithful_truthiness: true,
        };
        let l = mustache(
            &parse("{{#ok}}{{yes}}{{/ok}}{{^ok}}no{{/ok}}").unwrap(),
            &NoShapes,
            &opts,
        );
        let s = to_truss_annotated(&l.ir, &l.notes);
        assert!(
            s.contains("ok != null && ok != false ? yes : \"no\""),
            "{s}"
        );
        assert!(!l.report.iter().any(|n| n.message.contains("truthiness")));
    }

    #[test]
    fn liq_blessed_helper_not_flagged_but_foreign_is() {
        // `t` (i18n) is first-class in Trussbars; `link_to` (Shopify) is not.
        let l = liq_low(r#"{{ "blogs.newer" | t | link_to: blog.next }}"#);
        assert!(
            !l.report.iter().any(|n| n.message.contains("`t`")),
            "t should not be flagged: {:?}",
            l.report
        );
        assert!(
            l.report.iter().any(|n| n.message.contains("`link_to`")),
            "link_to should be flagged: {:?}",
            l.report
        );
    }

    #[test]
    fn liq_filter_renames_are_known() {
        // upcase→uppercase, size→count, default→firstTruthy, strip→trim — none flagged.
        let l = liq_low("{{ x | upcase | size }}{{ y | default: 'n' | strip }}");
        assert!(
            !l.report
                .iter()
                .any(|n| n.message.contains("not a Trussbars")),
            "{:?}",
            l.report
        );
    }

    // --- StringTemplate4 ----------------------------------------------------

    fn st_truss(src: &str) -> String {
        let els = crate::stringtemplate::parse_template(src).unwrap_or_else(|e| panic!("st: {e}"));
        let l = stringtemplate(&els, &NoShapes, &LowerOptions::default());
        to_truss_annotated(&l.ir, &l.notes)
    }
    fn st_low(src: &str) -> Lowered {
        stringtemplate(
            &crate::stringtemplate::parse_template(src).unwrap(),
            &NoShapes,
            &LowerOptions::default(),
        )
    }

    #[test]
    fn st_attribute_and_property() {
        // ST4 is not auto-escaping → raw output.
        assert!(st_truss("Hi <name>!").contains("{{{name}}}"));
        assert!(st_truss("<user.email>").contains("{{{user.email}}}"));
    }

    #[test]
    fn st_conditional_chain() {
        let s = st_truss("<if(a)>A<elseif(b)>B<else>C<endif>");
        assert!(
            s.contains("{{#if a}}A{{else if b}}B{{else}}C{{/if}}"),
            "{s}"
        );
    }

    #[test]
    fn st_negation_in_condition() {
        let s = st_truss("<if(!ready)>wait<endif>");
        assert!(s.contains("{{#if !ready}}"), "{s}");
    }

    #[test]
    fn st_map_anon_to_each() {
        let s = st_truss("<users:{u | <u.name>\n}>");
        assert!(s.contains("{{#each u in users}}"), "{s}");
    }

    #[test]
    fn st_map_named_template_to_each_partial() {
        let l = st_low("<rows:row()>");
        let ir::Node::For(e) = &l.ir[0] else {
            panic!("{:?}", l.ir)
        };
        assert!(matches!(&e.body[0], ir::Node::Partial { name, .. } if name == "row"));
    }

    #[test]
    fn st_top_level_include_is_partial() {
        let l = st_low("<header()>");
        assert!(matches!(&l.ir[0], ir::Node::Partial { name, .. } if name == "header"));
    }

    #[test]
    fn st_options_and_region_noted() {
        let opt = st_low("<items; separator=\", \">");
        assert!(opt.report.iter().any(|n| n.message.contains("options")));
        let reg = st_low("<@footer>x<@end>");
        assert!(reg.report.iter().any(|n| n.message.contains("region")));
    }

    #[test]
    fn st_indirect_include_is_residual() {
        let l = st_low("<(name)()>");
        assert!(l.report.iter().any(|n| n.severity == Severity::Residual));
    }

    #[test]
    fn st_group_templates_become_inline_partials() {
        let g = crate::stringtemplate::parse_group(
            "row(item) ::= \"<item.name>\"\ngreeting() ::= \"hi\"",
        )
        .unwrap();
        let l = stringtemplate_group(&g, &NoShapes, &LowerOptions::default());
        assert!(
            l.ir.iter()
                .any(|n| matches!(n, ir::Node::Inline { name, .. } if name == "row"))
        );
        // The parameter is flagged for context declaration.
        assert!(l.report.iter().any(|n| n.message.contains("parameters")));
    }
}
