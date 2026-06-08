//! Slice 4 — the emitter: the desugared [`Node`]/[`Expr`] tree → typed Rust
//! (`pub fn render(ctx: &T) -> String`), a transcription of the v1 reference
//! `MaxBars/Rust.purs`. The emitted code links against `trussbars-core` /
//! `trussbars-std`; the conformance corpus pins the output byte-for-byte.

use std::collections::BTreeMap;
use std::rc::Rc;

use crate::ast::{Cond, Each, Expr, Node, Value, With};
use crate::parse::parse;

/// Compile MaxBars surface `src` into a Rust `render` function over `ctx_type`.
///
/// # Errors
/// Returns the reason string for a parse error or an unsupported construct.
pub fn emit(ctx_type: &str, src: &str) -> Result<String, String> {
    let nodes = parse(src).map_err(|e| e.message)?;
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
    };
    let body = emit_nodes(&env, &top)?;
    Ok(render_fn(ctx_type, estimate_bytes(&top), &body))
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
                c.elifs = c.elifs.into_iter().map(|(e, b)| (e, hoist_into(b, reg))).collect();
                c.otherwise = hoist_into(c.otherwise, reg);
                out.push(Node::Cond(c));
            }
            Node::With(mut w) => {
                w.body = hoist_into(w.body, reg);
                w.otherwise = hoist_into(w.otherwise, reg);
                out.push(Node::With(w));
            }
            Node::Let { span, bindings, body } => {
                out.push(Node::Let { span, bindings, body: hoist_into(body, reg) });
            }
            Node::PartialBlock { span, name, ctx, body } => {
                out.push(Node::PartialBlock { span, name, ctx, body: hoist_into(body, reg) });
            }
            other => out.push(other),
        }
    }
    out
}

// ── the render-fn wrapper + capacity seed ─────────────────────────────────────

fn render_fn(ctx_type: &str, cap: usize, body: &str) -> String {
    format!(
        "pub fn render(ctx: &{ctx_type}) -> String {{\n\
         static __CAP: trussbars_core::SizeHint = trussbars_core::SizeHint::new({cap});\n\
         let __root = ctx;\n\
         let mut out = String::with_capacity(__CAP.suggest());\n\
         {body}__CAP.record(out.len());\n\
         out\n}}\n"
    )
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
                + c.elifs.iter().map(|(_, b)| estimate_bytes(b)).sum::<usize>()
                + estimate_bytes(&c.otherwise)
        }
        Node::With(w) => estimate_bytes(&w.body) + estimate_bytes(&w.otherwise),
        Node::Let { body, .. } | Node::PartialBlock { body, .. } => estimate_bytes(body),
        Node::Partial { .. } | Node::Inline { .. } => 0,
    }
}

// ── nodes ─────────────────────────────────────────────────────────────────────

fn emit_nodes(env: &Env, nodes: &[Node]) -> Result<String, String> {
    let mut out = String::new();
    for n in nodes {
        out.push_str(&emit_node(env, n)?);
    }
    Ok(out)
}

fn emit_node(env: &Env, n: &Node) -> Result<String, String> {
    match n {
        Node::Text(s) => Ok(format!("out.push_str({});\n", rust_str(s))),
        Node::Output { expr, raw, .. } => {
            let e = emit_expr(env, expr)?;
            if *raw {
                Ok(format!("trussbars_core::ToText::write_text(&({e}), &mut out);\n"))
            } else {
                Ok(format!("trussbars_core::esc(&({e}), &mut out);\n"))
            }
        }
        Node::RawBlock { body, .. } => Ok(format!("out.push_str({});\n", rust_str(body))),
        Node::Yield { .. } => yield_here(env),
        Node::Partial { name, ctx, .. } => {
            inline_partial(env, name, ctx.clone().unwrap_or_else(|| Expr::nullary("this")), None)
        }
        Node::PartialBlock { name, ctx, body, .. } => {
            let yield_code = emit_nodes(env, body)?;
            inline_partial(env, name, ctx.clone().unwrap_or_else(|| Expr::nullary("this")), Some(yield_code))
        }
        Node::Inline { .. } => Ok(String::new()), // hoisted away
        Node::Each(e) => each_block(env, e),
        Node::Cond(c) => cond_block(env, c),
        Node::With(w) => with_block(env, w),
        Node::Let { bindings, body, .. } => let_block(env, bindings, body),
    }
}

