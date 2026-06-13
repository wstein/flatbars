//! `trussbars-wasm` — the Trussbars engine behind a `wasm-bindgen` surface, the
//! shipping render path for the FlatBars Lab's `trussbars` engine citizen
//! (PLAN-registry-local-trussbars.md, Phase 4).
//!
//! The Lab instantiates this wasm module in the browser on **both** transports
//! (decided 2026-06-11): one Trussbars render path everywhere, so there is no
//! native-vs-wasm equivalence burden. The render is the same conformance-gated
//! [`trussbars_interp`] interpreter the native `truss-interp` binary runs — data
//! ingestion (JSON → dynamic `Value`) and the ECMA-f64 formatter are identical, so
//! the wasm output is byte-for-byte what the native engine and the oracle produce.
//!
//! Surface (mirrors `truss-interp`'s stdin protocol, one call per render):
//!
//! ```ignore
//! render(template, data_json, truthiness) -> Result<String, JsValue>
//! ```

use std::collections::BTreeMap;
use std::rc::Rc;

use serde_json::Value as Json;
use trussbars_interp::{Template, TruthMode, Value};
use wasm_bindgen::prelude::*;

/// Render `template` against `data_json` (a JSON document) under the named
/// `truthiness` policy (`NonEmpty` — the native default — `Liquid`, or `Handlebars`;
/// an unknown name is an error). Returns the rendered output, or a located render /
/// parse error string (the interpreter prefixes `line:col:`, which the Lab lifts into
/// the Problems panel exactly as it does for the oracle).
#[wasm_bindgen]
pub fn render(template: &str, data_json: &str, truthiness: &str) -> Result<String, JsValue> {
    render_impl(template, data_json, truthiness).map_err(|e| JsValue::from_str(&e))
}

/// The engine version — surfaced in the provider's `engineInfo().version`.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// The pure render core, free of any `wasm-bindgen` type (so it is natively
/// unit-testable — `JsValue` can only be constructed inside a JS runtime). The
/// bindgen wrapper above maps `Err(String)` to a `JsValue` for the browser.
fn render_impl(template: &str, data_json: &str, truthiness: &str) -> Result<String, String> {
    let json: Json = serde_json::from_str(data_json).map_err(|e| format!("bad data JSON: {e}"))?;
    let data = from_json(&json);
    let mode = TruthMode::from_ident(truthiness).ok_or_else(|| {
        format!("unknown truthiness mode `{truthiness}` (expected NonEmpty, Liquid, or Handlebars)")
    })?;
    let template = Template::parse(template)?;
    template.with_truthiness(mode).render(&data)
}

/// `serde_json::Value` → the interpreter's dynamic [`Value`] — identical to the
/// native `truss-interp` conversion (numbers collapse to f64, like the whole engine).
fn from_json(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Num(n.as_f64().unwrap_or(0.0)),
        Json::String(s) => Value::Str(Rc::from(s.as_str())),
        Json::Array(a) => Value::Array(a.iter().map(from_json).collect::<Vec<_>>().into()),
        Json::Object(o) => Value::Object(Rc::new(
            o.iter()
                .map(|(k, v)| (k.clone(), from_json(v)))
                .collect::<BTreeMap<_, _>>(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // `render_impl` is the pure core (no JsValue), so it is natively unit-testable;
    // the browser bindgen path is covered by the Lab smoke.

    #[test]
    fn renders_a_native_template_against_json_data() {
        assert_eq!(
            render_impl("Hi {{ name }}", r#"{"name":"Ada"}"#, "NonEmpty").unwrap(),
            "Hi Ada"
        );
    }

    #[test]
    fn a_parse_error_is_returned_not_panicked() {
        assert!(render_impl("{% for %}", "{}", "NonEmpty").is_err());
    }

    #[test]
    fn an_unknown_truthiness_mode_is_an_error() {
        let e = render_impl("x", "{}", "Bogus").unwrap_err();
        assert!(e.contains("unknown truthiness mode"), "{e}");
    }

    #[test]
    fn bad_data_json_is_an_error_not_a_panic() {
        assert!(render_impl("x", "{not json", "NonEmpty").is_err());
    }
}
