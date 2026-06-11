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
use trussbars_template::{Expr, Node, parse};

/// A VM instruction. Jump targets are absolute instruction indices. The straight-line
/// structure (text, output, the `if`/`each` jump skeleton) is bytecode; expression values
/// come from the shared `trussbars_interp::eval_expr` against the live [`Env`], and the
/// less-common blocks delegate to `eval_nodes` — so the operator / helper / collection-op
/// catalog stays single-sourced (docs/11 §4.3).
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
    /// Render a node through the shared interpreter eval (the blocks not yet given native
    /// bytecode: `with`/`let`/`case`/partials/host block helpers/raw). Byte-identical by
    /// construction; promoted to native ops opportunistically (perf), never for coverage.
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

// ── compiler (AST → bytecode) ─────────────────────────────────────────────────

fn compile_nodes(nodes: &[Node], ops: &mut Vec<Op>) {
    for n in nodes {
        compile_node(n, ops);
    }
}

/// Patch a jump op's target to `to`.
fn patch(ops: &mut [Op], at: usize, to: usize) {
    match &mut ops[at] {
        Op::JumpUnless { target, .. } | Op::Jump(target) | Op::EachStart { empty: target, .. } => {
            *target = to;
        }
        _ => unreachable!("patching a non-jump op"),
    }
}

fn compile_node(n: &Node, ops: &mut Vec<Op>) {
    match n {
        Node::Text(s) => ops.push(Op::Text(Rc::from(s.as_str()))),
        Node::Output { expr, raw, .. } => ops.push(Op::Out {
            expr: expr.clone(),
            raw: *raw,
        }),
        // `if`/`unless` cond body, `{% elif %}` arms, `{% else %}`. Each arm jumps to the
        // end after its body; a failed test falls to the next arm.
        Node::Cond(c) => {
            let mut to_end: Vec<usize> = Vec::new();
            let j = ops.len();
            ops.push(Op::JumpUnless {
                cond: c.cond.clone(),
                negate: c.negated,
                target: 0,
            });
            compile_nodes(&c.body, ops);
            to_end.push(ops.len());
            ops.push(Op::Jump(0));
            let next = ops.len();
            patch(ops, j, next);
            for (econd, ebody) in &c.elifs {
                let je = ops.len();
                ops.push(Op::JumpUnless {
                    cond: econd.clone(),
                    negate: false,
                    target: 0,
                });
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
        // The blocks not yet bytecoded (with/let/case/partials/host block helpers/raw) and
        // any leftover node render through the shared interpreter eval — full coverage.
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
            // with / scope (re-root) and let / local (bindings) — delegated, still exact.
            ("{% scope p %}{{n}}{% endscope %}", obj(&[("p", obj(&[("n", s("Z"))]))])),
            ("{% local t=(multiply n 2) %}{{t}}{% endlocal %}", obj(&[("n", Value::Num(3.0))])),
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