fn yield_here(env: &Env) -> Result<String, String> {
    match &env.yield_code {
        Some(code) => Ok(code.clone()),
        None => Err("unsupported: '{{yield}}' outside a block partial".into()),
    }
}

fn inline_partial(env: &Env, name: &str, ctx_e: Expr, yield_code: Option<String>) -> Result<String, String> {
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
    emit_nodes(&child, body)
}

// ── blocks ────────────────────────────────────────────────────────────────────

fn cond_block(env: &Env, c: &Cond) -> Result<String, String> {
    let prefix = if c.negated { "if !" } else { "if " };
    let cond = truthy_of(env, &c.cond)?;
    let body = emit_nodes(env, &c.body)?;
    let mut out = format!("{prefix}trussbars_core::truthy(&({cond})) {{\n{body}}}");
    for (econd, ebody) in &c.elifs {
        let ec = truthy_of(env, econd)?;
        let eb = emit_nodes(env, ebody)?;
        out.push_str(&format!(" else if trussbars_core::truthy(&({ec})) {{\n{eb}}}"));
    }
    if !c.otherwise.is_empty() {
        let ob = emit_nodes(env, &c.otherwise)?;
        out.push_str(&format!(" else {{\n{ob}}}"));
    }
    out.push('\n');
    Ok(out)
}

fn with_block(env: &Env, w: &With) -> Result<String, String> {
    // An Option-aware `with` over a `find` subject.
    if let Expr::App(name, args) = &w.subject
        && name == "find"
    {
        return with_find(env, args, &w.body, &w.otherwise);
    }
    let subj = emit_expr(env, &w.subject)?;
    let d = env.depth + 1;
    let cvar = format!("__c{d}");
    let mut child = env.clone();
    child.scope = cvar.clone();
    child.parents.insert(0, env.scope.clone());
    child.depth = d;
    let body = emit_nodes(&child, &w.body)?;
    let other = emit_nodes(env, &w.otherwise)?;
    Ok(format!(
        "{{\nlet {cvar} = &({subj});\nif trussbars_core::truthy({cvar}) {{\n{body}}} else {{\n{other}}}\n}}\n"
    ))
}

fn with_find(env: &Env, find_args: &[Expr], body: &[Node], otherwise: &[Node]) -> Result<String, String> {
    let found = coll_find(env, find_args)?;
    let d = env.depth + 1;
    let cvar = format!("__c{d}");
    let mut child = env.clone();
    child.scope = cvar.clone();
    child.parents.insert(0, env.scope.clone());
    child.depth = d;
    let b = emit_nodes(&child, body)?;
    let other = emit_nodes(env, otherwise)?;
    Ok(format!("{{\nif let Some({cvar}) = {found} {{\n{b}}} else {{\n{other}}}\n}}\n"))
}

fn let_block(env: &Env, bindings: &[(String, Expr)], body: &[Node]) -> Result<String, String> {
    let mut cur = env.clone();
    let mut lets = String::new();
    for (name, value) in bindings {
        let ve = emit_expr(&cur, value)?;
        let rust = format!("__let_{name}");
        lets.push_str(&format!("let {rust} = {ve};\n"));
        cur.params.insert(name.clone(), rust);
    }
    let b = emit_nodes(&cur, body)?;
    Ok(format!("{{\n{lets}{b}}}\n"))
}

