# The Engine seam — FROZEN contract (Phase 2)

Every engine provider's `create(dialect, opts)` returns an object of this exact
shape (the ADR-0020 seam). It is **frozen**: trussbars-wasm (Phase 4) targets this
contract, and the differential view (Phase 7) assumes both providers expose it.

```text
Engine = {
  // render / compile
  render(program, data, opts?): string,           // (or { ok, output, segments } for the mapped path)
  compile(source, partials, opts?): { program, errors? },
  compileToJs(source, partials?, opts?): { ok, value | error },
  parseAst(source, opts?): { ast: { nodes } | null, ... },
  inspectAt(program, data, target, opts?): snapshots,   // ADR-035 context inspector

  // static analyses (EXACT, from the lowered AST)
  usedTransformers(program): string[],
  requiredAssigns(program): string[],
  partialGraph(program): graph,

  // tooling
  analyze(input, data): { ok, findings },          // ADR-022 truthiness portability
  analyzeWith(predicate, input, data): { ok, findings },  // ADR-030 path schema
  lint(source, dialect?): { ok, findings },        // ADR-019 canonicalization
  migrate(source): { ok, source, residuals } | { ok: false, error },

  // catalog + capability advertisement
  allTransformers(): string[],
  catalog(): CatalogEntry[],
  engineInfo(): { version, builtins, features },   // engine-features/v1 vector
  version: string,
}
```

## Rules

- **Shape is frozen.** A provider must return every member above. trussbars-wasm
  implements the same signatures (render-only members may return early / be
  feature-gated off — see below).
- **Capabilities are honest.** A provider advertises a possibly-SMALLER
  `engineInfo().features` vector. The Lab's capability gate (`hasFeature` /
  `tabVisibleUnder`) hides any panel whose `requires` feature is absent — so a
  thinner engine (e.g. a v1 trussbars-wasm without `source-map`/`context-inspect`)
  never lies about what it backs; those panels simply don't show.
- **Per-transport default provider** (Phase 5): hosted defaults to `oracle`
  (the spec reference); the local `trussbars lab` transport will default to
  `trussbars` (ships-what-you-run). Either is loadable on either surface for the
  differential.
- **Adding a provider** is `registerProvider({ id, label, kind, create })` — no
  loader or call-site change. The example/file loading goes through the
  FileProvider seam (`app/file-provider.mjs`); the engine goes through here.
