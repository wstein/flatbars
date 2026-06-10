# Trussbars — Runtime API (`trussbars-core` + `trussbars-std`)

> **Status:** Draft / design · **Depends on:** `01-subset-spec.md` (the language) ·
> **Consumed by:** the v1 `rustEmit` backend and the v2 proc-macro (both emit code that
> calls this API). **This is the durable artifact** — the PureScript emitter is scaffolding;
> these crates outlive it.

The runtime is deliberately *small*. Because Trussbars is the **statically-typed subset**
(spec §1), most of what the JS runtime ([flatbars-runtime.mjs](../../packages/compile/runtime/flatbars-runtime.mjs))
does dynamically — `rt.lookup`, `rt.call`, `rt.each`, `rt.block`, the `Rc`-style frame, the
`yieldStack` — **disappears into ordinary Rust** emitted by the compiler. What remains is a
thin set of traits and value helpers.

---

## 1. Design tenets

1. **No dynamic `Value`, no dispatch table.** There is no `enum Value` interpreted at
   render time and no string-keyed helper registry. Field access is a Rust field access;
   helper dispatch is Rust name resolution. Wrong field / wrong arity / wrong type is a
   `rustc` error (spec §5.2), free.
2. **Frames are lexical Rust scopes, not heap frames.** Template nesting maps exactly onto
   Rust block nesting, so the reserved scope (`this`/`root`/`parent`/`outer`/`loop`) is
   threaded as **borrowed references** living on the stack — **no `Rc<Frame>`**. (This is
   the typed model's payoff: the dynamic port needed `Rc` because frames outlived lexical
   scope; here they don't.)
3. **Heterogeneous & short-circuiting operators are emitted inline; homogeneous value
   helpers are library functions.** `&& || ! == != < > <= >= ?? ?: ?:`-ternary operate on
   mixed operand types and/or short-circuit — the codegen emits native Rust for them. The
   string/number/array packs, escaping, and json take uniform types — those are
   monomorphized `trussbars_std::*` calls. (See §11 for the split.)
4. **Output is a single growing `String` buffer.** The emitted `fn render(ctx: &T) -> String`
   does `let mut out = String::with_capacity(hint); … out` (the hint is the adaptive
   `SizeHint`, §2).
5. **`no_std`-capable.** `trussbars-core` needs only `alloc` (`String`, `Vec`, `BTreeMap`);
   it is `#![forbid(unsafe_code)]` and the default `std` feature gates nothing in the code.
   `--no-default-features` is a true `no_std` build — CI proves it against the bare-metal
   `thumbv7em-none-eabi` target, both pure and with the `perf` backends (itoa +
   dragonbox_ecma are themselves `no_std`). So compiled templates can render on embedded
   targets — a niche no injection-safe engine otherwise occupies.

---

## 2. Output: `ToText`, `Safe`, `esc`

```rust
/// A string already safe to emit unescaped (helper output that is markup).
pub struct Safe(pub String);

/// Stringification, mirroring the interpreter's `stringify`
/// (null→"", bool→"true"/"false", number→…, array→ join with ",").
/// Number formatting is a pluggable backend: with the default `perf` features,
/// integers use `itoa` (`fast-int`) and f64 uses `dragonbox_ecma` (`ecma-float`),
/// which is ECMA-262 BYTE-IDENTICAL to JS `String(n)` (-0→"0", 1e21→"1e+21",
/// Infinity, NaN). `--no-default-features` falls back to Rust `Display` (the f64
/// divergence, masked only on that profile — spec §10). f32 always uses `Display`.
pub trait ToText {
    /// Raw text — the emission for `{{{ x }}}`.
    fn write_text(&self, out: &mut String);
    /// HTML-escaped text — the emission for `{{ x }}`. Default stringifies via
    /// `write_text` and escapes the result; `Safe` overrides it to write through
    /// unescaped, and `&str`/`String` override it to escape in place.
    fn write_escaped(&self, out: &mut String) { /* default: escape write_text */ }
}

/// HTML-escape `&  <  >  "  '` to entities (exact charset mirrors the JS `escapeHtml`).
pub fn escape_html(s: &str, out: &mut String);

/// Escape a value for `{{ }}` output position — unless it is already `Safe`.
pub fn esc<T: ToText + ?Sized>(v: &T, out: &mut String);   // calls v.write_escaped
```

`ToText` impls: `str`/`String`, `bool`, the integer types, `f32`/`f64` (v1-approximate),
`Option<T: ToText>` (`None`→nothing; its `write_escaped` delegates to the inner value so a
`Some(Safe)` still writes through), `[T]`/`Vec<T: ToText>` (join `,`), `Safe`, `()`/unit, and
a blanket `&T`. Output sites emit `esc(&x, &mut out)` for `{{x}}` and a raw
`x.write_text(&mut out)` for `{{{x}}}`.

The per-output hot path is marked `#[inline]` (`esc`, `escape_html`, the concrete
`ToText` impls, `Loop::at`, `Each::each_len`), so it inlines into the host crate
even without LTO — a render that emits N cells does N inlined appends, not N
cross-crate calls.

