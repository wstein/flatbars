use trussbars_macros::truss;

// Arity-class: a fixed-arity stdlib op called with the wrong number of arguments
// (`uppercase` takes one). Rejected before codegen with a located, owned message.
truss!(render, str, "{{uppercase a b}}");

fn main() {}
