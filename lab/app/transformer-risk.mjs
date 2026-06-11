// SPDX-License-Identifier: Apache-2.0
//
// Risk taxonomy for built-in transformers (ADR-0013), extracted from index.html
// (Phase 0). Mirrors the cheat-sheet groups and colours each call site:
//   default   — always on, no opt-in cost
//   format    — low risk (atomic string transforms)
//   transform — medium (full-collection traversals, audited)
//   eval      — dynamic template rendering (data-scope disclosure risk)
// Any built-in missing here falls back to the "host" tier at render time.
//
// Single source for both the Capabilities dock panel and the dock badge counts in
// index.html, so the two can't drift.
export const TRANSFORMER_RISK = {
  // default group — always on, no opt-in
  escape_html: "default", escape_json: "default", json: "default", inspect: "default",
  default: "default", join: "default", log: "default", at: "default", slice: "default",
  first: "default", last: "default", take: "default", drop: "default", len: "default",
  lookup: "default", contains: "default", starts_with: "default", ends_with: "default",
  empty: "default", present: "default",
  // format group — low risk
  upcase: "format", downcase: "format", capitalize: "format", trim: "format",
  truncate: "format", replace: "format",
  // transform group — medium, audited
  split: "transform", reverse: "transform", sort: "transform", sort_by: "transform",
  map: "transform", filter: "transform", compact: "transform", uniq: "transform",
  flatten: "transform", group_by: "transform",
  // i18n group — low risk (delegates to host translator)
  t: "format", translate: "format",
  // constructors — always on (same tier as minimum)
  list: "default", dict: "default",
  // arithmetic · comparison · boolean logic (Stem.Transformers.Logic) — pure scalar
  // ops, no host access; part of the always-on minimum floor.
  add: "default", sub: "default", mul: "default", div: "default", mod: "default",
  eq: "default", ne: "default", lt: "default", lte: "default", gt: "default", gte: "default",
  and: "default", or: "default", not: "default",
  // eval — dynamic, opt-in only
  eval: "eval",
};
