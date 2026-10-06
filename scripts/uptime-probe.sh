#!/usr/bin/env bash
# Uptime probe (runbook §6) — launchd com.fanela.uptime every 5 min (StartInterval 300).
# Success writes a line to stdout (logs/uptime.out.log) so the ≥5 wd
# monitoring-proof clock has visible evidence; failure goes to stderr
# (logs/uptime.err.log). MVP has no mailer/push — grep either log, or wire
# a sink when it exists (runbook §6).
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000/login || echo 000)
if [ "$CODE" != "200" ]; then
  echo "$(date '+%F %T') fanela down: HTTP $CODE" >&2
  exit 1
fi
echo "$(date '+%F %T') fanela up: HTTP $CODE"
