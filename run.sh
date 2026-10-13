#!/usr/bin/env bash
# One command to a running demo. Needs: uv (Python), node >= 20. Optional: Ollama or an OpenRouter key in .env.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required (https://docs.astral.sh/uv/): curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "node/npm >= 20 is required (https://nodejs.org)"; exit 1
fi

[ -f .env ] || cp .env.example .env
[ -d .venv ] || uv venv -q .venv
uv pip install -q --python .venv/bin/python -e ".[dev]"
[ -d web/node_modules ] || (cd web && npm install --silent)
(cd web && npm run build --silent)
.venv/bin/python scripts/seed.py "$@"
echo
echo "Open http://127.0.0.1:8000  (console)   ·  MCP endpoint: http://127.0.0.1:8000/mcp/   ·  Ctrl-C to stop"
exec .venv/bin/python -m agritwin.api.app
