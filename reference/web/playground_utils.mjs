// SPDX-License-Identifier: Apache-2.0

const encoder = new TextEncoder();

export function debounce(fn, waitMs = 160) {
  let handle = null;
  return (...args) => {
    if (handle !== null) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      fn(...args);
    }, waitMs);
  };
}

// ── ADR-0020 capability gating ─────────────────────────────────────────────
// `engineInfo().features` (engine-features/v1) is a list of tokens, each a base
// name optionally suffixed `:approximate` (the native|approximate fidelity
// axis). These pure helpers let the UI gate optional panels on the vector
// without hard-coding per-engine knowledge — the whole point of the
// engine-neutral seam. Tested directly so the gate is provable in isolation.

// Map a feature vector to `baseName -> fidelity` ("native" | "approximate").
function featureMap(features) {
  const map = new Map();
  for (const token of features || []) {
    const [name, suffix] = String(token).split(":");
    map.set(name, suffix === "approximate" ? "approximate" : "native");
  }
  return map;
}

// Does the engine advertise `name` at any fidelity?
export function hasFeature(features, name) {
  return featureMap(features).has(name);
}

// "native" | "approximate" | null (absent). Drives the in-UI "approximate"
// badge and the cross-engine-diff bar (ADR-0020).
export function featureFidelity(features, name) {
  return featureMap(features).get(name) || null;
}

// A panel/view declaring `requires: [feature, …]` is visible only when the
// engine advertises every required feature. An empty/absent `requires` is
// always visible (core surface). This is the single predicate both the dock
// and the output-view strip gate on.
export function tabVisibleUnder(features, requires) {
  const map = featureMap(features);
  return (requires || []).every((feature) => map.has(feature));
}

// Rust spans are UTF-8 byte offsets; map them into JS string indices.
export function byteToChar(source, byteOffset) {
  if (byteOffset <= 0) return 0;

  let bytes = 0;
  for (let i = 0; i < source.length; ) {
    if (bytes >= byteOffset) return i;

    const codePoint = source.codePointAt(i);
    const char = String.fromCodePoint(codePoint);
    const charBytes = encoder.encode(char).length;
    if (bytes + charBytes > byteOffset) return i;

    bytes += charBytes;
    i += codePoint > 0xffff ? 2 : 1;
  }

  return source.length;
}

// Inverse of byteToChar: the UTF-8 byte offset of a JS string index, so a
// CodeMirror caret position can be compared against Rust byte spans.
export function charToByte(source, charIndex) {
  const index = Math.max(0, Math.min(charIndex, source.length));
  return encoder.encode(source.slice(0, index)).length;
}

export function byteRangeToCharRange(source, startByte, endByte) {
  const from = byteToChar(source, startByte);
  const to = byteToChar(source, endByte);
  return [from, Math.max(from + 1, to)];
}

// The partial name if `charIndex` sits inside a `{{> name ...}}` tag, else null.
// A partial tag expands inline and produces no output run of its own, so the
// playground uses this to map a caret on the tag to that partial's output. The
// name capture excludes `~` so a trailing whitespace-control marker (`{{> x~}}`)
// isn't taken as part of the name (the compiler strips it, yielding file "x").
export function partialNameAt(source, charIndex) {
  const re = /\{\{~?\s*>\s*([^\s}~]+)[^}]*\}\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (charIndex >= m.index && charIndex < m.index + m[0].length) return m[1];
  }
  return null;
}

