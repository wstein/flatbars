use trussbars_macros::truss;

// Parse-class: a close tag naming a different block than the open. Now a located,
// owned diagnostic (previously this slipped through to a class-B rustc error).
truss!(render, str, "{% each items %}{{this}}{% endwith %}");

fn main() {}
