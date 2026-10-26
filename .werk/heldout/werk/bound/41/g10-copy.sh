#!/bin/sh
# usage: g10-copy.sh SRC DEST  (tracked + untracked files, no .git/node_modules/dist; own frozen install)
set -e
SRC=$1; DEST=$2
mkdir -p "$DEST"
cd "$SRC"
git ls-files -z -co --exclude-standard | grep -zv '^\.werk-heldout/' | grep -zv '^dist/' | grep -zv '^test-results/' | rsync -a --from0 --files-from=- . "$DEST/"
cd "$DEST"
bun install --frozen-lockfile > /dev/null 2>&1
touch node_modules/.werk-installed
