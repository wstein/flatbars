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
| **`no_std` + `forbid(unsafe)`** | ✅ | ✅ **shipped** — the VM lib (+ the `trussbars-template` parse path it reuses) builds `--no-default-features` for bare-metal/WASM; `alloc`-only, `forbid(unsafe)` (see §5). The dev `truss-interp` CLI stays `std`. |

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

The tree-walk interpreter is built (`trussbars-interp`) and gated: **34/34** of the covered
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

### 4.2 Bytecode VM — separate crate, measured (faster than the tree-walk)

The deferral was *pending a measurement* that bytecode beats the tree-walk. The bytecode
VM now lives in its **own crate, `trussbars-vm`** — honestly separated from the tree-walk
**interpreter** (`trussbars-interp`), which keeps the name that fits what it is. The VM
reuses the interpreter's [`Value`] and `write_escaped`/`raw_text` writers verbatim (so the
two dynamic backends stay byte-identical, asserted in the equality gate), and adds a flat
instruction array run by a **borrow-based machine**: output and control ops carry a
pre-resolved path, the evaluator resolves it to a `&Value` and writes straight to the
buffer, so the render hot loop does **zero `Value` clones and keeps no value stack** (only
an `Rc` refcount bump per loop entry). It covers the benchmark subset and errors on the
rest. Criterion medians (release; the perf-gate min-of-N agrees within noise):

```text
              AOT     vy(unsafe)  BYTECODE-VM   interpreter   Tera     handlebars
big-table     36 µs   20 µs       329 µs        502 µs        585 µs   2.67 ms    VM ~1.5× the interpreter
teams         88 ns   137 ns      420 ns        1.20 µs       2.50 µs  4.03 µs    VM ~2.9× the interpreter
```

> **Two honest re-measurements.** (1) The original figures showed the tree-walk at
> ~1.14 ms / ~1.25 µs but the *benchmark column* at ~371 µs — because the interpreter's
> `Template` silently ran the bytecode fast path for the covered subset, so the
> "interpreter" column was secretly measuring bytecode (the two came out *tied*). That fast
> path was **removed**: `trussbars-interp` became a pure tree-walker measuring ~1.14 ms,
> the (borrow-based) VM ~326 µs — then ~3.5× faster. (2) Profiling that tree-walk found its
> cost was **per-cell allocation**: `eval_for` allocated an `Rc<LoopFrame>` *and* an
> `Rc<ParentNode>` for every iteration, plus a whole-collection `Vec` per loop entry —
> 20 304 allocations for a 10 000-cell render. The fix: allocate **one** reused loop frame
> (interior-mutable `index0`/`key`, advanced in place) + **one** parent-chain node per loop
> *entry*, build the child scope once, and iterate by reference (20 304 → **306**
> allocations, ~2.4× faster). The interpreter now clears Tera, and the VM's lead over it
> shrank to ~1.5× (big-table) / ~2.9× (teams). So the perf gate ratchets the **ordering**
> `AOT ≤ VM ≤ interpreter ≤ handlebars`, not a fixed multiple.

