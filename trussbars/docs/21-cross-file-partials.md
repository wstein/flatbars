# Trussbars — Cross-file partials (#4)

> **Status:** **Implemented.** **Decisions:** error location = **precise per-source** (§4; the
> registry carries each partial's source, errors locate within the partial and carry a
> `(in partial 'name')` tag); duplicate name (inline×file or twice in the map) = **compile
> error**; cross-file **layouts + nesting in scope**. **Built in:** `trussbars-template`
> (`PartialDef` registry + `emit_with_partials` + per-source `inline_partial`),
> `trussbars-macros` (`partials = […]` clause parse + per-file read & dep-track). Gate: v2
> conformance **87/87, 0 drift** (in-source partials unchanged); cross-file behaviour covered by
> `trussbars-macros` render tests + `trussbars-template` emit-layer error tests.
> **Audience:** the `truss!` proc-macro (`trussbars-macros`) and the v2 emitter
> (`trussbars-template`). **Resolves:** the "every `truss!` is a closed island" limitation
> (review #4) — no way to factor a shared header/footer/layout across files. **Companion:**
> `docs/01` §6 (partials, "static names only"), `docs/09` (the `helpers = […]` clause this
> mirrors), `docs/07` (diagnostics / span mapping).

## 1. The gap

Today the macro reads exactly one template (an inline string or one `path = "…"` file), and
`{{> name}}` resolves only against the registry hoisted from `{{#inline "name"}}` definitions
**within that same source** (`emit::inline_partial` → `env.partials`). There is no way to load
another file as a partial, so a layout/header/footer cannot be shared across templates — every
`truss!` is a closed island. Askama (`{% include %}`) and Handlebars (registered partials)
both allow this; it is the most-requested structural limitation.

## 2. Surface (decided: explicit map)

A static `name → file` map in the `truss!` call, mirroring `helpers = […]` and sitting
alongside it / `truthiness =` in any order:

```rust
truss!(
    page, Ctx,
    "{{> header}}<main>{{body}}</main>{{> footer}}",
    partials = [header = "partials/header.truss", footer = "partials/footer.truss"]
);
```

- Each path is read at macro-expansion time relative to `CARGO_MANIFEST_DIR` (exactly like
  `path = "…"`), and gets an `include_bytes!` so cargo re-triggers the build when a partial
  file changes (same dep-tracking as the main `path` form).
- **Names stay static** (§1 of the spec): the partial a `{{> name}}` reaches is fixed in the
  template text, never computed from data — this is `helpers = […]` for partials, not a
  directory scan. (A directory convention was considered and rejected: implicit discovery is
  the kind of "data/filesystem chooses code" ambiguity Trussbars avoids.)
- A referenced-but-undeclared `{{> name}}` stays the existing located `unknown partial 'name'`
  error; a declared-but-unreadable file is a located macro error naming the path.

## 3. How it threads through emit (the mechanism)

The registry is already `name → Vec<Node>` and `inline_partial` already inlines a partial's
body at the call site, type-checked against the **caller's** context — so a file partial is
*context-polymorphic* for free (no new type machinery; it reuses the inline path). Two changes:

1. **The macro** reads each declared file, and passes the `(name, source)` pairs to the
   emitter (a new `emit_named`-level argument, or a small options struct).
2. **The emitter** parses each partial source into nodes, hoists its `{{#inline}}` defs, and
   merges `name → body` into the registry **before** walking the main tree. A `{{> name}}` /
   `{{#partial "name"}}` then resolves to it via the unchanged `inline_partial`.

This composes for free with the existing features:

- **Context passing** — `{{> header}}` (inherits `this`) and `{{> header sub}}` (re-root) both
  already work in `inline_partial`; file partials reuse them.
- **Layouts** — a file partial containing `{{yield}}`, invoked as
  `{{#partial "layout"}}…{{/partial}}`, works through `inline_partial`'s `yield_code`. So
  cross-file *layouts* come for free.
- **Nesting & recursion** — a file partial's body may reference any registered partial
  (`{{> other}}`); a cycle across files is caught by the existing `env.expanding` guard
  (`recursive partial 'name'`).

**Conformance:** this is a v2-emitter / macro feature — the PureScript oracle path has no
`partials = […]` surface, and the conformance corpus renders single templates, so there is no
byte-identity impact. It is gated by new `trussbars-macros` render/`trybuild` tests over
fixture files (§6).

## 4. The real design gate — error location across files

`emit::emit_node` locates a leaf error as `located(n.span().start, src, msg)` → `"L:C: msg"`,
where `src` is the source passed to `emit_nodes`. A file partial's node spans are offsets into
**its own** file, but `inline_partial` originally passed the **main** `src`, so a
partial-internal error (`unknown helper`, `unsupported`, a parse error) would compute `L:C`
against the wrong source. Because `src` is a *parameter*, not part of `Env`, this was fixable
without a `Span` refactor.

**Chosen: precise per-source spans.** Each registry entry (`PartialDef`) carries an `Rc<str>`
source and an `origin` (None for an in-source `{{#inline}}`, `Some(name)` for an imported file).
`inline_partial` emits the body against the **partial's** source, so `L:C` is correct *within
the partial file*; the already-located message is then tagged once with `(in partial 'name')`
(a deeper partial's tag is preserved). The message stays in numeric `L:C: …` form, so
`is_located` keeps working unchanged and a parent never re-wraps. (The alternative — locating a
partial error at the `{{> name}}` *use site* in the main template — was rejected: zero refactor,
but it points at the use, not the offending line in the partial.)

## 5. Decisions (resolved)

1. **Error location:** precise per-source (§4).
2. **Duplicate-name policy:** a **compile error** — a name defined as both an in-source
   `{{#inline}}` and a `partials = […]` file (or twice in the map) is rejected by
   `emit::insert_partial` (`duplicate partial 'name'`). Names are static; an ambiguous binding
   is a bug, not a precedence puzzle.
3. The `partials = [name = "file"]` surface (§2) is confirmed, and cross-file **layouts**
   (`{{yield}}`) and **nesting** are in scope (they fall out of the inline mechanism for free).

## 6. Tests (built)

- `trussbars-macros` render test (`cross_file_partials_compose`) over committed fixtures
  (`tests/templates/{header,footer,row,layout}.truss`): a shared header/footer + a sub-context
  partial (`{{> row this}}`) composed into a page, and a cross-file `{{yield}}` layout.
- `trussbars-template` emit-layer tests: a file partial inlines at the call site; a duplicate
  name is rejected; a **parse** error and an **emit** error *inside* a partial each locate
  within that partial's source and carry the `(in partial 'name')` tag.
- The existing `unknown partial` `trybuild` golden and the `recursive partial` guard cover the
  remaining error paths. (Error cases are unit-tested at the emit layer rather than via
  `trybuild`, since `trybuild`'s `CARGO_MANIFEST_DIR` points at its temp crate, so file-path
  cases would not resolve there.)
