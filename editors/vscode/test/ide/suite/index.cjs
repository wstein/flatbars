// SPDX-License-Identifier: Apache-2.0
//
// The in-host half of the real-IDE test (ADR-017, blocker 1). VS Code's test
// runner loads this inside the Extension Host and calls run(). Unlike the smoke
// test — which spawns the server over a pipe — this exercises the WHOLE path: the
// extension auto-activates on opening a FlatBars document (VS Code generates the
// onLanguage events from contributes.languages since 1.74), the language client
// starts the bundled server, and we assert that the LSP ceiling actually surfaces
// in the editor: semantic tokens AND a published diagnostic. This is the gap the
// offline smoke test cannot cover.
const assert = require("node:assert");
const path = require("node:path");
const vscode = require("vscode");

// Poll until `fn` returns a truthy value or the timeout elapses. LSP results
// arrive asynchronously after activation, so a fixed sleep would be flaky.
async function waitFor(fn, { timeout = 20000, interval = 100 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
}

exports.run = async function run() {
  // `{{ a ?? "b" }}` → an `operator` + a `string` semantic token; `{{#if x}}`
  // (unclosed) → a MismatchedBlock diagnostic. The `.maxbars` extension picks the
  // MaxBars dialect via the auto-generated language association.
  const fixture = path.resolve(__dirname, "..", "fixtures", "activation.maxbars");
  const doc = await vscode.workspace.openTextDocument(fixture);
  await vscode.window.showTextDocument(doc);
  assert.equal(doc.languageId, "maxbars", "the .maxbars extension resolves to the maxbars language");

  // Activation must be automatic — no command, no explicit activationEvents.
  const ext = vscode.extensions.getExtension("flatbars.flatbars");
  assert.ok(ext, "the flatbars extension is present");
  const activated = await waitFor(() => ext.isActive || null);
  assert.ok(activated, "the extension auto-activated on opening a FlatBars document");

  // 1. The LSP ceiling: semantic tokens reach the editor through the client.
  const tokens = await waitFor(async () => {
    const t = await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokens", doc.uri);
    return t && t.data && t.data.length ? t : null;
  });
  assert.ok(tokens, "semantic tokens were produced for the document");
  // Five uint32s per token; the operator + string make at least two.
  assert.ok(tokens.data.length >= 10, `expected >= 2 semantic tokens, got ${tokens.data.length / 5}`);

  // 2. The diagnostics layer (recovering parser → publishDiagnostics).
  const diags = await waitFor(() => {
    const d = vscode.languages.getDiagnostics(doc.uri);
    return d && d.length ? d : null;
  });
  assert.ok(diags && diags.length >= 1, "at least one diagnostic was published");
  assert.equal(diags[0].source, "flatbars", "the diagnostic comes from the flatbars server");

  console.log(`✓ real-IDE: auto-activated, ${tokens.data.length / 5} semantic tokens, ${diags.length} diagnostic(s)`);
};
