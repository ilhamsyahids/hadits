#!/usr/bin/env bash
# Downloads hadith editions (Arabic, English, Indonesian) from fawazahmed0/hadith-api (Unlicense) via jsDelivr.
set -euo pipefail
OUT="${1:-$(dirname "$0")/../../data/fawaz}"
mkdir -p "$OUT"
BASE="https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1"
curl -sfL "$BASE/editions.min.json" -o "$OUT/editions.json"
curl -sfL "$BASE/info.min.json" -o "$OUT/info.json"
for book in bukhari muslim abudawud tirmidhi nasai ibnmajah malik nawawi qudsi dehlawi; do
  for lang in ara eng ind; do
    ed="$lang-$book"
    if curl -sfL "$BASE/editions/$ed.min.json" -o "$OUT/$ed.json"; then
      echo "ok   $ed $(wc -c < "$OUT/$ed.json") bytes"
    else
      rm -f "$OUT/$ed.json"; echo "skip $ed (not published)"
    fi
  done
done
