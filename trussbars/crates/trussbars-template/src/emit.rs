//! Slice 4 — the emitter: the desugared [`Node`]/[`Expr`] tree → typed Rust
//! (`pub fn render(ctx: &T) -> String`), a transcription of the v1 reference
//! `MaxBars/Rust.purs`. The emitted code links against `trussbars-core` /
//! `trussbars-std`; the conformance corpus pins the output byte-for-byte.

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use crate::ast::{Case, Cond, Each, Expr, HelperBlock, Node, TruthMode, Value, With};
use crate::parse::parse;
use crate::span::Span;

impl TruthMode {
    /// The truthiness call for this policy over an already-referenced expression
    /// (`&(expr)` or a borrowed binding). `NonEmpty` emits the bare `truthy(…)` —
    /// byte-identical to the v1 emitter, so the conformance corpus is unaffected; a
    /// non-default policy routes through the monomorphized `truthy_in::<Mode, _>(…)`.
    /// (Defined here, in the std-only emit module, since it builds codegen strings; the
    /// policy enum itself lives in [`crate::ast`] so the `no_std` VM can name it.)
    fn call(self, ref_expr: &str) -> String {
        match self {
            Self::NonEmpty => format!("trussbars_core::truthy({ref_expr})"),
            Self::Liquid => {
                format!("trussbars_core::truthy_in::<trussbars_core::Liquid, _>({ref_expr})")
            }
            Self::Handlebars => {
                format!("trussbars_core::truthy_in::<trussbars_core::Handlebars, _>({ref_expr})")
            }
        }
    }
}

/// Compile MaxBars surface `src` into a Rust `render` function over `ctx_type`, under
/// the default [`TruthMode::NonEmpty`] truthiness policy.
///
/// # Errors
/// Returns the `line:col: message` reason for a parse error or an unsupported
/// construct (the located string the `truss!` macro drops into `compile_error!`).
pub fn emit(ctx_type: &str, src: &str) -> Result<String, String> {
    emit_named("render", ctx_type, src, &[], TruthMode::NonEmpty)
}

/// As [`emit`], but the generated function is named `fn_name` (the `truss!` macro
/// names each template's function so several can coexist in one module) and
/// `helpers` is the allow-list of host-helper names the template may call (F3): a
/// non-built-in name `{{date x}}` / `{{x | markdown}}` compiles to a call to a host
/// Rust fn of that name **only** when it is declared here, otherwise it is a located
/// `unknown helper` error. So data can never name a function — the allow-list is
/// static, set by the trusted host at compile time.
///
/// # Errors
/// The located `line:col: message` reason (see [`emit`]).
pub fn emit_named(
    fn_name: &str,
    ctx_type: &str,
    src: &str,
    helpers: &[String],
    mode: TruthMode,
) -> Result<String, String> {
    // A host cannot declare a built-in block head (`if`/`each`/`case`/…) as a helper —
    // it is shadowed by the parser, so accepting it would silently never fire (docs/12 §5.2).
    if let Some(name) = helpers
        .iter()
        .find(|h| crate::parse::RESERVED_BLOCK_HEADS.contains(&h.as_str()))
    {
        return Err(format!(
            "`{name}` is a reserved built-in block and cannot be declared as a host helper"
        ));
    }
    let nodes = parse(src).map_err(|e| located(e.at, src, &e.message))?;
    let (registry, top) = hoist(nodes);
    let env = Env {
        scope: "ctx".into(),
        loop_var: None,
        params: BTreeMap::new(),
        parents: Vec::new(),
        labels: BTreeMap::new(),
        partials: Rc::new(registry),
        expanding: Vec::new(),
        yield_code: None,
        depth: 0,
        helpers: Rc::new(helpers.iter().cloned().collect()),
        mode,
    };
    // The node emit writes into one buffer (no per-node String allocs); the body then
    // sits between the render-fn header and footer.
    let mut body = String::new();
    emit_nodes(&env, src, &top, &mut body)?;
    let (header, footer) = render_fn_parts(fn_name, ctx_type, estimate_bytes(&top));
    Ok(format!("{header}{body}{footer}"))
}

/// Prefix a message with its `line:col:` template coordinates (class-A diagnostics,
/// docs/07 §3 — precise on stable, the message carries the location).
fn located(at: usize, src: &str, msg: &str) -> String {
    let (line, col) = Span::new(at, at).line_col(src);
    format!("{line}:{col}: {msg}")
}

/// Whether a message already carries a `line:col:` prefix (so a parent node does
/// not double-locate a child's already-located error).
fn is_located(m: &str) -> bool {
    let mut it = m.splitn(3, ':');
    matches!(
        (it.next(), it.next()),
        (Some(a), Some(b))
            if !a.is_empty()
                && a.bytes().all(|x| x.is_ascii_digit())
                && !b.is_empty()
                && b.bytes().all(|x| x.is_ascii_digit())
    )
}

type Partials = Rc<BTreeMap<String, Vec<Node>>>;

#[derive(Clone)]
struct Env {
    scope: String,
    loop_var: Option<String>,
    params: BTreeMap<String, String>,
    parents: Vec<String>,
    labels: BTreeMap<String, String>,
    partials: Partials,
    expanding: Vec<String>,
    yield_code: Option<String>,
    depth: usize,
    /// The host-helper allow-list (F3): names the template may call as host Rust
    /// functions. Shared (cheap clone) across the recursive emit.
    helpers: Rc<BTreeSet<String>>,
    /// The truthiness policy this template compiles under (spec §7).
    mode: TruthMode,
}

impl Env {
    /// The active policy's truthiness call over an already-referenced expression.
    fn truthy_ref(&self, ref_expr: &str) -> String {
        self.mode.call(ref_expr)
    }
}

// ── inline-partial hoisting ───────────────────────────────────────────────────

/// Lift every `{{#inline "n"}}…{{/inline}}` definition (anywhere in the tree) into
/// a registry and return the tree with those definitions removed.
fn hoist(nodes: Vec<Node>) -> (BTreeMap<String, Vec<Node>>, Vec<Node>) {
    let mut reg = BTreeMap::new();
    let top = hoist_into(nodes, &mut reg);
    (reg, top)
}

