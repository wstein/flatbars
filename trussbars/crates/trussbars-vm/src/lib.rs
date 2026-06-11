//! # trussbars-vm — the bytecode VM
//!
//! The **bytecode VM** backend for Trussbars (`docs/11` §4): it compiles the desugared
//! MaxBars AST to a flat instruction array run by a small machine — the no-AST-pointer-
//! chasing, flat-dispatch alternative to the tree-walk [interpreter](trussbars_interp)
//! (`trussbars-interp`).
//!
//! ## First-class, full coverage (docs/11 §4.3)
//!
//! Every valid Trussbars template compiles — there is **no subset and no fallback**. The
//! architecture is a *bytecode skeleton over a shared engine*:
//!
//! - **Structure** is bytecode: `Text`, `Out`, and the `if` / `each` jump-and-loop ops
//!   (`JumpUnless`/`Jump`/`EachStart`/`EachNext`).
//! - **Expressions** (operators, ternary, pipes, value/collection helpers, literals,
//!   paths) come from the shared [`trussbars_interp::eval_expr`] against the live [`Env`],
//!   so the catalog is **single-sourced** — there is no second implementation to keep in
//!   sync, and VM output is **byte-identical** to the interpreter by construction (the
//!   conformance axis just proves the structural compiler dropped nothing).
//! - **The less-common blocks** (`with`/`scope`, `let`/`local`, `case`, partials, host
//!   block helpers, raw) render through a `Delegate` op → [`trussbars_interp::eval_nodes`]
//!   — full coverage first; promoted to native bytecode ops opportunistically (perf),
//!   never as a gate on coverage.
//!
//! It reuses [`trussbars_interp::Value`], the interpreter's [`write_escaped`] /
//! [`Value::raw_text`] writers, and its `Env`/loop machinery — which is what keeps the two
//! dynamic backends byte-identical (asserted in the tests here and in `trussbars/benchmarks`).
//!
//! [`write_escaped`]: trussbars_interp::write_escaped
//! [`Env`]: trussbars_interp::Env

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

use alloc::collections::BTreeMap;
use alloc::rc::Rc;
use alloc::string::String;
use alloc::vec::Vec;
use core::cell::Cell;

use trussbars_interp::{Env, Helpers, TruthMode, Value, eval_expr, eval_nodes, hoist, write_escaped};
use trussbars_template::{Expr, Node, Value as Lit, parse};

/// Where a fast-path resolves from: the current `this`, or the render `root`. Fixed at
/// **compile** time (a name, never data) — the injection boundary the project rests on.
#[derive(Clone, Copy)]
enum Base {
    /// The current iteration's `this` (or `root` outside any loop).
    This,
    /// The render's top-level data.
    Root,
}

