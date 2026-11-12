#!/bin/zsh
# usage: probe.sh <name> '<js async body>' [snapshot]  — runs JS in the live island (Debug build), prints the result.
# With a 3rd arg, also saves a snapshot to /private/tmp/claude-501/just-notch-shots/real-<name>.png
D=~/Library/Application\ Support/JustNotch/Debug
N=$1
rm -f "$D/$N.result.json"
python3 -c 'import json,sys; print(json.dumps({"js": sys.argv[1], "snapshot": len(sys.argv)>2}))' "$2" ${3:+x} > "$D/$N.cmd.json.tmp" && mv "$D/$N.cmd.json.tmp" "$D/$N.cmd.json"
for i in {1..120}; do [[ -f "$D/$N.result.json" ]] && break; sleep 0.25; done
[[ -f "$D/$N.result.json" ]] || { echo "probe timed out (30s)"; exit 1; }
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("result") or d.get("error"))' "$D/$N.result.json"
if [[ -n "$3" ]]; then mkdir -p /private/tmp/claude-501/just-notch-shots; cp -f "$D/$N.png" "/private/tmp/claude-501/just-notch-shots/real-$N.png" && echo "/private/tmp/claude-501/just-notch-shots/real-$N.png"; fi
