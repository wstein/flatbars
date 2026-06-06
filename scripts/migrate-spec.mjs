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

// ── Main transform ───────────────────────────────────────────────────────────
export function convert(adoc) {
  const lines = adoc.replace(/\r\n/g, "\n").split("\n");
  const warnings = [];
  const out = [];
  const fm = { title: null, navtitle: null };

  let i = 0;
  let inFence = false; // inside a converted ``` code fence

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
      let text = finishInline(h[2], warnings);
      out.push("#".repeat(level) + " " + text + (anchor ? ` {#${anchor}}` : ""));
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

    // Ordinary body line.
    out.push(finishInline(line, warnings));
    i++;
  }

  const frontmatter = renderFrontmatter(fm);
  const body = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return { frontmatter, body, warnings };
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
  s = substituteAttributes(s);
  s = unwrapPass(s);
  s = escapeProseMdx(s);
  return s;
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
