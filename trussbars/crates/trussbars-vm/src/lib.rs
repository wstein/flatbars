//! # trussbars-vm (spike)
//!
//! The **VM backend** for Trussbars (`docs/11`): a dynamic-[`Value`] **tree-walk
//! interpreter** for MaxBars that reuses the `trussbars-template` front-end
//! (lexer → parser → desugar) verbatim and only adds the eval. It serves the case
//! AOT structurally can't — templates run against data whose shape isn't known at
//! compile time.
//!
//! **This is the de-risking spike (docs/11 §4):** *tree-walk, lenient mode only.*
//! It deliberately covers a subset — text/output/paths/operators/`if`/`each`/`with`/
//! `let` + a handful of value helpers — and returns `Err` (never a wrong answer) for
//! anything not yet implemented, so the conformance harness reports coverage honestly.
//! Bytecode, the full catalog, the three render modes (incl. the required AOT-compat
//! mode), and `no_std` come *after* the approach is proven against the oracle.
//!
//! Scalars stringify through `trussbars_core::ToText` (the same ECMA-f64 path AOT
//! uses), and escaping through `trussbars_core::escape_html`, so VM output is
//! byte-identical to AOT / the oracle wherever both render.

use std::collections::BTreeMap;
use std::rc::Rc;

use trussbars_core::{ToText, escape_html};
use trussbars_template::{Cond, Each, Expr, Node, Value as Lit, With, parse};

/// A dynamic runtime value. Heap variants (`Str`/`Array`/`Object`) are **`Rc`-backed**
/// so [`Clone`] is a refcount bump, not a deep copy — the env can then hold values
/// directly and reads/iteration share rather than copy. `Object` is ordered so
/// `loop.key` iteration is deterministic.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// JSON `null` / an absent key (lenient).
    Null,
    /// A boolean.
    Bool(bool),
    /// A number (f64, like the rest of the engine).
    Num(f64),
    /// A string (shared).
    Str(Rc<str>),
    /// An array (shared).
    Array(Rc<[Value]>),
    /// An object (ordered, shared).
    Object(Rc<BTreeMap<String, Value>>),
}

impl Value {
    /// The MaxBars `nonEmpty` truthiness rule: `false`/`null`/`""`/`[]`/`{}` are falsy;
    /// numbers (incl. `0`) are truthy.
    #[must_use]
    pub fn truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Bool(b) => *b,
            Value::Num(_) => true,
            Value::Str(s) => !s.is_empty(),
            Value::Array(a) => !a.is_empty(),
            Value::Object(o) => !o.is_empty(),
        }
    }

    /// The raw (un-escaped) text of a value, byte-identical to AOT's `ToText`.
    fn raw_text(&self, out: &mut String) {
        match self {
            Value::Null => {}
            Value::Bool(b) => b.write_text(out),
            Value::Num(n) => n.write_text(out),
            Value::Str(s) => out.push_str(s),
            Value::Array(a) => {
                // Direct array output joins with `,` (matches the reference / AOT ToText).
                for (i, v) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    v.raw_text(out);
                }
            }
            Value::Object(_) => {} // bare-object output is an AOT error; spike renders empty
        }
    }

    fn from_lit(l: &Lit) -> Value {
        match l {
            Lit::Str(s) => Value::Str(Rc::from(s.as_str())),
            Lit::Num(n) => Value::Num(*n),
            Lit::Bool(b) => Value::Bool(*b),
            Lit::Null => Value::Null,
        }
    }

    fn as_num(&self) -> Result<f64, String> {
        match self {
            Value::Num(n) => Ok(*n),
            _ => Err("type error: expected a number".into()),
        }
    }
}

/// A loop frame: the `{{loop.*}}` metadata for the current iteration.
#[derive(Debug, Clone)]
struct LoopFrame {
    index0: usize,
    length: usize,
    key: Option<String>,
}

impl LoopFrame {
    fn field(&self, name: &str) -> Result<Value, String> {
        let i = self.index0;
        let n = self.length;
        Ok(match name {
            "index0" => Value::Num(i as f64),
            "index1" => Value::Num((i + 1) as f64),
            "rindex0" => Value::Num((n - 1 - i) as f64),
            "rindex1" => Value::Num((n - i) as f64),
            "first" => Value::Bool(i == 0),
            "last" => Value::Bool(i + 1 == n),
            "length" => Value::Num(n as f64),
            "key" => self.key.clone().map_or(Value::Null, |k| Value::Str(Rc::from(k.as_str()))),
            other => return Err(format!("unsupported: loop field '{other}'")),
        })
    }
}

