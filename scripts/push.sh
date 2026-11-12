#!/usr/bin/env bash
# Multi-path git push: SSH(443) -> HTTPS via local proxy -> HTTPS direct.
# Any path that succeeds stops the loop. Exit 0 = pushed, 1 = all failed.
#
# Usage: scripts/push.sh [remote] [refspec]   (default: origin main)
set -uo pipefail

REMOTE="${1:-origin}"
REF="${2:-main}"
HTTPS_URL="https://github.com/w13136199130/polyopus.git"
ROUNDS="${PUSH_ROUNDS:-3}"

push_ssh() {
  git -c "core.sshCommand=ssh -o ConnectTimeout=8" push "$REMOTE" "$REF" 2>&1
}

push_proxy() {
  git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 \
    push "$HTTPS_URL" "$REF" 2>&1
}

push_direct() {
  git -c http.proxy= -c https.proxy= push "$HTTPS_URL" "$REF" 2>&1
}

sync_tracking() { git fetch "$REMOTE" --quiet 2>/dev/null || true; }

for round in $(seq 1 "$ROUNDS"); do
  for path in ssh proxy direct; do
    echo "[push] round $round / $path"
    out=$(push_$path)
    code=$?
    echo "$out" | tail -3
    if [ $code -eq 0 ] || echo "$out" | grep -q "Everything up-to-date"; then
      echo "[push] OK via $path"
      sync_tracking
      exit 0
    fi
    sleep 2
  done
done

echo "[push] FAILED after $ROUNDS rounds on all paths"
exit 1
