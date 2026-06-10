# Trussbars — Numeric-literal coercion (F2)

> **Status:** **Accepted & implemented** (Option A — `NumLit`). **Audience:** the v2 emitter
> (`trussbars-template`), the runtime crates, the conformance harness. **Resolves:** `docs/06`
> **F2** ("a field compared to a numeric literal must be `f64`", filed "v2, consider …
> optional"). **Companion:** `docs/01` §6 (operators), §8 (the f64 number model), `docs/03`
> (schema inference — the alternative root fix).
>
> **Decision (built):** Option A. A numeric literal in **operator-operand position** emits as
> `trussbars_core::NumLit(f64)` (not a bare `f64`), which compares/arithmetics against any
> numeric field type by widening to `f64`. Localised to `emit::bin_op` operands, so renders,
> helper args, and `trussbars_std` calls are untouched (no broad literal-emission change, no
> `Display`/`From` plumbing needed). The accepted consequences: `i64_field + 1` is `f64`
> (the §8 model), and `name > 100` (string vs number) is a compile error. Verified
> byte-identical by the v2 conformance gate (`test:trussbars-v2`, 71/71, 0 drift).

## 1. The problem

Numeric literals emit as `f64` (`emit::rust_num` — an integer-valued literal becomes
`100.0`), and comparison/arithmetic emit native Rust operators (`emit::bin_op` →
`(a op b)`). So:

```hbs
{{#if views > 100}}popular{{/if}}
```

emits `(ctx.views > 100.0)`. If the host declares `views: f64` it compiles; if it declares
`views: i64` it is a `rustc` type-mismatch (`f64` vs `{integer}`), located at the whole
`truss!(…)` call (the §1/#1 span limitation). The error is real but surprising and reads as
unrelated to the template.

This bites **only host-authored contexts** with a non-`f64` numeric field. The conformance
harness types every number as `f64` (`conformance/ctxgen.mjs:48`), so **the corpus never
exercises it** — which is also the lever that makes a fix safe (see §4).

## 2. The constraint that rules out the obvious fixes

The tempting fix — coerce comparison operands to `f64` (`(a as f64) op (b as f64)`, or a
`to_f64()` trait method) — **is wrong**, because Trussbars's ordered comparisons are *not*
numeric-only. The oracle (`Kernel.Prelude.compareValues`) is:

```purescript
compareValues a b = case a, b of
  VNumber x, VNumber y -> Just (compare x y)
  VString x, VString y -> Just (compare x y)   -- lexicographic string ordering!
  _, _                 -> Nothing
```

So `{{#if name < "m"}}` is valid MaxBars (lexicographic), and Trussbars's native `(ctx.name
< "m")` already matches it. Coercing `<`/`>`/`<=`/`>=` operands to `f64` would turn valid
string ordering into a compile error — a regression. The same applies to `==`/`!=` (defined
over strings, numbers, and bools). **Only `+ - * / %` are strictly numeric** (`docs/01` §6:
"strictly numeric — no string `+`"), so they *could* be coerced — but F2's complaint is about
*comparison*, which can't be.

Consequences:

- ❌ **`as f64` cast** — breaks string ordering; and `(x as f64)` where `x: f64` trips
  `clippy::unnecessary_cast`, which (with the workspace's `-D warnings`) can fail *user*
  crates that compile the generated code.
- ❌ **`to_f64()` trait on comparison operands** — same string-ordering regression.
- ⚠️ **Coerce arithmetic only** — safe, but doesn't fix the reported comparison case.

## 3. Options

### Option A — `NumLit`: a coercing wrapper for numeric literals *(built)*

Emit a numeric literal **that sits in operator-operand position** not as a bare `f64` but as
a zero-cost newtype `trussbars_core::NumLit(f64)`, with operator impls that let it
compare/arithmetic against any numeric field type, while leaving every other operand
untouched. Localising it to `emit::bin_op` operands (an `emit_operand` helper) — rather than
changing `rust_num` globally — is what keeps it contained: renders, helper args, and
`trussbars_std` calls still see a bare `f64`, so no `Display`/`From`/`ToText` plumbing is
needed:

```rust
// trussbars-core (a small macro over {i8..i128, u8..u128, isize, usize, f32, f64}):
pub struct NumLit(pub f64);                       // #[derive(Clone, Copy, Debug, PartialEq, PartialOrd)]
impl PartialEq<NumLit>  for i64 { … as f64 … }   impl PartialEq<i64> for NumLit { … }
impl PartialOrd<NumLit> for i64 { … as f64 … }   impl PartialOrd<i64> for NumLit { … }
// + Add/Sub/Mul/Div<NumLit> for each numeric type (Output = f64), and the reverse direction.
// deliberately NO Truthy/ToText/From impl — see below.
```

- `{{#if views > 100}}` → `(ctx.views > trussbars_core::NumLit(100.0))` — compiles for `i64`,
  `f64`, `u32`, … (the field's `PartialOrd<NumLit>` impl coerces via `as f64`, *inside the
  library*, so no cast-lint reaches the user).
- `{{#if name < "m"}}` → `(ctx.name < "m")` — a *string*-literal operand is not a `NumLit`, so
  native string ordering is preserved.
- `{{#if name > 100}}` → `(ctx.name > NumLit(100.0))` — no impl ⇒ a **compile error**. The
  oracle returns *false* at runtime; the typed setting upgrades that latent bug to a caught
  one, consistent with §5.1/§5.3.
- **Conformance:** `f64` fields compare/arith against `NumLit` bit-identically to today's
  `f64` literal (`f64 op NumLit` widens nothing), so output is unchanged. Re-run as the
  acceptance gate: `npm run test:trussbars-v2` → **71/71, 0 drift** (and the default
  PureScript-emitter path is untouched, since `NumLit` is a v2-emitter concern).

**Costs / accepted consequences:**

1. A new core surface (5 ops × 14 numeric types × 2 directions, macro-generated; `NumLit op
   NumLit` for two literals).
2. Result-type drift: `i64_field + 1` becomes `f64` (today it doesn't compile at all) — the
   *intended* type under the "numbers are `f64`" model (§8). Accepted & documented here.
3. `name > 100` (string vs number) becomes a compile error (the interpreter renders it as a
   silent `false`) — accepted as the §5.1/§5.3 footgun-as-caught-error discipline.
4. `NumLit` deliberately implements **no** `Truthy`/`TruthyIn`, so `{{#if 1}}` stays the §5.3
   compile error; and it never reaches a render/helper/std-call site (operand-only), so it
   needs no `Display`/`From`.

### Option B — close F2 as by-design: numeric fields are `f64`

Keep numbers `f64` end to end (§8 already says so) and **document** that a host's numeric
context fields are `f64` (or `Option<f64>`); `{{#if views > 100}}` then "just works". F2
becomes a one-paragraph spec note + a clearer compile error, not a feature. Zero machinery,
zero conformance risk. The cost is borne by the host's type (an `i64` from an upstream API
needs an `as f64`/`#[serde(...)]` at the boundary), which is the §8 "declare your schema"
philosophy.

### Option C — defer to schema inference (`docs/03`)

With an inferred/known context type, the emitter *could* pick `100` vs `100.0` per the
field's actual type — the precise fix. But that is the G2 critical-path item and not
standalone; F2 would wait on it.

## 4. Decision (recorded)

The string-ordering constraint (§2) means F2 has no *small* fix: Option A (a real, contained
core addition) or Option B (reclassify F2 as a documented consequence of the f64 model), with
Option C (schema inference) strictly better but gated on a larger arc.

**Chosen: Option A** — first-class `i64`/`u*` numeric fields are worth the contained core
surface. The three judgement calls were resolved as:

- Build `NumLit` (not just document the f64 contract).
- Accept `i64 + literal → f64` as the intended result type under §8.
- Accept `name > 100` (string vs number) as a **compile error** — it cannot match the oracle's
  runtime `false` without runtime dispatch, and the stricter caught error is the better
  failure mode in a typed setting.

The conformance re-run was part of the gate: `test:trussbars-v2` is **71/71, 0 drift**.

**Implemented in:** `trussbars-core` (`numlit.rs`, the `NumLit` type + macro-generated impls),
`trussbars-template` (`emit::emit_operand`, wrapping numeric-literal `bin_op` operands).
Covered by `numlit.rs` unit tests, an emitter test (literal → `NumLit`; string operand
untouched), and a macros end-to-end test (`views: i64` with `> 100`).