/// The parent-context chain as an `Rc` cons-list: pushing a scope is one allocation
/// and a refcount bump (O1) — not `Vec::insert(0, …)`, which shifted the whole vector
/// (O(depth²) over a nested loop).
type Parents = Option<Rc<ParentNode>>;

struct ParentNode {
    value: Value,
    next: Parents,
}

/// The value at `depth` up the parent chain (0 = the immediately enclosing context).
fn parent_at(parents: &Parents, depth: usize) -> Option<&Value> {
    let mut cur = parents;
    let mut d = depth;
    while let Some(node) = cur {
        if d == 0 {
            return Some(&node.value);
        }
        d -= 1;
        cur = &node.next;
    }
    None
}

/// The render environment threaded through eval. Because [`Value`] is cheap to clone
/// (Rc-backed heap), the env holds values directly — entering a block scope is a
/// handful of refcount bumps, not a deep copy of the data.
#[derive(Clone)]
struct Env {
    this: Value,
    root: Value,
    params: BTreeMap<String, Value>,
    parents: Parents,
    loop_frame: Option<LoopFrame>,
    labels: BTreeMap<String, LoopFrame>,
}

impl Env {
    /// A child scope that re-roots `this` and pushes the old `this` onto the parent
    /// chain (O(1)).
    fn rerooted(&self, new_this: Value) -> Env {
        let mut child = self.clone();
        child.parents = Some(Rc::new(ParentNode { value: self.this.clone(), next: self.parents.clone() }));
        child.this = new_this;
        child
    }
}

/// A **parsed template** — parse + desugar once, render many.
pub struct Template {
    nodes: Vec<Node>,
}

impl Template {
    /// Parse + desugar a MaxBars template (the `trussbars-template` front-end).
    ///
    /// # Errors
    /// The parse-error reason.
    pub fn parse(src: &str) -> Result<Template, String> {
        Ok(Template { nodes: parse(src).map_err(|e| e.message)? })
    }

    /// Render this template against dynamic `data` (lenient mode). Cloning `data` into
    /// the env is cheap (refcount bumps), so a host may reuse one `Value` across renders.
    ///
    /// # Errors
    /// A reason string for an unimplemented construct/helper (never a wrong answer).
    pub fn render(&self, data: &Value) -> Result<String, String> {
        let env = Env {
            this: data.clone(),
            root: data.clone(),
            params: BTreeMap::new(),
            parents: None,
            loop_frame: None,
            labels: BTreeMap::new(),
        };
        let mut out = String::new();
        eval_nodes(&env, &self.nodes, &mut out)?;
        Ok(out)
    }
}

/// Render a MaxBars `template` against dynamic `data` (parse + render, lenient mode).
///
/// # Errors
/// Returns a reason string for a parse error or an unimplemented construct/helper
/// (the spike never returns a *wrong* answer — unknowns are errors, not guesses).
pub fn render(template: &str, data: Value) -> Result<String, String> {
    Template::parse(template)?.render(&data)
}

fn eval_nodes(env: &Env, nodes: &[Node], out: &mut String) -> Result<(), String> {
    for n in nodes {
        eval_node(env, n, out)?;
    }
    Ok(())
}

fn eval_node(env: &Env, n: &Node, out: &mut String) -> Result<(), String> {
    match n {
        Node::Text(s) => out.push_str(s),
        Node::RawBlock { body, .. } => out.push_str(body),
        Node::Output { expr, raw, .. } => {
            let v = eval_expr(env, expr)?;
            if *raw {
                v.raw_text(out);
            } else {
                let mut tmp = String::new();
                v.raw_text(&mut tmp);
                escape_html(&tmp, out);
            }
        }
        Node::Cond(c) => eval_cond(env, c, out)?,
        Node::With(w) => eval_with(env, w, out)?,
        Node::Each(e) => eval_each(env, e, out)?,
        Node::Let { bindings, body, .. } => {
            let mut child = env.clone();
            for (name, value) in bindings {
                let v = eval_expr(&child, value)?;
                child.params.insert(name.clone(), v);
            }
            eval_nodes(&child, body, out)?;
        }
        Node::Partial { .. } | Node::PartialBlock { .. } | Node::Inline { .. } | Node::Yield { .. } => {
            return Err("unsupported (spike): partials / inline / yield".into());
        }
    }
    Ok(())
}

