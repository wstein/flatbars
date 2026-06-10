use trussbars_macros::truss;

// Emit-class: `{% yield %}` is only meaningful inside a block partial.
truss!(render, str, "{% yield %}");

fn main() {}
