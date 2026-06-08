//! Slice 2 — the MaxBars interior expression grammar → the desugared core [`Expr`].
//!
//! Precedence loosest→tightest (docs/08 §6.2, matching MaxBars/Expr.purs): ternary
//! `? :` (right-assoc), pipe `|`, `??`, `?:`, `||`, `&&`, comparison, `+ - ..`,
//! `* / %`, unary `!`, application (`f a b`), atoms. Desugar: operators → `App`
//! (`a + b` → `App("add",[a,b])`), pipe inserts the piped value first
//! (`a | f x` → `App("f",[a,x])`), paths → `lookup` chains rooted at a scope
//! binding / reserved root / `this`, list/dict literals → `App("list"/"dict", …)`.

use crate::ast::{Expr, Value};

/// The in-scope binding names (block params, `let` aliases, loop labels) — used to
/// root a path at the binding (`App(name, [])`) rather than `this`.
#[derive(Debug, Clone, Default)]
pub struct Scope {
    names: Vec<String>,
}

impl Scope {
    /// An empty scope (the template root).
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether `name` is an in-scope binding.
    #[must_use]
    pub fn has(&self, name: &str) -> bool {
        self.names.iter().any(|n| n == name)
    }

    /// A child scope with `name` added.
    #[must_use]
    pub fn with(&self, name: &str) -> Self {
        let mut names = self.names.clone();
        names.push(name.to_string());
        Self { names }
    }

    /// A child scope with several names added.
    #[must_use]
    pub fn with_all(&self, more: &[String]) -> Self {
        let mut names = self.names.clone();
        names.extend(more.iter().cloned());
        Self { names }
    }
}

/// A parse failure in a tag interior.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// Human-readable reason.
    pub message: String,
    /// Byte offset within the interior where the problem was detected.
    pub at: usize,
}

fn err<T>(message: impl Into<String>, at: usize) -> Result<T, ParseError> {
    Err(ParseError {
        message: message.into(),
        at,
    })
}

// ── tokens ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Ident(String),
    Num(f64),
    Str(String),
    Op(&'static str),
}

/// The multi-char operators, longest first (so `==` beats `=`, `?:` beats `?`).
const OPS: &[&str] = &[
    "==", "!=", "<=", ">=", "&&", "||", "??", "?:", "..", "+", "-", "*", "/", "%", "<", ">", "!",
    "?", ":", "|", "=", "(", ")", "[", "]", "{", "}", ",", ".",
];

fn tokenize(src: &str) -> Result<Vec<Tok>, ParseError> {
    let b = src.as_bytes();
    let n = b.len();
    let mut toks = Vec::new();
    let mut i = 0;
    while i < n {
        let c = b[i];
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if c == b'"' || c == b'\'' {
            let (s, next) = read_string(src, b, n, i)?;
            toks.push(Tok::Str(s));
            i = next;
            continue;
        }
        if c.is_ascii_digit() {
            let start = i;
            while i < n && b[i].is_ascii_digit() {
                i += 1;
            }
            if i + 1 < n && b[i] == b'.' && b[i + 1].is_ascii_digit() {
                i += 1;
                while i < n && b[i].is_ascii_digit() {
                    i += 1;
                }
            }
            let num: f64 = src[start..i].parse().map_err(|_| ParseError {
                message: "invalid number".into(),
                at: start,
            })?;
            toks.push(Tok::Num(num));
            continue;
        }
        if is_ident_start(c) {
            let start = i;
            while i < n && is_ident_char(b[i]) {
                i += 1;
            }
            toks.push(Tok::Ident(src[start..i].to_string()));
            continue;
        }
        if let Some(op) = OPS.iter().find(|op| src[i..].starts_with(**op)) {
            toks.push(Tok::Op(op));
            i += op.len();
            continue;
        }
        return err(format!("unexpected character `{}`", c as char), i);
    }
    Ok(toks)
}

