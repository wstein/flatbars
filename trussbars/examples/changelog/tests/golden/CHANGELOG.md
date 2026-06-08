# Trussbars — Changelog
## docs
- corrected roadmap — strike profiling, reframe &quot;new surface&quot; (step 5) _(trussbars)_ `311dac1` · 2026-06-08
- v2 diagnostic span-mapping spike (step 4) _(trussbars)_ `acab8b2` · 2026-06-08
- v1 feature freeze — the surface v2 targets (step 3) _(trussbars)_ `91fe529` · 2026-06-08
- codegen profiling pass — at the safe-Rust ceiling _(trussbars)_ `b1bbe20` · 2026-06-08
- refresh benchmark medians (Trussbars 1.26→0.92µs) _(trussbars)_ `deaa95c` · 2026-06-08
## feat
- bounded no_std + alloc split (step 2) _(trussbars-core)_ `a7e55c2` · 2026-06-08
- blog-engine dogfood example + feature-gap catalog (step 1) _(trussbars)_ `2516b4c` · 2026-06-08
- adopt .truss as the MaxBars/Trussbars extension _(editors,trussbars)_ `d33f38c` · 2026-06-08
- raw blocks ({{{{#raw}}}}) emit their verbatim body _(trussbars)_ `224e65e` · 2026-06-08
- emit groupBy → a map, iterated via Each _(trussbars)_ `348fc71` · 2026-06-08
- map iteration — {{#each obj}} over a BTreeMap via an Each trait _(trussbars)_ `c72f224` · 2026-06-08
- emit sortBy with a stable trussbars-std::sort_by _(trussbars)_ `17b056e` · 2026-06-08
- emit block partials {{#partial}} + {{yield}} _(trussbars)_ `f072360` · 2026-06-08
- emit outer labelled loops and pluck _(trussbars)_ `073e93d` · 2026-06-08
- emit inline partials ({{#inline}} + {{&gt; name}}) _(trussbars)_ `59812d1` · 2026-06-08
- emit parent / parent.parent context chains _(trussbars)_ `0101435` · 2026-06-08
## perf
- close the Sailfish gap on big-table (49.9→37.3µs) _(trussbars)_ `f7e2f2d` · 2026-06-08
- richer String::with_capacity estimate (per-output + per-loop) _(trussbars)_ `496931e` · 2026-06-08
- seed String::with_capacity from the literal-byte sum _(trussbars)_ `485e4dd` · 2026-06-08
## test
- rebuild benchmark on the canonical template-benchmarks-rs suite _(trussbars)_ `adf6848` · 2026-06-08