So **the bytecode VM is ~1.5–2.9× the interpreter** — still real (no AST pointer-chasing,
flat dispatch, a borrow-based zero-clone hot loop), but narrower now that the interpreter
no longer allocates per cell. Two things temper it: **(a)** AOT stays ~9–14× faster than
the *VM* (it's still the speed path — if you need speed, compile), and **(b)** the
interpreter alone now clears not just handlebars but Tera, so the VM is an *optimization*,
not the thing that makes the dynamic path viable.

**Verdict:** the VM is a genuine dynamic-path speedup and ships as its own crate
(`trussbars-vm`) covering the benchmarked subset. Whether to grow it to the *full* catalog
(a name→slot resolve pass + a 3rd conformance axis + perpetual two-backend maintenance) is
*more* of a judgement call now that the optimized tree-walk is itself fast — gated on a
real trigger: a workload where *dynamic-path throughput* is the proven bottleneck, a named
*embedding* consumer (a portable bytecode artifact), or the AOT-compat *compile pass*
(load-time checks + slot resolution, which is half a bytecode compiler anyway). Not a speed
chase — but the crate is here, optimized, with the head-start banked.

### 4.3 Promotion to a first-class backend (the trigger fired)

The trigger is now a **product decision**: the VM is promoted from a benchmark subset to a
**first-class, full-coverage dynamic backend** — it renders *every* valid Trussbars
template (no compile-time subset rejection, no fallback to the interpreter) and becomes a
**conformance axis** (`harness.mjs --vm`, byte-matched to the oracle over the whole corpus,
alongside `--interp`).

The §4.2 objections are answered by **one architectural choice — share the interpreter's
evaluator, don't fork it:**

- **No "perpetual two-backend maintenance" of the catalog.** The operator / value-helper /
  collection-op semantics live in exactly *one* place — `trussbars_interp::eval_expr` — and
  the VM *calls* it. The VM owns only the **structural bytecode** (text, output, the
  control-flow jump skeleton) and the **borrow-based path fast-path** (the §4.2 zero-clone
  `this`/`root`/field resolver). A new helper added to the interpreter is instantly available
  to the VM; there is no second catalog to keep in sync.
- **No "name→slot resolve pass."** The VM keeps interpreting names against a dynamic
  context (it is a *dynamic* backend — that is its whole reason to exist next to AOT). Slot
  resolution is an AOT-compile-pass concern, explicitly out of scope here.
- **The "3rd conformance axis" is a thin gate, not a third implementation.** Because the
  semantics are single-sourced, `--vm` byte-matching the oracle is mechanically guaranteed
  for everything routed through `eval_expr`; the axis just *proves* the structural compiler
  didn't drop or reorder anything.

**Architecture — bytecode skeleton over a shared engine.** The VM compiles the desugared
`Node` tree to a flat op array and drives a render context that mirrors the interpreter's
`Env` (`this`/`root`/scope bindings/loop frames/parents/partials/`yield`/truthiness/helpers):

- **Structure** → bytecode ops: `Text`, `Out`, the `if`/`each`/`with`/`let`/`case` jump and
  frame ops, partial/`yield` ops. This is the flat-dispatch, no-AST-pointer-chasing win.
- **Simple paths** (`this`/`root`/`field…`) → the existing **borrow-based fast op** —
  resolve to `&Value`, write straight to the buffer, zero clones. The common hot case stays
  fast.
- **Everything else in an expression** (operators, ternary, pipes, value/collection
  helpers, literals) → the shared `eval_expr` against the VM's context. Correct and
  byte-identical by construction; optimized later only where profiling shows a hot path.

**Completeness-first, then specialize.** A construct with no native fast op yet still
renders — it routes through the shared engine — so coverage reaches 100% before any
micro-optimization. We promote a construct from shared-eval to a native borrow-based op only
when the benchmark says it matters; speed is a ratchet on top of correctness, never a gate
on coverage.

**Interpreter surface this needs (kept minimal).** `trussbars-interp` exposes its evaluator
as the shared engine: `eval_expr` and the render context (`Env`) become a small public API
the VM constructs from its frame state and calls. The interpreter's own tree-walk is
unchanged; the VM is a second *driver* of the same semantics, not a copy of them.

**Plan (each slice green + `--vm` byte-matched):** (1) expose the interp engine + add the
`--vm` conformance axis; (2) general expression `Out`/condition via shared `eval_expr`
(operators/helpers/literals in output + `if`); (3) full `each` (bindings, `else`, loop
metadata), `unless`/`elif`/`else`; (4) `with`/`scope`, `let`/`local`, `case`; (5) partials
(`inline`/`include`/`partial`/`yield`) + recursion guard; (6) the non-default truthiness
policy (drop the interpreter fallback). Native borrow-based fast ops are added opportunistically,
gated on the perf benchmark — not on the conformance axis.

**Status — delivered.** The VM is now a first-class, full-coverage backend. The interpreter
exposes its evaluator (`eval_expr`/`eval_nodes`/`Env` with `root`/`push_loop`/`set_iter`/
`bind`/`rerooted`, and `hoist`) as the shared engine; `trussbars-vm` compiles the `if`/`each`
structure to bytecode driving an `Env` stack, routes every expression through the shared
`eval_expr`, and renders the rarer blocks (`with`/`scope`, `let`/`local`, `case`, partials,
host block helpers, raw) through a `Delegate` op → `eval_nodes`. There is no subset and no
fallback — `Program::compile` accepts every valid template. The `truss-vm` CLI + the
`harness.mjs --vm` axis prove it: **75/75 rendered corpus cases byte-match the oracle**,
identical to `--interp`.

**Status — specialized (perf-gated).** The full-coverage rewrite initially routed *every*
expression through the shared `eval_expr`, which clones the leaf + pays dispatch — so the VM
lost its lead and the perf gate failed (`teams`: VM 1.17 µs > interpreter 1.08 µs). The
specialization pass restored `VM ≤ interpreter` by promoting the hot constructs to native
borrow-based / zero-eval ops, each landed only when the benchmark justified it and each kept
byte-identical (`--vm` stays 75/75):

- **`OutPath` / `JumpUnlessPath`** — a `this`/`root` field path resolves to a leaf `&Value`
  and is written / truth-tested directly (zero clone, no `eval_expr`). The dominant output
  and condition forms.
- **`JumpUnlessFirst`** — `{% if loop.first %}` reads the loop frame's `index0` straight off
  `Env::loop_first()` (no `Value`, no path walk).
- **`ScopeStart`/`ScopeEnd`, `LocalStart`/`LocalEnd`** — `{% scope %}` (re-root) and
  `{% local %}` (block aliases) drive the `Env` stack natively instead of delegating.

`Delegate` now carries only `case`, partials, host block helpers, and raw blocks (none hot in
the corpus). Perf gate green, `AOT ≤ VM ≤ interpreter ≤ handlebars`: big-table VM ≈ 1.3× the
interpreter, teams ≈ 1.9× (was 0.9× before specialization).

**Declined (assessed, not built): borrowing loop elements.** `set_iter` clones the current
element into `env.this` each iteration; the old subset VM borrowed `&items[i]` instead. Eliding
the clone would need either lifetime-threading the shared `Env` (invasive — every `eval_*`
reads `env.this`) or a fragile dirty-flag / lazy-sync scheme (byte-divergence risk). And it
buys almost nothing on the actual workloads: big-table's elements are `Value::Num` (a Copy enum
— the "clone" is free), teams' are `Value::Object` (one `Rc` bump ×4). big-table's real cost is
`core::fmt` integer formatting + loop dispatch, which this does not touch. Per the rule above
— promote only when the benchmark demands it — it stays unbuilt while the gate is green.