fn read_string(src: &str, b: &[u8], n: usize, i: usize) -> Result<(String, usize), ParseError> {
    let quote = b[i];
    let mut out = String::new();
    let mut k = i + 1;
    while k < n {
        match b[k] {
            b'\\' if k + 1 < n => {
                out.push(src[k + 1..].chars().next().unwrap());
                k += 2;
            }
            c if c == quote => return Ok((out, k + 1)),
            _ => {
                out.push(src[k..].chars().next().unwrap());
                k += src[k..].chars().next().unwrap().len_utf8();
            }
        }
    }
    err("unterminated string literal", i)
}

const fn is_ident_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_' || c == b'@'
}
const fn is_ident_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'-'
}

// ── parser ───────────────────────────────────────────────────────────────────

/// Parse a tag interior into the desugared core [`Expr`].
///
/// # Errors
/// Returns a [`ParseError`] for an empty interior, a syntax error, or a trailing
/// token.
pub fn parse_expr(interior: &str, scope: &Scope) -> Result<Expr, ParseError> {
    let toks = tokenize(interior)?;
    let mut p = Parser {
        toks: &toks,
        pos: 0,
        scope,
    };
    let e = p.ternary()?;
    if p.pos != p.toks.len() {
        return err("unexpected trailing token in expression", 0);
    }
    Ok(e)
}

