//! # trussbars-lab — the VM northstar (Ratatui TUI)
//!
//! A terminal **mini-Lab** on the dynamic VM ([`trussbars_vm`]): edit a template and its
//! data live and watch it re-render — the case the AOT (`truss!`) path structurally can't
//! serve. Built with [`ratatui`] over the crossterm backend; the editable panes are
//! [`tui_textarea`] widgets (selection, undo/redo, word motions, internal scrolling).
//!
//! Two rendering modes, proving patterns from `docs/11`:
//! 1. **Helper-based VM** — `{{t …}}/{{number …}}/…` via host helpers registered at runtime
//!    ([`i18n::register`]). The `receipt` sample. Cycling the locale flips the localized
//!    dimensions — title, plural noun, and month name (`number` grouping and `relative`
//!    phrasing are en-US fallbacks). VM-only — host helpers can't work in AOT.
//! 2. **AOT-compat proxy** — Toggle [`Mode::Compat`]: strict mode, rejects host helpers.
//!    The `receipt` is rejected. The plain `greeting` (no i18n) renders byte-identically.
//!
//! (The data-driven catalog pattern — catalog as data, looked up by declared helpers,
//! identical on AOT + VM — has its own focused example, `examples/i18n-data`.)
//!
//! The render core ([`Lab::render`]) is pure and golden-tested; [`ui`] is drawn headlessly
//! under a `TestBackend` (`tests/`). The `main.rs` event loop is the only part that touches
//! a real terminal.

#![forbid(unsafe_code)]

pub mod data;
pub mod highlight;
pub mod i18n;
pub mod samples;

use std::cell::RefCell;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState},
};
use trussbars_vm::{Helpers, Template};
use tui_textarea::TextArea;

use crate::samples::Sample;

/// A display locale: BCP-47 primary subtag + a human label.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Locale {
    En,
    De,
    Fr,
    Pl,
}

impl Locale {
    pub const ALL: [Locale; 4] = [Locale::En, Locale::De, Locale::Fr, Locale::Pl];

    /// The BCP-47 primary subtag passed to the i18n primitives.
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Locale::En => "en",
            Locale::De => "de",
            Locale::Fr => "fr",
            Locale::Pl => "pl",
        }
    }

    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Locale::En => "English",
            Locale::De => "Deutsch",
            Locale::Fr => "Français",
            Locale::Pl => "Polski",
        }
    }

    #[must_use]
    pub fn next(self) -> Locale {
        match self {
            Locale::En => Locale::De,
            Locale::De => Locale::Fr,
            Locale::Fr => Locale::Pl,
            Locale::Pl => Locale::En,
        }
    }
}

/// Which render backend the lab drives.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// Lenient VM render with the i18n host-helper pack wired in.
    Render,
    /// AOT-compat (strict) proxy — no host helpers; errors on what AOT rejects.
    Compat,
}

impl Mode {
    pub const ALL: [Mode; 2] = [Mode::Render, Mode::Compat];

    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Mode::Render => "render",
            Mode::Compat => "compat",
        }
    }

    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Mode::Render => "render (VM, lenient)",
            Mode::Compat => "render_compat (AOT proxy)",
        }
    }

    #[must_use]
    pub fn toggle(self) -> Mode {
        match self {
            Mode::Render => Mode::Compat,
            Mode::Compat => Mode::Render,
        }
    }
}

/// Which editable pane has keyboard focus.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Focus {
    Template,
    Data,
    I18n,
}

impl Focus {
    #[must_use]
    pub fn pane(self) -> Pane {
        match self {
            Focus::Template => Pane::Template,
            Focus::Data => Pane::Data,
            Focus::I18n => Pane::I18n,
        }
    }
}

/// Every pane the mouse can land on — the three editors plus the read-only Output.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Pane {
    Template,
    Data,
    I18n,
    Output,
}

impl Pane {
    /// The editable focus for this pane, or `None` for the read-only Output.
    #[must_use]
    pub fn focus(self) -> Option<Focus> {
        match self {
            Pane::Template => Some(Focus::Template),
            Pane::Data => Some(Focus::Data),
            Pane::I18n => Some(Focus::I18n),
            Pane::Output => None,
        }
    }
}

/// The screen rectangles of the 2×2 grid plus the header and help bars.
#[derive(Clone, Copy, Debug)]
pub struct Panes {
    pub header: Rect,
    pub template: Rect,
    pub data: Rect,
    pub output: Rect,
    pub i18n: Rect,
    pub help: Rect,
}

