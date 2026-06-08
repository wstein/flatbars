//! # trussbars-studio
//!
//! **Trussbars Studio** — a *local* IDE for inspecting your Trussbars app (docs/10).
//! It behaves like an editor over your filesystem: open `.truss` templates and `.json`
//! data, edit, and see the render, the data→output provenance, the AOT-compat verdict,
//! and the emitted Rust — **with your own compiled, registered helpers**, because the
//! engine runs *in this process*.
//!
//! You build a tiny binary in your project:
//!
//! ```no_run
//! use std::rc::Rc;
//! use trussbars_vm::{Helpers, Value};
//!
//! let mut helpers = Helpers::new();
//! helpers.register("shout", |args| {
//!     let s = match args.first() { Some(Value::Str(s)) => s.to_string(), _ => String::new() };
//!     Ok(Value::Str(Rc::from(format!("{}!", s.to_uppercase()).as_str())))
//! });
//! trussbars_studio::serve(Rc::new(helpers), "templates", "127.0.0.1:3000").unwrap();
//! ```
//!
//! Then `cargo run --bin studio`, open the printed URL, and edit your templates. The
//! browser is purely the **viewer**; this process is the engine, so your compiled
//! helpers "just work" via the [`trussbars_vm::inspect`] API.
//!
//! The HTTP server is a minimal, dependency-free std-`net` loop (single-threaded — a
//! local dev tool), serving four JSON/file endpoints the embedded IDE drives.

use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use serde_json::Value as Json;
use trussbars_vm::{Helpers, Value, inspect};

const INDEX_HTML: &str = include_str!("index.html");

/// Launch the Studio IDE over `root` (your template directory), serving on `addr`.
/// `helpers` is *your* registry — the inspect endpoint renders with it, so your custom
/// helpers are available. Blocks, serving until the process is killed.
///
/// # Errors
/// If the listener cannot bind `addr`.
pub fn serve(helpers: Rc<Helpers>, root: impl Into<PathBuf>, addr: &str) -> io::Result<()> {
    let root = root.into();
    let listener = TcpListener::bind(addr)?;
    println!("Trussbars Studio → http://{addr}  (templates: {})", root.display());
    for mut stream in listener.incoming().flatten() {
        // Per-connection errors (a dropped client) are non-fatal.
        let _ = handle(&mut stream, &helpers, &root);
    }
    Ok(())
}

struct Request {
    method: String,
    path: String,
    query: String,
    body: Vec<u8>,
}

fn handle(stream: &mut TcpStream, helpers: &Rc<Helpers>, root: &Path) -> io::Result<()> {
    let Some(req) = read_request(stream)? else { return Ok(()) };
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/") => respond(stream, "200 OK", "text/html; charset=utf-8", INDEX_HTML.as_bytes()),
        ("GET", "/api/files") => respond(stream, "200 OK", JSON, list_files(root).as_bytes()),
        ("GET", "/api/file") => match read_file(root, &query_path(&req.query)) {
            Ok(text) => respond(stream, "200 OK", "text/plain; charset=utf-8", text.as_bytes()),
            Err(e) => respond(stream, "404 Not Found", "text/plain", e.as_bytes()),
        },
        ("PUT", "/api/file") => match write_file(root, &query_path(&req.query), &req.body) {
            Ok(()) => respond(stream, "200 OK", "text/plain", b"saved"),
            Err(e) => respond(stream, "400 Bad Request", "text/plain", e.as_bytes()),
        },
        ("POST", "/api/inspect") => respond(stream, "200 OK", JSON, do_inspect(&req.body, helpers).as_bytes()),
        _ => respond(stream, "404 Not Found", "text/plain", b"not found"),
    }
}

const JSON: &str = "application/json; charset=utf-8";

// ── endpoints ─────────────────────────────────────────────────────────────────

/// `{template, data}` → the full [`trussbars_vm::Inspection`] JSON, rendered with the
/// host's registered `helpers` (so custom helpers work).
fn do_inspect(body: &[u8], helpers: &Rc<Helpers>) -> String {
    let req: Json = serde_json::from_slice(body).unwrap_or(Json::Null);
    let template = req.get("template").and_then(Json::as_str).unwrap_or("");
    let data = from_json(req.get("data").unwrap_or(&Json::Null));
    inspect(template, &data, helpers).to_json()
}

/// A JSON array of the `.truss` / `.json` files under `root` (relative paths).
fn list_files(root: &Path) -> String {
    let mut files = Vec::new();
    collect(root, root, &mut files);
    files.sort();
    let items: Vec<String> = files.iter().map(|p| jstr(p)).collect();
    format!("[{}]", items.join(","))
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, out);
        } else if matches!(path.extension().and_then(|e| e.to_str()), Some("truss" | "json"))
            && let Ok(rel) = path.strip_prefix(root)
        {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

fn read_file(root: &Path, rel: &str) -> Result<String, String> {
    let path = safe_join(root, rel)?;
    fs::read_to_string(&path).map_err(|e| format!("read {rel}: {e}"))
}

fn write_file(root: &Path, rel: &str, body: &[u8]) -> Result<(), String> {
    let path = safe_join(root, rel)?;
    fs::write(&path, body).map_err(|e| format!("write {rel}: {e}"))
}

/// Join `rel` under `root`, rejecting any path that escapes the root (no `..`).
fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.split(['/', '\\']).any(|seg| seg == ".." || seg.is_empty()) {
        return Err(format!("unsafe path: {rel:?}"));
    }
    Ok(root.join(rel))
}

// ── tiny HTTP + helpers ───────────────────────────────────────────────────────

fn read_request(stream: &mut TcpStream) -> io::Result<Option<Request>> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Ok(None);
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target, String::new()),
    };
    let mut content_length = 0usize;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            break;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((k, v)) = header.split_once(':')
            && k.eq_ignore_ascii_case("content-length")
        {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body)?;
    Ok(Some(Request { method, path, query, body }))
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) -> io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

/// The `path=` query parameter, percent-decoded.
fn query_path(query: &str) -> String {
    query
        .split('&')
        .find_map(|kv| kv.strip_prefix("path="))
        .map(percent_decode)
        .unwrap_or_default()
}

fn percent_decode(s: &str) -> String {
    let replaced = s.replace('+', " ");
    let bytes = replaced.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(b) = u8::from_str_radix(&replaced[i + 1..i + 3], 16)
        {
            out.push(b);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `serde_json::Value` → the VM's dynamic [`Value`].
fn from_json(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Num(n.as_f64().unwrap_or(0.0)),
        Json::String(s) => Value::Str(Rc::from(s.as_str())),
        Json::Array(a) => Value::Array(a.iter().map(from_json).collect::<Vec<_>>().into()),
        Json::Object(o) => {
            Value::Object(Rc::new(o.iter().map(|(k, v)| (k.clone(), from_json(v))).collect()))
        }
    }
}

/// A JSON string literal (the escapes JSON requires).
fn jstr(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

#[cfg(test)]
mod tests {
    use super::{percent_decode, query_path, safe_join};
    use std::path::Path;

    #[test]
    fn query_and_decode() {
        assert_eq!(query_path("path=templates%2Fpost.truss&x=1"), "templates/post.truss");
        assert_eq!(percent_decode("a%20b"), "a b");
    }

    #[test]
    fn safe_join_rejects_escape() {
        let root = Path::new("/tmp/root");
        assert!(safe_join(root, "../etc/passwd").is_err());
        assert!(safe_join(root, "ok/file.truss").is_ok());
    }
}
