//! # trussbars-interp
//!
//! The **interpreter backend** for Trussbars (`docs/11`): a dynamic-[`Value`]
//! **tree-walk interpreter** for MaxBars that reuses the `trussbars-template`
//! front-end (lexer → parser → desugar) verbatim and only adds the eval. It serves the
//! case AOT structurally can't — templates run against data whose shape isn't known at
//! compile time. (The name is honest: this *is* a tree-walker. The optional bytecode
//! **VM** is the separate `trussbars-vm` crate, which reuses this crate's [`Value`] and
//! render helpers; `docs/11` §4.)
//!
//! **Status:** *tree-walk, lenient mode.* Covers the **whole** conformance corpus
//! (75/75 byte-matched vs the oracle, `harness.mjs --interp`): output/paths/operators,
//! `if`/`each`/`with`/`let`, loop metadata incl. `loop.parent`/`loop.root`, the value
//! helpers, the collection ops (where/reject/some/every/find/pluck/sortBy/groupBy),
//! `dict`, and partials (`{% inline %}`/`{% include %}`/`{% partial %}`/`{% yield %}`). Anything
//! genuinely unimplemented returns `Err` (never a wrong answer). Shipped since the
//! spike (docs/11): the lenient render path, host-helper
//! registration (value *and* block helpers — `{% name %}…{% endname %}`, docs/09 §3.1),
//! a **selectable truthiness policy** ([`Template::with_truthiness`] — the dynamic
//! backend's home for a runtime-swappable rule, parity with AOT's
//! `truss!(…, truthiness = Mode)`, docs/16), and `no_std` + `alloc`
//! (`--no-default-features`) so the dynamic interpreter can ship to bare-metal/WASM (f64
//! then formats via `Display`, the documented divergence; the dev `truss-interp` CLI
//! stays `std`).
//!
//! Scalars stringify through `trussbars_core::ToText` (the same ECMA-f64 path AOT
//! uses), and escaping through `trussbars_core::escape_html`, so interpreter output is
//! byte-identical to AOT / the oracle wherever both render.

#![cfg_attr(not(feature = "std"), no_std)]

#[macro_use]
extern crate alloc;

use alloc::boxed::Box;
use alloc::collections::BTreeMap;
use alloc::rc::Rc;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::cell::{Cell, RefCell};

use trussbars_core::{ToText, escape_html};
use trussbars_template::{Case, Cond, Expr, For, Node, Value as Lit, With, parse};

/// The truthiness policy a render uses — re-exported from `trussbars-template` so a host
/// selects a policy through the VM's own surface (`docs/16-truthiness-modes.md`).
pub use trussbars_template::TruthMode;

