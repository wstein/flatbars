//! `truss-import` — the dev CLI for the migration tool's read half (`docs/15`).
//!
//! Migrating to `.truss` is the **default**; the dialect is inferred from the file
//! extension unless `--dialect` overrides it:
//!
//! ```text
//! truss-import [--dialect <name>] [--data d.json] <file|->   # migrate → idiomatic .truss
//! truss-import --metrics <file|->                            # Mustache idiom metrics
//! truss-import --ast <file|->                                # dump the dialect AST ({:#?})
//! ```
//!
//! The migration idioms (`?:`/ternary collapse and the faithful-truthiness predicate)
//! are on by default; opt out with `--no-ternary` / `--no-faithful-truthiness`. The
//! `.truss` goes to stdout, the migration report to stderr (`--report-json` for JSON).
//! Exit codes: `0` ok, `1` parse error, `2` usage / I/O error.

use std::io::Read;
use std::path::Path;
use std::process::ExitCode;

use trussbars_import::lower::{LowerOptions, NoShapes, Severity, ShapeOracle};
use trussbars_import::sample::JsonShapes;
use trussbars_import::{Ast, Dialect, metrics, migrate, parse};

#[derive(PartialEq)]
enum Mode {
    Dump,
    Metrics,
    ToTruss,
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let mut dialect_override: Option<String> = None;
    let mut file: Option<String> = None;
    // Migrating to `.truss` is the default; `--ast` / `--metrics` switch modes.
    let mut mode = Mode::ToTruss;
    // The migration idioms are on by default; the `--no-*` flags opt out.
    let mut ternary = true;
    let mut faithful_truthiness = true;
    let mut compact = false;
    let mut data: Option<String> = None;
    let mut report_json = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--dialect" | "-d" => match args.next() {
                Some(v) => dialect_override = Some(v),
                None => return usage("`--dialect` needs a value"),
            },
            other if other.starts_with("--dialect=") => {
                dialect_override = Some(other["--dialect=".len()..].to_string());
            }
            "--data" => match args.next() {
                Some(v) => data = Some(v),
                None => return usage("`--data` needs a file path"),
            },
            other if other.starts_with("--data=") => {
                data = Some(other["--data=".len()..].to_string());
            }
            "--ast" => mode = Mode::Dump,
            "--metrics" => mode = Mode::Metrics,
            "--to-truss" => mode = Mode::ToTruss,
            "--no-ternary" => ternary = false,
            "--no-faithful-truthiness" => faithful_truthiness = false,
            "--compact" => compact = true,
            "--report-json" => report_json = true,
            "--help" | "-h" => {
                print_help();
                return ExitCode::SUCCESS;
            }
            other if file.is_none() => file = Some(other.to_string()),
            other => return usage(&format!("unexpected argument `{other}`")),
        }
    }

    let Some(file) = file else {
        return usage("a template file (or `-` for stdin) is required");
    };

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

    match mode {
        Mode::Dump => dump(dialect, &src),
        Mode::Metrics => run_metrics(dialect, &src),
        Mode::ToTruss => run_to_truss(
            dialect,
            &src,
            ternary,
            faithful_truthiness,
            compact,
            data.as_deref(),
            report_json,
        ),
    }
}

fn dump(dialect: Dialect, src: &str) -> ExitCode {
    match parse(dialect, src) {
        Ok(ast) => {
            println!("{ast:#?}");
            ExitCode::SUCCESS
        }
        Err(e) => parse_error(dialect, src, &e),
    }
}

fn run_metrics(dialect: Dialect, src: &str) -> ExitCode {
    if dialect != Dialect::Mustache {
        return usage("`--metrics` currently supports only the `mustache` dialect");
    }
    let nodes = match parse(dialect, src) {
        Ok(Ast::Mustache(n)) => n,
        Ok(_) => unreachable!("dialect checked above"),
        Err(e) => return parse_error(dialect, src, &e),
    };
    let m = metrics::mustache(&nodes);
    println!(
        "nodes={}  variables={}  sections={}  inverted={}  partials={}  comments={}  max_depth={}",
        m.total_nodes, m.variables, m.sections, m.inverted, m.partials, m.comments, m.max_depth
    );
    println!(
        "idioms: complementary_pairs={} (trivial_ternaries={})  lone_inverteds={}  case_runs={:?}",
        m.complementary_pairs, m.trivial_ternaries, m.lone_inverteds, m.case_run_lengths
    );
    println!(
        "residuals={} (dynamic_partials={}  inheritance={})  set_delimiters={}",
        m.residuals(),
        m.dynamic_partials,
        m.inheritance,
        m.set_delimiters
    );
    println!("\nsuggested parameters:");
    println!(
        "  I1 complementary collapse: {}",
        yes_no(m.complementary_pairs > 0)
    );
    println!(
        "  I3 --ternary: {} ({} trivial pair(s))",
        yes_no(m.trivial_ternaries > 0),
        m.trivial_ternaries
    );
    let ambiguous = m.sections; // sections need a --data sample to disambiguate exactly
    println!(
        "  I4 --data sample recommended: {} ({ambiguous} section(s))",
        yes_no(ambiguous > 0)
    );
    ExitCode::SUCCESS
}

