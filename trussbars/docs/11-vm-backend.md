# Trussbars — The VM Backend (dynamic / runtime templates)

> **Status:** Decision doc / design — *paper first, no code yet*. **Audience:** whoever
> builds the second production backend. Companion to `docs/01` (the subset spec, which
> this **amends**), `docs/04` (conformance), `docs/08` (the v2 Rust front-end this
> reuses), and `docs/10` (the inspector).

## 1. The framing that motivates this

A late-but-decisive product decision reframes the project:

- **MaxBars (PureScript) is the *reference* — the oracle, the academic lab.** It
  *defines* the semantics and is the conformance source of truth. It is **not shipped
  to production.**
- **Trussbars (Rust) is *the* production implementation.**

That single line forces the rest. A production template engine must serve **both**
static templates (known at build time) **and** dynamic templates (authored/loaded at
runtime). Today Trussbars serves only the first, via the **AOT** backend
(`docs/08` → typed Rust). The dynamic case has *no production answer* — and "use the
PureScript engine" is explicitly disallowed, because that engine is the lab, not
production. So the dynamic backend **must be Rust**. That backend is a **VM**.

This is **production completeness**, not positioning. It also yields the unified
story — *one MaxBars language, two production backends, proven equivalent* (Askama
and minijinja in one) — but the story is the consequence, not the justification.

## 2. The amendment to "no interpreter/VM"

`docs/01` froze **"no interpreter, no VM — templates compile to straight-line Rust."**
That was correct *for the static/typed path* and stays the default. It is **amended**,
not repealed:

> **AOT is the default, typed path. A second **VM backend** serves dynamic / runtime
> templates with the *same language and the same semantics*, conformance-proven against
> the MaxBars oracle. The injection-safety invariant — *names are static, data is
> dynamic, the two never cross* — is **preserved in both backends**: in the VM, names
> are fixed when the template is loaded/compiled (to bytecode or a checked tree); only
> data values are dynamic at run time.**

What this buys, and what it costs, stated plainly:

| Property | AOT (today) | VM (this doc) |
| --- | --- | --- |
| **Runtime-authored templates** | ❌ structurally impossible | ✅ **the sole irreducible reason it exists** |
| **Injection-safe (no SSTI)** | ✅ no interpreter at all | ✅ **preserved** — static names rule (§6); no `apply`, no computed partials, no computed `lookup` |
| **Host-typed field checking** (`{{post.titlee}}` ⇒ compile error) | ✅ rustc-enforced | ⚠️ lost in lenient mode; **recovered in AOT-compat mode** (§7), exact for the modeled subset |
| **Performance** | safe-Rust ceiling (~0.8 µs, docs/05) | interpreter — 10–100× slower; still expected to beat handlebars, nowhere near AOT |
| **`no_std` + `forbid(unsafe)`** | ✅ | ✅ **shipped** — the VM lib (+ the `trussbars-template` parse path it reuses) builds `--no-default-features` for bare-metal/WASM; `alloc`-only, `forbid(unsafe)` (see §5). The dev `truss-vm` CLI stays `std`. |

The host-typed-checking loss is the real trade. It is the *same* trade Tera/minijinja
make against Askama/Maud — Trussbars now spans both halves of that split deliberately,
with one semantics and a conformance proof between them.

## 3. It is a backend, not a second engine

The VM is the **fifth instance of the project's founding IoC pattern** (*"the core
walks; plug-ins supply meaning"* — interpret / desugar / validate / compile are the
first four). It **reuses the entire v2 front-end and all the semantics** already built
and tested:

```text
              ┌─────────────────────────── REUSED (docs/08, done) ──────────────────────────┐
  template ─▶ lex ─▶ parse ─▶ desugar ─▶  Node / Expr AST  ─┬─▶ AOT backend  → typed Rust  (done)
              (trussbars-template)                          │   (emit.rs)
                                                            └─▶ VM backend   → run dynamically  (NEW)
              ┌──────────────────────────── NEW ────────────────────────────┐
              │  dynamic Value model · the run loop · host-data binding ·     │
              │  (optional) bytecode compile · the 3rd conformance axis       │
              └──────────────────────────────────────────────────────────────┘
```

Shared (no new work): the lexer, parser, desugar, the `Node`/`Expr` AST, and the
**semantics specs** — truthiness (`nonEmpty`), escaping, the helper catalog, the
injection boundary. The VM consumes the *same desugared AST* the AOT emitter consumes.

