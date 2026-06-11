// SPDX-License-Identifier: Apache-2.0
//
// Pure workspace-export utilities (Phase 0): the Markdown fence formatter and the
// dependency-free store-only zip builder. No app state, no DOM — the state-coupled
// glue (buildMarkdownDoc / buildFiles / downloadWorkspace) stays in index.html and
// calls these.

// A fenced block whose backtick run is longer than any in the content, so
// template/output text containing backticks can't break out of the fence.
export function mdFence(content, lang) {
  let max = 0;
  for (const m of String(content).matchAll(/`+/g)) max = Math.max(max, m[0].length);
  const f = "`".repeat(Math.max(3, max + 1));
  return `${f}${lang || ""}\n${content}\n${f}`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    let c = (crc ^ bytes[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A minimal store-only (uncompressed) zip — no build-step dependency. Files are
// small, so skipping deflate is fine. `files` is `[{ name, content }]`; returns a
// Uint8Array of the zip bytes.
export function makeZip(files) {
  const enc = new TextEncoder();
  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const header = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
      ...name,
    ];
    chunks.push(new Uint8Array(header), data);
    central.push({ crc, size: data.length, name, offset });
    offset += header.length + data.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    const cd = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(c.offset), ...c.name,
    ];
    chunks.push(new Uint8Array(cd));
    cdSize += cd.length;
  }
  chunks.push(new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(cdSize), ...u32(cdStart), ...u16(0),
  ]));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const zip = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { zip.set(c, p); p += c.length; }
  return zip;
}