/// A VM instruction. Jump targets are absolute instruction indices. The straight-line
/// structure (text, output, the `if`/`each` jump skeleton) is bytecode; expression values
/// come from the shared `trussbars_interp::eval_expr` against the live [`Env`], and the
/// less-common blocks delegate to `eval_nodes` — so the operator / helper / collection-op
/// catalog stays single-sourced (docs/11 §4.3). The `*Path` ops are the perf
/// specialization: a `this`/`root`-rooted field path resolves to a borrowed `&Value` and
/// writes it straight to the buffer — **zero clones, no shared-eval dispatch** — for the
/// dominant `{{this}}` / `{{this.field}}` hot case.
enum Op {
    /// `out.push_str(literal)`.
    Text(Rc<str>),
    /// Evaluate `expr` and write it — HTML-escaped (`raw = false`) or raw (`{{ x | safe }}`).
    Out {
        /// The output expression (evaluated against the current `Env`).
        expr: Expr,
        /// Write raw instead of HTML-escaped.
        raw: bool,
    },
    /// Fast output: borrow-resolve `base`.`keys` (a `this`/`root` field path) and write the
    /// leaf directly — no `Value` clone, no `eval_expr` dispatch.
    OutPath {
        /// Where the path starts.
        base: Base,
        /// The string field keys from `base` (empty → `base` itself).
        keys: Box<[Rc<str>]>,
        /// Write raw instead of HTML-escaped.
        raw: bool,
    },
    /// Evaluate `cond`; if it is falsy (under the render's truthiness policy), XOR
    /// `negate` (for `{% unless %}`), jump to `target`. Drives `if`/`unless`/`elif`.
    JumpUnless {
        /// The condition expression.
        cond: Expr,
        /// Negate the truthiness test (`{% unless %}`).
        negate: bool,
        /// Jump here when the (negated) test is false.
        target: usize,
    },
    /// Fast condition: borrow-resolve `base`.`keys`; if falsy (or missing), jump to
    /// `target`. The zero-clone form of a non-negated `{% if path %}`.
    JumpUnlessPath {
        /// Where the path starts.
        base: Base,
        /// The string field keys.
        keys: Box<[Rc<str>]>,
        /// Jump here when the value is falsy / missing.
        target: usize,
    },
    /// `{% if loop.first %}`: read the innermost loop frame; if **not** the first
    /// iteration, jump to `target`. The zero-eval form of the per-iteration check.
    JumpUnlessFirst(usize),
    /// Unconditional jump — skips the remaining arms of a conditional / the `{% else %}` of
    /// a non-empty loop.
    Jump(usize),
    /// Evaluate `subject`; if it is an empty / non-collection value, jump to `empty` (the
    /// `{% else %}` body); else enter the loop (push a child [`Env`] with the loop frame +
    /// the optional `item`/`index`/`label` bindings) and fall into the body.
    EachStart {
        /// The collection expression.
        subject: Expr,
        /// `{% for item … %}` — bind each element to this name.
        item: Option<Rc<str>>,
        /// `{% for item i … %}` — bind the 0-based index to this name.
        index: Option<Rc<str>>,
        /// `{% for … label name %}` — expose this loop's frame under the label.
        label: Option<Rc<str>>,
        /// Jump here when the subject is empty / not a collection.
        empty: usize,
    },
    /// Advance the innermost iteration; if more elements remain, rebind and jump back to
    /// `body`, else pop the loop context and fall through (to the post-loop `Jump`).
    EachNext(usize),
    /// `{% scope subject %}` — evaluate `subject`; if truthy, push a re-rooted child [`Env`]
    /// and fall into the body; if falsy, jump to `otherwise` (the `{% else %}` body, which
    /// runs in the *parent* scope — no push, so it is not paired with a `ScopeEnd`).
    ScopeStart {
        /// The subject to re-root onto (and test for truthiness).
        subject: Expr,
        /// Jump here when the subject is falsy.
        otherwise: usize,
    },
    /// End a truthy `{% scope %}` body: pop the re-rooted env and jump past the else body.
    ScopeEnd(usize),
    /// `{% local a=(e) b=(e)… %}` — push a child [`Env`] and bind each `(name, value)` in
    /// order (a later value sees an earlier binding), then fall into the body.
    LocalStart(Box<[(Rc<str>, Expr)]>),
    /// End a `{% local %}` body: pop the child env.
    LocalEnd,
    /// Render a node through the shared interpreter eval (the blocks not yet given native
    /// bytecode: `case`/partials/host block helpers/raw). Byte-identical by construction;
    /// promoted to native ops opportunistically (perf), never for coverage.
    Delegate(Node),
}

/// The materialized elements of an active loop — arrays index directly; an object's
/// entries are snapshotted once (so iteration is O(1) per step, not `nth(i)`).
enum Items {
    /// An array (shared, indexed directly).
    Array(Rc<[Value]>),
    /// An object's `(key, value)` entries in order.
    Object(Vec<(String, Value)>),
}

impl Items {
    fn len(&self) -> usize {
        match self {
            Items::Array(a) => a.len(),
            Items::Object(o) => o.len(),
        }
    }
    /// The `(key, element)` at index `i` — `key` is `Some` only for object iteration.
    fn at(&self, i: usize) -> (Option<&str>, &Value) {
        match self {
            Items::Array(a) => (None, &a[i]),
            Items::Object(o) => {
                let (k, v) = &o[i];
                (Some(k.as_str()), v)
            }
        }
    }
}