fn eval_cond(env: &Env, c: &Cond, out: &mut String) -> Result<(), String> {
    let mut test = eval_expr(env, &c.cond)?.truthy();
    if c.negated {
        test = !test;
    }
    if test {
        return eval_nodes(env, &c.body, out);
    }
    for (econd, ebody) in &c.elifs {
        if eval_expr(env, econd)?.truthy() {
            return eval_nodes(env, ebody, out);
        }
    }
    eval_nodes(env, &c.otherwise, out)
}

fn eval_with(env: &Env, w: &With, out: &mut String) -> Result<(), String> {
    let subj = eval_expr(env, &w.subject)?;
    if subj.truthy() {
        eval_nodes(&env.rerooted(subj), &w.body, out)
    } else {
        eval_nodes(env, &w.otherwise, out)
    }
}

fn eval_each(env: &Env, e: &Each, out: &mut String) -> Result<(), String> {
    let subj = eval_expr(env, &e.subject)?;
    // (key, element) pairs — arrays have no key, objects carry their field name.
    // Element clones are refcount bumps (Rc-backed Value), not deep copies.
    let items: Vec<(Option<String>, Value)> = match &subj {
        Value::Array(a) => a.iter().map(|v| (None, v.clone())).collect(),
        Value::Object(o) => o.iter().map(|(k, v)| (Some(k.clone()), v.clone())).collect(),
        _ => Vec::new(), // non-collection → empty (lenient)
    };
    if items.is_empty() {
        return eval_nodes(env, &e.otherwise, out);
    }
    let length = items.len();
    for (i, (key, element)) in items.into_iter().enumerate() {
        let frame = LoopFrame { index0: i, length, key };
        let mut child = env.rerooted(element.clone());
        if let Some(item) = &e.item {
            child.params.insert(item.clone(), element);
        }
        if let Some(index) = &e.index {
            child.params.insert(index.clone(), Value::Num(i as f64));
        }
        if let Some(label) = &e.label {
            child.labels.insert(label.clone(), frame.clone());
        }
        child.loop_frame = Some(frame);
        eval_nodes(&child, &e.body, out)?;
    }
    Ok(())
}

fn eval_expr(env: &Env, e: &Expr) -> Result<Value, String> {
    let (name, args) = match e {
        Expr::Lit(l) => return Ok(Value::from_lit(l)),
        Expr::App(name, args) => (name.as_str(), args.as_slice()),
    };
    match (name, args) {
        ("this", []) => Ok(env.this.clone()),
        ("root", []) => Ok(env.root.clone()),
        ("true", []) => Ok(Value::Bool(true)),
        ("false", []) => Ok(Value::Bool(false)),
        ("null", []) => Ok(Value::Null),
        ("loop", []) => Err("'loop' used outside an each / in output position".into()),
        ("lookup", _) => eval_path(env, args),
        ("not", [a]) => Ok(Value::Bool(!eval_expr(env, a)?.truthy())),
        ("and", _) => Ok(Value::Bool(all_truthy(env, args, true)?)),
        ("or", _) => Ok(Value::Bool(all_truthy(env, args, false)?)),
        ("eq", [a, b]) => Ok(Value::Bool(eval_expr(env, a)? == eval_expr(env, b)?)),
        ("ne", [a, b]) => Ok(Value::Bool(eval_expr(env, a)? != eval_expr(env, b)?)),
        ("lt", [a, b]) => num_cmp(env, a, b, |x, y| x < y),
        ("gt", [a, b]) => num_cmp(env, a, b, |x, y| x > y),
        ("lte", [a, b]) => num_cmp(env, a, b, |x, y| x <= y),
        ("gte", [a, b]) => num_cmp(env, a, b, |x, y| x >= y),
        ("add", [a, b]) => num_op(env, a, b, |x, y| x + y),
        ("subtract", [a, b]) => num_op(env, a, b, |x, y| x - y),
        ("multiply", [a, b]) => num_op(env, a, b, |x, y| x * y),
        ("divide", [a, b]) => num_op(env, a, b, |x, y| x / y),
        ("modulo", [a, b]) => num_op(env, a, b, f64::rem_euclid),
        ("ternary", [c, a, b]) => {
            if eval_expr(env, c)?.truthy() { eval_expr(env, a) } else { eval_expr(env, b) }
        }
        ("coalesce", [a, b]) => {
            let av = eval_expr(env, a)?;
            if av == Value::Null { eval_expr(env, b) } else { Ok(av) }
        }
        ("firstTruthy", [a, b]) => {
            let av = eval_expr(env, a)?;
            if av.truthy() { Ok(av) } else { eval_expr(env, b) }
        }
        ("list", _) => {
            let xs: Vec<Value> = args.iter().map(|a| eval_expr(env, a)).collect::<Result<_, _>>()?;
            Ok(Value::Array(Rc::from(xs)))
        }
        _ => {
            if let Some(v) = env.params.get(name)
                && args.is_empty()
            {
                return Ok(v.clone());
            }
            eval_helper(env, name, args)
        }
    }
}

