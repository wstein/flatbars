// SPDX-License-Identifier: Apache-2.0
//
// FileProvider — the Lab's file-access seam (Phase 0 extraction; the Phase 3 seam
// from PLAN-registry-local-trussbars.md). Today every example/catalog/fixture read
// funnels through `fetch`; routing them through a provider interface is what lets a
// later transport (the File System Access API, or the `trussbars lab` localhost FS
// bridge) drop in without touching the loaders.
//
//   FileProvider = {
//     id, capabilities:Set<"read"|"list"|"watch"|"write">,
//     readText(path): Promise<string>,
//     readJson(path): Promise<any>,
//     list?(dir): Promise<Array<{name, kind:"file"|"dir"}>>,   // gated on "list"
//   }
//
// Two real implementations land here (Phase 3 — extract the interface from two
// working impls, don't speculate it): `http` (the hosted default) and `fs-access`
// (the browser File System Access API). The `local` localhost transport is Phase 5.

// `httpFileProvider` is the hosted default. It is deliberately behaviour-identical
// to the Lab's previous inline calls: readText mirrors the raw
// `fetch(url).then(r => r.text())` (returns the body regardless of status, so a
// missing optional partial yields its 404 body exactly as before); readJson mirrors
// the old `fetchJson` (a non-OK response — a 404 HTML page — is an error). It has no
// `list` (static HTTP can't enumerate a directory), so its capabilities omit it.
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

// Is the File System Access API available (Chromium-family browsers)? The Lab gates
// the "Open Folder" affordance on this — on Firefox/Safari it stays hidden.
export function supportsFsAccess() {
  return typeof globalThis.showDirectoryPicker === "function";
}

// Walk a "/"-joined relative path from a root FileSystemDirectoryHandle to the
// handle for its last segment. `kind:"dir"` returns the directory handle; otherwise
// the file handle. Leading "./" and empty segments are ignored; ".." is rejected
// (the picker root is the jail — no escaping it, mirroring the server's root-jail).
async function resolveHandle(root, path, kind) {
  const segs = String(path).split("/").filter((s) => s && s !== ".");
  if (segs.some((s) => s === "..")) throw new Error(`path escapes the folder: ${path}`);
  let dir = root;
  const last = kind === "dir" ? segs.length : segs.length - 1;
  for (let i = 0; i < last; i++) dir = await dir.getDirectoryHandle(segs[i]);
  if (kind === "dir") return dir;
  return dir.getFileHandle(segs[segs.length - 1]);
}

// `fsAccessFileProvider` reads + lists a folder the user picked via
// `showDirectoryPicker()`. Read-only (writes are a later opt-in); paths are jailed to
// the picked root by `resolveHandle`. `list` enumerates a directory's entries — the
// capability the http provider lacks, which is why it is a distinct transport.
export function fsAccessFileProvider(rootHandle) {
  if (!rootHandle || typeof rootHandle.getDirectoryHandle !== "function") {
    throw new TypeError("fsAccessFileProvider needs a FileSystemDirectoryHandle");
  }
  const readText = async (path) => {
    const fh = await resolveHandle(rootHandle, path, "file");
    const file = await fh.getFile();
    return file.text();
  };
  return {
    id: "fs-access",
    root: rootHandle.name,
    capabilities: new Set(["read", "list"]),
    readText,
    readJson: async (path) => JSON.parse(await readText(path)),
    list: async (dir = ".") => {
      const dh = await resolveHandle(rootHandle, dir, "dir");
      const out = [];
      for await (const [name, handle] of dh.entries()) {
        out.push({ name, kind: handle.kind === "directory" ? "dir" : "file" });
      }
      out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
      return out;
    },
  };
}

// Prompt the user to pick a folder and return an `fs-access` provider over it. The
// `showDirectoryPicker()` call must run inside a user gesture (e.g. a button click).
// Throws a clear, actionable error on unsupported browsers so the caller can fall
// back to the http transport.
export async function pickDirectory(opts) {
  if (!supportsFsAccess()) {
    throw new Error("This browser has no File System Access API — open the Lab in a Chromium-family browser to open a folder.");
  }
  const handle = await globalThis.showDirectoryPicker(opts);
  return fsAccessFileProvider(handle);
}
