use trussbars_macros::truss;

// An unrecognized `truthiness = Mode` is class-A: Trussbars owns the error and names
// the valid modes rather than letting rustc complain about generated code.
truss!(render, str, "{% if name %}x{% endif %}", truthiness = Mustache);

fn main() {}
