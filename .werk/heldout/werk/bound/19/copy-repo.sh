#!/bin/sh
# Make a copy of the checkout at HEAD in a new temp folder and print its path.
set -e
dest=$(mktemp -d /tmp/werk-heldout-copy-XXXXXX)
git -C "$(dirname "$0")/.." archive HEAD | tar -x -C "$dest"
echo "$dest"
