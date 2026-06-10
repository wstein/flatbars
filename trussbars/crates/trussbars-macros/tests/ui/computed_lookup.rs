use trussbars_macros::truss;

// §4.3 injection-class: a data-derived field name on a record.
truss!(render, str, "{{lookup this key}}");

fn main() {}
