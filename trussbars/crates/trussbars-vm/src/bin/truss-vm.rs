//! `truss-vm` — the bytecode-VM conformance CLI (the mirror of `truss-interp`). Reads a
//! `{ "template": …, "data": … }` request from stdin, compiles + renders it through the
//! **bytecode VM** ([`trussbars_vm::Program`]), and prints the output to stdout (a render
//! error goes to stderr with exit 1). The `--vm` axis of `conformance/harness.mjs` drives
//! it to prove the VM byte-matches the oracle over the whole corpus (docs/11 §4.3).

use std::collections::BTreeMap;
use std::io::Read;
use std::process::exit;
use std::rc::Rc;

use serde_json::Value as Json;
use trussbars_interp::{Helpers, TruthMode, Value};
use trussbars_vm::Program;

fn main() {
    let mut input = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("failed to read stdin: {e}");
        exit(2);
    }
    let req: Json = match serde_json::from_str(&input) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("bad request JSON: {e}");
            exit(2);
        }
    };
    let template = req.get("template").and_then(Json::as_str).unwrap_or("");
    let data = from_json(req.get("data").unwrap_or(&Json::Null));

    let mode = match truthiness_arg() {
        Ok(m) => m,
        Err(name) => {
            eprintln!(
                "unknown --truthiness mode `{name}` (expected NonEmpty, Liquid, or Handlebars)"
            );
            exit(2);
        }
    };

    let helpers = Rc::new(Helpers::new());
    let result = match Program::compile(template) {
        Ok(p) => p.render_with(&data, mode, &helpers),
        Err(e) => Err(e),
    };
    match result {
        Ok(out) => print!("{out}"),
        Err(reason) => {
            eprint!("{reason}");
            exit(1);
        }
    }
}

/// The selected truthiness policy from `--truthiness=<Mode>` (default `NonEmpty`).
fn truthiness_arg() -> Result<TruthMode, String> {
    match std::env::args().find_map(|a| a.strip_prefix("--truthiness=").map(str::to_string)) {
        None => Ok(TruthMode::NonEmpty),
        Some(name) => TruthMode::from_ident(&name).ok_or(name),
    }
}

/// Convert request JSON into the VM's dynamic `Value` (the same mapping `truss-interp` uses).
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
