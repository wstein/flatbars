//! # trussbars-vm — the bytecode VM
//!
//! The **bytecode VM** backend for Trussbars (`docs/11` §4): it compiles the desugared
//! MaxBars AST to a flat instruction array run by a small machine — the optimization
//! path the tree-walk [interpreter](trussbars_interp) (`trussbars-interp`) defers to.
//! Its purpose is **speed where it covers**: no AST pointer-chasing, flat dispatch, and
//! — crucially — a **borrow-based** evaluator that resolves paths to `&Value` references
//! and writes them straight to the output buffer, so the render hot loop performs **zero
//! `Value` clones and keeps no value stack** (only an `Rc` refcount bump per loop entry).
//!
//! ## Subset (honest coverage)
//!
//! It compiles only the dynamic constructs the benchmark workloads use — text, escaped /
//! raw output of `this`/`root`/field paths, nested bare `each` (`{% for … %}`), and a
//! plain `if` (incl. `loop.first`). Anything else returns a **compile error** (so the VM
//! never renders a wrong answer; the full instruction set is only worth building if a
//! workload proves it, `docs/11` §4.2). The covered subset is identical to what the
//! interpreter accepts for it, so output is **byte-identical** — asserted against the
//! interpreter in the tests here and in `trussbars/benchmarks`.
//!
//! It reuses [`trussbars_interp::Value`] and the interpreter's [`write_escaped`] /
//! [`Value::raw_text`] writers verbatim, which is what keeps the two dynamic backends
//! byte-identical.
//!
//! [`write_escaped`]: trussbars_interp::write_escaped

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

use alloc::boxed::Box;
use alloc::rc::Rc;
use alloc::string::String;
use alloc::vec::Vec;
use core::cell::Cell;

use trussbars_interp::{Value, write_escaped};
use trussbars_template::{Expr, Node, Value as Lit, parse};

/// Which root a resolved path starts from: the current iteration's `this`, or the
/// render's top-level `root` data. Fixed at **compile** time (a name, never data) — the
/// injection boundary the whole project rests on (`docs/11` §6).
#[derive(Clone, Copy)]
enum Base {
    /// The current `this` (the innermost loop element, or `root` outside any loop).
    This,
    /// The render's top-level data.
    Root,
}

/// A VM instruction. Jump targets are absolute instruction indices. Output and control
/// ops carry a **pre-resolved path** (`base` + the string keys) so the machine resolves
/// and writes in one step — no intermediate value stack.
enum Op {
    /// `out.push_str(literal)`.
    Text(Rc<str>),
    /// Resolve `base`.`path` and write it — HTML-escaped (`raw = false`) or raw.
    Out {
        /// Where the path starts.
        base: Base,
        /// The dotted field keys from `base` (empty → `base` itself).
        path: Box<[Rc<str>]>,
        /// Write raw (`{{{ }}}`) instead of HTML-escaped.
        raw: bool,
    },
    /// Resolve `base`.`path`; if falsy (or missing), jump to `target`.
    JumpIfFalsy {
        /// Where the path starts.
        base: Base,
        /// The dotted field keys from `base`.
        path: Box<[Rc<str>]>,
        /// Jump here when the value is falsy.
        target: usize,
    },
    /// `{% if loop.first %}`: if the current iteration is **not** the first, jump.
    JumpIfNotFirst(usize),
    /// Resolve `base`.`path` to an array and begin iterating (push a frame); if it is not
    /// a non-empty array, jump to `end` (past the loop body).
    EachStart {
        /// Where the subject path starts.
        base: Base,
        /// The dotted field keys to the collection.
        path: Box<[Rc<str>]>,
        /// Jump here when the subject is empty / not an array.
        end: usize,
    },
    /// Advance the innermost iteration; if more elements remain, jump back to `body`,
    /// else pop the frame and fall through.
    EachNext(usize),
}

/// One active `each` iteration: the (shared) array being walked and the cursor into it.
/// Holding the `Rc<[Value]>` keeps the elements alive so paths can borrow into them; the
/// clone at [`Op::EachStart`] is a single refcount bump, not a copy.
struct Frame {
    items: Rc<[Value]>,
    index: usize,
}

