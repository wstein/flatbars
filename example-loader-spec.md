# Playground Example Loader — Specification (Handlebars + Mustache)

Status: draft for review · Companions: `minbars-spec.md`, `rawbars-maxbars-spec.md`, `helper-packs-spec.md`, `loopvars-linter-spec.md`

Lets Playground Lab load **official examples** — Handlebars from handlebarsjs.com, Mustache from the `mustache/spec` suite — render them in the right BareBars dialect, and show **expected-vs-actual** side by side. Examples are **vendored** (copied into the repo at a pinned upstream commit), never fetched at runtime. A **TUI** drives the download/update of that vendored corpus.

Two facts from the source review shape the whole design:

- **Both sources are MIT-licensed** (handlebarsjs.com © Yehuda Katz; `mustache/spec` MIT), so vendoring-with-attribution is clean.
- **The two sources have different trust semantics.** Handlebars `/examples/` are prose markdown with *no* baked output, rendered client-side (unscrapable live, CORS-blocked) — so expected output must be *computed* by real Handlebars at vendor time, and a divergence from FullBars is an **expected difference**. `mustache/spec` is YAML where `expected` is *authoritative* — no computation needed, and a divergence from MinBars is a **conformance failure**. The loader carries that distinction explicitly.

---

## 1. Goals & non-goals

**Goals.** One vendored corpus across both engines; one-click load into the playground with auto-selected dialect; an honest, labelled expected-vs-actual diff; a great-UX TUI to download/update/verify the corpus; the same corpus doubling as a conformance suite (FullBars against Handlebars behaviour, MinBars against the spec).

**Non-goals.** No runtime fetching; no arbitrary-URL loader (SSRF/trust); no scraping of rendered HTML; no `/guide/` prose-snippet ingestion in v1 (structured `/examples/` and spec YAML only); no lambda examples (`~lambdas` excluded — unrepresentable in `Value`).

---

## 2. Sources & licensing

| provider | upstream | format | expected output | divergence means | target dialect | license |
|---|---|---|---|---|---|---|
| `handlebars` | handlebarsjs.com markdown source (VitePress) | prose examples (template + context) | **computed** by real Handlebars at vendor time (Node dev dep; never in the lab bundle — §9) | **expected-difference** | FullBars | MIT © Yehuda Katz |
| `mustache` | `github.com/mustache/spec` (`specs/*.json`; `.yml` also shipped) | `template` + `data` + `expected` (+ `partials`) | **authoritative** (in file) | **conformance-failure** | MinBars | MIT |

Every vendored fixture retains the upstream URL, the pinned commit SHA, the license id, and the attribution string. The TUI refuses to vendor a provider whose license/attribution fields are unset.

> Action item: the exact handlebarsjs.com markdown source repo/path was not pinned during review (confirmed VitePress + MIT; repo path TBD). The `mustache/spec` path is known (`specs/*.json`, with `.yml` alongside — the loader vendors the `.json`).

---

## 3. Provider model

A provider is a module behind one interface; the TUI and the vendor pipeline are provider-agnostic.

```purescript
data Dialect           = FullBars | MinBars
data DivergenceMeaning = ExpectedDifference   -- Handlebars: deliberate FullBars divergence
                       | ConformanceFailure   -- Mustache: a MinBars bug / unimplemented module

type Provider =
  { id          :: String
  , source      :: GitSource             -- { repo, commit, subpath }
  , license     :: License               -- { spdx, holder, noticeText }
  , dialect     :: Dialect
  , divergence  :: DivergenceMeaning
  , discover    :: GitSource -> Aff (Array RawExample)        -- list upstream
  , parse       :: RawExample -> Either ParseError Example    -- template/data/partials
  , expected    :: Example -> Aff Expected                    -- compute (HB) | read (Mustache)
  , features    :: Example -> Array Feature                   -- features used (for gap-flagging)
  }
```

