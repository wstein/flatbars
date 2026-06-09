//! Decode the live-edited Data pane (JSON text) into the VM's dynamic [`Value`].
//!
//! Runtime data whose shape isn't known at build time is exactly the case the VM
//! exists for, so the lab takes it as editable JSON and converts it here.

use std::collections::BTreeMap;
use std::rc::Rc;

use serde_json::Value as Json;
use trussbars_vm::Value;

/// Parse JSON `src` into a VM [`Value`], or a human-readable reason.
///
/// # Errors
/// The `serde_json` parse error message, prefixed `invalid JSON:`.
pub fn parse(src: &str) -> Result<Value, String> {
    let json: Json = serde_json::from_str(src).map_err(|e| format!("invalid JSON: {e}"))?;
    Ok(from_json(&json))
}

fn from_json(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Num(n.as_f64().unwrap_or(0.0)),
        Json::String(s) => Value::Str(Rc::from(s.as_str())),
        Json::Array(a) => Value::Array(Rc::from(a.iter().map(from_json).collect::<Vec<_>>())),
        Json::Object(o) => {
            let map: BTreeMap<String, Value> =
                o.iter().map(|(k, v)| (k.clone(), from_json(v))).collect();
            Value::Object(Rc::new(map))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_scalars_and_nesting() {
        let v = parse(r#"{ "n": 3, "s": "x", "a": [1, true, null] }"#).unwrap();
        match v {
            Value::Object(o) => {
                assert_eq!(o.get("n"), Some(&Value::Num(3.0)));
                assert!(matches!(o.get("s"), Some(Value::Str(s)) if s.as_ref() == "x"));
                assert!(matches!(o.get("a"), Some(Value::Array(a)) if a.len() == 3));
            }
            _ => panic!("expected object"),
        }
    }

    #[test]
    fn reports_invalid_json() {
        assert!(
            parse("{ not json")
                .unwrap_err()
                .starts_with("invalid JSON:")
        );
    }
}