fn hoist_into(nodes: Vec<Node>, reg: &mut BTreeMap<String, Vec<Node>>) -> Vec<Node> {
    let mut out = Vec::new();
    for n in nodes {
        match n {
            Node::Inline { name, body, .. } => {
                let body = hoist_into(body, reg);
                reg.insert(name, body);
            }
            Node::Each(mut e) => {
                e.body = hoist_into(e.body, reg);
                e.otherwise = hoist_into(e.otherwise, reg);
                out.push(Node::Each(e));
            }
            Node::Cond(mut c) => {
                c.body = hoist_into(c.body, reg);
                c.elifs = c
                    .elifs
                    .into_iter()
                    .map(|(e, b)| (e, hoist_into(b, reg)))
                    .collect();
                c.otherwise = hoist_into(c.otherwise, reg);
                out.push(Node::Cond(c));
            }
            Node::Case(mut c) => {
                c.arms = c
                    .arms
                    .into_iter()
                    .map(|(v, b)| (v, hoist_into(b, reg)))
                    .collect();
                c.otherwise = hoist_into(c.otherwise, reg);
                out.push(Node::Case(c));
            }
            Node::With(mut w) => {
                w.body = hoist_into(w.body, reg);
                w.otherwise = hoist_into(w.otherwise, reg);
                out.push(Node::With(w));
            }
            Node::Let {
                span,
                bindings,
                body,
            } => {
                out.push(Node::Let {
                    span,
                    bindings,
                    body: hoist_into(body, reg),
                });
            }
            Node::PartialBlock {
                span,
                name,
                ctx,
                body,
            } => {
                out.push(Node::PartialBlock {
                    span,
                    name,
                    ctx,
                    body: hoist_into(body, reg),
                });
            }
            other => out.push(other),
        }
    }
    out
}

// ── the render-fn wrapper + capacity seed ─────────────────────────────────────

/// The render-fn wrapper split into the prefix (before the body) and the suffix.
/// Concatenated `header + body + footer` is the generated function.
fn render_fn_parts(fn_name: &str, ctx_type: &str, cap: usize) -> (String, String) {
    let header = format!(
        "#[doc = \"Rendered from a MaxBars template (generated by Trussbars).\"]\n\
         pub fn {fn_name}(ctx: &{ctx_type}) -> String {{\n\
         static __CAP: trussbars_core::SizeHint = trussbars_core::SizeHint::new({cap});\n\
         let __root = ctx;\n\
         let mut out = String::with_capacity(__CAP.suggest());\n"
    );
    (header, "__CAP.record(out.len());\nout\n}\n".to_string())
}

fn estimate_bytes(nodes: &[Node]) -> usize {
    nodes.iter().map(estimate_node).sum()
}

fn estimate_node(n: &Node) -> usize {
    match n {
        Node::Text(s) => s.len(),
        Node::Output { .. } | Node::Yield { .. } => 8,
        Node::RawBlock { body, .. } => body.len(),
        Node::Each(e) => 8 * (estimate_bytes(&e.body) + estimate_bytes(&e.otherwise)),
        Node::Cond(c) => {
            estimate_bytes(&c.body)
                + c.elifs
                    .iter()
                    .map(|(_, b)| estimate_bytes(b))
                    .sum::<usize>()
                + estimate_bytes(&c.otherwise)
        }
        Node::Case(c) => {
            c.arms.iter().map(|(_, b)| estimate_bytes(b)).sum::<usize>()
                + estimate_bytes(&c.otherwise)
        }
        Node::With(w) => estimate_bytes(&w.body) + estimate_bytes(&w.otherwise),
        Node::Let { body, .. } | Node::PartialBlock { body, .. } => estimate_bytes(body),
        Node::HelperBlock(b) => estimate_bytes(&b.body),
        Node::Partial { .. } | Node::Inline { .. } => 0,
    }
}

// ── nodes ─────────────────────────────────────────────────────────────────────

fn emit_nodes(env: &Env, src: &str, nodes: &[Node], out: &mut String) -> Result<(), String> {
    for n in nodes {
        emit_node(env, src, n, out)?;
    }
    Ok(())
}

/// Emit one node into `out`, attaching its tag's `line:col` to any leaf error that does
/// not already carry one (class-A diagnostics).
fn emit_node(env: &Env, src: &str, n: &Node, out: &mut String) -> Result<(), String> {
    emit_node_inner(env, src, n, out).map_err(|m| {
        if is_located(&m) {
            m
        } else {
            located(n.span().start, src, &m)
        }
    })
}

fn emit_node_inner(env: &Env, src: &str, n: &Node, out: &mut String) -> Result<(), String> {
    match n {
        Node::Text(s) => out.push_str(&format!("out.push_str({});\n", rust_str(s))),
        Node::Output { expr, raw, .. } => {
            let e = emit_expr(env, expr)?;
            if *raw {
                out.push_str(&format!(
                    "trussbars_core::ToText::write_text(&({e}), &mut out);\n"
                ));
            } else {
                out.push_str(&format!("trussbars_core::esc(&({e}), &mut out);\n"));
            }
        }
        Node::RawBlock { body, .. } => {
            out.push_str(&format!("out.push_str({});\n", rust_str(body)))
        }
        Node::Yield { .. } => return yield_here(env, out),
        Node::Partial { name, ctx, .. } => {
            return inline_partial(
                env,
                src,
                name,
                ctx.clone().unwrap_or_else(|| Expr::nullary("this")),
                None,
                out,
            );
        }
        Node::PartialBlock {
            name, ctx, body, ..
        } => {
            // The block body renders into a separate buffer (its yield).
            let mut yield_buf = String::new();
            emit_nodes(env, src, body, &mut yield_buf)?;
            return inline_partial(
                env,
                src,
                name,
                ctx.clone().unwrap_or_else(|| Expr::nullary("this")),
                Some(yield_buf),
                out,
            );
        }
        Node::Inline { .. } => {} // hoisted away
        Node::Each(e) => return each_block(env, src, e, out),
        Node::Cond(c) => return cond_block(env, src, c, out),
        Node::Case(c) => return case_block(env, src, c, out),
        Node::With(w) => return with_block(env, src, w, out),
        Node::Let { bindings, body, .. } => return let_block(env, src, bindings, body, out),
        Node::HelperBlock(b) => return helper_block(env, src, b, out),
    }
    Ok(())
}

