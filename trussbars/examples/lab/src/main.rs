//! `lab` — the terminal front-end for the Trussbars VM mini-Lab.
//!
//! A dependency-free, std-only TUI: it redraws a full-screen view (ANSI escapes) and
//! reads single-key commands (line-buffered, so no raw-mode dependency) to cycle the
//! sample, locale, and render mode — re-rendering through the dynamic VM each time.
//!
//! Modes beyond the interactive loop:
//!   * `--demo`            print every {sample × locale × mode} combo and exit (headless).
//!   * `--bless [DIR]`     (re)write the golden snapshots used by `tests/golden.rs`.

#![forbid(unsafe_code)]

use std::io::{self, BufRead, Write};

use trussbars_lab::{Lab, Locale, Mode, samples::Sample};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--demo") {
        print!("{}", demo());
        return;
    }
    if let Some(pos) = args.iter().position(|a| a == "--bless") {
        let dir = args.get(pos + 1).map_or("tests/golden", String::as_str);
        match bless(dir) {
            Ok(n) => println!("blessed {n} golden snapshot(s) into {dir}/"),
            Err(e) => {
                eprintln!("bless failed: {e}");
                std::process::exit(1);
            }
        }
        return;
    }
    interactive();
}

/// Every combo, rendered, as one human-readable report (the `--demo` dump).
fn demo() -> String {
    let mut out = String::new();
    for sample in Sample::ALL {
        for locale in Locale::ALL {
            for mode in Mode::ALL {
                let lab = Lab {
                    sample,
                    locale,
                    mode,
                };
                out.push_str(&format!(
                    "### {} · {} · {}\n",
                    sample.key(),
                    locale.code(),
                    mode.key()
                ));
                out.push_str(&lab.render_or_reject());
                out.push('\n');
            }
        }
    }
    out
}

/// Write one golden snapshot per combo into `dir`. Returns the count written.
fn bless(dir: &str) -> io::Result<usize> {
    std::fs::create_dir_all(dir)?;
    let mut written = 0;
    for sample in Sample::ALL {
        for locale in Locale::ALL {
            for mode in Mode::ALL {
                let lab = Lab {
                    sample,
                    locale,
                    mode,
                };
                let path = format!(
                    "{dir}/{}_{}_{}.txt",
                    sample.key(),
                    locale.code(),
                    mode.key()
                );
                std::fs::write(&path, lab.render_or_reject())?;
                written += 1;
            }
        }
    }
    Ok(written)
}

/// The interactive loop: draw, read a single-key command, repeat.
fn interactive() {
    let stdin = io::stdin();
    let mut lab = Lab::new();
    draw(&lab);
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        match line.trim().chars().next() {
            Some('q' | 'Q') => break,
            Some('l' | 'L') => lab.locale = lab.locale.next(),
            Some('m' | 'M') => lab.mode = lab.mode.toggle(),
            Some('s' | 'S') => lab.sample = lab.sample.next(),
            _ => {}
        }
        draw(&lab);
    }
    println!();
}

/// Paint the full-screen view for the current state.
fn draw(lab: &Lab) {
    let mut s = String::new();
    s.push_str("\x1b[2J\x1b[H"); // clear + home
    s.push_str("\x1b[1;36m  Trussbars VM · mini-Lab\x1b[0m  \x1b[90mdynamic render via trussbars-vm\x1b[0m\n");
    s.push_str(&rule());

    s.push_str(&format!(
        "\x1b[1m TEMPLATE\x1b[0m  \x1b[90m{}\x1b[0m\n",
        lab.sample.label()
    ));
    for line in lab.sample.template().lines() {
        s.push_str(&format!("   \x1b[90m│\x1b[0m {line}\n"));
    }
    s.push_str(&rule());

    s.push_str(&format!(
        "\x1b[1m OUTPUT\x1b[0m  \x1b[90m{} · {}\x1b[0m\n",
        lab.locale.label(),
        lab.mode.label()
    ));
    for line in lab.render_or_reject().lines() {
        if let Some(reason) = line.strip_prefix("⟂ ") {
            s.push_str(&format!("   \x1b[33m⟂ {reason}\x1b[0m\n"));
        } else {
            s.push_str(&format!("   {line}\n"));
        }
    }
    s.push_str(&rule());

    s.push_str(&format!(
        " \x1b[1m[s]\x1b[0mample  \x1b[1m[l]\x1b[0mocale={}  \x1b[1m[m]\x1b[0mode={}  \x1b[1m[q]\x1b[0muit\n > ",
        lab.locale.code(),
        lab.mode.key()
    ));

    print!("{s}");
    let _ = io::stdout().flush();
}

fn rule() -> String {
    format!("\x1b[90m{}\x1b[0m\n", "─".repeat(58))
}
