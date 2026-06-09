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
                out.push(ir::Node::Each(ir::Each {
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
                // I3: a trivial scalar pair becomes a ternary when enabled.
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
                out.push(ir::Node::Each(ir::Each {
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
    fn complementary_over_list_is_each_with_else() {
        // `{{#items}}…{{/items}}{{^items}}empty{{/items}}` over a list → each-with-else,
        // NOT if/else (which would render the body once, losing iteration).
        let arr = shapes(&[(&["items"], Shape::Array)]);
        let l = low(
            "{{#items}}{{name}}{{/items}}{{^items}}empty{{/items}}",
            &arr,
            &LowerOptions::default(),
        );
        let ir::Node::Each(e) = &l.ir[0] else {
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
}
