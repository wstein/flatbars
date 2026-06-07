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
   does `let mut out = String::new(); … out`.

---

## 2. Output: `ToText`, `Safe`, `esc`

```rust
/// A string already safe to emit unescaped (helper output that is markup).
pub struct Safe(pub String);

/// Stringification, mirroring the interpreter's `stringify`
/// (null→"", bool→"true"/"false", number→…, array→ join with ",").
/// NOTE (v1): f64 formatting is NOT byte-identical to JS `String(n)` — out of scope
/// per spec §10. Integers and the common float cases agree; the long tail does not.
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

---

## 3. Truthiness: the `Truthy` trait (`nonEmpty`)

Trussbars has one fixed rule (spec §7). It is a trait so each type answers for itself, and
**a condition over an impossible type is a compile error**, not a silent `false`.

```rust
pub trait Truthy { fn truthy(&self) -> bool; }
pub fn truthy<T: Truthy>(v: &T) -> bool { v.truthy() }
```

| Type | `truthy()` |
| --- | --- |
| `bool` | `*self` |
| `&str` / `String` / `Safe` | `!is_empty()` |
| `&[T]` / `Vec<T>` | `!is_empty()` |
| `Option<T: Truthy>` | `self.as_ref().is_some_and(Truthy::truthy)` |
| maps (`BTreeMap`) | `!is_empty()` |
| a context struct | `true` (an inhabited object is truthy; via the companion derive, §12) |
| **numeric** (`i*` / `u*` / `f64`) | *no impl* — see below |

**Numbers deliberately have no `Truthy` impl.** `{{#if count}}` therefore fails to compile,
forcing an explicit comparison (`{{#if count > 0}}`) — spec §5.3, the typed escape from the
`0`-truthy / `0`-falsy dilemma. Because `Option<T: Truthy>` requires the inner type to be
`Truthy`, `Option<i64>` is non-`Truthy` too (test presence with `??`, then compare). The v2
proc-macro can intercept the missing impl to emit a friendly *"numbers aren't truthy — write
`count > 0`"* diagnostic; in v1 the raw `rustc` *"`Truthy` not implemented for `i64`"* stands.

`{{#if cond}}` → `if truthy(&cond) {`. Note `Option<String>` of `Some("")` is **falsy** —
absence *and* emptiness both fall through, matching the interpreter.

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
uniform `T: Truthy + Clone`). The distinction is preserved by *type*, not a runtime flag.

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
from §4 and §7 are inlined by codegen. Representative signatures (full set in the crate):

**Escaping / output**
`escape_html(&str) -> Safe` · `safe<T: ToText>(&T) -> Safe` ·
`json<T: Serialize>(&T) -> String` · `escape_json<T: Serialize>(&T) -> Safe`.

**Arithmetic** — mostly emitted native (`price * qty`); `modulo` is a fn for the
trunc-toward-zero rule: `modulo(a: f64, b: f64) -> f64 { a - b * (a / b).trunc() }`.
`divide` follows IEEE (`/0.0` → `inf`/`NaN`, then `ToText`).

**String pack** (`&str`-in, `String`/`bool`-out)
`lowercase` · `uppercase` · `capitalize` · `trim` · `trim_start` · `trim_end` · `split` ·
`replace` · `slice` (JS slice semantics, incl. negative indices) · `includes` ·
`starts_with` · `ends_with` · `truncate` · `append` · `prepend`.

**Number pack** (`f64`-in)
`abs` · `floor` · `ceil` · `round` · `to_fixed(x, n)` · `to_int` · `to_float`.

**Array pack** (`&[T]`-in)
`join(&[T], sep)` · `count`/`size` · `at(&[T], i)` (negative from end) · `take` ·
`take_right` · `reverse` · `unique` (needs `T: PartialEq`) ·
`sort_by` / `pluck` / `group_by` — **the key is a literal**, so the codegen emits a
**field-access closure**, not a runtime string: `{{items | pluck "name"}}` →
`items.iter().map(|x| &x.name).collect::<Vec<_>>()`. A *non-literal* key would be a
data-derived name and is inadmissible (spec §4.3).

**i18n** (`t` · `number` · `date` · `select_plural` · `relative`) — a host-locale **seam**,
not byte-identical (spec §10). Shape: a `Translator` trait the host implements; the helpers
call it and fall back to English when absent, mirroring the JS `translator` seam (ADR-029).

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

1. **Trait coherence for context structs.** `Truthy`/`ToText` need impls for user context
   types that appear in conditions / `{{this}}` output. Plan: a companion **`#[derive(Trussbars)]`**
   (or `derive(Truthy, ToText)`) emitting "struct ⟹ always truthy; `ToText` ⟹ error or a
   debug form," so a blanket impl doesn't collide with the primitive impls.
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
