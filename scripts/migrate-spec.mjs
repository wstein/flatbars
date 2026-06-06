#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// AsciiDoc → MDX converter for the FlatBars spec migration (ADR-031). Targets the
// constructs the 46 spec pages actually use — headings, block/inline admonitions,
// source & listing blocks, xref cross-references, the defined Antora attributes,
// and (critically) MDX brace/angle safety — rather than being a general AsciiDoc
// parser. Pure and testable: `convert()` is a string→{frontmatter,body,warnings}
// function; the CLI at the bottom does file I/O.
//
//   node scripts/migrate-spec.mjs <in.adoc> [out.mdx]   # convert one file
//
// The bulk run (all 46 pages) lives in the Phase-4 driver; this module is the
// transform it calls, covered by scripts/migrate-spec.test.mjs.

import { readFileSync, writeFileSync } from "node:fs";

// ── Route map ───────────────────────────────────────────────────────────────
// filename (sans .adoc) → site route under /spec. xref targets resolve through
// this, so a link survives the move out of Antora's flat page namespace. ADRs
// (any `adr-*` filename) route generically to /adr/<slug>/ in resolveXref.
export const ROUTE = {
  index: "/",
  concepts: "/concepts/",
  lexical: "/spec/lexical/",
  grammar: "/spec/grammar/",
  evaluation: "/spec/evaluation/",
  errors: "/spec/errors/",
  surface: "/engine/surface/",
  prelude: "/engine/prelude/",
  "host-api": "/engine/host-api/",
  directives: "/engine/directives/",
  "fullbars-compat": "/engine/fullbars-compat/",
  maxbars: "/engine/maxbars/",
  "appendix-handlebars": "/appendix/handlebars/",
};

// The site route for a spec page filename (sans .adoc), or null if unknown.
export function routeFor(page) {
  if (Object.prototype.hasOwnProperty.call(ROUTE, page)) return ROUTE[page];
  if (/^adr-/.test(page)) return `/adr/${page}/`;
  return null;
}

// Defined Antora attributes (docs/antora.yml). Only these substitute; everything
// else of the form {x} is a FlatBars template tag and must NOT be touched here.
const ATTRS = {
  hbs: "Handlebars",
  hb: "Handlebars.js",
  "project-name": "FlatBars",
  tagline: "bare rods — a template-engine construction kit",
};

const ADMONITION = {
  NOTE: { open: ":::note", close: ":::" },
  TIP: { open: ":::tip", close: ":::" },
  IMPORTANT: { open: ":::note[Important]", close: ":::" },
  CAUTION: { open: ":::caution", close: ":::" },
  WARNING: { open: ":::caution[Warning]", close: ":::" },
};

// ── MDX safety ───────────────────────────────────────────────────────────────
// In prose, `{` starts an MDX expression and `<` starts JSX — both must be
// neutralised. Inside an inline-code span (backticks) they are already literal,
// so only the out-of-code segments (even indices of a backtick split) are escaped.
export function escapeProseMdx(line) {
  return line
    .split("`")
    .map((seg, i) =>
      i % 2 === 0
        ? seg.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;").replace(/</g, "&lt;")
        : seg,
    )
    .join("`");
}