[`Value`]: ../crates/trussbars-interp/src/lib.rs

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

> **Superseded (2026-06-10) — the AOT-compat (strict) render mode below was removed.**
> See the roadmap, *"Strict-native cutover — legacy `{{#…}}` + the AOT-compat layer
> removed."* Rationale: the AOT backend's subset is enforced by **compilation itself** —
> an incompatible MaxBars template fails to build under AOT with a located error — so a
> separate runtime *verifying proxy* (`render_compat`) plus the cross-language drift gate
> that kept it honest were dead weight. **The VM is now lenient-only** (mode 1); modes 2
> (schema-checked, `docs/03`) and 3 (AOT-compat) are no longer VM render modes. The
> design rationale below is kept as the historical record of why the proxy once existed.

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
     no `TruthyIn<NonEmpty>` for numbers; `docs/01`);
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

**Done** (`trussbars-interp`): `Helpers` is exactly that registry — `register(name, |args:
&[Value]| -> Result<Value>)` — passed to `Template::render_with`. An unknown helper
head resolves against it; in AOT-compat mode host helpers are **rejected** (AOT
registers none), keeping the verifying-proxy guarantee. The i18n/locale pack on top is
then just a set of host helpers (a follow-up that needs no engine change).

## 9. Conformance — the third axis

The project's safety net extends cleanly. Today: **interpreter (oracle) ≡ AOT**
(71/71, `docs/04`). Add **VM ≡ oracle**, reusing the *same corpus and harness shape*:
render each case through the VM, assert byte-equality against the committed golden —
exactly as `harness.mjs` does for AOT (a `--interp` flag beside `--v2`). Then **VM ≡ AOT**
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
          ║ 71/71 (done)            ║ NEW: --interp gate, same corpus + the dynamic-only cases
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

**Shipped precursor — `examples/lab`.** A [ratatui](https://ratatui.rs) **terminal**
mini-Lab already exercises this exact surface minus the browser: it **live-edits** a
template and its (JSON) data and re-renders through `trussbars-interp` on each keystroke,
switches locale via i18n **host helpers** (`t`/`number`/`plural`/`date`/`relative`, §8 —
the language drives a localized month name too). (It once toggled `render_compat` to show
an AOT-parity verdict; that mode was removed with the AOT-compat layer — see §7's
superseded banner — so the TUI is now lenient-render only.) It is the runnable VM
northstar today, and the state model (`Lab` + a
pure `render()` core + `ui()`, golden- and `TestBackend`-tested) ports directly to the
WASM Studio panel — there, `ratatui`'s draw is swapped for the browser DOM but the core
is unchanged.

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