/// One active `each` iteration: the elements, the cursor, and the binding names to rebind
/// each step.
struct LoopState {
    items: Items,
    idx: usize,
    item: Option<Rc<str>>,
    index: Option<Rc<str>>,
}

/// A compiled template program — parse + compile once, [`render`](Program::render) many.
/// First-class, full-coverage backend (docs/11 §4.3): any valid template compiles.
pub struct Program {
    ops: Vec<Op>,
    /// The hoisted `{% inline %}` registry, shared across renders (the partial bodies the
    /// engine splices at `{% include %}`/`{% partial %}`).
    partials: Rc<BTreeMap<String, Vec<Node>>>,
    /// Adaptive output-capacity hint (mirrors the interpreter's `Template`): seed each
    /// render's buffer with the previous render's length so it grows without realloc.
    cap: Cell<usize>,
}

impl Program {
    /// Compile a Trussbars (MaxBars) template to bytecode.
    ///
    /// # Errors
    /// A parse error.
    pub fn compile(template: &str) -> Result<Program, String> {
        let nodes = parse(template).map_err(|e| e.message)?;
        let (registry, nodes) = hoist(nodes);
        let mut ops = Vec::new();
        compile_nodes(&nodes, &mut ops);
        Ok(Program {
            ops,
            partials: Rc::new(registry),
            cap: Cell::new(64),
        })
    }

    /// Compile from an already-parsed node tree (no `{% inline %}` hoisting — for callers,
    /// e.g. the benchmarks, whose templates define no inline partials).
    ///
    /// # Errors
    /// Never (kept `Result` for API stability); full coverage means no construct is
    /// rejected at compile time.
    pub fn from_nodes(nodes: &[Node]) -> Result<Program, String> {
        let mut ops = Vec::new();
        compile_nodes(nodes, &mut ops);
        Ok(Program {
            ops,
            partials: Rc::new(BTreeMap::new()),
            cap: Cell::new(64),
        })
    }

    /// Render against `data` under the default `NonEmpty` truthiness and no host helpers.
    ///
    /// # Errors
    /// An evaluation error (a type error, an unknown helper, a malformed predicate, …) —
    /// the same located reason the interpreter would return.
    pub fn render(&self, data: &Value) -> Result<String, String> {
        self.render_with(data, TruthMode::NonEmpty, &Rc::new(Helpers::new()))
    }