export function charToLineColumn(source, charIndex) {
  const index = Math.max(0, Math.min(charIndex, source.length));
  const upToIndex = source.slice(0, index);
  const lines = upToIndex.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

// Disassemble a `stem-bc/v1` wire program (the object `compile` returns) to the
// human-readable text `Stem.Bytecode.disasm/1` emits on the BEAM, so the
// playground's Bytecode view matches the reference disassembler. Any `src`
// provenance on a mapped program is ignored.
export function disassemble(program) {
  const version = (program && program.version) || "stem-bc/v1";
  const instructions = (program && program.instructions) || [];
  // The wire form carries every compiled partial body alongside `instructions`
  // (the BEAM and Rust producers both emit `"partials": {name: [...]}` when the
  // program references any). `INVOKE_PARTIAL <name>` in the main listing is a
  // pointer into that registry, so dumping each body inline — under a
  // `; partial: <name>` section header — gives the user the whole program in
  // one scrollable view, mirroring how the ST4 Preview lists the main template
  // and every partial as siblings in a single `.stg` group file. Partials are
  // resolved by name at render time, so the listing order doesn't have to
  // match invocation order; sorting alphabetically gives a stable scan.
  const partials = (program && program.partials) || {};
  const lines = ["; " + version];
  for (const instr of instructions) lines.push(...disasmInstruction(instr, 0));
  for (const name of Object.keys(partials).sort()) {
    lines.push("", "; partial: " + name);
    for (const instr of partials[name]) lines.push(...disasmInstruction(instr, 0));
  }
  return lines.join("\n") + "\n";
}

function indent(depth) {
  return "  ".repeat(depth);
}

function disasmBranch(label, instructions, depth) {
  if (!instructions || instructions.length === 0) return [];
  const lines = [indent(depth + 1) + label];
  for (const instr of instructions) lines.push(...disasmInstruction(instr, depth + 2));
  return lines;
}

function disasmInstruction(instr, depth) {
  const ind = indent(depth);
  switch (instr.t) {
    case "text":
      return [ind + "EMIT_TEXT " + inspectLiteral(instr.text)];
    case "emit":
      return [ind + "EMIT " + disasmValue(instr.value) + " ESCAPE=" + instr.escape];
    case "if":
      return [
        ind + "IF " + disasmValue(instr.cond),
        ...disasmBranch("THEN", instr.then, depth),
        ...disasmBranch("ELSE", instr.else, depth),
      ];
    case "each":
    case "with": {
      const head = ind + instr.t.toUpperCase() + " " + disasmValue(instr.subject);
      return [
        head,
        ...disasmBranch("DO", instr.body, depth),
        ...disasmBranch("ELSE", instr.else, depth),
      ];
    }
    case "scope": {
      const entries = Object.entries(instr.hash || {});
      const hash = entries.length
        ? " {" + entries.map(([k, v]) => k + "=" + disasmValue(v)).join(", ") + "}"
        : "";
      return [ind + "SCOPE " + disasmValue(instr.base) + hash, ...disasmBranch("DO", instr.body, depth)];
    }
    case "invoke_partial": {
      // Mirrors `Stem.Bytecode.disasm_instruction({:invoke_partial, …})`:
      // `INVOKE_PARTIAL <name> [<context>] [{kw=val, …}]`. The body lives in
      // the program's partials registry, so no DO branch — single line.
      const ctx = instr.context ? " " + disasmValue(instr.context) : "";
      const entries = Object.entries(instr.hash || {});
      const hash = entries.length
        ? " {" + entries.map(([k, v]) => k + "=" + disasmValue(v)).join(", ") + "}"
        : "";
      return [ind + "INVOKE_PARTIAL " + instr.name + ctx + hash];
    }
    default:
      return [ind + String(instr.t).toUpperCase()];
  }
}

function disasmValue(op) {
  switch (op.t) {
    case "lit":
      return "LIT " + inspectLiteral(op.value);
    case "assign":
      return "ASSIGN " + op.name;
    case "assigns":
      return "ASSIGNS";
    case "local":
      return "LOCAL " + op.name;
    case "this":
      return "THIS";
    case "parent":
      return "PARENT";
    case "root":
      return "ROOT";
    case "index":
      return "INDEX0";
    case "index1":
      return "INDEX1";
    case "key":
      return "KEY";
    case "first":
      return "FIRST";
    case "last":
      return "LAST";
    case "get":
      return "GET " + disasmValue(op.base) + " " + op.segments.join(".");
    case "call": {
      const positional = op.args.map(disasmValue).join(", ");
      const keyword = Object.entries(op.kwargs || {})
        .map(([k, v]) => ", " + k + "=" + disasmValue(v))
        .join("");
      return "CALL " + op.name + "(" + positional + keyword + ")";
    }
    default:
      return String(op.t).toUpperCase();
  }
}

// Mirror Elixir's `inspect/1` for the scalar literals the wire carries: strings
// are double-quoted, `null` prints as `nil`, and numbers/booleans print bare.
function inspectLiteral(value) {
  if (value === null) return "nil";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

// ── ST4 source-text transpiler (Phase 3, JS port for the playground) ─────
//
// Mirrors `Stem.ST4.Transpile` (BEAM) but operates on the AST-wire JSON
// the WASM `parseAst` returns rather than the BEAM tuple AST. The playground
// uses this to render the live "ST4 Preview" pane against the current
// template; it is **not** a security boundary and **not** a full
// implementation of every matrix row (each ❌ row renders as an inline
// `<! transpile-error: ... !>` ST4 comment so the preview is never empty,
// rather than throwing the way the BEAM walker does). For the canonical
// transpiler — used by `mix stem.st4.emit` and the parity gate — see
// `lib/stem/st4/transpile.ex`.

// The Stem `{{! @truthiness: <mode> }}` pragma scanner from the source.
// Returns `"st4"` | `"elixir"` | `"stem"` | null per match. Mirrors the
// BEAM `Stem.Parser.pragmas/1` for the single key the transpiler reads.
export function scanTruthinessPragma(source) {
  let rest = (source || "").replace(/^\s+/, "");
  while (rest.length > 0) {
    let open, close;
    if (rest.startsWith("{{!--")) {
      open = "{{!--"; close = "--}}";
    } else if (rest.startsWith("{{!")) {
      open = "{{!"; close = "}}";
    } else {
      return null;
    }
    rest = rest.slice(open.length);
    const idx = rest.indexOf(close);
    if (idx < 0) return null;
    const body = rest.slice(0, idx).trim();
    rest = rest.slice(idx + close.length).replace(/^\s+/, "");
    const m = body.match(/^@truthiness:\s*(\w+)\s*$/);
    if (m) return m[1];
  }
  return null;
}

// Transpile a Stem AST (the JSON shape `parseAst` returns) to ST4 source
// text. Without partials it produces bare `.st` text; with `partials`
// (a `{name: [...nodes]}` map) it produces a `.stg` group file.
//
// `opts.truthiness` may be `"st4"` (clean emit) or any other string
// (emits a leading comment noting the gate requires `:st4`).
//
// When `opts.map === true`, returns `{output, segments}` instead of a
// bare string. Each segment maps a `[outBegin, outEnd)` character range
// in the emitted output to its originating Stem source span:
//
//   { outBegin, outEnd, file, start, end, kind }
//
// `file` is `"main"` for nodes from the main template and the partial
// name for nodes from a partial AST. `start`/`end` are byte offsets in
// that file's source (matching the AST's `src` shape). `kind` is one of
// `"text"`, `"emit"`, `"if"`, `"each"`, `"partial"`, `"error"`, or
// `"header"` so the playground can colour them per category. Error
// segments cover the `<! transpile-error: ... !>` comment and point at
// the offending node — Click-to-localise wires through these.
export function transpileSt4(nodes, opts = {}, partials = null) {
  const truthiness = opts.truthiness || "stem";
  const map = opts.map === true;
  const state = { out: "", segs: [], file: "main" };

  if (truthiness !== "st4") {
    const msg =
      `<! Stem→ST4 transpile gate: source must declare {{! @truthiness: st4 }} (got "${truthiness}") !>`;
    const begin = state.out.length;
    state.out += msg + "\n";
    state.segs.push({
      outBegin: begin,
      outEnd: state.out.length,
      file: "main",
      start: 0,
      end: 0,
      kind: "error",
    });
  }

  if (partials && Object.keys(partials).length > 0) {
    pushHeader(state, 'delimiters "<", ">"\n\n');
    emitGroupTemplate(state, "main", nodes);
    for (const name of Object.keys(partials).sort()) {
      pushHeader(state, "\n");
      const saved = state.file;
      state.file = name;
      emitGroupTemplate(state, name, partials[name]);
      state.file = saved;
    }
  } else {
    emitNodes(state, nodes, defaultCtx());
  }

  if (map) return { output: state.out, segments: state.segs };
  return state.out;
}

function defaultCtx() {
  return { inEach: false };
}

function pushHeader(state, text) {
  const begin = state.out.length;
  state.out += text;
  state.segs.push({
    outBegin: begin,
    outEnd: state.out.length,
    file: state.file,
    start: 0,
    end: 0,
    kind: "header",
  });
}

function pushText(state, text, src, kind) {
  if (!text) return;
  const begin = state.out.length;
  state.out += text;
  state.segs.push({
    outBegin: begin,
    outEnd: state.out.length,
    file: state.file,
    start: src && typeof src.start === "number" ? src.start : 0,
    end: src && typeof src.end === "number" ? src.end : 0,
    kind: kind || "emit",
  });
}

function pushError(state, message, src) {
  pushText(state, `<! transpile-error: ${message} !>`, src, "error");
}

function emitGroupTemplate(state, name, nodes) {
  const args = deriveArgs(nodes).join(", ");
  pushHeader(state, `${name}(${args}) ::= <<\n`);
  emitNodes(state, nodes, defaultCtx());
  pushHeader(state, `\n>>\n`);
}

function emitNodes(state, nodes, ctx) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) emitNode(state, node, ctx);
}

