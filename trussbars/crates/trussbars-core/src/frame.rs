//! The loop frame model: [`Loop`], the per-iteration metadata of `{{#each}}`
//! (ADR-021; see `trussbars/docs/02-runtime-api.md` §5).
//!
//! Frames are **borrowed references living on the stack**, not heap frames. In
//! the typed model, template nesting maps exactly onto Rust block nesting, so an
//! enclosing loop's [`Loop`] is alive on an enclosing stack frame and the inner
//! loop simply borrows it — there is **no `Rc`** and no heap frame. `loop.parent`
//! is the borrowed [`Loop::parent`]; `loop.root` walks that chain
//! ([`Loop::root`]).
//!
//! The current element (`{{this}}` inside `{{#each}}`) is the loop *binding*
//! (`team`, `m`, …) the codegen introduces, not a field of [`Loop`] — this type
//! carries metadata only.

/// Per-iteration loop metadata. Index fields match the reference engine's
/// `childFrame` exactly: `index1 = index0 + 1`, `rindex0 = length - 1 - index0`,
/// `rindex1 = length - index0`.
#[derive(Debug, Clone, Copy)]
pub struct Loop<'p> {
    /// Zero-based iteration index.
    pub index0: usize,
    /// One-based iteration index (`index0 + 1`).
    pub index1: usize,
    /// Iterations remaining after this one (`length - 1 - index0`).
    pub rindex0: usize,
    /// Iterations remaining including this one (`length - index0`).
    pub rindex1: usize,
    /// Whether this is the first iteration (`index0 == 0`).
    pub first: bool,
    /// Whether this is the last iteration (`index0 == length - 1`).
    pub last: bool,
    /// Total number of items being iterated.
    pub length: usize,
    /// The 1-based loop-nesting level (`loop.depth`, ADR-021 amendment): the
    /// outermost loop is `1`, a loop nested directly inside it is `2`, and so on.
    /// Definitionally `parent.depth + 1`, counting enclosing *loop* frames only
    /// (a `{{#with}}`/`{{#if}}` between two loops does not increment it, since it
    /// introduces no [`Loop`]).
    pub depth: usize,
    /// The entry key, for map iteration; `None` for array iteration.
    pub key: Option<&'p str>,
    /// The nearest enclosing loop, if any.
    pub parent: Option<&'p Loop<'p>>,
}

impl<'p> Loop<'p> {
    /// Build the metadata for iteration `index` of a collection of `length`
    /// items, with an optional map `key` and enclosing `parent` loop.
    ///
    /// `index` must be `< length` (every `{{#each}}` guards the empty case before
    /// iterating, so this always holds for generated code).
    #[inline]
    #[must_use]
    pub fn at(
        index: usize,
        length: usize,
        key: Option<&'p str>,
        parent: Option<&'p Loop<'p>>,
    ) -> Self {
        debug_assert!(
            index < length,
            "loop index {index} out of bounds for length {length}",
        );
        Loop {
            index0: index,
            index1: index + 1,
            rindex0: length - 1 - index,
            rindex1: length - index,
            first: index == 0,
            last: index + 1 == length,
            length,
            // 1-based nesting depth, derived from the borrowed enclosing loop —
            // no extra state. Mirrors the interpreter's `enclosingLoop.depth + 1`.
            depth: parent.map_or(0, |p| p.depth) + 1,
            key,
            parent,
        }
    }

    /// The outermost enclosing loop (`loop.root`) — `self` when this loop is
    /// itself the outermost. Walks the [`parent`](Loop::parent) chain.
    #[must_use]
    pub fn root(&self) -> &Loop<'p> {
        let mut cur = self;
        while let Some(p) = cur.parent {
            cur = p;
        }
        cur
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_iteration_indices() {
        let l = Loop::at(0, 3, None, None);
        assert_eq!(l.index0, 0);
        assert_eq!(l.index1, 1);
        assert_eq!(l.rindex0, 2);
        assert_eq!(l.rindex1, 3);
        assert!(l.first);
        assert!(!l.last);
        assert_eq!(l.length, 3);
        assert_eq!(l.key, None);
        assert!(l.parent.is_none());
        // an outermost loop is depth 1.
        assert_eq!(l.depth, 1);
    }

    #[test]
    fn middle_iteration_indices() {
        let l = Loop::at(1, 3, None, None);
        assert_eq!(l.index0, 1);
        assert_eq!(l.index1, 2);
        assert_eq!(l.rindex0, 1);
        assert_eq!(l.rindex1, 2);
        assert!(!l.first);
        assert!(!l.last);
    }

    #[test]
    fn last_iteration_indices() {
        let l = Loop::at(2, 3, None, None);
        assert_eq!(l.index0, 2);
        assert_eq!(l.rindex0, 0);
        assert_eq!(l.rindex1, 1);
        assert!(!l.first);
        assert!(l.last);
    }

    #[test]
    fn single_element_is_both_first_and_last() {
        let l = Loop::at(0, 1, None, None);
        assert!(l.first);
        assert!(l.last);
        assert_eq!(l.rindex0, 0);
    }

    #[test]
    fn map_iteration_carries_the_key() {
        let l = Loop::at(0, 2, Some("name"), None);
        assert_eq!(l.key, Some("name"));
    }

    #[test]
    fn parent_points_at_the_enclosing_loop() {
        let outer = Loop::at(0, 2, None, None);
        let inner = Loop::at(1, 3, None, Some(&outer));
        let parent = inner.parent.expect("inner has a parent");
        assert_eq!(parent.index0, 0);
        assert_eq!(parent.length, 2);
        assert!(std::ptr::eq(parent, &outer));
    }

    #[test]
    fn root_walks_to_the_outermost_loop() {
        let a = Loop::at(0, 1, None, None);
        let b = Loop::at(0, 1, None, Some(&a));
        let c = Loop::at(0, 1, None, Some(&b));
        // Three levels deep: root is the outermost, `a`.
        assert!(std::ptr::eq(c.root(), &a));
        assert!(std::ptr::eq(b.root(), &a));
    }

    #[test]
    fn root_of_the_outermost_loop_is_itself() {
        let a = Loop::at(0, 1, None, None);
        assert!(std::ptr::eq(a.root(), &a));
    }

    #[test]
    fn depth_counts_loop_nesting_one_based() {
        let a = Loop::at(0, 1, None, None);
        let b = Loop::at(0, 1, None, Some(&a));
        let c = Loop::at(0, 1, None, Some(&b));
        assert_eq!(a.depth, 1);
        assert_eq!(b.depth, 2);
        assert_eq!(c.depth, 3);
        // `loop.parent.depth` is the enclosing loop's depth.
        assert_eq!(c.parent.map(|p| p.depth), Some(2));
    }
}
