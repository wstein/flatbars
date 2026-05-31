// A raw-block helper: returns its block body unprocessed, so the mustaches
// inside `{{{{raw}}}} … {{{{/raw}}}}` are emitted verbatim.
Handlebars.registerHelper("raw", function (options) {
  return options.fn(this);
});
