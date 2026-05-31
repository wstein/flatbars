// SPDX-License-Identifier: Apache-2.0
//
// The BareBars compiled-template runtime (FullBars dialect). Compiled templates
// (BareBars.Compile.FullBars) are `function (data, rt)` and call into this `rt`.
// It re-implements the FullBars value semantics on *plain JS values* — string /
// number / boolean / null / array / object, plus a `Safe` wrapper for VSafe —
// so the compiled path never touches the PureScript `Value` ADT.
//
// CONFORMANCE: this must match the interpreter (FullBars.renderWith) byte for
// byte; the deliberate divergences live here too (content-based VSafe truthiness:
// `safe ""` is falsy; explicit escaping). The example conformance harness
// (compile_conformance.mjs) is the gate.

export const RUNTIME_VERSION = "0.1.0";

// ── Safe (the VSafe analogue): trusted markup, not re-escaped ────────────────
class Safe {
  constructor(s) { this.s = s; }
}
const isSafe = (v) => v instanceof Safe;

// ── stringify (FullBars.Value.stringify) ─────────────────────────────────────
// VString→s, VSafe→content, bool→"true"/"false", null→"", number (no trailing
// .0; JS String already does this), array→join ",", object→error.
function stringify(v) {
  if (isSafe(v)) return v.s;
  if (v === null || v === undefined) return "";
  switch (typeof v) {
    case "string": return v;
    case "boolean": return v ? "true" : "false";
    case "number": return String(v);
  }
  if (Array.isArray(v)) return v.map(stringify).join(",");
  throw new Error("cannot stringify an object");
}

// ── escaping (FullBars.Value.escapeHtml) ─────────────────────────────────────
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

// ── truthiness (FullBars.Value.truthy) — content-based for Safe ──────────────
function truthy(v) {
  if (isSafe(v)) return truthy(v.s);              // a safe string tests as its content
  if (v === null || v === undefined) return false;
  switch (typeof v) {
    case "boolean": return v;
    case "string": return v !== "";
    case "number": return v !== 0;
  }
  if (Array.isArray(v)) return v.length > 0;
  return true;                                    // {} and other objects are truthy
}

// ── value equality / ordering (structural, like the prelude helpers) ─────────
function deepEq(a, b) {
  if (isSafe(a)) a = a.s;
  if (isSafe(b)) b = b.s;
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEq(a[k], b[k]));
}
function order(ok, a, b) {
  const x = isSafe(a) ? a.s : a, y = isSafe(b) ? b.s : b;
  const comparable = (typeof x === "number" && typeof y === "number") ||
    (typeof x === "string" && typeof y === "string");
  if (!comparable) return false;
  return ok(x < y ? -1 : x > y ? 1 : 0);
}

// ── lookup (FullBars.Prelude.lookup): walk segments, null at first miss ──────
function lookup(obj, ...segs) {
  let cur = obj;
  for (const seg of segs) {
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur)) {
      const i = typeof seg === "number" ? seg : Number(seg);
      cur = Number.isInteger(i) && i >= 0 && i < cur.length ? cur[i] : null;
    } else if (typeof cur === "object" && !isSafe(cur)) {
      const k = String(seg);
      cur = Object.prototype.hasOwnProperty.call(cur, k) ? cur[k] : null;
    } else {
      return null;
    }
    if (cur === undefined) cur = null;
  }
  return cur;
}

// ── frames ───────────────────────────────────────────────────────────────────
function scope(data) {
  return {
    ctx: data ?? null, index: null, key: null, first: null, last: null,
    parent: null, parentIndex: null, parentKey: null, parentFirst: null, parentLast: null,
    root: data ?? null,
  };
}
// A child frame, exposing the *enclosing* frame's loop data under `parent-*`
// (FullBars `parentData`: each/with rebind the parent's index/key/first/last).
function childFrame(parent, ctx, index, key, first, last) {
  return {
    ctx, index, key, first, last,
    parent: parent.ctx,
    parentIndex: parent.index, parentKey: parent.key, parentFirst: parent.first, parentLast: parent.last,
    root: parent.root,
  };
}

// Bind block-param names in a frame: `names` ⇒ [element, idx] for `each`, [ctx]
// for `with` (FullBars binds the element/value first, then the index/key).
function bindNames(frame, names, values) {
  if (names && names.length) {
    frame.binds = {};
    for (let i = 0; i < names.length; i++) if (values[i] !== undefined) frame.binds[names[i]] = values[i];
  }
  return frame;
}

// ── iteration: `each` over array or object (FullBars eachH) ──────────────────
// `names` are block-param names (`as |item i|`): item = element, i = index
// (array) or key (object), matching the interpreter.
function each(coll, parent, names, bodyFn, elseFn) {
  let items;
  if (Array.isArray(coll)) {
    items = coll.map((val, i) => ({ val, key: String(i), idx: i }));
  } else if (coll && typeof coll === "object" && !isSafe(coll)) {
    // FullBars VObject is an ordered Map — iteration is by *sorted* key.
    items = Object.keys(coll).sort().map((k) => ({ val: coll[k], key: k, idx: k }));
  } else {
    items = [];
  }
  if (items.length === 0) return elseFn(parent);
  let out = "";
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const fr = bindNames(
      childFrame(parent, it.val, i, it.key, i === 0, i === items.length - 1),
      names, [it.val, it.idx],
    );
    out += bodyFn(fr);
  }
  return out;
}

