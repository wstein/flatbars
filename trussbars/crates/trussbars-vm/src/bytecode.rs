//! A **bytecode VM** backend (experiment, docs/11 §4). It compiles the desugared
//! MaxBars AST to a flat instruction array run by a stack machine — the alternative to
//! the tree-walk in `lib.rs`. Its purpose is **evidence**: bytecode was deferred pending
//! a measurement showing it beats the tree-walk, and this lets the benchmark answer that
//! (`trussbars/benchmarks`).
//!
//! **Subset.** It compiles only what the benchmark workloads use — text, output,
//! nested `each` (bare, `this`-bound), simple `if` (`loop.first`), and `this`/`root`/
//! field paths. Anything else returns a compile error (so it never renders a wrong
//! answer; the full ISA is only worth building if the experiment says bytecode wins).
//!
//! Shares the tree-walk's [`Value`](crate::Value) and the `field` / `write_escaped`
//! helpers, so a matching render is byte-identical (asserted in the benchmark).

use alloc::rc::Rc;
use alloc::string::String;
use alloc::vec::Vec;

use trussbars_template::{Expr, Node, Value as Lit, parse};

use crate::{Value, field, write_escaped};

/// A VM instruction. Jump targets are absolute instruction indices.
enum Op {
    /// `out.push_str(literal)`.
    Text(Rc<str>),
    /// Push the current `this`.
    PushThis,
    /// Push the root data.
    PushRoot,
    /// Pop a value, push `value.field`.
    Field(Rc<str>),
    /// Push `loop.first` (the current iteration's `index == 0`).
    LoopFirst,
    /// Pop a value, write it HTML-escaped.
    Esc,
    /// Pop a value, write it raw.
    Raw,
    /// Pop a value; if falsy, jump to the target.
    JumpIfFalsy(usize),
    /// Pop a collection; begin iterating (bind `this` to the first element); if empty,
    /// jump to the target (past the loop).
    EachStart(usize),
    /// Advance the iteration; if more, rebind `this` and jump to the body; else end.
    EachNext(usize),
}

/// A compiled template program.
pub struct Program {
    ops: Vec<Op>,
}

struct IterFrame {
    items: Rc<[Value]>,
    index: usize,
    saved_this: Value,
}

impl Program {
    /// Compile a MaxBars template to bytecode.
    ///
    /// # Errors
    /// A parse error, or a construct outside the experiment's subset.
    pub fn compile(template: &str) -> Result<Program, String> {
        Self::from_nodes(&parse(template).map_err(|e| e.message)?)
    }

    /// Compile from an already-parsed (and hoisted) node tree — lets `Template` try the
    /// fast path without re-parsing.
    ///
    /// # Errors
    /// A construct outside the experiment's subset.
    pub fn from_nodes(nodes: &[Node]) -> Result<Program, String> {
        let mut ops = Vec::new();
        compile_nodes(nodes, &mut ops)?;
        Ok(Program { ops })
    }

    /// Run the program against `data`, returning the rendered string.
    #[must_use]
    pub fn render(&self, data: &Value) -> String {
        let mut out = String::new();
        let mut stack: Vec<Value> = Vec::new();
        let mut this = data.clone();
        let mut frames: Vec<IterFrame> = Vec::new();
        let ops = &self.ops;
        let mut pc = 0;
        while pc < ops.len() {
            match &ops[pc] {
                Op::Text(s) => out.push_str(s),
                Op::PushThis => stack.push(this.clone()),
                Op::PushRoot => stack.push(data.clone()),
                Op::Field(k) => {
                    let v = stack.pop().unwrap_or(Value::Null);
                    stack.push(field(&v, k));
                }
                Op::LoopFirst => {
                    let first = frames.last().is_none_or(|f| f.index == 0);
                    stack.push(Value::Bool(first));
                }
                Op::Esc => write_escaped(&stack.pop().unwrap_or(Value::Null), &mut out),
                Op::Raw => stack.pop().unwrap_or(Value::Null).raw_text(&mut out),
                Op::JumpIfFalsy(t) => {
                    if !stack.pop().unwrap_or(Value::Null).truthy() {
                        pc = *t;
                        continue;
                    }
                }
                Op::EachStart(end) => {
                    let items = match stack.pop().unwrap_or(Value::Null) {
                        Value::Array(a) => a,
                        _ => Rc::from(Vec::new()),
                    };
                    if items.is_empty() {
                        pc = *end;
                        continue;
                    }
                    let saved = core::mem::replace(&mut this, items[0].clone());
                    frames.push(IterFrame {
                        items,
                        index: 0,
                        saved_this: saved,
                    });
                }
                Op::EachNext(body) => {
                    let frame = frames.last_mut().expect("EachNext without a frame");
                    frame.index += 1;
                    if frame.index < frame.items.len() {
                        this = frame.items[frame.index].clone();
                        pc = *body;
                        continue;
                    }
                    this = frames.pop().expect("EachNext without a frame").saved_this;
                }
            }
            pc += 1;
        }
        out
    }
}

