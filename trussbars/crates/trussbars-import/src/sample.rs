//! A dependency-free **data-sample shape oracle**: parse a JSON sample into its
//! structure (array / object / scalar) and answer [`ShapeOracle`] queries against it,
//! descending into array elements so nested sections resolve (`docs/15 §6`).
//!
//! Only the *shape* is retained — scalar values are not kept, object keys are (for path
//! matching). It is a structural reader, intentionally lenient: it parses well-formed
//! JSON and reports the shape at each path.

use crate::lower::{Shape, ShapeOracle};

/// The retained structure of a JSON value (shape only).
#[derive(Debug, Clone, PartialEq)]
enum JVal {
    /// A string / number / bool / null.
    Scalar,
    /// An array; the boxed value is the first element's shape (for descent), if any.
    Array(Option<Box<JVal>>),
    /// An object: its `(key, value-shape)` fields.
    Object(Vec<(String, JVal)>),
}

/// A [`ShapeOracle`] backed by a parsed JSON data sample.
#[derive(Debug, Clone)]
pub struct JsonShapes {
    root: JVal,
}

impl JsonShapes {
    /// Parse a JSON sample into a shape oracle.
    ///
    /// # Errors
    /// Returns a message describing the first malformed-JSON position.
    pub fn parse(src: &str) -> Result<Self, String> {
        let mut p = Parser { src, i: 0 };
        p.ws();
        let root = p.value()?;
        Ok(JsonShapes { root })
    }
}

impl ShapeOracle for JsonShapes {
    fn shape_at(&self, path: &[String]) -> Shape {
        let mut cur = &self.root;
        for seg in path {
            // Descend into array element(s) before resolving the field, so a section
            // nested under a list (`items.tags`) resolves against the element.
            while let JVal::Array(Some(elem)) = cur {
                cur = elem;
            }
            match cur {
                JVal::Object(fields) => match fields.iter().find(|(k, _)| k == seg) {
                    Some((_, v)) => cur = v,
                    None => return Shape::Unknown,
                },
                _ => return Shape::Unknown,
            }
        }
        match cur {
            JVal::Array(_) => Shape::Array,
            JVal::Object(_) => Shape::Object,
            JVal::Scalar => Shape::Scalar,
        }
    }
}

struct Parser<'a> {
    src: &'a str,
    i: usize,
}

impl Parser<'_> {
    fn bytes(&self) -> &[u8] {
        self.src.as_bytes()
    }

    fn peek(&self) -> Option<u8> {
        self.bytes().get(self.i).copied()
    }

    fn ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.i += 1;
        }
    }

    fn value(&mut self) -> Result<JVal, String> {
        self.ws();
        match self.peek() {
            Some(b'{') => self.object(),
            Some(b'[') => self.array(),
            Some(b'"') => {
                self.string()?;
                Ok(JVal::Scalar)
            }
            Some(b't') => self.lit("true").map(|()| JVal::Scalar),
            Some(b'f') => self.lit("false").map(|()| JVal::Scalar),
            Some(b'n') => self.lit("null").map(|()| JVal::Scalar),
            Some(c) if c == b'-' || c.is_ascii_digit() => {
                self.number();
                Ok(JVal::Scalar)
            }
            _ => Err(format!("unexpected JSON token at byte {}", self.i)),
        }
    }

    fn object(&mut self) -> Result<JVal, String> {
        self.i += 1; // `{`
        let mut fields = Vec::new();
        self.ws();
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Ok(JVal::Object(fields));
        }
        loop {
            self.ws();
            let key = self.string()?;
            self.ws();
            if self.peek() != Some(b':') {
                return Err(format!("expected ':' at byte {}", self.i));
            }
            self.i += 1;
            let val = self.value()?;
            fields.push((key, val));
            self.ws();
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    break;
                }
                _ => return Err(format!("expected ',' or '}}' at byte {}", self.i)),
            }
        }
        Ok(JVal::Object(fields))
    }

    fn array(&mut self) -> Result<JVal, String> {
        self.i += 1; // `[`
        self.ws();
        if self.peek() == Some(b']') {
            self.i += 1;
            return Ok(JVal::Array(None));
        }
        let first = self.value()?;
        loop {
            self.ws();
            match self.peek() {
                Some(b',') => {
                    self.i += 1;
                    self.value()?; // consume (and discard) the remaining elements
                }
                Some(b']') => {
                    self.i += 1;
                    break;
                }
                _ => return Err(format!("expected ',' or ']' at byte {}", self.i)),
            }
        }
        Ok(JVal::Array(Some(Box::new(first))))
    }

    /// Parse a JSON string, returning its unescaped value (used for object keys).
    fn string(&mut self) -> Result<String, String> {
        if self.peek() != Some(b'"') {
            return Err(format!("expected a string at byte {}", self.i));
        }
        // `as_bytes()` is tied to the source lifetime, not `&self`, so the index can
        // advance freely. Escape markers are ASCII, so the slice stays boundary-clean.
        let b = self.src.as_bytes();
        let start = self.i + 1;
        let mut i = start;
        while i < b.len() {
            match b[i] {
                b'\\' => i += 2,
                b'"' => {
                    self.i = i + 1;
                    return Ok(unescape(&self.src[start..i]));
                }
                _ => i += 1,
            }
        }
        Err("unterminated string".to_string())
    }

    fn number(&mut self) {
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() || matches!(c, b'-' | b'+' | b'.' | b'e' | b'E') {
                self.i += 1;
            } else {
                break;
            }
        }
    }

    fn lit(&mut self, word: &str) -> Result<(), String> {
        if self.src[self.i..].starts_with(word) {
            self.i += word.len();
            Ok(())
        } else {
            Err(format!("expected `{word}` at byte {}", self.i))
        }
    }
}

