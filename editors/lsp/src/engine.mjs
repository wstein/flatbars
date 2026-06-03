// SPDX-License-Identifier: Apache-2.0
//
// The engine seam (ADR-017): `flatbars-lsp` highlights by RUNNING the engine
// lexer, never by approximating it — so it embeds the committed `flatbars-js`
// bundle, the same product the Lab and the tutorials load. This one module is the
// only place the bundle path appears; packaging the server (e.g. into the VS Code
// .vsix) copies the bundle alongside and rewrites this re-export, leaving the rest
// of the server path-agnostic.
export { tokenize } from "../../../lab/vendor/flatbars-engine.mjs";
