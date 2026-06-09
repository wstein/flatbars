//! `lab` — the terminal front-end for the Trussbars VM mini-Lab.
//!
//! A [`ratatui`] draw loop over the crossterm backend (`ratatui::crossterm`, so there's
//! a single crossterm version). Edit the focused pane (template, YAML data, or i18n
//! catalog) and watch the VM re-render; cycle locale/mode/sample with the function keys;
//! click to focus a pane and use the wheel / `PageUp`/`PageDown` to scroll.
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
    event::{
        self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEvent, KeyEventKind,
        KeyModifiers, MouseButton, MouseEventKind,
    },
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::layout::Rect;

use trussbars_lab::{Lab, Locale, Mode, Pane, panes, samples::Sample};

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
        let _ = execute!(
            io::stdout(),
            DisableMouseCapture,
            LeaveAlternateScreen,
            Show
        );
    }
}

fn interactive() -> io::Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let _guard = TerminalGuard;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout))?;

    let mut lab = Lab::new();
    loop {
        terminal.draw(|frame| trussbars_lab::ui(frame, &lab))?;
        let size = terminal.size()?;
        let area = Rect::new(0, 0, size.width, size.height);
        match event::read()? {
            Event::Key(key) if key.kind == KeyEventKind::Press => {
                if handle_key(&mut lab, key, area) {
                    break;
                }
            }
            Event::Mouse(m) => handle_mouse(&mut lab, m.kind, m.column, m.row, area),
            _ => {}
        }
    }
    Ok(())
}

/// Handle a key press. Returns `true` to quit. Lab controls (focus/locale/mode/sample/
/// scroll) are intercepted; everything else goes to the focused `tui-textarea`, which
/// owns editing (insert, delete, selection, undo/redo, motions) and its own scrolling.
fn handle_key(lab: &mut Lab, key: KeyEvent, area: Rect) -> bool {
    match (key.code, key.modifiers) {
        (KeyCode::Esc, _) | (KeyCode::Char('q'), KeyModifiers::CONTROL) => return true,
        (KeyCode::Tab, _) => lab.cycle_focus(),
        (KeyCode::F(2), _) => lab.cycle_locale(),
        (KeyCode::F(3), _) => lab.toggle_mode(),
        (KeyCode::F(4), _) => lab.cycle_sample(),
        (KeyCode::PageDown | KeyCode::PageUp, _) => {
            let pane = lab.focus.pane();
            let page = i16::try_from(
                panes(area, lab.sample.uses_i18n())
                    .rect(pane)
                    .height
                    .saturating_sub(2),
            )
            .unwrap_or(10)
            .max(1);
            lab.scroll(
                pane,
                if key.code == KeyCode::PageDown {
                    page
                } else {
                    -page
                },
                area,
            );
        }
        _ => {
            lab.focused_mut().input(key);
        }
    }
    false
}

/// Handle a mouse event: left-click focuses a pane, the wheel scrolls the pane under it.
fn handle_mouse(lab: &mut Lab, kind: MouseEventKind, col: u16, row: u16, area: Rect) {
    let layout = panes(area, lab.sample.uses_i18n());
    match kind {
        MouseEventKind::Down(MouseButton::Left) => {
            if let Some(focus) = layout.pane_at(col, row).and_then(Pane::focus) {
                lab.focus = focus;
            }
        }
        MouseEventKind::ScrollDown => {
            if let Some(pane) = layout.pane_at(col, row) {
                lab.scroll(pane, 3, area);
            }
        }
        MouseEventKind::ScrollUp => {
            if let Some(pane) = layout.pane_at(col, row) {
                lab.scroll(pane, -3, area);
            }
        }
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