/// `lookup subject k1 k2 …` → navigate `subject` by the keys, with the loop / label /
/// parent-chain heads handled specially (mirroring the AOT `path`).
fn eval_path(env: &Env, args: &[Expr]) -> Result<Value, String> {
    let (head, keys) = args.split_first().ok_or("lookup without a subject")?;
    // loop.<field> / <label>.<field>
    if let Expr::App(h, hargs) = head
        && hargs.is_empty()
    {
        if h == "loop" {
            let frame = env.loop_frame.as_ref().ok_or("'loop' used outside an each")?;
            return loop_chain(frame, keys);
        }
        if let Some(frame) = env.labels.get(h.as_str()) {
            return loop_chain(frame, keys);
        }
    }
    // parent chains
    if let Some(depth) = parent_index(head) {
        return match parent_at(&env.parents, depth) {
            Some(base) => navigate_ref(env, base, keys),
            None => Ok(Value::Null),
        };
    }
    // Borrow the base from the env for a context-rooted path (`this`/`root`/a binding),
    // so plucking a field doesn't deep-clone the whole context object — only the leaf.
    if let Expr::App(n, a) = head
        && a.is_empty()
    {
        let base: Option<&Value> = match n.as_str() {
            "this" => Some(&env.this),
            "root" => Some(&env.root),
            other => env.params.get(other),
        };
        if let Some(base) = base {
            return navigate_ref(env, base, keys);
        }
    }
    let base = eval_expr(env, head)?;
    navigate_ref(env, &base, keys)
}

fn loop_chain(frame: &LoopFrame, keys: &[Expr]) -> Result<Value, String> {
    match keys {
        [Expr::Lit(Lit::Str(field))] => frame.field(field),
        _ => Err("unsupported (spike): loop parent/root chains or computed loop field".into()),
    }
}

/// Walk a borrowed `base` by the key expressions (a literal name → object field; a
/// number → array index), cloning only the final leaf. Missing → `Null` (lenient).
fn navigate_ref(env: &Env, base: &Value, keys: &[Expr]) -> Result<Value, String> {
    let mut cur = base;
    for k in keys {
        let key = eval_expr(env, k)?;
        cur = match (cur, &key) {
            (Value::Object(o), Value::Str(s)) => match o.get(&**s) {
                Some(v) => v,
                None => return Ok(Value::Null),
            },
            (Value::Array(a), Value::Num(n)) => match a.get(*n as usize) {
                Some(v) => v,
                None => return Ok(Value::Null),
            },
            _ => return Ok(Value::Null),
        };
    }
    Ok(cur.clone())
}

/// `@parentchain` → 0; `lookup(<inner>, "parent")` → inner depth + 1; else `None`.
fn parent_index(e: &Expr) -> Option<usize> {
    match e {
        Expr::App(n, a) if n == "@parentchain" && a.is_empty() => Some(0),
        Expr::App(n, a) if n == "lookup" && a.len() == 2 => {
            if let Expr::Lit(Lit::Str(s)) = &a[1]
                && s == "parent"
            {
                return parent_index(&a[0]).map(|i| i + 1);
            }
            None
        }
        _ => None,
    }
}

fn all_truthy(env: &Env, args: &[Expr], require_all: bool) -> Result<bool, String> {
    for a in args {
        let t = eval_expr(env, a)?.truthy();
        if require_all && !t {
            return Ok(false);
        }
        if !require_all && t {
            return Ok(true);
        }
    }
    Ok(require_all)
}

fn num_op(env: &Env, a: &Expr, b: &Expr, f: impl Fn(f64, f64) -> f64) -> Result<Value, String> {
    Ok(Value::Num(f(eval_expr(env, a)?.as_num()?, eval_expr(env, b)?.as_num()?)))
}

fn num_cmp(env: &Env, a: &Expr, b: &Expr, f: impl Fn(f64, f64) -> bool) -> Result<Value, String> {
    Ok(Value::Bool(f(eval_expr(env, a)?.as_num()?, eval_expr(env, b)?.as_num()?)))
}