struct Parser<'a> {
    toks: &'a [Tok],
    pos: usize,
    scope: &'a Scope,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }
    fn is_op(&self, op: &str) -> bool {
        matches!(self.peek(), Some(Tok::Op(o)) if *o == op)
    }
    fn eat_op(&mut self, op: &str) -> bool {
        if self.is_op(op) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    // ternary `c ? a : b` — right-associative, loosest.
    fn ternary(&mut self) -> Result<Expr, ParseError> {
        let cond = self.pipe()?;
        if self.eat_op("?") {
            let then = self.ternary()?;
            if !self.eat_op(":") {
                return err("expected `:` to complete the ternary `c ? a : b`", self.pos);
            }
            let els = self.ternary()?;
            return Ok(Expr::App("ternary".into(), vec![cond, then, els]));
        }
        Ok(cond)
    }

    // pipe `a | f x` → `App("f", [a, x …])` (the piped value first), left-assoc.
    fn pipe(&mut self) -> Result<Expr, ParseError> {
        let mut lhs = self.coalesce()?;
        while self.eat_op("|") {
            let Some(Tok::Ident(name)) = self.peek().cloned() else {
                return err("expected a helper name after `|`", self.pos);
            };
            self.pos += 1;
            let mut args = vec![lhs];
            while self.starts_atom() {
                args.push(self.atom()?);
            }
            lhs = Expr::App(name, args);
        }
        Ok(lhs)
    }

    // The left-associative binary rungs.
    fn coalesce(&mut self) -> Result<Expr, ParseError> {
        self.bin_left(&[("??", "coalesce")], Self::elvis)
    }
    fn elvis(&mut self) -> Result<Expr, ParseError> {
        self.bin_left(&[("?:", "firstTruthy")], Self::or)
    }
    fn or(&mut self) -> Result<Expr, ParseError> {
        self.bin_left(&[("||", "or")], Self::and)
    }
    fn and(&mut self) -> Result<Expr, ParseError> {
        self.bin_left(&[("&&", "and")], Self::cmp)
    }
    fn cmp(&mut self) -> Result<Expr, ParseError> {
        self.bin_left(
            &[
                ("==", "eq"),
                ("!=", "ne"),
                ("<=", "lte"),
                (">=", "gte"),
                ("<", "lt"),
                (">", "gt"),
            ],
            Self::add,
        )
    }
    fn add(&mut self) -> Result<Expr, ParseError> {
        self.bin_left(
            &[("+", "add"), ("-", "subtract"), ("..", "range")],
            Self::mul,
        )
    }
    fn mul(&mut self) -> Result<Expr, ParseError> {
        self.bin_left(
            &[("*", "multiply"), ("/", "divide"), ("%", "modulo")],
            Self::unary,
        )
    }

    fn bin_left(
        &mut self,
        ops: &[(&str, &str)],
        next: fn(&mut Self) -> Result<Expr, ParseError>,
    ) -> Result<Expr, ParseError> {
        let mut lhs = next(self)?;
        'outer: loop {
            if let Some(Tok::Op(o)) = self.peek() {
                for (lex, helper) in ops {
                    if o == lex {
                        self.pos += 1;
                        let rhs = next(self)?;
                        lhs = Expr::App((*helper).to_string(), vec![lhs, rhs]);
                        continue 'outer;
                    }
                }
            }
            break;
        }
        Ok(lhs)
    }

    // unary `!`.
    fn unary(&mut self) -> Result<Expr, ParseError> {
        if self.eat_op("!") {
            let r = self.unary()?;
            return Ok(Expr::App("not".into(), vec![r]));
        }
        self.term()
    }

    // application primary: a bare name followed by atom args.
    fn term(&mut self) -> Result<Expr, ParseError> {
        if let Some(Tok::Ident(name)) = self.peek().cloned()
            && !is_keyword(&name)
        {
            let segs = self.path_segments()?;
            if segs.len() == 1 && self.starts_atom() {
                let mut args = Vec::new();
                while self.starts_atom() {
                    args.push(self.atom()?);
                }
                return Ok(Expr::App(segs.into_iter().next().unwrap(), args));
            }
            return Ok(self.desugar_path(&segs));
        }
        self.atom()
    }

    // an atom: a literal, parenthesised expr, list/dict literal, or a bare path.
    fn atom(&mut self) -> Result<Expr, ParseError> {
        match self.peek().cloned() {
            Some(Tok::Num(n)) => {
                self.pos += 1;
                Ok(Expr::Lit(Value::Num(n)))
            }
            Some(Tok::Str(s)) => {
                self.pos += 1;
                Ok(Expr::Lit(Value::Str(s)))
            }
            Some(Tok::Op("-")) => {
                // a negative number literal (e.g. `at -1`).
                self.pos += 1;
                match self.peek().cloned() {
                    Some(Tok::Num(n)) => {
                        self.pos += 1;
                        Ok(Expr::Lit(Value::Num(-n)))
                    }
                    _ => err("expected a number after unary `-`", self.pos),
                }
            }
            Some(Tok::Op("(")) => {
                self.pos += 1;
                let e = self.ternary()?;
                if !self.eat_op(")") {
                    return err("expected `)`", self.pos);
                }
                Ok(e)
            }
            Some(Tok::Op("[")) => self.list(),
            Some(Tok::Op("{")) => self.dict(),
            Some(Tok::Ident(name)) => match name.as_str() {
                "true" => {
                    self.pos += 1;
                    Ok(Expr::nullary("true"))
                }
                "false" => {
                    self.pos += 1;
                    Ok(Expr::nullary("false"))
                }
                "null" => {
                    self.pos += 1;
                    Ok(Expr::nullary("null"))
                }
                _ => {
                    let segs = self.path_segments()?;
                    Ok(self.desugar_path(&segs))
                }
            },
            _ => err("expected an expression", self.pos),
        }
    }

    // `[e1, e2, …]` → `App("list", [e1, e2, …])`.
    fn list(&mut self) -> Result<Expr, ParseError> {
        self.pos += 1; // [
        let mut items = Vec::new();
        while !self.is_op("]") {
            items.push(self.ternary()?);
            if !self.eat_op(",") {
                break;
            }
        }
        if !self.eat_op("]") {
            return err("expected `]` to close the list literal", self.pos);
        }
        Ok(Expr::App("list".into(), items))
    }

    // `{k: v, …}` → `App("dict", [Lit(Str k), v, …])`.
    fn dict(&mut self) -> Result<Expr, ParseError> {
        self.pos += 1; // {
        let mut pairs = Vec::new();
        while !self.is_op("}") {
            let key = match self.peek().cloned() {
                Some(Tok::Ident(k)) => k,
                Some(Tok::Str(k)) => k,
                _ => return err("expected a dict key", self.pos),
            };
            self.pos += 1;
            if !self.eat_op(":") {
                return err("expected `:` after a dict key", self.pos);
            }
            pairs.push(Expr::str(&key));
            pairs.push(self.ternary()?);
            if !self.eat_op(",") {
                break;
            }
        }
        if !self.eat_op("}") {
            return err("expected `}` to close the dict literal", self.pos);
        }
        Ok(Expr::App("dict".into(), pairs))
    }

    // Parse `ident (. ident)*` into path segments.
    fn path_segments(&mut self) -> Result<Vec<String>, ParseError> {
        let mut segs = Vec::new();
        let Some(Tok::Ident(first)) = self.peek().cloned() else {
            return err("expected a name", self.pos);
        };
        segs.push(first);
        self.pos += 1;
        while self.is_op(".") {
            self.pos += 1;
            match self.peek().cloned() {
                Some(Tok::Ident(s)) => {
                    segs.push(s);
                    self.pos += 1;
                }
                _ => return err("expected a field name after `.`", self.pos),
            }
        }
        Ok(segs)
    }

    // Desugar a path to its `lookup` chain / reserved-root form.
    fn desugar_path(&self, segs: &[String]) -> Expr {
        let head = &segs[0];
        if head == "parent" {
            let k = segs.iter().take_while(|s| *s == "parent").count();
            let mut root = Expr::nullary("@parentchain");
            for _ in 1..k {
                root = Expr::App("lookup".into(), vec![root, Expr::str("parent")]);
            }
            return lookup(root, &segs[k..]);
        }
        let reserved = matches!(head.as_str(), "this" | "root" | "loop");
        if reserved || self.scope.has(head) {
            lookup(Expr::nullary(head), &segs[1..])
        } else {
            // A plain field path roots at `this`; all segments are keys.
            lookup(Expr::nullary("this"), segs)
        }
    }

    // Whether the next token can begin an atom (an application argument).
    fn starts_atom(&self) -> bool {
        matches!(
            self.peek(),
            Some(Tok::Ident(_) | Tok::Num(_) | Tok::Str(_)) | Some(Tok::Op("(" | "[" | "{" | "-"))
        )
    }
}

