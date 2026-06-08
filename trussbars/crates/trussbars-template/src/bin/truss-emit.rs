//! `truss-emit` — a thin dev/test CLI over [`trussbars_template::emit`].
//!
//! Reads a MaxBars template from stdin, takes the context type name as `argv[1]`
//! (default `Ctx`), and prints the emitted Rust to stdout. On an unsupported
//! construct or parse error it prints the reason to stderr and exits `1`.
//!
//! The conformance harness (`trussbars/conformance/harness.mjs --v2`) drives it to
//! gate the v2 pipeline byte-for-byte against the same snapshots as v1.

use std::io::Read;

fn main() {
    let ctx_type = std::env::args().nth(1).unwrap_or_else(|| "Ctx".to_string());
    let mut src = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut src) {
        eprintln!("failed to read stdin: {e}");
        std::process::exit(2);
    }
    match trussbars_template::emit(&ctx_type, &src) {
        Ok(rust) => print!("{rust}"),
        Err(reason) => {
            eprint!("{reason}");
            std::process::exit(1);
        }
    }
}