// ── context shift: `with` (FullBars withH) ───────────────────────────────────
function withCtx(val, parent, names, bodyFn, elseFn) {
  if (!truthy(val)) return elseFn(parent);
  return bodyFn(bindNames(childFrame(parent, val, null, null, null, null), names, [val]));
}

// ── JSON serialization (FullBars.Value.jsonStringify): compact or pretty, with
//    sorted object keys (ordered Map) and per-code-unit string escaping ────────
function jsonQuote(s) {
  let r = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], code = s.charCodeAt(i);
    if (c === '"') r += '\\"';
    else if (c === "\\") r += "\\\\";
    else if (c === "\n") r += "\\n";
    else if (c === "\r") r += "\\r";
    else if (c === "\t") r += "\\t";
    else if (code < 0x20) r += "\\u00" + code.toString(16).padStart(2, "0");
    else r += c;
  }
  return r + '"';
}
function renderJson(v, indent, depth) {
  if (isSafe(v)) v = v.s;
  if (v === null || v === undefined) return "null";
  switch (typeof v) {
    case "boolean": return v ? "true" : "false";
    case "number": return String(v);
    case "string": return jsonQuote(v);
  }
  const colon = indent ? ": " : ":";
  const wrap = (open, close, items) => {
    if (items.length === 0) return open + close;
    if (!indent) return open + items.join(",") + close;
    const pad = indent.repeat(depth + 1);
    return open + "\n" + items.map((it) => pad + it).join(",\n") + "\n" + indent.repeat(depth) + close;
  };
  if (Array.isArray(v)) return wrap("[", "]", v.map((x) => renderJson(x, indent, depth + 1)));
  const members = Object.keys(v).sort().map((k) => jsonQuote(k) + colon + renderJson(v[k], indent, depth + 1));
  return wrap("{", "}", members);
}
const jsonText = (v, opts) => renderJson(v, opts && typeof opts === "object" && truthy(opts.pretty) ? "  " : null, 0);

// ── output / escaping helpers the codegen inlines ────────────────────────────
const out = (v) => stringify(v);
const esc = (v) => isSafe(v) ? v : new Safe(escapeHtml(stringify(v)));
const safe = (v) => new Safe(stringify(v));

// ── the helper registry (`rt.call` for everything not inlined) ───────────────
const helpers = {
  this: (a, f) => f.ctx,
  index: (a, f) => f.index,
  key: (a, f) => f.key,
  first: (a, f) => f.first,
  last: (a, f) => f.last,
  root: (a, f) => f.root,
  parent: (a, f) => f.parent,
  "parent-index": (a, f) => f.parentIndex,
  "parent-key": (a, f) => f.parentKey,
  "parent-first": (a, f) => f.parentFirst,
  "parent-last": (a, f) => f.parentLast,
  true: () => true,
  false: () => false,
  null: () => null,
  lookup: (a) => lookup(...a),
  esc_html: (a) => esc(a[0]),
  safe: (a) => safe(a[0]),
  eq: (a) => deepEq(a[0], a[1]),
  ne: (a) => !deepEq(a[0], a[1]),
  lt: (a) => order((o) => o === -1, a[0], a[1]),
  gt: (a) => order((o) => o === 1, a[0], a[1]),
  lte: (a) => order((o) => o !== 1, a[0], a[1]),
  gte: (a) => order((o) => o !== -1, a[0], a[1]),
  not: (a) => !truthy(a[0]),
  and: (a) => a.every(truthy),
  or: (a) => a.some(truthy),
  log: () => null,
  json: (a) => jsonText(a[0], a[1]),
  esc_json: (a) => new Safe(escapeHtml(jsonText(a[0], a[1]))),
  else: () => new Safe(""),
  elif: () => new Safe(""),
  dict: (a) => { const o = {}; for (let i = 0; i + 1 < a.length; i += 2) o[stringify(a[i])] = a[i + 1]; return o; },
  apply: (a, f) => call(stringify(a[0]), a.slice(1), f),
};
function call(name, args, frame) {
  // block-param bindings (as |item i|) shadow the helper registry, like the
  // interpreter's scoped frame helpers.
  if (frame && frame.binds && Object.prototype.hasOwnProperty.call(frame.binds, name)) return frame.binds[name];
  const h = helpers[name];
  if (!h) throw new Error("UnknownHelper: no helper named '" + name + "' in any frame");
  return h(args, frame);
}

// truthiness honouring an options object's includeZero (FullBars truthyWith)
function truthyWith(v, opts) {
  if (typeof v === "number" && v === 0 && opts && typeof opts === "object" && truthy(opts.includeZero)) return true;
  return truthy(v);
}

// generic block fallback (unrecognised block helper) — not yet supported in the
// compiled path; the interpreter remains the path for exotic block helpers.
function block(name) {
  throw new Error("rt.block: compiled path does not yet support block helper '" + name + "'");
}
function raw(_name, body) { return body; }

export const rt = {
  RUNTIME_VERSION, scope, lookup, out, esc, safe, truthy, truthyWith, call, each, with: withCtx, block, raw, Safe,
};
export default rt;
