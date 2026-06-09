//! # trussbars-lab — the VM northstar
//!
//! A **mini Lab** built on the dynamic VM ([`trussbars_vm`]): parse a template and
//! re-render it against data at *runtime*, the case the AOT (`truss!`) path
//! structurally cannot serve. It is the runtime mirror of the `blog`/`changelog`
//! AOT examples, and it doubles as a worked **i18n integration**.
//!
//! Two things it sets out to prove, both straight from `docs/11`:
//!
//! 1. **The VM leads AOT on host helpers & i18n (§8).** The `receipt` sample calls
//!    `{{t …}}` / `{{number …}}` / `{{plural …}}` / `{{date …}}` — host helpers
//!    registered at runtime ([`i18n::register`]). The `greeting` sample localizes
//!    the *opposite* way — the host bakes already-translated strings into the data —
//!    so it needs no helpers and compiles under AOT too.
//! 2. **`render_compat` is the AOT-parity proxy (§7).** Toggle [`Mode::Compat`] and
//!    the receipt is *rejected* (host helpers are VM-only); the greeting renders
//!    byte-identically. "If it renders in compat, it compiles under AOT."
//!
//! The render core ([`Lab::render`]) is a pure function of state, so it is
//! golden-tested headlessly (`tests/golden.rs`); `main.rs` is only the terminal I/O.

#![forbid(unsafe_code)]

pub mod i18n;
pub mod samples;

use std::rc::Rc;

use trussbars_vm::{Helpers, Template};

use crate::samples::Sample;

/// A display locale. BCP-47 primary subtag + a human label.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Locale {
    En,
    De,
    Fr,
}

impl Locale {
    /// Every locale, for the golden matrix and the UI cycle.
    pub const ALL: [Locale; 3] = [Locale::En, Locale::De, Locale::Fr];

    /// The BCP-47 primary subtag (what `selectPlural` and the template's `locale`
    /// data field carry).
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Locale::En => "en",
            Locale::De => "de",
            Locale::Fr => "fr",
        }
    }

    /// The human-facing name shown in the status bar.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Locale::En => "English",
            Locale::De => "Deutsch",
            Locale::Fr => "Français",
        }
    }

    /// The next locale in the UI cycle.
    #[must_use]
    pub fn next(self) -> Locale {
        match self {
            Locale::En => Locale::De,
            Locale::De => Locale::Fr,
            Locale::Fr => Locale::En,
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
    /// Every mode, for the golden matrix.
    pub const ALL: [Mode; 2] = [Mode::Render, Mode::Compat];

    /// A short, stable key used in golden filenames.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Mode::Render => "render",
            Mode::Compat => "compat",
        }
    }

    /// The human-facing label shown in the status bar.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Mode::Render => "render (VM, lenient)",
            Mode::Compat => "render_compat (AOT-parity proxy)",
        }
    }

    /// Toggle between the two modes.
    #[must_use]
    pub fn toggle(self) -> Mode {
        match self {
            Mode::Render => Mode::Compat,
            Mode::Compat => Mode::Render,
        }
    }
}

/// The whole lab state: which sample, locale, and render mode are selected.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Lab {
    pub sample: Sample,
    pub locale: Locale,
    pub mode: Mode,
}

impl Lab {
    /// The opening state: the receipt sample, English, lenient VM render.
    #[must_use]
    pub fn new() -> Self {
        Lab {
            sample: Sample::Receipt,
            locale: Locale::En,
            mode: Mode::Render,
        }
    }

    /// Render the current sample against its data.
    ///
    /// In [`Mode::Render`] the i18n host-helper pack is registered and the template
    /// runs through [`Template::render_with`]. In [`Mode::Compat`] no helpers are
    /// registered and [`Template::render_compat`] runs the AOT-parity proxy — so a
    /// host-helper template returns the AOT rejection reason (the documented
    /// VM-leads-AOT divergence), while a plain one renders byte-identically.
    ///
    /// # Errors
    /// The parse-error reason, or — in compat mode — the reason AOT would reject the
    /// template (e.g. a host helper it cannot resolve).
    pub fn render(&self) -> Result<String, String> {
        let template = Template::parse(self.sample.template())?;
        let data = self.sample.data(self.locale);
        match self.mode {
            Mode::Compat => template.render_compat(&data),
            Mode::Render => {
                let mut helpers = Helpers::new();
                i18n::register(&mut helpers, self.locale);
                template.render_with(&data, &Rc::new(helpers))
            }
        }
    }

    /// [`Lab::render`] flattened to text: the output, or a one-line rejection marker.
    /// This is what the golden matrix pins and what the TUI shows in the output pane.
    #[must_use]
    pub fn render_or_reject(&self) -> String {
        match self.render() {
            Ok(out) => out,
            Err(reason) => format!("⟂ AOT-rejected: {reason}\n"),
        }
    }
}

impl Default for Lab {
    fn default() -> Self {
        Self::new()
    }
}
