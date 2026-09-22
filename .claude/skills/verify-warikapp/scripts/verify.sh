#!/usr/bin/env bash
# warikapp verification harness. Every subcommand is safe to re-run.
#   verify.sh launch            start Next dev (port $VERIFY_PORT, default 3100) after a one-shot Convex push
#   verify.sh doctor            read-only: is THIS run's instance worth driving?
#   verify.sh login             sign the synthetic verification user in (creates its household on first run)
#   verify.sh pw <args...>      playwright-cli against the "verify" browser session
#   verify.sh evidence <name>   create and print a fresh evidence dir (.verify-evidence/<stamp>-<name>)
#   verify.sh cleanup           close the browser session and stop the server this run started; evidence is kept
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
PORT="${VERIFY_PORT:-3100}"
ORIGIN="http://localhost:$PORT"
RUN_DIR=".verify-run"
SESSION="verify"
resolve_pw() {
  if [ -n "${PLAYWRIGHT_CLI:-}" ]; then echo "$PLAYWRIGHT_CLI"; return; fi
  if playwright-cli --version >/dev/null 2>&1; then echo "playwright-cli"; return; fi
  local m; m=$(ls -d "$HOME"/.local/share/mise/installs/node/22*/bin/playwright-cli 2>/dev/null | head -1)
  if [ -n "$m" ]; then echo "$m"; return; fi
  echo "playwright-cli not found (the mise shim needs node 22; set PLAYWRIGHT_CLI=/path/to/playwright-cli)" >&2; exit 2
}
PW=$(resolve_pw)
pw() { "$PW" -s="$SESSION" "$@"; }
# next dev listens from a grandchild (npx -> next -> server), so ownership and teardown walk the pid tree.
is_descendant() { local c=$1 a=$2; while [ -n "$c" ] && [ "$c" != "1" ] && [ "$c" != "0" ]; do [ "$c" = "$a" ] && return 0; c=$(ps -o ppid= -p "$c" 2>/dev/null | tr -d ' '); done; return 1; }
descendants() { local k; for k in $(pgrep -P "$1" 2>/dev/null); do descendants "$k"; echo "$k"; done; }

