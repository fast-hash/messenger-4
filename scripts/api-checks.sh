#!/usr/bin/env bash
set -euo pipefail

PORT=${API_CHECKS_PORT:-3100}
LOG_DIR=${API_CHECKS_LOG_DIR:-artifacts}
LOG_FILE="$LOG_DIR/api-checks.log"
SERVER_LOG="$LOG_DIR/api-server.log"
mkdir -p "$LOG_DIR"
: >"$LOG_FILE"
: >"$SERVER_LOG"

cleanup() {
  if [[ -f server.pid ]]; then
    if kill -0 "$(<server.pid)" 2>/dev/null; then
      kill "$(<server.pid)" 2>/dev/null || true
      wait "$(<server.pid)" 2>/dev/null || true
    fi
    rm -f server.pid
  fi
}
trap cleanup EXIT

NODE_ENV=test JWT_SECRET=test-secret API_CHECKS_PORT="$PORT" node scripts/start-test-server.mjs >>"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > server.pid

for _ in {1..40}; do
  if grep -q "ready:$PORT" "$SERVER_LOG"; then
    break
  fi
  sleep 0.25
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server terminated unexpectedly" | tee -a "$LOG_FILE"
    exit 1
  fi
  if curl -sS "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "Server failed to start" | tee -a "$LOG_FILE"
  exit 1
fi

run_curl() {
  local __result_var=$1
  shift
  local description=$1
  shift
  echo -e "\n## ${description}" | tee -a "$LOG_FILE"
  echo "curl $*" | tee -a "$LOG_FILE"
  local response
  response=$(curl -sS -w "\nHTTP %{http_code}\n" "$@" | tee -a "$LOG_FILE")
  printf -v "$__result_var" '%s' "$response"
}

trim_http() {
  printf '%s\n' "$1" | sed '$d'
}

extract_status() {
  printf '%s\n' "$1" | tail -n1 | awk '{print $2}'
}

run_curl bootstrap "Bootstrap test data" -X POST "http://127.0.0.1:$PORT/__test__/bootstrap"
bootstrap_body=$(trim_http "$bootstrap")
bootstrap_status=$(extract_status "$bootstrap")
if [[ "$bootstrap_status" != "200" ]]; then
  echo "Bootstrap failed with status $bootstrap_status" | tee -a "$LOG_FILE"
  exit 1
fi

if [[ -z "$bootstrap_body" ]]; then
  echo "Bootstrap returned an empty body" | tee -a "$LOG_FILE"
  exit 1
fi

chat_token=$(printf '%s' "$bootstrap_body" | node -e "
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (data += chunk));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(data);
    console.log(payload.chatId || '');
    console.log(payload.tokenA || '');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
});
process.stdin.resume();
")

mapfile -t parsed_bootstrap <<<"$chat_token"
chatId=${parsed_bootstrap[0]:-}
tokenA=${parsed_bootstrap[1]:-}

if [[ -z "$chatId" || -z "$tokenA" ]]; then
  echo "Bootstrap response parsing failed" | tee -a "$LOG_FILE"
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $tokenA"

run_curl limit0 "History with limit=0" -H "$AUTH_HEADER" "http://127.0.0.1:$PORT/api/messages/$chatId?limit=0"
[[ "$(extract_status "$limit0")" == "400" ]] || exit 1

run_curl limit500 "History with limit=500" -H "$AUTH_HEADER" "http://127.0.0.1:$PORT/api/messages/$chatId?limit=500"
[[ "$(extract_status "$limit500")" == "400" ]] || exit 1

run_curl badcursor "History with malformed cursor" -H "$AUTH_HEADER" "http://127.0.0.1:$PORT/api/messages/$chatId?cursor=not-a-cursor"
[[ "$(extract_status "$badcursor")" == "400" ]] || exit 1

payload=$(printf '{"chatId":"%s","encryptedPayload":"%s"}' "$chatId" "QUJDRA==")
run_curl firstsend "Send ciphertext" -H "$AUTH_HEADER" -H 'Content-Type: application/json' -d "$payload" -X POST "http://127.0.0.1:$PORT/api/messages"
[[ "$(extract_status "$firstsend")" == "200" ]] || exit 1

run_curl duplicatesend "Replay ciphertext" -H "$AUTH_HEADER" -H 'Content-Type: application/json' -d "$payload" -X POST "http://127.0.0.1:$PORT/api/messages"
[[ "$(extract_status "$duplicatesend")" == "409" ]] || exit 1

echo -e "\nAPI checks completed successfully" | tee -a "$LOG_FILE"
