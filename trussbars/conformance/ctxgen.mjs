// JSON data → a Rust context type (the docs/03 schema, generated from the data
// for the conformance harness). Numbers → f64 (the engine's model, byte-identical
// under `ecma-float`), strings → String, bool → bool, null → Option<String>,
// arrays → Vec<elem> (homogeneous; first element's shape), objects → a nested
// `#[derive(serde::Deserialize, trussbars_core::Trussbars)]` struct. The root is
// always the struct `Ctx`; nested structs get counter names (collision-free).

function cap(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/// Returns the Rust struct definitions (root `Ctx` first) as one source string.
/// `maps` lists top-level field names to type as `BTreeMap<String, V>` (object
/// iteration, `{{#each obj}}`) instead of a struct. `enums` maps a top-level field
/// name to its variant list (`{status: ["Active","Pending"]}`): the field is typed
/// as a unit enum, so serde maps the JSON string `"Active"` to `Status::Active` and
/// `#[derive(Trussbars)]` renders the variant name.
export function genCtx(data, maps = [], enums = {}) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("ctxgen: the data root must be a JSON object");
  }
  const mapSet = new Set(maps);
  const enumFields = new Map(Object.entries(enums));
  const defs = [];
  let counter = 0;

  // `kind`: "root" (the Ctx struct) | "field" (a top-level field) | "nested".
  function rustType(value, kind, fieldName) {
    // A top-level field named in `enums` is a unit enum (its JSON string value
    // deserializes to the matching variant).
    if (kind === "field" && enumFields.has(fieldName)) {
      const name = cap(fieldName);
      const variants = enumFields
        .get(fieldName)
        .map((v) => `    ${v},`)
        .join("\n");
      defs.push(
        `#[derive(serde::Deserialize, trussbars_core::Trussbars)]\n` +
          `pub enum ${name} {\n${variants}\n}`,
      );
      return name;
    }
    if (value === null) return "Option<String>";
    switch (typeof value) {
      case "string":
        return "String";
      case "number":
        return "f64";
      case "boolean":
        return "bool";
    }
    if (Array.isArray(value)) {
      const elem = value.length ? rustType(value[0], "nested", null) : "String";
      return `Vec<${elem}>`;
    }
    // A top-level field named in `maps` is a map; every other object is a struct.
    if (kind === "field" && mapSet.has(fieldName)) {
      const vals = Object.values(value);
      const vt = vals.length ? rustType(vals[0], "nested", null) : "String";
      return `std::collections::BTreeMap<String, ${vt}>`;
    }
    const name = kind === "root" ? "Ctx" : `T${++counter}`;
    const childKind = kind === "root" ? "field" : "nested";
    const fields = Object.entries(value)
      .map(([k, v]) => `    pub ${k}: ${rustType(v, childKind, k)},`)
      .join("\n");
    defs.push(
      `#[derive(serde::Deserialize, trussbars_core::Trussbars)]\n` +
        `pub struct ${name} {\n${fields}\n}`,
    );
    return name;
  }

  rustType(data, "root", null);
  // Root `Ctx` is pushed last (after its nested types); order doesn't matter in Rust.
  return defs.join("\n\n");
}
