//! The `trussbars lab` local dev transport — the root-jailed `/__fs/*` file bridge and
//! its static server, std-only (no HTTP crate). The engine is in-page wasm, so this
//! server NEVER renders: it is purely a FileProvider transport
//! (PLAN-registry-local-trussbars.md, Phase 5; the Rust port of scripts/lab-server.mjs).
//!
//! Security baseline (all non-negotiable):
//! - Root-jail — every `/__fs/*` path resolves under the launch dir; escapes 403.
//! - Session token — a per-run secret required (`x-fb-token`) on every bridge request, injected into the served page as `window.__FB_TOKEN`.
//! - Read-only by default — writes only behind `--write`.
//! - Bind 127.0.0.1 only; reject cross-origin callers via the `Origin` header.
//!
//! The request/response logic is factored into pure functions ([`handle_fs`], [`jail`],
//! [`parse_head`]) so it is unit-testable without a socket; `main.rs` is the thin loop.

use std::collections::BTreeMap;
use std::collections::hash_map::RandomState;
use std::fs;
use std::hash::{BuildHasher, Hasher};
use std::path::{Component, Path, PathBuf};

/// A parsed HTTP request (the subset the bridge needs).
#[derive(Debug, Clone)]
pub struct Req {
    /// The HTTP method (`GET`, `POST`, …).
    pub method: String,
    /// The request path, without the query string (e.g. `/__fs/read`).
    pub path: String,
    /// The decoded query parameters.
    pub query: BTreeMap<String, String>,
    /// The request headers, with lowercased keys.
    pub headers: BTreeMap<String, String>,
    /// The request body (non-empty only for writes).
    pub body: Vec<u8>,
}

/// A response to write back.
#[derive(Debug, Clone)]
pub struct Resp {
    /// The HTTP status code.
    pub code: u16,
    /// The HTTP reason phrase.
    pub reason: &'static str,
    /// The `Content-Type` header value.
    pub ctype: &'static str,
    /// The response body.
    pub body: Vec<u8>,
}

impl Resp {
    /// A `text/plain` response with the given status + body.
    pub fn text(code: u16, reason: &'static str, body: impl Into<Vec<u8>>) -> Resp {
        Resp { code, reason, ctype: "text/plain; charset=utf-8", body: body.into() }
    }
    /// A `200 OK` `application/json` response.
    pub fn json(body: impl Into<Vec<u8>>) -> Resp {
        Resp { code: 200, reason: "OK", ctype: "application/json; charset=utf-8", body: body.into() }
    }
    fn forbidden(why: &str) -> Resp {
        Resp::text(403, "Forbidden", format!("forbidden: {why}"))
    }
}

/// Resolve `rel` under `root`, or `None` if it escapes the jail. Any `..` / absolute /
/// root-dir component is rejected outright (stronger than a lexical prefix check), then
/// the result is verified to still start with `root`.
pub fn jail(root: &Path, rel: &str) -> Option<PathBuf> {
    let decoded = percent_decode(rel);
    let trimmed = decoded.trim_start_matches('/');
    let mut out = root.to_path_buf();
    for part in trimmed.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        // Reject anything that isn't a plain file/dir name.
        let p = Path::new(part);
        let mut comps = p.components();
        match (comps.next(), comps.next()) {
            (Some(Component::Normal(seg)), None) => out.push(seg),
            _ => return None,
        }
    }
    if out == root || out.starts_with(root) {
        Some(out)
    } else {
        None
    }
}

