//! Build the demo site: render every `content/*.md` to `dist/<slug>/index.html`, plus a
//! `dist/index.html` listing. A tiny real SSG — front-matter + Markdown in, typed
//! Trussbars render out.

use std::{fs, path::Path};
use trussbars_ssg_demo::{build_index, build_post};

fn main() -> std::io::Result<()> {
    let dist = Path::new("dist");
    fs::create_dir_all(dist)?;

    // Read `content/*.md`, newest-first by the date-prefixed filename.
    let mut posts: Vec<(String, String)> = fs::read_dir("content")?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "md"))
        .filter_map(|p| {
            let slug = p.file_stem()?.to_str()?.to_string();
            Some((slug, fs::read_to_string(&p).ok()?))
        })
        .collect();
    posts.sort_by(|a, b| b.0.cmp(&a.0));

    for (slug, content) in &posts {
        let dir = dist.join(slug);
        fs::create_dir_all(&dir)?;
        fs::write(dir.join("index.html"), build_post(content))?;
    }
    let refs: Vec<(&str, &str)> = posts
        .iter()
        .map(|(s, c)| (s.as_str(), c.as_str()))
        .collect();
    fs::write(dist.join("index.html"), build_index(&refs))?;

    println!("built {} post(s) + index → dist/", posts.len());
    Ok(())
}
