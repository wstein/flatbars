use trussbars_macros::truss;

// Loop-metadata-class: `loop` is only bound inside an `{{#each}}`.
truss!(render, str, "{{loop.index0}}");

fn main() {}