/// Lay out the screen: a header line, the `Template | Data` / `Output | i18n` 2×2 grid,
/// and a help line. When `show_i18n` is false (a sample with no i18n) the Output takes the
/// whole bottom row and the i18n rect is empty. Shared by [`ui`] and the event loop (so
/// mouse hit-testing matches what is drawn).
#[must_use]
pub fn panes(area: Rect, show_i18n: bool) -> Panes {
    let [header, body, help] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(0),
        Constraint::Length(1),
    ])
    .areas(area);
    let [top, bottom] =
        Layout::vertical([Constraint::Percentage(50), Constraint::Percentage(50)]).areas(body);
    let [template, data] =
        Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).areas(top);
    let (output, i18n) = if show_i18n {
        let [output, i18n] =
            Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)])
                .areas(bottom);
        (output, i18n)
    } else {
        (bottom, Rect::new(0, 0, 0, 0))
    };
    Panes {
        header,
        template,
        data,
        output,
        i18n,
        help,
    }
}

impl Panes {
    #[must_use]
    pub fn rect(&self, pane: Pane) -> Rect {
        match pane {
            Pane::Template => self.template,
            Pane::Data => self.data,
            Pane::I18n => self.i18n,
            Pane::Output => self.output,
        }
    }

    /// The pane containing screen point `(col, row)`, if any.
    #[must_use]
    pub fn pane_at(&self, col: u16, row: u16) -> Option<Pane> {
        let pos = ratatui::layout::Position::new(col, row);
        [Pane::Template, Pane::Data, Pane::I18n, Pane::Output]
            .into_iter()
            .find(|&p| self.rect(p).contains(pos))
    }
}

/// Build a `TextArea` seeded from text, preserving a trailing newline (so the rendered
/// template byte-matches the seed).
fn area_from(text: &str) -> TextArea<'static> {
    TextArea::new(text.split('\n').map(str::to_string).collect())
}

/// The whole lab state: the editable template, data, and i18n-catalog text areas, plus
/// the selected sample, locale, mode, focus, and the Output scroll offset.
pub struct Lab {
    pub sample: Sample,
    pub locale: Locale,
    pub mode: Mode,
    pub focus: Focus,
    pub template: TextArea<'static>,
    pub data: TextArea<'static>,
    pub i18n: TextArea<'static>,
    pub output_scroll: u16,
    /// Memoized last render, keyed on a hash of every input that feeds it (the three pane
    /// texts + locale + mode + sample). A `ui()` frame renders once and the scroll clamp
    /// reuses it instead of re-rendering; any input change moves the key, so the cache
    /// can't go stale — the exact failure this example otherwise teaches against.
    render_cache: RefCell<Option<(u64, String)>>,
}

impl Lab {
    /// Seed the lab from a sample (English, lenient render, template focused, default
    /// i18n catalog).
    #[must_use]
    pub fn from_sample(sample: Sample) -> Self {
        let mut lab = Lab {
            sample,
            locale: Locale::En,
            mode: Mode::Render,
            focus: Focus::Template,
            template: area_from(sample.template()),
            data: area_from(sample.data_yaml()),
            i18n: area_from(i18n::CATALOG_SEED),
            output_scroll: 0,
            render_cache: RefCell::new(None),
        };
        lab.rehighlight_template();
        lab
    }

    /// Re-apply Trussbars syntax highlighting to the Template pane (call after any edit
    /// or reseed of the template).
    pub fn rehighlight_template(&mut self) {
        let text = self.template.lines().join("\n");
        highlight::apply(&mut self.template, &text);
    }

    /// The opening state: the receipt sample.
    #[must_use]
    pub fn new() -> Self {
        Self::from_sample(Sample::Receipt)
    }

    fn pane_text(area: &TextArea<'static>) -> String {
        area.lines().join("\n")
    }

    /// Render the current template against the current (YAML) data.
    ///
    /// # Errors
    /// A YAML parse error for the data or catalog, the template parse error, or — in compat
    /// mode — the reason AOT would reject the template (e.g. a host helper).
    pub fn render(&self) -> Result<String, String> {
        let template = Template::parse(&Self::pane_text(&self.template))?;
        let data = data::parse(&Self::pane_text(&self.data))?;
        match self.mode {
            Mode::Compat => template.render_compat(&data),
            Mode::Render => {
                let catalog = Rc::new(i18n::parse_catalog(&Self::pane_text(&self.i18n))?);
                let mut helpers = Helpers::new();
                i18n::register(&mut helpers, self.locale, &catalog);
                template.render_with(&data, &Rc::new(helpers))
            }
        }
    }