    /// Render against `data` under a chosen truthiness `mode` and host `helpers`.
    ///
    /// # Errors
    /// An evaluation error (see [`render`](Program::render)).
    pub fn render_with(
        &self,
        data: &Value,
        mode: TruthMode,
        helpers: &Rc<Helpers>,
    ) -> Result<String, String> {
        let mut out = String::with_capacity(self.cap.get().max(16));
        // The Env stack mirrors scope nesting: index 0 is the render root; a loop pushes a
        // child Env (with its loop frame), popped when the loop ends. The top is `this`.
        let mut envs: Vec<Env> =
            Vec::from([Env::root(data, Rc::clone(&self.partials), mode, Rc::clone(helpers))]);
        let mut loops: Vec<LoopState> = Vec::new();
        let mut pc = 0;
        while pc < self.ops.len() {
            match &self.ops[pc] {
                Op::Text(s) => out.push_str(s),
                Op::Out { expr, raw } => {
                    let v = eval_expr(envs.last().unwrap(), expr)?;
                    if *raw {
                        v.raw_text(&mut out);
                    } else {
                        write_escaped(&v, &mut out);
                    }
                }
                Op::OutPath { base, keys, raw } => {
                    if let Some(v) = resolve_path(envs.last().unwrap(), *base, keys) {
                        if *raw {
                            v.raw_text(&mut out);
                        } else {
                            write_escaped(v, &mut out);
                        }
                    }
                }
                Op::JumpUnlessPath { base, keys, target } => {
                    let falsy = resolve_path(envs.last().unwrap(), *base, keys)
                        .is_none_or(|v| !v.truthy_in(mode));
                    if falsy {
                        pc = *target;
                        continue;
                    }
                }
                Op::JumpUnlessFirst(target) => {
                    // `{% if loop.first %}` — match the interpreter, including the
                    // out-of-loop error (oracle-invalid input is skipped by conformance).
                    match envs.last().unwrap().loop_first() {
                        Some(true) => {}
                        Some(false) => {
                            pc = *target;
                            continue;
                        }
                        None => return Err("'loop' used outside an each".into()),
                    }
                }
                Op::JumpUnless {
                    cond,
                    negate,
                    target,
                } => {
                    let mut t = eval_expr(envs.last().unwrap(), cond)?.truthy_in(mode);
                    if *negate {
                        t = !t;
                    }
                    if !t {
                        pc = *target;
                        continue;
                    }
                }
                Op::Jump(target) => {
                    pc = *target;
                    continue;
                }
                Op::EachStart {
                    subject,
                    item,
                    index,
                    label,
                    empty,
                } => {
                    let subj = eval_expr(envs.last().unwrap(), subject)?;
                    let items = match subj {
                        Value::Array(a) => Items::Array(a),
                        Value::Object(o) => {
                            Items::Object(o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                        }
                        _ => {
                            pc = *empty;
                            continue;
                        }
                    };
                    let len = items.len();
                    if len == 0 {
                        pc = *empty;
                        continue;
                    }
                    let mut child = envs.last().unwrap().push_loop(len, label.as_deref());
                    let (key, elem) = items.at(0);
                    child.set_iter(0, key, elem, item.as_deref(), index.as_deref());
                    envs.push(child);
                    loops.push(LoopState {
                        items,
                        idx: 0,
                        item: item.clone(),
                        index: index.clone(),
                    });
                }
                Op::EachNext(body) => {
                    let (i, more) = {
                        let ls = loops.last_mut().unwrap();
                        ls.idx += 1;
                        (ls.idx, ls.idx < ls.items.len())
                    };
                    if more {
                        let ls = loops.last().unwrap();
                        let (key, elem) = ls.items.at(i);
                        let (item, index) = (ls.item.as_deref(), ls.index.as_deref());
                        envs.last_mut().unwrap().set_iter(i, key, elem, item, index);
                        pc = *body;
                        continue;
                    }
                    envs.pop();
                    loops.pop();
                }
                Op::ScopeStart { subject, otherwise } => {
                    let subj = eval_expr(envs.last().unwrap(), subject)?;
                    if subj.truthy_in(mode) {
                        let child = envs.last().unwrap().rerooted(subj);
                        envs.push(child);
                    } else {
                        pc = *otherwise; // the else body, in the parent scope (no push)
                        continue;
                    }
                }
                Op::ScopeEnd(target) => {
                    envs.pop();
                    pc = *target;
                    continue;
                }
                Op::LocalStart(bindings) => {
                    // A child env; each value is evaluated with the prior bindings in scope.
                    envs.push(envs.last().unwrap().clone());
                    for (name, value) in bindings.iter() {
                        let v = eval_expr(envs.last().unwrap(), value)?;
                        envs.last_mut().unwrap().bind(name, v);
                    }
                }
                Op::LocalEnd => {
                    envs.pop();
                }
                Op::Delegate(node) => {
                    eval_nodes(envs.last().unwrap(), core::slice::from_ref(node), &mut out)?;
                }
            }
            pc += 1;
        }
        self.cap.set(out.len());
        Ok(out)
    }
}

/// Borrow-resolve a `this`/`root` field path to a leaf `&Value` — the perf fast-op. Lenient
/// (a missing key / non-object segment → `None`, written as empty / treated as falsy,
/// matching the interpreter's `navigate_ref`). **Zero clones.**
fn resolve_path<'a>(env: &'a Env, base: Base, keys: &[Rc<str>]) -> Option<&'a Value> {
    let mut v = match base {
        Base::This => env.this(),
        Base::Root => env.root_value(),
    };
    for k in keys {
        match v {
            Value::Object(o) => v = o.get(&**k)?,
            _ => return None,
        }
    }
    Some(v)
}

