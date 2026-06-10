# truthiness — selectable truthiness policies

A focused dogfood of Trussbars' selectable truthiness policies
([`docs/16-truthiness-modes.md`](../../docs/16-truthiness-modes.md)). One rule —
`nonEmpty` minus numbers — is the default and the only conformance-checked policy; a
template (or a VM render, or a host's own code) may opt into another family's semantics.

```sh
cargo run    # prints the demos
cargo test   # asserts each policy's divergence
```

It shows the policy at all three layers it lives at:

1. **AOT — `truss!(…, truthiness = Mode)`.** The same `{{#if items}}` template compiled
   under `NonEmpty` and `Liquid`: an empty list is *falsy* under the default, *truthy*
   under Liquid. A bare-number condition (`{{#if count}}`) does not compile under
   `NonEmpty` (§5.3) — it appears only under `Handlebars` (`0` falsy) and `Liquid`
   (`0` truthy).
2. **VM — `Template::with_truthiness(mode)`.** The dynamic backend selects a policy at
   load time, over data whose shape isn't known at compile time.
3. **Library — a host-defined policy.** `NonBlank` is a local marker, so `impl
   TruthyIn<NonBlank> for str` is allowed even though both the trait and `str` are
   foreign (the orphan rule's covered-parameter case) — a rule the built-ins don't offer
   (a whitespace-only string is falsy).

Every policy is a zero-sized marker, fully monomorphized: selecting one costs nothing at
runtime. Only `NonEmpty` is conformance-checked; the rest are loud, opt-in divergences.
