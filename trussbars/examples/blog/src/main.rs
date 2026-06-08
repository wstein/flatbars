//! Render the blog to stdout. `cargo run` from `trussbars/examples/blog/`.

use blog_example::context::{ArchiveCtx, IndexCtx, PostCtx};
use blog_example::templates::{render_archive, render_index, render_post};
use blog_example::{sample_posts, sample_site};

fn main() {
    let index = IndexCtx {
        site: sample_site(),
        posts: sample_posts(),
    };
    let post = PostCtx {
        post: sample_posts().swap_remove(0),
    };
    let archive = ArchiveCtx {
        site: sample_site(),
        posts: sample_posts(),
    };

    println!("===== index.truss =====\n{}\n", render_index(&index));
    println!("===== post.truss =====\n{}\n", render_post(&post));
    println!("===== archive.truss =====\n{}", render_archive(&archive));
}