    /// A hash of every input [`Lab::render`] reads — the cache key. Lines are hashed with a
    /// separator so `["ab"]` and `["a","b"]` differ; the enums fold in via their stable keys.
    fn input_key(&self) -> u64 {
        let mut h = DefaultHasher::new();
        for (tag, area) in [(0u8, &self.template), (1, &self.data), (2, &self.i18n)] {
            tag.hash(&mut h);
            for line in area.lines() {
                line.hash(&mut h);
                0xFFu8.hash(&mut h);
            }
        }
        self.locale.code().hash(&mut h);
        self.mode.key().hash(&mut h);
        self.sample.key().hash(&mut h);
        h.finish()
    }

    /// [`Lab::render`] flattened to text: the output, or a one-line rejection marker.
    /// Memoized on [`Lab::input_key`], so a single frame's `ui()` + scroll-clamp pair
    /// renders once; a stale key is impossible because it covers every render input.
    #[must_use]
    pub fn render_or_reject(&self) -> String {
        let key = self.input_key();
        if let Some((cached, out)) = self.render_cache.borrow().as_ref()
            && *cached == key
        {
            return out.clone();
        }
        let out = match self.render() {
            Ok(out) => out,
            Err(reason) => format!("⟂ {reason}\n"),
        };
        *self.render_cache.borrow_mut() = Some((key, out.clone()));
        out
    }

    pub fn cycle_locale(&mut self) {
        self.locale = self.locale.next();
    }

    pub fn toggle_mode(&mut self) {
        self.mode = self.mode.toggle();
    }

    /// Load the next sample, reseeding the template + data panes (keeps the i18n catalog,
    /// locale, and mode).
    pub fn cycle_sample(&mut self) {
        let next = self.sample.next();
        self.sample = next;
        self.template = area_from(next.template());
        self.data = area_from(next.data_yaml());
        self.focus = Focus::Template;
        // The new sample's Output has its own length; a stale offset from the old one
        // would paint the pane blank until the user scrolls back up.
        self.output_scroll = 0;
        self.rehighlight_template();
    }

    pub fn cycle_focus(&mut self) {
        self.focus = match self.focus {
            Focus::Template => Focus::Data,
            // Skip the i18n pane on samples that don't use it (it's hidden).
            Focus::Data if self.sample.uses_i18n() => Focus::I18n,
            Focus::Data | Focus::I18n => Focus::Template,
        };
    }

    /// The text area currently receiving edits.
    pub fn focused_mut(&mut self) -> &mut TextArea<'static> {
        match self.focus {
            Focus::Template => &mut self.template,
            Focus::Data => &mut self.data,
            Focus::I18n => &mut self.i18n,
        }
    }

    /// Replace a pane's contents (used by tests).
    pub fn set_data(&mut self, yaml: &str) {
        self.data = area_from(yaml);
    }

    /// Replace the i18n catalog pane (used by tests).
    pub fn set_i18n(&mut self, yaml: &str) {
        self.i18n = area_from(yaml);
    }

    /// Scroll a pane by `delta` lines (negative = up). Editor panes delegate to the
    /// text area (which also clamps); the Output is a plain paragraph, clamped here.
    pub fn scroll(&mut self, pane: Pane, delta: i16, area: Rect) {
        match pane {
            Pane::Template => self.template.scroll((delta, 0)),
            Pane::Data => self.data.scroll((delta, 0)),
            Pane::I18n => self.i18n.scroll((delta, 0)),
            Pane::Output => {
                let visible = panes(area, self.sample.uses_i18n())
                    .output
                    .height
                    .saturating_sub(2);
                let lines = self.render_or_reject().lines().count();
                let next = i32::from(self.output_scroll) + i32::from(delta);
                let raised = u16::try_from(next.max(0)).unwrap_or(u16::MAX);
                self.output_scroll = clamp_output_scroll(raised, lines, visible);
            }
        }
    }
}

impl Default for Lab {
    fn default() -> Self {
        Self::new()
    }
}

/// Clamp an Output scroll offset so the last line stays in view: the upper bound is
/// `lines − visible`. Applied at draw time too, so a render that *shrank* (an edit, a
/// locale/mode switch) never leaves the pane scrolled past its content into blankness.
#[must_use]
pub fn clamp_output_scroll(scroll: u16, lines: usize, visible: u16) -> u16 {
    let max = lines.saturating_sub(usize::from(visible));
    scroll.min(u16::try_from(max).unwrap_or(u16::MAX))
}

