#!/usr/bin/env bash
set -euo pipefail
DATA="${MODEL_TRAINING_DATA:-/data}"
mkdir -p "$DATA/uploads" "$DATA/outputs" "$DATA/cache" \
  "$DATA/outputs/lf" "$DATA/outputs/lf-runs" "$DATA/outputs/lf-meta" "$DATA/outputs/swanlog"
if [[ ! -f "$DATA/model-training.config.json" ]]; then
  echo '{"outDir":"./outputs","formats":["messages"]}' > "$DATA/model-training.config.json"
fi
cd /app

node packages/server/dist/main.js &
WEB_PID=$!

if command -v llamafactory-cli >/dev/null 2>&1; then
  GRADIO_SERVER_NAME="${GRADIO_SERVER_NAME:-0.0.0.0}" GRADIO_SERVER_PORT="${GRADIO_SERVER_PORT:-7860}" \
    llamafactory-cli webui &
  LF_PID=$!
else
  echo "[entrypoint] llamafactory-cli 不在 PATH，跳过 WebUI" >&2
  LF_PID=""
fi

if command -v swanlab >/dev/null 2>&1; then
  mkdir -p "$DATA/outputs/swanlog"
  swanlab watch -h 0.0.0.0 -p 5092 -l "$DATA/outputs/swanlog" || true &
fi

wait "$WEB_PID"
if [[ -n "${LF_PID}" ]]; then
  kill "$LF_PID" 2>/dev/null || true
fi