## 4. Tree-walk first, bytecode later

The name "VM" implies bytecode, but the right **first cut is a tree-walking
interpreter over the existing `Node`/`Expr` AST** — it reuses the AST directly, needs
no instruction set, and is the shortest path to *a running dynamic backend + the
conformance gate green*. **Bytecode is a later optimization**, added only if profiling
the tree-walker shows it's warranted (the same evidence-first discipline as docs/05).

```text
Phase A (tree-walk):  AST ── eval(node, scope, data) ──▶ String        ← build this first
Phase B (bytecode):   AST ── compile ──▶ [Op] ── VM loop ──▶ String     ← only if A is too slow
```

So most of this doc is really *"a dynamic-`Value` tree-walk interpreter for MaxBars in
Rust, sharing the v2 front-end."* The instruction set is deferred until there's a
reason.

### 4.1 Measured (the spike + an allocation pass)

The tree-walk spike is built (`trussbars-vm`) and gated: **34/34** of the covered
conformance corpus byte-match the oracle (the rest report `unsupported`, honestly —
partials, the collection filters, `pluck`/`sortBy`/`groupBy`, a few helpers). It is the
6th engine in `trussbars/benchmarks`; the perf gate asserts **AOT ≤ VM ≤ handlebars**.

A first naive cut deep-cloned the context on every scope entry — **555 ms** on big-table
(≈200× *slower* than handlebars). An allocation pass fixed it, in four commits, each the
textbook fix for a tree-walk interpreter:

| | change | effect |
| --- | --- | --- |
| **O5** | `Rc`-backed cheap-clone `Value` (`Str(Rc<str>)`, `Array(Rc<[Value]>)`, `Object(Rc<…>)`) | clone = refcount bump, not deep copy; env holds `Value` directly |
| **O1** | parent chain as an `Rc` cons-list | O(1) push vs `Vec::insert(0,…)`'s O(depth²) |
| **O3** | write-through escaped output (`write_escaped`) | no temp `String`, one fewer copy per interpolation |
| **O2** | adaptive output-capacity hint + `render_into` | seed `with_capacity`, reuse a host buffer |

Result (release, min-of-N), VM vs the field:

```text
              AOT      VM       Askama   handlebars      VM vs handlebars
big-table     ~34 µs   826 µs   123 µs   2.61 ms         ~3.2× faster
teams         ~42 ns   1.04 µs  166 ns   3.88 µs         ~3.7× faster
```

The allocation pass roughly **halved** the VM's time on both workloads (big-table
1.74 ms→826 µs, teams 2.17 µs→1.04 µs) on top of the first Rc-context fix. AOT stays
~25–800× faster than the VM — the expected compiled-vs-interpreted gap, and the reason
AOT remains the speed story while the VM owns dynamic flexibility.

**Conclusion (evidence-first, like docs/05):** a *cheap-clone `Value` + tree-walk* clears
the bar (VM ≥ handlebars, by 3×) without bytecode.

### 4.2 Bytecode experiment (measured)

The deferral was *pending a measurement* that bytecode beats the tree-walk. A subset
bytecode VM (`bytecode.rs` — a flat instruction array + a stack machine; covers the
benchmark workloads, errors on the rest) provides it. Byte-identical to the tree-walk
(asserted in the equality gate); same min-of-N run:

```text
              AOT     vy(unsafe)  tree-walk   BYTECODE    handlebars
big-table     54 µs   19 µs       1.14 ms     371 µs      2.6 ms      bytecode ~3.0× the tree-walk
teams         41 ns   83 ns       1.25 µs     667 ns      3.9 µs      bytecode ~1.9× the tree-walk
```