// ── compiler (AST → bytecode) ─────────────────────────────────────────────────

fn compile_nodes(nodes: &[Node], ops: &mut Vec<Op>) {
    for n in nodes {
        compile_node(n, ops);
    }
}

/// Patch a jump op's target to `to`.
fn patch(ops: &mut [Op], at: usize, to: usize) {
    match &mut ops[at] {
        Op::JumpUnless { target, .. }
        | Op::JumpUnlessPath { target, .. }
        | Op::JumpUnlessFirst(target)
        | Op::Jump(target)
        | Op::ScopeStart { otherwise: target, .. }
        | Op::ScopeEnd(target)
        | Op::EachStart { empty: target, .. } => {
            *target = to;
        }
        _ => unreachable!("patching a non-jump op"),
    }
}

/// Classify an expression as a fast `this`/`root` field path (all-string keys), or `None`
/// for anything that needs the shared `eval_expr` (operators, helpers, literals, scope
/// params, `loop.*`, parent chains, numeric/computed indices). Mirrors `resolve_path`.
fn classify_path(e: &Expr) -> Option<(Base, Box<[Rc<str>]>)> {
    let Expr::App(name, args) = e else {
        return None;
    };
    let head_base = |h: &Expr| match h {
        Expr::App(n, a) if a.is_empty() && n == "this" => Some(Base::This),
        Expr::App(n, a) if a.is_empty() && n == "root" => Some(Base::Root),
        _ => None,
    };
    match (name.as_str(), args.as_slice()) {
        ("this", []) => Some((Base::This, Box::new([]))),
        ("root", []) => Some((Base::Root, Box::new([]))),
        ("lookup", [head, rest @ ..]) => {
            let base = head_base(head)?;
            let mut keys: Vec<Rc<str>> = Vec::with_capacity(rest.len());
            for k in rest {
                match k {
                    Expr::Lit(Lit::Str(s)) => keys.push(Rc::from(s.as_str())),
                    _ => return None, // a computed / numeric key → the general path
                }
            }
            Some((base, keys.into_boxed_slice()))
        }
        _ => None,
    }
}

/// `true` iff `cond` is exactly `loop.first` — the per-iteration check the `JumpUnlessFirst`
/// fast-op reads straight off the loop frame instead of routing through `eval_expr`.
fn is_loop_first(e: &Expr) -> bool {
    let Expr::App(name, args) = e else {
        return false;
    };
    matches!(
        (name.as_str(), args.as_slice()),
        ("lookup", [Expr::App(h, ha), Expr::Lit(Lit::Str(k))])
            if ha.is_empty() && h == "loop" && k == "first"
    )
}

/// Push a conditional jump for `cond`, preferring the borrow-based `JumpUnlessPath` fast-op
/// for a non-negated `this`/`root` path; returns the op's index (to patch its target).
fn push_jump_unless(ops: &mut Vec<Op>, cond: &Expr, negate: bool) -> usize {
    let at = ops.len();
    if !negate && is_loop_first(cond) {
        ops.push(Op::JumpUnlessFirst(0));
    } else if !negate
        && let Some((base, keys)) = classify_path(cond)
    {
        ops.push(Op::JumpUnlessPath {
            base,
            keys,
            target: 0,
        });
    } else {
        ops.push(Op::JumpUnless {
            cond: cond.clone(),
            negate,
            target: 0,
        });
    }
    at
}

