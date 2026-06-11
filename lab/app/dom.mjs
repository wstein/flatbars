// SPDX-License-Identifier: Apache-2.0
//
// DOM lookup helpers — the two one-liners the index.html app used everywhere,
// extracted so the app modules share one import (Phase 0 of the engine-registry
// plan). Intentionally trivial; they exist only to give the extracted modules a
// single canonical `byId`/`qs` rather than re-declaring them per module.

export const byId = (id) => document.getElementById(id);
export const qs = (sel) => document.querySelector(sel);
