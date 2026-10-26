#!/bin/sh
# Makes a scratch clone of this checkout at HEAD, installs the locked dependencies there,
# and copies .werk-heldout into it. The tests run in the clone, so the checkout stays unchanged.
# Usage: .werk-heldout/sync.sh <clone-dir>
set -e
SRC=$(cd "$(dirname "$0")/.." && pwd)
DEST=$1
if [ ! -d "$DEST/.git" ]; then
  git clone --quiet --no-local "$SRC" "$DEST"
  git -C "$DEST" checkout --quiet "$(git -C "$SRC" rev-parse HEAD)"
  (cd "$DEST" && bun install --frozen-lockfile >/dev/null)
fi
rm -rf "$DEST/.werk-heldout"
cp -R "$SRC/.werk-heldout" "$DEST/.werk-heldout"
echo "$DEST"