/// Unescape a JSON string body (the common escapes; `\uXXXX` to its code point).
fn unescape(raw: &str) -> String {
    if !raw.contains('\\') {
        return raw.to_string();
    }
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some('/') => out.push('/'),
            Some('b') => out.push('\u{08}'),
            Some('f') => out.push('\u{0c}'),
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                let ch = u32::from_str_radix(&hex, 16)
                    .ok()
                    .and_then(char::from_u32)
                    .unwrap_or('\u{fffd}');
                out.push(ch);
            }
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(json: &str, path: &[&str]) -> Shape {
        let o = JsonShapes::parse(json).expect("parse");
        o.shape_at(&path.iter().map(|s| (*s).to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn top_level_shapes() {
        let json = r#"{"items": [1,2], "user": {"name": "x"}, "ok": true, "n": 3}"#;
        assert_eq!(shape(json, &["items"]), Shape::Array);
        assert_eq!(shape(json, &["user"]), Shape::Object);
        assert_eq!(shape(json, &["ok"]), Shape::Scalar);
        assert_eq!(shape(json, &["n"]), Shape::Scalar);
        assert_eq!(shape(json, &["missing"]), Shape::Unknown);
    }

    #[test]
    fn descends_into_array_elements() {
        let json = r#"{"items": [{"tags": ["a"], "name": "x"}]}"#;
        assert_eq!(shape(json, &["items"]), Shape::Array);
        assert_eq!(shape(json, &["items", "tags"]), Shape::Array);
        assert_eq!(shape(json, &["items", "name"]), Shape::Scalar);
    }

    #[test]
    fn nested_objects() {
        let json = r#"{"a": {"b": {"c": []}}}"#;
        assert_eq!(shape(json, &["a", "b"]), Shape::Object);
        assert_eq!(shape(json, &["a", "b", "c"]), Shape::Array);
    }

    #[test]
    fn empty_array_is_array() {
        assert_eq!(shape(r#"{"xs": []}"#, &["xs"]), Shape::Array);
        // Descending an empty array yields Unknown (no element to inspect).
        assert_eq!(shape(r#"{"xs": []}"#, &["xs", "k"]), Shape::Unknown);
    }

    #[test]
    fn escaped_and_unicode_keys() {
        let json = r#"{"a\"b": 1, "win\\path": []}"#;
        assert_eq!(shape(json, &["a\"b"]), Shape::Scalar);
        assert_eq!(shape(json, &["win\\path"]), Shape::Array);
    }

    #[test]
    fn malformed_is_error() {
        assert!(JsonShapes::parse("{").is_err());
        assert!(JsonShapes::parse("{\"a\":}").is_err());
        assert!(JsonShapes::parse("nope").is_err());
    }
}
