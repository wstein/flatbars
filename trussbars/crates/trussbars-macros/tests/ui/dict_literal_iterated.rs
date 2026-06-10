use trussbars_macros::truss;

// Dict-literal-class: a `{k: v}` literal cannot be iterated; bind and read fields.
truss!(render, str, "{% for {a: 1} %}{{this}}{% endfor %}");

fn main() {}
