// SPDX-License-Identifier: Apache-2.0
//
// Tests for the pure export utilities (Phase 0). Run: node lab/app/export-utils.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import { mdFence, makeZip } from "./export-utils.mjs";

test("mdFence wraps content; the fence outgrows any backtick run inside", () => {
  assert.equal(mdFence("hi", "yaml"), "```yaml\nhi\n```");
  // content with a 3-backtick run → the fence must be 4 backticks
  assert.equal(mdFence("a ``` b", ""), "````\na ``` b\n````");
  // a 4-run inside → 5-backtick fence
  assert.ok(mdFence("````", "txt").startsWith("`````txt\n"));
});

test("makeZip produces a valid store-only zip structure", () => {
  const zip = makeZip([{ name: "a.txt", content: "hello" }, { name: "dir/b.txt", content: "" }]);
  assert.ok(zip instanceof Uint8Array);
  // local file header signature PK\x03\x04 at offset 0
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  // end-of-central-directory signature PK\x05\x06 present
  const eocd = 0x06054b50;
  const sig = [eocd & 0xff, (eocd >>> 8) & 0xff, (eocd >>> 16) & 0xff, (eocd >>> 24) & 0xff];
  let found = -1;
  for (let i = zip.length - 4; i >= 0; i--) {
    if (zip[i] === sig[0] && zip[i + 1] === sig[1] && zip[i + 2] === sig[2] && zip[i + 3] === sig[3]) { found = i; break; }
  }
  assert.ok(found >= 0, "EOCD record present");
  // the EOCD records 2 central-directory entries (one per file)
  assert.equal(zip[found + 10] | (zip[found + 11] << 8), 2);
  // the file content "hello" is stored verbatim (store-only, no compression)
  assert.ok(Buffer.from(zip).includes(Buffer.from("hello")));
  assert.ok(Buffer.from(zip).includes(Buffer.from("a.txt")));
});

test("makeZip CRC differs for different content (real CRC, not a stub)", () => {
  const z1 = makeZip([{ name: "f", content: "aaa" }]);
  const z2 = makeZip([{ name: "f", content: "bbb" }]);
  // the 4-byte CRC sits at offset 14 in the local header
  assert.notDeepEqual([...z1.slice(14, 18)], [...z2.slice(14, 18)]);
});