/// Build `App("lookup", [root, Lit(Str k)…])`, or just `root` when there are no keys.
fn lookup(root: Expr, keys: &[String]) -> Expr {
    if keys.is_empty() {
        return root;
    }
    let mut args = vec![root];
    args.extend(keys.iter().map(|k| Expr::str(k)));
    Expr::App("lookup".into(), args)
}

fn is_keyword(name: &str) -> bool {
    matches!(name, "true" | "false" | "null")
}

#[cfg(test)]
mod tests {
    use super::{Scope, parse_expr};
    use crate::ast::{Expr, Value};

    fn p(src: &str) -> Expr {
        parse_expr(src, &Scope::new()).unwrap_or_else(|e| panic!("{src:?}: {}", e.message))
    }
    fn ps(src: &str, scope: &Scope) -> Expr {
        parse_expr(src, scope).unwrap_or_else(|e| panic!("{src:?}: {}", e.message))
    }
    fn app(name: &str, args: Vec<Expr>) -> Expr {
        Expr::App(name.into(), args)
    }
    fn this() -> Expr {
        Expr::nullary("this")
    }

    #[test]
    fn plain_field_roots_at_this() {
        assert_eq!(p("name"), app("lookup", vec![this(), Expr::str("name")]));
        assert_eq!(
            p("a.b.c"),
            app(
                "lookup",
                vec![this(), Expr::str("a"), Expr::str("b"), Expr::str("c")]
            )
        );
    }

    #[test]
    fn binding_roots_at_the_binding() {
        let s = Scope::new().with("post");
        assert_eq!(ps("post", &s), Expr::nullary("post"));
        assert_eq!(
            ps("post.title", &s),
            app("lookup", vec![Expr::nullary("post"), Expr::str("title")])
        );
    }

