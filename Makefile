.PHONY: help setup dev dev-api dev-web test test-api lint typecheck build clean

PYTHON ?= python3.12
API_VENV := apps/api/.venv
API_PY   := $(API_VENV)/bin/python
API_PIP  := $(API_VENV)/bin/pip

help:
	@echo "Slash — development commands"
	@echo ""
	@echo "  make setup       Install all deps (api venv + web pnpm)"
	@echo "  make dev         Start api + web (same as scripts/slash-up)"
	@echo "  make dev-api     Start FastAPI on :4456"
	@echo "  make dev-web     Start Next.js on :4455"
	@echo "  make test        Run all tests"
	@echo "  make lint        Lint both apps"
	@echo "  make typecheck   Type-check both apps"
	@echo "  make build       Build web"
	@echo "  make clean       Remove venv / node_modules / next cache"

setup: $(API_VENV) web-setup

$(API_VENV):
	@echo ">> Creating API venv with $(PYTHON)"
	$(PYTHON) -m venv $(API_VENV)
	$(API_PIP) install --upgrade pip
	$(API_PIP) install -e 'apps/api[dev]'

web-setup:
	@echo ">> Installing web deps"
	@corepack enable >/dev/null 2>&1 || true
	pnpm install

dev:
	./scripts/slash-up

dev-api: $(API_VENV)
	$(API_PY) -m uvicorn slash_api.main:app --reload --host 127.0.0.1 --port 4456

dev-web:
	pnpm --filter @slash/web dev

test: test-api

test-api: $(API_VENV)
	$(API_PY) -m pytest apps/api/tests -v

lint:
	$(API_PY) -m ruff check apps/api
	pnpm --filter @slash/web lint

typecheck:
	pnpm --filter @slash/web typecheck

build:
	pnpm --filter @slash/web build

clean:
	rm -rf apps/api/.venv apps/web/.next node_modules apps/web/node_modules
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
