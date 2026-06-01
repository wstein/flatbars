// TypeScript surface for the flatbars-js facade (FullBars.JS).
//
// These declarations describe the *uncurried* entry points compiled from
// `FullBars.JS`. `data` is any JSON-shaped value (object, array, string,
// number, boolean, or null) — it is read as Argonaut `Json`, which is an
// ordinary JS value.

/** Outcome of a render. `ok` selects which of `value` / `error` is meaningful. */
export interface RenderResult {
  ok: boolean;
  /** Rendered output when `ok`; otherwise `""`. */
  value: string;
  /** Error message when `!ok`; otherwise `""`. */
  error: string;
}

/** Render a core-syntax template against JS data. */
export function render(template: string, data: unknown): RenderResult;

/** Render a surface-dialect template (paths, `{{ }}` auto-escape, …) against JS data. */
export function renderSurface(template: string, data: unknown): RenderResult;
