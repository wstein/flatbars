//! The 2×2 pane layout and Output scrolling — the pure pieces the mouse/scroll event
//! handlers rely on. (The editor panes are `tui-textarea` widgets that own their own
//! scrolling, so only the Output scroll is clamped here.)

use ratatui::layout::Rect;

use trussbars_lab::{Lab, Pane, panes, samples::Sample};

const AREA: Rect = Rect {
    x: 0,
    y: 0,
    width: 100,
    height: 30,
};

#[test]
fn pane_hit_test_matches_the_grid() {
    let p = panes(AREA, true);
    let mid_x = AREA.width / 2;
    let mid_y = AREA.height / 2;
    assert_eq!(p.pane_at(1, 2), Some(Pane::Template));
    assert_eq!(p.pane_at(mid_x + 2, 2), Some(Pane::Data));
    assert_eq!(p.pane_at(1, mid_y + 2), Some(Pane::Output));
    assert_eq!(p.pane_at(mid_x + 2, mid_y + 2), Some(Pane::I18n));
    assert_eq!(p.pane_at(1, 0), None); // header
}

#[test]
fn hidden_i18n_gives_output_the_bottom_row() {
    // With i18n hidden, the bottom-right quadrant resolves to Output (full width).
    let p = panes(AREA, false);
    let mid_x = AREA.width / 2;
    let mid_y = AREA.height / 2;
    assert_eq!(p.pane_at(mid_x + 2, mid_y + 2), Some(Pane::Output));
    assert_eq!(p.i18n, Rect::new(0, 0, 0, 0));
}

#[test]
fn output_scroll_clamps_to_content() {
    // The greeting output is two lines — far shorter than the pane — so it can't scroll.
    let mut lab = Lab::from_sample(Sample::Greeting);
    lab.scroll(Pane::Output, 50, AREA);
    assert_eq!(lab.output_scroll, 0);
    lab.scroll(Pane::Output, -50, AREA);
    assert_eq!(lab.output_scroll, 0);
}