/// Emit a host **block** helper (docs/09): `name(&(arg0), …, || -> String { <body> })`,
/// whose return is written **raw** (block output is markup; the body is already escaped
/// inside the closure, so re-escaping would double-escape it). The body closure renders the
/// inner nodes in the enclosing scope — it shadows the runtime `out` buffer with its own, so
/// the body's `out.push_str(…)` fills the closure's buffer, which it returns. Undeclared
/// heads are a located "unknown helper".
fn helper_block(env: &Env, src: &str, b: &HelperBlock, out: &mut String) -> Result<(), String> {
    if !env.helpers.contains(&b.head) {
        return Err(format!(
            "unknown helper '{}' (declare it with `truss_helpers` if it is a host block helper)",
            b.head
        ));
    }
    let mut args: Vec<String> = b
        .args
        .iter()
        .map(|a| Ok(format!("&({})", emit_expr(env, a)?)))
        .collect::<Result<_, String>>()?;
    let mut body = String::new();
    emit_nodes(env, src, &b.body, &mut body)?;
    args.push(format!(
        "|| -> String {{\nlet mut out = String::new();\n{body}out\n}}"
    ));
    let call = format!("{}({})", b.head, args.join(", "));
    // Block-helper output is markup: the body's interpolations were already escaped inside
    // the closure, so the helper's return is written **raw** — escaping it would
    // double-escape the body. (`String` and `Safe` returns both write through `ToText`.)
    out.push_str(&format!(
        "trussbars_core::ToText::write_text(&({call}), &mut out);\n"
    ));
    Ok(())
}

fn yield_here(env: &Env, out: &mut String) -> Result<(), String> {
    match &env.yield_code {
        Some(code) => {
            out.push_str(code);
            Ok(())
        }
        None => Err("unsupported: '{{yield}}' outside a block partial".into()),
    }
}

fn inline_partial(
    env: &Env,
    src: &str,
    name: &str,
    ctx_e: Expr,
    yield_code: Option<String>,
    out: &mut String,
) -> Result<(), String> {
    let Some(body) = env.partials.get(name) else {
        return Err(format!("unsupported: unknown partial '{name}'"));
    };
    if env.expanding.iter().any(|n| n == name) {
        return Err(format!("unsupported: recursive partial '{name}'"));
    }
    let ctx_code = emit_expr(env, &ctx_e)?;
    let mut child = env.clone();
    child.scope = ctx_code;
    child.loop_var = None;
    child.params = BTreeMap::new();
    child.parents = Vec::new();
    child.expanding.push(name.to_string());
    child.yield_code = yield_code;
    emit_nodes(&child, src, body, out)
}

// ── blocks ────────────────────────────────────────────────────────────────────

fn cond_block(env: &Env, src: &str, c: &Cond, out: &mut String) -> Result<(), String> {
    let prefix = if c.negated { "if !" } else { "if " };
    let cond = truthy_of(env, &c.cond)?;
    out.push_str(prefix);
    out.push_str(&format!("{} {{\n", env.truthy_ref(&format!("&({cond})"))));
    emit_nodes(env, src, &c.body, out)?;
    out.push('}');
    for (econd, ebody) in &c.elifs {
        let ec = truthy_of(env, econd)?;
        out.push_str(&format!(
            " else if {} {{\n",
            env.truthy_ref(&format!("&({ec})"))
        ));
        emit_nodes(env, src, ebody, out)?;
        out.push('}');
    }
    if !c.otherwise.is_empty() {
        out.push_str(" else {\n");
        emit_nodes(env, src, &c.otherwise, out)?;
        out.push('}');
    }
    out.push('\n');
    Ok(())
}

/// `{{#case}}` → a Rust `match`: the subject is evaluated **once** (bound as `__subj`) and
/// dispatched by one guard arm per `{{when}}` — the first-class lowering the user asked for
/// (`case` becomes `match`), not a repeated-`eq` `if`-chain. Each guard reuses the same
/// `==` the `eq` operator emits, so the rendered bytes match the interpreter (docs/12).
fn case_block(env: &Env, src: &str, c: &Case, out: &mut String) -> Result<(), String> {
    let subject = emit_expr(env, &c.subject)?;
    out.push_str(&format!("{{\nlet __subj = &({subject});\nmatch () {{\n"));
    for (values, body) in &c.arms {
        let guard = if values.is_empty() {
            "false".to_string()
        } else {
            values
                .iter()
                .map(|v| Ok(format!("*__subj == ({})", emit_expr(env, v)?)))
                .collect::<Result<Vec<_>, String>>()?
                .join(" || ")
        };
        out.push_str(&format!("() if {guard} => {{\n"));
        emit_nodes(env, src, body, out)?;
        out.push_str("}\n");
    }
    out.push_str("_ => {\n");
    emit_nodes(env, src, &c.otherwise, out)?;
    out.push_str("}\n}\n}\n");
    Ok(())
}

fn with_block(env: &Env, src: &str, w: &With, out: &mut String) -> Result<(), String> {
    // An Option-aware `with` over a `find` subject.
    if let Expr::App(name, args) = &w.subject
        && name == "find"
    {
        return with_find(env, src, args, &w.body, &w.otherwise, out);
    }
    let d = env.depth + 1;
    let cvar = format!("__c{d}");
    let mut child = env.clone();
    child.scope = cvar.clone();
    child.parents.insert(0, env.scope.clone());
    child.depth = d;
    // A dict-literal subject re-roots to a synthesized struct, which has no `Truthy`
    // impl — so resolve its truthiness at compile time: a non-empty dict literal
    // always renders the body, an empty one always the `{{else}}` clause.
    if let Some(n) = dict_arity(&w.subject) {
        if n == 0 {
            return emit_nodes(env, src, &w.otherwise, out);
        }
        let subj = emit_expr(env, &w.subject)?;
        out.push_str(&format!("{{\nlet {cvar} = &({subj});\n"));
        emit_nodes(&child, src, &w.body, out)?;
        out.push_str("}\n");
        return Ok(());
    }
    let subj = emit_expr(env, &w.subject)?;
    let test = env.truthy_ref(&cvar);
    out.push_str(&format!("{{\nlet {cvar} = &({subj});\nif {test} {{\n"));
    emit_nodes(&child, src, &w.body, out)?;
    out.push_str("} else {\n");
    emit_nodes(env, src, &w.otherwise, out)?;
    out.push_str("}\n}\n");
    Ok(())
}

