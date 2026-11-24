.PHONY: help up down test lint build evals

help:
	@echo "Available commands:"
	@echo "  make up      - Start all services with docker compose"
	@echo "  make down    - Stop all docker compose services"
	@echo "  make test    - Run backend unit and integration tests"
	@echo "  make lint    - Run backend and frontend linters"
	@echo "  make evals   - Run vulnerability detection evaluation suite"
	@echo "  make build   - Rebuild all container images"

up:
	docker compose up --build -d

down:
	docker compose down

test:
	python -m pytest backend/tests/ -v

evals:
	python backend/evals/run_evals.py

lint:
	cd frontend && npm run lint

build:
	docker compose build