function emitNode(state, node, ctx) {
  if (!node) return;
  switch (node.t) {
    case "text":
      pushText(state, node.text || "", node.src, "text");
      return;
    case "emit":
      emitExprNode(state, node, ctx);
      return;
    case "if":
      emitIfNode(state, node, ctx, false);
      return;
    case "unless":
      emitIfNode(state, node, ctx, true);
      return;
    case "each":
      emitEachNode(state, node, ctx);
      return;
    case "with":
      pushError(state, "{{#with}} is not supported by ST4", node.src);
      return;
    case "partial":
      emitPartialNode(state, node, ctx);
      return;
    case "yield":
      pushError(state, "{{yield}} is not supported by ST4", node.src);
      return;
    case "region":
      return; // regions are inlined at yield sites; skip in the preview
    case "partial_scope":
      pushError(
        state,
        "partial with rebinding body is not supported by ST4",
        node.src,
      );
      return;
    default:
      return;
  }
}

function emitIfNode(state, node, ctx, negated) {
  const condText = emitValue(node.cond, ctx);
  const body = node.then || [];
  const elseBody = node.else || [];
  const prefix = negated ? "<if(!" : "<if(";
  pushText(state, `${prefix}${condText})>`, node.src, "if");
  emitNodes(state, body, ctx);
  if (elseBody.length > 0) {
    pushText(state, "<else>", node.src, "if");
    emitNodes(state, elseBody, ctx);
  }
  pushText(state, "<endif>", node.src, "if");
}

function emitEachNode(state, node, ctx) {
  const body = node.body || [];
  const elseBody = node.else || [];

  if (elseBody.length > 0) {
    pushError(
      state,
      "{{else}} on {{#each}} is not supported by ST4 — wrap in {{#if}}…{{else}}…{{/if}}",
      node.src,
    );
    return;
  }
  const list = emitValue(node.subject, ctx);

  pushText(state, `<${list}:{ it | `, node.src, "each");
  emitNodes(state, body, { inEach: true });
  pushText(state, "}>", node.src, "each");
}

function emitPartialNode(state, node, ctx) {
  const name = node.name;
  const hash = node.hash || {};
  const ctxArg = node.context;
  const hashKeys = Object.keys(hash);
  let text;

  if (!ctxArg && hashKeys.length === 0) text = `<${name}()>`;
  else if (ctxArg && hashKeys.length === 0) text = `<${name}(${emitValue(ctxArg, ctx)})>`;
  else if (!ctxArg && hashKeys.length > 0) {
    const args = hashKeys.map((k) => `${k}=${emitValue(hash[k], ctx)}`).join(", ");
    text = `<${name}(${args})>`;
  } else {
    pushError(state, "{{> name ctx k=v}} is not supported by ST4", node.src);
    return;
  }
  pushText(state, text, node.src, "partial");
}

function emitExprNode(state, node, ctx) {
  const expr = node.expr;
  const escape = node.escape || "html";
  const src = node.src;

  if (expr && expr.t === "lit") {
    // Top-level literal expressions emit as inline text (matrix row A).
    const v = expr.value;
    if (v === null || v === undefined) return;
    pushText(state, String(v), src, "emit");
    return;
  }
  if (expr && expr.t === "call") {
    emitTransformerCall(state, expr, escape, src, ctx);
    return;
  }
  const base = emitValue(expr, ctx);
  pushText(state, wrapEscape(base, escape), src, "emit");
}

function wrapEscape(base, escape) {
  switch (escape) {
    case "none":
      return `<${base}>`;
    case "html":
    case "default":
      return `<${base}; format="stem.escape.html">`;
    case "json":
      return `<${base}; format="stem.escape.json">`;
    case "uri":
      return `<${base}; format="stem.escape.uri">`;
    default:
      return `<${base}>`;
  }
}

const ST4_TRANSFORMER_MAP = {
  upcase: { option: "format", value: "upper" },
  downcase: { option: "format", value: "lower" },
};

function emitTransformerCall(state, call, _escape, src, ctx) {
  const name = call.name;
  const args = (call.args || []).filter((a) => a.kind === "positional").map((a) => a.value);

  const mapped = ST4_TRANSFORMER_MAP[name];
  if (mapped && args.length === 1) {
    const base = emitAttrBase(args[0], ctx);
    if (base.error) {
      pushError(state, base.error, src);
      return;
    }
    pushText(state, `<${base.value}; ${mapped.option}="${mapped.value}">`, src, "emit");
    return;
  }
  if (name === "default" && args.length === 2 && args[1].t === "lit" && typeof args[1].value === "string") {
    const base = emitAttrBase(args[0], ctx);
    if (base.error) {
      pushError(state, base.error, src);
      return;
    }
    pushText(state, `<${base.value}; null="${escapeSt4String(args[1].value)}">`, src, "emit");
    return;
  }
  if (name === "join" && args.length === 2 && args[1].t === "lit" && typeof args[1].value === "string") {
    const base = emitAttrBase(args[0], ctx);
    if (base.error) {
      pushError(state, base.error, src);
      return;
    }
    pushText(state, `<${base.value}; separator="${escapeSt4String(args[1].value)}">`, src, "emit");
    return;
  }
  pushError(
    state,
    `transformer \`${name}\` has no ST4 equivalent — use upcase / downcase / default / join`,
    src,
  );
}

function emitAttrBase(expr, ctx) {
  if (!expr) return { error: "missing transformer subject" };
  if (expr.t === "identifier") return { value: expr.name };
  if (expr.t === "path") {
    return { value: (expr.segments || []).join(".") };
  }
  if (expr.t === "context" && expr.kind === "this" && ctx.inEach) {
    const segments = expr.path || [];
    return { value: ["it"].concat(segments).join(".") };
  }
  if (expr.t === "call") return { error: "format options do not compose in ST4" };
  return { error: `transformer subject must be a plain attribute reference` };
}

function emitValue(expr, ctx) {
  if (!expr) return "";
  switch (expr.t) {
    case "lit":
      return expr.value === null || expr.value === undefined ? "" : String(expr.value);
    case "identifier":
      return expr.name;
    case "path":
      return (expr.segments || []).join(".");
    case "index":
      return ctx.inEach ? "i0" : "";
    case "index1":
      return ctx.inEach ? "i" : "";
    case "key":
    case "first":
    case "last":
      return `(transpile-error: @${expr.t} has no ST4 analogue)`;
    case "context": {
      const segments = expr.path || [];
      if (expr.kind === "this") {
        if (ctx.inEach) return ["it"].concat(segments).join(".");
        return segments.length === 0 ? "this" : segments.join(".");
      }
      if (expr.kind === "root") return "(transpile-error: @root has no ST4 walk)";
      if (expr.kind === "parent") return "(transpile-error: @parent has no ST4 walk)";
      return segments.join(".");
    }
    case "call":
      return `(transpile-error: nested transformer ${expr.name})`;
    default:
      return "";
  }
}