fn with_find(
    env: &Env,
    src: &str,
    find_args: &[Expr],
    body: &[Node],
    otherwise: &[Node],
    out: &mut String,
) -> Result<(), String> {
    let found = coll_find(env, find_args)?;
    let d = env.depth + 1;
    let cvar = format!("__c{d}");
    let mut child = env.clone();
    child.scope = cvar.clone();
    child.parents.insert(0, env.scope.clone());
    child.depth = d;
    out.push_str(&format!("{{\nif let Some({cvar}) = {found} {{\n"));
    emit_nodes(&child, src, body, out)?;
    out.push_str("} else {\n");
    emit_nodes(env, src, otherwise, out)?;
    out.push_str("}\n}\n");
    Ok(())
}

fn let_block(
    env: &Env,
    src: &str,
    bindings: &[(String, Expr)],
    body: &[Node],
    out: &mut String,
) -> Result<(), String> {
    let mut cur = env.clone();
    let mut lets = String::new();
    for (name, value) in bindings {
        let ve = emit_expr(&cur, value)?;
        let rust = format!("__let_{name}");
        lets.push_str(&format!("let {rust} = {ve};\n"));
        cur.params.insert(name.clone(), rust);
    }
    out.push_str("{\n");
    out.push_str(&lets);
    emit_nodes(&cur, src, body, out)?;
    out.push_str("}\n");
    Ok(())
}

fn each_block(env: &Env, src: &str, e: &Each, out: &mut String) -> Result<(), String> {
    // A dict literal compiles to a struct, which has no `Each` impl — so iterating one
    // is rejected up front (a clean located error, not a downstream rustc failure).
    // Bind it (`{{#with {…}}}` / `{{#let}}`) and read its fields instead.
    if dict_arity(&e.subject).is_some() {
        return Err(
            "unsupported: cannot iterate a dict literal — bind it and read its fields".into(),
        );
    }
    let subj = emit_expr(env, &e.subject)?;
    let d = env.depth + 1;
    let (cvar, lvar, ivar, kvar, subvar, lenvar) = (
        format!("__c{d}"),
        format!("__l{d}"),
        format!("__i{d}"),
        format!("__k{d}"),
        format!("__sub{d}"),
        format!("__len{d}"),
    );
    let mut params = env.params.clone();
    if let Some(it) = &e.item {
        params.insert(it.clone(), cvar.clone());
    }
    if let Some(ix) = &e.index {
        params.insert(ix.clone(), ivar.clone());
    }
    let mut labels = env.labels.clone();
    if let Some(lbl) = &e.label {
        labels.insert(lbl.clone(), lvar.clone());
    }
    // The frame is live only if the body uses `loop` or this loop's label (G2).
    let needs_frame =
        mentions(&e.body, "loop") || e.label.as_deref().is_some_and(|l| mentions(&e.body, l));
    let mut child = env.clone();
    child.scope = cvar.clone();
    child.loop_var = if needs_frame {
        Some(lvar.clone())
    } else {
        None
    };
    child.params = params;
    child.parents.insert(0, env.scope.clone());
    child.labels = if needs_frame {
        labels
    } else {
        env.labels.clone()
    };
    child.depth = d;
    let parent_loop = env
        .loop_var
        .as_ref()
        .map_or_else(|| "None".to_string(), |pl| format!("Some(&{pl})"));
    let need_index = needs_frame || e.index.is_some();
    let for_head = if need_index {
        format!(
            "for ({ivar}, ({kvar}, {cvar})) in trussbars_core::Each::each({subvar}).enumerate() {{\n"
        )
    } else {
        format!("for ({kvar}, {cvar}) in trussbars_core::Each::each({subvar}) {{\n")
    };
    let frame = if needs_frame {
        format!("let {lvar} = trussbars_core::Loop::at({ivar}, {lenvar}, {kvar}, {parent_loop});\n")
    } else {
        String::new()
    };
    out.push_str("{\n");
    out.push_str(&format!("let {subvar} = &({subj});\n"));
    out.push_str(&format!(
        "let {lenvar} = trussbars_core::Each::each_len({subvar});\n"
    ));
    out.push_str(&format!("if {lenvar} == 0 {{\n"));
    emit_nodes(env, src, &e.otherwise, out)?;
    out.push_str("} else {\n");
    out.push_str(&for_head); // ends with `{`
    out.push_str(&frame);
    emit_nodes(&child, src, &e.body, out)?;
    out.push_str("}\n"); // close the for
    out.push_str("}\n"); // close the else
    out.push_str("}\n"); // close the outer block
    Ok(())
}

/// Whether `App name …` (a bare reference) appears anywhere in a node subtree.
fn mentions(nodes: &[Node], name: &str) -> bool {
    nodes.iter().any(|n| node_mentions(n, name))
}

fn node_mentions(n: &Node, name: &str) -> bool {
    match n {
        Node::Output { expr, .. } => expr_mentions(expr, name),
        Node::Each(e) => {
            mentions(&e.body, name)
                || mentions(&e.otherwise, name)
                || expr_mentions(&e.subject, name)
        }
        Node::Cond(c) => {
            expr_mentions(&c.cond, name)
                || mentions(&c.body, name)
                || c.elifs
                    .iter()
                    .any(|(e, b)| expr_mentions(e, name) || mentions(b, name))
                || mentions(&c.otherwise, name)
        }
        Node::With(w) => {
            expr_mentions(&w.subject, name)
                || mentions(&w.body, name)
                || mentions(&w.otherwise, name)
        }
        Node::Let { bindings, body, .. } => {
            bindings.iter().any(|(_, e)| expr_mentions(e, name)) || mentions(body, name)
        }
        Node::PartialBlock { body, .. } => mentions(body, name),
        _ => false,
    }
}

