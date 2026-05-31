// Custom BLOCK helpers. A block helper receives the inner template as
// `options.fn(context)` and (for {{else}}) `options.inverse(context)`, and
// returns the rendered string. Return a Handlebars.SafeString to emit raw HTML.

// Wrap the block's output in <strong>.
Handlebars.registerHelper("bold", function (options) {
  return new Handlebars.SafeString("<strong>" + options.fn(this) + "</strong>");
});

// Render the block once per array item, with the item as context.
Handlebars.registerHelper("list", function (items, options) {
  const rows = items.map((item) => "<li>" + options.fn(item) + "</li>").join("");
  return new Handlebars.SafeString("<ul>" + rows + "</ul>");
});

// Call the block `n` times. A private data frame (Handlebars.createFrame)
// exposes @index (0-based) and @index1 (1-based) to the block, the way the
// built-in {{#each}} exposes @index.
Handlebars.registerHelper("times", function (n, options) {
  let out = "";
  for (let i = 0; i < n; i++) {
    const data = Handlebars.createFrame(options.data || {});
    data.index = i;
    data.index1 = i + 1;
    out += options.fn(this, { data });
  }
  return out;
});

// A conditional block helper with an {{else}} (inverse) branch.
Handlebars.registerHelper("ifEquals", function (a, b, options) {
  return a === b ? options.fn(this) : options.inverse(this);
});
