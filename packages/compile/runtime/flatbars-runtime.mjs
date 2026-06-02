// SPDX-License-Identifier: Apache-2.0
//
// The FlatBars compiled-template runtime (FullBars dialect). Compiled templates
// (FlatBars.Compile.FullBars) are `function (data, rt)` and call into this `rt`.
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

// ── truthiness (FullBars.Value) — parameterised by a falsy-set ───────────────
// A *set* is `{ b,n,s,z,a,o }` of booleans for the six falsy shapes
// (false / null / "" / 0 / [] / {}); an absent key ⇒ that shape is NOT falsy.
// `HB` is the Handlebars default, used for runtime-internal/config truthiness
// (e.g. the `pretty` option) that is not governed by a file's @truthiness.
const HB = { b: 1, n: 1, s: 1, z: 1, a: 1 };

function isFalsy(set, v) {
  if (isSafe(v)) return isFalsy(set, v.s);        // a safe string tests as its content
  if (v === null || v === undefined) return !!set.n;
  switch (typeof v) {
    case "boolean": return v === false && !!set.b;
    case "string": return v === "" && !!set.s;
    case "number": return v === 0 && !!set.z;     // NaN: NaN===0 is false ⇒ truthy
  }
  if (Array.isArray(v)) return v.length === 0 && !!set.a;
  return Object.keys(v).length === 0 && !!set.o;  // {} falsy only under `presence`
}
function truthy(set, v) {
  return !isFalsy(set, v);
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
// A -1/0/1 comparator mirroring the interpreter's `compareValues`: numbers
// numerically, strings lexicographically, anything else / mixed ⇒ 0 (so a
// stable sort keeps the input order). Used by `sortBy`.
function cmpVals(a, b) {
  const x = isSafe(a) ? a.s : a, y = isSafe(b) ? b.s : b;
  const comparable = (typeof x === "number" && typeof y === "number") ||
    (typeof x === "string" && typeof y === "string");
  if (!comparable) return 0;
  return x < y ? -1 : x > y ? 1 : 0;
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
// Extract a dotted key path from a value (the §6 key-string form for
// sortBy/pluck/groupBy): split on `.` and walk via `lookup`, mirroring the
// interpreter's `extractPath` (a missing/blocked segment ⇒ null).
function pathOf(v, key) {
  return lookup(v, ...key.split("."));
}

// ── frames ───────────────────────────────────────────────────────────────────
function scope(data, falsy) {
  return {
    ctx: data ?? null, index: null, key: null, first: null, last: null,
    index0: null, index1: null, rindex0: null, rindex1: null, length: null,
    parent: null, parentIndex: null, parentKey: null, parentFirst: null, parentLast: null,
    root: data ?? null,
    falsy: falsy || HB,             // the active @truthiness mode (default Handlebars)
  };
}
// A child frame, exposing the *enclosing* frame's loop data under `parent-*`
// (FullBars `parentData`: each/with rebind the parent's index/key/first/last).
// `len` is the collection length (each only); the richer MaxBars loop variables
// (index0/index1/rindex0/rindex1/length) derive from it, null outside a loop.
// Arithmetic mirrors the interpreter's `iterate` so the two paths never drift.
function childFrame(parent, ctx, index, key, first, last, len) {
  const inLoop = index !== null && index !== undefined;
  return {
    ctx, index, key, first, last,
    index0: inLoop ? index : null,
    index1: inLoop ? index + 1 : null,
    rindex0: inLoop ? len - 1 - index : null,
    rindex1: inLoop ? len - index : null,
    length: inLoop ? len : null,
    parent: parent.ctx,
    parentIndex: parent.index, parentKey: parent.key, parentFirst: parent.first, parentLast: parent.last,
    root: parent.root,
    falsy: parent.falsy,            // a loop/with body inherits the file's mode
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
    // `key` is null for arrays (Handlebars parity — @key is object-only; use the
    // index for the array position); the block-param `idx` still binds the index.
    items = coll.map((val, i) => ({ val, key: null, idx: i }));
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
      childFrame(parent, it.val, i, it.key, i === 0, i === items.length - 1, items.length),
      names, [it.val, it.idx],
    );
    out += bodyFn(fr);
  }
  return out;
}

// ── context shift: `with` (FullBars withH) ───────────────────────────────────
function withCtx(val, parent, names, bodyFn, elseFn) {
  if (!truthy(parent.falsy, val)) return elseFn(parent);
  return bodyFn(bindNames(childFrame(parent, val, null, null, null, null), names, [val]));
}

// ── partials: render a registered partial (FullBars partialH) ────────────────
// `partials[name]` is a compiled `function (data, rt, partials)`. The hash (if
// any) merges onto the context object (opts override); a non-object context
// means the hash *is* the context. The result is unescaped (Safe), since a
// partial produces markup, and the registry is threaded so nested `{{> }}`
// resolve.
function partial(name, ctx, hash, partials, rt) {
  const fn = partials && partials[name];
  if (typeof fn !== "function") throw new Error("HelperError: unknown partial '" + name + "'");
  let data = ctx;
  const obj = (v) => v != null && typeof v === "object" && !Array.isArray(v) && !isSafe(v);
  if (obj(hash)) data = obj(ctx) ? Object.assign({}, ctx, hash) : hash;
  return new Safe(fn(data, rt, partials));
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
const jsonText = (v, opts) => renderJson(v, opts && typeof opts === "object" && truthy(HB, opts.pretty) ? "  " : null, 0);

// ── output / escaping helpers the codegen inlines ────────────────────────────
const out = (v) => stringify(v);
const esc = (v) => isSafe(v) ? v : new Safe(escapeHtml(stringify(v)));
const safe = (v) => new Safe(stringify(v));

// ── the helper registry (`rt.call` for everything not inlined) ───────────────
// arithmetic operands must be numbers (matches the interpreter's asNum), so the
// two paths agree on results and on rejecting non-numeric input.
function num(v) {
  if (typeof v !== "number") throw new Error("arithmetic expects a number");
  return v;
}
// A numeric primitive argument (slice/truncate index): same strict number guard
// as the interpreter's asNum, truncated toward zero like its `trunc`/Int.round.
function int(v) {
  return Math.trunc(num(v));
}

const helpers = {
  this: (a, f) => f.ctx,
  index: (a, f) => f.index,
  key: (a, f) => f.key,
  first: (a, f) => f.first,
  last: (a, f) => f.last,
  index0: (a, f) => f.index0,
  index1: (a, f) => f.index1,
  rindex0: (a, f) => f.rindex0,
  rindex1: (a, f) => f.rindex1,
  length: (a, f) => f.length,
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
  escapeHtml: (a) => esc(a[0]),
  safe: (a) => safe(a[0]),
  eq: (a) => deepEq(a[0], a[1]),
  ne: (a) => !deepEq(a[0], a[1]),
  lt: (a) => order((o) => o === -1, a[0], a[1]),
  gt: (a) => order((o) => o === 1, a[0], a[1]),
  lte: (a) => order((o) => o !== 1, a[0], a[1]),
  gte: (a) => order((o) => o !== -1, a[0], a[1]),
  not: (a, f) => !truthy(f.falsy, a[0]),
  and: (a, f) => a.every((v) => truthy(f.falsy, v)),
  or: (a, f) => a.some((v) => truthy(f.falsy, v)),
  // arithmetic — strictly numeric (matches the interpreter's asNum): a non-number
  // operand throws. JS `+ - * /` are the same ops the PureScript interpreter
  // compiles to; modulo uses the trunc form, identical to `Kernel.Prelude.jsMod`.
  add: (a) => num(a[0]) + num(a[1]),
  subtract: (a) => num(a[0]) - num(a[1]),
  multiply: (a) => num(a[0]) * num(a[1]),
  divide: (a) => num(a[0]) / num(a[1]),
  modulo: (a) => { const x = num(a[0]), y = num(a[1]); return x - y * Math.trunc(x / y); },
  // handlebars-helpers aliases of add/subtract/multiply (render identically).
  plus: (a) => num(a[0]) + num(a[1]),
  minus: (a) => num(a[0]) - num(a[1]),
  times: (a) => num(a[0]) * num(a[1]),
  // null-coalescing — the first non-null argument (the `??` desugar target).
  coalesce: (a) => { for (const v of a) if (v !== null) return v; return null; },
  log: () => null,
  // ── value primitives — string pack (helper-packs-spec §4) ──────────────────
  // Subject-first transforms. The subject and any string-valued argument are
  // coerced with `stringify` (so `uppercase` works on a number, matching the
  // interpreter's `strUnary`/`stringifyM`); numeric args (slice/truncate) read
  // via `int` (Math.trunc, matching `asInt`). Results are plain strings (split:
  // an array of strings). All indexing is over UTF-16 code units, the same unit
  // PureScript's Data.String.CodeUnits uses, so the two targets agree.
  lowercase: (a) => stringify(a[0]).toLowerCase(),
  uppercase: (a) => stringify(a[0]).toUpperCase(),
  capitalize: (a) => { const s = stringify(a[0]); return s === "" ? s : s.charAt(0).toUpperCase() + s.slice(1); },
  trim: (a) => stringify(a[0]).trim(),
  trimStart: (a) => stringify(a[0]).trimStart(),
  trimEnd: (a) => stringify(a[0]).trimEnd(),
  split: (a) => stringify(a[0]).split(stringify(a[1])),
  replace: (a) => stringify(a[0]).split(stringify(a[1])).join(stringify(a[2])), // literal, all occurrences (= PureScript replaceAll); empty find is not a tested case
  slice: (a) => a.length >= 3 ? stringify(a[0]).slice(int(a[1]), int(a[2])) : stringify(a[0]).slice(int(a[1])),
  // `includes` is polymorphic (matches the interpreter's type-dispatched
  // includesH): array subject ⇒ element membership by deepEq; string subject ⇒
  // substring; anything else ⇒ false.
  includes: (a) => Array.isArray(a[0]) ? a[0].some((el) => deepEq(el, a[1])) : (typeof (isSafe(a[0]) ? a[0].s : a[0]) === "string" ? stringify(a[0]).includes(stringify(a[1])) : false),
  startsWith: (a) => stringify(a[0]).startsWith(stringify(a[1])),
  endsWith: (a) => stringify(a[0]).endsWith(stringify(a[1])),
  truncate: (a) => { const s = stringify(a[0]), n = int(a[1]), suf = a.length >= 3 ? stringify(a[2]) : "…"; return s.length > n ? s.slice(0, n) + suf : s; },
  append: (a) => stringify(a[0]) + stringify(a[1]),
  prepend: (a) => stringify(a[1]) + stringify(a[0]),
  // case aliases (handlebars-helpers parity): identical to lowercase/uppercase.
  downcase: (a) => stringify(a[0]).toLowerCase(),
  upcase: (a) => stringify(a[0]).toUpperCase(),
  // ── value primitives — number pack (helper-packs-spec §4) ───────────────────
  // abs/floor/ceil/round are Math.* (the interpreter's Data.Number FFI is the
  // same), so byte-identical. toFixed's `n.toFixed(d)` IS the interpreter's
  // `toStringWith (fixed d) n`. toInt/toFloat parse via `parseFloat` gated by
  // `Number.isFinite` — exactly Data.Number.fromString — so the two agree;
  // null on parse failure, trunc toward zero for toInt. Operands via num/int.
  abs: (a) => Math.abs(num(a[0])),
  floor: (a) => Math.floor(num(a[0])),
  ceil: (a) => Math.ceil(num(a[0])),
  round: (a) => Math.round(num(a[0])),
  toFixed: (a) => num(a[0]).toFixed(int(a[1])),
  toInt: (a) => { const n = parseFloat(stringify(a[0])); return Number.isFinite(n) ? Math.trunc(n) : null; },
  toFloat: (a) => { const n = parseFloat(stringify(a[0])); return Number.isFinite(n) ? n : null; },
  // ── value primitives — array pack (helper-packs-spec §4, §6) ────────────────
  // Key-based forms take a dotted key string (no callbacks): `pathOf` splits on
  // `.` and walks via `lookup`, the same access the interpreter's extractPath
  // uses. `sortBy` is stable (V8 ES2019) with the `cmpVals` comparator
  // (incomparable ⇒ 0 = keep order), mirroring the interpreter's Array.sortBy.
  join: (a) => Array.isArray(a[0]) ? a[0].map(stringify).join(stringify(a[1])) : stringify(a[0]),
  count: (a) => Array.isArray(a[0]) ? a[0].length : (a[0] !== null && typeof a[0] === "object" && !isSafe(a[0]) ? Object.keys(a[0]).length : 0),
  size: (a) => Array.isArray(a[0]) ? a[0].length : (a[0] !== null && typeof a[0] === "object" && !isSafe(a[0]) ? Object.keys(a[0]).length : 0),
  at: (a) => { if (!Array.isArray(a[0])) return null; const r = a[0].at(int(a[1])); return r === undefined ? null : r; },
  take: (a) => Array.isArray(a[0]) ? a[0].slice(0, Math.max(0, int(a[1]))) : [],
  takeRight: (a) => { if (!Array.isArray(a[0])) return []; const n = Math.max(0, int(a[1])); return n === 0 ? [] : a[0].slice(a[0].length - Math.min(n, a[0].length)); },
  // `reverse` is polymorphic (matches the interpreter's reverseH): array ⇒
  // reversed elements; otherwise the stringified subject reversed by code unit.
  reverse: (a) => Array.isArray(a[0]) ? a[0].slice().reverse() : stringify(a[0]).split("").reverse().join(""),
  unique: (a) => { if (!Array.isArray(a[0])) return []; const out = []; for (const v of a[0]) if (!out.some((u) => deepEq(u, v))) out.push(v); return out; },
  sortBy: (a) => { if (!Array.isArray(a[0])) return []; const key = stringify(a[1]); return a[0].slice().sort((x, y) => cmpVals(pathOf(x, key), pathOf(y, key))); },
  pluck: (a) => Array.isArray(a[0]) ? a[0].map((el) => pathOf(el, stringify(a[1]))) : [],
  groupBy: (a) => { if (!Array.isArray(a[0])) return {}; const key = stringify(a[1]), o = {}; for (const el of a[0]) { const k = stringify(pathOf(el, key)); (o[k] = o[k] || []).push(el); } return o; },
  json: (a) => jsonText(a[0], a[1]),
  escapeJson: (a) => new Safe(escapeHtml(jsonText(a[0], a[1]))),
  else: () => new Safe(""),
  elif: () => new Safe(""),
  dict: (a) => { const o = {}; for (let i = 0; i + 1 < a.length; i += 2) o[stringify(a[i])] = a[i + 1]; return o; },
  apply: (a, f) => call(stringify(a[0]), a.slice(1), f),
};
// Host-registered helpers (ADR-018): inline JS functions a host adds with
// `rt.register`. They use the Handlebars-style positional convention
// `(...args) => value` (not the prelude's `(args, frame)`), and may return
// `safe(str)` — a `{ __fbSafe }` sentinel, the same one the engine facade's
// `safe` produces — to emit raw markup; it is normalised to the internal `Safe`
// here so the output site treats it like any safe value. Used by both the
// compiled module (this registry) and the interpreter (the facade marshals the
// same functions into engine helpers), so the two paths agree.
const userHelpers = Object.create(null);
// Arity descriptor → text / check, matching the prelude (Kernel.Walk) and the
// engine facade's FFI so a custom helper's arity diagnostics read like a
// built-in's. `arity` is a number (exactly N), `[min, max]` (max null/Infinity ⇒
// at-least), or undefined (any).
function uArityText(arity) {
  if (arity === undefined || arity === null) return "any number of";
  if (typeof arity === "number") return "exactly " + arity;
  const [lo, hi] = arity;
  return hi == null || hi === Infinity ? "at least " + lo : lo + "–" + hi;
}
function uArityOk(arity, n) {
  if (arity === undefined || arity === null) return true;
  if (typeof arity === "number") return n === arity;
  const [lo, hi] = arity;
  return n >= lo && (hi == null || hi === Infinity || n <= hi);
}
// `register(name, fn)` or `register(name, fn, arity)` (ADR-018).
function register(name, fn, arity) {
  if (typeof fn !== "function") throw new Error("rt.register: helper '" + name + "' is not a function");
  userHelpers[name] = { fn, arity };
  return rt;
}
function callUser(name, entry, args) {
  if (!uArityOk(entry.arity, args.length)) {
    throw new Error("ArityError: " + name + ": expected " + uArityText(entry.arity) + " argument(s), got " + args.length);
  }
  const r = entry.fn(...args);
  return (r && typeof r === "object" && typeof r.__fbSafe === "string") ? new Safe(r.__fbSafe) : r;
}

function call(name, args, frame) {
  // block-param bindings (as |item i|) shadow the helper registry, like the
  // interpreter's scoped frame helpers.
  if (frame && frame.binds && Object.prototype.hasOwnProperty.call(frame.binds, name)) return frame.binds[name];
  const h = helpers[name];
  if (h) return h(args, frame);
  const u = userHelpers[name];
  if (u) return callUser(name, u, args);
  throw new Error("UnknownHelper: no helper named '" + name + "' in any frame");
}

// truthiness under a set, honouring an options object's includeZero as a
// per-call exception (FullBars truthyWith): includeZero removes the zero shape
// for this one test, composing with whatever the file's mode is.
function truthyWith(set, v, opts) {
  const inc = opts && typeof opts === "object" && truthy(HB, opts.includeZero);
  return truthy(inc ? { ...set, z: 0 } : set, v);
}

// Block helpers not lowered to native control flow (the emitter routes them
// here with the same shape it gives `each`/`with`: the args, the frame, the
// before-clause body lambda, and a `{ clause: fn }` object — e.g. `{ else }`).
// The compiled body lambda is frame-relative (it reads whatever frame it is
// handed), so we can dispatch `apply` to the right block semantics at runtime:
// the parent frame for if/unless (no shift), child frames for each/with.
//   {{#apply "each" coll}}…{{/apply}}  ⇒  apply renders `coll` with each.
// `apply`'s first arg is a helper-name string; the rest are that helper's args.
// Mirrors the interpreter's `applyH` (Kernel.Prelude). A non-block target is
// invoked as an inline helper (its body ignored, as the interpreter does) and
// its value stringified; an unknown name throws, like `rt.call`.
function block(name, args, frame, bodyFn, clauses) {
  if (name !== "apply") {
    throw new Error("rt.block: compiled path does not support block helper '" + name + "'");
  }
  const target = args[0];
  if (typeof target !== "string") {
    throw new Error("apply: first argument must be a helper-name string");
  }
  const rest = args.slice(1);
  const elseFn = (clauses && clauses.else) || (() => "");
  switch (target) {
    case "if": return truthy(frame.falsy, rest[0]) ? bodyFn(frame) : elseFn(frame);
    case "unless": return truthy(frame.falsy, rest[0]) ? elseFn(frame) : bodyFn(frame);
    case "each": return each(rest[0], frame, [], bodyFn, elseFn);
    case "with": return withCtx(rest[0], frame, [], bodyFn, elseFn);
    // an inline helper target: call it (body ignored) and stringify the result.
    default: return stringify(call(target, rest, frame));
  }
}
function raw(_name, body) { return body; }

// ── MinBars (Mustache) compiled-path ops (ADR-016) ───────────────────────────
// MinBars is a peer engine: its "scope" is a context STACK with parent fallback,
// not the RefEnv frame. These mirror MinBars.Context/MinBars.Prelude exactly
// (the compile-conformance gate enforces it). Output/escape reuse out/esc/stringify
// above — the runtime's escapeHtml/stringify already match the kernel's.
const MUSTACHE = { b: 1, n: 1, a: 1 }; // false/null/[] falsy (fallback; $falsy is generated)

// The root MinBars scope: the datum as the sole stack frame (MinBars.Context.seedEnv).
function mseed(data, falsy) { return { stack: [data ?? null], falsy: falsy || MUSTACHE }; }
// Push a frame (sections render their body under a push; MinBars.Context.push).
function mpush(env, v) { return { stack: [v, ...env.stack], falsy: env.falsy }; }
// A plain (non-array, non-Safe) object frame that owns `key` (the walk predicate).
const mhas = (v, key) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !isSafe(v) &&
  Object.prototype.hasOwnProperty.call(v, key);

// Resolve a Mustache name against the stack (MinBars.Context.mresolve): `.` is the
// stack top; otherwise the head key walks the stack top→bottom for the first object
// frame holding it (parent fallback), and each dotted-tail segment descends into
// THAT result only (no further walk). Any miss ⇒ null.
function mlookup(env, name) {
  const stack = env.stack;
  if (name === ".") return stack.length ? stack[0] : null;
  const segs = name.split(".");
  let cur = null;
  for (const frame of stack) { if (mhas(frame, segs[0])) { cur = frame[segs[0]]; break; } }
  for (let i = 1; i < segs.length; i++) cur = mhas(cur, segs[i]) ? cur[segs[i]] : null;
  return cur;
}

// The polymorphic Mustache section (MinBars.Prelude.sectionH): an array renders the
// body once per element (each pushed); a truthy non-list renders once (pushed); a
// falsy value renders zero times. Bodies are joined raw (already escaped by their
// own interpolations).
function msection(v, env, bodyFn) {
  const items = Array.isArray(v) ? v : (isFalsy(env.falsy, v) ? [] : [v]);
  let out = "";
  for (const it of items) out += bodyFn(mpush(env, it));
  return out;
}

// Inverted-section test (MinBars.Prelude.invertedH renders iff the value is falsy
// under the active mode; the body runs in the unchanged context).
const mfalsy = (env, v) => isFalsy(env.falsy, v);

// Block-override reindentation (ADR-016 slice 3 / MinBars.Prelude.indentOverride):
// add a standalone `{{$block}}`'s expansion indent to each non-empty line of the
// override's RENDERED output (the definition-site dedent already happened at
// compile time), and guarantee exactly one trailing newline (the slot's line
// terminator). An empty body, or empty indent, is the identity bar that newline.
function mindentOverride(indent, body) {
  if (body === "") return body;
  const ls = body.split("\n");
  const lastI = ls.length - 1;
  const out = ls.map((l, i) => ((i === lastI && l === "") || l === "") ? l : indent + l).join("\n");
  return out.endsWith("\n") ? out : out + "\n";
}

export const rt = {
  RUNTIME_VERSION, scope, lookup, out, esc, safe, truthy, truthyWith, call, each, with: withCtx, partial, block, raw, Safe,
  register, // ADR-018: host-registered inline helpers
  mseed, mlookup, msection, mfalsy, mindentOverride,
};
export default rt;
