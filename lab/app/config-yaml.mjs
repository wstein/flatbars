// SPDX-License-Identifier: Apache-2.0
//
// The Lab's config.yaml round-trip (Phase 0): buildConfigYaml serialises the render
// policy (escape / trim / allow-list / i18n locale / MinBars truthiness / analyse
// pathSchema) into the editable, commented YAML scaffold, and parseConfigYaml parses
// + validates the user's edits back into a policy object. A cohesive, testable unit
// (build → parse round-trips). The factory captures ctx (for the live policy
// defaults) and injects engine + loadYaml + the engine's built-in transformer names.

const VALID_ESCAPE = ["", "html", "xml", "json", "none"];

// Align an inline `# comment` to a fixed column — readable config without per-line
// magic-number padding.
function cfgLine(kv, comment) {
  return kv + " ".repeat(Math.max(1, 26 - kv.length)) + "# " + comment;
}

export function createConfigYaml(ctx, { engine, loadYaml, engineBuiltins }) {
  // Serialise current state to the editable YAML (values inlined into a fixed
  // commented scaffold so the descriptions are always present).
  function buildConfigYaml(v = { escape: ctx.state.escapeMode, trim: ctx.state.standalone, allow: ctx.state.allowList }) {
    const esc = v.escape ? v.escape : '""';
    // `null` = unconstrained (the default); a real array (even empty) locks the
    // surface to that positive list. Mirrors the engine's ADR-0013 `allow:`
    // semantics — yaml `~` round-trips as null.
    const allow = v.allow === null ? "~" : "[" + v.allow.join(", ") + "]";
    return [
      "# Render config — applies to every compile + render.",
      "# Edits apply live as you type; fix any error shown in Problems.",
      "",
      cfgLine(`escape: ${esc}`, 'html · xml · json · none · "" (as-compiled)'),
      cfgLine(`trim_whitespace: ${v.trim}`, "strip standalone tag-only lines (ADR-0016)"),
      "",
      "transformers:",
      cfgLine(`  allow: ${allow}`, "ADR-0013 positive list — ~ = unconstrained (default); [eval] = only listed names render"),
      // MinBars-only: the truthiness rule (ADR-029). Replaces the old UI toggle.
      ...(engine === "minbars"
        ? ["", "minbars:", cfgLine(`  truthiness: ${ctx.state.minbarsCompat ? "mustacheJs" : "spec"}`, 'mustacheJs (0/"" falsy, default) · spec (0/"" truthy)')]
        // t-surfaces: the active locale for catalog.yaml's messages (ADR-029), plus
        // the ADR-030 analyse path schema (paths the host guarantees safe).
        : ["", "i18n:", cfgLine(`  locale: ${ctx.state.labLocale}`, "the locale catalog.yaml is rendered in"),
          "", "analyse:", cfgLine(`  pathSchema: [${ctx.state.labPathSchema.join(", ")}]`, "ADR-030 — paths guaranteed safe; suppresses their potential/miss findings")]),
    ].join("\n");
  }

  // Parse + validate the YAML the user edited. Returns { ok, value } or
  // { ok:false, error } with a human message for the inline error line.
  function parseConfigYaml(text) {
    let cfg;
    try { cfg = loadYaml(text); }
    catch (err) { return { ok: false, error: "YAML · " + (err.message || "parse error") }; }
    if (cfg == null) cfg = {};
    if (typeof cfg !== "object" || Array.isArray(cfg))
      return { ok: false, error: "config must be a mapping (key: value pairs)" };

    let esc = cfg.escape == null ? "" : String(cfg.escape).trim();
    if (esc === "as compiled" || esc === "as-compiled" || esc === "raw") esc = "";
    if (!VALID_ESCAPE.includes(esc))
      return { ok: false, error: `escape: must be html, xml, json, none, or "" — got "${esc}"` };

    const trim = cfg.trim_whitespace !== false; // default on
    // MinBars truthiness (ADR-029): default mustacheJs (true); only "spec" opts out.
    const minbars = cfg.minbars && typeof cfg.minbars === "object" ? cfg.minbars : {};
    const mustacheJs = minbars.truthiness !== "spec";
    // i18n locale (ADR-029): the locale catalog.yaml renders in; default en.
    const i18n = cfg.i18n && typeof cfg.i18n === "object" ? cfg.i18n : {};
    const locale = typeof i18n.locale === "string" && i18n.locale ? i18n.locale : "en";

    // ADR-030 path schema: data paths the host guarantees safe — the Truthiness
    // panel suppresses their potential/miss findings. A list of bare paths;
    // missing/empty ⇒ no suppression (plain analyse).
    const analyse = cfg.analyse && typeof cfg.analyse === "object" ? cfg.analyse : {};
    let pathSchema = [];
    const rawSchema = analyse.pathSchema;
    if (rawSchema != null) {
      if (!Array.isArray(rawSchema))
        return { ok: false, error: "analyse.pathSchema: must be a list of data paths, e.g. [count, items]" };
      pathSchema = [...new Set(rawSchema.map((p) => String(p).trim()).filter(Boolean))];
    }

    // ADR-0013 allow-list: missing or `~` means unconstrained (null); an explicit
    // list (even empty) is the positive surface.
    let allow = null;
    const rawAllow = (cfg.transformers && cfg.transformers.allow) ?? cfg.allow;
    if (rawAllow != null) {
      if (!Array.isArray(rawAllow))
        return { ok: false, error: "transformers.allow: must be a list, e.g. [upcase, trim], or ~ for unconstrained" };
      allow = [...new Set(rawAllow.map((n) => String(n).trim()).filter(Boolean))];
      const unknown = allow.filter((n) => !engineBuiltins.includes(n));
      if (unknown.length)
        return { ok: false, error: `transformers.allow: unknown transformer${unknown.length > 1 ? "s" : ""} — ${unknown.join(", ")}` };
    }
    return { ok: true, value: { escape: esc, trim, allow, mustacheJs, locale, pathSchema } };
  }

  return { buildConfigYaml, parseConfigYaml };
}
