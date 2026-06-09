//! `cargo run --release` — render the receipt in every bundled locale.
//!
//! The catalog and the order are *fetched* (from `catalog.yaml` / `data.yaml` via serde),
//! not hard-coded; the declared helpers (`t`/`plural`/`number`/`date`) look messages up in
//! the catalog by key. The same template renders identically through the VM — see the
//! `vm_render_matches_aot` test in the library.
//!
//! ```text
//! cargo run --release                          # embedded catalog.yaml
//! cargo run --release -- --catalog other.yaml  # a catalog fetched from disk at runtime
//! ```
//!
//! `--catalog <path>` makes the "swap the source" claim literal: the messages come from
//! that file instead of the embedded default, and nothing else (template or helpers)
//! changes.

use std::process::ExitCode;

use i18n_data::{Catalog, page, page_with_catalog, render_receipt};

const LOCALES: [&str; 4] = ["en", "de", "fr", "pl"];

fn main() -> ExitCode {
    let catalog = match parse_args(std::env::args().skip(1)) {
        Ok(None) => None, // embedded default
        Ok(Some(path)) => match load_catalog_file(&path) {
            Ok(catalog) => Some(catalog),
            Err(reason) => {
                eprintln!("i18n-data: {reason}");
                return ExitCode::FAILURE;
            }
        },
        Err(reason) => {
            eprintln!("i18n-data: {reason}\nusage: i18n-data [--catalog <path>]");
            return ExitCode::FAILURE;
        }
    };

    for locale in LOCALES {
        println!("───── {locale} ─────");
        let page = match &catalog {
            Some(catalog) => page_with_catalog(locale, catalog.clone()),
            None => page(locale),
        };
        print!("{}", render_receipt(&page));
        println!();
    }
    ExitCode::SUCCESS
}

/// Parse `--catalog <path>` out of the args (argv[0] already skipped). `None` = use the
/// embedded catalog. Errors on a `--catalog` missing its path or any unknown argument.
fn parse_args(mut args: impl Iterator<Item = String>) -> Result<Option<String>, String> {
    let mut catalog = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--catalog" => {
                let path = args
                    .next()
                    .ok_or_else(|| "--catalog needs a <path>".to_string())?;
                catalog = Some(path);
            }
            other => return Err(format!("unknown argument `{other}`")),
        }
    }
    Ok(catalog)
}

/// Fetch a catalog from a YAML file at runtime — the genuine "swap the source" path.
fn load_catalog_file(path: &str) -> Result<Catalog, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("reading {path}: {e}"))?;
    serde_yaml::from_str(&text).map_err(|e| format!("parsing {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::parse_args;

    fn args(xs: &[&str]) -> impl Iterator<Item = String> {
        xs.iter()
            .map(|s| (*s).to_string())
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn no_args_uses_the_embedded_catalog() {
        assert_eq!(parse_args(args(&[])).unwrap(), None);
    }

    #[test]
    fn catalog_flag_takes_a_path() {
        assert_eq!(
            parse_args(args(&["--catalog", "x.yaml"])).unwrap(),
            Some("x.yaml".to_string())
        );
    }

    #[test]
    fn catalog_flag_without_a_path_errors() {
        assert!(parse_args(args(&["--catalog"])).is_err());
    }

    #[test]
    fn unknown_argument_errors() {
        assert!(parse_args(args(&["--nope"])).is_err());
    }
}
