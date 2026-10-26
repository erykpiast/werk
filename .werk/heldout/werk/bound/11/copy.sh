#!/bin/sh
# Make a copy of this checkout (tracked files and .werk-heldout) at $1, with the locked
# packages installed, so no check writes into the checkout itself.
set -e
src=$(cd "$(dirname "$0")/.." && pwd)
dst=$1
rm -rf "$dst"
mkdir -p "$dst"
cd "$src"
git ls-files -z | xargs -0 -I{} sh -c 'mkdir -p "$1/$(dirname "$2")" && cp -Pp "$2" "$1/$2"' _ "$dst" {}
cp -R .werk-heldout "$dst/.werk-heldout"
cd "$dst"
git init --quiet && git add -A && git -c user.name=t -c user.email=t@t.invalid commit --quiet -m copy
if [ -n "$2" ]; then bun install --frozen-lockfile >/dev/null 2>&1 && touch node_modules/.werk-installed; fi
