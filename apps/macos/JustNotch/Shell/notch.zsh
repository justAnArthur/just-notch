# Just Notch › Finish line: the notch shows a command that runs long, and flashes when it ends.
# Add this line to ~/.zshrc:
#   source "/Applications/JustNotch.app/Contents/Resources/notch.zsh"
#
#   NOTCH_TASK_AFTER   seconds before a command counts as long (default 10)
#   NOTCH_TASK_IGNORE  commands that are never reported (editors, pagers, shells you sit in)
#   notch run <cmd>    reports <cmd> whatever its length; `notch done [text]` flashes now.

zmodload zsh/datetime 2>/dev/null || return
autoload -Uz add-zsh-hook

: ${NOTCH_TASK_AFTER:=10}
: ${NOTCH_TASK_IGNORE:="vim nvim vi nano emacs micro hx less more man ssh mosh top htop btop watch tail claude codex tmux screen zsh bash fish python python3 node bun irb psql mysql redis-cli sqlite3"}
typeset -g _notch_id="" _notch_cmd="" _notch_start=0 _notch_timer=0 _notch_forced=0

_notch_encode() { print -rn -- "$1" | /usr/bin/xxd -p | tr -d '\n' | sed 's/../%&/g'; }

# _notch_open <start|end> key=value…: a justnotch:// link, opened in the background.
_notch_open() {
  local url="justnotch://task/$1" sep="?" pair
  shift
  for pair in "$@"; do url+="$sep${pair%%=*}=$(_notch_encode "${pair#*=}")"; sep="&"; done
  /usr/bin/open -g "$url" >/dev/null 2>&1
}

_notch_preexec() {
  [[ -n $1 ]] || return
  local first=${${(z)1}[1]}
  # `notch run` reports its own command.
  (( ! _notch_forced )) && [[ $first == notch || " $NOTCH_TASK_IGNORE " == *" ${first:t} "* ]] && return
  _notch_id="$$-$RANDOM$RANDOM" _notch_cmd="${1[1,120]}" _notch_start=$EPOCHREALTIME
  local id=$_notch_id title=$_notch_cmd app=${__CFBundleIdentifier:-}
  local after=$(( _notch_forced ? 0 : NOTCH_TASK_AFTER ))
  # Shows the task only once it has run long; a short command kills this before it does.
  { sleep $after && _notch_open start id=$id title=$title app=$app } &!
  _notch_timer=$!
}

_notch_precmd() {
  local code=$?
  [[ -z $_notch_id ]] && return
  kill $_notch_timer 2>/dev/null
  local seconds=$(( EPOCHREALTIME - _notch_start ))
  if (( _notch_forced || seconds >= NOTCH_TASK_AFTER )); then
    _notch_open end id=$_notch_id title=$_notch_cmd status=$code seconds=${seconds%.*} app=${__CFBundleIdentifier:-}
  fi
  _notch_id="" _notch_forced=0
}

notch() {
  case $1 in
    run) shift; _notch_forced=1; _notch_preexec "$*"; "$@"; local code=$?; (exit $code); _notch_precmd; _notch_forced=0; return $code ;;
    done) shift; _notch_open end id="$$-$RANDOM" title="${*:-Done}" status=0 seconds=0 ;;
    *) print -u2 "usage: notch run <command…> | notch done [text]"; return 2 ;;
  esac
}

# Only a shell you type in reports commands; scripts that source this get `notch` alone.
if [[ -o interactive ]]; then
  add-zsh-hook preexec _notch_preexec
  add-zsh-hook precmd _notch_precmd
fi