/// Draw the whole lab to `frame`.
pub fn ui(frame: &mut Frame, lab: &Lab) {
    let p = panes(frame.area(), lab.sample.uses_i18n());

    let title = Line::from(vec![
        Span::styled(
            "  Trussbars VM · mini-Lab ",
            Style::new().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(
                "· {} · {} · {}",
                lab.sample.key(),
                lab.locale.label(),
                lab.mode.label()
            ),
            Style::new().fg(Color::DarkGray),
        ),
    ]);
    frame.render_widget(Paragraph::new(title), p.header);

    render_textarea(
        frame,
        p.template,
        "Template",
        &lab.template,
        lab.focus == Focus::Template,
    );
    render_textarea(
        frame,
        p.data,
        "Data (YAML)",
        &lab.data,
        lab.focus == Focus::Data,
    );
    if lab.sample.uses_i18n() {
        render_textarea(
            frame,
            p.i18n,
            "i18n catalog (YAML)",
            &lab.i18n,
            lab.focus == Focus::I18n,
        );
    }

    let out = lab.render_or_reject();
    let out_lines: Vec<Line> = out
        .lines()
        .map(|l| {
            if l.starts_with('⟂') {
                Line::from(Span::styled(l.to_string(), Style::new().fg(Color::Yellow)))
            } else {
                Line::from(l.to_string())
            }
        })
        .collect();
    let out_len = out.lines().count();
    let scroll = clamp_output_scroll(
        lab.output_scroll,
        out_len,
        p.output.height.saturating_sub(2),
    );
    frame.render_widget(
        Paragraph::new(out_lines)
            .scroll((scroll, 0))
            .block(Block::bordered().title(format!(" Output · {} ", lab.mode.key()))),
        p.output,
    );
    maybe_scrollbar(frame, p.output, out_len, scroll);

    // Get cursor position from the focused pane (1-indexed for display).
    let cursor_info = match lab.focus {
        Focus::Template => {
            let (row, col) = lab.template.cursor();
            format!(" Ln {}, Col {} ", row + 1, col + 1)
        }
        Focus::Data => {
            let (row, col) = lab.data.cursor();
            format!(" Ln {}, Col {} ", row + 1, col + 1)
        }
        Focus::I18n => {
            let (row, col) = lab.i18n.cursor();
            format!(" Ln {}, Col {} ", row + 1, col + 1)
        }
    };

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(
                cursor_info,
                Style::new().fg(Color::Cyan),
            ),
            Span::styled(
                " [Tab/click] focus  [F2] locale  [F3] mode  [F4] sample  [wheel/PgUp/PgDn] scroll  [Esc] quit ",
                Style::new().fg(Color::DarkGray),
            ),
        ])),
        p.help,
    );
}

/// Render a `tui-textarea` pane inside a focus-styled border.
fn render_textarea(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    ta: &TextArea<'static>,
    focused: bool,
) {
    let border = if focused {
        Style::new().fg(Color::Cyan)
    } else {
        Style::new().fg(Color::DarkGray)
    };
    let block = Block::bordered()
        .border_style(border)
        .title(format!(" {title} "));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    frame.render_widget(ta, inner);
}

/// Draw a vertical scrollbar on `area`'s right border, but only when `content` overflows
/// the inner height — the "optional" scrollbar.
fn maybe_scrollbar(frame: &mut Frame, area: Rect, content: usize, scroll: u16) {
    let visible = usize::from(area.height.saturating_sub(2));
    if content > visible {
        let mut state = ScrollbarState::new(content)
            .viewport_content_length(visible)
            .position(usize::from(scroll));
        frame.render_stateful_widget(
            Scrollbar::new(ScrollbarOrientation::VerticalRight),
            area,
            &mut state,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_output_scroll_keeps_the_last_line_in_view() {
        // 10 lines, 4 visible → the furthest useful offset is 6; anything beyond clamps.
        assert_eq!(clamp_output_scroll(0, 10, 4), 0);
        assert_eq!(clamp_output_scroll(6, 10, 4), 6);
        assert_eq!(clamp_output_scroll(99, 10, 4), 6);
        // Content shorter than the viewport pins to the top (the blank-pane case).
        assert_eq!(clamp_output_scroll(50, 2, 4), 0);
    }

    #[test]
    fn render_cache_invalidates_on_input_change() {
        // The memo must reflect edits, not freeze the first render (the staleness bug A
        // could otherwise introduce). Editing the Data pane moves the key → fresh render.
        let mut lab = Lab::from_sample(Sample::Greeting);
        let first = lab.render_or_reject();
        assert!(first.contains("Hello, Ada!"), "{first:?}");
        lab.set_data("customer: Bob\ngreeting: Hi\nnote: x\n");
        let second = lab.render_or_reject();
        assert!(
            second.contains("Hi, Bob!"),
            "cache ignored the edit: {second:?}"
        );
        assert_ne!(first, second);
    }

    #[test]
    fn cycle_sample_resets_the_output_scroll() {
        // Bug B: a stale offset from the previous sample must not survive the switch.
        let mut lab = Lab::new();
        lab.output_scroll = 50;
        lab.cycle_sample();
        assert_eq!(lab.output_scroll, 0);
    }
}