/// The `/__fs/*` bridge handler over `root`. Enforces the token, the CSRF `Origin`
/// guard, and the jail; serves `read` / `list`, and `write` only when `allow_write`.
pub fn handle_fs(root: &Path, req: &Req, token: &str, allow_write: bool, origin: Option<&str>) -> Resp {
    // (2) Session token.
    if req.headers.get("x-fb-token").map(String::as_str) != Some(token) {
        return Resp::forbidden("bad or missing token");
    }
    // CSRF — reject a cross-origin caller. A same-origin fetch omits Origin (GET) or
    // sends our own; anything else is rejected.
    if let (Some(req_origin), Some(server_origin)) = (req.headers.get("origin"), origin)
        && req_origin != server_origin
    {
        return Resp::forbidden("cross-origin");
    }

    let op = req.path.strip_prefix("/__fs/").unwrap_or("");
    let rel = req.query.get("path").map(String::as_str).unwrap_or("");

    match (op, req.method.as_str()) {
        ("read", "GET") => match jail(root, rel) {
            None => Resp::forbidden("path escapes the launch directory"),
            Some(abs) => match fs::read(&abs) {
                Ok(bytes) => Resp { code: 200, reason: "OK", ctype: "text/plain; charset=utf-8", body: bytes },
                Err(e) => not_found_or_500(&e, "read"),
            },
        },
        ("list", "GET") => match jail(root, rel) {
            None => Resp::forbidden("path escapes the launch directory"),
            Some(abs) => match list_dir(&abs) {
                Ok(json) => Resp::json(json),
                Err(e) => not_found_or_500(&e, "list"),
            },
        },
        ("write", "POST") => {
            if !allow_write {
                return Resp::forbidden("server is read-only (start with --write)");
            }
            match jail(root, rel) {
                None => Resp::forbidden("path escapes the launch directory"),
                Some(abs) => match fs::write(&abs, &req.body) {
                    Ok(()) => Resp::text(200, "OK", "ok"),
                    Err(e) => not_found_or_500(&e, "write"),
                },
            }
        }
        _ => Resp::text(404, "Not Found", format!("no such bridge op: {} {op}", req.method)),
    }
}

fn not_found_or_500(e: &std::io::Error, op: &str) -> Resp {
    if e.kind() == std::io::ErrorKind::NotFound {
        Resp::text(404, "Not Found", format!("{op}: not found"))
    } else {
        Resp::text(500, "Internal Server Error", format!("{op} failed: {e}"))
    }
}

/// A directory listing as the bridge's JSON: `[{"name","kind":"file"|"dir"}]`, dirs
/// first then files, each group sorted by name.
fn list_dir(dir: &Path) -> std::io::Result<String> {
    let mut entries: Vec<(String, bool)> = Vec::new();
    for e in fs::read_dir(dir)? {
        let e = e?;
        let is_dir = e.file_type()?.is_dir();
        entries.push((e.file_name().to_string_lossy().into_owned(), is_dir));
    }
    entries.sort_by(|a, b| match (a.1, b.1) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.0.cmp(&b.0),
    });
    let items: Vec<String> = entries
        .iter()
        .map(|(name, is_dir)| format!("{{\"name\":{},\"kind\":\"{}\"}}", json_str(name), if *is_dir { "dir" } else { "file" }))
        .collect();
    Ok(format!("[{}]", items.join(",")))
}

/// Inject the session token into the served Lab page so the in-page `local` provider
/// can authenticate (Phase 6 adds the `<meta fb-transport=local>` that flips boot).
pub fn inject_token(html: &str, token: &str) -> String {
    let tag = format!("<script>window.__FB_TOKEN={};</script>", json_str(token));
    match html.find("</head>") {
        Some(i) => format!("{}{tag}\n{}", &html[..i], &html[i..]),
        None => format!("{tag}{html}"),
    }
}

/// Parse the request head (everything before the blank line): the request line + the
/// headers (lowercased keys). Returns `(method, full-path-with-query, headers)`.
pub fn parse_head(head: &str) -> Option<(String, String, BTreeMap<String, String>)> {
    let mut lines = head.split("\r\n");
    let mut req_line = lines.next()?.split(' ');
    let method = req_line.next()?.to_string();
    let path = req_line.next()?.to_string();
    let mut headers = BTreeMap::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    Some((method, path, headers))
}

/// Split a `/path?a=b&c=d` target into the path and a decoded query map.
pub fn split_target(target: &str) -> (String, BTreeMap<String, String>) {
    let mut query = BTreeMap::new();
    let (path, qs) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q),
        None => (target.to_string(), ""),
    };
    for pair in qs.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        query.insert(percent_decode(k), percent_decode(v));
    }
    (path, query)
}

/// A 24-byte hex session token from the OS-seeded `RandomState` (no extra deps).
pub fn make_token() -> String {
    let mut s = String::with_capacity(48);
    for i in 0..3u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i);
        s.push_str(&format!("{:016x}", h.finish()));
    }
    s
}

