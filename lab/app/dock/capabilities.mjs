// SPDX-License-Identifier: Apache-2.0
//
// Dock Panel #5 — Capabilities / escape provenance. Migrated from index.html
// (Phase 0, ctx form). The security profile is per-engine (ADR-0020): an engine
// without `stem-allow-list` (e.g. Handlebars) renders its own compile-time
// profile; a Stem-family engine renders its render-time host policy (allow-list,
// eval gate, escape modes). The emit-escape mix and the iframe+CSP sandbox are the
// engine-agnostic floor shown for both.
//
// Pure DOM build — no callbacks. All deps arrive in one options object:
//   escapeRuns      — lastEscapeRuns { html, plain, raw, total } (or null)
//   usedTransformers— lastUsedTransformers (names called this run)
//   stemAllowList   — engineHas("stem-allow-list") (selects the profile branch)
//   engineMeta      — { version, builtins, bcVersion }
//   escapeMode, standalone, allowList — the current render policy

import { makeEl } from "../dom.mjs?v=24f57cfe";
import { TRANSFORMER_RISK } from "../transformer-risk.mjs?v=c55054b4";

export function renderCapabilities(body, { escapeRuns, usedTransformers, stemAllowList, engineMeta, escapeMode, standalone, allowList }) {
  const section = makeEl("div", { class: "cp-section" });
  const policy = makeEl("div", { class: "cp-policy" });
  const pol = (label, value, cls) => {
    policy.append(makeEl("div", { class: `cp-policy-row ${cls || ""}` }, [
      makeEl("span", { class: "cp-policy-k" }, label),
      makeEl("span", { class: "cp-policy-v" }, value),
    ]));
  };

  // Engine-agnostic emit-escape mix, appended at the end for both engines.
  const escapeMix = (withTagHint) => {
    const er = escapeRuns || { html: 0, plain: 0, raw: 0, total: 0 };
    const tail = withTagHint ? " (`{{{…}}}`)" : "";
    const emit = makeEl("div", { class: "cp-emit" }, [
      makeEl("strong", {}, "Emit nodes by escape mode:"),
      makeEl("span", { class: "cp-emit-row" },
        `${er.total} emits — ${er.html} html · ${er.plain} plain · ${er.raw} raw${tail}`),
    ]);
    if (er.raw > 0) {
      emit.append(makeEl("div", { class: "cp-warn" },
        `⚠ ${er.raw} raw emit${er.raw === 1 ? "" : "s"} skip escape entirely — verify these emit pre-escaped content.`));
    }
    return emit;
  };

  // ── Handlebars security profile ────────────────────────────────────
  if (!stemAllowList) {
    section.append(makeEl("div", { class: "cp-head" }, [
      makeEl("strong", {}, "Capabilities & escape"),
      " — Handlebars security profile",
    ]));
    pol("Engine", `Handlebars ${engineMeta.version} · ${engineMeta.builtins.length} helpers`, "ok");
    pol("HTML escaping", "ON by default (global) — {{ }} escapes; {{{ }}} / SafeString emit raw", "ok");
    pol("Per-context escaping", "not available — Handlebars escapes HTML only (no JSON/URL/XML modes)", "warn");
    pol("Helper whitelist", "knownHelpers / knownHelpersOnly available at compile time — not enforced in this preview", "ok");
    pol("Prototype-access hardening", "ON by default — Handlebars ≥4.6 blocks access to prototype properties/methods (allowProtoProperties/allowProtoMethods off)", "ok");
    pol("Eval", "N/A on this engine — Handlebars has no dynamic-eval helper", "");
    pol("Sandbox", "rendered output runs in the same-origin iframe + CSP boundary (engine-agnostic floor)", "ok");
    section.append(policy);
    section.append(escapeMix(false));
    body.append(section);
    return;
  }

  // ── Stem host policy (ADR-0013) ────────────────────────────────────
  const tierCounts = { default: 0, format: 0, transform: 0, eval: 0, host: 0 };
  for (const name of usedTransformers) {
    tierCounts[TRANSFORMER_RISK[name] || "host"]++;
  }
  section.append(makeEl("div", { class: "cp-head" }, [
    makeEl("strong", {}, "Capabilities & escape"),
    " — host policy snapshot for this run",
  ]));
  pol("Engine", `${engineMeta.version} · ${engineMeta.builtins.length} built-ins · ${engineMeta.bcVersion}`, "ok");
  pol("Escape mode", escapeMode, "ok");
  pol("Trim whitespace", standalone ? "ON (ADR-0016 standalone-tag stripping)" : "off", "ok");
  pol(
    "Allow-list",
    allowList === null
      ? "unconstrained (every built-in callable)"
      : allowList.length === 0
        ? "EMPTY (every transformer refused)"
        : `${allowList.length} name${allowList.length === 1 ? "" : "s"} callable — ${allowList.join(", ")}`,
    allowList === null ? "ok" : (allowList.length === 0 ? "warn" : "ok"),
  );
  pol("Eval transformer", usedTransformers.includes("eval") ? "REFERENCED (data-scope disclosure risk)" : "not referenced",
      usedTransformers.includes("eval") ? "danger" : "ok");
  section.append(policy);
  // Risk-tier breakdown.
  const tiers = makeEl("div", { class: "cp-tiers" });
  const tierLabel = {
    default: "default (always on)",
    format: "format (low risk)",
    transform: "transform (medium · audited)",
    eval: "eval (dynamic · opt-in)",
    host: "host (custom transformers)",
  };
  for (const [t, n] of Object.entries(tierCounts)) {
    if (n === 0) continue;
    tiers.append(makeEl("div", { class: `cp-tier cp-risk-${t}` }, [
      makeEl("span", { class: "cp-tier-k" }, tierLabel[t]),
      makeEl("span", { class: "cp-tier-v" }, String(n)),
    ]));
  }
  if (!tiers.children.length) {
    tiers.append(makeEl("div", { class: "cp-empty" }, "No transformers referenced."));
  }
  section.append(tiers);
  section.append(escapeMix(true));
  body.append(section);
}
