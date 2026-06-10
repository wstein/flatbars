# Mustache Set Delimiters — Specification & Implementation Plan

Status: **implemented** (all four phases shipped; MinBars 14/14 on the mustache/spec `delimiters` module) · Companions: ADR-015 (set delimiters), ADR-007 (MinBars), ADR-001 (one structural lexer), ADR-014 (highlighting from the lexer) · Scope: **MinBars** (on by default) + **opt-in** for **RawBars / MaxBars** (ClassicBars excluded — Handlebars has no set delimiters)

---

## 1. Summary

Mustache lets a template change its own tag delimiters mid-stream:

```
{{=<% %>=}}
Now tags look like <% name %>.
<%={{ }}=%>
...and {{name}} again.
```

This is the last unimplemented **core** `mustache/spec` module. ADR-007 deferred it; ADR-015 lifts the deferral via a **flag-gated mode of the one core lexer** (`LexOptions { mustacheDelims }`), so the meaning-free core and the Handlebars-family ladder stay byte-identical when the flag is off, and there is no second lexer (ADR-014).

**Baseline (today, shipped engine `lab/vendor/flatbars-engine.mjs`): MinBars passes `0/14`** of the `delimiters` module — staged at `packages/minbars/test/spec-pending/delimiters.json` (vendored verbatim from the pinned commit `e8ec001…`; kept out of the gated corpora so `npm test` stays green until implementation).

## 2. The feature (normative behaviour)

- A **set-delimiter tag** has the form `<open>=<new-open> <new-close>=<close>`, e.g. `{{=<% %>=}}`. It changes the active pair for **all following content** in the current template, and **renders nothing**.
- The new open/close are whitespace-separated, may be multi-character, and may be exotic (`{{=<% %>=}}`, `{{=(( ))=}}`, `{{=| |=}}`). The standard pair can be restored with `<%={{ }}=%>`.
- **Custom delimiters may not contain whitespace or `=`** (per the Mustache manual). An invalid pair is a parse error. This rule also makes a space-separated directive/CLI/config value unambiguous to split.
- **Sigils still apply** inside custom delimiters: `<%#section%>`, `<%/section%>`, `<%^inv%>`, `<%&unescaped%>`, `<%! comment %>`, `<%> partial %>`, `<%= … =%>`.
- A set-delimiter tag is **standalone** (alone-on-a-line ⇒ the line is stripped), like comments and section tags.
- Delimiter changes are **template-scoped**: a partial begins with the default `{{ }}` regardless of the caller's current delimiters, and changes inside a partial do not leak back out.

## 3. Design

### 3.1 `LexOptions { mustacheDelims :: Boolean }`

