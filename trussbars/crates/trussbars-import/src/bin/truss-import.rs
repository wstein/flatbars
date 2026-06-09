//! `truss-import` — a dev CLI that parses a foreign template into its dialect AST and
//! pretty-prints it (the read half of the migration tool, docs/13).
//!
//! Usage:
//!
//! ```text
//! truss-import [--dialect <name>] <file>
//! truss-import --dialect <name> -        # read from stdin
//! ```
//!
//! The dialect is inferred from the file extension (`.mustache`, `.hbs`/`.handlebars`,
//! `.liquid`, `.st`, `.stg`) unless `--dialect` overrides it. The AST is dumped with
//! `{:#?}` (no external serialization dependency). Exit codes: `0` ok, `1` parse error,
//! `2` usage / I/O error.

use std::io::Read;
use std::path::Path;
use std::process::ExitCode;

use trussbars_import::{Dialect, parse};

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let mut dialect_override: Option<String> = None;
    let mut file: Option<String> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--dialect" | "-d" => match args.next() {
                Some(v) => dialect_override = Some(v),
                None => return usage("`--dialect` needs a value"),
            },
            "--help" | "-h" => {
                print_help();
                return ExitCode::SUCCESS;
            }
            other if other.starts_with("--dialect=") => {
                dialect_override = Some(other["--dialect=".len()..].to_string());
            }
            other if file.is_none() => file = Some(other.to_string()),
            other => return usage(&format!("unexpected argument `{other}`")),
        }
    }

    let Some(file) = file else {
        return usage("a template file (or `-` for stdin) is required");
    };

    // Resolve the dialect: an explicit override, else the file extension.
    let dialect = match &dialect_override {
        Some(name) => match Dialect::from_name(name) {
            Some(d) => d,
            None => return usage(&format!("unknown dialect `{name}`")),
        },
        None => match Dialect::from_path(Path::new(&file)) {
            Some(d) => d,
            None => {
                return usage(
                    "could not infer the dialect from the extension — pass `--dialect <name>`",
                );
            }
        },
    };

    let src = match read_source(&file) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: failed to read `{file}`: {e}");
            return ExitCode::from(2);
        }
    };

    match parse(dialect, &src) {
        Ok(ast) => {
            println!("{ast:#?}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            let (line, col) = line_col(&src, e.at);
            eprintln!(
                "{}: parse error at {line}:{col}: {}",
                dialect.name(),
                e.message
            );
            ExitCode::from(1)
        }
    }
}

fn read_source(file: &str) -> std::io::Result<String> {
    if file == "-" {
        let mut s = String::new();
        std::io::stdin().read_to_string(&mut s)?;
        Ok(s)
    } else {
        std::fs::read_to_string(file)
    }
}

/// 1-based `(line, column)` for a byte offset.
fn line_col(src: &str, at: usize) -> (usize, usize) {
    let at = at.min(src.len());
    let before = &src[..at];
    let line = 1 + before.bytes().filter(|&b| b == b'\n').count();
    let col = at - before.rfind('\n').map_or(0, |i| i + 1) + 1;
    (line, col)
}

fn usage(msg: &str) -> ExitCode {
    eprintln!("error: {msg}");
    eprintln!(
        "usage: truss-import [--dialect <mustache|handlebars|liquid|stringtemplate|stringtemplate-group>] <file|->"
    );
    ExitCode::from(2)
}

fn print_help() {
    println!("truss-import — parse a foreign template into its dialect AST and dump it");
    println!();
    println!("usage: truss-import [--dialect <name>] <file|->");
    println!();
    println!("dialects (inferred from extension when omitted):");
    println!("  mustache              .mustache");
    println!("  handlebars            .hbs / .handlebars");
    println!("  liquid                .liquid");
    println!("  stringtemplate        .st");
    println!("  stringtemplate-group  .stg");
}
