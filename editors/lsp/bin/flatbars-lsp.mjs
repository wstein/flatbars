#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// The `flatbars-lsp` stdio entry point. Editors (VS Code, JetBrains, Neovim, …)
// spawn this and speak LSP over stdin/stdout.
import { createConnection } from "vscode-languageserver/node.js";
import { startServer } from "../src/server.mjs";

startServer(createConnection(process.stdin, process.stdout));
