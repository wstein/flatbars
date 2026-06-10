use trussbars_macros::truss;

// §4.2 injection-class: `apply` selects a helper by a data string.
truss!(render, str, "{{apply op x}}");

fn main() {}
