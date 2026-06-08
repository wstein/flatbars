//! Golden gate: the changelog must render to the committed `CHANGELOG.md`.
//! Regenerate after an intended template/data change with `BLESS=1 cargo test`.

use std::fs;
use std::path::Path;

use changelog_example::changelog;
use changelog_example::templates::render_changelog;

#[test]
fn changelog_matches_golden() {
    let actual = render_changelog(&changelog());
    let path = format!("{}/tests/golden/CHANGELOG.md", env!("CARGO_MANIFEST_DIR"));
    if std::env::var("BLESS").is_ok() {
        fs::create_dir_all(Path::new(&path).parent().unwrap()).unwrap();
        fs::write(&path, &actual).unwrap();
        return;
    }
    let expected = fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("missing golden {path}; run `BLESS=1 cargo test`"));
    assert_eq!(actual, expected, "changelog drifted from its golden");
}