/// Minimal `%XX` percent-decoding (the bridge's paths are simple file names).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2]))
        {
            out.push(h * 16 + l);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Escape a string as a JSON string literal (the listing + token injection need it).
fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The MIME type for a path's extension (the static server needs correct types or
/// browsers refuse the module / wasm streaming-compile).
pub fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("");
    match ext {
        "html" => "text/html; charset=utf-8",
        "mjs" | "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" | "jsonc" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "png" => "image/png",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(method: &str, path: &str, query: &[(&str, &str)], headers: &[(&str, &str)]) -> Req {
        Req {
            method: method.into(),
            path: path.into(),
            query: query.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            body: Vec::new(),
        }
    }

    #[test]
    fn jail_resolves_and_rejects_escapes() {
        let root = Path::new("/srv/proj");
        assert_eq!(jail(root, "hello.hbs"), Some(PathBuf::from("/srv/proj/hello.hbs")));
        assert_eq!(jail(root, "./sub/a.txt"), Some(PathBuf::from("/srv/proj/sub/a.txt")));
        assert_eq!(jail(root, "../../etc/passwd"), None);
        assert_eq!(jail(root, "/../etc/passwd"), None);
        assert_eq!(jail(root, "sub/../../escape"), None);
    }

    #[test]
    fn a_missing_or_wrong_token_is_forbidden() {
        let root = Path::new(".");
        assert_eq!(handle_fs(root, &req("GET", "/__fs/read", &[("path", "x")], &[]), "tok", false, None).code, 403);
        assert_eq!(handle_fs(root, &req("GET", "/__fs/read", &[("path", "x")], &[("x-fb-token", "no")]), "tok", false, None).code, 403);
    }

    #[test]
    fn cross_origin_is_rejected_same_origin_allowed() {
        let dir = std::env::temp_dir();
        let server = "http://127.0.0.1:9000".to_string();
        let bad = handle_fs(&dir, &req("GET", "/__fs/list", &[("path", ".")], &[("x-fb-token", "tok"), ("origin", "http://evil.test")]), "tok", false, Some(&server));
        assert_eq!(bad.code, 403);
        let good = handle_fs(&dir, &req("GET", "/__fs/list", &[("path", ".")], &[("x-fb-token", "tok"), ("origin", &server)]), "tok", false, Some(&server));
        assert_eq!(good.code, 200);
    }

    #[test]
    fn read_list_write_round_trip_with_the_jail_and_write_gate() {
        let dir = std::env::temp_dir().join(format!("fb-lab-{}", make_token()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("hello.hbs"), "Hi {{name}}").unwrap();

        let read = handle_fs(&dir, &req("GET", "/__fs/read", &[("path", "hello.hbs")], &[("x-fb-token", "t")]), "t", false, None);
        assert_eq!(read.code, 200);
        assert_eq!(String::from_utf8(read.body).unwrap(), "Hi {{name}}");

        let list = handle_fs(&dir, &req("GET", "/__fs/list", &[("path", ".")], &[("x-fb-token", "t")]), "t", false, None);
        assert!(String::from_utf8(list.body).unwrap().contains("\"hello.hbs\""));

        // write forbidden read-only, allowed under --write, still jailed.
        let mut w = req("POST", "/__fs/write", &[("path", "new.txt")], &[("x-fb-token", "t")]);
        w.body = b"written".to_vec();
        assert_eq!(handle_fs(&dir, &w, "t", false, None).code, 403);
        assert_eq!(handle_fs(&dir, &w, "t", true, None).code, 200);
        assert_eq!(fs::read_to_string(dir.join("new.txt")).unwrap(), "written");
        let mut esc = req("POST", "/__fs/write", &[("path", "../escape.txt")], &[("x-fb-token", "t")]);
        esc.body = b"x".to_vec();
        assert_eq!(handle_fs(&dir, &esc, "t", true, None).code, 403);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn parse_head_and_split_target() {
        let head = "GET /__fs/read?path=a%2Fb.txt HTTP/1.1\r\nHost: x\r\nX-FB-Token: tok\r\n";
        let (m, target, headers) = parse_head(head).unwrap();
        assert_eq!(m, "GET");
        assert_eq!(headers.get("x-fb-token").map(String::as_str), Some("tok"));
        let (path, query) = split_target(&target);
        assert_eq!(path, "/__fs/read");
        assert_eq!(query.get("path").map(String::as_str), Some("a/b.txt"));
    }

    #[test]
    fn inject_token_goes_in_the_head() {
        let out = inject_token("<html><head></head><body></body></html>", "secret");
        assert!(out.contains("window.__FB_TOKEN=\"secret\""));
        assert!(out.find("__FB_TOKEN").unwrap() < out.find("</head>").unwrap());
    }

    #[test]
    fn make_token_is_hex_and_long_enough() {
        let t = make_token();
        assert_eq!(t.len(), 48);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