fn expr_mentions(e: &Expr, name: &str) -> bool {
    match e {
        Expr::Lit(_) => false,
        Expr::App(n, args) => n == name || args.iter().any(|a| expr_mentions(a, name)),
    }
}

// ── expressions ───────────────────────────────────────────────────────────────

fn emit_expr(env: &Env, e: &Expr) -> Result<String, String> {
    match e {
        Expr::Lit(v) => lit(v),
        Expr::App(name, args) => emit_app(env, name, args),
    }
}

#[allow(clippy::too_many_lines)]
fn emit_app(env: &Env, name: &str, args: &[Expr]) -> Result<String, String> {
    match (name, args) {
        ("this", []) => Ok(env.scope.clone()),
        ("root", []) => Ok("__root".into()),
        ("loop", []) => env
            .loop_var
            .clone()
            .ok_or_else(|| "unsupported: 'loop' used outside an each".into()),
        ("@parentchain", []) => env
            .parents
            .first()
            .cloned()
            .ok_or_else(|| "unsupported: 'parent' used outside an enclosing block".into()),
        ("true", []) => Ok("true".into()),
        ("false", []) => Ok("false".into()),
        ("null", []) => Ok("()".into()),
        ("lookup", _) => path(env, args),
        ("not", [a]) => Ok(format!("(!{})", truthy_of(env, a)?)),
        ("and", _) => Ok(format!("({})", join_truthy(env, args, " && ")?)),
        ("or", _) => Ok(format!("({})", join_truthy(env, args, " || ")?)),
        ("eq", [a, b]) => bin_op(env, "==", a, b),
        ("ne", [a, b]) => bin_op(env, "!=", a, b),
        ("lt", [a, b]) => bin_op(env, "<", a, b),
        ("gt", [a, b]) => bin_op(env, ">", a, b),
        ("lte", [a, b]) => bin_op(env, "<=", a, b),
        ("gte", [a, b]) => bin_op(env, ">=", a, b),
        ("add", [a, b]) => bin_op(env, "+", a, b),
        ("subtract", [a, b]) => bin_op(env, "-", a, b),
        ("multiply", [a, b]) => bin_op(env, "*", a, b),
        ("divide", [a, b]) => bin_op(env, "/", a, b),
        ("modulo", [a, b]) => Ok(format!(
            "trussbars_std::modulo({}, {})",
            emit_expr(env, a)?,
            emit_expr(env, b)?
        )),
        ("safe", [a]) => Ok(format!("trussbars_std::safe(&({}))", emit_expr(env, a)?)),
        ("pluck", [items, Expr::Lit(Value::Str(key))]) => Ok(format!(
            "({}).iter().map(|__x| &__x.{key}).collect::<Vec<_>>()",
            emit_expr(env, items)?
        )),
        ("sortBy", [items, Expr::Lit(Value::Str(key))]) => Ok(format!(
            "trussbars_std::sort_by(&({}), |__x| &__x.{key})",
            emit_expr(env, items)?
        )),
        ("groupBy", [items, Expr::Lit(Value::Str(key))]) => Ok(format!(
            "trussbars_std::group_by(&({}), |__x| {{ let mut __s = String::new(); \
             trussbars_core::ToText::write_text(&__x.{key}, &mut __s); __s }})",
            emit_expr(env, items)?
        )),
        ("ternary", [c, a, b]) => Ok(format!(
            "(if {} {{ {} }} else {{ {} }})",
            env.truthy_ref(&format!("&({})", emit_expr(env, c)?)),
            emit_expr(env, a)?,
            emit_expr(env, b)?
        )),
        ("coalesce", [a, b]) => Ok(format!(
            "({}).clone().unwrap_or_else(|| ({}).clone())",
            emit_expr(env, a)?,
            emit_expr(env, b)?
        )),
        ("firstTruthy", [a, b]) => Ok(format!(
            "{{ let __t = ({}).clone(); if {} {{ __t }} else {{ ({}).clone() }} }}",
            emit_expr(env, a)?,
            env.truthy_ref("&__t"),
            emit_expr(env, b)?
        )),
        ("list", _) => {
            let es = args
                .iter()
                .map(|a| emit_expr(env, a))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("[{}]", es.join(", ")))
        }
        ("dict", _) => emit_dict(env, args),
        ("where", _) => coll_filter(env, "filter", false, args),
        ("reject", _) => coll_filter(env, "filter", true, args),
        ("some", _) => coll_filter(env, "any", false, args),
        ("every", _) => coll_filter(env, "all", false, args),
        ("find", _) => coll_find(env, args),
        _ => {
            if let Some(call) = emit_helper(env, name, args) {
                call
            } else if args.is_empty() && env.params.contains_key(name) {
                Ok(env.params[name].clone())
            } else if env.helpers.contains(name) {
                // A declared host helper (F3): a call to a host Rust fn of that name.
                emit_host_call(env, name, args)
            } else if args.is_empty() {
                Err(format!("unsupported: expression head '{name}'"))
            } else {
                Err(format!(
                    "unknown helper '{name}' (declare it with `truss_helpers` if it is a host helper)"
                ))
            }
        }
    }
}