So **bytecode is ~2–3× faster than the tree-walk** — real, and as expected (no AST
pointer-chasing; flat dispatch). But two things temper it: **(a)** AOT stays ~7–16×
faster than *bytecode* (it's still the speed path — if you need speed, compile), and
**(b)** the tree-walk *already* cleared the only hard bar (≥ handlebars, by 3×).

**Verdict:** bytecode is a genuine dynamic-path speedup, but the *full* build (the whole
catalog + a name→slot resolve pass + a 3rd conformance axis + perpetual two-backend
maintenance) is a large, permanent cost for a path where **AOT is the speed answer**. So
bytecode **stays deferred** — now with data — gated on a real trigger: a workload where
*dynamic-path throughput* is the proven bottleneck (the 2–3× would matter there), a named
*embedding* consumer (a portable bytecode artifact), or the AOT-compat *compile pass*
(load-time checks + slot resolution, which is half a bytecode compiler anyway). Not a
speed chase — but the experiment crate stays as the head-start.

## 5. The dynamic `Value` model (the part AOT shed)

AOT works on the host's *typed* structs (`ctx.user.name`). The VM cannot — it
interprets data it doesn't know the shape of at compile time. So it needs a **dynamic
`Value`** — exactly what AOT eliminated, and essentially the PureScript engine's value
model, ported to Rust:

```rust
enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Array(Vec<Value>),
    Object(BTreeMap<String, Value>),   // ordered → loop.key is deterministic
}
```

`alloc`-only (no std), so the `no_std` + `forbid(unsafe)` posture carries over.
Truthiness reuses the **same `nonEmpty` rule** the AOT runtime encodes (numbers are a
documented edge — see §8). **Open decision (D2):** is this a bespoke enum, or
`serde_json::Value` (free host interop, but a dependency and a fixed shape)?

## 6. Injection safety in the VM — the load-bearing rule

The VM is only defensible because it **keeps the AOT invariant**. Concretely:

- **Names are resolved at *load* time, not render time.** When a template is parsed +
  desugared, every `lookup` path, helper head, and partial name is *fixed* in the AST.
  Data flowing in at render time fills **values only** — it can never become a name, a
  path segment, a helper, or a partial.
- The same constructs AOT rejects stay rejected **in the VM too**: `apply` (the
  eval-shaped meta-helper), computed partials `{{> (expr)}}`, computed-key `lookup`.
  This is enforced once, in the shared front-end / a shared check — not per backend.

So a runtime-*authored* template is still safe to *run*: authoring fixes the names;
the data never crosses into them. (Authoring-time trust is a separate, host concern —
the VM's guarantee is that *running* a parsed template can't be made to eval data.)

## 7. Host-data binding & the render modes

The host hands the VM **data** (a `Value`, or `serde_json::Value`, or a value behind a
trait) plus the template. **Open decision (D3):** the binding surface —
`render(template: &str, data: &Value) -> Result<String, RenderError>` is the minimum.

Three render modes, from most dynamic to a strict AOT proxy:

1. **Lenient** (the default for dynamic use): missing key → `nonEmpty`-falsy / empty,
   like the reference. No schema needed; maximally dynamic; runtime-fallible.
2. **Schema-checked** (opt-in): validate the template's referenced paths against a
   host-supplied schema *at load*, recovering *some* of AOT's safety without rustc.
   The natural home for `docs/03` schema-inference.
3. **AOT-compat (strict) — REQUIRED.** A mode that **accepts exactly what AOT accepts
   and produces byte-identical output** — the VM as a *verifying proxy for AOT*. Given
   the host schema, it applies AOT's exact static rules at load:
   - every referenced path must exist (missing field → error, *not* lenient-empty);
   - **numeric truthiness is an error** (`{{#if count}}` is rejected — AOT's Option C,
     no `Truthy` for numbers; `docs/01`);
   - **a bare struct/object in output position is an error** (AOT has no `ToText` for
     structs);
   - operations are restricted to AOT's supported set (so the dynamic-only host-helper
     / i18n pack of §8 is rejected *here*), and operand types must line up against the
     schema — the checks rustc would make.

   The guarantee: **if a template runs in AOT-compat mode, it will compile under AOT
   and render identically.** This closes the `AOT ⊂ VM` asymmetry on demand, makes
   *prototype-dynamic → ship-typed* safe, and gives the Studio (docs/10) an **AOT
   preview without a Rust toolchain**.

   It is **100% compat *modulo schema fidelity*** — it checks against the *schema*, not
   the host's real Rust types, so it is exact for the modeled subset (structs of
   scalars / arrays / nested structs — Trussbars' target shape). A schema single-sourced
   with the host type (a declaration, or `docs/03` inference) keeps that boundary tight;
   it is verified, not asserted (§9).

## 8. Where the VM *leads* AOT: host helpers & i18n (F3)

AOT's open gaps are exactly the **host-dependent** ops — `t` / `relative` / `number` /
`date` / `selectPlural` / `json` (the i18n-locale seam + custom helpers, gap **F3**
in `docs/06`). These are *dynamic by nature*, and a VM serves them **trivially**: a
runtime **helper registry** (`name → fn(&[Value]) -> Value`) is a few lines, where AOT
needs monomorphized codegen + a registration affordance. So the VM is the natural
*first* home for host helpers and i18n — it can be **more** complete than AOT on the
catalog, not less. (AOT pure-op gaps `range`/`bind`/`log` and `dict` are separate,
small, and tracked independently of this doc.)