fn compile_node(n: &Node, ops: &mut Vec<Op>) {
    match n {
        Node::Text(s) => ops.push(Op::Text(Rc::from(s.as_str()))),
        Node::Output { expr, raw, .. } => match classify_path(expr) {
            Some((base, keys)) => ops.push(Op::OutPath {
                base,
                keys,
                raw: *raw,
            }),
            None => ops.push(Op::Out {
                expr: expr.clone(),
                raw: *raw,
            }),
        },
        // `if`/`unless` cond body, `{% elif %}` arms, `{% else %}`. Each arm jumps to the
        // end after its body; a failed test falls to the next arm.
        Node::Cond(c) => {
            let mut to_end: Vec<usize> = Vec::new();
            let j = push_jump_unless(ops, &c.cond, c.negated);
            compile_nodes(&c.body, ops);
            to_end.push(ops.len());
            ops.push(Op::Jump(0));
            let next = ops.len();
            patch(ops, j, next);
            for (econd, ebody) in &c.elifs {
                let je = push_jump_unless(ops, econd, false);
                compile_nodes(ebody, ops);
                to_end.push(ops.len());
                ops.push(Op::Jump(0));
                let n = ops.len();
                patch(ops, je, n);
            }
            compile_nodes(&c.otherwise, ops);
            let end = ops.len();
            for ej in to_end {
                patch(ops, ej, end);
            }
        }
        // `{% for … %} body {% else %} otherwise {% endfor %}`.
        Node::For(e) => {
            let start = ops.len();
            ops.push(Op::EachStart {
                subject: e.subject.clone(),
                item: e.item.as_deref().map(Rc::from),
                index: e.index.as_deref().map(Rc::from),
                label: e.label.as_deref().map(Rc::from),
                empty: 0,
            });
            let body = ops.len();
            compile_nodes(&e.body, ops);
            ops.push(Op::EachNext(body));
            let after = ops.len();
            ops.push(Op::Jump(0)); // skip the else body after a completed (non-empty) loop
            let else_start = ops.len();
            patch(ops, start, else_start); // EachStart.empty → the else body
            compile_nodes(&e.otherwise, ops);
            let end = ops.len();
            patch(ops, after, end);
        }
        // `{% scope subject %} body {% else %} otherwise {% endscope %}` — re-root on a
        // truthy subject. The body runs in the pushed env (ScopeEnd pops); the else body
        // runs in the parent scope (no push).
        Node::With(w) => {
            let start = ops.len();
            ops.push(Op::ScopeStart {
                subject: w.subject.clone(),
                otherwise: 0,
            });
            compile_nodes(&w.body, ops);
            let scope_end = ops.len();
            ops.push(Op::ScopeEnd(0)); // pop + jump past the else body
            let else_start = ops.len();
            patch(ops, start, else_start); // ScopeStart.otherwise → the else body
            compile_nodes(&w.otherwise, ops);
            let end = ops.len();
            patch(ops, scope_end, end);
        }
        // `{% local a=… b=… %} body {% endlocal %}` — sequential block-scoped aliases.
        Node::Let { bindings, body, .. } => {
            let binds: Box<[(Rc<str>, Expr)]> = bindings
                .iter()
                .map(|(name, value)| (Rc::from(name.as_str()), value.clone()))
                .collect();
            ops.push(Op::LocalStart(binds));
            compile_nodes(body, ops);
            ops.push(Op::LocalEnd);
        }
        // The blocks not yet bytecoded (case/partials/host block helpers/raw) and any
        // leftover node render through the shared interpreter eval — full coverage.
        other => ops.push(Op::Delegate(other.clone())),
    }
}

#[cfg(test)]
mod tests {
    use super::Program;
    use std::rc::Rc;
    use trussbars_interp::{Value, render};

    fn obj(pairs: &[(&str, Value)]) -> Value {
        Value::Object(Rc::new(
            pairs
                .iter()
                .map(|(k, v)| ((*k).to_string(), v.clone()))
                .collect(),
        ))
    }
    fn arr(items: &[Value]) -> Value {
        Value::Array(Rc::from(items.to_vec()))
    }
    fn s(t: &str) -> Value {
        Value::Str(Rc::from(t))
    }

