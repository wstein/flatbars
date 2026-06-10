// SPDX-License-Identifier: Apache-2.0
//
// The lessons — ONE source per example, imported by both the tutorial pages
// (preview + "Open in Lab" button) and the CI gate (scripts/check-tutorial-links.mjs,
// which renders each through the real engine and asserts it works). So a lesson
// example can never silently drift from what renders. Each `spec` is the Antora
// page that owns the *normative* description; the tutorial never forks that text.

export const lessons = {
  rawbars: {
    engine: "rawbars",
    title: "RawBars — the desugared core surface",
    blurb:
      "The core syntax, exposed: no surface sugar — every value is an explicit helper " +
      "application. {{{ … }}} is raw output; escape with escapeHtml; read fields with lookup.",
    spec: "concepts", // docs/modules/ROOT/pages/concepts.adoc
    template:
      '<h1>{{{escapeHtml (lookup this "name")}}}</h1>\n' +
      '<ul>{% each (lookup this "items") %}<li>{{{escapeHtml this}}}</li>{% endeach %}</ul>',
    data: { name: "Ada <core>", items: ["alpha", "beta"] },
  },

  minbars: {
    engine: "minbars",
    title: "MinBars — Mustache-compatible",
    blurb:
      "The complete logic-less language, Mustache-compatible: {{name}} interpolates " +
      "(HTML-escaped), {{#section}} iterates or guards, {{^inverted}} renders when " +
      "falsy, {{.}} is the current item.",
    spec: "maxbars", // (Mustache surface; see the engine docs)
    template:
      "<h1>{{name}}</h1>\n" +
      "{{#items}}<li>{{.}}</li>{{/items}}{{^items}}<li><em>no items</em></li>{{/items}}",
    data: { name: "Ada", items: ["alpha", "beta"] },
  },

  classicbars: {
    engine: "classicbars",
    title: "ClassicBars — Handlebars-faithful",
    blurb:
      "Faithful to Handlebars, the industry-standard {{ }} engine: {{name}} auto-escapes, dotted paths " +
      "read data, {{#each}} / {{#if}} are block helpers, and you register your own " +
      "with registerHelper (ADR-018).",
    spec: "surface", // docs/modules/ROOT/pages/surface.adoc
    template:
      "<h1>Hello, {{loud name}}!</h1>\n" +
      "<ul>{{#each items}}<li>{{this}}</li>{{/each}}</ul>",
    data: { name: "Ada", items: ["alpha", "beta"] },
    // A user-defined helper, exactly as in Handlebars (ADR-018). It is escaped
    // by default in {{ }}; return safe(html) for raw markup. The optional 3rd
    // arg declares an arity, so {{loud}} or {{loud a b}} report like a built-in.
    helpers: "registerHelper('loud', (s) => String(s).toUpperCase(), 1)",
  },

  maxbars: {
    engine: "maxbars",
    title: "MaxBars — the FlatBars expression language",
    blurb:
      "FlatBars' flagship and most capable surface. Infix operators, pipes, and bare " +
      "loop variables put real expression back in the template: write conditions like " +
      "score >= 50 and transform with value | helper.",
    spec: "maxbars", // docs/modules/ROOT/pages/maxbars.adoc
    // The landing's "Edit the template. Watch it render." flagship — one screen of
    // MaxBars' signature: a pipe (uppercase), Liquid-style loop bindings with an
    // index (p i in players), infix arithmetic (i + 1), an infix comparison (>= 90).
    template: `{{ title | uppercase }}
{% each p i in players %}
{{ i + 1 }}. {{ p.name }} — {{ p.score }} {% if p.score >= 90 %}👑{% endif %}
{% endeach %}`,
    data: {
      title: "top scorers",
      players: [
        { name: "Ada", score: 92 },
        { name: "Lin", score: 47 },
        { name: "Bo", score: 63 },
      ],
    },
  },
};

export const surfaces = Object.keys(lessons);
