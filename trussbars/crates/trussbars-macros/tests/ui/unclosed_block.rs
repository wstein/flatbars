use trussbars_macros::truss;

// A parse error (an `{% each %}` with no `{% endeach %}`) is class-A: the recovering
// parser owns the located message.
truss!(render, str, "{% each items %}{{this}}");

fn main() {}
