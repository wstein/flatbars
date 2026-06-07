//! Integration tests for `#[derive(Trussbars)]`. A proc-macro cannot be used in
//! the crate that defines it, so these live in `tests/` (a separate crate) with
//! `trussbars-core` as a dev-dependency.
//!
//! Fixture fields are never read (the derive inspects only field *count*), so
//! dead-code is allowed for the whole fixture module.
#![allow(dead_code)]

use trussbars_core::truthy;
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
