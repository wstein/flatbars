// SPDX-License-Identifier: Apache-2.0
//
// A tiny cross-island store for the ONE shared i18n message catalog the Localize
// page shows at the top (CatalogReference) and every example card reads (I18nCard).
// Astro hydrates each card as its own island, but they all import this module —
// a singleton in the browser — so a module-level value + a pub/sub set gives them
// shared, reactive state with no signals dependency: editing the top catalog
// re-renders every card that uses `t`.
import { useState, useEffect } from "preact/hooks";
import { flagshipCatalogYaml } from "../i18n.mjs";

// The full catalog (every key, every locale) as the editable starting point.
export const initialCatalog = flagshipCatalogYaml;
let value = initialCatalog;
const subs = new Set();

export function getCatalog() { return value; }
export function setCatalog(v) { value = v; subs.forEach((fn) => fn(v)); }
export function resetCatalog() { setCatalog(initialCatalog); }

// Subscribe a component to the shared catalog: returns the current YAML and
// re-renders the caller on every edit from any island.
export function useCatalog() {
  const [v, setV] = useState(value);
  useEffect(() => {
    subs.add(setV);
    setV(value); // sync if it changed between first render and this effect
    return () => subs.delete(setV);
  }, []);
  return v;
}