/// Emit a dict literal `{k0: v0, …}` (desugared `dict "k0" v0 …`) as a typed record:
/// a block-local **generic** struct whose field types are inferred at instantiation,
/// returned as a value. So `{{#with {a: 1} as |c|}}{{c.a}}{{/with}}` re-roots to the
/// struct and `c.a` is an ordinary field access. The struct is generic (`__Dict<F0,
/// …>`) so a field can hold any value — a literal (by value) or a path (by reference)
/// — without the emitter needing to name the type. Keys are static identifiers
/// (already enforced by the surface), so this is a closed, compile-time record.
fn emit_dict(env: &Env, args: &[Expr]) -> Result<String, String> {
    let pairs = dict_pairs(args)?;
    if pairs.is_empty() {
        // The empty dict `{}` — a fieldless unit struct (falsy; see `with_block`).
        return Ok("{ struct __Dict; __Dict }".into());
    }
    let mut generics = Vec::with_capacity(pairs.len());
    let mut decls = Vec::with_capacity(pairs.len());
    let mut inits = Vec::with_capacity(pairs.len());
    for (i, (key, val)) in pairs.iter().enumerate() {
        generics.push(format!("F{i}"));
        decls.push(format!("{key}: F{i}"));
        // A literal field is held by value; any other expression (a path) by
        // reference, so it borrows from `&ctx` rather than moving out of it.
        let v = match val {
            Expr::Lit(_) => emit_expr(env, val)?,
            _ => format!("&({})", emit_expr(env, val)?),
        };
        inits.push(format!("{key}: {v}"));
    }
    Ok(format!(
        "{{ struct __Dict<{}> {{ {} }} __Dict {{ {} }} }}",
        generics.join(", "),
        decls.join(", "),
        inits.join(", ")
    ))
}

/// The `(key, value)` pairs of a `dict` application: alternating string-literal keys
/// and value expressions. A computed (non-literal) key is rejected (the surface only
/// produces literal keys, but be explicit).
fn dict_pairs(args: &[Expr]) -> Result<Vec<(&str, &Expr)>, String> {
    if !args.len().is_multiple_of(2) {
        return Err("unsupported: dict literal with a dangling key".into());
    }
    args.chunks_exact(2)
        .map(|kv| match &kv[0] {
            Expr::Lit(Value::Str(k)) => Ok((k.as_str(), &kv[1])),
            _ => Err("unsupported: dict literal with a computed key".into()),
        })
        .collect()
}

/// The field count of a dict-literal expression (`Some(n)`), else `None`. Used to
/// resolve a dict's truthiness at compile time (a synthesized struct has no `Truthy`
/// impl, but a non-empty dict literal is always truthy, an empty one always falsy).
fn dict_arity(e: &Expr) -> Option<usize> {
    match e {
        Expr::App(name, args) if name == "dict" => Some(args.len() / 2),
        _ => None,
    }
}

/// Emit a declared host-helper call (F3): `name(&(arg0), &(arg1), …)`. Every argument
/// is passed by reference (the uniform convention — a string/number literal's `&&T`
/// deref-coerces, so the host fn signature is plain `&T`); the host returns any
/// `ToText` value, which the output path escapes or writes like a built-in.
fn emit_host_call(env: &Env, name: &str, args: &[Expr]) -> Result<String, String> {
    let parts = args
        .iter()
        .map(|a| Ok(format!("&({})", emit_expr(env, a)?)))
        .collect::<Result<Vec<_>, String>>()?;
    Ok(format!("{name}({})", parts.join(", ")))
}

fn join_truthy(env: &Env, args: &[Expr], sep: &str) -> Result<String, String> {
    let parts = args
        .iter()
        .map(|a| truthy_of(env, a))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(parts.join(sep))
}

fn truthy_of(env: &Env, a: &Expr) -> Result<String, String> {
    Ok(env.truthy_ref(&format!("&({})", emit_expr(env, a)?)))
}

fn bin_op(env: &Env, op: &str, a: &Expr, b: &Expr) -> Result<String, String> {
    Ok(format!(
        "({} {op} {})",
        emit_expr(env, a)?,
        emit_expr(env, b)?
    ))
}

// ── collection filters ────────────────────────────────────────────────────────

fn coll_filter(env: &Env, method: &str, negated: bool, args: &[Expr]) -> Result<String, String> {
    let Some((coll, tail)) = args.split_first() else {
        return Err("unsupported: collection filter without a collection and a predicate".into());
    };
    if tail.is_empty() {
        return Err("unsupported: collection filter without a predicate".into());
    }
    let ie = emit_expr(env, coll)?;
    let body = pred_body(env, tail)?;
    let pred = if negated { format!("!({body})") } else { body };
    let suffix = if method == "filter" {
        ".collect::<Vec<_>>()"
    } else {
        ""
    };
    Ok(format!("({ie}).iter().{method}(|__x| {pred}){suffix}"))
}

fn coll_find(env: &Env, args: &[Expr]) -> Result<String, String> {
    let Some((coll, tail)) = args.split_first() else {
        return Err("unsupported: find without a collection and a predicate".into());
    };
    if tail.is_empty() {
        return Err("unsupported: find without a predicate".into());
    }
    let ie = emit_expr(env, coll)?;
    let body = pred_body(env, tail)?;
    Ok(format!("({ie}).iter().find(|__x| {body})"))
}

fn pred_body(env: &Env, args: &[Expr]) -> Result<String, String> {
    match args {
        [Expr::Lit(Value::Str(key))] => Ok(env.truthy_ref(&format!("&__x.{key}"))),
        [Expr::Lit(Value::Str(key)), Expr::Lit(Value::Str(cmp)), val] => {
            cmp_body(key, cmp, &emit_expr(env, val)?)
        }
        _ => Err(
            "unsupported: collection-filter predicate (want `\"key\"` or `\"key\" \"cmp\" value`)"
                .into(),
        ),
    }
}

fn cmp_body(key: &str, cmp: &str, ve: &str) -> Result<String, String> {
    let field = format!("__x.{key}");
    let r = match cmp {
        "gt" => format!("{field} > {ve}"),
        "gte" => format!("{field} >= {ve}"),
        "lt" => format!("{field} < {ve}"),
        "lte" => format!("{field} <= {ve}"),
        "eq" => format!("{field} == {ve}"),
        "ne" => format!("{field} != {ve}"),
        "startsWith" => format!("{field}.starts_with({ve})"),
        "endsWith" => format!("{field}.ends_with({ve})"),
        "includes" => format!("{field}.contains({ve})"),
        other => return Err(format!("unsupported: collection comparator '{other}'")),
    };
    Ok(r)
}

// ── paths & loop chains ───────────────────────────────────────────────────────

