// SPDX-License-Identifier: Apache-2.0
//
// FileProvider — the Lab's file-access seam (Phase 0 extraction; the Phase 3 seam
// from PLAN-registry-local-trussbars.md). Today every example/catalog/fixture read
// funnels through `fetch`; routing them through a provider interface is what lets a
// later transport (the File System Access API, or the `trussbars lab` localhost FS
// bridge) drop in without touching the loaders.
//
//   FileProvider = { id, capabilities:Set, readText(path), readJson(path) }
//
// `httpFileProvider` is the hosted default. It is deliberately behaviour-identical
// to the Lab's previous inline calls: readText mirrors the raw
// `fetch(url).then(r => r.text())` (returns the body regardless of status, so a
// missing optional partial yields its 404 body exactly as before); readJson mirrors
// the old `fetchJson` (a non-OK response — a 404 HTML page — is an error).

export function httpFileProvider() {
  return {
    id: "http",
    capabilities: new Set(["read"]),
    readText: (path) => fetch(path).then((r) => r.text()),
    readJson: (path) => fetch(path).then((res) => {
      if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
      return res.json();
    }),
  };
}
