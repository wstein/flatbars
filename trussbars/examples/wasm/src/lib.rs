//! **Trussbars in a no_std WASM module** (the N1 portability proof, docs/24).
//!
//! The strategy review found the one genuinely empty room for a Rust template engine: `no_std` +
//! WASM text/config generation, where Askama / Sailfish / minijinja all pull `std` and so don't
//! compete. The portability was *asserted* but not *demonstrated* — this crate demonstrates it: the
//! bytecode VM (`trussbars-vm`, `no_std + alloc + forbid(unsafe)`) renders a device-status page
//! inside a bare `wasm32-unknown-unknown` module, with no interpreter to initialize and the
//! injection law intact.
//!
//! - **WASM build** (`cargo build --target wasm32-unknown-unknown`) — `no_std`, a `dlmalloc` global
//!   allocator, an abort panic handler, and a `render_status` export a host (Spin, a Cloudflare
//!   Worker, a browser, wasmtime) calls. Proves the engine compiles + links as a `no_std` wasm
//!   component.
//! - **Native build** (`cargo test`) — the same `status_page` render logic, asserted byte-for-byte.
//!   So CI proves both the portability (the wasm target builds) and the output (the logic is right).

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::collections::BTreeMap;
use alloc::rc::Rc;
use alloc::string::String;

use trussbars_interp::Value;
use trussbars_vm::Program;

// ── the `no_std` wasm runtime bits (one global allocator + an abort panic handler) ──
#[cfg(target_arch = "wasm32")]
#[global_allocator]
static ALLOC: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

/// A status template — the kind of thing an embedded/edge target generates: a tiny HTML fragment.
/// Author-trusted source; `{{ name }}` / `{{ uptime }}` are escaped by default (the injection law
/// holds in wasm exactly as everywhere else).
const STATUS: &str = "<div class=\"status\"><h1>{{ name }}</h1>\
<p>uptime {{ uptime }}h · {% if online %}online{% else %}OFFLINE{% endif %}</p>\
<ul>{% for s in sensors %}<li>{{ s.id }}: {{ s.value }}</li>{% endfor %}</ul></div>";

fn sensor(id: &str, value: f64) -> Value {
    let mut m = BTreeMap::new();
    m.insert("id".into(), Value::Str(Rc::from(id)));
    m.insert("value".into(), Value::Num(value));
    Value::Object(Rc::new(m))
}

/// Render the device-status page through the bytecode VM. The whole point: this runs unchanged in a
/// `no_std` wasm module and on a microcontroller.
pub fn status_page(name: &str, uptime: f64, online: bool, sensors: &[(&str, f64)]) -> String {
    let mut ctx = BTreeMap::new();
    ctx.insert("name".into(), Value::Str(Rc::from(name)));
    ctx.insert("uptime".into(), Value::Num(uptime));
    ctx.insert("online".into(), Value::Bool(online));
    ctx.insert(
        "sensors".into(),
        Value::Array(Rc::from(
            sensors
                .iter()
                .map(|(i, v)| sensor(i, *v))
                .collect::<alloc::vec::Vec<_>>(),
        )),
    );
    // A compile-once Program; `unwrap` is sound — the template is a trusted compile-time constant.
    Program::compile(STATUS)
        .expect("status template compiles")
        .render(&Value::Object(Rc::new(ctx)))
        .expect("status template renders")
}

// ── the wasm export: render a demo page and hand the host its (ptr, len) ──
//
// The host instantiates the module, calls `render_status`, and reads `len` UTF-8 bytes at `ptr`
// from the module's linear memory. (`alloc`/`dealloc` round out a real ABI; a fixed-demo render is
// enough to prove the engine runs in wasm.)
#[cfg(target_arch = "wasm32")]
#[unsafe(no_mangle)]
pub extern "C" fn render_status() -> u64 {
    let html = status_page("edge-node-7", 128.0, true, &[("temp", 21.4), ("rh", 47.0)]);
    let bytes = html.into_bytes();
    let ptr = bytes.as_ptr() as u64;
    let len = bytes.len() as u64;
    core::mem::forget(bytes); // leak to the host, which owns it after this call
    (ptr << 32) | len
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_page_renders_the_device_status() {
        let html = status_page("edge-node-7", 128.0, true, &[("temp", 21.4), ("rh", 47.0)]);
        assert_eq!(
            html,
            "<div class=\"status\"><h1>edge-node-7</h1>\
<p>uptime 128h · online</p>\
<ul><li>temp: 21.4</li><li>rh: 47</li></ul></div>"
        );
    }

    #[test]
    fn offline_branch_and_empty_sensors() {
        let html = status_page("probe", 0.0, false, &[]);
        assert!(html.contains("OFFLINE"), "{html}");
        assert!(html.contains("<ul></ul>"), "{html}");
    }

    #[test]
    fn untrusted_sensor_id_is_escaped_in_wasm_too() {
        // The injection law holds here: a hostile sensor id is escaped, not rendered as markup.
        let html = status_page("n", 1.0, true, &[("<script>x</script>", 1.0)]);
        assert!(html.contains("&lt;script&gt;"), "{html}");
        assert!(!html.contains("<script>"), "{html}");
    }
}