fn path(env: &Env, args: &[Expr]) -> Result<String, String> {
    let Some((head, keys)) = args.split_first() else {
        return Err("unsupported: lookup without a subject".into());
    };
    // `loop.<field>` / `<label>.<field>` → the Loop chain.
    if let Expr::App(n, hargs) = head
        && hargs.is_empty()
    {
        if n == "loop" {
            let lvar = env
                .loop_var
                .clone()
                .ok_or_else(|| "unsupported: 'loop' used outside an each".to_string())?;
            return emit_loop_chain(&lvar, &key_strs(keys)?);
        }
        if let Some(lvar) = env.labels.get(n) {
            return emit_loop_chain(lvar, &key_strs(keys)?);
        }
    }
    // `parent` chains → the enclosing context bindings.
    if let Some(k) = parent_index(head) {
        let pvar = env.parents.get(k).ok_or_else(|| {
            "unsupported: 'parent' beyond the enclosing context depth".to_string()
        })?;
        return Ok(format!("{pvar}{}", segs(keys)?));
    }
    let base = emit_expr(env, head)?;
    Ok(format!("{base}{}", segs(keys)?))
}

fn parent_index(e: &Expr) -> Option<usize> {
    match e {
        Expr::App(n, a) if n == "@parentchain" && a.is_empty() => Some(0),
        Expr::App(n, a) => {
            if n == "lookup"
                && a.len() == 2
                && let Expr::Lit(Value::Str(s)) = &a[1]
                && s == "parent"
            {
                return parent_index(&a[0]).map(|i| i + 1);
            }
            None
        }
        Expr::Lit(_) => None,
    }
}

const LOOP_FIELDS: &[&str] = &[
    "index0", "index1", "rindex0", "rindex1", "first", "last", "length", "key",
];

fn emit_loop_chain(lvar: &str, keys: &[String]) -> Result<String, String> {
    let Some((field, hops)) = keys.split_last() else {
        return Err("unsupported: bare 'loop'".into());
    };
    if !LOOP_FIELDS.contains(&field.as_str()) {
        return Err(format!("unsupported: loop field '{field}'"));
    }
    let mut code = lvar.to_string();
    let mut opt = false;
    for hop in hops {
        match hop.as_str() {
            "root" => {
                code = if opt {
                    format!("{code}.map(|__p| __p.root())")
                } else {
                    format!("{code}.root()")
                };
            }
            "parent" => {
                code = if opt {
                    format!("{code}.and_then(|__p| __p.parent)")
                } else {
                    format!("{code}.parent")
                };
                opt = true;
            }
            other => return Err(format!("unsupported: loop hop '{other}'")),
        }
    }
    Ok(if opt {
        format!("{code}.map(|__p| __p.{field})")
    } else {
        format!("{code}.{field}")
    })
}

fn key_strs(keys: &[Expr]) -> Result<Vec<String>, String> {
    keys.iter()
        .map(|k| match k {
            Expr::Lit(Value::Str(s)) => Ok(s.clone()),
            _ => Err("unsupported: computed loop key".to_string()),
        })
        .collect()
}

fn segs(keys: &[Expr]) -> Result<String, String> {
    let mut s = String::new();
    for k in keys {
        match k {
            Expr::Lit(Value::Str(key)) => s.push_str(&format!(".{key}")),
            _ => return Err("unsupported: computed lookup (a data-derived field name)".into()),
        }
    }
    Ok(s)
}

// ── the value-helper pack ─────────────────────────────────────────────────────

#[derive(Clone, Copy)]
enum Kind {
    Ref,
    Num,
    IntArg,
}

fn emit_helper(env: &Env, name: &str, args: &[Expr]) -> Option<Result<String, String>> {
    let arity = args.len();
    let call = |fname: &str, kinds: &[Kind]| -> Option<Result<String, String>> {
        if kinds.len() != arity {
            return Some(Err(format!("unsupported: {name} with {arity} arguments")));
        }
        let parts: Result<Vec<String>, String> = kinds
            .iter()
            .zip(args)
            .map(|(k, e)| emit_kind(env, *k, e))
            .collect();
        Some(parts.map(|p| format!("trussbars_std::{fname}({})", p.join(", "))))
    };
    use Kind::{IntArg, Num, Ref};
    match name {
        "uppercase" => call("uppercase", &[Ref]),
        "lowercase" => call("lowercase", &[Ref]),
        "capitalize" => call("capitalize", &[Ref]),
        "trim" => call("trim", &[Ref]),
        "trimStart" => call("trim_start", &[Ref]),
        "trimEnd" => call("trim_end", &[Ref]),
        "append" => call("append", &[Ref, Ref]),
        "prepend" => call("prepend", &[Ref, Ref]),
        "replace" => call("replace", &[Ref, Ref, Ref]),
        "split" => call("split", &[Ref, Ref]),
        "includes" => call("includes", &[Ref, Ref]),
        "startsWith" => call("starts_with", &[Ref, Ref]),
        "endsWith" => call("ends_with", &[Ref, Ref]),
        "reverse" => call("reverse", &[Ref]),
        "slice" if arity == 3 => call("slice_range", &[Ref, IntArg, IntArg]),
        "slice" => call("slice", &[Ref, IntArg]),
        "truncate" if arity == 3 => call("truncate_with", &[Ref, IntArg, Ref]),
        "truncate" => call("truncate", &[Ref, IntArg]),
        "abs" => call("abs", &[Num]),
        "floor" => call("floor", &[Num]),
        "ceil" => call("ceil", &[Num]),
        "round" => call("round", &[Num]),
        "toFixed" => call("to_fixed", &[Num, IntArg]),
        "toInt" => call("to_int", &[Ref]),
        "toFloat" => call("to_float", &[Ref]),
        "join" => call("join", &[Ref, Ref]),
        "count" | "size" => call("count", &[Ref]),
        "at" => call("at", &[Ref, IntArg]),
        "take" => call("take", &[Ref, IntArg]),
        "takeRight" => call("take_right", &[Ref, IntArg]),
        "unique" => call("unique", &[Ref]),
        _ => None,
    }
}

fn emit_kind(env: &Env, kind: Kind, e: &Expr) -> Result<String, String> {
    match kind {
        Kind::Ref => Ok(format!("&({})", emit_expr(env, e)?)),
        Kind::Num => emit_expr(env, e),
        Kind::IntArg => match e {
            Expr::Lit(Value::Num(n)) => Ok(format!("{}", n.round() as i64)),
            _ => Ok(format!("({} as i64)", emit_expr(env, e)?)),
        },
    }
}