Extends the existing dialect-scoping seam (the `infixArith` precedent). When **false** (the ladder's default) the lexer is byte-identical to today. When **true**, the lexer carries a *current* `{ open, close }` pair (init `{{`/`}}`); on a `<open>= A B =<close>` tag it swaps the pair and emits a new `RSetDelim` `RawTok`. Single pass, O(n); spans stay correct via the lexer's existing `base` offset. No re-lex, no source rewrite.

### 3.2 Who sets the flag (mimic Mustache + Handlebars)

Mustache **has** set delimiters; Handlebars **does not** — so the matrix:

- **MinBars** — `mustacheDelims = true` by **default** (Mustache conformance); inline `{{=...=}}` mid-stream.
- **RawBars + MaxBars** — **opt-in**, off by default, via **four** mechanisms (all seed the same initial pair; once enabled, inline `{{=...=}}` mid-stream changes also work):
  1. **config** — `flatbars.json`: `"delimiters": ["<%", "%>"]`
  2. **runtime** — `ParseOptions { delimiters :: Maybe { open, close } }`
  3. **CLI** — `flatbars render --delimiters '<% %>' …`
  4. **directive** — `{{! @delimiters: <% %> }}` (header directive, colon + space-separated new pair; rides the comment lexeme exactly like `@truthiness` / `@trim`; sets the file's *initial* pair). **Chosen syntax.**
- **ClassicBars** — **excluded.** It is the Handlebars-faithful dialect, and Handlebars has no set delimiters.

The off-by-default invariant is the contract: *with the flag off, RawBars/MaxBars/ClassicBars lex exactly as before* (byte-identical).

**Precedence** when several are present: directive (most local) ▸ runtime ▸ CLI ▸ config (most global) — the most-local initial pair wins; inline `{{=...=}}` then overrides mid-stream from that point. (Mirrors how `@truthiness` overrides project config.)

### 3.3 `RSetDelim` RawTok + highlighting

A new `RawTok` constructor carrying the tag's span and the new pair. It is:
- **dropped from output** (renders nothing), like `RComment`;
- **standalone-eligible** in `MinBars.Standalone` (and the ladder's standalone pass if opted in);
- assigned a **highlight token kind** so `<%=...=%>` and custom-delimited tags colour in both front-ends (folds into the ADR-014 Tier-1 `tokenizeTemplate` span work — the highlighter must not disagree with the engine).

## 4. Normative rulings (the spec-suite traps)

1. **Rebasing scope = sigils-only (spec-exact).** Under custom delimiters, only the **2-char pair + the Mustache sigils** (`# / ^ & > ! =`) rebase. The FlatBars/Handlebars extensions — triple `{{{`, long-comment `{{!--`, raw-block `{{{{`, inheritance `{{<` / `{{$`, and the `~` whitespace-control openers — do **not** rebase; their behaviour under custom delimiters is undefined by the spec. Unescaped output under custom delimiters is the ampersand form `<%& name %>`.
2. **Standalone whitespace.** `RSetDelim` is standalone-eligible. *(See §5 — 8 of the 14 fixtures are whitespace/standalone cases; this is the bulk of the work, not the swap itself.)*
3. **Partial-boundary reset.** Each partial starts at the default pair; nested changes do not leak.
4. **Highlighting.** `RSetDelim` carries a token kind (§3.3).

## 5. The 14 conformance cases (`mustache/spec` delimiters)

What they exercise — note the whitespace-heavy tail, which is where MinBars's `Standalone` pass does the real work:

| # | Case | Exercises |
|---|---|---|
| 1 | Pair Behavior | basic `{{=<% %>=}}` swap |
| 2 | Special Characters | exotic delimiters (`{{=[ ]=}}` etc.) |
| 3 | Sections | sigils under custom delimiters (`<%#…%>`/`<%/…%>`) |
| 4 | Inverted Sections | `<%^…%>` under custom delimiters |
| 5 | Partial Inheritence | **partial-boundary reset** (caller's delims don't leak in) |
| 6 | Post-Partial Behavior | change persists after a partial returns |
| 7–14 | Surrounding/Outlying Whitespace, Standalone Tag, Indented Standalone, Standalone Line Endings, Standalone Without Previous Line / Without Newline, Pair with Padding | **standalone-whitespace** interaction (ruling §4.2) |

## 6. Implementation plan (post-review — NOT in this pass)

1. **Promote the corpus.** Move `spec-pending/delimiters.json` → `packages/minbars/test/spec/`; add `"delimiters"` to `scripts/vendor-mustache.mjs` MODULES and re-vendor the split fixtures into `lab/examples/vendored/mustache/`.
2. **Lexer.** Add `mustacheDelims` to `LexOptions` + `RSetDelim` to `RawTok`; implement the gated pair-swap in `FlatBars.Lexer` (sigils-only rebasing, §4.1). Off-by-default ⇒ ladder unchanged.
3. **MinBars.** Set the flag in MinBars `ParseOptions`; make `RSetDelim` standalone-eligible in `MinBars.Standalone`; handle partial-boundary reset; drop `RSetDelim` from `buildFromTokens`.
4. **RawBars + MaxBars opt-in (not ClassicBars).** Thread `delimiters` through `ParseOptions` (runtime); read it from `flatbars.json` (config) and `--delimiters` (CLI); add the `{{! @delimiters: <% %> }}` header directive (parse + carry, like `@trim`/`@truthiness`); enforce the no-whitespace/no-`=` validation with a parse error on a bad pair. Leave ClassicBars's `ParseOptions` without the knob.
5. **Gate it.** Flip delimiters into `examples:verify` / `test:minbars-spec`; regen `tutorials/src/conformance.json` (and reconcile the tutorial's hand-written `Set delimiters` row → generated); update ADR-007 (deferred → implemented) and ADR-015 (Proposed → Accepted).
6. **Tutorial.** Promote the static `set-delimiters` block to a live runnable card.
7. **Highlighting.** Add the `RSetDelim` kind to the ADR-014 Tier-1 `tokenizeTemplate` map.

## 7. Acceptance

- `delimiters` 14/14 in `examples:verify` and `test:minbars-spec`.
- **Ladder-default regression:** with `mustacheDelims` off, the existing RawBars/ClassicBars/MaxBars corpora render byte-identically (the off-by-default invariant — gate it explicitly).
- **Ladder opt-in:** a ClassicBars/MaxBars fixture with `@delimiters` (or the flag) renders custom-delimited tags correctly.
- The highlighter colours `<%=...=%>` (the ADR-014 corpus gains a delimiters case).

## 8. Non-goals / resolved questions

- **Not** rebasing the FlatBars extensions under custom delimiters (§4.1) — spec-undefined; revisit only on demand.
- **Resolved:** directive syntax is `{{! @delimiters: <% %> }}` (colon + space-separated new pair). It composes with the other header directives; ordering is independent (delimiters affect lexing, `@truthiness`/`@trim` affect later phases).
- **Resolved:** RawBars/MaxBars get **full Mustache behaviour** — config/runtime/CLI/directive set the *initial* pair, and inline `{{=...=}}` changes work mid-file once enabled (mimic Mustache). Not a directive-only path.
- **Resolved:** ClassicBars is **excluded** (mimic Handlebars, which has no set delimiters).