/// A compiled template program — parse + compile once, [`render`](Program::render) many.
pub struct Program {
    ops: Vec<Op>,
    /// Adaptive output-capacity hint (mirrors the interpreter's `Template`): seed each
    /// render's buffer with the previous render's length so it grows without realloc.
    cap: Cell<usize>,
}

impl Program {
    /// Compile a MaxBars template to bytecode.
    ///
    /// # Errors
    /// A parse error, or a construct outside the VM's covered subset.
    pub fn compile(template: &str) -> Result<Program, String> {
        Self::from_nodes(&parse(template).map_err(|e| e.message)?)
    }

    /// Compile from an already-parsed node tree — lets a caller try the VM fast path
    /// without re-parsing.
    ///
    /// # Errors
    /// A construct outside the VM's covered subset.
    pub fn from_nodes(nodes: &[Node]) -> Result<Program, String> {
        let mut ops = Vec::new();
        compile_nodes(nodes, &mut ops)?;
        Ok(Program {
            ops,
            cap: Cell::new(64),
        })
    }

    /// Run the program against `data`, returning the rendered string.
    #[must_use]
    pub fn render(&self, data: &Value) -> String {
        let mut out = String::with_capacity(self.cap.get().max(16));
        let mut frames: Vec<Frame> = Vec::new();
        let ops = &self.ops;
        let mut pc = 0;
        while pc < ops.len() {
            match &ops[pc] {
                Op::Text(s) => out.push_str(s),
                Op::Out { base, path, raw } => {
                    if let Some(v) = resolve(*base, path, &frames, data) {
                        if *raw {
                            v.raw_text(&mut out);
                        } else {
                            write_escaped(v, &mut out);
                        }
                    }
                }
                Op::JumpIfFalsy { base, path, target } => {
                    let falsy = resolve(*base, path, &frames, data).is_none_or(|v| !v.truthy());
                    if falsy {
                        pc = *target;
                        continue;
                    }
                }
                Op::JumpIfNotFirst(target) => {
                    let first = frames.last().is_none_or(|f| f.index == 0);
                    if !first {
                        pc = *target;
                        continue;
                    }
                }
                Op::EachStart { base, path, end } => {
                    let items = match resolve(*base, path, &frames, data) {
                        Some(Value::Array(a)) if !a.is_empty() => a.clone(),
                        _ => {
                            pc = *end;
                            continue;
                        }
                    };
                    frames.push(Frame { items, index: 0 });
                }
                Op::EachNext(body) => {
                    let frame = frames.last_mut().expect("EachNext without a frame");
                    frame.index += 1;
                    if frame.index < frame.items.len() {
                        pc = *body;
                        continue;
                    }
                    frames.pop();
                }
            }
            pc += 1;
        }
        self.cap.set(out.len());
        out
    }
}

/// The current `this`: the innermost active iteration's element, or `root` outside any
/// loop. A borrow into `frames` / `root` — no clone.
fn cur_this<'a>(frames: &'a [Frame], root: &'a Value) -> &'a Value {
    match frames.last() {
        Some(f) => &f.items[f.index],
        None => root,
    }
}

/// Resolve `base`.`path` to a borrowed value, or `None` if any segment is missing / not
/// an object (lenient, exactly like the interpreter's `field`). Borrow-only: no clones.
fn resolve<'a>(
    base: Base,
    path: &[Rc<str>],
    frames: &'a [Frame],
    root: &'a Value,
) -> Option<&'a Value> {
    let mut v = match base {
        Base::This => cur_this(frames, root),
        Base::Root => root,
    };
    for k in path {
        match v {
            Value::Object(o) => v = o.get(&**k)?,
            _ => return None,
        }
    }
    Some(v)
}

// ── compiler (AST → bytecode) ─────────────────────────────────────────────────

/// A path classified at compile time: either a data path (`base` + string keys) or the
/// `loop.first` flag (a control-only value, not data).
enum PathSpec {
    Data { base: Base, keys: Box<[Rc<str>]> },
    LoopFirst,
}

fn compile_nodes(nodes: &[Node], ops: &mut Vec<Op>) -> Result<(), String> {
    for n in nodes {
        compile_node(n, ops)?;
    }
    Ok(())
}