**Output buffer sizing — `SizeHint`.** `render` opens with a fn-local
`static __CAP: trussbars_core::SizeHint`, seeds it with the compiler's literal
estimate, allocates `String::with_capacity(__CAP.suggest())`, and calls
`__CAP.record(out.len())` before returning. The hint (a `Relaxed` `AtomicUsize`)
remembers the last render's length, so a *warm* template — the server steady state
— reallocates at most once however large the data. It is purely a capacity hint:
it never affects the output bytes, so it is invisible to the conformance harness.

---

## 3. Truthiness: the `TruthyIn<Mode>` trait (`nonEmpty` by default)

Truthiness is a trait **parameterized by a policy marker** `Mode`, so each type answers for
itself under a named policy and **a condition over a type with no impl is a compile error**,
not a silent `false`. The default policy is `NonEmpty` (spec §7).

```rust
pub trait TruthyIn<Mode> { fn truthy(&self) -> bool; }

pub struct NonEmpty; // default; pub struct Liquid; pub struct Handlebars;

pub fn truthy<T: TruthyIn<NonEmpty>>(v: &T) -> bool { v.truthy() }      // the default
pub fn truthy_in<Mode, T: TruthyIn<Mode>>(v: &T) -> bool { v.truthy() } // a chosen policy
```

| Type | `NonEmpty` (default) | `Liquid` | `Handlebars` |
| --- | --- | --- | --- |
| `bool` | `*self` | `*self` | `*self` |
| `()` (`null`) | `false` | `false` | `false` |
| `&str` / `String` / `Safe` | `!is_empty()` | `true` | `!is_empty()` |
| `&[T]` / `Vec<T>` | `!is_empty()` | `true` | `!is_empty()` |
| maps (`BTreeMap`) | `!is_empty()` | `true` | `true` (`{}` truthy) |
| `Option<T>` | defers to inner (same policy) | defers | defers |
| numeric (`i*` / `u*` / `f*`) | *no impl* — see below | `true` | `0`/`NaN` → `false`, else `true` |
| a context struct/enum | `true` (≥1 field) / `false` (unit); policy-independent via `#[derive(Trussbars)]`; no `ToText`, so `{{struct}}` won't compile (§12) | same | same |

**Under `NonEmpty`, numbers deliberately have no impl.** `{{#if count}}` therefore fails to
compile, forcing an explicit comparison (`{{#if count > 0}}`) — spec §5.3, the typed escape
from the `0`-truthy / `0`-falsy dilemma. Because `Option<T>` defers to the inner type,
`Option<i64>` is likewise non-truthy under `NonEmpty` (test presence with `??`, then compare).
The v2 proc-macro can intercept the missing impl to emit a friendly *"numbers aren't truthy —
write `count > 0`"* diagnostic; in v1 the raw `rustc` *"`TruthyIn<NonEmpty>` not implemented
for `i64`"* stands.

`{{#if cond}}` → `if truthy(&cond) {` (default) or `if truthy_in::<Liquid, _>(&cond) {` under
`truss!(…, truthiness = Liquid)`. Note `Option<String>` of `Some("")` is **falsy under
`NonEmpty`** (absence *and* emptiness fall through, matching the interpreter) but **truthy
under `Liquid`** — `Option` defers to the inner type's policy.

**Host-defined policies.** Because `Mode` is a type parameter, a host can define its own
policy — even over the standard library's types — with `impl TruthyIn<MyMode> for str`
(orphan-rule-legal because the marker is local). Every policy is monomorphized: selecting one
is free at runtime. Only `NonEmpty` is conformance-checked; the rest are loud, per-template
opt-ins (`docs/16-truthiness-modes.md`).

---