fn each_block(env: &Env, e: &Each) -> Result<String, String> {
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
    let needs_frame = mentions(&e.body, "loop") || e.label.as_deref().is_some_and(|l| mentions(&e.body, l));
    let mut child = env.clone();
    child.scope = cvar.clone();
    child.loop_var = if needs_frame { Some(lvar.clone()) } else { None };
    child.params = params;
    child.parents.insert(0, env.scope.clone());
    child.labels = if needs_frame { labels } else { env.labels.clone() };
    child.depth = d;
    let parent_loop = env.loop_var.as_ref().map_or_else(|| "None".to_string(), |pl| format!("Some(&{pl})"));
    let need_index = needs_frame || e.index.is_some();
    let body = emit_nodes(&child, &e.body)?;
    let other = emit_nodes(env, &e.otherwise)?;
    let for_head = if need_index {
        format!("for ({ivar}, ({kvar}, {cvar})) in trussbars_core::Each::each({subvar}).enumerate() {{\n")
    } else {
        format!("for ({kvar}, {cvar}) in trussbars_core::Each::each({subvar}) {{\n")
    };
    let frame = if needs_frame {
        format!("let {lvar} = trussbars_core::Loop::at({ivar}, {lenvar}, {kvar}, {parent_loop});\n")
    } else {
        String::new()
    };
    let mut s = String::from("{\n");
    s.push_str(&format!("let {subvar} = &({subj});\n"));
    s.push_str(&format!("let {lenvar} = trussbars_core::Each::each_len({subvar});\n"));
    s.push_str(&format!("if {lenvar} == 0 {{\n{other}}} else {{\n"));
    s.push_str(&for_head); // ends with `{`
    s.push_str(&frame);
    s.push_str(&body);
    s.push_str("}\n"); // close the for
    s.push_str("}\n"); // close the else
    s.push_str("}\n"); // close the outer block
    Ok(s)
}

/// Whether `App name …` (a bare reference) appears anywhere in a node subtree.
fn mentions(nodes: &[Node], name: &str) -> bool {
    nodes.iter().any(|n| node_mentions(n, name))
}

fn node_mentions(n: &Node, name: &str) -> bool {
    match n {
        Node::Output { expr, .. } => expr_mentions(expr, name),
        Node::Each(e) => mentions(&e.body, name) || mentions(&e.otherwise, name) || expr_mentions(&e.subject, name),
        Node::Cond(c) => {
            expr_mentions(&c.cond, name)
                || mentions(&c.body, name)
                || c.elifs.iter().any(|(e, b)| expr_mentions(e, name) || mentions(b, name))
                || mentions(&c.otherwise, name)
        }
        Node::With(w) => expr_mentions(&w.subject, name) || mentions(&w.body, name) || mentions(&w.otherwise, name),
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
        ("loop", []) => env.loop_var.clone().ok_or_else(|| "unsupported: 'loop' used outside an each".into()),
        ("@parentchain", []) => {
            env.parents.first().cloned().ok_or_else(|| "unsupported: 'parent' used outside an enclosing block".into())
        }
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
        ("modulo", [a, b]) => {
            Ok(format!("trussbars_std::modulo({}, {})", emit_expr(env, a)?, emit_expr(env, b)?))
        }
        ("safe", [a]) => Ok(format!("trussbars_std::safe(&({}))", emit_expr(env, a)?)),
        ("pluck", [items, Expr::Lit(Value::Str(key))]) => {
            Ok(format!("({}).iter().map(|__x| &__x.{key}).collect::<Vec<_>>()", emit_expr(env, items)?))
        }
        ("sortBy", [items, Expr::Lit(Value::Str(key))]) => {
            Ok(format!("trussbars_std::sort_by(&({}), |__x| &__x.{key})", emit_expr(env, items)?))
        }
        ("groupBy", [items, Expr::Lit(Value::Str(key))]) => Ok(format!(
            "trussbars_std::group_by(&({}), |__x| {{ let mut __s = String::new(); \
             trussbars_core::ToText::write_text(&__x.{key}, &mut __s); __s }})",
            emit_expr(env, items)?
        )),
        ("ternary", [c, a, b]) => Ok(format!(
            "(if trussbars_core::truthy(&({})) {{ {} }} else {{ {} }})",
            emit_expr(env, c)?,
            emit_expr(env, a)?,
            emit_expr(env, b)?
        )),
        ("coalesce", [a, b]) => Ok(format!(
            "({}).clone().unwrap_or_else(|| ({}).clone())",
            emit_expr(env, a)?,
            emit_expr(env, b)?
        )),
        ("firstTruthy", [a, b]) => Ok(format!(
            "{{ let __t = ({}).clone(); if trussbars_core::truthy(&__t) {{ __t }} else {{ ({}).clone() }} }}",
            emit_expr(env, a)?,
            emit_expr(env, b)?
        )),
        ("list", _) => {
            let es = args.iter().map(|a| emit_expr(env, a)).collect::<Result<Vec<_>, _>>()?;
            Ok(format!("[{}]", es.join(", ")))
        }
        ("where", _) => coll_filter(env, "filter", false, args),
        ("reject", _) => coll_filter(env, "filter", true, args),
        ("some", _) => coll_filter(env, "any", false, args),
        ("every", _) => coll_filter(env, "all", false, args),
        ("find", _) => coll_find(env, args),
        _ => {
            if let Some(call) = emit_helper(env, name, args) {
                call
            } else if args.is_empty() {
                env.params.get(name).cloned().ok_or_else(|| format!("unsupported: expression head '{name}'"))
            } else {
                Err(format!("unsupported: helper '{name}'"))
            }
        }
    }
}

