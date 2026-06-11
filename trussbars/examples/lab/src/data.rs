//! Decode the live-edited Data pane (YAML text) into the VM's dynamic [`Value`].
//!
//! Runtime data whose shape isn't known at build time is exactly the case the VM exists
//! for, so the lab takes it as editable YAML and converts it here.

use std::collections::BTreeMap;
use std::rc::Rc;

use serde_yaml::Value as Yaml;
use trussbars_interp::Value;

/// Parse YAML `src` into a VM [`Value`], or a human-readable reason.
///
/// # Errors
/// The `serde_yaml` parse error message, prefixed `invalid data YAML:`.
pub fn parse(src: &str) -> Result<Value, String> {
    let yaml: Yaml = serde_yaml::from_str(src).map_err(|e| format!("invalid data YAML: {e}"))?;
    Ok(from_yaml(&yaml))
}

fn from_yaml(y: &Yaml) -> Value {
    match y {
        Yaml::Null => Value::Null,
        Yaml::Bool(b) => Value::Bool(*b),
        Yaml::Number(n) => Value::Num(n.as_f64().unwrap_or(0.0)),
        Yaml::String(s) => Value::Str(Rc::from(s.as_str())),
        Yaml::Sequence(a) => Value::Array(Rc::from(a.iter().map(from_yaml).collect::<Vec<_>>())),
        Yaml::Mapping(m) => {
            let map: BTreeMap<String, Value> = m
                .iter()
                .filter_map(|(k, v)| k.as_str().map(|k| (k.to_string(), from_yaml(v))))
                .collect();
            Value::Object(Rc::new(map))
        }
        // A `!Tag value` is unwrapped to its value (the lab has no use for tags).
        Yaml::Tagged(t) => from_yaml(&t.value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_scalars_and_nesting() {
        let v = parse("n: 3\ns: x\na: [1, true, null]\n").unwrap();
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
    fn reports_invalid_yaml() {
        assert!(
            parse("a: [1, 2\nb: oops")
                .unwrap_err()
                .starts_with("invalid data YAML:")
        );
    }
}
