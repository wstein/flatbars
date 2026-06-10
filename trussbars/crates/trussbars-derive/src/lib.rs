//! `#[derive(Trussbars)]` — the companion derive for Trussbars context types.
//!
//! A context type's truthiness is **policy-independent** — an inhabited object is
//! truthy under every rule — so the derive generates a blanket
//! [`trussbars_core::TruthyIn<__TruthMode>`] impl that holds for `NonEmpty`,
//! `Liquid`, `Handlebars`, and any host-defined policy alike.
//!
//! **Struct.** Under the `nonEmpty` rule an inhabited object is truthy, so a struct
//! with ≥1 field derives `true` and a field-less struct derives `false` (matching
//! `Object.keys(v).length > 0`). It deliberately does **not** generate
//! [`trussbars_core::ToText`] — `{{struct}}` stays a compile error, the typed
//! counterpart of the interpreter's runtime "cannot stringify an object" (subset
//! spec §2, runtime API §3/§12).
//!
//! **Enum.** Every value is an inhabited variant, so it is always truthy (matching a
//! serde-tagged object being non-empty). A **fieldless** enum (all unit variants)
//! additionally derives `ToText` writing the variant *name* — matching serde's
//! unit-variant serialization (`Status::Active` → `"Active"`), so `{{status}}`
//! renders the name and `{% if (eq status "Active") %}` works. An enum with
//! **data-carrying** variants gets truthiness only; field-access dispatch over its
//! variants is the §4.1 polymorphic-dispatch work (a `match`, type-aware → v2).
//!
//! Deriving on a union is a compile error.

use proc_macro::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Fields, parse_macro_input, parse_quote};

/// Derive Trussbars context support (a policy-independent `TruthyIn`, and `ToText`
/// for a unit enum) — see the crate docs.
#[proc_macro_derive(Trussbars)]
pub fn derive_trussbars(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();

    // A context type is truthy under *every* policy, so the `TruthyIn` impl is generic
    // over the mode marker — `impl<__TruthMode, …> TruthyIn<__TruthMode> for T`. The
    // extra parameter goes only on the impl, never on the Self type.
    let mut mode_generics = input.generics.clone();
    mode_generics.params.insert(0, parse_quote!(__TruthMode));
    let (mode_impl_generics, _, _) = mode_generics.split_for_impl();

    match &input.data {
        Data::Struct(data) => {
            // nonEmpty: a struct with ≥1 field is truthy; a unit struct is falsy.
            let truthy = match &data.fields {
                Fields::Named(f) => !f.named.is_empty(),
                Fields::Unnamed(f) => !f.unnamed.is_empty(),
                Fields::Unit => false,
            };
            quote! {
                impl #mode_impl_generics ::trussbars_core::TruthyIn<__TruthMode> for #name #ty_generics #where_clause {
                    fn truthy(&self) -> bool { #truthy }
                }
            }
            .into()
        }
        Data::Enum(data) => {
            // An enum value is always an inhabited variant → truthy.
            let truthy_impl = quote! {
                impl #mode_impl_generics ::trussbars_core::TruthyIn<__TruthMode> for #name #ty_generics #where_clause {
                    fn truthy(&self) -> bool { true }
                }
            };
            // A fieldless (unit-only) enum also stringifies to the variant name.
            let unit_only = !data.variants.is_empty()
                && data
                    .variants
                    .iter()
                    .all(|v| matches!(v.fields, Fields::Unit));
            if unit_only {
                let arms = data.variants.iter().map(|v| {
                    let vi = &v.ident;
                    let vs = vi.to_string();
                    quote! { #name::#vi => #vs }
                });
                quote! {
                    #truthy_impl
                    impl #impl_generics ::trussbars_core::ToText for #name #ty_generics #where_clause {
                        fn write_text(&self, out: &mut String) {
                            out.push_str(match self { #(#arms),* });
                        }
                    }
                }
                .into()
            } else {
                // Data-carrying variants: truthiness only (dispatch deferred, §4.1).
                truthy_impl.into()
            }
        }
        Data::Union(_) => {
            syn::Error::new_spanned(name, "#[derive(Trussbars)] cannot be derived for a union")
                .to_compile_error()
                .into()
        }
    }
}