    #[test]
    fn reserved_roots() {
        assert_eq!(p("this"), this());
        assert_eq!(
            p("root.tag"),
            app("lookup", vec![Expr::nullary("root"), Expr::str("tag")])
        );
        assert_eq!(
            p("loop.index1"),
            app("lookup", vec![Expr::nullary("loop"), Expr::str("index1")])
        );
        assert_eq!(
            p("parent.name"),
            app(
                "lookup",
                vec![Expr::nullary("@parentchain"), Expr::str("name")]
            )
        );
        assert_eq!(
            p("parent.parent.x"),
            app(
                "lookup",
                vec![
                    app(
                        "lookup",
                        vec![Expr::nullary("@parentchain"), Expr::str("parent")]
                    ),
                    Expr::str("x")
                ]
            )
        );
    }

    #[test]
    fn operators_and_precedence() {
        assert_eq!(
            p("price * qty"),
            app("multiply", vec![p("price"), p("qty")])
        );
        // `*` binds tighter than `+`
        assert_eq!(
            p("a + b * c"),
            app("add", vec![p("a"), app("multiply", vec![p("b"), p("c")])])
        );
        assert_eq!(
            p("count >= 3"),
            app("gte", vec![p("count"), Expr::Lit(Value::Num(3.0))])
        );
        assert_eq!(p("a && b"), app("and", vec![p("a"), p("b")]));
        assert_eq!(p("!done"), app("not", vec![p("done")]));
    }

    #[test]
    fn ternary_and_coalescers() {
        assert_eq!(
            p(r#"count > 0 ? "in" : "out""#),
            app(
                "ternary",
                vec![
                    app("gt", vec![p("count"), Expr::Lit(Value::Num(0.0))]),
                    Expr::str("in"),
                    Expr::str("out")
                ]
            )
        );
        assert_eq!(p("a ?? b"), app("coalesce", vec![p("a"), p("b")]));
        assert_eq!(p("a ?: b"), app("firstTruthy", vec![p("a"), p("b")]));
    }

    #[test]
    fn pipes_insert_the_value_first() {
        assert_eq!(p("name | uppercase"), app("uppercase", vec![p("name")]));
        assert_eq!(
            p(r#"name | capitalize | append "!""#),
            app(
                "append",
                vec![app("capitalize", vec![p("name")]), Expr::str("!")]
            )
        );
        assert_eq!(p("items | count"), app("count", vec![p("items")]));
        assert_eq!(
            p("greeting | slice 0 5"),
            app(
                "slice",
                vec![
                    p("greeting"),
                    Expr::Lit(Value::Num(0.0)),
                    Expr::Lit(Value::Num(5.0))
                ]
            )
        );
    }

    #[test]
    fn application_and_negatives() {
        assert_eq!(p("uppercase name"), app("uppercase", vec![p("name")]));
        assert_eq!(
            p("nums | at -1"),
            app("at", vec![p("nums"), Expr::Lit(Value::Num(-1.0))])
        );
    }

    #[test]
    fn list_and_dict_literals() {
        assert_eq!(
            p("[1, 2, 3]"),
            app(
                "list",
                vec![
                    Expr::Lit(Value::Num(1.0)),
                    Expr::Lit(Value::Num(2.0)),
                    Expr::Lit(Value::Num(3.0))
                ]
            )
        );
        assert_eq!(
            p("dict_demo"),
            app("lookup", vec![this(), Expr::str("dict_demo")])
        );
        assert_eq!(
            p("{a: 1, b: x}"),
            app(
                "dict",
                vec![
                    Expr::str("a"),
                    Expr::Lit(Value::Num(1.0)),
                    Expr::str("b"),
                    p("x")
                ]
            )
        );
    }

    #[test]
    fn collection_filter_application() {
        assert_eq!(
            p(r#"where items "age" "gt" 20"#),
            app(
                "where",
                vec![
                    p("items"),
                    Expr::str("age"),
                    Expr::str("gt"),
                    Expr::Lit(Value::Num(20.0))
                ]
            )
        );
        assert_eq!(p("true"), Expr::nullary("true"));
    }
}
