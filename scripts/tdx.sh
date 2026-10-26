#!/bin/bash
# Download TDX historical road traffic: one gzipped ndjson file per endpoint and day. TDX is paid by volume (a day of
# 台北市 sections is about 0.5 GB), so the files stay outside the repository; DATA.md (source P) gives what we used.
# Usage: TDX_CLIENT_ID=... TDX_CLIENT_SECRET=... sh scripts/tdx.sh OUT_DIR DATE...   (DATE: yyyy-MM-dd)
set -u
OUT=$1; shift; mkdir -p "$OUT"
token() {
  curl -sS -X POST https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token \
    -H 'content-type: application/x-www-form-urlencoded' --data-urlencode grant_type=client_credentials \
    --data-urlencode "client_id=$TDX_CLIENT_ID" --data-urlencode "client_secret=$TDX_CLIENT_SECRET" | jq -r .access_token
}
T=$(token)
get() { # name, path under Historical/Road/Traffic, date
  f=$OUT/$1-$3.ndjson.gz
  [ -s "$f" ] && return
  for try in 1 2 3; do
    code=$(curl -sS --compressed -H "authorization: Bearer $T" -o >(gzip > "$f.part") -w '%{http_code}' \
      "https://tdx.transportdata.tw/api/historical/v2/Historical/Road/Traffic/$2?Dates=$3&\$format=JSON")
    sleep 2
    # A member key may make 5 calls a minute.
    if [ "$code" = 200 ]; then mv "$f.part" "$f"; echo "ok $f"; sleep 13; return; fi
    echo "$code on $1 $3, try $try" >&2; rm -f "$f.part"; sleep 30; T=$(token)
  done
}
for d in "$@"; do
  get section-taipei Section/City/Taipei "$d"; get shape-taipei SectionShape/City/Taipei "$d"
  get section-freeway Section/Freeway "$d"; get shape-freeway SectionShape/Freeway "$d"
  get live-taipei Live/City/Taipei "$d"; get live-freeway Live/Freeway "$d"
done
