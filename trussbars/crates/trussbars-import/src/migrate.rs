//! The **migrate** orchestration: parse a foreign template, [`crate::lower`] it to the
//! Trussbars IR, and [`crate::lift`] it back to idiomatic `.truss`, paired with a
//! structured migration report (`docs/15`). Currently Mustache-only.

use crate::lower::{LowerOptions, MigrationNote, Severity, ShapeOracle};
use crate::{ParseError, handlebars, lift, liquid, lower, mustache, stringtemplate};

/// Assemble a [`Migration`] from a lowering result.
fn assemble(low: lower::Lowered) -> Migration {
    Migration {
        truss: lift::to_truss_annotated(&low.ir, &low.notes),
        report: low.report,
    }
}

/// A completed migration: the idiomatic `.truss` (with inline `{{! migrate: … }}`
/// notes) and the structured report.
#[derive(Debug, Clone)]
pub struct Migration {
    /// The migrated `.truss` source.
    pub truss: String,
    /// The migration report, in source order.
    pub report: Vec<MigrationNote>,
}

/// Migrate a Mustache template to idiomatic `.truss`.
///
/// `shapes` disambiguates sections (`{{#x}}` → `each`/`with`/`if`); pass
/// [`crate::lower::NoShapes`] to use the heuristic. `opts` toggles the gated idioms
/// (e.g. ternary collapse).
///
/// # Errors
/// Returns a [`ParseError`] if the source does not parse as Mustache.
pub fn mustache(
    src: &str,
    shapes: &dyn ShapeOracle,
    opts: &LowerOptions,
) -> Result<Migration, ParseError> {
    let nodes = mustache::parse(src)?;
    Ok(assemble(lower::mustache(&nodes, shapes, opts)))
}

/// Migrate a Handlebars template to idiomatic `.truss`.
///
/// # Errors
/// Returns a [`ParseError`] if the source does not parse as Handlebars.
pub fn handlebars(
    src: &str,
    shapes: &dyn ShapeOracle,
    opts: &LowerOptions,
) -> Result<Migration, ParseError> {
    let nodes = handlebars::parse(src)?;
    Ok(assemble(lower::handlebars(&nodes, shapes, opts)))
}

/// Migrate a Liquid template to idiomatic `.truss`.
///
/// # Errors
/// Returns a [`ParseError`] if the source does not parse as Liquid.
pub fn liquid(
    src: &str,
    shapes: &dyn ShapeOracle,
    opts: &LowerOptions,
) -> Result<Migration, ParseError> {
    let nodes = liquid::parse(src)?;
    Ok(assemble(lower::liquid(&nodes, shapes, opts)))
}

/// Migrate a StringTemplate4 `.st` body to idiomatic `.truss`.
///
/// # Errors
/// Returns a [`ParseError`] if the source does not parse as a StringTemplate body.
pub fn stringtemplate(
    src: &str,
    shapes: &dyn ShapeOracle,
    opts: &LowerOptions,
) -> Result<Migration, ParseError> {
    let els = stringtemplate::parse_template(src)?;
    Ok(assemble(lower::stringtemplate(&els, shapes, opts)))
}

/// Migrate a StringTemplate4 `.stg` group file to idiomatic `.truss` (inline partials).
///
/// # Errors
/// Returns a [`ParseError`] if the source does not parse as a StringTemplate group.
pub fn stringtemplate_group(
    src: &str,
    shapes: &dyn ShapeOracle,
    opts: &LowerOptions,
) -> Result<Migration, ParseError> {
    let group = stringtemplate::parse_group(src)?;
    Ok(assemble(lower::stringtemplate_group(&group, shapes, opts)))
}

/// Serialize a migration report to JSON (dependency-free), resolving each note's span
/// to a 1-based `line`/`col` against `src`.
#[must_use]
pub fn report_json(report: &[MigrationNote], src: &str) -> String {
    let mut out = String::from("[");
    for (i, n) in report.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let (line, col) = line_col(src, n.span.start);
        out.push_str("\n  {");
        out.push_str(&format!("\"severity\":\"{}\",", severity_str(n.severity)));
        out.push_str(&format!("\"line\":{line},\"col\":{col},"));
        out.push_str(&format!(
            "\"start\":{},\"end\":{},",
            n.span.start, n.span.end
        ));
        out.push_str("\"message\":\"");
        json_escape(&n.message, &mut out);
        out.push_str("\"}");
    }
    if report.is_empty() {
        out.push(']');
    } else {
        out.push_str("\n]");
    }
    out
}

fn severity_str(s: Severity) -> &'static str {
    match s {
        Severity::Info => "info",
        Severity::Warn => "warn",
        Severity::Residual => "residual",
    }
}

/// The 1-based `(line, column)` for a byte offset.
fn line_col(src: &str, at: usize) -> (usize, usize) {
    let at = at.min(src.len());
    let before = &src[..at];
    let line = 1 + before.bytes().filter(|&b| b == b'\n').count();
    let col = at - before.rfind('\n').map_or(0, |i| i + 1) + 1;
    (line, col)
}

/// Append `s` to `out` with JSON string escaping.
fn json_escape(s: &str, out: &mut String) {
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lower::NoShapes;

    #[test]
    fn migrates_complementary_to_if_else() {
        let m = mustache(
            "{{#ok}}Y{{/ok}}{{^ok}}N{{/ok}}",
            &NoShapes,
            &LowerOptions::default(),
        )
        .unwrap();
        assert!(
            m.truss.contains("{{#if ok}}Y{{else}}N{{/if}}"),
            "{}",
            m.truss
        );
        assert!(m.report.iter().any(|n| n.message.contains("truthiness")));
    }

    #[test]
    fn report_json_shape() {
        let m = mustache("{{>*dyn}}", &NoShapes, &LowerOptions::default()).unwrap();
        let json = report_json(&m.report, "{{>*dyn}}");
        assert!(json.contains("\"severity\":\"residual\""), "{json}");
        assert!(json.contains("\"line\":1"), "{json}");
        assert!(json.contains("dynamic partial"), "{json}");
    }

    #[test]
    fn empty_report_is_empty_array() {
        let m = mustache("plain {{x}}", &NoShapes, &LowerOptions::default()).unwrap();
        assert_eq!(report_json(&m.report, "plain {{x}}"), "[]");
    }

    #[test]
    fn parse_error_propagates() {
        assert!(mustache("{{#a}}", &NoShapes, &LowerOptions::default()).is_err());
    }
}