function st4Comment(msg) {
  return `<! ${msg} !>`;
}

function escapeSt4String(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Conservative argument-list derivation for `.stg` group templates: the
// top-level identifier and attribute names the body references. Mirrors
// `Stem.ST4.Transpile.derive_args/1` (BEAM).
function deriveArgs(nodes) {
  const set = new Set();
  function walkNode(node) {
    if (!node) return;
    switch (node.t) {
      case "emit": walkExpr(node.expr); break;
      case "if":
        walkExpr(node.cond);
        (node.then || []).forEach(walkNode);
        (node.else || []).forEach(walkNode);
        break;
      case "each":
        walkExpr(node.subject);
        (node.body || []).forEach(walkNode);
        break;
      case "partial":
        if (node.context) walkExpr(node.context);
        Object.values(node.hash || {}).forEach(walkExpr);
        break;
      default: break;
    }
  }
  function walkExpr(e) {
    if (!e) return;
    if (e.t === "identifier") set.add(e.name);
    else if (e.t === "path" && (e.segments || []).length > 0) set.add(e.segments[0]);
    else if (e.t === "call") (e.args || []).forEach((a) => walkExpr(a.value));
  }
  (nodes || []).forEach(walkNode);
  return Array.from(set).sort();
}

// ── Share-link state codec ────────────────────────────────────────────────
// The URL fragment carries the whole workspace. We raw-DEFLATE the JSON via the
// browser-native CompressionStream (no dependency — brotli isn't available for
// compression in the browser) and base64url it; a leading "~" tags the
// compressed format. Legacy links (plain base64 of the JSON, no "~") still
// decode, so old shared URLs keep working.
const COMPRESSED_PREFIX = "~";

function bytesToBase64url(bytes) {
  let binary = "";
  const CHUNK = 0x8000; // chunk so String.fromCharCode never overflows the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(b64url) {
  const pad = (4 - (b64url.length % 4)) % 4;
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Push `bytes` through a (De)CompressionStream and collect the result.
async function pipeBytes(bytes, transform) {
  const writer = transform.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buffer = await new Response(transform.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function encodeState(state) {
  const input = new TextEncoder().encode(JSON.stringify(state));
  const deflated = await pipeBytes(input, new CompressionStream("deflate-raw"));
  return COMPRESSED_PREFIX + bytesToBase64url(deflated);
}

export async function decodeState(encoded) {
  if (encoded.startsWith(COMPRESSED_PREFIX)) {
    const deflated = base64urlToBytes(encoded.slice(COMPRESSED_PREFIX.length));
    const inflated = await pipeBytes(deflated, new DecompressionStream("deflate-raw"));
    return JSON.parse(new TextDecoder().decode(inflated));
  }

  // Legacy plain-base64 link (pre-compression).
  if (typeof atob === "function") {
    return JSON.parse(decodeURIComponent(escape(atob(encoded))));
  }
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

// Build the partial dependency graph for the Partials dock panel.
// `asts` maps each file name ("main" plus each partial) to its pre-expansion
// `stem-ast/v1` node list (from the engine's `parse_ast`, which keeps
// `{{> name}}` as `partial` nodes). Returns `{ nodes, edges, cycles }`:
//   - nodes: `{ id, isMain, missing }` (missing = referenced but not defined)
//   - edges: `{ from, to, count, missing, span }` — aggregated by (from, to)
//     so two `{{> row}}` sites in a single template render as one edge with
//     `count: 2` and the SVG painter labels the arrow with the weight; `span`
//     points at the FIRST source span for jump-to-source.
//   - cycles: arrays of node ids forming a cycle. ADR-0014 makes partial
//     recursion legal (the runtime caps invoke depth), so these are
//     informational — the inspector draws them in the accent, not as errors.
export function buildDependencyGraph(asts) {
  const known = new Set(Object.keys(asts));
  const nodes = Object.keys(asts).map((id) => ({ id, isMain: id === "main", missing: false }));
  // Aggregate edges by `${from}\0${to}` so each (from, to) pair appears
  // once, carrying a call count and the first source span we saw.
  const edgeMap = new Map();

  const childLists = (node) => [node.then, node.else, node.body].filter(Array.isArray);
  // A partial invocation is now a `partial` transformer call —
  // `{{partial "name" ...}}` lowers to an `emit` whose expression is a `call`
  // named `partial` with the target name as its first positional literal arg.
  // (Pre-0.6 `{{> name}}` `partial` nodes are still recognised for any AST
  // input that carries them.) A non-literal name (`{{partial expr}}`) can't be
  // resolved statically, so it contributes no edge. Returns the name or null.
  const partialTarget = (node) => {
    if (node.t === "partial") return node.name;
    if (node.t === "emit" && node.expr && node.expr.t === "call" && node.expr.name === "partial") {
      const v = ((node.expr.args || [])[0] || {}).value;
      if (v && v.t === "lit" && typeof v.value === "string") return v.value;
    }
    return null;
  };
  const collect = (nodeList, from) => {
    for (const node of nodeList || []) {
      const target = partialTarget(node);
      if (target != null) {
        const key = from + "\0" + target;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          edgeMap.set(key, {
            from,
            to: target,
            count: 1,
            missing: !known.has(target),
            span: node.src || null,
          });
        }
      }
      for (const list of childLists(node)) collect(list, from);
    }
  };
  for (const [id, ast] of Object.entries(asts)) collect(ast, id);

  const edges = Array.from(edgeMap.values());

  // Surface referenced-but-undefined partials as their own (missing) nodes.
  for (const edge of edges) {
    if (!known.has(edge.to) && !nodes.some((n) => n.id === edge.to)) {
      nodes.push({ id: edge.to, isMain: false, missing: true });
    }
  }

  return { nodes, edges, cycles: findCycles(nodes, edges) };
}

// Flatten a `stem-ast/v1` node list (from `parse_ast`) into an indented outline
// for the AST inspector tab: `[{ depth, text, start?, end? }]`, where start/end
// are the node's byte span (when present) so a row click can highlight the
// originating source. Expressions render in their written form.
export function astOutline(nodes) {
  const out = [];
  const exprLabel = (e) => {
    if (!e || typeof e !== "object") return String(e);
    switch (e.t) {
      case "identifier": return e.name;
      case "path": return e.segments.join(".");
      case "context": return "@" + e.kind + (e.path && e.path.length ? "." + e.path.join(".") : "");
      case "index": return "@index";
      case "index1": return "@index1";
      case "key": return "@key";
      case "first": return "@first";
      case "last": return "@last";
      case "lit": return JSON.stringify(e.value);
      case "call": return `${e.name}(${(e.args || []).map((a) => exprLabel(a.value)).join(", ")})`;
      case "pipeline": return exprLabel(e.lhs) + (e.stages || []).map((s) => ` | ${s.name}`).join("");
      default: return e.t || "?";
    }
  };
  const span = (n) =>
    n.src && typeof n.src.start === "number" ? { start: n.src.start, end: n.src.end } : {};
  const row = (depth, text, n) => out.push({ depth, text, ...span(n) });
  const branch = (depth, label, list) => {
    if (list && list.length) {
      out.push({ depth, text: label });
      walk(list, depth + 1);
    }
  };
  // Single-line preview of a text run: collapse whitespace so escape sequences
  // (`\n`, tabs, indent runs) don't eat the visible budget, then cap. The full
  // text rides along on the row (`full`) for a hover tooltip; the row's
  // click-to-source reveals the rest in the editor.
  const preview = (text) => {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > 64 ? flat.slice(0, 64) + "…" : flat;
  };

  function walk(list, depth) {
    for (const n of list || []) {
      switch (n.t) {
        case "text": out.push({ depth, text: `text ${JSON.stringify(preview(n.text))}`, full: n.text, ...span(n) }); break;
        case "emit": row(depth, `emit ${exprLabel(n.expr)}${n.escape === "none" ? " (raw)" : ""}`, n); break;
        case "if":
        case "unless":
          row(depth, `${n.t} ${exprLabel(n.cond)}`, n);
          walk(n.then, depth + 1);
          branch(depth, "else", n.else);
          break;
        case "each":
        case "with":
          row(depth, `${n.t} ${exprLabel(n.subject)}`, n);
          walk(n.body, depth + 1);
          branch(depth, "else", n.else);
          break;
        case "region": row(depth, `region ${n.name}`, n); walk(n.body, depth + 1); break;
        case "yield": row(depth, `yield ${n.name}`, n); break;
        case "partial": row(depth, `partial > ${n.name}`, n); break;
        case "partial_scope": row(depth, "partial-scope", n); walk(n.body, depth + 1); break;
        default: row(depth, n.t || "?", n);
      }
    }
  }
  walk(nodes, 0);
  return out;
}

// ── Diagnostic analyses (Dock panels #1, #2, #4, #5, #7) ──────────────────
//
// All run on the pre-expansion AST returned by the engine's `parse_ast`, so
// they share its byte-span provenance (`n.src`) for jump-to-source. No render
// step is needed — these are static analyses that classify what the template
// *would* touch given the data.

// Walk every AST node in `nodes` (depth-first, with `file` carried through) and
// invoke `fn(node, file)` for each. The optional `recurse` predicate runs after
// `fn`; default is to recurse into children unless `fn` returned `false`.
function walkAst(nodes, file, fn) {
  for (const node of nodes || []) {
    if (fn(node, file) === false) continue;
    if (Array.isArray(node.then)) walkAst(node.then, file, fn);
    if (Array.isArray(node.else)) walkAst(node.else, file, fn);
    if (Array.isArray(node.body)) walkAst(node.body, file, fn);
  }
}

// Resolve a dot-separated path against a JSON-like value (objects, arrays).
// Returns `{ status, value }` where status is:
//   - "hit"          path resolved to a defined non-undefined value
//   - "miss"         a segment was missing on an object, or array OOB
//   - "type-mismatch" a non-container segment was indexed (e.g. .x on a string)
//   - "oob"          array index out of bounds
// `value` carries the resolved leaf (or `undefined`) so the panel can show it.
function resolvePath(data, segments) {
  let cur = data;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return { status: "miss", value: undefined };
    if (Array.isArray(cur)) {
      const i = /^-?\d+$/.test(seg) ? Number(seg) : null;
      if (i === null) return { status: "type-mismatch", value: undefined };
      const j = i < 0 ? cur.length + i : i;
      if (j < 0 || j >= cur.length) return { status: "oob", value: undefined };
      cur = cur[j];
      continue;
    }
    if (typeof cur !== "object") return { status: "type-mismatch", value: undefined };
    if (!(seg in cur)) return { status: "miss", value: undefined };
    cur = cur[seg];
  }
  if (cur === undefined) return { status: "miss", value: undefined };
  return { status: "hit", value: cur };
}

// Collect every data lookup an emit/cond expression makes. Each entry is
// `{ file, start, end, path, status, value }`. Subexpressions inside `call`
// argument trees and `pipeline` LHS are walked too. Context vars (@this, etc.)
// and locals (loop block params) are not classified — they reflect the runtime
// scope, not the data dictionary.
//
// Best-effort static: when a path sits inside a loop body or partial scope,
// the resolver is run against the top-level data (the loop subject's element
// type is not known here), so the panel labels those as "scoped" not "miss".
export function analyseDataAccess(astsByFile, data, locals = new Set()) {
  const out = [];
  const lookup = (file, node, segments, scoped) => {
    if (segments.length === 0) return;
    const headLocal = locals.has(segments[0]);
    const res = scoped || headLocal
      ? { status: "scoped", value: undefined }
      : resolvePath(data, segments);
    const src = node.src || {};
    out.push({
      file,
      start: typeof src.start === "number" ? src.start : null,
      end: typeof src.end === "number" ? src.end : null,
      path: segments.join("."),
      status: res.status,
      value: res.value,
    });
  };
  const walkExpr = (expr, file, host, scoped) => {
    if (!expr || typeof expr !== "object") return;
    switch (expr.t) {
      case "identifier":
        lookup(file, host, [expr.name], scoped); break;
      case "path":
        lookup(file, host, expr.segments, scoped); break;
      case "get":
        // get { base, segments } — only classify when the base is a plain root
        // (identifier/path). Anything else is a runtime computation.
        if (expr.base && (expr.base.t === "identifier" || expr.base.t === "path")) {
          const head = expr.base.t === "identifier" ? [expr.base.name] : expr.base.segments;
          lookup(file, host, head.concat(expr.segments || []), scoped);
        }
        break;
      case "call":
        for (const arg of expr.args || []) walkExpr(arg.value, file, host, scoped);
        for (const kv of Object.values(expr.kwargs || {})) walkExpr(kv, file, host, scoped);
        break;
      case "pipeline":
        walkExpr(expr.lhs, file, host, scoped);
        for (const stage of expr.stages || []) {
          for (const arg of stage.args || []) walkExpr(arg.value, file, host, scoped);
        }
        break;
    }
  };
  const walkNodes = (nodes, file, scoped) => {
    for (const n of nodes || []) {
      switch (n.t) {
        case "emit": walkExpr(n.expr, file, n, scoped); break;
        case "if":
        case "unless":
          walkExpr(n.cond, file, n, scoped);
          walkNodes(n.then, file, scoped); walkNodes(n.else, file, scoped);
          break;
        case "each":
        case "with":
          walkExpr(n.subject, file, n, scoped);
          // Inside the body, the subject's elements rebind the scope — any
          // bare identifier could be a field on the element. Mark scoped.
          walkNodes(n.body, file, true); walkNodes(n.else, file, scoped);
          break;
        case "partial":
          // `{{> name ctx kw=expr ...}}` — the optional context and every
          // keyword-arg value are expressions evaluated against the caller's
          // scope, so their lookups against the data dictionary are
          // classifiable. The partial's body itself is parsed separately
          // (and walked through `astsByFile[name]`).
          if (n.context) walkExpr(n.context, file, n, scoped);
          for (const kv of Object.values(n.hash || {})) walkExpr(kv, file, n, scoped);
          break;
        case "scope":
        case "partial_scope":
          walkNodes(n.body, file, true); break;
      }
    }
  };
  for (const [file, ast] of Object.entries(astsByFile || {})) walkNodes(ast, file, false);
  return out;
}

// Find every whitespace-trim marker in `source`. Returns
// `[{ file, start, end, kind, line, col, desc? }]` where kind is:
//   - "leading"   — `{{~ … }}` explicit pre-tag trim
//   - "trailing"  — `{{ … ~}}` explicit post-tag trim
//   - "standalone" — a line whose only contents are one or more block, partial,
//                    or comment tags (ADR-0016: line is stripped in full,
//                    including the indent and the trailing newline). Inline
//                    emit tags `{{name}}` and raw `{{{name}}}` never trigger
//                    standalone stripping; a tag carrying an explicit `~`
//                    is also excluded — its own explicit trim is reported
//                    separately as leading/trailing.
export function analyseWhitespace(source, file) {
  const out = [];
  const re = /\{\{(~?)[^}]*?(~?)\}\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const tag = m[0];
    if (m[1] === "~") {
      const off = m.index;
      out.push({ file, start: off, end: off + 3, kind: "leading", line: 0, col: 0 });
    }
    if (m[2] === "~") {
      const off = m.index + tag.length - 3;
      out.push({ file, start: off, end: off + 3, kind: "trailing", line: 0, col: 0 });
    }
  }
  // Standalone-tag lines (the rule that fires by default and surprises users).
  // A line qualifies when every tag on it is a block/partial/comment AND the
  // line has no other non-whitespace text. Compose with leading/trailing
  // markers above by deduplicating on (line, file).
  let lineStart = 0, lineNo = 1;
  for (let i = 0; i <= source.length; i++) {
    if (i === source.length || source[i] === "\n") {
      const line = source.slice(lineStart, i);
      const desc = standaloneDescription(line);
      if (desc) {
        out.push({
          file, start: lineStart, end: i, kind: "standalone",
          line: lineNo, col: 1, desc,
        });
      }
      lineStart = i + 1; lineNo++;
    }
  }
  for (const r of out) {
    if (r.line) continue; // standalone rows already carry line/col
    const { line, column } = charToLineColumn(source.slice(0, r.start) + " ", r.start);
    r.line = line; r.col = column;
  }
  return out;
}

// Whether `line` (no terminating newline) is a standalone-tag line per ADR-0016
// and, if so, a short description of which tag kind triggered it. Returns null
// when the line has any non-whitespace, non-block-tag text (an inline `{{name}}`
// emit, raw HTML, or a trailing word).
function standaloneDescription(line) {
  let cursor = 0;
  let kind = null;
  while (cursor < line.length) {
    // Eat leading whitespace.
    while (cursor < line.length && /[ \t]/.test(line[cursor])) cursor++;
    if (cursor >= line.length) break;
    if (line[cursor] !== "{") return null; // bare text on the line
    // A `{{{…}}}` triple-stash raw emit is NOT a standalone tag.
    if (line.startsWith("{{{", cursor)) return null;
    if (!line.startsWith("{{", cursor)) return null;
    // Find the matching close. Quote-aware not needed for the kinds we accept,
    // since block/partial/comment heads don't carry string literals on the
    // standalone line (`{{> name "x"}}` is rare enough to ignore).
    const close = line.indexOf("}}", cursor + 2);
    if (close === -1) return null;
    const inner = line.slice(cursor + 2, close);
    const trimmed = inner.replace(/^~/, "").replace(/~$/, "").trim();
    let here = null;
    if (trimmed.startsWith("#")) here = "block open";
    else if (trimmed.startsWith("/")) here = "block close";
    else if (/^else(\s+if\b|$)/.test(trimmed)) here = "else";
    else if (trimmed.startsWith(">")) here = "partial";
    else if (trimmed.startsWith("!")) here = "comment";
    else return null; // inline emit or expression — not a standalone line
    kind = kind ? "mixed" : here;
    cursor = close + 2;
  }
  return kind;
}

// Every transformer call site (callable name + its source span). Walks emit
// expressions plus arg subtrees and pipeline stages. Returns
// `[{ name, file, start, end }]` in source order.
export function analyseCalls(astsByFile) {
  const out = [];
  const fromCall = (call, file, host) => {
    out.push({
      name: call.name,
      file,
      start: host.src && typeof host.src.start === "number" ? host.src.start : null,
      end: host.src && typeof host.src.end === "number" ? host.src.end : null,
    });
    for (const arg of call.args || []) walkExpr(arg.value, file, host);
    for (const kv of Object.values(call.kwargs || {})) walkExpr(kv, file, host);
  };
  const walkExpr = (expr, file, host) => {
    if (!expr || typeof expr !== "object") return;
    if (expr.t === "call") fromCall(expr, file, host);
    else if (expr.t === "pipeline") {
      walkExpr(expr.lhs, file, host);
      for (const stage of expr.stages || []) {
        out.push({
          name: stage.name, file,
          start: host.src && typeof host.src.start === "number" ? host.src.start : null,
          end: host.src && typeof host.src.end === "number" ? host.src.end : null,
        });
        for (const arg of stage.args || []) walkExpr(arg.value, file, host);
      }
    } else if (expr.t === "get") walkExpr(expr.base, file, host);
  };
  const walkNodes = (nodes, file) => {
    for (const n of nodes || []) {
      if (n.t === "emit") walkExpr(n.expr, file, n);
      else if (n.t === "if" || n.t === "unless") { walkExpr(n.cond, file, n); walkNodes(n.then, file); walkNodes(n.else, file); }
      else if (n.t === "each" || n.t === "with") { walkExpr(n.subject, file, n); walkNodes(n.body, file); walkNodes(n.else, file); }
      else if (n.t === "partial") {
        // Partial-tag context + hash-arg expressions live in the caller's
        // scope; calls inside them count toward the caller's allow-list.
        if (n.context) walkExpr(n.context, file, n);
        for (const kv of Object.values(n.hash || {})) walkExpr(kv, file, n);
      }
      else if (n.t === "scope" || n.t === "partial_scope") walkNodes(n.body, file);
    }
  };
  for (const [file, ast] of Object.entries(astsByFile || {})) walkNodes(ast, file);
  return out;
}

// Count emit nodes by their escape mode. Returns `{ html, plain, raw, total }`.
// `raw` is `{{{…}}}` triple-stash (escape="none"). Helps users see at a glance
// how much of their output is rendered with escape elision.
export function analyseEscapeRuns(astsByFile) {
  const c = { html: 0, plain: 0, raw: 0, total: 0 };
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.t === "emit") {
        c.total++;
        if (n.escape === "none") c.raw++;
        else if (n.escape === "html") c.html++;
        else c.plain++;
      }
      if (Array.isArray(n.then)) walk(n.then);
      if (Array.isArray(n.else)) walk(n.else);
      if (Array.isArray(n.body)) walk(n.body);
    }
  };
  for (const ast of Object.values(astsByFile || {})) walk(ast);
  return c;
}

