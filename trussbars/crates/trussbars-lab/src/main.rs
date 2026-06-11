//! `trussbars-lab` — the `trussbars lab [dir]` local dev transport binary. Serves the
//! static FlatBars Lab and the root-jailed `/__fs/*` file bridge over a launch
//! directory (std-only socket loop; all logic lives in the unit-tested library). The
//! engine is in-page wasm, so this server never renders.
//!
//!   trussbars-lab [projectDir] [--write] [--port N] [--lab-root PATH]
//!
//! Defaults: projectDir = `.`; port = 0 (a random free port); lab-root = `./lab` (where
//! the static Lab bundle lives). Binds 127.0.0.1 only; read-only unless `--write`.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;

use trussbars_lab::{
    handle_fs, inject_token, jail, make_token, mime_for, parse_head, split_target, Req, Resp,
};

fn main() {
    let mut project = PathBuf::from(".");
    let mut lab_root = PathBuf::from("./lab");
    let mut allow_write = false;
    let mut port: u16 = 0;

    let mut args = std::env::args().skip(1).peekable();
    while let Some(a) = args.next() {
        match a.as_str() {
            "--write" => allow_write = true,
            "--port" => port = args.next().and_then(|p| p.parse().ok()).unwrap_or(0),
            "--lab-root" => {
                if let Some(p) = args.next() {
                    lab_root = PathBuf::from(p);
                }
            }
            other if !other.starts_with("--") => project = PathBuf::from(other),
            other => {
                eprintln!("trussbars-lab: unknown flag {other}");
                std::process::exit(2);
            }
        }
    }

    let project = project.canonicalize().unwrap_or(project);
    let lab_root = lab_root.canonicalize().unwrap_or(lab_root);
    let token = make_token();

    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("trussbars-lab: cannot bind 127.0.0.1:{port}: {e}");
            std::process::exit(1);
        }
    };
    let bound = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    eprintln!("FlatBars Lab (local)  → http://127.0.0.1:{bound}/lab/");
    eprintln!(
        "  FS bridge   /__fs/*  jailed to {}  ({})",
        project.display(),
        if allow_write { "read+write" } else { "read-only" }
    );
    eprintln!("  session token: {}…  (injected as window.__FB_TOKEN)", &token[..8.min(token.len())]);
    eprintln!("  bound to 127.0.0.1 only · Ctrl-C to stop");

    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let (project, lab_root, token) = (project.clone(), lab_root.clone(), token.clone());
        thread::spawn(move || {
            if let Err(e) = serve(stream, &project, &lab_root, &token, allow_write, bound) {
                eprintln!("trussbars-lab: connection error: {e}");
            }
        });
    }
}

fn serve(mut stream: TcpStream, project: &Path, lab_root: &Path, token: &str, allow_write: bool, port: u16) -> std::io::Result<()> {
    // Read until the header terminator, then any declared body.
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        let n = stream.read(&mut chunk)?;
        if n == 0 {
            return Ok(()); // client closed
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = find_subslice(&buf, b"\r\n\r\n") {
            break i;
        }
        if buf.len() > 64 * 1024 {
            return write_resp(&mut stream, &Resp::text(431, "Request Header Fields Too Large", "header too large"));
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let Some((method, target, headers)) = parse_head(&head) else {
        return write_resp(&mut stream, &Resp::text(400, "Bad Request", "bad request"));
    };
    let (path, query) = split_target(&target);

    // Read the body (Content-Length) for writes.
    let mut body = buf[head_end + 4..].to_vec();
    if let Some(len) = headers.get("content-length").and_then(|v| v.parse::<usize>().ok()) {
        while body.len() < len {
            let n = stream.read(&mut chunk)?;
            if n == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..n]);
        }
        body.truncate(len);
    }

    let resp = route(&method, &path, query, headers, body, project, lab_root, token, allow_write, port);
    write_resp(&mut stream, &resp)
}

#[allow(clippy::too_many_arguments)]
fn route(
    method: &str,
    path: &str,
    query: std::collections::BTreeMap<String, String>,
    headers: std::collections::BTreeMap<String, String>,
    body: Vec<u8>,
    project: &Path,
    lab_root: &Path,
    token: &str,
    allow_write: bool,
    port: u16,
) -> Resp {
    if path.starts_with("/__fs/") {
        let req = Req { method: method.into(), path: path.into(), query, headers, body };
        let origin = format!("http://127.0.0.1:{port}");
        return handle_fs(project, &req, token, allow_write, Some(&origin));
    }
    if method != "GET" {
        return Resp::text(405, "Method Not Allowed", "method not allowed");
    }
    // `/` → the Lab.
    if path == "/" {
        return Resp { code: 301, reason: "Moved Permanently", ctype: "text/plain; charset=utf-8", body: b"/lab/".to_vec() };
    }
    // The Lab index — token-injected so the in-page provider can authenticate.
    if (path == "/lab/" || path == "/lab/index.html")
        && let Ok(html) = std::fs::read_to_string(lab_root.join("index.html"))
    {
        return Resp { code: 200, reason: "OK", ctype: "text/html; charset=utf-8", body: inject_token(&html, token).into_bytes() };
    }
    // Static assets under the lab root (strip the `/lab/` mount prefix).
    let rel = path.strip_prefix("/lab/").unwrap_or(path.trim_start_matches('/'));
    match jail(lab_root, rel) {
        Some(abs) => match std::fs::read(&abs) {
            Ok(bytes) => Resp { code: 200, reason: "OK", ctype: mime_for(path), body: bytes },
            Err(_) => Resp::text(404, "Not Found", format!("404 not found: {path}")),
        },
        None => Resp::text(403, "Forbidden", "forbidden"),
    }
}

fn write_resp(stream: &mut TcpStream, resp: &Resp) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        resp.code,
        resp.reason,
        resp.ctype,
        resp.body.len(),
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(&resp.body)?;
    stream.flush()
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}
