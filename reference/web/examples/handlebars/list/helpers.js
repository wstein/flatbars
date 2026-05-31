// Custom Handlebars helpers. `Handlebars` is already in scope (no import
// needed), along with `data` (the view-model — return a value to transform it)
// and a `helper(name, fn)` shorthand for Handlebars.registerHelper.

// Render a task's done flag as a check or an empty circle.
Handlebars.registerHelper("statusIcon", (done) => (done ? "✓" : "○"));

// Pluralize a count: 1 task · 3 tasks.
Handlebars.registerHelper(
  "pluralize",
  (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`,
);
