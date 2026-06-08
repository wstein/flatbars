use trussbars_macros::truss;

// An unknown helper is class-A: Trussbars owns the error and locates it (1:8, the
// `{{` of the tag) rather than letting rustc complain about generated code.
truss!(render, str, "<title>{{name | bogus}}</title>");

fn main() {}
