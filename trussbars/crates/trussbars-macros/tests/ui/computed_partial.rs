use trussbars_macros::truss;

// §4.1 injection-class: a *computed* partial name lets data choose which partial
// renders (the SSTI / confused-deputy shape). Trussbars owns this rejection.
truss!(render, str, "{% include (lookup this \"kind\") %}");

fn main() {}
