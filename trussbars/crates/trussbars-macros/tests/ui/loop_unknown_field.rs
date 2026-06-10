use trussbars_macros::truss;

// Loop-metadata-class: an unknown field on the loop frame.
truss!(render, str, "{% for items %}{{loop.bogus}}{% endfor %}");

fn main() {}
