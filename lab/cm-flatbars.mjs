// SPDX-License-Identifier: Apache-2.0
//
// The shared FlatBars syntax-highlighting presenter (ADR-014).
//
// One CodeMirror 6 ViewPlugin, used by *both* front-ends (the FlatBars Lab and
// the tutorials site), that paints template syntax from the engine lexer's own
// spans — `highlightSpans(template, dialect)` from the `flatbars-js` bundle —
// rather than a per-surface regex. Because the spans come from the lexer, the
// highlighting is correct on set delimiters (the lexer carries the live
// delimiter pair), on every dialect's tag boundaries, and on the clause keywords
// (`{{else}}` / `{{elif}}`) the dialect treats as separators.
//
// CodeMirror is injected (`{ ViewPlugin, Decoration }`) rather than imported, so
// this module is agnostic about where CM6 comes from — the Lab loads it from
// esm.sh, the tutorials from npm — and carries no CM dependency of its own. The
// engine's `highlightSpans` is injected for the same reason.
//
// Colour contract: the consumer's stylesheet must define the classes in
// `FLATBARS_KIND_CLASS` (the unified `--c-*` palette — shared with the
// tutorials and the legend — plus `.cm-hb-pn` for the dimmed delimiters and
// `.cm-hb-error`). Kinds are grouped onto seven palette families so `{{else}}`
// reads as a statement alongside `{{#…}}`.

// kind (from `FlatBars.Highlight`) → CSS class, the seven-family system shared
// with the tutorials and the colour legend. Several kinds share a slot on
// purpose: every block sigil and the clause keywords read as control flow
// (block); the inheritance sigils (`{{<}}`/`{{$}}`) get their own composition
// slot (inherit), distinct from a `{{> partial}}` (partial); set-delimiter tags
// get their own directive slot (delim), distinct from a comment; triple-stash
// and raw blocks read as unescaped output (raw).
export const FLATBARS_KIND_CLASS = {
  expr: "cm-hb-expr",
  keyword: "cm-hb-block",
  "block-open": "cm-hb-block",
  "block-inverse": "cm-hb-block",
  "block-close": "cm-hb-block",
  "block-parent": "cm-hb-inherit",
  "block-decl": "cm-hb-inherit",
  partial: "cm-hb-partial",
  raw: "cm-hb-raw",
  "raw-block": "cm-hb-raw",
  comment: "cm-hb-comment",
  "set-delimiter": "cm-hb-delim",
  error: "cm-hb-error",
};

// Every span is a whole `{{…}}` tag (one span per tag, coloured by meaning).
// This is the subset whose leading/trailing delimiters get dimmed.
const TAG_KINDS = new Set([
  "expr", "keyword", "block-open", "block-inverse", "block-close",
  "block-parent", "block-decl", "partial", "raw", "comment", "set-delimiter",
]);

// Map a span kind to its CSS class; an unknown kind falls back to `expr` so a
// future lexer kind degrades to plain interpolation styling rather than vanishing.
export function kindClass(kind) {
  return FLATBARS_KIND_CLASS[kind] || "cm-hb-expr";
}

// Build a CodeMirror extension that decorates FlatBars template syntax for one
// dialect. `cm` supplies the CM6 primitives `{ ViewPlugin, Decoration }`;
// `highlightSpans` is the engine facade `(template, dialect) → Span[]`.
//
// The whole document is scanned on every change (playground templates are
// small, and a full-doc scan is what makes a multi-line `{{!-- … --}}` comment
// one span — the cross-line issue a line-by-line matcher gets wrong). A lex
// error yields no spans, so highlighting degrades to plain text rather than
// disagreeing with the engine.
export function flatbarsHighlight(cm, highlightSpans, dialect) {
  const { ViewPlugin, Decoration } = cm;

  function build(view) {
    const text = view.state.doc.toString();
    const spans = highlightSpans(text, dialect) || [];
    const ranges = [];
    for (const s of spans) {
      if (!(s && s.to > s.from)) continue;
      ranges.push(Decoration.mark({ class: kindClass(s.kind) }).range(s.from, s.to));
      // Dim the tag's own `{{`/`}}` delimiters with a nested mark — the sigil +
      // name stay loud, exactly like the legend chips and the tutorials editor.
      // Only default `{{`-style delimiters dim (custom set-delimiter pairs keep
      // their full colour); the start/end guards keep this safe on short tags.
      if (TAG_KINDS.has(s.kind)) {
        const t = text.slice(s.from, s.to);
        const open = t.startsWith("{{{") ? 3 : t.startsWith("{{") ? 2 : 0;
        const close = t.endsWith("}}}") ? 3 : t.endsWith("}}") ? 2 : 0;
        if (open) ranges.push(Decoration.mark({ class: "cm-hb-pn" }).range(s.from, s.from + open));
        if (close && s.to - close >= s.from + open) {
          ranges.push(Decoration.mark({ class: "cm-hb-pn" }).range(s.to - close, s.to));
        }
      }
    }
    // `true` sorts the ranges (spans are already in order, but the flag is cheap
    // insurance against an out-of-order kind in the future).
    return Decoration.set(ranges, true);
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = build(view);
      }
      update(update) {
        if (update.docChanged) this.decorations = build(update.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
