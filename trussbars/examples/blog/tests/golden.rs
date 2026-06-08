//! Golden gate: the three pages must render to their committed HTML. Regenerate
//! after an intentional template/engine change with `BLESS=1 cargo test`.

use std::fs;
use std::path::Path;

use blog_example::context::{ArchiveCtx, IndexCtx, PostCtx};
use blog_example::templates::{render_archive, render_index, render_post};
use blog_example::{sample_posts, sample_site};

fn check(name: &str, actual: &str) {
    let path = format!("{}/tests/golden/{name}.html", env!("CARGO_MANIFEST_DIR"));
    if std::env::var("BLESS").is_ok() {
        fs::create_dir_all(Path::new(&path).parent().unwrap()).unwrap();
        fs::write(&path, actual).unwrap();
        return;
    }
    let expected = fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("missing golden {path}; run `BLESS=1 cargo test`"));
    assert_eq!(actual, expected, "{name} drifted from its golden");
}

#[test]
fn pages_match_golden() {
    check(
        "index",
        &render_index(&IndexCtx {
            site: sample_site(),
            posts: sample_posts(),
        }),
    );
    check(
        "post",
        &render_post(&PostCtx {
            post: sample_posts().swap_remove(0),
        }),
    );
    check(
        "archive",
        &render_archive(&ArchiveCtx {
            site: sample_site(),
            posts: sample_posts(),
        }),
    );
}