fn run_to_truss(
    dialect: Dialect,
    src: &str,
    ternary: bool,
    faithful_truthiness: bool,
    compact: bool,
    data: Option<&str>,
    report_json: bool,
) -> ExitCode {
    // The shape oracle: a `--data` JSON sample, else the heuristic.
    let oracle: Box<dyn ShapeOracle> = match data {
        Some(path) => {
            let json = match read_source(path) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("error: failed to read data sample `{path}`: {e}");
                    return ExitCode::from(2);
                }
            };
            match JsonShapes::parse(&json) {
                Ok(s) => Box::new(s),
                Err(e) => {
                    eprintln!("error: `{path}` is not valid JSON: {e}");
                    return ExitCode::from(2);
                }
            }
        }
        None => Box::new(NoShapes),
    };

    let opts = LowerOptions {
        ternary,
        faithful_truthiness,
    };
    let shapes = oracle.as_ref();
    let migrated = match dialect {
        Dialect::Mustache => migrate::mustache(src, shapes, &opts),
        Dialect::Handlebars => migrate::handlebars(src, shapes, &opts),
        Dialect::Liquid => migrate::liquid(src, shapes, &opts),
        Dialect::StringTemplateText => migrate::stringtemplate(src, shapes, &opts),
        Dialect::StringTemplateGroup => migrate::stringtemplate_group(src, shapes, &opts),
    };
    match migrated {
        Ok(m) => {
            // Readable (block tags on their own lines) by default; `--compact` is verbatim.
            if compact {
                print!("{}", m.truss);
            } else {
                print!("{}", m.pretty());
            }
            if report_json {
                eprintln!("{}", migrate::report_json(&m.report, src));
            } else if !m.report.is_empty() {
                eprintln!("\n{} migration note(s):", m.report.len());
                for n in &m.report {
                    let (line, col) = line_col(src, n.span.start);
                    eprintln!("  {}:{line}:{col} {}", severity_str(n.severity), n.message);
                }
            }
            ExitCode::SUCCESS
        }
        Err(e) => parse_error(dialect, src, &e),
    }
}

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Info => "info",
        Severity::Warn => "warn",
        Severity::Residual => "residual",
    }
}

fn yes_no(b: bool) -> &'static str {
    if b { "yes" } else { "no" }
}

fn parse_error(dialect: Dialect, src: &str, e: &trussbars_import::ParseError) -> ExitCode {
    let (line, col) = line_col(src, e.at);
    eprintln!(
        "{}: parse error at {line}:{col}: {}",
        dialect.name(),
        e.message
    );
    ExitCode::from(1)
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
        "usage: truss-import [--dialect <name>] [--metrics | --to-truss [--ternary]] <file|->"
    );
    ExitCode::from(2)
}

fn print_help() {
    println!("truss-import — the migration tool's read half (docs/15)");
    println!();
    println!("usage: truss-import [--dialect <name>] [MODE] <file|->");
    println!();
    println!("modes:");
    println!("  (default)     migrate the template → idiomatic .truss (report on stderr)");
    println!("  --metrics     report Mustache idiom metrics (and suggested parameters)");
    println!("  --ast         dump the parsed dialect AST ({{:#?}})");
    println!();
    println!("migration options (idioms are on by default):");
    println!(
        "  --no-ternary              keep {{#if}}…{{else}} instead of {{x ?: b}} / {{x ? a : b}}"
    );
    println!(
        "  --no-faithful-truthiness  annotate the truthiness delta instead of an exact predicate"
    );
    println!(
        "  --compact                 verbatim output (preserve source whitespace; no re-flow)"
    );
    println!("  --data <f.json>           disambiguate sections from a JSON data sample");
    println!("  --report-json             emit the migration report as JSON on stderr");
    println!();
    println!("dialects (inferred from extension when omitted):");
    println!("  mustache              .mustache");
    println!("  handlebars            .hbs / .handlebars");
    println!("  liquid                .liquid");
    println!("  stringtemplate        .st");
    println!("  stringtemplate-group  .stg");
}
