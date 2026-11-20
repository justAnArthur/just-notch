#!/bin/zsh
# The Debug app's memory, per process, while a script drives its island and launcher:
#   bun run --cwd packages/runtime preview   (or any server on $URL, built runtime and plugins)
#   packages/runtime/scripts/memory-app.sh <path to Debug JustNotch.app> [cycles]
# Launches the app against the preview, samples `footprint` (now and peak) for it and its WebKit helpers fresh,
# after every tab once, after <cycles> rounds of tabs + launcher, and after a minute idle; then quits it.
# Debug builds only: it drives the page through DebugProbe's command folder. Quit any other Debug JustNotch first.
set -e
APP=${1:?path to the Debug JustNotch.app}
CYCLES=${2:-20}
URL=${URL:-http://localhost:5175}
PROBE="$HOME/Library/Application Support/JustNotch/Debug"

probe() {
  python3 -c 'import json,sys; print(json.dumps({"js": sys.argv[1]}))' "$1" > "$PROBE/memory.cmd.json"
  for i in {1..240}; do [[ -f "$PROBE/memory.result.json" && ! -f "$PROBE/memory.cmd.json" ]] && break; sleep 0.25; done
  rm -f "$PROBE/memory.result.json"
}

sample() {
  local line="$1:" total=0
  for p in $PIDS; do
    local name=$(ps -o comm= -p $p | xargs basename | sed 's/com.apple.WebKit.//')
    local out=$(footprint -p $p 2>/dev/null)
    local mb=$(sed -n 's/.*Footprint: \([0-9.]*\) \([KM]\)B.*/\1 \2/p' <<< $out | head -1)
    [[ $mb == *K ]] && mb=$(( ${mb% K} / 1024 )) || mb=${mb% M}
    mb=$(printf %.0f ${mb:-0})
    local peak=$(sed -n 's/.*phys_footprint_peak: \(.*\)/\1/p' <<< $out | head -1)
    total=$(( total + ${mb:-0} )); line="$line $name=${mb:-?} (peak $peak)"
  done
  echo "$line, total $total MB"
}

open -n --env NOTCH_DEV_URL=$URL "$APP"
sleep 20
APP_PID=$(pgrep -f "$APP/Contents/MacOS/JustNotch")
START=$(date -j -f "%a %b %d %T %Y" "$(ps -o lstart= -p $APP_PID | xargs)" +%s)
PIDS=($APP_PID)
for w in $(pgrep -f com.apple.WebKit); do
  t=$(date -j -f "%a %b %d %T %Y" "$(ps -o lstart= -p $w | xargs)" +%s)
  (( t >= START && t <= START + 5 )) && PIDS+=$w
done

TABS='const d=(e)=>window.__notch.dispatch(e); const w=(ms)=>new Promise(r=>setTimeout(r,ms)); d([{type:"hover",payload:{inside:true}}]); await w(600); for (const t of document.querySelectorAll("#island [role=tab]")){t.click(); await w(400)} d([{type:"hover",payload:{inside:false}}]); await w(800); return 1'
LAUNCHER='const d=(e)=>window.__notch.dispatch(e); const w=(ms)=>new Promise(r=>setTimeout(r,ms)); d([{type:"launcher",payload:{open:true,top:220}}]); await w(700); const i=document.querySelector("input[aria-label=Search]"); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; for (const q of ["s","sa","te","a"]){ set.call(i,q); i.dispatchEvent(new Event("input",{bubbles:true})); await w(250)} for (const k of [1,2]) i.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); await w(700); return 1'

sample "fresh, 20 s"
probe "$TABS"; sleep 1
sample "every tab once"
for i in $(seq $CYCLES); do probe "$TABS"; probe "$LAUNCHER"; done
sample "after $CYCLES rounds of tabs + launcher"
sleep 60
sample "idle 1 min"
kill $APP_PID
