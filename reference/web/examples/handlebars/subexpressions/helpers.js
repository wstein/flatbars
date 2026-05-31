// Small helpers composed via subexpressions in the template.
Handlebars.registerHelper("upper", (s) => String(s).toUpperCase());

// `concat` joins its positional args (the last arg is Handlebars' options).
Handlebars.registerHelper("concat", function (...args) {
  return args.slice(0, -1).join(" ");
});

Handlebars.registerHelper("gt", (a, b) => a > b);

Handlebars.registerHelper("add", (a, b) => a + b);

Handlebars.registerHelper("repeat", (s, n) => String(s).repeat(n));

// Return the first truthy positional argument (ignoring the options object).
Handlebars.registerHelper("or", function (...args) {
  return args.slice(0, -1).find((v) => v) || "";
});
