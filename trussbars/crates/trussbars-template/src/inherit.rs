//! **ADR-040 template inheritance** — the static `{% extends %}` / `{% block %}` /
//! `{% super %}` flatten, the Rust mirror of the PureScript `Kernel.Inherit`.
//!
//! A pure pass over the parsed [`Node`] tree (run at the tail of [`crate::parse::parse`])
//! that resolves named-block inheritance entirely at compile time into a plain tree the
//! emitter and VM consume unchanged — **no new runtime, no new node kind survives**. It
//! walks the `{% extends %}` chain leaf→root over the template's own `{% inline %}` base
//! registry, merges block overrides (leaf wins), then fills the root template's
//! `{% block %}` slots: an overridden slot renders the override (with `{% super %}`
//! splicing the parent body), an un-overridden slot renders its default. A template with
//! no `{% extends %}` and no `{% block %}` is returned structurally unchanged.

use crate::ast::Node;
use crate::parse_expr::ParseError;
use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;

type Registry = BTreeMap<String, Vec<Node>>;

/// Resolve `{% extends %}` / `{% block %}` / `{% super %}` into a plain `Node` tree.
///
/// # Errors
/// Returns a [`ParseError`] for stray non-block content in a child (the blocks-only rule)
/// or an `{% extends %}` that names no base template.
pub fn resolve_inheritance(nodes: Vec<Node>) -> Result<Vec<Node>, ParseError> {
    let bases = collect_bases(&nodes);
    if find_extends(&nodes).is_none() {
        // A base or plain template: fill its own slots with their defaults.
        Ok(fill_blocks(&Registry::new(), nodes))
    } else {
        // A child: thread overrides up the chain onto the root, then keep the child's own
        // inline definitions (so a later `{% partial %}` / `{% include %}` still resolves).
        let flat = flatten_with(&bases, &Registry::new(), &nodes)?;
        let mut out: Vec<Node> = nodes.iter().filter(|n| is_inline_def(n)).cloned().collect();
        out.extend(flat);
        Ok(out)
    }
}

/// Every `{% inline "name" %}body{% endinline %}` at any depth → `name ↦ body` (the base
/// registry the `extends` chain resolves against; an outer definition wins).
fn collect_bases(nodes: &[Node]) -> Registry {
    let mut m = Registry::new();
    collect_bases_into(nodes, &mut m);
    m
}

fn collect_bases_into(nodes: &[Node], m: &mut Registry) {
    for n in nodes {
        for child in child_lists(n) {
            collect_bases_into(child, m);
        }
        if let Node::Inline { name, body, .. } = n {
            m.insert(name.clone(), body.clone());
        }
    }
}

/// The leading `{% extends "base" %}` directive (the base name + its offset), or `None`.
fn find_extends(nodes: &[Node]) -> Option<(&str, usize)> {
    nodes.iter().find_map(|n| match n {
        Node::Extends { name, span } => Some((name.as_str(), span.start)),
        _ => None,
    })
}

/// Walk the `extends` chain leaf→root, accumulating block overrides (a descendant wins on
/// a name collision), then fill the root template's slots.
fn flatten_with(
    bases: &Registry,
    descendant: &Registry,
    nodes: &[Node],
) -> Result<Vec<Node>, ParseError> {
    match find_extends(nodes) {
        None => Ok(fill_blocks(descendant, nodes.to_vec())),
        Some((name, off)) => {
            let mut merged = collect_overrides(nodes)?;
            // `descendant` (closer to the leaf) overrides this level on a name collision.
            for (k, v) in descendant {
                merged.insert(k.clone(), v.clone());
            }
            let base = bases
                .get(name)
                .ok_or_else(|| unknown_base_error(name, off))?;
            flatten_with(bases, &merged, base)
        }
    }
}

/// A child's top-level `{% block name %}body{% endblock %}` overrides. Every other
/// top-level node must be a block definition, an inline definition, the `extends`
/// directive, or whitespace — anything else is a located error (the blocks-only rule).
fn collect_overrides(nodes: &[Node]) -> Result<Registry, ParseError> {
    let mut m = Registry::new();
    for n in nodes {
        match n {
            Node::Block { name, body, .. } => {
                m.insert(name.clone(), body.clone());
            }
            Node::Inline { .. } | Node::Extends { .. } => {}
            Node::Text(s) if s.trim().is_empty() => {}
            other => return Err(stray_child_error(other.span().start)),
        }
    }
    Ok(m)
}