// Best-effort static coverage: for every `if`/`unless`/`each`/`with` block,
// classify whether it would execute against `data`. Loop bodies report their
// iteration count. Bodies inside another non-executed parent inherit "skipped".
//
// Truthiness mirrors Stem's rules (ADR-0011/ADR-0014 scope): null/false/empty
// string/empty list/empty map are falsy; everything else is truthy. Conditions
// on context vars or computed expressions are reported as "unknown" — they
// cannot be evaluated without rendering.
// Per-engine truthiness for the Coverage analysis (ADR-0020 Phase 4). Stem:
// null/false/""/0/[]/{} are all falsy. Handlebars `{{#if c}}` is
// `!c || Utils.isEmpty(c)`, so null/false/""/0 and EMPTY ARRAYS are falsy too —
// the ONE divergence is the empty object `{}`, which is FALSY in Stem but
// TRUTHY in Handlebars (a non-empty JS object that isn't an empty array).
export function stemTruthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (v === "" || v === 0) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}
export function handlebarsTruthy(v) {
  if (!v) return false; // 0, "", null, false, undefined, NaN
  if (Array.isArray(v)) return v.length > 0; // empty array is falsy
  return true; // {} (empty object) is truthy — the only divergence from Stem
}

// `truthy` is the engine's truthiness predicate (defaults to Stem's). The host
// injects `handlebarsTruthy` when the Handlebars adapter is active so the dead-
// branch classification matches what that engine actually renders.
export function analyseCoverage(astsByFile, data, { truthy = stemTruthy } = {}) {
  const out = [];
  const exprValue = (expr, scoped) => {
    if (scoped) return { known: false };
    if (!expr || typeof expr !== "object") return { known: false };
    if (expr.t === "lit") return { known: true, value: expr.value };
    if (expr.t === "identifier") {
      const r = resolvePath(data, [expr.name]);
      return r.status === "hit" ? { known: true, value: r.value } : { known: r.status === "miss", value: undefined };
    }
    if (expr.t === "path") {
      const r = resolvePath(data, expr.segments);
      return r.status === "hit" ? { known: true, value: r.value } : { known: r.status === "miss", value: undefined };
    }
    return { known: false };
  };
  const span = (n) => ({
    file: null, // set by caller
    start: n.src && typeof n.src.start === "number" ? n.src.start : null,
    end: n.src && typeof n.src.end === "number" ? n.src.end : null,
  });
  const walk = (nodes, file, scoped, dead) => {
    for (const n of nodes || []) {
      if (n.t === "if" || n.t === "unless") {
        const ev = exprValue(n.cond, scoped);
        let executed, label;
        if (dead) { executed = false; label = "skipped (parent)"; }
        else if (!ev.known) { executed = true; label = "unknown — depends on runtime scope"; }
        else {
          const t = truthy(ev.value);
          const want = n.t === "if" ? t : !t;
          executed = want;
          label = want ? (n.t === "if" ? "truthy" : "falsy") : (n.t === "if" ? "falsy → else" : "truthy → else");
        }
        const s = span(n); s.file = file;
        out.push({ kind: n.t, ...s, executed, count: executed ? 1 : 0, label });
        walk(n.then, file, scoped, dead || !executed);
        // Else branch executes when the main branch didn't.
        if (n.else && n.else.length) {
          const elseExec = dead ? false : (!ev.known ? true : !executed);
          walk(n.else, file, scoped, !elseExec);
        }
      } else if (n.t === "each" || n.t === "with") {
        const ev = exprValue(n.subject, scoped);
        let executed, count, label;
        if (dead) { executed = false; count = 0; label = "skipped (parent)"; }
        else if (!ev.known) { executed = true; count = null; label = "unknown — depends on runtime scope"; }
        else if (n.t === "each") {
          const v = ev.value;
          count = Array.isArray(v) ? v.length : (v && typeof v === "object" ? Object.keys(v).length : 0);
          executed = count > 0;
          label = `${count} iteration${count === 1 ? "" : "s"}`;
        } else {
          executed = truthy(ev.value);
          count = executed ? 1 : 0;
          label = executed ? "scope entered" : "scope skipped (falsy)";
        }
        const s = span(n); s.file = file;
        out.push({ kind: n.t, ...s, executed, count, label });
        walk(n.body, file, true, dead || !executed); // children scoped
        if (n.else && n.else.length) walk(n.else, file, scoped, !dead && executed);
      } else if (n.t === "scope" || n.t === "partial_scope") {
        walk(n.body, file, true, dead);
      }
    }
  };
  for (const [file, ast] of Object.entries(astsByFile || {})) walk(ast, file, false, false);
  return out;
}

