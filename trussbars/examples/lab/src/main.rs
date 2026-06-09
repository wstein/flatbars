//! `lab` — the terminal front-end for the Trussbars VM mini-Lab.
//!
//! A [`ratatui`] draw loop over the crossterm backend (`ratatui::crossterm`, so there's
//! a single crossterm version). Edit the focused pane (template or JSON data) and watch
//! the VM re-render; cycle locale/mode/sample with the function keys.
//!
//! Headless modes (no terminal):
//!   * `--demo`         print every {sample × locale × mode} combo and exit.
//!   * `--bless [DIR]`  (re)write the golden snapshots used by `tests/golden.rs`.

#![forbid(unsafe_code)]

use std::io;

use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use ratatui::crossterm::{
    cursor::Show,
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};

use trussbars_lab::{Lab, Locale, Mode, samples::Sample};

fn main() -> io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--demo") {
        print!("{}", demo());
        return Ok(());
    }
    if let Some(pos) = args.iter().position(|a| a == "--bless") {
        let dir = args.get(pos + 1).map_or("tests/golden", String::as_str);
        let n = bless(dir)?;
        println!("blessed {n} golden snapshot(s) into {dir}/");
        return Ok(());
    }
    interactive()
}

/// Restores the terminal (cooked mode, main screen, cursor) on any exit — including a
/// `?`-propagated error or a panic unwinding through `interactive`.
struct TerminalGuard;
impl Drop for TerminalGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen, Show);
    }
}

fn interactive() -> io::Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let _guard = TerminalGuard;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout))?;

    let mut lab = Lab::new();
    loop {
        terminal.draw(|frame| trussbars_lab::ui(frame, &lab))?;
        let Event::Key(key) = event::read()? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue; // ignore key-release (Windows sends both)
        }
        match (key.code, key.modifiers) {
            (KeyCode::Esc, _) | (KeyCode::Char('q' | 'c'), KeyModifiers::CONTROL) => break,
            (KeyCode::Tab, _) => lab.cycle_focus(),
            (KeyCode::F(2), _) => lab.cycle_locale(),
            (KeyCode::F(3), _) => lab.toggle_mode(),
            (KeyCode::F(4), _) => lab.cycle_sample(),
            (code, mods) => edit(&mut lab, code, mods),
        }
    }
    Ok(())
}

/// Map an editing key onto the focused buffer.
fn edit(lab: &mut Lab, code: KeyCode, mods: KeyModifiers) {
    let buf = lab.focused_mut();
    match code {
        KeyCode::Char(c) if !mods.contains(KeyModifiers::CONTROL) => buf.insert_char(c),
        KeyCode::Enter => buf.insert_newline(),
        KeyCode::Backspace => buf.backspace(),
        KeyCode::Left => buf.move_left(),
        KeyCode::Right => buf.move_right(),
        KeyCode::Up => buf.move_up(),
        KeyCode::Down => buf.move_down(),
        KeyCode::Home => buf.home(),
        KeyCode::End => buf.end(),
        _ => {}
    }
}

/// Every combo, rendered, as one human-readable report (the `--demo` dump).
fn demo() -> String {
    let mut out = String::new();
    for sample in Sample::ALL {
        for locale in Locale::ALL {
            for mode in Mode::ALL {
                let mut lab = Lab::from_sample(sample);
                lab.locale = locale;
                lab.mode = mode;
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
                let mut lab = Lab::from_sample(sample);
                lab.locale = locale;
                lab.mode = mode;
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
