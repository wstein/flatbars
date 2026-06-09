//! Headless UI smoke: render the ratatui view to a `TestBackend` and assert the frame
//! contains the expected text. Proves `ui()` lays out and paints without a real TTY (the
//! interactive event loop in `main.rs` is the only untested part).

use ratatui::Terminal;
use ratatui::backend::TestBackend;

use trussbars_lab::{Lab, Locale, samples::Sample, ui};

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
fn greeting_hides_the_i18n_pane() {
    // The no-i18n greeting drops the i18n pane (Output takes the full bottom row).
    let text = frame_text(&Lab::from_sample(Sample::Greeting));
    assert!(text.contains("Template"), "Template pane still shown");
    assert!(text.contains("Hello, Ada!"), "greeting output present");
    assert!(
        !text.contains("i18n catalog"),
        "i18n pane should be hidden for the no-i18n greeting"
    );
}
