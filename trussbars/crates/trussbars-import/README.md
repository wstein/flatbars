# trussbars-import

Exhaustive, faithful parsers for four **foreign** template dialects — the *read
half* of the Trussbars migration tool (`trussbars/docs/14-migration-import.md`). A
migration tool must parse a foreign template before it can lower it to MaxBars /
`.truss`; this crate is that first step.

| Dialect | Extensions | What it parses |
| --- | --- | --- |
| **Mustache** (spec v1.4) | `.mustache` | variables, (inverted) sections, comments, partials, set-delimiters, dotted/implicit names, standalone-line trimming, inheritance + dynamic partials |
| **Handlebars** | `.hbs`, `.handlebars` | helper calls + hash args, subexpressions, rich paths (`../`, `@data`, `[seg]`), block helpers with `{{else if}}` chains + `as \|x\|` params, partials / partial blocks / inline partials, decorators, raw blocks, `~` + standalone whitespace control |
| **Liquid** | `.liquid` | objects + chained named-arg filters, the full core tag set (control / iteration / variable / theme / utility), ranges, conditions, `{{- -}}` / `{%- -%}`; unknown tags preserved verbatim |
| **StringTemplate4** | `.st`, `.stg` | `.st` bodies (`<expr>`, `<if>`/`<elseif>`/`<else>`, `<! … !>`, `<@region>`) and `.stg` groups (header directives, `name(params) ::= …`, dictionaries); attribute/property access, includes, `:` map/apply with anonymous subtemplates, lists, `!`/`&&`/`\|\|`, options |

Each dialect parses to its **own** AST that preserves the structure a faithful
migration depends on; the lowering to the Trussbars AST is a separate deliverable.
Every node carries a byte-offset `Span` (reused from `trussbars-template`) so the
migration tool can map its output back to the source. Hand-rolled recursive-descent
parsers, zero external dependencies.

## Library

```rust
use trussbars_import::{parse, Ast, Dialect};

let dialect = Dialect::from_path(std::path::Path::new("page.hbs")).unwrap();
match parse(dialect, "{{#each xs}}{{this}}{{/each}}")? {
    Ast::Handlebars(nodes) => { /* walk the Handlebars AST */ }
    _ => {}
}
# Ok::<(), trussbars_import::ParseError>(())
```

`Dialect` dispatches by extension (`from_extension` / `from_path`) or by CLI name
(`from_name`); `parse` returns the dialect-tagged `Ast`.

## CLI

```sh
truss-import [--dialect <name>] <file|->
```

Infers the dialect from the file extension (or `--dialect`), parses, and pretty-prints
the AST (`{:#?}`, no serialization dependency). `--dialect` accepts `mustache`,
`handlebars`, `liquid`, `stringtemplate`, `stringtemplate-group`.

## Out of scope

The lowering of each foreign AST → `trussbars_template::ast` (the migration tool
proper) is the next deliverable; see `docs/14 §6`. The parsers record names and
structure only — lambda/filter *semantics* are a runtime concern.