`expected` is the only place the two providers diverge in code: the Handlebars provider shells to a pinned real-Handlebars at vendor time (a Node dev dependency, never imported by the lab bundle — see §9); the Mustache provider reads the `expected` field straight from the vendored fixture. Everything downstream (fixture format, TUI, diff, playground load) is shared.

---

## 4. Vendored fixture format

One file per example, committed under `reference/web/examples/vendored/<provider>/<category>/<name>.json` (under the FlatBars Lab's served root, so the cli gate and the Lab read one copy):

```jsonc
{
  "id": "handlebars/partials/inline",
  "provider": "handlebars",
  "dialect": "fullbars",
  "divergenceMeaning": "expected-difference",
  "template": "{{#> layout }}{{#*inline \"body\"}}…{{/inline}}{{/layout}}",
  "data": { "...": "..." },
  "partials": { "layout": "…" },
  "expected": "<h1>…</h1>\n",
  "bakedWith": "handlebars@4.7.8",              // handlebars only: the oracle version that *defines* `expected` (§5, §9)
  "features": ["partial-block", "inline-partial"],
  "support": "ok",                              // ok | uses-unsupported-feature | parse-error
  "unsupported": [],                            // both {{#> }} and {{#*inline}} are supported now (§7); [] for an example with a gap, list the features
  "source": { "url": "https://handlebarsjs.com/examples/partials/inline.html",
              "repo": "…", "commit": "a1b2c3d" },
  "license": { "spdx": "MIT", "holder": "Yehuda Katz", "notice": "…" }
}
```

The corpus is plain files in the repo — diffable in code review, offline, deterministic. No DB.

---

## 5. Vendor / sync pipeline

For each selected example at a pinned commit:

1. **discover** upstream entries → **parse** template/data/partials.
2. **expected**: Handlebars → run the pinned real-Handlebars (a vendor-time Node dev dep; record its version in `bakedWith`) to compute output; Mustache → read `expected` from the vendored `.json` fixture (no YAML parser on this path — §6.5).
3. **features** → compare against the target dialect's supported-feature set; tag `support` and `unsupported` (§7).
4. Write the fixture; record source URL + commit + license.

The pipeline is **deterministic**: the same upstream commit **and** the same pinned Handlebars version (`bakedWith`) ⇒ byte-identical fixtures. Re-running is the only "refresh"; there is no runtime fetch.

---

## 6. The TUI download/update tool

A full-screen terminal app (invoked `barebars examples`) — not a prompt script. UX is the point: browse, multi-select, see status and diffs, vendor, verify.

### 6.1 Layout

```
┌ BareBars Examples ───────────────────────────── handlebars @ a1b2c3d (pinned) ┐
│ Provider: ● handlebars   ○ mustache              upstream: a1b2c3d (in sync)   │
├───────────────────────────────┬───────────────────────────────────────────────┤
│ ▸ /partials                   │  partials/inline                  [FullBars]    │
│     ✓ basic                   │  ⚠ uses {{#*inline}}, {{> @partial-block}}      │
│   ↑ inline            ◄ here   │     inline-partial not supported by FullBars    │
│     + dynamic                 │ ── template ───────────────────────────────────│
│ ▸ /builtin-helpers            │  {{#> layout}}{{#*inline "body"}}…              │
│     ✓ if                      │ ── data ───────────────────────────────────────│
│     ✓ each                    │  { "title": "…" }                               │
│     − with        (upstream   │ ── expected (Handlebars) ──────────────────────│
│                    removed)   │  <h1>…</h1>                                     │
│ ▸ /block-helpers              │ ── actual (FullBars) ───────────── diff ───────│
│                               │  − <section>…   + (empty)                       │
│ 12 ✓  3 ↑  2 +  1 −  4 ⚠      │  cause: inline-partial unsupported (not a bug)  │
├───────────────────────────────┴───────────────────────────────────────────────┤
│ [space] select  [/] filter  [enter] diff  [u] update  [v] vendor  [V] verify   │
│ [tab] provider  [p] re-pin commit  [a] attribution  [?] help  [q] quit         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

> The `⚠`/`inline` rows above are **illustrative of the glyph**, not current truth: `partials/inline` now renders under FullBars (§7), so it would show `✓`. The `⚠` state applies to whatever example genuinely hits a dialect gap.

### 6.2 Status glyphs (left tree)

| glyph | meaning |
|---|---|
| `✓` | vendored and current with the pinned commit |
| `↑` | upstream changed since vendored — update available |
| `+` | new upstream example, not yet vendored |
| `−` | vendored example removed upstream |
| `⚠` | renders, but uses a feature the target dialect doesn't support (§7) |
| `✗` | parse or expected-bake error |

The footer summary (`12 ✓ 3 ↑ …`) is the at-a-glance corpus health.

### 6.3 Detail / diff pane (right)

Shows the selected example's template, data, partials, expected, and — when the engine is wired (Phase E2) — a live **actual** render with a colored diff. The diff header always states the **cause** and whether it's an *expected difference* (Handlebars) or a *conformance failure* (Mustache); a Mustache `✗`/diff is a red defect, a Handlebars diff is a neutral "divergence" note.

### 6.4 Keybindings

`j/k`,`↑/↓` move · `space` toggle select · `/` incremental filter · `enter` open diff · `u` update selected · `U` update all `↑` · `v` vendor selected `+` · `V` verify (re-render, assert) · `tab` switch provider · `p` re-pin to a chosen commit · `a` show license/attribution · `?` help overlay · `q` quit. Vim-style throughout; help overlay lists everything.

### 6.5 Headless mode (CI — mandatory)

A TUI without a scriptable path is useless in CI, so every action has a flag form:

```
barebars examples sync   --provider mustache --commit <sha>   # vendor a pinned set
barebars examples check  --all                                # exit≠0 if upstream drifted
barebars examples verify --all                                # re-render; assert per provider
barebars examples vendor --select "partials/*" --provider handlebars
```

`verify` is the conformance gate: for `mustache`, assert `actual == expected` (a failure is a MinBars bug or unimplemented module); for `handlebars`, assert the diff set equals the **recorded divergence catalogue** (a *new* divergence is the alarm, an expected one is fine). CI runs `check` (drift) + `verify` (correctness).

**Format on this path.** The headless `verify`/`check` path consumes the vendored `.json` fixtures only — no YAML parser in CI (the locked MinBars decision: `mustache/spec` ships every module as both `.yml` and `.json`, so `JSON.parse` suffices). YAML is used only for the in-lab preview, where `js-yaml` is already vendored (`reference/web/vendor/js-yaml.mjs`).

**Relationship to the existing gates.** This is *not* `packages/compile/conformance.mjs` (which asserts interpreter ≡ compiled — an internal axis, 102/102). `verify` asserts engine ≡ upstream oracle (an external axis). It also **is** the MinBars conformance suite — it supersedes the separate Node harness sketched in `minbars-spec.md`; there is exactly one `mustache/spec` gate, this one.

### 6.6 Tech

Recommended: **Ink** (React-for-CLI) in the `cli` package, importing the compiled BareBars engine for live preview/diff and the provider modules for discover/parse/bake. Ink gives flexbox panes, lists, spinners, and incremental filter cheaply. The tool is an effectful Node dev-utility, so it lives outside the pure core — acceptable. (Alternative: neo-blessed; decision in §10.)

---

## 7. Feature coverage & the FullBars gap

`features` tags each example; the pipeline flags any feature outside the target dialect's supported set.

- **MinBars vs `mustache/spec`:** modules map directly — `~lambdas` excluded; `~dynamic-names` and `~inheritance` are supported (per `minbars-spec.md`), so only un-implemented phases show `⚠`/`✗`.
- **FullBars vs Handlebars `/examples/`:** the completeness patch (`rawbars-maxbars-spec.md` §5) covered `@../`, `@root`, recursive partials; the partial gap has since closed **entirely** (commit `a5be67d`): `{{#> name}}…{{/name}}`, `{{> @partial-block}}`, **and** the inline-definition decorator `{{#*inline "name"}}…{{/inline}}` all parse and desugar. `Parser.blockCloseName` resolves the `{{/…}}` close-name mismatch (the partial name for `{{#>}}`, `inline` for `{{#*inline}}`) onto the `{{#partial}}`/`{{#inline}}` core spellings — see the FullBars tests `block-partial-gt-yield` and `inline-decorator-sigil`, and `fullbars-compat.adoc`. So the cited `partials/inline` example now renders fully (`support: "ok"`). The `support`/`unsupported` machinery (§4) stays — it is the live coverage report for *whatever* feature a future example hits — but there is **no FullBars partial gap today**. Open #1 is resolved (§11.1).

The corpus thus becomes a live feature-coverage report for FullBars, not just a demo.

---

## 8. Playground integration

Loading a fixture: auto-select its `dialect`, populate template/data/partials, render, and show expected-vs-actual. A "see in other dialects" control runs the migrate linter (`loopvars-linter-spec.md`) to show the same input across FullBars/MinBars/MaxBars. The diff's framing follows `divergenceMeaning` — neutral "divergence (by design)" for Handlebars, red "conformance failure" for Mustache. Unsupported-feature examples load read-only with the gap explained, never a silent wrong render.

The vendored corpus (`reference/web/examples/vendored/`) is the *conformance/coverage* set and **coexists** with the curated demo examples the lab already ships (`reference/web/examples/stem/examples.json`); they are separate catalogues — vendored fixtures are not auto-merged into the demo dropdown. (If the two are ever unified, that is its own migration, not part of this loader.)

---

## 9. Security & determinism

- **Vendored-only.** No runtime fetch, no arbitrary-URL field. The corpus is reviewed files at a pinned commit.
- **Sandbox unchanged.** Templates execute in the playground's existing no-`eval` sandbox; example execution adds nothing the playground didn't already do with user input.
- **Deterministic baking.** Expected output is computed once at a pinned upstream commit **and** a pinned Handlebars version — recorded in `bakedWith`, since the oracle version *defines* "expected" — for Handlebars, or read verbatim for Mustache; `verify` re-checks determinism.
- **No new shipped dependency.** Real Handlebars is a *vendor-time* Node dev dep used only to bake `expected`; it is never imported by the lab bundle (`reference/web`). The native Handlebars lab engine was removed in commit `2304aad`, and this loader does not bring it back at runtime — only at vendor time, in an isolated Node script.
- **License hygiene.** Attribution + SPDX + notice are mandatory fixture fields; the TUI blocks vendoring without them.

---

## 10. Implementation plan

> **Sequencing.** E0–E2 plus the headless `verify`/`check` flags (§6.5) deliver the MinBars conformance value with **no** Handlebars dependency and **no** TUI. E3 (Handlebars provider) is gated on Open #3 (source repo); E4 (TUI) on Open #2 (library). Neither blocks the MinBars path — ship MinBars-first.

### Pipeline & corpus
- **E0 — Provider interface + fixture format.** The fixture format (§4) is **landed**: `reference/web/examples/vendored/mustache/<module>/<name>.json`. The typed `Provider` record (§3) is not yet extracted — the `mustache` path is implemented directly (vendor script + a CLI verifier), and the typed interface arrives with the second (`handlebars`) provider.
- **E1 — Vendor pipeline + `mustache` corpus.** **Landed.** `scripts/vendor-mustache.mjs` vendors the core modules (comments, interpolation, sections, inverted, partials — 122 fixtures) at a pinned commit; `barebars examples verify` is the headless strict gate (`npm run examples:verify`, wired into `npm test`) — renders each fixture through MinBars and asserts `actual == expected` (122/122 conform). *Reconcile:* `packages/minbars/test/spec-conformance.mjs` (`npm run test:minbars-spec`) is a parallel **lenient measurement** over a **second** vendored corpus (`packages/minbars/test/spec/`); per §6.5 this `verify` gate is meant to supersede it — consolidating to one corpus is the open follow-up.
- **E2 — Playground load + diff.** *Shipped (deep-link); a richer diff panel + a browser UX pass remain.* The corpus is single-sourced under the Lab's served root (`reference/web/examples/vendored/`); the vendor script emits a browse `manifest.json`; `reference/web/playground_utils.mjs` carries the tested helpers `vendoredWorkspace` (fixture → `{ engine, template, dataText, partials, expected, divergenceMeaning }`) and `vendoredVerdict` (actual-vs-expected, severity by `divergenceMeaning`). `index.html` implements the `?vendored=<id>` deep-link (`loadVendored`/`loadVendoredById`): it auto-selects the dialect engine (re-navigating with `?engine=` if needed), loads the workspace, renders, and frames the verdict in the example label (`✓ conforms` / `✗ <divergence>`). Gated on the param (no regression to the existing Lab). A **browse picker** is also shipped: the example menu lists the vendored corpus (from `manifest.json`, helpers `vendoredMenuItems`/`vendoredHref`), each entry deep-linking to its fixture. Verified at the logic level (the MinBars adapter render path conforms 122/122 fed by `vendoredWorkspace`; the module parses; all four helpers are unit-tested in `npm test` via `test:lab`). *Remaining (enhancements):* a side-by-side expected/actual diff panel (the label carries only the verdict today) and a browser smoke-test of the render/UX.

### Handlebars provider
- **E3 — `handlebars` provider + expected-baking.** *(Blocked on Open #3 — source repo.)* Locate the markdown source repo (§2 action item); parse examples; compute expected via pinned real-Handlebars (isolated vendor-time Node dev dep, version in `bakedWith`); feature-tag against FullBars; record the divergence catalogue. Does **not** block the MinBars value above.

### TUI
- **E4 — TUI shell.** *(Blocked on Open #2 — TUI library; the headless flags in §6.5 are the must-have and ship in E1.)* Ink app: provider switch, tree with status glyphs, filter, detail/diff pane, vendor/update/verify actions, attribution view, help overlay; headless flags wired to the same actions. Note the toolchain cost: Ink is React/JSX/Node, while the `cli` package is PureScript (`Cli.Main.purs`, spago) — settle Open #2 before committing to it.
- **E5 — Coverage report.** The `⚠`/`✗` feature-coverage summary as both a TUI footer and a CI artifact; "see in other dialects" via the migrate linter.

---

## 11. Open decisions

1. **FullBars partial sigils** (§7) — **Resolved (commit `a5be67d`).** `{{#> }}`, `{{> @partial-block}}`, **and** `{{#*inline}}` all parse and desugar; `Parser.blockCloseName` resolves the close-name mismatch and the surface maps the sigils onto the `{{#partial}}`/`{{#inline}}` core spellings (tests `block-partial-gt-yield`, `inline-decorator-sigil`). No FullBars partial gap remains; `partials/inline` loads as `ok`.
2. **TUI library** (§6.6) — Ink (recommended) vs neo-blessed vs a minimal ANSI renderer.
3. **handlebarsjs.com source repo** (§2) — locate and pin the exact markdown repo/path.
4. **Handlebars expected-baking dependency** — pin which real-Handlebars version computes expected output (it defines "expected"); bump policy.
5. **Divergence catalogue churn** — **Resolved: hard-fail.** A new Handlebars divergence at `verify` fails CI; the catalogue is a reviewed file in the repo, so recording/accepting a divergence is a deliberate diff in code review, never a silent warning.
