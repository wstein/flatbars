# Trussbars — Selectable truthiness policies (`TruthyIn<Mode>`)

> **Status:** **SHIPPED** (`trussbars-core`, `trussbars-derive`, `trussbars-template`,
> `trussbars-macros`). **Audience:** the runtime crates, the v2 emitter/proc-macro, and any
> host that wants a non-`nonEmpty` truthiness rule. **Decision:** truthiness is a trait
> *parameterized by a policy marker* — `TruthyIn<Mode>` — with `NonEmpty` the default and only
> conformance-checked policy; `Liquid`, `Handlebars`, and host-defined policies are loud,
> per-template, type-directed opt-ins. **Companion docs:** amends `docs/01` (§2, §7.1, §11),
> `docs/02` (§3), `docs/06` (§2 value policy).

## 1. The problem

Trussbars' default rule is `nonEmpty` minus numbers (`docs/01` §7): `""`, `[]`, `{}`, `false`,
`null` are falsy; numbers have no impl, so a bare-number condition is a compile error (§5.3).
That is the right default — it deletes the `0`-truthy-vs-falsy ambiguity instead of picking a
side. But a host embedding Trussbars in a Liquid- or Handlebars-shaped codebase may need a
*different* family's semantics (under Liquid, `""`/`[]`/`0` are all truthy; only `false`/`nil`
are falsy). The original `Truthy` trait could not express this: its impls for `str`, `Vec`,
`i64`, … are foreign to a host crate, so the orphan rule forbids the host from changing them.
Forking `trussbars-core` was the only escape — unacceptable.

## 2. The decision — a policy marker as a trait type parameter

Replace the fixed trait with a mode-parameterized one:

```rust
pub trait TruthyIn<Mode> { fn truthy(&self) -> bool; }

pub struct NonEmpty;   // default
pub struct Liquid;
pub struct Handlebars;

pub fn truthy<T: TruthyIn<NonEmpty> + ?Sized>(v: &T) -> bool { /* default */ }
pub fn truthy_in<Mode, T: TruthyIn<Mode> + ?Sized>(v: &T) -> bool { /* a chosen policy */ }
```

`trussbars-core` ships the per-type impls for each built-in policy. The codegen knows the
static type of every boolean-position expression, so it emits `truthy_in::<Mode, _>(…)` (or
the bare `truthy(…)` for the default) and lets ordinary trait resolution pick the right impl.

**Why this is the right shape — the orphan rule.** `impl TruthyIn<Liquid> for str` is legal in
`trussbars-core` (local trait). More importantly, **a host can write `impl TruthyIn<MyMode> for
str` in its own crate** even though both `TruthyIn` and `str` are foreign — because the marker
`MyMode` is *local*, and a local type parameter that is not preceded by an uncovered type
parameter satisfies the orphan rule (RFC 2451). So a host defines its own policy over the
standard library's types, not just its own newtypes. The mechanism is the extension point.

**Why it costs nothing.** Every marker is a zero-sized type and every `truthy_in::<Mode, _>`
call is monomorphized to a direct call — identical codegen to the old fixed trait once `Mode`
is fixed. There is no runtime dispatch, no `Value`, no policy field. This preserves the §9
"no interpreter" thesis: a policy is a *type*, resolved at compile time.

## 3. The built-in policies

| Type | `NonEmpty` (default) | `Liquid` | `Handlebars` |
| --- | --- | --- | --- |
| `bool` | `*self` | `*self` | `*self` |
| `()` (`null`) | `false` | `false` | `false` |
| `str` / `String` / `Safe` | non-empty | `true` | non-empty |
| `[T]` / `Vec<T>` | non-empty | `true` | non-empty |
| `BTreeMap` (`{}`) | non-empty | `true` | `true` (object always truthy) |
| `Option<T>` | defers to inner | defers | defers |
| numbers | *no impl* (compile error) | `true` | `0`/`NaN` falsy, else truthy |
| context struct/enum | inhabited ⟹ truthy | same | same |

`bool`, `()`, `Option<T>`, and `&T` are **mode-invariant** — one `impl<Mode>` covers every
policy (`Option` defers to its inner type *under the same policy*, so `Some("")` is falsy under
`NonEmpty` but truthy under `Liquid`). The Handlebars number rule mirrors the JS falsy set
(`0` and `NaN` falsy, `Infinity` truthy). A context type is truthy under every policy, so
`#[derive(Trussbars)]` emits a blanket `impl<__TruthMode> TruthyIn<__TruthMode>`.

## 4. Selecting a policy

```rust
truss!(card, Card, "{% if tags %}…{% endif %}", truthiness = Liquid);        // a built-in policy
truss!(note, Note, "{% if body %}…{% endif %}", truthiness = self::NonBlank); // a host policy
```