case "${1:-}" in
  launch)
    mkdir -p "$RUN_DIR"
    if [ -f "$RUN_DIR/next.pid" ] && kill -0 "$(cat "$RUN_DIR/next.pid")" 2>/dev/null; then
      echo "already running (pid $(cat "$RUN_DIR/next.pid")) at $ORIGIN"; exit 0
    fi
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "port $PORT is owned by a process this run did not start; pick another with VERIFY_PORT=" >&2; exit 3
    fi
    npx convex dev --once > "$RUN_DIR/convex-push.log" 2>&1 || { tail -20 "$RUN_DIR/convex-push.log" >&2; exit 4; }
    nohup npx next dev -p "$PORT" > "$RUN_DIR/next-dev.log" 2>&1 &
    echo $! > "$RUN_DIR/next.pid"
    for _ in $(seq 1 60); do
      if [ "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/login")" = "200" ]; then echo "ready: $ORIGIN (pid $(cat "$RUN_DIR/next.pid"))"; exit 0; fi
      sleep 1
    done
    tail -20 "$RUN_DIR/next-dev.log" >&2; echo "server did not answer on $ORIGIN/login within 60s" >&2; exit 5 ;;
  doctor)
    ok=0
    pid=$(cat "$RUN_DIR/next.pid" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "PASS next dev pid $pid alive"; else echo "FAIL no live next dev started by this run (run: verify.sh launch)"; ok=1; fi
    owner=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
    if [ -n "$owner" ] && [ -n "$pid" ] && is_descendant "$owner" "$pid"; then echo "PASS port $PORT owned by our pid tree"; else echo "FAIL port $PORT owner is '$owner', not our pid $pid"; ok=1; fi
    code=$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/login"); [ "$code" = "200" ] && echo "PASS $ORIGIN/login -> 200" || { echo "FAIL $ORIGIN/login -> $code"; ok=1; }
    code=$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/settlement"); [ "$code" = "307" ] || [ "$code" = "302" ] && echo "PASS unauthenticated /settlement redirects ($code)" || { echo "FAIL /settlement without auth -> $code (expected redirect)"; ok=1; }
    response=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$ORIGIN/manifest.webmanifest"); code=${response%% *}; content_type=${response#* }; [ "$code" = "200" ] && [[ "$content_type" == *manifest* ]] && echo "PASS unauthenticated /manifest.webmanifest -> 200 ($content_type)" || { echo "FAIL /manifest.webmanifest -> $response (expected 200 with manifest content-type)"; ok=1; }
    icon_response=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$ORIGIN/icon.png"); apple_icon_response=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$ORIGIN/apple-icon.png"); [ "${icon_response%% *}" = "200" ] && [ "${icon_response#* }" = "image/png" ] && [ "${apple_icon_response%% *}" = "200" ] && [ "${apple_icon_response#* }" = "image/png" ] && echo "PASS unauthenticated /icon.png and /apple-icon.png -> 200 image/png" || { echo "FAIL app icons -> /icon.png $icon_response; /apple-icon.png $apple_icon_response (expected 200 image/png)"; ok=1; }
    grep -q '^CLERK_SECRET_KEY=sk_test_' .env.local && echo "PASS Clerk key is a dev (sk_test) key" || { echo "FAIL CLERK_SECRET_KEY is not a dev key; never verify against production"; ok=1; }
    grep -q '^CONVEX_DEPLOYMENT=dev:' .env.local && echo "PASS Convex deployment is dev:" || { echo "FAIL CONVEX_DEPLOYMENT is not a dev deployment"; ok=1; }
    echo "INFO playwright-cli: $PW ($("$PW" --version 2>/dev/null || echo unknown))"
    if pw --raw eval "location.origin" 2>/dev/null | grep -q "$ORIGIN"; then echo "PASS browser session '$SESSION' is on $ORIGIN"; else echo "INFO browser session '$SESSION' not open yet (verify.sh login opens it)"; fi
    exit $ok ;;
  login)
    url=$(node .claude/skills/verify-warikapp/scripts/clerk-login-url.mjs "$ORIGIN")
    pw --raw eval "1" >/dev/null 2>&1 || pw open "$ORIGIN/login" >/dev/null
    pw goto "$url" >/dev/null
    for _ in $(seq 1 20); do
      p=$(pw --raw eval "location.pathname" | tr -d '"')
      [ "$p" != "/login" ] && break; sleep 1
    done
    if [ "$p" = "/login" ]; then echo "login failed; still on /login" >&2; pw --raw snapshot | head -30 >&2; exit 6; fi
    if [ "$p" = "/setup" ]; then
      pw fill "getByRole('textbox', { name: 'あなたの表示名' })" "検証エージェント" >/dev/null
      pw click "getByRole('button', { name: '世帯を作成する' })" >/dev/null
      sleep 3
      pw click "getByRole('link', { name: 'ホームへ' })" >/dev/null; sleep 3
      echo "created the verification user's own household"
    fi
    echo "logged in; now at $(pw --raw eval 'location.pathname')" ;;
  pw) shift; pw "$@" ;;
  evidence)
    d=".verify-evidence/$(date +%Y%m%dT%H%M%S)-${2:?name}"; mkdir -p "$d"; echo "$d" ;;
  cleanup)
    pw close >/dev/null 2>&1 || true
    if [ -f "$RUN_DIR/next.pid" ]; then
      pid=$(cat "$RUN_DIR/next.pid")
      if kill -0 "$pid" 2>/dev/null; then
        tree="$(descendants "$pid") $pid"
        kill -TERM $tree 2>/dev/null || true; sleep 2; kill -KILL $tree 2>/dev/null || true
        echo "stopped next dev pid $pid (tree: $(echo $tree | tr '\n' ' '))"
      fi
    fi
    rm -rf "$RUN_DIR"
    echo "cleanup done; evidence kept under .verify-evidence/" ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
