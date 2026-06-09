//! # trussbars-lab — the VM northstar (Ratatui TUI)
//!
//! A terminal **mini-Lab** on the dynamic VM ([`trussbars_vm`]): edit a template and its
//! data live and watch it re-render — the case the AOT (`truss!`) path structurally
//! can't serve. Built with [`ratatui`] over the crossterm backend.
//!
//! Two things it proves, straight from `docs/11`:
//! 1. **The VM leads AOT on host helpers & i18n (§8).** The `receipt` sample calls
//!    `{{t …}}`/`{{number …}}`/`{{plural …}}`/`{{date …}}`/`{{relative …}}` — host
//!    helpers registered at runtime ([`i18n::register`]); cycling the locale flips the
//!    title, plural noun, grouped number, and localized month name.
//! 2. **`render_compat` is the AOT-parity proxy (§7).** Toggle [`Mode::Compat`] and both
//!    samples are rejected — host helpers are VM-only. Strip a template to plain
//!    `{{field}}` interpolation and compat renders byte-identically to lenient.
//!
//! The render core ([`Lab::render`]) and the editor ([`editor::TextBuffer`]) are pure and
//! unit/golden-tested; [`ui`] is drawn headlessly under a `TestBackend` (`tests/`). The
//! `main.rs` event loop is the only part that touches a real terminal.

#![forbid(unsafe_code)]

pub mod data;
pub mod editor;
pub mod highlight;
pub mod i18n;
pub mod samples;

use std::rc::Rc;

use ratatui::{
    Frame,
    layout::{Constraint, Layout, Position, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Paragraph},
};
use trussbars_vm::{Helpers, Template};

use crate::editor::TextBuffer;
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

/// Every scrollable pane — the three editors plus the read-only Output.
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

/// Per-pane vertical scroll offset (the first line shown).
#[derive(Clone, Copy, Debug, Default)]
pub struct Scroll {
    pub template: u16,
    pub data: u16,
    pub i18n: u16,
    pub output: u16,
}

impl Scroll {
    #[must_use]
    pub fn get(&self, pane: Pane) -> u16 {
        match pane {
            Pane::Template => self.template,
            Pane::Data => self.data,
            Pane::I18n => self.i18n,
            Pane::Output => self.output,
        }
    }

    fn slot(&mut self, pane: Pane) -> &mut u16 {
        match pane {
            Pane::Template => &mut self.template,
            Pane::Data => &mut self.data,
            Pane::I18n => &mut self.i18n,
            Pane::Output => &mut self.output,
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
/// and a help line. Shared by [`ui`] and the event loop (so mouse hit-testing matches what
/// is drawn).
#[must_use]
pub fn panes(area: Rect) -> Panes {
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
    let [output, i18n] =
        Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).areas(bottom);
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
        let pos = Position::new(col, row);
        [Pane::Template, Pane::Data, Pane::I18n, Pane::Output]
            .into_iter()
            .find(|&p| self.rect(p).contains(pos))
    }
}

/// The visible text height of a pane (its inner height, minus the border).
fn visible_height(pane: Pane, area: Rect) -> u16 {
    panes(area).rect(pane).height.saturating_sub(2)
}

/// The whole lab state: the editable template, data, and i18n catalog, plus the selected
/// sample, locale, mode, focus, and per-pane scroll.
#[derive(Clone, Debug)]
pub struct Lab {
    pub sample: Sample,
    pub locale: Locale,
    pub mode: Mode,
    pub focus: Focus,
    pub template: TextBuffer,
    pub data: TextBuffer,
    /// The message catalog (YAML), shared across samples — not reseeded on sample change.
    pub i18n: TextBuffer,
    pub scroll: Scroll,
}

impl Lab {
    /// Seed the lab from a sample (English, lenient render, template focused, default
    /// i18n catalog).
    #[must_use]
    pub fn from_sample(sample: Sample) -> Self {
        Lab {
            sample,
            locale: Locale::En,
            mode: Mode::Render,
            focus: Focus::Template,
            template: TextBuffer::from_text(sample.template()),
            data: TextBuffer::from_text(sample.data_yaml()),
            i18n: TextBuffer::from_text(i18n::CATALOG_SEED),
            scroll: Scroll::default(),
        }
    }

    /// The opening state: the receipt sample.
    #[must_use]
    pub fn new() -> Self {
        Self::from_sample(Sample::Receipt)
    }

    /// Render the current template against the current (YAML) data.
    ///
    /// Lenient mode wires the i18n host-helper pack (bound to the lab's locale); compat
    /// mode runs the AOT-parity proxy with no helpers.
    ///
    /// # Errors
    /// A YAML parse error for the data or the catalog, the template parse error, or — in
    /// compat mode — the reason AOT would reject the template (e.g. a host helper).
    pub fn render(&self) -> Result<String, String> {
        let template = Template::parse(&self.template.text())?;
        let data = data::parse(&self.data.text())?;
        match self.mode {
            Mode::Compat => template.render_compat(&data),
            Mode::Render => {
                let catalog = Rc::new(i18n::parse_catalog(&self.i18n.text())?);
                let mut helpers = Helpers::new();
                i18n::register(&mut helpers, self.locale, &catalog);
                template.render_with(&data, &Rc::new(helpers))
            }
        }
    }

