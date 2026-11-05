#!/bin/sh
# Download the policy platforms of the candidates for mayor into data/platforms/, which git ignores.
# The pages of puma.taipei/policies are CC BY 4.0 (the footer of each page), so docs/platforms/ quotes them.
# policies.json behind puma.taipei/heart-island states no license, so it stays out of git. So does transport.pdf, the
# slides that the page 交通政策 links to: it states no license, and its photos are Google Earth images.
# docs/platforms/SHA256SUMS records the version that docs/platforms/ was written from: compare with it.
# Usage: sh scripts/platforms.sh   (DATA=<dir> to write into another checkout, for example from a worktree)
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
D=${DATA:-$root/data}/platforms/shen
mkdir -p "$D/pages"
curl --fail --silent --show-error --location --output "$D/policies.json" https://puma.taipei/heart-island-assets/policies.json
# One page per source of policies.json; the file name is the id of the source. A file, not a pipe, so that set -e
# stops the script when python fails.
python3 -I -c '
import json, sys, urllib.parse
for s in json.load(open(sys.argv[1]))["sources"]:
    u = s.get("url") or ""
    if u.startswith("https://puma.taipei/policies/"):
        print(s["id"], urllib.parse.quote(u, safe=":/"))
' "$D/policies.json" > "$D/pages.txt"
while read -r id url; do
  curl --fail --silent --show-error --location --output "$D/pages/$id.html" "$url"
done < "$D/pages.txt"
curl --fail --silent --show-error --location --output "$D/transport.pdf" https://media.puma.taipei/files/141/01M2KZHJ2GFQPFYZ5XXPGNS7XG.pdf
cd "$D" && sha256sum policies.json pages/*.html transport.pdf