**Done** (`trussbars-vm`): `Helpers` is exactly that registry — `register(name, |args:
&[Value]| -> Result<Value>)` — passed to `Template::render_with`. An unknown helper
head resolves against it; in AOT-compat mode host helpers are **rejected** (AOT
registers none), keeping the verifying-proxy guarantee. The i18n/locale pack on top is
then just a set of host helpers (a follow-up that needs no engine change).

## 9. Conformance — the third axis

The project's safety net extends cleanly. Today: **interpreter (oracle) ≡ AOT**
(56/56, `docs/04`). Add **VM ≡ oracle**, reusing the *same corpus and harness shape*:
render each case through the VM, assert byte-equality against the committed golden —
exactly as `harness.mjs` does for AOT (a `--vm` flag beside `--v2`). Then **VM ≡ AOT**
follows transitively on the shared subset.

Crucially, the VM can run the corpus cases **AOT cannot** (dynamic-data / runtime
templates) — those get their own oracle (the PureScript engine renders them too, since
it's also dynamic), so the VM is gated everywhere, with **no silent gaps**.

**AOT-compat (§7) is *gated*, not claimed.** The harness asserts, across the whole
corpus *including the negatives*, that the VM in AOT-compat mode **accepts iff AOT
accepts** and **outputs byte-identically** — so a bare-number `{{#if}}` and
bare-struct output are rejected by *both* (while a `dict` literal, now AOT-supported,
is accepted by both), and every positive renders the same bytes. "100% compat" is
therefore a tested contract, exactly the way `interpreter ≡
AOT` already is — the harness `excluded` ledger (AOT-rejected cases) becomes the
AOT-compat *reject* oracle.

```text
        MaxBars oracle (PureScript, reference)
          ║                         ║
          ║ 56/56 (done)            ║ NEW: --vm gate, same corpus + the dynamic-only cases
          ▼                         ▼
        AOT  ───────── ≡ ───────── VM        (transitive on the shared subset)
```

## 10. Relationship to the Studio (docs/10) — a freebie

The VM **compiled to WASM** *is* the production dynamic engine running in the browser.
So the Studio gets, in one artifact: **dynamic render with production Trussbars
semantics** (not the reference) **+** the AOT compile-to-Rust view, with the PureScript
reference kept alongside to **diff** against. The earlier WASM-AOT slice (W1: compile +
diagnostics + source→Rust tiles) becomes the *first half* of that same WASM surface;
the VM is the second half.

## 11. Open decisions (resolve before / during implementation)

| # | Decision | Default lean |
| --- | --- | --- |
| **D1** | Tree-walk first, bytecode later? | **Yes** (§4) — evidence-first, like docs/05 |
| **D2** | `Value`: bespoke `enum` vs `serde_json::Value` | bespoke `enum` (no dep, `no_std`, ordered objects) — revisit if host interop dominates |
| **D3** | Host-data binding surface | `render(&str, &Value) -> Result<String, RenderError>`; partials/helpers via registries |
| **D4** | Schema-checked + **AOT-compat** load modes | **required, not optional** — AOT-compat is a launch capability (the 100%-compat guarantee, §7/§9). Lenient is the default; schema-checked + AOT-compat are opt-in modes. Wire `docs/03` inference into the schema |
| **D5** | **Sequencing: VM next, or finish the AOT/Studio surface first?** | *the one genuinely open ordering call* — see below |

### D5, the sequencing question

- **VM next.** Start the second production backend now; the Studio's dynamic engine
  falls out of it. Larger first step, but it's the strategic spine.
- **AOT-Studio first.** Ship the visible Studio (W1: `trussbars-wasm` compile +
  diagnostics + source→Rust tiles + a Lab panel), *then* fold the VM in as the second
  half. Smaller, demos sooner, and the VM-in-WASM slots into the same panel later.

Both are coherent; this is the decision to make next. Everything above is backend-shape
design that holds regardless of order.

## 12. Scope honesty

This is a **months, not days** workstream — a dynamic value model, a run loop, host
binding, host-helper/i18n registries, the schema-check bridge, and a third conformance
axis — but it is *one backend on a finished front-end and a settled semantics*, not a
second engine. The MaxBars oracle is its definition of done, exactly as it was for AOT.
