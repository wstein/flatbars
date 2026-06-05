// SPDX-License-Identifier: Apache-2.0
//
// One Localize example card — a thin wrapper over OpenInLab that feeds it the ONE
// shared catalog (catalog-store) instead of a per-card copy. A `t`-using template
// reads the shared catalog (so edits at the top flow straight in); a pure
// formatting cell (number/date/…) passes "" — it needs the native-Intl bag, not
// the messages, so a catalog typo up top can't break it. Either way the card shows
// no catalog pane: the catalog lives once, at the top of the page.
import OpenInLab from "./OpenInLab.jsx";
import { useCatalog } from "../lib/catalog-store.mjs";

export default function I18nCard({ template, ...props }) {
  const shared = useCatalog();
  const usesT = /\bt\s+["']/.test(template || "");
  return <OpenInLab {...props} template={template} sharedCatalog catalog={usesT ? shared : ""} />;
}