/// The value-helper pack — a spike subset over `Value`. Anything not here is a
/// reported "unsupported", never a wrong answer.
fn eval_helper(env: &Env, name: &str, args: &[Expr]) -> Result<Value, String> {
    let vs: Vec<Value> = args.iter().map(|a| eval_expr(env, a)).collect::<Result<_, _>>()?;
    let s = |v: &Value| -> String {
        let mut t = String::new();
        v.raw_text(&mut t);
        t
    };
    let str_val = |t: String| Value::Str(Rc::from(t));
    match (name, vs.as_slice()) {
        ("uppercase", [a]) => Ok(str_val(s(a).to_uppercase())),
        ("lowercase", [a]) => Ok(str_val(s(a).to_lowercase())),
        ("capitalize", [a]) => {
            let t = s(a);
            let mut c = t.chars();
            Ok(str_val(c.next().map_or(String::new(), |f| f.to_uppercase().chain(c).collect())))
        }
        ("trim", [a]) => Ok(str_val(s(a).trim().to_string())),
        ("append", [a, b]) => Ok(str_val(s(a) + &s(b))),
        ("prepend", [a, b]) => Ok(str_val(s(b) + &s(a))),
        ("replace", [a, b, c]) => Ok(str_val(s(a).replace(&s(b), &s(c)))),
        ("includes", [a, b]) => Ok(Value::Bool(s(a).contains(&s(b)))),
        ("startsWith", [a, b]) => Ok(Value::Bool(s(a).starts_with(&s(b)))),
        ("endsWith", [a, b]) => Ok(Value::Bool(s(a).ends_with(&s(b)))),
        ("count" | "size", [a]) => Ok(Value::Num(match a {
            Value::Array(x) => x.len() as f64,
            Value::Object(o) => o.len() as f64,
            Value::Str(x) => x.chars().count() as f64,
            _ => 0.0,
        })),
        ("join", [Value::Array(a), sep]) => {
            let sep = s(sep);
            Ok(str_val(a.iter().map(s).collect::<Vec<_>>().join(&sep)))
        }
        _ => Err(format!("unsupported (spike): helper '{name}' / {} args", vs.len())),
    }
}

#[cfg(test)]
mod tests {
    use super::{Value, render};
    use std::collections::BTreeMap;
    use std::rc::Rc;

    fn obj(pairs: &[(&str, Value)]) -> Value {
        Value::Object(Rc::new(pairs.iter().map(|(k, v)| ((*k).to_string(), v.clone())).collect::<BTreeMap<_, _>>()))
    }

    fn arr(items: &[Value]) -> Value {
        Value::Array(Rc::from(items.to_vec()))
    }

    fn s(t: &str) -> Value {
        Value::Str(Rc::from(t))
    }

    #[test]
    fn output_escapes() {
        let d = obj(&[("name", s("<b>"))]);
        assert_eq!(render("{{name}}", d.clone()).unwrap(), "&lt;b&gt;");
        assert_eq!(render("{{{name}}}", d).unwrap(), "<b>");
    }

    #[test]
    fn if_and_each_with_loop_meta() {
        let d = obj(&[("xs", arr(&[s("a"), s("b")]))]);
        assert_eq!(render("{{#each xs}}{{loop.index1}}:{{this}} {{/each}}", d).unwrap(), "1:a 2:b ");
        let empty = obj(&[("xs", arr(&[]))]);
        assert_eq!(render("{{#each xs}}x{{else}}none{{/each}}", empty).unwrap(), "none");
    }

    #[test]
    fn paths_operators_and_let() {
        let d = obj(&[("p", obj(&[("n", Value::Num(3.0))]))]);
        assert_eq!(render("{{#if p.n > 2}}big{{else}}small{{/if}}", d.clone()).unwrap(), "big");
        assert_eq!(render("{{#let t=(multiply p.n 2)}}{{t}}{{/let}}", d).unwrap(), "6");
    }

    #[test]
    fn parent_chain_in_each() {
        let d = obj(&[("title", s("T")), ("xs", arr(&[s("a")]))]);
        assert_eq!(render("{{#each xs}}{{parent.title}}:{{this}}{{/each}}", d).unwrap(), "T:a");
    }

    #[test]
    fn helper_pipe() {
        let d = obj(&[("name", s("ann"))]);
        assert_eq!(render("{{name | uppercase}}", d).unwrap(), "ANN");
    }
}
