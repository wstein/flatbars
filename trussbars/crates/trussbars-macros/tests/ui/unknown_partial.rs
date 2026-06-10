use trussbars_macros::truss;

// Emit-class: a static partial name with no definition in scope.
truss!(render, str, "{{> nope}}");

fn main() {}
