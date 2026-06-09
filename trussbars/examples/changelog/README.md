# changelog-example — a self-hosted Trussbars dogfood

Renders **this repo's own conventional commits** (a committed `git log` snapshot,
`data/git-log.txt`) into a markdown changelog through a Trussbars-compiled
`.truss` template. Second dogfood, deliberately a *different shape* from the blog:
machine-generated aggregation data, not authored prose — so it stresses grouping,
sorting, dates, and categorisation.

The template is compiled at build time by the native v2 `truss!` proc-macro,
loaded straight from `templates/changelog.truss` (`path = …`) — no PureScript
transpiler, no committed generated module.

```sh
cargo +1.96.0 run                     # print CHANGELOG.md to stdout
cargo +1.96.0 test                    # golden gate (tests/golden/CHANGELOG.md)
BLESS=1 cargo +1.96.0 test            # re-bless after an intended change
# refresh the data snapshot from live git:
git log --format='%H|%aI|%s' -n 60 -- trussbars/ packages/maxbars/src/MaxBars/Rust.purs \
  | grep -E '\|(feat|fix|docs|perf|test)(\(|:)' | head -20 > data/git-log.txt
```

## The shape of the finding: a *thin template* over a *fat host precompute*

The template (`templates/changelog.truss`) is tiny — group by category, list
entries. **All the work is in `src/lib.rs::parse_commit`**, because the template
can express none of it:

| The host had to precompute… | …because the template can't | → v2 host-helper |
| --- | --- | --- |
| **category** (`feat`) and **scope** (`trussbars-core`) from `feat(trussbars-core): …` | no in-template split/match on a prefix; and a `startsWith` can't head a condition (F7) | a `split` / pattern helper, or a typed `commit.category` projection |
| **short hash** (`a7e55c2` from the 40-char SHA) | `slice 0 7` *works* in output position, but the host already had the string | minor — `slice` covers it |
| ~~**date** `2026-06-08` from the ISO timestamp~~ — **now in the template** | — | **DONE (F3)** — the context carries the raw ISO timestamp; the template formats it with `{{date c.date "%Y-%m-%d"}}` (`trussbars_i18n::date`, declared via `helpers = [date]`). |

That table **is** the F3 requirements list (docs/06 §4): the v2 host-helper
convention should let a host register `date`, a categoriser, etc. as typed,
name-static helpers, so the template — not a pile of Rust — does the shaping.

## New findings (beyond the blog)

- **F7 — piped/applied condition (now in the freeze).** A changelog naturally wants
  `{{#if subject | startsWith "feat"}}`; it's rejected ("options argument"). Bare
  `{{#if startsWith subject "feat"}}` fails too. **Workaround:** parenthesise —
  `{{#if (startsWith subject "feat")}}`. We sidestepped it by precomputing
  `category`, which is itself the point: the gap pushed logic out of the template.
- **F8 — escaping is HTML-only.** The default `{{ }}` HTML-escapes, so a commit
  subject like `"new surface"` renders as `&quot;new surface&quot;` and `{{> name}}`
  as `{{&gt; name}}`. This is **correct** when the `.md` is later HTML-rendered
  (GitHub: the entities display as `"` / `>`), but shows literally in a plain-text
  view. Trussbars has **no per-output-target escaping policy** — fine for HTML, a
  consideration for markdown/JSON/CSV targets. (We kept the safe default rather than
  raw `{{{ }}}`, which would risk XSS if the markdown is HTML-rendered.)
- **G1 — `groupBy` key order is ascending-string.** Sections come out `docs, feat,
  perf, test`; a changelog usually wants *Features* first. There's no custom group
  order — a host would precompute an ordered key (`"1-feat"`) or post-sort. Worth a
  v2 note, not a freeze blocker.

## What worked (no friction)

Two-level grouping (`{{#each (groupBy commits "category")}}` → `{{#each this}}`) —
the blog only did one level; `{{#if c.scope}}` on a non-empty `String`; `loop.key`
as the section header; `slice` for the short hash. Output is byte-pinned in
`tests/golden/CHANGELOG.md`. No correctness gaps.
