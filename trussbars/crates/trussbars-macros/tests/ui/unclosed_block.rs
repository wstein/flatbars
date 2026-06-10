use trussbars_macros::truss;

// A parse error (an `{% for %}` with no `{% endfor %}`) is class-A: the recovering
// parser owns the located message.
truss!(render, str, "{% for items %}{{this}}");

fn main() {}
