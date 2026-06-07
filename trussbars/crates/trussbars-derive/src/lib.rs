//! `#[derive(Trussbars)]` — the companion derive for Trussbars context types.
//!
//! Generates the [`trussbars_core::Truthy`] impl a context struct needs to appear
//! in a condition (`{{#if user}}`) or a `{{#with}}` re-root. Under the `nonEmpty`
//! rule an inhabited object is truthy, so a struct with at least one field derives
//! `true` and a field-less struct derives `false` — matching the reference's
//! `Object.keys(v).length > 0`. The verdict is a per-type compile-time constant.
//!
//! It deliberately does **not** generate [`trussbars_core::ToText`]: a struct has
//! no text form, so `{{struct}}` stays a compile error — the typed counterpart of
//! the interpreter's runtime "cannot stringify an object" (subset spec §2, runtime
//! API §3/§12).
//!
//! Structs only for now; deriving on an enum or union is a compile error. Enum
//! support arrives with the §4.1 polymorphic-dispatch work.

use proc_macro::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Fields, parse_macro_input};

/// Derive [`trussbars_core::Truthy`] for a context struct.
///
/// A struct with fields is truthy; a field-less (unit) struct is falsy. Deriving
/// on an enum or union is a compile error. See the crate docs.
///
/// Deriving on an enum is rejected (struct support only, for now):
///
/// ```compile_fail
/// use trussbars_derive::Trussbars;
/// #[derive(Trussbars)]
/// enum Color { Red, Green }
/// ```
#[proc_macro_derive(Trussbars)]
pub fn derive_trussbars(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;

    let non_empty = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(fields) => !fields.named.is_empty(),
            Fields::Unnamed(fields) => !fields.unnamed.is_empty(),
            Fields::Unit => false,
        },
        Data::Enum(_) => {
            return syn::Error::new_spanned(
                name,
                "#[derive(Trussbars)] supports structs only; enum dispatch (subset spec §4.1) is not yet implemented",
            )
            .to_compile_error()
            .into();
        }
        Data::Union(_) => {
            return syn::Error::new_spanned(
                name,
                "#[derive(Trussbars)] cannot be derived for a union",
            )
            .to_compile_error()
            .into();
        }
    };

    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();

    quote! {
        impl #impl_generics ::trussbars_core::Truthy for #name #ty_generics #where_clause {
            fn truthy(&self) -> bool {
                #non_empty
            }
        }
    }
    .into()
}
