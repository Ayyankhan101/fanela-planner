#!/usr/bin/env bash
# Uptime probe (runbook §6) — launchd com.fanela.uptime every 5 min (StartInterval 300).
# Alert goes to the launchd stderr log (logs/uptime.err.log); MVP has no
# mailer/push — grep it, or wire a sink when one exists (runbook §6).
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000/login || echo 000)
if [ "$CODE" != "200" ]; then
  echo "$(date '+%F %T') fanela down: HTTP $CODE" >&2
  exit 1
fi