    /// [`Lab::render`] flattened to text: the output, or a one-line rejection marker.
    #[must_use]
    pub fn render_or_reject(&self) -> String {
        match self.render() {
            Ok(out) => out,
            Err(reason) => format!("⟂ {reason}\n"),
        }
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
        self.template = TextBuffer::from_text(next.template());
        self.data = TextBuffer::from_text(next.data_yaml());
        self.focus = Focus::Template;
    }

    pub fn cycle_focus(&mut self) {
        self.focus = match self.focus {
            Focus::Template => Focus::Data,
            Focus::Data => Focus::I18n,
            Focus::I18n => Focus::Template,
        };
    }

    /// The buffer currently receiving edits.
    pub fn focused_mut(&mut self) -> &mut TextBuffer {
        match self.focus {
            Focus::Template => &mut self.template,
            Focus::Data => &mut self.data,
            Focus::I18n => &mut self.i18n,
        }
    }

    /// The number of display lines a pane currently holds.
    fn pane_line_count(&self, pane: Pane) -> usize {
        match pane {
            Pane::Template => self.template.line_count(),
            Pane::Data => self.data.line_count(),
            Pane::I18n => self.i18n.line_count(),
            Pane::Output => self.render_or_reject().lines().count().max(1),
        }
    }

    /// Scroll a pane by `delta` lines (negative = up), clamped to its content within
    /// `area`. Used by the mouse wheel and `PageUp`/`PageDown`.
    pub fn scroll_pane(&mut self, pane: Pane, delta: i32, area: Rect) {
        let visible = i32::from(visible_height(pane, area));
        let max = (self.pane_line_count(pane) as i32 - visible).max(0);
        let next = (i32::from(self.scroll.get(pane)) + delta).clamp(0, max);
        *self.scroll.slot(pane) = u16::try_from(next).unwrap_or(u16::MAX);
    }

    /// Keep the focused editor's cursor in view after a move/edit, scrolling minimally.
    pub fn follow_cursor(&mut self, area: Rect) {
        let pane = self.focus.pane();
        let visible = visible_height(pane, area);
        if visible == 0 {
            return;
        }
        let (cy, _) = self.focused_ref().cursor();
        let cy = u16::try_from(cy).unwrap_or(u16::MAX);
        let slot = self.scroll.slot(pane);
        if cy < *slot {
            *slot = cy;
        } else if cy >= *slot + visible {
            *slot = cy - visible + 1;
        }
    }

    fn focused_ref(&self) -> &TextBuffer {
        match self.focus {
            Focus::Template => &self.template,
            Focus::Data => &self.data,
            Focus::I18n => &self.i18n,
        }
    }
}

impl Default for Lab {
    fn default() -> Self {
        Self::new()
    }
}

/// Draw the whole lab to `frame`. Pure over `lab` (no I/O), so it renders identically
/// under a real terminal or a `TestBackend`.
pub fn ui(frame: &mut Frame, lab: &Lab) {
    let p = panes(frame.area());

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

    let tmpl_inner = render_editor(
        frame,
        p.template,
        "Template",
        highlight::template_lines(&lab.template.text()),
        lab.focus == Focus::Template,
        lab.scroll.template,
    );
    let data_inner = render_editor(
        frame,
        p.data,
        "Data (YAML)",
        lab.data.rows().map(Line::from).collect(),
        lab.focus == Focus::Data,
        lab.scroll.data,
    );
    let i18n_inner = render_editor(
        frame,
        p.i18n,
        "i18n catalog (YAML)",
        lab.i18n.rows().map(Line::from).collect(),
        lab.focus == Focus::I18n,
        lab.scroll.i18n,
    );

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
    frame.render_widget(
        Paragraph::new(out_lines)
            .scroll((lab.scroll.output, 0))
            .block(Block::bordered().title(format!(" Output · {} ", lab.mode.key()))),
        p.output,
    );

    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            " [Tab/click] focus  [F2] locale  [F3] mode  [F4] sample  [wheel/PgUp/PgDn] scroll  [Esc] quit ",
            Style::new().fg(Color::DarkGray),
        ))),
        p.help,
    );

    // Place the terminal cursor in the focused pane, accounting for its scroll; hide it
    // (skip) when the cursor has scrolled out of view.
    let (inner, buf, scroll) = match lab.focus {
        Focus::Template => (tmpl_inner, &lab.template, lab.scroll.template),
        Focus::Data => (data_inner, &lab.data, lab.scroll.data),
        Focus::I18n => (i18n_inner, &lab.i18n, lab.scroll.i18n),
    };
    if inner.width > 0 && inner.height > 0 {
        let (cy, cx) = buf.cursor();
        let cy = u16::try_from(cy).unwrap_or(u16::MAX);
        if cy >= scroll && cy - scroll < inner.height {
            let x = inner.x + u16::try_from(cx).unwrap_or(u16::MAX).min(inner.width - 1);
            frame.set_cursor_position(Position::new(x, inner.y + (cy - scroll)));
        }
    }
}

/// Render one pane (prebuilt `lines`, scrolled by `scroll`) and return its inner area.
fn render_editor(
    frame: &mut Frame,
    area: Rect,
    title: &str,
    lines: Vec<Line<'static>>,
    focused: bool,
    scroll: u16,
) -> Rect {
    let border = if focused {
        Style::new().fg(Color::Cyan)
    } else {
        Style::new().fg(Color::DarkGray)
    };
    let block = Block::bordered()
        .border_style(border)
        .title(format!(" {title} "));
    let inner = block.inner(area);
    frame.render_widget(Paragraph::new(lines).scroll((scroll, 0)).block(block), area);
    inner
}
