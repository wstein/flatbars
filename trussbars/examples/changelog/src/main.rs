//! Print the changelog to stdout. `cargo run` from `trussbars/examples/changelog/`.

use changelog_example::changelog;
use changelog_example::templates::render_changelog;

fn main() {
    print!("{}", render_changelog(&changelog()));
}
