//! `truss-vm` — a thin dev/test CLI over [`trussbars_vm::render`].
//!
//! Reads a JSON object `{ "template": "<src>", "data": <json> }` from stdin and prints
//! the rendered output to stdout. On a parse error or an unimplemented construct it
//! prints the reason to stderr and exits `1` (so the conformance harness can tally
//! coverage). Drives the `harness.mjs --vm` gate (docs/11 §9).

use std::collections::BTreeMap;
use std::io::Read;
use std::rc::Rc;

use serde_json::Value as Json;
use trussbars_vm::{Value, render};

fn main() {
    let mut input = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("failed to read stdin: {e}");
        std::process::exit(2);
    }
    let req: Json = match serde_json::from_str(&input) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("bad request JSON: {e}");
            std::process::exit(2);
        }
    };
    let template = req.get("template").and_then(Json::as_str).unwrap_or("");
    let data = from_json(req.get("data").unwrap_or(&Json::Null));

    match render(template, data) {
        Ok(out) => print!("{out}"),
        Err(reason) => {
            eprint!("{reason}");
            std::process::exit(1);
        }
    }
}

/// `serde_json::Value` → the VM's dynamic [`Value`] (numbers collapse to f64, like the
/// rest of the engine).
fn from_json(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Num(n.as_f64().unwrap_or(0.0)),
        Json::String(s) => Value::Str(Rc::from(s.as_str())),
        Json::Array(a) => Value::Array(a.iter().map(from_json).collect::<Vec<_>>().into()),
        Json::Object(o) => {
            Value::Object(Rc::new(o.iter().map(|(k, v)| (k.clone(), from_json(v))).collect::<BTreeMap<_, _>>()))
        }
    }
}