The `truthiness = Mode` clause sits alongside `helpers = [..]` (any order); the default is
`NonEmpty`. `Mode` is either a **built-in ident** (`NonEmpty` / `Liquid` / `Handlebars`) or a
**host policy named by its Rust type path** (`self::NonBlank`, `crate::policies::Foo`): the
emitter drops the path straight into `truthy_in::<Path, _>`, so a host's own
`impl TruthyIn<Mode>` (the §2 orphan-rule extension) governs the condition at zero cost. The
path requirement is the disambiguator — a *lone* identifier must be a built-in, so a typo
(`truthiness = Mustache`) stays a located class-A `compile_error!` naming the valid modes
(pinned by `tests/ui/unknown_truthiness.{rs,stderr}`), while a host marker is written as a
path. The choice is per-template and visible in the source — the same template with and
without the clause renders `[]` as truthy or falsy respectively, so a divergence is never
silent.

## 5. Conformance posture

The oracle is `nonEmpty`, so **only `NonEmpty` is conformance-checked** — the v2 harness stays
byte-identical (the default emits the unchanged `trussbars_core::truthy(…)` call). The other
policies *intentionally* diverge from the oracle and are therefore **out of conformance by
construction**, exactly like custom helpers (`docs/01` §11). They are gated instead by:

- `trussbars-core` `TruthyIn<Mode>` unit tests (every policy, including a host-defined marker
  proving the orphan-rule extension);
- the `truss!(…, truthiness = …)` end-to-end render tests — built-in *and* host-selected-by-path;
- the emitter unit test that a custom path becomes the `truthy_in::<Path, _>` marker;
- the unknown-mode `trybuild` golden.

## 6. Alternatives rejected

- **A global `truss!` string flag that flips semantics invisibly.** This is FlatBars's runtime
  policy switch in disguise — it re-opens the §5.3 ambiguity with no type-level trace and would
  break the oracle silently. The shipped design is the opposite: type-directed, defaulting to
  the strict rule, and the divergence is a named type in the source.
- **A per-call runtime `fn(&Value) -> bool` callback.** Reintroduces the §9 interpreter seam
  (a `Value` dispatch) and is monomorphization-hostile. The static answer already exists:
  write the comparison.
- **Author-side newtype wrappers (`Liq<T>`).** Orphan-legal but unusable — either the template
  author wraps every value, or codegen auto-wraps, which is this design with a redundant type.
- **A Cargo feature flag.** Features are additive and unify across the dependency graph, so two
  crates wanting different policies in one build is unresolvable, and it is global, not
  per-template.

## 7. Implementation pointers

- `crates/trussbars-core/src/truthy.rs` — the trait, the three markers, the per-policy impls,
  `truthy` / `truthy_in`, and the unit tests (including the host-defined-policy test).
- `crates/trussbars-derive/src/lib.rs` — the blanket `impl<__TruthMode> TruthyIn<__TruthMode>`
  for context structs/enums.
- `crates/trussbars-template/src/emit.rs` — `TruthMode` and `TruthMode::call`, threaded through
  `Env`; every boolean-position emission routes through `Env::truthy_ref`.
- `crates/trussbars-macros/src/lib.rs` — the `truthiness = Mode` clause parser.
- `crates/trussbars-vm/src/lib.rs` — `Value::truthy_in`, `Template::with_truthiness`, the
  policy-aware `truthy_at`, and the `TruthMode` re-export (the dynamic-backend parity).

## 8. Shipped follow-ups

- **VM parity — DONE.** The bytecode VM (`docs/11`) mirrors the policy:
  `Value::truthy_in(mode)` and `Template::with_truthiness(mode)` carry the selected policy as a
  load-time setting (the dynamic backend's home for a runtime-swappable rule), the single
  `truthy_at` decision point applies it, and the numeric AOT-compat rejection fires only under
  `NonEmpty`. A non-default policy renders via the tree-walk, not the `NonEmpty` bytecode fast
  path. `truss-interp --truthiness=<Mode>` exposes it; `harness.mjs --interp`/`--vm` stay 76/76.
- **Friendlier diagnostic — DONE.** `TruthyIn` carries `#[diagnostic::on_unimplemented]`, so a
  numeric (or otherwise un-impl'd) condition reports *"`i64` is not truthy under the `NonEmpty`
  policy"* with notes to write a comparison, select a policy, or impl `TruthyIn` — and `rustc`
  adds that `i64` *does* implement `TruthyIn<Liquid>`/`TruthyIn<Handlebars>`. The guidance is on
  the trait, so it fires under both v1 and v2; the compile-fail behavior is gated by the
  `truthy` doctest (the error *class*, per `docs/04` §11 — the exact rustc wording is
  deliberately not pinned).
