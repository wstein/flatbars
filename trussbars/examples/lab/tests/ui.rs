//! Headless UI smoke: render the ratatui view to a `TestBackend` and assert the frame
//! contains the expected text. Proves `ui()` lays out and paints without a real TTY (the
//! interactive event loop in `main.rs` is the only untested part).

use ratatui::Terminal;
use ratatui::backend::TestBackend;
use ratatui::style::Modifier;

use trussbars_lab::{Lab, Locale, ui};

fn frame_text(lab: &Lab) -> String {
    let mut terminal = Terminal::new(TestBackend::new(100, 30)).unwrap();
    terminal.draw(|f| ui(f, lab)).unwrap();
    terminal
        .backend()
        .buffer()
        .content()
        .iter()
        .map(ratatui::buffer::Cell::symbol)
        .collect()
}

#[test]
fn paints_panes_and_localized_output() {
    // German locale → the receipt output pane shows the localized title "Beleg".
    let mut lab = Lab::new();
    lab.locale = Locale::De;
    let text = frame_text(&lab);
    assert!(text.contains("Template"), "Template pane title missing");
    assert!(text.contains("Data (YAML)"), "Data pane title missing");
    assert!(text.contains("i18n catalog"), "i18n pane title missing");
    assert!(
        text.contains("Beleg"),
        "localized output (Beleg) missing from the frame"
    );
}

#[test]
fn output_bolds_interpolated_runs() {
    // The receipt's `== {{t "title"}} ==` → "Receipt" comes from interpolation (bold),
    // while the literal "==" does not.
    let mut terminal = Terminal::new(TestBackend::new(100, 30)).unwrap();
    let lab = Lab::new();
    terminal.draw(|f| ui(f, &lab)).unwrap();
    let buf = terminal.backend().buffer();

    let bold_syms: String = buf
        .content()
        .iter()
        .filter(|c| c.modifier.contains(Modifier::BOLD))
        .map(ratatui::buffer::Cell::symbol)
        .collect();
    // The brand in the header is also bold, so just assert the interpolated word is in
    // the bold set and the literal "=" delimiter is not.
    assert!(
        bold_syms.contains("Receipt"),
        "interpolated title should be bold"
    );
    assert!(
        !bold_syms.contains('='),
        "literal delimiters should not be bold"
    );
}
