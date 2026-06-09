//! The render function, compiled from `templates/cart.truss` by the `truss!` macro.
//! It calls the host `t` helper (this crate's Fluent-backed one), declared in the
//! per-call `helpers = [t]` allow-list.
use crate::Cart;
use crate::t;
use trussbars_macros::truss;

truss!(
    render_cart,
    Cart,
    path = "templates/cart.truss",
    helpers = [t]
);