## 4. Coalescing & ternary (emitted inline, not helpers)

These desugar from `?? ?: ? :` but are control-flowish, so the codegen emits native Rust;
operand types must unify (Rust enforces it).

| Surface | Emitted Rust (sketch) | Semantics |
| --- | --- | --- |
| `a ?? b` (`coalesce`) | `a.clone().unwrap_or_else(\|\| b)` | first **non-null** (`Option::or`) — `0`/`""` survive |
| `a ?: b` (`firstTruthy`) | `{ let t = a; if truthy(&t) { t } else { b } }` | first **truthy** under `nonEmpty` |
| `c ? a : b` (`ternary`) | `if truthy(&c) { a } else { b }` | |

`??` is presence (operates over `Option<T>` → `T`); `?:` is truthiness (operates over a
uniform `T: TruthyIn<Mode> + Clone`). The distinction is preserved by *type*, not a runtime flag.

---

## 5. Loop metadata & frame threading

```rust
/// Per-iteration metadata (ADR-021). Borrowed, stack-resident — `parent` points
/// at the enclosing loop's `Loop` value, alive on an enclosing stack frame.
pub struct Loop<'p> {
    pub index0: usize,
    pub index1: usize,
    pub rindex0: usize,
    pub rindex1: usize,
    pub first: bool,
    pub last: bool,
    pub length: usize,
    pub key: Option<&'p str>,          // Some(k) for map iteration, None for Vec
    pub parent: Option<&'p Loop<'p>>,  // nearest enclosing loop
}

impl<'p> Loop<'p> {
    /// Build iteration `index` of `length` items (index < length).
    pub fn at(index: usize, length: usize,
              key: Option<&'p str>, parent: Option<&'p Loop<'p>>) -> Self;
    /// The outermost enclosing loop (`loop.root`) — `self` if outermost.
    pub fn root(&self) -> &Loop<'p>;   // walks the `parent` chain
}
```

`root` is a **method**, not a field — walking `parent` avoids a self-reference at
construction (`loop.root` of the outermost loop is the loop itself).

- `{{loop.index1}}` → `cur_loop.index1`. `{{loop.last}}` → `cur_loop.last`.
- `{{loop.parent.index0}}` → `cur_loop.parent.unwrap().index0` (the chain is borrowed refs).
- `{{loop.root.length}}` → `cur_loop.root().length`.
- `{{loop.key}}` → `cur_loop.key` (only present for map iteration).
- The current element (`{{this}}` inside `each`) is the **loop binding** (`team`, `m`, …),
  not a field of `Loop`.

**No `Rc`, no heap frame.** Each `for` body constructs a `Loop` on the stack (via
`Loop::at`) and borrows its parent. `outer` (labelled loop, `label outer`) is just
`let outer = &cur_loop;` made visible to inner scopes.

---

## 6. Reserved scope → Rust bindings

