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
export function genCtx(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("ctxgen: the data root must be a JSON object");
  }
  const defs = [];
  let counter = 0;

  function rustType(value, isRoot) {
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
      const elem = value.length ? rustType(value[0], false) : "String";
      return `Vec<${elem}>`;
    }
    // object → a struct definition
    const name = isRoot ? "Ctx" : `T${++counter}`;
    const fields = Object.entries(value)
      .map(([k, v]) => `    pub ${k}: ${rustType(v, false)},`)
      .join("\n");
    defs.push(
      `#[derive(serde::Deserialize, trussbars_core::Trussbars)]\n` +
        `pub struct ${name} {\n${fields}\n}`,
    );
    return name;
  }

  rustType(data, true);
  // Root `Ctx` is pushed last (after its nested types); order doesn't matter in Rust.
  return defs.join("\n\n");
}
