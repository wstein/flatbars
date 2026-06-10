use trussbars_macros::truss;

// Loop-metadata-class: `loop` is only bound inside an `{% for %}`.
truss!(render, str, "{{loop.index0}}");

fn main() {}
