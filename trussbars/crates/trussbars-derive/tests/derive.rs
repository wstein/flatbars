//! Integration tests for `#[derive(Trussbars)]`. A proc-macro cannot be used in
//! the crate that defines it, so these live in `tests/` (a separate crate) with
//! `trussbars-core` as a dev-dependency.
//!
//! Fixture fields are never read (the derive inspects only field *count*), so
//! dead-code is allowed for the whole fixture module.
#![allow(dead_code)]

use trussbars_core::{Handlebars, Liquid, truthy, truthy_in};
use trussbars_derive::Trussbars;

#[derive(Trussbars)]
struct WithFields {
    a: i32,
    b: String,
}

#[derive(Trussbars)]
struct TupleStruct(i32, i32);

#[derive(Trussbars)]
struct Unit;

#[derive(Trussbars)]
struct Generic<T> {
    x: T,
}

// A fieldless enum: truthy + stringifies to the variant name (serde unit form).
#[derive(Trussbars)]
enum Status {
    Active,
    Pending,
    Closed,
}

// A data-carrying enum: truthy, but no ToText (field-access dispatch is §4.1/v2).
#[derive(Trussbars)]
enum Shape {
    Circle { radius: f64 },
    Square(f64),
}

#[test]
fn struct_with_named_fields_is_truthy() {
    let v = WithFields {
        a: 0,
        b: String::new(),
    };
    // Truthy even though every field is itself "falsy" — an inhabited object is
    // truthy under nonEmpty regardless of its contents.
    assert!(truthy(&v));
}

#[test]
fn tuple_struct_with_fields_is_truthy() {
    assert!(truthy(&TupleStruct(0, 0)));
}

#[test]
fn unit_struct_is_falsy() {
    // A field-less struct is the {} case: falsy under nonEmpty.
    assert!(!truthy(&Unit));
}

#[test]
fn generic_struct_is_truthy() {
    assert!(truthy(&Generic { x: 0_i64 }));
}

#[test]
fn unit_enum_is_truthy_and_stringifies_to_the_variant_name() {
    assert!(truthy(&Status::Active));
    let mut s = String::new();
    trussbars_core::ToText::write_text(&Status::Pending, &mut s);
    assert_eq!(s, "Pending");
}

#[test]
fn data_enum_is_truthy() {
    // Truthy (an inhabited variant) but no ToText — `{{shape}}` stays a compile
    // error; variant field access is the deferred §4.1 dispatch.
    assert!(truthy(&Shape::Circle { radius: 1.0 }));
    assert!(truthy(&Shape::Square(2.0)));
}

#[test]
fn derived_truthiness_is_policy_independent() {
    // The generated `TruthyIn<__TruthMode>` impl holds under every policy: an
    // inhabited object is truthy whether the template renders under NonEmpty,
    // Liquid, or Handlebars, and a unit struct is falsy under all three.
    let v = WithFields {
        a: 0,
        b: String::new(),
    };
    assert!(truthy_in::<Liquid, _>(&v));
    assert!(truthy_in::<Handlebars, _>(&v));
    assert!(!truthy_in::<Liquid, _>(&Unit));
    assert!(!truthy_in::<Handlebars, _>(&Unit));
    // Generic context types keep the extra mode parameter off the Self type.
    assert!(truthy_in::<Liquid, _>(&Generic { x: 0_i64 }));
    assert!(truthy_in::<Handlebars, _>(&Status::Active));
}