// Depth-first back-edge search over the (non-missing) inclusion edges.
function findCycles(nodes, edges) {
  const adjacency = new Map();
  for (const edge of edges) {
    if (edge.missing) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }

  const cycles = [];
  const path = [];
  const inPath = new Set();
  const seen = new Set();

  const visit = (id) => {
    if (inPath.has(id)) {
      cycles.push(path.slice(path.indexOf(id)).concat(id));
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    path.push(id);
    inPath.add(id);
    for (const next of adjacency.get(id) || []) visit(next);
    path.pop();
    inPath.delete(id);
  };

  for (const node of nodes) visit(node.id);
  return cycles;
}

// ── Cheat-sheet data builder ───────────────────────────────────────────────
//
// Populates the `transformers` array for every group in `data.main_groups`
// and `data.narrow_groups` using the engine's live `catalog` (the array
// returned by `renderer.catalog()`).  This eliminates the need to keep a
// hand-written transformer list in `data.yaml` and ensures the cheat sheet
// stays in sync whenever a transformer is added or modified.
//
// Each group object in the YAML may carry three control fields that are
// consumed here and remain on the returned group (templates ignore unknown
// fields):
//
//   `categories` (string[]) — which catalog categories to include, in the
//     order they appear in the catalog.
//
//   `overrides` (object) — per-transformer-name patch applied on top of the
//     catalog entry.  If the value is an *array*, each element produces a
//     separate row for that transformer (useful for `lookup` which covers
//     both map-key and list-index forms).
//
//   `entries` (array) — completely manual rows appended *after* the catalog
//     rows (used for the escape group which has no catalog entries).
//
// The returned row shape matches what `row.stem` expects:
//   { name, arity, desc, example, result, cap }
//
export function buildCheatSheetData(data, catalog) {
  function buildGroup(group) {
    const { categories = [], overrides = {}, entries = [] } = group;
    const transformers = [];

    // 1. Catalog entries for the requested categories, preserving catalog order.
    for (const entry of catalog) {
      if (!categories.includes(entry.category)) continue;
      const override = overrides[entry.name];
      if (Array.isArray(override)) {
        // Multiple rows for one transformer (e.g. lookup: map form + list form).
        for (const ov of override) {
          transformers.push({
            name: entry.name,
            arity: entry.arity,
            desc: ov.desc ?? entry.summary,
            example: ov.example ?? entry.example,
            result: ov.result ?? null,
            cap: ov.cap ?? false,
          });
        }
      } else {
        transformers.push({
          name: entry.name,
          arity: entry.arity,
          desc: override?.desc ?? entry.summary,
          example: override?.example ?? entry.example,
          result: override?.result ?? null,
          cap: override?.cap ?? false,
        });
      }
    }

    // 2. Manually specified rows (e.g. escape-backslash rules).
    for (const e of entries) {
      transformers.push({ cap: false, result: null, ...e });
    }

    return { ...group, transformers };
  }

  return {
    ...data,
    main_groups: (data.main_groups ?? []).map(buildGroup),
    narrow_groups: (data.narrow_groups ?? []).map(buildGroup),
  };
}

// ── Data overlays (multi-tab data composition) ────────────────────────────
//
// The playground can have more than one data tab. A tab named `a/b/c` mounts
// its parsed YAML at the `a → b → c` path inside the merged data tree;
// every overlay is applied on top of `main` (the `data.yaml` tab) in array
// order, and the renderer sees one merged object before JSONata runs.
//
// Conflict semantics — extras-win deep merge:
//   * Two objects at the same path → merged key-by-key (recursive).
//   * Scalar vs scalar / array vs array / object vs object on a leaf →
//     last write wins (the overlay overrides).
//   * Object vs scalar / scalar vs object (a *type clash*) is the actually-
//     confusing case: kept as the overlay's value, with a clash row added
//     to the returned `clashes` list so the host can surface a Problems
//     diagnostic.
//
// Tab-name validation lives in `validateOverlayName` — every segment must
// match `[A-Za-z_][A-Za-z0-9_]*` so a tab can't be named `1st` or
// `users.active` (which would collide with Stem's dotted-path syntax).

// Regex for one path segment. Exported via OVERLAY_NAME_RE for tests / UI.
export const OVERLAY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*$/;

// Validate an overlay tab name. Returns `null` if valid, or a short
// human-readable message describing the first problem.
export function validateOverlayName(name) {
  if (typeof name !== "string" || name.length === 0) return "name is required";
  if (name === "main" || name === "data" || name === "transform") {
    return `"${name}" is reserved`;
  }
  if (!OVERLAY_NAME_RE.test(name)) {
    return "use identifiers separated by `/` — letters, digits, underscore; no leading digit";
  }
  return null;
}

// Plain-object check that treats null and arrays as non-objects.
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Deep-merge `dst` and `src` in place, recording type clashes against
// `pathPrefix` into `clashes`. Returns `dst`. Object-vs-object recurses;
// everything else replaces (last write wins).
function deepMergeInto(dst, src, pathPrefix, clashes) {
  if (!isPlainObject(src)) return src; // caller handles non-object src
  for (const [k, sv] of Object.entries(src)) {
    const childPath = pathPrefix.concat(k);
    const dv = dst[k];
    if (isPlainObject(dv) && isPlainObject(sv)) {
      deepMergeInto(dv, sv, childPath, clashes);
    } else if (dv !== undefined && typeKindOf(dv) !== typeKindOf(sv)) {
      clashes.push({ path: childPath.join("."), was: typeKindOf(dv), now: typeKindOf(sv) });
      dst[k] = sv;
    } else {
      dst[k] = sv;
    }
  }
  return dst;
}

// Coarse "kind" label for a value — used to classify a type clash without
// over-reporting (a string overriding a string is not a clash; an object
// overriding a string is).
function typeKindOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (isPlainObject(v)) return "object";
  return typeof v; // "string" | "number" | "boolean" | "undefined"
}

