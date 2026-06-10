use trussbars_macros::truss;

// Loop-metadata-class: an unknown field on the loop frame.
truss!(render, str, "{% each items %}{{loop.bogus}}{% endeach %}");

fn main() {}