    /// VM output must match the (proven) tree-walk interpreter byte-for-byte.
    #[test]
    fn vm_matches_interpreter() {
        let cases: &[(&str, Value)] = &[
            (
                "<table>{% for rows %}<tr>{% for this %}<td>{{this}}</td>{% endfor %}</tr>{% endfor %}</table>",
                obj(&[("rows", arr(&[arr(&[s("a"), s("b")]), arr(&[s("c")])]))]),
            ),
            (
                "{% for xs %}<li class=\"{% if loop.first %}first{% endif %}\">{{this.n}}</li>{% endfor %}",
                obj(&[("xs", arr(&[obj(&[("n", s("x"))]), obj(&[("n", s("y"))])]))]),
            ),
            // root path + raw output (`| safe`) + a missing key (lenient → empty).
            (
                "{{year}}|{{html | safe}}|{{missing}}|{% for items %}[{{this}}]{% endfor %}",
                obj(&[
                    ("year", Value::Num(2026.0)),
                    ("html", s("<b>&</b>")),
                    ("items", arr(&[Value::Num(1.0), s("a<b")])),
                ]),
            ),
        ];
        for (tpl, data) in cases {
            let prog = Program::compile(tpl).unwrap_or_else(|e| panic!("{tpl}: {e}"));
            assert_eq!(
                prog.render(data).unwrap(),
                render(tpl, data.clone()).unwrap(),
                "{tpl}"
            );
        }
    }

    /// First-class coverage (docs/11 §4.3): the constructs the old subset rejected now
    /// render, and byte-identically to the interpreter (the shared engine guarantees it).
    #[test]
    fn full_coverage_matches_interpreter() {
        let cases: &[(&str, Value)] = &[
            // operators / helpers / literals in output (were `vm subset: expr unsupported`).
            ("{{ 2 | add 3 }}", Value::Null),
            ("{{ name | uppercase }}", obj(&[("name", s("ann"))])),
            ("{% if n > 2 %}big{% elif n > 0 %}mid{% else %}small{% endif %}", obj(&[("n", Value::Num(1.0))])),
            // unless (negated cond).
            ("{% if not done %}todo{% endif %}", obj(&[("done", Value::Bool(false))])),
            // each bindings + index + else; loop metadata in output.
            ("{% for x i in xs %}{{i}}:{{x}}/{{loop.last}} {% else %}none{% endfor %}", obj(&[("xs", arr(&[s("a"), s("b")]))])),
            ("{% for xs %}x{% else %}EMPTY{% endfor %}", obj(&[("xs", arr(&[]))])),
            // with / scope (re-root, native ScopeStart/ScopeEnd) — truthy body + falsy else.
            ("{% scope p %}{{n}}{% endscope %}", obj(&[("p", obj(&[("n", s("Z"))]))])),
            ("{% scope p %}{{n}}{% else %}NO:{{n}}{% endscope %}", obj(&[("p", Value::Null), ("n", s("R"))])),
            // let / local (native LocalStart/LocalEnd) — single + sequential (b sees a).
            ("{% local t=(multiply n 2) %}{{t}}{% endlocal %}", obj(&[("n", Value::Num(3.0))])),
            ("{% local a=(n) b=(add a 1) %}{{a}}-{{b}}{% endlocal %}", obj(&[("n", Value::Num(5.0))])),
            // case.
            ("{% case s %}{% when \"a\" %}A{% when \"b\" %}B{% else %}Z{% endcase %}", obj(&[("s", s("b"))])),
            // inline partial + yield.
            (r#"{% inline "card" %}<{% yield %}>{% endinline %}{% partial "card" %}hi{% endpartial %}"#, Value::Null),
            // a parent-chain path inside a loop + collection op.
            ("{% for xs %}{{parent.t}}:{{this}} {% endfor %}", obj(&[("t", s("T")), ("xs", arr(&[s("a")]))])),
        ];
        for (tpl, data) in cases {
            let prog = Program::compile(tpl).unwrap_or_else(|e| panic!("compile {tpl}: {e}"));
            assert_eq!(
                prog.render(data).unwrap_or_else(|e| panic!("render {tpl}: {e}")),
                render(tpl, data.clone()).unwrap(),
                "{tpl}"
            );
        }
    }
}