// Build the merged data tree from `mainValue` (the parsed `data.yaml`) and
// an ordered list of overlay tabs `[{ name, value }]`, where `value` is the
// parsed YAML of that tab and `name` is its slash-path. Returns
// `{ merged, clashes }` — `clashes` is an array of `{ path, was, now }`
// records for every object-vs-scalar collision encountered.
//
// `mainValue` may be any YAML value; if it's not a plain object, the merge
// degrades to "extras win" without crashing — but that's an unusual workspace.
// Each overlay's parsed value is wrapped at its tab path before merging:
// an overlay `users/active` containing `[{name:"ada"}]` becomes
// `{ users: { active: [{name:"ada"}] } }`.
export function mergeDataOverlays(mainValue, overlays) {
  const clashes = [];
  const merged = isPlainObject(mainValue)
    ? structuredClone(mainValue)
    : (mainValue === undefined ? {} : mainValue);

  // If main isn't a plain object, overlays can't compose with it cleanly.
  // Surface the situation as a clash on the root and treat merged as `{}`.
  let target = merged;
  if (!isPlainObject(target)) {
    clashes.push({ path: "", was: typeKindOf(target), now: "object" });
    target = {};
  }

  for (const { name, value } of overlays) {
    if (typeof name !== "string" || name.length === 0) continue;
    const wrapped = wrapAtPath(name.split("/"), value);
    deepMergeInto(target, wrapped, [], clashes);
  }

  // If `target` had to be replaced because main wasn't an object, return the
  // overlay-only tree as the merged result.
  return { merged: isPlainObject(merged) ? merged : target, clashes };
}

// `wrapAtPath(["a","b","c"], v)` → `{ a: { b: { c: v } } }`.
function wrapAtPath(segments, value) {
  let acc = value;
  for (let i = segments.length - 1; i >= 0; i--) acc = { [segments[i]]: acc };
  return acc;
}