// Resolve a single xref target (`page.adoc#anchor` or `#anchor` or `section-id`)
// to a site URL. Unknown pages return null so the caller can warn instead of
// emitting a dead link.
export function resolveXref(target) {
  const m = target.match(/^([a-z0-9-]+)\.adoc(#[a-zA-Z0-9-_]+)?$/);
  if (m) {
    const route = routeFor(m[1]);
    if (!route) return null;
    return route + (m[2] || "");
  }
  if (target.startsWith("#")) return target; // same-page anchor
  if (/^[a-zA-Z0-9-_]+$/.test(target)) return "#" + target; // bare section id
  return null;
}

// Replace every xref macro on a line. `[]` (empty caption) falls back to the
// anchor or page name as link text.
function convertXrefs(line, warnings) {
  return line.replace(/xref:([^[\]]+)\[([^\]]*)\]/g, (_, target, caption) => {
    const url = resolveXref(target.trim());
    if (!url) {
      warnings.push(`unresolved xref target: ${target}`);
      return caption || target;
    }
    const text = caption || target.replace(/\.adoc.*$/, "").replace(/^#/, "");
    return `[${text}](${url})`;
  });
}

function substituteAttributes(line) {
  return line.replace(/\{([a-z][a-z0-9-]*)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(ATTRS, name) ? ATTRS[name] : whole,
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────
// Split a line on top-level `|`, respecting inline code spans (a `|` inside
// backticks — e.g. the `|>` pipe operator — does not split) and escaped `\|`.
// Returns every segment, including the one before the first `|` (which a table
// continuation line appends to the previous cell).
function topLevelSplit(line) {
  const segs = [];
  let buf = "";
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "`") {
      inCode = !inCode;
      buf += ch;
    } else if (ch === "\\" && line[i + 1] === "|") {
      buf += "|";
      i++;
    } else if (ch === "|" && !inCode) {
      segs.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  segs.push(buf);
  return segs;
}

// One AsciiDoc table line → its cells (the leading pre-`|` segment dropped).
export function splitCells(line) {
  const segs = topLevelSplit(line).map((c) => c.trim());
  if (segs.length && segs[0] === "") segs.shift();
  return segs;
}

// Parse an AsciiDoc table (`|===` … `|===`) starting at `start` (the opening
// delimiter) into a GitHub-flavoured Markdown table. `cols` is the column count
// from a `[cols=…]` attribute (or null → inferred from the first row); `header`
// is whether the first row is a header row.
function parseTable(lines, start, cols, header, warnings) {
  let i = start + 1;
  const cells = [];
  let firstRowCount = 0;
  while (i < lines.length && lines[i].trim() !== "|===") {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const segs = topLevelSplit(line).map((s) => s.trim());
    if (/^\s*\|/.test(line)) {
      const row = segs.slice(1); // drop the empty pre-`|` segment
      if (firstRowCount === 0) firstRowCount = row.length;
      for (const c of row) cells.push(c);
    } else {
      // Continuation: the pre-`|` text extends the previous cell; any further
      // segments on the line are new cells.
      if (cells.length && segs[0] !== "") cells[cells.length - 1] += " " + segs[0];
      for (const c of segs.slice(1)) cells.push(c);
    }
    i++;
  }
  const next = i + 1; // past the closing |===
  const colCount = cols || firstRowCount || 1;
  if (cells.length % colCount !== 0) {
    warnings.push(`table cell count ${cells.length} not a multiple of ${colCount} columns`);
  }
  const cell = (t) => pipeEscape(finishInline(t, warnings));
  const rows = [];
  for (let k = 0; k < cells.length; k += colCount) rows.push(cells.slice(k, k + colCount));
  const head = header && rows.length ? rows.shift() : new Array(colCount).fill("");
  const linesOut = [
    "| " + head.map(cell).join(" | ") + " |",
    "| " + new Array(colCount).fill("---").join(" | ") + " |",
    ...rows.map((r) => "| " + r.map(cell).join(" | ") + " |"),
  ];
  return { gfm: linesOut.join("\n"), next };
}

// A `|` inside a Markdown table cell must be escaped or it splits the column.
function pipeEscape(s) {
  return s.replace(/\|/g, "\\|");
}

// ── Main transform ───────────────────────────────────────────────────────────
export function convert(adoc) {
  const lines = adoc.replace(/\r\n/g, "\n").split("\n");
  const warnings = [];
  const out = [];
  const fm = { title: null, navtitle: null };

  let i = 0;
  let inFence = false; // inside a converted ``` code fence
  let needsCatalog = false; // page includes the generated helper-catalog partial

  const isAdmoLabel = (l) => {
    const m = l.match(/^\[(NOTE|TIP|IMPORTANT|CAUTION|WARNING)\]$/);
    return m ? m[1] : null;
  };

  while (i < lines.length) {
    let line = lines[i];

    // Inside a code fence: pass content verbatim (MDX-exempt), watch for close.
    if (inFence) {
      if (line === "----" || line === "....") {
        out.push("```");
        inFence = false;
      } else {
        out.push(line);
      }
      i++;
      continue;
    }

    // Document title → frontmatter (first `= Title` only).
    if (fm.title === null) {
      const t = line.match(/^= (.+)$/);
      if (t) {
        fm.title = t[1].trim();
        i++;
        continue;
      }
    }
    // :navtitle: → sidebar label.
    const nav = line.match(/^:navtitle:\s*(.+)$/);
    if (nav) {
      fm.navtitle = nav[1].trim();
      i++;
      continue;
    }
    // Drop other document attribute entries (`:name: value`) and the `:toc:`-likes.
    if (/^:[a-zA-Z][\w-]*!?:\s*.*$/.test(line) && fm.title !== null && out.length === 0) {
      i++;
      continue;
    }

    // The one include directive in the corpus: the generated helper catalog. The
    // driver injects the import; here we drop in the component where it appeared.
    if (/^include::partial\$helper-catalog\.adoc\[\]$/.test(line)) {
      needsCatalog = true;
      out.push("<HelperCatalog />");
      i++;
      continue;
    }
    if (/^include::/.test(line)) {
      warnings.push(`unhandled include: ${line}`);
      i++;
      continue;
    }

    // Source block: `[source,lang]` then `----`. Open a fenced block with lang.
    const src = line.match(/^\[source(?:,\s*([a-zA-Z0-9_-]+))?\]$/);
    if (src && (lines[i + 1] === "----" || lines[i + 1] === "....")) {
      out.push("```" + (src[1] || ""));
      inFence = true;
      i += 2; // skip the `[source]` and the opening delimiter
      continue;
    }
    // Bare listing block `----` with no [source] → plain fence.
    if (line === "----" || line === "....") {
      out.push("```");
      inFence = true;
      i++;
      continue;
    }

    // Table: an optional `[cols=…,options="header"]` then `|===` … `|===`.
    const tableAttr = line.match(/^\[(cols=|%|\.)[^\]]*\]$/);
    if (tableAttr && (lines[i + 1] || "").trim() === "|===") {
      const colsM = line.match(/cols="([^"]+)"/);
      const colCount = colsM ? colsM[1].split(",").length : null;
      const header = /header/.test(line);
      const t = parseTable(lines, i + 1, colCount, header, warnings);
      out.push(t.gfm);
      i = t.next;
      continue;
    }
    if (line.trim() === "|===") {
      const t = parseTable(lines, i, null, false, warnings);
      out.push(t.gfm);
      i = t.next;
      continue;
    }

    // Headings: `==`..`====` → `##`..`####`, honouring a preceding `[#id]`/`[[id]]`.
    let anchor = null;
    const anchorM = line.match(/^\[(?:#|\[)([a-zA-Z0-9-_]+)\]?\]?$/);
    if (anchorM && /^={2,5} /.test(lines[i + 1] || "")) {
      anchor = anchorM[1];
      i++;
      line = lines[i];
    }
    const h = line.match(/^(={2,5}) (.+)$/);
    if (h) {
      const level = h[1].length; // 2..5 → ##..#####
      const text = finishInline(h[2], warnings);
      // MDX rejects `{#id}` heading syntax (`{` starts an expression), so an
      // explicit AsciiDoc anchor becomes a raw anchor element before the heading;
      // the heading itself stays pure markdown and Starlight auto-slugs it.
      if (anchor) {
        out.push(`<a id="${anchor}"></a>`);
        out.push("");
      }
      out.push("#".repeat(level) + " " + text);
      i++;
      continue;
    }

    // Inline admonition: `NOTE: text` → an aside.
    const inlineAd = line.match(/^(NOTE|TIP|IMPORTANT|CAUTION|WARNING): (.+)$/);
    if (inlineAd) {
      const a = ADMONITION[inlineAd[1]];
      out.push(a.open);
      out.push(finishInline(inlineAd[2], warnings));
      out.push(a.close);
      i++;
      continue;
    }
    // Block admonition: `[NOTE]` then either `====`…`====` or one paragraph.
    const label = isAdmoLabel(line);
    if (label) {
      const a = ADMONITION[label];
      out.push(a.open);
      i++;
      if (lines[i] === "====") {
        i++; // skip opening delimiter
        while (i < lines.length && lines[i] !== "====") {
          out.push(convertBodyLine(lines[i], warnings));
          i++;
        }
        i++; // skip closing delimiter
      } else {
        // Applies to the following paragraph (until a blank line).
        while (i < lines.length && lines[i].trim() !== "") {
          out.push(finishInline(lines[i], warnings));
          i++;
        }
      }
      out.push(a.close);
      continue;
    }

    // Description-list item `term:: definition` → a bold-term bullet. Runs only
    // outside code fences (so PureScript `::` type signatures are never touched);
    // the term keeps its own markup if it already has any (avoids double emphasis).
    const dl = line.match(/^(\S[^:]*?):: (\S.*)$/);
    if (dl) {
      const term = finishInline(dl[1], warnings);
      const def = finishInline(dl[2], warnings);
      const t = /[*`_[\]<]/.test(term) ? term : `**${term}**`;
      out.push(`- ${t} — ${def}`);
      i++;
      continue;
    }

    // Unhandled block-attribute line ([.lead], [horizontal], [plantuml,…]): drop
    // the directive (its block, if any, falls through as a plain fence/paragraph).
    if (/^\[[^\]]+\]$/.test(line)) {
      if (/^\[plantuml/.test(line)) {
        warnings.push("plantuml block dropped to a code fence — convert to Mermaid (ADR-031 follow-up)");
      }
      i++;
      continue;
    }

    // Ordinary body line.
    out.push(finishInline(line, warnings));
    i++;
  }

  const frontmatter = renderFrontmatter(fm);
  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return { frontmatter, body, warnings, needsCatalog };
}

// A body line inside a delimited admonition may itself open a fence; keep the
// fence state coherent by delegating to the same primitives.
function convertBodyLine(line, warnings) {
  if (line === "----" || line === "....") return "```";
  return finishInline(line, warnings);
}

// Inline transforms applied to every prose line, in order: xref → link,
// attribute substitution, then MDX brace/angle escaping (last, so generated
// links and substituted text are escaped too). AsciiDoc `\{` literal-brace
// escapes are unwrapped first so the escaper sees the real braces.
function finishInline(line, warnings) {
  let s = line.replace(/\\\{/g, "{");
  s = convertXrefs(s, warnings);
  s = convertInternalRefs(s);
  s = substituteAttributes(s);
  s = unwrapPass(s);
  s = escapeProseMdx(s);
  s = convertInlineAnchors(s); // last: emits raw <a> that must survive escaping
  return s;
}

// AsciiDoc inline anchor `[[id]]` → a raw anchor element (`<a id>` is a valid
// fragment target the link validator accepts). Run after MDX escaping so the
// emitted `<a>` is not turned into `&lt;a>`.
export function convertInlineAnchors(s) {
  return s.replace(/\[\[([a-zA-Z][a-zA-Z0-9-_]*)\]\]/g, '<a id="$1"></a>');
}

// AsciiDoc same-page cross-reference shorthand `<<id>>` / `<<id,text>>` → a
// markdown anchor link. Run before MDX escaping so the `<<` is not turned into
// `&lt;&lt;`.
export function convertInternalRefs(s) {
  return s.replace(/<<([a-z][a-z0-9-]*)(?:,([^>]+))?>>/g, (_, id, text) => `[${text || id}](#${id})`);
}

// AsciiDoc `pass:[…]` (and `pass:c[…]`) render their content verbatim — the
// corpus uses it to show literal `{{…}}` template tags in prose. Unwrap to the
// inner content; escapeProseMdx (run after) then entity-escapes it in prose or
// leaves it literal inside a code span, so MDX stays happy either way.
export function unwrapPass(s) {
  return s.replace(/pass:c?\[([^\]]*)\]/g, "$1");
}

function renderFrontmatter(fm) {
  const lines = ["---"];
  lines.push(`title: ${yaml(fm.title || "Untitled")}`);
  if (fm.navtitle && fm.navtitle !== fm.title) {
    lines.push("sidebar:");
    lines.push(`  label: ${yaml(fm.navtitle)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function yaml(s) {
  return /[:#"'{}[\]&*!|>%@`]/.test(s) ? JSON.stringify(s) : s;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [, , inPath, outPath] = process.argv;
  if (!inPath) {
    console.error("usage: node scripts/migrate-spec.mjs <in.adoc> [out.mdx]");
    process.exit(2);
  }
  const { frontmatter, body, warnings } = convert(readFileSync(inPath, "utf8"));
  const mdx = frontmatter + "\n\n" + body;
  if (outPath) {
    writeFileSync(outPath, mdx);
    console.log(`wrote ${outPath}`);
  } else {
    process.stdout.write(mdx);
  }
  for (const w of warnings) console.error(`warn: ${w}`);
}