| Reserved name | Emitted as |
| --- | --- |
| `this` | the current context binding (`ctx`, or the loop var `team`/`m`) |
| `root` | `let root = ctx;` at the top — the outermost `&T`, in scope throughout |
| `parent` | the enclosing context binding (the outer loop's element / outer `with` value) |
| `parent.parent.…` | the binding two scopes out (threaded as named `&` refs) |
| `outer` | `&Loop` of the labelled enclosing loop |
| `loop` | the current `&Loop` |
| `yield` | the body closure parameter (see §8) |

All are references with lifetimes bounded by lexical nesting — the borrow checker is
satisfied by construction because template nesting *is* Rust block nesting.

---

## 7. Block control flow (emitted native, not runtime calls)

Unlike the JS runtime, `trussbars-core` provides **no** `each`/`with`/`if` functions —
they are native Rust:

- `{{#if c}}…{{else if d}}…{{else}}…{{/if}}` → `if truthy(&c) { … } else if truthy(&d) { … } else { … }`.
- `{{#unless c}}…{{/unless}}` → `if !truthy(&c) { … }`.
- `{{#each xs as |x|}}…{{else}}…{{/each}}` →
  `if xs.is_empty() { /* else */ } else { let n = xs.len(); for (i, x) in xs.iter().enumerate() { let l = Loop{…}; … } }`.
- `{{#each map as |v|}}` over a `BTreeMap` iterates in **key order** (matches the
  interpreter's `Object.keys().sort()`; spec §11). `loop.key` = the entry key.
- `{{#with v as |u|}}…{{else}}…{{/with}}` → `if truthy(&v) { let u = &v; … } else { … }`.

---

## 8. Custom helpers, block helpers, partials, yield (compile-time)

All registration is at **compile time** — no `rt.register`. The host provides Rust items
in scope; the codegen calls them.

- **Inline helper** `{{loud name}}` → `loud(name)`, where `fn loud(s: &str) -> String`
  (host-defined). Return `Safe` for markup helpers.
- **Block helper** `{{#list people as |p i|}}…{{/list}}` → a host
  `fn list<T>(items: &[T], body: impl Fn(&T, usize) -> String) -> String`; the codegen
  emits the body as the closure.
- **Static partial** `{{> card}}` / `{{> card ctx}}` → `card(&ctx)`, another emitted
  `fn card(ctx: &CardCtx) -> String`.
- **Layout + yield** `{{#inline "frame"}}…{{yield}}…{{/inline}}{{#partial "frame"}}body{{/partial}}`
  → `frame(ctx, || { /* body */ })`, where `fn frame(ctx: &_, yield_body: impl Fn() -> String)`
  and `{{yield}}` → `yield_body()`. **No `yieldStack`** — the body is a parameter.
- **Polymorphic dispatch** (the spec §4.1 replacement for dynamic partials) → a `match` over
  a `#[serde(tag)]` enum, each arm calling the variant's static partial fn.

---

## 9. `trussbars-std` — the value-helper inventory

Only the **homogeneous** helpers (uniform operand types) are library functions; operators
from §4 and §7 are inlined by codegen. Subjects and string arguments are coerced via the
reference `stringify` (helpers take `impl ToText`); integer arguments are `i64`. Items below
are *implemented* in the crate unless marked *deferred*.

**Escaping / output** — `safe(&impl ToText) -> Safe` *(implemented)*; `escape_html` lives in
`trussbars-core`. `json` / `escape_json` *(deferred — need a serializer dependency)*.

**Arithmetic** — `+ - * /` are emitted native; `modulo(a: f64, b: f64) -> f64` *(implemented;
truncated remainder `a - b * (a / b).trunc()`, sign of the dividend)*. `divide` follows IEEE.

**String pack** *(implemented)* — `lowercase` · `uppercase` · `capitalize` · `trim` ·
`trim_start` · `trim_end` · `split` (empty separator → characters) · `replace` · `slice` /
`slice_range` (JS negative indices + clamping) · `includes` · `starts_with` · `ends_with` ·
`truncate` / `truncate_with` · `append` · `prepend` · `reverse`.

**Number pack** *(implemented)* — `abs` · `floor` · `ceil` · `round` (JS half-to-+∞) ·
`to_fixed(x, n)` · `to_int` · `to_float`.

**Array pack** *(implemented)* — `join(&[T], sep)` · `count` (`size` is the same fn) ·
`at(&[T], i)` (negative from end) · `take` · `take_right` · `reverse_slice` · `unique`
(`T: PartialEq`) · `slice_includes` (the array form of `includes`, dispatched by subject type;
`reverse_slice` likewise to `reverse`). The key-path helpers `sort_by` / `pluck` / `group_by`
are *deferred* — **the key is a literal**, so the codegen emits a **field-access closure**, not
a runtime string: `{{items | pluck "name"}}` → `items.iter().map(|x| &x.name).collect::<Vec<_>>()`.
A *non-literal* key would be a data-derived name and is inadmissible (spec §4.3).

**i18n** *(deferred)* — `t` · `number` · `date` · `select_plural` · `relative`: a host-locale
`Translator` seam, not byte-identical (spec §10), mirroring the JS `translator` seam (ADR-029).

**Dropped:** `apply` and `dict` — `apply` is injection-class (spec §4.2); `dict`/collection
literals are deferred (ADR-024), not in v1. `log` → a no-op (or `eprintln!`) returning unit.

---

## 10. Pipes

`a | f x` → `f(a, x)` (left value prepended), left-associative, all resolved to the §9
calls. `{{items | pluck "name" | join ", "}}` →
`join(&pluck_name(items), ", ")` (the `pluck "name"` becomes the field-access closure of §9).

---

## 11. Codegen split: inline vs. library call

| Construct | Emission |
| --- | --- |
| `{{x}}` / `{{{x}}}` | `esc(&x, &mut out)` / `x.write_text(&mut out)` |
| paths `a.b.c` | native field access `a.b.c` |
| `+ - *` `/` | native Rust ops; `%` → `trussbars_std::modulo` |
| `== != < > <= >=` | native `==`/`<`/… (unlike types ⟹ compile error) |
| `&& \|\| !` | native over `truthy(&_)` |
| `?? ?: ?:`-ternary | inline (§4) |
| `#if #unless #each #with` | native control flow (§7) |
| `loop.* root parent outer` | borrowed refs (§5–6) |
| string/number/array/json/i18n helpers | `trussbars_std::*` calls (§9) |
| custom/block helpers, partials, yield | host fns / closures (§8) |

The principle: **anything heterogeneous, short-circuiting, or structural is inline; anything
uniform-typed is a call.**

---

## 12. Open design questions (to resolve in implementation)

1. **Trait coherence for context structs.** *Resolved (`trussbars-derive`).* The companion
   **`#[derive(Trussbars)]`** generates the policy-independent `TruthyIn` impl a context struct needs (a struct with
   ≥1 field is truthy, a field-less struct falsy — the nonEmpty object rule). It deliberately
   generates **no `ToText`**, so `{{struct}}` / `{{this}}` over a struct stays a compile error —
   the typed counterpart of "cannot stringify an object" (§3, subset spec §2). Structs only;
   deriving on an enum/union is a compile error until §4.1 dispatch lands.
2. **`parent`/`outer` lifetime threading depth.** Borrowed refs are correct but the codegen
   must name and thread them; confirm the borrow checker stays happy at deep nesting (the
   highest-risk codegen piece — prototype examples 10 & 14 first, per `01`'s plan).
3. **f64 → string.** Deferred (spec §10); the harness normalizes. Decide the later
   `number-format` lib's hook point now so the `ToText for f64` impl is swappable.
4. **Map iteration order.** `BTreeMap` gives sorted-key order matching the interpreter; if a
   host needs insertion order, that's a divergence to document, not silently allow.
5. **`Translator` trait shape** — sync vs. fallible, and how locale/options are passed
   (mirror ADR-029's `(name, args) -> Option<String>` as closely as the type system allows).

---

## 13. Worked example (end-to-end)

**Template** (MaxBars):

```handlebars
{{#each teams as |team|}}
{{team.name}} ({{root.org}}):
{{#each team.members as |m|}}
  {{loop.index1}}. {{m | uppercase}}{{#if loop.last}} (last){{/if}} — {{parent.name}}
{{/each}}
{{/each}}
```

**Context type** (host-supplied; companion derives per §12):

```rust
#[derive(Deserialize, Trussbars)]
struct Ctx  { org: String, teams: Vec<Team> }
#[derive(Deserialize, Trussbars)]
struct Team { name: String, members: Vec<String> }
```

**Emitted Rust** (shape; whitespace elided):

```rust
fn render(ctx: &Ctx) -> String {
    use trussbars_core::{esc, truthy, Loop};
    use trussbars_std::uppercase;
    let mut out = String::new();
    let root = ctx;                                   // reserved `root`
    let teams = &ctx.teams;
    let tn = teams.len();
    for (i, team) in teams.iter().enumerate() {       // {{#each teams as |team|}}
        let tl = Loop::at(i, tn, None, None);
        esc(&team.name, &mut out);
        out.push_str(" (");
        esc(&root.org, &mut out);                     // {{root.org}}
        out.push_str("):\n");
        let members = &team.members;
        let mn = members.len();
        for (j, m) in members.iter().enumerate() {    // {{#each team.members as |m|}}
            let ml = Loop::at(j, mn, None, Some(&tl));
            out.push_str("  ");
            esc(&ml.index1, &mut out);                // {{loop.index1}}
            out.push_str(". ");
            esc(&uppercase(m), &mut out);             // {{m | uppercase}}
            if truthy(&ml.last) { out.push_str(" (last)"); }   // {{#if loop.last}}
            out.push_str(" — ");
            esc(&team.name, &mut out);                // {{parent.name}} (enclosing ctx = team)
            out.push_str("\n");
        }
    }
    out
}
```

Note what is *absent*: no `Value`, no `rt.lookup`/`rt.call`, no `Rc`, no `yieldStack`. The
`loop.parent` chain is `Some(&tl)` on the stack; `parent.name` resolves to the enclosing
loop's element `team`; `root` is the top `&Ctx`. Every access is a field access `rustc`
checks against `Ctx`/`Team`. That is the whole point.
