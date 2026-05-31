-- | Generated from examples/** by scripts/generate-examples.mjs.
-- | Do not edit by hand.
module Playground.Examples where

type Example = { id :: String, label :: String, template :: String, dataText :: String }

examples :: Array Example
examples =
  [ { id: "greeting"
    , label: "Greeting"
    , template: "<h1>Hello {{{esc_html (lookup this \"name\")}}}!</h1>"
    , dataText: "{ \"name\": \"World\" }"
    }
  , { id: "list"
    , label: "List (each)"
    , template:
        "<ul>\n{{#each (lookup this \"items\")}}  <li>{{{index}}}. {{{esc_html this}}}</li>\n{{/each}}</ul>"
    , dataText: "{ \"items\": [\"alpha\", \"beta\", \"gamma\"] }"
    }
  , { id: "conditional"
    , label: "Conditional (clauses)"
    , template:
        "{{#if (lookup this \"loggedIn\")}}<p>Welcome back, {{{esc_html (lookup this \"user\")}}}.</p>{{else}}<p>Please sign in.</p>{{/if}}"
    , dataText: "{ \"loggedIn\": true, \"user\": \"Ada\" }"
    }
  , { id: "object"
    , label: "Object (each + key)"
    , template:
        "<dl>\n{{#each (lookup this \"profile\")}}  <dt>{{{esc_html key}}}</dt><dd>{{{esc_html this}}}</dd>\n{{/each}}</dl>"
    , dataText: "{ \"profile\": { \"name\": \"Grace\", \"role\": \"Compiler\" } }"
    }
  , { id: "table"
    , label: "Table (with)"
    , template:
        "{{#with (lookup this \"report\")}}<table>\n{{#each (lookup this \"rows\")}}  <tr><td>{{{esc_html (lookup this \"k\")}}}</td><td>{{{esc_html (lookup this \"v\")}}}</td></tr>\n{{/each}}</table>{{/with}}"
    , dataText:
        "{ \"report\": { \"rows\": [ { \"k\": \"CPU\", \"v\": \"42%\" }, { \"k\": \"RAM\", \"v\": \"7.1 GB\" } ] } }"
    }
  , { id: "truthiness"
    , label: "Truthiness (vs Handlebars)"
    , template:
        "<style>\n  .tt-wrap{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;color:#18181b;-webkit-font-smoothing:antialiased;}\n  .tt-title{font-size:12.5px;font-weight:600;color:#71717a;letter-spacing:.08em;text-transform:uppercase;margin:0 0 14px;}\n  table.tt{border-collapse:separate;border-spacing:0;width:100%;max-width:880px;background:#fff;border:1px solid #e4e4e7;border-radius:14px;overflow:hidden;font-size:17px;box-shadow:0 1px 2px rgba(24,24,27,.05),0 12px 28px -16px rgba(24,24,27,.18);}\n  .tt th,.tt td{padding:14px 22px;text-align:left;border-bottom:1px solid #f0f0f1;border-right:1px solid #f0f0f1;vertical-align:middle;}\n  .tt th:last-child,.tt td:last-child{border-right:none;}\n  .tt tbody tr:last-child td{border-bottom:none;}\n  .tt thead th{background:#f4f4f5;font-weight:600;font-size:15px;letter-spacing:.01em;color:#3f3f46;}\n  .tt code{font-family:ui-monospace,\"SF Mono\",SFMono-Regular,Menlo,Consolas,monospace;background:#f3f3f5;border:1px solid #e7e7ea;padding:2px 8px;border-radius:6px;font-size:14.5px;color:#18181b;}\n  .tt .desc{color:#71717a;}\n  .tt .truthy{color:#15803d;font-weight:600;}\n  .tt .falsy{color:#be123c;font-weight:600;}\n  .tt .parity{text-align:center;}\n  .tt .parity svg{width:20px;height:20px;display:inline-block;vertical-align:middle;}\n  .tt col.c-fb{width:150px;}\n  .tt col.c-hb{width:236px;}\n  .tt col.c-p{width:104px;}\n</style>\n<div class=\"tt-wrap\">\n  <p class=\"tt-title\">Truthiness — FullBars vs Handlebars</p>\n  <table class=\"tt\">\n    <colgroup><col><col class=\"c-fb\"><col class=\"c-hb\"><col class=\"c-p\"></colgroup>\n    <thead>\n      <tr><th>Value</th><th>FullBars</th><th>Handlebars</th><th class=\"parity\">Parity</th></tr>\n    </thead>\n    <tbody>\n    {{#each (lookup this \"cases\")}}\n      <tr>\n        <td><code>{{{esc_html (lookup this \"token\")}}}</code>{{#if (lookup this \"desc\")}} <span class=\"desc\">({{{esc_html (lookup this \"desc\")}}})</span>{{/if}}{{#if (lookup this \"cont\")}} <span class=\"desc\">{{{esc_html (lookup this \"cont\")}}}</span> <code>{{{esc_html (lookup this \"token2\")}}}</code>{{/if}}</td>\n        <td>{{#if (lookup this \"includeZero\")}}{{#if (lookup this \"v\") (dict \"includeZero\" true)}}<span class=\"truthy\">truthy</span>{{else}}<span class=\"falsy\">falsy</span>{{/if}}{{else}}{{#if (lookup this \"v\")}}<span class=\"truthy\">truthy</span>{{else}}<span class=\"falsy\">falsy</span>{{/if}}{{/if}}</td>\n        <td>{{#if (lookup this \"hbTruthy\")}}<span class=\"truthy\">truthy</span>{{else}}<span class=\"falsy\">falsy</span>{{/if}}</td>\n        <td class=\"parity\">{{#if (lookup this \"includeZero\")}}{{#if (eq (or (lookup this \"v\") (eq (lookup this \"v\") 0)) (lookup this \"hbTruthy\"))}}<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#16a34a\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-label=\"match\"><path d=\"M4 12.5l5 5L20 6.5\"/></svg>{{else}}<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#be123c\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-label=\"differ\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg>{{/if}}{{else}}{{#if (eq (not (not (lookup this \"v\"))) (lookup this \"hbTruthy\"))}}<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#16a34a\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-label=\"match\"><path d=\"M4 12.5l5 5L20 6.5\"/></svg>{{else}}<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#be123c\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-label=\"differ\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg>{{/if}}{{/if}}</td>\n      </tr>\n    {{/each}}\n    </tbody>\n  </table>\n</div>"
    , dataText:
        "{\n  \"vFalse\": false,\n  \"vTrue\": true,\n  \"vNull\": null,\n  \"sEmpty\": \"\",\n  \"sText\": \"hi\",\n  \"sZero\": \"0\",\n  \"sSpace\": \" \",\n  \"nZero\": 0,\n  \"nNum\": 42,\n  \"arrEmpty\": [],\n  \"arrFull\": [1, 2],\n  \"objEmpty\": {},\n  \"objFull\": { \"k\": 1 }\n}"
    }
  ]
