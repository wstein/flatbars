//! # trussbars-import
//!
//! Exhaustive, faithful parsers for **foreign** template dialects — the *read half*
//! of the Trussbars migration tool (`trussbars/docs/15-migration-import.md`): a
//! migration tool must parse a foreign template before it can lower it to MaxBars /
//! `.truss`.
//!
//! Each dialect parses to its **own** AST that preserves the structure a faithful
//! migration needs. A shared AST would discard that fidelity; the *future* lowering
//! normalizes the dialects into [`trussbars_template::ast`]. That lowering is
//! **out of scope here** — these parsers are its input.
//!
//! Every node carries a byte-offset [`Span`] (reused from `trussbars-template`), so
//! the migration tool can map its output back to the original source — the same way
//! the v2 front-end's spans drive diagnostics (docs/07) and the inspect map (docs/10).
//!
//! Hand-rolled recursive-descent parsers with zero external dependencies, matching
//! the rest of the workspace.

use std::path::Path;

pub mod handlebars;
pub mod lift;
pub mod liquid;
pub mod lower;
pub mod metrics;
pub mod mustache;
pub mod stringtemplate;

pub use trussbars_template::Span;

/// A parse error: a human-readable reason and the byte offset where it was detected.
///
/// Mirrors `trussbars_template::ParseError` so the future lowering can thread one
/// error type end to end.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// Human-readable reason.
    pub message: String,
    /// Byte offset within the source where the problem was detected.
    pub at: usize,
}

impl ParseError {
    /// Construct a parse error at byte offset `at`.
    #[must_use]
    pub fn new(message: impl Into<String>, at: usize) -> Self {
        Self {
            message: message.into(),
            at,
        }
    }
}

impl core::fmt::Display for ParseError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "{} (at byte {})", self.message, self.at)
    }
}

impl std::error::Error for ParseError {}

/// Which foreign template dialect a source is written in.
///
/// StringTemplate4 splits into two grammars — a single template body (`.st`) and a
/// group file of named definitions (`.stg`) — so they are distinct variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    /// Mustache (spec v1.4). Extension `.mustache`.
    Mustache,
    /// Handlebars. Extensions `.hbs`, `.handlebars`.
    Handlebars,
    /// Liquid. Extension `.liquid`.
    Liquid,
    /// A StringTemplate4 template body. Extension `.st`.
    StringTemplateText,
    /// A StringTemplate4 group file. Extension `.stg`.
    StringTemplateGroup,
}

impl Dialect {
    /// Map a (case-insensitive, leading-dot-optional) file extension to a dialect.
    #[must_use]
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.trim_start_matches('.').to_ascii_lowercase().as_str() {
            "mustache" => Some(Self::Mustache),
            "hbs" | "handlebars" => Some(Self::Handlebars),
            "liquid" => Some(Self::Liquid),
            "st" => Some(Self::StringTemplateText),
            "stg" => Some(Self::StringTemplateGroup),
            _ => None,
        }
    }

    /// Infer the dialect from a path's extension.
    #[must_use]
    pub fn from_path(path: &Path) -> Option<Self> {
        path.extension()
            .and_then(|e| e.to_str())
            .and_then(Self::from_extension)
    }

    /// A short canonical name for the dialect (for CLI `--dialect` and messages).
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Mustache => "mustache",
            Self::Handlebars => "handlebars",
            Self::Liquid => "liquid",
            Self::StringTemplateText => "stringtemplate",
            Self::StringTemplateGroup => "stringtemplate-group",
        }
    }

    /// Parse a `--dialect <name>` CLI value into a dialect.
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "mustache" => Some(Self::Mustache),
            "handlebars" | "hbs" => Some(Self::Handlebars),
            "liquid" => Some(Self::Liquid),
            "stringtemplate" | "st" => Some(Self::StringTemplateText),
            "stringtemplate-group" | "stg" => Some(Self::StringTemplateGroup),
            _ => None,
        }
    }
}

/// A parsed foreign template, tagged by its dialect.
///
/// The roots differ by grammar: the line-based dialects yield a node list, while a
/// StringTemplate group yields a set of named definitions.
#[derive(Debug, Clone, PartialEq)]
pub enum Ast {
    /// A parsed Mustache template.
    Mustache(Vec<mustache::Node>),
    /// A parsed Handlebars template.
    Handlebars(Vec<handlebars::Node>),
    /// A parsed Liquid template.
    Liquid(Vec<liquid::Node>),
    /// A parsed StringTemplate4 template body (`.st`).
    StringTemplate(Vec<stringtemplate::Element>),
    /// A parsed StringTemplate4 group file (`.stg`).
    StringTemplateGroup(stringtemplate::Group),
}

/// Parse `src` as `dialect`, returning the dialect-tagged [`Ast`].
///
/// # Errors
/// Returns a [`ParseError`] on any lexical or structural error in the source.
pub fn parse(dialect: Dialect, src: &str) -> Result<Ast, ParseError> {
    match dialect {
        Dialect::Mustache => mustache::parse(src).map(Ast::Mustache),
        Dialect::Handlebars => handlebars::parse(src).map(Ast::Handlebars),
        Dialect::Liquid => liquid::parse(src).map(Ast::Liquid),
        Dialect::StringTemplateText => stringtemplate::parse_template(src).map(Ast::StringTemplate),
        Dialect::StringTemplateGroup => {
            stringtemplate::parse_group(src).map(Ast::StringTemplateGroup)
        }
    }
}
