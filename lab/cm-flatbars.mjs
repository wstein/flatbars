// SPDX-License-Identifier: Apache-2.0
//
// The FlatBars syntax-highlighting presenter for the Lab's CodeMirror editor.
//
// One CodeMirror 6 ViewPlugin that paints template syntax INNER-TOKEN — braces +
// keywords, helper names, literals each their own colour — to read like VS Code's
// 2026-dark rendering (the grammar floor + the LSP semantic tokens). It drives
// the shared painter `lab/highlight-paint.mjs` (`paintKinds`), which is itself a
// faithful port of the LSP operation pass (drift-gated by check:paint-parity), so
// the editor can never disagree with VS Code or the engine.
//
// CodeMirror is injected (`{ ViewPlugin, Decoration }`) rather than imported, so
// this module carries no CM dependency of its own — the Lab loads CM6 from esm.sh.
// `isOperation(name)` is injected too (the Lab supplies the full prelude
// vocabulary from `operation-names.mjs`), keeping the painter self-contained.
//
// Colour contract: the consumer's stylesheet must define the `.tk-*` classes
// (`tk-punct`/`tk-keyword`/`tk-operation`/`tk-number`/`tk-string`/`tk-comment`/
// `tk-delim`/`tk-error`, plus `tk-in` for the bold in-tag default), mapped to the
// `--c-*` palette — the SAME classes the tutorials use, so the two front-ends
// share one look.
import { paintKinds, KIND_CLASS, tagRanges } from "./highlight-paint.mjs?v=8cf10c03";

// Build a CodeMirror extension that decorates FlatBars template syntax for one
// dialect. `cm` supplies the CM6 primitives `{ ViewPlugin, Decoration }`;
// `isOperation(name)` returns true for a known prelude helper.
//
// The whole document is repainted on every change (playground templates are
// small, and a full-doc scan is what makes a multi-line `{{!-- … --}}` comment
// one span). A non-FlatBars dialect or a lex failure yields no segments, so the
// editor degrades to plain text rather than disagreeing with the engine.
export function flatbarsHighlight(cm, dialect, isOperation = () => false) {
  const { ViewPlugin, Decoration } = cm;

  // A repaint-on-change ViewPlugin from a `doc → DecorationSet` builder.
  const layer = (build) =>
    ViewPlugin.fromClass(
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

  // Layer 1 — the whole-tag `tk-tag` plates (`{ … }`, braces included). Kept in
  // their OWN set (no token marks beside them) and returned LAST (CM nests the
  // later decoration layer OUTSIDE earlier ones), so each plate is one continuous
  // pill wrapping the token marks. Mixing the wide plate into the token set
  // instead makes CM split it at shared boundaries (the closing `}}` lands in its
  // own plate); keeping it a layer that's outermost avoids that.
  const plates = (view) => {
    const text = view.state.doc.toString();
    const ranges = tagRanges(text, dialect).map((t) =>
      Decoration.mark({ class: "tk-tag" }).range(t.from, t.to),
    );
    return Decoration.set(ranges, true);
  };

  // Layer 2 — the per-token colours, nested inside the plates.
  const tokens = (view) => {
    const text = view.state.doc.toString();
    const ranges = [];
    for (const seg of paintKinds(text, dialect, isOperation)) {
      const cls = seg.kind ? KIND_CLASS[seg.kind] : seg.inTag ? "tk-in" : null;
      if (cls) ranges.push(Decoration.mark({ class: cls }).range(seg.from, seg.to));
    }
    return Decoration.set(ranges, true);
  };

  // tokens first, plates last → CM draws the plate as the OUTER span (one pill).
  return [layer(tokens), layer(plates)];
}
