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
    title: "RawBars — the austere core",
    blurb:
      "No surface sugar: every value is an explicit helper application. " +
      "{{{ … }}} is raw output; escape with escapeHtml; read fields with lookup.",
    spec: "concepts", // docs/modules/ROOT/pages/concepts.adoc
    template:
      '<h1>{{{ escapeHtml (lookup this "name") }}}</h1>\n' +
      '<ul>{{#each (lookup this "items")}}<li>{{{ escapeHtml this }}}</li>{{/each}}</ul>',
    data: { name: "Ada <core>", items: ["alpha", "beta"] },
  },

  minbars: {
    engine: "minbars",
    title: "MinBars — Mustache-compatible",
    blurb:
      "Logic-less Mustache: {{name}} interpolates (HTML-escaped), {{#section}} " +
      "iterates/guards, {{^inverted}} renders when falsy, {{.}} is the item.",
    spec: "maxbars", // (Mustache surface; see the engine docs)
    template:
      "<h1>{{name}}</h1>\n" +
      "{{#items}}<li>{{.}}</li>{{/items}}{{^items}}<li><em>no items</em></li>{{/items}}",
    data: { name: "Ada", items: ["alpha", "beta"] },
  },

  fullbars: {
    engine: "fullbars",
    title: "FullBars — Handlebars-flavoured",
    blurb:
      "The reference engine: {{ name }} auto-escapes, dotted paths read data, " +
      "and {{#each}} / {{#if}} are block helpers.",
    spec: "surface", // docs/modules/ROOT/pages/surface.adoc
    template:
      "<h1>Hello, {{ name }}!</h1>\n" +
      "<ul>{{#each items}}<li>{{ this }}</li>{{/each}}</ul>",
    data: { name: "Ada", items: ["alpha", "beta"] },
  },

  maxbars: {
    engine: "maxbars",
    title: "MaxBars — the full FlatBars language",
    blurb:
      "The complete, native FlatBars surface — FullBars plus infix operators and " +
      "pipes: write conditions like score >= 50 and transform with value | helper.",
    spec: "maxbars", // docs/modules/ROOT/pages/maxbars.adoc
    template:
      "<p>{{ greeting }}, {{ name }}!</p>\n" +
      "{{#if score >= 50}}<b>pass</b>{{else}}<b>fail</b>{{/if}}",
    data: { greeting: "Hi", name: "Ada", score: 72 },
  },
};

export const surfaces = Object.keys(lessons);