// ── literals ──────────────────────────────────────────────────────────────────

fn lit(v: &Value) -> Result<String, String> {
    match v {
        Value::Str(s) => Ok(rust_str(s)),
        Value::Num(n) => Ok(rust_num(*n)),
        Value::Bool(b) => Ok(if *b { "true".into() } else { "false".into() }),
        Value::Null => Ok("()".into()),
    }
}

/// An f64 literal: integer-valued numbers get a trailing `.0` so the type stays f64.
fn rust_num(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 {
        format!("{n:.1}")
    } else {
        format!("{n}")
    }
}

fn rust_str(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::{TruthMode, emit, emit_named};

    fn e(src: &str) -> String {
        emit("Ctx", src).unwrap_or_else(|err| panic!("{src:?}: {err}"))
    }

    #[test]
    fn block_helper_declared_emits_a_body_closure_call() {
        // `{{#frame}}…{{/frame}}` → `frame(|| -> String { <body> })`, written raw (block
        // output is markup; the body is already escaped inside the closure).
        let code = emit_named(
            "render",
            "Ctx",
            "{{#frame}}{{name}}{{/frame}}",
            &["frame".into()],
            TruthMode::NonEmpty,
        )
        .unwrap();
        assert!(code.contains("frame("), "{code}");
        assert!(code.contains("|| -> String"), "{code}");
        assert!(
            code.contains("trussbars_core::ToText::write_text(&(frame("),
            "{code}"
        );
    }

    #[test]
    fn block_helper_undeclared_is_a_located_error() {
        // The allow-list boundary: an undeclared block head is rejected (no host call).
        let err = emit_named(
            "render",
            "Ctx",
            "{{#frame}}x{{/frame}}",
            &[],
            TruthMode::NonEmpty,
        )
        .unwrap_err();
        assert!(err.contains("unknown helper 'frame'"), "{err}");
    }

    #[test]
    fn default_mode_emits_bare_truthy_byte_identical() {
        // The conformance invariant: under NonEmpty (the default) every truthiness
        // site stays the v1 `trussbars_core::truthy(…)` call — no `truthy_in`.
        let out = e("{{#if flag}}x{{/if}}");
        assert!(out.contains("trussbars_core::truthy(&("), "{out}");
        assert!(!out.contains("truthy_in::<"), "{out}");
    }

    #[test]
    fn non_default_mode_routes_through_truthy_in() {
        // Liquid/Handlebars route every truthiness site through the monomorphized
        // `truthy_in::<Mode, _>` so the selected policy governs the condition.
        let liquid = emit_named(
            "render",
            "Ctx",
            "{{#if flag}}x{{/if}}",
            &[],
            TruthMode::Liquid,
        )
        .unwrap();
        assert!(
            liquid.contains("trussbars_core::truthy_in::<trussbars_core::Liquid, _>(&("),
            "{liquid}"
        );
        assert!(!liquid.contains("trussbars_core::truthy(&("), "{liquid}");

        let hbs = emit_named(
            "render",
            "Ctx",
            "{{#unless done}}x{{/unless}}",
            &[],
            TruthMode::Handlebars,
        )
        .unwrap();
        assert!(
            hbs.contains("trussbars_core::truthy_in::<trussbars_core::Handlebars, _>(&("),
            "{hbs}"
        );
    }

    #[test]
    fn output_escaped_and_raw() {
        assert!(e("{{name}}").contains("trussbars_core::esc(&(ctx.name), &mut out)"));
        assert!(
            e("{{{html}}}").contains("trussbars_core::ToText::write_text(&(ctx.html), &mut out)")
        );
    }

    #[test]
    fn arithmetic_and_let() {
        let out = e("{{#let s=(multiply price qty)}}{{s}}{{/let}}");
        assert!(out.contains("let __let_s = (ctx.price * ctx.qty);"));
        assert!(out.contains("trussbars_core::esc(&(__let_s), &mut out)"));
    }

    #[test]
    fn each_elides_frame_when_loop_unused() {
        let out = e("{{#each xs}}{{this}}{{/each}}");
        assert!(!out.contains("Loop::at"), "frame should be elided");
        assert!(!out.contains(".enumerate()"), "enumerate should be dropped");
        let withmeta = e("{{#each xs}}{{loop.index1}}{{/each}}");
        assert!(withmeta.contains("Loop::at"));
        assert!(withmeta.contains(".enumerate()"));
    }

    #[test]
    fn helper_and_collection_filter() {
        assert!(e("{{name | uppercase}}").contains("trussbars_std::uppercase(&(ctx.name))"));
        assert!(
            e(r#"{{#each (where items "n" "gt" 1)}}{{this.n}}{{/each}}"#)
                .contains(".iter().filter(|__x| __x.n > 1.0)")
        );
    }

    #[test]
    fn dict_literal_synthesizes_a_struct() {
        // A dict literal (call form or `{…}`) re-roots `with` to a generic local struct.
        let out = emit("Ctx", r#"{{#with (dict "a" 1)}}{{a}}{{/with}}"#).unwrap();
        assert!(out.contains("struct __Dict<F0> { a: F0 }"));
        assert!(out.contains("__Dict { a: 1.0 }"));
        // A `let`-bound brace literal with two fields, accessed by `.key`.
        let out2 = emit("Ctx", "{{#let c={x: 1, y: \"z\"}}}{{c.x}}{{c.y}}{{/let}}").unwrap();
        assert!(out2.contains("struct __Dict<F0, F1> { x: F0, y: F1 }"));
        assert!(out2.contains("__let_c.x"));
        // A dangling key (odd token count) is still rejected.
        assert!(emit("Ctx", r#"{{ dict "a" }}"#).is_err());
        // Iterating a dict literal is rejected (the struct has no `Each` impl).
        let err = emit("Ctx", "{{#each {a: 1}}}{{this}}{{/each}}").unwrap_err();
        assert!(err.contains("cannot iterate a dict literal"), "{err}");
    }
}
