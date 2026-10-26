#!/bin/bash
# Shared helpers: make a temporary clone of this checkout on its main branch.
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
clone() {
  local d; d="$(mktemp -d "${TMPDIR:-/tmp}/werk-heldout-infra-XXXXXX")"
  git clone --quiet --branch main "$SRC" "$d/werk" >&2
  echo "$d/werk"
}
check() { if eval "$2"; then echo "OK   $1"; else echo "FAIL $1"; FAILED=1; fi; }
FAILED=0