/// Euclidean remainder, `no_std`-safe (`f64::rem_euclid` is std-only). Byte-identical
/// to it: the `%` operator is in `core`, and a negative remainder is lifted by `|b|`.
fn rem_euclid(a: f64, b: f64) -> f64 {
    let r = a % b;
    if r < 0.0 { r + libm::fabs(b) } else { r }
}

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
    /// A **pre-escaped** (safe) string — the dynamic mirror of `trussbars_core::Safe`
    /// (docs/25). Carries already-HTML-escaped markup *as a value* so it survives binding,
    /// piping and re-output: `{{ x }}` emits it **verbatim** (no double-escape), unlike a
    /// plain `Str`. Produced by the internal `render`/`safe` ops; never by `from_json`.
    Safe(Rc<str>),
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
            Value::Str(s) | Value::Safe(s) => !s.is_empty(),
            Value::Array(a) => !a.is_empty(),
            Value::Object(o) => !o.is_empty(),
        }
    }

    /// Truthiness under a selected policy — the dynamic mirror of the AOT
    /// `trussbars_core::TruthyIn<Mode>` (`docs/16-truthiness-modes.md`). `NonEmpty` is
    /// the default rule above (a number is truthy). `Liquid` treats only
    /// `false`/`null` as falsy; `Handlebars` treats `0`/`NaN`/`""`/`[]` as falsy, but an
    /// object `{}` as truthy.
    #[must_use]
    pub fn truthy_in(&self, mode: TruthMode) -> bool {
        match mode {
            TruthMode::NonEmpty => self.truthy(),
            TruthMode::Liquid => !matches!(self, Value::Null | Value::Bool(false)),
            TruthMode::Handlebars => match self {
                Value::Null => false,
                Value::Bool(b) => *b,
                Value::Num(n) => *n != 0.0 && !n.is_nan(),
                Value::Str(s) | Value::Safe(s) => !s.is_empty(),
                Value::Array(a) => !a.is_empty(),
                Value::Object(_) => true,
            },
        }
    }

    /// The raw (un-escaped) text of a value, byte-identical to AOT's `ToText`. Public so
    /// the sibling `trussbars-vm` (bytecode) crate writes raw output through the exact
    /// same path, keeping the two dynamic backends byte-identical.
    pub fn raw_text(&self, out: &mut String) {
        match self {
            Value::Null => {}
            Value::Bool(b) => b.write_text(out),
            Value::Num(n) => n.write_text(out),
            Value::Str(s) | Value::Safe(s) => out.push_str(s),
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

/// Write a value to `out` HTML-escaped, **without** an intermediate `String` (O3):
/// strings escape straight into the buffer; numbers/bools carry no HTML-special
/// characters so they write raw; arrays escape element-wise. Public so the sibling
/// `trussbars-vm` (bytecode) crate escapes through the exact same path, keeping the two
/// dynamic backends byte-identical.
pub fn write_escaped(v: &Value, out: &mut String) {
    match v {
        Value::Str(s) => escape_html(s, out),
        // A `Safe` value is already escaped — emit verbatim (the no-double-escape rule, docs/25).
        Value::Safe(s) => out.push_str(s),
        Value::Null => {}
        Value::Bool(_) | Value::Num(_) => v.raw_text(out),
        Value::Array(a) => {
            for (i, e) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_escaped(e, out);
            }
        }
        Value::Object(_) => {}
    }
}

/// A loop frame: the `{{loop.*}}` metadata for the current iteration, with an `Rc`
/// link to the enclosing loop's frame (for `loop.parent.*` / `loop.root.*`).
///
/// The two per-iteration fields (`index0`, `key`) are **interior-mutable** so one frame
/// is allocated per loop *entry* and advanced in place each cell — not re-allocated per
/// iteration. This is sound because at any instant every *active* loop's frame holds its
/// current iteration (an enclosing loop is paused while its body — incl. a nested loop —
/// runs), so `loop.*` and `loop.parent.*` read the right values; nothing captures a frame
/// past its iteration (labels live in the per-loop child scope).
#[derive(Debug)]
struct LoopFrame {
    index0: Cell<usize>,
    length: usize,
    /// The 1-based loop-nesting level (`loop.depth`, ADR-021 amendment): the
    /// enclosing frame's `depth + 1`, `1` at the outermost loop. Stored (not
    /// walked) so it matches the AOT backend's `Loop::at` derivation in O(1).
    depth: usize,
    key: RefCell<Option<String>>,
    parent: Option<Rc<LoopFrame>>,
}

impl LoopFrame {
    fn field(&self, name: &str) -> Result<Value, String> {
        let i = self.index0.get();
        let n = self.length;
        Ok(match name {
            "index0" => Value::Num(i as f64),
            "index1" => Value::Num((i + 1) as f64),
            "rindex0" => Value::Num((n - 1 - i) as f64),
            "rindex1" => Value::Num((n - i) as f64),
            "first" => Value::Bool(i == 0),
            "last" => Value::Bool(i + 1 == n),
            "length" => Value::Num(n as f64),
            "depth" => Value::Num(self.depth as f64),
            "key" => self
                .key
                .borrow()
                .as_ref()
                .map_or(Value::Null, |k| Value::Str(Rc::from(k.as_str()))),
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
/// The render context — `this`/`root`, scope bindings, the loop-frame chain, the
/// partial registry, the truthiness policy, and the host-helper table. It is the
/// interpreter's evaluation context, exposed (with [`eval_expr`]/[`eval_nodes`]) as the
/// **shared engine** the bytecode VM (`trussbars-vm`) drives, so the operator /
/// value-helper / collection-op catalog stays single-sourced (docs/11 §4.3). Fields stay
/// private; the VM navigates it through the methods below.
pub struct Env {
    this: Value,
    root: Value,
    params: BTreeMap<String, Value>,
    parents: Parents,
    loop_frame: Option<Rc<LoopFrame>>,
    labels: BTreeMap<String, Rc<LoopFrame>>,
    /// Hoisted `{% inline %}` definitions, shared across the render.
    partials: Rc<BTreeMap<String, Vec<Node>>>,
    /// The pre-rendered body a block partial splices at its `{% yield %}`.
    yield_html: Option<Rc<str>>,
    /// Partial names currently expanding (recursion guard).
    expanding: Vec<String>,
    /// The truthiness policy this render uses (the load-time setting on [`Template`];
    /// docs/16). The dynamic backend's home for a *runtime*-swappable rule.
    mode: TruthMode,
    /// The host-helper registry (F3).
    helpers: Rc<Helpers>,
}

impl Env {
    /// A root render context (no loop, no scope bindings) for `data`, with the given
    /// hoisted `partials`, truthiness `mode`, and host `helpers`. The VM builds one of
    /// these per render and drives it with [`eval_expr`]/[`eval_nodes`] + the navigation
    /// methods (docs/11 §4.3).
    #[must_use]
    pub fn root(
        data: &Value,
        partials: Rc<BTreeMap<String, Vec<Node>>>,
        mode: TruthMode,
        helpers: Rc<Helpers>,
    ) -> Env {
        Env {
            this: data.clone(),
            root: data.clone(),
            params: BTreeMap::new(),
            parents: None,
            loop_frame: None,
            labels: BTreeMap::new(),
            partials,
            yield_html: None,
            expanding: Vec::new(),
            mode,
            helpers,
        }
    }

    /// A child scope that re-roots `this` and pushes the old `this` onto the parent
    /// chain (O(1)).
    #[must_use]
    pub fn rerooted(&self, new_this: Value) -> Env {
        let mut child = self.clone();
        child.parents = Some(Rc::new(ParentNode {
            value: self.this.clone(),
            next: self.parents.clone(),
        }));
        child.this = new_this;
        child
    }

    /// Enter a loop of `length` elements (optionally `label`led): a child context with a
    /// fresh loop frame pushed and the enclosing `this` pushed onto the parent chain —
    /// allocated **once per loop entry**, then advanced each iteration with
    /// [`Env::set_iter`]. The bytecode VM drives loops through this pair (docs/11 §4.3),
    /// matching `eval_for` exactly so the two backends stay byte-identical.
    #[must_use]
    pub fn push_loop(&self, length: usize, label: Option<&str>) -> Env {
        let frame = Rc::new(LoopFrame {
            index0: Cell::new(0),
            length,
            depth: self.loop_frame.as_ref().map_or(0, |p| p.depth) + 1,
            key: RefCell::new(None),
            parent: self.loop_frame.clone(),
        });
        let mut child = self.clone();
        child.parents = Some(Rc::new(ParentNode {
            value: self.this.clone(),
            next: self.parents.clone(),
        }));
        child.loop_frame = Some(Rc::clone(&frame));
        if let Some(label) = label {
            child.labels.insert(label.to_string(), Rc::clone(&frame));
        }
        child
    }

    /// Advance a loop child (built by [`Env::push_loop`]) to iteration `i`: set `this` to
    /// `element`, advance the loop frame's `index0`/`key`, and bind the optional `item` /
    /// `index` names.
    pub fn set_iter(
        &mut self,
        i: usize,
        key: Option<&str>,
        element: &Value,
        item: Option<&str>,
        index: Option<&str>,
    ) {
        if let Some(frame) = &self.loop_frame {
            frame.index0.set(i);
            *frame.key.borrow_mut() = key.map(str::to_string);
        }
        if let Some(item) = item {
            self.params.insert(item.to_string(), element.clone());
        }
        if let Some(index) = index {
            self.params.insert(index.to_string(), Value::Num(i as f64));
        }
        self.this = element.clone();
    }

    /// Bind a `let`/`local` alias (or block param) into the current scope — the VM's
    /// `{% local %}` / block-param entry.
    pub fn bind(&mut self, name: &str, value: Value) {
        self.params.insert(name.to_string(), value);
    }

    /// The current `this` — borrowed, for the VM's zero-clone path fast-op (docs/11 §4.3).
    #[must_use]
    pub fn this(&self) -> &Value {
        &self.this
    }

    /// The render's top-level `root` data — borrowed (the VM path fast-op).
    #[must_use]
    pub fn root_value(&self) -> &Value {
        &self.root
    }

    /// `Some(true)` if the innermost loop is on its first iteration, `Some(false)` if a
    /// later one, `None` outside any loop — the VM's `{% if loop.first %}` fast-op.
    #[must_use]
    pub fn loop_first(&self) -> Option<bool> {
        self.loop_frame.as_ref().map(|f| f.index0.get() == 0)
    }
}

type HostHelper = Box<dyn Fn(&[Value]) -> Result<Value, String>>;

/// A host **block** helper (`{% name args %}body{% endname %}`): it receives the evaluated args
/// plus a `body` thunk that renders the inner template in the enclosing scope, and returns
/// the wrapped/repeated/suppressed result. The dynamic mirror of the AOT `fn name(args…,
/// body: impl Fn() -> String) -> R` convention (docs/09 §3.1).
type HostBlockHelper =
    Box<dyn Fn(&[Value], &dyn Fn() -> Result<String, String>) -> Result<Value, String>>;

/// A host-helper registry (F3, docs/11 §8). The dynamic backend's answer to custom
/// helpers and the i18n/locale pack: a runtime `name → fn(&[Value]) -> Value` table —
/// trivial here, where the AOT backend would need monomorphized codegen. Build one and
/// pass it to [`Template::render_with`].
#[derive(Default)]
pub struct Helpers {
    map: BTreeMap<String, HostHelper>,
    blocks: BTreeMap<String, HostBlockHelper>,
}

impl Helpers {
    /// An empty registry.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a host helper callable as `{{name args…}}` or `{{x | name args…}}`. It
    /// receives the *evaluated* arguments and returns a [`Value`] (or an error message,
    /// which surfaces as the render error). Chainable.
    pub fn register(
        &mut self,
        name: impl Into<String>,
        f: impl Fn(&[Value]) -> Result<Value, String> + 'static,
    ) -> &mut Self {
        self.map.insert(name.into(), Box::new(f));
        self
    }

    /// Register a host **block** helper callable as `{% name args… %}body{% endname %}`. It
    /// receives the evaluated args and a `body` thunk (render the inner template in the
    /// enclosing scope) and returns the result. Its output is emitted **raw** — block
    /// output is markup and the body is already escaped, matching AOT (docs/09 §3.1).
    /// Chainable.
    pub fn register_block(
        &mut self,
        name: impl Into<String>,
        f: impl Fn(&[Value], &dyn Fn() -> Result<String, String>) -> Result<Value, String> + 'static,
    ) -> &mut Self {
        self.blocks.insert(name.into(), Box::new(f));
        self
    }

    fn get(&self, name: &str) -> Option<&HostHelper> {
        self.map.get(name)
    }

    fn get_block(&self, name: &str) -> Option<&HostBlockHelper> {
        self.blocks.get(name)
    }
}

/// A **parsed template** — parse + desugar once, render many. Carries an adaptive
/// output-capacity hint (O2), seeded into each render's buffer so it grows without
/// re-allocating (the same trick as AOT's `SizeHint`).
pub struct Template {
    nodes: Vec<Node>,
    partials: Rc<BTreeMap<String, Vec<Node>>>,
    cap_hint: Cell<usize>,
    /// The truthiness policy every render of this template uses (a load-time setting,
    /// docs/16). Defaults to [`TruthMode::NonEmpty`]; set with [`Template::with_truthiness`].
    mode: TruthMode,
}

impl Template {
    /// Parse + desugar a MaxBars template (the `trussbars-template` front-end),
    /// hoisting `{% inline %}` definitions into the partial registry.
    ///
    /// # Errors
    /// The parse-error reason.
    pub fn parse(src: &str) -> Result<Template, String> {
        let (registry, nodes) = hoist(parse(src).map_err(|e| e.message)?);
        Ok(Template {
            nodes,
            partials: Rc::new(registry),
            cap_hint: Cell::new(64),
            mode: TruthMode::NonEmpty,
        })
    }

    /// Parse `main` plus a set of **cross-file partials** (docs/21) — the dynamic-backend twin of
    /// the AOT macro's `partials = [name = "file"]`. Each `(name, source)` is parsed and merged
    /// into the partial registry, so `{% include "name" %}` / `{% partial "name" %}` / `{% yield %}`
    /// resolve across files and an imported partial may serve as an `{% extends "name" %}` base
    /// (the inheritance flatten is deferred until the registry is built). A name bound twice (an
    /// in-source `{% inline %}` and an import, or twice in the map) is an error.
    ///
    /// # Errors
    /// The parse/flatten reason; an error inside a partial is tagged `(in partial 'name')`.
    ///
    /// (Cross-file partials read source files, so this is a `std`-only constructor — the
    /// `no_std` interpreter renders single templates via [`Template::parse`].)
    #[cfg(feature = "std")]
    pub fn parse_with_partials(
        main: &str,
        partials: &[(String, String)],
    ) -> Result<Template, String> {
        let (nodes, registry) = trussbars_template::parse_with_partials(main, partials)?;
        Ok(Template {
            nodes,
            partials: Rc::new(registry),
            cap_hint: Cell::new(64),
            mode: TruthMode::NonEmpty,
        })
    }

    /// Set the truthiness policy for every render of this template — the dynamic
    /// backend's parallel to AOT's `truss!(…, truthiness = Mode)`, carried as a
    /// load-time setting (docs/11 §8, docs/16). `NonEmpty` is the default; `Liquid` and
    /// `Handlebars` (and any policy `TruthMode` names) are out-of-conformance opt-ins.
    #[must_use]
    pub fn with_truthiness(mut self, mode: TruthMode) -> Self {
        self.mode = mode;
        self
    }

    /// Render this template against dynamic `data` (lenient mode), returning a fresh
    /// `String` seeded to the last render's length. Cloning `data` into the env is
    /// cheap (refcount bumps), so a host may reuse one `Value` across renders.
    ///
    /// # Errors
    /// A reason string for an unimplemented construct/helper (never a wrong answer).
    pub fn render(&self, data: &Value) -> Result<String, String> {
        self.render_string(data, &Rc::new(Helpers::new()))
    }

    /// Render with a host-helper registry (lenient mode, F3 / docs/11 §8). Unknown
    /// helper heads resolve against `helpers` instead of erroring.
    ///
    /// # Errors
    /// As [`Template::render`], plus any error a host helper returns.
    pub fn render_with(&self, data: &Value, helpers: &Rc<Helpers>) -> Result<String, String> {
        self.render_string(data, helpers)
    }

    fn render_string(&self, data: &Value, helpers: &Rc<Helpers>) -> Result<String, String> {
        let mut out = String::with_capacity(self.cap_hint.get().max(16));
        self.eval_root(data, &mut out, helpers)?;
        self.cap_hint.set(out.len());
        Ok(out)
    }

    /// Render (lenient) appending to a caller-owned buffer — lets a host reuse one
    /// allocation across renders (clear and re-pass the same `String`).
    ///
    /// # Errors
    /// As [`Template::render`].
    pub fn render_into(&self, data: &Value, out: &mut String) -> Result<(), String> {
        self.eval_root(data, out, &Rc::new(Helpers::new()))
    }

    fn eval_root(
        &self,
        data: &Value,
        out: &mut String,
        helpers: &Rc<Helpers>,
    ) -> Result<(), String> {
        let env = Env {
            this: data.clone(),
            root: data.clone(),
            params: BTreeMap::new(),
            parents: None,
            loop_frame: None,
            labels: BTreeMap::new(),
            partials: Rc::clone(&self.partials),
            yield_html: None,
            expanding: Vec::new(),
            mode: self.mode,
            helpers: Rc::clone(helpers),
        };
        eval_nodes(&env, &self.nodes, out)
    }
}

/// Lift every `{% inline "name" %}…{% endinline %}` definition (anywhere in the tree) into
/// a registry and return the tree with those definitions removed.
pub fn hoist(nodes: Vec<Node>) -> (BTreeMap<String, Vec<Node>>, Vec<Node>) {
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
            Node::For(mut e) => {
                e.body = hoist_into(e.body, reg);
                e.otherwise = hoist_into(e.otherwise, reg);
                out.push(Node::For(e));
            }
            Node::Cond(mut c) => {
                c.body = hoist_into(c.body, reg);
                c.elifs = c
                    .elifs
                    .into_iter()
                    .map(|(x, b)| (x, hoist_into(b, reg)))
                    .collect();
                c.otherwise = hoist_into(c.otherwise, reg);
                out.push(Node::Cond(c));
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

/// Render a MaxBars `template` against dynamic `data` (parse + render, lenient mode).
///
/// # Errors
/// Returns a reason string for a parse error or an unimplemented construct/helper
/// (the spike never returns a *wrong* answer — unknowns are errors, not guesses).
pub fn render(template: &str, data: Value) -> Result<String, String> {
    Template::parse(template)?.render(&data)
}

/// Render a run of desugared [`Node`]s into `out` against the context `env` — the shared
/// engine entry the bytecode VM delegates a block's body to (docs/11 §4.3).
///
/// # Errors
/// Propagates any evaluation error (a type error, an unknown helper/partial, a `{% yield %}`
/// outside a block partial, …).
pub fn eval_nodes(env: &Env, nodes: &[Node], out: &mut String) -> Result<(), String> {
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
                write_escaped(&v, out);
            }
        }
        Node::Cond(c) => eval_cond(env, c, out)?,
        Node::Case(c) => eval_case(env, c, out)?,
        Node::With(w) => eval_with(env, w, out)?,
        Node::For(e) => eval_for(env, e, out)?,
        Node::Let { bindings, body, .. } => {
            let mut child = env.clone();
            for (name, value) in bindings {
                let v = eval_expr(&child, value)?;
                child.params.insert(name.clone(), v);
            }
            eval_nodes(&child, body, out)?;
        }
        Node::Inline { .. } => {} // hoisted into the registry
        Node::Partial {
            name, ctx, hash, ..
        } => {
            let scope = match ctx {
                Some(e) => eval_expr(env, e)?,
                None => env.this.clone(),
            };
            // ADR-042 §8: bind the include's hash arguments as scoped parameters, so
            // the partial body's `{{p}}` resolves to the argument or its default.
            let mut params = BTreeMap::new();
            for (k, v) in hash {
                params.insert(k.clone(), eval_expr(env, v)?);
            }
            expand_partial(env, name, scope, params, env.yield_html.clone(), out)?;
        }
        Node::PartialBlock {
            name, ctx, body, ..
        } => {
            // Render the block body in the CALLER frame, then splice it at `{% yield %}`.
            let mut yielded = String::new();
            eval_nodes(env, body, &mut yielded)?;
            let scope = match ctx {
                Some(e) => eval_expr(env, e)?,
                None => env.this.clone(),
            };
            expand_partial(
                env,
                name,
                scope,
                BTreeMap::new(),
                Some(Rc::from(yielded.as_str())),
                out,
            )?;
        }
        Node::Yield { .. } => match &env.yield_html {
            Some(y) => out.push_str(y),
            None => return Err("'{% yield %}' used outside a block partial".into()),
        },
        // Host block helpers (docs/09 §3.1): the runtime mirror of AOT's body-as-closure.
        // Evaluate the args, hand the helper a `body` thunk that renders the inner nodes in
        // this scope, and write its (markup) return raw.
        Node::HelperBlock(b) => {
            let args: Vec<Value> = b
                .args
                .iter()
                .map(|a| eval_expr(env, a))
                .collect::<Result<_, _>>()?;
            match env.helpers.get_block(&b.head) {
                Some(f) => {
                    let body = || -> Result<String, String> {
                        let mut s = String::new();
                        eval_nodes(env, &b.body, &mut s)?;
                        Ok(s)
                    };
                    f(&args, &body)?.raw_text(out);
                }
                _ => {
                    return Err(format!(
                        "unsupported: block helper '{}' / {} args",
                        b.head,
                        args.len()
                    ));
                }
            }
        }
        // ADR-040 inheritance nodes are flattened away by `trussbars_template::inherit`
        // before the VM runs; reaching one here would be an internal error.
        Node::Extends { .. } | Node::Block { .. } | Node::Super { .. } => {
            return Err("internal: unresolved inheritance node reached the VM".into());
        }
    }
    Ok(())
}

/// Expand the named partial with `scope` as `this` in a fresh frame (params/loop reset,
/// like the AOT inline-expansion), with `yield_html` available to its `{% yield %}`.
fn expand_partial(
    env: &Env,
    name: &str,
    scope: Value,
    params: BTreeMap<String, Value>,
    yield_html: Option<Rc<str>>,
    out: &mut String,
) -> Result<(), String> {
    if env.expanding.iter().any(|n| n == name) {
        return Err(format!("unsupported: recursive partial '{name}'"));
    }
    let body = env
        .partials
        .get(name)
        .ok_or_else(|| format!("unsupported: unknown partial '{name}'"))?;
    let mut expanding = env.expanding.clone();
    expanding.push(name.to_string());
    let child = Env {
        // ADR-042 §8: an include's hash binds two ways — as scoped `params` (a typed
        // signature's body `{{p}}` is a scoped reference) AND merged onto the context
        // (a plain hash-include's body `{{p}}` is a `lookup this "p"`); a hash key
        // overrides a same-named context field.
        this: merge_hash(scope, &params),
        root: env.root.clone(),
        params,
        parents: None,
        loop_frame: None,
        labels: BTreeMap::new(),
        partials: Rc::clone(&env.partials),
        yield_html,
        expanding,
        mode: env.mode,
        helpers: Rc::clone(&env.helpers),
    };
    eval_nodes(&child, body, out)
}

/// Merge an include's hash onto the partial's context (ADR-042 §8) — a hash key
/// overrides a same-named context field. With a non-object context the hash *is* the
/// context (so a plain `{% include "nav" title=… %}` works at top level). Mirrors the
/// PureScript `partialH`/`mergeHash`.
fn merge_hash(scope: Value, params: &BTreeMap<String, Value>) -> Value {
    if params.is_empty() {
        return scope;
    }
    let mut m = match scope {
        Value::Object(o) => (*o).clone(),
        _ => BTreeMap::new(),
    };
    for (k, v) in params {
        m.insert(k.clone(), v.clone());
    }
    Value::Object(Rc::new(m))
}

/// Truthiness at a boolean-decision site, under the render's policy (docs/16).
fn truthy_at(env: &Env, v: &Value) -> bool {
    v.truthy_in(env.mode)
}

fn eval_cond(env: &Env, c: &Cond, out: &mut String) -> Result<(), String> {
    let mut test = truthy_at(env, &eval_expr(env, &c.cond)?);
    if c.negated {
        test = !test;
    }
    if test {
        return eval_nodes(env, &c.body, out);
    }
    for (econd, ebody) in &c.elifs {
        if truthy_at(env, &eval_expr(env, econd)?) {
            return eval_nodes(env, ebody, out);
        }
    }
    eval_nodes(env, &c.otherwise, out)
}

/// `{% case %}` — the subject is evaluated **once**, then the first `{% when %}` arm whose
/// value (any of them) equals it renders; else the `{% else %}` body (docs/12). The runtime
/// mirror of the AOT `match`.
fn eval_case(env: &Env, c: &Case, out: &mut String) -> Result<(), String> {
    let subject = eval_expr(env, &c.subject)?;
    for (values, body) in &c.arms {
        for v in values {
            if eval_expr(env, v)? == subject {
                return eval_nodes(env, body, out);
            }
        }
    }
    eval_nodes(env, &c.otherwise, out)
}

fn eval_with(env: &Env, w: &With, out: &mut String) -> Result<(), String> {
    let subj = eval_expr(env, &w.subject)?;
    if truthy_at(env, &subj) {
        eval_nodes(&env.rerooted(subj), &w.body, out)
    } else {
        eval_nodes(env, &w.otherwise, out)
    }
}

fn eval_for(env: &Env, e: &For, out: &mut String) -> Result<(), String> {
    let subj = eval_expr(env, &e.subject)?;
    let length = match &subj {
        Value::Array(a) => a.len(),
        Value::Object(o) => o.len(),
        _ => 0, // non-collection → empty (lenient)
    };
    if length == 0 {
        return eval_nodes(env, &e.otherwise, out);
    }

    // One frame + one parent-chain node + one child scope per loop ENTRY — advanced in
    // place each cell rather than re-allocated per iteration (the per-cell cost that put
    // the tree-walk well behind the bytecode VM). The frame's iteration fields are
    // interior-mutable; the pushed parent `this` is constant for the whole loop.
    let frame = Rc::new(LoopFrame {
        index0: Cell::new(0),
        length,
        depth: env.loop_frame.as_ref().map_or(0, |p| p.depth) + 1,
        key: RefCell::new(None),
        parent: env.loop_frame.clone(),
    });
    let mut child = env.clone();
    child.parents = Some(Rc::new(ParentNode {
        value: env.this.clone(),
        next: env.parents.clone(),
    }));
    child.loop_frame = Some(Rc::clone(&frame));
    if let Some(label) = &e.label {
        child.labels.insert(label.clone(), Rc::clone(&frame));
    }

    // Drive by reference — no up-front `Vec` materialization, no per-cell collection
    // copy. The boxed iterator is one allocation per loop entry; each element clone is an
    // `Rc` refcount bump.
    let items: Box<dyn Iterator<Item = (Option<&str>, &Value)>> = match &subj {
        Value::Array(a) => Box::new(a.iter().map(|v| (None, v))),
        Value::Object(o) => Box::new(o.iter().map(|(k, v)| (Some(k.as_str()), v))),
        _ => unreachable!("non-collection handled above"),
    };
    for (i, (key, element)) in items.enumerate() {
        frame.index0.set(i);
        *frame.key.borrow_mut() = key.map(str::to_string);
        if let Some(item) = &e.item {
            child.params.insert(item.clone(), element.clone());
        }
        if let Some(index) = &e.index {
            child.params.insert(index.clone(), Value::Num(i as f64));
        }
        child.this = element.clone();
        eval_nodes(&child, &e.body, out)?;
    }
    Ok(())
}

/// Evaluate a desugared [`Expr`] against the context `env` to a dynamic [`Value`] — the
/// single source of the operator / value-helper / collection-op catalog, shared with the
/// bytecode VM (docs/11 §4.3) so the two dynamic backends cannot diverge.
///
/// # Errors
/// Returns the located reason for a type error, an unknown helper, a malformed predicate,
/// or `loop`/`@parentchain` misuse.
pub fn eval_expr(env: &Env, e: &Expr) -> Result<Value, String> {
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
        ("not", [a]) => Ok(Value::Bool(!truthy_at(env, &eval_expr(env, a)?))),
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
        ("modulo", [a, b]) => num_op(env, a, b, rem_euclid),
        // numeric predicates (ADR-042). The `== 0` parity/divisibility test is
        // sign-independent, so `rem_euclid` agrees with the oracle's truncated
        // `jsMod` here; `odd` is the negation of `even`.
        ("even", [n]) => Ok(Value::Bool(
            rem_euclid(eval_expr(env, n)?.as_num()?, 2.0) == 0.0,
        )),
        ("odd", [n]) => Ok(Value::Bool(
            rem_euclid(eval_expr(env, n)?.as_num()?, 2.0) != 0.0,
        )),
        ("divisibleBy", [a, b]) => num_cmp(env, a, b, |x, y| rem_euclid(x, y) == 0.0),
        ("ternary", [c, a, b]) => {
            if truthy_at(env, &eval_expr(env, c)?) {
                eval_expr(env, a)
            } else {
                eval_expr(env, b)
            }
        }
        ("coalesce", [a, b]) => {
            let av = eval_expr(env, a)?;
            if av == Value::Null {
                eval_expr(env, b)
            } else {
                Ok(av)
            }
        }
        ("firstTruthy", [a, b]) => {
            let av = eval_expr(env, a)?;
            if truthy_at(env, &av) {
                Ok(av)
            } else {
                eval_expr(env, b)
            }
        }
        ("list", _) => {
            let xs: Vec<Value> = args
                .iter()
                .map(|a| eval_expr(env, a))
                .collect::<Result<_, _>>()?;
            Ok(Value::Array(Rc::from(xs)))
        }
        ("where", _) => coll_filter(env, args, false),
        ("reject", _) => coll_filter(env, args, true),
        ("some", _) => Ok(Value::Bool(coll_test(env, args, false)?)),
        ("every", _) => Ok(Value::Bool(coll_test(env, args, true)?)),
        ("find", _) => coll_find(env, args),
        ("pluck", [items, Expr::Lit(Lit::Str(key))]) => {
            let xs: Vec<Value> = array_of(eval_expr(env, items)?)
                .iter()
                .map(|e| field(e, key))
                .collect();
            Ok(Value::Array(Rc::from(xs)))
        }
        ("sortBy", [items, Expr::Lit(Lit::Str(key))]) => {
            let mut xs: Vec<Value> = array_of(eval_expr(env, items)?).to_vec();
            xs.sort_by(|a, b| order(&field(a, key), &field(b, key)));
            Ok(Value::Array(Rc::from(xs)))
        }
        ("groupBy", [items, Expr::Lit(Lit::Str(key))]) => {
            let mut groups: BTreeMap<String, Vec<Value>> = BTreeMap::new();
            for e in array_of(eval_expr(env, items)?).iter() {
                groups
                    .entry(stringify(&field(e, key)))
                    .or_default()
                    .push(e.clone());
            }
            let obj: BTreeMap<String, Value> = groups
                .into_iter()
                .map(|(k, vs)| (k, Value::Array(Rc::from(vs))))
                .collect();
            Ok(Value::Object(Rc::new(obj)))
        }
        ("dict", _) => {
            let mut obj = BTreeMap::new();
            for pair in args.chunks(2) {
                if let [Expr::Lit(Lit::Str(k)), v] = pair {
                    obj.insert(k.clone(), eval_expr(env, v)?);
                } else {
                    return Err("unsupported: dict keys must be string literals".into());
                }
            }
            Ok(Value::Object(Rc::new(obj)))
        }
        // ADR-25: render a hoisted `{% capture %}`/`{% apply %}` body (a synthetic `@…` inline
        // partial) to a `Safe` value, in the **current** scope — loop vars / locals / parents
        // preserved (docs/18 "surrounding context", *not* a re-rooted partial frame). The name
        // is a string literal beginning with `@`, so it is only ever the parser-emitted
        // synthetic; a user template cannot reach it and the names-static boundary holds.
        ("render", [Expr::Lit(Lit::Str(name))]) if name.starts_with('@') => {
            let partials = Rc::clone(&env.partials);
            let body = partials
                .get(name.as_str())
                .ok_or_else(|| alloc::format!("internal: unknown captured fragment '{name}'"))?;
            let mut buf = String::new();
            eval_nodes(env, body, &mut buf)?;
            Ok(Value::Safe(Rc::from(buf.as_str())))
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
            let frame = env
                .loop_frame
                .as_ref()
                .ok_or("'loop' used outside an each")?;
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

/// Resolve a `loop[.parent|.root]*.field` chain: walk the `parent`/`root` hops up the
/// frame links, then read the trailing field.
fn loop_chain(frame: &Rc<LoopFrame>, keys: &[Expr]) -> Result<Value, String> {
    let mut segs: Vec<&str> = Vec::with_capacity(keys.len());
    for k in keys {
        match k {
            Expr::Lit(Lit::Str(s)) => segs.push(s),
            _ => return Err("unsupported: computed loop field".into()),
        }
    }
    let Some((field_name, hops)) = segs.split_last() else {
        return Err("unsupported: bare 'loop'".into());
    };
    let mut cur = Rc::clone(frame);
    for hop in hops {
        cur = match *hop {
            "parent" => cur
                .parent
                .clone()
                .ok_or("'loop.parent' beyond the outermost loop")?,
            "root" => {
                let mut r = Rc::clone(&cur);
                while let Some(p) = &r.parent {
                    r = Rc::clone(p);
                }
                r
            }
            other => return Err(format!("unsupported: loop hop '{other}'")),
        };
    }
    cur.field(field_name)
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
        let t = truthy_at(env, &eval_expr(env, a)?);
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
    Ok(Value::Num(f(
        eval_expr(env, a)?.as_num()?,
        eval_expr(env, b)?.as_num()?,
    )))
}

fn num_cmp(env: &Env, a: &Expr, b: &Expr, f: impl Fn(f64, f64) -> bool) -> Result<Value, String> {
    Ok(Value::Bool(f(
        eval_expr(env, a)?.as_num()?,
        eval_expr(env, b)?.as_num()?,
    )))
}

// ── collection operations (where/reject/some/every/find/pluck/sortBy/groupBy) ──

/// The array form of a value (lenient: a non-array → empty).
fn array_of(v: Value) -> Rc<[Value]> {
    match v {
        Value::Array(a) => a,
        _ => Rc::from(Vec::new()),
    }
}

/// An object field (lenient: a non-object or missing key → `Null`).
fn field(v: &Value, key: &str) -> Value {
    match v {
        Value::Object(o) => o.get(key).cloned().unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn stringify(v: &Value) -> String {
    let mut s = String::new();
    v.raw_text(&mut s);
    s
}

/// A total order for `sortBy` (numbers numerically, strings lexically, else equal).
fn order(a: &Value, b: &Value) -> core::cmp::Ordering {
    use core::cmp::Ordering::Equal;
    match (a, b) {
        (Value::Num(x), Value::Num(y)) => x.partial_cmp(y).unwrap_or(Equal),
        (Value::Str(x) | Value::Safe(x), Value::Str(y) | Value::Safe(y)) => x.cmp(y),
        _ => Equal,
    }
}

/// A collection-filter predicate against one element: `"key"` (truthy) or
/// `"key" "cmp" value` (compare the field).
fn pred(env: &Env, elem: &Value, pargs: &[Expr]) -> Result<bool, String> {
    match pargs {
        [Expr::Lit(Lit::Str(key))] => Ok(truthy_at(env, &field(elem, key))),
        [Expr::Lit(Lit::Str(key)), Expr::Lit(Lit::Str(cmp)), val] => {
            cmp_values(&field(elem, key), cmp, &eval_expr(env, val)?)
        }
        _ => Err("unsupported: predicate (want `\"key\"` or `\"key\" \"cmp\" value`)".into()),
    }
}

fn cmp_values(a: &Value, cmp: &str, b: &Value) -> Result<bool, String> {
    Ok(match cmp {
        "eq" => a == b,
        "ne" => a != b,
        "gt" => a.as_num()? > b.as_num()?,
        "gte" => a.as_num()? >= b.as_num()?,
        "lt" => a.as_num()? < b.as_num()?,
        "lte" => a.as_num()? <= b.as_num()?,
        "startsWith" => stringify(a).starts_with(&stringify(b)),
        "endsWith" => stringify(a).ends_with(&stringify(b)),
        "includes" => stringify(a).contains(&stringify(b)),
        other => return Err(format!("unsupported: comparator '{other}'")),
    })
}

fn coll_filter(env: &Env, args: &[Expr], negate: bool) -> Result<Value, String> {
    let (coll, tail) = args
        .split_first()
        .ok_or("collection filter without a collection")?;
    let mut out = Vec::new();
    for e in array_of(eval_expr(env, coll)?).iter() {
        if pred(env, e, tail)? != negate {
            out.push(e.clone());
        }
    }
    Ok(Value::Array(Rc::from(out)))
}

fn coll_test(env: &Env, args: &[Expr], require_all: bool) -> Result<bool, String> {
    let (coll, tail) = args
        .split_first()
        .ok_or("some/every without a collection")?;
    for e in array_of(eval_expr(env, coll)?).iter() {
        let p = pred(env, e, tail)?;
        if require_all && !p {
            return Ok(false);
        }
        if !require_all && p {
            return Ok(true);
        }
    }
    Ok(require_all)
}

/// `find` returns the first matching element, or `Null` (falsy → the `{% else %}` arm).
fn coll_find(env: &Env, args: &[Expr]) -> Result<Value, String> {
    let (coll, tail) = args.split_first().ok_or("find without a collection")?;
    for e in array_of(eval_expr(env, coll)?).iter() {
        if pred(env, e, tail)? {
            return Ok(e.clone());
        }
    }
    Ok(Value::Null)
}

/// The value-helper pack — a spike subset over `Value`. Anything not here is a
/// reported "unsupported", never a wrong answer.
fn eval_helper(env: &Env, name: &str, args: &[Expr]) -> Result<Value, String> {
    let vs: Vec<Value> = args
        .iter()
        .map(|a| eval_expr(env, a))
        .collect::<Result<_, _>>()?;
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
            Ok(str_val(c.next().map_or(String::new(), |f| {
                f.to_uppercase().chain(c).collect()
            })))
        }
        ("trim", [a]) => Ok(str_val(s(a).trim().to_string())),
        ("append", [a, b]) => Ok(str_val(s(a) + &s(b))),
        ("prepend", [a, b]) => Ok(str_val(s(b) + &s(a))),
        // `~` (ADR-042): strict string concat — both operands must be strings, a
        // non-string is an error (matching the oracle's TypeError + the AOT's
        // string-typed `concat`), *not* the lenient stringify `append` uses.
        ("concat", [Value::Str(x) | Value::Safe(x), Value::Str(y) | Value::Safe(y)]) => {
            Ok(str_val(alloc::format!("{x}{y}")))
        }
        ("concat", [_, _]) => Err("concat expects two strings".into()),
        ("replace", [a, b, c]) => Ok(str_val(s(a).replace(&s(b), &s(c)))),
        ("includes", [a, b]) => Ok(Value::Bool(s(a).contains(&s(b)))),
        ("startsWith", [a, b]) => Ok(Value::Bool(s(a).starts_with(&s(b)))),
        ("endsWith", [a, b]) => Ok(Value::Bool(s(a).ends_with(&s(b)))),
        ("count" | "size", [a]) => Ok(Value::Num(match a {
            Value::Array(x) => x.len() as f64,
            Value::Object(o) => o.len() as f64,
            Value::Str(x) | Value::Safe(x) => x.chars().count() as f64,
            _ => 0.0,
        })),
        ("join", [Value::Array(a), sep]) => {
            let sep = s(sep);
            Ok(str_val(a.iter().map(s).collect::<Vec<_>>().join(&sep)))
        }
        ("slice", [a, Value::Num(i), Value::Num(j)]) => {
            let chars: Vec<char> = s(a).chars().collect();
            let lo = (*i as usize).min(chars.len());
            let hi = (*j as usize).clamp(lo, chars.len());
            Ok(str_val(chars[lo..hi].iter().collect()))
        }
        ("truncate", [a, Value::Num(n)]) => {
            let n = *n as usize;
            let chars: Vec<char> = s(a).chars().collect();
            if chars.len() > n {
                let mut t: String = chars[..n].iter().collect();
                t.push('…');
                Ok(str_val(t))
            } else {
                Ok(a.clone())
            }
        }
        ("at", [Value::Array(a), Value::Num(i)]) => {
            let len = a.len() as i64;
            let idx = *i as i64;
            let idx = if idx < 0 { len + idx } else { idx };
            Ok(if idx >= 0 && idx < len {
                a[idx as usize].clone()
            } else {
                Value::Null
            })
        }
        ("round", [Value::Num(n)]) => Ok(Value::Num(libm::floor(n + 0.5))),
        ("toFixed", [Value::Num(n), Value::Num(d)]) => {
            Ok(str_val(format!("{:.*}", *d as usize, n)))
        }
        // A host helper (F3).
        _ => match env.helpers.get(name) {
            Some(f) => f(&vs),
            None => Err(format!("unsupported: helper '{name}' / {} args", vs.len())),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{Helpers, Template, Value, render};
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

    #[test]
    fn output_escapes() {
        let d = obj(&[("name", s("<b>"))]);
        assert_eq!(render("{{name}}", d.clone()).unwrap(), "&lt;b&gt;");
        assert_eq!(render("{{ name | safe }}", d).unwrap(), "<b>");
    }

    /// The internal `render "@name"` op (ADR-25 stage 2) — renders a hoisted `@`-named
    /// inline partial (a `{% capture %}`/`{% apply %}` body) to a `Safe` value in the current
    /// scope: the body's interpolations escape, the result emits **verbatim** (no
    /// double-escape), and it sees the surrounding context (here, the loop element).
    #[test]
    fn render_op_produces_safe_in_current_scope() {
        // body escapes its interpolation; the Safe result is emitted verbatim.
        let d = obj(&[("x", s("<i>"))]);
        assert_eq!(
            render(
                r#"{% inline "@t" %}<b>{{x}}</b>{% endinline %}{{ render "@t" }}"#,
                d
            )
            .unwrap(),
            "<b>&lt;i&gt;</b>"
        );
        // "surrounding context": `render` inside a loop sees the current element.
        let d2 = obj(&[("xs", arr(&[s("a"), s("b")]))]);
        assert_eq!(
            render(
                r#"{% inline "@t" %}[{{this}}]{% endinline %}{% for xs %}{{ render "@t" }}{% endfor %}"#,
                d2
            )
            .unwrap(),
            "[a][b]"
        );
        // a non-`@` name is not the internal op — it is an unknown helper (boundary holds).
        assert!(render(r#"{{ render "nav" }}"#, Value::Null).is_err());
    }

    /// `{% capture %}` (ADR-25 stage 3) — renders its body once into a `Safe` value bound
    /// forward, reused without re-rendering and emitted verbatim (no double-escape). Desugars
    /// to an `@cap$` inline + a `{% local %}` over the sibling tail.
    #[test]
    fn capture_block() {
        // build-once-use-many; the body escapes its interpolation, the Safe reuse does not.
        let d = obj(&[("author", s("<b>A</b>")), ("vip", Value::Bool(true))]);
        assert_eq!(
            render(
                r#"{% capture by %}{{author}}{% if vip %} ★{% endif %}{% endcapture %}<h>{{by}}</h><f>{{by}}</f>"#,
                d
            )
            .unwrap(),
            "<h>&lt;b&gt;A&lt;/b&gt; ★</h><f>&lt;b&gt;A&lt;/b&gt; ★</f>"
        );
        // forward scope: the binding is live in the sibling tail but dies at the block close.
        let d2 = obj(&[("x", s("hi"))]);
        assert_eq!(
            render(
                r#"{% if x %}{% capture c %}[{{x}}]{% endcapture %}{{c}}{% endif %}{{c}}"#,
                d2
            )
            .unwrap(),
            "[hi]"
        );
        // capture inside a loop sees the current element (the body renders in-scope).
        let d3 = obj(&[("xs", arr(&[s("a"), s("b")]))]);
        assert_eq!(
            render(
                r#"{% for xs %}{% capture c %}<{{this}}>{% endcapture %}{{c}}{{c}}{% endfor %}"#,
                d3
            )
            .unwrap(),
            "<a><a><b><b>"
        );
    }

    /// `{% apply P %}…{% endapply %}` (ADR-25 stages 4/5) — render the body, pipe it through P
    /// (the body is P's leading subject), output the result. Desugars to an `@app$` inline + an
    /// Output of `(render "@app$") | P`.
    #[test]
    fn apply_block() {
        // single filter: body rendered, uppercased, output.
        let d = obj(&[("name", s("ann"))]);
        assert_eq!(
            render("{% apply uppercase %}hi {{name}}{% endapply %}", d).unwrap(),
            "HI ANN"
        );
        // a pipeline: the body is the leading subject — uppercase THEN truncate.
        assert_eq!(
            render(
                "{% apply uppercase | truncate 4 %}hello{% endapply %}",
                Value::Null
            )
            .unwrap(),
            "HELL…"
        );
        // the result is emitted verbatim (raw): the body's interpolation was escaped while
        // rendering, so the filtered markup is safe — a literal `<b>` stays `<B>` (matches the
        // oracle, whose ops preserve VSafe). `{{x}}` (x="a") had no specials to escape.
        let d2 = obj(&[("x", s("a"))]);
        assert_eq!(
            render("{% apply uppercase %}<b>{{x}}</b>{% endapply %}", d2).unwrap(),
            "<B>A</B>"
        );
    }

    /// `Value::Safe` (docs/25) — a pre-escaped value: `{{ x }}` emits it verbatim (no
    /// double-escape, unlike `Str`), it's truthy iff non-empty, and string ops treat it
    /// like `Str` (coerced via `raw_text`, or the `Safe`-aware direct-match arms).
    #[test]
    fn safe_value_rules() {
        use super::{Value, order, write_escaped};
        let safe = Value::Safe(Rc::from("&lt;b&gt;")); // already-escaped markup
        let plain = Value::Str(Rc::from("&lt;b&gt;"));
        // the no-double-escape rule: Safe emits verbatim, Str re-escapes the `&`.
        let mut a = String::new();
        write_escaped(&safe, &mut a);
        assert_eq!(a, "&lt;b&gt;");
        let mut b = String::new();
        write_escaped(&plain, &mut b);
        assert_eq!(b, "&amp;lt;b&amp;gt;");
        // truthiness like Str.
        assert!(safe.truthy());
        assert!(!Value::Safe(Rc::from("")).truthy());
        // ordering treats Safe like Str (so sortBy on captured values works).
        assert_eq!(order(&safe, &plain), core::cmp::Ordering::Equal);
    }

    #[test]
    fn if_and_each_with_loop_meta() {
        let d = obj(&[("xs", arr(&[s("a"), s("b")]))]);
        assert_eq!(
            render("{% for xs %}{{loop.index1}}:{{this}} {% endfor %}", d).unwrap(),
            "1:a 2:b "
        );
        let empty = obj(&[("xs", arr(&[]))]);
        assert_eq!(
            render("{% for xs %}x{% else %}none{% endfor %}", empty).unwrap(),
            "none"
        );
    }

    #[test]
    fn paths_operators_and_let() {
        let d = obj(&[("p", obj(&[("n", Value::Num(3.0))]))]);
        assert_eq!(
            render("{% if p.n > 2 %}big{% else %}small{% endif %}", d.clone()).unwrap(),
            "big"
        );
        assert_eq!(
            render("{% local t=(multiply p.n 2) %}{{t}}{% endlocal %}", d).unwrap(),
            "6"
        );
    }

    #[test]
    fn parent_chain_in_each() {
        let d = obj(&[("title", s("T")), ("xs", arr(&[s("a")]))]);
        assert_eq!(
            render("{% for xs %}{{parent.title}}:{{this}}{% endfor %}", d).unwrap(),
            "T:a"
        );
    }

    #[test]
    fn loop_depth_counts_nesting() {
        // `loop.depth` (ADR-021 amendment): 1-based nesting; the inner loop is
        // depth 2 and its `loop.parent.depth` is the outer loop's depth (1). Must
        // match the AOT backend's `Loop::at` derivation (AOT≡VM).
        let d = obj(&[("gs", arr(&[arr(&[s("a"), s("b")]), arr(&[s("c")])]))]);
        assert_eq!(
            render(
                "{% for gs %}{{loop.depth}}:{% for this %}{{loop.depth}}/{{loop.parent.depth}} {% endfor %}{% endfor %}",
                d
            )
            .unwrap(),
            "1:2/1 2/1 1:2/1 "
        );
    }

    #[test]
    fn helper_pipe() {
        let d = obj(&[("name", s("ann"))]);
        assert_eq!(render("{{name | uppercase}}", d).unwrap(), "ANN");
    }

    // ── Explicit whitespace control `{{- … -}}` / `{%- … -%}` (ADR-039 item 3) ────
    // Cross-impl vectors: these MUST render byte-for-byte identically to the
    // PureScript oracle (`renderMaxbars`). A glued `-` trims ALL adjacent whitespace
    // (newlines included); a spaced `-` stays the subtraction operator.

    #[test]
    fn ws_control_both_sides_trim() {
        let d = obj(&[("x", s("Z"))]);
        assert_eq!(render("a   {{- x -}}   b", d).unwrap(), "aZb");
    }

    #[test]
    fn ws_control_left_only() {
        let d = obj(&[("x", s("Z"))]);
        assert_eq!(render("a   {{- x }} b", d).unwrap(), "aZ b");
    }

    #[test]
    fn ws_control_right_only() {
        let d = obj(&[("x", s("Z"))]);
        assert_eq!(render("a {{ x -}}   b", d).unwrap(), "a Zb");
    }

    #[test]
    fn ws_control_spaced_dash_is_not_a_trim_marker() {
        // A SPACED `-` is never a trim marker: the surrounding whitespace is NOT
        // collapsed. Here `{{ x }}` has a spaced (non-glued) interior — no trim — so
        // the literal spaces around the tag survive. (The oracle's `[ {{ a - b }} ]`
        // → `[ 5 ]` vector additionally exercises SUBTRACTION inside an output tag,
        // a pre-existing limitation of the output-expression parser unrelated to and
        // out of scope for this lexer change; the lexer-level proof that a spaced `-`
        // stays an operator and never trims lives in `lex::tests`.)
        let d = obj(&[("x", s("Z"))]);
        assert_eq!(render("a   {{ x }}   b", d).unwrap(), "a   Z   b");
    }

    #[test]
    fn ws_control_block_eats_newlines() {
        let d = obj(&[("on", Value::Bool(true))]);
        assert_eq!(
            render("a\n  {%- if on -%}  \nB\n  {%- endif -%}  \nc", d).unwrap(),
            "aBc"
        );
    }

    #[test]
    fn ws_control_loop_collapses() {
        let d = obj(&[("xs", arr(&[Value::Num(1.0), Value::Num(2.0)]))]);
        assert_eq!(
            render(
                "<ul>\n{%- for i in xs -%}\n<li>{{i}}</li>\n{%- endfor -%}\n</ul>",
                d
            )
            .unwrap(),
            "<ul><li>1</li><li>2</li></ul>"
        );
    }

    #[test]
    fn collection_ops() {
        let items = arr(&[
            obj(&[("name", s("Ann")), ("age", Value::Num(30.0))]),
            obj(&[("name", s("Bo")), ("age", Value::Num(17.0))]),
        ]);
        let d = obj(&[("items", items)]);
        assert_eq!(
            render(
                r#"{% for (where items "age" "gt" 20) %}{{this.name}}{% endfor %}"#,
                d
            )
            .unwrap(),
            "Ann"
        );
    }

    #[test]
    fn inline_partial_and_yield() {
        let d = obj(&[("name", s("Ann & Bo"))]);
        assert_eq!(
            render(
                r#"{% inline "greet" %}Hi {{name}}!{% endinline %}{% include "greet" %}"#,
                d.clone()
            )
            .unwrap(),
            "Hi Ann &amp; Bo!"
        );
        let blk = r#"{% inline "card" %}<div>{% yield %}</div>{% endinline %}{% partial "card" %}{{name}}{% endpartial %}"#;
        assert_eq!(render(blk, d).unwrap(), "<div>Ann &amp; Bo</div>");
    }

    // ── cross-file partials (docs/21) — the dynamic-backend twin of the AOT macro ──

    #[test]
    fn cross_file_partial_include() {
        // A `(name, source)` import resolves `{% include "name" %}` against the caller's context.
        let t = Template::parse_with_partials(
            r#"{% include "header" %}"#,
            &[("header".to_string(), "<h1>{{title}}</h1>".to_string())],
        )
        .unwrap();
        assert_eq!(
            t.render(&obj(&[("title", s("Hi"))])).unwrap(),
            "<h1>Hi</h1>"
        );
    }

    #[test]
    fn cross_file_extends_base() {
        // An imported partial serves as an `{% extends %}` base: the child fills `content`, the
        // un-overridden `title` keeps the base default.
        let t = Template::parse_with_partials(
            r#"{% extends "layout" %}{% block content %}<p>{{post}}</p>{% endblock %}"#,
            &[(
                "layout".to_string(),
                "<title>{% block title %}{{site}}{% endblock %}</title>{% block content %}default{% endblock %}".to_string(),
            )],
        )
        .unwrap();
        let d = obj(&[("site", s("Site")), ("post", s("Body"))]);
        assert_eq!(t.render(&d).unwrap(), "<title>Site</title><p>Body</p>");
    }

    #[test]
    fn cross_file_extends_super_splices_base_block() {
        let t = Template::parse_with_partials(
            r#"{% extends "layout" %}{% block body %}<main>{% super %}</main>{% endblock %}"#,
            &[(
                "layout".to_string(),
                "{% block body %}{{base}}{% endblock %}".to_string(),
            )],
        )
        .unwrap();
        assert_eq!(
            t.render(&obj(&[("base", s("X"))])).unwrap(),
            "<main>X</main>"
        );
    }

    #[test]
    fn cross_file_duplicate_partial_is_rejected() {
        let err = Template::parse_with_partials(
            r#"{% inline "h" %}x{% endinline %}{% include "h" %}"#,
            &[("h".to_string(), "<p>file</p>".to_string())],
        )
        .err()
        .unwrap();
        assert!(err.contains("duplicate partial 'h'"), "{err}");
    }

    #[test]
    fn host_helper_registry() {
        let mut h = Helpers::new();
        h.register("shout", |args| {
            let t = match args.first() {
                Some(Value::Str(s)) => s.to_string(),
                _ => String::new(),
            };
            Ok(Value::Str(Rc::from(
                format!("{}!", t.to_uppercase()).as_str(),
            )))
        });
        let h = Rc::new(h);
        let t = Template::parse("{{name | shout}}").unwrap();
        let d = obj(&[("name", s("hi"))]);
        assert_eq!(t.render_with(&d, &h).unwrap(), "HI!");
        // Unknown helper without the registry still errors.
        assert!(t.render(&d).is_err());
    }

    #[test]
    fn block_host_helper_registry() {
        // The same `frame`/`repeat` block helpers as the AOT macro test (render.rs):
        // `frame` wraps the body once, `repeat n` drives it N times. Byte-identical to AOT.
        let mut h = Helpers::new();
        h.register_block("frame", |_args, body| {
            Ok(Value::Str(Rc::from(format!("[{}]", body()?).as_str())))
        });
        h.register_block("repeat", |args, body| {
            let n = match args.first() {
                Some(Value::Num(n)) => *n as usize,
                _ => 0,
            };
            let mut s = String::new();
            for _ in 0..n {
                s.push_str(&body()?);
            }
            Ok(Value::Str(Rc::from(s.as_str())))
        });
        let h = Rc::new(h);
        let d = obj(&[("name", s("Ada"))]);

        let framed = Template::parse("{% frame %}hi {{name}}{% endframe %}").unwrap();
        assert_eq!(framed.render_with(&d, &h).unwrap(), "[hi Ada]");
        let repeated = Template::parse("{% repeat 3 %}{{name}}{% endrepeat %}").unwrap();
        assert_eq!(repeated.render_with(&d, &h).unwrap(), "AdaAdaAda");

        // The body renders in the enclosing scope and is escaped before the helper sees it,
        // so the helper's raw output never double-escapes it.
        let esc = obj(&[("name", s("<b>"))]);
        assert_eq!(framed.render_with(&esc, &h).unwrap(), "[hi &lt;b&gt;]");

        // Undeclared block head errors without a registry.
        assert!(framed.render(&d).is_err());
    }

    #[test]
    fn truthiness_policy_governs_conditions() {
        use super::TruthMode;
        // An empty list: falsy under NonEmpty (default), truthy under Liquid.
        let d = obj(&[("xs", arr(&[]))]);
        let src = "{% if xs %}has{% else %}none{% endif %}";
        assert_eq!(Template::parse(src).unwrap().render(&d).unwrap(), "none");
        assert_eq!(
            Template::parse(src)
                .unwrap()
                .with_truthiness(TruthMode::Liquid)
                .render(&d)
                .unwrap(),
            "has"
        );
        // An empty string: falsy under NonEmpty/Handlebars, truthy under Liquid.
        let e = obj(&[("s", s(""))]);
        let ssrc = "{% if s %}y{% else %}n{% endif %}";
        assert_eq!(
            Template::parse(ssrc)
                .unwrap()
                .with_truthiness(TruthMode::Handlebars)
                .render(&e)
                .unwrap(),
            "n"
        );
        assert_eq!(
            Template::parse(ssrc)
                .unwrap()
                .with_truthiness(TruthMode::Liquid)
                .render(&e)
                .unwrap(),
            "y"
        );
    }

    #[test]
    fn numeric_truthiness_per_policy() {
        use super::TruthMode;
        let zero = obj(&[("n", Value::Num(0.0))]);
        let src = "{% if n %}t{% else %}f{% endif %}";
        // NonEmpty (lenient): 0 is truthy (the interpreter rule).
        assert_eq!(Template::parse(src).unwrap().render(&zero).unwrap(), "t");
        // Handlebars: 0 is falsy.
        assert_eq!(
            Template::parse(src)
                .unwrap()
                .with_truthiness(TruthMode::Handlebars)
                .render(&zero)
                .unwrap(),
            "f"
        );
        // Liquid: 0 is truthy (only false/nil are falsy).
        assert_eq!(
            Template::parse(src)
                .unwrap()
                .with_truthiness(TruthMode::Liquid)
                .render(&zero)
                .unwrap(),
            "t"
        );
    }
}
