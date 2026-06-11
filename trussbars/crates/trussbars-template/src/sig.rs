//! ADR-042 §8 — typed inline-signature lowering.
//!
//! A post-parse pass that fills each `{% include %}`'s *omitted optional* parameter
//! defaults into its hash, from the named `{% inline "n" (p, q=default) %}`
//! signature — so the partial body's scoped `{{q}}` resolves to its default at the
//! call site (the AOT/interpreter/VM bind the hash; ADR-042 §8). Inline definitions
//! are global, so this walks the whole (inheritance-flattened) tree. A *required*
//! parameter the call omits has no hash entry, so the typed AOT compiles a missing
//! context field — the typed-macro check.

use crate::ast::{Expr, Node};
use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

type Sigs = BTreeMap<String, Vec<(String, Option<Expr>)>>;

/// Fill omitted optional defaults into every `{% include %}` hash.
pub fn augment_signatures(mut nodes: Vec<Node>) -> Vec<Node> {
    let mut sigs = Sigs::new();
    collect(&nodes, &mut sigs);
    if !sigs.is_empty() {
        augment(&mut nodes, &sigs);
    }
    nodes
}

fn collect(nodes: &[Node], sigs: &mut Sigs) {
    for n in nodes {
        if let Node::Inline { name, params, .. } = n
            && !params.is_empty()
        {
            sigs.insert(name.clone(), params.clone());
        }
        for child in child_lists(n) {
            collect(child, sigs);
        }
    }
}

fn augment(nodes: &mut [Node], sigs: &Sigs) {
    for n in nodes.iter_mut() {
        if let Node::Partial { name, hash, .. } = n
            && let Some(params) = sigs.get(name)
        {
            for (p, default) in params {
                if let Some(d) = default
                    && !hash.iter().any(|(k, _)| k == p)
                {
                    hash.push((p.clone(), d.clone()));
                }
            }
        }
        for child in child_lists_mut(n) {
            augment(child, sigs);
        }
    }
}

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

fn child_lists_mut(n: &mut Node) -> Vec<&mut Vec<Node>> {
    match n {
        Node::For(x) => vec![&mut x.body, &mut x.otherwise],
        Node::Cond(x) => {
            let mut v: Vec<&mut Vec<Node>> = vec![&mut x.body, &mut x.otherwise];
            v.extend(x.elifs.iter_mut().map(|(_, b)| b));
            v
        }
        Node::Case(x) => {
            let mut v: Vec<&mut Vec<Node>> = vec![&mut x.otherwise];
            v.extend(x.arms.iter_mut().map(|(_, b)| b));
            v
        }
        Node::With(x) => vec![&mut x.body, &mut x.otherwise],
        Node::Let { body, .. }
        | Node::PartialBlock { body, .. }
        | Node::Block { body, .. }
        | Node::Inline { body, .. } => vec![body],
        Node::HelperBlock(x) => vec![&mut x.body],
        _ => vec![],
    }
}
