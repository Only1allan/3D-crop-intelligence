# One-command demo: `make demo` installs everything, seeds the twin, builds the console and serves it.
SHELL := /bin/bash
PY := .venv/bin/python
UV := $(shell command -v uv 2>/dev/null)

.PHONY: demo setup seed api web dev test evals mcp clean

demo: setup seed web
	$(PY) -m agritwin.api.app

setup: .venv/.ok web/node_modules/.ok

.venv/.ok: pyproject.toml
ifndef UV
	$(error uv is required: https://docs.astral.sh/uv/  (curl -LsSf https://astral.sh/uv/install.sh | sh))
endif
	uv venv -q .venv
	uv pip install -q --python $(PY) -e ".[dev]"
	@touch .venv/.ok

web/node_modules/.ok: web/package.json
	cd web && npm install --silent
	@touch web/node_modules/.ok

seed: .venv/.ok
	$(PY) scripts/seed.py

web: web/node_modules/.ok
	cd web && npm run build --silent

api: .venv/.ok
	$(PY) -m agritwin.api.app

# Development: API with reload + Vite dev server (hot reload) side by side.
dev: setup
	(cd web && npm run dev) & $(PY) -m uvicorn agritwin.api.app:app --reload --port 8000; kill %1

mcp: .venv/.ok
	$(PY) -m agritwin.mcp_server.server --transport stdio

test: .venv/.ok
	$(PY) -m pytest -q

evals: .venv/.ok
	$(PY) -m evals.run_evals --write

clean:
	rm -rf .venv web/node_modules web/dist data/*.db data/*.db-* data/audit.jsonl