// ── compiler (AST → bytecode) ─────────────────────────────────────────────────

fn compile_nodes(nodes: &[Node], ops: &mut Vec<Op>) -> Result<(), String> {
    for n in nodes {
        compile_node(n, ops)?;
    }
    Ok(())
}

fn compile_node(n: &Node, ops: &mut Vec<Op>) -> Result<(), String> {
    match n {
        Node::Text(s) => ops.push(Op::Text(Rc::from(s.as_str()))),
        Node::Output { expr, raw, .. } => {
            compile_expr(expr, ops)?;
            ops.push(if *raw { Op::Raw } else { Op::Esc });
        }
        Node::Each(e) => {
            if e.item.is_some() || e.index.is_some() || e.label.is_some() || !e.otherwise.is_empty()
            {
                return Err("bytecode subset: each bindings / else unsupported".into());
            }
            compile_expr(&e.subject, ops)?;
            let start = ops.len();
            ops.push(Op::EachStart(0)); // end patched below
            let body = ops.len();
            compile_nodes(&e.body, ops)?;
            ops.push(Op::EachNext(body));
            let end = ops.len();
            ops[start] = Op::EachStart(end);
        }
        Node::Cond(c) => {
            if c.negated || !c.elifs.is_empty() || !c.otherwise.is_empty() {
                return Err("bytecode subset: unless / elif / else unsupported".into());
            }
            compile_expr(&c.cond, ops)?;
            let jump = ops.len();
            ops.push(Op::JumpIfFalsy(0));
            compile_nodes(&c.body, ops)?;
            let end = ops.len();
            ops[jump] = Op::JumpIfFalsy(end);
        }
        _ => return Err("bytecode subset: unsupported node".into()),
    }
    Ok(())
}

fn compile_expr(e: &Expr, ops: &mut Vec<Op>) -> Result<(), String> {
    match e {
        Expr::App(name, args) => match (name.as_str(), args.as_slice()) {
            ("this", []) => ops.push(Op::PushThis),
            ("root", []) => ops.push(Op::PushRoot),
            ("lookup", _) => compile_path(args, ops)?,
            _ => return Err(format!("bytecode subset: expr '{name}' unsupported")),
        },
        Expr::Lit(_) => return Err("bytecode subset: literal in output unsupported".into()),
    }
    Ok(())
}

fn compile_path(args: &[Expr], ops: &mut Vec<Op>) -> Result<(), String> {
    let (head, keys) = args.split_first().ok_or("lookup without a subject")?;
    if let Expr::App(h, hargs) = head
        && hargs.is_empty()
        && h == "loop"
    {
        return match keys {
            [Expr::Lit(Lit::Str(f))] if f == "first" => {
                ops.push(Op::LoopFirst);
                Ok(())
            }
            _ => Err("bytecode subset: only loop.first supported".into()),
        };
    }
    compile_expr(head, ops)?;
    for k in keys {
        match k {
            Expr::Lit(Lit::Str(s)) => ops.push(Op::Field(Rc::from(s.as_str()))),
            _ => return Err("bytecode subset: computed key unsupported".into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Program;
    use crate::{Value, render};
    use std::collections::BTreeMap;
    use std::rc::Rc;

    fn obj(pairs: &[(&str, Value)]) -> Value {
        Value::Object(Rc::new(
            pairs
                .iter()
                .map(|(k, v)| ((*k).to_string(), v.clone()))
                .collect::<BTreeMap<_, _>>(),
        ))
    }
    fn arr(items: &[Value]) -> Value {
        Value::Array(Rc::from(items.to_vec()))
    }
    fn s(t: &str) -> Value {
        Value::Str(Rc::from(t))
    }

    /// Bytecode output must match the (proven) tree-walk byte-for-byte.
    #[test]
    fn bytecode_matches_tree_walk() {
        let cases: &[(&str, Value)] = &[
            (
                "<table>{% each rows %}<tr>{% each this %}<td>{{this}}</td>{% endeach %}</tr>{% endeach %}</table>",
                obj(&[("rows", arr(&[arr(&[s("a"), s("b")]), arr(&[s("c")])]))]),
            ),
            (
                "{% each xs %}<li class=\"{% if loop.first %}first{% endif %}\">{{this.n}}</li>{% endeach %}",
                obj(&[("xs", arr(&[obj(&[("n", s("x"))]), obj(&[("n", s("y"))])]))]),
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
}
