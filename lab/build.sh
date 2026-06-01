#!/usr/bin/env sh
# SPDX-License-Identifier: Apache-2.0
#
# OPTIONAL: build the Stem engine's WebAssembly for the Lab.
#
# You do NOT need this to use the Lab. The Lab defaults to the FullBars engine
# (pure JS, no wasm); RawBars/MinBars/FullBars/MaxBars all work out of the box —
# just serve this folder (see lab/README or the repo README). This script only
# enables the *optional* Stem engine (?engine=stem).
#
# `stem_native` is a SEPARATE Rust crate (the Stem engine), not part of this
# template-engine repo. Point STEM_NATIVE_DIR at its crate directory:
#
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version 0.2.122   # match the wasm-bindgen crate
#   STEM_NATIVE_DIR=/path/to/stem_native ./build.sh
#
set -eu

here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

# Default to a `native/` cargo workspace beside the repo root; override for any
# other checkout. The crate dir is the one containing Cargo.toml.
crate="${STEM_NATIVE_DIR:-$here/../native/stem_native}"
if [ ! -f "$crate/Cargo.toml" ]; then
  echo "build.sh: stem_native crate not found at $crate/Cargo.toml" >&2
  echo "  Stem is OPTIONAL — the Lab works without it (default engine: FullBars)." >&2
  echo "  To build the Stem engine, set STEM_NATIVE_DIR=/path/to/stem_native and re-run." >&2
  exit 1
fi

cargo build --release --target wasm32-unknown-unknown --lib --manifest-path "$crate/Cargo.toml"

# stem_native builds into its cargo workspace target dir; wasm-bindgen emits the
# JS bindings + .wasm into lab/wasm/ (served by the Lab).
target="${STEM_NATIVE_TARGET:-$(dirname "$crate")/target}"
wasm-bindgen --target web --no-typescript \
  --out-dir "$here/wasm" \
  "$target/wasm32-unknown-unknown/release/stem_native.wasm"

echo "wrote $here/wasm/{stem_native.js, stem_native_bg.wasm}"
