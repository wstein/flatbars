//! `truss-vm` — a thin dev/test CLI over [`trussbars_vm::render`].
//!
//! Reads a JSON object `{ "template": "<src>", "data": <json> }` from stdin and prints
//! the rendered output to stdout. On a parse error or an unimplemented construct it
//! prints the reason to stderr and exits `1` (so the conformance harness can tally
//! coverage). Drives the `harness.mjs --vm` gate (docs/11 §9).
//!
//! Flags: `--compat` renders in AOT-compat (strict) mode; `--truthiness=<Mode>` selects
//! the truthiness policy (`NonEmpty` default, `Liquid`, `Handlebars`; docs/16).

use std::collections::BTreeMap;
use std::io::Read;
use std::process::exit;
use std::rc::Rc;

use serde_json::Value as Json;
use trussbars_vm::{Template, TruthMode, Value};

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

    // `--compat` renders in AOT-compat (strict) mode — the verifying proxy.
    let strict = std::env::args().any(|a| a == "--compat");
    // `--truthiness=<Mode>` selects the truthiness policy (default NonEmpty; docs/16).
    let mode = match truthiness_arg() {
        Ok(m) => m,
        Err(name) => {
            eprintln!(
                "unknown --truthiness mode `{name}` (expected NonEmpty, Liquid, or Handlebars)"
            );
            exit(2);
        }
    };
    let result = match Template::parse(template) {
        Ok(t) => {
            let t = t.with_truthiness(mode);
            if strict {
                t.render_compat(&data)
            } else {
                t.render(&data)
            }
        }
        Err(e) => Err(e),
    };
    match result {
        Ok(out) => print!("{out}"),
        Err(reason) => {
            eprint!("{reason}");
            std::process::exit(1);
        }
    }
}

/// The truthiness mode from `--truthiness=<Mode>` (default `NonEmpty`), or `Err(name)`
/// for an unrecognized mode.
fn truthiness_arg() -> Result<TruthMode, String> {
    match std::env::args().find_map(|a| a.strip_prefix("--truthiness=").map(str::to_string)) {
        None => Ok(TruthMode::NonEmpty),
        Some(name) => TruthMode::from_ident(&name).ok_or(name),
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
        Json::Object(o) => Value::Object(Rc::new(
            o.iter()
                .map(|(k, v)| (k.clone(), from_json(v)))
                .collect::<BTreeMap<_, _>>(),
        )),
    }
}
