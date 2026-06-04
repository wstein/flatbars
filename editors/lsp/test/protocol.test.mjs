// SPDX-License-Identifier: Apache-2.0
//
// Protocol-level smoke test for `flatbars-lsp`: spawn the real stdio server and
// drive it over JSON-RPC — initialize -> didOpen -> semanticTokens/full — then
// assert the decoded tokens. This is the honest "the server actually speaks LSP"
// check; the pure encoding is covered in tokens.test.mjs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as rpcNs from "vscode-jsonrpc/node";

const rpc = rpcNs.default ?? rpcNs;
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "..", "bin", "flatbars-lsp.mjs");

const child = spawn(process.execPath, [bin], { stdio: ["pipe", "pipe", "inherit"] });
const conn = rpc.createMessageConnection(
  new rpc.StreamMessageReader(child.stdout),
  new rpc.StreamMessageWriter(child.stdin),
);
conn.listen();

try {
  const init = await conn.sendRequest("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    initializationOptions: { defaultDialect: "fullbars" },
  });

  const provider = init.capabilities.semanticTokensProvider;
  assert.ok(provider, "server advertises a semantic-tokens provider");
  assert.equal(provider.full, true, "supports semanticTokens/full");
  assert.ok(
    provider.legend.tokenTypes.includes("variable") && provider.legend.tokenTypes.includes("operator"),
    "legend carries the vocabulary's token types",
  );
  assert.equal(init.capabilities.hoverProvider, true, "server advertises a hover provider");
  assert.ok(init.capabilities.completionProvider, "server advertises a completion provider");
  assert.ok(init.capabilities.codeActionProvider, "server advertises a code-action provider");

  // Capture pushed diagnostics, keyed by uri.
  const diagWaiters = new Map();
  const waitDiagnostics = (uri) =>
    new Promise((resolve) => diagWaiters.set(uri, resolve));
  conn.onNotification("textDocument/publishDiagnostics", (p) => {
    const resolve = diagWaiters.get(p.uri);
    if (resolve) {
      diagWaiters.delete(p.uri);
      resolve(p.diagnostics);
    }
  });

  await conn.sendNotification("initialized", {});

  // languageId drives the dialect: open as `maxbars` so `??` is an operator and the
  // template is valid (no diagnostics).
  const uri = "file:///test/page.flatbars";
  const maxDiags = waitDiagnostics(uri);
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "maxbars", version: 1, text: '{{ a ?? "b" }}' },
  });

  const result = await conn.sendRequest("textDocument/semanticTokens/full", {
    textDocument: { uri },
  });

  // Sparse semantic tokens (corrections only): the `??` operator and the "b"
  // string are emitted; the expr tag is left to the grammar. languageId 'maxbars'
  // is what makes `??` an operator at all. Decode + assert SEMANTICALLY so
  // additive painters (a future helper-name highlight, etc.) can land without
  // breaking this with opaque numeric diffs — the previous exact-length
  // assertion (`data.length === 2 * 5`) was brittle.
  const text = '{{ a ?? "b" }}';
  const decoded = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i < result.data.length; i += 5) {
    const [dL, dC, len, type] = result.data.slice(i, i + 5);
    line += dL;
    char = dL === 0 ? char + dC : dC;
    decoded.push({ type: provider.legend.tokenTypes[type], slice: text.slice(char, char + len) });
  }
  assert.ok(
    decoded.some((t) => t.type === "operator" && t.slice === "??"),
    "languageId 'maxbars' resolved → `??` is an operator span",
  );
  assert.ok(
    decoded.some((t) => t.type === "string" && t.slice === '"b"'),
    "the `\"b\"` string literal is emitted as a string span",
  );
  assert.deepEqual(await maxDiags, [], "valid MaxBars publishes no diagnostics");

  // A FullBars doc with `{{#if a == 1}}` → one parse diagnostic (ADR-023): the same
  // dialect resolution that makes `==` valid in MaxBars makes it an error here.
  const badUri = "file:///test/bad.fullbars";
  const badDiags = waitDiagnostics(badUri);
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri: badUri, languageId: "fullbars", version: 1, text: "{{#if a == 1}}x{{/if}}" },
  });
  const ds = await badDiags;
  assert.equal(ds.length, 1, "one parse diagnostic");
  assert.match(ds[0].message, /unexpected token/i);
  assert.equal(ds[0].severity, 1, "Error severity");
  assert.equal(ds[0].range.start.line, 0, "diagnostic on line 0");

  // Hover + completion (ADR-017) over a FullBars doc with a real operation head.
  // Position is computed from the source so a cosmetic edit doesn't break the test.
  const hovUri = "file:///test/hov.fullbars";
  const hovText = "{{uppercase name}}";
  const hovTarget = hovText.indexOf("uppercase");
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri: hovUri, languageId: "fullbars", version: 1, text: hovText },
  });
  const hover = await conn.sendRequest("textDocument/hover", {
    textDocument: { uri: hovUri },
    position: { line: 0, character: hovTarget + 2 },
  });
  assert.ok(hover && hover.contents, "hover returned for an operation under the cursor");
  assert.match(hover.contents.value, /uppercase/, "hover names the operation");
  assert.match(hover.contents.value, /inline operation/, "hover states the ADR-019 kind");
  assert.match(hover.contents.value, /Uppercases its argument\./, "hover includes the prelude prose doc");

  // Hover off any operation (in surrounding text) → null.
  const noHover = await conn.sendRequest("textDocument/hover", {
    textDocument: { uri: hovUri },
    position: { line: 0, character: 0 },
  });
  assert.equal(noHover, null, "no hover outside a tag");

  // Completion inside the tag offers operations (and excludes deprecated aliases).
  const items = await conn.sendRequest("textDocument/completion", {
    textDocument: { uri: hovUri },
    position: { line: 0, character: hovTarget + 2 },
  });
  const labels = (Array.isArray(items) ? items : items.items).map((i) => i.label);
  assert.ok(labels.includes("each") && labels.includes("uppercase"), "completion offers prelude operations");
  assert.ok(!labels.includes("downcase"), "completion excludes deprecated aliases");

  // Code action: a RawBars doc with the non-canonical `index` offers a one-click
  // rewrite to `index0`. Positions are computed from the source so the test stays
  // robust under cosmetic edits to the fixture.
  const caUri = "file:///test/loop.rawbars";
  const caText = "{{{index}}}";
  const caTarget = caText.indexOf("index");
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri: caUri, languageId: "rawbars", version: 1, text: caText },
  });
  const actions = await conn.sendRequest("textDocument/codeAction", {
    textDocument: { uri: caUri },
    range: { start: { line: 0, character: caTarget + 1 }, end: { line: 0, character: caTarget + 1 } },
    context: { diagnostics: [] },
  });
  assert.equal(actions.length, 1, "one code action offered for `index`");
  assert.match(actions[0].title, /index.*index0/, "titled the rewrite");
  const edit = actions[0].edit.changes[caUri][0];
  assert.equal(edit.newText, "index0", "edit replaces with the canonical name");
  assert.equal(caText.slice(edit.range.start.character, edit.range.end.character), "index", "edit range covers exactly `index`");

  // ── new capabilities (ADR-026): folding, document symbols, formatting ──────
  const capUri = "file:///test/cap.fullbars";
  const capText = "<ul>\n{{#each items}}\n  <li>{{this}}</li>\n{{/each}}\n</ul>\n";
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri: capUri, languageId: "fullbars", version: 1, text: capText },
  });
  const folds = await conn.sendRequest("textDocument/foldingRange", { textDocument: { uri: capUri } });
  assert.equal(folds.length, 1, "one fold for the each block");
  assert.equal(folds[0].startLine, 1, "fold starts at {{#each}}");
  assert.equal(folds[0].endLine, 3, "fold ends at {{/each}}");
  const symbols = await conn.sendRequest("textDocument/documentSymbol", { textDocument: { uri: capUri } });
  assert.equal(symbols.length, 1, "one top-level symbol");
  assert.equal(symbols[0].name, "#each", "the each block surfaces as a symbol");
  // Formatter — request edits for a messy version of the same template.
  const messyUri = "file:///test/messy.fullbars";
  const messyText = "{{   name   }}\n{{#each  items  }}\n{{/each}}\n";
  await conn.sendNotification("textDocument/didOpen", {
    textDocument: { uri: messyUri, languageId: "fullbars", version: 1, text: messyText },
  });
  const fmtEdits = await conn.sendRequest("textDocument/formatting", {
    textDocument: { uri: messyUri },
    options: { tabSize: 2, insertSpaces: true },
  });
  assert.ok(Array.isArray(fmtEdits) && fmtEdits.length >= 2, "formatter returns edits for whitespace-irregular tags");
  for (const edit of fmtEdits) {
    assert.ok(typeof edit.newText === "string");
    assert.ok(typeof edit.range.start.character === "number");
  }

  await conn.sendRequest("shutdown");
  await conn.sendNotification("exit");
  console.log("✓ flatbars-lsp protocol smoke test passed (semantic tokens + diagnostics + hover + completion + code-action)");
} finally {
  conn.dispose();
  child.kill();
}
