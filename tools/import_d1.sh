#!/usr/bin/env bash
# Import ../data/d1/*.sql (from tools/export_d1.py) into D1 `hadits-corpus`, in order. Usage: tools/import_d1.sh [pattern]
# Each file is applied with `wrangler d1 execute --remote --file` (the D1 import API), retried on network errors.
# Statements are idempotent (INSERT OR REPLACE; FTS files are single statements). Done files are recorded so a rerun resumes.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${HADITS_WORKSPACE:-$(cd .. && pwd)}/data/d1"
DONE="$DIR/.imported"
touch "$DONE"
for f in "$DIR"/${1:-*}.sql; do
  name=$(basename "$f")
  grep -qx "$name" "$DONE" && { echo "skip $name"; continue; }
  echo "$(date +%T) import $name ($(du -h "$f" | cut -f1))"
  ok=0
  for attempt in 1 2 3 4; do
    if npx wrangler d1 execute hadits-corpus --remote --yes --file "$f" > "$DIR/$name.log" 2>&1; then ok=1; break; fi
    echo "  attempt $attempt failed: $(grep -m1 -E 'ERROR|✘' "$DIR/$name.log")"; sleep $((attempt * 10))
  done
  [ "$ok" = 1 ] || { tail -20 "$DIR/$name.log"; exit 1; }
  echo "$name" >> "$DONE"
done
echo "$(date +%T) all done"
