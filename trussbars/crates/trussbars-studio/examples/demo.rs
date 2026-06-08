//! A runnable Trussbars Studio: registers a compiled host helper and serves the IDE
//! over `examples/templates`. Run from the crate dir:
//!
//! ```sh
//! cargo run --example demo        # then open http://127.0.0.1:3000
//! ```
//!
//! Edit `examples/templates/welcome.truss` in the IDE: the output, the data→output
//! provenance, the AOT-compat verdict, and the emitted Rust update live — and the
//! `{{… | shout}}` helper works because it ran *in this process*.

use std::rc::Rc;

use trussbars_vm::{Helpers, Value};

fn main() -> std::io::Result<()> {
    let mut helpers = Helpers::new();
    // A compiled host helper — exactly what AOT can't register dynamically.
    helpers.register("shout", |args| {
        let s = match args.first() {
            Some(Value::Str(s)) => s.to_string(),
            _ => String::new(),
        };
        Ok(Value::Str(Rc::from(format!("{}!", s.to_uppercase()).as_str())))
    });
    trussbars_studio::serve(Rc::new(helpers), "examples/templates", "127.0.0.1:3000")
}
