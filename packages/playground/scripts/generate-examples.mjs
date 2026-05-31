import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(scriptDir, "..");
const repoRoot = join(packageRoot, "..", "..");
const examplesRoot = join(repoRoot, "examples");
const outFile = join(packageRoot, "src", "Playground", "Examples.purs");

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

const encode = (value) => JSON.stringify(value);
const renderField = (name, value) =>
  value.includes("\n") || value.length > 80
    ? `    , ${name}:\n        ${encode(value)}`
    : `    , ${name}: ${encode(value)}`;

const entries = (await readdir(examplesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

if (!entries.length) {
  throw new Error(`generate-examples: no example folders found under ${examplesRoot}`);
}

const examples = [];
for (const id of entries) {
  const dir = join(examplesRoot, id);
  const metaPath = join(dir, "meta.json");
  const templatePath = join(dir, "template.hbs");
  const dataPath = join(dir, "data.json");

  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  if (typeof meta.label !== "string" || !meta.label.trim()) {
    throw new Error(`generate-examples: ${metaPath} must define a non-empty label`);
  }
  if (typeof meta.order !== "number" || !Number.isFinite(meta.order)) {
    throw new Error(`generate-examples: ${metaPath} must define a numeric order`);
  }

  const template = (await readFile(templatePath, "utf8")).trimEnd();
  const dataText = (await readFile(dataPath, "utf8")).trimEnd();
  JSON.parse(dataText);

  examples.push({ id, label: meta.label, order: meta.order, template, dataText });
}

examples.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

const generated = `-- | Generated from examples/** by scripts/generate-examples.mjs.
-- | Do not edit by hand.
module Playground.Examples where

type Example = { id :: String, label :: String, template :: String, dataText :: String }

examples :: Array Example
examples =
${examples
  .map(
    (example, index) =>
      `${index === 0 ? "  [" : "  ,"} { id: ${encode(example.id)}
    , label: ${encode(example.label)}
${renderField("template", example.template)}
${renderField("dataText", example.dataText)}
    }`
  )
  .join("\n")}
  ]
`;

await mkdir(dirname(outFile), { recursive: true });

if (checkOnly) {
  const current = await readFile(outFile, "utf8");
  if (current !== generated) {
    console.error("generate-examples: src/Playground/Examples.purs is out of date");
    process.exitCode = 1;
  }
} else {
  await writeFile(outFile, generated);
  console.log(`generate-examples: wrote ${outFile}`);
}