/// Fill the slots of a root template: expand each `{% block name %}default{% endblock %}`
/// to the override body (with `{% super %}` → default) when `overrides` names it, else to
/// its default. Recurses through nested bodies; inline definitions pass through untouched.
fn fill_blocks(overrides: &Registry, nodes: Vec<Node>) -> Vec<Node> {
    let mut out = Vec::new();
    for n in nodes {
        match n {
            Node::Block { name, body, .. } => {
                let def = fill_blocks(overrides, body);
                match overrides.get(&name) {
                    None => out.extend(def),
                    Some(ov) => {
                        let substituted = subst_super(&def, ov.clone());
                        out.extend(fill_blocks(overrides, substituted));
                    }
                }
            }
            Node::Inline { span, name, body } => out.push(Node::Inline { span, name, body }),
            other => out.push(map_node_children(other, &|ns| fill_blocks(overrides, ns))),
        }
    }
    out
}

/// Splice the parent body `def` in for every `{% super %}` in an override body. Recurses
/// through ordinary bodies (an `{% if %}`/`{% for %}` may wrap a `{% super %}`) but not
/// into a nested `{% block %}` (whose `{% super %}` belongs to *its* parent).
fn subst_super(def: &[Node], override_body: Vec<Node>) -> Vec<Node> {
    let mut out = Vec::new();
    for n in override_body {
        match n {
            Node::Super { .. } => out.extend(def.iter().cloned()),
            Node::Block { span, name, body } => out.push(Node::Block { span, name, body }),
            Node::Inline { span, name, body } => out.push(Node::Inline { span, name, body }),
            other => out.push(map_node_children(other, &|ns| subst_super(def, ns))),
        }
    }
    out
}

/// Rebuild `n` with each of its child node-lists transformed by `f`.
fn map_node_children<F: Fn(Vec<Node>) -> Vec<Node>>(n: Node, f: &F) -> Node {
    match n {
        Node::For(mut x) => {
            x.body = f(x.body);
            x.otherwise = f(x.otherwise);
            Node::For(x)
        }
        Node::Cond(mut x) => {
            x.body = f(x.body);
            x.otherwise = f(x.otherwise);
            x.elifs = x.elifs.into_iter().map(|(e, b)| (e, f(b))).collect();
            Node::Cond(x)
        }
        Node::Case(mut x) => {
            x.arms = x.arms.into_iter().map(|(v, b)| (v, f(b))).collect();
            x.otherwise = f(x.otherwise);
            Node::Case(x)
        }
        Node::With(mut x) => {
            x.body = f(x.body);
            x.otherwise = f(x.otherwise);
            Node::With(x)
        }
        Node::Let {
            span,
            bindings,
            body,
        } => Node::Let {
            span,
            bindings,
            body: f(body),
        },
        Node::PartialBlock {
            span,
            name,
            ctx,
            body,
        } => Node::PartialBlock {
            span,
            name,
            ctx,
            body: f(body),
        },
        Node::HelperBlock(mut x) => {
            x.body = f(x.body);
            Node::HelperBlock(x)
        }
        Node::Block { span, name, body } => Node::Block {
            span,
            name,
            body: f(body),
        },
        Node::Inline { span, name, body } => Node::Inline {
            span,
            name,
            body: f(body),
        },
        leaf => leaf,
    }
}

/// The child node-lists of a node (for the read-only base scan).
fn child_lists(n: &Node) -> Vec<&[Node]> {
    match n {
        Node::For(x) => vec![x.body.as_slice(), x.otherwise.as_slice()],
        Node::Cond(x) => {
            let mut v = vec![x.body.as_slice(), x.otherwise.as_slice()];
            v.extend(x.elifs.iter().map(|(_, b)| b.as_slice()));
            v
        }
        Node::Case(x) => {
            let mut v = vec![x.otherwise.as_slice()];
            v.extend(x.arms.iter().map(|(_, b)| b.as_slice()));
            v
        }
        Node::With(x) => vec![x.body.as_slice(), x.otherwise.as_slice()],
        Node::Let { body, .. }
        | Node::PartialBlock { body, .. }
        | Node::Block { body, .. }
        | Node::Inline { body, .. } => vec![body.as_slice()],
        Node::HelperBlock(x) => vec![x.body.as_slice()],
        _ => vec![],
    }
}

fn is_inline_def(n: &Node) -> bool {
    matches!(n, Node::Inline { .. })
}

fn unknown_base_error(name: &str, at: usize) -> ParseError {
    ParseError {
        message: format!(
            "`{{% extends \"{name}\" %}}` names no base template (define it with `{{% inline \"{name}\" %}} … {{% endinline %}}` or register it as a partial)"
        ),
        at,
    }
}

fn stray_child_error(at: usize) -> ParseError {
    ParseError {
        message:
            "a template with `{% extends %}` may contain only `{% block %}` definitions at top level"
                .to_string(),
        at,
    }
}
