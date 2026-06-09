//! The 2×2 pane layout and per-pane scrolling — the pure pieces the mouse/scroll event
//! handlers rely on.

use ratatui::layout::Rect;

use trussbars_lab::{Lab, Pane, editor::TextBuffer, panes, samples::Sample};

const AREA: Rect = Rect {
    x: 0,
    y: 0,
    width: 100,
    height: 30,
};

#[test]
fn pane_hit_test_matches_the_grid() {
    let p = panes(AREA, true);
    // Corners of each quadrant resolve to the right pane (header row 0 / help last row
    // are neither). Template top-left, Data top-right, Output bottom-left, i18n bottom-right.
    let mid_x = AREA.width / 2;
    let mid_y = AREA.height / 2;
    assert_eq!(p.pane_at(1, 2), Some(Pane::Template));
    assert_eq!(p.pane_at(mid_x + 2, 2), Some(Pane::Data));
    assert_eq!(p.pane_at(1, mid_y + 2), Some(Pane::Output));
    assert_eq!(p.pane_at(mid_x + 2, mid_y + 2), Some(Pane::I18n));
    assert_eq!(p.pane_at(1, 0), None); // header
}

#[test]
fn scroll_clamps_to_content() {
    let mut lab = Lab::from_sample(Sample::Receipt);
    // A buffer that fits the pane can't scroll past 0.
    lab.template = TextBuffer::from_text("one\ntwo\n");
    lab.scroll_pane(Pane::Template, 50, AREA);
    assert_eq!(lab.scroll.template, 0);

    // A tall buffer scrolls, but not past (lines - visible_height).
    let tall: String = (0..100).map(|i| format!("line {i}\n")).collect();
    lab.template = TextBuffer::from_text(&tall);
    lab.scroll_pane(Pane::Template, 1000, AREA);
    let visible = panes(AREA, true).template.height.saturating_sub(2);
    assert!(lab.scroll.template > 0);
    assert!(lab.scroll.template <= 101 - visible);

    // Scrolling back up saturates at 0.
    lab.scroll_pane(Pane::Template, -1000, AREA);
    assert_eq!(lab.scroll.template, 0);
}

#[test]
fn follow_cursor_keeps_the_caret_visible() {
    let mut lab = Lab::from_sample(Sample::Receipt);
    let tall: String = (0..100).map(|i| format!("line {i}\n")).collect();
    lab.template = TextBuffer::from_text(&tall);
    for _ in 0..60 {
        lab.template.move_down();
    }
    lab.follow_cursor(AREA);
    let visible = panes(AREA, true).template.height.saturating_sub(2);
    let (cy, _) = lab.template.cursor();
    let cy = u16::try_from(cy).unwrap();
    assert!(lab.scroll.template <= cy && cy < lab.scroll.template + visible);
}
