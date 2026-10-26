#!/bin/sh
# Rebuild every data file in git under web/public/ from the raw downloads, then fail if one differs from git.
# DATA.md ("Raw downloads" and "Dependencies") lists each input and the order.
# Usage: sh scripts/data.sh   (DATA=<dir> to read the raw downloads from another checkout, for example in a worktree)
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
D=$(cd "${DATA:-$root/data}" && pwd)
P=$root/web/public
cd "$root"
# git status, not git diff: it also shows a staged change and a new file that git does not track yet.
changes() { git status --porcelain -- web/public; }
# The scripts write over web/public/, so a change that git does not have yet would be lost.
if [ -n "$(changes)" ]; then
  changes
  echo "web/public/ has changes that are not in git. Commit or stash them, then run this script again." >&2
  exit 2
fi

python3 scripts/atlas.py "$D/atlas/towns-10t.json" "$D/atlas/villages-10t.json" "$P"
python3 scripts/telecom.py "$D/signal/segis_112Y11M_town.zip" "$P/signal.json"
python3 scripts/transit.py "$D/osm/rail.json" "$D/osm/stations.json" "$D/osm/airport.json" "$P/transit.json"
python3 scripts/graphs.py "$D/bus/tpe_GetBusShape.gz" "$D/ntpc-transit/ntpc_GetBusShape.gz" "$D/osm/rail.json" "$D/dt/exits.csv" "$D/osm-hw/highways.json" "$P"
python3 scripts/names.py "$D/osm/streets.json" "$P"
python3 scripts/days.py "$D/calendar/office-115.csv" "$D/calendar/office-116.csv" "$D/calendar/cwa-A-A0087-001.csv" "$D/calendar/cwa-A-A0087-003.csv" "$P/calendar.json"
python3 scripts/villages.py "$D/atlas/villages-10t.json" "$D/pop/vage.csv" "$D/ris/ODRP014.json" "$D/dt/exits.csv" "$D/dt/od-202609.csv" "$D/jobs/neihu-companies.csv" "$P/villages2.json"
# These need towns.json, villages2-topo.json or villages2.json from the steps above.
python3 scripts/od.py "$D/dt/od-202609.csv" "$D/dt/exits.csv" "$P/towns.json" "$D/calendar/office-115.csv" "$P/od2.json"
python3 scripts/people.py "$D/people/top20-11206.csv" "$D/people/ranking-112.csv" "$P/villages2.json" "$P/people.json"
python3 scripts/night.py "$D/night/BGMOPEN1.csv" "$P/villages2-topo.json" "$P/villages2.json" "$P/night.json"

if [ -n "$(changes)" ]; then
  changes
  git diff --stat HEAD -- web/public
  exit 1
fi
