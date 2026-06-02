// SPDX-License-Identifier: Apache-2.0
//
// Main-thread handle to the custom-helper Worker (ADR-018). `createHelperSandbox`
// spins up `helpers-worker.mjs` as a module Worker and exposes an async
// `render(req)` that correlates replies by id. The Worker is created lazily (no
// cost until a workspace actually uses helpers) and can be disposed.
//
// Browser-only (it constructs a `Worker`); the heavy logic — building the bag and
// rendering — lives in the Worker's `runHelperRequest`, which is unit-tested in
// Node. This wrapper is intentionally thin.

export function createHelperSandbox(workerUrl) {
  let worker = null;
  let nextId = 1;
  const pending = new Map();

  function settleAll(res) {
    for (const { resolve } of pending.values()) resolve(res);
    pending.clear();
  }

  function ensure() {
    if (worker) return;
    worker = new Worker(workerUrl, { type: "module" });
    worker.onmessage = (e) => {
      const { id, res } = e.data || {};
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        p.resolve(res);
      }
    };
    // A worker-level failure (e.g. the bundle failed to import) rejects every
    // in-flight request with a render error rather than hanging.
    worker.onerror = (e) => {
      settleAll({ ok: false, value: "", error: "helper worker failed: " + ((e && e.message) || "error") });
      try { worker.terminate(); } catch { /* ignore */ }
      worker = null;
    };
  }

  return {
    // Render `{ template, data, partials, helperSrc }` in the Worker →
    // Promise<{ ok, value, error }>. Never rejects (errors come back in the result).
    render(req) {
      ensure();
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, { resolve });
        worker.postMessage({ id, req });
      });
    },
    dispose() {
      if (worker) {
        try { worker.terminate(); } catch { /* ignore */ }
        worker = null;
      }
      settleAll({ ok: false, value: "", error: "helper sandbox disposed" });
    },
  };
}
