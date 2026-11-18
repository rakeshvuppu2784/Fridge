#!/bin/sh
# Kindle desk panel: wake every 30 min (06:00-24:00 IST), download the dashboard PNG, show it, suspend to RAM.
# Runs on a jailbroken Kindle (tested target: Kindle 8th gen, firmware 5.16.2.1.1). Started from KUAL.
# To leave panel mode: hold the power button ~40 s until the Kindle restarts (the panel does not auto-start).
# Settings (the image URL) live in local.sh next to this file, which is NOT in the public repo.

DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/panel.log"
IMG="$DIR/dash.png"
TMP="$DIR/dash.tmp"
. "$DIR/local.sh"                         # sets PANEL_URL
INTERVAL=${INTERVAL:-1800}                # seconds between refreshes
OFFSET=${OFFSET:-300}                     # refresh 5 min after each half hour (the image is rendered just before)
TZ_OFF=19800                              # IST = UTC+5:30, no daylight saving
DAY_FROM=${DAY_FROM:-6}                   # no refreshes 00:00-06:00
FULL_EVERY=${FULL_EVERY:-4}               # full (flashing) refresh every Nth update, to clear e-ink ghosting
DEBUG=${DEBUG:-0}

log() { echo "$(date -u '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }
trim_log() { [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 200000 ] && tail -n 400 "$LOG" > "$LOG.1" && mv "$LOG.1" "$LOG"; }

init() {
  log "panel start (pid $$)"
  stop framework >/dev/null 2>&1 || /etc/init.d/framework stop >/dev/null 2>&1   # stop the reader UI so it doesn't draw over us
  initctl stop webreader >/dev/null 2>&1
  lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1
  echo powersave > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null
  n=0; fails=0
}

battery() { b=$(gasgauge-info -c 2>/dev/null | tr -dc '0-9'); [ -z "$b" ] && b=$(lipc-get-prop com.lab126.powerd battLevel 2>/dev/null | tr -dc '0-9'); echo "${b:-100}"; }

wifi_up() {
  lipc-set-prop com.lab126.cmd wirelessEnable 1 >/dev/null 2>&1
  i=0
  while [ $i -lt 45 ]; do
    [ "$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)" = "CONNECTED" ] && ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

fetch() {
  u="$PANEL_URL?t=$(date +%s)"
  rm -f "$TMP"
  curl -fsS -m 45 -o "$TMP" "$u" >>"$LOG" 2>&1 || wget -q -T 45 -O "$TMP" "$u" >>"$LOG" 2>&1
  # accept only a real PNG of plausible size
  [ -s "$TMP" ] && [ "$(wc -c < "$TMP")" -gt 2000 ] && [ "$(head -c 4 "$TMP" | tail -c 3)" = "PNG" ]
}

show() {
  if [ $((n % FULL_EVERY)) -eq 0 ]; then eips -f -g "$IMG" >/dev/null 2>&1; else eips -g "$IMG" >/dev/null 2>&1; fi
  n=$((n + 1))
  b=$(battery)
  [ "$b" -le 15 ] && eips 1 38 " Battery ${b}% - please charge " >/dev/null 2>&1
  [ "$fails" -ge 3 ] && eips 1 37 " Offline: last update failed ${fails}x " >/dev/null 2>&1
}

refresh() {
  if wifi_up && fetch; then
    mv "$TMP" "$IMG"; fails=0; log "updated, battery $(battery)%"
    show
  else
    fails=$((fails + 1)); log "update failed ($fails in a row)"
    [ "$fails" -ge 3 ] && [ -f "$IMG" ] && show
  fi
}

# seconds until the next slot: every INTERVAL (+OFFSET) in IST; overnight, wait until DAY_FROM:05
next_wait() {
  now=$(date +%s); loc=$((now + TZ_OFF)); sod=$((loc % 86400))
  nxt=$(( (sod - OFFSET) / INTERVAL * INTERVAL + INTERVAL + OFFSET ))
  if [ $nxt -ge 86400 ] || [ $((nxt / 3600)) -lt $DAY_FROM ]; then
    tgt=$((DAY_FROM * 3600 + OFFSET)); [ $tgt -le $sod ] && tgt=$((tgt + 86400))
    echo $((tgt - sod))
  else
    echo $((nxt - sod))
  fi
}

# suspend to RAM with an RTC alarm; if suspend isn't possible, fall back to an ordinary sleep
rtc_sleep() {
  secs=$1; t0=$(date +%s)
  if [ "$DEBUG" != 1 ]; then
    lipc-set-prop com.lab126.cmd wirelessEnable 0 >/dev/null 2>&1
    armed=0
    for r in /sys/class/rtc/rtc*; do
      [ -w "$r/wakealarm" ] || continue
      echo 0 > "$r/wakealarm" 2>/dev/null
      echo "+$secs" > "$r/wakealarm" 2>/dev/null || echo $(( $(cat "$r/since_epoch") + secs )) > "$r/wakealarm" 2>/dev/null
      [ -n "$(cat "$r/wakealarm" 2>/dev/null)" ] && armed=1
    done
    [ $armed = 1 ] && echo mem > /sys/power/state 2>/dev/null
  fi
  left=$(( secs - ($(date +%s) - t0) ))
  [ $left -gt 5 ] && sleep $left       # suspend failed or woke early: wait out the rest awake
}

init
while true; do
  trim_log
  refresh
  w=$(next_wait)
  log "sleep ${w}s"
  sleep 10                             # short window to kill the script over USB/SSH if needed
  rtc_sleep "$w"
done