fn join_truthy(env: &Env, args: &[Expr], sep: &str) -> Result<String, String> {
    let parts = args.iter().map(|a| truthy_of(env, a)).collect::<Result<Vec<_>, _>>()?;
    Ok(parts.join(sep))
}

fn truthy_of(env: &Env, a: &Expr) -> Result<String, String> {
    Ok(format!("trussbars_core::truthy(&({}))", emit_expr(env, a)?))
}

fn bin_op(env: &Env, op: &str, a: &Expr, b: &Expr) -> Result<String, String> {
    Ok(format!("({} {op} {})", emit_expr(env, a)?, emit_expr(env, b)?))
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
    let suffix = if method == "filter" { ".collect::<Vec<_>>()" } else { "" };
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
        [Expr::Lit(Value::Str(key))] => Ok(format!("trussbars_core::truthy(&__x.{key})")),
        [Expr::Lit(Value::Str(key)), Expr::Lit(Value::Str(cmp)), val] => {
            cmp_body(key, cmp, &emit_expr(env, val)?)
        }
        _ => Err("unsupported: collection-filter predicate (want `\"key\"` or `\"key\" \"cmp\" value`)".into()),
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
            let lvar = env.loop_var.clone().ok_or_else(|| "unsupported: 'loop' used outside an each".to_string())?;
            return emit_loop_chain(&lvar, &key_strs(keys)?);
        }
        if let Some(lvar) = env.labels.get(n) {
            return emit_loop_chain(lvar, &key_strs(keys)?);
        }
    }
    // `parent` chains → the enclosing context bindings.
    if let Some(k) = parent_index(head) {
        let pvar = env.parents.get(k).ok_or_else(|| "unsupported: 'parent' beyond the enclosing context depth".to_string())?;
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

const LOOP_FIELDS: &[&str] = &["index0", "index1", "rindex0", "rindex1", "first", "last", "length", "key"];

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
                code = if opt { format!("{code}.map(|__p| __p.root())") } else { format!("{code}.root()") };
            }
            "parent" => {
                code = if opt { format!("{code}.and_then(|__p| __p.parent)") } else { format!("{code}.parent") };
                opt = true;
            }
            other => return Err(format!("unsupported: loop hop '{other}'")),
        }
    }
    Ok(if opt { format!("{code}.map(|__p| __p.{field})") } else { format!("{code}.{field}") })
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
        let parts: Result<Vec<String>, String> =
            kinds.iter().zip(args).map(|(k, e)| emit_kind(env, *k, e)).collect();
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
    use super::emit;

    fn e(src: &str) -> String {
        emit("Ctx", src).unwrap_or_else(|err| panic!("{src:?}: {err}"))
    }

    #[test]
    fn output_escaped_and_raw() {
        assert!(e("{{name}}").contains("trussbars_core::esc(&(ctx.name), &mut out)"));
        assert!(e("{{{html}}}").contains("trussbars_core::ToText::write_text(&(ctx.html), &mut out)"));
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
        assert!(e(r#"{{#each (where items "n" "gt" 1)}}{{this.n}}{{/each}}"#).contains(".iter().filter(|__x| __x.n > 1.0)"));
    }

    #[test]
    fn unsupported_dict_reports() {
        assert!(emit("Ctx", r#"{{#with (dict "a" 1)}}{{a}}{{/with}}"#).is_err());
    }
}
