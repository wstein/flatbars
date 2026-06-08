// Extract every conformance-corpus template into a NUL-separated fixture the Rust
// lexer test round-trips against (the docs/08 §6 step-1 gate). Regenerate after
// editing the corpus:  node tests/extract-corpus.mjs
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { cases } = await import(resolve(here, "../../../conformance/cases.mjs"));
const templates = cases.map((c) => c.template);
writeFileSync(resolve(here, "fixtures/corpus-templates.txt"), templates.join("\0"));
console.log(`wrote ${templates.length} corpus templates`);
