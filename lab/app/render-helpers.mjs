// SPDX-License-Identifier: Apache-2.0
//
// Pure render-path helpers extracted from index.html (Phase 0, render sub-slice).
// No app state, no DOM — the surrounding `run()` nerve center (and its ~25 last*
// caches) stays inline for now; these two are the genuinely self-contained,
// security-relevant pieces worth isolating and testing.

// Wrap rendered HTML in a sandbox document for the preview iframe.
//
// When scripting is OFF, a strict CSP (`default-src 'none'`) is the inner
// boundary on top of the same-origin sandbox. When the author opts INTO scripts,
// the CSP is dropped — the isolated `allow-scripts` (null-origin) sandbox is the
// boundary instead — so the rendered <script> actually runs. Keep this in sync
// with the iframe's `sandbox` attribute (the CSP here is the second layer).
export function previewDoc(body, allowScripts = false) {
  const cspMeta = allowScripts
    ? ""
    : '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src * data:; style-src \'unsafe-inline\'; font-src *;">';
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    cspMeta +
    "<style>html,body{margin:0}body{font:13px/1.5 system-ui,sans-serif;padding:14px;color:#18181b;background:#fff}</style>" +
    `</head><body>${body}</body></html>`
  );
}

// Whether the given output view has content to show (drives the empty-state
// placeholder): Render Data needs data, Bytecode needs a compiled program, the
// compiled/migrated views depend only on the template source, the rest need
// rendered output. Pure: it reads a snapshot of the three relevant render caches
// rather than closing over them — the gateway form for the ctx restructure
// (CTX-DESIGN.md), where these become `ctx.caches.*`.
export function outputHasContent(view, { lastData, lastProgram, lastOutput }) {
  if (view === "data") return lastData != null;
  if (view === "bytecode") return lastProgram != null;
  if (view === "compiled") return true; // depends only on the template source
  if (view === "migrated") return true; // depends only on the template source
  return !!lastOutput;
}

// Rewrite every `emit` instruction's escape mode in place. This walks the
// stem-bc/v1 wire directly, so it is meaningful only for an engine that declares
// `escape-modes` (ADR-0020) — `escapeModesSupported` carries that capability so
// this stays pure. A program from an engine without per-emit escape modes is not
// a stem-bc wire and must not be rewritten (then this is a no-op, and the
// render-config escape control has no effect — Phase 2: neutralise the wire
// couplings). Recurses into then/else/body arms.
export function applyEscape(program, mode, escapeModesSupported) {
  if (!mode || !escapeModesSupported) return program;
  const rewrite = (instructions) =>
    instructions.map((inst) => {
      const next = { ...inst };
      if (next.t === "emit") next.escape = mode;
      for (const key of ["then", "else", "body"]) {
        if (Array.isArray(next[key])) next[key] = rewrite(next[key]);
      }
      return next;
    });
  return { ...program, instructions: rewrite(program.instructions) };
}