fn compile_node(n: &Node, ops: &mut Vec<Op>) -> Result<(), String> {
    match n {
        Node::Text(s) => ops.push(Op::Text(Rc::from(s.as_str()))),
        Node::Output { expr, raw, .. } => match classify(expr)? {
            PathSpec::Data { base, keys } => ops.push(Op::Out {
                base,
                path: keys,
                raw: *raw,
            }),
            PathSpec::LoopFirst => {
                return Err("vm subset: loop.first in output position unsupported".into());
            }
        },
        Node::For(e) => {
            if e.item.is_some() || e.index.is_some() || e.label.is_some() || !e.otherwise.is_empty()
            {
                return Err("vm subset: each bindings / else unsupported".into());
            }
            let PathSpec::Data { base, keys } = classify(&e.subject)? else {
                return Err("vm subset: each over loop.first unsupported".into());
            };
            let start = ops.len();
            ops.push(Op::EachStart {
                base,
                path: keys,
                end: 0,
            }); // end patched below
            let body = ops.len();
            compile_nodes(&e.body, ops)?;
            ops.push(Op::EachNext(body));
            let end = ops.len();
            if let Op::EachStart { end: slot, .. } = &mut ops[start] {
                *slot = end;
            }
        }
        Node::Cond(c) => {
            if c.negated || !c.elifs.is_empty() || !c.otherwise.is_empty() {
                return Err("vm subset: unless / elif / else unsupported".into());
            }
            let jump = ops.len();
            match classify(&c.cond)? {
                PathSpec::Data { base, keys } => ops.push(Op::JumpIfFalsy {
                    base,
                    path: keys,
                    target: 0,
                }),
                PathSpec::LoopFirst => ops.push(Op::JumpIfNotFirst(0)),
            }
            compile_nodes(&c.body, ops)?;
            let end = ops.len();
            match &mut ops[jump] {
                Op::JumpIfFalsy { target, .. } => *target = end,
                Op::JumpIfNotFirst(target) => *target = end,
                _ => unreachable!("patching a non-jump op"),
            }
        }
        _ => return Err("vm subset: unsupported node".into()),
    }
    Ok(())
}

/// Classify an output/condition expression into a [`PathSpec`], mirroring exactly what
/// the interpreter accepts for the covered subset (so the two stay byte-identical).
fn classify(e: &Expr) -> Result<PathSpec, String> {
    match e {
        Expr::App(name, args) => match (name.as_str(), args.as_slice()) {
            ("this", []) => Ok(PathSpec::Data {
                base: Base::This,
                keys: Box::new([]),
            }),
            ("root", []) => Ok(PathSpec::Data {
                base: Base::Root,
                keys: Box::new([]),
            }),
            ("lookup", _) => classify_path(args),
            _ => Err(alloc::format!("vm subset: expr '{name}' unsupported")),
        },
        Expr::Lit(_) => Err("vm subset: literal in output unsupported".into()),
    }
}

/// Classify a `lookup`-form path (a head expr + dotted string keys). The `loop.first`
/// head is the one non-data case.
fn classify_path(args: &[Expr]) -> Result<PathSpec, String> {
    let (head, keys) = args.split_first().ok_or("lookup without a subject")?;
    if let Expr::App(h, hargs) = head
        && hargs.is_empty()
        && h == "loop"
    {
        return match keys {
            [Expr::Lit(Lit::Str(f))] if f == "first" => Ok(PathSpec::LoopFirst),
            _ => Err("vm subset: only loop.first supported".into()),
        };
    }
    let PathSpec::Data { base, keys: hkeys } = classify(head)? else {
        return Err("vm subset: loop.first cannot start a path".into());
    };
    let mut all: Vec<Rc<str>> = hkeys.into_vec();
    for k in keys {
        match k {
            Expr::Lit(Lit::Str(s)) => all.push(Rc::from(s.as_str())),
            _ => return Err("vm subset: computed key unsupported".into()),
        }
    }
    Ok(PathSpec::Data {
        base,
        keys: all.into_boxed_slice(),
    })
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
                prog.render(data),
                render(tpl, data.clone()).unwrap(),
                "{tpl}"
            );
        }
    }

    /// Constructs outside the subset must be a compile error, never a wrong render.
    #[test]
    fn out_of_subset_errors() {
        // `with` block — not in the subset.
        assert!(Program::compile("{% with x %}{{this}}{% endwith %}").is_err());
        // `unless` (negated cond).
        assert!(Program::compile("{% if not x %}y{% endif %}").is_err());
    }
}
